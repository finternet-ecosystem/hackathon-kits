/**
 * Vouch hackathon sandbox kits — kit manifest schema.
 *
 * A "kit manifest" is a declarative description of everything `seed-kit.ts`
 * provisions for one kit scenario (program + policy + merchants + actors + hooks)
 * and everything `run-stream.ts` replays against it (a set of scenario
 * *templates* — not 200 literal JSON rows; `run-stream.ts` expands each
 * template's `count` into concrete transactions at runtime, see
 * `lib/expand-scenarios.ts`).
 *
 * Kept deliberately close to the real API request bodies (`POST /policy`,
 * `POST /programs/:slug/hooks`, `POST /payments/intents`, ...) so
 * `seed-kit.ts` / `run-stream.ts` can pass most fields straight through.
 */
import { z } from "zod";

export const kitPolicyTierSchema = z.object({
  tier: z.number().int(),
  label: z.string().min(1),
  value: z.number().nonnegative(),
  expiryDays: z.number().int().positive(),
  categories: z.array(z.string().min(1)),
});

export const kitEligibilityRuleSchema = z.object({
  fieldKey: z.string().min(1),
  // Legacy Policy/TierDefinition operator vocabulary (services/policy.ts::evaluateEligibilityDetailed)
  // — distinct from the Universal Eligibility DSL's operator set used by hooks[].ruleConfig below.
  operator: z.enum(["equals", "not_equals", "in", "contains", "not_empty", "empty", "age_between", "<", "<=", ">", ">=", "between"]),
  value: z.string(),
  tierAssigned: z.number().int(),
  priority: z.number().int(),
});

export const kitCategorySchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
});

export const kitPolicySchema = z.object({
  tiers: z.array(kitPolicyTierSchema).min(1),
  eligibilityRules: z.array(kitEligibilityRuleSchema).min(1),
  categories: z.array(kitCategorySchema).min(1),
});

export const kitMerchantSchema = z.object({
  ref: z.string().min(1),
  name: z.string().min(1),
  approvedCategories: z.array(z.string().min(1)).min(1),
});

export const kitMandateSchema = z.object({
  label: z.string().min(1),
  /** AiVoucherPolicy fragment — issued via POST /ai-vouchers (or /ai-vouchers/:id/child when parentRef is set). Identity/budget-declaration handle only; real spend enforcement is the actor's self-enrolled BeneficiaryVoucher + program Hooks. Future agent-passport work may collapse this seam. */
  policy: z.record(z.string(), z.unknown()).optional(),
  parentRef: z.string().optional(),
});

export const kitActorSchema = z.object({
  ref: z.string().min(1),
  label: z.string().min(1),
  /** India-format local number (self-enrol's phone validator only supports IN/LK/ZA — see kit README "Known platform limitations"). Obviously-synthetic by convention (9xxxxxxxxx block below in kit manifests). */
  phone: z.string().min(6),
  fields: z.record(z.string(), z.unknown()).default({}),
  mandate: kitMandateSchema.optional(),
  /** Starting notional budget credited as this actor's tier value (major currency units). */
  budget: z.number().nonnegative(),
  /** Overrides program.enrolMode for this one actor — see that field's doc. Lets a kit mix a few "chw" (real on-chain mint) actors with "self" (payment-flow-testable) actors. */
  enrolMode: z.enum(["self", "chw"]).optional(),
});

export const kitHookConditionSchema: z.ZodType<unknown> = z.record(z.string(), z.unknown());

export const kitHookSchema = z.object({
  name: z.string().min(1),
  event: z.enum(["enrollment", "activation", "redemption", "expiry"]),
  phase: z.enum(["pre", "post"]),
  type: z.enum(["rule", "rate_limit"]),
  description: z.string().optional(),
  /** Universal Eligibility DSL ConditionGroup — required for type:"rule". Merchant refs appear as {"$merchantRef": "<ref>"} and are resolved to real merchant ids by seed-kit.ts before POSTing. */
  ruleConfig: kitHookConditionSchema.optional(),
  /** { windowMs, limit, metric: "count" } — required for type:"rate_limit" (per-beneficiary velocity, not per-merchant; see kit README). */
  actionConfig: z.record(z.string(), z.unknown()).optional(),
  effect: z.enum(["deny", "flag", "review"]).default("deny"),
  failureBehavior: z.enum(["block", "allow"]).default("block"),
});

export const kitMandateOpSchema = z.object({
  /** issue_child: POST /ai-vouchers/:parentRef/child. revoke: DELETE /ai-vouchers/:actorRef. delegate_grandchild: attempt a further child delegation from an actor that already has depth 1 (expected to fail — see kit README). get_ledger: GET /ai-vouchers/:actorRef/ledger (read, used for re-verification-style checks). */
  op: z.enum(["issue_child", "revoke", "delegate_grandchild", "get_ledger"]),
  /** ref of the actor whose mandate this operation targets (or, for issue_child/delegate_grandchild, the PARENT actor). */
  actorRef: z.string().min(1),
  /** For issue_child/delegate_grandchild: label of the new child mandate. */
  childLabel: z.string().optional(),
  childPolicy: z.record(z.string(), z.unknown()).optional(),
});

export const kitScenarioTemplateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** null = compliant transaction (ground truth for labels.jsonl). */
  violationType: z.string().nullable(),
  /** "payment" (default): create_payment -> quote -> authorize against actorRef/merchantRef/item. "mandate_op": call an AI Voucher mandate lifecycle route instead (see mandateOp). */
  kind: z.enum(["payment", "mandate_op"]).default("payment"),
  actorRef: z.string().min(1),
  merchantRef: z.string().optional(),
  /** Item template — run-stream.ts varies qty/unitPrice within amountJitterPct for each expanded instance. Required for kind:"payment". */
  item: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    categoryCode: z.string().min(1),
    qty: z.number().int().positive(),
    unitPrice: z.number().positive(),
  }).optional(),
  /** Required for kind:"mandate_op". */
  mandateOp: kitMandateOpSchema.optional(),
  /** How many concrete transactions to expand this template into. mandate_op templates are typically count:1 (one-off lifecycle events, not a stream). */
  count: z.number().int().positive(),
  /** +/- percentage jitter applied to unitPrice per expanded instance (0 = fixed amount). */
  amountJitterPct: z.number().min(0).max(100).default(0),
  /** Simulated hour-of-week offset (0-167) each expanded instance's X-Sim-Time is anchored to. A burst uses the same hour for every instance; spread scenarios can supply a range via simHourSpread. */
  simHourOfWeek: z.number().min(0).max(167).default(60), // default: Tue ~12:00, inside business hours
  /** If >0, each of the `count` instances is offset by a random amount within [-simHourSpread, +simHourSpread] hours from simHourOfWeek. */
  simHourSpread: z.number().min(0).max(84).default(0),
  /** Minutes between consecutive instances of this template when replayed (also scaled by --speed). */
  intervalSeconds: z.number().nonnegative().default(1),
  /** What the CURRENT (as-seeded) policy is expected to decide — used by run-stream.ts's own assertions, never written to labels.jsonl (which only carries ground truth). */
  expectAllowed: z.boolean(),
}).superRefine((val, ctx) => {
  if (val.kind === "payment" && (!val.item || !val.merchantRef)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `scenario "${val.id}": kind:"payment" requires both item and merchantRef` });
  }
  if (val.kind === "mandate_op" && !val.mandateOp) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `scenario "${val.id}": kind:"mandate_op" requires mandateOp` });
  }
});

export const kitManifestSchema = z.object({
  kitId: z.string().min(1),
  title: z.string().min(1),
  track: z.string().min(1),
  description: z.string().min(1),
  program: z.object({
    slugPrefix: z.string().regex(/^[a-z0-9-]+$/, "slugPrefix must be lowercase kebab-case"),
    name: z.string().min(1),
    currency: z.string().length(3),
    currencySymbol: z.string().min(1),
    balanceModel: z.enum(["fixed", "disbursement"]),
    backingType: z.enum(["usdc_onchain"]).default("usdc_onchain"),
    settings: z.record(z.string(), z.unknown()).default({}),
    /**
     * "self" (default): POST /programs/:slug/self-enrol — caller controls
     * privyUserId (needed so run-stream.ts can quote/authorize payments as
     * that actor), but this route does not mint on-chain. "chw": POST
     * /programs/:slug/enrol — can mint on-chain when contracts are configured,
     * but never sets a payment identity, so /payments/quote cannot be reached
     * for these actors. No single route provides both — see kit 3's README
     * "Known platform limitations". Kit 3 uses "chw" to get genuine on-chain
     * mints; every other kit uses the "self" default for payment-flow testing.
     */
    enrolMode: z.enum(["self", "chw"]).default("self"),
  }),
  policy: kitPolicySchema,
  merchants: z.array(kitMerchantSchema).min(1),
  actors: z.array(kitActorSchema).min(1),
  hooks: z.array(kitHookSchema),
  violationScript: z.array(kitScenarioTemplateSchema).min(1),
  /**
   * Kit 4 only — the rule proposed after the initial stream reveals
   * undetected violations. Applied via POST /proposals and
   * POST /proposals/:id/approve, never seeded upfront. That would defeat the
   * "policy is deliberately loose" point of the kit. See kit README
   * "The rerun-after-tighten loop".
   */
  tightenedRule: z.object({
    rationale: z.string().min(1),
    policyDelta: z.record(z.string(), z.unknown()),
  }).optional(),
});

export type KitManifest = z.infer<typeof kitManifestSchema>;
export type KitActor = z.infer<typeof kitActorSchema>;
export type KitMerchant = z.infer<typeof kitMerchantSchema>;
export type KitHook = z.infer<typeof kitHookSchema>;
export type KitScenarioTemplate = z.infer<typeof kitScenarioTemplateSchema>;
export type KitMandateOp = z.infer<typeof kitMandateOpSchema>;

export function parseManifest(raw: unknown, sourcePath: string): KitManifest {
  const result = kitManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid kit manifest at ${sourcePath}:\n${issues}`);
  }
  return result.data;
}
