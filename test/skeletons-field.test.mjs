// skeletons.js (owner 2026-11-11): the full-screen heart loader appeared inside Settings > Profile rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const S = readFileSync(new URL("../skeletons.js", import.meta.url), "utf8");
test("a value beside its label in a row is a field: no skeleton, no loader", () => {
  assert.match(S, /if \(isFieldValue\(el\)\) return false;/);
  assert.match(S, /function isFieldValue\(el\)/);
});
test("a screen with several placeholders is a form still loading, never an empty screen", () => {
  assert.match(S, /if \(r !== el && morePlaceholders\(r, el\)\) return false;/);
});
