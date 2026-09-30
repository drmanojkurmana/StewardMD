import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("mgso4");

test("mgso4: model shape and bilingual text", () => shape(m, "mgso4"));
test("mgso4: every example matches its source", () => examples(m));
test("mgso4: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { regimen: "pritchard" }, { regimen: "pritchard", phase: "maintenance", rr: -1, urine4h: 120, reflex: true }, { regimen: "pritchard", phase: "maintenance", rr: 18, urine4h: 5000, reflex: true }, { regimen: "pritchard", phase: "maintenance", rr: 18, urine4h: 120 }, { regimen: "x", phase: "loading" }]));
