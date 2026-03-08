---
status: diagnosed
phase: 02-local-llm-grader
source: 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md
started: 2026-03-08T22:30:00Z
updated: 2026-03-08T23:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Ollama Grader Mock Tests Pass
expected: Run `npm run test:ollama-grader`. All 19 tests pass covering: Ollama health check, model availability, retry logic for malformed JSON, fallback chain (Ollama -> Gemini -> Anthropic), JSON schema structured output, and model name prefix matching (e.g. "qwen3" matches "qwen3:latest").
result: pass

### 2. SKILL.md Agent Frontmatter
expected: Open `tasks/superlint_demo/skills/superlint/SKILL.md`. File begins with YAML frontmatter containing `name: superlint` and a `description` field. This enables agent CLI auto-discovery of the skill.
result: pass

### 3. Evaluation Without Ollama (Graceful Degradation)
expected: With Ollama NOT running, run `npm run eval:superlint`. Deterministic grader scores 1.0. LLM grader gracefully degrades to score 0 (no crash, no unhandled error). Overall pass_rate is approximately 0.70 (from weighted average: 1.0 * 0.7 + 0.0 * 0.3). Console output shows a warning about Ollama being unavailable, not an unhandled exception.
result: pass

### 4. Local Provider PATH Augmentation
expected: Run `npx ts-node tests/local-provider.test.ts`. All 3 tests pass confirming: workspace bin/ is prepended to PATH in spawned bash processes, task CLI tools are executable by name (not requiring absolute paths), and custom environment variables are preserved alongside the PATH augmentation.
result: issue
reported: "FAIL: workspace bin/ is first on PATH - FAIL: Expected first PATH entry to end with /bin, got /usr/local/sbin. FAIL: task-provided CLI is executable by name - EBUSY: resource busy or locked, rmdir temp dir. FAIL: custom env vars are preserved - FAIL: Expected 'hello', got ''"
severity: major

### 5. Bootstrap End-to-End Test
expected: Run `npm run test:bootstrap` with Ollama running. LLM grader produces an actual 0.0-1.0 score from Ollama inference (not 0.00 from timeout). Deterministic grader scores 1.0. This verifies Success Criterion 1: Ollama produces real LLM grading scores with no cloud API keys.
result: issue
reported: "llm_rubric scored 0.00 despite Ollama running. Ollama is up (curl confirms) but qwen3:4b inference does not complete within the timeout on ARM64 CPU. Deterministic grader works (1.00) but the primary Phase 2 deliverable -- local LLM grading producing a real score -- is not met."
severity: blocker

## Summary

total: 5
passed: 3
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "workspace bin/ is prepended to PATH in spawned bash processes, CLI tools executable by name, custom env vars preserved"
  status: failed
  reason: "User reported: All 3 local-provider tests fail. PATH entry is /usr/local/sbin not /bin, EBUSY on temp dir cleanup, custom env var empty string instead of expected value"
  severity: major
  test: 4
  root_cause: "PATH fix in 9188bc9 uses path.delimiter (;) on Windows but MSYS2/Git Bash translates semicolon-separated PATH at shell startup, potentially reordering entries. BASH_ENV from parent process may source a startup file that resets PATH and clobbers custom env vars. EBUSY on temp dir cleanup is Windows file-locking race (Defender/Search Indexer holding scan lock after process exit)."
  artifacts:
    - path: "src/providers/local.ts"
      issue: "PATH prepend uses path.delimiter but MSYS2 translation may reorder; BASH_ENV not suppressed in spawn env"
    - path: "tests/local-provider.test.ts"
      issue: "Assertions may not account for MSYS2 PATH reordering and Windows file-locking on cleanup"
  missing:
    - "Suppress BASH_ENV and ENV in spawned env to prevent startup files from clobbering PATH and env vars"
    - "Add retry/delay for temp dir cleanup on Windows to handle file-locking race"
  debug_session: ""

- truth: "Running an evaluation with Ollama produces 0.0-1.0 LLM scores using local model with no cloud API keys"
  status: failed
  reason: "User reported: llm_rubric scored 0.00 despite Ollama running. qwen3:4b inference does not complete within timeout on ARM64 CPU. Success Criterion 1 not met."
  severity: blocker
  test: 5
  root_cause: "Three compounding issues: (1) Hardcoded AbortSignal.timeout(300000) at src/graders/index.ts:238 is 5 min but should be ~60s for grader response (5 min was the trial budget, not grader budget). (2) qwen3:4b is a thinking model that generates chain-of-thought tokens before the answer, consuming most of num_predict:2048 budget on thinking. (3) Default num_ctx not set -- Ollama allocates full 40960 context window for a ~500-token prompt, wasting compute. (4) Silent failure -- evalRunner.ts prints score but not details, hiding the timeout reason."
  artifacts:
    - path: "src/graders/index.ts"
      issue: "Line 238: hardcoded 300s timeout. Line 129/223: default model qwen3:4b is a thinking model. Line 250-253: error logged as console.warn only. No num_ctx set in Ollama API call."
    - path: "src/types.ts"
      issue: "Lines 15-21: GraderConfig has no timeout_ms or num_ctx field"
    - path: "src/evalRunner.ts"
      issue: "Lines 51-53: output loop prints score but not details when score is 0"
  missing:
    - "Reduce grader timeout to 60s (1 min) -- grading a single response should not take 5 min"
    - "Set num_ctx in Ollama API call to a small value (e.g. 4096) -- grading prompt is ~500 tokens"
    - "Make timeout_ms configurable via GraderConfig / task.toml"
    - "Switch default model to a non-thinking model (e.g. phi3.5:3.8b) or make model configurable per task"
    - "Surface grader failure details in evalRunner output when score is 0"
  debug_session: ".planning/debug/ollama-grader-score-zero-arm64.md"
