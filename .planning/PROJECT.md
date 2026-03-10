# Local Skill Eval

## What This Is

A local-LLM fork of [mgechev/skill-eval](https://github.com/mgechev/skill-eval) -- a TypeScript framework that benchmarks how well AI coding agents follow skills (procedural instructions). This fork replaces cloud LLM graders with Ollama-backed local inference and runs evaluations in CI via GitHub Actions.

## Core Value

Run skill evaluations entirely offline using local LLMs -- no API keys, no cloud costs, no network dependency.

## Current Milestone: v2.0 opencode + Ollama

**Goal:** Run skill evaluations using opencode CLI backed by Ollama, proving local-only agent evaluation end-to-end.

**Target features:**
- opencode CLI configured with Ollama backend for agent evaluation
- superlint_demo task completes end-to-end within 15 minutes per trial
- Works both locally and in CI (ubuntu-24.04-arm)
- Fallback: direct Ollama with tool use if opencode+Ollama proves unworkable

## Current State

Shipped v1.0 with 4,527 LOC across TypeScript, shell, and YAML.

**Tech stack:** TypeScript, Node.js 24+, Ollama (qwen2.5:3b), GitHub Actions (ubuntu-24.04-arm), Docker.

**What works:**
- LLMGrader grades agent output via local Ollama with fallback to cloud providers
- CI runs typecheck (via build), integration tests, and unit tests on every PR
- Skill eval workflow runs local and Docker evaluations in parallel on PRs
- Benchmark-validated model selection with JSON Schema structured output
- Warmup eliminates cold-start timeout waste in CI

**Known limitations:**
- Agent CLI backends (opencode, Claude Code) not yet implemented
- Ollama env var tuning requires manual configuration outside CI

## Requirements

### Validated

- Deterministic grading via shell scripts (test.sh) -- existing
- Docker-based task isolation with skill injection -- existing
- Local filesystem provider as Docker fallback -- existing
- Gemini and Claude agent integrations -- existing
- CLI evaluation runner with trial-based execution -- existing
- Results reporting (CLI tables, browser UI, analytics) -- existing
- Task structure with TOML config, instruction.md, graders -- existing
- Session logging with API key redaction -- existing
- Cross-platform support (Windows via local provider) -- existing
- GitHub Actions CI workflow with parallel jobs -- v1.0
- npm package caching across CI runs -- v1.0
- Ollama-backed LLM grader replacing cloud API calls -- v1.0
- Grader model fits on GitHub runner (16GB RAM) -- v1.0
- Each trial completes grading within 3-5 minutes -- v1.0
- Model selection configurable via task.toml grader config -- v1.0
- Existing rubric prompt files reused unchanged -- v1.0
- Robust structured JSON output parsing with fallback -- v1.0
- Temperature=0 for deterministic grading behavior -- v1.0
- Deterministic grader still scores 1.0 after Ollama integration -- v1.0
- Superlint SKILL.md has agent skill frontmatter -- v1.0
- Ollama health check before evaluation (fail fast) -- v1.0
- Model availability check (verify model is pulled) -- v1.0
- Graceful degradation when Ollama absent -- v1.0
- Ollama installation and model caching in CI -- v1.0
- Agent CLI and dependency caching in CI -- v1.0
- Separate skill-eval workflow on PRs -- v1.0
- Eval result artifacts uploaded for cross-run comparison -- v1.0

### Active

- [ ] opencode CLI configured with Ollama as LLM backend
- [ ] Ollama model identified that works with opencode for agent tasks
- [ ] superlint_demo eval completes end-to-end with opencode+Ollama (local and CI)
- [ ] Per-trial completion within 15 minutes on target hardware
- [ ] Fallback: direct Ollama with tool use if opencode path unworkable for agent CLI configuration

### Out of Scope

- Cloud LLM grading enhancements -- we're moving away from cloud, not improving it
- Claude Code agent CLI backend -- deferred until opencode path proven
- New agent CLI integrations beyond opencode and Claude Code -- focus on two first
- GPU-accelerated inference -- hardware has poor GPU support; CPU/NPU only
- Training or fine-tuning models -- we consume pre-trained models only
- Mobile or embedded deployment -- desktop development machine target
- Score normalization across models -- calibration adds complexity without clear need yet
- Multi-model grading consensus -- single model (qwen2.5:3b) proved sufficient in benchmarks
- Parallel trial execution with local LLM -- 16GB RAM cannot support concurrent model loads

## Context

**Upstream project:** [skill-eval](https://blog.mgechev.com/2026/02/26/skill-eval/) by Minko Gechev. Framework that gives concrete scores for how well an agent follows a skill, tracking scores over time. Uses Docker containers for isolation and supports deterministic + LLM rubric graders.

**LLM grader:** `LLMGrader` in `src/graders/index.ts` (441 lines) tries Ollama first (localhost:11434), falls back to Gemini API, then Anthropic API. Uses qwen2.5:3b with JSON Schema structured output, 60s timeout, 8192 context window. Returns 0.0-1.0 scores.

**Agent CLIs to support (v2):**
- **opencode** -- Solve this first. Configure with local LLM backend.
- **Claude Code** -- Solve second. Configure with local LLM backend.

**Hardware target:** Microsoft Surface Laptop 7 -- Snapdragon X Elite (ARM64), 32 GB RAM, Qualcomm Hexagon NPU. CPU-only inference via Ollama.

## Constraints

- **Hardware**: CPU/NPU inference only -- Qualcomm Adreno X1-85 GPU has poor ML support; no CUDA
- **Memory**: 16 GB usable RAM -- local LLM model must fit alongside Docker, Node.js, and agent CLI processes
- **Platform**: Windows 11 ARM64 with Git Bash -- scripts must work in this environment
- **Runtime**: Node.js 24+ with TypeScript -- must stay compatible with upstream skill-eval
- **Models**: Quantized models only (Q4/Q5) -- full-precision models won't fit in available RAM
- **Execution**: Sequential plan execution -- local LLM and agent CLIs share limited hardware resources
- **CI runners**: ubuntu-24.04-arm (4 vCPU, 16GB RAM) -- model and workflow must fit these constraints

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork skill-eval, not build from scratch | Leverage existing evaluation infrastructure (Docker isolation, grading pipeline, reporting) | Good -- inherited working Docker provider, deterministic grader, CLI runner, analytics |
| CPU/NPU models only | Hardware constraint -- poor GPU support on Snapdragon X Elite | Good -- qwen2.5:3b runs in ~12s on CPU, sufficient for grading |
| opencode before Claude Code | opencode likely has simpler local LLM configuration; build confidence first | Pending -- deferred to v2 |
| GitHub Actions CI as first phase | Establish automated validation before making behavioral changes to graders | Good -- CI caught regressions during 5 gap-closure plans in Phase 2 |
| Sequential execution | Local LLM memory pressure makes parallel execution risky on 16 GB | Good -- confirmed in benchmarks; parallel Ollama requests cause OOM |
| Ollama as provider within llm_rubric, not new grader type | Research showed new type would fork grading logic unnecessarily | Good -- clean integration with existing fallback chain |
| qwen2.5:3b as default grader model | Only model with perfect discrimination (1.0/0.0/0.0) in benchmark across both platforms | Good -- JSON Schema works reliably, ~12s local, ~6s CI with tuning |
| JSON Schema structured output | Benchmark showed 100% JSON validity across all profiles | Good -- eliminated need for regex JSON extraction fallback |
| Hardcoded Ollama params (not configurable) | Benchmark-validated; user-configurable params risk untested combinations | Good -- simplified GraderConfig, removed 2 fields |
| Composite actions for CI setup | Reusable across ci.yml and skill-eval.yml workflows | Good -- setup-node and setup-ollama used by all 5 CI jobs |

---
*Last updated: 2026-03-10 after v2.0 milestone start*
