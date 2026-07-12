# eval.yaml Specification

## Top-Level Keys

```yaml
version: "1"                    # Required, always "1"
skill: path/to/my-skill         # Optional, defaults to auto-detecting SKILL.md
```

## defaults

Configure shared settings for all tasks.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agent` | string | auto-detect | `gemini`, `claude`, `codex`, `acp`, `opencode`, or `command` |
| `command` | string | none | Command to run when `agent` is `command` (e.g. `node mycli.js`). Required for the `command` agent. |
| `provider` | string | `docker` | `docker` or `local` |
| `trials` | number | 5 | Number of evaluation trials |
| `timeout` | number | 300 | Seconds before agent timeout |
| `threshold` | number | 0.8 | Pass rate threshold for `--ci` mode |
| `grader_model` | string | latest, resolved via the provider's API | Default LLM model for rubric graders. Also overridable per-run with `ANTHROPIC_MODEL` / `OPENAI_MODEL` / `GEMINI_MODEL`. |
| `grader_provider` | string | `gemini` | Default LLM provider for rubric graders (`gemini`, `anthropic`, or `openai`) |

### defaults.docker

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `base` | string | `node:20-slim` | Base Docker image |
| `setup` | string | `""` | Additional commands run during image build |

### defaults.environment

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cpus` | number | 2 | CPU cores allocated to the container |
| `memory_mb` | number | 2048 | Memory in megabytes |

### defaults.acp

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `command` | string | none | Command to start an ACP-compatible agent |
| `env` | object | none | Environment variables for the ACP process |

## tasks

Array of evaluation tasks. Each task has:

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | Yes | Unique task identifier (used in report filenames) |
| `instruction` | string | Yes | What the agent should accomplish. Supports file references. |
| `workspace` | array | No | Files copied into the container |
| `graders` | array | Yes | One or more grader definitions |
| `agent` | string | No | Per-task agent override |
| `command` | string | No | Per-task command override (for the `command` agent) |
| `trials` | number | No | Per-task trial count override |
| `timeout` | number | No | Per-task timeout override |

### workspace entries

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `src` | string | Yes | Source path relative to skill directory |
| `dest` | string | Yes | Destination path inside the container |
| `chmod` | string | No | File permissions (e.g., `"+x"`) |

### grader entries

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `type` | string | Yes | `deterministic` or `llm_rubric` |
| `run` | string | Deterministic only | Command to execute |
| `setup` | string | No | Install command for grader dependencies |
| `rubric` | string | LLM only | Evaluation rubric text or file path |
| `provider` | string | No | LLM provider: `gemini` (default), `anthropic`, or `openai` |
| `model` | string | No | LLM model override. Highest precedence: beats `defaults.grader_model`, the `*_MODEL` env vars, and the dynamically resolved default. |
| `weight` | number | No | Grader weight (default: 1) |

## File References

String values (`instruction`, `rubric`, `run`) support file references — if the value is a valid file path, the file contents are read automatically:

```yaml
instruction: instructions/fix-linting.md
rubric: rubrics/workflow-quality.md
```
