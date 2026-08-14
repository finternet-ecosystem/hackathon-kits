#!/usr/bin/env npx tsx
/**
 * Vouch CDIR hackathon: seed-kit.ts
 *
 * Seeds a hackathon org into a ready-to-supervise world for one track:
 * program + policy + merchants + actors + hooks. All mutations use the
 * public HTTP API and the org's sk_test_ key (lib/client.ts). No database.
 *
 * Key source: Developer Portal → Enable Hackathon API (or organizer mint).
 *
 * Usage:
 *   npx tsx seed-kit.ts --kit=agent-mandate
 *   npx tsx seed-kit.ts --help
 *
 * Options:
 *   --kit=<id>        Required. agent-mandate | kya-licence | embedded-supervision | disbursement-integrity
 *   --api-key=<key>   Required (or HACKATHON_ORG_API_KEY). Org resolved via GET /hackathon/orgs/self.
 *   --base-url=<url>  Default: $API_BASE_URL or http://localhost:9393/api/v1
 *
 * Idempotent. No program-reset flag; use a fresh hackathon org for a clean world.
 */
import fs from "node:fs";
import path from "node:path";
import { assertHackathonOrg } from "./lib/org-guard";
import { KitApiClient, KitApiError } from "./lib/client";
import { parseManifest, type KitManifest } from "./lib/manifest-types";
import { resolveMerchantRefs } from "./lib/resolve-refs";
import { actorPrivyUserId, programSlugFor } from "./lib/synthetic";
import { writeKitState, readKitState, type KitState, type SeededActor, type SeededMerchant } from "./lib/state";

const KITS_DIR = path.join(__dirname, "kits");
const KIT_IDS = ["agent-mandate", "kya-licence", "embedded-supervision", "disbursement-integrity"] as const;

export interface CliArgs {
  kit: string;
  apiKey: string;
  baseUrl: string;
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
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
seed-kit.ts - seed a CDIR hackathon sandbox kit into a hackathon org

Usage:
  npx tsx seed-kit.ts --kit=<id> [--api-key=<key>] [--base-url=<url>]

Kits: ${KIT_IDS.join(", ")}

  --kit=<id>        Required. One of the kit ids above.
  --api-key=<key>   Required (or HACKATHON_ORG_API_KEY). Org resolved via
                    GET /hackathon/orgs/self. Key from portal Enable Hackathon API
                    (or organizer mint). Non-hackathon orgs are refused.
  --base-url=<url>  Default: $API_BASE_URL or http://localhost:9393/api/v1
  --help            Show this help.
`);
}

function loadManifest(kitId: string): KitManifest {
  const p = path.join(KITS_DIR, `${kitId}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`No manifest for kit "${kitId}" at ${p}. Known kits: ${KIT_IDS.join(", ")}`);
  }
  return parseManifest(JSON.parse(fs.readFileSync(p, "utf-8")), p);
}

async function waitForProgramContracts(client: KitApiClient, slug: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.get<{ program: { programContracts?: { factoryAddress?: string; status?: string } | null } }>(`/programs/${slug}`);
    const pc = res.program.programContracts;
    // "0x" is the placeholder written on a FAILED deploy attempt (see
    // deploy-contracts.ts) — a truthy string, but not a real address. Only
    // status:"ACTIVE" with a real factoryAddress counts as success.
    if (pc?.status === "ACTIVE" && pc.factoryAddress && pc.factoryAddress !== "0x") return true;
    if (pc?.status === "DEPLOY_FAILED") return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function findExistingProgram(client: KitApiClient, slug: string): Promise<{ id: string } | null> {
  try {
    const res = await client.get<{ program: { id: string } }>(`/programs/${slug}`);
    return res.program;
  } catch (err) {
    if (err instanceof KitApiError && err.status === 404) return null;
    throw err;
  }
}

async function seedKit(args: CliArgs): Promise<void> {
  const manifest = loadManifest(args.kit);
  const client = new KitApiClient({ baseUrl: args.baseUrl, apiKey: args.apiKey });
  const org = await assertHackathonOrg(client);
  console.log(`Seeding kit "${manifest.kitId}" (${manifest.title}) for hackathon org "${org.name}" (${org.id})`);

  const programSlug = programSlugFor(manifest.program.slugPrefix, org.id);

  const existing = await findExistingProgram(client, programSlug);
  if (existing) {
    const prev = readKitState(manifest.kitId, org.id);
    console.log(`Kit already seeded (program "${programSlug}", id ${existing.id}) — idempotent no-op.`);
    if (prev) {
      console.log(`  merchants: ${prev.merchants.length}, actors: ${prev.actors.length}, hooks: ${prev.hooks.length}`);
      console.log(`  state file: artifacts/kits/${manifest.kitId}-${org.id}.json`);
    }
    return;
  }

  // ── 1. Program ────────────────────────────────────────────────────────
  const programRes = await client.post<{ program: { id: string } }>("/programs", {
    slug: programSlug,
    name: `${manifest.program.name} (${org.name})`,
    currency: manifest.program.currency,
    currencySymbol: manifest.program.currencySymbol,
    balanceModel: manifest.program.balanceModel,
    backingType: manifest.program.backingType,
    settings: manifest.program.settings,
  });
  const programId = programRes.program.id;
  console.log(`✔ Program "${programSlug}" created (${programId})`);

  // Contract auto-deploy (POST /programs's deployProgramContracts) is
  // fire-and-forget — the 201 response returns before it finishes. Any kit
  // with a "chw"-enrolled actor needs the real ProgramContracts row to
  // exist BEFORE enrolling (program-enrol.ts's on-chain mint branch checks
  // `contracts && config.deployerKey && valueUSDC > 0n`; without a
  // ProgramContracts row it silently falls back to DB-only enrollment).
  const needsContracts = manifest.actors.some((a) => (a.enrolMode ?? manifest.program.enrolMode) === "chw");
  if (needsContracts) {
    console.log("  Waiting for on-chain contract auto-deploy...");
    const deployed = await waitForProgramContracts(client, programSlug, 15_000);
    console.log(deployed ? "  ✔ Contracts deployed" : "  ⚠ Contracts did not appear within 30s — chw-enrolled actors below will fall back to DB-only enrollment");
  }

  // ── 2. Policy ─────────────────────────────────────────────────────────
  const policyRes = await client.post<{ policy: { id: string } }>("/policy", {
    name: `${manifest.title} Policy`,
    programId,
  });
  const policyId = policyRes.policy.id;
  await client.put(`/policy/${policyId}`, {
    tiers: manifest.policy.tiers,
    eligibilityRules: manifest.policy.eligibilityRules,
    categories: manifest.policy.categories,
  });
  await client.post(`/policy/${policyId}/activate`);
  console.log(`✔ Policy activated (${manifest.policy.tiers.length} tiers, ${manifest.policy.categories.length} categories)`);

  // ── 3. Merchants ──────────────────────────────────────────────────────
  const merchants: SeededMerchant[] = [];
  const merchantIdByRef: Record<string, string> = {};
  for (const m of manifest.merchants) {
    const res = await client.post<{ merchant: { id: string; name: string }; walletProvisioning?: string }>("/merchants/register", {
      name: m.name,
      approvedCategories: m.approvedCategories,
    });
    await client.post(`/merchants/${res.merchant.id}/assign`, { programId });
    merchants.push({ ref: m.ref, id: res.merchant.id, name: res.merchant.name });
    merchantIdByRef[m.ref] = res.merchant.id;
    const note = res.walletProvisioning ? ` (${res.walletProvisioning})` : "";
    console.log(`✔ Merchant "${m.name}" registered + assigned${note}`);
  }

  // ── 4. Hooks ──────────────────────────────────────────────────────────
  const hooks: Array<{ name: string; id: string }> = [];
  for (const h of manifest.hooks) {
    const ruleConfig = h.ruleConfig ? resolveMerchantRefs(h.ruleConfig, merchantIdByRef) : undefined;
    const res = await client.post<{ hook: { id: string } }>(`/programs/${programSlug}/hooks`, {
      event: h.event,
      phase: h.phase,
      name: h.name,
      description: h.description ?? "",
      type: h.type,
      ruleConfig,
      actionConfig: h.actionConfig,
      actionType: h.type === "rate_limit" ? "rate_limit" : "gate",
      effect: h.effect,
      failureBehavior: h.failureBehavior,
    });
    hooks.push({ name: h.name, id: res.hook.id });
    console.log(`✔ Hook "${h.name}" created (${res.hook.id})`);
  }

  // ── 5. Actors (spending wallet + AI Voucher mandate identity) ────────────
  // enrolMode "self" (default, POST .../self-enrol): caller controls
  // privyUserId, so run-stream.ts can quote/authorize payments as this
  // actor — but this route never mints on-chain (DB-only always).
  // enrolMode "chw" (POST .../enrol, Kit 3 only): mints for real when a
  // deployer key + contracts are configured, but sets no privyUserId, so
  // this actor can never be used in a "payment" kind scenario (no route
  // exists to reach /payments/quote for it) — see manifest-types.ts.
  const actors: SeededActor[] = [];
  const mandateIdByRef: Record<string, string> = {};

  for (const actor of manifest.actors) {
    const chwMode = (actor.enrolMode ?? manifest.program.enrolMode) === "chw";
    const privyUserId = actorPrivyUserId(manifest.kitId, org.id, actor.ref);

    let beneficiaryId: string;
    let tokenId: number;
    if (chwMode) {
      const enrolRes = await client.post<{ beneficiary: { id: string; tokenId: number; tier: number; value: number }; onChain: boolean; txHash: string | null }>(
        `/programs/${programSlug}/enrol`,
        { phone: actor.phone, fields: actor.fields },
      );
      beneficiaryId = enrolRes.beneficiary.id;
      tokenId = enrolRes.beneficiary.tokenId;
      console.log(`✔ Actor "${actor.ref}" enrolled via CHW route (beneficiary ${beneficiaryId}, tokenId ${tokenId}, tier ${enrolRes.beneficiary.tier}, onChain=${enrolRes.onChain}${enrolRes.txHash ? `, tx=${enrolRes.txHash}` : ""})`);
    } else {
      const enrolRes = await client.post<{ beneficiary: { id: string; tokenId: number; tier: number; value: number } }>(
        `/programs/${programSlug}/self-enrol`,
        {
          privyUserId,
          fields: { ...actor.fields, phone: actor.phone },
        },
      );
      beneficiaryId = enrolRes.beneficiary.id;
      tokenId = enrolRes.beneficiary.tokenId;
      console.log(`✔ Actor "${actor.ref}" self-enrolled (beneficiary ${beneficiaryId}, tokenId ${tokenId}, tier ${enrolRes.beneficiary.tier}, budget ${enrolRes.beneficiary.value})`);
    }

    let mandateId: string | undefined;
    let mandateKeyPrefix: string | undefined;
    if (actor.mandate) {
      const parentMandateId = actor.mandate.parentRef ? mandateIdByRef[actor.mandate.parentRef] : undefined;
      if (actor.mandate.parentRef && !parentMandateId) {
        throw new Error(`Actor "${actor.ref}" mandate.parentRef "${actor.mandate.parentRef}" has no mandate yet — check manifest actor ordering (parents must precede children).`);
      }
      const mandatePath = parentMandateId ? `/ai-vouchers/${parentMandateId}/child` : "/ai-vouchers";
      const mandateRes = await client.post<{ id: string; keyPrefix: string }>(mandatePath, {
        label: actor.mandate.label,
        policy: actor.mandate.policy ?? {},
        metadata: { kitId: manifest.kitId, orgId: org.id, actorRef: actor.ref },
      });
      mandateId = mandateRes.id;
      mandateKeyPrefix = mandateRes.keyPrefix;
      mandateIdByRef[actor.ref] = mandateId;
      console.log(`  ✔ Mandate "${actor.mandate.label}" issued (${mandateId}${parentMandateId ? `, child of ${parentMandateId}` : ""})`);
    }

    actors.push({
      ref: actor.ref,
      beneficiaryId,
      tokenId,
      // chw-enrolled actors have no beneficiaryPrivyUserId on their
      // Beneficiary row (see enrolMode note above) — mark clearly rather
      // than storing a privyUserId that would never actually resolve.
      privyUserId: chwMode ? "" : privyUserId,
      mandateId,
      mandateKeyPrefix,
    });
  }

  // ── 6. Persist state sidecar for run-stream.ts ───────────────────────
  const state: KitState = {
    kitId: manifest.kitId,
    orgId: org.id,
    programId,
    programSlug,
    merchants,
    actors,
    hooks,
    seededAt: new Date().toISOString(),
  };
  writeKitState(state);

  console.log(`\nSeeded "${manifest.kitId}" for org ${org.id}:`);
  console.log(`  program:  ${programSlug} (${programId})`);
  console.log(`  merchants: ${merchants.length}`);
  console.log(`  actors:    ${actors.length}`);
  console.log(`  hooks:     ${hooks.length}`);
  console.log(`\nNext: npx tsx run-stream.ts --kit=${manifest.kitId} --api-key=<key>`);
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
  await seedKit(args);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

export { seedKit, parseArgs, loadManifest, KIT_IDS };
