# Architecture Patterns

**Domain:** Local LLM skill evaluation system
**Researched:** 2026-03-08

## Recommended Architecture

The system extends an existing evaluation pipeline (skill-eval) by replacing cloud LLM API calls with local LLM inference via Ollama, and by adding local LLM backends for agent CLIs (opencode, Claude Code). The architecture has five layers with two new integration surfaces (Ollama Server and Agent CLI Configurator) that slot into the existing pipeline without restructuring it.

### High-Level Component Diagram

```
+------------------+     +---------------------+     +-------------------+
|                  |     |                     |     |                   |
|  CLI Layer       |---->|  EvalRunner         |---->|  Reporters /      |
|  (src/cli.ts)    |     |  (Orchestration)    |     |  Analytics        |
|                  |     |                     |     |                   |
+------------------+     +----------+----------+     +-------------------+
                                    |
                    +---------------+---------------+
                    |               |               |
            +-------v------+ +-----v------+ +------v-------+
            |              | |            | |              |
            |  Agents      | | Providers  | |  Graders     |
            |  (gemini,    | | (docker,   | |  (det.,      |
            |   claude,    | |  local)    | |   llm_rubric)|
            |   opencode)  | |            | |              |
            +--------------+ +------------+ +------+-------+
                    |                              |
                    |                              |
            +-------v------------------------------v-------+
            |                                              |
            |           Ollama Server (localhost:11434)     |
            |           - /v1/messages (Anthropic compat)  |
            |           - /v1/chat/completions (OpenAI)    |
            |           - /api/chat (native)               |
            |                                              |
            +----------------------------------------------+
                    |
            +-------v--------------------------------------+
            |  Local Models (GGUF, quantized Q4/Q5)        |
            |  - qwen3-coder, glm-4.7-flash, etc.         |
            +----------------------------------------------+
```

### Component Boundaries

| Component | Responsibility | Communicates With | Integration Surface |
|-----------|---------------|-------------------|---------------------|
| CLI Layer | Parse args, load env, discover tasks, coordinate runs | EvalRunner, Agents, Providers | Process args, env vars |
| EvalRunner | Run trials, aggregate scores, save reports | Agents, Providers, Graders | In-process TypeScript calls |
| Agents (existing) | Wrap cloud-backed Gemini/Claude CLIs | Provider.runCommand() | Child process (bash) |
| Agents (new: opencode) | Wrap opencode CLI with local LLM backend | Provider.runCommand(), Ollama (indirect via opencode config) | Child process + opencode.json config |
| Agents (new: claude-local) | Wrap Claude Code CLI with local LLM backend | Provider.runCommand(), Ollama (indirect via env vars) | Child process + ANTHROPIC_BASE_URL env |
| Providers | Isolate task execution (Docker/local) | Filesystem, Docker API | Docker socket, temp dirs |
| Graders (deterministic) | Run shell scripts, read exit codes | Provider.runCommand() | Shell scripts |
| Graders (LLM rubric - existing) | Call Gemini/Anthropic cloud APIs to score | Cloud API endpoints | HTTPS fetch |
| Graders (LLM rubric - new) | Call Ollama to score agent output against rubric | Ollama `/v1/chat/completions` or `/v1/messages` | HTTP fetch to localhost:11434 |
| Ollama Server | Serve local models, manage model lifecycle | Filesystem (model storage), CPU/NPU | REST API (3 protocol surfaces) |
| Ollama Launcher | Configure agent CLIs for local LLM usage | Agent CLI config files, env vars | `ollama launch` command or manual config |

### Data Flow

**Evaluation Flow (unchanged outer loop, modified inner components):**

```
1. CLI → parse args, load .env
      ↓
2. Task Discovery → find task, read task.toml + instruction.md
      ↓
3. Ollama Health Check → verify server at localhost:11434 (NEW)
      ↓
4. Provider.prepare() → build Docker image or init local workspace
      ↓
5. Per-Trial Loop:
   a. Provider.setup() → create isolated workspace
   b. Agent.run(instruction, workspace, runCommand)
      - For opencode: runs `opencode` CLI (reads opencode.json pointing to Ollama /v1)
      - For claude-local: runs `claude` CLI (ANTHROPIC_BASE_URL=http://localhost:11434)
      - Agent CLI ↔ Ollama Server (model inference, tool calling)
   c. Graders score workspace:
      - DeterministicGrader: runs test.sh → exit code / reward.txt
      - LocalLLMGrader: POST transcript to Ollama /v1/chat/completions (NEW)
        → Ollama loads model if not cached → inference → JSON score response
   d. EvalRunner calculates weighted reward
   e. Provider.cleanup() → remove workspace
      ↓
6. Provider.teardown() → remove Docker image
      ↓
7. Report: sanitize secrets, save JSON to results/
      ↓
8. Display: CLI table, pass_rate, pass@k metrics
```

**Ollama Server Lifecycle (NEW - managed externally or by framework):**

```
1. Server Start: `ollama serve` or via `ollama launch <agent>`
   - Binds to OLLAMA_HOST (default: localhost:11434)
   - Initializes model registry from ~/.ollama/models
      ↓
2. Health Check: GET / → 200 "Ollama is running"
   - Deeper check: GET /api/tags → lists available models
      ↓
3. Model Loading (lazy, on first request):
   - First request triggers model load into RAM
   - Quantized model loaded from GGUF file
   - stay_alive: model stays in memory for `keep_alive` duration (default 5m)
      ↓
4. Inference: POST /v1/chat/completions or /v1/messages
   - Request queued → model manager → inference engine → response
   - Streaming by default (NDJSON for native, SSE for Anthropic compat)
      ↓
5. Model Unload: after `keep_alive` timeout with no requests
   - Frees RAM for other processes (agent CLI, Docker, Node.js)
      ↓
6. Server Stop: Ctrl+C or process signal
```

**Local LLM Grader Data Flow (NEW - replaces cloud LLM grader):**

```
Session Transcript (instruction + commands + agent output + prior grader results)
      ↓
Build prompt: rubric + transcript + "Respond with JSON {score, reasoning}"
      ↓
POST http://localhost:11434/v1/chat/completions
  {
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": prompt}],
    "stream": false,
    "options": {"temperature": 0, "num_ctx": 16384}
  }
      ↓
Response: {"choices": [{"message": {"content": "{\"score\": 0.8, \"reasoning\": \"...\"}"}}]}
      ↓
Parse JSON → GraderResult { grader_type: "llm_rubric", score: 0.8, details: "..." }
```

## Patterns to Follow

### Pattern 1: Adapter Pattern for Local LLM Grading

The existing `LLMGrader` makes direct HTTP calls to Gemini/Anthropic APIs. Rather than modifying it, create a `LocalLLMGrader` that implements the same `Grader` interface but targets Ollama's OpenAI-compatible endpoint. This preserves the existing cloud grader for users who want it and adds local grading as a new option.

**What:** New grader type `local_llm_rubric` that calls Ollama instead of cloud APIs.
**When:** Task configuration specifies `type = "local_llm_rubric"` in task.toml.
**Why:** The OpenAI-compatible `/v1/chat/completions` endpoint is the most stable and well-tested Ollama surface. It does not require Anthropic translation, which has known issues with unsupported endpoints (`/v1/messages/count_tokens`).

```typescript
export class LocalLLMGrader implements Grader {
    async grade(
        _workspace: string,
        _provider: EnvironmentProvider,
        config: GraderConfig,
        taskPath: string,
        sessionLog: any[],
        env?: Record<string, string>
    ): Promise<GraderResult> {
        // Build prompt identical to existing LLMGrader
        const prompt = this.buildPrompt(config, taskPath, sessionLog);

        // Call Ollama's OpenAI-compatible endpoint
        const ollamaHost = env?.OLLAMA_HOST || 'http://localhost:11434';
        const model = config.model || 'qwen3-coder';
        const response = await fetch(`${ollamaHost}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                stream: false,
                temperature: 0,
            })
        });

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';
        return this.parseResponse(text, config);
    }
}
```

### Pattern 2: Agent CLI Configurator (Environment-Based)

Agent CLIs (opencode, Claude Code) are external processes that the framework invokes via `runCommand()`. The framework does not control their internal LLM routing -- it controls the environment they run in. Use environment variables and config files to redirect agent CLIs to Ollama.

**What:** Before running an agent CLI, inject the correct environment variables and configuration files into the workspace.
**When:** Agent type is `opencode` or `claude-local` and `--provider=local`.
**Why:** This matches the `ollama launch` pattern -- it is the documented way these tools discover local backends.

```typescript
// For Claude Code with local LLM:
// Set env vars that redirect Claude Code to Ollama
const agentEnv = {
    ...env,
    ANTHROPIC_BASE_URL: 'http://localhost:11434',
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_API_KEY: '',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
};

// For opencode with local LLM:
// Write opencode.json config to workspace before running
const opencodeConfig = {
    "$schema": "https://opencode.ai/config.json",
    provider: {
        ollama: {
            npm: "@ai-sdk/openai-compatible",
            name: "Ollama",
            options: { baseURL: "http://localhost:11434/v1" },
            models: {
                [modelName]: { name: modelName }
            }
        }
    }
};
```

### Pattern 3: Ollama Health Gate

Before any evaluation run, verify that the Ollama server is running and the required model is available. Fail fast with a clear error message rather than timing out mid-trial.

**What:** Pre-flight check at evaluation start.
**When:** Any grader or agent requires Ollama.
**Why:** Local LLM inference is slow (seconds per request on CPU). A health check that fails fast saves minutes of wasted trial execution.

```typescript
async function checkOllamaHealth(host: string, model: string): Promise<void> {
    // Step 1: Server alive?
    const alive = await fetch(`${host}/`).catch(() => null);
    if (!alive || !alive.ok) {
        throw new Error(`Ollama server not responding at ${host}. Run 'ollama serve' first.`);
    }

    // Step 2: Model available?
    const tags = await fetch(`${host}/api/tags`).then(r => r.json());
    const available = tags.models?.map((m: any) => m.name) || [];
    if (!available.some((name: string) => name.startsWith(model))) {
        throw new Error(
            `Model '${model}' not found. Available: ${available.join(', ')}. Run 'ollama pull ${model}'.`
        );
    }
}
```

### Pattern 4: Sequential Resource Management

On 16 GB RAM with CPU inference, the Ollama server, loaded model, Docker/local workspace, and agent CLI all compete for memory. Use sequential execution with explicit model lifecycle control.

**What:** Never run agent inference and grader inference concurrently. Use Ollama's `keep_alive` parameter to control when models are unloaded.
**When:** Always on this hardware target.
**Why:** A loaded Q4-quantized 8B model uses ~5-6 GB RAM. Docker + Node.js + agent CLI uses ~3-4 GB. Only ~6-7 GB headroom remains.

```typescript
// During grading: agent is done, its model can be unloaded
// Grader request can use keep_alive: "0" to unload immediately after scoring
const response = await fetch(`${ollamaHost}/v1/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({
        model: graderModel,
        messages: [...],
        stream: false,
        keep_alive: "0"  // Unload after this request
    })
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared Model for Agent and Grader

**What:** Using the same Ollama model instance for both the agent CLI (via opencode/claude) and the LLM grader.
**Why bad:** The grader evaluates the agent's work. If both use the same model, the grader is biased toward the patterns the agent produces. Additionally, a single model loaded in memory means no concurrency is possible even in theory.
**Instead:** Use different models for agent and grader when possible. At minimum, document that grading with the same model that generated the output is inherently less reliable than cloud LLM grading.

### Anti-Pattern 2: Embedded Inference (No Server)

**What:** Using `@huggingface/transformers` for in-process ONNX/WebAssembly inference instead of a separate Ollama server.
**Why bad:** Locks the Node.js process during inference (CPU-bound). Cannot be shared between the grader and agent CLI. Model loading overhead repeated per process. WebAssembly inference on ARM64 Windows is poorly tested.
**Instead:** Use Ollama server (separate process). It manages model lifecycle, supports multiple clients, and has established ARM64 Windows support via Qualcomm partnership.

### Anti-Pattern 3: Running GPU-Expecting Models on CPU

**What:** Pulling large models (70B, 120B) or non-quantized models that expect GPU acceleration.
**Why bad:** On this hardware (Snapdragon X Elite, CPU-only inference), a 70B Q4 model would need ~40 GB RAM (impossible on 16 GB usable). Even 14B Q4 at ~8 GB is risky with other processes running.
**Instead:** Target 7-8B Q4/Q5 quantized models. These use ~5-6 GB RAM and produce ~5-15 tokens/sec on ARM64 CPU -- usable for grading (small output) if not for interactive coding.

### Anti-Pattern 4: Modifying the Existing LLMGrader

**What:** Adding Ollama support directly into the existing `LLMGrader` class alongside Gemini/Anthropic.
**Why bad:** Violates single responsibility. The existing class already has conditional logic (`if apiKey... else if anthropicKey...`). Adding a third branch makes the fallback chain brittle. Different error handling (network vs. localhost timeout). Different response formats.
**Instead:** Create a new `LocalLLMGrader` class and register it under a new type in `getGrader()`. This keeps the cloud and local paths clean and independently testable.

## Integration Architecture: How Components Connect

### Ollama as Central Hub

Ollama serves as the single local LLM server that both the grader and agent CLIs consume. However, they consume it through different protocol surfaces:

| Consumer | Ollama Endpoint | Protocol | Why This Surface |
|----------|----------------|----------|------------------|
| LocalLLMGrader | `/v1/chat/completions` | OpenAI-compatible | Most stable, well-tested. Simplest integration from Node.js fetch. |
| Claude Code agent | `/v1/messages` | Anthropic-compatible | Claude Code speaks Anthropic Messages API natively. Ollama v0.14+ translates. |
| opencode agent | `/v1/chat/completions` | OpenAI-compatible | opencode uses `@ai-sdk/openai-compatible` package. |

This means: the grader and opencode use the same endpoint, while Claude Code uses a different one. All hit the same Ollama server and can use the same loaded model (but should use different models for agent vs. grader per the anti-pattern above).

### Agent CLI Integration Architecture

```
+---------------------------+     +---------------------------+
| opencode CLI              |     | Claude Code CLI           |
|                           |     |                           |
| Reads: opencode.json      |     | Reads: env vars           |
|   provider.ollama         |     |   ANTHROPIC_BASE_URL      |
|   baseURL: :11434/v1      |     |   ANTHROPIC_AUTH_TOKEN    |
|                           |     |                           |
| Calls: /v1/chat/          |     | Calls: /v1/messages       |
|   completions             |     |                           |
+-------------+-------------+     +-------------+-------------+
              |                                 |
              +----------------+----------------+
                               |
                    +----------v----------+
                    |   Ollama Server     |
                    |   localhost:11434   |
                    |                    |
                    |   Model: qwen3-   |
                    |   coder (agent)    |
                    +--------------------+
```

### GitHub Actions CI Architecture

For CI evaluation runs, two approaches are viable. Use the simpler one first (GitHub-hosted + small model), graduate to self-hosted when model size or speed requires it.

**Approach 1: GitHub-Hosted Runner (CPU-only, small models)**

```yaml
name: skill-eval
on: [push, pull_request]
jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: ai-action/setup-ollama@v2

      - uses: actions/cache@v5
        with:
          path: ~/.ollama
          key: ${{ runner.os }}-ollama-${{ hashFiles('tasks/**/task.toml') }}

      - name: Pull grader model
        run: ollama pull qwen3:8b

      - name: Pull agent model
        run: ollama pull qwen3-coder

      - uses: actions/setup-node@v4
        with:
          node-version: '24'

      - run: npm ci

      - name: Validate graders
        run: npm run validate -- superlint_demo --provider=local

      - name: Run evaluation
        run: npm run eval -- superlint_demo --agent=opencode --provider=local --trials=3

      - uses: actions/upload-artifact@v4
        with:
          name: eval-results
          path: results/
```

**Approach 2: Self-Hosted Runner (GPU or high-RAM, larger models)**

Required when models exceed GitHub-hosted runner limits (14 GB RAM, 7 GB disk for models). The runner machine runs `ollama serve` as a persistent service; the workflow connects to it.

```yaml
jobs:
  evaluate:
    runs-on: [self-hosted, ollama]
    steps:
      - uses: actions/checkout@v4
      # Ollama already running on self-hosted runner
      - name: Verify Ollama
        run: curl -f http://localhost:11434/ || (echo "Ollama not running" && exit 1)
      # ... rest of workflow
```

**Key consideration:** GitHub-hosted runners have ~14 GB RAM and ~14 GB disk. A Q4 8B model is ~5 GB to store and ~6 GB in RAM. This works but leaves little headroom. Cache the model in `~/.ollama` to avoid re-downloading on every run (model pulls are 5+ GB).

### Context Window Configuration

Both agent CLIs and the grader need adequate context windows. The default Ollama context of 2048 tokens is far too small.

**For agent CLIs:** 64K tokens recommended by both OpenCode and Claude Code docs. Create a custom Modelfile:

```
FROM qwen3-coder
PARAMETER num_ctx 65536
```

Then: `ollama create qwen3-coder-64k -f Modelfile`

**For the grader:** The transcript (instruction + commands + output + rubric) typically fits in 8-16K tokens. Use `num_ctx: 16384` via the API `options` parameter in each request. This avoids pre-creating a custom model and uses less RAM than 64K context.

**RAM impact:** Context window directly affects memory usage. At Q4 quantization, a 7B model uses roughly:
- 2K context: ~5 GB
- 16K context: ~6 GB
- 64K context: ~9 GB

On 16 GB usable RAM, a 64K context agent model leaves only ~7 GB for everything else (Node.js, Docker, the grader model). This is tight. Plan for the agent model to be unloaded before the grader model loads.

## Suggested Build Order

Based on dependency analysis, the components should be built in this order:

### Phase 1: Ollama Health Check + Local LLM Grader

**Dependencies:** None (Ollama already installed per project constraints).
**Rationale:** The grader is the smallest, most contained integration point. It replaces a single `fetch()` call to cloud APIs with a `fetch()` to localhost. It can be tested independently of agent CLIs. It validates that Ollama is working correctly on the target hardware.

Build:
1. Ollama health check utility (`checkOllamaHealth()`)
2. `LocalLLMGrader` class implementing `Grader` interface
3. Register `local_llm_rubric` type in `getGrader()`
4. Test with existing `superlint_demo` task (change `llm_rubric` to `local_llm_rubric` in task.toml)

### Phase 2: opencode Agent Integration

**Dependencies:** Phase 1 (health check, confidence that Ollama works).
**Rationale:** opencode has simpler configuration (JSON file) than Claude Code (environment variables + Anthropic API translation). Both use Ollama's OpenAI-compatible endpoint. Building opencode first builds confidence.

Build:
1. `OpenCodeAgent` class extending `BaseAgent`
2. opencode.json configuration writer (generates config pointing to Ollama)
3. Register `opencode` agent type in CLI
4. Test with `superlint_demo` task

### Phase 3: Claude Code Local Agent Integration

**Dependencies:** Phase 2 (agent pattern established).
**Rationale:** Claude Code requires Ollama's Anthropic Messages API compatibility (`/v1/messages`), which is newer (v0.14+) and has known issues (unsupported `count_tokens` endpoint). It also requires environment variable injection rather than config file generation.

Build:
1. `ClaudeLocalAgent` class extending `BaseAgent` (or modify existing `ClaudeAgent` to accept local backend config)
2. Environment variable injection for `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`
3. Test with `superlint_demo` task

### Phase 4: GitHub Actions CI

**Dependencies:** Phases 1-3 (all components working locally).
**Rationale:** CI is the validation layer. It should be built after the components it validates are working. Uses `ai-action/setup-ollama@v2` for Ollama installation and `actions/cache@v5` for model caching.

Build:
1. Basic workflow: checkout, setup Node.js, setup Ollama, npm ci
2. Validation job: `npm run validate` with local LLM grader
3. Evaluation job: `npm run eval` with opencode agent
4. Artifact upload for eval results

### Phase 5: `ollama launch` Integration (Optional Enhancement)

**Dependencies:** Phases 2-3 (agent integrations).
**Rationale:** `ollama launch` automates what Phases 2-3 do manually (set env vars, write config). It is a convenience wrapper. Useful for local development but not for CI (where explicit configuration is preferred).

Build:
1. Document `ollama launch opencode` and `ollama launch claude` as alternative setup
2. Optionally add `--setup=ollama-launch` flag to CLI that delegates to `ollama launch`

## Scalability Considerations

| Concern | 1 task, 1 trial | 5 tasks, 3 trials each | Suite of 20 tasks |
|---------|-----------------|------------------------|-------------------|
| RAM pressure | Manageable. One model loaded. | Risk: agent + grader models both loaded. Mitigate with keep_alive: "0". | High risk. Must sequence tasks. Unload models between tasks. |
| Inference time | 30-120s per grader call (CPU). Acceptable for 1 trial. | 15-60 min total. Sequential only. | 2-8 hours. Consider CI offload. |
| Disk space | ~5 GB per model. One model fits. | Same if reusing models. | Same. Model storage is static. |
| CI cost | Free tier (GitHub-hosted). | Free tier works but slow. | Self-hosted or scheduled nightly runs. |

## Sources

- [Ollama API Documentation](https://docs.ollama.com/api/introduction) - HIGH confidence
- [Ollama Anthropic Compatibility](https://docs.ollama.com/api/anthropic-compatibility) - HIGH confidence
- [Ollama OpenAI Compatibility](https://docs.ollama.com/api/openai-compatibility) - HIGH confidence
- [Ollama Claude Code Integration](https://docs.ollama.com/integrations/claude-code) - HIGH confidence
- [Ollama OpenCode Integration](https://docs.ollama.com/integrations/opencode) - HIGH confidence
- [Ollama Launch Blog Post](https://ollama.com/blog/launch) - HIGH confidence
- [OpenCode Providers Documentation](https://opencode.ai/docs/providers/) - HIGH confidence
- [ai-action/setup-ollama GitHub Action](https://github.com/ai-action/setup-ollama) - HIGH confidence
- [Qualcomm Ollama on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) - MEDIUM confidence (performance claims unverified on specific hardware)
- [Ollama Modelfile Reference](https://docs.ollama.com/modelfile) - HIGH confidence

---

*Architecture research: 2026-03-08*
