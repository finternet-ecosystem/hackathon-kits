/** Deterministic, obviously-synthetic identifiers for kit-seeded data. */

/**
 * self-enrol's phone validator (normalizeMultiCountryPhone) only accepts
 * IN/LK/ZA formats regardless of Program.settings.dialCode (see kit READMEs
 * "Known platform limitations") — so every kit actor gets a 10-digit Indian-
 * shaped number ("9999" + 6-digit sequence). "9999" is not a real assignable
 * Indian mobile prefix block, making it obviously synthetic despite the
 * 10-digit format constraint.
 */
export function syntheticPhone(index: number): string {
  return `9999${String(index).padStart(6, "0")}`;
}

/** Deterministic privyUserId for a kit actor — used both at self-enrol time and as the x-privy-user-id identity for that actor's subsequent payment calls. */
export function actorPrivyUserId(kitId: string, orgId: string, actorRef: string): string {
  return `hackathon-kit:${kitId}:${orgId.slice(-8)}:${actorRef}`;
}

export function programSlugFor(slugPrefix: string, orgId: string): string {
  return `${slugPrefix}-${orgId.slice(-8)}`.toLowerCase();
}

/**
 * Composes a --fresh slug prefix: base prefix + a sanitized label, so
 * `programSlugFor` derives a program slug that's never been seen before
 * instead of the one fixed slug a (kitId, orgId) pair always maps to. Label
 * is sanitized to stay slug-safe (lowercase alphanumeric + hyphens only,
 * no leading/trailing hyphens) since it flows straight into a URL path
 * segment. Pure string composition — does not itself call the platform.
 *
 * This must stay byte-identical to arena/src/lib/identity.ts's copy (same
 * relationship as actorPrivyUserId/programSlugFor above) so seed-kit.ts
 * --fresh=<label> and arena's --fresh-label=<label> always derive the same
 * program slug for the same label.
 */
export function freshSlugPrefix(basePrefix: string, label: string): string {
  const safeLabel = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${basePrefix}-${safeLabel}`;
}
