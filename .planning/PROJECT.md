# Local Skill Eval

## What This Is

A local-LLM fork of [mgechev/skill-eval](https://github.com/mgechev/skill-eval) — a TypeScript framework that benchmarks how well AI coding agents follow skills (procedural instructions). This fork replaces cloud LLM graders with local LLMs and adds support for running local LLMs as backends for agent CLIs (opencode, Claude Code).

## Core Value

Run skill evaluations entirely offline using local LLMs — no API keys, no cloud costs, no network dependency.

## Requirements

### Validated

- [x] Deterministic grading via shell scripts (test.sh) — existing
- [x] Docker-based task isolation with skill injection — existing
- [x] Local filesystem provider as Docker fallback — existing
- [x] Gemini and Claude agent integrations — existing
- [x] CLI evaluation runner with trial-based execution — existing
- [x] Results reporting (CLI tables, browser UI, analytics) — existing
- [x] Task structure with TOML config, instruction.md, graders — existing
- [x] Session logging with API key redaction — existing
- [x] Cross-platform support (Windows via local provider) — existing

### Active

- [ ] GitHub Actions CI/CD workflow
- [ ] Local LLM grader replacing cloud LLM rubric grader
- [ ] Local LLM backend for opencode agent CLI
- [ ] Local LLM backend for Claude Code agent CLI
- [ ] `ollama launch [opencode|claude]` command matching for agent CLI configuration

### Out of Scope

- Cloud LLM grading enhancements — we're moving away from cloud, not improving it
- New agent CLI integrations beyond opencode and Claude Code — focus on two first
- GPU-accelerated inference — hardware has poor GPU support; CPU/NPU only
- Training or fine-tuning models — we consume pre-trained models only
- Mobile or embedded deployment — desktop development machine target

## Context

**Upstream project:** [skill-eval](https://blog.mgechev.com/2026/02/26/skill-eval/) by Minko Gechev. Framework that gives concrete scores for how well an agent follows a skill, tracking scores over time. Uses Docker containers for isolation and supports deterministic + LLM rubric graders.

**Current LLM grader:** The existing `LLMGrader` in `src/graders/index.ts` calls Gemini API (`generativelanguage.googleapis.com`) or Anthropic API (`api.anthropic.com`) to evaluate agent output against rubric prompts. Returns 0.0-1.0 scores.

**Local LLM candidates:**
- **ollama** — Local model server with REST API, model management, broad model library
- **@huggingface/transformers** — In-process inference via ONNX/WebAssembly, no server needed
- **@huggingface/inference** — Client for Hugging Face Inference API (can target local endpoints)

**Agent CLIs to support:**
- **opencode** — Solve this first. Configure with local LLM backend.
- **Claude Code** — Solve second. Configure with local LLM backend.

**Reference pattern:** `ollama launch [opencode|claude]` — match how this command sets up agent CLI options and environment variables for local LLM connectivity.

**Hardware target:** Microsoft Surface Laptop 7 — Snapdragon X Elite (ARM64), 32 GB RAM (16 GB usable), Qualcomm Hexagon NPU. Must use CPU-heavy or NPU-native models exclusively.

## Constraints

- **Hardware**: CPU/NPU inference only — Qualcomm Adreno X1-85 GPU has poor ML support; no CUDA
- **Memory**: 16 GB usable RAM — local LLM model must fit alongside Docker, Node.js, and agent CLI processes
- **Platform**: Windows 11 ARM64 with Git Bash — scripts must work in this environment
- **Runtime**: Node.js 24+ with TypeScript — must stay compatible with upstream skill-eval
- **Models**: Quantized models only (Q4/Q5) — full-precision models won't fit in available RAM
- **Execution**: Sequential plan execution — local LLM and agent CLIs share limited hardware resources

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork skill-eval, not build from scratch | Leverage existing evaluation infrastructure (Docker isolation, grading pipeline, reporting) | -- Pending |
| CPU/NPU models only | Hardware constraint — poor GPU support on Snapdragon X Elite | -- Pending |
| opencode before Claude Code | opencode likely has simpler local LLM configuration; build confidence first | -- Pending |
| GitHub Actions CI as first phase | Establish automated validation before making behavioral changes to graders | -- Pending |
| Sequential execution | Local LLM memory pressure makes parallel execution risky on 16 GB | -- Pending |

---
*Last updated: 2026-03-08 after initialization*
