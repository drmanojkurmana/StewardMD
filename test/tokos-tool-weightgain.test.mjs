import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("weightgain");

test("weightgain: model shape and bilingual text", () => shape(m, "weightgain"));
test("weightgain: every example matches its source", () => examples(m));
test("weightgain: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { weight: 20, height: 165 }, { weight: 60, height: 300 }, { weight: 50, height: 170, twins: true }, { weight: 60, height: 165, current: 68, ga: 60 }]));
