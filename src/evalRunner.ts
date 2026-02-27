import * as fs from 'fs-extra';
import * as path from 'path';
import * as toml from 'toml';
import {
    BaseAgent, EnvironmentProvider, TaskConfig, GraderConfig,
    LogEntry, TrialResult, EvalReport, GraderResult
} from './types';
import { getGrader } from './graders';

export async function loadTaskConfig(taskPath: string): Promise<TaskConfig> {
    const configPath = path.join(taskPath, 'task.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    const raw = toml.parse(content);

    // Normalize: support both old [verifier] format and new [[graders]] format
    if (!raw.graders && raw.verifier) {
        raw.graders = [{
            type: 'deterministic',
            command: 'bash tests/test.sh',
            weight: 1.0
        }];
    }

    return raw;
}

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
 * where n = total trials, c = successes, k = attempts
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
 * Estimated as (c/n)^k
 */
function calculatePassPowK(n: number, c: number, k: number): number {
    const p = c / n;
    return Math.pow(p, k);
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
        skillsPaths: string[] = [],
        numTrials: number = 1,
        env?: Record<string, string>,
        parallel: number = 1
    ): Promise<EvalReport> {
        const taskConfig = await loadTaskConfig(taskPath);
        const taskName = path.basename(taskPath);
        console.log(`Starting eval for task: ${taskName} (${numTrials} trials${parallel > 1 ? `, ${parallel} parallel` : ''})`);

        let trials: TrialResult[];

        if (parallel > 1 && numTrials > 1) {
            trials = await this.runTrialsParallel(agent, taskPath, taskConfig, skillsPaths, numTrials, parallel, env);
        } else {
            trials = [];
            for (let i = 0; i < numTrials; i++) {
                const result = await this.runSingleTrial(agent, taskPath, taskConfig, skillsPaths, i, numTrials, env);
                trials.push(result);
            }
        }

        const totalReward = trials.reduce((sum, t) => sum + t.reward, 0);
        const successes = trials.filter(t => t.reward >= 0.5).length; // threshold for "pass"

        const report: EvalReport = {
            task: taskName,
            pass_rate: totalReward / numTrials,
            pass_at_k: calculatePassAtK(numTrials, successes, numTrials),
            pass_pow_k: calculatePassPowK(numTrials, successes, numTrials),
            trials,
            skills_used: skillsPaths.map(p => path.basename(p))
        };

        if (this.logDir) {
            const sanitizedReport = this.sanitize(report, env);
            await this.saveReport(sanitizedReport);
        }

        return report;
    }

    private async runTrialsParallel(
        agent: BaseAgent,
        taskPath: string,
        taskConfig: TaskConfig,
        skillsPaths: string[],
        numTrials: number,
        parallel: number,
        env?: Record<string, string>
    ): Promise<TrialResult[]> {
        const results: TrialResult[] = new Array(numTrials);
        const queue = Array.from({ length: numTrials }, (_, i) => i);

        const workers = Array.from({ length: Math.min(parallel, numTrials) }, async () => {
            while (queue.length > 0) {
                const i = queue.shift()!;
                results[i] = await this.runSingleTrial(agent, taskPath, taskConfig, skillsPaths, i, numTrials, env);
            }
        });

        await Promise.all(workers);
        return results;
    }

    private async runSingleTrial(
        agent: BaseAgent,
        taskPath: string,
        taskConfig: TaskConfig,
        skillsPaths: string[],
        index: number,
        total: number,
        env?: Record<string, string>
    ): Promise<TrialResult> {
        const sessionLog: LogEntry[] = [];
        let commandCount = 0;
        const startTime = Date.now();

        process.stdout.write(`  Trial ${index + 1}/${total} `);
        const workspace = await this.provider.setup(taskPath, skillsPaths, taskConfig, env);

        try {
            const instruction = await fs.readFile(path.join(taskPath, 'instruction.md'), 'utf-8');

            sessionLog.push({
                type: 'agent_start',
                timestamp: this.timestamp(),
                instruction
            });

            process.stdout.write('▸ ');
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

            const agentTimeoutMs = taskConfig.agent.timeout_sec * 1000;
            const agentLogs = await withTimeout(
                agent.run(instruction, workspace, loggedRunCommand),
                agentTimeoutMs,
                `Agent (limit: ${taskConfig.agent.timeout_sec}s)`
            );

            sessionLog.push({
                type: 'agent_result',
                timestamp: this.timestamp(),
                output: agentLogs
            });

            // Run all graders
            const graderResults: GraderResult[] = [];

            for (const graderConfig of taskConfig.graders) {
                const grader = getGrader(graderConfig.type);
                const result = await grader.grade(workspace, this.provider, graderConfig, taskPath, sessionLog, env);
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
            const status = reward >= 0.5 ? '✓' : '✗';
            console.log(`${status} reward=${reward.toFixed(2)} (${(duration_ms / 1000).toFixed(1)}s, ${commandCount} cmds)`);

            return {
                trial_id: index + 1,
                reward,
                grader_results: graderResults,
                duration_ms,
                n_commands: commandCount,
                session_log: sessionLog
            };
        } catch (err: any) {
            const duration_ms = Date.now() - startTime;
            const errorMsg = err?.message || String(err);
            console.log(`✗ FAILED: ${errorMsg} (${(duration_ms / 1000).toFixed(1)}s)`);

            sessionLog.push({
                type: 'reward',
                timestamp: this.timestamp(),
                value: 0,
                output: errorMsg
            });

            return {
                trial_id: index + 1,
                reward: 0,
                grader_results: [],
                duration_ms,
                n_commands: commandCount,
                session_log: sessionLog
            };
        } finally {
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
        console.log(`Report saved to: ${filePath}`);
    }
}
