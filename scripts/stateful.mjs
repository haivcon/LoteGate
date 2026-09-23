import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { loadParser, parserHash } from './parser.mjs';
import { buildController, buildMultiplier, buildRefund } from '../src/stateful.mjs';
import { bits, integer } from '../src/logic.mjs';

export class StatefulNetMachine {
  constructor(source, compiled, parser) {
    this.c=source; this.gates=parser.decode(compiled.netlist,compiled.nIn);
    if(this.gates.some(g=>g.op!==0 && g.op!==1)) throw new Error('Unexpected REF/opcode');
    this.state=this.gates.filter(g=>g.op===1).map(()=>0);
  }
  tick(input={}) {
    const c=this.c,v=new Uint8Array(2+c.inputs.length+this.gates.length);v[1]=1;
    let offset=2,j=0;
    for(const [key,width] of Object.entries(c.ports)){v.set(bits(input[key]??0n,width),offset);offset+=width;}
    for(const g of this.gates)if(g.op===1)v[g.out]=this.state[j++];
    for(const g of this.gates)if(g.op===0)v[g.out]=1^(v[g.a]&v[g.b]);
    this.state=this.gates.filter(g=>g.op===1).map(g=>v[g.d]);
    offset=v.length-c.outputs.length;
    return Object.fromEntries(Object.entries(c.outputPorts).map(([key,width])=>{const n=integer([...v.slice(offset,offset+width)]);offset+=width;return[key,n];}));
  }
}
export async function compileStateful() {
  const parser=await loadParser();
  return [buildController,buildMultiplier,buildRefund].map(build=>{
    const source=build(),blif=source.blif(),compiled=parser.compile(parser.expand(parser.parse(blif)));
    const raw=Buffer.from(compiled.netlist), gates=parser.decode(raw,compiled.nIn);
    if(gates.some(g=>g.op!==0 && g.op!==1))throw new Error('Unexpected opcode');
    return {source,blif,compiled,raw,parser,withinBudget:Buffer.byteLength(blif)<34000 && raw.length<34000};
  });
}
export async function generateStateful(check=false) {
  const modules=await compileStateful();
  const directory=new URL('../circuits/stateful/',import.meta.url);if(!check)await mkdir(directory,{recursive:true});
  const hash=x=>createHash('sha256').update(x).digest('hex');
  const manifest={status:'Experimental redesign; controller still exceeds budget. NOT deployment-ready.',parserHash,strictByteLimit:34000,modules:[]};
  async function save(name,text){const url=new URL(name,directory);if(check){if(await readFile(url,'utf8')!==text)throw new Error(`Stale ${url}`);}else await writeFile(url,text);}
  for(const m of modules){
    const {source:c,compiled:n}=m;
    const meta={name:c.name,withinBudget:m.withinBudget,blifBytes:Buffer.byteLength(m.blif),netlistBytes:m.raw.length,nIn:n.nIn,nOut:n.nOut,nLatch:n.nLatch,nRef:0,blifSha256:hash(m.blif),netlistSha256:hash(m.raw),inputs:c.ports,outputs:c.outputPorts,blifInputOrder:c.inputs.map((_,i)=>`i${i.toString(36)}`),blifOutputOrder:c.outputs.map((_,i)=>`q${i.toString(36)}`),semantics:c.name==='multiply32_serial'?'start captures operands; 32 enabled work ticks; product valid only when done=1; intermediate product changed from baseline':'Cycle-exact baseline behavior'};
    manifest.modules.push(meta);
    // Do not publish oversized files beside candidates suitable for import.
    if(m.withinBudget){await save(`${c.name}.blif`,m.blif);await save(`${c.name}.netlist.hex`,`0x${m.raw.toString('hex')}\n`);}
    console.log(`${c.name}: BLIF ${meta.blifBytes}, netlist ${meta.netlistBytes}, latches ${n.nLatch}, ${m.withinBudget?'FIT':'BLOCKED'}`);
  }
  await save('manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return modules.every(m=>m.withinBudget);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const ok=await generateStateful(process.argv.includes('--check'));if(!ok && process.argv.includes('--require-all'))process.exitCode=1;}
