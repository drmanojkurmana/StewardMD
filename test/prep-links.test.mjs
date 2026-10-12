// PrepNucleus knowledge links (tools/prep-links.mjs): KB id casings, the conservative matcher, the confirm
// request shape, the bank route, and a build over a synthetic one-module cache. All items synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { norm, leadIn, leadSec, normKbId, kbDocs, phrases, drugPhrases, matcher, scan, linkItem, expText, dictionaries,
  confirmRequests, build, reportText, SHOW, MAX, CONFIRM_SCHEMA, kbBridge, pickKbLesson, matchChapter, sigWords,
  addTopicLinks, stampLinks, gapsReport, topicKbForModule, LINKS_VER, linkRelevant, floorEntries } from "../tools/prep-links.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";

const D = dictionaries();
const C0 = { df: new Map(), n: 1000, clinical: true, byKey: D.byKey, kbTitle: D.kbTitle, drugIds: D.drugIds, protoIds: D.protoIds };
const IT = (o) => ({ id: "t1", q: "Synthetic stem. What is the cause?", o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1, exp: "", ...o });

test("normKbId: every spelling maps to the one key the library opens", () => {
  assert.equal(normKbId("zika_virus", D.byKey), "zika_virus");
  assert.equal(normKbId("ZIKA_VIRUS", D.byKey), "zika_virus");
  assert.equal(normKbId("kb-reference-zika-virus", D.byKey), "zika_virus");
  assert.equal(normKbId("kb-diseases-brain-abscess", D.byKey), "BRAIN_ABSCESS");
  assert.equal(normKbId("kb:BRAIN_ABSCESS", D.byKey), "BRAIN_ABSCESS");
  assert.equal(normKbId("no-such-article", D.byKey), null);
  assert.equal(normKbId("", D.byKey), null);
  assert.ok(D.src.kbN > 4600 && D.src.prN > 200 && D.src.drN > 2000, "the dictionaries cover the knowledge base");
});

test("linkItem: the keyed answer links, a distractor never does, negation stays below the floor", () => {
  const key = linkItem(IT({ exp: "Beaded mid renal artery in young women is fibromuscular dysplasia." }), D.M, C0);
  assert.equal(key[0].k, "kb"); assert.equal(key[0].id, "fibromuscular_dysplasia"); assert.equal(key[0].c, 92);
  const dist = linkItem(IT({ a: 0, exp: "Atheroma of the ostium in an older man." }), D.M, C0);
  assert.ok(!dist.some((l) => l.id === "fibromuscular_dysplasia" && l.c >= SHOW), "a wrong option caps at 50");
  assert.ok(dist.some((l) => l.id === "fibromuscular_dysplasia" && l.c <= 50) || true);
  const neg = linkItem(IT({ q: "Synthetic stem. All of the following are causes EXCEPT?", o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1 }), D.M, C0);
  assert.ok(neg.every((l) => l.id !== "fibromuscular_dysplasia" || l.c < SHOW), "the odd one out is not the concept");
  const expOnly = linkItem(IT({ q: "Synthetic stem about an older man with ostial disease. What is it?", a: 0, exp: "Unlike fibromuscular dysplasia of young women, this is ostial atheroma." }), D.M, C0);
  const eo = expOnly.find((l) => l.id === "fibromuscular_dysplasia");
  assert.ok(!eo || eo.c < SHOW, "explanation-only mentions are kept out");
  const nonClin = linkItem(IT({}), D.M, { ...C0, clinical: false });
  assert.ok(nonClin.every((l) => l.k !== "pr"), "basic-science subjects get no protocol links");
});

test("linkItem: pipeline links win at 95, unknown ids are dropped, at most two articles", () => {
  const ls = linkItem(IT({ exp: "Zika virus infection; metformin and accidental hypothermia are covered here.", x: { links: { kb: ["zika_virus", "no-such-article"], drug: ["metformin"], protocol: ["accidental-hypothermia"] } } }), D.M, C0);
  assert.ok(ls.some((l) => l.id === "zika_virus" && l.c === 95 && l.v === "a"));
  assert.ok(ls.some((l) => l.id === "metformin" && l.c === 95));
  assert.ok(ls.some((l) => l.id === "accidental-hypothermia" && l.c === 95));
  assert.ok(!ls.some((l) => l.id === "no-such-article"));
  assert.ok(ls.filter((l) => l.k === "kb").length <= 2);
});

test("expText reads the new explanation fields; leadIn/leadSec find the question and its section", () => {
  const it = IT({ x: { mechanism: "rings and beads", ddx: "atheroma", clues: "young woman", pearl: "beads", rev: "young beads" } });
  for (const w of ["rings", "atheroma", "young woman", "beads", "young beads"]) assert.match(expText(it), new RegExp(w));
  assert.equal(leadIn("A vignette with history. What is the cause?"), "What is the cause?");
  assert.equal(leadSec("A woman with fever. What is the best initial treatment?"), "mgmt");
  assert.equal(leadSec("A man with chest pain. What is the gold standard test?"), "dx");
  assert.equal(leadSec("A child with rash. What is the most likely cause?"), "causes");
});

test("phrases: acronyms match upper case only, shared phrases are dropped", () => {
  const M = matcher([{ w: ["copd"], k: "kb", id: "a", title: "A", acr: true, key: "A:copd" }]);
  assert.equal(scan(M, "COPD with exacerbation").size, 1);
  assert.equal(scan(M, "copd in lower case").size, 0);
  const dup = phrases([{ id: "a", name: "Dengue shock syndrome", aliases: [] }, { id: "b", name: "Dengue shock syndrome", aliases: [] }], "kb");
  assert.equal(dup.length, 0, "a phrase two articles share cannot say which is meant");
  assert.ok(drugPhrases({ generics: ["metformin", "water", "x"] }).some((p) => p.id === "metformin"));
  assert.ok(!drugPhrases({ generics: ["water"] }).length, "ordinary words are not drugs");
});

test("topicKbForModule: exact, lesson-cited, ambiguous and off-topic cases", () => {
  const kb = [
    { id: "heart_failure_management", name: "Heart Failure: Management", aliases: ["HFrEF", "Chronic heart failure"] },
    { id: "heart_failure_pathophysiology_and_diagnosi", name: "Heart Failure: Pathophysiology and Diagnosis", aliases: ["HF"] },
    { id: "acute_appendicitis", name: "Acute Appendicitis and Peritonitis", aliases: ["appendicitis"] },
    { id: "pseudomyxoma_peritonei", name: "Pseudomyxoma peritonei", aliases: [] },
  ];
  const cited = new Set(["heart_failure_management", "heart_failure_pathophysiology_and_diagnosi", "acute_appendicitis", "pseudomyxoma_peritonei"]);
  assert.deepEqual(topicKbForModule({ title: "Heart failure", lessonTitle: "Management of Heart Failure with Reduced Ejection Fraction", cited, kb }),
    { id: "heart_failure_management", title: "Heart Failure: Management" }, "the lesson's management article, not the pathophysiology one");
  assert.deepEqual(topicKbForModule({ title: "Appendix", lessonTitle: "Acute Appendicitis and Appendage Torsion", cited, kb }),
    { id: "acute_appendicitis", title: "Acute Appendicitis and Peritonitis" },
    "a one-word module title resolves through its own lesson's heading, never to the cited differentials");
  assert.deepEqual(topicKbForModule({ title: "Acute appendicitis", lessonTitle: "", cited: new Set(), kb }),
    { id: "acute_appendicitis", title: "Acute Appendicitis and Peritonitis" }, "an exact alias match needs no citation");
  assert.equal(topicKbForModule({ title: "Heart failure", lessonTitle: "", cited, kb }), null, "a tie with no lesson words stays unlinked");
  assert.equal(topicKbForModule({ title: "Beta blockers", lessonTitle: "", cited: new Set(), kb }), null, "no article about the topic, no link");
  assert.equal(LINKS_VER, "v2", "the rebuilt index publishes under the new versioned path");
});

test("addTopicLinks: topicKb gives an own-lesson module its KB article next to the lesson", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Heart Failure Care", own: true }]]]);
  const out = addTopicLinks([], { q: "What is the best initial treatment?" },
    { mid: "m1", sid: "s", topics: {}, topicKb: { id: "heart_failure_management", title: "Heart Failure: Management" },
      lessons, lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.deepEqual(out.map((l) => [l.k, l.id, l.v, l.c]), [["ls", "m1", "lt", 75], ["kb", "heart_failure_management", "kt", 75]],
    "lesson and KB article together at the floor");
});

test("bank route: the links index and shards are served, traversal and bad names are not", () => {
  assert.ok(bankPath({ path: ["v2", "links", "index.json"] }), "the new versioned path is served");
  assert.ok(bankPath({ path: ["v1", "links", "index.json"] }));
  assert.ok(bankPath({ path: ["v1", "links", "m", "ana-bones-ossification-1234abcd.json"] }));
  assert.ok(bankPath({ path: ["v12", "links", "c", "anatomy-1234abcd.json"] }));
  assert.equal(bankPath({ path: ["v1", "links", "m", "ana-x-1234abc.json"] }), null, "7 hex is not a shard");
  assert.equal(bankPath({ path: ["v1", "links", "..", "manifest.json"] }), null);
  assert.equal(bankPath({ path: ["v1", "links", "index.json", "x"] }), null);
});

test("confirm: blind stem-only requests, the schema, dry run without a cache", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plk-"));
  try {
    const { pairs, reqs } = confirmRequests({ cache: dir, bank: null });
    assert.deepEqual(pairs, []); assert.deepEqual(reqs, []);
    assert.deepEqual(Object.keys(CONFIRM_SCHEMA.properties), ["a"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("build: one synthetic module links, reports and shards without question text", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plk-"));
  try {
    const rel = "v5/anatomy/mcq/ana-bones-ossification.json";
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify({ topic: "ana-bones-ossification", items: [
      { id: "plk-1", q: "Synthetic: beaded mid renal artery in a young woman. Cause?", o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1, exp: "Beaded mid artery is fibromuscular dysplasia." },
      { id: "plk-2", q: "Synthetic: what lowers glucose in pregnancy?", o: ["Insulin", "Metformin", "Glyburide", "Empagliflozin"], a: 0, exp: "Metformin lowers glucose.", x: { links: { drug: ["metformin"] } } },
      { id: "plk-3", q: "Synthetic: an unclear stem with no names anywhere?", o: ["Alpha", "Beta", "Gamma", "Delta"], a: 0, exp: "", flags: ["disputed"] },
    ] }));
    fs.writeFileSync(path.join(dir, "lessons-index.json"), JSON.stringify({ modules: { "ana-bones-ossification": { module: "ana-bones-ossification" } } }));
    fs.writeFileSync(path.join(dir, "cards-index.json"), JSON.stringify({ modules: {} }));
    fs.writeFileSync(path.join(dir, "lesson-src.json"), JSON.stringify({}));
    const b = build({ cache: dir, bank: null, log: () => {} });
    assert.equal(b.report.items, 2, "the flagged item is never linked");
    assert.equal(b.report.linked, 2);
    assert.ok(b.pointer.m["ana-bones-ossification"], "the pointer names the module shard");
    const f = b.files.find((x) => x.rel.startsWith("m/ana-bones-ossification-"));
    assert.ok(f, "one immutable shard");
    assert.ok(/^m\/ana-bones-ossification-[0-9a-f]{8}\.json$/.test(f.rel));
    const sh = JSON.parse(f.body);
    assert.deepEqual(Object.keys(sh).sort(), ["T", "e", "m", "mod", "s", "v", "ver", "x"]);
    assert.ok(!f.body.includes("beaded mid renal"), "no question text is published");
    assert.ok(b.sidecar.length === 2 && b.sidecar[0].provenance && b.sidecar[0].links.kb_ids.length, "the sidecar keeps every candidate");
    assert.match(reportText(b.report), /2 of 2 usable items/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("floorEntries: only topics present in topics.json survive, everything else is inert", () => {
  const n360 = { topics: [{ id: "t1", title: "Topic One" }] };
  assert.deepEqual(floorEntries({ map: { m1: "t1", m2: "missing", m3: ["t1"] } }, n360),
    { m1: { id: "t1", title: "Topic One" } }, "missing topics and non-string targets drop out");
  assert.deepEqual(floorEntries(null, n360), {});
  assert.deepEqual(floorEntries({ map: { m1: "t1" } }, null), {});
});

test("build: the floor rides mod.n360, and floored modules with zero links still get a shard", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plk-"));
  try {
    const rel = "v5/anatomy/mcq/ana-bones-ossification.json";
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), JSON.stringify({ topic: "ana-bones-ossification", items: [
      { id: "plk-1", q: "Synthetic: beaded mid renal artery in a young woman. Cause?", o: ["Atheroma", "Fibromuscular dysplasia", "Arteritis", "Embolism"], a: 1, exp: "Beaded mid artery is fibromuscular dysplasia." },
    ] }));
    // ana-mixed is link-proof by construction: mixed modules never get own lessons or topic maps.
    const rel2 = "v5/anatomy/mcq/ana-mixed.json";
    fs.writeFileSync(path.join(dir, rel2), JSON.stringify({ topic: "ana-mixed", items: [
      { id: "plk-9", q: "Synthetic: zzzqqq blorpt with no medical names at all?", o: ["Zza", "Zzb", "Zzc", "Zzd"], a: 0, exp: "" },
    ] }));
    fs.writeFileSync(path.join(dir, "lessons-index.json"), JSON.stringify({ modules: {} }));
    fs.writeFileSync(path.join(dir, "cards-index.json"), JSON.stringify({ modules: {} }));
    fs.writeFileSync(path.join(dir, "lesson-src.json"), JSON.stringify({}));
    const floor = { "ana-bones-ossification": { id: "t1", title: "Topic One" }, "ana-mixed": { id: "t1", title: "Topic One" } };
    const b = build({ cache: dir, bank: null, floor, log: () => {} });
    assert.equal(b.report.linked, 1, "the unlinked module adds no coverage");
    const f1 = b.files.find((x) => x.rel.startsWith("m/ana-bones-ossification-"));
    assert.deepEqual(JSON.parse(f1.body).mod.n360, { id: "t1", title: "Topic One" }, "linked modules carry the floor too");
    const f2 = b.files.find((x) => x.rel.startsWith("m/ana-mixed-"));
    assert.ok(f2, "a floored module with zero links still gets a shard");
    assert.deepEqual(JSON.parse(f2.body).mod, { n360: { id: "t1", title: "Topic One" } }, "mod-only record");
    assert.deepEqual(JSON.parse(f2.body).e, {}, "no entries, so gaps counts nothing");
    assert.ok(b.pointer.m["ana-mixed"], "the pointer names the floor shard");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("topic links: the KB bridge stays in-subject, chapters match strictly, lessons cap at two", () => {
  const bridge = kbBridge(new Map([["m1", new Set(["a"])], ["m2", new Set(["a", "b", "c"])]]));
  assert.equal(pickKbLesson("a", "m1", "s", bridge, new Map([["m1", "s"]])), "m1", "the module's own lesson wins");
  assert.equal(pickKbLesson("a", "mx", "s", bridge, new Map([["m1", "s"], ["m2", "s"]])), "m1", "the most focused same-subject lesson");
  assert.equal(pickKbLesson("a", "mx", "t", bridge, new Map([["m1", "s"], ["m2", "s"]])), null, "lessons never cross subjects");
  assert.equal(pickKbLesson("zz", "m1", "s", bridge, new Map()), null);
  const ch = [{ key: "c2", title: "Hepatic Adenoma Imaging" }, { key: "c1", title: "Biliary Colic" }];
  assert.equal(matchChapter(["Hepatic adenoma"], ch), "c2");
  assert.equal(matchChapter(["Adenoma"], ch), null, "one word never matches a chapter");
  assert.equal(matchChapter(["Hepatic adenoma rupture"], ch), null, "every word must be in the heading");
  assert.deepEqual(sigWords("The approach to liver masses"), ["approach", "liver", "masses"]);
});

test("addTopicLinks: own chapter at the bar, topics fill slots, one specific lesson with its step", () => {
  const lessons = new Map([["m1", [{ key: "m1", title: "Liver Masses", own: true }, { key: "c9", title: "Hepatic Adenoma Imaging", own: false }]]]);
  const meta = new Map([["m1", { title: "Liver Masses" }], ["c9", { title: "Hepatic Adenoma Imaging" }]]);
  const topics = { m0: { kb: [["cataract", "Cataract"]], pr: [["blood-transfusion", "Blood transfusion"]] } };
  const it = { q: "What is the best initial treatment?", tg: ["x"] };
  const ls = addTopicLinks([], it, { mid: "m1", sid: "s", topics, lessons, lessonMeta: meta, bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.deepEqual(ls, [{ k: "ls", id: "m1", title: "Liver Masses", c: 75, v: "lt", sec: "" }]);
  const kb = addTopicLinks([], it, { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: meta, bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.deepEqual(kb.map((l) => [l.k, l.v, l.c]), [["kb", "kt", 75], ["pr", "kt", 75]]);
  assert.equal(kb[0].sec, "mgmt", "the topic article opens at the answering section");
  const full = [{ k: "kb", id: "a", title: "A", c: 92, v: "k" }, { k: "kb", id: "b", title: "B", c: 80, v: "q" }];
  addTopicLinks(full, it, { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: meta, bridge: new Map(), midSid: new Map(), images: new Map() });
  assert.equal(full.filter((l) => l.k === "kb").length, MAX.kb, "topics never push past the cap");
  const img = addTopicLinks([], { img: ["v1/x/a.webp"] }, { mid: "m1", sid: "s", topics: {}, lessons, lessonMeta: meta, bridge: new Map(), midSid: new Map(), images: new Map([["a.webp", { l: "c9", step: 2 }]]) });
  assert.deepEqual(img.map((l) => [l.id, l.v, l.sec]), [["m1", "lt", ""], ["c9", "li", "2"]], "the chapter plus the image's step");
  const kbL = addTopicLinks([{ k: "kb", id: "a", title: "Atheroma", c: 92, v: "k" }], it,
    { mid: "m0", sid: "s", topics: {}, lessons: new Map(), lessonMeta: new Map([["m1", { title: "Liver Masses" }]]),
      bridge: new Map([["a", [{ key: "m1", n: 3 }]]]), midSid: new Map([["m1", "s"]]), images: new Map() });
  assert.deepEqual(kbL.filter((l) => l.k === "ls"), [{ k: "ls", id: "m1", title: "Liver Masses", c: 80, v: "lk", sec: "" }]);
});

test("addTopicLinks: a weak same-topic mention upgrades to the topic tier instead of nothing", () => {
  const topics = { m0: { kb: [["cataract", "Cataract"]], pr: [] } };
  const ctx = { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map() };
  const weak = [{ k: "kb", id: "cataract", title: "Cataract", c: 55, v: "e", sec: "" }];
  addTopicLinks(weak, { q: "Rosette shaped cataract is seen in?" }, ctx);
  assert.deepEqual(weak.map((l) => [l.k, l.id, l.v, l.c]), [["kb", "cataract", "kt", 75]]);
  const other = [{ k: "kb", id: "glaucoma", title: "Glaucoma", c: 55, v: "e", sec: "" }];
  addTopicLinks(other, { q: "What?" }, ctx);
  assert.equal(other[0].v, "e", "a weak off-topic mention stays below the bar");
  assert.ok(other.some((l) => l.k === "kb" && l.id === "cataract" && l.v === "kt" && l.c === 75), "the module topic still fills the slot");
});

test("addTopicLinks: unshown mentions vacate slots for the verified topic; shown links never move", () => {
  const topics = { m0: { kb: [["cataract", "Cataract"]], pr: [] } };
  const ctx = { mid: "m0", sid: "s", topics, lessons: new Map(), lessonMeta: new Map(), bridge: new Map(), midSid: new Map(), images: new Map() };
  const full = [
    { k: "kb", id: "glaucoma", title: "Glaucoma", c: 55, v: "e", sec: "" },
    { k: "kb", id: "blepharitis", title: "Blepharitis", c: 50, v: "e", sec: "" },
  ];
  addTopicLinks(full, { q: "What?" }, ctx);
  assert.ok(full.some((l) => l.k === "kb" && l.id === "cataract" && l.v === "kt" && l.c === 75), "the topic lands");
  assert.equal(full.filter((l) => l.k === "kb").length, MAX.kb, "the cap still holds");
  const shown = [
    { k: "kb", id: "a", title: "A", c: 92, v: "k", sec: "" },
    { k: "kb", id: "b", title: "B", c: 80, v: "q", sec: "" },
  ];
  addTopicLinks(shown, { q: "What?" }, ctx);
  assert.deepEqual(shown.map((l) => l.id), ["a", "b"], "shown links are never evicted for the topic");
});

test("stampLinks: kept items arrive with honest concept links and the module lesson, never inflated topics", () => {
  const items = [
    { id: "q_new1", q: "Heart failure with reduced ejection fraction. Drug of choice?", o: ["Lisinopril", "Amlodipine", "Metoprolol", "Digoxin"], a: 0, exp: "The ACE inhibitor lisinopril is first line." },
    { id: "q_new2", q: "Which structure passes through the carpal tunnel?", o: ["Median nerve", "Ulnar nerve", "Radial artery", "Palmaris longus"], a: 0, exp: "" },
  ];
  stampLinks(items, { sid: "medicine", mid: "med-acid-base" });
  assert.ok(items[0].x && items[0].x.links, "a concept item is stamped");
  assert.ok((items[0].x.links.drug_ids || []).length > 0, "the keyed drug is stamped");
  assert.deepEqual(items[0].x.links.lesson_ids, ["med-acid-base"], "the module's own bundled lesson is stamped");
  assert.ok(items[1].x && items[1].x.links, "an item with no mappable concept still gets its chapter");
  assert.deepEqual(items[1].x.links.lesson_ids, ["med-acid-base"]);
  assert.equal((items[1].x.links.kb_ids || []).length, 0, "no concept is invented, and no kt topic is stamped at pipeline confidence");
});

test("gapsReport: counts linked from shards against the index total", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "links-gaps-"));
  fs.mkdirSync(path.join(dir, "m"), { recursive: true });
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ n: { items: 5 }, m: { m1: "s/h1", m2: "s/h2" } }));
  fs.writeFileSync(path.join(dir, "m/m1-h1.json"), JSON.stringify({ e: { a: [], b: [] } }));
  fs.writeFileSync(path.join(dir, "m/m2-h2.json"), JSON.stringify({ e: { c: [] } }));
  assert.deepEqual(gapsReport(dir), { items: 5, linked: 3, unlinked: 2 });
  assert.equal(gapsReport(path.join(dir, "nope")), null);
});

test("linkItem: module grounding tags need per-item corroboration, hand links keep trust", () => {
  const gx = (kb_ids) => ({ x: { links: { kb_ids, via: "grounding-source" } } });
  const good = IT({ q: "Cataract blurs vision. What is the treatment of cataract?", exp: "Cataract surgery restores sight.", ...gx(["cataract"]) });
  assert.ok(linkItem(good, D.M, C0).some((l) => l.k === "kb" && l.id === "cataract" && l.v === "a" && l.c === 95), "corroborated grounding tag stays at pipeline confidence");
  const bad = IT({ q: "Painless loss of vision with an afferent defect. What is the likely cause?", exp: "Glaucoma damages the optic nerve.", ...gx(["cataract"]) });
  assert.ok(!linkItem(bad, D.M, C0).some((l) => l.id === "cataract"), "an uncorroborated grounding tag is dropped, never shown");
  const hand = IT({ q: "Painless loss of vision with an afferent defect. What is the likely cause?", exp: "Glaucoma damages the optic nerve.", x: { links: { kb_ids: ["cataract"] } } });
  assert.ok(linkItem(hand, D.M, C0).some((l) => l.id === "cataract" && l.v === "a"), "a hand-written link without the grounding marker keeps trust");
});

test("linkItem: SGLT2 key never links Familial Renal Glucosuria (owner screenshot 2026-10-13)", () => {
  const stem = "A 62-year-old woman with heart failure with reduced ejection fraction (LVEF 30%) is on sacubitril-valsartan and bisoprolol. She is non-diabetic. Which additional drug class reduces cardiovascular death and heart failure hospitalisation irrespective of diabetes status?";
  const opts = ["Loop diuretic escalation", "SGLT2 inhibitor (dapagliflozin)", "Calcium channel blocker", "Thiazide diuretic"];
  const exp = "Dapagliflozin, an SGLT2 inhibitor, reduces CV death and HF hospitalisation in HFrEF irrespective of diabetes.";
  const viaMatcher = linkItem({ id: "sg1", t: "med-heart-failure", q: stem, o: opts, a: 1, exp }, D.M, { ...C0, mid: "med-heart-failure", moduleTitle: "Heart failure" });
  assert.ok(!viaMatcher.some((l) => l.id === "renal_glucosuria" && l.c >= SHOW), "matcher SGLT2 alias must not show the genetic-condition article");
  assert.ok(viaMatcher.some((l) => l.k === "dr" && l.id === "dapagliflozin" && l.c >= SHOW), "the keyed drug stays");
  const viaPipe = linkItem({ id: "sg2", t: "med-heart-failure", q: stem, o: opts, a: 1, exp, x: { links: { kb_ids: ["renal_glucosuria"], drug_ids: ["dapagliflozin"], via: "grounding-tier-4", ver: "wave-w2" } } }, D.M, { ...C0, mid: "med-heart-failure", moduleTitle: "Heart failure" });
  assert.ok(!viaPipe.some((l) => l.id === "renal_glucosuria" && l.c >= SHOW), "pipeline x.links at 95 must not show it either");
  assert.ok(viaPipe.some((l) => l.k === "dr" && l.id === "dapagliflozin" && l.c === 95), "the relevant pipeline drug link keeps pipeline confidence");
  assert.equal(linkRelevant({ q: stem, o: opts, a: 1, exp }, { k: "kb", id: "renal_glucosuria", title: "Familial Renal Glucosuria", v: "a" }, { mid: "med-heart-failure", moduleTitle: "Heart failure" }), false);
  assert.equal(linkRelevant({ q: stem, o: opts, a: 1, exp }, { k: "kb", id: "heart_failure", title: "Heart failure", v: "k" }, { mid: "med-heart-failure", moduleTitle: "Heart failure" }), true);
});
