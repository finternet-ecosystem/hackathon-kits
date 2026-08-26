/**
 * limit-prober — binary-searches the per-transaction amount cap. Starts
 * with a wide [lowBound, highBound] bracket known to straddle the cap and
 * narrows it every step toward `capUsd` — a realistic "adversary who
 * doesn't know the exact cap but can infer it from repeated deny/allow
 * responses" pattern, generated deterministically (ground truth doesn't
 * depend on what the platform actually decides — "ground truth by
 * construction", see arena/README.md "Personas").
 *
 * Ground truth: any probe strictly above capUsd is a violation
 * ("over_limit_probe"); at-or-below is compliant — this persona
 * deliberately produces BOTH so recall/false-positive-rate are both
 * measurable from its own traffic alone.
 *
 * Params:
 *   actorRef?: string       — default: first actor.
 *   merchantRef?: string    — default: first merchant approving the actor's first allowed category.
 *   capUsd: number          — REQUIRED. The per-tx cap this persona probes toward.
 *   lowBound?: number       — default capUsd * 0.5.
 *   highBound?: number      — default capUsd * 2.
 *   intervalSeconds?: number — default 20.
 */
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const limitProber: Persona = {
  id: "limit-prober",
  description: "Binary-searches the per-transaction amount cap toward a known boundary.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    // Deterministic by construction (pure bisection over capUsd/lowBound/highBound/count) —
    // no RNG needed; ctx.seedKey is accepted for interface uniformity with other personas.
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0) return [];

    const capUsd = numParam(params, "capUsd", 2000);
    let low = numParam(params, "lowBound", capUsd * 0.5);
    let high = numParam(params, "highBound", capUsd * 2);

    const pinnedActorRef = typeof params.actorRef === "string" ? params.actorRef : undefined;
    const actor = (pinnedActorRef ? world.actors.find((a) => a.ref === pinnedActorRef) : undefined) ?? world.actors[0]!;
    const category = actor.allowedCategories[0] ?? world.categories[0] ?? "GENERAL";
    const pinnedMerchantRef = typeof params.merchantRef === "string" ? params.merchantRef : undefined;
    const merchant =
      (pinnedMerchantRef ? world.merchants.find((m) => m.ref === pinnedMerchantRef) : undefined) ??
      world.merchants.find((m) => m.approvedCategories.includes(category)) ??
      world.merchants[0]!;

    const intervalSeconds = numParam(params, "intervalSeconds", 20);

    const actions: PersonaAction[] = [];
    for (let i = 0; i < count; i++) {
      const probe = Math.round(((low + high) / 2) * 100) / 100;
      const isOverCap = probe > capUsd;
      // Bisect toward the cap: over -> pull high bound down; at/under -> push low bound up.
      if (isOverCap) high = probe;
      else low = probe;

      const simHourOfWeek = 9 + Math.floor((i / Math.max(1, count - 1 || 1)) * 8); // stays in business hours (9-17)
      actions.push({
        kitScenarioId: `limit-prober-${String(i + 1).padStart(3, "0")}`,
        templateId: "limit-prober",
        label: `Probe #${i + 1} at $${probe.toFixed(2)} (cap $${capUsd})`,
        violationType: isOverCap ? "over_limit_probe" : null,
        actorRef: actor.ref,
        merchantRef: merchant.ref,
        item: { sku: `SKU-${category}-PROBE`, name: "Limit probe purchase", categoryCode: category, qty: 1, unitPrice: probe },
        simHourOfWeek,
        intervalSeconds,
      });
    }
    return actions;
  },
};
