/* test/ambient-pause-flush.test.mjs — Pause must deliver what was just said.
 *
 * Reported: "OPD scribe works on Stop but shows nothing scribed when Paused."
 *
 * Cause: pause() set `paused = true` and THEN stopped the in-flight window. Everything that delivers
 * a chunk is gated on !paused — tick() (the on-screen transcript) and onRefine() (the note draft) —
 * so the flushed window was accumulated internally and then dropped. stop() evaluates the same gate
 * while still unpaused, which is exactly why Stop worked and Pause did not.
 *
 * This drives the real SMD_AMBIENT engine with a fake SMD_VOICE, so it fails against the old ordering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../voice-ambient.js", import.meta.url), "utf8");

// The engine arms real timers (chunk windows, re-arm backoff). Left referenced they hold Node's event
// loop open long after the assertions pass, so the file never exits and `npm test` hangs on it.
const _setTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (fn, ms) {
  const t = _setTimeout(fn, ms);
  if (t && typeof t.unref === "function") t.unref();
  return t;
};

// Minimal host: a fake SMD_VOICE whose session hands back whatever the test "says" when stopped.
function boot() {
  const root = { setTimeout, clearTimeout, console };
  let live = null;
  root.SMD_VOICE = {
    listen(o) {
      live = {
        opts: o,
        stop() { const t = live._say || ""; live._say = ""; const cb = o.onFinal; live = null; if (cb) cb(t); },
      };
      return live;
    },
    stop() {},
  };
  new Function("window", "self", "globalThis", SRC)(root, root, root);
  return { root, say: (t) => { if (live) live._say = t; }, hasLive: () => !!live };
}

function startSession() {
  const h = boot();
  const seen = { transcripts: [], refines: [] };
  const session = h.root.SMD_AMBIENT.start({
    speaker: "doctor", language: "en", chunkMs: 999999, refineEveryChunks: 999,
    getState: () => ({}), llmExtract: null,
    onUpdate() {},
    onTranscript: (t) => seen.transcripts.push(t),
    onRefine: (t) => seen.refines.push(t),
    onState() {}, onError() {}, onModel() {},
  });
  return { h, session, seen };
}

test("the engine exposes stop/pause/resume", () => {
  const { session } = startSession();
  ["stop", "pause", "resume"].forEach((k) => assert.equal(typeof session[k], "function", k));
});

test("REGRESSION: Pause delivers the words spoken since the last chunk boundary", () => {
  const { h, session, seen } = startSession();
  h.say("patient reports burning micturition for three days");
  const flushing = session.pause();

  assert.equal(flushing, true, "pause reports that a window is being flushed, like stop does");
  assert.ok(seen.refines.length > 0, "the flushed window reaches the note draft (this was silently dropped)");
  assert.match(seen.refines.join(" "), /burning micturition/, "and it carries what was actually said");
  assert.match(seen.transcripts.join(" "), /burning micturition/, "and it reaches the on-screen transcript");
});

test("Pause with nothing in flight reports no flush, so the caller refines itself", () => {
  const { session } = startSession();
  session.pause();                          // first pause flushes the armed window
  const again = session.pause();            // nothing live now
  assert.equal(again, false, "the caller must fall back to its own refine rather than wait forever");
});

test("after a pause-flush the mic stays down until resume", () => {
  const { h, session } = startSession();
  h.say("first half");
  session.pause();
  assert.equal(h.hasLive(), false, "no new window is armed while paused");
  session.resume();
  assert.equal(h.hasLive(), true, "resume re-arms the mic");
});

test("resume then pause again still delivers the second half", () => {
  const { h, session, seen } = startSession();
  h.say("first half"); session.pause();
  session.resume();
  h.say("second half"); session.pause();
  const all = seen.refines.join(" ");
  assert.match(all, /first half/);
  assert.match(all, /second half/, "a resumed session must not lose the next window on the next pause");
});

test("Stop still works, and still reports its flush", () => {
  const { h, session, seen } = startSession();
  h.say("stop path still fine");
  assert.equal(session.stop(), true, "stop reports the flush");
  assert.match(seen.refines.join(" "), /stop path still fine/);
});

test("SOURCE: paused is never set before the in-flight window is delivered", () => {
  const pause = SRC.slice(SRC.indexOf("pause: function"), SRC.indexOf("resume: function"));
  assert.ok(!/^\s*paused = true;[\s\S]*curSession/m.test(pause),
    "setting paused before the flush is the bug: every delivery path is gated on !paused");
  assert.match(pause, /pausing = true/, "the flush is marked, and paused is set once it lands");
});

test("SOURCE: opd-emr does not double-refine when the pause flush will deliver", () => {
  const OPD = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
  const fn = OPD.slice(OPD.indexOf("function togglePauseVoice"), OPD.indexOf("function stopVoice"));
  assert.match(fn, /pauseFlushing = !!_amb\.pause\(\)/, "pause's flush contract is read");
  assert.match(fn, /if \(!pauseFlushing\) doRefine/, "…and its own refine is skipped when the flush will deliver");
});
