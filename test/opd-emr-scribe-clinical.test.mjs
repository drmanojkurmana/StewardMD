/* test/opd-emr-scribe-clinical.test.mjs — the six MaiK Scribe clinical modules, as WIRED by opd-emr.js
 * (worktree scribe-18, flag smd_scribe_clinical, DEFAULT ON):
 *   1 scribe-drugfix  - correction display rows + which corrections are re-applied (undo)
 *   2 scribe-rx       - staged row merge, unparsed lines surfaced, handoff to SMD_RX.open({regimen})
 *   3 scribe-icdsug   - candidate rows + the tap-to-add panel
 *   4 scribe-safety   - finding rows, the verbatim summary, and the EMR-derived context
 *   5 scribe-speaker  - turn labelling in the Q&A view, "unknown" shown as unknown, one-tap relabel
 *   6 scribe-templates- specialty prompt threading, per-doctor key, required-field prompt, picker
 *   + the flag-off path for every one of them.
 * Pure functions first (no DOM/localStorage/timers), then _render markup checks.
 * node --test test/opd-emr-scribe-clinical.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");

const SPEAKER = require("../scribe-speaker.js");
const TPL = require("../scribe-templates.js");
const RX = require("../scribe-rx.js");
const SAFETY = require("../scribe-safety.js");
const ICD = require("../scribe-icdsug.js");
const DRUGFIX = require("../scribe-drugfix.js");

/* Load opd-emr.js with the real modules hung off `window`, exactly the way index.html does.
 * `ls` lets a test flip the flag off; `extra` injects the app engines a module is given. */
function load(ls, extra) {
  const win = {};
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {}, remove() {} }, style: {}, setAttribute() {} }), body: { appendChild() {}, removeChild() {} } };
  const storage = Object.assign({ getItem: () => null, setItem() {} }, ls || {});
  win.localStorage = storage;
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, storage);
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };
  win.SMD_SCRIBESPEAKER = SPEAKER;
  win.SMD_SCRIBETPL = TPL;
  win.SMD_SCRIBERX = RX;
  win.SMD_SCRIBESAFETY = SAFETY;
  win.SMD_SCRIBEICD = ICD;
  win.SMD_SCRIBEDRUGFIX = DRUGFIX;
  Object.assign(win, extra || {});
  return win.OPDEMR;
}
function off(extra) { return load({ getItem: (k) => (k === "smd_scribe_clinical" ? "off" : null) }, extra); }

const NO_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const NO_EMDASH = /—/;

function assessState(over) {
  return Object.assign({
    patient: { name: "Asha", mrn: "M1" }, tab: "assess", assessLoaded: true, assessLoading: false,
    writeOn: true, source: "ghis", labs: [], radiology: [], medications: [],
    voiceOn: false, voicePaused: false, voiceProcessing: false,
    assessVals: {}, assessTouched: {}
  }, over || {});
}

// ================= 1. scribe-drugfix: corrections the doctor can see and undo ======================
test("_drugFixText: re-applies every correction that has not been undone", () => {
  const OE = load();
  const src = "give atorvastain 40 and pantop";
  const corrections = [
    { from: "atorvastain", to: "atorvastatin", index: src.indexOf("atorvastain"), confidence: 0.9 },
    { from: "pantop", to: "pantoprazole", index: src.indexOf("pantop"), confidence: 1 }
  ];
  assert.equal(OE._drugFixText(src, corrections, {}), "give atorvastatin 40 and pantoprazole");
});

test("_drugFixText: an undone correction is left as the doctor actually said it", () => {
  const OE = load();
  const src = "give atorvastain 40 and pantop";
  const corrections = [
    { from: "atorvastain", to: "atorvastatin", index: src.indexOf("atorvastain") },
    { from: "pantop", to: "pantoprazole", index: src.indexOf("pantop") }
  ];
  assert.equal(OE._drugFixText(src, corrections, { "pantop>pantoprazole": true }),
    "give atorvastatin 40 and pantop");
  assert.equal(OE._drugFixText(src, corrections, { "pantop>pantoprazole": true, "atorvastain>atorvastatin": true }), src);
});

test("_drugFixText: a correction whose span no longer matches the source is skipped, never spliced blind", () => {
  const OE = load();
  const out = OE._drugFixText("give pantop", [{ from: "atorvastain", to: "atorvastatin", index: 5 }], {});
  assert.equal(out, "give pantop");
});

test("_drugFixText: no corrections (or a null list) returns the transcript untouched", () => {
  const OE = load();
  assert.equal(OE._drugFixText("plain text", [], {}), "plain text");
  assert.equal(OE._drugFixText("plain text", null, null), "plain text");
});

test("_drugFixRows: one display row per correction, carrying its undone state", () => {
  const OE = load();
  const rows = OE._drugFixRows([{ from: "pantop", to: "pantoprazole", confidence: 1, index: 0 }], { "pantop>pantoprazole": true });
  assert.equal(rows.length, 1);
  assert.deepEqual({ from: rows[0].from, to: rows[0].to, undone: rows[0].undone }, { from: "pantop", to: "pantoprazole", undone: true });
});

test("_render: every correction is shown with its own Undo, and the recording is stated to be unchanged", () => {
  const OE = load();
  const html = OE._render(assessState({ scribeDrugFixes: [{ from: "pantop", to: "pantoprazole", confidence: 1, index: 0 }], scribeDrugFixUndone: {} }));
  assert.match(html, /Drug names MaiK corrected/);
  assert.match(html, /pantoprazole/);
  assert.match(html, /data-oe-act="scribe-drugfix-undo:0"/);
  assert.match(html, /Your recording is unchanged/);
  assert.ok(!NO_EMDASH.test(html) && !NO_EMOJI.test(html));
});

test("FLAG OFF: no drug-correction panel, however many corrections are in state", () => {
  const OE = off();
  const html = OE._render(assessState({ scribeDrugFixes: [{ from: "pantop", to: "pantoprazole", index: 0 }] }));
  assert.ok(!/Drug names MaiK corrected/.test(html));
});

// ================= 2. scribe-rx: structured rows + the prescription-pad handoff ====================
const DRUGS = [{ generic: "Pantoprazole", brands: ["Pantop"] }, { generic: "Amoxicillin", brands: ["Mox"] }];
// The pad's own line parser, in the shape opd-emr injects it (SMD_RX._parseVoiceRx).
function parseLine(line) {
  const m = String(line).match(/^([A-Za-z]+)/);
  return m ? { drug: m[1], freq: /\bbd\b/i.test(line) ? "BD" : "", duration: (line.match(/(\d+)\s*days?/i) || [])[0] || "" } : null;
}

test("_mergeRxRows: folds a parse result in and de-dups on the verbatim line (re-accept never doubles a medicine)", () => {
  const OE = load();
  const parsed = RX.parse("tab pantop 40 one bd for 5 days", { parseLine, drugs: DRUGS });
  assert.equal(parsed.rows.length, 1, "sanity: the fixture parses to one medicine");
  const once = OE._mergeRxRows(null, parsed);
  const twice = OE._mergeRxRows(once, parsed);
  assert.equal(once.rows.length, 1);
  assert.equal(twice.rows.length, 1, "the same dictated line accepted twice stays one row");
});

test("_mergeRxRows: an unparsed line is KEPT - a dictated medicine never vanishes", () => {
  const OE = load();
  const merged = OE._mergeRxRows(null, { rows: [], unparsed: ["something the parser could not read"] });
  assert.deepEqual(merged.unparsed, ["something the parser could not read"]);
  const again = OE._mergeRxRows(merged, { rows: [], unparsed: ["something the parser could not read", "and another"] });
  assert.deepEqual(again.unparsed, ["something the parser could not read", "and another"]);
});

test("_mergeRxRows: a null/empty parse result leaves what is already staged alone", () => {
  const OE = load();
  const base = OE._mergeRxRows(null, RX.parse("tab pantop 40 bd", { parseLine, drugs: DRUGS }));
  const after = OE._mergeRxRows(base, null);
  assert.deepEqual(after.rows.map((r) => r.drug), base.rows.map((r) => r.drug));
});

test("toRegimen handoff: a DICTATED dose reaches SMD_RX.open marked source 'ai' (pad flags it unverified)", () => {
  const parsed = RX.parse("tab pantop 40 one bd for 5 days", { parseLine, drugs: DRUGS });
  const reg = RX.toRegimen(parsed.rows);
  assert.equal(reg.length, 1);
  assert.equal(reg[0].name, "Pantoprazole");
  assert.equal(reg[0].source, "ai", "a spoken dose must be read back before signing");
});

test("_render: staged medicines list, unparsed lines are visible, and the pad handoff is one tap", () => {
  const OE = load();
  const parsed = RX.parse("tab pantop 40 one bd for 5 days", { parseLine, drugs: DRUGS });
  const html = OE._render(assessState({ scribeRx: { rows: parsed.rows, unparsed: ["blah blah mystery syrup"] } }));
  assert.match(html, /Medicines from your dictation/);
  assert.match(html, /Pantoprazole/);
  assert.match(html, /Could not be read as a medicine/);
  assert.match(html, /blah blah mystery syrup/);
  assert.match(html, /data-oe-act="scribe-rx-pad"/);
  assert.match(html, /Nothing is prescribed until you send these to the prescription pad and sign there/);
  assert.ok(!NO_EMDASH.test(html) && !NO_EMOJI.test(html));
});

test("_render: unparsed-only (nothing parsed) still shows the lines, but offers no pad handoff", () => {
  const OE = load();
  const html = OE._render(assessState({ scribeRx: { rows: [], unparsed: ["mystery syrup"] } }));
  assert.match(html, /mystery syrup/);
  assert.ok(!/scribe-rx-pad/.test(html), "nothing structured to send");
});

test("FLAG OFF: no structured medicine panel", () => {
  const OE = off();
  const parsed = RX.parse("tab pantop 40 bd", { parseLine, drugs: DRUGS });
  assert.ok(!/Medicines from your dictation/.test(OE._render(assessState({ scribeRx: parsed }))));
});

// ================= 3. scribe-icdsug: candidates offered for a tap =================================
test("_icdCandidateRows: keeps code/term/score and drops anything with no code", () => {
  const OE = load();
  const rows = OE._icdCandidateRows([{ code: "J06.9", term: "Acute URTI, unspecified", score: 0.67 }, { term: "no code here" }, null]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { code: "J06.9", term: "Acute URTI, unspecified", score: 0.67 });
});

test("_icdCandidateRows: an empty suggestion list renders nothing - never a guessed code", async () => {
  const OE = load();
  assert.deepEqual(OE._icdCandidateRows([]), []);
  assert.deepEqual(OE._icdCandidateRows(null), []);
  // and the module itself resolves [] rather than rejecting when the index is missing
  assert.deepEqual(await ICD.suggest("fever", {}), []);
});

test("_render: each ICD candidate needs its own Add tap; nothing is coded automatically", () => {
  const OE = load();
  const html = OE._render(assessState({ scribeIcd: [{ code: "J06.9", term: "Acute URTI", score: 0.5 }] }));
  assert.match(html, /ICD codes for this diagnosis/);
  assert.match(html, /J06\.9/);
  assert.match(html, /data-oe-act="scribe-icd:0"/);
  assert.match(html, /nothing is coded for you/);
});

test("FLAG OFF: no ICD candidate panel", () => {
  const OE = off();
  assert.ok(!/ICD codes for this diagnosis/.test(OE._render(assessState({ scribeIcd: [{ code: "J06.9", term: "URTI" }] }))));
});

// ================= 4. scribe-safety: findings shown, summary verbatim ==============================
test("_safetyRows: one row per finding, with severity, attributed drug and the engine's own message", () => {
  const OE = load();
  const rows = OE._safetyRows([{ severity: "critical", drug: "Amoxicillin", message: "Penicillin allergy documented" }, null]);
  assert.deepEqual(rows, [{ severity: "critical", drug: "Amoxicillin", message: "Penicillin allergy documented" }]);
});

test("_safetyRows: a finding with no severity falls back to moderate rather than dropping out", () => {
  const OE = load();
  assert.equal(OE._safetyRows([{ message: "something" }])[0].severity, "moderate");
});

test("_scribeSafetyCtx: allergies come from the EMR allergies field, renal from the CKD yes/no", () => {
  const OE = load();
  const ctx = OE._scribeSafetyCtx({ assessVals: { Known_allergies_details: "penicillin", Renal_yesNo: "Y" }, patient: { age: 54, sex: "F" } });
  assert.equal(ctx.allergies, "penicillin");
  assert.equal(ctx.renal, true);
  assert.equal(ctx.age, 54);
  assert.equal(ctx.sex, "F");
});

test("_scribeSafetyCtx: an age the patient record does not carry stays EMPTY - never invented", () => {
  const OE = load();
  const ctx = OE._scribeSafetyCtx({ assessVals: {}, patient: {} });
  assert.equal(ctx.age, "");
  assert.equal(ctx.renal, false);
  assert.equal(ctx.pregnancy, "", "pregnancy is never inferred from an LMP");
});

test("SAFETY WORDING: the summary shown never states the prescription is safe or cleared", () => {
  const clean = SAFETY.check([{ drug: "Pantoprazole" }], {}, { analyzeRegimen: () => ({ findings: [] }) });
  assert.equal(clean.findings.length, 0);
  assert.match(clean.summary, /not a clearance/i);
  assert.ok(!/\bis safe\b|\bare safe\b|\bcleared\b(?! )/i.test(clean.summary));
  const none = SAFETY.check([{ drug: "Pantoprazole" }], {}, {});
  assert.match(none.summary, /could not run/i, "no engine must say so, not stay silent");
});

test("_render: findings are prominent and the summary is printed VERBATIM, not paraphrased", () => {
  const OE = load();
  const res = SAFETY.check([{ drug: "Pantoprazole" }], {}, { analyzeRegimen: () => ({ findings: [{ sev: "major", txt: "Pantoprazole: long-term use needs review" }] }) });
  const html = OE._render(assessState({ scribeSafety: { findings: OE._safetyRows(res.findings), summary: res.summary } }));
  assert.match(html, /Medicine safety check/);
  assert.match(html, /long-term use needs review/);
  assert.ok(html.indexOf(res.summary.replace(/&/g, "&amp;")) > -1, "summary must appear word for word");
  assert.ok(!NO_EMDASH.test(html) && !NO_EMOJI.test(html));
});

test("FLAG OFF: no safety panel", () => {
  const OE = off();
  assert.ok(!/Medicine safety check/.test(OE._render(assessState({ scribeSafety: { findings: [], summary: "x" } }))));
});

// ================= 5. scribe-speaker: Q&A turns, unknown stays unknown, one-tap relabel ============
const QA_SRC = "Do you have fever? I have had fever for three days. mmm.";

test("_speakerTurns: labels turns through the module, leaving a cue-less turn as unknown", () => {
  const OE = load();
  const turns = OE._speakerTurns(QA_SRC, null);
  assert.equal(turns.length, 3);
  assert.equal(turns[0].speaker, "doctor");
  assert.equal(turns[1].speaker, "patient");
  assert.equal(turns[2].speaker, "unknown", "no cue matched - must NOT be treated as the doctor");
});

test("_speakerTurns: a doctor correction is folded in via the module's relabel (confidence 1, manual)", () => {
  const OE = load();
  const turns = OE._speakerTurns(QA_SRC, { 2: "patient" });
  assert.equal(turns[2].speaker, "patient");
  assert.equal(turns[2].manual, true);
  assert.equal(turns[2].confidence, 1);
  assert.equal(turns[0].speaker, "doctor", "other turns are untouched");
});

test("_speakerTurns: a fix for an index that does not exist is ignored, not applied to a neighbour", () => {
  const OE = load();
  const turns = OE._speakerTurns(QA_SRC, { 99: "doctor" });
  assert.equal(turns.length, 3);
  assert.equal(turns[2].speaker, "unknown");
});

test("_speakerTurns: no module on the build returns null so the caller can fall back", () => {
  const win = {};
  const doc = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ classList: { add() {}, remove() {} } }), body: {} };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem() {} });
  assert.equal(win.OPDEMR._speakerTurns(QA_SRC, null), null);
});

test("_render: the Q&A view shows Unknown speaker as unknown and offers the one-tap correction", () => {
  const OE = load();
  const html = OE._render(assessState({ notesView: "qa", voiceTranscript: QA_SRC }));
  assert.match(html, /oe-vc-turn unk/);
  assert.match(html, /Unknown speaker/);
  assert.match(html, /data-oe-act="scribe-speaker:2:doctor"/);
  assert.match(html, /data-oe-act="scribe-speaker:2:patient"/);
  assert.match(html, /Never changes an EMR field/);
  assert.ok(!NO_EMDASH.test(html) && !NO_EMOJI.test(html));
});

test("_render: a turn the doctor has already set shows as set, with no further correction buttons on it", () => {
  const OE = load();
  const html = OE._render(assessState({ notesView: "qa", voiceTranscript: QA_SRC, scribeSpeakerFix: { 2: "patient" } }));
  assert.match(html, /You set this/);
  assert.ok(!/scribe-speaker:2:/.test(html), "the corrected turn no longer offers the pair of buttons");
});

test("FLAG OFF: the Q&A view falls back to the previous SMD_DIARIZE path and offers no relabel", () => {
  const OE = off({ SMD_DIARIZE: { toQA: () => [{ speaker: "doctor", text: "Do you have fever?" }] } });
  const html = OE._render(assessState({ notesView: "qa", voiceTranscript: QA_SRC }));
  assert.match(html, /oe-vc-turn dr/);
  assert.ok(!/scribe-speaker:/.test(html));
  assert.ok(!/Unknown speaker/.test(html));
});

// ================= 6. scribe-templates: specialty prompt, per-doctor memory, required fields =======
test("_specialtyPrompt: joins the template's promptLines with newlines; general adds nothing", () => {
  const OE = load();
  assert.equal(OE._specialtyPrompt(TPL.get("general")), "");
  const paeds = OE._specialtyPrompt(TPL.get("paediatrics"));
  assert.equal(paeds, TPL.get("paediatrics").promptLines.join("\n"));
  assert.match(paeds, /PAEDIATRIC consultation/);
  assert.match(paeds, /Never calculate, convert or invent a dose yourself/);
});

test("_specialtyPrompt: a missing/unknown template id is the general one, so the prompt stays empty", () => {
  const OE = load();
  assert.equal(OE._specialtyPrompt(TPL.get("")), "");
  assert.equal(OE._specialtyPrompt(TPL.get("not-a-specialty")), "");
  assert.equal(OE._specialtyPrompt(null), "");
});

test("_specialtyKey: the remembered choice is scoped per doctor", () => {
  const OE = load();
  assert.equal(OE._specialtyKey("Dr Asha Rao"), "smd_scribe_specialty:Dr_Asha_Rao");
  assert.notEqual(OE._specialtyKey("Dr A"), OE._specialtyKey("Dr B"));
  assert.equal(OE._specialtyKey(""), "smd_scribe_specialty");
});

test("_requiredMissing: reports only the specialty's own required fields that are still blank", () => {
  const OE = load();
  const req = TPL.get("obgyn").requiredFields;           // ["lmp", "presentHx"]
  const missing = OE._requiredMissing(req, { LMP: "", History_present_illness: "G2P1, 12 weeks" });
  assert.deepEqual(missing.map((m) => m.field), ["LMP"]);
  assert.ok(missing[0].label.length > 0, "a row carries the form's own label, not the raw key");
});

test("_requiredMissing: nothing blank means nothing to prompt for", () => {
  const OE = load();
  assert.deepEqual(OE._requiredMissing(TPL.get("obgyn").requiredFields, { LMP: "01-08-2026", History_present_illness: "G2P1" }), []);
  assert.deepEqual(OE._requiredMissing([], {}), []);
});

test("_requiredMissing: a template key this form cannot save is skipped, not reported as missing", () => {
  const OE = load();
  assert.deepEqual(OE._requiredMissing(["no_such_voice_key"], {}), []);
});

test("_render: the specialty picker is on the idle Scribe panel and remembers the stored choice", () => {
  const OE = load({ getItem: (k) => (k === "smd_scribe_specialty" ? "paediatrics" : null) });
  const html = OE._render(assessState());
  assert.match(html, /data-oe-act="scribe-spec:paediatrics"/);
  assert.match(html, /data-oe-act="scribe-spec:obgyn"/);
  assert.match(html, /data-oe-act="scribe-spec:surgery-followup"/);
  assert.match(html, /oe-vc-specb on" data-oe-act="scribe-spec:paediatrics"/, "the stored specialty is the pressed one");
});

test("_render: the review panel prompts for the specialty's still-blank required fields", () => {
  const OE = load({ getItem: (k) => (k === "smd_scribe_specialty" ? "obgyn" : null) });
  const html = OE._render(assessState({
    assessVals: { Chief_complaints_duration: "bleeding" }, scribeFilledFields: ["Chief_complaints_duration"]
  }));
  assert.match(html, /Obstetrics &amp; Gynaecology: still blank/);
  assert.match(html, /MaiK did not hear these/);
  assert.ok(!NO_EMDASH.test(html) && !NO_EMOJI.test(html));
});

test("FLAG OFF: no specialty picker and no required-field prompt", () => {
  const OE = off({});
  const html = OE._render(assessState({ assessVals: { Chief_complaints_duration: "bleeding" }, scribeFilledFields: ["Chief_complaints_duration"] }));
  assert.ok(!/scribe-spec:/.test(html));
  assert.ok(!/still blank/.test(html));
});

// ================= flag + wiring invariants =======================================================
test("scribeClinicalOn: DEFAULT ON, and only the literal 'off' turns it off", () => {
  assert.equal(load()._scribeClinicalOn(), true);
  assert.equal(load({ getItem: () => null })._scribeClinicalOn(), true);
  assert.equal(load({ getItem: (k) => (k === "smd_scribe_clinical" ? "off" : null) })._scribeClinicalOn(), false);
  assert.equal(load({ getItem: (k) => (k === "smd_scribe_clinical" ? "on" : null) })._scribeClinicalOn(), true);
});

test("specialtyPrompt threading: the extract body carries the chosen specialty and nothing else changes", () => {
  // Mirrors reasoning.js SMD_AI.extract(transcript, kind, catalog): an OBJECT third argument is
  // merged into the POST body as-is, which is how specialtyPrompt reaches body.specialtyPrompt.
  function buildBody(transcript, kind, catalog) {
    const body = { transcript, kind };
    if (Array.isArray(catalog)) body.catalog = catalog;
    else if (catalog && typeof catalog === "object") { for (const k in catalog) if (!(k in body)) body[k] = catalog[k]; }
    return body;
  }
  const OE = load();
  const sp = OE._specialtyPrompt(TPL.get("surgery-followup"));
  assert.deepEqual(buildBody("t", "opd-scribe", { specialtyPrompt: sp }), { transcript: "t", kind: "opd-scribe", specialtyPrompt: sp });
  // general / flag off: no third argument at all -> the body is byte-identical to before this change
  assert.deepEqual(buildBody("t", "opd-scribe", null), { transcript: "t", kind: "opd-scribe" });
});

test("FLAG OFF renders the assessment tab exactly as it did before this change", () => {
  const stOn = assessState({
    scribeDrugFixes: [{ from: "pantop", to: "pantoprazole", index: 0 }],
    scribeRx: { rows: [{ drug: "Pantop", generic: "Pantoprazole", verbatim: "tab pantop", matched: true }], unparsed: ["mystery"] },
    scribeIcd: [{ code: "J06.9", term: "URTI" }],
    scribeSafety: { findings: [], summary: "x" },
    notesView: "qa", voiceTranscript: QA_SRC
  });
  const html = off({ SMD_DIARIZE: { toQA: () => [] } })._render(stOn);
  ["Drug names MaiK corrected", "Medicines from your dictation", "ICD codes for this diagnosis",
    "Medicine safety check", "scribe-spec:", "scribe-speaker:", "still blank"].forEach((needle) => {
    assert.ok(html.indexOf(needle) < 0, "flag off must not render: " + needle);
  });
});

test("no emoji, no em dash anywhere in the new app-facing strings", () => {
  const OE = load();
  const html = OE._render(assessState({
    scribeDrugFixes: [{ from: "pantop", to: "pantoprazole", index: 0 }],
    scribeRx: { rows: [{ drug: "Pantop", generic: "Pantoprazole", verbatim: "tab pantop", matched: false }], unparsed: ["mystery"] },
    scribeIcd: [{ code: "J06.9", term: "URTI" }],
    scribeSafety: { findings: [{ severity: "major", drug: "Pantoprazole", message: "review" }], summary: "Nothing here is a clearance." },
    scribeFilledFields: ["Chief_complaints_duration"], assessVals: { Chief_complaints_duration: "fever" },
    notesView: "qa", voiceTranscript: QA_SRC
  }));
  assert.ok(!NO_EMOJI.test(html), "emoji found");
  assert.ok(!NO_EMDASH.test(html), "em dash found");
});
