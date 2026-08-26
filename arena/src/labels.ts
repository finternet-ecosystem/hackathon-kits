/**
 * Ground-truth labels JSONL writer — SAME format as the repo root's
 * `lib/labels.ts` (own copy, not an import — arena has zero imports
 * outside `arena/`, see arena/README.md):
 *
 *   {txnRef, ts, label: "violation"|"compliant", violationType?, kitScenarioId}
 *
 * `label` is GROUND TRUTH from the persona (was this transaction scripted
 * as a violation attempt, regardless of whether the platform's policy
 * actually caught it) — never the platform's decision. `kitScenarioId`
 * here is the arena's own scenario-instance id (not literally a "kit"
 * scenario, but the SAME field name/semantics so a run-stream.ts labels
 * file and an arena one are drop-in interchangeable for the scorer).
 *
 * Written to arena/artifacts/runs/<runId>/labels.jsonl — arena/artifacts/
 * is gitignored.
 */
import fs from "node:fs";
import path from "node:path";

export interface LabelRecord {
  txnRef: string;
  ts: string;
  label: "violation" | "compliant";
  violationType?: string;
  kitScenarioId: string;
}

export function artifactsRunDir(runId: string): string {
  return path.join(__dirname, "..", "artifacts", "runs", runId);
}

export function labelsPath(runId: string): string {
  return path.join(artifactsRunDir(runId), "labels.jsonl");
}

export class LabelsWriter {
  private stream: fs.WriteStream;
  public readonly path: string;

  constructor(runId: string) {
    const dir = artifactsRunDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    this.path = labelsPath(runId);
    this.stream = fs.createWriteStream(this.path, { flags: "a" });
  }

  write(record: LabelRecord): void {
    this.stream.write(`${JSON.stringify(record)}\n`);
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  }
}

/** Read back a labels.jsonl file (used by the scorer + tests). */
export function readLabels(runId: string): LabelRecord[] {
  const p = labelsPath(runId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LabelRecord);
}

/** Read labels from an arbitrary file path (e.g. a run-stream.ts-produced labels.jsonl, or a fixture in tests). */
export function readLabelsFromPath(filePath: string): LabelRecord[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LabelRecord);
}
