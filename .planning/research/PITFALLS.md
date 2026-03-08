# Domain Pitfalls

**Domain:** Local LLM skill evaluation (replacing cloud graders, adding local agent CLI backends)
**Researched:** 2026-03-08

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or fundamental architecture failures.

### Pitfall 1: Ollama 64K Context Requirement vs 16 GB RAM Budget

**What goes wrong:** Coding agent CLIs (Claude Code, OpenCode) require at least 64K token context windows for reliable operation. But Ollama defaults to only 4,096 tokens regardless of the model's advertised capacity. Developers set `num_ctx: 65536` to satisfy the requirement, then an 8B Q4_K_M model consumes ~5 GB for weights + ~10 GB for KV cache (FP16) at 64K context = **~15 GB total** -- leaving virtually nothing for the OS, Docker, Node.js, and the agent CLI process itself.

**Why it happens:** Ollama's default 4K context is deliberately conservative. The jump from 4K to 64K context causes KV cache memory to grow ~16x. Developers read "at least 64K tokens recommended" in Ollama's docs and comply without calculating the actual memory cost. The KV cache grows linearly with context length.

**Consequences:** System freezes, OOM kills terminating the Ollama process mid-evaluation, or the OS swapping so aggressively that inference drops to near-zero tokens per second. Evaluation trials fail or hang indefinitely. On 16 GB usable RAM this is a hard wall.

**Warning signs:**
- System becomes unresponsive shortly after model loads
- Ollama process killed by OS without error in Ollama logs
- Inference speed drops below 1 token/second (thrashing swap)
- `ollama ps` shows memory usage exceeding 12 GB

**Prevention:**
1. Use KV cache quantization: set `OLLAMA_KV_CACHE_TYPE=q4_0` to reduce KV cache memory by ~75% (64K context with q4_0 KV cache uses ~2.5 GB instead of ~10 GB)
2. Target a practical context window of 16K-32K tokens with q8_0 KV cache instead of 64K with FP16
3. Use smaller models (3B-4B) if full 64K context is truly needed
4. Monitor with `ollama ps` and system memory monitors during initial setup
5. Set memory limits in `.wslconfig` for WSL2 and Docker to prevent runaway consumption

**Detection:** Add a pre-flight memory check before starting evaluations: estimate model weight size + KV cache at configured context length, compare against available RAM, and warn or abort.

**Phase relevance:** Must be addressed in the local LLM grader phase AND the agent CLI backend phase. Every component that touches Ollama needs a memory budget.

**Confidence:** HIGH -- based on Ollama documentation, multiple community reports, and hardware math.

---

### Pitfall 2: LLM-as-Judge Quality Collapse with Small Local Models

**What goes wrong:** The existing `LLMGrader` uses Gemini 2.0 Flash or Claude Sonnet to score agent transcripts against rubrics. Replacing these with a local 7-8B model causes grading quality to degrade significantly: scores become inconsistent, the model fails to follow the JSON output schema, and rubric adherence drops. Cloud models achieve ~80-90% agreement with human evaluators; small local models drop to ~55-68% agreement.

**Why it happens:** Grading (LLM-as-a-Judge) requires the model to read a complex rubric, understand a multi-section transcript (instruction + commands + agent output + prior grader results), reason about quality, and produce structured JSON output. This demands strong instruction-following, long-context comprehension, and reliable structured output -- exactly where small models are weakest. The existing grading prompt is designed for frontier cloud models that have extensive RLHF alignment.

**Consequences:** Grade inflation or deflation, random score variation between identical trials, JSON parsing failures that default to score 0, and loss of trust in evaluation results. The entire value proposition of skill-eval collapses if grades are unreliable.

**Warning signs:**
- Grader returns score 0 frequently due to JSON parse failures
- Same agent output gets wildly different scores across trials
- Scores cluster at extremes (0.0 or 1.0) instead of showing nuance
- `parseResponse()` falls through to the catch block regularly

**Prevention:**
1. Use Ollama's structured output feature (`format` parameter with JSON schema) to enforce the `{"score": number, "reasoning": string}` schema rather than relying on prompt-based JSON extraction
2. Simplify the grading prompt for local models: shorter rubrics, explicit scoring criteria, fewer transcript sections
3. Set temperature to 0 for deterministic grading
4. Validate JSON responses with a schema (Zod) and retry on failure (up to 3 attempts)
5. Calibrate local grader against cloud grader on a held-out set: run both on the same transcripts, compute agreement rate, and only deploy local grader when agreement exceeds 75%
6. Consider a Panel of LLMs (PoLL) approach: run the same transcript through 2-3 different small models and average the scores

**Detection:** Add a "grader validation" mode that runs both cloud and local graders on reference transcripts and reports the correlation coefficient.

**Phase relevance:** Central to the local LLM grader phase. Must be solved before any other phase can trust local grading results.

**Confidence:** HIGH -- based on LLM-as-a-Judge research (Sebastian Raschka, Arize AI, Eugene Yan), Ollama structured outputs documentation, and the existing `parseResponse()` fragility noted in CONCERNS.md.

---

### Pitfall 3: Ollama Streaming + Tool Calling Bug Breaks Agent CLI Agentic Loops

**What goes wrong:** Claude Code and OpenCode rely on Ollama's OpenAI-compatible API (`/v1/chat/completions`) for model communication. When streaming is enabled (the default for interactive CLI use), tool calls are silently dropped -- the model decides to call a tool, but the streaming response returns empty content with `finish_reason: "stop"`, losing the tool call entirely. This breaks the agentic loop that makes coding agents functional.

**Why it happens:** Ollama's native API (`/api/chat`) fully supports streaming + tool calling since May 2025. But the OpenAI compatibility layer at `/v1/chat/completions` has a known bug (ollama/ollama#12557) where tool call chunks are not properly serialized during streaming. Claude Code connects through the Anthropic Messages API compatibility layer, which has similar issues -- the stable Ollama release (as of March 2026) has streaming tool call bugs that break Claude Code's agentic loop.

**Consequences:** The agent CLI appears to work but silently loses tool invocations. Code edits, file reads, and shell commands that the model requests are never executed. The agent produces incomplete or no output. Evaluations score 0 across the board with no obvious error message.

**Warning signs:**
- Agent produces text output but never executes any commands
- `n_commands: 0` in trial results despite the model clearly intending tool use
- Agent "conversations" that describe what they would do but never actually do it
- Works fine with cloud API but fails silently with local Ollama

**Prevention:**
1. Use `ollama launch claude` (v0.15+) which handles API compatibility configuration automatically
2. If configuring manually, use Ollama pre-release (0.14.3-rc1+) or the latest stable where streaming tool call fixes have landed
3. Test tool calling explicitly before running evaluations: send a prompt that requires a tool call and verify the tool call appears in the response
4. As a fallback, configure the agent to use `stream: false` (disable streaming) when using Ollama -- this sacrifices interactive UX but guarantees tool calls work
5. Monitor Ollama GitHub issues #12557, #9632, #10870 for resolution

**Detection:** Add an integration test that sends a known tool-calling prompt to Ollama and verifies the response contains a tool call object, not just text content.

**Phase relevance:** Blocks both the opencode and Claude Code agent CLI phases. Must be validated before starting agent integration work.

**Confidence:** HIGH -- based on multiple GitHub issues (ollama/ollama#12557, #9632, #10870) and community reports from OpenClaw, gptel, and other integrations.

---

### Pitfall 4: Docker x86 Emulation on ARM64 Windows -- Silent Failures and Memory Doubling

**What goes wrong:** The existing skill-eval framework uses Docker containers for task isolation. Task Dockerfiles are typically built for amd64/x86_64. On Windows ARM64 with Docker Desktop, these containers run under QEMU emulation, which is slow, uses ~2x memory, and has known failure modes: filesystem change notifications (inotify) do not work, `sudo` cannot escalate privileges (nosuid), and containers can crash silently.

**Why it happens:** Docker Desktop on Windows ARM64 uses WSL2 with QEMU to emulate x86. QEMU emulation is "best effort" -- Docker's own documentation warns that Intel-based containers on ARM machines "can crash as QEMU sometimes fails to run the container." Most base images used for development (node, ubuntu, python) now offer multi-arch builds, but task-specific Dockerfiles may pull amd64-only dependencies.

**Consequences:** Task environments crash unpredictably, evaluations fail with cryptic QEMU segfaults, memory usage doubles (emulation overhead + WSL2 overhead + Docker overhead), and the already-tight 16 GB RAM budget is blown. Docker Desktop itself may fail to start with "Unexpected WSL error" on some ARM64 configurations.

**Warning signs:**
- Docker Desktop shows "Docker Engine stopped" repeatedly
- Containers exit with signal 11 (SIGSEGV) or signal 4 (SIGILL)
- `wsl --list` fails with "Class not registered"
- Memory usage spikes to 90%+ when starting a single container
- File watchers (nodemon, webpack) don't trigger inside containers

**Prevention:**
1. Use the local provider (not Docker) as the primary execution environment for ARM64 Windows development
2. If Docker is needed, ensure all base images are multi-arch (arm64 native) -- check with `docker inspect --format='{{.Architecture}}' <image>`
3. Set memory limits in `.wslconfig`: `[wsl2]\nmemory=6GB` to prevent WSL2 from consuming all available RAM
4. Reserve Docker-based execution for CI (GitHub Actions runs on x86_64) where it works natively
5. Build task Dockerfiles with `--platform linux/arm64` when targeting local ARM64 development

**Detection:** Add a platform check in the Docker provider that warns when running x86 images on ARM64 and suggests using the local provider.

**Phase relevance:** Affects the CI/CD phase (Docker works fine on x86 runners) and all local development. The local provider fallback must be robust before Docker-dependent features are built.

**Confidence:** HIGH -- based on Docker documentation (known issues page), GitHub issues (docker/for-win#14821), and the project's own constraint documentation.

## Moderate Pitfalls

### Pitfall 5: Ollama Model Unloading Causes Cold Start Latency Between Trials

**What goes wrong:** Ollama unloads models from memory after 5 minutes of inactivity (default `OLLAMA_KEEP_ALIVE=5m`). In skill-eval, there can be long gaps between the grading call and the next trial's agent execution. Each cold reload of a 7B model takes 10-30 seconds on CPU, adding significant overhead to multi-trial evaluations.

**Why it happens:** Ollama's default behavior is designed for interactive use where a user might leave and come back. In an automated evaluation pipeline, the framework may appear "idle" to Ollama during Docker setup, workspace preparation, or agent execution (which does not use the grading model).

**Prevention:**
1. Set `OLLAMA_KEEP_ALIVE=-1` (never unload) during evaluations, restore to `5m` afterward
2. Alternatively, send a lightweight "ping" request to the model between trials to keep it warm
3. Configure via environment variable in the evaluation runner script, not globally

**Detection:** Log model load times; if any exceed 5 seconds, the model was likely cold-loaded.

**Phase relevance:** Affects the local LLM grader phase. Should be configured as part of the evaluation runner setup.

**Confidence:** HIGH -- documented in Ollama FAQ and multiple community sources.

---

### Pitfall 6: Prompt Format Mismatch Between Cloud and Local Models

**What goes wrong:** The existing `LLMGrader` constructs a grading prompt designed for Gemini/Claude -- frontier models with strong instruction following that handle long, multi-section prompts with implicit formatting rules. Local models interpret prompts more literally and have different chat template expectations. The same prompt that produces reliable `{"score": 0.8, "reasoning": "..."}` from Claude produces `Here is my evaluation:\n\nScore: 0.8\nReasoning: The agent...` from a local model.

**Why it happens:** Ollama applies model-specific chat templates (Go templates) that transform prompts before sending to the model. Each model family (Llama, Qwen, Mistral, Phi) has different system prompt handling, different special tokens, and different tendencies for output formatting. Cloud LLM APIs handle this transparently; local models expose the complexity.

**Prevention:**
1. Use Ollama's `format` parameter with JSON schema instead of prompt-based JSON instruction
2. Rewrite the grading prompt for local models: be explicit about output format, include examples (few-shot), use shorter rubrics
3. Test the grading prompt with the specific model being used before deploying -- prompts that work on Qwen may fail on Llama
4. Use the `/api/chat` endpoint with explicit system/user message roles rather than a single concatenated prompt

**Detection:** Add structured output validation; if the JSON extraction regex fails more than 10% of the time, the prompt needs revision for that model.

**Phase relevance:** Directly impacts the local LLM grader phase.

**Confidence:** MEDIUM -- based on Ollama documentation on prompt templates, XDA article on local vs cloud prompting differences, and the project's existing fragile JSON parsing.

---

### Pitfall 7: Agent CLI Environment Variable Conflicts

**What goes wrong:** Claude Code requires `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_API_KEY` to be set for Ollama. OpenCode requires its own `opencode.json` configuration. When running skill-eval, these variables must coexist with the existing `ANTHROPIC_API_KEY` used by the `LLMGrader` for cloud-based grading. Setting `ANTHROPIC_API_KEY=""` (required for Claude Code + Ollama) breaks the cloud LLM grader. Setting it to the real key makes Claude Code try to connect to Anthropic's cloud instead of Ollama.

**Why it happens:** The same environment variable (`ANTHROPIC_API_KEY`) serves two conflicting purposes: authenticating with the real Anthropic API for grading, and being set to empty/dummy for Claude Code to use Ollama instead. The existing code (line 129 of `graders/index.ts`) reads `env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY` -- it will always find the key if it is set globally.

**Consequences:** Either the grader fails (no API key) or the agent CLI connects to the wrong backend (cloud instead of local). Worse, if both are needed simultaneously (local agent + cloud grader for calibration), the conflict is irreconcilable with a single set of environment variables.

**Warning signs:**
- Agent CLI hangs trying to connect to Anthropic cloud when it should use Ollama
- Grader returns "No API key available for LLM grading" even though a key is set
- Evaluations that worked with cloud agents fail when switching to local agents

**Prevention:**
1. Use separate, namespaced environment variables: `GRADER_ANTHROPIC_API_KEY` for the grader, let `ollama launch` handle agent CLI configuration
2. Use `ollama launch claude` (v0.15+) which sets agent-specific env vars without polluting the global environment
3. In the evaluation runner, set agent env vars only for the agent subprocess scope (child process env), not process-wide
4. When both local agent and cloud grader are needed, pass the grader API key explicitly in the grader configuration, not through environment variables

**Detection:** Add a startup check that detects conflicting environment variable configurations and warns the user.

**Phase relevance:** Must be resolved when designing the local LLM grader and agent CLI integration. Architectural decision needed early.

**Confidence:** HIGH -- directly observable from the existing source code (`src/graders/index.ts` lines 128-142, `src/agents/claude.ts`).

---

### Pitfall 8: GitHub Actions CI Cannot Run Local LLM Inference

**What goes wrong:** Developers expect to run the full evaluation pipeline (local agent + local grader) in GitHub Actions CI. Standard GitHub-hosted runners have 7 GB RAM, no GPU, and limited CPU -- nowhere near enough to load and run even a small 3B model. Model downloads (2-5 GB) add minutes to each CI run, and Docker Hub rate limits can block model image pulls.

**Why it happens:** GitHub-hosted runners are designed for build/test workloads, not inference. There is no GPU passthrough, and RAM is shared with the runner OS and Docker daemon. The new (March 2026) per-minute platform fee for self-hosted runners ($0.002/min) adds cost to long-running evaluation jobs.

**Prevention:**
1. Design CI to run deterministic graders only -- shell-based `test.sh` scripts that do not need LLM inference
2. Use the existing cloud LLM grader (`GEMINI_API_KEY` / `ANTHROPIC_API_KEY` as secrets) for CI LLM grading
3. Keep local LLM evaluation as a developer-only workflow, not a CI requirement
4. If CI-based LLM evaluation is needed later, use self-hosted runners with adequate hardware or Ollama Cloud
5. Cache model files between CI runs using GitHub Actions cache (saves download time but not inference cost)

**Detection:** CI job fails with OOM or hangs indefinitely during model loading -- add a timeout and clear error message.

**Phase relevance:** Must be addressed in the CI/CD phase. The CI architecture should separate deterministic validation (CI-friendly) from LLM evaluation (local-only).

**Confidence:** HIGH -- based on GitHub-hosted runner specs, Ollama memory requirements, and multiple CI/Ollama integration guides.

---

### Pitfall 9: Ollama on Windows ARM64 -- CPU-Only, No NPU/GPU Acceleration

**What goes wrong:** Developers on Snapdragon X Elite expect the NPU (45 TOPS) or Adreno GPU to accelerate inference. Ollama uses only CPU on ARM64 Windows. All 45 TOPS of NPU compute sit idle. Inference speed for a 7B Q4 model is roughly 5-10 tokens/second on CPU, compared to 40-120 tokens/second with GPU acceleration on x86 systems.

**Why it happens:** Ollama's backend (llama.cpp/ggml) supports CUDA and Metal for GPU acceleration but has no DirectML, Vulkan, or Qualcomm QNN backend for ARM64 Windows. The Snapdragon NPU is designed for ONNX INT4/INT8 models via Qualcomm AI Engine Direct, not GGUF models. There is no common model format that works for both Ollama (GGUF) and the NPU (ONNX QDQ).

**Consequences:** Evaluation speed is 10-20x slower than comparable x86+GPU setups. A single trial with an 8B model grader + 8B model agent could take 30-60 minutes instead of 2-5 minutes. Running 10 trials becomes a multi-hour affair.

**Warning signs:**
- `ollama ps` shows 0% GPU utilization
- Token generation speed consistently below 10 tok/s
- Evaluation wall clock time seems unreasonably long

**Prevention:**
1. Accept CPU-only performance and optimize for throughput: use smaller models (3-4B), shorter context windows, and simplified prompts
2. For the grading task specifically, consider ONNX Runtime with QNN ExecutionProvider as an alternative inference path that CAN use the NPU (requires model conversion to ONNX QDQ format)
3. Set realistic expectations: plan for 5-10 tok/s on CPU, budget 3-5 minutes per grading call, set agent timeouts accordingly
4. Consider Ollama Cloud as a hybrid: run the agent locally but grade in the cloud for speed during development

**Detection:** Log tokens-per-second during inference; compare against expected baseline.

**Phase relevance:** Affects all phases that involve local LLM inference. Must be factored into timeout configurations and developer workflow expectations.

**Confidence:** HIGH -- based on Ollama GitHub issue #5360, Qualcomm developer blog, and firsthand reports of Snapdragon X Elite inference performance.

## Minor Pitfalls

### Pitfall 10: Ollama Context Window Silent Truncation

**What goes wrong:** Even when `num_ctx` is configured, if the input prompt exceeds the context window, Ollama silently truncates older parts of the conversation. The grading prompt (rubric + full transcript) can easily exceed 8K-16K tokens for complex tasks, causing the model to lose critical context (like the rubric itself) and produce meaningless scores.

**Prevention:**
1. Estimate prompt token count before sending to Ollama (use the existing `estimateTokens()` function from `evalRunner.ts`)
2. If the prompt exceeds 80% of the configured context window, truncate the transcript (not the rubric) with a clear marker: "[...transcript truncated...]"
3. Log a warning when truncation occurs

**Phase relevance:** Local LLM grader phase.

**Confidence:** HIGH -- documented Ollama behavior.

---

### Pitfall 11: Model Compatibility with Tool Calling

**What goes wrong:** Not all Ollama models support tool calling (function calling). Using a model without tool support as an agent backend results in the model describing what it would do rather than actually invoking tools. OpenCode requires explicit `"tools": true` in its model configuration.

**Prevention:**
1. Maintain a tested model compatibility matrix: which models support tool calling, which work with Claude Code, which work with OpenCode
2. Add a model capability check at startup: query `ollama show <model>` and verify tool support before proceeding
3. Start with known-good models: qwen3-coder, glm-4.7-flash for tool calling; use dedicated judge models for grading

**Phase relevance:** Agent CLI backend phases (opencode first, Claude Code second).

**Confidence:** MEDIUM -- based on Ollama documentation and OpenCode configuration guides.

---

### Pitfall 12: ONNX Runtime QNN Binary Incompatibility on Snapdragon

**What goes wrong:** If pursuing NPU-accelerated inference via ONNX Runtime + QNN ExecutionProvider as an alternative to Ollama, developers encounter `QNN_COMMON_ERROR_INCOMPATIBLE_BINARIES` errors. The QNN SDK version must exactly match the ONNX Runtime build. Additionally, `cpuinfo` may not recognize newer Snapdragon chips (X1E78100), and the x64 package must be used for quantization while the ARM64 package is used for inference.

**Prevention:**
1. Pin exact versions: match QNN SDK version to the ONNX Runtime QNN wheel version documented in the release notes
2. Use x64 for model quantization/conversion, ARM64 for inference -- do not mix
3. Consider Windows ML as a higher-level abstraction that handles EP selection and version management automatically
4. This path is significantly more complex than Ollama CPU-only -- only pursue if NPU acceleration is a hard requirement

**Phase relevance:** Out of scope for initial phases. Relevant only if CPU-only performance proves unacceptable and NPU acceleration is attempted later.

**Confidence:** MEDIUM -- based on ONNX Runtime GitHub issue #26163, Qualcomm AI Hub documentation, and Microsoft Windows ML announcement.

---

### Pitfall 13: Sequential Resource Contention Between Ollama, Docker, and Agent CLI

**What goes wrong:** Even with sequential execution, running Ollama (grading model loaded in RAM) + Docker Desktop (WSL2 VM overhead) + Agent CLI (Node.js + potentially another Ollama model for the agent) simultaneously exceeds 16 GB. The system grinds to a halt from memory pressure even though only one "task" runs at a time.

**Prevention:**
1. Unload the grading model before running the agent, and vice versa (use `OLLAMA_KEEP_ALIVE=0` or explicit model unload API call)
2. Use the same model for both grading and agent tasks if possible (stays loaded)
3. Profile total system memory usage during a complete evaluation cycle and identify the peak
4. Consider using the local provider instead of Docker to eliminate WSL2/Docker overhead (~2-4 GB savings)
5. Set `OLLAMA_MAX_LOADED_MODELS=1` to prevent multiple models competing for RAM

**Phase relevance:** Integration testing phase when agent + grader + Docker are all wired together.

**Confidence:** HIGH -- based on hardware constraints (16 GB usable) and typical process memory footprints.

---

### Pitfall 14: Model Download and First-Run Latency in Developer Workflow

**What goes wrong:** First-time setup requires pulling Ollama models (2-5 GB each), which takes 5-30 minutes depending on network speed. Developers expect `npm run eval` to "just work" and are frustrated when the first run hangs waiting for a model download. Additionally, model updates may change behavior silently.

**Prevention:**
1. Add a `npm run setup:models` script that pulls required models and validates they work
2. Document exact model names and versions (including quantization tags) in a `models.json` config file
3. Pin model versions using Ollama's digest-based pulling to prevent silent updates
4. Add a pre-eval check that verifies required models are available locally before starting

**Phase relevance:** Developer experience setup phase.

**Confidence:** MEDIUM -- common complaint in Ollama community.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| CI/CD setup | CI runners lack resources for LLM inference (Pitfall 8) | Separate deterministic CI tests from LLM evaluation; use cloud grader in CI |
| Local LLM grader | Quality degradation vs cloud models (Pitfall 2) | Structured outputs, calibration against cloud baseline, simplified prompts |
| Local LLM grader | Memory budget blown by context window (Pitfall 1) | KV cache quantization, practical context limits, memory pre-flight checks |
| Local LLM grader | Prompt format mismatch (Pitfall 6) | Model-specific prompt templates, structured output enforcement |
| Local LLM grader | Env var conflicts with agent config (Pitfall 7) | Namespaced env vars, subprocess-scoped configuration |
| OpenCode agent | Ollama streaming + tool call bug (Pitfall 3) | Use latest Ollama, test tool calling explicitly, disable streaming as fallback |
| OpenCode agent | Model lacks tool support (Pitfall 11) | Compatibility matrix, capability checks at startup |
| OpenCode agent | 64K context vs RAM budget (Pitfall 1) | KV cache quantization, smaller models, practical context limits |
| Claude Code agent | Streaming tool call regression (Pitfall 3) | Use `ollama launch claude`, pre-release Ollama builds, integration test |
| Claude Code agent | Env var conflicts (Pitfall 7) | `ollama launch` handles this; manual config needs careful scoping |
| Docker isolation | QEMU emulation failures on ARM64 (Pitfall 4) | Prefer local provider; use ARM64-native images; reserve Docker for CI |
| Integration testing | Memory contention between components (Pitfall 13) | Single model for both roles, explicit model unloading, profile peak memory |
| NPU acceleration (future) | ONNX binary incompatibility (Pitfall 12) | Pin SDK versions, use Windows ML abstraction, defer until needed |

## Sources

### Ollama Documentation and Issues
- [Ollama FAQ](https://docs.ollama.com/faq) -- default context, keep-alive, memory settings
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs) -- JSON schema enforcement
- [Ollama Claude Code Integration](https://docs.ollama.com/integrations/claude-code) -- env vars, model requirements
- [Ollama Launch Blog](https://ollama.com/blog/launch) -- zero-config agent CLI setup
- [Ollama OpenCode Integration](https://docs.ollama.com/integrations/opencode) -- configuration, context window
- [ollama/ollama#5360](https://github.com/ollama/ollama/issues/5360) -- Snapdragon NPU/GPU support request
- [ollama/ollama#12557](https://github.com/ollama/ollama/issues/12557) -- Streaming + tool calling broken on OpenAI compat
- [ollama/ollama#9632](https://github.com/ollama/ollama/issues/9632) -- Tool calling streaming not working
- [ollama/ollama#10870](https://github.com/ollama/ollama/issues/10870) -- Full streaming tool call lifecycle request
- [ollama/ollama#10114](https://github.com/ollama/ollama/issues/10114) -- Memory leak under load
- [ollama/ollama#7266](https://github.com/ollama/ollama/issues/7266) -- ARM64 model loading failure

### ARM64 and Snapdragon
- [Qualcomm: Ollama on Windows on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) -- official partnership, CPU-only
- [Running Local LLMs on Snapdragon X Elite](https://vcfvct.wordpress.com/2025/12/31/running-local-llms-on-a-snapdragon-x-elite-surface-laptop-7-my-journey-to-real-npu-acceleration/) -- firsthand experience, NPU vs CPU
- [Qualcomm: Ollama Simplifies Inference on Snapdragon X](https://www.qualcomm.com/developer/blog/2024/10/ollama-simplifies-inference-open-sources-models-snapdragon-x-series-devices)

### ONNX Runtime and NPU
- [ONNX Runtime QNN ExecutionProvider](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html) -- QNN backend setup
- [onnxruntime#26163](https://github.com/microsoft/onnxruntime/issues/26163) -- Incompatible binary error on ARM64
- [Windows ML Announcement](https://blogs.windows.com/windowsdeveloper/2025/05/19/introducing-windows-ml-the-future-of-machine-learning-development-on-windows/)

### Docker on ARM64
- [Docker Known Issues](https://docs.docker.com/desktop/troubleshoot-and-support/troubleshoot/known-issues/) -- QEMU emulation warnings
- [docker/for-win#14821](https://github.com/docker/for-win/issues/14821) -- WSL error on Snapdragon

### LLM-as-a-Judge Research
- [Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/) -- agreement rates, biases
- [Grading Scale Impact on LLM-as-a-Judge](https://arxiv.org/html/2601.03444v1) -- scale affects judge quality
- [Local LLM-as-Judge with Prometheus](https://blog.mozilla.ai/local-llm-as-judge-evaluation-with-lm-buddy-prometheus-and-llamafile/) -- open-source judge models
- [Replacing the Judge: Llama 405B vs GPT-4](https://sambanova.ai/blog/can-llama-405b-outperform-gpt4) -- open-weight judge accuracy

### GitHub Actions and CI
- [CI for AI: Running Ollama in GitHub Actions](https://collabnix.com/ci-for-ai-running-ollama-llms-in-github-actions-with-open-source-tools)
- [Ollama in GitHub Actions (Actuated)](https://actuated.com/blog/ollama-in-github-actions) -- self-hosted runner approach
- [GitHub Actions Pricing Changes 2026](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)

### Memory and Performance
- [Ollama VRAM Requirements Guide](https://localllm.in/blog/ollama-vram-requirements-for-local-llms) -- model size vs memory
- [Ollama Tuning Guide: RAM Management](https://github.com/jameschrisa/Ollama_Tuning_Guide/blob/main/docs/ram-management.md) -- KV cache, quantization
- [Troubleshooting Ollama Performance](https://deepwiki.com/ollama/ollama/6.4-troubleshooting-and-performance)

---

*Pitfalls research: 2026-03-08*
