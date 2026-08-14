/* Golden regression for the OPT-IN hardening features of the oncology dose engine.
 * Every feature here defaults OFF; when unset, dose output must equal the legacy Phase-1 behavior.
 * Grounded sources: Cockcroft-Gault creatinine floor (oncology pharmacy practice), Devine IBW +
 * Adjusted Body Weight, absolute carboplatin AUC-dose cap (pharmacy safety), all re-cited to the
 * NCCN Chemotherapy Order Templates Appendix A/B. No clinical threshold is invented: floors, obesity
 * thresholds and absolute caps are all caller-supplied. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const D = require(join(HERE, "..", "onco-dose.js"));
const round2 = (n) => Math.round(n * 100) / 100;

/* ---- Feature 1: creatinine floor (opt-in gfrCockcroft o.creatinineFloor / params.creatinineFloor) ---- */

test("creatinine floor: OFF by default -> Cockcroft-Gault unchanged", () => {
  const noOpt = D.gfrCockcroft({ age: 70, wKg: 60, scr: 0.6 });
  assert.equal(round2(noOpt), round2((140 - 70) * 60 / (72 * 0.6))); // 97.22, low scr NOT floored
});

test("creatinine floor: applied clamps scr up, lowering GFR (grounded, caller-supplied value)", () => {
  const floored = D.gfrCockcroft({ age: 70, wKg: 60, scr: 0.6, creatinineFloor: 0.8 });
  const atFloor = D.gfrCockcroft({ age: 70, wKg: 60, scr: 0.8 });
  assert.equal(round2(floored), round2(atFloor));            // 0.6 clamped up to 0.8
  assert.ok(floored < D.gfrCockcroft({ age: 70, wKg: 60, scr: 0.6 })); // floor lowers GFR
});

test("creatinine floor: does not bind when scr already >= floor (no change, no warning)", () => {
  const g = D.gfrCockcroft({ age: 70, wKg: 60, scr: 1.2, creatinineFloor: 0.8 });
  assert.equal(round2(g), round2((140 - 70) * 60 / (72 * 1.2)));
});

test("creatinine floor via doseForDrug: floored carbo dose < unfloored, and a floor warning fires", () => {
  const drug = { id: "carbo", basis: "auc", dosePerUnit: 5 };
  const p = { age: 70, weight: 60, creatinine: 0.6, sex: "male" };
  const noFloor = D.doseForDrug(drug, p);
  const floored = D.doseForDrug(drug, Object.assign({}, p, { creatinineFloor: 0.8 }));
  assert.ok(floored.final < noFloor.final);
  assert.ok(floored.warnings.some((w) => /creatinine floored/i.test(w)), "floor warning must be present");
  assert.ok(!noFloor.warnings.some((w) => /creatinine floored/i.test(w)), "no floor warning when option OFF");
});

test("creatinine floor: supplied but non-binding via doseForDrug == legacy (no floor warning)", () => {
  const drug = { id: "carbo", basis: "auc", dosePerUnit: 5, roundingRule: { increment: 10 } };
  const legacy = D.doseForDrug(drug, { age: 70, weight: 60, creatinine: 1.2, sex: "male" });
  const withOff = D.doseForDrug(drug, { age: 70, weight: 60, creatinine: 1.2, sex: "male", creatinineFloor: 0.8 });
  assert.equal(withOff.final, legacy.final);
  assert.ok(!withOff.warnings.some((w) => /creatinine floored/i.test(w)));
});

/* ---- Feature 2: AIBW (opt-in weightStrategy "aibw", Devine IBW + caller aibwThreshold) ---- */

test("Devine IBW + AIBW formulas (grounded)", () => {
  const ibwM = D.ibwDevine(175, "male");
  assert.equal(round2(ibwM), round2(50 + 2.3 * (175 / 2.54 - 60)));   // 70.46
  const ibwF = D.ibwDevine(175, "female");
  assert.equal(round2(ibwF), round2(45.5 + 2.3 * (175 / 2.54 - 60))); // 65.96
  assert.equal(round2(D.aibwCalc(120, ibwM)), round2(ibwM + 0.4 * (120 - ibwM)));
  assert.equal(D.ibwDevine(0, "male"), null); // never-invent: no height -> null
});

test("AIBW applied for obese: BSA dose uses AIBW (< actual-weight dose) with a citing warning", () => {
  const drug = { id: "x", basis: "bsa", dosePerUnit: 100, unit: "mg/m2" };
  const actual = D.doseForDrug(drug, { height: 175, weight: 120, sex: "male" }); // legacy = actual weight
  const aibw = D.doseForDrug(drug, { height: 175, weight: 120, sex: "male", weightStrategy: "aibw", aibwThreshold: 20 });
  assert.ok(aibw.final < actual.final, "AIBW lowers the obese-patient dose vs actual weight");
  assert.ok(aibw.warnings.some((w) => /AIBW/.test(w) && /Devine/.test(w)));
});

test("AIBW below caller threshold -> actual weight used (defined behavior, not never-invent)", () => {
  const drug = { id: "x", basis: "bsa", dosePerUnit: 100 };
  const actual = D.doseForDrug(drug, { height: 175, weight: 72, sex: "male" });
  const aibw = D.doseForDrug(drug, { height: 175, weight: 72, sex: "male", weightStrategy: "aibw", aibwThreshold: 20 });
  assert.equal(aibw.final, actual.final); // 72 < IBW(70.46)+20 -> actual weight
  assert.ok(aibw.warnings.some((w) => /actual weight used/i.test(w)));
});

test("AIBW missing height -> never-invent: null final + warning, NO silent fall back to actual", () => {
  const drug = { id: "x", basis: "bsa", dosePerUnit: 100 };
  const lin = D.doseForDrug(drug, { weight: 120, sex: "male", weightStrategy: "aibw", aibwThreshold: 20 });
  assert.equal(lin.final, null);
  assert.equal(lin.calculated, null);
  assert.ok(lin.warnings.some((w) => /never-invent/i.test(w) && /aibw/i.test(w)));
});

test("AIBW missing threshold -> never-invent (threshold is caller-supplied, never defaulted)", () => {
  const drug = { id: "x", basis: "bsa", dosePerUnit: 100 };
  const lin = D.doseForDrug(drug, { height: 175, weight: 120, sex: "male", weightStrategy: "aibw" });
  assert.equal(lin.final, null);
  assert.ok(lin.warnings.some((w) => /aibwThreshold/i.test(w)));
});

test("AIBW also adjusts the mg/kg weight input for obese patients", () => {
  const drug = { id: "x", basis: "mgkg", dosePerUnit: 10 };
  const aibw = D.doseForDrug(drug, { height: 175, weight: 120, sex: "male", weightStrategy: "aibw", aibwThreshold: 20 });
  const ibw = D.ibwDevine(175, "male");
  assert.equal(round2(aibw.final), round2(10 * D.aibwCalc(120, ibw)));
  assert.equal(round2(aibw.inputs.weight), round2(D.aibwCalc(120, ibw)));
});

/* ---- Feature 3: absolute carboplatin dose cap (opt-in params.carboplatinMaxDoseMg) ---- */

test("carboplatin absolute cap: binds and is recorded in the lineage", () => {
  const drug = { id: "carbo", basis: "auc", dosePerUnit: 6, roundingRule: { increment: 50 } };
  const uncapped = D.doseForDrug(drug, { gfr: 100 }); // calvert(6,100)=750
  assert.equal(uncapped.final, 750);
  assert.equal(uncapped.capApplied, false);
  const capped = D.doseForDrug(drug, { gfr: 100, carboplatinMaxDoseMg: 600 });
  assert.equal(capped.final, 600);
  assert.equal(capped.capApplied, true);
  assert.ok(capped.warnings.some((w) => /capped at absolute 600 mg/i.test(w)));
});

test("carboplatin absolute cap: non-binding cap leaves dose unchanged, no cap warning", () => {
  const drug = { id: "carbo", basis: "auc", dosePerUnit: 6, roundingRule: { increment: 50 } };
  const lin = D.doseForDrug(drug, { gfr: 100, carboplatinMaxDoseMg: 900 });
  assert.equal(lin.final, 750);
  assert.equal(lin.capApplied, false);
  assert.ok(!lin.warnings.some((w) => /capped at absolute/i.test(w)));
});

test("carboplatin absolute cap: not applied to non-AUC drugs", () => {
  const drug = { id: "y", basis: "bsa", dosePerUnit: 500, roundingRule: { increment: 1 } };
  const lin = D.doseForDrug(drug, { bsa: 2, carboplatinMaxDoseMg: 100 }); // 1000 mg, cap ignored (not auc)
  assert.equal(lin.final, 1000);
  assert.equal(lin.capApplied, false);
});

/* ---- All options OFF == pre-existing behavior (byte-for-byte) ---- */

test("all hardening options OFF -> output identical to legacy lineage", () => {
  const bsaDrug = { id: "cyclophosphamide", basis: "bsa", dosePerUnit: 750, unit: "mg/m2", roundingRule: { increment: 50 } };
  const legacy = D.doseForDrug(bsaDrug, { bsa: 1.54 });
  const withUndefOpts = D.doseForDrug(bsaDrug, { bsa: 1.54, creatinineFloor: undefined, weightStrategy: undefined, aibwThreshold: undefined, carboplatinMaxDoseMg: undefined });
  assert.deepEqual(withUndefOpts, legacy);
  assert.equal(legacy.final, 1150); // matches the Phase-1 golden

  const aucDrug = { id: "carbo", basis: "auc", dosePerUnit: 5, roundingRule: { increment: 10 } };
  const aucLegacy = D.doseForDrug(aucDrug, { age: 60, weight: 70, creatinine: 1, sex: "male" });
  const aucOff = D.doseForDrug(aucDrug, { age: 60, weight: 70, creatinine: 1, sex: "male", creatinineFloor: undefined, carboplatinMaxDoseMg: undefined });
  assert.deepEqual(aucOff, aucLegacy);
});
