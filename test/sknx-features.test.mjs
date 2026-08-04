import { test } from "node:test";
import assert from "node:assert";
import FEAT from "../sknx-features.js";

test("converts pixel geometry to mm and flags an irregular border", () => {
  // A circle has borderIndex ~1; jagged shapes are higher. perimeter^2/(4*pi*area).
  const f = FEAT.derive({ maskAreaPx: 1000, perimeterPx: 200, diameterPx: 60, pxPerMm: 10, colors: ["brown", "black", "red"] });
  assert.equal(f.diameterMm, 6);
  assert.ok(f.borderIndex > 1.2);
  assert.equal(f.borderIrregular, true);
  assert.equal(f.colorVariegation, true); // 3 distinct colors
});
