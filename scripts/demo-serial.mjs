import { readFile } from 'node:fs/promises';
import { serialRuntime } from './serial-runtime.mjs';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
const orders=JSON.parse(await readFile(process.argv[2]??new URL('../examples/orders.json',import.meta.url),'utf8'));
const session=new Session(orders,{},await serialRuntime()),result=session.run();
verifyResult(orders,result);
console.log(JSON.stringify({backend:'Published stateful binary artifacts; LOCAL simulation, not on-chain',verified:true,simulatorTickCalls:session.machine.clocks,result},(_,v)=>typeof v==='bigint'?v.toString():v,2));
