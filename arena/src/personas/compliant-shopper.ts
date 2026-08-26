/**
 * compliant-shopper — in-policy purchases, realistic pacing. The "control
 * group": every action this persona generates is ground-truth compliant
 * (violationType: null). A supervisory agent that flags compliant-shopper
 * traffic is a false positive — this persona exists so the scorer's
 * false-positive-rate metric has real, honest, non-violating traffic to
 * measure against (not just an absence of violations).
 *
 * Params:
 *   actorRef?: string    — pin to one actor (default: rotate through all actors round-robin).
 *   minAmount?: number   — default 50.
 *   maxAmount?: number   — default 400 (kept well under a typical per-tx cap).
 *   intervalSeconds?: number — default 45 (spread out, not bursty).
 */
import { rngFromKey, randInt, pick } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

function buildAction(
  index: number,
  actorRef: string,
  merchantRef: string,
  categoryCode: string,
  amount: number,
  simHourOfWeek: number,
  intervalSeconds: number,
): PersonaAction {
  return {
    kitScenarioId: `compliant-shopper-${String(index + 1).padStart(3, "0")}`,
    templateId: "compliant-shopper",
    label: "Compliant in-policy purchase",
    violationType: null,
    actorRef,
    merchantRef,
    item: { sku: `SKU-${categoryCode}`, name: `${categoryCode} purchase`, categoryCode, qty: 1, unitPrice: amount },
    simHourOfWeek,
    intervalSeconds,
  };
}

export const compliantShopper: Persona = {
  id: "compliant-shopper",
  description: "In-policy purchases at realistic pacing — the ground-truth-compliant control group.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0) return [];

    const minAmount = numParam(params, "minAmount", 50);
    const maxAmount = numParam(params, "maxAmount", 400);
    const intervalSeconds = numParam(params, "intervalSeconds", 45);
    const pinnedActor = typeof params.actorRef === "string" ? params.actorRef : undefined;

    const actions: PersonaAction[] = [];
    for (let i = 0; i < count; i++) {
      const actor = pinnedActor
        ? world.actors.find((a) => a.ref === pinnedActor) ?? world.actors[i % world.actors.length]!
        : world.actors[i % world.actors.length]!;

      // Buy within the actor's own allowed categories at a merchant that approves that category — genuinely in-policy.
      const category = actor.allowedCategories.length > 0
        ? pick(rng, actor.allowedCategories)
        : pick(rng, world.categories.length > 0 ? world.categories : ["GENERAL"]);
      const eligibleMerchants = world.merchants.filter((m) => m.approvedCategories.includes(category));
      const merchant = eligibleMerchants.length > 0 ? pick(rng, eligibleMerchants) : pick(rng, world.merchants);

      const amount = Math.round(randInt(rng, minAmount, maxAmount) * 100) / 100;
      // Business hours only (9-17), Mon-Fri-ish spread across the simulated week.
      const day = randInt(rng, 0, 4);
      const hour = randInt(rng, 9, 16);
      const simHourOfWeek = day * 24 + hour;

      actions.push(buildAction(i, actor.ref, merchant.ref, category, amount, simHourOfWeek, intervalSeconds));
    }
    return actions;
  },
};
