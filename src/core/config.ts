/**
 * Parser and validator for eval.yaml config files.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import {
    EvalConfig,
    EvalDefaults,
    EvalTaskConfig,
    ResolvedTask,
    ResolvedGrader,
    WorkspaceMapping,
    EnvironmentConfig,
    TrialConfig,
} from './config.types';

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

    // Dynamically import js-yaml
    let yaml: any;
    try {
        yaml = require('js-yaml');
    } catch {
        throw new Error('js-yaml is required. Run: npm install js-yaml');
    }

    const content = await fs.readFile(yamlPath, 'utf-8');
    const raw = yaml.load(content) as any;

    return validateConfig(raw);
}

function validateMounts(mounts: any, context: string) {
    if (mounts) {
        if (!Array.isArray(mounts)) {
            throw new Error(`${context} must be an array`);
        }
        for (const m of mounts) {
            if (typeof m !== 'string') {
                throw new Error(`${context} must be an array of strings`);
            }
        }
    }
}

function validateTrialConfig(tc: any, context: string) {
    if (tc) {
        if (typeof tc !== 'object') {
            throw new Error(`${context} must be an object`);
        }
        if (tc.setup && typeof tc.setup !== 'string') {
            throw new Error(`${context}.setup must be a string`);
        }
        if (tc.cleanup && typeof tc.cleanup !== 'string') {
            throw new Error(`${context}.cleanup must be a string`);
        }
        if (tc.env && typeof tc.env !== 'object') {
            throw new Error(`${context}.env must be an object`);
        }
    }
}

/**
 * Validate raw parsed YAML into a typed EvalConfig.
 */
function validateConfig(raw: any): EvalConfig {
    if (!raw || typeof raw !== 'object') {
        throw new Error('eval.yaml must be a YAML object');
    }

    const version = raw.version || '1';
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
        env: raw.defaults?.env,
        trialConfig: raw.defaults?.trialConfig,
    };

    validateMounts(defaults.environment.mounts, 'defaults.environment.mounts');
    validateTrialConfig(defaults.trialConfig, 'defaults.trialConfig');

    if (!raw.tasks || !Array.isArray(raw.tasks) || raw.tasks.length === 0) {
        throw new Error('eval.yaml must have at least one task in the "tasks" array');
    }

    const tasks: EvalTaskConfig[] = raw.tasks.map((t: any, i: number) => {
        if (!t.name) throw new Error(`Task ${i} is missing a "name"`);
        if (!t.instruction) throw new Error(`Task "${t.name}" is missing an "instruction"`);
        if (!t.graders || !Array.isArray(t.graders) || t.graders.length === 0) {
            throw new Error(`Task "${t.name}" must have at least one grader`);
        }

        if (t.environment) {
            validateMounts(t.environment.mounts, `Task "${t.name}" environment.mounts`);
        }

        validateTrialConfig(t.trialConfig, `Task "${t.name}" trialConfig`);

        if (t.agentWorkingDir && typeof t.agentWorkingDir !== 'string') {
            throw new Error(`Task "${t.name}" agentWorkingDir must be a string`);
        }

        const workspace: WorkspaceMapping[] = (t.workspace || []).map((w: any) => {
            if (typeof w === 'string') {
                // Support shorthand: "fixtures/app.js" → same filename in workspace
                return { src: w, dest: path.basename(w) };
            }
            if (!w.dest) {
                throw new Error(`Task "${t.name}" has a workspace mapping without dest`);
            }
            if (!w.src && w.content === undefined) {
                throw new Error(`Task "${t.name}" has a workspace mapping without src or content`);
            }
            if (w.src && w.content !== undefined) {
                throw new Error(`Task "${t.name}" has a workspace mapping with both src and content`);
            }
            return { src: w.src, content: w.content, dest: w.dest, chmod: w.chmod };
        });

        return {
            name: t.name,
            instruction: t.instruction,
            workspace,
            graders: t.graders.map((g: any) => {
                if (g.type === 'tool_usage') {
                    if (g.expectedTools) {
                        if (!Array.isArray(g.expectedTools)) {
                            throw new Error(`Task "${t.name}" has invalid expectedTools: must be an array`);
                        }
                        for (const et of g.expectedTools) {
                            if (typeof et !== 'object' || !et.name) {
                                throw new Error(`Task "${t.name}" has invalid expectedTool: must be an object with a "name" property`);
                            }
                        }
                    }
                }
                return {
                    type: g.type,
                    setup: g.setup,
                    run: g.run,
                    rubric: g.rubric,
                    model: g.model,
                    weight: g.weight ?? 1.0,
                    expectedTools: g.expectedTools,
                };
            }),
            solution: t.solution,
            agent: t.agent,
            provider: t.provider,
            trials: t.trials,
            timeout: t.timeout,
            docker: t.docker,
            trialConfig: t.trialConfig,
            env: t.env,
            environment: t.environment,
            agentWorkingDir: t.agentWorkingDir,
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

    if (environment.mounts) {
        environment.mounts = environment.mounts.map(m => {
            if (m.startsWith('~')) {
                return os.homedir() + m.slice(1);
            }
            return m;
        });
    }

    const grader_model = task.grader_model || defaults.grader_model;
    const env = {
        ...defaults.env,
        ...task.env,
    };

    // Resolve instruction — could be inline text or file path
    const instruction = await resolveFileOrInline(task.instruction, baseDir);

    // Resolve graders
    const graders: ResolvedGrader[] = await Promise.all(
        task.graders.map(async g => {
            const resolved: ResolvedGrader = {
                type: g.type,
                setup: g.setup,
                model: g.model,
                weight: g.weight,
                expectedTools: g.expectedTools,
            };
            if (g.type === 'deterministic' && g.run) {
                resolved.run = await resolveFileOrInline(g.run, baseDir);
            }
            if (g.type === 'llm_rubric' && g.rubric) {
                resolved.rubric = await resolveFileOrInline(g.rubric, baseDir);
            }
            return resolved;
        })
    );

    // Resolve solution path
    const solution = task.solution
        ? path.resolve(baseDir, task.solution)
        : undefined;

    // Merge trialConfig
    const defaultTC = defaults.trialConfig;
    const taskTC = task.trialConfig;
    let trialConfig: TrialConfig | undefined = undefined;

    if (defaultTC || taskTC) {
        const env = {
            ...defaultTC?.env,
            ...taskTC?.env,
        };

        const setupParts = [];
        if (defaultTC?.setup) setupParts.push(await resolveFileOrInline(defaultTC.setup, baseDir));
        if (taskTC?.setup) setupParts.push(await resolveFileOrInline(taskTC.setup, baseDir));

        const cleanupParts = [];
        if (defaultTC?.cleanup) cleanupParts.push(await resolveFileOrInline(defaultTC.cleanup, baseDir));
        if (taskTC?.cleanup) cleanupParts.push(await resolveFileOrInline(taskTC.cleanup, baseDir));

        const mergedEnv = Object.keys(env).length > 0 ? env : undefined;
        const mergedSetup = setupParts.length > 0 ? setupParts.join('\n') : undefined;
        const mergedCleanup = cleanupParts.length > 0 ? cleanupParts.join('\n') : undefined;

        if (mergedEnv || mergedSetup || mergedCleanup) {
            trialConfig = {
                env: mergedEnv,
                setup: mergedSetup,
                cleanup: mergedCleanup,
            };
        }
    }

    return {
        name: task.name,
        instruction,
        workspace: task.workspace || [],
        graders,
        solution,
        agent,
        provider,
        trials,
        timeout,
        grader_model,
        docker,
        environment,
        env,
        trialConfig,
        agentWorkingDir: task.agentWorkingDir,
    };
}

/**
 * If value looks like a file path and the file exists, read it.
 * Otherwise return the value as-is (inline content).
 */
async function resolveFileOrInline(value: string, baseDir: string): Promise<string> {
    const trimmed = value.trim();

    // Multi-line strings are always inline content
    if (trimmed.includes('\n')) return trimmed;

    // Check if it could be a file path (no spaces except in path, has extension)
    const candidate = path.resolve(baseDir, trimmed);
    if (await fs.pathExists(candidate)) {
        return (await fs.readFile(candidate, 'utf-8')).trim();
    }

    return trimmed;
}
