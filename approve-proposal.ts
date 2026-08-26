#!/usr/bin/env npx tsx
/**
 * Vouch hackathon: approve-proposal.ts (Kit 4 Disbursement Integrity)
 *
 * Approves a policy proposal created by POST /proposals, closing the
 * propose -> approve -> rerun tighten loop.
 *
 * The approve route needs the `proposals:approve` scope AND an actor
 * different from the proposer, so it runs on your portal session token
 * (VOUCH_PORTAL_TOKEN), never on the hackathon API key that proposed.
 * See kits/disbursement-integrity/README.md "Rerun after tighten".
 *
 * Usage:
 *   npx tsx approve-proposal.ts --proposal-id=<id>
 *   npx tsx approve-proposal.ts --proposal-id=<id> --token=<jwt>
 *   npx tsx approve-proposal.ts --help
 *
 * Options:
 *   --proposal-id=<id>  Required. The id returned by POST /proposals.
 *   --token=<jwt>       Required (or VOUCH_PORTAL_TOKEN). Portal session JWT.
 *   --base-url=<url>    Default: $API_BASE_URL or http://localhost:9393/api/v1
 */
import { KitApiClient, requestExpectingEither } from "./lib/client";

export interface CliArgs {
  proposalId: string;
  token: string;
  baseUrl: string;
  help: boolean;
}

/** Response body of POST /proposals/:id/approve. Every field is optional: the loop only needs the HTTP status, and the echoed envelope has varied across platform builds. */
export interface ApproveResponse {
  proposal?: { id?: string; status?: string };
}

/** Participants copy the whole header value ("Bearer eyJ...") at least as often as the token alone. Accept either. */
function normalizeToken(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, "");
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    proposalId: get("proposal-id") ?? "",
    token: normalizeToken(get("token") ?? process.env.VOUCH_PORTAL_TOKEN ?? ""),
    baseUrl: get("base-url") ?? process.env.API_BASE_URL ?? "http://localhost:9393/api/v1",
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
approve-proposal.ts - approve a policy proposal (Kit 4: Disbursement Integrity)

Usage:
  npx tsx approve-proposal.ts --proposal-id=<id> [--token=<jwt>] [--base-url=<url>]

  --proposal-id=<id>  Required. The id returned by POST /proposals.
  --token=<jwt>       Required (or VOUCH_PORTAL_TOKEN). Your portal session JWT,
                      not your sk_test_ hackathon key: approving needs the
                      proposals:approve scope and a different actor than the
                      proposer. A leading "Bearer " is stripped if you paste it.
  --base-url=<url>    Default: $API_BASE_URL or http://localhost:9393/api/v1
  --help              Show this help.
`);
}

function looksLikeApiKey(token: string): boolean {
  return token.startsWith("sk_test_") || token.startsWith("sk_live_");
}

/** Turns the platform's rejection into the specific thing the participant got wrong, since every failure mode here looks identical from the outside. */
function explainFailure(proposalId: string, status: number, error: unknown): string {
  const detail = typeof error === "string" ? error : JSON.stringify(error);
  switch (status) {
    case 401:
      return (
        `Approve rejected (401): the portal session token was not accepted. Portal JWTs are short-lived, so a token ` +
        `copied a while ago has most likely expired. Reload the portal, copy a fresh one into VOUCH_PORTAL_TOKEN, ` +
        `and rerun. ${detail}`
      );
    case 403:
      return (
        `Approve rejected (403): the token authenticated, but it is not allowed to approve this proposal. Either it ` +
        `lacks the "proposals:approve" scope (a hackathon sk_test_ key never has it, which is why this step uses your ` +
        `portal session), or it belongs to the same actor that proposed, and proposer and approver must differ. ${detail}`
      );
    case 404:
      return (
        `Proposal "${proposalId}" not found (404). Check the id echoed by POST /proposals, and that it belongs to the ` +
        `same org as this portal session. ${detail}`
      );
    default:
      return `Approve failed (${status}). ${detail}`;
  }
}

async function approveProposal(args: CliArgs): Promise<ApproveResponse> {
  // No API key: this request authenticates with the portal bearer token alone.
  // Sending the hackathon key would authenticate as the proposer, which is
  // exactly the actor the approve route refuses.
  const client = new KitApiClient({ baseUrl: args.baseUrl, apiKey: "" });

  // 401/403 are the expected outcomes of a stale or wrong token, not crashes,
  // so inspect the status instead of unwinding on a KitApiError.
  const res = await requestExpectingEither<ApproveResponse>(
    client,
    "POST",
    `/proposals/${args.proposalId}/approve`,
    undefined,
    { Authorization: `Bearer ${args.token}` },
  );
  if (res.ok === false) {
    throw new Error(explainFailure(args.proposalId, res.status, res.error));
  }

  const status = res.data?.proposal?.status;
  console.log(`✔ Proposal ${args.proposalId} approved${status ? ` (status ${status})` : ""}`);
  console.log(`\nNext: npx tsx run-stream.ts --kit=disbursement-integrity --only=mule_pattern --after-tighten`);
  return res.data;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.proposalId) {
    printHelp();
    throw new Error("--proposal-id is required (the id returned by POST /proposals)");
  }
  if (!args.token) {
    printHelp();
    throw new Error("--token is required (or set VOUCH_PORTAL_TOKEN) — see kits/disbursement-integrity/README.md");
  }
  if (looksLikeApiKey(args.token)) {
    throw new Error(
      `That token starts with "${args.token.slice(0, 8)}", so it is an API key, not a portal session token. An API ` +
        `key can never approve a proposal it made: the approve route requires a different actor than the proposer. ` +
        `See kits/disbursement-integrity/README.md "Rerun after tighten".`,
    );
  }
  await approveProposal(args);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}

export { approveProposal, parseArgs };
