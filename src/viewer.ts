import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';

const PORT = 3847;

async function main() {
    const args = process.argv.slice(2);
    const logDirArg = args.find(arg => arg.startsWith('--logDir='));
    const logDir = logDirArg ? logDirArg.split('=')[1] : './results';
    const resolvedDir = path.resolve(logDir);

    const server = http.createServer(async (req, res) => {
        if (req.url === '/' || req.url === '/index.html') {
            const files = (await fs.readdir(resolvedDir)).filter(f => f.endsWith('.json')).reverse();
            const reports = [];
            for (const file of files) {
                const report = await fs.readJSON(path.join(resolvedDir, file));
                reports.push({ file, ...report });
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(renderIndex(reports));
        } else if (req.url?.startsWith('/report/')) {
            const file = decodeURIComponent(req.url.replace('/report/', ''));
            const filePath = path.join(resolvedDir, file);
            if (await fs.pathExists(filePath)) {
                const report = await fs.readJSON(filePath);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(renderReport(report, file));
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        } else {
            res.writeHead(404);
            res.end('Not found');
        }
    });

    server.listen(PORT, () => {
        console.log(`📊 Transcript Viewer running at http://localhost:${PORT}`);
        console.log(`   Serving reports from: ${resolvedDir}`);
    });
}

function renderIndex(reports: any[]): string {
    const rows = reports.map(r => `
        <tr>
            <td><a href="/report/${encodeURIComponent(r.file)}">${r.task}</a></td>
            <td>${(r.pass_rate * 100).toFixed(1)}%</td>
            <td>${r.trials?.length || 0}</td>
            <td>${r.skills_used?.join(', ') || 'none'}</td>
            <td>${r.pass_at_k !== undefined ? (r.pass_at_k * 100).toFixed(1) + '%' : '—'}</td>
            <td>${r.pass_pow_k !== undefined ? (r.pass_pow_k * 100).toFixed(1) + '%' : '—'}</td>
            <td class="mono">${r.file}</td>
        </tr>`).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Skill Eval Transcript Viewer</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 0.75rem 1rem; background: #1a1a2e; color: #8b8bff; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #1a1a2e; }
    a { color: #6c9bff; text-decoration: none; } a:hover { text-decoration: underline; }
    .mono { font-family: monospace; font-size: 0.8rem; color: #888; }
    tr:hover { background: #111122; }
</style></head><body>
<h1>📊 Skill Eval Transcript Viewer</h1>
<table>
    <tr><th>Task</th><th>Pass Rate</th><th>Trials</th><th>Skills</th><th>pass@k</th><th>pass^k</th><th>File</th></tr>
    ${rows}
</table></body></html>`;
}

function renderReport(report: any, filename: string): string {
    const trials = (report.trials || []).map((trial: any, i: number) => {
        const graderRows = (trial.grader_results || []).map((gr: any) => `
            <div class="grader ${gr.score >= 0.5 ? 'pass' : 'fail'}">
                <span class="badge">${gr.grader_type}</span>
                <span class="score">${gr.score.toFixed(2)}</span> × ${gr.weight}
                <span class="details">${escapeHtml(gr.details)}</span>
            </div>`).join('');

        const logEntries = (trial.session_log || []).map((entry: any) => {
            let content = '';
            const cls = entry.type;
            switch (entry.type) {
                case 'agent_start':
                    content = `<pre class="instruction">${escapeHtml(entry.instruction || '')}</pre>`;
                    break;
                case 'command':
                    content = `<div class="cmd">$ ${escapeHtml(entry.command || '')}</div>
                        <pre class="output">${escapeHtml(entry.stdout || '')}${entry.stderr ? '<span class="stderr">' + escapeHtml(entry.stderr) + '</span>' : ''}</pre>
                        <span class="exit-code ${entry.exitCode === 0 ? 'ok' : 'err'}">exit: ${entry.exitCode}</span>`;
                    break;
                case 'agent_result':
                    content = `<pre class="output">${escapeHtml(entry.output || '')}</pre>`;
                    break;
                case 'grader':
                    const gr = entry.grader_result;
                    if (gr) content = `<span class="badge">${gr.grader_type}</span> score: ${gr.score.toFixed(2)} — ${escapeHtml(gr.details)}`;
                    break;
                case 'reward':
                    content = `<span class="reward">${entry.value?.toFixed(2)}</span>`;
                    break;
            }
            return `<div class="log-entry ${cls}"><span class="log-type">${entry.type}</span><span class="timestamp">${entry.timestamp}</span>${content}</div>`;
        }).join('');

        return `
        <div class="trial">
            <h3>Trial ${trial.trial_id} — Reward: ${trial.reward.toFixed(2)} | Duration: ${((trial.duration_ms || 0) / 1000).toFixed(1)}s | Commands: ${trial.n_commands || 0}</h3>
            <div class="graders">${graderRows}</div>
            <details><summary>Session Log (${trial.session_log?.length || 0} entries)</summary>
                <div class="session-log">${logEntries}</div>
            </details>
        </div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${report.task} — Transcript</title>
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 2rem; max-width: 1200px; margin: 0 auto; }
    a { color: #6c9bff; text-decoration: none; } a:hover { text-decoration: underline; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
    h3 { font-size: 1rem; margin-bottom: 0.75rem; color: #ccc; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .trial { background: #111; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
    .graders { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
    .grader { padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.85rem; }
    .grader.pass { background: #0a2e0a; border: 1px solid #2d6a2d; }
    .grader.fail { background: #2e0a0a; border: 1px solid #6a2d2d; }
    .badge { background: #2a2a4e; padding: 0.15rem 0.5rem; border-radius: 3px; font-size: 0.75rem; margin-right: 0.5rem; }
    .score { font-weight: bold; color: #8bff8b; margin-right: 0.25rem; }
    .details { color: #aaa; margin-left: 0.5rem; }
    details { margin-top: 0.5rem; }
    summary { cursor: pointer; color: #6c9bff; font-size: 0.9rem; }
    .session-log { margin-top: 0.75rem; }
    .log-entry { padding: 0.5rem 0.75rem; border-left: 3px solid #333; margin-bottom: 0.25rem; }
    .log-entry.command { border-left-color: #4a9eff; }
    .log-entry.agent_start { border-left-color: #9b59b6; }
    .log-entry.agent_result { border-left-color: #2ecc71; }
    .log-entry.grader { border-left-color: #f39c12; }
    .log-entry.reward { border-left-color: #e74c3c; }
    .log-type { font-weight: bold; font-size: 0.75rem; text-transform: uppercase; margin-right: 0.75rem; color: #8b8bff; }
    .timestamp { font-size: 0.7rem; color: #555; }
    .cmd { font-family: monospace; color: #4aff4a; margin: 0.25rem 0; }
    pre { font-family: monospace; font-size: 0.85rem; white-space: pre-wrap; word-break: break-all; background: #0d0d0d; padding: 0.5rem; border-radius: 4px; margin-top: 0.25rem; max-height: 300px; overflow-y: auto; }
    .instruction { max-height: 150px; color: #ccc; }
    .stderr { color: #ff6b6b; }
    .exit-code { font-size: 0.75rem; font-family: monospace; }
    .exit-code.ok { color: #4aff4a; } .exit-code.err { color: #ff6b6b; }
    .reward { font-size: 1.2rem; font-weight: bold; color: #f39c12; }
</style></head><body>
<a href="/">← Back</a>
<h1>${escapeHtml(report.task)}</h1>
<div class="meta">
    Pass Rate: ${(report.pass_rate * 100).toFixed(1)}% |
    pass@k: ${report.pass_at_k !== undefined ? (report.pass_at_k * 100).toFixed(1) + '%' : '—'} |
    pass^k: ${report.pass_pow_k !== undefined ? (report.pass_pow_k * 100).toFixed(1) + '%' : '—'} |
    Skills: ${report.skills_used?.join(', ') || 'none'} |
    File: ${escapeHtml(filename)}
</div>
${trials}
</body></html>`;
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

main();
