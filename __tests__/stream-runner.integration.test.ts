/**
 * run-stream.ts against a REAL running backend (no database access from this
 * repo — see README "Architecture: why this needs only an API key"). Skip-
 * if-unavailable pattern: a genuine no-op (not a failure) in any environment
 * without a reachable backend + admin key, e.g. a bare `npm test` in CI.
 *
 * The org-guard "refuses to run against a non-hackathon org" behavior is
 * covered separately in __tests__/org-guard.test.ts (a mocked-fetch unit
 * test, needing no live backend or database) — this file focuses on what
 * only a real server can prove: genuine declines and labels.jsonl accuracy.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { seedKit } from "../seed-kit";
import { runStream } from "../run-stream";
import { readLabels } from "../lib/labels";

const BASE_URL = process.env.API_BASE_URL || "http://localhost:9393/api/v1";
const ADMIN_KEY = process.env.HACKATHON_ADMIN_KEY || "";

let backendAvailable = false;

async function checkBackend(): Promise<boolean> {
  try {
    const res = await fetch(BASE_URL.replace(/\/api\/v1$/, "") + "/");
    return res.status < 600; // any HTTP response at all means the server is up
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
  if (body.apiKey) return { orgId: body.orgId, apiKey: body.apiKey };
  const res2 = await fetch(`${BASE_URL}/hackathon/orgs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hackathon-admin-key": ADMIN_KEY },
    body: JSON.stringify({ teamName, email: `${teamName.toLowerCase().replace(/\s+/g, "-")}@example.com`, mintKey: true, keyName: "test" }),
  });
  const body2 = (await res2.json()) as { orgId: string; apiKey: string };
  return { orgId: body2.orgId, apiKey: body2.apiKey };
}

describe("run-stream.ts (integration)", () => {
  before(async () => {
    backendAvailable = Boolean(ADMIN_KEY) && (await checkBackend());
  });

  it("expected declines occur, and labels.jsonl exactly matches the in-process outcomes (spot-check 10 refs)", async (t) => {
    if (!backendAvailable) {
      t.skip("No live backend reachable at API_BASE_URL (or HACKATHON_ADMIN_KEY unset).");
      return;
    }

    const teamName = `Stream Runner Test ${crypto.randomBytes(4).toString("hex")}`;
    const { apiKey } = await provisionOrg(teamName);

    await seedKit({ kit: "kya-licence", apiKey, baseUrl: BASE_URL, help: false });

    const runId = `it-${crypto.randomBytes(4).toString("hex")}`;
    const { outcomes, labelsPath } = await runStream({
      kit: "kya-licence",
      apiKey,
      baseUrl: BASE_URL,
      speed: 6000,
      runId,
      afterTighten: false,
      help: false,
    });

    // "Expected declines occur": the unapproved-counterparty template is
    // violationType-labeled and must show at least one real decline.
    const counterpartyOutcomes = outcomes.filter((o) => o.instance.templateId === "unapproved-counterparty");
    assert.ok(counterpartyOutcomes.length > 0, "expected at least one unapproved-counterparty instance to have run");
    assert.ok(counterpartyOutcomes.every((o) => !o.allowed), "every unapproved-counterparty instance must be denied");

    // "Labels JSONL matches API results": labels.jsonl has exactly one row
    // per "payment" kind outcome (mandate_op steps are intentionally not
    // labeled — see run-stream.ts), and every row's txnRef/label matches the
    // in-process outcome it was derived from.
    const paymentOutcomes = outcomes.filter((o) => o.instance.kind === "payment");
    const labels = readLabels(runId);
    assert.equal(labels.length, paymentOutcomes.length, "labels.jsonl row count must match the number of payment-kind outcomes");

    const outcomeByTxnRef = new Map(paymentOutcomes.map((o) => [o.txnRef, o]));
    const spotCheckCount = Math.min(10, labels.length);
    for (let i = 0; i < spotCheckCount; i++) {
      const label = labels[i];
      const outcome = outcomeByTxnRef.get(label.txnRef);
      assert.ok(outcome, `label txnRef "${label.txnRef}" (scenario ${label.kitScenarioId}) has no matching in-process outcome`);
      const expectedLabel = outcome!.instance.violationType ? "violation" : "compliant";
      assert.equal(label.label, expectedLabel, `label for ${label.kitScenarioId} should be "${expectedLabel}"`);
      assert.equal(label.kitScenarioId, outcome!.instance.kitScenarioId);
    }

    assert.ok(labelsPath.endsWith(`${runId}/labels.jsonl`));
  });
});
