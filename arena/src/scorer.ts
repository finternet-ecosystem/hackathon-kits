#!/usr/bin/env npx tsx
/**
 * arena/src/scorer.ts — scores a team's flags against a run's labels.
 *
 * Joins a team's reported flags against a run's ground-truth labels and
 * computes per-violation-type precision/recall, overall precision/recall/
 * false-positive-rate, and mean/95th-percentile latency-to-detection
 * (detectedAt - txn ts, true positives only). Outputs a markdown + JSON
 * report.
 *
 * A txnRef present in labels.jsonl but never flagged is an implicit
 * negative prediction (the team's agent effectively said "compliant" for
 * it, whether or not it ever looked at it) — this is the standard
 * convention for scoring a detector against a fixed candidate set, and is
 * what makes false-negative/recall well-defined here.
 *
 * `--baseline=<flags-path>` scores a SECOND flags file against the SAME
 * labels and prints a comparison table — intended for a reference
 * supervisor once one ships. As of writing, no such reference supervisor
 * exists yet, so this flag is built and unit-tested against a hand-built
 * fixture flags file, but has NOT been run end-to-end against a real
 * reference-supervisor output — see arena/README.md "Known limitations".
 *
 * Usage:
 *   npx tsx src/scorer.ts --run-id=<id>
 *   npx tsx src/scorer.ts --labels=<path> --flags=<path> [--baseline=<path>] [--out=<path>]
 */
import fs from "node:fs";
import { readLabels, readLabelsFromPath, type LabelRecord } from "./labels";
import { readFlags, type FlagRecord } from "./flags-api";

export interface LatencyStats {
  count: number;
  meanMs: number;
  p95Ms: number;
}

export interface ViolationTypeStats {
  total: number;
  detected: number;
  recall: number;
}

export interface ScoreReport {
  totalTransactions: number;
  totalGroundTruthViolations: number;
  totalGroundTruthCompliant: number;
  totalFlags: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  f1: number;
  latencyToDetection: LatencyStats;
  byViolationType: Record<string, ViolationTypeStats>;
  /** Flagged txnRefs that don't correspond to any known label — a team flagging a made-up/foreign ref, or a labels/flags mismatch. Excluded from the FP count (not a real prediction against this run's candidate set). */
  unmatchedFlagRefs: string[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Earliest detectedAt per txnRef — if a team flags the same tx twice, the first flag is what counts for latency/precision/recall. */
function earliestFlagByTxnRef(flags: FlagRecord[]): Map<string, FlagRecord> {
  const map = new Map<string, FlagRecord>();
  for (const f of flags) {
    const existing = map.get(f.txnRef);
    if (!existing || new Date(f.detectedAt).getTime() < new Date(existing.detectedAt).getTime()) {
      map.set(f.txnRef, f);
    }
  }
  return map;
}

export function scoreRun(labels: LabelRecord[], flags: FlagRecord[]): ScoreReport {
  const labelByTxnRef = new Map(labels.map((l) => [l.txnRef, l]));
  const flagByTxnRef = earliestFlagByTxnRef(flags);

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let trueNegatives = 0;
  const latenciesMs: number[] = [];
  const byViolationType: Record<string, ViolationTypeStats> = {};
  const unmatchedFlagRefs: string[] = [];

  for (const label of labels) {
    const flagged = flagByTxnRef.has(label.txnRef);
    const isViolation = label.label === "violation";

    if (isViolation) {
      const type = label.violationType ?? "unknown";
      if (!byViolationType[type]) byViolationType[type] = { total: 0, detected: 0, recall: 0 };
      byViolationType[type]!.total += 1;
      if (flagged) byViolationType[type]!.detected += 1;
    }

    if (isViolation && flagged) {
      truePositives += 1;
      const flag = flagByTxnRef.get(label.txnRef)!;
      const latency = new Date(flag.detectedAt).getTime() - new Date(label.ts).getTime();
      if (Number.isFinite(latency)) latenciesMs.push(Math.max(0, latency));
    } else if (isViolation && !flagged) {
      falseNegatives += 1;
    } else if (!isViolation && flagged) {
      falsePositives += 1;
    } else {
      trueNegatives += 1;
    }
  }

  for (const flag of flagByTxnRef.values()) {
    if (!labelByTxnRef.has(flag.txnRef)) unmatchedFlagRefs.push(flag.txnRef);
  }

  for (const stats of Object.values(byViolationType)) {
    stats.recall = safeDiv(stats.detected, stats.total);
  }

  const sortedLatencies = [...latenciesMs].sort((a, b) => a - b);
  const precision = safeDiv(truePositives, truePositives + falsePositives);
  const recall = safeDiv(truePositives, truePositives + falseNegatives);

  return {
    totalTransactions: labels.length,
    totalGroundTruthViolations: labels.filter((l) => l.label === "violation").length,
    totalGroundTruthCompliant: labels.filter((l) => l.label === "compliant").length,
    totalFlags: flags.length,
    truePositives,
    falsePositives,
    falseNegatives,
    trueNegatives,
    precision,
    recall,
    falsePositiveRate: safeDiv(falsePositives, falsePositives + trueNegatives),
    f1: safeDiv(2 * precision * recall, precision + recall),
    latencyToDetection: {
      count: sortedLatencies.length,
      meanMs: safeDiv(sortedLatencies.reduce((a, b) => a + b, 0), sortedLatencies.length),
      p95Ms: percentile(sortedLatencies, 95),
    },
    byViolationType,
    unmatchedFlagRefs,
  };
}

export function renderMarkdown(report: ScoreReport, title = "Arena Score Report"): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(`| Metric | Value |`, `|---|---|`);
  lines.push(`| Transactions | ${report.totalTransactions} |`);
  lines.push(`| Ground-truth violations | ${report.totalGroundTruthViolations} |`);
  lines.push(`| Ground-truth compliant | ${report.totalGroundTruthCompliant} |`);
  lines.push(`| Flags reported | ${report.totalFlags} |`);
  lines.push(`| True positives | ${report.truePositives} |`);
  lines.push(`| False positives | ${report.falsePositives} |`);
  lines.push(`| False negatives | ${report.falseNegatives} |`);
  lines.push(`| True negatives | ${report.trueNegatives} |`);
  lines.push(`| **Precision** | **${pct(report.precision)}** |`);
  lines.push(`| **Recall** | **${pct(report.recall)}** |`);
  lines.push(`| False positive rate | ${pct(report.falsePositiveRate)} |`);
  lines.push(`| F1 | ${pct(report.f1)} |`);
  lines.push(
    `| Latency to detection (mean / p95) | ${report.latencyToDetection.meanMs.toFixed(0)}ms / ` +
      `${report.latencyToDetection.p95Ms.toFixed(0)}ms (n=${report.latencyToDetection.count}) |`,
  );
  lines.push("", `## By violation type`, "", `| Type | Total | Detected | Recall |`, `|---|---|---|---|`);
  for (const [type, stats] of Object.entries(report.byViolationType)) {
    lines.push(`| ${type} | ${stats.total} | ${stats.detected} | ${pct(stats.recall)} |`);
  }
  if (report.unmatchedFlagRefs.length > 0) {
    lines.push("", `## Unmatched flag refs (not in this run's labels)`, "");
    for (const ref of report.unmatchedFlagRefs) lines.push(`- ${ref}`);
  }
  return lines.join("\n");
}

// ─── CLI ─────────────────────────────────────────────────────────────────

interface CliArgs {
  runId?: string;
  labelsPath?: string;
  flagsPath?: string;
  baselinePath?: string;
  out?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    runId: get("run-id"),
    labelsPath: get("labels"),
    flagsPath: get("flags"),
    baselinePath: get("baseline"),
    out: get("out"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
scorer.ts — score a team's flags against a run's ground-truth labels

Usage:
  npx tsx src/scorer.ts --run-id=<id> [--out=<path>]
  npx tsx src/scorer.ts --labels=<path> --flags=<path> [--baseline=<flags-path>] [--out=<path>]

  --run-id=<id>       Read artifacts/runs/<id>/{labels,flags}.jsonl.
  --labels=<path>     Explicit labels.jsonl path (overrides --run-id's labels).
  --flags=<path>      Explicit flags.jsonl path (overrides --run-id's flags).
  --baseline=<path>   Score a second flags file against the SAME labels and print a comparison.
  --out=<path>        Write the markdown report to a file (also prints to stdout).
  --help              Show this help.
`);
}

function loadLabels(args: CliArgs): LabelRecord[] {
  if (args.labelsPath) return readLabelsFromPath(args.labelsPath);
  if (args.runId) return readLabels(args.runId);
  throw new Error("Either --run-id or --labels is required");
}

function loadFlags(args: CliArgs): FlagRecord[] {
  if (args.flagsPath) {
    if (!fs.existsSync(args.flagsPath)) return [];
    return fs
      .readFileSync(args.flagsPath, "utf-8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as FlagRecord);
  }
  if (args.runId) return readFlags(args.runId);
  throw new Error("Either --run-id or --flags is required");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const labels = loadLabels(args);
  const flags = loadFlags(args);
  const report = scoreRun(labels, flags);
  let markdown = renderMarkdown(report, "Arena Score Report");

  if (args.baselinePath) {
    const baselineFlags = fs.existsSync(args.baselinePath)
      ? fs
          .readFileSync(args.baselinePath, "utf-8")
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .map((l) => JSON.parse(l) as FlagRecord)
      : [];
    const baselineReport = scoreRun(labels, baselineFlags);
    markdown += "\n\n" + renderMarkdown(baselineReport, "Baseline (--baseline) Score Report");
    markdown +=
      `\n\n## Comparison\n\n| Metric | Team | Baseline |\n|---|---|---|\n` +
      `| Precision | ${(report.precision * 100).toFixed(1)}% | ${(baselineReport.precision * 100).toFixed(1)}% |\n` +
      `| Recall | ${(report.recall * 100).toFixed(1)}% | ${(baselineReport.recall * 100).toFixed(1)}% |\n` +
      `| F1 | ${(report.f1 * 100).toFixed(1)}% | ${(baselineReport.f1 * 100).toFixed(1)}% |\n` +
      `| Mean latency | ${report.latencyToDetection.meanMs.toFixed(0)}ms | ${baselineReport.latencyToDetection.meanMs.toFixed(0)}ms |\n`;
  }

  console.log(markdown);
  if (args.out) {
    fs.writeFileSync(args.out, markdown);
    console.log(`\nReport written to ${args.out}`);
  }
  const jsonOut = args.out ? args.out.replace(/\.md$/, "") + ".json" : undefined;
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  }
}

if (require.main === module) {
  main();
}
