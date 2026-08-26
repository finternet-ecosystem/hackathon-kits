# Kit: Disbursement Integrity

Track kit for a deliberately loose welfare policy, a mule-merchant pattern that slips through, and a real propose → approve → rerun tighten loop.

## What gets seeded

```bash
npx tsx seed-kit.ts --kit=disbursement-integrity
```

Creates “Community Welfare Disbursement”:

- **9 beneficiaries** (`b1`–`b8`, `dup1`) with $300 benefits (synthetic `9999…` phones)
- **4 merchants**: three legitimate; `m4` (“Quickmart”) is the mule target but looks identical to the API
- **Zero Hooks** at seed time. Only native category/budget checks apply. That is the point.

## Story

First run: mule burst (many unrelated beneficiaries at one merchant, off-hours) and a synthetic duplicate identity (`dup1`) both **ALLOWED**. Your agent proposes a tightening rule; a second actor approves; the same mule txs are **DENIED** on rerun.

## Run (first pass)

```bash
npx tsx seed-kit.ts --kit=disbursement-integrity
npx tsx run-stream.ts --kit=disbursement-integrity --speed=60
```

Requires `HACKATHON_ORG_API_KEY` and `API_BASE_URL` (root [README](../../README.md)).

Labels mark `mule_pattern` / `synthetic_identity` even when the platform allowed the payment. Labels are scripted ground truth for scoring, not a mirror of HTTP status.

## Rerun after tighten

`POST /proposals/:id/approve` requires `proposals:approve` scope, and your `program_manager` hackathon API key doesn't have it — nor can the same key approve its own proposal even if it did (`proposedBy` and the approver must differ). You do **not** need a second key or a second team member for this: clicking **Enable Hackathon API** in the portal also made you an `org_owner` **member** of the org through your portal login, and `org_owner` carries full scope for requests authenticated with your **portal session** (not your hackathon API key). So propose with your API key, then approve with your portal session token:

```bash
# Resolve m4 id from artifacts/kits/disbursement-integrity-<orgId>.json

# 1. Propose (your hackathon API key)
curl -s -X POST "$API_BASE_URL/proposals" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $HACKATHON_ORG_API_KEY" \
  -d '{
    "programId": "<programId>",
    "rationale": "Block flagged mule merchant",
    "policyDelta": {
      "version": "1.0",
      "name": "Block flagged mule merchant",
      "rules": {
        "redemption": {
          "where": {
            "all": [
              { "field": "merchant.id", "op": "not_in", "value": ["<m4-id>"] }
            ]
          }
        }
      }
    }
  }'

# 2. Approve (your portal session, which is the different actor that
#    satisfies the "proposer != approver" guardrail)
export VOUCH_PORTAL_TOKEN=<your portal session token>
npx tsx approve-proposal.ts --proposal-id=<proposalId>

# 3. Rerun mule scenarios only
npx tsx run-stream.ts --kit=disbursement-integrity \
  --only=mule_pattern --after-tighten
```

Do not rely on MCP `propose_rule` for this loop; it still targets a legacy draft endpoint.

### Getting your portal session token

`approve-proposal.ts` reads `VOUCH_PORTAL_TOKEN` (or `--token=<jwt>`). If the portal's **Hackathon** page offers a copy-session-token control, use that. Otherwise read it off a request the portal already makes:

1. Open the portal and press **F12** to open DevTools, then select the **Network** tab.
2. Reload the Hackathon page.
3. Click any `/api/*` request and find `Authorization: Bearer <token>` under its request headers.
4. Copy the token. Pasting the whole `Bearer <token>` value also works; the script strips the prefix.

Portal tokens are short-lived. `approve-proposal.ts` reports a `401` as an expired token rather than a generic failure, so copy a fresh one and rerun if you see it.

## Build ideas

1. Diversity scoring (distinct beneficiaries per merchant per hour) → auto-draft proposals.
2. Fuzzy duplicate identity at enrolment (phone dedup misses `dup1`).
3. Combine off-hours + diversity instead of a hard merchant block.

## MCP calls

```
get_audit_trail { "program_id": "<id>", "action": "payment.declined" }
```

Prefer REST for propose/approve as above. Many denials never appear as `payment.declined` on SSE if they stopped at quote.

## Limitations

- Approve needs a **different actor** than the one who proposed. Run `approve-proposal.ts` with your portal session token (see "Rerun after tighten" above), not a second hackathon API key. You don't need to ask organizers for anything to complete this loop.
- `propose_rule` MCP ≠ `POST /proposals`.
- Approval path historically had a Hook phase bug on older builds; current platform builds should have the fix. If approved rules never fire, tell organizers.
