# Requirements: Local Skill Eval

**Defined:** 2026-03-08
**Core Value:** Run skill evaluations entirely offline using local LLMs — no API keys, no cloud costs, no network dependency.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### CI/CD

- [x] **CI-01**: GitHub Actions CI workflow with separate jobs for typecheck, build, test:bootstrap, and test:analytics
- [x] **CI-02**: npm package caching across CI runs
- [ ] **CI-03**: Ollama installation and model caching across CI runs
- [ ] **CI-04**: Agent CLI and dependency caching across CI runs
- [ ] **CI-05**: Separate skill-eval workflow that runs evaluations on PR (matching blog post pattern)
- [ ] **CI-06**: Eval result artifacts uploaded for cross-run comparison

### Local LLM Grading

- [ ] **GRADE-01**: Ollama-backed LLM grader replacing cloud Gemini/Anthropic API calls in LLMGrader
- [ ] **GRADE-02**: Grader model must fit on default GitHub runner (4 vCPU, 16GB RAM, 14GB SSD — ubuntu-latest amd64 or ubuntu-24.04-arm arm64 preferred)
- [ ] **GRADE-03**: Each trial must complete grading within 3-5 minutes max
- [ ] **GRADE-04**: Model selection configurable via task.toml grader config (model field)
- [ ] **GRADE-05**: Existing rubric prompt files (prompts/*.md) reused unchanged
- [ ] **GRADE-06**: Robust structured JSON output parsing with fallback for malformed local model output
- [ ] **GRADE-07**: Temperature=0 for deterministic grading behavior
- [ ] **GRADE-08**: Deterministic grader must still score 1.0 (local LLM grader does not break existing deterministic grading)

### Task Structure

- [ ] **TASK-01**: Superlint SKILL.md has agent skill frontmatter for auto-discovery by agent CLIs

### Ollama Integration

- [ ] **OLLAMA-01**: Ollama health check before evaluation starts (fail fast with actionable error)
- [ ] **OLLAMA-02**: Model availability check (verify required model is pulled)
- [ ] **OLLAMA-03**: Graceful degradation when Ollama is absent (fall back to cloud graders if API keys present, or skip LLM grading with warning)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Agent CLI Backends

- **AGENT-01**: OpenCode + Ollama backend configuration and invocation
- **AGENT-02**: Claude Code + Ollama backend configuration via env vars
- **AGENT-03**: Agent env var management (Ollama connection vars flow to agent subprocess)
- **AGENT-04**: Context window configuration for agent CLIs (64K+ tokens)

### ollama launch Integration

- **LAUNCH-01**: Detect and match `ollama launch opencode` configuration
- **LAUNCH-02**: Detect and match `ollama launch claude` configuration

### Resource Management

- **RES-01**: Sequential resource orchestration (keep_alive model unloading for 16GB RAM)
- **RES-02**: Model preloading to avoid cold start penalty

### Grading Enhancements

- **GNORM-01**: Score normalization to calibrate bias across different local models
- **GMULTI-01**: Multi-model grading consensus (2-3 judge models)
- **GTEMPL-01**: Prompt template variants optimized for small vs large local models

## Out of Scope

| Feature | Reason |
|---------|--------|
| GPU-accelerated inference | Snapdragon Adreno X1-85 has near-zero ML support; CPU-only |
| NPU-accelerated inference | Ollama does not support Qualcomm NPU; requires ONNX format, not GGUF |
| Custom model fine-tuning | Out of scope — consume pre-trained models only |
| Parallel trial execution with local LLM | 16GB RAM cannot support concurrent model loads |
| Real-time streaming grader output | Adds complexity for minimal value; use stream:false |
| Cloud fallback mid-evaluation | Mixing cloud and local grading within one eval run produces incomparable scores |
| vLLM/llama.cpp direct integration | Ollama wraps llama.cpp; standardize on Ollama API |
| Custom web dashboard | Upstream viewer.html and analytics already sufficient |

## Open Questions

- **Agent architecture for local-only evals:** Skill-eval requires an agent to run evaluations. Can we build a custom `OllamaAgent` (extending BaseAgent, calling `/api/chat` with tool definitions directly) instead of depending on external CLIs? This would eliminate the need for Gemini CLI or Claude Code and make fully offline evals possible.
- **GitHub runner model constraints:** Which quantized models fit in 16GB RAM runners (ubuntu-latest amd64 or ubuntu-24.04-arm arm64) while completing grading within 3-5 min?

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CI-01 | Phase 1 | Complete |
| CI-02 | Phase 1 | Complete |
| CI-03 | Phase 3 | Pending |
| CI-04 | Phase 3 | Pending |
| CI-05 | Phase 3 | Pending |
| CI-06 | Phase 3 | Pending |
| GRADE-01 | Phase 2 | Pending |
| GRADE-02 | Phase 2 | Pending |
| GRADE-03 | Phase 2 | Pending |
| GRADE-04 | Phase 2 | Pending |
| GRADE-05 | Phase 2 | Pending |
| GRADE-06 | Phase 2 | Pending |
| GRADE-07 | Phase 2 | Pending |
| GRADE-08 | Phase 2 | Pending |
| TASK-01 | Phase 2 | Pending |
| OLLAMA-01 | Phase 2 | Pending |
| OLLAMA-02 | Phase 2 | Pending |
| OLLAMA-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 18
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-08 after roadmap creation*
