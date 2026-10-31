/* PrepNucleus Sound synth + UI tests (rs-sound, Phases 1-2). No network, DOM, audio.
   node --test test/prep-sound-web.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const W = require("../prep-sound-web.js");
const C = require("../prep-sound-core.js");

test("synth: every shipped track validates; catalogue and recipes agree", () => {
  assert.deepEqual(W.validateAll(), []);
  for (const t of C.TRACKS) assert.ok(W.TRACK_SYNTH[t.id], "recipe for " + t.id);
  for (const id of Object.keys(W.TRACK_SYNTH)) assert.ok(C.trackById(id), "catalogue entry for " + id);
  assert.deepEqual(C.checkManifest(C.TRACKS), [], "rights gate still passes");
});

test("synth: validator rejects loud, out-of-range and clipping recipes", () => {
  const ok = W.TRACK_SYNTH.night_quiet;
  assert.deepEqual(W.validateSynth("t", ok), []);
  assert.deepEqual(W.validateSynth("t", { ...ok, noise: { ...ok.noise, gain: 0.9 } }), ["gain:t"], "whisper cap");
  assert.deepEqual(W.validateSynth("t", { ...ok, noise: { ...ok.noise, color: "blue" } }), ["noise-color:t"]);
  assert.deepEqual(W.validateSynth("t", { ...ok, pad: [{ freq: 20000, gain: 0.05, type: "sine" }] })[0], "pad-freq:t:0");
  assert.deepEqual(W.validateSynth("t", { ...ok, lfo: { rate: 0.1, depth: 0.5, target: "gain" } }), ["lfo-clip:t"], "LFO must not clip the gain staging");
  assert.deepEqual(W.validateSynth("t", null), ["synth-missing:t"]);
});
