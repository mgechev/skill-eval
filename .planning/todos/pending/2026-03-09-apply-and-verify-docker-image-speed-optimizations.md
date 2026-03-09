---
created: 2026-03-09T00:57:38.883Z
title: Apply and verify Docker image speed optimizations
area: providers
files:
  - src/providers/docker.ts
  - tasks/superlint_demo/environment/Dockerfile
---

## Problem

Docker image creation in `DockerProvider.prepare()` is slow, especially on Windows ARM64 where x86_64 containers run under QEMU emulation. The image name includes a timestamp (`skill-eval-{taskname}-{timestamp}`), forcing a full rebuild every run even when nothing changed. The `RUN npm install -g @google/gemini-cli` layer is the heaviest step and re-executes each time.

On Snapdragon X Elite (ARM64), Docker Desktop runs amd64 containers via QEMU at ~2-5x slower than native. The `node:24-slim` base image may be pulling the amd64 variant.

## Solution

Three optimizations identified during Phase 02 UAT:

1. **Stable image naming** -- Replace timestamp in image name with a content hash (hash of Dockerfile + task directory contents). If nothing changed, skip `docker.buildImage()` entirely and reuse the existing image. Check via `docker.getImage(name).inspect()`.

2. **ARM64 native containers** -- Ensure `docker buildx` targets `linux/arm64` platform so builds and execution skip QEMU emulation. Verify `node:24-slim` resolves to the arm64 variant.

3. **Pre-pull/cache base image** -- Document or automate `docker pull --platform linux/arm64 node:24-slim` so builds don't re-download layers. Consider a `.dockerignore` to reduce build context transfer time.

Additional: Consider splitting the Dockerfile so the `npm install -g` layer is cached independently from workspace file copies (move COPY after RUN).
