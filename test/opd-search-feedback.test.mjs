/* test/opd-search-feedback.test.mjs — GHIS investigation/medication search shows visible status.
 * Was silent on empty/error (looked broken). node --test test/opd-search-feedback.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() {
  const win = {}; const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.OPDEMR;
}
const base = { patient: { name: "A", mrn: "1" }, tab: "inv", loading: false, assessLoaded: true, writeOn: true, source: "ghis", labs: [], radiology: [], medications: [], invResults: [], invDraft: {}, invQuery: "cbc" };
const r = (msg) => load()._render(Object.assign({}, base, { invSearchMsg: msg }));

test("login_required -> visible note + reconnect action (not a silent blank)", () => {
  const h = r("login");
  assert.match(h, /session is not active/i);
  assert.match(h, /data-oe-act="ghis-reconnect"/);
});
test("no matches -> visible note", () => { assert.match(r("none"), /No matches/i); });
test("searching -> spinner note", () => { assert.match(r("searching"), /Searching GHIS/i); });
test("error -> visible failure note", () => { assert.match(r("error"), /Search failed/i); });
test("no message -> no note (clean)", () => { assert.ok(!/oe-search-note/.test(load()._render(base))); });

test("abbreviation expansion: inv abbreviations -> full GHIS-searchable term; meds unchanged", () => {
  const E = load()._expandQuery;
  assert.equal(E("inv", "cbc"), "complete blood count");   // GHIS returns 0 for "cbc", 1 for the full term
  assert.equal(E("inv", "lft"), "liver function");
  assert.equal(E("inv", "rft"), "renal function");
  assert.equal(E("inv", "ecg"), "electrocardiogram");
  assert.equal(E("inv", "complete blood count"), "complete blood count");  // non-abbrev unchanged
  assert.equal(E("med", "paracetamol"), "paracetamol");    // meds never expanded
});
