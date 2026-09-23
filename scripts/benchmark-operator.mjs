import { mkdir, writeFile, rename } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { xlayerRuntime } from './xlayer-runtime.mjs';
import { executeBatch } from '../src/async-session.mjs';
import { Session } from '../src/session.mjs';
import { json } from './batch-service.mjs';
const count = Number(process.argv[2] ?? 2);
assert.ok(Number.isInteger(count) && count >= 2 && count <= 64 && count % 2 === 0, 'Use an even order count from 2 to 64');
const orders = Array.from({ length: count }, (_, i) => ({ id: 'order-' + i, side: i % 2 ? 'sell' : 'buy', price: i % 2 ? '10' : '20', quantity: '3' }));
const directory = new URL('../reports/', import.meta.url); await mkdir(directory, { recursive: true });
const file = new URL(`operator-live-${count}.json`, directory), temp = new URL(`operator-live-${count}.tmp`, directory);
const report = { status: 'RUNNING', startedAt: new Date().toISOString(), orderCount: count, orders, feeBps: 100, settlement: 'NOT_EXECUTED' };
const save = async () => { await writeFile(temp, json(report)); await rename(temp, file); };
await save(); let runtime;
try {
  runtime = await xlayerRuntime(); report.identity = runtime.identity;
  report.result = await executeBatch(orders, { feeBps: 100 }, runtime, async progress => {
    report.progress = progress; report.metrics = runtime.metrics(); await save(); console.log(json({ progress, metrics: report.metrics }));
  });
  assert.deepEqual(report.result, new Session(orders, { feeBps: 100 }).run());
  report.status = 'PASS';
} catch (error) { report.status = 'FAILED'; report.error = error.message; process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); report.metrics = runtime?.metrics(); await save(); console.log(json(report)); }
