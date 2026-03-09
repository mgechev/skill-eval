---
phase: 03-ci-evaluation-pipeline
plan: 01
subsystem: grader
tags: [ollama, warmup, composite-action, ci, github-actions]

# Dependency graph
requires:
  - phase: 02.1-optimize-grader-model-selection
    provides: LLMGrader class with Ollama integration and benchmark-validated defaults
provides:
  - warmUp() method on LLMGrader eliminating cold-start timeout waste
  - Reusable setup-ollama composite action for CI workflows
affects: [03-ci-evaluation-pipeline]

# Tech tracking
tech-stack:
  added: [ai-action/setup-ollama@v2]
  patterns: [model-warmup-before-grading, composite-action-for-ollama-lifecycle]

key-files:
  created:
    - .github/actions/setup-ollama/action.yml
  modified:
    - src/graders/index.ts
    - tests/ollama-grader.test.ts

key-decisions:
  - "warmUp sets warmedUp=true before fetch (prevents retry if warmup fails)"
  - "120s warmup timeout via AbortSignal.timeout (1.5x worst observed 81s cold start)"
  - "Composite action env vars inline with ollama serve (apply to server process)"

patterns-established:
  - "Model warmup pattern: num_predict:1 request before real grading to pre-load model"
  - "Composite action pattern for Ollama: install, cache, start with env vars, wait, pull"

requirements-completed: [CI-03]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 3 Plan 01: Ollama Warmup and Setup Action Summary

**LLMGrader warmUp() with num_predict:1 pre-load and reusable setup-ollama composite action for CI**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T21:32:21Z
- **Completed:** 2026-03-09T21:35:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added warmUp() method to LLMGrader that sends a num_predict:1 request to pre-load the model before grading, eliminating 60s cold-start timeout waste on CI
- warmUp is non-blocking (failure logs warning, does not throw), Ollama-only, and fires once per instance
- Created reusable setup-ollama composite action with install, model caching, optimized env var server start, readiness wait loop, and model pull
- Added 5 new warmUp unit tests (TDD: RED then GREEN), all 24 tests pass
- Resolved pending todo: moved warmup todo from pending to done

## Task Commits

Each task was committed atomically:

1. **Task 1: Add warmUp method to LLMGrader with tests (TDD)**
   - `15f5d8f` (test): add failing warmUp tests for LLMGrader
   - `c91cf61` (feat): add warmUp method to LLMGrader with passing tests
2. **Task 2: Create setup-ollama composite action** - `3278d94` (feat)

## Files Created/Modified
- `src/graders/index.ts` - Added warmedUp flag and warmUp() method, called before grading in ollamaStatus.available branch
- `tests/ollama-grader.test.ts` - Added 5 warmUp tests (request body, no-repeat, non-blocking failure, Ollama-only, timeout signal)
- `.github/actions/setup-ollama/action.yml` - Reusable composite action: Ollama install, model cache, optimized server start, readiness check, model pull

## Decisions Made
- warmUp sets warmedUp=true before fetch to prevent retry if warmup itself fails
- 120s warmup timeout (1.5x worst observed cold start of 81s)
- Composite action sets env vars inline with `ollama serve &` so they apply to the server process

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- warmUp method ready for CI usage -- will reduce first-grading-call latency from ~81s to ~12s on CI
- setup-ollama composite action ready for use in skill-eval workflow (Plan 02)
- All existing tests continue to pass

## Self-Check: PASSED

- [x] `src/graders/index.ts` exists
- [x] `tests/ollama-grader.test.ts` exists
- [x] `.github/actions/setup-ollama/action.yml` exists
- [x] Todo moved to `done/`
- [x] Commits `15f5d8f`, `c91cf61`, `3278d94` verified in git log

---
*Phase: 03-ci-evaluation-pipeline*
*Completed: 2026-03-09*
