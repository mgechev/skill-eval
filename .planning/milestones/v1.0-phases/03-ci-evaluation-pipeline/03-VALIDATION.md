---
phase: 3
slug: ci-evaluation-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom ts-node test runner (no framework dependency) |
| **Config file** | None — tests are standalone ts-node scripts |
| **Quick run command** | `npm run test:ollama-grader` |
| **Full suite command** | `npm run test:ollama-grader && npm run test:bootstrap && npm run test:analytics && npm run test:local-provider && npm run test:docker-cache` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:ollama-grader`
- **After every plan wave:** Run `npm run test:ollama-grader && npm run test:bootstrap && npm run test:analytics && npm run test:local-provider && npm run test:docker-cache`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | CI-05 | smoke (CI) | Push PR and observe workflow triggers | N/A (YAML) | ⬜ pending |
| 03-01-02 | 01 | 1 | CI-03 | smoke (CI) | Observe Ollama setup in workflow run | N/A (YAML) | ⬜ pending |
| 03-01-03 | 01 | 1 | CI-04 | smoke (CI) | Compare first-run vs second-run timing | N/A (YAML) | ⬜ pending |
| 03-01-04 | 01 | 1 | CI-06 | smoke (CI) | Verify artifacts in workflow run UI | N/A (YAML) | ⬜ pending |
| 03-02-01 | 02 | 1 | WARMUP | unit | `npm run test:ollama-grader` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/ollama-grader.test.ts` — add warmup-specific test cases (warmup called once, warmup failure non-blocking, warmup skipped for non-Ollama)
- [ ] Workflow YAML validation: `actionlint` or manual review (no automated framework for workflow testing)

*Note: Most CI-03/04/05/06 requirements are verified via smoke tests (observe workflow behavior) rather than automated unit tests, since they are GitHub Actions workflow YAML configurations.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Workflow triggers on PR | CI-05 | GitHub Actions workflow YAML cannot be unit tested | Push a PR and verify the Skill Eval workflow runs |
| Model cache hit on second run | CI-03 | Requires two consecutive workflow runs on same runner | Run workflow twice; second run should show "Cache restored" for Ollama models |
| Dependency caching reduces setup time | CI-04 | Requires timing comparison across runs | Compare npm install + Docker build times between first and second run |
| Artifacts downloadable | CI-06 | Requires GitHub UI verification | Download eval-results-local and eval-results-docker artifacts after workflow completes |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
