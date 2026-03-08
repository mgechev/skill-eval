# Codebase Structure

**Analysis Date:** 2026-03-08

## Directory Layout

```
/d/projects/github/LayZeeDK/local-skill-eval/
├── src/                    # Main source code (TypeScript)
│   ├── cli.ts              # Entry point: argument parsing, environment loading, task orchestration
│   ├── types.ts            # Core interfaces and abstract classes
│   ├── evalRunner.ts       # Trial execution orchestrator, reward calculation, report serialization
│   ├── agents/             # LLM agent implementations
│   │   ├── gemini.ts       # Gemini CLI wrapper
│   │   └── claude.ts       # Claude CLI wrapper
│   ├── providers/          # Environment isolation implementations
│   │   ├── docker.ts       # Docker-based execution (image build, container management)
│   │   └── local.ts        # Local filesystem-based execution (temp directory)
│   ├── graders/            # Evaluation logic
│   │   └── index.ts        # DeterministicGrader and LLMGrader implementations
│   ├── reporters/          # Result visualization
│   │   ├── cli.ts          # Terminal UI with ANSI colors and bars
│   │   └── browser.ts      # Web server serving JSON-based dashboard
│   ├── analytics/          # Statistics and aggregation
│   │   ├── analyze.ts      # CLI script for post-evaluation analytics
│   │   └── engine.ts       # AnalyticsEngine: normalized gain calculation
│   ├── preview.ts          # Router: selects CLI or browser preview
│   └── viewer.ts           # Unused viewer entry point
│
├── tasks/                  # Task definitions (user-provided)
│   └── superlint_demo/     # Example task
│       ├── task.toml       # Task config: metadata, graders, resource limits
│       ├── instruction.md  # Agent prompt (task description)
│       ├── .env            # Optional task-level environment variables
│       ├── environment/
│       │   └── Dockerfile  # Container image setup for execution
│       ├── solution/
│       │   └── solve.sh    # Reference solution (for --validate)
│       ├── tests/
│       │   └── test.sh     # Deterministic grader script
│       ├── prompts/
│       │   └── quality.md  # LLM rubric for evaluation
│       ├── skills/
│       │   └── superlint/  # Co-located skill auto-discovered by agents
│       │       └── SKILL.md
│       ├── bin/            # Task-specific binaries (e.g., superlint CLI)
│       │   └── superlint
│       ├── app.js          # Task-specific source files
│       └── [other task files]
│
├── suites/                 # Task suite definitions (groups of tasks)
│   └── [suite].toml        # TOML file listing tasks to run as a suite
│
├── tests/                  # Test suite (TypeScript)
│   ├── bootstrap.test.ts   # Infrastructure verification (Docker/Local without API keys)
│   └── analytics.test.ts   # Analytics engine testing
│
├── results/                # Generated evaluation reports (JSON)
│   └── [task]_[timestamp].json  # EvalReport files
│
├── assets/                 # Static assets
│   └── cli-preview.png     # Screenshot for README
│
├── .planning/              # GSD planning artifacts
│
├── package.json            # Node.js dependencies and scripts
├── tsconfig.json           # TypeScript compiler config
├── .node-version           # Node.js version (24+)
└── README.md               # Project documentation
```

## Directory Purposes

**`src/`:**
- Purpose: All executable TypeScript source code
- Contains: CLI, eval engine, agents, providers, graders, reporters, types
- Key files: `cli.ts` (entry), `types.ts` (contracts), `evalRunner.ts` (orchestrator)

**`src/agents/`:**
- Purpose: Agent implementations wrapping external LLM CLIs
- Contains: Gemini and Claude agent classes
- Pattern: Each extends BaseAgent, encodes instruction to base64, invokes CLI via runCommand

**`src/providers/`:**
- Purpose: Execution environment isolation strategies
- Contains: Docker and local providers
- Pattern: Each implements EnvironmentProvider interface with prepare, setup, cleanup, teardown, runCommand

**`src/graders/`:**
- Purpose: Trial evaluation and scoring logic
- Contains: DeterministicGrader (shell script exit code or float reward file), LLMGrader (Gemini/Anthropic API)
- Pattern: Both implement Grader interface, return GraderResult with score (0.0–1.0)

**`src/reporters/`:**
- Purpose: Visualize evaluation results
- Contains: CLI renderer (ANSI tables/progress bars), browser UI
- Pattern: Load JSON reports, render with formatting/styling

**`src/analytics/`:**
- Purpose: Post-evaluation aggregation and metrics
- Contains: Report loader, analytics engine (normalized gain calculation)
- Pattern: Load all reports from results/, group by task, compute statistics

**`tasks/`:**
- Purpose: User-provided task definitions
- Contains: One subdirectory per task (e.g., `superlint_demo`)
- Pattern: Each task has task.toml (config), instruction.md (prompt), graders (tests/ and prompts/), skills/

**`suites/`:**
- Purpose: Define groups of tasks to run together
- Contains: TOML files (e.g., `workflow.toml`)
- Pattern: Each file lists task names under a `[tasks]` array

**`tests/`:**
- Purpose: TypeScript test suite for infrastructure verification
- Contains: Bootstrap test (no API key required), analytics test
- Pattern: Run with `npm run test:bootstrap` and `npm run test:analytics`

**`results/`:**
- Purpose: Persisted evaluation reports
- Contains: JSON files named `[task]_[ISO-timestamp].json`
- Pattern: Auto-created by EvalRunner.saveReport(), loaded by preview and analytics

## Key File Locations

**Entry Points:**
- `src/cli.ts`: Main CLI (`npm run eval`)
- `tests/bootstrap.test.ts`: Infrastructure test (`npm run test:bootstrap`)
- `src/analytics/analyze.ts`: Analytics script (`npm run analyze`)
- `src/preview.ts`: Result viewer router (`npm run preview` or `npm run viewer`)

**Configuration:**
- `package.json`: Node.js dependencies and npm scripts
- `tsconfig.json`: TypeScript compiler options (target: ES2024, strict mode)
- `.node-version`: Node.js 24+ requirement
- `.gitignore`: Standard Node.js/TypeScript exclusions

**Core Logic:**
- `src/types.ts`: All interface and abstract class definitions
- `src/evalRunner.ts`: Trial execution, reward calculation, metrics aggregation
- `src/graders/index.ts`: Deterministic and LLM grading logic

**Task Definition Pattern:**
- `tasks/[name]/task.toml`: Task metadata and grader config
- `tasks/[name]/instruction.md`: Agent instruction (prompt)
- `tasks/[name]/environment/Dockerfile`: Execution environment
- `tasks/[name]/solution/solve.sh`: Reference solution
- `tasks/[name]/tests/test.sh`: Deterministic grader script
- `tasks/[name]/prompts/quality.md`: LLM rubric
- `tasks/[name]/skills/[skill-name]/SKILL.md`: Auto-discovered skill

**Testing:**
- `tasks/superlint_demo/`: Example task used by bootstrap test
- `tests/bootstrap.test.ts`: Exercises both Docker and Local providers

## Naming Conventions

**Files:**
- TypeScript source: `camelCase.ts` (e.g., `evalRunner.ts`, `cli.ts`)
- TOML config: `lowercase.toml` (e.g., `task.toml`, `workflow.toml`)
- Markdown docs: `UPPERCASE.md` in task dirs (e.g., `instruction.md`, `SKILL.md`)
- Generated reports: `[task]_[timestamp].json` (e.g., `superlint_demo_2026-03-08T14-30-45-123Z.json`)

**Directories:**
- Source: `lowercase/` (e.g., `src/`, `agents/`, `providers/`)
- Task names: `snake_case/` (e.g., `superlint_demo`)
- Generated: `lowercase/` (e.g., `results/`)

**Classes & Interfaces:**
- Interface: `PascalCase` with I-prefix optional (e.g., `BaseAgent`, `EnvironmentProvider`, `TaskConfig`)
- Class: `PascalCase` with suffix for purpose (e.g., `DeterministicGrader`, `LocalProvider`, `EvalRunner`)
- Abstract class: `BaseXxx` pattern (e.g., `BaseAgent`)

**Functions & Methods:**
- camelCase (e.g., `runEval()`, `loadTaskConfig()`, `estimateTokens()`)
- Helpers: camelCase with underscore prefix if private-scoped (e.g., `withTimeout()`)

## Where to Add New Code

**New Agent (e.g., LocalLLMAgent):**
- Primary code: `src/agents/new-agent.ts` (extends BaseAgent, implements run())
- Pattern: Encode instruction to file, invoke CLI, return stdout + stderr
- Register: Add to CLI agent type selection in `src/cli.ts` (line 59)

**New Provider (e.g., KubernetesProvider):**
- Primary code: `src/providers/kubernetes.ts` (implements EnvironmentProvider)
- Pattern: Implement all methods (prepare, setup, cleanup, teardown, runCommand)
- Register: Add to CLI provider type selection in `src/cli.ts` (line 68)

**New Grader Type (e.g., custom_llm_grader):**
- Primary code: `src/graders/index.ts` (new class implementing Grader)
- Register: Add case in getGrader() function (line 214)

**New Task:**
- Create: `tasks/[new-task-name]/` directory
- Add files: `task.toml`, `instruction.md`, `environment/Dockerfile`, `solution/solve.sh`, `tests/test.sh`, `prompts/quality.md`
- Optional: `skills/[skill-name]/SKILL.md` for agent skill injection

**New Reporter/Analytics:**
- Primary code: `src/reporters/new-reporter.ts` or `src/analytics/new-engine.ts`
- Pattern: Load EvalReport[] from results/ directory, transform and display
- Entry point: Add to `src/preview.ts` or create new npm script in package.json

**Shared Utilities:**
- Utilities: `src/utils/` directory (if needed; currently utilities are inline)
- Pattern: Keep utility functions close to usage to avoid over-abstraction

## Special Directories

**`results/`:**
- Purpose: Store evaluation reports from trial runs
- Generated: Yes (auto-created by EvalRunner)
- Committed: No (in .gitignore)
- Cleanup: Manual or as part of CI/CD cleanup

**`.planning/`:**
- Purpose: GSD codebase mapping and plan artifacts
- Generated: Yes (by /gsd commands)
- Committed: Yes (tracks planning history)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes (by npm install)
- Committed: No (in .gitignore)

**`.env`:**
- Purpose: Root-level environment variables (API keys, secrets)
- Generated: Manual (user-created)
- Committed: No (in .gitignore)
- Loading: Parsed in cli.ts, passed to provider and graders

**`tasks/[name]/.env`:**
- Purpose: Task-level environment variable overrides
- Generated: Manual (task author)
- Committed: Yes
- Loading: Merged with root .env in cli.ts (task .env overrides root)

## Folder Organization Summary

| Directory | Type | Committed | Purpose |
|-----------|------|-----------|---------|
| `src/` | Source | Yes | All executable TypeScript code |
| `tasks/` | Config | Yes | User-provided task definitions |
| `suites/` | Config | Yes | Task groupings |
| `tests/` | Source | Yes | Test suite |
| `results/` | Generated | No | Evaluation report JSONs |
| `node_modules/` | Generated | No | npm dependencies |
| `assets/` | Static | Yes | Images, documentation assets |
| `.planning/` | Generated | Yes | GSD planning artifacts |

---

*Structure analysis: 2026-03-08*
