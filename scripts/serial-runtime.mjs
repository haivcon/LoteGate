import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadParser, parserHash } from './parser.mjs';
import { StatefulNetMachine } from './stateful.mjs';
import { SerialRuntime } from '../src/serial-runtime.mjs';

// Load the published binaries, not regenerated in-memory circuits.
export async function serialRuntime() {
  const parser=await loadParser(),directory=new URL('../circuits/serial/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'));
  if(manifest.parserHash!==parserHash)throw new Error('Artifact parser mismatch');
  const names=['auction_controller_serial','multiply32_serial','refund64'];
  const definitions=await Promise.all(names.map(async name=>{
    const meta=manifest.modules.find(m=>m.name===name);if(!meta)throw new Error(`Missing ${name}`);
    const netlist=await readFile(new URL(`${name}.bin`,directory));
    const hash=createHash('sha256').update(netlist).digest('hex');
    if(hash!==meta.binarySha256||netlist.length!==meta.binaryBytes||netlist.length>=34000)throw new Error(`Invalid artifact ${name}`);
    const width=ports=>Object.values(ports).reduce((a,b)=>a+b,0);
    if(width(meta.inputs)!==meta.nIn||width(meta.outputs)!==meta.nOut)throw new Error('Invalid port metadata');
    const source={ports:meta.inputs,outputPorts:meta.outputs,inputs:Array(meta.nIn),outputs:Array(meta.nOut)};
    return ()=>new StatefulNetMachine(source,{netlist,nIn:meta.nIn},parser);
  }));
  return {createController:()=>new SerialRuntime(()=>Object.fromEntries(['controller','multiplier','refund'].map((key,i)=>[key,definitions[i]()]))) };
}
