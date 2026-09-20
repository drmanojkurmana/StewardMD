/* test/voice-prompt-multi.test.mjs — Whisper initial_prompt per language + flag.
 *
 * MEASURED (see vault/modules/"MaiK Scribe".md): an English SENTENCE primer forced onto Telugu
 * decoding suppressed the target language, so buildInitialPrompt() returned "" for every non-English
 * language. smd_voice_prompt_multi (DEFAULT OFF, unmeasured) swaps that "" for a SHORT Latin-script
 * list of drug names only — no English sentence, nothing that asserts a language.
 *
 * English behaviour must be byte-identical whatever the flag says.
 * node --test test/voice-prompt-multi.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../voice.js", import.meta.url), "utf8");
function load(store) {
  const s = Object.assign({ smd_voice_tiers: "1", smd_voice_tier: "base" }, store || {});
  const win = { localStorage: { getItem: (k) => (k in s ? s[k] : null), setItem: (k, v) => (s[k] = v) }, navigator: { language: "en" }, SMD_NATIVE: {} };
  win.window = win;
  new Function("window", "document", "navigator", "localStorage", SRC)(win, {}, win.navigator, win.localStorage);
  return win.SMD_VOICE;
}
const OFF = load();
const ON = load({ smd_voice_prompt_multi: "1" });

test("DEFAULT OFF: every non-English language still gets no primer at all", () => {
  for (const lang of ["te", "hi", "ta", "auto"]) assert.equal(OFF.initialPrompt(lang), "", lang);
});

test("English is byte-identical with the flag on and off (and is never empty)", () => {
  assert.equal(ON.initialPrompt("en"), OFF.initialPrompt("en"));
  assert.equal(ON.initialPrompt(), OFF.initialPrompt(), "no language = English default");
  assert.ok(OFF.initialPrompt("en").length > 0);
  assert.match(OFF.initialPrompt("en"), /^Clinical case dictation in Indian English\./);
});

test("flag on: non-English gets a drug-name primer", () => {
  for (const lang of ["te", "hi", "ta"]) {
    const p = ON.initialPrompt(lang);
    assert.ok(p.length > 0, lang + " is primed");
    assert.match(p, /paracetamol/, lang);
    assert.match(p, /ceftriaxone/, lang);
  }
});

test("the non-English primer is drug names ONLY — no English sentence, nothing that names a language", () => {
  const p = ON.initialPrompt("te");
  assert.ok(!/[.!?]/.test(p), "no sentence punctuation: a comma-separated term list");
  assert.ok(!/\b(English|Hindi|Telugu|dictation|patient|doctor|clinical case)\b/i.test(p), "no prose");
  assert.notEqual(p, ON.initialPrompt("en"), "it is NOT the English primer");
});

test("the non-English primer is SHORT (a long list is itself a language signal) and Latin script", () => {
  const p = ON.initialPrompt("hi");
  assert.ok(p.length < 400, "length " + p.length + " must stay well under Whisper's ~224-token budget");
  assert.ok(p.split(",").length <= 30, "a couple of dozen terms, not the whole formulary");
  assert.ok(!/[^\x00-\x7F]/.test(p), "Latin script only — a Devanagari/Telugu primer would pin a language");
  assert.ok(ON.initialPrompt("en").length > p.length, "still much shorter than the English primer");
});

test("a junk flag value does not turn it on", () => {
  for (const v of ["0", "", "yes", "true "]) {
    assert.equal(load({ smd_voice_prompt_multi: v }).initialPrompt("te"), "", JSON.stringify(v));
  }
});
