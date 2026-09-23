import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.mjs';
import { verifyResult } from '../src/verify.mjs';
import { serialRuntime } from '../scripts/serial-runtime.mjs';
import { Machine } from '../src/logic.mjs';
import { buildController, multiply, subtractRefund } from './fixtures/reference-hardware.mjs';
import { AsyncSerialRuntime, executeBatch } from '../src/async-session.mjs';
const runtime=await serialRuntime();
test('async serial adapter executes published binaries with isolated returned state', async () => {
  const names = { auction_controller_serial: 'controller', multiply32_serial: 'multiplier', refund64: 'refund' };
  const books = [[], [{ id: 'only', side: 'buy', price: 1, quantity: 2 }], [{ id: 'b', side: 'buy', price: 20, quantity: 5 }, { id: 's', side: 'sell', price: 10, quantity: 3 }]];
  for (const orders of books) {
    const machines = runtime.createController().machines;
    const adapter = new AsyncSerialRuntime(async (name, input) => machines[names[name]].tick(input));
    assert.deepEqual(await executeBatch(orders, { feeBps: 100 }, adapter), new Session(orders, { feeBps: 100 }).run());
  }
});
const backup={createController:()=>Object.assign(new Machine(buildController()),{multiply,refund:subtractRefund})};
let seed=56;const rand=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
test('published binary full sessions match backup and independent settlement oracle',()=>{
  const books=[[],[{id:'one',side:'buy',price:9,quantity:5}],
    ...Array.from({length:12},()=>Array.from({length:8},(_,i)=>({id:`o${i}`,side:i%2?'buy':'sell',price:1+rand()%100,quantity:1+rand()%1000}))),
    Array.from({length:4},(_,i)=>({id:`max${i}`,side:i%2?'buy':'sell',price:0xffffffff,quantity:0xffffffff}))];
  for(const orders of books){
    const options={feeBps:137},s=new Session(orders,options,runtime),result=s.run();
    assert.deepEqual(result,new Session(orders,options,backup).run());assert.ok(verifyResult(orders,result,options));
    assert.deepEqual(s.result(),result);
  }
});
test('independent session latch state survives interleaved execution',()=>{
  const orders=[{id:'b',side:'buy',price:9,quantity:10},{id:'s',side:'sell',price:7,quantity:5}];
  const a=new Session(orders,{},runtime),b=new Session(orders,{},runtime);
  assert.notEqual(a.machine.machines.controller,b.machine.machines.controller);
  a.step();assert.equal(b.volume,0n);b.step();a.step();b.step();assert.deepEqual(a.result(),b.result());
});
test('missing output, stuck busy, async and thrown transports permanently fail closed',()=>{
  const orders=[{id:'b',side:'buy',price:9,quantity:10},{id:'s',side:'sell',price:7,quantity:5}];
  for(const mode of ['missing','stuck','async','throw']){
    const session=new Session(orders,{},runtime),m=session.machine.machines.controller,original=m.tick.bind(m);
    m.tick=p=>{if(mode==='throw')throw new Error('transport');const out=original(p);if(mode==='async')return Promise.resolve(out);if(mode==='missing')delete out.fill;if(mode==='stuck')out.busy=1n;return out;};
    assert.throws(()=>session.step());assert.throws(()=>session.step(),/failed/);assert.throws(()=>session.result(),/failed/);
  }
});
test('settlement backend failure prevents subsequent settlement',()=>{
  const s=new Session([{id:'b',side:'buy',price:9,quantity:10}],{},runtime);
  s.step();s.machine.machines.multiplier.tick=()=>{throw new Error('settlement transport');};
  assert.throws(()=>s.result(),/transport/);assert.throws(()=>s.result(),/failed/);
});
