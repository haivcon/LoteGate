import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
const order = (id, side, price, quantity = 1) => ({ id, side, price, quantity });
test('uniform price respects all filled limits for exhaustive two-by-two unit books', () => {
  for (let a = 1; a <= 4; a++) for (let b = 1; b <= 4; b++) for (let c = 1; c <= 4; c++) for (let d = 1; d <= 4; d++) {
    const orders = [order('a', 'buy', a), order('b', 'buy', b), order('c', 'sell', c), order('d', 'sell', d)];
    const result = new Session(orders).run(); assert.ok(verifyResult(orders, result));
    const buys = [a, b].sort((x, y) => y - x), sells = [c, d].sort((x, y) => x - y);
    const expected = buys[0] < sells[0] ? 0 : buys[1] < sells[1] ? 1 : 2;
    assert.equal(result.volume, BigInt(expected));
    result.allocations.forEach((allocation, i) => {
      if (allocation.filled) assert.ok(orders[i].side === 'buy' ? result.clearingPrice <= BigInt(orders[i].price) : result.clearingPrice >= BigInt(orders[i].price));
    });
  }
});
test('equal prices preserve intake priority; incompatible tail is excluded', () => {
  const orders = [order('first', 'buy', 50, 2), order('second', 'buy', 50, 2), order('seller', 'sell', 10, 3), order('tail', 'sell', 60, 1)];
  const result = new Session(orders, { feeBps: 100 }).run();
  assert.equal(result.clearingPrice, 10n); assert.equal(result.volume, 3n);
  assert.deepEqual(result.allocations.map(a => a.filled), [2n, 1n, 3n, 0n]);
  assert.ok(verifyResult(orders, result, { feeBps: 100 }));
});
