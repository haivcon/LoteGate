import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { normalize } from '../src/session.mjs';
import { executeBatch } from '../src/async-session.mjs';
export const json = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export async function batchService(directory, createRuntime) {
  directory = resolve(directory); await mkdir(directory, { recursive: true });
  // Single writer only. Stale lock requires operator review after an unclean shutdown.
  const lock = await open(join(directory, 'service.lock'), 'wx');
  await lock.writeFile(String(process.pid)); await lock.sync();
  const records = new Map(); let closed = false, active = null, pumping = false, fatal = null;
  const save = async record => {
    const file = join(directory, record.id + '.json'), temp = file + '.tmp';
    const handle = await open(temp, 'w', 0o600);
    try { await handle.writeFile(json(record)); await handle.sync(); } finally { await handle.close(); }
    await rename(temp, file); records.set(record.id, record);
  };
  try {
    for (const file of await readdir(directory)) if (/^[a-f0-9-]{36}\.json$/.test(file)) {
      const record = JSON.parse(await readFile(join(directory, file), 'utf8'));
      if (file !== record.id + '.json') throw Error('Invalid stored identity');
      if (record.phase === 'RUNNING') { record.phase = 'INTERRUPTED'; record.error = 'Server stopped during execution; explicitly retry from immutable input.'; record.revision++; await save(record); }
      else records.set(record.id, record);
    }
  } catch (error) { await lock.close(); await unlink(join(directory, 'service.lock')); throw error; }
  let serial = Promise.resolve();
  const transaction = action => { const next = serial.then(action); serial = next.catch(() => {}); return next; };
  async function pump() {
    if (pumping || closed || fatal) return;
    pumping = true;
    try {
      for (;;) {
        const r = await transaction(async () => {
          if (closed) return null;
          const next = [...records.values()].find(x => x.phase === 'QUEUED');
          if (!next) return null;
          const r = structuredClone(next); r.phase = 'RUNNING'; r.revision++; r.error = null; r.startedAt = new Date().toISOString();
          await save(r); return r;
        });
        if (!r) break;
        try {
          const runtime = await createRuntime();
          r.execution = runtime.identity;
          const result = await executeBatch(r.orders, r.config, runtime, async progress => {
            r.progress = progress; await save(structuredClone(r));
          });
          r.result = result; r.execution = runtime.identity; r.phase = 'COMPLETED';
          r.resultHash = createHash('sha256').update(json({ commitment: r.commitment, execution: r.execution, result })).digest('hex');
        } catch (error) { r.phase = 'FAILED'; r.error = error.message; delete r.result; }
        r.finishedAt = new Date().toISOString(); r.revision++; await save(r);
      }
    } catch (error) { fatal = error.message; console.error('Batch service stopped:', fatal); }
    finally { pumping = false; }
  }
  const kick = () => { if (!pumping && !closed && !fatal) active = pump(); };
  kick();
  return {
    health: () => ({ available: !closed && !fatal, error: fatal }),
    list: () => [...records.values()].map(r => ({ id: r.id, name: r.name, phase: r.phase, revision: r.revision, createdAt: r.createdAt, orderCount: r.orders.length })),
    get: id => { const r = records.get(id); if (!r) throw Error('Batch not found'); return structuredClone(r); },
    create: body => transaction(async () => {
      if (closed || fatal) throw Error('Service unavailable');
      if (body.requestId !== undefined && (typeof body.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.requestId))) throw Error('Invalid requestId');
      const requestHash = createHash('sha256').update(json({ name: body.name, orders: body.orders, mode: body.mode ?? 'double', feeBps: body.feeBps ?? 0 })).digest('hex');
      if (body.requestId) {
        const existing = [...records.values()].find(r => r.requestId === body.requestId);
        if (existing) {
          if (existing.requestHash !== requestHash) throw Error('requestId already used for different input');
          return structuredClone(existing);
        }
      }
      if (records.size >= 10000) throw Error('Storage record limit reached');
      if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw Error('Invalid batch name');
      const { rows, config } = normalize(body.orders, { mode: body.mode ?? 'double', feeBps: body.feeBps ?? 0, maxOrders: 64 });
      const r = { id: randomUUID(), name: body.name.trim(), orders: rows, config, phase: 'READY', revision: 0, createdAt: new Date().toISOString(), settlement: 'NOT_EXECUTED' };
      if (body.requestId) { r.requestId = body.requestId; r.requestHash = requestHash; }
      r.commitment = createHash('sha256').update(json({ domain: 'LotGate/web-batch/v1', id: r.id, orders: rows, config })).digest('hex');
      await save(r); return structuredClone(r);
    }),
    run: (id, revision) => transaction(async () => {
      if (closed || fatal) throw Error('Service unavailable');
      const r = structuredClone(records.get(id));
      if (!r) throw Error('Batch not found');
      if (r.revision !== revision) throw Error('Stale revision');
      if (!['READY', 'FAILED', 'INTERRUPTED'].includes(r.phase)) throw Error('Batch cannot run in current phase');
      r.phase = 'QUEUED'; r.revision++; r.progress = null; r.result = undefined; r.error = null;
      await save(r); queueMicrotask(kick); return structuredClone(r);
    }),
    close: async () => { closed = true; await serial; await active; await lock.close(); await unlink(join(directory, 'service.lock')); }
  };
}
