import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
    assert.match(f.id, /^[a-z0-9-]{2,60}$/); assert.ok(!ids.has(f.id), "unique id " + f.id); ids.add(f.id);
    assert.match(f.page, /^prep\/figures\/[a-z0-9-]{2,60}\.html$/);
    assert.ok(f.scene || Object.keys(f.drugs).length > 0, f.id + " names drugs");
    for (const k of Object.keys(f.drugs)) assert.match(k, /^[a-z]+$/, "drug key is one lower-case word: " + k);
  }
});
test("registry: text match for drugs, class phrases and nothing else", async () => {
  const F = load(); await F.ready();
  assert.equal(F.matchText("A 60-year-old on metoprolol develops bradycardia")[0].id, "beta-blockers");
  assert.match(F.matchText("Which beta blocker is cardioselective? Atenolol")[0].query, /^d=2&name=Atenolol$/);
  assert.equal(F.matchText("Metoprolol versus propranolol in asthma")[0].hits, 2);
  assert.equal(F.matchText("Bosentan versus ranibizumab for this patient").length, 0);
  assert.equal(F.matchText("the word metoprololic is not a drug").length, 0, "whole words only");
  assert.equal(F.forDrug("Metoprolol succinate").query, "d=2&name=Metoprolol");
  assert.equal(F.forDrug("Paracetamol"), null);
});
test("registry: chip html is escaped", async () => {
  const F = load(); await F.ready();
  const h = F.chipHtml({ id: "x", title: '<b>"', query: 'a"b' });
  assert.ok(!/<b>"/.test(h.replace("<b>&lt;b&gt;&quot;</b>", "")), h);
});

test("registry: every figure has its dark and light page, a spec, and a licence notice", () => {
  for (const f of cfg.figures) {
    assert.ok(existsSync(new URL("../" + f.page, import.meta.url)), f.id + " dark page");
    assert.ok(existsSync(new URL("../" + f.page.replace(/\.html$/, "-light.html"), import.meta.url)), f.id + " light page");
    assert.ok(existsSync(new URL("../tools/figures/specs/" + f.id + ".json", import.meta.url)), f.id + " spec");
    const html = readFileSync(new URL("../" + f.page, import.meta.url), "utf8");
    assert.match(html, /Anima/, f.id + " credits the Anima kit");
    assert.ok(!/<script[^>]+src=/.test(html), f.id + " loads no external script");
    assert.ok(!/\u2014|\u2013/.test(html.replace(/<style[\s\S]*?<\/style>/g, "")), f.id + " has no em or en dash in its text");
  }
});
test("registry: drugs shared by two figures list both", async () => {
  const F = load(); await F.ready();
  assert.ok(F.forDrugs("spironolactone").length >= 2, "spironolactone is in the RAAS and the diuretics figures");
  assert.equal(F.forDrugs("furosemide")[0].id, "diuretics");
  assert.equal(F.forDrugs("enalapril")[0].id, "raas");
  assert.equal(F.matchText("Aspirin and clopidogrel after stenting", 1)[0].id, "antiplatelets");
  assert.equal(F.matchText("Rivaroxaban versus warfarin", 1)[0].id, "anticoagulants");
});

test("registry: ambiguous drug names need their context, common words never match", async () => {
  const F = load(); await F.ready();
  assert.equal(F.matchText("Lidocaine is used for local infiltration before a procedure", 3).filter((m) => m.id === "antiarrhythmics").length, 0, "lidocaine alone is not an arrhythmia question");
  assert.equal(F.matchText("Lidocaine for ventricular tachycardia after myocardial infarction", 3).filter((m) => m.id === "antiarrhythmics").length, 1);
  for (const w of ["Hypokalaemia with potassium loss", "The state of the art", "Lithium toxicity causes tremor", "iodide uptake in the thyroid cell"]) {
    const ms = F.matchText(w, 5).filter((m) => m.id === "thyroid-drugs" || m.id === "antiretrovirals");
    assert.equal(ms.length, 0, w);
  }
});

test("build-www ships the registry beside the figure pages (native app has no other way to read it)", () => {
  const sh = readFileSync(new URL("../scripts/build-www.sh", import.meta.url), "utf8");
  assert.match(sh, /cp prep\/figures\/\*\.html prep\/figures\/figures\.json /);
});
