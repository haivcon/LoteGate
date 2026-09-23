import { bits } from './logic.mjs';

// Transport adapter only: all auction arithmetic and FSM transitions are gates.
// Each factory call MUST return a fresh, isolated controller/multiplier/refund set.
export class SerialRuntime {
  constructor(createMachines) {
    this.machines=createMachines();this.error=false;this.clocks={controller:0,multiplier:0,refund:0};
  }
  sample(name,input) {
    if(this.error)throw new Error('Serial runtime permanently failed');
    try {
      const machine=this.machines[name],out=machine.tick(input);
      if(!out||typeof out!=='object'||typeof out.then==='function')throw new Error('Synchronous output required');
      for(const [key,width] of Object.entries(machine.c.outputPorts)) {
        if(typeof out[key]!=='bigint')throw new Error(`Missing/non-bigint output: ${key}`);
        bits(out[key],width);
      }
      this.clocks[name]++;return out;
    } catch(error){this.error=true;throw error;}
  }
  fail(message){this.error=true;throw new Error(message);}
  tick(input) {
    if(input.reset||!input.enable)this.fail('Session adapter accepts enabled requests only');
    const ready=this.sample('controller',{});
    if(ready.busy||ready.done)this.fail('Controller not ready');
    this.sample('controller',{...input,start:1,enable:1});
    for(let i=0;i<97;i++){
      const out=this.sample('controller',{enable:1});
      if(out.busy!==1n||out.resultValid!==0n)this.fail('Unexpected controller timing');
    }
    const result=this.sample('controller',{});
    if(result.busy!==0n||result.resultValid!==1n||result.error!==0n)this.fail('Controller timeout/fault');
    return result;
  }
  multiply(a,b) {
    this.sample('multiplier',{start:1,a,b});
    let out;
    for(let i=0;i<32;i++){
      out=this.sample('multiplier',{enable:1});
      if(out.done!==BigInt(i===31)||out.busy!==BigInt(i!==31))this.fail('Multiplier timing fault');
    }
    return out.product;
  }
  refund(deposit,payment) {
    const out=this.sample('refund',{deposit,payment});
    if(out.underflow)this.fail('Insufficient deposit');return out.refund;
  }
}
