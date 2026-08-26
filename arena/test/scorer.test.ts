import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreRun, renderMarkdown } from "../src/scorer";
import type { LabelRecord } from "../src/labels";
import type { FlagRecord } from "../src/flags-api";

// Hand-built fixture with KNOWN precision/recall math, worked out by hand
// (see arena session notes): 10 candidate transactions (6 ground-truth
// violations across two types, 4 compliant). A team flags 4 real txnRefs
// (3 true positives, 1 false positive) plus one ref that doesn't exist in
// this run's labels at all (a foreign/garbage ref).
//
//   TP=3, FP=1, FN=3, TN=3
//   precision = 3/4  = 0.75
//   recall    = 3/6  = 0.5
//   FPR       = 1/4  = 0.25
//   F1        = 2*0.75*0.5 / (0.75+0.5) = 0.6
//   type A: total=3, detected=2 (txn1, txn2) -> recall 2/3
//   type B: total=3, detected=1 (txn4)       -> recall 1/3
//   latencies (TP only, ms): txn1=1000, txn2=3000, txn4=2000 -> mean=2000, p95=3000

const baseTs = "2026-08-03T09:00:00.000Z"; // ts + Nms below is computed against this instant

function tsPlus(ms: number): string {
  return new Date(new Date(baseTs).getTime() + ms).toISOString();
}

const labels: LabelRecord[] = [
  { txnRef: "txn1", ts: baseTs, label: "violation", violationType: "typeA", kitScenarioId: "s1" },
  { txnRef: "txn2", ts: baseTs, label: "violation", violationType: "typeA", kitScenarioId: "s2" },
  { txnRef: "txn3", ts: baseTs, label: "violation", violationType: "typeA", kitScenarioId: "s3" },
  { txnRef: "txn4", ts: baseTs, label: "violation", violationType: "typeB", kitScenarioId: "s4" },
  { txnRef: "txn5", ts: baseTs, label: "violation", violationType: "typeB", kitScenarioId: "s5" },
  { txnRef: "txn6", ts: baseTs, label: "violation", violationType: "typeB", kitScenarioId: "s6" },
  { txnRef: "txn7", ts: baseTs, label: "compliant", kitScenarioId: "s7" },
  { txnRef: "txn8", ts: baseTs, label: "compliant", kitScenarioId: "s8" },
  { txnRef: "txn9", ts: baseTs, label: "compliant", kitScenarioId: "s9" },
  { txnRef: "txn10", ts: baseTs, label: "compliant", kitScenarioId: "s10" },
];

const flags: FlagRecord[] = [
  { runId: "r", txnRef: "txn1", detectedAt: tsPlus(1000), team: "team-red", receivedAt: tsPlus(1000) },
  { runId: "r", txnRef: "txn2", detectedAt: tsPlus(3000), team: "team-red", receivedAt: tsPlus(3000) },
  { runId: "r", txnRef: "txn4", detectedAt: tsPlus(2000), team: "team-red", receivedAt: tsPlus(2000) },
  { runId: "r", txnRef: "txn7", detectedAt: tsPlus(500), team: "team-red", receivedAt: tsPlus(500) }, // false positive
  { runId: "r", txnRef: "txn999", detectedAt: tsPlus(500), team: "team-red", receivedAt: tsPlus(500) }, // unmatched ref
];

describe("scorer — precision/recall math against a hand-built fixture", () => {
  const report = scoreRun(labels, flags);

  it("computes confusion-matrix counts correctly", () => {
    assert.equal(report.truePositives, 3);
    assert.equal(report.falsePositives, 1);
    assert.equal(report.falseNegatives, 3);
    assert.equal(report.trueNegatives, 3);
  });

  it("computes precision, recall, false-positive-rate, F1 correctly", () => {
    assert.equal(report.precision, 0.75);
    assert.equal(report.recall, 0.5);
    assert.equal(report.falsePositiveRate, 0.25);
    assert.ok(Math.abs(report.f1 - 0.6) < 1e-9, `f1 was ${report.f1}`);
  });

  it("computes per-violation-type recall correctly", () => {
    assert.equal(report.byViolationType.typeA!.total, 3);
    assert.equal(report.byViolationType.typeA!.detected, 2);
    assert.ok(Math.abs(report.byViolationType.typeA!.recall - 2 / 3) < 1e-9);
    assert.equal(report.byViolationType.typeB!.total, 3);
    assert.equal(report.byViolationType.typeB!.detected, 1);
    assert.ok(Math.abs(report.byViolationType.typeB!.recall - 1 / 3) < 1e-9);
  });

  it("computes mean/p95 latency-to-detection from true positives only", () => {
    assert.equal(report.latencyToDetection.count, 3);
    assert.equal(report.latencyToDetection.meanMs, 2000);
    assert.equal(report.latencyToDetection.p95Ms, 3000);
  });

  it("reports the unmatched flag ref separately, and does not count it as a false positive", () => {
    assert.deepEqual(report.unmatchedFlagRefs, ["txn999"]);
    // FP is exactly 1 (txn7) — txn999 must not have inflated it.
    assert.equal(report.falsePositives, 1);
  });

  it("totals add up to the candidate set size", () => {
    assert.equal(report.totalTransactions, 10);
    assert.equal(report.totalGroundTruthViolations, 6);
    assert.equal(report.totalGroundTruthCompliant, 4);
    assert.equal(report.truePositives + report.falsePositives + report.falseNegatives + report.trueNegatives, 10);
  });
});

describe("scorer — edge cases", () => {
  it("handles zero flags (all false negatives / true negatives, no NaN)", () => {
    const report = scoreRun(labels, []);
    assert.equal(report.truePositives, 0);
    assert.equal(report.precision, 0); // 0/0 guarded to 0, not NaN
    assert.equal(report.recall, 0);
    assert.equal(report.latencyToDetection.count, 0);
    assert.equal(report.latencyToDetection.meanMs, 0);
  });

  it("handles a perfect detector (recall=1, precision=1, FPR=0)", () => {
    const perfectFlags: FlagRecord[] = labels
      .filter((l) => l.label === "violation")
      .map((l) => ({ runId: "r", txnRef: l.txnRef, detectedAt: tsPlus(100), team: "team-red", receivedAt: tsPlus(100) }));
    const report = scoreRun(labels, perfectFlags);
    assert.equal(report.precision, 1);
    assert.equal(report.recall, 1);
    assert.equal(report.falsePositiveRate, 0);
    assert.equal(report.f1, 1);
  });

  it("keeps the EARLIEST flag when a team double-flags the same txnRef", () => {
    const doubleFlags: FlagRecord[] = [
      { runId: "r", txnRef: "txn1", detectedAt: tsPlus(5000), team: "team-red", receivedAt: tsPlus(5000) },
      { runId: "r", txnRef: "txn1", detectedAt: tsPlus(1000), team: "team-red", receivedAt: tsPlus(1000) },
    ];
    const report = scoreRun(labels, doubleFlags);
    assert.equal(report.truePositives, 1);
    assert.equal(report.latencyToDetection.meanMs, 1000);
  });
});

describe("scorer — renderMarkdown", () => {
  it("produces a markdown table containing the key metrics", () => {
    const report = scoreRun(labels, flags);
    const md = renderMarkdown(report, "Test Report");
    assert.ok(md.includes("# Test Report"));
    assert.ok(md.includes("Precision"));
    assert.ok(md.includes("75.0%"));
    assert.ok(md.includes("Recall"));
    assert.ok(md.includes("50.0%"));
    assert.ok(md.includes("typeA"));
    assert.ok(md.includes("typeB"));
    assert.ok(md.includes("txn999"));
  });
});
