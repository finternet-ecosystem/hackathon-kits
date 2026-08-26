/**
 * Conservative client-side pacing for continuous-drip mode: paces requests
 * conservatively (<=20/min/org), well under the platform's own rate limits.
 *
 * This is a SELF-imposed cap, independent of (and much stricter than) the
 * platform's own published rate limit (600/min, which the API enforces with
 * HTTP 429) — the arena should never be the reason a demo org's key gets
 * rate-limited, and 20/min leaves ~30x headroom under that ceiling even if
 * several personas run concurrently against the same org.
 *
 * Sliding-window token bucket, one instance per orgId. `acquire()` resolves
 * once a slot is available (may await a real delay) — callers await it
 * immediately before each HTTP call.
 */
export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private timestamps: number[] = [];

  constructor(maxPerWindow: number, windowMs: number = 60_000) {
    if (maxPerWindow <= 0) throw new Error("maxPerWindow must be positive");
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  /** How many requests are currently "in flight" within the trailing window, as of `now`. */
  private countInWindow(now: number): number {
    const cutoff = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
    return this.timestamps.length;
  }

  /** Resolves once a slot is available, then records the slot as consumed. Never rejects. */
  async acquire(now: number = Date.now()): Promise<void> {
    for (;;) {
      const current = Date.now();
      const inWindow = this.countInWindow(current);
      if (inWindow < this.maxPerWindow) {
        this.timestamps.push(current);
        return;
      }
      // Wait until the oldest timestamp in the window ages out.
      const oldest = this.timestamps[0]!;
      const waitMs = Math.max(10, oldest + this.windowMs - current);
      await sleep(waitMs);
    }
  }

  /** Non-blocking check — used by tests / dry-run reporting, never by the real acquire path. */
  wouldBlock(now: number = Date.now()): boolean {
    return this.countInWindow(now) >= this.maxPerWindow;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
