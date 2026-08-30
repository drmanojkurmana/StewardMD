/* test/icu-tx-presets.test.mjs — ICU treatment presets are the DOCTOR's, and adding is additive.
 *
 * Asked for as "presets like malaria fixed drugs etc", then narrowed to "give user a option to
 * create presets". That distinction is the whole point and is what these tests protect: StewardMD
 * ships the mechanism, the doctor authors the content. Shipping a regimen we have not had reviewed
 * is the same rule that keeps DKA and paediatric behind a cited protocol.
 *
 * Source-level assertions, matching test/rx-voice-parse.test.mjs and test/fundx.test.mjs — icu.js
 * is a large DOM-bound IIFE that cannot be instantiated headlessly in node.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../icu.js", import.meta.url), "utf8");
// The preset block, so a match elsewhere in a 9k-line file cannot make a test pass by accident.
const BLOCK = SRC.slice(SRC.indexOf("var ICU_TX_PRESETS_KEY"), SRC.indexOf("function txSearchDrugs"));

test("the preset mechanism exists and is reachable from the treatment screen", () => {
  assert.ok(BLOCK.length > 200, "the preset block is present");
  assert.match(SRC, /txPresetBarHTML\(tx\)/, "the bar renders in the treatment section");
  assert.match(SRC, /case "txpresetsave": txPresetSave\(\);/, "Save as set is wired to the dispatcher");
  assert.match(SRC, /data-icu-act"\) !== "txpreset"/, "the picker has a delegated change listener");
});

test("StewardMD ships NO regimen content of its own", () => {
  // The named example must not appear as shipped data. If curated sets are ever wanted, they belong
  // in the reviewed protocol library, not hard-coded here.
  assert.equal(/artesunate|artemether|chloroquine|primaquine/i.test(BLOCK), false,
    "no malaria (or any) regimen is hard-coded into the preset code");
  assert.match(BLOCK, /icuTxPresets\(\)/, "the list comes from storage, i.e. from the doctor");
  // The seed is an empty array, never a shipped starter set.
  assert.match(BLOCK, /getItem\(ICU_TX_PRESETS_KEY\) \|\| "\[\]"/, "presets start empty");
});

test("applying a preset ADDS to the current treatment, never replaces it", () => {
  assert.match(BLOCK, /STATE\.treatment = \(_raw\.treatment \|\| \[\]\)\.concat\(add\)/,
    "concat, not assignment: a preset must never wipe what is already prescribed");
  assert.equal(/STATE\.treatment = add\b/.test(BLOCK), false, "must not replace the list outright");
});

test("every applied item goes through the ordinary treatment path", () => {
  // Author + timestamp + id, exactly like a hand-added item, so it stays removable and auditable.
  assert.match(BLOCK, /by: txAuthorName\(\)/, "the applying doctor is recorded as the author");
  assert.match(BLOCK, /ts: nowTs\(\)/, "each item is timestamped");
  assert.match(BLOCK, /id: "tx_" \+ nowTs\(\)/, "each item gets its own id, so it can be removed");
});

test("a preset stores drug fields ONLY — never a patient identifier", () => {
  const saved = BLOCK.slice(BLOCK.indexOf("function txPresetSave"), BLOCK.indexOf("function txPresetApply"));
  assert.match(saved, /name: x\.name, dose: [\s\S]*route: [\s\S]*freq: [\s\S]*cat: /, "only drug fields are copied");
  for (const forbidden of ["mrn", "patientId", "bed", "uhid", "patientName"]) {
    assert.equal(new RegExp("\\b" + forbidden + "\\b", "i").test(saved), false,
      `a preset must never carry ${forbidden}`);
  }
});

test("the doctor is told to check what was added", () => {
  // A set drops several drugs in at once; it must not read as though the app prescribed them.
  assert.match(BLOCK, /check each one/, "applying a set prompts the doctor to verify every item");
});

/* ---- the AI progress animation replaced the flat "looks stuck" text ---- */

test("long AI steps show named stages, not a bare line of text", () => {
  assert.match(SRC, /function icuThinkHTML\(title, stages\)/, "the shared progress block exists");
  assert.equal(/icu-assist-msg[^>]*>Running deep clinical review/.test(SRC), false,
    "the flat deep-review text is gone");
  assert.equal(/icu-v2-spin"[^>]*><\/div>Drafting the discharge narrative/.test(SRC), false,
    "the bare-spinner discharge text is gone");
  assert.ok((SRC.match(/icuThinkHTML\(/g) || []).length >= 4, "one definition plus all three call sites");
});

test("the progress animation degrades for reduced motion", () => {
  assert.match(SRC, /prefers-reduced-motion:reduce\)\{#icuRoot\.icu-v2 \.icu-think-dot/,
    "motion is disabled and the stages stay legible");
});
