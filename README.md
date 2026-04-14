# Skillgrade

The easiest way to evaluate your [Agent Skills](https://agentskills.io/home). Tests that AI agents correctly discover and use your skills.

See [examples/](examples/) — [superlint](examples/superlint/) (simple) and [angular-modern](examples/angular-modern/) (TypeScript grader).

![Browser Preview](https://raw.githubusercontent.com/mgechev/skillgrade/main/assets/browser-preview.png)

## Quick Start

**Prerequisites**: Node.js 20+, Docker

```bash
npm i -g @kmonty/skillgrade
```

**1. Initialize** — go to your skill directory (must have `SKILL.md`) and scaffold:

```bash
cd my-skill/
GEMINI_API_KEY=your-key skillgrade init    # or ANTHROPIC_API_KEY / OPENAI_API_KEY
# Use --force to overwrite an existing eval.yaml
# Use --config=FILE to specify a custom filename
```

Generates `eval.yaml` (or your custom config) with AI-powered tasks and graders. Without an API key, creates a well-commented template.

**2. Edit** — customize `eval.yaml` (or your custom config) for your skill (see [eval.yaml Reference](#evalyaml-reference)).

**3. Run**:

```bash
GEMINI_API_KEY=your-key skillgrade --smoke
# Or with a custom config:
GEMINI_API_KEY=your-key skillgrade --config=eval-baseline.yaml
```

The agent is auto-detected from your API key: `GEMINI_API_KEY` → Gemini, `ANTHROPIC_API_KEY` → Claude, `OPENAI_API_KEY` → Codex. Override with `--agent=claude`.

**4. Review**:

```bash
skillgrade preview          # CLI report
skillgrade preview browser  # web UI → http://localhost:3847
# Or with a custom output directory:
skillgrade preview --output=reports
```

Reports are saved to `$TMPDIR/skillgrade/<skill-name>/results/`. Override with `--output=DIR`.

## Presets

| Flag | Trials | Use Case |
|------|--------|----------|
| `--smoke` | 5 | Quick capability check |
| `--reliable` | 15 | Reliable pass rate estimate |
| `--regression` | 30 | High-confidence regression detection |

## Options

| Flag | Description |
|------|-------------|
| `--config=FILE` | Custom eval configuration file (default: `eval.yaml`) |
| `--eval=NAME[,NAME]` | Run specific evals by name (comma-separated) |
| `--grader=TYPE` | Run only graders of a type (`deterministic` or `llm_rubric`) |
| `--trials=N` | Override trial count |
| `--parallel=N` | Run trials concurrently |
| `--agent=gemini\|claude\|codex` | Override agent (default: auto-detect from API key) |
| `--provider=docker\|local` | Override provider |
| `--output=DIR` | Output directory (default: `$TMPDIR/skillgrade`) |
| `--validate` | Verify graders using reference solutions |
| `--ci` | CI mode: exit non-zero if below threshold |
| `--threshold=0.8` | Pass rate threshold for CI mode |
| `--preview` | Show CLI results after running |
| `--no-skills` | Run without any agent skills (for baseline testing) |

## Parallelism & Multiple API Keys

Scale your evaluations by running trials concurrently:

```bash
# Run 10 trials, 5 at a time
GEMINI_API_KEY=your-key skillgrade --trials=10 --parallel=5
```

### Bypassing Rate Limits (Multi-Key Rotation)

When running high-concurrency evals, you might hit LLM rate limits. SkillGrade can automatically rotate through multiple API keys:

```bash
# Pass multiple keys separated by commas
export GEMINI_API_KEY="key_alpha, key_beta, key_gamma"
skillgrade --parallel=3 --reliable
```

SkillGrade detects the commas and distributes the keys round-robin across trials (Trial 1 gets `key_alpha`, Trial 2 gets `key_beta`, etc.). This works for any environment variable ending in `_API_KEY` or `_TOKEN`.

## eval.yaml Reference

```yaml
version: "1"

# Optional: explicit path to skill directory (defaults to auto-detecting SKILL.md)
# skill: path/to/my-skill

defaults:
  agent: gemini          # gemini | claude | codex
  provider: docker       # docker | local
  trials: 5
  timeout: 300           # seconds
  threshold: 0.8         # for --ci mode
  grader_model: gemini-3-flash-preview  # default LLM grader model
  docker:
    base: node:20-slim
    setup: |             # extra commands run during image build
      apt-get update && apt-get install -y jq
  environment:           # container resource limits
    cpus: 2
    memory_mb: 2048
    mounts:              # bind mounts (Docker only)
      - /host/path:/container/path

tasks:
  - name: fix-linting-errors
    instruction: |
      Use the superlint tool to fix coding standard violations in app.js.

    workspace:                           # files copied into the container
      - src: fixtures/broken-app.js
        dest: app.js
      - src: bin/superlint
        dest: /usr/local/bin/superlint
        chmod: "+x"
      - content: |                       # inline file content
          # Gemini Custom Instructions
          Always use TypeScript for new files.
        dest: /root/.gemini/GEMINI.md

    trialConfig:                         # per-trial hooks (optional)
      setup: "echo setup"                # inline or file path
      cleanup: "echo cleanup"            # inline or file path

    graders:
      - type: deterministic
        setup: npm install typescript    # grader-specific deps (optional)
        run: npx ts-node graders/check.ts
        weight: 0.7
      - type: llm_rubric
        rubric: |
          Did the agent follow the check → fix → verify workflow?
        model: gemini-2.0-flash          # optional model override
        weight: 0.3

    # Per-task overrides (optional)
    agent: claude
    trials: 10
    timeout: 600
    solution: solutions/solve.sh         # reference solution for --validate mode
```

String values (`instruction`, `rubric`, `run`) and `trialConfig` fields (`setup`, `cleanup`) support **file references** — if the value is a valid file path, its contents are read automatically.

### Script Arguments

For fields that execute scripts (`run` for deterministic graders, and `setup`/`cleanup` in `trialConfig`), you can also pass arguments by appending them to the file path:

```yaml
graders:
  - type: deterministic
    run: graders/check.sh --verbose --mode fast
```

If the string starts with a valid file path followed by arguments, `skillgrade` will read the file content and automatically pass the arguments to it when executed. This works even when `setup`/`cleanup` scripts from `defaults` and `tasks` are merged!

Example with file references:
```yaml
instruction: instructions/fix-linting.md
rubric: rubrics/workflow-quality.md
trialConfig:
  setup: scripts/setup.sh --flag
  cleanup: scripts/cleanup.sh
```

### Workspace Inline Content

For `workspace` mappings, you can use the `content` field instead of `src` to provide the file content directly in `eval.yaml`. This is useful for small configuration files or scripts. It writes the content to a file in a `workspace_files/` subdirectory within the build context and uses standard `COPY` under the hood.

```yaml
workspace:
  - content: |
      # Custom Instructions for Gemini
      
      - Use standard style.
      - Write tests for all new features.
    dest: /root/.gemini/GEMINI.md
```

### Docker Bind Mounts

You can mount directories or files from your host machine into the Docker container by specifying `mounts` in the `environment` section (either in `defaults` or per-task).

```yaml
environment:
  mounts:
    - /host/path:/container/path
    - ~/data:/data # Supports ~ expansion for home directory
```

## Graders

### Deterministic

Runs a command and parses JSON from stdout:

```yaml
- type: deterministic
  run: bash graders/check.sh
  weight: 0.7
```

Output format:

```json
{
  "score": 0.67,
  "details": "2/3 checks passed",
  "checks": [
    {"name": "file-created", "passed": true, "message": "Output file exists"},
    {"name": "content-correct", "passed": false, "message": "Missing expected output"}
  ]
}
```

`score` (0.0–1.0) and `details` are required. `checks` is optional.

**Bash example:**

```bash
#!/bin/bash
passed=0; total=2
c1_pass=false c1_msg="File missing"
c2_pass=false c2_msg="Content wrong"

if test -f output.txt; then
  passed=$((passed + 1)); c1_pass=true; c1_msg="File exists"
fi
if grep -q "expected" output.txt 2>/dev/null; then
  passed=$((passed + 1)); c2_pass=true; c2_msg="Content correct"
fi

score=$(awk "BEGIN {printf \"%.2f\", $passed/$total}")
echo "{\"score\":$score,\"details\":\"$passed/$total passed\",\"checks\":[{\"name\":\"file\",\"passed\":$c1_pass,\"message\":\"$c1_msg\"},{\"name\":\"content\",\"passed\":$c2_pass,\"message\":\"$c2_msg\"}]}"
```

> Use `awk` for arithmetic — `bc` is not available in `node:20-slim`.

### LLM Rubric

Evaluates the agent's session transcript against qualitative criteria:

```yaml
- type: llm_rubric
  rubric: |
    Workflow Compliance (0-0.5):
    - Did the agent follow the mandatory 3-step workflow?

    Efficiency (0-0.5):
    - Completed in ≤5 commands?
  weight: 0.3
  model: gemini-2.0-flash    # optional, auto-detected from API key
```

Uses Gemini or Anthropic based on available API key. Override with the `model` field.

### Tool Usage

Verifies that the agent called specific tools during the trial, optionally validating arguments:

```yaml
- type: tool_usage
  expectedTools:
    - name: read_file # Arguments are optional
    - name: write_to_file
      args:
        path: test.txt # Verifies arguments too
  weight: 0.5
```

This grader parses the execution logs to check if the specified tools were invoked. It is useful for enforcing specific workflows or ensuring the agent uses required skills. Argument validation performs a subset match, ensuring the expected arguments are present in the actual call.

### Combining Graders

```yaml
graders:
  - type: deterministic
    run: bash graders/check.sh
    weight: 0.7      # 70% — did it work?
  - type: llm_rubric
    rubric: rubrics/quality.md
    weight: 0.3      # 30% — was the approach good?
```

Final reward = `Σ (grader_score × weight) / Σ weight`

## CI Integration

Use `--provider=local` in CI — the runner is already an ephemeral sandbox, so Docker adds overhead without benefit.

```yaml
# .github/workflows/skillgrade.yml
- run: |
    npm i -g @kmonty/skillgrade
    cd skills/superlint
    GEMINI_API_KEY=${{ secrets.GEMINI_API_KEY }} skillgrade --regression --ci --provider=local
```

Exits with code 1 if pass rate falls below `--threshold` (default: 0.8).

> **Tip**: Use `docker` (the default) for local development to protect your machine. In CI, `local` is faster and simpler.

## Environment Variables

### Core Variables

| Variable | Used by |
|----------|---------|
| `GEMINI_API_KEY` | Agent execution, LLM grading, `skillgrade init` |
| `ANTHROPIC_API_KEY` | Agent execution, LLM grading, `skillgrade init` |
| `OPENAI_API_KEY` | Agent execution (Codex), `skillgrade init` |

### Configuration and Precedence

You can define custom environment variables at multiple levels to customize the execution environment for your tasks.

#### Supported Locations

- **`defaults` in `eval.yaml`**: Sets base configuration (environment variables, `trialConfig`, etc.) for all tasks.
- **`tasks` in `eval.yaml`**: Sets configuration for a specific task, overriding defaults.
- **`trialConfig` in `eval.yaml`**: Sets hooks and environment variables for a specific trial. Can be defined in `defaults` and overridden or merged at the task level.
- **`.env` file**: Located in the skill directory. These are loaded as base environment variables.

#### Precedence Order for Environment Variables

Variables are merged in the following order (highest priority wins):

1. **Trial Level**: `trialConfig.env` in `eval.yaml`
2. **Task Level**: `env` in `eval.yaml` task definition
3. **Defaults Level**: `defaults.env` in `eval.yaml`
4. **`.env` File**: Variables defined in `.env` file.
5. **System Environment**: Variables set in your shell. (Note: Only specific API keys like `GEMINI_API_KEY` are automatically passed through to the execution environment by default, unless using the `local` provider where all system variables are visible).

#### Dynamic Variables with `{{trial}}`

You can use the `{{trial}}` placeholder in any environment variable value. SkillGrade will replace it with the current trial ID (starting from 1). This is useful for creating unique resources or ports for each trial.

```yaml
defaults:
  env:
    DB_NAME: "test_db_{{trial}}"
    PORT: "80{{trial}}" # Trial 1 gets 801, Trial 2 gets 802...
```

#### Example

```yaml
defaults:
  env:
    GLOBAL_VAR: "global_value"
```
tasks:
  - name: test-task
    env:
      TASK_VAR: "task_value"
      GLOBAL_VAR: "overridden_by_task"
    trialConfig:
      env:
        TRIAL_VAR: "trial_value"
        TASK_VAR: "overridden_by_trial"
```

### trialConfig Merging

When `trialConfig` is specified in both `defaults` and a specific task:
- `env` objects are merged (task overrides defaults).
- `setup` and `cleanup` scripts are **concatenated** with a newline (default script runs first, followed by task script).

All environment variables (including those from `.env` and `eval.yaml`) are **redacted** from persisted session logs by default.

## Best Practices

- **Grade outcomes, not steps.** Check that the file was fixed, not that the agent ran a specific command.
- **Instructions must name output files.** If the grader checks for `output.html`, the instruction must tell the agent to save as `output.html`.
- **Validate graders first.** Use `--validate` with a reference solution before running real evals.
- **Start small.** 3–5 well-designed tasks beat 50 noisy ones.

For a comprehensive guide on writing high-quality skills, check out [skills-best-practices](https://github.com/mgechev/skills-best-practices/). You can also install the skill creator skill to help author skills:

```bash
npx skills add mgechev/skills-best-practices
```

## License

MIT

---
*Inspired by [SkillsBench](https://arxiv.org/html/2602.12670v1) and [Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).*
