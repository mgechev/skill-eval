/**
 * CLI formatting utilities.
 *
 * Uses ANSI codes that work on both light and dark terminals.
 * Respects NO_COLOR env var (https://no-color.org/).
 */

const NO_COLOR = !!process.env.NO_COLOR;

const code = (n: string) => NO_COLOR ? '' : `\x1b[${n}m`;
const reset = code('0');
const bold = code('1');
const dim = code('2');
const green = code('32');
const red = code('31');
const cyan = code('36');

export const fmt = {
    bold: (s: string) => `${bold}${s}${reset}`,
    dim: (s: string) => `${dim}${s}${reset}`,
    green: (s: string) => `${green}${s}${reset}`,
    red: (s: string) => `${red}${s}${reset}`,
    cyan: (s: string) => `${cyan}${s}${reset}`,
    pass: (s: string) => `${bold}${green}${s}${reset}`,
    fail: (s: string) => `${bold}${red}${s}${reset}`,
};

/** Print a section header with a rule line */
export function header(title: string, width: number = 60) {
    const rule = '─'.repeat(Math.max(0, width - title.length - 3));
    console.log(`\n${fmt.bold(`── ${title} `)}${fmt.dim(rule)}`);
}

/** Print a labeled key-value pair */
export function kv(label: string, value: string, indent: number = 2) {
    const pad = ' '.repeat(indent);
    const labelPad = label.padEnd(12);
    console.log(`${pad}${fmt.dim(labelPad)}${value}`);
}

/** Print a trial result row */
export function trialRow(trialId: number, total: number, reward: number, duration: string, commands: number, graders: { type: string; score: number }[]) {
    const pad = '  ';
    const status = reward >= 0.5 ? fmt.pass('PASS') : fmt.fail('FAIL');
    const rewardStr = reward.toFixed(2);
    const trialLabel = `${trialId}/${total}`.padEnd(6);
    const graderStr = graders.map(g => {
        const name = g.type === 'deterministic' ? 'deterministic' : 'llm_rubric';
        const scoreStr = g.score.toFixed(2);
        const color = g.score >= 0.5 ? fmt.green(scoreStr) : fmt.red(scoreStr);
        return `${fmt.dim(name)} ${color}`;
    }).join('  ');

    console.log(`${pad}  ${fmt.dim(trialLabel)} ${status}  ${fmt.bold(rewardStr)}  ${fmt.dim(duration.padEnd(7))} ${fmt.dim(commands + ' cmds')}  ${graderStr}`);
}

/** Print the results summary block */
export function resultsSummary(passRate: number, passAtK: number, passPowK: number, trials: number, preset?: string) {
    const presetLabel = preset === 'smoke' ? ' (smoke test)'
        : preset === 'reliable' ? ' (reliable)'
            : preset === 'regression' ? ' (regression)'
                : '';

    header(`Results${presetLabel}`);

    const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(7);
    const marker = (key: string) => preset === key ? fmt.cyan(' ◂') : '';

    console.log(`    Pass Rate  ${fmt.bold(fmtPct(passRate))}${marker('reliable')}`);
    console.log(`    pass@${trials}     ${fmtPct(passAtK)}${marker('smoke')}`);
    console.log(`    pass^${trials}     ${fmtPct(passPowK)}${marker('regression')}`);
    console.log();
}

/** Print a validation result */
export function validationResult(passed: boolean, reward: number, graders: { type: string; score: number; details: string }[]) {
    for (const g of graders) {
        const scoreStr = g.score.toFixed(2);
        const color = g.score >= 0.5 ? fmt.green(scoreStr) : fmt.red(scoreStr);
        console.log(`    ${fmt.dim(g.type.padEnd(16))} ${color}  ${fmt.dim(g.details.substring(0, 60))}`);
    }
    console.log();
    if (passed) {
        console.log(`    ${fmt.pass('PASSED')}  reward ${fmt.bold(reward.toFixed(2))}`);
    } else {
        console.log(`    ${fmt.fail('FAILED')}  reward ${fmt.bold(reward.toFixed(2))}`);
    }
    console.log();
}

/**
 * In-place spinner that shows current phase + elapsed time on one line.
 *
 * Usage:
 *   const s = new Spinner('1/3', 'building image');
 *   s.update('running agent');
 *   s.update('grading');
 *   s.stop('PASS  0.85  120.3s  2 cmds');
 */
export class Spinner {
    private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    private frameIdx = 0;
    private interval: ReturnType<typeof setInterval> | null = null;
    private prefix: string;
    private phase: string;
    private startTime: number;

    constructor(label: string, initialPhase: string) {
        this.prefix = `    ${fmt.dim(label.padEnd(6))}`;
        this.phase = initialPhase;
        this.startTime = Date.now();

        if (process.stdout.isTTY && !NO_COLOR) {
            this.interval = setInterval(() => this.render(), 80);
            this.render();
        } else {
            // Non-TTY: just print once
            process.stdout.write(`${this.prefix} ${fmt.dim(this.phase)}\n`);
        }
    }

    render() {
        const frame = this.frames[this.frameIdx % this.frames.length];
        this.frameIdx++;
        const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
        const line = `${this.prefix} ${fmt.cyan(frame)} ${fmt.dim(this.phase)}  ${fmt.dim(elapsed + 's')}`;
        process.stdout.write(`\r\x1b[K${line}`);
    }

    /** Update the spinner's phase text */
    update(phase: string) {
        this.phase = phase;
        if (!this.interval) {
            // Non-TTY: print each phase
            process.stdout.write(`${this.prefix} ${fmt.dim(this.phase)}\n`);
        }
    }

    /** Stop the spinner and print the final line (replaces the spinner) */
    stop(finalLine: string) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        process.stdout.write(`\r\x1b[K${this.prefix} ${finalLine}\n`);
    }
}

