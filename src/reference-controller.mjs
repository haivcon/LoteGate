// Arithmetic reference for tests and benchmark comparison only; never an RPC fallback.
export class ReferenceController {
  constructor() { this.volume = 0n; this.price = 0n; this.done = 0n; this.error = 0n; }
  tick(p) {
    if (p.reset) { this.volume = 0n; this.price = 0n; this.done = 0n; this.error = 0n; }
    let fill = 0n, matched = 0n;
    const buyQty = BigInt(p.buyQty ?? 0), sellQty = BigInt(p.sellQty ?? 0);
    if (!p.reset && p.enable && !this.done) {
      if (!p.buyValid || !p.sellValid || BigInt(p.buyPrice) < BigInt(p.sellPrice)) this.done = 1n;
      else {
        fill = buyQty < sellQty ? buyQty : sellQty; matched = 1n;
        this.volume += fill; this.price = BigInt(p.sellPrice);
      }
    }
    return { volume: this.volume, price: this.price, done: this.done, error: this.error,
      matched, fill, buyRemaining: buyQty - fill, sellRemaining: sellQty - fill,
      advanceBuy: BigInt(Boolean(matched && fill === buyQty)), advanceSell: BigInt(Boolean(matched && fill === sellQty)) };
  }
  multiply(a, b) { return BigInt(a) * BigInt(b); }
  refund(deposit, payment) {
    if (payment > deposit) throw Error('Refund underflow');
    return deposit - payment;
  }
}
