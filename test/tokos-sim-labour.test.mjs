// Pure view-model helpers of the labour room simulator screen (tokos-sim-labour.js) against the real model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const V = require("../tokos-sim-labour.js");
const M = require("../tokos-models/drill-labour.js");

test("clockText: ASCII digits in both languages, zero-padded minutes", () => {
  assert.equal(V.clockText(0, "en"), "0 h 00 min");
  assert.equal(V.clockText(135, "en"), "2 h 15 min");
  assert.equal(V.clockText(65, "hi"), "1 घंटे 05 मिनट");
  assert.ok(!/[०-९]/.test(V.clockText(605, "hi")));
});

test("fsrsGrade: good is Good, ok is Hard, poor or unknown is Again", () => {
  assert.equal(V.fsrsGrade("good"), 3);
  assert.equal(V.fsrsGrade("ok"), 2);
  assert.equal(V.fsrsGrade("poor"), 1);
  assert.equal(V.fsrsGrade(null), 1);
});

test("advance: 5-minute steps give one sample each and match a single model step", () => {
  const s0 = M.init(42, "normal-primi"), samples = [V.sample(s0)];
  const a = V.advance(M, s0, 60, samples);
  const b = M.step(s0, "observe", 60);
  assert.equal(samples.length, 13);
  assert.deepEqual(a, b);
  assert.deepEqual(samples.map((p) => p.t), [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
});

test("advance stops at birth and the normal scenario reaches a spontaneous birth", () => {
  let s = M.init(7, "normal-multi"); const samples = [V.sample(s)];
  for (let i = 0; i < 40 && !s.delivered; i++) s = V.advance(M, s, 60, samples);
  assert.ok(s.delivered, "delivered");
  assert.equal(s.delivered.mode, "svd");
  assert.equal(samples[samples.length - 1].t, s.t);
  assert.equal(M.outcome(s).grade, "good");
});

test("chartModel: geometry stays inside the panels, hours grow with the run", () => {
  let s = M.init(3, "normal-primi"); const samples = [V.sample(s)];
  let c = V.chartModel(samples);
  assert.equal(c.hours, 4);
  assert.equal(c.ticks.length, 5);
  for (let i = 0; i < 40 && !s.delivered; i++) s = V.advance(M, s, 60, samples);
  c = V.chartModel(samples);
  const g = V.GEO;
  assert.ok(c.hours >= Math.ceil(s.t / 60));
  c.dil.forEach(([x, y]) => { assert.ok(x >= g.X0 && x <= g.X1); assert.ok(y >= g.dTop && y <= g.dBot); });
  c.st.forEach(([, y]) => assert.ok(y >= g.sTop && y <= g.sBot));
  assert.equal(c.dil[c.dil.length - 1][1], g.dTop, "fully dilated sits on the 10 cm line");
  assert.equal(c.yd(4), g.dBot);
  assert.equal(c.ys(-3), g.sTop); assert.equal(c.ys(3), g.sBot);
  c.uc.forEach((b) => { assert.ok(b.h <= 6 * g.uUnit); assert.equal(b.over, b.n > 5); });
});

test("chartModel: CTG strip merges runs of one class and covers the whole run", () => {
  const mk = (t, figo) => ({ t, dil: 5, station: -1, uc: 4, figo, oxy: false });
  const c = V.chartModel([mk(0, "normal"), mk(5, "normal"), mk(10, "suspicious"), mk(15, "suspicious"), mk(20, "pathological")]);
  assert.deepEqual(c.fhr.map((f) => f.c), ["normal", "suspicious", "pathological"]);
  assert.equal(c.fhr[0].x2, c.fhr[1].x1);
  assert.equal(c.fhr[0].x1, V.GEO.X0);
});

test("chartModel: tachysystole bars are flagged over 5 in 10 minutes", () => {
  const mk = (t, uc) => ({ t, dil: 5, station: -1, uc, figo: "normal", oxy: true });
  const c = V.chartModel([mk(0, 2), mk(5, 3), mk(10, 4), mk(15, 6), mk(20, 6)]);
  assert.deepEqual(c.uc.map((b) => b.over), [false, true]);
});

test("eventsSince returns only the new events", () => {
  const s0 = M.init(1, "slow-primi"), n = s0.events.length;
  const s1 = M.step(s0, "oxytocin_start", 0);
  assert.deepEqual(V.eventsSince(s1, n).map((e) => e.code), ["oxytocin_start"]);
});

test("FIGO class ids used by the screen are the CTG deck's", () => {
  const deck = JSON.parse(readFileSync(new URL("../tokos/decks/ctg.json", import.meta.url)));
  const classes = new Set(deck.cases.map((c) => c.figo));
  V.FIGO.forEach((f) => assert.ok(classes.has(f) || f === "pathological", f));
});

test("screen file: ES5 shape, no em or en dash, no Devanagari digits", () => {
  const src = readFileSync(new URL("../tokos-sim-labour.js", import.meta.url), "utf8") + readFileSync(new URL("../tokos-sim-labour.css", import.meta.url), "utf8");
  assert.ok(!/[\u2013\u2014]/.test(src), "dash");
  assert.ok(!/[०-९]/.test(src), "Devanagari digits");
  assert.ok(!/\b(let|const)\s|=>|`/.test(readFileSync(new URL("../tokos-sim-labour.js", import.meta.url), "utf8")), "ES5");
  assert.ok(!/^[^/@\s}][^{]*\{/m.test(readFileSync(new URL("../tokos-sim-labour.css", import.meta.url), "utf8").split("\n").filter((l) => !/^\s|^\.tok-root|^@media|^\/\*|^\s*\*|^}/.test(l)).join("\n")), "CSS scoped");
});
