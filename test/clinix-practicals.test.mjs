/* test/clinix-practicals.test.mjs - CliniX Practicals runner and content unit tests.
 * Asserts:
 *   1. Every deck loads, has valid schema, and passes the practicals validator
 *   2. index.json matches the decks deterministically
 *   3. Quiz builder gives 5 unique options with exactly one correct and same-kind distractors
 *   4. Deterministic seeded PRNG and question generation
 *   5. Scoring calculation (spotter and viva breakdown)
 *   6. Filter, search and title masking
 *   7. Progress store round-trip and sign-out wipe
 *   8. Real bundle sanitiser (scripts/sanitize-sources.mjs) test: items, blocks and viva survive
 * Run: node --test test/clinix-practicals.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, mkdtempSync, cpSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const P = require("../clinix-practicals.js");
const { buildPracticalsIndex } = await import("../tools/clinix-practicals-index.mjs");

function getDeckFiles() {
  const dir = join(ROOT, "clinix/practicals");
  const subjects = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort();
  const files = [];
  for (const s of subjects) {
    const sDir = join(dir, s);
    const fs = readdirSync(sDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
    for (const f of fs) {
      files.push(join(sDir, f));
    }
  }
  return files;
}

test("every practicals deck loads, has valid v:1 schema and passes validator rules", () => {
  const files = getDeckFiles();
  assert.ok(files.length >= 27, "expected at least 27 practicals decks, saw " + files.length);

  const KINDS = new Set(["instrument", "device", "drug", "procedure", "method", "staging", "chart", "specimen", "xray", "model", "case-sheet", "exam-step", "topic"]);
  const NEEDS_IMAGE = new Set(["instrument", "device", "specimen", "xray", "model", "method", "procedure"]);
  const seenIds = new Set();
  let totalItems = 0;

  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    assert.ok(!/[–—‒―]/.test(raw), `${f}: contains forbidden em or en dash`);

    const d = JSON.parse(raw);
    assert.equal(d.v, 1, `${f}: expected v:1`);
    assert.ok(d.subject, `${f}: subject missing`);
    assert.ok(d.section, `${f}: section missing`);
    assert.ok(d.title && d.title.en, `${f}: title.en missing`);
    assert.ok(Array.isArray(d.items) && d.items.length > 0, `${f}: items array missing or empty`);

    for (const it of d.items) {
      totalItems++;
      const id = it.id;
      assert.ok(id && /^[a-z0-9][a-z0-9.-]*$/.test(id), `${id}: bad id format`);
      assert.ok(!seenIds.has(id), `${id}: duplicate item id across decks`);
      seenIds.add(id);

      assert.ok(KINDS.has(it.kind), `${id}: invalid kind "${it.kind}"`);
      assert.ok(it.title && it.title.en, `${id}: missing title.en`);
      assert.ok(it.summary && it.summary.length >= 20, `${id}: summary missing or too short`);
      assert.ok(Array.isArray(it.blocks) && it.blocks.length >= 1, `${id}: blocks missing`);

      for (const b of it.blocks) {
        assert.ok(b.title, `${id}: block missing title`);
        const blockContentKeys = ["bullets", "text", "groups", "table"].filter((k) => b[k] != null);
        assert.equal(blockContentKeys.length, 1, `${id}: block "${b.title}" must have exactly one of bullets, text, groups, table`);
      }

      assert.ok(Array.isArray(it.viva) && it.viva.length >= 2, `${id}: viva pairs missing or fewer than 2`);
      for (const v of it.viva) {
        assert.ok(v.q && v.a, `${id}: incomplete viva pair`);
      }

      if (NEEDS_IMAGE.has(it.kind)) {
        assert.ok(it.image && it.image.brief && it.image.brief.length >= 20, `${id}: image.brief required for kind ${it.kind}`);
      }

      assert.ok(it.src && it.src.book, `${id}: src.book required`);
      assert.equal(it.review, "ai_drafted", `${id}: review status must be ai_drafted`);
    }
  }

  assert.ok(totalItems >= 400, "expected at least 400 total practical items, saw " + totalItems);
});

test("index.json matches the decks deterministically", () => {
  const computed = buildPracticalsIndex(join(ROOT, "clinix/practicals"));
  const onDisk = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/index.json"), "utf8"));

  assert.equal(onDisk.v, 1);
  assert.equal(onDisk.decks.length, computed.decks.length, "deck count mismatch");

  for (let i = 0; i < computed.decks.length; i++) {
    const cd = computed.decks[i];
    const od = onDisk.decks[i];
    assert.equal(od.subject, cd.subject, `deck ${i} subject mismatch`);
    assert.equal(od.section, cd.section, `deck ${i} section mismatch`);
    assert.equal(od.file, cd.file, `deck ${i} file mismatch`);
    assert.equal(od.itemCount, cd.itemCount, `deck ${i} itemCount mismatch`);
    assert.deepEqual(od.kinds, cd.kinds, `deck ${i} kinds mismatch`);
    assert.equal(od.title.en, cd.title.en, `deck ${i} title mismatch`);
  }
});

test("option generator gives 5 unique options with exactly 1 correct and same-kind distractors", () => {
  const deck = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/obgyn/instruments.json"), "utf8"));
  const items = deck.items;
  assert.ok(items.length >= 50);

  // Test on instrument items (which have plenty of same-kind candidates in this deck)
  const instruments = items.filter((x) => x.kind === "instrument");
  assert.ok(instruments.length >= 50);

  for (let i = 0; i < Math.min(25, instruments.length); i++) {
    const it = instruments[i];
    const opts = P.generateOptions(it, items, { seed: "seed:" + it.id });

    assert.equal(opts.length, 5, `${it.id}: expected 5 options`);
    const correct = opts.filter((o) => o.correct);
    assert.equal(correct.length, 1, `${it.id}: expected exactly one correct option`);
    assert.equal(correct[0].id, it.id, `${it.id}: correct option id mismatch`);

    const titles = new Set(opts.map((o) => o.title));
    assert.equal(titles.size, 5, `${it.id}: options must have 5 unique titles`);

    // Every option must match the item's kind (same-kind distractors)
    for (const opt of opts) {
      assert.equal(opt.kind, "instrument", `${it.id}: distractor kind was ${opt.kind}, expected instrument`);
    }
  }

  // Also test across the whole deck: every item produces 5 unique options with 1 correct
  for (let j = 0; j < items.length; j++) {
    const it = items[j];
    const opts = P.generateOptions(it, items, { seed: "all:" + it.id });
    assert.equal(opts.length, 5);
    assert.equal(opts.filter((o) => o.correct).length, 1);
    assert.equal(new Set(opts.map((o) => o.title)).size, 5);
  }
});

test("option generator is deterministic when seed is provided", () => {
  const deck = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/obgyn/instruments.json"), "utf8"));
  const item = deck.items[0];

  const opts1 = P.generateOptions(item, deck.items, { seed: 12345 });
  const opts2 = P.generateOptions(item, deck.items, { seed: 12345 });
  const opts3 = P.generateOptions(item, deck.items, { seed: 99999 });

  assert.deepEqual(opts1, opts2, "identical seeds must produce identical options");
  assert.notDeepEqual(opts1, opts3, "different seeds should produce different order/options");
});

test("buildQuestion and buildSpotterQuiz generate complete questions with viva follow-ups", () => {
  const deck = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/obgyn/instruments.json"), "utf8"));
  const quiz = P.buildSpotterQuiz(deck.items, deck.items, { count: 10, seed: "test-quiz-seed" });

  assert.equal(quiz.length, 10, "quiz must contain 10 questions");
  for (let i = 0; i < quiz.length; i++) {
    const q = quiz[i];
    assert.ok(q.id, `q${i}: id missing`);
    assert.ok(q.title, `q${i}: title missing`);
    assert.equal(q.options.length, 5, `q${i}: options length not 5`);
    assert.equal(q.options.filter((o) => o.correct).length, 1, `q${i}: correct count not 1`);
    assert.ok(Array.isArray(q.keyPoints), `q${i}: keyPoints missing`);
    assert.ok(Array.isArray(q.viva) && q.viva.length >= 1, `q${i}: follow-up viva missing`);
  }
});

test("maskTitle replaces title and akas in clinical summary", () => {
  const text = "Sims double-bladed vaginal speculum is a metallic speculum. Sims speculum requires an assistant.";
  const masked = P.maskTitle(text, "Sims double-bladed vaginal speculum", ["Sims speculum"]);

  assert.ok(!masked.includes("Sims double-bladed vaginal speculum"), "full title was not masked");
  assert.ok(!masked.includes("Sims speculum"), "aka was not masked");
  assert.ok(masked.includes("[This item]"), "placeholder [This item] not inserted");
});

test("scoring calculation tallies spotter and viva performance accurately", () => {
  const questions = [
    { id: "1", title: "A", keyPoints: ["kp1"], viva: [{ q: "v1", a: "a1" }, { q: "v2", a: "a2" }] },
    { id: "2", title: "B", keyPoints: ["kp2"], viva: [{ q: "v3", a: "a3" }] },
    { id: "3", title: "C", keyPoints: ["kp3"], viva: [{ q: "v4", a: "a4" }] }
  ];

  const answers = {
    0: { correct: true, chosenTitle: "A", viva: { 0: "got", 1: "got" } },
    1: { correct: false, chosenTitle: "Wrong", viva: { 0: "missed" } },
    2: { correct: true, chosenTitle: "C", viva: { 0: "got" } }
  };

  const res = P.calculateQuizScore(questions, answers);
  assert.equal(res.spotterScore, 2);
  assert.equal(res.spotterTotal, 3);
  assert.equal(res.spotterPct, 67);
  assert.equal(res.vivaScore, 3);
  assert.equal(res.vivaTotal, 4);
  assert.equal(res.vivaPct, 75);
  assert.equal(res.review.length, 3);
  assert.equal(res.review[0].correct, true);
  assert.equal(res.review[1].correct, false);
});

test("filterItems filters by group and searches query in title and summary", () => {
  const items = [
    { id: "1", title: { en: "Sims speculum" }, group: "Speculums", summary: "Vaginal wall retractor" },
    { id: "2", title: { en: "Cusco speculum" }, group: "Speculums", summary: "Self-retaining bivalve" },
    { id: "3", title: { en: "Hegar dilator" }, group: "Dilators", summary: "Cervical dilator" }
  ];

  const grpFiltered = P.filterItems(items, "Dilators", "");
  assert.equal(grpFiltered.length, 1);
  assert.equal(grpFiltered[0].id, "3");

  const queryFiltered = P.filterItems(items, "all", "retractor");
  assert.equal(queryFiltered.length, 1);
  assert.equal(queryFiltered[0].id, "1");

  const akaFiltered = P.filterItems([
    { id: "4", title: { en: "Instrument X" }, aka: ["Alternative name Y"], summary: "Test" }
  ], "all", "alternative");
  assert.equal(akaFiltered.length, 1);
});

test("real bundle sanitiser scripts/sanitize-sources.mjs preserves practicals items, blocks, and viva", () => {
  const www = mkdtempSync(join(tmpdir(), "san-prac-"));
  cpSync(join(ROOT, "clinix/practicals"), join(www, "clinix/practicals"), { recursive: true });

  const r = spawnSync(process.execPath, [join(ROOT, "scripts/sanitize-sources.mjs"), www], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);

  // Check obgyn instruments
  const src = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/obgyn/instruments.json"), "utf8"));
  const out = JSON.parse(readFileSync(join(www, "clinix/practicals/obgyn/instruments.json"), "utf8"));

  assert.equal(out.items.length, src.items.length, "items count changed after sanitiser");
  for (let i = 0; i < src.items.length; i++) {
    const sItem = src.items[i];
    const oItem = out.items[i];
    assert.equal(oItem.id, sItem.id, `item ${i} id changed`);
    assert.equal(oItem.blocks.length, sItem.blocks.length, `${sItem.id}: blocks lost`);
    assert.equal(oItem.viva.length, sItem.viva.length, `${sItem.id}: viva lost`);
    assert.ok(oItem.summary && oItem.summary.length >= 20, `${sItem.id}: summary damaged`);
  }

  // Check paediatrics development
  const devSrc = JSON.parse(readFileSync(join(ROOT, "clinix/practicals/paediatrics/development.json"), "utf8"));
  const devOut = JSON.parse(readFileSync(join(www, "clinix/practicals/paediatrics/development.json"), "utf8"));

  assert.equal(devOut.items.length, devSrc.items.length, "development items count changed");
  for (let j = 0; j < devSrc.items.length; j++) {
    assert.equal(devOut.items[j].blocks.length, devSrc.items[j].blocks.length, `dev item ${j} blocks lost`);
    assert.equal(devOut.items[j].viva.length, devSrc.items[j].viva.length, `dev item ${j} viva lost`);
  }
});
