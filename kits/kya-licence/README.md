# Kit: KY-A Licence

Track kit for agent identity lifecycle: issue, delegate, revoke, and refuse reuse of a revoked mandate.

## What gets seeded

```bash
npx tsx seed-kit.ts --kit=kya-licence
```

Same shape as agent-mandate, smaller cast:

- Program “KY-A Agent Licensing”
- 4 merchants (3 allowlisted, 1 not)
- 3 actors (parent + 2 sub-agents), each with spending wallet + AI Voucher mandate

## Story

A licensing authority issues time-bound, delegatable mandates. Revocation must stick immediately. Delegation depth is capped. A revoked mandate must not mint new children.

## Run

```bash
npx tsx seed-kit.ts --kit=kya-licence
npx tsx run-stream.ts --kit=kya-licence --speed=60
```

Requires `HACKATHON_ORG_API_KEY` and `API_BASE_URL` (root [README](../../README.md)).

Replay includes baseline/violation payments plus mandate ops against `/ai-vouchers`:

| Step | What it proves |
|------|----------------|
| `grandchild-delegation-abuse` | Further delegation denied (`maxDepth` not granted) |
| `revoke-child-2` | `DELETE /ai-vouchers/:id` → `REVOKED` |
| `revoked-mandate-reuse` | Child from revoked parent denied (`not active`) |
| `reverify-parent-ledger` | `GET /ai-vouchers/:id/ledger` succeeds |

Only payment-kind steps go to `labels.jsonl`. Lifecycle steps print to the console.

## Demo moment

Grandchild deny → revoke mid-stream → same operation type fails with “parent inactive” instead of “delegation not permitted.”

## Build ideas

1. Expiry monitor via `get_mandate_stats` / `expiresAt`.
2. Delegation-graph visualizer from `parentVoucherId` / depth.
3. Optional revoke cascade to children (platform does not cascade today; verify with `revoke_mandate` + list).

## MCP calls

```
issue_agent_mandate
delegate_mandate
revoke_mandate
get_mandate_ledger / get_mandate_stats
get_audit_trail
```

## Limitations

- Cross-key “impersonation” is not a separate boundary today (org-scoped `ai_vouchers:*`). Revoked reuse is the enforced demo.
- If `/ai-vouchers/*` returns unexpected `403`, use a freshly Enabled hackathon key (scopes include `ai_vouchers:*` on current deployments).
- Quote-time denials on the payment half of the stream may not emit `payment.declined` on SSE; see root README.
