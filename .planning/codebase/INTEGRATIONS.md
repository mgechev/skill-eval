# External Integrations

**Analysis Date:** 2026-03-08

## APIs & External Services

**LLM Grading Providers:**

- **Google Gemini API** - Evaluates agent session transcripts against rubrics
  - SDK/Client: Fetch API (native, no external package)
  - Auth: `GEMINI_API_KEY` environment variable
  - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
  - Default model: `gemini-2.0-flash` (configurable via `config.model`)
  - Usage: `src/graders/index.ts` `LLMGrader.callGemini()` (lines 145–165)
  - Request: JSON POST with `{"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {}}`
  - Response: Expects JSON with `candidates[0].content.parts[0].text` containing JSON score object
  - Fallback: If GEMINI_API_KEY not present, tries Anthropic API

- **Anthropic Claude API** - Evaluates agent session transcripts against rubrics
  - SDK/Client: Fetch API (native, no external package)
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Endpoint: `https://api.anthropic.com/v1/messages`
  - Default model: `claude-sonnet-4-20250514` (configurable via `config.model`)
  - Usage: `src/graders/index.ts` `LLMGrader.callAnthropic()` (lines 167–190)
  - Headers: `Content-Type: application/json`, `x-api-key: {key}`, `anthropic-version: 2023-06-01`
  - Request: JSON POST with `{"model": model, "max_tokens": 256, "messages": [{"role": "user", "content": prompt}]}`
  - Response: Expects JSON with `content[0].text` containing JSON score object `{"score": float, "reasoning": string}`

**Agent Execution (CLI-based, not API):**

- **Gemini CLI** - Runs agent logic in task environments
  - Command: `gemini -y --sandbox=none -p "$(cat /tmp/.prompt.md)"`
  - Installation: `npm install -g @google/gemini-cli` (in Docker or locally)
  - Auth: Via Gemini user credentials or API key (external to skill-eval)
  - Used in: `src/agents/gemini.ts` (lines 4–21)
  - Role: Accepts instruction via stdin, returns stdout/stderr output
  - Not: API-based; invoked as subprocess, output captured

- **Claude Code CLI** - Runs agent logic in task environments
  - Command: `claude "$(cat /tmp/.prompt.md)" --yes --no-auto-update`
  - Installation: Must be installed separately by user (not in package.json)
  - Auth: Via Claude user session or API key (external to skill-eval)
  - Used in: `src/agents/claude.ts` (lines 4–21)
  - Role: Accepts instruction via stdin, returns stdout/stderr output
  - Not: API-based; invoked as subprocess, output captured

## Data Storage

**Databases:**
- None. Framework is stateless — no database connection.

**File Storage:**
- Local filesystem only
  - Results saved to: `results/` directory (configurable via EvalRunner constructor)
  - Report format: JSON files named `{task}_{ISO-timestamp}.json`
  - Created by: `src/evalRunner.ts` `saveReport()` (lines 332–342)
  - Sanitized: API keys redacted via `sanitize()` (lines 299–330)

**Caching:**
- Docker image caching (implicit)
  - One-time image build per task via `docker.buildImage()` (provider.prepare)
  - Reused for all trials (provider.setup creates containers from image)
  - Discarded after eval via `docker.getImage().remove()` (provider.teardown)
- No explicit cache invalidation; image names include timestamp to prevent collisions

## Authentication & Identity

**Auth Provider:**
- Custom / Environment-based
  - Gemini API: `GEMINI_API_KEY` environment variable (loaded from `.env` or process env)
  - Anthropic API: `ANTHROPIC_API_KEY` environment variable (loaded from `.env` or process env)
  - No OAuth, API gateways, or external identity service
  - Implementation: Simple fetch requests with key in URL query (Gemini) or header (Anthropic)

**Security Model:**
- API keys passed via environment variables (typical CLI pattern)
- All keys **automatically redacted** from persisted session logs before saving
- No in-memory secret management beyond process.env
- Docker containers inherit env vars via `Env: [...]` in container config (`src/providers/docker.ts` line 104)
- Local provider inherits via Node.js child_process `env` merge (`src/providers/local.ts` line 42)

## Monitoring & Observability

**Error Tracking:**
- None. Errors logged to console.error() and captured in session log

**Logs:**
- **Session logs** (per-trial, JSON, persisted)
  - Location: `results/{task}_{timestamp}.json`
  - Contents: Instruction, commands executed with output, agent result, grader results, reward, errors
  - Redaction: API keys stripped before persistence
  - Created by: `src/evalRunner.ts` `saveReport()` (lines 332–342)

- **Console output** (per-trial, stdout)
  - Trial progress: `Trial N/M ▸ {status} reward={score} ({duration}s, {commands} cmds, {tokens} tokens)`
  - LLM grader reasoning: `Trial N [llm_rubric] score={score}: {reasoning}`
  - Summary statistics: Pass rate, pass@k, pass^k, avg duration, total tokens

- **Diagnostic output** (Docker only, on failure)
  - Captured by: `src/providers/docker.ts` `diagnose()` (lines 210–243)
  - Contents: Process listing, open file descriptors, network connections, memory, disk usage
  - Logged: Only when trial fails; helps debug container issues

## CI/CD & Deployment

**Hosting:**
- None. Framework is CLI-based, runs on developer machines or CI runners.

**CI Pipeline:**
- None configured
- Could be integrated into CI/CD via `npm run eval` + log parsing
- Typical pattern: Run evals in GitHub Actions / GitLab CI with Docker support

**Execution Model:**
- Local execution via ts-node or compiled Node.js
- Docker containers orchestrated via `dockerode` for isolated environments
- Can run locally with `--provider=local` (spawns CLI commands in temp directories)

## Environment Configuration

**Required env vars:**
- `GEMINI_API_KEY` - For Gemini API grading or if agent is Gemini CLI
- `ANTHROPIC_API_KEY` - For Anthropic API grading or if agent is Claude Code
- (One or both, depending on grader/agent configuration)

**Optional env vars:**
- `DEBUG` - Not explicitly used in framework; available for task-level debugging
- Task-specific variables - Defined in `tasks/<name>/.env`

**Secrets location:**
- Project root `.env` file (git-ignored, user-created)
- Task-level `.env` files in `tasks/<name>/.env` (git-ignored per task)
- Process environment (shell variables override file-based)
- Loading order: Root `.env` → Task `.env` → Process env (later overrides earlier)

**Configuration files:**
- `task.toml` - Per-task configuration (graders, timeouts, resource limits)
  - Parsed by: `src/evalRunner.ts` `loadTaskConfig()` (lines 10–25)
  - Schema: `[metadata]`, `[agent]`, `[environment]`, `[[graders]]` sections

## Webhooks & Callbacks

**Incoming:**
- None. Framework is poll-based / sequential.

**Outgoing:**
- None. No external service callbacks.

**Event Model:**
- Agent execution as subprocess (Gemini CLI, Claude Code) with stdout/stderr capture
- LLM grader as synchronous fetch request (blocks until response)
- No async webhooks or queues

## Data Flow

**Evaluation Pipeline:**

1. **Setup Phase** - Provider creates workspace
   - Docker: `provider.prepare()` builds image, optionally injects skills, commits snapshot
   - Local: `provider.setup()` copies task to temp dir, copies skills to discovery paths

2. **Agent Execution** - LLM agent runs instruction
   - Instruction read from `{taskPath}/instruction.md`
   - Passed to agent CLI (Gemini or Claude) via temp file
   - Agent subprocess runs commands via `provider.runCommand()`
   - All commands and output logged to session log

3. **Grading Phase** - One or more graders score the result
   - Deterministic: Runs shell command, reads exit code or `logs/verifier/reward.txt`
   - LLM: Builds transcript (instruction + commands + agent output + prior graders), calls Gemini or Anthropic API
   - Scores 0.0–1.0 per grader; weighted by `config.weight`
   - Final reward = sum(score * weight) / sum(weight)

4. **Teardown Phase** - Cleanup and persistence
   - Provider cleanup: Remove container (Docker) or temp directory (local)
   - Report persistence: Session log sanitized (secrets redacted), saved to `results/{task}_{timestamp}.json`

---

*Integration audit: 2026-03-08*
