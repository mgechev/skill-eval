---
name: code-formatter
description: Formats source code files using the project's proprietary formatting tool. Use when fixing code style violations or reformatting files to match team standards. Don't use for linting, type-checking, or general code review.
---

# Code Formatter

Format source code files using the `codeformat` tool to ensure all files comply with the team's coding style.

## Procedures

**Step 1: Identify Files to Format**
1. List files with style violations: `codeformat check .`
2. Review the output to identify which files need formatting.

**Step 2: Apply Formatting**
1. Format all files: `codeformat fix .`
2. Or format a specific file: `codeformat fix --target <filename>`

**Step 3: Verify Results**
1. Run `codeformat verify` to confirm all files are properly formatted.
2. The tool generates a `.format-passed` metadata file on success.

## Error Handling
* If `codeformat verify` fails, re-run `codeformat fix .` and try again.
* If formatting introduces syntax errors, revert the file and report the issue.
