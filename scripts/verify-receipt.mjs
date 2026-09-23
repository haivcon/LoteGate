import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { verifyResult } from '../src/verify.mjs';
import { json } from './batch-service.mjs';
const hash = value => createHash('sha256').update(json(value)).digest('hex');
export function verifyReceipt(receipt) {
  assert.equal(receipt.phase, 'COMPLETED', 'Receipt is not completed');
  assert.equal(receipt.settlement, 'NOT_EXECUTED');
  assert.equal(receipt.commitment, hash({ domain: 'LotGate/web-batch/v1', id: receipt.id, orders: receipt.orders, config: receipt.config }), 'Input commitment mismatch');
  assert.equal(receipt.resultHash, hash({ commitment: receipt.commitment, execution: receipt.execution, result: receipt.result }), 'Result hash mismatch');
  const numeric = (object, keys) => Object.fromEntries(Object.entries(object).map(([key, value]) => {
    if (!keys.includes(key)) return [key, value];
    assert.match(String(value), /^(0|[1-9][0-9]*)$/, 'Invalid integer'); return [key, BigInt(value)];
  }));
  const result = numeric(receipt.result, ['clearingPrice', 'volume', 'totalFees']);
  result.allocations = result.allocations.map(a => numeric(a, ['filled', 'unfilled', 'quotePaid', 'quoteReceived', 'fee', 'quoteRefund', 'baseRefund']));
  result.trace = result.trace.map(t => numeric(t, ['fill']));
  verifyResult(receipt.orders, result, receipt.config);
  return { valid: true, scope: 'Input/result hash consistency and independent arithmetic; not a signature, proof of complete intake, RPC execution, or asset settlement' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.ok(process.argv[2], 'Provide an exported receipt JSON path');
    console.log(json(verifyReceipt(JSON.parse(await readFile(process.argv[2], 'utf8')))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
