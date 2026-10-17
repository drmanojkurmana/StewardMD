/* Code Blue ECG rhythm course (codeblue-ecg.js): education-only schematic rhythm trainer. ES5.
 *
 * Procedural SVG ECG strips on a standard grid (1 mm and 5 mm squares, 25 mm/s, 10 mm/mV),
 * a six-step reading course, a schematic 12-lead view, touch and mouse calipers, flashcards
 * and a randomised quiz with spaced repetition of misses. Vanilla JS, no framework, offline.
 *
 * Every strip is drawn from a parametric beat model (P, QRS and T components with explicit
 * timing logic) and is labelled "schematic": these are teaching drawings, never real traces.
 * This module never interprets a patient ECG and says nothing about a learner's own ECG.
 * No drug doses. British spelling in new strings.
 *
 * window.CodeBlueECG = { open(), close(), isOpen(), ...pure helpers (also exported for node) }.
 * Progress persists in localStorage key "smd.cbecg.v1" inside try/catch.
 */
(function (G) {
  "use strict";

  var MM_PER_S = 25, MM_PER_MV = 10, SAMPLE_HZ = 100, STRIP_S = 10;
  var STORE_KEY = "smd.cbecg.v1";

  /* Deterministic PRNG (mulberry32) so strips and tests are reproducible. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function escH(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---- Rhythm catalogue: 14 schematic rhythms. ---- */
  var RHYTHMS = [
    { id: "sinus", name: "Sinus rhythm", rate: 72, regular: true, cls: "pulse-present",
      features: ["P wave before every QRS", "Regular rhythm, 60 to 100 per min", "Normal PR interval and narrow QRS"] },
    { id: "sinus-brady", name: "Sinus bradycardia", rate: 45, regular: true, cls: "pulse-present",
      features: ["P wave before every QRS", "Regular rhythm below 60 per min", "Otherwise normal complexes"] },
    { id: "sinus-tach", name: "Sinus tachycardia", rate: 130, regular: true, cls: "pulse-present",
      features: ["P wave before every QRS", "Regular rhythm above 100 per min", "Often from a cause outside the heart"] },
    { id: "afib", name: "Atrial fibrillation", rate: 110, regular: false, cls: "pulse-present",
      features: ["Irregularly irregular QRS complexes", "No P waves, fibrillatory baseline", "Narrow QRS unless aberrant"] },
    { id: "flutter", name: "Atrial flutter", rate: 150, regular: true, cls: "pulse-present",
      features: ["Sawtooth flutter waves near 300 per min", "Often 2:1 conduction, ventricular rate near 150", "Regular when conduction is fixed"] },
    { id: "svt", name: "Supraventricular tachycardia", rate: 180, regular: true, cls: "pulse-present",
      features: ["Regular narrow-complex tachycardia", "P waves hidden or just after QRS", "Abrupt onset and offset"] },
    { id: "vt", name: "Ventricular tachycardia", rate: 170, regular: true, cls: "shockable",
      features: ["Regular wide-complex tachycardia", "No P waves driving the QRS", "Treat as pulseless VT in arrest"] },
    { id: "vfib", name: "Ventricular fibrillation", rate: 0, regular: false, cls: "shockable",
      features: ["Chaotic baseline, no QRS complexes", "No pulse, shockable arrest rhythm", "Needs immediate defibrillation in arrest"] },
    { id: "torsades", name: "Torsades de pointes", rate: 200, regular: false, cls: "shockable",
      features: ["Polymorphic QRS twisting around the baseline", "Waxing and waning amplitude", "Shockable when pulseless in arrest"] },
    { id: "first-degree", name: "First-degree AV block", rate: 70, regular: true, cls: "pulse-present",
      features: ["PR interval prolonged beyond 200 ms", "Every P wave still conducts", "Regular rhythm"] },
    { id: "mobitz1", name: "Second-degree AV block, Mobitz I (Wenckebach)", rate: 60, regular: false, cls: "pulse-present",
      features: ["PR interval lengthens with each beat", "Then a P wave fails to conduct (dropped QRS)", "Grouped beating pattern"] },
    { id: "mobitz2", name: "Second-degree AV block, Mobitz II", rate: 55, regular: false, cls: "pulse-present",
      features: ["PR interval fixed where conduction occurs", "Sudden dropped QRS without PR lengthening", "Often needs pacing when symptomatic"] },
    { id: "third-degree", name: "Third-degree (complete) AV block", rate: 45, regular: true, cls: "pulse-present",
      features: ["P waves and QRS complexes fully dissociated", "Atrial rate faster than the slow escape rhythm", "Regular escape rhythm, often wide"] },
    { id: "asystole", name: "Asystole", rate: 0, regular: true, cls: "non-shockable",
      features: ["Near-flat baseline, no QRS complexes", "Non-shockable arrest rhythm", "Confirm in more than one lead in practice"] }
  ];
  var RHYTHM_BY_ID = {};
  (function () { for (var i = 0; i < RHYTHMS.length; i++) RHYTHM_BY_ID[RHYTHMS[i].id] = RHYTHMS[i]; })();

  var CLS_LABEL = { "shockable": "Shockable (arrest)", "non-shockable": "Non-shockable (arrest)", "pulse-present": "Pulse present (training)" };

  /* ---- Parametric beat model: Gaussian P, QRS and T components. ----
   * describe(id) returns deterministic timing events over a 12 s window:
   * { pTimes[], qrsTimes[], prList[], rrList[], qrsWidth, hasP, rate, regular }.
   * sample(id) renders those events to mV samples at SAMPLE_HZ for STRIP_S seconds. */
  function describe(id) {
    var meta = RHYTHM_BY_ID[id];
    if (!meta) return null;
    var WIN = 12, pTimes = [], qrsTimes = [], prList = [], i, t;
    var qrsWidth = 80, hasP = true;
    function regularTrain(rate, pr) {
      var rr = 60000 / rate, off = 400;
      for (t = off; t < WIN * 1000; t += rr) {
        if (pr != null) { pTimes.push(t - pr); prList.push(pr); }
        qrsTimes.push(t);
      }
    }
    switch (id) {
      case "sinus": regularTrain(72, 160); break;
      case "sinus-brady": regularTrain(45, 170); break;
      case "sinus-tach": regularTrain(130, 140); break;
      case "first-degree": regularTrain(70, 280); break;
      case "svt": regularTrain(180, null); hasP = false; break;
      case "vt": regularTrain(170, null); hasP = false; qrsWidth = 140; break;
      case "flutter":
        /* Atrial rate 300 (200 ms), 2:1 conduction: QRS every 400 ms. */
        for (t = 200; t < WIN * 1000; t += 200) pTimes.push(t);
        for (t = 400; t < WIN * 1000; t += 400) qrsTimes.push(t);
        hasP = false;
        break;
      case "afib": {
        /* Irregularly irregular: deterministic jittered ventricular response. */
        hasP = false;
        var r = rng(hashStr("afib")), tt = 400;
        while (tt < WIN * 1000) { qrsTimes.push(tt); tt += 320 + r() * 450; }
        break;
      }
      case "vfib": hasP = false; break;
      case "torsades": {
        hasP = false; qrsWidth = 130;
        var r2 = rng(hashStr("torsades")), tt2 = 400;
        while (tt2 < WIN * 1000) { qrsTimes.push(tt2); tt2 += 260 + r2() * 110; }
        break;
      }
      case "asystole": hasP = false; break;
      case "mobitz1": {
        /* Wenckebach 4:3: PR 160, 220, 280 then a non-conducted P. */
        var prs = [160, 220, 280], tt3 = 600, k = 0;
        while (tt3 < WIN * 1000) {
          if (k % 4 < 3) {
            var pr = prs[k % 4]; pTimes.push(tt3 - pr); prList.push(pr); qrsTimes.push(tt3);
            tt3 += 840;
          } else { pTimes.push(tt3 - 340); prList.push(null); tt3 += 840; }
          k++;
        }
        break;
      }
      case "mobitz2": {
        /* Fixed PR 160, every 4th QRS dropped (4:3 conduction). */
        var tt4 = 600, k2 = 0;
        while (tt4 < WIN * 1000) {
          if (k2 % 4 < 3) { pTimes.push(tt4 - 160); prList.push(160); qrsTimes.push(tt4); }
          else { pTimes.push(tt4 - 160); prList.push(null); }
          tt4 += 1000; k2++;
        }
        break;
      }
      case "third-degree": {
        /* Atria at 90, ventricles escape at 45: independent, AV dissociation. */
        for (t = 300; t < WIN * 1000; t += 60000 / 90) pTimes.push(t);
        for (t = 500; t < WIN * 1000; t += 60000 / 45) qrsTimes.push(t);
        qrsWidth = 120;
        break;
      }
    }
    var rrList = [];
    for (i = 1; i < qrsTimes.length; i++) rrList.push(qrsTimes[i] - qrsTimes[i - 1]);
    var rate = 0;
    if (rrList.length) {
      var mean = 0; for (i = 0; i < rrList.length; i++) mean += rrList[i];
      mean /= rrList.length; rate = Math.round(60000 / mean);
    }
    return { id: id, pTimes: pTimes, qrsTimes: qrsTimes, prList: prList, rrList: rrList,
      qrsWidth: qrsWidth, hasP: hasP, rate: rate, regular: meta.regular };
  }

  function gauss(t, c, w, a) {
    var x = (t - c) / w;
    return a * Math.exp(-0.5 * x * x);
  }

  function sample(id, opts) {
    opts = opts || {};
    var stElev = opts.stElev || 0; /* mV of ST offset, for 12-lead territory leads */
    var d = describe(id);
    var n = SAMPLE_HZ * STRIP_S, out = new Array(n), i;
    for (i = 0; i < n; i++) out[i] = 0;
    var r = rng(hashStr("wave:" + id));
    var wide = d.qrsWidth > 100;
    var qrsScale = wide ? 1.15 : 1.0;
    var qw = wide ? 26 : 11; /* ms sigma of the R component */
    var qi, t, v;
    /* Fibrillatory / chaotic baselines first. */
    if (id === "afib" || id === "flutter" || id === "vfib" || id === "torsades") {
      var r0 = rng(hashStr("base:" + id));
      for (i = 0; i < n; i++) {
        t = (i * 1000) / SAMPLE_HZ;
        if (id === "afib") {
          out[i] = 0.06 * Math.sin(2 * Math.PI * t / 170 + r0() * 0.6) +
            0.05 * Math.sin(2 * Math.PI * t / 97) + 0.02 * (r0() - 0.5);
        } else if (id === "flutter") {
          var ph = (t % 200) / 200;
          out[i] = ph < 0.5 ? -0.18 + 0.36 * (ph * 2) : 0.18 - 0.36 * ((ph - 0.5) * 2);
          out[i] *= 0.8;
        } else if (id === "vfib") {
          out[i] = 0.55 * Math.sin(2 * Math.PI * t / 330 + 1.3 * Math.sin(2 * Math.PI * t / 121)) +
            0.3 * Math.sin(2 * Math.PI * t / 190 + 0.7) + 0.08 * (r0() - 0.5);
        }
      }
    }
    /* P waves. */
    if (d.hasP || id === "mobitz1" || id === "mobitz2" || id === "third-degree" || id === "flutter") {
      for (qi = 0; qi < d.pTimes.length; qi++) {
        var pt = d.pTimes[qi];
        if (id === "flutter") continue; /* flutter baseline already drawn */
        var p0 = Math.round((pt * SAMPLE_HZ) / 1000) - 40, p1 = p0 + 80;
        for (i = Math.max(0, p0); i < Math.min(n, p1); i++) {
          t = (i * 1000) / SAMPLE_HZ;
          out[i] += gauss(t, pt, 16, 0.14);
        }
      }
    }
    /* QRS + T. */
    for (qi = 0; qi < d.qrsTimes.length; qi++) {
      var qt = d.qrsTimes[qi];
      var amp = 1.0;
      if (id === "torsades") {
        /* Spindle: amplitude waxes and wanes and flips polarity across the strip. */
        amp = Math.sin((2 * Math.PI * qt) / 4200) * 1.1;
        if (Math.abs(amp) < 0.15) amp = amp < 0 ? -0.15 : 0.15;
      }
      var c0 = Math.round((qt * SAMPLE_HZ) / 1000) - 60, c1 = c0 + 130;
      for (i = Math.max(0, c0); i < Math.min(n, c1); i++) {
        t = (i * 1000) / SAMPLE_HZ;
        if (wide) {
          v = gauss(t, qt - 22, 22, -0.25 * amp) + gauss(t, qt + 12, qw, 1.15 * amp) +
            gauss(t, qt + 48, 24, -0.35 * amp);
        } else {
          v = gauss(t, qt - 12, 7, -0.12 * amp) + gauss(t, qt, qw, 1.0 * amp * qrsScale) +
            gauss(t, qt + 12, 7, -0.22 * amp);
        }
        /* T wave. */
        v += gauss(t, qt + (wide ? 300 : 240), wide ? 42 : 34, 0.28 * (amp < 0 ? -1 : 1));
        out[i] += v;
      }
      /* ST segment offset (territory elevation or reciprocal depression). */
      if (stElev) {
        var s0 = Math.round(((qt + 60) * SAMPLE_HZ) / 1000), s1 = Math.round(((qt + 200) * SAMPLE_HZ) / 1000);
        for (i = Math.max(0, s0); i < Math.min(n, s1); i++) out[i] += stElev;
      }
      void r;
    }
    return { hz: SAMPLE_HZ, seconds: STRIP_S, data: out, desc: d };
  }

  /* ---- SVG builders: grid + trace. Pure string output, no DOM. ---- */
  function gridInner(wMm, hMm) {
    var minor = "", major = "", x, y;
    for (x = 0; x <= wMm; x += 1) {
      var lx = '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + hMm + '"/>';
      if (x % 5 === 0) major += lx; else minor += lx;
    }
    for (y = 0; y <= hMm; y += 1) {
      var ly = '<line x1="0" y1="' + y + '" x2="' + wMm + '" y2="' + y + '"/>';
      if (y % 5 === 0) major += ly; else minor += ly;
    }
    return '<g class="cbecg-grid-minor">' + minor + '</g><g class="cbecg-grid-major">' + major + "</g>";
  }

  /* Trace path for a rhythm strip: width wMm at 25 mm/s, height hMm, baseline centred. */
  function stripPath(id, wMm, opts) {
    opts = opts || {};
    var smp = sample(id, opts);
    var secs = Math.min(STRIP_S, wMm / MM_PER_S);
    var n = Math.floor(secs * SAMPLE_HZ);
    var hMm = opts.heightMm || 30;
    var base = hMm / 2, d = "", i, x, y, v;
    for (i = 0; i < n; i++) {
      x = (i / SAMPLE_HZ) * MM_PER_S;
      v = smp.data[i];
      if (v > 2.5) v = 2.5; if (v < -2.5) v = -2.5;
      y = base - v * MM_PER_MV;
      d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2);
    }
    return d;
  }

  function stripSvg(id, wMm, opts) {
    opts = opts || {};
    var hMm = opts.heightMm || 30;
    var label = opts.label == null ? true : opts.label;
    var d = stripPath(id, wMm, opts);
    var s = '<svg class="cbecg-trace" viewBox="0 0 ' + wMm + " " + hMm + '" role="img" aria-label="Schematic strip: ' +
      escH((RHYTHM_BY_ID[id] || {}).name || id) + '"' + (opts.idAttr ? ' id="' + opts.idAttr + '"' : "") + ">" +
      '<rect class="cbecg-grid-bg" x="0" y="0" width="' + wMm + '" height="' + hMm + '"/>' +
      gridInner(wMm, hMm) +
      '<path class="cbecg-ink" d="' + d + '"/>' +
      (label ? '<text class="cbecg-schem" x="' + (wMm - 2) + '" y="' + (hMm - 2) + '">schematic</text>' : "") +
      "</svg>";
    return s;
  }

  /* ---- Schematic 12-lead view: territory ST elevation, reciprocal depression. ----
   * Offsets in mm (1 mm = 0.1 mV). Only the named territory leads elevate. */
  var LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  var LEAD_SETS = {
    normal: { label: "Normal (schematic)", st: {} },
    anterior: { label: "Anterior STEMI (schematic)", st: { V1: 2, V2: 3, V3: 3, V4: 2, "II": -0.5, "III": -0.5, aVF: -0.5 } },
    inferior: { label: "Inferior STEMI (schematic)", st: { II: 2, III: 3, aVF: 2.5, aVL: -1, I: -0.5 } },
    lateral: { label: "Lateral STEMI (schematic)", st: { I: 2, aVL: 2.5, V5: 2, V6: 2, II: -0.5, III: -0.5, aVF: -0.5 } }
  };
  function leadSt(setId, lead) {
    var set = LEAD_SETS[setId];
    if (!set) return 0;
    return set.st[lead] || 0;
  }
  /* One beat per lead cell, drawn from the sinus model with the lead ST offset. */
  function leadSvg(setId, lead) {
    var offMm = leadSt(setId, lead);
    var smp = sample("sinus", { stElev: offMm / 10 });
    var hMm = 22, base = 12, x0 = 2, beatMs = 830;
    var i0 = Math.round((0.4 * SAMPLE_HZ)), i1 = Math.round(((0.4 + beatMs / 1000) * SAMPLE_HZ));
    var wMm = (beatMs / 1000) * MM_PER_S + 4;
    var d = "";
    for (var i = i0; i < i1; i++) {
      var x = x0 + ((i - i0) / SAMPLE_HZ) * MM_PER_S;
      var v = smp.data[i];
      if (v > 2.5) v = 2.5; if (v < -2.5) v = -2.5;
      d += (i === i0 ? "M" : "L") + x.toFixed(2) + " " + (base - v * MM_PER_MV).toFixed(2);
    }
    var cls = offMm > 0 ? "cbecg-st-up" : (offMm < 0 ? "cbecg-st-dn" : "");
    return '<svg class="cbecg-lead" viewBox="0 0 ' + wMm.toFixed(1) + " " + hMm + '" role="img" aria-label="Lead ' + lead + '">' +
      '<rect class="cbecg-grid-bg" x="0" y="0" width="' + wMm.toFixed(1) + '" height="' + hMm + '"/>' +
      gridInner(Math.ceil(wMm), hMm) +
      '<path class="cbecg-ink ' + cls + '" d="' + d + '"/>' +
      '<text class="cbecg-lead-lbl" x="2" y="6">' + lead + "</text></svg>";
  }

  /* ---- Six-step reading course. Each step: title, body, diagram rhythm, takeaway. ---- */
  var STEPS = [
    { id: "rate", title: "1. Rate", rhythm: "sinus-tach",
      body: "Count large squares between two QRS complexes. At 25 mm per second each large square is 200 ms, so 300 divided by the number of large squares gives the rate per minute.",
      takeaway: "Rate is 300 divided by large squares between beats." },
    { id: "regularity", title: "2. Rhythm regularity", rhythm: "afib",
      body: "March the QRS complexes out. Regular intervals suggest sinus rhythm, SVT or VT. Irregularly irregular with no P waves suggests atrial fibrillation.",
      takeaway: "Regular or irregular comes before naming the rhythm." },
    { id: "pwaves", title: "3. P waves", rhythm: "sinus",
      body: "Look for a P wave before every QRS. Present and uniform means the atria drive the rhythm. Absent P waves with an irregular baseline suggest atrial fibrillation; sawtooth waves suggest flutter.",
      takeaway: "Every QRS should be able to account for its P wave." },
    { id: "pr", title: "4. PR interval", rhythm: "mobitz1",
      body: "Normal PR is 120 to 200 ms (3 to 5 small squares). Longer with every beat then a dropped QRS is Mobitz I. A sudden dropped QRS with a fixed PR is Mobitz II.",
      takeaway: "A lengthening PR before a dropped beat is Wenckebach." },
    { id: "qrs", title: "5. QRS width", rhythm: "vt",
      body: "Narrow (under 120 ms) means the beat came down the normal conduction path. Wide means ventricular origin or aberrant conduction until proven otherwise.",
      takeaway: "Wide and fast is ventricular tachycardia until proven otherwise." },
    { id: "stt", title: "6. ST segment and T wave", rhythm: "sinus",
      body: "Compare the ST segment with the baseline. Elevation in a coronary territory with reciprocal depression elsewhere suggests STEMI. This course uses schematic drawings only.",
      takeaway: "ST changes are read by territory, never from one lead alone." }
  ];

  /* ---- Quiz bank: 14 questions, one per rhythm. ---- */
  var QUIZ = [
    { rhythm: "afib", q: "Irregularly irregular narrow complexes with no P waves. Which rhythm?",
      choices: ["Atrial fibrillation", "Sinus tachycardia", "Mobitz II", "Ventricular tachycardia"], a: 0 },
    { rhythm: "vfib", q: "Chaotic baseline with no QRS complexes in arrest. Which category?",
      choices: ["Shockable", "Non-shockable", "Pulse present", "Normal variant"], a: 0 },
    { rhythm: "asystole", q: "Near-flat baseline with no complexes in arrest. Which category?",
      choices: ["Non-shockable", "Shockable", "Pulse present", "Normal variant"], a: 0 },
    { rhythm: "vt", q: "Regular wide-complex tachycardia near 170 per min. What is it until proven otherwise?",
      choices: ["Ventricular tachycardia", "Sinus tachycardia", "Atrial flutter", "First-degree block"], a: 0 },
    { rhythm: "mobitz1", q: "PR lengthens with each beat, then a QRS is dropped. Which block?",
      choices: ["Mobitz I (Wenckebach)", "Mobitz II", "Third-degree block", "First-degree block"], a: 0 },
    { rhythm: "mobitz2", q: "Fixed PR with a sudden dropped QRS. Which block?",
      choices: ["Mobitz II", "Mobitz I (Wenckebach)", "Sinus bradycardia", "Atrial fibrillation"], a: 0 },
    { rhythm: "first-degree", q: "Every P wave conducts but the PR exceeds 200 ms. Which block?",
      choices: ["First-degree AV block", "Mobitz I", "Third-degree block", "Atrial flutter"], a: 0 },
    { rhythm: "third-degree", q: "P waves and QRS complexes fully dissociated with a slow escape rhythm. Which block?",
      choices: ["Third-degree (complete) block", "First-degree block", "Mobitz I", "SVT"], a: 0 },
    { rhythm: "flutter", q: "Sawtooth atrial waves near 300 per min with 2:1 conduction. Which rhythm?",
      choices: ["Atrial flutter", "Atrial fibrillation", "Ventricular fibrillation", "Torsades de pointes"], a: 0 },
    { rhythm: "svt", q: "Regular narrow-complex tachycardia near 180 per min with abrupt onset. Which rhythm?",
      choices: ["Supraventricular tachycardia", "Sinus bradycardia", "Ventricular tachycardia", "Asystole"], a: 0 },
    { rhythm: "sinus-brady", q: "Regular rhythm at 45 per min with a P wave before every QRS. Which rhythm?",
      choices: ["Sinus bradycardia", "Sinus tachycardia", "Atrial fibrillation", "Mobitz II"], a: 0 },
    { rhythm: "torsades", q: "Polymorphic QRS twisting around the baseline with waxing amplitude. Which rhythm?",
      choices: ["Torsades de pointes", "Atrial flutter", "SVT", "Sinus rhythm"], a: 0 },
    { rhythm: "sinus-tach", q: "Regular rhythm at 130 per min with a P wave before every QRS. Which rhythm?",
      choices: ["Sinus tachycardia", "Ventricular tachycardia", "Atrial fibrillation", "Third-degree block"], a: 0 },
    { rhythm: "sinus", q: "Normal PR, narrow QRS, regular at 72 per min. Which rhythm?",
      choices: ["Sinus rhythm", "Sinus bradycardia", "Atrial flutter", "Ventricular fibrillation"], a: 0 }
  ];

  function shuffledIdx(n, rand) {
    var a = [], i, j, tmp;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) { j = Math.floor(rand() * (i + 1)); tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  }

  /* buildQuiz(n, seed, misses): misses maps quiz index to miss count; missed
   * questions are drawn first so they repeat (spaced repetition). */
  function buildQuiz(n, seed, misses) {
    var rand = rng(seed == null ? (Date.now() % 2147483647) : seed);
    var order = shuffledIdx(QUIZ.length, rand);
    var missed = [], rest = [], i;
    for (i = 0; i < order.length; i++) {
      if (misses && misses[order[i]] > 0) missed.push(order[i]); else rest.push(order[i]);
    }
    var picked = missed.concat(rest).slice(0, Math.min(n, QUIZ.length));
    /* Shuffle answer choices per question. */
    return picked.map(function (qi) {
      var src = QUIZ[qi];
      var co = shuffledIdx(src.choices.length, rand);
      var nc = co.map(function (k) { return src.choices[k]; });
      return { qi: qi, rhythm: src.rhythm, q: src.q, choices: nc, a: co.indexOf(src.a) };
    });
  }

  function gradeQuiz(qs, answers) {
    var score = 0, i, missed = [];
    for (i = 0; i < qs.length; i++) {
      if (answers[i] === qs[i].a) score++;
      else missed.push(qs[i].qi);
    }
    return { score: score, total: qs.length, missed: missed };
  }

  /* ---- Progress store (localStorage, try/catch). ---- */
  function loadStore() {
    try {
      var raw = G.localStorage && G.localStorage.getItem(STORE_KEY);
      if (!raw) return { courseDone: [], quizBest: 0, misses: {} };
      var s = JSON.parse(raw);
      if (!s || typeof s !== "object") return { courseDone: [], quizBest: 0, misses: {} };
      if (!s.courseDone) s.courseDone = [];
      if (typeof s.quizBest !== "number") s.quizBest = 0;
      if (!s.misses) s.misses = {};
      return s;
    } catch (e) { return { courseDone: [], quizBest: 0, misses: {} }; }
  }
  function saveStore(s) {
    try { if (G.localStorage) G.localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  var DISCLAIMER = "Timer, reminder, documentation and practice aid only. Not a substitute for clinical judgement, formal resuscitation training or your institution's protocol.";
  var EDU_NOTE = "Education only. Schematic drawings, never real traces. This course says nothing about your own ECG.";

  /* ============================ UI (browser only) ============================ */
  var root = null, state = null;

  function isOpen() { return !!(root && root.parentNode); }

  function open(opts) {
    if (typeof document === "undefined") return false;
    if (isOpen()) return true;
    state = { tab: "course", step: 0, rhythm: "sinus", leadSet: "anterior",
      quiz: null, answers: [], card: 0, revealed: false, cal: false,
      store: loadStore(), seed: (opts && opts.seed) || 7 };
    root = document.createElement("div");
    root.className = "cbecg";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "ECG rhythm course");
    render();
    document.body.appendChild(root);
    var c = root.querySelector("[data-cbecg-close]");
    if (c) c.focus();
    return true;
  }

  function close() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null; state = null;
  }

  function rhythmMeta(id) { return RHYTHM_BY_ID[id] || RHYTHMS[0]; }

  function tabBar() {
    var tabs = [["course", "Course"], ["rhythms", "Strips"], ["leads", "12-lead"], ["cards", "Cards"], ["quiz", "Quiz"]];
    return '<div class="cbecg-tabs" role="tablist">' + tabs.map(function (t) {
      return '<button role="tab" aria-selected="' + (state.tab === t[0]) + '" data-cbecg-tab="' + t[0] +
        '" class="cbecg-tab' + (state.tab === t[0] ? " on" : "") + '">' + t[1] + "</button>";
    }).join("") + "</div>";
  }

  function headHtml() {
    return '<div class="cbecg-head"><span class="cbecg-train">TRAINING</span>' +
      '<span class="cbecg-title">ECG rhythm course</span>' +
      '<button class="cbecg-x" data-cbecg-close aria-label="Close ECG course">Close</button></div>' +
      '<p class="cbecg-dis">' + escH(DISCLAIMER) + "</p>" +
      '<p class="cbecg-edu">' + escH(EDU_NOTE) + "</p>";
  }

  function courseHtml() {
    var st = STEPS[state.step], i;
    var dots = STEPS.map(function (s, k) {
      return '<button class="cbecg-dot' + (k === state.step ? " on" : "") +
        (state.store.courseDone.indexOf(s.id) >= 0 ? " done" : "") +
        '" data-cbecg-step="' + k + '" aria-label="Step ' + (k + 1) + ": " + escH(s.title) + '"></button>';
    }).join("");
    return '<div class="cbecg-step">' + stripSvg(st.rhythm, 150, { heightMm: 30 }) +
      "<h2>" + escH(st.title) + "</h2><p>" + escH(st.body) + "</p>" +
      '<p class="cbecg-take">' + escH(st.takeaway) + "</p>" +
      '<div class="cbecg-row"><button class="cbecg-btn" data-cbecg-prev' + (state.step === 0 ? " disabled" : "") + ">Back</button>" +
      '<button class="cbecg-btn pri" data-cbecg-done>Mark done</button>' +
      (state.step < STEPS.length - 1 ? '<button class="cbecg-btn pri" data-cbecg-next>Next</button>'
        : '<button class="cbecg-btn pri" data-cbecg-goto="rhythms">See strips</button>') + "</div>" +
      '<div class="cbecg-dots">' + dots + "</div>" +
      '<p class="cbecg-prog">Step ' + (state.step + 1) + " of " + STEPS.length + ", " +
      state.store.courseDone.length + " marked done.</p></div>";
  }

  function rhythmsHtml() {
    var m = rhythmMeta(state.rhythm);
    var opts = RHYTHMS.map(function (r) {
      return '<option value="' + r.id + '"' + (r.id === state.rhythm ? " selected" : "") + ">" + escH(r.name) + "</option>";
    }).join("");
    return '<label class="cbecg-lbl" for="cbecg-rhy">Rhythm strip (schematic)</label>' +
      '<select id="cbecg-rhy" class="cbecg-sel" data-cbecg-rhythm>' + opts + "</select>" +
      '<div class="cbecg-stripwrap" data-cbecg-stripwrap>' + stripSvg(state.rhythm, 150, { heightMm: 34 }) +
      '<div class="cbecg-cal" data-cbecg-cal hidden>' +
      '<div class="cbecg-line" data-cbecg-l1 tabindex="0" role="slider" aria-label="Caliper line 1" aria-valuemin="0" aria-valuemax="150"></div>' +
      '<div class="cbecg-line" data-cbecg-l2 tabindex="0" role="slider" aria-label="Caliper line 2" aria-valuemin="0" aria-valuemax="150"></div>' +
      "</div></div>" +
      '<div class="cbecg-row"><button class="cbecg-btn" data-cbecg-calbtn aria-pressed="' + state.cal + '">' +
      (state.cal ? "Hide calipers" : "Show calipers") + "</button>" +
      '<span class="cbecg-read" data-cbecg-read role="status"></span></div>' +
      '<dl class="cbecg-meta"><dt>Rate</dt><dd>' + (m.rate ? "about " + m.rate + " per min" : "no complexes") + "</dd>" +
      "<dt>Regularity</dt><dd>" + (m.regular ? "regular" : "irregular") + "</dd>" +
      "<dt>ACLS category</dt><dd>" + escH(CLS_LABEL[m.cls]) + "</dd></dl>" +
      '<ul class="cbecg-feats">' + m.features.map(function (f) { return "<li>" + escH(f) + "</li>"; }).join("") + "</ul>";
  }

  function leadsHtml() {
    var sets = Object.keys(LEAD_SETS).map(function (k) {
      return '<option value="' + k + '"' + (k === state.leadSet ? " selected" : "") + ">" + escH(LEAD_SETS[k].label) + "</option>";
    }).join("");
    var cells = LEADS.map(function (L) {
      return '<div class="cbecg-cell' + (leadSt(state.leadSet, L) > 0 ? " up" : (leadSt(state.leadSet, L) < 0 ? " dn" : "")) + '">' +
        leadSvg(state.leadSet, L) +
        (leadSt(state.leadSet, L) ? '<span class="cbecg-st">ST ' + (leadSt(state.leadSet, L) > 0 ? "+" : "") + leadSt(state.leadSet, L) + " mm</span>" : "") +
        "</div>";
    }).join("");
    return '<label class="cbecg-lbl" for="cbecg-set">12-lead set (schematic)</label>' +
      '<select id="cbecg-set" class="cbecg-sel" data-cbecg-leadset>' + sets + "</select>" +
      '<div class="cbecg-grid12">' + cells + "</div>" +
      '<p class="cbecg-note">ST elevation is drawn only in the territory leads, with reciprocal depression where standard. Schematic teaching drawings.</p>';
  }

  function cardsHtml() {
    var m = RHYTHMS[state.card % RHYTHMS.length];
    return '<div class="cbecg-flash" data-cbecg-flash tabindex="0" role="button" aria-label="Flashcard. Activate to reveal.">' +
      stripSvg(m.id, 150, { heightMm: 34 }) +
      (state.revealed
        ? '<h2>' + escH(m.name) + '</h2><ul class="cbecg-feats">' +
          m.features.map(function (f) { return "<li>" + escH(f) + "</li>"; }).join("") + "</ul>" +
          '<p class="cbecg-cat">' + escH(CLS_LABEL[m.cls]) + "</p>"
        : '<h2 class="cbecg-q">Which rhythm is this?</h2><p class="cbecg-hint">Tap to reveal.</p>') +
      "</div>" +
      '<div class="cbecg-row"><button class="cbecg-btn" data-cbecg-cardprev>Back</button>' +
      '<span class="cbecg-read">Card ' + ((state.card % RHYTHMS.length) + 1) + " of " + RHYTHMS.length + "</span>" +
      '<button class="cbecg-btn pri" data-cbecg-cardnext>Next</button></div>';
  }

  function quizHtml() {
    if (!state.quiz) {
      return '<p>Ten questions, randomised. Missed questions repeat next time.</p>' +
        (state.store.quizBest ? '<p class="cbecg-note">Best score so far: ' + state.store.quizBest + " of 10.</p>" : "") +
        '<button class="cbecg-btn pri" data-cbecg-start>Start quiz</button>';
    }
    var i, h = "";
    for (i = 0; i < state.quiz.length; i++) {
      (function (qi) {
        var q = state.quiz[qi];
        h += '<fieldset class="cbecg-qset"><legend>' + (qi + 1) + ". " + escH(q.q) + "</legend>" +
          stripSvg(q.rhythm, 150, { heightMm: 26 }) +
          q.choices.map(function (c, k) {
            var mark = state.answers[qi] == null ? "" : (k === q.a ? " ok" : (state.answers[qi] === k ? " bad" : ""));
            return '<label class="cbecg-opt' + mark + '"><input type="radio" name="cbecg-q' + qi + '" value="' + k + '"' +
              (state.answers[qi] === k ? " checked" : "") + (state.answers[qi] != null ? " disabled" : "") + "> " + escH(c) + "</label>";
          }).join("") + "</fieldset>";
      })(i);
    }
    var done = state.answers.length === state.quiz.length && state.answers.every(function (a) { return a != null; });
    if (done) {
      var g = gradeQuiz(state.quiz, state.answers);
      h += '<p class="cbecg-score" role="status">Score: ' + g.score + " of " + g.total + ".</p>" +
        '<div class="cbecg-row"><button class="cbecg-btn pri" data-cbecg-restart>Try again</button></div>';
    }
    return h;
  }

  function render() {
    var body = state.tab === "course" ? courseHtml()
      : state.tab === "rhythms" ? rhythmsHtml()
      : state.tab === "leads" ? leadsHtml()
      : state.tab === "cards" ? cardsHtml() : quizHtml();
    root.innerHTML = '<div class="cbecg-sheet">' + headHtml() + tabBar() +
      '<div class="cbecg-body" role="tabpanel">' + body + "</div></div>";
    wire();
    if (state.tab === "rhythms" && state.cal) calShow();
  }

  /* ---- calipers: two draggable vertical lines, touch and mouse via Pointer Events. ---- */
  function stripScale() {
    var wrap = root.querySelector("[data-cbecg-stripwrap]");
    var svg = wrap && wrap.querySelector("svg");
    if (!wrap || !svg) return null;
    var vb = svg.viewBox.baseVal;
    return { wrap: wrap, pxPerMm: wrap.clientWidth / vb.width, wMm: vb.width };
  }
  function calShow() {
    var cal = root.querySelector("[data-cbecg-cal]");
    if (cal) cal.hidden = false;
    var l1 = root.querySelector("[data-cbecg-l1]"), l2 = root.querySelector("[data-cbecg-l2]");
    if (l1 && !l1.style.left) l1.style.left = "30%";
    if (l2 && !l2.style.left) l2.style.left = "55%";
    calRead();
  }
  function calMm(which) {
    var sc = stripScale();
    var el = root.querySelector(which === 1 ? "[data-cbecg-l1]" : "[data-cbecg-l2]");
    if (!sc || !el) return 0;
    return (parseFloat(el.style.left || "0") / 100) * sc.wMm;
  }
  function calRead() {
    var out = root.querySelector("[data-cbecg-read]");
    if (!out) return;
    if (!state.cal) { out.textContent = ""; return; }
    var ms = Math.abs(calMm(2) - calMm(1)) * (1000 / MM_PER_S);
    var txt = Math.round(ms) + " ms";
    if (ms > 20) txt += "  (" + Math.round(60000 / ms) + " per min)";
    out.textContent = txt;
  }
  function calDrag(el, which) {
    function move(clientX) {
      var sc = stripScale();
      if (!sc) return;
      var r = sc.wrap.getBoundingClientRect();
      var pct = ((clientX - r.left) / r.width) * 100;
      if (pct < 0) pct = 0; if (pct > 100) pct = 100;
      el.style.left = pct + "%";
      el.setAttribute("aria-valuenow", String(Math.round((pct / 100) * sc.wMm)));
      calRead();
    }
    el.addEventListener("pointerdown", function (e) {
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      el.classList.add("grab");
      var mv = function (ev) { move(ev.clientX); };
      var up = function () {
        el.classList.remove("grab");
        el.removeEventListener("pointermove", mv);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      };
      el.addEventListener("pointermove", mv);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      e.preventDefault();
    });
    el.addEventListener("keydown", function (e) {
      var sc = stripScale();
      if (!sc) return;
      var cur = (parseFloat(el.style.left || "0") / 100) * sc.wMm;
      var step = e.shiftKey ? 5 : 1; /* mm */
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        cur += (e.key === "ArrowRight" ? step : -step);
        if (cur < 0) cur = 0; if (cur > sc.wMm) cur = sc.wMm;
        el.style.left = (cur / sc.wMm * 100) + "%";
        calRead();
        e.preventDefault();
      }
      void which;
    });
  }

  function wire() {
    function on(sel, ev, fn) {
      var els = root.querySelectorAll(sel), i;
      for (i = 0; i < els.length; i++) (function (el) { el.addEventListener(ev, fn); })(els[i]);
    }
    on("[data-cbecg-close]", "click", close);
    on("[data-cbecg-tab]", "click", function (e) {
      state.tab = e.currentTarget.getAttribute("data-cbecg-tab"); render();
    });
    on("[data-cbecg-step]", "click", function (e) {
      state.step = +e.currentTarget.getAttribute("data-cbecg-step"); render();
    });
    on("[data-cbecg-prev]", "click", function () { if (state.step > 0) { state.step--; render(); } });
    on("[data-cbecg-next]", "click", function () { if (state.step < STEPS.length - 1) { state.step++; render(); } });
    on("[data-cbecg-done]", "click", function () {
      var id = STEPS[state.step].id;
      if (state.store.courseDone.indexOf(id) < 0) { state.store.courseDone.push(id); saveStore(state.store); }
      render();
    });
    on("[data-cbecg-goto]", "click", function (e) {
      state.tab = e.currentTarget.getAttribute("data-cbecg-goto"); render();
    });
    on("[data-cbecg-rhythm]", "change", function (e) {
      state.rhythm = e.currentTarget.value; state.cal = false; render();
    });
    on("[data-cbecg-leadset]", "change", function (e) { state.leadSet = e.currentTarget.value; render(); });
    on("[data-cbecg-calbtn]", "click", function () {
      state.cal = !state.cal; render();
    });
    var l1 = root.querySelector("[data-cbecg-l1]"), l2 = root.querySelector("[data-cbecg-l2]");
    if (l1) calDrag(l1, 1);
    if (l2) calDrag(l2, 2);
    on("[data-cbecg-flash]", "click", function () { state.revealed = !state.revealed; render(); });
    on("[data-cbecg-flash]", "keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { state.revealed = !state.revealed; render(); e.preventDefault(); }
    });
    on("[data-cbecg-cardprev]", "click", function () {
      state.card = (state.card + RHYTHMS.length - 1) % RHYTHMS.length; state.revealed = false; render();
    });
    on("[data-cbecg-cardnext]", "click", function () {
      state.card = (state.card + 1) % RHYTHMS.length; state.revealed = false; render();
    });
    on("[data-cbecg-start]", "click", function () {
      state.quiz = buildQuiz(10, (state.seed = (state.seed * 1103515245 + 12345) % 2147483647), state.store.misses);
      state.answers = new Array(state.quiz.length);
      for (var i = 0; i < state.answers.length; i++) state.answers[i] = null;
      render();
    });
    on("[data-cbecg-restart]", "click", function () { state.quiz = null; state.answers = []; render(); });
    var radios = root.querySelectorAll('input[name^="cbecg-q"]'), i;
    for (i = 0; i < radios.length; i++) (function (el) {
      el.addEventListener("change", function () {
        var qi = +el.name.replace("cbecg-q", "");
        state.answers[qi] = +el.value;
        var done = state.answers.length === state.quiz.length &&
          state.answers.every(function (a) { return a != null; });
        if (done) {
          var g = gradeQuiz(state.quiz, state.answers), k;
          for (k = 0; k < g.missed.length; k++) state.store.misses[g.missed[k]] = (state.store.misses[g.missed[k]] || 0) + 1;
          for (k = 0; k < state.quiz.length; k++) {
            if (g.missed.indexOf(state.quiz[k].qi) < 0 && state.store.misses[state.quiz[k].qi]) {
              delete state.store.misses[state.quiz[k].qi];
            }
          }
          if (g.score > state.store.quizBest) state.store.quizBest = g.score;
          saveStore(state.store);
        }
        render();
      });
    })(radios[i]);
    root.onkeydown = function (e) { if (e.key === "Escape") close(); };
  }

  var API = {
    open: open, close: close, isOpen: isOpen,
    RHYTHMS: RHYTHMS, STEPS: STEPS, QUIZ: QUIZ, LEADS: LEADS, LEAD_SETS: LEAD_SETS,
    CLS_LABEL: CLS_LABEL, MM_PER_S: MM_PER_S, MM_PER_MV: MM_PER_MV,
    SAMPLE_HZ: SAMPLE_HZ, STRIP_S: STRIP_S, STORE_KEY: STORE_KEY,
    DISCLAIMER: DISCLAIMER, EDU_NOTE: EDU_NOTE,
    describe: describe, sample: sample, stripPath: stripPath, stripSvg: stripSvg,
    gridInner: gridInner, leadSt: leadSt, leadSvg: leadSvg,
    buildQuiz: buildQuiz, gradeQuiz: gradeQuiz,
    loadStore: loadStore, saveStore: saveStore
  };
  if (typeof module !== "undefined" && module.exports && !(G && G.document)) { module.exports = API; return; }
  G.CodeBlueECG = API;
})(typeof window !== "undefined" ? window : this);
