---
status: diagnosed
phase: 02-local-llm-grader
source: 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md
started: 2026-03-09T12:00:00Z
updated: 2026-03-09T01:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Ollama Grader Mock Tests Pass
expected: Run `npm run test:ollama-grader`. All 19 tests pass covering: Ollama health check, model availability, retry logic for malformed JSON, fallback chain (Ollama -> Gemini -> Anthropic), JSON schema structured output, and model name prefix matching.
result: pass

### 2. SKILL.md Agent Frontmatter
expected: Open `tasks/superlint_demo/skills/superlint/SKILL.md`. File begins with YAML frontmatter containing `name: superlint` and a `description` field. This enables agent CLI auto-discovery of the skill.
result: pass

### 3. Evaluation Without Ollama (Graceful Degradation)
expected: With Ollama NOT running, run `npm run eval:superlint`. Deterministic grader scores 1.0. LLM grader gracefully degrades to score 0 (no crash, no unhandled error). Overall pass_rate is approximately 0.70 (from weighted average: 1.0 * 0.7 + 0.0 * 0.3). Console output shows a warning about Ollama being unavailable, not an unhandled exception.
result: pass

### 4. Local Provider PATH Augmentation (post-fix)
expected: Run `npx ts-node tests/local-provider.test.ts` from your PowerShell terminal. All 4 tests pass: (1) workspace bin/ is in PATH and precedes /usr/bin, (2) task CLI tool executable by name, (3) custom env vars preserved in subprocess, (4) BASH_ENV and ENV suppressed in child process. No failures from PowerShell — the MSYS2 login-shell PATH rebuilding is suppressed by --norc --noprofile.
result: issue-then-pass
reported: "Initially failed: bin/ at idx 9, /usr/bin at idx 3, custom env var empty. Root cause: spawn('bash') resolved to WSL bash from PowerShell. Fix: resolveGitBash() locates Git Bash explicitly + semicolon PATH separator on Windows. After fix: 4/4 pass from PowerShell."
severity: resolved

### 5. Bootstrap Secret Sanitization (post-fix)
expected: Run `npm run test:bootstrap`. The "Secret Injection & Sanitization" test no longer exits with FAILURE. It prints "SUCCESS: Secret not present in log files" (the secret either gets redacted or never reaches the subprocess — both are valid). The test does NOT fail with "Secret not found and not redacted" anymore.
result: pass

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

- truth: "workspace bin/ precedes /usr/bin in PATH and custom env vars are preserved in spawned bash subprocess from PowerShell"
  status: resolved
  reason: "User reported: 2/4 tests fail from PowerShell. bin/ at idx 9 but /usr/bin at idx 3, custom env var empty."
  severity: major
  test: 4
  root_cause: "spawn('bash') from PowerShell resolves to C:\\WINDOWS\\system32\\bash.exe (WSL launcher) instead of Git Bash. WSL bash reconstructs PATH from Linux defaults and drops Windows env vars. Secondary: colon PATH separator splits Windows drive letters."
  artifacts:
    - path: "src/providers/local.ts"
      issue: "resolveGitBash() added to locate Git Bash explicitly; semicolon PATH separator on Windows"
  missing: []
  debug_session: ".planning/debug/local-provider-path-powershell.md"
