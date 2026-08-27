import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, parseDuration, resolveTarget } from "../src/engine";
import { ArenaApiClient } from "../src/lib/client";
import type { Scenario } from "../src/scenario-schema";

describe("engine — parseArgs", () => {
  it("parses required + optional flags", () => {
    const args = parseArgs([
      "--scenario=scenarios/agent-mandate-week.yaml",
      "--org=org123",
      "--api-key=sk_test_abc",
      "--speed=30",
      "--run-id=my-run",
      "--mode=continuous",
      "--duration=10m",
    ]);
    assert.equal(args.scenario, "scenarios/agent-mandate-week.yaml");
    assert.equal(args.org, "org123");
    assert.equal(args.apiKey, "sk_test_abc");
    assert.equal(args.speed, 30);
    assert.equal(args.runId, "my-run");
    assert.equal(args.mode, "continuous");
    assert.equal(args.duration, "10m");
  });

  it("defaults mode to one-shot and speed to 60", () => {
    const args = parseArgs(["--scenario=s.yaml", "--org=o", "--api-key=k"]);
    assert.equal(args.mode, "one-shot");
    assert.equal(args.speed, 60);
  });

  it("accepts --key= as an alias for --api-key=", () => {
    const args = parseArgs(["--scenario=s.yaml", "--org=o", "--key=sk_test_xyz"]);
    assert.equal(args.apiKey, "sk_test_xyz");
  });
});

describe("engine — parseDuration", () => {
  it("parses seconds/minutes/hours/ms", () => {
    assert.equal(parseDuration("90s"), 90_000);
    assert.equal(parseDuration("10m"), 600_000);
    assert.equal(parseDuration("1h"), 3_600_000);
    assert.equal(parseDuration("500ms"), 500);
  });

  it("throws on an invalid duration string", () => {
    assert.throws(() => parseDuration("banana"), /Invalid --duration/);
    assert.throws(() => parseDuration("10"), /Invalid --duration/);
  });
});

describe("engine — resolveTarget", () => {
  const scenario: Scenario = {
    scenarioId: "s",
    kit: "agent-mandate",
    slugPrefix: "agent-mandate",
    simTimeSpeed: 60,
    categories: ["OFFICE"],
    actors: [{ ref: "parent", budget: 1000, allowedCategories: ["OFFICE"] }],
    merchants: [{ ref: "m1", name: "Acme Office Supplies", approvedCategories: ["OFFICE"], approvedCounterparty: true }],
    personas: [{ type: "compliant-shopper", count: 1, params: {} }],
  };

  const originalFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = originalFetch;
  });

  it("resolves program id via GET /programs/:slug and merchant id via GET /merchants, computing privyUserId locally", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/hooks")) {
        return new Response(JSON.stringify({ hooks: [] }), { status: 200 });
      }
      if (u.includes("/programs/agent-mandate-")) {
        return new Response(JSON.stringify({ program: { id: "prog-real-id" } }), { status: 200 });
      }
      if (u.includes("/merchants?programId=")) {
        return new Response(JSON.stringify({ merchants: [{ id: "merch-real-id", name: "Acme Office Supplies" }] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    }) as typeof fetch;

    const client = new ArenaApiClient({ baseUrl: "http://localhost:9393/api/v1", apiKey: "k" });
    const target = await resolveTarget(client, scenario, "org-abcdefgh12345678");

    assert.equal(target.programId, "prog-real-id");
    assert.equal(target.programSlug, "agent-mandate-12345678");
    assert.equal(target.world.merchants[0]!.id, "merch-real-id");
    assert.equal(target.world.actors[0]!.privyUserId, "hackathon-kit:agent-mandate:12345678:parent");
    assert.ok(calls.some((c) => c.includes("/programs/agent-mandate-12345678")));
  });

  it("prefers the hook-approved merchant id over a same-named stale duplicate from an earlier seeding", async () => {
    // Reproduces the live-sandbox bug: GET /merchants?programId= ignores the
    // filter and returns merchants from every past seed-kit.ts run on a
    // reused org, so a name can resolve to multiple candidate ids. The
    // program's own counterparty-gate hook (GET /programs/:slug/hooks) names
    // the REAL id it enforces — that must win over a stale duplicate, even
    // one listed first in the (unfiltered) merchants response.
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/hooks")) {
        return new Response(
          JSON.stringify({
            hooks: [
              {
                ruleConfig: JSON.stringify({ all: [{ field: "merchant.id", op: "in", value: ["merch-correct-id"] }] }),
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (u.includes("/programs/agent-mandate-")) {
        return new Response(JSON.stringify({ program: { id: "prog-real-id" } }), { status: 200 });
      }
      if (u.includes("/merchants?programId=")) {
        // Stale duplicate listed FIRST — a naive "first/last match wins" would get this wrong.
        return new Response(
          JSON.stringify({
            merchants: [
              { id: "merch-stale-id", name: "Acme Office Supplies" },
              { id: "merch-correct-id", name: "Acme Office Supplies" },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch: ${u}`);
    }) as typeof fetch;

    const client = new ArenaApiClient({ baseUrl: "http://localhost:9393/api/v1", apiKey: "k" });
    const target = await resolveTarget(client, scenario, "org-abcdefgh12345678");

    assert.equal(target.world.merchants[0]!.id, "merch-correct-id");
  });

  it("targets a fresh-label slug when freshLabel is passed, instead of the plain deterministic slug", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/hooks")) {
        return new Response(JSON.stringify({ hooks: [] }), { status: 200 });
      }
      if (u.includes("/programs/agent-mandate-resettest1-")) {
        return new Response(JSON.stringify({ program: { id: "prog-fresh-id" } }), { status: 200 });
      }
      if (u.includes("/merchants?programId=")) {
        return new Response(JSON.stringify({ merchants: [{ id: "merch-fresh-id", name: "Acme Office Supplies" }] }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${u}`);
    }) as typeof fetch;

    const client = new ArenaApiClient({ baseUrl: "http://localhost:9393/api/v1", apiKey: "k" });
    const target = await resolveTarget(client, scenario, "org-abcdefgh12345678", "resetTest1");

    assert.equal(target.programSlug, "agent-mandate-resettest1-12345678");
    assert.ok(calls.some((c) => c.includes("/programs/agent-mandate-resettest1-12345678")));
  });

  it("throws a descriptive error when a scenario merchant isn't found via GET /merchants", async () => {
    globalThis.fetch = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/hooks")) return new Response(JSON.stringify({ hooks: [] }), { status: 200 });
      if (u.includes("/programs/")) return new Response(JSON.stringify({ program: { id: "prog-1" } }), { status: 200 });
      if (u.includes("/merchants?")) return new Response(JSON.stringify({ merchants: [] }), { status: 200 });
      throw new Error(`Unexpected fetch: ${u}`);
    }) as typeof fetch;

    const client = new ArenaApiClient({ baseUrl: "http://localhost:9393/api/v1", apiKey: "k" });
    await assert.rejects(
      () => resolveTarget(client, scenario, "org-abcdefgh12345678"),
      /not found via GET \/merchants/,
    );
  });
});
