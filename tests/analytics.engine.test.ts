import { describe, it, expect } from 'vitest';
import { calculateNormalizedGain, AnalyticsEngine } from '../src/analytics/engine';
import { EvalReport } from '../src/types';

describe('calculateNormalizedGain', () => {
  it('returns 1.0 when pWith is 1.0 and pWithout < 1.0', () => {
    expect(calculateNormalizedGain(1.0, 0.5)).toBe(1.0);
  });

  it('returns 0.5 for intermediate improvement', () => {
    expect(calculateNormalizedGain(0.75, 0.5)).toBe(0.5);
  });

  it('returns 0.0 when there is no improvement', () => {
    expect(calculateNormalizedGain(0.5, 0.5)).toBe(0.0);
  });

  it('returns negative for regression', () => {
    expect(calculateNormalizedGain(0.25, 0.5)).toBe(-0.5);
  });

  it('handles pWithout=1 with pWith=1 → 0', () => {
    expect(calculateNormalizedGain(1.0, 1.0)).toBe(0);
  });

  it('handles pWithout=1 with pWith<1 → -1', () => {
    expect(calculateNormalizedGain(0.5, 1.0)).toBe(-1);
  });

  it('handles pWithout=0', () => {
    expect(calculateNormalizedGain(0.8, 0.0)).toBeCloseTo(0.8);
  });
});

describe('AnalyticsEngine.aggregate', () => {
  function makeReport(task: string, passRate: number, skillsUsed: string[]): EvalReport {
    return {
      task,
      pass_rate: passRate,
      pass_at_k: passRate,
      pass_pow_k: passRate,
      trials: [
        {
          trial_id: 1,
          reward: passRate,
          grader_results: [],
          duration_ms: 1000,
          n_commands: 5,
          input_tokens: 100,
          output_tokens: 200,
          session_log: [],
        },
      ],
      skills_used: skillsUsed,
      eval_uuid: 'mock-uuid',
      timestamp: new Date().toISOString(),
      status: 'completed',
    };
  }

  it('groups reports by task name', () => {
    const engine = new AnalyticsEngine();
    const reports = [
      makeReport('task1', 0.5, []),
      makeReport('task1', 1.0, ['skill1']),
      makeReport('task2', 0.0, []),
      makeReport('task2', 0.5, ['skill1']),
    ];

    const stats = engine.aggregate(reports);
    expect(stats).toHaveLength(2);
    expect(stats.map(s => s.task).sort()).toEqual(['task1', 'task2']);
  });

  it('calculates correct pass rates with and without skill', () => {
    const engine = new AnalyticsEngine();
    const reports = [
      makeReport('task1', 0.5, []),
      makeReport('task1', 1.0, ['skill1']),
    ];

    const stats = engine.aggregate(reports);
    const task1 = stats.find(s => s.task === 'task1')!;
    expect(task1.passRateNoSkill).toBe(0.5);
    expect(task1.passRateWithSkill).toBe(1.0);
    expect(task1.normalizedGain).toBe(1.0);
  });

  it('calculates average duration and commands', () => {
    const engine = new AnalyticsEngine();
    const reports = [makeReport('task1', 0.5, [])];

    const stats = engine.aggregate(reports);
    expect(stats[0].avgDurationMs).toBe(1000);
    expect(stats[0].avgCommands).toBe(5);
  });

  it('handles empty reports', () => {
    const engine = new AnalyticsEngine();
    const stats = engine.aggregate([]);
    expect(stats).toEqual([]);
  });

  it('handles reports with only with-skill data', () => {
    const engine = new AnalyticsEngine();
    const reports = [makeReport('task1', 0.8, ['my-skill'])];

    const stats = engine.aggregate(reports);
    expect(stats[0].passRateNoSkill).toBe(0);
    expect(stats[0].passRateWithSkill).toBe(0.8);
  });

  it('handles reports with only without-skill data', () => {
    const engine = new AnalyticsEngine();
    const reports = [makeReport('task1', 0.6, [])];

    const stats = engine.aggregate(reports);
    expect(stats[0].passRateNoSkill).toBe(0.6);
    expect(stats[0].passRateWithSkill).toBe(0);
  });
});
