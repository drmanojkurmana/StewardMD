// tools/prep-pyq.mjs and prep-pyq.js (pure part). Fixtures in test/fixtures/prep-pyq/ are SYNTHETIC: made-up questions
// in the three source layouts (blog recall page, topic-wise compilation with a shredded watermark, "Ques/Ans" paper with
// site headers and a shredded watermark), never real exam questions (the repo is public).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  FORMATS, parsePaper, stripWatermark, normLine, matchOption, optKey, xmlEvents, attachImages, mergePyq, sameQuestion,
  bankIndex, bankMatch, toItems, indexFor, checkPaper, stageLines, stageItems, explainPrompt, readExplain, explainGate, stages, subjectOf,
} from "../tools/prep-pyq.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = path.join(HERE, "fixtures", "prep-pyq");
const TAX = path.join(HERE, "..", "prep", "taxonomy");
const read = (f) => fs.readFileSync(path.join(FX, f), "utf8");
const require = createRequire(import.meta.url);
const PY = require("../prep-pyq.js");

test("watermark: fragments of the mark go, content and real short words stay, a fragment-only line is deleted", () => {
  const m = "www.SampleMark.test";
  assert.equal(stripWatermark("A. Urine sample                      st", m), "A. Urine sample");
  assert.equal(stripWatermark("Ans. B                  eM", m), "Ans. B");
  assert.equal(stripWatermark("b. Large one .S", m), "b. Large one");
  assert.equal(stripWatermark("                  ww.S", m), null);
  assert.equal(stripWatermark("", m), "");
  assert.equal(stripWatermark("A. Adeno Ca", m), "A. Adeno Ca", "a single-space short word is content");
  assert.equal(stripWatermark("www.SampleMark.test      www.SampleMark.test", m), null);
  assert.equal(stripWatermark("Sa", "SampleMark"), null);
  assert.equal(stripWatermark("    le                                      ", "SampleMark"), null);
  assert.equal(normLine("с. Adeno​ one "), "c. Adeno one", "Cyrillic look-alike, zero-width and nbsp normalised");
});

test("blog format: subject headers (wrapped too), page headers and footers, captions, arrows, numbered options, stop line", () => {
  const r = parsePaper(read("blog.txt"), "blog");
  assert.deepEqual(r.items.map((x) => x.n), [1, 2, 3, 5]);
  assert.deepEqual(r.fails, [{ n: 4, why: "no answer line" }]);
  const [q1, q2, q3, q5] = r.items;
  assert.equal(q1.subject, "anatomy");
  assert.match(q1.q, /marked structure\?$/, "the image caption after the stem is dropped");
  assert.equal(r.dropped.captions, 1);
  assert.deepEqual(q1.o, ["Alpha nerve", "Beta nerve", "Gamma nerve", "Delta nerve"]);
  assert.equal(q1.a, 2);
  assert.equal(q2.q, "Which invented vessel crosses the made-up ligament at the level of the sample bone?", "the footer between two stem lines is gone");
  assert.equal(q2.a, 1);
  assert.equal(q3.subject, "obstetrics-gynaecology", "a header split over two lines still sets the subject");
  assert.ok(!/^Q\./.test(q3.q), "a doubled 'Q.' prefix is removed");
  assert.equal(q3.o.length, 4, "arrow options stay distinct");
  assert.equal(q5.a, 3, "numbered options with a letter key");
  assert.ok(!r.items.some((x) => x.n === 6), "nothing after the stop line");
  for (const it of r.items) assert.ok(![it.q, ...it.o].some((s) => /https?:|Page \d|example\.test/.test(s)), "no URL or page footer in an item");
});

test("topic format: watermark shreds, Topic lines, bare subject headers, answer text matched to an option", () => {
  const F = { ...FORMATS.topic, mark: "SampleMark", stop: /^\s*If you wish to access/i };
  const r = parsePaper(read("topic.txt"), F);
  assert.equal(r.items.length, 4);
  const [q1, q2, q3, q4] = r.items;
  assert.equal(q1.subject, "anaesthesia");
  assert.equal(q1.topic, "Made-up Topic One");
  assert.deepEqual(q1.o, ["The gel holds fixture oil", "The gel can cause sample-itis", "The gel holds 7% invented agent", "The gel acts within 9 minutes"]);
  assert.equal(q1.a, 1);
  assert.deepEqual(q1.flags, []);
  assert.equal(q2.a, 0, "'(Incorrect Statement)' after the answer text is ignored");
  assert.equal(q3.subject, "forensic-medicine");
  assert.equal(q3.a, 0, "'7 units' matches '-7 units'");
  assert.deepEqual(q4.flags, ["key-unclear"], "an answer that names no option is flagged");
  for (const it of r.items) assert.ok(![it.q, ...it.o].some((s) => /\b(Sa|mp|le|eM)\b|SampleMark/.test(s)), "no watermark left: " + it.q);
});

test("ques format: site headers, appended shreds, no-space 'Ques 3.', lower-case and Cyrillic option letters, honest failures", () => {
  const F = { ...FORMATS.ques, mark: "www.SampleMark.test", noise: [/samplemark/i, /https?:\/\/|www\./i, /Question Paper\s*(?:Shift\s*\w+)?\s*$/i] };
  const r = parsePaper(read("ques.txt"), F);
  assert.deepEqual(r.items.map((x) => x.n), [1, 2, 3]);
  assert.deepEqual(r.items[1].o, ["Urine sample", "Tissue sample", "Serum sample", "MRI sample"]);
  assert.equal(r.items[1].a, 1);
  assert.equal(r.items[0].q, "Fixture adult with sample finding. What is the role of made-up marker X?");
  assert.deepEqual(r.items[2].o, ["Small one", "Large one", "Adeno one", "Tiny one"]);
  assert.equal(r.items[2].a, 2, "the Cyrillic 'с.' option and the lower-case 'Ans. c' key");
  assert.deepEqual(r.fails, [{ n: 4, why: "only 3 options in the source" }, { n: 5, why: "no answer letter in the source" }]);
});

test("option matching and option identity", () => {
  const o = ["Fixo scope", "Mockoscope", "Samplescope", "Testoscope"];
  assert.deepEqual(matchOption("Fixo-scope", o), { a: 0, clean: true });
  assert.deepEqual(matchOption("mockoscope", o), { a: 1, clean: true });
  assert.deepEqual(matchOption("Rigid testoscope", o), { a: 3, clean: true }, "one option contained in the answer");
  assert.equal(matchOption("Something else entirely", o).clean, false);
  assert.notEqual(optKey("+3 units"), optKey("-3 units"));
  assert.notEqual(optKey("↑X, ↓Y"), optKey("↓X, ↑Y"));
  assert.equal(optKey("Red & blue"), optKey("Red and blue"));
  assert.equal(subjectOf("Gynaecology & Obstetrics"), "obstetrics-gynaecology");
  assert.equal(subjectOf("Neurology"), "medicine");
  assert.equal(subjectOf("Crack"), null);
});

test("images: an image belongs to the open question (stem to answer); logos and gaps after an answer are skipped; pages carry over", () => {
  const ev = xmlEvents(read("p.xml"));
  assert.equal(ev.find((e) => e.kind === "image").src, "p-1_1.png", "absolute src paths are cut to the file name");
  const logos = new Set(["p-1_1.png", "p-2_1.png"]);
  const m = attachImages(ev, "ques", (src) => logos.has(src));
  assert.deepEqual([...m.entries()], [[2, ["p-1_2.png"]], [3, ["p-2_2.png"]]]);
  // p-1_3 sits after Ques 2's answer and before Ques 3: nobody's. p-2_3 sits after Ques 3's answer: nobody's.
});

const item = (id, q, o, a, extra = {}) => ({ id, q, o, a, flags: [], pyq: [{ exam: "neet-pg", year: 2099, kind: "recall", src: id.split("#")[0], n: 1 }], ...extra });

test("dedupe across papers: a repeat merges with both sources; reworded stems need the same key and options; keys that disagree flag", () => {
  const a = item("p1#1", "In a made-up registry case a fixture person claims a different age. Which fixture scan is advised?", ["Red and blue", "Green and gold", "Grey and pink", "Green and teal"], 2);
  const b = item("p2#1", "A fixture person in a made-up registry case claims a different age. Which fixture scan should be done?", ["Green and gold", "Grey and pink", "Blue & red", "Teal and grey"], 1);
  const c = item("p2#2", "Signal is absent in which fixture node?", ["Node one", "Node two", "Node three", "Node four"], 0);
  const d = item("p3#1", "In the made-up syndrome, which fixture nodes are lost?", ["Node one", "Node two", "Node three", "Node four"], 0);
  const e = item("p3#2", "Signal is absent in which fixture node?", ["Node one", "Node two", "Node three", "Node four"], 1);
  const r = mergePyq([a, b, c, d, e]);
  assert.equal(r.merged, 2);
  assert.equal(r.items.length, 3);
  assert.deepEqual(r.items[0].pyq.map((x) => x.src), ["p1", "p2"], "the reworded repeat merged into the first");
  assert.deepEqual(r.items[1].pyq.map((x) => x.src), ["p2", "p3"], "the exact repeat merged");
  assert.deepEqual(r.items[1].flags, ["dup-key"], "the two papers disagree on the key");
  assert.ok(r.items.some((x) => x.id === "p3#1"), "same key and options but a different question stays separate");
  assert.ok(sameQuestion(c, e) === 1);
});

test("dedupe against the bank: a match becomes a tag (no copy) and records the bank module; near items give grounding", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pyq-bank-"));
  fs.mkdirSync(path.join(dir, "anatomy", "mcq"), { recursive: true });
  fs.writeFileSync(path.join(dir, "anatomy", "mcq", "ana-fix.json"), JSON.stringify({ items: [
    { id: "b1", q: "What are the strands in the fixture rope?", o: ["2 red, 1 blue", "1 red, 2 blue", "2 red, 2 blue", "1 red, 1 blue"], a: 0, exp: "Fixture explanation about the rope strands." },
    { id: "b2", q: "Which fixture motor tightens the made-up belt?", o: ["Alpha", "Beta", "Gamma", "Delta"], a: 0, exp: "Fixture muscle note." },
  ] }));
  const bank = bankIndex(dir);
  assert.equal(bank.items.length, 2);
  const hit = bankMatch(item("x#1", "What are the contents of the fixture rope?", ["2 red, 2 blue", "1 red, 2 blue", "2 red, 1 blue", "1 red, 1 blue"], 2), bank);
  assert.equal(hit.hit && hit.hit.id, "b1");
  assert.equal(hit.hit.m, "ana-fix");
  const miss = bankMatch(item("x#2", "A fixture robot cannot lift its arm; which motor is weak?", ["Alpha", "Beta", "Gamma", "Delta"], 0), bank);
  assert.equal(miss.hit, null, "same options and key, different question: no tag");
  const ix = indexFor([{ id: "pyq-a-1", t: "ana-fix", pyq: [{ src: "a" }] }, { id: "pyq-a-2", t: "ana-fix", bank: "b1", pyq: [{ src: "a" }] }], [{ id: "a", exam: "neet-pg", year: 2099, kind: "recall" }], { b1: ["ana-fix", [["neet-pg", 2099, "recall"]]] }, "items-00000000.json");
  assert.deepEqual(ix.mods, { "ana-fix": 1 }, "a bank match is not counted twice in its module");
  assert.equal(ix.papers[0].n, 2);
  assert.ok(!JSON.stringify(ix).includes("contents"), "the index carries no question text");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("items: ids, recall kind, image-missing and brand flags; paper config checks", () => {
  const paper = { id: "fx-2099-r1", exam: "neet-pg", year: 2099, session: "shift-1", kind: "recall", format: "blog" };
  const parsed = { items: [
    { n: 1, subject: "anatomy", q: "Identify the structure shown in the image.", o: ["a1", "b1", "c1", "d1"], a: 0, flags: [] },
    { n: 2, subject: null, q: "Plain question two?", o: ["a2", "b2", "c2", "d2"], a: 1, flags: [] },
    { n: 3, subject: null, q: "Visit www.example.com for more?", o: ["a3", "b3", "c3", "d3"], a: 1, flags: [] },
  ] };
  const its = toItems(paper, parsed, new Map([[2, ["fx-2099-r1-2-1.webp"]]]));
  assert.equal(its[0].id, "pyq-fx-2099-r1-1");
  assert.equal(its[0].kind, "recall");
  assert.deepEqual(its[0].flags, ["img-missing"]);
  assert.deepEqual(its[1].img, ["fx-2099-r1-2-1.webp"]);
  assert.deepEqual(its[1].pyq, [{ exam: "neet-pg", year: 2099, session: "shift-1", kind: "recall", src: "fx-2099-r1", n: 2 }]);
  assert.ok(its[2].flags.includes("brand"));
  assert.throws(() => checkPaper({ ...paper, kind: "memory" }), /recall or official/);
  assert.throws(() => checkPaper({ ...paper, id: "Some Publisher 2024" }), /neutral slug/);
});

test("paid stages: requests never carry the key to the solver, explanation gates, and --dry-run makes no call", async () => {
  const tax = (await import("../tools/prep-build-bank.mjs")).loadTaxonomy();
  const its = [
    { id: "p-1", q: "Which fixture drug is first line for the made-up fever?", o: ["Alphacillin", "Betamycin", "Gammazole", "Deltavir"], a: 2, subject: "pharmacology" },
    { id: "p-2", q: "Unsorted fixture question?", o: ["W", "X", "Y", "Z"], a: 0, subject: null },
    { id: "p-3", q: "Image fixture question?", o: ["W", "X", "Y", "Z"], a: 0, subject: "anatomy", img: ["x.webp"] },
    { id: "p-4", q: "Unclear fixture question?", o: ["W", "X", "Y", "Z"], a: 0, subject: "anatomy", flags: ["key-unclear"] },
  ];
  const near = { "p-1": { id: "b9", j: 0.5, exp: "Gammazole is the fixture first-line drug for the made-up fever at 10 mg." } };
  assert.deepEqual(stageItems("subject", its).map((x) => x.id), ["p-2"]);
  assert.deepEqual(stageItems("screen", its).map((x) => x.id), ["p-1", "p-2"], "image and unclear-key items are not blind-solved");
  assert.deepEqual(stageItems("explain", its).map((x) => x.id), ["p-1", "p-2", "p-3"]);
  const sl = stageLines("screen", stageItems("screen", its), { tax, near });
  assert.ok(!/Key:/.test(JSON.stringify(sl)), "the blind solve never sees the key");
  const ml = stageLines("map", its.filter((x) => x.subject === "pharmacology"), { tax, near });
  assert.equal(ml.length, 1);
  assert.match(ml[0].key, /^pharmacology:/);
  const ep = explainPrompt([{ ...its[0], ground: near["p-1"].exp }]);
  assert.match(ep.user, /Key: C/);
  assert.ok(!/"f"|"t"/.test(JSON.stringify(ep.schema)), "no one-letter schema keys (Vertex Batch reads them as booleans)");
  const ex = readExplain(JSON.stringify({ ex: [{ i: 0, ra: "Alphacillin does not treat this fever.", rb: "Betamycin is for another fixture.", rc: "Gammazole is first line here.", rd: "Deltavir is antiviral.", kp: "Gammazole first." }] }), 1)[0];
  assert.equal(explainGate(its[0], ex, near["p-1"].exp), null);
  assert.equal(explainGate(its[0], { ...ex, kp: "Use 20 mg." }, near["p-1"].exp), "g9b", "a number not in the notes or question fails");
  assert.equal(explainGate(its[0], { ...ex, r: [ex.r[0], ex.r[1], "Gammazole is the fixture first-line drug for the made-up fever at 10 mg today", ex.r[3]] }, near["p-1"].exp), "verbatim");
  assert.equal(explainGate(its[0], { ...ex, r: [ex.r[0], ex.r[1], "Gammazole \u2014 first line.", ex.r[3]] }, near["p-1"].exp), "dash");
  assert.equal(explainGate(its[0], null, ""), "g1");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyq-stage-"));
  fs.mkdirSync(path.join(root, "prep", "pyq", "out"), { recursive: true });
  fs.writeFileSync(path.join(root, "prep", "pyq", "out", "index.json"), JSON.stringify({ file: "items-00000000.json" }));
  fs.writeFileSync(path.join(root, "prep", "pyq", "out", "items-00000000.json"), JSON.stringify({ items: its }));
  const logs = [];
  const r = await stages({ flags: new Set(["all", "dry-run"]), tax: path.join(HERE, "..", "prep", "taxonomy") }, { root, log: (s) => logs.push(s), vertex: { batch: { submit: () => { throw new Error("no call allowed"); } } } });
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.rows.map((x) => x.stage), ["subject", "map", "screen", "explain", "review"]);
  assert.ok(r.usd > 0 && r.usd < 0.01);
  fs.rmSync(root, { recursive: true, force: true });
});

test("app pure: recall labels, paper titles, the NEET-PG pattern, paper order, module counts", () => {
  assert.deepEqual(PY.tagLabel([["neet-pg", 2024, "recall"], ["neet-pg", 2025, "recall"], ["neet-pg", 2025, "recall"]]), ["Asked in NEET-PG 2025, 2024 (recall)"]);
  assert.deepEqual(PY.tagLabel([{ exam: "neet-pg", year: 2023, kind: "official" }]), ["Asked in NEET-PG 2023"]);
  assert.equal(PY.paperTitle({ exam: "neet-pg", year: 2024, session: "shift-2" }), "NEET-PG 2024 · Shift 2");
  assert.deepEqual(PY.paperScheme({ n: 200, min: 210, plus: 4, minus: 1, label: "NEET-PG pattern" }, 40), { limit: 2520, plus: 4, minus: 1, label: "NEET-PG pattern" });
  const its = [{ id: "a", pyq: [{ src: "p", n: 3 }] }, { id: "b", pyq: [{ src: "p", n: 1 }, { src: "q", n: 9 }] }, { id: "c", pyq: [{ src: "q", n: 2 }] }];
  assert.deepEqual(PY.paperItems(its, "p").map((x) => x.id), ["b", "a"]);
  assert.deepEqual(PY.paperItems(its, "q").map((x) => x.id), ["c", "b"]);
  assert.equal(PY.moduleCount({ mods: { m1: 2 }, tags: { x: ["m1", []], y: ["m2", []] } }, "m1"), 3);
  assert.equal(PY.usable({ id: "a", flags: ["key-unclear"] }), false);
  assert.equal(PY.usable({ id: "a", flags: ["exp-pending"] }), true, "a pending explanation does not hide the question");
  assert.equal(PY.usable({ id: "a", flags: ["exp-pending", "disputed"] }), false);
  assert.equal(PY.usable({ id: "a" }, { a: 1 }), false);
});

test("explain retry: rejected items get one more try with the reason fed back; still failing -> exp-pending; resumable", async () => {
  const { stageLines: SL, build } = await import("../tools/prep-pyq.mjs");
  const tax = (await import("../tools/prep-build-bank.mjs")).loadTaxonomy();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pyq-redo-"));
  const out = path.join(root, "prep", "pyq", "out"), work = path.join(root, "prep", "pyq", "work");
  fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  const mk = (id, extra = {}) => ({ id, q: `Fixture question ${id}: which made-up agent fits?`, o: ["Agent one", "Agent two", "Agent three", "Agent four"], a: 1, subject: "pharmacology", ...extra });
  const its = [mk("p1"), mk("p2"), mk("p3"), mk("p4", { flags: ["disputed"] }), mk("p5", { flags: ["key-unclear"] })];
  const near = Object.fromEntries(its.map((x) => [x.id, { id: "b-" + x.id, j: 0.6, exp: "Agent two is the fixture choice for this made-up case." }]));
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({ file: "items-00000000.json" }));
  fs.writeFileSync(path.join(out, "items-00000000.json"), JSON.stringify({ items: its }));
  fs.writeFileSync(path.join(work, "near.json"), JSON.stringify(near));
  const good = (i, extra = "") => ({ i, ra: "Agent one does not fit this case.", rb: "Agent two is the fixture choice here." + extra, rc: "Agent three is for another made-up case.", rd: "Agent four is unrelated.", kp: "Agent two fits." });
  // first pass (as saved by --explain): p1 used an ungrounded number, p2 p3 p4 passed the code gates
  const el = SL("explain", its.slice(0, 4), { tax, near });
  fs.writeFileSync(path.join(work, "explain.jsonl"), el.map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.writeFileSync(path.join(work, "explain.out.json"), JSON.stringify({ [el[0].key]: JSON.stringify({ ex: [good(0, " Give 40 mg."), good(1), good(2), good(3)] }) }));
  const T = { g4: true, g6: true, g7: true, g8: true, g9: true, g10: true, g11: true, old: false, why: "" };
  const rv = [{ key: "r0", ids: ["p2", "p3", "p4"] }];
  fs.writeFileSync(path.join(work, "review.jsonl"), rv.map((l) => JSON.stringify(l)).join("\n") + "\n");
  fs.writeFileSync(path.join(work, "review.out.json"), JSON.stringify({ r0: JSON.stringify({ g: [{ i: 0, ...T, g8: false, why: "reason B describes option C" }, { i: 1, ...T }, { i: 2, ...T, g10: false }] }) }));
  fs.writeFileSync(path.join(work, "results.json"), JSON.stringify({ p3: { r: ["a", "b", "c", "d"], kp: "k", rv: { pass: true } }, p4: { v: "disputed" } }));
  fs.writeFileSync(path.join(work, "state.json"), JSON.stringify({ v: 1, run: "t", stages: { explain: { status: "done" }, review: { status: "done" } } }));

  const sent = [], log = [];
  const vertex = {
    cfg: { model: "gemini-3.1-flash-lite" }, log,
    batch: {
      submit: async ({ name, lines }) => { sent.push({ name, lines }); return { jobId: "job-" + name }; },
      wait: async (jobId) => ({ state: "JOB_STATE_SUCCEEDED", jobId }),
      results: async (info, lines) => {
        const m = new Map();
        for (const l of lines) {
          if (/explain-redo/.test(info.jobId)) m.set(l.key, { text: JSON.stringify({ ex: l.ids.map((id, i) => good(i)) }) });
          else m.set(l.key, { text: JSON.stringify({ g: l.ids.map((id, i) => (id === "p2" ? { i, ...T, g8: false, why: "still mismatched" } : { i, ...T })) }) });
          log.push({ promptTokenCount: 100, candidatesTokenCount: 50 });
        }
        return m;
      },
    },
  };
  const dry = await stages({ flags: new Set(["explain-redo", "dry-run"]), tax: TAX }, { root, log: () => {} });
  assert.deepEqual(dry.rows.map((r) => [r.stage, r.items]), [["explain-redo", 2], ["review-redo", 2]], "p1 (g9b) and p2 (review) retry; accepted p3, disputed p4, key-unclear p5 do not");
  const rep = await stages({ flags: new Set(["explain-redo"]), "poll-sec": "0", tax: TAX }, { root, log: () => {}, vertex });
  assert.deepEqual(sent.map((s) => s.name), ["pyq/explain-redo", "pyq/review-redo"]);
  const req = JSON.stringify(sent[0].lines);
  assert.match(req, /Rejected before because: it used numbers that are not in the notes or the question: 40/);
  assert.match(req, /Rejected before because: a reviewer rejected it: a reason did not match the option it describes \(reason B describes option C\)/);
  assert.match(req, /Write no number, dose, percentage/);
  assert.ok(!/p4|p5/.test(JSON.stringify(sent.map((s) => s.lines.map((l) => l.ids)))), "disputed and key-unclear items are never sent");
  assert.deepEqual(rep.explainRedo, { sent: 2, accepted: 1, pending: 1, rejected: { review: 1 } });
  const res = JSON.parse(fs.readFileSync(path.join(work, "results.json"), "utf8"));
  assert.equal(res.p1.rv.redo, true);
  assert.equal(res.p1.r[1], "Agent two is the fixture choice here.");
  assert.equal(res.p2.pending, true);
  assert.ok(!res.p2.r);
  await stages({ flags: new Set(["explain-redo"]), "poll-sec": "0", tax: TAX }, { root, log: () => {}, vertex });
  assert.equal(sent.length, 2, "a re-run reads the saved replies and never resubmits");

  // the build turns pending into the exp-pending flag (not hiding) and applies the accepted retry
  const cfgRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pyq-build-"));
  fs.mkdirSync(path.join(cfgRoot, "prep", "pyq", "work"), { recursive: true });
  fs.writeFileSync(path.join(cfgRoot, "prep", "pyq", "work", "results.json"), JSON.stringify({ "pyq-fx-2099-r1-1": { pending: true }, "pyq-fx-2099-r1-2": { r: ["w", "x", "y", "z"], kp: "pearl", rv: { pass: true, redo: true } } }));
  const conf = { papers: [{ id: "fx-2099-r1", format: "blog", exam: "neet-pg", year: 2099, session: null, kind: "recall", txt: path.join(FX, "blog.txt") }] };
  const b = await build({ flags: new Set(["no-images"]) }, { root: cfgRoot, conf, bank: { items: [], post: new Map() }, log: () => {} });
  const by = Object.fromEntries(b.items.map((x) => [x.id, x]));
  assert.ok(by["pyq-fx-2099-r1-1"].flags.includes("exp-pending"));
  assert.equal(by["pyq-fx-2099-r1-2"].exp, "x");
  assert.equal(by["pyq-fx-2099-r1-2"].rv.redo, true);
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(cfgRoot, { recursive: true, force: true });
});

test("compilation layouts: num (explanation lists are not questions, ordinal numbers), aipg17 answer variants, qno blocks", () => {
  const n = parsePaper(read("num.txt"), "num");
  assert.deepEqual(n.items.map((x) => [x.n, x.a, x.o[0]]), [[1, 0, "Alpha bone"], [2, 2, "Level one"]], "printed numbers restart; ids follow the answer count");
  assert.deepEqual(n.fails, [{ n: 3, why: "only 3 options in the source" }], "an explanation list is dropped, not reported");
  assert.ok(!n.items.some((x) => /explanation|dropped/.test(x.q + x.o.join(" "))), "no publisher explanation in an item");
  const a = parsePaper(read("aipg17.txt"), "aipg17");
  assert.deepEqual(a.items.map((x) => [x.n, x.a]), [[1, 1], [2, 2], [3, 0]], "'Answer - B. text', 'Ans. C.text', 'Answer: Option A - text'");
  const q = parsePaper(read("qno.txt"), { ...FORMATS.qno, mark: "SampleMark" });
  assert.deepEqual(q.items.map((x) => [x.n, x.subject, x.topic || null, x.a]), [[1, "anatomy", "Fixture Topic", 2], [2, "pharmacology", null, 3]]);
  assert.deepEqual(q.items[0].o, ["Upper gyrus", "Lower gyrus", "Middle gyrus", "Back gyrus"], "O4 with its text after blank lines; shreds gone");
  assert.equal(q.items[0].q, "Which made-up gyrus holds the fixture area?");
});

test("images in an ordinal layout wait for an option line and go to the next answer's question", () => {
  const ev = [
    { kind: "text", text: "1. Which made-up bone?" }, { kind: "image", src: "q1.png" }, { kind: "text", text: "a) Alpha" }, { kind: "text", text: "Correct Answer - A" },
    { kind: "text", text: "1. First listed thing" }, { kind: "image", src: "explain.png" },
    { kind: "text", text: "1. Which invented level?" }, { kind: "text", text: "a) Level one" }, { kind: "image", src: "q2.png" }, { kind: "text", text: "Correct Answer - C" },
  ];
  assert.deepEqual([...attachImages(ev, "num").entries()], [[1, ["q1.png"]], [2, ["q2.png"]]]);
});
