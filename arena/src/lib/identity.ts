/**
 * Deterministic identity helpers matching the CONVENTION established by
 * this repo's sandbox kits (`../../../lib/synthetic.ts`, i.e. the kits
 * repo's top-level `lib/synthetic.ts`) — NOT an import from that file
 * (arena has zero imports outside `arena/`, see arena/README.md).
 *
 * Why this matters: a kit-seeded actor's `x-privy-user-id` is fully
 * deterministic from (kitId, orgId, actorRef) — `seed-kit.ts` derives it
 * this way at self-enrol time, and the API never reads it back out.
 * Recomputing the SAME formula here lets arena drive personas against a
 * Kit-1-seeded org's real actors using only public information (the kit id
 * + org id + the actor refs listed in the kit manifest, which are
 * public/committed data, not secrets) — and with no dependency on
 * `run-stream.ts`'s local `artifacts/kits/*.json` sidecar.
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

/**
 * Composes a --fresh-label slug prefix — must match synthetic.ts::freshSlugPrefix
 * byte-for-byte, so `--fresh-label=<label>` here derives the exact same
 * program slug that `seed-kit.ts --fresh=<label>` created. Pure string
 * composition — does not itself call the platform.
 */
export function freshSlugPrefix(basePrefix: string, label: string): string {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${basePrefix}-${safeLabel}`;
}
