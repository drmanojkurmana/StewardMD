/* Plan v2 item 6: case-control (Fleiss with continuity correction, as OpenEpi) and
 * Schoenfeld events, against docs/research/stats-reference-survival.R.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/research-samplesize-v2.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const SS = require("../research-samplesize.js");
const SRC = readFileSync(new URL("../research-samplesize.js", import.meta.url), "utf8");

test("source stays ES5 with no dashes", () => {
  assert.ok(!/=>/.test(SRC) && !/\b(let|const|class)\s/.test(SRC));
  assert.ok(!/[–—]/.test(SRC));
});

test("case-control: p0 0.40, OR 2, 1 control per case gives 133 uncorrected, 144 and 144 (OpenEpi)", () => {
  const r = SS.caseControl({ p0: 0.4, or: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.method, "Fleiss with continuity correction");
  assert.equal(r.casesUncorrected, 133);
  assert.equal(r.cases, 144);
  assert.equal(r.controls, 144);
  assert.equal(r.total, 288);
  assert.ok(Math.abs(r.p1 - 4 / 7) < 1e-12);
  assert.match(r.paragraph, /144 cases and 144 controls/);
  assert.ok(!/[–—]/.test(r.paragraph));
});

test("case-control: p0 0.30, OR 2.5, 2 controls per case gives 59, 66 and 132 (R)", () => {
  const r = SS.caseControl({ p0: 0.3, or: 2.5, r: 2 });
  assert.deepEqual([r.casesUncorrected, r.cases, r.controls], [59, 66, 132]);
});

test("case-control: dropout inflates cases, then controls follow the ratio", () => {
  const r = SS.caseControl({ p0: 0.4, or: 2, dropout: 0.1 });
  assert.deepEqual([r.cases, r.controls], [160, 160]);
});

test("case-control refuses OR 1 and impossible exposure without throwing", () => {
  for (const o of [{ p0: 0.4, or: 1 }, { p0: 0, or: 2 }, { p0: 1.2, or: 2 }, {}]) {
    const r = SS.caseControl(o);
    assert.equal(r.ok, false);
    assert.equal(r.warnings[0], "The odds ratio must differ from 1 and exposure must be between 0% and 100%.");
  }
});

test("Schoenfeld events: HR 0.7 at 80% gives 247; HR 0.6 at 90% gives 162 (R)", () => {
  const a = SS.logRankEvents({ hr: 0.7 });
  assert.equal(a.ok, true);
  assert.equal(a.method, "Schoenfeld");
  assert.equal(a.events, 247);
  assert.equal(a.total, null);
  assert.equal(SS.logRankEvents({ hr: 0.6, power: 0.9 }).events, 162);
});

test("Schoenfeld patients from the event proportion and dropout", () => {
  const r = SS.logRankEvents({ hr: 0.7, probEvent: 0.5, dropout: 0.1 });
  assert.equal(r.total, Math.ceil(247 / 0.5 / 0.9));
  assert.match(r.paragraph, /549 patients/);
});

test("Schoenfeld refuses HR 1 with the plain message", () => {
  const r = SS.logRankEvents({ hr: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.warnings[0], "A hazard ratio of 1 means no difference; choose the smallest difference that matters.");
});
