import { DockerProvider } from './dockerProvider';
import { EvalRunner } from './evalRunner';
import { GeminiAgent } from './geminiAgent';
import * as path from 'path';

async function runDemo() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is not set.');
    console.log('Please run: export GEMINI_API_KEY=your_key_here');
    process.exit(1);
  }

  const taskPath = path.join(__dirname, 'tasks', 'superlint_demo');
  const skillPath = path.join(__dirname, 'skills', 'superlint');
  const resultsDir = path.join(__dirname, 'results');

  const runner = new EvalRunner(new DockerProvider(), resultsDir);
  const agent = new GeminiAgent();

  console.log('🚀 Starting SuperLint Demo with Gemini CLI...');
  console.log('-------------------------------------------');

  // 1. Run WITHOUT Skill
  console.log('\n[Step 1] Running WITHOUT Skill (Baseline)...');
  const baseline = await runner.runEval(agent, taskPath, [], 1, { GEMINI_API_KEY: apiKey });
  console.log(`Pass Rate: ${baseline.pass_rate}`);

  // 2. Run WITH Skill
  console.log('\n[Step 2] Running WITH Skill...');
  const withSkill = await runner.runEval(agent, taskPath, [skillPath], 1, { GEMINI_API_KEY: apiKey });
  console.log(`Pass Rate: ${withSkill.pass_rate}`);

  console.log('\n-------------------------------------------');
  console.log('✅ Demo complete! Results saved to ./results');
  console.log('Use "pnpm run analyze" to see the Normalized Gain.');
}

runDemo().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
