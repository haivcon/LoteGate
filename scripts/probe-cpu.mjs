// Read-only probe of the endpoint/address used by the neighboring Trivium project.
// No signing, deployment or persistent-state transaction is performed.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const endpoint=process.env.XLAYER_RPC||'https://tapeout.net/rpc-xlayer';
const address='0x933fc3aa0c387cb8b6b1d22a2ec3e2b5eecfdb5a';
let id=0;async function rpc(method,params=[]){const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const body=await response.json();if(body.error)throw new Error(JSON.stringify(body.error));if(body.result===undefined)throw new Error('Missing RPC result');return body.result;}
const word=n=>BigInt(n).toString(16).padStart(64,'0');
const bytes=hex=>word(hex.length/2)+hex.padEnd(Math.ceil(hex.length/64)*64,'0');
const number=(hex,i)=>Number(BigInt('0x'+hex.slice(2+i*64,2+(i+1)*64)));
const report={scope:'Read-only existing circuit probe; NOT LotGate deployment or persistence proof',address};
try {
  report.chainId=Number(BigInt(await rpc('eth_chainId')));assert.equal(report.chainId,196);
  report.block=await rpc('eth_blockNumber');assert.notEqual(await rpc('eth_getCode',[address,report.block]),'0x');
  const call=data=>rpc('eth_call',[{to:address,data:'0x'+data},report.block]);
  const highest=Number(BigInt(await call('61b8ce8c')));assert.ok(highest>0&&highest<=10000);
  report.circuitId=highest;
  const info=await call('084d60f1'+word(highest));report.dimensions=[0,1,2,3].map(i=>number(info,i));
  const [nIn,,nLatch]=report.dimensions;assert.ok(nIn<=65536&&nLatch<=65536);
  const state=bytes('00'.repeat(Math.ceil(nLatch/8))),input=bytes('00'.repeat(Math.ceil(nIn/8)));
  const data='e8281a1a'+word(highest)+word(96)+word(96+state.length/2)+state+input;
  const first=await call(data),second=await call(data);assert.equal(first,second);
  const extract=slot=>{const offset=number(first,slot);assert.equal(offset%32,0);const length=number(first,offset/32);const hex=first.slice(2+(offset+32)*2,2+(offset+32+length)*2);assert.equal(hex.length,length*2);return {length,hex};};
  report.returnedStateBytes=extract(0).length;report.returnedOutputBytes=extract(1).length;
  assert.equal(report.returnedStateBytes,Math.ceil(nLatch/8));
  report.result='PASS';report.observation='Step accepts caller-supplied state and returns next-state bytes; identical eth_call inputs at same block return identical results. This does not authenticate state or demonstrate storage persistence.';
} catch(error){report.result='BLOCKED';report.reason=error.message;process.exitCode=1;}
await mkdir(new URL('../reports/',import.meta.url),{recursive:true});
await writeFile(new URL('../reports/cpu-probe.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
