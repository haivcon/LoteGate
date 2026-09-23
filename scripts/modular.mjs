import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadParser, parserHash } from './parser.mjs';
import { modularBuilders, modularBlif } from '../src/modular.mjs';
import { NetMachine } from './parser.mjs';
export async function compileModules() {
  const parser = await loadParser();
  return modularBuilders.map(build => {
    const source = build(), blif = modularBlif(source), compiled = parser.compile(parser.expand(parser.parse(blif)));
    const raw = Buffer.from(compiled.netlist), blifBytes = Buffer.byteLength(blif);
    if (blifBytes > 34000 || raw.length > 34000) throw new Error(`${source.name} exceeds budget: BLIF ${blifBytes}, netlist ${raw.length}`);
    if (compiled.nLatch !== 0 || parser.decode(raw, compiled.nIn).some(g => g.op !== 0)) throw new Error('Expected stateless NAND only');
    return { parser, source, blif, compiled, raw, blifBytes };
  });
}
export function compiledEvaluator(modules) {
  const machines = new Map(modules.map(m => [m.source.name, new NetMachine(m.source, m.compiled, m.parser)]));
  return (name, input) => { const m = machines.get(name); if (!m) throw new Error('Unknown module'); return m.tick(input); };
}
export async function generateModules(check = false) {
  const modules = await compileModules(), manifest = { parserHash, budget: { blif: 34000, netlist: 34000 }, status: 'Local parser verified; canvas import and on-chain execution unverified', modules: [] };
  const dir = new URL('../circuits/modular/', import.meta.url);
  if (!check) await mkdir(dir, { recursive: true });
  const save = async (name, data) => { const file = new URL(name, dir); if (check) { if (await readFile(file, 'utf8') !== data) throw new Error(`Stale ${file}`); } else await writeFile(file, data); };
  for (const m of modules) {
    const meta = { name: m.source.name, blifBytes: m.blifBytes, netlistBytes: m.raw.length, nIn: m.compiled.nIn, nOut: m.compiled.nOut, nNand: m.compiled.nNand, nLatch: 0, nRef: 0, inputs: m.source.ports, outputs: m.source.outputPorts, inputOrder: m.source.inputs, outputOrder: m.source.outputNames, packing: 'Unsigned LSB first', blifSha256: createHash('sha256').update(m.blif).digest('hex'), netlistSha256: createHash('sha256').update(m.raw).digest('hex') };
    manifest.modules.push(meta);
    await save(`${meta.name}.blif`, m.blif); await save(`${meta.name}.netlist.hex`, `0x${m.raw.toString('hex')}\n`);
    console.log(`${meta.name}: BLIF ${meta.blifBytes}, netlist ${meta.netlistBytes}`);
  }
  await save('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generateModules(process.argv.includes('--check'));
