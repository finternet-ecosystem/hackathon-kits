/**
 * Recursively resolves `{"$merchantRef": "<ref>"}` placeholders inside a
 * hook's ruleConfig (or any nested JSON value) into the real merchant id —
 * merchant ids don't exist until seed-kit.ts has actually registered them
 * via the real API, but manifests are static JSON written ahead of time.
 */
export function resolveMerchantRefs(value: unknown, merchantIdByRef: Record<string, string>): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => resolveMerchantRefs(v, merchantIdByRef));
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$merchantRef === "string") {
      const id = merchantIdByRef[obj.$merchantRef];
      if (!id) throw new Error(`Unknown merchant ref "${obj.$merchantRef}" in hook ruleConfig`);
      return id;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = resolveMerchantRefs(v, merchantIdByRef);
    }
    return out;
  }
  return value;
}
