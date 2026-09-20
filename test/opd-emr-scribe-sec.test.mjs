/* test/opd-emr-scribe-sec.test.mjs — the seconds the client reports to the scribe meter.
 *
 * The server meters MaiK Scribe by audio captured, not by how often the client calls it
 * (functions/_ai_usage.js scribeChargeSec). Every refine resends the WHOLE growing transcript, so the
 * client must send the DELTA since the last call it actually sent. Billing the elapsed total, or the
 * transcript length, would charge the same minute again on every pass - which is exactly how a
 * 20 minute consult used to blow the daily cap and stop the recording mid-consultation.
 *
 * node --test test/opd-emr-scribe-sec.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

function makeDoc() {
  const el = () => ({ id: "", classList: { add() {}, remove() {} }, querySelector: () => null,
    appendChild() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ""; },
    textContent: "", style: {} });
  return { getElementById: () => null, createElement: el, body: { appendChild() {} }, activeElement: null };
}

function load() {
  const win = {};
  const store = {};
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  };
  new Function("window", "document", "location", "localStorage", SRC)(win, makeDoc(), { search: "" }, ls);
  win.localStorage = ls;
  return win.OPDEMR;
}

test("the first refine of a consult reports the seconds recorded so far, not zero", () => {
  const OE = load();
  const st = OE._state();
  st.voiceStartedAt = Date.now() - 30000;          // 30 s of dictation before the first refine
  const sec = OE._scribeSendPrep("some transcript").opts.sec;
  assert.ok(sec >= 29 && sec <= 31, "expected about 30, got " + sec);
});

test("a later refine reports only the NEW dictation, never the running total", () => {
  const OE = load();
  const st = OE._state();
  st.voiceStartedAt = Date.now() - 60000;
  const first = OE._scribeSendPrep("a").opts.sec;   // ~60 s since the recording began
  const second = OE._scribeSendPrep("a b").opts.sec; // immediately after: almost no new audio
  assert.ok(first >= 59 && first <= 61, "first call bills the audio so far, got " + first);
  assert.ok(second <= 1, "the second call must bill only what is new, got " + second);
});

test("a consult is never billed more than the audio it captured", () => {
  // Ten refines across a simulated 10 minute consult must sum to about 600 s, not 10 x the total.
  const OE = load();
  const st = OE._state();
  const t0 = Date.now() - 600000;
  st.voiceStartedAt = t0;
  let now = t0, total = 0;
  const realNow = Date.now;
  try {
    for (let i = 1; i <= 10; i++) {
      now = t0 + i * 60000;                        // a refine every 60 s
      Date.now = () => now;
      total += OE._scribeSendPrep("transcript so far").opts.sec;
    }
  } finally { Date.now = realNow; }
  assert.ok(total >= 595 && total <= 605, "10 minutes of audio must bill about 600 s, got " + total);
});

test("the delta is clamped, so a clock jump cannot bill a huge number", () => {
  const OE = load();
  const st = OE._state();
  st.voiceStartedAt = Date.now() - 9999999;        // an absurd gap (suspended app, clock change)
  const sec = OE._scribeSendPrep("x").opts.sec;
  assert.ok(sec === 0 || sec <= 300, "must be clamped or refused, got " + sec);
});

test("the specialty prompt still rides alongside the seconds", () => {
  const OE = load();
  const st = OE._state();
  st.voiceStartedAt = Date.now() - 5000;
  const opts = OE._scribeSendPrep("x").opts;
  assert.equal(typeof opts.sec, "number", "sec must always be present for the meter");
  assert.ok(!("specialtyPrompt" in opts) || typeof opts.specialtyPrompt === "string");
});
