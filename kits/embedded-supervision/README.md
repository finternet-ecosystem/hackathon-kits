# Kit: Embedded Supervision

Track kit for watching on-chain program activity and reconciling it with backend state.

## What gets seeded

```bash
npx tsx seed-kit.ts --kit=embedded-supervision
```

Creates “Supervised Nutrition Pilot” (`backingType: usdc_onchain`), 2 merchants, 4 beneficiaries:

| Actors | Enrolment | Role in the demo |
|--------|-----------|------------------|
| `b1`, `b2` | CHW `POST /programs/:slug/enrol` | Real on-chain mint when deployer + contracts are configured |
| `b3`, `b4` | Self-enrol | Payment stream (quote/authorize) even with no chain |

No single enrol route today both mints on-chain and sets `beneficiaryPrivyUserId` for payments. The split is intentional.

## Story

A supervisory agent watches treasury and factory events live and checks them against the backend ledger.

## Run (default: no local chain)

```bash
npx tsx seed-kit.ts --kit=embedded-supervision
npx tsx run-stream.ts --kit=embedded-supervision --speed=60
```

Without `DEPLOYER_PRIVATE_KEY` / contracts on the **backend**, `b1`/`b2` enrol DB-only. `b3`/`b4` still exercise payments.

Requires your portal Enable key and `API_BASE_URL` (root [README](../../README.md)).

## Run with a local chain (organizer / advanced)

This path needs a backend you control (Hardhat + MockUSDC + deployer in `backend/.env`). It is not required for the shared Vouch cloud sandbox.

1. Start Hardhat: `npx hardhat node`
2. Deploy USDC / set `RPC_URL`, `CHAIN_ID`, `DEPLOYER_PRIVATE_KEY`, `USDC_TOKEN_ADDRESS` on the backend; restart it
3. Seed again so `b1`/`b2` mint for real

**Nonce race:** on a live chain, enrol and background settlement may share one deployer wallet. Pause settlement while seeding, or expect occasional `NONCE_EXPIRED` and retry.

## Watching the chain

```bash
# Resolve addresses from the seeded kit and tail events
npx tsx watch-chain.ts --kit=embedded-supervision --org=<orgId> \
  --rpc-url=http://127.0.0.1:8545

# Or look the addresses up yourself and pass them
curl -s "$API_BASE_URL/programs/embedded-supervision-<org-suffix>" \
  -H "x-api-key: $HACKATHON_ORG_API_KEY" | jq .program.programContracts

npx tsx watch-chain.ts \
  --factory=<factoryAddress> \
  --treasury=<treasuryAddress> \
  --rpc-url=http://127.0.0.1:8545
```

With `--kit` / `--org` the script reads the state sidecar for the program slug and resolves `programContracts` from `GET /programs/:slug`, so it needs an API key (`--api-key` or `$HACKATHON_ORG_API_KEY`). If the program has no deployed contracts it says so; explicit `--factory` / `--treasury` always win.

Events: Factory `VoucherMinted` / `VoucherActivated` / redemption / expiry; Treasury `Deposited` / `Locked` / `Released` / `Reclaimed`.

## Demo moment

Terminal A: `watch-chain.ts`. Terminal B: seed with a live chain. Watch mint/activate events as enrolments land.

## Build ideas

1. Three-way reconciliation: DB voucher ↔ on-chain balance ↔ ledger entries.
2. Live mint table from `watch-chain` output.
3. Flag on-chain redemptions without a matching backend authorize audit.

## MCP calls

```
list_programs
get_program_stats / get_treasury
get_audit_trail
```

## Limitations

- The shared Vouch sandbox may not expose a writable chain to participants; treat on-chain mint as best-effort.
- Amoy reachability depends on your network; local Hardhat is the reliable verification path.
- Self-enrol never mints on-chain; CHW enrol can mint but cannot feed `/payments/quote` (missing Privy user id).
- Quote-time payment denials in the stream may not appear on SSE; use audits or `labels.jsonl`.
