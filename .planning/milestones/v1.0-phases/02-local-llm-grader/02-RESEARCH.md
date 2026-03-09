# Phase 2: Local LLM Grader - Research

**Researched:** 2026-03-08
**Domain:** Ollama REST API integration for local LLM-as-a-Judge grading
**Confidence:** HIGH

## Summary

Phase 2 adds Ollama as the first provider in the existing `LLMGrader` fallback chain (Ollama -> Gemini -> Anthropic -> score 0 with error). The codebase already has the exact patterns needed: `callGemini()` and `callAnthropic()` methods use native `fetch()` against REST APIs, `parseResponse()` extracts `{score, reasoning}` JSON from LLM text, and the `GraderConfig.model` field already supports per-task model override. The work is purely additive -- a new `callOllama()` method and a pre-chain Ollama availability check.

Ollama's REST API is straightforward HTTP JSON. The `/api/generate` endpoint with `format` set to a JSON schema produces constrained structured output, and `stream: false` returns a single JSON response. The health check is `GET /` (returns "Ollama is running") and model listing is `GET /api/tags` (returns models array with name, size, quantization details).

**Primary recommendation:** Use `qwen3:4b` (Q4_K_M, ~2.7GB) as the default model. It matches Qwen2.5-72B-Instruct in reasoning benchmarks, fits easily in 16GB runners, and produces reliable structured JSON output. On CPU-only GitHub Actions runners, expect ~10-20 tokens/sec for this small model, keeping grading responses (~256 tokens) within 15-30 seconds per trial -- well within the 3-5 minute budget.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Modify existing `llm_rubric` type -- Ollama is added as first option in the fallback chain
- No new grader type needed; task.toml stays unchanged
- Resolution order: Ollama -> Gemini -> Anthropic -> score 0 with error message
- `getGrader()` factory unchanged -- still dispatches `'llm_rubric'` to `LLMGrader`
- Always try `OLLAMA_HOST` env var or `http://localhost:11434` by default
- Connection refused -> fall through to Gemini/Anthropic, same pattern as checking env vars
- No pre-eval health check -- match upstream per-trial approach
- Ollama errors surface in grader result `details` field, then fall through
- Use existing `config.model` field from task.toml `GraderConfig` -- already exists
- Default model picked during research (must fit 16GB GitHub runner, grade within 3-5 min)
- Same pattern as `config.model || 'gemini-2.0-flash'` for Gemini defaults
- Use Ollama `format: "json"` in API call to encourage structured output
- Reuse existing `parseResponse()` regex extraction -- already handles markdown-wrapped JSON
- Retry on parse failure -- count and strategy are Claude's discretion (req GRADE-06)
- `temperature: 0` for deterministic grading (req GRADE-07)
- `stream: false` -- simpler, no streaming needed
- Existing rubric prompt files (`prompts/*.md`) reused unchanged (req GRADE-05)

### Claude's Discretion
- Default Ollama model choice (within constraints: 16GB RAM, Q4/Q5 quantized, 3-5 min grading)
- Retry count and backoff strategy for malformed structured output
- Ollama API endpoint paths (`/api/generate` vs `/api/chat`)
- Error message wording for grader result details
- TASK-01 implementation: SKILL.md frontmatter format for superlint task

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRADE-01 | Ollama-backed LLM grader replacing cloud Gemini/Anthropic API calls in LLMGrader | Ollama REST API `/api/generate` endpoint with native `fetch()`, same pattern as existing `callGemini()`/`callAnthropic()` |
| GRADE-02 | Grader model must fit on default GitHub runner (4 vCPU, 16GB RAM) | `qwen3:4b` Q4_K_M is ~2.7GB; fits easily with headroom for KV cache and OS overhead |
| GRADE-03 | Each trial must complete grading within 3-5 minutes max | ~256 token output at ~10-20 tok/s on CPU = 13-26 seconds; prompt eval of ~2K tokens adds ~10-20s; total ~30-50s per grading call |
| GRADE-04 | Model selection configurable via task.toml grader config (model field) | Existing `GraderConfig.model` field already used; pattern: `config.model \|\| 'qwen3:4b'` |
| GRADE-05 | Existing rubric prompt files (prompts/*.md) reused unchanged | Ollama `/api/generate` accepts same prompt text; no rubric changes needed |
| GRADE-06 | Robust structured JSON output parsing with fallback for malformed output | JSON schema in `format` field + existing `parseResponse()` regex + retry with backoff (3 attempts recommended) |
| GRADE-07 | Temperature=0 for deterministic grading behavior | Ollama `options.temperature: 0` in API request body |
| GRADE-08 | Deterministic grader must still score 1.0 | No changes to `DeterministicGrader` or `getGrader()` factory; only `LLMGrader.grade()` modified |
| OLLAMA-01 | Ollama health check before evaluation starts (fail fast) | Despite CONTEXT.md saying "no pre-eval health check", REQUIREMENTS.md requires it. Implement via `GET /` + connection error catch in `callOllama()` that provides actionable error before attempting generation |
| OLLAMA-02 | Model availability check (verify required model is pulled) | `GET /api/tags` returns `models[]` with `name` field; check before generation, fail with "model X not pulled" message |
| OLLAMA-03 | Graceful degradation when Ollama absent | Connection refused on Ollama -> fall through to Gemini/Anthropic if keys present; if neither available -> score 0 with descriptive error |
| TASK-01 | Superlint SKILL.md has agent skill frontmatter | Add YAML frontmatter with `name` and `description` fields per Agent Skills open standard specification |
</phase_requirements>

### Requirement Conflict Note: OLLAMA-01 vs CONTEXT.md

CONTEXT.md states "No pre-eval health check -- match upstream per-trial approach" but REQUIREMENTS.md specifies OLLAMA-01: "Ollama health check before evaluation starts (fail fast with actionable error)" and success criteria #2 explicitly says "Starting an evaluation when Ollama is not running fails immediately with an actionable error message (not a mid-trial timeout)." The planner MUST follow the requirements and success criteria. The implementation should perform a health check at the start of `LLMGrader.grade()` on the first call (or as a pre-evaluation step) rather than silently falling through per-trial.

**Recommended reconciliation:** Perform a health + model check once before the first grading attempt. If Ollama is running and the model is available, proceed. If Ollama is not running and no cloud API keys are present, fail immediately with an actionable error. If Ollama is not running but cloud keys exist, warn and fall through (OLLAMA-03). This satisfies both the "fail fast" requirement and the "graceful degradation" requirement.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Ollama | 0.17+ | Local LLM inference server | Industry standard for local model serving; REST API, GGUF models, cross-platform |
| qwen3:4b | Q4_K_M | Default grading model | Matches Qwen2.5-72B reasoning quality; 2.7GB fits 16GB runners; reliable structured JSON |
| Node.js native fetch | Built-in | HTTP client for Ollama API | Already used for Gemini/Anthropic; no new dependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ai-action/setup-ollama | v2 | GitHub Actions Ollama setup | CI workflows needing Ollama (Phase 3, not this phase) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| qwen3:4b | qwen2.5-coder:7b | Better at code but ~5GB, slower on CPU, overkill for rubric grading |
| qwen3:4b | phi3:mini (3.8B) | Smaller but weaker reasoning; less reliable structured output |
| qwen3:4b | gemma2:2b | Tiny but too weak for nuanced rubric evaluation |
| /api/generate | /api/chat | Chat endpoint adds message history overhead; generate is simpler for single-shot grading |

**No new npm dependencies needed.** The implementation uses only native `fetch()` already present in the codebase.

## Architecture Patterns

### Recommended Project Structure (changes only)
```
src/
  graders/
    index.ts          # MODIFY: Add callOllama() method, health/model checks
tasks/
  superlint_demo/
    skills/
      superlint/
        SKILL.md      # MODIFY: Add YAML frontmatter (TASK-01)
```

### Pattern 1: Ollama Provider in Fallback Chain
**What:** Add `callOllama()` as the first provider attempted in `LLMGrader.grade()`, before checking for Gemini/Anthropic API keys.
**When to use:** Every `llm_rubric` grading call.
**Example:**
```typescript
// Source: Ollama API docs + existing codebase pattern
async grade(...): Promise<GraderResult> {
    // ... rubric loading and transcript building (unchanged) ...

    // Try Ollama first (no API key needed)
    const ollamaHost = env?.OLLAMA_HOST || process.env.OLLAMA_HOST || 'http://localhost:11434';
    const ollamaResult = await this.callOllama(prompt, ollamaHost, config);

    if (ollamaResult) {
        return ollamaResult;
    }

    // Fall through to cloud providers
    const apiKey = env?.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const anthropicKey = env?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    // ... existing cloud fallback logic ...
}
```

### Pattern 2: Ollama API Call with Structured Output
**What:** Call `/api/generate` with JSON schema format for constrained output.
**When to use:** In `callOllama()` method.
**Example:**
```typescript
// Source: Ollama REST API docs (https://github.com/ollama/ollama/blob/main/docs/api.md)
private async callOllama(
    prompt: string,
    ollamaHost: string,
    config: GraderConfig
): Promise<GraderResult | null> {
    const model = config.model || 'qwen3:4b';
    const url = `${ollamaHost}/api/generate`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: false,
                format: {
                    type: 'object',
                    properties: {
                        score: { type: 'number' },
                        reasoning: { type: 'string' }
                    },
                    required: ['score', 'reasoning']
                },
                options: {
                    temperature: 0,
                    num_predict: 512
                }
            })
        });

        if (!response.ok) {
            // Model not found or other error -- fall through
            return null;
        }

        const data = await response.json() as any;
        const text = data?.response || '';
        return this.parseResponse(text, config);
    } catch (e: any) {
        // Connection refused or network error -- fall through to cloud
        return null;
    }
}
```

### Pattern 3: Health and Model Availability Check
**What:** Pre-flight check before grading to fail fast with actionable errors.
**When to use:** Before the first Ollama grading call in an evaluation run.
**Example:**
```typescript
// Source: Ollama API docs - GET / and GET /api/tags
private async checkOllamaAvailability(
    ollamaHost: string,
    model: string
): Promise<{ available: boolean; error?: string }> {
    try {
        // Health check
        const healthRes = await fetch(ollamaHost, { signal: AbortSignal.timeout(5000) });

        if (!healthRes.ok) {
            return { available: false, error: `Ollama health check failed (HTTP ${healthRes.status})` };
        }

        // Model check
        const tagsRes = await fetch(`${ollamaHost}/api/tags`);
        const tagsData = await tagsRes.json() as any;
        const models: string[] = (tagsData?.models || []).map((m: any) => m.name);
        const modelBase = model.includes(':') ? model : `${model}:latest`;

        if (!models.some(m => m === modelBase || m.startsWith(model + ':'))) {
            return {
                available: false,
                error: `Ollama is running but model "${model}" is not pulled. Run: ollama pull ${model}`
            };
        }

        return { available: true };
    } catch (e: any) {
        if (e?.cause?.code === 'ECONNREFUSED' || e?.message?.includes('fetch failed')) {
            return {
                available: false,
                error: `Ollama is not running at ${ollamaHost}. Start it with: ollama serve`
            };
        }

        return { available: false, error: `Ollama check failed: ${e.message}` };
    }
}
```

### Pattern 4: Retry with Backoff for Parse Failures
**What:** Retry the Ollama call if structured output parsing fails.
**When to use:** When `parseResponse()` returns score 0 due to malformed JSON.
**Example:**
```typescript
// Retry strategy: 3 attempts with 1s, 2s delays
private async callOllamaWithRetry(
    prompt: string,
    ollamaHost: string,
    config: GraderConfig,
    maxRetries: number = 3
): Promise<GraderResult | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await this.callOllama(prompt, ollamaHost, config);

        if (result === null) {
            // Connection/network error -- don't retry, fall through immediately
            return null;
        }

        if (result.score > 0 || attempt === maxRetries) {
            return result;
        }

        // Parse failure (score=0 with "Failed to parse" details) -- retry
        if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, attempt * 1000));
        }
    }

    return null;
}
```

### Pattern 5: SKILL.md Frontmatter (TASK-01)
**What:** Add YAML frontmatter to the existing superlint SKILL.md for agent CLI auto-discovery.
**When to use:** TASK-01 requirement.
**Example:**
```markdown
---
name: superlint
description: Mandatory 3-step corporate linting workflow using the proprietary SuperLint CLI tool (check, fix, verify).
---

# SuperLint Proprietary Workflow
... (existing content unchanged) ...
```

### Anti-Patterns to Avoid
- **Creating a new grader type:** Do NOT add `'local_llm_rubric'` to `getGrader()` or `GraderConfig.type`. Ollama is a provider within the existing `llm_rubric` type.
- **Using /api/chat for single-shot grading:** The `/api/generate` endpoint is simpler and avoids unnecessary message array wrapping for a single prompt.
- **Pre-pulling models in the grader code:** The grader should check if a model exists, not attempt to pull it. Model management is an ops concern.
- **Hardcoding localhost:** Always respect `OLLAMA_HOST` env var for configurability (remote Ollama servers, Docker networking, etc.).
- **Using `format: "json"` string instead of JSON schema:** The string `"json"` only forces valid JSON; a JSON schema constrains the structure to `{score, reasoning}` specifically.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured output enforcement | Custom JSON extraction regexes | Ollama `format` with JSON schema | Grammar-constrained decoding ensures valid JSON at the token level |
| LLM response parsing | New parser for Ollama | Existing `parseResponse()` method | Already handles markdown-wrapped JSON, JSON extraction, score clamping |
| HTTP client | axios/got/node-fetch | Native `fetch()` | Already used for Gemini/Anthropic; zero new dependencies |
| Model management | Auto-pull logic in grader | Fail with "run `ollama pull X`" message | Keep grader focused; model setup is infrastructure concern |

**Key insight:** The existing `LLMGrader` class is designed for extensibility. Adding Ollama is the same pattern as Gemini/Anthropic -- a new private `callOllama()` method and a priority check in `grade()`. No architectural changes needed.

## Common Pitfalls

### Pitfall 1: Thinking Mode Adds Latency and Breaks JSON
**What goes wrong:** Qwen3 models default to "thinking mode" which outputs `<think>...</think>` blocks before the actual response. This adds significant latency (2-5x) and can interfere with JSON parsing.
**Why it happens:** Qwen3 has thinking mode enabled by default. The thinking output appears before the structured response.
**How to avoid:** Ollama's structured output with `format` JSON schema should suppress thinking mode output in practice, as the grammar constrains output to JSON tokens only. However, if issues arise, explicitly instruct "Do not use thinking mode" in the prompt, or use the `qwen3:4b-instruct-2507` tag which supports non-thinking mode only.
**Warning signs:** Responses contain `<think>` tags; response time is unexpectedly long; `parseResponse()` consistently fails.

### Pitfall 2: num_predict Default of 128 Tokens
**What goes wrong:** Ollama defaults to 128 output tokens if `num_predict` is not set. The grading response needs ~100-256 tokens for score + reasoning.
**Why it happens:** Ollama's default `num_predict` is 128, which may truncate longer reasoning responses mid-JSON.
**How to avoid:** Explicitly set `options.num_predict: 512` in the API request. This gives ample room for the `{score, reasoning}` response without wasting time on excessive generation.
**Warning signs:** Truncated JSON responses, unclosed braces, `parseResponse()` returning score 0.

### Pitfall 3: Connection Timeout vs Connection Refused
**What goes wrong:** Using a generic timeout for the Ollama health check may wait 30+ seconds when Ollama isn't running, defeating the "fail fast" purpose.
**Why it happens:** Default `fetch()` has no timeout. If Ollama is not running, the connection may hang rather than immediately refusing.
**How to avoid:** Use `AbortSignal.timeout(5000)` for health checks (5 second max). For generation calls, use a longer timeout (e.g., 300 seconds / 5 minutes) since model inference legitimately takes time on CPU.
**Warning signs:** Evaluations hanging for 30+ seconds before failing when Ollama isn't running.

### Pitfall 4: Model Name Matching in /api/tags
**What goes wrong:** Checking for model `"qwen3:4b"` but `/api/tags` returns `"qwen3:4b"` or `"qwen3:4b-instruct"` depending on how it was pulled.
**Why it happens:** Ollama model names include tags (e.g., `qwen3:4b`, `qwen3:latest`). The default tag is `:latest` when not specified.
**How to avoid:** When checking model availability, match on the model name prefix. If user specifies `qwen3:4b`, check for that exact name. If they specify just `qwen3`, accept any tag for that model family.
**Warning signs:** "Model not found" errors when the model is actually pulled with a different tag.

### Pitfall 5: KV Cache Memory with Long Prompts
**What goes wrong:** Grading prompts can be large (2K-8K tokens for rubric + full session transcript). With a 4B model, the KV cache for 8K context needs ~0.5-1GB extra RAM on top of the model weights.
**Why it happens:** Each token in the context window requires KV cache memory. The default `num_ctx` in Ollama varies by model (typically 2048-8192).
**How to avoid:** The `qwen3:4b` model supports up to 32K context. For GitHub runners with 16GB RAM, a 2.7GB model + 1GB KV cache + OS overhead is well within budget. Monitor total memory if prompts grow larger.
**Warning signs:** Out-of-memory errors on runners; Ollama process killed by OOM killer.

### Pitfall 6: Race Condition in OLLAMA-01/02 Checks
**What goes wrong:** Checking health and model availability as a pre-flight step, but Ollama crashes between the check and the actual grading call.
**Why it happens:** Time-of-check vs time-of-use. The pre-flight check is a best-effort early detection, not a guarantee.
**How to avoid:** Still handle errors gracefully in `callOllama()` itself. The pre-flight check is for UX (fail fast with actionable message), not for correctness. The per-call error handling in `callOllama()` is the real safety net.
**Warning signs:** N/A -- this is a design consideration, not a bug to detect.

## Code Examples

### Ollama /api/generate Request (Grading)
```typescript
// Source: https://github.com/ollama/ollama/blob/main/docs/api.md
const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        model: 'qwen3:4b',
        prompt: `You are an evaluation judge. Score the following agent session...
Respond with ONLY a JSON object: {"score": <number>, "reasoning": "<brief explanation>"}`,
        stream: false,
        format: {
            type: 'object',
            properties: {
                score: { type: 'number' },
                reasoning: { type: 'string' }
            },
            required: ['score', 'reasoning']
        },
        options: {
            temperature: 0,
            num_predict: 512
        }
    })
});

// Response shape (stream: false):
// {
//   "model": "qwen3:4b",
//   "response": "{\"score\": 0.85, \"reasoning\": \"Agent followed the workflow...\"}",
//   "done": true,
//   "total_duration": 15000000000
// }
const data = await response.json();
const text = data.response; // The generated text (JSON string)
```

### Ollama Health Check
```typescript
// Source: https://github.com/ollama/ollama/blob/main/docs/api.md
// GET / returns "Ollama is running" with 200 OK
const res = await fetch('http://localhost:11434/', {
    signal: AbortSignal.timeout(5000)
});
// res.ok === true means Ollama is running
```

### Ollama Model List
```typescript
// Source: https://github.com/ollama/ollama/blob/main/docs/api.md
// GET /api/tags returns { models: [{ name: "qwen3:4b", size: 2700000000, ... }] }
const res = await fetch('http://localhost:11434/api/tags');
const data = await res.json();
const modelNames = data.models.map((m: any) => m.name);
// ["qwen3:4b", "llama3.2:latest", ...]
```

### Existing parseResponse (Reused As-Is)
```typescript
// Source: src/graders/index.ts (existing code -- no changes needed)
private parseResponse(text: string, config: GraderConfig): GraderResult {
    try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const score = Math.max(0, Math.min(1, parseFloat(parsed.score) || 0));
            return {
                grader_type: 'llm_rubric',
                score,
                weight: config.weight,
                details: parsed.reasoning || 'No reasoning provided'
            };
        }
    } catch (e) {
        // Fall through
    }
    return {
        grader_type: 'llm_rubric',
        score: 0,
        weight: config.weight,
        details: `Failed to parse LLM response: ${text}`
    };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `format: "json"` string | `format: { JSON schema }` | Ollama v0.5 (2024) | Grammar-constrained output; schema validation at token level |
| Qwen2.5-7B for small model tasks | Qwen3-4B | April 2025 | Qwen3-4B matches Qwen2.5-72B reasoning; half the size of Qwen2.5-7B |
| No structured output support | Full JSON schema support | Ollama v0.5+ | llama.cpp grammar integration ensures valid JSON |
| `num_predict` default 128 | Still defaults to 128 | N/A | Must explicitly set for grading (512 recommended) |

**Deprecated/outdated:**
- `format: "json"` (string): Still works but provides no schema constraint; use JSON schema object instead
- Qwen2.5-Coder-7B for grading: Overkill and slower; Qwen3-4B is better for rubric evaluation
- Ollama versions < 0.5: No structured output support; minimum version for this phase is 0.5+

## Open Questions

1. **Qwen3 4B thinking mode interaction with structured output**
   - What we know: Qwen3 defaults to thinking mode; structured output with `format` JSON schema should suppress thinking tokens via grammar constraint
   - What's unclear: Whether the `format` JSON schema fully suppresses `<think>` blocks in all cases, or if we need the `qwen3:4b-instruct-2507` (non-thinking only) variant
   - Recommendation: Default to `qwen3:4b` and test. If thinking tokens leak through, switch default to `qwen3:4b-instruct-2507`. Both are same quality for non-thinking tasks.

2. **Exact CPU inference speed on ubuntu-24.04-arm runners**
   - What we know: ~3-8 tok/s for 7B models on CPU; 4B should be ~1.5-2x faster; arm64 runners may have different perf characteristics
   - What's unclear: Exact speed on GitHub's arm64 runners (Ampere Altra processors)
   - Recommendation: The 3-5 minute budget per trial is generous. Even at worst case (5 tok/s, 512 tokens output), total generation time is ~100s, well within budget. No action needed -- will be validated in Phase 3 CI.

3. **OLLAMA-01/02 implementation scope**
   - What we know: Requirements say "before evaluation starts" for health check; CONTEXT.md says "no pre-eval health check"
   - What's unclear: Whether checks should be in `LLMGrader.grade()` (first call) or in `EvalRunner.runEval()` (before any trials)
   - Recommendation: Implement in `LLMGrader.grade()` with a one-time check flag. On first grading call, check health + model. Cache the result for subsequent calls. This keeps the check in the grader (encapsulation) while satisfying "fail fast" from success criteria.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | ts-node test scripts (custom, no framework) |
| Config file | tsconfig.json (includes `tests/**/*.ts`) |
| Quick run command | `npm run test:bootstrap` |
| Full suite command | `npm run test:bootstrap && npm run test:analytics` |

### Phase Requirements --> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRADE-01 | Ollama grading produces 0.0-1.0 scores | integration | `npm run test:bootstrap` (extended) | Partial -- existing test covers deterministic; needs Ollama mock |
| GRADE-02 | Model fits 16GB runner | manual-only | N/A -- verified by model selection (qwen3:4b = 2.7GB) | N/A |
| GRADE-03 | Grading within 3-5 min | integration | `npm run test:bootstrap` (with timing assertion) | Partial |
| GRADE-04 | Model configurable via task.toml | unit | `npm run test:bootstrap` (config override test) | Wave 0 |
| GRADE-05 | Existing rubric reused unchanged | smoke | Verify `prompts/quality.md` unchanged in git diff | Wave 0 |
| GRADE-06 | Robust JSON parsing with retry | unit | `npm run test:bootstrap` (mock malformed responses) | Wave 0 |
| GRADE-07 | Temperature=0 deterministic | unit | Verify API call body includes `temperature: 0` | Wave 0 |
| GRADE-08 | Deterministic grader still scores 1.0 | integration | `npm run test:bootstrap` | Existing -- bootstrap test verifies this |
| OLLAMA-01 | Health check fail fast | unit | Test with mock server returning errors | Wave 0 |
| OLLAMA-02 | Model availability check | unit | Test with mock /api/tags response | Wave 0 |
| OLLAMA-03 | Graceful degradation | integration | `npm run test:bootstrap` (no Ollama, no cloud keys) | Partial |
| TASK-01 | SKILL.md frontmatter | smoke | Verify YAML frontmatter parses correctly | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:bootstrap`
- **Per wave merge:** `npm run test:bootstrap && npm run test:analytics`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Mock-based Ollama tests in `tests/bootstrap.test.ts` -- covers GRADE-01, GRADE-04, GRADE-06, GRADE-07, OLLAMA-01, OLLAMA-02
- [ ] The existing bootstrap test runs the real `LLMGrader` which requires cloud API keys. Without Ollama or keys, the LLM grader returns score 0. The test currently passes because `pass_rate >= 0.5` is met by the deterministic grader alone (weight 0.7). Adding Ollama mock tests would verify grading logic without external dependencies.

*(Note: Full Ollama integration testing requires Ollama running and is deferred to Phase 3 CI. Unit tests with mocked HTTP responses are sufficient for this phase.)*

## Sources

### Primary (HIGH confidence)
- [Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md) - `/api/generate`, `/api/chat`, `/api/tags`, `GET /`, format parameter, options
- [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs) - JSON schema format field, cURL examples
- Existing codebase: `src/graders/index.ts`, `src/types.ts`, `src/evalRunner.ts` - actual implementation patterns

### Secondary (MEDIUM confidence)
- [Qwen3 announcement blog](https://qwenlm.github.io/blog/qwen3/) - Qwen3-4B matches Qwen2.5-72B-Instruct claim
- [Ollama VRAM requirements guide](https://localllm.in/blog/ollama-vram-requirements-for-local-llms) - Q4_K_M memory usage estimates
- [Running Ollama in GitHub Actions](https://emasuriano.com/blog/2025-03-27-running-ollama-in-github-actions---automating-llm-workflows/) - CI setup patterns, resource constraints
- [ai-action/setup-ollama](https://github.com/ai-action/setup-ollama) - GitHub Actions Ollama setup action (v2, defaults to 0.17.7)
- [Structured output with Ollama + Qwen3](https://www.glukhov.org/post/2025/09/llm-structured-output-with-ollama-in-python-and-go/) - Qwen3:4b structured output quality assessment
- [Agent Skills specification](https://agentskills.io/specification) - SKILL.md frontmatter format (name, description fields)

### Tertiary (LOW confidence)
- CPU inference speed estimates for Qwen3-4B on GitHub Actions arm64 runners (extrapolated from 7B benchmarks; actual speed unverified on that specific hardware)
- `num_predict` default behavior (multiple conflicting sources on exact default; 128 is documented but behavior may vary by model)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Ollama API is stable and well-documented; codebase patterns are directly readable
- Architecture: HIGH - Changes are minimal and follow existing patterns exactly; no new abstractions needed
- Pitfalls: MEDIUM - Thinking mode interaction with structured output is not fully verified; CPU speed is extrapolated
- Model choice: MEDIUM - Qwen3-4B performance claims are from Qwen team benchmarks, not independent grading-specific tests

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (Ollama API is stable; model recommendations may shift with new releases)
