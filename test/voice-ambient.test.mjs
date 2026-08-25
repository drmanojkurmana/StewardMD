/* test/voice-ambient.test.mjs — ambient controller: incremental deterministic fill +
 * LLM-escalation gate. Verifies fields accumulate across transcript ticks without dupes,
 * conflicts still surface, and the LLM is invoked ONLY for genuine narrative (not vitals-only).
 * node --test test/voice-ambient.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const AMB = require(join(HERE, "..", "voice-ambient.js"));

test("reduce: deterministic fields accumulate as the transcript grows", () => {
  // simulate two ticks; state carries what's already applied
  const state = {};
  function applyTo(res) { res.updates.forEach((u) => { if (u.applied) state[u.field] = { value: u.value, source: u.source }; }); }

  applyTo(AMB.reduce("BP 100/60, pulse 88 regular", { speaker: "doctor", state }));
  assert.equal(state.bpSys.value, 100);
  assert.equal(state.pulse.value, 88);

  applyTo(AMB.reduce("BP 100/60, pulse 88 regular. Chest: bilateral air entry equal, no wheeze", { speaker: "doctor", state }));
  assert.equal(state.breathSounds.value, "Vesicular");
  assert.equal(state.wheeze.value, "No");
  assert.equal(state.bpSys.value, 100, "earlier field unchanged, not duplicated/overwritten");
});

test("reduce: manual edit still protected through the controller path", () => {
  const res = AMB.reduce("BP 100/60", { speaker: "doctor", state: { bpSys: { value: 120, manual: true } } });
  const sys = res.updates.find((u) => u.field === "bpSys");
  assert.equal(sys.applied, false);
});

test("needsLLM: vitals-only chunk does NOT escalate", () => {
  assert.equal(AMB.needsLLM("BP 120/80, pulse 72 regular, temperature 99 F, RR 18", 0), "");
});

test("needsLLM: narrative chunk escalates (returns the tail to send)", () => {
  const t = "patient came with fever and productive cough since three days, worse at night, associated chest pain";
  assert.ok(AMB.needsLLM(t, 0).length > 0);
});

test("needsLLM: only the UNSENT tail is considered", () => {
  const sent = "BP 120/80, pulse 72. ";
  const full = sent + "he complains of severe abdominal pain radiating to the back with vomiting";
  assert.ok(AMB.needsLLM(full, sent.length).length > 0, "new narrative tail escalates");
  assert.equal(AMB.needsLLM(sent + "pulse 80", sent.length), "", "new vitals-only tail does not");
});

test("controller: llmExtract fired once for narrative on final, merged into updates", async () => {
  const seen = [];
  const updates = [];
  const ctl = AMB.start({
    speaker: "doctor",
    getState: () => ({}),
    onUpdate: (res) => updates.push(res),
    llmExtract: (transcript) => { seen.push(transcript); return { fields: { cc: "fever, cough x3 days" }, confidence: 0.7 }; }
  });
  // no SMD_VOICE in Node → drive the exposed tick directly
  ctl._tick("BP 120/80, pulse 72", false);
  ctl._tick("BP 120/80, pulse 72. history of fever and cough since three days with chest pain", true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 1, "LLM called once (on final, with narrative)");
  assert.ok(updates.some((u) => u.updates.some((x) => x.field === "cc")), "LLM cc field merged in");
  ctl.stop();
});

// Chunk-cycling (armChunk/onChunkFinal) needs root.SMD_VOICE to be reachable — reload the module
// fresh with a mocked global.window.SMD_VOICE (same mock-SMD_VOICE pattern the CDP harnesses use)
// so the review-fix regressions (pause-gated refine, error re-arm) stay covered going forward.
function freshAmbientWithMockVoice(listenImpl) {
  const modPath = join(HERE, "..", "voice-ambient.js");
  delete require.cache[require.resolve(modPath)];
  global.window = { SMD_VOICE: { listen: listenImpl } };
  const mod = require(modPath);
  delete global.window;
  return mod;
}

test("chunk-cycling: onError re-arms the next window instead of killing the loop", async () => {
  const sessions = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({ speaker: "doctor", getState: () => ({}), chunkMs: 5 });
  assert.equal(sessions.length, 1, "first window armed on start()");
  sessions[0].opts.onError({ code: "recording-failure" });
  // re-arm is DEFERRED (a timer) on purpose: a synchronous re-arm from the error path recurses
  // armChunk→listen→onError→armChunk… to a stack blow when the engine fails immediately.
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(sessions.length, 2, "onError re-armed a fresh window (loop not killed)");
  ctl.stop();
});

test("chunk-cycling: clinical-unavailable falls back to device STT without recursing or dying", async () => {
  // Mirrors voice.js: engine:"clinical" with no Whisper reports "clinical-unavailable" SYNCHRONOUSLY
  // and returns null. The loop must NOT stack-overflow (the old "does nothing without Whisper" bug),
  // must switch to a non-clinical engine, and must signal "fallback" (not a terminal onError).
  const engines = [], states = [], errors = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    engines.push(opts.engine);
    if (opts.engine === "clinical") { opts.onError("clinical-unavailable"); return null; }
    return { opts: opts, stop: () => {} };                  // device STT available
  });
  let threw = false, ctl;
  try { ctl = AMB2.start({ speaker: "doctor", getState: () => ({}), chunkMs: 60000, onState: (s) => states.push(s), onError: (e) => errors.push(e) }); }
  catch (e) { threw = true; }
  assert.equal(threw, false, "start() does not throw / stack-overflow when Whisper is unavailable");
  assert.equal(engines[0], "clinical", "clinical tried first");
  assert.ok(states.includes("fallback"), "loop signals 'fallback'");
  assert.ok(!errors.includes("clinical-unavailable"), "clinical-unavailable is recovered, not a terminal error");
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(engines.some((e) => e !== "clinical"), "loop re-armed on a non-clinical (device STT) engine");
  ctl && ctl.stop();
});

/* CONTRACT CHANGE (Pause showed nothing scribed). This test used to assert that a window landing
 * after pause never refines. That conflated two different windows: the one pause FLUSHES (audio the
 * doctor spoke BEFORE tapping Pause — their draft) and any window that lands while already paused
 * (audio they did not ask to draft). Delivering neither is what made Pause show nothing while Stop
 * worked. The flushed window now delivers; nothing is captured after the pause. */
test("chunk-cycling: the window flushed BY pause delivers, and nothing is captured after it", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({
    speaker: "doctor", getState: () => ({}), refineEveryChunks: 1,
    onRefine: (t) => refined.push(t), chunkMs: 5,
  });
  ctl.pause();                                             // doctor taps Pause mid-window
  sessions[0].opts.onFinal("words spoken before the pause");
  assert.deepEqual(refined, ["words spoken before the pause"], "the doctor's own words must reach the draft");
  assert.equal(sessions.length, 1, "and no new window is armed, so no audio is captured after the pause");
  ctl.stop();
});

test("chunk-cycling: legacy shape — a window finishing while paused does not re-arm", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({
    speaker: "doctor",
    getState: () => ({}),
    refineEveryChunks: 1,
    onRefine: (t) => refined.push(t),
    chunkMs: 5
  });
  ctl.pause();                                             // doctor taps Pause mid-window
  sessions[0].opts.onFinal("some transcript");             // the flushed window lands (and drafts)
  assert.equal(sessions.length, 1, "the mic stays down until resume — nothing is captured after pause");
  assert.equal(refined.length, 1, "exactly one draft, from the flushed window, not one per later window");
  ctl.stop();
});

test("chunk-cycling: onRefine fires normally on final when not paused", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({
    speaker: "doctor",
    getState: () => ({}),
    refineEveryChunks: 1,
    onRefine: (t) => refined.push(t),
    chunkMs: 5
  });
  sessions[0].opts.onFinal("some transcript");
  assert.equal(refined.length, 1, "refine fires on the un-paused chunk boundary");
  ctl.stop();
});

// stop()'s return value is the contract opd-emr.js's stopVoice() relies on to avoid firing its
// own (stale) refine alongside the flush's (complete) one -- see opd-emr.js stopVoice()/doRefine().
test("stop(): flushing an in-flight, un-paused chunk returns true, and that flush's onRefine fires exactly once with the complete transcript", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({ speaker: "doctor", getState: () => ({}), refineEveryChunks: 1, onRefine: (t) => refined.push(t), chunkMs: 5 });
  const willRefine = ctl.stop();
  assert.equal(willRefine, true, "stop() reports the flush will call onRefine itself (caller should skip its own fallback)");
  sessions[0].opts.onFinal("complete transcript");   // simulates the async native stop -> transcribe -> onFinal
  assert.equal(refined.length, 1, "onRefine fired exactly once");
  assert.equal(refined[0], "complete transcript", "with the COMPLETE (post-flush) transcript, not a stale one");
});

/* CONTRACT CHANGE: stopping while a pause-flush is STILL IN FLIGHT now reports true and drafts the
 * complete transcript. Under the old contract it reported false and the flush refused to refine, so
 * a doctor who tapped Pause then Stop got no note at all. Stopping when already fully paused (the
 * flush has landed, nothing in flight) still reports false — covered by the next test. */
test("stop(): stopping while a pause-flush is in flight still drafts the complete transcript", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop: () => {} };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({ speaker: "doctor", getState: () => ({}), refineEveryChunks: 1, onRefine: (t) => refined.push(t), chunkMs: 5 });
  ctl.pause();
  const willRefine = ctl.stop();
  assert.equal(willRefine, true, "the in-flight flush will deliver, so the caller must not double-refine");
  sessions[0].opts.onFinal("complete transcript");
  assert.deepEqual(refined, ["complete transcript"], "…and the note is drafted from the complete transcript");
});

test("stop(): stopping when the pause has already fully landed returns false (caller refines itself)", () => {
  const sessions = [];
  const refined = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => {
    const s = { opts: opts, stop() { const cb = opts.onFinal; if (cb) cb("flushed on pause"); } };
    sessions.push(s);
    return s;
  });
  const ctl = AMB2.start({ speaker: "doctor", getState: () => ({}), refineEveryChunks: 1, onRefine: (t) => refined.push(t), chunkMs: 5 });
  ctl.pause();                                   // this mock's stop() delivers, so the flush completes here
  assert.deepEqual(refined, ["flushed on pause"]);
  assert.equal(ctl.stop(), false, "nothing left in flight, so the caller must make its own refine call");
});

test("stop(): no in-flight chunk (no ASR host) returns false, so the caller knows to make its own refine call", () => {
  const ctl = AMB.start({ speaker: "doctor", getState: () => ({}), onRefine: () => {} });   // real module; no window.SMD_VOICE in Node -> armChunk() is a no-op
  assert.equal(ctl.stop(), false, "nothing to flush -> caller must refine itself");
});

test("isSilence: SFSpeech silence endpoints are benign, real errors are not", () => {
  // These fire on every natural pause in a consultation — must NOT count toward the failure breaker.
  for (const s of ["No speech detected", "No match", "Retry", "kAFAssistantErrorDomain 1110", "code 203"])
    assert.equal(AMB.isSilence(s), true, `"${s}" should be treated as benign silence`);
  // Genuine failures must still count (so a truly broken engine stops instead of looping forever).
  for (const s of ["recording-failure", "transcription-failed", "mic-denied", "clinical-unavailable", ""])
    assert.equal(AMB.isSilence(s), false, `"${s}" must remain a hard error`);
});

test("chunk-cycling: repeated silence endpoints keep the loop alive (do not trip the failure breaker)", async () => {
  // A real consult has many pauses. Each pause makes iOS SFSpeech end a window with "No speech
  // detected". Before the fix, >3 of these tripped errStreak and killed the loop ("worked first
  // time, suddenly stopped"). Now each silence must re-arm without counting or surfacing an error.
  const sessions = [], errors = [];
  const AMB2 = freshAmbientWithMockVoice((opts) => { const s = { opts, stop: () => {} }; sessions.push(s); return s; });
  const ctl = AMB2.start({ speaker: "doctor", engine: "fast", getState: () => ({}), chunkMs: 60000, onError: (e) => errors.push(e) });
  const ROUNDS = 6;                                          // more than the old 3-strike breaker
  for (let i = 0; i < ROUNDS; i++) {
    sessions[sessions.length - 1].opts.onError("No speech detected");
    await new Promise((r) => setTimeout(r, 320));            // let the 300ms re-arm fire
  }
  assert.ok(sessions.length >= ROUNDS, `loop kept re-arming across ${ROUNDS} pauses (got ${sessions.length})`);
  assert.ok(!errors.includes("No speech detected"), "benign silence is never surfaced as an error");
  ctl.stop();
});

test("Auto mode decodes with language='auto' so a mixed utterance code-switches (not forced single language)", () => {
  let first = null;
  const AMB2 = freshAmbientWithMockVoice((opts) => { if (!first) first = opts; return { opts, stop: () => {} }; });
  const ctl = AMB2.start({ speaker: "doctor", engine: "clinical", getState: () => ({}), chunkMs: 60000, language: "auto" });
  assert.equal(first.language, "auto", "Auto mode must pass language=auto to Whisper");
  ctl.stop();
});

test("Forced Telugu mode keeps the 'te' decode hint", () => {
  let first = null;
  const AMB2 = freshAmbientWithMockVoice((opts) => { if (!first) first = opts; return { opts, stop: () => {} }; });
  const ctl = AMB2.start({ speaker: "doctor", engine: "clinical", getState: () => ({}), chunkMs: 60000, language: "te" });
  assert.equal(first.language, "te");
  ctl.stop();
});
