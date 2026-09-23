import { normalize } from './session.mjs';
// Independent arithmetic oracle: repeatedly select heads from original rows.
// Does not reuse Session, sorting, controller, multiplier or settlement execution.
export function verifyResult(orders, result, options = {}) {
  const { rows, config } = normalize(orders, options), remaining = rows.map(r => r.quantity), filled = rows.map(() => 0n), trace = [];
  const best = side => rows.reduce((index, r, i) => {
    if (r.side !== side || !remaining[i]) return index;
    if (index < 0) return i;
    return (side === 'buy' ? r.price > rows[index].price : r.price < rows[index].price) ? i : index;
  }, -1);
  let volume = 0n, price = 0n;
  for (;;) {
    const b = best('buy'), s = best('sell');
    if (b < 0 || s < 0 || rows[b].price < rows[s].price) break;
    const q = remaining[b] < remaining[s] ? remaining[b] : remaining[s];
    remaining[b] -= q; remaining[s] -= q; filled[b] += q; filled[s] += q; volume += q; price = rows[s].price;
    trace.push({ buyId: rows[b].id, sellId: rows[s].id, fill: q });
  }
  if (result.volume !== volume || result.clearingPrice !== price || result.allocations.length !== rows.length || result.trace.length !== trace.length) throw new Error('Incomplete or incorrect result');
  let fees = 0n, paid = 0n, received = 0n;
  rows.forEach((r, i) => {
    if (filled[i] < 0n || remaining[i] < 0n || filled[i] + remaining[i] !== r.quantity) throw new Error('Quantity conservation failed');
    if (filled[i] > 0n && (r.side === 'buy' ? price > r.price : price < r.price)) throw new Error('Uniform price violates order limit');
    const gross = filled[i] * price, fee = r.side === 'sell' ? gross * BigInt(config.feeBps) / 10000n : 0n;
    const expected = { id: r.id, side: r.side, filled: filled[i], unfilled: remaining[i], fee, quotePaid: r.side === 'buy' ? gross : 0n, quoteReceived: r.side === 'sell' ? gross - fee : 0n, quoteRefund: r.side === 'buy' ? r.price * r.quantity - gross : 0n, baseRefund: r.side === 'sell' ? remaining[i] : 0n };
    if (Object.entries(expected).some(([k, v]) => result.allocations[i][k] !== v)) throw new Error('Invalid allocation');
    fees += fee; paid += expected.quotePaid; received += expected.quoteReceived;
  });
  trace.forEach((t, i) => { if (Object.entries(t).some(([k, v]) => result.trace[i][k] !== v)) throw new Error('Invalid trace/priority'); });
  if (result.totalFees !== fees || paid !== received + fees) throw new Error('Quote conservation failed');
  return true;
}
