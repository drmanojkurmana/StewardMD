import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("ganzoni");

test("ganzoni: model shape and bilingual text", () => shape(m, "ganzoni"));
test("ganzoni: every example matches its source", () => examples(m));
test("ganzoni: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { weight: 20, hb: 7, target: 11, stores: "500" }, { weight: 60, hb: 11, target: 11, stores: "500" }, { weight: 60, hb: 7, target: 11, stores: "700" }, { weight: 60, hb: 1, target: 11, stores: "500" }]));

test("ganzoni: per-dose limits for iron sucrose and ferric carboxymaltose are stated", () => {
  const t = m.compute({ weight: 60, hb: 7, target: 11, stores: "500" }).lines.map((l) => l.en).join(" ");
  assert.match(t, /200 mg per dose/); assert.match(t, /1000 mg per infusion/);
});
