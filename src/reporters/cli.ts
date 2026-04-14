import * as fs from 'fs-extra';
import * as path from 'path';
import { fmt, header } from '../utils/cli';

// ─── Main ──────────────────────────────────────────────────
export async function runCliPreview(resultsDir: string) {
    const resolved = path.resolve(resultsDir);
    const files = (await fs.readdir(resolved)).filter(f => f.endsWith('.json'));
    const reports = [];
    for (const file of files) {
        try {
            const report = await fs.readJSON(path.join(resolved, file));
            reports.push({ file, ...report });
        } catch { /* skip malformed */ }
    }

    if (!reports.length) {
        console.log(`\n  ${fmt.dim('No reports found in')} ${resolved}\n`);
        return;
    }

    // Sort by timestamp desc
    reports.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    console.log(`\n${fmt.bold('skillgrade preview')}  ${fmt.dim(`${reports.length} reports from ${resolved}`)}\n`);

    for (const report of reports) {
        const passRate = report.pass_rate ?? 0;
        const isPass = passRate >= 0.5;
        const trials = report.trials || [];
        const completedTrials = trials.filter((t: any) => t.status !== 'cancelled');
        const nComp = completedTrials.length || 1;
        const avgDur = completedTrials.reduce((s: number, t: any) => s + (t.duration_ms || 0), 0) / nComp;
        const totalTokens = completedTrials.reduce((s: number, t: any) => s + (t.input_tokens || 0) + (t.output_tokens || 0), 0);
        const isPartial = report.status === 'partial';

        // ── Report header
        let status = isPass ? fmt.pass('PASS') : fmt.fail('FAIL');
        if (isPartial) status = fmt.dim('PARTIAL');
        header(`${status}  ${report.task}`);

        // Timestamp
        const ts = report.timestamp ? new Date(report.timestamp).toLocaleString() : '';
        if (ts) console.log(`    ${fmt.dim(ts)}`);
        console.log();

        // ── Summary metrics
        const metrics = [
            ['Pass Rate', `${(passRate * 100).toFixed(1)}%`],
            ['pass@k', report.pass_at_k != null ? `${(report.pass_at_k * 100).toFixed(1)}%` : '—'],
            ['pass^k', report.pass_pow_k != null ? `${(report.pass_pow_k * 100).toFixed(1)}%` : '—'],
            ['Avg Duration', `${(avgDur / 1000).toFixed(1)}s`],
            ['Total Tokens', `~${totalTokens}`],
            ['Skills', report.skills_used?.join(', ') || 'none'],
        ];

        for (const [label, value] of metrics) {
            console.log(`    ${fmt.dim(label.padEnd(14))} ${fmt.bold(value)}`);
        }
        console.log();

        // ── Trials
        for (const trial of trials) {
            const isCancelled = trial.status === 'cancelled';
            const tp = trial.reward >= 0.5;
            let trialStatus = tp ? fmt.pass('PASS') : fmt.fail('FAIL');
            if (isCancelled) trialStatus = fmt.dim('CANCELLED');

            const reward = isCancelled ? fmt.dim(' —.—— ') : fmt.bold(trial.reward.toFixed(2));
            const dur = isCancelled ? fmt.dim(' —.——s ') : `${((trial.duration_ms || 0) / 1000).toFixed(1)}s`;
            const cmds = isCancelled ? fmt.dim(' — cmds ') : `${trial.n_commands || 0} cmds`;
            const graders = (trial.grader_results || []).map((g: any) => {
                const scoreStr = g.score.toFixed(1);
                const colored = g.score >= 0.5 ? fmt.green(scoreStr) : fmt.red(scoreStr);
                return `${fmt.dim(g.grader_type)} ${colored}`;
            }).join('  ');

            console.log(`    ${fmt.dim(`${trial.trial_id}`.padEnd(4))} ${trialStatus}  ${reward}  ${fmt.dim(dur.padEnd(7))} ${fmt.dim(cmds.padEnd(7))} ${graders}`);
        }
        console.log();

        // ── LLM grader details
        const hasLlm = trials.some((t: any) => t.grader_results?.some((g: any) => g.grader_type === 'llm_rubric'));
        if (hasLlm) {
            for (const trial of trials.filter((t: any) => t.status !== 'cancelled')) {
                const llmGraders = (trial.grader_results || []).filter((g: any) => g.grader_type === 'llm_rubric');
                for (const g of llmGraders) {
                    const scoreStr = g.score >= 0.5 ? fmt.green(g.score.toFixed(2)) : fmt.red(g.score.toFixed(2));
                    console.log(`    ${fmt.dim(`trial ${trial.trial_id}`)} ${scoreStr} ${fmt.dim(g.details.substring(0, 100))}`);
                }
            }
            console.log();
        }

        console.log(`    ${fmt.dim(report.file)}`);
        console.log();
    }
}
