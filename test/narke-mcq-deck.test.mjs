// Narkē question bank: the shipped deck (narke/decks/mcq/) built by tools/tokos-build-mcq.mjs --host narke.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { useHost, tableTopic, keywordTopic, SUBTOPICS, FLAG_LEGEND } from "../tools/tokos-build-mcq.mjs";
import { buildFromDir } from "../tools/tokos-build-mcq-search.mjs";

useHost("narke");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, "..", "narke", "decks", "mcq");
const index = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8"));
const files = Object.fromEntries(index.topics.map((t) => [t.id, JSON.parse(readFileSync(path.join(DIR, path.basename(t.file)), "utf8"))]));
const RAW = readdirSync(DIR).map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");
const deck = { ...index, items: index.topics.flatMap((t) => files[t.id].items) };
const CONTRACT = ["airway", "iv-agents", "inhalational", "nmb", "local-regional", "monitoring-equipment", "preop", "fluids-blood", "pain",
  "icu-ventilation", "cpr", "special-populations", "basic-science", "general"];
const DEVANAGARI = /[ऀ-ॿ]/;

test("header: source, MIT licence text, pinned commit, subject", () => {
  assert.equal(deck.id, "mcq");
  assert.equal(deck.source, "medmcqa");
  assert.equal(deck.subject, "Anaesthesia");
  assert.equal(deck.licence, "MIT");
  assert.match(deck.licenceText, /^MIT License/);
  assert.match(deck.sourceCommit, /^[0-9a-f]{40}$/);
  assert.match(deck.sourceCommitNote, /apache-2\.0/i);
  assert.match(deck.modifications, /Anaesthesia/);
  assert.match(deck.modifications, /Narkē subtopics/);
  assert.ok(!/Gynaecology/.test(deck.modifications));
});

test("split deck: 14 topic files + index + search, counts agree, 3206 read, none lost", () => {
  assert.deepEqual(readdirSync(DIR).sort(), ["index.json", "search.json", ...CONTRACT.map((id) => id + ".json")].sort());
  assert.equal(deck.stats.build.read, 3206); // train 3172 + validation 34
  assert.equal(deck.items.length, index.counts.total);
  assert.equal(deck.stats.build.afterDedupe, index.counts.total);
  assert.equal(deck.stats.build.afterDrops - deck.stats.build.dup.removed, index.counts.total);
  assert.ok(index.counts.total > 2500 && index.counts.total <= 3206);
  assert.equal(index.counts.d1 + index.counts.d2 + index.counts.d3, index.counts.total);
  let sum = 0;
  for (const t of index.topics) {
    assert.equal(t.file, `mcq/${t.id}.json`);
    assert.deepEqual(Object.keys(files[t.id]).sort(), ["items", "topic"]);
    assert.equal(files[t.id].items.length, t.count, t.id);
    assert.ok(files[t.id].items.every((i) => i.t === t.id), t.id);
    sum += t.count;
  }
  assert.equal(sum, index.counts.total);
});

test("topics: exactly the 14 ids in order, English and Hindi titles, no dash", () => {
  assert.deepEqual(index.topics.map((t) => t.id), CONTRACT);
  assert.deepEqual(SUBTOPICS.map((t) => t.id), CONTRACT);
  for (const t of index.topics) {
    assert.ok(t.title.en && t.title.hi, t.id);
    assert.match(t.title.hi, DEVANAGARI, t.id);
    for (const s of [t.title.en, t.title.hi]) assert.ok(!/[–—]/.test(s), t.id);
  }
});

test("items: valid shape, unique ids, four distinct options, key in range, difficulty 1..3", () => {
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
    assert.ok(CONTRACT.includes(it.t), it.id);
    assert.ok([1, 2, 3].includes(it.d), it.id);
    if (it.flags !== undefined) assert.ok(Array.isArray(it.flags) && it.flags.length > 0 && it.flags.every((f) => legend.has(f)), it.id);
  }
});

test("every topic is populated, `general` stays under 15%, all three levels exist", () => {
  for (const id of CONTRACT) assert.ok(deck.items.filter((i) => i.t === id).length >= 40, id);
  assert.ok(files.general.items.length < 0.15 * deck.items.length, "general share");
  for (const d of [1, 2, 3]) assert.ok(deck.items.filter((i) => i.d === d).length >= 400, "level " + d);
});

test("text is clean: no HTML, entities, em or en dash", () => {
  for (const t of deck.items.flatMap((i) => [i.q, ...i.o, i.exp])) {
    assert.ok(!/<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i.test(t), "html in " + t.slice(0, 60));
    assert.ok(!/&(amp|lt|gt|quot|nbsp|#\d+);/.test(t), "entity in " + t.slice(0, 60));
  }
  assert.ok(!/[–—]/.test(RAW), "dash in deck files");
});

test("stats agree with the items, every item mapped exactly once", () => {
  const s = deck.stats;
  assert.equal(s.total, deck.items.length);
  for (const id of CONTRACT) assert.equal(s.byTopic[id], deck.items.filter((i) => i.t === id).length, id);
  for (const d of [1, 2, 3]) assert.equal(s.byLevel[d], deck.items.filter((i) => i.d === d).length, "d" + d);
  assert.equal(s.flagged, deck.items.filter((i) => i.flags).length);
  for (const id of CONTRACT) {
    const b = s.build.bySubtopic[id];
    assert.equal(b.table + b.keyword + b.fallback, s.byTopic[id], id);
  }
  assert.equal(s.build.bySubtopic.general.table + s.build.bySubtopic.general.keyword, 0);
});

test("search index is in step with the topic files", () => {
  const built = buildFromDir(DIR);
  const shipped = JSON.parse(readFileSync(path.join(DIR, "search.json"), "utf8"));
  assert.deepEqual(shipped, built);
  assert.equal(shipped.n, deck.items.length);
  assert.deepEqual(shipped.topics, CONTRACT);
  assert.deepEqual(shipped.ids, deck.items.map((i) => i.id));
});

test("mapping: topic table, keyword rules, `general` fallback", () => {
  assert.equal(tableTopic("Neuromuscular Blocker"), "nmb");
  assert.equal(tableTopic("Preoperative assessment and monitoring in anaesthesia"), "preop");
  assert.equal(tableTopic("Anaesthetic equipments"), "monitoring-equipment");
  assert.equal(tableTopic("Airway"), "airway");
  assert.equal(tableTopic("AIIMS 2019"), null);
  assert.equal(tableTopic("All India exam"), null);
  const k = (q, key = "", exp = "", topic = "") => keywordTopic({ q, key, exp, topic });
  assert.equal(k("Induction agent of choice in hypovolemic shock", "Ketamine").id, "iv-agents");
  assert.equal(k("MAC of sevoflurane is", "2%").id, "inhalational");
  assert.equal(k("Antidote of morphine", "Naloxone").id, "pain");
  assert.equal(k("Chest compression rate in adult CPR is", "100-120/min").id, "cpr");
  assert.deepEqual(k("Surgical anaesthesia is", "Stage III"), { id: "general", fallback: true });
});
