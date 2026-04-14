import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

// Mock dependencies
vi.mock('fs-extra', () => ({
  readFile: vi.fn(),
  ensureDir: vi.fn(),
  writeJSON: vi.fn(),
}));

vi.mock('./graders', () => ({
  getGrader: vi.fn(),
}));

import * as fs from 'fs-extra';
import { EvalRunner, EvalRunOptions } from '../src/evalRunner';
import { BaseAgent, EnvironmentProvider, GraderResult } from '../src/types';

const mockEnsureDir = vi.mocked(fs.ensureDir);
const mockWriteJSON = vi.mocked(fs.writeJSON);

/** Standard eval options used across tests */
function makeEvalOpts(overrides?: Partial<EvalRunOptions>): EvalRunOptions {
  return {
    instruction: 'Do something',
    graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
    timeoutSec: 300,
    environment: { cpus: 2, memory_mb: 2048 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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

  it('runs a single trial and returns report', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts();

    const mockGrader = {
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic',
        score: 1.0,
        weight: 1.0,
        details: 'All passed',
      } as GraderResult),
    };

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue(mockGrader);

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], opts, 1);

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

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

    expect(report.trials[0].reward).toBe(0);
    expect(report.trials[0].grader_results).toEqual([]);
  });

  it('handles provider setup failure gracefully', async () => {
    const provider = makeMockProvider();
    provider.setup = vi.fn().mockRejectedValue(new Error('Setup failed'));

    const agent = makeMockAgent();
    const runner = new EvalRunner(provider);
    
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

    expect(report.trials).toHaveLength(1);
    expect(report.trials[0].reward).toBe(0);
    expect(report.trials[0].session_log.length).toBeGreaterThan(0);
    const lastLog = report.trials[0].session_log[report.trials[0].session_log.length - 1];
    expect(lastLog.output).toContain('Setup failed');
  });

  it('saves report to logDir when provided', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider, '/logs');
    await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

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

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider, '/logs');
    await runner.runEval(agent, '/task', [], makeEvalOpts(), 1, { SECRET: 'MY_SECRET_VALUE_123' });

    const writtenReport = (mockWriteJSON.mock.calls[0] as any[])[1];
    const reportStr = JSON.stringify(writtenReport);
    expect(reportStr).not.toContain('MY_SECRET_VALUE_123');
    expect(reportStr).toContain('[REDACTED]');
  });

  it('does not sanitize secrets from report when noRedact is true', async () => {
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

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider, '/logs', true);
    await runner.runEval(agent, '/task', [], makeEvalOpts(), 1, { SECRET: 'MY_SECRET_VALUE_123' });

    const writtenReport = (mockWriteJSON.mock.calls[0] as any[])[1];
    const reportStr = JSON.stringify(writtenReport);
    expect(reportStr).toContain('MY_SECRET_VALUE_123');
    expect(reportStr).not.toContain('[REDACTED]');
  });

  it('calculates correct pass_rate and pass_at_k', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

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
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 2);

    expect(report.trials).toHaveLength(2);
    // Trial 1 score=0, Trial 2 score=1.0
    expect(report.pass_rate).toBe(0.5);
  });

  it('runs trials in parallel when parallel > 1', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 3, undefined, 2);

    expect(report.trials).toHaveLength(3);
  });

  it('does not save report when logDir is not set', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

    expect(mockWriteJSON).not.toHaveBeenCalled();
  });

  it('calls provider.diagnose on error if available', async () => {
    const provider = makeMockProvider();
    (provider as any).diagnose = vi.fn().mockResolvedValue('Diagnostics output');

    const agent = {
      run: vi.fn().mockRejectedValue(new Error('Failed')),
    } as any as BaseAgent;

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

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

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], makeEvalOpts(), 1);

    expect(report.trials).toHaveLength(1);
    // Should not throw even without prepare/teardown
  });

  it('handles multiple graders of each type', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();

    const opts = makeEvalOpts({
      graders: [
        { type: 'deterministic', run: 'echo 1', weight: 0.5 },
        { type: 'deterministic', run: 'echo 2', weight: 0.2 },
        { type: 'llm_rubric', rubric: 'Evaluate quality', weight: 0.3 },
      ],
    });

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], opts, 1);

    expect(report.trials[0].grader_results).toHaveLength(3);
  });

  it('executes and logs trialConfig.cleanup in finally block', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts({
      trialConfig: {
        cleanup: 'echo cleanup'
      }
    } as any);

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], opts, 1);

    expect(provider.runCommand).toHaveBeenCalledWith('/workspace', 'echo cleanup', {});
    expect(provider.cleanup).toHaveBeenCalledWith('/workspace');

    const trial = report.trials[0];
    const cleanupLog = trial.session_log.find(l => l.type === 'trial_cleanup');
    expect(cleanupLog).toBeTruthy();
    expect(cleanupLog?.command).toBe('echo cleanup');
  });

  it('executes and logs trialConfig.setup', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts({
      trialConfig: {
        setup: 'echo setup'
      }
    } as any);

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    const report = await runner.runEval(agent, '/task', [], opts, 1);

    expect(provider.runCommand).toHaveBeenCalledWith('/workspace', 'echo setup', {});

    const trial = report.trials[0];
    const setupLog = trial.session_log.find(l => l.type === 'trial_setup');
    expect(setupLog).toBeTruthy();
    expect(setupLog?.command).toBe('echo setup');
  });

  it('rotates comma-separated API keys across trials', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts();

    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    const runner = new EvalRunner(provider);
    
    // 3 trials, 2 keys -> Should be key1, key2, key1
    const env = { GEMINI_API_KEY: 'key1, key2' };
    await runner.runEval(agent, '/task', [], opts, 3, env);

    expect(provider.setup).toHaveBeenCalledTimes(3);
    
    // Check Trial 1
    expect(provider.setup).toHaveBeenNthCalledWith(1, 
      expect.anything(), expect.anything(), expect.anything(), 
      expect.objectContaining({ GEMINI_API_KEY: 'key1' })
    );

    // Check Trial 2
    expect(provider.setup).toHaveBeenNthCalledWith(2, 
      expect.anything(), expect.anything(), expect.anything(), 
      expect.objectContaining({ GEMINI_API_KEY: 'key2' })
    );

    // Check Trial 3 (round-robin)
    expect(provider.setup).toHaveBeenNthCalledWith(3, 
      expect.anything(), expect.anything(), expect.anything(), 
      expect.objectContaining({ GEMINI_API_KEY: 'key1' })
    );
  });

});
