#!/usr/bin/env npx tsx
/**
 * Vouch hackathon: watch-chain.ts (Kit 3 Embedded Supervision)
 *
 * Tails Factory + Treasury events over ethers.js. Pass --factory and
 * --treasury explicitly (fetch from GET /programs/:slug → programContracts).
 * --kit/--org are accepted but do not yet hydrate addresses from the state file.
 *
 * Usage:
 *   npx tsx watch-chain.ts --factory=0x... --treasury=0x... --rpc-url=http://127.0.0.1:8545
 *   npx tsx watch-chain.ts --help
 */
import { ethers } from "ethers";
import { readKitState } from "./lib/state";

interface CliArgs {
  kit?: string;
  org?: string;
  factory?: string;
  treasury?: string;
  rpcUrl: string;
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
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

function printHelp(): void {
  console.log(`
watch-chain.ts - tail on-chain PBV events (Kit 3: Embedded Supervision)

Usage:
  npx tsx watch-chain.ts --factory=0x... --treasury=0x... [--rpc-url=<url>]

  --factory=<addr>           Factory contract address (required today).
  --treasury=<addr>          Treasury contract address (required today).
  --rpc-url=<url>            Default: $RPC_URL or http://127.0.0.1:8545.
  --kit=<id> --org=<orgId>   Accepted, but addresses are not loaded from the
                             state file yet. Fetch program.programContracts
                             from GET /programs/:slug instead.
  --help                     Show this help.
`);
}

// Minimal ABIs — event signatures only, enough to tail and decode. Copied
// verbatim from contracts/interfaces/IPoshanVoucherFactory.sol and
// contracts/PoshanTreasury.sol (checked against source, not guessed).
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

  let factoryAddr = args.factory;
  let treasuryAddr = args.treasury;

  if (!factoryAddr || !treasuryAddr) {
    if (!args.kit || !args.org) {
      printHelp();
      throw new Error("Provide either --factory/--treasury, or --kit/--org to read them from a seeded kit's state file.");
    }
    const state = readKitState(args.kit, args.org);
    if (!state) {
      throw new Error(`No seeded state found for kit "${args.kit}" / org "${args.org}". Run seed-kit.ts first.`);
    }
    // The contract addresses aren't persisted in KitState (seed-kit.ts talks
    // to the real API, which doesn't return them on enrol) — fetch via the
    // real API instead of guessing.
    throw new Error(
      `Contract addresses aren't stored in the kit state file. Fetch them from ` +
        `GET /api/v1/programs/${state.programSlug} (response.program.programContracts) and pass ` +
        `--factory=<factoryAddress> --treasury=<treasuryAddress> directly.`,
    );
  }

  console.log(`Connecting to ${args.rpcUrl} ...`);
  const provider = new ethers.JsonRpcProvider(args.rpcUrl);
  const network = await provider.getNetwork();
  console.log(`Connected — chainId=${network.chainId}`);

  const factory = new ethers.Contract(factoryAddr, FACTORY_EVENTS_ABI, provider);
  const treasury = new ethers.Contract(treasuryAddr, TREASURY_EVENTS_ABI, provider);

  console.log(`Watching Factory  ${factoryAddr}`);
  console.log(`Watching Treasury ${treasuryAddr}`);
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
