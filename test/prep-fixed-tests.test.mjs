/* Pre-built common tests (tools/prep-fixed-tests.mjs, owner 2026-10-11).
 * What must hold:
 *  - one paper is one prep-assess.js assemble() call with a fixed seed: the same seed, bank and usage give the
 *    same paper (determinism), with no duplicate id or stem inside it;
 *  - the blueprint is honoured and every deviation recorded (official quotas shrink with the reason, never borrow);
 *  - a refused paper is a recorded shortfall, never padded with unrelated questions;
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
});
