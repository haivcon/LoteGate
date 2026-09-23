# LotGate — Batch Auction Engine

LotGate targets a batch auction engine, not a circuit demonstration. BatchEngine manages the admitted book and produces verified allocation/payment instructions. Actual asset settlement is separate and NOT implemented by this API.

Implementation: <repository>\src\batch-engine.mjs
CLI: <repository>\scripts\batch.mjs
Tests: <repository>\test\batch-engine.test.mjs

## Market rules v1

Positive uint32 price/quantity, integer ticks/lots only. Buy price descending, sell price ascending; ties follow successful admission order. Caller-supplied priority is discarded. Partial fills allowed. Stop at a missing side or non-crossing prices. Uniform price is the highest matched ask (zero for no trades). Seller fee is floor(gross * feeBps / 10000) per order; 0..1000 bps. Default capacity 64, configurable 1..256. single-seller requires exactly one sell order at lock, and is not a second-price auction.

No per-order amendments/cancellation in v1. An entire OPEN batch can be cancelled. No reset or reopening after lock. These are retained project rules, not a claim of incentive compatibility. The eventual service/contract must authenticate admission order/completeness; sorting does not prevent an operator from omitting or reordering submissions before intake.

## Lifecycle API

OPEN -> LOCKED -> EXECUTING -> COMPLETED -> FINALIZED

OPEN -> CANCELLED

Runtime, execution-bound or final-verification failures -> FAILED (terminal).

- submit(order, revision): normalize and admit an order; reject duplicates/capacity violations without changing revision.
- lock(revision): freeze the book/rules, create a fresh circuit Session and compute commitment. Invalid intake requirements leave OPEN; backend construction failure is terminal.
- advance(maxSteps, revision): execute controller requests, NOT individual latch clocks. Per-call limit is maxOrders+1; whole-batch limit is admittedOrders+1 requests.
- finalize(revision): compute circuit-backed payments, verify with the independent oracle and cache a receipt. Only one successful finalization.
- receipt(): detached result copy, without circuit re-execution.
- cancel(revision): terminal cancellation before lock only; no refund transfer because this engine holds no assets.
- snapshot(): detached lifecycle/config/book/progress/revision copy.

Every mutation requires the exact current integer revision. Success and terminal runtime failure increment revision; invalid input/state does not. Private fields and detached copies prevent ordinary API callers from mutating the active Session. This is an in-process boundary, not security against a compromised host or malicious runtime.

## Backend and receipts

Explicit synchronous runtime.createController is required; there is no silent fallback. CLI uses the published serial binaries with hash checks and isolated machines. Existing circuit FSM/arithmetic are unchanged. Host still sorts/selects, records allocations and calculates fees. Oracle recomputation validates results; it is not an on-chain proof.

Commitment is SHA-256 of JSON {domain:'LotGate/batch/v1', id, config, orders} using normalized data and decimal strings for BigInt. Result hash binds the commitment and verified result under LotGate/result/v1. These local hashes are NOT signatures or circuit-identity proofs. Receipts state verification=LOCAL_ORACLE and settlement=NOT_EXECUTED. FINALIZED means calculation is final, not that funds moved.

## Run

```powershell
Set-Location '<repository>'
$env:TAPEOUT_PARSER='<reviewed-parser-path>'
npm run batch -- '<repository>\examples\batch.json'
npm run verify
npm run check:serial
```

Input JSON: id, optional config, orders. Decimal strings are recommended for integer serialization. Output BigInt values become decimal strings. No RPC, wallet signing, deployment or token transfers occur.

## Production requirements still outstanding

1. Verify chosen chain/CPU source/ABI, bit/latch ordering and limits; test a known latch circuit, then LotGate.
2. Authenticate admission, ownership, balances, asset pair/units, deadlines and order priority/completeness.
3. Durable transactional storage/recovery. Current engine is memory-only; restart loses state. IDs are not globally reserved; revisions cannot prevent replay in another process.
4. Bind on-chain session state to chain/CPU/circuit identity/orders/config; validate transitions and persist replay nonces and authorization.
5. Custody and exactly-once settlement, safe withdrawals and abort/refund policy. A JSON receipt/hash must never authorize transfers by itself.
6. Measure gas/latency and audit before real funds. AuctionSandbox.sol remains TEST ONLY with virtual credits, not this engine's settlement contract.

Browser/default legacy Session remain unchanged. BatchEngine and batch CLI expose the new lifecycle; an authenticated network service and on-chain settlement remain to be built.
