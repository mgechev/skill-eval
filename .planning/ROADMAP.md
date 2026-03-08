# Roadmap: Local Skill Eval

## Overview

This roadmap delivers the core value of running skill evaluations entirely offline using local LLMs. The work divides into three natural phases: establish CI as a safety net for existing deterministic tests, build the local LLM grader with Ollama infrastructure, then extend CI to run evaluations with the local grader on PRs. Agent CLI backends (opencode, Claude Code) are deferred to v2.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: CI Foundation** - GitHub Actions workflow for typecheck, build, and deterministic tests with npm caching
- [ ] **Phase 2: Local LLM Grader** - Ollama-backed grader replacing cloud API calls, with health checks, structured output, and graceful degradation
- [ ] **Phase 3: CI Evaluation Pipeline** - Ollama in CI with model caching, skill-eval workflow on PRs, and result artifacts

## Phase Details

### Phase 1: CI Foundation
**Goal**: Every PR is automatically validated against typecheck, build, and deterministic tests before merge
**Depends on**: Nothing (first phase)
**Requirements**: CI-01, CI-02
**Success Criteria** (what must be TRUE):
  1. A pull request triggers a GitHub Actions workflow that runs typecheck, build, test:bootstrap, and test:analytics as separate jobs
  2. A second PR run completes faster than the first due to npm package caching
  3. A PR with a type error or failing test is blocked from merging (CI reports failure)
**Plans**: 1 plan

Plans:
- [x] 01-01-PLAN.md -- Complete CI foundation: package.json scripts, composite action, and GitHub Actions workflow with 4 parallel jobs

### Phase 2: Local LLM Grader
**Goal**: Users can grade agent output using a local Ollama model instead of cloud APIs, with no API keys required
**Depends on**: Phase 1
**Requirements**: GRADE-01, GRADE-02, GRADE-03, GRADE-04, GRADE-05, GRADE-06, GRADE-07, GRADE-08, OLLAMA-01, OLLAMA-02, OLLAMA-03, TASK-01
**Success Criteria** (what must be TRUE):
  1. Running an evaluation with `local_llm_rubric` grader type produces 0.0-1.0 scores using Ollama with no cloud API keys configured
  2. Starting an evaluation when Ollama is not running fails immediately with an actionable error message (not a mid-trial timeout)
  3. Starting an evaluation when the required model is not pulled fails immediately with a message naming the missing model
  4. Existing deterministic graders (test.sh) still score 1.0 on the superlint task -- local LLM grading does not break them
  5. When Ollama is absent but cloud API keys are present, grading falls back to cloud graders with a warning (graceful degradation)
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md -- Ollama grader integration: callOllama with retry, health/model checks, fallback chain, and SKILL.md frontmatter
- [ ] 02-02-PLAN.md -- Regression verification: confirm deterministic grader still scores 1.0, user verifies with real Ollama

### Phase 3: CI Evaluation Pipeline
**Goal**: PRs automatically run skill evaluations with the local LLM grader on GitHub runners, with results available for cross-run comparison
**Depends on**: Phase 2
**Requirements**: CI-03, CI-04, CI-05, CI-06
**Success Criteria** (what must be TRUE):
  1. A PR triggers a separate skill-eval workflow that runs evaluations using the local LLM grader on a GitHub runner (4 vCPU, 16GB RAM)
  2. The second evaluation run on the same runner completes faster due to Ollama model caching across CI runs
  3. Evaluation results are uploaded as workflow artifacts and downloadable for comparison across runs
  4. Dependencies (Ollama, agent CLIs, npm packages) are cached across CI runs to reduce setup time
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CI Foundation | 1/1 | Complete | 2026-03-08 |
| 2. Local LLM Grader | 0/2 | In progress | - |
| 3. CI Evaluation Pipeline | 0/? | Not started | - |
