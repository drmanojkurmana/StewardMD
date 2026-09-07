/* rx-brand-match.js — the Rx brand field's matching rules.
 *
 * The reported disparity, in one sentence: the Drugs Database found "Augmentin" instantly while the
 * prescription pad's Brand field found nothing, on the same backend. The pad resolved the typed DRUG
 * to a composition and filtered that molecule's brands; it never queried the brand-name endpoint the
 * Drugs Database also uses. So a drug field holding a clinical shorthand the composition index does
 * not carry ("Amoxiclav") made every brand unreachable - and the empty state still read "Type the
 * drug first" when a drug plainly was typed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const B = require("../rx-brand-match.js");

const brand = (n, extra) => Object.assign({ brand: n }, extra || {});
const MOLECULE = [brand("Clavam 625"), brand("Moxikind-CV 625"), brand("Augmentin 625 Duo Tablet")];
const BY_NAME = [brand("Augmentin 625 Duo Tablet"), brand("Augmentin 375 Tablet"), brand("Augmentin DDS Suspension")];
const names = (a) => a.map((b) => b.brand);

test("with no molecule brands at all, a brand-name hit still shows (the reported bug)", () => {
  // "Amoxiclav" resolves to no composition, so the molecule list is empty. Before the fix this was a
  // dead end no matter what the clinician typed.
  const out = B.merge([], BY_NAME, "augmen");
  assert.deepEqual(names(out), ["Augmentin 625 Duo Tablet", "Augmentin 375 Tablet", "Augmentin DDS Suspension"]);
});

test("molecule brands still lead, and are filtered by what is typed", () => {
  const out = B.merge(MOLECULE, [], "clav");
  assert.deepEqual(names(out), ["Clavam 625"], "only the molecule brands matching the query");
  assert.deepEqual(names(B.merge(MOLECULE, [], "")), names(MOLECULE), "no query means the whole molecule list");
});

test("the two sources are merged without duplicating a brand present in both", () => {
  const out = B.merge(MOLECULE, BY_NAME, "augmen");
  assert.deepEqual(names(out), ["Augmentin 625 Duo Tablet", "Augmentin 375 Tablet", "Augmentin DDS Suspension"],
    "Augmentin 625 appears once, from the molecule list, and the name hits follow");
});

test("de-duplication is case-insensitive and survives junk entries", () => {
  const out = B.merge([brand("AUGMENTIN 625 Duo Tablet")], [brand("augmentin 625 duo tablet"), brand(""), null], "aug");
  assert.equal(out.length, 1, "one brand, whatever the casing");
});

test("the empty state never claims the drug field is blank when it is not", () => {
  assert.match(B.emptyMessage("Amoxiclav", "augmen", false), /No brand matches/,
    "a typed brand that matched nothing says so");
  assert.match(B.emptyMessage("Amoxiclav", "", false), /No brands found/,
    "a drug with no brands at all says THAT, not 'type the drug first'");
  assert.equal(B.emptyMessage("", "", false), "Type the drug first, then tap here for brands",
    "the original guidance is still correct when the drug field really is empty");
  assert.equal(B.emptyMessage("Amoxiclav", "aug", true), "Searching…", "in-flight beats every other message");
});

test("a brand search is only issued once the query is selective", () => {
  assert.equal(B.shouldSearchBrands("au"), false, "two characters would match half the market");
  assert.equal(B.shouldSearchBrands("aug"), true);
  assert.equal(B.shouldSearchBrands("  augmen  "), true, "padding does not count");
  assert.equal(B.shouldSearchBrands(""), false);
  assert.equal(B.shouldSearchBrands(null), false);
});

/* Both drug search bars must sit on the SAME database.
 *
 * The prescription pad searched MEDDRUGS.searchIndex alone - the on-device ward formulary, ~70
 * drugs - so most molecules "were not in the database" when typed there, while ICU's Add Treatment
 * search found them at once against the server composition index. One app, two search bars, two
 * different datasets, and nothing on screen telling a doctor which one they were looking at.
 */
test("the prescription pad searches the server drug database, not just the local formulary", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../prescription.js", import.meta.url), "utf8");

  assert.match(src, /MEDAPI\.searchCompositions/, "the pad queries the server composition index");
  assert.match(src, /function paintList/, "local and server hits are painted through one list");

  // Local first: it is the only thing that answers with no signal, and it carries doses and real
  // brand names. Server molecules fill in behind it, deduped so nothing appears twice.
  const ac = src.slice(src.indexOf("function acAttach"), src.indexOf("function rxBrandAC"));
  assert.match(ac, /MEDDRUGS\.searchIndex/, "the local formulary still answers instantly");
  assert.match(ac, /seen\[k\]/, "results are deduped on the generic");

  // A reply for a query already typed past must be dropped, or the list repaints under the doctor.
  assert.match(ac, /if \(q !== remoteQ\) return;/, "stale replies are discarded");
  assert.match(ac, /\}, 220\);/, "and the lookup is debounced");
});

test("both search bars use the same API call, so one cannot drift from the other", async () => {
  const { readFileSync } = await import("node:fs");
  const at = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  for (const f of ["../prescription.js", "../icu.js"]) {
    assert.match(at(f), /MEDAPI\.searchCompositions\(/, `${f} searches the shared composition index`);
  }
});
