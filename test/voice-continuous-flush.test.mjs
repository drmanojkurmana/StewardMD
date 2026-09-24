/* test/voice-continuous-flush.test.mjs — continuous capture (flag smd_voice_continuous, DEFAULT OFF).
 *
 * Today a window boundary STOPS the mic to transcribe and then restarts it, losing the audio that
 * spans the seam. With the flag on AND a plugin build that exposes a native flush, the boundary
 * flushes instead: the segment is delivered while the mic keeps recording, so there is no seam and
 * no re-arm. Without either, the loop must behave exactly as it does today.
 *
 * Drives the real SMD_AMBIENT engine against a fake SMD_VOICE.
 * node --test test/voice-continuous-flush.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const SRC = readFileSync(new URL("../voice-ambient.js", import.meta.url), "utf8");
// voice-ambient.js is a browser IIFE that also does module.exports = API (window is null in Node).
const AMB = createRequire(import.meta.url)("../voice-ambient.js");

// The engine arms real timers; unref them so the file still exits.
const _setTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms) { const t = _setTimeout(fn, ms); if (t && typeof t.unref === "function") t.unref(); return t; };
const delay = (ms) => new Promise((r) => _setTimeout(r, ms));

// canFlush=false models every app binary built before flushTranscribe existed.
function boot({ flag, canFlush }) {
  const store = flag == null ? {} : { smd_voice_continuous: flag };
  const root = { setTimeout, clearTimeout, console, localStorage: { getItem: (k) => (k in store ? store[k] : null) } };
  const calls = [];
  let live = null;
  root.SMD_VOICE = {
    pickModel: (l) => (l === "te" ? "telugu-small-q8_0" : l === "en" ? "small-q8_0" : "telugu-small-q8_0"),
    modelCode: (k) => k,
    probeModel: () => "small-q8_0",
    listen(o) {
      const s = { opts: o, stops: 0, flushes: 0, stop() { s.stops++; live = null; if (o.onFinal) o.onFinal(s._say || ""); } };
      if (canFlush) s.flush = () => { s.flushes++; };
      calls.push(s);
      live = s;
      return s;
    },
    stop() {},
  };
  new Function("window", "self", "globalThis", SRC)(root, root, root);
  return { root, calls, live: () => live };
}

function startSession(cfg) {
  const h = boot(cfg);
  const seen = { transcripts: [], refines: [] };
  const session = h.root.SMD_AMBIENT.start({
    speaker: "doctor", language: "en", chunkMs: 25, refineEveryChunks: 1,
    getState: () => ({}), llmExtract: null,
    onUpdate() {}, onTranscript: (t) => seen.transcripts.push(t), onRefine: (t) => seen.refines.push(t),
    onState() {}, onError() {}, onModel() {},
  });
  h.calls[0].opts.onState("listening");        // engine announces recording -> the window timer starts
  return { h, session, seen };
}

test("useFlush: only when the flag is on AND the live session exposes a native flush", () => {
  const withFlush = { flush() {} }, without = {};
  assert.equal(AMB.useFlush(withFlush, true), true);
  assert.equal(AMB.useFlush(withFlush, false), false, "flag off = today's chunking");
  assert.equal(AMB.useFlush(without, true), false, "older plugin build = today's chunking");
  assert.equal(AMB.useFlush(null, true), false, "nothing in flight");
  assert.equal(AMB.useFlush({ flush: "yes" }, true), false, "a non-callable flush is not a flush");
});

test("DEFAULT (no flag): a window boundary stops the mic and re-arms, even where flush exists", async () => {
  const { h } = startSession({ flag: null, canFlush: true });
  await delay(70);
  assert.equal(h.calls[0].flushes, 0, "no flush without the flag");
  assert.equal(h.calls[0].stops, 1, "stopped to transcribe, exactly as today");
  assert.ok(h.calls.length > 1, "and re-armed a fresh session");
});

test("flag on, no native flush (older build): unchanged stop-and-re-arm", async () => {
  const { h } = startSession({ flag: "1", canFlush: false });
  await delay(70);
  assert.equal(h.calls[0].stops, 1);
  assert.ok(h.calls.length > 1, "re-armed");
});

test("flag on + native flush: the boundary flushes and the mic is never stopped or re-armed", async () => {
  const { h } = startSession({ flag: "1", canFlush: true });
  await delay(70);
  assert.equal(h.calls[0].flushes, 1, "flushed at the window boundary");
  assert.equal(h.calls[0].stops, 0, "the mic was never stopped");
  assert.equal(h.calls.length, 1, "and no second session was armed — that missing seam is the feature");
});

test("a flushed segment reaches the transcript and the note draft, then the next window is armed", async () => {
  const { h, seen } = startSession({ flag: "1", canFlush: true });
  await delay(70);
  h.calls[0].opts.onFlush("patient reports burning micturition for three days");
  assert.match(seen.transcripts.join(" "), /burning micturition/, "on-screen transcript");
  assert.match(seen.refines.join(" "), /burning micturition/, "note draft");
  await delay(70);
  assert.equal(h.calls[0].flushes, 2, "the next window closed on the SAME open mic");
  assert.equal(h.calls.length, 1);
});

test("consecutive flushed segments accumulate into one transcript", async () => {
  const { h, seen } = startSession({ flag: "1", canFlush: true });
  await delay(70);
  h.calls[0].opts.onFlush("fever since three days");
  await delay(70);
  h.calls[0].opts.onFlush("no vomiting no loose stools");
  const last = seen.transcripts[seen.transcripts.length - 1];
  assert.match(last, /fever since three days/);
  assert.match(last, /no vomiting no loose stools/);
});

test("Stop still ends the session and delivers the tail captured since the last flush", async () => {
  const { h, session, seen } = startSession({ flag: "1", canFlush: true });
  await delay(70);
  h.calls[0].opts.onFlush("fever since three days");
  h.calls[0]._say = "and cough since yesterday";
  const flushing = session.stop();
  assert.equal(flushing, true, "same stop() contract as today");
  assert.equal(h.calls[0].stops, 1, "stop closes the mic");
  assert.match(seen.refines[seen.refines.length - 1], /cough since yesterday/, "the tail is not lost");
  assert.match(seen.refines[seen.refines.length - 1], /fever since three days/, "nor is what was flushed");
});

test("a flush landing after Stop is ignored (it cannot revive the session)", async () => {
  const { h, session, seen } = startSession({ flag: "1", canFlush: true });
  await delay(70);
  session.stop();
  const before = seen.transcripts.length;
  h.calls[0].opts.onFlush("late segment that arrived after teardown");
  assert.equal(seen.transcripts.length, before, "nothing delivered");
  assert.ok(!seen.transcripts.join(" ").includes("late segment"));
});
