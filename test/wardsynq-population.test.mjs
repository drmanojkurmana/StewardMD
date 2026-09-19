/* test/wardsynq-population.test.mjs — the letter you should not send.
 *
 * The tests that matter are the suppression ones. A care-gap engine that is merely correct will post
 * a diabetic recall letter to a woman who died last month, and the system will have caused that.
 *
 * node --test test/wardsynq-population.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ENTRY, SUPPRESSION, DECLINE_HONOURED_DAYS, DIABETES, PopulationError,
  defineRegistry, defineGap, evaluateMembership, openGaps, suppressionFor,
  buildOutreachList, recordDecline,
} from "../wardsynq/wardsynq-population.js";

const NOW = "2026-09-04T12:00:00.000Z";
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

const patient = (over) => ({
  id: "pat-1", phone: "+91 90000 00000",
  conditions: [{ code: "E11.9" }],
  results: [{ code: "4548-4", value: 7.9, at: daysAgo(200) }],
  lastRetinalScreening: daysAgo(400),
  lastFootCheck: daysAgo(100),
  ...over,
});

/* ------------------------------------------------------------------ membership carries its reason */

test("a coded diagnosis and a software inference are recorded differently", () => {
  const coded = evaluateMembership(DIABETES, patient());
  assert.equal(coded.entry, ENTRY.CODED);
  assert.equal(coded.inferred, false);

  const inferred = evaluateMembership(DIABETES, patient({ conditions: [], medications: [{ drug: "metformin 500mg" }] }));
  assert.equal(inferred.entry, ENTRY.MEDICATION);
  assert.equal(inferred.inferred, true);
  assert.match(inferred.explanation, /not from a recorded diagnosis/,
    "a patient must be able to see and challenge why software put them on a list");
});

test("a result can infer membership, and someone with nothing is not a member", () => {
  const byResult = evaluateMembership(DIABETES, { id: "p", conditions: [], results: [{ code: "4548-4", value: 7.1 }] });
  assert.equal(byResult.entry, ENTRY.RESULT);
  assert.equal(evaluateMembership(DIABETES, { id: "p", conditions: [] }), null);
});

/* ------------------------------------------------------------------ gaps */

test("an overdue gap is open, and its overdue days are reported", () => {
  const gaps = openGaps(DIABETES, patient(), NOW);
  const retinal = gaps.find((g) => g.gapId === "retinal-screening");
  assert.ok(retinal);
  assert.equal(retinal.overdueDays, 35);
  assert.equal(gaps.find((g) => g.gapId === "foot-check"), undefined, "100 days is not overdue against a year");
});

test("ADVERSARIAL: a test NEVER done is open, not silently dropped", () => {
  const gaps = openGaps(DIABETES, patient({ lastRetinalScreening: null }), NOW);
  const retinal = gaps.find((g) => g.gapId === "retinal-screening");
  assert.equal(retinal.neverDone, true);
  assert.equal(retinal.overdueDays, null,
    "a days-since calculation produces NaN here and quietly compares false, dropping the patient who never had it");
});

test("a registry and a gap both need their definitions to be complete", () => {
  assert.throws(() => defineRegistry({ id: "x", criteria: () => null }), (e) => e instanceof PopulationError && e.code === "NO_VERSION");
  assert.throws(() => defineRegistry({ id: "x", version: "1" }), (e) => e.code === "NO_CRITERIA");
  assert.throws(() => defineGap({ id: "g", lastDone: () => null }), (e) => e.code === "NO_INTERVAL");
  assert.throws(() => defineGap({ id: "g", intervalDays: 30 }), (e) => e.code === "NO_LAST_DONE");
});

/* ------------------------------------------------------------------ ADVERSARIAL: who must not be written to */

test("ADVERSARIAL: a deceased patient is never on an outreach list", () => {
  const s = suppressionFor(patient({ deceasedAt: daysAgo(20) }), { gapId: "hba1c", now: NOW });
  assert.equal(s.suppressed, true);
  assert.equal(s.reasons[0].code, SUPPRESSION.DECEASED);
  assert.match(s.reasons[0].detail, /a cruelty the system caused/);
});

test("ADVERSARIAL: a palliative patient is not recalled for screening", () => {
  const s = suppressionFor(patient({ palliative: true }), { gapId: "retinal-screening", now: NOW });
  assert.equal(s.reasons[0].code, SUPPRESSION.PALLIATIVE);
});

test("ADVERSARIAL: a decline PERSISTS and is not re-detected every month", () => {
  const p = recordDecline(patient(), { gapId: "retinal-screening", at: daysAgo(30), reason: "does not want it" });
  const s = suppressionFor(p, { gapId: "retinal-screening", now: NOW });
  assert.equal(s.reasons[0].code, SUPPRESSION.DECLINED);
  assert.match(s.reasons[0].detail, /teaches people to ignore the letter that mattered/);

  // But it does not last forever: after the honoured period the question may be asked again.
  const old = recordDecline(patient(), { gapId: "retinal-screening", at: daysAgo(DECLINE_HONOURED_DAYS + 10) });
  assert.equal(suppressionFor(old, { gapId: "retinal-screening", now: NOW }).suppressed, false);
});

test("a decline is specific to what was declined", () => {
  const p = recordDecline(patient(), { gapId: "retinal-screening", at: daysAgo(10) });
  assert.equal(suppressionFor(p, { gapId: "hba1c", now: NOW }).suppressed, false);
  assert.throws(() => recordDecline(patient(), {}), (e) => e.code === "NO_GAP");
});

test("ADVERSARIAL: EVERY applicable reason is returned, not just the first", () => {
  const p = patient({ deceasedAt: daysAgo(5), palliative: true, optedOutOfOutreach: true, phone: null });
  const s = suppressionFor(p, { gapId: "hba1c", now: NOW });
  const codes = s.reasons.map((r) => r.code);
  assert.ok(codes.length >= 4, "one reason at a time invites somebody to clear it and re-run");
  assert.ok(codes.includes(SUPPRESSION.DECEASED));
  assert.ok(codes.includes(SUPPRESSION.NO_CONTACT_DETAILS));
});

test("someone with no contact details needs finding, not writing to", () => {
  const s = suppressionFor({ id: "p" }, { gapId: "hba1c", now: NOW });
  assert.equal(s.reasons[0].code, SUPPRESSION.NO_CONTACT_DETAILS);
  assert.match(s.reasons[0].detail, /needs finding, not writing to/);
});

test("a recent contact and active care both suppress", () => {
  const recent = suppressionFor(patient({ outreachContacts: [{ at: daysAgo(10) }] }), { gapId: "hba1c", now: NOW });
  assert.equal(recent.reasons[0].code, SUPPRESSION.RECENTLY_CONTACTED);
  const active = suppressionFor(patient({ underActiveCareFor: ["retinal-screening"] }), { gapId: "retinal-screening", now: NOW });
  assert.equal(active.reasons[0].code, SUPPRESSION.UNDER_ACTIVE_CARE);
});

/* ------------------------------------------------------------------ ADVERSARIAL: the list */

test("ADVERSARIAL: suppression happens BEFORE the list exists, not as a filter over it", () => {
  const list = buildOutreachList(DIABETES, [
    patient({ id: "alive" }),
    patient({ id: "died", deceasedAt: daysAgo(20) }),
  ], { now: NOW });

  assert.ok(list.contact.every((r) => r.patientId !== "died"),
    "a filter over an existing list is a list somebody can export before the filter runs");
  assert.equal(list.suppressed, undefined, "and the suppressed rows are not even returned by default");
  assert.equal(list.suppressedBy[SUPPRESSION.DECEASED], 2,
    "counted per suppressed outreach item, not per patient: this patient had two open gaps and both letters were stopped");
});

test("suppressed rows are available when explicitly asked for, with their reasons", () => {
  const list = buildOutreachList(DIABETES, [patient({ id: "died", deceasedAt: daysAgo(20) })], { now: NOW, includeSuppressed: true });
  assert.ok(list.suppressed.length >= 1);
  assert.equal(list.suppressed[0].suppression.reasons[0].code, SUPPRESSION.DECEASED);
});

test("ADVERSARIAL: the list is ordered by CLINICAL RISK, not by how overdue anything is", () => {
  const list = buildOutreachList(DIABETES, [
    // Ten years overdue for an HbA1c, which is a moderate-risk gap.
    patient({ id: "very-overdue-low-risk", results: [{ code: "4548-4", value: 7.1, at: daysAgo(3650) }], lastRetinalScreening: daysAgo(10) }),
    // Barely overdue for retinal screening, which is high risk because sight is what is at stake.
    patient({ id: "just-overdue-high-risk", results: [{ code: "4548-4", value: 7.1, at: daysAgo(10) }], lastRetinalScreening: daysAgo(366) }),
  ], { now: NOW });

  assert.equal(list.contact[0].patientId, "just-overdue-high-risk",
    "the largest overdue number and the sickest patient are rarely the same person");
  assert.equal(list.contact[0].gap.risk, "high");
  assert.equal(list.contact[0].gap.overdueDays, 1);
});

test("inside a risk band, the longest wait comes first", () => {
  const list = buildOutreachList(DIABETES, [
    patient({ id: "a", results: [{ code: "4548-4", value: 7.1, at: daysAgo(200) }], lastRetinalScreening: daysAgo(10) }),
    patient({ id: "b", results: [{ code: "4548-4", value: 7.1, at: daysAgo(900) }], lastRetinalScreening: daysAgo(10) }),
  ], { now: NOW });
  assert.equal(list.contact[0].patientId, "b");
});

test("ADVERSARIAL: the list says plainly that overdue is not unwell", () => {
  const list = buildOutreachList(DIABETES, [patient()], { now: NOW });
  assert.match(list.caution, /Being overdue for a test is not the same as being unwell/);
  assert.match(list.caution, /a list of people for whom contact costs something/);
});

test("non-members and patients with no gaps simply are not on it", () => {
  const list = buildOutreachList(DIABETES, [
    { id: "healthy", conditions: [], phone: "x" },
    patient({ id: "up-to-date", results: [{ code: "4548-4", value: 7.1, at: daysAgo(10) }], lastRetinalScreening: daysAgo(10), lastFootCheck: daysAgo(10) }),
  ], { now: NOW });
  assert.equal(list.contactCount, 0);
  assert.equal(list.notMembers, 1);
});

test("the registry version travels with the list", () => {
  const list = buildOutreachList(DIABETES, [patient()], { now: NOW });
  assert.equal(list.registryId, "diabetes");
  assert.match(list.registryVersion, /unapproved/);
});
