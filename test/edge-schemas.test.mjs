/* test/edge-schemas.test.mjs — score version map + calculator schema export (Edge-Master-Plan A1.7, A1.8).
 * node --test test/edge-schemas.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { build, FAMILIES } from "../scripts/edge/schemas.mjs";
const require = createRequire(import.meta.url);
const S = require("../edge-schemas.js");

test("generated files match calculators.js (a calculator change must regenerate them)", () => {
  const out = execFileSync(process.execPath, ["scripts/edge/schemas.mjs", "--check"], { encoding: "utf8" });
  assert.match(out, /up to date/);
});

test("every family member is a real calculator, and the export covers all of them", () => {
  const { calculators, families } = build();
  assert.ok(calculators.length >= 400);
  assert.equal(families.length, FAMILIES.length);
  const meld3 = calculators.find((c) => c.id === "meld3");
  assert.ok(meld3.inputs.some((x) => x.unit === "g/dL"), "units are exported");
  assert.ok(calculators.find((c) => c.id === "crcl").inputs.find((x) => x.id === "sex").opts.length === 2, "select options are exported");
});

test("the MELD family tells the versions apart by their inputs", () => {
  const f = S.familyOf("meld");
  assert.equal(f.kind, "versions");
  assert.deepEqual(f.members.map((m) => m.id), ["meld", "meld_na", "meld3"]);
  const m3 = f.members.find((m) => m.id === "meld3");
  assert.ok(m3.only_here.includes("Albumin") && m3.only_here.includes("Sex"), "MELD 3.0 is the one with albumin and sex");
  assert.deepEqual(S.siblings("meld3").map((m) => m.id), ["meld", "meld_na"]);
  assert.equal(S.familyOf("crcl"), null, "a calculator with no confusable sibling has no family");
  assert.equal(S.familyOf("wells_pe").kind, "same-name");
});
