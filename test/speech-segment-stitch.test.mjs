/* speech-segment-stitch.test.mjs - Fast dictation keeps earlier sentences when iOS starts a fresh
 * transcript after a pause (owner video 2026-11-28: the second sentence wiped the first in Ask MaiK).
 * Drives the real SMD_NATIVE.transcribe() with a fake SpeechRecognition plugin. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");

function load() {
  const listeners = {};
  const SP = {
    requestPermissions: () => Promise.resolve({}),
    addListener: (ev, fn) => { listeners[ev] = fn; return { remove() { delete listeners[ev]; } }; },
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  let now = 1000;
  const win = { Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: { SpeechRecognition: SP } }, navigator: { language: "en-IN", userAgent: "iPhone" }, location: { href: "capacitor://localhost/" }, addEventListener() {}, document: { addEventListener() {}, readyState: "complete" } };
  win.window = win;
  const ctx = vm.createContext(Object.assign(win, { console, setTimeout, clearTimeout, Promise, Date: Object.assign(function () {}, { now: () => now }), fetch: () => Promise.resolve() }));
  try { vm.runInContext(SRC, ctx); } catch (e) { /* later wiring may need DOM we do not stub; transcribe is defined before it */ }
  return { win, listeners, tick: (ms) => { now += ms; } };
}

test("pure stitch: the video's sequence keeps both sentences", () => {
  const { win } = load();
  const S = win.SMD_stitchSegments;
  let st = { committed: "", seg: "", lastAt: 0 };
  const step = (p, t) => (st = S(st, p, t)).text;
  assert.equal(step("F5 Centre", 1000), "F5 Centre");
  assert.equal(step("A5 centimetre RCC", 1300), "A5 centimetre RCC", "a revision replaces in place");
  assert.equal(step("Stitching", 3500), "A5 centimetre RCC Stitching", "new segment after a pause is appended");
  assert.equal(step("Stitching done with", 3800), "A5 centimetre RCC Stitching done with");
  assert.equal(step("Stitching done with nylon", 4100), "A5 centimetre RCC Stitching done with nylon");
});

test("pure stitch: a whole-session partial is not duplicated", () => {
  const { win } = load();
  const S = win.SMD_stitchSegments;
  let st = { committed: "Fever for three days", seg: "Cough", lastAt: 1 };
  st = S(st, "Fever for three days. Cough and cold", 2);
  assert.equal(st.text, "Fever for three days. Cough and cold");
});

test("pure stitch: growing partials and same-length revisions never commit", () => {
  const { win } = load();
  const S = win.SMD_stitchSegments;
  let st = { committed: "", seg: "", lastAt: 0 };
  for (const [p, t] of [["The", 0], ["The patient", 200], ["The patient has", 400], ["The patient has fever", 3000], ["The patient had fever", 3200]]) st = S(st, p, t);
  assert.equal(st.committed, "");
  assert.equal(st.text, "The patient had fever");
});

test("transcribe(): partials after a recognizer reset reach the composer with the earlier text", async () => {
  const { win, listeners, tick } = load();
  const seen = []; let fin = null;
  win.SMD_NATIVE.transcribe({ onPartial: (t) => seen.push(t), onFinal: (t) => { fin = t; } });
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(listeners.partialResults, "partialResults listener attached");
  listeners.partialResults({ matches: ["Wound on the left"] }); tick(300);
  listeners.partialResults({ matches: ["Wound on the left forearm"] }); tick(2000);
  listeners.partialResults({ matches: ["Sutured"] }); tick(300);
  listeners.partialResults({ matches: ["Sutured with nylon"] });
  assert.equal(seen.at(-1), "Wound on the left forearm Sutured with nylon");
  listeners.listeningState({ status: "stopped" });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fin, "Wound on the left forearm Sutured with nylon");
});
