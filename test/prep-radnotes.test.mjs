/* PrepNucleus radnotes (tools/prep-radnotes.mjs): the owner's notes PDFs -> lessons and overlay MCQs. What must hold:
 * OCR hyphen breaks are joined and exam-question text never becomes grounding; a panel picture gets only its own panel's
 * caption; a lesson figure step points at the radnotes API path and still needs the text gates; an explanation must
 * name the stored answer, give a reason for every wrong option and carry no source/AI label, dash or stray number;
 * image items carry img + imgPlace "stem"; near-duplicate stems are dropped; the live lessons index keeps every old
 * entry; a missing or doubtful image vote rejects that use. No network, no model calls.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-radnotes.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../tools/prep-radnotes.mjs";

test("cleanBlock joins OCR hyphen breaks", () => {
  assert.equal(R.cleanBlock("trans- parent film   is\nwhite"), "transparent film is white");
});

test("sentencesOf keeps headings apart and drops exam-question text", () => {
  const s = R.sentencesOf([
    { p: 1, t: "Pleural effusion" },
    { p: 1, t: "Fluid collects in the costophrenic angle. Identify the infection from the chest X-ray?" },
    { p: 1, t: "[NEET 19] The posterior angle fills first in most patients." },
    { p: 2, t: "12" },
  ]);
  assert.deepEqual(s.map((x) => x.tx), ["Fluid collects in the costophrenic angle."]);
  assert.equal(s[0].h, "Pleural effusion");
});

test("panelCaption keeps the title and only the asked panel", () => {
  const c = "Fig.2-15: Left pleural effusion. A. PA film shows fluid. B. Lateral film shows the fissure. C. Decubitus view.";
  assert.equal(R.panelCaption(c, "B"), "Left pleural effusion. Lateral film shows the fissure.");
  assert.equal(R.panelCaption(c, ""), "Left pleural effusion. A. PA film shows fluid. B. Lateral film shows the fissure. C. Decubitus view.");
});

test("a figure step uses the radnotes path and the text gates", () => {
  const f = { id: "n1-p006-1", caption: "Fig.2-15: Left pleural effusion. A. PA film.", panel: "A", shows: "PA chest X-ray, left effusion" };
  const tx = "On an upright film fluid gathers in the **costophrenic angle** and blunts it. The posterior angle is the deepest and fills first, so a lateral view shows a small effusion better than a frontal view. A decubitus view moves free fluid along the chest wall where it is easy to see.";
  const st = R.toFigStep({ tx, say: "Fluid gathers in the costophrenic angle and blunts it.", vk: "none", fg: f.id }, [f]);
  assert.equal(st.vis.kind, "image");
  assert.equal(st.vis.src, "api/prep/bank/img/radnotes/rn-n1-p006-1.webp");
  assert.equal(st.vis.caption, "Left pleural effusion. PA film.");
  const ground = "fluid gathers in the costophrenic angle posterior deepest fills first lateral view small effusion frontal decubitus free fluid chest wall";
  assert.deepEqual(R.gateFigStep(st, ground), []);
  const bad = { ...st, tx: st.tx.replace("deepest", "deepest in 75 percent") };
  assert.ok(R.gateFigStep(bad, ground).some((x) => /numbers/.test(x)));
  assert.ok(R.gateFigStep({ ...st, vis: { ...st.vis, src: "prep/x.webp" } }, ground).includes("image path"));
});

test("gateX: names the answer, every wrong option, no labels or stray numbers", () => {
  const it = { q: "The radiograph shown is most consistent with?", o: ["Pneumothorax", "Pleural effusion", "Emphysema", "Consolidation"], a: 1 };
  const notes = "## Pleural fluid\n- **Fluid** gathers in the costophrenic angle on an upright film and blunts it.\n- The posterior angle fills first, so the lateral view is more sensitive.\n- A decubitus view moves free fluid along the dependent chest wall.\n- Fluid that does not move is loculated and can sit in a fissure like a mass.\n## Look-alikes\n- Air rises to the apex; fluid sinks to the bases.";
  const x = { key: "Pleural effusion: fluid blunts the costophrenic angle on an upright film.", notes, pearl: "The lateral view shows small effusions first.", ka: "B",
    others: { A: "Pneumothorax is air at the apex, not fluid at the base.", C: "Emphysema makes the lungs too black with flat domes.", D: "Consolidation is air space disease with air bronchograms." } };
  const ground = "fluid costophrenic angle upright posterior lateral decubitus loculated fissure mass air apex";
  assert.deepEqual(R.gateX(x, it, ground), []);
  assert.ok(R.gateX({ ...x, key: "Air rises to the apex." }, it, ground).includes("key line does not name the answer"));
  assert.ok(R.gateX({ ...x, others: { A: "x", C: x.others.C, D: x.others.D } }, it, ground).includes("a wrong option has no reason"));
  assert.ok(R.gateX({ ...x, pearl: "According to the notes, fluid sinks." }, it, ground).some((r) => /banned/.test(r)));
  assert.ok(R.gateX({ ...x, pearl: "Fluid sinks — air rises." }, it, ground).some((r) => /banned/.test(r)));
  assert.ok(R.gateX({ ...x, pearl: "About 300 mL is needed to blunt the angle." }, it, ground).some((r) => /numbers/.test(r)));
});

test("readX puts each reason under its own letter and never under the key", () => {
  const items = [{ o: ["a", "b", "c", "d"], a: 2 }];
  const x = R.readX(JSON.stringify({ xs: [{ i: 0, ka: "C", ky: "k", nt: "n", ra: "ra", rb: "rb", rc: "rc", rd: "rd", pl: "Remember: p" }] }), items)[0];
  assert.deepEqual(x.others, { A: "ra", B: "rb", D: "rd" });
  assert.equal(x.pearl, "P");
});

test("storedItem and finalItem: image items carry img and imgPlace stem", () => {
  const rq = { st: "The X-ray shown most likely shows?", kp: "pearl", dl: 2, cog: "recall" };
  const sh = { o: ["w", "x", "y", "z"], a: 3, r: ["r0", "r1", "r2", "r3"] };
  const it = R.storedItem(rq, sh, { sid: "n1-chest-black", module: "rad-chest", fig: { id: "n1-p009-2" } });
  assert.match(it.id, /^rn-[0-9a-f]{12}$/);
  assert.deepEqual(it.img, ["rn-n1-p009-2.webp"]);
  assert.equal(it.imgPlace, "stem");
  const fin = R.finalItem(it, { key: "k", notes: "n", pearl: "p", others: { A: "a", B: "b", C: "c" } });
  assert.deepEqual(fin.r, ["a", "b", "c", "k"]);
  assert.equal(fin.exp, "k");
  assert.deepEqual(Object.keys(fin.x), ["key", "notes", "others", "pearl"]);
  assert.equal(R.storedItem(rq, sh, { sid: "s", module: "rad-chest" }).img, undefined);
});

test("dedupe drops near-duplicate stems in a module and repeat keys of one picture", () => {
  const mk = (id, q, t, img, key) => ({ id, q, t, o: [key || "k", "b", "c", "d"], a: 0, ...(img ? { img: [img] } : {}) });
  const out = R.dedupe([
    mk("1", "Which view best shows a small pleural effusion on an upright chest film?", "rad-chest"),
    mk("2", "Which view best shows a small pleural effusion on an upright chest film today?", "rad-chest"),
    mk("3", "Which view best shows a small pleural effusion on an upright chest film?", "rad-gi"),
    mk("4", "The radiograph shown demonstrates?", "rad-chest", "a.webp", "Effusion"),
    mk("5", "The film shown in this patient is most likely?", "rad-chest", "a.webp", "Effusion"),
  ]);
  assert.deepEqual(out.map((x) => x.id), ["1", "3", "4"]);
});

test("mergeIndex keeps every live entry and adds lessons by id", () => {
  const live = { v: 1, modules: { "ana-ear": { title: "Ear", minutes: 5, steps: 4, gen: "AI" } } };
  const ix = R.mergeIndex(live, [{ id: "radnotes-n1-ivp", title: "IVP", minutes: 6, steps: [1, 2, 3, 4], gen: "AI", module: "rad-genitourinary" }]);
  assert.deepEqual(ix.modules["ana-ear"], live.modules["ana-ear"]);
  assert.deepEqual(ix.modules["radnotes-n1-ivp"], { title: "IVP", minutes: 6, steps: 4, gen: "AI", module: "rad-genitourinary", set: "radnotes" });
});

test("lessonQuiz prefers the section's text questions", () => {
  const items = [{ id: "a", sid: "s", img: ["x"] }, { id: "b", sid: "s" }, { id: "c", sid: "t" }, { id: "d", sid: "s" }, { id: "e", sid: "s" }];
  assert.deepEqual(R.lessonQuiz(items, "s", 3), ["b", "d", "e"]);
});

test("tally rejects a use unless both votes say ok", () => {
  const uses = [{ use: "u1" }, { use: "u2" }, { use: "u3" }];
  const a = [{ use: "u1", ok: true }, { use: "u2", ok: true }, { use: "u3", ok: true }];
  const b = [{ use: "u1", ok: true }, { use: "u2", ok: false }];
  assert.deepEqual(R.tally(uses, a, b), ["u2", "u3"]);
});

test("only the lessons paths are served by the route today", () => {
  assert.equal(R.SERVED_NOW("prep-bank/v1/lessons/index.json"), true);
  assert.equal(R.SERVED_NOW("prep-bank/v1/lessons/radnotes-n1-ivp.json"), true);
  assert.equal(R.SERVED_NOW("prep-bank/img/radnotes/rn-n1-p006-1.webp"), false);
  assert.equal(R.SERVED_NOW("prep-bank/overlay/radnotes/radiology/rad-chest.json"), false);
});
