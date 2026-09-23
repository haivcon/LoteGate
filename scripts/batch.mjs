import { readFile } from 'node:fs/promises';
import { BatchEngine } from '../src/batch-engine.mjs';
import { serialRuntime } from './serial-runtime.mjs';

// Explicit input file, no wallet, transactions or hidden backend fallback.
const path = process.argv[2];
if (!path) throw new Error('Usage: npm run batch -- <absolute-path-to-batch.json>');
const input = JSON.parse(await readFile(path, 'utf8'));
if (!Array.isArray(input.orders)) throw new Error('orders must be an array');
const engine = new BatchEngine({ id: input.id, config: input.config, runtime: await serialRuntime() });
for (const order of input.orders) engine.submit(order, engine.snapshot().revision);
engine.lock(engine.snapshot().revision);
while (['LOCKED', 'EXECUTING'].includes(engine.snapshot().phase)) {
  engine.advance(1, engine.snapshot().revision);
}
const receipt = engine.finalize(engine.snapshot().revision);
console.log(JSON.stringify(receipt, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
