/* test/wardsynq-merp.test.mjs - NABH KPI 4 (owner decision 2026-10-04): the NCC MERP medication-error definition and
 * the A to I severity categories counted beneath it. KPI 9 stays the published ICU standardized mortality ratio. Definitions, capture refusal without a category, counting, grouping, and the handling
 * of a record with no category (uncategorised, never guessed). The routes are proven in
 * test/wardsynq-incidents-bridge.test.mjs.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/wardsynq-merp.test.mjs
 */
import { registerHooks } from "node:module";
registerHooks({ resolve(spec, ctx, next) { const r = next(spec, ctx); if (r.url.endsWith(".json")) r.importAttributes = { type: "json" }; return r; } });

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SEVERITY, CATEGORY, CONFIRM_OUTCOME, IncidentError, MERP_CATEGORY, MERP_CODES, MERP_GROUPS, MERP_NEAR_MISS,
  report, confirm, merpOf, merpSummary,
} from "../wardsynq/wardsynq-incidents.js";
import { computeQualitySafety } from "../functions/_wardsynq/quality.js";
import * as C from "../functions/_wardsynq/compliance.js";

const NOW = "2026-09-04T09:00:00.000Z";
const file = (over) => report({ what: "Heparin given at ten times the ordered rate", severity: SEVERITY.MINOR, reportedBy: "nurse-7", now: NOW, ...over });
const decide = (inc, over) => confirm(inc, { outcome: CONFIRM_OUTCOME.CONFIRMED, reason: "reviewed, a real event", by: "safety-lead", now: NOW, ...over });
const refusal = (code) => (e) => e instanceof IncidentError && e.code === code;

/* ------------------------------------------------------------------ definitions */

test("definitions: categories A to I with the owner's four groups", () => {
  assert.deepEqual(MERP_CODES, ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
  assert.deepEqual(MERP_GROUPS, { "no-error": ["A"], "error-no-harm": ["B", "C", "D"], "error-harm": ["E", "F", "G", "H"], death: ["I"] });
  assert.deepEqual(MERP_NEAR_MISS, ["A", "B"]);
  for (const c of MERP_CODES) {
    assert.ok(MERP_GROUPS[MERP_CATEGORY[c].group].includes(c), c + " is in its own group");
    assert.ok(MERP_CATEGORY[c].label.length > 10, c);
  }
  assert.match(MERP_CATEGORY.A.label, /capacity to cause error/);
  assert.match(MERP_CATEGORY.B.label, /did not reach the patient/);
  assert.match(MERP_CATEGORY.D.label, /monitoring and\/or intervention/);
  assert.match(MERP_CATEGORY.F.label, /hospitalization/);
  assert.match(MERP_CATEGORY.H.label, /sustain life/);
  assert.match(MERP_CATEGORY.I.label, /death/);
});

/* ------------------------------------------------------------------ capture */

test("capture: a medication error is refused without its NCC MERP category, at filing and at confirmation", () => {
  assert.throws(() => file({ category: CATEGORY.MEDICATION_ERROR }), refusal("NO_MERP_CATEGORY"));
  assert.throws(() => file({ category: CATEGORY.MEDICATION_ERROR, merpCategory: "" }), refusal("NO_MERP_CATEGORY"));
  // A report whose kind is not yet known is still accepted, but cannot be CONFIRMED as a medication error without one.
  const signal = file({});
  assert.equal(signal.merpCategory, null);
  assert.throws(() => decide(signal, { category: CATEGORY.MEDICATION_ERROR }), refusal("NO_MERP_CATEGORY"));
  assert.equal(signal.confirmation, null, "a refused decision changes nothing");
  const ok = decide(signal, { category: CATEGORY.MEDICATION_ERROR, merpCategory: "e" });
  assert.equal(ok.merpCategory, "E", "the code is stored upper case");
  // Filed as a medication error with its category, then confirmed without restating it: the filing's category stands.
  assert.equal(decide(file({ category: CATEGORY.MEDICATION_ERROR, merpCategory: "A" })).merpCategory, "A");
});

test("capture: an unknown category is refused, and a category on any other kind of event is refused", () => {
  for (const bad of ["J", "AA", "near-miss", 3]) assert.throws(() => file({ category: CATEGORY.MEDICATION_ERROR, merpCategory: bad }), refusal("BAD_MERP_CATEGORY"), String(bad));
  assert.throws(() => file({ category: CATEGORY.FALL, merpCategory: "C" }), refusal("MERP_NOT_MEDICATION_ERROR"));
  assert.throws(() => decide(file({}), { category: CATEGORY.FALL, merpCategory: "C" }), refusal("MERP_NOT_MEDICATION_ERROR"));
  assert.throws(() => decide(file({}), { category: CATEGORY.MEDICATION_ERROR, merpCategory: "Z" }), refusal("BAD_MERP_CATEGORY"));
});

test("capture: other events and rejected signals are not asked for a category", () => {
  assert.equal(decide(file({ category: CATEGORY.FALL })).merpCategory, null);
  const rejected = confirm(file({}), { outcome: CONFIRM_OUTCOME.NOT_AN_INCIDENT, reason: "not an incident", by: "lead", now: NOW });
  assert.equal(rejected.merpCategory, null);
  // Filed as a medication error, then the investigator decides it was another kind of event: the category does not follow it.
  const refiled = decide(file({ category: CATEGORY.MEDICATION_ERROR, merpCategory: "C" }), { category: CATEGORY.OTHER });
  assert.equal(refiled.category, "other");
  assert.equal(refiled.merpCategory, null);
});

/* ------------------------------------------------------------------ counting and grouping */

const confirmed = (id, category, merpCategory, when, extra) => ({
  id, category, merpCategory, when: when || "2026-09-10T10:00:00Z", patientId: "p1", severity: "minor",
  confirmation: { outcome: "confirmed" }, capas: [], ...extra,
});

test("merpOf: a record with no category, or a bad one, is uncategorised and is never inferred from severity", () => {
  assert.equal(merpOf({ severity: "near-miss" }), "uncategorised");
  assert.equal(merpOf({ severity: "catastrophic", merpCategory: null }), "uncategorised");
  assert.equal(merpOf({ merpCategory: "Q" }), "uncategorised");
  assert.equal(merpOf({ merpCategory: "g" }), "G");
});

test("merpSummary: counts per category and per group; near misses are A and B; uncategorised is its own line", () => {
  const list = [
    confirmed("a1", "medication-error", "A"), confirmed("b1", "medication-error", "B"), confirmed("b2", "medication-error", "B"),
    confirmed("c1", "medication-error", "C"), confirmed("d1", "medication-error", "D"),
    confirmed("e1", "medication-error", "E"), confirmed("f1", "medication-error", "F"), confirmed("g1", "medication-error", "G"), confirmed("h1", "medication-error", "H"),
    confirmed("i1", "medication-error", "I"),
    confirmed("u1", "medication-error", undefined, null, { severity: "near-miss" }),      // filed before the category existed
    confirmed("u2", "medication-error", null, null, { severity: "catastrophic" }),
    confirmed("f9", "fall", undefined),                                                    // another kind of event
    { ...confirmed("s1", "medication-error", "C"), confirmation: null },                  // an unconfirmed signal
    { ...confirmed("x1", "medication-error", "C"), confirmation: { outcome: "duplicate" } },
  ];
  const m = merpSummary(list);
  assert.equal(m.total, 12);
  assert.deepEqual(m.byCategory, { A: 1, B: 2, C: 1, D: 1, E: 1, F: 1, G: 1, H: 1, I: 1, uncategorised: 2 });
  assert.deepEqual(m.byGroup, { "no-error": 1, "error-no-harm": 4, "error-harm": 4, death: 1, uncategorised: 2 });
  assert.equal(m.nearMisses, 3, "A plus B");
  assert.equal(m.uncategorised, 2);
  assert.equal(m.cases.length, 12);
  assert.equal(m.cases.find((c) => c.id === "u2").merpCategory, null, "an uncategorised case names no category, whatever its severity");
  // Every counted case is in exactly one category and one group.
  assert.equal(Object.values(m.byCategory).reduce((a, b) => a + b, 0), m.total);
  assert.equal(Object.values(m.byGroup).reduce((a, b) => a + b, 0), m.total);
  assert.deepEqual(merpSummary([]).byCategory.A, 0);
  assert.equal(merpSummary([], null).total, 0);
});

test("merpSummary: the period narrows the count", () => {
  const list = [confirmed("a", "medication-error", "C", "2026-08-31T10:00:00Z"), confirmed("b", "medication-error", "C", "2026-09-02T10:00:00Z")];
  assert.equal(merpSummary(list, (x) => x.when >= "2026-09-01").total, 1);
});

/* ------------------------------------------------------------------ quality screen (quality.js) */

const FROM = Date.parse("2026-09-01T00:00:00Z"), TO = Date.parse("2026-09-30T00:00:00Z");
const stay = { id: "e1", patientId: "p1", class: "IPD", status: "in-progress", periodStart: "2026-09-01T00:00:00Z", periodEnd: null }; // 29 bed-days to TO
const byId = (r) => Object.fromEntries(r.measures.map((m) => [m.id, m]));

test("quality screen: the medication-error rate counts every confirmed error; near misses, uncategorised and the NCC MERP counts sit beneath it", () => {
  const incidents = [
    confirmed("a1", "medication-error", "A"), confirmed("b1", "medication-error", "B"), confirmed("e1", "medication-error", "E"),
    confirmed("u1", "medication-error", undefined),
    confirmed("old", "medication-error", "C", "2026-07-01T00:00:00Z"),                   // outside the period
  ];
  const m = byId(computeQualitySafety({ fromMs: FROM, toMs: TO, encounters: [stay], incidents }));
  assert.equal(m["medication-error-severity"], undefined, "one row, not two: the categories are part of the medication-error row");
  const r = m["medication-errors"];
  assert.equal(r.numerator, 4);
  assert.equal(r.denominator, 29, "inpatient bed-days, the denominator this measure already had");
  assert.equal(r.rate, Math.round((4 / 29) * 1000 * 100) / 100);
  assert.equal(r.nearMisses, 2);
  assert.equal(r.uncategorised, 1);
  assert.deepEqual(r.byCategory, { A: 1, B: 1, C: 0, D: 0, E: 1, F: 0, G: 0, H: 0, I: 0, uncategorised: 1 });
  assert.deepEqual(r.byGroup, { "no-error": 1, "error-no-harm": 1, "error-harm": 1, death: 0, uncategorised: 1 });
  assert.equal(r.cases.length, 4);
});

test("quality screen: no medication errors is a real zero; unreadable incident records are not computable, not zero", () => {
  const zero = byId(computeQualitySafety({ fromMs: FROM, toMs: TO, encounters: [stay], incidents: [] }))["medication-errors"];
  assert.equal(zero.numerator, 0);
  assert.equal(zero.rate, 0);
  assert.equal(zero.nearMisses, 0);
  assert.equal(zero.byCategory.A, 0);
  const blocked = byId(computeQualitySafety({ fromMs: FROM, toMs: TO, encounters: [stay], unreadable: { IncidentReport: "not readable with this role" } }))["medication-errors"];
  assert.equal(blocked.computable, false);
  assert.match(blocked.reason, /not readable/);
});

/* ------------------------------------------------------------------ NABH table (compliance.js) */

const W = C.monthWindows(Date.parse("2026-09-20T00:00:00Z"), 1, 330)[0];
const at = (day, hh) => new Date(Date.UTC(2026, 8, day, hh || 6) - 330 * 60000).toISOString();
const inc = (id, merp, day, extra) => confirmed(id, "medication-error", merp, at(day), extra);

test("NABH KPI 4: confirmed medication errors per 1000 inpatient bed-days, near misses, uncategorised and the NCC MERP counts beneath", () => {
  const rows = {
    Encounter: [{ id: "e1", patientId: "p1", class: "IPD", status: "in-progress", periodStart: at(1), periodEnd: null }],
    IncidentReport: [inc("a", "A", 3), inc("b", "B", 4), inc("c", "C", 5), inc("g", "G", 6), inc("i", "I", 7), inc("u", undefined, 8), confirmed("f", "fall", undefined, at(7)),
      confirmed("aug", "medication-error", "H", "2026-08-10T00:00:00Z"), { ...inc("sig", "C", 9), confirmation: null }],
  };
  const k4 = C.computeNabhIndicators({ rows, unreadable: {}, windows: [W] }).find((i) => i.no === 4);
  assert.equal(k4.computable, true);
  assert.equal(k4.title, "Incidence of medication errors", "the published title is kept");
  assert.equal(k4.publishedTitle, undefined);
  assert.equal(k4.unit, "per 1000 inpatient bed-days");
  assert.match(k4.denominator, /Inpatient bed-days/);
  assert.match(k4.definition, /preventable event that may cause or lead to inappropriate medication use/);
  const m = k4.months[0];
  assert.equal(m.numerator, 6, "the fall, the signal and August are not counted");
  assert.equal(m.nearMisses, 2);
  assert.equal(m.uncategorised, 1);
  assert.deepEqual(m.byCategory, { A: 1, B: 1, C: 1, D: 0, E: 0, F: 0, G: 1, H: 0, I: 1, uncategorised: 1 });
  assert.deepEqual(m.byGroup, { "no-error": 1, "error-no-harm": 2, "error-harm": 1, death: 1, uncategorised: 1 });
  assert.ok(m.denominator > 0);
  assert.ok(Math.abs(m.value - (6 / m.denominator) * 1000) < 1, "the rate is the count over the bed-days, per 1000 (the denominator is shown to one decimal)");
  assert.match(k4.note, /opportunities/);
});

test("NABH KPI 4: no bed-days gives no rate rather than zero; unreadable incident records are not computable", () => {
  const none = C.computeNabhIndicators({ rows: { IncidentReport: [inc("a", "A", 3)] }, unreadable: {}, windows: [W] }).find((i) => i.no === 4);
  assert.equal(none.months[0].value, null);
  assert.equal(none.months[0].numerator, 1);
  const blocked = C.computeNabhIndicators({ rows: {}, unreadable: { IncidentReport: "not readable with this role" }, windows: [W] }).find((i) => i.no === 4);
  assert.equal(blocked.computable, false);
  assert.match(blocked.reason, /could not be read/);
});

test("NABH KPI 9 is still the published ICU standardized mortality ratio, not computable, unchanged by the NCC MERP work", () => {
  const rows = { IncidentReport: [inc("a", "A", 3), inc("i", "I", 4)] };
  const k9 = C.computeNabhIndicators({ rows, unreadable: {}, windows: [W] }).find((i) => i.no === 9);
  assert.equal(k9.title, "Standardized Mortality Ratio for ICU");
  assert.equal(k9.numerator, "Actual deaths in ICU");
  assert.equal(k9.denominator, "Predicted deaths in ICU");
  assert.equal(k9.unit, "Ratio");
  assert.equal(k9.computable, false);
  assert.equal(k9.reason, "Not computable from WardSynQ data. Missing: Predicted deaths from a severity score (APACHE, SOFA, SAPS, MPM); WardSynQ does not record one.");
  assert.deepEqual(k9.months, []);
  assert.equal(k9.publishedTitle, undefined);
});

test("NABH CSV: KPI 4 carries its NCC MERP detail and KPI 9 is still the SMR row", () => {
  const rows = { Encounter: [{ id: "e1", patientId: "p1", class: "IPD", status: "in-progress", periodStart: at(1), periodEnd: null }], IncidentReport: [inc("b", "B", 4), inc("u", undefined, 6)] };
  const indicators = C.computeNabhIndicators({ rows, unreadable: {}, windows: [W] });
  const csv = C.nabhCsv({ months: [W.month], indicators, formatNote: "note" });
  const line = (no) => csv.split("\r\n").find((l) => l.startsWith(no + ","));
  assert.match(line(4), /near misses \(A, B\) 1, uncategorised 1/);
  assert.match(line(4), /A 0, B 1, C 0/);
  assert.match(line(4), /error-no-harm 1/);
  assert.match(line(9), /Standardized Mortality Ratio for ICU/);
  assert.doesNotMatch(line(9), /near misses|uncategorised/, "no NCC MERP detail on the SMR row");
});
