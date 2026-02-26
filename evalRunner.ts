import * as fs from 'fs-extra';
import * as path from 'path';
import { BaseAgent, EnvironmentProvider, LocalProvider, loadTaskConfig } from './core';

export interface TrialResult {
  trial_id: number;
  reward: number;
  agent_logs: string;
  verifier_stdout: string;
  verifier_stderr: string;
}

export interface EvalReport {
  task: string;
  pass_rate: number;
  trials: TrialResult[];
  skills_used: string[];
}

export class EvalRunner {
  private provider: EnvironmentProvider;
  private logDir?: string;

  constructor(provider?: EnvironmentProvider, logDir?: string) {
    this.provider = provider || new LocalProvider();
    this.logDir = logDir;
  }

  async runEval(agent: BaseAgent, taskPath: string, skillsPaths: string[] = [], numTrials: number = 1, env?: Record<string, string>): Promise<EvalReport> {
    const taskConfig = await loadTaskConfig(taskPath);
    const taskName = path.basename(taskPath);
    console.log(`Starting eval for task: ${taskName} (${numTrials} trials)`);

    const trials: TrialResult[] = [];
    let totalReward = 0;

    for (let i = 0; i < numTrials; i++) {
      console.log(`\n--- Trial ${i + 1} / ${numTrials} ---`);
      const workspace = await this.provider.setup(taskPath, skillsPaths, env);
      console.log(`Workspace set up at identifier: ${workspace}`);

      try {
        const instruction = await fs.readFile(path.join(taskPath, 'instruction.md'), 'utf-8');

        console.log('Executing agent...');
        const agentLogs = await agent.run(
          instruction,
          workspace,
          (cmd) => this.provider.runCommand(workspace, cmd, env)
        );

        console.log('Running verifier...');
        const verifierResult = await this.provider.runCommand(workspace, 'bash tests/test.sh', env);

        let reward = 0;
        const rewardCheck = await this.provider.runCommand(workspace, 'cat logs/verifier/reward.txt', env);
        if (rewardCheck.exitCode === 0) {
          reward = parseInt(rewardCheck.stdout.trim()) || 0;
        }

        totalReward += reward;
        trials.push({
          trial_id: i + 1,
          reward,
          agent_logs: agentLogs,
          verifier_stdout: verifierResult.stdout,
          verifier_stderr: verifierResult.stderr
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

    // Create a clone to avoid mutating the original report used in-memory
    const sanitized = JSON.parse(JSON.stringify(report));
    const secrets = Object.values(env);

    const redact = (text: string) => {
      let result = text;
      for (const secret of secrets) {
        if (secret && secret.length > 5) { // Only redact reasonably long strings to avoid false positives
          result = result.split(secret).join('[REDACTED]');
        }
      }
      return result;
    };

    for (const trial of sanitized.trials) {
      trial.agent_logs = redact(trial.agent_logs);
      trial.verifier_stdout = redact(trial.verifier_stdout);
      trial.verifier_stderr = redact(trial.verifier_stderr);
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
