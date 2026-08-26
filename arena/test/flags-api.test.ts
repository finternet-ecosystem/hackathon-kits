import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { createFlagsServer } from "../src/flags-api";
import { artifactsRunDir } from "../src/labels";

const TEST_RUN_ID = `test-run-flags-${process.pid}`;
let baseUrl: string;
let server: ReturnType<typeof createFlagsServer>;

before(async () => {
  server = createFlagsServer({ tokens: { "tok-team-red": "team-red", "tok-team-blue": "team-blue" } });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const dir = artifactsRunDir(TEST_RUN_ID);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("flags-api — auth", () => {
  it("rejects POST /flags with no Authorization header", async () => {
    const res = await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: TEST_RUN_ID, txnRef: "x", detectedAt: new Date().toISOString() }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects POST /flags with an unknown bearer token", async () => {
    const res = await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-token" },
      body: JSON.stringify({ runId: TEST_RUN_ID, txnRef: "x", detectedAt: new Date().toISOString() }),
    });
    assert.equal(res.status, 401);
  });

  it("rejects GET /flags/:runId with no auth", async () => {
    const res = await fetch(`${baseUrl}/flags/${TEST_RUN_ID}`);
    assert.equal(res.status, 401);
  });
});

describe("flags-api — validation", () => {
  it("rejects a body missing required fields", async () => {
    const res = await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok-team-red" },
      body: JSON.stringify({ runId: TEST_RUN_ID }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok-team-red" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
  });
});

describe("flags-api — happy path", () => {
  it("accepts a valid flag, tags it with the authenticated team, and it's readable back", async () => {
    const postRes = await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok-team-red" },
      body: JSON.stringify({ runId: TEST_RUN_ID, txnRef: "intent-1", violationType: "over_limit_probe", detectedAt: "2026-08-03T09:05:00.000Z" }),
    });
    assert.equal(postRes.status, 201);

    const getRes = await fetch(`${baseUrl}/flags/${TEST_RUN_ID}`, {
      headers: { Authorization: "Bearer tok-team-red" },
    });
    assert.equal(getRes.status, 200);
    const body = (await getRes.json()) as { runId: string; flags: Array<{ txnRef: string; team: string }> };
    assert.equal(body.runId, TEST_RUN_ID);
    assert.equal(body.flags.length, 1);
    assert.equal(body.flags[0]!.txnRef, "intent-1");
    assert.equal(body.flags[0]!.team, "team-red");
  });

  it("two different teams' flags for the same run both get recorded, correctly attributed", async () => {
    await fetch(`${baseUrl}/flags`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok-team-blue" },
      body: JSON.stringify({ runId: TEST_RUN_ID, txnRef: "intent-2", detectedAt: "2026-08-03T09:06:00.000Z" }),
    });
    const getRes = await fetch(`${baseUrl}/flags/${TEST_RUN_ID}`, { headers: { Authorization: "Bearer tok-team-red" } });
    const body = (await getRes.json()) as { flags: Array<{ txnRef: string; team: string }> };
    const teams = body.flags.map((f) => f.team).sort();
    assert.deepEqual(teams, ["team-blue", "team-red"]);
  });

  it("404s on an unknown route", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    assert.equal(res.status, 404);
  });
});
