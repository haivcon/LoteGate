# LotGate operating model

## Supported use case

A single trusted operator runs a periodic batch for one homogeneous item and one quote unit. All participants agree those units outside the application. Quantities and prices are integer atomic units; decimal conversion is not provided. The operator enters the orders, closes intake, runs the batch, exports a receipt, and arranges any actual delivery/payment externally. No customer assets are held by LotGate.

This is a target operating model, not a claim of existing customers or demonstrated commercial demand.

## Published rules

- Buy limits descend; sell limits ascend. Equal limits preserve intake order.
- Match only when the current buy limit is at least the current sell limit.
- Fill the smaller remaining quantity. Continue until one side is empty or limits no longer cross.
- Uniform price is the limit of the final matched seller; zero for zero volume.
- Seller fee is floor(gross × feeBps / 10000), per order. Seller limits refer to gross price before fees, not net proceeds.
- Both quantities and quote obligations must conserve. Every filled buy limit must be at least the uniform price; every filled sell limit must be at most that price.

Because filled buy limits are nonincreasing and filled sell limits are nondecreasing, the last matched seller price cannot exceed any previously filled buy limit. This is an invariant of this ordering, not a claim of strategy-proofness or resistance to order withholding.

## Trust boundary

The operator controls order admission, ordering among equal-priced incoming orders, and backend state. A receipt does not prove that omitted orders never existed. Input/result hashes detect inconsistent changes but can be recomputed by an attacker; they are not signatures or on-chain commitments. CPU eth_call does not persist auction state or transfer assets.

## Independent receipt check

From the project root:

```powershell
node scripts/verify-receipt.mjs 'C:\absolute\path\to\exported-receipt.json'
```

This verifies the input commitment, result hash, arithmetic allocations and order priority. It does not certify RPC provenance or payment.

## Performance acceptance

```powershell
node scripts/benchmark-operator.mjs 2
node scripts/benchmark-operator.mjs 8
node scripts/benchmark-operator.mjs 64
```

Run sequentially, not concurrently with the same order count (report names are count-specific). Each run writes reports/operator-live-N.json and compares the complete CPU-driven result with the local implementation. RUNNING is not PASS. The tested workload uses equal quantities with crossing limits, not all possible worst cases. Set an acceptable duration for the actual operator before release; no SLA is established.

## Public-release blockers

Full browser regression of Operator, representative load/failure tests, secure HTTPS deployment, backup recovery rehearsal, authenticated intake if participants do not trust the operator, and circuit ABI/source provenance review. Do not describe this system as a trustless exchange or token settlement service.
