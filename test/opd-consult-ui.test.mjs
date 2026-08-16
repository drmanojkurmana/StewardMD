/* test/opd-consult-ui.test.mjs — Voice Consult panel: Clinical notes box (editable + Copy/Save),
 * dictated-investigation chips, and the live activity equalizer. Pure _render, no DOM/network.
 * node --test test/opd-consult-ui.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };   // consultBar only renders when the ambient engine is present
  return win.OPDEMR;
}
const base = {
  patient: { name: "Asha", mrn: "M1" }, tab: "assess", assessLoaded: true, assessLoading: false,
  assessVals: {}, assessTouched: {}, writeOn: true, source: "ghis", labs: [], radiology: [], medications: [],
  voiceOn: false, voicePaused: false, voiceProcessing: false,
  voiceTranscript: "fever three days, let's do CBC and LFT", dictatedInv: ["CBC", "LFT"]
};

test("idle-after-stop: editable VoiceNote box with Copy + Save + Clear", () => {
  const html = load()._render(base);
  assert.match(html, /VoiceNote/);                    // renamed from "Clinical notes"
  assert.match(html, /oe-vc-edit/);
  assert.match(html, /data-oe-inp="notes"/);
  assert.match(html, /data-oe-act="notes-save"/);
  assert.match(html, /data-oe-act="notes-copy"/);
  assert.match(html, /data-oe-act="notes-clear"/);    // Clear button
});

test("dictated investigations render as removable/orderable chips", () => {
  const html = load()._render(base);
  assert.ok(html.includes(">CBC<") && html.includes(">LFT<"));
  assert.match(html, /data-oe-act="ivx:0"/);      // remove
  assert.match(html, /data-oe-act="ivorder:0"/);  // order in GHIS
});

test("local (personal clinic) source hides the GHIS order glyph", () => {
  const html = load()._render(Object.assign({}, base, { source: "local" }));
  assert.ok(html.includes(">CBC<"), "chips still shown");
  assert.ok(!html.includes('data-oe-act="ivorder:'), "no GHIS order button off-hospital");
});

test("listening state shows the live activity equalizer", () => {
  const html = load()._render(Object.assign({}, base, { voiceOn: true, voiceStartedAt: 0, _now: 1000 }));
  assert.match(html, /oe-vc-eq/);
});

test("mergeNoteIntoHistory: re-saving refreshes the block instead of duplicating", () => {
  const OE = load();
  const m = OE._mergeNoteIntoHistory;
  // first save into empty history
  const a = m("", "", "fever three days");
  assert.equal(a.text, "fever three days");
  assert.equal(a.saved, "fever three days");
  // dictate more, save again: prior block replaced, not duplicated
  const b = m(a.text, a.saved, "fever three days, cough now");
  assert.equal(b.text, "fever three days, cough now");
  assert.ok(!/fever three days\nfever three days/.test(b.text), "no duplication");
  // existing unrelated history is preserved
  const c = m("Old note here", "", "voice note");
  assert.equal(c.text, "Old note here\nvoice note");
  // nothing to save
  assert.equal(m("x", "", "   "), null);
});

test("Raw/Q&A toggle: Q&A view renders Doctor/Patient turns with the imperfect-caveat", () => {
  const require2 = createRequire(import.meta.url);   // eslint-disable-line
  // Re-load with the diarizer available on the window so qaHtml() produces real turns.
  const SRC2 = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC2)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };
  win.SMD_DIARIZE = require2("../voice-diarize.js");
  const st = Object.assign({}, base, {
    notesView: "qa",
    voiceTranscriptEn: "How long have you had this fever? I have had it for three days."
  });
  const html = win.OPDEMR._render(st);
  assert.match(html, /oe-vc-vtog/);            // the Raw/Q&A toggle
  assert.match(html, /oe-vc-turn dr/);         // a Doctor bubble
  assert.match(html, /oe-vc-turn pt/);         // a Patient bubble
  assert.match(html, /may be imperfect/i);     // honest caveat
});
