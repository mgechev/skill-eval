# Phase 2: Local LLM Grader - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace cloud LLM grading (Gemini/Anthropic API) with local Ollama-backed grading as the preferred default. Users grade agent output with no API keys required. Existing deterministic graders and cloud LLM grading remain fully functional. Agent CLI backends are out of scope (v2).

</domain>

<decisions>
## Implementation Decisions

### Grader type strategy
- Modify existing `llm_rubric` type — Ollama is added as first option in the fallback chain
- No new grader type needed; task.toml stays unchanged
- Resolution order: Ollama -> Gemini -> Anthropic -> score 0 with error message
- `getGrader()` factory unchanged — still dispatches `'llm_rubric'` to `LLMGrader`

### Ollama detection
- Always try `OLLAMA_HOST` env var or `http://localhost:11434` by default
- Connection refused -> fall through to Gemini/Anthropic, same pattern as checking env vars
- No pre-eval health check — match upstream per-trial approach
- Ollama errors surface in grader result `details` field, then fall through

### Model selection
- Use existing `config.model` field from task.toml `GraderConfig` — already exists
- Default model picked during research (must fit 16GB GitHub runner, grade within 3-5 min)
- Same pattern as `config.model || 'gemini-2.0-flash'` for Gemini defaults

### Structured output parsing
- Use Ollama `format: "json"` in API call to encourage structured output
- Reuse existing `parseResponse()` regex extraction — already handles markdown-wrapped JSON
- Retry on parse failure — count and strategy are Claude's discretion (req GRADE-06)

### Ollama API call parameters
- `temperature: 0` for deterministic grading (req GRADE-07)
- `stream: false` — simpler, no streaming needed (out of scope confirms this)
- Existing rubric prompt files (`prompts/*.md`) reused unchanged (req GRADE-05)

### Claude's Discretion
- Default Ollama model choice (within constraints: 16GB RAM, Q4/Q5 quantized, 3-5 min grading)
- Retry count and backoff strategy for malformed structured output
- Ollama API endpoint paths (`/api/generate` vs `/api/chat`)
- Error message wording for grader result details
- TASK-01 implementation: SKILL.md frontmatter format for superlint task

</decisions>

<specifics>
## Specific Ideas

- "Extend, don't rewrite" — Ollama is just another grader provider in the existing chain
- Minimal divergence from upstream to ease future syncing with mgechev/skill-eval
- Per-trial fallback matches how upstream handles cloud backends (no pre-check, graceful per-trial)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `LLMGrader` class (`src/graders/index.ts`): Add `callOllama()` method alongside existing `callGemini()`/`callAnthropic()`
- `parseResponse()` method: Already extracts `{score, reasoning}` JSON from LLM text with regex — reuse for Ollama output
- `GraderConfig.model` field (`src/types.ts`): Already supports per-task model override — no type changes needed
- `getGrader()` factory: No changes needed — `'llm_rubric'` already routes to `LLMGrader`

### Established Patterns
- Cloud provider chain: `if (geminiKey) → callGemini() else if (anthropicKey) → callAnthropic()` — extend with Ollama first
- Error handling: `try/catch` returning `GraderResult` with `score: 0` and error in `details` — same for Ollama
- API calls use native `fetch()` — Ollama REST API is also HTTP, consistent approach
- Temperature=0 already set for Gemini (`generationConfig.temperature: 0`)

### Integration Points
- `LLMGrader.grade()` method: Insert Ollama check before Gemini/Anthropic env var checks
- `OLLAMA_HOST` env var: Load from `env` parameter and `process.env`, same as API key loading
- `task.toml` grader config: Existing `model` field works for Ollama model names
- `.env` files: Add `OLLAMA_HOST` alongside existing `GEMINI_API_KEY`/`ANTHROPIC_API_KEY`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-local-llm-grader*
*Context gathered: 2026-03-08*
