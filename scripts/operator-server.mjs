import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { batchService, json } from './batch-service.mjs';
import { xlayerRuntime } from './xlayer-runtime.mjs';
export function operatorServer(service, { token, origin }) {
  if (typeof token !== 'string' || token.length < 32) throw Error('LOTGATE_TOKEN must have at least 32 characters');
  const expected = createHash('sha256').update('Bearer ' + token).digest();
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw Error('Invalid public origin');
  const assets = new Map([['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
  const rates = new Map();
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(json(data)); };
    try {
      if (req.headers.host !== url.host || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: 'Origin not allowed' });
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [file, type] = assets.get(path); const body = await readFile(new URL('../web/operator/' + file, import.meta.url));
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(body); return;
      }
      if (!path.startsWith('/api/')) return send(404, { error: 'Not found' });
      const now = Date.now(), ip = req.socket.remoteAddress;
      for (const [key, item] of rates) if (item.until < now) rates.delete(key);
      const rate = rates.get(ip) ?? { count: 0, until: now + 60000 }; rates.set(ip, rate);
      if (++rate.count > 180) return send(429, { error: 'Too many requests' });
      const actual = createHash('sha256').update(req.headers.authorization ?? '').digest();
      if (!timingSafeEqual(actual, expected)) return send(401, { error: 'Invalid access key' });
      if (req.method === 'GET' && path === '/api/batches') return send(200, service.list());
      if (req.method === 'GET' && path === '/api/health') return send(service.health().available ? 200 : 503, service.health());
      const match = path.match(/^\/api\/batches\/([a-f0-9-]{36})(\/run)?$/);
      if (req.method === 'GET' && match && !match[2]) return send(200, service.get(match[1]));
      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 65536) { send(413, { error: 'Request too large' }); req.destroy(); return; } chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (path === '/api/batches') return send(201, await service.create(body));
      if (match?.[2]) return send(202, await service.run(match[1], body.revision));
      return send(404, { error: 'Not found' });
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.LOTGATE_TOKEN, port = Number(process.env.PORT ?? 4173);
  if (!token || token.length < 32) throw Error('Set LOTGATE_TOKEN (minimum 32 random characters); server will not start without authentication');
  const origin = process.env.LOTGATE_ORIGIN || `http://127.0.0.1:${port}`;
  const service = await batchService(process.env.LOTGATE_DATA || fileURLToPath(new URL('../data/', import.meta.url)), xlayerRuntime);
  const server = operatorServer(service, { token, origin });
  server.listen(port, '127.0.0.1', () => console.log(`LotGate operator: ${origin}; X Layer RPC execution; settlement disabled`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(async () => { await service.close(); process.exit(0); }); });
}
