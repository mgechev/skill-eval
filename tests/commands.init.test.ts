import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithLLM } from '../src/commands/init';

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

describe('generateWithLLM — Anthropic', () => {
  const skills = [{ name: 'my-skill', skillMd: '# My Skill\n\nDoes a thing.' }];
  const savedEnv = { ...process.env };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Pin the model so resolveAnthropicModel short-circuits instead of hitting /v1/models.
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-5';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...savedEnv };
  });

  // Stub fetch, capturing the request URL and parsed body for assertions.
  function stubFetch() {
    const captured: { url?: string; body?: any } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      captured.url = url;
      captured.body = JSON.parse(opts.body);
      return {
        ok: true,
        json: () => Promise.resolve({ content: [{ type: 'text', text: 'version: "1"\n' }] }),
      };
    }) as any;
    return captured;
  }

  it('reads the text block past a leading thinking block', async () => {
    // Adaptive thinking is on by default on current Claude models, so the API
    // prepends a thinking block and content[0] is not the text block.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: '```yaml\nversion: "1"\ntasks: []\n```' },
        ],
      }),
    }) as any;

    const result = await generateWithLLM(skills, 'test-key', 'anthropic');

    expect(result).toContain('version: "1"');
    expect(result).not.toContain('```');
  });

  it('does not send a temperature parameter (rejected by current Claude models)', async () => {
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'anthropic');
    expect(captured.body).not.toHaveProperty('temperature');
  });

  it('posts to the default messages endpoint', async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'anthropic');
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('honors ANTHROPIC_BASE_URL for parity with the grader', async () => {
    process.env.ANTHROPIC_BASE_URL = 'http://localhost:8080/v1/';
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'anthropic');
    expect(captured.url).toBe('http://localhost:8080/v1/messages');
  });

  it('ignores an empty ANTHROPIC_BASE_URL rather than treating it as an override', async () => {
    process.env.ANTHROPIC_BASE_URL = '   ';
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'anthropic');
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('generateWithLLM — OpenAI', () => {
  const skills = [{ name: 'my-skill', skillMd: '# My Skill\n\nDoes a thing.' }];
  const savedEnv = { ...process.env };
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.OPENAI_MODEL = 'gpt-5-mini';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...savedEnv };
  });

  function stubFetch() {
    const captured: { url?: string } = {};
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      captured.url = url;
      return {
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: 'version: "1"\n' } }] }),
      };
    }) as any;
    return captured;
  }

  it('posts to the default chat/completions endpoint', async () => {
    delete process.env.OPENAI_BASE_URL;
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'openai');
    expect(captured.url).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('honors OPENAI_BASE_URL so init works against Ollama/vLLM', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    const captured = stubFetch();
    await generateWithLLM(skills, 'test-key', 'openai');
    expect(captured.url).toBe('http://localhost:11434/v1/chat/completions');
  });
});
