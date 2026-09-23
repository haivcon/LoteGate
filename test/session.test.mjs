import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
const orders = JSON.parse(await readFile(new URL('../examples/orders.json', import.meta.url)));

test('failed module calls permanently block session progress and settlement', () => {
  const s = new Session(orders, {}, { createController() { return { multiply() {}, refund() {}, tick() { throw new Error('Backend unavailable'); } }; } });
  assert.throws(() => s.step(), /Backend unavailable/);
  assert.equal(s.volume, 0n); assert.equal(s.trace.length, 0);
  assert.throws(() => s.step(), /Session failed/);
  assert.throws(() => s.result(), /failed session/);
});

test('session independently verified: example, one-sided, aggregate >uint32, fees and single seller', () => {
  for (const book of [orders, [], orders.filter(o => o.side === 'buy'), Array.from({ length: 4 }, (_, i) => ({ id: String(i), side: i < 2 ? 'buy' : 'sell', price: 0xffffffffn, quantity: 0xffffffffn }))]) {
    const s = new Session(book, { feeBps: 25 }); assert.throws(() => s.result()); const r = s.run(); assert.ok(verifyResult(book, r, { feeBps: 25 })); assert.throws(() => s.step());
  }
  const book = [orders[0], orders[2]]; assert.ok(verifyResult(book, new Session(book, { mode: 'single-seller' }).run(), { mode: 'single-seller' }));
  assert.throws(() => new Session(orders, { mode: 'single-seller' }));
  assert.throws(() => new Session(orders, { feeBps: 1001 }));
});
test('independent oracle rejects omissions, duplicates, early stop, altered allocation and trace', () => {
  const result = new Session(orders).run();
  for (const corrupt of [r => r.allocations.pop(), r => r.allocations[1] = r.allocations[0], r => r.volume--, r => r.trace.pop(), r => r.trace[0].buyId = 'fake', r => r.allocations[0].quoteRefund++, r => r.totalFees++]) {
    const r = structuredClone(result); corrupt(r); assert.throws(() => verifyResult(orders, r));
  }
});
test('50 randomized books verified by independent selection oracle', () => {
  let seed = 41; const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  for (let n = 0; n < 50; n++) {
    const book = Array.from({ length: 12 }, (_, i) => ({ id: String(i), side: i % 2 ? 'buy' : 'sell', price: next() % 40 + 1, quantity: next() % 10000 + 1 }));
    const options = { feeBps: n * 10 }; assert.ok(verifyResult(book, new Session(book, options).run(), options));
  }
});
