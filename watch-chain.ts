#!/usr/bin/env npx tsx
/**
 * Vouch hackathon: watch-chain.ts (Kit 3 Embedded Supervision)
 *
 * Tails Factory + Treasury events over ethers.js. Give it either the two
 * addresses (--factory/--treasury) or a seeded kit (--kit/--org), in which
 * case it resolves them from GET /programs/:slug → programContracts.
 *
 * Usage:
 *   npx tsx watch-chain.ts --factory=0x... --treasury=0x... --rpc-url=http://127.0.0.1:8545
 *   npx tsx watch-chain.ts --kit=embedded-supervision --org=<orgId>
 *   npx tsx watch-chain.ts --help
 */
import { ethers } from "ethers";
import { KitApiClient, KitApiError } from "./lib/client";
import { readKitState } from "./lib/state";

interface CliArgs {
  kit?: string;
  org?: string;
  factory?: string;
  treasury?: string;
  rpcUrl: string;
  apiKey: string;
  baseUrl: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const prefix = `--${flag}=`;
    const hit = argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  return {
    kit: get("kit"),
    org: get("org"),
    factory: get("factory"),
    treasury: get("treasury"),
    rpcUrl: get("rpc-url") ?? process.env.RPC_URL ?? "http://127.0.0.1:8545",
    apiKey: get("api-key") ?? process.env.HACKATHON_ORG_API_KEY ?? "",
    baseUrl: get("base-url") ?? process.env.API_BASE_URL ?? "http://localhost:9393/api/v1",
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
watch-chain.ts - tail on-chain PBV events (Kit 3: Embedded Supervision)

Usage:
  npx tsx watch-chain.ts --factory=0x... --treasury=0x... [--rpc-url=<url>]
  npx tsx watch-chain.ts --kit=<id> --org=<orgId> [--api-key=<key>] [--rpc-url=<url>]

  --factory=<addr>           Factory contract address.
  --treasury=<addr>          Treasury contract address.
  --kit=<id> --org=<orgId>   Resolve both addresses from the seeded kit's
                             program (GET /programs/:slug → programContracts)
                             instead of passing them. Needs an API key.
  --api-key=<key>            Required with --kit/--org (or HACKATHON_ORG_API_KEY).
  --base-url=<url>           Default: $API_BASE_URL or http://localhost:9393/api/v1
  --rpc-url=<url>            Default: $RPC_URL or http://127.0.0.1:8545.
  --help                     Show this help.
`);
}

interface ProgramContracts {
  status?: string;
  factoryAddress?: string;
  treasuryAddress?: string;
}

/** programContracts reports "0x" as a placeholder when a deploy has not succeeded — truthy, but not an address (the same guard seed-kit.ts applies while waiting for a deploy). */
function usableAddress(value: string | undefined): string | undefined {
  return value && value !== "0x" ? value : undefined;
}

async function fetchProgramContracts(client: KitApiClient, programSlug: string): Promise<ProgramContracts> {
  try {
    const res = await client.get<{ program: { programContracts?: ProgramContracts | null } }>(`/programs/${programSlug}`);
    return res.program.programContracts ?? {};
  } catch (err) {
    if (err instanceof KitApiError && err.status === 404) {
      throw new Error(
        `Program "${programSlug}" not found. The state file was written by a seed run against a different org than ` +
          `this --api-key belongs to — reseed with the key you are passing here, or pass --factory/--treasury directly.`,
      );
    }
    throw err;
  }
}

/**
 * KitState records the program slug but not its contract addresses: seed-kit.ts
 * never learns them (neither POST /programs nor enrol returns them), so they
 * come from the API at watch time. Explicit --factory/--treasury still win.
 */
async function resolveAddresses(args: CliArgs): Promise<{ factoryAddress: string; treasuryAddress: string }> {
  if (args.factory && args.treasury) {
    return { factoryAddress: args.factory, treasuryAddress: args.treasury };
  }
  if (!args.kit || !args.org) {
    printHelp();
    throw new Error("Provide either --factory/--treasury, or --kit/--org to resolve them from a seeded kit's program.");
  }
  const state = readKitState(args.kit, args.org);
  if (!state) {
    throw new Error(`No seeded state found for kit "${args.kit}" / org "${args.org}". Run seed-kit.ts first.`);
  }
  if (!args.apiKey) {
    printHelp();
    throw new Error("--api-key is required (or set HACKATHON_ORG_API_KEY) to resolve contract addresses from --kit/--org.");
  }

  console.log(`Resolving contract addresses from GET /programs/${state.programSlug} ...`);
  const client = new KitApiClient({ baseUrl: args.baseUrl, apiKey: args.apiKey });
  const contracts = await fetchProgramContracts(client, state.programSlug);
  const factoryAddress = args.factory ?? usableAddress(contracts.factoryAddress);
  const treasuryAddress = args.treasury ?? usableAddress(contracts.treasuryAddress);
  if (!factoryAddress || !treasuryAddress) {
    throw new Error(
      `Program "${state.programSlug}" has no usable ${!factoryAddress ? "Factory" : "Treasury"} address ` +
        `(programContracts status: ${contracts.status ?? "none"}). Contracts only exist when the backend runs with a ` +
        `deployer key and an RPC configured — see kits/embedded-supervision/README.md "Run with a local chain". Pass ` +
        `--factory and --treasury explicitly if you deployed them yourself.`,
    );
  }
  return { factoryAddress, treasuryAddress };
}

// Minimal ABIs — event signatures only, enough to tail and decode. Transcribed
// from the deployed Factory and Treasury contract ABIs and checked against
// them, not guessed.
const FACTORY_EVENTS_ABI = [
  "event VoucherMinted(uint256 indexed tokenId, bytes32 indexed beneficiaryHash, uint8 tier, uint256 value, uint256 expiry)",
  "event VoucherActivated(uint256 indexed tokenId, bytes32 phoneHash, uint8 tier, uint256 value, uint256 expiry, uint256 timestamp)",
  "event VoucherPartiallyRedeemed(uint256 indexed tokenId, uint256 amount, uint256 remaining)",
  "event VoucherFullyRedeemed(uint256 indexed tokenId)",
  "event VoucherExpired(uint256 indexed tokenId, uint256 unspentValue)",
  "event VoucherAssigned(uint256 indexed tokenId, address indexed beneficiaryWallet)",
];
const TREASURY_EVENTS_ABI = [
  "event Deposited(address indexed from, uint256 amount, uint256 timestamp)",
  "event Locked(uint256 indexed tokenId, uint256 amount)",
  "event Released(uint256 indexed tokenId, uint256 amount, address indexed merchant)",
  "event Reclaimed(uint256 indexed tokenId, uint256 amount)",
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const { factoryAddress, treasuryAddress } = await resolveAddresses(args);

  console.log(`Connecting to ${args.rpcUrl} ...`);
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const network = await provider.getNetwork();
  console.log(`Connected — chainId=${network.chainId}`);

  const factory = new ethers.Contract(factoryAddress, FACTORY_EVENTS_ABI, provider);
  const treasury = new ethers.Contract(treasuryAddress, TREASURY_EVENTS_ABI, provider);

  console.log(`Watching Factory  ${factoryAddress}`);
  console.log(`Watching Treasury ${treasuryAddress}`);
  console.log("(Ctrl+C to stop)\n");

  factory.on("VoucherMinted", (tokenId, beneficiaryHash, tier, value, expiry, event) => {
    console.log(`[VoucherMinted] tokenId=${tokenId} tier=${tier} value=${ethers.formatUnits(value, 6)} expiry=${expiry} tx=${event.log.transactionHash}`);
  });
  factory.on("VoucherActivated", (tokenId, phoneHash, tier, value, expiry, timestamp, event) => {
    console.log(`[VoucherActivated] tokenId=${tokenId} tier=${tier} value=${ethers.formatUnits(value, 6)} tx=${event.log.transactionHash}`);
  });
  factory.on("VoucherPartiallyRedeemed", (tokenId, amount, remaining, event) => {
    console.log(`[VoucherPartiallyRedeemed] tokenId=${tokenId} amount=${ethers.formatUnits(amount, 6)} remaining=${ethers.formatUnits(remaining, 6)} tx=${event.log.transactionHash}`);
  });
  factory.on("VoucherFullyRedeemed", (tokenId, event) => {
    console.log(`[VoucherFullyRedeemed] tokenId=${tokenId} tx=${event.log.transactionHash}`);
  });
  factory.on("VoucherExpired", (tokenId, unspentValue, event) => {
    console.log(`[VoucherExpired] tokenId=${tokenId} unspentValue=${ethers.formatUnits(unspentValue, 6)} tx=${event.log.transactionHash}`);
  });
  treasury.on("Deposited", (from, amount, timestamp, event) => {
    console.log(`[Deposited] from=${from} amount=${ethers.formatUnits(amount, 6)} tx=${event.log.transactionHash}`);
  });
  treasury.on("Locked", (tokenId, amount, event) => {
    console.log(`[Locked] tokenId=${tokenId} amount=${ethers.formatUnits(amount, 6)} tx=${event.log.transactionHash}`);
  });
  treasury.on("Released", (tokenId, amount, merchant, event) => {
    console.log(`[Released] tokenId=${tokenId} amount=${ethers.formatUnits(amount, 6)} merchant=${merchant} tx=${event.log.transactionHash}`);
  });
  treasury.on("Reclaimed", (tokenId, amount, event) => {
    console.log(`[Reclaimed] tokenId=${tokenId} amount=${ethers.formatUnits(amount, 6)} tx=${event.log.transactionHash}`);
  });

  // Keep the process alive.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
