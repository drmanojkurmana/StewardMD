/* Phase 8 P2 unit tests: the RECIST 1.1 response calculator (onco-recist.js). Verifies the REAL
 * target-lesion computation against the spec's worked examples plus the category boundaries, the
 * nadir-referenced progression rule (>=20% AND >=5 mm), new-lesion -> PD precedence, and invalid input
 * handling. node --test test/onco-recist.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

global.window = global;
if (!global.document) global.document = { addEventListener() {}, getElementById() { return null; }, createElement() { return {}; }, body: { appendChild() {} } };

const R = require(join(ROOT, "onco-recist.js"));

test("WORKED EXAMPLE: baseline 100mm -> 65mm = PR (>=30% decrease from baseline)", () => {
  const r = R.recist({ baseline: 100, current: 65, nadir: 100 });
  assert.equal(r.status, "ok");
  assert.equal(r.category, "PR");
  assert.equal(r.pctFromBaseline, -35);
});

test("WORKED EXAMPLE: current 130mm from nadir 100 = PD (>=20% increase AND >=5 mm from nadir)", () => {
  const r = R.recist({ baseline: 100, current: 130, nadir: 100 });
  assert.equal(r.category, "PD");
  assert.equal(r.pctFromNadir, 30);
  assert.equal(r.absFromNadir, 30);
});

test("WORKED EXAMPLE: a new lesion is PD regardless of the sum", () => {
  const r = R.recist({ baseline: 100, current: 50, nadir: 100, newLesions: true });
  assert.equal(r.category, "PD");
  assert.match(r.reason, /new lesion/i);
});

test("CR: all target lesions resolved (sum = 0)", () => {
  assert.equal(R.recist({ baseline: 100, current: 0, nadir: 40 }).category, "CR");
});

test("SD: neither PR nor PD (small decrease)", () => {
  assert.equal(R.recist({ baseline: 100, current: 90, nadir: 100 }).category, "SD");
});

test("PD precedence over PR: shrunk from baseline but regrew >=20% and >=5mm from a lower nadir -> PD", () => {
  // baseline 100, nadir 40, current 60: -40% vs baseline (PR-like) BUT +50% and +20mm vs nadir -> PD
  const r = R.recist({ baseline: 100, current: 60, nadir: 40 });
  assert.equal(r.category, "PD");
});

test("PD needs BOTH >=20% AND >=5 mm absolute from nadir (the 5mm floor prevents tiny-lesion false PD)", () => {
  // baseline 10mm, nadir 10mm, current 12mm: +20% from nadir but only +2mm absolute -> NOT PD (SD)
  const r = R.recist({ baseline: 10, current: 12, nadir: 10 });
  assert.equal(r.category, "SD");
  assert.equal(r.pctFromNadir, 20);
  assert.equal(r.absFromNadir, 2);
});

test("PR boundary: exactly 30% decrease is PR; 29% is SD", () => {
  assert.equal(R.recist({ baseline: 100, current: 70, nadir: 100 }).category, "PR");
  assert.equal(R.recist({ baseline: 100, current: 71, nadir: 100 }).category, "SD");
});

test("nadir defaults to baseline when omitted", () => {
  const r = R.recist({ baseline: 100, current: 130 });
  assert.equal(r.category, "PD");
});

test("invalid input fails safe (no fabricated category)", () => {
  assert.equal(R.recist({ baseline: 0, current: 50 }).status, "invalid");
  assert.equal(R.recist({ baseline: "abc", current: 50 }).status, "invalid");
  assert.equal(R.recist({ baseline: 100, current: -5 }).status, "invalid");
});

test("the module's built-in selfTest() passes (all worked examples)", () => {
  assert.equal(R.selfTest(), true);
});
