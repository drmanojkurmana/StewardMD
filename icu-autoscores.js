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
  function V(state) { return last(state.vitals); }

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
      id: "childpugh", label: "Child-Pugh", dx: /cirrhosis|hepat|liver|variceal|ascites/i, adapt: function () {
        /* ascites + encephalopathy are clinical, not lab -> always needs */
        return { __missing: ["ascites grade", "encephalopathy grade"] };
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
      out.push({ id: def.id, label: def.label, value: r.v, unit: r.u || "", interp: r.i || "", used: Object.keys(v) });
    });
    return out;
  }

  window.ICU_AUTOSCORES = { DEFS: DEFS, compute: compute };
})();
