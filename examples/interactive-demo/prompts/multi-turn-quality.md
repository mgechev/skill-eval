# Multi-Turn Interaction Quality Rubric

Evaluate the agent's performance in this multi-turn interactive session.

## Scoring Criteria

### Handling of User Requests (0.3 weight)
- **1.0**: Agent correctly understood and responded to all user inputs and confirmations
- **0.7**: Agent mostly understood user inputs with minor misunderstandings
- **0.4**: Agent had difficulty understanding several user inputs
- **0.0**: Agent failed to understand or respond to user inputs

### Adaptation to Feedback (0.3 weight)
- **1.0**: Agent effectively adapted its approach based on injected feedback
- **0.7**: Agent acknowledged feedback but adaptation was incomplete
- **0.4**: Agent ignored or misinterpreted feedback
- **0.0**: Agent showed no adaptation to feedback

### Problem Resolution (0.4 weight)
- **1.0**: Problem was fully resolved with all tests passing
- **0.7**: Problem mostly resolved with minor issues remaining
- **0.4**: Problem partially resolved but major issues remain
- **0.0**: Problem not resolved or made worse

## Final Score

Calculate the weighted average of the three criteria above.
