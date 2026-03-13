#!/usr/bin/env node

/**
 * skilleval CLI
 *
 * Usage:
 *   skilleval                     Run all eval tasks from eval.yaml
 *   skilleval init                Generate eval.yaml from detected skills
 *   skilleval preview [browser]   View results (CLI default, or browser)
 *   skilleval <task-name>         Run a specific task
 *
 * Options:
 *   --trials=N         Override trial count
 *   --parallel=N       Run trials concurrently
 *   --validate         Run reference solutions to verify graders
 *   --ci               CI mode: exit non-zero if below threshold
 *   --threshold=0.8    Pass rate threshold for --ci
 *   --preview          Open results after running
 */

import { runInit } from './commands/init';
import { runEvals } from './commands/run';
import { runPreview } from './commands/preview';
import * as os from 'os';
import * as path from 'path';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const cwd = process.cwd();

    // Parse global flags
    const getFlag = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
    const hasFlag = (name: string) => args.includes(`--${name}`);

    if (command === '--help' || command === '-h') {
        printHelp();
        return;
    }

    if (command === '--version' || command === '-v') {
        const pkg = require('../package.json');
        console.log(pkg.version);
        return;
    }

    if (command === 'init') {
        await runInit(cwd);
        return;
    }

    if (command === 'preview') {
        const mode = args[1] === 'browser' ? 'browser' : 'cli';
        const outputDir = getFlag('output') || path.join(os.tmpdir(), 'skilleval');
        await runPreview(cwd, mode, outputDir);
        return;
    }

    // Default: run evals
    const taskName = command && !command.startsWith('-') ? command : undefined;
    const openPreview = hasFlag('preview');

    // Preset modes (can be overridden by --trials)
    let preset: 'smoke' | 'reliable' | 'regression' | undefined;
    let presetTrials: number | undefined;
    if (hasFlag('smoke')) {
        preset = 'smoke';
        presetTrials = 5;
    } else if (hasFlag('reliable')) {
        preset = 'reliable';
        presetTrials = 15;
    } else if (hasFlag('regression')) {
        preset = 'regression';
        presetTrials = 30;
    }

    const explicitTrials = getFlag('trials') ? parseInt(getFlag('trials')!) : undefined;

    const outputDir = getFlag('output') || path.join(os.tmpdir(), 'skilleval');

    await runEvals(cwd, {
        task: taskName,
        trials: explicitTrials ?? presetTrials,
        parallel: getFlag('parallel') ? parseInt(getFlag('parallel')!) : undefined,
        validate: hasFlag('validate'),
        ci: hasFlag('ci'),
        threshold: getFlag('threshold') ? parseFloat(getFlag('threshold')!) : undefined,
        preset,
        agent: getFlag('agent'),
        provider: getFlag('provider'),
        output: outputDir,
    });

    if (openPreview) {
        await runPreview(cwd, 'cli', outputDir);
    }
}

function printHelp() {
    console.log(`
  📊 skilleval — Evaluation framework for Agent Skills

  Usage:
    skilleval                     Run all tasks from eval.yaml
    skilleval init                Generate eval.yaml from detected skills
    skilleval preview [browser]   View results (CLI default, or browser)
    skilleval <task-name>         Run a specific task

  Presets:
    --smoke            Quick smoke test (5 trials, reports pass@k)
    --reliable         Reliable pass rate (15 trials, reports mean reward)
    --regression       High-confidence regression (30 trials, reports pass^k)

  Options:
    --trials=N         Override trial count (overrides preset)
    --parallel=N       Run trials concurrently
    --output=DIR       Output directory for reports and temp files
                       Default: $TMPDIR/skilleval
    --validate         Verify graders using reference solutions
    --ci               CI mode: exit non-zero if below threshold
    --threshold=0.8    Pass rate threshold for CI mode
    --preview          Open CLI results after running

  Examples:
    skilleval init                # scaffold eval.yaml
    skilleval                     # run all evals
    skilleval --smoke             # quick 5-trial smoke test
    skilleval --regression --ci   # CI regression with 30 trials
    skilleval preview browser     # open web UI
`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
