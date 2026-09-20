/* test/wardsynq-quality-safety.test.mjs — P1.14: quality and safety measures with their case lists.
 *
 * The pure calculation (functions/_wardsynq/quality.js computeQualitySafety). The route and its
 * capability gate are proven in test/wardsynq-incidents-bridge.test.mjs.
 *
 * node --test test/wardsynq-quality-safety.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeQualitySafety, safetyCounts } from "../functions/_wardsynq/quality.js";

const TO = Date.parse("2026-09-30T00:00:00Z"), FROM = Date.parse("2026-09-01T00:00:00Z");
const d = (s) => `2026-09-${s}`;
const stay = (id, patientId, start, end, extra) => ({ id, patientId, class: "IPD", status: end ? "finished" : "in-progress", periodStart: start, periodEnd: end || null, ...extra });
const confirmed = (id, category, when) => ({ id, category, when, patientId: "p1", severity: "minor", confirmation: { outcome: "confirmed" }, state: "reported", capas: [] });
const byId = (r) => Object.fromEntries(r.measures.map((m) => [m.id, m]));

test("no inputs: every rate is null or not computable, never a false zero", () => {
  const m = byId(computeQualitySafety({ fromMs: FROM, toMs: TO }));
  assert.equal(m.falls.rate, null);
  assert.match(m.falls.note, /No occupied bed-days/);
  assert.equal(m["antibiotic-dot"].computable, false);
  assert.match(m["antibiotic-dot"].reason, /antibiotic list not configured/);
  assert.equal(m["bed-utilisation"].computable, false);
  assert.equal(m["length-of-stay"].mean, null);
  assert.equal(m["lab-tat"].median, null);
  assert.equal(m["inpatient-mortality"].rate, null);
});

test("an unreadable input makes its measures null WITH the reason, not zero", () => {
  const m = byId(computeQualitySafety({ fromMs: FROM, toMs: TO, unreadable: { IncidentReport: "not readable with this role" } }));
  assert.equal(m.falls.computable, false);
  assert.equal(m.falls.rate, null);
  assert.match(m.falls.reason, /not readable/);
});

test("LOS, bed-days, incident rates by confirmed category, utilisation, each with its case list", () => {
  const r = computeQualitySafety({
    fromMs: FROM, toMs: TO,
    encounters: [
      stay("e1", "p1", d("01T00:00:00Z"), d("05T00:00:00Z")),  // 4 days
      stay("e2", "p2", d("10T00:00:00Z"), d("20T00:00:00Z")),  // 10 days
      stay("e3", "p3", d("25T00:00:00Z")),                     // open: 5 days to TO
      stay("opd", "p9", d("02T00:00:00Z"), d("02T01:00:00Z"), { class: "OPD" }),
    ],
    incidents: [
      confirmed("i1", "fall", d("03T10:00:00Z")),
      confirmed("i2", "pressure-injury", d("12T10:00:00Z")),
      { ...confirmed("i3", "fall", d("04T10:00:00Z")), confirmation: null },            // a signal: not counted
      { ...confirmed("i4", "fall", d("04T10:00:00Z")), confirmation: { outcome: "duplicate" } },
    ],
    wounds: [
      { id: "w1a", woundId: "w1", patientId: "p2", kind: "pressure", origin: "acquired-here", stage: "2", assessedAt: d("13T00:00:00Z") },
      { id: "w1b", woundId: "w1", patientId: "p2", kind: "pressure", origin: "acquired-here", stage: "3", assessedAt: d("14T00:00:00Z") },
      { id: "w2", woundId: "w2", patientId: "p3", kind: "pressure", origin: "present-on-admission", stage: "3", assessedAt: d("26T00:00:00Z") },
    ],
    beds: { A: ["1", "2"] },
  });
  const m = byId(r);
  assert.equal(r.bedDays, 19);
  assert.equal(m["length-of-stay"].denominator, 2);
  assert.equal(m["length-of-stay"].mean, 7);
  assert.equal(m["length-of-stay"].median, 7);
  assert.deepEqual(m["length-of-stay"].cases.map((c) => c.id), ["e1", "e2"]);
  assert.equal(m.falls.numerator, 1);
  assert.deepEqual(m.falls.cases.map((c) => c.id), ["i1"], "signals and duplicates are not falls");
  assert.equal(m.falls.rate, Math.round((1 / 19) * 1000 * 100) / 100);
  assert.equal(m["pressure-injuries"].numerator, 1);
  assert.equal(m["pressure-injuries"].woundRecords, 1, "one hospital-acquired wound, counted once, reported beside the rate");
  assert.equal(m["medication-errors"].numerator, 0);
  assert.equal(m["medication-errors"].rate, 0, "a real zero over real bed-days is a zero");
  assert.equal(m["bed-utilisation"].denominator, 58);
  assert.equal(m["bed-utilisation"].cases.length, 3);
});

test("mortality and readmission run the seed definitions; outcome unknown is excluded and counted", () => {
  const encounters = [
    stay("e1", "p1", d("01T00:00:00Z"), d("03T00:00:00Z"), { disposition: "home" }),
    stay("e2", "p1", d("10T00:00:00Z"), d("12T00:00:00Z"), { disposition: "home" }),     // readmission of e1
    stay("e3", "p2", d("04T00:00:00Z"), d("06T00:00:00Z"), { disposition: "Died on ward" }),
    stay("e4", "p3", d("04T00:00:00Z"), d("06T00:00:00Z")),                               // no disposition
  ];
  const m = byId(computeQualitySafety({ fromMs: FROM, toMs: Date.parse("2026-11-30T00:00:00Z"), encounters }));
  const mort = m["inpatient-mortality"];
  assert.equal(mort.source, "wardsynq/wardsynq-quality.js");
  assert.equal(mort.denominator, 3);
  assert.equal(mort.numerator, 1);
  assert.equal(mort.rate, null, "under the seed minimum denominator no rate is expressed");
  assert.equal(mort.exclusionsByReason["outcome not recorded"], 1);
  assert.deepEqual(mort.cases.map((c) => c.id), ["e3"]);
  const re = m["readmission-30-day"];
  assert.deepEqual(re.cases.map((c) => c.id), ["e1"]);
  assert.equal(re.numerator, 1);
});

test("sepsis bundle: code-sepsis bundles only, and a running one is held out and counted", () => {
  const m = byId(computeQualitySafety({ fromMs: FROM, toMs: TO, bundles: [{ id: "b1", code: "code-blue", timeZero: d("02T00:00:00Z") }] }));
  assert.equal(m["sepsis-bundle-compliance"].denominator, 0);
  assert.equal(m["sepsis-bundle-compliance"].rate, null);
});

test("antibiotic DOT counts patient-drug-days from the configured list; TAT measures only items with both times", () => {
  const r = computeQualitySafety({
    fromMs: FROM, toMs: TO, antibiotics: ["Ceftriaxone"],
    encounters: [stay("e1", "p1", d("01T00:00:00Z"), d("11T00:00:00Z"))],
    administrations: [
      { id: "a1", patientId: "p1", drug: "Ceftriaxone 1 g", status: "administered", administeredAt: d("02T08:00:00Z") },
      { id: "a2", patientId: "p1", drug: "Ceftriaxone 1 g", status: "administered", administeredAt: d("02T20:00:00Z") },
      { id: "a3", patientId: "p1", drug: "Ceftriaxone 1 g", status: "administered", administeredAt: d("03T08:00:00Z") },
      { id: "a4", patientId: "p1", drug: "Paracetamol", status: "administered", administeredAt: d("03T08:00:00Z") },
      { id: "a5", patientId: "p1", drug: "Ceftriaxone 1 g", status: "refused", administeredAt: d("04T08:00:00Z") },
    ],
    requests: [{ id: "sr1", authoredOn: d("05T08:00:00Z") }, { id: "sr2", authoredOn: d("05T08:00:00Z") }],
    reports: [
      { id: "r1", serviceRequestId: "sr1", reportedAt: d("05T09:30:00Z") },
      { id: "r2", serviceRequestId: "missing", reportedAt: d("05T09:30:00Z") },
      { id: "r3", serviceRequestId: "sr2", category: "imaging", reportedAt: d("05T12:00:00Z") },
    ],
  });
  const m = byId(r);
  assert.equal(m["antibiotic-dot"].numerator, 2);
  assert.equal(m["antibiotic-dot"].rate, 200);
  assert.equal(m["lab-tat"].median, 90);
  assert.equal(m["lab-tat"].excludedMissingTimestamp, 1);
  assert.deepEqual(m["lab-tat"].excludedCases.map((c) => c.id), ["r2"]);
  assert.equal(m["radiology-tat"].median, 240);
});

test("safety counts keep signals, confirmed, root-caused and actions apart", () => {
  const c = safetyCounts([
    { state: "reported" },
    { state: "rejected", confirmation: { outcome: "not-an-incident" } },
    { state: "investigating", confirmation: { outcome: "confirmed" }, rca: {}, capas: [{ state: "open" }, { state: "complete" }] },
  ]);
  assert.deepEqual(c, { signals: 1, confirmed: 1, rejected: 1, withRootCause: 1, capasOpen: 1, capasCompleted: 1 });
});
