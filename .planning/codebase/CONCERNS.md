# Codebase Concerns

**Analysis Date:** 2026-03-08

## Tech Debt

### Race Condition in Parallel Trial Execution

**Issue:** The parallel trial queue uses non-atomic `queue.shift()` without synchronization primitives.

**Files:** `src/evalRunner.ts` (lines 149-154)

**Impact:** Under high-concurrency scenarios (many workers, many trials), multiple workers could theoretically read the same trial index, causing duplicate executions or silent skips. This is a subtle bug that only manifests with specific timing. While JavaScript's event loop provides some protection, the code doesn't explicitly protect against this.

**Fix approach:**
- Replace the simple array queue with a proper async queue (e.g., `p-queue` or similar)
- OR use a Mutex/Lock pattern with `async-lock` to protect `queue.shift()` calls
- Add unit tests that stress-test parallel execution with 10+ workers and 100+ trials to catch race conditions


### Base64 Encoding for Long Prompts May Fail on Windows

**Issue:** Agent implementations use `echo '${b64}' | base64 -d` to decode prompts, which assumes bash is available and `base64` command works correctly.

**Files:** `src/agents/claude.ts` (lines 10-11), `src/agents/gemini.ts` (lines 10-11)

**Impact:** On Windows without WSL/Git Bash, or in restricted environments, the base64 decoding step may fail silently, causing agents to receive empty or corrupted instructions. The error is not explicitly handled; agents just log a message to stderr and continue with empty output.

**Fix approach:**
- Add explicit error handling to verify the `/tmp/.prompt.md` file exists and is readable before proceeding
- Consider writing prompts to a proper temp file using Node APIs instead of shell roundtrip
- Add tests that verify prompt integrity after the base64 encode/decode cycle


### Insufficient Error Handling in Docker Build Failures

**Issue:** Docker build errors (lines 33-40 in `docker.ts`) catch only formatted error responses but may not handle network failures, image registry issues, or daemon crashes.

**Files:** `src/providers/docker.ts` (lines 27-40)

**Impact:** If Docker daemon is unavailable or network fails mid-build, the error message may be cryptic. The code throws but doesn't provide hints for recovery (e.g., "docker ps failed" doesn't suggest "is Docker running?").

**Fix approach:**
- Add specific error detection for common Docker issues (connection refused, image not found, no space)
- Provide actionable error messages with troubleshooting suggestions
- Add a `diagnose()` helper for Docker setup validation


### Unhandled Promise Rejection in Docker Container Cleanup

**Issue:** `tmpContainer.kill().catch(() => {})` and `tmpContainer.remove()` suppress all errors without logging.

**Files:** `src/providers/docker.ts` (lines 74-75)

**Impact:** If container cleanup fails due to permissions or Docker issues, the error is silently ignored. Over many trials, zombie containers accumulate, consuming disk space and eventually breaking future builds.

**Fix approach:**
- Log suppressed errors at debug level
- Add container list check in `diagnose()` to detect stale containers
- Consider retry logic with exponential backoff before giving up


## Known Bugs

### Parallel Execution Queue Unsynchronized

**Symptoms:** When running with `--parallel=N` where N > 1, occasionally trials are skipped or results appear out of order. With many trials, some trials don't execute at all.

**Files:** `src/evalRunner.ts` (lines 146-158)

**Trigger:** Run `npm run eval -- superlint --parallel=8 --trials=20` multiple times. Observe trial counts occasionally less than 20.

**Current mitigation:** None. The code assumes JavaScript's single-threaded event loop prevents interleaving, but the non-atomic read-then-shift pattern is fundamentally racy.

**Workaround:** Use `--parallel=1` (the default) for correctness, accept lower throughput.


### LLM Grader JSON Extraction is Too Permissive

**Symptoms:** LLM grader accepts any JSON-like structure with a `score` field, even if the LLM didn't actually follow instructions. Malformed responses (missing `reasoning`, negative scores, non-numeric values) are coerced to 0 without warning.

**Files:** `src/graders/index.ts` (lines 192-210)

**Trigger:** LLM response: `{"score": -0.5}` or `{"score": "NaN"}` parses without error.

**Workaround:** Rubric instructions should be explicit about JSON format. No runtime validation of response schema.

**Fix approach:**
- Add JSON schema validation (use `zod` or similar)
- Return error details instead of silently coercing invalid values
- Add test cases for malformed LLM responses


### Secret Redaction Only Works for Env Var Values

**Symptoms:** If a secret appears in the instruction text or command output but was never passed as an env var, it won't be redacted.

**Files:** `src/evalRunner.ts` (lines 299-330)

**Impact:** If a task's `instruction.md` accidentally contains a hardcoded API key, it leaks into logs.

**Fix approach:**
- Add a secrets config file (JSON or TOML) that lists patterns to redact
- Use a more sophisticated redaction strategy (regex patterns, known secret formats)
- Add a pre-eval check that scans instruction files for likely secrets


## Security Considerations

### API Key Exposure in LLM Grader Calls

**Risk:** Grader API keys (GEMINI_API_KEY, ANTHROPIC_API_KEY) are passed through environment and used in unencrypted HTTP calls.

**Files:** `src/graders/index.ts` (lines 128-142, 145-165, 167-189)

**Current mitigation:** API calls are made over HTTPS; keys are stored in process.env (not logged).

**Recommendations:**
- Add request/response logging at DEBUG level only (log request structure, not bodies with keys)
- Use the official SDKs instead of raw fetch() to ensure proper security practices
- Document that prod deployments should use API key rotation and auditing
- Consider using short-lived tokens if the LLM providers support them


### Shell Injection Risk in Command Execution

**Risk:** Commands passed to `runCommand()` are executed via `/bin/bash -c`, which is vulnerable if the command string is constructed from untrusted input.

**Files:** `src/providers/docker.ts` (line 184), `src/evalRunner.ts` (various grader commands)

**Current mitigation:** Commands are generated internally, not from user input. However, grader commands from task.toml are read from files.

**Recommendations:**
- Document that task.toml commands must come from trusted sources
- Consider a whitelist/sandbox mode that only allows specific safe commands
- Add input validation to reject commands with shell metacharacters if used programmatically


### Temp Directory Permission Issues

**Risk:** Temporary files created in `/tmp` (or `os.tmpdir()` on Windows) may be world-readable, exposing secrets if not cleaned up quickly.

**Files:** `src/providers/local.ts` (line 9), `src/agents/claude.ts` (line 11)

**Current mitigation:** Temp dirs are cleaned up after trial completion; prompt files are in `/tmp/.prompt.md` (world-readable).

**Recommendations:**
- Create temp dirs with restricted permissions (mode 0700)
- Use `mkdtemp()` with explicit mode instead of manual directory creation
- Consider in-memory storage for short-lived prompts instead of temp files


## Performance Bottlenecks

### Docker Image Rebuild on Every Prepare() Call

**Problem:** If `prepare()` is called multiple times (though currently not, it could happen in future refactors), each call rebuilds the image from scratch, wasting CPU/time.

**Files:** `src/providers/docker.ts` (lines 21-85)

**Cause:** No caching mechanism for built images beyond the single `preparedImage` field.

**Improvement path:**
- Add image hash caching to `.planning/docker-cache/` with metadata
- Reuse images across multiple task runs if Dockerfile hasn't changed
- Add `--no-cache` flag option to force rebuilds when needed


### Token Estimation is Inaccurate

**Problem:** Token counting uses a fixed 4 chars/token heuristic, which is off by 30-50% for typical LLM use (actual: ~3.5 chars for GPT, ~4-5 for others).

**Files:** `src/evalRunner.ts` (lines 63-66)

**Impact:** Reports show wildly inaccurate token consumption, making cost estimates unreliable.

**Improvement path:**
- Use official token counters from Anthropic/Google SDKs if available
- Fall back to a more accurate heuristic based on tokenizer libraries
- Document the limitation and add a "~" prefix to reported token counts


### Full Session Log Serialization for Every Trial

**Problem:** Large session logs (100+ commands, thousands of lines of output) are serialized to JSON and saved to disk for every trial. With 100 trials, this becomes 100+ MB of mostly redundant data.

**Files:** `src/evalRunner.ts` (lines 129-132, 332-341), CLI reporter

**Improvement path:**
- Store full logs in a separate archive (tar.gz)
- Keep summary metadata in JSON (trial ID, reward, grader scores)
- Add `--full-logs=false` option to skip detailed logging
- Compress logs before saving


## Fragile Areas

### Docker Provider Depends on Specific Container Setup

**Files:** `src/providers/docker.ts`

**Why fragile:** The code assumes:
- Container starts with `tail -f /dev/null` (lines 46, 103)
- Skill injection paths exist as `/workspace/.agents/skills` and `/workspace/.claude/skills` (lines 52)
- Commands run via `/bin/bash -c` with TTY=true (lines 184, 191)

**Safe modification:** Before changing container startup, verify:
1. Container stays alive long enough for shell invocation
2. File ownership/permissions allow skill injection
3. TTY mode doesn't break command parsing (can cause color codes in output)

**Test coverage gaps:**
- No integration test that verifies skill injection actually worked (only checks exit code)
- No test for large output (>1MB), which may cause buffer issues with TTY mode
- No test for commands that fork (e.g., `&` background processes)


### LLM Grader Transcript Building is Fragile

**Files:** `src/graders/index.ts` (lines 78-113)

**Why fragile:**
- Assumes specific entry types in session_log (`agent_start`, `command`, `agent_result`)
- If a future change adds new log entry types, they're silently ignored
- String concatenation without escaping could cause formatting issues
- Transcript order is implicit; if logging order changes, LLM sees different context

**Safe modification:**
- Add `sessionLog` type validation before building transcript
- Document the expected session_log schema
- Add unit tests that mock different session_log structures

**Test coverage gaps:**
- No test for missing/empty fields (e.g., agent result without output)
- No test for very large transcripts (>100KB)
- No test for non-ASCII characters in command output


## Scaling Limits

### Parallel Worker Pool is Fixed Size

**Current capacity:** Memory: ~N * (workspace size + log buffers) where N = parallel workers

**Limit:** With 10 concurrent workers running 2GB Docker containers, memory usage = 20GB. Typical dev machine has 16GB, so `--parallel=10` OOMs.

**Scaling path:**
- Add dynamic pool size based on available memory
- Implement work-stealing to prioritize finishing current trial before starting next
- Add trial queuing to limit in-flight workload


### Filesystem-Based Result Persistence

**Current capacity:** Results directory can hold 1000s of JSON files before listing becomes slow (~1MB per report).

**Limit:** `fs.readdir(resultsDir)` in preview (lines 47-50 in `cli.ts`) becomes O(N) slow. Listing 10k+ files takes seconds.

**Scaling path:**
- Move to a proper database (SQLite for local, PostgreSQL for production)
- Implement pagination in the preview viewer
- Add result filtering by date/task/agent to reduce working set


## Dependencies at Risk

### No Pinned Versions for Critical Dependencies

**Risk:** `dockerode@^4.0.9`, `fs-extra@^11.3.3`, `toml@^3.0.0` use caret ranges, allowing minor/patch updates that could introduce breaking changes.

**Files:** `package.json` (lines 30-34)

**Impact:** `npm install` on a future date may pull breaking changes from upstream.

**Migration plan:**
- Lock all dependencies to exact versions (remove `^` and `~`)
- Use `npm audit` regularly to catch security updates
- Use Dependabot to automate dependency updates with CI checks


### TypeScript Version Mismatch with Node 24

**Risk:** TypeScript `^5.9.3` may not have full support for Node 24's latest APIs. `ts-node` compatibility with newest Node versions can be flaky.

**Files:** `package.json` (lines 18-19, 27-28)

**Current mitigation:** Project uses `ts-node` which handles compilation on-the-fly.

**Recommendations:**
- Test with Node 24 explicitly (add CI test for `node --version >= 24.0`)
- Consider moving to native TypeScript compilation (esbuild, tsc) for faster startup
- Keep TypeScript within one major version of latest


## Missing Critical Features

### No Progress Reporting for Long-Running Evals

**Problem:** When running 100 trials with `--parallel=1`, the user gets no indication of progress for hours. Only the final summary appears.

**Blocks:** User can't estimate how long to wait or detect hangs.

**Fix approach:**
- Add a simple progress bar using `cli-progress` or similar
- Report every 10% completion or every 5 seconds
- Log which trial is currently running


### No Interrupt Handler for Graceful Shutdown

**Problem:** If user hits Ctrl+C mid-eval, resources (Docker containers, temp files) may not be cleaned up properly.

**Files:** `src/evalRunner.ts` (no signal handlers), `src/cli.ts` (no graceful shutdown)

**Blocks:** Containers accumulate; temp directories persist.

**Fix approach:**
- Add process-level signal handlers for SIGINT/SIGTERM
- Implement a "cancel" mechanism in EvalRunner
- Ensure teardown() is always called, even on interrupt


## Test Coverage Gaps

### Insufficient Error Path Testing

**What's not tested:**
- Docker build failure scenarios (registry timeout, disk full, permission denied)
- LLM API failures (timeout, 429, 500 errors)
- Command execution with non-zero exit codes and stderr
- Malformed task.toml files
- Missing grader rubric files

**Files:** `tests/bootstrap.test.ts` only tests happy path.

**Risk:** Errors encountered in production are untested and may cause confusing failures.

**Priority:** High

**Approach:**
- Add `tests/errors.test.ts` covering Docker, LLM, and command failures
- Mock failing API responses using `jest` or `sinon`
- Test each provider (Docker, Local) with simulated failures


### No Stress Testing for Parallel Execution

**What's not tested:**
- High concurrency (8+ workers, 50+ trials)
- Race condition detection
- Memory usage under load
- Container cleanup with fast/slow trial completion times

**Files:** `tests/bootstrap.test.ts` only runs sequential tests (lines 95-102).

**Risk:** `--parallel=N` may have subtle bugs that only appear under heavy load.

**Priority:** High

**Approach:**
- Add `tests/stress.test.ts` with parameterized concurrency levels
- Use a "result deduplication" check to verify no trials run twice
- Monitor memory/process count during test


### No Grader Output Validation Tests

**What's not tested:**
- LLM grader with malformed JSON responses
- LLM grader with missing fields (no `score`, no `reasoning`)
- Deterministic grader with invalid reward file (non-numeric, out-of-range)
- Multiple graders with conflicting scores

**Files:** `tests/` has no grader-specific tests.

**Risk:** Grader failures silently default to 0 score, hiding actual issues.

**Priority:** Medium

**Approach:**
- Add `tests/graders.test.ts` with mocked LLM responses
- Test each grader type independently
- Verify error messages are clear and actionable

---

*Concerns audit: 2026-03-08*
