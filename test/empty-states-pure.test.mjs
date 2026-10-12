import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const E = require("../empty-states.js");

test("kindOf: empty and error class names from many modules", () => {
  for (const c of ["w-empty", "pn-empty", "icu-empty", "q-empty", "db-empty", "ghis-empty", "ghis-lab-empty", "sknx-report-p sknx-report-empty", "icu-v2-empty2", "tx-empty", "no-data"]) assert.equal(E.kindOf(c), "empty", c);
  for (const c of ["pn-err", "sp-err", "pgl-err", "smdea-err", "gs-err", "load-error", "sync-failed"]) assert.equal(E.kindOf(c), "error", c);
  assert.equal(E.kindOf("pn-err pn-empty"), "error", "an error wins over an empty");
});

test("kindOf: ordinary classes are not placeholders", () => {
  for (const c of ["mc-card", "emptyish-card", "temperature", "terror-card", "db-comp", "", null, undefined, "tx-empty-title", "tx-empty-sub", "icu-v2-empty-ic", "icu-btn icu-v2-empty-cta"]) assert.equal(E.kindOf(c), null, String(c));
});

test("simpleText: a short message only", () => {
  assert.equal(E.simpleText("No calculators match your search."), true);
  assert.equal(E.simpleText("  Nothing   saved yet "), true);
  assert.equal(E.simpleText("none"), false);
  assert.equal(E.simpleText("x".repeat(200)), false);
  assert.equal(E.simpleText(""), false);
});
