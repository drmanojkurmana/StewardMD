import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("apgar");

test("apgar: model shape and bilingual text", () => shape(m, "apgar"));
test("apgar: every example matches its source", () => examples(m));
test("apgar: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { color: "2", heart: "2", reflex: "2", tone: "2" }, { color: "3", heart: "2", reflex: "2", tone: "2", resp: "2" }]));
