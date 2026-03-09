# Phase 1: CI Foundation - Research

**Researched:** 2026-03-08
**Domain:** GitHub Actions CI workflow, Node.js CI best practices
**Confidence:** HIGH

## Summary

Phase 1 creates a GitHub Actions CI workflow that validates every PR with typecheck, build, and deterministic tests before merge. The project currently has zero CI infrastructure. The workflow will run four parallel jobs (typecheck, build, test-bootstrap, test-analytics) on `ubuntu-24.04-arm` ARM64 runners, using a composite action for shared Node.js setup with npm caching.

The technical domain is well-understood and the chosen tools (GitHub Actions, setup-node, checkout) are mature. The primary research findings concern: (1) LTS codename case sensitivity in `actions/setup-node` -- verified the source code normalizes to lowercase, so `lts/krypton` in `.node-version` will work; (2) the `ubuntu-24.04-arm` runner provides 4 vCPU, 16 GB RAM, 14 GB SSD for public repos; (3) concurrency groups need careful construction to cancel stale PR runs without cancelling main branch runs.

**Primary recommendation:** Implement the workflow exactly as specified in CONTEXT.md decisions. Use `npm ci` (not `npm install`) in CI for deterministic, fast installs. Set `NODE_OPTIONS=--max-old-space-size=4096` as a conservative increase over the default 2 GB -- sufficient for this project's compilation without risking OOM on the 16 GB runner.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Trigger on: pull_request (all branches), push to main, workflow_dispatch (manual)
- No path filtering -- CI runs on every change regardless of files touched
- Cancel stale in-progress runs using concurrency groups keyed to PR number or branch ref
- Workflow named "CI", file at `.github/workflows/ci.yml`
- Permissions: `contents: read` only (GitHub auto-reports job status as checks)
- Use `ubuntu-24.04-arm` (ARM64) for all jobs -- single runner, no matrix
- If ARM runners cause unexpected issues in this or later phases, roll back to `ubuntu-latest` (x86_64)
- Node.js version read from `.node-version` file (lts/krypton = Node 24) via `actions/setup-node@v4`
- npm cache via setup-node built-in `cache: 'npm'` option
- Set `NODE_OPTIONS=--max-old-space-size=<value>` appropriate for 16GB runner (larger than default)
- Four parallel jobs: typecheck, build, test-bootstrap, test-analytics
- No fail-fast -- all jobs always run to completion, report all failures at once
- Composite action at `.github/actions/setup-node/action.yml` for Node setup + npm install
- Each job does `actions/checkout@v4` separately, then calls the composite action
- Build job verifies compilation only -- no artifact upload
- Add `typecheck` script: `tsc --noEmit`
- Add `build` script: `tsc`
- Add eval scripts (for future Phase 3 workflow, will fail until local LLM is available):
  - `eval:superlint`: `npm run eval -- superlint_demo --agent=claude --provider=local`
  - `eval:superlint:docker`: `npm run eval -- superlint_demo --agent=claude --provider=docker`
- Add validate scripts (reference solution, no agent/API keys needed):
  - `validate:superlint`: `npm run validate -- superlint_demo --provider=local`
  - `validate:superlint:docker`: `npm run validate -- superlint_demo --provider=docker`
- Keep existing `ts-node` direct execution for tests (no test framework)
- No combined `test` script -- CI runs test:bootstrap and test:analytics as separate jobs

### Claude's Discretion
- Exact `NODE_OPTIONS=--max-old-space-size` value (must be sensible for 16GB runner, larger than Node's default)
- Job timeout value (around 20 minutes as guideline)
- Composite action internal details (shell, error handling)
- Job naming for status check display

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CI-01 | GitHub Actions CI workflow with separate jobs for typecheck, build, test:bootstrap, and test:analytics | Workflow syntax, concurrency groups, composite actions, runner specs all researched |
| CI-02 | npm package caching across CI runs | `actions/setup-node` built-in `cache: 'npm'` hashes `package-lock.json` for cache key; verified mechanism and best practices |

</phase_requirements>

## Standard Stack

### Core

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| GitHub Actions | N/A (platform) | CI/CD pipeline | Native GitHub integration, free for public repos |
| `actions/checkout` | v4 (locked) | Clone repository in each job | Official GitHub action; v4 is still maintained (latest patch v4.3.1, Nov 2024) |
| `actions/setup-node` | v4 (locked) | Install Node.js + cache npm | Official GitHub action; v4 still maintained; built-in npm caching via `cache: 'npm'` |
| `ubuntu-24.04-arm` | Ubuntu 24.04 Noble | Runner OS | ARM64 runner, free for public repos (GA since Aug 2025), 4 vCPU / 16 GB RAM / 14 GB SSD |
| Node.js 24 LTS | Krypton (24.x) | Runtime | Read from `.node-version` file; LTS since Oct 2025, EOL Apr 2028 |
| TypeScript | 5.9.3 | Typecheck + build | Already in devDependencies |
| ts-node | 10.9.2 | Test execution | Already in devDependencies; tests use `ts-node` directly (no framework) |

### Supporting

| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| Composite action | N/A | Shared Node setup + npm install | Called by all four jobs after checkout |
| `npm ci` | npm 11 (bundled with Node 24) | Deterministic dependency install | Always in CI; faster and more predictable than `npm install` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `actions/checkout@v4` | `@v6` (latest, Jan 2026) | v6 has improved credential security; v4 is locked decision and still maintained |
| `actions/setup-node@v4` | `@v6` (latest v6.2.0, Jan 2026) | v6 has auto-caching for npm; v4 is locked decision and still supported |
| `ubuntu-24.04-arm` | `ubuntu-latest` (x86_64) | x86_64 is fallback if ARM causes issues; ARM is faster (Cobalt 100 Neoverse N2) |

**Installation:** No new packages needed. All tools are already in `devDependencies` or provided by GitHub Actions runners.

## Architecture Patterns

### Recommended Project Structure (new files)

```
.github/
  actions/
    setup-node/
      action.yml           # Composite action: setup-node + npm ci
  workflows/
    ci.yml                 # CI workflow: 4 parallel jobs
```

### Pattern 1: Composite Action for Shared Setup

**What:** A composite action that encapsulates Node.js setup and `npm ci` into a reusable step.
**When to use:** When multiple jobs need identical setup steps (all four jobs in this workflow).
**Example:**

```yaml
# .github/actions/setup-node/action.yml
name: 'Setup Node.js'
description: 'Install Node.js from .node-version and run npm ci'
runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version-file: '.node-version'
        cache: 'npm'
    - name: Install dependencies
      run: npm ci
      shell: bash
```

**Key details:**
- `shell: bash` is REQUIRED on every `run:` step in composite actions (the action does not inherit the workflow's shell)
- Composite actions run inline within the calling job (not as a separate job)
- Referenced via relative path: `uses: ./.github/actions/setup-node`
- Does NOT include checkout (each job checks out separately per locked decision)

### Pattern 2: Parallel Independent Jobs

**What:** Four jobs with no dependency chain, all running simultaneously.
**When to use:** When tasks are independent and you want to report all failures at once (no fail-fast).
**Example:**

```yaml
jobs:
  typecheck:
    name: Typecheck
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run typecheck

  build:
    name: Build
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run build
```

**Key detail:** Since there is no `needs:` between jobs, all four run in parallel. There is no `fail-fast` concern because `fail-fast` only applies to matrix strategies, not independent jobs. Independent jobs always run to completion regardless of other jobs' results.

### Pattern 3: Concurrency Groups for Stale Run Cancellation

**What:** Cancel in-progress CI runs when a new push arrives for the same PR, but never cancel `main` branch runs.
**When to use:** Always on PR-triggered workflows to save runner minutes.
**Example:**

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

**How it works:**
- For `pull_request` events: `github.event.pull_request.number` is defined, so the group is `CI-123` (PR number). New pushes to the same PR cancel in-progress runs.
- For `push` to `main`: `github.event.pull_request.number` is `null`, so it falls back to `github.ref` which is `refs/heads/main`. Each push to main gets the same group key, and `cancel-in-progress: true` will cancel any in-progress main run. This is acceptable for CI (not deployment).
- For `workflow_dispatch`: Similar to `push`, uses `github.ref`.

### Anti-Patterns to Avoid

- **Using `npm install` in CI:** Use `npm ci` instead. It is faster (skips dependency resolution), deterministic (uses exact `package-lock.json` versions), and deletes `node_modules/` first to ensure a clean install.
- **Sharing `node_modules/` via artifacts between jobs:** The setup-node npm cache caches the global npm cache directory (`~/.npm`), not `node_modules/`. Each job runs `npm ci` independently. This is correct -- do not try to cache `node_modules/` directly.
- **Using `fail-fast` thinking with independent jobs:** `fail-fast` is a matrix strategy option. Independent parallel jobs always all run to completion. This is the desired behavior.
- **Omitting `shell: bash` on composite action steps:** Composite actions REQUIRE explicit `shell:` on every `run:` step. Omitting it causes a workflow parse error.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| npm caching | Custom `actions/cache` setup | `actions/setup-node` `cache: 'npm'` | Built-in; hashes `package-lock.json` automatically; handles cache paths per OS |
| Node version management | Hardcoded version in workflow | `node-version-file: '.node-version'` | Single source of truth; `.node-version` already exists with `lts/krypton` |
| Shared setup steps | Copy-paste setup across jobs | Composite action at `.github/actions/setup-node/` | DRY; changes propagate to all jobs |
| Concurrency control | Complex `if:` conditions | `concurrency:` workflow key | Built-in; handles queuing and cancellation automatically |

**Key insight:** GitHub Actions provides first-class solutions for all the infrastructure needs in this phase. The only custom code is the composite action (which is just a thin wrapper around two official actions).

## Common Pitfalls

### Pitfall 1: LTS Codename Case in `.node-version`

**What goes wrong:** The `.node-version` file contains `lts/krypton` (lowercase). If `actions/setup-node` were case-sensitive, this would fail with "Unable to find LTS release 'krypton'."
**Why it happens:** Node.js release manifests use capitalized codenames (e.g., `Krypton`). Tools like `nvm` normalize case but `actions/setup-node` behavior was uncertain.
**How to avoid:** Verified from source code (HIGH confidence): `actions/setup-node` calls `.toLowerCase()` on both the alias from the file AND the manifest codename before comparison. `lts/krypton` will work correctly.
**Warning signs:** Error message "Unable to find LTS release 'krypton' for Node version 'lts/krypton'" would indicate this failed.

### Pitfall 2: Composite Action Must Be Checked Out First

**What goes wrong:** A job tries to `uses: ./.github/actions/setup-node` but the composite action file does not exist on the runner yet.
**Why it happens:** Composite actions referenced by relative path must exist in the checked-out working tree. The `uses:` step resolves the path at runtime.
**How to avoid:** Always run `actions/checkout@v4` as the first step in every job, BEFORE calling the composite action.
**Warning signs:** Error: "Can't find 'action.yml', 'action.yaml' or 'Dockerfile' under '.github/actions/setup-node'."

### Pitfall 3: Stale Cache After Dependency Changes

**What goes wrong:** A CI run uses a cached npm global cache from a previous run with different dependencies. `npm ci` still works correctly (it always reinstalls from `package-lock.json`), but cache hits on stale caches add unnecessary download time.
**Why it happens:** The `actions/setup-node` cache key includes the `package-lock.json` hash. When dependencies change, the old cache is a miss and a new one is created. This is by design and works correctly. The "pitfall" is expecting cache to speed up the FIRST run after a dependency change -- it won't.
**How to avoid:** No action needed. This is expected behavior. Document it for team awareness.
**Warning signs:** Cache miss messages in the "Setup Node.js" step output.

### Pitfall 4: Bootstrap Test Requires Filesystem Access

**What goes wrong:** The `bootstrap.test.ts` creates temporary directories (`test_logs/`, `secret_logs/`), runs shell commands, and cleans up. It also attempts Docker access (but gracefully skips if unavailable).
**Why it happens:** The test is an integration test, not a unit test. It exercises the full eval pipeline including file I/O and process spawning.
**How to avoid:** The ARM64 runner has a full Linux environment with bash, so this will work. Docker is available on `ubuntu-24.04-arm` runners (Docker Engine is pre-installed). The test's Docker check (`docker ps`) will succeed.
**Warning signs:** Permission errors on temp directory creation, or shell command execution failures.

### Pitfall 5: ARM64 Binary Compatibility

**What goes wrong:** Some npm packages with native binaries (C++ addons) may not have ARM64 prebuilds.
**Why it happens:** The project's dependencies (`dockerode`, `fs-extra`, `tar-stream`, `toml`) are pure JavaScript or have ARM64 support. However, future dependencies might not.
**How to avoid:** All current dependencies are pure JS -- no native binaries needed. If ARM64 issues arise, the CONTEXT.md specifies rolling back to `ubuntu-latest` (x86_64).
**Warning signs:** `npm ci` failures with "unsupported platform" or "prebuild not found" errors.

### Pitfall 6: `NODE_OPTIONS` Affects All Node Processes

**What goes wrong:** Setting `NODE_OPTIONS=--max-old-space-size=4096` at the job level applies to ALL Node.js invocations in that job, including `npm ci`, `tsc`, `ts-node`, and even npm lifecycle scripts.
**Why it happens:** `NODE_OPTIONS` is an environment variable that Node.js reads on startup.
**How to avoid:** Set it at the workflow level (applies to all jobs) or at the job level. The value 4096 (4 GB) is safe for all processes on a 16 GB runner. Do NOT set it excessively high (e.g., 14 GB) as that could cause OOM if multiple Node processes run concurrently.
**Warning signs:** OOM kill on the runner if value is too high.

## Code Examples

Verified patterns from official sources:

### Complete Workflow Structure

```yaml
# Source: GitHub Actions workflow syntax docs
name: CI

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
  typecheck:
    name: Typecheck
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run typecheck

  build:
    name: Build
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run build

  test-bootstrap:
    name: Test (bootstrap)
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run test:bootstrap

  test-analytics:
    name: Test (analytics)
    runs-on: ubuntu-24.04-arm
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-node
      - run: npm run test:analytics
```

### Composite Action Structure

```yaml
# Source: GitHub docs - Creating a composite action
# .github/actions/setup-node/action.yml
name: 'Setup Node.js'
description: 'Install Node.js from .node-version and run npm ci'
runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version-file: '.node-version'
        cache: 'npm'
    - name: Install dependencies
      run: npm ci
      shell: bash
```

### Package.json Script Additions

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "eval:superlint": "npm run eval -- superlint_demo --agent=claude --provider=local",
    "eval:superlint:docker": "npm run eval -- superlint_demo --agent=claude --provider=docker",
    "validate:superlint": "npm run validate -- superlint_demo --provider=local",
    "validate:superlint:docker": "npm run validate -- superlint_demo --provider=docker"
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `actions/checkout@v4` | `actions/checkout@v6` (Jan 2026) | v5 Aug 2025, v6 Nov 2025 | v6 has improved credential security; v4 still maintained and is our locked decision |
| `actions/setup-node@v4` | `actions/setup-node@v6` (Jan 2026) | v5 2025, v6 Oct 2025 | v6 has auto-caching for npm; v4 is locked decision and still works |
| `ubuntu-latest` (x86_64) | `ubuntu-24.04-arm` (ARM64) | GA Aug 2025 | ARM64 runners are GA for public repos; Cobalt 100 CPU is faster |
| Node.js 22 LTS (Jod) | Node.js 24 LTS (Krypton) | Oct 2025 | Active LTS, supported until Apr 2028 |
| Manual `actions/cache` for npm | `setup-node` built-in `cache: 'npm'` | Available since setup-node v3 | Simpler configuration, automatic `package-lock.json` hash keying |

**Deprecated/outdated:**
- `actions/setup-node@v3`: Use v4+ (v3 uses Node 16 runtime which GitHub deprecated)
- `ubuntu-22.04-arm`: Older OS image; prefer `ubuntu-24.04-arm` for latest security patches
- `npm install` in CI: Always use `npm ci` for deterministic builds

## Open Questions

1. **Runner availability during peak hours**
   - What we know: ARM64 runners are GA for public repos. GitHub docs note potential queue times during peak usage.
   - What's unclear: Whether queue times are still noticeable post-GA (initial preview concern).
   - Recommendation: Proceed with `ubuntu-24.04-arm`. If queue times become problematic, the fallback to `ubuntu-latest` is documented in the locked decisions.

2. **Docker availability on ARM64 runners**
   - What we know: Standard GitHub-hosted runners (x86_64) have Docker pre-installed. The bootstrap test gracefully skips Docker tests if unavailable.
   - What's unclear: Whether `ubuntu-24.04-arm` has Docker pre-installed (partner images managed by Arm, LLC may differ).
   - Recommendation: The test handles this gracefully already. If Docker is missing, the test skips Docker tests and passes. No action needed.

3. **Future action version upgrades**
   - What we know: `actions/checkout` and `actions/setup-node` are both at v6 now. The locked decisions specify v4.
   - What's unclear: Whether v4 will continue to receive security patches long-term.
   - Recommendation: Use v4 as locked. Both actions still receive backported patches. Consider upgrading in a future PR if needed.

## Discretion Recommendations

Based on Claude's Discretion areas from CONTEXT.md:

### NODE_OPTIONS max-old-space-size: `4096` (4 GB)

**Rationale:** Node.js defaults to ~2 GB heap. The project is a modest TypeScript codebase (~20 source files). 4 GB is double the default and sufficient for `tsc` compilation of this project. On a 16 GB runner, this leaves 12 GB for the OS, npm, and other processes. Going higher (e.g., 8192) is unnecessary and increases OOM risk if multiple Node processes run concurrently.

### Job timeout: `20` minutes

**Rationale:** The CONTEXT.md suggests ~20 minutes as a guideline. The bootstrap test runs shell commands and creates temp directories (fast, under 2 minutes). The analytics test is pure computation (under 10 seconds). TypeScript compilation is fast for this project size (under 30 seconds). `npm ci` on a cold cache takes 30-60 seconds. 20 minutes provides ample headroom while catching hung processes.

### Composite action details

**Rationale:**
- Use `shell: bash` on all `run:` steps (required for composite actions)
- Two steps: (1) `actions/setup-node@v4` with `node-version-file` and `cache`, (2) `npm ci` with `shell: bash`
- No error handling beyond default (steps fail-fast by default in composite actions; `set -e` is the default for `shell: bash`)
- No inputs/outputs needed (the action reads `.node-version` and `package-lock.json` from the checked-out repo)

### Job naming for status check display

**Rationale:** Use descriptive names that appear clearly in GitHub PR check list:
- `Typecheck` -- clear, maps to `tsc --noEmit`
- `Build` -- clear, maps to `tsc`
- `Test (bootstrap)` -- parenthetical distinguishes test types
- `Test (analytics)` -- matches the pattern

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | ts-node direct execution (no test framework) |
| Config file | None -- tests are standalone scripts that exit with code 0/1 |
| Quick run command | `npm run test:analytics` (under 1 second) |
| Full suite command | `npm run test:bootstrap && npm run test:analytics` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CI-01 | Workflow triggers on PR and runs 4 separate jobs | smoke (manual) | Push a test PR and verify GitHub checks appear | N/A -- workflow validation, not code test |
| CI-01 | Typecheck script works | unit | `npm run typecheck` | Script to be added (Wave 0) |
| CI-01 | Build script works | unit | `npm run build` | Script to be added (Wave 0) |
| CI-01 | Bootstrap test passes | integration | `npm run test:bootstrap` | tests/bootstrap.test.ts |
| CI-01 | Analytics test passes | unit | `npm run test:analytics` | tests/analytics.test.ts |
| CI-02 | npm cache restores on second run | smoke (manual) | Run workflow twice; verify "Cache restored" in setup-node output | N/A -- cache behavior, not code test |

### Sampling Rate

- **Per task commit:** `npm run test:analytics` (fastest feedback)
- **Per wave merge:** `npm run test:bootstrap && npm run test:analytics`
- **Phase gate:** Push PR, verify all 4 GitHub Actions jobs pass, verify second run has cache hits

### Wave 0 Gaps

- [ ] `package.json` `typecheck` script -- must be added (`tsc --noEmit`)
- [ ] `package.json` `build` script -- must be added (`tsc`)
- [ ] `package.json` eval/validate scripts -- must be added (6 scripts per CONTEXT.md)
- [ ] `.github/workflows/ci.yml` -- must be created (entire workflow)
- [ ] `.github/actions/setup-node/action.yml` -- must be created (composite action)

## Sources

### Primary (HIGH confidence)

- [actions/setup-node source code](https://github.com/actions/setup-node/blob/main/src/distributions/official_builds/official_builds.ts) - Verified LTS codename case normalization via `.toLowerCase()` in `resolveLtsAliasFromManifest`
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) - Verified `ubuntu-24.04-arm` specs: 4 vCPU, 16 GB RAM, 14 GB SSD (public repos)
- [GitHub Actions workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions) - Concurrency groups, permissions, triggers
- [Creating a composite action (GitHub Docs)](https://docs.github.com/actions/creating-actions/creating-a-composite-action) - Composite action syntax, `shell:` requirement
- [Control concurrency of workflows (GitHub Docs)](https://docs.github.com/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs) - Concurrency group patterns
- [Node.js 24.11.0 LTS Krypton release](https://nodejs.org/en/blog/release/v24.11.0) - Node 24 LTS confirmed as Krypton, active since Oct 2025

### Secondary (MEDIUM confidence)

- [ARM64 runners GA for public repos (GitHub Changelog)](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/) - ARM64 runner availability timeline
- [ARM64 runners for private repos (GitHub Changelog)](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/) - Private repo support added Jan 2026
- [actions/setup-node releases](https://github.com/actions/setup-node/releases) - Version history, v6.2.0 is latest
- [actions/checkout releases](https://github.com/actions/checkout/releases) - Version history, v6.0.2 is latest
- [actions/setup-node README](https://github.com/actions/setup-node) - `cache: 'npm'` documentation, `node-version-file` usage

### Tertiary (LOW confidence)

- Docker availability on `ubuntu-24.04-arm` -- not confirmed from official docs; partner images (Arm, LLC) may differ from standard images

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All components verified from official sources; versions confirmed; runner specs documented
- Architecture: HIGH - Workflow patterns are well-documented; composite action syntax verified from official docs and source code
- Pitfalls: HIGH - LTS case handling verified from actual source code; other pitfalls from established patterns

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable domain; GitHub Actions and Node.js LTS change slowly)
