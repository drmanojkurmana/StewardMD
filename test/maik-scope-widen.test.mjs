/* test/maik-scope-widen.test.mjs — the RUNTIME (browser) widening of the MaiK intent firewall.
 * Loads the REAL KB name index so MaiKScope's lexiconMedical(MaiKKB.isKnownConcept) + the clinical-
 * shorthand MODIFIER two-factor rule are exercised. Guards two invariants at once:
 *   (1) ZERO false-refusals of natural doctor shorthand ("rx malaria", "mi rx", bare disease names).
 *   (2) ZERO leaks — a modifier next to a non-medical word ("rx apple") and the deliberately-excluded
 *       2-letter abbreviations without a modifier ("MS Dhoni", "PE teacher") stay blocked. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = (k, v) => { try { if (!globalThis[k]) globalThis[k] = v; } catch (e) {} };
shim("window", globalThis); shim("self", globalThis);
shim("document", { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), addEventListener() {} });
shim("localStorage", { getItem: () => null, setItem() {}, removeItem() {} });
shim("location", { href: "https://stewardmd.in/", search: "" });
const load = r => { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, r), "utf8"), { filename: r }); } catch (e) {} };
["kb/dist/kb.core.js","kb/dist/kb.clinical.js","kb/dist/kb.enrichment.js","kb/dist/kb.enrichment.2.js","kb/dist/kb.rag.js","kb/dist/kb.expanded.js","drugs.js","dxmgmt.js","clinical-vocab.js","kb/ai/maik-kb.js","kb/ai/maik-scope.js"].forEach(load);
const S = globalThis.MaiKScope, KB = globalThis.MaiKKB;

test("KB + scope loaded, isKnownConcept exported", () => {
  assert.ok(S && typeof S.classify === "function");
  assert.equal(typeof (KB && KB.isKnownConcept), "function");
});

// Natural doctor shorthand + bare disease names — every one MUST be allowed (medical:true).
const MUST_ALLOW = [
  "rx malaria", "malaria", "malaria rx", "dm2 rx", "hfref meds", "pe tx", "dengue rx", "mi rx",
  "gout rx", "migraine ppx", "htn meds", "cap rx", "copd exac rx", "acs tx", "af dose", "dka protocol",
  "aki workup", "typhoid dose", "asthma exac", "seizure protocol", "hyperkalemia", "dvt tx", "gout",
  "migraine", "hypertension", "hiv pep", "tb tx", "ckd staging", "sepsis mgmt", "uti abx"
];
test("zero false-refusals on natural doctor shorthand", () => {
  const bad = MUST_ALLOW.filter(q => S.classify(q).medical === false);
  assert.deepEqual(bad, [], "these clinical queries were wrongly refused: " + bad.join(", "));
});

// Leak guards — a modifier beside a non-medical noun, and bare excluded abbreviations. MUST stay blocked.
const MUST_BLOCK = [
  "rx apple", "MS Dhoni", "PE teacher", "weather today", "write python code", "who won the ipl",
  "tell me a joke", "how to cook rice", "apple watch price", "meaning of life", "integrate stripe into my app"
];
test("zero leaks — non-medical stays blocked", () => {
  const leaked = MUST_BLOCK.filter(q => S.classify(q).medical === true);
  assert.deepEqual(leaked, [], "these non-medical prompts leaked through: " + leaked.join(", "));
});
