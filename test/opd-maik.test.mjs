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
    { id: "acs", dx: "Acute coronary syndrome", score: 88, inv: ["ECG", "Troponin"] },
    { id: "aortic_dissection", dx: "Aortic dissection", score: 40, inv: ["CT aortogram", "ECG"] },
    { id: "pe", dx: "Pulmonary embolism", score: 20, inv: ["D-dimer"] }
  ];
  const treatMap = {
    acs: { rx: ["aspirin · 325 mg PO stat", "atorvastatin · 80 mg PO OD"], steps: ["Urgent PCI"] },
    aortic_dissection: { rx: ["labetalol · IV titrate", "aspirin · 325 mg PO stat"], steps: [] } // aspirin dup across dx
  };
  const sg = OPD._buildMaikSuggestions(diff, treatMap);
  assert.equal(sg.provisionalDx, "Acute coronary syndrome");
  assert.equal(sg.ddx.length, 2);
  assert.match(sg.ddx[0].label, /Aortic dissection \(40\)/);
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

test("buildMaikSuggestions: empty differential -> empty model", () => {
  const sg = OPD._buildMaikSuggestions([], {});
  assert.equal(sg.provisionalDx, "");
  assert.deepEqual(sg.ddx, []);
  assert.deepEqual(sg.investigations, []);
  assert.deepEqual(sg.treatment, []);
});

test("_render: Ask MaiK button shows on the assessment save bar (engine present, write on)", () => {
  const html = loadRender()._render({ loading: false, tab: "assess", writeOn: true, patient: { name: "A B", mrn: "MR1" }, assessVals: {} });
  assert.match(html, /Ask MaiK/);
  assert.match(html, /data-oe-act="assess-maik"/);
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
