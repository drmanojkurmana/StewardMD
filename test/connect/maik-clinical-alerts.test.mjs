// test/connect/maik-clinical-alerts.test.mjs — Part 4: Clinical Alert Framework (deterministic safety FLAGS).
//
// deriveClinicalAlerts() consumes the ASSEMBLED clinical context (clinical-context.js output shape) and SURFACES
// possible safety issues for the clinician to review. It must NEVER diagnose, recommend, or change/stop/start a
// med. These tests pin: the four v1 alert kinds + severities, the conservative matching (no spurious alerts),
// bounded/pure/deterministic behavior, and the two non-negotiable safety guards (no fabrication, no directive).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveClinicalAlerts } from "../../functions/_connect/maik/clinical-alerts.js";

// The alerts module consumes the assembled context directly, so fixtures are plain context objects (synthetic,
// no PHI). ctx() fills the full assembler shape with empty defaults so partial fixtures never trip the reader.
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

// Any imperative/dosing verb would turn a "flag for review" into a decision — forbidden in every message.
const DIRECTIVE_VERBS = ["stop", "start", "increase", "decrease", "prescribe", "discontinue", "hold",
  "administer", "reduce", "raise", "initiate", "titrate", "switch", "give"];
function assertNoDirective(message) {
  const lc = String(message).toLowerCase();
  for (const v of DIRECTIVE_VERBS) {
    assert.equal(new RegExp("\\b" + v + "\\b", "i").test(lc), false, "directive verb '" + v + "' in message: " + message);
  }
}

// ---- allergy-conflict --------------------------------------------------------------------------------------

test("allergy-conflict: current med matching a HIGH-criticality allergy => critical", () => {
  const c = ctx({
    currentMedications: [{ drug: "Penicillin V Potassium", code: "7982" }],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high", reaction: ["anaphylaxis"] }],
  });
  const { alerts, counts } = deriveClinicalAlerts(c);
  const conflict = alerts.filter((a) => a.kind === "allergy-conflict");
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].severity, "critical");
  assert.equal(counts["allergy-conflict"], 1);
  assert.equal(conflict[0].evidence.med.drug, "Penicillin V Potassium");
  assert.equal(conflict[0].evidence.allergy.substance, "Penicillin");
  assert.match(conflict[0].message, /review/i);
  assertNoDirective(conflict[0].message);
});

test("allergy-conflict: non-high criticality => warning (surface, not critical)", () => {
  const c = ctx({
    currentMedications: [{ drug: "Sulfamethoxazole", code: "x" }],
    allergies: [{ substance: "Sulfamethoxazole", code: "y", criticality: "low" }],
  });
  const conflict = deriveClinicalAlerts(c).alerts.filter((a) => a.kind === "allergy-conflict");
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].severity, "warning");
});

test("allergy-conflict: matches by CODE even when names differ", () => {
  const c = ctx({
    currentMedications: [{ drug: "Brand-X tablet", code: "7980" }],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high" }],
  });
  const conflict = deriveClinicalAlerts(c).alerts.filter((a) => a.kind === "allergy-conflict");
  assert.equal(conflict.length, 1);
  assert.equal(conflict[0].severity, "critical");
});

test("allergy-conflict: NO false alert when med and allergy are unrelated", () => {
  const c = ctx({
    currentMedications: [{ drug: "Metformin 500mg", code: "860975" }, { drug: "Lisinopril", code: "29046" }],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high" }],
  });
  const { alerts, counts } = deriveClinicalAlerts(c);
  assert.equal(alerts.some((a) => a.kind === "allergy-conflict"), false);
  assert.equal(counts["allergy-conflict"], undefined);
});

// ---- duplicate-therapy -------------------------------------------------------------------------------------

test("duplicate-therapy: two meds with the same normalized name => one alert listing both", () => {
  const c = ctx({
    currentMedications: [
      { drug: "Metformin", code: "860975" },
      { drug: "metformin", code: "" },
      { drug: "Aspirin", code: "1191" },
    ],
  });
  const dups = deriveClinicalAlerts(c).alerts.filter((a) => a.kind === "duplicate-therapy");
  assert.equal(dups.length, 1);
  assert.equal(dups[0].evidence.drugs.length, 2);
  assertNoDirective(dups[0].message);
  assert.match(dups[0].message, /review/i);
});

test("duplicate-therapy: two meds sharing a code => one alert", () => {
  const c = ctx({
    currentMedications: [
      { drug: "Glucophage", code: "860975" },
      { drug: "Metformin ER", code: "860975" },
    ],
  });
  const dups = deriveClinicalAlerts(c).alerts.filter((a) => a.kind === "duplicate-therapy");
  assert.equal(dups.length, 1);
  assert.equal(dups[0].evidence.drugs.length, 2);
});

test("duplicate-therapy: distinct meds => no alert", () => {
  const c = ctx({ currentMedications: [{ drug: "Metformin", code: "860975" }, { drug: "Aspirin", code: "1191" }] });
  assert.equal(deriveClinicalAlerts(c).alerts.some((a) => a.kind === "duplicate-therapy"), false);
});

// ---- abnormal-lab ------------------------------------------------------------------------------------------

test("abnormal-lab: one alert per abnormal lab, severity from flag/range", () => {
  const c = ctx({
    recentAbnormalLabs: [
      { code: "718-7", text: "Hemoglobin", value: 4.1, unit: "g/dL", flag: "LL", effective: "2026-07-31" }, // critical (LL)
      { code: "4548-4", text: "HbA1c", value: 9.1, unit: "%", flag: "H", effective: "2026-07-29" }, // warning (single H)
      { code: "2823-3", text: "Potassium", value: 7.5, unit: "mmol/L", flag: "H", low: 3.5, high: 5.1, effective: "2026-07-30" }, // far out of range => critical
    ],
  });
  const { alerts, counts } = deriveClinicalAlerts(c);
  const labs = alerts.filter((a) => a.kind === "abnormal-lab");
  assert.equal(labs.length, 3);
  assert.equal(counts["abnormal-lab"], 3);
  const byText = Object.fromEntries(labs.map((a) => [a.evidence.text, a]));
  assert.equal(byText["Hemoglobin"].severity, "critical"); // LL flag
  assert.equal(byText["HbA1c"].severity, "warning"); // plain H
  assert.equal(byText["Potassium"].severity, "critical"); // 7.5 >> range 3.5-5.1
  // message names the lab + value + flag
  assert.match(byText["Hemoglobin"].message, /Hemoglobin/);
  assert.match(byText["Hemoglobin"].message, /4\.1/);
  assert.match(byText["Hemoglobin"].message, /LL/);
  for (const a of labs) { assertNoDirective(a.message); assert.match(a.message, /review/i); }
});

// ---- polypharmacy ------------------------------------------------------------------------------------------

test("polypharmacy: >= threshold current meds => info alert with count; below threshold => none", () => {
  const meds = (n) => Array.from({ length: n }, (_, i) => ({ drug: "Drug" + i, code: "c" + i }));
  const five = deriveClinicalAlerts(ctx({ currentMedications: meds(5) }));
  const poly = five.alerts.filter((a) => a.kind === "polypharmacy");
  assert.equal(poly.length, 1);
  assert.equal(poly[0].severity, "info");
  assert.equal(poly[0].evidence.count, 5);
  assert.equal(five.counts["polypharmacy"], 1);
  assertNoDirective(poly[0].message);

  const four = deriveClinicalAlerts(ctx({ currentMedications: meds(4) }));
  assert.equal(four.alerts.some((a) => a.kind === "polypharmacy"), false);

  const custom = deriveClinicalAlerts(ctx({ currentMedications: meds(3) }), { polypharmacyThreshold: 3 });
  assert.equal(custom.alerts.some((a) => a.kind === "polypharmacy"), true);
});

// ---- robustness / determinism ------------------------------------------------------------------------------

test("empty / partial / missing context never throws and returns the safe empty shape", () => {
  for (const input of [undefined, null, {}, { currentMedications: "not-an-array" }, { allergies: null }]) {
    const out = deriveClinicalAlerts(input);
    assert.deepEqual(out.alerts, []);
    assert.deepEqual(out.counts, {});
  }
});

test("ordering is deterministic: severity desc, then kind, and stable across calls", () => {
  const c = ctx({
    currentMedications: [
      { drug: "Penicillin", code: "7980" }, { drug: "penicillin", code: "7980" }, // duplicate + allergy-conflict
      { drug: "A", code: "1" }, { drug: "B", code: "2" }, { drug: "C", code: "3" }, // -> polypharmacy (>=5)
    ],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high" }],
    recentAbnormalLabs: [{ code: "L", text: "Lactate", value: 8, unit: "mmol/L", flag: "HH", effective: "2026-07-31" }],
  });
  const a1 = deriveClinicalAlerts(c);
  const a2 = deriveClinicalAlerts(c);
  assert.deepEqual(a1, a2); // pure + deterministic
  const sevRank = { critical: 0, warning: 1, info: 2 };
  for (let i = 1; i < a1.alerts.length; i++) {
    assert.ok(sevRank[a1.alerts[i - 1].severity] <= sevRank[a1.alerts[i].severity], "not sorted by severity desc");
  }
  assert.equal(a1.alerts[0].severity, "critical"); // allergy-conflict + HH lactate lead
});

test("bounded: alerts are capped per kind (opts.maxPerKind)", () => {
  const labs = Array.from({ length: 120 }, (_, i) => ({ code: "c" + i, text: "Lab" + i, value: 99, unit: "u", flag: "H", effective: "2026-07-01" }));
  const out = deriveClinicalAlerts(ctx({ recentAbnormalLabs: labs }), { maxPerKind: 10 });
  assert.equal(out.alerts.filter((a) => a.kind === "abnormal-lab").length, 10);
  assert.equal(out.counts["abnormal-lab"], 10);
});

// ---- SAFETY GUARDS (non-negotiable) ------------------------------------------------------------------------

test("NO-FABRICATION: every clinical string in an alert appears verbatim in the source context", () => {
  const c = ctx({
    currentMedications: [{ drug: "Penicillin V Potassium", code: "7982" }, { drug: "Penicillin V Potassium", code: "7982" }, { drug: "Furosemide", code: "4603" }],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high", reaction: ["anaphylaxis"] }],
    recentAbnormalLabs: [{ code: "718-7", text: "Hemoglobin", value: 7.2, unit: "g/dL", flag: "L", effective: "2026-07-31" }],
  });
  const src = JSON.stringify(c);
  const { alerts } = deriveClinicalAlerts(c);
  assert.ok(alerts.length > 0);
  const claimed = [];
  for (const a of alerts) {
    if (a.kind === "allergy-conflict") claimed.push(a.evidence.med.drug, a.evidence.med.code, a.evidence.allergy.substance, a.evidence.allergy.code, a.evidence.allergy.criticality);
    if (a.kind === "duplicate-therapy") for (const d of a.evidence.drugs) claimed.push(d.drug, d.code);
    if (a.kind === "abnormal-lab") { const l = a.evidence; claimed.push(l.text, l.code, String(l.value), l.unit, l.flag); }
    for (const r of a.refs || []) claimed.push(r);
  }
  for (const v of claimed) {
    if (v == null || v === "") continue;
    assert.ok(src.includes(String(v)), "alert value not present in source (fabrication): " + v);
  }
});

test("NO-RECOMMENDATION: no alert message contains a directive verb; every alert is framed for review", () => {
  const c = ctx({
    currentMedications: [{ drug: "Penicillin", code: "7980" }, { drug: "Penicillin", code: "7980" }, { drug: "A", code: "1" }, { drug: "B", code: "2" }, { drug: "C", code: "3" }],
    allergies: [{ substance: "Penicillin", code: "7980", criticality: "high" }],
    recentAbnormalLabs: [{ code: "L", text: "Lactate", value: 9, unit: "mmol/L", flag: "HH", effective: "2026-07-31" }],
  });
  const { alerts } = deriveClinicalAlerts(c);
  assert.ok(alerts.length >= 4);
  for (const a of alerts) {
    assertNoDirective(a.message);
    assert.match(a.message, /review/i, "alert not framed as review: " + a.message);
    // never a definitive diagnosis / decision word
    assert.equal(/\bdiagnos|\bmust\b|\bcontraindicated\b/i.test(a.message), false, "decisive language: " + a.message);
  }
});
