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
