/**
 * Task selection.
 *
 * Selecting a subset of a large suite: by name, by regex over names, or by the
 * `metadata` labels a task carries. Works the same whether the tasks are inline
 * in eval.yaml or imported from other files.
 *
 *   skillgrade --filter tier=easy,medium         # OR within one key
 *   skillgrade --filter tier=hard --filter form=refuse   # AND across keys
 *   skillgrade --filter tags=smoke --not-filter tags=flaky
 *   skillgrade --filter-pattern '^easy--'        # regex over task names
 *   skillgrade --list                            # print the selection, run nothing
 *
 * An unknown metadata key is an error rather than a match-everything, because
 * `--filter teir=easy` silently running all 300 tasks is the expensive failure.
 */
import { EvalTaskConfig } from './config.types';

export interface TaskFilter {
    key: string;
    values: string[];
    negate: boolean;
}

export interface TaskSelection {
    names?: string[];        // --eval=a,b (exact names)
    filters?: TaskFilter[];  // --filter / --not-filter
    pattern?: string;        // --filter-pattern (regex over names)
}

/** Parse `key=value` or `key=v1,v2` into a filter. */
export function parseFilter(spec: string, negate: boolean): TaskFilter {
    const eq = spec.indexOf('=');
    if (eq <= 0) {
        throw new Error(`Invalid filter "${spec}" — expected key=value (e.g. tier=easy)`);
    }
    const key = spec.slice(0, eq).trim();
    const values = spec.slice(eq + 1).split(',').map(v => v.trim()).filter(Boolean);
    if (values.length === 0) {
        throw new Error(`Invalid filter "${spec}" — no value after "="`);
    }
    return { key, values, negate };
}

/** Every metadata key used anywhere in the suite, sorted. */
export function metadataKeys(tasks: EvalTaskConfig[]): string[] {
    const keys = new Set<string>();
    for (const task of tasks) {
        for (const key of Object.keys(task.metadata || {})) keys.add(key);
    }
    return [...keys].sort();
}

/** Does a task's metadata value match any of the filter's values? */
function matches(task: EvalTaskConfig, filter: TaskFilter): boolean {
    const value = task.metadata?.[filter.key];
    if (value === undefined || value === null) return false;
    const actual = (Array.isArray(value) ? value : [value]).map(v => String(v));
    return filter.values.some(wanted => actual.includes(wanted));
}

/**
 * Apply a selection to the task list. Filters AND together across keys and OR
 * within a key; `--not-filter` excludes any task that matches.
 */
export function selectTasks(tasks: EvalTaskConfig[], selection: TaskSelection): EvalTaskConfig[] {
    let selected = tasks;

    if (selection.names?.length) {
        const wanted = new Set(selection.names);
        const unknown = selection.names.filter(n => !tasks.some(t => t.name === n));
        if (unknown.length > 0) {
            throw new Error(`Eval "${unknown.join(', ')}" not found`);
        }
        selected = selected.filter(t => wanted.has(t.name));
    }

    if (selection.pattern) {
        let regex: RegExp;
        try {
            regex = new RegExp(selection.pattern);
        } catch (err) {
            throw new Error(`Invalid --filter-pattern "${selection.pattern}": ${err}`);
        }
        selected = selected.filter(t => regex.test(t.name));
    }

    if (selection.filters?.length) {
        const known = new Set(metadataKeys(tasks));
        for (const filter of selection.filters) {
            if (!known.has(filter.key)) {
                const available = [...known].join(', ') || '(no task declares metadata)';
                throw new Error(`Unknown filter key "${filter.key}" — available metadata keys: ${available}`);
            }
        }
        selected = selected.filter(task =>
            selection.filters!.every(f => f.negate ? !matches(task, f) : matches(task, f))
        );
    }

    return selected;
}

/** One line per task: its name and its metadata, for `--list`. */
export function describeSelection(tasks: EvalTaskConfig[]): string[] {
    return tasks.map(task => {
        const labels = Object.entries(task.metadata || {})
            .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`)
            .join(' ');
        return labels ? `${task.name}  ${labels}` : task.name;
    });
}
