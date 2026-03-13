# Agents

## Long-running commands

When a task requires a command that may exceed 2 minutes (benchmarks, builds, deployments):
- Use `run_in_background: true` and wait for the completion notification.
- NEVER poll with sleep loops, `cat | tail`, or repeated reads of the output file.
- If you need the result before proceeding, state that you are waiting and stop.

## Ollama

- Only one Ollama model should be loaded at a time. Run `ollama stop <model>` between experiments to free memory before loading the next model.

## Open-Closed Principle (upstream fork)

This repo is a fork of `mgechev/skill-eval`. Apply the Open-Closed Principle to upstream code:
- **Open for extension** -- add new files, new classes, new modules alongside upstream code.
- **Closed for modification** -- avoid editing files that exist in the upstream repo. When you must change upstream behavior, prefer wrapping, subclassing, or composing over direct edits.
- When upstream modification is unavoidable, keep changes minimal and clearly commented so they can be rebased when upstream updates.
