import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AsyncSerialRuntime } from '../src/async-session.mjs';
import { bits, integer } from '../src/logic.mjs';
const word = n => BigInt(n).toString(16).padStart(64, '0');
const dynamic = h => word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
function unpack(result, slot, expected) {
  assert.match(result, /^0x(?:[0-9a-fA-F]{2})*$/);
  const h = result.slice(2);
  const num = p => { assert.ok(p + 64 <= h.length); const n = Number(BigInt('0x' + h.slice(p, p + 64))); assert.ok(Number.isSafeInteger(n) && n >= 0); return n; };
  const offset = num(slot * 64); assert.equal(offset % 32, 0); assert.ok(offset >= 32);
  const length = num(offset * 2); if (expected !== undefined) assert.equal(length, expected);
  assert.ok(length <= 34000 && (offset + 32 + length) * 2 <= h.length);
  return h.slice((offset + 32) * 2, (offset + 32 + length) * 2).toLowerCase();
}
function pack(values) { const b = Buffer.alloc(Math.ceil(values.length / 8)); values.forEach((v, i) => { b[i >> 3] |= v << (i % 8); }); return b.toString('hex'); }
export async function xlayerRuntime() {
  const root = new URL('../', import.meta.url);
  const config = JSON.parse(await readFile(new URL('deployment/xlayer.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('circuits/serial/manifest.json', root), 'utf8'));
  assert.equal(config.chainId, 196); assert.match(config.cpu, /^0x[0-9a-fA-F]{40}$/);
  let id = 0, calls = 0;
  const startedAt = Date.now();
  async function rpc(method, params = []) {
    if (++calls > 100000) throw Error('RPC request bound exceeded');
    const r = await fetch(process.env.XLAYER_RPC || 'https://tapeout.net/rpc-xlayer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
    assert.ok(r.ok, `RPC HTTP ${r.status}`); const b = await r.json();
    assert.equal(b.jsonrpc, '2.0', 'Invalid RPC version'); assert.equal(b.id, id, 'RPC response ID mismatch');
    if (b.error) throw Error('RPC: ' + JSON.stringify(b.error)); assert.notEqual(b.result, undefined); return b.result;
  }
  assert.equal(await rpc('eth_chainId'), '0xc4'); const block = await rpc('eth_blockNumber');
  const call = data => rpc('eth_call', [{ to: config.cpu, data: '0x' + data }, block]);
  const states = {}, definitions = {};
  for (const name of config.deploymentOrder) {
    const m = manifest.modules.find(x => x.name === name), d = config.circuits[name]; assert.ok(m && d);
    const local = await readFile(new URL(`circuits/serial/${name}.bin`, root));
    assert.equal(createHash('sha256').update(local).digest('hex'), d.binarySha256);
    assert.equal(d.binarySha256, m.binarySha256);
    assert.equal(unpack(await call('3fc4be56' + word(d.circuitId)), 0, local.length), local.toString('hex'));
    const info = (await call('084d60f1' + word(d.circuitId))).slice(2);
    assert.equal(info.length, 256);
    assert.deepEqual([0, 1, 2].map(i => Number(BigInt('0x' + info.slice(i * 64, i * 64 + 64)))), [m.nIn, m.nOut, m.nLatch]);
    states[name] = '00'.repeat(Math.ceil(m.nLatch / 8)); definitions[name] = { ...m, id: d.circuitId };
  }
  let inFlight = false;
  const runtime = new AsyncSerialRuntime(async (name, input) => {
    if (inFlight) throw Error('Concurrent circuit calls forbidden'); inFlight = true;
    try {
      const m = definitions[name]; assert.ok(m);
      const inputHex = pack(Object.entries(m.inputs).flatMap(([key, width]) => bits(input[key] ?? 0n, width)));
      const state = dynamic(states[name]);
      const result = await call('e8281a1a' + word(m.id) + word(96) + word(96 + state.length / 2) + state + dynamic(inputHex));
      const next = unpack(result, 0, Math.ceil(m.nLatch / 8));
      const bytes = Buffer.from(unpack(result, 1, Math.ceil(m.nOut / 8)), 'hex');
      const values = Array.from({ length: m.nOut }, (_, i) => (bytes[i >> 3] >> (i % 8)) & 1);
      let offset = 0; const output = {};
      for (const [key, width] of Object.entries(m.outputs)) { output[key] = integer(values.slice(offset, offset + width)); offset += width; }
      states[name] = next; // Only CPU-returned state drives the next request.
      return output;
    } finally { inFlight = false; }
  });
  runtime.identity = { chainId: 196, cpu: config.cpu, block, circuits: config.circuits, execution: 'XLAYER_ETH_CALL', stateAuthority: 'SERVER_MANAGED', settlement: 'NOT_EXECUTED' };
  runtime.metrics = () => ({ rpcRequests: calls, elapsedMs: Date.now() - startedAt });
  return runtime;
}
