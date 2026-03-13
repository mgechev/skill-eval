import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fsExtra from 'fs-extra';

// Test the actual runCliPreview by creating real temp files
describe('runCliPreview', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `skilleval-cli-test-${Date.now()}`);
    await fsExtra.ensureDir(tempDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    try { await fsExtra.remove(tempDir); } catch {}
    vi.restoreAllMocks();
  });

  it('prints message when no reports found', async () => {
    // Dynamic import to avoid module caching issues
    const { runCliPreview } = await import('../src/reporters/cli');
    const logSpy = vi.spyOn(console, 'log');

    await runCliPreview(tempDir);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No reports found'));
  });

  it('displays report data for valid JSON files', async () => {
    const report = {
      task: 'test-task',
      pass_rate: 0.8,
      pass_at_k: 0.75,
      pass_pow_k: 0.6,
      trials: [
        {
          trial_id: 1,
          reward: 0.8,
          duration_ms: 5000,
          n_commands: 3,
          input_tokens: 100,
          output_tokens: 200,
          grader_results: [
            { grader_type: 'deterministic', score: 0.8, weight: 1.0, details: 'ok' },
          ],
        },
      ],
      skills_used: ['my-skill'],
    };
    await fsExtra.writeJSON(path.join(tempDir, 'task_2026-01-01T00-00-00.json'), report);

    const { runCliPreview } = await import('../src/reporters/cli');
    const logSpy = vi.spyOn(console, 'log');

    await runCliPreview(tempDir);

    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('test-task');
    expect(allOutput).toContain('80.0%');
    expect(allOutput).toContain('my-skill');
  });

  it('skips invalid JSON files gracefully', async () => {
    await fsExtra.writeFile(path.join(tempDir, 'bad.json'), 'not valid json');
    await fsExtra.writeJSON(path.join(tempDir, 'good.json'), {
      task: 'good-task',
      pass_rate: 1.0,
      trials: [{
        trial_id: 1, reward: 1.0, duration_ms: 1000, n_commands: 1,
        input_tokens: 50, output_tokens: 100, grader_results: [],
      }],
      skills_used: [],
    });

    const { runCliPreview } = await import('../src/reporters/cli');
    const logSpy = vi.spyOn(console, 'log');

    await runCliPreview(tempDir);

    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('good-task');
  });

  it('only processes .json files', async () => {
    await fsExtra.writeFile(path.join(tempDir, 'readme.txt'), 'hello');
    await fsExtra.writeJSON(path.join(tempDir, 'report.json'), {
      task: 'task1',
      pass_rate: 0.5,
      trials: [{
        trial_id: 1, reward: 0.5, duration_ms: 1000, n_commands: 1,
        input_tokens: 10, output_tokens: 20,
        grader_results: [{ grader_type: 'deterministic', score: 0.5, weight: 1.0, details: 'ok' }],
      }],
      skills_used: [],
    });

    const { runCliPreview } = await import('../src/reporters/cli');
    const logSpy = vi.spyOn(console, 'log');

    await runCliPreview(tempDir);

    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('task1');
  });

  it('displays LLM grader details', async () => {
    await fsExtra.writeJSON(path.join(tempDir, 'test.json'), {
      task: 'task1',
      pass_rate: 0.9,
      trials: [{
        trial_id: 1, reward: 0.9, duration_ms: 2000, n_commands: 2,
        input_tokens: 100, output_tokens: 200,
        grader_results: [
          { grader_type: 'llm_rubric', score: 0.9, weight: 1.0, details: 'Excellent work' },
        ],
      }],
      skills_used: [],
    });

    const { runCliPreview } = await import('../src/reporters/cli');
    const logSpy = vi.spyOn(console, 'log');

    await runCliPreview(tempDir);

    const allOutput = logSpy.mock.calls.map(c => String(c[0])).join('\n');
    expect(allOutput).toContain('llm_rubric');
    expect(allOutput).toContain('Excellent work');
  });

  it('handles reports with missing optional fields', async () => {
    await fsExtra.writeJSON(path.join(tempDir, 'minimal.json'), {
      task: 'minimal-task',
      pass_rate: 0.3,
      trials: [{
        trial_id: 1, reward: 0.3, duration_ms: 500, n_commands: 0,
        input_tokens: 0, output_tokens: 0,
        grader_results: [{ grader_type: 'deterministic', score: 0.3, weight: 1.0, details: 'partial' }],
      }],
      skills_used: [],
    });

    const { runCliPreview } = await import('../src/reporters/cli');
    // Should not throw
    await runCliPreview(tempDir);
  });
});
