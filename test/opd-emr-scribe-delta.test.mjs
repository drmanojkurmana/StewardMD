/* test/opd-emr-scribe-delta.test.mjs — the client half of the incremental (delta) cloud refine.
 *
 * BEHAVIOURAL: opd-emr.js is loaded into a stub window/document and doRefine is actually driven with
 * a fake SMD_AI.extract, so these assert what the code sends and keeps, not how it reads.
 *
 *   - a background refine sends only the speech since the last APPLIED call, plus the draft so far;
 *   - the "sent up to" offset advances ONLY on an applied result, so a failed, timed-out or
 *     stale-discarded call's speech is resent by the next call (losing speech is worse);
 *   - `en` ACCUMULATES across deltas (a delta's translation covers its own speech only);
 *   - the FINAL (Pause/Stop) refine still sends the WHOLE transcript with no prior draft;
 *   - smd_scribe_delta=off restores full-transcript-every-time.
 *
 * node --test test/opd-emr-scribe-delta.test.mjs
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

function load(ls0) {
  const win = {};
  const store = Object.assign({}, ls0);
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }
  };
  new Function("window", "document", "location", "localStorage", SRC)(win, makeDoc(), { search: "" }, ls);
  win.localStorage = ls;
  win.navigator = { onLine: true };
  win.SMD_AMBIENT = { start() {}, reduce() { return { updates: [] }; } };
  win.toast = () => {};
  const calls = [];
  win.SMD_AI = { extract(text, kind, opts) { calls.push({ text, kind, opts: opts || {} }); const r = queue.shift(); return Promise.resolve(r === undefined ? {} : r); } };
  const queue = [];
  return { OE: win.OPDEMR, win, calls, queue, st: win.OPDEMR._state() };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
// One background refine (isFinal=false); the harness resolves extract() from the queue.
const bg = (h, t) => h.OE._doRefine(t, false);
const fin = (h, t) => h.OE._doRefine(t, true);

// ── pure helpers ───────────────────────────────────────────────────────────────────────────────
test("_deltaPlan: falls back to the WHOLE text whenever anything is off", () => {
  const { OE } = load();
  const on = { flagOn: true, isFinal: false, hasDraft: true };
  assert.equal(OE._deltaPlan("abcdef", "abc", 3, on).delta, true);
  assert.equal(OE._deltaPlan("abcdef", "abc", 3, on).text, "def");
  assert.equal(OE._deltaPlan("abcdef", "abc", 3, { flagOn: false, isFinal: false, hasDraft: true }).text, "abcdef", "flag off");
  assert.equal(OE._deltaPlan("abcdef", "abc", 3, { flagOn: true, isFinal: true, hasDraft: true }).text, "abcdef", "a final pass is never a delta");
  assert.equal(OE._deltaPlan("abcdef", "abc", 3, { flagOn: true, isFinal: false, hasDraft: false }).text, "abcdef", "no draft yet");
  assert.equal(OE._deltaPlan("abcdef", "abc", 0, on).text, "abcdef", "nothing sent yet");
  assert.equal(OE._deltaPlan("abc", "abcdef", 6, on).text, "abc", "transcript got SHORTER (edited): resend it all");
  assert.equal(OE._deltaPlan("xbcdef", "abc", 3, on).text, "xbcdef", "prefix changed (edited): resend it all");
});

test("_enAccum: appends, never replaces, and never duplicates a resent delta", () => {
  const { OE } = load();
  assert.equal(OE._enAccum("", "Fever three days."), "Fever three days.");
  assert.equal(OE._enAccum("Fever three days.", "Now vomiting."), "Fever three days. Now vomiting.");
  assert.equal(OE._enAccum("Fever three days.", ""), "Fever three days.", "an empty delta never blanks it");
  assert.equal(OE._enAccum("Fever three days. Now vomiting.", "Now vomiting."), "Fever three days. Now vomiting.");
});

test("_draftAccum: ADD/UPDATE only — an absent or empty key never clears a captured field", () => {
  const { OE } = load();
  assert.deepEqual(OE._draftAccum({ cc: "Fever" }, { pastHx: "Appendicectomy" }), { cc: "Fever", pastHx: "Appendicectomy" });
  assert.deepEqual(OE._draftAccum({ cc: "Fever" }, {}), { cc: "Fever" });
  assert.deepEqual(OE._draftAccum({ cc: "Fever" }, { cc: "" }), { cc: "Fever" });
  assert.deepEqual(OE._draftAccum({ cc: "Fever" }, { cc: "Fever, cough" }), { cc: "Fever, cough" });
});

// ── the wire ───────────────────────────────────────────────────────────────────────────────────
test("the FIRST refine is full; the next background refine sends only the NEW speech plus the draft", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever x 3 days" }, en: "Fever for three days." });
  await bg(h, "doctor: fever since three days. ");
  await tick();
  assert.equal(h.calls[0].text, "doctor: fever since three days. ", "the first call has no draft to lean on: whole transcript");
  assert.equal(h.calls[0].opts.delta, undefined);
  assert.equal(h.calls[0].opts.priorDraft, undefined);

  h.queue.push({ emrFields: { presentHx: "Vomiting since morning" }, en: "Vomiting since morning." });
  await bg(h, "doctor: fever since three days. and vomiting since morning. ");
  await tick();
  assert.equal(h.calls[1].text, "and vomiting since morning. ", "only the new speech goes up");
  assert.equal(h.calls[1].opts.delta, 1);
  assert.deepEqual(h.calls[1].opts.priorDraft, { emrFields: { cc: "Fever x 3 days" } });
  assert.ok(typeof h.calls[1].opts.sec === "number", "the seconds meter still rides along");
});

test("`en` ACCUMULATES across deltas instead of being replaced by the last delta's translation", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever" }, en: "Fever for three days." });
  await bg(h, "T1 "); await tick();
  assert.equal(h.st.voiceTranscriptEn, "Fever for three days.");
  h.queue.push({ emrFields: { presentHx: "Vomiting" }, en: "Vomiting since morning." });
  await bg(h, "T1 T2 "); await tick();
  assert.equal(h.st.voiceTranscriptEn, "Fever for three days. Vomiting since morning.",
    "the earlier translation must survive — the VoiceNote and the vitals extractor both read it");
});

test("a FAILED call's speech is included in the next call (the offset only moves on an applied result)", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever" } });
  await bg(h, "A "); await tick();
  h.queue.push({ error: "server" });                       // the delta covering "B " is lost
  await bg(h, "A B "); await tick();
  assert.equal(h.calls[1].text, "B ");
  h.queue.push({ emrFields: { presentHx: "x" } });
  await bg(h, "A B C "); await tick();
  assert.equal(h.calls[2].text, "B C ", "the failed call's speech is resent, not dropped");
});

test("a STALE result (overtaken by a newer refine) neither lands nor advances the offset", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever" } });
  await bg(h, "A "); await tick();

  let releaseSlow;
  const slow = new Promise((res) => { releaseSlow = res; });
  h.queue.push(slow);                                      // refine #2 over "B ", still in flight
  bg(h, "A B ");
  await tick();
  assert.equal(h.calls[1].text, "B ");

  h.queue.push({ emrFields: { presentHx: "NEWER" } });     // refine #3 over "B C " lands first
  await bg(h, "A B C "); await tick();
  assert.equal(h.calls[2].text, "B C ", "with #2 unapplied, #3 still starts from the old offset");

  releaseSlow({ emrFields: { presentHx: "STALE" }, en: "stale english" });
  await tick(); await tick();
  assert.equal(h.st.scribeDraft.presentHx, "NEWER", "the stale result must not overwrite the newer draft");
  assert.doesNotMatch(h.st.voiceTranscriptEn || "", /stale english/);

  h.queue.push({ emrFields: {} });
  await bg(h, "A B C D "); await tick();
  assert.equal(h.calls[3].text, "D ", "the offset reflects the NEWEST applied result, not the stale one");
});

test("the FINAL refine still sends the WHOLE transcript with no prior draft", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever" }, en: "one." });
  await bg(h, "A "); await tick();
  h.queue.push({ emrFields: { presentHx: "x" }, en: "two." });
  await bg(h, "A B "); await tick();
  assert.equal(h.calls[1].text, "B ", "the background pass was a delta");

  h.queue.push({ emrFields: { cc: "Fever x 3 days, cough" }, en: "The whole consultation in English." });
  await fin(h, "A B C "); await tick();
  assert.equal(h.calls[2].text, "A B C ", "the authoritative pass re-reads everything");
  assert.equal(h.calls[2].opts.delta, undefined, "and carries no prior draft");
  assert.equal(h.calls[2].opts.priorDraft, undefined);
  assert.equal(h.st.voiceTranscriptEn, "The whole consultation in English.",
    "a full pass replaces `en` exactly as it does today");
});

test("smd_scribe_delta=off restores full-transcript-every-time", async () => {
  const h = load({ smd_scribe_delta: "off" });
  assert.equal(h.OE._scribeDeltaOn(), false);
  h.queue.push({ emrFields: { cc: "Fever" }, en: "one." });
  await bg(h, "A "); await tick();
  h.queue.push({ emrFields: { presentHx: "x" }, en: "two." });
  await bg(h, "A B "); await tick();
  h.queue.push({ emrFields: { advice: "y" }, en: "three." });
  await bg(h, "A B C "); await tick();
  assert.deepEqual(h.calls.map((c) => c.text), ["A ", "A B ", "A B C "]);
  h.calls.forEach((c) => { assert.equal(c.opts.delta, undefined); assert.equal(c.opts.priorDraft, undefined); });
  assert.equal(h.st.voiceTranscriptEn, "three.", "with the flag off `en` is replaced, byte-for-byte as before");
});

test("a background refine with no new speech at all sends nothing", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever" } });
  await bg(h, "A "); await tick();
  await bg(h, "A  ");                                      // only whitespace added
  await tick();
  assert.equal(h.calls.length, 1, "no second call: there is nothing new to say");
});

test("an abandoned delta does not eat the seconds meter's clock", async () => {
  // scribeSendPrep stamps the meter when it prepares a send. A delta that turns out to have nothing
  // new is never sent, so those seconds must ride on the NEXT call instead of being billed to nobody.
  const h = load();
  const t0 = Date.now();
  const real = Date.now;
  try {
    h.st.voiceStartedAt = t0;
    Date.now = () => t0 + 30000;
    h.queue.push({ emrFields: { cc: "Fever" } });
    await bg(h, "A "); await tick();
    assert.ok(h.calls[0].opts.sec >= 29 && h.calls[0].opts.sec <= 31, "first call bills 30 s, got " + h.calls[0].opts.sec);
    Date.now = () => t0 + 90000;
    await bg(h, "A  "); await tick();                      // whitespace only: prepared, then abandoned
    assert.equal(h.calls.length, 1);
    Date.now = () => t0 + 120000;
    h.queue.push({ emrFields: { presentHx: "x" } });
    await bg(h, "A  B "); await tick();
    assert.ok(h.calls[1].opts.sec >= 89 && h.calls[1].opts.sec <= 91,
      "the abandoned call's 60 s must still be billed here (90 s since the last real send), got " + h.calls[1].opts.sec);
  } finally { Date.now = real; }
});

test("the delta draft never blanks an EMR field the doctor already has (an absent key is inert)", async () => {
  const h = load();
  h.queue.push({ emrFields: { cc: "Fever x 3 days" } });
  await bg(h, "A "); await tick();
  const ccKey = Object.keys(h.st.assessVals).find((k) => /complaint/i.test(k) || h.st.assessVals[k] === "Fever x 3 days");
  assert.ok(ccKey, "the first refine filled a complaints field: " + JSON.stringify(h.st.assessVals));
  h.queue.push({ emrFields: { presentHx: "Vomiting" } });  // says nothing about cc
  await bg(h, "A B "); await tick();
  assert.equal(h.st.assessVals[ccKey], "Fever x 3 days", "an absent key left it alone");
  assert.equal(h.st.scribeDraft.cc, "Fever x 3 days", "and the running draft kept it too");
});
