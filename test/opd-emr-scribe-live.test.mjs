/* test/opd-emr-scribe-live.test.mjs — THE LIVE PATH, end to end, through the real functions.
 *
 * Written after the 2026-09-20 owner report from a real iPhone: (1) autofill into the OPD Assessment
 * form was broken, (2) live transcription no longer appeared while speaking, (3) the live English
 * translation was gone. Each of the three is one link in ONE chain, and nothing tested that chain as
 * a chain — every existing test drove a single link with the next one stubbed out. So this file wires
 * the REAL modules together (voice-vitals -> voice-emr-map -> voice-ambient -> opd-emr) and drives
 * them with a fake microphone and a fake /api/ai/extract, asserting the three things the doctor sees:
 *
 *   chunk -> SMD_AMBIENT tick -> onTranscript -> setTranscript      -> the transcript box has the words
 *   chunk -> tick -> apply -> reduce -> onUpdate -> applyVoice
 *                 -> _voiceMerge -> st.assessVals -> putVoiceDom    -> the form input has the value
 *   refine -> applyScribeResult -> _applyRefine -> _voiceMerge      -> comorbidities TICKED
 *          -> st.voiceTranscriptEn                                  -> the bilingual view has English
 *
 * and, just as important, that NOTHING is invented: a field nobody spoke about stays empty.
 *
 * node --test test/opd-emr-scribe-live.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const _sT = globalThis.setTimeout, _sI = globalThis.setInterval;
globalThis.setTimeout = function (fn, ms) { const t = _sT(fn, ms); if (t && t.unref) t.unref(); return t; };
globalThis.setInterval = function (fn, ms) { const t = _sI(fn, ms); if (t && t.unref) t.unref(); return t; };

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const SRC = {
  vitals: read("voice-vitals.js"), map: read("voice-emr-map.js"),
  ambient: read("voice-ambient.js"), emr: read("opd-emr.js")
};

// A realistic Indian-OPD consult, exactly as the owner phrased the bar for it.
const CONSULT_A = "Doctor: come in, sit down. Patient: I am a known diabetic for five years, I take metformin. ";
const CONSULT_B = "Doctor: BP is 140 by 90, pulse 88, temperature 101. Any vomiting? Patient: no vomiting. Doctor: chest pain? Patient: no, denies chest pain. ";
const CONSULT = CONSULT_A + CONSULT_B;

/* ── a DOM just real enough that putVoiceDom / setTranscript actually write somewhere ──────────── */
function makeDoc() {
  const inputs = {};          // "assess:<field>" -> [fake input]
  const byId = {};
  function el(extra) {
    const e = Object.assign({
      classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; }, contains(c) { return !!this._s[c]; } },
      querySelector: () => null, querySelectorAll: () => [], appendChild() {}, closest: () => null,
      innerHTML: "", textContent: "", value: "", checked: false, style: {}, focus() {}
    }, extra || {});
    e.parentNode = { scrollHeight: 100, scrollTop: 0 };
    return e;
  }
  function input(name, kind) {
    const e = el({ type: kind === "check" ? "checkbox" : "text" });
    if (kind === "yesno") return [el({ type: "radio", value: "Y" }), el({ type: "radio", value: "N" })];
    return [e];
  }
  const doc = {
    _inputs: inputs,
    getElementById: (id) => byId[id] || null,
    createElement: () => el(),
    querySelector: (sel) => { const m = /assess:([^"\]]+)/.exec(sel); return (m && inputs[m[1]] && inputs[m[1]][0]) || null; },
    querySelectorAll: (sel) => { const m = /assess:([^"\]]+)/.exec(sel); return (m && inputs[m[1]]) || []; },
    body: { appendChild() {} }, activeElement: null,
    _field(name, kind) { inputs[name] = input(name, kind); return inputs[name]; },
    _mkId(id) { byId[id] = el(); return byId[id]; }
  };
  return doc;
}

/* ── the whole stack in one window, plus a fake mic and a fake cloud ───────────────────────────── */
function boot(ls0) {
  const store = Object.assign({}, ls0);
  const ls = { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem(k, v) { store[k] = String(v); } };
  const win = { localStorage: ls, navigator: { onLine: true }, console, setTimeout, clearTimeout, toast() {} };
  const doc = makeDoc();
  doc._mkId("oeTranscript");
  new Function("window", "module", "require", SRC.vitals)(win);
  new Function("window", "module", "require", SRC.map)(win);
  new Function("window", "module", "require", SRC.ambient)(win);

  // fake microphone: every listen() is a capture window whose onFinal we fire by hand
  const windows = [];
  win.SMD_VOICE = {
    pickModel: (l) => (l === "en" ? "small-q8_0" : "telugu-small-q8_0"),
    modelCode: (k) => k, probeModel: () => "small-q8_0",
    listen(o) { const s = { opts: o, stop() {} }; windows.push(s); return s; }
  };
  // fake cloud: resolves from a queue, records what went up
  const calls = [], queue = [];
  win.SMD_AI = { extract(text, kind, opts) { calls.push({ text, kind, opts: opts || {} }); const r = queue.shift(); return Promise.resolve(r === undefined ? {} : r); } };

  new Function("window", "document", "location", "localStorage", SRC.emr)(win, doc, { search: "" }, ls);
  const OE = win.OPDEMR, st = OE._state();
  st.assessVals = {}; st.assessTouched = {}; st.writeOn = true; st.tab = "assess";
  // the form inputs the autofill has to reach
  [["Chief_complaints_duration"], ["History_present_illness"], ["Diabetes_details"], ["Temp"], ["BP_SYS"],
   ["BP_dia"], ["Pulse"], ["respiratory"], ["spo2"], ["grbs"], ["Height"], ["Weight"], ["pain_score"],
   ["Hypertension_details"]].forEach(([n]) => doc._field(n, "text"));
  ["Diabetes_yesNo", "Hypertension_yesNo", "Cardiac_yesNo", "Bronchial_yesNo", "Tuberculosis_yesNo",
   "Thyroid_yesNo", "Epilepsy_yesNo", "Renal_yesNo", "Liver_yesNo", "Cancer_yesNo", "Cva_yesNo",
   "Dyslipidemia_yesNo", "Family_history_yesno", "Habitat_addiction_yesno"].forEach((n) => doc._field(n, "yesno"));
  ["Family_history_diabetics", "Family_history_hypertension", "Family_history_Heart", "Family_history_cancer",
   "Family_history_TB", "Family_history_asthma", "Habitat_addiction_alcohol", "Habitat_addiction_smoking",
   "Habitat_addiction_drug", "Habitat_addiction_tobacco"].forEach((n) => doc._field(n, "check"));
  return { win, doc, OE, st, windows, calls, queue };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const transcriptBox = (h) => h.doc.getElementById("oeTranscript").textContent;
const domValue = (h, name) => h.doc._inputs[name][0].value;
const ynChecked = (h, name) => (h.doc._inputs[name].filter((r) => r.checked)[0] || {}).value;
const checkOn = (h, name) => !!h.doc._inputs[name][0].checked;

/* ══ LINK 1+2: the mic to the screen and to the form, with no cloud at all ═════════════════════ */
test("a chunk lands: the transcript box shows the words AND the vitals reach the form inputs", async () => {
  const h = boot();
  h.OE._startVoice();
  assert.ok(h.windows.length, "startVoice armed a capture window");
  h.windows[0].opts.onFinal(CONSULT_A);
  assert.match(transcriptBox(h), /known diabetic for five years/, "live transcription, as they speak");

  h.windows[1].opts.onFinal(CONSULT_B);
  assert.match(transcriptBox(h), /known diabetic/, "the box accumulates, it does not restart");
  assert.match(transcriptBox(h), /temperature 101/);

  // The vitals below were already in place the instant onFinal returned: nothing has been awaited
  // since, so no network reply can have landed. The deterministic layer fills the form on its own.
  assert.equal(h.st.assessVals.BP_SYS, "140");
  assert.equal(h.st.assessVals.BP_dia, "90");
  assert.equal(h.st.assessVals.Pulse, "88");
  assert.equal(h.st.assessVals.Temp, "101");
  assert.equal(domValue(h, "BP_SYS"), "140", "putVoiceDom actually wrote the input, not just the state");
  assert.equal(domValue(h, "Pulse"), "88");
  h.OE._stopVoice();
});

test("a doctor-edited field is never overwritten by what is then dictated", async () => {
  const h = boot();
  h.st.assessVals.Pulse = "72"; h.st.assessTouched.Pulse = true;
  h.OE._startVoice();
  h.windows[0].opts.onFinal(CONSULT_B);
  assert.equal(h.st.assessVals.Pulse, "72", "the doctor's own value stands");
  assert.equal(h.st.assessVals.Temp, "101", "everything else still fills");
  h.OE._stopVoice();
});

/* ══ LINK 3: the refine — comorbidities TICK, the translation lands, nothing is invented ═══════ */
test("the refine ticks the comorbidity, fills the details, and sets the English translation", async () => {
  const h = boot();
  h.queue.push({
    en: CONSULT,
    emrFields: {
      cc: "Fever", presentHx: "Fever, denies vomiting and chest pain",
      dm: "Yes", dmDetails: "Type 2 DM x 5 years on Metformin", htn: "No"
    },
    suggestions: { provisionalDx: "", ddx: [], investigations: [] }
  });
  await h.OE._doRefine(CONSULT, true);
  await tick(); await tick();

  assert.equal(h.st.assessVals.Diabetes_yesNo, "Y", 'the patient said diabetic -> Diabetes is ticked "Y"');
  assert.equal(ynChecked(h, "Diabetes_yesNo"), "Y", "and the radio in the form is actually checked");
  assert.equal(h.st.assessVals.Diabetes_details, "Type 2 DM x 5 years on Metformin");
  assert.equal(h.st.assessVals.Hypertension_yesNo, "N", "an explicit No is recorded as No");
  assert.equal(h.st.assessVals.Chief_complaints_duration, "Fever");
  assert.ok(h.st.voiceTranscriptEn.indexOf("known diabetic") >= 0, "the English translation is kept for the bilingual view");

  // vitals come from the deterministic extractor run over the translation, not from the LLM
  assert.equal(h.st.assessVals.BP_SYS, "140");
  assert.equal(h.st.assessVals.Temp, "101");

  // NOTHING INVENTED: no cardiac/asthma/TB/thyroid/epilepsy/CKD/CLD/cancer/CVA/lipids were discussed
  ["Cardiac_yesNo", "Bronchial_yesNo", "Tuberculosis_yesNo", "Thyroid_yesNo", "Epilepsy_yesNo",
   "Renal_yesNo", "Liver_yesNo", "Cancer_yesNo", "Cva_yesNo", "Dyslipidemia_yesNo",
   "Family_history_yesno", "Habitat_addiction_yesno"].forEach((n) => {
    assert.equal(h.st.assessVals[n], undefined, n + " was never mentioned and must stay empty");
  });
  assert.equal(h.st.assessVals.spo2, undefined, "SpO2 was never spoken");
  assert.equal(h.st.assessVals.Height, undefined);
});

test("every comorbidity, family-history and habit key the server can emit reaches its form field", () => {
  const h = boot();
  const YES = {
    dm: "Diabetes_yesNo", htn: "Hypertension_yesNo", cardiac: "Cardiac_yesNo", asthma: "Bronchial_yesNo",
    tb: "Tuberculosis_yesNo", thyroid: "Thyroid_yesNo", epilepsy: "Epilepsy_yesNo", ckd: "Renal_yesNo",
    cld: "Liver_yesNo", cancer: "Cancer_yesNo", cva: "Cva_yesNo", dyslipidemia: "Dyslipidemia_yesNo",
    familyHistory: "Family_history_yesno", habits: "Habitat_addiction_yesno"
  };
  const CHECKS = {
    familyDiabetes: "Family_history_diabetics", familyHtn: "Family_history_hypertension",
    familyHeart: "Family_history_Heart", familyCancer: "Family_history_cancer",
    familyTb: "Family_history_TB", familyAsthma: "Family_history_asthma",
    alcohol: "Habitat_addiction_alcohol", smoking: "Habitat_addiction_smoking",
    recDrug: "Habitat_addiction_drug", tobacco: "Habitat_addiction_tobacco"
  };
  const updates = Object.keys(YES).concat(Object.keys(CHECKS)).map((f) => ({ field: f, value: "Yes", applied: true }));
  const m = h.OE._voiceMerge({}, {}, updates);
  Object.keys(YES).forEach((f) => assert.equal(m.vals[YES[f]], "Y", f + ' -> ' + YES[f] + ' must be "Y"'));
  Object.keys(CHECKS).forEach((f) => assert.equal(m.vals[CHECKS[f]], "true", f + " -> " + CHECKS[f] + ' must be "true"'));
  assert.equal(m.dropped.length, 0, "nothing the server can emit may be dropped: " + m.dropped.join(", "));

  // and a "No" is recorded as No, never silently dropped or flipped
  const no = h.OE._voiceMerge({}, {}, [{ field: "dm", value: "No", applied: true }, { field: "alcohol", value: "No", applied: true }]);
  assert.equal(no.vals.Diabetes_yesNo, "N");
  assert.equal(no.vals.Habitat_addiction_alcohol, "false");
});

test("every EMR field key the server can return has a form field waiting for it", async () => {
  const h = boot();
  const { EMR_FIELD_KEYS } = await import(new URL("../functions/api/ai/_opd-scribe.js", import.meta.url));
  const missing = EMR_FIELD_KEYS.filter((k) => !h.OE.VOICE_MAP[k]);
  assert.deepEqual(missing, [], "server keys with no VOICE_MAP target (the extraction is paid for and thrown away)");
  const schema = Object.keys(h.OE._assessPayload({}));
  const broken = Object.keys(h.OE.VOICE_MAP).filter((k) => schema.indexOf(h.OE.VOICE_MAP[k]) === -1);
  assert.deepEqual(broken, [], "VOICE_MAP targets that are not real ASSESS_SCHEMA fields");
});

/* ══ the two guards that made the form stop filling ════════════════════════════════════════════ */
test("REGRESSION: the authoritative final refine is never skipped just because the transcript stopped growing", async () => {
  // The doctor pauses; the idle-refine (4s of silence) already refined this exact text; the last
  // capture window before Stop is that same silence, so Stop carries an identical transcript. With
  // smd_scribe_delta on, every earlier pass read a 45-second fragment — so if the final full pass is
  // skipped here, NO pass ever read the consultation whole and the form is left half empty.
  const h = boot({ smd_scribe_delta: "on" });
  h.queue.push({ emrFields: { cc: "Fever" }, en: CONSULT_A });
  await h.OE._doRefine(CONSULT_A, false); await tick();
  h.queue.push({ emrFields: { dm: "Yes" }, en: CONSULT_B });
  await h.OE._doRefine(CONSULT, false); await tick();
  assert.equal(h.calls[1].text, CONSULT_B, "the background pass was a delta — a fragment");

  h.queue.push({ emrFields: { cc: "Fever x 1 day", presentHx: "Known T2DM, fever", dmDetails: "T2DM x 5y on metformin" }, en: CONSULT });
  await h.OE._doRefine(CONSULT, true); await tick();
  assert.equal(h.calls.length, 3, "the final pass RAN");
  assert.equal(h.calls[2].text, CONSULT, "and it read the whole consultation");
  assert.equal(h.st.assessVals.Diabetes_details, "T2DM x 5y on metformin", "so the detail it alone could find landed");
});

test("a vital split across a delta boundary is still extracted — the run is over the JOINED translation", async () => {
  // The deterministic extractor is the only thing that ever fills a vital, and for a Telugu or Hindi
  // consult its only input is the LLM's English translation. A delta's `en` covers that delta's speech
  // alone, so "BP is 140" and "by 90" land in different replies and NEITHER fragment matches the BP
  // regex on its own. Reading the accumulated translation costs nothing (extract dedupes per field,
  // _voiceMerge only adds) and is the difference between a filled BP and an empty one.
  const h = boot({ smd_scribe_delta: "on" });
  h.queue.push({ emrFields: { cc: "జ్వరం" }, en: "Patient has fever three days. Doctor: BP is 140" });
  await h.OE._doRefine("జ్వరం మూడు రోజులు. బీపీ నూట నలభై", false); await tick();
  assert.equal(h.st.assessVals.BP_SYS, undefined, "half a reading is not a reading");

  h.queue.push({ emrFields: { presentHx: "fever" }, en: "by 90, pulse 88, temperature 101." });
  await h.OE._doRefine("జ్వరం మూడు రోజులు. బీపీ నూట నలభై తొంభై, పల్స్ 88", false); await tick();
  assert.equal(h.st.assessVals.BP_SYS, "140", "the joined translation has the reading whole");
  assert.equal(h.st.assessVals.BP_dia, "90");
  assert.equal(h.st.assessVals.Pulse, "88");
});

test("_dedupeSkip: a background tick may be skipped; a final only when a FULL pass already covered it", () => {
  const { OE } = boot();
  assert.equal(OE._dedupeSkip("A B ", false, "A B ", ""), true, "background: the last send covered it");
  assert.equal(OE._dedupeSkip("A B ", true, "A B ", ""), false, "final: no FULL pass has read this yet");
  assert.equal(OE._dedupeSkip("A B ", true, "A B ", "A B "), true, "final: a full pass already read exactly this");
  assert.equal(OE._dedupeSkip("A B C ", true, "A B C ", "A B "), false, "final: new speech since the last full pass");
  assert.equal(OE._dedupeSkip("A B ", false, "", ""), false, "nothing sent yet");
});

/* ══ the two defaults the owner's device forced back off ═══════════════════════════════════════ */
test("DEFAULTS: the delta wire and the Auto language probe are both OFF until they are proven on a device", () => {
  const { OE } = boot();
  assert.equal(OE._scribeDeltaOn(), false, "smd_scribe_delta: the server half is not deployed");
  const h = boot();
  assert.equal(h.win.SMD_AMBIENT.probeRoute("patient has fever"), "en",
    "the probe code still exists and still works when switched on");
  h.OE._startVoice();
  assert.equal(h.windows[0].opts.model, "telugu-small-q8_0",
    "smd_voice_lang_probe off: Auto opens straight on its normal weights, no second 252MB load");
  h.OE._stopVoice();
});

/* ══ select fields: snap to a real option, or leave it alone ═══════════════════════════════════ */
test("a spoken select value snaps to a real option, and an unrecognised one fills nothing", () => {
  const { OE } = boot();
  assert.equal(OE._snapOption(["", "Vegetarian", "Non-vegetarian", "Eggetarian"], "vegetarian"), "Vegetarian");
  assert.equal(OE._snapOption(["", "Good", "Fair", "Sick / Poor", "Moribund"], "Sick"), "Sick / Poor");
  assert.equal(OE._snapOption(["", "Non-consanguineous", "1st degree", "2nd degree"], "non consanguineous"), "Non-consanguineous");
  assert.equal(OE._snapOption(["", "Normal", "Disturbed", "Insomnia"], "snores a lot"), "", "no match: fill nothing rather than guess");
  assert.equal(OE._snapOption(["", "Vegetarian", "Non-vegetarian"], "vegetarian diet mostly"), "", "ambiguous: fill nothing");
  assert.equal(OE._voiceCoerce("Diet", "vegetarian"), "Vegetarian");
  assert.equal(OE._voiceCoerce("Diet", "sometimes fish"), null, "an unmatched select value must NOT be written");
});
