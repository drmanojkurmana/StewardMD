// test/opd-maik.test.mjs — Ask MaiK (OPD, on-device Dx/Mx/Rx) pure logic.
// Exercises the PURE builders (no DOM, no network): findings text from the entered
// assessment, a disease-treatment JSON -> Rx lines, and differential+treatments -> panel model.
// node --test test/opd-maik.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OPD = require(join(HERE, "..", "opd-emr.js"));

// Browser-IIFE load with stubbed globals so we can exercise the PURE _render (button + panel).
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function loadRender(extraWin) {
  const win = Object.assign({ DX: {} }, extraWin || {});   // DX present -> Ask MaiK button eligible
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  const loc = { search: "" };
  const ls = { getItem: () => null, setItem: () => {} };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, loc, ls);
  return win.OPDEMR;
}

test("assessFindingsText: joins narrative + positive comorbids, ignores blanks/N", () => {
  const t = OPD._assessFindingsText({
    Chief_complaints_duration: "Chest pain 2 hours",
    History_present_illness: "radiating to left arm",
    History_past_illness: "",
    Diabetes_yesNo: "Y",
    Hypertension_yesNo: "N",
    Cardiac_yesNo: "Y"
  });
  assert.match(t, /Chest pain 2 hours/);
  assert.match(t, /radiating to left arm/);
  assert.match(t, /diabetes/);
  assert.match(t, /cardiac/);
  assert.ok(!/hypertension/.test(t), "Hypertension_yesNo N must not appear");
  assert.equal(OPD._assessFindingsText({}), "", "no notes -> empty string");
});

test("treatmentLines: highest-precedence recommendation -> drug lines + steps", () => {
  const tj = {
    id: "acs",
    precedence: ["icmr", "guideline", "harrison"],
    recommendations: [
      { tier: "harrison", line: "management", regimenLabel: "old", drugRefs: [{ composition: "old drug", dose: "1", route: "PO", freq: "OD" }], steps: ["old step"] },
      { tier: "icmr", line: "management", regimenLabel: "MONA + reperfusion", steps: ["Aspirin loading", "Urgent PCI/thrombolysis", "s3", "s4", "s5"],
        drugRefs: [
          { composition: "aspirin", dose: "325 mg", route: "PO", freq: "stat then 75 mg OD" },
          { composition: "atorvastatin", dose: "80 mg", route: "PO", freq: "OD" }
        ] }
    ]
  };
  const r = OPD._treatmentLines(tj);
  assert.equal(r.regimen, "MONA + reperfusion", "picks icmr (highest precedence), not harrison");
  assert.deepEqual(r.rx, ["aspirin · 325 mg PO stat then 75 mg OD", "atorvastatin · 80 mg PO OD"]);
  assert.equal(r.steps.length, 4, "steps capped at 4");
  assert.equal(r.steps[0], "Aspirin loading");
  assert.deepEqual(OPD._treatmentLines(null), { rx: [], steps: [] });
  assert.deepEqual(OPD._treatmentLines({ recommendations: [] }), { rx: [], steps: [] });
});

test("buildMaikSuggestions: Dx (provisional+ddx), Mx (dedup inv), Rx (top-2 dx, dedup)", () => {
  const diff = [
    { id: "acs", dx: "Acute coronary syndrome", score: 88, inv: ["ECG", "Troponin"], reason: "Ischaemic features favour ACS.", red: ["STEMI needs reperfusion"] },
    { id: "aortic_dissection", dx: "Aortic dissection", score: 40, inv: ["CT aortogram", "ECG"], reason: "Tearing pain raises dissection.", red: ["BP differential"] },
    { id: "pe", dx: "Pulmonary embolism", score: 20, inv: ["D-dimer"], reason: "", red: ["STEMI needs reperfusion"] } // dup red flag
  ];
  const treatMap = {
    acs: { rx: ["aspirin · 325 mg PO stat", "atorvastatin · 80 mg PO OD"], steps: ["Urgent PCI"] },
    aortic_dissection: { rx: ["labetalol · IV titrate", "aspirin · 325 mg PO stat"], steps: [] } // aspirin dup across dx
  };
  const sg = OPD._buildMaikSuggestions(diff, treatMap);
  assert.equal(sg.provisionalDx, "Acute coronary syndrome");
  assert.equal(sg.provisionalWhy, "Ischaemic features favour ACS.", "provisional carries the engine's reasoning");
  assert.equal(sg.ddx.length, 2);
  assert.equal(sg.ddx[0].dx, "Aortic dissection", "ddx carries the clean dx name (for accepting without the score)");
  assert.equal(sg.ddx[0].label, "Aortic dissection", "label is the clean name (score rendered separately as a chip)");
  assert.equal(sg.ddx[0].score, 40, "score carried as its own field");
  assert.equal(sg.ddx[0].why, "Tearing pain raises dissection.");
  // red flags: union across leading dx, deduped
  assert.deepEqual(sg.redFlags, ["STEMI needs reperfusion", "BP differential"]);
  // investigations: union, deduped case-insensitively (ECG appears in two dx -> once)
  const invLabels = sg.investigations.map((x) => x.label);
  assert.deepEqual(invLabels, ["ECG", "Troponin", "CT aortogram", "D-dimer"]);
  // treatment: top-2 dx only, aspirin deduped, atorvastatin + labetalol + steps present
  const rxLabels = sg.treatment.map((x) => x.label);
  assert.ok(rxLabels.includes("aspirin · 325 mg PO stat"));
  assert.equal(rxLabels.filter((l) => l === "aspirin · 325 mg PO stat").length, 1, "aspirin not duplicated across dx");
  assert.ok(rxLabels.includes("atorvastatin · 80 mg PO OD"));
  assert.ok(rxLabels.includes("labetalol · IV titrate"));
  assert.ok(rxLabels.includes("Urgent PCI"), "non-drug management step included in Rx group");
});

test("cleanClinical: em-dash -> comma, en-dash range -> hyphen, arrow -> to; drug hyphen kept", () => {
  const diff = [{ id: "acs", dx: "ACS", score: 90, inv: ["BP 70–90 target"], reason: "Ischaemia — reperfusion", red: ["STEMI → reperfusion"] }];
  const treatMap = { acs: { rx: ["piperacillin-tazobactam · 4.5 g"], steps: ["EMERGENCY — call surgery"] } };
  const sg = OPD._buildMaikSuggestions(diff, treatMap);
  assert.equal(sg.provisionalWhy, "Ischaemia, reperfusion", "em-dash becomes a comma");
  assert.equal(sg.redFlags[0], "STEMI to reperfusion", "arrow becomes 'to'");
  assert.equal(sg.investigations[0].label, "BP 70-90 target", "en-dash range becomes a hyphen");
  assert.ok(sg.treatment.some((t) => t.label === "piperacillin-tazobactam · 4.5 g"), "drug-name hyphen preserved");
  assert.ok(sg.treatment.some((t) => t.label === "EMERGENCY, call surgery"), "step em-dash becomes a comma");
  assert.ok(!sg.treatment.some((t) => /—/.test(t.label)), "no em-dash reaches the accepted chart text");
});

test("rankDifferential: ranks by score so a higher non-infective dx isn't buried under infective", () => {
  // differentialFor returns infective (pneumonia) THEN non-infective (ACS), regardless of score.
  const raw = [
    { id: "hap", dx: "Hospital Acquired Pneumonia", score: 45, inv: [] },   // infective, listed first
    { id: "cap", dx: "Community Acquired Pneumonia", score: 45, inv: [] },
    { id: "acs", dx: "Acute coronary syndrome", score: 56, inv: [] }         // non-infective, higher score, listed last
  ];
  const ranked = OPD._rankDifferential(raw);
  assert.equal(ranked[0].dx, "Acute coronary syndrome", "highest score wins the provisional slot");
  assert.equal(ranked[0].score, 56);
  assert.equal(raw[0].dx, "Hospital Acquired Pneumonia", "input array not mutated");
  assert.deepEqual(OPD._rankDifferential([]), []);
});

test("buildMaikSuggestions: empty differential -> empty model", () => {
  const sg = OPD._buildMaikSuggestions([], {});
  assert.equal(sg.provisionalDx, "");
  assert.deepEqual(sg.ddx, []);
  assert.deepEqual(sg.investigations, []);
  assert.deepEqual(sg.treatment, []);
});

test("emrCorrections: Rx in the diagnosis field flagged as misplaced -> Management plan", () => {
  const c = OPD._emrCorrections({ provisional_diagnosis: "Community acquired pneumonia\nTab Azithromycin 500 mg OD x 3 days" });
  const mis = c.find((x) => x.type === "misplaced" && x.field === "provisional_diagnosis");
  assert.ok(mis, "detects prescription text in the diagnosis field");
  assert.equal(mis.targetField, "management_plan");
  assert.match(mis.from, /Azithromycin/);
  assert.ok(!/Community acquired pneumonia/.test(mis.from), "the actual diagnosis line is NOT flagged for moving");
});

test("emrCorrections: substance history in the complaint field flagged -> Personal history", () => {
  const c = OPD._emrCorrections({ Chief_complaints_duration: "Chest pain 2 hours\nConsumes alcohol daily for 10 years" });
  const mis = c.find((x) => x.type === "misplaced" && x.field === "Chief_complaints_duration");
  assert.ok(mis, "detects substance history in the complaint field");
  assert.equal(mis.targetField, "Habitat_addiction_others");
  assert.match(mis.from, /alcohol/);
});

test("emrCorrections: clear medical typo -> spelling fix; clean note -> no corrections", () => {
  const c = OPD._emrCorrections({ History_present_illness: "known diabetis with hypertention" });
  const sp = c.filter((x) => x.type === "spelling").map((x) => x.from + "->" + x.to);
  assert.ok(sp.includes("diabetis->diabetes"));
  assert.ok(sp.includes("hypertention->hypertension"));
  assert.deepEqual(OPD._emrCorrections({ Chief_complaints_duration: "fever and cough 3 days" }), [], "clean note yields no false corrections");
});

test("emrCorrections: NO false positives on CAP / lab values / a smoker who is the complaint", () => {
  // "CAP" (community-acquired pneumonia), "OD" (right eye), and lab "mg/dl" must NOT be read as a prescription
  assert.deepEqual(OPD._emrCorrections({ provisional_diagnosis: "s/o CAP, moderate severity; glucose 450 mg/dl; corneal ulcer OD" }).filter((x) => x.type === "misplaced"), [], "CAP / lab value / OD are not prescriptions");
  // a smoker/alcohol mentioned as the acute presenting complaint must NOT be moved out of the complaint
  assert.deepEqual(OPD._emrCorrections({ Chief_complaints_duration: "Cough and breathlessness in a chronic smoker x 1 week" }).filter((x) => x.type === "misplaced"), [], "substance-as-complaint is left in place");
  // but a genuine prescription line (form word + dose) IS flagged
  assert.ok(OPD._emrCorrections({ provisional_diagnosis: "Cap Amoxicillin 500 mg TDS" }).some((x) => x.type === "misplaced"), "a real prescription line is still caught");
});

test("_render: red-flags banner + EMR corrections + accept-all render", () => {
  const html = loadRender()._render({
    loading: false, tab: "assess", writeOn: true, patient: { name: "A B", mrn: "MR1" }, assessVals: {},
    scribeSuggestions: {
      provisionalDx: "Acute coronary syndrome", provisionalWhy: "Ischaemic features.",
      ddx: [{ label: "Aortic dissection (48)", dx: "Aortic dissection", source: "engine", why: "Tearing pain." }],
      investigations: [{ label: "ECG", source: "engine" }, { label: "Troponin", source: "engine" }],
      treatment: [{ label: "aspirin · 325 mg PO stat", source: "engine" }],
      redFlags: ["STEMI needs immediate reperfusion"],
      corrections: [{ type: "spelling", field: "History_present_illness", from: "diabetis", to: "diabetes" }],
      acceptedDx: false, acceptedDdx: {}, acceptedInv: {}, acceptedRx: {}, acceptedFix: {}, source: "maik"
    }
  });
  assert.match(html, /Must-not-miss red flags/);
  assert.match(html, /STEMI needs immediate reperfusion/);
  assert.match(html, /Ischaemic features\./, "provisional why shown");
  assert.match(html, /EMR corrections/);
  assert.match(html, /data-oe-act="scribe-accept:fix:0"/);
  assert.match(html, /data-oe-act="scribe-acceptall:inv"/, "accept-all offered for investigations (>1)");
  assert.match(html, /Decision support only/, "advisory disclaimer present");
});

test("_render: Ask MaiK is a glowing AI banner; Save label defaults to GHIS", () => {
  const html = loadRender()._render({ loading: false, tab: "assess", writeOn: true, patient: { name: "A B", mrn: "MR1" }, assessVals: {} });
  assert.match(html, /Ask MaiK/);
  assert.match(html, /data-oe-act="assess-maik"/);
  assert.match(html, /oe-maik-cta/, "renders the glowing CTA banner, not a plain save-bar button");
  assert.match(html, /oe-maik-glow/, "includes the animated glow element");
  assert.match(html, /Save to GHIS/, "GIMSR default label is GHIS");
});

test("_render: Save label is generic 'EMR' for a non-GHIS connected source", () => {
  // openProfile sets st.emrLabel from opts.source ('connect' -> 'EMR'); assessTab renders it from its state
  const html = loadRender()._render({ loading: false, tab: "assess", writeOn: true, patient: { name: "A B", mrn: "MR1" }, assessVals: {}, emrLabel: "EMR" });
  assert.match(html, /Save to EMR/, "non-GIMSR EMR shows a generic label");
  assert.ok(!/Save to GHIS/.test(html), "GHIS label not shown for a non-GHIS source");
});

test("_render: treatment group + per-row rx accept render, review-first", () => {
  const html = loadRender()._render({
    loading: false, tab: "assess", writeOn: true, patient: { name: "A B", mrn: "MR1" }, assessVals: {},
    scribeSuggestions: {
      provisionalDx: "Acute coronary syndrome",
      ddx: [{ label: "Aortic dissection (40)", source: "engine" }],
      investigations: [{ label: "ECG", source: "engine" }],
      treatment: [{ label: "aspirin · 325 mg PO stat", source: "engine" }],
      acceptedDx: false, acceptedDdx: {}, acceptedInv: {}, acceptedRx: {}
    }
  });
  assert.match(html, /Management \/ Treatment/);
  assert.match(html, /aspirin · 325 mg PO stat/);
  assert.match(html, /data-oe-act="scribe-accept:rx:0"/);
  assert.match(html, /Review/);                          // advisory: every row tagged Review before use
});
