import test from "node:test";
import assert from "node:assert/strict";
import { load, shape, examples, rejects } from "./tokos-tool-helpers.mjs";

const m = load("mgso4");

test("mgso4: model shape and bilingual text", () => shape(m, "mgso4"));
test("mgso4: every example matches its source", () => examples(m));
test("mgso4: invalid inputs give ok:false with en and hi error", () => rejects(m, [{}, { regimen: "pritchard" }, { regimen: "pritchard", phase: "maintenance", rr: -1, urine4h: 120, reflex: true }, { regimen: "pritchard", phase: "maintenance", rr: 18, urine4h: 5000, reflex: true }, { regimen: "pritchard", phase: "maintenance", rr: 18, urine4h: 120 }, { regimen: "x", phase: "loading" }]));

test("mgso4: oliguria alone withholds the dose without calcium gluconate", () => {
  const r = m.compute({ regimen: "pritchard", phase: "maintenance", reflex: "1", rr: 18, urine4h: 80 });
  assert.equal(r.value, 0);
  const t = r.lines.map((l) => l.en).join(" ");
  assert.match(t, /Withhold this dose/);
  assert.doesNotMatch(t, /give 10 mL of 10% calcium gluconate/);
});
test("mgso4: respiratory depression (RR under 12) gives the toxicity management", () => {
  const t = m.compute({ regimen: "pritchard", phase: "maintenance", reflex: "0", rr: 10, urine4h: 80 }).lines.map((l) => l.en).join(" ");
  assert.match(t, /calcium gluconate slow IV/);
});
test("mgso4: loading dose tells what to do if a convulsion recurs", () => {
  assert.match(m.compute({ regimen: "pritchard", phase: "loading" }).lines.map((l) => l.en).join(" "), /further 2 g IV/);
});
