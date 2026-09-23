import test from 'node:test';
import assert from 'node:assert/strict';
import { compileStateful, StatefulNetMachine } from '../scripts/stateful.mjs';
import { Machine } from '../src/logic.mjs';
import { buildController as originalController, buildMultiplier as originalMultiplier, buildRefund as originalRefund } from './fixtures/reference-hardware.mjs';

const modules=await compileStateful();
let seed=431;
const next=()=>BigInt(seed=(Math.imul(seed,1664525)+1013904223)>>>0);
test('redesigned controller retains all baseline outputs and 98 latch state cycle for cycle',()=>{
  const m=modules[0], a=new Machine(originalController()), b=new Machine(m.source), net=new StatefulNetMachine(m.source,m.compiled,m.parser);
  assert.equal(m.compiled.nLatch,98);
  for(let i=0;i<1200;i++){
    const state=Array.from({length:98},()=>Number(next()>>16n&1n));
    a.state=[...state];b.state=[...state];net.state=[...state];
    const p={reset:Number(i%17===0),enable:Number(i%5!==0),buyValid:Number(i%7!==0),sellValid:Number(i%11!==0),buyPrice:i%19?next():0n,sellPrice:next(),buyQty:i%23?next():0n,sellQty:next()};
    const expected=a.tick(p);assert.deepEqual(b.tick(p),expected);assert.deepEqual(net.tick(p),expected);assert.deepEqual(b.state,a.state);assert.deepEqual(net.state,a.state);
  }
});
test('redesigned multiplier fits both budgets, retains 32 enabled ticks, pause/restart/reset and exact uint64 result',()=>{
  const m=modules[1];assert.ok(m.withinBudget);assert.equal(m.compiled.nLatch,104);
  const old=new Machine(originalMultiplier()), src=new Machine(m.source), net=new StatefulNetMachine(m.source,m.compiled,m.parser);
  function tick(p){const x=src.tick(p), y=old.tick(p);assert.deepEqual(net.tick(p),x);assert.equal(x.busy,y.busy);assert.equal(x.done,y.done);if(x.done)assert.equal(x.product,y.product);return x;}
  const pairs=[[0n,0n],[1n,0xffffffffn],[0xffffffffn,0xffffffffn],[0x80000000n,0x80000000n],...Array.from({length:100},()=>[next(),next()])];
  for(const [a,b] of pairs){
    tick({reset:1,start:1,enable:1,a,b});tick({start:1,a,b});
    for(let i=0;i<32;i++){
      const before=[...net.state];tick({});assert.deepEqual(net.state,before);
      const out=tick({enable:1,start:1,a:next(),b:next()});
      assert.equal(out.done,BigInt(i===31));if(i===31)assert.equal(out.product,a*b);
    }
    assert.equal(tick({}).product,a*b);
  }
  tick({start:1,a:9,b:7});tick({enable:1});assert.equal(tick({reset:1,enable:1}).product,0n);
});
test('refund retains exact underflow and clamped subtraction; no REF and budget metadata accurate',()=>{
  const m=modules[2],a=new Machine(originalRefund()),b=new Machine(m.source),n=new StatefulNetMachine(m.source,m.compiled,m.parser);
  assert.ok(m.withinBudget);
  for(let i=0;i<400;i++){const p={deposit:next()<<32n|next(),payment:next()<<32n|next()};assert.deepEqual(b.tick(p),a.tick(p));assert.deepEqual(n.tick(p),a.tick(p));}
  for(const item of modules){assert.ok(item.parser.decode(item.raw,item.compiled.nIn).every(g=>g.op===0||g.op===1));assert.equal(item.withinBudget,Buffer.byteLength(item.blif)<34000 && item.raw.length<34000);}
});
