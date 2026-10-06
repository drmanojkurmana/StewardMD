import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("tof");

test("model contract", () => contract(M, src, "tof"));

test("ASA 2023 depths", () => {
  assert.equal(M.depth({ count: 0, ptc: 0 }).depth, "intense");
  assert.equal(M.depth({ count: 0, ptc: 3 }).depth, "deep");
  for (const c of [1, 2, 3]) assert.equal(M.depth({ count: c }).depth, "moderate");
  assert.equal(M.depth({ count: 4, ratio: 0.3 }).depth, "shallow");
  assert.equal(M.depth({ count: 4, ratio: 0.4 }).depth, "minimal");
  assert.equal(M.depth({ count: 4, ratio: 0.89 }).depth, "minimal");
  assert.equal(M.depth({ count: 4, ratio: 0.9 }).depth, "recovered");
  assert.equal(M.depth({ count: 4, ratio: 0.89 }).residual, true, "below 0.9 is residual block");
  assert.equal(M.depth({ count: 4, ratio: 0.7 }).qualitativeBlind, true);
  assert.equal(M.constants.residual, 0.9);
});

test("sugammadex doses match the reviewed RSI protocol", () => {
  const kb = readFileSync(new URL("../kb/clinical-protocols/rapid-sequence-intubation.json", import.meta.url), "utf8");
  assert.match(kb, /16 mg\/kg IV for immediate reversal of rocuronium 1\.2 mg\/kg; 2 to 4 mg\/kg IV for routine reversal \(4 mg\/kg for deep block, 2 mg\/kg once T2 has reappeared\)/);
  assert.deepEqual(M.constants.sugammadex, { shallow: 2, deep: 4, immediate: 16 });
  assert.equal(M.reverse("deep", "aminosteroid", 70).plan.doseMg, 280);
  assert.equal(M.reverse("moderate", "aminosteroid", 70, 1).plan.mgPerKg, 4, "TOF count 1 needs 4 mg/kg");
  assert.equal(M.reverse("moderate", "aminosteroid", 70).plan.mgPerKg, 4, "unknown count defaults to 4 mg/kg");
  for (const c of [2, 3]) assert.equal(M.reverse("moderate", "aminosteroid", 70, c).plan.mgPerKg, 2, "count " + c);
  assert.match(M.reverse("moderate", "aminosteroid", 70).text.en, /TOF count 1: sugammadex 4 mg\/kg/);
  assert.equal(M.reverse("intense", "aminosteroid", 70).plan.doseMg, 1120);
  assert.equal(M.reverse("deep", "aminosteroid").plan.doseMg, null, "no weight, no mg");
});

test("neostigmine: minimal depth only (ASA 2023), 40 to 50 mcg/kg, max 5 mg (Miller)", () => {
  assert.equal(M.reverse("minimal", "aminosteroid", 70).alt.drug, "neostigmine");
  assert.deepEqual(M.reverse("minimal", "aminosteroid", 70).alt.doseMg, [2.8, 3.5]);
  assert.deepEqual(M.reverse("minimal", "benzyl", 150).plan.doseMg, [5, 5], "capped at 5 mg");
  for (const d of ["intense", "deep", "moderate", "shallow"]) assert.equal(M.reverse(d, "benzyl", 70).action, "wait", d);
  assert.equal(M.reverse("recovered", "benzyl").action, "extubate");
});

test("twitch heights", () => {
  assert.deepEqual(M.twitches({ count: 4, ratio: 0.4 }), [1, 0.8, 0.6, 0.4]);
  assert.deepEqual(M.twitches({ count: 2 }).map((x) => x > 0), [true, true, false, false]);
  assert.deepEqual(M.twitches({ count: 0 }), [0, 0, 0, 0]);
});

test("bad input", () => {
  for (const r of [M.depth({ count: 5 }), M.depth({ count: 0 }), M.depth({ count: 4 }), M.reverse("x", "aminosteroid"), M.reverse("deep", "x")]) assert.equal(r.ok, false);
});
