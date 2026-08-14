/* Phase 1 golden regression for the oncology dose engine. Hand-verified values across every dosing
 * basis + rounding + caps + the never-invent guard. A change that alters any golden dose fails here. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const D = require(join(HERE, "..", "onco-dose.js"));
const round2 = (n) => Math.round(n * 100) / 100;

test("BSA Mosteller golden", () => {
  assert.equal(round2(D.bsaMosteller(170, 65)), 1.75); // sqrt(170*65/3600)=1.7519
  assert.equal(D.bsaMosteller(0, 65), null);
  assert.equal(D.bsaMosteller(170, 0), null);
});

test("BSA-based dose + protocol rounding lineage (cyclophosphamide)", () => {
  const drug = { id: "cyclophosphamide", basis: "bsa", dosePerUnit: 750, unit: "mg/m2", roundingRule: { increment: 50 } };
  const lin = D.doseForDrug(drug, { bsa: 1.54 });
  assert.equal(lin.protocolDose, 750);
  assert.equal(lin.calculated, 1155);  // 750 * 1.54
  assert.equal(lin.rounded, 1150);     // nearest 50
  assert.equal(lin.final, 1150);
  assert.equal(lin.capApplied, false);
});

test("Calvert caps GFR at 125", () => {
  assert.equal(D.calvert(5, 130), 5 * (125 + 25)); // 750
  assert.equal(D.calvert(5, 100), 5 * (100 + 25)); // 625
  assert.equal(D.calvert(0, 100), null);
});

test("Cockcroft-Gault female x0.85", () => {
  const male = D.gfrCockcroft({ age: 60, wKg: 70, scr: 1, sex: "male" });
  const female = D.gfrCockcroft({ age: 60, wKg: 70, scr: 1, sex: "female" });
  assert.equal(round2(male), round2((140 - 60) * 70 / (72 * 1)));
  assert.equal(round2(female), round2(male * 0.85));
});

test("mg/kg multiply and flat passthrough", () => {
  assert.equal(D.doseForDrug({ id: "x", basis: "mgkg", dosePerUnit: 10 }, { weight: 70 }).final, 700);
  assert.equal(D.doseForDrug({ id: "pred", basis: "flat", dosePerUnit: 100 }, {}).final, 100);
});

test("never-invent: missing creatinine on an AUC drug yields a warning and null final", () => {
  const lin = D.doseForDrug({ id: "carbo", basis: "auc", dosePerUnit: 5 }, { age: 60, weight: 70, creatinine: null });
  assert.ok(lin.warnings.length > 0);
  assert.equal(lin.final, null);
  assert.equal(lin.calculated, null);
});

test("applyCap only when a cap is defined (no universal cap)", () => {
  assert.deepEqual(D.applyCap(2000, { perDose: null }), { mg: 2000, capApplied: false });
  assert.deepEqual(D.applyCap(2000, { perDose: 1500 }), { mg: 1500, capApplied: true });
  assert.deepEqual(D.applyCap(2000, null), { mg: 2000, capApplied: false });
});

test("vincristine 2 mg per-dose cap fires in the lineage", () => {
  const drug = { id: "vincristine", basis: "bsa", dosePerUnit: 1.4, caps: { perDose: 2 }, roundingRule: { increment: 0.1 } };
  const lin = D.doseForDrug(drug, { bsa: 1.83 }); // 1.4*1.83=2.562 -> >2 -> capped
  assert.equal(lin.capApplied, true);
  assert.equal(lin.final, 2);
});

test("planDoses returns one lineage per template drug", () => {
  const tmpl = { drugs: [{ id: "a", basis: "flat", dosePerUnit: 100 }, { id: "b", basis: "bsa", dosePerUnit: 375, roundingRule: { increment: 50 } }] };
  const out = D.planDoses(tmpl, { bsa: 1.8 });
  assert.equal(out.length, 2);
  assert.equal(out[0].final, 100);
  assert.equal(out[1].final, 700); // 375*1.8=675 -> nearest 50 = 700
});

test("R1: a cumulativeLifetime cap surfaces a warning even with a valid dose (doxorubicin)", () => {
  const drug = { id: "doxorubicin", basis: "bsa", dosePerUnit: 50, caps: { cumulativeLifetime: { warn: 450, hard: 550, unit: "mg/m2" } }, roundingRule: { increment: 5 } };
  const lin = D.doseForDrug(drug, { bsa: 1.8 });
  assert.equal(lin.final, 90); // 50*1.8=90
  assert.ok(lin.warnings.some((w) => /cumulative/i.test(w)), "cumulative-limit warning must be present");
});

test("R1 never-invent: malformed dosePerUnit (NaN) yields null final + warning, never a NaN dose", () => {
  const lin = D.doseForDrug({ id: "x", basis: "bsa", dosePerUnit: undefined }, { bsa: 1.8 });
  assert.equal(lin.final, null);
  assert.equal(lin.calculated, null);
  assert.ok(lin.warnings.length > 0);
});

test("intra-day frequency: dosesPerDay yields dailyDose; default keeps per-administration behavior", () => {
  // BID flat oral (dabrafenib 150 mg BID): per-administration final stays 150; dailyDose = 300.
  const bid = D.doseForDrug({ id: "dabrafenib", basis: "flat", dosePerUnit: 150, frequency: "BID" }, {});
  assert.equal(bid.final, 150);       // per administration unchanged (the safe, single-dose number)
  assert.equal(bid.dosesPerDay, 2);
  assert.equal(bid.dailyDose, 300);   // 150 x 2

  // explicit dosesPerDay overrides / works without a token (capecitabine 1000 mg/m2 BID).
  const cape = D.doseForDrug({ id: "capecitabine", basis: "bsa", dosePerUnit: 1000, dosesPerDay: 2 }, { bsa: 1.6 });
  assert.equal(cape.final, 1600);
  assert.equal(cape.dailyDose, 3200);

  // no frequency => once daily => dailyDose === final (legacy IV-chemo path is byte-identical).
  const qd = D.doseForDrug({ id: "rituximab", basis: "bsa", dosePerUnit: 375, roundingRule: { increment: 50 } }, { bsa: 1.8 });
  assert.equal(qd.dosesPerDay, 1);
  assert.equal(qd.dailyDose, qd.final);
});
