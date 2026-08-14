/* test/maik-ask-flow.test.mjs — MaiK Ask interview loop (Phases E/G/I core).
 * Drives _runInterview with mocked provider/listen so the whole loop is deterministic: never re-asks
 * known fields, deterministic-first extraction, red-flag stop, doctor stop, maxQuestions cap.
 * node --test test/maik-ask-flow.test.mjs
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

// provider that just wraps the pathway template into an "ask" (no real LLM), and never extracts (LLM path unused here)
function templateProvider() {
  return {
    generateNextQuestion: (ctx) => Promise.resolve({ action: "ask", question: "Q:" + ctx.targetField, language: "en", targetField: ctx.targetField }),
    extractPatientAnswer: () => Promise.resolve({ findings: [] })
  };
}

test("deterministicAnswer: duration, yes/no, cue words", () => {
  assert.deepEqual(A._deterministicAnswer("three days", { field: "duration", emr: "Chief_complaints_duration" }), [{ field: "duration", value: "3 days", confidence: 0.85 }]);
  assert.equal(A._deterministicAnswer("vomiting undi", { field: "vomiting", kind: "associated" })[0].value, "present");
  assert.equal(A._deterministicAnswer("ledu", { field: "nausea", kind: "associated" })[0].value, "absent");
  assert.equal(A._deterministicAnswer("right side lo undi", { field: "location", kind: "field", cues: ["left", "right", "both"] })[0].value, "right");
});

test("full loop: never re-asks known, deterministic extraction fills findings, stops at cap", async () => {
  const asked = [], findings = [];
  const answers = ["yes it was sudden", "no weakness", "no fever", "gradually actually", "right side", "throbbing", "very severe"];
  let ai = 0;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: templateProvider(),
    known: PW.knownFrom({ Chief_complaints_duration: "3 days" }, headache),   // duration known
    listen: () => Promise.resolve(answers[ai++] || "no"),
    onQuestion: (q) => asked.push(q.targetField),
    onFinding: (f) => findings.push(f.field)
  });
  const s = await ctl.promise;
  assert.ok(!asked.includes("duration"), "duration was known -> never asked");
  assert.ok(asked.length <= headache.maxQuestions, "respects maxQuestions");
  assert.ok(s.findings.length > 0, "captured findings deterministically");
});

test("positive red flag stops the interview and alerts the doctor", async () => {
  let alerted = null;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: templateProvider(),
    listen: () => Promise.resolve("yes sudden severe"),   // affirms the very first red flag
    onRedFlag: (rf) => (alerted = rf)
  });
  const s = await ctl.promise;
  assert.equal(s.stoppedReason, "red-flag");
  assert.ok(alerted && alerted.field, "doctor was alerted with the red-flag field");
});

test("provider action alert_doctor stops (never diagnoses)", async () => {
  const ctl = A._runInterview({
    pathway: headache, pathways: PW,
    provider: { generateNextQuestion: () => Promise.resolve({ action: "alert_doctor", reason: "concerning" }), extractPatientAnswer: () => Promise.resolve({ findings: [] }) },
    listen: () => Promise.resolve("x")
  });
  const s = await ctl.promise;
  assert.equal(s.stoppedReason, "alert-doctor");
});

test("doctor stop ends the loop immediately", async () => {
  let calls = 0;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: templateProvider(),
    listen: () => { calls++; return new Promise(() => {}); }   // never resolves -> loop is waiting
  });
  ctl.stop();
  const s = await ctl.promise;
  assert.equal(s.stoppedReason, "doctor-stopped");
});

test("UI renders: confirm sheet, live card, review — with safety copy, no diagnosis", () => {
  const pw = { label: "Headache", maxQuestions: 7 };
  const c = A._renderConfirm(pw, "Telugu");
  assert.match(c, /Let MaiK ask/);
  assert.match(c, /data-mka="start"/);
  assert.match(c, /does not diagnose/i);
  const card = A._renderCard({ question: "Is it one side or both?", n: 2, of: 6, state: "listening" });
  assert.match(card, /Listening/);
  assert.match(card, /data-mka="stop"/);
  const rv = A._renderReview({ asked: 3, findings: [{ target: "location", value: "right-sided" }], stoppedReason: "complete" }, pw);
  assert.match(rv, /Location:/);
  assert.match(rv, /right-sided/);
  assert.match(rv, /Review in record/);
});

test("TTS lang map: te/hi/en -> -IN locales", () => {
  assert.equal(A._ttsLang("te-en"), "te-IN");
  assert.equal(A._ttsLang("hi"), "hi-IN");
  assert.equal(A._ttsLang("en"), "en-IN");
  assert.equal(A._ttsLang("something"), "en-IN");
});

test("red flag: descriptive positive alerts, explicit negation does not (critical fix)", () => {
  const rf = { field: "neuro_deficit", kind: "redflag", ask: "any weakness" };
  assert.ok(A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: "numbness in right hand since morning" }]), "descriptive positive -> alert");
  assert.equal(A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: "absent" }]), null, "absent -> no alert");
  assert.equal(A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: "no weakness" }]), null, "'no weakness' -> no alert");
  assert.equal(A._positiveRedFlag(rf, [{ field: "neuro_deficit", value: "ledu" }]), null, "Telugu negation -> no alert");
});

test("descriptive red-flag answer via the LLM path still stops + alerts", async () => {
  const readFileSync2 = (await import("node:fs")).readFileSync;
  const headache = PW.get("headache");
  let alerted = false;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW,
    // LLM returns a DESCRIPTIVE value (no yes/no word) for the first red-flag target
    provider: {
      generateNextQuestion: (ctx) => Promise.resolve({ action: "ask", question: "Q", targetField: ctx.targetField }),
      extractPatientAnswer: (ctx) => Promise.resolve({ findings: [{ field: ctx.targetField, value: "started very suddenly, worst pain ever", confidence: 0.9 }] })
    },
    listen: () => Promise.resolve("it just came on all of a sudden, terrible pain"),   // no yes/no keyword -> LLM path
    onRedFlag: () => (alerted = true)
  });
  const s = await ctl.promise;
  assert.equal(s.stoppedReason, "red-flag");
  assert.ok(alerted, "doctor alerted on a descriptive red-flag answer");
});

test("durationFromText: English + romanized Telugu/Hindi, singular/plural", () => {
  assert.equal(A._durationFromText("three days"), "3 days");
  assert.equal(A._durationFromText("moodu rojula nunchi"), "3 days");   // Telugu
  assert.equal(A._durationFromText("do din se"), "2 days");             // Hindi
  assert.equal(A._durationFromText("rendu vaaraalu"), "2 weeks");
  assert.equal(A._durationFromText("ek mahina"), "1 month");            // singular
  assert.equal(A._durationFromText("headache undi"), "");               // no duration -> LLM
});

test("question cache: a validated question is served instantly on the 2nd ask (0 LLM)", async () => {
  // fresh localStorage shim
  const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v) };
  globalThis.window = globalThis;
  delete require.cache[require.resolve("../maik-reasoning.js")];
  const R2 = require("../maik-reasoning.js");
  let calls = 0;
  R2.setProvider({ next: () => { calls++; return { action: "ask", question: "Is it one side or both?", targetField: "location" }; }, extract: () => ({ findings: [] }) });
  const ctx = { pathway: { id: "headache", fields: { location: {} } }, targetField: "location", language: "te-en" };
  const a = await R2.generateNextQuestion(ctx);
  const b = await R2.generateNextQuestion(ctx);
  assert.equal(a.question, "Is it one side or both?");
  assert.equal(b.question, "Is it one side or both?");
  assert.equal(calls, 1, "2nd ask served from cache, provider called only once");
  delete globalThis.localStorage; delete globalThis.window;
});
