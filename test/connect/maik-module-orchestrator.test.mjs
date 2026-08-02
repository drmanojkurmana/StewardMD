// test/connect/maik-module-orchestrator.test.mjs — Part 4: Intelligent Module Orchestrator.
//
// suggestRelevantModules() consumes the ASSEMBLED clinical context (clinical-context.js output) + the derived
// alerts (clinical-alerts.js output) and SUGGESTS which StewardMD modules the clinician may find relevant. It
// must NEVER auto-launch, diagnose, or act: every suggestion is "you may find X useful because <evidence>".
// These tests pin the signal->module rules, priority/ordering/dedupe, bounded/pure/deterministic behavior, and
// the non-negotiable safety guards (suggest-not-launch, no fabrication, no directive/decisive language).
import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestRelevantModules } from "../../functions/_connect/maik/module-orchestrator.js";

const MODULE_IDS = new Set(["drug-database", "prescription-builder", "clinical-calculators", "kardiox",
  "thorx", "fundx", "scribe", "protocol-library", "guideline-engine", "research-mode"]);
const PRIORITIES = new Set(["high", "medium", "low"]);
const IMAGING = ["kardiox", "thorx", "fundx"];

// The orchestrator consumes the assembled context directly (same pattern as the alerts test): fixtures are
// plain context objects (synthetic, no PHI). ctx() fills the full assembler shape with empty defaults.
function ctx(p = {}) {
  return {
    patient: p.patient || null,
    activeProblems: p.activeProblems || [],
    currentMedications: p.currentMedications || [],
    allergies: p.allergies || [],
    recentAbnormalLabs: p.recentAbnormalLabs || [],
    recentEncounters: p.recentEncounters || [],
    keyProcedures: p.keyProcedures || [],
    diagnosticReports: p.diagnosticReports || [],
    summary: p.summary || "",
  };
}
const idsOf = (out) => out.suggestions.map((s) => s.moduleId);
const byId = (out) => Object.fromEntries(out.suggestions.map((s) => [s.moduleId, s]));
const has = (out, id) => out.suggestions.some((s) => s.moduleId === id);

// suggest-not-launch + no-decision: no reason may carry an imperative/dosing verb, a launch/act verb, or a
// definitive decision word; every reason must be framed as a "may be relevant/useful" suggestion.
const DIRECTIVE_VERBS = ["stop", "start", "increase", "decrease", "prescribe", "discontinue", "hold",
  "administer", "reduce", "raise", "initiate", "titrate", "switch", "give", "launch", "open", "auto-launch"];
function assertSuggestNotLaunch(s) {
  const lc = String(s.reason).toLowerCase();
  for (const v of DIRECTIVE_VERBS) {
    assert.equal(new RegExp("\\b" + v + "\\b", "i").test(lc), false, "directive/launch verb '" + v + "' in reason: " + s.reason);
  }
  assert.equal(/\bdiagnos|\bmust\b|\bcontraindicated\b/i.test(lc), false, "decisive language in reason: " + s.reason);
  assert.match(s.reason, /\bmay be\b/i, "suggestion not framed as 'may be ...': " + s.reason);
}

// Collect every leaf string in an evidence structure, ignoring the constant `from` tag.
function leaves(x, out = []) {
  if (x == null) return out;
  if (Array.isArray(x)) { for (const v of x) leaves(v, out); return out; }
  if (typeof x === "object") { for (const [k, v] of Object.entries(x)) { if (k === "from") continue; leaves(v, out); } return out; }
  out.push(String(x));
  return out;
}

// ---- signal -> module rules --------------------------------------------------------------------------------

test("cardiac active problem => kardiox suggested, with the problem as evidence", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21", system: "http://hl7.org/fhir/sid/icd-10" }],
  }));
  const k = byId(out)["kardiox"];
  assert.ok(k, "kardiox not suggested for a cardiac problem");
  assert.equal(k.label, "ECG / KardioQ X");
  assert.equal(k.priority, "medium");
  assert.match(k.reason, /Acute myocardial infarction/);
  assert.ok(leaves(k.evidence).includes("Acute myocardial infarction"), "problem not carried as evidence");
});

test("respiratory + diabetes problems => thorx + fundx (imaging mapped by signal, not guessed)", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [
      { text: "Community-acquired pneumonia", code: "J18.9", system: "http://hl7.org/fhir/sid/icd-10" },
      { text: "Type 2 diabetes mellitus", code: "E11", system: "http://hl7.org/fhir/sid/icd-10" },
    ],
  }));
  assert.ok(has(out, "thorx"), "thorx not suggested for pneumonia");
  assert.ok(has(out, "fundx"), "fundx not suggested for diabetes");
  assert.match(byId(out)["thorx"].reason, /pneumonia/i);
  assert.match(byId(out)["fundx"].reason, /diabetes/i);
});

test("current medications => drug-database + prescription-builder (medium when no safety alert)", () => {
  const out = suggestRelevantModules(ctx({
    currentMedications: [{ drug: "Metformin 500mg", code: "860975" }, { drug: "Lisinopril", code: "29046" }],
  }));
  const m = byId(out);
  assert.ok(m["drug-database"], "drug-database not suggested for current meds");
  assert.ok(m["prescription-builder"], "prescription-builder not suggested for current meds");
  assert.equal(m["drug-database"].label, "Drug interactions & monograph");
  assert.equal(m["drug-database"].priority, "medium"); // no alert -> base priority
  assert.equal(m["prescription-builder"].priority, "medium");
});

test("an allergy-conflict alert raises drug-database to HIGH priority", () => {
  const alerts = [{ kind: "allergy-conflict", severity: "critical", message: "Possible allergy conflict ... review.", evidence: {}, refs: [] }];
  const out = suggestRelevantModules(ctx({ currentMedications: [{ drug: "Penicillin V", code: "7982" }] }), alerts);
  const dd = byId(out)["drug-database"];
  assert.ok(dd);
  assert.equal(dd.priority, "high");
  assert.match(dd.reason, /allergy-conflict/);
});

test("a duplicate-therapy alert also raises drug-database to HIGH priority", () => {
  const alerts = [{ kind: "duplicate-therapy", severity: "warning", message: "Possible duplicate therapy ... review.", evidence: {}, refs: [] }];
  const out = suggestRelevantModules(ctx({ currentMedications: [{ drug: "Metformin", code: "860975" }] }), alerts);
  assert.equal(byId(out)["drug-database"].priority, "high");
});

test("abnormal renal labs => clinical-calculators naming the renal-dosing calculator", () => {
  const out = suggestRelevantModules(ctx({
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.8, unit: "mg/dL", flag: "H", effective: "2026-07-31" }],
  }));
  const cc = byId(out)["clinical-calculators"];
  assert.ok(cc, "clinical-calculators not suggested for an abnormal lab");
  assert.match(cc.reason, /renal-dosing calculator/i);
  assert.match(cc.reason, /Creatinine/);
  assert.ok(leaves(cc.evidence).includes("Creatinine"));
});

test("a non-renal abnormal lab => clinical-calculators WITHOUT over-claiming a specific calculator", () => {
  const out = suggestRelevantModules(ctx({
    recentAbnormalLabs: [{ code: "4548-4", text: "HbA1c", value: 9.1, unit: "%", flag: "H", effective: "2026-07-29" }],
  }));
  const cc = byId(out)["clinical-calculators"];
  assert.ok(cc);
  assert.equal(/renal-dosing/i.test(cc.reason), false, "over-claimed a renal calculator for a non-renal lab");
});

test("a critical renal lab flag => clinical-calculators HIGH priority", () => {
  const out = suggestRelevantModules(ctx({
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 9.9, unit: "mg/dL", flag: "HH", effective: "2026-07-31" }],
  }));
  assert.equal(byId(out)["clinical-calculators"].priority, "high");
});

test("active problems => protocol-library + guideline-engine", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Sepsis", code: "91302008", system: "http://snomed.info/sct" }],
  }));
  assert.ok(has(out, "protocol-library"));
  assert.ok(has(out, "guideline-engine"));
});

test("a recent encounter => scribe (documentation aid), low priority", () => {
  const out = suggestRelevantModules(ctx({ recentEncounters: [{ type: "IMP", date: "2026-07-30", reason: "sepsis admission" }] }));
  const sc = byId(out)["scribe"];
  assert.ok(sc, "scribe not suggested when a recent encounter is present");
  assert.equal(sc.priority, "low");
});

// ---- research-mode is ONLY a thin-context fallback ---------------------------------------------------------

test("thin context => research-mode fallback plus a few general modules (no imaging guessed)", () => {
  const out = suggestRelevantModules(ctx({
    patient: { id: "PSEUDO-9", sex: "male", age: 40 },
    activeProblems: [{ text: "Chronic fatigue syndrome", code: null, system: null }],
  }));
  assert.ok(has(out, "research-mode"), "research-mode not offered as a fallback on a thin context");
  assert.equal(byId(out)["research-mode"].priority, "low");
  // only a few general modules, and NEVER a guessed imaging module
  assert.deepEqual(idsOf(out), ["guideline-engine", "protocol-library", "research-mode"]);
  for (const id of IMAGING) assert.equal(has(out, id), false);
});

test("a rich context does NOT get research-mode (fallback only fires when thin)", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21" }],
    currentMedications: [{ drug: "Aspirin", code: "1191" }, { drug: "Atorvastatin", code: "83367" }],
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.1, unit: "mg/dL", flag: "H", effective: "2026-07-31" }],
  }));
  assert.equal(has(out, "research-mode"), false, "research-mode should not fire on a rich context");
});

// ---- no false suggestions ----------------------------------------------------------------------------------

test("an unrelated context does NOT suggest kardiox/thorx/fundx", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [
      { text: "Sepsis", code: "91302008", system: "http://snomed.info/sct" },
      { text: "Urinary tract infection", code: "68566005", system: "http://snomed.info/sct" },
    ],
    currentMedications: [{ drug: "Piperacillin-tazobactam", code: "1659149" }],
  }));
  for (const id of IMAGING) assert.equal(has(out, id), false, id + " falsely suggested for an unrelated context");
  // general modules still fire (problems + meds)
  assert.ok(has(out, "protocol-library"));
  assert.ok(has(out, "drug-database"));
});

// ---- dedupe / ordering / bounded / determinism -------------------------------------------------------------

test("dedupe: a module suggested by multiple signals appears once with merged evidence + top priority", () => {
  const alerts = [{ kind: "allergy-conflict", severity: "critical", message: "... review.", evidence: {}, refs: [] }];
  const out = suggestRelevantModules(ctx({ currentMedications: [{ drug: "Warfarin", code: "11289" }] }), alerts);
  const dd = out.suggestions.filter((s) => s.moduleId === "drug-database");
  assert.equal(dd.length, 1, "drug-database appeared more than once");
  assert.equal(dd[0].priority, "high");
  const ev = leaves(dd[0].evidence);
  assert.ok(ev.includes("Warfarin"), "med evidence not merged");
  assert.ok(ev.includes("allergy-conflict"), "alert evidence not merged");
});

test("ordering is deterministic: priority desc, then moduleId asc, stable across calls", () => {
  const c = ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21" }],
    currentMedications: [{ drug: "Warfarin", code: "11289" }],
  });
  const alerts = [{ kind: "allergy-conflict", severity: "critical", message: "... review.", evidence: {}, refs: [] }];
  const a1 = suggestRelevantModules(c, alerts);
  const a2 = suggestRelevantModules(c, alerts);
  assert.deepEqual(a1, a2); // pure + deterministic
  const rank = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < a1.suggestions.length; i++) {
    const p = a1.suggestions[i - 1], q = a1.suggestions[i];
    assert.ok(rank[p.priority] < rank[q.priority] || (rank[p.priority] === rank[q.priority] && p.moduleId <= q.moduleId),
      "not sorted by priority desc then moduleId asc");
  }
  assert.equal(a1.suggestions[0].moduleId, "drug-database"); // the only HIGH-priority module leads
});

test("counts summarize suggestions by priority; bounded by opts.maxSuggestions", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21" }],
    currentMedications: [{ drug: "Aspirin", code: "1191" }],
  }));
  const total = Object.values(out.counts).reduce((a, b) => a + b, 0);
  assert.equal(total, out.suggestions.length);
  for (const k of Object.keys(out.counts)) assert.ok(PRIORITIES.has(k), "unexpected priority bucket: " + k);

  const capped = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21" }],
    currentMedications: [{ drug: "Aspirin", code: "1191" }],
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.1, flag: "H" }],
  }), [], { maxSuggestions: 2 });
  assert.equal(capped.suggestions.length, 2);
});

test("every suggestion is well-formed (known moduleId, non-empty label, valid priority)", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Community-acquired pneumonia", code: "J18.9" }],
    currentMedications: [{ drug: "Azithromycin", code: "18631" }],
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.1, flag: "H" }],
    recentEncounters: [{ type: "AMB", date: "2026-07-30" }],
  }));
  assert.ok(out.suggestions.length > 0);
  for (const s of out.suggestions) {
    assert.ok(MODULE_IDS.has(s.moduleId), "unknown moduleId: " + s.moduleId);
    assert.equal(typeof s.label, "string");
    assert.ok(s.label.length > 0);
    assert.ok(PRIORITIES.has(s.priority), "invalid priority: " + s.priority);
    assert.ok(Array.isArray(s.evidence));
  }
});

// ---- robustness --------------------------------------------------------------------------------------------

test("empty / partial / hostile context never throws and returns the safe empty shape", () => {
  for (const input of [undefined, null, {}, { activeProblems: "nope" }, { currentMedications: null }, ctx()]) {
    const out = suggestRelevantModules(input);
    assert.deepEqual(out.suggestions, []);
    assert.deepEqual(out.counts, {});
  }
  // a malformed alerts argument must also be tolerated
  const ok = suggestRelevantModules(ctx({ currentMedications: [{ drug: "Aspirin", code: "1191" }] }), "not-an-array");
  assert.ok(has(ok, "drug-database"));
});

// ---- SAFETY GUARDS (non-negotiable) ------------------------------------------------------------------------

test("SUGGEST-NOT-LAUNCH: every reason is a 'may be relevant' suggestion, never a directive/launch/decision", () => {
  const out = suggestRelevantModules(ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21" }, { text: "Community-acquired pneumonia", code: "J18.9" }, { text: "Type 2 diabetes mellitus", code: "E11" }],
    currentMedications: [{ drug: "Warfarin", code: "11289" }],
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.8, flag: "H" }],
    recentEncounters: [{ type: "IMP", date: "2026-07-30" }],
  }), [{ kind: "allergy-conflict", severity: "critical", message: "... review.", evidence: {}, refs: [] }]);
  assert.ok(out.suggestions.length >= 5);
  for (const s of out.suggestions) assertSuggestNotLaunch(s);
});

test("NO-FABRICATION: every evidence value traces to the source context or alerts", () => {
  const c = ctx({
    activeProblems: [{ text: "Acute myocardial infarction", code: "I21", system: "http://hl7.org/fhir/sid/icd-10" }],
    currentMedications: [{ drug: "Aspirin", code: "1191" }, { drug: "Aspirin", code: "1191" }],
    recentAbnormalLabs: [{ code: "2160-0", text: "Creatinine", value: 2.8, unit: "mg/dL", flag: "H", effective: "2026-07-31" }],
    recentEncounters: [{ type: "IMP", date: "2026-07-30", reason: "chest pain" }],
  });
  const alerts = [{ kind: "duplicate-therapy", severity: "warning", message: "... review.", evidence: {}, refs: ["1191"] }];
  const out = suggestRelevantModules(c, alerts);
  assert.ok(out.suggestions.length > 0);
  const src = JSON.stringify({ c, alerts });
  for (const s of out.suggestions) {
    for (const v of leaves(s.evidence)) {
      if (v === "") continue;
      assert.ok(src.includes(v), "evidence value not present in source (fabrication): '" + v + "' [" + s.moduleId + "]");
    }
    // the named clinical specifics in a reason must also come from the record
    if (s.moduleId === "kardiox") assert.ok(src.includes("Acute myocardial infarction"));
    if (s.moduleId === "clinical-calculators") assert.ok(src.includes("Creatinine"));
  }
});
