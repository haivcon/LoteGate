import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildSerialController } from '../src/serial-controller.mjs';
import { buildMultiplier, buildRefund } from '../src/stateful.mjs';
import { loadParser, parserHash } from './parser.mjs';

const parser=await loadParser(),check=process.argv.includes('--check');
const directory=new URL('../circuits/serial/',import.meta.url);
const hash=x=>createHash('sha256').update(x).digest('hex');
const modules=[buildSerialController,buildMultiplier,buildRefund].map(build=>{
  const c=build(),dense=c.name==='auction_controller_serial',blif=c.blif({denseNames:dense});
  const compiled=parser.compile(parser.expand(parser.parse(blif)));
  if(!(compiled.netlist instanceof Uint8Array) && !Array.isArray(compiled.netlist))throw new TypeError('Expected binary byte array');
  const binary=Buffer.from(compiled.netlist),gates=parser.decode(binary,compiled.nIn);
  if(gates.some(g=>g.op!==0&&g.op!==1))throw new Error('Forbidden opcode/REF');
  if(Buffer.byteLength(blif)>=34000||binary.length>=34000)throw new Error(`Budget exceeded: ${c.name}`);
  return {c,blif,binary,meta:{name:c.name,blifBytes:Buffer.byteLength(blif),binaryBytes:binary.length,nIn:compiled.nIn,nOut:compiled.nOut,nLatch:compiled.nLatch,nRef:0,
    blifSha256:hash(blif),binarySha256:hash(binary),inputs:c.ports,outputs:c.outputPorts,
    inputPins:c.inputs.map((_,i)=>`${dense?'in':'i'}${i.toString(36)}`),outputPins:c.outputs.map((_,i)=>`${dense?'out':'q'}${i.toString(36)}`)}};
});
if(!check)await mkdir(directory,{recursive:true});
async function save(name,content){const path=new URL(name,directory),bytes=Buffer.from(content);if(check){if(!(await readFile(path)).equals(bytes))throw new Error(`Stale artifact ${path}`);}else await writeFile(path,bytes);}
for(const m of modules){await save(`${m.c.name}.blif`,m.blif);await save(`${m.c.name}.bin`,m.binary);console.log(`${m.c.name}: BLIF ${m.meta.blifBytes}, binary ${m.binary.length}, latches ${m.meta.nLatch}`);}
await save('manifest.json',JSON.stringify({parserHash,strictByteLimit:34000,status:'Budget-checked circuit candidates, not deployed; default Session/UI unchanged',
  protocol:{controller:'start+enable captures only when idle and not done; 97 enabled work ticks; observe resultValid on following sample; outputs valid only when resultValid=1; reset clears all state; input changes/start ignored while busy; enable=0 holds all state; done locks until reset',multiplier:'start captures; 32 enabled work ticks; product valid when done=1; intermediate product differs from baseline',refund:'Combinational uint64 subtraction with underflow and clamping'},modules:modules.map(m=>m.meta)},null,2)+'\n');
