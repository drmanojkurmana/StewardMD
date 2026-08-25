/* Voice-to-Rx parser: "amox 500 TDS 5 days" -> {drug,dose,freq,duration}. Pure regex logic in
 * prescription.js, exposed as SMD_RX._parseVoiceRx. node --test test/rx-voice-parse.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const SRC = readFileSync(new URL("../prescription.js", import.meta.url), "utf8");
function load() {
  const noop = () => {};
  const el = () => ({ classList: { add: noop, remove: noop, toggle: noop }, style: {}, addEventListener: noop, removeEventListener: noop, appendChild: noop, insertAdjacentHTML: noop, querySelector: () => null, querySelectorAll: () => [], setAttribute: noop, remove: noop, focus: noop, children: [], value: "" });
  const win = { localStorage: { getItem: () => null, setItem: noop, removeItem: noop }, addEventListener: noop, location: { search: "" }, navigator: {}, MEDDRUGS: null, SMD_VOICE: null };
  const doc = { getElementById: () => null, createElement: el, body: { appendChild: noop }, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] };
  try { new Function("window", "document", "location", "navigator", SRC)(win, doc, win.location, win.navigator); } catch (e) { /* dependency-free parse is all we need */ }
  return win.SMD_RX;
}
const P = () => { const rx = load(); assert.ok(rx && rx._parseVoiceRx, "SMD_RX._parseVoiceRx exported"); return rx._parseVoiceRx; };

test("parses drug + dose + frequency + duration", () => {
  const r = P()("amox 500 TDS 5 days");
  assert.equal(r.drug, "amox");         // no MEDDRUGS in test -> raw token
  assert.equal(r.dose, "500");
  assert.equal(r.freq, "TDS");
  assert.equal(r.duration, "5 days");
});
test("dose unit + qid + weeks", () => {
  const r = P()("paracetamol 650 mg qid 2 weeks");
  assert.equal(r.dose, "650 mg");
  assert.equal(r.freq, "QID");
  assert.equal(r.duration, "2 weeks");
});
test("word frequencies: once daily / twice daily", () => {
  assert.equal(P()("metformin 500 once daily 30 days").freq, "OD");
  assert.equal(P()("amlodipine 5 twice daily").freq, "BD");
});
test("empty -> null; drug-only still returns the drug", () => {
  assert.equal(P()("   "), null);
  assert.equal(P()("azithromycin").drug, "azithromycin");
});

// ---- Dictate button wiring -------------------------------------------------------------------
// The bug: prescription.js passed `onEnd` to SMD_VOICE.listen as its reset callback, but voice.js
// never calls onEnd — it does not exist. So after a successful dictation the mic stayed stuck "on",
// the next tap only cancelled it, and Dictate looked dead with no message ever shown.
const VOICE_SRC = readFileSync(new URL("../voice.js", import.meta.url), "utf8");
const MIC = SRC.slice(SRC.indexOf('sheet.querySelector("#rxMic")'), SRC.indexOf("function bindDel"));

test("voice.js genuinely has no onEnd callback (the premise of the bug)", () => {
  assert.equal(/\bonEnd\b/.test(VOICE_SRC), false, "if voice.js ever gains onEnd, revisit prescription.js");
});

test("Dictate must not rely on the callback voice.js never fires", () => {
  assert.equal(/onEnd\s*:/.test(SRC), false, "prescription.js must not pass onEnd to SMD_VOICE.listen");
});

test("Dictate resets the button on BOTH outcomes voice.js actually delivers", () => {
  assert.match(MIC, /onFinal:[\s\S]*?idle\(\)/, "onFinal resets the mic");
  assert.match(MIC, /onError:[\s\S]*?idle\(\)/, "onError resets the mic");
  assert.match(MIC, /onPartial:/, "and gives live feedback while listening");
});

test("every failure a doctor can hit has a plain-language message", () => {
  ["mic-denied", "no-voice-engine", "stt-unavailable", "clinical-unavailable", "transcription-failed"]
    .forEach((code) => assert.ok(SRC.includes('"' + code + '"'), code + " is explained, not swallowed"));
  // voice.js must not be able to emit a code the Rx pad has no sentence for.
  [...VOICE_SRC.matchAll(/onError\(["']([a-z-]+)["']\)/g)].map((m) => m[1])
    .forEach((c) => assert.ok(SRC.includes('"' + c + '"'), "unhandled voice error code: " + c));
});

test("a dictation that parses to no drug tells the doctor instead of doing nothing", () => {
  assert.match(MIC, /Could not read a drug/, "silence used to be indistinguishable from a broken button");
  assert.match(MIC, /Nothing was heard/);
});
