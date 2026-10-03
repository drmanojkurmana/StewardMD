/* test/voice-ambient-reported.test.mjs — reported-speech gate in voice-ambient.reduce().
 * The OPD ambient scribe passes speaker:"doctor" for everything it hears, so a patient saying
 * "my BP was 150/90 at home" used to fill the objective vitals. Clauses that report a reading are
 * now merged as speaker:"patient" (dropped from objective fields by voice-emr-map), and plain
 * doctor dictation is processed exactly as before.
 * node --test test/voice-ambient-reported.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const AMB = require(join(HERE, "..", "voice-ambient.js"));

function applied(res) {
  const out = {};
  res.updates.forEach((u) => { if (u.applied && u.source === "voice") out[u.field] = u.value; });
  return out;
}

test("patient-reported home BP does not fill vitals; the examined BP does", () => {
  const res = AMB.reduce("My BP was 150/90 at home. BP 128/82, pulse 88.", { speaker: "doctor", state: {} });
  const f = applied(res);
  assert.equal(f.bpSys, 128);
  assert.equal(f.bpDia, 82);
  assert.equal(f.pulse, 88);
  assert.ok(res.dropped.some((d) => d.field === "bpSys" && d.reason === "patient_reported_objective"));
});

test("a past reading is not used as the current value", () => {
  const f = applied(AMB.reduce("BP was 80/50 before fluids, now BP 110/70", { speaker: "doctor", state: {} }));
  assert.equal(f.bpSys, 110);
  assert.equal(f.bpDia, 70);
});

test("a reported reading alone leaves the field empty, never wrong", () => {
  const f = applied(AMB.reduce("my sugar was 300 yesterday", { speaker: "doctor", state: {} }));
  assert.equal(f.grbs, undefined);
});

test("third-person exam dictation is not treated as reported", () => {
  const f = applied(AMB.reduce("His BP is 130/80, pulse 90", { speaker: "doctor", state: {} }));
  assert.equal(f.bpSys, 130);
  assert.equal(f.pulse, 90);
});

test("plain doctor dictation is byte-identical to the ungated path", () => {
  const t = "BP 120/80, pulse 72 regular, temperature 99 F, RR 18";
  const gated = AMB.reduce(t, { speaker: "doctor", state: {}, now: 1 });
  assert.deepEqual(AMB.splitReported(t).reported, []);
  assert.equal(gated.reported, undefined, "no reported clauses: original code path");
  assert.equal(applied(gated).bpSys, 120);
});

test("a history clause in the same sentence does not drop the exam values", () => {
  const f = applied(AMB.reduce("Fever since yesterday, BP 120/80", { speaker: "doctor", state: {} }));
  assert.equal(f.bpSys, 120);
});

function loadWithWindow(store) {
  // The module reads flags through its root (window). Load a fresh copy with a fake window.
  const path = require.resolve(join(HERE, "..", "voice-ambient.js"));
  delete require.cache[path];
  globalThis.window = { localStorage: { getItem: (k) => (k in store ? store[k] : null) } };
  try { return require(path); } finally { delete globalThis.window; delete require.cache[path]; }
}

test("gate is ON by default in the browser (no flag set)", () => {
  const A = loadWithWindow({});
  assert.equal(applied(A.reduce("My BP was 150/90 at home", { speaker: "doctor", state: {} })).bpSys, undefined);
});

test("flag smd_scribe_reported_gate=0 restores the old behaviour", () => {
  const A = loadWithWindow({ smd_scribe_reported_gate: "0" });
  assert.equal(applied(A.reduce("My BP was 150/90 at home", { speaker: "doctor", state: {} })).bpSys, 150);
});

test("speaker:'patient' callers are unchanged", () => {
  const res = AMB.reduce("BP 150/90", { speaker: "patient", state: {} });
  assert.equal(applied(res).bpSys, undefined);
  assert.ok(res.dropped.some((d) => d.field === "bpSys"));
});

test("decimals are not clause breaks (temp 38.5 survives a reported clause)", () => {
  const sp = AMB.splitReported("Temp 38.5 F, my BP was 150/90 at home");
  assert.equal(sp.current, "Temp 38.5 F");
  assert.deepEqual(sp.reported, ["my BP was 150/90 at home"]);
});
