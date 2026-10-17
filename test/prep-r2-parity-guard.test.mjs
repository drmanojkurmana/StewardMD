/* Pins the PrepNucleus R2 parity guard so it cannot be edited away quietly. Merging content does not upload it to R2,
 * and when the upload is skipped modules, lessons and MCQs are invisible on every phone (owner 2026-10-17). Removing
 * any piece below fails this test. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const rd = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

test("the parity tool checks indexes, overlay files, lesson images and bank module files against live R2", () => {
  const t = rd("tools/prep-r2-parity.mjs");
  for (const needle of ["gaps.index", "gaps.overlay", "gaps.image", "gaps.module", "overlay-counts.json", "X-SMD-Tool", "process.exit(total ? 1 : 0)"]) assert.ok(t.includes(needle), "parity tool lost: " + needle);
});
test("the parity workflow runs on every push to main, on a schedule and on demand, and fails on a gap", () => {
  const w = rd(".github/workflows/prep-r2-parity.yml");
  assert.match(w, /push:\s*\n\s*branches: \[main\]/);
  assert.match(w, /schedule:/);
  assert.match(w, /workflow_dispatch/);
  assert.match(w, /node tools\/prep-r2-parity\.mjs/);
  assert.doesNotMatch(w.replace(/continue-on-error: \$\{\{ github\.event_name == 'pull_request' \}\}/, ""), /continue-on-error/, "only pull requests may be informational");
});
test("an OTA publish refuses to run while R2 lacks content, unless skip_parity is set on purpose", () => {
  const o = rd(".github/workflows/ota-publish.yml");
  assert.match(o, /skip_parity/);
  assert.match(o, /!inputs\.skip_parity/);
  assert.match(o, /node tools\/prep-r2-parity\.mjs/);
  assert.ok(o.indexOf("prep-r2-parity.mjs") < o.indexOf("scripts/ota-publish.mjs"), "the parity check must run before the publish step");
});
test("the sync tool only ever adds files and never drops a live topic", () => {
  const s = rd("tools/prep-r2-sync.mjs");
  assert.match(s, /would drop live topics/);
  assert.ok(existsSync(new URL("../.github/CODEOWNERS", import.meta.url)));
  assert.match(rd(".github/CODEOWNERS"), /prep-r2-parity\.mjs/);
});
