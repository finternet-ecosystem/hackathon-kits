import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, hashStringToSeed, rngFromKey, randInt, pick } from "../src/lib/rng";

describe("lib/rng", () => {
  it("mulberry32 is deterministic for a given seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    assert.deepEqual(seqA, seqB);
  });

  it("mulberry32 produces values in [0, 1)", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      assert.ok(v >= 0 && v < 1, `value ${v} out of range`);
    }
  });

  it("hashStringToSeed is deterministic and differs across distinct keys", () => {
    assert.equal(hashStringToSeed("hello"), hashStringToSeed("hello"));
    assert.notEqual(hashStringToSeed("hello"), hashStringToSeed("world"));
  });

  it("rngFromKey gives the same sequence for the same key, different for a different key", () => {
    const seqA = Array.from({ length: 5 }, rngFromKey("scenario:persona:0"));
    const seqA2 = Array.from({ length: 5 }, rngFromKey("scenario:persona:0"));
    const seqB = Array.from({ length: 5 }, rngFromKey("scenario:persona:1"));
    assert.deepEqual(seqA, seqA2);
    assert.notDeepEqual(seqA, seqB);
  });

  it("randInt stays within [min, max] inclusive", () => {
    const rng = rngFromKey("randint-test");
    for (let i = 0; i < 200; i++) {
      const v = randInt(rng, 5, 9);
      assert.ok(v >= 5 && v <= 9);
      assert.equal(Math.trunc(v), v);
    }
  });

  it("pick throws on an empty array", () => {
    const rng = rngFromKey("pick-empty");
    assert.throws(() => pick(rng, []), /empty array/);
  });

  it("pick returns an element from the array", () => {
    const rng = rngFromKey("pick-test");
    const arr = ["a", "b", "c"];
    for (let i = 0; i < 20; i++) {
      assert.ok(arr.includes(pick(rng, arr)));
    }
  });
});
