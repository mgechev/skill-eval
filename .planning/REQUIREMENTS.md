# Requirements: local-skill-eval v2.0

**Defined:** 2026-03-10
**Core Value:** Run skill evaluations entirely offline using local LLMs -- no API keys, no cloud costs, no network dependency.

## v2.0 Requirements

Requirements for v2.0 milestone. Each maps to roadmap phases.

### Agent Backends

- [x] **AGENT-01**: OllamaToolAgent executes tasks via direct Ollama API with tool calling (read_file, write_file, bash, list_directory)
- [x] **AGENT-02**: OpenCodeAgent executes tasks via opencode CLI backed by Ollama
- [ ] **AGENT-03**: Both agents can run the superlint_demo task end-to-end and produce a scored result
- [ ] **AGENT-04**: Each trial completes within 15 minutes on target hardware (local and CI)

### Ollama Configuration

- [x] **OLCFG-01**: Ollama model identified and configured that supports tool calling for agent tasks
- [x] **OLCFG-02**: Custom Modelfile overrides Ollama's 4K default context to a working size for agentic workflows
- [x] **OLCFG-03**: Sequential model loading prevents OOM -- agent model unloaded before grader loads

### Eval Pipeline

- [x] **PIPE-01**: `--agent=ollama` CLI flag selects OllamaToolAgent as the agent backend
- [x] **PIPE-02**: `--agent=opencode` CLI flag selects OpenCodeAgent as the agent backend
- [x] **PIPE-03**: Tool-calling smoke test gates evaluation -- catches misconfigured models before starting a trial
- [x] **PIPE-04**: OpenCodeAgent injects opencode.json config (Ollama provider, permissions, model) into workspace

### CI Integration

- [x] **CI-01**: setup-ollama action pulls agent model and creates Modelfile variant
- [x] **CI-02**: setup-opencode composite action installs opencode and generates config for CI
- [x] **CI-03**: Agent eval workflow runs on CI (ARM64 with fix or x64 fallback)
- [x] **CI-04**: OLLAMA_MAX_LOADED_MODELS=1 set in CI to prevent OOM

### Performance Comparison

- [ ] **PERF-01**: OllamaToolAgent and OpenCodeAgent results compared on superlint_demo (local)
- [ ] **PERF-02**: OllamaToolAgent and OpenCodeAgent results compared on superlint_demo (CI)

## Deferred Requirements

Tracked but not in current roadmap.

### Reporting

- **RPT-01**: Parse opencode `--format json` output for structured events and token counts
- **RPT-02**: Agent efficiency metrics (tool call count, types, steps-to-completion)

### Advanced Features

- **ADV-01**: `--compare-skills` mode for skills efficacy delta measurement
- **ADV-02**: `--models=a,b,c` multi-model comparison convenience flag
- **ADV-03**: `ollama launch opencode` auto-config detection

### Additional Backends

- **BACK-01**: Claude Code agent CLI backend
- **BACK-02**: Additional agent CLI integrations beyond opencode and Claude Code

## Out of Scope

| Feature | Reason |
|---------|--------|
| 64K context window | OOM on 16GB target hardware |
| Parallel agent trials | Ollama serializes same-model requests; concurrent 8B models exceed 16GB |
| Cloud model fallback during agent eval | Creates non-comparable evaluation conditions |
| Full agent framework (LangChain/LangGraph) | ollama npm client with tool loop is sufficient |
| Warm-start server mode (opencode serve) | Defer until per-trial overhead is a measured bottleneck |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AGENT-01 | Phase 4 | Complete |
| AGENT-02 | Phase 5 | Complete |
| AGENT-03 | Phase 7 | Pending |
| AGENT-04 | Phase 7 | Pending |
| OLCFG-01 | Phase 4 | Complete |
| OLCFG-02 | Phase 4 | Complete |
| OLCFG-03 | Phase 4 | Complete |
| PIPE-01 | Phase 4 | Complete |
| PIPE-02 | Phase 5 | Complete |
| PIPE-03 | Phase 4 | Complete |
| PIPE-04 | Phase 5 | Complete |
| CI-01 | Phase 6 | Complete |
| CI-02 | Phase 6 | Complete |
| CI-03 | Phase 6 | Complete |
| CI-04 | Phase 6 | Complete |
| PERF-01 | Phase 7 | Pending |
| PERF-02 | Phase 7 | Pending |

**Coverage:**
- v2.0 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap mapping*
