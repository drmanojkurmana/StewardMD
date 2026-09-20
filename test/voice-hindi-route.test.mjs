/* test/voice-hindi-route.test.mjs — Hindi specialist route (flag smd_voice_hi_model, DEFAULT OFF).
 * The Hindi weights are NOT published yet, so nothing may route to them until the flag is flipped,
 * and the Settings dashboard must not offer a download for a file that does not exist.
 * node --test test/voice-hindi-route.test.mjs
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
const HI = "hindi-small-q8_0";

test("DEFAULT OFF: Hindi keeps routing to the multilingual Whisper", () => {
  for (const tier of ["base", "pro", "ultimate"]) {
    assert.notEqual(load({ smd_voice_tier: tier }).pickModel("hi"), HI, tier);
  }
  assert.equal(load({ smd_voice_tiers: "0" }).pickModel("hi"), "small-q8_0", "tiers off too");
});

test("flag on: Hindi routes to the Hindi specialist on every tier, and with tiers off", () => {
  for (const tier of ["base", "pro", "ultimate"]) {
    assert.equal(load({ smd_voice_tier: tier, smd_voice_hi_model: "1" }).pickModel("hi"), HI, tier);
  }
  assert.equal(load({ smd_voice_tiers: "0", smd_voice_hi_model: "1" }).pickModel("hi"), HI);
});

test("the Hindi route never steals Telugu, English or the undetected Auto chunk", () => {
  const V = load({ smd_voice_hi_model: "1" });
  assert.equal(V.pickModel("te"), "telugu-small-q8_0");
  assert.equal(V.pickModel("auto"), "telugu-small-q8_0");
  assert.equal(V.pickModel("en"), "small-q8_0");
});

test("branded label only — no engine, quant or upstream author names leak to the user", () => {
  assert.equal(load({ smd_voice_hi_model: "1" }).modelCode(HI), "SV-Hindi");
  // The user-facing card label/tag live in MODEL_META; read the entry straight out of the source.
  const meta = SRC.split("\n").find((l) => l.includes('"' + HI + '":') && l.includes("label:"));
  assert.ok(meta, "MODEL_META carries an entry for the Hindi model");
  const label = /label:\s*"([^"]*)"/.exec(meta), tag = /tag:\s*"([^"]*)"/.exec(meta);
  assert.ok(label && tag, "the entry has a label and a tag");
  assert.match(label[1], /^StewardVoice/);
  const shown = (label[1] + " " + tag[1]).toLowerCase();
  for (const banned of ["whisper", "ggml", "q8_0", "int8", "openai", "hugging", "vasista"]) {
    assert.ok(!shown.includes(banned), banned + " must not appear in user-facing text");
  }
});

test("the download dashboard hides the Hindi model until the flag is on (the file is not hosted)", () => {
  for (const tier of ["base", "pro", "ultimate"]) {
    assert.ok(!load({ smd_voice_tier: tier }).tierModels(tier).includes(HI), tier + " off");
    assert.ok(load({ smd_voice_tier: tier, smd_voice_hi_model: "1" }).tierModels(tier).includes(HI), tier + " on");
  }
});

test("FAILS CLOSED: the model entry ships no sha256, so no download can be attempted", () => {
  const BRIDGE = readFileSync(new URL("../native-bridge.js", import.meta.url), "utf8");
  const entry = BRIDGE.split("\n").find((l) => l.includes('"' + HI + '":'));
  assert.ok(entry, "native-bridge.js carries a WHISPER_MODELS entry for the Hindi model");
  assert.match(entry, /sha256:\s*""/, "sha256 is empty until the real file is published");
  assert.ok(!/sha256:\s*"[0-9a-f]{64}"/.test(entry), "no invented hash");
  assert.match(BRIDGE, /whisper-model-unpublished/, "downloadWhisperModel refuses an unpinned model");
});
