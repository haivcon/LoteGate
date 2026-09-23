# X Layer circuit verification

CPU: `0xAa13ae45b0B2D52f210Ad7Ef12997113a0ebAF21`, chain 196.
Circuit IDs: refund64 = 1, multiply32_serial = 2, auction_controller_serial = 3.

## Reproduce the read-only differential check

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
$env:XLAYER_RPC='https://tapeout.net/rpc-xlayer'
node scripts/verify-xlayer.mjs
```

The reviewed parser must exist and match the pinned checksum. No wallet or private key is needed. This command can take several minutes and exits nonzero on RPC errors or mismatches. The report is written to `<repository>\reports\xlayer-execution.json`; inspect `result`, `reason`, and per-module checked/planned counts rather than treating report existence as success.

The checker pins all calls to one block, verifies chain identity, deployed netlist bytes and recorded dimensions, and compares packed output and next-state bytes against the published-binary local simulator. Calls use existing probe selectors; this is not a verified-source/ABI audit.

Coverage:
- Refund: zero, ordinary subtraction, underflow, uint64 boundaries.
- Multiplier: zero, ordinary multiplication, uint32 maximum operands, all 32 work clocks, pause, restart and reset during work.
- Controller: consecutive matching requests, terminal request, all 97 work clocks, paused state, ignored busy inputs, terminal lock and reset during work.

Each RPC step receives the corresponding **locally generated reference state**. The checks are differential replay, not an RPC-driven BatchEngine session, not proof of persisted/authenticated state, and not exhaustive verification. Independent reference-state calls are limited to four concurrent requests. No signing, broadcast, custody or settlement is implemented here.

## Remaining integration

BatchEngine, Session and SerialRuntime retain their synchronous contracts. Do not pass Promise-returning tick/multiply/refund implementations into them. A separately tested asynchronous execution path needs fail-closed errors, isolated per-batch state, concurrent-mutation protection, bounded requests, and full-session oracle checks before replacing the local backend. Factory registration/source verification and transaction provenance remain separate work. Settlement stays disabled.
