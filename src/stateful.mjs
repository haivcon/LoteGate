import { Machine } from './logic.mjs';
import { CompactLogic as Logic } from './compact-logic.mjs';

// Handshake controller. The trusted feeder retains the current head until exhausted.
// Each tick consumes at most one pair. reset wins over enable. Totals are 64-bit.
export function buildController() {
  const c = new Logic('auction_controller', { reset: 1, enable: 1, buyValid: 1, sellValid: 1, buyPrice: 32, sellPrice: 32, buyQty: 32, sellQty: 32 }, { volume: 64, price: 32, done: 1, error: 1 });
  const p = c.ins, r = c.reg, reset = p.reset[0];
  const active = c.and(c.and(p.enable[0], c.not(r.done[0])), c.not(reset));
  const valid = c.and(p.buyValid[0], p.sellValid[0]);
  const positive = [p.buyPrice, p.sellPrice, p.buyQty, p.sellQty].map(x => c.nz(x)).reduce((a, b) => c.and(a, b), 1);
  const crossing = c.not(c.sub(p.buyPrice, p.sellPrice).borrow);
  const malformed = c.and(valid, c.not(positive));
  const match = c.and(active, c.and(valid, c.and(positive, crossing)));
  const difference = c.sub(p.buyQty, p.sellQty);
  const less = difference.borrow;
  const small = c.choose(less, p.buyQty, p.sellQty);
  const fill = small.map(b => c.and(match, b));
  const total = c.add(r.volume, [...fill, ...c.constant(0, 32)]);
  const overflow = c.and(match, total.carry);
  const fault = c.or(r.error[0], c.and(active, c.or(malformed, overflow)));
  const stop = c.or(r.done[0], c.and(active, c.or(c.not(c.and(valid, crossing)), c.or(malformed, overflow))));
  const next = { volume: c.choose(reset, c.constant(0, 64), total.value), price: c.choose(reset, c.constant(0, 32), c.choose(match, p.sellPrice, r.price)), done: [c.and(c.not(reset), stop)], error: [c.and(c.not(reset), fault)] };
  for (const [key, value] of Object.entries(next)) { c.drive(key, value); c.output(key, value); }
  c.output('matched', [match]); c.output('fill', fill);
  const equal = c.eq(p.buyQty,p.sellQty);
  c.output('buyRemaining', c.choose(match, difference.value.map(x=>c.and(c.not(less),x)), p.buyQty));
  const reverse = c.sub(p.sellQty,p.buyQty).value;
  c.output('sellRemaining', c.choose(match, reverse.map(x=>c.and(less,x)), p.sellQty));
  c.output('advanceBuy', [c.and(match,c.or(less,equal))]); c.output('advanceSell', [c.and(match,c.not(less))]);
  return c;
}

// Serial shift/add uint32 multiplier: start, then exactly 32 enabled ticks.
export function buildMultiplier() {
  // Combined product register: add a to the high half when low bit is set,
  // then shift right. 32-bit adder instead of 64-bit x/acc datapaths.
  const c = new Logic('multiply32_serial', { reset:1, start:1, enable:1, a:32, b:32 }, { a:32, product:64, count:6, busy:1, done:1 });
  const p=c.ins,r=c.reg, start=c.and(p.start[0],c.not(r.busy[0])), work=c.and(r.busy[0],p.enable[0]);
  const end=c.and(work,c.eq(r.count,c.constant(31,6)));
  const sum=c.add(r.product.slice(32),r.a.map(x=>c.and(x,r.product[0])));
  const shifted=[...r.product.slice(1,32),...sum.value,sum.carry];
  const values={
    a:c.choose(start,p.a,r.a),
    product:c.choose(start,[...p.b,...c.constant(0,32)],c.choose(work,shifted,r.product)),
    count:c.choose(start,c.constant(0,6),c.choose(work,c.add(r.count,c.constant(1,6)).value,r.count)),
    busy:[c.or(start,c.and(r.busy[0],c.not(end)))],
    done:[c.and(c.not(start),c.or(r.done[0],end))]
  };
  for(const [key,value] of Object.entries(values)) {
    const next=c.choose(p.reset[0],c.constant(0,value.length),value); c.drive(key,next);
    if(['product','busy','done'].includes(key)) c.output(key,next);
  }
  return c;
}
export function buildRefund() {
  const c = new Logic('refund64', { deposit: 64, payment: 64 });
  const r = c.sub(c.ins.deposit, c.ins.payment);
  c.output('underflow', [r.borrow]); c.output('refund', c.choose(r.borrow, c.constant(0, 64), r.value)); return c;
}
const multiplier = buildMultiplier(), refund = buildRefund();
export function multiply(a, b) {
  const m = new Machine(multiplier); m.tick({ start: 1, a, b });
  let result;
  for (let i = 0; i < 32; i++) result = m.tick({ enable: 1 });
  if (result.done !== 1n) throw new Error('Multiplier not done'); return result.product;
}
export function subtractRefund(deposit, payment) {
  const out = new Machine(refund).tick({ deposit, payment });
  if (out.underflow) throw new Error('Insufficient deposit'); return out.refund;
}
