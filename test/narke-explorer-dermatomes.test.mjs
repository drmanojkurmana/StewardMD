import test from "node:test";
import assert from "node:assert/strict";
import { load, contract } from "./narke-explorer-helpers.mjs";
const { M, src } = load("dermatomes");

test("model contract", () => contract(M, src, "dermatomes"));

test("C2 to S5 in order; landmarks T4, T6, T10, L1", () => {
  assert.equal(M.levels.length, 7 + 12 + 5 + 5);
  assert.equal(M.levels[0], "C2"); assert.equal(M.levels.at(-1), "S5");
  assert.deepEqual(M.landmarks.map((l) => l.level), ["T4", "T6", "T10", "L1"]);
  assert.match(M.landmarks[0].name.en, /Nipple/); assert.match(M.landmarks[2].name.en, /Umbilicus/);
});

test("operation levels (Morgan and Mikhail Table 45-3; T4 for caesarean)", () => {
  const need = Object.fromEntries(M.operations.map((o) => [o.id, o.level]));
  assert.deepEqual(need, { caesarean: "T4", "upper-abdominal": "T4", pelvic: "T6", "turp-distension": "T10", hip: "T10", thigh: "L1", foot: "L2", perineal: "S2" });
  assert.equal(M.block("T4", "caesarean").operation.enough, true);
  assert.equal(M.block("T6", "caesarean").operation.enough, false);
  assert.equal(M.block("T6", "caesarean").operation.gap, 2);
  assert.equal(M.block("T10", "foot").operation.enough, true);
});

test("sympathetic 2 above, motor 2 below; warnings", () => {
  const b = M.block("T10");
  assert.equal(b.sympathetic, "T8"); assert.equal(b.motor, "T12");
  assert.deepEqual(b.landmarksCovered, ["T10", "L1"]);
  assert.equal(b.blocked[0], "T10");
  assert.deepEqual(M.block("T10").warnings, []);
  assert.deepEqual(M.block("T6").warnings.map((w) => w.id), ["cardiac"]);
  assert.deepEqual(M.block("C6").warnings.map((w) => w.id), ["high", "cardiac"]);
  assert.equal(M.block("C2").sympathetic, "C2", "clamped at the top");
  assert.equal(M.block("S5").motor, "S5", "clamped at the bottom");
});

test("bad input", () => {
  assert.equal(M.block("T13").ok, false);
  assert.equal(M.block("T4", "brain").ok, false);
});
