import test from "node:test";
import assert from "node:assert/strict";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("mac");

test("model contract", () => contract(M, src, "mac"));

test("Mapleson 1996: MAC at age 40 and the age factor", () => {
  const mac40 = { halothane: 0.75, isoflurane: 1.17, sevoflurane: 1.8, desflurane: 6.6, n2o: 104 };
  for (const [k, v] of Object.entries(mac40)) { assert.equal(M.agents[k].mac40, v, k); assert.equal(M.macForAge(k, 40).mac, v); }
  assert.equal(M.constants.ageK, -0.00269);
  assert.ok(Math.abs(M.macForAge("sevoflurane", 50).exact / 1.8 - Math.pow(10, -0.0269)) < 1e-12);
  assert.ok(Math.abs(1 - Math.pow(10, -0.0269) - 0.06) < 0.003, "about 6% per decade");
  assert.equal(M.macForAge("sevoflurane", 80).mac, 1.4);
  assert.equal(M.macForAge("sevoflurane", 1).mac, 2.29);
  assert.equal(M.macForAge("desflurane", 70).mac, 5.48);
});

test("blood:gas coefficients (Morgan and Mikhail 7e Table 8-3); speed order", () => {
  const bg = { n2o: 0.47, halothane: 2.4, isoflurane: 1.4, desflurane: 0.42, sevoflurane: 0.65 };
  for (const [k, v] of Object.entries(bg)) assert.equal(M.agents[k].bloodGas, v, k);
  assert.deepEqual(M.compare().map((x) => x.agent), ["desflurane", "n2o", "sevoflurane", "isoflurane", "halothane"]);
});

test("MAC fractions add", () => {
  const r = M.combine(40, { sevoflurane: 1.2, n2o: 52 });
  assert.equal(r.parts.length, 2);
  assert.equal(r.total, +(1.2 / 1.8 + 0.5).toFixed(2));
  assert.equal(r.band.id, "mac");
  assert.equal(M.combine(40, { sevoflurane: 0.9, n2o: 30 }).band.id, "sub");
  assert.equal(M.combine(40, { isoflurane: 1.17 }).band.id, "mac");
  assert.equal(M.combine(40, { isoflurane: 1.6 }).band.id, "ed95");
  assert.equal(M.combine(40, {}).total, 0);
  assert.equal(M.combine(40, { n2o: 85 }).warnings.length, 1, "N2O above 79% leaves under 21% oxygen");
  assert.equal(M.combine(40, { sevoflurane: 1, isoflurane: 0.5 }).warnings.length, 1);
  assert.ok(M.combine(80, { sevoflurane: 1.2 }).total > M.combine(30, { sevoflurane: 1.2 }).total, "older: more MAC for the same end-tidal");
});

test("bad input", () => {
  for (const r of [M.macForAge("xenon", 40), M.macForAge("sevoflurane", 0), M.combine(40, { sevoflurane: -1 }), M.combine(120, {})]) assert.equal(r.ok, false);
});
