# Issues log

Tracks problems found while running these kits against the live shared
sandbox and CI, their status, and who owns the fix. Not a GitHub Issues
replacement — a working log so nothing found gets lost. File the "needs
platform team" ones as real issues against `poshan-voucher-stack` when
there's someone to triage them.

## Open — needs the platform team (`poshan-voucher-stack`)

### 1. `GET /merchants?programId=` does not filter by program

**Severity:** high — breaks any client that trusts this endpoint to be
scoped.

Verified live: the endpoint returns the exact same merchant list — every
merchant ever created for the org across every past `seed-kit.ts` run —
regardless of the `programId` query value, including a nonexistent bogus
id. Root-caused in `poshan-voucher-stack@feat/cdir-hackathon`,
`backend/src/api/merchants.ts:959-1002`: `includeGlobal` defaults `true`
and unconditionally OR's in every merchant with `programId: null`; most
historically-seeded merchants have a null `programId`
(`merchants.ts:864`), so that branch alone returns nearly the whole org.

Also tried `&includeGlobal=false` (the endpoint's own documented scoping
flag) as a fix — it returns **zero** merchants for the real `programId`
too, so whatever computes "assigned to this program" for that flag is
itself broken, not just the default.

**Workaround shipped here:** `arena/src/engine.ts`'s `resolveTarget()`
cross-checks `GET /programs/:slug/hooks` (reliably scoped by URL path),
which embeds the real merchant ids a program's counterparty-gate Hook
enforces — verified as ground truth across three kits (1, 3, and 10
merchant ids respectively). Falls back to a newest-match-by-name
heuristic only for merchants deliberately outside every Hook's allowlist
(e.g. the unapproved-counterparty test merchants).

### 2. `POST /payments/authorize` intermittently 500s, succeeds on identical retry

**Severity:** medium — recoverable client-side, but silently corrupts
scoring data if nothing retries.

Verified live: roughly 40-60% of first attempts on a freshly quoted
intent return `500 {"error":"Failed to authorize payment"}`; an
identical immediate retry of the same intent succeeds (`200 AUTHORIZED`).
Root-caused in `poshan-voucher-stack@feat/cdir-hackathon`,
`backend/src/api/payments.ts:591`: the Serializable `prisma.$transaction`
wrapping authorize has no explicit `timeout` (Prisma's interactive-
transaction default is ~5000ms), and inside it
`evaluateCartEligibility()` → `payment-policy.ts:176-189` opens a fresh
`ethers.JsonRpcProvider` per call against a public testnet RPC with no
timeout of its own — when that's slow, it blows the transaction's
budget, Prisma aborts, and the next `tx.*` call throws into a generic
catch → 500. There's already precedent for the fix elsewhere in that
codebase: `payment-intent.ts:97-105` sets `{ timeout: 15_000 }` on a
similarly RPC-adjacent transaction; that fix was never applied to
`authorize`.

**Workaround shipped here:** `lib/client.ts` and
`arena/src/lib/client.ts` retry `5xx` responses (and raw thrown `fetch`
network failures — same class of transient flakiness) up to twice with
backoff, before giving up. Never retries a `4xx` — a real policy decision
like a rate-limit `403` is not retried.

### 3. No public "wipe/delete program" API

**Severity:** low — self-serve workaround shipped, but the underlying gap
is real and reported to us by a team hitting it mid-hackathon.

There's no way to reset a seeded kit's program short of asking organizers
for a new org.

**Workaround shipped here:** `seed-kit.ts --kit=<id> --fresh[=<label>]`
creates a brand-new, isolated program instead of reusing the deterministic
one for a (kit, org) pair. Does not delete anything — the old program is
orphaned, not removed. See the README's "No program reset" row.

### 4. `POST /programs` enforces a `name` uniqueness constraint, undocumented

**Severity:** low — only surfaced because `--fresh` (above) needed a
second program per org+kit; caught during live reverification of that
feature, not a hackathon-day blocker on its own.

A second `POST /programs` with a different `slug` but the same computed
`name` (`"<program name> (<org name>)"`) 409s:
`{"error":"Program with name \"...\" already exists"}`. Undocumented
anywhere client-visible — the only signal is the 409 body.

**Workaround shipped here:** `seed-kit.ts` folds the `--fresh` label into
the program `name`, not just the `slug`.

### 7. Rate-limit (velocity) Hooks window on real wall-clock time, not `X-Sim-Time`

**Severity:** high — verified live: a full 52-transaction Kit 1 replay at
`--speed=60` (the speed this repo's own quickstart recommends) produced 38
total denials, of which 33 came from the velocity gate pre-empting the
rule each scenario was actually built to exercise, and 5 came from the
rule under test (`cart.total`). Every one of Kit 1's 6 fraud scenarios was
denied for the wrong reason at least once; 4 of 18 compliant (`expectAllowed:true`)
transactions were wrongly refused.

Root-caused in `poshan-voucher-stack@feat/cdir-hackathon`,
`backend/src/services/hook-engine.ts`'s Stage 3 rate-limit block: it
windows on `Date.now()` even though the platform already threads a
simulated-time source (`ctx.simulatedNow`, from `X-Sim-Time`, DEMO/test-mode
only) through to WHEN-rule evaluation a few lines away
(`buildContext({ now: ctx.simulatedNow })`). Because a fast `--speed`
replay compresses a simulated week of scripted pacing into real seconds,
and because a single actor is the `actorRef` for a large share of a kit's
script, the wall-clock window fires on realtime density that has nothing
to do with the scenario's scripted (simulated) spacing.

A second, non-obvious half of the same bug: `EvaluationAudit.createdAt`
is a Prisma `@default(now())` column, also real-clock, also never
consulted against `ctx.simulatedNow`. Windowing `checkVelocity`'s
`windowStart` on simulated time alone is not sufficient — the rows being
counted still carry a real-time `createdAt`, so `createdAt >= windowStart`
degenerates to "everything ever", or "nothing", depending on which side of
the kit's fixed reference week the real clock currently sits. Both sides
of the comparison need to agree on which clock they're using.

**Fix shipped and live-verified; upstream PR still pending merge:**
`backend/src/services/hook-engine.ts` (Stage 3 `windowStart`) and
`services/velocity.ts::checkVelocity` now take `ctx.simulatedNow`/`opts.now`;
`finalizeResult`'s `evaluationAudit.create` now stamps
`createdAt: ctx.simulatedNow ?? new Date()` instead of leaving it to the
Prisma default. Safe by construction — `simulatedNow` already falls back
to the real clock in live mode or with no `X-Sim-Time` header
(`middleware/sim-time.ts`), so this only changes behavior for DEMO/test-mode
replay traffic.

A follow-up fix closed a second gap the first one exposed: the window
query only ever had a lower bound (`createdAt >= windowStart`), never an
upper one. Harmless on a real clock (nothing can have a `createdAt` "in
the future" relative to a later query), but not once `createdAt` reflects
simulated time and a single replay run sends `X-Sim-Time` non-monotonically
— e.g. a kit scripts one scenario at simulated Thursday and a later
(in real execution order) scenario at simulated Monday, so that
Monday-anchored check's `gte`-only window still counted Thursday's rows.
Verified live: this was exactly why Kit 1's `out-of-hours-burst` scenario
kept getting denied by the velocity gate instead of the business-hours
rule it's built to test, even after the first fix landed. Fixed by adding
`lte: simulatedNow` alongside the existing `gte: windowStart` in both
places.

Both fixes are covered by tests in
`backend/src/services/__tests__/hook-engine-k4-k7.test.ts` (including a
stateful test reproducing the exact Thursday/Monday non-monotonic-replay
scenario, verified to fail honestly on a revert) and committed
(`96d605e`, `e154d2b`) and pushed to `poshan-voucher-stack@feat/cdir-hackathon`,
built and deployed to the hackathon backend
(`vouchcdirhackathon.azurecr.io/backend:cdir`), and live-verified end to
end via two full Kit 1 replays against the deployed service: 4/18
compliant transactions wrongly denied and ~1/6 fraud scenarios correctly
attributed → 0/18 wrongly denied and 6/6 correctly attributed. The
upstream PR (`poshan-voucher-stack#113`) that would bring this to `main`
is a separate, much larger existing PR (the whole hackathon workstream,
33 commits) and merging it is out of scope here — left for whoever owns
that PR.

Even after both fixes, repeated replay runs against the same (non-`--fresh`)
program still share the kit's one fixed reference week, so run-to-run
history can still accumulate — see `run-stream.ts`'s new `seededAt`
startup log and the README "Known platform limitations" table.

## Fixed in this repo

### 5. Arena's `compliant-shopper`/`category-drifter` could pick an unapproved-counterparty merchant

Both personas selected a merchant by category match alone
(`approvedCategories`), which doesn't distinguish "sells this category"
from "is on the counterparty allowlist" — a scenario can (and this one
does) include merchants that satisfy the former but are deliberately
excluded from the latter, to test unapproved-counterparty detection. Fixed
by adding an explicit `approvedCounterparty` field to the scenario schema.
Shipped in commit `4c2c92d`.

### 6. CI failing on `Arena Node 20.x` since the workflow was added — fixed, `#3`

`arena/package.json`'s `test` script passed `test/**/*.test.ts` to
`tsx --test`. Node 20's test runner doesn't reliably resolve that
recursive glob pattern when passed as a literal CLI argument (unexpanded
by bash, which has no `globstar` by default); Node 22.x/24.x do, which is
why only the 20.x leg failed while 22.x/24.x passed with the identical
script. Since 20 is this repo's declared minimum supported version
(`engines.node`), this is a real compatibility bug, not a fluke.

### 8. Arena's latency-to-detection metric diffed a real timestamp against a simulated one

`arena/src/scorer.ts:111` computed latency as `flag.detectedAt` (real
wall-clock) minus `label.ts` (a simulated schedule timestamp hard-coded to
the fixed reference week of 2026-08-03, in both `arena/src/lib/sim-time.ts`
and root `lib/expand-scenarios.ts`). This produced a number with no
real-world meaning that grew by exactly 24h for every day between the
reference week and whenever the run happened — verified live at
2,139,900,000ms / 2,178,300,000ms (~24.8 days) mean/p95 for a detection
that took about a second, and never flagged anywhere as an approximation.

Fixed by adding a required `sentAt` field (real wall-clock, captured
immediately before the authorize call) to `LabelRecord` in both label
writers (`lib/labels.ts`, `arena/src/labels.ts`), populated by both
replay tools (`run-stream.ts`, `arena/src/engine.ts`), and switching
`scorer.ts`'s latency calculation to `flag.detectedAt - label.sentAt`.
`label.ts` (simulated) is unchanged and still used for business-hours-style
reasoning — just never for latency math now. `artifacts/` is gitignored
and ephemeral, so no back-compat shim was needed.

### 9. A fully-ineligible cart returns HTTP 200, so both replay tools scored it as "allowed"

`/payments/quote` and `/payments/authorize` report per-item and per-cart
eligibility in the response **body** (`canProceed`, `reason`,
`approvedAmount`/`rejectedAmount`), not via HTTP status — a cart where
every item is out of category (or otherwise ineligible) still comes back
200 OK with `canProceed:false` at quote time, and authorize goes on to
create an `APPROVED`/`AUTHORIZED` record with `approvedAmount:0`. Both
`run-stream.ts` and `arena/src/engine.ts` only ever checked HTTP status
(`requestExpectingEither`/`requestEither`'s `ok`), so Kit 1's
`out-of-category` scenario (`expectAllowed:false`) was scored "allowed"
regardless of the velocity-gate issue in #7 above — a $0 payment for
nothing, silently recorded as a pass.

Fixed by checking `quoteRes.data.canProceed` in both `replayPayment()`
(`run-stream.ts`) and `replayAction()` (`arena/src/engine.ts`): a
`canProceed:false` quote is now treated as a denial (using the platform's
own `reason` string) and authorize is never called. Also added the
missing `expectedReasonContains` for `out-of-category`
(`"No eligible items in cart"`, matching the string this fix now
surfaces) and `delegation-overspend` (`"cart.total"` — its $6,000 item
exceeds the shared $2,000 cap regardless of Kit 1's narrower per-child
budget, so the existing hook already covers it) in
`kits/agent-mandate.json`, closing the last 2 of Kit 1's 6 fraud
scenarios that could previously print a scorecard ✔ while denied for the
wrong reason. The other three kit manifests already had full
`expectedReasonContains` coverage (or, for `disbursement-integrity`,
intentionally have none — its violation scenarios are `expectAllowed:true`
by design until `--after-tighten`).

### 10. Flaky `arena/test/rate-limiter.test.ts` timing assertion, `#5`

Its "never exceeds maxPerWindow requests within any windowMs interval"
test records `Date.now()` immediately after `acquire()` resolves, with no
tolerance for CI scheduling jitter between the limiter's internal
slot-consumption instant and that measurement — unlike the very next test
in the same file, which already tolerates this exact class of slop
(`elapsed >= windowMs - 50`). Reproduced live: failed twice in a row on
GitHub Actions' Node 22.x runner (20.x/24.x passed the same run), surfaced
while getting the two PRs above to a clean CI run. Fixed by applying the
same 50ms tolerance to the window-membership check.
