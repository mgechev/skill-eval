#!/usr/bin/env node

/**
 * skillgrade CLI
 *
 * Usage:
 *   skillgrade                     Run all eval tasks from eval.yaml
 *   skillgrade init                Generate eval.yaml from detected skills
 *   skillgrade preview [browser]   View results (CLI default, or browser)
 *   skillgrade <task-name>         Run a specific eval
 *
 * Options:
 *   --trials=N         Override trial count
 *   --parallel=N       Run trials concurrently
 *   --validate         Run reference solutions to verify graders
 *   --ci               CI mode: exit non-zero if below threshold
 *   --threshold=0.8    Pass rate threshold for --ci
 *   --preview          Open results after running
 */

import { parseFilter } from './core/filter';
import { runInit } from './commands/init';
import { runEvals } from './commands/run';
import { runPreview } from './commands/preview';
import { fmt } from './utils/cli';
import * as os from 'os';
import * as path from 'path';

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    const cwd = process.cwd();

    // Parse global flags. Values may contain "=" (regexes, filter values), so
    // take everything after the first one; repeatable flags collect every match.
    const getFlags = (name: string) => args
        .filter(a => a.startsWith(`--${name}=`))
        .map(a => a.slice(`--${name}=`.length));
    const getFlag = (name: string) => getFlags(name)[0];
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
        await runInit(cwd, { force: hasFlag('force') });
        return;
    }

    if (command === 'preview') {
        const mode = args[1] === 'browser' ? 'browser' : 'cli';
        const outputDir = getFlag('output') || path.join(os.tmpdir(), 'skillgrade');
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

    // Resolve eval filter: --eval flag, deprecated --task flag, or positional arg
    let evalFilter: string | undefined;
    if (getFlag('eval')) {
        evalFilter = getFlag('eval');
    } else if (getFlag('task')) {
        console.log(`  ${fmt.dim('note:')} --task is deprecated, use --eval instead\n`);
        evalFilter = getFlag('task');
    } else if (taskName) {
        evalFilter = taskName;
    }

    const outputDir = getFlag('output') || path.join(os.tmpdir(), 'skillgrade');

    const filters = [
        ...getFlags('filter').map(spec => parseFilter(spec, false)),
        ...getFlags('not-filter').map(spec => parseFilter(spec, true)),
    ];

    await runEvals(cwd, {
        eval: evalFilter,
        filters,
        filterPattern: getFlag('filter-pattern'),
        list: hasFlag('list'),
        trials: explicitTrials ?? presetTrials,
        parallel: getFlag('parallel') ? parseInt(getFlag('parallel')!) : undefined,
        validate: hasFlag('validate'),
        ci: hasFlag('ci'),
        threshold: getFlag('threshold') ? parseFloat(getFlag('threshold')!) : undefined,
        preset,
        agent: getFlag('agent'),
        model: getFlag('model'),
        provider: getFlag('provider'),
        grader: getFlag('grader'),
        output: outputDir,
        acpCommand: getFlag('acp-command'),
        command: getFlag('command'),
        openCodeAgent: getFlag('opencode-agent'),
        openCodeModel: getFlag('opencode-model'),
    });

    if (openPreview) {
        await runPreview(cwd, 'cli', outputDir);
    }
}

function printHelp() {
    console.log(`
  skillgrade - The easiest way to evaluate your Agent Skills

  Usage:
    skillgrade                     Run all evals from eval.yaml
    skillgrade init [--force]      Generate eval.yaml (--force to overwrite)
    skillgrade preview [browser]   View results (CLI default, or browser)
    skillgrade <eval-name>         Run a specific eval

  Presets:
    --smoke            Quick smoke test (5 trials, reports pass@k)
    --reliable         Reliable pass rate (15 trials, reports mean reward)
    --regression       High-confidence regression (30 trials, reports pass^k)

  Selecting tasks:
    --eval=NAME[,NAME] Run specific evals by name (comma-separated)
    --filter=KEY=VAL   Keep tasks whose metadata matches (repeatable).
                       Comma-separated values are OR; repeated flags are AND.
    --not-filter=KEY=VAL   Drop tasks whose metadata matches (repeatable)
    --filter-pattern=RE    Keep tasks whose name matches a regex
    --list             Print the selected tasks and exit without running

  Options:
    --grader=TYPE      Run only graders of this type (deterministic|llm_rubric)
    --trials=N         Override trial count (overrides preset)
    --parallel=N       Run trials concurrently
    --agent=gemini|claude|codex|acp|opencode|command   Override agent (default: auto-detect from API key)
    --model=NAME       Model the agent answers with (gemini, claude, codex,
                       opencode).
                       Default: whatever the agent CLI is configured to use.
    --provider=docker|local Override provider (default: docker)
    --acp-command=CMD  ACP agent command (e.g., "gemini --acp")
    --command=CMD      Command to run for the 'command' agent (e.g., "node mycli.js")
    --opencode-agent=NAME   OpenCode agent (build|plan|explore)
    --opencode-model=MODEL OpenCode model (provider/model format)
    --output=DIR       Output directory for reports and temp files
                       Default: $TMPDIR/skillgrade
    --validate         Verify graders using reference solutions
    --ci               CI mode: exit non-zero if below threshold
    --threshold=0.8    Pass rate threshold for CI mode
    --preview          Open CLI results after running

  Examples:
    skillgrade init                # scaffold eval.yaml
    skillgrade init --force        # overwrite existing eval.yaml
    skillgrade                     # run all evals
    skillgrade --smoke             # quick 5-trial smoke test
    skillgrade --eval=fix-linting  # run a specific eval
    skillgrade --eval=foo,bar      # run multiple evals
    skillgrade --filter=tier=easy,medium           # by metadata, OR within a key
    skillgrade --filter=tier=hard --filter=form=refuse   # AND across keys
    skillgrade --filter=tags=smoke --not-filter=tags=flaky
    skillgrade --filter-pattern='^easy--' --list   # preview a selection
    skillgrade --regression --ci   # CI regression with 30 trials
    skillgrade --agent=acp --acp-command="gemini --acp"  # use ACP-compatible agent
    skillgrade --agent=claude --model=opus         # compare models on one suite
    skillgrade preview browser     # open web UI
`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
