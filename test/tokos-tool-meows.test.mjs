import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("meows");

test("meows: model shape and bilingual text", () => shape(m, "meows"));
test("meows: every example matches its source", () => examples(m));
test("meows: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { rr: 100, spo2: 98, temp: 36.8, hr: 80, sbp: 118, dbp: 76, prot: "0", neuro: "0" }, { rr: 16, spo2: 98, temp: 36.8, hr: 80, sbp: 118, dbp: 76, neuro: "0" }, { rr: 16, spo2: 98, temp: 36.8, hr: 80, sbp: 118, dbp: 76, prot: "0", neuro: "3" }]));
