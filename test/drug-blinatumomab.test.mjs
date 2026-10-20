/* Blinatumomab must open as a standard polished monograph, not a raw-label dump.
 *
 * The drug had no authored gold record, so the detail screen fell through to the
 * verbatim FDA-label fallback: a lowercase title, two Quick Facts, blank
 * pregnancy/lactation, renal/hepatic and PK cards (the renderer prints an em dash
 * for every missing field), and no surfaced mechanism scene. The fix is data: an
 * authored worker/data/gold/Blinatumomab.json in the canonical gold schema,
 * shipped through the clinical supplement + index like the other
 * no-Indian-brand molecules (Belzutifan precedent).
 *
 * These tests pin the contract the renderer needs: every section the template
 * reads is populated, nothing renders a blank placeholder, the search index
 * carries the title-cased name with its class, and the registered mechanism
 * scene resolves from the monograph's drug name through the generic figure path.
 * node --test test/drug-blinatumomab.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const require = createRequire(import.meta.url);
const I = require("../data/clinical-index.js");

const GOLD_PATH = join(ROOT, "worker", "data", "gold", "Blinatumomab.json");
const g = JSON.parse(readFileSync(GOLD_PATH, "utf8"));
const LABEL = JSON.parse(readFileSync(join(ROOT, "data", "fda-labels", "blinatumomab.json"), "utf8"));

/* The authored fields only: the verbatim label copy is the FDA's text, not ours. */
function authored(o) {
  if (Array.isArray(o)) return o.map(authored);
  if (o && typeof o === "object") {
    const out = {};
    for (const k of Object.keys(o)) { if (k !== "label") out[k] = authored(o[k]); }
    return out;
  }
  return o;
}
const AUTHORED_TEXT = JSON.stringify(authored(g));

/* ─────────────────────────── the canonical sections ─────────────────────────── */

test("the gold record carries every section the monograph template reads", () => {
  assert.equal(g.generic, "Blinatumomab");
  assert.ok(g.cls && g.cls.length > 10, "class chip text");
  assert.ok(Array.isArray(g.tags) && g.tags.includes("Blincyto"), "brand alias is a tag: " + g.tags.join(", "));
  assert.ok(g.summary && g.summary.length > 200, "educational summary");
  assert.ok(g.indications && g.indications.length === 3, "the three labeled indications");
  for (const r of g.dosage) {
    for (const k of ["c", "r", "d", "t", "n"]) assert.equal(typeof r[k], "string", "dosage row needs " + k);
    assert.ok(r.d.length > 10, "dose cell is not a stub: " + r.c);
  }
  assert.ok(g.admin && g.admin.length >= 4, "labelled administration");
  assert.ok(g.moa && /CD19/.test(g.moa) && /CD3/.test(g.moa), "mechanism names both targets");
  for (const k of ["absolute", "relative", "monitor"]) assert.ok(g.contra && g.contra[k] && g.contra[k].length, "contra." + k);
  assert.ok(g.se && g.se.common.length && g.se.serious.length && g.se.rare.length && g.se.emergency.length, "all four side-effect bands");
  assert.ok(g.monitoring && g.monitoring.length >= 4, "monitoring");
  assert.ok(g.counsel && g.counsel.length >= 4, "counselling");
  assert.ok(g.pk && g.pk.length >= 4, "pharmacokinetics");
  assert.ok(g.pearls && g.pearls.length, "pearls");
  assert.ok(g.missed && g.overdose, "missed-dose and overdose");
});

/* ─────────────────────────── no blank placeholder cards ─────────────────────────── */

test("no section falls back to the renderer's em-dash placeholder", () => {
  // api.js goldHTML() prints an em dash for a missing preg/lact/renal/hepatic/food/alcohol.
  assert.equal(g.quick.length, 8, "eight quick facts, not the two-row label stub (had " + g.quick.length + ")");
  for (const [k, v] of g.quick) assert.ok(v && v.length > 5, "quick fact " + k + " is populated");
  for (const k of ["preg", "lact", "renal", "hepatic"]) assert.ok(g[k] && g[k].length > 40, k + " states the label position plainly");
  assert.ok(g.interactions.food && g.interactions.alcohol, "food and alcohol state their position");
  assert.ok(!/[—–]/.test(AUTHORED_TEXT), "no em or en dash in authored text");
  assert.ok(!/no data|unknown/i.test(g.summary), "the summary does not hedge; unknowns live in their own cards");
});

/* ─────────────────────────── label fidelity, no invention ─────────────────────────── */

test("the full FDA label rides along verbatim as the lower reference section", () => {
  assert.ok(g.label && typeof g.label === "object", "label object present");
  assert.deepEqual(Object.keys(g.label).sort(), Object.keys(LABEL.label).sort(), "every label section, none added or dropped");
  for (const k of Object.keys(LABEL.label)) assert.equal(g.label[k], LABEL.label[k], k + " is verbatim");
  const refs = (g.refs || []).map((r) => r[1]).join(" ");
  assert.ok(/38b482a8-960b-4591-9857-5031ecb830aa/.test(refs), "refs cite the DailyMed setid");
  assert.ok(/Apr 22, 2026/.test((g.refs || []).map((r) => r[0]).join(" ") + g.footer), "source date is cited");
});

test("key label facts are in the monograph with label-accurate numbers", () => {
  const body = AUTHORED_TEXT.toLowerCase();
  for (const fact of ["28 mcg/day", "9 mcg/day", "45 kg", "15 mcg/m2/day",
    "cytokine release syndrome", "icans", "boxed warning",
    "28-day continuous", "14-day", "intrathecal",
    "benzyl-alcohol", "gasping syndrome", "48 hours", "5 mg/m2"]) {
    assert.ok(body.includes(fact), "monograph states: " + fact);
  }
  assert.ok(/hypersensitivity to blinatumomab/i.test(body), "the one labeled contraindication");
});

/* ─────────────────────────── findable under its proper name ─────────────────────────── */

test("the search index lists Blinatumomab title-cased, classed and tagged", () => {
  const row = I.get("blinatumomab");
  assert.ok(row, "resolves case-insensitively");
  assert.equal(row.n, "Blinatumomab", "title case, not the lowercase label stub");
  assert.ok(/bispecific|CD19/i.test(row.c), "class chip text: " + row.c);
  assert.ok(row.t.includes("Blincyto"), "brand tag present");
  assert.equal(I.search("blinatum", 5)[0].n, "Blinatumomab", "a partial name finds it first");
  assert.equal(I.search("Blincyto", 10).filter((r) => r.n === "Blinatumomab").length, 1, "the brand reaches the molecule");
});

test("the supplement ships the authored record and no lowercase duplicate remains", () => {
  const sup = JSON.parse(gunzipSync(readFileSync(join(ROOT, "data", "clinical-supplement.json.gz"))).toString("utf8"));
  assert.ok(sup.struct["Blinatumomab"], "supplement carries it");
  const shipped = JSON.parse(sup.struct["Blinatumomab"].gold);
  assert.equal(shipped.generic, "Blinatumomab");
  assert.ok(shipped.summary && shipped.dosage && shipped.moa, "the shipped copy is the full record");
  assert.equal(sup.struct["blinatumomab"], undefined, "the lowercase label stub is gone from the openable set");
  assert.equal(I.all().filter((r) => r.n === "Blinatumomab").length, 1, "listed exactly once");
});

/* ─────────────────────────── server parity: the D1 importer allowlist ─────────────────────────── */

test("the D1 importer allowlist includes the gold record (server /structured parity)", () => {
  // worker/scripts/import_gold_to_d1.mjs carries an explicit include list (drugs with no
  // Indian brand have no D1 drugs row, so the server only learns them from this list).
  // Without the entry, /structured?name=Blinatumomab answers found:false on the server
  // while the app opens the full monograph offline.
  const src = readFileSync(join(ROOT, "worker", "scripts", "import_gold_to_d1.mjs"), "utf8");
  assert.ok(src.includes('"Blinatumomab"'), "Blinatumomab is in the importer include list");
  assert.ok(existsSync(join(ROOT, "worker", "data", "gold", "Blinatumomab.json")),
    "the listed gold file exists at worker/data/gold/Blinatumomab.json");
});

/* ─────────────────────────── the mechanism scene resolves ─────────────────────────── */

test("the registered mechanism scene resolves from the monograph drug name", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT, "prep", "figures", "figures.json"), "utf8"));
  const entry = cfg.figures.find((f) => f.id === "blinatumomab-mechanism-adverse-effects");
  assert.ok(entry, "scene is registered");
  // fig-viewer.js forDrugs(): the generic's first word, lowercased, against the drugs map.
  const first = String(g.generic).toLowerCase().split(/[^a-z]+/)[0];
  assert.ok(entry.drugs[first], "the monograph name hits the scene's drug key: " + first);
  const src = readFileSync(join(ROOT, "api.js"), "utf8");
  assert.ok(src.includes("function figCardLate"), "the detail screen re-checks for a figure once the registry is ready");
  assert.ok(/\.ready\(\)\.then/.test(src), "the re-check waits for the async registry");
});
