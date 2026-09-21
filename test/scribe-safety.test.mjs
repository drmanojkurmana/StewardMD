import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const S = require("../scribe-safety.js");

const ROWS = [
  { drug: "amox", generic: "Amoxicillin", matched: true },
  { drug: "brufen", generic: "Ibuprofen", matched: true }
];

// Stand-ins shaped exactly like the injected engines.
// SMD_RX._analyzeRegimenSafety -> { findings:[{sev, type, txt}], medications, counselingBullets }
const analyzeRegimen = (lines, allergies, age) => ({
  findings: /penicillin/i.test(allergies || "")
    ? [{ sev: "critical", type: "allergy", txt: "Documented Allergy - patient has reported reaction to “penicillin”; Amoxicillin is prescribed" }]
    : [],
  medications: lines.map((l) => ({ info: { generic: l.drug } })),
  counselingBullets: []
});
// INTERACTIONS.checkInteractions -> { critical, major, moderate, minor, monitor, duplicates, ... }
const checkInteractions = () => ({
  critical: [], major: [{ drugs: ["Ibuprofen", "Ramipril"], effect: "Reduced antihypertensive effect and AKI risk", action: "Monitor renal function" }],
  moderate: [], minor: [], monitor: [],
  duplicates: [{ drugs: ["Ibuprofen", "Diclofenac"] }], combinations: []
});
const ENGINES = { analyzeRegimen, checkInteractions };

test("findings from both engines, severity-ordered, drug attributed", () => {
  const r = S.check(ROWS, { allergies: "penicillin", age: "34" }, ENGINES);
  assert.deepEqual(r.findings.map((f) => f.severity), ["critical", "major", "moderate"]);
  assert.equal(r.findings[0].drug, "Amoxicillin");
  assert.ok(/Documented Allergy/.test(r.findings[0].message));
  assert.equal(r.findings[1].drug, "Ibuprofen");
  assert.ok(/Reduced antihypertensive effect/.test(r.findings[1].message));
  assert.ok(/^Duplicate therapy: Ibuprofen \+ Diclofenac$/.test(r.findings[2].message));
  r.findings.forEach((f) => {
    assert.deepEqual(Object.keys(f).sort(), ["drug", "message", "severity"]);
  });
});

test("ctx reaches the engines: allergies, age, and renal as the interaction context flag", () => {
  let seen = null, ctxSeen = null;
  S.check(ROWS, { allergies: "sulfa", age: "6 months", sex: "F", pregnancy: "no", renal: true }, {
    analyzeRegimen: (lines, a, age) => { seen = { lines, a, age }; return { findings: [] }; },
    checkInteractions: (meds, context) => { ctxSeen = { meds, context }; return {}; }
  });
  assert.equal(seen.a, "sulfa");
  assert.equal(seen.age, "6 months");
  assert.deepEqual(seen.lines, [
    { drug: "Amoxicillin", brand: "", advice: false },
    { drug: "Ibuprofen", brand: "", advice: false }
  ]);
  assert.deepEqual(ctxSeen.meds, [{ generic: "Amoxicillin" }, { generic: "Ibuprofen" }]);
  assert.equal(ctxSeen.context.renalImpairment, true);
  assert.equal(ctxSeen.context.sex, "F");
});

test("SAFETY: no findings is never worded as a clearance", () => {
  const r = S.check(ROWS, {}, { analyzeRegimen: () => ({ findings: [] }), checkInteractions: () => ({}) });
  assert.deepEqual(r.findings, []);
  assert.ok(/not a clearance/i.test(r.summary), r.summary);
  assert.ok(!/\bsafe\b/i.test(r.summary), "the summary must never call anything safe: " + r.summary);
});

test("SAFETY: a summary with findings is also never a clearance for the rest", () => {
  const r = S.check(ROWS, { allergies: "penicillin" }, ENGINES);
  assert.ok(/not a clearance/i.test(r.summary), r.summary);
  assert.ok(!/\bsafe\b/i.test(r.summary), r.summary);
});

test("SAFETY: both engines absent degrades to no findings and says nothing was reviewed", () => {
  const r = S.check(ROWS, { allergies: "penicillin" }, {});
  assert.deepEqual(r.findings, []);
  assert.ok(/could not run/i.test(r.summary), r.summary);
  assert.ok(!/not a clearance/i.test(r.summary), "a failed run must not be reported as a quiet pass");
  assert.deepEqual(S.check(ROWS, {}).findings, []);
  assert.deepEqual(S.check(ROWS).findings, []);
});

test("SAFETY: an engine that throws does not take the check down", () => {
  const boom = () => { throw new Error("engine failed"); };
  const r = S.check(ROWS, {}, { analyzeRegimen: boom, checkInteractions: boom });
  assert.deepEqual(r.findings, []);
  assert.ok(/could not run/i.test(r.summary), r.summary);

  // One engine down, the other still reports.
  const half = S.check(ROWS, { allergies: "penicillin" }, { analyzeRegimen, checkInteractions: boom });
  assert.equal(half.findings.length, 1);
  assert.equal(half.findings[0].severity, "critical");
});

test("a single medicine: interaction checking is skipped, regimen safety still runs", () => {
  let called = false;
  const r = S.check([ROWS[0]], { allergies: "penicillin" }, {
    analyzeRegimen, checkInteractions: () => { called = true; return {}; }
  });
  assert.equal(called, false);
  assert.equal(r.findings.length, 1);
});

test("duplicate messages from the two engines are collapsed", () => {
  const same = { sev: "major", type: "ddi", txt: "Ibuprofen + Ramipril: Reduced antihypertensive effect and AKI risk - Monitor renal function" };
  const r = S.check(ROWS, {}, {
    analyzeRegimen: () => ({ findings: [same] }),
    checkInteractions: () => ({ major: [{ drugs: ["Ibuprofen", "Ramipril"], effect: "Reduced antihypertensive effect and AKI risk", action: "Monitor renal function" }] })
  });
  assert.equal(r.findings.length, 1);
});

test("empty and junk input", () => {
  assert.deepEqual(S.check([], {}, ENGINES), { findings: [], summary: "No medicines to review." });
  assert.deepEqual(S.check(null, {}, ENGINES), { findings: [], summary: "No medicines to review." });
  assert.deepEqual(S.check(), { findings: [], summary: "No medicines to review." });
  // advice rows and nameless rows are not medicines
  assert.deepEqual(S.check([{ drug: "Lifestyle measures", isAdvice: true }, { drug: "" }], {}, ENGINES).findings, []);
});
