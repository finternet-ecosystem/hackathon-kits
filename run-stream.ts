#!/usr/bin/env npx tsx
/**
 * Vouch CDIR hackathon: run-stream.ts
 *
 * Replays a seeded kit's transaction stream against the real public API
 * (intent -> quote -> authorize, or AI Voucher mandate lifecycle) so
 * declines and ledger entries are genuine.
 *
 * Labels (scripted ground truth) go to artifacts/runs/<runId>/labels.jsonl.
 *
 * Usage:
 *   npx tsx run-stream.ts --kit=agent-mandate
 *   npx tsx run-stream.ts --kit=agent-mandate --speed=60 --run-id=smoke-1
 *   npx tsx run-stream.ts --kit=disbursement-integrity --only=mule_pattern --after-tighten
 *
 * Options:
 *   --kit=<id>          Required.
 *   --api-key=<key>     Required (or HACKATHON_ORG_API_KEY). Must be a hackathon org key.
 *   --base-url=<url>    Default: $API_BASE_URL or http://localhost:9393/api/v1
 *   --speed=<n>         Inter-transaction pacing multiplier. Default 60.
 *   --run-id=<id>       Labels artifact path id.
 *   --only=<type>       Filter by violationType (or "compliant").
 *   --after-tighten     Skip as-seeded expectAllowed checks after a policy change.
 */
import { assertHackathonOrg } from "./lib/org-guard";
import { KitApiClient, requestExpectingEither, type EitherResult } from "./lib/client";
import { parseManifest, type KitManifest } from "./lib/manifest-types";
import { expandScenarios, simHourToIso, type ScenarioInstance } from "./lib/expand-scenarios";
import { readKitState, type KitState } from "./lib/state";
import { LabelsWriter } from "./lib/labels";
import { KIT_IDS, loadManifest as loadManifestFile } from "./seed-kit";

export interface CliArgs {
  kit: string;
  apiKey: string;
  baseUrl: string;
  speed: number;
  runId: string;
  only?: string;
  afterTighten: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    kit: get("kit") ?? "",
    apiKey: get("api-key") ?? process.env.HACKATHON_ORG_API_KEY ?? "",
    baseUrl: get("base-url") ?? process.env.API_BASE_URL ?? "http://localhost:9393/api/v1",
    speed: Number(get("speed") ?? "60") || 60,
    runId: get("run-id") ?? `run-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    only: get("only"),
    afterTighten: argv.includes("--after-tighten"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
run-stream.ts - replay a CDIR hackathon sandbox kit transaction stream

Usage:
  npx tsx run-stream.ts --kit=<id> [--api-key=<key>] [options]

Kits: ${KIT_IDS.join(", ")}

  --kit=<id>         Required.
  --api-key=<key>    Required (or HACKATHON_ORG_API_KEY). Hackathon org key from
                     portal Enable Hackathon API (GET /hackathon/orgs/self).
  --base-url=<url>   Default: $API_BASE_URL or http://localhost:9393/api/v1
  --speed=<n>        Inter-tx pacing multiplier (default 60).
  --run-id=<id>      Labels go to artifacts/runs/<runId>/labels.jsonl.
  --only=<type>      Filter by violationType ("compliant" = null).
  --after-tighten    Skip as-seeded expectAllowed comparison after a policy change.
  --help             Show this help.
`);
}

export interface ReplayOutcome {
  instance: ScenarioInstance;
  txnRef: string;
  allowed: boolean;
  status: number;
  reason?: string;
}

interface TemplateSummary {
  templateId: string;
  label: string;
  violationType: string | null;
  total: number;
  allowed: number;
  denied: number;
  expectAllowed: boolean;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replayPayment(
  client: KitApiClient,
  state: KitState,
  instance: ScenarioInstance,
): Promise<ReplayOutcome> {
  const actor = state.actors.find((a) => a.ref === instance.actorRef);
  if (!actor) throw new Error(`No seeded actor for ref "${instance.actorRef}" — did seed-kit.ts run for this org?`);
  const merchant = state.merchants.find((m) => m.ref === instance.merchantRef);
  if (!merchant) throw new Error(`No seeded merchant for ref "${instance.merchantRef}" — did seed-kit.ts run for this org?`);
  if (!instance.item) throw new Error(`Scenario "${instance.kitScenarioId}" is kind:"payment" but has no item`);
  if (!actor.privyUserId) {
    throw new Error(
      `Actor "${instance.actorRef}" has no privyUserId — it was enrolled via enrolMode:"chw" (POST /programs/:slug/enrol), ` +
        `which never sets Beneficiary.beneficiaryPrivyUserId, so /payments/quote can never resolve it. This is a real ` +
        `platform limitation (see manifest-types.ts's enrolMode doc + kit README "Known platform limitations"), not a bug ` +
        `in this script — "payment" kind scenarios are incompatible with enrolMode:"chw" actors.`,
    );
  }

  const simTime = simHourToIso(instance.simHourOfWeek);
  const headers = { "x-privy-user-id": actor.privyUserId, "x-sim-time": simTime };

  const intentRes = await client.post<{ intentId: string }>("/payments/intents", {
    merchantId: merchant.id,
    programId: state.programId,
    items: [instance.item],
  });
  const intentId = intentRes.intentId;

  const quoteRes = normalizeEither(await requestExpectingEither(client, "POST", "/payments/quote", { intentId }, headers));
  if (!quoteRes.ok) {
    return { instance, txnRef: intentId, allowed: false, status: quoteRes.status, reason: extractReason(quoteRes.error) };
  }

  const authRes = normalizeEither(await requestExpectingEither(client, "POST", "/payments/authorize", { intentId }, headers));
  if (!authRes.ok) {
    return { instance, txnRef: intentId, allowed: false, status: authRes.status, reason: extractReason(authRes.error) };
  }
  return { instance, txnRef: intentId, allowed: true, status: 200 };
}

function extractReason(body: unknown): string | undefined {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.reason === "string") return b.reason;
    if (typeof b.error === "string") return b.error;
  }
  return undefined;
}

/** Collapse requestExpectingEither's discriminated union into a plain { ok, status, error? } shape — sidesteps ternary-narrowing quirks at call sites. */
function normalizeEither<T>(r: EitherResult<T>): { ok: boolean; status: number; error?: unknown } {
  if (r.ok === false) {
    const failed: { ok: false; status: number; error: unknown } = r;
    return { ok: false, status: failed.status, error: failed.error };
  }
  return { ok: true, status: r.status };
}

async function replayMandateOp(
  client: KitApiClient,
  state: KitState,
  instance: ScenarioInstance,
): Promise<ReplayOutcome> {
  const op = instance.mandateOp;
  if (!op) throw new Error(`Scenario "${instance.kitScenarioId}" is kind:"mandate_op" but has no mandateOp`);
  const actor = state.actors.find((a) => a.ref === op.actorRef);
  if (!actor) throw new Error(`No seeded actor for ref "${op.actorRef}"`);
  if (!actor.mandateId) throw new Error(`Actor "${op.actorRef}" has no mandateId — seed-kit.ts did not issue a mandate for it`);

  let result: { ok: boolean; status: number; error?: unknown };
  switch (op.op) {
    case "issue_child":
    case "delegate_grandchild": {
      const r = await requestExpectingEither(client, "POST", `/ai-vouchers/${actor.mandateId}/child`, {
        label: op.childLabel ?? "Delegated mandate",
        policy: op.childPolicy ?? {},
      });
      result = normalizeEither(r);
      break;
    }
    case "revoke": {
      const r = await requestExpectingEither(client, "DELETE", `/ai-vouchers/${actor.mandateId}`);
      result = normalizeEither(r);
      break;
    }
    case "get_ledger": {
      const r = await requestExpectingEither(client, "GET", `/ai-vouchers/${actor.mandateId}/ledger`);
      result = normalizeEither(r);
      break;
    }
    default:
      throw new Error(`Unknown mandateOp.op "${op.op}"`);
  }

  return {
    instance,
    txnRef: `mandate-op:${op.op}:${actor.mandateId}`,
    allowed: result.ok,
    status: result.status,
    reason: result.ok ? undefined : extractReason(result.error),
  };
}

export async function runStream(args: CliArgs): Promise<{ outcomes: ReplayOutcome[]; summaries: TemplateSummary[]; labelsPath: string }> {
  const manifest = loadManifestFile(args.kit) as KitManifest;
  const client = new KitApiClient({ baseUrl: args.baseUrl, apiKey: args.apiKey });
  const org = await assertHackathonOrg(client);
  const state = readKitState(manifest.kitId, org.id);
  if (!state) {
    throw new Error(`No seeded state found for kit "${manifest.kitId}" / org "${org.id}". Run seed-kit.ts first.`);
  }

  console.log(`Replaying kit "${manifest.kitId}" (${manifest.title}) for org "${org.name}" — speed=${args.speed}x, run-id=${args.runId}`);

  let templates = manifest.violationScript;
  if (args.only !== undefined) {
    const wanted = args.only === "compliant" ? null : args.only;
    templates = templates.filter((t) => t.violationType === wanted);
    if (templates.length === 0) {
      throw new Error(`--only="${args.only}" matched no scenario templates in this manifest`);
    }
  }

  const instances = expandScenarios(templates, `${manifest.kitId}:${org.id}:${args.runId}`);
  console.log(`Expanded ${templates.length} template(s) into ${instances.length} transaction instance(s).`);

  const labels = new LabelsWriter(args.runId);
  const outcomes: ReplayOutcome[] = [];
  const byTemplate = new Map<string, TemplateSummary>();

  for (const instance of instances) {
    const outcome = instance.kind === "payment"
      ? await replayPayment(client, state, instance)
      : await replayMandateOp(client, state, instance);
    outcomes.push(outcome);

    if (instance.kind === "payment") {
      labels.write({
        txnRef: outcome.txnRef,
        ts: simHourToIso(instance.simHourOfWeek),
        label: instance.violationType ? "violation" : "compliant",
        ...(instance.violationType ? { violationType: instance.violationType } : {}),
        kitScenarioId: instance.kitScenarioId,
      });
    }

    let summary = byTemplate.get(instance.templateId);
    if (!summary) {
      summary = { templateId: instance.templateId, label: instance.label, violationType: instance.violationType, total: 0, allowed: 0, denied: 0, expectAllowed: instance.expectAllowed };
      byTemplate.set(instance.templateId, summary);
    }
    summary.total += 1;
    if (outcome.allowed) summary.allowed += 1;
    else summary.denied += 1;

    const marker = outcome.allowed ? "ALLOW" : "DENY ";
    console.log(`  [${marker}] ${instance.kitScenarioId} (${instance.label})${outcome.reason ? ` — ${outcome.reason}` : ""}`);

    await sleep((instance.intervalSeconds * 1000) / args.speed);
  }

  await labels.close();

  const summaries = Array.from(byTemplate.values());
  console.log(`\nSummary (${args.afterTighten ? "after-tighten — no expectAllowed comparison" : "vs. as-seeded expectAllowed"}):`);
  for (const s of summaries) {
    const line = `  ${s.templateId}: ${s.allowed} allowed / ${s.denied} denied (of ${s.total})`;
    if (args.afterTighten) {
      console.log(line);
      continue;
    }
    const majorityAllowed = s.allowed >= s.denied;
    const matches = majorityAllowed === s.expectAllowed;
    console.log(`${line} — expected ${s.expectAllowed ? "mostly allowed" : "mostly denied"} ${matches ? "✔" : "✖ MISMATCH"}`);
  }

  console.log(`\nLabels written to: ${labels.path}`);
  return { outcomes, summaries, labelsPath: labels.path };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.kit || !KIT_IDS.includes(args.kit as (typeof KIT_IDS)[number])) {
    printHelp();
    throw new Error(`--kit is required and must be one of: ${KIT_IDS.join(", ")}`);
  }
  if (!args.apiKey) {
    printHelp();
    throw new Error("--api-key is required (or set HACKATHON_ORG_API_KEY)");
  }
  await runStream(args);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

export { parseArgs };
