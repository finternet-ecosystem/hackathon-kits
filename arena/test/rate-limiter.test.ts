import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../src/lib/rate-limiter";

describe("lib/rate-limiter", () => {
  it("allows up to maxPerWindow requests immediately, without delay", async () => {
    const limiter = new RateLimiter(5, 60_000);
    const start = Date.now();
    for (let i = 0; i < 5; i++) await limiter.acquire();
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `expected near-instant acquisition, took ${elapsed}ms`);
  });

  it("delays the (N+1)th request until a slot frees up in the window", async () => {
    const windowMs = 300;
    const limiter = new RateLimiter(2, windowMs);
    const start = Date.now();
    await limiter.acquire();
    await limiter.acquire();
    // Third call must wait for the window to roll — verifies real self-throttling,
    // not just bookkeeping.
    await limiter.acquire();
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= windowMs - 50, `expected the 3rd acquire to wait ~${windowMs}ms, only waited ${elapsed}ms`);
  });

  it("never exceeds maxPerWindow requests within any windowMs interval", async () => {
    const windowMs = 200;
    const maxPerWindow = 3;
    const limiter = new RateLimiter(maxPerWindow, windowMs);
    const timestamps: number[] = [];
    for (let i = 0; i < 9; i++) {
      await limiter.acquire();
      timestamps.push(Date.now());
    }
    // Slide a window across the recorded timestamps and confirm no window ever contains more than maxPerWindow.
    for (const t of timestamps) {
      const countInWindow = timestamps.filter((x) => x > t - windowMs && x <= t).length;
      assert.ok(countInWindow <= maxPerWindow, `window ending at ${t} contained ${countInWindow} requests (max ${maxPerWindow})`);
    }
  });

  it("throws on a non-positive maxPerWindow", () => {
    assert.throws(() => new RateLimiter(0), /positive/);
    assert.throws(() => new RateLimiter(-1), /positive/);
  });

  it("wouldBlock reports true once the window is saturated", async () => {
    const limiter = new RateLimiter(1, 60_000);
    assert.equal(limiter.wouldBlock(), false);
    await limiter.acquire();
    assert.equal(limiter.wouldBlock(), true);
  });
});
