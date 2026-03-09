# Phase 2: Local LLM Grader - Model Selection and Ollama Optimizations Research

**Researched:** 2026-03-09
**Domain:** Small LLM model selection for structured JSON grading, Ollama CPU performance tuning
**Confidence:** HIGH

## Summary

Testing confirmed that phi3.5:3.8b completes grading in ~14 seconds on Snapdragon X Elite ARM64 CPU, producing valid `{score, reasoning}` JSON responses. This makes it the primary grader model, replacing the originally-recommended qwen3:4b which fails due to thinking mode exhausting its token budget. Alternative candidates include qwen2.5:3b (non-thinking, TOOLS-mode in Ollama) and llama3.2:3b, with qwen2.5:7b as a quality upgrade that may approach the 60-second timeout budget.

Ollama's default configuration is significantly suboptimal for CPU-only ARM64 hardware. Key issues: `num_ctx` defaults to 2048 regardless of model capability (silently truncating grading prompts), ARM64 core detection has a confirmed bug (#11221), and KV cache uses unquantized FP16 by default (wasting RAM). Four environment variables (`OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE`, `OLLAMA_NUM_PARALLEL`, `OLLAMA_NUM_THREAD`) address these issues with no quality trade-offs.

**Primary recommendation:** Use phi3.5:3.8b as default grader model with JSON Schema mode (`format` field), `temperature: 0`, `num_ctx: 8192`, and the four Ollama environment variables listed above.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| phi3.5:3.8b | Q4_K_M | Default grading model | 14s on Snapdragon X Elite; tops instruction-following benchmarks at 3-4B; non-thinking |
| Ollama JSON Schema mode | v0.5+ | Structured output enforcement | GBNF grammar masks illegal tokens at sampling; structurally cannot produce non-conforming JSON |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| qwen2.5:3b | Q4_K_M | Alternative grader model | If phi3.5 shows quality regressions on specific rubrics; non-thinking, TOOLS-mode |
| llama3.2:3b | Q4_K_M | Alternative grader model | If phi3.5/qwen2.5 both underperform; TOOLS-mode in Ollama |
| qwen2.5:7b | Q4_K_M | Quality upgrade grader | When grading quality is more important than speed; ~5-6 GB RAM; approaches 60s |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| phi3.5:3.8b | qwen2.5:3b | Better math/coding scores, slightly larger, untested on this hardware |
| phi3.5:3.8b | qwen2.5:7b | Better quality but ~2x slower, may exceed 60s timeout |
| phi3.5:3.8b | gemma2:9b | Strong instruction following (71.3% MMLU) but ~3-5 t/s CPU exceeds 60s |
| phi3.5:3.8b | nous-hermes2:7b | 90% function calling, 84% JSON mode accuracy; 7B size slower |
| Q4_K_M quant | Q5_K_M | ~15-20% slower but ~2% quality gain; consider for quality-sensitive rubrics |

## Architecture Patterns

### Pattern 1: JSON Schema Structured Output
**What:** Pass a full JSON Schema object as the `format` field in Ollama API requests. llama.cpp compiles it to a GBNF grammar that constrains token sampling.
**When to use:** Every grading call. Replaces `format: "json"` (which only enforces valid JSON syntax, not schema).
**Example:**
```json
{
  "model": "phi3.5",
  "prompt": "...",
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "score": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
      "reasoning": { "type": "string" }
    },
    "required": ["score", "reasoning"]
  },
  "options": {
    "temperature": 0,
    "num_ctx": 8192,
    "num_thread": 12,
    "num_batch": 128
  }
}
```

### Pattern 2: Ollama Environment Tuning for ARM64 CPU
**What:** Set four environment variables before starting `ollama serve` to optimize for CPU-only ARM64.
**When to use:** All deployments on ARM64 hardware (Snapdragon X Elite, Ampere Altra, Apple Silicon).
**Example:**
```bash
OLLAMA_FLASH_ATTENTION=1     # Required for KV cache quant; no downsides
OLLAMA_KV_CACHE_TYPE=q8_0    # Halves KV cache RAM; negligible quality loss
OLLAMA_NUM_PARALLEL=1        # Single grading request at a time; avoids wasted pre-allocation
OLLAMA_NUM_THREAD=12         # Explicit core count; works around ARM64 detection bug
```

### Pattern 3: Schema Hint in Prompt
**What:** Include the expected JSON schema as text in the prompt, in addition to the `format` parameter.
**When to use:** Every grading call. Grounds the model on field names and value ranges.
**Example:**
```
Return your evaluation as JSON matching this schema:
{"score": <float 0.0-1.0>, "reasoning": "<explanation>"}
```

### Anti-Patterns to Avoid
- **Using `format: "json"` string instead of JSON Schema:** Only enforces valid JSON, not the grading schema. Model may produce `{}` or arbitrary field names.
- **Relying on Ollama's default `num_ctx` (2048):** Silently truncates the beginning of the prompt. The rubric is sent first and gets chopped.
- **Using 14B+ models on CPU-only hardware:** Too slow for the 60-second timeout budget. Stick to 3-4B models.
- **Setting `OLLAMA_NUM_PARALLEL > 1` for single-request workloads:** Pre-allocates context for unused parallel slots, wasting RAM.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema enforcement | Regex parsing + retry loop | Ollama `format` with JSON Schema object | GBNF grammar constrains at token level; structurally impossible to produce non-conforming output |
| ARM64 core optimization | Custom thread pinning | `OLLAMA_NUM_THREAD=12` env var | Ollama's built-in threading with explicit count works around the ARM64 detection bug |
| KV cache memory management | Context size calculator | `OLLAMA_KV_CACHE_TYPE=q8_0` | 50% KV cache reduction with no code changes |

**Key insight:** Most performance gains come from environment variables and API parameters, not code changes. The grader code itself is simple; the optimization surface is in Ollama's configuration.

## Common Pitfalls

### Pitfall 1: Silent Prompt Truncation at num_ctx 2048
**What goes wrong:** Grading produces nonsensical or partial scores. The model appears to miss rubric criteria entirely.
**Why it happens:** Ollama defaults `num_ctx` to 2048 regardless of the model's native context window. When the rubric + session log exceeds 2048 tokens, Ollama truncates from the beginning — silently removing the rubric.
**How to avoid:** Always set `num_ctx` explicitly to at least 8192. For longer session logs, 16384 or 32768. Memory cost on 32 GB hardware is manageable (8K context adds ~0.5 GB).
**Warning signs:** Grading scores are inconsistent; model ignores rubric criteria that appear at the start of the prompt.

### Pitfall 2: ARM64 Core Miscount
**What goes wrong:** Ollama uses fewer cores than available, making inference slower than expected.
**Why it happens:** Ollama bug #11221 — fails to correctly read `/proc/cpuinfo` on ARM64 architectures, miscounting physical cores on Snapdragon X Elite.
**How to avoid:** Set `OLLAMA_NUM_THREAD=12` explicitly. Benchmark with `8` and `12` to find the optimal count (using only performance cores may be faster due to memory bandwidth).
**Warning signs:** Inference is 2-3x slower than expected; CPU utilization is low during generation.

### Pitfall 3: Thinking Models in Grading Pipeline
**What goes wrong:** Qwen3 and other thinking models consume the `num_predict` budget on `<think>` blocks, producing empty or truncated grading responses.
**Why it happens:** Thinking models allocate tokens to chain-of-thought reasoning before the visible response. On CPU with constrained `num_predict`, no tokens remain for the actual JSON answer.
**How to avoid:** Only use non-thinking models for grading: phi3.5:3.8b, qwen2.5:3b, llama3.2:3b. Avoid the entire Qwen3 family.
**Warning signs:** Empty `response` field; `eval_count` equals `num_predict`; timeouts.

### Pitfall 4: KV Cache Memory Explosion at High Context
**What goes wrong:** Out-of-memory when increasing `num_ctx` to accommodate long session logs.
**Why it happens:** Default FP16 KV cache at 32K context for a 4B model can consume ~4 GB. Combined with model weights (~2.5 GB) and OS overhead, this can exceed available RAM.
**How to avoid:** Enable `OLLAMA_KV_CACHE_TYPE=q8_0` (requires `OLLAMA_FLASH_ATTENTION=1`). This halves KV cache memory with negligible quality loss. At 8K context, total RAM drops from ~3.5 GB to ~3 GB.
**Warning signs:** Ollama process killed by OOM; sudden slowdown as system starts swapping.

### Pitfall 5: Incomplete JSON from Token Exhaustion
**What goes wrong:** Ollama's JSON Schema grammar enforcement produces structurally valid JSON up to the token limit, then stops. Output is truncated mid-reasoning string with unclosed brackets.
**Why it happens:** `num_predict` defaults vary. If the reasoning string is long, the model may hit the limit before closing all JSON brackets.
**How to avoid:** Set `num_predict: 512` or higher for grading responses. The score + reasoning typically needs 100-300 tokens; 512 provides headroom.
**Warning signs:** `parseResponse()` returns score 0; response ends mid-sentence; JSON parsing fails on unclosed strings.

## Code Examples

### Optimal Grading API Call
```json
{
  "model": "phi3.5",
  "prompt": "You are an evaluation judge...\n\nReturn your evaluation as JSON: {\"score\": <0.0-1.0>, \"reasoning\": \"<explanation>\"}\n\n[rubric]\n[session log]",
  "stream": false,
  "format": {
    "type": "object",
    "properties": {
      "score": { "type": "number", "minimum": 0.0, "maximum": 1.0 },
      "reasoning": { "type": "string" }
    },
    "required": ["score", "reasoning"]
  },
  "options": {
    "temperature": 0,
    "num_ctx": 8192,
    "num_predict": 512,
    "num_thread": 12,
    "num_batch": 128,
    "num_gpu": 0
  }
}
```

### Ollama Serve with Optimized Environment
```bash
OLLAMA_FLASH_ATTENTION=1 \
OLLAMA_KV_CACHE_TYPE=q8_0 \
OLLAMA_NUM_PARALLEL=1 \
OLLAMA_NUM_THREAD=12 \
ollama serve
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `format: "json"` string | `format: { JSON schema }` object | Ollama v0.5 (2024) | GBNF grammar-constrained output; schema validation at token level |
| FP16 KV cache | `OLLAMA_KV_CACHE_TYPE=q8_0` | Ollama v0.4+ | 50% KV cache memory reduction; enables higher `num_ctx` on constrained hardware |
| Auto core detection | Explicit `OLLAMA_NUM_THREAD` | Ongoing (bug #11221) | Workaround for ARM64 core miscount; significant speed improvement |
| qwen3:4b as default | phi3.5:3.8b as default | 2026-03-09 (this project) | Non-thinking model; 14s grading on Snapdragon X Elite; avoids timeout issues |

**Deprecated/outdated:**
- `format: "json"` (string): Still works but no schema constraint; use JSON Schema object instead
- qwen3:4b for grading: Thinking mode makes it unreliable on CPU-constrained hardware
- Default Ollama `num_ctx` (2048): Too low for any real grading workload; always set explicitly

## Quantization Reference

| Level | Speed vs FP16 | Quality | RAM for 4B model |
|-------|---------------|---------|-------------------|
| Q4_K_M | ~2x faster | ~95% | ~2.5 GB |
| Q5_K_M | ~1.6x faster | ~97% | ~3.0 GB |
| Q8_0 | ~1.4x faster | ~99% | ~4.5 GB |

Ollama pulls Q4_K_M by default. To get Q5_K_M explicitly:
```bash
ollama pull phi3.5:3.8b-mini-instruct-q5_K_M
```

## Memory Budget (Snapdragon X Elite, 32 GB)

| Configuration | Model Weights | KV Cache (8K) | Total |
|---------------|--------------|---------------|-------|
| phi3.5:3.8b Q4_K_M, FP16 KV | 2.5 GB | 0.5 GB | ~3.0 GB |
| phi3.5:3.8b Q4_K_M, q8_0 KV | 2.5 GB | 0.25 GB | ~2.75 GB |
| qwen2.5:7b Q4_K_M, q8_0 KV | 4.5 GB | 0.5 GB | ~5.0 GB |

## NUMA Note

Snapdragon X Elite is single-chip, non-NUMA. All 12 cores and 32 GB LPDDR5X share a single memory controller. NUMA tuning (`numactl`, `OLLAMA_NUMA_POLICY`) is not relevant and can be ignored.

## Open Questions

1. **qwen2.5:3b grading quality vs phi3.5:3.8b**
   - What we know: Qwen2.5:3b outperforms Phi3.5-mini on math/coding benchmarks; both are non-thinking
   - What's unclear: Head-to-head grading quality on this project's rubrics
   - Recommendation: Benchmark qwen2.5:3b after phi3.5 is validated in CI (Phase 3)

2. **Optimal num_thread for mixed-core ARM64**
   - What we know: Snapdragon X Elite has 12 cores (performance + efficiency mix)
   - What's unclear: Whether `num_thread=8` (performance cores only) is faster than `num_thread=12` (all cores)
   - Recommendation: Benchmark both values; start with 12

3. **Flash Attention architecture support**
   - What we know: Phi3 and Llama3 architectures support it; Ollama silently falls back to FP16 if unsupported (issue #13337)
   - What's unclear: Whether all model architectures in the candidate list have verified Flash Attention support
   - Recommendation: Enable unconditionally; the fallback is safe

## Sources

### Primary (HIGH confidence)
- [Structured Outputs - Ollama docs](https://docs.ollama.com/capabilities/structured-outputs) - JSON Schema mode specification
- [Structured outputs - Ollama Blog](https://ollama.com/blog/structured-outputs) - GBNF grammar explanation
- [Ollama num_ctx documentation](https://docs.ollama.com/context-length) - default 2048 regardless of model
- [Ollama FAQ - OLLAMA_NUM_PARALLEL](https://docs.ollama.com/faq) - parallel context pre-allocation
- Direct hardware testing (2026-03-09) - phi3.5:3.8b at 14s on Snapdragon X Elite

### Secondary (MEDIUM confidence)
- [CPU Optimization - Ollama Tuning Guide](https://deepwiki.com/jameschrisa/Ollama_Tuning_Guide/3.1-cpu-optimization) - num_batch, thread tuning
- [Ollama ARM64 thread detection bug - GitHub #11221](https://github.com/ollama/ollama/issues/11221) - confirmed core miscount
- [Flash Attention + KV Cache quantization](https://smcleod.net/2024/12/bringing-k/v-context-quantisation-to-ollama/) - q8_0 KV cache configuration
- [KV Cache quantization guide](https://blog.peddals.com/en/ollama-vram-fine-tune-with-kv-cache/) - memory impact analysis
- [Flash Attention architecture support - GitHub #13337](https://github.com/ollama/ollama/issues/13337) - silent FP16 fallback
- [Qwen2.5 technical report](https://qwenlm.github.io/blog/qwen2.5-llm/) - benchmark comparisons
- [Best Small Language Models benchmark](https://medium.com/@darrenoberst/best-small-language-models-for-accuracy-and-enterprise-use-cases-benchmark-results-benchmark-results-cf71964759c8) - instruction-following accuracy

### Tertiary (LOW confidence)
- Tokens-per-second estimates for untested models (qwen2.5:3b, llama3.2:3b) - extrapolated from similar hardware
- [Ollama Performance on Windows (Jan 2026)](https://medium.com/@kapildevkhatik2/optimizing-ollama-performance-on-windows-hardware-quantization-parallelism-more-fac04802288e) - Windows-specific tuning patterns

## Metadata

**Confidence breakdown:**
- Model recommendation (phi3.5:3.8b): HIGH - confirmed by direct hardware testing, 14s grading
- Ollama env var tuning: HIGH - documented in official docs and community guides
- JSON Schema structured output: HIGH - verified via official Ollama docs, GBNF grammar is well-understood
- Alternative model rankings: MEDIUM - based on published benchmarks, not grading-specific testing
- Memory estimates: MEDIUM - derived from quantization guides, not measured on this exact hardware

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (model recommendations may shift with new releases; env vars are stable)
