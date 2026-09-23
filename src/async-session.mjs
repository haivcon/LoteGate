import { normalize, sortedBook } from './session.mjs';
import { verifyResult } from './verify.mjs';

// Sequential, bounded execution; no synchronous Session API is changed.
export async function executeBatch(orders, options, machine, progress = async () => {}) {
  const { rows: ordersNormalized, config } = normalize(orders, options);
  const rows = ordersNormalized.map(r => ({ ...r, remaining: r.quantity, filled: 0n }));
  const [buys, sells] = sortedBook(rows);
  let i = 0, j = 0, volume = 0n, clearingPrice = 0n, done = false;
  const trace = [];
  for (let step = 0; !done; step++) {
    if (step > rows.length) throw Error('Execution bound exceeded');
    const buy = buys[i], sell = sells[j];
    const out = await machine.tick({ enable: 1, buyValid: buy ? 1 : 0, sellValid: sell ? 1 : 0, buyPrice: buy?.price ?? 0n, sellPrice: sell?.price ?? 0n, buyQty: buy?.remaining ?? 0n, sellQty: sell?.remaining ?? 0n });
    if (out.error) throw Error('Controller fault');
    volume = out.volume; clearingPrice = out.price; done = Boolean(out.done);
    if (out.matched) {
      if (!buy || !sell || out.fill <= 0n || out.fill > buy.remaining || out.fill > sell.remaining) throw Error('Invalid fill');
      buy.remaining = out.buyRemaining; sell.remaining = out.sellRemaining;
      buy.filled += out.fill; sell.filled += out.fill;
      trace.push({ buyId: buy.id, sellId: sell.id, fill: out.fill });
      if (out.advanceBuy) i++; if (out.advanceSell) j++;
    }
    await progress({ stage: 'MATCHING', requests: step + 1, volume: volume.toString(), clearingPrice: clearingPrice.toString() });
  }
  let totalFees = 0n; const allocations = [];
  for (const r of rows) {
    const gross = await machine.multiply(clearingPrice, r.filled);
    const fee = r.side === 'sell' ? gross * BigInt(config.feeBps) / 10000n : 0n;
    totalFees += fee;
    const quoteRefund = r.side === 'buy' ? await machine.refund(await machine.multiply(r.price, r.quantity), gross) : 0n;
    allocations.push({ id: r.id, side: r.side, filled: r.filled, unfilled: r.remaining, quotePaid: r.side === 'buy' ? gross : 0n, quoteReceived: r.side === 'sell' ? gross - fee : 0n, fee, quoteRefund, baseRefund: r.side === 'sell' ? r.remaining : 0n });
    await progress({ stage: 'VALUATION', allocations: allocations.length, total: rows.length });
  }
  const result = { clearingPrice, volume, totalFees, allocations, trace };
  verifyResult(orders, result, options);
  return result;
}

export class AsyncSerialRuntime {
  constructor(sample) { this.transport = sample; this.failed = false; }
  async sample(name, input) {
    if (this.failed) throw Error('Runtime permanently failed');
    try { return await this.transport(name, input); }
    catch (error) { this.failed = true; throw error; }
  }
  fail(message) { this.failed = true; throw Error(message); }
  async tick(input) {
    const ready = await this.sample('auction_controller_serial', {});
    if (ready.busy || ready.done) this.fail('Controller not ready');
    await this.sample('auction_controller_serial', { ...input, start: 1, enable: 1 });
    for (let i = 0; i < 97; i++) {
      const out = await this.sample('auction_controller_serial', { enable: 1 });
      if (out.busy !== 1n || out.resultValid !== 0n) this.fail('Controller timing mismatch');
    }
    const result = await this.sample('auction_controller_serial', {});
    if (result.busy || result.error || result.resultValid !== 1n) this.fail('Controller result fault');
    return result;
  }
  async multiply(a, b) {
    await this.sample('multiply32_serial', { start: 1, a, b });
    let out;
    for (let i = 0; i < 32; i++) {
      out = await this.sample('multiply32_serial', { enable: 1 });
      if (out.done !== BigInt(i === 31) || out.busy !== BigInt(i !== 31)) this.fail('Multiplier timing mismatch');
    }
    return out.product;
  }
  async refund(deposit, payment) {
    const out = await this.sample('refund64', { deposit, payment });
    if (out.underflow) this.fail('Insufficient deposit');
    return out.refund;
  }
}
