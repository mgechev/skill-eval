---
name: skillgrade-setup
description: Sets up and runs skillgrade evaluation pipelines for Agent Skills. Use when initializing eval configurations, running trials, reviewing results, or integrating with CI. Don't use for writing grader scripts, general test authoring, or non-agentic documentation.
---

# Skillgrade Evaluation Setup

## Procedures

**Step 1: Install Skillgrade**
1. Verify Node.js 20+ and Docker are available.
2. Run `npm i -g skillgrade` to install the CLI globally.

**Step 2: Initialize an Eval Configuration**
1. Navigate to the skill directory (must contain a `SKILL.md`).
2. Set the appropriate API key environment variable (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY`).
3. Run `skillgrade init` to generate an `eval.yaml` with AI-powered tasks and graders.
4. If an `eval.yaml` already exists, pass `--force` to overwrite: `skillgrade init --force`.
5. Without an API key, a well-commented template is generated instead.

**Step 3: Configure eval.yaml**
1. Read `references/eval-yaml-spec.md` for the full configuration schema.
2. Define one or more tasks under the `tasks:` key. Each task requires:
   - `name`: unique task identifier
   - `instruction`: what the agent should accomplish
   - `workspace`: files to copy into the evaluation container
   - `graders`: one or more scoring mechanisms (see the `skillgrade-graders` skill)
3. Optionally configure `defaults:` for agent, provider, trials, timeout, and threshold.

**Step 4: Run Evaluations**
1. Select an appropriate preset based on the evaluation goal:
   - `--smoke` (5 trials): Quick capability check.
   - `--reliable` (15 trials): Reliable pass rate estimate.
   - `--regression` (30 trials): High-confidence regression detection.
2. Run the evaluation: `skillgrade --smoke`.
3. Run a specific eval by name: `skillgrade --eval=fix-linting`.
4. Run multiple evals: `skillgrade --eval=fix-linting,write-tests`.
5. Run only deterministic graders (skip LLM calls): `skillgrade --grader=deterministic`.
6. Run only LLM rubric graders: `skillgrade --grader=llm_rubric`.
7. The agent is auto-detected from the API key. Override with `--agent=gemini|claude|codex`.
8. Override the provider with `--provider=docker|local`.

**Step 5: Review Results**
1. Run `skillgrade preview` for a CLI report.
2. Run `skillgrade preview browser` to open the web UI at `http://localhost:3847`.
3. Reports are saved to `$TMPDIR/skillgrade/<skill-name>/results/`. Override with `--output=DIR`.

**Step 6: Integrate with CI**
1. Add a GitHub Actions step that installs skillgrade, navigates to the skill directory, and runs with `--regression --ci --provider=local`.
2. Use `--provider=local` in CI — the runner is already an ephemeral sandbox, so Docker adds overhead without benefit.
3. The `--ci` flag causes a non-zero exit code if the pass rate falls below `--threshold` (default: 0.8).
4. Read `references/ci-example.md` for a complete workflow template.

## Error Handling
* If `skillgrade init` fails with "No SKILL.md found," verify the current directory contains a valid `SKILL.md` file.
* If evaluation hangs, check Docker is running and the container has network access for API calls.
* If all trials fail with "No API key," ensure the environment variable is exported, not just set inline for a different command.
