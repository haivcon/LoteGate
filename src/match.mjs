export const MAX = 0xffffffffn;
export const fields = ['buyPrice', 'sellPrice', 'buyQty', 'sellQty'];
export function uint32(value) {
  if (!((typeof value === 'bigint') || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value)))) throw new TypeError('Expected an unsigned integer');
  const n = BigInt(value);
  if (n < 0n || n > MAX) throw new RangeError('Value outside uint32');
  return n;
}
export function normalize(input) {
  return Object.fromEntries(fields.map(key => [key, uint32(input[key])]));
}
export function reference(input) {
  const { buyPrice, sellPrice, buyQty, sellQty } = normalize(input);
  const matched = buyPrice > 0n && sellPrice > 0n && buyPrice >= sellPrice && buyQty > 0n && sellQty > 0n;
  const fill = matched ? (buyQty < sellQty ? buyQty : sellQty) : 0n;
  return { matched, fill, buyRemaining: buyQty - fill, sellRemaining: sellQty - fill };
}
export function inputBits(input) {
  const data = normalize(input);
  return Uint8Array.from(fields.flatMap(key => Array.from({ length: 32 }, (_, bit) => Number((data[key] >> BigInt(bit)) & 1n))));
}
export function outputValue(bits) {
  const word = offset => Array.from(bits.slice(offset, offset + 32)).reduce((n, bit, i) => n | (BigInt(bit) << BigInt(i)), 0n);
  return { matched: Boolean(bits[0]), fill: word(1), buyRemaining: word(33), sellRemaining: word(65) };
}
