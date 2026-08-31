/**
 * Labels JSONL artifact writer.
 *
 * Format:
 *   {txnRef, ts, sentAt, label: "violation"|"compliant", violationType?, kitScenarioId}
 * to artifacts/runs/<runId>/labels.jsonl — consumed by agent-eval tooling.
 * `label` is GROUND TRUTH from the manifest (was this transaction scripted
 * as a violation attempt, regardless of whether the as-seeded policy
 * actually caught it) — never the platform's decision. This is a disk
 * artifact only, never written to the platform's own database.
 */
import fs from "node:fs";
import path from "node:path";

export interface LabelRecord {
  txnRef: string;
  /** Simulated schedule time (X-Sim-Time sent with this transaction) — NOT a real clock reading. Never use for latency math; see `sentAt`. */
  ts: string;
  /** Real wall-clock time (ISO 8601) this transaction was actually sent — the correct "detection started at" anchor for latency-to-detection scoring. */
  sentAt: string;
  label: "violation" | "compliant";
  violationType?: string;
  kitScenarioId: string;
}

export function artifactsRunDir(runId: string): string {
  // <repo root>/artifacts/runs/<runId> — artifacts/ is gitignored.
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

/** Read back a labels.jsonl file (used by tests + spot-check tooling). */
export function readLabels(runId: string): LabelRecord[] {
  const p = labelsPath(runId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LabelRecord);
}
