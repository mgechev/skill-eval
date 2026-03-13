/**
 * `skilleval` (run) command.
 *
 * Reads eval.yaml, resolves tasks, and executes evals using the existing
 * EvalRunner infrastructure.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { loadEvalConfig, resolveTask } from '../core/config';
import { detectSkills } from '../core/skills';
import { DockerProvider } from '../providers/docker';
import { LocalProvider } from '../providers/local';
import { EvalRunner } from '../evalRunner';
import { GeminiAgent } from '../agents/gemini';
import { ClaudeAgent } from '../agents/claude';
import { BaseAgent, TaskConfig, EvalReport } from '../types';
import { ResolvedTask } from '../core/config.types';

interface RunOptions {
    task?: string;       // run specific task by name
    trials?: number;     // override trial count
    parallel?: number;
    validate?: boolean;
    ci?: boolean;
    threshold?: number;
    preset?: 'smoke' | 'reliable' | 'regression';
    agent?: string;      // override agent (gemini|claude)
    provider?: string;   // override provider (docker|local)
    output?: string;     // output directory for reports and temp files
}

/**
 * Parse .env file content into key-value pairs.
 */
function parseEnvFile(content: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let value = trimmed.substring(eqIdx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
    if (await fs.pathExists(filePath)) {
        return parseEnvFile(await fs.readFile(filePath, 'utf-8'));
    }
    return {};
}

export async function runEvals(dir: string, opts: RunOptions) {
    // Load eval.yaml
    const config = await loadEvalConfig(dir);

    // Load environment variables
    const rootEnv = await loadEnvFile(path.join(dir, '.env'));
    const env: Record<string, string> = { ...rootEnv };
    if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    if (Object.keys(rootEnv).length > 0) {
        console.log(`  Loaded .env: ${Object.keys(rootEnv).join(', ')}`);
    }

    // Detect skills — use explicit path from eval.yaml, or auto-detect
    // The skill path can point to a directory (containing SKILL.md) or to SKILL.md directly.
    // The entire directory (scripts, references, etc.) is copied into the Docker container.
    let skillsPaths: string[] = [];
    if (config.skill) {
        let skillDir = path.resolve(dir, config.skill);
        const stat = await fs.stat(skillDir).catch(() => null);
        if (stat?.isFile()) {
            // If pointing to a file (e.g. SKILL.md), use its parent directory
            skillDir = path.dirname(skillDir);
        }
        if (stat && await fs.pathExists(skillDir)) {
            skillsPaths = [skillDir];
            console.log(`  Skill: ${path.relative(dir, skillDir) || '.'}`);
        } else {
            console.error(`  ⚠ Skill path not found: ${config.skill}`);
        }
    } else {
        const skills = await detectSkills(dir);
        skillsPaths = skills.map(s => s.path);
        if (skills.length > 0) {
            console.log(`  Skills: ${skills.map(s => s.name).join(', ')}`);
        }
    }

    // Filter tasks
    let tasksToRun = config.tasks;
    if (opts.task) {
        tasksToRun = config.tasks.filter(t => t.name === opts.task);
        if (tasksToRun.length === 0) {
            console.error(`  ❌ Task "${opts.task}" not found in eval.yaml`);
            console.log(`  Available tasks: ${config.tasks.map(t => t.name).join(', ')}`);
            process.exit(1);
        }
    }

    // Output directory — uses OS temp by default, overridden by --output
    const outputBase = opts.output || path.join(require('os').tmpdir(), 'skilleval');
    const skillName = path.basename(dir);
    const outputDir = path.join(outputBase, skillName);
    const resultsDir = path.join(outputDir, 'results');
    await fs.ensureDir(resultsDir);
    console.log(`  Output: ${outputDir}`);

    // Track CI results
    const reports: EvalReport[] = [];
    let allPassed = true;

    // Run each task
    for (const taskDef of tasksToRun) {
        const resolved = await resolveTask(taskDef, config.defaults, dir);
        const trials = opts.trials ?? resolved.trials;
        const parallel = opts.parallel ?? 1;

        // Convert resolved task to a TaskConfig for the existing evalRunner
        const taskConfig = resolvedToTaskConfig(resolved);

        // Create a temp task directory that mirrors what evalRunner expects
        const tmpTaskDir = path.join(outputDir, 'tmp', resolved.name);
        await prepareTempTaskDir(resolved, dir, tmpTaskDir);

        // Apply CLI overrides
        const agentName = opts.agent || resolved.agent;
        const providerName = opts.provider || resolved.provider;

        // Pick provider
        const provider = providerName === 'docker'
            ? new DockerProvider()
            : new LocalProvider();

        const runner = new EvalRunner(provider, resultsDir);

        if (opts.validate) {
            // Validation mode
            if (!resolved.solution) {
                console.error(`  ❌ Task "${resolved.name}" has no solution defined.`);
                continue;
            }

            console.log(`\n  🔍 Validating "${resolved.name}" with reference solution...\n`);

            const solveAgent = {
                async run(_instruction: string, _workspace: string, runCommand: any) {
                    const result = await runCommand(`bash ${path.basename(resolved.solution!)}`);
                    return result.stdout;
                }
            } as BaseAgent;

            const report = await runner.runEval(solveAgent, tmpTaskDir, skillsPaths, 1, env);
            const passed = report.trials[0].reward >= 0.5;

            console.table(report.trials[0].grader_results.map(gr => ({
                Grader: gr.grader_type,
                Score: gr.score.toFixed(2),
                Weight: gr.weight,
            })));

            for (const gr of report.trials[0].grader_results) {
                console.log(`  [${gr.grader_type}] ${gr.details}`);
            }

            console.log(`\n  ${passed ? '✅ Validation PASSED' : '❌ Validation FAILED'} — reward: ${report.trials[0].reward.toFixed(2)}\n`);
            if (!passed) allPassed = false;
        } else {
            // Normal eval mode
            const agent = agentName === 'claude' ? new ClaudeAgent() : new GeminiAgent();

            console.log(`\n  🚀 ${resolved.name} | agent=${agentName} provider=${providerName} trials=${trials}${parallel > 1 ? ` parallel=${parallel}` : ''}\n`);

            try {
                const report = await runner.runEval(agent, tmpTaskDir, skillsPaths, trials, env, parallel);
                reports.push(report);

                // Per-trial summary
                console.table(report.trials.map(t => ({
                    Trial: t.trial_id,
                    Reward: t.reward.toFixed(2),
                    Duration: (t.duration_ms / 1000).toFixed(1) + 's',
                    Commands: t.n_commands,
                    'Tokens (in/out)': `~${t.input_tokens}/${t.output_tokens}`,
                    Graders: t.grader_results.map(g => `${g.grader_type}:${g.score.toFixed(1)}`).join(' ')
                })));

                // LLM grader reasoning
                for (const trial of report.trials) {
                    for (const g of trial.grader_results.filter(g => g.grader_type === 'llm_rubric')) {
                        console.log(`  Trial ${trial.trial_id} [${g.grader_type}] score=${g.score.toFixed(2)}: ${g.details}`);
                    }
                }

                // Summary — highlight the key metric for the preset
                const presetLabel = opts.preset === 'smoke' ? ' (smoke test)'
                    : opts.preset === 'reliable' ? ' (reliable pass rate)'
                        : opts.preset === 'regression' ? ' (regression check)'
                            : '';
                console.log(`\n  ── Results${presetLabel} ${'─'.repeat(50)}`);
                console.log(`  Pass Rate  ${(report.pass_rate * 100).toFixed(1)}%${opts.preset === 'reliable' ? '  ◀ key metric' : ''}`);
                console.log(`  pass@${trials}    ${(report.pass_at_k * 100).toFixed(1)}%${opts.preset === 'smoke' ? '  ◀ key metric' : ''}`);
                console.log(`  pass^${trials}    ${(report.pass_pow_k * 100).toFixed(1)}%${opts.preset === 'regression' ? '  ◀ key metric' : ''}\n`);

                if (report.pass_rate < (opts.threshold ?? config.defaults.threshold)) {
                    allPassed = false;
                }
            } catch (err) {
                console.error(`\n  ❌ Evaluation failed: ${err}\n`);
                allPassed = false;
            }
        }

        // Cleanup temp dir
        try { await fs.remove(tmpTaskDir); } catch { /* ignore cleanup errors */ }
    }

    // CI mode: exit with appropriate code
    if (opts.ci) {
        const threshold = opts.threshold ?? config.defaults.threshold;
        if (!allPassed) {
            console.error(`\n  ❌ CI check failed (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
            process.exit(1);
        }
        console.log(`\n  ✅ CI check passed (threshold: ${(threshold * 100).toFixed(0)}%)\n`);
    }
}

/**
 * Convert ResolvedTask to the legacy TaskConfig format that evalRunner expects.
 */
function resolvedToTaskConfig(resolved: ResolvedTask): TaskConfig {
    return {
        version: '1',
        metadata: {
            author_name: '',
            author_email: '',
            difficulty: 'medium',
            category: 'skilleval',
            tags: [],
        },
        graders: resolved.graders.map(g => ({
            type: g.type,
            command: g.type === 'deterministic' ? 'bash tests/test.sh' : undefined,
            rubric: g.type === 'llm_rubric' ? 'prompts/quality.md' : undefined,
            weight: g.weight,
        })),
        agent: { timeout_sec: resolved.timeout },
        environment: {
            build_timeout_sec: 180,
            cpus: 2,
            memory_mb: 2048,
            storage_mb: 500,
        },
    };
}

/**
 * Create a temp task directory in the legacy format that evalRunner expects.
 * Maps the eval.yaml config to the old directory structure.
 */
async function prepareTempTaskDir(resolved: ResolvedTask, baseDir: string, tmpDir: string) {
    await fs.ensureDir(tmpDir);

    // Write instruction
    await fs.writeFile(path.join(tmpDir, 'instruction.md'), resolved.instruction);

    // Write task.toml
    const tomlContent = `version = "1.0"

[agent]
timeout_sec = ${resolved.timeout}

[environment]
build_timeout_sec = 180
cpus = 2
memory_mb = 2048
storage_mb = 500

${resolved.graders.map(g => {
        if (g.type === 'deterministic') {
            return `[[graders]]\ntype = "deterministic"\ncommand = "bash tests/test.sh"\nweight = ${g.weight}`;
        } else {
            return `[[graders]]\ntype = "llm_rubric"\nrubric = "prompts/quality.md"\nweight = ${g.weight}`;
        }
    }).join('\n\n')}
`;
    await fs.writeFile(path.join(tmpDir, 'task.toml'), tomlContent);

    // Write deterministic grader scripts
    await fs.ensureDir(path.join(tmpDir, 'tests'));
    const detGraders = resolved.graders.filter(g => g.type === 'deterministic');
    if (detGraders.length > 0 && detGraders[0].run) {
        // The grader script must output JSON: { "score": 0-1, "details": "..." }
        const script = `#!/bin/bash
# Run the grader check
${detGraders[0].run.trim()}
`;
        await fs.writeFile(path.join(tmpDir, 'tests', 'test.sh'), script);
    }

    // Copy referenced grader files/directories into the temp dir
    // Look for file references in grader run commands (e.g., "graders/check.ts")
    for (const g of resolved.graders) {
        if (g.type === 'deterministic' && g.run) {
            // Extract potential file paths from the run command
            const pathMatches = g.run.match(/[\w./-]+\.\w{1,4}/g) || [];
            for (const ref of pathMatches) {
                const refDir = ref.split('/')[0]; // e.g., "graders" from "graders/check.ts"
                const srcDir = path.resolve(baseDir, refDir);
                const destDir = path.join(tmpDir, refDir);
                if (refDir !== ref && await fs.pathExists(srcDir) && !await fs.pathExists(destDir)) {
                    await fs.copy(srcDir, destDir);
                }
            }
        }
    }

    // Write LLM rubric
    await fs.ensureDir(path.join(tmpDir, 'prompts'));
    const llmGraders = resolved.graders.filter(g => g.type === 'llm_rubric');
    if (llmGraders.length > 0 && llmGraders[0].rubric) {
        await fs.writeFile(path.join(tmpDir, 'prompts', 'quality.md'), llmGraders[0].rubric);
    }

    // Write Dockerfile
    await fs.ensureDir(path.join(tmpDir, 'environment'));
    let dockerfileContent = `FROM ${resolved.docker.base}\n\nWORKDIR /workspace\n\n`;

    // Install agent
    if (resolved.agent === 'gemini') {
        dockerfileContent += `RUN npm install -g @google/gemini-cli\n\n`;
    }

    // Docker setup commands
    if (resolved.docker.setup) {
        dockerfileContent += `RUN ${resolved.docker.setup.trim()}\n\n`;
    }

    // Grader setup commands (install grader-specific dependencies)
    for (const g of resolved.graders) {
        if (g.setup) {
            dockerfileContent += `# Grader setup\nRUN ${g.setup.trim()}\n\n`;
        }
    }

    // Copy workspace files
    for (const w of resolved.workspace) {
        const srcPath = path.resolve(baseDir, w.src);
        const destInTmp = path.join(tmpDir, path.basename(w.src));
        if (await fs.pathExists(srcPath)) {
            await fs.copy(srcPath, destInTmp);
            dockerfileContent += `COPY ${path.basename(w.src)} ${w.dest}\n`;
            if (w.chmod) {
                dockerfileContent += `RUN chmod ${w.chmod} ${w.dest}\n`;
            }
        }
    }

    dockerfileContent += `\nCOPY . .\nCMD ["bash"]\n`;
    await fs.writeFile(path.join(tmpDir, 'environment', 'Dockerfile'), dockerfileContent);
}

