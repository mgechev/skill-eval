# Phase 1: CI Foundation - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

GitHub Actions CI workflow that automatically validates every PR with typecheck, build, and deterministic tests before merge. Covers requirements CI-01 (separate jobs) and CI-02 (npm caching). No evaluation pipeline (Phase 3), no LLM grading (Phase 2), no agent CLI integration (v2).

</domain>

<decisions>
## Implementation Decisions

### Workflow triggers
- Trigger on: pull_request (all branches), push to main, workflow_dispatch (manual)
- No path filtering — CI runs on every change regardless of files touched
- Cancel stale in-progress runs using concurrency groups keyed to PR number or branch ref
- Workflow named "CI", file at `.github/workflows/ci.yml`
- Permissions: `contents: read` only (GitHub auto-reports job status as checks)

### Runner & architecture
- Use `ubuntu-24.04-arm` (ARM64) for all jobs — single runner, no matrix
- If ARM runners cause unexpected issues in this or later phases, roll back to `ubuntu-latest` (x86_64)
- Node.js version read from `.node-version` file (lts/krypton = Node 24) via `actions/setup-node@v4`
- npm cache via setup-node built-in `cache: 'npm'` option
- Set `NODE_OPTIONS=--max-old-space-size=<value>` appropriate for 16GB runner (larger than default)

### Job dependency chain
- Four parallel jobs: typecheck, build, test-bootstrap, test-analytics
- No fail-fast — all jobs always run to completion, report all failures at once
- Composite action at `.github/actions/setup-node/action.yml` for Node setup + npm install
- Each job does `actions/checkout@v4` separately, then calls the composite action
- Build job verifies compilation only — no artifact upload

### Package.json scripts
- Add `typecheck` script: `tsc --noEmit`
- Add `build` script: `tsc`
- Add eval scripts (for future Phase 3 workflow, will fail until local LLM is available):
  - `eval:superlint`: `npm run eval -- superlint_demo --agent=claude --provider=local`
  - `eval:superlint:docker`: `npm run eval -- superlint_demo --agent=claude --provider=docker`
- Add validate scripts (reference solution, no agent/API keys needed):
  - `validate:superlint`: `npm run validate -- superlint_demo --provider=local`
  - `validate:superlint:docker`: `npm run validate -- superlint_demo --provider=docker`
- Eval scripts compose from base `eval`/`validate` scripts via `npm run`
- Keep existing `ts-node` direct execution for tests (no test framework)
- No combined `test` script — CI runs test:bootstrap and test:analytics as separate jobs

### Claude's Discretion
- Exact `NODE_OPTIONS=--max-old-space-size` value (must be sensible for 16GB runner, larger than Node's default)
- Job timeout value (around 20 minutes as guideline)
- Composite action internal details (shell, error handling)
- Job naming for status check display

</decisions>

<specifics>
## Specific Ideas

- Eval scripts default to `--agent=claude` (not gemini)
- Eval scripts are expected to fail in CI until Phase 2 delivers the local LLM grader — this is acceptable
- Composite action should be named "setup-node" and should NOT include checkout (checkout stays in each job)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts`: CLI entry point with `--validate`, `--provider`, `--agent` flags
- `tests/bootstrap.test.ts` and `tests/analytics.test.ts`: Existing test scripts (ts-node direct)
- `tasks/superlint_demo/`: Only task with reference solution at `solution/solve.sh`
- `.node-version`: Contains `lts/krypton` (Node 24) — single source of truth for Node version

### Established Patterns
- CommonJS module system (`"type": "commonjs"` in package.json)
- TypeScript 5.9.3 with `ts-node` for execution
- `tsconfig.json` targets ES2024, outputs to `./dist`
- Package scripts use `ts-node` directly (no test framework wrapper)

### Integration Points
- `.github/workflows/ci.yml` — new file, no existing CI
- `.github/actions/setup-node/action.yml` — new composite action
- `package.json` scripts — adding typecheck, build, eval:*, validate:* scripts
- Branch protection rules — manual setup after CI is working (not automated)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-ci-foundation*
*Context gathered: 2026-03-08*
