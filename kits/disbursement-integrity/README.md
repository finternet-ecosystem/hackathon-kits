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

Self-serve **Enable Hackathon API** mints one `program_manager` key. Approval needs `proposals:approve` (`team_admin` / org admin). Ask organizers for a second key on your hackathon org (`mintKey` + `keyRole: "team_admin"`), or use another portal user with an Enable key that can approve.

```bash
# Resolve m4 id from artifacts/kits/disbursement-integrity-<orgId>.json

# 1. Propose (proposer key)
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

# 2. Approve (second key with proposals:approve)
curl -s -X POST "$API_BASE_URL/proposals/<proposalId>/approve" \
  -H "x-api-key: $APPROVER_KEY"

# 3. Rerun mule scenarios only
npx tsx run-stream.ts --kit=disbursement-integrity \
  --only=mule_pattern --after-tighten
```

Do not rely on MCP `propose_rule` for this loop; it still targets a legacy draft endpoint.

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

- Need a **second principal** for approve; Enable alone is not enough for the HITL money shot.
- `propose_rule` MCP ≠ `POST /proposals`.
- Approval path historically had a Hook phase bug on older builds; current platform builds should have the fix. If approved rules never fire, tell organizers.
