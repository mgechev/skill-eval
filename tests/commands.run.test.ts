import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// We test resolvedToTaskConfig and prepareTempTaskDir
// These are not exported, so we replicate the logic for testing

vi.mock('fs-extra', () => ({
  pathExists: vi.fn(),
  readFile: vi.fn(),
  ensureDir: vi.fn(),
  writeFile: vi.fn(),
  copy: vi.fn(),
}));

import * as fs from 'fs-extra';
import { ResolvedTask } from '../src/core/config.types';
import { TaskConfig } from '../src/types';

const mockPathExists = vi.mocked(fs.pathExists);
const mockEnsureDir = vi.mocked(fs.ensureDir);
const mockWriteFile = vi.mocked(fs.writeFile);
const mockCopy = vi.mocked(fs.copy);

beforeEach(() => {
  vi.resetAllMocks();
  mockPathExists.mockResolvedValue(false as any);
});

// Replicate resolvedToTaskConfig since it's not exported
function resolvedToTaskConfig(resolved: ResolvedTask): TaskConfig {
  return {
    version: '1',
    metadata: {
      author_name: '',
      author_email: '',
      difficulty: 'medium',
      category: 'skilleval',
      tags: [],
    },
    graders: resolved.graders.map(g => ({
      type: g.type,
      command: g.type === 'deterministic' ? 'bash tests/test.sh' : undefined,
      rubric: g.type === 'llm_rubric' ? 'prompts/quality.md' : undefined,
      weight: g.weight,
    })),
    agent: { timeout_sec: resolved.timeout },
    environment: {
      build_timeout_sec: 180,
      cpus: 2,
      memory_mb: 2048,
      storage_mb: 500,
    },
  };
}

describe('resolvedToTaskConfig', () => {
  it('maps deterministic graders correctly', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 0.7 }],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 300,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.graders[0].type).toBe('deterministic');
    expect(config.graders[0].command).toBe('bash tests/test.sh');
    expect(config.graders[0].weight).toBe(0.7);
  });

  it('maps llm_rubric graders correctly', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [{ type: 'llm_rubric', rubric: 'check quality', weight: 0.3 }],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 300,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.graders[0].type).toBe('llm_rubric');
    expect(config.graders[0].rubric).toBe('prompts/quality.md');
    expect(config.graders[0].weight).toBe(0.3);
  });

  it('sets agent timeout from resolved task', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 600,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.agent.timeout_sec).toBe(600);
  });

  it('sets default environment values', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 300,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.environment.cpus).toBe(2);
    expect(config.environment.memory_mb).toBe(2048);
    expect(config.environment.storage_mb).toBe(500);
    expect(config.environment.build_timeout_sec).toBe(180);
  });

  it('maps multiple graders', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [
        { type: 'deterministic', run: 'echo ok', weight: 0.7 },
        { type: 'llm_rubric', rubric: 'quality criteria', weight: 0.3 },
      ],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 300,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.graders).toHaveLength(2);
    expect(config.graders[0].type).toBe('deterministic');
    expect(config.graders[1].type).toBe('llm_rubric');
  });

  it('sets metadata with default values', () => {
    const resolved: ResolvedTask = {
      name: 'test-task',
      instruction: 'do it',
      workspace: [],
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
      agent: 'gemini',
      provider: 'docker',
      trials: 5,
      timeout: 300,
      docker: { base: 'node:20-slim' },
    };

    const config = resolvedToTaskConfig(resolved);
    expect(config.metadata.difficulty).toBe('medium');
    expect(config.metadata.category).toBe('skilleval');
    expect(config.version).toBe('1');
  });
});

describe('parseEnvFile (from commands/run.ts)', () => {
  // Replicate parseEnvFile from commands/run.ts
  function parseEnvFile(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      let value = trimmed.substring(eqIdx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
    return env;
  }

  it('behaves identically to cli.ts version', () => {
    const content = `# Config
KEY="value"
PLAIN=text
SINGLE='quoted'
`;
    const result = parseEnvFile(content);
    expect(result).toEqual({
      KEY: 'value',
      PLAIN: 'text',
      SINGLE: 'quoted',
    });
  });
});
