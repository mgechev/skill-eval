---
phase: 02-local-llm-grader
plan: 01
subsystem: grading
tags: [ollama, llm, grading, fallback-chain, local-inference]

# Dependency graph
requires:
  - phase: 01-ci-foundation
    provides: CI pipeline for typecheck/build/test verification
provides:
  - Ollama-backed LLM grading with fallback chain (Ollama -> Gemini -> Anthropic)
  - Health check and model availability check for Ollama
  - Retry logic for malformed JSON responses from local LLMs
  - SKILL.md agent frontmatter for auto-discovery
affects: [02-local-llm-grader, 03-ci-evaluation-pipeline]

# Tech tracking
tech-stack:
  added: [ollama-api]
  patterns: [provider-fallback-chain, health-check-before-use, retry-with-backoff, json-schema-structured-output]

key-files:
  created:
    - tests/ollama-grader.test.ts
  modified:
    - src/graders/index.ts
    - tasks/superlint_demo/skills/superlint/SKILL.md
    - package.json

key-decisions:
  - "Ollama is a provider within existing llm_rubric type, not a new grader type"
  - "Default model qwen3:4b chosen for small footprint on 16GB RAM runners"
  - "JSON schema format object in Ollama API for structured output instead of format:'json' string"
  - "5s timeout for health check, 5min timeout for generation"
  - "Retry up to 3 times on parse failure but no retry on connection error"

patterns-established:
  - "Provider fallback chain: Ollama (local) -> Gemini (cloud) -> Anthropic (cloud)"
  - "Health check before use: checkOllamaAvailability validates server and model before grading"
  - "Graceful degradation: warn and fall through to cloud when Ollama absent but keys present"
  - "Fail fast: return actionable error when no providers available"

requirements-completed: [GRADE-01, GRADE-02, GRADE-03, GRADE-04, GRADE-05, GRADE-06, GRADE-07, OLLAMA-01, OLLAMA-02, OLLAMA-03, TASK-01]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 2 Plan 01: Ollama Grader Integration Summary

**Ollama-first LLM grading fallback chain with health checks, retry logic, JSON schema structured output, and SKILL.md agent frontmatter**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T18:05:54Z
- **Completed:** 2026-03-08T18:11:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Ollama is the first provider attempted in LLMGrader.grade() fallback chain, with no API keys required
- Health check with 5s timeout and model availability check fail fast with actionable error messages
- Graceful degradation to cloud graders when Ollama absent but API keys present
- Retry logic (up to 3 attempts) for malformed JSON responses from local LLMs
- SKILL.md has YAML frontmatter with name and description for agent CLI auto-discovery
- All 15 mock-based Ollama tests pass; existing bootstrap tests unaffected

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SKILL.md agent frontmatter** - `250d0dc` (feat)
2. **Task 2: Implement Ollama provider (RED)** - `a27bc7b` (test)
3. **Task 2: Implement Ollama provider (GREEN)** - `e6d7231` (feat)

_Note: Task 2 is TDD with RED (failing tests) and GREEN (implementation) commits._

## Files Created/Modified
- `tests/ollama-grader.test.ts` - 15 mock-based tests for Ollama grader integration
- `src/graders/index.ts` - Ollama provider with checkOllamaAvailability, callOllama, callOllamaWithRetry methods
- `tasks/superlint_demo/skills/superlint/SKILL.md` - Added YAML frontmatter for agent CLI auto-discovery
- `package.json` - Added test:ollama-grader script

## Decisions Made
- Ollama is a provider within existing `llm_rubric` type, not a new grader type (per user decision)
- Default model `qwen3:4b` for small footprint on 16GB RAM GitHub runners
- Used JSON schema object in Ollama API `format` field for structured output (not `format: "json"` string)
- 5-second timeout for health check, 5-minute timeout for generation
- Retry up to 3 times on parse failure (malformed JSON), no retry on connection error

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- TypeScript `RequestInfo` type not available in ES2024 lib -- replaced with `string | URL | Request` in test file. Minor type compatibility fix, no behavioral impact.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Ollama grader integration complete, ready for Plan 02 regression verification with real Ollama
- SKILL.md frontmatter in place for agent CLI auto-discovery
- All mock tests passing; real Ollama verification deferred to Plan 02

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 02-local-llm-grader*
*Completed: 2026-03-08*
