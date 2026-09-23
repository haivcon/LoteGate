> Superseded for the new serial candidate: see <repository>\SERIAL-CONTROLLER.md. All three serial candidate artifacts now fit; this file records the earlier single-cycle experiment. Default UI/Session is still unchanged.


# Stateful redesign — incomplete, not deployment-ready

The requested target is preservation of the backup circuit logic under BOTH strict 34,000-byte limits (BLIF text and compiled binary), without replacing hardware state/control with JavaScript. This experimental path does not yet satisfy the controller budget. Session/UI still use the previous modular backend; do not mistake that demo for this redesign.

## Implementation
- Source: <repository>\src\stateful.mjs
- Functional-cell BLIF emitter with NAND source model: <repository>\src\compact-logic.mjs
- Compiler, latch-aware netlist simulator, generator: <repository>\scripts\stateful.mjs
- Baseline equivalence tests: <repository>\test\stateful.test.mjs
- Baseline dependency retained in <repository>\backups\before-modular-20260923-001220\src

BLIF uses functional truth tables and short pin names. Metadata maps ordered logical port groups to physical pins (LSB first). The pinned, unmodified parser expands cells to NAND/latches. No REF is introduced. Dead functional cells are omitted only if neither outputs nor latch D inputs depend on them.

## Measurements
| Circuit | BLIF bytes | Binary bytes | Latches | Status |
|---|---:|---:|---:|---|
| auction_controller | 38324 | 50568 | 98 | BLOCKED |
| multiply32_serial | 17392 | 24622 | 104 | Fits |
| refund64 | 11108 | 16597 | 0 | Fits |

Only fitting artifacts are emitted into <repository>\circuits\stateful. Manifest includes all three measurements and explicitly records failure of the overall target. Binary byte counts do not mean hex text length.

## Behavior
Controller preserves reset priority, enable/hold, terminal lock, malformed-head handling, uint64 overflow behavior and all outputs cycle-for-cycle. Quantity differences are reused and adder carry logic is reorganized; all 98 baseline state bits remain.

Multiplier uses a 32-bit multiplicand register and a combined 64-bit product register. Each enabled busy tick adds into the upper half and shifts. A counter and busy/done latches control 32 iterations in the circuit; JavaScript performs no partial-product combination. There are 104 latches instead of the baseline's 168. Start/reset/enable and busy/done behavior remain. IMPORTANT: product during busy and immediately after start is NOT the baseline accumulator value. Product is valid only when done=1. Final uint64 multiplication is unchanged. This is a documented interface timing change, not full output equivalence during busy.

Refund retains all 64-bit inputs/outputs, underflow and clamp-to-zero behavior.

## Verification
12 tests pass across the project, including 3 new stateful tests. Controller compares baseline/source/compiled outputs and latch state for 1200 arbitrary-state vectors. Multiplier tests full-width edge/random operands, pauses, ignored start while busy, reset, restart and 32-tick completion against baseline. Refund compares 400 full-width vectors. Finite testing is not a formal proof.

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
npm run generate:stateful
node --test test/stateful.test.mjs
npm run check:stateful
```

check:stateful deliberately exits 1 until ALL circuits fit. npm run verify passing does NOT prove the new controller fits; it checks the existing modular artifacts and all behavioral tests.

## Remaining work
The controller needs further architecture work (e.g. a circuit-internal multi-cycle datapath/FSM with a documented request/response protocol) to fit both limits. Any change of cycle count must be checked against the baseline at completed transaction boundaries, including reset/interrupt/overflow. Do not split state into a JavaScript controller to meet the limit. Do not claim multiple independent deployments connect themselves.

Live canvas import, persistent on-chain execution and custody remain unverified. The original backup itself used a trusted order feeder: preserving its hardware logic does not magically move order-book storage, sorting, identity or fees into hardware. Those are distinct extensions.
