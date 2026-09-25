/* test/maik-audit-a.test.mjs — audit batch A (2026-09-25), the parts a browser run does not show.
 * Browser behaviour (Stop, KB fallback, pill layout, Detailed, dose follow-up, reopened topic) is in
 * test/run-maik-audit-a-ui.mjs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const H = readFileSync(new URL("../home.js", import.meta.url), "utf8");
const R = readFileSync(new URL("../reasoning.js", import.meta.url), "utf8");
const DD = readFileSync(new URL("../kb/ai/drug-dose.js", import.meta.url), "utf8");
const EV = readFileSync(new URL("../kb/ai/maik-evidence.js", import.meta.url), "utf8");

test("T08: the typing-pause router prefetch is skipped in LLM-first mode, where nothing reads it", () => {
  assert.match(H, /qEl\.addEventListener\("input", function \(\) \{\n\s*if \(maikLLMFirst\(\)\) return;/);
});

test("T11: no question text on the lock screen or in the toast", () => {
  const fn = H.slice(H.indexOf("function maikNotifyReady("), H.indexOf("function maikNotifyReady(") + 1200);
  assert.doesNotMatch(fn, /\+ label/);
  assert.match(fn, /body: "Your MaiK answer is ready\."/);
});

test("T14: native streaming uses the absolute API origin (the bridge that rewrites relative URLs is bypassed)", () => {
  assert.match(R, /var sb = \(isNative && window\.SMD_API_BASE && String\(b \|\| ""\)\.charAt\(0\) === "\/"\) \? window\.SMD_API_BASE \+ b : b;/);
  assert.equal((R.match(/sb \+ "\/explain\?stream=1"/g) || []).length, 2);
  assert.doesNotMatch(R, /[^s]b \+ "\/explain\?stream=1"/);
});

test("T01 (client): Regenerate reaches the server on every explain request body", () => {
  assert.equal((R.match(/regen: \(opts && opts\.regen\) \? true : undefined,/g) || []).length, 3);
});

test("T04: guideline recommendations render as the regimen, never an object; society codes are not claims", () => {
  const w = {}; new Function("window", "self", EV.replace(/^/, ""))(w, w);
  const E = w.MaiKEvidence || Object.values(w).find((v) => v && typeof v.bundle === "function");
  assert.ok(E, "MaiKEvidence loads");
  const b = E.bundle([{ source: "guideline", tier: 1, data: { recommendation: { line: "empiric", drugRefs: [{ regimenLabel: "Metronidazole", dose: "500-750 mg", route: "Oral/IV", freq: "every 8 h" }] } } }]);
  const txt = JSON.stringify(b);
  assert.doesNotMatch(txt, /\[object Object\]/);
  assert.match(txt, /Metronidazole 500-750 mg Oral\/IV every 8 h/);
  assert.match(EV, /recommendation: \(t\.recommendations && t\.recommendations\[0\]\) \|\| null,/);
});

test("T45: a dose question that names a condition, or a regimen, is not read as a drug", () => {
  const w = {}; new Function("window", DD)(w);
  const D = Object.values(w).find((v) => v && typeof v.intent === "function");
  assert.ok(D, "drug-dose module loads");
  assert.equal(D.intent("Adult first-line drug and dose for community acquired pneumonia: drug, dose, route"), null);
  assert.equal(D.intent("Adult doses for the first-line regimen for hypertension: each drug with dose"), null);
  assert.deepEqual(D.intent("Adult dosing of amoxicillin for community acquired pneumonia — dose, route"), { name: "amoxicillin", section: "adult" });
  assert.equal(D.intent("dose of metoprolol").name, "metoprolol");
});

test("T06: the mascot greets only an empty sheet; the live doctor stays the default (owner, 2026-09-25)", () => {
  assert.match(H, /if \(_bd && _bd\.querySelector\("\.maik-b"\)\) return;/);
  assert.match(H, /function maikLiveDocOn\(\) \{ try \{ return localStorage\.getItem\("smd_maik_live_doc"\) !== "0";/);
});

test("T13: the watchdog cancels the on-device job and on-device turns get a longer budget", () => {
  assert.match(H, /MAIK_TO_MS = _maikLocalTurn \? 180000 : 90000/);
  assert.match(H, /if \(_maikLocalTurn && window\.SMD_MAIK_LOCAL && window\.SMD_MAIK_LOCAL\.cancel\) window\.SMD_MAIK_LOCAL\.cancel\(\);/);
});
