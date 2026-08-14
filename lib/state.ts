/**
 * seed-kit.ts writes a small sidecar JSON file recording what it created
 * (program id, merchant ref -> id, actor ref -> beneficiary/mandate ids) so
 * run-stream.ts doesn't have to re-derive it (or worse, guess it) on every
 * replay. Local disk only, gitignored (artifacts/), same directory family as
 * the labels artifact.
 */
import fs from "node:fs";
import path from "node:path";

export interface SeededActor {
  ref: string;
  beneficiaryId: string;
  tokenId: number;
  /** Value passed as x-privy-user-id when quoting/authorizing payments on this actor's behalf — set at self-enrol time. */
  privyUserId: string;
  mandateId?: string;
  mandateKeyPrefix?: string;
}

export interface SeededMerchant {
  ref: string;
  id: string;
  name: string;
}

export interface KitState {
  kitId: string;
  orgId: string;
  programId: string;
  programSlug: string;
  merchants: SeededMerchant[];
  actors: SeededActor[];
  hooks: Array<{ name: string; id: string }>;
  approverApiKeyPrefix?: string;
  seededAt: string;
}

function stateDir(): string {
  return path.join(__dirname, "..", "artifacts", "kits");
}

export function stateFilePath(kitId: string, orgId: string): string {
  return path.join(stateDir(), `${kitId}-${orgId}.json`);
}

export function writeKitState(state: KitState): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(stateFilePath(state.kitId, state.orgId), JSON.stringify(state, null, 2));
}

export function readKitState(kitId: string, orgId: string): KitState | null {
  const p = stateFilePath(kitId, orgId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8")) as KitState;
}

export function deleteKitState(kitId: string, orgId: string): void {
  const p = stateFilePath(kitId, orgId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
