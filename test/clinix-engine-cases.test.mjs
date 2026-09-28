/* test/clinix-engine-cases.test.mjs - the engine against the REAL authored cases.
 *
 * Audit 2026-09-27: no case defined initialVitals, so every case monitor showed the engine defaults
 * (HR 82, BP 128/80, RR 18, SpO2 95) while the exam text said otherwise (RHD: 96 irregularly
 * irregular, 106/74; asthma: RR 26, HR 112). The watch got a regular pulse for a patient in AF,
 * generateSynthesis threw on every real case (diagnosis is an object), and HJR was positive in
 * every patient, including those with a normal JVP.
 *
 * node --test test/clinix-engine-cases.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Engine from "../clinix-engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "clinix/diseases");
const CASES = [];
for (const f of readdirSync(DIR).filter((n) => n.endsWith(".json")).sort()) {
  const d = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  for (const c of d.cases || []) CASES.push({ file: f, c });
}
const byId = (id) => CASES.find((x) => x.c.id === id).c;
const text = (e) => (e && typeof e === "object" ? String(e.finding || "") : String(e || ""));

/* Every number the case's own exam text states, keyed by vital. */
function statedVitals(c) {
  const out = { hr: [], bp: [], rr: [], spo2: [], temp: [] };
  for (const [k, v] of Object.entries(c.exam || {})) {
    const t = text(v);
    for (const m of t.matchAll(/\bpulse\s+(\d{2,3})\b/gi)) out.hr.push(+m[1]);
    if (/pulse$/.test(k)) {
      for (const m of t.matchAll(/\b(?:rate\s+)?(\d{2,3})\s+(?:per minute|by auscultation)/gi)) out.hr.push(+m[1]);
    }
    const bp = /(?:blood pressure|\bBP)\s*(\d{2,3})\/(\d{2,3})/i.exec(t) || (/\.bp$/.test(k) && /^(\d{2,3})\/(\d{2,3})/.exec(t));
    if (bp) out.bp.push([+bp[1], +bp[2]]);
    for (const m of t.matchAll(/respiratory rate\s+(\d{1,2})/gi)) out.rr.push(+m[1]);
    for (const m of t.matchAll(/SpO2\s+(\d{2,3})/gi)) out.spo2.push(+m[1]);
    for (const m of t.matchAll(/temperature\s+(\d{2}(?:\.\d)?)\s*C/gi)) out.temp.push(+m[1]);
  }
  return out;
}

test("the corpus is loaded", () => {
  assert.ok(CASES.length >= 22, "cases: " + CASES.length);
});

test("every case defines initialVitals, and they agree with the case's own exam text", () => {
  for (const { file, c } of CASES) {
    const v = c.initialVitals;
    assert.ok(v && typeof v === "object", `${file} ${c.id} has no initialVitals`);
    for (const k of ["hr", "bpSystolic", "bpDiastolic", "rr", "spo2", "temp", "gcs"]) {
      assert.equal(typeof v[k], "number", `${c.id} initialVitals.${k}`);
    }
    assert.ok(v.bpSystolic > v.bpDiastolic, c.id + " BP");
    assert.ok(v.spo2 > 50 && v.spo2 <= 100 && v.gcs >= 3 && v.gcs <= 15, c.id);
    const s = statedVitals(c);
    for (const hr of s.hr) assert.equal(v.hr, hr, `${c.id}: text says pulse ${hr}, monitor says ${v.hr}`);
    for (const [sb, db] of s.bp.slice(0, 1)) {
      assert.equal(v.bpSystolic, sb, `${c.id}: text says BP ${sb}/${db}`);
      assert.equal(v.bpDiastolic, db, `${c.id}: text says BP ${sb}/${db}`);
    }
    for (const rr of s.rr) assert.equal(v.rr, rr, `${c.id}: text says RR ${rr}, monitor ${v.rr}`);
    for (const sp of s.spo2) assert.equal(v.spo2, sp, `${c.id}: text says SpO2 ${sp}, monitor ${v.spo2}`);
    for (const t of s.temp) assert.equal(v.temp, t, `${c.id}: text says ${t} C, monitor ${v.temp}`);
  }
});

test("the parser actually finds the stated vitals (so the agreement test has teeth)", () => {
  const rhd = statedVitals(byId("case.rhd.savitri"));
  assert.ok(rhd.hr.includes(96) && rhd.bp[0][0] === 106 && rhd.spo2.includes(97));
  const asthma = statedVitals(byId("case.asthma.sneha"));
  assert.ok(asthma.rr.includes(26) && asthma.hr.includes(112));
  let stated = 0;
  for (const { c } of CASES) { const s = statedVitals(c); if (s.hr.length && s.bp.length) stated++; }
  assert.ok(stated >= 20, "most cases state pulse and BP: " + stated);
});

test("the engine monitor shows the case vitals, not the defaults", () => {
  const s = Engine.createCaseState(byId("case.rhd.savitri"), {});
  assert.equal(s.currentVitals.hr, 96);
  assert.equal(s.currentVitals.bpSystolic, 106);
  assert.equal(s.currentVitals.bpDiastolic, 74);
  const a = Engine.createCaseState(byId("case.asthma.sneha"), {});
  assert.equal(a.currentVitals.rr, 26);
  assert.equal(a.currentVitals.hr, 112);
  assert.equal(a.currentVitals.spo2, 94);
});

/* ── pulse profile ─────────────────────────────────────────────────────────────────────────── */

test("a case whose text says AF sends an irregularly irregular pulse to the watch", () => {
  for (const id of ["case.rhd.savitri", "case.hepatomegaly.savitri", "case.stroke.raghunath"]) {
    const p = Engine.getPulseProfile(Engine.createCaseState(byId(id), {}));
    assert.equal(p.condition, "afib", id);
    assert.equal(p.regularity, "irregularly_irregular", id);
  }
});

test("every case's pulse rhythm matches its own pulse text", () => {
  for (const { c } of CASES) {
    const all = Object.entries(c.exam || {}).filter(([k]) => /pulse|vitals/.test(k)).map(([, v]) => text(v)).join(" ");
    const af = /irregularly irregular/i.test(all);
    const p = Engine.getPulseProfile(Engine.createCaseState(c, {}));
    assert.equal(p.regularity === "irregularly_irregular", af, c.id + ": " + all.slice(0, 120));
    assert.equal(p.bpm, c.initialVitals.hr);
  }
});

test("getPulseProfile falls back to parsing the pulse text when no fields are set", () => {
  const mk = (t) => Engine.getPulseProfile(Engine.createCaseState({ exam: { "skill.exam.cvs.pulse": { finding: t } } }, {}));
  assert.equal(mk("Irregularly irregular, rate 110.").condition, "afib");
  assert.equal(mk("Collapsing (water-hammer) pulse, large volume.").condition, "water_hammer");
  assert.equal(mk("Slow-rising, low-volume carotid pulse.").condition, "parvus_et_tardus");
  assert.equal(mk("Regular, normal volume.").condition, "normal");
  const pf = Engine.getPulseProfile(Engine.createCaseState({ pulseFinding: "Irregularly irregular pulse" }, {}));
  assert.equal(pf.condition, "afib");
  const low = mk("Regular, low volume.");
  assert.ok(low.amplitude < 1);
});

/* ── synthesis on real cases ───────────────────────────────────────────────────────────────── */

test("generateSynthesis works on real cases whose diagnosis is an object", () => {
  for (const { c } of CASES) {
    const s = Engine.createCaseState(c, {});
    const syn = Engine.submitDiagnosis(s, "something unrelated", "guess");
    assert.equal(typeof syn.correctDiagnosis, "string", c.id);
    assert.ok(syn.correctDiagnosis.length > 10, c.id);
    assert.equal(syn.isCorrect, false, c.id);
  }
  const rhd = Engine.createCaseState(byId("case.rhd.savitri"), {});
  const ok = Engine.submitDiagnosis(rhd, "Rheumatic heart disease with severe mitral stenosis in AF", "");
  assert.equal(ok.isCorrect, true);
  assert.notEqual(ok.verdict, "incorrect_diagnosis");
});

test("generateSynthesis still handles a plain-string diagnosis", () => {
  const s = Engine.createCaseState({ diagnosis: "Community acquired pneumonia" }, {});
  const syn = Engine.submitDiagnosis(s, "community acquired pneumonia", "");
  assert.equal(syn.isCorrect, true);
  assert.equal(syn.correctDiagnosis, "Community acquired pneumonia");
});

/* ── HJR follows the physiology ────────────────────────────────────────────────────────────── */

function hjr(c) {
  const s = Engine.createCaseState(c, {});
  Engine.applyManeuver(s, "hjr");
  return Engine.executeExamAction(s, "jvp");
}

test("HJR is negative in a patient with a normal JVP and no heart failure", () => {
  const blank = hjr({ id: "x", diagnosis: "Bell palsy" });
  assert.equal(/positive hepatojugular|positive HJR/i.test(blank.finding), false, blank.finding);
  assert.ok(/negative/i.test(blank.finding));
  const normal = hjr({ exam: { jvp: { finding: "JVP not raised, 2 cm above the sternal angle." } }, diagnosis: "Asthma" });
  assert.equal(/positive hepatojugular/i.test(normal.finding), false, normal.finding);
  assert.equal(/positive hepatojugular/i.test(hjr(byId("case.rhd.savitri")).finding), false, "compensated MS, JVP 2 cm");
  assert.equal(/positive hepatojugular/i.test(hjr(byId("case.ihd.arvind")).finding), false, "STEMI without failure");
});

test("HJR is positive with raised right-sided pressures or heart failure", () => {
  assert.ok(/positive hepatojugular/i.test(hjr(byId("case.ccf.dinesh")).finding));
  assert.ok(/positive hepatojugular/i.test(hjr(byId("case.hepatomegaly.savitri")).finding));
  assert.ok(/positive hepatojugular/i.test(hjr(byId("case.copd.ramesh")).finding), "cor pulmonale, JVP 6 cm");
  assert.ok(/positive hepatojugular/i.test(hjr({ exam: { jvp: { finding: "JVP elevated 6 cm." } } }).finding));
  assert.ok(/positive hepatojugular/i.test(hjr({ diagnosis: { answer: "Congestive cardiac failure" } }).finding));
});

test("no engine exam output carries an em-dash", () => {
  const authored = { exam: { jvp: { finding: "JVP elevated 5 cm." } }, diagnosis: "Congestive heart failure" };
  for (const c of [authored].concat(CASES.map((x) => x.c))) {
    const s = Engine.createCaseState(c, {});
    for (const m of Object.keys(Engine.MANEUVERS)) {
      Engine.applyManeuver(s, m);
      for (const [a, t] of [["jvp"], ["pulse"], ["auscultate", "mitral"], ["auscultate", "aortic"], ["auscultate", "tricuspid"], ["edema"], ["inspect"]]) {
        const f = Engine.executeExamAction(s, a, t);
        assert.equal(String(f.finding).indexOf("—"), -1, c.id + " " + a + "@" + m);
      }
    }
  }
});
