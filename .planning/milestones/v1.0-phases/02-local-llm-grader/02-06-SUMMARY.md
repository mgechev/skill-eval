---
phase: 02-local-llm-grader
plan: 06
subsystem: testing
tags: [spawn, path, bash, windows, msys2, ebusy]

# Dependency graph
requires:
  - phase: 02-local-llm-grader
    provides: LocalProvider with runCommand and PATH augmentation
provides:
  - LocalProvider.runCommand with colon PATH separator and BASH_ENV suppression
  - Retry-tolerant test cleanup for Windows file-locking
affects: [02-local-llm-grader, 03-ci-integration]

# Tech tracking
tech-stack:
  added: []
  patterns: [colon-separated PATH for bash spawn on Windows, removeWithRetry for EBUSY tolerance]

key-files:
  created: []
  modified:
    - src/providers/local.ts
    - tests/local-provider.test.ts

key-decisions:
  - "Hardcode colon separator instead of path.delimiter for bash shell PATH construction"
  - "Suppress BASH_ENV and ENV via undefined in spawn env to prevent startup file sourcing"
  - "Retry up to 5 times with 200ms delay for Windows EBUSY on temp dir cleanup"

patterns-established:
  - "removeWithRetry pattern: retry fs.remove with exponential-ish backoff for Windows file-locking"

requirements-completed: [TASK-01]

# Metrics
duration: 2min
completed: 2026-03-08
---

# Phase 2 Plan 06: PATH and Env Isolation Fix Summary

**Colon PATH separator and BASH_ENV suppression for reliable bash spawn on Windows, with EBUSY-tolerant test cleanup**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T22:46:31Z
- **Completed:** 2026-03-08T22:48:21Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Fixed LocalProvider.runCommand to use colon separator for PATH in bash shells instead of platform-dependent path.delimiter
- Added BASH_ENV and ENV suppression to prevent bash startup files from reordering PATH or clearing env vars
- Added removeWithRetry helper to tolerate Windows EBUSY/EPERM file-locking during test cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix LocalProvider PATH construction and env isolation** - `8146578` (fix)
2. **Task 2: Add cleanup retry in local-provider tests for Windows EBUSY** - `1b35ed1` (fix)

## Files Created/Modified
- `src/providers/local.ts` - PATH uses ":" colon, BASH_ENV/ENV set to undefined in spawn env
- `tests/local-provider.test.ts` - Added removeWithRetry helper, replaced 3 bare fs.remove calls

## Decisions Made
- Hardcoded ":" colon instead of path.delimiter because bash always uses colon-separated PATH regardless of platform
- Set BASH_ENV and ENV to undefined (not empty string) so they are absent from child process env
- Retry parameters (5 retries, 200ms delay) chosen to handle typical Windows Defender/Search Indexer scan locks

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tests passed before and after changes. The colon separator fix is a correctness improvement for environments where path.delimiter=";" would break MSYS2/Git Bash PATH parsing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LocalProvider PATH and env isolation is now robust across Windows/Linux
- All 3 local-provider tests pass reliably
- Ready for CI integration testing

## Self-Check: PASSED

- [x] src/providers/local.ts exists
- [x] tests/local-provider.test.ts exists
- [x] 02-06-SUMMARY.md exists
- [x] Commit 8146578 exists
- [x] Commit 1b35ed1 exists

---
*Phase: 02-local-llm-grader*
*Completed: 2026-03-08*
