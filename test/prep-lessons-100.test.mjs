// LINKS-100 lesson fill (tools/prep-lessons-100.mjs): two-tier verbatim gates and module targeting. All fixtures synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateLesson, targetModules } from "../tools/prep-lessons-100.mjs";

const VIS = { kind: "table", cols: ["Structure", "Origin"], rows: [["Retina", "neural ectoderm tissue"], ["Lens", "surface ectoderm tissue"]] };
const SAY = "The optic vesicle grows outward from developing forebrain tissue toward the covering ectoderm during early embryonic life of the human embryo.";
const stepOf = (tx) => ({ tx, say: SAY, vis: VIS });
const TX_OK = "The **optic vesicle** grows outward from developing forebrain tissue toward covering ectoderm during early embryonic life and meets the surface layer. Surface ectoderm thickens above the vesicle, forming the lens placode, which then folds inward to create the early hollow lens vesicle shape.";

test("gateLesson: 12-word KB copies fail, sub-20-word item echoes pass", () => {
  const kbText = "Zebra alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau";
  const itemText = "Which embryonic structure gives rise to the retina and optic nerve in the developing human eye of the early embryo first";
  const kbCopy = stepOf(TX_OK + " Zebra alpha beta gamma delta epsilon zeta eta theta iota kappa lambda extra words to reach the forty word minimum for shape ok yes");
  const p1 = gateLesson([kbCopy], { kbText, itemText: "" });
  assert.ok(p1.problems.some((p) => p.why.some((w) => w.includes("KB source"))), JSON.stringify(p1.problems));
  const echo = stepOf(TX_OK + " extra padding words here to reach forty");
  const p2 = gateLesson([echo], { kbText: "", itemText });
  assert.deepEqual(p2.problems, [], JSON.stringify(p2.problems));
  const longEcho = stepOf("Which embryonic structure gives rise to the retina and optic nerve in the developing human eye of the early embryo first " + TX_OK);
  const p3 = gateLesson([longEcho], { kbText: "", itemText });
  assert.ok(p3.problems.some((p) => p.why.some((w) => w.includes("module items"))), JSON.stringify(p3.problems));
});

test("targetModules: gap modules in, lessons/mixed/mapped out", () => {
  const all = targetModules(undefined, null, null);
  const mods = new Map(all.map((m) => [m.mid, m]));
  assert.ok(all.length > 0, "gap modules remain targeted");
  for (const m of all) {
    assert.ok(!/-mixed$/.test(m.mid), m.mid + " is mixed");
    assert.ok(m.title && m.title.length > 0, m.mid + " carries its scope");
  }
  assert.ok(!mods.has("med-heart-failure"), "modules with a bundled lesson are skipped");
  assert.ok(!mods.has("pat-mixed"), "mixed modules are never targeted");
  assert.ok(!mods.has("oph-cataract"), "KB-mapped modules are skipped");
});

test("bankFirstQuiz: bank ids win, overlay backfills", async () => {
  const { bankFirstQuiz } = await import("../tools/prep-lessons-100.mjs");
  const bank = [
    { id: "b1", q: "Heart failure drug of choice in a diabetic patient?", o: ["a", "b", "c", "d"], a: 0 },
    { id: "b2", q: "Heart failure with preserved ejection fraction management?", o: ["a", "b", "c", "d"], a: 1 },
    { id: "b3", q: "Heart failure bedside signs of congestion?", o: ["a", "b", "c", "d"], a: 2 },
  ];
  const ov = [{ id: "mk-1", q: "Heart failure bedside vignette?", o: ["a", "b", "c", "d"], a: 2 }];
  const q = bankFirstQuiz(bank, ov, ["heart failure"]);
  assert.ok(!q.some((id) => String(id).startsWith("mk-")), "no overlay id while bank covers: " + JSON.stringify(q));
  const q2 = bankFirstQuiz(bank.slice(0, 1), ov, ["heart failure"]);
  assert.ok(q2.includes("mk-1"), "overlay backfills a short bank quiz: " + JSON.stringify(q2));
});
