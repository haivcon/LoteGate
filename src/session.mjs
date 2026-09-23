import { uint32 } from './match.mjs';
import { ModularController } from './modular.mjs';

export function normalize(orders, options = {}) {
  const config = { mode: 'double', feeBps: 0, maxOrders: 64, ...options };
  if (!['double', 'single-seller'].includes(config.mode) || !Number.isInteger(config.feeBps) || config.feeBps < 0 || config.feeBps > 1000 || !Number.isInteger(config.maxOrders) || config.maxOrders < 1 || config.maxOrders > 256) throw new Error('Invalid configuration');
  if (!Array.isArray(orders) || orders.length > config.maxOrders) throw new Error('Order limit exceeded');
  const seen = new Set();
  const rows = orders.map((o, priority) => {
    if (!o || typeof o.id !== 'string' || !o.id.trim() || o.id.length > 80 || seen.has(o.id) || !['buy', 'sell'].includes(o.side)) throw new Error('Invalid or duplicate order');
    seen.add(o.id); const price = uint32(o.price), quantity = uint32(o.quantity);
    if (!price || !quantity) throw new Error('Positive price/quantity required');
    return { id: o.id, side: o.side, price, quantity, priority };
  });
  if (config.mode === 'single-seller' && rows.filter(r => r.side === 'sell').length !== 1) throw new Error('Exactly one seller required');
  return { rows, config };
}
export function sortedBook(rows) {
  return ['buy', 'sell'].map(side => rows.filter(r => r.side === side).sort((a, b) => a.price === b.price ? a.priority - b.priority : (a.price > b.price ? 1 : -1) * (side === 'buy' ? -1 : 1)));
}
export class Session {
  constructor(orders, options = {}, runtime = {}) {
    const { rows, config } = normalize(orders, options);
    this.orders = rows; this.config = Object.freeze(config); this.rows = rows.map(r => ({ ...r, remaining: r.quantity, filled: 0n }));
    [this.buys, this.sells] = sortedBook(this.rows); this.i = 0; this.j = 0; this.volume = 0n; this.clearingPrice = 0n; this.done = false; this.trace = []; this.failed = false; this.machine = runtime.createController ? runtime.createController() : new ModularController(runtime.evaluate);
    this.multiply = this.machine.multiply.bind(this.machine);
    this.refund = this.machine.refund.bind(this.machine);
  }
  step() {
    if (this.failed) throw new Error('Session failed; create a new session');
    if (this.done) throw new Error('Session already complete');
    const buy = this.buys[this.i], sell = this.sells[this.j];
    const input = { enable: 1, buyValid: buy ? 1 : 0, sellValid: sell ? 1 : 0, buyPrice: buy?.price ?? 0n, sellPrice: sell?.price ?? 0n, buyQty: buy?.remaining ?? 0n, sellQty: sell?.remaining ?? 0n };
    let out;
    try { out = this.machine.tick(input); if (out.error) throw new Error('Controller fault'); }
    catch (error) { this.failed = true; throw error; }
    this.volume = out.volume; this.clearingPrice = out.price; this.done = Boolean(out.done);
    if (out.matched) {
      buy.remaining = out.buyRemaining; sell.remaining = out.sellRemaining; buy.filled += out.fill; sell.filled += out.fill;
      this.trace.push({ buyId: buy.id, sellId: sell.id, fill: out.fill });
      if (out.advanceBuy) this.i++; if (out.advanceSell) this.j++;
    }
    return this.snapshot();
  }
  run() { while (!this.done) this.step(); return this.result(); }
  snapshot() { return { done: this.done, volume: this.volume, clearingPrice: this.clearingPrice, currentBuy: this.buys[this.i]?.id ?? null, currentSell: this.sells[this.j]?.id ?? null, rows: this.rows.map(r => ({ ...r })), trace: this.trace.map(r => ({ ...r })) }; }
  result() {
    if (this.failed || this.machine.error) throw new Error('Cannot settle a failed session');
    if (!this.done) throw new Error('Cannot settle before completion');
    let totalFees = 0n;
    const allocations = this.rows.map(r => {
      const gross = this.multiply(this.clearingPrice, r.filled), fee = r.side === 'sell' ? gross * BigInt(this.config.feeBps) / 10000n : 0n;
      totalFees += fee;
      return { id: r.id, side: r.side, filled: r.filled, unfilled: r.remaining, quotePaid: r.side === 'buy' ? gross : 0n, quoteReceived: r.side === 'sell' ? gross - fee : 0n, fee, quoteRefund: r.side === 'buy' ? this.refund(this.multiply(r.price, r.quantity), gross) : 0n, baseRefund: r.side === 'sell' ? r.remaining : 0n };
    });
    return { clearingPrice: this.clearingPrice, volume: this.volume, totalFees, allocations, trace: this.trace.map(r => ({ ...r })) };
  }
}
