import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("rmi");

test("rmi: model shape and bilingual text", () => shape(m, "rmi"));
test("rmi: every example matches its source", () => examples(m));
test("rmi: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { ca125: -1 }, { ca125: 1e9 }, { ca125: "x" }]));
