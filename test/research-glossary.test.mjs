/* ResearchMD Glossary tests.
 *
 * Covers:
 *  - Exactly 30 unique terms
 *  - All fields non-empty (term, plain, example)
 *  - Browser global and CommonJS exports
 *  - No em or en dash in any string
 *  - ES5 source guard
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const GLOSSARY = require("../research-glossary.js");

const EXPECTED_TERMS = [
  "meta-analysis",
  "systematic review",
  "PICO",
  "PRISMA",
  "risk of bias",
  "GRADE",
  "risk ratio (RR)",
  "odds ratio (OR)",
  "hazard ratio (HR)",
  "mean difference (MD)",
  "standardised mean difference (SMD)",
  "confidence interval (CI)",
  "p value",
  "I2",
  "heterogeneity",
  "fixed vs random effects",
  "forest plot",
  "funnel plot",
  "publication bias",
  "sensitivity analysis",
  "individual participant data (IPD)",
  "protocol",
  "PROSPERO",
  "CONSORT",
  "STROBE",
  "CARE",
  "SPIRIT",
  "abstract",
  "IMRaD",
  "DOI"
];

/* ---- exports and count ------------------------------------------------- */

test("glossary exports array of exactly 30 unique terms", function () {
  assert.ok(Array.isArray(GLOSSARY), "GLOSSARY must be an array");
  assert.equal(GLOSSARY.length, 30, "GLOSSARY must contain exactly 30 terms");

  const terms = GLOSSARY.map(function (entry) { return entry.term; });
  const unique = new Set(terms);
  assert.equal(unique.size, 30, "All 30 terms must be unique");

  EXPECTED_TERMS.forEach(function (expected) {
    assert.ok(unique.has(expected), "Missing required term: " + expected);
  });

  const src = readFileSync(new URL("../research-glossary.js", import.meta.url), "utf8");
  const fakeWindow = {};
  new Function("module", "window", src)({ exports: {} }, fakeWindow);
  assert.ok(Array.isArray(fakeWindow.SMD_RESEARCH_GLOSSARY));
  assert.equal(fakeWindow.SMD_RESEARCH_GLOSSARY.length, 30);
});

/* ---- all fields non-empty ---------------------------------------------- */

test("every entry has non-empty term, plain, and example fields", function () {
  GLOSSARY.forEach(function (entry, index) {
    assert.ok(entry && typeof entry === "object", "Entry " + index + " must be an object");
    assert.equal(typeof entry.term, "string", "Entry " + index + " term must be string");
    assert.ok(entry.term.trim().length > 0, "Entry " + index + " term must not be empty");

    assert.equal(typeof entry.plain, "string", "Entry " + index + " plain must be string");
    assert.ok(entry.plain.trim().length > 0, "Entry " + index + " plain must not be empty");

    assert.equal(typeof entry.example, "string", "Entry " + index + " example must be string");
    assert.ok(entry.example.trim().length > 0, "Entry " + index + " example must not be empty");
  });
});

/* ---- no em or en dashes anywhere --------------------------------------- */

test("no em or en dashes in any glossary term, plain text, or example", function () {
  GLOSSARY.forEach(function (entry) {
    ["term", "plain", "example"].forEach(function (key) {
      const val = entry[key];
      assert.ok(val.indexOf("\u2014") === -1, "em-dash found in " + entry.term + " " + key + ": " + val);
      assert.ok(val.indexOf("\u2013") === -1, "en-dash found in " + entry.term + " " + key + ": " + val);
    });
  });
});

/* ---- ES5 source guard --------------------------------------------------- */

test("research-glossary.js source stays ES5 with no em or en dashes", function () {
  const raw = readFileSync(new URL("../research-glossary.js", import.meta.url), "utf8");
  assert.ok(raw.indexOf("\u2014") === -1, "no em-dash in glossary source");
  assert.ok(raw.indexOf("\u2013") === -1, "no en-dash in glossary source");
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.ok(src.indexOf("=>") === -1, "no arrow functions");
  assert.ok(!/\b(let|const)\s/.test(src), "no let/const declarations");
  assert.ok(src.indexOf("`") === -1, "no template strings");
  assert.ok(!/\bclass\s+[A-Za-z]/.test(src), "no classes");
});
