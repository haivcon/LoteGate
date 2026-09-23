import { Logic, Machine, bits } from './logic.mjs';

export function priceCheck() {
  const c = new Logic('price_check32', { a: 32, b: 32 });
  c.output('valid', [c.and(c.nz(c.ins.a), c.nz(c.ins.b))]);
  c.output('crossing', [c.not(c.sub(c.ins.a, c.ins.b).borrow)]); return c;
}
export function quantityMin() {
  const c = new Logic('quantity_min32', { a: 32, b: 32 });
  c.output('valid', [c.and(c.nz(c.ins.a), c.nz(c.ins.b))]);
  c.output('value', c.choose(c.sub(c.ins.a, c.ins.b).borrow, c.ins.a, c.ins.b)); return c;
}
export function subtract32() {
  const c = new Logic('sub32', { a: 32, b: 32 }); const r = c.sub(c.ins.a, c.ins.b);
  c.output('value', r.value); c.output('borrow', [r.borrow]); return c;
}
export function add32() {
  const c = new Logic('add32_carry', { a: 32, b: 32, cin: 1 }); const r = c.add(c.ins.a, c.ins.b, c.ins.cin[0]);
  c.output('value', r.value); c.output('carry', [r.carry]); return c;
}
export function multiply8() {
  const c = new Logic('mul8x8', { a: 8, b: 8 }); let acc = c.constant(0, 16);
  for (let i = 0; i < 8; i++) {
    const row = [...c.constant(0, i), ...c.ins.a.map(a => c.and(a, c.ins.b[i])), ...c.constant(0, 8 - i)];
    acc = c.add(acc, row).value;
  }
  c.output('value', acc); return c;
}
export function refund64() {
  const c = new Logic('refund64', { deposit: 64, payment: 64 }); const r = c.sub(c.ins.deposit, c.ins.payment);
  c.output('underflow', [r.borrow]); c.output('refund', c.choose(r.borrow, c.constant(0, 64), r.value)); return c;
}
export const modularBuilders = [priceCheck, quantityMin, subtract32, add32, multiply8, refund64];
// Compact internal names and unary NOT reduce text size without changing ports.
export function modularBlif(c) {
  const name = n => n < 2 ? ['z', 'o'][n] : n < c.inputs.length + 2 ? c.inputs[n - 2] : `n${n.toString(36)}`;
  const lines = [`.model ${c.name}`, `.inputs ${c.inputs.join(' ')}`, `.outputs ${c.outputNames.join(' ')}`, '.names z', '.names o', '1'];
  for (const e of c.elements) {
    if (e.op !== 0) throw new Error('Modular circuits must be stateless');
    lines.push(e.a === e.b ? `.names ${name(e.a)} ${name(e.out)}\n0 1` : `.names ${name(e.a)} ${name(e.b)} ${name(e.out)}\n11 0`);
  }
  c.outputs.forEach((s, i) => lines.push(`.names ${name(s)} ${c.outputNames[i]}\n1 1`));
  return [...lines, '.end', ''].join('\n');
}
const circuits = modularBuilders.map(build => build());
export const sourceEvaluate = (name, input) => {
  const c = circuits.find(c => c.name === name); if (!c) throw new Error('Unknown module');
  return new Machine(c).tick(input);
};
const mask = 0xffffffffn;
export class ModularController {
  constructor(evaluate = sourceEvaluate) {
    this.evaluate = (name, input) => {
      const schema = circuits.find(c => c.name === name);
      if (!schema) throw new Error('Unknown module');
      for (const [key, width] of Object.entries(schema.ports)) bits(input[key], width);
      const output = evaluate(name, input);
      if (!output || typeof output.then === 'function') throw new TypeError('Synchronous module output required');
      for (const [key, width] of Object.entries(schema.outputPorts)) {
        if (typeof output[key] !== 'bigint') throw new TypeError(`Invalid output ${name}.${key}`);
        bits(output[key], width);
      }
      return output;
    };
    this.volume = 0n; this.price = 0n; this.done = 0n; this.error = 0n;
  }
  add64(a, b) {
    const low = this.evaluate('add32_carry', { a: a & mask, b: b & mask, cin: 0 });
    const high = this.evaluate('add32_carry', { a: a >> 32n, b: b >> 32n, cin: low.carry });
    return { value: low.value | high.value << 32n, carry: high.carry };
  }
  tick(input) {
    const ports = { reset: 1, enable: 1, buyValid: 1, sellValid: 1, buyPrice: 32, sellPrice: 32, buyQty: 32, sellQty: 32 };
    const p = Object.fromEntries(Object.entries(ports).map(([k, w]) => { const v = input[k] ?? 0n; bits(v, w); return [k, BigInt(v)]; }));
    const prices = this.evaluate('price_check32', { a: p.buyPrice, b: p.sellPrice });
    const qty = this.evaluate('quantity_min32', { a: p.buyQty, b: p.sellQty });
    const active = p.enable && !this.done && !p.reset, valid = p.buyValid && p.sellValid;
    const malformed = valid && !(prices.valid && qty.valid);
    const matched = BigInt(Boolean(active && valid && prices.valid && qty.valid && prices.crossing));
    const fill = matched ? qty.value : 0n, total = this.add64(this.volume, fill);
    const overflow = matched && total.carry;
    const buyRemaining = this.evaluate('sub32', { a: p.buyQty, b: fill }).value;
    const sellRemaining = this.evaluate('sub32', { a: p.sellQty, b: fill }).value;
    const out = { volume: p.reset ? 0n : total.value, price: p.reset ? 0n : matched ? p.sellPrice : this.price,
      done: p.reset ? 0n : BigInt(Boolean(this.done || active && (!(valid && prices.crossing) || malformed || overflow))),
      error: p.reset ? 0n : BigInt(Boolean(this.error || active && (malformed || overflow))),
      matched, fill, buyRemaining, sellRemaining, advanceBuy: BigInt(Boolean(matched && fill === p.buyQty)), advanceSell: BigInt(Boolean(matched && fill === p.sellQty)) };
    // Commit only after every module call succeeds. Faulted results cannot settle.
    Object.assign(this, { volume: out.volume, price: out.price, done: out.done, error: out.error }); return out;
  }
  multiply(a, b) {
    bits(a, 32); bits(b, 32); a = BigInt(a); b = BigInt(b); let result = 0n;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const product = this.evaluate('mul8x8', { a: (a >> BigInt(8 * i)) & 255n, b: (b >> BigInt(8 * j)) & 255n }).value;
      const sum = this.add64(result, product << BigInt(8 * (i + j)));
      if (sum.carry) throw new Error('Product overflow'); result = sum.value;
    }
    return result;
  }
  refund(deposit, payment) {
    const out = this.evaluate('refund64', { deposit, payment });
    if (out.underflow) throw new Error('Insufficient deposit'); return out.refund;
  }
}
