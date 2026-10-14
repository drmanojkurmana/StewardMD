/* Pre-built common tests (tools/prep-fixed-tests.mjs, owner 2026-10-11).
 * What must hold:
 *  - one paper is one prep-assess.js assemble() call with a fixed seed: the same seed, bank and usage give the
 *    same paper (determinism), with no duplicate id or stem inside it;
 *  - the blueprint is honoured and every deviation recorded (official quotas shrink with the reason, never borrow);
 *  - a refused paper is a recorded shortfall, never padded with unrelated questions;
 *  - pools merge overlay files bank-first (unseen overlay ids appended, sets in sorted order), and a paper
 *    records the overlay sets its items came from, which the Tests tab merges when the bank file lacks an item;
 *  - image papers hold eligible image items only; subject image papers scope to one subject and share the numbering;
 *  - papers validate, the index lists them, published papers are never overwritten, numbering continues;
 *  - the bank route serves v<n>/tests/ papers (index short cache, papers immutable) and rejects traversal.
 * No network: a synthetic bank fixture. node --test test/prep-fixed-tests.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as T from "../tools/prep-fixed-tests.mjs";
import { bankPath } from "../functions/api/prep/bank/[[path]].js";

const require = createRequire(import.meta.url);
const A = require("../prep-assess.js");

const tax = T.loadTaxonomy();
// Synthetic bank: 4 subjects x 2 modules x 60 items, distinct stems, every 9th item flagged (ineligible).
function fixtureBank() {
  const bank = [];
  for (const s of ["anatomy", "physiology", "medicine", "surgery"]) {
    for (const m of ["m1", "m2"]) {
      const items = [];
      for (let i = 0; i < 60; i++) {
        items.push({
          id: `${s}-${m}-${i}`, q: `Stem ${s} ${m} number ${i} with enough distinct words for dedup purposes`, o: [`opt a ${i}`, `opt b ${i}`, `opt c ${i}`, `opt d ${i}`],
          a: i % 4, d: (i % 3) + 1, ...(i % 9 === 8 ? { flags: ["disputed"] } : {}), _s: s, _m: m,
        });
      }
      bank.push({ s, m, items });
    }
  }
  return bank;
}
const BANK_VERS = { v5: ["anatomy", "medicine", "physiology", "surgery"] };
// FMGE-scale fixture: every official-blueprint subject present but thin, so quotas shrink instead of refusing.
function fmgeBank(perSubject = 14) {
  const subs = Object.keys(A.profile("fmge").blueprint.subjects);
  return subs.map((s) => ({
    s, m: "m1",
    items: Array.from({ length: perSubject }, (_, i) => ({
      id: `${s}-m1-${i}`, q: `Stem ${s} number ${i} with enough distinct words for dedup purposes`, o: [`opt a ${i}`, `opt b ${i}`, `opt c ${i}`, `opt d ${i}`],
      a: i % 4, d: 2, _s: s, _m: "m1",
    })),
  }));
}

test("same seed gives the same paper (determinism)", () => {
  const bank = fixtureBank();
  const r1 = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
  const r2 = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T05:00:00.000Z");
  assert.ok(r1.paper && r2.paper);
  assert.deepEqual(r1.paper.items, r2.paper.items);
  assert.equal(r1.paper.seed, r2.paper.seed);
  assert.equal(r1.paper.seed, "fixed-tests/v1/neet-pg/mini/all/01");
});

test("no duplicate id or stem inside a paper", () => {
  const bank = fixtureBank();
  // A cross-subject duplicate stem and a duplicate id the assembler must drop.
  bank[1].items[0].q = bank[0].items[0].q;
  bank[2].items[0].id = bank[0].items[1].id;
  const used = {};
  const r = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, used, {}, "2026-10-11T00:00:00.000Z");
  assert.ok(r.paper);
  const ids = r.paper.items.map((t) => t[2]);
  assert.equal(new Set(ids).size, ids.length, "duplicate id in paper");
  const byId = {};
  for (const l of bank) for (const it of l.items) byId[it.id] = it;
  const stems = r.paper.items.map((t) => A.normStem(byId[t[2]].q));
  assert.equal(new Set(stems).size, stems.length, "duplicate stem in paper");
  assert.deepEqual(T.validatePaper(r.paper), []);
});

test("blueprint deviations are recorded when the bank cannot fill the quotas", () => {
  const bank = fmgeBank(); // every FMGE subject present but thin: official quotas must shrink, with reasons
  const r = T.buildPaper(tax, "fmge", "grand", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
  assert.ok(r.paper, JSON.stringify(r.shortfall));
  assert.ok(r.paper.reduced_from === 300, "FMGE grand shrinks, never borrows");
  assert.ok(r.paper.deviations.length > 0, "deviations recorded");
  assert.ok(r.paper.deviations.some((d) => /planned by the official blueprint/.test(d)), r.paper.deviations.join(" | "));
  // Nothing from outside the quotas: every item's subject was planned for.
  for (const t of r.paper.items) assert.ok((r.paper.planned[t[0]] || 0) > 0, t[0] + " was not planned for");
  assert.deepEqual(T.validatePaper(r.paper), []);
});

test("a refused paper is a recorded shortfall, never padded", () => {
  const tiny = [{ s: "anatomy", m: "m1", items: fixtureBank()[0].items.slice(0, 3) }];
  const r = T.buildPaper(tax, "neet-pg", "grand", "all", 1, tiny, { v5: ["anatomy"] }, {}, {}, "2026-10-11T00:00:00.000Z");
  assert.ok(!r.paper && r.shortfall);
  assert.match(r.shortfall.reason, /needs at least/);
  assert.equal(r.shortfall.eligible, 3);
});

test("usage tracking spreads grand papers apart", () => {
  const bank = fixtureBank();
  const used = {};
  const a = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, used, {}, "2026-10-11T00:00:00.000Z").paper;
  const b = T.buildPaper(tax, "neet-pg", "mini", "all", 2, bank, BANK_VERS, used, {}, "2026-10-11T00:00:00.000Z").paper;
  const inA = new Set(a.items.map((t) => t[2]));
  const shared = b.items.filter((t) => inA.has(t[2])).length;
  assert.ok(shared <= 2, `papers share ${shared} questions (pool holds ${8 * 60} with ${a.count} drawn twice)`);
});

test("FMGE part 2 runs through the assembler's own part path", () => {
  const plan = T.planFor("fmge", "part", "2");
  assert.equal(plan.asmType, "part");
  assert.deepEqual(plan.profile.format.sections.map((s) => s.id), ["2A", "2B", "2C"]);
  assert.equal(plan.profile.format.questions, 150);
  const bank = fmgeBank();
  const r = T.buildPaper(tax, "fmge", "part", "2", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
  assert.ok(r.paper, JSON.stringify(r.shortfall));
  assert.equal(r.paper.test_type, "part");
  assert.equal(r.paper.title, "FMGE Part 2 Test 01");
});

test("paper ids, titles and scopes", () => {
  assert.equal(T.paperIdFor("neet-pg", "grand", "all", 7), "neet-pg-grand-07");
  assert.equal(T.paperTitle("neet-pg", "grand", "all", 7), "NEET-PG Grand Test 07");
  assert.equal(T.paperIdFor("neet-pg", "topic", "anatomy|ana-bones", 1), "neet-pg-topic-anatomy-ana-bones");
  assert.ok(!/[|]/.test(T.paperIdFor("neet-pg", "topic", "anatomy|ana-bones", 1)), "ids stay URL-safe");
  assert.equal(T.paperTitle("neet-pg", "pyq", "all", 3), "NEET-PG PYQ Set 03 (recall)");
  assert.equal(T.scopeFor(tax, "fmge", "subject_mini", "anatomy"), "Anatomy");
});

test("papers validate; the report counts built vs short", () => {
  const bank = fixtureBank();
  const p = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z").paper;
  assert.deepEqual(T.validatePaper(p), []);
  const bad = { ...p, count: p.count + 1 };
  assert.ok(T.validatePaper(bad).some((e) => /count/.test(e)));
  const dup = { ...p, items: [...p.items, p.items[0]] };
  assert.ok(T.validatePaper(dup).some((e) => /duplicate/.test(e)));
  const md = T.reportMd({ papers: [p], shortfalls: [{ exam: "neet-pg", format: "grand", id: "x", reason: "No eligible questions" }], overlap: { "neet-pg": 0 }, bankCounts: null });
  assert.match(md, /1 papers, 1 shortfalls/);
  assert.match(md, /No eligible questions/);
});

test("published papers are never overwritten; numbering continues", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxt-"));
  try {
    const bank = fixtureBank();
    const p1 = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z").paper;
    assert.deepEqual(T.writePapers(dir, [p1]), { wrote: 1, kept: 0 });
    const again = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-12T00:00:00.000Z").paper;
    assert.deepEqual(T.writePapers(dir, [again]), { wrote: 0, kept: 1 }, "identical rebuilds are skipped");
    const changed = { ...p1, items: [...p1.items].reverse() };
    assert.throws(() => T.writePapers(dir, [changed]), /refusing to overwrite/);
    assert.deepEqual(T.startNumbers(dir), { "neet-pg/mini": 1 });
    T.buildIndex(dir, T.readOut(dir));
    const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    assert.equal(ix.papers.length, 1);
    assert.equal(ix.papers[0].path, "neet-pg/mini/neet-pg-mini-01.json");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("bank route serves fixed-test papers and rejects traversal", () => {
  assert.equal(bankPath({ path: ["v1", "tests", "index.json"] }), "v1/tests/index.json");
  assert.equal(bankPath({ path: ["v1", "tests", "neet-pg", "grand", "neet-pg-grand-07.json"] }), "v1/tests/neet-pg/grand/neet-pg-grand-07.json");
  assert.equal(bankPath({ path: ["v12", "tests", "fmge", "topic", "fmge-topic-medicine-med-x.json"] }), "v12/tests/fmge/topic/fmge-topic-medicine-med-x.json");
  assert.equal(bankPath({ path: ["v1", "tests", "..", "manifest.json"] }), null);
  assert.equal(bankPath({ path: ["v1", "tests", "neet-pg", "grand", "x.json", "y"] }), null);
  assert.equal(bankPath({ path: ["v1", "tests", "NEET-PG", "grand", "x.json"] }), null, "uppercase rejected");
  assert.equal(bankPath({ path: ["v1", "tests", "fmge", "subject_mini", "fmge-sub-anatomy-1.json"] }), "v1/tests/fmge/subject_mini/fmge-sub-anatomy-1.json", "subject_mini papers serve");
  assert.equal(bankPath({ path: ["v1", "tests", "fmge", "subject-mini", "fmge-sub-anatomy-1.json"] }), "v1/tests/fmge/subject-mini/fmge-sub-anatomy-1.json", "subject-mini dir serves (the published layout)");
  assert.equal(bankPath({ path: ["v1", "tests", "fmge", "subject_mini", "..", "manifest.json"] }), null, "traversal still rejected");
  assert.equal(bankPath({ path: ["overlay", "maikimg4", "pathology", "pat-breast.json"] }), "overlay/maikimg4/pathology/pat-breast.json");
  assert.equal(bankPath({ path: ["overlay", "maik", "index.json"] }), "overlay/maik/index.json");
  assert.equal(bankPath({ path: ["img", "maikimg", "i-abc12345.webp"] }), "img/maikimg/i-abc12345.webp");
  assert.equal(bankPath({ path: ["overlay", "maikimg4", "..", "x.json"] }), null);
});

// Synthetic on-disk cache: one subject with a bank module, two overlay sets (one id collides with the bank,
// one collides across sets), one overlay-only module, and empty indexes for the exam's other subjects.
function fixtureCache() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxov-"));
  const { ver } = T.appVersions();
  const exam = T.EXAMS.find((e) => e.profile === "neet-pg");
  const item = (id, q, img) => ({ id, q, o: ["opt a", "opt b", "opt c", "opt d"], a: 1, d: 2, ...(img ? { img: ["i-1"] } : {}) });
  const write = (rel, j) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); };
  const bankItems = [item("b1", "Bank stem one with enough distinct words here", true)];
  for (let i = 0; i < 25; i++) bankItems.push(item(`b-img-${i}`, `Bank image stem number ${i} with enough distinct words`, true));
  bankItems.push(item("b2", "Bank stem two with enough distinct words here", false));
  write(`${ver}/anatomy/index.json`, { topics: [{ id: "m1", count: bankItems.length }] });
  write(`${ver}/anatomy/mcq/m1.json`, { items: bankItems });
  write("overlay/setA/anatomy/m1.json", { items: [item("b2", "Overlay setA duplicate of b2 with other words", true), item("o1", "Overlay setA stem one with enough distinct words", true)] });
  write("overlay/setB/anatomy/m1.json", { items: [item("o1", "Overlay setB duplicate of o1 with other words", true), item("o2", "Overlay setB stem two with enough distinct words", true)] });
  write("overlay/setA/anatomy/m9.json", { items: [item("o9", "Overlay only module stem with enough distinct words", true)] });
  for (const sid of T.scopeSubjects(tax, exam)) {
    if (sid === "anatomy") continue;
    write(`${ver}/${sid}/index.json`, { topics: [] });
  }
  return { dir, ver, exam };
}

test("overlay items merge bank-first, sets in sorted order, overlay-only modules join", () => {
  const { dir, ver } = fixtureCache();
  try {
    const sets = { setB: { anatomy: { m1: 2 } }, setA: { anatomy: { m1: 2, m9: 1 } } }; // unsorted on purpose
    const { lists } = T.loadSubject(dir, tax, ver, "anatomy", sets);
    const m1 = lists.find((l) => l.m === "m1"), m9 = lists.find((l) => l.m === "m9");
    assert.ok(m1 && m9, "both modules present");
    const byId = {};
    for (const it of m1.items) byId[it.id] = it;
    assert.equal(byId.b2.q, "Bank stem two with enough distinct words here", "bank wins the id collision");
    assert.equal(byId.o1.q, "Overlay setA stem one with enough distinct words", "earlier set wins across sets");
    assert.deepEqual([byId.b1._ov, byId.b2._ov, byId.o1._ov, byId.o2._ov], [null, null, "setA", "setB"]);
    const ids = m1.items.map((it) => it.id);
    assert.equal(new Set(ids).size, ids.length, "no duplicate ids after merge");
    assert.deepEqual(m9.items.map((it) => [it.id, it._ov]), [["o9", "setA"]]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("image papers hold eligible image items only, deterministically, with overlay sets recorded", () => {
  const bank = fixtureBank();
  for (const l of bank) l.items.forEach((it, i) => { if (i % 2 === 0) it.img = ["i-x"]; });
  bank[0].items.forEach((it) => { it._ov = "setA"; });
  const r1 = T.buildPaper(tax, "neet-pg", "image", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
  const r2 = T.buildPaper(tax, "neet-pg", "image", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-12T00:00:00.000Z");
  assert.ok(r1.paper && r2.paper);
  assert.deepEqual(r1.paper.items, r2.paper.items, "same seed, same paper");
  assert.equal(r1.paper.count, 20);
  assert.deepEqual(T.validatePaper(r1.paper), []);
  const byId = {};
  for (const l of bank) for (const it of l.items) byId[it.id] = it;
  for (const t of r1.paper.items) {
    assert.ok(A.hasImage(byId[t[2]]), t[2] + " has no image");
    assert.equal(A.eligible(byId[t[2]], {}, "custom"), "", t[2] + " ineligible");
  }
  assert.deepEqual(r1.paper.overlays, { anatomy: ["setA"] });
});

test("subject image papers scope to one subject and share the numbering", () => {
  const plan = T.planFor("neet-pg", "image", "anatomy");
  assert.equal(plan.asmType, "custom");
  assert.deepEqual(plan.opts.subjects, ["anatomy"]);
  assert.equal(plan.opts.image, true);
  assert.equal(T.paperIdFor("neet-pg", "image", "anatomy", 6), "neet-pg-image-06");
  assert.equal(T.paperTitle("neet-pg", "image", "anatomy", 6, "Anatomy"), "NEET-PG Anatomy Image Test 06");
  assert.equal(T.scopeFor(tax, "neet-pg", "image", "anatomy"), "Image questions · Anatomy");
  const bank = fixtureBank();
  for (const l of bank) l.items.forEach((it, i) => { if (i % 2 === 0) it.img = ["i-x"]; });
  const r = T.buildPaper(tax, "neet-pg", "image", "anatomy", 6, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
  assert.ok(r.paper, JSON.stringify(r.shortfall));
  assert.equal(r.paper.title, "NEET-PG Anatomy Image Test 06");
  for (const t of r.paper.items) assert.equal(t[0], "anatomy", t[2] + " outside the subject");
  assert.deepEqual(T.validatePaper(r.paper), []);
  assert.equal(r.paper.overlays, undefined, "no overlay items, no overlays field");
});

test("requestList puts general image papers first, then one numbering for subject papers", () => {
  const { dir, ver, exam } = fixtureCache();
  try {
    const req = T.requestList(tax, dir, ver, exam, "image", {});
    assert.deepEqual(req.slice(0, 5), [["image", "all", 1], ["image", "all", 2], ["image", "all", 3], ["image", "all", 4], ["image", "all", 5]]);
    assert.deepEqual(req.slice(5), [["image", "anatomy", 6]], "anatomy holds 26+ image items, so one subject paper");
    const sub = T.requestList(tax, dir, ver, exam, "image", {}, true);
    assert.deepEqual(sub, [["image", "anatomy", 1]], "--subjects-only skips the general papers");
    const cont = T.requestList(tax, dir, ver, exam, "image", { "neet-pg/image": 5 }, true);
    assert.deepEqual(cont, [["image", "anatomy", 6]], "numbering continues past published papers");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verify accepts an id served from two modules at either triple", () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "fxvfy-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fxvfo-"));
  try {
    const { ver } = T.appVersions();
    const sids = [...new Set(T.EXAMS.flatMap((e) => T.scopeSubjects(tax, e)))];
    const write = (rel, j) => { const f = path.join(cache, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); };
    for (const sid of sids) write(`${T.bvOf(tax, ver, sid)}/${sid}/index.json`, { topics: sid === "anatomy" ? [{ id: "m1", count: 1 }, { id: "m2", count: 1 }] : [] });
    const dup = { id: "dup1", q: "Stem with enough distinct words", o: ["a", "b", "c", "d"], a: 0, d: 2 };
    write(`${ver}/anatomy/mcq/m1.json`, { items: [dup] });
    write(`${ver}/anatomy/mcq/m2.json`, { items: [dup] });
    write("pyq-index.json", { papers: [], file: "items-00000000.json" });
    const paper = (id, triple) => ({
      schema: T.PAPER_SCHEMA, id, v: 1, exam: "neet-pg", format: "image", title: id, count: 1,
      duration_sec: 70, scope: "s", seed: "s", profile: { id: "neet-pg", version: "0.0.0" }, test_type: "custom",
      blueprint: { id: "b", version: "1" }, planned: {}, actual: {}, deviations: [], sections: null,
      bank: { [ver]: ["anatomy"] }, createdAt: "2026-10-11T00:00:00.000Z", items: [triple],
    });
    T.writePapers(out, [paper("neet-pg-image-01", ["anatomy", "m2", "dup1"])]);
    T.buildIndex(out, T.readOut(out));
    assert.deepEqual(T.verify({ cache, out, log: () => {} }).errors, [], "either serving triple verifies");
    T.writePapers(out, [paper("neet-pg-image-02", ["anatomy", "m9", "dup1"])]);
    T.buildIndex(out, T.readOut(out));
    const v2 = T.verify({ cache, out, log: () => {} });
    assert.ok(v2.errors.some((e) => /moved dup1/.test(e)), v2.errors.join("\n"));
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// fetch tolerates a missing module index (live 404): the subject is skipped with a manifest entry instead of
// aborting, and its pool follows the overlays. No network: an injected stub getter serves one subject and 404s.
test("fetch skips a 404 module index with a warning, not an abort", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxfetch-"));
  try {
    const { ver, pyq } = T.appVersions();
    const item = (id) => ({ id, q: `Stem ${id} with enough distinct words here`, o: ["a", "b", "c", "d"], a: 0, d: 2 });
    const get = async (url) => {
      if (url.includes("/anatomy/index.json")) return { topics: [{ id: "m1", count: 2, group: "core" }] };
      if (url.includes("/anatomy/mcq/m1.json")) return { items: [item("a1"), item("a2")] };
      if (url.endsWith("/pyq/index.json")) return { papers: [], file: "items-00000001.json" };
      if (url.includes("/pyq/items-00000001.json")) return { items: [] };
      throw new Error("HTTP 404 for " + url);
    };
    const logs = [];
    const r = await T.fetchBank({ cache: dir, api: "http://127.0.0.1:9/bank/", jobs: 8, log: (m) => logs.push(m), _get: get });
    assert.ok(r.idxSkipped.length > 0, "some subjects skipped");
    assert.ok(!r.idxSkipped.includes("anatomy"), "served subjects are not skipped");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "skipped-index.json"), "utf8")), r.idxSkipped);
    assert.deepEqual(T.skippedSubjects(dir), r.idxSkipped);
    assert.ok(logs.some((m) => /no live module index/.test(m)), "the skip is warned: " + logs.join(" | "));
    assert.ok(fs.existsSync(path.join(dir, `${ver}/anatomy/mcq/m1.json`)), "served modules are cached");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a skipped subject loads its overlays only; an unfetched subject still throws", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxskip-"));
  try {
    const { ver } = T.appVersions();
    const write = (rel, j) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); };
    write("skipped-index.json", ["sx"]);
    write("overlay/setA/sx/m1.json", { items: [{ id: "o1", q: "Overlay only stem with enough distinct words", o: ["a", "b", "c", "d"], a: 1, d: 2 }] });
    const { lists } = T.loadSubject(dir, tax, ver, "sx", { setA: { sx: { m1: 1 } } });
    assert.equal(lists.length, 1);
    assert.deepEqual(lists[0].items.map((it) => [it.id, it._ov]), [["o1", "setA"]]);
    assert.throws(() => T.loadSubject(dir, tax, ver, "sy", {}), /not fetched: sy/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("neet-ss scope covers every ss branch, not just ss-medicine", () => {
  const exam = T.EXAMS.find((e) => e.profile === "neet-ss");
  const subs = T.scopeSubjects(tax, exam);
  assert.ok(subs.includes("ss-general-medicine"), "medical still in scope");
  assert.ok(subs.includes("ss-general-surgery"), "surgical group in scope");
  assert.ok(subs.includes("ss-neonatology") || subs.includes("ss-virology"), "seeded groups in scope");
  const medOnly = subs.filter((s) => s === "ss-general-medicine").length;
  assert.ok(subs.length > medOnly + 14, `scope spans the groups, not 15 medical subjects (got ${subs.length})`);
});

test("census warnings report zero pools instead of silently skipping", () => {
  assert.deepEqual(T.censusWarnings({ eligible: 10, image: 5, topics: 3, skipped: [], zeroSubs: [] }), []);
  const w = T.censusWarnings({ eligible: 10, image: 0, topics: 0, skipped: ["plab-x"], zeroSubs: ["plab-x", "plab-y"] });
  assert.ok(w.some((x) => /plab-x/.test(x) && /404/.test(x)), "skipped subjects named");
  assert.ok(w.some((x) => /image/.test(x)), "zero image pool reported");
  assert.ok(w.some((x) => /topic/.test(x)), "zero topics reported");
  assert.ok(w.some((x) => /2 subjects with zero/.test(x)), "zero-pool subjects reported");
  assert.ok(T.censusWarnings({ eligible: 0, image: 0, topics: 0, skipped: [], zeroSubs: ["a"] }).some((x) => /no eligible questions/.test(x)));
});

test("auditCoverage flags eligible exam/formats with neither papers nor shortfalls", () => {
  const census = { "neet-pg": { eligible: 100, image: 5, topics: 3 } };
  const covered = T.FORMATS.filter((f) => f !== "image").map((f) => ({ exam: "neet-pg", format: f }));
  const gaps = T.auditCoverage(covered, [], census);
  assert.equal(gaps.length, 1);
  assert.match(gaps[0], /neet-pg\/image/);
  assert.deepEqual(T.auditCoverage(covered, [{ exam: "neet-pg", format: "image", id: "x", reason: "r" }], census), [], "a shortfall is reported, not silent");
  assert.deepEqual(T.auditCoverage([], [], { "neet-pg": { eligible: 0, image: 0, topics: 0 } }), [], "empty pools are not gaps");
});

test("subject_mini papers live at the route-legal subject-mini dir", () => {
  assert.equal(T.formatDir("subject_mini"), "subject-mini");
  assert.equal(T.formatDir("grand"), "grand");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxdir-"));
  try {
    const bank = fixtureBank();
    const p = T.buildPaper(tax, "neet-pg", "subject_mini", "anatomy", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z").paper;
    T.writePapers(dir, [p]);
    T.buildIndex(dir, T.readOut(dir));
    const ix = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    assert.equal(ix.papers[0].path, "neet-pg/subject-mini/neet-pg-sub-anatomy-1.json");
    assert.ok(fs.existsSync(path.join(dir, "neet-pg", "subject-mini", "neet-pg-sub-anatomy-1.json")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("requestList never rebuilds published fixed-key papers", () => {
  const exam = T.EXAMS.find((e) => e.profile === "neet-pg");
  const { ver } = T.appVersions();
  const have = new Set(["neet-pg-sub-anatomy-1"]);
  const req = T.requestList(tax, null, ver, exam, "subject_mini", {}, false, have);
  assert.ok(!req.some(([f, k, n]) => f === "subject_mini" && k === "anatomy" && n === 1), "published key skipped");
  assert.ok(req.some(([f, k, n]) => f === "subject_mini" && k === "anatomy" && n === 2), "sibling key still built");
});

test("buildPaper assembles with the concept-diverse selector", () => {
  const bank = fixtureBank();
  const orig = A.assemble;
  let got = null;
  A.assemble = (...a) => { got = a[2]; return orig(...a); };
  try {
    const r = T.buildPaper(tax, "neet-pg", "mini", "all", 1, bank, BANK_VERS, {}, {}, "2026-10-11T00:00:00.000Z");
    assert.ok(r.paper, JSON.stringify(r.shortfall));
    assert.equal(got && got.diverse, true, "assembler gets diverse:true");
  } finally {
    A.assemble = orig;
  }
});

// The Tests tab resolves a paper's triples through the bank files plus the paper's overlay sets: bank, overlay
// and withdrawn ids in one paper, and no overlay fetch at all for papers without the overlays field.
test("Tests tab resolves overlay items in fixed papers", async () => {
  const src = fs.readFileSync(new URL("../prep-tests.js", import.meta.url), "utf8");
  const load = () => {
    const G = { location: { search: "" }, localStorage: { getItem: () => null }, PREP_ASSESS: A };
    new Function("window", src)(G);
    return G.PREP_TESTS;
  };
  const run = async (paper) => {
    const T2 = load();
    const hits = [];
    const files = {
      ["/api/prep/bank/v1/tests/neet-pg/image/p1.json"]: paper,
      ["/api/prep/bank/v5/anatomy/mcq/m1.json"]: { items: [{ id: "b1", q: "Bank question one", o: ["a", "b", "c", "d"], a: 0 }] },
      ["/api/prep/bank/overlay/setA/anatomy/m1.json"]: { items: [{ id: "o1", q: "Overlay question one", o: ["a", "b", "c", "d"], a: 1 }] },
    };
    const H = {
      bankApi: "/api/prep/bank/",
      getJSON: (u) => { hits.push(u); return u in files ? Promise.resolve(files[u]) : Promise.reject(new Error("404 " + u)); },
      hidden: () => ({}), stack: () => ({ push: () => {}, pop: () => {} }),
      loadingScreen: () => {}, toast: () => {}, rerender: () => {}, push: () => {},
    };
    T2._P.fx = [{ id: "p1", exam: "neet-pg", path: "neet-pg/image/p1.json" }];
    T2.act("t2-fixed", { getAttribute: (k) => (k === "data-fx" ? "p1" : null) }, H);
    for (let i = 0; i < 200 && !T2._P.pick; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(T2._P.pick, "paper opened to the pre-screen");
    return { items: T2._P.pick.asm.items, missing: T2._P.pick.fixedMissing, hits };
  };
  const base = {
    id: "p1", exam: "neet-pg", test_type: "custom", count: 3, duration_sec: 210, deviations: [], planned: {}, actual: {},
    seed: "s", bank: { v5: ["anatomy"] }, items: [["anatomy", "m1", "b1"], ["anatomy", "m1", "o1"], ["anatomy", "m1", "gone"]],
  };
  const withOv = await run({ ...base, overlays: { anatomy: ["setA"] } });
  assert.equal(withOv.items[0].q, "Bank question one");
  assert.equal(withOv.items[1].q, "Overlay question one");
  assert.equal(withOv.items[1]._s, "anatomy");
  assert.equal(withOv.items[2]._gone, true);
  assert.equal(withOv.missing, 1);
  assert.ok(withOv.hits.some((u) => u.indexOf("/overlay/setA/anatomy/m1.json") >= 0), "overlay file fetched");
  const withoutOv = await run(base);
  assert.equal(withoutOv.items[1]._gone, true, "overlay id without the overlays field stays a placeholder");
  assert.equal(withoutOv.missing, 2);
  assert.ok(!withoutOv.hits.some((u) => u.indexOf("/overlay/") >= 0), "no overlay fetch for plain papers");
});
