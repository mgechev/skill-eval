---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: opencode + Ollama Agent Backends
status: verifying
stopped_at: Phase 4.1 context gathered
last_updated: "2026-03-10T20:38:29.521Z"
last_activity: 2026-03-10 -- E2E validation passed (superlint_demo 0.97 reward with OllamaToolAgent)
progress:
  total_phases: 5
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-10)

**Core value:** Run skill evaluations entirely offline using local LLMs -- no API keys, no cloud costs, no network dependency.
**Current focus:** v2.0 -- opencode CLI + Ollama agent backend

## Current Position

Phase: Phase 4 (OllamaToolAgent + Ollama Model Setup) -- COMPLETE
Plan: 3 of 3 (all done)
Status: Phase 4 complete, all 3 plans executed and verified
Last activity: 2026-03-10 -- E2E validation passed (superlint_demo 0.97 reward with OllamaToolAgent)

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

### Pending Todos

None.

### Roadmap Evolution

- Phase 4.1 added: Tune Ollama agent to 5 min trial average (model/Ollama parameters, prompt engineering, alternative models)

### Blockers/Concerns

- opencode linux-arm64 SIGABRT (issue #13367) -- verify in Phase 6, fallback to x64 runner

## Session Continuity

Last session: 2026-03-10T20:38:29.519Z
Stopped at: Phase 4.1 context gathered
Resume file: .planning/phases/04.1-tune-ollama-agent-to-5-min-trial-average/04.1-CONTEXT.md
