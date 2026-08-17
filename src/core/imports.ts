/**
 * `$import` support for eval.yaml.
 *
 * Any section of an eval.yaml can live in another file:
 *
 *   defaults:
 *     $import: shared/defaults.yaml   # object position → merged, siblings win
 *   tasks:
 *     - $import: evals/easy/*.yaml    # array position → spliced in
 *     - $import: evals/hard           # a directory → every .yaml inside, sorted
 *     - name: inline-still-works
 *       ...
 *
 * Imported paths are relative to the file that contains the `$import`, and
 * imported files may import further files. Every object keeps a hidden
 * reference to the file it came from (see `sourceFileOf`) so that relative
 * paths inside an imported task can resolve against that task's own directory.
 */
import * as fs from 'fs-extra';
import * as path from 'path';

const IMPORT_KEY = '$import';
const SOURCE_KEY = '__sourceFile';
const MAX_DEPTH = 32;
const YAML_EXTS = ['.yaml', '.yml'];
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** Absolute path of the file an object was parsed from, if known. */
export function sourceFileOf(node: unknown): string | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const value = (node as Record<string, unknown>)[SOURCE_KEY];
    return typeof value === 'string' ? value : undefined;
}

/** Load a YAML file and expand every `$import` it (transitively) contains. */
export async function loadYamlWithImports(file: string): Promise<any> {
    return loadFile(path.resolve(file), []);
}

async function loadFile(absPath: string, stack: string[]): Promise<any> {
    if (stack.includes(absPath)) {
        const chain = [...stack, absPath].map(f => path.basename(f)).join(' → ');
        throw new Error(`Circular $import: ${chain}`);
    }
    if (stack.length >= MAX_DEPTH) {
        throw new Error(`$import nested more than ${MAX_DEPTH} levels deep (${absPath})`);
    }
    if (!await fs.pathExists(absPath)) {
        throw new Error(`$import target not found: ${absPath}`);
    }

    const yaml = loadYamlModule();
    const raw = yaml.load(await fs.readFile(absPath, 'utf-8'));
    return expand(raw, absPath, [...stack, absPath]);
}

function loadYamlModule(): any {
    try {
        return require('js-yaml');
    } catch {
        throw new Error('js-yaml is required. Run: npm install js-yaml');
    }
}

async function expand(node: any, file: string, stack: string[]): Promise<any> {
    if (Array.isArray(node)) {
        const out: any[] = [];
        for (const item of node) {
            if (isImportNode(item)) {
                out.push(...(await expandImport(item, file, stack)).items);
            } else {
                out.push(await expand(item, file, stack));
            }
        }
        return out;
    }

    if (!isPlainObject(node)) return node;

    if (isImportNode(node)) {
        const { items, collapsible } = await expandImport(node, file, stack);
        // One imported document that is itself an object stays an object (a
        // section like `defaults`). A document holding a list, or several
        // matched files, stays a list even when it has a single entry.
        return collapsible ? items[0] : items;
    }

    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(node)) {
        out[key] = await expand(value, file, stack);
    }
    return tag(out, file);
}

/**
 * Expand one `$import` node into the list of values it contributes.
 * Sibling keys are shallow-merged over every imported object, which gives
 * per-group overrides: `- {$import: evals/hard, trials: 10}`.
 */
async function expandImport(
    node: Record<string, any>,
    file: string,
    stack: string[]
): Promise<{ items: any[]; collapsible: boolean }> {
    const { [IMPORT_KEY]: spec, ...overrides } = node;
    const specs = Array.isArray(spec) ? spec : [spec];

    const items: any[] = [];
    let documents = 0;
    let sawList = false;
    for (const one of specs) {
        if (typeof one !== 'string') {
            throw new Error(`$import expects a path or a list of paths (in ${path.basename(file)})`);
        }
        const targets = await resolveTargets(one, path.dirname(file));
        if (targets.length === 0) {
            throw new Error(`$import matched no files: "${one}" (in ${path.basename(file)})`);
        }
        for (const target of targets) {
            const doc = await loadFile(target, stack);
            documents++;
            sawList ||= Array.isArray(doc);
            items.push(...(Array.isArray(doc) ? doc : [doc]));
        }
    }

    const collapsible = documents === 1 && !sawList && isPlainObject(items[0]);

    if (Object.keys(overrides).length === 0) return { items, collapsible };

    const expandedOverrides = await expand(overrides, file, stack);
    const merged = items.map(item => {
        if (!isPlainObject(item)) {
            throw new Error(`$import "${specs.join(', ')}" returned a non-object, so the extra keys in ${path.basename(file)} have nothing to override`);
        }
        // The imported file, not the importing one, owns the merged object's
        // relative paths — spread drops the hidden tag, so re-apply it.
        return tag({ ...item, ...expandedOverrides }, sourceFileOf(item) ?? file);
    });

    return { items: merged, collapsible };
}

/** Resolve one import spec (a file, a directory, or a glob) to YAML file paths. */
async function resolveTargets(spec: string, baseDir: string): Promise<string[]> {
    if (!spec.includes('*')) {
        const candidate = path.resolve(baseDir, spec);
        const stat = await fs.stat(candidate).catch(() => null);
        if (stat?.isDirectory()) return collectYamlFiles(candidate);
        return [candidate];   // missing files are reported by loadFile
    }

    const segments = spec.split('/').filter(s => s !== '' && s !== '.');
    const firstMagic = segments.findIndex(s => s.includes('*'));
    const root = path.resolve(baseDir, ...segments.slice(0, firstMagic));
    const pattern = toRegExp(segments.slice(firstMagic));

    const files = await collectFiles(root);
    return files
        .filter(f => pattern.test(path.relative(root, f).split(path.sep).join('/')))
        .sort();
}

function toRegExp(segments: string[]): RegExp {
    const source = segments.map((segment, i) => {
        const last = i === segments.length - 1;
        if (segment === '**') return last ? '.*' : '(?:[^/]+/)*';
        const escaped = segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
        return last ? escaped : `${escaped}/`;
    }).join('');
    return new RegExp(`^${source}$`);
}

async function collectYamlFiles(dir: string): Promise<string[]> {
    const files = await collectFiles(dir);
    return files.filter(f => YAML_EXTS.includes(path.extname(f))).sort();
}

async function collectFiles(dir: string, depth = 0): Promise<string[]> {
    if (depth > MAX_DEPTH) return [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const out: string[] = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            out.push(...await collectFiles(full, depth + 1));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

function isImportNode(node: unknown): node is Record<string, any> {
    return isPlainObject(node) && IMPORT_KEY in node;
}

function isPlainObject(node: unknown): node is Record<string, any> {
    return !!node && typeof node === 'object' && !Array.isArray(node);
}

/** Record the source file without making it a visible (or serialized) key. */
function tag<T extends object>(node: T, file: string): T {
    Object.defineProperty(node, SOURCE_KEY, { value: file, enumerable: false, configurable: true });
    return node;
}
