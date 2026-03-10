# Roadmap: Local Skill Eval

## Milestones

- [x] **v1.0** -- Phases 1-3 (shipped 2026-03-09)
- [ ] **v2.0** -- Phases 4-7 (opencode + Ollama agent backends)

## Phases

<details>
<summary>[x] v1.0 (Phases 1-3) -- SHIPPED 2026-03-09</summary>

- [x] Phase 1: CI Foundation (1/1 plan) -- completed 2026-03-08
- [x] Phase 2: Local LLM Grader (8/8 plans) -- completed 2026-03-09
- [x] Phase 2.1: Optimize Grader Model Selection (4/4 plans) -- completed 2026-03-09
- [x] Phase 3: CI Evaluation Pipeline (2/2 plans) -- completed 2026-03-09

Full details: milestones/v1.0-ROADMAP.md

</details>

### v2.0: opencode + Ollama Agent Backends

- [x] Phase 4: OllamaToolAgent + Ollama Model Setup
- [ ] Phase 4.1: Tune Ollama Agent to 5 Min Trial Average
- [ ] Phase 5: OpenCodeAgent
- [ ] Phase 6: CI Integration
- [ ] Phase 7: End-to-End Validation + Performance Comparison

#### Phase 4: OllamaToolAgent + Ollama Model Setup

**Goal:** Prove a local Ollama model can complete agent tasks via direct API tool calling.

**Requirements:** AGENT-01, OLCFG-01, OLCFG-02, OLCFG-03, PIPE-01, PIPE-03

**Plans:** 3 plans (3/3 complete)

Plans:
- [x] 04-01-PLAN.md -- Dependencies, Modelfile, tool definitions, and permission system
- [x] 04-02-PLAN.md -- OllamaToolAgent class, CLI wiring, smoke test gate
- [x] 04-03-PLAN.md -- End-to-end validation with superlint_demo

**Delivers:**
- Ollama agent model pulled and configured with working context window (custom Modelfile)
- `OllamaToolAgent` class with tool-calling loop (read_file, write_file, bash, list_directory)
- `--agent=ollama` CLI flag
- Tool-calling smoke test as pre-eval gate
- Sequential model loading (agent unloaded before grader)
- superlint_demo completes locally with OllamaToolAgent

**Key risks:**
- Ollama 4K default context silently breaks tool calling -- custom Modelfile required
- Small models (8B) may emit tool calls as text instead of structured API -- smoke test catches this
- Model must support tool calling natively (qwen3:8b is the candidate)

---

#### Phase 4.1: Tune Ollama Agent to 5 Min Trial Average

**Goal:** Research and apply model/Ollama parameters and prompt engineering to get superlint_demo under 5 min average across 3 trial runs. Explore alternative models (qwen2.5:7b, other 4/7/8b models).

**Requirements:** TUNE-BASELINE, TUNE-PARAMS, TUNE-PROMPT, TUNE-AGENTCFG, TUNE-PRUNING, TUNE-ALTMODELS, TUNE-QUANTIZATION
**Depends on:** Phase 4
**Plans:** 3 plans

Plans:
- [ ] 04.1-01-PLAN.md -- Benchmark tooling and baseline capture
- [ ] 04.1-02-PLAN.md -- Systematic qwen3:4b parameter and prompt experiments
- [ ] 04.1-03-PLAN.md -- Escalation: context pruning and alternative models

---

#### Phase 5: OpenCodeAgent

**Goal:** Wrap the opencode CLI as an agent backend, leveraging the Ollama model proven in Phase 4.

**Requirements:** AGENT-02, PIPE-02, PIPE-04

**Delivers:**
- `OpenCodeAgent` class wrapping `opencode run` CLI
- opencode.json config injection (Ollama provider, model, permissions auto-approve)
- `--agent=opencode` CLI flag
- External kill timer on subprocess (opencode hangs on errors)
- superlint_demo completes locally with OpenCodeAgent

**Key risks:**
- opencode `run` hangs indefinitely on errors (issue #8203) -- external timeout required
- Config precedence can silently override model/permissions -- explicit config injection
- x64 binary runs under emulation on ARM64 dev machine -- may be slower

---

#### Phase 6: CI Integration

**Goal:** Both agent backends run in CI with proper setup actions.

**Requirements:** CI-01, CI-02, CI-03, CI-04

**Delivers:**
- setup-ollama action extended: agent model pull, Modelfile variant creation
- setup-opencode composite action: install, config generation, OPENCODE_BIN_PATH
- CI runner platform resolved (ARM64 with fix or x64 fallback)
- `OLLAMA_MAX_LOADED_MODELS=1` in CI to prevent OOM
- Both agents complete superlint_demo in CI

**Key risks:**
- opencode linux-arm64 SIGABRT (issue #13367) -- may need x64 runner
- 16GB RAM runner must fit agent model + grader model sequentially
- opencode auto-update in CI adds latency -- disable with env var

---

#### Phase 7: End-to-End Validation + Performance Comparison

**Goal:** Validate both agents meet the 15-minute target and compare their performance.

**Requirements:** AGENT-03, AGENT-04, PERF-01, PERF-02

**Delivers:**
- superlint_demo verified end-to-end with both agents (local + CI)
- Per-trial completion within 15 minutes confirmed
- Performance comparison: time, pass/fail, tool calls (manual comparison from existing reports)
- Documented recommendation for which agent backend to use by default

**Key risks:**
- Performance may vary significantly between local (ARM64 emulation) and CI
- Grading accuracy may differ based on agent output format differences

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. CI Foundation | v1.0 | 1/1 | Complete | 2026-03-08 |
| 2. Local LLM Grader | v1.0 | 8/8 | Complete | 2026-03-09 |
| 2.1. Optimize Grader Model Selection | v1.0 | 4/4 | Complete | 2026-03-09 |
| 3. CI Evaluation Pipeline | v1.0 | 2/2 | Complete | 2026-03-09 |
| 4. OllamaToolAgent + Ollama Model Setup | v2.0 | 3/3 | Complete | 2026-03-10 |
| 4.1. Tune Ollama Agent to 5 Min Trial Average | v2.0 | 0/3 | Planned | -- |
| 5. OpenCodeAgent | v2.0 | 0/? | Pending | -- |
| 6. CI Integration | v2.0 | 0/? | Pending | -- |
| 7. End-to-End Validation + Comparison | v2.0 | 0/? | Pending | -- |
