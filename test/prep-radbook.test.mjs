/* PrepNucleus radbook (tools/prep-radbook.mjs): the owner's radiology PDFs, chapter by chapter, -> Learn lessons with the
 * PDFs' own figures. What must hold: exam-question lines never become grounding; long-case captions and case page
 * ranges are read from page text; a figure step points at the lessons media path, carries the model's caption and the
 * check's description as alt text, and still passes the text gates (a caption naming a figure number, or a number
 * not in the source, fails); only clear medical figures without third-party marks are offered; the new index drops the
 * superseded radnotes entries and keeps every other one; a missing or doubtful vote drops a figure use; lesson keys
 * keep chapter order and fit the bank route. No network, no model calls.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-radbook.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../tools/prep-radbook.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";
import { createRequire } from "node:module";
const LP = createRequire(import.meta.url)("../prep-lessons.js");

test("pageText drops exam-question lines and page numbers", () => {
  const t = R.pageText("Pleural effusion\nFluid blunts the costophrenic angle.\nQ. Identify the finding\nWhich sign is shown?\n[NEET 2019] recall\n12");
  assert.equal(t, "Pleural effusion\nFluid blunts the costophrenic angle.");
});

test("r11Cases and r11Captions read the long-case book's own markers", () => {
  const pages = [
    { p: 8, t: "4.121 CARDIOVASCULAR SYSTEM\nCase No. 121\nClinical history" },
    { p: 9, t: "Fig. 4.121.1: Anomalous left coronary artery\nfrom the pulmonary artery\nFig. 4.121.2: Right coronary artery" },
    { p: 11, t: "Case No. 122\nFig. 4.122.3: Snowman heart" },
    { p: 12, t: "text" },
  ];
  assert.deepEqual(R.r11Cases(pages), { 121: [8, 10], 122: [11, 12] });
  const c = R.r11Captions(pages);
  assert.equal(c.get("4.121.1"), "Anomalous left coronary artery from the pulmonary artery");
  assert.equal(c.get("4.122.3"), "Snowman heart");
});

test("media names fit the lessons media route", () => {
  assert.equal(R.mediaName("r11-4.121.12"), "rb-r11-4-121-12.webp");
  assert.equal(R.mediaName("n2-p061-1"), "rb-n2-p061-1.webp");
  assert.ok(R.MEDIA_RE.test(R.MEDIA + R.mediaName("r11-4.121.12")));
  assert.equal(bankPath({ path: ("v1/lessons/media/" + R.mediaName("r11-4.136.60")).split("/") }), "v1/lessons/media/rb-r11-4-136-60.webp");
  assert.equal(LP.lessonImgUrl(R.MEDIA + "rb-n1-p006-1.webp", "/api/prep/bank/"), "/api/prep/bank/v1/lessons/media/rb-n1-p006-1.webp");
  assert.equal(LP.checkVis({ kind: "image", src: R.MEDIA + "rb-n1-p006-1.webp", alt: "a", caption: "b" }), "");
});

const GROUND = "On an upright film fluid collects in the costophrenic angle and blunts it. The posterior costophrenic angle is the deepest and fills first. About 200 ml of fluid is needed before the lateral angle blunts on a frontal film. A decubitus view shows free fluid layering along the dependent chest wall.";
const TX = "On an upright film fluid gathers in the **costophrenic angle** and blunts it. The posterior angle is the deepest part and fills first, so a small effusion shows on a lateral view before the frontal view. A **decubitus view** lets free fluid layer along the lower chest wall, where it is easy to see.";
const FIG = { id: "n1-p006-1", caption: "Left pleural effusion. A. PA film.", q: { kind: "xray", medical: true, clear: true, match: "yes", shows: "PA chest X-ray with a blunted left costophrenic angle", third: "" } };

test("a figure step uses the media path, the model caption and the check's alt text", () => {
  const st = R.toFigStep({ tx: TX, say: "Fluid gathers in the costophrenic angle and blunts it.", vk: "none", fg: FIG.id, fc: "Upright chest X-ray: fluid blunts the left costophrenic angle" }, [FIG]);
  assert.equal(st.vis.kind, "image");
  assert.equal(st.vis.src, "v1/lessons/media/rb-n1-p006-1.webp");
  assert.equal(st.vis.alt, "PA chest X-ray with a blunted left costophrenic angle");
  assert.equal(st.fg, FIG.id);
  assert.deepEqual(R.gateFigStep(st, GROUND), []);
});

test("figure captions are gated: no figure numbers, no numbers outside the source, sensible length", () => {
  const mk = (fc) => R.toFigStep({ tx: TX, say: "Fluid gathers in the costophrenic angle.", vk: "none", fg: FIG.id, fc }, [FIG]);
  assert.ok(R.gateFigStep(mk("Fig. 2 shows fluid blunting the angle on the left"), GROUND).some((x) => /caption names/.test(x)));
  assert.ok(R.gateFigStep(mk("About 500 ml of fluid blunts the angle here"), GROUND).some((x) => /caption numbers/.test(x)));
  assert.ok(R.gateFigStep(mk("Effusion"), GROUND).some((x) => /caption length/.test(x)));
  assert.deepEqual(R.gateFigStep(mk("About 200 ml of fluid has blunted the lateral angle"), GROUND), []);
});

test("a figure id the lesson was not offered gives a plain step", () => {
  const st = R.toFigStep({ tx: TX, say: "Fluid gathers.", vk: "none", fg: "n9-p999-9", fc: "x y z" }, [FIG]);
  assert.equal(st.vis, null);
});

test("only clear medical figures without third-party marks are offered", () => {
  assert.equal(R.offerable(FIG.q), true);
  assert.equal(R.offerable({ ...FIG.q, clear: false }), false);
  assert.equal(R.offerable({ ...FIG.q, match: "no" }), false);
  assert.equal(R.offerable({ ...FIG.q, third: "publisher logo" }), false);
  assert.equal(R.offerable({ ...FIG.q, medical: false, kind: "table" }), false);
  assert.equal(R.offerable({ ...FIG.q, medical: false, kind: "drawing" }), true);
  assert.equal(R.offerable(null), false);
});

test("the index drops superseded radnotes entries and keeps every other entry", () => {
  const live = { v: 1, modules: { "med-heart-failure": { title: "HF", steps: 5 }, "radnotes-n1-basics": { title: "Old", set: "radnotes", module: "rad-xray" }, "srd-ir": { title: "IR" } } };
  const les = [{ id: "radbook-010010-plain-film", title: "Plain film", minutes: 5, steps: [1, 2, 3, 4], gen: "AI", module: "rad-xray" }];
  const ix = R.mergeIndex(live, les);
  assert.deepEqual(Object.keys(ix.modules).sort(), ["med-heart-failure", "radbook-010010-plain-film", "srd-ir"]);
  assert.deepEqual(ix.modules["radbook-010010-plain-film"], { title: "Plain film", minutes: 5, steps: 4, gen: "AI", module: "rad-xray", set: "radbook" });
});

test("a missing or doubtful vote drops the figure use", () => {
  const uses = [{ use: "t:0" }, { use: "t:1" }, { use: "t:2" }];
  const a = [{ use: "t:0", ok: true }, { use: "t:1", ok: true }, { use: "t:2", ok: true }];
  const b = [{ use: "t:0", ok: true }, { use: "t:1", ok: false }];
  assert.deepEqual(R.tally(uses, a, b), ["t:1", "t:2"]);
});

test("lesson keys keep chapter order and fit the lessons route", () => {
  const k1 = R.lessonKey({ order: 1, seq: 10, title: "The five radiographic densities" });
  const k2 = R.lessonKey({ order: 10, seq: 3, title: "Pleural effusion on the upright film" });
  assert.ok(k1 < k2);
  for (const k of [k1, k2]) assert.equal(bankPath({ path: ["v1", "lessons", k + ".json"] }), "v1/lessons/" + k + ".json");
  assert.equal(R.subjectOf("srd-msk-tumour"), "ss-radiology");
  assert.equal(R.subjectOf("rad-chest"), "radiology");
});

test("windows split long chapters and give one window per long case", () => {
  const w = R.windows([{ id: "n2-resp", pages: [3, 35], mods: ["rad-chest"] }, { id: "r11-cvs", caseRanges: { 121: [8, 13], 122: [14, 19] }, mods: ["srd-cardiac-vascular"] }]);
  assert.deepEqual(w.map((x) => [x.wid, x.pages]), [["n2-resp-0", [3, 13]], ["n2-resp-1", [14, 24]], ["n2-resp-2", [25, 35]], ["r11-cvs-121", [8, 13]], ["r11-cvs-122", [14, 19]]]);
});

test("every chapter names modules of its own exam", () => {
  for (const c of R.CHAPTERS) for (const m of c.mods) assert.ok((c.src === "rdn11" || c.src === "radn1" || c.ss ? R.SRD_MODULES : R.RAD_MODULES.concat(["rad-radiobiology"])).includes(m), c.id + " " + m);
});

test("lessonImages lists each image step once, in order", () => {
  const les = { steps: [{ vis: { kind: "image", src: "a.webp" } }, { vis: { kind: "table" } }, { vis: null }, { vis: { kind: "image", src: "b.webp" } }, { vis: { kind: "image", src: "a.webp" } }] };
  assert.deepEqual(LP.lessonImages(les), ["a.webp", "b.webp"]);
  assert.deepEqual(LP.lessonImages(null), []);
});
