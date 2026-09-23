import { CompactLogic as Logic } from './compact-logic.mjs';

export function buildMultiplier() {
  // Combined product register: add a to the high half when low bit is set,
  // then shift right. 32-bit adder instead of 64-bit x/acc datapaths.
  const c = new Logic('multiply32_serial', { reset:1, start:1, enable:1, a:32, b:32 }, { a:32, product:64, count:6, busy:1, done:1 });
  const p=c.ins,r=c.reg, start=c.and(p.start[0],c.not(r.busy[0])), work=c.and(r.busy[0],p.enable[0]);
  const end=c.and(work,c.eq(r.count,c.constant(31,6)));
  const sum=c.add(r.product.slice(32),r.a.map(x=>c.and(x,r.product[0])));
  const shifted=[...r.product.slice(1,32),...sum.value,sum.carry];
  const values={
    a:c.choose(start,p.a,r.a),
    product:c.choose(start,[...p.b,...c.constant(0,32)],c.choose(work,shifted,r.product)),
    count:c.choose(start,c.constant(0,6),c.choose(work,c.add(r.count,c.constant(1,6)).value,r.count)),
    busy:[c.or(start,c.and(r.busy[0],c.not(end)))],
    done:[c.and(c.not(start),c.or(r.done[0],end))]
  };
  for(const [key,value] of Object.entries(values)) {
    const next=c.choose(p.reset[0],c.constant(0,value.length),value); c.drive(key,next);
    if(['product','busy','done'].includes(key)) c.output(key,next);
  }
  return c;
}
export function buildRefund() {
  const c = new Logic('refund64', { deposit: 64, payment: 64 });
  const r = c.sub(c.ins.deposit, c.ins.payment);
  c.output('underflow', [r.borrow]); c.output('refund', c.choose(r.borrow, c.constant(0, 64), r.value)); return c;
}
