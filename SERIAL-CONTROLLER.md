# Serial controller candidates

All three circuit candidates fit the strict 34,000-byte BLIF AND decoded binary limits using the checksum-pinned, unchanged parser. This is not a deployment claim. The default Session/UI remains the modular implementation.

| Circuit | BLIF bytes | Binary bytes | Latches |
|---|---:|---:|---:|
| auction_controller_serial | 33693 | 33312 | 243 |
| multiply32_serial | 17392 | 24622 | 104 |
| refund64 | 11108 | 16597 | 0 |

Controller headroom is only 307 BLIF / 688 binary bytes: further changes must rerun budget checks.

## Architecture and handshake

The controller captures four uint32 operands and validity bits. A circuit-internal two-bit FSM runs 32 bit-serial price/quantity comparison clocks, 64 volume-add/remainder-subtract clocks, then one commit clock. The price comparison register is reused to hold the original minimum quantity. Carry, borrow, phase, count, operands and auction state are all latches. No REF or JavaScript arithmetic/control selects these operations.

- Assert start=1 and enable=1 while busy=0 and done=0 to capture a request.
- Supply 97 further enabled clocks. Input changes and start are ignored during busy.
- enable=0 holds all latch state. reset has priority and clears all state, including a pending request and accumulated auction state.
- resultValid remains high after completion until the next accepted request or reset.
- done means the auction is terminal, NOT that a request finished. Once done, no request is accepted until reset.
- All business outputs are meaningful ONLY when resultValid=1. Volume is rotated/updated in place during busy; there is no separately observable atomic committed snapshot during processing.
- The source/compiled tick simulators sample outputs before applying a clock edge. After the 97th work tick, sample once with enable=0 to observe resultValid and the registered outputs. This is not another work clock.
- A new request can be captured on a later enabled clock after observing the previous result. Holding start high can accept another request when idle; feeders should pulse start.

Completed request outputs match the original controller, including its perhaps surprising overflow behavior: volume wraps modulo 2^64, price/fill/remainders still update, and done/error are raised. Errors are sticky. Missing sides, non-crossing prices, malformed orders and terminal lock follow the backup. Widths remain 32-bit operands and 64-bit volume.

Multiplier retains the prior redesign's protocol (32 enabled work clocks; intermediate product differs from backup; final product valid when done). Refund is combinational. These artifacts are independent circuits, not an automatically interconnected settlement engine.

## Reproduction

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
npm run generate:serial
npm run check:serial
npm run verify
```

Artifacts: <repository>\circuits\serial

Each candidate has a .blif and actual binary .bin (not hexadecimal text). The manifest pins the parser, hashes both files, records byte counts and ordered port/pin mappings (LSB first).

Tests: <repository>\test\serial-controller.test.mjs

They compare source and compiled output/state on every simulated clock, and compare completed transactions against the backup: arbitrary initial uint64 totals, overflow, malformed/missing orders, crossing/non-crossing, equal quantities, input disturbance, pauses, terminal lock, consecutive accumulation, and reset in all phases. Finite regression is not formal equivalence or live-chain validation.

Prior single-cycle controller experiments and their deliberately failing budget check remain intact. Use check:serial for this candidate set. A tested opt-in local Session adapter now exists; the default backend and UI remain modular. Remaining work is a verified target-CPU adapter and authenticated session-state management, not an assumed block-driven persistent clock. Host-fed order selection/sorting/fees in the original design are not moved into hardware by this redesign. See <repository>\README.md for the TapeOut protocol comparison and <repository>\SERIAL-INTEGRATION.md for execution boundaries.
