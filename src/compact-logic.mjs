import { Logic } from './logic.mjs';

// Record functional cells alongside the NAND model. BLIF truth tables preserve
// the exact logic while avoiding the parser's expansion of each NAND into 3 gates.
export class CompactLogic extends Logic {
  constructor(...args) { super(...args); this.cells = []; this.cellCache = new Map(); this.recording = true; }
  cell(kind, inputs, rows, build) {
    if (!this.recording) return build();
    const key = `${kind}:${inputs.join(',')}`;
    if (this.cellCache.has(key)) return this.cellCache.get(key);
    this.recording = false;
    let out;
    try { out = build(); } finally { this.recording = true; }
    // A simplification may return an existing input or constant.
    if (out > 1 && !inputs.includes(out) && !this.cells.some(c => c.out === out)) this.cells.push({ inputs, out, rows });
    this.cellCache.set(key, out); return out;
  }
  nand(a,b) { return this.cell('nand',[a,b],a===b?['0 1']:['11 0'],()=>super.nand(a,b)); }
  not(a) { return this.cell('not',[a],['0 1'],()=>super.not(a)); }
  and(a,b) { return this.cell('and',[a,b],['11 1'],()=>super.and(a,b)); }
  or(a,b) { return this.cell('or',[a,b],['1- 1','-1 1'],()=>super.or(a,b)); }
  xor(a,b) { return this.cell('xor',[a,b],['01 1','10 1'],()=>super.xor(a,b)); }
  mux(s,a,b) { return this.cell('mux',[s,a,b],['11- 1','0-1 1'],()=>super.mux(s,a,b)); }
  add(a,b,carry=0) {
    const value=a.map((bit,i)=>{
      const x=this.xor(bit,b[i]), result=this.xor(x,carry);
      carry=this.mux(x,carry,bit);
      return result;
    }); return {value,carry};
  }
  blif({ denseNames = false } = {}) {
    const byOutput=new Map(this.cells.map(c=>[c.out,c])), live=new Set();
    const visit=s=>{if(live.has(s)) return; live.add(s); const c=byOutput.get(s); if(c) c.inputs.forEach(visit);};
    this.outputs.forEach(visit); this.elements.filter(e=>e.op===1).forEach(e=>visit(e.d));
    const cells=this.cells.filter(c=>live.has(c.out));
    const names=new Map([[0,'z'],[1,'o']]); let id=0;
    for(let i=0;i<this.inputs.length;i++) names.set(i+2,`i${i.toString(36)}`);
    for(const e of this.elements) if(e.op===1) names.set(e.out,`r${(id++).toString(36)}`);
    for(const c of cells) if(!names.has(c.out)) names.set(c.out,`n${(id++).toString(36)}`);
    if (denseNames) {
      const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const short=n=>n<52?alphabet[n]:alphabet[Math.floor((n-52)/62)]+alphabet[(n-52)%62];
      const internal=[...names.keys()].filter(s=>s>=2+this.inputs.length);
      if(internal.length>52+52*62)throw new Error('Dense signal name capacity exceeded');
      const frequency=new Map(internal.map(s=>[s,1]));
      for(const cell of cells)for(const s of cell.inputs)if(frequency.has(s))frequency.set(s,frequency.get(s)+1);
      internal.sort((a,b)=>frequency.get(b)-frequency.get(a));
      // z/o constants must not collide with generated internal identifiers.
      names.set(0,'zero');names.set(1,'one');
      internal.forEach((s,i)=>names.set(s,short(i)));
      this.inputs.forEach((_,i)=>names.set(i+2,`in${i.toString(36)}`));
    }
    const name=s=>{if(!names.has(s)) throw new Error(`Unexported signal ${s}`); return names.get(s);};
    const outputs=this.outputs.map((_,i)=>`${denseNames?'out':'q'}${i.toString(36)}`);
    const lines=[`.model ${this.name}`,`.inputs ${this.inputs.map((_,i)=>name(i+2)).join(' ')}`,`.outputs ${outputs.join(' ')}`,`.names ${name(0)}`,`.names ${name(1)}`,'1'];
    for(const e of this.elements) if(e.op===1) lines.push(`.latch ${name(e.d)} ${name(e.out)} 0`);
    for(const c of cells) {
      const ins=c.inputs.length===2 && c.inputs[0]===c.inputs[1] && c.rows.length===1 && c.rows[0]==='0 1' ? [c.inputs[0]] : c.inputs;
      lines.push(`.names ${ins.map(name).join(' ')} ${name(c.out)}`,...c.rows);
    }
    this.outputs.forEach((s,i)=>lines.push(`.names ${name(s)} ${outputs[i]}`,'1 1'));
    return [...lines,'.end',''].join('\n');
  }
}
