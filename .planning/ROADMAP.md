# Roadmap: Local Skill Eval

## Overview

This roadmap delivers the core value of running skill evaluations entirely offline using local LLMs. The work divides into three natural phases: establish CI as a safety net for existing deterministic tests, build the local LLM grader with Ollama infrastructure, then extend CI to run evaluations with the local grader on PRs. Agent CLI backends (opencode, Claude Code) are deferred to v2.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: CI Foundation** - GitHub Actions workflow for typecheck, build, and deterministic tests with npm caching
- [x] **Phase 2: Local LLM Grader** - Ollama-backed grader replacing cloud API calls, with health checks, structured output, and graceful degradation
- [x] **Phase 2.1: Optimize Grader Model Selection** _(INSERTED)_ - Benchmark grader models on local ARM64 and ubuntu-24.04-arm CI runners, verify through direct Ollama requests and e2e bootstrap test
- [x] **Phase 3: CI Evaluation Pipeline** - Ollama in CI with model caching, skill-eval workflow on PRs, and result artifacts

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
**Plans**: 8 plans

Plans:
- [x] 02-01-PLAN.md -- Ollama grader integration: callOllama with retry, health/model checks, fallback chain, and SKILL.md frontmatter
- [x] 02-02-PLAN.md -- Regression verification: confirm deterministic grader still scores 1.0, user verifies with real Ollama
- [x] 02-03-PLAN.md -- Gap closure: fix prefix match logic bug in checkOllamaAvailability model name matching
- [x] 02-04-PLAN.md -- Gap closure: prepend workspace bin/ to PATH in LocalProvider.runCommand
- [x] 02-05-PLAN.md -- Gap closure: verify Node.js environment for LocalProvider subprocesses (human)
- [x] 02-06-PLAN.md -- Gap closure: fix LocalProvider PATH separator for MSYS2 bash and suppress BASH_ENV
- [x] 02-07-PLAN.md -- Gap closure: fix Ollama grader timeout (60s), add num_ctx 4096, surface grader failure details
- [x] 02-08-PLAN.md -- Gap closure: fix spawn to use bash --norc --noprofile, PATH deduplication, and sanitization assertion

### Phase 2.1: Optimize Grader Model Selection _(INSERTED)_
**Goal**: Find the best grader model for both local ARM64 (Snapdragon X Elite) and ubuntu-24.04-arm CI runners, using Phase 2 supplementary research as a starting point. Verify improvements through direct Ollama API requests and the skill-eval e2e bootstrap test.
**Depends on**: Phase 2
**Requirements**: SC-1, SC-2, SC-3, SC-4
**Success Criteria** (what must be TRUE):
  1. A grader model is selected that produces valid 0.0-1.0 scores within 60 seconds on both local Snapdragon X Elite and ubuntu-24.04-arm GitHub runners
  2. Model selection is verified through direct Ollama API calls (not just unit tests) on both hardware targets
  3. The e2e bootstrap test (`npm run test:bootstrap`) passes with the selected model producing llm_rubric scores > 0.0
  4. Ollama environment tuning (flash attention, KV cache quantization, thread count) is validated on both platforms
**Plans**: 4 plans

Plans:
- [x] 02.1-01-PLAN.md -- Benchmark harness: test fixtures, TypeScript benchmark script, and Ollama lifecycle wrapper shell script
- [x] 02.1-02-PLAN.md -- CI benchmark workflow with ai-action/setup-ollama, model caching, and artifact upload
- [x] 02.1-03-PLAN.md -- Run local benchmarks, apply results to callOllama (model, JSON Schema, defaults), clean up GraderConfig
- [x] 02.1-04-PLAN.md -- CI env vars, Ollama config warning, README docs, BENCHMARK.md report, cleanup

### Phase 3: CI Evaluation Pipeline
**Goal**: PRs automatically run skill evaluations with the local LLM grader on GitHub runners, with results available for cross-run comparison
**Depends on**: Phase 2.1
**Requirements**: CI-03, CI-04, CI-05, CI-06
**Success Criteria** (what must be TRUE):
  1. A PR triggers a separate skill-eval workflow that runs evaluations using the local LLM grader on a GitHub runner (4 vCPU, 16GB RAM)
  2. The second evaluation run on the same runner completes faster due to Ollama model caching across CI runs
  3. Evaluation results are uploaded as workflow artifacts and downloadable for comparison across runs
  4. Dependencies (Ollama, agent CLIs, npm packages) are cached across CI runs to reduce setup time
**Plans**: 2 plans

Todos to incorporate:
- [x] Add lightweight Ollama model warmup to LLMGrader — send minimal `num_predict:1` request before first grading call to eliminate cold-start timeout waste (see `.planning/todos/pending/2026-03-09-add-lightweight-ollama-model-warmup-to-llmgrader.md`)

Plans:
- [x] 03-01-PLAN.md -- LLMGrader warmup (num_predict:1) and reusable setup-ollama composite action
- [x] 03-02-PLAN.md -- Skill eval workflow with eval-local and eval-docker jobs, Docker image caching, result artifacts

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 2.1 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CI Foundation | 1/1 | Complete | 2026-03-08 |
| 2. Local LLM Grader | 8/8 | Complete | 2026-03-09 |
| 2.1. Optimize Grader Model Selection | 4/4 | Complete | 2026-03-09 |
| 3. CI Evaluation Pipeline | 2/2 | Complete | 2026-03-09 |
