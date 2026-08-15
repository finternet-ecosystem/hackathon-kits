# Contributing

This package is the public Vouch hackathon kits client. Prefer small, reviewable PRs.

## Docs

- Public voice: short sentences, scannable tables, no em dashes.
- Keep root README structure: Quickstart → Prerequisites → Kits → Commands → Programmatic usage → MCP → Limitations → Troubleshooting.
- Do not paste real API keys. Update `.env.example` placeholders only.
- Point participants at portal **Enable Hackathon API**; organizer admin mint is secondary.
- Participant docs: describe behavior and public API paths only. No internal ticket ids, schema/table names, or backend implementation details.

## Code

- Kit mutations go through `lib/client.ts` only (API key). Do not add database clients.
- Org guard must keep refusing non-hackathon orgs via `GET /hackathon/orgs/self`.
- Tests: `node:test` via `npm test`. Integration tests must skip cleanly without a live backend.

## Local check

```bash
npm install
npm test
npx tsc --noEmit
```

## License

By contributing, you agree your changes are licensed under the MIT License in [`LICENSE`](LICENSE).
