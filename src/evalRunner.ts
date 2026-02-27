import * as fs from 'fs-extra';
import * as path from 'path';
import * as toml from 'toml';
import {
    BaseAgent, EnvironmentProvider, TaskConfig,
    LogEntry, TrialResult, EvalReport
} from './types';
import { LocalProvider } from './providers/local';

export async function loadTaskConfig(taskPath: string): Promise<TaskConfig> {
    const configPath = path.join(taskPath, 'task.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    return toml.parse(content);
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

    async runEval(agent: BaseAgent, taskPath: string, skillsPaths: string[] = [], numTrials: number = 1, env?: Record<string, string>): Promise<EvalReport> {
        const taskConfig = await loadTaskConfig(taskPath);
        const taskName = path.basename(taskPath);
        console.log(`Starting eval for task: ${taskName} (${numTrials} trials)`);

        const trials: TrialResult[] = [];
        let totalReward = 0;

        for (let i = 0; i < numTrials; i++) {
            console.log(`\n--- Trial ${i + 1} / ${numTrials} ---`);
            const sessionLog: LogEntry[] = [];
            const workspace = await this.provider.setup(taskPath, skillsPaths, taskConfig, env);
            console.log(`Workspace set up at identifier: ${workspace}`);

            try {
                const instruction = await fs.readFile(path.join(taskPath, 'instruction.md'), 'utf-8');

                sessionLog.push({
                    type: 'agent_start',
                    timestamp: this.timestamp(),
                    instruction
                });

                console.log('Executing agent...');
                const loggedRunCommand = async (cmd: string) => {
                    const result = await this.provider.runCommand(workspace, cmd, env);
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

                console.log('Running verifier...');
                const verifierTimeoutMs = taskConfig.verifier.timeout_sec * 1000;
                const verifierResult = await withTimeout(
                    this.provider.runCommand(workspace, 'bash tests/test.sh', env),
                    verifierTimeoutMs,
                    `Verifier (limit: ${taskConfig.verifier.timeout_sec}s)`
                );

                sessionLog.push({
                    type: 'verifier',
                    timestamp: this.timestamp(),
                    command: 'bash tests/test.sh',
                    stdout: verifierResult.stdout,
                    stderr: verifierResult.stderr,
                    exitCode: verifierResult.exitCode
                });

                let reward = 0;
                const rewardCheck = await this.provider.runCommand(workspace, 'cat logs/verifier/reward.txt', env);
                if (rewardCheck.exitCode === 0) {
                    const parsed = parseInt(rewardCheck.stdout.trim());
                    reward = isNaN(parsed) ? 0 : parsed;
                }

                sessionLog.push({
                    type: 'reward',
                    timestamp: this.timestamp(),
                    value: reward
                });

                totalReward += reward;
                trials.push({
                    trial_id: i + 1,
                    reward,
                    session_log: sessionLog
                });
            } finally {
                console.log('Cleaning up environment...');
                await this.provider.cleanup(workspace);
            }
        }

        const report: EvalReport = {
            task: taskName,
            pass_rate: totalReward / numTrials,
            trials,
            skills_used: skillsPaths.map(p => path.basename(p))
        };

        if (this.logDir) {
            const sanitizedReport = this.sanitize(report, env);
            await this.saveReport(sanitizedReport);
        }

        return report;
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
