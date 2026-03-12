import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';

const PORT = 3847;

async function main() {
  const args = process.argv.slice(2);
  const logDirArg = args.find(arg => arg.startsWith('--logDir='));
  const logDir = logDirArg ? logDirArg.split('=')[1] : './results';
  const resolvedDir = path.resolve(logDir);
  const htmlPath = path.join(__dirname, 'viewer.html');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (url.pathname === '/api/reports') {
      if (!await fs.pathExists(resolvedDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      const files = (await fs.readdir(resolvedDir)).filter(f => f.endsWith('.json')).reverse();
      const reports = [];
      for (const file of files) {
        try {
          const report = await fs.readJSON(path.join(resolvedDir, file));
          reports.push({ file, ...report });
        } catch { /* skip malformed */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reports));
    } else if (url.pathname === '/api/report') {
      const file = url.searchParams.get('file');
      if (!file) { res.writeHead(400); res.end('Missing file param'); return; }
      const filePath = path.join(resolvedDir, file);
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

  server.listen(PORT, () => {
    console.log(`📊 Skill Eval Viewer → http://localhost:${PORT}`);
    console.log(`   Serving from: ${resolvedDir}`);
  });
}

main();
