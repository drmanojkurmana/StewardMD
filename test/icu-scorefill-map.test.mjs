/* test/icu-scorefill-map.test.mjs — every missing-input label a score can report must be fillable.
 *
 * Tapping a greyed-out ICU score now opens an inline sheet that asks only for what is missing and
 * writes it to the patient, instead of redirecting to the calculator section. That works off
 * SCORE_FIELD in icu.js, which maps icu-autoscores.js's __missing labels onto real state fields.
 *
 * Those labels are DISPLAY strings, and they are not consistent: the same analyte is "bili" in the
 * MELD adapter and "bilirubin" in SOFA's, some are k.toUpperCase() of a key ("SPO2"), some are typed
 * by hand ("haematocrit"). Nothing links them to the map. So a new score - or a renamed label in an
 * existing one - can silently emit something unmapped, and that score quietly falls back to the
 * redirect this change exists to remove: no runtime error, nothing visibly broken, just the old
 * behaviour creeping back on one score.
 *
 * This drives the REAL adapters with an empty patient, collects every label they emit, and asserts
 * each one is either mapped to a field, split into parts (PaO2/FiO2), routed to the GCS sheet, or
 * explicitly listed as not answerable with a number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const AUTOSCORES = readFileSync(new URL("icu-autoscores.js", ROOT), "utf8");
const ICU = readFileSync(new URL("icu.js", ROOT), "utf8");

/* ---- load the real adapters (an ES5 IIFE that publishes onto window) ---- */
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(AUTOSCORES, ctx);
const DEFS = ctx.window.ICU_AUTOSCORES.DEFS;

// A patient with nothing recorded: every adapter should report what it needs.
const EMPTY = { patient: {}, vitals: [], labs: { recent: {}, trends: [] }, abg: {}, ventilator: {}, infusions: [], imaging: [], findings: [], alerts: [] };

function labelsFor(state) {
  const out = new Set();
  for (const def of DEFS) {
    const v = def.adapt(state);
    if (v && v.__missing) v.__missing.forEach((m) => out.add(m));
  }
  return out;
}

/* ---- what icu.js can fill ---- */
// Keys are read anywhere in the literal, not just at line start: SCORE_FIELD is one row per line but
// SCORE_FIELD_SPLIT is a single line, and a line-anchored match silently found nothing in it.
function objectKeys(src, name) {
  const start = src.indexOf("var " + name + " = {");
  assert.ok(start >= 0, name + " not found in icu.js");
  const end = src.indexOf("};", start);
  assert.ok(end > start, name + " literal is not terminated");
  const body = src.slice(start, end);
  const keys = new Set([...body.matchAll(/"([^"]+)"\s*:/g)].map((m) => m[1]));
  assert.ok(keys.size > 0, name + " parsed as empty - the parser, not the map, is wrong");
  return keys;
}
const MAPPED = objectKeys(ICU, "SCORE_FIELD");
const SPLIT = objectKeys(ICU, "SCORE_FIELD_SPLIT");

// Not a single number, so the full calculator stays the right answer for these.
const NOT_A_NUMBER = new Set([
  "ascites grade",
  "encephalopathy grade",
  "a full physiology panel (ABG, electrolytes, CBC, vitals, GCS, age)",
  "valid inputs",
]);

test("the adapters actually report missing inputs for an empty patient", () => {
  const labels = labelsFor(EMPTY);
  assert.ok(labels.size > 10, `expected many missing labels, got ${labels.size}`);
  assert.ok(labels.has("GCS"), "GCS is required by qSOFA/SOFA/NEWS2 and must be reported");
});

test("every missing label is fillable, split, GCS, or explicitly not a number", () => {
  const unhandled = [...labelsFor(EMPTY)].filter(
    (l) => l !== "GCS" && !MAPPED.has(l) && !SPLIT.has(l) && !NOT_A_NUMBER.has(l)
  );
  assert.deepEqual(unhandled, [],
    "these labels would fall back to the calculator redirect - add them to SCORE_FIELD in icu.js");
});

test("a derived label is split into the parts a clinician can actually answer", () => {
  // "PaO2/FiO2" is a ratio: asking for it directly is unanswerable, so it must expand to its parts.
  assert.ok(SPLIT.has("PaO₂/FiO₂"), "PaO₂/FiO₂ must be split");
  for (const part of ["PaO₂", "FiO₂"]) {
    assert.ok(MAPPED.has(part), `${part} must itself be a fillable field`);
  }
});

test("GCS is never offered as a number box", () => {
  // It has a real E/V/M sheet; a free 3-15 number invites a value that was never actually scored.
  assert.equal(MAPPED.has("GCS"), false, "GCS must route to the E/V/M sheet, not a number input");
});

test("every mapped field carries a plausibility range and a destination", () => {
  const start = ICU.indexOf("var SCORE_FIELD = {");
  const body = ICU.slice(start, ICU.indexOf("\n  };", start));
  const rows = [...body.matchAll(/^\s*"([^"]+)"\s*:\s*\{([^}]*)\}/gm)];
  assert.ok(rows.length >= 25, `expected the full field table, parsed ${rows.length}`);
  for (const [, label, def] of rows) {
    assert.match(def, /\bd:\s*"(monitor|labs|abg|patient)"/, `${label} needs a valid destination domain`);
    assert.match(def, /\bk:\s*"/, `${label} needs a state key`);
    const lo = /\blo:\s*(-?[\d.]+)/.exec(def), hi = /\bhi:\s*(-?[\d.]+)/.exec(def);
    assert.ok(lo && hi, `${label} needs lo/hi plausibility bounds (a mistyped K 68 for 6.8 fires real alerts)`);
    assert.ok(parseFloat(lo[1]) < parseFloat(hi[1]), `${label} has lo >= hi`);
  }
});

test("filling the reported inputs actually makes a score compute", () => {
  // The point of the feature: answer exactly what qSOFA asked for and it must stop being "missing".
  const qsofa = DEFS.find((d) => d.id === "qsofa");
  assert.ok(qsofa, "qSOFA def missing");
  assert.ok(qsofa.adapt(EMPTY).__missing, "qSOFA should start out missing inputs");
  const filled = { ...EMPTY, vitals: [{ rr: 24, sbp: 96, gcs: 14, ts: 1 }] };
  const v = qsofa.adapt(filled);
  assert.equal(v.__missing, undefined, "with RR, SBP and GCS recorded qSOFA must compute");
  // Copied into this realm first: the adapter's object comes from the vm sandbox, so a strict deep
  // compare fails on prototype identity alone even when every value matches.
  assert.deepEqual({ ...v }, { rr: true, ams: true, sbp: true });
});
