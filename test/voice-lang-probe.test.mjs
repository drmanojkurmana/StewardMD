/* test/voice-lang-probe.test.mjs — Auto first-chunk language probe (smd_voice_lang_probe, DEFAULT ON).
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
  const h = boot(store);
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

test("DEFAULT ON: the first Auto window decodes on the MULTILINGUAL weights, never the specialist", () => {
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

test("flag OFF: today's behaviour byte-for-byte — the first Auto window opens on the specialist", () => {
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
