/* ResearchMD ROC view (research-roc-view.js): the cards, chart, paragraph,
 * manuscript text and CSV rows built from SMD_RESEARCH_STATS.roc.
 * Run: node --test test/research-roc-view.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const STATS = require("../research-stats.js");
globalThis.SMD_RESEARCH_STATS = STATS;
const VIEW = require("../research-roc-view.js");

const columns = ["Outcome", "Score", "Marker"];
const rows = [
  ["Poor", 3, 9], ["Poor", 4, 7], ["Poor", 2, 8], ["Poor", 1, 4], ["Poor", 5, 6],
  ["Good", 1, 5], ["Good", 2, 2], ["Good", 0, 3], ["Good", 1, 6], ["Good", 3, 1], ["Good", 0, 2]
];
const result = STATS.roc(rows, columns, "Outcome", ["Score", "Marker"], { positiveLevel: "Poor" });
const DASH = /[–—]/;

test("feature is on by default and the kill switch turns it off", () => {
  assert.equal(VIEW.isEnabled(), true);
  const store = { smd_rmd_roc: "0" };
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null) };
  try {
    assert.equal(VIEW.isEnabled(), false);
    store.smd_rmd_roc = "1";
    assert.equal(VIEW.isEnabled(), true);
  } finally {
    delete globalThis.localStorage;
  }
});

test("results show the chart, the AUC for each test and the comparison", () => {
  const html = VIEW.resultsHtml(result);
  assert.match(html, /<svg[^>]*rmd-mc-roc/);
  assert.match(html, /AUC/);
  assert.ok(html.includes("Score") && html.includes("Marker"));
  assert.match(html, /DeLong/);
  assert.ok(!DASH.test(html), "no en or em dashes in app text");
  assert.ok(!/NaN|undefined/.test(html), "no NaN or undefined shown");
});

test("chart draws one curve per test and escapes names", () => {
  const r2 = STATS.roc(rows.map((r) => r.slice()), ["Outcome", "<b>Score</b>", "Marker"], "Outcome", ["<b>Score</b>"], { positiveLevel: "Poor" });
  const s = VIEW.svg(r2);
  assert.ok(!s.includes("<b>"), "test name is escaped");
  assert.ok(s.includes("&lt;b&gt;"));
  const s2 = VIEW.svg(result);
  assert.equal((s2.match(/<path d="M[^"]*" fill="none" stroke="var\(--rmd-/g) || []).length, 2, "two curves");
});

test("paragraph and manuscript text give AUC and CI, no dashes", () => {
  const p = VIEW.paragraph(result);
  const m = VIEW.manuscriptText(result);
  for (const t of [p, m]) {
    assert.ok(typeof t === "string" && t.length > 40);
    assert.match(t, /AUC/);
    assert.match(t, /95%/);
    assert.ok(!DASH.test(t), "no en or em dashes");
    assert.ok(!/NaN|undefined/.test(t));
  }
});

test("CSV rows cover the summary, the comparison and every curve point", () => {
  const lines = VIEW.csvRows(result);
  assert.ok(Array.isArray(lines) && lines.length > 5);
  const flat = lines.map((l) => (Array.isArray(l) ? l.join(",") : String(l))).join("\n");
  assert.match(flat, /Score/);
  assert.match(flat, /Marker/);
  const points = result.tests.reduce((n, t) => n + t.sensitivities.length, 0);
  assert.ok(lines.length >= points, "one row per curve point at least");
  assert.ok(!DASH.test(flat));
});

test("cut-off text never shows Infinity", () => {
  assert.ok(!/Infinity/.test(VIEW.cutStr(Infinity)));
  assert.ok(!/Infinity/.test(VIEW.cutStr(-Infinity)));
  assert.equal(typeof VIEW.cutStr(2.5), "string");
});
