/* test/clinix-physiology-presets.test.mjs - every preset must show what its teaching note says.
 *
 * Audit 2026-09-27: several presets contradicted their own notes. rs-copd said "watch the CO2 climb"
 * while PaCO2 moved 58 to 60 from 24% to 100% oxygen; cv-htn said "ejection fraction preserved" at
 * an EF of 48; cv-septic said "warm peripheries" while listing "Cool peripheries"; cv-hypovol grew a
 * "hypertrophied ventricle" S4 from compensatory vasoconstriction; a healthy adult had an EtCO2 7
 * below PaCO2; and near-zero drive gave PaO2 above PAO2 (an A-a gradient of 0).
 *
 * node --test test/clinix-physiology-presets.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Phys from "../clinix-physiology.js";

const cvs = (id, over = {}) => {
  const p = Phys.preset(id).params;
  return Phys.simulateCardiovascular(Object.assign({
    preload: p.preload, afterload: p.afterload, contractility: p.contractility,
    heartRate: p.heartRate, rhythm: p.rhythm,
    valveLesion: { type: p.valve, severity: p.severity || "moderate" }
  }, over));
};
const resp = (id, over = {}) => Phys.simulateRespiratory(Object.assign({}, Phys.preset(id).params, over));
const has = (o, re) => o.clinicalSigns.some((s) => re.test(s));

/* ── cardiovascular presets ─────────────────────────────────────────────────────────────────── */

test("cv-normal: the reference point is normal", () => {
  const o = cvs("cv-normal");
  assert.equal(o.stateLabel, "Normal haemodynamics");
  assert.equal(o.heartSoundKind, "s1s2_normal");
});

test("cv-hypovol: flat JVP, narrow pulse pressure, cool, and NO hypertrophy S4", () => {
  const o = cvs("cv-hypovol");
  assert.equal(o.jvpHeightCm, 0);
  assert.ok(has(o, /Narrow pulse pressure/), o.clinicalSigns.join(" | "));
  assert.ok(has(o, /Cool peripheries/));
  assert.notEqual(o.heartSoundKind, "s4_gallop", "an empty ventricle is not a hypertrophied one");
  assert.equal(has(o, /hypertrophied/), false);
});

test("cv-cardiogenic: same low output as hypovolaemia, opposite JVP, cold", () => {
  const c = cvs("cv-cardiogenic"), h = cvs("cv-hypovol");
  assert.ok(c.cardiacOutput < 3.5 && h.cardiacOutput < 3.5);
  assert.ok(c.jvpHeightCm >= 8 && h.jvpHeightCm === 0);
  assert.ok(has(c, /Cool peripheries/));
});

test("cv-septic: high output, hypotensive, WARM peripheries", () => {
  const o = cvs("cv-septic");
  assert.ok(o.cardiacOutput > 6.5 && o.meanArterialPressure < 65);
  assert.ok(has(o, /Warm/), o.clinicalSigns.join(" | "));
  assert.equal(has(o, /Cool peripheries/), false, "the note says warm, so the signs must not say cool");
});

test("cv-ccf: raised JVP, S3, low output; more contractility raises EF and lowers ESV", () => {
  const o = cvs("cv-ccf"), better = cvs("cv-ccf", { contractility: 90 });
  assert.ok(o.jvpHeightCm >= 10);
  assert.equal(o.heartSoundKind, "s3_gallop");
  assert.ok(o.cardiacOutput < 4.2 || o.ejectionFraction < 40);
  assert.ok(better.ejectionFraction > o.ejectionFraction && better.esv < o.esv);
});

test("cv-htn: pressure-loaded ventricle with an S4 and a PRESERVED ejection fraction", () => {
  const o = cvs("cv-htn");
  assert.ok(o.ejectionFraction >= 55, "EF " + o.ejectionFraction);
  assert.ok(o.bpSystolic >= 140, "BP " + o.bpSystolic);
  assert.equal(o.heartSoundKind, "s4_gallop");
});

test("cv-af: irregularly irregular with a pulse deficit", () => {
  const o = cvs("cv-af");
  assert.equal(o.pulseCharacter, "irregularly_irregular");
  assert.ok(has(o, /pulse deficit/));
});

test("cv-as: an unremarkable cuff pressure with a large gradient and a slow-rising pulse", () => {
  const o = cvs("cv-as");
  assert.ok(o.valveGradient > 40);
  assert.ok(o.bpSystolic < 150, "the pressure is not impressive: " + o.bpSystolic);
  assert.equal(o.pulseCharacter, "parvus_et_tardus");
});

test("cv-ar: huge total stroke volume, ordinary forward one, collapsing pulse", () => {
  const o = cvs("cv-ar");
  assert.ok(o.totalStrokeVolume > o.strokeVolume * 1.4);
  assert.ok(o.pulsePressure > 65);
  assert.equal(o.pulseCharacter, "water_hammer");
});

test("cv-ms: dropping the rate raises the output", () => {
  assert.ok(cvs("cv-ms", { heartRate: 70 }).cardiacOutput > cvs("cv-ms").cardiacOutput);
});

test("cv-chb: a large stroke volume that still cannot rescue a rate of 38", () => {
  const o = cvs("cv-chb"), n = cvs("cv-normal");
  assert.equal(o.jvpWaveMode, "cannon");
  assert.ok(o.strokeVolume > n.strokeVolume && o.cardiacOutput < n.cardiacOutput);
});

/* ── respiratory presets ────────────────────────────────────────────────────────────────────── */

test("rs-normal: single-figure A-a gradient and a normal 2-5 mmHg PaCO2-EtCO2 gap", () => {
  const o = resp("rs-normal");
  assert.ok(o.aaGradient < 10, "A-a " + o.aaGradient);
  const gap = o.paCO2 - o.etCO2;
  assert.ok(gap >= 2 && gap <= 5, "PaCO2 " + o.paCO2 + " vs EtCO2 " + o.etCO2);
});

test("rs-copd: winding FiO2 from 24% to 100% makes the CO2 CLIMB, clinically", () => {
  const low = resp("rs-copd", { fiO2: 0.24 }), high = resp("rs-copd", { fiO2: 1.0 });
  const rise = high.paCO2 - low.paCO2;
  assert.ok(rise >= 8 && rise <= 20, "PaCO2 " + low.paCO2 + " to " + high.paCO2);
  assert.ok(high.pH < low.pH - 0.03, "and the pH falls: " + low.pH + " to " + high.pH);
  assert.ok(low.spO2 >= 86 && low.spO2 <= 92, "24% lands near the 88-92 target: " + low.spO2);
  let last = -1;
  for (const fiO2 of [0.24, 0.28, 0.35, 0.5, 0.7, 1.0]) {
    const o = resp("rs-copd", { fiO2 });
    assert.ok(o.paCO2 >= last, "monotone climb at FiO2 " + fiO2);
    last = o.paCO2;
  }
});

test("a normal lung's CO2 is essentially unchanged by FiO2", () => {
  const a = resp("rs-normal", { fiO2: 0.21 }), b = resp("rs-normal", { fiO2: 1.0 });
  assert.ok(Math.abs(b.paCO2 - a.paCO2) <= 1, a.paCO2 + " to " + b.paCO2);
});

test("rs-asthma: low CO2 at the ceiling; more obstruction brings a 'normal' CO2", () => {
  const o = resp("rs-asthma"), tired = resp("rs-asthma", { airwayResistance: 6 });
  assert.ok(o.paCO2 < 40);
  assert.ok(tired.paCO2 >= 35 && tired.paCO2 > o.paCO2, "exhaustion CO2 in the normal range: " + tired.paCO2);
  assert.equal(tired.ventilationLimited, true);
});

test("rs-ards: FiO2 1.0 barely moves the saturation", () => {
  const o = resp("rs-ards"), max = resp("rs-ards", { fiO2: 1.0 });
  assert.ok(max.spO2 - o.spO2 <= 6, o.spO2 + " to " + max.spO2);
  assert.ok(o.pfRatio < 150);
});

test("rs-fibrosis: restriction, preserved ratio, rapid shallow breathing, wide A-a", () => {
  const o = resp("rs-fibrosis");
  assert.equal(o.spirometry.pattern, "restrictive");
  assert.ok(o.spirometry.ratio >= 0.7 && o.respiratoryRate > 20 && o.aaGradient > 15);
});

test("rs-pe: high minute ventilation, low CO2, wide PaCO2-EtCO2 gap", () => {
  const o = resp("rs-pe"), n = resp("rs-normal");
  assert.ok(o.minuteVentilation > n.minuteVentilation && o.paCO2 < 38 && o.paCO2 - o.etCO2 > 8);
});

test("rs-opioid: oxygen lifts the saturation and does nothing for CO2 or pH", () => {
  const room = resp("rs-opioid"), o2 = resp("rs-opioid", { fiO2: 0.5 });
  assert.ok(o2.spO2 > room.spO2);
  assert.ok(Math.abs(o2.paCO2 - room.paCO2) <= 1 && Math.abs(o2.pH - room.pH) <= 0.02);
});

test("rs-dka: Kussmaul compensation lands on Winter's formula", () => {
  const o = resp("rs-dka");
  assert.ok(Math.abs(o.paCO2 - (1.5 * o.hco3 + 8)) <= 4);
  assert.ok(has(o, /Kussmaul/));
});

test("rs-pneumonia: shunt, type 1 failure, low CO2", () => {
  const o = resp("rs-pneumonia");
  assert.ok(o.failureType === "type1" && o.paCO2 < 40 && o.shuntFraction >= 20);
});

test("every preset has a claim test in this file", () => {
  const covered = ["cv-normal", "cv-hypovol", "cv-cardiogenic", "cv-septic", "cv-ccf", "cv-htn", "cv-af",
    "cv-as", "cv-ar", "cv-ms", "cv-chb", "rs-normal", "rs-copd", "rs-asthma", "rs-ards", "rs-fibrosis",
    "rs-pe", "rs-opioid", "rs-dka", "rs-pneumonia"];
  for (const p of Phys.PRESETS) assert.ok(covered.includes(p.id), "untested preset " + p.id);
});

/* ── contract sweep ─────────────────────────────────────────────────────────────────────────── */

test("respiratory sweep: finite, SpO2 in [0,100], PaO2 never above PAO2", () => {
  let n = 0;
  for (const airwayResistance of [0.3, 1, 2.5, 4.2, 8]) {
    for (const compliance of [0.1, 0.5, 1, 3]) {
      for (const deadSpaceFraction of [0.05, 0.3, 0.6, 0.85]) {
        for (const respiratoryDrive of [0, 2, 5, 10, 45, 100, 260]) {
          for (const fiO2 of [0.21, 0.5, 1.0]) {
            for (const shuntFraction of [0, 0.3, 0.6]) {
              for (const baseExcess of [-25, 0, 9, 20]) {
                const o = Phys.simulateRespiratory({ airwayResistance, compliance, deadSpaceFraction,
                  respiratoryDrive, fiO2, shuntFraction, baseExcess });
                const tag = JSON.stringify({ airwayResistance, compliance, deadSpaceFraction, respiratoryDrive, fiO2, shuntFraction, baseExcess });
                for (const [k, v] of Object.entries(o)) {
                  if (typeof v === "number") assert.ok(Number.isFinite(v), k + " not finite at " + tag);
                }
                assert.ok(o.spO2 >= 0 && o.spO2 <= 100, "SpO2 " + o.spO2 + " at " + tag);
                assert.ok(o.paO2 <= o.pAO2, "PaO2 " + o.paO2 + " > PAO2 " + o.pAO2 + " at " + tag);
                assert.ok(o.aaGradient >= 0);
                n++;
              }
            }
          }
        }
      }
    }
  }
  assert.ok(n > 5000);
});

test("cardiovascular sweep: finite numbers everywhere", () => {
  for (const preload of [10, 60, 100, 180, 250]) for (const afterload of [20, 70, 135, 250])
    for (const contractility of [10, 90, 220]) for (const heartRate of [20, 72, 220])
      for (const rhythm of ["sinus", "afib", "chb"]) {
        const o = Phys.simulateCardiovascular({ preload, afterload, contractility, heartRate, rhythm });
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "number") assert.ok(Number.isFinite(v), k + " not finite");
        }
      }
});
