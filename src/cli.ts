import { DockerProvider } from './providers/docker';
import { LocalProvider } from './providers/local';
import { EvalRunner } from './evalRunner';
import { GeminiAgent } from './agents/gemini';
import { ClaudeAgent } from './agents/claude';
import * as path from 'path';
import * as fs from 'fs-extra';

async function main() {
    const args = process.argv.slice(2);
    const taskArg = args[0];

    if (!taskArg || taskArg === '--help' || taskArg === '-h') {
        console.log('Usage: npm run eval <task_name> [options]');
        console.log('\nOptions:');
        console.log('  --agent=gemini|claude    Default: gemini');
        console.log('  --provider=docker|local  Default: docker');
        console.log('  --trials=N               Default: 5');
        console.log('  --no-skills              Exclude co-located skills');
        process.exit(0);
    }

    // Parse flags
    const agentType = args.find(a => a.startsWith('--agent='))?.split('=')[1] || 'gemini';
    const providerType = args.find(a => a.startsWith('--provider='))?.split('=')[1] || 'docker';
    const trials = parseInt(args.find(a => a.startsWith('--trials='))?.split('=')[1] || '5');
    const noSkills = args.includes('--no-skills');

    // Resolve task path
    const tasksDir = path.join(__dirname, '..', 'tasks');
    const availableTasks = await fs.readdir(tasksDir);

    // Strict matching: exact match first, then unique prefix match
    let taskName: string | undefined;
    const exactMatch = availableTasks.find(t => t === taskArg);
    if (exactMatch) {
        taskName = exactMatch;
    } else {
        const prefixMatches = availableTasks.filter(t => t.startsWith(taskArg));
        if (prefixMatches.length === 1) {
            taskName = prefixMatches[0];
        } else if (prefixMatches.length > 1) {
            console.error(`Error: Ambiguous task "${taskArg}" matches: ${prefixMatches.join(', ')}`);
            process.exit(1);
        }
    }

    if (!taskName) {
        console.error(`Error: Task "${taskArg}" not found in ${tasksDir}`);
        console.log(`Available tasks: ${availableTasks.join(', ')}`);
        process.exit(1);
    }

    const taskPath = path.join(tasksDir, taskName);
    const resultsDir = path.join(__dirname, '..', 'results');

    // Setup components
    const provider = providerType === 'docker' ? new DockerProvider() : new LocalProvider();
    const runner = new EvalRunner(provider, resultsDir);

    let agent;
    if (agentType === 'claude') {
        agent = new ClaudeAgent();
    } else {
        agent = new GeminiAgent();
    }

    // Auto-discover skills from task directory
    const skillsPaths: string[] = [];
    if (!noSkills) {
        const skillsDir = path.join(taskPath, 'skills');
        if (await fs.pathExists(skillsDir)) {
            const skillDirs = (await fs.readdir(skillsDir, { withFileTypes: true }))
                .filter(d => d.isDirectory())
                .map(d => path.join(skillsDir, d.name));
            skillsPaths.push(...skillDirs);
            if (skillDirs.length > 0) {
                console.log(`Auto-discovered skills: ${skillDirs.map(d => path.basename(d)).join(', ')}`);
            }
        }
    }

    // Forward all environment variables
    const env: Record<string, string> = {};
    if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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
