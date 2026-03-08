---
created: "2026-03-08T22:40:18.560Z"
title: Add package.json scripts and CI workflow steps for Phase 2 tests
area: tooling
files:
  - package.json
  - .github/workflows/
  - tests/local-provider.test.ts
  - tests/ollama-grader.test.ts
---

## Problem

Phase 2 added two new test files (`tests/ollama-grader.test.ts` with 19 tests, `tests/local-provider.test.ts` with 3 tests) but only `test:ollama-grader` has a package.json script. There is no `test:local-provider` script and no CI workflow job/step to run these tests on PR.

Currently the only way to run local-provider tests is `npx ts-node tests/local-provider.test.ts`. The CI pipeline (Phase 1) doesn't include these test suites in its workflow steps.

## Solution

- Add `test:local-provider` script to package.json: `"test:local-provider": "npx ts-node tests/local-provider.test.ts"`
- Add workflow jobs/steps in `.github/workflows/` to run both `test:ollama-grader` and `test:local-provider` on PR
- Consider a unified `test:all` script that runs bootstrap + ollama-grader + local-provider + analytics
