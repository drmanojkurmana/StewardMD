/* PrepNucleus Cards: card validators (prep-flash.js pure helpers the reviewer draws with), the generator's gates and
 * pipeline (tools/prep-cards.mjs) and the scheduling hook into the shared FSRS store.
 * What must hold: a basic front is a question, a cloze has exactly one blank, an occlusion uses cleared media with boxes
 * inside the image, every card cites a source; a card naming a number or drug its source lacks, copying 12 words, naming
 * a book or page, or using a dash is refused; near-duplicate fronts are dropped; cards write FSRS rows under
 * "p:<module>:c" that recall() over the module sees but the MCQ progress count does not; due cards come first and new
 * cards stop at the daily cap; the interval preview equals what a grade writes; the dry run makes no call; the Batch
 * pipeline checks, drops and resumes without resubmitting; a hand deck is never overwritten; the committed sample passes.
 *
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-flash.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as T from "../tools/prep-cards.mjs";
import { loadTaxonomy } from "../tools/prep-build-bank.mjs";
import { moduleIndex } from "../tools/prep-lessons.mjs";

const req = createRequire(import.meta.url);
const F = req("../prep-flash.js");
const C = req("../specialty-core.js");
const P = req("../prep.js");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE = JSON.parse(fs.readFileSync(join(ROOT, "prep/cards/v1/sur-breast-cancer.json"), "utf8"));
const W = (n, w = "word") => Array.from({ length: n }, () => w).join(" ");
const basic = (o = {}) => Object.assign({ id: "c1", kind: "basic", fr: "Which drug is first line?", bk: "Drug A.", src: { item: "x" }, gen: "AI" }, o);
const occl = (o = {}) => Object.assign({ id: "o1", kind: "occl", fr: "Name each label.", img: "prep/lessons/media/breast-t-size.svg", boxes: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, label: "T1" }], src: { kb: "kb-x" }, gen: "hand" }, o);

test("checkCard: basic fronts are questions within 25 words, backs within 40", () => {
  assert.deepEqual(F.checkCard(basic()), []);
  assert.match(F.checkCard(basic({ fr: "Drug A is first line." })).join(), /must be a question/);
  assert.match(F.checkCard(basic({ fr: W(26) + "?" })).join(), /26 words/);
  assert.match(F.checkCard(basic({ bk: W(41) })).join(), /41 words/);
  assert.match(F.checkCard(basic({ bk: "" })).join(), /no back/);
  assert.match(F.checkCard(basic({ id: "Bad Id" })).join(), /id must/);
  assert.match(F.checkCard(basic({ src: {} })).join(), /src needs/);
  assert.match(F.checkCard(basic({ gen: "x" })).join(), /gen must/);
  assert.match(F.checkCard(basic({ kind: "x" })).join(), /kind must/);
});
test("checkCard: a cloze has exactly one blank; the hidden term counts toward the 25 words", () => {
  const cz = (fr) => basic({ kind: "cloze", fr, bk: "Because." });
  assert.deepEqual(F.checkCard(cz("The drug of choice is {{drug A}}.")), []);
  assert.match(F.checkCard(cz("No blank here.")).join(), /exactly one/);
  assert.match(F.checkCard(cz("{{a}} and {{b}}.")).join(), /exactly one/);
  assert.match(F.checkCard(cz("{{" + W(26) + "}}")).join(), /26 words/);
  assert.deepEqual(F.clozeParts("A {{b c}} d."), { pre: "A ", term: "b c", post: " d." });
  assert.equal(F.plainFront(cz("A {{b}} c.")), "A b c.");
  assert.match(F.checkCard(basic({ fr: "Is {{x}} right?" })).join(), /no \{\{blank\}\}/);
});
test("checkCard: occlusion needs cleared media and labelled boxes inside the image", () => {
  assert.deepEqual(F.checkCard(occl()), []);
  assert.match(F.checkCard(occl({ img: "https://x.org/a.png" })).join(), /cleared in-app media/);
  assert.match(F.checkCard(occl({ img: "prep/lessons/media/../x.svg" })).join(), /cleared/);
  assert.match(F.checkCard(occl({ boxes: [] })).join(), /1 to 8 boxes/);
  assert.match(F.checkCard(occl({ boxes: [{ x: 0.9, y: 0, w: 0.2, h: 0.1, label: "a" }] })).join(), /inside the image/);
  assert.match(F.checkCard(occl({ boxes: [{ x: 0, y: 0, w: 0.2, h: 0.1, label: "" }] })).join(), /needs a label/);
});
test("checkDeck: unique ids, 1 to 60 cards", () => {
  assert.deepEqual(F.checkDeck({ v: 1, module: "m", cards: [basic()] }), []);
  assert.match(F.checkDeck({ v: 1, module: "m", cards: [basic(), basic()] }).join(), /duplicate id/);
  assert.match(F.checkDeck({ v: 1, module: "m", cards: Array.from({ length: 61 }, (x, i) => basic({ id: "c" + i })) }).join(), /1 to 60/);
  assert.match(F.checkDeck({ v: 2 }).join(), /not a v1/);
});

test("gates: numbers and drugs must be in the card's own source; no copy, book, page or dash", () => {
  const src = "QUESTION: Drug of choice for absence seizures?\nANSWER: Ethosuximide\nEXPLANATION: Ethosuximide blocks T-type calcium channels in thalamic neurons and is used at 20 mg/kg in children with typical absence seizures and three spikes a second on EEG.";
  const ok = basic({ fr: "Which drug is first choice for typical absence seizures?", bk: "Ethosuximide, which blocks T-type calcium channels in the thalamus." });
  assert.deepEqual(T.gateCard(ok, src), []);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Ethosuximide at 30 mg/kg." }), src).join(), /numbers not in the source: 30/);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Valproate or ethosuximide." }), src).join(), /drugs not in the source/);
  assert.match(T.gateCard(basic({ fr: "How does ethosuximide work?", bk: "It blocks T-type calcium channels in thalamic neurons and is used at 20 mg/kg in children" }), src).join(), /12 or more words/);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Ethosuximide (Bailey and Love)." }), src).join(), /book/);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Ethosuximide, see pg 45." }), src).join(), /book/);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Ethosuximide — first line." }), src).join(), /dash/);
  assert.match(T.gateCard(basic({ fr: "Which drug treats absence seizures?", bk: "Ethosuximide - first line." }), src).join(), /dash/);
  assert.deepEqual(T.gateCard(basic({ fr: "Which T-type channel blocker treats absence seizures?", bk: "Ethosuximide." }), src), [], "hyphenated words are not dashes");
  assert.match(T.gateCard(basic({ fr: "Ethosuximide treats absence seizures.", bk: "Yes." }), src).join(), /must be a question/);
});
test("dedupe drops near-duplicate fronts; frontSim ignores case, punctuation and cloze braces", () => {
  assert.equal(F.frontSim("Which drug treats absence seizures?", "which DRUG treats absence seizures"), 1);
  assert.equal(F.frontSim("{{Ethosuximide}} treats absence seizures.", "Ethosuximide treats absence seizures"), 1);
  const out = T.dedupe([basic({ id: "a", fr: "Which drug treats absence seizures?" }), basic({ id: "b", fr: "Which drug treats typical absence seizures?" }), basic({ id: "c", fr: "What is the EEG in absence seizures?" })]);
  assert.deepEqual(out.map((c) => c.id), ["a", "c"]);
});
test("toCard maps ref to the request's source; an unknown ref is dropped; ids are stable", () => {
  const rq = { kind: "items", srcs: [{ ref: "i1", id: "item-1", text: "t1" }] };
  const c = T.toCard({ kd: "cloze", fr: "The drug is {{X}}.", bk: "Why.", ref: "i1" }, rq, "mod");
  assert.equal(c.kind, "cloze"); assert.deepEqual(c.src, { item: "item-1" }); assert.equal(c.gen, "AI"); assert.match(c.id, /^k[0-9a-f]{10}$/);
  assert.equal(T.toCard({ kd: "basic", fr: "Q?", bk: "A", ref: "i9" }, rq, "mod"), null);
  assert.deepEqual(T.toCard({ kd: "basic", fr: "Q?", bk: "A", ref: "k1" }, { kind: "kb", srcs: [{ ref: "k1", id: "kb-a", text: "" }] }, "mod").src, { kb: "kb-a" });
  assert.equal(T.cardId("m", "Q {{a}}?"), T.cardId("m", "q a?"));
});
test("usableItems: flagged, unexplained and malformed items never become sources; negative stems last", () => {
  const exp = W(50);
  const items = [
    { id: "a", q: "Which is NOT true?", o: ["1", "2", "3", "4"], a: 0, exp },
    { id: "b", q: "Drug of choice?", o: ["1", "2", "3", "4"], a: 1, exp },
    { id: "c", q: "Flagged?", o: ["1", "2", "3", "4"], a: 1, exp, flags: ["disputed"] },
    { id: "d", q: "No exp?", o: ["1", "2", "3", "4"], a: 1, exp: "short" },
    { id: "e", q: "Three options?", o: ["1", "2", "3"], a: 1, exp },
  ];
  assert.deepEqual(T.usableItems(items).map((x) => x.id), ["b", "a"]);
  assert.equal(T.targetFor(7), 4); assert.equal(T.targetFor(500), 60);
});
test("schema keys are two letters or more (Vertex Batch reads f and t as booleans)", () => {
  const keys = []; (function walk(o) { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "properties") keys.push(...Object.keys(v)); walk(v); } })(T.SCHEMAS);
  assert.ok(keys.length && keys.every((k) => k.length >= 2), keys.join());
});

/* ---- scheduling hook ---- */
test("cards write FSRS rows under p:<module>:c; recall over the module sees them, MCQ progress does not", () => {
  const s = P.emptyStore(), today = 20000;
  C.review(s, "p:m1", "q1", 3, today);
  F.grade(s, "m1", "c01", 3, today, C);
  assert.ok(s.cards["p:m1:c:c01"]);
  assert.equal(F.cardKeyModule("p:m1:c:c01"), "m1");
  assert.equal(F.cardKeyModule("p:m1:q1"), null);
  assert.equal(P.progressByModule(s, today).m1.answered, 1, "the card is not an answered question");
  assert.equal(C.recall(s, "p:m1", today).seen, 2, "recall over the module counts the question and the card");
  assert.equal(s.days[today], 2, "a card review counts toward the day and the streak");
});
test("session: due first (least remembered first), then new up to today's cap; the cap counts first reviews only", () => {
  const s = P.emptyStore(), today = 100, cards = Array.from({ length: 30 }, (x, i) => ({ id: "c" + i }));
  F.grade(s, "m", "c5", 3, today - 10, C); F.grade(s, "m", "c6", 1, today - 3, C);
  s.fc = { cap: 20, day: today, n: 0, more: 0 };
  const list = F.session(cards, "m", s, today, C);
  assert.deepEqual(list.slice(0, 2).map((c) => c.id).sort(), ["c5", "c6"]);
  assert.equal(list.length, 2 + 20);
  assert.equal(list[2].id, "c0", "new cards keep the deck's order");
  F.grade(s, "m", "c0", 3, today, C); F.grade(s, "m", "c0", 3, today, C); F.grade(s, "m", "c5", 3, today, C);
  assert.equal(F.newToday(s, today), 1); assert.equal(F.newLeft(s, today), 19);
  s.fc.cap = 10; assert.equal(F.newLeft(s, today), 9);
  s.fc.more = 10; assert.equal(F.newLeft(s, today), 19, "Learn more adds to today only");
  assert.equal(F.newLeft(s, today + 1), 10, "a new day starts from the cap");
  s.fc.cap = 7; assert.equal(F.capOf(s), 20, "an unknown cap falls back to 20");
});
test("interval preview equals what the grade writes; swipe, due counts, next due, labels", () => {
  const s = P.emptyStore(), today = 500;
  F.grade(s, "m", "c1", 3, today - 4, C);
  for (const g of [1, 2, 3, 4]) {
    const copy = JSON.parse(JSON.stringify(s)), d = F.intervalFor(copy, "m", "c1", g, today, C);
    const row = F.grade(copy, "m", "c1", g, today, C);
    assert.equal(row[3] - today, d, "grade " + g);
  }
  assert.equal(F.intervalFor(s, "m", "new", 1, today, C), 1);
  assert.ok(F.intervalFor(s, "m", "c1", 4, today, C) > F.intervalFor(s, "m", "c1", 2, today, C));
  assert.equal(F.swipeGrade(-120, 10, 400), 1); assert.equal(F.swipeGrade(120, 0, 400), 3);
  assert.equal(F.swipeGrade(60, 0, 800), 0, "short and slow"); assert.equal(F.swipeGrade(60, 0, 200), 3, "a flick");
  assert.equal(F.swipeGrade(40, 120, 100), 0, "vertical"); assert.equal(F.swipeGrade(10, 0, 5), 0, "a tap");
  F.grade(s, "m2", "a", 1, today - 1, C);
  assert.equal(F.dueByModule(s, today).m2, 1); assert.equal(F.dueByModule(s, today - 4).m2, undefined);
  assert.ok(F.hasCards(s)); assert.equal(F.hasCards(P.emptyStore()), false);
  assert.deepEqual(F.nextDue(s, ["m2"], today - 1), { day: today, n: 1 });
  assert.equal(F.nextDue(s, ["zz"], today), null);
  assert.deepEqual([1, 12, 45, 400].map(F.fmtIvl), ["1d", "12d", "1.5mo", "1.1y"]);
  assert.equal(F.ivlWords(1), "1 day");
});

/* ---- generator ---- */
function fixtureRoot() {
  const dir = fs.mkdtempSync(join(os.tmpdir(), "prep-cards-"));
  const items = Array.from({ length: 14 }, (x, i) => ({ id: "it" + i, q: "Question " + i + " about breast cancer staging?", o: ["T1", "T2", "T3", "T4"], a: i % 4,
    exp: "Breast tumours over 2 cm and up to 5 cm are T2; tumours over 5 cm are T3. Spread to the chest wall or skin is T4 and inflammatory cancer is T4d. Tamoxifen treats ER positive disease." + (i ? "" : " Extra.") }));
  items.push({ id: "flag", q: "Flagged?", o: ["a", "b", "c", "d"], a: 0, exp: W(40), flags: ["disputed"] });
  fs.mkdirSync(join(dir, "v1/surgery/mcq"), { recursive: true });
  fs.writeFileSync(join(dir, "v1/surgery/mcq/sur-breast-benign.json"), JSON.stringify({ items }));
  return dir;
}
const ctxFor = (bank, out, work, vx) => ({ root: ROOT, modules: moduleIndex(loadTaxonomy(join(ROOT, "prep/taxonomy"))), bank, outDir: out, log: () => {}, vx, work, jobPrefix: "cards",
  state: { v: 1, run: "t", modules: [], stages: {} }, save() {}, pollMs: 1, noWait: false, maxWaitMs: 1 });
test("the dry run makes no call and prices both stages", async () => {
  const bank = fixtureRoot(), lines = [];
  const r = await T.main(["--dry-run", "--module", "sur-breast-benign,sur-breast-cancer", "--bank", bank], { log: (l) => lines.push(l), vertex: { get batch() { throw new Error("called"); } }, fetch: () => { throw new Error("network"); } });
  assert.equal(r.dryRun, true);
  assert.equal(r.modules.length, 1, "a module without a bank file is skipped");
  assert.equal(r.modules[0].usable, 14); assert.equal(r.modules[0].target, 7); assert.equal(r.modules[0].reqs, 2);
  assert.ok(r.total.usd > 0 && r.total.usd < 0.01);
  assert.match(lines.join("\n"), /1 modules have no bank file/);
});
test("pipeline: gates and the self-check drop cards, duplicates go, the deck and index are written, a resume makes no call", async () => {
  const bank = fixtureRoot(), out = fs.mkdtempSync(join(os.tmpdir(), "prep-cards-out-")), work = fs.mkdtempSync(join(os.tmpdir(), "prep-cards-work-"));
  const jobs = new Map(), submitted = [];
  const answer = (name, key, rq) => {
    if (/01-gen/.test(name)) return { cards: [
      { kd: "basic", fr: "What T category is a breast tumour over 5 cm?", bk: "T3.", ref: "i1" },
      { kd: "basic", fr: "What T category is a breast tumour over 5 cm in size?", bk: "T3.", ref: "i2" },
      { kd: "cloze", fr: "Inflammatory breast cancer is staged {{T4d}}.", bk: "It counts as skin involvement.", ref: "i3" },
      { kd: "basic", fr: "Which drug treats ER positive disease?", bk: "Letrozole.", ref: "i4" },
      { kd: "basic", fr: "What size makes a tumour T2?", bk: "Over 2 cm and up to 5 cm.", ref: "i5" },
      { kd: "basic", fr: "Which hormone drug treats ER positive breast cancer?", bk: "Tamoxifen.", ref: "i9" },
    ] };
    const n = (rq.contents[0].parts[0].text.match(/^CARD \d+/gm) || []).length;
    return { res: Array.from({ length: n }, (x, i) => ({ idx: i, unsup: /What size makes/.test(rq.contents[0].parts[0].text.split(/^CARD /m)[i + 1] || ""), why: "x" })) };
  };
  const vx = { cfg: { model: "gemini-3.1-flash-lite" }, log: [], batch: {
    async submit({ name, lines }) { const id = "jobs/" + name; jobs.set(id, { name, lines }); submitted.push(name); return { jobId: id }; },
    async wait(jobId) { return { jobId, state: "JOB_STATE_SUCCEEDED" }; },
    async results(info, lines) { const job = jobs.get(info.jobId); return new Map(lines.map((l) => [l.key, { text: JSON.stringify(answer(job.name, l.key, l.request)), finishReason: "STOP" }])); },
  } };
  const ctx = ctxFor(bank, out, work, vx);
  ctx.state.modules = ["sur-breast-benign"];
  const res = await T.run(ctx, ["sur-breast-benign"]);
  assert.deepEqual(submitted, ["cards/01-gen", "cards/02-check"]);
  const deck = JSON.parse(fs.readFileSync(join(out, "sur-breast-benign.json"), "utf8"));
  assert.deepEqual(F.checkDeck(deck), []);
  const fronts = deck.cards.map((c) => c.fr);
  assert.ok(fronts.includes("Inflammatory breast cancer is staged {{T4d}}."), "cloze kept");
  assert.ok(fronts.includes("Which hormone drug treats ER positive breast cancer?"), "a grounded card from the second request kept");
  assert.ok(!fronts.some((f) => /over 5 cm in size/.test(f)), "the duplicate front dropped");
  assert.ok(!fronts.some((f) => /Which drug treats ER/.test(f)), "letrozole is not in the source: dropped by the drug gate");
  assert.ok(!fronts.some((f) => /What size makes/.test(f)), "dropped by the self-check");
  assert.ok(deck.cards.length <= 7 && deck.cards.every((c) => c.src.item && c.src.item !== "flag"));
  assert.ok(!JSON.stringify(deck).includes("_text"), "work fields stripped");
  assert.equal(JSON.parse(fs.readFileSync(join(out, "index.json"), "utf8")).modules["sur-breast-benign"].n, deck.cards.length);
  assert.equal(res[0].cards, deck.cards.length);
  await T.run(ctx, ["sur-breast-benign"]);
  assert.equal(submitted.length, 2, "a resumed run makes no new request");
  // A hand deck is never overwritten.
  fs.writeFileSync(join(out, "sur-breast-benign.json"), JSON.stringify(SAMPLE));
  const r2 = await T.run(ctx, ["sur-breast-benign"]);
  assert.equal(r2[0].skipped, "hand-written deck kept");
});
test("the committed sample deck passes every gate: 10 cards, 2 cloze, 1 occlusion", async () => {
  assert.deepEqual(F.checkDeck(SAMPLE), []);
  assert.equal(SAMPLE.cards.length, 10);
  assert.equal(SAMPLE.cards.filter((c) => c.kind === "cloze").length, 2);
  assert.equal(SAMPLE.cards.filter((c) => c.kind === "occl").length, 1);
  assert.ok(fs.existsSync(join(ROOT, SAMPLE.cards.find((c) => c.kind === "occl").img)));
  const r = await T.main(["--check", "prep/cards/v1/sur-breast-cancer.json", "--bank", fs.mkdtempSync(join(os.tmpdir(), "nobank-"))], { log: () => {} });
  assert.deepEqual(r.problems, []);
  const ix = JSON.parse(fs.readFileSync(join(ROOT, "prep/cards/v1/index.json"), "utf8"));
  assert.deepEqual(ix.modules["sur-breast-cancer"], { n: 10, gen: "hand" });
});

test("index merge: a generated (bank) deck fills modules with none bundled and replaces a bundled AI one; a hand-written bundled deck always wins", () => {
  const app = { v: 1, modules: { "sur-breast-cancer": { gen: "hand", n: 10 }, "sur-breast-benign": { gen: "AI", n: 4 } } };
  const bank = { v: 1, modules: { "sur-breast-cancer": { gen: "AI", n: 60 }, "sur-breast-benign": { gen: "AI", n: 50 }, "sur-thyroid": { gen: "AI", n: 40 } } };
  const m = F.mergeIx(app, bank).modules;
  assert.deepEqual(m["sur-breast-cancer"], { from: "app", gen: "hand", n: 10 });
  assert.deepEqual(m["sur-breast-benign"], { from: "bank", gen: "AI", n: 50 });
  assert.deepEqual(m["sur-thyroid"], { from: "bank", gen: "AI", n: 40 });
  assert.deepEqual(F.mergeIx(app, null).modules["sur-breast-benign"], { from: "app", gen: "AI", n: 4 }, "offline with no bank index: bundled only");
  assert.deepEqual(F.mergeIx(undefined, undefined), { v: 1, modules: {} });
});
