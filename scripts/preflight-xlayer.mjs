// Read-only preparation: never signs, sends transactions, or imports wallet keys.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { scope: 'Artifact integrity and RPC identity only; NOT deployment readiness or source verification', result: 'BLOCKED', artifacts: [], settlementEnabled: false };
try {
  const config = JSON.parse(await readFile(new URL('deployment/xlayer.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('circuits/serial/manifest.json', root), 'utf8'));
  assert.equal(config.chainId, 196);
  assert.equal(config.settlementEnabled, false);
  assert.equal(manifest.strictByteLimit, 34000);
  report.factory = config.factory;
  report.cpu = config.cpu;
  report.provenance = config.provenance;
  for (const name of config.deploymentOrder) {
    assert.match(name, /^[a-zA-Z0-9_]+$/);
    const module = manifest.modules.find(item => item.name === name);
    assert.ok(module, `Missing manifest module: ${name}`);
    assert.equal(module.nRef, 0, `${name}: REF forbidden`);
    const item = { name, nIn: module.nIn, nOut: module.nOut, nLatch: module.nLatch };
    for (const [ext, key] of [['blif', 'blif'], ['bin', 'binary']]) {
      const bytes = await readFile(new URL(`circuits/serial/${name}.${ext}`, root));
      assert.ok(bytes.length < 34000, `${name}.${ext}: exceeds strict budget`);
      assert.equal(bytes.length, module[`${key}Bytes`], `${name}.${ext}: size mismatch`);
      assert.equal(hash(bytes), module[`${key}Sha256`], `${name}.${ext}: hash mismatch`);
      item[`${key}Bytes`] = bytes.length;
      item[`${key}Sha256`] = hash(bytes);
    }
    report.artifacts.push(item);
  }
  const endpoint = process.env.XLAYER_RPC || config.rpc;
  let id = 0;
  async function rpc(method, params = []) {
    assert.ok(['eth_chainId', 'eth_blockNumber', 'eth_getCode'].includes(method));
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok, `RPC HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(JSON.stringify(body.error));
    assert.notEqual(body.result, undefined, 'Missing RPC result');
    return body.result;
  }
  report.chainId = Number(BigInt(await rpc('eth_chainId')));
  assert.equal(report.chainId, config.chainId, 'Wrong chain');
  report.block = await rpc('eth_blockNumber');
  assert.match(config.factory, /^0x[0-9a-fA-F]{40}$/);
  const code = await rpc('eth_getCode', [config.factory, report.block]);
  assert.match(code, /^0x(?:[0-9a-fA-F]{2})+$/, 'Factory has no valid bytecode');
  report.factoryRuntimeSha256 = hash(Buffer.from(code.slice(2), 'hex'));
  report.factoryRuntimeBytes = (code.length - 2) / 2;
  report.result = 'READ_ONLY_CHECKS_PASS';
  report.deploymentReady = false;
  report.blockers = ['Verify factory implementation/source and ABI against deployed code (including proxy targets)', 'Create/select a LotGate CPU and verify factory registration', 'Check live fees, supply, wallet balances and gas estimates', 'Validate NAND/LATCH semantics on the target CPU', 'Explicit wallet confirmation required before any paid transaction'];
} catch (error) {
  report.reason = error.message;
  report.deploymentReady = false;
  process.exitCode = 1;
}
await mkdir(new URL('reports/', root), { recursive: true });
await writeFile(new URL('reports/xlayer-preflight.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
