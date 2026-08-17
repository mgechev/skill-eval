import { describe, it, expect } from 'vitest';
import { describeSelection, metadataKeys, parseFilter, selectTasks } from '../src/core/filter';
import { EvalTaskConfig } from '../src/core/config.types';

const task = (name: string, metadata?: Record<string, unknown>): EvalTaskConfig => ({
    name,
    instruction: `do ${name}`,
    graders: [{ type: 'deterministic', run: 'echo ok', weight: 1 }],
    metadata,
});

const tasks = [
    task('easy--open-tooltip', { tier: 'easy', form: 'open', tags: ['smoke'] }),
    task('easy--open-badge', { tier: 'easy', form: 'open', tags: ['smoke', 'flaky'] }),
    task('hard--refuse-missing', { tier: 'hard', form: 'refuse', tags: ['smoke'] }),
    task('hard--compare-variants', { tier: 'hard', form: 'compare' }),
    task('no-metadata'),
];

const names = (selected: EvalTaskConfig[]) => selected.map(t => t.name);

describe('parseFilter', () => {
    it('parses a key and its values', () => {
        expect(parseFilter('tier=easy', false)).toEqual({ key: 'tier', values: ['easy'], negate: false });
        expect(parseFilter('tier=easy,medium', true)).toEqual({ key: 'tier', values: ['easy', 'medium'], negate: true });
    });

    it('keeps "=" inside the value', () => {
        expect(parseFilter('query=a=b', false).values).toEqual(['a=b']);
    });

    it('rejects specs without key=value', () => {
        expect(() => parseFilter('tier', false)).toThrow('expected key=value');
        expect(() => parseFilter('=easy', false)).toThrow('expected key=value');
        expect(() => parseFilter('tier=', false)).toThrow('no value after');
    });
});

describe('selectTasks', () => {
    it('returns everything when nothing is selected', () => {
        expect(selectTasks(tasks, {})).toHaveLength(5);
    });

    it('ORs values within one key', () => {
        const selected = selectTasks(tasks, { filters: [parseFilter('form=open,compare', false)] });
        expect(names(selected)).toEqual(['easy--open-tooltip', 'easy--open-badge', 'hard--compare-variants']);
    });

    it('ANDs across keys', () => {
        const selected = selectTasks(tasks, {
            filters: [parseFilter('tier=hard', false), parseFilter('form=refuse', false)],
        });
        expect(names(selected)).toEqual(['hard--refuse-missing']);
    });

    it('matches a value inside a list', () => {
        const selected = selectTasks(tasks, { filters: [parseFilter('tags=smoke', false)] });
        expect(names(selected)).toHaveLength(3);
    });

    it('excludes with a negated filter', () => {
        const selected = selectTasks(tasks, {
            filters: [parseFilter('tags=smoke', false), parseFilter('tags=flaky', true)],
        });
        expect(names(selected)).toEqual(['easy--open-tooltip', 'hard--refuse-missing']);
    });

    it('treats a task without the key as not matching', () => {
        const selected = selectTasks(tasks, { filters: [parseFilter('tier=easy,hard', false)] });
        expect(names(selected)).not.toContain('no-metadata');
    });

    it('errors on an unknown key instead of matching everything', () => {
        expect(() => selectTasks(tasks, { filters: [parseFilter('teir=easy', false)] }))
            .toThrow('Unknown filter key "teir" — available metadata keys: form, tags, tier');
    });

    it('selects by name and by name pattern', () => {
        expect(names(selectTasks(tasks, { names: ['no-metadata'] }))).toEqual(['no-metadata']);
        expect(() => selectTasks(tasks, { names: ['nope'] })).toThrow('Eval "nope" not found');
        expect(names(selectTasks(tasks, { pattern: '^easy--' }))).toHaveLength(2);
        expect(() => selectTasks(tasks, { pattern: '^(' })).toThrow('Invalid --filter-pattern');
    });

    it('combines a pattern with metadata filters', () => {
        const selected = selectTasks(tasks, {
            pattern: '^hard--',
            filters: [parseFilter('tags=smoke', false)],
        });
        expect(names(selected)).toEqual(['hard--refuse-missing']);
    });

    it('can select nothing', () => {
        expect(selectTasks(tasks, { filters: [parseFilter('tier=nope', false)] })).toEqual([]);
    });
});

describe('metadataKeys / describeSelection', () => {
    it('lists every key used in the suite', () => {
        expect(metadataKeys(tasks)).toEqual(['form', 'tags', 'tier']);
        expect(metadataKeys([task('a')])).toEqual([]);
    });

    it('renders one line per task with its labels', () => {
        expect(describeSelection([tasks[1], tasks[4]])).toEqual([
            'easy--open-badge  tier=easy form=open tags=smoke|flaky',
            'no-metadata',
        ]);
    });
});
