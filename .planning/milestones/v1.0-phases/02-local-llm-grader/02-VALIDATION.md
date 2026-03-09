---
phase: 2
slug: local-llm-grader
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | ts-node test scripts (custom, no framework) |
| **Config file** | tsconfig.json (includes `tests/**/*.ts`) |
| **Quick run command** | `npm run test:bootstrap` |
| **Full suite command** | `npm run test:bootstrap && npm run test:analytics` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:bootstrap`
- **After every plan wave:** Run `npm run test:bootstrap && npm run test:analytics`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | GRADE-01 | integration | `npm run test:bootstrap` (extended) | Partial | ⬜ pending |
| 02-01-02 | 01 | 1 | GRADE-04 | unit | `npm run test:bootstrap` (config override) | Wave 0 | ⬜ pending |
| 02-01-03 | 01 | 1 | GRADE-05 | smoke | `git diff -- prompts/quality.md` | N/A | ⬜ pending |
| 02-01-04 | 01 | 1 | GRADE-06 | unit | `npm run test:bootstrap` (mock malformed) | Wave 0 | ⬜ pending |
| 02-01-05 | 01 | 1 | GRADE-07 | unit | verify API body includes temperature: 0 | Wave 0 | ⬜ pending |
| 02-01-06 | 01 | 1 | GRADE-08 | integration | `npm run test:bootstrap` | Existing | ⬜ pending |
| 02-01-07 | 01 | 1 | OLLAMA-01 | unit | mock server error test | Wave 0 | ⬜ pending |
| 02-01-08 | 01 | 1 | OLLAMA-02 | unit | mock /api/tags test | Wave 0 | ⬜ pending |
| 02-01-09 | 01 | 1 | OLLAMA-03 | integration | `npm run test:bootstrap` (no Ollama) | Partial | ⬜ pending |
| 02-02-01 | 02 | 1 | TASK-01 | smoke | verify YAML frontmatter parses | Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Mock-based Ollama tests in `tests/` — covers GRADE-01, GRADE-04, GRADE-06, GRADE-07, OLLAMA-01, OLLAMA-02
- [ ] SKILL.md frontmatter parse verification test — covers TASK-01
- [ ] Existing `test:bootstrap` already covers GRADE-08 (deterministic grader still scores 1.0)

*Note: Full Ollama integration testing requires Ollama running and is deferred to Phase 3 CI. Unit tests with mocked HTTP responses are sufficient for this phase.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Model fits 16GB runner | GRADE-02 | Verified by model selection (qwen3:4b = 2.7GB) | Confirm model size in Ollama docs |
| Grading within 3-5 min | GRADE-03 | Requires real Ollama + CPU inference | Manual timing test with Ollama running locally |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
