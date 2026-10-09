/* PrepNucleus practice setup (prep-setup.js) and the PDF image helpers (prep-source.js, prep-create.js).
 * What must hold: the clinical-scenario / one-liner classifier follows its documented points and threshold and caches
 * its label; image-based means an image with the stem (a PYQ image counts); every row filters as named and each option's
 * count is the pool it would leave; the draw never goes over the pool, honours every row and splits a Mix by its
 * documented shares through prep.js customDraw; an empty pool names the row to relax; the remembered choice is per
 * scope; the timer turns into the runner's clock options; the image helpers find the two real pictures in a synthetic
 * PDF (vendored pdf.js) and leave out a repeated logo and a small icon; a deck's image op sends the image with the page
 * text near it and saves the image only when a question came back.
 *
 * node --test test/prep-setup.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { makeImagePdf } from "./fixtures/prep-setup/make-pdf.mjs";

const require = createRequire(import.meta.url);
const S = require("../prep-setup.js");
const P = require("../prep.js");
const SR = require("../prep-source.js");
const PC = require("../prep-create.js");

const seq = (seed) => { let a = seed >>> 0; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };
const it = (id, extra) => Object.assign({ id, q: "Which nerve supplies the deltoid?", o: ["a", "b", "c", "d"], a: 0, t: "m1", _m: "m1", d: 2 }, extra || {});

test("classifier: documented points, threshold 3, USMLE vignettes, cached label", () => {
  const cases = [
    ["A 45-year-old man presents with chest pain radiating to the left arm.", 5, "case"],
    ["A 3 yrs/M child brought to the OPD with fever and rash for the past 3 days.", 6, "case"],
    ["A primigravida at 34 weeks complains of headache; BP 160/110 mmHg.", 4, "case"],
    ["Drug of choice for absence seizures in a child is", 1, "line"],
    ["In a patient with history of MI, which drug is avoided?", 2, "line"],
    ["Which nerve supplies the deltoid?", 0, "line"],
  ];
  for (const [q, score, kind] of cases) { assert.equal(S.stemScore(q), score, q); assert.equal(S.stemKind(q), kind, q); }
  assert.equal(S.CASE_MIN, 3); assert.equal(S.LONG_WORDS, 35); assert.equal(S.MID_WORDS, 22);
  const long = "Which of the following statements about the blood supply of the stomach " + "and its many named arterial branches ".repeat(4) + "is true?";
  assert.ok(S.stemScore(long) >= 2 && S.stemKind(long) === "line", "length alone is not a scenario");
  assert.equal(S.stemKind("Which drug?", ["usmle"]), "case", "a USMLE vignette tag wins");
  const x = it("k1", { q: "A 30-year-old woman presents with fever." });
  assert.equal(S.kindOf(x), "case"); x.q = "Which nerve?"; assert.equal(S.kindOf(x), "case", "the label is cached on the item");
});

test("image-based: an image placed with the stem; a PYQ image counts; an explanation image does not", () => {
  assert.equal(S.typeOf(it("i1", { img: ["a.webp"], imgPlace: "stem" })), "img");
  assert.equal(S.typeOf(it("i2", { img: ["a.webp"], _py: 1 })), "img");
  assert.equal(S.typeOf(it("i3", { img: ["a.webp"], imgPlace: "exp" })), "line");
  assert.equal(S.typeOf(it("i4", { img: [] , imgPlace: "stem" })), "line");
});

/* A pool of 3 modules: types, difficulties and FSRS states mixed. */
function pool() {
  const L = [[], [], []];
  for (let i = 0; i < 60; i++) {
    const m = "m" + (i % 3), extra = { _m: m, t: m, d: (i % 3) + 1 };
    if (i % 10 === 0) Object.assign(extra, { img: ["x.webp"], imgPlace: "stem" });
    else if (i % 2) extra.q = "A " + (20 + i) + "-year-old man presents with cough and fever for the past week.";
    L[i % 3].push(it("q" + i, extra));
  }
  return L;
}
function ctxFor(L) {
  const cards = {}, mt = {}, bm = {}, today = 100;
  L.flat().forEach((x, i) => {
    const k = "p:" + x._m + ":" + x.id;
    if (i % 4 === 1) cards[k] = [5, 2, 95, 99, 1, 0];          // due
    else if (i % 4 === 2) cards[k] = [6, 0.2, 98, 99 + 10, 1, 0]; // seen, not due, not wrong
    else if (i % 4 === 3) cards[k] = [6, 0.2, 101, 102, 1, 0];   // missed last time (due the next day), not due yet
    if (i % 7 === 0) bm[x.id] = ["s", x._m, 1];
    if (i === 8) mt[x.id] = ["s", x._m, null, 1, ""];
  });
  return { cards, mt, bm, today };
}

test("rows filter as named and each option shows the pool it would leave", () => {
  const L = pool(), ctx = ctxFor(L), all = L.flat();
  const c = S.counts(L, S.normSel({ type: "all", seen: "all", d: "mix" }), ctx);
  assert.equal(c.total, 60);
  assert.equal(c.type.img, 6); assert.equal(c.type.case + c.type.line + c.type.img, 60); assert.equal(c.type.all, 60); assert.equal(c.type.mix, 60);
  assert.equal(c.seen.new, all.filter((x) => !ctx.cards["p:" + x._m + ":" + x.id]).length);
  assert.equal(c.seen.due, 15);
  assert.equal(c.seen.wrong, 15 + 1, "missed last time, plus the one in My mistakes");
  assert.equal(c.seen.bm, all.filter((x) => ctx.bm[x.id]).length);
  assert.equal(c.d["1"] + c.d["2"] + c.d["3"], 60);
  const hard = S.counts(L, S.normSel({ type: "case", seen: "all", d: "3" }), ctx);
  assert.equal(hard.total, all.filter((x) => S.typeOf(x) === "case" && x.d === 3).length);
  assert.equal(hard.type.case, hard.total, "the chosen option's count is the total");
  assert.equal(hard.d["3"], hard.total);
  assert.equal(hard.type.all, all.filter((x) => x.d === 3).length, "a row's own counts ignore that row");
});

test("draw: never over the pool, every row honoured, spread across modules by customDraw", () => {
  const L = pool(), ctx = ctxFor(L);
  const a = S.draw(L, { type: "case", seen: "all", d: "mix", n: 10 }, ctx, seq(1));
  assert.equal(a.length, 10); assert.ok(a.every((x) => S.typeOf(x) === "case"));
  const mods = new Set(a.map((x) => x._m)); assert.ok(mods.size >= 2, "spread across module files");
  const b = S.draw(L, { type: "img", seen: "all", d: "mix", n: 50 }, ctx, seq(2));
  assert.equal(b.length, 6, "capped by the pool");
  const c = S.draw(L, { type: "all", seen: "due", d: "2", n: 50 }, ctx, seq(3));
  assert.ok(c.length > 0 && c.every((x) => x.d === 2 && ctx.cards["p:" + x._m + ":" + x.id][3] <= ctx.today));
  const d = S.draw(L, { type: "all", seen: "bm", d: "mix", n: 50 }, ctx, seq(4));
  assert.ok(d.every((x) => ctx.bm[x.id]));
  assert.equal(new Set(S.draw(L, { n: 60, seen: "all" }, ctx, seq(5)).map((x) => x.id)).size, 60, "no repeats");
});

test("Mix: repeat 50/30/20 new, due, incorrect; types in thirds; difficulty in proportion; shortfalls refilled", () => {
  const L = pool(), ctx = ctxFor(L);
  const r = S.draw(L, { type: "all", seen: "mix", d: "mix", n: 10 }, ctx, seq(7));
  const by = (x) => S.seenOf(x, ctx), n = (k) => r.filter((x) => by(x) === k).length;
  assert.equal(r.length, 10); assert.equal(n("new"), 5); assert.equal(n("due"), 3); assert.equal(n("wrong"), 2);
  const t = S.draw(L, { type: "mix", seen: "all", d: "mix", n: 15 }, ctx, seq(8));
  const tn = (k) => t.filter((x) => S.typeOf(x) === k).length;
  assert.equal(tn("img"), 5); assert.equal(tn("case"), 5); assert.equal(tn("line"), 5);
  const t2 = S.draw(L, { type: "mix", seen: "all", d: "mix", n: 30 }, ctx, seq(9));
  assert.equal(t2.length, 30); assert.equal(t2.filter((x) => S.typeOf(x) === "img").length, 6, "only 6 images: the rest goes to the other types");
  assert.deepEqual(S.allocate({ a: 10, b: 2, c: 0 }, 12, { a: 1, b: 1, c: 1 }), { a: 10, b: 2, c: 0 });
  assert.deepEqual(S.allocate({ x: 30, y: 10 }, 8, { x: 30, y: 10 }), { x: 6, y: 2 }, "proportional");
  assert.deepEqual(S.allocate({ new: 1, due: 0, wrong: 0, seen: 9 }, 4, { new: 0.5, due: 0.3, wrong: 0.2, seen: 0 }), { new: 1, due: 0, wrong: 0, seen: 3 }, "a weight-0 group fills what is left");
});

test("very hard: a fifth difficulty (d 4 or vh), counted, filtered, drawn and named", () => {
  assert.deepEqual(S.DIFFS.map((d) => d[0]), ["1", "2", "3", "4", "mix"]);
  assert.equal(S.DIFFS[3][1], "Very hard");
  assert.equal(S.dOf(it("a", { d: 3, vh: true })), 4); assert.equal(S.dOf(it("b", { d: 4 })), 4); assert.equal(S.dOf(it("c", { d: 3 })), 3); assert.equal(S.dOf(it("d", { d: 7 })), 2);
  const L = [[it("v1", { d: 3, vh: true }), it("v2", { d: 4 }), it("h1", { d: 3 }), it("e1", { d: 1 })], [it("v3", { d: 3, vh: true, _m: "m2", t: "m2" }), it("m1", { _m: "m2", t: "m2" })]];
  const ctx = { cards: {}, bm: {}, mt: {}, today: 10 };
  const c = S.counts(L, S.normSel({ type: "all", seen: "all", d: "mix" }), ctx);
  assert.deepEqual([c.d["1"], c.d["2"], c.d["3"], c.d["4"], c.d.mix], [1, 1, 1, 3, 6]);
  assert.equal(S.normSel({ d: "4" }).d, "4", "4 is a valid choice");
  const v = S.draw(L, { type: "all", seen: "all", d: "4", n: 10 }, ctx, seq(11));
  assert.deepEqual(v.map((x) => x.id).sort(), ["v1", "v2", "v3"]);
  const mix = S.draw(L, { type: "all", seen: "all", d: "mix", n: 6 }, ctx, seq(12));
  assert.equal(mix.filter((x) => S.dOf(x) === 4).length, 3, "Mix keeps the pool's own share of very hard");
  const h = S.relaxHint([[it("e9", { d: 1 })]], { type: "all", seen: "all", d: "4", n: 10 }, ctx);
  assert.match(h.msg, /^No very hard questions match/);
});

test("defaults never pick an empty option: fit() falls back to All (Mix for difficulty), keeps a choice that has questions", () => {
  const L = [[it("a1"), it("a2", { d: 1 }), it("a3", { d: 3 })]], ctx = { cards: {}, bm: {}, mt: {}, today: 10 };
  // The owner's phone: "Incorrect before" remembered, nothing answered wrong yet -> All, every question back.
  const f = S.fit(L, { type: "all", seen: "wrong", d: "mix", n: 20 }, ctx);
  assert.equal(f.sel.seen, "all"); assert.deepEqual(f.moved, ["seen"]);
  assert.equal(S.counts(L, f.sel, ctx).total, 3);
  // Several empty rows at once: each falls back.
  const g = S.fit(L, { type: "img", seen: "bm", d: "4", n: 10 }, ctx);
  assert.deepEqual([g.sel.type, g.sel.seen, g.sel.d], ["all", "all", "mix"]);
  assert.deepEqual(g.moved, ["seen", "type", "d"]);
  // A choice with questions is kept; a row the scope hides is left alone.
  const h = S.fit(L, { type: "all", seen: "new", d: "1", n: 10 }, ctx);
  assert.deepEqual([h.sel.seen, h.sel.d, h.moved.length], ["new", "1", 0]);
  assert.equal(S.fit(L, { seen: "wrong" }, ctx, { seen: false }).sel.seen, "wrong");
  // An empty scope has nothing to fall back to: the choice stays and the sheet says the scope is empty.
  assert.equal(S.fit([[]], { seen: "wrong" }, ctx).sel.seen, "wrong");
});

test("empty pool: names the row to relax; a scope with nothing says so", () => {
  const L = pool(), ctx = ctxFor(L);
  const h = S.relaxHint(L, { type: "img", seen: "due", d: "3", n: 10 }, ctx);
  assert.ok(S.counts(L, S.normSel({ type: "img", seen: "due", d: "3" }), ctx).total === 0);
  assert.ok(h && h.dim && /^No (image-based|due for review|hard) questions match\. Choose /.test(h.msg), h && h.msg);
  assert.equal(S.relaxHint(L, { type: "all", seen: "all", n: 10 }, ctx), null, "nothing to relax when the pool is not empty");
  assert.match(S.relaxHint([[]], {}, ctx).msg, /no questions to practise yet/);
});

test("remembered per scope; sel normalised; timer to runner options; one-line summary", () => {
  let m = S.remember({}, "module", "ana-x", { type: "case", n: 30, mode: "exam", timer: "q", qs: 45 });
  m = S.remember(m, "module", "ana-y", { type: "img", n: 10 });
  assert.equal(S.recall(m, "module", "ana-x").type, "case");
  assert.equal(S.recall(m, "module", "ana-z").type, "img", "an unknown module gets the kind's last choice");
  assert.equal(S.recall({}, "deck", "d1").n, 20, "defaults");
  assert.ok(S.hasLast(m, "module", "ana-x") && !S.hasLast(m, "deck", "d1"));
  const big = {}; for (let i = 0; i < 60; i++) Object.assign(big, S.remember(big, "k" + i, "", {}));
  assert.ok(Object.keys(S.remember(big, "z", "", {})).length <= 40, "40 entries at most");
  assert.deepEqual(S.normSel({ type: "bogus", n: 900, mode: "x", timer: "q", qs: 3 }), { type: "all", seen: "mix", d: "mix", n: 20, mode: "study", timer: "q", qs: 60, mins: 0 });
  assert.deepEqual(S.runOpts({ mode: "exam" }, 25), { limit: 1500 }, "a timed test without a timer runs at exam pace, 1 min a question");
  assert.deepEqual(S.runOpts({ mode: "exam", timer: "set", mins: 12 }, 25), { limit: 720 });
  assert.deepEqual(S.runOpts({ mode: "study", timer: "q", qs: 30 }, 25), { qsec: 30 });
  assert.deepEqual(S.runOpts({ mode: "study" }, 25), {});
  assert.equal(S.summary({ n: 30, seen: "new", d: "3", mode: "exam", timer: "q", qs: 45 }), "30 questions · new · hard · timed test, 45 s a question");
});

/* ---------- PDF images ---------- */
async function pdfPages() {
  const lib = require("../vendor/pdfjs/pdf.min.js");
  lib.GlobalWorkerOptions.workerSrc = require.resolve("../vendor/pdfjs/pdf.worker.min.js");
  const doc = await lib.getDocument({ data: new Uint8Array(Buffer.from(makeImagePdf(), "latin1")), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) { const pg = await doc.getPage(p); const ol = await pg.getOperatorList(); pages.push({ p, view: pg.view, imgs: SR.imageBoxes(ol.fnArray, ol.argsArray, lib.OPS) }); }
  await doc.destroy();
  return pages;
}

test("synthetic PDF: imageBoxes places all five drawings; pickImages keeps the two pictures", async () => {
  const pages = await pdfPages();
  assert.equal(pages[0].imgs.length, 3); assert.equal(pages[1].imgs.length, 2);
  assert.deepEqual(pages[0].imgs[0].box, [150, 330, 450, 630]); assert.equal(pages[0].imgs[0].w, 240);
  const picks = SR.pickImages(pages);
  assert.deepEqual(picks.map((x) => [x.p, x.w, x.h]), [[1, 240, 240], [2, 260, 200]]);
  assert.ok(picks.every((x) => /^\d+:/.test(x.k)));
});

test("pickImages rules: 200 px minimum, page share, aspect, repeats by id or place, cap 20, top to bottom", () => {
  const view = [0, 0, 600, 800], img = (id, w, h, box) => ({ id, w, h, box });
  const pages = [
    { p: 1, view, imgs: [img("a", 400, 400, [50, 100, 350, 400]), img("small", 150, 400, [50, 450, 350, 750]), img("tiny", 400, 400, [0, 0, 40, 40]),
      img("banner", 1600, 200, [0, 600, 600, 680]), img("logo", 300, 300, [400, 600, 560, 760]), img("top", 300, 300, [100, 420, 400, 720])] },
    { p: 2, view, imgs: [img("logo", 300, 300, [400, 600, 560, 760]), img("other", 300, 300, [10, 10, 300, 300]), img("hdrB", 300, 300, [100, 700, 300, 790])] },
    { p: 3, view, imgs: [img("hdrC", 300, 300, [100, 700, 300, 790])] },
  ];
  const k = SR.pickImages(pages).map((x) => x.id);
  assert.deepEqual(k, ["top", "a", "other"], "logo (same id on 2 pages) and the header drawn at one place on 2 pages are out; top first");
  const many = [{ p: 1, view, imgs: Array.from({ length: 30 }, (_, i) => img("m" + i, 300, 300, [0, i, 300, 300 + i])) }];
  assert.equal(SR.pickImages(many).length, 20);
  const form = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintJpegXObject: 82 };
  const b = SR.imageBoxes([10, 12, 74, 85, 75, 11, 86], [[], [2, 0, 0, 2, 10, 20], [[1, 0, 0, 1, 5, 5], null], ["x", 300, 300], [], [], [{ width: 250, height: 260 }]], form);
  assert.deepEqual(b[0], { id: "x", w: 300, h: 300, box: [20, 30, 22, 32] }, "transform and form matrix applied");
  assert.equal(b[1].id, "inline-6"); assert.equal(b[1].w, 250); assert.deepEqual(b[1].box, [0, 0, 1, 1], "restore pops the transform");
  assert.ok(SR.cropScale({ w: 240, h: 240, box: [0, 0, 300, 300] }) === 0.8 && SR.cropScale({ w: 4000, h: 3000, box: [0, 0, 200, 150] }) === 6);
});

test("nearSents: caption first in the page's text, neighbours when the page is thin, 12 at most", () => {
  const sents = [
    { n: 1, p: 1, h: "A", tx: "Intro on page one." }, { n: 2, p: 2, h: "B", tx: "Body text." }, { n: 3, p: 2, h: "B", tx: "Figure 2 shows target cells." }, { n: 4, p: 2, h: "B", tx: "More body." },
    { n: 5, p: 3, h: "C", tx: "Page three." },
  ];
  assert.deepEqual(SR.nearSents(sents, 2).map((s) => s.n), [2, 3, 4]);
  assert.deepEqual(SR.nearSents(sents, 3).map((s) => s.n), [2, 3, 4, 5], "a thin page takes its neighbours");
  assert.deepEqual(SR.nearSents(sents, 2, 30).map((s) => s.n), [3], "the caption wins when there is room for one");
  assert.deepEqual(Object.keys(SR.nearSents(sents, 2)[0]).sort(), ["h", "n", "p", "tx"]);
});

test("deck image step: image and nearby text sent; image saved only with a question; a skipped image is dropped", async () => {
  const stored = { imgs: [], items: [], decks: 0 };
  const store = { putImgs: async (r) => { stored.imgs.push(...r); }, putItems: async (r) => { stored.items.push(...r); }, putDeck: async () => { stored.decks++; }, putFacts: async () => {}, putCards: async () => {}, putSrc: async () => {} };
  const sents = [{ n: 1, p: 1, h: "Chest", s: "sec-0", tx: "Figure 1 is a chest X-ray of tension pneumothorax." }, { n: 2, p: 1, h: "Chest", s: "sec-0", tx: "Needle decompression comes first." }, { n: 3, p: 2, h: "Chest", s: "sec-0", tx: "Unrelated." }];
  const m = { id: "gen_aaaaaaaaaaaa", title: "Chest", exam: "neet-pg", profileV: 1, pv: "p1", source: { name: "c.pdf", sha: "f".repeat(64) }, stats: { facts: 0, generated: 0, accepted: 0, rejected: 0, regenerated: 0, cards: 0 }, cost: { inTok: 0, outTok: 0, thinkTok: 0, inr: 0 }, topics: [], prog: { done: [0] } };
  const data = "data:image/webp;base64," + Buffer.alloc(600, 3).toString("base64");
  const job = PC.newJob({ m, sents, sections: [{ id: "sec-0", title: "Chest" }], facts: [], items: [], saved: true, target: 2, ctx: { doc: "ffffffffffff", name: "c.pdf", exam: "neet-pg" }, imgs: [{ p: 1, k: "1:img_a", w: 300, h: 300, data }, { p: 1, k: "1:img_b", w: 300, h: 300, data }] });
  assert.equal(job.round.textTarget, 0, "two images waiting: the round asks for no text questions");
  const sent = [];
  let n = 0;
  const send = async (body) => { sent.push(body); n++; return n === 1 ? { items: [{ id: "q_x", q: "The X-ray shown: diagnosis?", o: ["Tension pneumothorax", "Effusion", "Collapse", "Consolidation"], a: 0, r: ["a", "b", "c", "d"], fid: "f_1", d: 2, src: { sn: [1], p: [1] } }], skipped: null, usage: { inTok: 1, outTok: 1 } } : { items: [], skipped: "unsupported" }; };
  assert.deepEqual(PC.nextOp(job), { op: "imcq" });
  await PC.step(job, PC.nextOp(job), { send, store });
  await PC.step(job, PC.nextOp(job), { send, store });
  assert.equal(PC.nextOp(job), null, "both images done");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].op, "imcq"); assert.equal(sent[0].img.mime, "image/webp"); assert.equal(sent[0].img.data, data.split(",")[1]);
  assert.deepEqual(sent[0].near.map((s) => s.n), [1, 2, 3], "page 1 is thin: page 2 joins");
  assert.equal(sent[0].t, "sec-0"); assert.deepEqual(Object.keys(sent[0].near[0]).sort(), ["h", "n", "p", "tx"]);
  assert.equal(stored.imgs.length, 1, "only the image that got a question is kept"); assert.equal(stored.items.length, 1);
  assert.equal(stored.items[0].imgId, stored.imgs[0].id); assert.equal(stored.items[0].imgPlace, "stem");
  assert.equal(job.imgKept, 1); assert.equal(job.imgDone, 2); assert.equal(m.stats.img, 1); assert.equal(m.stats.imgSkipped, 1);
  const items = PC.attachImages([{ id: "q", imgId: stored.imgs[0].id }, { id: "r" }], stored.imgs);
  assert.deepEqual(items[0].img, [data]); assert.equal(items[1].img, undefined);
  assert.equal(PC.imgB64("data:image/gif;base64,AAAA"), null);
});
