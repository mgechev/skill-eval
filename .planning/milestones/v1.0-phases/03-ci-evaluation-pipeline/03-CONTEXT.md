# Phase 3: CI Evaluation Pipeline - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Separate GitHub Actions workflow that runs skill evaluations with the Ollama-backed LLM grader on PRs, with cached dependencies and downloadable result artifacts. Covers requirements CI-03 (Ollama + model caching), CI-04 (dependency caching), CI-05 (separate skill-eval workflow), and CI-06 (eval result artifacts). Agent CLI backends are out of scope (v2).

</domain>

<decisions>
## Implementation Decisions

### Workflow structure
- Separate workflow file: `.github/workflows/skill-eval.yml`, name: "Skill Eval"
- Independent from CI workflow (not gated, runs in parallel)
- Triggers: `pull_request` + `push` to main + `workflow_dispatch`
- Concurrency groups with `cancel-in-progress: true`, keyed to PR number or branch ref
- Permissions: `contents: read` only
- Two parallel jobs: `eval-local` (local provider) and `eval-docker` (Docker provider)
- Both jobs always run on all triggers (no conditional Docker job)
- 30-minute timeout per job

### Evaluation mode
- Validate mode only (`--validate` flag, reference solution, no agent CLI needed)
- Agent CLI backends are deferred to v2; validate mode still exercises the full pipeline: provider setup, workspace, command execution, deterministic grader, and LLM grader via Ollama
- superlint_demo task only (hardcoded, only task with reference solution)
- 1 trial per evaluation (validate mode default in CLI)
- Local provider job: `npm run validate -- superlint_demo --provider=local`
- Docker provider job: `npm run validate -- superlint_demo --provider=docker`

### Ollama setup
- Reusable composite action at `.github/actions/setup-ollama/action.yml` (DRY across both jobs)
- Composite action handles: install via `ai-action/setup-ollama@v2`, model caching via `actions/cache@v5` on `~/.ollama`, model pull (`qwen2.5:3b`), start Ollama with optimized env vars, wait for ready
- Ollama env vars in composite action: `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_NUM_THREAD=4`
- Each job calls the composite action independently (jobs run on separate VMs)

### Docker image caching
- Docker provider job should cache Docker images across CI runs
- Approach is Claude's discretion (actions/cache with docker save/load, Docker layer caching actions, or other)
- Content-hash image naming (Quick Task 3) makes cache invalidation automatic
- Docker installation on `ubuntu-24.04-arm` runners: Claude's discretion (check if pre-installed)

### Result artifacts
- Upload JSON results from `results/` directory (existing eval runner output format)
- Separate artifacts per job: `eval-results-local` and `eval-results-docker`
- Default retention (no explicit `retention-days`)
- `if: always()` on upload step to preserve partial results and failure diagnostics
- `npm run preview` step after evaluation (also `if: always()`) to show terminal report in CI logs

### Model warmup (resolves pending todo)
- Add lightweight warmup in `LLMGrader` code: `num_predict: 1` request before first grading call
- Ollama-only (not for Gemini or Anthropic API paths)
- Once per `LLMGrader` instance (lazy init with `warmedUp` flag)
- 120s warmup timeout (1.5x worst observed cold start: 81s on 4-vCPU CI)
- Non-blocking: if warmup fails, log warning and proceed to grading anyway (retry mechanism is fallback)
- Log warmup timing: `[LLMGrader] Warming up {model}...` and `[LLMGrader] Model warm ({ms}ms)`
- Separate from `checkOllamaAvailability()` (fast availability check -> slow warmup -> grading call)

### Claude's Discretion
- Docker image caching strategy (actions/cache, docker save/load, or dedicated action)
- Docker installation on ubuntu-24.04-arm runners (pre-installed or needs setup)
- Composite action internal details (shell, error handling, wait loop)
- Ollama version pinning in composite action
- Model cache key strategy (per-model, shared, etc.)
- Warmup implementation details (placement in grade() vs separate method)

</decisions>

<specifics>
## Specific Ideas

- Reuse patterns from the benchmark-grader.yml workflow: it already demonstrates Ollama setup, model caching, artifact upload, and optimized env var restart on ubuntu-24.04-arm
- Minimize upstream divergence in source code -- the warmup is a small addition to LLMGrader, not a rewrite
- The `npm run preview` reporter uses ANSI colors that render in GitHub Actions log viewer -- nice terminal output in CI logs

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `benchmark-grader.yml`: Complete reference for Ollama setup, model caching, artifact upload on ARM64 CI runners
- `.github/actions/setup-node/action.yml`: Composite action pattern (Node.js + npm ci)
- `src/reporters/cli.ts`: `runCliPreview()` reads `results/` JSON and renders ANSI terminal report
- `src/preview.ts`: Entry point for `npm run preview` -- reads from configurable `--logDir=` (defaults to `./results`)
- `LLMGrader` class (`src/graders/index.ts`): `checkOllamaAvailability()` and `callOllamaWithRetry()` -- warmup inserts between these
- `cli.ts` validate mode (line 153-184): Hardcodes 1 trial, uses reference solution agent, saves to `results/`

### Established Patterns
- Composite action pattern: `.github/actions/setup-node/action.yml` (install + cache in reusable action)
- Ollama lifecycle: start with env vars, wait for ready via curl loop, pull model -- established in benchmark workflow
- Model caching: `actions/cache@v5` on `~/.ollama` with model-name-based key
- Concurrency groups: `${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}`
- Artifact upload: `actions/upload-artifact@v4` with `if: always()`

### Integration Points
- `.github/workflows/skill-eval.yml`: New workflow file
- `.github/actions/setup-ollama/action.yml`: New composite action (reusable Ollama setup)
- `src/graders/index.ts`: Add warmup method to `LLMGrader` (between availability check and grading call)
- `results/` directory: Existing eval output path, uploaded as artifacts
- `.planning/todos/pending/2026-03-09-add-lightweight-ollama-model-warmup-to-llmgrader.md`: Resolved by warmup implementation

</code_context>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope

</deferred>

---

*Phase: 03-ci-evaluation-pipeline*
*Context gathered: 2026-03-09*
