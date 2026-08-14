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
