# SkillsBench: Node.js Agent Skill Evaluation Framework

A TypeScript-based evaluation infrastructure for benchmarking AI agent efficiency in using modular "Skills." Based on the research paper [SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks](https://arxiv.org/html/2602.12670v1).

## 🚀 Overview

SkillsBench allows you to measure how effectively an agent leverages procedural knowledge (Skills) to solve specific technical tasks. It provides a standardized environments (Local or Docker), a unified agent harness, and automated verification logic.

### Key Concepts

- **Skills**: Modular packages (`skills/`) containing procedural guidance (`SKILL.md`) and executable resources.
- **Tasks**: Self-contained directories (`tasks/`) with instructions, environment setup (`Dockerfile`), and deterministic verifiers.
- **Agent Harnesses**: Standardized wrappers (`BaseAgent`) for interacting with different models (e.g., Claude Code, Gemini CLI).
- **Environment Providers**: Abstractions for running tasks either in isolated **Docker** containers or **Local** temporary directories.

## 📦 Project Structure

```text
.
├── core.ts             # Base interfaces and LocalProvider implementation
├── dockerProvider.ts   # Dockerode-based container management
├── evalRunner.ts       # Core evaluation orchestration loop
├── claudeAgent.ts      # Harness for Claude Code CLI
├── geminiAgent.ts      # Harness for Gemini CLI
├── tasks/              # Benchmark tasks catalog
│   └── superlint_demo/ # A demo task illustrating proprietary workflows
├── skills/             # Reusable skill modules
│   └── superlint/      # Skill for the proprietary linting demo
├── testBootstrap.ts    # Infrastructure verification script
└── tsconfig.json       # TypeScript configuration (supports direct execution)
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
1. `task.toml`: Performance limits and metadata.
2. `instruction.md`: The agent's prompt.
3. `environment/Dockerfile`: The container definition.
4. `tests/test.sh`: The verifier (must write `1` to `logs/verifier/reward.txt` on success).

## 🧠 Defining a Skill

A skill directory should include:
- `SKILL.md`: YAML frontmatter (name/description) + procedural instructions.
- Optional resources: `scripts/`, `references/`.

For guidance on writing high-quality skills, refer to the [Skills Best Practices](https://github.com/mgechev/skills-best-practices) repository.

## 🚀 Usage

### Running Evaluations

You can now run evaluations dynamically using the CLI:

```bash
# Basic evaluation (Gemini Agent, Docker Provider, 5 trials)
pnpm run eval superlint

# Custom configuration (Claude Agent, Local Provider, 3 trials)
pnpm run eval superlint --agent=claude --provider=local --trials=3

# Include associated skills
pnpm run eval superlint --with-skills
```

### Multi-Trial Logic
The framework automatically handles trial isolation. Each trial gets a fresh setup and cleanup, ensuring that state does not leak between attempts.

### Result Persistence
Reports are saved as JSON files in the format `[task]_[timestamp].json`. Each report contains the overall pass rate and detailed logs for every individual trial.

## 📊 Analytics

You can generate comparative analytics between "With Skill" and "No Skill" conditions using the built-in analysis tool. It calculates **Normalized Gain (NG)** to measure the relative improvement provided by a skill.

```bash
pnpm run analyze --logDir=./results
```

### 🔐 Secret Management (API Keys)

You can securely pass API keys and other secrets to the task environment. These are injected as environment variables but are **automatically redacted** from the persistent JSON logs.

```typescript
await runner.runEval(agent, taskPath, skills, 3, {
  ANTHROPIC_API_KEY: 'your-key-here',
  GEMINI_API_KEY: 'your-key-here'
});
```

**Output Example:**
| Task | Pass Rate (No Skill) | Pass Rate (With Skill) | Normalized Gain |
| :--- | :--- | :--- | :--- |
| superlint_demo | 20.0% | 100.0% | 1.00 |
| data_cleanup | 50.0% | 75.0% | 0.50 |


## 📈 Roadmap

- [x] **Phase 1: Bootstrap** - Local/Docker sandboxing & orchestration.
- [x] **Phase 2: Multi-Trial Runs** - Support for calculating Pass Rate and Trial isolation.
- [x] **Phase 3: Result Logging** - Persistence of structured evaluation reports.
- [x] **Phase 4: Agent Integration** - Support for commercial agent CLI harnesses:
    - [x] Robust wrappers for `claude` and `gemini-cli`.
    - [x] Secure environment injection for API keys (Redacted logs).
- [x] **Phase 5: Analytics** - Tools for calculating Normalized Gain and comparative metrics.

## 🌟 Demo Task

The project includes a realistic demo in `tasks/superlint_demo`. 
This task uses a proprietary internal tool called `superlint`. Without the corporate "Skill" provided in `skills/superlint`, a general-purpose model is unlikely to follow the specific 3-step mandatory workflow (`check` -> `fix` -> `verify`), allowing you to measure the exact **Normalized Gain** provided by the skill documentation.

## 📄 License
MIT

---
*Maintained by [@mgechev](https://github.com/mgechev). Based on research from "SkillsBench: Benchmarking How Well Agent Skills Work Across Diverse Tasks" (ArXiv:2602.12670v1).*
