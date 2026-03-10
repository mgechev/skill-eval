---
phase: 04-ollamatoolagent-ollama-model-setup
plan: 03
status: complete
tasks_completed: 2
tasks_total: 2
started: 2026-03-10T17:30:00Z
completed: 2026-03-10T19:30:00Z
---

# Plan 03 Summary: End-to-End Validation

## What was done

### Task 1: Model setup and smoke test verification
- Discovered qwen3:8b (5.2 GB) is too heavy for CPU-only ARM64 (Snapdragon X Elite) -- saturates all cores, causes system freeze
- Switched to qwen3:4b (2.5 GB) -- manageable CPU load
- Benchmarked thread configs: 8 threads optimal balance of speed vs responsiveness
- Lowered num_ctx from 8192 to 4096 (tasks don't need 8K context)
- Added `/no_think` to system prompt to suppress Qwen3 thinking mode that wastes tokens
- Smoke test passes: model produces structured tool_calls for list_directory

### Task 2: End-to-end superlint_demo verification
- superlint_demo completes with 0.97 reward (deterministic: 1.0, llm_rubric: 0.9)
- Agent executes 9 commands across the mandatory 3-step workflow
- Agent model unloaded via keep_alive: 0 after run (grader model loads separately)
- All 7 test suites pass (50 assertions total)

## Key decisions

- **qwen3:4b over qwen3:8b**: 8B model unusable on CPU-only ARM64 (system freeze). 4B model runs at ~50s/turn on 8 threads
- **8 threads locally, 3 in CI**: Caps CPU usage while keeping inference speed. CI Modelfile separate
- **num_ctx 4096**: Sufficient for eval tasks, reduces KV cache memory
- **num_predict 4096**: Must stay high -- lower values truncate tool calls mid-generation (Qwen3 thinking text consumes tokens before emitting tool calls)
- **Directive system prompt**: "Do not explain your reasoning - just call the appropriate tool" reduces token waste. More aggressive "ONLY tool calls" prompt caused 18-command loops
- **Smart model unloading**: CLI unloads non-agent models before eval, keeps agent model warm

## Deviations from plan

- Plan specified qwen3:8b; switched to qwen3:4b due to hardware constraints
- Plan specified num_ctx 16384; lowered to 4096 after benchmarking
- Added num_thread parameter (not in original plan) to prevent system freeze
- Added CI-specific Modelfile (not in original plan) for different thread config
- Task timeout increased from 300s to 600s for CPU-based inference

## Performance benchmarks (single turn, warm model)

| Config | Time | Tool calls |
|--------|------|------------|
| 5 threads, ctx 8192 | 76.5s | 3 |
| 8 threads, ctx 8192 | 59.0s | 3 |
| 8 threads, ctx 4096 | 57.5s | 3 |
| 8 threads, ctx 4096, predict 1024 | 48.9s | 3 |

Full eval (9 turns): ~440-590s depending on model warmth.

## Artifacts

- `modelfiles/qwen3-skill-eval-agent.Modelfile` -- local config (8 threads)
- `modelfiles/qwen3-skill-eval-agent.ci.Modelfile` -- CI config (3 threads)
- `results/superlint_demo_*.json` -- eval results showing 0.97 reward

## Self-Check

- [x] qwen3-skill-eval-agent model created from custom Modelfile
- [x] Smoke test confirms structured tool_calls from model
- [x] superlint_demo end-to-end run completes with OllamaToolAgent (reward: 0.97)
- [x] Agent model unloaded before grading (ollama ps confirmed)
- [x] All 7 test suites pass (50 assertions)
