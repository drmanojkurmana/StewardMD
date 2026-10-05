/* PrepNucleus Layer A bank builder (tools/prep-build-bank.mjs), on small in-memory fixtures plus the real taxonomy.
 * What must hold: every taxonomy file in prep/taxonomy/ is valid and module ids are unique across subjects; the app
 * tree carries no scope text; textbook references and page locators leave explanations while gene names stay;
 * mapping prefers the embedding, lets clear keywords win, and sends weak items to "Mixed practice"; duplicates
 * collapse with conflicting keys flagged; the index counts only usable items and every module is listed; vignettes
 * are tagged only for USMLE subjects.
 *
 * node --test test/prep-build-bank.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as B from "../tools/prep-build-bank.mjs";

const SUBJ = {
  id: "anatomy", code: "ana", branch: "mbbs", title: "Anatomy", medmcqa: "Anatomy", exams: ["neet-pg", "ini-cet", "usmle"],
  sections: [
    { id: "ana-limb", title: "Upper limb", modules: [
      { id: "ana-brachial-plexus", title: "Brachial plexus", size: "l", scope: "brachial plexus, Erb palsy, Klumpke palsy, roots, trunks, cords, axillary nerve" },
      { id: "ana-hand", title: "Hand", size: "m", scope: "carpal tunnel, median nerve, thenar muscles, lumbricals, interossei" }] },
    { id: "ana-embryo", title: "Embryology", modules: [
      { id: "ana-gametogenesis", title: "Gametogenesis", size: "s", scope: "spermatogenesis, oogenesis, meiosis, primary oocyte, polar body" }] },
  ],
};

test("the real taxonomy loads: valid subjects, unique module ids, both branches, no dashes", () => {
  const subs = B.loadTaxonomy();
  assert.ok(subs.length >= 33, "33 subjects or more");
  const ids = new Set();
  let n = 0;
  for (const s of subs) for (const sec of s.sections) for (const m of sec.modules) { assert.ok(!ids.has(m.id), m.id); ids.add(m.id); n++; }
  assert.ok(n >= 1500, "about 1,700 modules: " + n);
  assert.deepEqual([...new Set(subs.map((s) => s.branch))], ["mbbs", "ss-medicine"], "MBBS first, then SS");
  assert.equal(subs[0].id, "anatomy");
  for (const s of subs) if (s.branch === "ss-medicine") { assert.equal(s.medmcqa, null, s.id); assert.deepEqual(s.exams, ["neet-ss"], s.id); }
});

test("validateSubject catches the mistakes that broke builds", () => {
  assert.deepEqual(B.validateSubject(SUBJ), []);
  const bad = structuredClone(SUBJ);
  bad.sections[0].modules[1].id = "ana-limb";
  bad.sections[1].modules[0].size = "xl";
  bad.sections[1].modules[0].scope = "too short";
  bad.exams = ["neet-pg", "mrcp"];
  bad.title = "Anatomy — basics";
  const e = B.validateSubject(bad).join("|");
  for (const want of ["module id ana-limb", "module size ana-gametogenesis", "module scope ana-gametogenesis", "exams", "em or en dash"]) assert.ok(e.includes(want), want + " in " + e);
  const wrongCode = structuredClone(SUBJ); wrongCode.sections[0].modules[0].id = "phy-brachial";
  assert.ok(B.validateSubject(wrongCode).some((x) => x.includes("phy-brachial")), "module id must start with the subject code");
});

test("taxonomyForApp: branches, subjects, sections, modules; no scope text shipped", () => {
  const t = B.taxonomyForApp([SUBJ]);
  assert.equal(t.branches.length, 2);
  const s = t.branches[0].subjects[0];
  assert.deepEqual(s.name, { en: "Anatomy" });
  assert.deepEqual(s.ex, ["neet-pg", "ini-cet", "usmle"]);
  assert.deepEqual(s.sections[0].modules[0], { id: "ana-brachial-plexus", name: { en: "Brachial plexus" }, size: "l" });
  assert.ok(!JSON.stringify(t).includes("Klumpke"), "scope stays in the build");
  assert.deepEqual(t.branches[1].subjects, []);
});

test("scrubRefs removes references and locators, keeps gene names and prose", () => {
  const cases = [
    ["Vitamin A deficiency causes night blindness. Ref: Park 23rd ed, pg 596", "Vitamin A deficiency causes night blindness."],
    ["Digoxin inhibits the Na K ATPase (Ref. Harrison 19/e, p 1342).", "Digoxin inhibits the Na K ATPase."],
    ["The median nerve supplies the thenar muscles.Ref: BDC 6th ed, vol 1, pg 145", "The median nerve supplies the thenar muscles."],
    ["Mutation of p53 is the commonest in human cancers; p24 antigen appears early in HIV.", "Mutation of p53 is the commonest in human cancers; p24 antigen appears early in HIV."],
    ["Please refer to the pharmacokinetics of the drug for its half life and dosing.", "Please refer to the pharmacokinetics of the drug for its half life and dosing."],
  ];
  for (const [i, o] of cases) assert.equal(B.scrubRefs(i), o, i);
  assert.equal(B.scrubRefs("Ref: Robbins 9th edition page 123"), "", "a reference-only explanation empties");
  assert.equal(B.scrubRefs(""), "");
  for (const [i] of cases) assert.ok(!B.REF_SURVIVOR.test(B.scrubRefs(i)), "no survivor: " + i);
});

test("mapItem: embedding first, keywords as a tie-break and a fallback, weak to mixed", () => {
  const mods = B.compileModules(SUBJ);
  const it = { q: "Winging of scapula with loss of abduction follows injury to which root?", key: "C5", exp: "", topic: "" };
  assert.deepEqual(B.mapItem(mods, it, [["ana-brachial-plexus", 0.71], ["ana-hand", 0.6]]), { id: "ana-brachial-plexus", how: "embed" });
  // keywords clearly name another module the embedding never offered
  const kw = { q: "Carpal tunnel syndrome compresses the median nerve; which thenar muscle is spared?", key: "Adductor pollicis", exp: "median nerve, carpal tunnel", topic: "carpal tunnel" };
  assert.deepEqual(B.mapItem(mods, kw, [["ana-gametogenesis", 0.56], ["ana-brachial-plexus", 0.55]]), { id: "ana-hand", how: "keyword" });
  // weak on both counts
  assert.deepEqual(B.mapItem(mods, { q: "Which is true?", key: "All of the above", exp: "", topic: "" }, [["ana-hand", 0.4], ["ana-gametogenesis", 0.39]]), { id: null, how: "mixed" });
  // no embeddings: keywords only
  assert.deepEqual(B.mapItem(mods, { q: "First polar body is extruded at", key: "Ovulation", exp: "oogenesis, primary oocyte", topic: "" }, null), { id: "ana-gametogenesis", how: "keyword" });
  assert.equal(B.mixedId(SUBJ), "ana-mixed");
});

const mk = (id, q, o, a, extra = {}) => ({ id, subject: "Anatomy", q, o, a, key: o[a], exp: extra.exp || "", rawExp: "", topic: "", flags: new Set(extra.flags || []) });

test("dedupeSubject: same stem and options collapse; a conflicting key is flagged", () => {
  const q = "The nerve that supplies the deltoid muscle in the shoulder region is the";
  const items = [
    mk("a1", q, ["Axillary", "Radial", "Ulnar", "Median"], 0, { exp: "short" }),
    mk("a2", q, ["Radial", "Axillary", "Median", "Ulnar"], 1, { exp: "a longer explanation wins" }),
    mk("a3", q, ["Axillary", "Radial", "Ulnar", "Median"], 1),
    mk("b1", "Another stem that is long enough to count as a distinct question here", ["w", "x", "y", "z"], 2),
  ];
  const { kept, st } = B.dedupeSubject(items);
  assert.equal(kept.length, 2);
  const rep = kept.find((k) => k.q === q);
  assert.equal(rep.id, "a2", "the longer explanation is kept");
  assert.ok(rep.flags.has("dup-key"), "conflicting keys flag the survivor");
  assert.equal(st.removed, 2); assert.equal(st.keyConflicts, 1);
  assert.equal(B.crossKey(items[0]), B.crossKey(items[2]), "cross-subject key ignores option order and key");
});

test("buildSubject and subjectIndex: modules, mixed, flags out of counts, USMLE vignettes, cross-subject dupes", () => {
  const vignette = "A 24-year-old man presents after a fall on the outstretched hand with numbness over the lateral three and a half fingers and weakness of thumb opposition; which nerve is injured?";
  const items = [
    mk("i1", vignette, ["Median nerve", "Ulnar nerve", "Radial nerve", "Axillary nerve"], 0, { exp: "carpal tunnel and median nerve. Ref: BDC 6th ed pg 120" }),
    mk("i2", "First polar body is extruded at the time of", ["Ovulation", "Fertilisation", "Implantation", "Birth"], 0, { exp: "oogenesis, primary oocyte" }),
    mk("i3", "Which statement about this structure is true in general?", ["One", "Two", "Three", "Four"], 1),
    mk("i4", "Erb palsy follows injury to which roots of the brachial plexus?", ["C5 C6", "C8 T1", "C7", "T2"], 0, { flags: ["exp-contradicts"] }),
  ];
  const seen = new Set([B.crossKey(mk("x", "Already kept by an earlier subject in taxonomy order", ["a", "b", "c", "d"], 0))]);
  items.push(mk("i5", "Already kept by an earlier subject in taxonomy order", ["d", "c", "b", "a"], 3));
  const res = B.buildSubject(SUBJ, items, seen, null);
  const by = Object.fromEntries(res.items.map((x) => [x.id, x]));
  assert.equal(res.stats.crossDupes, 1); assert.ok(!by.i5);
  assert.equal(by.i1.t, "ana-hand"); assert.deepEqual(by.i1.ex, ["usmle"]); assert.ok(!/BDC|pg 120/.test(by.i1.exp));
  assert.equal(by.i2.t, "ana-gametogenesis"); assert.equal(by.i2.ex, undefined);
  assert.equal(by.i3.t, "ana-mixed");
  assert.deepEqual(by.i4.flags, ["exp-contradicts"]);
  assert.equal(by.i1.prov, "LIC");
  const ix = B.subjectIndex(SUBJ, res.items);
  const T = Object.fromEntries(ix.topics.map((t) => [t.id, t]));
  assert.deepEqual(ix.topics.map((t) => t.id), ["ana-brachial-plexus", "ana-hand", "ana-gametogenesis", "ana-mixed"], "every module listed in order, mixed last");
  assert.equal(T["ana-brachial-plexus"].count, 0, "the flagged item is not counted");
  assert.equal(T["ana-brachial-plexus"].all, 1);
  assert.equal(T["ana-hand"].usmle, 1);
  assert.equal(T["ana-hand"].target, 40); assert.equal(T["ana-gametogenesis"].target, 15);
  assert.equal(T["ana-mixed"].group, "mixed");
  assert.equal(ix.counts.total, 3); assert.equal(ix.counts.flagged, 1);
  // a subject without USMLE never tags vignettes
  const noUs = { ...SUBJ, exams: ["neet-pg"] };
  assert.equal(B.buildSubject(noUs, [mk("v", vignette, ["Median nerve", "Ulnar nerve", "Radial nerve", "Axillary nerve"], 0)], new Set(), null).items[0].ex, undefined);
});

test("isVignette needs a clinical lead and at least 25 words", () => {
  assert.equal(B.isVignette("A 3-year-old child presents with fever."), false, "too short");
  assert.equal(B.isVignette("A 45-year-old woman " + "word ".repeat(25)), true);
  assert.equal(B.isVignette("Which of the following " + "word ".repeat(30)), false);
});

test("planMoves: an item weak in its own subject and strong elsewhere moves; close calls stay", () => {
  const PHY = { id: "pathology", code: "pat", branch: "mbbs", title: "Pathology", medmcqa: "Pathology", exams: ["neet-pg"],
    sections: [{ id: "pat-lung", title: "Lung", modules: [{ id: "pat-ards", title: "ARDS", size: "s", scope: "ARDS, diffuse alveolar damage, hyaline membranes" }] }] };
  const items = [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }];
  const own = { m1: 0.55, m2: 0.7, m3: 0.6, m4: 0.5 }, x = { m1: ["pat-ards", 0.72], m2: ["pat-ards", 0.8], m3: ["pat-ards", 0.61], m4: ["ana-hand", 0.9] };
  const emb = { get: (id) => [["ana-hand", own[id]], ["ana-gametogenesis", 0.3]], x: (id) => x[id] };
  const r = B.planMoves([SUBJ, PHY], new Map([["Anatomy", items]]), { anatomy: emb });
  assert.deepEqual([...r.out], ["m1"], "m2 is strong at home, m3 is weak everywhere, m4's best is its own subject");
  assert.deepEqual(r.into.get("pathology").map((m) => [m.item.id, m.module]), [["m1", "pat-ards"]]);
  const res = B.buildSubject(PHY, [mk("m1", "The most characteristic feature of ARDS is", ["Diffuse alveolar damage", "Fibrosis", "Abscess", "Granuloma"], 0)].map((it) => ({ ...it, module: "pat-ards" })), new Set(), null);
  assert.equal(res.items[0].t, "pat-ards"); assert.equal(res.stats.map.moved, 1);
});

test("rt repair guard: common words stay, dropped rt letters are restored", async () => {
  const { buildRepair } = await import("../tools/tokos-build-mcq.mjs");
  const texts = [];
  for (let i = 0; i < 400; i++) texts.push("the nerve is close to the head as well as the arm and given po");
  for (let i = 0; i < 6; i++) texts.push("RTIs tort arts heartd port");
  for (let i = 0; i < 30; i++) texts.push("the hea and the heart, the aery and the artery");
  const plain = buildRepair(texts), guarded = buildRepair(texts, B.REPAIR);
  assert.equal(plain.apply("it is to the head"), "it rtis tort the heartd", "the unguarded repair corrupts (why the guard exists)");
  assert.equal(guarded.apply("it is to the head, given po"), "it is to the head, given po");
  assert.equal(guarded.apply("the hea and the aery"), "the heart and the artery");
});

test("emitted index and module files pass the engine validators; the markdown report renders", async () => {
  const { createRequire } = await import("node:module");
  const BANK = createRequire(import.meta.url)("../specialty-bank.js");
  const vignette = "A 24-year-old man presents after a fall on the outstretched hand with numbness over the lateral three and a half fingers and weakness of thumb opposition; which nerve is injured?";
  const res = B.buildSubject(SUBJ, [mk("v1", vignette, ["Median nerve", "Ulnar nerve", "Radial nerve", "Axillary nerve"], 0, { exp: "carpal tunnel" }),
    mk("v2", "First polar body is extruded at the time of", ["Ovulation", "Fertilisation", "Implantation", "Birth"], 0, { exp: "oogenesis" })], new Set(), null);
  const ix = B.subjectIndex(SUBJ, res.items);
  assert.deepEqual(BANK.validateIndex(ix), []);
  const ids = ix.topics.map((t) => t.id);
  assert.deepEqual(BANK.validateItems(res.items, ids), []);
  const md = B.reportMarkdown({ read: 10, drop: { imageRef: 1 }, repairWords: 3, shortfall: [{ fill: 5 }], subjects: [{ id: "anatomy", read: 10, kept: 8, mixed: 1, modules: 3, belowTarget: 1, perModule: { "ana-hand": 7 } }] }, "2026-10-05");
  assert.match(md, /\| anatomy \| 10 \| 0 \| 0 \| 8 \|/);
  assert.match(md, /12\.5%/);
  assert.match(md, /ana-hand 7/);
  assert.doesNotMatch(md, /[\u2013\u2014]/);
});
