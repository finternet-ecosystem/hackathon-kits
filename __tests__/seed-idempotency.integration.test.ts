/**
 * seed-kit.ts idempotency, against a REAL running backend (no database
 * access from this repo — see README "Architecture (API-key only)").
 * Skip-if-unavailable pattern: a genuine no-op (not a failure) in any
 * environment without a reachable backend + admin key, e.g. a bare
 * `npm test` in CI.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { seedKit } from "../seed-kit";
import { readKitState } from "../lib/state";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:9393/api/v1";
const ADMIN_KEY = process.env.HACKATHON_ADMIN_KEY || "";

let backendAvailable = false;

async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL.replace(/\/api\/v1$/, "")}/health`).catch(() => fetch(BASE_URL));
    return res.status < 500;
  } catch {
    return false;
  }
}

async function provisionOrg(teamName: string): Promise<{ orgId: string; apiKey: string }> {
  const res = await fetch(`${BASE_URL}/hackathon/orgs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hackathon-admin-key": ADMIN_KEY },
    body: JSON.stringify({ teamName, email: `${teamName.toLowerCase().replace(/\s+/g, "-")}@example.com` }),
  });
  const body = (await res.json()) as { orgId: string; apiKey: string | null };
  if (!body.apiKey) {
    // Already provisioned from a previous run of this suite — mint a fresh key.
    const res2 = await fetch(`${BASE_URL}/hackathon/orgs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hackathon-admin-key": ADMIN_KEY },
      body: JSON.stringify({ teamName, email: `${teamName.toLowerCase().replace(/\s+/g, "-")}@example.com`, mintKey: true, keyName: "test" }),
    });
    const body2 = (await res2.json()) as { orgId: string; apiKey: string };
    return { orgId: body2.orgId, apiKey: body2.apiKey };
  }
  return { orgId: body.orgId, apiKey: body.apiKey };
}

describe("seed-kit.ts idempotency (integration)", () => {
  before(async () => {
    backendAvailable = Boolean(ADMIN_KEY) && (await checkBackend());
  });

  it("seeding the same kit twice is a no-op: same program, same counts", async (t) => {
    if (!backendAvailable) {
      t.skip("No live backend reachable at API_BASE_URL (or HACKATHON_ADMIN_KEY unset) — set both to run this integration test.");
      return;
    }

    const teamName = `Idempotency Test ${crypto.randomBytes(4).toString("hex")}`;
    const { orgId, apiKey } = await provisionOrg(teamName);

    const args = { kit: "agent-mandate", apiKey, baseUrl: BASE_URL, help: false };

    await seedKit(args);
    const stateAfterFirst = readKitState("agent-mandate", orgId);
    assert.ok(stateAfterFirst, "state file must exist after first seed");

    await seedKit(args); // second call
    const stateAfterSecond = readKitState("agent-mandate", orgId);
    assert.ok(stateAfterSecond);

    // Idempotent no-op: seed-kit.ts's own program-exists check short-circuits
    // before touching anything, so the state file (and therefore the
    // program/merchant/actor counts) is byte-identical to the first run.
    assert.equal(stateAfterSecond!.programId, stateAfterFirst!.programId);
    assert.equal(stateAfterSecond!.merchants.length, stateAfterFirst!.merchants.length);
    assert.equal(stateAfterSecond!.actors.length, stateAfterFirst!.actors.length);
    assert.equal(stateAfterSecond!.hooks.length, stateAfterFirst!.hooks.length);
    assert.deepEqual(
      stateAfterSecond!.merchants.map((m) => m.id).sort(),
      stateAfterFirst!.merchants.map((m) => m.id).sort(),
    );
  });
});
