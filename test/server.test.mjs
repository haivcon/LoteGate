import test from 'node:test';
import assert from 'node:assert/strict';
import { makeServer } from '../scripts/serve.mjs';
import { get } from 'node:http';
test('local server allowlist, CSP, missing files and host restriction', async () => {
  const server = makeServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.mjs', '/style.css', '/src/session.mjs', '/src/verify.mjs', '/src/modular.mjs', '/src/logic.mjs', '/src/match.mjs', '/orders.json']) {
      const r = await fetch(base + path); assert.equal(r.status, 200); assert.ok(r.headers.get('content-security-policy')); assert.ok((await r.text()).length);
    }
    for (const path of ['/package.json', '/.env', '/src/../contracts/AuctionSandbox.sol', '/missing']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 404);
    const status = await new Promise((resolve, reject) => { get(base, { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject); });
    assert.equal(status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
