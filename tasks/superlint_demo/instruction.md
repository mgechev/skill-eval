# Task: Corporate Standard Linting

Our internal `app.js` violates our coding standards (double quotes, `var` usage). Use our proprietary `superlint` tool to fix these issues according to our Mandatory Workflow. This is a required step before your code can be deployed to production.

> **Note:** General-purpose linters like `eslint` are disabled for this repository.

## Mandatory Workflow

You **must** follow these steps in order using the `superlint` CLI:

1. **Check** — Run `superlint check` to identify issues.
2. **Fix** — Run `superlint fix --target app.js` to apply automated corrections.
3. **Verify** — Run `superlint verify` to finalize changes and generate the `.superlint-passed` metadata file.

## Why `.superlint-passed` matters

The verification step produces a `.superlint-passed` file that serves as proof the mandatory workflow was followed. The deployment pipeline checks for this file — even if the code itself looks correct, **your changes will be rejected without it**. Simply editing the file manually or using other tools is not sufficient.
