# Stateful Session integration and CPU probe

## Implemented

An opt-in Session backend reads the published .bin artifacts from <repository>\circuits\serial, checks binary hashes and sizes, and creates fresh latch machines per Session. The default modular backend and browser UI are unchanged.

<repository>\src\serial-runtime.mjs supplies requests, bounded clock sequences, and output validation. It does not calculate fill, remaining quantities, volume, multiplication or subtraction. Missing/non-bigint/out-of-range outputs, promises, unexpected busy/done timing and transport errors permanently poison the runtime. Failed execution cannot proceed to settlement.

Session still performs order normalization, sorting, head selection, allocation bookkeeping and fee calculation as before. This is NOT an autonomous or trustless settlement engine. Stateful controller data is never inferred from the modular backend.

The controller takes 97 work clocks after capture. The adapter performs 100 simulator tick calls/request: idle check, capture, 97 work clocks, result sample. The two enable=0 samples do not advance work. Multiplication takes 33 calls including capture. Tick-call counts are NOT gas estimates or required transaction counts.

## Validation

The new full-session tests compare published-binary execution against the original backup and an independent settlement oracle, including full-width products, aggregate volume above uint32, fees, empty/one-sided books and repeated settlement reads. Interleaved sessions have separate latch state. Injected backend failures are rejected.

The sample order book produces volume 1200, clearing price 10, and independently verified allocations/refunds. This demo executes locally.

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
npm run check:serial
npm run demo:serial
npm run verify
npm run probe:cpu
```

## Actual environment findings

The local <repository>\contracts\NandBenchmark.sol is combinational-only, not TapeOut CPU, and rejects latch opcode 1. The existing Ganache benchmark cannot demonstrate this controller's deployment behavior.

The neighboring external research script `check-deployment.mjs` (not required by this repository) supplies a read-only CPU endpoint/address and selectors. A new read-only probe successfully queried chain 196, CPU 0x933fc3aa0c387cb8b6b1d22a2ec3e2b5eecfdb5a, at block 0x440ff33. Existing circuit 1 reports dimensions [161,1,288,3035]. Two identical zero-state step eth_call requests returned identical results with 36 next-state bytes and 1 output byte.

The report is <repository>\reports\cpu-probe.json. The script repeats the probe against a pinned block and reports BLOCKED on RPC errors. It performs no signing, deployment or transaction broadcast.

**The observed step interface accepts caller-provided state and returns next state. This does not prove storage persistence, state authenticity, ownership, reset authorization or session isolation on-chain.** Repeated eth_call itself cannot establish any persistent writes. The probe is not semantic verification of the existing circuit, and LotGate circuits are not deployed there by this work.

## Remaining deployment blockers

Review verified CPU implementation/ABI and limits; bind execution to the exact netlist; define session-state storage/commitment, ownership, replay prevention and reset policy; validate every state transition rather than accepting client-provided next state. Measure actual execution costs and whether bounded multi-clock batching is supported. Sorting, fees and custody need their own authenticated rules. Do not connect this local adapter directly to real funds or claim the current state handling is trustless.

Browser integration remains opt-in follow-up work after state/authority semantics are agreed. No existing backups or deployed circuits were modified.
