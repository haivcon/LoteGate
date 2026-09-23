import { createHash } from 'node:crypto';
import { Session, normalize } from './session.mjs';
import { verifyResult } from './verify.mjs';

// Server-side lifecycle boundary. Caller authentication and durable storage belong
// to the service/contract hosting this engine, not to this in-memory object.
const copy = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value,
  (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex');

export class BatchEngine {
  #id; #config; #runtime; #orders = []; #phase = 'OPEN'; #revision = 0;
  #session; #commitment = null; #receipt = null; #steps = 0;
  constructor({ id, config = {}, runtime } = {}) {
    if (typeof id !== 'string' || !id.trim() || id.length > 80) throw new Error('Invalid batch id');
    if (!runtime || typeof runtime.createController !== 'function') throw new Error('Explicit circuit runtime required');
    const allowed = ['mode', 'feeBps', 'maxOrders'];
    if (Object.keys(config).some(key => !allowed.includes(key))) throw new Error('Unknown configuration');
    // Validate configuration without requiring a seller before order intake.
    const mode = config.mode ?? 'double';
    if (!['double', 'single-seller'].includes(mode)) throw new Error('Invalid mode');
    const normalized = normalize([], { ...config, mode: 'double' }).config;
    this.#id = id; this.#config = Object.freeze({ ...normalized, mode });
    this.#runtime = { createController: runtime.createController.bind(runtime) };
  }
  #expect(revision, phases) {
    if (!Number.isSafeInteger(revision) || revision !== this.#revision) throw new Error('Stale or missing revision');
    if (!phases.includes(this.#phase)) throw new Error(`Invalid batch phase: ${this.#phase}`);
  }
  #failed(error) {
    this.#phase = 'FAILED'; this.#revision++;
    throw error;
  }
  snapshot() {
    return copy({ id: this.#id, config: this.#config, phase: this.#phase,
      revision: this.#revision, orders: this.#orders, commitment: this.#commitment,
      steps: this.#steps, progress: this.#session?.snapshot() ?? null });
  }
  submit(order, revision) {
    this.#expect(revision, ['OPEN']);
    const rows = normalize([...this.#orders, order], { ...this.#config, mode: 'double' }).rows;
    if (this.#config.mode === 'single-seller' && rows.filter(r => r.side === 'sell').length > 1) throw new Error('Only one seller allowed');
    this.#orders = rows; this.#revision++;
    return this.snapshot();
  }
  lock(revision) {
    this.#expect(revision, ['OPEN']);
    normalize(this.#orders, this.#config);
    try {
      this.#session = new Session(copy(this.#orders), this.#config, this.#runtime);
      this.#commitment = digest({ domain: 'LotGate/batch/v1', id: this.#id,
        config: this.#config, orders: this.#orders });
      this.#phase = 'LOCKED'; this.#revision++;
      return this.snapshot();
    } catch (error) { return this.#failed(error); }
  }
  advance(maxSteps, revision) {
    this.#expect(revision, ['LOCKED', 'EXECUTING']);
    if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > this.#config.maxOrders + 1) throw new Error('Invalid step budget');
    try {
      this.#phase = 'EXECUTING';
      for (let i = 0; i < maxSteps && !this.#session.done; i++) {
        if (this.#steps >= this.#orders.length + 1) throw new Error('Execution bound exceeded');
        this.#session.step(); this.#steps++;
      }
      if (this.#session.done) this.#phase = 'COMPLETED';
      this.#revision++;
      return this.snapshot();
    } catch (error) { return this.#failed(error); }
  }
  finalize(revision) {
    this.#expect(revision, ['COMPLETED']);
    try {
      const result = this.#session.result();
      verifyResult(this.#orders, result, this.#config);
      const payload = { domain: 'LotGate/result/v1', batchId: this.#id,
        commitment: this.#commitment, result };
      this.#receipt = { ...payload, resultHash: digest(payload),
        settlement: 'NOT_EXECUTED', verification: 'LOCAL_ORACLE' };
      this.#phase = 'FINALIZED'; this.#revision++;
      return this.receipt();
    } catch (error) { return this.#failed(error); }
  }
  cancel(revision) {
    this.#expect(revision, ['OPEN']);
    this.#phase = 'CANCELLED'; this.#revision++;
    return this.snapshot();
  }
  receipt() {
    if (this.#phase !== 'FINALIZED') throw new Error('Result not finalized');
    return copy(this.#receipt);
  }
}
