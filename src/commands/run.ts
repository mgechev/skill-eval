/**
 * `skillgrade` (run) command.
 *
 * Reads eval.yaml, resolves tasks, and executes evals.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { loadEvalConfig, resolveTask } from '../core/config';
import { detectSkills } from '../core/skills';
import { DockerProvider } from '../providers/docker';
import { LocalProvider } from '../providers/local';
import { EvalRunner, EvalRunOptions } from '../evalRunner';
import { createAgent, AgentConfig } from '../agents/registry';
import { BaseAgent, EvalReport } from '../types';
import { ResolvedTask } from '../core/config.types';
import { parseEnvFile } from '../utils/env';
import { fmt, header, kv, trialRow, resultsSummary, validationResult } from '../utils/cli';

interface RunOptions {
    eval?: string;       // run specific eval(s) by name (comma-separated)
    trials?: number;     // override trial count
    parallel?: number;
    validate?: boolean;
    ci?: boolean;
    threshold?: number;
    preset?: 'smoke' | 'reliable' | 'regression';
    agent?: string;      // override agent (gemini|claude|codex|acp)
    provider?: string;   // override provider (docker|local)
    output?: string;     // output directory for reports and temp files
    grader?: string;     // filter graders by type (deterministic|llm_rubric)
    acpCommand?: string; // ACP agent command (e.g., "gemini --acp")
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
    if (await fs.pathExists(filePath)) {
        return parseEnvFile(await fs.readFile(filePath, 'utf-8'));
    }
    return {};
}

export async function runEvals(dir: string, opts: RunOptions) {
    console.log(`\n${fmt.bold('skillgrade')}\n`);

    // Load eval.yaml
    const config = await loadEvalConfig(dir);

    // Load environment variables
    const rootEnv = await loadEnvFile(path.join(dir, '.env'));
    const env: Record<string, string> = { ...rootEnv };
    if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    if (Object.keys(rootEnv).length > 0) {
        kv('env', Object.keys(rootEnv).join(', '));
    }

    // Detect skills
    let skillsPaths: string[] = [];
    if (config.skill) {
        let skillDir = path.resolve(dir, config.skill);
        const stat = await fs.stat(skillDir).catch(() => null);
        if (stat?.isFile()) {
            skillDir = path.dirname(skillDir);
        }
        if (stat && await fs.pathExists(skillDir)) {
            skillsPaths = [skillDir];
            kv('skill', path.relative(dir, skillDir) || '.');
        } else {
            console.error(`  ${fmt.red('warning')}  skill path not found: ${config.skill}`);
        }
    } else {
        const skills = await detectSkills(dir);
        skillsPaths = skills.map(s => s.path);
        if (skills.length > 0) {
            kv('skills', skills.map(s => s.name).join(', '));
        }
    }

    // Filter evals
    let tasksToRun = config.tasks;
    if (opts.eval) {
        const evalNames = opts.eval.split(',').map(s => s.trim());
        tasksToRun = config.tasks.filter(t => evalNames.includes(t.name));
        if (tasksToRun.length === 0) {
            console.error(`  ${fmt.red('error')}  eval "${opts.eval}" not found`);
            console.log(`  ${fmt.dim('available:')} ${config.tasks.map(t => t.name).join(', ')}`);
            throw new Error(`Eval "${opts.eval}" not found`);
        }
    }

    // Output directory
    const outputBase = opts.output || path.join(os.tmpdir(), 'skillgrade');
    const skillName = path.basename(dir);
    const outputDir = path.join(outputBase, skillName);
    const resultsDir = path.join(outputDir, 'results');
    await fs.ensureDir(resultsDir);
    kv('output', outputDir);

    // Track CI results
    const reports: EvalReport[] = [];
    let allPassed = true;

    // Run each task
    for (const taskDef of tasksToRun) {
        const resolved = await resolveTask(taskDef, config.defaults, dir);
        const trials = opts.trials ?? resolved.trials;
        const parallel = opts.parallel ?? 1;

        // Create a temp task directory for Docker builds
        const tmpTaskDir = path.join(outputDir, 'tmp', resolved.name);
        await prepareTempTaskDir(resolved, dir, tmpTaskDir);

        // Build eval options — pass resolved content directly
        const evalOpts: EvalRunOptions = {
            instruction: resolved.instruction,
            graders: opts.grader
                ? resolved.graders.filter(g => g.type === opts.grader)
                : resolved.graders,
            timeoutSec: resolved.timeout,
            graderModel: resolved.grader_model,
            environment: resolved.environment,
        };

        // Pick agent: CLI flag > task-level override > auto-detect from API key > default
        let agentName = opts.agent || resolved.agent;
        if (!opts.agent && !taskDef.agent) {
            // No explicit override — auto-detect from available API keys
            const hasGemini = !!env.GEMINI_API_KEY;
            const hasAnthropic = !!env.ANTHROPIC_API_KEY;
            const hasOpenAI = !!env.OPENAI_API_KEY;
            const keyCount = [hasGemini, hasAnthropic, hasOpenAI].filter(Boolean).length;
            if (keyCount === 1) {
                if (hasAnthropic) agentName = 'claude';
                else if (hasOpenAI) agentName = 'codex';
                else if (hasGemini) agentName = 'gemini';
            }
        }
        const providerName = opts.provider || resolved.provider;

        // Build agent config (for ACP agent)
        const agentConfig: AgentConfig = {};
        if (agentName === 'acp') {
            // Use CLI flag > eval.yaml config > default
            const acpCommand = opts.acpCommand || resolved.acp?.command;
            if (!acpCommand) {
                throw new Error('ACP agent requires a command. Specify via --acp-command or acp.command in eval.yaml');
            }
            agentConfig.acp = {
                command: acpCommand,
                env: resolved.acp?.env,
                apiKey: env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY,
            };
        }

        // Pick provider
        const provider = providerName === 'docker'
            ? new DockerProvider()
            : new LocalProvider();

        const runner = new EvalRunner(provider, resultsDir);

        if (opts.validate) {
            // Validation mode
            if (!resolved.solution) {
                console.error(`  ${fmt.red('error')}  task "${resolved.name}" has no solution defined`);
                continue;
            }

            header(`validate: ${resolved.name}`);

            const solveAgent = {
                async run(_instruction: string, _workspace: string, runCommand: any) {
                    const result = await runCommand(`bash ${path.basename(resolved.solution!)}`);
                    return result.stdout;
                }
            } as BaseAgent;

            const report = await runner.runEval(solveAgent, tmpTaskDir, skillsPaths, evalOpts, 1, env);
            const passed = report.trials[0].reward >= 0.5;

            validationResult(passed, report.trials[0].reward, report.trials[0].grader_results.map(gr => ({
                type: gr.grader_type,
                score: gr.score,
                details: gr.details
            })));

            if (!passed) allPassed = false;
        } else {
            // Normal eval mode
            const agent = createAgent(agentName, agentConfig);

            header(resolved.name);
            console.log(`    ${fmt.dim('agent')} ${agentName}  ${fmt.dim('provider')} ${providerName}  ${fmt.dim('trials')} ${trials}${parallel > 1 ? `  ${fmt.dim('parallel')} ${parallel}` : ''}`);
            console.log();

            try {
                const report = await runner.runEval(agent, tmpTaskDir, skillsPaths, evalOpts, trials, env, parallel);
                reports.push(report);

                // LLM grader reasoning (condensed)
                for (const trial of report.trials) {
                    for (const g of trial.grader_results.filter(g => g.grader_type === 'llm_rubric')) {
                        console.log(`    ${fmt.dim(`trial ${trial.trial_id} llm_rubric:`)} ${g.details.substring(0, 120)}`);
                    }
                }

                resultsSummary(report.pass_rate, report.pass_at_k, report.pass_pow_k, trials, opts.preset);

                if (report.pass_rate < (opts.threshold ?? config.defaults.threshold)) {
                    allPassed = false;
                }
            } catch (err) {
                console.error(`\n  ${fmt.fail('error')}  evaluation failed: ${err}\n`);
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
            console.error(`\n  ${fmt.fail('CI FAILED')}  below threshold ${(threshold * 100).toFixed(0)}%\n`);
            throw new Error('CI check failed');
        }
        console.log(`\n  ${fmt.pass('CI PASSED')}  above threshold ${(threshold * 100).toFixed(0)}%\n`);
    }
}

/**
 * Create a temp task directory for Docker builds.
 * Contains: Dockerfile, workspace files, grader scripts.
 * No longer writes task.toml or instruction.md — those are passed directly.
 */
async function prepareTempTaskDir(resolved: ResolvedTask, baseDir: string, tmpDir: string) {
    await fs.ensureDir(tmpDir);

    // Write each deterministic grader script
    await fs.ensureDir(path.join(tmpDir, 'tests'));
    const detGraders = resolved.graders.filter(g => g.type === 'deterministic');
    for (let i = 0; i < detGraders.length; i++) {
        if (detGraders[i].run) {
            const script = `#!/bin/bash\n${detGraders[i].run!.trim()}\n`;
            const filename = i === 0 ? 'test.sh' : `test_${i}.sh`;
            await fs.writeFile(path.join(tmpDir, 'tests', filename), script);
        }
    }

    // Copy referenced grader files/directories
    for (const g of resolved.graders) {
        if (g.type === 'deterministic' && g.run) {
            const pathMatches = g.run.match(/[\w./-]+\.\w{1,4}/g) || [];
            for (const ref of pathMatches) {
                const refDir = ref.split('/')[0];
                const srcDir = path.resolve(baseDir, refDir);
                const destDir = path.join(tmpDir, refDir);
                if (refDir !== ref && await fs.pathExists(srcDir) && !await fs.pathExists(destDir)) {
                    await fs.copy(srcDir, destDir);
                }
            }
        }
    }

    // Write each LLM rubric
    await fs.ensureDir(path.join(tmpDir, 'prompts'));
    const llmGraders = resolved.graders.filter(g => g.type === 'llm_rubric');
    for (let i = 0; i < llmGraders.length; i++) {
        if (llmGraders[i].rubric) {
            const filename = i === 0 ? 'quality.md' : `quality_${i}.md`;
            await fs.writeFile(path.join(tmpDir, 'prompts', filename), llmGraders[i].rubric!);
        }
    }

    // Write Dockerfile
    await fs.ensureDir(path.join(tmpDir, 'environment'));
    let dockerfileContent = `FROM ${resolved.docker.base}\n\nWORKDIR /workspace\n\n`;

    // Install agent CLI
    if (resolved.agent === 'gemini') {
        dockerfileContent += `RUN npm install -g @google/gemini-cli\n\n`;
    } else if (resolved.agent === 'claude') {
        dockerfileContent += `RUN npm install -g @anthropic-ai/claude-code\n\n`;
    } else if (resolved.agent === 'codex') {
        dockerfileContent += `RUN npm install -g @openai/codex\n\n`;
    } else if (resolved.agent === 'acp') {
        // For ACP agent, install gemini-cli as the default ACP-compatible agent
        // Users can customize the command via acp.command in eval.yaml
        // Note: ACP agent works best with --provider=local since it requires
        // the ACP command to be available in the host environment
        dockerfileContent += `RUN npm install -g @google/gemini-cli\n\n`;
    }

    // Docker setup commands
    if (resolved.docker.setup) {
        dockerfileContent += `RUN ${resolved.docker.setup.trim()}\n\n`;
    }

    // Grader setup commands
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
