---
created: 2026-03-08T22:56:01.144Z
title: Add @types/node to test file resolution path
area: testing
files:
  - tests/ollama-grader.test.ts
  - tests/local-provider.test.ts
---

## Problem

TypeScript diagnostics report "Cannot find module 'fs-extra'", "Cannot find module 'os'", "Cannot find module 'child_process'", and "Cannot find name 'process'" in `.test.ts` files like `ollama-grader.test.ts`. The test files use Node.js built-in modules (`fs-extra`, `os`, `child_process`, `process`) but the TypeScript compiler cannot resolve `@types/node` declarations for these files.

This is likely a `tsconfig.json` issue — either test files are excluded from the compilation context, or the `@types/node` package is missing or not in scope for the test file paths.

## Solution

1. Verify `@types/node` is installed as a dev dependency
2. Check `tsconfig.json` `include`/`exclude` patterns — ensure `tests/**/*.ts` is included
3. If a separate `tsconfig.test.json` is needed, create one that extends the base config and adds `tests/` to the include paths
4. Alternatively, add a triple-slash `/// <reference types="node" />` directive to test files (less preferred)
