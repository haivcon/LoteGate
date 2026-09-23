import test from 'node:test';
import assert from 'node:assert/strict';
import { compileModules, compiledEvaluator } from '../scripts/modular.mjs';
import { ModularController, sourceEvaluate } from '../src/modular.mjs';
import { Machine, bits } from '../src/logic.mjs';
import { controllerOracle } from './oracle.mjs';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
let seed = 271; const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

test('backend rejects missing, out-of-range and asynchronous outputs', () => {
  const p = { enable:1, buyValid:1, sellValid:1, buyPrice:2, sellPrice:1, buyQty:1, sellQty:1 };
  for (const evaluate of [() => ({}), () => ({valid:2n,crossing:1n}), () => Promise.resolve({valid:1n,crossing:1n})]) {
    const m = new ModularController(evaluate); assert.throws(() => m.tick(p)); assert.equal(m.volume,0n);
  }
});

const modules = await compileModules(), evaluate = compiledEvaluator(modules);
test('six BLIF modules: budgets, pure NAND, compiled arithmetic and source equivalence', () => {
  assert.equal(modules.length, 6);
  for (const m of modules) { assert.ok(m.blifBytes <= 34000); assert.ok(m.raw.length <= 30000); assert.equal(m.compiled.nLatch, 0); }
  for (let i = 0; i < 500; i++) {
    const a = BigInt(i < 2 ? i * 0xffffffff : next()), b = BigInt(i < 2 ? (1-i) * 0xffffffff : next()), cin = BigInt(i & 1);
    for (const name of ['price_check32', 'quantity_min32', 'sub32', 'add32_carry']) assert.deepEqual(evaluate(name, { a, b, cin }), sourceEvaluate(name, { a, b, cin }));
    assert.deepEqual(evaluate('sub32', { a, b }), { value: (a-b) & 0xffffffffn, borrow: BigInt(a < b) });
    assert.deepEqual(evaluate('add32_carry', { a, b, cin }), { value: (a+b+cin) & 0xffffffffn, carry: (a+b+cin) >> 32n });
    assert.deepEqual(evaluate('price_check32', { a, b }), { valid: BigInt(a !== 0n && b !== 0n), crossing: BigInt(a >= b) });
    assert.deepEqual(evaluate('quantity_min32', { a, b }), { valid: BigInt(a !== 0n && b !== 0n), value: a < b ? a : b });
    const x = a & 255n, y = b & 255n; assert.equal(evaluate('mul8x8', { a: x, b: y }).value, x*y);
    const deposit = (a << 32n) | b, payment = (b << 32n) | a;
    assert.deepEqual(evaluate('refund64', { deposit, payment }), { underflow: BigInt(deposit < payment), refund: deposit < payment ? 0n : deposit-payment });
  }
  const m = new ModularController(evaluate);
  for (const [a,b] of [[0n,0n],[1n,0xffffffffn],[0xffffffffn,0xffffffffn], ...Array.from({length: 40}, () => [BigInt(next()),BigInt(next())])]) assert.equal(m.multiply(a,b), a*b);
  assert.throws(() => m.refund(0n,1n));
});
test('modular controller matches arithmetic oracle ticks including arbitrary uint64 state and atomic failures', () => {
  const a = { state: [], tick(input) { return controllerOracle(this.state, input); } }, b = new ModularController(evaluate);
  for (let i = 0; i < 1000; i++) {
    const volume = (BigInt(next()) << 32n) | BigInt(next()), price = BigInt(next()), done = BigInt(i % 7 === 0), error = BigInt(i % 13 === 0);
    a.state = [...bits(volume,64), ...bits(price,32), Number(done), Number(error)]; Object.assign(b, { volume,price,done,error });
    const input = { reset: i % 17 === 0 ? 1 : 0, enable: i % 5 ? 1 : 0, buyValid: i % 11 ? 1 : 0, sellValid: i % 19 ? 1 : 0, buyPrice: next(), sellPrice: next(), buyQty: i % 23 ? next() : 0, sellQty: next() };
    assert.deepEqual(b.tick(input), a.tick(input));
  }
  const p = { enable:1,buyValid:1,sellValid:1,buyPrice:2,sellPrice:1,buyQty:1,sellQty:1 };
  a.state = [...bits(0xffffffffffffffffn,64),...bits(0,32),0,0]; Object.assign(b,{volume:0xffffffffffffffffn,price:0n,done:0n,error:0n});
  assert.deepEqual(b.tick(p),a.tick(p)); assert.equal(b.error,1n);
  const failing = new ModularController((name,input) => { if(name === 'sub32') throw new Error('Interrupted'); return evaluate(name,input); });
  assert.throws(() => failing.tick(p), /Interrupted/); assert.equal(failing.volume,0n); assert.equal(failing.done,0n);
});
test('compiled modules and default sessions match source sessions and independent oracle', () => {
  for (let n = 0; n < 15; n++) {
    const orders = Array.from({length: 8}, (_,i) => ({id:String(i),side:i%2?'buy':'sell',price:next()%40+1,quantity:n===0?0xffffffff:next()%1000+1}));
    const config = {feeBps:n*50};
    const old = new Session(orders,config).run();
    const result = new Session(orders,config,{evaluate}).run();
    assert.deepEqual(result,old); assert.deepEqual(new Session(orders,config).run(),old); assert.ok(verifyResult(orders,result,config));
  }
});
