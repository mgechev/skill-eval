# Angular Signals Example

An advanced example showing how to evaluate a skill that requires static analysis grading.

## Structure

```
angular-signals/
├── SKILL.md                           # Angular modern APIs skill
├── eval.yaml                          # Eval configuration
├── fixtures/
│   └── src/app/
│       └── user-profile.component.ts  # Legacy component to modernize
└── graders/
    └── check-modern-apis.ts           # TypeScript static analysis grader
```

## What's tested

The agent must modernize an Angular component from legacy APIs to modern ones:

| Check | Legacy | Modern |
|-------|--------|--------|
| Inputs | `@Input()` | `input()` / `input.required()` |
| Outputs | `@Output()` + EventEmitter | `output()` |
| DI | Constructor injection | `inject()` |
| Control flow | `*ngIf` / `*ngFor` | `@if` / `@for` |
| Imports | CommonModule | Not needed |

## Graders

- **Deterministic (70%)** — TypeScript grader that reads the component source and uses regex-based static analysis to check 5 patterns. Each check contributes 0.2 to the score, enabling partial credit.
- **LLM Rubric (30%)** — Evaluates correctness, completeness, and code quality.

The deterministic grader uses the `setup` field to install TypeScript and ts-node during image build:

```yaml
graders:
  - type: deterministic
    setup: npm install typescript ts-node @types/node
    run: npx ts-node graders/check-modern-apis.ts
    weight: 0.7
```

## Run

```bash
GEMINI_API_KEY=your-key skilleval --smoke
```
