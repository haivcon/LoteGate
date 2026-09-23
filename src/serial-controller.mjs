import { CompactLogic } from './compact-logic.mjs';

// 32 compare clocks + 64 arithmetic clocks + one commit clock after capture.
// Outputs are meaningful only at resultValid. No host-selected micro-operations.
export function buildSerialController() {
  const c = new CompactLogic('auction_controller_serial',
    { reset:1, enable:1, start:1, buyValid:1, sellValid:1, buyPrice:32, sellPrice:32, buyQty:32, sellQty:32 },
    { volume:64, price:32, done:1, error:1, bp:32, sp:32, bq:32, sq:32,
      phase:2, count:6, pb:1, qb:1, bb:1, sb:1, carry:1, valid:1, positive:1, match:1, resultValid:1 });
  const p=c.ins,r=c.reg, and=(...x)=>x.reduce((a,b)=>c.and(a,b),1);
  const eq=(x,n)=>c.eq(x,c.constant(n,x.length));
  const idle=eq(r.phase,0), compare=eq(r.phase,1), arithmetic=eq(r.phase,2), commit=eq(r.phase,3);
  const step=and(p.enable[0],c.not(p.reset[0]));
  const start=and(step,idle,p.start[0],c.not(r.done[0]));
  const cmp=and(step,compare), calc=and(step,arithmetic), finish=and(step,commit);
  const last32=eq(r.count,31), last64=eq(r.count,63), low=c.not(r.count[5]);
  const rotate=x=>[...x.slice(1),x[0]];

  // Full subtractor: a + ~b + ~borrow.
  const sub=(a,b,borrow)=>{const s=c.add([a],[c.not(b)],c.not(borrow));return {bit:s.value[0],borrow:c.not(s.carry)};};
  const priceDiff=sub(r.bp[0],r.sp[0],r.pb[0]);
  const qtyDiff=sub(r.bq[0],r.sq[0],r.qb[0]);
  const matching=and(r.valid[0],r.positive[0],c.not(priceDiff.borrow));

  const malformed=and(r.valid[0],c.not(r.positive[0]));
  const fault=c.or(malformed,and(r.match[0],r.carry[0]));
  const stop=c.or(c.not(r.match[0]),fault);
  const updates={};
  const update=(key,gate,value)=>{(updates[key]??=[]).push({gate,value});};
  for(const [key,input] of [['bp','buyPrice'],['sp','sellPrice'],['bq','buyQty'],['sq','sellQty']]) {
    update(key,cmp,rotate(r[key]));update(key,start,p[input]);
  }

  // Reuse the price-comparison register once comparison is complete.
  update('bp',and(cmp,last32),c.choose(qtyDiff.borrow,rotate(r.bq),rotate(r.sq)));
  const fillBit=and(r.match[0],low,r.bp[0]);
  // Arithmetic uses this stable original fill, not the progressively changed remainders.
  const bd=sub(r.bq[0],fillBit,r.bb[0]),sd=sub(r.sq[0],fillBit,r.sb[0]);
  update('bq',and(calc,low),[...r.bq.slice(1),bd.bit]);
  update('sq',and(calc,low),[...r.sq.slice(1),sd.bit]);
  const sum=c.add([r.volume[0]],[fillBit],r.carry[0]);
  update('bp',and(calc,low),rotate(r.bp));
  update('volume',calc,[...r.volume.slice(1),sum.value[0]]);
  update('price',and(finish,r.match[0]),r.sp);
  update('done',finish,[c.or(r.done[0],stop)]);update('error',finish,[c.or(r.error[0],fault)]);
  update('pb',cmp,[priceDiff.borrow]);update('qb',cmp,[qtyDiff.borrow]);
  update('bb',and(calc,low),[bd.borrow]);update('sb',and(calc,low),[sd.borrow]);update('carry',calc,[sum.carry]);
  for(const key of ['pb','qb','bb','sb','carry'])update(key,start,[0]);
  update('valid',start,[and(p.buyValid[0],p.sellValid[0])]);
  update('positive',start,[and(...['buyPrice','sellPrice','buyQty','sellQty'].map(k=>c.nz(p[k])))]);
  update('match',and(cmp,last32),[matching]);update('match',start,[0]);
  update('resultValid',finish,[1]);update('resultValid',start,[0]);
  update('count',c.or(cmp,calc),c.add(r.count,c.constant(1,6)).value);
  update('count',c.or(start,and(cmp,last32)),c.constant(0,6));
  update('phase',start,c.constant(1,2));update('phase',and(cmp,last32),c.constant(2,2));
  update('phase',and(calc,last64),c.constant(3,2));update('phase',finish,c.constant(0,2));
  for(const key of Object.keys(r)) {
    const list=updates[key]??[], selected=[];let used=0;
    for(const item of [...list].reverse()) {
      selected.push({gate:and(c.not(p.reset[0]),item.gate,c.not(used)),value:item.value});
      used=c.or(used,item.gate);
    }
    selected.push({gate:and(c.not(p.reset[0]),c.not(used)),value:r[key]});
    c.drive(key,r[key].map((_,i)=>{
      // Group identical data wires before emitting a sum-of-products cell.
      const groups=new Map();
      for(const item of selected)if(item.value[i]!==0)groups.set(item.value[i],c.or(groups.get(item.value[i])??0,item.gate));
      const terms=[...groups].map(([data,gate])=>({data,gate}));
      const inputs=terms.flatMap(t=>[t.gate,t.data]);
      const rows=terms.map((_,j)=>terms.map((__,k)=>j===k?'11':'--').join('')+' 1');
      return c.cell('selected',inputs,rows,()=>terms.reduce((s,t)=>c.or(s,c.and(t.gate,t.data)),0));
    }));
  }
  for(const key of ['volume','price','done','error','resultValid'])c.output(key,r[key]);
  c.output('busy',[c.not(idle)]);c.output('matched',r.match);
  c.output('fill',r.bp.map(x=>and(x,r.match[0])));
  c.output('buyRemaining',r.bq);c.output('sellRemaining',r.sq);
  c.output('advanceBuy',[and(r.match[0],c.not(c.nz(r.bq)))]);
  c.output('advanceSell',[and(r.match[0],c.not(c.nz(r.sq)))]);
  return c;
}
