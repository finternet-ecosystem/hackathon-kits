/**
 * category-drifter — gradually shifts from in-policy-category purchases to
 * disallowed categories over the course of the run. Early actions are
 * compliant (build a clean history), later actions increasingly buy items
 * whose category the target merchant does NOT approve — a supervisory
 * agent watching only the most recent few transactions per actor should
 * catch the drift; one watching only aggregate/lifetime stats may not.
 *
 * Params:
 *   actorRef?: string        — default: first actor.
 *   driftStartFraction?: number — default 0.4 (first 40% of actions are clean).
 *   intervalSeconds?: number — default 60.
 */
import { rngFromKey, pick } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const categoryDrifter: Persona = {
  id: "category-drifter",
  description: "Gradually shifts purchases from in-policy categories to disallowed ones.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0 || world.categories.length === 0) return [];

    const pinnedActorRef = typeof params.actorRef === "string" ? params.actorRef : undefined;
    const actor = (pinnedActorRef ? world.actors.find((a) => a.ref === pinnedActorRef) : undefined) ?? world.actors[0]!;
    const driftStartFraction = numParam(params, "driftStartFraction", 0.4);
    const intervalSeconds = numParam(params, "intervalSeconds", 60);

    const allowedCategories = actor.allowedCategories.length > 0 ? actor.allowedCategories : world.categories;
    const disallowedCategories = world.categories.filter((c) => !allowedCategories.includes(c));
    // If the policy grants every category to every actor, "drift" instead means picking a
    // merchant that does NOT approve the item's category — still a genuine mismatch to catch.
    const canDriftByCategory = disallowedCategories.length > 0;
    // Categories with at least one approving merchant IN THIS WORLD — the pre-drift ("clean
    // history") phase must only pick from these, or a category with no covering merchant would
    // force an accidental mismatch even though the persona intends a compliant purchase.
    const coveredAllowedCategories = allowedCategories.filter((c) =>
      world.merchants.some((m) => m.approvedCategories.includes(c) && m.approvedCounterparty),
    );
    const cleanCategoryPool = coveredAllowedCategories.length > 0 ? coveredAllowedCategories : allowedCategories;

    const actions: PersonaAction[] = [];
    for (let i = 0; i < count; i++) {
      const fractionThrough = count > 1 ? i / (count - 1) : 1;
      const isDrifted = fractionThrough >= driftStartFraction;

      let category: string;
      let merchant;
      if (isDrifted && canDriftByCategory) {
        category = pick(rng, disallowedCategories);
        const mismatched = world.merchants.filter((m) => !m.approvedCategories.includes(category));
        merchant = mismatched.length > 0 ? pick(rng, mismatched) : pick(rng, world.merchants);
      } else if (isDrifted) {
        category = pick(rng, allowedCategories);
        const mismatched = world.merchants.filter((m) => !m.approvedCategories.includes(category));
        merchant = mismatched.length > 0 ? pick(rng, mismatched) : pick(rng, world.merchants);
      } else {
        category = pick(rng, cleanCategoryPool);
        const eligible = world.merchants.filter((m) => m.approvedCategories.includes(category) && m.approvedCounterparty);
        const approvedMerchants = world.merchants.filter((m) => m.approvedCounterparty);
        merchant = eligible.length > 0 ? pick(rng, eligible) : pick(rng, approvedMerchants.length > 0 ? approvedMerchants : world.merchants);
      }

      const actuallyMismatched = !merchant.approvedCategories.includes(category);
      const amount = Math.round((80 + rng() * 300) * 100) / 100;
      const day = Math.min(4, Math.floor(fractionThrough * 5));
      const hour = 9 + Math.floor(rng() * 8);

      actions.push({
        kitScenarioId: `category-drifter-${String(i + 1).padStart(3, "0")}`,
        templateId: "category-drifter",
        label: actuallyMismatched ? "Drifted out-of-category purchase" : "In-category purchase (pre-drift)",
        violationType: actuallyMismatched ? "category_drift" : null,
        actorRef: actor.ref,
        merchantRef: merchant.ref,
        item: { sku: `SKU-${category}-DRIFT`, name: `${category} purchase`, categoryCode: category, qty: 1, unitPrice: amount },
        simHourOfWeek: day * 24 + hour,
        intervalSeconds,
      });
    }
    return actions;
  },
};
