import { test } from "node:test";
import assert from "node:assert";
import S from "../clinix-store.js";

// A store with a pinned clock, so the "separate days" mastery rule can actually be exercised.
function storeAt(days) {
  let i = 0;
  const st = S.__testStore({ today: () => days[Math.min(i, days.length - 1)] });
  return { st, advance: () => { i++; } };
}

test("record: an attempt is counted, and mastery needs separate days", () => {
  const { st, advance } = storeAt(["2026-08-22", "2026-08-24"]);

  st.record("skill.a", true);
  st.record("skill.a", true);
  st.record("skill.a", true);
  assert.equal(st.mastery("skill.a").level, "learning",
    "three correct answers in ONE session must not be mastery");

  advance();
  st.record("skill.a", true);
  assert.equal(st.mastery("skill.a").level, "mastered",
    "correct across two separate days reaches mastery");
});

test("record: an UNMARKED answer counts as seen but never as correct", () => {
  const { st } = storeAt(["2026-08-22"]);
  st.record("skill.a", null);
  st.record("skill.a", null);
  const r = st.get("skill.a");
  assert.equal(r.seen, 2);
  assert.equal(r.correct, 0, "an unjudged free-text answer must not inflate mastery");
});

test("record: wrong answers are counted separately and logged", () => {
  const { st } = storeAt(["2026-08-22"]);
  st.record("skill.a", false, { mode: "osce", probe: "Which side is diseased?", given: "the opposite side" });
  const r = st.get("skill.a");
  assert.equal(r.seen, 1);
  assert.equal(r.correct, 0);
  assert.equal(r.wrong, 1);

  const m = st.misses();
  assert.equal(m.length, 1);
  assert.equal(m[0].skillId, "skill.a");
  assert.equal(m[0].mode, "osce");
  assert.equal(m[0].given, "the opposite side",
    "the wrong answer itself is kept - it is what makes personalised revision possible");
});

test("days are deduplicated within a single day", () => {
  const { st } = storeAt(["2026-08-22"]);
  for (let i = 0; i < 5; i++) st.record("skill.a", true);
  assert.deepEqual(st.get("skill.a").days, ["2026-08-22"]);
  assert.equal(st.get("skill.a").seen, 5);
});

test("weakest: worst accuracy first, mastered skills excluded", () => {
  const { st, advance } = storeAt(["2026-08-22", "2026-08-24"]);

  st.record("good", true); st.record("good", true); st.record("good", true);
  st.record("bad", false); st.record("bad", false); st.record("bad", true);
  st.record("awful", false); st.record("awful", false);
  advance();
  st.record("good", true);           // -> mastered, should drop out

  const w = st.weakest();
  const ids = w.map((x) => x.skillId);
  assert.equal(ids.indexOf("good"), -1, "a mastered skill is not a weak area");
  assert.equal(ids[0], "awful", "0 percent should rank worse than 33 percent");
  assert.ok(ids.indexOf("bad") > ids.indexOf("awful"));
});

test("weakest: among equal accuracy, the more-attempted skill ranks first", () => {
  const { st } = storeAt(["2026-08-22"]);
  st.record("seen_once", false);
  for (let i = 0; i < 6; i++) st.record("seen_often", false);
  const ids = st.weakest().map((x) => x.skillId);
  assert.equal(ids[0], "seen_often", "more attempts is stronger evidence the weakness is real");
});

test("competency: aggregates a chapter's skills", () => {
  const { st, advance } = storeAt(["2026-08-22", "2026-08-24"]);
  st.record("a", true); st.record("a", true); st.record("a", true);
  advance();
  st.record("a", true);
  st.record("b", false);

  const c = st.competency(["a", "b", "c"]);
  assert.equal(c.total, 3);
  assert.equal(c.mastered, 1);
  assert.ok(c.weak.indexOf("b") >= 0);
});

test("resume: position round-trips including the turn index", () => {
  const { st } = storeAt(["2026-08-22"]);
  assert.equal(st.position(), null);

  st.savePosition({ diseaseId: "copd", chapterId: "systemic_exam", skillId: "skill.exam.resp.expansion", turnIndex: 4 });
  const p = st.position();
  assert.equal(p.diseaseId, "copd");
  assert.equal(p.chapterId, "systemic_exam");
  assert.equal(p.skillId, "skill.exam.resp.expansion");
  assert.equal(p.turnIndex, 4, "the turn index is what stops a student losing their place mid-skill");
});

test("resume: a position without a disease is refused rather than stored half-formed", () => {
  const { st } = storeAt(["2026-08-22"]);
  assert.equal(st.savePosition({ chapterId: "history" }), false);
  assert.equal(st.position(), null);
});

test("a corrupt record does not take the store down", () => {
  const kv = S._memKV();
  kv.set("smd_clinix_skills_v1", "{not json at all");
  const st = S.makeStore({ kv });
  assert.deepEqual(st.all(), {}, "unreadable progress degrades to empty, never throws");
  st.record("skill.a", true);
  assert.equal(st.get("skill.a").seen, 1, "and the store recovers on the next write");
});

test("deleteAll wipes progress, position and the miss log", () => {
  const { st } = storeAt(["2026-08-22"]);
  st.record("skill.a", true);
  st.record("skill.b", false);
  st.savePosition({ diseaseId: "copd", turnIndex: 2 });

  st.deleteAll();
  assert.deepEqual(st.all(), {});
  assert.equal(st.position(), null);
  assert.deepEqual(st.misses(), [],
    "progress must not survive into the next account signed in on the same device");
});

test("completeLesson does not throw when the KU ledger is absent", () => {
  const { st } = storeAt(["2026-08-22"]);
  assert.equal(st.completeLesson("skill.a", "copd"), true,
    "a learning module must never break because an engagement API moved");
});

test("the miss log is bounded", () => {
  const { st } = storeAt(["2026-08-22"]);
  for (let i = 0; i < 250; i++) st.record("skill.a", false, { given: "answer " + i });
  const m = st.misses();
  assert.ok(m.length <= 200, "log grew to " + m.length);
  assert.equal(m[0].given, "answer 249", "and keeps the most recent");
});
