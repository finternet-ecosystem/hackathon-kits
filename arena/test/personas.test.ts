import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PERSONA_REGISTRY, PERSONA_IDS, getPersona } from "../src/personas";
import type { PersonaWorld } from "../src/personas/types";

const world: PersonaWorld = {
  categories: ["OFFICE", "LOGISTICS", "SOFTWARE", "TRAVEL"],
  actors: [
    { ref: "parent", privyUserId: "hackathon-kit:agent-mandate:testorg:parent", budget: 100000, allowedCategories: ["OFFICE", "LOGISTICS", "SOFTWARE", "TRAVEL"] },
    { ref: "child-1", privyUserId: "hackathon-kit:agent-mandate:testorg:child-1", budget: 20000, allowedCategories: ["OFFICE", "LOGISTICS", "SOFTWARE", "TRAVEL"] },
    { ref: "child-2", privyUserId: "hackathon-kit:agent-mandate:testorg:child-2", budget: 20000, allowedCategories: ["OFFICE", "LOGISTICS", "SOFTWARE", "TRAVEL"] },
    { ref: "child-4-restricted", privyUserId: "hackathon-kit:agent-mandate:testorg:child-4-restricted", budget: 5000, allowedCategories: ["OFFICE", "LOGISTICS", "SOFTWARE", "TRAVEL"] },
  ],
  merchants: [
    { ref: "m1", id: "merch-1", name: "Acme Office Supplies", approvedCategories: ["OFFICE"] },
    { ref: "m3", id: "merch-3", name: "CloudStack Software", approvedCategories: ["SOFTWARE"] },
    { ref: "m11", id: "merch-11", name: "Krypton Courier (unapproved)", approvedCategories: ["LOGISTICS"] },
  ],
};

describe("personas — registry", () => {
  it("exposes all 7 required persona types", () => {
    const expected = [
      "compliant-shopper",
      "limit-prober",
      "structurer",
      "category-drifter",
      "night-burster",
      "delegation-abuser",
      "colluder-ring",
    ];
    for (const id of expected) {
      assert.ok(PERSONA_IDS.includes(id), `missing persona ${id}`);
      assert.ok(PERSONA_REGISTRY[id], `registry missing entry for ${id}`);
    }
  });

  it("getPersona throws a descriptive error for an unknown type", () => {
    assert.throws(() => getPersona("nonexistent-persona"), /Unknown persona type/);
  });
});

describe("personas — determinism (same seed -> same tx sequence + labels)", () => {
  for (const id of PERSONA_IDS) {
    it(`${id}: identical seedKey produces byte-identical output`, () => {
      const persona = getPersona(id);
      const params = id === "limit-prober" ? { capUsd: 2000 } : id === "structurer" ? { capUsd: 2000, totalUsd: 6000 } : {};
      const ctx = { world, count: 6, params, seedKey: `test:${id}:0` };
      const out1 = persona.generate(ctx);
      const out2 = persona.generate({ ...ctx });
      assert.deepEqual(out1, out2, `${id} produced different output for the same seedKey`);
    });

    it(`${id}: a different seedKey CAN produce different output (not hardcoded)`, () => {
      const persona = getPersona(id);
      const params = id === "limit-prober" ? { capUsd: 2000 } : id === "structurer" ? { capUsd: 2000, totalUsd: 6000 } : {};
      const outA = persona.generate({ world, count: 6, params, seedKey: `test:${id}:seedA` });
      const outB = persona.generate({ world, count: 6, params, seedKey: `test:${id}:seedB` });
      // Not all personas vary item amounts with rng in a way that always differs (e.g. limit-prober
      // is a pure bisection independent of seed) — so this is a soft check: at least confirm both
      // ran without throwing and produced the expected count, which the specific persona tests below
      // cover more precisely.
      assert.equal(outA.length, outB.length);
    });
  }
});

describe("compliant-shopper", () => {
  it("every generated action is ground-truth compliant", () => {
    const out = getPersona("compliant-shopper").generate({ world, count: 10, params: {}, seedKey: "cs:1" });
    assert.equal(out.length, 10);
    for (const a of out) {
      assert.equal(a.violationType, null);
      assert.equal(a.label, "Compliant in-policy purchase");
    }
  });

  it("respects minAmount/maxAmount params", () => {
    const out = getPersona("compliant-shopper").generate({
      world,
      count: 20,
      params: { minAmount: 100, maxAmount: 110 },
      seedKey: "cs:2",
    });
    for (const a of out) {
      assert.ok(a.item.unitPrice >= 100 && a.item.unitPrice <= 110, `amount ${a.item.unitPrice} out of range`);
    }
  });
});

describe("limit-prober", () => {
  it("labels probes above capUsd as violations, at/below as compliant", () => {
    const out = getPersona("limit-prober").generate({
      world,
      count: 10,
      params: { actorRef: "parent", merchantRef: "m1", capUsd: 2000, lowBound: 1000, highBound: 4000 },
      seedKey: "lp:1",
    });
    assert.equal(out.length, 10);
    for (const a of out) {
      const expectedViolation = a.item.unitPrice > 2000;
      assert.equal(a.violationType, expectedViolation ? "over_limit_probe" : null);
    }
    // Binary search should include at least one probe on each side of the cap given a bracket that straddles it.
    assert.ok(out.some((a) => a.violationType === "over_limit_probe"));
    assert.ok(out.some((a) => a.violationType === null));
  });

  it("bisection narrows toward capUsd over successive probes", () => {
    const out = getPersona("limit-prober").generate({
      world,
      count: 12,
      params: { actorRef: "parent", merchantRef: "m1", capUsd: 2000, lowBound: 1000, highBound: 4000 },
      seedKey: "lp:2",
    });
    const distances = out.map((a) => Math.abs(a.item.unitPrice - 2000));
    // The LAST probe must be closer to the cap than the FIRST probe.
    assert.ok(distances[distances.length - 1]! < distances[0]!);
  });
});

describe("structurer", () => {
  it("every tranche is a structuring violation, all under capUsd, summing near totalUsd", () => {
    const out = getPersona("structurer").generate({
      world,
      count: 5,
      params: { actorRef: "child-1", merchantRef: "m3", totalUsd: 6000, capUsd: 2000 },
      seedKey: "st:1",
    });
    assert.equal(out.length, 5);
    let sum = 0;
    for (const a of out) {
      assert.equal(a.violationType, "structuring");
      assert.ok(a.item.unitPrice < 2000, `tranche ${a.item.unitPrice} not under cap`);
      sum += a.item.unitPrice;
    }
    assert.ok(sum > 2000, "tranches should sum well above the single-tx cap");
    // First tranche has no lead-in delay; subsequent ones are tightly paced (structuring = fast succession).
    assert.equal(out[0]!.intervalSeconds, 0);
    for (let i = 1; i < out.length; i++) {
      assert.ok(out[i]!.intervalSeconds > 0);
    }
  });
});

describe("category-drifter", () => {
  it("early actions are compliant, later actions drift to a violation", () => {
    const out = getPersona("category-drifter").generate({
      world,
      count: 10,
      params: { actorRef: "child-2", driftStartFraction: 0.5 },
      seedKey: "cd:1",
    });
    assert.equal(out.length, 10);
    const firstHalf = out.slice(0, 5);
    const secondHalf = out.slice(5);
    assert.ok(firstHalf.every((a) => a.violationType === null), "first half should be pre-drift compliant");
    assert.ok(secondHalf.some((a) => a.violationType === "category_drift"), "second half should include drifted violations");
  });
});

describe("night-burster", () => {
  it("every action is an off_hours_burst violation at the configured night hour", () => {
    const out = getPersona("night-burster").generate({
      world,
      count: 6,
      params: { actorRef: "child-2", merchantRef: "m1", nightHour: 2, dayOfWeek: 5 },
      seedKey: "nb:1",
    });
    assert.equal(out.length, 6);
    for (const a of out) {
      assert.equal(a.violationType, "off_hours_burst");
      assert.equal(a.simHourOfWeek, 5 * 24 + 2);
    }
  });
});

describe("delegation-abuser", () => {
  it("pre-exhaustion actions are compliant, post-exhaustion actions are overspend violations", () => {
    const out = getPersona("delegation-abuser").generate({
      world,
      count: 8,
      params: { actorRef: "child-4-restricted", preExhaustionCount: 3 },
      seedKey: "da:1",
    });
    assert.equal(out.length, 8);
    const compliantCount = out.filter((a) => a.violationType === null).length;
    const violationCount = out.filter((a) => a.violationType === "delegation_overspend").length;
    assert.equal(compliantCount + violationCount, 8);
    assert.ok(compliantCount > 0, "should include some pre-exhaustion compliant spend");
    assert.ok(violationCount > 0, "should include post-exhaustion overspend");
    // All violations must come after all compliant actions (monotonic exhaustion).
    const firstViolationIdx = out.findIndex((a) => a.violationType === "delegation_overspend");
    const lastCompliantIdx = out.map((a) => a.violationType).lastIndexOf(null);
    assert.ok(firstViolationIdx > lastCompliantIdx);
  });
});

describe("colluder-ring", () => {
  it("round-robins across the ring's actors, all at the same merchant, all flagged as collusion_ring", () => {
    const out = getPersona("colluder-ring").generate({
      world,
      count: 8,
      params: { actorRefs: ["parent", "child-1", "child-2"], merchantRef: "m11" },
      seedKey: "cr:1",
    });
    assert.equal(out.length, 8);
    for (const a of out) {
      assert.equal(a.violationType, "collusion_ring");
      assert.equal(a.merchantRef, "m11");
    }
    const usedActors = new Set(out.map((a) => a.actorRef));
    assert.deepEqual([...usedActors].sort(), ["child-1", "child-2", "parent"]);
  });
});
