import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("dipsi");

test("dipsi: model shape and bilingual text", () => shape(m, "dipsi"));
test("dipsi: every example matches its source", () => examples(m));
test("dipsi: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { pg2h: 30 }, { pg2h: 700 }, { pg2h: "abc" }]));
