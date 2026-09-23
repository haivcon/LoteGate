import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { bits, integer } from '../src/logic.mjs';
export const parserHash = 'a794be064f8a0e1317f2de4ed909cc397f24a6836c048a881b124afffdf42084';
export async function loadParser() {
  if (!process.env.TAPEOUT_PARSER) throw new Error('Set TAPEOUT_PARSER to the reviewed parser snapshot');
  const bytes = await readFile(process.env.TAPEOUT_PARSER);
  if (createHash('sha256').update(bytes).digest('hex') !== parserHash) throw new Error('Parser checksum mismatch');
  return import(`data:text/javascript;base64,${bytes.toString('base64')}`);
}
export class NetMachine {
  constructor(source, compiled, parser) {
    this.c = source; this.gates = parser.decode(compiled.netlist, compiled.nIn);
    if (this.gates.some(g => g.op !== 0)) throw new Error('Only stateless NAND modules supported');
  }
  tick(input) {
    const c = this.c, v = new Uint8Array(2 + c.inputs.length + this.gates.length); v[1] = 1;
    let offset = 2;
    for (const [key, width] of Object.entries(c.ports)) { v.set(bits(input[key] ?? 0n, width), offset); offset += width; }
    for (const g of this.gates) v[g.out] = 1 ^ (v[g.a] & v[g.b]);
    offset = v.length - c.outputs.length;
    return Object.fromEntries(Object.entries(c.outputPorts).map(([key, width]) => { const n = integer(Array.from(v.slice(offset, offset + width))); offset += width; return [key, n]; }));
  }
}
