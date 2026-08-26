/**
 * night-burster — fires a tight burst of transactions late at night
 * (outside the 09:00-17:00 business-hours window most kits enforce),
 * simulating an agent operating while no human reviewer is watching.
 * Every action in the burst is ground-truth violation type
 * "off_hours_burst" (the hour alone is the violation signal here — amounts
 * stay well within the per-tx cap so this persona isolates the time-window
 * detection specifically, not conflated with over-limit detection).
 *
 * Params:
 *   actorRef?: string        — default: first actor.
 *   merchantRef?: string     — default: first merchant approving the actor's first allowed category.
 *   nightHour?: number       — hour-of-day (0-23) for the burst, default 2 (02:00).
 *   dayOfWeek?: number       — 0=Mon..6=Sun, default 5 (Saturday — doubly off-policy: night AND weekend).
 *   intervalSeconds?: number — default 30 (tight burst).
 *   minAmount?: number       — default 50.
 *   maxAmount?: number       — default 300 (kept well under a typical per-tx cap).
 */
import { rngFromKey, randInt } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const nightBurster: Persona = {
  id: "night-burster",
  description: "Fires a tight burst of transactions outside business hours.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0) return [];

    const pinnedActorRef = typeof params.actorRef === "string" ? params.actorRef : undefined;
    const actor = (pinnedActorRef ? world.actors.find((a) => a.ref === pinnedActorRef) : undefined) ?? world.actors[0]!;
    const category = actor.allowedCategories[0] ?? world.categories[0] ?? "GENERAL";
    const pinnedMerchantRef = typeof params.merchantRef === "string" ? params.merchantRef : undefined;
    const merchant =
      (pinnedMerchantRef ? world.merchants.find((m) => m.ref === pinnedMerchantRef) : undefined) ??
      world.merchants.find((m) => m.approvedCategories.includes(category)) ??
      world.merchants[0]!;

    const nightHour = numParam(params, "nightHour", 2);
    const dayOfWeek = numParam(params, "dayOfWeek", 5);
    const intervalSeconds = numParam(params, "intervalSeconds", 30);
    const minAmount = numParam(params, "minAmount", 50);
    const maxAmount = numParam(params, "maxAmount", 300);
    const simHourOfWeek = dayOfWeek * 24 + nightHour;

    const actions: PersonaAction[] = [];
    for (let i = 0; i < count; i++) {
      const amount = Math.round(randInt(rng, minAmount, maxAmount) * 100) / 100;
      actions.push({
        kitScenarioId: `night-burster-${String(i + 1).padStart(3, "0")}`,
        templateId: "night-burster",
        label: `Off-hours burst tx ${i + 1}/${count} at hour ${nightHour} (day ${dayOfWeek})`,
        violationType: "off_hours_burst",
        actorRef: actor.ref,
        merchantRef: merchant.ref,
        item: { sku: `SKU-${category}-NIGHT`, name: `${category} purchase`, categoryCode: category, qty: 1, unitPrice: amount },
        simHourOfWeek,
        intervalSeconds: i === 0 ? 0 : intervalSeconds,
      });
    }
    return actions;
  },
};
