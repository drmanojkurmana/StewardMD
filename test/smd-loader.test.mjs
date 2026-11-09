import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { FACTS } = createRequire(import.meta.url)("../smd-loader.js");

test("wider loading wording needs an ellipsis, so real titles are left alone", () => {
  const { isWideText } = createRequire(import.meta.url)("../skeletons.js");
  for (const t of ["Building your feed…", "Generating your plan...", "Connecting to the ward…", "Please wait"]) assert.ok(isWideText(t), t);
  for (const t of ["Getting started", "Opening hours", "Checklist", "Building 4, Ward 2"]) assert.ok(!isWideText(t), t);
});

test("loader facts are unique, short enough to read, and safe to place as HTML", () => {
  assert.ok(FACTS.length >= 60);
  assert.equal(new Set(FACTS).size, FACTS.length);
  for (const f of FACTS) {
    assert.ok(f.length <= 125, "too long: " + f);
    assert.ok(!/[<>&—–]/.test(f), "bad character: " + f);
  }
});
