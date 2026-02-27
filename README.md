# Skill Eval

A TypeScript evaluation framework for benchmarking how effectively AI agents use modular skills. Inspired by [SkillsBench](https://arxiv.org/html/2602.12670v1) and [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## Getting Started

**Prerequisites**: Node.js 20+, pnpm, Docker

```bash
pnpm install
```

Run your first eval (requires a [Gemini API key](https://aistudio.google.com/apikey)):

```bash
GEMINI_API_KEY=your-key pnpm run eval superlint
```

Verify infrastructure without an API key:

```bash
pnpm run test:bootstrap
```

## Core Concepts

- **Tasks** — Self-contained directories in `tasks/` with an instruction, Dockerfile, and graders.
- **Skills** — Co-located in `tasks/<name>/skills/`, auto-injected into `.agents/skills/` (Gemini) and `.claude/skills/` (Claude) for native discovery. See [Skills Best Practices](http://github.com/mgechev/skills-best-practices) for authoring guidelines.
- **Graders** — Multiple graders per task: deterministic (shell scripts) and LLM rubrics, with weighted partial credit.
- **Agents** — Gemini CLI and Claude Code harnesses, running in Docker or locally.

## CLI Reference

```bash
# Basic eval (Gemini, Docker, 5 trials, skills auto-included)
GEMINI_API_KEY=key pnpm run eval superlint

# Claude agent
ANTHROPIC_API_KEY=key pnpm run eval superlint --agent=claude

# Options
pnpm run eval superlint --provider=local --trials=3
pnpm run eval superlint --no-skills
pnpm run eval superlint --parallel=3

# Validate graders with the reference solution
pnpm run eval superlint --validate --provider=local

# Run a suite of tasks
pnpm run eval _ --suite=workflow

# Analytics (Normalized Gain)
pnpm run analyze --logDir=./results

# Transcript viewer
pnpm run viewer                    # → http://localhost:3847
```

## Task Structure

```
tasks/superlint_demo/
├── task.toml              # Config: graders, timeouts, resource limits
├── instruction.md         # Agent prompt
├── environment/Dockerfile # Container setup
├── solution/solve.sh      # Reference solution (for --validate)
├── tests/test.sh          # Deterministic grader
├── prompts/quality.md     # LLM rubric
└── skills/superlint/      # Auto-discovered skill
    └── SKILL.md
```

### task.toml

```toml
version = "1.0"

[metadata]
author_name = "Your Name"
difficulty = "hard"
category = "workflow-compliance"
tags = ["example"]

[agent]
timeout_sec = 120.0

[environment]
build_timeout_sec = 120.0
cpus = 1
memory_mb = 1024
storage_mb = 500

[[graders]]
type = "deterministic"
command = "bash tests/test.sh"
weight = 0.7

[[graders]]
type = "llm_rubric"
rubric = "prompts/quality.md"
weight = 0.3
```

## Metrics

| Metric | Description |
|---|---|
| **Pass Rate** | Average reward (0.0–1.0) across trials |
| **pass@k** | Probability of ≥1 success in k trials |
| **pass^k** | Probability of all k trials succeeding |
| **Normalized Gain** | Relative improvement from skills: `(with - without) / (1 - without)` |
| **Duration / Commands** | Per-trial timing and command count |

## Security

API keys are injected via environment variables and **automatically redacted** from all persisted logs.

## License

MIT

---
*Inspired by [SkillsBench](https://arxiv.org/html/2602.12670v1) (ArXiv:2602.12670v1) and [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).*
