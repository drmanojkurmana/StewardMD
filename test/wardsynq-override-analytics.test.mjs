/* test/wardsynq-override-analytics.test.mjs — what clinicians override, and how often. Pure half.
 *
 * node --test test/wardsynq-override-analytics.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { overrideIdFor, overridesFrom, summariseOverrides, SafetyOverride, firingFrom, firingIdFor, firedCountsFrom, ruleKey } from "../functions/_wardsynq/override-analytics.js";

/** A verdict shaped as the safety engine returns one, with a cleared (overridden) finding. */
const verdict = (over) => ({
  rulePackVersion: "rx-2026.09",
  warnings: [
    { code: "interaction", ruleId: "ddi-warfarin-nsaid", severity: "major", overridden: true },
    { code: "dose", severity: "moderate" },   // a warning nobody overrode
  ],
  overrides: [
    { code: "interaction", targetId: "ddi-warfarin-nsaid", reasonCode: "benefit-outweighs-risk", rationale: "Single dose, INR checked today.", actorId: "cfa:dr" },
  ],
  ...(over || {}),
});
const from = (v, over) => overridesFrom({ safety: v, orderId: "rx-1", patientId: "pat", drug: "Ibuprofen", ...(over || {}) });

test("only what the ENGINE cleared is counted, never what a caller asked for", () => {
  const { overrides } = from(verdict());
  assert.equal(overrides.length, 1);
  assert.equal(overrides[0].code, "interaction");
  assert.equal(overrides[0].targetId, "ddi-warfarin-nsaid");
  assert.equal(overrides[0].rulePackVersion, "rx-2026.09", "attributable to the rules in force");
  assert.match(overrides[0].rationale, /INR checked today/);

  /* A caller can send an override for a finding that never fired. Recording it would inflate the
   * rate for a rule nobody actually saw, which would then be "fixed" on the strength of a number
   * that was never real. */
  const phantom = from(verdict({ warnings: [], overrides: [{ code: "allergy", targetId: "x", reasonCode: "r", rationale: "y", actorId: "cfa:dr" }] }));
  assert.deepEqual(phantom.overrides, []);
});

test("an override the engine could not have cleared is REJECTED, not stored half-empty", () => {
  // The engine will not clear a finding without a reasonCode, a rationale and an actor, so their
  // absence means the caller handed us a verdict it did not produce.
  const { overrides, rejected } = from(verdict({ overrides: [{ code: "interaction", targetId: "ddi-warfarin-nsaid", reasonCode: "", rationale: "", actorId: "" }] }));
  assert.deepEqual(overrides, []);
  assert.deepEqual(rejected.map((r) => r.reason), ["override_not_attributable"]);
  // And with no matching override at all.
  assert.deepEqual(from(verdict({ overrides: [] })).rejected.map((r) => r.reason), ["override_not_attributable"]);
});

test("one record per order and finding, so a retried order is the same override", () => {
  assert.equal(overrideIdFor("rx-1", "interaction", "ddi-a"), "wsq-ovr-rx-1-interaction-ddi-a");
  assert.equal(overrideIdFor("rx-1", "interaction", "ddi-a"), overrideIdFor("RX/1", "interaction", "ddi a"));
  // Two different rules on one order stay two records.
  assert.notEqual(overrideIdFor("rx-1", "interaction", "ddi-a"), overrideIdFor("rx-1", "interaction", "ddi-b"));
  // A finding with no specific rule still gets an id.
  assert.equal(overrideIdFor("rx-1", "dose", null), "wsq-ovr-rx-1-dose");
  assert.equal(overrideIdFor("", "dose", null), null);
  assert.equal(overrideIdFor("rx-1", "", null), null);
});

test("THE REPORT IS PER RULE, AND NAMES NO CLINICIAN", () => {
  const rows = [
    SafetyOverride({ id: "o1", code: "interaction", targetId: "ddi-a", reasonCode: "benefit-outweighs-risk", actorId: "cfa:dr1", severity: "major", rulePackVersion: "v1" }),
    SafetyOverride({ id: "o2", code: "interaction", targetId: "ddi-a", reasonCode: "benefit-outweighs-risk", actorId: "cfa:dr2", severity: "major", rulePackVersion: "v1" }),
    SafetyOverride({ id: "o3", code: "interaction", targetId: "ddi-a", reasonCode: "patient-tolerated-previously", actorId: "cfa:dr1", severity: "major", rulePackVersion: "v1" }),
    SafetyOverride({ id: "o4", code: "dose", targetId: null, reasonCode: "specialist-advice", actorId: "cfa:dr3", rulePackVersion: "v1" }),
  ];
  const r = summariseOverrides({ overrides: rows });
  assert.equal(r.totalOverrides, 4);
  assert.equal(r.distinctRules, 2);
  const ddi = r.rules.find((x) => x.targetId === "ddi-a");
  assert.equal(ddi.overridden, 3, "loudest rule first");
  assert.equal(r.rules[0].targetId, "ddi-a");
  assert.equal(ddi.topReason, "benefit-outweighs-risk");
  assert.deepEqual(ddi.reasons, { "benefit-outweighs-risk": 2, "patient-tolerated-previously": 1 });

  /* NO CLINICIAN IS NAMED OR COUNTED. Counting overrides per person turns a tool for fixing a rule
   * pack into a tool for managing staff, and the immediate effect is that people stop writing
   * honest rationales - which destroys the only data that makes the rule fixable. */
  const json = JSON.stringify(r);
  for (const who of ["cfa:dr1", "cfa:dr2", "cfa:dr3"]) assert.ok(!json.includes(who), `${who} must not appear`);
  assert.match(r.note, /evidence about RULES, not about clinicians/);
  // The actor IS on each stored record, because a clinical decision needs an author.
  assert.equal(rows[0].actorId, "cfa:dr1");
});

test("AN OVERRIDE RATE NEEDS A DENOMINATOR, and says null rather than inventing one", () => {
  const rows = [SafetyOverride({ id: "o1", code: "interaction", targetId: "ddi-a", reasonCode: "r" })];
  // Nobody counted how often the rule FIRED, so there is no rate. A number computed against an
  // unknown denominator would be made up, and this report's whole value is being trustworthy enough
  // to change a clinical rule on.
  assert.equal(summariseOverrides({ overrides: rows }).rules[0].overrideRate, null);
  assert.equal(summariseOverrides({ overrides: rows }).rules[0].fired, null);

  // With a denominator it is a real rate.
  const withFired = summariseOverrides({ overrides: rows, firedCounts: { "interaction:ddi-a": 4 } });
  assert.equal(withFired.rules[0].fired, 4);
  assert.equal(withFired.rules[0].overrideRate, 0.25);
  // A rule overridden every single time is exactly the one worth finding.
  assert.equal(summariseOverrides({ overrides: rows, firedCounts: { "interaction:ddi-a": 1 } }).rules[0].overrideRate, 1);
  // A nonsensical denominator yields no rate rather than a divide-by-zero or a lie.
  assert.equal(summariseOverrides({ overrides: rows, firedCounts: { "interaction:ddi-a": 0 } }).rules[0].overrideRate, null);
});

/* ---- the denominator --------------------------------------------------------------------------- */

/** A verdict as the engine returns one: `findings` keeps every finding at its ORIGINAL disposition,
 *  including the ones a clinician went on to clear. */
const evaluated = (findings) => ({
  rulePackVersion: "rx-2026.09",
  findings: findings || [
    { code: "interaction", ruleId: "ddi-warfarin-nsaid", disposition: "overridable", severity: "major" },
    { code: "dose", disposition: "warn" },
    { code: "allergy", allergyId: "alg-1", disposition: "block" },
  ],
});
const fire = (v, over) => firingFrom({ safety: v, orderId: "rx-1", patientId: "pat", ...(over || {}) });

test("A FIRING IS COUNTED WHETHER OR NOT ANYBODY OVERRODE IT", () => {
  /* The good case - a rule fires and the prescriber respects it - is exactly the case that has to
   * reach the denominator. Counting only the orders where somebody overrode something would make
   * every rule in the pack look like it is overridden 100% of the time. */
  const f = fire(evaluated());
  assert.deepEqual(f.keys, ["interaction:ddi-warfarin-nsaid"]);
  assert.equal(f.rulePackVersion, "rx-2026.09");
  assert.equal(f.resourceType, "SafetyFiring");

  // A cleared finding keeps its overridable disposition in `findings`, so it still counts. Reading
  // `overridables` instead would shrink the denominator exactly when the numerator grew.
  const cleared = fire(evaluated([{ code: "interaction", ruleId: "ddi-warfarin-nsaid", disposition: "overridable", overridden: true }]));
  assert.deepEqual(cleared.keys, ["interaction:ddi-warfarin-nsaid"]);
});

test("ONLY OVERRIDABLE FINDINGS COUNT: a hard block is not part of an override rate", () => {
  // Nobody can override a block, so a rate over those is zero by construction and would drag every
  // real number down with it.
  const f = fire(evaluated());
  assert.ok(!f.keys.some((k) => k.startsWith("allergy")), "a block is not a firing");
  assert.ok(!f.keys.some((k) => k.startsWith("dose")), "and neither is a plain warning");
  // An order that raised nothing overridable stores no row at all, rather than an empty one against
  // every prescription in the hospital.
  assert.equal(fire(evaluated([{ code: "dose", disposition: "warn" }])), null);
  assert.equal(fire({ rulePackVersion: "v" }), null);
});

test("ONE FIRING PER ORDER AND PACK VERSION: a retried order is not a second alert", () => {
  assert.equal(firingIdFor("rx-1", "rx-2026.09"), firingIdFor("RX/1", "rx-2026.09"));
  // A different pack is a genuinely different set of rules, so it counts again.
  assert.notEqual(firingIdFor("rx-1", "rx-2026.09"), firingIdFor("rx-1", "rx-2026.10"));
  assert.equal(firingIdFor("", "v"), null);
  // The same rule twice in one evaluation is one firing: the clinician saw one alert.
  const dup = fire(evaluated([
    { code: "interaction", ruleId: "ddi-a", disposition: "overridable" },
    { code: "interaction", ruleId: "ddi-a", disposition: "overridable" },
  ]));
  assert.deepEqual(dup.keys, ["interaction:ddi-a"]);
});

test("THE NUMERATOR AND THE DENOMINATOR ARE KEYED THE SAME WAY", () => {
  /* Two spellings of "this rule" is how a numerator and a denominator end up describing different
   * things, and the rate that results is worse than no rate at all. */
  const o = SafetyOverride({ id: "o1", code: "interaction", targetId: "ddi-a", reasonCode: "r" });
  const f = fire(evaluated([{ code: "interaction", ruleId: "ddi-a", disposition: "overridable" }]));
  assert.equal(ruleKey(o.code, o.targetId), f.keys[0]);

  const counts = firedCountsFrom([f, f, { keys: ["interaction:ddi-a", "dose:max"] }]);
  assert.deepEqual(counts, { "interaction:ddi-a": 3, "dose:max": 1 });
  const report = summariseOverrides({ overrides: [o], firedCounts: counts });
  assert.equal(report.rules[0].fired, 3);
  assert.equal(report.rules[0].overrideRate, 0.33);

  // A malformed stored row contributes nothing rather than throwing the whole report away.
  assert.deepEqual(firedCountsFrom([null, {}, { keys: null }]), {});
  assert.deepEqual(firedCountsFrom(null), {});
});

test("an empty report is empty, not an error", () => {
  const r = summariseOverrides({ overrides: [] });
  assert.deepEqual(r.rules, []);
  assert.equal(r.totalOverrides, 0);
  assert.equal(r.distinctRules, 0);
  assert.match(r.note, /No clinician is named/);
});
