#!/usr/bin/env node
/* Build the SEARCH INDEX for the bundled offline clinical dataset.
 * =============================================================================
 * WHY THIS EXISTS
 * data/offline-clinical.json.gz carries a full authored monograph for 1,541 molecules, and
 * offline-clinical.js already serves them to the drug detail screen. But NOTHING could search
 * them: api.js asked the server, and when the server came back empty it fell through to the
 * 109-molecule hand-curated formulary in drugs.js. So a molecule with a complete monograph but
 * no Indian brand row — Plazomicin, Cefiderocol, and the 68 others named in
 * worker/scripts/import_gold_to_d1.mjs — answered "No drugs match", which is what QA reported.
 *
 * Searching could not just read the bundle: it is 6 MB gzipped / 13 MB parsed, far too much to
 * load on a keystroke. So this emits the small part search actually needs — name, class, tags —
 * as its own file the client loads once (~250 KB) and keeps. The monograph itself still comes
 * from the gz, lazily, only when a molecule is opened.
 *
 * It reads the SHIPPED bundle rather than rebuilding from SQL, so the index can never list a
 * molecule the bundle cannot then open. Every string is copied verbatim.
 *
 * Run: node scripts/build-clinical-index.mjs   (after scripts/build-offline-clinical.mjs)
 * Out: data/clinical-index.js  → window.SMD_CLINICAL_INDEX
 * ========================================================================== */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "data", "offline-clinical.json.gz");
const SUP = join(ROOT, "data", "clinical-supplement.json.gz");
const OUT = join(ROOT, "data", "clinical-index.js");

function readGz(p) { return JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")); }

const bundle = readGz(SRC);
// The supplement (scripts/build-clinical-supplement.mjs) carries the authored monographs the
// SQL-derived bundle never had. offline-clinical.js merges it at runtime, so the index must list
// it too -- otherwise those molecules stay unfindable, which is the whole bug.
let supplement = { struct: {} };
try { supplement = readGz(SUP); } catch { console.warn("no clinical-supplement.json.gz; index covers the bundle only"); }

const struct = Object.assign({}, bundle.struct || {}, supplement.struct || {});
const mono = bundle.mono || {};

function trim(s, n) {
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/* SYNONYMS.
 * The index was keyed only by the composition name, so a drug was findable under one spelling and
 * invisible under the others. Typing "Aciclovir" found nothing; "Epinephrine" returned
 * NOREPINEPHRINE, a different drug with different indications, because the only thing that matched
 * was a loose substring of another row's name. That is a search defect with clinical consequences,
 * not a cosmetic one.
 *
 * The corpus already carries the alternates: worker/data/gold/ writes them into `generic` inside
 * parentheses -- "Adrenaline (Epinephrine)", "Acyclovir (Aciclovir)",
 * "Ademetionine (S-adenosyl-L-methionine, SAMe)". This pulls them out and indexes them as alias
 * keys on the row they belong to, so an exact alias beats any partial match on another molecule. */
function aliasesFrom(name) {
  const out = [];
  const m = /^([^(]+)\(([^)]*)\)\s*$/.exec(String(name || "").trim());
  if (!m) return out;
  const inner = m[2];
  // "S-adenosyl-L-methionine, SAMe" -> both; "conventional deoxycholate and lipid/liposomal
  // formulations" -> prose, not a name, so anything with a space-heavy clause is dropped below.
  for (let part of inner.split(/,|\bor\b/)) {
    part = part.replace(/\s+/g, " ").trim();
    if (!part) continue;
    if (part.split(" ").length > 4) continue;            // a description, not an alternate name
    if (/^(and|with|including|e\.g\.?|etc\.?)$/i.test(part)) continue;
    out.push(part);
  }
  return out;
}

// gold `generic` strings carry the alternates; map them onto the bundle key they belong to.
const aliasByBase = new Map();
try {
  const goldDir = join(ROOT, "worker", "data", "gold");
  for (const f of readdirSync(goldDir).filter((x) => x.endsWith(".json"))) {
    let g;
    try { g = JSON.parse(readFileSync(join(goldDir, f), "utf8")); } catch { continue; }
    const full = String(g.generic || "").trim();
    const base = full.replace(/\s*\(.*$/, "").trim();
    if (!base) continue;
    const al = aliasesFrom(full);
    if (!al.length) continue;
    const k = base.toLowerCase();
    aliasByBase.set(k, [...new Set([...(aliasByBase.get(k) || []), ...al])]);
  }
} catch { /* no gold dir: the index simply ships without aliases */ }

const rows = [];
for (const key of Object.keys(struct)) {
  const rec = struct[key] || {};
  let g = null;
  if (rec.gold) { try { g = JSON.parse(rec.gold); } catch { g = null; } }
  // The composition key is what offline-clinical.js looks up, so it is what the row must carry.
  const baseKey = key.replace(/\s*\(.*$/, "").trim().toLowerCase();
  const alias = [...new Set([
    ...(aliasByBase.get(baseKey) || []),
    ...aliasesFrom(key)                       // the bundle key may carry its own parenthetical
  ])].filter((x) => x.toLowerCase() !== key.toLowerCase());

  rows.push({
    n: key,
    a: alias,
    c: trim((g && g.cls) || rec.class || "", 90),
    t: (g && Array.isArray(g.tags) ? g.tags : []).map(String),   // uncapped: the whole list costs ~1 KB, and the specific tags sit at its tail
    m: mono[key] ? 1 : 0                       // also has an openFDA monograph
  });
}
rows.sort((a, b) => a.n.localeCompare(b.n));

const header = `/* data/clinical-index.js — GENERATED by scripts/build-clinical-index.mjs. Do not edit by hand.
 *
 * The searchable names of the ${rows.length} molecules inside data/offline-clinical.json.gz: name,
 * class and tags only. It exists so the Drugs Database can FIND a molecule whose monograph we
 * already ship but whose Indian brand catalogue has no row for it (Plazomicin, Cefiderocol and the
 * rest) instead of answering "No drugs match". Opening one still loads the monograph from the gz.
 *
 * Every string is copied verbatim from the authored record: a paraphrased class is a new claim.
 * window.SMD_CLINICAL_INDEX = { all, search, has, count }.
 */
`;

const body = `(function () {
  "use strict";
  var R = ${JSON.stringify(rows)};

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  /* The bundle lists a molecule under its plain name, and the supplement no longer ships the salt
   * form as a second row (scripts/build-clinical-supplement.mjs). A doctor still types the salt, so
   * a query that finds nothing is retried with the counter-ion removed: "Atropine sulfate" -> the
   * Atropine row. Stripping only ever happens on the QUERY, never on the stored names, so two
   * genuinely distinct products that differ by salt stay separate rows and both remain findable. */
  var SALT = /\\s+(sodium|potassium|calcium|disodium|hydrochloride|hcl|sulfate|sulphate|acetate|citrate|tartrate|maleate|besilate|besylate|mesylate|mesilate|phosphate|succinate|fumarate|bisulfate|bitartrate|dipropionate|propionate|valerate|furoate|tromethamine|pivoxil|axetil|etexilate|decanoate|palmitate|monohydrate|dihydrate|xinafoate|bromide|chloride|nitrate|oxide|gluconate|lactate|malate|oxalate|pamoate|stearate|trometamol)$/;
  function deSalt(q) { var t = String(q || "").replace(SALT, "").trim(); return t && t !== q ? t : ""; }
  function all() { return R.slice(); }
  function count() { return R.length; }
  function has(name) { return !!get(name); }
  /* Exact lookup by name. api.js compClass() uses it to show a molecule's authored class, so it
   * matches the way a composition is written in the brand catalogue as well as the plain name:
   * "Ceftriaxone (1000mg)" and "ceftriaxone" both resolve to the Ceftriaxone row. */
  function aliasHit(q) {
    for (var i = 0; i < R.length; i++) {
      var al = R[i].a || [];
      for (var j = 0; j < al.length; j++) if (norm(al[j]) === q) return R[i];
    }
    return null;
  }
  function get(name) {
    var q = norm(name);
    if (!q) return null;
    for (var i = 0; i < R.length; i++) if (norm(R[i].n) === q) return R[i];
    var ax = aliasHit(q);
    if (ax) return ax;
    var base = q.replace(/\\s*\\(.*?\\)\\s*/g, " ").replace(/\\s+\\d+(?:\\.\\d+)?\\s*(?:mg|mcg|g|ml|iu|units?)\\b/g, " ").replace(/\\s+/g, " ").trim();
    if (base && base !== q) { for (var j = 0; j < R.length; j++) if (norm(R[j].n) === base) return R[j]; }
    var ds = deSalt(base || q);
    if (ds) { for (var k = 0; k < R.length; k++) if (norm(R[k].n) === ds) return R[k]; }
    return null;
  }

  /* Ranked the way a doctor expects: an exact name, then a name that starts with what was typed,
   * then a word inside the name, then anywhere in the name, then the class, then a tag. */
  function search(q, limit) {
    var nq = norm(q);
    if (!nq) return [];
    var out = [];
    for (var i = 0; i < R.length; i++) {
      var r = R[i], n = norm(r.n), s = -1;
      var al = r.a || [], aExact = false, aPrefix = false;
      for (var k = 0; k < al.length; k++) {
        var na = norm(al[k]);
        if (na === nq) { aExact = true; break; }
        if (na.indexOf(nq) === 0) aPrefix = true;
      }
      // An exact alias ties with an exact name, and both outrank ANY partial match on another
      // molecule. That ordering is the fix: "Epinephrine" used to lose to a loose substring of
      // "Norepinephrine" and return the wrong drug.
      if (n === nq || aExact) s = 0;
      else if (n.indexOf(nq) === 0 || aPrefix) s = 1;
      else if ((" " + n).indexOf(" " + nq) >= 0) s = 2;
      else if (n.indexOf(nq) >= 0) s = 3;
      else if (norm(r.c).indexOf(nq) >= 0) s = 4;
      else { for (var j = 0; j < r.t.length; j++) { if (norm(r.t[j]).indexOf(nq) >= 0) { s = 5; break; } } }
      if (s >= 0) out.push({ r: r, s: s });
    }
    out.sort(function (a, b) { return a.s - b.s || a.r.n.length - b.r.n.length || a.r.n.localeCompare(b.r.n); });
    if (!out.length) { var ds = deSalt(nq); if (ds) return search(ds, limit); }
    return out.slice(0, limit || 25).map(function (x) { return x.r; });
  }

  var API = { all: all, search: search, has: has, get: get, count: count, VERSION: ${JSON.stringify(bundle.generated || "")} };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINICAL_INDEX = API;
})();
`;

writeFileSync(OUT, header + body);
console.log(`data/clinical-index.js: ${rows.length} molecules, ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
const probe = ["Cefiderocol", "Atropine sulfate", "Enoxaparin sodium", "Pantoprazole"];
console.log("sanity — " + probe.map((p) => p + ": " + rows.some((r) => r.n === p)).join(", "));
