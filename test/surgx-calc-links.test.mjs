/* SURGX -> Calculators deep-link integrity.
 *
 * SURGX deliberately owns NO calculators (product decision): every score chip deep-links into the
 * existing Calculators module via MEDCALC.open(id). calcChips() is fail-soft - an id the catalog
 * does not have is silently skipped - which is the right runtime behaviour but hides authoring
 * mistakes completely. That is exactly how "asa", "iss" and "tbsa" shipped: four procedures and
 * three protocols referenced calculators that do not exist, so those chips just never appeared
 * and nobody saw an error (found 2026-08-24).
 *
 * This test makes the silence audible: every calc id in surgx/ must resolve against the real
 * catalog in calculators.js. It reads the catalog rather than hard-coding a list, so a calculator
 * being renamed or removed upstream fails here instead of silently thinning the surgical chips.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Top-level catalog entries are the ones with a `cat:` immediately after `id:` - nested INPUT
 * fields also use `id:` but never carry `cat:`. That distinction matters: matching input ids too
 * would have made "asa" look valid (it is an input field id inside another calculator) and this
 * test would have passed while the chip stayed broken. */
function catalogIds() {
  const src = readFileSync(join(ROOT, "calculators.js"), "utf8");
  return new Set([...src.matchAll(/\{ *id:"([a-z0-9_]+)", *cat:/g)].map((m) => m[1]));
}

function jsonFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsonFiles(p, out);
    else if (name.endsWith(".json")) out.push(p);
  }
  return out;
}

function calcIdsIn(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) calcIdsIn(v, out); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "calcs" && Array.isArray(v)) out.push(...v);
      else calcIdsIn(v, out);
    }
  }
  return out;
}

test("the calculator catalog parses to a plausible number of entries", () => {
  // Guards the regex itself: if calculators.js changes shape the set would silently empty and
  // every assertion below would pass vacuously.
  const ids = catalogIds();
  assert.ok(ids.size > 300, `expected a few hundred calculators, parsed ${ids.size}`);
  for (const known of ["alvarado", "caprini", "gcs", "parkland", "burn_tbsa"]) {
    assert.ok(ids.has(known), `catalog regex missed a known calculator: ${known}`);
  }
});

test("every calculator SURGX deep-links to actually exists", () => {
  const ids = catalogIds();
  const broken = [];
  for (const file of jsonFiles(join(ROOT, "surgx"))) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    for (const id of new Set(calcIdsIn(data))) {
      if (!ids.has(id)) broken.push(`${file.slice(ROOT.length + 1)} -> "${id}"`);
    }
  }
  assert.deepEqual(broken, [], "SURGX references calculators that are not in the catalog:\n  " + broken.join("\n  "));
});

test("SURGX never references a calculator input-field id by mistake", () => {
  // "asa" and "bili" are input ids INSIDE other calculators. Referencing one renders no chip.
  const ids = catalogIds();
  for (const fieldOnly of ["asa", "bili", "creat", "inr"]) {
    assert.ok(!ids.has(fieldOnly), `${fieldOnly} is an input field, not a calculator - catalog regex is too loose`);
  }
});
