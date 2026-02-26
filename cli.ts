import { DockerProvider } from './dockerProvider';
import { LocalProvider } from './core';
import { EvalRunner } from './evalRunner';
import { GeminiAgent } from './geminiAgent';
import { ClaudeAgent } from './claudeAgent';
import * as path from 'path';
import * as fs from 'fs-extra';

async function main() {
  const args = process.argv.slice(2);
  const taskArg = args[0];

  if (!taskArg || taskArg === '--help' || taskArg === '-h') {
    console.log('Usage: pnpm run eval <task_name> [options]');
    console.log('\nOptions:');
    console.log('  --agent=gemini|claude    Default: gemini');
    console.log('  --provider=docker|local  Default: docker');
    console.log('  --trials=N               Default: 5');
    console.log('  --with-skills            Include associated skills if they exist');
    process.exit(0);
  }

  // Parse flags
  const agentType = args.find(a => a.startsWith('--agent='))?.split('=')[1] || 'gemini';
  const providerType = args.find(a => a.startsWith('--provider='))?.split('=')[1] || 'docker';
  const trials = parseInt(args.find(a => a.startsWith('--trials='))?.split('=')[1] || '5');
  const withSkills = args.includes('--with-skills');

  // Resolve task path
  const tasksDir = path.join(__dirname, 'tasks');
  const availableTasks = await fs.readdir(tasksDir);

  // Smart matching: superlint -> superlint_demo
  let taskName = availableTasks.find(t => t === taskArg || t.startsWith(taskArg));
  if (!taskName) {
    console.error(`Error: Task "${taskArg}" not found in ${tasksDir}`);
    console.log(`Available tasks: ${availableTasks.join(', ')}`);
    process.exit(1);
  }

  const taskPath = path.join(tasksDir, taskName);
  const resultsDir = path.join(__dirname, 'results');

  // Setup components
  const provider = providerType === 'docker' ? new DockerProvider() : new LocalProvider();
  const runner = new EvalRunner(provider, resultsDir);

  let agent;
  if (agentType === 'claude') {
    agent = new ClaudeAgent();
  } else {
    agent = new GeminiAgent();
  }

  // Handle environment variables (API Keys)
  const env: Record<string, string> = {};
  if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  // Skills
  const skillsPaths: string[] = [];
  if (withSkills) {
    // Look for a skill with the same name
    const skillName = taskArg.split('_')[0]; // basic heuristic
    const skillPath = path.join(taskPath, 'skills', skillName);
    if (await fs.pathExists(skillPath)) {
      skillsPaths.push(skillPath);
      console.log(`Including skill: ${skillName}`);
    }
  }

  console.log(`🚀 Running Evaluation for "${taskName}"...`);
  console.log(`Agent: ${agentType} | Provider: ${providerType} | Trials: ${trials}`);

  try {
    const report = await runner.runEval(agent, taskPath, skillsPaths, trials, env);
    console.log('\n-------------------------------------------');
    console.log(`✅ Evaluation Complete!`);
    console.log(`Pass Rate: ${(report.pass_rate * 100).toFixed(1)}%`);
    console.log(`Results saved to: ${resultsDir}`);
  } catch (err) {
    console.error('Evaluation failed:', err);
    process.exit(1);
  }
}

main();
