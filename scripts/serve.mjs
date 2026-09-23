import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const files = new Map([['/', ['web/index.html', 'text/html']], ['/app.mjs', ['web/app.mjs', 'text/javascript']], ['/style.css', ['web/style.css', 'text/css']], ...['session', 'verify', 'logic', 'match', 'modular'].map(n => [`/src/${n}.mjs`, [`src/${n}.mjs`, 'text/javascript']]), ['/orders.json', ['examples/orders.json', 'application/json']]]);
export function makeServer() {
  return createServer(async (req, res) => {
    const host = req.headers.host ?? '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) { res.writeHead(403); res.end(); return; }
    const entry = files.get(req.url);
    if (req.method !== 'GET' || !entry) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const body = await readFile(new URL(`../${entry[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" }); res.end(body);
    } catch { res.writeHead(500); res.end('Read error'); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173); const server = makeServer();
  server.on('error', err => { console.error(err.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`LotGate: http://127.0.0.1:${port} — local simulation only`));
}
