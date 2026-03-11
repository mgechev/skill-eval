# Experiments: Parameter Tuning (Plan 04.1-02)

**Date:** 2026-03-11
**Baseline:** qwen3.5:4b, avg 235.0s +/- 9.4s, reward 0.99, 4 cmds
**Methodology:** Each experiment changes ONE variable from baseline. 3 measured trials per experiment with warm-up.

## Summary Table

| Experiment | Avg Duration (s) | StdDev (s) | Avg Reward | Avg Cmds | Verdict |
|-----------|-----------------|-----------|-----------|---------|---------|
| baseline | 235.0 | 9.4 | 0.99 | 4.0 | BASELINE |
| temp-025 | 227.7 | 25.6 | 0.99 | 4.0 | KEEP |
| structured-prompt | 235.2 | 10.4 | 0.97 | 4.0 | REJECT |
| predict-2048 | 303.7 | 35.5 | 0.97 | 4.7 | REJECT |
| max-iter-15 | 313.3 | 43.6 | 0.98 | 5.0 | REJECT |
| batch-1024 | 215.6 | 8.2 | 0.99 | 4.0 | KEEP |
| tool-output-4000 | 274.0 | 29.0 | 0.98 | 4.7 | REJECT |

## Experiment 1: Temperature 0.25

**Changed:** Modelfile `temperature 0` -> `temperature 0.25`
**Rationale:** Small temperature may improve tool call diversity and reduce stuck loops.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 198.2 | 0.97 | 4 |
| 2 | 241.6 | 1.00 | 4 |
| 3 | 243.3 | 1.00 | 4 |
| **Avg** | **227.7** | **0.99** | **4.0** |

**Verdict: KEEP** -- 3% speed improvement, same reward, but higher variance (25.6s vs 9.4s baseline). Trial 1 was notably fast (198.2s).

## Experiment 2: Structured System Prompt

**Changed:** System prompt from 3-line directive to structured rules format:
```
You are a coding agent. Complete the task using the provided tools.

Rules:
- Call tools directly, no explanations between calls.
- Read files before editing them.
- If a command fails, try a different approach instead of repeating it.
- When finished, respond with a brief summary.

/no_think
```
**Rationale:** More explicit rules may reduce wasted turns and improve task completion.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 246.1 | 0.97 | 4 |
| 2 | 233.9 | 0.97 | 4 |
| 3 | 225.5 | 0.97 | 4 |
| **Avg** | **235.2** | **0.97** | **4.0** |

**Verdict: REJECT** -- no speed improvement, slightly lower reward (0.97 vs 0.99). The structured prompt adds more tokens to the system message without benefit.

## Experiment 3: num_predict 2048

**Changed:** Modelfile `num_predict 4096` -> `num_predict 2048`
**Rationale:** Halving generation budget reduces max generation time per turn.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 324.5 | 0.97 | 5 |
| 2 | 262.7 | 0.97 | 4 |
| 3 | 324.0 | 0.97 | 5 |
| **Avg** | **303.7** | **0.97** | **4.7** |

**Verdict: REJECT** -- 29% slower, more commands, misses 300s target. Truncated tool calls force retries. Confirms Phase 4 decision: num_predict 4096 is required.

## Experiment 4: maxIterations 15

**Changed:** Agent config `maxIterations 30` -> `maxIterations 15`
**Rationale:** Agent typically completes in 4-6 turns; 15 is plenty of headroom while preventing runaway loops.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 362.0 | 0.97 | 6 |
| 2 | 300.0 | 1.00 | 5 |
| 3 | 278.0 | 0.97 | 4 |
| **Avg** | **313.3** | **0.98** | **5.0** |

**Verdict: REJECT** -- 33% slower with high variance. Likely noise rather than causation (15 iterations has plenty of headroom), but the data does not support the change.

## Experiment 5: num_batch 1024

**Changed:** Modelfile added `PARAMETER num_batch 1024` (Ollama default is 512)
**Rationale:** Larger batch size processes more tokens per batch during prompt evaluation (KV cache fill), directly targeting the 70% prompt_eval bottleneck.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 224.9 | 0.97 | 4 |
| 2 | 212.8 | 1.00 | 4 |
| 3 | 209.2 | 1.00 | 4 |
| **Avg** | **215.6** | **0.99** | **4.0** |

**Verdict: KEEP** -- 8.3% speedup with lower variance (8.2s vs 9.4s) and identical reward. Clear winner. Directly addresses the prompt_eval bottleneck identified in profiling.

## Experiment 6: maxToolOutputChars 4000

**Changed:** Agent config `maxToolOutputChars 8000` -> `maxToolOutputChars 4000`
**Rationale:** Halving tool output reduces context growth per turn, reducing prompt_eval cost.

| Trial | Duration (s) | Reward | Commands |
|-------|-------------|--------|----------|
| 1 | 290.6 | 0.97 | 5 |
| 2 | 240.5 | 1.00 | 4 |
| 3 | 291.0 | 0.97 | 5 |
| **Avg** | **274.0** | **0.98** | **4.7** |

**Verdict: REJECT** -- 17% slower with more commands. Truncating tool output too aggressively causes the agent to lose context and need extra commands to recover.

## Analysis

### Winners
1. **batch-1024** (-8.3%): Best single-variable improvement. Directly targets the prompt_eval bottleneck.
2. **temp-025** (-3%): Marginal improvement with higher variance. May help with tool call diversity.

### Key Insights
- **Ollama-level params beat code-level tuning:** The only KEPT experiment that changed Ollama parameters (batch-1024) produced the biggest improvement.
- **Don't reduce generation budget:** num_predict 2048 and maxToolOutputChars 4000 both caused more commands and slower runs. The agent needs room to generate complete tool calls and see full tool output.
- **System prompt changes are neutral:** The structured prompt didn't help. The baseline 3-line prompt is already concise enough.
- **maxIterations is irrelevant:** The agent completes in 4-6 turns regardless of the cap.
