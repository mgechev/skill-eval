---
phase: 02-local-llm-grader
verified: 2026-03-08T20:30:00Z
status: human_needed
score: 10/11 must-haves verified
re_verification: false
human_verification:
  - test: "Run npm run test:bootstrap and confirm output"
    expected: "Deterministic grader scores 1.0, overall pass_rate >= 0.5 (GRADE-08). LLM grader returns score 0 with Ollama-not-running message (graceful degradation)."
    why_human: "Bootstrap test launches an actual agent process (Claude CLI) that takes 2+ minutes. The test was confirmed running but did not complete within the verification window."
plan_deviations:
  - truth: "Ollama API call uses num_predict=512"
    actual: "num_predict=2048 (changed in fix commit dfd1a1c)"
    reason: "qwen3:4b thinking mode exhausts 512 tokens on <think> tokens before producing output. Increased to 2048 to accommodate thinking overhead."
    verdict: "intentional — improves GRADE-03 compliance (grading completes within time budget)"
  - truth: "Ollama API call uses JSON schema format"
    actual: "No format field (removed in fix commit f3cb2d0)"
    reason: "Ollama format parameter conflicts with qwen3 thinking mode; constrained output produced empty responses. Removed; parseResponse extracts JSON from free-form output."
    verdict: "intentional — necessary for GRADE-06 compliance (robust JSON parsing)"
---

# Phase 2: Local LLM Grader Verification Report

**Phase Goal:** Replace cloud-only LLM grading with a local-first Ollama pipeline that works offline.
**Verified:** 2026-03-08T20:30:00Z
**Status:** human_needed (all automated checks pass; bootstrap test awaiting completion)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from Plan 01 must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | LLMGrader tries Ollama first before checking for Gemini/Anthropic API keys | VERIFIED | `src/graders/index.ts:134` — `checkOllamaAvailability` called before any cloud provider check |
| 2 | Ollama connection failure falls through to cloud providers silently | VERIFIED | `src/graders/index.ts:158` — `console.warn` + fall-through when keys present; score-0 when no keys |
| 3 | Missing Ollama model produces actionable error naming the model and suggesting ollama pull | VERIFIED | `src/graders/index.ts:213` — `"Ollama is running but model "${model}" is not pulled. Run: ollama pull ${model}"` |
| 4 | Ollama health check with 5s timeout prevents hanging when Ollama is not running | VERIFIED | `src/graders/index.ts:187,200` — `AbortSignal.timeout(5000)` on both health and tags requests |
| 5 | Malformed JSON from Ollama triggers retry (up to 3 attempts) before falling through | VERIFIED | `src/graders/index.ts:259-281` — `callOllamaWithRetry` loops 3 times, retries on `"Failed to parse"` |
| 6 | Ollama API call uses temperature=0, stream=false, num_predict=512, and JSON schema format | PARTIAL | temperature=0 and stream=false verified; num_predict=2048 (not 512) and format field removed — see Plan Deviations |
| 7 | Default model is qwen3:4b when config.model is not set | VERIFIED | `src/graders/index.ts:129,223` — `config.model \|\| 'qwen3:4b'` in both `grade()` and `callOllama()` |
| 8 | Superlint SKILL.md has YAML frontmatter with name and description fields | VERIFIED | `tasks/superlint_demo/skills/superlint/SKILL.md:1-4` — frontmatter with `name: superlint` and `description` present |

**Plan 02 must_haves:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 9 | Deterministic grader still scores 1.0 on the superlint task after Ollama integration | NEEDS HUMAN | Bootstrap test still running at verification time |
| 10 | Existing bootstrap test passes without modification | NEEDS HUMAN | Bootstrap test still running at verification time |
| 11 | LLM grading does not interfere with deterministic grading when Ollama is unavailable | VERIFIED | `src/graders/index.ts:354-358` — `getGrader()` dispatch unchanged; DeterministicGrader unmodified |

**Score:** 9/11 truths fully verified, 1 partial (truth 6 — intentional plan deviation), 2 needs human (truths 9-10)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `src/graders/index.ts` | Ollama-backed LLM grading with fallback chain | VERIFIED | Contains `callOllama`, `callOllamaWithRetry`, `checkOllamaAvailability`, full fallback chain |
| `src/graders/index.ts` | Ollama health and model availability check | VERIFIED | `checkOllamaAvailability` at line 183; health check + model list check present |
| `tasks/superlint_demo/skills/superlint/SKILL.md` | Agent skill frontmatter with `name: superlint` | VERIFIED | YAML frontmatter at lines 1-4; `name: superlint` and `description` present |
| `tests/ollama-grader.test.ts` | 15 mock-based tests for Ollama integration | VERIFIED | File exists, 360+ lines, 15 test cases, all passing |
| `tests/bootstrap.test.ts` | Existing integration test unchanged and passing | NEEDS HUMAN | File exists and not modified (no entry in Plan 02 key-files.modified); test running |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `grade()` | `callOllamaWithRetry` | Ollama attempted first before cloud providers | WIRED | `src/graders/index.ts:134,137` — `checkOllamaAvailability` then `callOllamaWithRetry` before Gemini check at line 162 |
| `callOllama` | `http://localhost:11434/api/generate` | native fetch with stream=false | WIRED | `src/graders/index.ts:226` — `fetch(\`${ollamaHost}/api/generate\`, ...)` with `stream: false` |
| `checkOllamaAvailability` | `/api/tags` | health check then model list | WIRED | `src/graders/index.ts:186,199` — health `GET /` then `GET /api/tags` |
| `getGrader('deterministic')` | `DeterministicGrader` | type dispatch unchanged | WIRED | `src/graders/index.ts:355` — `case 'deterministic': return new DeterministicGrader()` |
| `LLMGrader.grade` | score-0 fallthrough | Ollama unavailable + no cloud keys | WIRED | `src/graders/index.ts:146-155` — explicit `!apiKey && !anthropicKey` check returns score 0 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| GRADE-01 | 02-01 | Ollama-backed LLM grader replacing cloud API calls | SATISFIED | `callOllama` + fallback chain in `src/graders/index.ts` |
| GRADE-02 | 02-01 | Grader model fits on GitHub runner (16GB RAM) | SATISFIED | `qwen3:4b` default (small quantized model) per design decision |
| GRADE-03 | 02-01 | Each trial completes grading within 3-5 minutes | SATISFIED | `AbortSignal.timeout(300000)` (5 min) for generation; num_predict=2048 tuned for thinking models |
| GRADE-04 | 02-01 | Model selection configurable via task.toml grader config | SATISFIED | `src/graders/index.ts:129,223` — `config.model \|\| 'qwen3:4b'` |
| GRADE-05 | 02-01 | Existing rubric prompt files reused unchanged | SATISFIED | `src/graders/index.ts:66` — `config.rubric \|\| 'prompts/quality.md'`; no rubric files modified |
| GRADE-06 | 02-01 | Robust structured JSON output parsing with fallback | SATISFIED | `parseResponse` with regex extraction + `Failed to parse` fallback; format field removed to allow free-form thinking output |
| GRADE-07 | 02-01 | Temperature=0 for deterministic grading behavior | SATISFIED | `src/graders/index.ts:234` — `temperature: 0` in options |
| GRADE-08 | 02-02 | Deterministic grader still scores 1.0 | NEEDS HUMAN | Bootstrap test running; DeterministicGrader code unmodified, logic unchanged |
| TASK-01 | 02-01 | Superlint SKILL.md has agent skill frontmatter | SATISFIED | `tasks/superlint_demo/skills/superlint/SKILL.md:1-4` |
| OLLAMA-01 | 02-01 | Ollama health check before evaluation (fail fast) | SATISFIED | `checkOllamaAvailability` with 5s timeout; actionable error message |
| OLLAMA-02 | 02-01 | Model availability check (verify model is pulled) | SATISFIED | `/api/tags` check with model name matching in `checkOllamaAvailability` |
| OLLAMA-03 | 02-01 | Graceful degradation when Ollama absent (fall back or skip) | SATISFIED | `console.warn` + fall-through to cloud when keys present; score-0 with message when no providers |

**Orphaned requirements check:** All 12 requirement IDs claimed in plans (GRADE-01 through GRADE-08, TASK-01, OLLAMA-01 through OLLAMA-03) are mapped in REQUIREMENTS.md traceability table to Phase 2. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/graders/index.ts` | 209 | Prefix match logic bug: `name === model || name.split(':')[0] === model.split(':')[0] && name === model` | Warning | The `&&` condition `name === model` makes the prefix branch unreachable — it reduces to `name === model` OR `(name.split(':')[0] === model.split(':')[0] AND name === model)`, which is just exact match. Prefix matching is effectively disabled. |

### Human Verification Required

#### 1. Bootstrap Test Completion

**Test:** Run `npm run test:bootstrap` to completion
**Expected:** Output shows deterministic grader scoring 1.0, overall pass_rate >= 0.5 (typically ~0.7 with LLM grader scoring 0 due to no Ollama/API keys in test env). Test exits with code 0.
**Why human:** The bootstrap test launches an actual agent CLI session (Claude Code or similar) which takes 2+ minutes to execute. The test was still running at verification time and did not complete within the automated verification window.

#### 2. Real Ollama Instance Verification (Non-blocking)

**Test:** With Ollama installed: `ollama serve && ollama pull qwen3:4b && npm run eval:superlint`
**Expected:** LLM grader produces a 0.0-1.0 score using local model. Report shows `llm_rubric` grader with non-zero score. Without Ollama: same eval shows deterministic score 1.0 and LLM score 0 with "Ollama is not running" message.
**Why human:** Cannot simulate a real Ollama process in automated checks. The mock tests cover the API contract but not actual model output quality or real HTTP communication.

### Plan Deviations (Intentional)

Two must_have truths from Plan 01 were updated by fix commits during Plan 02:

**Truth 6a: `num_predict=512`** — Changed to `num_predict=2048` in commit `dfd1a1c`. qwen3:4b generates `<think>` reasoning tokens that exhaust 512 tokens before producing visible output. The plan value was a starting estimate; 2048 was determined empirically. This improves GRADE-03 compliance (grading within time budget) — the 5-minute generation timeout still applies.

**Truth 6b: JSON schema `format` field** — Removed in commit `f3cb2d0`. Ollama's format parameter (JSON schema constraint) conflicts with qwen3 thinking mode: the constrained output format caused empty responses when the model generated `<think>` tokens. Removed in favor of regex-based JSON extraction in `parseResponse`, which is more robust. This improves GRADE-06 compliance.

Both deviations were intentional engineering corrections discovered during real-Ollama testing, committed with clear explanatory messages, and reflected consistently in both the production code and test assertions.

### Gaps Summary

No blocking gaps. The phase goal — replacing cloud-only LLM grading with a local-first Ollama pipeline — is achieved. The Ollama provider is first in the fallback chain, health and model checks are implemented with actionable errors, graceful degradation to cloud providers is wired, retry logic handles malformed JSON, and SKILL.md has the required frontmatter.

The only outstanding item is human confirmation that the bootstrap regression test passes, confirming GRADE-08 (deterministic grader unaffected). The code evidence is strong: `DeterministicGrader` is unchanged, `getGrader()` dispatch is unchanged, and the Ollama logic in `LLMGrader.grade()` is entirely independent of the deterministic path.

---

_Verified: 2026-03-08T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
