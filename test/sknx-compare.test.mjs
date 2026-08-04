import { test } from "node:test";
import assert from "node:assert";
import CMP from "../sknx-compare.js";

test("compare(psoriasis, tinea) returns aligned rows with feature/a/b and echoes labels", () => {
  const c = CMP.compare("psoriasis", "tinea");
  assert.ok(c.rows.length >= 3, "expected >=3 rows, got " + c.rows.length);
  for (const row of c.rows) {
    assert.ok(typeof row.feature === "string" && row.feature.length > 0);
    assert.ok("a" in row && "b" in row);
  }
  assert.equal(c.a, "psoriasis");
  assert.equal(c.b, "tinea");
});

test("compare handles synonyms: basal cell carcinoma vs squamous cell carcinoma", () => {
  const c = CMP.compare("basal cell carcinoma", "squamous cell carcinoma");
  assert.ok(c.rows.length >= 3, "expected >=3 rows, got " + c.rows.length);
});

test("sources are citation-integral: non-empty urls, deduplicated", () => {
  const c = CMP.compare("psoriasis", "tinea");
  assert.ok(c.sources.length >= 1, "expected at least one source");
  const urls = c.sources.map((s) => s.url);
  for (const url of urls) {
    assert.ok(url && String(url).trim().length > 0, "expected non-empty url");
  }
  assert.equal(urls.length, new Set(urls).size, "expected unique urls");
});

test("html(cmp) renders a table with both labels, a source link, and no Rx language", () => {
  const c = CMP.compare("psoriasis", "tinea");
  const h = CMP.html(c);
  assert.match(h, /<table/);
  assert.match(h, /Psoriasis/);
  assert.match(h, /Tinea/);
  assert.match(h, /<a href=/);
  assert.doesNotMatch(h, /sknx-rx/);
  assert.doesNotMatch(h, /prescription/i);
  assert.doesNotMatch(h, /prescribe/i);
});

test("compare(melanoma, nevus) returns aligned rows", () => {
  const c = CMP.compare("melanoma", "nevus");
  assert.ok(c.rows.length >= 3, "expected >=3 rows, got " + c.rows.length);
});

test("unknown pair never throws and returns a non-empty row skeleton", () => {
  const c = CMP.compare("zzz", "qqq");
  assert.ok(c.rows.length >= 1);
});
