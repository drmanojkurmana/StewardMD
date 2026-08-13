/* test/maik-ask-demo.test.mjs — MaiK Ask full-loop demo (Phase K, the spec §40 headache walkthrough).
 * Drives the real interview loop with scripted patient answers + a mock reasoning provider (template
 * questions + a stand-in extractor). Exercises deterministic-first extraction AND the LLM path, red-flag
 * negatives, no-re-ask of known fields, and convergence. node --test test/maik-ask-demo.test.mjs
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

// mock provider: pathway-template question + a stand-in LLM extractor for the non-deterministic answers
function provider() {
  return {
    generateNextQuestion: (ctx) => Promise.resolve({ action: "ask", question: "Q(" + ctx.targetField + ")", language: "te-en", targetField: ctx.targetField }),
    extractPatientAnswer: (ctx, t) => {
      const low = String(t).toLowerCase();
      if (ctx.targetField === "character" && /beat|throb/.test(low)) return Promise.resolve({ findings: [{ field: "character", value: "pulsatile", confidence: 0.9 }] });
      return Promise.resolve({ findings: [] });
    }
  };
}

test("full headache interview (demo) fills the expected history, no re-ask, no red flag", async () => {
  const headache = PW.get("headache");
  // §40: doctor already documented duration; patient answers in Telugu-English
  const known = PW.knownFrom({ Chief_complaints_duration: "2 days" }, headache);
  // answers are consumed in the order MaiK asks (priority): red flags first, then onset/location/character/severity
  const answers = ["ledu", "ledu", "ledu", "gradual ga start ayyindi", "right side lo undi", "beat ayye laga untundi", "chala severe ga undi"];
  let i = 0;
  const findings = {};
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: provider(), known,
    listen: () => Promise.resolve(answers[i++] || ""),
    onFinding: (f) => { findings[f.field] = f.value; }
  });
  const s = await ctl.promise;

  assert.equal(findings.duration, undefined, "duration was known -> not asked/refilled");
  assert.equal(findings.location, "right", "location captured from cue");
  assert.equal(findings.onset, "gradual", "onset captured from cue");
  assert.equal(findings.character, "pulsatile", "character captured via the LLM path");
  assert.equal(findings.severity, "severe", "severity captured from cue");
  assert.equal(findings.thunderclap_onset, "absent", "red flag answered + negative");
  assert.notEqual(s.stoppedReason, "red-flag", "no red flag on this benign case");
  assert.ok(s.asked <= headache.maxQuestions);
  // every captured finding is tagged as patient-spoken, never doctor_confirmed
  assert.ok(s.findings.every(f => f.source === "patient_spoken_via_MaiK"));
});

test("red-flag positive on the FIRST probe stops immediately + alerts", async () => {
  const headache = PW.get("headache");
  let alerted = false;
  const ctl = A._runInterview({
    pathway: headache, pathways: PW, provider: provider(),
    listen: () => Promise.resolve("avunu, sudden ga chala severe"),   // affirms thunderclap
    onRedFlag: () => (alerted = true)
  });
  const s = await ctl.promise;
  assert.equal(s.stoppedReason, "red-flag");
  assert.ok(alerted);
});
