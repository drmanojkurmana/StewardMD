/* Every app surface SURGX deep-links into must actually exist.
 *
 * SURGX owns no calculators, no drug data, no antibiogram and no AI surface - by product decision
 * it links out to the app's own modules. Every one of those links is a `window.X` reference guarded
 * by a try/catch with a friendly "still loading" toast, which is the right runtime behaviour and
 * also the perfect place for a typo to hide forever: the button simply does nothing and no error is
 * ever logged.
 *
 * This test resolves every global SURGX reaches for against the globals the repo actually defines,
 * AND asserts that every overlay it opens is lifted above the SURGX overlay. The second half is the
 * one that actually bit: the Drug index and Local antibiogram buttons looked dead because their
 * overlays (.db-overlay 880, .abg 950) render below SURGX's 1255 (user report + screenshot,
 * 2026-08-25). The globals were fine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* Globals the app assigns anywhere at the top level: `window.X =` / `G.X =` / `globalThis.X =`. */
function definedGlobals() {
  const found = new Set();
  for (const f of readdirSync(ROOT)) {
    if (!f.endsWith(".js")) continue;
    let src;
    try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
    for (const m of src.matchAll(/\b(?:window|globalThis|G)\s*\.\s*([A-Z][A-Za-z0-9_]*)\s*=(?!=)/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

/* Globals SURGX READS. Only uppercase-style module globals; `window.location` etc are not modules.
 * Reads look like `window.X &&`, `window.X.y`, `!!window.X`. */
function referencedGlobals(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const out = new Set();
  for (const m of src.matchAll(/\bwindow\s*\.\s*([A-Z][A-Za-z0-9_]{2,})\b(?!\s*=(?!=))/g)) out.add(m[1]);
  return out;
}

const BROWSER_BUILTINS = new Set(["Capacitor", "Promise", "Image", "Response", "URL", "Notification", "MutationObserver", "WebSocket", "Intl", "Object", "Array", "JSON", "Math", "Date", "RegExp", "Error", "Map", "Set"]);

test("the repo's global scan finds the modules SURGX depends on", () => {
  // Guards the scanner itself - if the regex broke, every assertion below would pass vacuously.
  const g = definedGlobals();
  for (const known of ["MEDCALC", "MEDDB", "ABG", "SURGX", "SMD_SURGX_MODEL"]) {
    assert.ok(g.has(known), `scanner missed a global this app definitely defines: ${known}`);
  }
  // MEDDB (api.js) IS real - the Drugs Database. The bug was never the global; both buttons
  // opened their overlay BEHIND the SURGX overlay. Kept as a scanner sanity check.
  assert.ok(g.has("MEDDB"), "MEDDB is the Drugs Database global (api.js)");
});

test("every global SURGX deep-links to is actually defined somewhere", () => {
  const defined = definedGlobals();
  const missing = [];
  for (const file of ["surgx-screens.js", "surgx.js", "surgx-destinations.js", "surgx-patient.js", "surgx-entitlement.js", "surgx-store.js"]) {
    for (const ref of referencedGlobals(file)) {
      if (BROWSER_BUILTINS.has(ref)) continue;
      if (!defined.has(ref)) missing.push(`${file} -> window.${ref}`);
    }
  }
  assert.deepEqual(missing, [], "SURGX reaches for globals that do not exist:\n  " + missing.join("\n  "));
});

test("every overlay SURGX opens is lifted above it, or it opens invisibly behind", () => {
  /* The SURGX overlay is z-index 1255. Calculators (.mc-overlay 870), the drug index (drugs.js
   * reuses .mc-overlay, 872) and the antibiogram (.abg 950) all sit BELOW it, so a deep-linked
   * surface renders underneath SURGX - fully working and completely invisible. surgx.css lifts
   * each one, scoped to html.sgx-lock so it reverts when SURGX closes. */
  const css = readFileSync(join(ROOT, "surgx.css"), "utf8");
  const surgxZ = Number((css.match(/#surgxRoot\s*\{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  assert.ok(surgxZ > 0, "could not read the SURGX overlay z-index");

  for (const sel of [".mc-overlay", ".db-overlay", ".abg"]) {
    const re = new RegExp("html\\.sgx-lock\\s+" + sel.replace(".", "\\.") + "\\s*\\{[^}]*z-index:\\s*(\\d+)");
    const m = css.match(re);
    assert.ok(m, `${sel} has no lift rule - it will open behind SURGX`);
    assert.ok(Number(m[1]) > surgxZ, `${sel} lift (${m[1]}) must exceed the SURGX overlay (${surgxZ})`);
  }
});

test("the lift never rises above the prescription pad", () => {
  // The Rx sheet is z-index 16000 and must stay on top of everything.
  const css = readFileSync(join(ROOT, "surgx.css"), "utf8");
  for (const m of css.matchAll(/html\.sgx-lock\s+[^{]+\{[^}]*z-index:\s*(\d+)/g)) {
    assert.ok(Number(m[1]) < 16000, `a SURGX lift (${m[1]}) must stay below the prescription pad`);
  }
});
