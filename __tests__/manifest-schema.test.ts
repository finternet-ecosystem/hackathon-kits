import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseManifest } from "../lib/manifest-types";

const KITS_DIR = path.join(__dirname, "..", "kits");
const EXPECTED_KIT_IDS = ["agent-mandate", "kya-licence", "embedded-supervision", "disbursement-integrity"];

function loadManifestFile(fileName: string) {
  const p = path.join(KITS_DIR, fileName);
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return parseManifest(raw, p);
}

describe("hackathon sandbox kit manifests", () => {
  it("all four kit manifest files exist", () => {
    const files = fs.readdirSync(KITS_DIR).filter((f) => f.endsWith(".json"));
    for (const kitId of EXPECTED_KIT_IDS) {
      assert.ok(files.includes(`${kitId}.json`), `missing manifest for kit "${kitId}"`);
    }
  });

  for (const kitId of EXPECTED_KIT_IDS) {
    describe(kitId, () => {
      it("parses against the manifest schema", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        assert.equal(manifest.kitId, kitId);
      });

      it("every actor.fields value used by an eligibilityRule.fieldKey resolves to a tier that actually exists", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        const tierNumbers = new Set(manifest.policy.tiers.map((t) => t.tier));
        for (const rule of manifest.policy.eligibilityRules) {
          assert.ok(tierNumbers.has(rule.tierAssigned), `eligibilityRule "${rule.fieldKey}=${rule.value}" assigns tier ${rule.tierAssigned}, which has no matching policy.tiers entry`);
        }
      });

      it("every actor's fields match at least one eligibilityRule (so self-enrol assigns a real tier, not the tier-0 default)", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        for (const actor of manifest.actors) {
          const matched = manifest.policy.eligibilityRules.some((rule) => {
            const val = (actor.fields as Record<string, unknown>)[rule.fieldKey];
            return val !== undefined && String(val) === rule.value;
          });
          assert.ok(matched, `actor "${actor.ref}" fields ${JSON.stringify(actor.fields)} do not match any eligibilityRule — self-enrol would assign it tier 0 (value 0)`);
        }
      });

      it("every scenario template's actorRef references a real actor", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        const actorRefs = new Set(manifest.actors.map((a) => a.ref));
        for (const step of manifest.violationScript) {
          assert.ok(actorRefs.has(step.actorRef), `scenario "${step.id}" references unknown actorRef "${step.actorRef}"`);
        }
      });

      it("every scenario template's merchantRef (kind:payment) references a real merchant", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        const merchantRefs = new Set(manifest.merchants.map((m) => m.ref));
        for (const step of manifest.violationScript) {
          if (step.kind !== "payment") continue;
          assert.ok(step.merchantRef && merchantRefs.has(step.merchantRef), `scenario "${step.id}" references unknown merchantRef "${step.merchantRef}"`);
        }
      });

      it("every mandate.parentRef and mandateOp.actorRef references a real actor", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        const actorRefs = new Set(manifest.actors.map((a) => a.ref));
        for (const actor of manifest.actors) {
          if (actor.mandate?.parentRef) {
            assert.ok(actorRefs.has(actor.mandate.parentRef), `actor "${actor.ref}" mandate.parentRef "${actor.mandate.parentRef}" does not exist`);
          }
        }
        for (const step of manifest.violationScript) {
          if (step.mandateOp) {
            assert.ok(actorRefs.has(step.mandateOp.actorRef), `scenario "${step.id}" mandateOp.actorRef "${step.mandateOp.actorRef}" does not exist`);
          }
        }
      });

      it("hooks reference merchant refs (via $merchantRef) that exist", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        const merchantRefs = new Set(manifest.merchants.map((m) => m.ref));
        const walk = (v: unknown): void => {
          if (Array.isArray(v)) { v.forEach(walk); return; }
          if (v !== null && typeof v === "object") {
            const obj = v as Record<string, unknown>;
            if (typeof obj.$merchantRef === "string") {
              assert.ok(merchantRefs.has(obj.$merchantRef), `hook ruleConfig references unknown $merchantRef "${obj.$merchantRef}"`);
              return;
            }
            Object.values(obj).forEach(walk);
          }
        };
        for (const hook of manifest.hooks) {
          if (hook.ruleConfig) walk(hook.ruleConfig);
        }
        if (manifest.tightenedRule) walk(manifest.tightenedRule.policyDelta);
      });

      it("rate_limit hooks carry windowMs/limit in actionConfig; rule hooks carry a non-empty ruleConfig", () => {
        const manifest = loadManifestFile(`${kitId}.json`);
        for (const hook of manifest.hooks) {
          if (hook.type === "rate_limit") {
            assert.ok(hook.actionConfig && "windowMs" in hook.actionConfig && "limit" in hook.actionConfig, `rate_limit hook "${hook.name}" is missing windowMs/limit`);
          }
          if (hook.type === "rule") {
            assert.ok(hook.ruleConfig && Object.keys(hook.ruleConfig).length > 0, `rule hook "${hook.name}" has an empty ruleConfig`);
          }
        }
      });
    });
  }

  it("disbursement-integrity ships a tightenedRule (the kit 4 money-shot depends on it)", () => {
    const manifest = loadManifestFile("disbursement-integrity.json");
    assert.ok(manifest.tightenedRule, "disbursement-integrity.json must define tightenedRule");
    assert.ok(manifest.tightenedRule!.rationale.length > 0);
  });

  it("rejects a manifest missing required top-level fields", () => {
    assert.throws(() => parseManifest({ kitId: "broken" }, "test.json"), /Invalid kit manifest/);
  });
});
