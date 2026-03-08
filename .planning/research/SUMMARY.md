# Project Research Summary

**Project:** local-skill-eval
**Domain:** Local LLM skill evaluation — offline agent benchmarking with Ollama
**Researched:** 2026-03-08
**Confidence:** MEDIUM-HIGH

## Executive Summary

This project extends an existing cloud-backed agent skill evaluation framework (skill-eval) to run entirely offline using Ollama for local LLM inference. The core work is twofold: replacing cloud graders (Gemini/Anthropic) with a `LocalLLMGrader` that calls Ollama's API, and adding agent CLI backends (OpenCode, Claude Code) that redirect their model calls to Ollama instead of cloud endpoints. The recommended approach is additive — new components slot into the existing pipeline without restructuring it, using the Adapter pattern for grading and environment-based configuration for agent CLIs, exactly mirroring what `ollama launch` does automatically. Ollama v0.14+ exposes three API surfaces covering all three consumers: native `/api/chat` for the grader, OpenAI-compatible `/v1/chat/completions` for OpenCode, and Anthropic-compatible `/v1/messages` for Claude Code — eliminating any need for proxy translators.

The biggest risk is the 16 GB RAM constraint on the target hardware (Snapdragon X Elite). A loaded 8B model at 64K context consumes up to 15 GB with FP16 KV cache, leaving nothing for Docker, Node.js, and the agent process. The solution is explicit sequential resource management: models must be unloaded between agent execution and grading phases using Ollama's `keep_alive: 0` parameter, KV cache quantization (`OLLAMA_KV_CACHE_TYPE=q4_0`) must be enabled to reduce KV cache memory 75%, and the local provider should be preferred over Docker for development to eliminate QEMU emulation overhead. A second critical risk is grading quality: small local models (7-8B) achieve only 55-68% agreement with human evaluators vs 80-90% for frontier cloud models. This is mitigated by using Ollama's structured JSON output enforcement with a JSON schema, temperature=0, and retry on parse failure — and using the larger Phi-4 Reasoning 14B as the grader model specifically for its superior instruction-following.

The recommended phase ordering follows the dependency graph: establish CI first for regression safety, then build the local LLM grader (smallest integration surface, fully testable in isolation), then add the OpenCode agent backend (simpler config-file-based setup), then Claude Code (more complex env-var-based Anthropic API compatibility), then polish with `ollama launch` integration and CI model caching. Do not pursue GPU/NPU acceleration — Ollama is CPU-only on ARM64 Windows and the Hexagon NPU requires ONNX model format, not GGUF. Accept 5-15 tokens/second and design the evaluation pipeline with appropriate timeouts.

## Key Findings

### Recommended Stack

Ollama (v0.17.7) is the clear choice for local LLM serving on ARM64 Windows. It has a native ARM64 build via Qualcomm partnership, is the de facto standard for local LLM serving, and exposes three API surfaces that serve the different consumers in this project without any proxy layer. The `ollama launch` command (v0.15+) automates agent CLI configuration and directly matches the UX pattern this project explicitly targets. The grader should use the `ollama` npm client (v0.6.3) for type safety, streaming helpers, and structured JSON output — not raw `fetch()` calls.

Phi-4 Reasoning 14B at Q4_K_M quantization is the recommended primary grader model — it has the best instruction-following benchmark (IFBench 0.834), which is what structured rubric evaluation demands. Qwen 2.5 Coder 14B Q4_K_M is the recommended agent model, fitting comfortably in 16 GB with a 128K context window. Do not use `@huggingface/transformers` for generative grading — WASM inference reaches only 2-5 tok/s, making a grading call take minutes rather than seconds.

**Core technologies:**
- **Ollama v0.17.7**: Local LLM server — de facto standard, native ARM64, three API surfaces, no proxy needed
- **ollama npm 0.6.3**: Grader client — official JS client, typed, streaming, structured JSON output
- **Phi-4 Reasoning 14B Q4_K_M**: Primary grader model — best instruction-following (IFBench 0.834), fits 16 GB
- **Qwen 2.5 Coder 14B Q4_K_M**: Agent model — best coding quality within memory budget, 128K context
- **OpenCode v1.2.20**: Agent CLI (primary integration) — OpenAI-compatible endpoint, config-file-based
- **Claude Code (latest)**: Agent CLI (secondary integration) — Anthropic Messages API, env-var-based

**Critical version requirements:**
- Ollama v0.14+ for Anthropic Messages API compatibility (Claude Code integration)
- Ollama v0.15+ for `ollama launch` command
- Ollama v0.17+ for dynamic context scaling via `OLLAMA_CONTEXT_LENGTH`

### Expected Features

All research confirms the same MVP scope. The core value proposition — running evaluations offline with local LLMs — requires seven features working together before anything else has value. These cannot be built incrementally in isolation; they form a single cohesive unit that either works end-to-end or provides no value.

**Must have (table stakes — v1):**
- **GitHub Actions CI workflow** — establishes regression safety before making behavioral changes to existing code
- **Ollama health check + model availability** — fail fast with actionable errors, not opaque mid-trial timeouts
- **Local LLM grader (Ollama)** — `LocalLLMGrader` class, temperature=0, structured JSON output with schema, retry on parse failure
- **OpenCode + Ollama agent backend** — config-file-based setup, `opencode run --model ollama/<model>`
- **Context window configuration** — 64K for agents (Modelfile), 16K for grader (API param); Ollama defaults to 4K, causing silent degradation
- **Model preloading** — avoid 10-30s cold start penalty on the first trial of each evaluation run
- **Sequential resource orchestration** — `keep_alive: 0` after agent, `keep_alive: -1` during grading; critical on 16 GB

**Should have (v1.x, add after core validation):**
- **Claude Code + Ollama agent backend** — env-var injection, Anthropic Messages API compatibility
- **ollama launch command matching** — zero-config agent setup, reduces developer onboarding friction
- **Model auto-pull** — pull on first use instead of requiring manual `ollama pull` as a prerequisite
- **Prompt template variants** — simplified rubric prompts for smaller local models that struggle with verbose cloud-oriented prompts
- **CI model caching** — `~/.ollama` keyed on model name to avoid multi-GB re-downloads
- **Eval cost tracking** — surface Ollama's `eval_count` and `eval_duration` in evaluation reports

**Defer (v2+):**
- Score normalization across models (needs accumulated reference data, HIGH complexity)
- Multi-model grading consensus (requires score normalization to be meaningful)
- Hardware-aware model recommendations (useful UX but low urgency — users can read docs)
- Offline-first CI Docker images (significant DevOps investment, niche use case)

**Anti-features to explicitly avoid:**
- GPU/NPU acceleration — Ollama is CPU-only on ARM64 Windows; pursuing this wastes development time
- Parallel trial execution — 16 GB RAM cannot hold two agent models simultaneously; Ollama serializes anyway
- Real-time streaming grader output — complicates JSON parsing for minimal user value
- Cloud fallback mid-evaluation — creates inconsistent grading conditions within a single run

### Architecture Approach

The architecture is a five-layer pipeline that adds two new integration surfaces (Ollama Server, Agent CLI Configurator) without restructuring the existing layers. The existing `EvalRunner` orchestration loop, Providers (Docker/local), and CLI layer remain unchanged. The Graders layer gains a new `LocalLLMGrader` class implementing the existing `Grader` interface under a new `local_llm_rubric` type — registered in `getGrader()` alongside the existing types. The Agents layer gains `OpenCodeAgent` and `ClaudeLocalAgent` classes that use environment injection and config-file generation to redirect existing agent CLIs to Ollama. Ollama acts as the central hub serving all consumers through different protocol surfaces.

Four key patterns govern the design: Adapter Pattern (new grader class, same interface — cloud grader unchanged), Environment-Based Configuration (inject vars/config files before spawning agent subprocess), Ollama Health Gate (pre-flight liveness and model availability check before any evaluation begins), and Sequential Resource Management (never run agent and grader inference concurrently on 16 GB, use `keep_alive` to control model lifecycle explicitly).

**Major components:**
1. **LocalLLMGrader** — implements `Grader` interface, calls `/v1/chat/completions`, enforces JSON schema via `format` parameter, Zod validation with up to 3 retries
2. **OpenCodeAgent** — writes `opencode.json` config pointing to Ollama, invokes `opencode run --model ollama/<model>`
3. **ClaudeLocalAgent** — injects `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` into subprocess env only, invokes `claude --model <model>`
4. **Ollama Health Gate** — pre-flight liveness (`GET /`) and model availability (`GET /api/tags`) with actionable error messages
5. **Sequential Orchestrator** — manages `keep_alive` parameter and model load/unload sequencing across trial phases
6. **GitHub Actions CI** — deterministic validation on standard runners; LLM evaluation deferred to self-hosted or cloud grader in CI

### Critical Pitfalls

1. **64K context vs 16 GB RAM (Pitfall 1, CRITICAL)** — At 64K context with FP16 KV cache, an 8B Q4 model uses up to 15 GB, leaving nothing for Docker, Node.js, and the agent process. The system freezes or OOM-kills Ollama mid-trial. Mitigation: enable `OLLAMA_KV_CACHE_TYPE=q4_0` (reduces KV cache 75%), use 16K-32K context for grading, unload models between phases. Add a pre-flight memory budget estimate before any evaluation starts.

2. **LLM-as-Judge quality collapse with small models (Pitfall 2, CRITICAL)** — Small local models (7-8B) drop to 55-68% human evaluator agreement vs 80-90% for frontier models. The existing grading prompt was designed for GPT-4/Claude. Mitigation: use Ollama's `format` parameter with a JSON schema to enforce `{score, reasoning}` structure, simplify rubric prompts for local models, validate with Zod and retry up to 3 times on parse failure, calibrate `LocalLLMGrader` against the existing `LLMGrader` on reference transcripts before trusting local scores.

3. **Streaming + tool calling bug in Ollama (Pitfall 3, CRITICAL)** — Tool calls are silently dropped when streaming is enabled on Ollama's OpenAI-compatible and Anthropic-compatible endpoints. The agent CLI appears to work but executes no tools, scoring 0 on all trials with no obvious error. Mitigation: test tool calling explicitly before building agent integrations (send a known tool-calling prompt, verify tool call objects appear in response), use `stream: false` as a fallback, monitor ollama/ollama#12557.

4. **Docker x86 emulation on ARM64 Windows (Pitfall 4, HIGH)** — QEMU emulation of amd64 containers adds 2x memory overhead and fails with silent SIGSEGV crashes. Mitigation: use the local provider for all ARM64 development; reserve Docker for CI (which runs on x86_64). Verify task images are multi-arch before requiring Docker locally.

5. **Environment variable conflicts between grader and agent (Pitfall 7, HIGH)** — `ANTHROPIC_API_KEY` serves two conflicting purposes: authenticating with Anthropic cloud for the grader, and being set to empty for Claude Code to use Ollama. Mitigation: scope agent env vars to the child process only (never `process.env`), use namespaced vars like `GRADER_ANTHROPIC_API_KEY` for the grader, use `ollama launch` which handles this isolation automatically.

## Implications for Roadmap

Based on the combined research, the dependency graph dictates a clear five-phase structure. Each phase builds on the previous and unlocks the next. All four research files are consistent about this ordering.

### Phase 1: CI Foundation
**Rationale:** Establish automated regression testing before making any behavioral changes to the existing codebase. The CI workflow validates that deterministic graders (which do not need Ollama) continue to work correctly throughout development. This is the safety net for every subsequent phase. GitHub-hosted runners work fine for deterministic graders — no Ollama required in this phase.
**Delivers:** GitHub Actions workflow running `npm run validate` on PRs, Node.js setup, artifact upload for eval results.
**Addresses:** GitHub Actions CI workflow, eval result artifacts (FEATURES.md P1/P2)
**Avoids:** No pitfalls in this phase — it is the safeguard against introducing regressions in later phases.
**Research flag:** Standard GitHub Actions patterns — skip `/gsd:research-phase`. Use `actions/setup-node@v4` and `actions/upload-artifact@v4`.

### Phase 2: Ollama Foundation and Local LLM Grader
**Rationale:** The grader is the smallest, most self-contained Ollama integration point — it replaces a single HTTP call with another. It can be validated entirely in isolation without any agent CLI. Everything else depends on having confidence that Ollama works correctly on this hardware. This phase also establishes the health check, context window configuration, and sequential resource management patterns that all subsequent phases inherit.
**Delivers:** `LocalLLMGrader` class, Ollama health gate utility, pre-flight memory estimation, `keep_alive` management, `local_llm_rubric` grader type in `task.toml`, validated end-to-end grading against the `superlint_demo` task.
**Uses:** `ollama` npm client 0.6.3, Phi-4 Reasoning 14B Q4_K_M (STACK.md), `OLLAMA_KV_CACHE_TYPE=q4_0`
**Addresses:** Ollama health check, local LLM grader, temperature=0, structured JSON output, model preloading, sequential resource orchestration (FEATURES.md P1)
**Avoids:** LLM-as-Judge quality collapse (Pitfall 2), 64K context memory explosion (Pitfall 1), prompt format mismatch (Pitfall 6). The grader uses `stream: false`, so the streaming+tool-call bug (Pitfall 3) does not apply here.
**Research flag:** Needs `/gsd:research-phase` — finalize structured output schema, JSON retry logic, exact `num_ctx` memory math for Phi-4 14B on 16 GB, calibration approach against cloud baseline.

### Phase 3: OpenCode Agent Backend
**Rationale:** OpenCode is the simpler agent integration — configuration is file-based (JSON), uses the OpenAI-compatible endpoint which is more stable than the Anthropic-compat endpoint, and is well-documented. Building OpenCode first establishes the agent lifecycle pattern (config generation, subprocess env, model loading/unloading) before tackling the more complex Claude Code integration. Depends on Phase 2 to have confirmed Ollama is working on the target hardware.
**Delivers:** `OpenCodeAgent` class, `opencode.json` generator, 64K context Modelfile setup for agent model, full end-to-end evaluation pipeline working locally with a local agent and local grader.
**Uses:** Qwen 2.5 Coder 14B Q4_K_M, Ollama OpenAI-compatible `/v1/chat/completions` (STACK.md)
**Addresses:** OpenCode + Ollama backend, context window configuration, agent env var management (FEATURES.md P1)
**Avoids:** Streaming+tool-call bug must be explicitly tested before trusting results (Pitfall 3), model lacks tool calling support (Pitfall 11), memory contention between agent and grader (Pitfall 13)
**Research flag:** Needs `/gsd:research-phase` — verify current fix status of Ollama streaming+tool-call bug on v0.17.7, confirm tool-calling model compatibility (qwen3-coder vs qwen2.5-coder), validate `opencode run` CLI flags for non-interactive execution.

### Phase 4: Claude Code Local Agent Backend
**Rationale:** Claude Code requires Ollama's Anthropic Messages API compatibility (`/v1/messages`), which is newer (added v0.14.0) and has more known limitations and streaming bugs than the OpenAI-compatible endpoint. Building Claude Code second means the agent lifecycle pattern is already established from Phase 3, and only the env-var-based configuration and Anthropic protocol translation need new work.
**Delivers:** `ClaudeLocalAgent` class (or modified `ClaudeAgent` with local backend option), subprocess-scoped env var injection, validated Claude Code + Ollama end-to-end evaluation.
**Uses:** Ollama Anthropic-compatible `/v1/messages`, `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` env vars (STACK.md)
**Addresses:** Claude Code + Ollama backend (FEATURES.md P2)
**Avoids:** Env var conflicts between grader and agent (Pitfall 7), streaming tool call regression (Pitfall 3)
**Research flag:** Needs `/gsd:research-phase` — confirm which Ollama model tag format `--model` accepts, verify `/v1/messages` streaming status on v0.17.7 stable, and validate that `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` prevents token-counting calls to the unsupported endpoint.

### Phase 5: Polish, CI Model Caching, and ollama launch Integration
**Rationale:** Once all core components work end-to-end, add developer experience improvements and complete the CI pipeline. `ollama launch` matching and model auto-pull are convenience layers that require the underlying integrations (Phases 2-4) to be solid. CI model caching only becomes important after developers experience slow CI runs in practice.
**Delivers:** `ollama launch` detection/matching, model auto-pull with progress display, CI model caching (`~/.ollama` in `actions/cache@v5`), self-hosted runner documentation, eval cost tracking via Ollama's `eval_count`/`eval_duration`.
**Addresses:** ollama launch matching, model auto-pull, CI model caching, self-hosted runner docs, eval cost tracking (FEATURES.md P2)
**Avoids:** Model download latency in developer workflow (Pitfall 14), CI resource limitations for LLM inference (Pitfall 8)
**Research flag:** CI caching uses standard patterns — no research needed there. The `ollama launch` detection needs `/gsd:research-phase` to verify the exact env var names and config file paths it sets, and how to detect whether a user has already run it vs needs to be prompted.

### Phase Ordering Rationale

- **CI first** because it is the safety net for every subsequent change and is completely independent of Ollama. Validates deterministic graders only.
- **Grader before agents** because the grader is fully testable in isolation. If Ollama has ARM64-specific issues on this hardware, the grader phase reveals them cheaply before agent integration work begins.
- **OpenCode before Claude Code** because OpenCode uses the OpenAI-compatible endpoint (more stable, better tested) while Claude Code requires the Anthropic Messages API compatibility (newer, known streaming limitations). Build confidence with the simpler path first.
- **Polish last** because `ollama launch` matching is a convenience layer on top of the agent backends, not a prerequisite for them to function.
- **NPU/GPU acceleration never in this roadmap** — architecturally incompatible with Ollama on ARM64 Windows. Accept CPU-only inference and design timeouts and trial counts accordingly.

### Research Flags

Phases needing deeper research during planning (`/gsd:research-phase`):
- **Phase 2 (Local LLM Grader):** Structured output JSON schema format, retry/fallback logic, exact `num_ctx` memory math for Phi-4 14B, calibration approach against cloud grader baseline
- **Phase 3 (OpenCode agent):** Current fix status of Ollama streaming+tool-call bug on v0.17.7, model compatibility matrix for tool calling, `opencode run` CLI flag syntax for non-interactive mode
- **Phase 4 (Claude Code agent):** Ollama model tag format accepted by `claude --model`, `/v1/messages` streaming status on current stable, env var scoping implementation approach

Phases with standard patterns (skip `/gsd:research-phase`):
- **Phase 1 (CI Foundation):** Well-documented GitHub Actions patterns; no Ollama involvement
- **Phase 5 (CI caching):** `actions/cache@v5` is standard; only `ollama launch` detection portion needs research

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Ollama docs, npm registry, official integration guides all verified. One gap: actual inference speed on Snapdragon X Elite — estimates are extrapolated from comparable ARM64 systems, not measured. |
| Features | MEDIUM-HIGH | MVP scope is clear and consistent across research files. P2 features (ollama launch matching) depend on implementation details that won't be known until Phases 2-4 are built. |
| Architecture | HIGH | Component boundaries are clear from the existing codebase. Adapter pattern and environment injection pattern are well-established and internally consistent across research files. |
| Pitfalls | HIGH | All critical pitfalls are backed by specific GitHub issues, official documentation, and hardware math. The streaming+tool-call bug (Pitfall 3) has highest uncertainty — its fix status on v0.17.7 stable needs explicit verification before Phase 3. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Actual inference speed on target hardware:** Performance estimates (5-15 tok/s for 14B Q4_K_M) are extrapolated from comparable ARM64 systems. Must be measured in Phase 2 to set realistic trial timeouts. If speed is consistently below 3 tok/s, switch to 7-8B models for the grader.
- **Streaming+tool-call bug fix status:** Ollama issues #12557, #9632, #10870 track this. Fix status on v0.17.7 stable must be explicitly verified in Phase 3 before building agent integrations. If still broken, `stream: false` is the fallback — functional but not ideal for interactive agent use.
- **Grader quality vs cloud baseline:** The 55-68% human agreement claim for small models is from general LLM-as-judge research, not measured on this specific rubric format. Phase 2 must include a calibration step comparing `LocalLLMGrader` against the existing `LLMGrader` on the `superlint_demo` task before trusting local scores.
- **OpenCode non-interactive flag syntax:** Community guides show `opencode run '<instruction>'` but the exact flags for headless/non-interactive mode need verification against the v1.2.20 CLI before Phase 3 implementation.

## Sources

### Primary (HIGH confidence)
- [Ollama official docs](https://docs.ollama.com) — API reference, CLI, Anthropic/OpenAI compatibility, Modelfile, FAQ
- [Ollama blog: Claude Code](https://ollama.com/blog/claude) — v0.14 Anthropic Messages API support
- [Ollama blog: launch command](https://ollama.com/blog/launch) — v0.15 agent CLI automation
- [ollama/ollama-js GitHub](https://github.com/ollama/ollama-js) — official npm client API surface, v0.6.3
- [OpenCode docs: providers](https://opencode.ai/docs/providers/) — Ollama configuration format
- [Claude Code docs: LLM gateway](https://code.claude.com/docs/en/llm-gateway) — ANTHROPIC_BASE_URL configuration
- [Qualcomm: Ollama on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) — ARM64 Windows compatibility, CPU-only confirmed
- [ai-action/setup-ollama](https://github.com/ai-action/setup-ollama) — GitHub Actions integration
- [Docker known issues](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/known-issues/) — QEMU ARM64 emulation warnings

### Secondary (MEDIUM confidence)
- [Snapdragon X Elite LLM journey (community)](https://vcfvct.wordpress.com/2025/12/31/running-local-llms-on-a-snapdragon-x-elite-surface-laptop-7-my-journey-to-real-npu-acceleration/) — firsthand NPU vs CPU performance
- [ONNX Runtime QNN EP docs](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html) — NPU path limitations for Node.js
- [LLM-as-Judge research: Eugene Yan](https://eugeneyan.com/writing/llm-evaluators/) — human agreement rates for small vs large models
- [G-Eval: Confident AI](https://www.confident-ai.com/blog/g-eval-the-definitive-guide) — structured output normalization technique
- [Ollama concurrent requests internals](https://www.glukhov.org/post/2025/05/how-ollama-handles-parallel-requests/) — OLLAMA_NUM_PARALLEL behavior

### Tertiary — Ollama GitHub Issues (confirm bug existence, fix status uncertain)
- [ollama/ollama#12557](https://github.com/ollama/ollama/issues/12557) — Streaming + tool calling broken on OpenAI compat
- [ollama/ollama#9632](https://github.com/ollama/ollama/issues/9632) — Tool calling streaming not working
- [ollama/ollama#10870](https://github.com/ollama/ollama/issues/10870) — Full streaming tool call lifecycle request
- [ollama/ollama#5360](https://github.com/ollama/ollama/issues/5360) — Snapdragon NPU/GPU support confirmed CPU-only

---
*Research completed: 2026-03-08*
*Ready for roadmap: yes*
