// test/connect/maik-clinical-context.test.mjs — Part 4: Clinical Context Assembler (SCCM -> structured MaiK context).
// Deterministic, pure, no LLM. Fixture is HAND-AUTHORED synthetic (no real PHI).
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleClinicalContext } from "../../functions/_connect/maik/clinical-context.js";
import { bundle, patient, encounter, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport } from "../../functions/_connect/canonical/model.js";
import { codeable, coding, quantity } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

// Build a SCCM CodeableConcept with an optional standard code.
function cc(text, system, code) { return codeable({ text, coding: code ? [coding({ system, code })] : [] }); }

// A rich, valid SCCM bundle: active + resolved conditions, current + stopped meds, allergies,
// a mix of normal + abnormal labs (via BOTH flag AND out-of-range), encounters, a diagnostic report.
function richBundle() {
  const b = bundle({
    tenantId: "t1", sourceConnector: "fhir-r4", generatedAt: "2026-08-01T00:00:00.000Z",
    patient: patient({ id: "PSEUDO-001", gender: "female", birthDate: "1964-02-01" }), // age 62 as of generatedAt
    conditions: [
      condition({ id: "c-active-new", code: cc("Sepsis", "http://snomed.info/sct", "91302008"), clinicalStatus: "active", recordedDate: "2026-07-30" }),
      condition({ id: "c-active-old", code: cc("Type 2 diabetes", "http://hl7.org/fhir/sid/icd-10", "E11"), clinicalStatus: "active", recordedDate: "2020-01-01" }),
      condition({ id: "c-recurrence", code: cc("Urinary tract infection", "http://snomed.info/sct", "68566005"), clinicalStatus: "recurrence", recordedDate: "2026-06-01" }),
      condition({ id: "c-resolved", code: cc("Pneumonia", "http://snomed.info/sct", "233604007"), clinicalStatus: "resolved", recordedDate: "2025-01-01" }), // must NOT surface
      condition({ id: "c-nostatus", code: cc("Essential hypertension", "http://hl7.org/fhir/sid/icd-10", "I10"), clinicalStatus: "unknown", recordedDate: "2024-01-01" }), // absent-status fallback -> surfaces
    ],
    medications: [
      medicationStatement({ id: "m-active", medication: cc("Metformin 500mg", "http://www.nlm.nih.gov/research/umls/rxnorm", "860975"), status: "active", dosage: { text: "500 mg BID", route: "oral" } }),
      medicationStatement({ id: "m-stopped", medication: cc("Amoxicillin"), status: "stopped", dosage: { text: "500 mg TID" } }), // must NOT surface
      medicationStatement({ id: "m-intended", medication: cc("Insulin glargine"), status: "intended" }),
      medicationStatement({ id: "m-completed", medication: cc("Ceftriaxone"), status: "completed" }), // must NOT surface
    ],
    allergies: [
      allergyIntolerance({ id: "a1", code: cc("Penicillin", "http://www.nlm.nih.gov/research/umls/rxnorm", "7980"), criticality: "high", reactions: [{ manifestation: { text: "anaphylaxis" } }] }),
      allergyIntolerance({ id: "a2", code: cc("Sulfonamides"), criticality: "low", clinicalStatus: "active" }),
      allergyIntolerance({ id: "a-resolved", code: cc("Latex"), clinicalStatus: "resolved" }), // must NOT surface
    ],
    observations: [
      // abnormal via EXPLICIT interpretation flag
      observation({ id: "o-flag", category: "laboratory", code: cc("HbA1c", "http://loinc.org", "4548-4"), value: quantity({ value: 9.1, unit: "%" }), interpretation: cc("high"), referenceRange: { low: quantity({ value: 4, unit: "%" }), high: quantity({ value: 5.6, unit: "%" }) }, effectiveDateTime: "2026-07-29" }),
      // abnormal via OUT-OF-RANGE value only (no interpretation)
      observation({ id: "o-range-low", category: "laboratory", code: cc("Hemoglobin", "http://loinc.org", "718-7"), value: quantity({ value: 7.2, unit: "g/dL" }), referenceRange: { low: quantity({ value: 12, unit: "g/dL" }), high: quantity({ value: 16, unit: "g/dL" }) }, effectiveDateTime: "2026-07-31" }),
      // NORMAL in-range lab -> must NOT surface
      observation({ id: "o-normal", category: "laboratory", code: cc("Sodium", "http://loinc.org", "2951-2"), value: quantity({ value: 140, unit: "mmol/L" }), referenceRange: { low: quantity({ value: 135 }), high: quantity({ value: 145 }) }, effectiveDateTime: "2026-07-28" }),
      // NORMAL via explicit N interpretation -> must NOT surface
      observation({ id: "o-normal-flag", category: "laboratory", code: cc("Potassium"), value: quantity({ value: 4.1, unit: "mmol/L" }), interpretation: cc("N"), effectiveDateTime: "2026-07-27" }),
      // abnormal-looking VITAL sign -> must NOT surface (not a laboratory obs)
      observation({ id: "o-vital", category: "vital-signs", code: cc("Heart rate"), value: quantity({ value: 130, unit: "/min" }), effectiveDateTime: "2026-07-31" }),
    ],
    diagnosticReports: [
      diagnosticReport({ id: "d1", code: cc("CBC panel", "http://loinc.org", "58410-2"), status: "final", conclusion: "Anemia, normocytic", effectiveDateTime: "2026-07-31" }),
    ],
    encounters: [
      encounter({ id: "e-old", status: "finished", class: "AMB", period: { start: "2025-05-01", end: "2025-05-01" }, reason: "routine follow-up" }),
      encounter({ id: "e-new", status: "in-progress", class: "IMP", period: { start: "2026-07-30" }, reason: "sepsis admission" }),
    ],
  });
  // Procedures are not modelled by SCCM v1; attach defensively to exercise keyProcedures passthrough.
  b.procedures = [{ id: "pr1", code: cc("Central venous catheter insertion", "http://snomed.info/sct", "392230005"), performedDateTime: "2026-07-30" }];
  return b;
}

test("fixture is a valid SCCM bundle", () => {
  assert.equal(validateBundle(richBundle()).ok, true);
});

test("patient carries pseudonymized id + sex + derived age (no invented identifiers)", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.patient.id, "PSEUDO-001");
  assert.equal(ctx.patient.sex, "female");
  assert.equal(ctx.patient.age, 62); // 1964-02-01 as of 2026-08-01
});

test("only ACTIVE/recurrence problems surface (resolved excluded, absent-status falls back to shown)", () => {
  const ctx = assembleClinicalContext(richBundle());
  const texts = ctx.activeProblems.map((p) => p.text);
  assert.deepEqual(texts.sort(), ["Essential hypertension", "Sepsis", "Type 2 diabetes", "Urinary tract infection"].sort());
  assert.equal(texts.includes("Pneumonia"), false); // resolved
  assert.equal(ctx.activeProblems.length, 4);
});

test("problems are most-recent first (by recordedDate/onset)", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.activeProblems[0].text, "Sepsis"); // 2026-07-30 newest
  assert.equal(ctx.activeProblems[ctx.activeProblems.length - 1].text, "Type 2 diabetes"); // 2020 oldest
  assert.equal(ctx.activeProblems[0].code, "91302008");
  assert.equal(ctx.activeProblems[0].system, "http://snomed.info/sct");
});

test("only CURRENT meds surface (stopped/completed excluded)", () => {
  const ctx = assembleClinicalContext(richBundle());
  const drugs = ctx.currentMedications.map((m) => m.drug).sort();
  assert.deepEqual(drugs, ["Insulin glargine", "Metformin 500mg"]);
  assert.equal(ctx.currentMedications.length, 2);
  const met = ctx.currentMedications.find((m) => m.drug === "Metformin 500mg");
  assert.equal(met.dose, "500 mg BID");
  assert.equal(met.route, "oral");
  assert.equal(met.code, "860975");
});

test("allergies surface with substance/criticality/reaction (resolved excluded)", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.allergies.length, 2);
  const pen = ctx.allergies.find((a) => a.substance === "Penicillin");
  assert.equal(pen.criticality, "high");
  assert.ok(JSON.stringify(pen.reaction).includes("anaphylaxis"));
  assert.equal(ctx.allergies.some((a) => a.substance === "Latex"), false); // resolved
});

test("abnormal labs detected via BOTH explicit flag AND out-of-range value; normal + vitals excluded", () => {
  const ctx = assembleClinicalContext(richBundle());
  const byText = Object.fromEntries(ctx.recentAbnormalLabs.map((l) => [l.text, l]));
  assert.ok(byText["HbA1c"], "flagged-high lab surfaces"); // via interpretation
  assert.equal(byText["HbA1c"].flag, "H");
  assert.ok(byText["Hemoglobin"], "out-of-range lab surfaces"); // via referenceRange
  assert.equal(byText["Hemoglobin"].flag, "L");
  assert.equal(byText["Sodium"], undefined); // in-range normal
  assert.equal(byText["Potassium"], undefined); // interpretation N = normal
  assert.equal(byText["Heart rate"], undefined); // vital-signs, not a lab
  assert.equal(ctx.recentAbnormalLabs.length, 2);
  // most-recent first
  assert.equal(ctx.recentAbnormalLabs[0].text, "Hemoglobin"); // 2026-07-31 newest
  assert.equal(ctx.recentAbnormalLabs[0].value, 7.2);
  assert.equal(ctx.recentAbnormalLabs[0].unit, "g/dL");
  assert.equal(ctx.recentAbnormalLabs[0].effective, "2026-07-31");
});

test("encounters are most-recent first with type/date/reason", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.recentEncounters.length, 2);
  assert.equal(ctx.recentEncounters[0].type, "IMP");
  assert.equal(ctx.recentEncounters[0].date, "2026-07-30");
  assert.equal(ctx.recentEncounters[0].reason, "sepsis admission");
});

test("diagnosticReports + keyProcedures pass through when present", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.diagnosticReports.length, 1);
  assert.equal(ctx.diagnosticReports[0].text, "CBC panel");
  assert.equal(ctx.diagnosticReports[0].conclusion, "Anemia, normocytic");
  assert.equal(ctx.keyProcedures.length, 1);
  assert.equal(ctx.keyProcedures[0].text, "Central venous catheter insertion");
});

test("summary is deterministic counts-only (no free-text clinical judgement)", () => {
  const ctx = assembleClinicalContext(richBundle());
  assert.equal(ctx.summary, "62F. 4 active problems, 2 current meds, 2 allergies, 2 abnormal labs.");
  // strict shape: prefix + counts only, no clinical nouns
  assert.match(ctx.summary, /^(\d+[FMOU]|[A-Z][a-z]+|Patient)\. \d+ active problems, \d+ current meds, \d+ allergies, \d+ abnormal labs\.$/);
});

test("caps: labs and encounters are bounded (defaults + opts overrides)", () => {
  const b = bundle({ patient: patient({ id: "P" }), generatedAt: "2026-08-01T00:00:00.000Z" });
  for (let i = 0; i < 30; i++) {
    b.observations.push(observation({ id: "lab" + i, category: "laboratory", code: cc("Lab" + i), value: quantity({ value: 100 }), referenceRange: { low: quantity({ value: 1 }), high: quantity({ value: 10 }) }, effectiveDateTime: "2026-07-" + String((i % 28) + 1).padStart(2, "0") }));
    b.encounters.push(encounter({ id: "enc" + i, class: "AMB", period: { start: "2026-07-" + String((i % 28) + 1).padStart(2, "0") } }));
  }
  const def = assembleClinicalContext(b);
  assert.equal(def.recentAbnormalLabs.length, 20); // default maxLabs
  assert.equal(def.recentEncounters.length, 10); // default maxEncounters
  const capped = assembleClinicalContext(b, { maxLabs: 5, maxEncounters: 3 });
  assert.equal(capped.recentAbnormalLabs.length, 5);
  assert.equal(capped.recentEncounters.length, 3);
});

test("empty / partial / missing bundle never throws and returns a safe empty result", () => {
  for (const input of [undefined, null, {}, { patient: null }, { conditions: "not-an-array" }]) {
    const ctx = assembleClinicalContext(input);
    assert.equal(ctx.activeProblems.length, 0);
    assert.equal(ctx.currentMedications.length, 0);
    assert.equal(ctx.allergies.length, 0);
    assert.equal(ctx.recentAbnormalLabs.length, 0);
    assert.equal(ctx.recentEncounters.length, 0);
    assert.equal(ctx.keyProcedures.length, 0);
    assert.equal(ctx.diagnosticReports.length, 0);
    assert.equal(ctx.summary, "Patient. 0 active problems, 0 current meds, 0 allergies, 0 abnormal labs.");
  }
  const partial = assembleClinicalContext({ patient: patient({ id: "x", gender: "male" }) });
  assert.equal(partial.patient.id, "x");
  assert.equal(partial.patient.sex, "male");
  assert.equal(partial.patient.age, null); // no birthDate -> no invented age
  assert.equal(partial.summary, "Male. 0 active problems, 0 current meds, 0 allergies, 0 abnormal labs.");
});

test("NO-FABRICATION: every clinical value in the output appears verbatim in the source bundle", () => {
  const src = richBundle();
  const srcJson = JSON.stringify(src);
  const ctx = assembleClinicalContext(src);
  const claimed = [];
  for (const p of ctx.activeProblems) claimed.push(p.text, p.code, p.system);
  for (const m of ctx.currentMedications) claimed.push(m.drug, m.code, m.dose, m.route);
  for (const a of ctx.allergies) claimed.push(a.substance, a.code, a.criticality);
  for (const l of ctx.recentAbnormalLabs) claimed.push(l.text, l.code, String(l.value), l.unit, l.effective);
  for (const e of ctx.recentEncounters) claimed.push(e.type, e.reason);
  for (const d of ctx.diagnosticReports) claimed.push(d.text, d.code, d.conclusion);
  for (const k of ctx.keyProcedures) claimed.push(k.text, k.code);
  for (const v of claimed) {
    if (v == null) continue;
    assert.ok(srcJson.includes(String(v)), "output value not present in source (fabrication): " + v);
  }
});

test("NO-FABRICATION: a minimal bundle yields no clinical text and no invented diagnosis/dose", () => {
  const ctx = assembleClinicalContext({ patient: patient({ id: "P", gender: "female", birthDate: "1990-01-01" }), meta: { generatedAt: "2026-08-01T00:00:00.000Z" } });
  assert.equal(ctx.activeProblems.length, 0);
  assert.equal(ctx.currentMedications.length, 0);
  assert.equal(ctx.recentAbnormalLabs.length, 0);
  // summary carries only counts + demographics, never a fabricated finding
  assert.equal(/diabet|sepsis|mg|dose|likely|recommend/i.test(ctx.summary), false);
});
