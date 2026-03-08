---
created: 2026-03-08T19:31:10.483Z
title: Add task bin directory to PATH in LocalProvider
area: tooling
files:
  - src/providers/local.ts:8-29
  - src/providers/local.ts:37-58
  - tasks/superlint_demo/bin/superlint
---

## Problem

The `superlint` CLI lives at `tasks/superlint_demo/bin/superlint` and is copied into the LocalProvider temp workspace during `setup()`. However, the workspace's `bin/` directory is not added to PATH, so the agent cannot run `superlint check`, `superlint fix`, or `superlint verify` — all fail with `command not found`.

Session log evidence:
```
/bin/bash: line 17: superlint: command not found
```

The `bin/` directory contains task-specific tools that the agent is instructed to use. Without PATH exposure, no task-provided CLI tools are discoverable by the agent.

## Solution

In `LocalProvider.runCommand()`, prepend the workspace's `bin/` directory to PATH before spawning the child process:
```ts
env: { ...process.env, ...env, PATH: `${workspacePath}/bin:${process.env.PATH}` }
```

Alternatively, handle this in `setup()` by symlinking or installing binaries to a known location.
