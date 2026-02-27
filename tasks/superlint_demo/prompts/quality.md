# Code Quality Rubric for SuperLint Task

Evaluate the agent's approach on these dimensions:

## Workflow Compliance (0–0.4)
- Did the agent follow the mandatory 3-step workflow (check → fix → verify)?
- Did the agent run `superlint check` before attempting fixes?
- Did the agent use `superlint fix --target app.js` (not manual edits)?
- Did the agent run `superlint verify` as the final step?

## Tool Discovery (0–0.3)
- Did the agent discover and read the skill documentation?
- Did the agent explore available commands before acting?
- Did the agent avoid using tools not specified in the instructions (e.g., eslint)?

## Efficiency (0–0.3)
- Was the task completed in a reasonable number of commands?
- Did the agent avoid unnecessary trial-and-error?
- Did the agent avoid redundant operations?
