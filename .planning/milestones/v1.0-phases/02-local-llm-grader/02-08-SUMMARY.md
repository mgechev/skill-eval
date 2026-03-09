---
phase: 02-local-llm-grader
plan: 08
subsystem: testing
tags: [bash, spawn, path, msys2, env-vars, sanitization]

# Dependency graph
requires:
  - phase: 02-local-llm-grader
    provides: "LocalProvider runCommand, bootstrap test suite"
provides:
  - "Robust bash subprocess spawning with --norc --noprofile"
  - "PATH case-variant deduplication for Windows compatibility"
  - "BASH_ENV/ENV deletion via delete (not undefined assignment)"
  - "Looser PATH assertion (precedes /usr/bin, not necessarily first)"
  - "Secret sanitization assertion that passes when env var never reaches subprocess"
affects: [02-local-llm-grader, 03-ci-evaluation-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: ["spawn('bash', ['--norc','--noprofile','-c', cmd]) for subprocess isolation"]

key-files:
  created: []
  modified:
    - src/providers/local.ts
    - tests/local-provider.test.ts
    - tests/bootstrap.test.ts

key-decisions:
  - "Use explicit bash invocation with --norc --noprofile instead of shell:'bash' to prevent MSYS2 login-shell PATH rebuilding"
  - "Delete PATH case-variants via loop over Object.keys instead of hardcoding 'Path' and 'PATH'"
  - "Assert bin/ precedes /usr/bin rather than asserting it is first PATH entry"
  - "Secret sanitization test only checks absence of raw secret (not presence of [REDACTED] marker)"

patterns-established:
  - "Subprocess isolation: always spawn bash with --norc --noprofile to prevent startup scripts from modifying env"
  - "PATH dedup: delete all case-variants before setting canonical PATH on Windows"

requirements-completed: [GRADE-01, GRADE-04, GRADE-07]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 2 Plan 08: Gap Closure Summary

**Fixed bash subprocess PATH propagation via --norc --noprofile spawn and corrected UAT test assertions for PATH ordering and secret sanitization**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T00:32:05Z
- **Completed:** 2026-03-09T00:34:36Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed LocalProvider.runCommand to spawn bash with explicit --norc --noprofile args, preventing MSYS2 login-shell from rebuilding PATH
- Eliminated PATH case-variant collision on Windows by deleting all variants (Path, path, PATH) before composing childEnv
- Replaced BASH_ENV/ENV undefined assignment with proper delete to fully remove keys from child env
- Relaxed Test 1 assertion from "bin/ is first on PATH" to "bin/ is in PATH and precedes /usr/bin"
- Fixed bootstrap Test 5 false-negative: removed else branch that failed when env var never reached subprocess

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix LocalProvider env var propagation and PATH augmentation (TDD)**
   - `15b5ead` test(02-08): add env var suppression test for LocalProvider
   - `a31f70f` fix(02-08): fix LocalProvider env var propagation and PATH augmentation
2. **Task 2: Fix test assertions for PATH ordering and secret sanitization** - `698b559` fix(02-08): fix test assertions for PATH ordering and secret sanitization

_Note: Task 1 used TDD flow (RED: test commit, GREEN: implementation commit)_

## Files Created/Modified
- `src/providers/local.ts` - Fixed runCommand: explicit bash --norc --noprofile spawn, PATH case-variant dedup, BASH_ENV/ENV deletion
- `tests/local-provider.test.ts` - Relaxed Test 1 PATH assertion, added Test 4 for BASH_ENV/ENV absence
- `tests/bootstrap.test.ts` - Simplified Test 5 sanitization: only fail if raw secret is present in logs

## Decisions Made
- Used explicit bash invocation with --norc --noprofile instead of shell:'bash' to prevent MSYS2 login-shell PATH rebuilding
- Delete PATH case-variants via loop over Object.keys instead of hardcoding 'Path' and 'PATH'
- Assert bin/ precedes /usr/bin rather than asserting it is first PATH entry -- matches user requirement "bin/ IS in PATH and precedes other binaries"
- Secret sanitization test only checks absence of raw secret (not presence of [REDACTED] marker) -- the security property is "secret not leaked", not "secret was redacted"

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Test 4 (BASH_ENV/ENV absence) passed immediately in RED phase because BASH_ENV and ENV are not set in the current development environment's process.env. The test is still valuable as a regression guard for environments where these variables are set (e.g., CI with .bashrc sourced). The TDD cycle was adapted: test committed as-is since it correctly validates the invariant.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All Phase 2 gap-closure plans complete (02-01 through 02-08)
- LocalProvider PATH propagation and env var handling robust across MSYS2/Git Bash
- Ready for Phase 2.1 (grader model optimization) or Phase 3 (CI evaluation pipeline)

## Self-Check: PASSED

- [x] src/providers/local.ts exists
- [x] tests/local-provider.test.ts exists
- [x] tests/bootstrap.test.ts exists
- [x] 02-08-SUMMARY.md exists
- [x] Commit 15b5ead found
- [x] Commit a31f70f found
- [x] Commit 698b559 found

---
*Phase: 02-local-llm-grader*
*Completed: 2026-03-09*
