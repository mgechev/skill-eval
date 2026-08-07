import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fsExtra from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { loadEvalConfig, resolveTask } from '../src/core/config';
import { DeterministicGrader } from '../src/graders/index';
import { EnvironmentProvider, GraderConfig } from '../src/types';

let dir: string;

beforeEach(async () => {
    dir = await fsExtra.mkdtemp(path.join(os.tmpdir(), 'skillgrade-context-'));
});

afterEach(async () => {
    await fsExtra.remove(dir);
});

async function writeEval(yaml: string) {
    await fsExtra.writeFile(path.join(dir, 'eval.yaml'), yaml);
}

describe('expected and metadata on a task', () => {
    const yaml = `version: "1"
tasks:
  - name: easy--tooltip-token
    instruction: "report the token"
    expected:
      token: Brand/100
      variants: [default, hover]
    metadata:
      tier: easy
      tags: [smoke]
    graders:
      - type: deterministic
        run: node graders/check-token.mjs
`;

    it('survives parsing and resolution with its structure intact', async () => {
        await writeEval(yaml);
        const config = await loadEvalConfig(dir);
        const resolved = await resolveTask(config.tasks[0], config.defaults, dir);

        expect(resolved.expected).toEqual({ token: 'Brand/100', variants: ['default', 'hover'] });
        expect(resolved.metadata).toEqual({ tier: 'easy', tags: ['smoke'] });
    });

    it('arrives the same way when the task is imported from another file', async () => {
        await fsExtra.ensureDir(path.join(dir, 'datasets'));
        await fsExtra.writeFile(path.join(dir, 'datasets', 'tasks.yaml'), `- name: easy--tooltip-token
  instruction: "report the token"
  expected:
    token: Brand/100
    variants: [default, hover]
  metadata:
    tier: easy
    tags: [smoke]
  graders:
    - type: deterministic
      run: node graders/check-token.mjs
`);
        await writeEval(`version: "1"
tasks:
  $import: datasets/tasks.yaml
`);

        const config = await loadEvalConfig(dir);
        const resolved = await resolveTask(config.tasks[0], config.defaults, dir);

        expect(resolved.expected).toEqual({ token: 'Brand/100', variants: ['default', 'hover'] });
        expect(resolved.metadata).toEqual({ tier: 'easy', tags: ['smoke'] });
    });

    it('rejects metadata that is not a key/value object', async () => {
        await writeEval(`version: "1"
tasks:
  - name: a
    instruction: "a"
    metadata: [tier, easy]
    graders:
      - type: deterministic
        run: "echo ok"
`);
        await expect(loadEvalConfig(dir)).rejects.toThrow('has a "metadata" that is not an object');
    });

    it('leaves expected and metadata undefined when absent', async () => {
        await writeEval(`version: "1"
tasks:
  - name: metric-only
    instruction: "measure something"
    graders:
      - type: deterministic
        run: "echo ok"
`);
        const config = await loadEvalConfig(dir);
        const resolved = await resolveTask(config.tasks[0], config.defaults, dir);

        expect(resolved.expected).toBeUndefined();
        expect(resolved.metadata).toBeUndefined();
    });
});

describe('SKILLGRADE_INPUT reaching a deterministic grader', () => {
    const grader = new DeterministicGrader();

    function captureProvider(): { provider: EnvironmentProvider; env: () => Record<string, string> } {
        const runCommand = vi.fn().mockResolvedValue({ stdout: '{"score":1}', stderr: '', exitCode: 0 });
        return {
            provider: { setup: vi.fn(), cleanup: vi.fn(), runCommand } as unknown as EnvironmentProvider,
            env: () => runCommand.mock.calls[0][2],
        };
    }

    it('serialises the task context as one JSON document', async () => {
        const { provider, env } = captureProvider();
        const config: GraderConfig = {
            type: 'deterministic',
            weight: 1,
            input: {
                task: 'easy--tooltip-token',
                trial: 2,
                expected: { token: 'Brand/100', variants: ['default', 'hover'] },
                metadata: { tier: 'easy' },
            },
        };

        await grader.grade('/workspace', provider, config, '/task', [], { ANTHROPIC_API_KEY: 'sk-test' });

        const parsed = JSON.parse(env().SKILLGRADE_INPUT);
        expect(parsed).toEqual(config.input);
        expect(parsed.expected.variants).toEqual(['default', 'hover']);   // structure, not stringified primitives
        expect(env().ANTHROPIC_API_KEY).toBe('sk-test');                  // existing env still passed through
    });

    it('passes env untouched when the task has no context', async () => {
        const { provider, env } = captureProvider();
        await grader.grade('/workspace', provider, { type: 'deterministic', weight: 1 }, '/task', [], { FOO: 'bar' });

        expect(env()).toEqual({ FOO: 'bar' });
        expect(env().SKILLGRADE_INPUT).toBeUndefined();
    });
});
