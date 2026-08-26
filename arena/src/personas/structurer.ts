/**
 * structurer — splits an over-limit intent into N under-limit tranches
 * fired within minutes of each other ("split-payment structuring"). Every
 * individual tranche is, in isolation, under the per-tx cap — the
 * violation is the PATTERN (same actor, same/adjacent merchant, tight
 * time window, tranches summing well above the cap), which is exactly why
 * this is a distinct, harder-to-catch violation type from limit-prober's
 * single-shot over-cap attempts.
 *
 * Params:
 *   actorRef?: string        — default: first actor.
 *   merchantRef?: string     — default: first merchant approving the actor's first allowed category.
 *   totalUsd: number         — REQUIRED. Total amount being structured (should be > capUsd).
 *   capUsd: number           — REQUIRED. The per-tx cap being evaded.
 *   tranches?: number        — default 5 (ignored if `count` on the persona entry is set; count wins).
 *   intervalSeconds?: number — default 90 (tight — "within minutes").
 */
import { rngFromKey, randInt } from "../lib/rng";
import type { Persona, PersonaAction, PersonaGenContext } from "./types";
import { numParam } from "./types";

export const structurer: Persona = {
  id: "structurer",
  description: "Splits an over-limit total into under-limit tranches fired within minutes.",
  generate(ctx: PersonaGenContext): PersonaAction[] {
    const rng = rngFromKey(ctx.seedKey);
    const { world, count, params } = ctx;
    if (world.actors.length === 0 || world.merchants.length === 0) return [];

    const capUsd = numParam(params, "capUsd", 2000);
    const totalUsd = numParam(params, "totalUsd", capUsd * 3);
    const tranches = count > 0 ? count : Math.max(2, numParam(params, "tranches", 5));
    const intervalSeconds = numParam(params, "intervalSeconds", 90);

    const pinnedActorRef = typeof params.actorRef === "string" ? params.actorRef : undefined;
    const actor = (pinnedActorRef ? world.actors.find((a) => a.ref === pinnedActorRef) : undefined) ?? world.actors[0]!;
    const category = actor.allowedCategories[0] ?? world.categories[0] ?? "GENERAL";
    const pinnedMerchantRef = typeof params.merchantRef === "string" ? params.merchantRef : undefined;
    const merchant =
      (pinnedMerchantRef ? world.merchants.find((m) => m.ref === pinnedMerchantRef) : undefined) ??
      world.merchants.find((m) => m.approvedCategories.includes(category)) ??
      world.merchants[0]!;

    // Split totalUsd into `tranches` amounts, each safely under capUsd, jittered but summing close to totalUsd.
    const baseAmount = totalUsd / tranches;
    const perTrancheCap = capUsd * 0.95; // "just under" the cap, per 03-sandbox-kits.md's own structuring template
    const amounts: number[] = [];
    for (let i = 0; i < tranches; i++) {
      const jitter = 1 + (rng() * 2 - 1) * 0.08;
      const amount = Math.min(perTrancheCap, Math.round(baseAmount * jitter * 100) / 100);
      amounts.push(Math.max(1, amount));
    }

    const startHour = 33 + randInt(rng, 0, 3); // Tue morning, business hours
    const actions: PersonaAction[] = amounts.map((amount, i) => ({
      kitScenarioId: `structurer-${String(i + 1).padStart(3, "0")}`,
      templateId: "structurer",
      label: `Structured tranche ${i + 1}/${tranches} of $${totalUsd} split (cap $${capUsd})`,
      violationType: "structuring",
      actorRef: actor.ref,
      merchantRef: merchant.ref,
      item: { sku: `SKU-${category}-STRUCT`, name: "Structured tranche purchase", categoryCode: category, qty: 1, unitPrice: amount },
      simHourOfWeek: startHour,
      intervalSeconds: i === 0 ? 0 : intervalSeconds,
    }));
    return actions;
  },
};
