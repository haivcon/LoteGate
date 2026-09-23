import { readFile } from 'node:fs/promises';
import { compileModules, compiledEvaluator } from './modular.mjs';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
const orders = JSON.parse(await readFile(process.argv[2] ?? new URL('../examples/orders.json', import.meta.url), 'utf8'));
const result = new Session(orders, {}, { evaluate: compiledEvaluator(await compileModules()) }).run();
verifyResult(orders, result);
console.log(JSON.stringify({ backend: 'Local compiled TapeOut BLIF netlists; NOT on-chain', result }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
