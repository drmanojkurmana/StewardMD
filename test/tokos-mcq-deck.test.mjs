// Tokós question bank: the shipped deck (tokos/decks/mcq.json) and the pure helpers of tools/tokos-build-mcq.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { difficulty, cleanText, cleanExplanation, expFlags, buildRepair, tableTopic, keywordTopic, SUBTOPICS, FLAG_LEGEND } from "../tools/tokos-build-mcq.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "tokos", "decks", "mcq");
const index = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8"));
const files = Object.fromEntries(index.topics.map((t) => [t.id, JSON.parse(readFileSync(path.join(DIR, path.basename(t.file)), "utf8"))]));
const RAW = readdirSync(DIR).map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");
// the whole bank as one object, for the item-level checks below
const deck = { ...index, items: index.topics.flatMap((t) => files[t.id].items) };
const CONTRACT = ["ob-antenatal", "ob-labour", "ob-medical", "ob-haemorrhage", "ob-hypertension", "ob-fetal", "ob-puerperium", "ob-early", "ob-operative",
  "gy-menstrual", "gy-infection", "gy-benign", "gy-oncology", "gy-fertility", "gy-contraception", "gy-urogyn", "gy-anatomy"];
const DEVANAGARI = /[ऀ-ॿ]/;

test("deck header records source, licence text and commit", () => {
  assert.equal(deck.id, "mcq");
  assert.equal(deck.v, 1);
  assert.equal(deck.source, "medmcqa");
  assert.equal(deck.licence, "MIT");
  assert.match(deck.licenceText, /^MIT License/);
  assert.match(deck.licenceText, /Permission is hereby granted, free of charge/);
  assert.match(deck.licenceText, /Copyright \(c\) 2022 MedMCQA/);
  assert.match(deck.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(deck.sourceRepo, /github\.com\/medmcqa\/medmcqa/);
  assert.match(deck.citation, /MedMCQA/);
  assert.ok(deck.modifications.length > 20);
  assert.equal(deck.subject, "Gynaecology & Obstetrics");
});

test("split deck: single-file deck gone, index and topic files agree, total 9196", () => {
  assert.ok(!existsSync(path.join(DIR, "..", "mcq.json")), "old single-file deck must be removed");
  assert.deepEqual(readdirSync(DIR).sort(), ["index.json", ...CONTRACT.map((id) => id + ".json")].sort());
  assert.equal(index.counts.total, 9196);
  assert.equal(deck.items.length, 9196);
  assert.deepEqual(index.counts, { total: 9196, d1: deck.items.filter((i) => i.d === 1).length, d2: deck.items.filter((i) => i.d === 2).length, d3: deck.items.filter((i) => i.d === 3).length });
  assert.equal(index.counts.d1 + index.counts.d2 + index.counts.d3, index.counts.total);
  let sum = 0;
  for (const t of index.topics) {
    assert.equal(t.file, `mcq/${t.id}.json`);
    const f = files[t.id];
    assert.deepEqual(Object.keys(f).sort(), ["items", "topic"]);
    assert.equal(f.topic, t.id);
    assert.equal(f.items.length, t.count, t.id);
    assert.ok(f.items.every((i) => i.t === t.id), "every item of " + t.id + " has t == topic");
    sum += t.count;
  }
  assert.equal(sum, index.counts.total);
  assert.ok(Math.max(...readdirSync(DIR).map((f) => readFileSync(path.join(DIR, f)).length)) < 1_000_000, "each file under 1 MB");
  assert.equal(index.items, undefined, "index carries no items");
});

test("topics are exactly the 17 contract subtopics with English and Hindi titles", () => {
  assert.deepEqual(index.topics.map((t) => t.id), CONTRACT);
  assert.deepEqual(SUBTOPICS.map((t) => t.id), CONTRACT);
  for (const t of index.topics) {
    assert.ok(t.title.en && t.title.hi, t.id);
    assert.match(t.title.hi, DEVANAGARI, t.id);
    assert.ok(t.group === "obstetrics" || t.group === "gynaecology", t.id);
    assert.equal(t.group, t.id.startsWith("ob-") ? "obstetrics" : "gynaecology");
    for (const s of [t.title.en, t.title.hi]) assert.ok(!/[\u2013\u2014]/.test(s), "no dash in title " + t.id);
  }
});

test("items: shape, unique ids, valid topic, key in range, difficulty 1..3, four distinct options", () => {
  assert.ok(deck.items.length > 8000, "bank size " + deck.items.length);
  const ids = new Set();
  const legend = new Set(Object.keys(FLAG_LEGEND));
  for (const it of deck.items) {
    assert.ok(!ids.has(it.id), "duplicate id " + it.id);
    ids.add(it.id);
    assert.ok(typeof it.q === "string" && it.q.length >= 10, it.id);
    assert.ok(Array.isArray(it.o) && it.o.length === 4 && it.o.every((o) => typeof o === "string" && o.trim()), it.id);
    assert.equal(new Set(it.o.map((o) => o.toLowerCase())).size, 4, it.id);
    assert.ok(Number.isInteger(it.a) && it.a >= 0 && it.a <= 3, it.id);
    assert.equal(typeof it.exp, "string", it.id);
    assert.ok(CONTRACT.includes(it.t), it.id + " topic " + it.t);
    assert.ok([1, 2, 3].includes(it.d), it.id);
    if (it.flags !== undefined) assert.ok(Array.isArray(it.flags) && it.flags.length > 0 && it.flags.every((f) => legend.has(f)), it.id);
  }
});

test("no duplicate stem with the same option set, every subtopic is populated, all three levels exist", () => {
  const seen = new Set();
  for (const it of deck.items) {
    const k = it.q.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + "|" + it.o.map((o) => o.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).sort().join("|");
    assert.ok(!seen.has(k), "duplicate " + it.id);
    seen.add(k);
  }
  for (const id of CONTRACT) assert.ok(deck.items.filter((i) => i.t === id).length >= 100, id);
  for (const d of [1, 2, 3]) assert.ok(deck.items.filter((i) => i.d === d).length >= 1000, "level " + d);
});

test("text is clean: no HTML tags, entities, em or en dash, no source artefacts", () => {
  const texts = deck.items.flatMap((i) => [i.q, ...i.o, i.exp]);
  for (const t of texts) {
    assert.ok(!/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(t), "html in " + t.slice(0, 60));
    assert.ok(!/&(amp|lt|gt|quot|nbsp|#\d+);/.test(t), "entity in " + t.slice(0, 60));
  }
  assert.ok(!/[\u2013\u2014]/.test(RAW), "dash in deck files");
  assert.ok(!texts.some((t) => /[a-z]deg\b/.test(t)), "deg artefact");
  const bag = texts.join(" ").toLowerCase();
  assert.ok(!/\baboion\b|\binfeility\b|\bantepaum\b|\bhypeension\b/.test(bag), "dropped-rt words repaired");
});

test("stats agree with the items", () => {
  const s = deck.stats;
  assert.equal(s.total, deck.items.length);
  for (const id of CONTRACT) assert.equal(s.byTopic[id], deck.items.filter((i) => i.t === id).length, id);
  for (const d of [1, 2, 3]) assert.equal(s.byLevel[d], deck.items.filter((i) => i.d === d).length, "d" + d);
  assert.equal(s.flagged, deck.items.filter((i) => i.flags).length);
  assert.equal(s.withExplanation, deck.items.filter((i) => i.exp).length);
  const b = s.build.bySubtopic;
  for (const id of CONTRACT) assert.equal(b[id].table + b[id].keyword + b[id].fallback, s.byTopic[id], id);
});

test("difficulty: recall stem easy, vignette hard (port of the Ophthalmos rules)", () => {
  assert.equal(difficulty("Chadwick's sign is:"), 1);
  assert.equal(difficulty("Drug of choice in eclampsia is"), 1);
  assert.equal(difficulty("A 28-year-old primigravida at 36 weeks presents with severe headache and blurring of vision. BP 170/110. Next best step?"), 3);
  assert.equal(difficulty("All of the following are risk factors for placenta previa, EXCEPT:"), 3);
  assert.equal(difficulty("Which of the following hormones is raised in pregnancy?"), 2);
});

test("cleanText: HTML, entities, dashes, artefacts, whitespace", () => {
  assert.equal(cleanText("<p>Pre-eclampsia&nbsp;is<br>defined</p>  by &lt;140&amp;90"), "Pre-eclampsia is defined by <140&90");
  assert.equal(cleanText("a \u2014 b \u2013 c"), "a - b - c");
  assert.equal(cleanText("Subpubic angle <65deg and implantsdeg"), "Subpubic angle <65° and implants");
  assert.equal(cleanText("Vasa Pre is"), "Vasa previa is");
});

test("rt repair: restores dropped letters from corpus evidence, leaves real words alone", () => {
  const corpus = [
    "abortion abortion abortion aboion aboion", "infertility infertility infertility infeility", "heart heart heart hea",
    "so so so sort sort sort was was warts warts warts", "ABO group ABO", "Hea disease", "postpartum postpartum postpartum postpaum",
  ];
  const r = buildRepair(corpus);
  assert.equal(r.apply("Aboion and infeility"), "Abortion and infertility");
  assert.equal(r.apply("hea and Hea and HEA"), "heart and Heart and HEA"); // short all-caps stay (abbreviations)
  assert.equal(r.apply("so was ABO"), "so was ABO");
  assert.equal(r.apply("postpaum"), "postpartum");
});

test("cleanExplanation drops the restated answer, keeps the substance and the reference", () => {
  assert.equal(cleanExplanation("Ans. is 'b' i.e. Karyotyping Karyotyping is best to differentiate MRKH from testicular feminization. Ref: Dutta 9/e", "Karyotyping"),
    "Karyotyping is best to differentiate MRKH from testicular feminization. Ref: Dutta 9/e");
  assert.equal(cleanExplanation("D i.e. CRVO CRAO (not CRVO) presents with cherry red spot at macula", "CRVO"), "CRAO (not CRVO) presents with cherry red spot at macula");
  assert.equal(cleanExplanation("Endometrial biopsy", "Endometrial biopsy"), "");
  assert.equal(cleanExplanation("Progesterone raises basal body temperature after ovulation. D. C. Dutta 8/e", "Progesterone"), "Progesterone raises basal body temperature after ovulation. D. C. Dutta 8/e");
});

test("expFlags: letter and text contradictions flagged, agreement and 'a, b and c' not", () => {
  const o = ["Tumour positive for estrogen receptors", "Myometrial invasion", "Positive lymph nodes", "Endocervical involvement"];
  assert.deepEqual(expFlags("Ans. is a i.e. Tumour positive for estrogen receptors", o, 1).sort(), ["exp-letter", "exp-text"]);
  assert.deepEqual(expFlags("Ans. is 'b' i.e. Myometrial invasion", o, 1), []);
  assert.deepEqual(expFlags("D i.e. Endocervical involvement", o, 3), []);
  assert.deepEqual(expFlags("Ans. is a, b and c i.e. Tumour positive for estrogen receptors; Myometrial invasion", [...o.slice(0, 3), "All"], 3), []);
  assert.deepEqual(expFlags("Ans. is a common cause of bleeding", o, 2), []);
});

test("subtopic mapping: topic table and keyword rules", () => {
  assert.equal(tableTopic("Antepartum Haemorrhage"), "ob-haemorrhage");
  assert.equal(tableTopic("Carcinoma Ovary"), "gy-oncology");
  assert.equal(tableTopic("Contraceptives"), "gy-contraception");
  assert.equal(tableTopic("General obstetrics"), null);
  assert.equal(tableTopic("AIIMS 2019"), null);
  assert.equal(tableTopic("Twin Pregnancy, Molar Pregnancy, Gestational Trophoblastic disease and contraception in special situations (Sour Grapes!)"), null);
  const k = (q, key = "", exp = "", topic = "") => keywordTopic({ q, key, exp, topic }).id;
  assert.equal(k("Drug of choice for postpartum hemorrhage resistant to oxytocin", "Carboprost"), "ob-haemorrhage");
  assert.equal(k("Magnesium sulphate toxicity is first detected by", "Loss of patellar reflex"), "ob-hypertension");
  assert.equal(k("Copper T 380A is effective for how many years", "10"), "gy-contraception");
  assert.equal(k("Strawberry cervix is seen in", "Trichomonas vaginalis"), "gy-infection");
  assert.equal(k("Most common site of ectopic pregnancy", "Ampulla"), "ob-early");
  assert.equal(k("Le Fort operation is done for", "Prolapse in the elderly"), "gy-urogyn");
});
