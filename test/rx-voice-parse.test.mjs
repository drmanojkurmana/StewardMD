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
