---
phase: 02-local-llm-grader
plan: 04
subsystem: providers
tags: [local-provider, PATH, bin, spawn, bash, cross-platform]

# Dependency graph
requires:
  - phase: 02-local-llm-grader
    provides: LocalProvider with setup/cleanup/runCommand
provides:
  - workspace bin/ prepended to PATH in spawned processes
  - task-provided CLI tools discoverable by name without absolute paths
affects: [02-05, eval-runner, local-provider]

# Tech tracking
tech-stack:
  added: []
  patterns: [PATH augmentation via path.delimiter for cross-platform support]

key-files:
  created: [tests/local-provider.test.ts]
  modified: [src/providers/local.ts]

key-decisions:
  - "Use path.delimiter for cross-platform PATH separator (: on Unix, ; on Windows)"
  - "PATH assignment after ...env spread to ensure workspace bin/ always takes precedence"
  - "Cross-platform test assertions using endsWith('/bin') and workspace ID matching instead of exact path comparison"

patterns-established:
  - "PATH augmentation: prepend workspace bin/ to PATH in env before spawning"
  - "Cross-platform test assertions: avoid exact path comparison when bash MSYS translation is involved"

requirements-completed: [GRADE-01]

# Metrics
duration: 2min
completed: 2026-03-08
---

# Phase 2 Plan 4: PATH Augmentation Summary

**LocalProvider.runCommand prepends workspace bin/ to PATH so task-provided CLIs are discoverable by name in spawned bash shells**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T21:16:48Z
- **Completed:** 2026-03-08T21:19:06Z
- **Tasks:** 1 (TDD: RED-GREEN)
- **Files modified:** 2

## Accomplishments
- LocalProvider.runCommand now prepends `${workspacePath}/bin` to PATH in the spawned process environment
- Task-provided CLI tools (e.g., superlint) are discoverable by name without absolute paths
- Custom env vars and existing PATH entries are preserved (PATH override is intentional for workspace bin/)
- Cross-platform support via `path.delimiter` instead of hardcoded `:`

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests** - `bfe91dd` (test)
2. **Task 1 (GREEN): Implement PATH fix + fix cross-platform test** - `9188bc9` (feat)

_TDD task: RED commit has failing tests, GREEN commit has implementation + passing tests_

## Files Created/Modified
- `tests/local-provider.test.ts` - 3 tests: bin on PATH, CLI executable by name, custom env preserved
- `src/providers/local.ts` - runCommand prepends workspace bin/ to PATH env

## Decisions Made
- Used `path.delimiter` for cross-platform PATH separator instead of hardcoded `:` -- works correctly on both Unix (`:`) and Windows (`;`)
- PATH assignment placed after `...env` spread so workspace bin/ always takes precedence even if caller provides a custom PATH
- Test 1 uses `endsWith('/bin')` + workspace ID matching instead of exact path comparison to handle Git Bash MSYS path translation on Windows

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed cross-platform path comparison in Test 1**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** Plan's Test 1 used exact `path.join(workspace, 'bin')` comparison, but on Windows with Git Bash, `echo "$PATH"` returns MSYS-translated paths (`/tmp/...`) not Windows paths (`C:\Users\...`)
- **Fix:** Changed assertion to verify first PATH entry endsWith `/bin` and contains the unique workspace directory name
- **Files modified:** tests/local-provider.test.ts
- **Verification:** All 3 tests pass on Windows with Git Bash
- **Committed in:** 9188bc9 (GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for cross-platform test correctness. No scope creep.

## Issues Encountered
None beyond the cross-platform path issue documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PATH augmentation complete, workspace bin/ is now discoverable
- Plan 02-05 (Node.js availability in LocalProvider workspace) can proceed independently
- Local evaluation end-to-end pipeline closer to working: "command not found" for task CLIs is resolved

## Self-Check: PASSED

- [x] `tests/local-provider.test.ts` exists
- [x] `src/providers/local.ts` exists
- [x] `02-04-SUMMARY.md` exists
- [x] Commit `bfe91dd` (RED) verified in git log
- [x] Commit `9188bc9` (GREEN) verified in git log

---
*Phase: 02-local-llm-grader*
*Completed: 2026-03-08*
