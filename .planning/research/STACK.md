# Stack Research

**Domain:** Local LLM inference for skill evaluation grading + agent CLI backends
**Researched:** 2026-03-08
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **ollama** (server) | v0.17.7 | Local LLM server: model management, inference, API endpoints | De facto standard for local LLM serving. Native ARM64 Windows build. CPU inference on Snapdragon X Elite works. Exposes both OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints -- the latter added in v0.14.0, eliminating the need for proxy translators. Manages model downloads, quantization formats (GGUF), and context windows. `ollama launch` (v0.15+) automates agent CLI configuration. |
| **ollama** (npm) | 0.6.3 | Node.js client for Ollama native API | Official JS client. Uses Ollama's native `/api/chat` endpoint (not OpenAI-compat). Provides `chat()`, `generate()`, `embed()`, `list()`, `pull()`, `show()`, `ps()`, `create()`, `delete()`, `copy()`. Supports streaming via AsyncGenerator, structured JSON output, tool calling, and thinking mode. Single dependency (`whatwg-fetch`). TypeScript types included. ESM and CJS entry points. This is what the grader will use -- call Ollama directly via its native API for maximum control over model parameters. |
| **opencode** (CLI) | v1.2.20 | Agent CLI for agentic coding evaluation | Open-source coding agent with 45K+ GitHub stars. Supports 75+ LLM providers including Ollama via OpenAI-compatible endpoint. Configuration via `~/.config/opencode/opencode.json`. Uses `@ai-sdk/openai-compatible` npm package internally. `ollama launch opencode` automates setup. Install via `npm i -g opencode-ai@latest`. |
| **Claude Code** (CLI) | latest | Agent CLI for agentic coding evaluation | Anthropic's official coding agent. Connects to Ollama via `ANTHROPIC_BASE_URL=http://localhost:11434` + `ANTHROPIC_AUTH_TOKEN=ollama` (Ollama v0.14+ Anthropic compatibility). `ollama launch claude` automates setup. No proxy needed -- Ollama natively speaks Anthropic Messages API (`/v1/messages`). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ollama` (npm) | 0.6.3 | Grader integration: call local LLM for rubric evaluation | Always -- this is how `LocalLLMGrader` talks to Ollama |
| `@huggingface/transformers` | 3.8.1 | In-process ONNX inference (NPU path) | Only if pursuing NPU acceleration via ONNX models. See "NPU Path" section below. NOT for the primary grading workflow -- too slow for LLM-scale text generation on CPU-only WASM (2-5 tok/s). Best for embedding/classification tasks, not generative grading. |
| `@huggingface/inference` | 4.13.15 | Client for HF Inference endpoints | NOT recommended. Designed for cloud HF Inference API. Adds unnecessary dependency when Ollama handles all local inference. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Ollama CLI | Model management, server lifecycle, agent launch | `ollama pull`, `ollama list`, `ollama serve`, `ollama launch` |
| LM Studio | Alternative model server (Anthropic-compat since v0.4.1) | Backup option if Ollama has issues on ARM64. Provides UI for model browsing. Also CPU-only on Snapdragon. |

## Ollama API Architecture

Ollama exposes **three** API surfaces. Understanding which to use where is critical:

### 1. Native Ollama API (`/api/chat`, `/api/generate`)
- **Used by:** `ollama` npm client (the grader)
- **Why:** Full control over Ollama-specific options (`num_ctx`, `temperature`, `keep_alive`, `think`). Structured JSON output via `format` parameter. No translation layer.
- **Endpoint:** `http://localhost:11434/api/chat`

### 2. OpenAI-Compatible API (`/v1/chat/completions`)
- **Used by:** OpenCode (via `@ai-sdk/openai-compatible`)
- **Why:** OpenCode's provider system expects OpenAI-format endpoints.
- **Endpoint:** `http://localhost:11434/v1/chat/completions`

### 3. Anthropic-Compatible API (`/v1/messages`)
- **Used by:** Claude Code (via `ANTHROPIC_BASE_URL`)
- **Why:** Claude Code natively speaks Anthropic Messages API. Ollama v0.14+ translates this internally. No proxy needed.
- **Endpoint:** `http://localhost:11434/v1/messages`
- **Supports:** Messages, streaming, system prompts, tool calling, vision, thinking. Does NOT support token counting, prompt caching, or batches.

### Confidence: HIGH
Verified via Ollama official docs, ollama.com/blog/claude, and docs.ollama.com/api/anthropic-compatibility.

## `ollama launch` Command (v0.15+)

The `ollama launch` command automates agent CLI configuration. It sets the necessary environment variables and config files without manual intervention.

```bash
# Interactive (choose agent from menu)
ollama launch

# Direct launch with specific agent and model
ollama launch claude --model qwen3-coder
ollama launch opencode --model qwen3-coder

# Configure without launching (inspect what it sets)
ollama launch claude --config
```

### What it does for Claude Code:
Sets `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`, launches `claude --model <selected-model>`.

### What it does for OpenCode:
Writes/updates `~/.config/opencode/opencode.json` with Ollama provider config, launches `opencode`.

### Critical: Context Window
Ollama defaults to 4096 tokens. Agent CLIs need 64K+ for effective operation. Either:
1. Create a Modelfile with `PARAMETER num_ctx 65536` and `ollama create` a custom model
2. Use `OLLAMA_CONTEXT_LENGTH` env var (v0.17+ supports dynamic context scaling)
3. Set `num_ctx` via API parameter in the grader

### Confidence: HIGH
Verified via ollama.com/blog/launch, docs.ollama.com/cli.

## Agent CLI Configuration Details

### OpenCode Configuration

**Config file:** `~/.config/opencode/opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://localhost:11434/v1"
      },
      "models": {
        "qwen3-coder": {
          "name": "Qwen3 Coder"
        }
      }
    }
  }
}
```

**Install:** `npm i -g opencode-ai@latest`

### Claude Code Configuration

**Environment variables:**
```bash
export ANTHROPIC_BASE_URL="http://localhost:11434"
export ANTHROPIC_AUTH_TOKEN="ollama"
```

**Launch:** `claude --model qwen3-coder`

**VS Code settings (alternative):**
```json
{
  "claudeCode.environmentVariables": [
    { "name": "ANTHROPIC_BASE_URL", "value": "http://localhost:11434" },
    { "name": "ANTHROPIC_AUTH_TOKEN", "value": "ollama" }
  ]
}
```

**To revert to Anthropic cloud:** `unset ANTHROPIC_BASE_URL && unset ANTHROPIC_AUTH_TOKEN`

### Confidence: HIGH
Verified via code.claude.com/docs/en/llm-gateway, opencode.ai/docs/providers, multiple community guides.

## CPU/NPU Model Recommendations for ARM64 Windows (Snapdragon X Elite)

### Hardware Profile
- CPU: 12-core Qualcomm Snapdragon X Elite X1E80100 (3.4-4 GHz, ARM NEON + SVE2)
- NPU: Qualcomm Hexagon (45 TOPS, INT4/INT8 only, ONNX models only)
- RAM: 32 GB LPDDR5X (16 GB usable)
- GPU: Qualcomm Adreno X1-85 (poor ML support, no CUDA)

### Key Constraint: Ollama = CPU-Only on ARM64 Windows
Ollama uses llama.cpp under the hood with GGUF models. On ARM64 Windows, there is **no GPU/NPU backend** -- only CPU via `ggml-cpu` with ARM NEON optimizations. The Hexagon NPU only works with ONNX models via QNN Execution Provider, which Ollama does not support.

### Recommended Models for Grading (via Ollama, CPU)

| Model | Parameters | RAM (Q4_K_M) | Purpose | Why |
|-------|-----------|--------------|---------|-----|
| **Phi-4 Reasoning** | 14B | ~9 GB | **Primary grader** | Best-in-class instruction following (IFBench 0.834). Grading requires precise rubric adherence, not creative coding. Strong reasoning (AIME 0.753). Fits in 16 GB with room for Node.js + Docker. |
| **Qwen 2.5 Coder 14B** | 14B | ~9 GB | **Alternative grader** | State-of-the-art on code evaluation benchmarks. Better code understanding than Phi-4 but slightly weaker instruction following. Good for code-quality rubrics. |
| **DeepSeek R1 Distill 8B** | 8B | ~5-6 GB | **Lightweight grader** | Inherits chain-of-thought reasoning from full R1. Useful when running grader alongside agent CLI (lower memory pressure). Good for debugging/reasoning rubrics. |

### Recommended Models for Agent CLIs (via Ollama, CPU)

| Model | Parameters | RAM (Q4_K_M) | Purpose | Why |
|-------|-----------|--------------|---------|-----|
| **qwen3-coder** | 30B | ~18 GB | **Agent model (if fits)** | Ollama's recommended coding model. May need Q3 quantization to fit in 16 GB alongside overhead. Best code quality. |
| **Qwen 2.5 Coder 14B** | 14B | ~9 GB | **Primary agent model** | Best balance of quality and memory. 128K context window. Handles 40+ languages. Fits comfortably with agent CLI overhead. |
| **Qwen3 4B** | 4B | ~2.75 GB | **Fast agent model** | For rapid iteration and testing. Won't match larger models on complex tasks but runs fast on CPU and leaves plenty of RAM. |

### Quantization Guidance

| Format | Quality Loss | Speed | Recommendation |
|--------|-------------|-------|----------------|
| Q4_K_M | ~2-5% | Baseline | **Default choice.** Gold standard for 16 GB systems. K-quantization preserves critical weights. |
| Q5_K_M | ~1-3% | ~10% slower | Use when RAM allows (14B models: ~11 GB). Better for grading accuracy. |
| Q3_K_M | ~5-10% | ~10% faster | Only if running large model (30B) that doesn't fit at Q4. |
| IQ3_XS | Varies | Experimental | **Avoid on ARM64 Windows.** Known to load slowly or crash. |
| AWQ/GPTQ | N/A | N/A | **Not supported on Windows ARM64.** |

### Expected Performance (CPU-only, Snapdragon X Elite)
- **Token generation:** 5-15 tokens/second for 14B models at Q4_K_M (estimate based on comparable ARM64 benchmarks)
- **Prompt processing:** Faster than generation, typically 20-50 tok/s for moderate prompts
- **Grading latency:** 10-30 seconds per rubric evaluation (typical 200-500 token response)
- **Agent CLI:** Usable but noticeably slower than cloud models. Expect 30-60 second response times for complex operations.

### Confidence: MEDIUM
Performance estimates are extrapolated from community reports on similar hardware. No authoritative benchmark for Snapdragon X Elite + Ollama v0.17 was found. The model recommendations are HIGH confidence based on multiple benchmark sources.

## NPU Path (Future Optimization, Not Primary)

The Snapdragon X Elite's Hexagon NPU (45 TOPS INT4/INT8) is **unused** by Ollama/llama.cpp. The only working NPU acceleration path today:

1. **ONNX Runtime + QNN Execution Provider** -- uses Qualcomm's NPU directly
2. **Models must be in ONNX format** -- not GGUF
3. **Limited to ~7B parameters** -- larger models lack Qualcomm tooling support
4. **Working models:** Phi-3.5 Mini, Phi-3, Llama-3.1-8B (ONNX), Qwen-2.5-7B (ONNX)
5. **Node.js support:** `onnxruntime-node` (v1.21.0) has ARM64 Windows binaries but **QNN EP is NOT in pre-built npm binaries**. Would require building from source.
6. **`@huggingface/transformers`** (v3.8.1) uses `onnxruntime-node` under the hood. Supports CPU EP natively but not QNN via npm.

**Recommendation:** Do NOT pursue NPU acceleration in the initial milestone. The ecosystem is immature for Node.js + QNN. Use Ollama CPU inference as the primary path. Revisit NPU when `onnxruntime-node` ships QNN pre-built binaries (tracked in onnxruntime GitHub issues).

### Confidence: HIGH
Verified via onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html, npm registry for onnxruntime-node, and community reports from Snapdragon X Elite users.

## Installation

```bash
# Ollama server (Windows ARM64)
# Download from https://ollama.com/download/windows
# Or via winget:
winget install ollama.ollama

# Verify version (need v0.15+ for launch, v0.17+ for dynamic context)
ollama --version

# Pull recommended models
ollama pull phi4-reasoning:14b-q4_K_M
ollama pull qwen2.5-coder:14b-q4_K_M
ollama pull qwen3-coder

# Node.js client (for grader integration)
npm install ollama@0.6.3

# Agent CLIs
npm i -g opencode-ai@latest
# Claude Code: already installed (curl -fsSL https://claude.ai/install.sh | bash)

# Context window setup for agent CLIs
# Create a Modelfile for 64K context:
# FROM qwen2.5-coder:14b-q4_K_M
# PARAMETER num_ctx 65536
# Then: ollama create qwen2.5-coder-64k -f Modelfile
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `ollama` npm client | Direct HTTP `fetch()` to Ollama REST API | Only if you need absolute minimal dependencies. The `ollama` npm client adds type safety, streaming helpers, and a single `whatwg-fetch` dep. Use direct fetch only for the Anthropic-compat endpoint (which the npm client doesn't wrap). |
| `ollama` npm client | `@huggingface/transformers` for in-process inference | Only for non-generative tasks (embeddings, classification). WASM-based text generation is 2-5 tok/s -- unusable for LLM grading. If NPU support matures in `onnxruntime-node`, revisit for small models. |
| Ollama server | LM Studio | If Ollama has ARM64-specific bugs. LM Studio v0.4.1+ has Anthropic-compatible endpoint (`/v1/messages`). Same CPU-only limitation on Snapdragon. Provides UI for model browsing. Not scriptable for `ollama launch`-style automation. |
| Ollama native Anthropic compat | LiteLLM proxy | Only if you need multi-provider routing, team auth, or audit logging. For single-developer local use, LiteLLM adds Python + Redis + PostgreSQL dependencies for no benefit. Ollama v0.14+ eliminates the need for API translation proxies. |
| Ollama native Anthropic compat | claude-code-proxy | Never. Ollama v0.14+ makes this obsolete. The proxy was needed when Ollama only spoke OpenAI format. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@huggingface/inference` | Designed for HF cloud Inference API, not local endpoints. Adds unnecessary abstraction over what Ollama already provides. | `ollama` npm client for local inference |
| `ollama-node` | Unofficial, unmaintained, work-in-progress by the maintainer's own admission | `ollama` (official npm package) |
| `ollama-js-client` | Community wrapper with less features than official client | `ollama` (official npm package) |
| `ai-sdk-ollama` | Vercel AI SDK v6 provider -- adds heavy AI SDK dependency for features we don't need | `ollama` npm client directly |
| LiteLLM (for this project) | Python proxy server requiring Redis + PostgreSQL. Massively over-engineered for single-developer local use. Ollama v0.14+ Anthropic compatibility eliminates the translation need. | Ollama's native Anthropic-compatible endpoint |
| claude-code-proxy | Obsolete. Was needed pre-Ollama v0.14 when no native Anthropic compat existed. | Ollama v0.14+ native Anthropic compatibility |
| GPU-dependent models | Snapdragon X Elite has no CUDA, no ROCm, and Adreno GPU has poor ML support | CPU-only GGUF models via Ollama |
| AWQ/GPTQ quantization | Not supported on Windows ARM64 | GGUF Q4_K_M or Q5_K_M quantization |
| IQ3_XS quantization | Known to load slowly or crash on ARM64 Windows | Q3_K_M if you must go below Q4 |
| `@huggingface/transformers` for LLM grading | WASM text generation is 2-5 tok/s. A single grading call would take minutes. | Ollama with GGUF models (5-15 tok/s on CPU) |

## Stack Patterns by Variant

**For the grader (replacing LLMGrader):**
- Use `ollama` npm client calling Ollama's native `/api/chat` endpoint
- Model: Phi-4 Reasoning 14B Q4_K_M (best instruction following for rubric adherence)
- Set `temperature: 0`, `format: 'json'` for deterministic structured output
- Set `num_ctx` appropriately for the rubric + transcript length

**For OpenCode agent CLI backend:**
- Use `ollama launch opencode --model qwen2.5-coder:14b` or manual config
- Model: Qwen 2.5 Coder 14B Q4_K_M (best coding model that fits in memory)
- Must set 64K+ context window via Modelfile

**For Claude Code agent CLI backend:**
- Use `ollama launch claude --model qwen2.5-coder:14b` or manual env vars
- Model: Same Qwen 2.5 Coder 14B Q4_K_M
- `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`

**Sequential execution pattern (critical for 16 GB):**
- Do NOT run grader and agent CLI simultaneously -- both need the LLM loaded in RAM
- Ollama's `keep_alive` parameter controls how long models stay loaded (default: 5 minutes)
- Consider `keep_alive: 0` after grading to immediately free RAM for the next agent CLI run

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ollama` npm 0.6.3 | Ollama server v0.14+ | npm client uses native Ollama API; Anthropic compat is server-side only |
| Ollama v0.17.7 | Claude Code (latest) | Via Anthropic-compatible `/v1/messages` endpoint |
| Ollama v0.17.7 | OpenCode v1.2.20 | Via OpenAI-compatible `/v1/chat/completions` endpoint |
| `ollama launch` | Ollama v0.15+ | Command not available in earlier versions |
| Dynamic context scaling | Ollama v0.17+ | Auto-scales context based on available RAM |
| `@huggingface/transformers` 3.8.1 | `onnxruntime-node` 1.21.0 | ONNX Runtime for Node.js -- CPU only on ARM64 Windows (no QNN in npm prebuilds) |
| Node.js 24+ | `ollama` npm 0.6.3 | Uses native fetch -- no polyfill needed on Node 24 |
| TypeScript 5.9+ | `ollama` npm 0.6.3 | Types bundled in package |

## Grader Integration Pattern

The existing `LLMGrader` calls Gemini/Anthropic cloud APIs. The new `LocalLLMGrader` will use the `ollama` npm client:

```typescript
import { Ollama } from 'ollama';

const ollama = new Ollama({ host: 'http://localhost:11434' });

// In LocalLLMGrader.grade():
const response = await ollama.chat({
  model: 'phi4-reasoning:14b-q4_K_M',
  messages: [{ role: 'user', content: prompt }],
  format: 'json',      // Structured output -- returns valid JSON
  options: {
    temperature: 0,     // Deterministic for grading consistency
    num_ctx: 8192,      // Enough for rubric + transcript
  },
  stream: false,        // Wait for complete response
});

const parsed = JSON.parse(response.message.content);
// { "score": 0.85, "reasoning": "..." }
```

### Confidence: HIGH for the pattern. MEDIUM for specific model choice (depends on benchmarking).

## Sources

- [Ollama official docs](https://docs.ollama.com) -- API reference, CLI reference, Anthropic compatibility
- [Ollama blog: Claude Code compatibility](https://ollama.com/blog/claude) -- v0.14 Anthropic Messages API support
- [Ollama blog: launch command](https://ollama.com/blog/launch) -- v0.15 agent CLI automation
- [ollama/ollama-js GitHub](https://github.com/ollama/ollama-js) -- Official JS client API surface
- [npm registry: ollama@0.6.3](https://registry.npmjs.org/ollama/latest) -- Version and dependencies verified
- [npm registry: @huggingface/transformers@3.8.1](https://registry.npmjs.org/@huggingface/transformers/latest) -- Version verified
- [npm registry: @huggingface/inference@4.13.15](https://registry.npmjs.org/@huggingface/inference/latest) -- Version verified
- [OpenCode docs: providers](https://opencode.ai/docs/providers/) -- Ollama configuration format
- [OpenCode GitHub](https://github.com/anomalyco/opencode) -- v1.2.20, install instructions
- [Claude Code docs: LLM gateway](https://code.claude.com/docs/en/llm-gateway) -- ANTHROPIC_BASE_URL configuration
- [LM Studio blog: Claude Code integration](https://lmstudio.ai/blog/claudecode) -- Anthropic-compat endpoint (v0.4.1)
- [Ollama Anthropic compatibility docs](https://docs.ollama.com/api/anthropic-compatibility) -- Supported/unsupported features
- [Qualcomm: Ollama on Snapdragon](https://www.qualcomm.com/developer/project/ollama-with-windows-on-snapdragon-wos) -- ARM64 Windows compatibility
- [Snapdragon X Elite LLM journey (community)](https://vcfvct.wordpress.com/2025/12/31/running-local-llms-on-a-snapdragon-x-elite-surface-laptop-7-my-journey-to-real-npu-acceleration/) -- NPU vs CPU real-world experience
- [ONNX Runtime QNN EP docs](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html) -- NPU Node.js support status
- [Ollama GitHub issues #5360](https://github.com/ollama/ollama/issues/5360) -- Snapdragon NPU/GPU support tracking
- [Best local coding models 2026](https://www.insiderllm.com/guides/best-local-coding-models-2026/) -- Model benchmarks and recommendations
- [Promptfoo: Transformers.js provider](https://www.promptfoo.dev/docs/providers/transformers/) -- ONNX inference for LLM evaluation

---
*Stack research for: local LLM inference in Node.js/TypeScript skill evaluation framework*
*Researched: 2026-03-08*
