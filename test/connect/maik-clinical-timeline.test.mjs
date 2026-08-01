// test/connect/maik-clinical-timeline.test.mjs — Part 4: Clinical Timeline Engine (SCCM -> chronological patient history).
// Deterministic, pure, no LLM. Fixture is HAND-AUTHORED synthetic (no real PHI).
//
// These tests pin: (1) events in strict most-recent-first order with the right kinds; (2) a resource with no
// parseable date lands in undated[] and is NEVER assigned a fabricated date; (3) abnormal labs are marked;
// (4) partial dates (YYYY, YYYY-MM) sort correctly and are carried verbatim; (5) empty/partial/malformed bundle
// never throws and returns an empty result; (6) no-fabrication — every event date + title token traces verbatim
// to the source bundle; (7) bounded on a large/hostile bundle; (8) deterministic (no wall clock, stable ties).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClinicalTimeline } from "../../functions/_connect/maik/clinical-timeline.js";
import { bundle, patient, encounter, condition, medicationStatement, observation, diagnosticReport } from "../../functions/_connect/canonical/model.js";
import { codeable, coding, quantity } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

// Build a SCCM CodeableConcept with an optional standard code.
function cc(text, system, code) { return codeable({ text, coding: code ? [coding({ system, code })] : [] }); }

// A rich, valid SCCM bundle spanning many dates: encounters, conditions (incl. partial-date + no-date onset),
// labs (abnormal via flag AND via range) + a vital + a normal lab, a diagnostic report, a defensive procedure,
// and meds (one dated, one with NO date). Designed so the chronological order is fully determined.
function richBundle() {
  const b = bundle({
    tenantId: "t1", sourceConnector: "fhir-r4", generatedAt: "2026-08-01T00:00:00.000Z",
    patient: patient({ id: "PSEUDO-001", gender: "female", birthDate: "1964-02-01" }),
    encounters: [
      encounter({ id: "e-old", status: "finished", class: "AMB", period: { start: "2025-05-01", end: "2025-05-01" }, reason: "routine follow-up" }),
      encounter({ id: "e-new", status: "in-progress", class: "IMP", period: { start: "2026-07-30" }, reason: "sepsis admission" }),
    ],
    conditions: [
      condition({ id: "c-sepsis", code: cc("Sepsis", "http://snomed.info/sct", "91302008"), clinicalStatus: "active", onset: "2026-07-29" }),
      condition({ id: "c-dm", code: cc("Type 2 diabetes", "http://hl7.org/fhir/sid/icd-10", "E11"), clinicalStatus: "active", onset: "2019-01-01" }),
      condition({ id: "c-partial-year", code: cc("Asthma", "http://snomed.info/sct", "195967001"), clinicalStatus: "active", onset: "2018" }),         // partial YYYY
      condition({ id: "c-partial-month", code: cc("Migraine", "http://snomed.info/sct", "37796009"), clinicalStatus: "active", onset: "2019-06" }),     // partial YYYY-MM
      condition({ id: "c-noonset", code: cc("Essential hypertension", "http://hl7.org/fhir/sid/icd-10", "I10"), clinicalStatus: "active", recordedDate: "2024-01-01" }), // NO onset -> undated
    ],
    observations: [
      observation({ id: "o-hba1c", category: "laboratory", code: cc("HbA1c", "http://loinc.org", "4548-4"), value: quantity({ value: 9.1, unit: "%" }), interpretation: cc("high"), referenceRange: { low: quantity({ value: 4, unit: "%" }), high: quantity({ value: 5.6, unit: "%" }) }, effectiveDateTime: "2026-07-28" }),
      observation({ id: "o-hb", category: "laboratory", code: cc("Hemoglobin", "http://loinc.org", "718-7"), value: quantity({ value: 7.2, unit: "g/dL" }), referenceRange: { low: quantity({ value: 12, unit: "g/dL" }), high: quantity({ value: 16, unit: "g/dL" }) }, effectiveDateTime: "2026-07-31" }),
      observation({ id: "o-na", category: "laboratory", code: cc("Sodium", "http://loinc.org", "2951-2"), value: quantity({ value: 140, unit: "mmol/L" }), referenceRange: { low: quantity({ value: 135 }), high: quantity({ value: 145 }) }, effectiveDateTime: "2026-07-27" }),
      observation({ id: "o-hr", category: "vital-signs", code: cc("Heart rate"), value: quantity({ value: 88, unit: "/min" }), effectiveDateTime: "2026-07-31" }),
    ],
    diagnosticReports: [
      diagnosticReport({ id: "d1", code: cc("CBC panel", "http://loinc.org", "58410-2"), status: "final", conclusion: "Anemia, normocytic", effectiveDateTime: "2026-07-31" }),
    ],
    medications: [
      medicationStatement({ id: "m-dated", medication: cc("Metformin 500mg", "http://www.nlm.nih.gov/research/umls/rxnorm", "860975"), status: "active", dosage: { text: "500 mg BID" }, effectivePeriod: { start: "2026-07-30" } }),
      medicationStatement({ id: "m-undated", medication: cc("Aspirin 75mg", "http://www.nlm.nih.gov/research/umls/rxnorm", "1191"), status: "active", dosage: { text: "75 mg OD" } }), // NO effectivePeriod -> undated
    ],
  });
  // Procedures are not modelled by SCCM v1; attach defensively to exercise the `procedure` passthrough.
  b.procedures = [{ id: "pr1", code: cc("Central venous catheter insertion", "http://snomed.info/sct", "392230005"), performedDateTime: "2026-07-30" }];
  return b;
}

test("fixture is a valid SCCM bundle", () => {
  assert.equal(validateBundle(richBundle()).ok, true);
});

test("events are in strict most-recent-first order with the right kinds (stable date->kind->title tie-break)", () => {
  const { events } = buildClinicalTimeline(richBundle());
  // 13 dated events (2 undated: c-noonset, m-undated)
  assert.equal(events.length, 13);
  // dates are non-increasing
  for (let i = 1; i < events.length; i++) {
    assert.ok(Date.parse(events[i - 1].date) >= Date.parse(events[i].date), "not sorted desc at " + i);
  }
  // 2026-07-31 has three events; kind ASC tie-break => diagnostic-report, lab-result, observation
  assert.deepEqual(events.slice(0, 3).map((e) => [e.date, e.kind]), [
    ["2026-07-31", "diagnostic-report"], ["2026-07-31", "lab-result"], ["2026-07-31", "observation"],
  ]);
  // 2026-07-30 has three events; kind ASC => encounter, medication, procedure
  assert.deepEqual(events.slice(3, 6).map((e) => [e.date, e.kind]), [
    ["2026-07-30", "encounter"], ["2026-07-30", "medication"], ["2026-07-30", "procedure"],
  ]);
  // then singletons, most-recent first
  assert.deepEqual(events.slice(6).map((e) => [e.date, e.kind]), [
    ["2026-07-29", "condition-onset"], // Sepsis
    ["2026-07-28", "lab-result"],      // HbA1c
    ["2026-07-27", "lab-result"],      // Sodium
    ["2025-05-01", "encounter"],       // old follow-up
    ["2019-06", "condition-onset"],    // Migraine (partial YYYY-MM)
    ["2019-01-01", "condition-onset"], // Diabetes
    ["2018", "condition-onset"],       // Asthma (partial YYYY)
  ]);
});

test("titles + codes trace to the source resource (encounter reason, condition text, lab code+value, report conclusion)", () => {
  const { events } = buildClinicalTimeline(richBundle());
  const byId = Object.fromEntries(events.map((e) => [e.evidence.id, e]));
  assert.equal(byId["e-new"].title, "sepsis admission");
  assert.equal(byId["c-sepsis"].title, "Sepsis");
  assert.equal(byId["c-sepsis"].code, "91302008");
  assert.equal(byId["c-sepsis"].system, "http://snomed.info/sct");
  assert.equal(byId["o-hb"].title, "Hemoglobin 7.2 g/dL");
  assert.equal(byId["o-hb"].value, 7.2);
  assert.equal(byId["o-hb"].unit, "g/dL");
  assert.equal(byId["d1"].title, "CBC panel");
  assert.equal(byId["d1"].detail, "Anemia, normocytic");
  assert.equal(byId["m-dated"].title, "Metformin 500mg 500 mg BID");
  assert.equal(byId["pr1"].title, "Central venous catheter insertion");
  // resourceType carried per event
  assert.equal(byId["o-hb"].resourceType, "Observation");
  assert.equal(byId["e-new"].resourceType, "Encounter");
  assert.equal(byId["m-dated"].resourceType, "MedicationStatement");
});

test("lab category splits kind: laboratory => lab-result, non-lab => observation", () => {
  const { events } = buildClinicalTimeline(richBundle());
  const byId = Object.fromEntries(events.map((e) => [e.evidence.id, e]));
  assert.equal(byId["o-hb"].kind, "lab-result");
  assert.equal(byId["o-hr"].kind, "observation"); // vital-signs
});

test("abnormal labs are marked (interpretation flag AND out-of-range); normal labs are not", () => {
  const { events } = buildClinicalTimeline(richBundle());
  const byId = Object.fromEntries(events.map((e) => [e.evidence.id, e]));
  assert.equal(byId["o-hba1c"].abnormal, true); // via interpretation "high"
  assert.equal(byId["o-hba1c"].flag, "H");
  assert.equal(byId["o-hb"].abnormal, true);    // via out-of-range value
  assert.equal(byId["o-hb"].flag, "L");
  assert.equal("abnormal" in byId["o-na"], false); // in-range normal -> not marked
  assert.equal("abnormal" in byId["o-hr"], false); // vital, no range/flag -> not marked
});

test("a resource with NO parseable date goes to undated[] and is NEVER assigned a date", () => {
  const { events, undated } = buildClinicalTimeline(richBundle());
  const undatedIds = undated.map((u) => u.evidence.id).sort();
  assert.deepEqual(undatedIds, ["c-noonset", "m-undated"]);
  // never in events
  const eventIds = new Set(events.map((e) => e.evidence.id));
  assert.equal(eventIds.has("c-noonset"), false);
  assert.equal(eventIds.has("m-undated"), false);
  // undated items carry NO date field at all (no fabricated value)
  for (const u of undated) assert.equal("date" in u, false);
  // but they keep their kind + verbatim title
  const un = Object.fromEntries(undated.map((u) => [u.evidence.id, u]));
  assert.equal(un["c-noonset"].kind, "condition-onset");
  assert.equal(un["c-noonset"].title, "Essential hypertension");
  assert.equal(un["m-undated"].kind, "medication");
  assert.equal(un["m-undated"].title, "Aspirin 75mg 75 mg OD");
});

test("partial dates (YYYY, YYYY-MM) sort correctly AND are carried verbatim", () => {
  const { events } = buildClinicalTimeline(richBundle());
  const byId = Object.fromEntries(events.map((e) => [e.evidence.id, e]));
  assert.equal(byId["c-partial-year"].date, "2018");     // verbatim, not reformatted
  assert.equal(byId["c-partial-month"].date, "2019-06"); // verbatim, not reformatted
  // ordering: 2019-06 (Jun 2019) is more recent than 2019-01-01 which is more recent than 2018
  const order = events.filter((e) => e.kind === "condition-onset").map((e) => e.date);
  assert.deepEqual(order, ["2026-07-29", "2019-06", "2019-01-01", "2018"]);
});

test("counts: per-kind tally over dated events + undated + total", () => {
  const { events, undated, counts } = buildClinicalTimeline(richBundle());
  assert.equal(counts["lab-result"], 3);
  assert.equal(counts["observation"], 1);
  assert.equal(counts["encounter"], 2);
  assert.equal(counts["condition-onset"], 4);
  assert.equal(counts["procedure"], 1);
  assert.equal(counts["diagnostic-report"], 1);
  assert.equal(counts["medication"], 1);
  assert.equal(counts["undated"], 2);
  assert.equal(counts["total"], 15);
  // invariants: per-kind (dated) sum === events.length; undated === undated.length; total === events + undated
  const perKindSum = Object.entries(counts)
    .filter(([k]) => k !== "undated" && k !== "total")
    .reduce((n, [, v]) => n + v, 0);
  assert.equal(perKindSum, events.length);
  assert.equal(counts.undated, undated.length);
  assert.equal(counts.total, events.length + undated.length);
});

test("empty / partial / malformed bundle never throws and returns { events:[], undated:[], counts:{} }", () => {
  for (const input of [undefined, null, {}, { patient: null }, { conditions: "not-an-array" }, { observations: [null, 1, "x"] }, 42, "nope", []]) {
    const t = buildClinicalTimeline(input);
    assert.deepEqual(t.events, []);
    assert.deepEqual(t.undated, []);
    assert.deepEqual(t.counts, {});
  }
});

test("NO-FABRICATION: every event date is verbatim, and every alpha token of every title/detail is present in the source", () => {
  const src = richBundle();
  const srcJson = JSON.stringify(src);
  const { events, undated } = buildClinicalTimeline(src);
  const all = [...events, ...undated];
  assert.ok(all.length > 0);
  for (const e of all) {
    if ("date" in e) assert.ok(srcJson.includes(e.date), "fabricated date: " + e.date);
    // atomic fields must be verbatim
    for (const f of ["code", "system", "detail", "unit"]) {
      if (e[f] != null) assert.ok(srcJson.includes(String(e[f])), "fabricated " + f + ": " + e[f]);
    }
    if (e.value != null) assert.ok(srcJson.includes(String(e.value)), "fabricated value: " + e.value);
    // every word (letter-bearing token) of the title/detail must exist verbatim in the source
    for (const s of [e.title, e.detail]) {
      if (!s) continue;
      for (const tok of String(s).split(/\s+/)) {
        if (/[a-zA-Z]/.test(tok)) assert.ok(srcJson.includes(tok), "fabricated token in title/detail: " + tok);
      }
    }
  }
});

test("evidence traces each event back to its source resource (resourceType + id + sourceField)", () => {
  const { events, undated } = buildClinicalTimeline(richBundle());
  for (const e of [...events, ...undated]) {
    assert.ok(e.evidence && typeof e.evidence === "object");
    assert.equal(typeof e.evidence.resourceType, "string");
    assert.ok(e.evidence.id != null);
    assert.equal(typeof e.evidence.sourceField, "string");
    assert.equal(e.evidence.resourceType, e.resourceType);
  }
});

test("no em-dash / en-dash in generated titles or details (app-facing text)", () => {
  const { events, undated } = buildClinicalTimeline(richBundle());
  for (const e of [...events, ...undated]) {
    for (const s of [e.title, e.detail]) {
      if (!s) continue;
      assert.equal(/[‒–—―]/.test(s), false, "dash char in: " + s);
    }
  }
});

test("bounded: a large/hostile bundle is capped at maxEvents and does not hang", () => {
  const b = bundle({ patient: patient({ id: "P" }) });
  for (let i = 0; i < 10000; i++) {
    b.observations.push(observation({ id: "o" + i, category: "laboratory", code: cc("Lab" + i), value: quantity({ value: i }), effectiveDateTime: "2026-07-" + String((i % 28) + 1).padStart(2, "0") }));
  }
  const def = buildClinicalTimeline(b);
  assert.equal(def.events.length, 500); // default maxEvents
  const small = buildClinicalTimeline(b, { maxEvents: 10 });
  assert.equal(small.events.length, 10);
  // maxEvents:0 => nothing
  const none = buildClinicalTimeline(b, { maxEvents: 0 });
  assert.equal(none.events.length, 0);
  assert.deepEqual(none.counts, {});
});

test("deterministic: repeated calls on the same bundle are byte-identical (no wall clock, no randomness)", () => {
  const a = buildClinicalTimeline(richBundle());
  const b = buildClinicalTimeline(richBundle());
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});
