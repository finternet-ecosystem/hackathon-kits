#!/usr/bin/env npx tsx
/**
 * arena/src/engine.ts
 *
 * Scheduler: loads a scenario YAML, resolves the real program/merchant ids
 * for the target org via the platform's public API, spawns each declared
 * persona, and replays every resulting action against the REAL API
 * (create intent -> quote -> authorize) — never a direct DB write, matching
 * the repo root's run-stream.ts architecture, which this generalizes.
 *
 * Modes:
 *   one-shot (default): runs every persona's generated actions once, end to
 *     end, then exits. Paced by `intervalSeconds / speed` between actions
 *     from the SAME persona (sequential across personas). Self-throttled to
 *     a conservative request rate (default 300/min — well under the
 *     platform's 600/min global limit) so a high --speed can't itself
 *     become the incident.
 *   continuous: repeats the full persona cycle until --duration elapses.
 *     REQUIRES --duration (a bounded run) — arena refuses to start an
 *     unbounded continuous run, so it can never be left running by
 *     accident. Self-throttled to <=20/min/org — see arena/README.md
 *     "Modes".
 *
 * Usage:
 *   npx tsx src/engine.ts --scenario=scenarios/track3-week.yaml --org=<orgId> --key=<apiKey>
 *   npx tsx src/engine.ts --scenario=scenarios/track3-week.yaml --org=<orgId> --key=<apiKey> --speed=60 --run-id=smoke-1
 *   npx tsx src/engine.ts --scenario=scenarios/track3-week.yaml --org=<orgId> --key=<apiKey> --mode=continuous --duration=90s
 *   npx tsx src/engine.ts --help
 */
import path from "node:path";
import { loadScenarioFile, type Scenario, type PersonaEntry } from "./scenario-schema";
import { ArenaApiClient } from "./lib/client";
import { actorPrivyUserId, programSlugFor } from "./lib/identity";
import { simHourToIso } from "./lib/sim-time";
import { RateLimiter } from "./lib/rate-limiter";
import { LabelsWriter } from "./labels";
import { getPersona, PERSONA_IDS, type PersonaAction, type PersonaWorld } from "./personas";

export interface CliArgs {
  scenario: string;
  org: string;
  apiKey: string;
  baseUrl: string;
  speed: number;
  runId: string;
  mode: "one-shot" | "continuous";
  duration?: string;
  rateLimitPerMin?: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const mode = get("mode") === "continuous" ? "continuous" : "one-shot";
  return {
    scenario: get("scenario") ?? "",
    org: get("org") ?? "",
    apiKey: get("api-key") ?? get("key") ?? process.env.ARENA_API_KEY ?? "",
    baseUrl: get("base-url") ?? process.env.API_BASE_URL ?? "http://localhost:9393/api/v1",
    speed: Number(get("speed") ?? "60") || 60,
    runId: get("run-id") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    mode,
    duration: get("duration"),
    rateLimitPerMin: get("rate-limit") ? Number(get("rate-limit")) : undefined,
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
engine.ts — Vouch hackathon arena scheduler

Usage:
  npx tsx src/engine.ts --scenario=<path> --org=<orgId> --api-key=<key> [options]

  --scenario=<path>   Required. Path to a scenario YAML (see scenarios/track3-week.yaml).
  --org=<orgId>        Required. Must be a hackathon org (POST /hackathon/orgs) already seeded with the scenario's kit.
  --api-key=<key>      Required (or --key=, or $ARENA_API_KEY). The org's API key.
  --base-url=<url>     Default: $API_BASE_URL or http://localhost:9393/api/v1
  --speed=<n>          Real-time compression multiplier for inter-tx pacing (default 60).
  --run-id=<id>        Default: timestamp-based. Labels go to artifacts/runs/<runId>/labels.jsonl.
  --mode=<mode>        "one-shot" (default) or "continuous".
  --duration=<dur>     REQUIRED for --mode=continuous (e.g. "90s", "10m", "1h"). Bounds the run — arena never runs unbounded.
  --rate-limit=<n>     Override the self-imposed requests/min cap (default: 300 one-shot, 20 continuous).
  --help               Show this help.

Known persona types: ${PERSONA_IDS.join(", ")}
`);
}

function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(s.trim());
  if (!m) throw new Error(`Invalid --duration "${s}" — expected e.g. "90s", "10m", "1h"`);
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000;
  return n * mult;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ResolvedTarget {
  programId: string;
  programSlug: string;
  world: PersonaWorld;
}

/** Resolves the scenario's declared actors/merchants against the REAL platform (program id + merchant ids) via public API calls only — no DB/file access. */
export async function resolveTarget(client: ArenaApiClient, scenario: Scenario, orgId: string): Promise<ResolvedTarget> {
  const programSlug = programSlugFor(scenario.slugPrefix, orgId);
  const programRes = await client.get<{ program: { id: string } }>(`/programs/${programSlug}`);
  const programId = programRes.program.id;

  const merchantsRes = await client.get<{ merchants: Array<{ id: string; name: string }> }>(
    `/merchants?programId=${encodeURIComponent(programId)}`,
  );
  const byName = new Map(merchantsRes.merchants.map((m) => [m.name, m.id]));

  const resolvedMerchants = scenario.merchants.map((m) => {
    const id = byName.get(m.name);
    if (!id) {
      throw new Error(
        `Merchant "${m.name}" (ref "${m.ref}") not found via GET /merchants?programId=${programId} — ` +
          `did seed-kit.ts run for this org/kit? (kit="${scenario.kit}")`,
      );
    }
    return { ref: m.ref, id, name: m.name, approvedCategories: m.approvedCategories };
  });

  const resolvedActors = scenario.actors.map((a) => ({
    ref: a.ref,
    privyUserId: actorPrivyUserId(scenario.kit, orgId, a.ref),
    budget: a.budget,
    allowedCategories: a.allowedCategories,
  }));

  return {
    programId,
    programSlug,
    world: { actors: resolvedActors, merchants: resolvedMerchants, categories: scenario.categories },
  };
}

export interface ReplayOutcome {
  action: PersonaAction;
  txnRef: string;
  allowed: boolean;
  status: number;
  reason?: string;
}

function extractReason(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.reason === "string") return b.reason;
    if (typeof b.error === "string") return b.error;
  }
  return undefined;
}

async function replayAction(
  client: ArenaApiClient,
  limiter: RateLimiter,
  target: ResolvedTarget,
  action: PersonaAction,
): Promise<ReplayOutcome> {
  const actor = target.world.actors.find((a) => a.ref === action.actorRef);
  if (!actor) throw new Error(`No resolved actor for ref "${action.actorRef}"`);
  const merchant = target.world.merchants.find((m) => m.ref === action.merchantRef);
  if (!merchant) throw new Error(`No resolved merchant for ref "${action.merchantRef}"`);

  const simTime = simHourToIso(action.simHourOfWeek);
  const headers = { "x-privy-user-id": actor.privyUserId, "x-sim-time": simTime };

  await limiter.acquire();
  const intentRes = await client.post<{ intentId: string }>("/payments/intents", {
    merchantId: merchant.id,
    programId: target.programId,
    items: [action.item],
  });
  const intentId = intentRes.intentId;

  await limiter.acquire();
  const quoteRes = await client.requestEither("POST", "/payments/quote", { intentId }, headers);
  if (!quoteRes.ok) {
    return { action, txnRef: intentId, allowed: false, status: quoteRes.status, reason: extractReason(quoteRes.error) };
  }

  await limiter.acquire();
  const authRes = await client.requestEither("POST", "/payments/authorize", { intentId }, headers);
  if (!authRes.ok) {
    return { action, txnRef: intentId, allowed: false, status: authRes.status, reason: extractReason(authRes.error) };
  }
  return { action, txnRef: intentId, allowed: true, status: 200 };
}

function generateAllActions(scenario: Scenario, world: PersonaWorld, runId: string): PersonaAction[] {
  const actions: PersonaAction[] = [];
  scenario.personas.forEach((entry: PersonaEntry, index: number) => {
    const persona = getPersona(entry.type);
    const seedKey = `${scenario.scenarioId}:${entry.type}:${index}:${runId}`;
    actions.push(...persona.generate({ world, count: entry.count, params: entry.params, seedKey }));
  });
  return actions;
}

export async function runScenario(args: CliArgs, scenario: Scenario): Promise<{ outcomes: ReplayOutcome[]; labelsPath: string }> {
  const client = new ArenaApiClient({ baseUrl: args.baseUrl, apiKey: args.apiKey });
  const target = await resolveTarget(client, scenario, args.org);
  const speed = args.mode === "continuous" ? scenario.simTimeSpeed : args.speed;
  const defaultRate = args.mode === "continuous" ? 20 : 300;
  const limiter = new RateLimiter(args.rateLimitPerMin ?? defaultRate);
  const labels = new LabelsWriter(args.runId);

  console.log(
    `Running scenario "${scenario.scenarioId}" (kit=${scenario.kit}) against org "${args.org}" ` +
      `(program ${target.programSlug}) — mode=${args.mode}, speed=${speed}x, run-id=${args.runId}, ` +
      `rate-limit=${args.rateLimitPerMin ?? defaultRate}/min`,
  );

  const durationMs = args.mode === "continuous" ? parseDuration(args.duration!) : undefined;
  const deadline = durationMs !== undefined ? Date.now() + durationMs : undefined;

  const outcomes: ReplayOutcome[] = [];
  let cycle = 0;
  do {
    cycle += 1;
    const actions = generateAllActions(scenario, target.world, args.mode === "continuous" ? `${args.runId}-cycle${cycle}` : args.runId);
    console.log(`[cycle ${cycle}] ${actions.length} action(s) generated across ${scenario.personas.length} persona(s).`);

    for (const action of actions) {
      if (deadline !== undefined && Date.now() >= deadline) break;
      const outcome = await replayAction(client, limiter, target, action);
      outcomes.push(outcome);

      labels.write({
        txnRef: outcome.txnRef,
        ts: simHourToIso(action.simHourOfWeek),
        label: action.violationType ? "violation" : "compliant",
        ...(action.violationType ? { violationType: action.violationType } : {}),
        kitScenarioId: action.kitScenarioId,
      });

      const marker = outcome.allowed ? "ALLOW" : "DENY ";
      console.log(`  [${marker}] ${action.kitScenarioId} (${action.label})${outcome.reason ? ` — ${outcome.reason}` : ""}`);

      await sleep((action.intervalSeconds * 1000) / speed);
    }
  } while (deadline !== undefined && Date.now() < deadline);

  await labels.close();

  const violations = outcomes.filter((o) => o.action.violationType !== null).length;
  const compliant = outcomes.length - violations;
  console.log(
    `\nDone. ${outcomes.length} transaction(s) replayed (${compliant} ground-truth compliant, ${violations} ground-truth violation) ` +
      `across ${cycle} cycle(s). Labels written to: ${labels.path}`,
  );

  return { outcomes, labelsPath: labels.path };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.scenario) {
    printHelp();
    throw new Error("--scenario is required");
  }
  if (!args.org) {
    printHelp();
    throw new Error("--org is required");
  }
  if (!args.apiKey) {
    printHelp();
    throw new Error("--api-key is required (or --key=, or set ARENA_API_KEY)");
  }
  if (args.mode === "continuous" && !args.duration) {
    throw new Error(
      "--mode=continuous requires --duration=<dur> (e.g. --duration=10m) — arena refuses to start an unbounded run.",
    );
  }

  const scenarioPath = path.resolve(args.scenario);
  const scenario = loadScenarioFile(scenarioPath);
  await runScenario(args, scenario);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

export { parseArgs, parseDuration };
