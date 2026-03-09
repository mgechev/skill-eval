# Phase 2: Local LLM Grader - Qwen3 Thinking Mode Research

**Researched:** 2026-03-09
**Domain:** Qwen3 thinking mode control in Ollama API
**Confidence:** HIGH

## Summary

Qwen3 models default to "thinking mode" which emits `<think>...</think>` blocks before the actual response. On CPU-only hardware, this consumes the entire `num_predict` token budget on chain-of-thought tokens, producing empty visible responses or timeouts. The `think: false` API parameter (Ollama v0.9.0+) can disable thinking, but only on hybrid model variants — thinking-only variants (`-thinking-2507`) silently ignore it.

The default `qwen3:4b` tag has drifted over time and may now resolve to a thinking-only variant, making `think: false` a no-op. This was confirmed by direct testing: qwen3:4b consumed all 256 `num_predict` tokens on `<think>` blocks, producing empty JSON responses regardless of `think: false` or `/nothink` prompt directives.

**Primary recommendation:** Avoid Qwen3 entirely for grading. Use non-thinking models (phi3.5:3.8b, qwen2.5:3b). If Qwen3 is desired, use `qwen3:4b-instruct-2507-q4_K_M` — an architecturally non-thinking model that never emits `<think>` tokens.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Ollama API `think` parameter | v0.9.0+ | Disable thinking at protocol level | Top-level boolean in request body (not `options`); runtime-enforced on hybrid models |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `think: false` API param | `/no_think` prompt prefix | Soft switch — model trained to respect but not runtime-enforced |
| `think: false` API param | Custom Modelfile with `SYSTEM "/no_think"` | Persistent but still a soft signal |
| `qwen3:4b` hybrid | `qwen3:4b-instruct-2507-q4_K_M` | Architecturally non-thinking; no API parameter needed; 256K context |

## Architecture Patterns

### Pattern 1: Thinking Mode Control via API
**What:** Top-level `think` boolean in Ollama API request body.
**When to use:** When calling hybrid Qwen3 models that support both thinking and non-thinking modes.
**Example:**
```json
{
  "model": "qwen3:4b",
  "messages": [{ "role": "user", "content": "Grade this session..." }],
  "think": false,
  "stream": false
}
```

### Pattern 2: Inline Soft Switch
**What:** `/no_think` prefix in user message or system prompt.
**When to use:** As a fallback on older Ollama versions (pre-v0.9.0) or when API parameter is unavailable.
**Example:**
```json
{
  "role": "system",
  "content": "/no_think"
}
```
Note: The canonical tag is `/no_think` (with underscore), not `/nothink`.

### Pattern 3: Modelfile Permanent Override
**What:** Create a custom Modelfile that embeds `/no_think` as persistent system prompt.
**When to use:** When the same model should always run in non-thinking mode.
**Example:**
```
FROM qwen3:4b-q4_K_M
SYSTEM "/no_think"
```
Then: `ollama create qwen3-nothink -f Modelfile`

### Anti-Patterns to Avoid
- **Assuming `think: false` works on all Qwen3 variants:** Thinking-only variants (`-thinking-2507`) silently ignore it. Always verify the tag resolves to a hybrid or instruct variant.
- **Using `qwen3:4b` without pinning the tag:** The default tag drifts between hybrid and thinking-only variants across Ollama library updates.
- **Putting `think` inside `options`:** It is a top-level request body parameter, not an option. Placing it in `options` has no effect.

## Common Pitfalls

### Pitfall 1: Silently Ignored `think: false`
**What goes wrong:** Setting `think: false` produces no effect; model still emits `<think>` blocks.
**Why it happens:** The model tag resolves to a thinking-only variant (`-thinking-2507`), which architecturally cannot disable thinking. The API accepts the parameter without error.
**How to avoid:** Pin the tag explicitly. Use `qwen3:4b-q4_K_M` (hybrid) or `qwen3:4b-instruct-2507-q4_K_M` (non-thinking). Verify with `ollama show <model>` that the template includes thinking toggle support.
**Warning signs:** All `num_predict` tokens consumed; `response` field is empty; `eval_count` equals `num_predict`.

### Pitfall 2: Token Budget Exhaustion on Thinking
**What goes wrong:** The model uses the entire `num_predict` budget (e.g., 256 or 512 tokens) on `<think>` chain-of-thought before producing any visible answer.
**Why it happens:** Thinking models allocate tokens to reasoning first. On CPU hardware with lower `num_predict` to meet timeout budgets, this leaves zero tokens for the actual response.
**How to avoid:** Use non-thinking models for latency-sensitive tasks. If using thinking models, set `num_predict` to at least 2048 (but this may exceed timeout budgets on CPU).
**Warning signs:** Response times approach the timeout; `response` field is empty or truncated mid-JSON.

### Pitfall 3: Tag Drift in Ollama Library
**What goes wrong:** `qwen3:4b` resolved to the hybrid variant when you tested, but after a library update it resolves to `thinking-2507`, breaking production.
**Why it happens:** Ollama's library tags are mutable. The `qwen3:4b` default tag can point to different model variants over time.
**How to avoid:** Always use fully-qualified tags in configuration: `qwen3:4b-q4_K_M` or `qwen3:4b-instruct-2507-q4_K_M`.
**Warning signs:** Grading suddenly starts timing out or producing empty responses after an `ollama pull`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thinking token filtering | Custom `<think>` regex stripping from response | `think: false` API parameter or instruct-only model | Runtime-level suppression is more reliable than post-processing; regex may miss edge cases |
| Model variant detection | Parsing model metadata to detect thinking capability | Explicit tag pinning (`-instruct-2507-q4_K_M`) | Simpler, more predictable, no runtime introspection needed |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No thinking control | `think: true/false` boolean | Ollama v0.9.0 (May 2025) | Runtime-level control on hybrid models |
| Boolean only | String intensity (`"low"`, `"medium"`, `"high"`) | Ollama v0.17.x (2026) | Granular thinking budget; booleans still work |
| Single Qwen3 variant | Three variant families (hybrid, thinking-only, instruct) | Qwen3 2507 release (Jul 2025) | Must select variant explicitly |

## Model Variant Reference

| Tag | Type | `think: false` works? | Size | Context |
|-----|------|----------------------|------|---------|
| `qwen3:4b` | Hybrid (original) | Yes | 2.6 GB | 40K |
| `qwen3:4b-q4_K_M` | Hybrid | Yes | 2.6 GB | 40K |
| `qwen3:4b-thinking-2507-q4_K_M` | Thinking-only | No | 2.5 GB | 256K |
| `qwen3:4b-instruct-2507-q4_K_M` | Instruct (no thinking) | N/A -- never generates `<think>` | 2.5 GB | 256K |

## Open Questions

1. **Current default tag resolution for `qwen3:4b`**
   - What we know: The tag is mutable; it pointed to hybrid originally, may now point to thinking-2507
   - What's unclear: Exact current resolution varies by Ollama library version
   - Recommendation: Always use fully-qualified tags; do not rely on default `qwen3:4b`

## Sources

### Primary (HIGH confidence)
- [Thinking - Ollama Docs](https://docs.ollama.com/capabilities/thinking) - API parameter specification
- [Thinking - Ollama Blog](https://ollama.com/blog/thinking) - v0.9.0 announcement, both endpoints confirmed
- [Release v0.9.0 - ollama/ollama](https://github.com/ollama/ollama/releases/tag/v0.9.0) - `think` parameter introduction
- [qwen3 library tags - ollama.com](https://ollama.com/library/qwen3/tags) - variant tag listing

### Secondary (MEDIUM confidence)
- [qwen3:4b Can't turn off thinking - Issue #12917](https://github.com/ollama/ollama/issues/12917) - confirms thinking-only tag behavior
- [Can't disable thinking for qwen3:30b - Issue #12610](https://github.com/ollama/ollama/issues/12610) - cross-confirms silent ignore on thinking-only
- [QwenLM/Qwen3 GitHub](https://github.com/QwenLM/Qwen3) - variant family documentation

### Tertiary (LOW confidence)
- Direct testing on local Snapdragon X Elite hardware (2026-03-09) -- confirmed qwen3:4b empty responses

## Metadata

**Confidence breakdown:**
- Thinking API parameter: HIGH - verified via official docs and release notes
- Model variant behavior: HIGH - confirmed by GitHub issues and direct testing
- Tag drift risk: MEDIUM - documented in issues but exact current resolution varies

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (Ollama tag resolution may change with library updates)
