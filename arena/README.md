# Vouch Arena

A standalone package of continuously-running synthetic transacting agents
("personas": compliant and malicious) against a Vouch org, plus a scorer
that grades a team's supervisory agent (precision / recall /
latency-to-detection) against ground truth. This is the eval harness for
step 4 of the hackathon flow: seed a kit, run scenarios, point Arena at the
org, generate a scoring report.

**This is a pure HTTP client of the platform.** It has zero imports from the
Vouch backend's source — everything here talks to a running Vouch backend
over its public REST API using an org's own API key, the same way any
external team would. That's deliberate: this package must be runnable
standalone, and shippable to hackathon teams to run against their own org,
without a backend checkout.

## Quickstart

```bash
cd arena
npm install

# 1. Get a test-mode hackathon org key: Developer Portal → Enable Hackathon API
#    (organizer POST /hackathon/orgs is batch-only).

# 2. Seed Kit 1 from the repo root (one level up from arena/):
#      npx tsx ../seed-kit.ts --kit=agent-mandate

# 3. Run the reference scenario against it, compressed to a few minutes:
npx tsx src/engine.ts \
  --scenario=scenarios/track3-week.yaml \
  --org=<orgId> \
  --api-key=<key> \
  --speed=60

# Labels (ground truth) land at artifacts/runs/<runId>/labels.jsonl.
```

Run the flags API (so a team's supervisory agent can report detections):

```bash
ARENA_FLAGS_TOKENS='{"tok_yourteamtoken":"team-name"}' npx tsx src/flags-api.ts
# POST http://localhost:8787/flags  { runId, txnRef, violationType?, detectedAt }
# Authorization: Bearer tok_yourteamtoken
```

Score a team's flags against a run's ground truth:

```bash
npx tsx src/scorer.ts --run-id=<runId> --out=report.md
```

## Architecture

```
src/
  lib/
    rng.ts          deterministic seeded PRNG (mulberry32)
    identity.ts      deterministic actor privyUserId / program slug (see below)
    client.ts        thin HTTP client (real API calls only, never a DB write)
    sim-time.ts       hour-of-simulated-week -> X-Sim-Time ISO timestamp
    rate-limiter.ts   conservative self-throttling (<=20/min/org in continuous mode)
  personas/
    types.ts          shared Persona/PersonaAction/PersonaWorld types
    compliant-shopper.ts, limit-prober.ts, structurer.ts, category-drifter.ts,
    night-burster.ts, delegation-abuser.ts, colluder-ring.ts
    index.ts           persona registry
  labels.ts           ground-truth JSONL writer (same format as run-stream.ts's labels)
  scenario-schema.ts  YAML scenario schema + loader (zod)
  engine.ts           scheduler — one-shot replay + continuous drip modes
  flags-api.ts        HTTP endpoint teams POST detections to
  scorer.ts           precision/recall/latency-to-detection report
scenarios/
  track3-week.yaml    reference scenario for Kit 1 (Agent Spending Mandate)
test/                 node:test unit tests
```

### Personas

Every persona is a **pure function**: `(world, params, seedKey) ->
PersonaAction[]`. No I/O. Given the same `seedKey`, a persona always
produces the byte-identical transaction sequence and ground-truth labels
("ground truth by construction" — the label never depends on what the
platform actually decided). `src/engine.ts` is the only thing that executes
actions against the real API.

| Persona | Violation modeled |
|---|---|
| `compliant-shopper` | none (ground-truth-compliant control group) |
| `limit-prober` | `over_limit_probe` — binary-searches the per-tx amount cap |
| `structurer` | `structuring` — splits an over-limit total into under-limit tranches within minutes |
| `category-drifter` | `category_drift` — gradually shifts from in-policy to disallowed-category purchases |
| `night-burster` | `off_hours_burst` — tight burst of transactions outside business hours |
| `delegation-abuser` | `delegation_overspend` — a delegated actor keeps spending past its own budget |
| `colluder-ring` | `collusion_ring` — a cluster of actors all redeem at one merchant in a tight window (mule pattern) |

**`llm-adversary` (stretch persona, not built yet):** an optional LLM-driven
persona gated behind an `ANTHROPIC_API_KEY` was scoped but not implemented —
no such key was available in this environment at build time, so it was
skipped entirely rather than faked — see "Known limitations" below.

### Coupling to the kits repo

`lib/identity.ts` reimplements (does not import) the exact deterministic
formula the repo root's `lib/synthetic.ts` uses to derive a kit-seeded
actor's `x-privy-user-id` and program slug from `(kitId, orgId, actorRef)`.
This lets arena drive personas against a Kit-1-seeded org's REAL actors
using only public information (the kit id + org id + the actor refs a
scenario YAML declares — themselves copied from the kit manifest, which is
public/committed data) — no direct DB/file access, no dependency on
`run-stream.ts`'s local `artifacts/kits/*.json` sidecar file. **If
`lib/synthetic.ts` ever changes that formula, `lib/identity.ts` must be
updated to match**, or actor resolution will silently 404/fail against a
freshly-seeded org.

`src/labels.ts` matches the repo root's `lib/labels.ts` `labels.jsonl`
format exactly (`{txnRef, ts, label, violationType?, kitScenarioId}`) so a
`run-stream.ts`-produced labels file and an arena-produced one are drop-in
interchangeable for `scorer.ts`.

## Modes

- **one-shot** (default): runs every persona's generated actions once, then
  exits. Self-throttled to a conservative 300 requests/min (well under the
  platform's 600/min global limit).
- **continuous**: repeats the full persona cycle until `--duration` elapses.
  **Requires `--duration`** — arena refuses to start an unbounded run, so it
  can never be left running by accident. Self-throttled to <=20 requests/min
  per org, independent of and much stricter than the platform's own rate
  limit.

## Known limitations

- **`llm-adversary` persona**: not built — no `ANTHROPIC_API_KEY` in this
  environment at build time. The other 7 personas are fully scripted/
  deterministic and don't need one.
- **`scorer.ts --baseline`**: built and unit-tested against a hand-built
  fixture flags file, but has not been run end-to-end against a real
  reference-supervisor output, since no such reference supervisor has
  shipped yet. The comparison-table code path itself is exercised by
  `test/scorer.test.ts`.
- **Actor resolution requires the target org to already be seeded** with
  the scenario's kit (via `seed-kit.ts` at the repo root) — arena does not
  seed programs/policies/merchants itself; it only creates payment
  intents/quotes/authorizations against actors and merchants that already
  exist, so the stream exercises the real authorization path rather than
  writing ground truth directly.
- **Only `scenarios/track3-week.yaml` (Kit 1 / Agent Spending Mandate)
  ships today.** The scenario schema and all 7 personas are kit-agnostic —
  adding a scenario for `kya-licence`, `embedded-supervision`, or
  `disbursement-integrity` is a new YAML file, not new code — but only Kit
  1's has been written and end-to-end-verified so far.

## Tests

```bash
npm test
```

All personas, the rate limiter, the scenario schema, the labels writer, the
flags API, and the scorer's precision/recall math (against a hand-worked
fixture, not just "does it run") are unit-tested. See `test/*.test.ts`.
