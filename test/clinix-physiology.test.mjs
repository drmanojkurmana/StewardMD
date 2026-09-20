/* test/clinix-physiology.test.mjs - the sandbox has to be right, not merely self-consistent.
 *
 * Owner report, 2026-09-19: "physiology sandbox doesnt work its 1/10". The previous version of this
 * file PINNED the broken numbers as "observed": the default sliders returned a blood pressure of
 * 70/46 with a cardiac output of 3.0, and the Hill denominator was 26.6 * 1000 instead of 26.6^2.7,
 * so a PaO2 of 88 read as an SpO2 of 87. A student cannot learn physiology from a model that calls a
 * healthy adult shocked, so these tests now assert the TEXTBOOK values and would fail the old model.
 *
 * node --test test/clinix-physiology.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Phys from "../clinix-physiology.js";

const near = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} is not within ${tol} of ${b}`);

/* ── the reference patient ───────────────────────────────────────────────────────────────────── */

test("a student who touches nothing sees a healthy adult", () => {
  const o = Phys.simulateCardiovascular({});
  assert.equal(o.bpSystolic, 120);
  assert.equal(o.bpDiastolic, 80);
  assert.equal(o.meanArterialPressure, 93);
  assert.equal(o.strokeVolume, 70);
  assert.equal(o.cardiacOutput, 5.0);
  assert.equal(o.edv, 120);
  assert.equal(o.esv, 50);
  assert.equal(o.ejectionFraction, 58);
  assert.equal(o.jvpHeightCm, 3);
  assert.equal(o.heartSoundKind, "s1s2_normal");
  assert.equal(o.pulseCharacter, "normal");
  assert.equal(o.stateLabel, "Normal haemodynamics");
  assert.equal(o.stateTone, "ok");
});

test("the same is true of the respiratory tab", () => {
  const o = Phys.simulateRespiratory({});
  near(o.paCO2, 40, 2, "PaCO2");
  near(o.paO2, 95, 6, "PaO2");
  assert.ok(o.spO2 >= 96 && o.spO2 <= 98, "room-air SpO2 is 97%, not 87%: " + o.spO2);
  near(o.pH, 7.40, 0.03, "pH");
  near(o.hco3, 24, 1.5, "HCO3");
  assert.ok(o.aaGradient <= 12, "normal A-a gradient, got " + o.aaGradient);
  assert.ok(o.respiratoryRate >= 10 && o.respiratoryRate <= 16, "RR " + o.respiratoryRate);
  assert.ok(o.tidalVolume >= 400 && o.tidalVolume <= 620, "VT " + o.tidalVolume);
  assert.equal(o.workOfBreathing, "normal");
  assert.equal(o.failureType, "none");
  assert.equal(o.spirometry.pattern, "normal");
});

test("the oxyhaemoglobin curve is the real one", () => {
  near(Phys.satFromPo2(26.6) * 100, 50, 0.5, "P50");
  near(Phys.satFromPo2(60) * 100, 90, 2, "the 60/90 point");
  near(Phys.satFromPo2(40) * 100, 75, 3, "mixed venous");
  near(Phys.po2FromSat(0.5), 26.6, 0.5, "inverse at P50");
});

/* ── ventricular-arterial coupling ───────────────────────────────────────────────────────────── */

test("afterload cuts stroke volume while it raises mean pressure", () => {
  const base = Phys.simulateCardiovascular({});
  const up = Phys.simulateCardiovascular({ afterload: 170 });
  assert.ok(up.strokeVolume < base.strokeVolume, "SV falls");
  assert.ok(up.meanArterialPressure > base.meanArterialPressure, "MAP still rises");
  assert.ok(up.esv > base.esv, "the ventricle empties less completely");
});

test("contractility moves ejection fraction, preload moves end-diastolic volume", () => {
  const weak = Phys.simulateCardiovascular({ contractility: 40 });
  const strong = Phys.simulateCardiovascular({ contractility: 160 });
  assert.ok(weak.ejectionFraction < 40 && strong.ejectionFraction > 65, "EF tracks inotropy");
  assert.ok(weak.esv > strong.esv);
  const dry = Phys.simulateCardiovascular({ preload: 50 });
  const wet = Phys.simulateCardiovascular({ preload: 180 });
  assert.ok(dry.edv < 80 && wet.edv > 150, "EDV tracks filling");
  assert.ok(dry.strokeVolume < wet.strokeVolume);
});

test("filling saturates: doubling preload does not double end-diastolic volume", () => {
  const a = Phys.simulateCardiovascular({ preload: 100 });
  const b = Phys.simulateCardiovascular({ preload: 200 });
  assert.ok(b.edv > a.edv, "it still rises");
  assert.ok(b.edv < a.edv * 2, "but the ventricle has a ceiling: " + b.edv);
});

test("tachycardia steals diastolic filling time", () => {
  const rest = Phys.simulateCardiovascular({ heartRate: 72 });
  const fast = Phys.simulateCardiovascular({ heartRate: 170 });
  assert.ok(fast.edv < rest.edv, "less time to fill");
  assert.ok(fast.strokeVolume < rest.strokeVolume);
});

test("the JVP separates cardiogenic from hypovolaemic shock", () => {
  const cardio = Phys.simulateCardiovascular({ preload: 180, afterload: 170, contractility: 20, heartRate: 118 });
  const hypo = Phys.simulateCardiovascular({ preload: 40, afterload: 170, contractility: 110, heartRate: 130 });
  assert.equal(cardio.stateLabel, "Cardiogenic shock");
  assert.equal(hypo.stateLabel, "Hypovolaemic shock");
  assert.ok(cardio.jvpHeightCm >= 8, "full tank");
  assert.equal(hypo.jvpHeightCm, 0, "empty tank");
  assert.ok(cardio.cardiacOutput < 3.5 && hypo.cardiacOutput < 3.5, "both are low output");
});

test("vasodilatory shock is hypotensive with a HIGH cardiac output", () => {
  const o = Phys.simulateCardiovascular({ preload: 80, afterload: 40, contractility: 110, heartRate: 120 });
  assert.ok(o.cardiacOutput > 6.5, "output is high: " + o.cardiacOutput);
  assert.ok(o.meanArterialPressure < 65, "and the patient is still shocked");
  assert.equal(o.stateLabel, "Distributive (vasodilatory) shock");
});

/* ── valve lesions ───────────────────────────────────────────────────────────────────────────── */

test("aortic stenosis: a gradient the cuff never shows", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "as", severity: "severe" } });
  assert.equal(o.heartSoundKind, "as_murmur");
  assert.equal(o.pulseCharacter, "parvus_et_tardus");
  assert.ok(o.valveGradient > 40, "severe gradient: " + o.valveGradient);
  assert.ok(o.clinicalSigns.some((s) => s.includes("parvus et tardus")));
  assert.ok(o.clinicalSigns.some((s) => s.includes("carotids")));
  const mild = Phys.simulateCardiovascular({ valveLesion: { type: "as", severity: "mild" } });
  assert.ok(mild.valveGradient < o.valveGradient, "severity is graded, not a switch");
});

test("aortic regurgitation: total stroke volume large, forward stroke volume not", () => {
  const base = Phys.simulateCardiovascular({});
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "ar", severity: "severe" } });
  assert.equal(o.heartSoundKind, "ar_murmur");
  assert.equal(o.pulseCharacter, "water_hammer");
  assert.ok(o.totalStrokeVolume > o.strokeVolume * 1.4, "most of the difference goes backwards");
  assert.ok(o.pulsePressure > base.pulsePressure + 25, "wide pulse pressure: " + o.pulsePressure);
  assert.ok(o.bpDiastolic < base.bpDiastolic, "diastolic run-off");
  assert.ok(o.edv > base.edv, "volume overload");
});

test("mitral regurgitation: forward output falls while the ventricle looks hyperdynamic", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "mr", severity: "severe" } });
  assert.equal(o.heartSoundKind, "mr_murmur");
  assert.ok(o.regurgitantFraction >= 40);
  assert.ok(o.totalStrokeVolume > o.strokeVolume);
  assert.ok(o.clinicalSigns.some((s) => s.includes("axilla")));
});

test("mitral stenosis is rate dependent, which is the whole management point", () => {
  const slow = Phys.simulateCardiovascular({ heartRate: 70, valveLesion: { type: "ms", severity: "severe" } });
  const fast = Phys.simulateCardiovascular({ heartRate: 150, valveLesion: { type: "ms", severity: "severe" } });
  assert.equal(slow.heartSoundKind, "ms_murmur");
  assert.ok(fast.edv < slow.edv, "less diastolic filling time");
  assert.ok(fast.cardiacOutput < slow.cardiacOutput, "slowing the heart RAISES output here");
});

test("tricuspid regurgitation gives giant v waves and a raised venous pressure", () => {
  const o = Phys.simulateCardiovascular({ valveLesion: { type: "tr", severity: "severe" } });
  assert.equal(o.jvpWaveMode, "giant_v");
  assert.ok(o.jvpHeightCm >= 8);
  assert.equal(o.audioKind, "mr_murmur", "no separate TR sample exists, so it maps to a playable one");
});

test("rhythm changes the venous waveform and the pulse", () => {
  const af = Phys.simulateCardiovascular({ rhythm: "afib" });
  assert.equal(af.jvpWaveMode, "absent_a");
  assert.equal(af.pulseCharacter, "irregularly_irregular");
  assert.ok(af.clinicalSigns.some((s) => s.includes("pulse deficit")));
  assert.ok(af.edv < Phys.simulateCardiovascular({}).edv, "no atrial kick");
  assert.equal(Phys.simulateCardiovascular({ rhythm: "chb", heartRate: 38 }).jvpWaveMode, "cannon");
});

test("gallops appear only in the states that produce them", () => {
  assert.equal(Phys.simulateCardiovascular({ preload: 170, contractility: 45 }).heartSoundKind, "s3_gallop");
  assert.equal(Phys.simulateCardiovascular({ afterload: 170, contractility: 105 }).heartSoundKind, "s4_gallop");
  assert.equal(Phys.simulateCardiovascular({}).heartSoundKind, "s1s2_normal");
});

/* ── gas exchange ────────────────────────────────────────────────────────────────────────────── */

test("shunt is refractory to oxygen and V/Q mismatch is not: the teaching point of the tab", () => {
  const small = { shuntFraction: 0.02 }, big = { shuntFraction: 0.45 };
  const smallRoom = Phys.simulateRespiratory({ ...small, fiO2: 0.21 });
  const smallO2 = Phys.simulateRespiratory({ ...small, fiO2: 1.0 });
  const bigRoom = Phys.simulateRespiratory({ ...big, fiO2: 0.21 });
  const bigO2 = Phys.simulateRespiratory({ ...big, fiO2: 1.0 });
  assert.ok(smallO2.paO2 > 500, "a normal lung on 100% oxygen: " + smallO2.paO2);
  assert.ok(smallO2.paO2 - smallRoom.paO2 > 400, "oxygen works when there is no shunt");
  assert.ok(bigO2.spO2 - bigRoom.spO2 < 15, "a large shunt barely responds: " + bigRoom.spO2 + " to " + bigO2.spO2);
  assert.ok(bigO2.paO2 < 120, "PaO2 stays low on 100% oxygen: " + bigO2.paO2);
});

test("PaO2 rises monotonically with FiO2 at every shunt fraction", () => {
  for (const shuntFraction of [0.02, 0.1, 0.25, 0.4, 0.55]) {
    let last = -1;
    for (const fiO2 of [0.21, 0.3, 0.4, 0.6, 0.8, 1.0]) {
      const o = Phys.simulateRespiratory({ shuntFraction, fiO2 });
      assert.ok(o.paO2 > last, `shunt ${shuntFraction} at FiO2 ${fiO2}: ${o.paO2} did not exceed ${last}`);
      last = o.paO2;
    }
  }
});

test("hypoventilation raises CO2 with a NORMAL A-a gradient, which is how it is recognised", () => {
  const o = Phys.simulateRespiratory({ respiratoryDrive: 10 });
  assert.ok(o.paCO2 > 65, "PaCO2 " + o.paCO2);
  assert.ok(o.paO2 < 70, "and the oxygen falls with it");
  assert.ok(o.aaGradient <= 12, "but the lung itself is normal: A-a " + o.aaGradient);
  assert.ok(o.pH < 7.30, "acute respiratory acidosis");
  assert.equal(o.acidBase, "respiratory acidosis");
  assert.equal(o.workOfBreathing, "suppressed");
});

test("oxygen alone does not fix hypoventilation", () => {
  const room = Phys.simulateRespiratory({ respiratoryDrive: 10, fiO2: 0.21 });
  const onO2 = Phys.simulateRespiratory({ respiratoryDrive: 10, fiO2: 0.5 });
  assert.ok(onO2.spO2 > room.spO2, "the saturation looks better");
  assert.ok(onO2.paCO2 >= room.paCO2 - 1, "while the CO2 does not improve at all");
  assert.ok(onO2.pH <= room.pH + 0.02, "nor does the pH");
});

test("dead space raises CO2 even when the minute volume looks fine", () => {
  const base = Phys.simulateRespiratory({});
  const pe = Phys.simulateRespiratory({ deadSpaceFraction: 0.7 });
  assert.ok(pe.paCO2 > base.paCO2, "PaCO2 " + base.paCO2 + " to " + pe.paCO2);
  assert.ok(pe.minuteVentilation > base.minuteVentilation, "they compensate by breathing more");
  assert.ok(base.paCO2 - base.etCO2 < pe.paCO2 - pe.etCO2, "and the end-tidal gap widens");
});

test("a chest can only breathe so hard, and that ceiling is where asthma kills", () => {
  const tiring = Phys.simulateRespiratory({ airwayResistance: 6.0, respiratoryDrive: 200, deadSpaceFraction: 0.45 });
  assert.equal(tiring.ventilationLimited, true);
  assert.ok(tiring.minuteVentilation <= tiring.minuteVentilationMax + 0.1);
  assert.ok(tiring.clinicalSigns.some((s) => s.includes("mechanical ceiling")));
  const easy = Phys.simulateRespiratory({ airwayResistance: 1.0, respiratoryDrive: 200 });
  assert.equal(easy.ventilationLimited, false);
  assert.ok(easy.paCO2 < tiring.paCO2, "an unobstructed chest can blow the CO2 off");
});

test("oxygen given to an obstructed chest widens dead space and retains CO2", () => {
  const low = Phys.simulateRespiratory({ airwayResistance: 4.2, deadSpaceFraction: 0.58, respiratoryDrive: 45, fiO2: 0.24, shuntFraction: 0.16 });
  const high = Phys.simulateRespiratory({ airwayResistance: 4.2, deadSpaceFraction: 0.58, respiratoryDrive: 45, fiO2: 1.0, shuntFraction: 0.16 });
  assert.ok(high.spO2 > low.spO2, "the saturation improves");
  assert.ok(high.paCO2 > low.paCO2, "and the CO2 climbs: " + low.paCO2 + " to " + high.paCO2);
  assert.ok(high.deadSpaceUsed > low.deadSpaceUsed);
});

test("a metabolic acidosis is compensated towards Winter's formula", () => {
  const o = Phys.simulateRespiratory({ baseExcess: -19 });
  assert.ok(o.hco3 < 8, "HCO3 " + o.hco3);
  const winter = 1.5 * o.hco3 + 8;
  near(o.paCO2, winter, 4, "compensation against Winter's prediction");
  assert.ok(o.minuteVentilation > 12, "Kussmaul breathing: " + o.minuteVentilation + " L/min");
  assert.equal(o.acidBase, "metabolic acidosis");
  assert.ok(o.clinicalSigns.some((s) => s.includes("Kussmaul")));
});

test("type 1 and type 2 respiratory failure are told apart", () => {
  const t1 = Phys.simulateRespiratory({ shuntFraction: 0.3, respiratoryDrive: 150 });
  assert.equal(t1.failureType, "type1");
  assert.ok(t1.paCO2 < 50);
  const t2 = Phys.simulateRespiratory({ respiratoryDrive: 10 });
  assert.equal(t2.failureType, "type2");
});

test("spirometry follows the mechanics the sliders set", () => {
  assert.equal(Phys.simulateRespiratory({ airwayResistance: 4.0 }).spirometry.pattern, "obstructive");
  assert.equal(Phys.simulateRespiratory({ compliance: 0.35 }).spirometry.pattern, "restrictive");
  assert.equal(Phys.simulateRespiratory({ airwayResistance: 4.0, compliance: 0.35 }).spirometry.pattern, "mixed");
  assert.equal(Phys.simulateRespiratory({}).spirometry.pattern, "normal");
  assert.ok(Phys.simulateRespiratory({ airwayResistance: 4.0 }).spirometry.ratio < 0.7);
});

test("stiff lungs breathe rapid and shallow, obstructed lungs slow and deep", () => {
  const stiff = Phys.simulateRespiratory({ compliance: 0.3 });
  const obstructed = Phys.simulateRespiratory({ airwayResistance: 4.0 });
  assert.ok(stiff.tidalVolume < 380, "VT " + stiff.tidalVolume);
  assert.ok(stiff.respiratoryRate > obstructed.respiratoryRate);
  assert.ok(obstructed.tidalVolume > stiff.tidalVolume);
});

test("a low cardiac output deepens hypoxaemia through a lower mixed venous saturation", () => {
  const normal = Phys.simulateRespiratory({ shuntFraction: 0.3, cardiacOutput: 5.0 });
  const low = Phys.simulateRespiratory({ shuntFraction: 0.3, cardiacOutput: 2.2 });
  assert.ok(low.svO2 < normal.svO2, "SvO2 " + normal.svO2 + " to " + low.svO2);
  assert.ok(low.paO2 < normal.paO2, "and the arterial oxygen follows it down");
});

test("breath sounds match the mechanics, including the silent chest", () => {
  assert.equal(Phys.simulateRespiratory({}).breathSoundKind, "vesicular");
  assert.equal(Phys.simulateRespiratory({ airwayResistance: 3.5 }).breathSoundKind, "wheeze");
  assert.equal(Phys.simulateRespiratory({ compliance: 0.4 }).breathSoundKind, "fine");
  const silent = Phys.simulateRespiratory({ airwayResistance: 7.5, respiratoryDrive: 220, deadSpaceFraction: 0.6 });
  assert.equal(silent.breathSoundKind, "reduced");
  assert.ok(silent.clinicalSigns.some((s) => s.includes("Silent chest")));
});

/* ── presets and waveforms ───────────────────────────────────────────────────────────────────── */

test("every preset lands on the state it claims to teach", () => {
  const expect = {
    "cv-normal": (o) => o.stateLabel === "Normal haemodynamics",
    "cv-hypovol": (o) => o.stateLabel === "Hypovolaemic shock" && o.jvpHeightCm === 0,
    "cv-cardiogenic": (o) => o.stateLabel === "Cardiogenic shock" && o.jvpHeightCm >= 8,
    "cv-septic": (o) => o.stateLabel.includes("Distributive") && o.cardiacOutput > 6.5,
    "cv-ccf": (o) => o.stateLabel === "Congestive cardiac failure",
    "cv-htn": (o) => o.bpSystolic >= 140,
    "cv-af": (o) => o.pulseCharacter === "irregularly_irregular",
    "cv-as": (o) => o.valveGradient > 40,
    "cv-ar": (o) => o.pulsePressure > 65,
    "cv-ms": (o) => o.cardiacOutput < 3.5,
    "cv-chb": (o) => o.jvpWaveMode === "cannon"
  };
  for (const p of Phys.presetsFor("cvs")) {
    const o = Phys.simulateCardiovascular({
      preload: p.params.preload, afterload: p.params.afterload, contractility: p.params.contractility,
      heartRate: p.params.heartRate, rhythm: p.params.rhythm,
      valveLesion: { type: p.params.valve, severity: p.params.severity || "moderate" }
    });
    assert.ok(expect[p.id], "no expectation written for preset " + p.id);
    assert.ok(expect[p.id](o), `${p.id} (${p.label}) did not teach what it claims: ${o.stateLabel}, ` +
      `${o.bpSystolic}/${o.bpDiastolic}, CO ${o.cardiacOutput}, JVP ${o.jvpHeightCm}`);
  }
});

test("respiratory presets produce blood gases a clinician would recognise", () => {
  const expect = {
    "rs-normal": (o) => o.spO2 >= 96 && o.failureType === "none",
    "rs-copd": (o) => o.paCO2 > 50 && o.hco3 > 28 && o.spirometry.pattern === "obstructive",
    "rs-asthma": (o) => o.paCO2 < 40 && o.spirometry.pattern === "obstructive",
    "rs-ards": (o) => o.pfRatio < 150 && o.failureType === "type1",
    "rs-fibrosis": (o) => o.spirometry.pattern === "restrictive" && o.respiratoryRate > 20,
    "rs-pe": (o) => o.paCO2 < 38 && o.paCO2 - o.etCO2 > 8,
    "rs-opioid": (o) => o.paCO2 > 65 && o.aaGradient <= 12,
    "rs-dka": (o) => o.hco3 < 8 && o.paCO2 < 22,
    "rs-pneumonia": (o) => o.failureType === "type1" && o.paCO2 < 40
  };
  for (const p of Phys.presetsFor("resp")) {
    const o = Phys.simulateRespiratory(p.params);
    assert.ok(expect[p.id], "no expectation written for preset " + p.id);
    assert.ok(expect[p.id](o), `${p.id} (${p.label}): pH ${o.pH}, PaCO2 ${o.paCO2}, PaO2 ${o.paO2}, ` +
      `HCO3 ${o.hco3}, P/F ${o.pfRatio}, ${o.spirometry.pattern}/${o.failureType}`);
  }
});

test("every preset carries a teaching note and a mode", () => {
  for (const p of Phys.PRESETS) {
    assert.ok(p.id && p.label && p.note, "incomplete preset " + p.id);
    assert.ok(p.mode === "cvs" || p.mode === "resp", p.id);
    assert.ok(p.note.length > 40, "the note has to teach something: " + p.id);
    assert.equal(p.note.indexOf("—"), -1, "no em-dash in app-facing text: " + p.id);
    assert.equal(Phys.preset(p.id), p);
  }
  assert.equal(Phys.preset("no-such-preset"), null);
});

test("waveforms are finite SVG paths, whatever the sliders say", () => {
  const combos = [
    { hr: 72, rhythm: "sinus" }, { hr: 160, rhythm: "afib" }, { hr: 30, rhythm: "chb" },
    { hr: 200, rhythm: "sinus" }, { hr: 20, rhythm: "afib" }
  ];
  for (const c of combos) {
    for (const w of [Phys.ecgPath(c.hr, c.rhythm), Phys.arterialPath(c.hr, "water_hammer", c.rhythm),
                     Phys.arterialPath(c.hr, "parvus_et_tardus", c.rhythm), Phys.jvpPath(c.hr, "giant_v"),
                     Phys.capnoPath(c.hr, 38, 4.0), Phys.flowVolumePath(0.4, 60)]) {
      assert.ok(w.d.length > 50, "empty path");
      assert.equal(/NaN|Infinity|undefined/.test(w.d), false, "non-finite path: " + w.d.slice(0, 80));
      assert.ok(w.w > 0 && w.h > 0 && typeof w.label === "string" && w.label.length);
    }
  }
});

test("waveforms are deterministic, so a repaint never reshuffles the trace", () => {
  assert.equal(Phys.ecgPath(140, "afib").d, Phys.ecgPath(140, "afib").d);
  assert.equal(Phys.arterialPath(140, "normal", "afib").d, Phys.arterialPath(140, "normal", "afib").d);
  assert.notEqual(Phys.ecgPath(140, "afib").d, Phys.ecgPath(140, "sinus").d, "but rhythm does change it");
});

test("the waveform bundles match the result they are drawn from", () => {
  const cvs = Phys.simulateCardiovascular({ rhythm: "afib", heartRate: 150 });
  const w = Phys.cardiovascularWaves({ rhythm: "afib" }, cvs);
  assert.equal(w.length, 3);
  assert.ok(w[0].label.includes("150"));
  assert.ok(w[2].label.includes("absent a"));
  const resp = Phys.simulateRespiratory({ airwayResistance: 4.0 });
  const rw = Phys.respiratoryWaves({ airwayResistance: 4.0 }, resp);
  assert.equal(rw.length, 2);
  assert.ok(rw[0].label.includes("shark fin"), rw[0].label);
  assert.ok(rw[1].label.includes("scooped"), rw[1].label);
});

/* ── contract ────────────────────────────────────────────────────────────────────────────────── */

test("every slider position returns finite, in-range numbers", () => {
  for (const preload of [10, 100, 250]) {
    for (const afterload of [20, 100, 250]) {
      for (const contractility of [10, 100, 220]) {
        for (const heartRate of [20, 72, 220]) {
          const o = Phys.simulateCardiovascular({ preload, afterload, contractility, heartRate });
          for (const k of ["cardiacOutput", "strokeVolume", "bpSystolic", "bpDiastolic",
                           "meanArterialPressure", "ejectionFraction", "edv", "esv", "jvpHeightCm"]) {
            assert.ok(Number.isFinite(o[k]), `${k} not finite at ${preload}/${afterload}/${contractility}/${heartRate}`);
          }
          assert.ok(o.bpSystolic > o.bpDiastolic, "systolic must exceed diastolic");
          assert.ok(o.esv >= 0 && o.esv <= o.edv + 1, "ESV cannot exceed EDV");
          assert.ok(o.explain.length > 0, "there is always something to explain");
        }
      }
    }
  }
});

test("the respiratory model is finite across its whole slider space", () => {
  for (const airwayResistance of [0.3, 1, 8]) {
    for (const compliance of [0.1, 1, 3]) {
      for (const deadSpaceFraction of [0.05, 0.3, 0.85]) {
        for (const respiratoryDrive of [0, 100, 260]) {
          for (const fiO2 of [0.21, 1.0]) {
            for (const shuntFraction of [0, 0.6]) {
              const o = Phys.simulateRespiratory({ airwayResistance, compliance, deadSpaceFraction, respiratoryDrive, fiO2, shuntFraction });
              for (const k of ["respiratoryRate", "spO2", "paO2", "paCO2", "pH", "hco3", "tidalVolume", "pfRatio"]) {
                assert.ok(Number.isFinite(o[k]), k + " not finite");
              }
              assert.ok(o.spO2 >= 0 && o.spO2 <= 100, "SpO2 " + o.spO2);
              assert.ok(o.pH > 6.4 && o.pH < 7.9, "pH " + o.pH);
              assert.ok(o.explain.length > 0);
            }
          }
        }
      }
    }
  }
});

test("a fixed minute ventilation is still honoured, for a ventilated patient", () => {
  const o = Phys.simulateRespiratory({ minuteVentilation: 12, deadSpaceFraction: 0.3 });
  near(o.minuteVentilation, 12, 0.2, "the set volume is delivered");
  assert.ok(o.paCO2 < 30, "and it blows the CO2 off: " + o.paCO2);
  const capped = Phys.simulateRespiratory({ minuteVentilation: 25, airwayResistance: 6 });
  assert.equal(capped.ventilationLimited, true, "but not past what the chest can move");
});

test("no app-facing string carries an em-dash", () => {
  const out = [Phys.simulateCardiovascular({ preload: 170, contractility: 40, valveLesion: { type: "ar", severity: "severe" } }),
               Phys.simulateRespiratory({ airwayResistance: 5, respiratoryDrive: 30, baseExcess: -12, shuntFraction: 0.3 })];
  for (const o of out) {
    for (const s of [].concat(o.clinicalSigns, o.explain, [o.stateLabel || "", o.abgInterpretation || ""])) {
      assert.equal(s.indexOf("—"), -1, "em-dash in: " + s);
    }
  }
});
