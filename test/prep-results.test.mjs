/* Richer Tests 2 results (prep-assess.js streaks/summary, prep/assess/schemas/summary.schema.json).
 * What must hold:
 *  - streaks(): best run right, longest run wrong, recovery rate from the attempt order; skipped
 *    questions break both runs and never count; empty and all-skipped attempts give zeros;
 *  - summary(): counts, short capped arrays, pattern runs, small flag under 5 questions; JSON under
 *    4096 bytes even for a 200-question grand test; no rank/percentile/readiness/prediction fields;
 *  - time inputs pass through (avg_ms, secs, pace; -1 when unknown);
 *  - gaps come from nextActions(): weakest topics with 2+ missed, at most 3.
 * node --test test/prep-results.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const A = require("../prep-assess.js");
const ROOT = new URL("../", import.meta.url);

const it = (correct) => ({ item_id: "q", chosen: correct == null ? null : 0, correct: correct });

test("streaks: best run, longest slip, recovery rate", () => {
  // R R W R S W W R W: best 2, slip 2, recoveries: W@2->R, W@5->W, W@6->R, W@8->none = 2 of 3
  const s = A.streaks([it(true), it(true), it(false), it(true), it(null), it(false), it(false), it(true), it(false)]);
  assert.deepEqual(s, { best: 2, slip: 2, rec_n: 2, rec_d: 3 });
});

test("streaks: skips break runs and never count", () => {
  assert.deepEqual(A.streaks([it(true), it(null), it(true)]), { best: 1, slip: 0, rec_n: 0, rec_d: 0 });
  assert.deepEqual(A.streaks([it(false), it(null), it(false)]), { best: 0, slip: 1, rec_n: 0, rec_d: 1 });
  assert.deepEqual(A.streaks([it(false), it(null), it(true)]), { best: 1, slip: 1, rec_n: 1, rec_d: 1 });
  assert.deepEqual(A.streaks([]), { best: 0, slip: 0, rec_n: 0, rec_d: 0 });
  assert.deepEqual(A.streaks([it(null), it(null)]), { best: 0, slip: 0, rec_n: 0, rec_d: 0 });
});

test("streaks: runs of one count; trailing wrong has no recovery chance", () => {
  assert.deepEqual(A.streaks([it(false)]), { best: 0, slip: 1, rec_n: 0, rec_d: 0 });
  assert.deepEqual(A.streaks([it(true)]), { best: 1, slip: 0, rec_n: 0, rec_d: 0 });
});

function rec(n, bySubj, byTopic, next) {
  const items = [];
  for (let k = 0; k < n; k++) items.push(it(k % 4 === 3 ? false : k % 9 === 8 ? null : true));
  return {
    attempt_id: "t2-abc", exam: "neet-pg", profile_version: "1.2.0", test_type: "grand",
    started_at: "2026-10-11T05:00:00.000Z", finished_at: "2026-10-11T06:00:00.000Z",
    items: items,
    score: { raw: 40, max: 80, correct: 12, incorrect: 5, unanswered: 3, accuracy: 0.71, avg_ms: 45000 },
    by_subject: bySubj, by_topic: byTopic, next_actions: next || []
  };
}

test("summary: shape, time passthrough, small flag", () => {
  const s = A.summary(rec(20, [], [], []), { secs: 3600, pace: 60, trend: [] });
  assert.equal(s.v, 1);
  assert.equal(s.n, 20);
  assert.equal(s.small, false);
  assert.equal(s.avg_ms, 45000);
  assert.equal(s.secs, 3600);
  assert.equal(s.pace, 60);
  assert.deepEqual(s.rec, [A.streaks(rec(20, [], [], []).items).rec_n, A.streaks(rec(20, [], [], []).items).rec_d]);
  const tiny = A.summary(rec(3, [], [], []), {});
  assert.equal(tiny.small, true);
  assert.equal(tiny.secs, -1);
  assert.equal(tiny.pace, -1);
  const noAvg = A.summary({ ...rec(10, [], [], []), score: { raw: 0, max: 40, correct: 0, incorrect: 0, unanswered: 10, accuracy: null } }, {});
  assert.equal(noAvg.avg_ms, -1);
  assert.equal(noAvg.acc, null);
});

test("summary: arrays capped and JSON under 4096 bytes on a 200-question test", () => {
  const subj = [];
  for (let k = 0; k < 30; k++) subj.push({ key: "subject-number-" + k, correct: k % 7, n: 7 });
  const weak = [];
  for (let k = 0; k < 9; k++) weak.push({ kind: "practise_topic", target_id: "s" + k + "|m" + k, why: (k + 2) + " of 7 missed" });
  const trend = [];
  for (let k = 0; k < 9; k++) trend.push({ ts: 1700000000000 + k, raw: 40 + k, max: 80 });
  const s = A.summary(rec(200, subj, [], weak), { secs: 7200, pace: 60, trend: trend });
  assert.ok(s.subj.length <= 12);
  assert.ok(s.weak.length <= 3);
  assert.ok(s.trend.length <= 5);
  // weakest-first
  const acc = s.subj.map((r) => r[1] / r[2]);
  assert.deepEqual(acc.slice().sort((a, b) => a - b), acc);
  assert.ok(JSON.stringify(s).length < A.SUMMARY_MAX_BYTES, "got " + JSON.stringify(s).length);
  assert.equal(A.SUMMARY_MAX_BYTES, 4096);
});

test("summary: never a rank, percentile, readiness or prediction field", () => {
  const s = A.summary(rec(20, [{ key: "a", correct: 1, n: 2 }], [], []), { secs: 10, pace: 60, trend: [] });
  const blob = JSON.stringify(s).toLowerCase();
  for (const banned of ["rank", "percentile", "readiness", "predict"]) assert.ok(!blob.includes(banned), banned);
  const schema = JSON.parse(fs.readFileSync(new URL("prep/assess/schemas/summary.schema.json", ROOT), "utf8"));
  assert.deepEqual(Object.keys(schema.properties).sort(), ["acc", "avg_ms", "best", "c", "exam", "i", "id", "max", "n", "pace", "pv", "raw", "rec", "secs", "slip", "small", "subj", "trend", "ts", "type", "u", "v", "weak"]);
  const sblob = JSON.stringify(schema).toLowerCase();
  assert.ok(sblob.includes("never rank"));
});

test("gaps: weakest topics with 2+ missed, at most 3", () => {
  const sc = { by_topic: [
    { key: "a|m1", correct: 8, n: 10 }, { key: "b|m2", correct: 1, n: 5 },
    { key: "c|m3", correct: 0, n: 4 }, { key: "d|m4", correct: 3, n: 4 },
    { key: "e|m5", correct: 2, n: 6 }
  ] };
  const nx = A.nextActions(sc);
  assert.equal(nx.length, 3);
  assert.deepEqual(nx.map((x) => x.target_id), ["c|m3", "b|m2", "e|m5"]);
  assert.ok(nx.every((x) => x.kind === "practise_topic"));
});
