/* PrepNucleus Radiology NEET-SS best module (tools/prep-radss.mjs): the validators that stand between generated content
 * and the bank. What must hold: an item without four distinct options, a reason per option, a structured explanation, a
 * neet-ss tag, a servable image path, or with a long dash, emoji or a source/AI word never reaches the bank; a no-image
 * item that refers to an image, copies 12 words of the notes or invents a number is refused; anatomy items never leak
 * the true/false book's statement letters; a lesson that cannot be drawn or breaks the text rules is refused; lesson
 * figures that are bank paths load through the bank API; the taxonomy stays valid with the new modules and bank v7; and
 * the bank route serves every path the finalizer writes.
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-radss.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as R from "../tools/prep-radss.mjs";
import { validateSubject } from "../tools/prep-build-bank.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";
import fs from "node:fs";

const req = createRequire(import.meta.url);
const LP = req("../prep-lessons.js");

const goodItem = () => ({
  id: "rss-n140-1", q: "A 28-year-old woman has knee pain for three months. The radiograph shown is from her study. What is the most likely diagnosis?",
  o: ["Giant cell tumour of bone", "Chondroblastoma", "Aneurysmal bone cyst", "Clear cell chondrosarcoma"], a: 0,
  exp: "Giant cell tumour of bone is right: an eccentric lytic lesion reaching the subchondral bone after physeal closure.",
  r: ["Giant cell tumour of bone is right.", "Epiphyseal but before closure.", "Fluid levels, younger patients.", "Rare, older patients."],
  kp: "Lytic, eccentric, subarticular and mature skeleton: think giant cell tumour.", d: 2, ex: ["neet-ss"], t: "dx",
  x: { key: "Giant cell tumour of bone is right.", notes: "## Imaging\n- **Eccentric** lytic lesion", others: { B: "a", C: "b", D: "c" }, pearl: "Mature skeleton." },
  img: ["v7/ss-radiology/img/rad-n140-1-pmc123-fig2.webp"], imgPlace: "stem",
});

test("checkItem passes a well-formed item and names each broken rule", () => {
  assert.deepEqual(R.checkItem(goodItem()), []);
  const cases = [
    [(x) => { x.o[1] = x.o[0]; }, "four distinct options"],
    [(x) => { x.r[2] = ""; }, "a reason per option"],
    [(x) => { x.d = 4; }, "difficulty 1 to 3"],
    [(x) => { x.ex = ["neet-pg"]; }, "exam neet-ss"],
    [(x) => { delete x.x.pearl; }, "structured explanation"],
    [(x) => { x.img = ["v7/other/img/a.webp"]; }, "image path"],
    [(x) => { x.img = ["https://example.org/a.webp"]; }, "image path"],
    [(x) => { x.q += " — a dash"; }, "long dash or emoji"],
    [(x) => { x.kp = "As the case report shows, think giant cell tumour."; }, "source or AI words"],
    [(x) => { x.a = 5; }, "key index"],
  ];
  for (const [mut, want] of cases) { const it = goodItem(); mut(it); assert.ok(R.checkItem(it).includes(want), want); }
});

test("openiType maps angiography to X-ray and nuclear to any type", () => {
  assert.equal(R.openiType("g,m"), "x,m");
  assert.equal(R.openiType("n"), "");
  assert.equal(R.openiType("x,m,c"), "x,m,c");
  assert.equal(R.openiType(""), "");
});

test("tfGround and tfUsable read the anatomy book's statements with their answers", () => {
  const q = { stem: "Regarding the vertebral artery", st: { a: "arises from the subclavian artery", b: "enters at C6", c: "passes through C7", d: "joins its fellow", e: "gives PICA" } };
  const a = { st: { a: "True. It is the first branch.", b: "True. Usually.", c: "False. It enters at C6.", d: "True.", e: "True." } };
  const g = R.tfGround(q, a);
  assert.match(g, /\(c\) passes through C7 -> FALSE\. It enters at C6\./);
  assert.ok(R.tfUsable(q, a));
  assert.ok(!R.tfUsable(q, { st: { a: "True", b: "True", c: "True", d: "True", e: "True" } }), "all true is not usable");
  assert.ok(!R.tfUsable(q, { st: { a: "Maybe" } }), "unanswered statements are not usable");
});

test("textGates: no-image items may not point at an image, copy the notes or invent numbers", () => {
  const ground = "History: a 45-year-old man with jaundice. Imaging findings: hilar mass 3 cm with bilateral duct dilatation reaching second order ducts. Diagnosis: hilar cholangiocarcinoma.";
  const x = {
    q: "A 45-year-old man has painless jaundice. CT shows a 3 cm hilar mass with dilated ducts on both sides reaching the second order branches. Which classification type is this?",
    o: ["Type IV", "Type I", "Type II", "Type IIIa"], a: 0, ky: "Type IV is right because both sides reach second order ducts.",
    nt: Array(60).fill("word").join(" "), others: { B: "below the confluence", C: "confluence only", D: "right side only" }, pl: "Both sides to second order ducts means type IV.", d: 3,
  };
  const t = { kind: "text" };
  assert.equal(R.textGates(x, t, ground), null);
  assert.equal(R.textGates({ ...x, q: x.q + " The image shown is from her CT." }, t, ground), "image-ref");
  assert.equal(R.textGates({ ...x, q: x.q.replace("45", "52") }, t, ground), "numbers");
  assert.equal(R.textGates({ ...x, nt: x.nt + " imaging findings hilar mass 3 cm with bilateral duct dilatation reaching second order ducts" }, t, ground), "verbatim");
  assert.equal(R.textGates({ ...x, pl: "As described in the textbook." }, t, ground), "source");
  assert.equal(R.textGates({ ...x, nt: "too short" }, t, ground), "length");
  assert.equal(R.textGates(null, t, ground), "shape");
  assert.equal(R.textGates({ ...x, q: "Which statement (c) is marked true about type IV ducts in a 45-year-old?" }, { kind: "anat" }, ground), "source");
});

test("itemGates keeps the image rules of tools/prep-rad.mjs for image items", () => {
  const x = { q: "A 45-year-old man. What is the diagnosis?", o: ["A1", "B1", "C1", "D1"], a: 0, ky: "A1 is right.", nt: Array(60).fill("word").join(" "), others: { B: "x", C: "y", D: "z" }, pl: "p", d: 2 };
  assert.equal(R.itemGates(x, { kind: "img" }, "a 45-year-old man"), "no-image-ref");
  assert.equal(R.itemGates({ ...x, q: x.q.replace("What", "The image shown is from his CT. What") }, { kind: "img" }, "a 45-year-old man"), null);
});

test("toLesson builds a drawable prep-lessons v1 lesson; lessonTextGate refuses dashes, sources and invented numbers", () => {
  const tx = "The **zone of transition** decides how aggressive a bone lesion is. A narrow sclerotic margin means slow growth, a wide permeative edge means fast growth and points to round cell tumours or infection in the young. Read it before anything else.";
  const say = "Look first at the edge of the lesion. A sharp sclerotic rim means it grew slowly.";
  const steps = [
    { tx, say, vis: { kind: "table", cols: ["Margin", "Meaning"], rows: [["Sclerotic", "Slow"], ["Permeative", "Fast"]] } },
    { tx, say, vis: { kind: "flow", nodes: [{ id: "a", label: "Lytic lesion" }, { id: "b", label: "Narrow zone" }, { id: "c", label: "Wide zone" }], edges: [["a", "b"], ["a", "c"]] } },
    { tx, say, vis: { kind: "compare", lt: "Enchondroma", lp: ["No pain", "Shallow scalloping"], rt: "Chondrosarcoma", rp: ["Pain", "Deep scalloping"] } },
    { tx, say, vis: { kind: "fig", fig: "f1" } },
    { tx, say, vis: { kind: "fig", fig: "nope" } },
  ];
  const figs = [{ id: "f1", src: "v7/ss-radiology/img/rad-n140-1-pmc1-fig1.webp", alt: "Imaging of giant cell tumour", caption: "Giant cell tumour of bone." }];
  const les = R.toLesson({ title: "Bone tumours", steps }, { module: "srd-msk-tumour", title: "x", quiz: [] }, figs);
  assert.deepEqual(LP.checkLesson(les), []);
  assert.equal(les.steps[3].vis.kind, "image");
  assert.equal(les.steps[3].vis.src, figs[0].src);
  assert.equal(les.steps[4].vis, null, "an unknown figure id becomes no visual, never a broken image");
  assert.equal(R.lessonTextGate(les, "Notes on bone lesion margins."), null);
  assert.equal(R.lessonTextGate(les, tx), "verbatim", "a lesson that copies its notes is refused");
  const bad = JSON.parse(JSON.stringify(les)); bad.steps[0].tx += " See figure 2 of the book.";
  assert.equal(R.lessonTextGate(bad, "notes"), "source");
  const num = JSON.parse(JSON.stringify(les)); num.steps[0].say += " Seen in 37 percent.";
  assert.match(R.lessonTextGate(num, "notes"), /^numbers/);
  assert.equal(R.toLesson(null, {}, []), null);
});

test("pickQuizIds takes three items spread across difficulty", () => {
  const items = [{ id: "a", d: 2 }, { id: "b", d: 2 }, { id: "c", d: 1 }, { id: "d", d: 3 }];
  assert.deepEqual(R.pickQuizIds(items), ["c", "a", "d"]);
  assert.deepEqual(R.pickQuizIds([{ id: "x", d: 2 }]), ["x"]);
});

test("lesson figures that are bank paths load through the bank API, in-app media from the web root", () => {
  assert.equal(LP.lessonImgUrl("v7/ss-radiology/img/a.webp", "/api/prep/bank/"), "/api/prep/bank/v7/ss-radiology/img/a.webp");
  assert.equal(LP.lessonImgUrl("v7/ss-radiology/img/a.webp", "https://stewardmd.in/api/prep/bank"), "https://stewardmd.in/api/prep/bank/v7/ss-radiology/img/a.webp");
  assert.equal(LP.lessonImgUrl("prep/lessons/media/x.svg", "/api/prep/bank/"), "/prep/lessons/media/x.svg");
});

test("taxonomy: ss-radiology is valid with its new modules and reads bank v10 (v9 plus the review-book items)", () => {
  const s = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy/ss-radiology.json", import.meta.url), "utf8"));
  assert.deepEqual(validateSubject(s), []);
  assert.equal(s.bank, "v10");
  const mods = s.sections.flatMap((x) => x.modules.map((m) => m.id));
  for (const m of ["srd-msk-metabolic", "srd-abd-peritoneum", "srd-anat-neuro", "srd-anat-body", "srd-anat-limbs"]) assert.ok(mods.includes(m), m);
  const app = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy.json", import.meta.url), "utf8"));
  const sub = app.branches.flatMap((b) => b.subjects).find((x) => x.id === "ss-radiology");
  assert.equal(sub.bv, "v10");
  assert.deepEqual(sub.sections.flatMap((x) => x.modules.map((m) => m.id)), mods, "the bundled tree matches the source");
  // every target and lesson names a module that exists
  const T = JSON.parse(fs.readFileSync(new URL("../tools/prep-radss/targets.json", import.meta.url), "utf8")).targets;
  for (const t of T) assert.ok(mods.includes(t.mod), t.id + " " + t.mod);
  const LS = JSON.parse(fs.readFileSync(new URL("../tools/prep-radss/lessons.json", import.meta.url), "utf8")).lessons;
  for (const l of LS) assert.ok(mods.includes(l.module), l.module);
  assert.equal(new Set(LS.map((l) => l.module)).size, LS.length, "one lesson per module");
});

test("the bank route serves every path the finalizer writes for v7, and nothing outside it", () => {
  const ok = ["v7/ss-radiology/index.json", "v7/ss-radiology/mcq/srd-anat-neuro.json", "v7/ss-radiology/img/rad-o-caa-pmc1234567-fig3.webp", "v1/lessons/srd-msk-tumour.json", "v1/lessons/index.json"];
  for (const p of ok) assert.equal(bankPath({ path: p.split("/") }), p, p);
  for (const p of ["v7/ss-radiology/img/../x.webp", "v7/ss-radiology/raw/x.pdf", "v7/ss-radiology/img/X.webp"]) assert.equal(bankPath({ path: p.split("/") }), null, p);
});

test("radmax: bank v8 index is committed with the v7 items plus the radmax items, and the route serves v8 and the radmax set", () => {
  const ix = JSON.parse(fs.readFileSync(new URL("../prep/bank/v8/ss-radiology/index.json", import.meta.url), "utf8"));
  const v7 = JSON.parse(fs.readFileSync(new URL("../prep/bank/v7/ss-radiology/index.json", import.meta.url), "utf8"));
  assert.equal(ix.id, "ss-radiology");
  assert.ok(ix.counts.total > v7.counts.total, "v8 adds items to v7");
  for (const t of v7.topics) assert.ok(ix.topics.find((x) => x.id === t.id).count >= t.count, t.id);
  assert.equal(ix.counts.total, ix.topics.reduce((n, t) => n + t.count, 0));
  const ok = ["v8/ss-radiology/index.json", "v8/ss-radiology/mcq/srd-abd-liver.json", "v8/ss-radiology/img/rm-r11-4-166-4.webp",
    "img/radmax/rm-n1-p021-1.webp", "overlay/radmax/radiology/rad-radiation-protection.json", "overlay/radmax/radiology/rad-gi.json"];
  for (const p of ok) assert.equal(bankPath({ path: p.split("/") }), p, p);
  for (const p of ["v8/ss-radiology/img/rm-r11-4.166.4.webp", "img/radmax/rn-n1-p021-1.webp", "img/radnotes/rm-n1-p021-1.webp", "img/radmax/x.webp",
    "overlay/radmax/rad-gi.json", "overlay/radmax/radiology/../x.json", "overlay/radmax1/radiology/rad-gi.json", "overlay/radmaxx/radiology/rad-gi.json",
    "overlay/radmax2/rad-gi.json", "overlay/radmax2/radiology/../x.json", "img/radmax2/rm-n1-p021-1.webp",
    "img/radmax/rm-AB.webp", "img/radmax/a/rm-ab.webp"]) assert.equal(bankPath({ path: p.split("/") }), null, p);
});

test("radmax depth: bank v9 index holds every v8 item plus the depth items, and the route serves v9 and the radmax2 set", () => {
  const ix = JSON.parse(fs.readFileSync(new URL("../prep/bank/v9/ss-radiology/index.json", import.meta.url), "utf8"));
  const v8 = JSON.parse(fs.readFileSync(new URL("../prep/bank/v8/ss-radiology/index.json", import.meta.url), "utf8"));
  assert.equal(ix.id, "ss-radiology");
  assert.ok(ix.counts.total > v8.counts.total, "v9 adds items to v8");
  for (const t of v8.topics) assert.ok(ix.topics.find((x) => x.id === t.id).count >= t.count, t.id);
  assert.equal(ix.counts.total, ix.topics.reduce((n, t) => n + t.count, 0));
  const ok = ["v9/ss-radiology/index.json", "v9/ss-radiology/mcq/srd-abd-liver.json",
    "overlay/radmax2/radiology/rad-gi.json", "overlay/radmax2/radiology/rad-radiation-protection.json"];
  for (const p of ok) assert.equal(bankPath({ path: p.split("/") }), p, p);
});

test("fit4 cuts a five-option reply to four and keeps key and reasons aligned", () => {
  const r = { o: ["p", "q", "r", "s", "t"], a: 4, ot: [{ k: "A", why: "wa" }, { k: "B", why: "wb" }, { k: "C", why: "wc" }, { k: "D", why: "wd" }] };
  const f = R.fit4(r);
  assert.deepEqual(f.o, ["p", "q", "r", "t"]); assert.equal(f.a, 3);
  assert.deepEqual(f.ot.map((x) => x.k + x.why), ["Awa", "Bwb", "Cwc"]);
  const g = R.fit4({ o: ["p", "q", "r", "s", "t"], a: 1, ot: [{ k: "A", why: "wa" }, { k: "C", why: "wc" }, { k: "D", why: "wd" }, { k: "E", why: "we" }] });
  assert.deepEqual(g.o, ["p", "q", "r", "s"]); assert.equal(g.a, 1); assert.deepEqual(g.ot.map((x) => x.k), ["A", "C", "D"]);
  const four = { o: [1, 2, 3, 4], a: 0 }; assert.equal(R.fit4(four), four);
});

test("fixOt relabels three badly labelled reasons with the wrong options' letters and leaves good ones", () => {
  const r = { o: ["a", "b", "c", "d"], a: 2, ot: [{ k: "AD", why: "x" }, { k: "", why: "y" }, { k: "option d", why: "z" }] };
  assert.deepEqual(R.fixOt(r).ot.map((x) => x.k), ["A", "B", "D"]);
  const good = { o: ["a", "b", "c", "d"], a: 0, ot: [{ k: "D", why: "x" }, { k: "B", why: "y" }, { k: "C", why: "z" }] };
  assert.equal(R.fixOt(good), good);
  const two = { o: ["a", "b", "c", "d"], a: 0, ot: [{ k: "", why: "x" }, { k: "", why: "y" }] };
  assert.equal(R.fixOt(two), two, "two reasons cannot be relabelled safely");
});

test("itemGates refuses reasons not labelled with exactly the three wrong letters; targetD spreads difficulty", () => {
  const ground = "History: a 45-year-old man. Imaging findings: hilar mass. Diagnosis: cholangiocarcinoma.";
  const x = { q: "A 45-year-old man has jaundice and a hilar mass on CT. Which classification type applies here?", o: ["Type IV", "Type I", "Type II", "Type IIIa"], a: 0, ky: "Type IV is right.", nt: Array(60).fill("word").join(" "), others: { B: "b", C: "c", D: "d" }, pl: "Remember type IV.", d: 2 };
  assert.equal(R.itemGates(x, { kind: "text" }, ground), null);
  assert.equal(R.itemGates({ ...x, others: { B: "b", C: "c", BACAA: "d" } }, { kind: "text" }, ground), "others");
  const ds = new Set(); for (let i = 0; i < 60; i++) ds.add(R.targetD("t" + i));
  assert.deepEqual([...ds].sort(), [1, 2, 3]);
  assert.equal(R.targetD("t5"), R.targetD("t5"), "stable");
});

test("toLesson accepts the Batch schema's object rows and edges", () => {
  const tx = "The **zone of transition** is the edge of a bone lesion. A narrow sclerotic rim means slow growth and a wide permeative edge means fast growth, which points to round cell tumours or infection in a young patient. Read it first, always.";
  const steps = [
    { tx, say: "Look at the edge.", vis: { kind: "table", cols: ["Margin", "Meaning"], rows: [{ c: ["Sclerotic", "Slow"] }, { c: ["Permeative", "Fast"] }], nodes: [], edges: [], lt: "", lp: [], rt: "", rp: [], fig: "" } },
    { tx, say: "Follow the flow.", vis: { kind: "flow", cols: [], rows: [], nodes: [{ id: "a", label: "Lesion", sub: "" }, { id: "b", label: "Narrow", sub: "" }, { id: "c", label: "Wide", sub: "" }], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }], lt: "", lp: [], rt: "", rp: [], fig: "" } },
    { tx, say: "Compare.", vis: { kind: "compare", cols: [], rows: [], nodes: [], edges: [], lt: "Slow", lp: ["Narrow zone"], rt: "Fast", rp: ["Wide zone"], fig: "" } },
    { tx, say: "Done.", vis: { kind: "table", cols: ["A", "B"], rows: [{ c: ["1", "2"] }, { c: ["3", "4"] }] } },
  ];
  const les = R.toLesson({ title: "T", steps }, { module: "srd-msk-tumour", title: "T" }, []);
  assert.deepEqual(LP.checkLesson(les), []);
  assert.deepEqual(les.steps[1].vis.edges, [["a", "b"], ["a", "c"]]);
  assert.equal(les.steps[1].vis.nodes[0].sub, undefined, "an empty sub is dropped");
});

test("bankIndex writes the prep-build-bank subject index shape with a row per taxonomy module", () => {
  const tax = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy/ss-radiology.json", import.meta.url), "utf8"));
  const ix = R.bankIndex(tax, { "srd-msk-tumour": [{ d: 1 }, { d: 3 }] });
  const row = ix.topics.find((t) => t.id === "srd-msk-tumour");
  assert.deepEqual([row.group, row.count, row.file, row.target], ["srd-msk", 2, "mcq/srd-msk-tumour.json", 40]);
  assert.equal(ix.topics.length, tax.sections.reduce((n, s) => n + s.modules.length, 0));
  assert.deepEqual([ix.counts.total, ix.counts.d1, ix.counts.d3], [2, 1, 1]);
  assert.ok(!/stewardmd|ai-generated|licen/i.test(JSON.stringify(ix)), "no source or AI field");
});

test("shipped v10 subject index: taxonomy bv v10, every taxonomy module listed with group and file, counts add up", () => {
  const tax = JSON.parse(fs.readFileSync(new URL("../prep/taxonomy.json", import.meta.url), "utf8"));
  let sub = null; for (const b of tax.branches) for (const s of b.subjects) if (s.id === "ss-radiology") sub = s;
  assert.equal(sub && sub.bv, "v10");
  const ix = JSON.parse(fs.readFileSync(new URL("../prep/bank/v10/ss-radiology/index.json", import.meta.url), "utf8"));
  const mods = sub.sections.flatMap((x) => x.modules.map((m) => m.id));
  assert.deepEqual(ix.topics.map((t) => t.id).sort(), mods.slice().sort());
  for (const t of ix.topics) { assert.ok(t.group && ix.groups.some((g) => g.id === t.group), t.id); assert.equal(t.file, "mcq/" + t.id + ".json"); }
  const n = ix.topics.reduce((a, t) => a + t.count, 0);
  assert.equal(ix.counts.total, n); assert.equal(ix.counts.d1 + ix.counts.d2 + ix.counts.d3, n);
  assert.ok(n >= 1272, "v9 holds the 690 v8 items and the 582 radmax depth items");
});

test("review-book release: bank v10 holds every v9 item plus the new ones, and the route serves v10 and the radmax3 set", () => {
  const ix = JSON.parse(fs.readFileSync(new URL("../prep/bank/v10/ss-radiology/index.json", import.meta.url), "utf8"));
  const v9 = JSON.parse(fs.readFileSync(new URL("../prep/bank/v9/ss-radiology/index.json", import.meta.url), "utf8"));
  assert.ok(ix.counts.total > v9.counts.total, "v10 adds items to v9");
  for (const t of v9.topics) assert.ok(ix.topics.find((x) => x.id === t.id).count >= t.count, t.id);
  for (const p of ["v10/ss-radiology/index.json", "v10/ss-radiology/mcq/srd-breast.json", "v10/ss-radiology/img/rm-ctc-p0450-1.webp",
    "overlay/radmax3/radiology/rad-interventional.json", "img/radmax/rm-ctc-p0840-1.webp"]) assert.equal(bankPath({ path: p.split("/") }), p, p);
});
