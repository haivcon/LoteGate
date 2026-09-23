import { uint32, reference } from './match.mjs';

// Local coordinator: no custody, authentication, blockchain state or settlement.
// Input order is the already committed tie priority; IDs are globally unique.
export function runAuction(orders, match = reference) {
  if (!Array.isArray(orders)) throw new TypeError('Orders must be an array');
  const ids = new Set();
  const rows = orders.map((order, priority) => {
    if (typeof order.id !== 'string' || !order.id.trim() || ids.has(order.id)) throw new Error('Order IDs must be nonempty and unique');
    ids.add(order.id);
    if (!['buy', 'sell'].includes(order.side)) throw new Error('Invalid side');
    const price = uint32(order.price), quantity = uint32(order.quantity);
    if (!price || !quantity) throw new RangeError('Price and quantity must be positive');
    return { id: order.id, side: order.side, price, quantity, priority, remaining: quantity, filled: 0n };
  });
  const sort = side => rows.filter(row => row.side === side).sort((a, b) => a.price === b.price ? a.priority - b.priority : (a.price < b.price ? -1 : 1) * (side === 'buy' ? -1 : 1));
  const buys = sort('buy'), sells = sort('sell');
  const trace = [];
  let i = 0, j = 0, volume = 0n, clearingPrice = 0n;
  while (i < buys.length && j < sells.length) {
    const buy = buys[i], sell = sells[j];
    const input = { buyPrice: buy.price, sellPrice: sell.price, buyQty: buy.remaining, sellQty: sell.remaining };
    const result = match(input), expected = reference(input);
    if (Object.keys(expected).some(key => result[key] !== expected[key])) throw new Error('Matcher violated reference contract');
    if (!result.matched) break;
    buy.remaining = result.buyRemaining; sell.remaining = result.sellRemaining;
    buy.filled += result.fill; sell.filled += result.fill;
    volume += result.fill; clearingPrice = sell.price;
    trace.push({ buyId: buy.id, sellId: sell.id, ...input, ...result });
    if (!buy.remaining) i++;
    if (!sell.remaining) j++;
  }
  const allocations = rows.map(row => {
    const payment = row.filled * clearingPrice;
    if (row.filled && ((row.side === 'buy' && clearingPrice > row.price) || (row.side === 'sell' && clearingPrice < row.price))) throw new Error('Limit price violated');
    return { id: row.id, side: row.side, filled: row.filled, unfilled: row.remaining,
      quotePaid: row.side === 'buy' ? payment : 0n,
      quoteReceived: row.side === 'sell' ? payment : 0n,
      quoteRefund: row.side === 'buy' ? row.price * row.quantity - payment : 0n,
      baseRefund: row.side === 'sell' ? row.remaining : 0n };
  });
  const sum = key => allocations.reduce((n, row) => n + row[key], 0n);
  if (sum('quotePaid') !== sum('quoteReceived')) throw new Error('Quote conservation failed');
  return { clearingPrice, volume, allocations, trace };
}
export const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
