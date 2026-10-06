/* PrepNucleus Lessons: data validation (prep-lessons.js pure helpers the reader draws with) and the generator's gates
 * and pipeline (tools/prep-lessons.mjs). What must hold: a visual that cannot be drawn on a phone is refused (table
 * 2-5 cols x 2-8 rows with matching rows, flow 3-8 nodes without a cycle and at most 3 a level, compare 1-6 points a
 * side, image only from an in-app path); a step is 40-90 words with a bold term and narration under 120 words; bold
 * is escaped; every number and drug in a step must be in the grounding; a 12-word copy, a dash or an uncleared image
 * fails; book citations never reach the grounding; the dry run makes no call; the Batch pipeline regenerates a failed
 * step once and drops it if it fails again; a hand-written lesson is never overwritten; the committed sample passes.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-lessons.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as G from "../tools/prep-lessons.mjs";
import { loadTaxonomy } from "../tools/prep-build-bank.mjs";

const req = createRequire(import.meta.url);
const P = req("../prep-lessons.js");
const T = req("../prep-teacher.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = JSON.parse(fs.readFileSync(join(ROOT, "prep/lessons/v1/sur-breast-cancer.json"), "utf8"));

const W = (n, w = "word") => Array.from({ length: n }, () => w).join(" ");
const step = (o = {}) => Object.assign({ tx: "**Key term** " + W(48), say: "Plain narration " + W(20), vis: null }, o);
const table = (cols, rows) => ({ kind: "table", cols, rows });

/* ---------------- visuals ---------------- */
test("table: 2 to 5 named columns, 2 to 8 rows of the same width", () => {
  assert.equal(P.checkVis(table(["A", "B"], [["1", "2"], ["3", "4"]])), "");
  assert.match(P.checkVis(table(["A"], [["1"], ["2"]])), /2 to 5/);
  assert.match(P.checkVis(table(["A", "B", "C", "D", "E", "F"], [["1", "2", "3", "4", "5", "6"], ["1", "2", "3", "4", "5", "6"]])), /2 to 5/);
  assert.match(P.checkVis(table(["A", "B"], [["1", "2"]])), /2 to 8 rows/);
  assert.match(P.checkVis(table(["A", "B"], Array.from({ length: 9 }, () => ["x", "y"]))), /2 to 8 rows/);
  assert.match(P.checkVis(table(["A", "B"], [["1", "2"], ["3"]])), /row 2/);
  assert.match(P.checkVis(table(["A", "B"], [["1", "2"], ["3", " "]])), /row 2/);
});
test("flow: 3 to 8 nodes, known ids, no cycle, every node joined, at most 3 a level", () => {
  const n = (ids) => ids.map((id) => ({ id, label: id.toUpperCase() }));
  assert.equal(P.checkVis({ kind: "flow", nodes: n(["a", "b", "c"]), edges: [["a", "b"], ["b", "c", "then"]] }), "");
  assert.match(P.checkVis({ kind: "flow", nodes: n(["a", "b"]), edges: [["a", "b"]] }), /3 to 8/);
  assert.match(P.checkVis({ kind: "flow", nodes: n(["a", "b", "c"]), edges: [["a", "b"], ["b", "c"], ["c", "a"]] }), /cycle/);
  assert.match(P.checkVis({ kind: "flow", nodes: n(["a", "b", "c"]), edges: [["a", "x"]] }), /cycle|known/);
  assert.match(P.checkVis({ kind: "flow", nodes: n(["a", "b", "c"]), edges: [["a", "b"]] }), /every flow node/);
  assert.match(P.checkVis({ kind: "flow", nodes: n(["a", "a", "c"]), edges: [["a", "c"]] }), /unique/);
  assert.match(P.checkVis({ kind: "flow", nodes: n(["r", "a", "b", "c", "d"]), edges: [["r", "a"], ["r", "b"], ["r", "c"], ["r", "d"]] }), /more than 3/);
});
test("flowLevels: longest path layering, null on a cycle", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id }));
  assert.deepEqual(P.flowLevels(nodes, [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["a", "d"]]), [["a"], ["b", "c"], ["d"]]);
  assert.equal(P.flowLevels(nodes, [["a", "b"], ["b", "a"]]), null);
});
test("compare and image", () => {
  const side = { title: "T", points: ["p"] };
  assert.equal(P.checkVis({ kind: "compare", left: side, right: side }), "");
  assert.match(P.checkVis({ kind: "compare", left: side, right: { title: "T", points: [] } }), /1 to 6/);
  const img = (src) => ({ kind: "image", src, alt: "a", caption: "c" });
  assert.equal(P.checkVis(img("prep/lessons/media/breast-t-size.svg")), "");
  for (const bad of ["https://x.org/a.png", "../secret.png", "prep/../a.svg", "javascript:alert(1)", "a.gif"]) assert.match(P.checkVis(img(bad)), /in-app/, bad);
  assert.match(P.checkVis({ kind: "image", src: "prep/a.svg", alt: "", caption: "c" }), /alt/);
  assert.match(P.checkVis({ kind: "chart" }), /unknown/);
  assert.equal(P.checkVis(null), "");
});
test("step shape: 40-90 words, a bold term, narration under 120 words without markup", () => {
  assert.deepEqual(P.checkStep(step()), []);
  assert.match(P.checkStep(step({ tx: "**Short** text" })).join(), /words/);
  assert.match(P.checkStep(step({ tx: "**K** " + W(95) })).join(), /words/);
  assert.match(P.checkStep(step({ tx: W(50) })).join(), /bold/);
  assert.match(P.checkStep(step({ tx: "**K** **open " + W(48) })).join(), /unmatched/);
  assert.match(P.checkStep(step({ say: W(120) })).join(), /under 120/);
  assert.match(P.checkStep(step({ say: "a **b** c" })).join(), /markup/);
});
test("boldHtml escapes and bolds; boldTerms lists the terms", () => {
  assert.equal(P.boldHtml("a **b<i>** & c"), "a <b>b&lt;i&gt;</b> &amp; c");
  assert.equal(P.boldHtml("odd ** mark"), "odd ** mark");
  assert.deepEqual(P.boldTerms("**x** and **y z**"), ["x", "y z"]);
});
test("speeds cycle 0.75, 1, 1.25, 1.5; swipe needs a clear horizontal move", () => {
  assert.deepEqual([0.75, 1, 1.25, 1.5].map(P.nextSpeed), [1, 1.25, 1.5, 0.75]);
  assert.equal(P.speedLabel(0.75), ".75x");
  assert.equal(P.swipeDir(-80, 10), 1); assert.equal(P.swipeDir(80, 10), -1);
  assert.equal(P.swipeDir(-40, 0), 0); assert.equal(P.swipeDir(-80, 70), 0);
});
test("pickQuiz keeps the lesson's order and skips missing ids", () => {
  assert.deepEqual(P.pickQuiz([{ id: "a" }, { id: "b" }], ["b", "x", "a"]).map((x) => x.id), ["b", "a"]);
});

/* ---------------- the committed sample ---------------- */
test("sample lesson: drawable, hand-written, 3 quiz ids, every visual kind, in the index", () => {
  assert.deepEqual(P.checkLesson(SAMPLE), []);
  assert.equal(SAMPLE.gen, "hand");
  assert.equal(SAMPLE.quiz.length, 3);
  assert.deepEqual([...new Set(SAMPLE.steps.map((s) => s.vis && s.vis.kind))].sort(), ["compare", "flow", "image", "table"]);
  const ix = JSON.parse(fs.readFileSync(join(ROOT, "prep/lessons/v1/index.json"), "utf8"));
  assert.deepEqual(ix.modules["sur-breast-cancer"], { title: SAMPLE.title, minutes: SAMPLE.minutes, steps: SAMPLE.steps.length, gen: "hand" });
  for (const s of SAMPLE.steps) if (s.vis && s.vis.kind === "image") assert.ok(fs.existsSync(join(ROOT, s.vis.src)), s.vis.src);
  assert.ok(!/[–—]/.test(JSON.stringify(SAMPLE)), "no em or en dash in app text");
});
test("sample lesson: passes every code gate against its KB grounding", async () => {
  const r = await G.main(["--check", "prep/lessons/v1/sur-breast-cancer.json"], { log: () => {} });
  assert.deepEqual(r.problems, []);
  assert.ok(r.src.includes("kb-reference-breast-cancer"));
});

/* ---------------- gates ---------------- */
const GROUND = "Tamoxifen is used for ER positive disease for 5 years. Trastuzumab targets HER2. Both breasts are imaged because up to 3% have contralateral disease.";
test("gate: numbers and drugs must be in the grounding", () => {
  const ok = step({ tx: "**Tamoxifen** suits ER positive disease and is given for 5 years. " + W(40), say: "Tamoxifen is given for 5 years." });
  assert.deepEqual(G.gateStep(ok, GROUND), []);
  assert.match(G.gateStep(step({ tx: "**Tamoxifen** for 10 years. " + W(40) }), GROUND).join(), /numbers not in the source: 10/);
  assert.match(G.gateStep(step({ say: "Letrozole is an option." }), GROUND).join(), /drugs not in the source: letrozole/);
  assert.match(G.gateStep(step({ vis: table(["Drug", "Use"], [["Anastrozole", "ER"], ["Tamoxifen", "ER"]]) }), GROUND).join(), /anastrozole/, "the visual is checked too");
});
test("gate: no 12-word copy, no dash, only cleared images", () => {
  const copy = step({ tx: "**Copy** both breasts are imaged because up to 3% have contralateral disease and more. " + W(36) });
  assert.doesNotMatch(G.gateStep(copy, GROUND).join(), /copies/, "11 shared words pass");
  const copy12 = step({ tx: "**Copy** Tamoxifen is used for ER positive disease for 5 years. Trastuzumab targets HER2. " + W(30) });
  assert.match(G.gateStep(copy12, GROUND).join(), /copies 12/);
  assert.match(G.gateStep(step({ say: "Short — dashed" }), GROUND).join(), /dash/);
  assert.match(G.gateStep(step({ vis: { kind: "image", src: "assets/kardiox-learn/x.png", alt: "a", caption: "c" } }), GROUND).join(), /not cleared/);
  assert.deepEqual(G.gateStep(step({ vis: { kind: "image", src: "prep/lessons/media/breast-t-size.svg", alt: "a", caption: "c" } }), GROUND), []);
});
test("grounding: citations and metadata are stripped", () => {
  assert.equal(G.stripCites("About 70% are 55 or older (Harrison 22e p.632)."), "About 70% are 55 or older.");
  assert.equal(G.stripCites("PMRT is mandatory (Standard Guidelines (NCCN), BINV-3; kb/oncotree/breast.json) here."), "PMRT is mandatory here.");
  assert.equal(G.stripCites("Peau d'orange (IBC-1) and normal (left) text."), "Peau d'orange and normal (left) text.");
  const flat = G.flattenDoc({ id: "x", name: "Breast cancer", source: "Bailey and Love book", references: ["Ref one two three four"], harrison: { pearls: ["Core biopsy gives the receptor status (Harrison 22e p.634)."] }, review: { status: "ai drafted by someone" } });
  assert.deepEqual(flat, ["Core biopsy gives the receptor status."]);
});
test("quiz: unflagged, best match first, 'except' stems last, deterministic", () => {
  const items = [
    { id: "q1", q: "Drug for HER2 positive breast cancer?", o: ["Trastuzumab", "B", "C", "D"], exp: "Trastuzumab targets HER2." },
    { id: "q2", q: "All are true about trastuzumab HER2 except", o: ["a", "b", "c", "d"], exp: "x" },
    { id: "q3", q: "HER2 trastuzumab", o: ["a", "b", "c", "d"], flags: ["key-disputed"] },
    { id: "q4", q: "Unrelated question on the thyroid gland", o: ["a", "b", "c", "d"], exp: "y" },
  ];
  assert.deepEqual(G.pickQuizIds(items, ["Trastuzumab", "HER2-positive"], 2), ["q1", "q2"]);
  assert.ok(!G.pickQuizIds(items, ["HER2"], 3).includes("q3"));
});
test("schemas: no one-letter keys (Vertex Batch reads f and t as booleans)", () => {
  const keys = [];
  (function walk(o) { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "properties") Object.keys(v).forEach((x) => keys.push(x)); walk(v); } })(G.SCHEMAS);
  assert.ok(keys.length > 10);
  assert.deepEqual(keys.filter((k) => k.length < 2), []);
});
test("toStep turns the model's flat step into the lesson format", () => {
  const s = G.toStep({ tx: "t", say: "s", vk: "flow", nodes: [{ nid: "a", lab: "A" }, { nid: "b", lab: "B", sub: "b" }], edges: [{ src: "a", dst: "b", lab: "if" }] });
  assert.deepEqual(s.vis, { kind: "flow", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B", sub: "b" }], edges: [["a", "b", "if"]] });
  assert.equal(G.toStep({ tx: "t", say: "s", vk: "none" }).vis, null);
  assert.deepEqual(G.toStep({ tx: "t", say: "s", vk: "compare", lt: "L", lp: ["x"], rt: "R", rp: ["y"] }).vis, { kind: "compare", left: { title: "L", points: ["x"] }, right: { title: "R", points: ["y"] } });
});

/* ---------------- CLI ---------------- */
test("dry run: no Vertex client is made and no call is sent; a cost comes back", async () => {
  const lines = [];
  const r = await G.main(["--dry-run", "--module", "sur-breast-cancer,sca-hf-acute"], { log: (l) => lines.push(l), vertex: { get batch() { throw new Error("called"); } }, fetch: () => { throw new Error("network"); } });
  assert.equal(r.dryRun, true);
  assert.equal(r.modules.length, 2);
  assert.ok(r.total.usd > 0 && r.total.usd < 0.1, String(r.total.usd));
  assert.match(lines[0], /DRY RUN \(no calls\)/);
});

// A fake Vertex Batch: answers each stage from a function of the request's key.
function fakeVertex(answer) {
  const log = [], jobs = new Map();
  return {
    cfg: { model: "gemini-3.1-flash-lite" }, log, submitted: [],
    batch: {
      async submit({ name, lines }) { const id = "jobs/" + name; jobs.set(id, { name, lines }); this.owner.submitted.push(name); return { jobId: id }; },
      async wait(jobId) { return { jobId, state: "JOB_STATE_SUCCEEDED" }; },
      async results(info, lines) { const job = jobs.get(info.jobId); return new Map(lines.map((l) => [l.key, { text: JSON.stringify(answer(job.name, l.key, l.request)), finishReason: "STOP" }])); },
    },
  };
}
test("pipeline: gen, self-check, one redo, re-check; a step failing twice is dropped; hand lessons are kept", async () => {
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "prep-lessons-"));
  // Labels are words: a digit in a step would have to be in the pack too.
  const good = (i) => ({ tx: "**Heart failure** step " + i + " explains the idea in plain words. " + W(40, "clear"), say: "Narration for step " + i + ".", vk: "table", cols: ["Feature", "Meaning"], rows: [["One", "Thing"], ["Two", "Other"]] });
  const vx = fakeVertex((name, key) => {
    if (name.endsWith("01-gen")) return { ttl: "Acute heart failure", st: [good("alpha"), good("beta"), good("gamma"), good("delta"), { ...good("epsilon"), tx: "**Bad** furosemide 999 mg. " + W(40) }, good("zeta")] };
    if (name.endsWith("02-check")) return { res: [0, 1, 2, 3, 4].map((idx) => ({ idx, unsup: idx === 1, why: idx === 1 ? "invented claim" : "" })) };
    if (name.endsWith("03-redo")) return key.endsWith("#1") ? good("redone") : { ...good("again"), tx: "**Still bad** 777 units. " + W(40) };
    if (name.endsWith("04-check")) return { res: [{ idx: 0, unsup: false, why: "" }] };
    return {};
  });
  vx.batch.owner = vx;
  const state = { v: 1, run: "t", modules: ["sca-hf-acute"], stages: {} };
  const ctx = { root: ROOT, modules: G.moduleIndex(loadTaxonomy(join(ROOT, "prep/taxonomy"))), outDir: tmp, log: () => {},
    vx, work: join(tmp, "work"), state, save: () => {}, pollMs: 0, noWait: false, maxWaitMs: 0 };
  const res = await G.run(ctx, ["sca-hf-acute"]);
  assert.deepEqual(vx.submitted.map((n) => n.split("/").pop()), ["01-gen", "02-check", "03-redo", "04-check"]);
  assert.equal(res[0].steps, 5, JSON.stringify(res));
  assert.equal(res[0].dropped, 1);
  const out = JSON.parse(fs.readFileSync(join(tmp, "sca-hf-acute.json"), "utf8"));
  assert.equal(out.gen, "AI");
  assert.deepEqual(P.checkLesson(out), []);
  assert.match(out.steps[1].tx, /step redone/, "the redone step takes the failed step's place");
  assert.equal(out.checks.redone, 1);
  assert.ok(JSON.parse(fs.readFileSync(join(tmp, "index.json"), "utf8")).modules["sca-hf-acute"]);
  // Resume: every stage is saved, so a second run makes no new submission.
  const before = vx.submitted.length;
  await G.run(ctx, ["sca-hf-acute"]);
  assert.equal(vx.submitted.length, before);
  // A hand-written lesson is never overwritten.
  fs.writeFileSync(join(tmp, "sca-hf-acute.json"), JSON.stringify({ ...out, gen: "hand", title: "Mine" }));
  const r2 = await G.run(ctx, ["sca-hf-acute"]);
  assert.equal(r2[0].skipped, "hand-written lesson kept");
  assert.equal(JSON.parse(fs.readFileSync(join(tmp, "sca-hf-acute.json"), "utf8")).title, "Mine");
});

/* ---------------- Ask MaiK about a step (prep-teacher.js) ---------------- */
test("teachStep: the step is the grounding and the answer is checked like the question teacher", async () => {
  const st = SAMPLE.steps[6];
  const ok = await T.teachStep(st, "Breast cancer", { generate: () => "Hormone-sensitive cancer gets tamoxifen or an aromatase inhibitor. Remember: receptors decide." });
  assert.equal(ok.ok, true);
  const bad = await T.teachStep(st, "Breast cancer", { generate: () => "Give letrozole 2.5 mg daily." });
  assert.equal(bad.ok, false); assert.equal(bad.reason, "check");
  assert.equal((await T.teachStep(st, "x", {})).reason, "no-model");
  assert.equal((await T.teachStep(st, "x", { generate: () => ({ error: "x" }) })).reason, "model-error");
});
