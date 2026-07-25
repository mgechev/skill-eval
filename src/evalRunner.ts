import * as fs from 'fs-extra';
import * as path from 'path';
import {
    BaseAgent, EnvironmentProvider,
    LogEntry, TrialResult, EvalReport, GraderResult, AgentResult
} from './types';
import { ResolvedGrader, InteractiveConfig } from './core/config.types';
import { getGrader } from './graders';
import { fmt, Spinner } from './utils/cli';
import { withTimeout } from './utils/timeout';
import { InteractiveSession, InputInjectorManager } from './interactive';
import { ClaudeStreamAgent } from './agents/claude-stream';

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

/** Normalize agent output to AgentResult format */
function normalizeAgentOutput(raw: string | AgentResult): AgentResult {
    if (typeof raw === 'string') {
        return {
            output: raw,
            skills_triggered: [],
            tools_used: [],
        };
    }
    return raw;
}

/** Options for running an eval */
export interface EvalRunOptions {
    instruction: string;
    graders: ResolvedGrader[];
    timeoutSec: number;
    graderModel?: string;       // default LLM grader model
    graderProvider?: 'gemini' | 'anthropic' | 'openai';  // default LLM grader provider
    graderTimeoutSec?: number;  // timeout per grader (default: 120s)
    environment: {
        cpus: number;
        memory_mb: number;
    };
    interactive?: InteractiveConfig;
    taskPath?: string;
}

export class EvalRunner {
    private provider: EnvironmentProvider;
    private logDir?: string;

    constructor(provider: EnvironmentProvider, logDir?: string) {
        this.provider = provider;
        this.logDir = logDir;
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
        parallel: number = 1
    ): Promise<EvalReport> {
        const taskName = path.basename(taskPath);

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

        let trials: TrialResult[];

        try {
            if (parallel > 1 && numTrials > 1) {
                trials = await this.runTrialsParallel(agent, taskPath, skillsPaths, opts, numTrials, parallel, env);
            } else {
                trials = [];
                for (let i = 0; i < numTrials; i++) {
                    const result = await this.runSingleTrial(agent, taskPath, skillsPaths, opts, i, numTrials, env);
                    trials.push(result);
                }
            }
        } finally {
            if (this.provider.teardown) {
                await this.provider.teardown();
            }
        }

        const totalReward = trials.reduce((sum, t) => sum + t.reward, 0);
        const successes = trials.filter(t => t.reward >= 0.5).length;

        const report: EvalReport = {
            task: taskName,
            pass_rate: totalReward / numTrials,
            pass_at_k: calculatePassAtK(numTrials, successes, numTrials),
            pass_pow_k: calculatePassPowK(numTrials, successes, numTrials),
            trials,
            skills_used: skillsPaths.map(p => path.basename(p))
        };

        if (this.logDir) {
            const sanitized = this.sanitize(report, env);
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
        env?: Record<string, string>
    ): Promise<TrialResult[]> {
        const results: TrialResult[] = new Array(numTrials);
        const queue = Array.from({ length: numTrials }, (_, i) => i);

        const workers = Array.from({ length: Math.min(parallel, numTrials) }, async () => {
            while (queue.length > 0) {
                const i = queue.shift()!;
                results[i] = await this.runSingleTrial(agent, taskPath, skillsPaths, opts, i, numTrials, env);
            }
        });

        await Promise.all(workers);
        return results;
    }

    private async runSingleTrial(
        agent: BaseAgent,
        taskPath: string,
        skillsPaths: string[],
        opts: EvalRunOptions,
        index: number,
        total: number,
        env?: Record<string, string>
    ): Promise<TrialResult> {
        if (opts.interactive?.enabled) {
            return this.runInteractiveTrial(agent, taskPath, skillsPaths, opts, index, total, env);
        }

        const sessionLog: LogEntry[] = [];
        let commandCount = 0;
        const startTime = Date.now();

        const spinner = new Spinner(`${index + 1}/${total}`, 'setting up environment');
        const workspace = await this.provider.setup(taskPath, skillsPaths, opts, env);

        try {
            const instruction = opts.instruction;

            sessionLog.push({
                type: 'agent_start',
                timestamp: this.timestamp(),
                instruction
            });

            spinner.update('running agent');
            const loggedRunCommand = async (cmd: string) => {
                const result = await this.provider.runCommand(workspace, cmd, env);
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
            const agentRaw = await withTimeout(
                agent.run(instruction, workspace, loggedRunCommand),
                agentTimeoutMs,
                `Agent (limit: ${opts.timeoutSec}s)`
            );
            const agentResult = normalizeAgentOutput(agentRaw);

            sessionLog.push({
                type: 'agent_result',
                timestamp: this.timestamp(),
                output: agentResult.output
            });

            // Run all graders
            const graderResults: GraderResult[] = [];

            for (let gIdx = 0; gIdx < opts.graders.length; gIdx++) {
                const graderDef = opts.graders[gIdx];
                const grader = getGrader(graderDef.type);
                spinner.update(`grading (${graderDef.type}${opts.graders.length > 1 ? ` ${gIdx + 1}/${opts.graders.length}` : ''})`);

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
                    provider: graderDef.provider || opts.graderProvider,
                    weight: graderDef.weight,
                };

                const graderTimeoutMs = (opts.graderTimeoutSec ?? 120) * 1000;
                const result = await withTimeout(
                    grader.grade(workspace, this.provider, graderConfig, taskPath, sessionLog, env),
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
                session_log: sessionLog
            };
        } catch (err: any) {
            const duration_ms = Date.now() - startTime;
            const errorMsg = err?.message || String(err);
            spinner.stop(`${fmt.fail('FAIL')}  ${errorMsg.substring(0, 50)}  ${fmt.dim((duration_ms / 1000).toFixed(1) + 's')}`);


            let diagnostics = '';
            if (this.provider.diagnose) {
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
                session_log: sessionLog
            };
        } finally {
            await this.provider.cleanup(workspace);
        }
    }

    private async runInteractiveTrial(
        agent: BaseAgent,
        taskPath: string,
        skillsPaths: string[],
        opts: EvalRunOptions,
        index: number,
        total: number,
        env?: Record<string, string>
    ): Promise<TrialResult> {
        const sessionLog: LogEntry[] = [];
        const startTime = Date.now();

        const spinner = new Spinner(`${index + 1}/${total}`, 'setting up environment');
        const workspace = await this.provider.setup(taskPath, skillsPaths, opts, env);

        try {
            if (agent instanceof ClaudeStreamAgent) {
                agent.start(workspace);
            }

            const instruction = opts.instruction;
            const interactiveConfig = opts.interactive!;

            sessionLog.push({
                type: 'agent_start',
                timestamp: this.timestamp(),
                instruction,
                task_path: path.resolve(taskPath),
                workspace_path: workspace,
            });

            spinner.update('running interactive session');

            const logEntry = (entry: LogEntry) => {
                sessionLog.push(entry);
            };

            const injectorManager = new InputInjectorManager(
                interactiveConfig,
                opts.taskPath || taskPath
            );

            const session = new InteractiveSession(
                agent,
                injectorManager,
                interactiveConfig,
                workspace,
                async (cmd: string) => {
                    return this.provider.runCommand(workspace, cmd, env);
                },
                logEntry
            );

            const timeoutPerTurn = interactiveConfig.timeout_per_turn || opts.timeoutSec;
            const maxTurns = interactiveConfig.max_turns || 10;
            const calculatedTimeout = maxTurns * timeoutPerTurn;
            const sessionTimeoutSec = Math.max(opts.timeoutSec, calculatedTimeout);
            const sessionTimeoutMs = sessionTimeoutSec * 1000;

            let sessionResult;
            let sessionTimeoutError: string | null = null;
            try {
                sessionResult = await withTimeout(
                    session.run(instruction),
                    sessionTimeoutMs,
                    `Interactive session (limit: ${sessionTimeoutSec}s)`
                );
            } catch (timeoutErr: any) {
                sessionTimeoutError = timeoutErr.message || String(timeoutErr);
                spinner.update('session timed out, grading partial results...');
            }

            const turns = session.getTurns();
            const conversation = session.getConversation();
            const commandCount = turns.reduce((sum, t) => sum + t.commands_executed, 0);
            const totalTurns = turns.length;
            const finalOutput = turns.length > 0 ? turns[turns.length - 1].output : (sessionTimeoutError || '');

            sessionLog.push({
                type: 'agent_result',
                timestamp: this.timestamp(),
                duration_ms: Date.now() - startTime,
                output: sessionTimeoutError ? `[TIMEOUT] ${sessionTimeoutError}\n\n${finalOutput}` : finalOutput,
            });

            if (sessionTimeoutError) {
                sessionLog.push({
                    type: 'error',
                    timestamp: this.timestamp(),
                    error_type: 'TimeoutError',
                    error_message: sessionTimeoutError,
                    output: sessionTimeoutError,
                });
            }

            // Run graders (even on timeout)
            const graderResults: GraderResult[] = [];
            // Attach turns/conversation for LLM grader multi-turn support
            (sessionLog as any).turns = turns;
            (sessionLog as any).conversation = conversation;

            for (let gIdx = 0; gIdx < opts.graders.length; gIdx++) {
                const graderDef = opts.graders[gIdx];
                const grader = getGrader(graderDef.type);
                spinner.update(`grading (${graderDef.type}${opts.graders.length > 1 ? ` ${gIdx + 1}/${opts.graders.length}` : ''})`);

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
                    provider: graderDef.provider || opts.graderProvider,
                    weight: graderDef.weight,
                };

                const graderTimeoutMs = (opts.graderTimeoutSec ?? 120) * 1000;
                const result = await withTimeout(
                    grader.grade(workspace, this.provider, graderConfig, taskPath, sessionLog, env),
                    graderTimeoutMs,
                    `Grader ${graderDef.type} (limit: ${opts.graderTimeoutSec ?? 120}s)`
                );
                graderResults.push(result);

                sessionLog.push({
                    type: 'grader',
                    timestamp: this.timestamp(),
                    duration_ms: Date.now() - startTime,
                    grader_result: result,
                });
            }

            const totalWeight = graderResults.reduce((sum, r) => sum + r.weight, 0);
            const reward = totalWeight > 0
                ? graderResults.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight
                : 0;

            sessionLog.push({
                type: 'reward',
                timestamp: this.timestamp(),
                value: reward,
            });

            const duration_ms = Date.now() - startTime;

            const input_tokens = estimateTokens(instruction);
            const output_tokens = turns.reduce(
                (sum, t) => sum + estimateTokens(t.input) + estimateTokens(t.output), 0
            );

            const allSkillsTriggered = session.getSkillsTriggered();
            const allToolsUsed = session.getToolsUsed();

            const status = reward >= 0.5 ? fmt.pass('PASS') : fmt.fail('FAIL');
            const timeoutHint = sessionTimeoutError ? fmt.dim(' (timeout)') : '';
            const skillHint = allSkillsTriggered.length > 0
                ? `  ${fmt.dim(allSkillsTriggered.map(s => s.name).join(', '))}`
                : '';
            spinner.stop(`${status}${timeoutHint}  ${fmt.bold(reward.toFixed(2))}  ${fmt.dim((duration_ms / 1000).toFixed(1) + 's')}  ${fmt.dim(totalTurns + ' turns')}  ${fmt.dim(commandCount + ' cmds')}${skillHint}`);

            return {
                trial_id: index + 1,
                reward,
                grader_results: graderResults,
                duration_ms,
                n_commands: commandCount,
                input_tokens,
                output_tokens,
                session_log: sessionLog,
                skills_triggered: allSkillsTriggered,
                tools_used: allToolsUsed,
                turns,
                conversation,
            };
        } catch (err: any) {
            const duration_ms = Date.now() - startTime;
            const errorMsg = err?.message || String(err);
            const errorStack = err?.stack || '';
            spinner.stop(`${fmt.fail('FAIL')}  ${errorMsg.substring(0, 50)}  ${fmt.dim((duration_ms / 1000).toFixed(1) + 's')}`);

            let diagnostics = '';
            if (this.provider.diagnose) {
                try {
                    diagnostics = await this.provider.diagnose(workspace);
                    console.log(diagnostics);
                } catch (e) {
                    diagnostics = `(diagnostics failed: ${e})`;
                }
            }

            sessionLog.push({
                type: 'error',
                timestamp: this.timestamp(),
                error_type: err?.constructor?.name || 'Error',
                error_message: errorMsg,
                output: diagnostics ? `${errorMsg}\n\nDiagnostics:\n${diagnostics}` : errorMsg,
            });

            // Attempt grading even on error (best-effort)
            try {
                const graderResults: GraderResult[] = [];
                for (let gIdx = 0; gIdx < opts.graders.length; gIdx++) {
                    const graderDef = opts.graders[gIdx];
                    const grader = getGrader(graderDef.type);

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
                        provider: graderDef.provider || opts.graderProvider,
                        weight: graderDef.weight,
                    };

                    const graderTimeoutMs = (opts.graderTimeoutSec ?? 120) * 1000;
                    const result = await withTimeout(
                        grader.grade(workspace, this.provider, graderConfig, taskPath, sessionLog, env),
                        graderTimeoutMs,
                        `Grader ${graderDef.type} (limit: ${opts.graderTimeoutSec ?? 120}s)`
                    );
                    graderResults.push(result);
                }

                const totalWeight = graderResults.reduce((sum, r) => sum + r.weight, 0);
                const reward = totalWeight > 0
                    ? graderResults.reduce((sum, r) => sum + r.score * r.weight, 0) / totalWeight
                    : 0;

                sessionLog.push({
                    type: 'reward',
                    timestamp: this.timestamp(),
                    value: reward,
                });

                return {
                    trial_id: index + 1,
                    reward,
                    grader_results: graderResults,
                    duration_ms,
                    n_commands: 0,
                    input_tokens: estimateTokens(opts.instruction),
                    output_tokens: 0,
                    session_log: sessionLog,
                };
            } catch {
                sessionLog.push({
                    type: 'reward',
                    timestamp: this.timestamp(),
                    value: 0,
                    output: diagnostics ? `${errorMsg}\n\nDiagnostics:\n${diagnostics}` : errorMsg,
                });

                return {
                    trial_id: index + 1,
                    reward: 0,
                    grader_results: [],
                    duration_ms,
                    n_commands: 0,
                    input_tokens: 0,
                    output_tokens: 0,
                    session_log: sessionLog,
                };
            }
        } finally {
            if (agent instanceof ClaudeStreamAgent && agent.isRunning()) {
                agent.close();
            }
            await this.provider.cleanup(workspace);
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
