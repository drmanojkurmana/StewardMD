/* test/opd-emr-scribe-ux.test.mjs — Scribe UX (worktree scribe-18):
 *   item 12 - live draft cadence gate (_liveRefineGate)
 *   item 14 - post-consult review panel row building (_buildReviewRows) + the panel's _render markup
 *   item 15 - correction feedback ring buffer (_feedbackPush)
 *   item 18 - consent state machine (_consentReducer/_consentStatus) + the recording banner's _render markup
 * Pure functions first (no DOM/localStorage/timers), then a few _render smoke checks for the new markup.
 * node --test test/opd-emr-scribe-ux.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load(lsOverrides) {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  const ls = Object.assign({ getItem: () => null, setItem: () => {} }, lsOverrides || {});
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, ls);
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };   // consultBar/recordingBanner only need the flag present
  return win.OPDEMR;
}
const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const NO_EMDASH = /—/;

// ---- item 12: _liveRefineGate (cadence cost-guard) ----------------------------------------------
test("_liveRefineGate: a final (doctor-initiated) refine always runs, gate or no gate", () => {
  const OE = load();
  assert.equal(OE._liveRefineGate(1000, 999, 45000, true), true);
  assert.equal(OE._liveRefineGate(1000, 0, 999999, true), true);
});

test("_liveRefineGate: a background tick is blocked before minGapMs and allowed at/after it", () => {
  const OE = load();
  assert.equal(OE._liveRefineGate(10000, 9000, 5000, false), false, "only 1s since the last one, gap is 5s");
  assert.equal(OE._liveRefineGate(15000, 10000, 5000, false), true, "exactly the gap");
  assert.equal(OE._liveRefineGate(20000, 10000, 5000, false), true, "past the gap");
});

test("_liveRefineGate: the very first background tick (lastAt=0) is allowed once nowMs clears minGapMs", () => {
  const OE = load();
  assert.equal(OE._liveRefineGate(44999, 0, 45000, false), false);
  assert.equal(OE._liveRefineGate(45000, 0, 45000, false), true);
});

// ---- item 14: _buildReviewRows --------------------------------------------------------------------
test("_buildReviewRows: one row per filled field, in first-fill order, skipping blanks", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a", "b", "c"], { a: "fever", b: "", c: "cough" }, {}, null);
  assert.deepEqual(rows.map((r) => r.field), ["a", "c"]);
  assert.equal(rows[0].value, "fever");
});

test("_buildReviewRows: dedups a field name that appears twice in `filled`", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a", "a"], { a: "fever" }, {}, null);
  assert.equal(rows.length, 1);
});

test("_buildReviewRows: `changed` is true only when the doctor's touched map has since flipped it", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a", "b"], { a: "fever", b: "cough" }, { a: true }, null);
  assert.equal(rows.find((r) => r.field === "a").changed, true);
  assert.equal(rows.find((r) => r.field === "b").changed, false);
});

test("_buildReviewRows: with no `ground` at all, support is unknown (null) - never badged as unsupported", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a"], { a: "fever" }, {}, null);
  assert.equal(rows[0].supported, null);
});

test("_buildReviewRows: ungroundedFields marks a field unsupported; everything else stays unknown", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a", "b"], { a: "fever", b: "cough" }, {}, { ungroundedFields: ["a"] });
  assert.equal(rows.find((r) => r.field === "a").supported, false);
  assert.equal(rows.find((r) => r.field === "b").supported, null);
});

test("_buildReviewRows: `sources` map - falsy/empty/{supported:false} => unsupported, truthy => supported", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a", "b", "c"], { a: "x", b: "y", c: "z" }, {}, {
    sources: { a: false, b: "the transcript said so", c: { supported: false } }
  });
  assert.equal(rows.find((r) => r.field === "a").supported, false);
  assert.equal(rows.find((r) => r.field === "b").supported, true);
  assert.equal(rows.find((r) => r.field === "c").supported, false);
});

// Matches the REAL server contract (functions/api/ai/_opd-scribe.js, Task 6): the model is told to add
// every populated emrFields key to `sources`, so once a `sources` map is present at all, a filled
// field that is simply MISSING from it is the ungrounded signal - not "unknown".
test("_buildReviewRows: a field missing from a present `sources` map is unsupported, not unknown", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["cc", "allergies"], { cc: "fever x3d", allergies: "penicillin allergy" }, {}, {
    sources: { cc: "patient came with fever for three days" } /* allergies never cited -- fabricated */
  });
  assert.equal(rows.find((r) => r.field === "cc").supported, true);
  assert.equal(rows.find((r) => r.field === "allergies").supported, false);
});

// Forward-compatible with verifySources()'s own return shape ({grounded, ungrounded} field-key
// arrays), read as `ground.ungrounded` for whenever the HTTP response wires that check in.
test("_buildReviewRows: reads ground.ungrounded (verifySources' own field name), not just ungroundedFields", () => {
  const OE = load();
  const rows = OE._buildReviewRows(["a"], { a: "x" }, {}, { ungrounded: ["a"] });
  assert.equal(rows[0].supported, false);
});

test("_render: the review panel lists filled fields, badges an unsupported one, and hides bulk-accept when nothing is confirmable", () => {
  const OE = load();
  const st = {
    patient: { name: "Asha", mrn: "M1" }, tab: "assess", assessLoaded: true, assessLoading: false, writeOn: true, source: "ghis",
    labs: [], radiology: [], medications: [], voiceOn: false, voicePaused: false, voiceProcessing: false,
    assessVals: { Chief_complaints_duration: "fever 3 days" }, assessTouched: {},
    scribeFilledFields: ["Chief_complaints_duration"],
    scribeGround: { ungroundedFields: ["Chief_complaints_duration"] }
  };
  const html = OE._render(st);
  assert.match(html, /Review MaiK/);
  assert.match(html, /Not found in the recording/);
  assert.match(html, /data-oe-act="scribe-review-accept:Chief_complaints_duration"/);
  assert.match(html, /data-oe-act="scribe-review-edit:Chief_complaints_duration"/);
  assert.match(html, /data-oe-act="scribe-review-reject:Chief_complaints_duration"/);
  assert.ok(!/scribe-review-acceptall/.test(html), "the only row is unsupported, so bulk-accept must not appear");
});

test("_render: review panel never appears while still listening/finishing, or with nothing filled", () => {
  const OE = load();
  const base = { patient: { name: "A", mrn: "1" }, tab: "assess", assessLoaded: true, writeOn: true, source: "ghis", labs: [], radiology: [], medications: [], assessVals: { a: "x" }, assessTouched: {}, scribeFilledFields: ["a"] };
  assert.ok(!/Review MaiK/.test(OE._render(Object.assign({}, base, { voiceOn: true }))));
  assert.ok(!/Review MaiK/.test(OE._render(Object.assign({}, base, { voiceProcessing: true }))));
  assert.ok(!/Review MaiK/.test(OE._render(Object.assign({}, base, { scribeFilledFields: [] }))));
});

// ---- item 15: _feedbackPush (correction feedback ring buffer) ------------------------------------
test("_feedbackPush: appends without mutating the input array", () => {
  const OE = load();
  const buf = [{ field: "a", action: "accepted" }];
  const out = OE._feedbackPush(buf, { field: "b", action: "edited" }, 200);
  assert.equal(buf.length, 1, "input untouched");
  assert.equal(out.length, 2);
  assert.equal(out[1].field, "b");
});

test("_feedbackPush: drops the OLDEST entries once over cap, keeping the newest `cap` entries in order", () => {
  const OE = load();
  let buf = [];
  for (let i = 0; i < 5; i++) buf = OE._feedbackPush(buf, { i }, 3);
  assert.deepEqual(buf.map((e) => e.i), [2, 3, 4]);
});

test("_feedbackPush: an entry never carries transcript/audio/patient fields - only what the caller passed", () => {
  const OE = load();
  const entry = { field: "History_present_illness", action: "rejected", lang: "en", t: 12345 };
  const out = OE._feedbackPush([], entry, 200);
  assert.deepEqual(Object.keys(out[0]).sort(), ["action", "field", "lang", "t"]);
});

// ---- item 18: _consentReducer / _consentStatus (per-visit consent state machine) -----------------
test("_consentStatus: no decision yet for a visit is 'unknown'", () => {
  const OE = load();
  assert.equal(OE._consentStatus({}, "visit1"), "unknown");
  assert.equal(OE._consentStatus({ visit1: "granted" }, "visit2"), "unknown");
});

test("_consentReducer: grant/decline set exactly that visit's status, immutably", () => {
  const OE = load();
  const s0 = {};
  const s1 = OE._consentReducer(s0, "visit1", "grant");
  assert.equal(OE._consentStatus(s1, "visit1"), "granted");
  assert.deepEqual(s0, {}, "original store untouched");
  const s2 = OE._consentReducer(s1, "visit2", "decline");
  assert.equal(OE._consentStatus(s2, "visit1"), "granted", "other visits unaffected");
  assert.equal(OE._consentStatus(s2, "visit2"), "declined");
});

test("_consentReducer: a visit's decision can flip (decline then reconsider and grant)", () => {
  const OE = load();
  let s = OE._consentReducer({}, "visit1", "decline");
  assert.equal(OE._consentStatus(s, "visit1"), "declined");
  s = OE._consentReducer(s, "visit1", "grant");
  assert.equal(OE._consentStatus(s, "visit1"), "granted");
});

test("_consentReducer: an unknown action or empty key is a no-op", () => {
  const OE = load();
  const s0 = { visit1: "granted" };
  assert.equal(OE._consentReducer(s0, "visit1", "maybe"), s0);
  assert.equal(OE._consentReducer(s0, "", "grant"), s0);
});

// ---- item 18: the persistent recording banner (_render) ------------------------------------------
test("_render: the recording banner appears while listening (any tab), not while paused or idle", () => {
  const OE = load();
  const base = { patient: { name: "A", mrn: "1" }, tab: "profile", labs: [], radiology: [], medications: [] };
  const on = OE._render(Object.assign({}, base, { voiceOn: true, voicePaused: false, voiceStartedAt: 0, _now: 5000 }));
  assert.match(on, /oe-rec-banner/);
  assert.match(on, /Recording this consultation/);
  const paused = OE._render(Object.assign({}, base, { voiceOn: true, voicePaused: true }));
  assert.ok(!/oe-rec-banner/.test(paused), "paused must not claim it is recording");
  const idle = OE._render(Object.assign({}, base, { voiceOn: false }));
  assert.ok(!/oe-rec-banner/.test(idle));
});

test("_render: the recording banner shows on a non-Assessment tab too (the gap the orb alone left)", () => {
  const OE = load();
  const html = OE._render({ patient: { name: "A", mrn: "1" }, tab: "inv", labs: [], radiology: [], medications: [], invResults: [], invDraft: {}, voiceOn: true, voicePaused: false, voiceStartedAt: 0, _now: 1000 });
  assert.match(html, /oe-rec-banner/);
});

// ---- copy hygiene: no emoji, no em dash, in every new user-facing string this file adds ----------
test("new scribe-UX copy has no emoji and no em dash", () => {
  const OE = load();
  const strings = [
    "Recording this consultation",
    "Review MaiK&#39;s draft",
    "Not found in the recording",
    "Everything MaiK filled while you were speaking. Check each line, then Accept, Edit or Remove it - nothing changes in GHIS until you Save.",
    "Record this consultation? The audio stays on this phone and is not uploaded.",
    "Recording is off for this visit. Tap the mic again any time to turn it on."
  ];
  strings.forEach((s) => { assert.ok(!NO_EMOJI.test(s), s); assert.ok(!NO_EMDASH.test(s), s); });
});
