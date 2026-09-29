import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("bishop");

test("bishop: model shape and bilingual text", () => shape(m, "bishop"));
test("bishop: every example matches its source", () => examples(m));
test("bishop: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { dilation: 11, effacement: 0, station: "-3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 101, station: "-3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 50, station: "3", consistency: "firm", position: "posterior" }, { dilation: 1, effacement: 50, station: "0", position: "posterior" }, { dilation: 1, effacement: 50, station: "0", consistency: "soft", position: "mid", priorVaginal: -1 }]));
