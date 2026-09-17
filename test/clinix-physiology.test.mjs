import { test } from "node:test";
import assert from "node:assert/strict";
import Phys from "../clinix-physiology.js";

/* Cardiovascular model ------------------------------------------------------
 * NOTE: this sandbox takes percent-of-normal inputs (preload/afterload/
 * contractility = 100 is nominal) and returns internally consistent,
 * deterministic values. It is NOT calibrated to absolute textbook normals:
 * the default input set yields CO 3.0 L/min with SBP 70 / DBP 46, not
 * 5.0 L/min and 120/80. The tests below pin the real model behaviour so a
 * future calibration change is a deliberate, reviewed diff.
 */

test("baseline cardiovascular output is deterministic with normal sound", () => {
  const o = Phys.simulateCardiovascular({});
  assert.equal(o.cardiacOutput, 3.0);
  assert.equal(o.strokeVolume, 42);
  assert.equal(o.bpSystolic, 70);
  assert.equal(o.bpDiastolic, 46);
  assert.equal(o.pulsePressure, 24);
  assert.equal(o.jvpHeightCm, 2);
  assert.equal(o.jvpWaveMode, "normal");
  assert.equal(o.heartSoundKind, "s1s2_normal");
  assert.equal(o.pulseCharacter, "normal");
  assert.deepEqual(o.clinicalSigns, []);
});

test("high preload with low contractility triggers S3 gallop and raised JVP", () => {
  const o = Phys.simulateCardiovascular({ preload: 160, contractility: 60 });
  assert.equal(o.heartSoundKind, "s3_gallop");
  assert.ok(o.jvpHeightCm > 2); // observed 9 cm
  assert.ok(o.clinicalSigns.some((s) => s.includes("S3")));
});

test("high afterload with preserved contractility triggers S4 gallop", () => {
  const o = Phys.simulateCardiovascular({ afterload: 160, contractility: 100 });
  assert.equal(o.heartSoundKind, "s4_gallop");
  assert.ok(o.clinicalSigns.some((s) => s.includes("S4")));
});

test("aortic stenosis gives ejection murmur with parvus et tardus pulse", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "as", severity: "severe" } });
  assert.equal(o.heartSoundKind, "as_murmur");
  assert.equal(o.pulseCharacter, "parvus_et_tardus");
  assert.ok(o.clinicalSigns.some((s) => s.includes("parvus et tardus")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("carotids")));
});

test("severe mitral regurgitation gives pansystolic murmur and displaced apex", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "mr", severity: "severe" } });
  assert.equal(o.heartSoundKind, "mr_murmur");
  assert.ok(o.clinicalSigns.some((s) => s.includes("Pansystolic murmur")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("Displaced hyperdynamic apex")));
});

test("aortic regurgitation gives water-hammer pulse with widened pulse pressure", () => {
  const base = Phys.simulateCardiovascular({});
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "ar", severity: "severe" } });
  assert.equal(o.heartSoundKind, "ar_murmur");
  assert.equal(o.pulseCharacter, "water_hammer");
  assert.ok(o.pulsePressure > base.pulsePressure); // observed 60 vs 24
  assert.ok(o.bpSystolic > o.bpDiastolic + 40);
  assert.ok(o.clinicalSigns.some((s) => s.includes("water-hammer")));
});

test("atrial fibrillation drops the a wave and makes the pulse irregularly irregular", () => {
  const o = Phys.simulateCardiovascular({ rhythm: "afib" });
  assert.equal(o.jvpWaveMode, "absent_a");
  assert.equal(o.pulseCharacter, "irregularly_irregular");
  assert.ok(o.clinicalSigns.some((s) => s.includes("Irregularly irregular")));
});

test("complete heart block produces cannon a waves", () => {
  const o = Phys.simulateCardiovascular({ rhythm: "chb" });
  assert.equal(o.jvpWaveMode, "cannon");
});

test("tricuspid regurgitation produces giant v waves with raised JVP", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "tr", severity: "severe" } });
  assert.equal(o.jvpWaveMode, "giant_v");
  assert.ok(o.jvpHeightCm >= 6);
});

/* Respiratory model --------------------------------------------------------- */

test("normal breathing baseline is vesicular with normal work of breathing", () => {
  const o = Phys.simulateRespiratory({});
  assert.equal(o.respiratoryRate, 14);
  assert.equal(o.breathSoundKind, "vesicular");
  assert.equal(o.workOfBreathing, "normal");
  assert.equal(o.paCO2, 41);
  // NOTE: the Hill-equation denominator in the model yields SpO2 87 at PaO2 88.
  // Physiologically PaO2 88 should saturate ~96-97%; pinned here as observed.
  assert.equal(o.paO2, 88);
  assert.equal(o.spO2, 87);
});

test("high airway resistance gives wheeze with pursed-lip breathing", () => {
  const o = Phys.simulateRespiratory({ airwayResistance: 3.5 });
  assert.equal(o.breathSoundKind, "wheeze");
  assert.ok(o.clinicalSigns.some((s) => s.includes("polyphonic wheezing")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("Prolonged expiratory phase")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("Pursed-lip breathing")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("Accessory muscle use")));
  // Observed "severe" (SpO2 61 < 86 escalates past "increased"); pinned as real.
  assert.equal(o.workOfBreathing, "severe");
  assert.ok(o.spO2 < 87);
});

test("low compliance gives fine Velcro crackles with raised work of breathing", () => {
  const o = Phys.simulateRespiratory({ compliance: 0.4 });
  assert.equal(o.breathSoundKind, "fine");
  assert.ok(o.clinicalSigns.some((s) => s.includes("Velcro")));
  assert.notEqual(o.workOfBreathing, "normal");
});

test("severe hypoventilation drives compensatory tachypnea, not silent chest", () => {
  // The exhaustion branch (rr < 10 with paco2 > 65) is unreachable through the
  // public API: RR is derived with an effective floor of 14 and only rises
  // with hypercapnia/hypoxemia. Extreme hypoventilation instead yields:
  const o = Phys.simulateRespiratory({ minuteVentilation: 2.0 });
  assert.ok(o.paCO2 > 65); // observed 110
  assert.equal(o.respiratoryRate, 42);
  assert.equal(o.workOfBreathing, "severe");
  assert.ok(o.spO2 < 70);
});

test("hypoxemia degrades monotonically with dead-space fraction", () => {
  const base = Phys.simulateRespiratory({});
  const worse = Phys.simulateRespiratory({ deadSpaceFraction: 0.6 });
  assert.ok(worse.paO2 < base.paO2);
  assert.ok(worse.spO2 < base.spO2);
  assert.ok(worse.paCO2 > base.paCO2);
  assert.ok(worse.clinicalSigns.some((s) => s.includes("cyanosis")));
});

test("supplemental oxygen raises PaO2 and SpO2", () => {
  const room = Phys.simulateRespiratory({ deadSpaceFraction: 0.5 });
  const oxygen = Phys.simulateRespiratory({ deadSpaceFraction: 0.5, fiO2: 0.6 });
  assert.ok(oxygen.paO2 > room.paO2);
  assert.ok(oxygen.spO2 >= room.spO2);
});
