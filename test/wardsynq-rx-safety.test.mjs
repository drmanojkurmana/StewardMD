/* test/wardsynq-rx-safety.test.mjs — advisory-only CDSS wiring for native OPD prescribing.
 *
 * The single thing every test here is written to prove: this file NEVER gates a prescription,
 * whatever the safety engine finds — see rx-safety.js's header for why (unapproved clinical
 * content, per vault/modules/WardSynQ.md's own STATUS line). It surfaces findings; it never refuses.
 *
 * A second thing proven explicitly: allergy checking is genuinely best-effort today (no
 * AllergyIntolerance data exists anywhere yet) but the WIRING is real — given real allergy data, it
 * would find a real match. Interaction checking is real right now, against real active meds.
 *
 * node --test test/wardsynq-rx-safety.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileRulePack } from "../wardsynq/wardsynq-safety.js";
import { evaluateRx, checkPrescriptionSafety } from "../functions/_wardsynq/rx-safety.js";

const TEST_PACK = compileRulePack({
  version: "test-1",
  drugClasses: {
    warfarin: ["anticoagulant"],
    ibuprofen: ["nsaid"],
    paracetamol: ["analgesic"],
  },
  interactions: [
    {
      id: "xr-warfarin-nsaid", type: "pair", severity: "major",
      subjects: [{ kind: "generic", value: "warfarin" }, { kind: "class", value: "nsaid" }],
      effect: "Increased bleeding risk.",
    },
  ],
  allergyClasses: { amoxicillin: ["penicillin_class"] },
  crossReactivity: [],
});

test("evaluateRx NEVER gates: no allowed/blocks/blocked field exists on the response, whatever it finds", () => {
  const v = evaluateRx({ drug: "warfarin", generic: "warfarin" }, [{ drug: "ibuprofen", drugCode: "ibuprofen" }], [], TEST_PACK);
  assert.equal(v.unapproved, true, "every response is labeled unapproved — never presentable as a cleared control");
  assert.ok(!("allowed" in v), "no allowed field — this file has no concept of refusing an order");
  assert.ok(!("blocked" in v), "no blocked field either — findings are surfaced, never enforced");
  assert.ok(v.findings.length >= 1, "the real interaction is still found and reported");
  assert.equal(v.findings[0].code, "INTERACTION_MAJOR");
});

test("interaction checking is REAL: uses the patient's actual active meds", () => {
  const withInteraction = evaluateRx({ drug: "warfarin" }, [{ drug: "ibuprofen" }], [], TEST_PACK);
  assert.ok(withInteraction.findings.some((f) => f.code.startsWith("INTERACTION_")));
  const withoutInteraction = evaluateRx({ drug: "warfarin" }, [{ drug: "paracetamol" }], [], TEST_PACK);
  assert.equal(withoutInteraction.findings.filter((f) => f.code.startsWith("INTERACTION_")).length, 0, "no interaction, no finding — not manufactured");
});

test("allergy checking is BEST-EFFORT, honestly: empty allergy list finds nothing (no data exists yet)", () => {
  const v = evaluateRx({ drug: "amoxicillin" }, [], [], TEST_PACK);
  assert.equal(v.findings.filter((f) => f.code.startsWith("ALLERGY")).length, 0, "an empty allergy list contributes nothing — this is the named gap, not a bug");
});

test("...but the wiring is REAL: given actual allergy data, it finds the match", () => {
  const v = evaluateRx({ drug: "amoxicillin" }, [], [{ substance: "amoxicillin", severity: "severe", reaction: "rash" }], TEST_PACK);
  assert.ok(v.findings.some((f) => f.code.startsWith("ALLERGY")), "the day allergy capture ships, this activates with zero code change here");
});

test("unresolved drug is reported, not silently treated as safe", () => {
  const v = evaluateRx({ drug: "some-drug-not-in-any-pack" }, [], [], TEST_PACK);
  assert.equal(v.unresolvedDrug, true);
  assert.equal(v.findings.length, 0, "unresolved means nothing could be checked, which is itself the finding (unresolvedDrug), not a fabricated clean bill");
});

test("checkPrescriptionSafety degrades to a safe, empty advisory on ANY failure — never throws, never blocks", async () => {
  // No env.CONNECT_DB / no db in actorDeps -> resolveClinicalActor throws PermissionError internally.
  const v = await checkPrescriptionSafety(new Request("https://x"), {}, {
    candidate: { drug: "warfarin" }, patientId: "opd-pat-x", tenantId: "missing-tenant",
    actorDeps: {}, recordDeps: { repository: null, pseudonym: async () => null }, rulePack: TEST_PACK,
  });
  assert.equal(v.unapproved, true);
  assert.equal(v.degraded, true);
  assert.deepEqual(v.findings, []);
});
