import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';

export async function runBrowserPreview(resultsDir: string, port: number = 3847) {
    const resolved = path.resolve(resultsDir);
    const htmlPath = path.join(__dirname, '..', 'viewer.html');

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);

        if (url.pathname === '/api/reports') {
            const files = (await fs.readdir(resolved)).filter(f => f.endsWith('.json'));
            const reports = [];
            for (const file of files) {
                try {
                    const report = await fs.readJSON(path.join(resolved, file));
                    reports.push({ file, ...report });
                } catch { /* skip malformed */ }
            }
            // Sort by timestamp desc
            reports.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(reports));
        } else if (url.pathname === '/api/report') {
            const file = url.searchParams.get('file');
            if (!file) { res.writeHead(400); res.end('Missing file param'); return; }
            const filePath = path.join(resolved, file);

            if (req.method === 'DELETE') {
                if (await fs.pathExists(filePath)) {
                    await fs.remove(filePath);
                    res.writeHead(204);
                    res.end();
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
                return;
            }

            if (await fs.pathExists(filePath)) {
                const report = await fs.readJSON(filePath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(report));
            } else {
                res.writeHead(404); res.end('Not found');
            }
        } else {
            const html = await fs.readFile(htmlPath, 'utf-8');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(html);
        }
    });

    server.listen(port, () => {
        const addr = server.address() as any;
        const actualPort = typeof addr === 'object' ? addr.port : port;
        console.log(`\nskillgrade preview`);
        console.log(`\n  url       http://localhost:${actualPort}`);
        console.log(`  results   ${resolved}\n`);
    });
}
