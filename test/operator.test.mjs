import test from 'node:test';
import { request } from 'node:http';
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: key => res.headers[key] }, text: async () => body, json: async () => JSON.parse(body) }));
    });
    req.on('error', reject); req.end(options.body);
  });
}
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeBatch, AsyncSerialRuntime } from '../src/async-session.mjs';
import { ModularController } from '../src/modular.mjs';
import { Session } from '../src/session.mjs';
import { batchService } from '../scripts/batch-service.mjs';
import { operatorServer } from '../scripts/operator-server.mjs';
import { verifyReceipt } from '../scripts/verify-receipt.mjs';
const orders = [{ id: 'b', side: 'buy', price: '20', quantity: '5' }, { id: 's', side: 'sell', price: '10', quantity: '3' }];
const factory = async () => new ModularController();
test('async batch agrees with synchronous oracle and fails closed', async () => {
  assert.deepEqual(await executeBatch(orders, { feeBps: 100 }, await factory()), new Session(orders, { feeBps: 100 }).run());
  const r = new AsyncSerialRuntime(async () => { throw Error('offline'); });
  await assert.rejects(r.refund(1n, 0n), /offline/); await assert.rejects(r.refund(1n, 0n), /permanently failed/);
  await assert.rejects(executeBatch(orders, {}, { tick: async () => ({ error: 1n }) }), /fault/);
});
test('durable service locks writers, rejects stale revisions, computes and restores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lotgate-')); let service;
  try {
    service = await batchService(dir, factory); await assert.rejects(batchService(dir, factory), /EEXIST/);
    const input = { name: 'Batch', orders, requestId: 'create-batch-request-0001' };
    const r = await service.create(input);
    assert.equal((await service.create(input)).id, r.id);
    await assert.rejects(service.create({ ...input, name: 'Changed' }), /different input/);
    await assert.rejects(service.run(r.id, 99), /Stale/);
    await service.run(r.id, 0); await assert.rejects(service.run(r.id, 0), /Stale/);
    for (let i = 0; i < 200 && service.get(r.id).phase !== 'COMPLETED'; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(service.get(r.id).phase, 'COMPLETED');
    await service.close(); service = await batchService(dir, factory);
    assert.equal(service.get(r.id).result.volume, '3'); assert.equal(service.get(r.id).settlement, 'NOT_EXECUTED');
    const receipt = service.get(r.id); assert.equal(verifyReceipt(receipt).valid, true);
    receipt.result.volume = '4'; assert.throws(() => verifyReceipt(receipt), /hash mismatch/);
    const altered = service.get(r.id); altered.orders[0].price = '99'; assert.throws(() => verifyReceipt(altered), /commitment mismatch/);
  } finally { await service?.close(); await rm(dir, { recursive: true, force: true }); }
});
test('operator API requires auth and origin, serves UI and validates requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lotgate-http-')); const service = await batchService(dir, factory);
  const token = 'a'.repeat(40); const server = operatorServer(service, { token, origin: 'http://operator.test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Host: 'operator.test', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/api/batches', { headers: { Host: 'operator.test' } })).status, 401);
    assert.equal((await fetch(base + '/api/batches', { headers: { ...headers, Origin: 'http://evil.test' } })).status, 403);
    const page = await fetch(base, { headers }); assert.equal(page.status, 200); assert.match(await page.text(), /LotGate/); assert.ok(page.headers.get('content-security-policy'));
    const response = await fetch(base + '/api/batches', { method: 'POST', headers, body: JSON.stringify({ name: 'API', orders }) }); assert.equal(response.status, 201);
    assert.equal((await (await fetch(base + '/api/batches', { headers })).json()).length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); await service.close(); await rm(dir, { recursive: true, force: true }); }
});
