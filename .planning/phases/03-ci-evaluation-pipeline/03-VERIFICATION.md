---
phase: 03-ci-evaluation-pipeline
verified: 2026-03-09T22:55:00Z
status: passed
score: 7/7 must-haves verified
human_verification:
  - test: "Open a pull request on the local-skill-eval repository and observe the Skill Eval workflow run"
    expected: "Both eval-local and eval-docker jobs complete successfully"
    result: "VERIFIED via gh CLI — run 22876047788 and 22876405845 both passed with eval-local and eval-docker success"
  - test: "Run the Skill Eval workflow a second time on the same branch"
    expected: "Docker image cache hit on second run"
    result: "VERIFIED via gh CLI — run 22876405845 shows Load cached Docker image=success, Save Docker image to cache=skipped (cache hit)"
---

# Phase 3: CI Evaluation Pipeline Verification Report

**Phase Goal:** PRs automatically run skill evaluations with the local LLM grader on GitHub runners, with results available for cross-run comparison
**Verified:** 2026-03-09T22:55:00Z
**Status:** passed (all automated checks passed; human verification items satisfied via gh CLI)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | LLMGrader sends a num_predict:1 warmup request before the first real grading call | VERIFIED | `src/graders/index.ts:109` — `options: { num_predict: 1 }` inside `warmUp()`. `src/graders/index.ts:200` — `await this.warmUp(ollamaHost, model)` called before `callOllamaWithRetry`. 24/24 unit tests pass including warmUp test. |
| 2 | Warmup runs once per LLMGrader instance (warmedUp flag prevents repeat) | VERIFIED | `src/graders/index.ts:59` — `private warmedUp = false;`. `src/graders/index.ts:94-98` — guard returns early if already true, sets true before fetch. Test "warmUp does NOT send request on second call" passes. |
| 3 | Warmup failure is non-blocking — logs warning and proceeds to grading | VERIFIED | `src/graders/index.ts:115-118` — catch block logs `console.warn(...)` without re-throwing. Test "warmUp failure logs warning but does not throw" passes. |
| 4 | Warmup is Ollama-only — not called for Gemini or Anthropic paths | VERIFIED | `src/graders/index.ts:199-200` — `warmUp` call is inside `if (ollamaStatus.available)` block. Test "warmUp is NOT called when Ollama is unavailable" passes. |
| 5 | Composite action installs Ollama, caches models, starts server with optimized env vars, and waits for ready | VERIFIED | `.github/actions/setup-ollama/action.yml` has all 4 steps: `ai-action/setup-ollama@v2` install, `actions/cache@v5` for `~/.ollama`, `ollama serve &` with `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_NUM_THREAD=4`, and 30-iteration curl readiness wait loop. |
| 6 | A PR triggers the Skill Eval workflow with two parallel jobs (eval-local and eval-docker) | VERIFIED | `.github/workflows/skill-eval.yml` — `on: pull_request`, two jobs `eval-local` and `eval-docker` with no `needs:` dependency between them. `concurrency.cancel-in-progress: true` set. |
| 7 | Both jobs use setup-ollama composite action; eval results uploaded; npm run preview runs after evaluation | VERIFIED | Lines 27 and 46: `uses: ./.github/actions/setup-ollama`. Lines 29 and 62: `npm run validate -- superlint_demo --provider=local/docker`. Lines 31-32 and 72-73: `if: always()` + `npm run preview`. Lines 33-37 and 74-78: `upload-artifact@v4` with `if: always()`, named `eval-results-local` and `eval-results-docker`. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/graders/index.ts` | warmUp() method on LLMGrader class | VERIFIED | 441 lines. `warmUp()` at line 93, called at line 200. `warmedUp` flag at line 59, set at line 98. num_predict:1 at line 109. AbortSignal.timeout(120_000) at line 111. |
| `tests/ollama-grader.test.ts` | Warmup test cases | VERIFIED | 743 lines. 5 warmUp-specific tests at lines 589-725. All 24 tests pass (confirmed by `npx ts-node tests/ollama-grader.test.ts`). |
| `.github/actions/setup-ollama/action.yml` | Reusable composite action for Ollama setup in CI | VERIFIED | 55 lines. `using: 'composite'`. All `run:` steps have explicit `shell: bash` (2 occurrences confirmed). Installs, caches, starts with env vars, waits, pulls model. |
| `.github/workflows/skill-eval.yml` | Skill eval CI workflow with two parallel validate-mode jobs | VERIFIED | 79 lines. `name: Skill Eval`. `on: pull_request/push/workflow_dispatch`. Two parallel jobs. Docker image caching with content-hash key. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/graders/index.ts` | `/api/generate` | `warmUp()` fetch call with `num_predict:1` | WIRED | Line 103: `fetch(\`${ollamaHost}/api/generate\`, ...)`, line 109: `options: { num_predict: 1 }` |
| `src/graders/index.ts` | `grade()` | `warmUp` called between `checkOllamaAvailability` and `callOllamaWithRetry` | WIRED | Line 197: `checkOllamaAvailability`, line 199-200: `if (ollamaStatus.available) { await this.warmUp(...)`, line 202: `callOllamaWithRetry` |
| `.github/workflows/skill-eval.yml` | `.github/actions/setup-ollama/action.yml` | `uses: ./.github/actions/setup-ollama` | WIRED | Lines 27 and 46 in skill-eval.yml both reference the composite action |
| `.github/workflows/skill-eval.yml` | `npm run validate` | run step in each job | WIRED | Line 29: `npm run validate -- superlint_demo --provider=local`, line 62: `npm run validate -- superlint_demo --provider=docker` |
| `.github/workflows/skill-eval.yml` | `actions/upload-artifact@v4` | artifact upload with `if: always()` | WIRED | Lines 33-37 and 74-78, both with `if: always()`, distinct names `eval-results-local` and `eval-results-docker` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| CI-03 | 03-01-PLAN.md | Ollama installation and model caching across CI runs | SATISFIED | `.github/actions/setup-ollama/action.yml` — `ai-action/setup-ollama@v2` install step, `actions/cache@v5` on `~/.ollama` with model-keyed cache key. Exported to `GITHUB_ENV` for downstream steps. |
| CI-04 | 03-02-PLAN.md | Agent CLI and dependency caching across CI runs | SATISFIED | `setup-node` composite action (used in both workflow jobs) handles npm caching via `actions/setup-node@v4` with `cache: 'npm'`. Docker image caching via content-hash key + `docker save/load` in `eval-docker` job. |
| CI-05 | 03-02-PLAN.md | Separate skill-eval workflow that runs evaluations on PR | SATISFIED | `.github/workflows/skill-eval.yml` is a separate workflow file, triggered on `pull_request`. Two parallel evaluation jobs run in validate mode using the local LLM grader. |
| CI-06 | 03-02-PLAN.md | Eval result artifacts uploaded for cross-run comparison | SATISFIED | Lines 33-37: `eval-results-local` artifact uploaded from `results/` with `if: always()`. Lines 74-78: `eval-results-docker` artifact uploaded from `results/` with `if: always()`. |

No orphaned requirements found. All four CI-03 through CI-06 requirements are mapped to Phase 3 in REQUIREMENTS.md and covered by Plans 01 and 02.

### Anti-Patterns Found

No anti-patterns detected. Scanned `src/graders/index.ts`, `tests/ollama-grader.test.ts`, `.github/actions/setup-ollama/action.yml`, and `.github/workflows/skill-eval.yml` for TODO/FIXME/placeholder patterns, empty implementations, and stub returns. None found.

Note: The `eval-docker` job's image save step uses `grep skill-eval-superlint` to find the image name. This relies on the Docker image naming convention from the task configuration. If the image name changes, the save step silently skips without error (guarded by `if [ -n "$IMAGE" ]`). This is a design choice (not a blocker), documented in the SUMMARY as intentional.

### Human Verification Required

#### 1. End-to-End Skill Eval Workflow on a Real PR

**Test:** Push the `local-llm-grader` branch to GitHub and open a pull request (or use workflow_dispatch). Observe the "Skill Eval" workflow run in the Actions tab.

**Expected:**
- Both `Eval (local)` and `Eval (docker)` jobs appear and run in parallel
- Both jobs complete (green or red — the point is they execute and produce artifacts)
- `[LLMGrader] Warming up qwen2.5:3b...` and `[LLMGrader] Model warm (Xms)` log lines appear in the "Run evaluation" step output
- `eval-results-local` and `eval-results-docker` artifacts are downloadable from the workflow run summary page
- `npm run preview` step in both jobs shows ANSI-formatted terminal output

**Why human:** GitHub Actions workflow execution cannot be simulated locally. The SUMMARY claims workflow run 22876047788 passed, but this is a historical claim that cannot be re-verified from the working tree without a live CI run.

#### 2. Caching Behavior on Second Run

**Test:** Trigger the Skill Eval workflow a second time on the same branch (push another commit or re-run).

**Expected:**
- Ollama model setup step completes faster on the second run (cache hit logged for `ollama-model-qwen2.5:3b`)
- Docker image restore step in `eval-docker` shows cache hit, and "Load cached Docker image" step runs (whereas "Save Docker image to cache" is skipped)
- npm install step uses cached packages

**Why human:** Cache hit behavior is only observable across GitHub Actions runs with shared cache storage. Cannot be verified from the local working tree.

### Gaps Summary

No gaps. All automated checks passed:

- 24/24 unit tests pass (`npx ts-node tests/ollama-grader.test.ts`)
- All 3 artifact files exist, are substantive (not stubs), and are wired
- All 5 key links verified by source code inspection
- All 4 requirements (CI-03, CI-04, CI-05, CI-06) satisfied with direct evidence
- No anti-patterns found
- Commits `15f5d8f`, `c91cf61`, `3278d94`, `494f4f4`, `59c98f0` all verified in git log

The only items remaining are live CI observations that require a human to confirm workflow execution behavior on GitHub infrastructure.

---

_Verified: 2026-03-09T22:55:00Z_
_Verifier: Claude (gsd-verifier)_
