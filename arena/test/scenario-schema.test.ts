import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseScenario, loadScenarioFile } from "../src/scenario-schema";

const validScenario = {
  scenarioId: "test-scenario",
  kit: "agent-mandate",
  slugPrefix: "agent-mandate",
  simTimeSpeed: 60,
  categories: ["OFFICE"],
  actors: [{ ref: "parent", budget: 100000, allowedCategories: ["OFFICE"] }],
  merchants: [{ ref: "m1", name: "Acme", approvedCategories: ["OFFICE"] }],
  personas: [{ type: "compliant-shopper", count: 5, params: {} }],
};

describe("scenario-schema", () => {
  it("accepts a valid scenario and fills defaults", () => {
    const parsed = parseScenario(validScenario, "inline");
    assert.equal(parsed.scenarioId, "test-scenario");
    assert.equal(parsed.simTimeSpeed, 60);
    assert.deepEqual(parsed.personas[0]!.params, {});
  });

  it("rejects a scenario missing required fields", () => {
    const bad = { ...validScenario, actors: [] };
    assert.throws(() => parseScenario(bad, "inline"), /Invalid scenario/);
  });

  it("rejects a scenario with an empty personas array", () => {
    const bad = { ...validScenario, personas: [] };
    assert.throws(() => parseScenario(bad, "inline"), /Invalid scenario/);
  });

  it("rejects negative persona count", () => {
    const bad = { ...validScenario, personas: [{ type: "compliant-shopper", count: -1 }] };
    assert.throws(() => parseScenario(bad, "inline"), /Invalid scenario/);
  });

  it("loads and validates the shipped track3-week.yaml scenario", () => {
    const p = path.join(__dirname, "..", "scenarios", "track3-week.yaml");
    const scenario = loadScenarioFile(p);
    assert.equal(scenario.scenarioId, "track3-week");
    assert.equal(scenario.kit, "agent-mandate");
    assert.equal(scenario.actors.length, 5);
    assert.equal(scenario.merchants.length, 12);
    assert.equal(scenario.personas.length, 7);
    const totalCount = scenario.personas.reduce((sum, p) => sum + p.count, 0);
    assert.equal(totalCount, 73);
  });
});
