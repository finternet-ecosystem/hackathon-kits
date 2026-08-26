/**
 * Shared types for persona behavior modules.
 *
 * A persona is a pure function: (world, params, seed) -> PersonaAction[].
 * No I/O, no network — `src/engine.ts` is the only thing that actually
 * executes actions against the platform. This keeps personas independently
 * unit-testable for determinism (same seed -> same tx sequence + labels)
 * without a live backend, mirroring the "evaluator stays pure computation"
 * discipline `backend/src/engine/` follows for the same reason.
 */

export interface ActorInfo {
  /** Manifest-level ref (e.g. "parent", "child-1") — stable across runs. */
  ref: string;
  /** Deterministic x-privy-user-id for this actor (see lib/identity.ts). */
  privyUserId: string;
  /** Actor's nominal budget/quota (major currency units) — personas use this to size violations relative to what SHOULD be allowed. */
  budget: number;
  /** Categories this actor's tier is nominally allowed to buy (informational; used by compliant-shopper + category-drifter). */
  allowedCategories: string[];
}

export interface MerchantInfo {
  /** Manifest-level ref (e.g. "m1") — stable across runs. */
  ref: string;
  /** Real platform merchant id, resolved via GET /merchants at engine startup. */
  id: string;
  name: string;
  approvedCategories: string[];
}

export interface PersonaItem {
  sku: string;
  name: string;
  categoryCode: string;
  qty: number;
  unitPrice: number;
}

export interface PersonaAction {
  /** Unique within a run — becomes the labels.jsonl kitScenarioId. */
  kitScenarioId: string;
  /** Groups actions from the same persona "template" for scorer/report grouping — analogous to 03's templateId. */
  templateId: string;
  label: string;
  /** null = compliant (ground truth). Non-null = the specific violation kind this persona intended. */
  violationType: string | null;
  actorRef: string;
  merchantRef: string;
  item: PersonaItem;
  /** Hour-of-simulated-week (0-167) this action's X-Sim-Time is anchored to. */
  simHourOfWeek: number;
  /** Real wall-clock delay (ms, before --speed scaling) since the previous action from the SAME persona. */
  intervalSeconds: number;
}

export interface PersonaWorld {
  actors: ActorInfo[];
  merchants: MerchantInfo[];
  /** All category codes known to the program's policy. */
  categories: string[];
}

/** Free-form per-persona knobs from the scenario YAML's `params:` block. Each persona documents its own accepted keys and defaults. */
export type PersonaParams = Record<string, unknown>;

export interface PersonaGenContext {
  world: PersonaWorld;
  count: number;
  params: PersonaParams;
  /** Deterministic seed key — SAME seedKey always yields the SAME output. Composed by the engine as `${scenarioId}:${personaType}:${personaIndex}`. */
  seedKey: string;
}

export interface Persona {
  id: string;
  description: string;
  generate(ctx: PersonaGenContext): PersonaAction[];
}

// ─── Small shared helpers used by multiple personas ────────────────────────

export function numParam(params: PersonaParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function strParam(params: PersonaParams, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

export function arrParam(params: PersonaParams, key: string): unknown[] | undefined {
  const v = params[key];
  return Array.isArray(v) ? v : undefined;
}
