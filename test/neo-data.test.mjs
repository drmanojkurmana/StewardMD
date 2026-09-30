/* Neonatal layer data provenance (data/neo/*.json): every clinical number carries a source and a
 * verbatim quote from a fetched snapshot, and every file ships as ai_drafted. The validator is
 * scripts/neo/validate.mjs; this test runs it over the shipped files and checks that it catches
 * the failures it exists to catch.
 *
 * node --test test/neo-data.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { validateAll, validateDoc, numbersIn, norm } from "../scripts/neo/validate.mjs";

const DIR = new URL("../data/neo/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

test("every shipped data/neo file passes the provenance validator", () => {
  const { files: n, errs } = validateAll();
  assert.ok(n >= 8, "expected the neonatal data files, got " + n);
  assert.deepEqual(errs, []);
});

test("every file is ai_drafted until a named neonatologist approves it", () => {
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, DIR), "utf8"));
    assert.equal(d.review && d.review.status, "ai_drafted", f);
  }
});

test("no em or en dash in the app's own text fields (quotes are verbatim and exempt)", () => {
  const bad = [];
  const walk = (o, path) => {
    if (Array.isArray(o)) return o.forEach((x, i) => walk(x, path + "[" + i + "]"));
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "quote" || k === "sources" || k === "_comment") continue;
      if (typeof v === "string" && /[–—]/.test(v)) bad.push(path + "." + k);
      else walk(v, path + "." + k);
    }
  };
  for (const f of files) walk(JSON.parse(readFileSync(new URL(f, DIR), "utf8")), f);
  assert.deepEqual(bad, []);
});

test("validator rejects a number that is not in its quote, a missing quote and an unknown source", () => {
  const doc = JSON.parse(readFileSync(new URL("age.json", DIR), "utf8"));
  const errs = [];
  const bad = JSON.parse(JSON.stringify(doc));
  bad.rules[1].days_lt = 29;                                   // not in "below 28 days of life"
  validateDoc(bad, "tampered-number", errs);
  assert.ok(errs.some((e) => /days_lt = 29 not in its quote/.test(e)), errs.join("\n"));
  const e2 = []; const b2 = JSON.parse(JSON.stringify(doc)); b2.rules[1].quote = "The neonatal period is below 29 days"; validateDoc(b2, "fake-quote", e2);
  assert.ok(e2.some((e) => /not found verbatim/.test(e)), e2.join("\n"));
  const e3 = []; const b3 = JSON.parse(JSON.stringify(doc)); b3.rules[1].src = "nowhere"; validateDoc(b3, "bad-src", e3);
  assert.ok(e3.some((e) => /unknown src/.test(e)));
  const e4 = []; const b4 = JSON.parse(JSON.stringify(doc)); b4.extra = { dose: 5 }; validateDoc(b4, "unsourced", e4);
  assert.ok(e4.some((e) => /has no src\/quote/.test(e)));
  const e5 = []; const b5 = JSON.parse(JSON.stringify(doc)); b5.review.status = "approved"; validateDoc(b5, "unsigned", e5);
  assert.ok(e5.some((e) => /needs review.by/.test(e)));
});

test("number and quote normalisation", () => {
  assert.ok(numbersIn("1,500 g and 2.5 mg/kg twice daily").has(1500));
  assert.ok(numbersIn("give 0.5 mg").has(0.5));
  assert.ok(numbersIn("twice daily").has(2));
  assert.equal(norm("a – b  c"), "a - b c");
});
