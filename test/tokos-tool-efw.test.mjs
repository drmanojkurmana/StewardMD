import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("efw");

test("efw: model shape and bilingual text", () => shape(m, "efw"));
test("efw: every example matches its source", () => examples(m));
test("efw: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { bpd: 1, hc: 30, ac: 30, fl: 7 }, { bpd: 9, hc: 50, ac: 30, fl: 7 }, { bpd: 9, hc: 30, ac: 30 }]));
