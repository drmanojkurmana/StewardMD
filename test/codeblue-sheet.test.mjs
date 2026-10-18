/* Code Blue sheet: payload parsing and defaults, recount after edit/delete/
 * undo, time-to-first computations, plain-text rendering, PDF builder with a
 * mocked jsPDF. USAGE: node test/codeblue-sheet.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const S = require("../codeblue-sheet.js");

function v2(events, extra) {
  return Object.assign({
    v: 2, mode: "adult", startedAt: "2026-10-01T10:00:00Z",
    durationSeconds: 600, cycles: 2, events: events,
    summary: { compressions: 1000, averageRateCPM: 110, compressionFractionPct: 82, shockCount: 1, adrenalineCount: 2, rosc: false },
    disclaimer: "Motion-based estimates, not a measure of CPR quality or depth."
  }, extra || {});
}

const EVENTS = [
  { id: "a", elapsed: 0, kind: "cprStart", label: "CPR started" },
  { id: "b", elapsed: 120, kind: "rhythm", label: "VF" },
  { id: "c", elapsed: 125, kind: "shock", label: "Shock delivered" },
  { id: "d", elapsed: 200, kind: "drug", label: "Epinephrine" },
  { id: "e", elapsed: 240, kind: "pauseStart", label: "Pause started" },
  { id: "f", elapsed: 260, kind: "resume", label: "Compressions resumed" },
  { id: "g", elapsed: 380, kind: "drug", label: "Epinephrine" },
  { id: "h", elapsed: 500, kind: "drug", label: "Amiodarone" }
];

/* ---- parsing and defaults ---- */

test("v2 payload parses with mode, order and summary intact", () => {
  const st = S.parsePayload(v2(EVENTS));
  assert.equal(st.v, 2);
  assert.equal(st.mode, "adult");
  assert.equal(st.events.length, 8);
  assert.equal(st.events[0].id, "a");
  assert.equal(st.summary.compressionFractionPct, 82);
});

test("v1 payload and missing fields degrade gracefully", () => {
  const v1 = { mode: "paediatric", events: [{ elapsed: 30, kind: "shock" }] };
  const st = S.parsePayload(v1);
  assert.equal(st.v, 1);
  assert.equal(st.mode, "paediatric");
  assert.equal(st.events[0].label, "Shock delivered");
  assert.equal(st.events[0].edited, false);
  const empty = S.parsePayload(null);
  assert.equal(empty.mode, "adult");
  assert.deepEqual(empty.events, []);
  assert.equal(empty.durationSeconds, 0);
  const broken = S.parsePayload("{nope");
  assert.deepEqual(broken.events, []);
  assert.equal(S.parsePayload({ mode: "alien", events: [] }).mode, "adult");
});

test("unknown mode spelling still resolves paediatric", () => {
  assert.equal(S.parsePayload({ mode: "pediatric", events: [] }).mode, "paediatric");
});

/* ---- recount after edit/delete/undo ---- */

test("counts come from the event list, not the summary", () => {
  const st = v2(EVENTS);
  const c = S.computeCounts(st.events);
  assert.equal(c.shocks, 1);
  assert.equal(c.epi, 2);
});

test("non epinephrine drugs never count as epinephrine", () => {
  const c = S.computeCounts([{ kind: "drug", label: "Amiodarone", elapsed: 1, id: "x", edited: false }]);
  assert.equal(c.epi, 0);
});

test("edit, delete and undo recompute counts from the list", () => {
  const st = S.parsePayload(v2(EVENTS));
  st.events = st.events.filter((e) => e.id !== "c");
  assert.equal(S.computeCounts(st.events).shocks, 0);
  const removed = { id: "c", elapsed: 125, kind: "shock", label: "Shock delivered", edited: false };
  st.events.splice(2, 0, removed);
  assert.equal(S.computeCounts(st.events).shocks, 1);
  st.events.find((e) => e.id === "d").label = "Amiodarone";
  assert.equal(S.computeCounts(st.events).epi, 1);
});

/* ---- time-to-first computations ---- */

test("time to first shock and epinephrine read the earliest match", () => {
  const st = S.parsePayload(v2(EVENTS));
  const d = S.computeDebrief(st);
  assert.equal(d.timeToFirstShock, 125);
  assert.equal(d.timeToFirstEpi, 200);
  assert.equal(d.pauses, 1);
  assert.equal(d.pauseSeconds, 20);
  assert.equal(d.rhythmCycles, 1);
});

test("missing shocks report not logged and fraction falls back to pauses", () => {
  const st = S.parsePayload(v2([
    { id: "a", elapsed: 0, kind: "cprStart", label: "CPR started" },
    { id: "e", elapsed: 100, kind: "pauseStart", label: "Pause started" }
  ], { durationSeconds: 400, summary: {} }));
  const d = S.computeDebrief(st);
  assert.equal(d.timeToFirstShock, null);
  assert.equal(d.timeToFirstEpi, null);
  assert.equal(d.pauseSeconds, 300);
  assert.equal(d.compressionFractionPct, 25);
  assert.equal(d.rhythmCycles, 2);
});

test("fromWatchEvent reads payload or json and tolerates junk", () => {
  const p = v2(EVENTS);
  assert.equal(S.fromWatchEvent({ payload: p }).events.length, 8);
  assert.equal(S.fromWatchEvent({ json: JSON.stringify(p) }).events.length, 8);
  assert.deepEqual(S.fromWatchEvent(null).events, []);
  assert.deepEqual(S.fromWatchEvent({}).events, []);
  assert.deepEqual(S.fromWatchEvent({ detail: "junk" }).events, []);
});

/* ---- plain-text rendering ---- */

test("plain text carries timeline, edited marker, totals and both disclaimers", () => {
  const st = S.parsePayload(v2(EVENTS));
  st.events[2].edited = true;
  const t = S.renderText(st);
  assert.ok(t.includes("02:05  Shock delivered (edited)"), t);
  assert.ok(t.includes("epinephrine 2, shocks 1"), t);
  assert.ok(t.includes("Time to first shock: 02:05."), t);
  assert.ok(t.includes(S.CLINICAL_DISCLAIMER), t);
  assert.ok(t.includes(S.MOTION_DISCLAIMER), t);
  assert.ok(!/[\u2014\u{1F300}-\u{1FAFF}]/u.test(t), "no em dashes or emoji");
});

test("empty timeline renders a line, never a blank sheet", () => {
  const t = S.renderText(S.parsePayload({}));
  assert.ok(t.includes("No events logged."), t);
});

/* ---- PDF builder with mocked jsPDF ---- */

function mockJS(calls) {
  return function (opts) {
    calls.opts = opts;
    return {
      internal: { pageSize: { getWidth: () => 595.28, getHeight: () => 841.89 } },
      setFont: (f, s) => calls.fonts.push(f + "/" + s),
      setFontSize: (n) => calls.sizes.push(n),
      splitTextToSize: (t) => String(t).split("\n"),
      text: (t, x, y) => calls.text.push(String(t)),
      output: () => new Uint8Array([37, 80, 68, 70]).buffer,
      getNumberOfPages: () => 1
    };
  };
}

test("PDF builder returns bytes from the mock and stays on one page", () => {
  const calls = { text: [], fonts: [], sizes: [] };
  const st = S.parsePayload(v2(EVENTS));
  const out = S.buildPdfBytes(st, mockJS(calls));
  assert.ok(out.bytes instanceof Uint8Array);
  assert.ok(out.bytes.length > 0);
  assert.equal(out.pages, 1);
  assert.equal(calls.opts.format, "a4");
  const all = calls.text.join("\n");
  assert.ok(all.includes("Code sheet (adult)"), all);
  assert.ok(all.includes("Patient:"), all);
  assert.ok(all.includes("epinephrine 2, shocks 1"), all);
  assert.ok(all.includes(S.CLINICAL_DISCLAIMER.slice(0, 20)), all);
});

test("long timelines truncate to one page with a pointer to the phone log", () => {
  const calls = { text: [], fonts: [], sizes: [] };
  const evs = [];
  for (let i = 0; i < 300; i++) evs.push({ id: "e" + i, elapsed: i * 5, kind: "note", label: "Note number " + i });
  const out = S.buildPdfBytes(S.parsePayload(v2(evs, { durationSeconds: 1500 })), mockJS(calls));
  assert.equal(out.pages, 1);
  assert.ok(calls.text.join("\n").includes("further events (see phone log)"));
});

test("PDF builder throws a catchable error with no engine", () => {
  const st = S.parsePayload(v2([]));
  assert.throws(() => S.buildPdfBytes(st, null), /PDF engine unavailable/);
});

test("mm:ss formatter pads and clamps", () => {
  assert.equal(S.fmtMMSS(0), "00:00");
  assert.equal(S.fmtMMSS(125), "02:05");
  assert.equal(S.fmtMMSS(-5), "00:00");
  assert.equal(S.fmtMMSS(3600), "60:00");
});

test("scene: old payloads without scene stay valid, new scene parses", () => {
  const old = S.parsePayload(v2(EVENTS));
  assert.deepEqual(old.scene.team, []);
  assert.equal(old.scene.weightKg, null);
  const withScene = S.parsePayload(v2(EVENTS, { scene: { weightKg: 70, setting: "In-hospital", location: "Ward 3B", team: ["A"] } }));
  assert.equal(withScene.scene.location, "Ward 3B");
  assert.deepEqual(withScene.scene.team, ["A"]);
});

test("debrief: longest pause from logged pause and resume events", () => {
  const st = S.parsePayload(v2(EVENTS, { summary: { compressions: 0, averageRateCPM: 0, compressionFractionPct: null, targetRatePct: 0, shockCount: 0, adrenalineCount: 0, rosc: false } }));
  const d = S.computeDebrief(st);
  assert.equal(d.pauses, 1);
  assert.equal(d.longestPauseSeconds, 20);
  assert.equal(d.timeToFirstShock, 125);
  assert.equal(d.timeToFirstEpi, 200);
  const empty = S.computeDebrief(S.parsePayload(null));
  assert.equal(empty.longestPauseSeconds, 0);
  assert.equal(empty.timeToFirstShock, null);
});
