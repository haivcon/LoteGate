import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const parserHash = 'a794be064f8a0e1317f2de4ed909cc397f24a6836c048a881b124afffdf42084';
export async function loadParser() {
  if (!process.env.TAPEOUT_PARSER) throw new Error('Set TAPEOUT_PARSER to the reviewed parser snapshot');
  const bytes = await readFile(process.env.TAPEOUT_PARSER);
  if (createHash('sha256').update(bytes).digest('hex') !== parserHash) throw new Error('Parser checksum mismatch');
  return import(`data:text/javascript;base64,${bytes.toString('base64')}`);
}
