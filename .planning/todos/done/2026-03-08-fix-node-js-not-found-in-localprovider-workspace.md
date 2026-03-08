---
created: 2026-03-08T19:31:10.483Z
title: Fix Node.js not found in LocalProvider workspace
area: tooling
files:
  - src/providers/local.ts:37-58
  - src/agents/claude.ts:13
---

## Problem

When running evals with `--provider=local`, the Claude agent fails with `exec: node: not found` (exit code 127). The `claude` CLI shim at `/mnt/c/Users/LarsGyrupBrinkNielse/.local/bin/claude` requires Node.js, but the LocalProvider's `runCommand` spawns a bash shell that doesn't inherit the full PATH — Node.js is missing from the subprocess environment.

Session log evidence:
```
/mnt/c/Users/LarsGyrupBrinkNielse/.local/bin/claude: 15: exec: node: not found
```

This affects all agent types that depend on Node.js being available (ClaudeAgent wraps the `claude` CLI which is a Node.js script).

## Solution

Ensure `process.env.PATH` is forwarded to the spawned shell in `LocalProvider.runCommand()`. Currently `env` is spread from `process.env` but the bash subprocess may not resolve Node.js if its PATH doesn't include the FNM-managed Node.js binary location. Verify the PATH in the spawned shell matches the parent process.
