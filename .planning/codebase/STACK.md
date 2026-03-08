# Technology Stack

**Analysis Date:** 2026-03-08

## Languages

**Primary:**
- TypeScript 5.9.3 - All source code and scripts
- Shell (Bash) - Task environments and reference solutions

**Secondary:**
- JavaScript - CLI execution (Node.js CommonJS modules)
- TOML - Task configuration files

## Runtime

**Environment:**
- Node.js 24.0.0 or higher (required)
  - Location: `/package.json` engines field
  - Run via: `ts-node` for development, compiled JS for production
- Docker Desktop - Required for task execution environments
- Bash shell - Command execution and grading

**Package Manager:**
- npm 11+ (ships with Node.js 24)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- TypeScript compiler (`typescript@5.9.3`) - Language compilation
- ts-node (`ts-node@10.9.2`) - Direct TypeScript execution
- TOML parser (`toml@3.0.0`) - Task configuration parsing

**Container Management:**
- Docker SDK: `dockerode@4.0.9` - Native Docker API client for task environment orchestration
- tar-stream (`tar-stream@3.1.7`) - TAR archive creation for Docker skill injection

**Utilities:**
- fs-extra (`fs-extra@11.3.3`) - File system operations with promise support

**Testing:**
- ts-node (doubles as test runner via `npm run test:bootstrap`, `npm run test:analytics`)

**Build/Dev:**
- No build tool (tsconfig.json configured, ts-node runs code directly)
- No formatter/linter config detected (no .eslintrc, .prettierrc, biome.json)

## Key Dependencies

**Critical:**
- `dockerode@4.0.9` - Enables Docker provider for isolated task execution; container lifecycle management
- `fs-extra@11.3.3` - File system operations for task setup, workspace management, report persistence
- `toml@3.0.0` - Parses task.toml configuration files (grader setup, timeouts, environment limits)

**Infrastructure:**
- `tar-stream@3.1.7` - Archives skills directories for injection into Docker containers
- `@types/*` - TypeScript type definitions for Node.js, Docker, fs-extra, tar-stream

## Configuration

**Environment:**
- `.env` file support (parsed at `src/cli.ts` lines 14–31)
  - Root `.env` in project root loaded first
  - Task-level `.env` in `tasks/<task_name>/.env` loaded per-task (overrides root)
  - Process environment variables override file-based env (GEMINI_API_KEY, ANTHROPIC_API_KEY)
  - All env values automatically redacted from persisted logs

**Build:**
- `tsconfig.json` - Target: ES2024, module: CommonJS, strict: true
  - Includes `src/**/*.ts` and `tests/**/*.ts`
  - Output to `./dist/` (though not used in npm scripts)

**Scripts:**
- `npm run eval` → `ts-node src/cli.ts` - Main evaluation runner
- `npm run validate` → `ts-node src/cli.ts --validate` - Grader validation against reference solution
- `npm run analyze` → `ts-node src/analytics/analyze.ts` - Metrics aggregation
- `npm run preview` → `ts-node src/preview.ts` - CLI results viewer (default)
- `npm run viewer` → `ts-node src/preview.ts browser` - Web UI results viewer (localhost:3847)

## Platform Requirements

**Development:**
- Node.js 24+
- npm 11+ (included with Node.js)
- Docker Desktop (for most use cases; local provider available as fallback)
- Bash shell (Linux/macOS/WSL or Git Bash on Windows)
- Git (for version control)

**Production:**
- Docker (for isolated evaluation environments)
  - Hosts task environments: agents, skills, test suites
  - Network accessible (if running remotely)
- Node.js 24+ runtime
- Access to task directories (`tasks/*/`) with Dockerfile, instruction.md, graders

**Agent Execution:**
- Gemini CLI (`@google/gemini-cli`) - Installed via npm or Docker RUN in task environments
- Claude Code (`claude` command) - Must be installed separately on user's system for local provider
- Both agents run outside the evaluation framework; the framework invokes them via CLI

## External Services (Optional)

**LLM Grading (optional, for `llm_rubric` grader type):**
- Google Gemini API (via `generativelanguage.googleapis.com/v1beta/models/`)
  - Default model: `gemini-2.0-flash`
  - Auth: `GEMINI_API_KEY` environment variable
  - Used by: `src/graders/index.ts` `LLMGrader.callGemini()` (lines 145–165)
  - Communication: Fetch API with POST to `/v1beta/models/{model}:generateContent`

- Anthropic Claude API (via `api.anthropic.com/v1/messages`)
  - Default model: `claude-sonnet-4-20250514`
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Used by: `src/graders/index.ts` `LLMGrader.callAnthropic()` (lines 167–190)
  - Communication: Fetch API with POST, includes `x-api-key` and `anthropic-version` headers

---

*Stack analysis: 2026-03-08*
