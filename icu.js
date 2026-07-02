/* StewardMD — ICU Dashboard 3.0 (Critical Care Workstation)
 *
 * PHASE 1: the single unified ICU dashboard shell + the reactive ICU_STATE data
 * layer that is the SINGLE SOURCE OF TRUTH for every ICU module.
 *
 *   • window.ICU_STATE — one structured patient object. It is a deep reactive
 *     Proxy: any write (manual entry, an ingest*() importer, or a FUTURE
 *     Gemini/OpenAI Vision module simply assigning fields) re-derives alerts,
 *     persists, and re-renders the dashboard. No module owns its own copy of the
 *     data; every tab reads from / writes to ICU_STATE.
 *   • window.ICU — controller: open/close, ingest* importers (the AI contract),
 *     update(), subscribe().
 *
 * This module does NOT edit minified app.js. It REUSES existing engines via
 * their public API (ELYTE.open, INF.open/openProtocols/openDrug, MEDCALC.open)
 * — embedded for now, to be re-skinned into tab bodies in a later phase.
 *
 * NO AI / OCR is implemented. The AI Import panel + ICU Snapshot build the
 * architecture only: they route to the same ingest*() functions a future Vision
 * model will call, behind a "AI Ready · Coming Soon" gate.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function nowTs() { return Date.now(); }
  function num(v) { if (v === "" || v == null) return null; var n = +v; return isFinite(n) ? n : null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function pick(o, keys) { var r = {}; keys.forEach(function (k) { if (o[k] != null && o[k] !== "") r[k] = o[k]; }); return r; }
  function $(sel, root) { return (root || document).querySelector(sel); }

  /* -------------------------------------------------- the data model shape */
  var DEFAULT_STATE = {
    patient: { name: "", age: null, sex: "", weightKg: null, heightCm: null, diagnosis: "", hospital: "", bed: "", icuDay: null, status: "" },
    vitals: [],                 // [{ ts, hr, sbp, dbp, map, rr, spo2, temp, uop, lactate, cvp, etco2 }]
    labs: { recent: {}, trends: [] },  // recent: { na,k,cl,hco3,ca,mg,po4,glu,creat,alb,wbc,hb,plt,inr,ferritin,trig,fibrinogen,... }
    abg: {},                    // { ts, ph, paco2, pao2, hco3, fio2, lactate, be }
    ventilator: {},             // { mode, fio2, peep, tv, rr, peak, plateau, drivingP, compliance, pf }
    fluids: { intake24h: null, output24h: null, urine24h: null, drains: null, net24h: null, cumulative: null, strategyPhase: "" },
    infusions: [],              // [{ drug, dose, unit, rateMlHr, indication }]
    goals: [],                  // [string]
    rounds: {},                 // checklist state (Phase 3)
    alerts: [],                 // DERIVED — written by recompute()
    src: {},                    // per-field provenance: { <field>: { source, ts } } source ∈ Ward Sync|Imported report|Manual
    wardSync: { connected: false, lastTs: null, newUpdate: false, patientId: null },
    conflicts: [],              // [{ key, label, ward, manual, wardTs, manualTs }] — clinician resolves
    meta: { updated: null }
  };
  var LS_KEY = "stewardmd_icu_state";

  /* ---------------------------------------------- reactive state (Proxy) */
  // Deep proxy: any nested set/delete schedules a coalesced notify().
  function reactive(target, onChange) {
    if (target === null || typeof target !== "object") return target;
    return new Proxy(target, {
      get: function (o, k) { var v = o[k]; return (typeof v === "object" && v !== null) ? reactive(v, onChange) : v; },
      set: function (o, k, v) { if (o[k] === v) return true; o[k] = v; onChange(); return true; },
      deleteProperty: function (o, k) { delete o[k]; onChange(); return true; }
    });
  }

  var _raw;
  try { _raw = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { _raw = null; }
  if (!_raw || typeof _raw !== "object") _raw = clone(DEFAULT_STATE);
  // backfill any missing top-level keys (forward-compat)
  Object.keys(DEFAULT_STATE).forEach(function (k) { if (_raw[k] == null) _raw[k] = clone(DEFAULT_STATE[k]); });

  var _subs = [], _busy = false, _scheduled = false;
  function notify() {
    _scheduled = false; _busy = true;
    try {
      recompute(_raw);                       // writes _raw.alerts on the RAW object (no re-trigger)
      _raw.meta.updated = nowTs();
      try { localStorage.setItem(LS_KEY, JSON.stringify(_raw)); } catch (e) {}
      for (var i = 0; i < _subs.length; i++) { try { _subs[i](_raw); } catch (e) {} }
    } finally { _busy = false; }
  }
  function onChange() {
    if (_busy || _scheduled) return;
    _scheduled = true;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 0); })(notify);
  }
  // THE single source of truth, exposed for any module / future Vision to read+write.
  var STATE = reactive(_raw, onChange);
  window.ICU_STATE = STATE;

  /* ----------------------------------------------------- derived helpers */
  function mapCalc(sbp, dbp) { return (sbp != null && dbp != null) ? Math.round((+sbp + 2 * +dbp) / 3) : null; }
  function latestVitals() { var v = _raw.vitals; return (v && v.length) ? v[v.length - 1] : {}; }
  function curMap() { var lv = latestVitals(); return lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp); }
  function shockIndex() { var lv = latestVitals(); return (lv.hr && lv.sbp) ? +(lv.hr / lv.sbp).toFixed(2) : null; }

  /* ------------------------------------------ recompute: derive alerts */
  // The seed of the "smart ICU engine": one place that turns raw values into
  // alerts. Runs on EVERY state change, so any tab/importer that updates a value
  // immediately refreshes the Overview + live status. Pure read of `s`, writes
  // s.alerts only.
  function recompute(s) {
    var a = [];
    function add(sev, title, msg, source) { a.push({ severity: sev, title: title, msg: msg, source: source }); }
    var L = (s.labs && s.labs.recent) || {}, lv = (s.vitals && s.vitals.length) ? s.vitals[s.vitals.length - 1] : {}, g = s.abg || {};

    // Potassium
    if (L.k != null) { if (L.k > 6.5) add("crit", "Critical hyperkalemia", "K " + L.k + " mmol/L — ECG + urgent treatment", "Electrolytes"); else if (L.k > 5.5) add("warn", "Hyperkalemia", "K " + L.k + " mmol/L", "Electrolytes"); else if (L.k < 2.5) add("crit", "Critical hypokalemia", "K " + L.k + " mmol/L — replace + monitor ECG", "Electrolytes"); else if (L.k < 3.0) add("warn", "Hypokalemia", "K " + L.k + " mmol/L", "Electrolytes"); }
    // Sodium
    if (L.na != null) { if (L.na > 160 || L.na < 120) add("crit", "Critical sodium", "Na " + L.na + " mmol/L — correct at safe rate", "Electrolytes"); else if (L.na > 150 || L.na < 130) add("warn", "Sodium derangement", "Na " + L.na + " mmol/L", "Electrolytes"); }
    // Ferritin (HLH / hyperinflammation tie-in)
    if (L.ferritin != null && L.ferritin > 10000) add("warn", "Markedly elevated ferritin", "Ferritin " + L.ferritin + " — consider HLH / hyperinflammation", "Labs");
    // Hemodynamics
    var mp = lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp);
    if (mp != null) { if (mp < 60) add("crit", "Hypotension", "MAP " + mp + " mmHg (<60) — resuscitate", "Hemodynamics"); else if (mp < 65) add("warn", "Low MAP", "MAP " + mp + " mmHg (target ≥65)", "Hemodynamics"); }
    if (lv.lactate != null) { if (lv.lactate > 4) add("crit", "Hyperlactataemia", "Lactate " + lv.lactate + " mmol/L (>4) — hypoperfusion", "Hemodynamics"); else if (lv.lactate > 2) add("warn", "Raised lactate", "Lactate " + lv.lactate + " mmol/L", "Hemodynamics"); }
    if (lv.spo2 != null) { if (lv.spo2 < 88) add("crit", "Severe hypoxaemia", "SpO₂ " + lv.spo2 + "%", "Hemodynamics"); else if (lv.spo2 < 92) add("warn", "Hypoxaemia", "SpO₂ " + lv.spo2 + "%", "Hemodynamics"); }
    // UOP (oliguria)
    if (lv.uop != null && s.patient && s.patient.weightKg) { var thr = 0.5 * s.patient.weightKg; if (lv.uop < thr) add("warn", "Oliguria", "UOP " + lv.uop + " mL/h (<0.5 mL/kg/h)", "Fluids"); }
    // ABG
    if (g.ph != null) { if (g.ph < 7.2 || g.ph > 7.55) add("crit", "Severe acid–base disturbance", "pH " + g.ph, "ABG"); else if (g.ph < 7.30 || g.ph > 7.50) add("warn", "Acid–base disturbance", "pH " + g.ph, "ABG"); }
    // Ventilation / ARDS (cross-tab: ABG PaO2 + ventilator FiO2 → P/F)
    var vt = s.ventilator || {}, pf = vt.pf != null ? vt.pf : ((g.pao2 != null && vt.fio2) ? Math.round(g.pao2 / (vt.fio2 / 100)) : null);
    if (pf != null && pf < 300) add(pf < 100 ? "crit" : "warn", "ARDS (P/F " + pf + ")", (pf < 100 ? "Severe" : pf < 200 ? "Moderate" : "Mild") + " ARDS" + (pf < 150 ? " — consider prone positioning" : ""), "Ventilator");

    var order = { crit: 0, warn: 1, info: 2 };
    a.sort(function (x, y) { return (order[x.severity] || 9) - (order[y.severity] || 9); });
    s.alerts = a;
  }
  recompute(_raw);   // initial derive

  /* ----------------------------------------- importer interface (AI contract) */
  // FUTURE Gemini/OpenAI Vision calls these with structured objects extracted
  // from captured images. They write into ICU_STATE → the whole dashboard
  // updates with zero UI changes. Manual-entry forms call them too.
  function ingestMonitor(o) {
    o = o || {}; var v = pick(o, ["hr", "sbp", "dbp", "map", "rr", "spo2", "temp", "uop", "lactate", "cvp", "etco2"]);
    if (v.map == null && v.sbp != null && v.dbp != null) v.map = mapCalc(v.sbp, v.dbp);
    v.ts = o.ts || nowTs();
    STATE.vitals.push(v);
    return v;
  }
  function ingestLabs(o) {
    o = o || {}; var keys = ["na", "k", "cl", "hco3", "ca", "mg", "po4", "glu", "creat", "urea", "alb", "wbc", "hb", "plt", "inr", "ferritin", "trig", "fibrinogen", "crp", "bili", "ast", "alt"];
    var rec = pick(o, keys); var ts = o.ts || nowTs();
    Object.keys(rec).forEach(function (k) { STATE.labs.recent[k] = rec[k]; });
    STATE.labs.trends.push(Object.assign({ ts: ts }, rec));
    return rec;
  }
  function ingestVentilator(o) {
    o = o || {}; var v = pick(o, ["mode", "fio2", "peep", "tv", "rr", "peak", "plateau", "drivingP", "compliance", "pf"]);
    Object.keys(v).forEach(function (k) { STATE.ventilator[k] = v[k]; });
    return v;
  }
  function ingestFlowsheet(o) {
    o = o || {}; var f = pick(o, ["intake24h", "output24h", "urine24h", "drains", "net24h", "cumulative", "strategyPhase"]);
    if (f.net24h == null && f.intake24h != null && f.output24h != null) f.net24h = +f.intake24h - +f.output24h;
    Object.keys(f).forEach(function (k) { STATE.fluids[k] = f[k]; });
    if (o.vitals) ingestMonitor(o.vitals);
    return f;
  }
  function ingestPatient(o) { o = o || {}; Object.keys(o).forEach(function (k) { if (k in STATE.patient) STATE.patient[k] = o[k]; }); }

  /* ---- Ward Sync / imported-report → ICU lab mapping (gold124) ------------
   * Maps free-text HIS/report test names → ICU analyte keys by keyword, with
   * EXCLUSION guards to prevent dangerous mis-files (validated against the live
   * GHIS test vocabulary): "Alkaline Phosphatase" must NOT become phosphate;
   * "Blood Urea Nitrogen (BUN)" is NOT urea (different scale); "Mean corpuscular
   * haemoglobin" is NOT haemoglobin; direct/indirect bilirubin is NOT total. Only
   * numeric results are mapped; anything unmatched is left for clinician entry. */
  var WARD_LAB_MAP = [
    { key: "na", kw: /\bsodium\b|\bserum na\b|(^|[^a-z])na([^a-z]|$)/i, ex: /urin|spot|fractional|excretion/i },
    { key: "k", kw: /\bpotassium\b|\bserum k\b/i, ex: /urin/i },
    { key: "cl", kw: /\bchloride\b/i, ex: /urin/i },
    { key: "hco3", kw: /bicarbonate|\bhco3\b|\btco2\b|carbon dioxide|(^|[^a-z])co2([^a-z]|$)/i, ex: /partial|pco2|paco2/i },
    { key: "ca", kw: /\bcalcium\b/i, ex: /urin|ioni|24/i },   // ionised calcium tracked separately elsewhere
    { key: "mg", kw: /magnesium/i, ex: /urin/i },
    { key: "po4", kw: /phosphate|phosphorus|\bpo4\b/i, ex: /alkaline|phosphatase|creatine/i }, // exclude Alk Phosphatase / CPK
    { key: "glu", kw: /glucose|blood sugar|\brbs\b|\bcbg\b/i, ex: /urin|csf|tolerance|dipsi/i },
    { key: "creat", kw: /creatinine/i, ex: /urin|clearance|ratio/i },
    { key: "urea", kw: /\burea\b/i, ex: /nitrogen|\bbun\b|urin/i },   // BUN ≠ urea (scale differs) — excluded
    { key: "alb", kw: /\balbumin\b/i, ex: /globulin|ratio|urin|micro/i },
    { key: "wbc", kw: /\bwbc\b|leucocyte|leukocyte|total leu|\btlc\b/i, ex: /differential|urin|csf/i },
    { key: "hb", kw: /h[ae]moglobin/i, ex: /corpuscular|\bmch\b|\bmchc\b|a1c|glycated|equivalent|reticulocyte/i },
    { key: "plt", kw: /platelet/i, ex: /immature|fraction/i },
    { key: "inr", kw: /\binr\b|prothrombin|\bpt\b\/inr/i, ex: /aptt|partial/i },
    { key: "bili", kw: /bilirubin/i, ex: /direct|indirect|conjugat|neonat/i },   // total only
    { key: "ast", kw: /\bast\b|sgot/i, ex: null },
    { key: "alt", kw: /\balt\b|sgpt/i, ex: null },
    { key: "crp", kw: /c-reactive|\bcrp\b/i, ex: /procalcitonin/i },
    { key: "lactate", kw: /\blactate\b/i, ex: /dehydrogenase|\bldh\b|csf/i }
  ];
  function mapWardLab(name) {
    var n = String(name || "").toLowerCase();
    for (var i = 0; i < WARD_LAB_MAP.length; i++) {
      var m = WARD_LAB_MAP[i];
      if (m.kw.test(n) && !(m.ex && m.ex.test(n))) return m.key;
    }
    return null;
  }
  // Ingest a normalised Ward-Sync / imported bundle. Conflict-SAFE: never silently
  // overwrites a clinician's Manual value — records a conflict for the clinician to resolve.
  // bundle: { patient?, source?, ts?, labs:[{test,result,units,low,high}], vitals?, abg? }
  function ingestFromWard(bundle) {
    bundle = bundle || {};
    var source = bundle.source || "Ward Sync", ts = bundle.ts || nowTs(), applied = {}, conflicts = [], hadNew = false;
    if (bundle.patient) ingestPatient(bundle.patient);
    var labVals = {};
    (bundle.labs || []).forEach(function (t) {
      var key = mapWardLab(t.test); if (!key) return;
      var v = parseFloat(t.result); if (isNaN(v)) return;
      var prevSrc = STATE.src[key];
      if (prevSrc && prevSrc.source === "Manual" && STATE.labs.recent[key] != null && Number(STATE.labs.recent[key]) !== v) {
        conflicts.push({ key: key, label: t.test, ward: v, manual: STATE.labs.recent[key], wardTs: ts, manualTs: prevSrc.ts, source: source });
        return;  // preserve manual override; surface both for the clinician
      }
      if (STATE.labs.recent[key] == null || Number(STATE.labs.recent[key]) !== v) hadNew = true;
      labVals[key] = v; applied[key] = { source: source, ts: ts };
    });
    // pre-keyed labs (e.g. from OCR vision, which already returns ICU keys) — same
    // conflict-safety as name-mapped labs.
    if (bundle.mapped) Object.keys(bundle.mapped).forEach(function (key) {
      var v = parseFloat(bundle.mapped[key]); if (isNaN(v)) return;
      var prevSrc = STATE.src[key];
      if (prevSrc && prevSrc.source === "Manual" && STATE.labs.recent[key] != null && Number(STATE.labs.recent[key]) !== v) {
        conflicts.push({ key: key, label: key, ward: v, manual: STATE.labs.recent[key], wardTs: ts, manualTs: prevSrc.ts, source: source }); return;
      }
      if (STATE.labs.recent[key] == null || Number(STATE.labs.recent[key]) !== v) hadNew = true;
      labVals[key] = v; applied[key] = { source: source, ts: ts };
    });
    if (Object.keys(labVals).length) ingestLabs(labVals);
    if (bundle.ventilator && Object.keys(bundle.ventilator).length) { ingestVentilator(bundle.ventilator); STATE.src.ventilator = { source: source, ts: ts }; }
    Object.keys(applied).forEach(function (k) { STATE.src[k] = applied[k]; });
    if (bundle.vitals && Object.keys(bundle.vitals).length) { ingestMonitor(bundle.vitals); ["hr", "sbp", "dbp", "map", "rr", "spo2", "temp", "uop", "lactate"].forEach(function (k) { if (bundle.vitals[k] != null) STATE.src[k] = { source: source, ts: ts }; }); }
    if (bundle.abg && Object.keys(bundle.abg).length) { Object.keys(bundle.abg).forEach(function (k) { STATE.abg[k] = bundle.abg[k]; }); STATE.abg.ts = ts; STATE.src.abg = { source: source, ts: ts }; }
    // merge (don't clobber) any newly-detected conflicts
    if (conflicts.length) { STATE.conflicts = (STATE.conflicts || []).filter(function (c) { return !conflicts.some(function (n) { return n.key === c.key; }); }).concat(conflicts); }
    STATE.wardSync = { connected: true, lastTs: ts, patientId: bundle.patientId || (STATE.wardSync && STATE.wardSync.patientId) || null, newUpdate: hadNew && !!(STATE.wardSync && STATE.wardSync.lastTs) };
    return { applied: Object.keys(applied), conflicts: conflicts.length, mappedLabs: Object.keys(labVals).length };
  }

  /* ---------------------------------------------------------------- styles */
  function injectCSS() {
    if (document.getElementById("icu-css")) return;
    var css =
      // Design tokens live on BOTH the root surface AND the modal — the modal is
      // appended to <body> (outside #icuRoot), so without this its inputs/buttons
      // would resolve var(--border/--panel2/--ink/--primary) to nothing and render
      // invisible (white-on-white, no borders, no Save button).
      '#icuRoot,.icu-modal{--bg:#F1F5F9;--panel:#fff;--panel2:#F8FAFC;--border:#E2E8F0;--ink:#0F172A;--muted:#64748B;--primary:#0F766E;--primary2:#115E59;--primary3:#14B8A6;--primary-soft:#CCFBF1;--ok:#15803D;--ok-soft:#DCFCE7;--warn:#92620A;--warn-soft:#FEF3C7;--danger:#B91C1C;--danger-soft:#FEE2E2;' +
      '--r:16px;--r-sm:12px;--r-pill:999px;--sh:0 1px 2px rgba(15,23,42,.05),0 4px 16px rgba(15,23,42,.07);--ease:.2s cubic-bezier(.2,.7,.2,1);' +
      "--font:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;--mono:'IBM Plex Mono','SF Mono',Consolas,monospace}" +
      '#icuRoot{position:fixed;inset:0;z-index:10000;background:var(--bg);color:var(--ink);font-family:var(--font);display:none;flex-direction:column;overflow:hidden}' +
      '.icu-modal{font-family:var(--font)}' +
      '#icuRoot.on{display:flex}' +
      'body.dark #icuRoot,body.v3-dark #icuRoot,body.dark .icu-modal,body.v3-dark .icu-modal{--bg:#0B1220;--panel:#111B2E;--panel2:#0F1A2B;--border:#1E2B43;--ink:#E7EDF5;--muted:#8597AD;--primary:#2DD4BF;--primary2:#14B8A6;--primary3:#5EEAD4;--primary-soft:#0C2E2A;--ok:#4ADE80;--ok-soft:#06240F;--warn:#F0C060;--warn-soft:#241B00;--danger:#F87171;--danger-soft:#2A0E12;--sh:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35)}' +
      '#icuRoot *{box-sizing:border-box}' +
      '#icuRoot button{font-family:inherit;-webkit-tap-highlight-color:transparent}' +
      // header / patient card (sticky)
      '.icu-hd{flex:0 0 auto;background:var(--panel);border-bottom:1px solid var(--border);padding:calc(10px + env(safe-area-inset-top)) 14px 10px}' +
      '.icu-hd-top{display:flex;align-items:center;gap:10px}' +
      '.icu-hd-name{font:800 18px/1.1 var(--font);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.icu-x{width:38px;height:38px;border-radius:11px;border:none;background:var(--panel2);color:var(--ink);font-size:18px;cursor:pointer;flex:0 0 auto}' +
      '.icu-edit{border:1px solid var(--border);background:var(--panel);color:var(--primary);border-radius:var(--r-pill);font:700 12px var(--font);padding:6px 12px;cursor:pointer;flex:0 0 auto}' +
      '.icu-hd-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:6px;font:500 12.5px var(--font);color:var(--muted)}' +
      '.icu-hd-meta b{color:var(--ink);font-weight:700}' +
      '.icu-hd-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
      '.icu-chip{border:1px solid var(--border);background:var(--panel2);color:var(--ink);border-radius:var(--r-pill);font:700 12.5px var(--font);padding:8px 14px;cursor:pointer;flex:0 0 auto;min-height:36px}' +
      '.icu-chip:active{background:var(--primary-soft)}' +
      '.icu-adddata{background:var(--primary);color:#fff;font:800 15px var(--font);padding:14px;border:none;border-radius:14px;width:100%;cursor:pointer;box-shadow:0 2px 10px var(--primary-soft)}' +
      // scroll area
      '.icu-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 12px calc(96px + env(safe-area-inset-bottom))}' +
      '.icu-wrap{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:14px}' +
      '.icu-sec-lbl{font:800 11px var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:2px 2px -4px;display:flex;align-items:center;gap:7px}' +
      // live status grid
      '.icu-vitals{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}' +
      '@media (max-width:480px){.icu-vitals{grid-template-columns:repeat(3,1fr)}}' +
      '.icu-ward{font:700 12px var(--font);color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin:0 0 8px}.icu-ward.on{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}' +
      '.icu-ward-new{font:700 12px var(--font);color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:9px 12px;margin:0 0 8px;cursor:pointer}body.dark .icu-ward-new{background:#0a1a33;border-color:#1e3a8a;color:#93c5fd}' +
      '.icu-elyte-alerts{font:700 12px var(--font);color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 12px;margin:0 0 8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
      '.icu-elyte-pill{font:700 11px var(--font);border:1.5px solid var(--muted);border-radius:999px;padding:2px 9px}' +
      '.icu-src{font:600 11px var(--font);color:var(--muted);margin:8px 2px 0}' +
      '.icu-src-btns{display:flex;flex-direction:column;gap:8px;margin:0 0 12px}' +
      '.icu-srcbtn{display:flex;align-items:center;gap:12px;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;cursor:pointer;color:var(--ink)}.icu-srcbtn.ward{border-color:var(--teal,#0e6e63)}.icu-srcbtn .i{font-size:20px;flex:0 0 auto}.icu-srcbtn .l{font:800 14px var(--font);flex:1}.icu-srcbtn .d{font:600 11px var(--font);color:var(--muted);flex-basis:100%;margin-left:32px}.icu-srcbtn{flex-wrap:wrap}' +
      '.icu-imp-ov{position:fixed;inset:0;z-index:19000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px}' +
      '.icu-imp-box{background:var(--panel);border-radius:14px;padding:22px 24px;text-align:center;color:var(--ink);font:600 14px var(--font);max-width:320px}' +
      '.icu-imp-spin{font-size:26px;animation:icuspin 1s linear infinite;margin-bottom:8px}@keyframes icuspin{to{transform:rotate(360deg)}}' +
      '.icu-imp-err{color:var(--danger);font:600 13.5px/1.5 var(--font);margin-bottom:12px}' +
      '.icu-imp-review{background:var(--panel);border-radius:16px;width:100%;max-width:440px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;color:var(--ink)}' +
      '.icu-imp-hd{display:flex;align-items:center;font:800 16px var(--font);padding:14px 16px;border-bottom:1px solid var(--line)}.icu-imp-x{margin-left:auto;background:var(--panel2);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:15px;color:var(--ink)}' +
      '.icu-imp-note{font:600 12px/1.5 var(--font);color:var(--muted);padding:10px 16px}' +
      '.icu-imp-thumb{max-height:120px;max-width:calc(100% - 32px);margin:0 16px;border-radius:8px;border:1px solid var(--line);object-fit:contain}' +
      '.icu-imp-rows{flex:1;overflow-y:auto;padding:8px 16px}' +
      '.icu-imp-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:7px 0;font:600 13.5px var(--font)}.icu-imp-k{flex:0 0 34%}.icu-imp-row input{flex:1;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:8px 10px;font:600 14px var(--font)}' +
      '.icu-imp-dup,.icu-imp-diff{flex-basis:100%;margin-left:34%;font:600 10.5px var(--font)}.icu-imp-dup{color:var(--ok)}.icu-imp-diff{color:var(--warn)}' +
      '.icu-imp-actions{display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom));border-top:1px solid var(--line)}.icu-imp-actions .icu-btn{flex:1}.icu-imp-go{background:var(--teal,#0e6e63)!important;color:#fff!important;border-color:var(--teal,#0e6e63)!important}' +
      '.icu-vitals-c{margin:0 0 2px}.icu-vitals-c>summary{list-style:none;cursor:pointer;font:700 12px var(--font);color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 13px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.icu-vitals-c>summary::-webkit-details-marker{display:none}.icu-vitals-c>summary:after{content:"▸";margin-left:auto;color:var(--muted)}.icu-vitals-c[open]>summary:after{content:"▾"}.icu-vitals-c[open]>summary{margin-bottom:8px}.icu-vitals-c .vs-k{color:var(--muted);font-weight:600}' +
      '.icu-vc{background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);padding:9px 10px;box-shadow:var(--sh);min-width:0}' +
      '.icu-vc .vl{font:700 9.5px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.icu-vc .vv{font:800 19px/1.1 var(--mono);margin-top:3px}.icu-vc .vu{font:600 10px var(--font);color:var(--muted);margin-left:2px}' +
      '.icu-vc.crit{border-color:var(--danger);background:var(--danger-soft)}.icu-vc.crit .vv{color:var(--danger)}' +
      '.icu-vc.warn{border-color:var(--warn);background:var(--warn-soft)}.icu-vc.warn .vv{color:var(--warn)}' +
      '.icu-vc.ok .vv{color:var(--ok)}' +
      // generic card
      '.icu-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:15px;box-shadow:var(--sh)}' +
      '.icu-card h3{font:800 16px var(--font);margin:0 0 4px}.icu-card p{font:500 13.5px/1.5 var(--font);color:var(--muted);margin:0}' +
      // AI import grid
      '.icu-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.icu-ai{background:var(--panel);border:1px dashed var(--border);border-radius:var(--r-sm);padding:13px;text-align:left;cursor:pointer;color:var(--ink);position:relative;transition:transform var(--ease),box-shadow var(--ease)}' +
      '.icu-ai:active{transform:scale(.98)}.icu-ai:hover{box-shadow:var(--sh)}' +
      '.icu-ai .ic{font-size:22px}.icu-ai .t{font:700 13.5px var(--font);margin-top:6px}.icu-ai .s{font:500 11px/1.4 var(--font);color:var(--muted);margin-top:2px}' +
      '.icu-badge{display:inline-block;font:800 9px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--warn);background:var(--warn-soft);border-radius:var(--r-pill);padding:2px 7px;margin-top:8px}' +
      '.icu-ai .man{display:inline-block;margin-top:8px;margin-left:6px;font:700 11px var(--font);color:var(--primary)}' +
      // alert / recommendation / protocol cards
      '.icu-alert{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-left-width:4px;border-radius:var(--r-sm);padding:11px 13px;background:var(--panel)}' +
      '.icu-alert.crit{border-left-color:var(--danger);background:var(--danger-soft)}' +
      '.icu-alert.warn{border-left-color:var(--warn);background:var(--warn-soft)}' +
      '.icu-alert .at{font:700 13.5px var(--font)}.icu-alert .am{font:500 12.5px/1.45 var(--font);color:var(--muted);margin-top:1px}' +
      '.icu-alert .ax{margin-left:auto;font:700 9px var(--font);text-transform:uppercase;color:var(--muted)}' +
      '.icu-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font:500 13.5px var(--font)}.icu-row:last-child{border-bottom:none}.icu-row b{font-weight:700}' +
      '.icu-ev{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.icu-ev span{font:700 10px var(--font);color:var(--primary);background:var(--primary-soft);border-radius:var(--r-pill);padding:3px 9px}' +
      '.icu-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;border:none;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--primary3),var(--primary) 60%,var(--primary2));color:#fff;font:800 14px var(--font);padding:13px;cursor:pointer;box-shadow:var(--sh);margin-top:12px;transition:filter var(--ease),transform var(--ease)}.icu-btn:active{transform:scale(.985)}.icu-btn:hover{filter:brightness(1.05)}' +
      '.icu-btn.ghost{background:none;border:1px solid var(--border);color:var(--primary);box-shadow:none}' +
      '.icu-empty{font:500 13px var(--font);color:var(--muted);text-align:center;padding:8px 0}' +
      '.icu-phase{display:inline-block;font:800 9px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--primary);background:var(--primary-soft);border-radius:var(--r-pill);padding:3px 9px;margin-left:7px}' +
      // tab bar (frosted, fixed bottom, scrollable)
      '.icu-tabs{position:absolute;left:0;right:0;bottom:0;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;background:color-mix(in srgb,var(--panel) 88%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px);border-top:1px solid var(--border);padding:5px 6px calc(5px + env(safe-area-inset-bottom));z-index:5}' +
      '.icu-tabs::-webkit-scrollbar{display:none}' +
      '.icu-tab{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;border:none;background:none;color:var(--muted);cursor:pointer;padding:6px 9px;border-radius:10px;min-width:58px}' +
      '.icu-tab .ti{font-size:18px;line-height:1}.icu-tab .tl{font:700 9.5px var(--font);white-space:nowrap}' +
      '.icu-tab.on{color:var(--primary);background:var(--primary-soft)}' +
      // snapshot FAB
      '#icuSnap{position:absolute;right:14px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:6;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,var(--primary3),var(--primary2));color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(15,118,110,.42);cursor:pointer;display:flex;align-items:center;justify-content:center}#icuSnap:active{transform:scale(.92)}' +
      // modal
      '.icu-modal{position:fixed;inset:0;z-index:10020;display:none;align-items:flex-end;justify-content:center;background:rgba(8,18,26,.5)}' +
      '.icu-modal.on{display:flex}' +
      '.icu-sheet{background:var(--panel);color:var(--ink);width:100%;max-width:560px;max-height:88vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25)}' +
      '.icu-sheet h3{font:800 17px var(--font);margin:2px 0 14px}' +
      '.icu-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.icu-fld{display:flex;flex-direction:column;gap:4px}.icu-fld label{font:700 11px var(--font);color:var(--muted)}' +
      '.icu-fld input,.icu-fld select{font:600 15px var(--font);padding:10px 11px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%}' +
      '.icu-steps{counter-reset:s}.icu-step{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--border)}.icu-step .n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--primary-soft);color:var(--primary);font:800 12px var(--font);display:flex;align-items:center;justify-content:center}';
    var st = document.createElement("style"); st.id = "icu-css"; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ----------------------------------------------------------- components */
  function evidenceBadges(list) { return list && list.length ? '<div class="icu-ev">' + list.map(function (e) { return "<span>" + esc(e) + "</span>"; }).join("") + "</div>" : ""; }
  function vitalCard(label, value, unit, status) {
    return '<div class="icu-vc ' + (status || "") + '"><div class="vl">' + esc(label) + '</div><div class="vv">' +
      (value == null || value === "" ? "—" : esc(value)) + (value != null && value !== "" && unit ? '<span class="vu">' + esc(unit) + "</span>" : "") + "</div></div>";
  }
  function alertCard(a) { return '<div class="icu-alert ' + esc(a.severity) + '"><div><div class="at">' + esc(a.title) + '</div><div class="am">' + esc(a.msg) + '</div></div><div class="ax">' + esc(a.source || "") + "</div></div>"; }

  /* ----------------------------------------------------- live status row */
  function vstat(v, lo, hi, clo, chi) {
    if (v == null) return "";
    if ((clo != null && v < clo) || (chi != null && v > chi)) return "crit";
    if ((lo != null && v < lo) || (hi != null && v > hi)) return "warn";
    return "ok";
  }
  function renderLiveStatus() {
    var lv = latestVitals(), L = _raw.labs.recent || {}, f = _raw.fluids || {};
    var mp = curMap();
    var pressors = (_raw.infusions || []).filter(function (i) { return /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine|pressor/i.test(i.drug || ""); });
    var cards = [
      vitalCard("Heart Rate", lv.hr, "bpm", vstat(lv.hr, 50, 110, 40, 140)),
      vitalCard("BP", (lv.sbp != null && lv.dbp != null) ? lv.sbp + "/" + lv.dbp : null, "", ""),
      vitalCard("MAP", mp, "mmHg", vstat(mp, 65, 110, 60, null)),
      vitalCard("SpO₂", lv.spo2, "%", vstat(lv.spo2, 92, null, 88, null)),
      vitalCard("Resp Rate", lv.rr, "/min", vstat(lv.rr, 8, 24, null, 30)),
      vitalCard("Temp", lv.temp, "°C", vstat(lv.temp, 36, 38, null, 39)),
      vitalCard("Urine", lv.uop, "mL/h", ""),
      vitalCard("Lactate", lv.lactate, "mmol/L", vstat(lv.lactate, null, 2, null, 4)),
      vitalCard("Pressors", pressors.length ? pressors.map(function (p) { return p.drug; }).join(", ") : "None", "", pressors.length ? "warn" : "ok"),
      vitalCard("Infusions", (_raw.infusions || []).length || "0", "", ""),
      vitalCard("Net Fluid", f.net24h, "mL", ""),
      vitalCard("K⁺", L.k, "mmol/L", vstat(L.k, 3.5, 5.0, 2.5, 6.0))
    ];
    return '<div class="icu-sec-lbl">❤️ Live Patient Status</div><div class="icu-vitals">' + cards.join("") + "</div>";
  }

  /* --------------------------------------------------------- AI import panel */
  function renderAIImport() {
    var cards = [
      { d: "labs", ic: "🧪", t: "Laboratory report", s: "CBC · LFT · RFT · Electrolytes" },
      { d: "abg", ic: "🩸", t: "ABG report", s: "pH · PaCO₂ · PaO₂ · HCO₃" },
      { d: "ventilator", ic: "🫁", t: "Ventilator screen", s: "Mode · FiO₂ · PEEP · TV · Plateau" },
      { d: "monitor", ic: "❤️", t: "Monitor / vitals", s: "HR · BP · SpO₂ · Temp" }
    ];
    return '<div class="icu-sec-lbl">🔄 Bring in patient data <span style="font-weight:600;text-transform:none;letter-spacing:0">· auto-fills fields you confirm</span></div>' +
      '<div class="icu-src-btns">' +
        '<button class="icu-srcbtn ward" data-icu-act="wardfetch"><span class="i">🏥</span><span class="l">Fetch from Ward Sync</span><span class="d">Pick patient → CBC · electrolytes · RFT · LFT</span></button>' +
        '<button class="icu-srcbtn" data-icu-act="impmethod:camera"><span class="i">📷</span><span class="l">Camera</span><span class="d">Photograph a report / screen</span></button>' +
        '<button class="icu-srcbtn" data-icu-act="impmethod:file"><span class="i">📄</span><span class="l">Upload PDF / file</span><span class="d">Lab / ABG PDF or image</span></button>' +
      '</div>' +
      '<div class="icu-ai-grid">' + cards.map(function (c) {
        return '<button class="icu-ai" data-icu-act="edit:' + (c.d === "abg" ? "abg" : c.d) + '"><div class="ic">' + c.ic + '</div><div class="t">' + c.t + '</div><div class="s">' + c.s + '</div>' +
          '<span class="man">✎ Enter manually</span></button>';
      }).join("") + "</div>";
  }

  /* ================= REPORT IMPORT (photo / PDF) — gold125 ==================
   * Pipeline: file/camera → CLIENT-SIDE compress (never send raw large files) →
   * /api/ai/vision OCR (structured fields only) → clinician REVIEW (editable,
   * abnormal-flagged, duplicate-checked) → confirm → ICU.ingestFromWard(source:
   * "Imported report") which is conflict-safe. No raw PDF/image or long text ever
   * goes to MaiK; only the compressed page image reaches the vision OCR, and only
   * the extracted structured VALUES flow onward. Deterministic engine unchanged. */
  var MAX_UPLOAD_BYTES = 1.6 * 1024 * 1024;   // target ≤ ~1.6 MB to the OCR
  var _imgHiQ = false;
  // Compress an image File/blob to a JPEG data-URL under the byte target. Canvas
  // re-encode also strips EXIF/metadata. Iterates quality (and downscales) to fit.
  function compressImage(fileOrDataUrl, cb) {
    var img = new Image();
    img.onload = function () {
      var maxEdge = _imgHiQ ? 2200 : 1600, w = img.width, h = img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
      var q = _imgHiQ ? 0.85 : 0.72, out = cv.toDataURL("image/jpeg", q), guard = 0;
      function bytes(u) { return Math.ceil((u.length - (u.indexOf(",") + 1)) * 3 / 4); }
      while (bytes(out) > MAX_UPLOAD_BYTES && guard++ < 6) {
        q -= 0.12; if (q < 0.4) { cw = Math.round(cw * 0.85); ch = Math.round(ch * 0.85); cv.width = cw; cv.height = ch; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch); q = 0.6; }
        out = cv.toDataURL("image/jpeg", Math.max(0.35, q));
      }
      cb(out, { w: cw, h: ch, kb: Math.round(bytes(out) / 1024) });
    };
    img.onerror = function () { cb(null); };
    img.src = (typeof fileOrDataUrl === "string") ? fileOrDataUrl : URL.createObjectURL(fileOrDataUrl);
  }
  // Lazy-load pdf.js (CDN) only when a PDF is imported; render selected pages to
  // compressed images. Whole PDF is NEVER sent to AI — only rendered page images.
  var _pdfjs = null;
  function loadPdfJs() {
    if (_pdfjs) return Promise.resolve(_pdfjs);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = function () { try { _pdfjs = window.pdfjsLib; _pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(_pdfjs); } catch (e) { rej(e); } };
      s.onerror = function () { rej(new Error("pdf-load")); };
      document.head.appendChild(s);
    });
  }
  function renderPdfPageToImage(pdf, pageNum, cb) {
    pdf.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: 2 });
      var cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
      page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise.then(function () {
        compressImage(cv.toDataURL("image/jpeg", 0.85), function (out) { cb(out); });
      });
    }).catch(function () { cb(null); });
  }

  var IMPORT_LBL = { na: "Sodium", k: "Potassium", cl: "Chloride", hco3: "HCO₃", ca: "Calcium", mg: "Magnesium", po4: "Phosphate", glu: "Glucose", creat: "Creatinine", urea: "Urea", alb: "Albumin", wbc: "WBC", hb: "Hb", plt: "Platelets", inr: "INR", crp: "CRP", bili: "Bilirubin", ast: "AST", alt: "ALT", lactate: "Lactate",
    hr: "Heart rate", sbp: "Systolic BP", dbp: "Diastolic BP", map: "MAP", rr: "Resp rate", spo2: "SpO₂", temp: "Temp", cvp: "CVP", etco2: "EtCO₂",
    ph: "pH", paco2: "PaCO₂", pao2: "PaO₂", be: "Base excess", fio2: "FiO₂", mode: "Mode", peep: "PEEP", tv: "Tidal volume", peak: "Peak", plateau: "Plateau" };
  var IMPORT_GROUP = { labs: "mapped", monitor: "vitals", abg: "abg", ventilator: "ventilator" };
  function importFileInput(kind, method) {
    var inp = document.createElement("input"); inp.type = "file";
    inp.accept = (method === "camera") ? "image/*" : "image/*,application/pdf";
    if (method === "camera") inp.setAttribute("capture", "environment");   // rear camera on mobile
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (f) handleImportFile(kind, f); inp.remove(); });
    inp.click();
  }
  // Camera / Upload → first choose WHAT the report is, then open the picker.
  function importMethod(method) {
    var el = document.getElementById("icuImpOv"); if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov"; document.body.appendChild(el); }
    var kinds = [["labs", "🧪 Laboratory report", "CBC · LFT · RFT · Electrolytes"], ["abg", "🩸 ABG report", "pH · PaCO₂ · PaO₂ · HCO₃"], ["ventilator", "🫁 Ventilator screen", "Mode · FiO₂ · PEEP · TV"], ["monitor", "❤️ Monitor / vitals", "HR · BP · SpO₂ · Temp"]];
    el.innerHTML = '<div class="icu-imp-review"><div class="icu-imp-hd">' + (method === "camera" ? "📷 Photograph — what report?" : "📄 Upload — what report?") + '<button class="icu-imp-x" id="icuImpX">✕</button></div>' +
      '<div style="padding:12px 16px">' + kinds.map(function (k) { return '<button class="icu-btn" style="display:block;width:100%;text-align:left;margin:0 0 8px" data-impkind="' + k[0] + '"><b>' + k[1] + '</b><div style="font:600 11px var(--font);color:var(--muted)">' + k[2] + '</div></button>'; }).join("") + '</div></div>';
    el.querySelector("#icuImpX").addEventListener("click", function () { el.remove(); });
    el.querySelectorAll("[data-impkind]").forEach(function (b) { b.addEventListener("click", function () { var kind = b.getAttribute("data-impkind"); el.remove(); importFileInput(kind, method); }); });
  }
  function wardSyncFetch() {
    if (typeof window.openGHIS === "function") { try { openGHIS(); } catch (e) {} }
    else if (window.SMD_setGhis) { try { SMD_setGhis(true); setTimeout(function () { try { window.openGHIS && openGHIS(); } catch (e) {} }, 400); } catch (e) {} }
    else if (window.toast) toast("Ward Sync is loading — try again in a moment.");
  }
  function importProgress(msg, err) {
    var el = document.getElementById("icuImpOv");
    if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov"; document.body.appendChild(el); }
    el.innerHTML = '<div class="icu-imp-box">' + (err ? '<div class="icu-imp-err">' + esc(msg) + '</div><button class="icu-btn" id="icuImpClose">Close</button>' : '<div class="icu-imp-spin">◐</div><div>' + esc(msg) + "</div>") + "</div>";
    var c = el.querySelector("#icuImpClose"); if (c) c.addEventListener("click", function () { el.remove(); });
  }
  function importDone() { var el = document.getElementById("icuImpOv"); if (el) el.remove(); }
  function handleImportFile(kind, file) {
    if (file.type === "application/pdf") {
      importProgress("Reading PDF…");
      loadPdfJs().then(function (pdfjs) {
        var fr = new FileReader();
        fr.onload = function () {
          pdfjs.getDocument({ data: new Uint8Array(fr.result) }).promise.then(function (pdf) {
            var pages = Math.min(pdf.numPages, 3);   // cap pages sent to OCR
            importProgress("Rendering " + pages + " of " + pdf.numPages + " page(s)…");
            renderPdfPageToImage(pdf, 1, function (img) {   // page 1 (most reports: header + first panel)
              if (!img) return importProgress("Could not read this PDF. Try a photo instead.", true);
              doOcr(kind, img, pdf.numPages > 3 ? "First page of " + pdf.numPages + " (large PDF — capped)" : "");
            });
          }).catch(function () { importProgress("Could not open this PDF.", true); });
        };
        fr.readAsArrayBuffer(file);
      }).catch(function () { importProgress("PDF support unavailable offline — try a photo.", true); });
      return;
    }
    // image: compress client-side BEFORE any AI call
    importProgress("Compressing image…");
    compressImage(file, function (dataUrl, meta) {
      if (!dataUrl) return importProgress("Could not read this image.", true);
      doOcr(kind, dataUrl, meta ? meta.kb + " KB" : "");
    });
  }
  function doOcr(kind, dataUrl, note) {
    importProgress("Reading values from report…" + (note ? " (" + note + ")" : ""));
    if (!(window.SMD_AI && SMD_AI.vision)) { importProgress("AI reader unavailable. Enable AI in Settings, or enter values manually.", true); return; }
    try { if (SMD_AI.setFlag) SMD_AI.setFlag(true); } catch (e) {}
    // ONLY the compressed image is sent to the OCR endpoint; never the raw file/PDF.
    SMD_AI.vision(dataUrl, IMPORT_GROUP[kind] ? (kind === "abg" ? "abg" : kind) : "labs").then(function (r) {
      importDone();
      if (!r || r.error) { importProgress(r && r.error === "ai-off" ? "AI reader is off — enable it in Settings." : "Could not read the report. Enter values manually.", true); return; }
      // the vision endpoint returns { kind, fields:{...} } — read fields, not the wrapper.
      var src = (r.fields && typeof r.fields === "object") ? r.fields : r;
      var fields = {}; Object.keys(src).forEach(function (k) { if (k === "kind" || k === "fields") return; if (k === "mode") { if (src[k]) fields[k] = src[k]; } else if (src[k] != null && !isNaN(parseFloat(src[k]))) fields[k] = parseFloat(src[k]); });
      openImportReview(kind, fields, dataUrl);
    }).catch(function () { importDone(); importProgress("Could not reach the AI reader. Enter values manually.", true); });
  }
  // Clinician review — nothing enters the patient context until confirmed here.
  function openImportReview(kind, fields, dataUrl) {
    var keys = Object.keys(fields);
    if (!keys.length) { importProgress("No values could be read confidently. Keeping the image as reference only — please enter values manually.", true); return; }
    var el = document.getElementById("icuImpOv"); if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov"; document.body.appendChild(el); }
    var L = _raw.labs.recent || {}, lastV = latestVitals();
    var rows = keys.map(function (k) {
      var cur = (kind === "labs") ? L[k] : (kind === "monitor") ? lastV[k] : (kind === "abg") ? (_raw.abg || {})[k] : (_raw.ventilator || {})[k];
      var dup = (cur != null && cur !== "" && String(cur) === String(fields[k])) ? '<span class="icu-imp-dup">≈ already recorded</span>'
        : (cur != null && cur !== "") ? '<span class="icu-imp-diff">differs from current ' + esc(cur) + '</span>' : "";
      return '<label class="icu-imp-row"><span class="icu-imp-k">' + esc(IMPORT_LBL[k] || k) + '</span>' +
        '<input data-impk="' + k + '" value="' + esc(fields[k]) + '" ' + (typeof fields[k] === "number" ? 'type="number" step="any"' : 'type="text"') + '>' + dup + "</label>";
    }).join("");
    el.innerHTML = '<div class="icu-imp-review"><div class="icu-imp-hd">Review extracted values<button class="icu-imp-x" id="icuImpX">✕</button></div>' +
      '<div class="icu-imp-note">📷 OCR-extracted — <b>verify every value</b> against the report before applying. Nothing is added until you confirm.</div>' +
      (dataUrl ? '<img class="icu-imp-thumb" src="' + dataUrl + '">' : "") +
      '<div class="icu-imp-rows">' + rows + "</div>" +
      '<div class="icu-imp-actions"><button class="icu-btn" id="icuImpCancel">Cancel</button><button class="icu-btn icu-imp-go" id="icuImpConfirm">✓ Add to patient context</button></div></div>';
    function close() { el.remove(); }
    el.querySelector("#icuImpX").addEventListener("click", close);
    el.querySelector("#icuImpCancel").addEventListener("click", close);
    el.querySelector("#icuImpConfirm").addEventListener("click", function () {
      var vals = {}; el.querySelectorAll("[data-impk]").forEach(function (i) { var k = i.getAttribute("data-impk"), v = i.value; if (v !== "" && v != null) vals[k] = (k === "mode") ? v : parseFloat(v); });
      var bundle = { source: "Imported report" }; bundle[IMPORT_GROUP[kind] || "mapped"] = vals;
      var res = ICU.ingestFromWard(bundle);
      close(); paint();
      try { if (window.toast) toast("Imported " + Object.keys(vals).length + " value(s)" + (res && res.conflicts ? " · " + res.conflicts + " conflict(s) to review" : "")); } catch (e) {}
    });
  }
  function startImport(kind) { importFileInput(IMPORT_GROUP[kind] ? kind : "labs"); }

  /* ======================================================= PHASE 2 engines */
  var _trendWin = 24 * 60 * 60 * 1000;   // trends window (ms); default 24h

  // --- TrendGraph (reusable SVG line chart over a [{ts,v}] series) ----------
  function trendGraph(points, opts) {
    opts = opts || {};
    points = (points || []).filter(function (p) { return p && p.v != null && isFinite(p.v); }).sort(function (a, b) { return a.ts - b.ts; });
    if (points.length < 2) return '<div class="icu-empty">Not enough data yet — add more readings to see a trend.</div>';
    var W = 320, H = 78, pad = 6;
    var xs = points.map(function (p) { return p.ts; }), ys = points.map(function (p) { return p.v; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    if (opts.band) { minY = Math.min(minY, opts.band[0]); maxY = Math.max(maxY, opts.band[1]); }
    var spanY = (maxY - minY) || 1, spanX = (maxX - minX) || 1;
    function X(t) { return (pad + (W - 2 * pad) * (t - minX) / spanX); }
    function Y(v) { return (H - pad - (H - 2 * pad) * (v - minY) / spanY); }
    var d = points.map(function (p, i) { return (i ? "L" : "M") + X(p.ts).toFixed(1) + " " + Y(p.v).toFixed(1); }).join(" ");
    var band = "";
    if (opts.band) { var y1 = Y(opts.band[1]), y2 = Y(opts.band[0]); band = '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="var(--ok-soft)" opacity=".7"/>'; }
    var dec = spanY < 5 ? 1 : 0, last = ys[ys.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:78px;display:block">' + band +
      '<path d="' + d + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>' +
      '<div style="display:flex;justify-content:space-between;font:600 10px var(--font);color:var(--muted);margin-top:3px"><span>' + esc(minY.toFixed(dec)) + "–" + esc(maxY.toFixed(dec)) + (opts.unit ? " " + esc(opts.unit) : "") + '</span><span>last <b style="color:var(--ink)">' + esc(last) + "</b></span></div>";
  }
  function trendCard(title, series, opts) { return '<div class="icu-card"><div class="icu-sec-lbl" style="margin:0 0 8px">' + esc(title) + "</div>" + trendGraph(series, opts) + "</div>"; }
  function recsCard(title, recs, flags, ev) {
    return '<div class="icu-card"><h3>' + esc(title) + "</h3>" +
      ((flags && flags.length) ? flags.map(function (f) { return '<div class="icu-alert warn"><div><div class="am">⚠ ' + esc(f) + "</div></div></div>"; }).join("") : "") +
      (recs || []).map(function (r) { return '<p style="margin:9px 0 0">• ' + esc(r) + "</p>"; }).join("") + evidenceBadges(ev) + "</div>";
  }
  function winSelector() {
    var opts = [["24h", 864e5], ["48h", 1728e5], ["72h", 2592e5], ["7d", 6048e5]];
    return '<div style="display:flex;gap:6px;justify-content:center;margin-top:4px">' + opts.map(function (o) {
      return '<button class="icu-btn ghost" style="width:auto;margin:0;padding:7px 13px;font-size:12px;' + (_trendWin === o[1] ? "background:var(--primary-soft);border-color:var(--primary)" : "") + '" data-icu-act="win:' + o[1] + '">' + o[0] + "</button>";
    }).join("") + "</div>";
  }
  function vitalSeries(key, win) { var c = Date.now(); return (_raw.vitals || []).filter(function (v) { return v[key] != null && (!win || v.ts >= c - win); }).map(function (v) { return { ts: v.ts, v: v[key] }; }); }
  function mapSeries(win) { var c = Date.now(); return (_raw.vitals || []).filter(function (v) { return (v.map != null || (v.sbp != null && v.dbp != null)) && (!win || v.ts >= c - win); }).map(function (v) { return { ts: v.ts, v: v.map != null ? v.map : mapCalc(v.sbp, v.dbp) }; }); }
  function labSeries(key, win) { var c = Date.now(); return (_raw.labs.trends || []).filter(function (r) { return r[key] != null && (!win || r.ts >= c - win); }).map(function (r) { return { ts: r.ts, v: r[key] }; }); }

  // --- ABG / acid–base interpreter -----------------------------------------
  function analyzeABG(g, L) {
    g = g || {}; L = L || {};
    var ph = g.ph, pco2 = g.paco2, hco3 = g.hco3;
    if (ph == null || pco2 == null || hco3 == null) return null;
    var rows = [], flags = [], primary = "", comp = "";
    var acidemia = ph < 7.35, alkalemia = ph > 7.45;
    if (acidemia) {
      if (hco3 < 22) primary = "Metabolic acidosis";
      if (pco2 > 45) primary = primary ? "Mixed metabolic & respiratory acidosis" : "Respiratory acidosis";
      if (!primary) primary = "Acidaemia";
    } else if (alkalemia) {
      if (hco3 > 26) primary = "Metabolic alkalosis";
      if (pco2 < 35) primary = primary ? "Mixed metabolic & respiratory alkalosis" : "Respiratory alkalosis";
      if (!primary) primary = "Alkalaemia";
    } else {
      if (hco3 < 22 && pco2 < 35) primary = "Compensated / mixed (low HCO₃ & low CO₂)";
      else if (hco3 > 26 && pco2 > 45) primary = "Compensated / mixed (high HCO₃ & high CO₂)";
      else primary = "Normal acid–base";
    }
    if (/Metabolic acidosis/.test(primary)) {
      var exp = 1.5 * hco3 + 8;
      rows.push(["Winter's expected PaCO₂", exp.toFixed(0) + " ± 2 mmHg (actual " + pco2 + ")"]);
      comp = pco2 > exp + 2 ? "Inadequate respiratory compensation → added respiratory acidosis" : pco2 < exp - 2 ? "Over-compensation → added respiratory alkalosis" : "Appropriate respiratory compensation";
    } else if (/Metabolic alkalosis/.test(primary)) {
      var expA = 0.7 * hco3 + 20;
      rows.push(["Expected PaCO₂", expA.toFixed(0) + " ± 2 mmHg (actual " + pco2 + ")"]);
      comp = pco2 < expA - 2 ? "Added respiratory alkalosis" : pco2 > expA + 2 ? "Added respiratory acidosis" : "Appropriate respiratory compensation";
    } else if (/Respiratory/.test(primary)) {
      comp = "Assess acute vs chronic by the HCO₃ shift (acute ≈1, chronic ≈3.5 mmol/L per 10 mmHg PaCO₂).";
    }
    if (L.na != null && L.cl != null) {
      var ag = L.na - (L.cl + hco3), agc = ag;
      if (L.alb != null) agc = ag + 0.25 * (40 - L.alb);     // albumin in g/L (normal ~40)
      var agShown = L.alb != null ? agc : ag;
      rows.push(["Anion gap" + (L.alb != null ? " (albumin-corrected)" : ""), agShown.toFixed(0) + " mmol/L"]);
      if (agShown > 12) {
        flags.push("High anion gap — consider lactate, ketones, renal failure, toxins (MUDPILES)");
        var dr = (ag - 12) / (24 - hco3);
        if (isFinite(dr) && (24 - hco3) !== 0) {
          rows.push(["Delta ratio (ΔAG/ΔHCO₃)", dr.toFixed(1)]);
          if (dr < 0.4) flags.push("Δ-ratio <0.4 → concurrent normal-AG (hyperchloraemic) acidosis");
          else if (dr > 2) flags.push("Δ-ratio >2 → concurrent metabolic alkalosis or pre-existing high HCO₃");
        }
      }
    }
    if (g.pao2 != null && g.fio2) { var pf = Math.round(g.pao2 / (g.fio2 / 100)); rows.push(["P/F ratio", pf + (pf < 100 ? " (severe ARDS)" : pf < 200 ? " (moderate ARDS)" : pf < 300 ? " (mild ARDS)" : "")]); }
    return { primary: primary, comp: comp, rows: rows, flags: flags };
  }

  // --- Fluid management engine ---------------------------------------------
  function analyzeFluids(f, pt, lv) {
    f = f || {}; pt = pt || {}; lv = lv || {};
    var rows = [], recs = [], flags = [];
    var net = f.net24h != null ? f.net24h : (f.intake24h != null && f.output24h != null ? f.intake24h - f.output24h : null);
    rows.push(["Net balance (24h)", net != null ? (net > 0 ? "+" : "") + net + " mL" : "—"]);
    rows.push(["Cumulative balance", f.cumulative != null ? (f.cumulative > 0 ? "+" : "") + f.cumulative + " mL" : "—"]);
    if (pt.weightKg) { var w = pt.weightKg, m = w <= 10 ? 4 * w : w <= 20 ? 40 + 2 * (w - 10) : 60 + (w - 20); rows.push(["Maintenance (4-2-1)", Math.round(m) + " mL/h (" + Math.round(m * 24) + " mL/day)"]); }
    var map = lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp);
    var oliguric = lv.uop != null && pt.weightKg && lv.uop < 0.5 * pt.weightKg;
    var hypop = (map != null && map < 65) || (lv.lactate != null && lv.lactate > 2) || oliguric;
    var phase;
    if (hypop) { phase = "Resuscitation"; recs.push("Signs of hypoperfusion (low MAP / high lactate / oliguria) — give a guided fluid challenge (250–500 mL crystalloid) and REASSESS with dynamic measures; avoid reflexive large-volume boluses."); }
    else if (f.cumulative != null && f.cumulative > 3000) { phase = "De-resuscitation"; recs.push("Positive cumulative balance with adequate perfusion — consider de-resuscitation (net-negative / diuresis) to reduce ventilator and AKI risk."); flags.push("Cumulative fluid overload risk (+" + f.cumulative + " mL)"); }
    else { phase = "Maintenance / conservative"; recs.push("Perfusion adequate — favour conservative/maintenance fluids with daily reassessment of balance."); }
    if (oliguric) flags.push("Oliguria (<0.5 mL/kg/h) — assess volume status and renal perfusion");
    return { rows: rows, recs: recs, flags: flags, phase: phase };
  }

  // --- Hemodynamic interpretation ------------------------------------------
  function interpretHemo(lv, inf) {
    var recs = [], flags = [];
    var map = lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp);
    var si = (lv.hr && lv.sbp) ? lv.hr / lv.sbp : null;
    var pressors = (inf || []).filter(function (i) { return /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine/i.test(i.drug || ""); });
    if (map != null && map < 65) { recs.push(pressors.length ? "MAP <65 despite vasopressors — reassess volume, consider adding vasopressin or escalating noradrenaline, and exclude an untreated cause (sepsis source, tamponade, PE)." : "MAP <65 — after appropriate fluids, start a vasopressor (noradrenaline first-line) targeting MAP ≥65."); flags.push("MAP " + map + " mmHg below target (≥65)"); }
    if (si != null && si > 0.9) flags.push("Shock index " + si.toFixed(2) + " (>0.9) — occult hypoperfusion");
    if (lv.lactate != null && lv.lactate > 2) recs.push("Lactate " + lv.lactate + " mmol/L — target clearance; recheck in 2–4 h as a resuscitation marker.");
    if (!recs.length) recs.push("Hemodynamics within target — continue monitoring.");
    return { map: map, si: si, pressors: pressors, recs: recs, flags: flags };
  }

  /* ======================================================= PHASE 3 engines */
  // --- Ventilator: protective-ventilation / ARDS / weaning interpreter -----
  function pbw(pt) { if (!pt || !pt.heightCm) return null; var inch = pt.heightCm / 2.54; var base = (pt.sex === "F" || pt.sex === "Female") ? 45.5 : 50; return Math.round((base + 2.3 * (inch - 60)) * 10) / 10; }
  function interpretVent(v, pt, abg) {
    v = v || {}; var rows = [], recs = [], flags = [], w = pbw(pt);
    if (w) {
      rows.push(["Predicted body weight", w + " kg"]);
      rows.push(["Target tidal volume", "6 mL/kg ≈ " + Math.round(6 * w) + " mL (cap 8 mL/kg = " + Math.round(8 * w) + " mL)"]);
      if (v.tv != null) { var mlkg = +(v.tv / w).toFixed(1); rows.push(["Current TV per PBW", mlkg + " mL/kg"]); if (mlkg > 8) { flags.push("Tidal volume " + mlkg + " mL/kg (>8) — risk of ventilator-induced lung injury"); recs.push("Reduce tidal volume toward 6 mL/kg predicted body weight (lung-protective ventilation)."); } }
    } else recs.push("Enter height & sex (Patient) to compute predicted body weight and lung-protective targets.");
    if (v.plateau != null) { rows.push(["Plateau pressure", v.plateau + " cmH₂O"]); if (v.plateau > 30) { flags.push("Plateau >30 cmH₂O"); recs.push("Plateau >30 cmH₂O — lower tidal volume / optimise PEEP to limit alveolar overdistension."); } }
    var dp = v.drivingP != null ? v.drivingP : (v.plateau != null && v.peep != null ? v.plateau - v.peep : null);
    if (dp != null) { rows.push(["Driving pressure", dp + " cmH₂O"]); if (dp > 15) flags.push("Driving pressure >15 cmH₂O — associated with higher mortality"); }
    var pf = v.pf != null ? v.pf : ((abg && abg.pao2 != null && v.fio2) ? Math.round(abg.pao2 / (v.fio2 / 100)) : null);
    if (pf != null) { rows.push(["P/F ratio", pf + (pf < 100 ? " (severe ARDS)" : pf < 200 ? " (moderate ARDS)" : pf < 300 ? " (mild ARDS)" : "")]); if (pf < 150) recs.push("P/F <150 — consider prone positioning (≥16 h/day), neuromuscular blockade, and PEEP optimisation."); }
    if (v.rr != null && v.tv != null && v.tv > 0) { var rsbi = Math.round(v.rr / (v.tv / 1000)); rows.push(["RSBI (RR/Vt)", rsbi + (rsbi < 105 ? " — favourable for SBT" : " — ≥105, weaning likely to fail")]); }
    if (!recs.length) recs.push("Settings within protective targets — reassess daily for weaning readiness.");
    return { rows: rows, recs: recs, flags: flags, pf: pf };
  }

  // --- Critical-care protocol library (paraphrased checklists) -------------
  var PROTOCOLS = [
    { ic: "🦠", title: "Sepsis / Septic shock", checklist: ["Measure lactate; repeat if >2 mmol/L", "Blood cultures before antibiotics", "Broad-spectrum antibiotics within 1 hour", "30 mL/kg crystalloid for hypotension or lactate ≥4", "Vasopressors (noradrenaline first) for MAP ≥65 if fluid-refractory", "Identify & control the source"], monitoring: ["Lactate clearance", "MAP, urine output, mental status"], evidence: ["Surviving Sepsis 2021", "SCCM"] },
    { ic: "🩸", title: "Undifferentiated shock", checklist: ["Identify type (RUSH / bedside echo, IVC)", "Fluids vs early vasopressors by type", "Treat the cause (sepsis, cardiogenic, obstructive, hypovolaemic)", "Arterial line + central access if escalating"], monitoring: ["MAP, lactate, perfusion", "Echo / dynamic measures"], evidence: ["SCCM", "Marino ICU"] },
    { ic: "🍬", title: "DKA / HHS", checklist: ["IV crystalloid resuscitation", "Fixed-rate IV insulin infusion (0.1 U/kg/h)", "Replace potassium once K <5.5 and urine output present", "Hourly glucose/ketones; monitor pH, K", "Treat precipitant; avoid routine bicarbonate"], monitoring: ["Hourly glucose & ketones", "Potassium, pH, anion gap"], evidence: ["JBDS", "ADA"] },
    { ic: "🩹", title: "Major GI bleed", checklist: ["Resuscitate; large-bore access; group & crossmatch", "Restrictive transfusion (target Hb ~7 g/dL)", "IV PPI infusion", "If variceal: terlipressin + prophylactic antibiotics", "Urgent endoscopy within 24 h (sooner if unstable)"], monitoring: ["Haemodynamics, Hb trend", "Re-bleeding signs"], evidence: ["BSG", "ACG"] },
    { ic: "❤️", title: "Acute coronary syndrome", checklist: ["12-lead ECG within 10 min; serial troponin", "Dual antiplatelet + anticoagulation per pathway", "STEMI → primary PCI (or thrombolysis if PCI delayed)", "NSTE-ACS → risk-stratify (GRACE) & timing of angiography"], monitoring: ["Continuous ECG", "Recurrent ischaemia, arrhythmia"], evidence: ["ESC", "AHA/ACC"] },
    { ic: "🧠", title: "Acute stroke", checklist: ["Time-critical: confirm last-known-well", "Non-contrast CT to exclude haemorrhage", "Thrombolysis within window / thrombectomy for LVO", "BP targets per reperfusion plan; glucose control", "NBM until swallow assessed"], monitoring: ["Neuro obs, BP", "Post-lysis bleeding"], evidence: ["AHA/ASA", "ESO"] },
    { ic: "🫁", title: "ARDS", checklist: ["Lung-protective TV 6 mL/kg PBW", "Plateau <30, driving pressure <15 cmH₂O", "PEEP titration to oxygenation", "Prone ≥16 h if P/F <150", "Conservative fluid strategy; NMB if severe"], monitoring: ["P/F, plateau, driving pressure", "Compliance"], evidence: ["ARDSNet", "ESICM"] },
    { ic: "⚡", title: "Hyperkalemia", checklist: ["IV calcium to stabilise myocardium if ECG changes", "Shift: insulin + dextrose, nebulised salbutamol (± bicarbonate)", "Remove: diuretic, binder, or dialysis", "Stop K-raising drugs; recheck K & glucose"], monitoring: ["Continuous ECG", "Serial K & glucose"], evidence: ["UK Renal", "KDIGO"] },
    { ic: "🌀", title: "Status epilepticus", checklist: ["ABC, oxygen, glucose & electrolytes", "Benzodiazepine first-line (repeat once)", "IV anti-seizure med (levetiracetam / valproate / phenytoin)", "Refractory → anaesthesia (propofol/midazolam) + EEG", "Identify & treat the cause"], monitoring: ["Airway, seizure activity", "EEG if refractory"], evidence: ["NCS", "ILAE"] },
    { ic: "🫀", title: "Pulmonary embolism", checklist: ["Risk-stratify (haemodynamics, sPESI, RV strain)", "Anticoagulate unless contraindicated", "High-risk/massive → systemic thrombolysis or embolectomy", "Supportive: oxygen, cautious fluids, vasopressors"], monitoring: ["Haemodynamics, oxygenation", "RV function"], evidence: ["ESC"] },
    { ic: "💉", title: "Anaphylaxis", checklist: ["Remove trigger; call for help", "IM adrenaline 0.5 mg (0.5 mL 1:1000) anterolateral thigh — repeat at 5 min", "High-flow oxygen; lay flat, legs raised", "IV crystalloid bolus for hypotension", "Antihistamine / steroid are second-line; observe for biphasic reaction"], monitoring: ["Airway, BP, SpO₂", "Biphasic relapse"], evidence: ["Resus Council", "WAO"] }
  ];
  var _openProto = {};
  var _lytesExp = {};   // which electrolyte cards are expanded in the Electrolytes tab
  function protocolCard(p, i) {
    var open = !!_openProto[i];
    var head = '<button data-icu-act="proto:' + i + '" style="width:100%;text-align:left;background:none;border:none;padding:14px 15px;cursor:pointer;color:var(--ink);display:flex;align-items:center;gap:9px"><span style="font-size:18px">' + p.ic + '</span><b style="font:800 15px var(--font);flex:1">' + esc(p.title) + '</b><span style="color:var(--muted)">' + (open ? "▲" : "▼") + "</span></button>";
    var body = open ? '<div style="padding:0 15px 14px">' +
      '<div class="icu-sec-lbl" style="margin:2px 0 4px">Checklist</div>' + p.checklist.map(function (c) { return '<div class="icu-row"><span>' + esc(c) + "</span></div>"; }).join("") +
      (p.monitoring ? '<div class="icu-sec-lbl" style="margin:9px 0 4px">Monitoring</div>' + p.monitoring.map(function (c) { return '<div class="icu-row"><span>' + esc(c) + "</span></div>"; }).join("") : "") +
      evidenceBadges(p.evidence) + "</div>" : "";
    return '<div class="icu-card" style="padding:0;overflow:hidden">' + head + body + "</div>";
  }

  // --- Daily ICU Rounds checklist + summary --------------------------------
  var ROUNDS_ITEMS = [
    { k: "general", g: "General", label: "Overnight events / trajectory reviewed" },
    { k: "airway", g: "Airway", label: "Airway secure / ETT position & cuff" },
    { k: "breathing", g: "Breathing", label: "Ventilation & oxygenation reviewed" },
    { k: "circulation", g: "Circulation", label: "Haemodynamics & pressors reviewed" },
    { k: "fluids", g: "Fluids", label: "Fluid balance & strategy set" },
    { k: "renal", g: "Renal", label: "Renal function / RRT need" },
    { k: "lytes", g: "Electrolytes", label: "Electrolytes corrected / monitored" },
    { k: "abg", g: "ABG", label: "Acid–base reviewed" },
    { k: "nutrition", g: "Nutrition", label: "Feeding plan (enteral preferred)" },
    { k: "sedation", g: "Sedation", label: "Sedation target / daily interruption" },
    { k: "pain", g: "Pain", label: "Analgesia & delirium (CAM-ICU) assessed" },
    { k: "cultures", g: "Cultures", label: "Cultures / micro results reviewed" },
    { k: "antibiotics", g: "Antibiotics", label: "Antibiotic indication / de-escalation / stop date" },
    { k: "dvt", g: "Prophylaxis", label: "DVT prophylaxis prescribed" },
    { k: "ulcer", g: "Prophylaxis", label: "Stress-ulcer prophylaxis reviewed" },
    { k: "lines", g: "Lines", label: "Central/arterial lines — still needed?" },
    { k: "catheter", g: "Catheters", label: "Urinary catheter — still needed?" },
    { k: "drains", g: "Drains", label: "Drains reviewed" },
    { k: "family", g: "Family", label: "Family updated / counselling" },
    { k: "disposition", g: "Disposition", label: "Disposition / step-down plan" }
  ];
  function buildSummary(st) {
    var s = st || _raw, p = s.patient || {}, vits = s.vitals || [], lv = vits.length ? vits[vits.length - 1] : {}, L = s.labs && s.labs.recent || {}, g = s.abg || {}, f = s.fluids || {}, v = s.ventilator || {}, mp = (lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp)), rounds = s.rounds || {}, alerts = s.alerts || [], goals = s.goals || [], infusions = s.infusions || [], out = [];
    out.push("STEWARDMD — DAILY ICU SUMMARY");
    out.push((p.name || "ICU patient") + (p.age != null ? ", " + p.age + "y" : "") + (p.sex ? " " + p.sex : "") + (p.bed ? " · Bed " + p.bed : "") + (p.icuDay != null ? " · ICU day " + p.icuDay : ""));
    if (p.diagnosis) out.push("Diagnosis: " + p.diagnosis);
    out.push("");
    out.push("HAEMODYNAMICS: HR " + (lv.hr != null ? lv.hr : "—") + ", BP " + (lv.sbp != null ? lv.sbp + "/" + lv.dbp : "—") + ", MAP " + (mp != null ? mp : "—") + ", lactate " + (lv.lactate != null ? lv.lactate : "—") + (infusions.length ? ", pressors/infusions: " + infusions.map(function (i) { return i.drug; }).join(", ") : ""));
    if (g.ph != null) { var ab = analyzeABG(g, L); out.push("ABG: pH " + g.ph + " / pCO₂ " + g.paco2 + " / HCO₃ " + g.hco3 + (ab ? " → " + ab.primary : "")); }
    var keyL = ["na", "k", "creat", "hb", "plt", "ferritin"].filter(function (k) { return L[k] != null; }).map(function (k) { return k.toUpperCase() + " " + L[k]; });
    if (keyL.length) out.push("LABS: " + keyL.join(", "));
    if (f.net24h != null || f.cumulative != null) out.push("FLUIDS: net 24h " + (f.net24h != null ? f.net24h + " mL" : "—") + ", cumulative " + (f.cumulative != null ? f.cumulative + " mL" : "—"));
    if (v.mode) out.push("VENT: " + v.mode + (v.fio2 ? ", FiO₂ " + v.fio2 + "%" : "") + (v.peep != null ? ", PEEP " + v.peep : "") + (v.tv != null ? ", TV " + v.tv + " mL" : ""));
    if (alerts.length) out.push("\nACTIVE ALERTS:\n" + alerts.map(function (a) { return "• [" + a.severity.toUpperCase() + "] " + a.title + " — " + a.msg; }).join("\n"));
    var pend = ROUNDS_ITEMS.filter(function (it) { return !(rounds[it.k] && rounds[it.k].done); });
    if (pend.length) out.push("\nROUNDS PENDING: " + pend.map(function (it) { return it.label; }).join("; "));
    var notes = ROUNDS_ITEMS.filter(function (it) { return rounds[it.k] && rounds[it.k].note; }).map(function (it) { return "• " + it.label + ": " + rounds[it.k].note; });
    if (notes.length) out.push("\nROUNDS NOTES:\n" + notes.join("\n"));
    if (goals.length) out.push("\nGOALS:\n" + goals.map(function (x) { return "• " + x; }).join("\n"));
    out.push("\n— Decision support only; verify against the patient. StewardMD ICU.");
    return out.join("\n");
  }

  /* --------------------------------------------------------------- tabs */
  var TABS = [
    { id: "overview", ic: "❤️", label: "Overview" },
    { id: "hemo", ic: "🫀", label: "Hemo" },
    { id: "fluids", ic: "💧", label: "Fluids" },
    { id: "lytes", ic: "🧪", label: "Lytes" },
    { id: "abg", ic: "🩸", label: "ABG" },
    { id: "infusions", ic: "💉", label: "Infusions" },
    { id: "protocols", ic: "🚨", label: "Protocols" },
    { id: "vent", ic: "🫁", label: "Vent" },
    { id: "trends", ic: "📈", label: "Trends" },
    { id: "rounds", ic: "📋", label: "Rounds" }
  ];
  var _active = "overview";

  function row(label, val, unit) { return '<div class="icu-row"><span>' + esc(label) + '</span><b>' + (val == null || val === "" ? "—" : esc(val) + (unit ? " " + esc(unit) : "")) + "</b></div>"; }
  function phaseNote(p, what) { return '<div class="icu-card"><h3>' + esc(what) + '<span class="icu-phase">' + esc(p) + "</span></h3><p>Reads live from ICU_STATE. Full decision-support engine arrives in this phase.</p></div>"; }

  var RENDER = {
    overview: function () {
      var p = _raw.patient, alerts = _raw.alerts || [], f = _raw.fluids || {}, v = _raw.ventilator || {}, mp = curMap();
      var out = "";
      out += '<div class="icu-sec-lbl">🚨 Critical Alerts</div>';
      out += alerts.length ? alerts.map(alertCard).join("") : '<div class="icu-card"><p>No active alerts. Enter vitals/labs to populate the dashboard.</p></div>';
      out += '<div class="icu-sec-lbl">Snapshot</div><div class="icu-card">' +
        row("Diagnosis", p.diagnosis) +
        row("Shock status", mp == null ? null : (mp < 65 ? "Hypotensive (MAP " + mp + ")" : "MAP " + mp + " mmHg")) +
        row("Current pressors", (_raw.infusions || []).filter(function (i) { return /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine/i.test(i.drug || ""); }).map(function (i) { return i.drug; }).join(", ")) +
        row("Infusions running", (_raw.infusions || []).length || "0") +
        row("Net fluid (24h)", f.net24h, "mL") +
        row("Ventilator", v.mode ? v.mode + (v.fio2 ? " · FiO₂ " + v.fio2 + "%" : "") : "Not ventilated") +
        '</div>';
      out += '<div class="icu-sec-lbl">Today\'s ICU Goals</div><div class="icu-card">' +
        ((_raw.goals || []).length ? (_raw.goals).map(function (g) { return row("•", g); }).join("") : '<div class="icu-empty">No goals set</div>') +
        '<button class="icu-btn ghost" data-icu-act="edit:goals">＋ Edit goals</button></div>';
      return out;
    },
    hemo: function () {
      var lv = latestVitals(), h = interpretHemo(lv, _raw.infusions);
      return '<div class="icu-card"><h3>Hemodynamics</h3>' +
        row("MAP", h.map, "mmHg") + row("Shock index", h.si != null ? h.si.toFixed(2) : null) + row("Heart rate", lv.hr, "bpm") +
        row("BP", (lv.sbp != null ? lv.sbp + "/" + lv.dbp : null)) + row("Lactate", lv.lactate, "mmol/L") +
        row("Urine output", lv.uop, "mL/h") + row("On vasopressors", h.pressors.length ? h.pressors.map(function (p) { return p.drug; }).join(", ") : "No") +
        '<button class="icu-btn ghost" data-icu-act="edit:monitor">✎ Update vitals</button></div>' +
        recsCard("Interpretation & recommendations", h.recs, h.flags, ["Surviving Sepsis", "SCCM"]) +
        trendCard("MAP trend", mapSeries(_trendWin), { band: [65, 110], unit: "mmHg" }) +
        trendCard("Lactate trend", vitalSeries("lactate", _trendWin), { unit: "mmol/L" }) +
        winSelector() +
        '<button class="icu-btn" data-icu-act="calc:map">Open hemodynamic calculators</button>';
    },
    fluids: function () {
      var f = _raw.fluids || {}, r = analyzeFluids(f, _raw.patient, latestVitals());
      return '<div class="icu-card"><h3>Fluid Management</h3>' +
        row("Phase", r.phase) + row("Intake (24h)", f.intake24h, "mL") + row("Output (24h)", f.output24h, "mL") +
        row("Urine (24h)", f.urine24h, "mL") + r.rows.map(function (x) { return row(x[0], x[1]); }).join("") +
        '<button class="icu-btn ghost" data-icu-act="edit:flowsheet">✎ Update fluid balance</button></div>' +
        recsCard("Strategy & warnings", r.recs, r.flags, ["Surviving Sepsis", "ROSE concept", "KDIGO"]) +
        trendCard("Urine output trend", vitalSeries("uop", _trendWin), { unit: "mL/h" });
    },
    lytes: function () {
      var L = _raw.labs.recent || {}, p = _raw.patient || {};
      function f(k, lo, hi, clo, chi) { return { v: L[k], s: vstat(L[k], lo, hi, clo, chi) }; }
      var map = { na: f("na", 135, 145, 120, 160), k: f("k", 3.5, 5.0, 2.5, 6.0), cl: f("cl", 98, 107), hco3: f("hco3", 22, 28), ca: f("ca", 2.1, 2.6), mg: f("mg", 0.7, 1.0), po4: f("po4", 0.8, 1.5) };
      var labels = { na: "Sodium", k: "Potassium", cl: "Chloride", hco3: "Bicarbonate", ca: "Calcium", mg: "Magnesium", po4: "Phosphate" };
      var keys = ["na", "k", "cl", "hco3", "ca", "mg", "po4"];
      var hasAny = keys.some(function (k) { return L[k] != null && L[k] !== ""; });
      var out = '<div class="icu-sec-lbl">🧪 Electrolytes &amp; correction</div>';
      if (!hasAny) {
        return out + '<div class="icu-card"><div class="icu-empty">No electrolyte values entered yet.</div>' +
          '<button class="icu-btn" data-icu-act="edit:labs">✎ Enter electrolytes</button></div>';
      }
      var grid = '<div class="icu-vitals">' + Object.keys(map).map(function (k) { return vitalCard(labels[k], map[k].v, "", map[k].s); }).join("") + "</div>";
      // provenance line — where these electrolyte values came from + freshness
      var srcs = {}; keys.forEach(function (k) { var s = (_raw.src || {})[k]; if (s && L[k] != null) srcs[s.source] = Math.max(srcs[s.source] || 0, s.ts || 0); });
      var srcLine = Object.keys(srcs).length ? '<div class="icu-src">' + Object.keys(srcs).map(function (s) { return "📎 " + esc(s) + " · " + fmtAgo(srcs[s]); }).join("  ·  ") + "</div>" : "";
      grid += srcLine;
      // Correction guidance rendered INLINE (no redirect) — reuses the validated
      // Electrolyte Engine analyzers via ELYTE.analyze(); "si" = the mmol/L (albumin g/L)
      // units the Labs form collects. Each analyte is an expandable card.
      var pt = { weight: p.weightKg, age: p.age, sex: (String(p.sex).toLowerCase() === "f" ? "f" : "m") };
      var res = [];
      try { if (window.ELYTE && ELYTE.analyze) res = ELYTE.analyze(L, pt, "si"); } catch (e) { res = []; }
      var COLOR = { crit: "var(--danger)", red: "var(--danger)", amber: "var(--warn)", ok: "var(--ok)" };
      var cards = res.map(function (r) {
        var c = COLOR[r.level] || "var(--muted)", open = !!_lytesExp[r.name];
        return '<div class="icu-card" style="padding:0;overflow:hidden;border-left:3px solid ' + c + '">' +
          '<button data-icu-act="lyte:' + esc(r.name) + '" style="width:100%;display:flex;align-items:center;gap:8px;padding:12px 14px;background:none;border:none;cursor:pointer;color:var(--ink);text-align:left">' +
            '<b style="flex:1;font:800 14px var(--font)">' + esc(r.name) + (r.value != null ? ' <span style="color:var(--muted);font-weight:600">' + esc(r.value) + " " + esc(r.unit || "") + "</span>" : "") + '</b>' +
            '<span style="font:800 10px var(--font);text-transform:uppercase;letter-spacing:.03em;color:' + c + '">' + esc(r.severity) + '</span>' +
            '<span style="color:var(--muted);font-size:12px">' + (open ? "▲" : "▼") + '</span>' +
          '</button>' +
          (open ? '<div style="padding:0 14px 12px">' + (r.lines || []).map(function (ln) {
            return '<div class="icu-row"><span>' + esc(ln[0]) + '</span><b style="text-align:right;max-width:62%">' + esc(ln[1]) + "</b></div>";
          }).join("") + evidenceBadges(r.ev || []) + "</div>" : "") +
        '</div>';
      }).join("");
      return out + grid + '<div class="icu-sec-lbl" style="margin-top:8px">Correction targets · tap to expand</div>' + cards +
        '<div class="icu-card"><button class="icu-btn ghost" data-icu-act="edit:labs">✎ Update electrolytes</button>' +
        '<button class="icu-btn ghost" data-icu-act="launch:elyte">Open full Electrolyte Engine (all analytes · unit toggle)</button>' +
        '<p style="margin:8px 0 0;color:var(--muted);font:600 11px var(--font)">Interpreted as SI units (mmol/L; albumin g/L), as entered in Labs.</p></div>';
    },
    abg: function () {
      var g = _raw.abg || {}, L = _raw.labs.recent || {}, r = analyzeABG(g, L);
      var head = '<div class="icu-card"><h3>ABG &amp; Acid–Base</h3>' +
        row("pH", g.ph) + row("PaCO₂", g.paco2, "mmHg") + row("PaO₂", g.pao2, "mmHg") +
        row("HCO₃⁻", g.hco3, "mmol/L") + row("FiO₂", g.fio2, "%") + row("Base excess", g.be) +
        '<button class="icu-btn ghost" data-icu-act="edit:abg">✎ Update ABG</button></div>';
      if (!r) return head + '<div class="icu-card"><div class="icu-empty">Enter pH, PaCO₂ and HCO₃ to interpret. (Anion gap also uses Na/Cl/albumin from Labs.)</div></div>';
      var sev = /Mixed|acidosis/.test(r.primary) ? "warn" : "";
      return head + '<div class="icu-card"><h3>Interpretation</h3>' +
        '<div class="icu-alert ' + sev + '"><div><div class="at">' + esc(r.primary) + "</div>" + (r.comp ? '<div class="am">' + esc(r.comp) + "</div>" : "") + "</div></div>" +
        r.rows.map(function (x) { return row(x[0], x[1]); }).join("") +
        (r.flags.length ? r.flags.map(function (f) { return '<p style="margin:8px 0 0;color:var(--warn)">⚠ ' + esc(f) + "</p>"; }).join("") : "") +
        evidenceBadges(["Harrison", "Winter 1967"]) + "</div>";
    },
    infusions: function () {
      var inf = _raw.infusions || [];
      var common = ["Noradrenaline", "Adrenaline", "Vasopressin", "Dopamine", "Dobutamine", "Phenylephrine"];
      var list = inf.length ? '<div class="icu-card">' + inf.map(function (i) { return row(i.drug + (i.indication ? " · " + i.indication : ""), (i.rateMlHr != null ? i.rateMlHr + " mL/h" : (i.dose != null ? i.dose + " " + (i.unit || "") : ""))); }).join("") + "</div>"
        : '<div class="icu-card"><div class="icu-empty">No infusions recorded</div></div>';
      var quick = '<div class="icu-card"><div class="icu-sec-lbl" style="margin:0 0 8px">Quick vasopressors — tap for pump rate</div><div class="icu-vitals">' +
        common.map(function (d) { return '<button class="icu-vc" style="cursor:pointer;text-align:left;border-color:var(--primary-soft)" data-icu-act="drug:' + esc(d.toLowerCase()) + '"><div class="vl">weight-based</div><div class="vv" style="font:700 13px var(--font);color:var(--primary)">' + esc(d) + "</div></button>"; }).join("") + "</div>" +
        evidenceBadges(["Marino ICU", "Surviving Sepsis", "PADIS"]) +
        '<button class="icu-btn ghost" data-icu-act="edit:infusion">✎ Add infusion</button>' +
        '<button class="icu-btn" data-icu-act="launch:inf">Open full Infusion &amp; Vasopressor Calculator</button></div>';
      return '<div class="icu-sec-lbl">💉 Infusions</div>' + list + quick;
    },
    protocols: function () {
      return '<div class="icu-sec-lbl">🚨 Critical Care Protocols</div>' +
        PROTOCOLS.map(function (p, i) { return protocolCard(p, i); }).join("") +
        '<button class="icu-btn" data-icu-act="launch:protocols">Open full protocol / drug library</button>';
    },
    vent: function () {
      var v = _raw.ventilator || {}, iv = interpretVent(v, _raw.patient, _raw.abg);
      var extub = ["Cause of respiratory failure resolving", "Oxygenation on low support (FiO₂ ≤0.4, PEEP ≤5–8)", "Haemodynamically stable, minimal vasopressors", "Awake, following commands, protecting airway", "Adequate cough & manageable secretions", "Passed spontaneous breathing trial (RSBI <105)"];
      return '<div class="icu-card"><h3>Ventilator settings</h3>' +
        row("Mode", v.mode) + row("FiO₂", v.fio2, "%") + row("PEEP", v.peep, "cmH₂O") +
        row("Tidal volume", v.tv, "mL") + row("Resp rate", v.rr, "/min") + row("Plateau", v.plateau, "cmH₂O") +
        '<button class="icu-btn ghost" data-icu-act="edit:ventilator">✎ Update ventilator</button></div>' +
        '<div class="icu-card"><h3>Protective ventilation & ARDS</h3>' + iv.rows.map(function (x) { return row(x[0], x[1]); }).join("") + evidenceBadges(["ARDSNet", "ESICM"]) + "</div>" +
        recsCard("Recommendations", iv.recs, iv.flags, ["ARDSNet", "ESICM"]) +
        '<div class="icu-card"><h3>Extubation readiness</h3>' + extub.map(function (t) { return '<div class="icu-row"><span>' + esc(t) + '</span><b>☐</b></div>'; }).join("") + evidenceBadges(["ESICM", "SCCM"]) + "</div>";
    },
    trends: function () {
      var w = _trendWin, metrics = [
        ["Heart rate", vitalSeries("hr", w), { unit: "bpm" }],
        ["MAP", mapSeries(w), { band: [65, 110], unit: "mmHg" }],
        ["SpO₂", vitalSeries("spo2", w), { band: [92, 100], unit: "%" }],
        ["Respiratory rate", vitalSeries("rr", w), { unit: "/min" }],
        ["Temperature", vitalSeries("temp", w), { unit: "°C" }],
        ["Urine output", vitalSeries("uop", w), { unit: "mL/h" }],
        ["Lactate", vitalSeries("lactate", w), { unit: "mmol/L" }],
        ["Creatinine", labSeries("creat", w), { unit: "" }],
        ["Potassium", labSeries("k", w), { unit: "mmol/L" }],
        ["Sodium", labSeries("na", w), { unit: "mmol/L" }]
      ];
      return winSelector() + metrics.map(function (m) { return trendCard(m[0], m[1], m[2]); }).join("");
    },
    rounds: function () {
      var done = 0; ROUNDS_ITEMS.forEach(function (it) { if (_raw.rounds[it.k] && _raw.rounds[it.k].done) done++; });
      var groups = {}, order = []; ROUNDS_ITEMS.forEach(function (it) { if (!groups[it.g]) { groups[it.g] = []; order.push(it.g); } groups[it.g].push(it); });
      var body = order.map(function (g) {
        return '<div class="icu-sec-lbl" style="margin:8px 0 2px">' + esc(g) + "</div>" + groups[g].map(function (it) {
          var r = _raw.rounds[it.k] || {};
          return '<div class="icu-row" style="align-items:center;gap:8px"><button data-icu-act="round:' + it.k + '" style="border:none;background:none;cursor:pointer;font-size:19px;line-height:1;color:' + (r.done ? "var(--ok)" : "var(--muted)") + '">' + (r.done ? "☑" : "☐") + "</button>" +
            '<span style="flex:1">' + esc(it.label) + (r.note ? ' <span style="color:var(--muted);font-size:12px">— ' + esc(r.note) + "</span>" : "") + "</span>" +
            '<button data-icu-act="roundnote:' + it.k + '" style="border:none;background:none;color:var(--primary);cursor:pointer;font-size:14px">✎</button></div>';
        }).join("");
      }).join("");
      return '<div class="icu-card"><h3>Daily ICU Rounds <span class="icu-phase">' + done + "/" + ROUNDS_ITEMS.length + " done</span></h3>" + body + "</div>" +
        '<button class="icu-btn" data-icu-act="gensummary">📋 Generate Daily ICU Summary</button>';
    }
  };

  /* ---------------------------------------------------------- shell render */
  var rootEl = null;
  function renderHeader() {
    var p = _raw.patient;
    var meta = [];
    if (p.age != null) meta.push("<b>" + esc(p.age) + "</b>y");
    if (p.sex) meta.push("<b>" + esc(p.sex) + "</b>");
    if (p.weightKg != null) meta.push("<b>" + esc(p.weightKg) + "</b>kg");
    if (p.bed) meta.push("Bed <b>" + esc(p.bed) + "</b>");
    if (p.icuDay != null) meta.push("ICU day <b>" + esc(p.icuDay) + "</b>");
    if (p.hospital) meta.push(esc(p.hospital));
    if (p.diagnosis) meta.push("<b>" + esc(p.diagnosis) + "</b>");
    var n = rosterCount();
    return '<div class="icu-hd"><div class="icu-hd-top">' +
      '<div class="icu-hd-name">' + (p.name ? esc(p.name) : "ICU Patient") + (p.status ? ' · <span style="font-weight:600;color:var(--muted)">' + esc(p.status) + "</span>" : "") + "</div>" +
      '<button class="icu-x" data-icu-act="close" aria-label="Close ICU">✕</button>' +
      '</div><div class="icu-hd-meta">' + (meta.length ? meta.join("<span>·</span>") : "Tap ✎ Patient, then ＋ Enter data below") + "</div>" +
      '<div class="icu-hd-actions">' +
        '<button class="icu-chip" data-icu-act="edit:patient">✎ Patient</button>' +
        '<button class="icu-chip" data-icu-act="savept">💾 Save</button>' +
        '<button class="icu-chip" data-icu-act="patients">📋 Patients' + (n ? " (" + n + ")" : "") + '</button>' +
        '<button class="icu-chip" data-icu-act="sharecase">📤 Share</button>' +
        '<button class="icu-chip" data-icu-act="clearfindings">🧹 Clear</button>' +
        '<button class="icu-chip" data-icu-act="newpt">＋ New</button>' +
      '</div></div>';
  }
  function renderTabBar() {
    return '<div class="icu-tabs">' + TABS.map(function (t) {
      return '<button class="icu-tab ' + (t.id === _active ? "on" : "") + '" data-icu-act="tab:' + t.id + '"><span class="ti">' + t.ic + '</span><span class="tl">' + t.label + "</span></button>";
    }).join("") + "</div>";
  }
  // one-line vitals summary for the collapsed status on non-overview tabs
  function liveSummaryLine() {
    var lv = latestVitals(), L = _raw.labs.recent || {}, mp = curMap();
    function v(x, u) { return (x == null || x === "") ? "—" : x + (u || ""); }
    return '❤️ Vitals &amp; status' +
      '<span class="vs-k">HR</span> ' + v(lv.hr) + '<span class="vs-k">MAP</span> ' + v(mp) +
      '<span class="vs-k">SpO₂</span> ' + v(lv.spo2, "%") + '<span class="vs-k">K⁺</span> ' + v(L.k);
  }
  // human "x min ago" for source freshness (no Date.now in template — uses nowTs)
  function fmtAgo(ts) {
    if (!ts) return "";
    var s = Math.max(0, Math.round((nowTs() - ts) / 1000));
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago"; return Math.floor(s / 86400) + " d ago";
  }
  // Ward Sync status — non-technical, never shows raw API errors.
  function renderWardBanner() {
    var w = _raw.wardSync || {}; var loggedIn = false;
    try { loggedIn = !!localStorage.getItem("ghis_token"); } catch (e) {}
    var s;
    if (w.connected && w.lastTs) s = { c: "ok", t: "🟢 Ward Sync connected · synced " + fmtAgo(w.lastTs) };
    else if (loggedIn) s = { c: "muted", t: "Ward Sync · no ward data for this patient" };
    else s = { c: "muted", t: "Sign in to Ward Sync to auto-fill this patient", act: "wardsync" };
    return '<div class="icu-ward' + (s.c === "ok" ? " on" : "") + '"' + (s.act ? ' data-icu-act="' + s.act + '" style="cursor:pointer"' : "") + '>' + s.t + "</div>" +
      (w.newUpdate ? '<div class="icu-ward-new" data-icu-act="dismissupdate">🔵 New laboratory update detected — widgets refreshed. Tap to dismiss.</div>' : "");
  }
  // Ward-vs-manual conflicts (clinician resolves; never auto-overwritten).
  function renderConflicts() {
    var cs = _raw.conflicts || []; if (!cs.length) return "";
    return '<div class="icu-sec-lbl">⚠️ Value conflicts — your choice</div>' + cs.map(function (c) {
      return '<div class="icu-card" style="border-left:3px solid var(--warn)"><b>' + esc(c.label) + '</b>' +
        '<div class="icu-row"><span>Ward Sync (' + fmtAgo(c.wardTs) + ')</span><b>' + esc(c.ward) + "</b></div>" +
        '<div class="icu-row"><span>Your manual entry (' + fmtAgo(c.manualTs) + ')</span><b>' + esc(c.manual) + "</b></div>" +
        '<div style="display:flex;gap:8px;margin-top:8px"><button class="icu-btn" data-icu-act="conflict:' + esc(c.key) + '|ward">Use Ward value</button>' +
        '<button class="icu-btn" data-icu-act="conflict:' + esc(c.key) + '|manual">Keep mine</button></div></div>';
    }).join("");
  }
  // Compact electrolyte/renal alert summary from the deterministic ELYTE engine.
  function renderElyteAlerts() {
    var L = _raw.labs.recent || {}, p = _raw.patient || {}, res = [];
    try { if (window.ELYTE && ELYTE.analyze) res = ELYTE.analyze(L, { weight: p.weightKg, age: p.age, sex: (String(p.sex).toLowerCase() === "f" ? "f" : "m") }, "si"); } catch (e) {}
    var ab = res.filter(function (r) { return r.level && r.level !== "ok"; });
    if (!ab.length) return "";
    var COLOR = { crit: "var(--danger)", red: "var(--danger)", amber: "var(--warn)" };
    return '<div class="icu-elyte-alerts">⚠️ Electrolyte alerts: ' + ab.map(function (r) {
      // name + severity word only — the grid below shows the numeric value + units
      // (r.value from ELYTE is in its own display units, so we don't repeat it here).
      return '<span class="icu-elyte-pill" style="border-color:' + (COLOR[r.level] || "var(--muted)") + ';color:' + (COLOR[r.level] || "var(--ink)") + '">' + esc(r.name) + (r.severity ? " · " + esc(r.severity) : "") + "</span>";
    }).join("") + '</div>';
  }
  function renderBody() {
    var tab = "", isOv = _active === "overview";
    try { tab = RENDER[_active] ? RENDER[_active]() : ""; } catch (e) { tab = '<div class="icu-card"><p>Tab error.</p></div>'; }
    // Overview: full vitals grid. Other tabs: collapse it behind a compact summary
    // so the tab's own content is immediately visible (was buried below the grid).
    var status = isOv ? renderLiveStatus()
      : '<details class="icu-vitals-c"><summary>' + liveSummaryLine() + '</summary>' + renderLiveStatus() + '</details>';
    var elyteAlerts = (isOv || _active === "lytes") ? renderElyteAlerts() : "";
    return '<div class="icu-scroll"><div class="icu-wrap">' +
      renderWardBanner() +
      renderConflicts() +
      elyteAlerts +
      status +
      '<button class="icu-adddata" data-icu-act="adddata">＋ Enter / update patient data</button>' +
      (isOv ? renderAIImport() : "") +
      tab +   // each tab renders its own descriptive header — no redundant generic label
      '</div></div>';
  }
  function paint() {
    if (!rootEl) return;
    rootEl.innerHTML = renderHeader() + renderBody() + '<button id="icuSnap" data-icu-act="snapshot" aria-label="ICU Snapshot">📷</button>' + renderTabBar();
  }

  /* ---------------------------------------------------- manual entry forms */
  var FORMS = {
    patient: { title: "Patient details", domain: "patient", fields: [
      { k: "name", l: "Name / initials", t: "text" }, { k: "age", l: "Age", t: "number" }, { k: "sex", l: "Sex", t: "select", opts: ["", "M", "F", "Other"] },
      { k: "weightKg", l: "Weight (kg)", t: "number" }, { k: "heightCm", l: "Height (cm)", t: "number" }, { k: "bed", l: "Bed", t: "text" },
      { k: "icuDay", l: "ICU day", t: "number" }, { k: "hospital", l: "Hospital", t: "text" }, { k: "diagnosis", l: "Diagnosis", t: "text", wide: true }, { k: "status", l: "Current status", t: "text", wide: true } ] },
    monitor: { title: "Vitals (ICU monitor)", ingest: ingestMonitor, fields: [
      { k: "hr", l: "Heart rate", t: "number" }, { k: "sbp", l: "Systolic BP", t: "number" }, { k: "dbp", l: "Diastolic BP", t: "number" }, { k: "map", l: "MAP (optional)", t: "number" },
      { k: "rr", l: "Resp rate", t: "number" }, { k: "spo2", l: "SpO₂ %", t: "number" }, { k: "temp", l: "Temp °C", t: "number" }, { k: "uop", l: "Urine mL/h", t: "number" },
      { k: "lactate", l: "Lactate mmol/L", t: "number" }, { k: "cvp", l: "CVP mmHg", t: "number" }, { k: "etco2", l: "EtCO₂ mmHg", t: "number" } ] },
    labs: { title: "Laboratory values", ingest: ingestLabs, fields: [
      { k: "na", l: "Na mmol/L", t: "number" }, { k: "k", l: "K mmol/L", t: "number" }, { k: "cl", l: "Cl mmol/L", t: "number" }, { k: "hco3", l: "HCO₃ mmol/L", t: "number" },
      { k: "ca", l: "Ca mmol/L", t: "number" }, { k: "mg", l: "Mg mmol/L", t: "number" }, { k: "po4", l: "PO₄ mmol/L", t: "number" }, { k: "creat", l: "Creatinine", t: "number" },
      { k: "alb", l: "Albumin g/L", t: "number" }, { k: "glu", l: "Glucose", t: "number" }, { k: "wbc", l: "WBC", t: "number" }, { k: "hb", l: "Hb g/dL", t: "number" },
      { k: "plt", l: "Platelets", t: "number" }, { k: "ferritin", l: "Ferritin", t: "number" }, { k: "crp", l: "CRP", t: "number" }, { k: "inr", l: "INR", t: "number" } ] },
    abg: { title: "Arterial blood gas", ingest: function (o) { Object.keys(o).forEach(function (k) { STATE.abg[k] = o[k]; }); STATE.abg.ts = nowTs(); }, fields: [
      { k: "ph", l: "pH", t: "number" }, { k: "paco2", l: "PaCO₂ mmHg", t: "number" }, { k: "pao2", l: "PaO₂ mmHg", t: "number" }, { k: "hco3", l: "HCO₃ mmol/L", t: "number" }, { k: "fio2", l: "FiO₂ %", t: "number" }, { k: "be", l: "Base excess", t: "number" } ] },
    ventilator: { title: "Ventilator settings", ingest: ingestVentilator, fields: [
      { k: "mode", l: "Mode", t: "text" }, { k: "fio2", l: "FiO₂ %", t: "number" }, { k: "peep", l: "PEEP cmH₂O", t: "number" }, { k: "tv", l: "Tidal volume mL", t: "number" },
      { k: "rr", l: "Resp rate", t: "number" }, { k: "plateau", l: "Plateau cmH₂O", t: "number" }, { k: "drivingP", l: "Driving pressure", t: "number" }, { k: "compliance", l: "Compliance", t: "number" } ] },
    flowsheet: { title: "Fluid balance", ingest: ingestFlowsheet, fields: [
      { k: "intake24h", l: "Intake (24h) mL", t: "number" }, { k: "output24h", l: "Output (24h) mL", t: "number" }, { k: "urine24h", l: "Urine (24h) mL", t: "number" },
      { k: "drains", l: "Drains mL", t: "number" }, { k: "cumulative", l: "Cumulative mL", t: "number" }, { k: "strategyPhase", l: "Strategy", t: "select", opts: ["", "Resuscitation", "Maintenance", "Conservative", "Deresuscitation"] } ] },
    infusion: { title: "Add infusion", custom: "infusion", fields: [
      { k: "drug", l: "Drug", t: "text", wide: true }, { k: "dose", l: "Dose", t: "number" }, { k: "unit", l: "Unit", t: "text" }, { k: "rateMlHr", l: "Rate mL/h", t: "number" }, { k: "indication", l: "Indication", t: "text", wide: true } ] },
    goals: { title: "Today's ICU goals", custom: "goals", fields: [{ k: "goals", l: "One goal per line", t: "textarea", wide: true }] }
  };

  var modalEl = null;
  function openForm(domain) {
    var F = FORMS[domain]; if (!F) return;
    ensureModal();
    var cur = domain === "patient" ? _raw.patient : domain === "abg" ? _raw.abg : domain === "ventilator" ? _raw.ventilator : domain === "flowsheet" ? _raw.fluids : domain === "labs" ? _raw.labs.recent : {};
    var fieldsHTML = F.fields.map(function (f) {
      var v = (F.custom === "goals") ? (_raw.goals || []).join("\n") : (cur[f.k] != null ? cur[f.k] : "");
      var inp;
      if (f.t === "select") inp = '<select data-k="' + f.k + '">' + f.opts.map(function (o) { return '<option' + (String(o) === String(v) ? " selected" : "") + ">" + esc(o || "—") + "</option>"; }).join("") + "</select>";
      else if (f.t === "textarea") inp = '<textarea data-k="' + f.k + '" rows="5" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(v) + "</textarea>";
      else inp = '<input data-k="' + f.k + '" type="' + (f.t === "number" ? "number" : "text") + '" step="any" value="' + esc(v) + '">';
      return '<div class="icu-fld" style="' + (f.wide ? "grid-column:1/-1" : "") + '"><label>' + esc(f.l) + "</label>" + inp + "</div>";
    }).join("");
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + esc(F.title) + '</h3><div class="icu-grid2">' + fieldsHTML + "</div>" +
      '<button class="icu-btn" data-icu-act="save:' + domain + '">Save</button><button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function closeForm() { if (modalEl) modalEl.classList.remove("on"); }
  function saveForm(domain) {
    var F = FORMS[domain]; if (!F || !modalEl) return;
    var inputs = modalEl.querySelectorAll("[data-k]"), obj = {};
    inputs.forEach(function (el) { var k = el.getAttribute("data-k"), val = el.value; obj[k] = (el.type === "number") ? num(val) : val; });
    if (F.custom === "goals") { STATE.goals = (obj.goals || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
    else if (F.custom === "infusion") { if (obj.drug) STATE.infusions.push({ drug: obj.drug, dose: num(obj.dose), unit: obj.unit, rateMlHr: num(obj.rateMlHr), indication: obj.indication }); }
    else if (domain === "patient") { ingestPatient(obj); }
    else if (F.ingest) { F.ingest(obj); }
    // tag manually-entered fields as a Manual source so Ward Sync never silently
    // overwrites a clinician override (it records a conflict instead).
    if (F.custom !== "goals" && F.custom !== "infusion" && domain !== "patient") {
      var mts = nowTs();
      Object.keys(obj).forEach(function (k) { if (obj[k] != null && obj[k] !== "") STATE.src[k] = { source: "Manual", ts: mts }; });
    }
    closeForm();
  }

  /* ----------------------------------------------------------- snapshot */
  function openSnapshot() {
    ensureModal();
    var ai = !!(window.SMD_AI && window.SMD_AI.on && window.SMD_AI.on());
    var steps = [["📷", "ICU Monitor", "monitor"], ["🫁", "Ventilator", "ventilator"], ["🩸", "Laboratory Report", "labs"], ["📋", "ICU Flow Sheet", "flowsheet"]];
    modalEl.innerHTML = '<div class="icu-sheet"><h3>📷 ICU Snapshot</h3>' +
      '<div class="icu-steps">' + steps.map(function (s, i) {
        return '<div class="icu-step"><div class="n">' + (i + 1) + '</div><div style="flex:1"><div style="font:700 14px var(--font)">' + s[0] + " Capture " + s[1] + "</div>" +
          (ai
            ? '<label class="icu-btn" style="display:inline-flex;width:auto;margin:6px 8px 0 0;padding:7px 12px;font-size:12px;cursor:pointer">📷 Capture / upload<input type="file" accept="image/*" capture="environment" data-snap="' + s[2] + '" style="display:none"></label><span class="man" data-icu-act="edit:' + s[2] + '" style="color:var(--primary);font:700 12px var(--font)">or ✎ enter manually</span><div class="snap-out" data-out="' + s[2] + '" style="font:600 11px var(--font);color:var(--muted);margin-top:4px"></div>'
            : '<span class="man" data-icu-act="edit:' + s[2] + '" style="color:var(--primary);font:700 12px var(--font)">✎ Enter manually for now</span>') +
          "</div></div>";
      }).join("") + "</div>" +
      (ai
        ? '<div class="icu-card" style="margin-top:12px"><span class="icu-badge" style="background:var(--ok-soft);color:var(--ok)">✨ AI Vision ON</span><p style="margin-top:8px">Capture each screen — Gemini reads it and fills the ICU tabs via ICU_STATE. <b>Verify every value.</b></p></div>'
        : '<div class="icu-card" style="margin-top:12px;text-align:center"><span class="icu-badge">🚧 AI Vision Integration · Coming Soon</span><p style="margin-top:8px">Enable AI (<code>SMD_AI.setFlag(true)</code>) and set the GEMINI_API_KEY secret to auto-read these images into ICU_STATE.</p></div>') +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
    if (ai) {
      var ING = { monitor: "ingestMonitor", labs: "ingestLabs", ventilator: "ingestVentilator", flowsheet: "ingestFlowsheet" };
      modalEl.querySelectorAll("input[data-snap]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var kind = inp.getAttribute("data-snap"), out = modalEl.querySelector('[data-out="' + kind + '"]');
          var f = inp.files && inp.files[0]; if (!f) return; if (out) out.textContent = "✨ Reading…";
          var rd = new FileReader();
          rd.onload = function () {
            window.SMD_AI.vision(rd.result, kind).then(function (r) {
              if (r && r.fields && Object.keys(r.fields).length) {
                try { if (ICU[ING[kind]]) ICU[ING[kind]](r.fields); } catch (e) {}
                if (out) out.textContent = "✓ Imported: " + Object.keys(r.fields).join(", ") + " — verify in the tabs.";
              } else if (out) out.textContent = "Couldn't read that image" + (r && r.error ? " (" + r.error + ")" : "") + " — try again or enter manually.";
            });
          };
          rd.readAsDataURL(f);
        });
      });
    }
  }

  function ensureModal() { if (!modalEl) { modalEl = document.createElement("div"); modalEl.className = "icu-modal"; modalEl.id = "icuModal"; document.body.appendChild(modalEl); modalEl.addEventListener("click", function (e) { if (e.target === modalEl) closeForm(); }); modalEl.addEventListener("click", onClick); } }
  function openRoundNote(k) {
    ensureModal();
    var it = ROUNDS_ITEMS.filter(function (x) { return x.k === k; })[0] || { label: k };
    var cur = (_raw.rounds[k] || {}).note || "";
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + esc(it.label) + '</h3><div class="icu-fld"><label>Note</label><textarea data-k="note" rows="4" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(cur) + "</textarea></div>" +
      '<button class="icu-btn" data-icu-act="saveroundnote:' + k + '">Save note</button><button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function saveRoundNote(k) { if (!modalEl) return; var ta = modalEl.querySelector("[data-k=note]"); var cur = _raw.rounds[k] || {}; STATE.rounds[k] = { done: !!cur.done, note: ta ? ta.value : "" }; closeForm(); }
  function openSummary() {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet"><h3>📋 Daily ICU Summary</h3><pre id="icuSummaryText" style="white-space:pre-wrap;font:500 12.5px/1.55 var(--mono);background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:12px;color:var(--ink);max-height:52vh;overflow:auto">' + esc(buildSummary()) + "</pre>" +
      '<button class="icu-btn" data-icu-act="copysummary">📋 Copy</button>' +
      '<button class="icu-btn" data-icu-act="sharecase">📤 Share</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
  }
  function copySummary() { var pre = modalEl && modalEl.querySelector("#icuSummaryText"); var t = pre ? pre.textContent : buildSummary(); try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t); } catch (e) {} if (window.toast) toast("Summary copied"); }

  /* --------------------------------------------------- share & clear findings */
  // Share a case exactly like the Clinical Reasoning dashboard: Web Share API
  // (system share sheet) with a clipboard-copy fallback where it isn't supported.
  function shareText(title, txt) {
    try { if (navigator.share) { navigator.share({ title: title, text: txt }).catch(function () {}); return true; } } catch (e) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); if (window.toast) toast("Case summary copied — sharing not supported here"); return true; } } catch (e) {}
    return false;
  }
  function shareCase() { if (!shareText("StewardMD ICU — " + (_raw.patient.name || "ICU patient"), buildSummary())) openSummary(); }
  function sharePatient(id) {
    if (!id || id === _raw.patient._id) { shareCase(); return; }
    var r = loadRoster(), e = null, i; for (i = 0; i < r.length; i++) { if (r[i].id === id) { e = r[i]; break; } }
    if (e && e.state) { shareText("StewardMD ICU — " + (e.name || "patient"), buildSummary(e.state)); return; }
    cloudGet(id).then(function (j) { if (j && j.case && j.case.state) shareText("StewardMD ICU — " + (j.case.name || "patient"), buildSummary(j.case.state)); else if (window.toast) toast("Couldn't load that case"); });
  }
  function openClearConfirm() {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet"><h3>🧹 Clear current findings?</h3>' +
      '<p style="margin:0 0 14px;color:var(--muted);font:600 13px var(--font)">Resets everything entered on the dashboard (vitals, labs, ABG, ventilator, fluids, infusions, rounds, goals) so you can start a fresh assessment. Your saved patients are not affected.</p>' +
      '<button class="icu-btn" data-icu-act="clearconfirm" style="background:var(--danger);background-image:none;box-shadow:none">Clear findings</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function clearFindings() { ICU.reset(); _lytesExp = {}; _active = "overview"; closeForm(); paint(); if (window.toast) toast("Findings cleared"); }

  /* -------------------------------------------------- launch embedded modules */
  // Raise the target overlay above the ICU surface, then open it via its existing
  // public API. Preserves the existing modules exactly (no rewrite).
  function launch(fn, overlayId) {
    try { var o = document.getElementById(overlayId); if (o) o.style.zIndex = "10030"; } catch (e) {}
    try { fn(); } catch (e) { if (window.toast) toast("Module still loading…"); }
  }

  /* ------------------------------------------ patient roster (save / load old) */
  // A patient is one full ICU_STATE snapshot, keyed by a stable _id. Cases are
  // saved to the CLOUD (KV, via /api/cases, capped at MAX_CASES) so they follow
  // the clinician across devices, and MIRRORED to localStorage so the dashboard
  // still works offline / before any KV is bound. The live working state stays
  // in `stewardmd_icu_state`.
  // On-device roster is namespaced PER signed-in Google account so two clinicians
  // sharing one physical device never see each other's saved patients (the cloud
  // store is already per-user; this closes the local-mirror gap on a shared device).
  var ROSTER_BASE = "stewardmd_icu_patients";     // legacy (unscoped) key — migrated once
  var OWNER_KEY = "stewardmd_icu_owner";          // uid that owns the on-device state right now
  var MAX_CASES = 10;
  var CASES_API = "/api/cases";
  var _cloud = { enabled: null };   // null = not yet probed; true / false after a call
  function ownerNow() {
    try { var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
      if (a && a.currentUser && a.currentUser.uid) return a.currentUser.uid; } catch (e) {}
    return "anon";
  }
  function rosterKey(owner) { return ROSTER_BASE + ":" + (owner || ownerNow()); }
  function loadRoster() { try { var r = JSON.parse(localStorage.getItem(rosterKey())); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function saveRoster(r) { try { localStorage.setItem(rosterKey(), JSON.stringify(r)); } catch (e) {} }
  // React to sign-in / sign-out / account-switch. Only ever called from Firebase's
  // onAuthStateChanged (a RELIABLE, resolved signal) — never from the transient
  // "firebase not loaded yet" state — so we don't wipe a user's own work at startup.
  function reconcileOwner() {
    var now = ownerNow(), stored = null;
    try { stored = localStorage.getItem(OWNER_KEY); } catch (e) {}
    if (stored == null) {
      // First run under the scoped scheme: migrate the legacy shared bucket into
      // THIS device's current owner once (data preserved, not destroyed).
      try {
        var legacy = localStorage.getItem(ROSTER_BASE);
        if (legacy && !localStorage.getItem(rosterKey(now))) localStorage.setItem(rosterKey(now), legacy);
        if (legacy) localStorage.removeItem(ROSTER_BASE);
      } catch (e) {}
    } else if (stored !== now) {
      if (stored === "anon" && now !== "anon") {
        // Signing in from an anon session → claim the anon buffer/roster (keep work).
        try { var anon = localStorage.getItem(rosterKey("anon"));
          if (anon && !localStorage.getItem(rosterKey(now))) localStorage.setItem(rosterKey(now), anon);
          localStorage.removeItem(rosterKey("anon")); } catch (e) {}
      } else {
        // Real account switch or sign-out → wipe the live working buffer so the
        // previous clinician's open patient is not visible to this account.
        try { if (typeof ICU !== "undefined" && ICU.reset) ICU.reset(); } catch (e) {}
      }
    }
    try { localStorage.setItem(OWNER_KEY, now); } catch (e) {}
    try { if (typeof ICU !== "undefined" && ICU.isOpen && ICU.isOpen()) paint(); } catch (e) {}
  }
  function capTen(r) { if (r.length <= MAX_CASES) return r; return r.slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); }).slice(0, MAX_CASES); }
  function rosterCount() { return loadRoster().length; }
  function fmtWhen(ts) { if (!ts) return ""; try { var d = new Date(ts); return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

  // ---- cloud transport (best-effort; every call degrades to localStorage) ----
  // Cases are PHI and stored PER USER server-side, so every call carries the
  // signed-in clinician's Firebase ID token. Signed out (or Firebase not yet
  // loaded) → no token → server reports enabled:false → on-device fallback.
  function idToken() {
    try {
      var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
      if (a && a.currentUser && a.currentUser.getIdToken) return a.currentUser.getIdToken();
    } catch (e) {}
    return Promise.resolve(null);
  }
  function cloudFetch(path, opts) {
    return idToken().then(function (t) {
      var headers = { "Content-Type": "application/json" };
      if (t) headers["Authorization"] = "Bearer " + t;
      return fetch(CASES_API + (path || ""), Object.assign({ headers: headers, credentials: "same-origin" }, opts || {}));
    });
  }
  function cloudList() {
    return cloudFetch("").then(function (r) { return r.json(); }).then(function (j) { _cloud.enabled = !!(j && j.enabled); return j || {}; }).catch(function () { _cloud.enabled = false; return { enabled: false }; });
  }
  function cloudSave(entry) { return cloudFetch("/" + encodeURIComponent(entry.id), { method: "PUT", body: JSON.stringify(entry) }).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function cloudGet(id) { return cloudFetch("/" + encodeURIComponent(id)).then(function (r) { return r.json(); }).catch(function () { return null; }); }
  function cloudDel(id) { return cloudFetch("/" + encodeURIComponent(id), { method: "DELETE" }).then(function (r) { return r.json(); }).catch(function () { return null; }); }

  function savePatient() {
    var id = _raw.patient._id || ("p" + nowTs());
    STATE.patient._id = id;                                  // reactive write persists live state
    var snap = clone(_raw); snap.alerts = [];                // derived; recomputed on load
    var entry = { id: id, name: _raw.patient.name || "Unnamed", dx: _raw.patient.diagnosis || "", bed: _raw.patient.bed || "", savedAt: nowTs(), state: snap };
    // 1) local mirror (immediate, offline-safe), capped at MAX_CASES
    var r = loadRoster(), found = false, i;
    for (i = 0; i < r.length; i++) { if (r[i].id === id) { r[i] = entry; found = true; break; } }
    if (!found) r.push(entry);
    saveRoster(capTen(r));
    paint();
    // 2) cloud (best-effort) — server enforces the same MAX_CASES cap
    cloudSave(entry).then(function (res) {
      if (res && res.ok) { _cloud.enabled = true; if (window.toast) toast(found ? "Updated · saved to cloud ☁︎" : "Saved to cloud ☁︎"); }
      else { if (window.toast) toast(found ? "Updated (saved on this device)" : "Saved on this device"); }
      paint();
    });
  }
  function applyState(d, id) {
    Object.keys(DEFAULT_STATE).forEach(function (k) { STATE[k] = (d[k] != null) ? clone(d[k]) : clone(DEFAULT_STATE[k]); });
    STATE.patient._id = id;
    _lytesExp = {}; _active = "overview"; closeForm(); paint();
  }
  function loadPatient(id) {
    var r = loadRoster(), e = null, i;
    for (i = 0; i < r.length; i++) { if (r[i].id === id) { e = r[i]; break; } }
    if (e && e.state) { applyState(e.state, id); if (window.toast) toast("Loaded " + (e.name || "patient")); return; }
    // not held locally → pull the full case from the cloud
    cloudGet(id).then(function (j) {
      if (j && j.case && j.case.state) { applyState(j.case.state, id); if (window.toast) toast("Loaded " + (j.case.name || "patient")); }
      else if (window.toast) toast("Couldn't load that case");
    });
  }
  function deletePatient(id) {
    saveRoster(loadRoster().filter(function (x) { return x.id !== id; }));
    cloudDel(id).then(function () { openRoster(); });
    openRoster();                                            // optimistic refresh
  }
  function newPatient() {
    ICU.reset();
    _lytesExp = {}; _active = "overview"; closeForm(); paint();
    openForm("patient");
  }
  function renderRoster(list, cloudOn) {
    if (!modalEl) return;
    var r = list.slice().sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });
    var items = r.length ? r.map(function (e) {
      var cur = (e.id === _raw.patient._id);
      return '<div class="icu-row" style="align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<button data-icu-act="loadpt:' + esc(e.id) + '" style="flex:1;text-align:left;border:none;background:none;cursor:pointer;color:var(--ink)">' +
          '<div style="font:800 14px var(--font)">' + esc(e.name || "Unnamed") + (cur ? ' <span style="color:var(--primary);font-size:11px">• current</span>' : "") + '</div>' +
          '<div style="font:600 12px var(--font);color:var(--muted)">' + (e.dx ? esc(e.dx) : "No diagnosis") + (e.bed ? " · Bed " + esc(e.bed) : "") + " · " + esc(fmtWhen(e.savedAt)) + '</div>' +
        '</button>' +
        '<button data-icu-act="sharept:' + esc(e.id) + '" aria-label="Share case" title="Share" style="border:none;background:none;color:var(--primary);cursor:pointer;font-size:15px;padding:6px">📤</button>' +
        '<button data-icu-act="delpt:' + esc(e.id) + '" aria-label="Delete patient" title="Delete" style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:16px;padding:6px">🗑</button></div>';
    }).join("") : '<div class="icu-empty">No saved patients yet. Enter patient details, then tap 💾 Save.</div>';
    var status = cloudOn === true ? "☁︎ Synced to your cloud" : cloudOn === false ? "📱 Saved on this device (cloud unavailable)" : "…checking cloud";
    modalEl.innerHTML = '<div class="icu-sheet"><h3>📋 Saved patients <span class="icu-phase">' + r.length + "/" + MAX_CASES + "</span></h3>" +
      '<div style="font:600 11px var(--font);color:var(--muted);margin:-6px 0 8px">' + status + " · max " + MAX_CASES + " cases (oldest is replaced)</div>" +
      '<div style="max-height:50vh;overflow:auto;margin-bottom:10px">' + items + "</div>" +
      '<button class="icu-btn" data-icu-act="newpt">＋ New patient</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
  }
  function openRoster() {
    ensureModal();
    renderRoster(loadRoster(), _cloud.enabled);              // instant, from the local mirror
    cloudList().then(function (j) {                          // then reconcile with the cloud
      if (j && j.enabled && Array.isArray(j.cases)) {
        var local = loadRoster(), byId = {}; local.forEach(function (x) { byId[x.id] = x; });
        var merged = j.cases.map(function (c) {
          var l = byId[c.id];
          return l ? { id: c.id, name: c.name, dx: c.dx, bed: c.bed, savedAt: c.savedAt, state: l.state }
                   : { id: c.id, name: c.name, dx: c.dx, bed: c.bed, savedAt: c.savedAt };
        });
        renderRoster(merged, true);
      } else {
        renderRoster(loadRoster(), false);
      }
    });
  }

  /* ------------------------------------------ prominent "enter data" chooser */
  var DATA_MENU = [
    ["🧑", "Patient details", "patient"], ["❤️", "Vitals (monitor)", "monitor"], ["🩸", "Labs / electrolytes", "labs"],
    ["🫁", "ABG", "abg"], ["🌬", "Ventilator", "ventilator"], ["💧", "Fluid balance", "flowsheet"],
    ["💉", "Infusion", "infusion"], ["🎯", "Today's goals", "goals"]
  ];
  function openDataMenu() {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet"><h3>＋ Enter / update data</h3>' +
      '<p style="margin:0 0 12px;color:var(--muted);font:600 13px var(--font)">Pick what to record — or use 📷 Snapshot to auto-read a photo.</p>' +
      '<div class="icu-grid2">' + DATA_MENU.map(function (m) {
        return '<button class="icu-btn ghost" data-icu-act="edit:' + m[2] + '" style="justify-content:flex-start;text-align:left">' + m[0] + " " + m[1] + "</button>";
      }).join("") + "</div>" +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
  }

  /* ------------------------------------------------------ event delegation */
  function onClick(e) {
    var t = e.target.closest ? e.target.closest("[data-icu-act]") : null; if (!t) return;
    var act = t.getAttribute("data-icu-act"); if (!act) return;
    e.preventDefault(); e.stopPropagation();
    var ix = act.indexOf(":"), cmd = ix < 0 ? act : act.slice(0, ix), arg = ix < 0 ? "" : act.slice(ix + 1);
    switch (cmd) {
      case "close": ICU.close(); break;
      case "tab": _active = arg; paint(); var sc = rootEl && rootEl.querySelector(".icu-scroll"); if (sc) sc.scrollTop = 0; break;
      case "win": _trendWin = +arg || _trendWin; paint(); break;
      case "round": { var rc = _raw.rounds[arg] || {}; STATE.rounds[arg] = { done: !rc.done, note: rc.note || "" }; break; }
      case "roundnote": openRoundNote(arg); break;
      case "saveroundnote": saveRoundNote(arg); break;
      case "proto": _openProto[arg] = !_openProto[arg]; paint(); break;
      case "drug": launch(function () { window.INF && (INF.openDrug ? INF.openDrug(arg) : INF.open()); }, "infOverlay"); break;
      case "gensummary": openSummary(); break;
      case "copysummary": copySummary(); break;
      case "edit": openForm(arg); break;
      case "ai": openForm(arg); break;            // "Coming soon" → manual entry fallback for now
      case "adddata": openDataMenu(); break;
      case "import": startImport(arg); break;
      case "wardfetch": wardSyncFetch(); break;
      case "impmethod": importMethod(arg); break;
      case "conflict": { var parts = arg.split("|"); ICU.resolveConflict(parts[0], parts[1]); paint(); break; }
      case "dismissupdate": ICU.clearNewUpdate(); paint(); break;
      case "wardsync": try { if (window.openGHIS) openGHIS(); } catch (x) {} break;
      case "savept": savePatient(); break;
      case "patients": openRoster(); break;
      case "loadpt": loadPatient(arg); break;
      case "delpt": deletePatient(arg); break;
      case "sharept": sharePatient(arg); break;
      case "sharecase": shareCase(); break;
      case "clearfindings": openClearConfirm(); break;
      case "clearconfirm": clearFindings(); break;
      case "newpt": newPatient(); break;
      case "lyte": _lytesExp[arg] = !_lytesExp[arg]; paint(); break;
      case "save": saveForm(arg); break;
      case "closeform": closeForm(); break;
      case "snapshot": openSnapshot(); break;
      case "launch":
        if (arg === "elyte") launch(function () {
          if (!window.ELYTE) return;
          var p = _raw.patient || {}, L = _raw.labs.recent || {};
          var pt = {}; if (p.weightKg != null) pt.weight = p.weightKg; if (p.age != null) pt.age = p.age; if (p.sex) pt.sex = String(p.sex).toLowerCase() === "f" ? "f" : "m"; if (p.diagnosis) pt.dx = p.diagnosis;
          var labs = {}; ["na", "k", "cl", "hco3", "ca", "mg", "po4", "glu", "creat", "alb", "egfr", "urea"].forEach(function (k) { if (L[k] != null && L[k] !== "") labs[k] = L[k]; });
          ELYTE.open((Object.keys(labs).length || Object.keys(pt).length) ? { labs: labs, pt: pt } : undefined);
        }, "eceOverlay");
        else if (arg === "inf") launch(function () { window.INF && INF.open(); }, "infOverlay");
        else if (arg === "protocols") launch(function () { window.INF && (INF.openProtocols ? INF.openProtocols() : INF.open()); }, "infOverlay");
        break;
      case "calc": launch(function () { window.MEDCALC && (MEDCALC.open ? MEDCALC.open(arg) : MEDCALC.openList && MEDCALC.openList()); }, "mcOverlay"); break;
    }
  }

  // ---- My Cases integration (read-only summaries + guest migration) ----
  function _summaryFrom(e) {
    var st = e.state || {}, pt = st.pt || (st.patient) || {};
    return { id: e.id, kind: "icu",
      label: e.name || (st.patient && st.patient.name) || "ICU patient",
      name: e.name || (st.patient && st.patient.name) || "",
      age: pt.age != null ? pt.age : (st.patient && st.patient.age) || "",
      sex: pt.sex || (st.patient && st.patient.sex) || "",
      savedAt: e.savedAt || 0, savedAtStr: fmtWhen(e.savedAt || 0),
      subtitle: e.dx || (st.patient && st.patient.diagnosis) || (e.bed ? "Bed " + e.bed : "") };
  }
  function listCasesForMyCases() {
    // Cloud when signed in (cross-device); always fall back to the local roster.
    return cloudList().then(function (j) {
      if (j && j.enabled && Array.isArray(j.cases) && j.cases.length) return j.cases.map(_summaryFrom);
      return loadRoster().map(_summaryFrom);
    }).catch(function () { return loadRoster().map(_summaryFrom); });
  }
  function anonRoster() { try { var r = JSON.parse(localStorage.getItem(ROSTER_BASE + ":anon")); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function countAnonCases() { return anonRoster().length; }
  function migrateAnonCases() {
    var list = anonRoster(); if (!list.length) return Promise.resolve(0);
    // Re-home anon entries under the current (signed-in) owner: local roster + cloud.
    var mine = loadRoster();
    list.forEach(function (e) { if (!mine.some(function (m) { return m.id === e.id; })) mine.push(e); });
    saveRoster(capTen(mine));
    return Promise.all(list.map(function (e) { return cloudSave(e).catch(function () { return null; }); }))
      .then(function () { try { localStorage.removeItem(ROSTER_BASE + ":anon"); } catch (e) {} return list.length; });
  }

  /* ------------------------------------------------------------- controller */
  var ICU = {
    open: function () {
      injectCSS();
      if (!rootEl) {
        rootEl = document.createElement("div"); rootEl.id = "icuRoot";
        document.body.appendChild(rootEl);
        rootEl.addEventListener("click", onClick);
      }
      paint();
      rootEl.classList.add("on");
      document.body.style.overflow = "hidden";
    },
    close: function () { if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    // public data API (manual entry + future Vision share these)
    state: function () { return STATE; },
    update: function (patch) { if (patch && typeof patch === "object") Object.keys(patch).forEach(function (k) { STATE[k] = patch[k]; }); },
    subscribe: function (fn) { if (typeof fn === "function") { _subs.push(fn); return function () { var i = _subs.indexOf(fn); if (i >= 0) _subs.splice(i, 1); }; } },
    recompute: function () { onChange(); },
    reset: function () { var d = clone(DEFAULT_STATE); Object.keys(d).forEach(function (k) { STATE[k] = d[k]; }); },
    ingestMonitor: ingestMonitor, ingestLabs: ingestLabs, ingestVentilator: ingestVentilator, ingestFlowsheet: ingestFlowsheet, ingestPatient: ingestPatient,
    ingestFromWard: ingestFromWard, mapWardLab: mapWardLab, _compressImage: compressImage, startImport: startImport, _review: openImportReview,
    wardStatus: function () { return STATE.wardSync || {}; },
    clearNewUpdate: function () { if (STATE.wardSync) STATE.wardSync.newUpdate = false; },
    resolveConflict: function (key, choice) { // choice: "ward" | "manual"
      var c = (STATE.conflicts || []).filter(function (x) { return x.key === key; })[0]; if (!c) return;
      if (choice === "ward") { var o = {}; o[key] = c.ward; ingestLabs(o); STATE.src[key] = { source: c.source || "Ward Sync", ts: c.wardTs }; }
      else { STATE.src[key] = { source: "Manual", ts: c.manualTs }; }
      STATE.conflicts = (STATE.conflicts || []).filter(function (x) { return x.key !== key; });
    },
    // patient roster (save current / reopen previous / share / clear)
    savePatient: savePatient, loadPatient: loadPatient, listPatients: loadRoster, deletePatient: deletePatient, newPatient: newPatient,
    listCasesForMyCases: listCasesForMyCases, countAnonCases: countAnonCases, migrateAnonCases: migrateAnonCases,
    shareCase: shareCase, clearFindings: clearFindings, summary: buildSummary
  };
  window.ICU = ICU;

  // re-render the open dashboard whenever the state changes (any source)
  _subs.push(function () { if (ICU.isOpen()) paint(); });

  // Per-account on-device isolation: attach to Firebase auth once it's loaded so
  // sign-in / sign-out / account-switch re-point the roster and clear a previous
  // account's working buffer. Firebase is lazy-loaded, so keep trying until ready.
  (function watchAuth() {
    var tries = 0;
    function attach() {
      try {
        var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
        if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { reconcileOwner(); }); return true; }
      } catch (e) {}
      return false;
    }
    if (attach()) return;
    var iv = setInterval(function () { if (attach() || ++tries > 60) clearInterval(iv); }, 500);
  })();
  // Opening the dashboard nudges Firebase to load so auth (and thus the correct
  // per-account roster) resolves promptly instead of waiting for idle.
  (function () {
    var _open = ICU.open;
    ICU.open = function () { try { window.SMD_loadFirebase && window.SMD_loadFirebase(); } catch (e) {} return _open.apply(ICU, arguments); };
  })();
})();
