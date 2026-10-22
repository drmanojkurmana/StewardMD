import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const N = require(path.join(root, "prep-nucleus360.js"));
const FLOOR = await import(path.join(root, "tools", "prep-nucleus360-floor.mjs"));

const tax = JSON.parse(fs.readFileSync(path.join(root, "prep", "taxonomy.json"), "utf8"));
const doc = JSON.parse(fs.readFileSync(path.join(root, "prep", "nucleus360", "topics.json"), "utf8"));
const topics = doc.topics || [];

function allModules() {
  const out = [];
  for (const b of tax.branches) {
    for (const s of b.subjects || []) {
      for (const sec of s.sections || []) {
        for (const m of sec.modules || []) out.push({ sid: s.id, mid: m.id });
      }
    }
  }
  return out;
}
function hubs() {
  const h = {};
  for (const t of topics) {
    for (const s of t.subjects || (t.subject ? [t.subject] : [])) h[s] = (h[s] || 0) + 1;
  }
  return h;
}

test("owner-first topic pancreatic-adenocarcinoma is topic 1", () => {
  assert.equal(topics[0].id, "pancreatic-adenocarcinoma");
});

test("every taxonomy subject with modules has a non-empty hub (10-40 topics when modules >= 10)", () => {
  const h = hubs();
  const counts = {};
  for (const b of tax.branches) {
    for (const s of b.subjects || []) {
      let n = 0;
      for (const sec of s.sections || []) n += (sec.modules || []).length;
      counts[s.id] = n;
    }
  }
  for (const [sid, n] of Object.entries(counts)) {
    if (!n) continue;
    const got = h[sid] || 0;
    assert.ok(got >= 1, sid + " hub is empty");
    if (n >= 10) assert.ok(got >= 10 && got <= 40, sid + " hub has " + got + " topics, want 10-40");
  }
});

test("every taxonomy module belongs to at least one topic (floor map complete)", () => {
  const entries = allModules().map((e) => ({ mid: e.mid, sid: e.sid }));
  const { uncovered } = FLOOR.buildFloorMap(entries, { topics });
  // Mixed recall papers span many topics: no honest single topic, so no Nucleus360 fallback link.
  const MIXED = new Set(["son-iniss-recalls"]);
  assert.deepEqual(uncovered.filter((m) => !MIXED.has(m)), []);
});

test("a shared topic is listed in every subject hub it belongs to", () => {
  const shared = topics.filter((t) => (t.subjects || []).length > 1);
  assert.ok(shared.length >= 1, "want at least one shared topic");
  for (const t of topics) {
    for (const s of t.subjects || (t.subject ? [t.subject] : [])) {
      const rows = N.topicsFor(topics, "", s);
      assert.ok(rows.some((r) => r.id === t.id), t.id + " missing from " + s + " hub");
    }
  }
});

test("hub rows order by yield score within a subject", () => {
  const h = hubs();
  const sid = Object.keys(h).sort((a, b) => h[b] - h[a])[0];
  const rows = N.topicsFor(topics, "", sid);
  assert.ok(rows.length >= 1);
  for (let i = 1; i < rows.length; i++) {
    assert.ok((rows[i - 1].score || 0) >= (rows[i].score || 0), "hub not yield-ordered in " + sid);
  }
});

test("per-topic counts add up: matched + unassigned == union n", () => {
  for (const t of topics) {
    let sum = 0;
    for (const mm of Object.values(t.match || {})) sum += mm.n;
    assert.equal(sum + (t.unassigned || 0), t.n, t.id + ": match + unassigned != n");
    assert.ok(t.fetched >= t.n, t.id + ": fetched < deduped n");
  }
});

test("hub subject select lists every home subject with display names and counts", () => {
  const subs = N.hubSubjects(doc);
  assert.equal(subs.length, Object.keys(hubs()).length);
  assert.ok(subs.every((s) => s.name && s.name !== s.id && s.n >= 1), "every hub subject needs a display name and >= 1 topic");
  const names = subs.map((s) => s.name);
  assert.deepEqual([...names].sort((a, b) => a.localeCompare(b)), names);
  assert.equal(N.subjName(doc, "ss-medical-oncology"), "Medical Oncology");
  assert.equal(N.subjName(doc, "no-such-subject"), "no-such-subject");
});

test("topics.json carries no question text (outlines, ids and counts only)", () => {
  const raw = fs.readFileSync(path.join(root, "prep", "nucleus360", "topics.json"), "utf8");
  assert.ok(!raw.includes('"exp"'), "question explanations must not ship in git");
  for (const t of topics.slice(0, 50)) {
    for (const mm of Object.values(t.match || {})) {
      for (const id of mm.items || []) assert.equal(typeof id, "string");
    }
  }
});
