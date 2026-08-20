// Fast-path routing: simple queries -> cheaper/faster model (MAIK_FAST_MODEL), complex -> default/strong.
// looksComplex/fastModel/strongModel are extracted verbatim from the deployed AI function.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { ALLOWED_MODELS } = await import(path.join(ROOT, "functions/_ai_usage.js"));
globalThis.ALLOWED_MODELS = ALLOWED_MODELS;
const src = fs.readFileSync(path.join(ROOT, "functions/api/ai/[[path]].js"), "utf8");
const grab = (re, n) => { const m = src.match(re); assert.ok(m, n + " found"); return (0, eval)("(" + m[0].replace(/^function \w+/, "function") + ")"); };
const looksComplex = grab(/function looksComplex\(q\) \{[\s\S]*?\n\}/, "looksComplex");
const strongModel  = grab(/function strongModel\(env\) \{[^}]*\}/, "strongModel");
const fastModel    = grab(/function fastModel\(env\) \{[^}]*\}/, "fastModel");
const FLASH = "gemini-2.5-flash", LITE = "gemini-2.5-flash-lite", PRO = "gemini-2.5-pro";
function chooseModel(env, q) {                    // mirrors callGemini's prologue
  let opts = { complex: looksComplex(q) };
  if (opts && !opts.model) {
    if (opts.complex) { const sm = strongModel(env); if (sm) opts = Object.assign({}, opts, { model: sm }); }
    else { const fm = fastModel(env); if (fm) opts = Object.assign({}, opts, { model: fm }); }
  }
  return { complex: opts.complex, model: opts.model || (env.GEMINI_MODEL || FLASH) };
}

test("classification: depth questions are complex, bare lookups are simple", () => {
  for (const q of ["management of diabetic ketoacidosis", "differential for hyponatremia", "compare vancomycin vs linezolid",
    "which antibiotic for MRSA pneumonia", "how to treat fever", "workup of anemia", "why prefer one over the other"])
    assert.equal(looksComplex(q), true, "complex: " + q);
  for (const q of ["azithromycin dose", "ceftriaxone adult dose", "what is the normal serum sodium", "normal potassium range", "paracetamol max dose"])
    assert.equal(looksComplex(q), false, "simple: " + q);
});

test("fast path: simple query -> flash-lite when MAIK_FAST_MODEL set; complex stays full flash", () => {
  const env = { MAIK_FAST_MODEL: LITE };
  assert.equal(chooseModel(env, "azithromycin dose").model, LITE);
  assert.equal(chooseModel(env, "management of diabetic ketoacidosis").model, FLASH);
});

test("no env set -> unchanged default (flash everywhere)", () => {
  assert.equal(chooseModel({}, "azithromycin dose").model, FLASH);
  assert.equal(chooseModel({}, "management of DKA").model, FLASH);
});

test("strong + fast can coexist: simple->lite, complex->pro", () => {
  const env = { MAIK_FAST_MODEL: LITE, STRONG_MODEL: PRO };
  assert.equal(chooseModel(env, "azithromycin dose").model, LITE);
  assert.equal(chooseModel(env, "management of DKA").model, PRO);
});
