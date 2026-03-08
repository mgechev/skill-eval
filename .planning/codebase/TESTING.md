# Testing Patterns

**Analysis Date:** 2026-03-08

## Test Framework

**Runner:**
- ts-node (no dedicated test framework like Jest or Vitest)
- Tests run directly as Node.js scripts via ts-node
- Configuration: `tsconfig.json` includes `tests/**/*.ts`

**Run Commands:**
```bash
npm run test:bootstrap    # Run bootstrap integration tests
npm run test:analytics    # Run analytics logic tests
ts-node tests/bootstrap.test.ts   # Direct execution
```

**Assertion Library:**
- None. Uses manual assertions and explicit success/failure logic
- Manual validation: `if (condition) console.log('SUCCESS')` or `process.exit(1)` on failure

## Test File Organization

**Location:**
- Co-located in `tests/` directory parallel to `src/`
- Pattern: `tests/<test-name>.test.ts`
- Actual test files: `tests/bootstrap.test.ts`, `tests/analytics.test.ts`

**Naming:**
- Suffixed with `.test.ts` (not `.spec.ts`)
- Descriptive names: `bootstrap.test.ts` for end-to-end validation, `analytics.test.ts` for logic validation

**Structure:**
```
tests/
├── bootstrap.test.ts     # Integration tests: single trial, multi-trial, persistence, Docker, secrets
└── analytics.test.ts     # Unit tests: NG calculation, aggregation
```

## Test Structure

**Bootstrap Test Pattern:**
```typescript
async function runTest(useDocker: boolean, numTrials: number = 1, logDir?: string) {
    console.log(`\n--- Testing with ${useDocker ? 'Docker' : 'Local'} Provider ...`);

    // Setup
    const provider = useDocker ? new DockerProvider() : new LocalProvider();
    const runner = new EvalRunner(provider, logDir);

    // Create agent
    const solvingAgent = { async run(instruction, workspace, runCommand) { ... } } as BaseAgent;

    // Execute
    const report = await runner.runEval(solvingAgent, taskPath, [], numTrials);

    // Assertions - explicit checks
    if (firstLog.length === 0) {
        console.log('FAILURE: session_log is empty!');
        process.exit(1);
    }
    console.log(`Session log entries: ${firstLog.length}`);

    // Report result
    console.log(`\nSUCCESS: ...`);
}

async function main() {
    try {
        // Test 1
        await runTest(false, 1);
        // Test 2
        await runTest(false, 3);
        // Test N
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    } finally {
        // Cleanup
    }
}

main();
```

**Analytics Test Pattern:**
```typescript
async function testAnalytics() {
    // Test cases as data objects
    const testCases = [
        { input: X, expected: Y },
        { input: A, expected: B },
    ];

    // Loop and validate
    for (const tc of testCases) {
        const result = functionUnderTest(tc.input);
        if (Math.abs(result - tc.expected) < 0.001) {
            console.log(`SUCCESS: ...`);
        } else {
            console.error(`FAILURE: ...`);
            process.exit(1);
        }
    }

    // Functional validation
    const engine = new AnalyticsEngine();
    const stats = engine.aggregate(mockReports);

    if (stats.find(s => s.task === 'task1')?.normalizedGain === 1.0) {
        console.log('SUCCESS: Aggregation verified!');
    } else {
        console.error('FAILURE: Aggregation results incorrect');
        process.exit(1);
    }
}

testAnalytics();
```

## Test Agent Mocking

**Simple Mock Agents:**
```typescript
const solvingAgent = {
    async run(instruction: string, workspace: string, runCommand: any) {
        console.log('Solving task...');
        await runCommand('command1');
        await runCommand('command2');
        return 'Solved';
    }
} as BaseAgent;
```

**Pattern:** Inline anonymous objects typed as `BaseAgent`. No mock library used.

**What's Mocked:**
- Agent implementations (test agents that execute hardcoded command sequences)
- Test data: mock `EvalReport` arrays in analytics tests with preset pass rates

**What's NOT Mocked:**
- File system (uses real temp directories and test directories)
- Process execution (real `spawn()` calls through LocalProvider)
- Docker (if available, tests use real Docker; test skips gracefully if unavailable)
- Environment providers (tests instantiate real `LocalProvider` and `DockerProvider`)

## Test Coverage

**Coverage Target:**
- Not enforced; no coverage configuration found
- Testing focuses on integration (full end-to-end pipeline) rather than unit coverage

**View Coverage:**
- No built-in coverage view
- Tests are manual/integration focused

## Test Types

**Integration Tests (bootstrap.test.ts):**
- **Scope:** Full eval pipeline from setup through report persistence
- **Approach:**
  - Test 1: Local provider, single trial
  - Test 2: Local provider, multi-trial (N=3)
  - Test 3: Local provider with log persistence (file output)
  - Test 4: Docker provider (skips if Docker unavailable)
  - Test 5: Secret injection and sanitization (verifies logs are redacted)
- **Execution:** Real task workspace, real grader invocation, real report generation
- **Verification:** Checks structure (session_log populated, grader_results present), metrics (duration > 0, n_commands > 0), rewards (pass_rate >= 0.5), and file persistence

**Unit Tests (analytics.test.ts):**
- **Scope:** Analytics logic (NG calculation, report aggregation)
- **Approach:**
  - Test NG function with 4 test cases (return values checked with 0.001 tolerance)
  - Test aggregation with mock report data (verifies NG is computed correctly across task groups)
- **Execution:** Pure function calls; no I/O
- **Verification:** Return values match expected calculations

**E2E Tests:**
- Not explicitly separated; integration tests serve as E2E (exercise the full system)

## Test Data & Fixtures

**Test Task:**
- Uses `tasks/superlint_demo/` as the standard test task
- Real task directory with `task.toml`, `instruction.md`, test graders, and skills

**Mock Data:**
```typescript
// From analytics.test.ts
const mockReports: EvalReport[] = [
    { task: 'task1', pass_rate: 0.5, pass_at_k: 0.5, pass_pow_k: 0.5, trials: [], skills_used: [] },
    { task: 'task1', pass_rate: 1.0, pass_at_k: 1.0, pass_pow_k: 1.0, trials: [], skills_used: ['skill1'] },
    { task: 'task2', pass_rate: 0.0, pass_at_k: 0.0, pass_pow_k: 0.0, trials: [], skills_used: [] },
    { task: 'task2', pass_rate: 0.5, pass_at_k: 0.5, pass_pow_k: 0.5, trials: [], skills_used: ['skill1'] },
];
```

**Fixtures Location:**
- Test agents defined inline in test files (no factory or fixture files)
- Test data embedded directly in test functions
- Temporary directories created in test runtime: `path.join(__dirname, '..', 'test_logs')`, `path.join(__dirname, '..', 'secret_logs')`

## Test Patterns

**Async Testing:**
```typescript
async function main() {
    try {
        const report = await runner.runEval(agent, taskPath, [], numTrials);

        if (report.pass_rate < 0.5) {
            console.log('FAILURE: ...');
            process.exit(1);
        }
    } catch (e) {
        console.error('Test failed:', e);
        process.exit(1);
    }
}
```

**Cleanup Pattern:**
```typescript
finally {
    if (fs.existsSync(testLogDir)) await fs.remove(testLogDir);
    if (fs.existsSync(secretLogDir)) await fs.remove(secretLogDir);
}
```

## Environment & Dependencies

**Environment Variables:**
- Tests that require external APIs (Gemini, Anthropic) can use `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` from process.env
- Bootstrap test skips Docker test gracefully if Docker is unavailable: `try { execSync('docker ps', { stdio: 'ignore' }); } catch (e) { console.warn('Docker not available...'); }`

**Test Utilities:**
- Standard Node.js: `child_process.execSync`, `fs-extra`, `path`
- No test utilities library

## Running Tests Locally

**Bootstrap Test (with verbose output):**
```bash
npm run test:bootstrap
# Outputs detailed progress:
# - Loaded config, setup provider
# - Ran trials with timing and reward
# - Validated session log, grader results, metrics
# - Checked file persistence
```

**Analytics Test:**
```bash
npm run test:analytics
# Outputs NG calculations and aggregation results
# SUCCESS/FAILURE per test case
```

**Exit Codes:**
- Exit 0 on all tests passing
- Exit 1 on any failure (via `process.exit(1)`)

## Known Test Gaps

**Not Tested:**
- Individual grader implementations in isolation (deterministic and LLM graders tested only via integration)
- Error paths for malformed task configs
- Network failures in LLM graders (timeout, 5xx responses)
- Cross-platform Windows path handling (tests likely run on Unix-like systems in CI)
- Large-scale stress tests (many trials, many tasks in suite)

**Why:**
- Focus is on end-to-end validation that the system works, not granular unit coverage
- External APIs (Gemini, Anthropic) are integration points; mocking them would defeat the purpose
- Task validation delegated to per-task graders and reference solutions

---

*Testing analysis: 2026-03-08*
