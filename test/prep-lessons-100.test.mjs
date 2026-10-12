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
  const mods = new Map(targetModules(undefined, null, null).map((m) => [m.mid, m]));
  assert.ok(mods.has("bio-protein-structure"), "a top gap module is targeted");
  assert.ok(!mods.has("med-heart-failure"), "modules with a bundled lesson are skipped");
  assert.ok(!mods.has("pat-mixed"), "mixed modules are never targeted");
  assert.ok(!mods.has("oph-cataract"), "KB-mapped modules are skipped");
});
