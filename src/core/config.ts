/**
 * Parser and validator for eval.yaml config files.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import {
    EvalConfig,
    EvalDefaults,
    EvalTaskConfig,
    ResolvedTask,
    ResolvedGrader,
    WorkspaceMapping,
    EnvironmentConfig,
    AcpConfig,
} from './config.types';
import { loadYamlWithImports, sourceFileOf } from './imports';

// We use a simple YAML parser — js-yaml is the standard
// For now, we'll use a lightweight approach: JSON-compatible YAML subset

const DEFAULT_CONFIG: EvalDefaults = {
    agent: 'gemini',
    provider: 'docker',
    trials: 5,
    timeout: 300,
    threshold: 0.8,
    docker: {
        base: 'node:20-slim',
    },
    environment: {
        cpus: 2,
        memory_mb: 2048,
    },
};

/**
 * Load and parse eval.yaml from a directory.
 */
export async function loadEvalConfig(dir: string): Promise<EvalConfig> {
    const yamlPath = path.join(dir, 'eval.yaml');
    if (!await fs.pathExists(yamlPath)) {
        throw new Error(`No eval.yaml found in ${dir}`);
    }

    // Sections may live in other files — expand every `$import` first
    const raw = await loadYamlWithImports(yamlPath);

    return validateConfig(raw);
}

/**
 * Validate raw parsed YAML into a typed EvalConfig.
 */
function validateConfig(raw: any): EvalConfig {
    if (!raw || typeof raw !== 'object') {
        throw new Error('eval.yaml must be a YAML object');
    }

    const version = raw.version || '1';

    // Handle ACP config
    let acp: AcpConfig | undefined;
    if (raw.defaults?.acp) {
        if (!raw.defaults.acp.command) {
            throw new Error('eval.yaml: acp.command is required when using ACP agent');
        }
        acp = {
            command: raw.defaults.acp.command,
            env: raw.defaults.acp.env,
        };
    }

    const defaults: EvalDefaults = {
        ...DEFAULT_CONFIG,
        ...(raw.defaults || {}),
        docker: {
            ...DEFAULT_CONFIG.docker,
            ...(raw.defaults?.docker || {}),
        },
        environment: {
            ...DEFAULT_CONFIG.environment,
            ...(raw.defaults?.environment || {}),
        },
    };

    // Add ACP config if present
    if (acp) {
        defaults.acp = acp;
    }

    // Validate grader_provider
    const validGraderProviders = ['gemini', 'anthropic', 'openai'];
    if (defaults.grader_provider && !validGraderProviders.includes(defaults.grader_provider)) {
        throw new Error(`eval.yaml: grader_provider must be one of ${validGraderProviders.join(', ')}, got "${defaults.grader_provider}"`);
    }

    if (!raw.tasks || !Array.isArray(raw.tasks) || raw.tasks.length === 0) {
        throw new Error('eval.yaml must have at least one task in the "tasks" array');
    }

    const tasks: EvalTaskConfig[] = raw.tasks.map((t: any, i: number) => {
        if (!t.name) throw new Error(`Task ${i} is missing a "name"`);
        if (!t.instruction) throw new Error(`Task "${t.name}" is missing an "instruction"`);
        if (!t.graders || !Array.isArray(t.graders) || t.graders.length === 0) {
            throw new Error(`Task "${t.name}" must have at least one grader`);
        }
        if (t.grader_provider && !validGraderProviders.includes(t.grader_provider)) {
            throw new Error(`Task "${t.name}" has invalid grader_provider "${t.grader_provider}", must be one of ${validGraderProviders.join(', ')}`);
        }

        // The "command" agent requires a command (per-task override or inherited default)
        const effectiveAgent = t.agent || defaults.agent;
        const effectiveCommand = t.command || defaults.command;
        if (effectiveAgent === 'command' && !effectiveCommand) {
            throw new Error(`Task "${t.name}" uses the "command" agent but no command is set (add a "command" to the task or defaults)`);
        }

        const workspace: WorkspaceMapping[] = (t.workspace || []).map((w: any) => {
            if (typeof w === 'string') {
                // Support shorthand: "fixtures/app.js" → same filename in workspace
                return { src: w, dest: path.basename(w) };
            }
            if (!w.src || !w.dest) {
                throw new Error(`Task "${t.name}" has a workspace mapping without src/dest`);
            }
            return { src: w.src, dest: w.dest, chmod: w.chmod };
        });

        return {
            name: t.name,
            instruction: t.instruction,
            workspace,
            graders: t.graders.map((g: any) => {
                if (g.provider && !validGraderProviders.includes(g.provider)) {
                    throw new Error(`Task "${t.name}" grader has invalid provider "${g.provider}", must be one of ${validGraderProviders.join(', ')}`);
                }
                return {
                    type: g.type,
                    setup: g.setup,
                    run: g.run,
                    rubric: g.rubric,
                    model: g.model,
                    provider: g.provider,
                    weight: g.weight ?? 1.0,
                };
            }),
            solution: t.solution,
            agent: t.agent,
            command: t.command,
            provider: t.provider,
            trials: t.trials,
            timeout: t.timeout,
            grader_model: t.grader_model,
            grader_provider: t.grader_provider,
            docker: t.docker,
            environment: t.environment,
            sourceFile: sourceFileOf(t),
        };
    });

    return { version, skill: raw.skill, defaults, tasks };
}

/**
 * Resolve a single task: apply defaults, resolve file references to content.
 */
export async function resolveTask(
    task: EvalTaskConfig,
    defaults: EvalDefaults,
    baseDir: string
): Promise<ResolvedTask> {
    // Merge defaults with task overrides
    const agent = task.agent || defaults.agent;
    const command = task.command || defaults.command;
    const provider = task.provider || defaults.provider;
    const trials = task.trials ?? defaults.trials;
    const timeout = task.timeout ?? defaults.timeout;
    const docker = {
        ...defaults.docker,
        ...(task.docker || {}),
    };
    const environment: EnvironmentConfig = {
        ...defaults.environment,
        ...(task.environment || {}),
    };
    const grader_model = task.grader_model || defaults.grader_model;
    const grader_provider = task.grader_provider || defaults.grader_provider;
    const acp = defaults.acp;  // ACP config is only at defaults level

    // An imported task's relative paths belong to its own directory first,
    // then fall back to the eval root so shared graders/fixtures keep working.
    const baseDirs = [...new Set([
        ...(task.sourceFile ? [path.dirname(task.sourceFile)] : []),
        baseDir,
    ])];

    // Resolve instruction — could be inline text or file path
    const instruction = await resolveFileOrInline(task.instruction, baseDirs);

    // Resolve graders
    const graders: ResolvedGrader[] = await Promise.all(
        task.graders.map(async g => {
            const resolved: ResolvedGrader = {
                type: g.type,
                setup: g.setup,
                model: g.model,
                provider: g.provider,
                weight: g.weight,
            };
            if (g.type === 'deterministic' && g.run) {
                resolved.run = await resolveFileOrInline(g.run, baseDirs);
            }
            if (g.type === 'llm_rubric' && g.rubric) {
                resolved.rubric = await resolveFileOrInline(g.rubric, baseDirs);
            }
            return resolved;
        })
    );

    // Resolve solution path
    const solution = task.solution
        ? await resolveExistingPath(task.solution, baseDirs)
        : undefined;

    return {
        name: task.name,
        instruction,
        workspace: task.workspace || [],
        graders,
        solution,
        agent,
        command,
        provider,
        trials,
        timeout,
        grader_model,
        grader_provider,
        acp,
        docker,
        environment,
        baseDirs,
    };
}

/**
 * If value looks like a file path and the file exists, read it.
 * Otherwise return the value as-is (inline content).
 */
async function resolveFileOrInline(value: string, baseDirs: string[]): Promise<string> {
    const trimmed = value.trim();

    // Multi-line strings are always inline content
    if (trimmed.includes('\n')) return trimmed;

    // Check if it could be a file path (no spaces except in path, has extension)
    for (const baseDir of baseDirs) {
        const candidate = path.resolve(baseDir, trimmed);
        if (await fs.pathExists(candidate)) {
            return (await fs.readFile(candidate, 'utf-8')).trim();
        }
    }

    return trimmed;
}

/** Resolve a relative path against the first base dir that contains it. */
async function resolveExistingPath(value: string, baseDirs: string[]): Promise<string> {
    for (const baseDir of baseDirs) {
        const candidate = path.resolve(baseDir, value);
        if (await fs.pathExists(candidate)) return candidate;
    }
    return path.resolve(baseDirs[baseDirs.length - 1], value);
}
