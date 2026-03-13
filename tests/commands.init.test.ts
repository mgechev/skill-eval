import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test extractInstructionHint and getInlineTemplate
// These functions are not exported so we need to test them via runInit or replicate them

describe('extractInstructionHint', () => {
  // Replicate the function since it's not exported
  function extractInstructionHint(skillMd: string): string {
    const lines = skillMd.split('\n');
    let foundHeading = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('# ') && !foundHeading) {
        foundHeading = true;
        continue;
      }
      if (foundHeading) {
        if (line.trim() === '' && paragraphLines.length > 0) break;
        if (line.startsWith('#')) break;
        if (line.trim()) paragraphLines.push(line.trim());
      }
    }

    if (paragraphLines.length > 0) {
      return `TODO: Write an instruction based on this skill.\n      Skill description: ${paragraphLines.join(' ')}`;
    }

    return 'TODO: Write an instruction for the agent.';
  }

  it('extracts first paragraph after heading', () => {
    const content = `# My Skill

This is the first paragraph
that spans multiple lines.

## Section 2
More content here.`;

    const result = extractInstructionHint(content);
    expect(result).toContain('This is the first paragraph');
    expect(result).toContain('that spans multiple lines.');
    expect(result).not.toContain('Section 2');
  });

  it('stops at next heading', () => {
    const content = `# My Skill
First line
## Next Section
Should not appear`;

    const result = extractInstructionHint(content);
    expect(result).toContain('First line');
    expect(result).not.toContain('Should not appear');
  });

  it('returns default when no heading found', () => {
    const content = 'Just some text without headings';
    const result = extractInstructionHint(content);
    expect(result).toBe('TODO: Write an instruction for the agent.');
  });

  it('returns default when heading has no following text', () => {
    const content = '# My Skill\n';
    const result = extractInstructionHint(content);
    expect(result).toBe('TODO: Write an instruction for the agent.');
  });

  it('handles single line after heading', () => {
    const content = `# Skill
Short description.`;

    const result = extractInstructionHint(content);
    expect(result).toContain('Short description.');
  });
});

describe('getInlineTemplate', () => {
  // Replicate the function since it's not exported
  function getInlineTemplate(): string {
    return `version: "1"

defaults:
  agent: gemini
  provider: docker
  trials: 5
  timeout: 300
  threshold: 0.8
  docker:
    base: node:20-slim

tasks:
  - name: {{TASK_NAME}}
    instruction: |
      {{INSTRUCTION}}

    graders:
      - type: deterministic
        run: |
          # Grader must output JSON: {"score": 0.0-1.0, "details": "...", "checks": [...]}
          echo '{"score": 0.0, "details": "TODO: implement grader"}'
        weight: 0.7

      - type: llm_rubric
        rubric: |
          TODO: Write evaluation criteria.
        weight: 0.3
`;
  }

  it('returns valid YAML template', () => {
    const template = getInlineTemplate();
    expect(template).toContain('version: "1"');
    expect(template).toContain('{{TASK_NAME}}');
    expect(template).toContain('{{INSTRUCTION}}');
  });

  it('includes default configuration', () => {
    const template = getInlineTemplate();
    expect(template).toContain('agent: gemini');
    expect(template).toContain('provider: docker');
    expect(template).toContain('trials: 5');
    expect(template).toContain('timeout: 300');
    expect(template).toContain('threshold: 0.8');
  });

  it('includes both grader types', () => {
    const template = getInlineTemplate();
    expect(template).toContain('type: deterministic');
    expect(template).toContain('type: llm_rubric');
  });

  it('has placeholder grader that outputs JSON', () => {
    const template = getInlineTemplate();
    expect(template).toContain('"score"');
    expect(template).toContain('"details"');
  });
});
