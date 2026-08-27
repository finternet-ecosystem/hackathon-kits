/**
 * Unit coverage for seed-kit.ts's parseArgs — pure argv parsing, no network,
 * no backend required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../seed-kit";

describe("seed-kit.ts parseArgs", () => {
  it("leaves freshLabel undefined when --fresh is not passed (default, unchanged behavior)", () => {
    const args = parseArgs(["--kit=agent-mandate", "--api-key=sk_test_x"]);
    assert.equal(args.freshLabel, undefined);
  });

  it("auto-generates a freshLabel when the bare --fresh flag is passed", () => {
    const before = Date.now();
    const args = parseArgs(["--kit=agent-mandate", "--api-key=sk_test_x", "--fresh"]);
    const after = Date.now();
    assert.ok(args.freshLabel, "freshLabel should be set");
    // auto-label is Date.now().toString(36) — must round-trip back into range.
    const decoded = parseInt(args.freshLabel!, 36);
    assert.ok(decoded >= before && decoded <= after, `decoded label ${decoded} should fall within [${before}, ${after}]`);
  });

  it("uses the explicit label when --fresh=<label> is passed", () => {
    const args = parseArgs(["--kit=agent-mandate", "--api-key=sk_test_x", "--fresh=mylabel"]);
    assert.equal(args.freshLabel, "mylabel");
  });
});
