# Superlint Example

A simple example showing how to evaluate a coding standards skill.

## Structure

```
superlint/
├── SKILL.md            # The skill being tested
├── eval.yaml           # Eval configuration
├── fixtures/
│   └── app.js          # Broken file the agent needs to fix
└── bin/
    └── superlint       # Custom tool the agent must use
```

## What's tested

The agent must discover the `superlint` skill from SKILL.md and follow a
mandatory 3-step workflow (check → fix → verify) to fix coding standard
violations in `app.js`.

## Graders

- **Deterministic** (70%) — checks that `.superlint-passed` exists and the code was corrected
- **LLM Rubric** (30%) — evaluates workflow compliance and efficiency

## Run

```bash
GEMINI_API_KEY=your-key skilleval --smoke
```
