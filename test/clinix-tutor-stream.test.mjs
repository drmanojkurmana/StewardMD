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

