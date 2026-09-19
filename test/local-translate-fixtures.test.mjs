/* test/local-translate-fixtures.test.mjs - shape checks for test/fixtures/indic-translate.json,
 * the fixture set run-local-translate-eval.mjs grades against a real local model. This file makes
 * no network call: it only proves the fixtures are internally consistent (numbers actually present
 * in the text, ids unique, coverage per language) so a bad fixture never gets blamed on a model.
 * node --test test/local-translate-fixtures.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(HERE, "fixtures", "indic-translate.json"), "utf8"));
const LANGS = new Set(["te", "hi", "mixed"]);
const NUMBER_TOKEN_RE = /^\d+(?:[.,]\d+)*$/;

function numbersInText(text) {
  return new Set((text.match(/\b\d+(?:[.,]\d+)*\b/g) || []).map((n) => n.replace(/,/g, "")));
}

test("fixtures is a non-empty array", () => {
  assert.ok(Array.isArray(fixtures));
  assert.ok(fixtures.length > 0);
});

test("every fixture has the required shape", () => {
  for (const f of fixtures) {
    assert.equal(typeof f.id, "string", `${JSON.stringify(f)} missing string id`);
    assert.ok(LANGS.has(f.lang), `${f.id}: lang "${f.lang}" not in ${[...LANGS]}`);
    assert.equal(typeof f.text, "string", `${f.id} missing text`);
    assert.ok(f.text.trim().length > 0, `${f.id} has empty text`);
    assert.ok(Array.isArray(f.expect), `${f.id} missing expect array`);
    assert.ok(Array.isArray(f.numbers), `${f.id} missing numbers array`);
  }
});

test("ids are unique", () => {
  const ids = fixtures.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("at least 8 fixtures per language", () => {
  const counts = {};
  for (const f of fixtures) counts[f.lang] = (counts[f.lang] || 0) + 1;
  for (const lang of LANGS) assert.ok((counts[lang] || 0) >= 8, `${lang}: only ${counts[lang] || 0} fixtures`);
});

test("numbers matches every digit-string actually present in text", () => {
  for (const f of fixtures) {
    const found = numbersInText(f.text);
    const want = new Set(f.numbers);
    assert.deepEqual(
      [...found].sort(),
      [...want].sort(),
      `${f.id}: numbers ${JSON.stringify(f.numbers)} does not match digits found in text (${[...found]})`
    );
  }
});

test("every expect token is non-empty", () => {
  for (const f of fixtures) {
    for (const tok of f.expect) {
      assert.equal(typeof tok, "string");
      assert.ok(tok.trim().length > 0, `${f.id} has an empty expect token`);
    }
  }
});

test("every number-like expect token is also in numbers", () => {
  for (const f of fixtures) {
    const numberSet = new Set(f.numbers);
    for (const tok of f.expect) {
      if (NUMBER_TOKEN_RE.test(tok)) {
        assert.ok(numberSet.has(tok), `${f.id}: expect token "${tok}" is a number but missing from numbers`);
      }
    }
  }
});
