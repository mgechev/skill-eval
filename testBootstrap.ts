import { BaseAgent, LocalProvider } from './core';
import { DockerProvider } from './dockerProvider';
import { EvalRunner } from './evalRunner';
import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs-extra';

class MockAgent extends BaseAgent {
  async run(
    instruction: string,
    workspacePath: string,
    runCommand: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  ): Promise<string> {
    console.log('MockAgent solving task...');
    return 'Mock agent initiated solve.sh';
  }
}

async function runTest(useDocker: boolean, numTrials: number = 1, logDir?: string) {
  console.log(`\n--- Testing with ${useDocker ? 'Docker' : 'Local'} Provider (${numTrials} trials, logDir: ${logDir || 'none'}) ---`);
  const provider = useDocker ? new DockerProvider() : new LocalProvider();
  const runner = new EvalRunner(provider, logDir);

  // Custom agent for this test that actually runs the solve script
  const solvingAgent = {
    async run(instruction: string, workspace: string, runCommand: any) {
      console.log('Solving task...');
      const binDir = path.join(workspace, 'bin');
      const runWithBin = (cmd: string) => runCommand(`export PATH="${binDir}:$PATH" && ${cmd}`);

      await runWithBin('superlint check');
      await runWithBin('superlint fix --target app.js');
      await runWithBin('superlint verify');
      return 'Solved';
    }
  } as BaseAgent;

  const taskPath = path.join(__dirname, 'tasks', 'superlint_demo');
  const report = await runner.runEval(solvingAgent, taskPath, [], numTrials);

  console.log('Eval Report Summary:');
  console.log(`Task: ${report.task}`);
  console.log(`Pass Rate: ${report.pass_rate}`);
  console.log(`Trials Count: ${report.trials.length}`);

  if (report.pass_rate === 1.0 && report.trials.length === numTrials) {
    console.log(`\nSUCCESS: ${useDocker ? 'Docker' : 'Local'} multi-trial implementation verified!`);

    if (logDir) {
      const files = await fs.readdir(logDir);
      const reportFile = files.find(f => f.startsWith(report.task) && f.endsWith('.json'));
      if (reportFile) {
        console.log(`SUCCESS: Persistence verified! Found report: ${reportFile}`);
      } else {
        console.log(`FAILURE: Persistence failed! No report found in ${logDir}`);
        process.exit(1);
      }
    }
  } else {
    console.log(`\nFAILURE: Report did not meet expectations`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

async function main() {
  try {
    console.log('Starting bootstrap tests...');
    // Test 1: Local Single Trial
    await runTest(false, 1);

    // Test 2: Local Multi-Trial
    await runTest(false, 3);

    // Test 3: Local with Persistence
    const testLogDir = path.join(__dirname, 'test_logs');
    if (fs.existsSync(testLogDir)) await fs.remove(testLogDir);
    await runTest(false, 1, testLogDir);

    // Test 4: Docker
    try {
      console.log('Checking for Docker...');
      execSync('docker ps', { stdio: 'ignore' });
      await runTest(true, 1);
    } catch (e) {
      console.warn('Docker not available or failed check, skipping Docker test.');
    }

    // Test 5: Secret Injection & Sanitization
    console.log('\n--- Testing Secret Injection & Sanitization ---');
    const secretLogDir = path.join(__dirname, 'secret_logs');
    if (fs.existsSync(secretLogDir)) await fs.remove(secretLogDir);

    const secretAgent = {
      async run(instruction: string, workspace: string, runCommand: any) {
        console.log('Agent: Checking for secret...');
        const res = await runCommand('echo "The secret is $MY_SECRET"');
        return `Agent saw: ${res.stdout}`;
      }
    } as BaseAgent;

    const runner = new EvalRunner(new LocalProvider(), secretLogDir);
    const secretReport = await runner.runEval(
      secretAgent,
      path.join(__dirname, 'tasks', 'superlint_demo'),
      [],
      1,
      { MY_SECRET: 'SUPER_SECRET_KEY_12345' }
    );

    const logFiles = await fs.readdir(secretLogDir);
    const logPath = path.join(secretLogDir, logFiles[0]);
    const logContent = await fs.readFile(logPath, 'utf-8');

    if (logContent.includes('SUPER_SECRET_KEY_12345')) {
      console.error('FAILURE: Secret leaked into log files!');
      process.exit(1);
    } else if (logContent.includes('[REDACTED]')) {
      console.log('SUCCESS: Secret correctly sanitized from logs.');
    } else {
      console.error('FAILURE: Secret not found and not redacted? Check test logic.');
      process.exit(1);
    }

    console.log('\nAll tests completed successfully!');
  } catch (e) {
    console.error('Test failed:', e);
    process.exit(1);
  }
}

main();
