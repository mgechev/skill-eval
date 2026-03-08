# Feature Research

**Domain:** Local LLM skill evaluation (offline agent benchmarking)
**Researched:** 2026-03-08
**Confidence:** MEDIUM-HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist when they hear "local LLM evaluation tool." Missing these means the product does not deliver on its core promise.

#### Local LLM Grading

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ollama-backed LLM grader | Core promise -- replace cloud graders with local inference. Users expect to swap Gemini/Anthropic for a local model and get scores back. | MEDIUM | New `LocalLLMGrader` class targeting Ollama's `/api/chat` or OpenAI-compatible `/v1/chat/completions`. Must produce `GraderResult` with 0.0-1.0 score like existing `LLMGrader`. |
| Model selection via config | Users expect to specify which local model grades their tasks, just as the existing `LLMGrader` accepts a `model` field in `GraderConfig`. | LOW | Add `model` field support for local grader in `task.toml`. Format: `model = "qwen3:8b"` or similar Ollama model tag. |
| Rubric prompt reuse | Existing rubric files like `prompts/quality.md` must work unchanged with the local grader. Users should not rewrite rubrics for local models. | LOW | The grading prompt template wraps the rubric the same way. May need minor adjustments for smaller model instruction-following. |
| Structured JSON output parsing | The grader must extract `{"score": N, "reasoning": "..."}` from local model output, handling local models' tendency to produce malformed JSON. | MEDIUM | Local models (especially smaller ones) are less reliable at structured output. Need robust fallback parsing: try JSON extraction, then regex for score, then binary pass/fail from text analysis. |
| Ollama server health check | Before running evaluations, verify Ollama is running and the required model is available. | LOW | `GET /` for liveness, `GET /api/tags` for model availability. Fail fast with actionable error message if Ollama is not running or model not pulled. |
| Ollama model auto-pull | If a configured model is not present locally, automatically pull it before evaluation starts. | MEDIUM | Use `POST /api/pull` with streaming progress. Handle multi-GB downloads gracefully. Must support resume (Ollama resumes cancelled pulls natively). |
| Temperature=0 for grading | Deterministic-ish grading requires temperature=0. Users expect consistent scores across runs. | LOW | Pass `"options": {"temperature": 0}` in Ollama API request, matching existing `LLMGrader` behavior with cloud APIs. |

#### Agent CLI Local Backends

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| OpenCode + Ollama backend config | Users expect to run `opencode run` against a local Ollama model as the agent being evaluated. This is the primary local agent integration. | MEDIUM | Create `opencode.json` config pointing to `http://localhost:11434/v1` with `@ai-sdk/openai-compatible` provider. New `OpenCodeAgent` class invoking `opencode run --model ollama/<model> '<instruction>'`. |
| Claude Code + Ollama backend config | Users expect to run Claude Code against a local Ollama model. This requires env var injection. | MEDIUM | Set `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""` in the agent's environment. Pass `--model <ollama_model>` to the `claude` command. |
| Context window configuration | Both agent CLIs require 64k+ token context. Ollama defaults to 2048-4096. Users expect the tool to handle this. | MEDIUM | Use `num_ctx` parameter in Ollama API options or create a Modelfile with `PARAMETER num_ctx 65536`. Critical: without this, agents will silently produce degraded results. |
| Agent env var management | Users expect environment variables to flow correctly to the agent subprocess -- Ollama connection vars, API keys, tool configs. | LOW | Extend existing `.env` loading in `cli.ts` to include Ollama-specific vars. Merge into `env` passed to agent's `runCommand`. |
| Model routing (grader vs agent) | Users expect to use different models for grading (small, fast) vs agent execution (larger, more capable). | LOW | Separate config: `task.toml` `[[graders]]` section for grader model, CLI `--model` or config for agent model. Already natural from the architecture. |

#### GitHub Actions CI

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| CI workflow for eval on PR | Upstream skill-eval references GitHub Actions for running evals on skill changes. Users expect this from a fork too. | MEDIUM | Use `ai-action/setup-ollama@v2` to install Ollama, then `ollama pull <model>`, then run `npm run eval`. |
| Model caching across runs | LLM models are multi-GB. Re-downloading on every CI run is unacceptable. | LOW | Cache `~/.ollama` with `actions/cache@v5`. Key on model name + version. `ai-action/ollama-action@v2` has built-in `cache: true`. |
| Eval result artifacts | Users expect to download and compare evaluation results across CI runs. | LOW | Upload `results/` directory as GitHub Actions artifact. Standard `actions/upload-artifact@v4`. |
| Self-hosted runner support | GitHub-hosted runners have limited RAM (7GB). Local LLM inference needs 8-16GB. Self-hosted runners with sufficient RAM are expected. | MEDIUM | Document self-hosted runner requirements. Ensure workflow uses `runs-on` labels that can target self-hosted. Most teams will need self-hosted for non-trivial models. |

#### Ollama Integration

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Ollama server lifecycle management | Start/stop/check Ollama server as part of eval pipeline. | LOW | Check if Ollama is running (`GET /`). If not, attempt `ollama serve` in background. Wait for readiness with retry loop on `GET /api/tags`. |
| Model preloading (warm-up) | First inference pays 10-30s cold start. Users expect the tool to preload the model. | LOW | Send empty `POST /api/generate {"model": "..."}` before first eval. Use `keep_alive: -1` to prevent unload during eval run. |
| Graceful degradation on Ollama absence | If Ollama is not installed, fall back to existing cloud graders or skip LLM grading. | LOW | Check for Ollama availability at startup. Warn and fall back to cloud `LLMGrader` if `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is set, or skip LLM grading entirely with a warning. |

### Differentiators (Competitive Advantage)

Features that set local-skill-eval apart from upstream skill-eval and other evaluation tools. Not expected, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `ollama launch` command matching | Zero-config agent setup: run `ollama launch opencode` or `ollama launch claude` and the eval tool automatically detects the configuration. Matches Ollama's own UX pattern. | HIGH | Detect `ollama launch` env vars and config files. Alternatively, provide a wrapper that calls `ollama launch <agent> --config` then runs the eval. This is the project's explicit design goal per PROJECT.md. |
| Score normalization across models | Different local models have different scoring biases (e.g., Qwen3 scores more generously than GLM-4.7). Normalization makes cross-model comparisons meaningful. | HIGH | Implement calibration: run reference solutions through each grader model, compute bias offset, apply correction. G-Eval-style token probability normalization requires logprobs access (Ollama supports `logprobs` in API). |
| Multi-model grading consensus | Run the same rubric through 2-3 different local models and aggregate scores. Reduces single-model bias. | MEDIUM | Run grading prompt through N models, take median or weighted average. Increases grading time linearly but improves reliability significantly. Research shows LLM-as-judge is non-deterministic; multiple judges mitigate this. |
| Hardware-aware model recommendations | Auto-detect available RAM and recommend appropriate models. On 16GB (with Docker + Node + agent overhead), suggest Q4 models under 4B params for grading. | MEDIUM | Query system RAM, estimate overhead from running processes, recommend model size. Prevents users from pulling a 13B model that will OOM during eval. |
| Prompt template variants for local models | Smaller local models need simpler, more explicit prompts than GPT-4/Claude. Provide optimized rubric wrapper templates for different model tiers. | MEDIUM | Template registry: `cloud` (existing verbose prompt), `local-large` (for 30B+ models), `local-small` (for 7B models with explicit formatting instructions and few-shot examples). Users select via config or auto-detect from model size. |
| Eval cost tracking (inference time, tokens) | Show wall-clock time and estimated token usage for local grading. Makes it easy to compare cost of local vs cloud grading. | LOW | Already partially implemented (`input_tokens`, `output_tokens` in `TrialResult`). Extend to track grader inference time separately. Ollama API returns `eval_count` and `eval_duration` in response. |
| Offline-first CI mode | Run entire CI pipeline with zero network access. Model cached, no API calls, no package downloads. | MEDIUM | Pre-bake Docker images with Ollama + model. Use npm ci with lockfile. Useful for air-gapped environments and compliance-driven teams. |
| Sequential resource orchestration | Coordinate Ollama memory between grading and agent execution. Unload agent model before loading grader model to stay within 16GB. | HIGH | Use `keep_alive: 0` to unload models immediately after use. Sequence: load agent model -> run agent -> unload agent model -> load grader model -> grade -> unload grader model. Critical for 16GB RAM constraint. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems in this specific context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| GPU acceleration for grading | "Speed up inference" | Snapdragon Adreno X1-85 has near-zero ML support. Ollama on ARM64 Windows is CPU-only. Attempting GPU would produce errors or silent fallback to CPU. Wastes development time on a dead end for this hardware. | Optimize for CPU: use Q4 quantized models, small context windows for grading (rubric + transcript is typically under 4K tokens), and `OLLAMA_FLASH_ATTENTION=1` if supported. |
| NPU-accelerated inference | "Use the Hexagon NPU for fast inference" | Ollama does not support Qualcomm NPU. NPU requires ONNX model format, not GGUF. Would require entirely different runtime (AnythingLLM + ONNX). Splits the codebase for marginal benefit on grading tasks. | Accept CPU inference speed for grading. Grading is not latency-critical -- a 30-second grading call is fine when agent execution takes 2-5 minutes. NPU path is a future exploration, not an MVP feature. |
| Parallel trial execution with local LLM | "Run 5 trials simultaneously to speed up eval" | Each trial needs ~4-8GB for the agent model. On 16GB usable RAM, even 2 parallel trials would OOM. Ollama serializes requests to the same model anyway (`OLLAMA_NUM_PARALLEL` default is 1). | Sequential execution is the right default. Upstream parallel support exists (`--parallel=N`) but should be disabled or warned against for local LLM backends. |
| Real-time streaming grader output | "Stream grading reasoning token-by-token" | Adds complexity for minimal value. Grading takes 10-30 seconds. Streaming complicates JSON parsing (partial JSON in stream). The final score is what matters, not intermediate tokens. | Use `"stream": false` for grading. Show a progress spinner or "Grading..." message. Display complete reasoning after grading finishes. |
| Custom model fine-tuning for grading | "Fine-tune a model specifically for rubric grading" | Out of scope per PROJECT.md. Requires training infrastructure, datasets, GPU resources. The prompt engineering approach (rubric + structured output) is sufficient for skill evaluation. | Use prompt template optimization instead. Few-shot examples in the rubric prompt are cheaper and more maintainable than fine-tuning. |
| Cloud fallback during grading | "If local model is slow, fall back to cloud API mid-evaluation" | Creates inconsistent evaluation conditions. If trial 1 is graded by a local model and trial 2 by Gemini, scores are not comparable. Defeats the purpose of offline evaluation. | Choose one mode per eval run: local or cloud. The existing `LLMGrader` handles cloud. The new `LocalLLMGrader` handles local. Don't mix within a single evaluation. |
| vLLM/llama.cpp direct integration | "Support other inference backends beyond Ollama" | Fragments testing surface. Ollama already wraps llama.cpp internally and provides a stable API. Adding direct llama.cpp or vLLM adds maintenance burden for marginal performance gains on single-user hardware. | Standardize on Ollama. If users want vLLM, they can expose it as an OpenAI-compatible endpoint and configure the tool to use that URL. The tool talks to HTTP APIs, not inference engines directly. |
| Web dashboard for eval results | "Build a real-time web UI for viewing results" | Upstream already has `viewer.html` and browser-based analytics. Building a custom dashboard is high effort, low priority for a CLI-first tool. | Use existing `viewer.html` for result visualization. Export results as JSON artifacts. Let users plug into existing dashboards (Grafana, Weights & Biases) if they need time-series tracking. |

## Feature Dependencies

```
[Ollama Health Check]
    |
    +--requires--> [Ollama Server Lifecycle]
    |
    +--enables--> [Ollama Model Auto-Pull]
    |                  |
    |                  +--enables--> [Model Preloading]
    |
    +--enables--> [Local LLM Grader]
    |                  |
    |                  +--requires--> [Structured JSON Parsing]
    |                  +--requires--> [Temperature=0 Config]
    |                  +--requires--> [Rubric Prompt Reuse]
    |                  +--enhances--> [Score Normalization]
    |                  +--enhances--> [Multi-Model Consensus]
    |                  +--enhances--> [Prompt Template Variants]
    |
    +--enables--> [OpenCode + Ollama Backend]
    |                  |
    |                  +--requires--> [Context Window Config (64k)]
    |                  +--requires--> [Agent Env Var Management]
    |
    +--enables--> [Claude Code + Ollama Backend]
    |                  |
    |                  +--requires--> [Context Window Config (64k)]
    |                  +--requires--> [Agent Env Var Management]
    |                  +--requires--> [ANTHROPIC_BASE_URL Config]
    |
    +--enables--> [ollama launch Command Matching]
                       |
                       +--requires--> [OpenCode + Ollama Backend]
                       +--requires--> [Claude Code + Ollama Backend]

[GitHub Actions CI Workflow]
    +--requires--> [setup-ollama Action]
    +--requires--> [Model Caching]
    +--enhances--> [Eval Result Artifacts]
    +--enhances--> [Self-Hosted Runner Support]

[Sequential Resource Orchestration]
    +--requires--> [Model Preloading]
    +--requires--> [keep_alive Management]
    +--enhances--> [Local LLM Grader]
    +--enhances--> [Agent CLI Backends]

[Model Routing (grader vs agent)]
    +--requires--> [Local LLM Grader]
    +--requires--> [Agent CLI Backends]

[Hardware-Aware Model Recommendations]
    +--enhances--> [Model Auto-Pull]
    +--enhances--> [Context Window Config]
```

### Dependency Notes

- **Local LLM Grader requires Ollama Health Check:** Must verify Ollama is running and model is available before attempting to grade. Without this, users get opaque connection errors.
- **Agent CLI backends require Context Window Config:** Both OpenCode and Claude Code need 64k+ context. Ollama defaults to 2048-4096. This is the single most common misconfiguration that causes silent degradation.
- **ollama launch matching requires both agent backends:** The `ollama launch` command sets up env vars for a specific agent. The eval tool must understand the env vars for both OpenCode and Claude Code to detect this configuration.
- **Sequential Resource Orchestration requires keep_alive management:** On 16GB RAM, must unload agent model before loading grader model. Uses Ollama's `keep_alive: 0` to force immediate unload and `keep_alive: -1` to prevent unload during active use.
- **Score Normalization enhances but does not require Local LLM Grader:** Can be added after basic grading works. Uses reference solution scores as calibration data.

## MVP Definition

### Launch With (v1)

Minimum viable product -- what is needed to validate that local LLM evaluation works end-to-end.

- [ ] **GitHub Actions CI workflow** -- Establish automated validation before making behavioral changes. Run existing deterministic graders in CI. Foundation for all subsequent features.
- [ ] **Ollama health check + model availability** -- Fail fast with clear errors. `GET /` for liveness, `GET /api/tags` for model presence.
- [ ] **Local LLM grader (Ollama)** -- Core feature. Replace cloud `LLMGrader` with `LocalLLMGrader` targeting Ollama `/api/chat`. Reuse existing rubric files. Temperature=0. Robust JSON parsing with fallbacks.
- [ ] **OpenCode + Ollama agent backend** -- First agent integration. Config file generation, `opencode run --model ollama/<model>` invocation, env var management.
- [ ] **Context window configuration** -- Without 64k context, agent CLIs produce garbage. Must be solved at model setup time (Modelfile or `num_ctx` param).
- [ ] **Model preloading** -- Avoid cold start penalty on first trial. Send empty generate request before eval.
- [ ] **Sequential resource orchestration** -- On 16GB, must sequence agent and grader model loading. `keep_alive: 0` after agent, `keep_alive: -1` during grading.

### Add After Validation (v1.x)

Features to add once core local grading is proven to work.

- [ ] **Claude Code + Ollama agent backend** -- Second agent. Env var injection (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`), `--model` flag. Add after OpenCode works because Claude Code's env var setup is well-documented but harder to test without an active Anthropic account.
- [ ] **ollama launch command matching** -- Detect when user has run `ollama launch opencode` or `ollama launch claude` and auto-configure the eval tool. Reduces setup friction.
- [ ] **Model auto-pull** -- If model not present, pull it. Convenient but not critical for MVP (users can `ollama pull` manually).
- [ ] **Prompt template variants for local models** -- Optimize rubric prompts for smaller models. Add after testing reveals where small models struggle with the default prompt.
- [ ] **CI model caching** -- Cache `~/.ollama` between CI runs. Add after CI workflow is established and model download times become painful.
- [ ] **Self-hosted runner documentation** -- Guide for setting up runners with enough RAM for local LLM evals.
- [ ] **Eval cost tracking** -- Surface Ollama's `eval_count` and `eval_duration` in reports.

### Future Consideration (v2+)

Features to defer until the tool is proven useful.

- [ ] **Score normalization** -- Calibrate model scoring bias. Requires accumulated reference data across multiple models. HIGH complexity, LOW urgency.
- [ ] **Multi-model grading consensus** -- Multiple judge models for reliability. Requires score normalization to work first. Increases eval time linearly.
- [ ] **Hardware-aware model recommendations** -- Auto-detect RAM and suggest models. Nice UX but users can read docs. Defer until user feedback demands it.
- [ ] **Offline-first CI mode** -- Pre-baked Docker images with Ollama + model. Requires significant DevOps investment. Only valuable for air-gapped environments.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| GitHub Actions CI workflow | HIGH | LOW | P1 |
| Ollama health check + model availability | HIGH | LOW | P1 |
| Local LLM grader (Ollama) | HIGH | MEDIUM | P1 |
| OpenCode + Ollama agent backend | HIGH | MEDIUM | P1 |
| Context window configuration | HIGH | MEDIUM | P1 |
| Model preloading | MEDIUM | LOW | P1 |
| Sequential resource orchestration | HIGH | MEDIUM | P1 |
| Claude Code + Ollama agent backend | HIGH | MEDIUM | P2 |
| ollama launch command matching | MEDIUM | HIGH | P2 |
| Model auto-pull | MEDIUM | LOW | P2 |
| Prompt template variants | MEDIUM | MEDIUM | P2 |
| CI model caching | MEDIUM | LOW | P2 |
| Self-hosted runner docs | LOW | LOW | P2 |
| Eval cost tracking | LOW | LOW | P2 |
| Score normalization | MEDIUM | HIGH | P3 |
| Multi-model consensus | LOW | MEDIUM | P3 |
| Hardware-aware recommendations | LOW | MEDIUM | P3 |
| Offline-first CI mode | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- validates core value proposition (run evals offline with local LLMs)
- P2: Should have, add when possible -- improves UX and covers second agent CLI
- P3: Nice to have, future consideration -- advanced features for power users

## Competitor Feature Analysis

| Feature | Upstream skill-eval | promptfoo | DeepEval (G-Eval) | Our Approach |
|---------|--------------------|-----------|--------------------|--------------|
| LLM grading | Gemini/Anthropic cloud only | OpenAI, Anthropic, local via custom provider | OpenAI-based G-Eval with CoT | Ollama-first, cloud fallback. Same rubric format as upstream. |
| Agent evaluation | Gemini CLI, Claude Code | N/A (evaluates prompts, not agents) | N/A (evaluates model outputs) | OpenCode + Claude Code with local Ollama backends |
| Docker isolation | Yes (built-in) | No | No | Inherited from upstream. Local provider as fallback. |
| Score normalization | None | None built-in | G-Eval token probability normalization | Planned v2: reference-based calibration |
| CI integration | GitHub Actions (mentioned in blog) | GitHub Actions built-in | Python-based CI hooks | GitHub Actions with ollama-action, model caching |
| Offline mode | No (requires API keys) | Partial (supports local models) | No (requires OpenAI API) | Full offline: local grader + local agent + cached models |
| Deterministic grading | Yes (shell scripts) | Yes (assertions) | Yes (exact match, contains) | Inherited from upstream |
| Multi-trial statistics | Yes (pass@k, pass^k) | No | No | Inherited from upstream |
| Skill injection | Yes (Docker volume mounts) | No | No | Inherited from upstream |

## Ollama API Surface Used

Summary of Ollama API endpoints this project will consume. Confidence: HIGH (verified against official docs).

| Endpoint | Method | Purpose | When Used |
|----------|--------|---------|-----------|
| `/` | GET | Liveness check | Startup, before every eval |
| `/api/tags` | GET | List local models (readiness) | Startup, model validation |
| `/api/chat` | POST | Local LLM grading (native API) | During grading phase |
| `/v1/chat/completions` | POST | OpenAI-compatible endpoint for agent CLIs | OpenCode agent backend |
| `/api/generate` | POST | Model preloading (empty prompt) | Before first trial |
| `/api/pull` | POST | Download models | Model auto-pull feature |
| `/api/show` | POST | Model details (size, params) | Hardware-aware recommendations |

## Agent CLI Configuration Reference

### OpenCode

**Config file:** `~/.config/opencode/opencode.json`
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "<model_name>": {
          "name": "<model_name>",
          "tools": true
        }
      }
    }
  }
}
```

**CLI invocation:** `opencode run --model ollama/<model_name> '<instruction>'`

**Key requirement:** Model must support tool/function calling for agentic use.

### Claude Code

**Environment variables:**
```bash
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=""
```

**CLI invocation:** `claude --model <ollama_model_name> "<instruction>" --yes --no-auto-update`

**Key requirement:** Ollama v0.14+ for Anthropic Messages API compatibility.

### ollama launch shortcut

**For OpenCode:** `ollama launch opencode` (auto-configures `opencode.json`)
**For Claude Code:** `ollama launch claude` (auto-sets env vars + launches)
**Config-only mode:** `ollama launch <agent> --config` (configures without launching)
**Requires:** Ollama v0.15+

## Sources

### Official Documentation (HIGH confidence)
- [Ollama API Documentation](https://docs.ollama.com/api/introduction)
- [Ollama FAQ (keep_alive, context, parallel)](https://docs.ollama.com/faq)
- [Ollama Claude Code Integration](https://docs.ollama.com/integrations/claude-code)
- [Ollama OpenCode Integration](https://docs.ollama.com/integrations/opencode)
- [Ollama Launch Blog Post](https://ollama.com/blog/launch)
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility)
- [OpenCode CLI Docs](https://opencode.ai/docs/cli/)
- [OpenCode Providers](https://opencode.ai/docs/providers/)
- [OpenCode Models](https://opencode.ai/docs/models/)
- [skill-eval Blog Post](https://blog.mgechev.com/2026/02/26/skill-eval/)
- [Qualcomm: Ollama with Windows on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos)

### GitHub Actions (HIGH confidence)
- [ai-action/ollama-action](https://github.com/ai-action/ollama-action) -- Run Ollama in GHA with caching
- [ai-action/setup-ollama](https://github.com/ai-action/setup-ollama) -- Setup Ollama CLI in GHA

### Community/Verified Sources (MEDIUM confidence)
- [Ollama ARM64/Snapdragon Performance](https://vcfvct.wordpress.com/2025/12/31/running-local-llms-on-a-snapdragon-x-elite-surface-laptop-7-my-journey-to-real-npu-acceleration/) -- Confirms CPU-only on Snapdragon, NPU requires ONNX
- [Ollama Concurrent Requests Internals](https://www.glukhov.org/post/2025/05/how-ollama-handles-parallel-requests/) -- Detailed analysis of OLLAMA_NUM_PARALLEL behavior
- [LLM-as-Judge Best Practices](https://www.montecarlodata.com/blog-llm-as-judge/) -- 7 best practices for evaluation prompts
- [G-Eval Score Normalization](https://www.confident-ai.com/blog/g-eval-the-definitive-guide) -- Token probability normalization technique
- [DataCamp: Claude Code with Ollama](https://www.datacamp.com/tutorial/using-claude-code-with-ollama-local-models) -- Step-by-step configuration guide

### Hardware-Specific (MEDIUM confidence)
- [Ollama Snapdragon NPU Issue #5360](https://github.com/ollama/ollama/issues/5360) -- Confirms no NPU support in Ollama
- [Ollama ARM64 Performance Issue #8246](https://github.com/ollama/ollama/issues/8246) -- ARM64 performance varies by CPU

---
*Feature research for: Local LLM skill evaluation*
*Researched: 2026-03-08*
