import { DockerProvider } from './providers/docker';
import { LocalProvider } from './providers/local';
import { EvalRunner, loadTaskConfig } from './evalRunner';
import { GeminiAgent } from './agents/gemini';
import { ClaudeAgent } from './agents/claude';
import { BaseAgent } from './types';
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
        console.log('  --parallel=N             Run trials concurrently (default: 1)');
        console.log('  --no-skills              Exclude co-located skills');
        console.log('  --validate               Run reference solution to verify graders');
        console.log('  --suite=<name>           Run all tasks in a suite');
        process.exit(0);
    }

    // Parse flags
    const agentType = args.find(a => a.startsWith('--agent='))?.split('=')[1] || 'gemini';
    const providerType = args.find(a => a.startsWith('--provider='))?.split('=')[1] || 'docker';
    const trials = parseInt(args.find(a => a.startsWith('--trials='))?.split('=')[1] || '5');
    const parallel = parseInt(args.find(a => a.startsWith('--parallel='))?.split('=')[1] || '1');
    const noSkills = args.includes('--no-skills');
    const validate = args.includes('--validate');
    const suiteArg = args.find(a => a.startsWith('--suite='))?.split('=')[1];

    // Setup provider
    const provider = providerType === 'docker' ? new DockerProvider() : new LocalProvider();
    const resultsDir = path.join(__dirname, '..', 'results');

    // Forward all environment variables
    const env: Record<string, string> = {};
    if (process.env.GEMINI_API_KEY) env.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

    // Determine tasks to run
    const tasksDir = path.join(__dirname, '..', 'tasks');
    let taskNames: string[] = [];

    if (suiteArg) {
        // Load suite
        const suitePath = path.join(__dirname, '..', 'suites', `${suiteArg}.toml`);
        if (!await fs.pathExists(suitePath)) {
            console.error(`Error: Suite "${suiteArg}" not found at ${suitePath}`);
            const suitesDir = path.join(__dirname, '..', 'suites');
            if (await fs.pathExists(suitesDir)) {
                const available = (await fs.readdir(suitesDir)).filter(f => f.endsWith('.toml')).map(f => f.replace('.toml', ''));
                console.log(`Available suites: ${available.join(', ')}`);
            }
            process.exit(1);
        }
        const toml = require('toml');
        const suiteConfig = toml.parse(await fs.readFile(suitePath, 'utf-8'));
        taskNames = suiteConfig.tasks || [];
        console.log(`📋 Running suite "${suiteArg}" with ${taskNames.length} tasks`);
    } else {
        // Single task
        const availableTasks = await fs.readdir(tasksDir);
        const exactMatch = availableTasks.find(t => t === taskArg);
        if (exactMatch) {
            taskNames = [exactMatch];
        } else {
            const prefixMatches = availableTasks.filter(t => t.startsWith(taskArg));
            if (prefixMatches.length === 1) {
                taskNames = [prefixMatches[0]];
            } else if (prefixMatches.length > 1) {
                console.error(`Error: Ambiguous task "${taskArg}" matches: ${prefixMatches.join(', ')}`);
                process.exit(1);
            } else {
                console.error(`Error: Task "${taskArg}" not found in ${tasksDir}`);
                console.log(`Available tasks: ${availableTasks.join(', ')}`);
                process.exit(1);
            }
        }
    }

    // Run each task
    for (const taskName of taskNames) {
        const taskPath = path.join(tasksDir, taskName);
        const runner = new EvalRunner(provider, resultsDir);

        // Auto-discover skills
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

        if (validate) {
            // Validation mode
            console.log(`\n🔍 Validating "${taskName}" with reference solution...\n`);
            const solvePath = path.join(taskPath, 'solution', 'solve.sh');
            if (!await fs.pathExists(solvePath)) {
                console.error(`No reference solution found at ${solvePath}`);
                process.exit(1);
            }

            const solveAgent = {
                async run(_instruction: string, _workspace: string, runCommand: any) {
                    const result = await runCommand(`bash solution/solve.sh`);
                    return result.stdout;
                }
            } as BaseAgent;

            const report = await runner.runEval(solveAgent, taskPath, skillsPaths, 1, env);
            const allPassed = report.trials[0].reward >= 0.5;

            console.log('');
            console.table(report.trials[0].grader_results.map(gr => ({
                Grader: gr.grader_type,
                Score: gr.score.toFixed(2),
                Weight: gr.weight,
                Details: gr.details.substring(0, 60)
            })));
            console.log(`\n${allPassed ? '✅ Validation PASSED' : '❌ Validation FAILED'} — reward: ${report.trials[0].reward.toFixed(2)}`);
            if (!allPassed) process.exit(1);
        } else {
            // Normal eval mode
            const agent = agentType === 'claude' ? new ClaudeAgent() : new GeminiAgent();

            console.log(`\n🚀 ${taskName} | agent=${agentType} provider=${providerType} trials=${trials}${parallel > 1 ? ` parallel=${parallel}` : ''}\n`);

            try {
                const report = await runner.runEval(agent, taskPath, skillsPaths, trials, env, parallel);

                // Per-trial table
                console.log('');
                console.table(report.trials.map(t => ({
                    Trial: t.trial_id,
                    Reward: t.reward.toFixed(2),
                    Duration: (t.duration_ms / 1000).toFixed(1) + 's',
                    Commands: t.n_commands,
                    Graders: t.grader_results.map(g => `${g.grader_type}:${g.score.toFixed(1)}`).join(' ')
                })));

                // Summary
                const avgDur = report.trials.reduce((s, t) => s + t.duration_ms, 0) / report.trials.length;
                const avgCmds = report.trials.reduce((s, t) => s + t.n_commands, 0) / report.trials.length;
                console.log(`  Pass Rate   ${(report.pass_rate * 100).toFixed(1)}%`);
                console.log(`  pass@${trials}      ${(report.pass_at_k * 100).toFixed(1)}%`);
                console.log(`  pass^${trials}      ${(report.pass_pow_k * 100).toFixed(1)}%`);
                console.log(`  Avg Duration ${(avgDur / 1000).toFixed(1)}s | Avg Commands ${avgCmds.toFixed(1)}`);
                console.log(`  Skills      ${report.skills_used.length > 0 ? report.skills_used.join(', ') : 'none'}`);
                console.log(`  Saved to    ${resultsDir}\n`);
            } catch (err) {
                console.error('\nEvaluation failed:', err);
                process.exit(1);
            }
        }
    }
}

main();
