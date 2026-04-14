import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import {
    BaseAgent, EnvironmentProvider,
    LogEntry, TrialResult, EvalReport, GraderResult
} from './types';
import { ResolvedGrader, TrialConfig } from './core/config.types';
import { getGrader } from './graders';
import { fmt, Spinner } from './utils/cli';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

        promise.then(
            (val) => { clearTimeout(timer); resolve(val); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

/**
 * Calculate pass@k: probability of at least 1 success in k trials
 * Using unbiased estimator: 1 - C(n-c, k) / C(n, k)
 */
function calculatePassAtK(n: number, c: number, k: number): number {
    if (n - c < k) return 1.0;
    let result = 1.0;
    for (let i = 0; i < k; i++) {
        result *= (n - c - i) / (n - i);
    }
    return 1.0 - result;
}

/**
 * Calculate pass^k: probability that all k trials succeed
 */
function calculatePassPowK(n: number, c: number, k: number): number {
    const p = c / n;
    return Math.pow(p, k);
}

/** Estimate token count from text (~4 chars per token) */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/** Options for running an eval */
export interface EvalRunOptions {
    instruction: string;
    graders: ResolvedGrader[];
    timeoutSec: number;
    trialConfig?: TrialConfig;
    graderModel?: string;       // default LLM grader model
    graderTimeoutSec?: number;  // timeout per grader (default: 120s)
    environment: {
        cpus: number;
        memory_mb: number;
        mounts?: string[];
    };
    agentWorkingDir?: string;
    noSkills?: boolean;
}

export class EvalRunner {
    private provider: EnvironmentProvider;
    private logDir?: string;
    private noRedact: boolean;
    private isCancelled: boolean = false;

    constructor(provider: EnvironmentProvider, logDir?: string, noRedact: boolean = false) {
        this.provider = provider;
        this.logDir = logDir;
        this.noRedact = noRedact;
    }

    public stop() {
        this.isCancelled = true;
    }

    private timestamp(): string {
        return new Date().toISOString();
    }

    async runEval(
        agent: BaseAgent,
        taskPath: string,
        skillsPaths: string[],
        opts: EvalRunOptions,
        numTrials: number = 1,
        env?: Record<string, string>,
        parallel: number = 1,
        noSkills: boolean = false
    ): Promise<EvalReport> {
        const taskName = path.basename(taskPath);
        opts.noSkills = noSkills;
        const startTime = this.timestamp();
        const evalUuid = crypto.randomUUID();
        console.log(`\n${fmt.bold('Eval UUID:')} ${evalUuid}`);

        // One-time image build (if provider supports it)
        if (this.provider.prepare) {
            const buildSpinner = new Spinner('build', 'building image');
            try {
                const imageId = await this.provider.prepare(taskPath, skillsPaths, opts, env);
                buildSpinner.stop(`${fmt.dim('image ready')}  ${fmt.dim(typeof imageId === 'string' ? imageId : '')}`);
            } catch (err) {
                buildSpinner.stop(`${fmt.fail('build failed')}`);
                throw err;
            }
        }

        let trials: TrialResult[] = [];

        try {
            if (parallel > 1 && numTrials > 1) {
                trials = await this.runTrialsParallel(agent, taskPath, skillsPaths, opts, numTrials, parallel, evalUuid, env);
            } else {
                for (let i = 0; i < numTrials; i++) {
                    if (this.isCancelled) break;
                    const result = await this.runSingleTrial(agent, taskPath, skillsPaths, opts, i, numTrials, evalUuid, env);
                    trials.push(result);
                }
            }
        } finally {
            if (this.provider.teardown) {
                await this.provider.teardown();
            }
        }

        // Fill in cancelled trials if interrupted
        while (trials.length < numTrials) {
            trials.push({
                trial_id: trials.length + 1,
                reward: 0,
                grader_results: [],
                duration_ms: 0,
                n_commands: 0,
                input_tokens: 0,
                output_tokens: 0,
                session_log: [],
                status: 'cancelled'
            });
        }

        const completedTrials = trials.filter(t => t.status !== 'cancelled');
        const totalReward = completedTrials.reduce((sum, t) => sum + t.reward, 0);
        const successes = completedTrials.filter(t => t.reward >= 0.5).length;
        const nComp = completedTrials.length || 1;

        const report: EvalReport = {
            task: taskName,
            timestamp: startTime,
            status: this.isCancelled ? 'partial' : 'completed',
            pass_rate: totalReward / nComp,
            pass_at_k: calculatePassAtK(numTrials, successes, completedTrials.length),
            pass_pow_k: calculatePassPowK(numTrials, successes, completedTrials.length),
            trials,
            skills_used: skillsPaths.map(p => path.basename(p)),
            eval_uuid: evalUuid
        };

        if (this.logDir) {
            const sanitized = this.noRedact ? report : this.sanitize(report, env);
            await this.saveReport(sanitized);
        }

        return report;
    }

    private async runTrialsParallel(
        agent: BaseAgent,
        taskPath: string,
        skillsPaths: string[],
        opts: EvalRunOptions,
        numTrials: number,
        parallel: number,
        evalUuid: string,
        env?: Record<string, string>
    ): Promise<TrialResult[]> {
        const results: TrialResult[] = [];
        const queue = Array.from({ length: numTrials }, (_, i) => i);

        const workers = Array.from({ length: Math.min(parallel, numTrials) }, async () => {
            while (queue.length > 0 && !this.isCancelled) {
                const i = queue.shift()!;
                const result = await this.runSingleTrial(agent, taskPath, skillsPaths, opts, i, numTrials, evalUuid, env);
                results.push(result);
            }
        });

        await Promise.all(workers);
        return results.sort((a, b) => a.trial_id - b.trial_id);
    }

    private async runSingleTrial(
        agent: BaseAgent,
        taskPath: string,
        skillsPaths: string[],
        opts: EvalRunOptions,
        index: number,
        total: number,
        evalUuid: string,
        env?: Record<string, string>
    ): Promise<TrialResult> {
        const sessionLog: LogEntry[] = [];
        let commandCount = 0;
        const startTime = Date.now();
        const trialId = index + 1;
        
        const trialEnv: Record<string, string> = {
            ...(env || {}),
            ...(opts.trialConfig?.env || {}),
            _EVAL_TRIAL: trialId.toString(),
            _EVAL_UUID: evalUuid,
        };

        // Substitute {{trial}} and handle comma-separated key rotation
        for (const [key, value] of Object.entries(trialEnv)) {
            if (typeof value === 'string') {
                // 1. Handle comma-separated rotation for API keys/tokens
                if ((key.endsWith('_API_KEY') || key.endsWith('_TOKEN')) && value.includes(',')) {
                    const keys = value.split(',').map(k => k.trim()).filter(k => k.length > 0);
                    if (keys.length > 0) {
                        trialEnv[key] = keys[index % keys.length];
                    }
                }

                // 2. Substitute {{trial}} placeholder
                if (trialEnv[key].includes('{{trial}}')) {
                    trialEnv[key] = trialEnv[key].replace(/\{\{trial\}\}/g, trialId.toString());
                }
            }
        }

        const spinner = new Spinner(`${trialId}/${total}`, 'setting up environment');
        let workspace: string | undefined;

        try {
            workspace = await this.provider.setup(taskPath, skillsPaths, {
                timeoutSec: opts.timeoutSec,
                environment: opts.environment
            }, trialEnv);
            const instruction = opts.instruction;

            sessionLog.push({
                type: 'agent_start',
                timestamp: this.timestamp(),
                instruction
            });

            if (opts.trialConfig?.setup) {
                spinner.update('running trial setup');
                const res = await this.provider.runCommand(workspace, opts.trialConfig.setup, trialEnv);
                sessionLog.push({
                    type: 'trial_setup',
                    timestamp: this.timestamp(),
                    command: opts.trialConfig.setup,
                    stdout: res.stdout,
                    stderr: res.stderr,
                    exitCode: res.exitCode
                });
                if (res.exitCode !== 0) {
                    throw new Error(`Per-trial setup failed with exit code ${res.exitCode}`);
                }
            }

            spinner.update('running agent');
            const loggedRunCommand = async (cmd: string) => {
                const result = await this.provider.runCommand(workspace!, cmd, trialEnv);
                commandCount++;
                sessionLog.push({
                    type: 'command',
                    timestamp: this.timestamp(),
                    command: cmd,
                    stdout: result.stdout,
                    stderr: result.stderr,
                    exitCode: result.exitCode
                });
                return result;
            };

            const agentTimeoutMs = opts.timeoutSec * 1000;
            const agentLogs = await withTimeout(
                agent.run(instruction, workspace, loggedRunCommand, { agentWorkingDir: opts.agentWorkingDir }),
                agentTimeoutMs,
                `Agent (limit: ${opts.timeoutSec}s)`
            );

            sessionLog.push({
                type: 'agent_result',
                timestamp: this.timestamp(),
                output: agentLogs
            });

            // Run all graders
            const graderResults: GraderResult[] = [];

            for (let gIdx = 0; gIdx < opts.graders.length; gIdx++) {
                const graderDef = opts.graders[gIdx];

                if (opts.noSkills && graderDef.type === 'tool_usage') {
                    graderResults.push({
                        grader_type: 'tool_usage',
                        score: 1.0,
                        weight: graderDef.weight,
                        details: 'Skipped because --no-skills was provided'
                    });
                    continue;
                }

                const grader = getGrader(graderDef.type);
                spinner.update(`grading (${graderDef.type}${opts.graders.length > 1 ? ` ${gIdx + 1}/${opts.graders.length}` : ''})`);
                spinner.render();

                // Build grader config with file references for execution
                const detIndex = opts.graders.slice(0, gIdx).filter(g => g.type === 'deterministic').length;
                const llmIndex = opts.graders.slice(0, gIdx).filter(g => g.type === 'llm_rubric').length;

                const graderConfig = {
                    type: graderDef.type,
                    command: graderDef.type === 'deterministic'
                        ? `bash tests/${detIndex === 0 ? 'test.sh' : `test_${detIndex}.sh`}`
                        : undefined,
                    rubric: graderDef.type === 'llm_rubric'
                        ? `prompts/${llmIndex === 0 ? 'quality.md' : `quality_${llmIndex}.md`}`
                        : undefined,
                    model: graderDef.model || opts.graderModel,
                    weight: graderDef.weight,
                    expectedTools: graderDef.expectedTools,
                };

                const graderTimeoutMs = (opts.graderTimeoutSec ?? 120) * 1000;
                const result = await withTimeout(
                    grader.grade(workspace, this.provider, graderConfig, taskPath, sessionLog, trialEnv),
                    graderTimeoutMs,
                    `Grader ${graderDef.type} (limit: ${opts.graderTimeoutSec ?? 120}s)`
                );
                graderResults.push(result);

                sessionLog.push({
                    type: 'grader',
                    timestamp: this.timestamp(),
                    grader_result: result
                });
            }

            // Calculate weighted reward
            const totalWeight = graderResults.reduce((sum, r) => sum + r.weight, 0);
            const reward = totalWeight > 0
                ? graderResults.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight
                : 0;

            sessionLog.push({
                type: 'reward',
                timestamp: this.timestamp(),
                value: reward
            });

            const duration_ms = Date.now() - startTime;

            const input_tokens = estimateTokens(instruction);
            const output_tokens = sessionLog
                .filter(e => e.type === 'agent_result' || e.type === 'command')
                .reduce((sum, e) => sum + estimateTokens((e.output || '') + (e.stdout || '') + (e.stderr || '')), 0);

            const status = reward >= 0.5 ? fmt.pass('PASS') : fmt.fail('FAIL');
            spinner.stop(`${status}  ${fmt.bold(reward.toFixed(2))}  ${fmt.dim((duration_ms / 1000).toFixed(1) + 's')}  ${fmt.dim(commandCount + ' cmds')}`);

            return {
                trial_id: index + 1,
                reward,
                grader_results: graderResults,
                duration_ms,
                n_commands: commandCount,
                input_tokens,
                output_tokens,
                session_log: sessionLog,
                status: 'completed'
            };
        } catch (err: any) {
            const duration_ms = Date.now() - startTime;
            const errorMsg = err?.message || String(err);
            spinner.stop(`${fmt.fail('FAIL')}  ${fmt.dim((duration_ms / 1000).toFixed(1) + 's')}`);
            console.error(`\n${errorMsg}\n`);


            let diagnostics = '';
            if (this.provider.diagnose && workspace) {
                try {
                    diagnostics = await this.provider.diagnose(workspace);
                    console.log(diagnostics);
                } catch (e) {
                    diagnostics = `(diagnostics failed: ${e})`;
                }
            }

            sessionLog.push({
                type: 'reward',
                timestamp: this.timestamp(),
                value: 0,
                output: diagnostics ? `${errorMsg}\n\n${diagnostics}` : errorMsg
            });

            return {
                trial_id: index + 1,
                reward: 0,
                grader_results: [],
                duration_ms,
                n_commands: commandCount,
                input_tokens: 0,
                output_tokens: 0,
                session_log: sessionLog,
                status: 'failed'
            };
        } finally {
            if (workspace) {
                if (opts.trialConfig?.cleanup) {
                    const cleanupSpinner = new Spinner(`${index + 1}/${total}`, 'cleaning up trial');
                    try {
                        const result = await this.provider.runCommand(workspace, opts.trialConfig.cleanup, trialEnv);
                        cleanupSpinner.stop(fmt.pass('cleaned up'));
                        sessionLog.push({
                            type: 'trial_cleanup',
                            timestamp: this.timestamp(),
                            command: opts.trialConfig.cleanup,
                            stdout: result.stdout,
                            stderr: result.stderr,
                            exitCode: result.exitCode
                        });
                        if (result.exitCode !== 0) {
                            console.error(`Per-trial cleanup failed with exit code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
                        }
                    } catch (e) {
                        cleanupSpinner.stop(fmt.fail('failed'));
                        console.error(`Error running per-trial cleanup: ${e}`);
                    }
                }
                await this.provider.cleanup(workspace);
            }
        }
    }

    private sanitize(report: EvalReport, env?: Record<string, string>): EvalReport {
        if (!env) return report;

        const sanitized = JSON.parse(JSON.stringify(report));
        const secrets = Object.values(env);

        const redact = (text: string) => {
            let result = text;
            for (const secret of secrets) {
                if (secret && secret.length > 5) {
                    result = result.split(secret).join('[REDACTED]');
                }
            }
            return result;
        };

        for (const trial of sanitized.trials) {
            for (const entry of trial.session_log) {
                if (entry.instruction) entry.instruction = redact(entry.instruction);
                if (entry.command) entry.command = redact(entry.command);
                if (entry.stdout) entry.stdout = redact(entry.stdout);
                if (entry.stderr) entry.stderr = redact(entry.stderr);
                if (entry.output) entry.output = redact(entry.output);
                if (entry.grader_result?.details) entry.grader_result.details = redact(entry.grader_result.details);
            }
            for (const gr of trial.grader_results) {
                if (gr.details) gr.details = redact(gr.details);
            }
        }

        return sanitized;
    }

    private async saveReport(report: EvalReport): Promise<void> {
        if (!this.logDir) return;

        await fs.ensureDir(this.logDir);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${report.task}_${timestamp}.json`;
        const filePath = path.join(this.logDir, fileName);

        await fs.writeJSON(filePath, report, { spaces: 2 });
    }
}
