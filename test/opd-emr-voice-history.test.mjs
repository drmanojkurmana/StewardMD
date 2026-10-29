// test/opd-emr-voice-history.test.mjs - the on-device pass that ticks comorbidities and fills home
// drugs from the spoken consult when the cloud draft leaves them blank.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../opd-emr.js", import.meta.url), "utf8");
function load() {
  const win = {};
  const doc = { getElementById: () => null, createElement: () => ({ classList: { add() {}, remove() {} } }), body: { appendChild() {} } };
  new Function("window", "document", "location", "localStorage", SRC)(win, doc, { search: "" }, { getItem: () => null, setItem: () => {} });
  return win.OPDEMR;
}
const E = load();
const run = (t, vals) => { const o = {}; E._inferHistory(t, vals || {}).forEach((u) => { o[u.field] = u.value; }); return o; };

test("a known diabetic on metformin ticks Diabetic with details and the home drug", () => {
  const o = run("Patient is a known diabetic on metformin 500 mg twice a day for 5 years.");
  assert.equal(o.dm, "Yes");
  assert.match(o.dmDetails, /metformin 500/i);
  assert.match(o.homeMeds, /Metformin 500 mg/);
});
test("a drug alone implies its condition", () => {
  assert.equal(run("He takes telmisartan 40 mg daily.").htn, "Yes");
  assert.equal(run("She is on thyroxine 100 mcg.").thyroid, "Yes");
  assert.equal(run("He is on insulin glargine at night.").dm, "Yes");
});
test("denied conditions are never ticked Yes", () => {
  const o = run("Patient is not diabetic, not hypertensive. No history of asthma or TB.");
  assert.equal(o.dm, "No"); assert.equal(o.htn, "No"); assert.equal(o.asthma, "No"); assert.equal(o.tb, "No");
});
test("a denial earlier in the sentence does not swallow a later condition", () => {
  const o = run("No fever, no cough, known diabetic since ten years.");
  assert.equal(o.dm, "Yes");
});
test("a negated list carries on across commas", () => {
  const o = run("He has no diabetes, hypertension.");
  assert.equal(o.dm, "No"); assert.equal(o.htn, "No");
});
test("a drug the doctor is starting today is not history", () => {
  assert.deepEqual(run("Let's start metformin 500 mg. Chest is clear."), {});
  assert.equal(run("Started on amlodipine today.").htn, undefined);
});
test("never overwrites a value already on the form", () => {
  const o = run("Known diabetic on metformin.", { Diabetes_yesNo: "Y", Diabetes_details: "T2DM 8y", home_medications: "Glimepiride" });
  assert.equal(o.dm, undefined); assert.equal(o.dmDetails, undefined); assert.equal(o.homeMeds, undefined);
});
test("every key it emits has a field on the form", () => {
  const o = run("Known diabetic and hypertensive, epileptic, on metformin and amlodipine, thyroxine.");
  Object.keys(o).forEach((k) => assert.ok(E.VOICE_MAP[k], k + " is mapped"));
});
