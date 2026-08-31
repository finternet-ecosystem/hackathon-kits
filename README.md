<div align="center">

<table>
  <tr>
    <td align="center">
      <a href="https://networksforhumanity.org/">
        <img src="./docs/nfh.svg" alt="Networks for Humanity" height="32" />
      </a>
    </td>
    <td align="center">
      <a href="https://vouch.finance/">
        <img src="./docs/vouch.svg" alt="Vouch" height="32" />
      </a>
    </td>
  </tr>
</table>

<h1>Vouch Hackathon Kits</h1>

<p>
  <a href="https://cdir-portal.vouch.finance">Developer Portal</a>
  ·
  <a href="https://vouch.finance/">vouch.finance</a>
  ·
  <a href="https://networksforhumanity.org/">networksforhumanity.org</a>
</p>

</div>

Four self-contained sandbox kits for building supervisory agents on [Vouch](https://vouch.finance/). Each kit provisions a real program (policy, merchants, actors, Hooks) and replays a scripted transaction stream against a live backend.

This repo is a **pure HTTP client**. It needs only Node, your test-mode hackathon API key, and network access to the API. No database, Redis, or cluster credentials.

---

## Quickstart

1. In the [Developer Portal](https://cdir-portal.vouch.finance), open [**Hackathon**](https://cdir-portal.vouch.finance/hackathon) and, under **Enable Hackathon API**, click **Create hackathon key**. Copy the `sk_test_…` key (shown once).
2. Clone [this repo](https://github.com/finternet-ecosystem/hackathon-kits):

```bash
git clone https://github.com/finternet-ecosystem/hackathon-kits.git
cd hackathon-kits
```

Then:

```bash
cp .env.example .env
# Edit .env: paste HACKATHON_ORG_API_KEY; set API_BASE_URL from organizers
#   API_BASE_URL=https://cdir.vouch.finance/api/v1
# Local backend: API_BASE_URL=http://localhost:9393/api/v1

npm install
set -a && source .env && set +a

npx tsx seed-kit.ts --kit=agent-mandate
npx tsx run-stream.ts --kit=agent-mandate --speed=60
```

`seed-kit.ts` is idempotent. Re-running against an already-seeded org reprints the summary and creates nothing new.

Want a clean slate instead of reusing what's already seeded for your org? Add `--fresh`:

```bash
npx tsx seed-kit.ts --kit=agent-mandate --fresh
```

This creates a brand-new, fully isolated program (its own merchants, actors, Hooks) instead of reusing the one already seeded for your org — useful once you've been experimenting and want a fresh start. `run-stream.ts` automatically follows the new program, no flags needed. Arena needs the label explicitly: pass `--fresh-label=<label>` (the label `seed-kit.ts` prints) to `engine.ts`.

Want a measurable score instead of just watching the allow/deny stream? Point [**Arena**](arena/README.md) at the same org:

```bash
cd arena && npm install
npx tsx src/engine.ts --scenario=scenarios/agent-mandate-week.yaml --org=<orgId> --api-key=$HACKATHON_ORG_API_KEY --speed=60
npx tsx src/scorer.ts --run-id=<runId> --out=report.md
```

This is steps 4–5 of the full flow (enable → seed → run → **Arena** → **score**): Arena replays a scripted mix of compliant and malicious "personas" against your seeded org, and `scorer.ts` grades a supervisory agent's flagged detections against ground truth (precision / recall / latency-to-detection). See [`arena/README.md`](arena/README.md) for the flags API and full details. Today only Kit 1 (`agent-mandate`) has a scenario.

---

## Prerequisites

| Need | Detail |
|------|--------|
| **Node.js 20+** and `npm` | See `package.json` `engines` |
| **Hackathon org API key** | Portal → **Enable Hackathon API**. Test-mode key on a **dedicated** hackathon org (not your normal portal org). Kits call `GET /hackathon/orgs/self` and refuse non-hackathon orgs. |
| **API base URL** | Shared sandbox: `https://cdir.vouch.finance/api/v1`. Local: `http://localhost:9393/api/v1`. |

Organizer batch mint (`POST /hackathon/orgs` + admin key) exists for event ops only. Participants should use self-serve Enable.

Environment variables (also in [`.env.example`](.env.example)):

```bash
export HACKATHON_ORG_API_KEY=sk_test_YOUR_HACKATHON_KEY
export API_BASE_URL=https://cdir.vouch.finance/api/v1
```

Flags `--api-key=` and `--base-url=` override env on any command.

---

## Kits

| Kit id | Scenario | What it demonstrates |
|--------|-------|----------------------|
| [`agent-mandate`](kits/agent-mandate/README.md) | Agent Spending Mandate | Parent + sub-agent mandates; per-tx cap, merchant/category allowlists, hours, velocity, delegation overspend |
| [`kya-licence`](kits/kya-licence/README.md) | KY-A Licence | Mandate lifecycle: revoke, post-revoke reuse, delegation-depth abuse, ledger re-verify |
| [`embedded-supervision`](kits/embedded-supervision/README.md) | Embedded Supervision | On-chain mint path (when contracts configured) + payment stream; [`watch-chain.ts`](#watch-chaints) |
| [`disbursement-integrity`](kits/disbursement-integrity/README.md) | Disbursement Integrity | Loose policy + mule pattern; propose → approve → rerun tighten loop |

Each kit README covers seeded world, scenarios, MCP calls, build ideas, and kit-specific limits.

---

## Commands

All commands run from this repo root.

### Seed

```bash
npx tsx seed-kit.ts --kit=<id> [--api-key=<key>] [--base-url=<url>]
# or: npm run seed -- --kit=agent-mandate
```

1. Asserts hackathon org via `GET /hackathon/orgs/self`.
2. Creates program, policy, merchants, Hooks, enrolments / AI vouchers from `kits/<id>.json`.
3. Writes `artifacts/kits/<kitId>-<orgId>.json` for `run-stream.ts`.

### Replay

```bash
npx tsx run-stream.ts --kit=<id> [--speed=60] [--run-id=<id>] [--only=<type>] [--after-tighten]
```

Expands scenario templates, calls real `/payments/*` or AI voucher lifecycle routes, writes `artifacts/runs/<runId>/labels.jsonl`. Labels are the **scripted** ground truth (`violation` / `compliant`), not a copy of the platform’s HTTP status. Use `--after-tighten` after a mid-demo policy change (Kit 4) so mismatches against the original manifest are not treated as failures.

### watch-chain.ts

Companion for **embedded-supervision**. Tails Factory + Treasury events over an RPC (Amoy or local Hardhat).

```bash
# Resolve addresses from a seeded kit (GET /programs/<slug> → programContracts)
npx tsx watch-chain.ts --kit=embedded-supervision --org=<orgId>

# Or pass addresses explicitly
npx tsx watch-chain.ts \
  --factory=0x... \
  --treasury=0x... \
  --rpc-url=http://127.0.0.1:8545
```

`--kit`/`--org` needs an API key (`--api-key` or `$HACKATHON_ORG_API_KEY`). Explicit `--factory`/`--treasury` win over the resolved pair.

Default RPC: `$RPC_URL` or `http://127.0.0.1:8545`.

### approve-proposal.ts

Companion for **disbursement-integrity**. Approves a proposal created by `POST /proposals`, closing the propose → approve → rerun loop.

```bash
export VOUCH_PORTAL_TOKEN=<portal session token>
npx tsx approve-proposal.ts --proposal-id=<id>
# or: npm run approve -- --proposal-id=<id>
```

Approving needs a different actor than the proposer, so this uses your portal session token rather than the hackathon API key. See [Kit 4's README](kits/disbursement-integrity/README.md#rerun-after-tighten).

---

## Programmatic usage

The CLI scripts are thin wrappers. Import their exports from your own TypeScript (or copy `lib/` into a hackathon project).

### Data flow

| Step | Input | Output |
|------|-------|--------|
| Seed | `kits/<id>.json` + API key | Live program on the platform |
| State sidecar | Written by seed | `artifacts/kits/<kitId>-<orgId>.json` |
| Replay / custom code | Manifest + state sidecar | Real allow/deny decisions |
| Labels | Written by replay | `artifacts/runs/<runId>/labels.jsonl` (scripted ground truth) |

Manifest refs like `child-1` and `m11` are stable. Real platform ids come from the state sidecar after seed.

### Import seed and replay

```typescript
import { seedKit } from "./seed-kit";
import { runStream } from "./run-stream";
import { readLabels } from "./lib/labels";

const apiKey = process.env.HACKATHON_ORG_API_KEY!;
const baseUrl = process.env.API_BASE_URL!;

await seedKit({ kit: "agent-mandate", apiKey, baseUrl, help: false });

const { outcomes, labelsPath } = await runStream({
  kit: "agent-mandate",
  apiKey,
  baseUrl,
  speed: 6000,
  runId: "my-eval-1",
  afterTighten: false,
  help: false,
});

const labels = readLabels("my-eval-1");
// Compare outcomes[i].allowed against labels for precision/recall scoring.
```

`seedKit` is idempotent. If the program already exists for your org, it no-ops and reuses the existing world.

Integration tests in `__tests__/stream-runner.integration.test.ts` follow this pattern.

### Read state and call the API directly

After seeding, load the sidecar and drive payments yourself:

```typescript
import { KitApiClient } from "./lib/client";
import { readKitState } from "./lib/state";
import { assertHackathonOrg } from "./lib/org-guard";

const client = new KitApiClient({ baseUrl, apiKey });
const org = await assertHackathonOrg(client);
const state = readKitState("agent-mandate", org.id)!;

const actor = state.actors.find((a) => a.ref === "child-1")!;
const merchant = state.merchants.find((m) => m.ref === "m1")!;

const { intentId } = await client.post("/payments/intents", {
  merchantId: merchant.id,
  programId: state.programId,
  items: [{ sku: "PEN-001", name: "Pens", categoryCode: "OFFICE", qty: 1, unitPrice: 50 }],
});

await client.post("/payments/quote", { intentId }, {
  "x-privy-user-id": actor.privyUserId,
  "x-sim-time": "2026-08-04T10:00:00.000Z",
});

await client.post("/payments/authorize", { intentId }, {
  "x-privy-user-id": actor.privyUserId,
});
```

Payment scenarios need `actor.privyUserId` (self-enrol actors only). Mandate lifecycle routes use `state.actors[].mandateId`.

### Expand scenarios without full replay

Manifests define scenario **templates** (`violationScript`), not literal transaction rows. Expand them for targeted eval:

```typescript
import { loadManifest } from "./seed-kit";
import { expandScenarios } from "./lib/expand-scenarios";

const manifest = loadManifest("agent-mandate");
const instances = expandScenarios(manifest.violationScript, "agent-mandate:my-org:eval-1");

const structuring = instances.filter((i) => i.violationType === "split_payment_structuring");
```

Each instance carries `actorRef`, `merchantRef`, `item`, `violationType`, `simHourOfWeek`, and related fields.

### Common build patterns

| Goal | Approach |
|------|----------|
| Explain-before-spend agent | MCP `simulate_policy` or REST, then authorize only if allowed |
| Anomaly detector | `runStream` + compare `outcomes[].allowed` vs `labels.jsonl` |
| Mandate supervisor | Poll `GET /ai-vouchers/:id/ledger` using ids from state sidecar |
| On-chain supervisor (Kit 3) | Seed, then `watch-chain.ts --kit/--org` (it resolves contract addresses itself) |
| Policy tighten loop (Kit 4) | Detect mule pattern, `POST /proposals`, rerun with `--after-tighten` |

### Common pitfalls

| Pitfall | Symptom | Workaround |
|---------|---------|------------|
| **Replay before seed** | `No seeded state found for kit "…" / org "…"` | Call `seedKit` first with the **same** API key you pass to `runStream`. |
| **API key and state file mismatch** | State sidecar missing or wrong actors/merchants | State path is `artifacts/kits/<kitId>-<orgId>.json`. Resolve org via `assertHackathonOrg(client)` and pass that org's key everywhere. |
| **Deleted `artifacts/` after seed** | Seed no-ops (program exists) but replay fails | Idempotent seed does not rewrite a missing sidecar. Use a fresh hackathon org, or rebuild ids from the API (`GET /programs`, enrol records, etc.). |
| **Treating labels as platform verdicts** | Eval scores look wrong even when the rule engine behaved correctly | `labels.jsonl` is **scripted ground truth** (was this scenario meant to be a violation attempt?). Match on `txnRef` and compare to `outcomes[].allowed` for detection accuracy. |
| **Indexing labels against all outcomes** | Off-by-one or missing rows in eval | Only `kind:"payment"` scenarios write labels. `mandate_op` steps appear in `outcomes` but not in `labels.jsonl`. Filter `outcomes` to `kind === "payment"` before comparing counts. |
| **403 treated as a crash** | `KitApiError` on quote/authorize | Expected for violation scenarios. Use `requestExpectingEither` from `lib/client.ts` (as `run-stream.ts` does) instead of bare `client.post`. |
| **HTTP 200 treated as "allowed"** | A fully-ineligible cart (e.g. out-of-category) authorizes a $0 payment instead of denying | `/payments/quote` and `/payments/authorize` report eligibility in the response **body** (`canProceed`, `reason`), not via HTTP status — a fully-ineligible cart still returns 200 OK. Check `quoteRes.data.canProceed` before treating a 200 as a real allow, as `run-stream.ts`/`arena/src/engine.ts` now do. |
| **Missing payment headers** | Quote fails or wrong allow/deny for hour rules | Send `x-privy-user-id` (from state sidecar) and `x-sim-time` (ISO timestamp) on quote **and** authorize. |
| **CHW actor in a payment flow** | `Actor "…" has no privyUserId` | `enrolMode:"chw"` actors mint on-chain but cannot quote. Use self-enrol actors (`privyUserId` set) for `/payments/*`. Kit 3 splits these on purpose. |
| **Wrong program slug** | `404` on `/programs/<slug>` | Slugs include an org suffix. Read `state.programSlug` from the sidecar; do not guess from the kit id alone. |
| **Policy changed mid-run** | `✖ MISMATCH` in replay summary | After Kit 4 tighten (or any live policy edit), rerun with `afterTighten: true` so old `expectAllowed` checks are skipped. |
| **Velocity denials from a stale program** | Structuring/compliant scenarios deny unexpectedly, or results differ run to run | Rate-limit Hooks now window on `X-Sim-Time` (see `ISSUES.md` #7 — live on the hackathon backend, upstream `poshan-voucher-stack` PR still pending merge to its own `main` as a separate paper trail), so a fast `--speed` replay no longer self-trips the gate ahead of the rule a scenario is meant to exercise. It still reuses the **same fixed reference week** on every replay of a kit, so repeated runs against the same (non-`--fresh`) program can stack transactions into the same simulated velocity window and inherit denial history from the last run. `run-stream.ts` logs the program's `seededAt` on every run — re-seed with `seed-kit.ts --kit=<id> --fresh` before any run whose results you intend to score. |
| **SSE-only supervision** | Agent never sees denials | Quote-time Hook denials may not appear on SSE or webhooks. Use MCP `get_audit_trail`, REST audits, or `labels.jsonl`. See [Limitations](#limitations). |
| **Import from outside repo root** | `artifacts/` not found | Sidecar paths are relative to this repo. Run from the clone root, or copy `lib/` and pass absolute paths if you vendor the helpers. |

This repo is not published to npm (`"private": true`). Clone and import from source, or vendor `lib/`.

---

## MCP

Point Claude Desktop, Claude Code, or any JSON-RPC MCP client at the platform MCP endpoint with the **same** hackathon key:

```http
POST https://cdir.vouch.finance/mcp
x-api-key: sk_test_YOUR_HACKATHON_KEY
Content-Type: application/json
Accept: application/json, text/event-stream
```

`Accept` must list both values or you get `406` (JSON-RPC `-32000`). That is the most common first-request failure.

Tool catalog and envelopes live in the Developer Portal under **Hackathon → MCP Tool Catalog** and **Request/Response Lifecycle**. Useful starters: `list_programs`, `simulate_policy`, `issue_agent_mandate`, `get_mandate_ledger`, `get_audit_trail`.

Note: `propose_rule` still targets a legacy draft endpoint. For a HITL-visible proposal, call `POST /proposals` over REST (see [disbursement-integrity](kits/disbursement-integrity/README.md)).

---

## Limitations

Honest platform behavior these kits run into:

| Topic | What to expect |
|-------|----------------|
| **SSE / webhook denials** | Hooks deny at `/payments/quote` the same as authorize, but quote-time denials do **not** emit `payment.declined`. SSE (`GET /events/stream`) and webhooks often show authorized events only. Decisions still appear in audit APIs. Score kits with `labels.jsonl` + audits, not the live denial stream alone. |
| **Velocity Hooks** | Rate limits window on `X-Sim-Time` when present (see `ISSUES.md` #7 — live on the hackathon backend; previously wall-clock-only). A high `--speed` no longer self-trips the gate within one run, but repeated runs against the same non-`--fresh` program still share the kit's fixed simulated reference week, so run history can carry over. Re-seed with `--fresh` before a run you intend to score. |
| **No program reset** | There is still no public “wipe program” API. `seed-kit.ts --kit=<id> --fresh` (or `--fresh=<label>`) self-serves a clean world: it creates a brand-new, isolated program under a label-suffixed slug instead of reusing the deterministic one for your org. It does **not** delete anything — the old program's merchants and actors still exist on the platform, just orphaned. `run-stream.ts`/`watch-chain.ts` follow the new program automatically; Arena needs `--fresh-label=<label>` to match. `rotate` remints the key on the same org; it does not clear programs. |
| **Kit 3 chain ops** | Real on-chain mint needs contracts configured on the shared backend. Without them, CHW enrol falls back to off-chain enrollment. CHW-enrolled actors cannot run `/payments/quote`. The kit splits actors: mint vs payment stream. |
| **watch-chain flags** | `--kit`/`--org` resolves the addresses via `GET /programs/:slug`, so it needs an API key and a program whose contracts are deployed. Pass `--factory`/`--treasury` explicitly if you deployed them yourself. |
| **Phone format** | Self-enrol accepts a narrow phone shape; synthetics use `9999…` numbers. |
| **Second actor for Kit 4 approve** | Approving a proposal needs a different actor than the one who proposed it — your `program_manager` API key can propose but can't approve its own proposal. You don't need a second key or organizer help: **Enable Hackathon API** also makes you an `org_owner` member of the org, so approve with `approve-proposal.ts` and your portal session token instead of your API key. See [Kit 4's README](kits/disbursement-integrity/README.md#rerun-after-tighten). |
| **Arena** | The eval harness referenced in some hackathon materials ("point Arena at the org") lives in this repo at [`arena/`](arena/README.md) — see the Quickstart above for steps 4–5. Only the `agent-mandate` (Kit 1) scenario is shipped today; the `llm-adversary` persona and the `scorer.ts --baseline` comparison mode are unfinished (see `arena/README.md` "Known limitations"). |

Per-kit READMEs expand on track-specific caveats.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Org-guard / “not a hackathon org” | Wrong key (primary portal org, live key, or revoked) | Re-Enable (or Rotate) on `/hackathon`; confirm `sk_test_` and `API_BASE_URL` |
| `401` on every call | Bad or rotated key | Paste the latest key into `.env` |
| `403` on `/ai-vouchers/*` | Stale deployment missing scopes | Use a freshly Enabled key; tell organizers if scopes are old |
| MCP `406` / `-32000` | Missing `Accept` header | Send `Accept: application/json, text/event-stream` |
| Few/no `payment.declined` on SSE | Quote-time denials may not emit SSE events | Use MCP `get_audit_trail`, REST audits, or kit labels |
| Seed no-op but empty world expected | Idempotent seed | New org, or different kit id |
| Kit 3 no chain events | Contracts or RPC not configured | Ask organizers, or pass correct `--rpc-url` and contract addresses from `GET /programs/:slug` |
| Kit 4 approve `403` | API key can't approve its own proposal | Approve with your portal session token: `npx tsx approve-proposal.ts --proposal-id=<id>` with `VOUCH_PORTAL_TOKEN` set. No organizer help needed. |

---

## How seeding and replay work

**Seed** resolves the org from your API key, loads `kits/<id>.json`, and creates resources over the public API (`/programs`, `/policy`, `/merchants/register`, `/hooks`, enrol / `/ai-vouchers`). State is written under `artifacts/` (gitignored).

**Replay** expands templates (`lib/expand-scenarios.ts`) with deterministic jitter (`lib/rng.ts`), sends `X-Sim-Time` for business-hours style rules, and paces real HTTP with `--speed`. Payment scenarios use intent → quote → authorize. Mandate scenarios hit AI voucher lifecycle routes.

Manifest fields stay close to API bodies: `program`, `policy`, `merchants`, `actors`, `hooks`, `violationScript`, and Kit 4’s `tightenedRule`. See `lib/manifest-types.ts`.

---

## Architecture (API-key only)

`lib/client.ts` is the only network path for seed/replay. The org-guard (`lib/org-guard.ts`) uses `GET /hackathon/orgs/self` with that same key. Orgs marked via portal **Enable** or organizer `POST /hackathon/orgs` both pass.

---

## Directory layout

```
.
├── seed-kit.ts / run-stream.ts / watch-chain.ts / approve-proposal.ts
├── docs/                 # vouch.svg, nfh.svg
├── kits/                 # manifests + per-kit READMEs
├── lib/                  # client, org-guard, expand, state, labels, …
├── arena/                # scoring harness: personas, scorer, flags API — see arena/README.md
├── __tests__/
├── .env.example
├── package.json
└── artifacts/            # gitignored run output
```

---

## Testing

```bash
npm test                 # unit (manifest schema, org-guard); no live backend
npm run test:integration # needs live API + HACKATHON_ADMIN_KEY; otherwise skips
```

---

## License

Licensed under [MIT](LICENSE). [Vouch](https://vouch.finance/) is a global initiative by [Networks for Humanity](https://networksforhumanity.org/).

---