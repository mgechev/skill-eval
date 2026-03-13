import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock dependencies
vi.mock('fs-extra', () => ({
  readFile: vi.fn(),
  ensureDir: vi.fn(),
  writeJSON: vi.fn(),
}));

vi.mock('toml', () => ({
  parse: vi.fn(),
}));

vi.mock('./graders', () => ({
  getGrader: vi.fn(),
}));

import * as fs from 'fs-extra';
import * as toml from 'toml';
import { loadTaskConfig, EvalRunner } from '../src/evalRunner';
import { BaseAgent, EnvironmentProvider, CommandResult, GraderResult } from '../src/types';

const mockReadFile = vi.mocked(fs.readFile);
const mockEnsureDir = vi.mocked(fs.ensureDir);
const mockWriteJSON = vi.mocked(fs.writeJSON);
const mockTomlParse = vi.mocked(toml.parse);

beforeEach(() => {
  vi.resetAllMocks();
  // Suppress console output during tests
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('loadTaskConfig', () => {
  it('loads and parses task.toml', async () => {
    const config = {
      version: '1.0',
      graders: [{ type: 'deterministic', command: 'bash tests/test.sh', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048 },
    };

    mockReadFile.mockResolvedValue('content' as any);
    mockTomlParse.mockReturnValue(config);

    const result = await loadTaskConfig('/task');
    expect(result.graders).toHaveLength(1);
    expect(result.graders[0].type).toBe('deterministic');
  });

  it('normalizes legacy [verifier] format to graders', async () => {
    const config = {
      version: '1.0',
      verifier: { script: 'test.sh' },
      agent: { timeout_sec: 300 },
    };

    mockReadFile.mockResolvedValue('content' as any);
    mockTomlParse.mockReturnValue(config);

    const result = await loadTaskConfig('/task');
    expect(result.graders).toHaveLength(1);
    expect(result.graders[0].type).toBe('deterministic');
    expect(result.graders[0].command).toBe('bash tests/test.sh');
  });

  it('keeps new graders format as-is', async () => {
    const config = {
      version: '1.0',
      graders: [
        { type: 'deterministic', command: 'node test.js', weight: 0.7 },
        { type: 'llm_rubric', rubric: 'quality.md', weight: 0.3 },
      ],
      agent: { timeout_sec: 300 },
    };

    mockReadFile.mockResolvedValue('content' as any);
    mockTomlParse.mockReturnValue(config);

    const result = await loadTaskConfig('/task');
    expect(result.graders).toHaveLength(2);
    expect(result.graders[1].type).toBe('llm_rubric');
  });
});

describe('EvalRunner', () => {
  function makeMockProvider(): EnvironmentProvider {
    return {
      prepare: vi.fn().mockResolvedValue('image-1'),
      setup: vi.fn().mockResolvedValue('/workspace'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      teardown: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    };
  }

  function makeMockAgent(output = 'Agent done'): BaseAgent {
    return {
      run: vi.fn().mockResolvedValue(output),
    } as any;
  }

  // We need to mock the dependencies that EvalRunner uses
  // The key ones are: loadTaskConfig (called within runEval) and getGrader

  it('runs a single trial and returns report', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    // Mock fs.readFile for task.toml and instruction.md
    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{
        type: 'deterministic',
        command: 'echo ok',
        weight: 1.0,
      }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    // Mock the grader
    const mockGrader = {
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic',
        score: 1.0,
        weight: 1.0,
        details: 'All passed',
      } as GraderResult),
    };

    // We need to mock getGrader which is imported in evalRunner
    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue(mockGrader);

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 1);

    expect(report.task).toBe('task');
    expect(report.trials).toHaveLength(1);
    expect(report.trials[0].trial_id).toBe(1);
    expect(report.trials[0].reward).toBe(1.0);
    expect(report.trials[0].session_log.length).toBeGreaterThan(0);
    expect(provider.prepare).toHaveBeenCalled();
    expect(provider.setup).toHaveBeenCalled();
    expect(provider.cleanup).toHaveBeenCalled();
    expect(provider.teardown).toHaveBeenCalled();
  });

  it('handles agent errors gracefully', async () => {
    const provider = makeMockProvider();
    const agent = {
      run: vi.fn().mockRejectedValue(new Error('Agent crashed')),
    } as any as BaseAgent;

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 1);

    expect(report.trials[0].reward).toBe(0);
    expect(report.trials[0].grader_results).toEqual([]);
  });

  it('saves report to logDir when provided', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider, '/logs');
    const report = await runner.runEval(agent, '/task', [], 1);

    expect(mockEnsureDir).toHaveBeenCalledWith('/logs');
    expect(mockWriteJSON).toHaveBeenCalled();
    const writtenPath = (mockWriteJSON.mock.calls[0] as any[])[0] as string;
    expect(writtenPath).toContain('task_');
    expect(writtenPath).toContain('.json');
  });

  it('sanitizes secrets from report when env passed', async () => {
    const provider = makeMockProvider();
    (provider.runCommand as any).mockResolvedValue({
      stdout: 'The key is MY_SECRET_VALUE_123',
      stderr: '',
      exitCode: 0,
    });
    const agent = {
      run: vi.fn().mockImplementation(async (instruction: string, workspace: string, runCommand: any) => {
        const res = await runCommand('echo test');
        return `Output: ${res.stdout}`;
      }),
    } as any as BaseAgent;

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider, '/logs');
    await runner.runEval(agent, '/task', [], 1, { SECRET: 'MY_SECRET_VALUE_123' });

    const writtenReport = (mockWriteJSON.mock.calls[0] as any[])[1];
    const reportStr = JSON.stringify(writtenReport);
    expect(reportStr).not.toContain('MY_SECRET_VALUE_123');
    expect(reportStr).toContain('[REDACTED]');
  });

  it('calculates correct pass_rate and pass_at_k', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    let callCount = 0;
    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockImplementation(async () => {
        callCount++;
        return {
          grader_type: 'deterministic',
          score: callCount % 2 === 0 ? 1.0 : 0.0,
          weight: 1.0,
          details: 'test',
        };
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 2);

    expect(report.trials).toHaveLength(2);
    // Trial 1 score=0, Trial 2 score=1.0
    expect(report.pass_rate).toBe(0.5);
  });

  it('runs trials in parallel when parallel > 1', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 3, undefined, 2);

    expect(report.trials).toHaveLength(3);
  });

  it('does not save report when logDir is not set', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    await runner.runEval(agent, '/task', [], 1);

    expect(mockWriteJSON).not.toHaveBeenCalled();
  });

  it('calls provider.diagnose on error if available', async () => {
    const provider = makeMockProvider();
    (provider as any).diagnose = vi.fn().mockResolvedValue('Diagnostics output');

    const agent = {
      run: vi.fn().mockRejectedValue(new Error('Failed')),
    } as any as BaseAgent;

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 1);

    expect((provider as any).diagnose).toHaveBeenCalled();
    const lastLogEntry = report.trials[0].session_log[report.trials[0].session_log.length - 1];
    expect(lastLogEntry.output).toContain('Diagnostics output');
  });

  it('handles provider without prepare and teardown', async () => {
    const provider: EnvironmentProvider = {
      setup: vi.fn().mockResolvedValue('/workspace'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    };

    const agent = makeMockAgent();

    mockReadFile.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('task.toml')) return 'toml content' as any;
      if (p.endsWith('instruction.md')) return 'Do something' as any;
      return '' as any;
    });

    mockTomlParse.mockReturnValue({
      graders: [{ type: 'deterministic', command: 'echo ok', weight: 1.0 }],
      agent: { timeout_sec: 300 },
      environment: { cpus: 2, memory_mb: 2048, storage_mb: 500, build_timeout_sec: 180 },
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], 1);

    expect(report.trials).toHaveLength(1);
    // Should not throw even without prepare/teardown
  });
});
