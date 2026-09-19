/* test/govschemes-api.test.mjs — Government Health Schemes API: pure helpers, no network/D1.
 *
 * node --test test/govschemes-api.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ftsQuery, isCodeLike, clampLimit, normaliseName } from "../functions/_schemes_repo.js";

test("ftsQuery: lowercase, [a-z0-9]+ tokens, each prefix-matched, space-joined", () => {
  assert.equal(ftsQuery("Modified Radical Mastectomy"), "modified* radical* mastectomy*");
  assert.equal(ftsQuery("S7.1.5.1"), "s7* 1* 5* 1*");
  assert.equal(ftsQuery(""), null);
  assert.equal(ftsQuery("??"), null, "no [a-z0-9] tokens at all");
});

test("isCodeLike: a digit or a dot marks a query as a native code, not free text", () => {
  assert.equal(isCodeLike("S7.1.5.1"), true);
  assert.equal(isCodeLike("BM001A"), true);
  assert.equal(isCodeLike("mastectomy"), false);
});

test("clampLimit: clamps to 1..100, unparsable input defaults to 20", () => {
  assert.equal(clampLimit("999"), 100);
  assert.equal(clampLimit("0"), 1);
  assert.equal(clampLimit("x"), 20);
  assert.equal(clampLimit(undefined), 20);
});

test("normaliseName: trims, lowercases, collapses whitespace for cross-state grouping", () => {
  assert.equal(normaliseName("  Modified   Radical Mastectomy  "), "modified radical mastectomy");
  assert.equal(normaliseName(""), "");
});

// The repo file must never build SQL by interpolating caller input into the string — every
// value crosses the D1 boundary through .bind(). Grep the file itself rather than trust review.
test("_schemes_repo.js SQL uses only ? placeholders, never template-interpolated values", () => {
  const src = readFileSync(fileURLToPath(new URL("../functions/_schemes_repo.js", import.meta.url)), "utf8");
  const sqlLines = src.split("\n").filter((l) => /SELECT|INSERT|WHERE|FROM/i.test(l));
  for (const line of sqlLines) {
    assert.ok(!/\$\{/.test(line), "template interpolation found in a SQL-bearing line: " + line.trim());
  }
  // Every WHERE clause comparison binds through a placeholder, not a literal spliced value.
  assert.ok(/WHERE p\.treatment_code = \?/.test(src));
  assert.ok(/WHERE packages_fts MATCH \?/.test(src));
  assert.ok(/WHERE p\.id = \?/.test(src));
});
