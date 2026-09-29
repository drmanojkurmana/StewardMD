import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("vbac");

test("vbac: model shape and bilingual text", () => shape(m, "vbac"));
test("vbac: every example matches its source", () => examples(m));
test("vbac: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { age: 10, weight: 70, height: 160, priorVaginal: "none" }, { age: 30, weight: 70, height: 160 }, { age: 30, weight: 500, height: 160, priorVaginal: "none" }]));
