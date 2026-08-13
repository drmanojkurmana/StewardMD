/* test/voice-tier-routing.test.mjs — on-device dictation model routing per tier + language.
 * Telugu must ALWAYS route to the Telugu specialist; en/hi to the tier's Whisper; the undetected
 * Auto chunk to a multilingual-capable model (never English-only Turbo). node --test test/voice-tier-routing.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../voice.js", import.meta.url), "utf8");
function load(tier) {
  const store = { smd_voice_tiers: "1", smd_voice_tier: tier };
  const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v) }, navigator: { language: "en" }, SMD_NATIVE: {} };
  win.window = win;
  new Function("window", "document", "navigator", "localStorage", SRC)(win, {}, win.navigator, win.localStorage);
  return win.SMD_VOICE;
}
const code = (V, l) => V.modelCode(V.pickModel(l));

test("Telugu always routes to the Telugu specialist on every tier", () => {
  for (const tier of ["base", "pro", "ultimate"]) assert.equal(code(load(tier), "te"), "SV-Telugu", tier);
});

test("English routes to the tier's Whisper (never the Telugu specialist)", () => {
  assert.equal(code(load("base"), "en"), "SV-Multi");
  assert.equal(code(load("pro"), "en"), "SV-Multi");
  assert.equal(code(load("ultimate"), "en"), "SV-Ultra");
});

test("Auto/undetected chunk uses a multilingual-capable model, not English-only Turbo", () => {
  assert.equal(code(load("base"), "auto"), "SV-Multi");
  assert.equal(code(load("pro"), "auto"), "SV-Telugu");       // pro/ultimate reuse the te specialist (multilingual)
  assert.notEqual(code(load("ultimate"), "auto"), "SV-Ultra"); // must NOT be the en-only Turbo for an unknown chunk
});
