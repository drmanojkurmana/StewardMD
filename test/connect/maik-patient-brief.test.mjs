// test/connect/maik-patient-brief.test.mjs — Part 4 CAPSTONE: Unified Clinical Context Engine (MaiK patient brief).
//
// buildMaikPatientBrief() is a THIN, PURE composition layer: it calls the four Part-4 modules in order
// (assembleClinicalContext -> deriveClinicalAlerts -> suggestRelevantModules -> buildClinicalTimeline) and
// emits the single "patient brief" MaiK receives when a doctor opens a patient. It ASSEMBLES + SUMMARIZES what
// those modules produced; it must add NO clinical decision, NO directive, and NO fabricated content of its own.
// These tests pin: the four sub-results are threaded correctly, brief counts match the sub-results, opts thread
// through, a malformed/empty bundle is safe (never throws), and the composition preserves the sub-module safety
// guards (no directive/decision verb, and every brief STRING traces to a sub-module output).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMaikPatientBrief } from "../../functions/_connect/maik/patient-brief.js";
import { assembleClinicalContext } from "../../functions/_connect/maik/clinical-context.js";
import { deriveClinicalAlerts } from "../../functions/_connect/maik/clinical-alerts.js";
import { suggestRelevantModules } from "../../functions/_connect/maik/module-orchestrator.js";
import { buildClinicalTimeline } from "../../functions/_connect/maik/clinical-timeline.js";
import { bundle, patient, encounter, condition, medicationStatement, allergyIntolerance, observation, diagnosticReport } from "../../functions/_connect/canonical/model.js";
import { codeable, coding, quantity } from "../../functions/_connect/canonical/coding.js";
import { validateBundle } from "../../functions/_connect/canonical/validate.js";

function cc(text, system, code) { return codeable({ text, coding: code ? [coding({ system, code })] : [] }); }

// A rich synthetic SCCM bundle engineered to exercise every sub-module: multiple imaging-mapped problems
// (cardiac/respiratory/diabetes), an allergy-conflict + duplicate-therapy + polypharmacy (>=5 meds), abnormal
// labs (incl. a critical renal result), a diagnostic report, encounters and a procedure for the timeline.
function richBundle() {
  const b = bundle({
    tenantId: "t1", sourceConnector: "fhir-r4", generatedAt: "2026-08-01T00:00:00.000Z",
    patient: patient({ id: "PSEUDO-77", gender: "female", birthDate: "1964-02-01" }), // age 62 as of generatedAt
    conditions: [
      condition({ id: "c-sepsis", code: cc("Sepsis", "http://snomed.info/sct", "91302008"), clinicalStatus: "active", recordedDate: "2026-07-30" }),
      condition({ id: "c-mi", code: cc("Acute myocardial infarction", "http://hl7.org/fhir/sid/icd-10", "I21"), clinicalStatus: "active", recordedDate: "2026-07-28" }),
      condition({ id: "c-pna", code: cc("Community-acquired pneumonia", "http://hl7.org/fhir/sid/icd-10", "J18.9"), clinicalStatus: "active", recordedDate: "2026-07-29" }),
      condition({ id: "c-dm", code: cc("Type 2 diabetes mellitus", "http://hl7.org/fhir/sid/icd-10", "E11"), clinicalStatus: "active", recordedDate: "2020-01-01" }),
    ],
    medications: [
      medicationStatement({ id: "m-pcn", medication: cc("Penicillin V Potassium", "http://www.nlm.nih.gov/research/umls/rxnorm", "7982"), status: "active", dosage: { text: "500 mg QID" } }),
      medicationStatement({ id: "m-asa1", medication: cc("Aspirin 75mg", "http://www.nlm.nih.gov/research/umls/rxnorm", "1191"), status: "active" }),
      medicationStatement({ id: "m-asa2", medication: cc("Aspirin EC", "http://www.nlm.nih.gov/research/umls/rxnorm", "1191"), status: "active" }), // same code => duplicate-therapy
      medicationStatement({ id: "m-met", medication: cc("Metformin 500mg", "http://www.nlm.nih.gov/research/umls/rxnorm", "860975"), status: "active", dosage: { text: "500 mg BID" } }),
      medicationStatement({ id: "m-ins", medication: cc("Insulin glargine"), status: "active" }),
      medicationStatement({ id: "m-lis", medication: cc("Lisinopril"), status: "active" }),
    ],
    allergies: [
      allergyIntolerance({ id: "a-pcn", code: cc("Penicillin", "http://www.nlm.nih.gov/research/umls/rxnorm", "7980"), criticality: "high", reactions: [{ manifestation: { text: "anaphylaxis" } }] }),
    ],
    observations: [
      // critical renal result (v > hi*2) => renal clinical-calculators + critical abnormal-lab
      observation({ id: "o-cr", category: "laboratory", code: cc("Creatinine", "http://loinc.org", "2160-0"), value: quantity({ value: 3.5, unit: "mg/dL" }), referenceRange: { low: quantity({ value: 0.6 }), high: quantity({ value: 1.2 }) }, effectiveDateTime: "2026-07-31" }),
      observation({ id: "o-a1c", category: "laboratory", code: cc("HbA1c", "http://loinc.org", "4548-4"), value: quantity({ value: 9.1, unit: "%" }), interpretation: cc("high"), referenceRange: { low: quantity({ value: 4 }), high: quantity({ value: 5.6 }) }, effectiveDateTime: "2026-07-29" }),
      observation({ id: "o-hgb", category: "laboratory", code: cc("Hemoglobin", "http://loinc.org", "718-7"), value: quantity({ value: 7.2, unit: "g/dL" }), referenceRange: { low: quantity({ value: 12 }), high: quantity({ value: 16 }) }, effectiveDateTime: "2026-07-30" }),
    ],
    diagnosticReports: [
      diagnosticReport({ id: "d1", code: cc("CBC panel", "http://loinc.org", "58410-2"), status: "final", conclusion: "Anemia, normocytic", effectiveDateTime: "2026-07-31" }),
    ],
    encounters: [
      encounter({ id: "e-new", status: "in-progress", class: "IMP", period: { start: "2026-07-30" }, reason: "sepsis admission" }),
      encounter({ id: "e-old", status: "finished", class: "AMB", period: { start: "2019-05-01", end: "2019-05-01" }, reason: "routine follow-up" }),
    ],
  });
  b.procedures = [{ id: "pr1", code: cc("Central venous catheter insertion", "http://snomed.info/sct", "392230005"), performedDateTime: "2026-07-30" }];
  return b;
}

// Directive / decision vocabulary that would turn a "surface for review" brief into a decision (union of the
// alerts + orchestrator guard lists). None may appear anywhere in the brief the composition emits.
const DIRECTIVE_VERBS = ["stop", "start", "increase", "decrease", "prescribe", "discontinue", "hold",
  "administer", "reduce", "raise", "initiate", "titrate", "switch", "give", "launch", "open", "auto-launch"];

// Collect every string the brief EMITS (headline, top-alert messages, module ids, span dates), so guards can
// scan exactly what the composition surfaces.
function briefStrings(brief) {
  const out = [];
  if (brief.headline) out.push(String(brief.headline));
  for (const m of brief.topAlerts || []) out.push(String(m));
  for (const id of brief.suggestedModuleIds || []) out.push(String(id));
  if (brief.timelineSpan && brief.timelineSpan.earliest) out.push(String(brief.timelineSpan.earliest));
  if (brief.timelineSpan && brief.timelineSpan.latest) out.push(String(brief.timelineSpan.latest));
  return out;
}

// ---- shape + threading -------------------------------------------------------------------------------------

test("fixture is a valid SCCM bundle", () => {
  assert.equal(validateBundle(richBundle()).ok, true);
});

test("brief threads the four sub-modules verbatim (context/alerts/suggestedModules/timeline)", () => {
  const b = richBundle();
  const out = buildMaikPatientBrief(b);

  const expCtx = assembleClinicalContext(b);
  const expAlerts = deriveClinicalAlerts(expCtx).alerts;
  const expSuggest = suggestRelevantModules(expCtx, expAlerts).suggestions;
  const expTimeline = buildClinicalTimeline(b);

  assert.deepEqual(out.context, expCtx, "context must be the assembler output verbatim");
  assert.deepEqual(out.patient, expCtx.patient, "patient must be context.patient verbatim");
  assert.deepEqual(out.alerts, expAlerts, "alerts must be the derived alerts array verbatim");
  assert.deepEqual(out.suggestedModules, expSuggest, "suggestedModules must be the orchestrator suggestions verbatim");
  assert.deepEqual(out.timeline, expTimeline, "timeline must be the timeline engine output verbatim");
});

test("context is non-empty and carries the expected problems/meds/allergies/labs", () => {
  const out = buildMaikPatientBrief(richBundle());
  assert.equal(out.context.activeProblems.length, 4);
  assert.equal(out.context.currentMedications.length, 6);
  assert.equal(out.context.allergies.length, 1);
  assert.equal(out.context.recentAbnormalLabs.length, 3);
  assert.ok(out.context.summary && out.context.summary.length > 0);
});

test("alerts include the expected allergy-conflict + duplicate-therapy + polypharmacy + abnormal labs", () => {
  const out = buildMaikPatientBrief(richBundle());
  const kinds = new Set(out.alerts.map((a) => a.kind));
  assert.ok(kinds.has("allergy-conflict"), "expected an allergy-conflict alert");
  assert.ok(kinds.has("duplicate-therapy"), "expected a duplicate-therapy alert");
  assert.ok(kinds.has("polypharmacy"), "expected a polypharmacy alert (6 current meds)");
  assert.ok(kinds.has("abnormal-lab"), "expected abnormal-lab alerts");
  assert.ok(out.alerts.some((a) => a.severity === "critical"), "expected at least one critical alert");
});

test("suggestedModules include the imaging modules mapped by problem signal", () => {
  const out = buildMaikPatientBrief(richBundle());
  const ids = new Set(out.suggestedModules.map((s) => s.moduleId));
  assert.ok(ids.has("kardiox"), "cardiac problem => kardiox");
  assert.ok(ids.has("thorx"), "respiratory problem => thorx");
  assert.ok(ids.has("fundx"), "diabetes problem => fundx");
  assert.ok(ids.has("drug-database"), "current meds => drug-database");
  assert.ok(ids.has("clinical-calculators"), "renal labs => clinical-calculators");
});

test("timeline is built with dated events (encounters/conditions/labs/report/procedure/meds)", () => {
  const out = buildMaikPatientBrief(richBundle());
  assert.ok(out.timeline.events.length > 0, "expected dated timeline events");
  assert.ok(out.timeline.counts.total > 0, "expected a non-zero timeline total");
});

// ---- brief = deterministic counts + verbatim strings -------------------------------------------------------

test("brief counts match the sub-results exactly", () => {
  const b = richBundle();
  const out = buildMaikPatientBrief(b);
  const { brief } = out;

  assert.equal(brief.alertCount, out.alerts.length, "alertCount must equal alerts.length");
  assert.equal(brief.criticalAlertCount, out.alerts.filter((a) => a.severity === "critical").length);
  assert.equal(brief.problemCount, out.context.activeProblems.length);
  assert.equal(brief.medicationCount, out.context.currentMedications.length);
  assert.equal(brief.allergyCount, out.context.allergies.length);
  assert.equal(brief.abnormalLabCount, out.context.recentAbnormalLabs.length);
  assert.equal(brief.timelineEventCount, out.timeline.events.length);

  // headline is the assembler summary verbatim (counts-only string, no clinical judgement)
  assert.equal(brief.headline, out.context.summary);

  // topAlerts are the first N alert MESSAGES verbatim (default cap 5)
  assert.deepEqual(brief.topAlerts, out.alerts.slice(0, 5).map((a) => a.message));

  // suggestedModuleIds mirror the orchestrator suggestions, in order
  assert.deepEqual(brief.suggestedModuleIds, out.suggestedModules.map((s) => s.moduleId));

  // timelineSpan endpoints are the verbatim date strings of the newest + oldest dated events
  assert.equal(brief.timelineSpan.latest, out.timeline.events[0].date);
  assert.equal(brief.timelineSpan.earliest, out.timeline.events[out.timeline.events.length - 1].date);
});

test("determinism: identical bundles produce byte-identical briefs", () => {
  const a = JSON.stringify(buildMaikPatientBrief(richBundle()));
  const b = JSON.stringify(buildMaikPatientBrief(richBundle()));
  assert.equal(a, b);
});

// ---- opts thread through -----------------------------------------------------------------------------------

test("opts thread through: low maxTopAlerts caps topAlerts", () => {
  const out = buildMaikPatientBrief(richBundle(), { maxTopAlerts: 2 });
  assert.equal(out.brief.topAlerts.length, 2);
  assert.deepEqual(out.brief.topAlerts, out.alerts.slice(0, 2).map((a) => a.message));
});

test("opts thread through: low maxEvents caps the timeline (and the brief count follows it)", () => {
  const full = buildMaikPatientBrief(richBundle());
  const capped = buildMaikPatientBrief(richBundle(), { maxEvents: 2 });
  assert.ok(full.timeline.events.length > 2, "fixture should have >2 dated events to make the cap meaningful");
  assert.ok(capped.timeline.events.length <= 2, "maxEvents must cap the timeline");
  assert.equal(capped.brief.timelineEventCount, capped.timeline.events.length);
});

test("opts thread through: maxSuggestions caps suggestedModuleIds", () => {
  const out = buildMaikPatientBrief(richBundle(), { maxSuggestions: 3 });
  assert.ok(out.suggestedModules.length <= 3);
  assert.equal(out.brief.suggestedModuleIds.length, out.suggestedModules.length);
});

test("opts thread through: context caps (maxLabs) flow into the brief count", () => {
  const out = buildMaikPatientBrief(richBundle(), { maxLabs: 1 });
  assert.equal(out.context.recentAbnormalLabs.length, 1);
  assert.equal(out.brief.abnormalLabCount, 1);
});

// ---- safety: empty / partial / malformed never throws ------------------------------------------------------

test("empty / partial / malformed bundle => safe brief, never throws, zero counts", () => {
  for (const input of [undefined, null, {}, { patient: null }, { conditions: "not-an-array" }, 42, "x", []]) {
    const out = buildMaikPatientBrief(input);
    assert.ok(out && typeof out === "object");
    assert.deepEqual(out.alerts, []);
    assert.deepEqual(out.suggestedModules, []);
    assert.deepEqual(out.timeline.events, []);
    assert.equal(out.brief.alertCount, 0);
    assert.equal(out.brief.criticalAlertCount, 0);
    assert.equal(out.brief.problemCount, 0);
    assert.equal(out.brief.medicationCount, 0);
    assert.equal(out.brief.timelineEventCount, 0);
    assert.deepEqual(out.brief.topAlerts, []);
    assert.deepEqual(out.brief.suggestedModuleIds, []);
    // an empty timeline has no dated events, so the span carries no endpoints (never an invented date)
    assert.equal(out.brief.timelineSpan.earliest, undefined);
    assert.equal(out.brief.timelineSpan.latest, undefined);
  }
});

// ---- safety: composition preserves the sub-module guards ---------------------------------------------------

test("SAFETY: the brief carries NO directive / decision verb (composition adds no decision)", () => {
  const out = buildMaikPatientBrief(richBundle());
  for (const s of briefStrings(out.brief)) {
    const lc = s.toLowerCase();
    for (const v of DIRECTIVE_VERBS) {
      assert.equal(new RegExp("\\b" + v + "\\b", "i").test(lc), false, "directive verb '" + v + "' in brief string: " + s);
    }
    assert.equal(/\bdiagnos|\bmust\b|\bcontraindicated\b|\brecommend/i.test(lc), false, "decisive/recommending language in brief string: " + s);
  }
});

test("NO-FABRICATION: every string in the brief traces verbatim to a sub-module output", () => {
  const out = buildMaikPatientBrief(richBundle());
  // Corpus = everything the four sub-modules produced. The composition may only re-surface these strings.
  const corpus = JSON.stringify({ context: out.context, alerts: out.alerts, suggestedModules: out.suggestedModules, timeline: out.timeline });
  for (const s of briefStrings(out.brief)) {
    assert.ok(corpus.includes(s), "brief introduced a string absent from every sub-module output (fabrication): " + s);
  }
});

test("brief is a pure summary object: only counts, ids, and verbatim strings (no nested clinical prose it authored)", () => {
  const out = buildMaikPatientBrief(richBundle());
  const brief = out.brief;
  // counts are numbers
  for (const k of ["alertCount", "criticalAlertCount", "problemCount", "medicationCount", "allergyCount", "abnormalLabCount", "timelineEventCount"]) {
    assert.equal(typeof brief[k], "number", k + " must be a number");
  }
  // headline is the assembler's counts-only summary: no fabricated clinical finding
  assert.equal(/\brecommend|\blikely\b|\bconsistent with\b/i.test(brief.headline), false);
});
