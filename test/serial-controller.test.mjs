import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSerialController } from '../src/serial-controller.mjs';
import { Machine, bits } from '../src/logic.mjs';
import { buildController } from './fixtures/reference-hardware.mjs';
import { loadParser } from '../scripts/parser.mjs';
import { StatefulNetMachine } from '../scripts/stateful.mjs';
const c=buildSerialController(),parser=await loadParser(),blif=c.blif({denseNames:true});
const compiled=parser.compile(parser.expand(parser.parse(blif)));
let seed=917;const random=()=>BigInt(seed=(Math.imul(seed,1664525)+1013904223)>>>0);
test('serial controller: strict budgets, no REF, completed requests match baseline',()=>{
  assert.ok(Buffer.byteLength(blif)<34000);assert.ok(Buffer.from(compiled.netlist).length<34000);
  assert.ok(parser.decode(compiled.netlist,compiled.nIn).every(g=>g.op===0||g.op===1));
  const source=new Machine(c),net=new StatefulNetMachine(c,compiled,parser),baseline=new Machine(buildController());
  const tick=p=>{const a=source.tick(p);assert.deepEqual(net.tick(p),a);assert.deepEqual(net.state,source.state);return a;};
  for(let i=0;i<180;i++) {
    const p={buyValid:i%13?1:0,sellValid:i%17?1:0,buyPrice:i%19?random():0n,sellPrice:random(),buyQty:i%23?random():0n,sellQty:random()};
    if(i%4===0){p.buyPrice=0xffffffffn;p.sellPrice=1n;}
    if(i%7===0)p.sellQty=p.buyQty;
    const volume=i%3===0?0xffffffffffffffffn:random()<<32n|random();
    const price=random();
    const state=[...bits(volume,64),...bits(price,32),0,i%11===0?1:0];
    baseline.state=[...state];source.state.fill(0);source.state.splice(0,98,...state);net.state=[...source.state];
    const expected=baseline.tick({...p,enable:1});
    tick({...p,start:1,enable:1});
    for(let j=0;j<97;j++) {
      if(j%9===0){const before=[...source.state];tick({start:1,buyQty:123});assert.deepEqual(source.state,before);}
      tick({enable:1,start:1,buyPrice:random(),sellPrice:random(),buyQty:random(),sellQty:random()});
    }
    const result=tick({});assert.equal(result.resultValid,1n);assert.equal(result.busy,0n);
    for(const key of Object.keys(expected))assert.equal(result[key],expected[key],`case ${i}: ${key}`);
    if(result.done){const before=[...source.state];tick({...p,start:1,enable:1});assert.deepEqual(source.state,before);}
  }
});
test('serial consecutive requests accumulate without reset and terminal lock matches baseline',()=>{
  const s=new Machine(c),n=new StatefulNetMachine(c,compiled,parser),b=new Machine(buildController());
  for(let i=0;i<40;i++){
    const p={buyValid:1,sellValid:1,buyPrice:100,sellPrice:10+i,buyQty:i===39?0:100+i,sellQty:50+i};
    const expected=b.tick({...p,enable:1});
    assert.deepEqual(s.tick({...p,enable:1,start:1}),n.tick({...p,enable:1,start:1}));
    for(let j=0;j<97;j++)assert.deepEqual(s.tick({enable:1}),n.tick({enable:1}));
    const out=s.tick({});assert.deepEqual(out,n.tick({}));
    for(const key of Object.keys(expected))assert.equal(out[key],expected[key]);
    assert.equal(out.resultValid,1n);
  }
});
test('serial reset wins in every phase and discards work',()=>{
  const s=new Machine(c),n=new StatefulNetMachine(c,compiled,parser);
  for(const count of [0,1,31,32,33,63,96,97]){
    const p={enable:1,start:1,buyValid:1,sellValid:1,buyPrice:9,sellPrice:7,buyQty:10,sellQty:8};
    s.tick(p);n.tick(p);
    for(let i=0;i<count;i++){assert.deepEqual(s.tick({enable:1}),n.tick({enable:1}));}
    assert.deepEqual(s.tick({reset:1,start:1,enable:1}),n.tick({reset:1,start:1,enable:1}));
    assert.ok(s.state.every(x=>x===0));assert.deepEqual(s.state,n.state);
  }
});
