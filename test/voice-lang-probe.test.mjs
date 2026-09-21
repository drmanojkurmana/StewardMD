/* test/voice-lang-probe.test.mjs — Auto first-chunk language probe (smd_voice_lang_probe, DEFAULT OFF).
 *
 * DEFAULT FLIPPED 2026-09-20 (owner report, real iPhone: "live transcription no longer appears as I
 * speak"). The probe opens the consult on the MULTILINGUAL weights while Auto's normal route is the
 * Telugu specialist, so the first window pays a SECOND 252MB model load — a download, not a swap, on
 * a phone that does not already hold those weights. Every behavioural test below therefore opts IN
 * (PROBE_ON); the two default tests assert the default itself.
 *
 * THE BUG (vault/modules/"MaiK Scribe".md, "Known remaining limitation"): in Auto, whisperModel()
 * opens on the Telugu specialist, so an ENGLISH consult decodes as English transliterated into Telugu
 * SCRIPT; detectScript() then reads that as Telugu and pins the specialist for the whole session.
 *
 * THE FIX: the FIRST Auto window is a short detection-only pass on the MULTILINGUAL weights (the only
 * model where decode language "auto" is safe), and the session routes by what it read. Latin text =>
 * English. Anything else => no decision, keep today's route: MEASURED, the multilingual weights render
 * real Telugu as garbage Devanagari, so a non-Latin probe cannot tell Telugu from Hindi and its text
 * must be DISCARDED rather than folded into the transcript (it is valid UTF-8, so isGarbled() cannot
 * catch it, and the scribe prompt would confabulate a consultation from it).
 *
 * node --test test/voice-lang-probe.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const SRC = readFileSync(new URL("../voice-ambient.js", import.meta.url), "utf8");
const AMB = createRequire(import.meta.url)("../voice-ambient.js");

const _setTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms) { const t = _setTimeout(fn, ms); if (t && typeof t.unref === "function") t.unref(); return t; };
const delay = (ms) => new Promise((r) => _setTimeout(r, ms));

const PROBE_ON = { smd_voice_lang_probe: "1" };
const TELUGU_SPECIALIST = "telugu-small-q8_0";
const MULTILINGUAL = "small-q8_0";
// What the multilingual weights actually produced on real Telugu audio (measured, see the vault).
const TELUGU_ON_MULTILINGUAL = "नाको निन्नती निन्नती नाको";

function boot(store) {
  const s = store || {};
  const root = { setTimeout, clearTimeout, console, localStorage: { getItem: (k) => (k in s ? s[k] : null) } };
  const calls = [];
  let live = null;
  root.SMD_VOICE = {
    pickModel: (l) => (l === "en" ? MULTILINGUAL : l === "hi" ? MULTILINGUAL : TELUGU_SPECIALIST),
    modelCode: (k) => k,
    probeModel: () => MULTILINGUAL,
    listen(o) {
      const sess = { opts: o, stop() { live = null; if (o.onFinal) o.onFinal(sess._say || ""); } };
      calls.push(sess); live = sess; return sess;
    },
    stop() {},
  };
  new Function("window", "self", "globalThis", SRC)(root, root, root);
  return { root, calls };
}

function startSession(store, opts) {
  const h = boot(store || PROBE_ON);
  const seen = { transcripts: [], models: [] };
  const session = h.root.SMD_AMBIENT.start(Object.assign({
    speaker: "doctor", language: "auto", chunkMs: 100000, probeMs: 20, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null,
    onUpdate() {}, onTranscript: (t) => seen.transcripts.push(t), onRefine() {},
    onState() {}, onError() {}, onModel: (code) => seen.models.push(code),
  }, opts || {}));
  h.calls[0].opts.onState("listening");
  return { h, session, seen };
}
const transcript = (seen) => seen.transcripts[seen.transcripts.length - 1] || "";

test("probeRoute: Latin text routes the session to English", () => {
  assert.equal(AMB.probeRoute("patient has fever since three days"), "en");
  assert.equal(AMB.probeRoute("BP 120 by 80, chest clear"), "en");
});

test("probeRoute: anything else makes NO decision (today's route stands)", () => {
  assert.equal(AMB.probeRoute(TELUGU_ON_MULTILINGUAL), "", "garbage Devanagari cannot be trusted as Hindi");
  assert.equal(AMB.probeRoute("జ్వరం మూడు రోజుల నుండి"), "", "Telugu script: the specialist is already right");
  assert.equal(AMB.probeRoute(""), "");
  assert.equal(AMB.probeRoute("123 456"), "");
  assert.equal(AMB.probeRoute(null), "");
});

test("DEFAULT OFF: Auto opens straight on the specialist — no second model load at the start of a consult", () => {
  const h = boot({});
  h.root.SMD_AMBIENT.start({ speaker: "doctor", language: "auto", chunkMs: 100000, probeMs: 20, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null, onUpdate() {}, onTranscript() {}, onRefine() {}, onState() {}, onError() {} });
  assert.equal(h.calls[0].opts.model, TELUGU_SPECIALIST, "the pre-branch capture path, byte-for-byte");
  assert.equal(h.calls[0].opts.language, "auto");
});

test("flag ON: the first Auto window decodes on the MULTILINGUAL weights, never the specialist", () => {
  const { h } = startSession();
  assert.equal(h.calls[0].opts.model, MULTILINGUAL);
  assert.equal(h.calls[0].opts.language, "auto", "auto is only ever safe on the multilingual weights");
});

test("MEASURED RULE HELD: the probe's 'auto' decode only ever rides the multilingual weights", () => {
  // "auto" on the single-language specialist emits invalid UTF-8 (the U+FFFD wall). The probe is the
  // one place this module deliberately asks for "auto", so it must pair it with the multilingual
  // model and nothing else. The specialist route is untouched: voice.js listen() still pins auto->te
  // for it (locked down by test/voice-telugu-decode.test.mjs).
  const { h } = startSession();
  assert.equal(h.calls[0].opts.language, "auto");
  assert.equal(h.calls[0].opts.model, MULTILINGUAL);
  assert.notEqual(h.calls[0].opts.model, TELUGU_SPECIALIST);
});

test("BUG FIX: an English probe routes the consult to English instead of pinning the specialist", async () => {
  const { h } = startSession();
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);                                   // the short probe window closes
  assert.equal(h.calls.length, 2, "the real capture session is armed after the probe");
  assert.equal(h.calls[1].opts.model, MULTILINGUAL, "routed to English weights, NOT the Telugu specialist");
});

test("an English probe keeps its text — it is a clean transcript, not a discard", async () => {
  const { h, seen } = startSession();
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);
  assert.match(transcript(seen), /fever and cough/);
});

test("a non-Latin probe is DISCARDED and the session keeps today's route", async () => {
  const { h, seen } = startSession();
  h.calls[0]._say = TELUGU_ON_MULTILINGUAL;
  await delay(60);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].opts.model, TELUGU_SPECIALIST, "unchanged from today: Auto opens on the specialist");
  assert.equal(transcript(seen), "", "the garbage never reaches the transcript or the LLM extract");
});

test("the probe runs once per session — later chunks go back to per-chunk script routing", async () => {
  const { h } = startSession();
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);                                   // probe -> en
  assert.equal(h.calls[1].opts.model, MULTILINGUAL);
  h.calls[1].opts.onFinal("జ్వరం మూడు రోజుల నుండి");  // the consult switches to Telugu
  assert.equal(h.calls.length, 3, "re-armed, not re-probed");
  assert.equal(h.calls[2].opts.model, TELUGU_SPECIALIST, "detectScript re-routes exactly as before");
});

test("flag explicitly OFF: today's behaviour byte-for-byte — the first Auto window opens on the specialist", () => {
  const { h } = startSession({ smd_voice_lang_probe: "0" });
  assert.equal(h.calls[0].opts.model, TELUGU_SPECIALIST);
});

test("no probe when the caller pinned a model, or outside Auto, or off Clinical", () => {
  assert.equal(startSession(undefined, { model: TELUGU_SPECIALIST }).h.calls[0].opts.model, TELUGU_SPECIALIST, "caller wins");
  assert.equal(startSession(undefined, { language: "en" }).h.calls[0].opts.model, MULTILINGUAL, "explicit EN needs no probe");
  assert.equal(startSession(undefined, { language: "te" }).h.calls[0].opts.model, TELUGU_SPECIALIST, "explicit TE needs no probe");
  const fast = startSession(undefined, { engine: "fast" });
  assert.notEqual(fast.h.calls[0].opts.engine, "clinical", "the device STT fallback has no model routing to probe");
});

test("the probe window is SHORT — it closes on probeMs, not on the 15s chunk window", async () => {
  const { h } = startSession(undefined, { chunkMs: 100000, probeMs: 20 });
  h.calls[0]._say = "patient has fever";
  await delay(60);
  assert.equal(h.calls.length, 2, "a 100s chunk window would still be open here");
});

test("a probe that returns nothing still leaves the loop running on today's route", async () => {
  const { h } = startSession();
  h.calls[0]._say = "";
  await delay(60);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].opts.model, TELUGU_SPECIALIST);
});

// AUDIT FIX: probeDone/detectedLang used to live only inside start()'s closure, so a Stop then
// "record more" (a NEW start() call) forgot the probe ever ran and paid the whole cost again --
// 252MB multilingual load, decode, discard, free, then the 252MB specialist load. opts.sessionId
// lets a caller carry that answer across a restart within the same encounter.
test("sessionId: a restart within the same session does NOT re-probe (English answer remembered)", async () => {
  const h = boot(PROBE_ON);
  const seen = { transcripts: [] };
  const base = {
    speaker: "doctor", language: "auto", chunkMs: 100000, probeMs: 20, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null, onUpdate() {}, onRefine() {}, onState() {}, onError() {},
    onTranscript: (t) => seen.transcripts.push(t), sessionId: "enc-1",
  };
  const s1 = h.root.SMD_AMBIENT.start(base);
  h.calls[0].opts.onState("listening");
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);
  assert.equal(h.calls.length, 2, "probe ran once, real capture armed");
  assert.equal(h.calls[1].opts.model, MULTILINGUAL, "routed to English");
  s1.stop();                                          // "Stop"

  const s2 = h.root.SMD_AMBIENT.start(base);           // "record more" -- a BRAND NEW start() call
  assert.equal(h.calls.length, 3, "no probe window armed on restart");
  assert.equal(h.calls[2].opts.model, MULTILINGUAL, "the remembered English route is used immediately");
  // Distinguish "used the remembered route directly" from "re-probed and happened to land on the same
  // model": a probe's chunk timer fires at probeMs (20ms here); a real routed chunk's fires at chunkMs
  // (100000ms). If this had re-probed, that timer would close the window and cascade into a THIRD
  // listen() call well within 60ms.
  h.calls[2].opts.onState("listening");
  await delay(60);
  assert.equal(h.calls.length, 3, "no cascade -- this was never a probe window");
  s2.stop();
});

test("sessionId: a restart remembers a NON-Latin session too (stays on the specialist, no re-probe)", async () => {
  const h = boot(PROBE_ON);
  const base = {
    speaker: "doctor", language: "auto", chunkMs: 100000, probeMs: 20, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null, onUpdate() {}, onRefine() {}, onState() {}, onError() {},
    onTranscript() {}, sessionId: "enc-2",
  };
  const s1 = h.root.SMD_AMBIENT.start(base);
  h.calls[0].opts.onState("listening");
  h.calls[0]._say = TELUGU_ON_MULTILINGUAL;
  await delay(60);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].opts.model, TELUGU_SPECIALIST);
  s1.stop();

  h.root.SMD_AMBIENT.start(base);
  assert.equal(h.calls.length, 3, "restart re-armed once, without a fresh probe window");
  assert.equal(h.calls[2].opts.model, TELUGU_SPECIALIST, "still routed to the specialist, remembered");
  h.calls[2].opts.onState("listening");
  await delay(60);
  assert.equal(h.calls.length, 3, "no cascade -- this was never a probe window");
});

test("sessionId: a DIFFERENT session (new patient) still gets its own fresh probe", async () => {
  const h = boot(PROBE_ON);
  const base = {
    speaker: "doctor", language: "auto", chunkMs: 100000, probeMs: 20, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null, onUpdate() {}, onRefine() {}, onState() {}, onError() {},
    onTranscript() {},
  };
  const s1 = h.root.SMD_AMBIENT.start(Object.assign({}, base, { sessionId: "enc-A" }));
  h.calls[0].opts.onState("listening");
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);
  s1.stop();

  h.root.SMD_AMBIENT.start(Object.assign({}, base, { sessionId: "enc-B" }));
  assert.equal(h.calls[2].opts.model, MULTILINGUAL, "the SECOND encounter still opens on the probe");
  assert.equal(h.calls[2].opts.language, "auto", "a real probe window, not a remembered route");
});

test("no sessionId: today's behaviour, byte-for-byte -- every restart re-probes", async () => {
  const { h } = startSession();
  h.calls[0]._say = "patient has fever and cough since three days";
  await delay(60);
  assert.equal(h.calls.length, 2);
  const { h: h2 } = startSession();                    // a second, independent start() with no sessionId
  assert.equal(h2.calls[0].opts.language, "auto", "still a probe window, unchanged for callers who opt in to nothing");
  assert.equal(h2.calls[0].opts.model, MULTILINGUAL);
});

test("with the flag on, the probe window is short -- well under the old 4s, so a discard costs a fraction of a second", () => {
  const delays = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = function (fn, ms) { delays.push(ms); const t = real(fn, ms); if (t && t.unref) t.unref(); return t; };
  try {
    startSession(PROBE_ON, { probeMs: undefined, chunkMs: 100000 });   // no probeMs -> the module default
  } finally { globalThis.setTimeout = real; }
  // armChunk always schedules a fixed 2500ms fallback timer too; exclude it to isolate the real window
  // timer (probing ? probeMs : chunkMs). chunkMs is 100000 here, so anything else under that is the probe's.
  const windowDelay = Math.min.apply(null, delays.filter((d) => d < 100000 && d !== 2500));
  assert.ok(windowDelay < 4000, "default probe window must be well under the old 4000ms: was " + windowDelay);
  assert.ok(windowDelay > 0);
});
