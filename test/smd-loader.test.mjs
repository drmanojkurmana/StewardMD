import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { FACTS } = createRequire(import.meta.url)("../smd-loader.js");

test("loader facts are unique, short enough to read, and safe to place as HTML", () => {
  assert.ok(FACTS.length >= 60);
  assert.equal(new Set(FACTS).size, FACTS.length);
  for (const f of FACTS) {
    assert.ok(f.length <= 125, "too long: " + f);
    assert.ok(!/[<>&—–]/.test(f), "bad character: " + f);
  }
});
