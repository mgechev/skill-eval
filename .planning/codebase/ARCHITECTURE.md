# Architecture

**Analysis Date:** 2026-03-08

## Pattern Overview

**Overall:** Modular evaluation pipeline with pluggable agents, environments, and graders.

**Key Characteristics:**
- Abstraction-based design around `BaseAgent` and `EnvironmentProvider` interfaces
- Separation of concerns: CLI orchestration → eval execution → grading → reporting
- Support for multiple LLM agents (Gemini, Claude) and execution environments (Docker, local)
- Task-driven configuration via TOML (task structure, graders, metadata, resource limits)

## Layers

**CLI Layer:**
- Purpose: Parse arguments, manage environment variables, coordinate task selection, handle validation flow
- Location: `src/cli.ts`
- Contains: CLI parser, environment loader, task discovery, suite loading
- Depends on: EvalRunner, providers, agents
- Used by: User executing `npm run eval`

**Orchestration Layer:**
- Purpose: Run multiple trials, parallelize execution, aggregate results, sanitize outputs
- Location: `src/evalRunner.ts`
- Contains: EvalRunner (main orchestrator), trial runner, reward calculator, session logging, secret redaction
- Depends on: Agents, providers, graders, types
- Used by: CLI, tests

**Agent Layer:**
- Purpose: Wrap LLM CLIs (Gemini, Claude) with normalized interface, handle instruction encoding
- Location: `src/agents/gemini.ts`, `src/agents/claude.ts`
- Contains: Agent implementations extending BaseAgent, base64 instruction encoding
- Depends on: BaseAgent interface, environment provider for command execution
- Used by: EvalRunner

**Environment Provider Layer:**
- Purpose: Isolate task execution (Docker container or local temp directory), manage workspace lifecycle
- Location: `src/providers/docker.ts`, `src/providers/local.ts`
- Contains: Docker provider (image build, skill injection, container management), local provider (temp dir setup)
- Depends on: Dockerode SDK, Node.js fs, types
- Used by: EvalRunner, agents (via runCommand callback)

**Grading Layer:**
- Purpose: Score agent performance deterministically or via LLM rubrics
- Location: `src/graders/index.ts`
- Contains: Grader interface, DeterministicGrader (shell scripts + optional float score), LLMGrader (Gemini/Anthropic API)
- Depends on: Fetch API, types
- Used by: EvalRunner per-trial

**Reporting & Analytics Layer:**
- Purpose: Visualize results and compute statistics
- Location: `src/reporters/cli.ts`, `src/reporters/browser.ts`, `src/analytics/engine.ts`
- Contains: CLI renderer (ANSI tables/bars), browser UI, analytics aggregator (normalized gain calculation)
- Depends on: File system, types
- Used by: `npm run preview` and `npm run analyze`

**Type System:**
- Location: `src/types.ts`
- Contains: Interfaces for all major concepts (BaseAgent, EnvironmentProvider, TaskConfig, TrialResult, EvalReport, etc.)

## Data Flow

**Evaluation Flow:**

1. **CLI Input** → Parse flags, load env files (root + task-level)
2. **Task Discovery** → Find task by name or load suite, read instruction.md and task.toml
3. **Environment Prepare** → Docker: build image, inject skills once; Local: N/A
4. **Per-Trial Execution:**
   - Environment setup (Docker: create container; Local: copy task to temp dir, inject skills)
   - Agent run: passes instruction, workspace path, runCommand callback
   - Agent executes commands via provider.runCommand()
   - Graders score the workspace state (deterministic and/or LLM rubric)
   - Session logged: instruction, commands, outputs, grader results, reward
5. **Metric Calculation** → pass_rate, pass@k, pass^k from trial rewards
6. **Sanitization** → Redact API keys from logs
7. **Persistence** → Save EvalReport JSON to `results/` directory
8. **Environment Teardown** → Docker: remove image; Local: cleanup already done per-trial

**State Management:**
- Ephemeral: Trial-by-trial workspace isolation (containers or temp dirs)
- Persistent: Session logs and eval reports saved to `results/`
- Stateless agents: No memory between trials (each trial gets fresh workspace)

## Key Abstractions

**BaseAgent:**
- Purpose: Represents an LLM agent that receives instructions and executes commands
- Examples: `src/agents/gemini.ts`, `src/agents/claude.ts`
- Pattern: Encode instruction to base64 (avoid shell escaping), invoke agent CLI with file redirection, capture stdout/stderr

**EnvironmentProvider:**
- Purpose: Abstracts workspace creation, command execution, and cleanup
- Examples: `src/providers/docker.ts` (containerized), `src/providers/local.ts` (filesystem)
- Pattern: Prepare (one-time setup), setup (per-trial), cleanup (per-trial), teardown (one-time), runCommand (execute in workspace)

**Grader:**
- Purpose: Score a completed trial
- Examples: DeterministicGrader, LLMGrader
- Pattern: Inspect workspace state + session log, return GraderResult (score 0.0–1.0, type, details)

**TaskConfig:**
- Purpose: Represent task.toml structure with metadata, resource limits, grader definitions
- Pattern: Loaded once per task, shared across trials

**EvalReport:**
- Purpose: Complete result of all trials, including metrics, grader breakdowns, session logs
- Pattern: Saved to JSON, used by reporters and analytics

## Entry Points

**CLI Entry:**
- Location: `src/cli.ts` (line 41–234)
- Triggers: `npm run eval <task> [options]`
- Responsibilities: Parse args, load env, discover tasks, run EvalRunner, display results

**Validation Entry:**
- Location: `src/cli.ts` (line 153–184)
- Triggers: `npm run eval <task> --validate`
- Responsibilities: Load reference solution, run single trial with solve.sh, verify graders pass

**Bootstrap Test:**
- Location: `tests/bootstrap.test.ts`
- Triggers: `npm run test:bootstrap`
- Responsibilities: Verify infrastructure (Docker/Local) without API keys

**Analytics Entry:**
- Location: `src/analytics/analyze.ts`
- Triggers: `npm run analyze -- --logDir=./results`
- Responsibilities: Load all reports, aggregate by task, compute normalized gain, display stats

**Preview Entries:**
- Location: `src/preview.ts`
- Triggers: `npm run preview` (CLI) or `npm run viewer` (browser)
- Responsibilities: Load reports, render CLI or web UI

## Error Handling

**Strategy:** Timeout-based failures, try-catch with diagnostics, per-trial isolation.

**Patterns:**
- Agent timeout: `withTimeout()` wraps agent.run() with configurable timeout from task.toml
- Provider errors: Caught in runSingleTrial try-catch, trial marked as reward=0 with error in session log
- Grader errors: Caught and returned as GraderResult with score=0, details=error message
- Diagnostics: Docker provider captures process list, open files, memory, disk (for debugging)
- Cleanup isolation: finally block in runSingleTrial ensures workspace cleanup even if trial fails

## Cross-Cutting Concerns

**Logging:**
- Session log: Per-trial, records agent_start, command, agent_result, grader, reward events with timestamps
- No external logger; all captured in memory then persisted as EvalReport.trials[].session_log

**Validation:**
- Task TOML: Parsed once, checked for required fields (metadata, graders, agent, environment)
- Grader config: type must be 'deterministic' or 'llm_rubric', weight must be present

**Authentication:**
- API keys: Loaded from root .env and process.env, stored in baseEnv
- Passed to provider and graders via env parameter
- Automatically redacted from persisted logs (any value >5 chars is replaced with [REDACTED])

**Skill Injection:**
- Docker: Tar-packed skill directories injected into container at prepare time
- Local: Skill directories copied to `.agents/skills/` and `.claude/skills/` per-trial
- Auto-discovery paths: `/workspace/.agents/skills` and `/workspace/.claude/skills` (Docker standard)

---

*Architecture analysis: 2026-03-08*
