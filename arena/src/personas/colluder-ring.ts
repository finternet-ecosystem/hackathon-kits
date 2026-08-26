/**
 * colluder-ring (kit-4 style) — a
 * cluster of otherwise-unrelated actors all redeem rapidly at the SAME
 * single merchant in a tight time window ("mule pattern" — one merchant,
 * many beneficiaries, off-hours, per 03-sandbox-kits.md's Kit 4
 * disbursement-integrity violation script). This persona needs MULTIPLE
 * actors (unlike the other six, which each drive one actor) — set
 * `count` to the number of actors you want in the ring; it round-robins
 * across `params.actorRefs` (or all world actors if unset), one
 * transaction per actor.
 *
 * Params:
 *   actorRefs?: string[]     — default: all actors in the world.
 *   merchantRef?: string     — REQUIRED conceptually; default: first merchant.
 *   nightHour?: number       — default 3 (mule rings typically operate off-hours too).
 *   dayOfWeek?: number       — default 6 (Sunday).
 *   intervalSeconds?: number — default 15 (very tight — the ring acting in near-lockstep is the signal).
 *   minAmount?: number       — default 100.
 *   maxAmount?: number       — default 250.
 */
import { rngFromKey, randInt } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const colluderRing: Persona = {
  id: "colluder-ring",
  description: "A cluster of actors all redeem rapidly at one merchant in a tight window (mule pattern).",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0) return [];

    const actorRefsParam = params.actorRefs;
    const ringActors = Array.isArray(actorRefsParam) && actorRefsParam.length > 0
      ? world.actors.filter((a) => actorRefsParam.includes(a.ref))
      : world.actors;
    if (ringActors.length === 0) return [];

    const pinnedMerchantRef = typeof params.merchantRef === "string" ? params.merchantRef : undefined;
    const merchant = (pinnedMerchantRef ? world.merchants.find((m) => m.ref === pinnedMerchantRef) : undefined) ?? world.merchants[0]!;
    const category = merchant.approvedCategories[0] ?? world.categories[0] ?? "GENERAL";

    const nightHour = numParam(params, "nightHour", 3);
    const dayOfWeek = numParam(params, "dayOfWeek", 6);
    const intervalSeconds = numParam(params, "intervalSeconds", 15);
    const minAmount = numParam(params, "minAmount", 100);
    const maxAmount = numParam(params, "maxAmount", 250);
    const simHourOfWeek = dayOfWeek * 24 + nightHour;

    const actions: PersonaAction[] = [];
    for (let i = 0; i < count; i++) {
      const actor = ringActors[i % ringActors.length]!;
      const amount = Math.round(randInt(rng, minAmount, maxAmount) * 100) / 100;
      actions.push({
        kitScenarioId: `colluder-ring-${String(i + 1).padStart(3, "0")}`,
        templateId: "colluder-ring",
        label: `Ring member ${actor.ref} redeems at ${merchant.ref} (mule pattern, tx ${i + 1}/${count})`,
        violationType: "collusion_ring",
        actorRef: actor.ref,
        merchantRef: merchant.ref,
        item: { sku: `SKU-${category}-RING`, name: `${category} purchase`, categoryCode: category, qty: 1, unitPrice: amount },
        simHourOfWeek,
        intervalSeconds: i === 0 ? 0 : intervalSeconds,
      });
    }
    return actions;
  },
};
