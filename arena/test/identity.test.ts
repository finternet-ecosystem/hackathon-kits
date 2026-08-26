import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { actorPrivyUserId, programSlugFor } from "../src/lib/identity";

describe("lib/identity", () => {
  it("actorPrivyUserId matches the repo root's lib/synthetic.ts convention exactly", () => {
    // Fixture taken directly from the repo root's lib/synthetic.ts's
    // documented formula: `hackathon-kit:${kitId}:${orgId.slice(-8)}:${actorRef}`.
    const orgId = "clx0000000000000000000ab"; // last 8 chars: "000000ab"
    assert.equal(actorPrivyUserId("agent-mandate", orgId, "parent"), "hackathon-kit:agent-mandate:000000ab:parent");
  });

  it("is deterministic — same inputs always produce the same id", () => {
    const orgId = "org-abcdefgh12345678";
    const a = actorPrivyUserId("agent-mandate", orgId, "child-1");
    const b = actorPrivyUserId("agent-mandate", orgId, "child-1");
    assert.equal(a, b);
  });

  it("differs across actor refs on the same org/kit", () => {
    const orgId = "org-abcdefgh12345678";
    const a = actorPrivyUserId("agent-mandate", orgId, "child-1");
    const b = actorPrivyUserId("agent-mandate", orgId, "child-2");
    assert.notEqual(a, b);
  });

  it("programSlugFor matches synthetic.ts's convention (slugPrefix-last8OrgId, lowercased)", () => {
    const orgId = "clx0000000000000000000AB";
    assert.equal(programSlugFor("agent-mandate", orgId), "agent-mandate-000000ab");
  });
});
