import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("ganzoni");

test("ganzoni: model shape and bilingual text", () => shape(m, "ganzoni"));
test("ganzoni: every example matches its source", () => examples(m));
test("ganzoni: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { weight: 20, hb: 7, target: 11, stores: "500" }, { weight: 60, hb: 11, target: 11, stores: "500" }, { weight: 60, hb: 7, target: 11, stores: "700" }, { weight: 60, hb: 1, target: 11, stores: "500" }]));
