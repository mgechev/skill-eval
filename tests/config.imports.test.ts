import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { loadEvalConfig, resolveTask } from '../src/core/config';

let dir: string;

async function write(rel: string, content: string) {
    const full = path.join(dir, rel);
    await fs.ensureDir(path.dirname(full));
    await fs.writeFile(full, content);
    return full;
}

const task = (name: string, extra = '') => `name: ${name}
instruction: "do ${name}"
graders:
  - type: deterministic
    run: "echo ok"
${extra}`;

beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillgrade-imports-'));
});

afterEach(async () => {
    await fs.remove(dir);
});

describe('$import in tasks', () => {
    it('splices a single-task file into the tasks array', async () => {
        await write('evals/open-tooltip.yaml', task('open-tooltip'));
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/open-tooltip.yaml
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['open-tooltip']);
    });

    it('splices a file holding a list of tasks', async () => {
        await write('evals/easy.yaml', `- ${task('a').replace(/\n/g, '\n  ')}
- ${task('b').replace(/\n/g, '\n  ')}
`);
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/easy.yaml
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['a', 'b']);
    });

    it('keeps a single-entry list a list when it is the whole section', async () => {
        await write('datasets/tasks.yaml', `- ${task('only-one').replace(/\n/g, '\n  ')}
`);
        await write('eval.yaml', `version: "1"
tasks:
  $import: datasets/tasks.yaml
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['only-one']);
    });

    it('expands a glob in sorted order and keeps inline tasks', async () => {
        await write('evals/easy/b.yaml', task('easy--b'));
        await write('evals/easy/a.yaml', task('easy--a'));
        await write('evals/hard/c.yaml', task('hard--c'));
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/easy/*.yaml
  - $import: evals/**/c.yaml
  - name: inline
    instruction: "inline"
    graders:
      - type: deterministic
        run: "echo ok"
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['easy--a', 'easy--b', 'hard--c', 'inline']);
    });

    it('imports every yaml file in a directory', async () => {
        await write('evals/a.yaml', task('a'));
        await write('evals/b.yml', task('b'));
        await write('evals/README.md', 'not a task');
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['a', 'b']);
    });

    it('accepts a list of import paths and a bare $import for the whole section', async () => {
        await write('evals/a.yaml', task('a'));
        await write('evals/b.yaml', task('b'));
        await write('eval.yaml', `version: "1"
tasks:
  $import:
    - evals/a.yaml
    - evals/b.yaml
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['a', 'b']);
    });

    it('lets sibling keys override every imported task', async () => {
        await write('evals/a.yaml', task('a'));
        await write('evals/b.yaml', task('b', 'trials: 2\n'));
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/*.yaml
    trials: 10
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.trials)).toEqual([10, 10]);
    });

    it('resolves nested imports relative to the importing file', async () => {
        await write('evals/easy/one.yaml', task('one'));
        await write('evals/index.yaml', `- $import: easy/one.yaml
`);
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/index.yaml
`);

        const config = await loadEvalConfig(dir);
        expect(config.tasks.map(t => t.name)).toEqual(['one']);
    });

    it('imports the defaults section as an object, siblings winning', async () => {
        await write('shared/defaults.yaml', `agent: command
command: "node ./harness/run.mjs"
provider: local
trials: 5
`);
        await write('eval.yaml', `version: "1"
defaults:
  $import: shared/defaults.yaml
  trials: 1
tasks:
  - name: a
    instruction: "a"
    graders:
      - type: deterministic
        run: "echo ok"
`);

        const config = await loadEvalConfig(dir);
        expect(config.defaults.agent).toBe('command');
        expect(config.defaults.provider).toBe('local');
        expect(config.defaults.trials).toBe(1);
    });

    it('errors on a missing target, an empty glob, and a cycle', async () => {
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/nope.yaml
`);
        await expect(loadEvalConfig(dir)).rejects.toThrow('$import target not found');

        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/*.yaml
`);
        await expect(loadEvalConfig(dir)).rejects.toThrow('matched no files');

        await write('evals/loop.yaml', `- $import: ../evals/loop.yaml
`);
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/loop.yaml
`);
        await expect(loadEvalConfig(dir)).rejects.toThrow('Circular $import');
    });

    it('keeps validation errors pointing at the offending task', async () => {
        await write('evals/broken.yaml', `name: broken
instruction: "x"
`);
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/broken.yaml
`);
        await expect(loadEvalConfig(dir)).rejects.toThrow('Task "broken" must have at least one grader');
    });
});

describe('relative paths inside an imported task', () => {
    it('resolves against the task file first, then the eval root', async () => {
        await write('evals/easy/instruction.md', 'Open the page for Tooltips.');
        await write('prompts/quality.md', 'Shared rubric.');
        await write('evals/easy/one.yaml', `name: one
instruction: instruction.md
graders:
  - type: deterministic
    run: "echo ok"
  - type: llm_rubric
    rubric: prompts/quality.md
`);
        await write('eval.yaml', `version: "1"
tasks:
  - $import: evals/easy/one.yaml
`);

        const config = await loadEvalConfig(dir);
        const resolved = await resolveTask(config.tasks[0], config.defaults, dir);

        expect(resolved.instruction).toBe('Open the page for Tooltips.');
        expect(resolved.graders[1].rubric).toBe('Shared rubric.');
        expect(resolved.baseDirs).toEqual([path.join(dir, 'evals/easy'), dir]);
    });

    it('leaves inline tasks resolving against the eval root only', async () => {
        await write('instruction.md', 'Root instruction.');
        await write('eval.yaml', `version: "1"
tasks:
  - name: a
    instruction: instruction.md
    graders:
      - type: deterministic
        run: "echo ok"
`);

        const config = await loadEvalConfig(dir);
        const resolved = await resolveTask(config.tasks[0], config.defaults, dir);

        expect(resolved.instruction).toBe('Root instruction.');
        expect(resolved.baseDirs).toEqual([dir]);
    });
});
