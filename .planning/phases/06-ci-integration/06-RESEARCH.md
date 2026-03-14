# Phase 6: CI Integration - Research

**Researched:** 2026-03-15
**Domain:** GitHub Actions CI/CD, Ollama model management, opencode CLI setup
**Confidence:** HIGH

## Summary

Phase 6 extends the existing CI infrastructure to support both agent backends (OllamaToolAgent and OpenCodeAgent) running in GitHub Actions. The project already has a solid CI foundation: composite actions for Ollama and Node.js setup, ARM64 runners (`ubuntu-24.04-arm`), model caching, and Docker image caching. The main work involves extending `setup-ollama` to support multiple models with Modelfile creation, creating a new `setup-opencode` composite action, fixing Docker detection for cgroup v2, and adding an agent-eval matrix job.

The most significant technical risk is Docker detection: the current `/proc/1/cgroup` approach for detecting Docker containers does NOT work on Ubuntu 24.04's cgroup v2. This must be fixed before Docker provider tests can work in CI. The opencode linux-arm64 SIGABRT issue (#13367) is caused by Bun's incompatibility with 64KB page size kernels -- GitHub-hosted ARM64 runners use Ampere Altra / Cobalt 100 processors with standard 4KB pages, so opencode should work on these runners without the SIGABRT. This needs empirical verification.

**Primary recommendation:** Extend setup-ollama with YAML-list model input parsed via shell line-by-line processing, create setup-opencode as a simple composite action with `npm install -g`, fix Docker detection to use `/.dockerenv` alongside cgroup, and add agent-eval matrix job with 4 combos.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- setup-ollama: Replace single `model` input with YAML list of mappings `models` input -- no backward compatibility, all callers migrate at once
- Each entry in the YAML list: `name` (required), `modelfile` (optional path), `as` (optional custom model name)
- Action loops over entries: `ollama pull` for each `name`, then `ollama create {as} -f {modelfile}` for entries with Modelfile
- Single cache key for all models: hash of the full `models` input value, path `~/.ollama`
- `OLLAMA_MAX_LOADED_MODELS=1` added to the action's optimized config
- No default models in the action -- each workflow caller specifies all needed models explicitly
- All callers updated in one PR: skill-eval.yml, ci.yml, benchmark-grader.yml
- setup-opencode composite action at `.github/actions/setup-opencode/action.yml`
- Install via `npm install -g opencode-ai@latest` (stable release, not @dev)
- Export `OPENCODE_BIN_PATH=$(which opencode)` to `GITHUB_ENV`
- Include `opencode --version` quick check to verify install
- Disable opencode auto-update via env var
- No caching of global npm install
- Version configurable via `version` input with `latest` default
- ARM64 first (`ubuntu-24.04-arm`), x64 fallback strategy
- Remove SIGSEGV retry loop from OpenCodeAgent
- Clean up stale x64/SIGSEGV comments in OpenCodeAgent
- CI Modelfile for opencode agent: `modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile` (3 threads)
- Same model name for local and CI -- Modelfile differs (num_thread), name stays `qwen3-4b-skill-eval-opencode-agent`
- Workflow: same `skill-eval.yml`, existing eval jobs renamed to `validate-graders`
- New `agent-eval` matrix job: `agent: [ollama, opencode]` x `provider: [local, docker]` = 4 parallel combos
- 30-minute timeout per job
- Start with `--trials=1` for initial CI debugging
- Per-combo artifact upload: `eval-results-{agent}-{provider}`
- Include `npm run preview` step (if: always)

### Claude's Discretion
- setup-ollama implementation: JavaScript action vs composite action for YAML parsing
- Exact opencode auto-update disable env var (RESEARCHED: `OPENCODE_DISABLE_AUTOUPDATE=true`)
- Docker detection logic validation approach on CI runners
- Whether to start with 1-trial or jump to full 5-trial once CI works

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CI-01 | setup-ollama action pulls agent model and creates Modelfile variant | YAML list input parsing, `ollama pull` + `ollama create` loop, cache key hashing |
| CI-02 | setup-opencode composite action installs opencode and generates config for CI | `npm install -g opencode-ai@latest`, `OPENCODE_BIN_PATH`, `OPENCODE_DISABLE_AUTOUPDATE=true` |
| CI-03 | Agent eval workflow runs on CI (ARM64 with fix or x64 fallback) | ARM64 runners use 4KB page size (Neoverse N1/N2), SIGABRT only affects 64KB kernels; Docker detection needs cgroup v2 fix |
| CI-04 | OLLAMA_MAX_LOADED_MODELS=1 set in CI to prevent OOM | Single env var added to setup-ollama optimized config block |
</phase_requirements>

## Standard Stack

### Core
| Library/Tool | Version | Purpose | Why Standard |
|-------------|---------|---------|--------------|
| GitHub Actions composite actions | N/A | Reusable CI setup | Already used for setup-ollama, setup-node |
| ai-action/setup-ollama | v2 | Ollama binary install | Already in use, handles ARM64 binary download |
| actions/cache | v5 | Model/Docker image caching | Already in use |
| actions/upload-artifact | v4 | Result artifact upload | Already in use |
| opencode-ai (npm) | latest | opencode CLI | Stable release per user decision |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| actions/checkout | v4 | Repo checkout | Every job |
| actions/setup-node | v4 | Node.js install (via setup-node action) | Every job needing npm |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Composite action for YAML parsing | JavaScript action | JS action can use `js-yaml` for proper YAML parsing; composite action must use shell `yq` or line-by-line parsing. **Recommendation: Composite action** -- the YAML list format is simple enough for shell parsing (see Architecture Patterns), and a JS action adds Node.js runtime dependency to a step that otherwise runs pure shell. |

## Architecture Patterns

### setup-ollama YAML Input Parsing (Composite Action)

**What:** Parse a multiline YAML list of model entries in a composite action shell step.
**When to use:** When the `models` input contains a YAML list of mappings.
**Recommendation:** Use composite action with shell-based parsing. The input format is constrained enough that `grep`/`awk`/`sed` can handle it without a full YAML parser.

**Input format (from caller):**
```yaml
- uses: ./.github/actions/setup-ollama
  with:
    models: |
      - name: qwen2.5:3b
        modelfile: modelfiles/qwen2.5-3b-skill-eval-ollama-agent.ci.Modelfile
        as: qwen2.5-3b-skill-eval-ollama-agent
      - name: qwen3:4b
        modelfile: modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile
        as: qwen3-4b-skill-eval-opencode-agent
```

**Parsing approach in composite action:**
```bash
# Parse YAML list entries from ${{ inputs.models }}
# Each entry starts with "- name:" on a new line
echo '${{ inputs.models }}' | while IFS= read -r line; do
  # Extract fields using parameter expansion or awk
  case "$line" in
    *"- name:"*) current_name="${line##*- name: }" ;;
    *"modelfile:"*) current_modelfile="${line##*modelfile: }" ;;
    *"as:"*) current_as="${line##*as: }" ;;
  esac
done
```

**Why not JS action:** A JavaScript action requires `node_modules` checked into the repo (or a build step), adds complexity for what is fundamentally a simple loop. The YAML schema is fixed and known -- no arbitrary nesting or complex types.

**Confidence:** HIGH -- this pattern is well-established in GitHub Actions composite actions. The input schema is controlled by this project.

### Cache Key Strategy

**What:** Single cache key derived from the full `models` input string.
**Example:**
```bash
# In the action, compute hash of models input for cache key
MODELS_HASH=$(echo '${{ inputs.models }}' | sha256sum | cut -c1-16)
```
```yaml
- uses: actions/cache@v5
  with:
    path: ~/.ollama
    key: ollama-models-${{ hashFiles('') }}-$MODELS_HASH
    restore-keys: |
      ollama-models-
```

**Note:** `hashFiles()` does not work with inline strings. Use a shell step to compute the hash and set it as a step output, then reference it in the cache step.

### Docker Detection Fix for cgroup v2

**What:** Fix the `OpenCodeAgent` Docker detection to work on Ubuntu 24.04 (cgroup v2).
**Why critical:** Ubuntu 24.04 uses cgroup v2 by default. Under cgroup v2, `/proc/1/cgroup` contains only `0::/` -- it does NOT contain "docker" or "kubepods". The current detection will always return false on GitHub Actions runners running Docker provider.

**Current (broken on cgroupv2):**
```typescript
const hostnameResult = await runCommand('cat /proc/1/cgroup 2>/dev/null | head -1');
let inDocker = hostnameResult.stdout.includes('docker')
    || hostnameResult.stdout.includes('kubepods');
```

**Fixed (works on both cgroup v1 and v2):**
```typescript
// Method 1: Check /.dockerenv (most reliable, works on both v1 and v2)
const dockerenvResult = await runCommand('test -f /.dockerenv && echo yes || echo no');
let inDocker = dockerenvResult.stdout.trim() === 'yes';

if (!inDocker) {
    // Method 2: Check /proc/1/cgroup for cgroup v1 compatibility
    const cgroupResult = await runCommand('cat /proc/1/cgroup 2>/dev/null | head -1');
    inDocker = cgroupResult.stdout.includes('docker')
        || cgroupResult.stdout.includes('kubepods');
}
```

**Confidence:** HIGH -- `/.dockerenv` is the de facto standard for Docker detection. Docker creates this file in every container. systemd uses it for detection. It works across cgroup v1 and v2.

### setup-opencode Composite Action Structure

```yaml
name: 'Setup OpenCode'
description: 'Install OpenCode CLI and configure for CI'
inputs:
  version:
    description: 'OpenCode version to install'
    required: false
    default: 'latest'
runs:
  using: 'composite'
  steps:
    - name: Install OpenCode
      shell: bash
      run: |
        npm install -g opencode-ai@${{ inputs.version }}
        echo "OPENCODE_BIN_PATH=$(which opencode)" >> "$GITHUB_ENV"
        echo "OPENCODE_DISABLE_AUTOUPDATE=true" >> "$GITHUB_ENV"

    - name: Verify installation
      shell: bash
      run: opencode --version
```

### Workflow Matrix Strategy

```yaml
agent-eval:
  name: Agent Eval (${{ matrix.agent }}/${{ matrix.provider }})
  runs-on: ubuntu-24.04-arm
  timeout-minutes: 30
  strategy:
    fail-fast: false
    matrix:
      agent: [ollama, opencode]
      provider: [local, docker]
      include:
        - agent: ollama
          provider: local
          models: |
            - name: qwen2.5:3b
              modelfile: modelfiles/qwen2.5-3b-skill-eval-ollama-agent.ci.Modelfile
              as: qwen2.5-3b-skill-eval-ollama-agent
        - agent: ollama
          provider: docker
          models: |
            - name: qwen2.5:3b
              modelfile: modelfiles/qwen2.5-3b-skill-eval-ollama-agent.ci.Modelfile
              as: qwen2.5-3b-skill-eval-ollama-agent
        - agent: opencode
          provider: local
          models: |
            - name: qwen2.5:3b
            - name: qwen3:4b
              modelfile: modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile
              as: qwen3-4b-skill-eval-opencode-agent
        - agent: opencode
          provider: docker
          models: |
            - name: qwen2.5:3b
            - name: qwen3:4b
              modelfile: modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile
              as: qwen3-4b-skill-eval-opencode-agent
```

**Note on grader model:** The grader model (`qwen2.5:3b`) is needed for ALL agent-eval combos. For ollama agent, it doubles as the agent model (with Modelfile customization). For opencode agent, both `qwen2.5:3b` (grader) and `qwen3:4b` (agent, with Modelfile) are needed. The grader model does NOT need a Modelfile in the matrix -- it gets its Modelfile only for the ollama agent combos where it IS the agent model.

Wait -- re-reading the context: the grader model `qwen2.5:3b` also needs its Modelfile for grading (it uses `qwen2.5-3b-skill-eval-ollama-agent` as the model name for the OllamaToolAgent). But for opencode combos, the grader is separate. Need to check whether the grader uses the raw `qwen2.5:3b` or the Modelfile variant.

Actually, looking at the existing CI workflow (`skill-eval.yml`), `npm run validate` uses `setup-ollama` with default model `qwen2.5:3b` (no Modelfile), and the validation runs with `--provider=local`. The grader in the eval pipeline uses `qwen3:4b` with think:false (from project memory). Let me verify the grader model setup.

**Confidence:** MEDIUM -- matrix include syntax is well-documented but the exact model requirements per combo need verification during planning.

### Anti-Patterns to Avoid
- **Parsing YAML with regex:** Don't try to handle arbitrary YAML with shell regex. The schema is fixed -- use simple field extraction.
- **Using `fromJSON()` for multiline inputs:** Overly complex for this use case. Line-by-line parsing is simpler and more debuggable.
- **Caching npm global installs for opencode:** User decided against it -- ~10s install not worth cache complexity.
- **Using `opencode-ai@dev` in CI:** User decided stable `@latest` only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ollama binary install | Manual curl/wget | `ai-action/setup-ollama@v2` | Handles ARM64 vs x64, version pinning, server startup |
| Model caching | Custom tar/untar | `actions/cache@v5` with `~/.ollama` path | Standard GHA caching with restore-keys fallback |
| Docker image caching | Registry push/pull | `actions/cache@v5` with `docker save/load` | Already established pattern in skill-eval.yml |
| Node.js setup | Manual install | `actions/setup-node@v4` via `setup-node` composite action | Already established pattern |

## Common Pitfalls

### Pitfall 1: cgroup v2 Docker Detection Failure
**What goes wrong:** Docker provider eval jobs fail because `inDocker` is always `false` on Ubuntu 24.04 runners.
**Why it happens:** Ubuntu 24.04 defaults to cgroup v2. Under v2, `/proc/1/cgroup` contains only `0::/` -- no "docker" string.
**How to avoid:** Use `/.dockerenv` file check as primary detection, fall back to cgroup parsing for v1 compatibility.
**Warning signs:** Docker provider jobs behave identically to local provider jobs (no `host.docker.internal` URL adjustment).

### Pitfall 2: YAML Input Multiline Expansion in Composite Actions
**What goes wrong:** `${{ inputs.models }}` expands to a multiline string that breaks shell commands or YAML structure.
**Why it happens:** GitHub Actions `${{ }}` is text replacement -- multiline values can break shell syntax.
**How to avoid:** Always quote the expansion: `echo '${{ inputs.models }}'` or write to a temp file first. Use heredoc for shell processing.
**Warning signs:** "unexpected EOF while looking for matching `'`" or YAML parse errors in workflow logs.

### Pitfall 3: opencode Auto-Update Latency in CI
**What goes wrong:** First `opencode run` takes 30+ seconds as it downloads an update.
**Why it happens:** opencode checks for updates on every launch by default.
**How to avoid:** Set `OPENCODE_DISABLE_AUTOUPDATE=true` in `GITHUB_ENV` (already planned in setup-opencode action).
**Warning signs:** Unexpected 30-60s delay at the start of opencode run step.

### Pitfall 4: Ollama OOM with Concurrent Models
**What goes wrong:** Agent model and grader model loaded simultaneously, runner runs out of 16 GB RAM.
**Why it happens:** Ollama loads models on first request and keeps them in memory by default.
**How to avoid:** Set `OLLAMA_MAX_LOADED_MODELS=1` (CI-04). Agent code already has model unload in `finally` block.
**Warning signs:** Ollama process killed by OOM killer, eval jobs timeout.

### Pitfall 5: `hashFiles()` Cannot Hash Inline Strings
**What goes wrong:** Cache key expression `${{ hashFiles(inputs.models) }}` fails or produces unexpected results.
**Why it happens:** `hashFiles()` only works with file path globs, not arbitrary strings.
**How to avoid:** Compute hash in a shell step: `echo "$MODELS" | sha256sum | cut -c1-16`, then set as step output.
**Warning signs:** Cache never hits, or all jobs share the same cache key.

### Pitfall 6: opencode SIGABRT on Non-Standard ARM64 Kernels
**What goes wrong:** `opencode --version` crashes with SIGABRT (exit 134) on certain ARM64 systems.
**Why it happens:** Bun runtime (underlying opencode) is incompatible with 64KB page size kernels (e.g., NVIDIA GH200).
**How to avoid:** GitHub-hosted runners use Ampere Altra / Cobalt 100 with standard 4KB page size -- this should NOT trigger the bug. But verify in the first CI run with `getconf PAGE_SIZE` as a diagnostic step.
**Warning signs:** Exit code 134 from any opencode command.

## Code Examples

### CI Modelfile for OpenCode Agent
```
# modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile
FROM qwen3:4b
PARAMETER num_ctx 4096
PARAMETER num_predict 4096
PARAMETER temperature 0
PARAMETER num_batch 1024
PARAMETER num_thread 3
```
Source: Follows existing pattern from `modelfiles/qwen2.5-3b-skill-eval-ollama-agent.ci.Modelfile` (3 threads for CI) and `modelfiles/qwen3-skill-eval-agent.ci.Modelfile`.

### setup-ollama Model Loop
```bash
# Parse models input and process each entry
current_name=""
current_modelfile=""
current_as=""

process_entry() {
  if [ -n "$current_name" ]; then
    echo "[INFO] Pulling $current_name..."
    ollama pull "$current_name"

    if [ -n "$current_modelfile" ] && [ -n "$current_as" ]; then
      echo "[INFO] Creating $current_as from $current_modelfile..."
      ollama create "$current_as" -f "$current_modelfile"
    fi
  fi
  current_name=""
  current_modelfile=""
  current_as=""
}

echo '${{ inputs.models }}' | while IFS= read -r line; do
  trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')
  case "$trimmed" in
    "- name:"*)
      process_entry
      current_name="${trimmed#*- name: }"
      ;;
    "name:"*)
      process_entry
      current_name="${trimmed#*name: }"
      ;;
    "modelfile:"*)
      current_modelfile="${trimmed#*modelfile: }"
      ;;
    "as:"*)
      current_as="${trimmed#*as: }"
      ;;
  esac
done
process_entry
```

**Important caveat:** The `while read` loop runs in a subshell when piped. Variables set inside the loop are NOT visible outside. Use a process substitution or temp file approach:
```bash
# Write models to temp file, then read with redirect (avoids subshell)
echo '${{ inputs.models }}' > /tmp/models.yml
while IFS= read -r line; do
  # ... same parsing logic
done < /tmp/models.yml
process_entry
```

### Renamed validate-graders Job
```yaml
validate-graders:
  name: Validate Graders
  runs-on: ubuntu-24.04-arm
  timeout-minutes: 30
  steps:
    - uses: actions/checkout@v4
    - uses: ./.github/actions/setup-node
    - uses: ./.github/actions/setup-ollama
      with:
        models: |
          - name: qwen2.5:3b
    - name: Validate (local)
      run: npm run validate -- superlint_demo --provider=local
    - name: Validate (docker)
      run: npm run validate -- superlint_demo --provider=docker
    # ... Docker cache steps, preview, artifact upload
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| cgroup v1 Docker detection | `/.dockerenv` + cgroup fallback | Ubuntu 24.04 (cgroupv2 default) | Docker provider detection broken without fix |
| opencode auto-update always on | `OPENCODE_DISABLE_AUTOUPDATE=true` env var | Available in opencode config | 30s+ latency savings in CI |
| Single model in setup-ollama | Multi-model YAML list input | This phase | All callers must migrate |

## Open Questions

1. **Grader model identity in agent-eval matrix**
   - What we know: The LLM grader uses `qwen3:4b` with `think:false` (per project memory). The OllamaToolAgent uses `qwen2.5:3b` with a Modelfile. The grader creates its own Ollama instance.
   - What's unclear: Does the grader use the raw `qwen3:4b` model or a Modelfile variant? If it needs a Modelfile, that must also be in the `models` input for all combos.
   - Recommendation: Check grader code to determine if it uses a custom model name or the raw tag. This affects the matrix `include` models list.

2. **opencode linux-arm64 binary on GitHub runners**
   - What we know: Issue #13367 is SIGABRT on 64KB page size kernels (NVIDIA GH200). GitHub ARM64 runners use Ampere Altra / Cobalt 100 with standard 4KB pages.
   - What's unclear: Whether there are other ARM64 binary issues beyond the page size one. v1.2.20+ replaced many Bun APIs with Node.js equivalents.
   - Recommendation: Add `getconf PAGE_SIZE` diagnostic in first CI run. If SIGABRT occurs, fall back to `ubuntu-latest` (x64) for opencode jobs only.

3. **`which opencode` on Ubuntu**
   - What we know: `which` is available on Ubuntu but is not POSIX. Some minimal Docker images lack it.
   - What's unclear: Whether GitHub Actions runners have `which` (they almost certainly do).
   - Recommendation: Use `command -v opencode` as a POSIX alternative if `which` is a concern. Both work on standard Ubuntu runners.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | ts-node test scripts (no test runner framework -- raw assert/process.exit) |
| Config file | None -- each test is a standalone ts-node script |
| Quick run command | `npx ts-node tests/{test-file}.test.ts` |
| Full suite command | Run all `npm run test:*` scripts from package.json |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CI-01 | setup-ollama pulls models and creates Modelfile variants | CI workflow smoke | `act` (local GHA runner) or manual CI run | N/A -- tested via workflow execution |
| CI-02 | setup-opencode installs opencode and sets env vars | CI workflow smoke | `act` or manual CI run | N/A -- tested via workflow execution |
| CI-03 | Agent eval runs on ARM64 CI | e2e CI | Push to PR and verify workflow passes | N/A -- tested via workflow execution |
| CI-04 | OLLAMA_MAX_LOADED_MODELS=1 prevents OOM | CI env check | Verify env var in workflow logs | N/A -- tested via workflow execution |

### Sampling Rate
- **Per task commit:** Manual PR push to verify workflow changes
- **Per wave merge:** Full workflow run on PR
- **Phase gate:** All 4 agent-eval matrix jobs green + validate-graders green

### Wave 0 Gaps
- [ ] `modelfiles/qwen3-4b-skill-eval-opencode-agent.ci.Modelfile` -- CI Modelfile for opencode agent model
- [ ] `.github/actions/setup-opencode/action.yml` -- new composite action
- [ ] Docker detection fix in `src/agents/opencode/index.ts` -- cgroup v2 compatibility

Note: CI-focused requirements are validated by workflow execution, not unit tests. The "test" is the workflow itself succeeding.

## Sources

### Primary (HIGH confidence)
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) -- ARM64 runner specs, Cobalt 100 / Ampere Altra processors
- [GitHub Actions metadata syntax](https://docs.github.com/en/actions/creating-actions/metadata-syntax-for-github-actions) -- composite action input handling
- [OpenCode Config docs](https://opencode.ai/docs/config/) -- `autoupdate: false` config option
- [OpenCode issue #1793](https://github.com/sst/opencode/issues/1793) -- `OPENCODE_DISABLE_AUTOUPDATE` env var confirmed
- [OpenCode issue #13367](https://github.com/anomalyco/opencode/issues/13367) -- linux-arm64 SIGABRT, Bun 64KB page size root cause, still OPEN

### Secondary (MEDIUM confidence)
- [Baeldung: Determine if process runs inside container](https://www.baeldung.com/linux/is-process-running-inside-container) -- `/.dockerenv` detection method
- [Docker Community Forums](https://forums.docker.com/t/proc-1-cgroups-does-not-tell-if-i-am-inside-of-contianer/132552) -- cgroup v2 detection limitations
- [GitHub community discussion](https://github.com/actions/runner-images/discussions/5941) -- Ubuntu 24.04 uses cgroup v2 by default
- [Agorapulse Medium post](https://medium.com/agorapulse-stories/how-to-work-with-multiline-string-variables-in-github-actions-23f56447d209) -- multiline string handling in GHA

### Tertiary (LOW confidence)
- ARM64 runner page size being 4KB -- inferred from processor family (Neoverse N1/N2), not directly confirmed by GitHub docs. Verify with `getconf PAGE_SIZE` in CI.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools already in use in existing CI, only extending
- Architecture: HIGH -- composite action patterns well-established, YAML parsing approach verified
- Pitfalls: HIGH -- cgroup v2 issue is well-documented across multiple projects
- Docker detection fix: HIGH -- `/.dockerenv` is de facto standard
- opencode ARM64 compatibility: MEDIUM -- page size inference is indirect, needs CI verification

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable CI tooling, slow-moving domain)
