/* PrepNucleus "Import MCQs" (prep-import.js): questions that already exist become a module with no AI call.
 *  - the JSON template and prompt parse back through parseJson (round trip);
 *  - loose LLM output is tolerated: code fences, text around, a bare array, aliases, 5 options, letters like "Option B";
 *  - bad questions are skipped with a reason, never silently;
 *  - the recall-PDF layout (MCQ n:, Question Stem, Options, Correct Answer, Why Other Options Are Wrong) parses, including
 *    "Options B, C, and D:" grouped reasons, wrapped lines, bullets and zero-width characters, and stops at "Section 3";
 *  - a student's import is a private deck on the phone (no network); the owner's goes to the Author review list.
 * node --test test/prep-import.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(import.meta.url);
const P = req("../prep-import.js");
const DK = req("../prep-decks.js");
const SRC = fs.readFileSync(path.join(ROOT, "prep-import.js"), "utf8");
const sample = fs.readFileSync(path.join(ROOT, "test/fixtures/import-recall-sample.txt"), "utf8").split("\n");

const good = (i, extra) => Object.assign({ q: "Stem number " + i + " asks which is best?", options: ["a" + i, "b" + i, "c" + i, "d" + i], answer: "C", explanation: "Because " + i }, extra || {});

test("the template and prompt round-trip through parseJson", () => {
  const t = P.parseJson(P.template());
  assert.equal(t.items.length, 1);
  assert.equal(t.items[0].a, 1);
  assert.equal(t.items[0].o.length, 4);
  const viaPrompt = P.parseJson("```json\n" + P.template() + "\n```");
  assert.equal(viaPrompt.items.length, 1);
  assert.match(P.prompt(), /Use ONLY the questions that are in the file/);
  assert.match(P.prompt(), /stewardmd-mcq-v1/);
  assert.ok(!/—/.test(P.prompt()), "no em dash in app text");
});

test("loose LLM output is tolerated", () => {
  const reply = "Sure! Here you go:\n```json\n" + JSON.stringify({ title: "Onc", questions: [good(1), good(2, { answer: "Option B" }), good(3, { options: ["A. x3", "B. y3", "C. z3", "D. w3", "E. v3"], answer: "d" })] }) + "\n```\nHope it helps.";
  const r = P.parseJson(reply);
  assert.equal(r.title, "Onc");
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items.map((x) => x.a), [2, 1, 3]);
  assert.deepEqual(r.items[2].o, ["x3", "y3", "z3", "w3"], "option letters stripped, fifth option dropped");
  assert.equal(P.parseJson(JSON.stringify([good(1), good(2)])).items.length, 2, "bare array");
  assert.equal(P.parseJson(JSON.stringify({ questions: [{ question: "Aliased stem question?", choices: { A: "p", B: "q", C: "r", D: "s" }, correct: "A" }] })).items.length, 1, "aliases and object options");
  const two = "```json\n" + JSON.stringify({ questions: [good(1)] }) + "\n```\n```json\n" + JSON.stringify({ questions: [good(2)] }) + "\n```";
  assert.equal(P.parseJson(two).items.length, 2, "several blocks pasted together");
});

test("bad questions are skipped with a reason", () => {
  const r = P.parseJson(JSON.stringify({ questions: [good(1), good(2, { answer: "Z" }), good(3, { options: ["a", "a", "b", "c"] }), good(4, { q: "" }), good(5, { options: ["x", "y"] }), good(1)] }));
  assert.equal(r.items.length, 1);
  assert.equal(r.problems.length, 5);
  assert.match(r.problems.join("|"), /no correct answer/);
  assert.match(r.problems.join("|"), /two options are the same/);
  assert.match(r.problems.join("|"), /needs 4 options/);
  assert.match(r.problems.join("|"), /same as an earlier question/);
  assert.match(P.parseJson("not json at all").problems[0], /not valid JSON/);
  assert.match(P.parseJson("{}").problems[0], /No questions/);
});

test("dashes are normalised and text is cleaned", () => {
  const r = P.parseJson(JSON.stringify({ questions: [good(1, { q: "Stem — with dash and range 11–22?​" })] }));
  assert.equal(r.items[0].q, "Stem - with dash and range 11-22?");
});

test("the recall PDF layout parses", () => {
  assert.ok(P.looksLikePdf(sample));
  assert.ok(!P.looksLikePdf(["Just some prose", "nothing here"]));
  const r = P.parsePdfLines(sample, "Onc");
  assert.equal(r.items.length, 2);
  const a = r.items[0], b = r.items[1];
  assert.equal(a.q, "Trabectedin shows dramatically high efficacy against sarcomas harboring which of the following molecular alterations?");
  assert.deepEqual(a.o, ["NAB2-STAT6 fusion", "SS18-SSX [t(X;18)] translocation", "MDM2 amplification", "EWSR1-FLI1 fusion"]);
  assert.equal(a.a, 1);
  assert.match(a.exp, /^Trabectedin displaces/);
  assert.match(a.r[0], /^Pathognomonic of Solitary Fibrous Tumor \(SFT\), managed with surgery or TKIs\.$/, "wrapped line joined, private-use brackets decoded");
  assert.equal(a.q.indexOf("\ue081"), -1);
  assert.match(a.r[3], /Ewing sarcoma - treated with VDC\/IE/, "em dash normalised");
  assert.equal(a.r[1], a.exp, "the correct option carries the explanation");
  assert.match(a.kp, /^Trabectedin \(ET-743\) is a marine alkaloid\.$/, "private-use ( - ) decoded in the first sentence");
  assert.match(b.q, /WBC \u226510 or < 5 is CD15\+ and cured/, ">= to a real sign, < and + decoded");
  assert.equal(P.decodePua("a\ue081\ue0ffb", { n: 0 }), "a(b", "an unknown private-use glyph is dropped");
  assert.equal(b.a, 0);
  assert.ok(b.r[1] && b.r[1] === b.r[2] && b.r[2] === b.r[3], "Options B, C, and D: shared reason");
  assert.equal(r.notes, undefined, "every private-use glyph in the sample is mapped");
  assert.equal(P.parsePdfLines(["MCQ 1: T", "Question Stem: Stem with \ue0ff odd glyph?", "Options:", "A. aa", "B. bb", "C. cc", "D. dd", "Correct Answer: Option A"], "x").notes.length, 1, "an unknown glyph is reported, not hidden");
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /^MCQ 44:/, "the problem names the document's own number");
});

test("toItems gives the app's stored shape", () => {
  const p = P.parseJson(JSON.stringify({ questions: [good(1, { why_wrong: ["wa", "wb", "", "wd"], difficulty: 3, tags: ["Onc"] })] }));
  const [it] = P.toItems(p, { deckId: "imp_x", sha12: DK.sha12, exam: "neet-pg", title: "T", owner: false });
  assert.match(it.id, /^q_[a-f0-9]{12}$/);
  assert.equal(it.o.length, 4); assert.equal(it.a, 2); assert.equal(it.d, 3);
  assert.equal(it.exp, "Because 1"); assert.equal(it.r.length, 4); assert.equal(it.et.length, 4);
  assert.equal(it.prov, "USR"); assert.equal(it.gen, "hand"); assert.equal(it.qg, undefined);
  const [ow] = P.toItems(p, { deckId: "own", sha12: DK.sha12, exam: "neet-pg", title: "T", owner: true });
  assert.match(ow.id, /^imp_/); assert.equal(ow.prov, "SMD");
});

const run = (G, host) => {
  const sb = { window: G, Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, parseInt, isNaN, Error };
  vm.createContext(sb); vm.runInContext(SRC, sb, { filename: "prep-import.js" });
  return G.PREP_IMPORT;
};
const tick = () => new Promise((r) => setTimeout(r, 30));

test("a student's import is a private deck on the phone, with no network call", async () => {
  const items = [], decks = {}, fetches = [], toasts = [];
  const G = { document: {}, navigator: {}, localStorage: { getItem: () => null, setItem: () => {} }, fetch: async (u) => { fetches.push(u); throw new Error("no network"); },
    PREP_DECKS: { sha12: DK.sha12, newManifest: DK.newManifest, topicsFor: DK.topicsFor, putItems: async (r) => { r.forEach((x) => items.push(JSON.parse(JSON.stringify(x)))); }, putDeck: async (m) => { decks[m.id] = JSON.parse(JSON.stringify(m)); }, changed: () => {} } };
  let last = null;
  const root = { querySelector: (s) => (s === "#imView" ? { addEventListener() {} } : s === "#imText" ? { addEventListener() {}, value: JSON.stringify({ title: "My Onc", questions: [good(1), good(2), good(3)] }) } : null) };
  const host = { push: (fn) => { last = fn; fn(); }, back: () => {}, rerender: () => { if (last) last(); }, root: () => root, paint: () => {}, bar: () => "", esc: (s) => String(s), exam: () => ({ id: "neet-pg" }), toast: (t) => toasts.push(t), ico: () => "" };
  const I = run(G, host);
  I.act("g-imp", null, host);
  I.act("g-imp-read", null, host);
  assert.equal(I._state().parsed.items.length, 3);
  I.act("g-imp-make", null, host);
  await tick();
  assert.equal(items.length, 3);
  const m = Object.values(decks)[0];
  assert.equal(m.title, "My Onc"); assert.equal(m.source.type, "import"); assert.equal(m.stats.accepted, 3);
  assert.equal(m.topics[0].count, 3);
  assert.ok(items.every((it) => it.deckId === m.id && it._s === "deck" && it._m === "deck-" + m.id));
  assert.equal(fetches.length, 0);
  assert.ok(I._state().done && I._state().done.n === 3);
});

test("the owner's import goes to the Author review list, undecided", async () => {
  const au = { exam: "neet-pg", list: [] }, toasts = [];
  let saved = 0, backs = 0;
  const G = { document: {}, navigator: {}, localStorage: { getItem: () => null, setItem: () => {} },
    PREP_DECKS: { sha12: DK.sha12 }, PREP_QGEN: { _au: () => au, saveAuthor: () => { saved++; } } };
  let last = null;
  const root = { querySelector: (s) => (s === "#imView" ? { addEventListener() {} } : s === "#imText" ? { addEventListener() {}, value: JSON.stringify({ questions: [good(1), good(2)] }) } : null) };
  const host = { push: (fn) => { last = fn; fn(); }, back: () => { backs++; }, rerender: () => { if (last) last(); }, root: () => root, paint: () => {}, bar: () => "", esc: (s) => String(s), exam: () => ({ id: "neet-pg" }), toast: (t) => toasts.push(t), ico: () => "" };
  const I = run(G, host);
  I.act("g-imp-owner", null, host); I.act("g-imp-read", null, host); I.act("g-imp-add", null, host);
  assert.equal(au.list.length, 2);
  assert.ok(au.list.every((r) => r.st === "" && /^imp_/.test(r.it.id) && r.it.prov === "SMD" && !r.it.qg));
  assert.equal(saved, 1); assert.equal(backs, 1);
});

test("the custom prompt carries exam, subject, topic, count and difficulty, and its template parses back", () => {
  const t = P.promptFor({ exam: "neet-ss", subject: "Medical Oncology", topic: "Soft tissue sarcoma", n: 20, diff: "hard" });
  assert.match(t, /TASK: Write 20 NEET-SS multiple choice questions on "Soft tissue sarcoma" \(subject: Medical Oncology\)/);
  assert.match(t, /All hard/);
  assert.match(t, /downloadable \.json file/);
  assert.match(t, /Do not ask me any question/);
  assert.match(t, /ONE code block holding ONE JSON object/);
  assert.match(t, /exactly 30 questions|exactly 20 questions/);
  assert.match(t, /why_wrong: exactly 4 strings in option order/);
  assert.ok(!/—/.test(t), "no em dash in the prompt");
  const tpl = t.slice(t.indexOf("\n{\n") + 1, t.indexOf("\n}\n\nBEFORE") + 2);
  const r = P.parseJson(tpl);
  assert.equal(r.items.length, 1);
  assert.deepEqual(r.meta, { exam: "NEET-SS", subject: "Medical Oncology", topic: "Soft tissue sarcoma" });
  assert.equal(r.title, "Soft tissue sarcoma");
  assert.match(P.promptFor({ exam: "bogus", n: 999, topic: "X" }), /Write 40 NEET-PG multiple choice/, "unknown exam falls back, count is capped at 40");
  assert.match(P.promptFor({ exam: "usmle-step1", topic: "Anemia", n: 10, diff: "mix" }), /basic science mechanism/);
});

test("a .txt reply file with the JSON inside is read", () => {
  const body = "Here is your module:\n\n" + JSON.stringify({ title: "From a file", questions: [good(1), good(2)] }) + "\n";
  const r = P.parseJson(body);
  assert.equal(r.items.length, 2);
  assert.equal(r.title, "From a file");
});
