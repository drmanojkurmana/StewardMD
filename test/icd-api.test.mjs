/* test/icd-api.test.mjs — ICD Search API: pure helpers, no network/D1.
 *
 * node --test test/icd-api.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ftsQuery, isCodeLike, clampLimit, normSystem } from "../functions/_icd_repo.js";

test("ftsQuery: lowercase, [a-z0-9]+ tokens, each prefix-matched, space-joined", () => {
  assert.equal(ftsQuery("Type 2 Diabetes Mellitus"), "type* 2* diabetes* mellitus*");
  assert.equal(ftsQuery(""), null);
  assert.equal(ftsQuery("??"), null, "no [a-z0-9] tokens at all");
});

test("isCodeLike: a short alphanumeric token with a digit reads as a code, not free text", () => {
  assert.equal(isCodeLike("E11"), true);
  assert.equal(isCodeLike("A00.0"), true);
  assert.equal(isCodeLike("1A03.0"), true);
  assert.equal(isCodeLike("diabetes"), false, "no digit");
  assert.equal(isCodeLike("a very long free text query with digits 123"), false, "too long to be a code");
});

test("clampLimit: clamps to 1..100, unparsable input defaults to 20", () => {
  assert.equal(clampLimit("999"), 100);
  assert.equal(clampLimit("0"), 1);
  assert.equal(clampLimit("x"), 20);
  assert.equal(clampLimit(undefined), 20);
});

test("normSystem: recognises ICD-10/ICD-11 in either dashed or bare form, else no filter", () => {
  assert.equal(normSystem("ICD-10"), "ICD-10");
  assert.equal(normSystem("icd10"), "ICD-10");
  assert.equal(normSystem("ICD-11"), "ICD-11");
  assert.equal(normSystem("icd11"), "ICD-11");
  assert.equal(normSystem(""), "");
  assert.equal(normSystem("bogus"), "");
});

// The repo file must never build SQL by interpolating caller input into the string — every
// value crosses the D1 boundary through .bind(). Grep the file itself rather than trust review.
test("_icd_repo.js SQL uses only ? placeholders, never template-interpolated values", () => {
  const src = readFileSync(fileURLToPath(new URL("../functions/_icd_repo.js", import.meta.url)), "utf8");
  const sqlLines = src.split("\n").filter((l) => /SELECT|INSERT|WHERE|FROM/i.test(l));
  for (const line of sqlLines) {
    assert.ok(!/\$\{/.test(line), "template interpolation found in a SQL-bearing line: " + line.trim());
  }
  assert.ok(/WHERE code = \?/.test(src));
  assert.ok(/WHERE icd_fts MATCH \?/.test(src));
  assert.ok(/WHERE id = \?/.test(src));
});
