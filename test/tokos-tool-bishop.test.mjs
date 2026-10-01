import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("bishop");

test("bishop: model shape and bilingual text", () => shape(m, "bishop"));
test("bishop: every example matches its source", () => examples(m));
test("bishop: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { dilation: 11, effacement: 0, station: "-3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 101, station: "-3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 50, station: "3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 50, station: "0", position: "posterior" }, { dilation: 1, effacement: 50, station: "0", consistency: "soft", position: "mid", priorVaginal: -1 }]));

test("bishop: NICE NG207 bands (6 or less ripen; more than 6 amniotomy and oxytocin)", () => {
  const base = { effacement: 40, station: "-2", consistency: "medium", position: "mid" };
  const six = m.compute({ ...base, dilation: 2, position: "anterior" }); // 1+1+1+1+2 = 6
  assert.equal(six.value, 6); assert.match(six.lines.at(-1).en, /6 or less: unfavourable/);
  const seven = m.compute({ ...base, dilation: 3, position: "anterior" }); // 2+1+1+1+2 = 7
  assert.equal(seven.value, 7); assert.match(seven.lines.at(-1).en, /amniotomy and oxytocin/);
});
test("bishop: nulliparity with previous vaginal births is rejected; the total never goes below 0", () => {
  assert.equal(m.compute({ dilation: 1, effacement: 40, station: "-2", consistency: "medium", position: "mid", nullip: true, priorVaginal: 2 }).ok, false);
  assert.equal(m.compute({ dilation: 0, effacement: 0, station: "-3", consistency: "firm", position: "posterior", nullip: true, postdates: true, pprom: true }).value, 0);
});
