export const MAX = 0xffffffffn;

export function uint32(value) {
  if (!((typeof value === 'bigint') || (typeof value === 'number' && Number.isSafeInteger(value)) || (typeof value === 'string' && /^\d+$/.test(value)))) throw new TypeError('Expected an unsigned integer');
  const n = BigInt(value);
  if (n < 0n || n > MAX) throw new RangeError('Value outside uint32');
  return n;
}
