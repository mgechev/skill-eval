---
created: "2026-03-08T21:49:18.239Z"
title: Ollama LLM grader times out in bootstrap test on ARM64
area: testing
files:
  - src/graders/index.ts:190-230
  - tests/bootstrap.test.ts
---

## Problem

When running `npm run test:bootstrap` on a Snapdragon X Elite ARM64 machine, the Ollama LLM grader times out during the grading phase. The `qwen3:4b` model runs on CPU (no GPU acceleration on this hardware), and inference is too slow to complete within the 5-minute default timeout configured in `callOllama`.

Bootstrap test output shows:
```
[LLMGrader] Ollama call failed: The operation was aborted due to timeout
```

The deterministic grader still scores 1.0 (weight 0.7), so the overall reward is 0.70. The LLM rubric score is 0.00 (weight 0.3) because the timeout prevents any LLM grading from completing.

## Root Cause Analysis (from UAT diagnosis)

Three compounding factors cause the timeout:

1. **Timeout miscalibration**: The 300s (5 min) `AbortSignal.timeout` at `src/graders/index.ts:238` was meant as a trial budget, not a grader response budget. A single LLM grading call (scoring an already-completed response) should complete in ~60s max.

2. **Thinking model overhead**: `qwen3:4b` is a "thinking" model that generates `<think>...</think>` chain-of-thought tokens before producing the JSON answer. These thinking tokens consume most of the `num_predict: 2048` budget, at ~5-10 tokens/sec on CPU that's 200-400s of thinking before any answer starts.

3. **Silent prompt truncation**: No `num_ctx` is set in the Ollama API call, so Ollama uses its default of 2048 tokens (NOT the model's native 32,768). The grading prompt (~825 tokens) + response budget (num_predict: 2048) needs ~2900 tokens total. At num_ctx: 2048, the prompt is silently truncated from the beginning -- no error, no warning in the API response. Setting `num_ctx: 4096` ensures the full prompt fits with headroom.

4. **Silent failure**: `evalRunner.ts` prints `llm_rubric: 0.00` but never surfaces `GraderResult.details`, hiding the timeout reason from the user.

## Solution

Required fixes (Phase 2 gap closure):
- **Reduce grader timeout to 60s** -- grading a single response should not take 5 min
- **Set explicit `num_ctx` in Ollama API call** (default 4096) -- Ollama defaults to 2048 which silently truncates prompt+response (~2900 tokens needed)
- **Make `timeout_ms` configurable** via `GraderConfig` / `task.toml` for tasks that need longer
- **Surface grader failure details** in evalRunner output when score is 0
- **Consider non-thinking model default** (e.g., `phi3.5:3.8b`) or document that thinking models are slow on CPU-only hardware
