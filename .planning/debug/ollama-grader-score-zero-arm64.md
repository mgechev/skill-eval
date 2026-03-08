---
status: resolved
trigger: "Investigate why the Ollama LLM grader produces score 0.00 despite Ollama being confirmed running"
created: 2026-03-08T23:30:00Z
updated: 2026-03-08T23:45:00Z
---

## Current Focus

hypothesis: confirmed - AbortSignal.timeout(300000) fires before qwen3:4b completes a single inference on Snapdragon X Elite CPU
test: cross-reference observed 490s trial duration with 300s fetch timeout, trace callOllamaWithRetry null-return path, confirm no error surfacing
expecting: timeout abort causes null return, falls through to score=0 with no cloud keys, details field contains error reason but bootstrap does not print it
next_action: resolved - recommendations documented

## Symptoms

expected: llm_rubric grader produces a 0.0-1.0 score from local Ollama inference with qwen3:4b
actual: llm_rubric scores 0.00; deterministic grader scores 1.00; overall pass_rate = 0.70
errors: "[LLMGrader] Ollama call failed: The operation was aborted due to timeout" (console.warn, not shown in bootstrap summary)
reproduction: run `npm run test:bootstrap` with Ollama running and qwen3:4b pulled on ARM64 CPU-only hardware
started: first run of bootstrap on Snapdragon X Elite; never worked on this hardware

## Eliminated

- hypothesis: Ollama server not running or model not pulled
  evidence: curl http://localhost:11434 returns "Ollama is running"; checkOllamaAvailability passes (health + tags both succeed); ollamaStatus.available = true
  timestamp: 2026-03-08T23:32:00Z

- hypothesis: Prompt construction failure (empty transcript, missing rubric file)
  evidence: rubricPath = tasks/superlint_demo/prompts/quality.md exists; session log always has agent_start + 3 command entries + agent_result; sections array is populated
  timestamp: 2026-03-08T23:33:00Z

- hypothesis: JSON parse failure after successful generation (malformed response)
  evidence: callOllamaWithRetry returns null, not a parse-failed GraderResult; null return means callOllama threw (catch block hit), not that generation succeeded with bad JSON; retry logic correctly returns null immediately on connection errors
  timestamp: 2026-03-08T23:34:00Z

- hypothesis: callOllamaWithRetry retries on timeout (amplifying the delay)
  evidence: retry logic in callOllamaWithRetry (line 263) returns null IMMEDIATELY when callOllama returns null; no retry on null; only retries on parse failure; timeout correctly aborts after one attempt
  timestamp: 2026-03-08T23:35:00Z

## Evidence

- timestamp: 2026-03-08T23:36:00Z
  checked: src/graders/index.ts line 238
  found: AbortSignal.timeout(300000) — fetch is aborted at exactly 300 seconds (5 minutes)
  implication: this is a hard wall; if qwen3:4b on CPU does not complete within 300s, the call throws AbortError

- timestamp: 2026-03-08T23:37:00Z
  checked: bootstrap test observed duration 490s total trial
  found: 490s total trial duration with qwen3:4b on ARM64 CPU; the 300s grader timeout fires during inference; actual generation need is ~490s - agent run time (~few seconds) = well over 300s
  implication: qwen3:4b on Snapdragon X Elite CPU-only requires approximately 400-500s for a single grading inference; the 5-minute timeout is insufficient by ~2x

- timestamp: 2026-03-08T23:38:00Z
  checked: src/graders/index.ts lines 250-253 (catch block in callOllama)
  found: catch block executes console.warn("[LLMGrader] Ollama call failed: ...") and returns null
  implication: the error IS logged but only as console.warn; bootstrap test summary loop (evalRunner.ts line 52) only prints "grader_type: score (weight)" — it does not print details; the user sees "llm_rubric: 0.00" with no visible reason

- timestamp: 2026-03-08T23:39:00Z
  checked: src/graders/index.ts lines 139-180 (grade() fallback chain)
  found: when callOllamaWithRetry returns null AND ollamaStatus.available is true, code falls through to cloud providers (lines 161-169); when no cloud keys exist, returns score=0 with details "No LLM grading available (Ollama generation failed, no GEMINI_API_KEY or ANTHROPIC_API_KEY set)"
  implication: the details string contains the reason, but evalRunner does not print it; silent score=0 from user perspective

- timestamp: 2026-03-08T23:40:00Z
  checked: src/types.ts GraderConfig interface (lines 15-21)
  found: GraderConfig has no timeout field; only type, command, rubric, model, weight
  implication: timeout is hardcoded at line 238 of graders/index.ts; no way to configure it from task.toml without a code change

- timestamp: 2026-03-08T23:41:00Z
  checked: qwen3:4b model characteristics
  found: qwen3:4b is a thinking model (generates <think>...</think> scratchpad before answering); thinking tokens count against num_predict (2048); on CPU inference at ~5-10 tok/s, 2048 tokens takes 200-400s; combined with prompt processing the total easily exceeds 300s
  implication: qwen3:4b's thinking behavior is the primary amplifier; non-thinking models of similar parameter count would be faster; phi3.5:3.8b or gemma3:4b do not use thinking tokens

- timestamp: 2026-03-08T23:42:00Z
  checked: prompt size estimation
  found: instruction.md ~400 chars, quality.md rubric ~700 chars, command outputs (3 superlint commands) ~300 chars, agent output "Solved" ~6 chars, system prompt ~600 chars; total prompt ~2000 chars = ~500 tokens; prompt processing at ~50 tok/s = ~10s; not the bottleneck
  implication: the prompt itself is small and not the cause of slowness; the bottleneck is entirely the thinking token generation phase of qwen3:4b

- timestamp: 2026-03-08T23:43:00Z
  checked: evalRunner.ts bootstrap output loop (lines 51-53)
  found: bootstrap prints "grader_type: score (weight)" but never prints GraderResult.details; the "[LLMGrader] Ollama call failed: ..." warning goes to console.warn which IS stdout; user should see it but it may scroll past in the trial output
  implication: error is technically surfaced but not prominently; bootstrap should print grader details when score=0 to make failures visible

## Resolution

root_cause: |
  qwen3:4b on Snapdragon X Elite ARM64 CPU (no GPU) requires ~400-500 seconds for a single inference call.
  The generation timeout is hardcoded at 300000ms (300s) in callOllama() at src/graders/index.ts:238.
  The model's built-in thinking behavior (chain-of-thought scratchpad tokens) consumes the majority of
  inference time. At ~5-10 tokens/second on CPU, generating 2048 tokens takes 200-400s before any
  visible output appears. The 5-minute timeout is insufficient by approximately 2x for this hardware.

  Secondary issue: when grading fails, the GraderResult.details contains the reason but the bootstrap
  test output loop (evalRunner.ts:52) never prints details, so the user sees "llm_rubric: 0.00" with
  no explanation. The console.warn IS emitted but may scroll past unnoticed.

fix: not applied (diagnose-only mode)

verification: n/a

files_changed: []
