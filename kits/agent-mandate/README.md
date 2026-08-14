# Kit: Agent Spending Mandate

Track kit for budgeted, category- and merchant-restricted agent spending with parent → child mandates.

## What gets seeded

```bash
npx tsx seed-kit.ts --kit=agent-mandate
```

Creates:

- **Program**: “Procurement Mandates” (USD) with three tiers (parent $100k, sub-agent $20k, restricted $5k).
- **12 merchants** across OFFICE / LOGISTICS / SOFTWARE / TRAVEL. Ten on the allowlist; `m11` / `m12` left off so unapproved counterparty is a real decline.
- **5 actors**: parent + 3 sub-agents + 1 under-funded sub-agent. Each has a spending wallet (self-enrol) and an AI Voucher mandate (parent/child chain).
- **2 Hooks**: rule Hook (merchant allowlist, $2,000 per-tx cap, 09:00–17:00) and rate_limit Hook (velocity / split-payment structuring).

## Story

A procurement agent holds a $100k monthly budget and delegates narrower sub-budgets. All five identities can transact only inside those guardrails.

## Run

```bash
npx tsx seed-kit.ts --kit=agent-mandate
npx tsx run-stream.ts --kit=agent-mandate --speed=60
```

Requires `HACKATHON_ORG_API_KEY` and `API_BASE_URL` (see root [README](../../README.md) and [`.env.example`](../../.env.example)).

Replay covers compliant baselines plus:

| Scenario | Mechanism |
|----------|-----------|
| `over_limit_single_tx` | Cart over the $2,000 per-tx cap |
| `out_of_category` | Category not sellable by the chosen merchant |
| `unapproved_counterparty` | Merchant not on the Hook allowlist |
| `out_of_hours` | Hour outside 09:00–17:00 (`X-Sim-Time`) |
| `split_payment_structuring` | Burst of just-under-cap txs; velocity Hook |
| `delegation_overspend` | Restricted sub-agent over its $5k budget |

Labels: `artifacts/runs/<runId>/labels.jsonl`.

## Demo moment

Watch real `403`s with traces, then use MCP `simulate_policy` before spend and `get_audit_trail` / `get_mandate_ledger` after.

## Build ideas

1. **Explain-before-you-spend**: `simulate_policy` on the proposed cart before authorize.
2. **Mandate-tree anomaly scoring**: compare sibling ledgers via `get_mandate_ledger`.
3. **Auto-tighten draft**: after repeated structuring hits, draft a lower per-tx cap (use REST `POST /proposals`; see Kit disbursement-integrity).

## MCP calls

```
list_programs
get_program_stats { "program_slug": "agent-mandate-<org-suffix>" }
compile_policy / simulate_policy
issue_agent_mandate / delegate_mandate
get_mandate_ledger / get_mandate_stats
get_audit_trail
```

`propose_rule` still hits a legacy draft path. Prefer `POST /proposals` for HITL-visible proposals.

## Limitations

- Quote-time Hook denials do not emit `payment.declined` to SSE/webhooks. Use audits + `labels.jsonl`.
- **Velocity Hook** uses wall-clock time; extreme `--speed` can collide with the cap.
- Agent identity is still split (AI Voucher mandate vs payment beneficiary). Future agent-passport work may collapse that; `lib/synthetic.ts` documents the seam.
