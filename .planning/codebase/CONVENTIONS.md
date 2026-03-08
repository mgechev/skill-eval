# Coding Conventions

**Analysis Date:** 2026-03-08

## Naming Patterns

**Files:**
- PascalCase for classes: `LocalProvider.ts`, `ClaudeAgent.ts`, `DeterministicGrader.ts`
- camelCase for utility/functional modules: `cli.ts`, `evalRunner.ts`, `analyze.ts`
- Directory names are lowercase: `src/agents/`, `src/providers/`, `src/graders/`, `src/reporters/`, `src/analytics/`

**Functions:**
- camelCase for all functions: `loadTaskConfig()`, `runEval()`, `parseEnvFile()`, `withTimeout()`, `estimateTokens()`
- Prefix utility functions with descriptive verbs: `calculate*()`, `load*()`, `run*()`, `parse*()`

**Variables:**
- camelCase for local variables and constants: `taskPath`, `skillsPaths`, `numTrials`, `sessionLog`, `graderResults`
- Constants defined as `const` with meaningful names: `baseName`, `discoveryDirs`, `envPairs`
- Abbreviations used sparingly: `ms` for milliseconds, `tokens` for token counts, `cmd`/`cmds` for commands

**Types & Interfaces:**
- PascalCase for interfaces: `TaskConfig`, `EvalReport`, `TrialResult`, `CommandResult`, `GraderConfig`, `EnvironmentProvider`, `BaseAgent`
- Suffix interfaces with their category: `*Config`, `*Result`, `*Provider`, `*Agent`, `*Entry` (for log entries)
- Type parameter names are single uppercase letters: `T` for generic types

## Code Style

**Formatting:**
- No linter or formatter configured (no `.eslintrc`, `.prettierrc`, or `biome.json`)
- Code is hand-formatted with consistent indentation (4 spaces, inferred from source)
- Line length varies but generally follows reasonable column width
- Consistent use of blank lines around control flow

**Imports:**
- Node.js built-in imports first (prefixed with `*` namespace): `import * as fs from 'fs-extra'`, `import * as path from 'path'`
- Third-party imports follow: `import Docker from 'dockerode'`, `import * as toml from 'toml'`
- Local imports last with relative paths: `import { BaseAgent } from '../types'`
- Each import category separated by a blank line

**Access Modifiers:**
- Classes use `private` for internal fields: `private provider: EnvironmentProvider`, `private logDir?: string`
- Private methods are marked: `private timestamp()`, `private sanitize()`, `private callGemini()`
- Public methods default (no modifier): `async setup()`, `async cleanup()`, `async runCommand()`
- Abstract class methods: `abstract class BaseAgent { abstract run(...) }`

## Comments

**JSDoc/TSDoc:**
- Block comments for methods and exported functions: `/** Description of what this does */`
- Single-line explanatory comments in code: `// Strip surrounding quotes`, `// Check for Docker...`
- Comments above key sections: `// ─── ANSI helpers`, `// ─── Main`, `// Build image from Dockerfile`

**When to Comment:**
- Explain the "why" for non-obvious logic: token estimation heuristic, pass@k calculation, secret sanitization
- Describe algorithm purpose: `// Calculate pass@k: probability of at least 1 success in k trials`
- Document input/output expectations for complex transformations
- Minimal comments for self-documenting code (clear variable names and method names are preferred)

**Examples from codebase:**
- `src/evalRunner.ts` line 40: Documents pass@k calculation formula
- `src/evalRunner.ts` line 63: Explains token estimation heuristic
- `src/graders/index.ts` line 16: Documents what DeterministicGrader does
- `src/providers/docker.ts` line 17: Explains the prepare/setup lifecycle

## Error Handling

**Patterns:**
- Errors thrown as `new Error()` with descriptive messages: `throw new Error('Docker build failed: ...')`
- Errors caught with typed `catch (err: any)` and logged to console: `catch (err: any) { ... console.log(...) }`
- Graceful fallbacks for external services (e.g., LLM graders): if Gemini API fails, try Anthropic; if both fail, return score 0 with error details
- Promises reject explicitly: `(resolve, reject) => { ... reject(e) }`

**Console Output:**
- Use `console.log()` for standard output and progress reporting
- Use `console.error()` for errors and warnings
- CLI outputs use emoji for visual feedback: `✅`, `❌`, `🔍`, `🚀` (though some output marked with emoji may need updating for Windows compatibility)

**Async Error Context:**
- Errors in async functions caught and provide context: try/catch blocks in `runSingleTrial()` capture workspace diagnostics before cleanup
- Timeout errors include the timeout duration: `${label} timed out after ${timeoutMs / 1000}s`

## Function Design

**Size & Scope:**
- Most functions 20–60 lines; some utility functions <10 lines
- Class methods broken into smaller private helpers: `runTrialsParallel()` calls `runSingleTrial()`, `LLMGrader.grade()` delegates to `callGemini()`, `callAnthropic()`, `parseResponse()`
- Long functions use internal helper functions: `sanitize()` has an internal `redact()` closure

**Parameters:**
- Explicit parameter names over destructuring when possible: `runEval(agent, taskPath, skillsPaths, numTrials, env, parallel)`
- Record types for flexible configs: `env?: Record<string, string>`, `config: GraderConfig`
- Optional parameters marked with `?`: `_workspacePath?: string`, `logDir?: string`
- Unused parameters prefixed with underscore: `_taskPath`, `_workspace`, `_provider`

**Return Values:**
- Explicit Promise types: `Promise<TaskConfig>`, `Promise<EvalReport>`, `Promise<CommandResult>`
- Complex returns typed with interfaces: return `TrialResult`, `EvalReport`, `GraderResult`
- Sync functions rarely return; mostly operate on side effects (logging, file I/O)

## Module Design

**Exports:**
- Classes exported as named exports: `export class EvalRunner`, `export class LocalProvider`
- Utility functions exported as named exports: `export async function loadTaskConfig()`, `export function getGrader()`
- Interfaces exported for consumer use: `export interface TaskConfig`, `export interface EnvironmentProvider`
- Single default export only in `src/cli.ts` (which runs main immediately)

**Barrel Files:**
- `src/graders/index.ts` re-exports both grader classes and the factory function `getGrader()`
- No barrel files in `src/agents/` or `src/providers/` — each file imports directly

**Layering:**
- `src/types.ts` defines all core interfaces (no implementation)
- `src/providers/*` implement `EnvironmentProvider` interface
- `src/agents/*` extend `BaseAgent` abstract class
- `src/graders/index.ts` implements `Grader` interface
- `src/evalRunner.ts` orchestrates: uses agents, providers, graders

## Database & State

**No persistent database.** State is ephemeral:
- `TrialResult` and `EvalReport` constructed in memory and optionally persisted to JSON files
- Workspace state lives in temporary directories (LocalProvider: `/tmp/skill-eval-*`, DockerProvider: container ephemeral layers)
- Session logs captured as JSON arrays in memory, sanitized, then written once to disk

**File I/O:**
- `fs-extra` library used throughout for safe directory operations
- `path.join()` used consistently for cross-platform paths
- Configuration loaded from TOML files (`task.toml`) and JSON reports
- Results written with `fs.writeJSON(filePath, report, { spaces: 2 })`

## Type Safety

**TypeScript Configuration:**
- Target: ES2024
- Strict mode enabled: `"strict": true`
- `esModuleInterop` and `forceConsistentCasingInFileNames` both true
- `skipLibCheck` true to avoid type-checking node_modules

**Type Annotations:**
- All function parameters typed: `taskPath: string`, `numTrials: number`, `env?: Record<string, string>`
- Return types explicit on exported/public functions: `async function loadTaskConfig(...): Promise<TaskConfig>`
- Internal helper functions sometimes omit return types when obvious
- Generic types used rarely, only for promises: `Promise<T>`, `Record<string, string>`

## Concurrency

**Promise-based:**
- Parallel trials use `Promise.all()`: `await Promise.all(workers)` in `runTrialsParallel()`
- Worker pool pattern for concurrent trial execution
- Timeouts wrapped in promises: `withTimeout<T>(promise, timeoutMs, label)`

**No locks or queues** — trials are independent and share no mutable state beyond the task filesystem (cleaned per trial).

---

*Convention analysis: 2026-03-08*
