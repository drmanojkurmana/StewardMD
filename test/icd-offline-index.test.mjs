/* test/icd-offline-index.test.mjs — the offline ICD-10 index (icd/icd10.min.json) and icd.js's
 * window.SMD_ICD.localSearch() that reads it (see maik-engine.js icdCandidates()'s offline
 * fallback, test/maik-icd-offline.test.mjs for the engine-side wiring).
 *
 * node --test test/icd-offline-index.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DATA_PATH = fileURLToPath(new URL("../icd/icd10.min.json", import.meta.url));
const ROWS = JSON.parse(readFileSync(DATA_PATH, "utf8"));
const ICD_JS = readFileSync(new URL("../icd.js", import.meta.url), "utf8");
const CODE_RE = /^[A-Z]\d\d(\.\d)?$/;

test("icd10.min.json: array of [code,title] pairs, codes unique, sorted, WHO 4-char, well over 8000 rows", () => {
  assert.ok(Array.isArray(ROWS));
  assert.ok(ROWS.length > 8000, "row count: " + ROWS.length);
  const seen = new Set();
  let prev = "";
  for (const row of ROWS) {
    assert.ok(Array.isArray(row) && row.length === 2, "row shape: " + JSON.stringify(row));
    const [code, title] = row;
    assert.match(code, CODE_RE, "code format: " + code);
    assert.ok(title && typeof title === "string" && title.length > 0, "title present for " + code);
    assert.ok(!seen.has(code), "duplicate code: " + code);
    seen.add(code);
    assert.ok(code >= prev, "not sorted: " + prev + " before " + code);
    prev = code;
  }
});

/* Load icd.js with a stub window/document/fetch (fetch returns the REAL file from disk, so this
 * exercises the actual shipped data, not a fixture) - same loader shape as other buildless-app
 * tests (new Function("window", ..., SRC)(win, ...)). icd.js touches `document` only inside DOM
 * functions this test never calls, so a stub object is enough. */
function loadIcd() {
  const win = { document: {}, ICONS: null };
  win.fetch = async (url) => {
    assert.equal(url, "icd/icd10.min.json", "relative path, same convention as other data dirs");
    return { ok: true, json: async () => JSON.parse(readFileSync(DATA_PATH, "utf8")) };
  };
  win.window = win;
  new Function("window", "document", ICD_JS)(win, win.document);
  return win.SMD_ICD;
}

test("localSearch: code-like query prefix-matches codes", async () => {
  const SMD_ICD = loadIcd();
  const rows = await SMD_ICD.localSearch("E11", 30);
  assert.ok(rows.length > 1);
  assert.ok(rows.every((r) => r.code.indexOf("E11") === 0));
  assert.ok(rows.some((r) => r.code === "E11.9"));
});

test("localSearch: free-text query ranks by token-prefix title match, and returns the server's row shape", async () => {
  const SMD_ICD = loadIcd();
  const rows = await SMD_ICD.localSearch("type 2 diabetes", 30);
  assert.ok(rows.length > 0);
  assert.match(rows[0].code, /^E11/, "type 2 diabetes -> E11.x first, got " + rows[0].code);
  const r = rows[0];
  assert.equal(r.id, "icd10:" + r.code);
  assert.equal(r.system, "ICD-10");
  assert.equal(r.chapter, r.code.slice(0, 3));
  assert.equal(r.is_leaf, 1);
});

test("localSearch: 'cholera' returns A00.x rows", async () => {
  const SMD_ICD = loadIcd();
  const rows = await SMD_ICD.localSearch("cholera", 30);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.code.slice(0, 3) === "A00"), "all A00.x, got " + rows.map((r) => r.code));
});

test("localSearch: limit is respected", async () => {
  const SMD_ICD = loadIcd();
  const rows = await SMD_ICD.localSearch("diabetes", 3);
  assert.equal(rows.length, 3);
});
