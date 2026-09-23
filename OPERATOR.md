# LotGate Operator

The default `npm start` now runs the authenticated operator application. This release is computation-only: no custody, token transfer, wallet signature, or transaction broadcast.

## Start (PowerShell)

From `<repository>`:

```powershell
$env:LOTGATE_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
$env:LOTGATE_DATA = './data'
$env:XLAYER_RPC = 'https://tapeout.net/rpc-xlayer'
npm start
```

Open http://127.0.0.1:4173 and enter the token generated above (retrieve it from your shell with `$env:LOTGATE_TOKEN`; do not publish it). For public access, configure `LOTGATE_ORIGIN=https://your-domain`, put an HTTPS reverse proxy in front of loopback port 4173, and preserve the public Host header. Never transmit the access key over public HTTP. Use a secret manager and a supervised process in deployment. Runtime requires Node >=22; no additional runtime dependencies were added.

## Workflow and guarantees

Create a named batch, enter up to 64 integer orders, confirm immutable intake, explicitly start execution, inspect results, export JSON. Same-price orders retain admission priority. A single worker processes persisted jobs sequentially. The CPU identity, pinned block and netlist hashes accompany completed receipts; each batch checks the deployed bytes before executing. CPU-returned next-state feeds the next call. There is no local fallback. An independent arithmetic oracle checks the complete result before publication.

Authentication covers every API route; the access key is held in page memory, not localStorage. Origin checks, CSP, bounded JSON bodies and basic rate limiting are enabled. This is single-operator authorization, not individual accounts or signed order ownership.

Records are written through a synced temporary file followed by rename. Only one service writer may hold the data-directory lock. Queued work resumes on restart. Running work becomes INTERRUPTED and requires explicit retry from immutable input, rather than pretending to resume an unpersisted CPU state. RPC errors fail the batch; retries are operator initiated. Back up the entire data directory while the service is stopped. After a crash, confirm no service process still owns the directory before removing `service.lock`. Filesystem durability and rename semantics must be validated on the deployment storage.

## Operational limits / release gate

This is implemented software, not yet a certified production deployment. Before public release:

- Run npm run verify (no parser required); optionally rebuild/check serial artifacts with the reviewed parser. Full browser regression of the operator UI is still required.
- Complete live CPU-driven batches and representative 64-order load tests; record duration and RPC limits. A controller request uses approximately 100 sequential RPC calls, with additional multiplier calls per allocation. No completion SLA is established.
- Validate reverse proxy TLS, secrets handling, process supervision, backup restore, filesystem failure recovery and monitoring on the target host.
- Review CPU selectors/source provenance independently; returned bytes matching a netlist do not authenticate persistent state.
- Add stronger distributed rate limiting before internet exposure. The built-in limiter sees the reverse proxy address and is not a multi-user abuse defense.
- API batch creation accepts an optional `requestId` (16–100 ASCII letters, digits, underscores or hyphens). Reusing it with identical input returns the existing batch; different input is rejected. Clients must retain that key for retries. The current UI does not yet supply it. User account management, full audit logging and cancellation remain unimplemented. Revision checks prevent replayed run commands.

The application must not be represented as fully on-chain settlement or as ready to handle real deposits. Allocation fields quotePaid/quoteReceived are computed obligations, never proof that payment occurred.
