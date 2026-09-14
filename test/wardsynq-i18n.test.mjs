/* test/wardsynq-i18n.test.mjs - WardSynQ patient-portal i18n (D6): the engine + English catalog in
 * i18n.js, and one file per language in wardsynq/site/i18n/<code>.js, translated by Antigravity in
 * parallel (docs/wardsynq/TRANSLATION_BRIEF_ANTIGRAVITY.md). This is the contract that keeps that
 * conflict-proof: every language file does nothing but register a catalog of English-derived keys.
 *
 * node --test test/wardsynq-i18n.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const LANGS = ["es", "te", "hi", "bn", "kn", "ta", "ml", "mr"];

/** The catalog a language file registers, loaded the way the portal loads it. */
function catalogOf(code) {
  const I = loadEngine();
  vm.runInNewContext(read("wardsynq/site/i18n/" + code + ".js"), { window: { WSQI18n: I } });
  return I._catalogs[code];
}

function loadEngine() {
  const window = {};
  vm.runInNewContext(read("wardsynq/site/i18n.js"), { window });
  return window.WSQI18n;
}

// A catalog holds UI chrome only, never clinical content (i18n.js's own promise, in the header
// comment). A dose/frequency slipping into a translated string is a medication-error shaped bug, so
// this guard runs on English too, not just the translations.
const CLINICAL_SHAPED = /\b\d+(\.\d+)?\s?(mg|mcg|ml|iu|mmol|kg\/m2)\b/i;

test("English catalog: no clinical-shaped text, no em dash, no emoji", () => {
  const I = loadEngine();
  const en = I._catalogs.en;
  assert.ok(Object.keys(en).length > 100, "the catalog is really loaded");
  for (const [k, v] of Object.entries(en)) {
    assert.equal(typeof v, "string", k);
    assert.ok(v.length > 0, k + " is empty");
    assert.doesNotMatch(v, CLINICAL_SHAPED, k + ": looks like clinical content, not UI chrome");
    assert.doesNotMatch(v, /—/, k + ": em dash");
    assert.doesNotMatch(v, /\p{Extended_Pictographic}/u, k + ": emoji");
  }
});

for (const code of LANGS) {
  test("i18n/" + code + ".js: only registers a catalog, every key is English's, placeholders match", () => {
    const I = loadEngine();
    const src = read("wardsynq/site/i18n/" + code + ".js");

    // Structural: the file's only job is one register() call (plus the module.exports plumbing for
    // tests) - nothing here can step on another language file or on i18n.js itself.
    assert.equal((src.match(/\bWSQI18n\.register\(/g) || []).length, 1, "exactly one register() call");
    assert.equal((src.match(/\bfunction\b/g) || []).length, 1, "no function besides the wrapping IIFE");
    assert.match(src, new RegExp('register\\("' + code + '"'), "registers itself under its own code, not another language's");

    const window = { WSQI18n: I };
    vm.runInNewContext(src, { window });
    const cat = I._catalogs[code];
    assert.ok(cat, code + " registered itself");
    assert.equal(I.languages().find((l) => l.code === code).reviewed, false, "unreviewed until a native speaker checks it");

    const en = I._catalogs.en;
    const placeholders = (s) => new Set((String(s).match(/\{(\w+)\}/g) || []));
    for (const [k, v] of Object.entries(cat)) {
      assert.ok(Object.prototype.hasOwnProperty.call(en, k), code + ": stray key not in English: " + k);
      assert.equal(typeof v, "string", code + "." + k);
      assert.ok(v.length > 0, code + "." + k + " is empty");
      assert.doesNotMatch(v, /—/, code + "." + k + ": em dash");
      assert.doesNotMatch(v, /\p{Extended_Pictographic}/u, code + "." + k + ": emoji");
      const want = placeholders(en[k]), got = placeholders(v);
      assert.equal(got.size, want.size, code + "." + k + ": placeholder set differs from English");
      for (const ph of want) assert.ok(got.has(ph), code + "." + k + ": missing " + ph);
    }

    const missing = I.missingKeys(code);
    console.log(code + ": " + missing.length + " keys still fall back to English");
  });
}

/* NEGATION AND NUMBERS SURVIVE TRANSLATION. These English strings each say "no", "not" or "nothing", and
 * a translation that drops it tells a patient something false: "no allergies recorded" read as "allergies
 * recorded", "this does not mean you are not in the queue" read as "you are not in the queue". Each
 * translated one must still carry a negation of its own language. A language that translates one of these
 * keys without a marker list here fails, so the check cannot be skipped by accident. Markers are
 * substrings (Indic negation is often a verb suffix: Telugu కాలేదు, లేరు). */
const NEGATED_KEYS = ["lang.codedNote", "section.failed", "phase.failed", "status.failed", "status.empty", "status.ambiguous",
  "allergy.empty", "pcopy.noAllergies", "msg.notEmergency", "action.failed", "appt.askNote", "signin.invalid",
  /* Bilingual prints (2026-09-15): every print wording and closed-list patient instruction whose English says
   * not / no / never / avoid ("Do not crush or chew") is found here by its words, so a new negated phrase is
   * checked without anyone remembering to list it. */
  ...Object.entries(loadEngine()._catalogs.en).filter(([k, v]) => /^(print|rx\.instr)\./.test(k) && /\b(not|no|never|avoid)\b/i.test(v)).map(([k]) => k)];
const NEGATION = {
  es: ["no ", "No ", "nada", "ningun", "ninguna"],
  te: ["లేదు", "లేరు", "లేవు", "కాదు", "కాలేదు", "చెల్లదు", "లేకపోయ", "అనువదించరు"],
  hi: ["नहीं"],
  bn: ["না", "নেই", "নয়"],
  kn: ["ಇಲ್ಲ", "ಅಲ್ಲ"],
  ta: ["இல்லை", "அல்ல"],
  ml: ["ഇല്ല", "അല്ല"],
  mr: ["नाही", "नये"],
};

test("translations keep every negation and every number of the English string", () => {
  const en = loadEngine()._catalogs.en;
  const digits = (s) => String(s).match(/\p{Nd}+/gu) || [];
  for (const code of LANGS) {
    const cat = catalogOf(code);
    for (const [k, v] of Object.entries(cat)) {
      // Same digits, in ASCII: a native numeral (१, ౧) or a changed count is a different number to a reader.
      assert.deepEqual(digits(v), digits(en[k]), code + "." + k + ": numbers differ from English");
    }
    for (const k of NEGATED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(cat, k)) continue;
      assert.ok(NEGATION[code], code + " translates " + k + " but has no negation markers in this test");
      assert.ok(NEGATION[code].some((m) => cat[k].includes(m)), code + "." + k + ": the negation of the English string is gone");
    }
  }
});

test("language files hold words only: no network, no script loading, no AI-translation wording", () => {
  for (const code of LANGS) {
    const src = read("wardsynq/site/i18n/" + code + ".js");
    assert.doesNotMatch(src, /\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(|\brequire\s*\(|sendBeacon|WebSocket/, code + ": a catalog never calls out");
    assert.doesNotMatch(src, /AI-translat/i, code + ": clinical text is never machine translated, so nothing may claim it was");
  }
});

test("every language file is registered as its own native name, and English stays reviewed", () => {
  const I = loadEngine();
  for (const code of LANGS) vm.runInNewContext(read("wardsynq/site/i18n/" + code + ".js"), { window: { WSQI18n: I } });
  // All nine (owner decision D6, Marathi added 2026-09-14) are offered even before any language file loads (the portal loads one only when picked).
  const fresh = loadEngine();
  assert.deepEqual(Array.from(fresh.languages(), (l) => l.code), ["en", "es", "te", "hi", "bn", "kn", "ta", "ml", "mr"]);
  assert.equal(fresh.offered("../x"), false);
  assert.equal(fresh.offered("gu"), false, "a language the owner did not name is not offered, so no file is fetched for it");
  const codes = I.languages().map((l) => l.code);
  assert.deepEqual(new Set(codes), new Set(["en", ...LANGS]));
  assert.equal(I.languages().find((l) => l.code === "en").reviewed, true);
});
