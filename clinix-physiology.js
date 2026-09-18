/* clinix-physiology.js — CliniX · Physiology Simulator Sandbox
 *
 * Real-time mathematical simulation linking physiological variables
 * to bedside clinical findings, waveforms, and auscultatory models.
 *
 * Fully deterministic, offline, zero-dependency.
 */
(function () {
  "use strict";

  /* ── 1. Cardiovascular Physiology Model ─────────────────────────────────── */

  function simulateCardiovascular(params) {
    params = params || {};
    var preload = params.preload != null ? params.preload : 100; // % of normal (70-120 mmHg EDP)
    var afterload = params.afterload != null ? params.afterload : 100; // % of normal SVR
    var contractility = params.contractility != null ? params.contractility : 100; // % of normal inotropy
    var hr = params.heartRate != null ? params.heartRate : 72; // bpm
    var rhythm = params.rhythm || "sinus"; // sinus | afib | chb | vt
    var valve = params.valveLesion || { type: "none", severity: "mild" };

    // Stroke Volume calculation: Frank-Starling mechanism + inotropy - afterload
    var edv = 70 * (preload / 100);
    var esv = (edv * 0.4) * (afterload / 100) / (contractility / 100);
    var sv = Math.max(15, Math.min(130, edv - esv));
    var co = (sv * hr) / 1000; // L/min

    // Blood Pressure calculations
    // MAP = CO * SVR; Pulse Pressure proportional to SV and arterial stiffness
    var svrFactor = afterload / 100;
    var map = Math.round(93 * (co / 5.0) * svrFactor);
    var pp = Math.round(40 * (sv / 70) * (svrFactor > 1.2 ? 1.2 : 1.0));

    var sbp = Math.max(60, Math.min(240, Math.round(map + (pp * 0.6))));
    var dbp = Math.max(40, Math.min(140, Math.round(map - (pp * 0.4))));

    // JVP calculations
    // Normal JVP = 2 cm above sternal angle. Rises with high preload, low contractility, or TR
    var jvpHeight = Math.max(0, Math.min(16, Math.round(2 + ((preload - 100) * 0.08) + ((100 - contractility) * 0.06))));
    var jvpWaveMode = "normal";

    if (rhythm === "afib") {
      jvpWaveMode = "absent_a";
    } else if (rhythm === "chb") {
      jvpWaveMode = "cannon";
    } else if (valve.type === "tr") {
      jvpWaveMode = "giant_v";
      jvpHeight = Math.max(6, jvpHeight + 4);
    }

    // Heart sounds & murmurs
    var soundKind = "s1s2_normal";
    var pulseCharacter = "normal";
    var signs = [];

    if (rhythm === "afib") {
      pulseCharacter = "irregularly_irregular";
      signs.push("Irregularly irregular pulse with variable volume");
    } else if (hr > 100) {
      pulseCharacter = "tachycardia";
      signs.push("Sinus tachycardia");
    } else if (hr < 55) {
      pulseCharacter = "bradycardia";
      signs.push("Bradycardia");
    }

    if (valve.type === "as") {
      soundKind = "as_murmur";
      pulseCharacter = "parvus_et_tardus";
      sbp = Math.max(70, sbp - 20); // narrowed pulse pressure
      signs.push("Slow-rising, plateau pulse (pulsus parvus et tardus)");
      signs.push("Ejection systolic murmur radiating to carotids");
    } else if (valve.type === "mr") {
      soundKind = "mr_murmur";
      signs.push("Pansystolic murmur radiating to axilla");
      if (valve.severity === "severe") signs.push("Displaced hyperdynamic apex beat");
    } else if (valve.type === "ms") {
      soundKind = "ms_murmur";
      signs.push("Tapping apex beat; mid-diastolic rumbling murmur with opening snap");
    } else if (valve.type === "ar") {
      soundKind = "ar_murmur";
      pulseCharacter = "water_hammer";
      sbp += 25; // wide pulse pressure
      dbp = Math.max(35, dbp - 20);
      signs.push("Collapsing / water-hammer pulse (Corrigan's pulse)");
      signs.push("Early diastolic decrescendo murmur best at Erb's point");
    }

    // S3 / S4 gallops based on filling pressures
    if (soundKind === "s1s2_normal") {
      if (preload > 140 && contractility < 80) {
        soundKind = "s3_gallop";
        signs.push("S3 ventricular gallop (ventricular volume overload / heart failure)");
      } else if (afterload > 140 && contractility >= 90) {
        soundKind = "s4_gallop";
        signs.push("S4 atrial gallop (left ventricular hypertrophy / stiff ventricle)");
      }
    }

    return {
      cardiacOutput: Math.round(co * 10) / 10,
      strokeVolume: Math.round(sv),
      bpSystolic: sbp,
      bpDiastolic: dbp,
      pulsePressure: sbp - dbp,
      meanArterialPressure: map,
      jvpHeightCm: jvpHeight,
      jvpWaveMode: jvpWaveMode,
      heartSoundKind: soundKind,
      pulseCharacter: pulseCharacter,
      clinicalSigns: signs
    };
  }

  /* ── 2. Respiratory Physiology Model ────────────────────────────────────── */

  function simulateRespiratory(params) {
    params = params || {};
    var raw = params.airwayResistance != null ? params.airwayResistance : 1.0; // cmH2O/L/s (norm 1.0, COPD 3-5)
    var comp = params.compliance != null ? params.compliance : 1.0; // L/cmH2O (norm 1.0, fibrosis 0.3, emphysema 2.0)
    var vdFraction = params.deadSpaceFraction != null ? params.deadSpaceFraction : 0.3; // norm 0.3
    var mv = params.minuteVentilation != null ? params.minuteVentilation : 6.0; // L/min (norm 6-8)
    var fio2 = params.fiO2 != null ? params.fiO2 : 0.21; // room air 0.21

    // Alveolar Ventilation: VA = MV * (1 - VD/VT)
    var va = Math.max(1.0, mv * (1 - vdFraction));

    // PaCO2 inversely proportional to Alveolar Ventilation (PaCO2 = VCO2 / VA * 0.863)
    var paco2 = Math.round(Math.max(18, Math.min(110, (200 / va) * 0.863)));

    // Arterial pH from Henderson-Hasselbalch (assuming acute PaCO2 change, HCO3 ~ 24)
    var hco3 = 24 + ((paco2 > 40) ? (paco2 - 40) * 0.08 : (paco2 - 40) * 0.2); // acute buffer
    var ph = Math.round((6.1 + Math.log10(hco3 / (0.0307 * paco2))) * 100) / 100;

    // Alveolar Gas Equation: PAO2 = PiO2 - (PaCO2 / 0.8)
    var pio2 = (760 - 47) * fio2;
    var pao2_ideal = pio2 - (paco2 / 0.8);

    // A-a gradient increases with airway obstruction and V/Q mismatch
    var aaGrad = 10 + (raw > 1.5 ? (raw - 1.0) * 15 : 0) + (comp < 0.8 ? (1.0 - comp) * 20 : 0);
    var pao2 = Math.round(Math.max(30, Math.min(600, pao2_ideal - aaGrad)));

    // Oxyhemoglobin Dissociation Curve (Hill equation / Severinghaus approximation)
    var spo2 = Math.round(Math.max(45, Math.min(100, (100 * Math.pow(pao2, 2.7)) / (Math.pow(pao2, 2.7) + 26.6 * 1000))));

    // Respiratory Rate and Work of Breathing
    var baseRr = 14;
    if (paco2 > 45 || pao2 < 70) baseRr += Math.round((50 - Math.min(50, pao2)) * 0.3 + (paco2 - 40) * 0.4);
    var rr = Math.max(8, Math.min(42, baseRr));

    var wob = "normal";
    if (raw > 2.5 || comp < 0.5 || rr > 28) wob = "increased";
    if (raw > 3.8 || rr > 36 || spo2 < 86) wob = "severe";
    if (rr < 10 && paco2 > 65) wob = "exhaustion";

    // Breath sounds determination
    var soundKind = "vesicular";
    var signs = [];

    if (raw > 2.0) {
      soundKind = "wheeze";
      signs.push("Expiratory polyphonic wheezing throughout lung fields");
      signs.push("Prolonged expiratory phase");
    } else if (comp < 0.6) {
      soundKind = "fine";
      signs.push("Fine end-inspiratory 'Velcro' crackles at bases");
    } else if (wob === "exhaustion") {
      soundKind = "reduced";
      signs.push("Silent chest warning: critical hypoventilation");
      signs.push("Paradoxical abdominal breathing");
    }

    if (spo2 < 88) signs.push("Central cyanosis detectable in oral mucosa");
    if (wob === "increased" || wob === "severe") signs.push("Accessory muscle use (sternocleidomastoid & scalenes)");
    if (raw > 2.5) signs.push("Pursed-lip breathing on expiration");

    return {
      respiratoryRate: rr,
      breathSoundKind: soundKind,
      spO2: spo2,
      paO2: pao2,
      paCO2: paco2,
      pH: ph,
      workOfBreathing: wob,
      clinicalSigns: signs
    };
  }

  var API = {
    simulateCardiovascular: simulateCardiovascular,
    simulateRespiratory: simulateRespiratory
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_PHYSIOLOGY = API;
})();
