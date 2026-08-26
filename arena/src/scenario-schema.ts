/**
 * Scenario YAML schema:
 *   {kit, duration, simTimeSpeed, personas: [{type, count, params}]}
 *
 * Also declares the "target" a scenario runs against (org id / api key /
 * base url / kit id / program slug prefix / actors / merchants / policy
 * categories) — the minimum public information arena needs to resolve real
 * program/merchant ids via the platform's own API at engine startup (see
 * lib/identity.ts's doc comment for why this doesn't need direct DB/file
 * access to a kit's seeded state).
 */
import { z } from "zod";
import fs from "node:fs";
import yaml from "js-yaml";

export const personaEntrySchema = z.object({
  type: z.string().min(1),
  count: z.number().int().nonnegative(),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const scenarioActorSchema = z.object({
  ref: z.string().min(1),
  /** Nominal budget/quota (major currency units) — used by personas to size violations. */
  budget: z.number().nonnegative(),
  /** Category codes this actor's tier is nominally allowed to buy. */
  allowedCategories: z.array(z.string().min(1)).default([]),
});

export const scenarioMerchantSchema = z.object({
  ref: z.string().min(1),
  /** Must match the merchant's `name` as seeded on the platform — resolved to a real id via GET /merchants at engine startup. */
  name: z.string().min(1),
  approvedCategories: z.array(z.string().min(1)).min(1),
});

export const scenarioSchema = z.object({
  scenarioId: z.string().min(1),
  /** Which kit this scenario targets — used only to derive the deterministic actor privyUserId/program-slug convention (lib/identity.ts), not to load any kit file. */
  kit: z.string().min(1),
  /** Program slugPrefix from the kit manifest (e.g. "agent-mandate") — combined with orgId to compute the real program slug. */
  slugPrefix: z.string().min(1),
  duration: z.string().min(1).optional().describe("Informational only (e.g. '1w') — actual duration is governed by persona counts/intervals and --speed."),
  simTimeSpeed: z.number().positive().default(60),
  actors: z.array(scenarioActorSchema).min(1),
  merchants: z.array(scenarioMerchantSchema).min(1),
  categories: z.array(z.string().min(1)).min(1),
  personas: z.array(personaEntrySchema).min(1),
});

export type PersonaEntry = z.infer<typeof personaEntrySchema>;
export type ScenarioActor = z.infer<typeof scenarioActorSchema>;
export type ScenarioMerchant = z.infer<typeof scenarioMerchantSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;

export function parseScenario(raw: unknown, sourcePath: string): Scenario {
  const result = scenarioSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`Invalid scenario at ${sourcePath}:\n${issues}`);
  }
  return result.data;
}

export function loadScenarioFile(filePath: string): Scenario {
  const raw = yaml.load(fs.readFileSync(filePath, "utf-8"));
  return parseScenario(raw, filePath);
}
