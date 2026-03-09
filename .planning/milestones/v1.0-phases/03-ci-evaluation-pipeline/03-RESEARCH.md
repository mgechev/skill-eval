# Phase 3: CI Evaluation Pipeline - Research

**Researched:** 2026-03-09
**Domain:** GitHub Actions CI workflows, Ollama on ARM64 runners, Docker image caching, composite actions
**Confidence:** HIGH

## Summary

Phase 3 creates a separate GitHub Actions workflow (`.github/workflows/skill-eval.yml`) that runs skill evaluations using the Ollama-backed LLM grader on `ubuntu-24.04-arm` runners. The phase covers four requirements: Ollama + model caching (CI-03), dependency caching (CI-04), a separate evaluation workflow (CI-05), and result artifacts (CI-06). A reusable composite action at `.github/actions/setup-ollama/action.yml` encapsulates Ollama installation, model caching, startup with optimized env vars, and readiness waiting. Two parallel jobs (`eval-local` and `eval-docker`) each run validate mode on the `superlint_demo` task. The phase also adds a lightweight model warmup to `LLMGrader` to eliminate cold-start timeout waste on CI.

The project already has a near-complete reference implementation in `benchmark-grader.yml` that demonstrates Ollama setup, model caching, artifact upload, and optimized env vars on the same runner type. The existing `setup-node` composite action provides the pattern for reusable actions. Docker is pre-installed on `ubuntu-24.04-arm` runners, so no additional Docker installation is needed.

**Primary recommendation:** Extract the Ollama setup pattern from `benchmark-grader.yml` into a reusable composite action, then build the skill-eval workflow as two parallel jobs that call this action and run `npm run validate` with their respective providers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Separate workflow file: `.github/workflows/skill-eval.yml`, name: "Skill Eval"
- Independent from CI workflow (not gated, runs in parallel)
- Triggers: `pull_request` + `push` to main + `workflow_dispatch`
- Concurrency groups with `cancel-in-progress: true`, keyed to PR number or branch ref
- Permissions: `contents: read` only
- Two parallel jobs: `eval-local` (local provider) and `eval-docker` (Docker provider)
- Both jobs always run on all triggers (no conditional Docker job)
- 30-minute timeout per job
- Validate mode only (`--validate` flag, reference solution, no agent CLI needed)
- Agent CLI backends are deferred to v2
- superlint_demo task only (hardcoded, only task with reference solution)
- 1 trial per evaluation (validate mode default in CLI)
- Local provider job: `npm run validate -- superlint_demo --provider=local`
- Docker provider job: `npm run validate -- superlint_demo --provider=docker`
- Reusable composite action at `.github/actions/setup-ollama/action.yml`
- Composite action handles: install via `ai-action/setup-ollama@v2`, model caching via `actions/cache@v5` on `~/.ollama`, model pull (`qwen2.5:3b`), start Ollama with optimized env vars, wait for ready
- Ollama env vars: `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_NUM_THREAD=4`
- Each job calls the composite action independently (jobs run on separate VMs)
- Docker provider job should cache Docker images across CI runs
- Content-hash image naming (Quick Task 3) makes cache invalidation automatic
- Upload JSON results from `results/` directory
- Separate artifacts per job: `eval-results-local` and `eval-results-docker`
- Default retention (no explicit `retention-days`)
- `if: always()` on upload step to preserve partial results
- `npm run preview` step after evaluation (also `if: always()`)
- Model warmup in `LLMGrader`: `num_predict: 1` request before first grading call
- Ollama-only warmup (not for Gemini or Anthropic)
- Once per `LLMGrader` instance (lazy init with `warmedUp` flag)
- 120s warmup timeout
- Non-blocking: if warmup fails, log warning and proceed
- Log warmup timing
- Separate from `checkOllamaAvailability()`

### Claude's Discretion
- Docker image caching strategy (actions/cache, docker save/load, or dedicated action)
- Docker installation on ubuntu-24.04-arm runners (pre-installed or needs setup)
- Composite action internal details (shell, error handling, wait loop)
- Ollama version pinning in composite action
- Model cache key strategy (per-model, shared, etc.)
- Warmup implementation details (placement in grade() vs separate method)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CI-03 | Ollama installation and model caching across CI runs | Composite action pattern with `ai-action/setup-ollama@v2` + `actions/cache@v5` on `~/.ollama`; cache key strategy; model pull step |
| CI-04 | Agent CLI and dependency caching across CI runs | npm ci caching via existing `setup-node` composite; Docker image caching via `docker save`/`docker load` + `actions/cache@v5`; Ollama binary cached by `ai-action/setup-ollama` |
| CI-05 | Separate skill-eval workflow that runs evaluations on PR | New `skill-eval.yml` with `pull_request`/`push`/`workflow_dispatch` triggers; two parallel validate-mode jobs |
| CI-06 | Eval result artifacts uploaded for cross-run comparison | `actions/upload-artifact@v4` with `if: always()` on `results/` directory; separate artifacts per job |

</phase_requirements>

## Standard Stack

### Core
| Library/Action | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `ai-action/setup-ollama` | `@v2` | Install Ollama CLI on runner | Purpose-built for GitHub Actions; handles ARM64 binary download; default version 0.17.7 |
| `actions/cache` | `@v5` | Cache `~/.ollama` models and Docker images between runs | Official GitHub action; supports Cache API v2 (required since April 2025) |
| `actions/upload-artifact` | `@v4` | Upload eval result JSON files as workflow artifacts | Official GitHub action for artifact management |
| `actions/checkout` | `@v4` | Checkout repository code | Standard; required for composite action references |

### Supporting
| Library/Action | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `actions/setup-node` | `@v4` | Install Node.js (used via existing setup-node composite) | Every job that runs npm commands |
| `docker/setup-buildx-action` | N/A | NOT needed -- Docker is pre-installed on ubuntu-24.04-arm | Only if BuildKit features were needed (they are not) |

### Runner Environment
| Property | Value | Source |
|----------|-------|--------|
| Runner label | `ubuntu-24.04-arm` | Matches existing CI and benchmark workflows |
| vCPUs | 4 | ARM64 runner standard |
| RAM | 16 GB | ARM64 runner standard |
| Docker | Pre-installed (v29.1+) | Verified from partner-runner-images ARM64 software list |
| Docker Compose | Pre-installed (v2.40.3+) | Verified from partner-runner-images ARM64 software list |
| Docker Buildx | Pre-installed | Verified from partner-runner-images ARM64 software list |

## Architecture Patterns

### Recommended Project Structure (new/modified files)
```
.github/
  actions/
    setup-node/action.yml       # Existing (reused)
    setup-ollama/action.yml     # NEW: reusable Ollama setup composite action
  workflows/
    ci.yml                      # Existing (unchanged)
    benchmark-grader.yml        # Existing (reference, eventually can use composite)
    skill-eval.yml              # NEW: evaluation workflow
src/
  graders/index.ts              # MODIFIED: add warmup method to LLMGrader
```

### Pattern 1: Reusable Composite Action for Ollama Setup

**What:** A composite action that encapsulates Ollama installation, model caching, model pull, server start with env vars, and readiness check -- callable from any workflow job.

**When to use:** Any workflow job that needs Ollama running with a specific model.

**Reference pattern (from existing setup-node):**
```yaml
# .github/actions/setup-ollama/action.yml
name: 'Setup Ollama'
description: 'Install Ollama, cache models, start server with optimized config'
inputs:
  model:
    description: 'Ollama model to pull and use'
    required: false
    default: 'qwen2.5:3b'
  ollama-version:
    description: 'Ollama CLI version'
    required: false
    default: '0.17.7'
runs:
  using: 'composite'
  steps:
    - name: Install Ollama
      uses: ai-action/setup-ollama@v2
      with:
        version: ${{ inputs.ollama-version }}

    - name: Cache Ollama models
      uses: actions/cache@v5
      with:
        path: ~/.ollama
        key: ollama-model-${{ inputs.model }}
        restore-keys: |
          ollama-model-

    - name: Start Ollama
      shell: bash
      run: |
        OLLAMA_FLASH_ATTENTION=1 \
        OLLAMA_KV_CACHE_TYPE=q8_0 \
        OLLAMA_NUM_PARALLEL=1 \
        OLLAMA_NUM_THREAD=4 \
        ollama serve &
        for i in $(seq 1 30); do
          curl -sf http://localhost:11434/ > /dev/null 2>&1 && break
          sleep 1
        done
        echo "[OK] Ollama ready"

    - name: Pull model
      shell: bash
      run: ollama pull ${{ inputs.model }}
```

**Key composite action rules:**
- Every `run:` step MUST have an explicit `shell: bash` (composite actions do not inherit workflow-level defaults)
- Composite actions cannot include `uses: actions/checkout` (jobs check out separately, composite action is local reference)
- Steps within a composite can use both `run:` and `uses:` directives

### Pattern 2: Docker Image Caching via docker save/load

**What:** Cache Docker images built during evaluation across CI runs using `docker save` to tar, `actions/cache@v5` to persist, and `docker load` to restore.

**When to use:** The `eval-docker` job builds a Docker image from `tasks/superlint_demo/environment/Dockerfile`. With content-hash naming (`skill-eval-superlint_demo-{8char}`), the cache key is deterministic and automatically invalidates when task content changes.

**Recommended approach:**
```yaml
- name: Compute Docker cache key
  id: docker-cache
  shell: bash
  run: |
    # Use the content hash from task files for cache key
    HASH=$(find tasks/superlint_demo -type f | sort | xargs sha256sum | sha256sum | cut -c1-16)
    echo "key=docker-eval-superlint-$HASH" >> "$GITHUB_OUTPUT"

- name: Restore Docker image cache
  id: docker-restore
  uses: actions/cache@v5
  with:
    path: /tmp/docker-cache
    key: ${{ steps.docker-cache.outputs.key }}

- name: Load cached Docker image
  if: steps.docker-restore.outputs.cache-hit == 'true'
  shell: bash
  run: docker load -i /tmp/docker-cache/eval-image.tar

# (evaluation runs here -- DockerProvider checks local images first)

- name: Save Docker image to cache
  if: steps.docker-restore.outputs.cache-hit != 'true'
  shell: bash
  run: |
    mkdir -p /tmp/docker-cache
    IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep skill-eval-superlint | head -1)
    if [ -n "$IMAGE" ]; then
      docker save -o /tmp/docker-cache/eval-image.tar "$IMAGE"
    fi
```

**Why docker save/load over BuildKit GHA cache:** The DockerProvider uses `dockerode` API directly (not `docker build` CLI), so BuildKit cache backends do not apply. The image is small (node:24-slim + superlint tool), so tar serialization overhead is minimal compared to rebuild time.

**Tradeoff:** For small images, re-pulling the base layer from Docker Hub may be comparable to loading from cache. But Docker image caching eliminates the full `docker build` + npm install step inside the container, which is the actual time savings.

### Pattern 3: Model Warmup in LLMGrader

**What:** A `warmUp()` method on `LLMGrader` that sends a minimal `/api/generate` request (`num_predict: 1`) to force model loading before the first real grading call.

**When to use:** Called once per `LLMGrader` instance, between `checkOllamaAvailability()` (fast health check) and `callOllamaWithRetry()` (actual grading).

**Implementation pattern:**
```typescript
export class LLMGrader implements Grader {
    private warnedAboutConfig = false;
    private warmedUp = false;

    private async warmUp(ollamaHost: string, model: string): Promise<void> {
        if (this.warmedUp) {
            return;
        }

        this.warmedUp = true;
        const WARMUP_TIMEOUT_MS = 120_000; // 120s: 1.5x worst CI cold start (81s)
        console.log(`[LLMGrader] Warming up ${model}...`);
        const start = Date.now();

        try {
            await fetch(`${ollamaHost}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model,
                    prompt: 'hi',
                    stream: false,
                    options: { num_predict: 1 },
                }),
                signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
            });

            const elapsed = Date.now() - start;
            console.log(`[LLMGrader] Model warm (${elapsed}ms)`);
        } catch (err: any) {
            const elapsed = Date.now() - start;
            console.warn(`[LLMGrader] Warmup failed after ${elapsed}ms: ${err?.message || err}`);
            // Non-blocking: proceed to grading, retry mechanism is fallback
        }
    }

    // In grade(), after ollamaStatus.available check:
    //   await this.warmUp(ollamaHost, model);
    //   this.warnOllamaConfig();
    //   const ollamaResult = await this.callOllamaWithRetry(...);
}
```

**Key design decisions:**
- `warmedUp` flag set at start (not after success) to avoid retry if warmup fails
- 120s timeout is 1.5x the worst observed cold start (81s on 4-vCPU CI)
- Non-blocking: failure logs a warning but does not prevent grading
- Separate from `checkOllamaAvailability()`: health check is fast (5s), warmup is slow (up to 120s)
- Ollama-only: the warmup method is only called in the Ollama path, not Gemini/Anthropic

### Anti-Patterns to Avoid
- **Starting Ollama with env vars at job level instead of in the serve command:** Ollama env vars must be set when `ollama serve` starts. Setting them at the GitHub Actions job `env:` level propagates them to child processes, but only matters for the step that runs `ollama serve`. The composite action pattern correctly sets them inline with the serve command.
- **Using `ai-action/ollama-action@v2` instead of `setup-ollama@v2`:** The higher-level `ollama-action` includes its own model caching and serving logic, but it is less controllable for custom env var configuration and restart scenarios.
- **Caching Docker images with BuildKit GHA backend:** The project uses `dockerode` API, not `docker build` CLI. BuildKit cache backends do not apply.
- **Making warmup blocking (throw on failure):** The retry mechanism in `callOllamaWithRetry` already handles cold starts. Warmup is an optimization, not a requirement.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ollama binary installation | Manual curl/install script | `ai-action/setup-ollama@v2` | Handles ARM64 platform detection, version management, PATH setup |
| Model file caching | Custom artifact/storage solution | `actions/cache@v5` on `~/.ollama` | Proven pattern from benchmark workflow; handles cache eviction, cross-branch access |
| Artifact upload | Custom file transfer | `actions/upload-artifact@v4` | Handles compression, retention, multi-file uploads |
| Readiness wait loop | Custom health check script | Shell `curl` loop (30 iterations x 1s) | Simple, proven in benchmark workflow |

**Key insight:** The benchmark-grader workflow already solved most of these problems. Extract and formalize the patterns rather than reinventing them.

## Common Pitfalls

### Pitfall 1: Composite Action Missing `shell: bash`
**What goes wrong:** Steps in composite actions fail with cryptic errors or use the wrong shell.
**Why it happens:** Unlike regular workflow steps, composite action steps do NOT inherit `defaults.run.shell` from the calling workflow. Each `run:` step must explicitly specify `shell: bash`.
**How to avoid:** Add `shell: bash` to every `run:` step in the composite action.
**Warning signs:** Steps silently use `sh` instead of `bash`, causing Bash-specific syntax (`[[ ]]`, `$(seq)`) to fail.

### Pitfall 2: Ollama Env Vars Not Applied to Serve Process
**What goes wrong:** Model runs without optimized settings (flash attention, KV cache quantization), resulting in slower inference and higher memory usage.
**Why it happens:** Ollama env vars (`OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE`, etc.) must be set in the environment of the `ollama serve` process, not just the shell session that calls `ollama pull` or `ollama run`.
**How to avoid:** Set env vars inline with `ollama serve &` command, exactly as the benchmark workflow does.
**Warning signs:** LLMGrader config warning fires in CI logs: "OLLAMA_FLASH_ATTENTION not set".

### Pitfall 3: Cold Start Timeout on First Grading Call
**What goes wrong:** First `callOllama` times out at 60s because the model takes ~81s to load on 4-vCPU CI.
**Why it happens:** qwen2.5:3b cold start on 4-vCPU ARM64 is ~81s vs ~12s warm. Without warmup, the first grading call hits the 60s timeout.
**How to avoid:** Implement the warmup pattern (num_predict: 1) before the first grading call. With 120s warmup timeout, the model is loaded and ready.
**Warning signs:** First trial takes 60s+ with a "timed out" retry, second trial completes in ~12s.

### Pitfall 4: Docker Image Cache Key Mismatch
**What goes wrong:** Docker image cache never hits because the cache key does not match between save and restore.
**Why it happens:** The cache key must be computed identically in the save and restore steps. If the hash computation differs (e.g., different file ordering), the cache is never restored.
**How to avoid:** Use a deterministic hash of task files as the cache key. Compute once and reference via step output.
**Warning signs:** Docker build step runs every time despite no content changes.

### Pitfall 5: Results Directory Empty When Upload Runs
**What goes wrong:** Artifact upload succeeds but contains no files.
**Why it happens:** The `results/` directory does not exist or has no JSON files if the evaluation failed before writing results. The `if: always()` condition ensures the step runs, but the directory may be empty.
**How to avoid:** Use `actions/upload-artifact@v4` which handles empty directories gracefully (posts a warning, no failure). Accept that failed evaluations may produce empty artifacts.
**Warning signs:** Artifact download contains no files after a failed evaluation run.

### Pitfall 6: Concurrent Workflow Runs Consuming Cache Quota
**What goes wrong:** Multiple PR workflows fill the cache, evicting important entries.
**Why it happens:** Each Ollama model cache is ~2GB. Multiple concurrent workflow runs can exhaust the 10GB cache limit.
**How to avoid:** Use specific cache keys (not broad ones). The model-name-based key (`ollama-model-qwen2.5:3b`) ensures only one cache entry per model. Concurrency groups with `cancel-in-progress: true` limit concurrent runs.
**Warning signs:** Cache miss rate increases; old cache entries disappear.

## Code Examples

### Skill Eval Workflow Structure
```yaml
# Source: Derived from benchmark-grader.yml patterns
name: Skill Eval

on:
  pull_request:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  NODE_OPTIONS: '--max-old-space-size=4096'

jobs:
  eval-local:
    name: Eval (local)
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - uses: ./.github/actions/setup-ollama
      - name: Run evaluation
        run: npm run validate -- superlint_demo --provider=local
      - name: Preview results
        if: always()
        run: npm run preview
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-results-local
          path: results/

  eval-docker:
    name: Eval (docker)
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - uses: ./.github/actions/setup-ollama
      # Docker image caching steps here
      - name: Run evaluation
        run: npm run validate -- superlint_demo --provider=docker
      - name: Preview results
        if: always()
        run: npm run preview
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: eval-results-docker
          path: results/
```

### LLMGrader Warmup Integration Point
```typescript
// Source: src/graders/index.ts lines 167-179
// Current code (before warmup):
if (ollamaStatus.available) {
    this.warnOllamaConfig();
    const ollamaResult = await this.callOllamaWithRetry(prompt, ollamaHost, config);
    // ...
}

// After warmup insertion:
if (ollamaStatus.available) {
    await this.warmUp(ollamaHost, model);  // NEW: force model load
    this.warnOllamaConfig();
    const ollamaResult = await this.callOllamaWithRetry(prompt, ollamaHost, config);
    // ...
}
```

### Composite Action Wait Loop (from benchmark-grader.yml)
```bash
# Source: .github/workflows/benchmark-grader.yml lines 56-59
# Proven pattern: 30 retries x 1s = 30s max wait
for i in $(seq 1 30); do
  curl -sf http://localhost:11434/ > /dev/null 2>&1 && break
  sleep 1
done
echo "[OK] Ollama ready"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `actions/cache@v4` | `actions/cache@v5` | Late 2024 | Cache API v2 required since April 2025; v4 still works but v5 is current |
| `ai-action/setup-ollama@v1` | `ai-action/setup-ollama@v2` | Late 2025 | Node 24 runtime, updated default Ollama version (0.17.7) |
| GitHub Actions 10GB cache limit | >10GB cache per repo | November 2025 | More room for Docker images + Ollama models |
| `actions/upload-artifact@v3` | `actions/upload-artifact@v4` | 2024 | Better handling of large/empty uploads |

**Verified current:**
- `ubuntu-24.04-arm` runners include Docker (v29.1+), Docker Compose (v2.40.3+), Docker Buildx pre-installed
- `ai-action/setup-ollama@v2` default version is 0.17.7
- `actions/cache@v5` supports Cache API v2

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom ts-node test runner (no framework dependency) |
| Config file | None -- tests are standalone ts-node scripts |
| Quick run command | `npm run test:ollama-grader` |
| Full suite command | `npm run test:ollama-grader && npm run test:bootstrap && npm run test:analytics && npm run test:local-provider && npm run test:docker-cache` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CI-03 | Ollama setup + model caching in composite action | smoke (CI) | Push PR and observe workflow run | N/A (workflow YAML, not unit-testable) |
| CI-04 | npm/Docker/Ollama dependency caching | smoke (CI) | Compare first-run vs second-run timing | N/A (workflow YAML) |
| CI-05 | Separate skill-eval workflow triggers on PR | smoke (CI) | Push PR and observe workflow triggers | N/A (workflow YAML) |
| CI-06 | Eval result artifacts uploaded | smoke (CI) | Verify artifacts in workflow run UI | N/A (workflow YAML) |
| WARMUP | LLMGrader warmup eliminates cold-start waste | unit | `npm run test:ollama-grader` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npm run test:ollama-grader` (warmup tests)
- **Per wave merge:** Full test suite + manual workflow verification
- **Phase gate:** Trigger workflow on PR; verify both jobs complete, artifacts uploaded, second run shows cache hits

### Wave 0 Gaps
- [ ] `tests/ollama-grader.test.ts` -- add warmup-specific test cases (warmup called once, warmup failure non-blocking, warmup skipped for non-Ollama)
- [ ] Workflow YAML validation: `actionlint` or manual review (no automated framework for workflow testing)

## Open Questions

1. **Docker image cache size vs pull time**
   - What we know: The eval Docker image is based on `node:24-slim` (~50MB compressed) plus superlint tool. Total image size is likely under 200MB.
   - What's unclear: Whether `docker save/load` + cache is faster than a fresh `docker pull` + `docker build` on the ARM64 runner. Network bandwidth on GitHub runners is typically fast.
   - Recommendation: Implement `docker save/load` caching. If it proves slower than rebuild, it can be removed. The content-hash cache key ensures automatic invalidation.

2. **Ollama version pinning strategy**
   - What we know: `ai-action/setup-ollama@v2` defaults to `0.17.7`. The benchmark workflow pins to `0.17.7`.
   - What's unclear: Whether to pin the version in the composite action or accept the default.
   - Recommendation: Pin to `0.17.7` in the composite action input default (matching benchmark workflow). This ensures reproducible behavior and can be updated explicitly.

## Sources

### Primary (HIGH confidence)
- `.github/workflows/benchmark-grader.yml` -- reference implementation for Ollama setup, caching, artifacts on ARM64 CI
- `.github/actions/setup-node/action.yml` -- composite action pattern
- `src/graders/index.ts` -- LLMGrader source code (warmup insertion point)
- `src/evalRunner.ts` -- results output format and save mechanism
- [GitHub partner-runner-images ARM64 software list](https://github.com/actions/partner-runner-images/blob/main/images/arm-ubuntu-24-image.md) -- Docker pre-installed confirmation
- [ai-action/setup-ollama README](https://github.com/ai-action/setup-ollama) -- v2 inputs, defaults (version 0.17.7)

### Secondary (MEDIUM confidence)
- [GitHub Changelog: Actions cache >10GB](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/) -- expanded cache limits
- [GitHub community Docker caching discussion](https://github.com/orgs/community/discussions/103495) -- docker save/load patterns and tradeoffs
- [Composite action best practices](https://infinitejs.com/posts/overcoming-github-composite-actions-pitfalls/) -- shell requirement, error handling

### Tertiary (LOW confidence)
- Docker save/load performance vs network pull on ARM64 runners: anecdotal reports suggest network may be faster for small images. Needs validation in this specific context.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all actions/tools verified via official sources and existing project usage
- Architecture: HIGH -- patterns directly derived from working benchmark-grader.yml in same codebase
- Pitfalls: HIGH -- pitfalls 1-3 derived from project history and Phase 2/2.1 experience; pitfalls 4-6 from general CI best practices
- Warmup implementation: HIGH -- cold-start data from Phase 2.1 benchmark; pattern is straightforward fetch call
- Docker caching: MEDIUM -- strategy is sound but performance tradeoff vs fresh build is unverified for this specific image size

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable domain; GitHub Actions and Ollama release cadence is monthly)
