// Independent arithmetic model of the tick contract, not a circuit builder.
export function controllerOracle(state, p) {
  const word = (start, width) => state.slice(start, start + width).reduce((v, b, i) => v | BigInt(b) << BigInt(i), 0n);
  const volume = word(0,64), price = word(64,32), done = word(96,1), error = word(97,1);
  const active = Boolean(p.enable && !done && !p.reset), valid = Boolean(p.buyValid && p.sellValid);
  const bp = BigInt(p.buyPrice ?? 0), sp = BigInt(p.sellPrice ?? 0), bq = BigInt(p.buyQty ?? 0), sq = BigInt(p.sellQty ?? 0);
  const positive = bp > 0n && sp > 0n && bq > 0n && sq > 0n;
  const matched = BigInt(active && valid && positive && bp >= sp), fill = matched ? bq < sq ? bq : sq : 0n;
  const total = volume + fill, overflow = total > 0xffffffffffffffffn, malformed = valid && !positive;
  return { volume: p.reset ? 0n : total & 0xffffffffffffffffn, price: p.reset ? 0n : matched ? sp : price,
    done: p.reset ? 0n : BigInt(Boolean(done || active && (!valid || bp < sp || malformed || overflow))),
    error: p.reset ? 0n : BigInt(Boolean(error || active && (malformed || overflow))),
    matched, fill, buyRemaining: bq-fill, sellRemaining: sq-fill, advanceBuy: BigInt(Boolean(matched && bq===fill)), advanceSell: BigInt(Boolean(matched && sq===fill)) };
}
