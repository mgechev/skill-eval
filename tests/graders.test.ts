import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeterministicGrader, LLMGrader, getGrader } from '../src/graders/index';
import { GraderConfig, EnvironmentProvider } from '../src/types';

// Mock fs-extra for LLMGrader rubric loading
vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readFile: vi.fn(),
}));

import * as fs from 'fs-extra';

const mockPathExists = vi.mocked(fs.pathExists);
const mockReadFile = vi.mocked(fs.readFile);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeProvider(stdout: string, stderr = '', exitCode = 0): EnvironmentProvider {
  return {
    setup: vi.fn(),
    cleanup: vi.fn(),
    runCommand: vi.fn().mockResolvedValue({ stdout, stderr, exitCode }),
  };
}

describe('DeterministicGrader', () => {
  const grader = new DeterministicGrader();
  const baseConfig: GraderConfig = { type: 'deterministic', weight: 1.0 };

  it('parses valid JSON from stdout', async () => {
    const provider = makeProvider('{"score": 0.8, "details": "good job"}');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.grader_type).toBe('deterministic');
    expect(result.score).toBe(0.8);
    expect(result.weight).toBe(1.0);
    expect(result.details).toBe('good job');
  });

  it('handles JSON with checks array', async () => {
    const json = JSON.stringify({
      score: 0.5,
      details: '1/2 passed',
      checks: [
        { name: 'check1', passed: true, message: 'ok' },
        { name: 'check2', passed: false, message: 'failed' },
      ],
    });
    const provider = makeProvider(json);
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0.5);
    expect(result.details).toContain('1/2 passed');
    expect(result.details).toContain('✓ check1');
    expect(result.details).toContain('✗ check2');
  });

  it('returns score 0 when no JSON in stdout', async () => {
    const provider = makeProvider('no json here');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0);
    expect(result.details).toContain('did not output JSON');
  });

  it('returns score 0 when stdout is empty', async () => {
    const provider = makeProvider('', 'some error');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0);
    expect(result.details).toContain('(empty)');
  });

  it('clamps score to [0, 1]', async () => {
    const provider = makeProvider('{"score": 2.5, "details": "over"}');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);
    expect(result.score).toBe(1.0);
  });

  it('clamps negative score to 0', async () => {
    const provider = makeProvider('{"score": -0.5, "details": "under"}');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);
    expect(result.score).toBe(0);
  });

  it('handles invalid JSON gracefully', async () => {
    const provider = makeProvider('{ invalid json }');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0);
    expect(result.details).toContain('Failed to parse grader JSON');
  });

  it('uses custom command when provided', async () => {
    const provider = makeProvider('{"score": 1.0, "details": "pass"}');
    const config: GraderConfig = { type: 'deterministic', command: 'node test.js', weight: 1.0 };
    await grader.grade('/workspace', provider, config, '/task', []);

    expect(provider.runCommand).toHaveBeenCalledWith('/workspace', 'node test.js', undefined);
  });

  it('uses default command bash tests/test.sh when command not set', async () => {
    const provider = makeProvider('{"score": 1.0, "details": "pass"}');
    await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(provider.runCommand).toHaveBeenCalledWith('/workspace', 'bash tests/test.sh', undefined);
  });

  it('generates default details from score when details not in JSON', async () => {
    const provider = makeProvider('{"score": 0.75}');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0.75);
    expect(result.details).toContain('0.75');
  });

  it('handles NaN score as 0', async () => {
    const provider = makeProvider('{"score": "not-a-number", "details": "bad"}');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);
    expect(result.score).toBe(0);
  });

  it('passes env to provider.runCommand', async () => {
    const provider = makeProvider('{"score": 1.0, "details": "ok"}');
    const env = { FOO: 'bar' };
    await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

    expect(provider.runCommand).toHaveBeenCalledWith('/workspace', 'bash tests/test.sh', env);
  });
});

describe('LLMGrader', () => {
  const grader = new LLMGrader();
  const baseConfig: GraderConfig = { type: 'llm_rubric', rubric: 'rubric.md', weight: 1.0, model: 'mock-model' };

  it('returns score 0 when rubric file not found', async () => {
    mockPathExists.mockResolvedValue(false as any);
    const provider = makeProvider('');
    const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);

    expect(result.score).toBe(0);
    expect(result.details).toContain('Rubric file not found');
  });

  it('returns score 0 when no API key for default provider (gemini)', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('Evaluate the code quality.' as any);
    const provider = makeProvider('');

    // Remove env vars
    const origGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', []);
      expect(result.score).toBe(0);
      expect(result.details).toContain('GEMINI_API_KEY');
    } finally {
      if (origGemini) process.env.GEMINI_API_KEY = origGemini;
    }
  });

  it('returns score 0 when explicit provider has no API key', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('Evaluate the code quality.' as any);
    const provider = makeProvider('');

    const origAnthropic = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const config: GraderConfig = { type: 'llm_rubric', rubric: 'rubric.md', weight: 1.0, provider: 'anthropic' };
      const result = await grader.grade('/workspace', provider, config, '/task', []);
      expect(result.score).toBe(0);
      expect(result.details).toContain('ANTHROPIC_API_KEY');
    } finally {
      if (origAnthropic) process.env.ANTHROPIC_API_KEY = origAnthropic;
    }
  });

  it('uses default rubric path when not specified', async () => {
    mockPathExists.mockResolvedValue(false as any);
    const provider = makeProvider('');
    const config: GraderConfig = { type: 'llm_rubric', weight: 1.0 };

    const result = await grader.grade('/workspace', provider, config, '/task', []);
    expect(result.details).toContain('prompts/quality.md');
  });

  it('returns score 0 for unknown provider name', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('rubric content' as any);

    const provider = makeProvider('');
    const config: GraderConfig = { type: 'llm_rubric', rubric: 'rubric.md', weight: 1.0, provider: 'unknown' as any };
    const result = await grader.grade('/workspace', provider, config, '/task', []);

    expect(result.score).toBe(0);
    expect(result.details).toContain('Unknown grader provider');
  });

  describe('gemini provider', () => {
    it('parses valid JSON from LLM response', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ text: '{"score": 0.9, "reasoning": "Great work"}' }],
            },
          }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0.9);
      expect(result.details).toBe('Great work');

      globalThis.fetch = originalFetch;
    });

    it('handles markdown-wrapped JSON in LLM response', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ text: '```json\n{"score": 0.7, "reasoning": "decent"}\n```' }],
            },
          }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0.7);

      globalThis.fetch = originalFetch;
    });

    it('handles empty LLM response', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '' }] } }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0);
      expect(result.details).toContain('Failed to parse');

      globalThis.fetch = originalFetch;
    });

    it('handles fetch error gracefully', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0);
      expect(result.details).toContain('Gemini API error');

      globalThis.fetch = originalFetch;
    });

    it('handles truncated JSON missing closing braces in LLM response', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ text: '```json\n{"score": 0.45, "reasoning": "some reasonin\n}\n```' }],
            },
          }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0.45);
      expect(result.details).toContain('some reasonin\n}... (response truncated)');

      globalThis.fetch = originalFetch;
    });

    it('extracts score from malformed plain text LLM response', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          candidates: [{
            content: {
              parts: [{ text: 'Score: 0.85\n\nThis is a good attempt.' }],
            },
          }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { GEMINI_API_KEY: 'test-key' };
      const result = await grader.grade('/workspace', provider, baseConfig, '/task', [], env);

      expect(result.score).toBe(0.85);
      expect(result.details).toContain('Score extracted from malformed LLM response');

      globalThis.fetch = originalFetch;
    });
  });

  describe('anthropic provider', () => {
    it('calls Anthropic API when provider is anthropic', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '{"score": 0.85, "reasoning": "good"}' }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { ANTHROPIC_API_KEY: 'test-key' };
      const config: GraderConfig = { ...baseConfig, provider: 'anthropic' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.85);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
        })
      );

      globalThis.fetch = originalFetch;
    });

    it('respects ANTHROPIC_BASE_URL env var', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: [{ type: 'text', text: '{"score": 0.9, "reasoning": "custom endpoint"}' }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://localhost:8080/v1' };
      const config: GraderConfig = { ...baseConfig, provider: 'anthropic' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.9);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:8080/v1/messages',
        expect.anything()
      );

      globalThis.fetch = originalFetch;
    });

    it('reads the text block past a leading thinking block', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      // Adaptive thinking is on by default on current Claude models, so the API
      // prepends a thinking block and content[0] is not the text block.
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: '{"score": 0.75, "reasoning": "solid"}' },
          ],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { ANTHROPIC_API_KEY: 'test-key' };
      const config: GraderConfig = { ...baseConfig, provider: 'anthropic' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.75);

      globalThis.fetch = originalFetch;
    });
  });

  describe('HTTP error surfacing', () => {
    // A non-2xx used to fall through to an empty completion and get reported as a
    // score-0 "Failed to parse" — making a dead API key look like a failing eval.
    const cases: Array<{ provider: 'gemini' | 'anthropic' | 'openai'; label: string; key: string }> = [
      { provider: 'gemini', label: 'Gemini', key: 'GEMINI_API_KEY' },
      { provider: 'anthropic', label: 'Anthropic', key: 'ANTHROPIC_API_KEY' },
      { provider: 'openai', label: 'OpenAI', key: 'OPENAI_API_KEY' },
    ];

    for (const { provider, label, key } of cases) {
      it(`reports the HTTP status when the ${label} API returns a non-2xx`, async () => {
        mockPathExists.mockResolvedValue(true as any);
        mockReadFile.mockResolvedValue('rubric content' as any);

        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: () => Promise.resolve('{"error":{"message":"invalid x-api-key"}}'),
          json: () => Promise.resolve({}),
        } as any);

        const env = { [key]: 'bad-key' };
        const config: GraderConfig = { ...baseConfig, provider };
        const result = await grader.grade('/workspace', makeProvider(''), config, '/task', [], env);

        expect(result.score).toBe(0);
        expect(result.details).toContain('HTTP 401');
        expect(result.details).toContain(label);
        expect(result.details).toContain('invalid x-api-key');
        // The old, misleading failure mode must be gone.
        expect(result.details).not.toContain('Failed to parse');

        globalThis.fetch = originalFetch;
      });
    }
  });

  describe('openai provider', () => {
    it('calls OpenAI API when provider is openai', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"score": 0.75, "reasoning": "solid"}' } }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { OPENAI_API_KEY: 'test-key' };
      const config: GraderConfig = { ...baseConfig, provider: 'openai' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.75);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Authorization': 'Bearer test-key' }),
        })
      );

      globalThis.fetch = originalFetch;
    });

    it('respects OPENAI_BASE_URL env var', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"score": 0.8, "reasoning": "nice"}' } }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://localhost:11434/v1' };
      const config: GraderConfig = { ...baseConfig, provider: 'openai' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.8);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/chat/completions',
        expect.anything()
      );

      globalThis.fetch = originalFetch;
    });
  });

  it('builds transcript with instruction, commands, agent output, and prior graders', async () => {
    mockPathExists.mockResolvedValue(true as any);
    mockReadFile.mockResolvedValue('rubric' as any);

    const originalFetch = globalThis.fetch;
    let capturedBody: any;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: () => Promise.resolve({
          candidates: [{ content: { parts: [{ text: '{"score": 1.0, "reasoning": "ok"}' }] } }],
        }),
      };
    });

    const provider = makeProvider('');
    const sessionLog = [
      { type: 'agent_start', instruction: 'Do something', timestamp: '' },
      { type: 'command', command: 'ls', stdout: 'file.txt', stderr: '', exitCode: 0, timestamp: '' },
      { type: 'agent_result', output: 'Done!', timestamp: '' },
      { type: 'grader', grader_result: { grader_type: 'deterministic', score: 1.0, weight: 1, details: 'passed' }, timestamp: '' },
    ];

    const env = { GEMINI_API_KEY: 'test-key' };
    await grader.grade('/workspace', provider, baseConfig, '/task', sessionLog, env);

    const prompt = capturedBody.contents[0].parts[0].text;
    expect(prompt).toContain('Do something');
    expect(prompt).toContain('$ ls');
    expect(prompt).toContain('Done!');
    expect(prompt).toContain('deterministic');

      globalThis.fetch = originalFetch;
    });

    it('falls back to reasoning_content when content is empty', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '', reasoning_content: '{"score": 0.6, "reasoning": "via reasoning"}' } }],
        }),
      } as any);

      const provider = makeProvider('');
      const env = { OPENAI_API_KEY: 'test-key' };
      const config: GraderConfig = { ...baseConfig, provider: 'openai' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0.6);
      expect(result.details).toBe('via reasoning');

      globalThis.fetch = originalFetch;
    });

    it('includes raw response data in error when parsing fails', async () => {
      mockPathExists.mockResolvedValue(true as any);
      mockReadFile.mockResolvedValue('rubric content' as any);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: {} }],
          model: 'deepseek-reasoning',
        }),
      } as any);

      const provider = makeProvider('');
      const env = { OPENAI_API_KEY: 'test-key', OPENAI_BASE_URL: 'http://localhost:11434/v1' };
      const config: GraderConfig = { ...baseConfig, provider: 'openai' };
      const result = await grader.grade('/workspace', provider, config, '/task', [], env);

      expect(result.score).toBe(0);
      expect(result.details).toContain('Failed to parse LLM response');
      expect(result.details).toContain('deepseek-reasoning');

      globalThis.fetch = originalFetch;
    });
  });

describe('getGrader', () => {
  it('returns DeterministicGrader for "deterministic"', () => {
    const grader = getGrader('deterministic');
    expect(grader).toBeInstanceOf(DeterministicGrader);
  });

  it('returns LLMGrader for "llm_rubric"', () => {
    const grader = getGrader('llm_rubric');
    expect(grader).toBeInstanceOf(LLMGrader);
  });

  it('throws for unknown grader type', () => {
    expect(() => getGrader('unknown')).toThrow('Unknown grader type');
  });
});
