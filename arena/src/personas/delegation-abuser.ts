/**
 * delegation-abuser — a delegated child actor keeps spending after its own
 * declared budget (and/or its parent's remaining budget) is exhausted.
 * Models the AI-mandate-specific violation: a sub-agent whose mandate quota
 * has run out but keeps issuing spend requests anyway (e.g. a buggy or
 * adversarial agent that doesn't track its own remaining balance).
 *
 * Ground truth: the first `preExhaustionCount` actions are sized to fit
 * inside the child's stated budget (compliant, building genuine spend
 * history); every action after that is a violation
 * ("delegation_overspend") — sized so the CUMULATIVE spend for this actor
 * provably exceeds `budget` by the time it posts.
 *
 * Params:
 *   actorRef?: string           — REQUIRED conceptually; default: last actor (kits list children after the parent).
 *   preExhaustionCount?: number — default: floor(count / 2).
 *   intervalSeconds?: number    — default 40.
 */
import { rngFromKey, pick } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const delegationAbuser: Persona = {
  id: "delegation-abuser",
  description: "A delegated actor keeps spending after its own budget is exhausted.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0 || count === 0) return [];

    const pinnedActorRef = typeof params.actorRef === "string" ? params.actorRef : undefined;
    const actor = (pinnedActorRef ? world.actors.find((a) => a.ref === pinnedActorRef) : undefined) ?? world.actors[world.actors.length - 1]!;
    const category = actor.allowedCategories[0] ?? world.categories[0] ?? "GENERAL";
    const eligibleMerchants = world.merchants.filter((m) => m.approvedCategories.includes(category));
    const merchant = eligibleMerchants.length > 0 ? pick(rng, eligibleMerchants) : world.merchants[0]!;

    const preExhaustionCount = Math.min(count, Math.max(0, numParam(params, "preExhaustionCount", Math.floor(count / 2))));
    const intervalSeconds = numParam(params, "intervalSeconds", 40);

    // Spend down the budget cleanly across the pre-exhaustion actions, then keep spending past zero.
    const perTxWithinBudget = preExhaustionCount > 0 ? actor.budget / (preExhaustionCount + 1) : actor.budget / 2;
    const overspendAmount = Math.max(50, actor.budget * 0.15);

    const actions: PersonaAction[] = [];
    let cumulative = 0;
    for (let i = 0; i < count; i++) {
      const isPreExhaustion = i < preExhaustionCount;
      const amount = Math.round((isPreExhaustion ? perTxWithinBudget : overspendAmount) * 100) / 100;
      cumulative += amount;
      const isViolation = !isPreExhaustion || cumulative > actor.budget;

      const day = 1 + Math.floor(i / 4);
      const hour = 9 + (i % 6);
      actions.push({
        kitScenarioId: `delegation-abuser-${String(i + 1).padStart(3, "0")}`,
        templateId: "delegation-abuser",
        label: isViolation
          ? `Overspend past declared budget $${actor.budget} (cumulative $${cumulative.toFixed(2)})`
          : `Within-budget spend (cumulative $${cumulative.toFixed(2)} of $${actor.budget})`,
        violationType: isViolation ? "delegation_overspend" : null,
        actorRef: actor.ref,
        merchantRef: merchant.ref,
        item: { sku: `SKU-${category}-DELEG`, name: `${category} purchase`, categoryCode: category, qty: 1, unitPrice: amount },
        simHourOfWeek: day * 24 + hour,
        intervalSeconds: i === 0 ? 0 : intervalSeconds,
      });
    }
    return actions;
  },
};
