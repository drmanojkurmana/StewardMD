/* PrepNucleus Layer C, owner request 2026-10-09: caps 5 a day and 30 a month, 50 questions a deck made 10 at a time,
 * the page picker's 60-page cap, a round that survives the app closing, MaiK Token estimates, a restored deck's facts.
 * node --test test/prep-create-rounds.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const req = createRequire(import.meta.url);
const SR = req("../prep-source.js");
const DK = req("../prep-decks.js");
const PC = req("../prep-create.js");

/* ---------- caps agree with the server ---------- */
test("caps: 5 new decks a day, 30 a month; the words on screen say the same", async () => {
  const { prepCaps } = await import("../functions/api/ai/_prep-generate.js");
  const c = prepCaps({});
  assert.equal(c.decksDay, PC.DAY_CAP); assert.equal(c.decksMonth, PC.MONTH_CAP);
  assert.equal(PC.DAY_CAP, 5); assert.equal(PC.MONTH_CAP, 30);
  assert.ok(c.deckQ >= PC.DECK_MAX, "the server's guard sits above the phone's 50");
  assert.match(PC.MSG["daily-decks"], /5 decks today/); assert.match(PC.MSG["month-decks"], /30 decks this month/);
  assert.equal(PC.capLine({ month: 31, day: 6, at: "2026-10-09" }, "2026-10-09"), "30 of 30 decks this month, 5 of 5 today", "never shows more than the cap");
});

/* ---------- 50 a deck, 10 at a time ---------- */
// Sentences with their own words each (the phone drops a question too close to one already in the deck, gate 12).
const SYL = ["ka", "lo", "mi", "ne", "tu", "ra", "so", "vi", "de", "po", "zu", "fe", "gi", "ha", "ju", "be"];
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const word = () => SYL[Math.floor(rnd() * 16)] + SYL[Math.floor(rnd() * 16)] + SYL[Math.floor(rnd() * 16)];
const NOTE = (n) => Array.from({ length: n }, () => "The " + Array.from({ length: 9 }, word).join(" ") + ".").join("\n");
function memStore() {
  const s = { src: {}, decks: {}, facts: {}, items: {}, cards: {}, imgs: {} };
  const put = (o, key) => async (recs) => { (Array.isArray(recs) ? recs : [recs]).forEach((r) => { o[r[key]] = JSON.parse(JSON.stringify(r)); }); };
  return { s, changed: () => { s.changedN = (s.changedN || 0) + 1; }, putSrc: put(s.src, "deckId"), putDeck: put(s.decks, "id"), putFacts: put(s.facts, "id"), putItems: put(s.items, "id"), putCards: put(s.cards, "id"), putImgs: put(s.imgs, "id"), delImgs: async (ids) => ids.forEach((i) => delete s.imgs[i]) };
}
function server(opts = {}) {
  const log = [];
  const usage = { inTok: 1000, outTok: 300, thinkTok: 0, inr: 0.0672, mt: 134, dayDecks: 1, monthDecks: 1 };
  const send = async (b) => {
    log.push(b.op);
    if (opts.fail && opts.fail(b, log.length)) throw PC.opError(0, null);
    if (b.op === "facts") return { facts: b.chunk.sents.map((s) => ({ fid: "f_" + DK.sha12(b.deckId + s.n), ft: s.tx, cq: "Q " + s.tx, sn: [s.n], fk: "recall", p: s.p, h: s.h })), usage };
    if (b.op === "mcq") return { items: b.facts.map((f) => ({ id: "q_" + DK.sha12(f.fid), q: "Which is right? " + f.ft, o: ["a" + f.fi, "b", "c", "d"], a: 0, r: ["w", "x", "y", "z"], d: 2, fid: f.fid })), usage };
    if (b.op === "solve") return { solved: b.q.map((q) => ({ id: q.id, ok: true })), usage };
    if (b.op === "review") return { gates: b.q.map((q, i) => ({ i, id: q.id, g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: false })), usage, wallet: { balanceMt: 900, costCapOn: false } };
    if (b.op === "imcq") return opts.imgOk ? { items: [{ id: "q_img" + log.length, q: "The image shown is which " + word() + " " + word() + " " + word() + "?", o: ["a", "b", "c", "d"], a: 0, r: ["w", "x", "y", "z"], d: 2, fid: "f_img" + log.length }], usage } : { items: [], skipped: "unsupported", usage };
    throw new Error(b.op);
  };
  return { send, log };
}
const ctx = { doc: "abcabcabcabc", name: "n", exam: "neet-pg", pv: "p1", model: "m" };
function deckJob(store, target, extra) {
  const doc = SR.docFromNotes(NOTE(70), "Pharma");
  const m = DK.newManifest({ id: "gen_r", title: "Pharma", exam: "neet-pg", profileV: 1, pv: "p1", model: "m", source: { type: "paste", name: "", pages: null, sha: "s" } });
  return PC.newJob(Object.assign({ m, sents: doc.sents, sections: doc.sections, facts: [], items: [], saved: false, target, ctx }, extra || {}));
}
function moreJob(store, imgs) {
  const m = store.s.decks.gen_r;
  return PC.newJob({ m, sents: store.s.src.gen_r.sents, sections: store.s.src.gen_r.sections, facts: Object.values(store.s.facts), items: Object.values(store.s.items), saved: true, target: PC.roundTarget(DK.questionCount(m)), ctx, imgs });
}

test("10 at a time up to 50: each round adds exactly 10, the fifth fills the deck, then there is nothing more to ask for", async () => {
  const store = memStore(), srv = server();
  let j = deckJob(store, 10), counts = [];
  let r = await PC.runRound(j, { send: srv.send, store });
  counts.push(DK.questionCount(store.s.decks.gen_r));
  for (let k = 0; k < 4; k++) { r = await PC.runRound(moreJob(store), { send: srv.send, store }); counts.push(DK.questionCount(store.s.decks.gen_r)); }
  assert.deepEqual(counts, [10, 20, 30, 40, 50]);
  assert.equal(r.full, true);
  assert.equal(PC.roundTarget(50), 0); assert.equal(PC.roundTarget(45), 5); assert.equal(PC.roundTarget(0), 10);
  assert.equal(PC.newRound(PC.roundTarget(45)).maxBatches, 1, "a round of 5 has a smaller cost ceiling");
  assert.equal(PC.newRound(10).maxBatches, 2, "a round of 10: ceil(10 x 1.4 / 7)");
  assert.equal(store.s.decks.gen_r.rounds, 5);
  assert.ok(store.s.changedN >= 5, "every finished round asks for the file copy and the backup");
  const st = PC.deckStats(store.s.decks.gen_r, { cards: {}, mod: { "deck-gen_r": { t: 8, ok: 6 } } }, 1);
  assert.deepEqual([st.n, st.max, st.full, st.acc], [50, 50, true, 75]);
});

test("a round with images waiting: up to 5 of its 10 are image questions, the text part asks for the rest", async () => {
  const store = memStore(), srv = server({ imgOk: true });
  const img = (k) => ({ p: 1, k: "1:" + k, w: 300, h: 300, data: "data:image/webp;base64," + Buffer.alloc(300, 1).toString("base64") });
  const j = deckJob(store, 10, { imgs: [img("a"), img("b"), img("c"), img("d"), img("e"), img("f"), img("g")] });
  assert.equal(j.round.textTarget, 5);
  const r = await PC.runRound(j, { send: srv.send, store });
  assert.equal(r.accepted, 10);
  assert.equal(srv.log.filter((x) => x === "imcq").length, 5);
  assert.equal(j.imgQ.length, 2, "two images wait for the next round");
  const m = store.s.decks.gen_r;
  assert.equal(m.imgPend.length, 2, "and are kept with the deck (pend) so the next 10 can use them");
  assert.equal(Object.values(store.s.imgs).filter((x) => x.pend).length, 2);
  assert.equal(Object.values(store.s.imgs).filter((x) => !x.pend).length, 5);
});

test("a round cut off (app closed, network gone) is saved in the manifest and continues where it stopped, without asking again for what was done", async () => {
  const store = memStore();
  const cut = server({ fail: (b) => b.op === "review" });
  const j = deckJob(store, 10);
  const r1 = await PC.runRound(j, { send: cut.send, store });
  assert.equal(r1.ok, false); assert.equal(r1.code, "offline"); assert.ok(PC.AUTO_RESUME.offline);
  const saved = store.s.decks.gen_r;
  assert.ok(PC.runOk(saved.run), "the running round is in the manifest");
  assert.deepEqual(saved.run.batches.map((b) => b.stage), ["review", "review"]);
  // The app restarts: a new job from storage picks the round up at the review step.
  const srv = server();
  const again = PC.newJob({ m: JSON.parse(JSON.stringify(saved)), sents: store.s.src.gen_r.sents, sections: store.s.src.gen_r.sections, facts: Object.values(store.s.facts), items: Object.values(store.s.items), saved: true, target: 10, ctx });
  const r2 = await PC.runRound(again, { send: srv.send, store });
  assert.equal(r2.ok, true);
  assert.deepEqual(srv.log, ["review", "review"], "only the cut-off reviews are sent");
  assert.equal(DK.questionCount(store.s.decks.gen_r), 10);
  assert.equal(store.s.decks.gen_r.run, null);
});

test("MaiK Tokens: a round's tokens are summed for the result, the deck's average sets the next estimate", async () => {
  const store = memStore();
  const j = deckJob(store, 10);
  assert.equal(PC.mtEstimate(j.m), PC.MT_ROUND_DEFAULT, "no history: the default");
  const srv = server();
  const r = await PC.runRound(j, { send: srv.send, store });
  assert.deepEqual(srv.log, ["facts", "mcq", "mcq", "solve", "solve", "review", "review"]);
  assert.equal(r.mt, 134 * 7, "the 7 calls' MaiK Tokens");
  assert.equal(j.wallet.balanceMt, 900);
  assert.equal(store.s.decks.gen_r.cost.mt, 134 * 7);
  assert.equal(PC.mtEstimate(store.s.decks.gen_r), 900, "938 rounded to 100");
});

test("difficulty and exam: one level goes to the server as dl, the exam mix as weights; FMGE decks use NEET-PG", () => {
  assert.deepEqual(PC.mixFor(5, PC.PROFILE, 3).dl, 3);
  assert.deepEqual(PC.mixFor(5, PC.PROFILE, "mix").dl, { 1: 0.3, 2: 0.5, 3: 0.2 });
  assert.equal(PC.createExam("fmge"), "neet-pg"); assert.equal(PC.createExam("usmle"), "usmle");
});

test("a restored deck (no source on this phone) sends each unused fact's cited sentence as quote", () => {
  const f = { id: "f_" + "1".repeat(12), ft: "F", cq: "C", sn: [4], fk: "recall", p: [2], h: "H", sec: "sec-1", quote: "Cited sentence four." };
  const p = PC.factPayload(f, 0, {});
  assert.equal(p.quote, "Cited sentence four."); assert.equal(p.sents, undefined);
  const q = PC.factPayload(f, 0, { 4: { n: 4, tx: "Live sentence four." } });
  assert.deepEqual(q.sents, [{ n: 4, tx: "Live sentence four." }]); assert.equal(q.quote, undefined);
});

/* ---------- the page picker ---------- */
test("pages: small PDFs start with every page, long ones with none; the 60-page cap holds for taps, ranges and typing", () => {
  assert.equal(SR.selInitial(12).length, 12);
  assert.deepEqual(SR.selInitial(500), [], "never a silent first 60");
  let sel = [];
  for (let p = 1; p <= 60; p++) sel = SR.selToggle(sel, p, 500).sel;
  assert.equal(sel.length, 60);
  const over = SR.selToggle(sel, 61, 500);
  assert.equal(over.sel, sel, "the 61st tap is refused whole"); assert.match(over.error, /up to 60 pages/);
  assert.equal(SR.selToggle(sel, 30, 500).sel.length, 59, "untapping still works at the cap");
  const r = SR.selRange([], 100, 159, 500); assert.equal(r.sel.length, 60); assert.equal(r.sel[0], 100);
  const r2 = SR.selRange([1], 100, 159, 500); assert.match(r2.error, /that would make 61/); assert.deepEqual(r2.sel, [1]);
  assert.deepEqual(SR.selRange([], 9, 5, 500).sel, [5, 6, 7, 8, 9], "either order");
  assert.match(SR.selFromSpec("100-200", 500).error, /up to 60 pages/);
  assert.equal(SR.selFromSpec("120-160", 500).sel.length, 41);
  assert.deepEqual(SR.selFromSpec("3-5, 9", 500).sel, [3, 4, 5, 9]);
  assert.match(SR.selFromSpec("600", 500).error, /has 500 pages/);
  assert.equal(SR.selSpec([1, 2, 3, 7, 9, 10]), "1-3, 7, 9-10");
});

test("pages: the virtual grid draws only the rows in view plus a buffer, at any length", () => {
  // 500 pages, 3 columns, rows of 170 px, an 800 px view at the top and at the bottom.
  const top = SR.gridWindow(0, 800, 200, 170, 3, 500, 2);
  assert.deepEqual(top, { from: 1, to: 3 * (Math.floor(800 / 170) + 3) });
  assert.ok(top.to - top.from + 1 < 60, "a long PDF never has hundreds of cells in the page");
  const end = SR.gridWindow(200 + 166 * 170, 800, 200, 170, 3, 500, 2);
  assert.equal(end.to, 500);
  assert.ok(end.from > 450);
});
