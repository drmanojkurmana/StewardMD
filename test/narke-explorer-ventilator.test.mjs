import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("ventilator");

test("model contract", () => contract(M, src, "ventilator"));

test("volume control: equation of motion", () => {
  // C 50, R 10, PEEP 5, Vt 500, rate 12, I:E 1:2 -> Ti 1.667 s, flow 0.3 L/s
  const r = M.breath({ mode: "vc", compliance: 50, resistance: 10, peep: 5, vt: 500, rate: 12, ie: 2 });
  assert.equal(r.ti, 1.67); assert.equal(r.tau, 0.5);
  assert.equal(r.plateau, 15);          // PEEP + Vt / C
  assert.equal(r.peak, 18);             // + flow x R = 0.3 x 10
  assert.equal(r.driving, 10);          // Vt / C
  assert.equal(r.resistivePressure, 3);
  assert.equal(r.autoPeep, 0);
  assert.equal(r.minuteVolume, 6);
  assert.equal(r.points[0].paw, 8, "inspiration starts at PEEP plus the resistive step");
  assert.equal(r.points.at(-1).volume, 0);
});

test("bronchospasm vs low compliance (volume control)", () => {
  const b0 = (p) => M.breath(Object.assign({ mode: "vc" }, M.presets[p]));
  const n = b0("normal"), b = b0("bronchospasm"), s = b0("stiff");
  assert.ok(b.peak - b.plateau > n.peak - n.plateau + 5, "bronchospasm widens peak minus plateau");
  assert.equal(b.driving, n.driving);
  assert.equal(b.trapped, true);
  assert.ok(s.plateau >= 30 && s.driving > 15);
  assert.deepEqual(s.alerts.map((a) => a.id), ["plateau", "driving"]);
});

test("pressure control: steady-state tidal volume of the one-compartment lung", () => {
  const r = M.breath({ mode: "pc", compliance: 50, resistance: 10, peep: 5, pinsp: 10, rate: 12, ie: 2 });
  const tau = 0.5, ti = 60 / 12 / 3, te = 2 * ti, ei = Math.exp(-ti / tau), ee = Math.exp(-te / tau);
  assert.equal(r.vt, Math.round(50 * 10 * (1 - ei) / (1 - ei * ee) * (1 - ee)));
  assert.equal(r.peak, 15);
  const b = M.breath({ mode: "pc", compliance: 50, resistance: 30, peep: 5, pinsp: 10 }), s = M.breath({ mode: "pc", compliance: 20, resistance: 10, peep: 5, pinsp: 10 });
  assert.ok(b.vt < r.vt && s.vt < r.vt, "both fall in pressure control");
  assert.equal(b.peak, r.peak);
});

test("limits pinned to the reviewed ARDS protocol", () => {
  const kb = readFileSync(new URL("../kb/clinical-protocols/ards-lung-protective-ventilation.json", import.meta.url), "utf8");
  assert.match(kb, /plateau pressure below 30 cmH2O/);
  assert.match(kb, /values above about 15 cmH2O are associated with higher mortality/);
  assert.equal(M.constants.plateauMax, 30); assert.equal(M.constants.drivingMax, 15);
});

test("bad input", () => {
  for (const s of [{ mode: "x" }, { compliance: 5 }, { rate: 60 }, { vt: 2000 }]) assert.equal(M.breath(s).ok, false);
});
