import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("antid");

test("antid: model shape and bilingual text", () => shape(m, "antid"));
test("antid: every example matches its source", () => examples(m));
test("antid: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { guideline: "bsh", pct: 25 }, { guideline: "bsh", pct: 0.5, given: 6000 }, { guideline: "fogsi", pct: 1 }, { guideline: "fogsi", pct: 1, mbv: 5000 }, { guideline: "fogsi", pct: 1, mbv: 100, hct: 40 }, { guideline: "zzz", pct: 1 }]));
