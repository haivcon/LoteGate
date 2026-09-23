import test from 'node:test';
import assert from 'node:assert/strict';
import { BatchEngine } from '../src/batch-engine.mjs';
import { serialRuntime } from '../scripts/serial-runtime.mjs';
import { verifyResult } from '../src/verify.mjs';
const runtime = await serialRuntime();
const orders = [
  { id: 'b1', side: 'buy', price: 12, quantity: 100 },
  { id: 'b2', side: 'buy', price: 10, quantity: 50 },
  { id: 's1', side: 'sell', price: 8, quantity: 80 },
  { id: 's2', side: 'sell', price: 10, quantity: 100 }
];
function engine(id = 'batch-1', config = {}, backend = runtime) {
  return new BatchEngine({ id, config, runtime: backend });
}
function load(e, rows = orders) {
  for (const o of rows) e.submit(o, e.snapshot().revision);
  e.lock(e.snapshot().revision);
}
function finish(e) {
  while (['LOCKED', 'EXECUTING'].includes(e.snapshot().phase)) e.advance(1, e.snapshot().revision);
  return e.finalize(e.snapshot().revision);
}
test('batch engine serial lifecycle produces verified, non-settled receipt once', () => {
  const e = engine('batch-1', { feeBps: 137 }); load(e);
  assert.equal(e.snapshot().phase, 'LOCKED');
  assert.throws(() => e.finalize(e.snapshot().revision), /phase/);
  const receipt = finish(e);
  assert.equal(receipt.result.volume, 150n);
  assert.equal(receipt.result.clearingPrice, 10n);
  assert.equal(receipt.settlement, 'NOT_EXECUTED');
  assert.ok(verifyResult(orders, receipt.result, { feeBps: 137 }));
  assert.equal(e.snapshot().phase, 'FINALIZED');
  assert.throws(() => e.finalize(e.snapshot().revision), /phase/);
  receipt.result.allocations[0].filled = 0n;
  assert.equal(e.receipt().result.allocations[0].filled, 100n);
});
test('batch revisions, immutable intake and locked book prevent local mutation/replay', () => {
  const config = { feeBps: 100 }, e = engine('immutable', config), order = { ...orders[0] };
  config.feeBps = 1000;
  e.submit(order, 0); order.price = 1;
  assert.throws(() => e.submit(orders[1], 0), /revision/);
  assert.throws(() => e.submit(orders[1]), /revision/);
  const view = e.snapshot(); view.orders[0].price = 1n; view.config.feeBps = 0;
  assert.equal(e.snapshot().orders[0].price, 12n);
  assert.equal(e.snapshot().config.feeBps, 100);
  assert.throws(() => e.submit(orders[0], 1), /duplicate/);
  assert.equal(e.snapshot().revision, 1);
  e.lock(1);
  assert.throws(() => e.submit(orders[1], 2), /phase/);
  assert.throws(() => e.cancel(2), /phase/);
  assert.throws(() => e.advance(0, 2), /budget/);
  assert.equal(e.snapshot().revision, 2);
});
test('commitments bind batch id, fee rules and admission order', () => {
  const commit = (id, config, rows) => { const e = engine(id, config); load(e, rows); return e.snapshot().commitment; };
  const hash = commit('same', {}, orders);
  assert.equal(hash, commit('same', {}, orders));
  assert.notEqual(hash, commit('other', {}, orders));
  assert.notEqual(hash, commit('same', { feeBps: 1 }, orders));
  assert.notEqual(hash, commit('same', {}, [...orders].reverse()));
});
test('empty, one-sided and single-seller batches have explicit lifecycle', () => {
  for (const rows of [[], [orders[0]], [orders[2]]]) {
    const e = engine(); load(e, rows); const receipt = finish(e);
    assert.equal(receipt.result.volume, 0n); assert.ok(verifyResult(rows, receipt.result));
  }
  const e = engine('single', { mode: 'single-seller' });
  assert.throws(() => e.lock(0), /seller/);
  assert.equal(e.snapshot().phase, 'OPEN');
  e.submit(orders[2], 0);
  assert.throws(() => e.submit(orders[3], 1), /seller/);
  e.submit(orders[0], 1); e.lock(2); assert.equal(finish(e).result.volume, 80n);
  const cancelled = engine(); cancelled.cancel(0);
  assert.throws(() => cancelled.lock(1), /phase/);
  assert.throws(() => cancelled.receipt(), /finalized/);
});
test('runtime fault permanently fails batch and cannot produce receipt', () => {
  const backend = { createController() { const m = runtime.createController(); m.tick = () => { throw new Error('transport'); }; return m; } };
  const e = engine('fault', {}, backend); load(e);
  assert.throws(() => e.advance(1, e.snapshot().revision), /transport/);
  assert.equal(e.snapshot().phase, 'FAILED');
  assert.throws(() => e.advance(1, e.snapshot().revision), /phase/);
  assert.throws(() => e.finalize(e.snapshot().revision), /phase/);
  assert.throws(() => e.receipt(), /finalized/);
});
test('oracle rejects corrupted payment arithmetic before finalization', () => {
  const backend = { createController() { const m = runtime.createController(); m.multiply = () => 0n; return m; } };
  const e = engine('bad-payment', {}, backend); load(e);
  e.advance(5, e.snapshot().revision);
  assert.throws(() => e.finalize(e.snapshot().revision), /allocation/);
  assert.equal(e.snapshot().phase, 'FAILED');
});
test('engine requires explicit backend and rejects invalid configuration', () => {
  assert.throws(() => new BatchEngine({ id: 'x' }), /runtime/);
  assert.throws(() => engine('', {}), /id/);
  assert.throws(() => engine('x', { feeBps: 1001 }), /configuration/);
  assert.throws(() => engine('x', { mode: 'unknown' }), /mode/);
  assert.throws(() => engine('x', { chainId: 196 }), /configuration/);
});
