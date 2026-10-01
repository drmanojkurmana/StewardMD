import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const U = require("../tokos-explore-ui.js");
const mech = require("../tokos-models/explorer-mechanism.js");
const cycle = require("../tokos-models/explorer-cycle.js");
const popq = require("../tokos-models/explorer-popq.js");
const cx = require("../tokos-models/explorer-cervical-screening.js");

test("signed numbers are ASCII with an explicit plus", () => {
  assert.equal(U.signed(2), "+2");
  assert.equal(U.signed(-2.5), "-2.5");
  assert.equal(U.signed(0), "0");
  assert.ok(!/[०-९]/.test(U.signed(7)));
});

test("lessonsFor: fixed ids first, then lessons whose test names the explorer; absent lessons dropped; unit level", () => {
  const ix = { units: [{ id: "gy11", level: "mbbs", lessons: ["a", "b"] }, { id: "gyr5", level: "resident", lessons: ["c"] }],
    lessons: { a: { title: { en: "A" }, minutes: 5 }, b: { title: { en: "B" }, test: { explorer: "ovarian-triage" } }, c: { title: { en: "C" }, test: { explorer: "ovarian-triage" } } } };
  const r = U.lessonsFor("ovarian-triage", ix, ["a", "missing"]);
  assert.deepEqual(r.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(r[2].level, "resident");
  assert.equal(r[0].minutes, 5);
  assert.deepEqual(U.lessonsFor("popq", ix, ["missing"]), []);
  assert.deepEqual(U.lessonsFor("popq", null, ["a"]), [], "no index: graceful absence");
});

test("cyclePaths: one path per hormone spanning the box; peak at the top", () => {
  const box = { x: 6, y: 8, w: 328, h: 140 }, cv = cycle.curve(28, 1), p = U.cyclePaths(cv.points, 28, box);
  assert.deepEqual(Object.keys(p), ["fsh", "lh", "e2", "p4"]);
  for (const h of Object.keys(p)) {
    const xs = [...p[h].matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    assert.equal(xs.length, 28);
    assert.equal(xs[0][0], 6); assert.equal(xs[27][0], 334);
    assert.ok(xs.every(([, y]) => y >= 8 - 1e-9 && y <= 148 + 1e-9));
  }
  assert.equal(U.cycleX(14, 28, box).toFixed(1), (6 + 13 / 27 * 328).toFixed(1));
});

test("POP-Q: grid holds the nine points once; bounds follow the model's ranges; noD drops D", () => {
  assert.deepEqual(U.POPQ_GRID.flat().sort(), ["Aa", "Ap", "Ba", "Bp", "C", "D", "gh", "pb", "tvl"].sort());
  assert.deepEqual(U.popqBounds("Aa", 10), [-3, 3]);
  assert.deepEqual(U.popqBounds("Bp", 9), [-3, 9]);
  assert.deepEqual(U.popqBounds("C", 9), [-9, 9]);
  const pts = { Aa: -3, Ba: -3, C: -8, D: -10, Ap: -3, Bp: -3, gh: 3, pb: 3, tvl: 10 };
  assert.equal(popq.stage(U.popqInput(pts, false)).stage, 0, "the explorer's starting values are stage 0");
  const noD = U.popqInput(pts, true);
  assert.ok(!("D" in noD) && "D" in pts, "copy, D removed, original kept");
  assert.equal(popq.stage({ ...noD, Ba: 1 }).stage, 2);
});

test("mechStep: clamps the index and returns the movement with its before and after positions", () => {
  const r = U.mechStep(mech, "LOT", false, 3);
  assert.equal(r.movement.id, "internal-rotation");
  assert.equal(r.step.before, "LOT"); assert.equal(r.step.after, "OA"); assert.equal(r.step.degrees, 90);
  assert.equal(U.mechStep(mech, "LOT", false, 99).i, 7);
  assert.equal(U.mechStep(mech, "LOT", false, -4).i, 0);
  assert.equal(U.mechStep(mech, "OP", true, 3).step.after, "OP", "persistent OP stays posterior");
  assert.equal(U.mechStep(mech, "XX", false, 0).ok, false);
});

test("cervical path: advance records the result, back undoes one step", () => {
  let p = [{ step: "start" }];
  p = U.cxAdvance(p, "age-30-65"); p.push({ step: cx.next("start", "age-30-65").step.id });
  assert.deepEqual(p, [{ step: "start", result: "age-30-65" }, { step: "via" }]);
  p = U.cxAdvance(p, "positive"); p.push({ step: "refer-gyn" });
  assert.deepEqual(U.cxBack(p), [{ step: "start", result: "age-30-65" }, { step: "via" }]);
  assert.deepEqual(U.cxBack([{ step: "start" }]), [{ step: "start" }]);
});

test("the UI file is ES5, has no em-dash, and every Hindi string keeps ASCII digits", () => {
  const src = readFileSync(new URL("../tokos-explore-ui.js", import.meta.url), "utf8");
  assert.ok(!/\b(let|const|class)\s|=>|`/.test(src), "ES5 only");
  assert.ok(!/[—–]/.test(src), "no em or en dash");
  assert.ok(!/[०-९]/.test(src), "no Devanagari digits");
  const css = readFileSync(new URL("../tokos-explore-ui.css", import.meta.url), "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]+\{|@keyframes[^{]+\{[^}]*\{[^}]*\}[^}]*\{[^}]*\}\s*\}/g, "").match(/[^{}]+\{/g) || [];
  for (const r of rules) { const sel = r.slice(0, -1).trim(); if (sel && !sel.startsWith("from") && !sel.startsWith("to")) assert.ok(/\.tok-root/.test(sel), "scoped: " + sel); }
});

test("mechanism view from below: the frames turn to the learner's start position", () => {
  const svgOf = (i) => readFileSync(new URL("../" + mech.movements[i].file, import.meta.url), "utf8");
  const below = (svg) => svg.slice(svg.indexOf('data-view="below"'));
  const rots = (svg) => [...below(svg).matchAll(/data-part="head" transform="translate\([^)]*\) rotate\(([-\d.]+)\)"/g)].map((m) => +m[1]);
  const at = (start, i, op) => { const r = U.mechStep(mech, start, op, i); return U.orientBelow(svgOf(i), mech, r.step, r.movement.id); };
  // LOT is what the files are drawn for: unchanged rotations
  for (let i = 0; i < 8; i++) assert.equal(at("LOT", i), svgOf(i), "LOT frame " + i + " is byte for byte the file");
  // ROP: engages with the occiput back and to the right (SVG angle 225 - 90 = 135)
  assert.deepEqual(rots(at("ROP", 0)), [135]);
  // internal rotation ROP to OA: dashed ROP, solid OA, and a clockwise arc (sweep flag 1)
  assert.deepEqual(rots(at("ROP", 3)), [135, -90]);
  assert.match(below(at("ROP", 3)), /A62 62 0 0 1 /);
  assert.match(below(at("LOT", 3)), /A62 62 0 0 0 /);
  // restitution and external rotation on the right: ROA then ROT, shoulders perpendicular to the head
  assert.deepEqual(rots(at("ROP", 5)), [-90, -135]);
  assert.deepEqual(rots(at("ROP", 6)), [-135, 180]);
  assert.match(below(at("ROP", 6)), /data-part="shoulders" transform="translate\([^)]*\) rotate\(-90\)"/);
  // no turn, no arrow: an OA start at internal rotation, and a persistent OP after the turn back
  assert.match(below(at("LOP", 7, true)), /data-part="shoulders" transform="translate\([^)]*\) rotate\(90\)"/); // shoulders born front to back
  assert.doesNotMatch(below(at("OA", 3)), /A62 62/);
  assert.doesNotMatch(below(at("ROP", 5, true)), /A56 56/);
});

test("popqFit: lowering tvl pulls Ba, Bp, C and D back into range", () => {
  assert.deepEqual(U.popqFit({ Aa: -3, Ba: 8, C: -8, D: -10, Ap: -3, Bp: -3, gh: 3, pb: 3, tvl: 6 }),
    { Aa: -3, Ba: 6, C: -6, D: -6, Ap: -3, Bp: -3, gh: 3, pb: 3, tvl: 6 });
});
