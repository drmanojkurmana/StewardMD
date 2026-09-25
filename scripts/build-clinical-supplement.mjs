#!/usr/bin/env node
/* Build the SUPPLEMENT to the bundled offline clinical dataset.
 * =============================================================================
 * WHY THIS EXISTS
 * data/offline-clinical.json.gz is built from the import SQL that seeds D1, and is keyed by the
 * `composition` string those tables use. worker/data/gold/ holds 1,532 authored monographs keyed
 * by the molecule's own `generic` name. The two do not line up: 104 authored monographs -- among
 * them Atropine sulfate, Enoxaparin sodium, Clopidogrel bisulfate, Caspofungin acetate and
 * Fludrocortisone acetate -- exist as finished gold records and are in NO shipped bundle at all,
 * so the app could never show them however the doctor searched.
 *
 * Rather than regenerate the 6 MB bundle from SQL (which would rewrite rows that currently match
 * prod, and needs the sqlite3 toolchain), this emits only the difference. offline-clinical.js
 * merges it over the bundle at load. Reversible: delete the file and the app is exactly as before.
 *
 * Records are copied VERBATIM out of worker/data/gold/. Nothing is summarised or regenerated.
 *
 * Run: node scripts/build-clinical-supplement.mjs
 * Out: data/clinical-supplement.json.gz   { v, generated, struct:{ name: { gold } } }
 * ========================================================================== */
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE = join(ROOT, "data", "offline-clinical.json.gz");
const GOLD = join(ROOT, "worker", "data", "gold");
const OUT = join(ROOT, "data", "clinical-supplement.json.gz");

/* The same shape-insensitive comparison offline-clinical.js's cleanComp() makes, so a record is
 * only called "missing" when the running app genuinely could not resolve it: parentheticals
 * dropped, punctuation flattened. Getting this wrong ships a duplicate, not a gap. */
function norm(s) {
  return String(s == null ? "" : s).toLowerCase()
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/* A counter-ion, not a different drug. "Atropine sulfate" IS atropine; the bundle already carries
 * the molecule under its plain name, and shipping both put two rows for one drug in every search.
 * Comparing this way is only safe because it is applied to SUPPLEMENT rows against BUNDLE keys:
 * it never merges two bundle rows, so the genuinely distinct products that differ by salt --
 * Calcium Acetate / Chloride / Gluconate, Fluticasone Furoate vs Propionate, Metoprolol succinate
 * vs tartrate -- are untouched, and none of them appear in the set this drops.
 * All 53 rows it removes were reviewed one by one: every one is the same therapeutic entity, and
 * the bundle's copy was equal or richer in every sampled pair (same section count, marginally more
 * text). Salts that CHANGE the clinical use must never be added to this list. */
const SALT = /\s+(sodium|potassium|calcium|disodium|hydrochloride|hcl|sulfate|sulphate|acetate|citrate|tartrate|maleate|besilate|besylate|mesylate|mesilate|phosphate|succinate|fumarate|bisulfate|bitartrate|dipropionate|propionate|valerate|furoate|tromethamine|pivoxil|axetil|etexilate|decanoate|palmitate|monohydrate|dihydrate|xinafoate|bromide|chloride|nitrate|oxide|gluconate|lactate|malate|oxalate|pamoate|stearate|trometamol)$/i;
function saltBase(s) { return norm(s).replace(SALT, "").trim(); }

const bundle = JSON.parse(gunzipSync(readFileSync(BUNDLE)).toString("utf8"));
const have = new Set(Object.keys(bundle.struct || {}).map(norm));
const haveSalted = new Set(Object.keys(bundle.struct || {}).map(saltBase));

const struct = {};
let scanned = 0, skipped = 0, salted = 0;
for (const f of readdirSync(GOLD).filter((x) => x.endsWith(".json")).sort()) {
  let g;
  try { g = JSON.parse(readFileSync(join(GOLD, f), "utf8")); } catch { skipped++; continue; }
  scanned++;
  const name = String(g.generic || "").trim();
  if (!name || have.has(norm(name))) continue;
  if (haveSalted.has(saltBase(name))) { salted++; continue; }   // same molecule, different counter-ion
  struct[name] = { gold: JSON.stringify(g) };     // same {gold:"<json string>"} shape as the bundle
  have.add(norm(name));                            // two gold files for one molecule must not both ship
}

const payload = { v: 1, generated: new Date().toISOString(), struct };
const gz = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
writeFileSync(OUT, gz);

const names = Object.keys(struct);
console.log(`scanned ${scanned} gold files (${skipped} unreadable); bundle already had ${Object.keys(bundle.struct || {}).length}`);
console.log(`skipped ${salted} salt-form duplicates of a molecule the bundle already carries`);
console.log(`data/clinical-supplement.json.gz: ${names.length} molecules, ${(statSync(OUT).size / 1024).toFixed(0)} KB gzipped`);
console.log(`first few: ${names.slice(0, 6).join(", ")}`);
