#!/usr/bin/env npx tsx
/**
 * arena/src/flags-api.ts — HTTP endpoint teams POST detections to.
 *
 * Teams report detections however their agent works. We accept:
 *   POST /flags  { runId, txnRef, violationType?, detectedAt }
 * authenticated with a simple per-team bearer token
 * (`Authorization: Bearer <token>`). Flags are appended to
 * artifacts/runs/<runId>/flags.jsonl — `scorer.ts` joins this against the
 * SAME run's labels.jsonl (ground truth) to compute precision/recall/
 * latency-to-detection. Teams that score offline (no live agent) can skip
 * this entirely and hand `scorer.ts` a flags JSONL file directly (see
 * scorer.ts --flags=<path>).
 *
 * Deliberately plain `node:http` — this surface is tiny (one write route,
 * one read route), so arena takes no HTTP-framework dependency for it.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { artifactsRunDir } from "./labels";

export const flagBodySchema = z.object({
  runId: z.string().min(1),
  txnRef: z.string().min(1),
  violationType: z.string().min(1).optional(),
  detectedAt: z.string().min(1),
});

export interface FlagRecord {
  runId: string;
  txnRef: string;
  violationType?: string;
  detectedAt: string;
  team: string;
  receivedAt: string;
}

export type TokenMap = Record<string, string>; // bearer token -> team name

function flagsPath(runId: string): string {
  return path.join(artifactsRunDir(runId), "flags.jsonl");
}

export function appendFlag(record: FlagRecord): void {
  const dir = artifactsRunDir(record.runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(flagsPath(record.runId), `${JSON.stringify(record)}\n`);
}

export function readFlags(runId: string): FlagRecord[] {
  const p = flagsPath(runId);
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as FlagRecord);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function authenticate(req: http.IncomingMessage, tokens: TokenMap): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return tokens[token] ?? null;
}

export interface FlagsServerOptions {
  tokens: TokenMap;
}

export function createFlagsServer(opts: FlagsServerOptions): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");

        if (req.method === "POST" && url.pathname === "/flags") {
          const team = authenticate(req, opts.tokens);
          if (!team) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Authentication required (Bearer token)" }));
            return;
          }
          const rawBody = await readBody(req);
          let parsedJson: unknown;
          try {
            parsedJson = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON body" }));
            return;
          }
          const result = flagBodySchema.safeParse(parsedJson);
          if (!result.success) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid flag body", issues: result.error.issues }));
            return;
          }
          const record: FlagRecord = { ...result.data, team, receivedAt: new Date().toISOString() };
          appendFlag(record);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === "GET" && url.pathname.startsWith("/flags/")) {
          const team = authenticate(req, opts.tokens);
          if (!team) {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Authentication required (Bearer token)" }));
            return;
          }
          const runId = decodeURIComponent(url.pathname.slice("/flags/".length));
          if (!runId) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "runId is required" }));
            return;
          }
          const flags = readFlags(runId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ runId, flags }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
    })();
  });
}

function loadTokensFromEnv(): TokenMap {
  const raw = process.env.ARENA_FLAGS_TOKENS;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    }
  } catch {
    // fall through
  }
  return {};
}

function main(): void {
  const port = Number(process.env.PORT ?? 8787);
  const tokens = loadTokensFromEnv();
  if (Object.keys(tokens).length === 0) {
    console.warn(
      "ARENA_FLAGS_TOKENS is unset or empty — no team can authenticate. " +
        'Set it to a JSON object, e.g. ARENA_FLAGS_TOKENS=\'{"tok_abc123":"team-red"}\'.',
    );
  }
  const server = createFlagsServer({ tokens });
  server.listen(port, () => {
    console.log(`Arena flags API listening on :${port} (${Object.keys(tokens).length} team token(s) configured)`);
  });
}

if (require.main === module) {
  main();
}
