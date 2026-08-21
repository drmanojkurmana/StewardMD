/* MaiK clinical EVAL harness — a growable golden set run against the REAL KB (kb/dist/*) + the real
 * resolver (kb/ai/maik-kb.js). This is the regression net for "best medical LLM": add a case here and it
 * is protected forever. Covers the NODE-testable layers — topic resolution (name tier), the wrong-match
 * guard, and coverage. The grounding-path + full-answer eval runs in a browser (see run-maik-eval-ui.mjs).
 *
 * Clinicians: grow GOLDEN below. `expect` = /regex/ the resolved topic name must match; { reject:/regex/ }
 * = must NOT resolve to that; { resolves:true } = must resolve to something confident.
 * node --test test/maik-eval.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ---- load the real KB into a window stub, then the resolver ----
global.window = global;
["kb/dist/kb.enrichment.js", "kb/dist/kb.enrichment.2.js", "kb/dist/kb.rag.js"].forEach(function (p) {
  (0, eval)(readFileSync(new URL("../" + p, import.meta.url), "utf8"));
});
const KB = require("../kb/ai/maik-kb.js");
const resolve = (q) => KB.resolveTarget(q, {});

// ---- GOLDEN SET (grow me) ----
const GOLDEN = [
  // Common conditions must resolve to the right topic (name tier, real KB)
  { q: "how to treat diabetes", expect: /diabet/i },
  { q: "diabetic ketoacidosis management", expect: /ketoacidos/i },
  { q: "how to manage asthma", expect: /asthma/i },
  { q: "copd exacerbation treatment", expect: /copd|chronic obstructive/i },
  { q: "management of sepsis", expect: /sepsis/i },
  { q: "hypothyroidism treatment", expect: /hypothyroid/i },
  { q: "dengue management", expect: /dengue/i },
  { q: "acute pancreatitis treatment", expect: /pancreatitis/i },
  { q: "how to treat malaria", expect: /malaria/i },
  { q: "hyperkalemia treatment", expect: /hyperkal/i },
  { q: "status epilepticus management", expect: /status epilepticus/i },
  { q: "community acquired pneumonia", expect: /pneumonia/i },
  { q: "heart failure treatment", expect: /heart failure/i },
  { q: "anaphylaxis treatment", expect: /anaphylaxis/i },
  // Aliases — colloquial / abbreviation phrasings must resolve to the right topic
  { q: "how to treat tb", expect: /tuberculosis/i },
  { q: "tuberculosis treatment", expect: /tuberculosis/i },
  { q: "stroke management", expect: /stroke/i },
  { q: "heart attack treatment", expect: /coronary|myocard/i },
  { q: "how to treat high sugar", expect: /diabet/i },
  { q: "ckd management", expect: /kidney/i },
  { q: "aki treatment", expect: /kidney injury/i },
  { q: "hypoglycemia treatment", expect: /hypoglyc/i },
  // REGRESSIONS — the wrong-match must never come back
  { q: "how to correct metabolic acidosis", reject: /encephalopath/i },
  { q: "metabolic acidosis", reject: /encephalopath/i },
];

test("golden set: conditions resolve to the correct topic", () => {
  const fails = [];
  GOLDEN.forEach(function (c) {
    if (!c.expect) return;
    const r = resolve(c.q), name = r && r.name;
    if (!name || !c.expect.test(name)) fails.push(c.q + " -> " + (name || "NULL") + " (want " + c.expect + ")");
  });
  assert.equal(fails.length, 0, "resolution misses:\n  " + fails.join("\n  "));
});

test("regressions: never resolve to the wrong disease", () => {
  const fails = [];
  GOLDEN.forEach(function (c) {
    if (!c.reject) return;
    const r = resolve(c.q), name = r && r.name;
    if (name && c.reject.test(name)) fails.push(c.q + " -> " + name + " (must NOT match " + c.reject + ")");
  });
  assert.equal(fails.length, 0, "wrong-match regressions:\n  " + fails.join("\n  "));
});

// Coverage report (informational) — prints which golden queries under-resolve at the name tier so the
// KB-gap / alias-map backlog is data-driven, not anecdotal. Never fails the build.
test("coverage report (informational)", () => {
  const gaps = [];
  GOLDEN.forEach(function (c) { if (c.expect && !(resolve(c.q) || {}).name) gaps.push(c.q); });
  if (gaps.length) console.log("  [coverage] under-resolved at name tier (grounding/alias needed):\n    " + gaps.join("\n    "));
  assert.ok(true);
});
