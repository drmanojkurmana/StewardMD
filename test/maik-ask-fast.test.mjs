/* test/maik-ask-fast.test.mjs — MaiK Ask pipelined interview (flag smd_maik_ask_fast).
 *
 * Locks down the three latency/data-loss defects found on 2026-08-23:
 *  1) realListen resolved EMPTY the instant the 14s timer fired: it called sess.stop() and resolved
 *     with `text` in the same tick. stop() only STARTS whisper transcription, and clinical Whisper
 *     emits no partials, so `text` was "" and the real onFinal was dropped by `if (done) return`.
 *     Result: every question burned 14s and captured nothing, then re-asked.
 *  2) No end-of-speech endpointing at all — the mic always ran the full window.
 *  3) The next question waited on the previous answer's LLM extraction.
 * Plus: there was no interview transcript anywhere, and turns with no finding lost their answer.
 *
 * node --test test/maik-ask-fast.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.SMD_VVITALS = require("../voice-vitals.js");
const PW = require("../maik-pathways.js");
const A = require("../maik-ask.js");
PW.register(JSON.parse(readFileSync(new URL("../clinical-pathways/headache.json", import.meta.url), "utf8")));
const headache = PW.get("headache");

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// Red flags are deliberately NOT pipelined (safety carve-out), so to exercise the pipelining itself we
// seed them as already-answered and let the routine targets come up.
function noRedFlags() {
  const k = {};
  (PW._targets(headache) || []).forEach((t) => { if (t.kind === "redflag") k[t.field] = "absent"; });
  return k;
}

function templateProvider(extract) {
  return {
    generateNextQuestion: (ctx) => Promise.resolve({ action: "ask", question: "Q:" + ctx.targetField, language: "en", targetField: ctx.targetField }),
    extractPatientAnswer: extract || (() => Promise.resolve({ findings: [] }))
  };
}

/* ---------------------------------------------------------------- listen turn */
// Fake SMD_VOICE.listen session: records whether stop() was called, lets the test fire onFinal late.
function fakeVoice() {
  const v = { stopped: false, opts: null };
  v.listen = (opts) => { v.opts = opts; return { stop: () => { v.stopped = true; } }; };
  return v;
}

test("BUG 1: a late onFinal is used, not discarded by the hard timer", async () => {
  const v = fakeVoice();
  const turn = A._listenTurn({ listen: v.listen, maxMs: 20, graceMs: 500 });
  await tick(40);                                  // hard timer fires
  assert.equal(v.stopped, true, "the window must stop the mic");
  v.opts.onFinal("moodu rojulu");                  // transcription lands AFTER the timer, as on device
  assert.equal(await turn.promise, "moodu rojulu", "the real transcript must win, not an empty string");
});

test("BUG 1: it does not resolve in the same tick as the stop", async () => {
  const v = fakeVoice();
  const turn = A._listenTurn({ listen: v.listen, maxMs: 10, graceMs: 500 });
  let settled = false; turn.promise.then(() => (settled = true));
  await tick(30);
  assert.equal(v.stopped, true);
  assert.equal(settled, false, "must still be waiting for onFinal after the mic stops");
});

test("the grace window eventually gives up so the loop can never hang", async () => {
  const v = fakeVoice();
  const turn = A._listenTurn({ listen: v.listen, maxMs: 10, graceMs: 20 });
  assert.equal(await turn.promise, "", "no onFinal within grace -> empty, loop continues");
});

test("Done ends the turn early and still waits for the transcript", async () => {
  const v = fakeVoice();
  const turn = A._listenTurn({ listen: v.listen, maxMs: 10000, graceMs: 500 });
  turn.done();
  assert.equal(v.stopped, true, "Done stops the mic immediately (no waiting for the cap)");
  v.opts.onFinal("రెండు రోజులు");
  assert.equal(await turn.promise, "రెండు రోజులు");
});

test("Skip abandons the answer immediately", async () => {
  const v = fakeVoice();
  const turn = A._listenTurn({ listen: v.listen, maxMs: 10000, graceMs: 5000 });
  turn.skip();
  assert.equal(await turn.promise, "", "skip resolves empty at once, no grace wait");
});

test("BUG 2: silence endpointing is requested from the ASR layer", async () => {
  const v = fakeVoice();
  A._listenTurn({ listen: v.listen, maxMs: 100, graceMs: 100, silenceMs: 1500 });
  assert.equal(v.opts.silenceEndpointMs, 1500, "must ask the native engine to auto-stop on silence");
  assert.equal(v.opts.engine, "clinical");
  assert.equal(v.opts.noCloud, true, "patient audio must never leave the device");
});

/* ---------------------------------------------------------------- transcript */
test("transcript includes turns that produced no finding", () => {
  const tx = A._buildTranscript([
    { n: 1, question: "How long?", answer: "moodu rojulu" },
    { n: 2, question: "Any vomiting?", answer: "" },
    { n: 3, question: "Which side?", answer: "kudi vaipu" }
  ]);
  assert.ok(tx.includes("How long?") && tx.includes("moodu rojulu"));
  assert.ok(tx.includes("Any vomiting?"), "a question with no usable answer must still appear");
  assert.ok(tx.includes("kudi vaipu"));
});

/* ---------------------------------------------------------------- pipelining */
test("BUG 3: the next question does NOT wait for the previous answer's LLM extraction", async () => {
  const order = [];
  let releaseExtract;
  const blocked = new Promise((r) => (releaseExtract = r));
  const provider = templateProvider((ctx, t) => {
    order.push("extract:" + ctx.targetField);
    return blocked.then(() => ({ findings: [{ field: ctx.targetField, value: "late-" + ctx.targetField, confidence: 0.9 }] }));
  });
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider, background: true, known: noRedFlags(),
    listen: () => Promise.resolve("something the on-device pass cannot classify"),
    onQuestion: (q) => order.push("ask:" + q.targetField)
  });
  await tick(60);
  const asks = order.filter((o) => o.startsWith("ask:"));
  assert.ok(asks.length >= 2, `expected to keep asking while extraction is blocked, got ${JSON.stringify(order)}`);
  releaseExtract();
  ctl.stop();
  await ctl.promise;
});

test("backgrounded extractions are reconciled into the final summary", async () => {
  const provider = templateProvider((ctx) =>
    tick(15).then(() => ({ findings: [{ field: ctx.targetField, value: "late-" + ctx.targetField, confidence: 0.9 }] })));
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider, background: true, known: noRedFlags(),
    listen: () => Promise.resolve("unclassifiable answer"),
    maxQuestions: 3
  });
  const s = await ctl.promise;
  assert.ok(s.findings.length > 0, "late findings must land in the summary");
  assert.ok(s.findings.every((f) => String(f.value).startsWith("late-")), JSON.stringify(s.findings));
  assert.ok(!Object.values(s.known || {}).includes("__pending__"), "no __pending__ sentinel may survive");
});

test("summary carries a transcript covering every question asked", async () => {
  const answers = ["moodu rojulu", "ledu", "ledu", "kudi vaipu", "throbbing", "chala ekkuva"];
  let i = 0;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: templateProvider(), background: true,
    listen: () => Promise.resolve(answers[i++] || "ledu"), maxQuestions: 4
  });
  const s = await ctl.promise;
  assert.ok(typeof s.transcript === "string" && s.transcript.length > 0, "a transcript must exist");
  assert.equal(s.turns.length, s.asked, "one recorded turn per question asked");
  assert.ok(s.transcript.includes(answers[0]), "the first answer must appear verbatim");
});

/* ---------------------------------------------------------------- safety */
test("SAFETY: a red flag is still extracted INLINE in background mode (never deferred)", async () => {
  let alerted = null, sawRoutineAfterRedflag = false, redflagField = null;
  const provider = templateProvider((ctx) => {
    // Descriptive positive that only the LLM can classify - the case the carve-out exists for.
    if (!redflagField) redflagField = ctx.targetField;
    return tick(10).then(() => ({ findings: [{ field: ctx.targetField, value: "numbness since morning", confidence: 0.9 }] }));
  });
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider, background: true,
    listen: () => Promise.resolve("numbness since this morning"),
    onQuestion: () => { if (alerted) sawRoutineAfterRedflag = true; },
    onRedFlag: (rf) => (alerted = rf)
  });
  const s = await ctl.promise;
  assert.ok(alerted, "a descriptive red-flag answer must still alert the doctor");
  assert.equal(s.stoppedReason, "red-flag", "the interview must STOP on a red flag, not keep going");
  assert.equal(sawRoutineAfterRedflag, false, "no routine question may be asked after the alert");
});

test("non-background mode still behaves exactly as before", async () => {
  const answers = ["moodu rojulu", "ledu", "ledu", "kudi vaipu"];
  let i = 0;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: templateProvider(),
    listen: () => Promise.resolve(answers[i++] || "ledu"), maxQuestions: 3
  });
  const s = await ctl.promise;
  assert.ok(s.asked > 0 && s.findings.length > 0);
});
