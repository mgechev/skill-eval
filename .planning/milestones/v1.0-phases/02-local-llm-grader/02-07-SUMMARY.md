---
phase: 02-local-llm-grader
plan: 07
subsystem: grading
tags: [ollama, llm-grading, timeout, num_ctx, diagnostics]

# Dependency graph
requires:
  - phase: 02-local-llm-grader (plans 01-06)
    provides: Ollama LLM grader integration with retry logic and model detection
provides:
  - GraderConfig timeout_ms and num_ctx configuration fields
  - 60s default timeout replacing 5-minute hardcoded timeout
  - Explicit num_ctx 4096 preventing Ollama's 2048 default truncation
  - Per-grader diagnostic output when scores are below 0.5
affects: [03-analytics-dashboard, task-toml-authoring]

# Tech tracking
tech-stack:
  added: []
  patterns: [configurable-timeout-with-defaults, explicit-context-window-sizing, diagnostic-output-on-failure]

key-files:
  created: []
  modified:
    - src/types.ts
    - src/graders/index.ts
    - src/evalRunner.ts

key-decisions:
  - "60s default timeout for LLM grading (down from 5min) -- single response grading should not take 5 minutes"
  - "num_ctx 4096 default -- prevents Ollama's 2048 default which silently truncates grading prompts"
  - "Print grader details for scores below 0.5, not just 0 -- catches partial failures too"

patterns-established:
  - "Config-with-sensible-defaults: optional fields with ?? fallback (timeout_ms ?? 60000, num_ctx ?? 4096)"

requirements-completed: [GRADE-01, GRADE-02, GRADE-03]

# Metrics
duration: 2min
completed: 2026-03-08
---

# Phase 2 Plan 7: Ollama Timeout and Context Fix Summary

**60s timeout with explicit num_ctx 4096 for Ollama grading, plus per-grader failure diagnostics in eval output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T22:51:23Z
- **Completed:** 2026-03-08T22:53:00Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added configurable timeout_ms and num_ctx fields to GraderConfig for task.toml authors
- Fixed callOllama to use 60s default timeout (was 5min) and explicit num_ctx 4096 (prevents Ollama's 2048 truncation default)
- evalRunner now prints per-grader detail lines when any grader scores below 0.5, surfacing parse failures and timeout errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add timeout_ms and num_ctx to GraderConfig** - `df79dbf` (feat)
2. **Task 2: Fix callOllama timeout and add num_ctx to API call** - `5ac9b4a` (fix)
3. **Task 3: Print grader details in evalRunner when score is low** - `5bf4c0b` (feat)

## Files Created/Modified
- `src/types.ts` - Added timeout_ms and num_ctx optional fields to GraderConfig interface
- `src/graders/index.ts` - Updated callOllama: 60s timeout, num_ctx 4096, thinking model comment
- `src/evalRunner.ts` - Added per-grader detail output for scores below 0.5

## Decisions Made
- 60s default timeout for LLM grading (down from 5min) -- grading a single completed response should not take 5 minutes
- num_ctx 4096 default -- Ollama defaults to 2048 (NOT model's native 32K), which silently truncates grading prompts (~825 tokens) + response budget (2048 num_predict) = ~2900 tokens needed
- Print grader details for all scores below 0.5 (not just 0) -- catches partial failures and makes debugging easier

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 2 (Local LLM Grader) is now complete with all 7 plans executed
- Ollama integration has correct timeout, context window, and diagnostic output
- Ready for Phase 3 (Analytics Dashboard) development

## Self-Check: PASSED

- All 3 source files exist and contain expected patterns
- All 3 task commits verified in git log (df79dbf, 5ac9b4a, 5bf4c0b)
- tsc --noEmit passes, all 19 Ollama grader tests pass

---
*Phase: 02-local-llm-grader*
*Completed: 2026-03-08*
