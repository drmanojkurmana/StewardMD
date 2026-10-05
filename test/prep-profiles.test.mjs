/* PrepNucleus exam profiles (plan LayerC 6.9): prep/profiles/<exam>.json is the readable copy of the two places the
 * code keeps them, the generation style mix in functions/_prep-core.js EXAM_PROFILES and the mock exam pattern in
 * prep.js MOCKS. They must never drift apart. node --test test/prep-profiles.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { EXAM_PROFILES } from "../functions/_prep-core.js";
const P = createRequire(import.meta.url)("../prep.js");
const PAT = { "neet-pg": P.mockOf("neet-pg", "neet-pg"), "ini-cet": P.mockOf("neet-pg", "ini-cet"), "neet-ss": P.mockOf("neet-ss", "neet-ss"), usmle: P.mockOf("usmle", "usmle-block") };

test("every profile file matches the core style mix and the app's mock pattern", () => {
  const files = fs.readdirSync(new URL("../prep/profiles/", import.meta.url)).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(EXAM_PROFILES).sort().map((id) => id + ".json"));
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(new URL("../prep/profiles/" + f, import.meta.url), "utf8")), c = EXAM_PROFILES[j.id], m = PAT[j.id];
    for (const k of ["name", "style", "stem"]) assert.equal(j[k], c[k], j.id + " " + k);
    assert.deepEqual(j.cog, c.cog); assert.deepEqual(j.d, c.d);
    assert.equal(j.exam.n, m.n); assert.equal(j.exam.min, m.min); assert.equal(j.exam.plus, m.plus);
    assert.ok(Math.abs(j.exam.minus - m.minus) < 1e-3, j.id + " minus");
    assert.doesNotMatch(JSON.stringify(j), /[–—]/);
  }
});
