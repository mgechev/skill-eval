# SkillsBench: Node.js Agent Skill Evaluation Framework

A TypeScript-based evaluation infrastructure for benchmarking AI agent efficiency in using modular "Skills." Based on the research paper [SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks](https://arxiv.org/html/2602.12670v1).

## 🚀 Overview

SkillsBench allows you to measure how effectively an agent leverages procedural knowledge (Skills) to solve specific technical tasks. It provides standardized environments (Local or Docker), a unified agent harness, and automated verification logic.

### Key Concepts

- **Skills**: Modular packages co-located with tasks (in `tasks/<name>/skills/`) containing procedural guidance (`SKILL.md`) and executable resources.
- **Tasks**: Self-contained directories (`tasks/`) with instructions, environment setup (`Dockerfile`), and deterministic verifiers.
- **Agent Harnesses**: Standardized wrappers (`BaseAgent`) for interacting with different models (e.g., Claude Code, Gemini CLI).
- **Environment Providers**: Abstractions for running tasks either in isolated **Docker** containers or **Local** temporary directories.

## 📦 Project Structure

```text
.
├── src/
│   ├── types.ts              # All interfaces and base classes
│   ├── evalRunner.ts         # Evaluation orchestration with timeouts and session logging
│   ├── cli.ts                # CLI entry point with auto-discovery of skills
│   ├── providers/
│   │   ├── local.ts          # Local temp-directory provider (async)
│   │   └── docker.ts         # Docker provider with resource limits and skill injection
│   ├── agents/
│   │   ├── gemini.ts         # Harness for Gemini CLI
│   │   └── claude.ts         # Harness for Claude Code CLI
│   └── analytics/
│       ├── engine.ts         # Normalized Gain calculation and aggregation
│       └── analyze.ts        # CLI entry point for analytics
├── tests/
│   ├── bootstrap.test.ts     # Infrastructure verification (Local + Docker)
│   └── analytics.test.ts     # Analytics unit tests
├── tasks/
│   └── superlint_demo/       # Demo task with co-located skills
│       ├── task.toml
│       ├── instruction.md
│       ├── app.js
│       ├── environment/Dockerfile
│       ├── tests/test.sh
│       └── skills/superlint/ # Co-located skill for this task
└── tsconfig.json
```

## 🛠️ Getting Started

### Prerequisites
- Node.js 20+
- pnpm (recommended)
- Docker (optional, but recommended for task isolation)

### Installation

```bash
# Clone the repository
git clone https://github.com/mgechev/skill-eval.git
cd skill-eval

# Install dependencies
pnpm install
```

### Running the Infrastructure Check
Verify that the Local and Docker providers are working correctly:
```bash
pnpm run test:bootstrap
```

## 📝 Defining a Task

A task directory should include:
1. `task.toml`: Performance limits, metadata, and resource constraints.
2. `instruction.md`: The agent's prompt.
3. `environment/Dockerfile`: The container definition.
4. `tests/test.sh`: The verifier (must write `1` to `logs/verifier/reward.txt` on success).
5. `skills/` (optional): Co-located skill directories auto-discovered at runtime.

### task.toml Configuration

```toml
version = "1.0"

[metadata]
author_name = "Your Name"
difficulty = "hard"
category = "workflow-compliance"
tags = ["example"]

[verifier]
timeout_sec = 60.0      # Enforced timeout for the verifier

[agent]
timeout_sec = 120.0     # Enforced timeout for the agent

[environment]
build_timeout_sec = 120.0
cpus = 1                # Applied as Docker container CPU limit
memory_mb = 1024        # Applied as Docker container memory limit
storage_mb = 500
```

## 🧠 Defining a Skill

Skills are co-located with their tasks in `tasks/<task_name>/skills/<skill_name>/`. Each skill directory should include:
- `SKILL.md`: YAML frontmatter (name/description) + procedural instructions.
- Optional resources: `scripts/`, `references/`.

Skills are **auto-discovered** at runtime — no flags needed. Use `--no-skills` to exclude them.

## 🚀 Usage

### Running Evaluations

```bash
# Basic evaluation (Gemini Agent, Docker Provider, 5 trials, skills auto-included)
pnpm run eval superlint

# Pass API keys as environment variables
GEMINI_API_KEY=your-key-here pnpm run eval superlint
ANTHROPIC_API_KEY=your-key-here pnpm run eval superlint --agent=claude

# Custom configuration
pnpm run eval superlint --agent=claude --provider=local --trials=3

# Exclude skills
pnpm run eval superlint --no-skills
```

The `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` environment variables are automatically forwarded into the agent's execution environment (Docker container or local process).

### Multi-Trial Logic
The framework automatically handles trial isolation. Each trial gets a fresh setup and cleanup, ensuring that state does not leak between attempts.

### Session Logging
Every trial captures a complete `session_log` — a timestamped array of structured entries recording:
- The instruction given to the agent
- Every command executed (with stdout, stderr, and exit code)
- The agent's return value
- Verifier execution and output
- Final reward

### Result Persistence
Reports are saved as JSON files in `results/` in the format `[task]_[timestamp].json`.

## 📊 Analytics

Generate comparative analytics between "With Skill" and "No Skill" conditions using the built-in analysis tool. It calculates **Normalized Gain (NG)** to measure the relative improvement provided by a skill.

```bash
pnpm run analyze --logDir=./results
```

### 🔐 Secret Management (API Keys)

API keys and other secrets are injected as environment variables and **automatically redacted** from persistent JSON logs (including all `session_log` entries).

**Output Example:**
| Task | Pass Rate (No Skill) | Pass Rate (With Skill) | Normalized Gain |
| :--- | :--- | :--- | :--- |
| superlint_demo | 20.0% | 100.0% | 1.00 |
| data_cleanup | 50.0% | 75.0% | 0.50 |


## 📈 Roadmap

- [x] **Phase 1: Bootstrap** - Local/Docker sandboxing & orchestration.
- [x] **Phase 2: Multi-Trial Runs** - Support for calculating Pass Rate and Trial isolation.
- [x] **Phase 3: Result Logging** - Persistence of structured evaluation reports with session logs.
- [x] **Phase 4: Agent Integration** - Support for commercial agent CLI harnesses:
    - [x] Robust wrappers for `claude` and `gemini`.
    - [x] Secure environment injection for API keys (Redacted logs).
- [x] **Phase 5: Analytics** - Tools for calculating Normalized Gain and comparative metrics.
- [x] **Phase 6: Ergonomics** - Co-located skills, auto-discovery, timeout enforcement, resource limits.

## 🌟 Demo Task

The project includes a realistic demo in `tasks/superlint_demo`.
This task uses a proprietary internal tool called `superlint`. Without the co-located skill in `tasks/superlint_demo/skills/superlint/`, a general-purpose model is unlikely to follow the specific 3-step mandatory workflow (`check` -> `fix` -> `verify`), allowing you to measure the exact **Normalized Gain** provided by the skill documentation.

## 📄 License
MIT

---
*Maintained by [@mgechev](https://github.com/mgechev). Based on research from "SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks" (ArXiv:2602.12670v1).*
