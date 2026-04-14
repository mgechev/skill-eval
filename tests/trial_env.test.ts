import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvalRunner, EvalRunOptions } from '../src/evalRunner';
import { BaseAgent, EnvironmentProvider, GraderResult } from '../src/types';

vi.mock('./graders', () => ({
  getGrader: vi.fn(),
}));

describe('Trial Environment Substitution', () => {
  function makeMockProvider(): EnvironmentProvider {
    return {
      prepare: vi.fn().mockResolvedValue('image-1'),
      setup: vi.fn().mockResolvedValue('/workspace'),
      cleanup: vi.fn().mockResolvedValue(undefined),
      teardown: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
    };
  }

  function makeMockAgent(): BaseAgent {
    return {
      run: vi.fn().mockResolvedValue('Agent done'),
    } as any;
  }

  function makeEvalOpts(overrides?: Partial<EvalRunOptions>): EvalRunOptions {
    return {
      instruction: 'Do something',
      graders: [{ type: 'deterministic', run: 'echo ok', weight: 1.0 }],
      timeoutSec: 300,
      environment: { cpus: 2, memory_mb: 2048 },
      ...overrides,
    };
  }

  it('substitutes {{trial}} in environment variables', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts();
    
    const env = {
      ARTIFACT_REGISTRY: 'yesh-evals-{{trial}}',
      OTHER_VAR: 'value-{{trial}}-suffix'
    };

    const runner = new EvalRunner(provider);
    
    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    await runner.runEval(agent, '/task', [], opts, 2, env);

    // Check setup calls for each trial
    expect(provider.setup).toHaveBeenCalledTimes(2);
    
    // Trial 1 (index 0, trial_id 1)
    expect(provider.setup).toHaveBeenNthCalledWith(1, 
      expect.anything(), 
      expect.anything(), 
      expect.anything(), 
      expect.objectContaining({
        ARTIFACT_REGISTRY: 'yesh-evals-1',
        OTHER_VAR: 'value-1-suffix'
      })
    );

    // Trial 2 (index 1, trial_id 2)
    expect(provider.setup).toHaveBeenNthCalledWith(2, 
      expect.anything(), 
      expect.anything(), 
      expect.anything(), 
      expect.objectContaining({
        ARTIFACT_REGISTRY: 'yesh-evals-2',
        OTHER_VAR: 'value-2-suffix'
      })
    );
  });

  it('substitutes {{trial}} correctly in parallel trials', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts();
    
    const env = {
      ARTIFACT_REGISTRY: 'yesh-evals-{{trial}}'
    };

    const runner = new EvalRunner(provider);
    
    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    // Run 5 trials with parallelism of 3
    await runner.runEval(agent, '/task', [], opts, 5, env, 3);

    expect(provider.setup).toHaveBeenCalledTimes(5);
    
    const calledEnvs = vi.mocked(provider.setup).mock.calls.map((call: any) => call[3]);
    
    for (let i = 1; i <= 5; i++) {
      const found = calledEnvs.some((e: any) => e.ARTIFACT_REGISTRY === `yesh-evals-${i}`);
      expect(found, `Trial ${i} env was not found in parallel execution`).toBe(true);
    }
  });

  it('injects _EVAL_TRIAL and _EVAL_UUID automatically', async () => {
    const provider = makeMockProvider();
    const agent = makeMockAgent();
    const opts = makeEvalOpts();
    
    const runner = new EvalRunner(provider);
    
    const gradersModule = await import('../src/graders/index');
    vi.spyOn(gradersModule, 'getGrader').mockReturnValue({
      grade: vi.fn().mockResolvedValue({
        grader_type: 'deterministic', score: 1.0, weight: 1.0, details: 'ok',
      }),
    });

    await runner.runEval(agent, '/task', [], opts, 2);

    expect(provider.setup).toHaveBeenCalledTimes(2);
    
    const calledEnvs = vi.mocked(provider.setup).mock.calls.map((call: any) => call[3]);
    
    // Check trial 1
    expect(calledEnvs[0]._EVAL_TRIAL).toBe('1');
    expect(calledEnvs[0]._EVAL_UUID).toBeDefined();
    
    // Check trial 2
    expect(calledEnvs[1]._EVAL_TRIAL).toBe('2');
    expect(calledEnvs[1]._EVAL_UUID).toBeDefined();
    
    // Check that UUID is the same for both trials
    expect(calledEnvs[0]._EVAL_UUID).toBe(calledEnvs[1]._EVAL_UUID);
    
    // Check that UUID is a valid UUID
    expect(calledEnvs[0]._EVAL_UUID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
