import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { LabelsWriter, readLabels, readLabelsFromPath, artifactsRunDir } from "../src/labels";

const TEST_RUN_ID = `test-run-labels-${process.pid}`;

after(() => {
  const dir = artifactsRunDir(TEST_RUN_ID);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("labels — LabelsWriter / readLabels", () => {
  it("writes JSONL matching the kits' labels.jsonl format exactly and reads it back", async () => {
    const writer = new LabelsWriter(TEST_RUN_ID);
    writer.write({ txnRef: "intent-1", ts: "2026-08-03T09:00:00.000Z", label: "compliant", kitScenarioId: "compliant-shopper-001" });
    writer.write({
      txnRef: "intent-2",
      ts: "2026-08-03T02:00:00.000Z",
      label: "violation",
      violationType: "off_hours_burst",
      kitScenarioId: "night-burster-001",
    });
    await writer.close();

    const records = readLabels(TEST_RUN_ID);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.label, "compliant");
    assert.equal(records[0]!.violationType, undefined);
    assert.equal(records[1]!.label, "violation");
    assert.equal(records[1]!.violationType, "off_hours_burst");
  });

  it("readLabels returns an empty array for a run that was never written", () => {
    assert.deepEqual(readLabels("nonexistent-run-xyz"), []);
  });

  it("readLabelsFromPath reads an arbitrary file path (e.g. a run-stream.ts-produced labels.jsonl)", async () => {
    const writer = new LabelsWriter(`${TEST_RUN_ID}-alt`);
    writer.write({ txnRef: "x", ts: "2026-08-03T09:00:00.000Z", label: "compliant", kitScenarioId: "s-1" });
    await writer.close();
    const records = readLabelsFromPath(writer.path);
    assert.equal(records.length, 1);
    fs.rmSync(artifactsRunDir(`${TEST_RUN_ID}-alt`), { recursive: true, force: true });
  });

  it("each line is valid, self-contained JSON (JSONL, not a JSON array)", async () => {
    const writer = new LabelsWriter(`${TEST_RUN_ID}-jsonl`);
    writer.write({ txnRef: "a", ts: "2026-08-03T09:00:00.000Z", label: "compliant", kitScenarioId: "s-1" });
    writer.write({ txnRef: "b", ts: "2026-08-03T09:00:00.000Z", label: "compliant", kitScenarioId: "s-2" });
    await writer.close();
    const raw = fs.readFileSync(writer.path, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.doesNotThrow(() => JSON.parse(line));
    fs.rmSync(artifactsRunDir(`${TEST_RUN_ID}-jsonl`), { recursive: true, force: true });
  });
});
