// Small NAND/latch construction toolkit. Bit arrays are unsigned LSB-first.
export class Logic {
  constructor(name, ports, registers = {}) {
    this.name = name; this.ports = ports; this.registers = registers;
    this.inputs = Object.entries(ports).flatMap(([key, width]) => Array.from({ length: width }, (_, i) => `${key}_${i}`));
    this.elements = []; this.cache = new Map(); this.ins = {}; this.reg = {}; this.outputs = []; this.outputNames = []; this.outputPorts = {};
    let offset = 2;
    for (const [key, width] of Object.entries(ports)) { this.ins[key] = Array.from({ length: width }, (_, i) => offset + i); offset += width; }
    for (const [key, width] of Object.entries(registers)) this.reg[key] = Array.from({ length: width }, () => {
      const out = 2 + this.inputs.length + this.elements.length; this.elements.push({ op: 1, d: 0, out }); return out;
    });
  }
  nand(a, b) {
    if (a === 0 || b === 0) return 1;
    if (a === 1 && b === 1) return 0;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const out = 2 + this.inputs.length + this.elements.length;
    this.elements.push({ op: 0, a, b, out }); this.cache.set(key, out); return out;
  }
  not(a) { return this.nand(a, a); }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  xor(a, b) { const t = this.nand(a, b); return this.nand(this.nand(a, t), this.nand(b, t)); }
  mux(s, a, b) { return a === b ? a : this.nand(this.nand(s, a), this.nand(this.not(s), b)); }
  choose(s, a, b) { return a.map((bit, i) => this.mux(s, bit, b[i])); }
  constant(n, width) { return Array.from({ length: width }, (_, i) => Number((BigInt(n) >> BigInt(i)) & 1n)); }
  nz(a) { return a.reduce((s, b) => this.or(s, b), 0); }
  add(a, b, carry = 0) {
    const value = a.map((bit, i) => { const x = this.xor(bit, b[i]); const result = this.xor(x, carry); carry = this.or(this.and(bit, b[i]), this.and(x, carry)); return result; });
    return { value, carry };
  }
  sub(a, b) { const result = this.add(a, b.map(bit => this.not(bit)), 1); return { value: result.value, borrow: this.not(result.carry) }; }
  eq(a, b) { return this.not(this.nz(a.map((bit, i) => this.xor(bit, b[i])))); }
  drive(key, bits) { this.reg[key].forEach((signal, i) => { this.elements[signal - 2 - this.inputs.length].d = bits[i]; }); }
  output(key, bits) { this.outputPorts[key] = bits.length; this.outputs.push(...bits); this.outputNames.push(...bits.map((_, i) => `${key}_${i}`)); }
  blif() {
    const name = s => s === 0 ? 'zero' : s === 1 ? 'one' : s < 2 + this.inputs.length ? this.inputs[s - 2] : `s${s}`;
    const lines = [`.model ${this.name}`, `.inputs ${this.inputs.join(' ')}`, `.outputs ${this.outputNames.join(' ')}`, '.names zero', '.names one', '1'];
    for (const e of this.elements) if (e.op === 1) lines.push(`.latch ${name(e.d)} ${name(e.out)} 0`); else lines.push(`.names ${name(e.a)} ${name(e.b)} ${name(e.out)}`, '11 0');
    this.outputs.forEach((s, i) => lines.push(`.names ${name(s)} ${this.outputNames[i]}`, '1 1'));
    return [...lines, '.end', ''].join('\n');
  }
}
export function bits(n, width) {
  if (typeof n !== 'bigint' && !(typeof n === 'number' && Number.isSafeInteger(n))) throw new TypeError('Integer required');
  n = BigInt(n); if (n < 0n || n >= (1n << BigInt(width))) throw new RangeError('Port overflow');
  return Array.from({ length: width }, (_, i) => Number((n >> BigInt(i)) & 1n));
}
export const integer = bits => bits.reduce((n, bit, i) => n | BigInt(bit) << BigInt(i), 0n);
export class Machine {
  constructor(circuit) { this.c = circuit; this.state = circuit.elements.filter(e => e.op === 1).map(() => 0); }
  tick(input) {
    const c = this.c, v = new Uint8Array(2 + c.inputs.length + c.elements.length); v[1] = 1;
    let offset = 2;
    for (const [key, width] of Object.entries(c.ports)) { v.set(bits(input[key] ?? 0n, width), offset); offset += width; }
    let index = 0;
    for (const e of c.elements) if (e.op === 1) v[e.out] = this.state[index++];
    for (const e of c.elements) if (e.op === 0) v[e.out] = 1 ^ (v[e.a] & v[e.b]);
    this.state = c.elements.filter(e => e.op === 1).map(e => v[e.d]);
    offset = 0;
    return Object.fromEntries(Object.entries(c.outputPorts).map(([key, width]) => { const result = integer(c.outputs.slice(offset, offset + width).map(s => v[s])); offset += width; return [key, result]; }));
  }
}
