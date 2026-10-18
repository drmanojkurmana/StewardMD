// Mechanism mastery (Trigger, Target, Mechanism, Manifestation, Intervention + adverse effects) for interactive figures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FIELDS, problems } from "../tools/figures/dev/mastery-merge.mjs";
const P = fileURLToPath(new URL("../prep/figures/", import.meta.url));
const MS = existsSync(P + "mastery.json") ? JSON.parse(readFileSync(P + "mastery.json", "utf8")) : { items: {} };
const REG = new Set(JSON.parse(readFileSync(P + "figures.json", "utf8")).figures.map((f) => f.id));
test("every mastery entry belongs to a registered figure and follows the content rules", () => {
  const bad = [];
  for (const [id, e] of Object.entries(MS.items)) { const p = REG.has(id) ? problems(e) : ["unknown figure id"]; if (p.length) bad.push(id + ": " + p.join("; ")); }
  assert.deepEqual(bad, []);
});
test("the five framework steps plus adverse effects are all present on every entry", () => {
  for (const e of Object.values(MS.items)) assert.deepEqual(Object.keys(e).sort(), [...FIELDS].sort());
});
test("the entries are flagged as AI-assisted pending clinician review", () => { assert.match(String(MS.gen || ""), /awaiting clinician review/); });
test("problems() rejects dashes, doses and thin text", () => {
  const ok = Object.fromEntries(FIELDS.map((f) => [f, "A plain accurate sentence for the test."]));
  assert.deepEqual(problems(ok), []);
  assert.ok(problems({ ...ok, trigger: "Em dash — here is not allowed in text." }).length);
  assert.ok(problems({ ...ok, adverse: "Given 500 mg twice daily it causes harm." }).length);
  assert.ok(problems({ ...ok, target: "short" }).length);
});
