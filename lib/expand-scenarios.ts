/**
 * Expands a kit manifest's `violationScript` templates into concrete
 * transaction instances. Kept separate from run-stream.ts so it's unit
 * testable without a live backend (pure function, deterministic given a
 * seed).
 */
import type { KitMandateOp, KitScenarioTemplate } from "./manifest-types";
import { mulberry32, hashStringToSeed } from "./rng";

export interface ScenarioInstance {
  kitScenarioId: string;
  templateId: string;
  label: string;
  violationType: string | null;
  kind: "payment" | "mandate_op";
  actorRef: string;
  merchantRef?: string;
  item?: { sku: string; name: string; categoryCode: string; qty: number; unitPrice: number };
  mandateOp?: KitMandateOp;
  /** Hour-of-simulated-week (0-167) this instance's X-Sim-Time is anchored to. */
  simHourOfWeek: number;
  /** What the CURRENT (as-seeded) policy is expected to decide. */
  expectAllowed: boolean;
  /** See KitScenarioTemplate.expectedReasonContains. */
  expectedReasonContains?: string;
  /** Real wall-clock delay (ms, before --speed scaling) since the previous instance. */
  intervalSeconds: number;
}

/**
 * Expand every template in `templates`, in manifest order, into
 * `template.count` instances each (also in order — later templates run
 * after earlier ones finish). `seedKey` makes jitter/spread reproducible
 * across repeated runs against the same kit+org.
 */
export function expandScenarios(templates: KitScenarioTemplate[], seedKey: string): ScenarioInstance[] {
  const rng = mulberry32(hashStringToSeed(seedKey));
  const instances: ScenarioInstance[] = [];

  for (const tmpl of templates) {
    for (let i = 0; i < tmpl.count; i++) {
      const spread = tmpl.simHourSpread > 0 ? (rng() * 2 - 1) * tmpl.simHourSpread : 0;
      const simHourOfWeek = Math.min(167, Math.max(0, tmpl.simHourOfWeek + spread));

      const item = tmpl.item
        ? (() => {
            const jitterFrac = tmpl.amountJitterPct > 0 ? 1 + (rng() * 2 - 1) * (tmpl.amountJitterPct / 100) : 1;
            const unitPrice = Math.max(1, Math.round(tmpl.item!.unitPrice * jitterFrac * 100) / 100);
            return { ...tmpl.item!, unitPrice };
          })()
        : undefined;

      instances.push({
        kitScenarioId: `${tmpl.id}-${String(i + 1).padStart(3, "0")}`,
        templateId: tmpl.id,
        label: tmpl.label,
        violationType: tmpl.violationType,
        kind: tmpl.kind,
        actorRef: tmpl.actorRef,
        merchantRef: tmpl.merchantRef,
        item,
        mandateOp: tmpl.mandateOp,
        simHourOfWeek,
        expectAllowed: tmpl.expectAllowed,
        ...(tmpl.expectedReasonContains ? { expectedReasonContains: tmpl.expectedReasonContains } : {}),
        intervalSeconds: tmpl.intervalSeconds,
      });
    }
  }

  return instances;
}

/**
 * Convert an hour-of-simulated-week (0-167, week starting Monday 00:00) into
 * an ISO timestamp, anchored at a fixed reference Monday. Business-hours
 * conditions (Mon-Fri 09:00-17:00) map to hours [9-17, 33-41, 57-65, 81-89,
 * 105-113].
 *
 * Built with `Date.UTC`, not the local `Date` constructor: the backend's
 * `engine/context/time.ts` (`buildTimeContext`) reads `time.hour`/
 * `time.day_of_week` from this timestamp via `getUTCHours()`/`getUTCDay()`.
 * Anchoring "hour 9" to UTC here keeps it meaning UTC hour 9 on the server
 * regardless of which timezone this script happens to run in — a hackathon
 * team's own laptop, CI, or the deployed box are not guaranteed to share a
 * timezone with the hosted backend.
 */
const SIM_WEEK_START_YEAR = 2026;
const SIM_WEEK_START_MONTH_INDEX = 7; // August (0-indexed)
const SIM_WEEK_START_DAY = 3; // a Monday

export function simHourToIso(hourOfWeek: number): string {
  const dayOffset = Math.floor(hourOfWeek / 24);
  const hourOfDay = hourOfWeek % 24;
  const d = new Date(Date.UTC(SIM_WEEK_START_YEAR, SIM_WEEK_START_MONTH_INDEX, SIM_WEEK_START_DAY + dayOffset, hourOfDay, 0, 0, 0));
  return d.toISOString();
}
