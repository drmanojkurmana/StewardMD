/* icu-autoscores.js — pure adapters mapping ICU_STATE -> calculator inputs,
   then computing via window.MEDCALC. Exposes window.ICU_AUTOSCORES.
   No DOM. Every score computes only when its required inputs exist; otherwise
   the adapter returns {__missing:[...]} so the UI can grey it out.
   Units: ICU stores conventional (creatinine/urea/glucose/bilirubin mg/dL,
   albumin g/dL, Na/K/Cl/HCO3 mEq/L, platelets/WBC x10^9/L, PaO2 mmHg).
   BISAP BUN = urea(mg/dL) / 2.14. */
(function () {
  "use strict";

  function last(a) { return (a && a.length) ? a[a.length - 1] : {}; }
  function num(x) { return (typeof x === "number" && isFinite(x)) ? x : null; }
  function has(x) { return x !== null && x !== undefined && x !== "" && !(typeof x === "number" && isNaN(x)); }
  function L(state) { return (state.labs && state.labs.recent) || {}; }
  // Forward-filled current-vitals snapshot: newest non-null value per field across the series, so a sparse
  // re-charting of one vital does not blank the other score inputs and grey out SOFA/qSOFA/NEWS2/APACHE
  // (mirrors icu.js mergedVitals / R1 C1). Raw vitals[] remains available for trends.
  function V(state) {
    var arr = state && state.vitals;
    if (!arr || !arr.length) return {};
    var rows = arr.slice().sort(function (a, b) { return ((a && a.ts) || 0) - ((b && b.ts) || 0); });
    var m = {};
    for (var i = 0; i < rows.length; i++) { var v = rows[i]; if (!v) continue; for (var k in v) { if (k === "ts" || !Object.prototype.hasOwnProperty.call(v, k)) continue; if (v[k] != null && v[k] !== "") m[k] = v[k]; } }
    return m;
  }

  /* ---- banding helpers (encode published thresholds; verified by tests) ---- */
  function sofaPlt(p) { return p >= 150 ? 0 : p >= 100 ? 1 : p >= 50 ? 2 : p >= 20 ? 3 : 4; }
  function sofaBili(b) { return b < 1.2 ? 0 : b < 2.0 ? 1 : b < 6.0 ? 2 : b < 12.0 ? 3 : 4; }
  function sofaCreat(c) { return c < 1.2 ? 0 : c < 2.0 ? 1 : c < 3.5 ? 2 : c < 5.0 ? 3 : 4; }
  function sofaGcs(g) { return g >= 15 ? 0 : g >= 13 ? 1 : g >= 10 ? 2 : g >= 6 ? 3 : 4; }
  function sofaResp(pf, vent) { /* pf in mmHg; support = ventilated */
    if (pf >= 400) return 0; if (pf >= 300) return 1;
    if (pf >= 200) return 2; if (pf >= 100) return vent ? 3 : 2; return vent ? 4 : 2;
  }
  function sofaCardio(state) {
    var v = V(state), map = num(v.map);
    var dop = 0, dob = 0, epi = 0, nor = 0, inf = state.infusions || [];
    inf.forEach(function (i) {
      var n = (i.name || i.drug || "").toLowerCase(), d = num(i.rate != null ? i.rate : i.dose) || 0;
      if (/dopamine/.test(n)) dop = Math.max(dop, d);
      if (/dobutamine/.test(n)) dob = Math.max(dob, d);
      if (/(epinephrine|adrenaline)/.test(n) && !/nor/.test(n)) epi = Math.max(epi, d);
      if (/(norepinephrine|noradrenaline)/.test(n)) nor = Math.max(nor, d);
    });
    if (dop > 15 || epi > 0.1 || nor > 0.1) return 4;
    if (dop > 5 || (epi > 0 && epi <= 0.1) || (nor > 0 && nor <= 0.1)) return 3;
    if ((dop > 0 && dop <= 5) || dob > 0) return 2;
    if (map !== null && map < 70) return 1;
    return 0;
  }
  function sirsCount(state) {
    var v = V(state), l = L(state), n = 0;
    if (has(v.temp) && (v.temp > 38 || v.temp < 36)) n++;
    if (has(v.hr) && v.hr > 90) n++;
    if (has(v.rr) && v.rr > 20) n++;
    if (has(l.wbc) && (l.wbc > 12 || l.wbc < 4)) n++;
    return n;
  }

  /* ---- APACHE II per-variable bands: return the EXACT select option value (incl b-suffix)
     so a pre-filled calculator selects the right band; the calc's P() collapses b for scoring ---- */
  function apTemp(t) { return t >= 41 ? "4" : t >= 39 ? "3" : t >= 38.5 ? "1" : t >= 36 ? "0" : t >= 34 ? "1b" : t >= 32 ? "2" : t >= 30 ? "3b" : "4b"; }
  function apMap(m) { return m >= 160 ? "4" : m >= 130 ? "3" : m >= 110 ? "2" : m >= 70 ? "0" : m >= 50 ? "2b" : "4b"; }
  function apHr(h) { return h >= 180 ? "4" : h >= 140 ? "3" : h >= 110 ? "2" : h >= 70 ? "0" : h >= 55 ? "2b" : h >= 40 ? "3b" : "4b"; }
  function apRr(r) { return r >= 50 ? "4" : r >= 35 ? "3" : r >= 25 ? "1" : r >= 12 ? "0" : r >= 10 ? "1b" : r >= 6 ? "2" : "4b"; }
  function apPh(p) { return p >= 7.7 ? "4" : p >= 7.6 ? "3" : p >= 7.5 ? "1" : p >= 7.33 ? "0" : p >= 7.25 ? "2" : p >= 7.15 ? "3b" : "4b"; }
  function apNa(n) { return n >= 180 ? "4" : n >= 160 ? "3" : n >= 155 ? "2" : n >= 150 ? "1" : n >= 130 ? "0" : n >= 120 ? "2b" : n >= 111 ? "3b" : "4b"; }
  function apK(k) { return k >= 7 ? "4" : k >= 6 ? "3" : k >= 5.5 ? "1" : k >= 3.5 ? "0" : k >= 3 ? "1b" : k >= 2.5 ? "2" : "4b"; }
  function apCr(c) { return c >= 3.5 ? "4" : c >= 2 ? "3" : c >= 1.5 ? "2" : c >= 0.6 ? "0" : "2b"; }
  function apHct(h) { return h >= 60 ? "4" : h >= 50 ? "2" : h >= 46 ? "1" : h >= 30 ? "0" : h >= 20 ? "2b" : "4b"; }
  function apWbc(w) { return w >= 40 ? "4" : w >= 20 ? "2" : w >= 15 ? "1" : w >= 3 ? "0" : w >= 1 ? "2b" : "4b"; }
  function apAge(a) { return a >= 75 ? 6 : a >= 65 ? 5 : a >= 55 ? 3 : a >= 45 ? 2 : 0; }
  function apOxy(fio2, pao2, paco2) { /* fio2 as fraction; oxy option values are unique 0..4 */
    if (fio2 >= 0.5) { var aa = fio2 * 713 - paco2 / 0.8 - pao2; return aa < 200 ? "0" : aa < 350 ? "2" : aa < 500 ? "3" : "4"; }
    return pao2 > 70 ? "0" : pao2 >= 61 ? "1" : pao2 >= 55 ? "3" : "4";
  }

  /* ---- Child-Pugh clinical-grade detection from recorded findings/diagnosis (conservative;
     never fabricates a grade — returns null when ungraded → row stays "needs") ---- */
  function textBlob(s) {
    var parts = [];
    if (s.patient && s.patient.diagnosis) parts.push(s.patient.diagnosis);
    (s.findings || []).forEach(function (f) { if (f.polarity !== "absent") parts.push(f.displayLabel || f.canonicalFindingId || ""); });
    (s.imaging || []).forEach(function (im) { parts.push((im.impressionRaw || "") + " " + (im.findingsRaw || "")); });
    return parts.join(" | ").toLowerCase();
  }
  function absentIn(s, re) {
    return (s.findings || []).some(function (f) { return f.polarity === "absent" && re.test((f.displayLabel || f.canonicalFindingId || "").toLowerCase()); });
  }
  function cpAscites(s) {
    var t = textBlob(s);
    if (absentIn(s, /ascites/) || /\bno ascites\b|without ascites|absence of ascites|resolved ascites/.test(t)) return "1";
    if (!/ascites/.test(t)) return null;
    if (/moderate|severe|tense|large|gross|refractory/.test(t)) return "3";
    if (/mild|minimal|trace|small|controlled|diuretic/.test(t)) return "2";
    return null;
  }
  function cpEnceph(s) {
    var t = textBlob(s);
    if (absentIn(s, /encephalopath/) || /\bno (hepatic )?encephalopath|without encephalopath/.test(t)) return "1";
    if (!/encephalopath/.test(t)) return null;
    if (/grade\s*(iii|iv|3|4)|stupor|coma|west[- ]?haven\s*[34]/.test(t)) return "3";
    if (/grade\s*(i|ii|1|2)|mild|asterixis|west[- ]?haven\s*[12]|drowsy/.test(t)) return "2";
    return null;
  }

  var DEFS = [
    {
      id: "qsofa", label: "qSOFA", always: true, adapt: function (s) {
        var v = V(s), m = [];
        if (!has(v.rr)) m.push("RR"); if (!has(v.sbp)) m.push("SBP"); if (!has(v.gcs)) m.push("GCS");
        if (m.length) return { __missing: m };
        return { rr: v.rr >= 22, ams: v.gcs < 15, sbp: v.sbp <= 100 };
      }
    },
    {
      id: "news2", label: "NEWS2", always: true, adapt: function (s) {
        var v = V(s), vent = s.ventilator || {}, m = [];
        ["rr", "spo2", "temp", "sbp", "hr"].forEach(function (k) { if (!has(v[k])) m.push(k.toUpperCase()); });
        if (!has(v.gcs)) m.push("GCS");
        if (m.length) return { __missing: m };
        return { rr: v.rr, spo2: v.spo2, o2: (num(vent.fio2) || 0) > 0.21, temp: v.temp, sbp: v.sbp, hr: v.hr, acvpu: (v.gcs < 15 ? "x" : "a") };
      }
    },
    {
      id: "sofa", label: "SOFA", always: true, adapt: function (s) {
        var v = V(s), l = L(s), a = s.abg || {}, vent = s.ventilator || {}, m = [];
        if (!has(l.plt)) m.push("platelets"); if (!has(l.bili)) m.push("bilirubin");
        if (!has(l.creat)) m.push("creatinine"); if (!has(v.gcs)) m.push("GCS");
        if (!(has(a.pao2) && has(a.fio2))) m.push("PaO₂/FiO₂"); if (!has(v.map)) m.push("MAP");
        if (m.length) return { __missing: m };
        var pf = a.pao2 / (a.fio2 > 1 ? a.fio2 / 100 : a.fio2);
        return {
          resp: sofaResp(pf, (num(vent.peep) || 0) > 0 || (num(vent.fio2) || 0) > 0.21),
          coag: sofaPlt(l.plt), liver: sofaBili(l.bili), cardio: sofaCardio(s),
          cns: sofaGcs(v.gcs), renal: sofaCreat(l.creat)
        };
      }
    },
    {
      id: "anion_gap", label: "Anion gap", always: true, adapt: function (s) {
        var l = L(s), m = [];["na", "cl", "hco3"].forEach(function (k) { if (!has(l[k])) m.push(k.toUpperCase()); });
        if (m.length) return { __missing: m };
        return { na: l.na, cl: l.cl, hco3: l.hco3, alb: has(l.alb) ? l.alb : 4 };
      }
    },
    {
      id: "corr_na", label: "Corrected sodium (for glucose)", always: true, adapt: function (s) {
        var l = L(s), m = []; if (!has(l.na)) m.push("Na"); if (!has(l.glu)) m.push("glucose");
        if (m.length) return { __missing: m };
        return { na: l.na, glu: l.glu };
      }
    },
    {
      id: "pf_ratio", label: "PaO₂/FiO₂", always: true, adapt: function (s) {
        var a = s.abg || {}, m = []; if (!has(a.pao2)) m.push("PaO₂"); if (!has(a.fio2)) m.push("FiO₂");
        if (m.length) return { __missing: m };
        return { pao2: a.pao2, fio2: (a.fio2 > 1 ? a.fio2 : a.fio2 * 100) };
      }
    },
    {
      id: "corr_ca", label: "Corrected calcium", always: true, adapt: function (s) {
        var l = L(s), m = []; if (!has(l.ca)) m.push("calcium"); if (!has(l.alb)) m.push("albumin");
        if (m.length) return { __missing: m };
        return { ca: l.ca, alb: l.alb };
      }
    },
    {
      id: "bisap", label: "BISAP (pancreatitis)", dx: /pancreatit/i, adapt: function (s) {
        var v = V(s), l = L(s), age = s.patient && s.patient.age, m = [];
        if (!has(l.urea)) m.push("urea"); if (!has(age)) m.push("age"); if (!has(v.gcs)) m.push("GCS");
        if (m.length) return { __missing: m };
        var eff = false, im = (s.imaging || s.findings || []);
        try { eff = JSON.stringify(im).toLowerCase().indexOf("effusion") >= 0; } catch (e) {}
        return { bun: l.urea / 2.14, ams: v.gcs < 15, sirs: sirsCount(s) >= 2, age: age, eff: eff };
      }
    },
    {
      id: "meld", label: "MELD / MELD-Na", dx: /cirrhosis|hepat|liver|variceal|ascites/i, adapt: function (s) {
        var l = L(s), m = [];["bili", "inr", "creat"].forEach(function (k) { if (!has(l[k])) m.push(k); });
        if (m.length) return { __missing: m };
        return { bili: l.bili, inr: l.inr, cr: l.creat, na: has(l.na) ? l.na : 140, dial: false };
      }
    },
    {
      id: "fib4", label: "FIB-4 (liver fibrosis)", dx: /cirrhosis|hepat|liver|fibrosis|nafld|nash|fatty liver|steato/i, adapt: function (s) {
        var l = L(s), age = s.patient && s.patient.age, m = [];
        if (!has(age)) m.push("age"); if (!has(l.ast)) m.push("AST"); if (!has(l.alt)) m.push("ALT"); if (!has(l.plt)) m.push("platelets");
        if (m.length) return { __missing: m };
        return { age: age, ast: l.ast, alt: l.alt, plt: l.plt };
      }
    },
    {
      id: "childpugh", label: "Child-Pugh", dx: /cirrhosis|hepat|liver|variceal|ascites/i, adapt: function (s) {
        var l = L(s), m = [];
        if (!has(l.bili)) m.push("bilirubin"); if (!has(l.alb)) m.push("albumin"); if (!has(l.inr)) m.push("INR");
        var asc = cpAscites(s), enc = cpEnceph(s);
        if (!asc) m.push("ascites grade"); if (!enc) m.push("encephalopathy grade");
        if (m.length) return { __missing: m };
        return {
          bili: l.bili < 2 ? "1" : l.bili <= 3 ? "2" : "3",
          alb: l.alb > 3.5 ? "1" : l.alb >= 2.8 ? "2" : "3",
          inr: l.inr < 1.7 ? "1" : l.inr <= 2.3 ? "2" : "3",
          ascites: asc, enceph: enc
        };
      }
    },
    {
      id: "apache2", label: "APACHE II", always: true,
      note: "Assumes no chronic organ insufficiency and no acute renal failure — set these in the full calculator.",
      adapt: function (s) {
        var v = V(s), l = L(s), a = s.abg || {}, age = s.patient && s.patient.age, m = [];
        if (!has(v.temp)) m.push("temp"); if (!has(v.map)) m.push("MAP"); if (!has(v.hr)) m.push("HR"); if (!has(v.rr)) m.push("RR");
        if (!has(v.gcs)) m.push("GCS"); if (!has(a.ph)) m.push("pH"); if (!has(a.pao2)) m.push("PaO₂"); if (!has(a.fio2)) m.push("FiO₂");
        if (has(a.fio2) && (a.fio2 > 1 ? a.fio2 / 100 : a.fio2) >= 0.5 && !has(a.paco2)) m.push("PaCO₂");
        if (!has(l.na)) m.push("Na"); if (!has(l.k)) m.push("K"); if (!has(l.creat)) m.push("creatinine");
        if (!has(l.hct)) m.push("haematocrit"); if (!has(l.wbc)) m.push("WBC"); if (!has(age)) m.push("age");
        if (m.length) return { __missing: m.length > 5 ? ["a full physiology panel (ABG, electrolytes, CBC, vitals, GCS, age)"] : m };
        var fio2 = a.fio2 > 1 ? a.fio2 / 100 : a.fio2;
        return {
          temp: apTemp(v.temp), map: apMap(v.map), hr: apHr(v.hr), rr: apRr(v.rr),
          oxy: apOxy(fio2, a.pao2, a.paco2), ph: apPh(a.ph), na: apNa(l.na), k: apK(l.k),
          cr: apCr(l.creat), arf: false, hct: apHct(l.hct), wbc: apWbc(l.wbc),
          gcs: v.gcs, age: String(apAge(age)), chronic: "0"
        };
      }
    }
  ];

  function compute(state, medcalc) {
    medcalc = medcalc || window.MEDCALC;
    var byId = {}; ((medcalc && medcalc._calcs) || []).forEach(function (c) { byId[c.id] = c; });
    var dx = (state.patient && state.patient.diagnosis) || "";
    var out = [];
    DEFS.forEach(function (def) {
      if (!def.always) { if (!def.dx || !def.dx.test(dx)) return; }
      var c = byId[def.id]; if (!c) return;
      var v = def.adapt(state);
      if (v && v.__missing) { out.push({ id: def.id, label: def.label, missing: v.__missing }); return; }
      var r; try { r = c.compute(v); } catch (e) { return; }
      if (!r || r.err) { out.push({ id: def.id, label: def.label, missing: ["valid inputs"] }); return; }
      out.push({ id: def.id, label: def.label, value: r.v, unit: r.u || "", interp: (r.i || "") + (def.note ? " " + def.note : ""), used: Object.keys(v), inputs: v });
    });
    return out;
  }

  window.ICU_AUTOSCORES = { DEFS: DEFS, compute: compute };
})();
