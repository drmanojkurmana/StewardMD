import test from "node:test";
import assert from "node:assert/strict";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("odc");

test("model contract", () => contract(M, src, "odc"));

test("Severinghaus 1979: the standard curve at textbook points", () => {
  // S = 1 / (23400 / (P^3 + 150 P) + 1)
  assert.equal(M.severinghaus(40).toFixed(4), (1 / (23400 / (64000 + 6000) + 1)).toFixed(4));
  assert.equal(M.at(40).so2, 74.9);   // mixed venous about 75%
  assert.equal(M.at(60).so2, 90.6);   // about 90% at 60 mmHg
  assert.equal(M.at(100).so2, 97.7);  // arterial on air about 97%
  assert.ok(Math.abs(M.at(26.8).so2 - 50) < 0.5, "P50 26.8 mmHg");
  assert.equal(M.at(0).so2, 0);
  assert.equal(M.p50().p50, 26.8);
  assert.equal(M.at(80).shift, "none");
});

test("Kelman correction: pH, temperature and PaCO2 move P50 the right way by the right amount", () => {
  // P50 = 26.8 / 10^(0.024(37-T) + 0.40(pH-7.4) + 0.06 log10(40/PCO2))
  assert.equal(M.p50({ ph: 7.2 }).p50, +(26.8 / Math.pow(10, 0.4 * -0.2)).toFixed(1));
  assert.equal(M.p50({ ph: 7.2 }).p50, 32.2);
  assert.equal(M.p50({ ph: 7.6 }).p50, 22.3);
  assert.equal(M.p50({ temp: 40 }).p50, 31.6);
  assert.equal(M.p50({ temp: 32 }).p50, 20.3);
  assert.equal(M.p50({ pco2: 80 }).p50, 27.9);
  assert.equal(M.at(60, { ph: 7.2 }).shift, "right");
  assert.ok(M.at(60, { ph: 7.2 }).so2 < M.at(60).so2, "acidosis lowers saturation at the same PO2");
  assert.equal(M.at(60, { temp: 32 }).shift, "left");
});

test("HbF and 2,3-DPG", () => {
  assert.equal(M.p50({ hbf: true }).p50, 19);
  assert.equal(M.p50({ dpg: "high" }).p50, 29.8);
  assert.equal(M.p50({ dpg: "low" }).p50, 23.8);
  assert.ok(M.at(30, { hbf: true }).so2 > M.at(30).so2 + 15, "fetal blood is far more saturated at 30 mmHg");
});

test("po2For inverts the curve; curve() spans the axis", () => {
  assert.ok(Math.abs(M.po2For(90).po2 - 58.7) < 0.2);
  assert.ok(Math.abs(M.at(M.po2For(75, { ph: 7.25 }).po2, { ph: 7.25 }).so2 - 75) < 0.2);
  const c = M.curve({}, 120, 1);
  assert.equal(c.points.length, 121);
  for (let i = 1; i < c.points.length; i++) assert.ok(c.points[i].so2 > c.points[i - 1].so2, "monotonic");
});

test("bad input is refused with a bilingual error", () => {
  for (const r of [M.at(-1), M.at(50, { ph: 9 }), M.at(50, { temp: 50 }), M.at(50, { pco2: 1 }), M.at(50, { dpg: "x" }), M.po2For(100)]) {
    assert.equal(r.ok, false); assert.ok(r.error.en && r.error.hi);
  }
});
