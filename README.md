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

## Best Practices for Running Evals

Based on recommendations from [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):

**How many trials?** Agent behavior is non-deterministic. A single run tells you almost nothing.

| Goal | Recommended Trials | Metric to Use |
|---|---|---|
| Quick smoke test | 3–5 | pass@k |
| Reliable pass rate estimate | 10–25 | Pass Rate (mean reward) |
| High-confidence regression detection | 25–50 | pass^k |

- **pass@k** (≥1 success in k trials) tells you if the agent *can* solve the task. Use this for capability evals and new tasks.
- **pass^k** (all k trials succeed) tells you if the agent *reliably* solves the task. Use this for regression suites where consistency matters.
- A task with pass@5 = 100% but pass^5 = 30% indicates the agent *can* do it but is flaky — worth investigating the transcript.

**Grader design:**
- Grade *outcomes*, not *steps*. Check that the file was fixed, not that the agent ran a specific command.
- Use deterministic graders for objective criteria and LLM rubrics for qualitative assessment (workflow compliance, efficiency).
- Always validate graders with `--validate` before running real evals. If the reference solution doesn't pass, your graders are broken.

**Task quality:**
- Every task should have a reference solution (`solution/solve.sh`) that proves solvability.
- Test both positive and negative cases — a grader that always returns 1.0 is useless.
- Start with 3–5 well-designed tasks rather than 50 noisy ones.

## Security

API keys are injected via environment variables and **automatically redacted** from all persisted logs.

## License

MIT

---
*Inspired by [SkillsBench](https://arxiv.org/html/2602.12670v1) (ArXiv:2602.12670v1) and [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).*
