import { readFile } from 'node:fs/promises';

import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
const orders = JSON.parse(await readFile(process.argv[2] ?? new URL('../examples/orders.json', import.meta.url), 'utf8'));
const result = new Session(orders).run();
verifyResult(orders, result);
console.log(JSON.stringify({ backend: 'Local modular NAND source; NOT on-chain', result }, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
