/**
 * Deterministic seeded PRNG (mulberry32) — every persona uses this so a
 * given (scenarioId, personaId, seed) always produces the same transaction
 * sequence AND the same ground-truth labels ("deterministic/seeded,
 * ground-truth-by-construction", see arena/README.md "Personas").
 *
 * Not cryptographic — this is synthetic traffic generation, not a
 * security-sensitive RNG. Deliberately the same algorithm the repo root's
 * `lib/rng.ts` uses (matching that architecture), but this is arena's OWN
 * copy — arena has zero imports outside `arena/`, by design (see
 * arena/README.md), so teams can run it standalone.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Convenience: build a seeded RNG directly from a string key. */
export function rngFromKey(key: string): () => number {
  return mulberry32(hashStringToSeed(key));
}

/** Pick an integer in [min, max] (inclusive) using the given RNG. */
export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Pick a uniformly random element of a non-empty array using the given RNG. */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick() called with an empty array");
  return arr[Math.floor(rng() * arr.length)]!;
}
