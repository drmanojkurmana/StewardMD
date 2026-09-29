import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const C = createRequire(import.meta.url)("../tokos-models/explorer-cycle.js");
const DASH = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]"); // em and en dash are banned in learner text
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b} (tol ${tol})`);
const lens = Array.from({ length: 15 }, (_, i) => 21 + i);

test("model contract", () => {
  assert.equal(C.id, "cycle");
  assert.equal(C.kind, "explorer");
  assert.ok(["ai_drafted", "reviewed"].includes(C.review && typeof C.review === "object" ? C.review.status : C.review));
  assert.ok(C.sources.length >= 4 && C.sources.every((s) => s.label && /^https:\/\//.test(s.url)));
  assert.match(C.notes.relative.en, /not assay values/);
  assert.match(C.notes.relative.hi, /relative/);
});

test("luteal phase is a constant 14 days; the follicular phase carries the variation (Reed and Carr)", () => {
  for (const L of lens) {
    const m = C.landmarks(L);
    assert.equal(m.ovulationDay + 14, L, "cycle " + L);
    assert.equal(m.lutealDays, 14);
    assert.equal(m.follicularDays, L - 14);
    assert.equal(m.lhPeakDay, m.ovulationDay - 0.5);
  }
  assert.equal(C.landmarks(28).ovulationDay, 14, "a 28 day cycle ovulates on day 14 (OpenStax)");
});

test("landmarks: LH peak, oestradiol peak just before it, progesterone peak about 7 days after ovulation", () => {
  for (const L of lens) {
    const m = C.landmarks(L), pk = m.peakDay;
    near(pk.lh, m.lhPeakDay, 0.1, "LH peak " + L);
    assert.ok(pk.e2 < m.lhPeakDay && pk.e2 >= m.lhPeakDay - 2, "oestradiol peaks 0 to 2 days before the LH peak, cycle " + L);
    near(pk.p4, m.ovulationDay + 7, 0.3, "progesterone peak " + L);
    assert.ok(pk.fsh >= m.lhPeakDay - 1 && pk.fsh <= m.lhPeakDay + 1 || L <= 23, "the mid-cycle FSH burst coincides with the LH surge, cycle " + L);
  }
});

test("levels are relative: 0 to 1, each hormone reaches 1 in its own cycle", () => {
  for (const L of [21, 28, 35]) {
    const mx = { fsh: 0, lh: 0, e2: 0, p4: 0 };
    for (let d = 1; d <= L; d += 0.25) {
      const r = C.at(d, L);
      assert.equal(r.ok, true);
      assert.equal(r.relative, true);
      for (const h of Object.keys(mx)) { assert.ok(r.levels[h] >= 0 && r.levels[h] <= 1, h + " in range"); mx[h] = Math.max(mx[h], r.levels[h]); }
    }
    for (const h of Object.keys(mx)) assert.ok(mx[h] >= 0.999, h + " reaches 1 in cycle " + L + ": " + mx[h]);
  }
});

test("shapes in a 28 day cycle", () => {
  const at = (d) => C.at(d, 28).levels;
  // FSH: high at the start, falls through the follicular phase, bursts at mid-cycle, low in the luteal phase
  assert.ok(at(1).fsh > at(5).fsh && at(5).fsh > at(10).fsh);
  assert.ok(at(13.5).fsh >= 0.95 && at(14).fsh > 0.8);
  assert.ok(at(20).fsh < 0.2);
  // LH: flat baseline, a surge of about a day, flat again
  for (const d of [1, 5, 10, 11, 17, 20, 28]) assert.ok(at(d).lh < 0.12, "LH baseline day " + d);
  assert.equal(at(13.5).lh, 1);
  assert.ok(at(14.5).lh < at(14).lh && at(14).lh < at(13.5).lh);
  // oestradiol: low, rises to the pre-ovulatory peak, falls after ovulation, then a lower second rise in the luteal phase
  assert.ok(at(1).e2 <= 0.12 && at(8).e2 > at(5).e2 && at(12.5).e2 >= 0.99);
  assert.ok(at(15).e2 < at(12.5).e2 * 0.4);
  const lut = Math.max(...[16, 17, 18, 19, 20, 21, 22, 23].map((d) => at(d).e2));
  assert.ok(lut > 0.4 && lut < 0.7 && lut < at(12.5).e2, "second luteal rise is lower than the pre-ovulatory peak: " + lut);
  // progesterone: flat before ovulation, rises after, peak day 21, falls toward the period
  for (const d of [1, 5, 10, 13]) assert.ok(at(d).p4 <= 0.05, "P4 low before ovulation, day " + d);
  assert.equal(at(21).p4, 1);
  assert.ok(at(15).p4 < at(18).p4 && at(18).p4 < at(21).p4 && at(21).p4 > at(25).p4 && at(25).p4 > at(28).p4);
  assert.ok(at(28).p4 < 0.2);
});

test("phases on each day of a 28 day cycle", () => {
  const rows = [];
  for (let d = 1; d <= 28; d++) { const r = C.at(d, 28); rows.push([d, r.ovarian, r.endometrium, r.subphase, r.follicle]); }
  const days = (f) => rows.filter(f).map((r) => r[0]);
  assert.deepEqual(days((r) => r[2] === "menstrual"), [1, 2, 3, 4, 5]);
  assert.deepEqual(days((r) => r[2] === "proliferative"), [6, 7, 8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(days((r) => r[2] === "secretory"), [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);
  assert.deepEqual(days((r) => r[1] === "ovulation"), [14]);
  assert.deepEqual(days((r) => r[1] === "follicular"), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(days((r) => r[1] === "luteal").length, 14);
  // sub-phases counted from the LH peak day (Stricker): early follicular to -6, late follicular -5 to -1, peak 0, early luteal +1 to +4, mid-luteal +5 to +9, late luteal +10 on
  assert.deepEqual(days((r) => r[3] === "lh-peak"), [13]);
  assert.deepEqual(days((r) => r[3] === "late-follicular"), [8, 9, 10, 11, 12]);
  assert.deepEqual(days((r) => r[3] === "early-luteal"), [14, 15, 16, 17]);
  assert.deepEqual(days((r) => r[3] === "mid-luteal"), [18, 19, 20, 21, 22]);
  assert.deepEqual(days((r) => r[3] === "late-luteal"), [23, 24, 25, 26, 27, 28]);
  assert.deepEqual(days((r) => r[3] === "early-follicular"), [1, 2, 3, 4, 5, 6, 7]);
  // follicle: corpus luteum works 10 days then regresses (OpenStax 10 to 12 days)
  assert.equal(C.at(8, 28).follicle, "dominant");
  assert.equal(C.at(14, 28).follicle, "ovulating");
  assert.equal(C.at(24, 28).follicle, "corpus-luteum");
  assert.equal(C.at(25, 28).follicle, "corpus-luteum-regressing");
});

test("the same rules hold at 21 and 35 days", () => {
  for (const L of [21, 35]) {
    const O = L - 14;
    assert.equal(C.at(O, L).ovarian, "ovulation");
    assert.equal(C.at(1, L).endometrium, "menstrual");
    assert.equal(C.at(L, L).endometrium, "secretory");
    assert.equal(C.at(O + 7, L).subphase, "mid-luteal");
    assert.equal(C.at(O + 7, L).levels.p4, 1);
  }
  assert.equal(C.at(19, 35).subphase, "late-follicular");
  assert.equal(C.at(20, 35).subphase, "lh-peak");
  assert.equal(C.at(1, 35).subphase, "early-follicular");
});

test("default length is 28; invalid input is refused with English and Hindi", () => {
  assert.equal(C.at(14).cycleLength, 28);
  for (const [d, L] of [[0, 28], [29, 28], [NaN, 28], ["5", 28], [5, 20], [5, 36], [5, 28.5], [5, "28"], [5, NaN]]) {
    const r = C.at(d, L);
    assert.equal(r.ok, false, JSON.stringify([d, L]));
    assert.ok(r.error.en && /[ऀ-ॿ]/.test(r.error.hi));
  }
  assert.equal(C.at(1, 21).ok, true);
  assert.equal(C.at(35, 35).ok, true);
  assert.equal(C.at(1, 28).ok, true);
  assert.equal(C.at(28, 28).ok, true);
});

test("curve returns one point per day, or per step", () => {
  assert.equal(C.curve(28).points.length, 28);
  assert.equal(C.curve(28, 0.5).points.length, 55);
  assert.equal(C.curve(35).points.length, 35);
  assert.equal(C.curve(20).ok, false);
  assert.equal(C.landmarks(40).ok, false);
});

test("learner text: English and Hindi, no em dash, ASCII numerals in Hindi", () => {
  const texts = [];
  (function walk(o) {
    if (o && typeof o === "object") {
      if (typeof o.en === "string" && typeof o.hi === "string") texts.push(o);
      else Object.values(o).forEach(walk);
    }
  })(C);
  for (let d = 1; d <= 28; d++) texts.push(C.at(d, 28).phaseText);
  assert.ok(texts.length > 12);
  for (const t of texts) {
    assert.ok(t.en.trim() && /[ऀ-ॿ]/.test(t.hi));
    assert.ok(!DASH.test(t.en + t.hi));
    assert.ok(!/[०-९]/.test(t.hi));
  }
});
