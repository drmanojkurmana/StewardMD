import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const cfg = JSON.parse(readFileSync(new URL("../prep/figures/figures.json", import.meta.url), "utf8"));
function load() {
  const doc = { getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, querySelector: () => null, addEventListener() {}, classList: { toggle() {}, contains: () => true } }), head: { appendChild() {} }, body: { classList: { contains: () => true }, appendChild() {} }, addEventListener() {}, removeEventListener() {} };
  const win = { document: doc, fetch: async () => ({ ok: true, json: async () => cfg }), SMD_PREP_BASE: "/prep/", innerWidth: 390 };
  win.window = win;
  vm.runInNewContext(readFileSync(new URL("../fig-viewer.js", import.meta.url), "utf8"), win);
  return win.SMD_FIG;
}
test("registry: figures.json is well formed", () => {
  const ids = new Set();
  for (const f of cfg.figures) {
    assert.match(f.id, /^[a-z0-9-]{2,40}$/); assert.ok(!ids.has(f.id), "unique id " + f.id); ids.add(f.id);
    assert.match(f.page, /^prep\/figures\/[a-z0-9-]{2,60}\.html$/);
    assert.ok(Object.keys(f.drugs).length > 0, f.id + " names drugs");
    for (const k of Object.keys(f.drugs)) assert.match(k, /^[a-z]+$/, "drug key is one lower-case word: " + k);
  }
});
test("registry: text match for drugs, class phrases and nothing else", async () => {
  const F = load(); await F.ready();
  assert.equal(F.matchText("A 60-year-old on metoprolol develops bradycardia")[0].id, "beta-blockers");
  assert.match(F.matchText("Which beta blocker is cardioselective? Atenolol")[0].query, /^d=2&name=Atenolol$/);
  assert.equal(F.matchText("Metoprolol versus propranolol in asthma")[0].hits, 2);
  assert.equal(F.matchText("Amlodipine blocks L-type calcium channels").length, 0);
  assert.equal(F.matchText("the word metoprololic is not a drug").length, 0, "whole words only");
  assert.equal(F.forDrug("Metoprolol succinate").query, "d=2&name=Metoprolol");
  assert.equal(F.forDrug("Amlodipine"), null);
});
test("registry: chip html is escaped", async () => {
  const F = load(); await F.ready();
  const h = F.chipHtml({ id: "x", title: '<b>"', query: 'a"b' });
  assert.ok(!/<b>"/.test(h.replace("<b>&lt;b&gt;&quot;</b>", "")), h);
});
