/**
 * Deterministic identity helpers matching the CONVENTION established by
 * this repo's sandbox kits (`../../../lib/synthetic.ts`, i.e. the kits
 * repo's top-level `lib/synthetic.ts`) — NOT an import from that file
 * (arena has zero imports outside `arena/`, see arena/README.md).
 *
 * Why this matters: a kit-seeded actor's `x-privy-user-id` is fully
 * deterministic from (kitId, orgId, actorRef) — `seed-kit.ts` derives it
 * this way at self-enrol time, and never persists it anywhere arena could
 * read without a backend filesystem/DB connection arena is explicitly
 * forbidden from having. Recomputing the SAME formula here lets arena drive
 * personas against a Kit-1-seeded org's real actors using only public
 * information (the kit id + org id + the actor refs listed in the kit
 * manifest, which are public/committed data, not secrets) — no direct
 * DB/file access, no dependency on `run-stream.ts`'s local
 * `artifacts/kits/*.json` sidecar.
 *
 * If `lib/synthetic.ts` ever changes its derivation formula, this file must
 * be updated to match — see arena/README.md "Coupling to the kits repo".
 */

/** Deterministic privyUserId for a kit-seeded actor. Must match synthetic.ts::actorPrivyUserId. */
export function actorPrivyUserId(kitId: string, orgId: string, actorRef: string): string {
  return `hackathon-kit:${kitId}:${orgId.slice(-8)}:${actorRef}`;
}

/** Deterministic program slug for a kit-seeded program. Must match synthetic.ts::programSlugFor. */
export function programSlugFor(slugPrefix: string, orgId: string): string {
  return `${slugPrefix}-${orgId.slice(-8)}`.toLowerCase();
}
