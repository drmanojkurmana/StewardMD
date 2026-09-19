/* clinix-physiology.js - CliniX - Physiology Simulator Sandbox
 *
 * A deterministic, offline, zero-dependency bedside physiology engine.
 *
 * The cardiovascular half is a ventricular-arterial coupling model (Sagawa): the ventricle is an
 * end-systolic elastance Ees, the circulation an effective arterial elastance Ea, and stroke volume
 * falls out of the two. That matters because it is the only way sliders stay honest against each
 * other: raising afterload lowers SV *and* raises MAP by the right amounts, instead of each being
 * fudged separately. At the nominal inputs (preload/afterload/contractility 100%, HR 72) the model
 * returns SV 70 mL, CO 5.0 L/min, 120/80, MAP 93, EF 58%, JVP +3, which is the point: a student who
 * opens the sandbox and touches nothing must see a normal person.
 *
 * The respiratory half solves gas exchange by OXYGEN CONTENT, not by a fudged A-a gradient, so a
 * shunt behaves like a shunt: at 40% shunt, winding FiO2 to 1.0 barely moves the saturation. That
 * one behaviour is the whole teaching point of the tab and cannot be faked with an additive offset.
 *
 * Waveforms are generated here too (ECG, arterial, JVP, capnograph, flow-volume loop) as plain SVG
 * path data, so the screen layer draws with no canvas, no animation loop and no timing code.
 */
(function () {
  "use strict";

  /* ── helpers ──────────────────────────────────────────────────────────────── */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function r0(v) { return Math.round(v); }
  function r1(v) { return Math.round(v * 10) / 10; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function num(v, d) { var n = Number(v); return (v === null || v === undefined || isNaN(n)) ? d : n; }

  var SEVERITY = { none: 0, mild: 1, moderate: 2, severe: 3 };
  function sevOf(s) { var k = SEVERITY[String(s || "moderate").toLowerCase()]; return k === undefined ? 2 : k; }

  /* A seeded generator, so the same slider positions always draw the same trace. An AF trace that
   * reshuffled on every repaint would read as a rendering bug. */
  function rng(seed) {
    var s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
    return function () { s = (s * 48271) % 2147483647; return s / 2147483647; };
  }

  /* ── 1. Cardiovascular: ventricular-arterial coupling ─────────────────────── */

  var CV = {
    edvCeiling: 250,   // mL, the ventricle cannot distend past this however hard you fill it
    edvK: 0.654,       // tuned so 100% preload lands on EDV 120 mL
    v0: 12,            // mL, unstressed ventricular volume
    ees: 2.3,          // mmHg/mL end-systolic elastance at 100% contractility
    svrWood: 17.5,     // Wood units at 100% afterload (1400 dyn.s.cm-5)
    rap: 5,            // mmHg, venous pressure the systemic circuit drains into
    ca: 1.75,          // mL/mmHg total arterial compliance, sets pulse pressure
    hr: 72
  };

  function simulateCardiovascular(params) {
    params = params || {};
    var preload = clamp(num(params.preload, 100), 10, 250);
    var afterload = clamp(num(params.afterload, 100), 20, 250);
    var contractility = clamp(num(params.contractility, 100), 10, 220);
    var hr = clamp(num(params.heartRate, CV.hr), 20, 220);
    var rhythm = params.rhythm || "sinus";
    var valve = params.valveLesion || { type: "none", severity: "mild" };
    var vType = valve.type || "none";
    var sev = vType === "none" ? 0 : sevOf(valve.severity);

    var signs = [];
    var explain = [];

    /* Filling. Venous return sets EDV along a saturating curve, then two things take volume away:
     * a short diastole at high rates, and the loss of the atrial kick in AF. */
    var edv = CV.edvCeiling * (1 - Math.exp(-CV.edvK * preload / 100));
    var fillTime = clamp(Math.pow(CV.hr / hr, 0.22), 0.55, 1.15);
    edv *= fillTime;
    if (rhythm === "afib") edv *= 0.85;
    if (rhythm === "chb") edv *= 1.05;             // long diastole overfills

    /* Valve lesions act on filling and on the load the ventricle ejects against. */
    var eaAdd = 0;            // extra elastance the ventricle sees (fixed obstruction)
    var regurgFraction = 0;   // fraction of each stroke that never reaches the body
    if (vType === "ms") {
      edv *= (1 - 0.11 * sev);
      if (hr > 90) edv *= (1 - Math.min(0.22, (hr - 90) * 0.0020 * sev));
    } else if (vType === "ar") {
      edv *= (1 + 0.15 * sev);
      regurgFraction = 0.15 * sev;
    } else if (vType === "mr") {
      edv *= (1 + 0.12 * sev);
      regurgFraction = 0.15 * sev;
    } else if (vType === "as") {
      eaAdd = 0.45 * sev;
    } else if (vType === "tr") {
      regurgFraction = 0.08 * sev;
    }
    edv = clamp(edv, 25, CV.edvCeiling);

    /* Coupling. SV = (EDV - V0) * Ees / (Ees + Ea). */
    var ees = CV.ees * (contractility / 100);
    var ea = CV.svrWood * (afterload / 100) * hr / 1000;
    var eaEff = ea + eaAdd;
    if (vType === "mr") eaEff *= (1 - 0.18 * sev);   // the LV part-empties into a low-pressure atrium

    var totalSv = clamp((edv - CV.v0) * ees / (ees + eaEff), 4, 200);
    var sv = clamp(totalSv * (1 - regurgFraction), 3, 200);   // forward, i.e. what the body gets
    var esv = clamp(edv - totalSv, 2, CV.edvCeiling);
    var ef = clamp((totalSv / edv) * 100, 5, 85);
    var co = sv * hr / 1000;

    /* Pressures. MAP from forward flow against resistance; pulse pressure from the volume actually
     * thrown into the aorta (in AR that is the whole regurgitant stroke, which is why it is wide). */
    var svrWood = CV.svrWood * (afterload / 100);
    var map = CV.rap + svrWood * co;
    var caComp = CV.ca / (1 + 0.35 * (afterload / 100 - 1));
    var ejected = (vType === "ar") ? totalSv : sv;
    var pp = ejected / caComp;
    if (vType === "as") pp *= (1 - 0.13 * sev);      // the obstruction damps the transmitted wave

    var sbp = map + pp * (2 / 3);
    var dbp = map - pp * (1 / 3);
    if (vType === "ar") dbp -= regurgFraction * 38;  // diastolic run-off back into the ventricle

    sbp = clamp(r0(sbp), 40, 260);
    dbp = clamp(r0(dbp), 15, 160);
    if (dbp >= sbp - 5) dbp = Math.max(15, sbp - 5);
    map = clamp(r0(map), 25, 200);

    /* JVP. Normal is about 3 cm above the sternal angle; it climbs with filling and with a failing
     * right side, and falls away to nothing when the tank is empty. */
    var jvp = 3 + (preload - 100) * 0.09 + (100 - contractility) * 0.05;
    var jvpWaveMode = "normal";
    if (rhythm === "afib") jvpWaveMode = "absent_a";
    else if (rhythm === "chb") jvpWaveMode = "cannon";
    if (vType === "tr") { jvpWaveMode = "giant_v"; jvp += 4 + sev; }
    if (vType === "ms") jvp += 1.5 * sev;
    jvp = clamp(r0(jvp), 0, 20);

    /* Pulse and sounds. */
    var soundKind = "s1s2_normal";
    var pulseCharacter = "normal";

    if (rhythm === "afib") {
      pulseCharacter = "irregularly_irregular";
      signs.push("Irregularly irregular pulse with variable volume");
      signs.push("Apex beat rate exceeds the radial rate (pulse deficit)");
    } else if (rhythm === "chb") {
      signs.push("Slow regular pulse, variable intensity first heart sound");
    } else if (hr > 100) {
      pulseCharacter = "tachycardia";
      signs.push("Sinus tachycardia");
    } else if (hr < 55) {
      pulseCharacter = "bradycardia";
      signs.push("Bradycardia");
    }

    var gradient = 0;
    if (vType === "as") {
      soundKind = "as_murmur";
      pulseCharacter = "parvus_et_tardus";
      gradient = r0(eaAdd * totalSv);
      signs.push("Slow-rising, plateau pulse (pulsus parvus et tardus)");
      signs.push("Ejection systolic murmur at the right second space, radiating to the carotids");
      if (sev >= 3) signs.push("Soft or absent A2 with reversed splitting");
    } else if (vType === "mr") {
      soundKind = "mr_murmur";
      signs.push("Pansystolic murmur at the apex radiating to the axilla");
      signs.push("Soft first heart sound");
      if (sev >= 3) signs.push("Displaced hyperdynamic apex beat with a third heart sound");
    } else if (vType === "ms") {
      soundKind = "ms_murmur";
      signs.push("Tapping apex beat, loud first heart sound, opening snap");
      signs.push("Mid-diastolic rumble at the apex, best in the left lateral position");
      if (rhythm !== "afib") signs.push("Presystolic accentuation (lost once atrial fibrillation sets in)");
    } else if (vType === "ar") {
      soundKind = "ar_murmur";
      pulseCharacter = "water_hammer";
      signs.push("Collapsing water-hammer pulse with a wide pulse pressure");
      signs.push("Early diastolic decrescendo murmur at the left sternal edge, leaning forward in expiration");
      if (sev >= 3) signs.push("Head nodding (de Musset) and nail-bed pulsation (Quincke)");
    } else if (vType === "tr") {
      soundKind = "tr_murmur";
      signs.push("Pansystolic murmur at the lower sternal edge, louder on inspiration");
      signs.push("Pulsatile, tender liver edge");
    }

    if (soundKind === "s1s2_normal") {
      if (preload > 130 && contractility < 80) {
        soundKind = "s3_gallop";
        signs.push("Third heart sound: a volume-loaded, poorly contracting ventricle");
      } else if (afterload > 135 && contractility >= 90) {
        soundKind = "s4_gallop";
        signs.push("Fourth heart sound: atrial contraction into a stiff, hypertrophied ventricle");
      }
    }

    if (jvp >= 8) signs.push("Raised jugular venous pressure at " + jvp + " cm above the sternal angle");
    if (map < 65) signs.push("Cool peripheries with delayed capillary refill");
    if (pp > 60 && vType !== "ar") signs.push("Wide pulse pressure");
    if (pp < 25) signs.push("Narrow pulse pressure, a low stroke volume sign");

    /* Named state, so the numbers carry a bedside meaning rather than floating free. */
    var LESION = {
      as: "Aortic stenosis", ar: "Aortic regurgitation", ms: "Mitral stenosis",
      mr: "Mitral regurgitation", tr: "Tricuspid regurgitation"
    };
    var lesionName = LESION[vType] ? (String(valve.severity || "moderate").charAt(0).toUpperCase() +
      String(valve.severity || "moderate").slice(1) + " " + LESION[vType].toLowerCase()) : "";
    var rhythmName = rhythm === "afib" ? (hr > 110 ? "Atrial fibrillation with a fast ventricular rate" : "Atrial fibrillation")
      : rhythm === "chb" ? "Complete heart block" : "";

    var stateLabel = "Normal haemodynamics";
    var stateTone = "ok";
    if (map < 65 && co < 3.8 && jvp >= 8) { stateLabel = "Cardiogenic shock"; stateTone = "bad"; }
    else if (map < 65 && co < 3.8) { stateLabel = "Hypovolaemic shock"; stateTone = "bad"; }
    else if (map < 65 && co > 6.5) { stateLabel = "Distributive (vasodilatory) shock"; stateTone = "bad"; }
    else if (map < 65) { stateLabel = "Shock"; stateTone = "bad"; }
    else if (jvp >= 10 && (co < 4.2 || ef < 40)) { stateLabel = "Congestive cardiac failure"; stateTone = "warn"; }
    else if (co < 3.5) { stateLabel = "Low cardiac output"; stateTone = "warn"; }
    else if (sbp >= 180 || dbp >= 110) { stateLabel = "Severe hypertension"; stateTone = "bad"; }
    else if (lesionName) { stateLabel = lesionName + ", compensated"; stateTone = "warn"; }
    else if (rhythmName && (hr > 110 || hr < 50)) { stateLabel = rhythmName; stateTone = "warn"; }
    else if (sbp >= 140 || dbp >= 90) { stateLabel = "Hypertension"; stateTone = "warn"; }
    else if (co > 7.5) { stateLabel = "Hyperdynamic circulation"; stateTone = "warn"; }
    else if (rhythmName) { stateLabel = rhythmName; stateTone = "warn"; }
    if (stateTone !== "ok" && lesionName && stateLabel.toLowerCase().indexOf(LESION[vType].toLowerCase()) < 0) {
      stateLabel += " on a background of " + lesionName.toLowerCase();
    }

    var perfusion = map >= 75 ? "Organ perfusion adequate"
      : map >= 65 ? "Perfusion pressure at the renal threshold"
      : "Below the autoregulatory floor: kidney and brain are now flow dependent";

    /* Why it changed. Written against the nominal patient, in the order a clinician would say it. */
    if (preload > 115) explain.push("Filling is up, so the ventricle sits further along the Starling curve and ejects more per beat until the curve flattens.");
    if (preload < 85) explain.push("Venous return is down, so end-diastolic volume falls and stroke volume falls with it. This is why a dry patient is tachycardic before they are hypotensive.");
    if (afterload > 115) explain.push("Arterial elastance is up: the same ventricle ejects less against it, yet mean pressure rises because resistance rose faster than flow fell.");
    if (afterload < 85) explain.push("Resistance is down. Flow rises, but mean pressure still falls, because pressure is the product of the two.");
    if (contractility < 85) explain.push("A weaker ventricle empties less completely: end-systolic volume climbs, ejection fraction falls, and filling pressures back up.");
    if (contractility > 115) explain.push("More inotropy empties the ventricle further, so ejection fraction and stroke volume both rise at the same filling.");
    if (hr > 110) explain.push("Diastole shortens faster than systole, so filling time is lost and stroke volume falls. Output only keeps rising while rate outruns that loss.");
    if (hr < 55) explain.push("A long diastole fills the ventricle well, so each stroke is large, but output still falls because there are too few of them.");
    if (vType === "ms") explain.push("A narrowed mitral valve limits filling, and every extra beat per minute steals diastolic filling time. That is why these patients decompensate in fast atrial fibrillation.");
    if (vType === "as") explain.push("A fixed obstruction means the ventricle generates roughly " + gradient + " mmHg more than the aorta ever sees. The pulse is slow-rising and the pressure is deceptively unimpressive.");
    if (vType === "ar" || vType === "mr") explain.push("About " + r0(regurgFraction * 100) + "% of each stroke goes backwards, so total stroke volume is large while forward output is not.");
    if (rhythm === "afib") explain.push("No atrial kick costs roughly 15% of filling, and the beat-to-beat variation means no two strokes are the same size.");
    if (rhythm === "chb") explain.push("Atria and ventricles are dissociated, so the atrium intermittently contracts against a shut tricuspid valve: cannon a waves.");
    if (!explain.length) explain.push("Every variable is at its nominal value, so the numbers are those of a healthy adult at rest.");

    return {
      /* headline numbers */
      cardiacOutput: r1(co),
      strokeVolume: r0(sv),
      totalStrokeVolume: r0(totalSv),
      bpSystolic: sbp,
      bpDiastolic: dbp,
      pulsePressure: sbp - dbp,
      meanArterialPressure: map,
      heartRate: r0(hr),
      /* ventricular volumes */
      edv: r0(edv),
      esv: r0(esv),
      ejectionFraction: r0(ef),
      /* loading conditions */
      svrDynes: r0(svrWood * 80),
      arterialElastance: r2(eaEff),
      ventricularElastance: r2(ees),
      valveGradient: gradient,
      regurgitantFraction: r0(regurgFraction * 100),
      /* bedside */
      jvpHeightCm: jvp,
      jvpWaveMode: jvpWaveMode,
      heartSoundKind: soundKind,
      audioKind: soundKind === "tr_murmur" ? "mr_murmur" : soundKind,
      pulseCharacter: pulseCharacter,
      clinicalSigns: signs,
      stateLabel: stateLabel,
      lesionLabel: lesionName,
      rhythmLabel: rhythmName,
      stateTone: stateTone,
      perfusion: perfusion,
      explain: explain
    };
  }

  /* ── 2. Respiratory: content-based gas exchange ───────────────────────────── */

  var P50 = 26.6, HILL = 2.7, HILL_K = Math.pow(P50, HILL);   // 7029, not 26600
  var PATM = 760, PH2O = 47, RQ = 0.8, HB = 15;

  function satFromPo2(po2) { var p = Math.pow(Math.max(0.5, po2), HILL); return p / (p + HILL_K); }
  function po2FromSat(s) { s = clamp(s, 0.005, 0.9995); return P50 * Math.pow(s / (1 - s), 1 / HILL); }
  function o2Content(sat, po2) { return 1.34 * HB * sat + 0.003 * po2; }

  /* Content back to a tension. Bisection rather than algebra, because near full saturation the
   * dissolved term carries all the remaining content and any closed form there is numerically
   * unstable: that is what made PaO2 fall as FiO2 rose. */
  function po2FromContent(content) {
    var lo = 1, hi = 700;
    for (var i = 0; i < 48; i++) {
      var mid = (lo + hi) / 2;
      if (o2Content(satFromPo2(mid), mid) < content) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function simulateRespiratory(params) {
    params = params || {};
    var raw = clamp(num(params.airwayResistance, 1.0), 0.3, 8.0);         // cmH2O/L/s
    var comp = clamp(num(params.compliance, 1.0), 0.1, 3.0);              // L/cmH2O
    var vd = clamp(num(params.deadSpaceFraction, 0.3), 0.05, 0.85);       // VD/VT
    var drive = clamp(num(params.respiratoryDrive, 100), 0, 260);         // % of normal central drive
    var fio2 = clamp(num(params.fiO2, 0.21), 0.21, 1.0);
    var shunt = clamp(num(params.shuntFraction, 0.02), 0, 0.6);           // Qs/Qt, 2% is physiological
    var be = clamp(num(params.baseExcess, 0), -25, 20);                   // metabolic component
    var co = clamp(num(params.cardiacOutput, 5.0), 1.0, 12);              // couples to the CVS tab
    var vco2 = clamp(num(params.co2Production, 200), 80, 600);            // mL/min
    var vo2 = clamp(num(params.o2Consumption, 250), 100, 900);            // mL/min
    var mvFixed = (params.minuteVentilation === null || params.minuteVentilation === undefined)
      ? null : clamp(num(params.minuteVentilation, 6), 0.4, 30);          // ventilator or legacy caller

    var signs = [];
    var explain = [];

    /* What the chest is mechanically capable of. Obstruction and stiffness both cap the minute
     * ventilation a patient can sustain, and that ceiling is the whole reason a tiring asthmatic
     * gets a "normal" CO2. */
    var mvMax = 22 * Math.pow(1 / raw, 0.55) * Math.pow(clamp(comp, 0.15, 2.2), 0.25);
    mvMax = clamp(mvMax, 2.0, 34);

    /* Ventilation and PaCO2 settle at an equilibrium: ventilation is a straight line against PaCO2
     * above the apnoeic threshold, PaCO2 is a rectangular hyperbola against ventilation, and the
     * patient lives where the two cross. Opioids flatten the line and shift the threshold right;
     * hypoxia and acidaemia steepen it. Two outer passes are enough for those to settle. */
    var slope0 = 1.6;                               // L/min of alveolar ventilation per mmHg PaCO2
    var apnoeic = drive < 100 ? 37.4 + (100 - drive) * 0.25 : 37.4 - (drive - 100) * 0.10;
    var paco2 = 40, va = 4.3, mv = 6.1, ventLimited = false, pao2 = 95, sat = 0.97, ph = 7.4, hco3 = 24, vdUsed = vd;
    var pAO2 = 100, caO2 = 20, cvFinal = 15;

    var vqShunt = (raw > 1.3 ? (raw - 1.3) * 0.035 : 0) + (comp < 0.85 ? (0.85 - comp) * 0.09 : 0);
    var totalShunt = clamp(shunt + vqShunt, 0, 0.75);
    var avDiff = clamp(vo2 / (co * 10), 1.5, 14);   // mL O2 per dL the tissues strip out

    for (var pass = 0; pass < 24; pass++) {
      var prevPaco2 = paco2;
      /* The chemoreceptors set TOTAL ventilation, not alveolar ventilation, which is the only way
       * dead space raises PaCO2 rather than merely raising the minute volume needed to hold it. */
      var slope = clamp((slope0 / 0.7) * (drive / 100), 0.05, 9);
      /* Raising the gain alone can never take PaCO2 below the apnoeic threshold, so everything that
       * drives ventilation independently of CO2 (wakefulness, hypoxia, distress) is an offset. */
      var hypoxic = pao2 < 60 ? Math.min(8, (60 - pao2) * 0.30) * clamp(drive / 100, 0, 1.5) : 0;
      var offset = (drive > 100 ? (drive - 100) * 0.07 : 0) + hypoxic;
      /* Oxygen given to an obstructed chest releases hypoxic pulmonary vasoconstriction and widens
       * dead space. This, more than any loss of drive, is why those patients retain CO2. */
      var vdEff = clamp(vd + (raw > 2 && fio2 > 0.24 ? Math.min(0.12, (fio2 - 0.24) * 0.22) : 0), 0.05, 0.88);

      if (mvFixed !== null) {
        mv = Math.min(mvFixed, mvMax);
        ventLimited = mvFixed > mvMax + 0.05;
        va = Math.max(0.25, mv * (1 - vdEff));
        paco2 = clamp(0.863 * vco2 / va, 12, 140);
      } else {
        /* MV = slope * (PaCO2 - apnoeic) + offset, VA = MV * (1 - VD/VT), PaCO2 = 0.863 VCO2 / VA.
         * One quadratic in PaCO2. */
        var qa = slope * (1 - vdEff);
        var qb = (1 - vdEff) * (offset - slope * apnoeic);
        var disc = Math.sqrt(qb * qb + 4 * qa * 0.863 * vco2);
        paco2 = (-qb + disc) / (2 * qa);
        if (pass > 0) paco2 = 0.45 * prevPaco2 + 0.55 * paco2;

        /* A primary metabolic acidosis compensates towards Winter's formula, and a patient with a
         * blunted drive only gets part of the way there. */
        if (be < -3) {
          var winter = clamp(1.5 * (24 + be) + 8, 10, 42);
          var reach = clamp(drive / 100, 0, 1);
          var target = winter + (1 - reach) * (paco2 - winter);
          if (target < paco2) paco2 = target;
        }
        paco2 = clamp(paco2, 12, 140);
        va = Math.max(0.25, 0.863 * vco2 / paco2);
        mv = va / (1 - vdEff);
        ventLimited = mv > mvMax + 0.05;
        if (ventLimited) {
          mv = mvMax;
          va = Math.max(0.25, mv * (1 - vdEff));
          paco2 = clamp(0.863 * vco2 / va, 12, 140);
        }
      }
      vdUsed = vdEff;

      /* Acid-base. Base excess is the metabolic story; the acute bicarbonate shift of a sudden CO2
       * change only tells that story when there is no primary metabolic problem to double count. */
      var acute = (paco2 > 40 ? (paco2 - 40) * 0.10 : (paco2 - 40) * 0.20) * clamp(1 - Math.abs(be) / 10, 0, 1);
      hco3 = clamp(24 + be + acute, 2, 50);
      ph = clamp(6.1 + Math.log10(hco3 / (0.0307 * paco2)), 6.5, 7.85);

      /* Oxygenation, solved by content so that shunt behaves like shunt. */
      var pio2 = (PATM - PH2O) * fio2;
      pAO2 = Math.max(5, pio2 - paco2 / RQ + (paco2 * fio2 * (1 - RQ) / RQ));
      var satCap = satFromPo2(pAO2);
      var cCapO2 = o2Content(satCap, pAO2);

      caO2 = cCapO2;
      for (var it = 0; it < 24; it++) {
        var cvO2 = Math.max(0.5, caO2 - avDiff);
        caO2 = (1 - totalShunt) * cCapO2 + totalShunt * cvO2;
      }
      cvFinal = Math.max(0.5, caO2 - avDiff);

      pao2 = clamp(po2FromContent(caO2), 12, 690);
      sat = satFromPo2(pao2);
    }

    var spo2 = clamp(r0(sat * 100), 30, 100);
    var svo2 = clamp(r0(satFromPo2(po2FromContent(cvFinal)) * 100), 10, 99);
    var aaGrad = Math.max(0, r0(pAO2 - pao2));
    var pf = r0(pao2 / fio2);

    /* Pattern. Stiff lungs are splinted into rapid shallow breaths; obstruction is emptied slowly,
     * so the same minute ventilation is carried by fewer, larger breaths. Hypoxaemia and acidaemia
     * push everyone towards rapid and shallow. */
    var vt = 500 * Math.pow(clamp(comp, 0.15, 2.2), 0.45) * (1 + 0.12 * clamp((raw - 1) / 4, 0, 1));
    if (pao2 < 65) vt *= 0.85;
    if (ph < 7.30) vt *= 1.25;                       // Kussmaul breaths are deep, not shallow
    vt = clamp(vt, 180, 900);
    var rr = clamp(r0((mv * 1000) / vt), 5, 55);
    vt = r0((mv * 1000) / rr);

    /* Work of breathing, read as the fraction of the mechanical reserve being spent. */
    var effort = mv / mvMax;
    var wob = "normal";
    if (effort > 0.55 || raw > 2.2 || comp < 0.55 || rr > 24) wob = "increased";
    if (effort > 0.85 || raw > 3.8 || rr > 32 || spo2 < 88 || comp < 0.35) wob = "severe";
    if (ventLimited && paco2 > 55) wob = "exhaustion";
    if (drive < 45 && paco2 > 55) wob = "suppressed";

    /* Spirometry, from the same two mechanical variables the sliders set. */
    var ratio = clamp(0.80 / Math.pow(raw, 0.35), 0.22, 0.88);
    var fvcFrac = clamp(Math.pow(comp, 0.5), 0.25, 1.25);
    var fev1Pct = r0(fvcFrac * (ratio / 0.80) * 100);
    var pattern = "normal";
    if (ratio < 0.70 && fvcFrac < 0.80) pattern = "mixed";
    else if (ratio < 0.70) pattern = "obstructive";
    else if (fvcFrac < 0.80) pattern = "restrictive";

    /* Breath sounds. */
    var soundKind = "vesicular";
    if (wob === "exhaustion" || (raw > 4.5 && spo2 < 85)) {
      soundKind = "reduced";
      signs.push("Silent chest: too little air is moving to make a wheeze. That is pre-arrest, not improvement.");
      signs.push("Paradoxical abdominal breathing");
    } else if (raw > 1.9) {
      soundKind = "wheeze";
      signs.push("Expiratory polyphonic wheeze throughout both lung fields");
      signs.push("Prolonged expiratory phase");
    } else if (comp < 0.6) {
      soundKind = "fine";
      signs.push("Fine end-inspiratory Velcro crackles at both bases");
    } else if (wob === "suppressed") {
      soundKind = "reduced";
      signs.push("Slow shallow breathing with a reduced level of consciousness");
    }

    if (spo2 < 88) signs.push("Central cyanosis visible in the tongue and oral mucosa");
    if (wob === "increased" || wob === "severe") signs.push("Accessory muscle use: sternocleidomastoid and scalenes");
    if (raw > 2.4) signs.push("Pursed-lip breathing on expiration");
    if (paco2 > 60) signs.push("Bounding pulse, warm peripheries and a flapping tremor of CO2 retention");
    if (ph < 7.28 && paco2 < 32) signs.push("Deep sighing Kussmaul respiration");
    if (pattern === "restrictive" && rr > 22) signs.push("Rapid shallow breathing with reduced chest expansion");
    if (ventLimited) signs.push("Ventilation is at the mechanical ceiling: this patient cannot breathe any harder");

    /* The interpretation a student is actually marked on. */
    var failureType = "none";
    if (pao2 < 60 && paco2 > 50) failureType = "type2";
    else if (pao2 < 60) failureType = "type1";

    var primary = "normal";
    if (ph < 7.35) primary = paco2 > 45 ? "respiratory acidosis" : "metabolic acidosis";
    else if (ph > 7.45) primary = paco2 < 35 ? "respiratory alkalosis" : "metabolic alkalosis";
    else if (paco2 > 45 || paco2 < 35 || hco3 > 28 || hco3 < 21) primary = "compensated disturbance";

    var abg = "pH " + r2(ph) + ", PaCO2 " + r0(paco2) + ", HCO3 " + r1(hco3) + ", PaO2 " + r0(pao2) +
      " on FiO2 " + r0(fio2 * 100) + "%: " + primary +
      (failureType === "type2" ? " with type 2 respiratory failure"
        : failureType === "type1" ? " with type 1 respiratory failure" : "");

    /* Why it changed. */
    if (vdUsed > 0.45) explain.push("Dead space is " + r0(vdUsed * 100) + "% of every breath, so of " + r1(mv) + " L/min only " + r1(va) + " L/min reaches alveoli. Minute ventilation looks adequate while CO2 climbs: that is the trap in pulmonary embolism.");
    if (drive < 70) explain.push("Central drive is at " + r0(drive) + "% of normal, so ventilation settles at a higher CO2 before the chemoreceptors push back. The lungs are innocent here, and oxygen will not correct the pH.");
    if (drive > 130) explain.push("A high drive holds PaCO2 low. Note how much it does for the CO2 and how little for the oxygen: ventilation controls CO2 far more tightly than it controls O2.");
    if (ventLimited) explain.push("The patient wants more ventilation than this chest can deliver, so they are pinned at " + r1(mvMax) + " L/min. A rising CO2 from here is fatigue, not improvement, and it is the point at which support is needed.");
    if (raw > 2.0) explain.push("An airway resistance of " + r1(raw) + " gives an FEV1/FVC of " + r2(ratio) + ". Emptying is slow, air traps, and the ventilation-perfusion scatter that follows is what drops the saturation.");
    if (comp < 0.7) explain.push("Stiff lungs cost more pressure for the same breath, so the pattern turns rapid and shallow: tidal volume " + vt + " mL at a rate of " + rr + ".");
    if (totalShunt > 0.15) explain.push("About " + r0(totalShunt * 100) + "% of the cardiac output passes lung that is not ventilated. Blood that never meets gas cannot be oxygenated, so raising FiO2 moves the saturation very little. That is how shunt is separated from V/Q mismatch at the bedside.");
    if (fio2 > 0.5 && totalShunt > 0.25) explain.push("Refractory hypoxaemia on a high FiO2 calls for recruitment, PEEP or prone positioning, not more oxygen.");
    if (co < 3.5) explain.push("A low cardiac output means the tissues strip more oxygen from each dL, so mixed venous saturation falls to " + svo2 + "%. Any shunt then drags the arterial saturation down harder.");
    if (be < -6) explain.push("A base excess of " + r0(be) + " is a metabolic acidosis. Winter's formula predicts a PaCO2 of about " + r0(1.5 * hco3 + 8) + "; the model settles at " + r0(paco2) + ", so the compensation is appropriate.");
    if (be > 6) explain.push("A base excess of +" + r0(be) + " is a buffered, chronic CO2 load. An acute retainer would have a normal bicarbonate and a far lower pH at the same PaCO2.");
    if (!explain.length) explain.push("All mechanics are nominal: alveolar ventilation " + r1(va) + " L/min, A-a gradient " + aaGrad + " mmHg, and a blood gas within range.");

    return {
      respiratoryRate: rr,
      tidalVolume: vt,
      minuteVentilation: r1(mv),
      minuteVentilationMax: r1(mvMax),
      ventilationLimited: ventLimited,
      alveolarVentilation: r1(va),
      breathSoundKind: soundKind,
      audioKind: soundKind,
      spO2: spo2,
      svO2: svo2,
      paO2: r0(pao2),
      paCO2: r0(paco2),
      pAO2: r0(pAO2),
      aaGradient: aaGrad,
      pfRatio: pf,
      etCO2: r0(paco2 * (1 - vdUsed * 0.6)),
      deadSpaceUsed: r2(vdUsed),
      pH: r2(ph),
      hco3: r1(hco3),
      baseExcess: r0(be),
      shuntFraction: r0(totalShunt * 100),
      caO2: r1(caO2),
      workOfBreathing: wob,
      spirometry: { fev1Pct: fev1Pct, ratio: r2(ratio), fvcPct: r0(fvcFrac * 100), pattern: pattern },
      failureType: failureType,
      acidBase: primary,
      abgInterpretation: abg,
      clinicalSigns: signs,
      explain: explain
    };
  }

  /* ── 3. Waveforms ─────────────────────────────────────────────────────────── */

  var W = 320, H = 72;

  function toPath(vals, h) {
    var d = "", step = W / (vals.length - 1);
    for (var i = 0; i < vals.length; i++) {
      d += (i ? "L" : "M") + r1(i * step) + " " + r1(clamp(h - vals[i] * h, 0, h));
    }
    return d;
  }

  function bump(u, centre, width, amp) {
    var z = (u - centre) / width;
    return amp * Math.exp(-z * z);
  }

  /* ECG. Four seconds of rhythm strip, sampled per pixel. */
  function ecgPath(hr, rhythm) {
    hr = clamp(num(hr, 72), 20, 220);
    rhythm = rhythm || "sinus";
    var dur = 4.0, n = W, vals = [], rand = rng(r0(hr) * 7 + (rhythm === "afib" ? 31 : rhythm === "chb" ? 17 : 3));
    var wide = rhythm === "chb" ? 1.9 : 1.0;

    var beats = [], t = 0.25, rr = 60 / hr;
    while (t < dur + rr) {
      beats.push(t);
      t += rhythm === "afib" ? rr * (0.55 + 0.9 * rand()) : rr;
    }
    /* In complete heart block the atria carry on at their own rate, unrelated to the ventricles. */
    var pWaves = [];
    if (rhythm === "chb") { for (var pt = 0.1; pt < dur; pt += 60 / 82) pWaves.push(pt); }

    for (var i = 0; i < n; i++) {
      var time = i * dur / (n - 1), v = 0;
      for (var b = 0; b < beats.length; b++) {
        var u = time - beats[b];
        if (u < -0.05 || u > 0.55) continue;
        if (rhythm === "sinus") v += bump(u, 0.00, 0.022, 0.13);
        v += bump(u, 0.115, 0.007 * wide, -0.07);
        v += bump(u, 0.140, 0.009 * wide, 1.00);
        v += bump(u, 0.168, 0.010 * wide, -0.22);
        v += bump(u, 0.300, 0.038, rhythm === "chb" ? -0.20 : 0.22);
      }
      for (var q = 0; q < pWaves.length; q++) v += bump(time - pWaves[q], 0, 0.022, 0.13);
      vals.push(0.42 + v * 0.40);
    }
    return { d: toPath(vals, H), w: W, h: H, label: "ECG " + r0(hr) + "/min" };
  }

  /* Arterial pressure trace. The shape, not the height, is the physical sign. */
  function arterialShape(p, kind) {
    if (kind === "water_hammer") {
      if (p < 0.05) return Math.pow(p / 0.05, 0.6);
      if (p < 0.42) return 1 - Math.pow((p - 0.05) / 0.37, 0.75);
      return 0;
    }
    if (kind === "parvus_et_tardus") {
      if (p < 0.34) return 0.92 * Math.pow(p / 0.34, 0.85) + 0.02 * Math.sin(p * 60);  // shudder
      if (p < 0.62) return 0.94 - 0.55 * ((p - 0.34) / 0.28);
      return 0.39 * Math.exp(-(p - 0.62) * 3.2);
    }
    if (p < 0.12) return Math.sin((p / 0.12) * Math.PI / 2);
    if (p < 0.33) return 1 - 0.42 * Math.pow((p - 0.12) / 0.21, 1.2);
    if (p < 0.38) return 0.58 - 0.16 * Math.sin(((p - 0.33) / 0.05) * Math.PI);        // dicrotic notch
    if (p < 0.44) return 0.42 + 0.10 * Math.sin(((p - 0.38) / 0.06) * Math.PI);        // dicrotic wave
    return 0.46 * Math.exp(-(p - 0.44) * 2.6);
  }

  function arterialPath(hr, kind, rhythm) {
    hr = clamp(num(hr, 72), 20, 220);
    var dur = 4.0, n = W, vals = [], rand = rng(r0(hr) * 7 + 31), rr = 60 / hr;
    var beats = [], amps = [], t = 0.15;
    while (t < dur + rr) {
      beats.push(t);
      amps.push(rhythm === "afib" ? 0.45 + 0.55 * rand() : 1);
      t += rhythm === "afib" ? rr * (0.55 + 0.9 * rand()) : rr;
    }
    for (var i = 0; i < n; i++) {
      var time = i * dur / (n - 1), v = 0.10;
      for (var b = 0; b < beats.length; b++) {
        var u = time - beats[b];
        var span = (b + 1 < beats.length ? beats[b + 1] - beats[b] : rr);
        if (u < 0 || u > span) continue;
        v = 0.10 + arterialShape(u / span, kind) * 0.78 * amps[b];
      }
      vals.push(v);
    }
    return { d: toPath(vals, H), w: W, h: H, label: String(kind || "normal").replace(/_/g, " ") + " pulse" };
  }

  /* JVP. The waveform is the diagnosis here: a, c, x, v, y. */
  function jvpPath(hr, mode) {
    hr = clamp(num(hr, 72), 20, 220);
    mode = mode || "normal";
    var dur = 4.0, n = W, vals = [], rr = 60 / hr, cannonEvery = 3, beat = 0;
    for (var i = 0; i < n; i++) {
      var time = i * dur / (n - 1);
      var idx = Math.floor((time - 0.1) / rr);
      var p = ((time - 0.1) / rr) - idx;
      if (p < 0) p += 1;
      beat = idx;
      var v = 0.30;
      var aAmp = mode === "absent_a" ? 0 : 0.20;
      if (mode === "cannon" && idx % cannonEvery === 0) aAmp = 0.55;
      v += bump(p, 0.07, 0.040, aAmp);                                  // a wave
      v += bump(p, 0.20, 0.030, 0.10);                                  // c wave
      if (mode !== "giant_v") v -= bump(p, 0.33, 0.060, 0.14);          // x descent
      v += bump(p, 0.52, 0.055, mode === "giant_v" ? 0.58 : 0.16);      // v wave
      v -= bump(p, 0.70, 0.060, mode === "giant_v" ? 0.20 : 0.12);      // y descent
      vals.push(clamp(v, 0.02, 0.98));
    }
    var names = { normal: "a c x v y", absent_a: "absent a wave", cannon: "cannon a waves", giant_v: "giant v wave with a sharp y descent" };
    return { d: toPath(vals, H), w: W, h: H, label: "JVP: " + (names[mode] || mode) };
  }

  /* Capnograph. The upslope of phase III is the obstruction. */
  function capnoPath(rr, etco2, raw) {
    rr = clamp(num(rr, 14), 5, 48);
    etco2 = clamp(num(etco2, 38), 5, 100);
    raw = clamp(num(raw, 1), 0.3, 8);
    var dur = 4.0, n = W, vals = [], cyc = 60 / rr, obst = clamp((raw - 1.2) / 3.0, 0, 1);
    var top = clamp(etco2 / 80, 0.05, 0.95);
    for (var i = 0; i < n; i++) {
      var p = ((i * dur / (n - 1)) % cyc) / cyc, v = 0;
      var riseEnd = 0.12 + 0.22 * obst;                 // phase II slurs as obstruction rises
      var plateauEnd = 0.68;
      if (p < 0.08) v = 0;
      else if (p < riseEnd) v = top * (0.35 + 0.40 * obst) * ((p - 0.08) / (riseEnd - 0.08));
      else if (p < plateauEnd) {
        var start = top * (0.35 + 0.40 * obst);
        v = start + (top - start) * Math.pow((p - riseEnd) / (plateauEnd - riseEnd), obst > 0.35 ? 1.0 : 0.25);
      } else if (p < 0.78) v = top * (1 - (p - plateauEnd) / 0.10);
      vals.push(clamp(v, 0, 1));
    }
    return { d: toPath(vals, H), w: W, h: H, label: "Capnograph, EtCO2 " + r0(etco2) + " mmHg" + (obst > 0.35 ? " (shark fin)" : "") };
  }

  /* Flow-volume loop. Scooping of the expiratory limb is airflow obstruction made visible. */
  function flowVolumePath(ratio, fvcPct) {
    ratio = clamp(num(ratio, 0.8), 0.2, 0.9);
    var fvc = clamp(num(fvcPct, 100) / 100, 0.2, 1.3);
    var obst = clamp((0.80 - ratio) / 0.50, 0, 1);
    var pef = clamp(0.95 * Math.pow(ratio / 0.8, 0.8) * Math.pow(fvc, 0.4), 0.15, 1);
    var x0 = W * 0.06, x1 = x0 + (W * 0.80) * fvc, mid = H * 0.52, up = H * 0.48, dn = H * 0.42;
    var d = "M" + r1(x0) + " " + r1(mid);
    var peakX = x0 + (x1 - x0) * 0.16;
    d += "L" + r1(peakX) + " " + r1(mid - up * pef);
    for (var s = 1; s <= 14; s++) {
      var f = s / 14;
      var x = peakX + (x1 - peakX) * f;
      var lin = pef * (1 - f);
      var scoop = pef * Math.pow(1 - f, 1 + 2.4 * obst);
      var y = mid - up * (lin * (1 - obst) + scoop * obst);
      d += "L" + r1(x) + " " + r1(y);
    }
    d += "L" + r1(x1) + " " + r1(mid);
    /* Inspiratory limb: a smooth semicircle, spared in pure airflow obstruction. */
    var ins = 0.62 * Math.pow(fvc, 0.5);
    for (var q = 1; q <= 14; q++) {
      var g = q / 14, xi = x1 - (x1 - x0) * g;
      d += "L" + r1(xi) + " " + r1(mid + dn * ins * Math.sin(g * Math.PI));
    }
    d += "L" + r1(x0) + " " + r1(mid);
    var names = { obstructive: "scooped expiratory limb", restrictive: "small but normally shaped loop", mixed: "small and scooped", normal: "normal loop" };
    var pat = ratio < 0.70 && fvc < 0.80 ? "mixed" : ratio < 0.70 ? "obstructive" : fvc < 0.80 ? "restrictive" : "normal";
    return { d: d, w: W, h: H, label: "Flow-volume loop: " + names[pat], midline: r1(mid) };
  }

  function cardiovascularWaves(params, res) {
    var hr = res.heartRate, rhythm = (params && params.rhythm) || "sinus";
    return [
      ecgPath(hr, rhythm),
      arterialPath(hr, res.pulseCharacter, rhythm),
      jvpPath(hr, res.jvpWaveMode)
    ];
  }

  function respiratoryWaves(params, res) {
    return [
      capnoPath(res.respiratoryRate, res.etCO2, (params && params.airwayResistance) || 1),
      flowVolumePath(res.spirometry.ratio, res.spirometry.fvcPct)
    ];
  }

  /* ── 4. Presets ───────────────────────────────────────────────────────────── */

  var PRESETS = [
    { id: "cv-normal", mode: "cvs", label: "Healthy adult",
      params: { preload: 100, afterload: 100, contractility: 100, heartRate: 72, rhythm: "sinus", valve: "none", severity: "none" },
      note: "The reference point. Come back here after every experiment." },
    { id: "cv-hypovol", mode: "cvs", label: "Hypovolaemic shock",
      params: { preload: 40, afterload: 170, contractility: 110, heartRate: 130, rhythm: "sinus", valve: "none", severity: "none" },
      note: "An empty tank, clamped down and running fast. Note the flat JVP and the narrow pulse pressure: both appear long before the systolic pressure falls." },
    { id: "cv-cardiogenic", mode: "cvs", label: "Cardiogenic shock",
      params: { preload: 180, afterload: 170, contractility: 20, heartRate: 118, rhythm: "sinus", valve: "none", severity: "none" },
      note: "A full tank the pump cannot move. Same low output as hypovolaemia, opposite JVP. That single sign decides whether you give fluid or take it off." },
    { id: "cv-septic", mode: "cvs", label: "Septic (vasodilatory) shock",
      params: { preload: 80, afterload: 40, contractility: 110, heartRate: 120, rhythm: "sinus", valve: "none", severity: "none" },
      note: "High output and still hypotensive, because resistance has collapsed. Warm peripheries do not mean the patient is well." },
    { id: "cv-ccf", mode: "cvs", label: "Decompensated heart failure",
      params: { preload: 180, afterload: 125, contractility: 32, heartRate: 104, rhythm: "sinus", valve: "none", severity: "none" },
      note: "Raised JVP, third heart sound, low output. Watch the ejection fraction and end-systolic volume as you wind contractility back up." },
    { id: "cv-htn", mode: "cvs", label: "Hypertensive heart",
      params: { preload: 105, afterload: 175, contractility: 105, heartRate: 70, rhythm: "sinus", valve: "none", severity: "none" },
      note: "A stiff, pressure-loaded ventricle with a fourth heart sound. The ejection fraction is preserved and the patient is still symptomatic." },
    { id: "cv-af", mode: "cvs", label: "Fast atrial fibrillation",
      params: { preload: 110, afterload: 85, contractility: 80, heartRate: 150, rhythm: "afib", valve: "none", severity: "none" },
      note: "No atrial kick and no filling time. Compare the ECG and the arterial trace: some beats never reach the wrist." },
    { id: "cv-as", mode: "cvs", label: "Severe aortic stenosis",
      params: { preload: 110, afterload: 110, contractility: 100, heartRate: 70, rhythm: "sinus", valve: "as", severity: "severe" },
      note: "The measured pressure is unremarkable, the gradient is not. Feel the carotid: slow-rising and late-peaking." },
    { id: "cv-ar", mode: "cvs", label: "Severe aortic regurgitation",
      params: { preload: 140, afterload: 90, contractility: 100, heartRate: 80, rhythm: "sinus", valve: "ar", severity: "severe" },
      note: "A huge total stroke volume and an unremarkable forward one. The wide pulse pressure and collapsing pulse are the giveaway." },
    { id: "cv-ms", mode: "cvs", label: "Mitral stenosis in fast AF",
      params: { preload: 125, afterload: 100, contractility: 100, heartRate: 140, rhythm: "afib", valve: "ms", severity: "severe" },
      note: "Drop the rate and watch output rise. This is the one lesion where slowing the heart treats the shock." },
    { id: "cv-chb", mode: "cvs", label: "Complete heart block",
      params: { preload: 110, afterload: 110, contractility: 100, heartRate: 38, rhythm: "chb", valve: "none", severity: "none" },
      note: "A large stroke volume cannot rescue a rate of 38. Look for cannon a waves in the venous trace." },

    { id: "rs-normal", mode: "resp", label: "Healthy adult",
      params: { airwayResistance: 1.0, compliance: 1.0, deadSpaceFraction: 0.30, respiratoryDrive: 100, fiO2: 0.21, shuntFraction: 0.02, baseExcess: 0 },
      note: "Room air, A-a gradient in single figures, blood gas in range." },
    { id: "rs-copd", mode: "resp", label: "COPD exacerbation",
      params: { airwayResistance: 4.2, compliance: 1.6, deadSpaceFraction: 0.58, respiratoryDrive: 45, fiO2: 0.24, shuntFraction: 0.16, baseExcess: 9 },
      note: "A blunted drive, obstruction and a wide dead space. Wind FiO2 up from 24% and watch the CO2 climb: oxygen releases hypoxic pulmonary vasoconstriction and widens dead space. Target 88 to 92%, not 100%." },
    { id: "rs-asthma", mode: "resp", label: "Acute severe asthma",
      params: { airwayResistance: 4.2, compliance: 1.2, deadSpaceFraction: 0.42, respiratoryDrive: 185, fiO2: 0.40, shuntFraction: 0.14, baseExcess: -3 },
      note: "Ventilation is already at the mechanical ceiling, so the CO2 is only low while they can keep it up. Push airway resistance past 5 and watch a normal CO2 appear: in asthma that is exhaustion, not improvement." },
    { id: "rs-ards", mode: "resp", label: "ARDS",
      params: { airwayResistance: 1.4, compliance: 0.28, deadSpaceFraction: 0.50, respiratoryDrive: 180, fiO2: 0.80, shuntFraction: 0.38, baseExcess: -4 },
      note: "Stiff lungs and a large shunt. Push FiO2 to 1.0 and see how little the saturation moves: that is why the answer is PEEP and proning." },
    { id: "rs-fibrosis", mode: "resp", label: "Pulmonary fibrosis",
      params: { airwayResistance: 1.0, compliance: 0.32, deadSpaceFraction: 0.35, respiratoryDrive: 150, fiO2: 0.21, shuntFraction: 0.12, baseExcess: 0 },
      note: "Restriction with a preserved FEV1/FVC ratio, rapid shallow breathing and a widened A-a gradient." },
    { id: "rs-pe", mode: "resp", label: "Pulmonary embolism",
      params: { airwayResistance: 1.1, compliance: 0.90, deadSpaceFraction: 0.65, respiratoryDrive: 160, fiO2: 0.21, shuntFraction: 0.08, baseExcess: 0 },
      note: "Dead space, not shunt. Minute ventilation is high, CO2 is low, and the gap between end-tidal and arterial CO2 is the fingerprint." },
    { id: "rs-opioid", mode: "resp", label: "Opioid overdose",
      params: { airwayResistance: 1.0, compliance: 1.0, deadSpaceFraction: 0.30, respiratoryDrive: 10, fiO2: 0.21, shuntFraction: 0.02, baseExcess: 0 },
      note: "Normal lungs, absent drive. Oxygen will lift the saturation and do nothing at all for the CO2 or the pH." },
    { id: "rs-dka", mode: "resp", label: "Diabetic ketoacidosis",
      params: { airwayResistance: 1.0, compliance: 1.0, deadSpaceFraction: 0.30, respiratoryDrive: 100, fiO2: 0.21, shuntFraction: 0.02, baseExcess: -19 },
      note: "The lungs are normal and working hard. Kussmaul breathing is the compensation, so check the measured CO2 against Winter's formula." },
    { id: "rs-pneumonia", mode: "resp", label: "Lobar pneumonia",
      params: { airwayResistance: 1.2, compliance: 0.70, deadSpaceFraction: 0.35, respiratoryDrive: 155, fiO2: 0.21, shuntFraction: 0.26, baseExcess: -2 },
      note: "A consolidated lobe is perfused but not ventilated: a true shunt. Type 1 failure with a low CO2 from the tachypnoea." }
  ];

  function preset(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return null;
  }
  function presetsFor(mode) {
    var out = [];
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].mode === mode) out.push(PRESETS[i]);
    return out;
  }

  var API = {
    simulateCardiovascular: simulateCardiovascular,
    simulateRespiratory: simulateRespiratory,
    cardiovascularWaves: cardiovascularWaves,
    respiratoryWaves: respiratoryWaves,
    ecgPath: ecgPath,
    arterialPath: arterialPath,
    jvpPath: jvpPath,
    capnoPath: capnoPath,
    flowVolumePath: flowVolumePath,
    satFromPo2: satFromPo2,
    po2FromSat: po2FromSat,
    PRESETS: PRESETS,
    preset: preset,
    presetsFor: presetsFor
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_PHYSIOLOGY = API;
})();
