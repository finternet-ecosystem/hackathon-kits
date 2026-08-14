/**
 * Unit coverage for lib/org-guard.ts's assertHackathonOrg — the "DEMO orgs
 * only, refuse otherwise" safety gate seed-kit.ts/run-stream.ts run before
 * touching an org. Mocks global.fetch so this exercises the real HTTP
 * request/response handling in lib/client.ts + lib/org-guard.ts without
 * needing a live backend — this repo's only "org refuses to run" coverage,
 * replacing what used to be a Prisma-backed integration test fixture (not
 * portable outside the platform monorepo — see README "Extraction notes").
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { KitApiClient } from "../lib/client";
import { assertHackathonOrg, NotAHackathonOrgError } from "../lib/org-guard";

type FetchArgs = Parameters<typeof fetch>;

let originalFetch: typeof fetch;
let mockResponse: { status: number; body: unknown };
let lastRequest: { url: string; init: RequestInit | undefined } | null;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("lib/org-guard assertHackathonOrg", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
    globalThis.fetch = (async (...args: FetchArgs) => {
      lastRequest = { url: String(args[0]), init: args[1] };
      return jsonResponse(mockResponse.status, mockResponse.body);
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function client(): KitApiClient {
    return new KitApiClient({ baseUrl: "http://localhost:9393/api/v1", apiKey: "sk_test_fake" });
  }

  it("resolves the org when GET /hackathon/orgs/self reports isHackathonOrg:true", async () => {
    mockResponse = { status: 200, body: { orgId: "org_1", name: "Team Rocket", slug: "hackathon-team-rocket", isHackathonOrg: true } };

    const org = await assertHackathonOrg(client());

    assert.deepEqual(org, { id: "org_1", name: "Team Rocket", slug: "hackathon-team-rocket" });
    assert.equal(lastRequest?.url, "http://localhost:9393/api/v1/hackathon/orgs/self");
    assert.equal((lastRequest?.init?.headers as Record<string, string>)["x-api-key"], "sk_test_fake");
  });

  it("refuses a non-hackathon org (isHackathonOrg:false)", async () => {
    mockResponse = { status: 200, body: { orgId: "org_live_1", name: "Real Customer Org", slug: "real-customer", isHackathonOrg: false } };

    await assert.rejects(
      () => assertHackathonOrg(client()),
      (err: unknown) => err instanceof NotAHackathonOrgError && /org_live_1/.test((err as Error).message),
    );
  });

  it("refuses with a clear message when the API key itself is rejected (401)", async () => {
    mockResponse = { status: 401, body: { error: "Authentication required" } };

    await assert.rejects(
      () => assertHackathonOrg(client()),
      (err: unknown) => err instanceof NotAHackathonOrgError && /401/.test((err as Error).message),
    );
  });

  it("propagates unexpected errors (e.g. 500) without masking them as NotAHackathonOrgError", async () => {
    mockResponse = { status: 500, body: { error: "Internal server error" } };

    await assert.rejects(
      () => assertHackathonOrg(client()),
      (err: unknown) => !(err instanceof NotAHackathonOrgError),
    );
  });
});
