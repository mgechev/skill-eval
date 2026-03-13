---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: opencode + Ollama Agent Backends
status: Phase 5.1 e2e validated. Grader timeout resolved, 5/5 trials reward 0.96. Ready for Phase 6.
stopped_at: Phase 5.1 e2e validation complete, ready for Phase 6
last_updated: "2026-03-13T22:00:00.000Z"
last_activity: "2026-03-13 -- Phase 5.1 e2e validated: grader cache in evalRunner fixes timeout, 5/5 trials 0.96"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 14
  completed_plans: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Run skill evaluations entirely offline using local LLMs -- no API keys, no cloud costs, no network dependency.
**Current focus:** v2.0 -- opencode CLI + Ollama agent backend

## Current Position

Phase: Phase 6 (CI Integration) -- ready to plan
Plan: 0 -- not yet planned
Status: Phase 5.1 e2e validated (5/5 trials reward 0.96). Ready for Phase 6.
Last activity: 2026-03-13 -- Phase 5.1 e2e grader timeout resolved via grader cache in evalRunner

## Accumulated Context

### Decisions

- opencode x64 binary works on Windows ARM64 via emulation (set OPENCODE_BIN_PATH to bypass npm wrapper segfault)
- Build OllamaToolAgent first to isolate Ollama/model issues from opencode issues
- CI: fix ARM64 or switch to x64 runners -- either is acceptable
- Working config over optimized config -- defer Ollama tuning to later milestone

Decisions logged in PROJECT.md Key Decisions table. v1.0 decisions archived to milestones/v1.0-ROADMAP.md.
- [Phase 04]: Used picomatch { dot: true, bash: true } for flat string matching of bash commands (not path segments)
- [Phase 04]: Used finally block for model unload to ensure cleanup even on agent errors
- [Phase 04]: qwen3:8b unusable on ARM64 CPU-only -- switched to qwen3:4b (2.5 GB)
- [Phase 04]: 8 threads local / 3 threads CI to balance speed vs system responsiveness
- [Phase 04]: num_ctx 4096 sufficient for eval tasks, num_predict 4096 required (lower truncates tool calls)
- [Phase 04]: /no_think + directive system prompt reduces Qwen3 thinking token waste
- [Phase 04]: Smart model unloading -- unload non-agent models only, keep agent warm
- [Phase 04.1]: qwen3.5:4b already meets 300s target (235s avg) -- remaining plans focus on further optimization
- [Phase 04.1]: Benchmark runner uses per-trial execSync calls to avoid timeout on multi-trial runs
- [Phase 04.1]: Prompt eval is 70% of Ollama time -- primary optimization target
- [Phase 04.1]: num_batch 1024 is the only Modelfile param that consistently improves performance (-8.3%)
- [Phase 04.1]: temperature 0 critical for consistency; 0.25 causes wild command count variance
- [Phase 04.1]: Flash attention + q8_0 KV cache provide no benefit on ARM64 CPU-only
- [Phase 04.1]: Path variance (4 vs 6 commands) dominates duration more than any parameter
- [Phase 04.1]: qwen2.5:3b is the production agent model -- 53s avg, reward 1.00, 3 cmds (5.6x under target)
- [Phase 04.1]: qwen3.5:4b-q8_0 is the documented alternative for harder tasks (167s avg, 0.97 reward)
- [Phase 04.1]: /no_think kept in system prompt -- qwen2.5 recognizes it, boosts reward from 0.97 to 1.00
- [Phase 04.1]: Model size not correlated with agent quality -- 3B beat all larger models
- [Phase 05]: Static config copied as-is to workspace; Docker baseURL adjustment deferred to Plan 03
- [Phase 05]: Bash timeout command as primary hang protection; fallback to no-timeout when timeout binary unavailable
- [Phase 05]: @types/tree-kill not available on npm; tree-kill ships its own .d.ts types
- [Phase 05]: Opencode smoke test uses Ollama client.list() instead of opencode --version since runCommand is unavailable at CLI setup time
- [Phase 05]: Model unload pattern duplicated from ollama block rather than extracting shared function to minimize risk
- [Phase 05.1 gap]: Model naming convention: {base}-skill-eval-{backend}-agent (e.g., qwen3-4b-skill-eval-opencode-agent)
- [Phase 05.1 gap]: LLM grader uses qwen3:4b with binary checklist decomposition (CheckEval/RocketEval) instead of holistic scoring
- [Phase 05.1 gap]: Three scoring techniques: prerequisite gating (A), weighted scoring (C), score cap (D)
- [Phase 05.1 gap]: think:false required for qwen3 grading -- thinking tokens break structured output
- [Phase 05.1 e2e]: Grader cache in evalRunner (not singleton in getGrader) -- OCP-compliant for upstream fork

### Pending Todos

None.

### Roadmap Evolution

- Phase 4.1 added: Tune Ollama agent to 5 min trial average (model/Ollama parameters, prompt engineering, alternative models)
- Phase 5.1 inserted after Phase 5: Tune OpenCodeAgent for Multi-Step Tool Execution (URGENT) -- Plan 05-03 blocked, model can't complete 3-step workflow through opencode
- Phase 8 added: Review fork changes against Open-Closed Principle

### Blockers/Concerns

- opencode linux-arm64 SIGABRT (issue #13367) -- verify in Phase 6, fallback to x64 runner

## Performance Metrics

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 04.1 | 01 | 57min | 2 | 9 |
| 04.1 | 02 | ~120min | 4 | 8 |
| 04.1 | 03 | ~180min | 4 | 12 |
| Phase 05 P01 | 2min | 2 tasks | 5 files |
| 05 | 02 | 2min | 2 | 3 |

## Session Continuity

Last session: 2026-03-13T22:00:00.000Z
Stopped at: Phase 5.1 e2e validated, proceeding to Phase 6
Resume file: none
