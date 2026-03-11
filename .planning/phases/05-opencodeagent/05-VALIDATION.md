---
phase: 5
slug: opencodeagent
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | ts-node + custom assert (established project pattern) |
| **Config file** | None — tests run via `npx ts-node tests/<file>.test.ts` |
| **Quick run command** | `npx ts-node tests/opencode-agent.test.ts` |
| **Full suite command** | `npx ts-node tests/opencode-agent.test.ts && npx ts-node tests/cli-opencode-flag.test.ts` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx ts-node tests/opencode-agent.test.ts && npx ts-node tests/cli-opencode-flag.test.ts`
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green + superlint_demo completes with both providers
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 0 | AGENT-02 | unit | `npx ts-node tests/opencode-agent.test.ts` | No — W0 | pending |
| 05-01-02 | 01 | 0 | PIPE-02 | unit | `npx ts-node tests/cli-opencode-flag.test.ts` | No — W0 | pending |
| 05-02-01 | 02 | 1 | AGENT-02 | unit | `npx ts-node tests/opencode-agent.test.ts` | W0 | pending |
| 05-02-02 | 02 | 1 | PIPE-04 | unit | `npx ts-node tests/opencode-agent.test.ts` | W0 | pending |
| 05-02-03 | 02 | 1 | AGENT-02 | unit | `npx ts-node tests/opencode-agent.test.ts` | W0 | pending |
| 05-03-01 | 03 | 2 | PIPE-02 | unit | `npx ts-node tests/cli-opencode-flag.test.ts` | W0 | pending |
| 05-03-02 | 03 | 2 | AGENT-02 | smoke | `npm run eval -- superlint_demo --agent=opencode --provider=local --trials=1` | No — manual | pending |
| 05-03-03 | 03 | 2 | AGENT-02 | smoke | `npm run eval -- superlint_demo --agent=opencode --provider=docker --trials=1` | No — manual | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/opencode-agent.test.ts` — stubs for AGENT-02 (constructability, config validation, source patterns for kill timer, model unload, config injection)
- [ ] `tests/cli-opencode-flag.test.ts` — stubs for PIPE-02 (CLI wiring: import, case, help text)
- [ ] `npm run test:opencode-agent` and `npm run test:cli-opencode-flag` scripts in package.json

*Existing infrastructure covers Ollama client and BaseAgent patterns.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| superlint_demo completes (local) | AGENT-02 | Requires live Ollama + opencode | `npm run eval -- superlint_demo --agent=opencode --provider=local --trials=1` |
| superlint_demo completes (Docker) | AGENT-02 | Requires live Ollama + Docker | `npm run eval -- superlint_demo --agent=opencode --provider=docker --trials=1` |
| Kill timer fires on hang | AGENT-02 | Requires simulating opencode hang | Set timeout to 10s, run against a prompt that triggers hang |
| Model unload after trial | AGENT-02 | Requires live Ollama | Check `ollama ps` after trial completes — model should not be loaded |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
