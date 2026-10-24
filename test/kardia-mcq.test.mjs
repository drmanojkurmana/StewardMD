import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MCQ = join(ROOT, "kardia", "decks", "mcq");

const index = JSON.parse(readFileSync(join(MCQ, "index.json"), "utf8"));
const topicFiles = readdirSync(MCQ).filter(function (f) { return f !== "index.json" && f.endsWith(".json"); });
const decks = topicFiles.map(function (f) {
  return { file: f, doc: JSON.parse(readFileSync(join(MCQ, f), "utf8")) };
});

const all = decks.flatMap(function (d) { return d.doc.items; });

const DASH = /[-\u2013\u2014]/;
const EMDASH = /[\u2010\u2013\u2014]/;
const AMERICAN = /\b(esophagus|esophageal|hemorrhage|hemorrhagic|anemia|anesthesia|color|colors|center|centers|behavior|behaviors|optimiz\w*|visualiz\w*|standardiz\w*|fetal|tumors?|edema)\b/i;
const GUIDE = /ASE|BSE|ACEP|ESC|EACVI|SCA|WINFOCUS/;

test("index carries licence, citation and topics with counts and files", function () {
  assert.ok(index.licence || index.license, "index needs a licence");
  assert.ok(index.citation, "index needs a citation");
  assert.ok(Array.isArray(index.topics) && index.topics.length > 0, "index needs topics");
  for (const t of index.topics) {
    assert.ok(typeof t.id === "string" && /^[a-z0-9-]+$/.test(t.id), "bad topic id " + t.id);
    assert.ok(t.title && t.title.en, "topic needs a title " + t.id);
    assert.ok(/^mcq\/[a-z0-9-]+\.json$/.test(t.file), "bad topic file " + t.id);
    assert.ok(typeof t.count === "number" && t.count > 0, "bad topic count " + t.id);
  }
});

test("deck files match the index and the total is about 300", function () {
  const byId = {};
  for (const t of index.topics) { byId[t.id] = t; }
  let total = 0;
  for (const d of decks) {
    const t = byId[d.doc.topic];
    assert.ok(t, "deck file with no index entry: " + d.file);
    assert.equal(d.file, t.file.split("/").pop(), "file name must match the index for " + d.doc.topic);
    assert.equal(d.doc.items.length, t.count, "count mismatch for " + d.doc.topic);
    total += d.doc.items.length;
  }
  assert.equal(decks.length, index.topics.length, "every index topic needs a file");
  assert.equal(total, index.counts.total, "index total must equal the sum of topic counts");
  assert.ok(total >= 280 && total <= 340, "bank should hold about 300 items, got " + total);
});

test("every item parses with 4 options, a valid key, a topic and a level", function () {
  const seen = new Set();
  for (const d of decks) {
    for (const it of d.doc.items) {
      assert.ok(typeof it.id === "string" && it.id.length > 0, "item needs an id");
      assert.ok(!seen.has(it.id), "duplicate id " + it.id);
      seen.add(it.id);
      assert.ok(typeof it.q === "string" && it.q.trim().length > 0, it.id + " needs a stem");
      assert.ok(Array.isArray(it.o) && it.o.length === 4, it.id + " needs 4 options");
      for (const o of it.o) {
        assert.ok(typeof o === "string" && o.trim().length > 0, it.id + " has an empty option");
      }
      const lower = it.o.map(function (o) { return o.toLowerCase().trim(); });
      assert.equal(new Set(lower).size, 4, it.id + " options must be distinct");
      assert.ok(Number.isInteger(it.a) && it.a >= 0 && it.a <= 3, it.id + " needs a in 0..3");
      assert.equal(it.t, d.doc.topic, it.id + " topic must match its file");
      assert.ok(Number.isInteger(it.d) && it.d >= 1 && it.d <= 5, it.id + " needs d in 1..5");
    }
  }
});

test("every explanation is non empty and names its guideline", function () {
  for (const it of all) {
    assert.ok(typeof it.exp === "string" && it.exp.trim().length > 0, it.id + " needs an explanation");
    assert.ok(GUIDE.test(it.exp), it.id + " explanation must name its guideline");
  }
});

test("no dash characters in the bank prose", function () {
  for (const d of decks) {
    const raw = readFileSync(join(MCQ, d.file), "utf8");
    assert.ok(!DASH.test(raw), "dash found in " + d.file);
    for (const it of d.doc.items) {
      for (const s of [it.q, it.exp].concat(it.o)) {
        assert.ok(!DASH.test(s), it.id + " carries a dash");
      }
    }
  }
  const rawIndex = readFileSync(join(MCQ, "index.json"), "utf8");
  assert.ok(!EMDASH.test(rawIndex), "em or en dash in index.json");
});

test("british spelling in the bank prose", function () {
  for (const it of all) {
    for (const s of [it.q, it.exp].concat(it.o)) {
      assert.ok(!AMERICAN.test(s), it.id + " uses american spelling: " + s.slice(0, 80));
    }
  }
});

test("levels cover MBBS and resident and fellow in every topic", function () {
  for (const d of decks) {
    const levels = new Set(d.doc.items.map(function (it) { return it.d; }));
    assert.ok(levels.has(1) && levels.has(2), d.doc.topic + " needs d1 and d2 for MBBS");
    assert.ok(levels.has(3) || levels.has(4) || levels.has(5), d.doc.topic + " needs d3 or higher");
  }
});
