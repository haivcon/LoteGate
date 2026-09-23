import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
import { runAuction, json } from '../src/auction.mjs';
const rows = [];
for (const count of [8, 16, 32, 64]) {
  const book = Array.from({ length: count }, (_, i) => ({ id: String(i), side: i < count / 2 ? 'buy' : 'sell', price: i < count / 2 ? 20 : 10, quantity: 1000 }));
  for (const mode of ['arithmetic', 'NAND-source']) {
    const samples = []; let result;
    for (let i = 0; i < 6; i++) { const start = performance.now(); result = mode === 'arithmetic' ? runAuction(book) : new Session(book).run(); const elapsed = performance.now() - start; if (i) samples.push(elapsed); }
    if (mode === 'NAND-source') verifyResult(book, result);
    rows.push({ orders: count, mode, medianMs: samples.sort((a,b) => a-b)[2], volume: result.volume, matches: result.trace.length });
  }
}
const report = { scope: 'Local JS wall time, not gas; five measured samples after warm-up; NAND includes serial settlement simulation', node: process.version, cpu: cpus()[0]?.model, rows };
await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
await writeFile(new URL('../reports/local.json', import.meta.url), json(report) + '\n'); console.log(json(report));
