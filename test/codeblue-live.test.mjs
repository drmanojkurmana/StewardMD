/* codeblue-live.test.mjs: unit tests for the Code Blue live screen engine.
 * Pure logic only (no DOM): timer boundaries, epinephrine due/overdue at
 * exactly 180/300 s, snapshot resume and staleness, recount after
 * edit/delete/undo, v2 payload shape for codeblue-sheet.js, guide prompts
 * per track, and a no-dose scan over every user-visible string.
 * USAGE: node test/codeblue-live.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Live from "../codeblue-live.js";
import Audio from "../codeblue-audio.js";
import Sheet from "../codeblue-sheet.js";

const E = Live._engine;

/* ---------- CodeMode configs ---------- */

test("mode configs: rhythm interval 120 s adult and paediatric, 60 s neonatal", () => {
  assert.equal(E.MODE_CONFIG.adult.rhythmInterval, 120);
  assert.equal(E.MODE_CONFIG.paediatric.rhythmInterval, 120);
  assert.equal(E.MODE_CONFIG.neonatal.rhythmInterval, 60);
});

test("mode configs carry compression and airway labels, no doses", () => {
  for (const m of E.MODES) {
    const c = E.MODE_CONFIG[m];
    assert.ok(c.compression && c.compression.length > 3, m);
    assert.ok(c.airway && c.airway.length > 3, m);
  }
  assert.match(E.MODE_CONFIG.adult.compression, /30:2/);
  assert.match(E.MODE_CONFIG.neonatal.compression, /3:1/);
});

test("fixed vocabularies: 7 procedures, 7 rhythms", () => {
  assert.equal(E.PROCEDURES.length, 7);
  assert.equal(E.RHYTHMS.length, 7);
  assert.ok(E.PROCEDURES.includes("Advanced airway"));
  assert.ok(E.RHYTHMS.includes("VF"));
  assert.ok(E.RHYTHMS.includes("Asystole"));
});

/* ---------- timer boundaries ---------- */

test("rhythm cycle due at exactly 120 s adult, not at 119 s", () => {
  const before = E.cycleInfo("adult", 119, 0);
  assert.equal(before.due, false);
  assert.equal(before.remaining, 1);
  assert.equal(before.cycleNumber, 1);
  const at = E.cycleInfo("adult", 120, 0);
  assert.equal(at.due, true);
  assert.equal(at.remaining, 0);
  assert.equal(at.cycleNumber, 2);
});

test("rhythm cycle due at exactly 60 s neonatal, not at 59 s", () => {
  assert.equal(E.cycleInfo("neonatal", 59, 0).due, false);
  assert.equal(E.cycleInfo("neonatal", 60, 0).due, true);
  assert.equal(E.cycleInfo("neonatal", 60, 0).cycleNumber, 2);
});

test("logging a rhythm restarts the cycle", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "rhythm", "VF", 100);
  assert.equal(s.cycleStart, 100);
  assert.equal(E.cycleInfo("adult", 219, s.cycleStart).due, false);
  assert.equal(E.cycleInfo("adult", 220, s.cycleStart).due, true);
});

/* ---------- epinephrine schedule ---------- */

test("epinephrine: none before the first logged dose", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  assert.equal(E.epiStatus(s, 500).state, "none");
});

test("epinephrine due at exactly 180 s, overdue at exactly 300 s", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 0);
  assert.equal(E.epiStatus(s, 179).state, "countdown");
  assert.equal(E.epiStatus(s, 179).remaining, 1);
  assert.equal(E.epiStatus(s, 180).state, "due");
  assert.equal(E.epiStatus(s, 299).state, "due");
  assert.equal(E.epiStatus(s, 300).state, "overdue");
  assert.equal(E.epiStatus(s, 900).state, "overdue");
});

test("epinephrine timer restarts from the latest dose", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 0);
  E.logEvent(s, "drug", "Epinephrine", 200);
  assert.equal(E.epiStatus(s, 379).state, "countdown");
  assert.equal(E.epiStatus(s, 380).state, "due");
});

/* ---------- due strip ---------- */

test("due strip: CPR in progress, rhythm due, epi due and overdue, shock, ROSC, paused", () => {
  let s = E.newSession("adult", { wallNow: 0 });
  assert.deepEqual(E.dueStrip(s, 10), { text: "CPR in progress", level: "running" });
  assert.deepEqual(E.dueStrip(s, 120), { text: "Rhythm check due", level: "due" });
  s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 0);
  E.logEvent(s, "rhythm", "PEA", 100);
  assert.equal(E.dueStrip(s, 185).text, "Epinephrine due");
  assert.equal(E.dueStrip(s, 185).level, "due");
  assert.deepEqual(E.dueStrip(s, 301), { text: "Epinephrine overdue", level: "overdue" });
  s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "rhythm", "VF", 50);
  assert.deepEqual(E.dueStrip(s, 60), { text: "Shock", level: "overdue" });
  s = E.newSession("adult", { wallNow: 0 });
  s.rosc = true;
  assert.deepEqual(E.dueStrip(s, 60), { text: "ROSC", level: "rosc" });
  s = E.newSession("adult", { wallNow: 0 });
  assert.deepEqual(E.dueStrip(s, 60, { paused: true }), { text: "Paused", level: "paused" });
});

test("due strip shows the nearest countdown", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 0);
  E.logEvent(s, "rhythm", "PEA", 100);
  assert.equal(E.dueStrip(s, 138).text, "Epinephrine due 0:42");
  const s2 = E.newSession("adult", { wallNow: 0 });
  assert.equal(E.dueStrip(s2, 112).text, "Rhythm check 0:08");
});

/* ---------- guide: four tracks ---------- */

test("guide: shockable, non-shockable, bradycardia, tachycardia, post-ROSC tracks", () => {
  const shock = E.guideFor({ mode: "adult", lastRhythm: "VF", shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: false });
  assert.ok(shock.length >= 3);
  assert.ok(shock.some((p) => /shock/i.test(p.text)));
  const non = E.guideFor({ mode: "adult", lastRhythm: "Asystole", shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: false });
  assert.ok(non.some((p) => /as soon as possible/i.test(p.text)));
  const brady = E.guideFor({ mode: "adult", lastRhythm: "Bradycardia (pulse)", shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: false });
  assert.ok(brady.length >= 3);
  assert.ok(brady.some((p) => /poor perfusion/i.test(p.text)));
  const tachy = E.guideFor({ mode: "adult", lastRhythm: "Tachycardia (pulse)", shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: false });
  assert.equal(tachy.length, 4);
  assert.ok(tachy.some((p) => /cardioversion/i.test(p.text)));
  const post = E.guideFor({ mode: "adult", lastRhythm: "PEA", shockCount: 1, epiCount: 2, secsSinceEpi: 100, rosc: true });
  assert.ok(post.length >= 4);
  assert.ok(post.some((p) => /12 lead ECG/i.test(p.text)));
});

test("guide: every prompt has id, text, urgency and a source line", () => {
  const rhythms = [null, "VF", "VT (pulseless)", "PEA", "Asystole",
    "Sinus rhythm (pulse)", "Bradycardia (pulse)", "Tachycardia (pulse)"];
  for (const mode of E.MODES) {
    for (const r of rhythms) {
      for (const rosc of [false, true]) {
        const list = E.guideFor({ mode, lastRhythm: r, shockCount: 2, epiCount: 1, secsSinceEpi: 100, rosc });
        assert.ok(list.length >= 3, mode + " " + r + " rosc=" + rosc);
        for (const p of list) {
          assert.ok(p.id, "prompt id");
          assert.ok(p.text && p.text.length > 5, "prompt text");
          assert.ok(["info", "due", "overdue"].includes(p.urgency), "urgency " + p.urgency);
          assert.ok(p.src && p.src.length > 5, "source line");
        }
      }
    }
  }
});

test("guide: epinephrine named with timing only, amiodarone only after the 3rd shock", () => {
  const early = E.guideFor({ mode: "adult", lastRhythm: "VF", shockCount: 0, epiCount: 0, secsSinceEpi: null, rosc: false });
  assert.ok(!early.some((p) => /amiodarone/i.test(p.text)), "no amiodarone before the 3rd shock");
  const late = E.guideFor({ mode: "adult", lastRhythm: "VF", shockCount: 3, epiCount: 2, secsSinceEpi: 60, rosc: false });
  assert.ok(late.some((p) => /amiodarone/i.test(p.text)));
});

/* ---------- no doses, British spelling, plain punctuation ---------- */

test("no doses in any output: no mg, joule, shock joules or em-dashes", () => {
  const banned = [
    /[0-9]\s?(mg|mcg|microgram|mmol|millimol)/i,
    /joule/i,
    /[0-9]\s?J(\/| |$)/,
    /mg\/kg/i
  ];
  const EMDASH = String.fromCodePoint(0x2014);
  const hasEmoji = (t) => {
    for (const ch of String(t)) {
      const cp = ch.codePointAt(0);
      if ((cp >= 0x1F300 && cp <= 0x1FAFF) || (cp >= 0x2600 && cp <= 0x27BF)) return true;
    }
    return false;
  };
  const texts = E.allCopySamples();
  assert.ok(texts.length > 50, "samples cover the copy, got " + texts.length);
  for (const t of texts) {
    const s = String(t);
    for (const re of banned) {
      assert.ok(!re.test(s), "banned pattern " + re + " in: " + s.slice(0, 80));
    }
    assert.ok(!s.includes(EMDASH), "em-dash in: " + s.slice(0, 80));
    assert.ok(!hasEmoji(s), "emoji in: " + s.slice(0, 80));
    assert.ok(!/pediatric/i.test(s), "American spelling in: " + s.slice(0, 80));
  }
});

test("no dose strings in audio voice phrases", () => {
  for (const k of Object.keys(Audio.PHRASES)) {
    const t = Audio.PHRASES[k];
    assert.ok(t && t.length > 3, k);
    assert.ok(!/[0-9]\s?mg/i.test(t), k + ": " + t);
    assert.ok(!t.includes(String.fromCodePoint(0x2014)), k);
  }
  assert.equal(Audio.PHRASES.rhythmDue, "Rhythm check. Switch compressor");
  assert.equal(Audio.PHRASES.epiDue, "Epinephrine due");
  assert.equal(Audio.PHRASES.epiOverdue, "Epinephrine overdue");
});

test("audio engine constants: 110 per minute, 25 ms 1 kHz tick", () => {
  assert.equal(Audio.METRONOME_BPM, 110);
  assert.equal(Audio.TICK_HZ, 1000);
  assert.equal(Audio.TICK_MS, 25);
});

/* ---------- snapshot resume and staleness ---------- */

test("snapshot resumes a fresh session and advances while running", () => {
  const s = E.newSession("adult", { wallNow: 1000 });
  E.logEvent(s, "shock", null, 30);
  const snap = E.takeSnapshot(s, 100, 2000);
  snap.running = true;
  snap.paused = false;
  const r = E.restoreSnapshot(snap, 2000 + 45 * 1000);
  assert.equal(r.ok, "resume");
  assert.equal(r.elapsed, 145);
  assert.equal(r.session.events.length, 1);
  assert.equal(r.session.mode, "adult");
});

test("snapshot older than 6 h discards", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  const snap = E.takeSnapshot(s, 100, 1000);
  snap.running = true;
  const r = E.restoreSnapshot(snap, 1000 + 6 * 3600 * 1000 + 1000);
  assert.equal(r.ok, "discard");
  assert.equal(r.reason, "stale");
  const edge = E.restoreSnapshot(snap, 1000 + 6 * 3600 * 1000);
  assert.equal(edge.ok, "resume");
});

test("paused snapshot does not advance on wall time", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  const snap = E.takeSnapshot(s, 100, 1000);
  snap.running = true;
  snap.paused = true;
  const r = E.restoreSnapshot(snap, 1000 + 600 * 1000);
  assert.equal(r.ok, "resume");
  assert.equal(r.elapsed, 100);
});

test("unreadable snapshot discards", () => {
  assert.equal(E.restoreSnapshot(null, 0).ok, "discard");
  assert.equal(E.restoreSnapshot({ version: 99 }, 0).ok, "discard");
});

/* ---------- editable log with undo ---------- */

test("counts recompute after edit, delete and undo; edit keeps elapsed", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  const shock = E.logEvent(s, "shock", null, 30);
  const epi = E.logEvent(s, "drug", "Epinephrine", 60);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 1 });
  assert.equal(E.editEvent(s, epi.id, "Epinephrine, team aware"), true);
  assert.equal(E.editEvent(s, epi.id, "  "), false);
  const ev = s.events.find((x) => x.id === epi.id);
  assert.equal(ev.edited, true);
  assert.equal(ev.elapsed, 60);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 1 });
  assert.equal(E.deleteEvent(s, epi.id), true);
  assert.deepEqual(E.computeCounts(s.events), { epi: 0, shocks: 1 });
  const back = E.undoDelete(s);
  assert.ok(back && back.id === epi.id);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 1 });
  assert.equal(E.deleteEvent(s, shock.id), true);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 0 });
  assert.equal(E.undoDelete(s).id, shock.id);
  assert.deepEqual(E.computeCounts(s.events), { epi: 1, shocks: 1 });
  assert.equal(E.undoDelete(s), null);
});

/* ---------- re-arrest ---------- */

test("re-arrest clears ROSC, logs, restarts the cycle, epi timer continues", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "drug", "Epinephrine", 100);
  E.logEvent(s, "rosc", null, 200);
  s.rosc = true;
  s.hadRosc = true;
  E.reArrest(s, 260);
  assert.equal(s.rosc, false);
  assert.equal(s.cycleStart, 260);
  assert.equal(E.epiStatus(s, 400).state, "overdue");
  const last = s.events[s.events.length - 1];
  assert.equal(last.kind, "reArrest");
  assert.equal(last.elapsed, 260);
});

/* ---------- checklist ---------- */

test("post-ROSC checklist per mode; each tick logs a note", () => {
  assert.equal(E.checklistFor("adult").length, 9);
  assert.equal(E.checklistFor("paediatric").length, 9);
  assert.equal(E.checklistFor("neonatal").length, 5);
  const s = E.newSession("adult", { wallNow: 0 });
  assert.equal(E.toggleCheck(s, "c1", 300), "ticked");
  assert.ok(s.checks.c1);
  const note = s.events[s.events.length - 1];
  assert.equal(note.kind, "note");
  assert.equal(note.elapsed, 300);
  assert.equal(E.toggleCheck(s, "c1", 310), "unticked");
  assert.equal(E.toggleCheck(s, "zzz", 310), false);
});

/* ---------- v2 payload matches SPEC and opens in the sheet ---------- */

test("payload shape matches SPEC v2", () => {
  const s = E.newSession("paediatric", { wallNow: Date.parse("2026-01-01T00:00:00.000Z") });
  E.logEvent(s, "shock", null, 30);
  E.logEvent(s, "drug", "Epinephrine", 200);
  E.logEvent(s, "rhythm", "VF", 240);
  const p = E.buildPayload(s, { elapsed: 400, startedAtISO: "2026-01-01T00:00:00.000Z" });
  assert.equal(p.v, 2);
  assert.equal(p.mode, "paediatric");
  assert.equal(p.startedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(p.durationSeconds, 400);
  assert.equal(p.cycles, 3);
  assert.equal(p.events.length, 3);
  for (const e of p.events) {
    assert.deepEqual(Object.keys(e).sort(), ["edited", "elapsed", "id", "kind", "label"]);
  }
  assert.deepEqual(Object.keys(p.summary).sort(),
    ["adrenalineCount", "averageRateCPM", "compressionFractionPct", "compressions", "rosc", "shockCount", "targetRatePct"]);
  assert.equal(p.summary.shockCount, 1);
  assert.equal(p.summary.adrenalineCount, 1);
  assert.equal(p.summary.rosc, false);
  assert.ok(p.disclaimer && p.disclaimer.length > 5);
});

test("payload opens in codeblue-sheet.js with matching counts", () => {
  const s = E.newSession("adult", { wallNow: 0 });
  E.logEvent(s, "shock", null, 30);
  E.logEvent(s, "drug", "Epinephrine", 200);
  E.logEvent(s, "drug", "Epinephrine", 390);
  E.logEvent(s, "note", "Checklist: Record 12 lead ECG", 420);
  const p = E.buildPayload(s, { elapsed: 500, startedAtISO: "2026-01-01T00:00:00.000Z" });
  const parsed = Sheet.parsePayload(p);
  assert.equal(parsed.v, 2);
  assert.equal(parsed.mode, "adult");
  assert.equal(parsed.events.length, 4);
  const counts = Sheet.computeCounts(parsed.events);
  assert.equal(counts.shocks, 1);
  assert.equal(counts.epi, 2);
});
