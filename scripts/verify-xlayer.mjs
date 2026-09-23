// Read-only differential verification. States are supplied by the local reference;
// this does NOT prove authenticated/persistent state or settlement.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadParser, parserHash } from './parser.mjs';
import { StatefulNetMachine } from './stateful.mjs';
import { bits } from '../src/logic.mjs';
const root = new URL('../', import.meta.url);
const sha = b => createHash('sha256').update(b).digest('hex');
const word = n => BigInt(n).toString(16).padStart(64, '0');
const dynamic = h => word(h.length / 2) + h.padEnd(Math.ceil(h.length / 64) * 64, '0');
const pack = values => {
  const bytes = Buffer.alloc(Math.ceil(values.length / 8));
  values.forEach((v, i) => { assert.ok(v === 0 || v === 1); bytes[i >> 3] |= v << (i % 8); });
  return bytes.toString('hex');
};
function readBytes(result, slot) {
  assert.match(result, /^0x(?:[0-9a-fA-F]{2})*$/);
  const h = result.slice(2);
  const number = offset => {
    assert.ok(offset + 64 <= h.length);
    const n = Number(BigInt('0x' + h.slice(offset, offset + 64)));
    assert.ok(Number.isSafeInteger(n) && n >= 0); return n;
  };
  const offset = number(slot * 64);
  assert.equal(offset % 32, 0);
  const length = number(offset * 2), start = offset * 2 + 64;
  assert.ok(start + length * 2 <= h.length);
  return h.slice(start, start + length * 2).toLowerCase();
}
const report = { scope: 'eth_call differential vectors using locally supplied reference states; no transactions, no persistence proof', result: 'BLOCKED', modules: [], settlementEnabled: false };
let sequence = 0;
try {
  const config = JSON.parse(await readFile(new URL('deployment/xlayer.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('circuits/serial/manifest.json', root), 'utf8'));
  assert.equal(manifest.parserHash, parserHash);
  assert.equal(config.chainId, 196); assert.equal(config.settlementEnabled, false);
  assert.match(config.cpu, /^0x[0-9a-fA-F]{40}$/);
  const parser = await loadParser();
  async function rpc(method, params = []) {
    assert.ok(['eth_chainId', 'eth_blockNumber', 'eth_getCode', 'eth_call'].includes(method));
    const r = await fetch(process.env.XLAYER_RPC || 'https://tapeout.net/rpc-xlayer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }), signal: AbortSignal.timeout(30000)
    });
    assert.ok(r.ok, `RPC HTTP ${r.status}`); const b = await r.json();
    if (b.error) throw Error(JSON.stringify(b.error));
    assert.notEqual(b.result, undefined); return b.result;
  }
  assert.equal(await rpc('eth_chainId'), '0xc4');
  report.chainId = 196; report.cpu = config.cpu; report.block = await rpc('eth_blockNumber');
  const code = await rpc('eth_getCode', [config.cpu, report.block]); assert.notEqual(code, '0x');
  report.cpuRuntimeSha256 = sha(Buffer.from(code.slice(2), 'hex'));
  const call = data => rpc('eth_call', [{ to: config.cpu, data: '0x' + data }, report.block]);
  // Selectors inherited from the existing read-only CPU probe; source/ABI audit remains separate.
  for (const name of config.deploymentOrder) {
    const m = manifest.modules.find(x => x.name === name), d = config.circuits[name];
    assert.ok(m && d); const netlist = await readFile(new URL(`circuits/serial/${name}.bin`, root));
    assert.equal(sha(netlist), m.binarySha256); assert.equal(d.binarySha256, m.binarySha256);
    assert.equal(readBytes(await call('3fc4be56' + word(d.circuitId)), 0), netlist.toString('hex'));
    const info = (await call('084d60f1' + word(d.circuitId))).slice(2);
    assert.equal(info.length, 256);
    const dimensions = [0, 1, 2, 3].map(i => Number(BigInt('0x' + info.slice(i * 64, i * 64 + 64))));
    assert.deepEqual(dimensions, d.dimensions);
    const machine = new StatefulNetMachine({ ports: m.inputs, outputPorts: m.outputs, inputs: Array(m.nIn), outputs: Array(m.nOut) }, { netlist, nIn: m.nIn }, parser);
    assert.equal(machine.state.length, m.nLatch);
    const vectors = [];
    const tick = input => {
      const state = pack(machine.state), output = machine.tick(input);
      vectors.push({ state, input: pack(Object.entries(m.inputs).flatMap(([k, w]) => bits(input[k] ?? 0n, w))), next: pack(machine.state), output: pack(Object.entries(m.outputs).flatMap(([k, w]) => bits(output[k], w))) });
      return output;
    };
    if (name === 'refund64') {
      for (const [deposit, payment] of [[0n, 0n], [100n, 30n], [30n, 100n], [0xffffffffffffffffn, 1n], [0xffffffffffffffffn, 0xffffffffffffffffn]]) {
        const out = tick({ deposit, payment });
        assert.equal(out.refund, deposit >= payment ? deposit - payment : 0n);
        assert.equal(out.underflow, BigInt(deposit < payment));
      }
    } else if (name === 'multiply32_serial') {
      for (const [a, b] of [[0n, 1n], [123n, 456n], [0xffffffffn, 0xffffffffn]]) {
        tick({ reset: 1 }); tick({ start: 1, a, b });
        for (let i = 0; i < 32; i++) {
          if (i === 15) { const before = [...machine.state]; tick({}); assert.deepEqual(machine.state, before); }
          const out = tick({ enable: 1 });
          if (i === 31) { assert.equal(out.done, 1n); assert.equal(out.product, a * b); }
        }
        tick({});
      }
      tick({ start: 1, a: 12n, b: 9n }); tick({ enable: 1 }); tick({ reset: 1, enable: 1 });
      assert.ok(machine.state.every(x => x === 0));
    } else if (name === 'auction_controller_serial') {
      tick({ reset: 1 });
      const request = { buyValid: 1, sellValid: 1, buyPrice: 20n, sellPrice: 10n, buyQty: 9n, sellQty: 4n };
      for (const input of [request, { ...request, buyQty: 2n }, { buyValid: 0, sellValid: 0 }]) {
        tick({ ...input, start: 1, enable: 1 });
        for (let i = 0; i < 97; i++) {
          if (i === 40) { const before = [...machine.state]; tick({ start: 1, buyQty: 999n }); assert.deepEqual(machine.state, before); }
          tick({ enable: 1, start: 1, buyQty: 999n });
        }
        const out = tick({}); assert.equal(out.resultValid, 1n); assert.equal(out.busy, 0n);
      }
      const locked = [...machine.state]; tick({ ...request, start: 1, enable: 1 }); assert.deepEqual(machine.state, locked);
      tick({ reset: 1 }); tick({ ...request, start: 1, enable: 1 }); tick({ enable: 1 });
      tick({ reset: 1, start: 1, enable: 1 }); assert.ok(machine.state.every(x => x === 0));
    } else throw Error(`Unsupported module: ${name}`);
    const entry = { name, circuitId: d.circuitId, binarySha256: sha(netlist), plannedSteps: vectors.length, checkedSteps: 0, result: 'PENDING' };
    report.modules.push(entry);
    // Independent reference-state calls can be checked concurrently, four at a time.
    // This is differential replay, not a claim of stored on-chain session state.
    for (let base = 0; base < vectors.length; base += 4) {
      const results = await Promise.allSettled(vectors.slice(base, base + 4).map(async (v, index) => {
        const state = dynamic(v.state), input = dynamic(v.input);
        const result = await call('e8281a1a' + word(d.circuitId) + word(96) + word(96 + state.length / 2) + state + input);
        assert.equal(readBytes(result, 0), v.next, `${name} step ${base + index}: next state`);
        assert.equal(readBytes(result, 1), v.output, `${name} step ${base + index}: output`);
        entry.checkedSteps++;
      }));
      const failed = results.find(r => r.status === 'rejected');
      if (failed) { entry.result = 'FAILED'; throw failed.reason; }
    }
    entry.result = 'PASS'; console.log(`${name}: ${entry.checkedSteps} steps PASS`);
  }
  report.result = 'PASS';
} catch (error) { report.reason = error.message; process.exitCode = 1; }
report.rpcRequests = sequence;
await mkdir(new URL('reports/', root), { recursive: true });
await writeFile(new URL('reports/xlayer-execution.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
