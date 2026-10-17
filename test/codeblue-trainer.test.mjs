/* codeblue-trainer.test.mjs — unit tests for the Code Blue trainer (content, scoring, state).
 * USAGE: node test/codeblue-trainer.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import D from "../codeblue-trainer-data.js";
import T from "../codeblue-trainer.js";

const E = T._engine;

test("content validates with zero errors", () => {
  assert.deepEqual(E.validateContent(D), []);
});

test("scenario counts meet the brief", () => {
  const by = (m) => E.scenarios(m).length;
  assert.ok(by("adult") >= 6, "adult " + by("adult"));
  assert.ok(by("paediatric") >= 4, "paediatric " + by("paediatric"));
  assert.ok(by("neonatal") >= 3, "neonatal " + by("neonatal"));
});

test("practice cases: 8 per mode across easy, medium and hard", () => {
  for (const m of ["adult", "paediatric", "neonatal"]) {
    const list = E.cases(m);
    assert.ok(list.length >= 8, m + " has " + list.length);
    for (const lv of ["easy", "medium", "hard"]) {
      assert.ok(list.some((c) => c.level === lv), m + " missing " + lv);
    }
  }
});

test("quiz bank holds at least 60 questions, each with 4 options and a rationale", () => {
  let n = 0;
  for (const c of E.cases()) {
    assert.ok(c.clues.length >= 1, c.id + " needs timed clues");
    for (const q of c.quiz) {
      n++;
      assert.equal(q.o.length, 4, c.id + " options");
      assert.ok(q.a >= 0 && q.a < 4, c.id + " answer");
      assert.ok(q.why && q.why.length > 10, c.id + " rationale");
    }
  }
  assert.ok(n >= 60, "quiz total " + n);
});

test("guided: wrong pick explains and stays, correct pick advances with coach", () => {
  const g = E.newGuided("adult-vf-1");
  const st = g.scn.states[0];
  const wrong = st.o.findIndex((o) => o[1] === 0);
  const right = st.o.findIndex((o) => o[1] === 1);
  const r1 = E.pickGuided(g, wrong);
  assert.equal(r1.status, "wrong");
  assert.ok(r1.why && r1.why.length > 5);
  assert.equal(g.idx, 0);
  const r2 = E.pickGuided(g, right);
  assert.equal(r2.status, "correct");
  assert.ok(r2.coach && r2.coach.length > 5);
  assert.equal(g.idx, 1);
});

test("guided: full run completes; unknown id returns null", () => {
  const g = E.newGuided("neo-ppv-1");
  while (!g.done) {
    const ci = E.correctIdx(g.scn.states[g.idx]);
    assert.equal(E.pickGuided(g, ci).status, "correct");
  }
  assert.equal(E.pickGuided(g, 0).status, "done");
  assert.equal(E.pickGuided(g, 99).status, "done");
  assert.equal(E.newGuided("nope"), null);
  assert.equal(E.pickGuided(E.newGuided("neo-ppv-1"), 99).status, "invalid");
});

test("test station: all correct and on time scores 100", () => {
  const t = E.newTest("adult-pea-1");
  const n = t.scn.states.length;
  for (let i = 0; i < n; i++) {
    const ci = E.correctIdx(t.scn.states[i]);
    const r = E.pickTest(t, ci, 10);
    assert.ok(r.status === "correct" || r.status === "wrong");
  }
  assert.equal(t.done, true);
  const f = E.finishTest(t);
  assert.equal(f.pct, 100);
  assert.ok(f.rows.every((r) => r.kind === "correct"));
});

test("test station: wrong picks become missed, late picks score half", () => {
  const t = E.newTest("adult-pea-1");
  const n = t.scn.states.length;
  for (let i = 0; i < n; i++) {
    const st = t.scn.states[i];
    const ci = E.correctIdx(st);
    if (i === 0) E.pickTest(t, (ci + 1) % st.o.length, 5); // wrong -> missed
    else if (i === 1) E.pickTest(t, ci, st.due + 50); // late -> half
    else E.pickTest(t, ci, 5);
  }
  const f = E.finishTest(t);
  assert.equal(f.rows[0].kind, "missed");
  assert.equal(f.rows[1].kind, "late");
  const expect = Math.round(100 * (n - 1.5) / n);
  assert.equal(f.pct, expect);
  assert.ok(f.rows[0].picked, "missed row records the wrong pick");
});

test("test station: unanswered states count as missed; invalid guarded", () => {
  const t = E.newTest("neo-ppv-1");
  assert.equal(E.pickTest(t, 99, 0).status, "invalid");
  E.pickTest(t, E.correctIdx(t.scn.states[0]), 5);
  const f = E.finishTest(t);
  assert.ok(f.rows.slice(1).every((r) => r.kind === "missed"));
  assert.equal(E.newTest("nope"), null);
});

test("case grading counts score and per-question topics", () => {
  const c = E.findCase("ac-e1");
  const all = c.quiz.map((q) => q.a);
  const g = E.gradeCase(c, all);
  assert.equal(g.score, g.total);
  const none = E.gradeCase(c, c.quiz.map((q) => (q.a + 1) % 4));
  assert.equal(none.score, 0);
  assert.ok(none.per.every((p) => p.topic && p.why));
});

test("clock formats mm:ss and clamps negatives", () => {
  assert.equal(E.fmtClock(0), "00:00");
  assert.equal(E.fmtClock(65), "01:05");
  assert.equal(E.fmtClock(600), "10:00");
  assert.equal(E.fmtClock(-5), "00:00");
});

test("store: record best, trend, weak spots and reset", () => {
  const mem = E.memStorage();
  let s = E.loadStore(mem);
  assert.deepEqual(s.best, {});
  E.recordResult(s, "adult-vf-1", 60, [{ topic: "defibrillation", asked: 2, missed: 1 }]);
  E.recordResult(s, "adult-vf-1", 100, [{ topic: "defibrillation", asked: 1, missed: 0 }]);
  E.recordResult(s, "ac-e1", 50, [{ topic: "team roles", asked: 1, missed: 1 }]);
  assert.equal(s.best["adult-vf-1"], 100);
  assert.equal(E.trend(s, 10).length, 3);
  const w = E.weakSpots(s);
  assert.equal(w[0].topic, "team roles");
  assert.equal(w[0].rate, 1);
  E.saveStore(mem, s);
  const s2 = E.loadStore(mem);
  assert.equal(s2.best["adult-vf-1"], 100);
  E.resetStore(s2);
  assert.deepEqual(s2.best, {});
  assert.deepEqual(E.weakSpots(s2), []);
});

test("store: corrupt JSON and throwing storage never throw", () => {
  const mem = E.memStorage();
  mem.setItem(E.STORE_KEY, "{bad json");
  assert.deepEqual(E.loadStore(mem).best, {});
  const evil = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  assert.deepEqual(E.loadStore(evil).best, {});
  E.saveStore(evil, E.blankStore());
  E.recordResult(E.blankStore(), "x", 10, null);
});

test("store works with no storage argument in node (no localStorage)", () => {
  const s = E.loadStore();
  assert.deepEqual(s.best, {});
  E.saveStore(undefined, s);
});

test("SPEC timings match the shared domain model", () => {
  assert.equal(D.TIMINGS.rhythmCheckSec.adult, 120);
  assert.equal(D.TIMINGS.rhythmCheckSec.paediatric, 120);
  assert.equal(D.TIMINGS.rhythmCheckSec.neonatal, 60);
  assert.equal(D.TIMINGS.epiDueSec, 180);
  assert.equal(D.TIMINGS.epiOverdueSec, 300);
});

test("deepened content meets the brief: 30 scenarios, 48 cases, 150 questions", () => {
  const by = (list, m) => list.filter((x) => x.mode === m).length;
  assert.ok(E.scenarios("adult").length >= 14, "adult scenarios");
  assert.ok(E.scenarios("paediatric").length >= 9, "paediatric scenarios");
  assert.ok(E.scenarios("neonatal").length >= 7, "neonatal scenarios");
  assert.ok(E.scenarios().length >= 30, "scenarios total");
  assert.ok(E.cases().length >= 48, "cases total " + E.cases().length);
  for (const m of ["adult", "paediatric", "neonatal"]) {
    assert.ok(by(E.cases(), m) >= 8, m + " cases");
  }
  let n = 0;
  for (const c of E.cases()) n += c.quiz.length;
  assert.ok(n >= 150, "quiz total " + n);
});

test("hard cases hide the rhythm and carry at least 4 questions", () => {
  const hards = E.cases().filter((c) => c.level === "hard");
  assert.ok(hards.length >= 8, "hard cases " + hards.length);
  for (const c of hards) {
    assert.equal(c.conceal, true, c.id + " conceals rhythm");
    assert.ok(typeof c.rhythm === "string" && c.rhythm.length > 0, c.id + " rhythm label");
    assert.ok(c.quiz.length >= 4, c.id + " questions");
  }
});

test("PrepNucleus links all resolve to existing lessons or modules", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const here = dirname(fileURLToPath(import.meta.url));
  const lessons = readdirSync(join(here, "..", "prep", "lessons", "v1"))
    .filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  const tax = JSON.parse(readFileSync(join(here, "..", "prep", "taxonomy.json"), "utf8"));
  const modules = [];
  for (const b of tax.branches || []) {
    for (const s of b.subjects || []) {
      for (const sec of s.sections || []) {
        for (const m of sec.modules || []) modules.push(m.id);
      }
    }
  }
  assert.ok(lessons.length > 1000, "lesson index loads");
  assert.ok(modules.length > 100, "module index loads");
  assert.deepEqual(E.validateContent(D, { lessons, modules }), []);
  let linked = 0;
  for (const c of E.cases()) {
    for (const q of c.quiz) {
      if (q.link == null) continue;
      linked++;
      assert.ok(q.link.kind === "lesson" || q.link.kind === "module", c.id + " link kind");
      const dest = D.LINK_DEST[q.link.id];
      assert.ok(dest && dest.s && dest.m, c.id + " link destination");
    }
  }
  assert.ok(linked >= 150, "linked questions " + linked);
});

test("guided: wrong pick costs 30 sim seconds when the clock is passed", () => {
  const g = E.newGuided("adult-vf-1");
  const st = g.scn.states[0];
  const wrong = st.o.findIndex((o) => o[1] === 0);
  const r1 = E.pickGuided(g, wrong, 45);
  assert.equal(r1.status, "wrong");
  assert.equal(r1.costSec, 30);
  assert.equal(g.penaltySec, 30);
  assert.equal(g.idx, 0);
  const g2 = E.newGuided("adult-vf-1");
  const r2 = E.pickGuided(g2, wrong);
  assert.equal(r2.status, "wrong");
  assert.equal(r2.costSec, undefined);
  assert.equal(g2.penaltySec, 0);
});

test("case rhythm hides until the learner asks", () => {
  const hard = E.findCase("ac-h1");
  assert.equal(E.caseRhythm(hard).hidden, true);
  assert.ok(E.caseRhythm(hard).rhythm.length > 0);
  assert.equal(E.rhythmText(hard), "Monitor shows VF.");
  const sess = E.newCaseSession(hard);
  assert.equal(sess.rhythmRevealed, false);
  assert.equal(E.revealRhythm(sess, 60), true);
  assert.equal(sess.rhythmRevealed, true);
  assert.equal(sess.revealAt, 60);
  assert.equal(E.revealRhythm(sess, 90), false);
  const easy = E.findCase("ac-e1");
  assert.equal(E.caseRhythm(easy).hidden, false);
  assert.equal(E.newCaseSession(easy).rhythmRevealed, true);
  const neo = E.findCase("nc-h3");
  assert.ok(E.rhythmText(neo).startsWith("Heart rate check:"));
});

test("weekly trend groups attempts by Monday week", () => {
  const s = E.blankStore();
  const monday = Date.UTC(2026, 9, 12, 12, 0, 0); // a Monday
  s.hist.push({ id: "a", pct: 60, at: monday });
  s.hist.push({ id: "b", pct: 100, at: monday + 2 * 86400000 });
  s.hist.push({ id: "c", pct: 50, at: monday + 8 * 86400000 });
  const wt = E.weeklyTrend(s, 8);
  assert.equal(wt.length, 2);
  assert.equal(wt[0].n, 2);
  assert.equal(wt[0].avg, 80);
  assert.equal(wt[1].n, 1);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(wt[0].week));
});

test("weak topics propose the next case; export renders text", () => {
  const s = E.blankStore();
  E.recordResult(s, "ac-e1", 40, [
    { topic: "defibrillation", asked: 3, missed: 3 },
    { topic: "team roles", asked: 1, missed: 0 },
  ]);
  const sug = E.suggestNext(s, E.cases());
  assert.ok(sug && sug.caseId, "suggestion");
  assert.equal(sug.topic, "defibrillation");
  const sugCase = E.findCase(sug.caseId);
  assert.ok(sugCase.quiz.some((q) => q.topic === "defibrillation"));
  assert.equal(E.suggestNext(E.blankStore(), E.cases()), null);
  const text = E.exportText(s, D);
  assert.ok(text.includes("Code Blue training results"));
  assert.ok(text.includes("defibrillation"));
  assert.ok(text.includes("Weekly trend"));
});
