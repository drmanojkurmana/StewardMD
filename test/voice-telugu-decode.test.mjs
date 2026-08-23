/* test/voice-telugu-decode.test.mjs — MaiK Scribe Telugu decode integrity.
 *
 * Two coupled bugs this locks down (OPD Queue > Assessment > MaiK Scribe, real device, Telugu consult):
 *  1) Auto mode routes to the Telugu SPECIALIST fine-tune (voice.js whisperModel) while passing decode
 *     language "auto". whisper.cpp reads "auto" as auto-DETECTION on a single-language fine-tune whose
 *     detection head is unreliable -> wrong language token -> invalid-UTF-8 byte-BPE output -> the
 *     native layer repairs every bad byte to U+FFFD (the on-screen "◇?" wall).
 *  2) That garbage still reached the scribe LLM, whose prompt says to reconstruct meaning from
 *     "garbled" ASR -> it CONFABULATED a full plausible consultation which folded into the EMR.
 *
 * node --test test/voice-telugu-decode.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../voice.js", import.meta.url), "utf8");

// Load voice.js (browser IIFE) with a fake native Whisper plugin that records what it was called with.
function load(tier = "base", lang = "auto") {
  const store = { smd_voice_tiers: "1", smd_voice_tier: tier, smd_whisper_clinical_dictation: "1" };
  const calls = [];
  const win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v) },
    navigator: { language: "en" },
    console: { warn() {}, info() {} },
    // whisperAvailable() gates on the REAL plugin: Capacitor.Plugins.Whisper.startTranscribe.
    Capacitor: { getPlatform: () => "ios", Plugins: { Whisper: { startTranscribe() {} } } },
    SMD_NATIVE: { transcribeWhisper: (o) => { calls.push(o); return () => {}; } }
  };
  win.window = win;
  new Function("window", "document", "navigator", "localStorage", "console", SRC)(win, {}, win.navigator, win.localStorage, win.console);
  return { V: win.SMD_VOICE, calls, lang };
}

const GARBAGE = "హ" + "�".repeat(120);           // exactly what the device showed
const REAL_TE = "జ్వరం మూడు రోజుల నుండి ఉంది";

test("BUG 1: Auto must not decode-as-auto on the Telugu specialist (pin to te)", () => {
  const { V, calls } = load("base");
  V.listen({ engine: "clinical", language: "auto", onFinal() {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "telugu-small-q8_0", "Auto still routes to the specialist weights");
  assert.equal(calls[0].language, "te", "decode language must be pinned, never 'auto', on a single-language fine-tune");
});

test("Auto with no language at all is pinned the same way", () => {
  const { V, calls } = load("base");
  V.listen({ engine: "clinical", onFinal() {} });
  assert.equal(calls[0].language !== "auto", true);
});

test("explicit languages are untouched (en/hi keep their own model + hint)", () => {
  for (const lang of ["en", "hi"]) {
    const { V, calls } = load("base");
    V.listen({ engine: "clinical", language: lang, onFinal() {} });
    assert.equal(calls[0].language, lang, lang);
    assert.notEqual(calls[0].model, "telugu-small-q8_0", lang + " must not use the Telugu specialist");
  }
});

test("explicit Telugu still decodes as te on the specialist", () => {
  const { V, calls } = load("base");
  V.listen({ engine: "clinical", language: "te", onFinal() {} });
  assert.equal(calls[0].model, "telugu-small-q8_0");
  assert.equal(calls[0].language, "te");
});

test("BUG 2: isGarbled flags a U+FFFD wall, not real speech", () => {
  const { V } = load();
  assert.equal(V.isGarbled(GARBAGE), true, "the decoder-garbage transcript from the device");
  assert.equal(V.isGarbled("�".repeat(300)), true);
  assert.equal(V.isGarbled(REAL_TE), false, "real Telugu must pass");
  assert.equal(V.isGarbled("BP 120/80, pulse 88, fever since yesterday"), false, "English must pass");
  assert.equal(V.isGarbled("ceftriaxone 1 g IV BD ఇవ్వండి"), false, "code-switch must pass");
  assert.equal(V.isGarbled("fever � three days"), false, "one stray bad byte must NOT drop a usable chunk");
  assert.equal(V.isGarbled(""), false);
  assert.equal(V.isGarbled("�"), false, "too short to judge");
});

test("BUG 2: a garbled chunk never reaches the transcript callbacks", () => {
  const { V, calls } = load("base");
  const got = [];
  V.listen({ engine: "clinical", language: "te", onFinal: (t) => got.push(t), onPartial: (t) => got.push(t) });
  calls[0].onFinal(GARBAGE);
  assert.deepEqual(got, [], "garbage must be swallowed at the source (else the LLM confabulates a consult)");
  calls[0].onFinal(REAL_TE);
  assert.deepEqual(got, [REAL_TE], "real speech still flows through");
});
