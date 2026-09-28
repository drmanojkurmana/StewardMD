/* The dose guard runs on every streamed frame (2026-09-27 audit). Its own file because clinix-tutor.js
 * captures `window` at load, so the stub has to exist before the module is imported. */
import { test } from "node:test";
import assert from "node:assert";

globalThis.window = globalThis.window || {};

test("dose guard: a streamed dose is never shown, not even mid-stream", async () => {
  const frames = [];
  globalThis.window.SMD_AI = {
    explainGroundedStream(pkg, opts, onDelta) {
      assert.equal(opts.mode, "clinix-tutor");
      onDelta("For an exacerbation give ");
      onDelta("For an exacerbation give prednisolone 40 mg");
      onDelta("For an exacerbation give prednisolone 40 mg daily.");
      return Promise.resolve({ text: "For an exacerbation give prednisolone 40 mg daily." });
    },
    explainGrounded() { return Promise.resolve({ error: "x" }); }
  };
  const T2 = (await import("../clinix-tutor.js")).default;
  const r = await T2.answer({}, "dose?", (t) => frames.push(t));
  assert.equal(r.text, T2.DOSE_REFUSAL);
  for (const f of frames) assert.equal(T2.looksLikeDose(f), false, "frame shown: " + f);
});


test("patient: sends only authored case facts to /clinix-patient and never voices a dose", async () => {
  const T2 = (await import("../clinix-tutor.js")).default;
  const cd = { patient: { name: "Ramesh", age: 62 }, opening: "I get breathless.", fallback: "Sorry doctor?",
    history: { smoking: { reply: "Forty years, beedis." }, cough: { reply: "Every morning." } } };
  let sent = null;
  globalThis.window.SMD_AI.clinixPatient = (payload, q) => { sent = { payload, q }; return Promise.resolve({ text: "No, nothing like that." }); };
  const ok = await T2.answerAsPatient(cd, "Any chest pain?");
  assert.equal(ok.text, "No, nothing like that.");
  assert.deepEqual(sent.payload.facts.map((f) => f.topic), ["smoking", "cough"]);
  assert.equal(sent.payload.persona.name, "Ramesh");
  assert.equal(sent.q, "Any chest pain?");
  globalThis.window.SMD_AI.clinixPatient = () => Promise.resolve({ text: "The doctor gave me 40 mg prednisolone daily." });
  const dose = await T2.answerAsPatient(cd, "What medicines?");
  assert.equal(dose.text, "Sorry doctor?");
  globalThis.window.SMD_AI.clinixPatient = () => Promise.resolve({ error: "quota" });
  assert.equal((await T2.answerAsPatient(cd, "x")).text, "Sorry doctor?");
});
