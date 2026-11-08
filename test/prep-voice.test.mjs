/* prep-voice.js pure helpers (the browser behaviour is in test/run-prep-voice-ui.mjs).
 * node --test --experimental-test-module-mocks --experimental-sqlite test/prep-voice.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const V = createRequire(import.meta.url)("../prep-voice.js");

test("voice: a rendered clip is a valid 16-bit mono WAV at 24 kHz", () => {
  const b = Buffer.from(V.wavBlob(Float32Array.from([0, 0.5, -0.5, 1, -1])));
  assert.equal(b.toString("ascii", 0, 4), "RIFF"); assert.equal(b.toString("ascii", 8, 12), "WAVE");
  assert.equal(b.readUInt32LE(24), 24000); assert.equal(b.readUInt16LE(34), 16); assert.equal(b.readUInt32LE(40), 10);
  assert.equal(b.readInt16LE(44 + 6), 32767); assert.equal(b.readInt16LE(44 + 8), -32768);
});

test("voice: a clip fades in over its first 20 ms and the input is not changed", () => {
  const a = new Float32Array(1000).fill(1), out = V.fadeIn(a);
  assert.equal(out[0], 0); assert.ok(out[240] > 0.4 && out[240] < 0.6); assert.equal(out[600], 1); assert.equal(a[0], 1);
});

test("voice: a phone slower than 1.3 times real time keeps the system voice", () => {
  assert.equal(V.RTF_MAX, 1.3); assert.equal(V.SR, 24000);
});
