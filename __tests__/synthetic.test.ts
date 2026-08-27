/**
 * Unit coverage for lib/synthetic.ts's deterministic identifier helpers —
 * no network, no backend required.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freshSlugPrefix } from "../lib/synthetic";

describe("lib/synthetic freshSlugPrefix", () => {
  it("lowercases and sanitizes the label, stripping invalid slug characters", () => {
    assert.equal(freshSlugPrefix("agent-mandate", "Resettest1!!"), "agent-mandate-resettest1");
  });

  it("collapses runs of invalid characters into a single hyphen", () => {
    assert.equal(freshSlugPrefix("agent-mandate", "hello   world"), "agent-mandate-hello-world");
  });

  it("strips leading/trailing hyphens produced by sanitization", () => {
    assert.equal(freshSlugPrefix("agent-mandate", "--reset--"), "agent-mandate-reset");
  });

  it("is stable for the same label (idempotent composition)", () => {
    assert.equal(freshSlugPrefix("agent-mandate", "resettest1"), freshSlugPrefix("agent-mandate", "resettest1"));
  });
});
