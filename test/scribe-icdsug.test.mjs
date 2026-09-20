import { test } from "node:test"; import assert from "node:assert/strict";
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
const ICD = require("../scribe-icdsug.js");

// Rows shaped exactly like icd.js toRow() output (icd.js:83).
const row = (code, title) => ({ id: "icd10:" + code, system: "ICD-10", code, title, chapter: code.slice(0, 3), is_leaf: 1 });
const HITS = [
  row("J18.9", "Pneumonia, unspecified organism"),
  row("J15.9", "Unspecified bacterial pneumonia"),
  row("J13", "Pneumonia due to Streptococcus pneumoniae"),
  row("J12.9", "Viral pneumonia, unspecified"),
  row("J16.8", "Pneumonia due to other specified infectious organisms"),
  row("J18.1", "Lobar pneumonia, unspecified organism"),
  row("J18.0", "Bronchopneumonia, unspecified organism")
];
const search = (q, limit) => Promise.resolve(HITS.slice(0, limit || 30));

test("returns at most 5 suggestions, in the index's own order", async () => {
  const out = await ICD.suggest("community acquired pneumonia", { search });
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((r) => r.code), ["J18.9", "J15.9", "J13", "J12.9", "J16.8"]);
  out.forEach((r) => {
    assert.equal(typeof r.code, "string");
    assert.equal(typeof r.term, "string");
    assert.ok(r.score >= 0 && r.score <= 1, "score out of range: " + r.score);
  });
});

test("score reflects how much of the dictated diagnosis the term covers", async () => {
  const out = await ICD.suggest("bacterial pneumonia", { search });
  const j159 = out.find((r) => r.code === "J15.9");
  const j129 = out.find((r) => r.code === "J12.9");
  assert.equal(j159.score, 1);                     // "bacterial" + "pneumonia" both present
  assert.ok(j129.score < j159.score, "viral pneumonia must score below bacterial pneumonia");
});

test("max is configurable and the index limit is passed through", async () => {
  let asked = null;
  const spy = (q, limit) => { asked = { q, limit }; return Promise.resolve(HITS); };
  const out = await ICD.suggest("pneumonia", { search: spy, limit: 7, max: 2 });
  assert.equal(out.length, 2);
  assert.deepEqual(asked, { q: "pneumonia", limit: 7 });
});

test("no match returns an empty list, not a guess", async () => {
  assert.deepEqual(await ICD.suggest("something with no code", { search: () => Promise.resolve([]) }), []);
});

test("a search that rejects is handled without throwing", async () => {
  assert.deepEqual(await ICD.suggest("pneumonia", { search: () => Promise.reject(new Error("offline")) }), []);
});

test("a search that throws synchronously is handled without throwing", async () => {
  assert.deepEqual(await ICD.suggest("pneumonia", { search: () => { throw new Error("boom"); } }), []);
});

test("a search that returns junk is handled without throwing", async () => {
  assert.deepEqual(await ICD.suggest("pneumonia", { search: () => Promise.resolve(null) }), []);
  assert.deepEqual(await ICD.suggest("pneumonia", { search: () => "not a promise" }), []);
  const out = await ICD.suggest("pneumonia", { search: () => Promise.resolve([null, {}, row("J18.9", "Pneumonia")]) });
  assert.deepEqual(out.map((r) => r.code), ["J18.9"]);   // rows without a code are skipped
});

test("no search engine injected, and empty input", async () => {
  assert.deepEqual(await ICD.suggest("pneumonia", {}), []);
  assert.deepEqual(await ICD.suggest("pneumonia"), []);
  assert.deepEqual(await ICD.suggest("", { search }), []);
  assert.deepEqual(await ICD.suggest(null, { search }), []);
  assert.deepEqual(await ICD.suggest("   ", { search }), []);
});
