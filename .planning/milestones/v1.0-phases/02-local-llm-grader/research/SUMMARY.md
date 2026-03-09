# Phase 2 Supplementary Research Summary

**Phase:** 02 - Local LLM Grader
**Domain:** Grader model selection and Ollama CPU performance tuning
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

The original Phase 2 research (02-RESEARCH.md) recommended qwen3:4b as the default grader model. During UAT, this choice proved unworkable: Qwen3's thinking mode consumed the entire `num_predict` token budget on `<think>` chain-of-thought reasoning, producing empty JSON responses and timeouts on CPU-only hardware. Two supplementary research efforts investigated the root cause and identified a replacement. The root cause is well-understood and the fix is validated on hardware.

The replacement model is **phi3.5:3.8b**, which completes grading in approximately 14 seconds on Snapdragon X Elite ARM64 CPU. It is a non-thinking model, eliminating the entire category of thinking-mode failures. The switch has already been implemented (commit cb6b3bc). Beyond model selection, Ollama's default configuration was found to be significantly suboptimal for ARM64 CPU-only hardware: silent prompt truncation at 2048 tokens, a core detection bug on ARM64, and unquantized KV cache waste RAM. Four environment variables address all of these issues with no quality trade-offs.

The key risk going forward is **tag drift** -- Ollama's mutable library tags mean that any model referenced by short tag (e.g., `qwen3:4b`) can silently resolve to a different variant after library updates. All model references should use fully-qualified tags. For phi3.5:3.8b, this risk is low since it has no thinking variant, but it applies to any future model reconsideration involving the Qwen3 family.

## Key Findings

### From QWEN-THINKING.md: Why Qwen3 Fails for Grading

Qwen3 models default to thinking mode, emitting `<think>...</think>` blocks before the actual response. On CPU hardware with constrained `num_predict` budgets (256-512 tokens), the thinking tokens exhaust the entire budget, leaving zero tokens for the JSON grading response. The `think: false` API parameter (Ollama v0.9.0+) can disable thinking on hybrid variants, but the default `qwen3:4b` tag has drifted and may now resolve to a thinking-only variant (`-thinking-2507`) that silently ignores `think: false`.

**Critical takeaways:**
- `think: false` is a top-level API parameter, not inside `options` -- placing it in `options` has no effect
- Thinking-only variants silently ignore `think: false` with no error
- The `/no_think` prompt directive is a soft signal, not runtime-enforced
- Tag pinning is essential: use `qwen3:4b-q4_K_M` (hybrid) or `qwen3:4b-instruct-2507-q4_K_M` (non-thinking)
- **Recommendation: avoid Qwen3 entirely for grading** -- non-thinking models eliminate the problem class

### From MODELS-AND-OPTIMIZATIONS.md: phi3.5 and Ollama Tuning

**Model selection:**
- **phi3.5:3.8b (default):** 14s on Snapdragon X Elite, tops instruction-following benchmarks at 3-4B, non-thinking, Q4_K_M ~2.5 GB RAM
- **qwen2.5:3b (alternative):** Better math/coding scores, non-thinking, untested on this hardware
- **llama3.2:3b (alternative):** Fallback if phi3.5/qwen2.5 underperform
- **qwen2.5:7b (quality upgrade):** Better quality but approaches the 60s timeout; ~5 GB RAM

**Ollama CPU optimizations (four environment variables):**
1. `OLLAMA_FLASH_ATTENTION=1` -- prerequisite for KV cache quantization; no downsides
2. `OLLAMA_KV_CACHE_TYPE=q8_0` -- halves KV cache RAM with negligible quality loss
3. `OLLAMA_NUM_PARALLEL=1` -- avoids wasted pre-allocation for single-request workloads
4. `OLLAMA_NUM_THREAD=12` -- works around ARM64 core detection bug (Ollama #11221)

**API configuration:**
- Use JSON Schema object in `format` field (not the `"json"` string) -- GBNF grammar constrains output at token level
- Always set `num_ctx: 8192` explicitly -- default 2048 silently truncates the rubric from the beginning of the prompt
- Set `num_predict: 512` -- default varies and may truncate the JSON response mid-output
- Set `temperature: 0` for deterministic grading

### Pitfalls Consolidated (Priority Order)

1. **Silent prompt truncation at num_ctx 2048** -- Ollama defaults to 2048 regardless of model capability. The rubric (sent first in the prompt) gets silently truncated. Always set `num_ctx` explicitly. This is the most impactful pitfall because it produces wrong scores without any error.

2. **Thinking models exhaust token budget** -- Qwen3 and any future thinking-enabled model will consume `num_predict` tokens on `<think>` blocks before producing visible output. Only use non-thinking models for grading. If a thinking model must be used, `num_predict` needs at least 2048, which may exceed timeout budgets on CPU.

3. **Tag drift in Ollama library** -- Mutable tags (`qwen3:4b`) can silently resolve to different model variants after `ollama pull`. Pin tags explicitly. Symptoms: grading suddenly starts timing out or producing empty responses after an Ollama update.

4. **ARM64 core miscount** -- Ollama bug #11221 miscounts cores on ARM64. Set `OLLAMA_NUM_THREAD` explicitly. Symptoms: inference 2-3x slower than expected, low CPU utilization.

5. **KV cache memory explosion** -- Default FP16 KV cache at high `num_ctx` can OOM. Enable `OLLAMA_KV_CACHE_TYPE=q8_0` (requires Flash Attention). At 8K context with phi3.5:3.8b Q4_K_M, total RAM is approximately 2.75 GB with q8_0 KV vs 3.0 GB with FP16 KV.

## Implications for Grader Implementation

These findings are already partially implemented (model switch to phi3.5:3.8b in commit cb6b3bc). The remaining implications affect current and future phases:

### Current Phase (02): Configuration Hardening

The `callOllama()` API call should include all optimized parameters:
- `num_ctx: 8192` to prevent prompt truncation
- `num_predict: 512` to ensure complete JSON output
- `num_thread: 12` to work around ARM64 core detection bug
- `num_batch: 128` for throughput on batch prompt evaluation
- `num_gpu: 0` to explicitly disable GPU (CPU-only hardware)
- `temperature: 0` for deterministic grading
- JSON Schema object in `format` (not the `"json"` string)

### Phase 3 (CI): Ollama Environment Setup

CI workflows should set the four environment variables before `ollama serve`:
- `OLLAMA_FLASH_ATTENTION=1`
- `OLLAMA_KV_CACHE_TYPE=q8_0`
- `OLLAMA_NUM_PARALLEL=1`
- `OLLAMA_NUM_THREAD` set to the runner's actual core count (may differ from Snapdragon X Elite's 12)

The ARM64 core detection bug affects GitHub's arm64 runners (Ampere Altra) as well. Explicit thread count is recommended for all ARM64 CI.

### Phase 5 (Polish): Model Selection Refinement

Open questions suitable for Phase 5:
- Head-to-head grading quality: qwen2.5:3b vs phi3.5:3.8b on project rubrics
- Optimal `num_thread` for mixed performance/efficiency ARM64 cores (8 vs 12)
- Whether Q5_K_M quantization provides meaningful quality improvement for grading accuracy
- Flash Attention architecture support verification across all candidate models

### Future Phases: Qwen3 Reconsideration

If Qwen3 is reconsidered in the future (for example, if a Qwen3 instruct-only variant proves higher quality):
- Use `qwen3:4b-instruct-2507-q4_K_M` -- architecturally non-thinking, never emits `<think>` tokens
- Never use the bare `qwen3:4b` tag
- Test with `ollama show <model>` to verify template includes thinking toggle support

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Model recommendation (phi3.5:3.8b) | HIGH | Confirmed by direct hardware testing at 14s; non-thinking architecture eliminates failure class |
| Qwen3 thinking mode behavior | HIGH | Verified via official docs, GitHub issues, and direct testing; root cause well-understood |
| Ollama environment tuning | HIGH | Documented in official Ollama docs; community-verified; four env vars with no quality trade-offs |
| JSON Schema structured output | HIGH | Official Ollama capability since v0.5; GBNF grammar is well-understood llama.cpp feature |
| Alternative model rankings | MEDIUM | Based on published benchmarks, not grading-specific testing on this hardware |
| Memory estimates | MEDIUM | Derived from quantization guides, not precisely measured on Snapdragon X Elite |

**Overall confidence:** HIGH

### Gaps to Address

- **qwen2.5:3b grading quality:** Benchmarks suggest it may outperform phi3.5 on math/coding rubrics, but no head-to-head grading test has been run. Defer to Phase 5.
- **Optimal thread count on mixed-core ARM64:** Whether using only performance cores (8 threads) is faster than all cores (12 threads) due to memory bandwidth. Defer to Phase 5 benchmarking.
- **CI runner performance characteristics:** phi3.5:3.8b tested at 14s on Snapdragon X Elite, but GitHub arm64 runners use Ampere Altra with different performance profiles. Will be validated in Phase 3.

## Sources

### Primary (HIGH confidence)
- [Thinking - Ollama Docs](https://docs.ollama.com/capabilities/thinking) -- API parameter specification
- [Thinking - Ollama Blog](https://ollama.com/blog/thinking) -- v0.9.0 announcement
- [Structured Outputs - Ollama Docs](https://docs.ollama.com/capabilities/structured-outputs) -- JSON Schema mode specification
- [Ollama num_ctx documentation](https://docs.ollama.com/context-length) -- default 2048 regardless of model
- [qwen3 library tags - ollama.com](https://ollama.com/library/qwen3/tags) -- variant tag listing
- Direct hardware testing on Snapdragon X Elite (2026-03-09) -- phi3.5:3.8b at 14s, qwen3:4b empty responses

### Secondary (MEDIUM confidence)
- [Ollama ARM64 thread detection bug - GitHub #11221](https://github.com/ollama/ollama/issues/11221) -- confirmed core miscount
- [qwen3:4b Can't turn off thinking - Issue #12917](https://github.com/ollama/ollama/issues/12917) -- confirms thinking-only tag behavior
- [Flash Attention + KV Cache quantization](https://smcleod.net/2024/12/bringing-k/v-context-quantisation-to-ollama/) -- q8_0 KV cache configuration
- [CPU Optimization - Ollama Tuning Guide](https://deepwiki.com/jameschrisa/Ollama_Tuning_Guide/3.1-cpu-optimization) -- num_batch, thread tuning
- [Best Small Language Models benchmark](https://medium.com/@darrenoberst/best-small-language-models-for-accuracy-and-enterprise-use-cases-benchmark-results-benchmark-results-cf71964759c8) -- instruction-following accuracy

### Tertiary (LOW confidence)
- Tokens-per-second estimates for untested models (qwen2.5:3b, llama3.2:3b) -- extrapolated from similar hardware
- [Ollama Performance on Windows (Jan 2026)](https://medium.com/@kapildevkhatik2/optimizing-ollama-performance-on-windows-hardware-quantization-parallelism-more-fac04802288e) -- Windows-specific tuning patterns

---
*Research completed: 2026-03-09*
*Synthesizes: QWEN-THINKING.md, MODELS-AND-OPTIMIZATIONS.md*
*Original phase research: 02-RESEARCH.md*
