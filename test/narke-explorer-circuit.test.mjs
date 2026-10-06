import test from "node:test";
import assert from "node:assert/strict";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("circuit");

test("model contract", () => contract(M, src, "circuit"));

test("working absorber: no inspired CO2 at any flow; normal end-tidal", () => {
  for (const f of [0.5, 1, 3, 8]) assert.equal(M.state({ fgf: f }).inspiredCO2, 0);
  assert.equal(M.state({}).endTidalCO2, 41.1); // 863 x 0.2 / (6 x 0.7)
});

test("exhausted absorber: inspired CO2 = k x 863 VCO2/VE / (1 - k); washout when FGF >= VE", () => {
  const r = M.state({ fgf: 3, ve: 6, vco2: 200, absorber: "exhausted" });
  const k = 0.5, rise = 863 * 0.2 / 6;
  assert.equal(r.inspiredCO2, +(k * rise / (1 - k)).toFixed(1));
  assert.equal(r.inspiredCO2, 28.8);
  assert.equal(r.rebreathedFraction, 0.5);
  assert.equal(r.alerts[0].id, "rebreathing");
  assert.equal(M.state({ fgf: 6, absorber: "exhausted" }).inspiredCO2, 0);
  assert.equal(M.state({ fgf: 6, absorber: "exhausted" }).washout, true);
  assert.equal(M.state({ fgf: 1, absorber: "exhausted" }).runaway, true);
  assert.ok(M.state({ fgf: 1, absorber: "exhausted" }).inspiredCO2 > M.state({ fgf: 2, absorber: "exhausted" }).inspiredCO2, "lower flow, more rebreathing");
});

test("Baker 1994 flow names; sevoflurane label note below 1 L/min", () => {
  const n = (f) => M.flowClass(f).id;
  assert.deepEqual([0.25, 0.4, 0.8, 1.5, 3, 6].map(n), ["metabolic", "minimal", "low", "medium", "high", "very-high"]);
  assert.ok(M.state({ fgf: 0.5 }).alerts.some((a) => a.id === "sevo"));
  assert.ok(!M.state({ fgf: 1 }).alerts.some((a) => a.id === "sevo"));
});

test("capnogram baseline is the inspired CO2", () => {
  const st = M.state({ fgf: 3, absorber: "exhausted" }), c = M.capnogram(st);
  assert.equal(c[0].co2, st.inspiredCO2);
  assert.equal(Math.max(...c.map((p) => p.co2)), st.endTidalCO2);
  assert.equal(M.capnogram(M.state({}))[0].co2, 0);
});

test("parts of the circle are all named", () => {
  assert.deepEqual(M.partOrder, ["fgf", "insp", "y", "exp", "apl", "bag", "absorber"]);
  for (const k of M.partOrder) assert.ok(M.parts[k].name.hi && M.parts[k].role.hi);
});

test("bad input", () => {
  for (const s of [{ fgf: 0 }, { ve: 30 }, { vco2: 50 }, { absorber: "x" }]) assert.equal(M.state(s).ok, false);
});
