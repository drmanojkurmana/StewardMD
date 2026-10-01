/* test/edge-dataset.test.mjs — the Edge dataset pipeline: scorer semantics, option shuffling, the
 * trainer exports, and the frozen test set's invariants (scripts/edge/*, Edge-Master-Plan A0.4, 7.2, 7.4).
 * node --test test/edge-dataset.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decide, outcome, scoreRouter, scoreExtraction, permute, PASS_MARKS } from "../scripts/edge/metrics.mjs";
import { unit, sha, readJsonl } from "../scripts/edge/lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DS = path.join(ROOT, "vault", "plans", "edge-data", "dataset");
const C = (kind, id) => ({ kind, id, title: id });
const row = (o) => ({ id: o.id || "r", lang: "en", kind: "tool", target: "icu", accept: [], tags: [], route_by: "model",
  candidates: [C("tool", "icu"), C("tool", "ward")], target_option: 1, target_in_candidates: true, ...o });

test("decide mirrors route(): negation and empty never act, rules act on option 1, model rows follow the policy", () => {
  assert.equal(decide(row({ route_by: "negated" }), "top1").act, null);
  assert.equal(decide(row({ route_by: "empty", candidates: [] }), "top1").act, null);
  assert.equal(decide(row({ route_by: "rules" }), "rules").act.id, "icu");
  assert.equal(decide(row({}), "rules").act, null, "the Phase 0 baseline passes every model-routed row");
  assert.equal(decide(row({}), "top1").act.id, "icu");
  assert.equal(decide(row({ target_option: 2 }), "oracle").act.id, "ward");
  const preds = { a: { option: 2, confidence: 0.9 }, b: { option: 1, confidence: 0.2 }, c: { option: 7 }, d: { option: 1.5 } };
  assert.equal(decide(row({ id: "a" }), "pred", preds).act.id, "ward");
  assert.equal(decide(row({ id: "b" }), "pred", preds).act, null, "below the confidence floor");
  assert.equal(decide(row({ id: "c" }), "pred", preds).act, null, "out of range");
  assert.equal(decide(row({ id: "d" }), "pred", preds).act, null, "not an integer");
  assert.equal(decide(row({ id: "zz" }), "pred", preds).act, null, "no prediction is a pass, never a guess");
});

test("outcomes: a wrong open is counted, a pass is right when the target was not offered, accept covers duplicates", () => {
  assert.equal(outcome(row({}), C("tool", "icu")), "open_ok");
  assert.equal(outcome(row({}), C("tool", "ward")), "open_wrong");
  assert.equal(outcome(row({ target: null, kind: "none" }), C("tool", "icu")), "open_wrong", "acting on a question is wrong");
  assert.equal(outcome(row({}), null), "pass_missed");
  assert.equal(outcome(row({ target_in_candidates: false, target_option: 0 }), null), "pass_ok");
  assert.equal(outcome(row({ route_by: "negated" }), null), "pass_ok");
  const dup = row({ kind: "calculator", target: "ebv", accept: ["ebv", "blood_volume"], candidates: [C("calculator", "blood_volume")] });
  assert.equal(outcome(dup, C("calculator", "blood_volume")), "open_ok");
  assert.equal(outcome(row({}), C("calculator", "icu")), "open_wrong", "kind must match too");
});

test("scoreRouter keeps metrics separate, gates on the pass marks, and tracks the danger set", () => {
  const rows = [
    row({ id: "1", route_by: "rules" }),
    row({ id: "2" }),
    row({ id: "3", target: null, kind: "none", target_option: 0, tags: ["danger"] }),
    row({ id: "4", route_by: "negated", target: null, kind: "none", target_option: 0, tags: ["danger", "negation"] })
  ];
  const top1 = scoreRouter(rows, "top1");
  assert.equal(top1.overall.counts.open_wrong, 1, "top1 opens ICU for the question");
  assert.equal(top1.danger_pass, 0.5); assert.equal(top1.pass.all, false);
  assert.equal(top1.errors[0].id, "3");
  const rules = scoreRouter(rows, "rules");
  assert.equal(rules.overall.counts.open_wrong, 0); assert.equal(rules.danger_pass, 1);
  assert.equal(rules.overall.coverage, 0.25); assert.equal(rules.overall.accepted_route_accuracy, 1);
  assert.equal(rules.pass.all, true);
  assert.ok(rules.by.route_by.rules && rules.by.tag.negation, "broken down by route and tag");
  assert.equal(PASS_MARKS.accepted_route_accuracy, 0.99);
});

test("permute: deterministic, the label follows the option, option 0 never moves", () => {
  const r = row({ id: "p", candidates: [C("tool", "a"), C("tool", "b"), C("tool", "c"), C("tool", "d")], target: "c", target_option: 3 });
  const a = permute(r, "s1", unit), b = permute(r, "s1", unit);
  assert.deepEqual(a, b);
  assert.equal(a.candidates[a.target_option - 1].id, "c");
  const seen = new Set(); for (let i = 0; i < 20; i++) seen.add(permute(r, "s" + i, unit).target_option);
  assert.ok(seen.size >= 3, "the right option lands in different positions");
  assert.equal(permute({ ...r, target: null, target_option: 0 }, "s2", unit).target_option, 0);
});

test("scoreExtraction: a wrong value and an accepted trap are unsafe, a miss is not", () => {
  const gold = [
    { id: "a", text: "x", expect: { scr_mg_dl: 1.4 }, absent: [], tags: [] },
    { id: "b", text: "y", expect: {}, absent: ["glucose_mg_dl"], tags: ["family"] },
    { id: "c", text: "z", expect: { weight_kg: 60 }, absent: [], tags: [] }
  ];
  const out = { x: { scr_mg_dl: { value: 1.8 } }, y: { glucose_mg_dl: { value: 300 } }, z: {} };
  const rep = scoreExtraction(gold, (t) => ({ usable: out[t] }));
  assert.equal(rep.unsafe_fields, 2); assert.equal(rep.pass, false);
  assert.deepEqual(rep.errors.map((e) => e.kind).sort(), ["missed", "trap-accepted", "wrong-value"]);
  const ok = scoreExtraction([gold[0]], () => ({ usable: { scr_mg_dl: { value: 1.404 } } }));
  assert.equal(ok.unsafe_fields, 0, "1% numeric tolerance (conversions round)");
});

test("exports: platform chat format with string arguments, Needle refusal for none, llama {option}", async () => {
  const { FORMAT, checkRow } = await import("../scripts/edge/export.mjs");
  const r = row({ input_text: "show me the icu", target_option: 1 });
  const c = FORMAT.cactus(r);
  assert.deepEqual(c.messages.map((m) => m.role), ["system", "user", "assistant"]);
  assert.equal(typeof c.messages[2].tool_calls[0].function.arguments, "string");
  assert.deepEqual(JSON.parse(c.messages[2].tool_calls[0].function.arguments), { option: 1 });
  assert.equal(c.tools[0].type, "function"); assert.equal(c.tools[0].function.name, "choose_option");
  assert.match(c.messages[1].content, /1\. open: icu[\s\S]*0\. none of these/);
  const none = FORMAT.cactus({ ...r, target: null, target_option: 0 });
  assert.equal(none.messages[2].tool_calls, undefined, "none is Needle's own refusal (answers [])");
  assert.deepEqual(FORMAT["needle-local"]({ ...r, target_option: 0 }).answers, []);
  assert.deepEqual(FORMAT["needle-local"](r).answers, [{ name: "choose_option", arguments: { option: 1 } }]);
  assert.equal(FORMAT["llama-json"](r).messages[2].content, '{"option":1}');
  assert.throws(() => checkRow({ ...r, target_option: 2 }), /does not point at the target/);
});

const frozen = fs.existsSync(path.join(DS, "test.jsonl")) && fs.existsSync(path.join(DS, "manifest.json"));
test("frozen test set: hash matches the manifest, synthetic schema, splits by family, danger rows present", { skip: !frozen && "dataset not generated" }, () => {
  const man = JSON.parse(fs.readFileSync(path.join(DS, "manifest.json"), "utf8"));
  const txt = fs.readFileSync(path.join(DS, "test.jsonl"), "utf8");
  assert.equal(sha(txt), man.sha256.test, "test.jsonl changed without a new manifest (frozen: bump schema_version)");
  const rows = readJsonl(path.join(DS, "test.jsonl"));
  assert.equal(rows.length, man.counts.test);
  assert.ok(rows.every((r) => r.schema_version === man.schema_version && r.split === "test"));
  assert.ok(rows.every((r) => !r.target || r.target_option === 0 || r.candidates[r.target_option - 1].kind === r.kind), "labels point at the target kind");
  const tags = new Set(rows.flatMap((r) => r.tags));
  ["danger", "negation", "heldout-phrasing", "heldout-target"].forEach((t) => assert.ok(tags.has(t), "has " + t + " rows"));
  ["en", "hi-Latn", "te-Latn"].forEach((l) => assert.ok(rows.some((r) => r.lang === l), "has " + l));
  assert.ok(rows.filter((r) => r.tags.includes("negation")).every((r) => r.route_by === "negated"), "every negation is caught by the guard");
  assert.ok(rows.some((r) => r.route_by === "model" && !r.target), "the model must learn to decline");
});
