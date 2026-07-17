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
    patient: { name: "", age: null, sex: "", weightKg: null, heightCm: null, complaints: "", diagnosis: "", hospital: "", bed: "", icuDay: null, status: "" },
    vitals: [],                 // [{ ts, hr, sbp, dbp, map, rr, spo2, temp, uop, lactate, cvp, etco2, gcs }]
    labs: { recent: {}, trends: [] },  // recent: { na,k,cl,hco3,ca,mg,po4,glu,creat,alb,wbc,hb,plt,inr,ferritin,trig,fibrinogen,... }
    abg: {},                    // { ts, ph, paco2, pao2, hco3, fio2, lactate, be }
    ventilator: {},             // { mode, fio2, peep, tv, rr, peak, plateau, drivingP, compliance, pf }
    fluids: { intake24h: null, output24h: null, urine24h: null, drains: null, net24h: null, cumulative: null, strategyPhase: "" },
    infusions: [],              // [{ drug, dose, unit, rateMlHr, indication }]
    treatment: [],              // [{ id, name, dose, route, freq, cat:abx|fluid|supp|other, by, byUid, ts }] — editable Current-Treatment list (any doctor add/remove; group changes logged to timeline). Lives in ICU_STATE so it auto-persists (solo roster) + auto-mirrors to the shared patient doc (whole team sees it).
    imaging: [],                // [{ id, ts, modality, category, studyName, bodyRegion, indication, findingsRaw, impressionRaw, reportRaw, keyPos[], keyNeg[], critical[], parsed, comment, source, reportId, reportDateTime, radiologist, reviewed, inSummary, hidden, importedAt }] — Ward Sync radiology + manual imaging notes (sibling of labs/vitals; NOT scored by any engine)
    findings: [],               // [{ canonicalFindingId(engine id | note:*), displayLabel, polarity:present|absent|possible, temporality:current|historical|resolved, source, clinicianConfirmed, inReasoning, at }] — structured clinician-picked findings (documentation; NOT fed to scoring)
    goals: [],                  // [string]
    rounds: {},                 // checklist state (Phase 3)
    alerts: [],                 // DERIVED — written by recompute()
    scores: [],                 // DERIVED — auto-computed clinical scores (icu-autoscores.js), written by recompute()
    src: {},                    // per-field provenance: { <field>: { source, ts } } source ∈ Ward Sync|Imported report|Manual
    wardSync: { connected: false, lastTs: null, newUpdate: false, patientId: null },
    conflicts: [],              // [{ key, label, ward, manual, wardTs, manualTs }] — clinician resolves
    meta: { updated: null }
  };
  var LS_KEY = "stewardmd_icu_state";                       // legacy (unscoped) key — migrated once
  // ── Unit model: hospital → category (ICU | Ward) → unit type. Each unit is its own workspace with
  //   its own patient list. Solo: the roster/buffer is namespaced by the unit (unitSuffix). Group: the
  //   unit is a shared group tagged with kind+unitType; the picker/board filter by category so ICU and
  //   Ward never mix. Backward-compat: the default ICU unit keeps the LEGACY unsuffixed roster, and
  //   older groups (no kind) are treated as "icu" — no migration needed.
  var UNIT_CATS = [
    { cat: "icu",  label: "ICU",  ic: "🫀", svg: "pulse",    sub: "Critical care", types: ["ICU", "MICU", "SICU", "PICU", "CCU"] },
    { cat: "ward", label: "Ward", ic: "🏥", svg: "hospital", sub: "General wards", types: ["Male Ward", "Female Ward"] }
  ];
  function unitCatMeta(cat) { for (var i = 0; i < UNIT_CATS.length; i++) if (UNIT_CATS[i].cat === cat) return UNIT_CATS[i]; return UNIT_CATS[0]; }
  function unitTypesOf(cat) { return unitCatMeta(cat).types; }
  var _unit = { cat: "icu", type: "ICU", hospital: "" };    // current unit context
  var _lastType = { icu: "ICU", ward: "Male Ward" };         // last-picked type per category (nav memory)
  var _wardMode = false;                                     // DERIVED: _unit.cat === "ward"
  function ctxLabel() { return _wardMode ? "Ward" : "ICU"; }
  function unitPrefKey() { return "smd_icu_unit:" + (typeof ownerNow === "function" ? ownerNow() : "anon"); }
  function unitLoadPref() {
    try {
      var d = JSON.parse(localStorage.getItem(unitPrefKey()) || "null");
      if (d && d.unit && d.unit.cat) _unit = { cat: d.unit.cat, type: d.unit.type || "", hospital: d.unit.hospital || "" };
      if (d && d.lastType) { if (d.lastType.icu) _lastType.icu = d.lastType.icu; if (d.lastType.ward) _lastType.ward = d.lastType.ward; }
    } catch (e) {}
    _wardMode = (_unit.cat === "ward");
  }
  function unitSavePref() { try { localStorage.setItem(unitPrefKey(), JSON.stringify({ unit: _unit, lastType: _lastType })); } catch (e) {} }
  // Roster/buffer namespace suffix. The default ICU unit (icu/ICU) keeps the LEGACY unsuffixed key
  // (backward compat); every other unit gets its own patient list.
  function unitSuffix() {
    var c = (_unit && _unit.cat) || "icu", t = (_unit && _unit.type) || "";
    if (c === "icu" && (t === "ICU" || t === "")) return "";
    return ":" + (c + "-" + t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  // KI-M3: the live working buffer is PHI (name/bed/labs/imaging). Scope it PER signed-in
  // account (like the roster) so two clinicians sharing one physical device can never read each
  // other's open patient — isolation no longer depends on the auth-reset firing. ownerNow() is a
  // hoisted function; at first load it is "anon" until Firebase resolves, then reconcileOwner()
  // syncs the buffer to the resolved owner exactly once.
  function bufKey(owner) { return LS_KEY + ":" + (owner || ownerNow()) + unitSuffix(); }

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
  unitLoadPref();   // restore the last-used unit context BEFORE the buffer loads, so bufKey resolves right
  // Prefer the per-owner buffer; fall back to the legacy unscoped key ONCE so existing installs
  // don't lose their open patient on upgrade (reconcileOwner migrates it to the owner's key).
  try { _raw = JSON.parse(localStorage.getItem(bufKey()) || localStorage.getItem(LS_KEY)); } catch (e) { _raw = null; }
  if (!_raw || typeof _raw !== "object") _raw = clone(DEFAULT_STATE);
  // backfill any missing top-level keys (forward-compat)
  Object.keys(DEFAULT_STATE).forEach(function (k) { if (_raw[k] == null) _raw[k] = clone(DEFAULT_STATE[k]); });

  var _subs = [], _busy = false, _scheduled = false;
  function notify() {
    _scheduled = false; _busy = true;
    try {
      recompute(_raw);                       // writes _raw.alerts on the RAW object (no re-trigger)
      _raw.meta.updated = nowTs();
      try { localStorage.setItem(bufKey(), JSON.stringify(_raw)); } catch (e) { if (!_persistWarned) { _persistWarned = true; try { (window.toast || function () {})("Couldn't save ICU data on this device (storage full / private mode) — kept for this session only."); } catch (x) {} } }
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
  var MAX_SERIES = 500;      // cap vitals[]/labs.trends[] so long ICU stays don't grow storage unbounded
  var MAX_IMAGING = 200;     // cap imaging[] so it can't bloat the single localStorage blob
  var _persistWarned = false;
  // Latest reading = the one with the newest TIMESTAMP (not merely the last-pushed element).
  function latestByTs(arr) { if (!arr || !arr.length) return {}; var b = arr[0]; for (var i = 1; i < arr.length; i++) { if (((arr[i] && arr[i].ts) || 0) >= ((b && b.ts) || 0)) b = arr[i]; } return b || {}; }
  function latestVitals() { return latestByTs(_raw.vitals); }
  // One pressor/vasoactive detector (was duplicated in renderLiveStatus + interpretHemo).
  function isPressor(drug) { return /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine|pressor/i.test(drug || ""); }
  function curMap() { var lv = latestVitals(); return lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp); }
  function shockIndex() { var lv = latestVitals(); return (lv.hr && lv.sbp) ? +(lv.hr / lv.sbp).toFixed(2) : null; }

  /* ------------------------------------------ recompute: derive alerts */
  // The seed of the "smart ICU engine": one place that turns raw values into
  // alerts. Runs on EVERY state change, so any tab/importer that updates a value
  // immediately refreshes the Overview + live status. Pure read of `s`, writes
  // s.alerts only.
  // Shared thresholds — single source of truth so tiles + the alert engine never drift (BUG #5).
  var K_CRIT_HI = 6.5, K_WARN_HI = 5.5, K_CRIT_LO = 2.5, K_WARN_LO = 3.0;
  // Category order for grouped display (BUG #7). Each alert carries its TRUE source.
  var ALERT_SOURCES = ["Sepsis / Temperature", "Respiratory", "Hemodynamics", "Acid–base", "Ventilator", "Renal / Metabolic", "Haematology", "Labs"];
  function recompute(s) {
    var a = [];
    function add(sev, title, msg, source) { a.push({ severity: sev, title: title, msg: msg, source: source }); }
    var L = (s.labs && s.labs.recent) || {}, lv = latestByTs(s.vitals), g = s.abg || {}, p = s.patient || {};
    var wt = (p.weightKg != null && !isNaN(+p.weightKg) && +p.weightKg > 0) ? +p.weightKg : 70;   // BUG #9: default 70 kg when weight unknown

    // ---- Electrolytes ----
    if (L.k != null) { if (L.k > K_CRIT_HI) add("crit", "Critical hyperkalaemia", "K⁺ " + L.k + " mEq/L (>" + K_CRIT_HI + ") — ECG + urgent treatment", "Renal / Metabolic"); else if (L.k > K_WARN_HI) add("warn", "Hyperkalaemia", "K⁺ " + L.k + " mEq/L (>" + K_WARN_HI + ")", "Renal / Metabolic"); else if (L.k < K_CRIT_LO) add("crit", "Critical hypokalaemia", "K⁺ " + L.k + " mEq/L (<" + K_CRIT_LO + ") — replace + monitor ECG", "Renal / Metabolic"); else if (L.k < K_WARN_LO) add("warn", "Hypokalaemia", "K⁺ " + L.k + " mEq/L", "Renal / Metabolic"); }
    if (L.na != null) { if (L.na > 160 || L.na < 120) add("crit", "Critical sodium", "Na⁺ " + L.na + " mEq/L — correct at a safe rate", "Renal / Metabolic"); else if (L.na > 150 || L.na < 130) add("warn", "Sodium derangement", "Na⁺ " + L.na + " mEq/L", "Renal / Metabolic"); }

    // ---- Renal (creatinine / eGFR) + AKI composite (BUG #1, #9) ----
    var oliguric = (lv.uop != null && lv.uop < 0.5 * wt), renalHigh = false;
    if (L.creat != null) { if (L.creat > 3.4) { renalHigh = true; add("crit", "Severe renal impairment", "Creatinine " + L.creat + " mg/dL (>3.4) — AKI / renal failure; review nephrotoxins & drug dosing", "Renal / Metabolic"); } else if (L.creat > 1.5) { renalHigh = true; add("warn", "Raised creatinine", "Creatinine " + L.creat + " mg/dL (>1.5)", "Renal / Metabolic"); } }
    if (L.egfr != null) { if (L.egfr < 15) { renalHigh = true; add("crit", "Critically low eGFR", "eGFR " + L.egfr + " mL/min (<15) — renal-failure range", "Renal / Metabolic"); } else if (L.egfr < 30) { renalHigh = true; add("warn", "Low eGFR", "eGFR " + L.egfr + " mL/min (<30)", "Renal / Metabolic"); } }
    if (oliguric) add("warn", "Oliguria", "Urine " + lv.uop + " mL/h (<0.5 mL/kg/h at " + wt + " kg" + (p.weightKg == null || +p.weightKg <= 0 ? ", assumed" : "") + ")", "Renal / Metabolic");
    if (oliguric && renalHigh) add("crit", "Acute kidney injury (composite)", "Oliguria + raised creatinine/eGFR — screen for AKI (KDIGO); review fluids, perfusion & nephrotoxins", "Renal / Metabolic");

    // ---- Haematology ----
    if (L.hb != null) { if (L.hb < 7) add("crit", "Severe anaemia", "Hb " + L.hb + " g/dL (<7) — transfusion threshold; check for bleeding", "Haematology"); else if (L.hb < 10) add("warn", "Anaemia", "Hb " + L.hb + " g/dL (<10)", "Haematology"); }
    if (L.plt != null) { if (L.plt < 20) add("crit", "Critical thrombocytopenia", "Platelets " + L.plt + " ×10⁹/L (<20) — bleeding risk", "Haematology"); else if (L.plt < 50) add("warn", "Thrombocytopenia", "Platelets " + L.plt + " ×10⁹/L (<50)", "Haematology"); else if (L.plt > 1000) add("warn", "Thrombocytosis", "Platelets " + L.plt + " ×10⁹/L (>1000)", "Haematology"); }
    if (L.ferritin != null && L.ferritin > 10000) add("warn", "Markedly elevated ferritin", "Ferritin " + L.ferritin + " — consider HLH / hyperinflammation", "Haematology");

    // ---- Glucose (conventional / Indian units: mg/dL) ----
    if (L.glu != null) { if (L.glu > 540) add("crit", "Severe hyperglycaemia", "Glucose " + L.glu + " mg/dL (>540) — screen for DKA / HHS", "Renal / Metabolic"); else if (L.glu > 250) add("warn", "Hyperglycaemia", "Glucose " + L.glu + " mg/dL (>250)", "Renal / Metabolic"); else if (L.glu < 45) add("crit", "Critical hypoglycaemia", "Glucose " + L.glu + " mg/dL (<45) — treat now", "Renal / Metabolic"); else if (L.glu < 70) add("warn", "Hypoglycaemia", "Glucose " + L.glu + " mg/dL (<70)", "Renal / Metabolic"); }

    // ---- Hemodynamics ----
    var mp = lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp);
    if (mp != null) { if (mp < 60) add("crit", "Hypotension", "MAP " + mp + " mmHg (<60) — resuscitate", "Hemodynamics"); else if (mp < 65) add("warn", "Low MAP", "MAP " + mp + " mmHg (target ≥65)", "Hemodynamics"); }
    if (lv.lactate != null) { if (lv.lactate > 4) add("crit", "Hyperlactataemia", "Lactate " + lv.lactate + " mmol/L (>4) — hypoperfusion", "Hemodynamics"); else if (lv.lactate > 2) add("warn", "Raised lactate", "Lactate " + lv.lactate + " mmol/L (>2)", "Hemodynamics"); }

    // ---- Respiratory (BUG #7: SpO₂/PaO₂ are respiratory, not haemodynamic) ----
    if (lv.spo2 != null) { if (lv.spo2 < 88) add("crit", "Severe hypoxaemia", "SpO₂ " + lv.spo2 + "% (<88)", "Respiratory"); else if (lv.spo2 < 92) add("warn", "Hypoxaemia", "SpO₂ " + lv.spo2 + "% (<92)", "Respiratory"); }

    // ---- Temperature / pyrexia (BUG #8) ----
    if (lv.temp != null) { if (lv.temp >= 40) add("crit", "Hyperpyrexia", "Temp " + lv.temp + " °C (≥40)", "Sepsis / Temperature"); else if (lv.temp <= 35) add("crit", "Hypothermia", "Temp " + lv.temp + " °C (≤35)", "Sepsis / Temperature"); else if (lv.temp >= 38.3) add("warn", "Pyrexia", "Temp " + lv.temp + " °C (≥38.3) — screen for infection / sepsis", "Sepsis / Temperature"); }

    // ---- qSOFA / sepsis composite (BUG #3) — from inputs already collected ----
    var q = 0, qp = [];
    if (lv.rr != null && lv.rr >= 22) { q++; qp.push("RR " + lv.rr); }
    if ((lv.sbp != null && lv.sbp <= 100) || (lv.sbp == null && mp != null && mp < 65)) { q++; qp.push(lv.sbp != null ? "SBP " + lv.sbp : "MAP " + mp); }
    if (lv.gcs != null && lv.gcs < 15) { q++; qp.push("GCS " + lv.gcs); }
    if (q >= 2) add("crit", "qSOFA " + q + "/3 — screen for sepsis", "Meets qSOFA (" + qp.join(", ") + "). Suspect sepsis → cultures + lactate, source control, early antibiotics; record GCS if not done.", "Sepsis / Temperature");
    else if (q === 1 && ((lv.lactate != null && lv.lactate > 2) || (lv.temp != null && lv.temp >= 38.3))) add("warn", "Possible sepsis", "1 qSOFA criterion (" + qp.join(", ") + ") with raised lactate/fever — reassess and record GCS.", "Sepsis / Temperature");

    // ---- ABG ----
    if (g.ph != null) { if (g.ph < 7.2 || g.ph > 7.55) add("crit", "Severe acid–base disturbance", "pH " + g.ph, "Acid–base"); else if (g.ph < 7.30 || g.ph > 7.50) add("warn", "Acid–base disturbance", "pH " + g.ph, "Acid–base"); }
    // ---- Ventilation / ARDS (already PEEP-gated — Berlin needs PEEP ≥5 on ventilation) ----
    var vt = s.ventilator || {}, pf = vt.pf != null ? vt.pf : ((g.pao2 != null && vt.fio2) ? Math.round(g.pao2 / (vt.fio2 / 100)) : null);
    if (pf != null && pf < 300) {
      var sev = pf < 100 ? "crit" : "warn", grade = pf < 100 ? "Severe" : pf < 200 ? "Moderate" : "Mild";
      var onVent = vt.peep != null && vt.peep >= 5;
      if (onVent) add(sev, grade + " ARDS (P/F " + pf + ")", grade + " ARDS" + (pf < 150 ? " — consider prone positioning" : ""), "Ventilator");
      else add(sev, grade + " hypoxaemia (P/F " + pf + ")", "Meets the ARDS oxygenation criterion — confirm PEEP ≥5 + bilateral infiltrates before calling ARDS", "Ventilator");
    }

    var order = { crit: 0, warn: 1, info: 2 };
    a.sort(function (x, y) { return (order[x.severity] || 9) - (order[y.severity] || 9); });
    s.alerts = a;
    // ---- auto-computed clinical scores (icu-autoscores.js → MEDCALC formulas) ----
    try { s.scores = window.ICU_AUTOSCORES ? window.ICU_AUTOSCORES.compute(s, window.MEDCALC) : []; }
    catch (e) { s.scores = []; }
  }
  recompute(_raw);   // initial derive

  /* ----------------------------------------- importer interface (AI contract) */
  // FUTURE Gemini/OpenAI Vision calls these with structured objects extracted
  // from captured images. They write into ICU_STATE → the whole dashboard
  // updates with zero UI changes. Manual-entry forms call them too.
  function ingestMonitor(o) {
    o = o || {}; var v = pick(o, ["hr", "sbp", "dbp", "map", "rr", "spo2", "temp", "uop", "lactate", "cvp", "etco2", "gcs"]);
    if (v.map == null && v.sbp != null && v.dbp != null) v.map = mapCalc(v.sbp, v.dbp);
    v.ts = o.ts || nowTs();
    STATE.vitals.push(v);
    if (STATE.vitals.length > MAX_SERIES) STATE.vitals.splice(0, STATE.vitals.length - MAX_SERIES);
    recompute(_raw);   // refresh alerts synchronously after writing vitals (BUG #1)
    return v;
  }
  function ingestLabs(o) {
    o = o || {}; var keys = ["na", "k", "cl", "hco3", "ca", "mg", "po4", "glu", "creat", "egfr", "urea", "alb", "wbc", "hb", "plt", "inr", "ferritin", "trig", "fibrinogen", "crp", "bili", "ast", "alt", "alp", "bili_d", "amylase", "lipase", "pct", "neut", "hct"];
    var rec = pick(o, keys); var ts = o.ts || nowTs();
    Object.keys(rec).forEach(function (k) { STATE.labs.recent[k] = rec[k]; });
    STATE.labs.trends.push(Object.assign({ ts: ts }, rec));
    if (STATE.labs.trends.length > MAX_SERIES) STATE.labs.trends.splice(0, STATE.labs.trends.length - MAX_SERIES);
    recompute(_raw);   // BUG #1: imported/entered labs must (re)fire alerts, not just repaint widgets
    return rec;
  }
  function ingestVentilator(o) {
    o = o || {}; var v = pick(o, ["mode", "fio2", "peep", "tv", "rr", "peak", "plateau", "drivingP", "compliance", "pf"]);
    Object.keys(v).forEach(function (k) { STATE.ventilator[k] = v[k]; });
    recompute(_raw);   // BUG #1: ventilator/PEEP changes must refresh the ARDS/hypoxaemia alert
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

  /* ============================ IMAGING NOTES (Phase 1) ===================
   * Ward Sync radiology + manual imaging notes, stored in a SEPARATE sibling
   * array (imaging[]) so labs.trends[]/vitals[] and their charts are untouched.
   * Everything here is DETERMINISTIC — modality normalized from the title,
   * sections parsed from the free-text blob (raw always preserved), critical
   * terms scanned client-side to trigger a "review urgently" flag ONLY (never a
   * diagnosis). No AI in this layer. Scoped per owner+patient for free via the
   * ICU state persistence. Flag: smd_icu_imaging (default ON) + ?icuimaging= .   */
  function icuImagingOn() {
    try {
      var q = (location.search.match(/[?&]icuimaging=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = localStorage.getItem("smd_icu_imaging");
      return v === null ? true : v === "1";
    } catch (e) { return true; }
  }
  // Guided ICU diagnosis workflow (structured findings → working dx → Deep Review over the FULL
  // clinical context). Flag: smd_icu_dxflow (default ON) + ?icudxflow= kill-switch. When OFF, the
  // unified context omits findings/vitals and Deep Review reverts to imaging+labs only.
  function icuDxFlowOn() {
    try {
      var q = (location.search.match(/[?&]icudxflow=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = localStorage.getItem("smd_icu_dxflow");
      return v === null ? true : v === "1";
    } catch (e) { return true; }
  }
  // ICU v2 (unit board + restyled workspace) is now THE ICU — the only dashboard (consolidation
  // 2026-07). Kept as a function because it is called in many places, but ALWAYS true: the classic
  // single-patient chrome is unreachable. The old smd_icu_v2 flag and ?icuv2= param are retained
  // but have NO effect (harmless).
  function icuV2On() { return true; }
  // ICU v2 real-time collaboration (Phase 2, smd_icu_groups). ADDITIVE + GATED: only when v2 is
  // on AND groups is on AND the collab module (icu-collab.js) loaded does the board/workspace read
  // LIVE from Firestore; otherwise the Phase-1 LOCAL path is byte-for-byte unchanged. DEFAULT OFF;
  // ?icugroups= overrides. The flag is read independently of the module so mode-gating is robust to
  // load order (icu-collab.js loads after icu.js); live data ops check groupsApi() presence.
  function icuGroupsOn() {
    try {
      var q = (location.search.match(/[?&]icugroups=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      return localStorage.getItem("smd_icu_groups") === "1";
    } catch (e) { return false; }
  }
  function groupsApi() { try { return (typeof window !== "undefined" && window.SMD_ICU_GROUPS) || null; } catch (e) { return null; } }
  function groupMode() { return icuV2On() && icuGroupsOn() && !!groupsApi(); }
  function grpActive() { return groupMode() && !!(_grp && _grp.id); }
  // Modality family + filter bucket from the free-text study title (no structured
  // modality is exposed by GHIS). Original study title is preserved separately.
  function imgModality(title) {
    var t = " " + String(title || "").toLowerCase() + " ";
    if (/\bercp\b|endoscop|colonoscop|gastroscop|sigmoidoscop|bronchoscop|\bogd\b|duodenoscop/.test(t)) return { modality: "Endoscopy / procedure", category: "endo" };
    if (/echocardiograph|\becho\b|\b2d ?echo\b|\btte\b|\btee\b/.test(t)) return { modality: "Echocardiography", category: "cardiac" };
    if (/doppler/.test(t)) return { modality: "Doppler", category: "us" };
    if (/\bmrcp\b/.test(t)) return { modality: "MRCP", category: "ctmri" };
    if (/\bmri\b|\bmr \b|magnetic resonance/.test(t)) return { modality: "MRI", category: "ctmri" };
    if (/cect|contrast[- ]?enhanced ct|\bctpa\b|ct angiogram|ct angiography|\bhrct\b|\bct\b|computed tomograph/.test(t)) return { modality: /cect|contrast/.test(t) ? "CECT" : "CT", category: "ctmri" };
    if (/ultrasoun|\busg\b|\bus \b|sonograph|\bkub\b.*ultra|ultra.*\bkub\b/.test(t)) return { modality: "Ultrasound", category: "us" };
    if (/x[- ]?ray|radiograph|\bcxr\b|\bkub\b|skiagram|plain film/.test(t)) return { modality: "X-ray", category: "xray" };
    return { modality: "Imaging Report", category: "other" };
  }
  // Deterministic critical-term scan. Returns matched human labels (deduped).
  // Light negation guard so "no free air" / "no evidence of PE" don't false-trigger.
  var IMG_CRITICAL = [
    ["Intracranial haemorrhage", /intracranial h[ae]?emorrhage|intracerebral h[ae]?emorrhage|\bich\b|subarachnoid h[ae]?emorrhage|\bsah\b|subdural h[ae]?ematoma|extradural h[ae]?ematoma|epidural h[ae]?ematoma/i],
    ["Midline shift / mass effect", /midline shift|mass effect|uncal herniation|tonsillar herniation|\bherniation\b/i],
    ["Hydrocephalus", /hydrocephalus/i],
    ["Bowel perforation / free air", /perforation|pneumoperitoneum|free (?:intraperitoneal |intra-?peritoneal )?air|free gas/i],
    ["Bowel ischaemia", /bowel ischa?emi|mesenteric ischa?emi|ischa?emic bowel|pneumatosis (?:intestinalis|coli)/i],
    ["Aortic aneurysm rupture", /ruptured aneurysm|aneurysm.*ruptur|leaking aneurysm/i],
    ["Aortic dissection", /aortic dissection|dissection flap|type [ab] dissection/i],
    ["Pulmonary embolism", /pulmonary embol|\bpe\b(?![a-z])|filling defect.*pulmonary arter/i],
    ["Tension pneumothorax", /tension pneumothorax/i],
    ["Pneumothorax", /pneumothorax/i],
    ["Spinal cord compression", /cord compression|spinal cord compress|cauda equina/i],
    ["Obstructed / infected kidney", /obstructed.*kidney|pyonephrosis|obstructive uropathy|infected.*hydronephros/i],
    ["Necrotising pancreatitis", /necroti[sz]ing pancreatit|pancreatic necrosis|necrotic pancreat/i],
    ["Abscess / collection", /abscess|empyema|infected collection/i],
    ["Portal vein thrombosis", /portal vein thrombos|portal venous thrombos|\bpvt\b/i],
    ["Active contrast extravasation", /active (?:contrast )?extravasation|active bleed|active h[ae]?emorrhage/i]
  ];
  var IMG_NEG = /\b(?:no|without|absent|negative for|no evidence of|not? seen|ruled out|excludes?|free of|no significant)\b/i;
  function imgCritical(text) {
    var s = String(text || ""); if (!s) return [];
    var hits = [];
    IMG_CRITICAL.forEach(function (c) {
      var re = new RegExp(c[1].source, "gi"), m;
      while ((m = re.exec(s))) {
        // Clause-scope the negation window: keep only the text since the last sentence/clause
        // break so a negated CLAUSE earlier in the report ("No fracture. Acute SDH.") cannot
        // suppress a genuine finding in the current clause (that would be a dangerous miss).
        var pre = s.slice(Math.max(0, m.index - 40), m.index).split(/[.;:\n]/).pop();
        if (!IMG_NEG.test(pre) && hits.indexOf(c[0]) < 0) hits.push(c[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });
    return hits;
  }
  // Best-effort section parser. Preserves raw ALWAYS; parsed=true only when
  // recognised headers were found (drives the "Parsed automatically — verify" badge).
  function parseImagingSections(raw) {
    var text = String(raw || "").replace(/\r/g, ""); var out = { indication: "", technique: "", findings: "", impression: "", recommendation: "", parsed: false };
    if (!text.trim()) return out;
    var HEAD = [
      ["indication", /(?:^|\n)[ \t]*(?:clinical\s+(?:history|indication|details|note)|clinical|history|indication)[ \t]*[:\-–]/i],
      ["technique", /(?:^|\n)[ \t]*(?:technique|protocol|procedure)[ \t]*[:\-–]/i],
      ["findings", /(?:^|\n)[ \t]*(?:findings?|observations?)[ \t]*[:\-–]/i],
      ["impression", /(?:^|\n)[ \t]*(?:impression|conclusion|opinion|summary|comment)[ \t]*[:\-–]/i],
      ["recommendation", /(?:^|\n)[ \t]*(?:recommendations?|advice|suggestions?|advised|suggested)[ \t]*[:\-–]/i]
    ];
    var marks = [];
    HEAD.forEach(function (h) { var m = new RegExp(h[1].source, "i").exec(text); if (m) marks.push({ key: h[0], hstart: m.index, cstart: m.index + m[0].length }); });
    marks.sort(function (a, b) { return a.hstart - b.hstart; });
    if (marks.length) { out.parsed = true; for (var i = 0; i < marks.length; i++) { var end = (i + 1 < marks.length) ? marks[i + 1].hstart : text.length; out[marks[i].key] = text.slice(marks[i].cstart, end).trim(); } }
    return out;
  }
  function imgHash(s) { s = String(s || ""); var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36); }
  function imgFmtDate(ts) {
    if (!ts) return "";
    try { var d = new Date(ts); var M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; var hh = d.getHours(), mm = d.getMinutes(); var t = (hh || mm) ? (" · " + (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm) : ""; return d.getDate() + " " + M[d.getMonth()] + " " + d.getFullYear() + t; } catch (e) { return ""; }
  }
  // Build a normalized imaging record from a raw Ward Sync order+report OR a manual entry.
  function normalizeImagingRecord(raw, source) {
    raw = raw || {};
    var title = raw.studyName || raw.description || raw.testName || raw.modality || "Imaging Report";
    var fam = imgModality(title);
    var rawText = String(raw.report != null ? raw.report : (raw.reportRaw || "")).trim();
    var sec = parseImagingSections(rawText);
    var findings = raw.findingsRaw != null && raw.findingsRaw !== "" ? String(raw.findingsRaw) : sec.findings;
    var impression = raw.impressionRaw != null && raw.impressionRaw !== "" ? String(raw.impressionRaw) : sec.impression;
    var indication = raw.indication != null && raw.indication !== "" ? String(raw.indication) : sec.indication;
    var when = raw.reportDateTime || parseWardDate(raw.date || raw.reported || raw.orderDate || raw.performedDateTime) || null;
    var scan = [rawText, findings, impression].join("\n");
    return {
      modality: raw.modality && source === "Manual" ? raw.modality : fam.modality,
      category: fam.category,
      studyName: title,
      bodyRegion: raw.bodyRegion || "",
      indication: indication,
      findingsRaw: findings,
      impressionRaw: impression,
      reportRaw: rawText,
      keyPos: raw.keyPos || [],
      keyNeg: raw.keyNeg || [],
      critical: imgCritical(scan),
      parsed: sec.parsed,
      comment: raw.comment || "",
      source: source || "Ward Sync",
      reportId: raw.reportId != null ? raw.reportId : (raw.resultid != null ? raw.resultid : null),
      reportDateTime: when,
      radiologist: raw.radiologist || raw.enteredBy || raw.doctor || "",
      reviewed: false, inSummary: false, hidden: false,
      importedAt: nowTs(), ts: when || nowTs()
    };
  }
  // Stable dedup key for a Ward Sync report: reportId + performed date + text hash.
  function imagingKey(rec) { return "ws:" + (rec.wardPatientId != null ? rec.wardPatientId : "") + ":" + (rec.reportId != null ? rec.reportId : "") + ":" + (rec.reportDateTime || "") + ":" + imgHash((rec.impressionRaw || rec.findingsRaw || rec.reportRaw || rec.studyName || "").slice(0, 400)); }
  function capImaging() { if (STATE.imaging.length > MAX_IMAGING) STATE.imaging.splice(0, STATE.imaging.length - MAX_IMAGING); }
  // Resolve an imaging record by its STABLE id (card actions key by id, not array index, so
  // they stay correct after capImaging() front-splices the oldest overflow).
  function imgIndexById(id) { var a = _raw.imaging || []; for (var i = 0; i < a.length; i++) if (a[i].id === id) return i; return -1; }
  function imgById(id) { var i = imgIndexById(id); return i >= 0 ? STATE.imaging[i] : null; }
  // Single manual imaging note (always distinct; never deduped against ward reports).
  function ingestImaging(o) {
    var rec = normalizeImagingRecord(o || {}, (o && o.source) || "Manual");
    rec.id = (o && o.id) || ("img_" + nowTs() + "_" + Math.floor(Math.random() * 1e6).toString(36));
    STATE.imaging.push(rec); capImaging();
    return rec;
  }
  // Batch Ward Sync imaging import — dedup by content key, never overwrite, cap.
  function ingestWardImaging(bundle) {
    bundle = bundle || {};
    var pid = bundle.patientId != null ? String(bundle.patientId) : null;
    // PHI isolation: scope Ward Sync imaging to the patient being loaded. If the imported
    // patient differs from the Ward Sync radiology already held, DROP the prior patient's
    // reports (Manual notes are kept) so one patient's imaging can never appear under another.
    if (pid != null) {
      STATE.imaging = (STATE.imaging || []).filter(function (r) { return r.source !== "Ward Sync" || String(r.wardPatientId) === pid; });
      STATE.wardSync = STATE.wardSync || {}; STATE.wardSync.patientId = bundle.patientId;
    }
    var have = {}; (STATE.imaging || []).forEach(function (r) { if (r.id) have[r.id] = 1; });
    var added = 0, dup = 0;
    (bundle.imaging || []).forEach(function (raw) {
      var rec = normalizeImagingRecord(raw, bundle.source || "Ward Sync");
      rec.wardPatientId = pid; rec.id = imagingKey(rec);
      if (have[rec.id]) { dup++; return; }
      have[rec.id] = 1; STATE.imaging.push(rec); added++;
    });
    if (added) capImaging();
    return { added: added, duplicates: dup, total: (STATE.imaging || []).length };
  }
  // ICU "Fetch Imaging" — pulls this patient's radiology via Ward Sync (ghis-ward.js).
  function imagingFetch() {
    var pid = (_raw.wardSync && _raw.wardSync.patientId) || null;
    if (pid && window.GHIS && GHIS.fetchImagingIntoICU) { GHIS.fetchImagingIntoICU(pid); }
    else { wardSyncFetch(); }   // opens the ward picker; selecting a patient imports labs + imaging
  }

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
    { key: "ca", kw: /\bcalcium\b/i, ex: /urin|ionis|ioniz|ionic|\bion\b|\bfree\b|whole ?blood|24/i },   // TOTAL calcium only — ionised/free calcium (~1.1 mmol/L, e.g. "Free Calcium"/"Calcium Ion") is tracked separately, never the total field
    { key: "mg", kw: /magnesium/i, ex: /urin/i },
    { key: "po4", kw: /phosphate|phosphorus|\bpo4\b/i, ex: /alkaline|phosphatase|creatine/i }, // exclude Alk Phosphatase / CPK
    { key: "glu", kw: /glucose|blood sugar|\brbs\b|\bcbg\b/i, ex: /urin|csf|tolerance|dipsi/i },
    { key: "creat", kw: /creatinine/i, ex: /urin|clearance|ratio/i },
    { key: "urea", kw: /\burea\b/i, ex: /nitrogen|\bbun\b|urin/i },   // BUN ≠ urea (scale differs) — excluded
    { key: "alb", kw: /\balbumin\b/i, ex: /globulin|ratio|urin|micro/i },
    { key: "wbc", kw: /\bwbc\b|leucocyte|leukocyte|total leu|\btlc\b/i, ex: /differential|urin|csf/i },
    { key: "hb", kw: /ha?emoglobin/i, ex: /corpuscular|\bmch\b|\bmchc\b|a1c|glycated|equivalent|reticulocyte/i },   // ha?e- matches US 'hemoglobin' + British 'haemoglobin'
    { key: "plt", kw: /platelet/i, ex: /immature|fraction/i },
    { key: "inr", kw: /\binr\b|prothrombin|\bpt\b\/inr/i, ex: /aptt|partial/i },
    { key: "bili_d", kw: /(direct|conjugated)\s*bilirubin|bilirubin[^a-z]*(direct|conjugated)/i, ex: /indirect|unconjugat/i },   // direct/conjugated — checked before total
    { key: "bili", kw: /bilirubin/i, ex: /direct|indirect|conjugat|neonat/i },   // total only
    { key: "ast", kw: /\bast\b|sgot/i, ex: null },
    { key: "alt", kw: /\balt\b|sgpt/i, ex: null },
    { key: "crp", kw: /c-reactive|\bcrp\b/i, ex: /procalcitonin/i },
    { key: "lactate", kw: /\blactate\b/i, ex: /dehydrogenase|\bldh\b|csf/i },
    { key: "alp", kw: /alkaline phosphatase|\balp\b/i, ex: null },
    { key: "amylase", kw: /amylase/i, ex: null },   // body-fluid amylase excluded by the specimen guard
    { key: "lipase", kw: /lipase/i, ex: null },
    { key: "pct", kw: /procalcitonin|\bpct\b/i, ex: null },
    { key: "neut", kw: /neutrophil/i, ex: /band|immature|precursor|promyelo|metamyelo/i },
    { key: "hct", kw: /ha?ematocrit|\bhct\b|\bpcv\b/i, ex: null }
  ];
  // Body-fluid / non-serum specimens must NEVER populate a serum analyte field: an
  // "Ascitic Fluid Albumin" is not serum albumin; a pleural/CSF/peritoneal/synovial/drain
  // fluid glucose or protein is not the serum value. The GHIS feed flattens every test from
  // up to 25 orders, so these body-fluid rows sit right next to the serum panels. Guard them
  // out so they're left for manual entry rather than silently overwriting the serum result.
  var NON_SERUM_SPECIMEN = /\bfluid\b|ascit|paracente|pleural|periton|synovial|pericardial|\bcsf\b|cerebrospinal|\bdrain\b|dialysa|\bsemen\b|sputum/i;
  function mapWardLab(name) {
    var n = String(name || "").toLowerCase();
    if (NON_SERUM_SPECIMEN.test(n)) return null;
    for (var i = 0; i < WARD_LAB_MAP.length; i++) {
      var m = WARD_LAB_MAP[i];
      if (m.kw.test(n) && !(m.ex && m.ex.test(n))) return m.key;
    }
    return null;
  }
  // GHIS/HIS reports Ca/Mg/PO₄/glucose/creatinine/albumin in CONVENTIONAL units (mg/dL, g/dL)
  // but the ICU/ELYTE analysers store + interpret them in SI (mmol/L, µmol/L, g/L). Without
  // conversion, e.g. Ca 9.4 mg/dL was read as 9.4 mmol/L → ELYTE ×4 → "40.4 mg/dL, severe
  // hypercalcaemia". Convert conventional→SI on ingest. Na/K/Cl/HCO₃ are mEq/L == mmol/L, so
  // they're never converted. Factors mirror electrolytes.js CONV (conventional = SI × f).
  // conventional (Indian) = SI × f. The whole app AND the ELYTE correction-dose calculator work in
  // CONVENTIONAL units: glucose/creatinine/urea/Ca/Mg/PO₄ in mg/dL, albumin g/dL, Na/K/Cl/HCO₃ mEq/L.
  var WARD_CONV = { ca: 4.0, mg: 2.43, po4: 3.1, glu: 18, creat: 1 / 88.4, alb: 0.1, urea: 6.006 };
  // Standardisation: keep each lab in the UNITS ON THE GHIS REPORT. GHIS reports conventional
  // (Indian) units, so values are kept AS REPORTED — no conversion. Only an explicit SI report
  // (mmol/L / µmol/L / g/L) is converted SI → conventional. (Function name kept for compatibility.)
  function wardToSI(key, val, units) {
    var u = String(units || "").toLowerCase().replace(/\s+/g, "");
    // Platelets: Indian labs report lakhs/cumm (×10⁵/µL) → ×10⁹/L is ×100; an absolute /cumm count
    // (e.g. 141000) is ÷1000; else a value implausibly low as ×10⁹/L (normal 150–450) is really lakhs.
    if (key === "plt") {
      if (/lakh/.test(u)) return Math.round(val * 100);
      if (val > 1000) return Math.round(val / 1000);
      if (!u && val > 0 && val < 20) return Math.round(val * 100);
      return val;
    }
    var f = WARD_CONV[key]; if (!f) return val;                      // Na/K/Cl/HCO₃/Hb/eGFR: mEq==mmol, never converted
    if (/mmol|µmol|umol|micromol|g\/l/.test(u)) return +(val * f).toFixed(2);   // explicit SI report → conventional (Indian)
    return val;                                                      // mg/dL / g/dL / unit-less → keep exactly as the report
  }
  window.SMD_wardToSI = wardToSI;   // exposed for verification
  // Ingest a normalised Ward-Sync / imported bundle. Conflict-SAFE: never silently
  // overwrites a clinician's Manual value — records a conflict for the clinician to resolve.
  // bundle: { patient?, source?, ts?, labs:[{test,result,units,low,high}], vitals?, abg? }
  // Full per-patient reset: STATE + in-memory Deep/dx caches + Lab Watch view flags. Shared by
  // ICU.reset() and the ward-patient-switch guard so NO stale patient data (weight, infusions,
  // vitals, findings, correlation/dx caches — BUG L7 — or the Lab Watch badge/highlight/draft —
  // BUG M5) can survive a patient switch.
  function resetState() {
    var d = clone(DEFAULT_STATE); Object.keys(d).forEach(function (k) { STATE[k] = d[k]; });
    _lwBadge = 0; _lwHighlight = null; _lwDraft = null;
    _corrCache = {}; _corrErr = null; _corrBusy = false; _corrAnalysed = false;
    _dxShow = false; _dxWhy = {}; _dxAdvanced = false; _dxPt = null; _corrPt = null;
  }
  // Load THIS context's solo current-patient buffer into STATE — used when switching ICU ↔ Ward so
  // each mode keeps its own scratch patient (bufKey is namespaced by _wardMode). Same key-copy shape
  // as grpApplyState; missing keys fall back to DEFAULT_STATE.
  function ctxLoadBuffer() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(bufKey()) || "null"); } catch (e) {}
    if (!raw || typeof raw !== "object") raw = clone(DEFAULT_STATE);
    Object.keys(DEFAULT_STATE).forEach(function (k) { STATE[k] = (raw[k] != null) ? clone(raw[k]) : clone(DEFAULT_STATE[k]); });
  }
  var _pickStep = "category";   // unit-picker step: "hospital" | "category" | "units"
  var _pickCat = null;          // category being drilled into on the "units" step
  var _grpNewCat = null;        // category (icu|ward) of the unit being created
  // Switch the active unit (category/type). The current buffer already auto-persisted to its own key;
  // this loads the TARGET unit's own buffer and lands on the board. Solo: fully local. Group: the
  // caller resolves the shared group separately (grpSelect sets _unit from the group's kind/type).
  function selectUnit(u) {
    if (!u || !u.cat) return;
    var t = u.type || (u.cat === "ward" ? (_lastType.ward || "Male Ward") : (_lastType.icu || "ICU"));
    _unit = { cat: u.cat, type: t, hospital: (u.hospital != null ? u.hospital : _unit.hospital) || "" };
    _lastType[u.cat] = t;
    _wardMode = (_unit.cat === "ward");
    unitSavePref();
    try { if (grpActive()) grpTeardownPatient(); } catch (e) {}
    _grpPtId = null;
    try { ctxLoadBuffer(); } catch (e) {}
    _screen = "board"; _active = "overview"; _ws = "overview"; _wsLast = {};
  }
  // BUG C1 (cross-patient contamination): ingestFromWard/ingestWardHistory MERGE into live STATE
  // (their contract is "callers reset/select the patient before syncing"). Loading a DIFFERENT
  // ward patient must therefore start clean, or the previous patient's weight/infusions/vitals/
  // findings/ABG bleed onto the new one. Fires ONLY on a genuine ward-patient switch (patientId
  // present AND different from the one already loaded); a re-sync of the SAME patient still
  // merges, and non-ward imports (Snapshot/manual/voice — no bundle.patientId) are unaffected.
  function wardSwitchGuard(bundle) {
    var pid = bundle && bundle.patientId;
    if (pid == null || pid === "") return;
    var cur = (STATE.wardSync && STATE.wardSync.patientId);
    if (cur != null && cur !== "" && String(cur) !== String(pid)) resetState();
  }

  function ingestFromWard(bundle) {
    bundle = bundle || {};
    wardSwitchGuard(bundle);
    var source = bundle.source || "Ward Sync", ts = bundle.ts || nowTs(), applied = {}, conflicts = [], hadNew = false;
    if (bundle.patient) ingestPatient(bundle.patient);
    var labVals = {};
    (bundle.labs || []).forEach(function (t) {
      var key = mapWardLab(t.test); if (!key) return;
      var v = parseFloat(t.result); if (isNaN(v)) return;
      v = wardToSI(key, v, t.units);   // conventional (mg/dL, g/dL) → app SI so Ca/Mg/PO₄/glu/creat/alb aren't mis-scaled
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
    recompute(_raw);   // BUG #1: recompute alerts after a Ward-Sync import (abg/vent write directly to state)
    lwScan();          // Lab Watch: detect new results this sync brought in (no-op unless a watch is active)
    return { applied: Object.keys(applied), conflicts: conflicts.length, mappedLabs: Object.keys(labVals).length };
  }

  // Parse a Ward/LIS report date to a timestamp. Handles ISO and "DD-MON-YYYY [HH:MM]"
  // (GHIS style, e.g. "03-JUL-2026" / "03-Jul-2026 08:30"). Defaults to 08:00 if no time.
  // Returns ms epoch, or null if unrecognisable (caller falls back to ingestion time).
  var MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseWardDate(s) {
    if (!s && s !== 0) return null;
    s = String(s).trim(); if (!s) return null;
    var m = s.match(/(\d{1,2})[-\/\s]([A-Za-z]{3,})[-\/\s](\d{2,4})(?:[\sT,]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      var mo = MON[m[2].slice(0, 3).toLowerCase()];
      if (mo != null) { var yr = +m[3]; if (yr < 100) yr += 2000; return new Date(yr, mo, +m[1], m[4] != null ? +m[4] : 8, m[5] != null ? +m[5] : 0).getTime(); }
    }
    var t = Date.parse(s); return isNaN(t) ? null : t;
  }

  // Ward Sync HISTORY ingestion (ICU Trends). Unlike ingestFromWard (which keeps only the
  // latest value), this preserves the per-report time series: rows carry a `date` (report
  // date), are grouped by timestamp, mapped with the SAME safe mapper (mapWardLab + wardToSI +
  // specimen guard) and appended as dated snapshots to labs.trends[]. recent[key] is set from
  // the NEWEST report only, and a clinician's Manual value is never overwritten (a conflict is
  // recorded instead). Re-imports are deduped by (ts,key,value). Everything is scoped to the
  // patient currently loaded in ICU — callers reset/select the patient before syncing.
  function ingestWardHistory(bundle) {
    bundle = bundle || {};
    wardSwitchGuard(bundle);   // BUG C1: a different ward patient starts clean (see wardSwitchGuard)
    var source = bundle.source || "Ward Sync";
    if (bundle.patient) ingestPatient(bundle.patient);
    var byTs = {}, tsList = [];
    (bundle.labs || []).forEach(function (t) {
      var key = mapWardLab(t.test); if (!key) return;
      var v = parseFloat(t.result); if (isNaN(v)) return;
      v = wardToSI(key, v, t.units);
      var ts = parseWardDate(t.date) || bundle.ts || nowTs();
      if (!byTs[ts]) { byTs[ts] = {}; tsList.push(ts); }
      byTs[ts][key] = v;   // last row wins within the same report timestamp
    });
    tsList.sort(function (a, b) { return a - b; });   // oldest → newest so recent = last
    var pts = 0, keysSeen = {}, newestByKey = {}, conflicts = [];
    tsList.forEach(function (ts) {
      var rec = byTs[ts], fresh = {};
      Object.keys(rec).forEach(function (k) {
        var dup = (STATE.labs.trends || []).some(function (r) { return r.ts === ts && r[k] === rec[k]; });
        if (dup) return;                                  // dedup re-imported reports
        fresh[k] = rec[k]; keysSeen[k] = 1; pts++;
        newestByKey[k] = { v: rec[k], ts: ts };           // ascending → last assignment is newest
      });
      if (Object.keys(fresh).length) STATE.labs.trends.push(Object.assign({ ts: ts }, fresh));
    });
    if (STATE.labs.trends.length > MAX_SERIES) STATE.labs.trends.splice(0, STATE.labs.trends.length - MAX_SERIES);
    Object.keys(newestByKey).forEach(function (k) {
      var prev = STATE.src[k], nv = newestByKey[k];
      if (prev && prev.source === "Manual" && STATE.labs.recent[k] != null && Number(STATE.labs.recent[k]) !== nv.v) {
        conflicts.push({ key: k, label: k, ward: nv.v, manual: STATE.labs.recent[k], wardTs: nv.ts, manualTs: prev.ts, source: source });
        return;   // preserve clinician's manual value; surface a conflict
      }
      STATE.labs.recent[k] = nv.v; STATE.src[k] = { source: source, ts: nv.ts };
    });
    if (conflicts.length) STATE.conflicts = (STATE.conflicts || []).concat(conflicts);
    STATE.wardSync.connected = true; STATE.wardSync.lastTs = nowTs(); STATE.wardSync.newUpdate = pts > 0;
    if (bundle.patientId) STATE.wardSync.patientId = bundle.patientId;
    // STATE mutations above go through the reactive proxy, which coalesces a recompute()+render.
    lwScan();   // Lab Watch: detect new results this sync brought in (no-op unless a watch is active)
    return { reports: tsList.length, points: pts, keys: Object.keys(keysSeen), conflicts: conflicts.length };
  }

  /* ---------------------------------------------------------------- styles */
  function injectCSS() {
    if (document.getElementById("icu-css")) return;
    var css =
      // Design tokens live on BOTH the root surface AND the modal — the modal is
      // appended to <body> (outside #icuRoot), so without this its inputs/buttons
      // would resolve var(--border/--panel2/--ink/--primary) to nothing and render
      // invisible (white-on-white, no borders, no Save button).
      '#icuRoot,.icu-modal,.icu-tour{--bg:#F1F5F9;--panel:#fff;--panel2:#F8FAFC;--border:#E2E8F0;--ink:#0F172A;--muted:#64748B;--primary:#0F766E;--primary2:#115E59;--primary3:#14B8A6;--primary-soft:#CCFBF1;--ok:#15803D;--ok-soft:#DCFCE7;--warn:#92620A;--warn-soft:#FEF3C7;--danger:#B91C1C;--danger-soft:#FEE2E2;' +
      '--r:16px;--r-sm:12px;--r-pill:999px;--sh:0 1px 2px rgba(15,23,42,.05),0 4px 16px rgba(15,23,42,.07);--ease:.2s cubic-bezier(.2,.7,.2,1);' +
      "--font:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;--mono:'IBM Plex Mono','SF Mono',Consolas,monospace}" +
      '#icuRoot{position:fixed;inset:0;z-index:10000;background:var(--bg);color:var(--ink);font-family:var(--font);display:none;flex-direction:column;overflow:hidden}' +
      '.icu-modal{font-family:var(--font)}' +
      '#icuRoot.on{display:flex}' +
      'body.dark #icuRoot,body.v3-dark #icuRoot,body.dark .icu-modal,body.v3-dark .icu-modal,body.dark .icu-tour,body.v3-dark .icu-tour{--bg:#0B1220;--panel:#111B2E;--panel2:#0F1A2B;--border:#1E2B43;--ink:#E7EDF5;--muted:#8597AD;--primary:#2DD4BF;--primary2:#14B8A6;--primary3:#5EEAD4;--primary-soft:#0C2E2A;--ok:#4ADE80;--ok-soft:#06240F;--warn:#F0C060;--warn-soft:#241B00;--danger:#F87171;--danger-soft:#2A0E12;--sh:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35)}' +
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
      '.icu-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);background:var(--panel2);color:var(--ink);border-radius:var(--r-pill);font:700 12.5px var(--font);padding:8px 13px;cursor:pointer;flex:0 0 auto;min-height:36px;transition:border-color .15s,background .15s}' +
      '.icu-chip:active{transform:scale(.96)}.icu-chip:hover{border-color:var(--primary)}' +
      '.icu-chip .icu-ico{width:15px;height:15px}' +
      '.icu-chip-primary{background:var(--primary);border-color:var(--primary);color:#fff}.icu-chip-primary:hover{border-color:var(--primary);filter:brightness(1.05)}' +
      '.icu-ico{width:1em;height:1em;flex:0 0 auto;stroke:currentColor;stroke-width:1.85;fill:none;stroke-linecap:round;stroke-linejoin:round}' +
      '.icu-emoji{display:inline-flex;align-items:center;line-height:1}' +
      '.icu-sec-lbl .icu-ico{width:15px;height:15px;vertical-align:-2px;margin-right:4px;color:var(--primary)}' +
      '.icu-elyte-alerts>.icu-ico{width:15px;height:15px;vertical-align:-2px;margin-right:3px;color:var(--warn,#92620a)}' +
      '.icu-srcbtn .i .icu-ico{width:20px;height:20px;color:var(--primary)}' +
      '.icu-ai .ic .icu-ico{width:22px;height:22px;color:var(--primary)}' +
      '.icu-ai .man .icu-ico{width:12px;height:12px;vertical-align:-1px}' +
      '.icu-sheet h3 .icu-ico{width:19px;height:19px;vertical-align:-3px;margin-right:5px;color:var(--primary)}' +
      '.icu-step .icu-ico{width:15px;height:15px;vertical-align:-2px;margin-right:3px;color:var(--primary)}' +
      '.icu-badge .icu-ico{width:14px;height:14px;vertical-align:-2px;margin-right:3px}' +
      '.icu-btn .icu-ico{width:16px;height:16px;vertical-align:-3px;margin-right:5px}' +
      '.man .icu-ico{width:12px;height:12px;vertical-align:-1px;margin-right:1px}' +
      '.icu-chip:active{background:var(--primary-soft)}' +
      '.icu-adddata{background:var(--primary);color:#fff;font:800 15px var(--font);padding:14px;border:none;border-radius:14px;width:100%;cursor:pointer;box-shadow:0 2px 10px var(--primary-soft)}' +
      // scroll area
      '.icu-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 12px calc(96px + env(safe-area-inset-bottom))}' +
      '.icu-wrap{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:14px}' +
      '.icu-sec-lbl{font:800 11px var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:2px 2px -4px;display:flex;align-items:center;gap:7px}' +
      '.icu-sbar-head{margin-bottom:10px}' +
      '.icu-sbar{border-left:3px solid var(--border);background:var(--panel2);border-radius:10px;padding:11px 13px;margin-bottom:10px}' +
      '.icu-sbar-lbl{font:800 11px var(--font);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px}' +
      '.icu-sbar-body{font:500 14px/1.5 var(--font);color:var(--ink)}' +
      '.icu-v2-tabbadge{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;margin-left:5px;border-radius:9px;background:var(--danger);color:#fff;font:800 10px var(--font);vertical-align:middle}' +
      /* Overview design cards (Active problems · consultant instruction · Current treatment) */
      '.icu-ov-prob{display:flex;align-items:center;gap:9px}' +
      '.icu-ov-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}' +
      '.icu-ov-prob-nm{font:600 14px var(--font);color:var(--ink);flex:1;min-width:0}' +
      '.icu-ov-prob-note{font:600 11px var(--font);color:var(--muted);flex:0 0 auto}' +
      '.icu-ov-instr{background:var(--primary-soft);border-color:color-mix(in srgb,var(--primary) 45%,var(--panel))}' +
      '.icu-ov-instr-tx{font:600 14.5px/1.5 var(--font);color:var(--ink);margin:0}' +
      '.icu-ov-instr-by{font:600 12px var(--font);color:var(--primary);margin:6px 0 0}' +
      '.icu-ov-viewtasks{width:100%;margin-top:12px;border:none;background:var(--primary);color:#fff;border-radius:12px;font:800 14px var(--font);padding:13px;cursor:pointer}' +
      '.icu-ov-tx{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)}' +
      '.icu-ov-tx:last-child{border-bottom:none}' +
      '.icu-ov-tx-nm{font:600 13.5px var(--font);color:var(--ink)}' +
      '.icu-ov-tx-dose{font:600 13px "IBM Plex Mono",ui-monospace,monospace;color:var(--ink);white-space:nowrap}' +
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
      '.icu-imp-ov{position:fixed;inset:0;z-index:19000;background:rgba(15,23,42,.55);display:flex!important;align-items:center;justify-content:center;padding:16px}' +
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
      '.icu-spark{width:100%;height:18px;display:block;margin-top:5px;color:var(--muted);opacity:.8}' +
      '.icu-vc.crit .icu-spark{color:var(--danger);opacity:1}.icu-vc.warn .icu-spark{color:var(--warn);opacity:1}.icu-vc.ok .icu-spark{color:var(--primary)}' +
      // generic card
      '.icu-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);padding:15px;box-shadow:var(--sh)}' +
      '.icu-score{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer}' +
      '.icu-score:last-of-type{border-bottom:0}' +
      '.icu-score-n{font:800 13px var(--font)}' +
      '.icu-score-v{font:800 13px var(--font);color:var(--primary)}' +
      '.icu-score-i{flex:1 1 100%;font:600 12px/1.45 var(--font);color:var(--muted)}' +
      '.icu-score.miss{opacity:.6;cursor:pointer}' +
      '.icu-score-need{font:600 12px var(--font);color:var(--muted);font-style:italic}' +
      '.icu-score-sug{margin-top:10px;font:600 12px/1.6 var(--font);color:var(--muted)}' +
      '.icu-score-chip{font:700 12px var(--font);padding:5px 10px;margin:2px;border:1px solid var(--border);border-radius:14px;background:var(--panel);color:var(--primary);cursor:pointer}' +
      '.icu-card h3{font:800 16px var(--font);margin:0 0 4px}.icu-card p{font:500 13.5px/1.5 var(--font);color:var(--muted);margin:0}' +
      // AI import grid
      '.icu-ai-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.icu-ai{background:var(--panel);border:1px dashed var(--border);border-radius:var(--r-sm);padding:13px;text-align:left;cursor:pointer;color:var(--ink);position:relative;transition:transform var(--ease),box-shadow var(--ease)}' +
      '.icu-ai:active{transform:scale(.98)}.icu-ai:hover{box-shadow:var(--sh)}' +
      '.icu-ai .ic{font-size:22px}.icu-ai .t{font:700 13.5px var(--font);margin-top:6px}.icu-ai .s{font:500 11px/1.4 var(--font);color:var(--muted);margin-top:2px}' +
      '.icu-badge{display:inline-block;font:800 9px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--warn);background:var(--warn-soft);border-radius:var(--r-pill);padding:2px 7px;margin-top:8px}' +
      '.icu-ai .man{display:inline-block;margin-top:8px;margin-left:6px;font:700 11px var(--font);color:var(--primary)}' +
      // alert / recommendation / protocol cards
      '.icu-alert{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-left-width:4px;border-radius:var(--r-sm);padding:11px 13px;background:var(--panel);margin-bottom:6px}' +
      '.icu-alert-grp{font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:10px 0 4px}.icu-alert-grp:first-child{margin-top:0}' +
      '.icu-alert.crit{border-left-color:var(--danger);background:var(--danger-soft)}' +
      '.icu-alert.warn{border-left-color:var(--warn);background:var(--warn-soft)}' +
      '.icu-alert .at{font:700 13.5px var(--font)}.icu-alert .am{font:500 12.5px/1.45 var(--font);color:var(--muted);margin-top:1px}' +
      '.icu-alert .ax{margin-left:auto;font:700 9px var(--font);text-transform:uppercase;color:var(--muted)}' +
      '.icu-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font:500 13.5px var(--font)}.icu-row:last-child{border-bottom:none}.icu-row b{font-weight:700}' +
      '.icu-ev{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.icu-ev span{font:700 10px var(--font);color:var(--primary);background:var(--primary-soft);border-radius:var(--r-pill);padding:3px 9px}' +
      '.icu-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;border:none;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--primary3),var(--primary) 60%,var(--primary2));color:#fff;font:800 14px var(--font);padding:13px;cursor:pointer;box-shadow:var(--sh);margin-top:12px;transition:filter var(--ease),transform var(--ease)}.icu-btn:active{transform:scale(.985)}.icu-btn:hover{filter:brightness(1.05)}' +
      '.icu-btn.ghost{background:none;border:1px solid var(--border);color:var(--primary);box-shadow:none}' +
      '.icu-empty{font:500 13px var(--font);color:var(--muted);text-align:center;padding:8px 0}' +
      '.icu-coach{background:var(--primary-soft,#0d2e2a);border:1px solid var(--primary,#0f766e);border-radius:14px;padding:13px 14px;margin-bottom:12px}' +
      '.icu-coach-h{display:flex;align-items:center;justify-content:space-between;font:800 14px var(--font);color:var(--ink)}' +
      '.icu-coach-x{border:none;background:none;color:var(--muted);font:600 15px var(--font);cursor:pointer;padding:2px 6px}' +
      '.icu-coach-p{margin:7px 0;font:500 13px/1.55 var(--font);color:var(--ink)}' +
      '.icu-coach-steps{margin:6px 0 10px;padding-left:20px;font:500 12.5px/1.7 var(--font);color:var(--muted)}' +
      '.icu-coach-steps b{color:var(--ink)}' +
      '.icu-empty-state{text-align:center;padding:26px 16px;background:var(--panel);border:1px dashed var(--border);border-radius:16px;margin-bottom:12px}' +
      '.icu-empty-ic{font-size:40px;margin-bottom:10px;display:flex;justify-content:center}.icu-empty-ic .icu-ico{width:46px;height:46px;stroke-width:1.4;color:var(--primary);opacity:.9}' +
      '.icu-empty-t{font:800 17px var(--font);color:var(--ink);margin-bottom:6px}' +
      '.icu-empty-p{font:500 13px/1.6 var(--font);color:var(--muted);max-width:340px;margin:0 auto}' +
      '.icu-empty-cta{width:auto!important;display:inline-block;margin-top:12px;padding:12px 22px}' +
      '.icu-tr-empty-btns{display:flex;flex-direction:column;gap:8px;max-width:270px;margin:14px auto 0}' +
      '.icu-trend-wins{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin:10px 0 12px}' +
      '.icu-tr-flags{background:var(--warn-soft,#fef3c7);border:1px solid var(--warn,#92620a);border-radius:12px;padding:10px 12px;margin:2px 0 12px}' +
      '.icu-tr-flags-h{font:800 12px var(--font);color:var(--warn,#92620a);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;display:flex;align-items:center;gap:5px}' +
      '.icu-tr-flags-h span{font-weight:600;text-transform:none;letter-spacing:0;opacity:.85}.icu-tr-flags-h .icu-ico{width:15px;height:15px}' +
      '.icu-tr-flag{display:inline-block;background:var(--panel);border:1px solid var(--warn,#92620a);color:var(--ink);border-radius:999px;font:700 12px var(--font);padding:5px 11px;margin:0 6px 6px 0}' +
      '.icu-tr-group{margin-bottom:12px;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--panel)}' +
      '.icu-tr-group>summary{cursor:pointer;list-style:none;padding:12px 14px;font:800 13.5px var(--font);color:var(--ink);display:flex;align-items:center;gap:8px}' +
      '.icu-tr-group>summary::-webkit-details-marker{display:none}' +
      '.icu-tr-group>summary::after{content:"\\25B8";margin-left:auto;color:var(--muted);transition:transform .15s}.icu-tr-group[open]>summary::after{transform:rotate(90deg)}' +
      '.icu-tr-cnt{background:var(--primary-soft);color:var(--primary);border-radius:999px;font:800 11px var(--font);padding:2px 9px}' +
      '.icu-tr-none{color:var(--muted);font-weight:600;font-size:12px}.icu-tr-empty{padding:0 14px 14px;color:var(--muted);font:600 12.5px var(--font)}' +
      '.icu-tr-card{margin:0 10px 10px}' +
      // Lab Watch
      '.icu-chip-lw{background:var(--primary-soft);border-color:var(--primary);color:var(--primary2,var(--primary))}' +
      '.icu-lw-badge{display:inline-flex;min-width:16px;height:16px;padding:0 4px;align-items:center;justify-content:center;background:var(--danger,#b91c1c);color:#fff;border-radius:999px;font:800 10px var(--font);margin-left:3px}' +
      '.icu-tr-card.lw-hi{outline:2px solid var(--primary);outline-offset:1px;box-shadow:0 0 0 4px var(--primary-soft)}' +
      '.icu-lw-sheet .icu-lw-list{max-height:34vh;overflow:auto;margin-bottom:6px}' +
      '.icu-lw-grp{margin:0 0 10px}.icu-lw-grp-h{margin:0 0 6px}' +
      '.icu-lw-grpall{font:800 11.5px var(--font);letter-spacing:.02em;text-transform:uppercase;color:var(--muted);background:none;border:none;padding:2px 0;cursor:pointer}.icu-lw-grpall.on{color:var(--primary)}' +
      '.icu-lw-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.icu-lw-an{font:700 12.5px var(--font);background:var(--panel2);border:1px solid var(--border);color:var(--ink);border-radius:999px;padding:6px 11px;cursor:pointer}.icu-lw-an.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary2,var(--primary))}' +
      '.icu-lw-none,.icu-lw-empty{font:600 12.5px var(--font);color:var(--muted);padding:10px 2px}' +
      '.icu-lw-opts{border-top:1px solid var(--border);padding-top:10px;margin-top:4px}.icu-lw-opt{margin-bottom:10px}.icu-lw-opt>label{display:block;font:800 11.5px var(--font);text-transform:uppercase;letter-spacing:.03em;color:var(--muted);margin-bottom:5px}' +
      '.icu-lw-segs{display:flex;flex-wrap:wrap;gap:6px}' +
      '.icu-lw-seg{font:700 12.5px var(--font);background:var(--panel2);border:1px solid var(--border);color:var(--ink);border-radius:9px;padding:7px 11px;cursor:pointer}.icu-lw-seg.on{background:var(--primary);border-color:var(--primary);color:#fff}' +
      '.icu-lw-hint{font:600 11.5px/1.4 var(--font);color:var(--muted);margin-top:6px}' +
      '.icu-lw-count{font:700 12px var(--font);color:var(--muted);text-align:center;margin:6px 0 10px}' +
      '.icu-lw-state{font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:999px;vertical-align:middle}.icu-lw-state.on{background:var(--ok-soft);color:var(--ok)}.icu-lw-state.pause{background:var(--warn-soft);color:var(--warn)}.icu-lw-state.exp{background:var(--danger-soft);color:var(--danger)}' +
      '.icu-lw-meta{font:600 12.5px var(--font);color:var(--muted);margin:2px 0 8px}' +
      '.icu-lw-tags{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px}.icu-lw-tag{font:700 11.5px var(--font);background:var(--panel2);border:1px solid var(--border);color:var(--ink);border-radius:999px;padding:4px 9px}' +
      '.icu-lw-banner{font:600 12px/1.4 var(--font);color:var(--primary2,var(--primary));background:var(--primary-soft);border-radius:10px;padding:9px 11px;margin-bottom:10px}' +
      '.icu-lw-acts{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}' +
      '.icu-lw-act{text-align:left;background:var(--panel2);border:1px solid var(--border);border-left-width:3px;border-radius:10px;padding:8px 11px;cursor:pointer;display:flex;flex-direction:column;gap:2px}' +
      '.icu-lw-act.crit{border-left-color:var(--danger)}.icu-lw-act.chg{border-left-color:var(--warn)}.icu-lw-act.new{border-left-color:var(--primary)}' +
      '.icu-lw-act-t{font:700 13px var(--font);color:var(--ink)}.icu-lw-act-w{font:600 11px var(--font);color:var(--muted)}' +
      '.icu-lw-btns{display:flex;gap:8px;margin:4px 0}.icu-lw-btns .icu-btn{flex:1;margin:0}' +
      '.icu-tr-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}' +
      '.icu-tr-lbl{font:800 14px var(--font);color:var(--ink)}' +
      '.icu-tr-val{font:800 18px var(--font);color:var(--ink);white-space:nowrap}.icu-tr-val .u{font:600 11px var(--font);color:var(--muted)}.icu-tr-arrow{font-size:17px}' +
      '.icu-tr-sub{font:600 12px var(--font);color:var(--muted);margin-top:3px}' +
      '.icu-tr-interp{font:800 12.5px var(--font);margin-top:2px;text-transform:capitalize}' +
      '.icu-tr-note{font:600 11.5px var(--font);color:var(--muted);margin-top:4px;font-style:italic}' +
      '.icu-tr-src{display:flex;align-items:center;gap:8px;font:600 11px var(--font);color:var(--muted);margin:6px 0 8px}' +
      '.icu-tr-st{border-radius:999px;font:800 10px var(--font);padding:2px 8px;text-transform:uppercase;letter-spacing:.03em}' +
      '.icu-tr-st.crit{background:var(--danger-soft,#fee2e2);color:var(--danger,#b91c1c)}.icu-tr-st.ab{background:var(--warn-soft,#fef3c7);color:var(--warn,#92620a)}.icu-tr-st.ok{background:var(--ok-soft,#dcfce7);color:var(--ok,#15803d)}' +
      '.icu-tr-single{font:600 12px var(--font);color:var(--muted);padding:8px 0}' +
      // persistent patient banner + severity key (A6)
      '.icu-banner{display:flex;flex-wrap:wrap;align-items:center;gap:2px 4px;font:600 12px var(--font);color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:8px 11px;margin-bottom:10px}' +
      '.icu-banner b{color:var(--ink);font-weight:800}.icu-banner .bad{color:var(--danger);font-weight:800}.icu-banner .sep{opacity:.4;margin:0 3px}' +
      '.icu-sevkey{display:flex;gap:14px;justify-content:center;font:600 10.5px var(--font);color:var(--muted);margin-bottom:10px}' +
      '.icu-sevkey span{display:inline-flex;align-items:center;gap:5px}.icu-sevkey i{width:9px;height:9px;border-radius:50%;display:inline-block}' +
      '.icu-sevkey i.ok{background:var(--ok)}.icu-sevkey i.warn{background:var(--warn)}.icu-sevkey i.bad{background:var(--danger)}' +
      '.icu-phase{display:inline-block;font:800 9px var(--font);letter-spacing:.05em;text-transform:uppercase;color:var(--primary);background:var(--primary-soft);border-radius:var(--r-pill);padding:3px 9px;margin-left:7px}' +
      // plain-language jargon tooltips (A5) — tap ⓘ to open an explanation
      '.icu-tip{border:none;background:none;color:var(--primary);cursor:pointer;font:600 11px var(--font);padding:0 2px;vertical-align:baseline;-webkit-appearance:none}' +
      '.icu-tip-pop{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translate(-50%,14px);width:min(360px,calc(100vw - 28px));background:var(--panel,#0b1620);border:1px solid var(--primary,#0f766e);border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.4);padding:13px 15px;z-index:10040;opacity:0;transition:opacity .2s,transform .2s;pointer-events:auto}' +
      '.icu-tip-pop.on{opacity:1;transform:translate(-50%,0)}' +
      '.icu-tip-h{display:flex;align-items:center;justify-content:space-between;font:800 14px var(--font);color:var(--primary)}' +
      '.icu-tip-x{border:none;background:none;color:var(--muted);font:600 16px var(--font);cursor:pointer;padding:0 4px;line-height:1}' +
      '.icu-tip-b{margin-top:6px;font:500 13px/1.55 var(--font);color:var(--ink)}' +
      // tab bar (frosted, fixed bottom, scrollable)
      '.icu-tabs{position:absolute;left:0;right:0;bottom:0;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;background:var(--panel);border-top:1px solid var(--border);padding:5px 6px calc(5px + env(safe-area-inset-bottom));z-index:5}' +
      '.icu-tabs::-webkit-scrollbar{display:none}' +
      '.icu-tab{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:2px;border:none;background:none;color:var(--muted);cursor:pointer;padding:6px 9px;border-radius:10px;min-width:58px}' +
      '.icu-tab .ti{font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;height:21px}.icu-tab .ti .icu-ico{width:21px;height:21px;stroke-width:1.9}.icu-tab .tl{font:700 9.5px var(--font);white-space:nowrap}' +
      '.icu-x .icu-ico{width:19px;height:19px;stroke-width:2}' +
      '#icuSnap .icu-ico{width:24px;height:24px;stroke-width:2}' +
      '.icu-tab.on{color:var(--primary);background:var(--primary-soft);box-shadow:inset 0 2px 0 var(--primary)}' +
      '.icu-tab.on .tl{font-weight:800}' +
      // 5-workspace bottom bar: evenly spaced, no scroll, no truncation
      '.icu-ws-bar{overflow-x:visible;justify-content:space-between;gap:0;padding-left:4px;padding-right:4px}' +
      '.icu-ws-bar .icu-tab{flex:1 1 0;min-width:0;padding:6px 4px}.icu-ws-bar .icu-tab .tl{font-size:10px}' +
      // segmented sub-navigation (workspace members)
      '.icu-subnav{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:0 0 12px;padding-bottom:2px}.icu-subnav::-webkit-scrollbar{display:none}' +
      '.icu-seg{flex:0 0 auto;border:1px solid var(--border);background:var(--panel);color:var(--muted);border-radius:999px;font:700 12.5px var(--font);padding:7px 14px;cursor:pointer;transition:border-color .15s,background .15s}' +
      '.icu-seg:active{transform:scale(.96)}.icu-seg.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
      '.icu-doc-sub{font:600 12.5px/1.5 var(--font);color:var(--muted);margin:2px 0 12px}' +
      '.icu-dx-cc{font:600 14px/1.55 var(--font);color:var(--ink);margin:2px 0 12px;white-space:pre-wrap}.icu-dx-cur{font:700 16px var(--font);color:var(--ink);margin:2px 0 12px}' +
      '.icu-dx-results{margin-top:10px;display:flex;flex-direction:column;gap:6px;max-height:46vh;overflow:auto}' +
      '.icu-dx-hint{font:600 12.5px var(--font);color:var(--muted);padding:8px 2px}' +
      '.icu-dx-hit{display:flex;align-items:center;gap:8px;text-align:left;width:100%;border:1px solid var(--border);background:var(--panel2);color:var(--ink);border-radius:10px;padding:11px 13px;cursor:pointer;font:700 14px var(--font)}' +
      '.icu-dx-hit:hover{border-color:var(--primary)}.icu-dx-hit:active{transform:scale(.99)}.icu-dx-hit .nm{flex:1}.icu-dx-hit .sys{font:600 11px var(--font);color:var(--muted);white-space:nowrap}' +
      // desktop: centre the 5-workspace bar and widen items (same grouping, roomier)
      '@media (min-width:900px){.icu-ws-bar{justify-content:center;gap:8px}.icu-ws-bar .icu-tab{flex:0 0 auto;min-width:120px;flex-direction:row;gap:8px}.icu-ws-bar .icu-tab .tl{font-size:13px}}' +
      // snapshot FAB
      '#icuSnap{position:absolute;right:14px;bottom:calc(74px + env(safe-area-inset-bottom));z-index:6;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,var(--primary3),var(--primary2));color:#fff;font-size:24px;box-shadow:0 8px 24px rgba(15,118,110,.42);cursor:pointer;display:flex;align-items:center;justify-content:center}#icuSnap:active{transform:scale(.92)}' +
      // Prominent Lab Watch FAB — a labelled pill stacked above the Snapshot FAB so the
      // watch-labs action is easy to find (was only a small chip in the header row).
      '#icuWatch{position:absolute;right:14px;bottom:calc(138px + env(safe-area-inset-bottom));z-index:6;height:44px;border-radius:22px;padding:0 15px;border:1.5px solid var(--primary);background:var(--panel);color:var(--primary2,var(--primary));font:800 13px var(--font);box-shadow:0 6px 18px rgba(15,118,110,.28);cursor:pointer;display:inline-flex;align-items:center;gap:6px}' +
      '#icuWatch.on{background:linear-gradient(135deg,var(--primary3),var(--primary2));color:#fff;border-color:transparent}#icuWatch:active{transform:scale(.94)}#icuWatch .icu-ico{width:17px;height:17px}' +
      '#icuWatch .icu-lw-fab-b{background:var(--danger,#b91c1c);color:#fff;border-radius:999px;font:800 10px var(--font);padding:1px 5px;min-width:15px;text-align:center}' +
      // modal
      '.icu-modal{position:fixed;inset:0;z-index:10020;display:none;align-items:flex-end;justify-content:center;background:rgba(8,18,26,.5)}' +
      '.icu-modal.on{display:flex}' +
      '.icu-sheet{background:var(--panel);color:var(--ink);width:100%;max-width:560px;max-height:88vh;overflow-y:auto;border-radius:20px 20px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.25)}' +
      '.icu-sheet h3{font:800 17px var(--font);margin:2px 0 14px}' +
      '.icu-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      '.icu-fld{display:flex;flex-direction:column;gap:4px}.icu-fld label{font:700 11px var(--font);color:var(--muted)}' +
      '.icu-fld input,.icu-fld select{font:600 15px var(--font);padding:10px 11px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%}' +
      '.icu-steps{counter-reset:s}.icu-step{display:flex;gap:11px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--border)}.icu-step .n{flex:0 0 auto;width:24px;height:24px;border-radius:50%;background:var(--primary-soft);color:var(--primary);font:800 12px var(--font);display:flex;align-items:center;justify-content:center}' +
      // Imaging Notes
      '.icu-img-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.icu-img-btns .icu-btn{width:auto;flex:1 1 auto;min-width:44%}' +
      '.icu-img-filters{display:flex;gap:6px;overflow-x:auto;padding:2px 0 10px;-webkit-overflow-scrolling:touch}' +
      '.icu-img-chip{flex:0 0 auto;border:1px solid var(--border);background:var(--panel2);color:var(--muted);border-radius:var(--r-pill);font:700 12px var(--font);padding:7px 12px;cursor:pointer;white-space:nowrap}.icu-img-chip.on{background:var(--primary);border-color:var(--primary);color:#fff}' +
      '.icu-img-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--r);box-shadow:var(--sh);margin:0 0 10px;overflow:hidden}.icu-img-card.crit{border-color:color-mix(in srgb,var(--danger) 55%,var(--border))}' +
      '.icu-img-hd{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;background:none;border:none;padding:13px 14px 10px;cursor:pointer;color:var(--ink)}.icu-img-hd-l{flex:1;min-width:0}' +
      '.icu-img-title{font:800 15px var(--font);line-height:1.3}' +
      '.icu-img-badges{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 2px}' +
      '.icu-img-badge{font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.04em;background:var(--primary-soft);color:var(--primary);border-radius:6px;padding:3px 7px}' +
      '.icu-img-tag{font:700 10.5px var(--font);background:var(--panel2);color:var(--muted);border:1px solid var(--border);border-radius:6px;padding:3px 7px}.icu-img-tag.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--border))}' +
      '.icu-img-meta{font:600 11.5px var(--font);color:var(--muted);margin-top:5px}' +
      '.icu-img-chev{flex:0 0 auto;color:var(--muted);font-size:14px;margin-top:2px}' +
      '.icu-img-crit{margin:0 14px 10px;background:var(--danger-soft);color:var(--danger);border:1px solid color-mix(in srgb,var(--danger) 40%,transparent);border-radius:10px;padding:9px 11px;font:600 12.5px/1.45 var(--font)}.icu-img-crit .icu-ico{width:14px;height:14px;vertical-align:-2px;color:var(--danger)}' +
      '.icu-img-crit-t{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.icu-img-crit-t span{background:color-mix(in srgb,var(--danger) 14%,transparent);border-radius:6px;padding:2px 7px;font:700 11px var(--font)}' +
      '.icu-img-imp,.icu-img-sec{padding:0 14px 10px;font:600 13.5px/1.5 var(--font);color:var(--ink)}.icu-img-k{display:block;font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:3px}' +
      '.icu-img-raw{white-space:pre-wrap;font:500 12.5px/1.5 var(--mono);color:var(--muted);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:9px 10px;max-height:260px;overflow:auto}' +
      '.icu-img-acts{display:flex;flex-wrap:wrap;gap:6px;padding:2px 12px 12px}.icu-img-act{border:1px solid var(--border);background:var(--panel2);color:var(--ink);border-radius:var(--r-pill);font:700 11.5px var(--font);padding:6px 11px;cursor:pointer}.icu-img-act.on{background:var(--primary-soft);border-color:var(--primary);color:var(--primary)}' +
      '.icu-img-hidden{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;color:var(--muted);font:600 12.5px var(--font);border:1px dashed var(--border);border-radius:10px;margin:0 0 8px}' +
      '.icu-img-btns .icu-ico,.icu-doc-sub+.icu-img-btns .icu-ico{width:15px;height:15px;vertical-align:-2px;margin-right:4px}' +
      '.icu-assist-out{margin-top:6px}' +
      '.icu-assist-msg{font:600 13px var(--font);color:var(--ink);background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:10px 12px}' +
      '.icu-assist-draft{font:800 11px var(--font);text-transform:uppercase;letter-spacing:.04em;color:var(--warn);background:var(--warn-soft);border-radius:8px;padding:6px 10px;margin-bottom:8px}' +
      '.icu-assist-summary{font:700 14px/1.5 var(--font);color:var(--ink);margin-bottom:8px}' +
      '.icu-assist-ul{margin:2px 0 0;padding-left:18px}.icu-assist-ul li{font:600 13px/1.5 var(--font);color:var(--ink);margin:1px 0}' +
      '.icu-assist-src{font:600 11px var(--font);color:var(--muted);margin-top:8px}' +
      // Clinical Correlation
      '.icu-corr-meta{font:600 12px var(--font);color:var(--muted);margin:2px 0 10px}' +
      '.icu-corr-badge{display:inline-block;font:800 11px var(--font);text-transform:uppercase;letter-spacing:.03em;border-radius:8px;padding:5px 10px;margin-bottom:8px;background:var(--panel2);color:var(--muted);border:1px solid var(--border)}' +
      '.icu-corr-badge.ok{background:var(--ok-soft);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,var(--border))}.icu-corr-badge.partial{background:var(--primary-soft);color:var(--primary)}.icu-corr-badge.warn{background:var(--warn-soft);color:var(--warn)}' +
      '.icu-corr-sub{font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:10px 0 5px}' +
      '.icu-corr-ol{margin:0;padding-left:20px}.icu-corr-ol li{font:700 14px/1.5 var(--font);color:var(--ink)}.icu-corr-conf{font:700 11px var(--font);color:var(--muted)}' +
      '.icu-corr-chips{display:flex;flex-wrap:wrap;gap:6px}.icu-corr-chip{font:600 12px var(--font);background:var(--panel2);border:1px solid var(--border);color:var(--ink);border-radius:999px;padding:4px 10px}.icu-corr-chip.ok{border-color:color-mix(in srgb,var(--ok) 40%,var(--border));color:var(--ok)}.icu-corr-chip.muted{color:var(--muted)}' +
      '.icu-corr-deep{margin-top:10px;border-top:1px solid var(--border);padding-top:10px}' +
      // Guided working-diagnosis cards (smd_icu_dxflow)
      '.icu-dx-card{border:1px solid var(--border);border-radius:12px;background:var(--panel2);padding:11px 13px;margin:8px 0}' +
      '.icu-dx-h{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;background:none;border:none;padding:0;cursor:pointer;color:inherit}.icu-dx-nm{font:800 14.5px var(--font);color:var(--ink);flex:1;min-width:0}' +
      '.icu-dx-chev{flex:0 0 auto;color:var(--muted);font-size:13px}.icu-clamp1{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}.icu-dx-sup{font:600 11px var(--font);color:var(--muted);margin-top:2px}' +
      '.icu-dx-lvl{flex:0 0 auto;font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.03em;border-radius:999px;padding:3px 9px;background:var(--panel);color:var(--muted);border:1px solid var(--border)}' +
      '.icu-dx-lvl.strong{background:var(--ok-soft);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 35%,var(--border))}.icu-dx-lvl.moderate{background:var(--primary-soft);color:var(--primary)}.icu-dx-lvl.possible{background:var(--panel);color:var(--muted)}' +
      '.icu-dx-red{font:800 10.5px var(--font);color:var(--danger);background:var(--danger-soft);border-radius:6px;padding:2px 6px;margin-left:6px}' +
      '.icu-dx-rsn{font:600 12.5px/1.5 var(--font);color:var(--muted);margin:5px 0 2px}.icu-dx-why{margin:6px 0 2px}' +
      '.icu-dx-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}.icu-dx-acts .icu-btn{width:auto;flex:1 1 auto;min-width:44%}' +
      '.icu-deep-list{margin:10px 0 14px;display:flex;flex-direction:column;gap:5px}' +
      '.icu-deep-chk{font:600 13px var(--font);padding:2px 0}.icu-deep-chk.on{color:var(--ink)}.icu-deep-chk.off{color:var(--muted)}' +
      // First-use guided-diagnosis tour (coach-mark above the bottom nav; safe-area aware)
      '.icu-tour{position:fixed;left:0;right:0;bottom:calc(92px + env(safe-area-inset-bottom));z-index:10050;display:none;justify-content:center;padding:0 14px;pointer-events:none}.icu-tour.on{display:flex}' +
      '.icu-tour-card{pointer-events:auto;width:min(440px,100%);background:var(--panel);border:1.5px solid var(--primary);border-radius:16px;box-shadow:0 16px 44px rgba(0,0,0,.4);padding:14px 16px}' +
      '.icu-tour-step{font:800 10.5px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--primary)}' +
      '.icu-tour-t{font:800 16px var(--font);color:var(--ink);margin:3px 0 5px}.icu-tour-x{font:600 13.5px/1.5 var(--font);color:var(--muted)}' +
      '.icu-tour-chk{display:flex;align-items:center;gap:8px;font:600 13px var(--font);color:var(--ink);margin-top:10px}.icu-tour-chk input{width:18px;height:18px}' +
      '.icu-tour-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;margin-top:12px}.icu-tour-btns .icu-btn{width:auto;flex:1 1 auto;min-width:0;padding:9px 14px;margin-top:0}' +
      '.icu-tour-hl{outline:3px solid var(--primary);outline-offset:3px;border-radius:12px;transition:outline-color .2s}' +
      '@media (prefers-reduced-motion: reduce){.icu-tour-hl{transition:none}.icu-tip-pop{transition:none}.icu-tour-card{transition:none}}' +
      '.icu-corr-note{font:600 12.5px/1.5 var(--font);color:var(--ink);background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 11px;margin:6px 0}.icu-corr-note .icu-ico{width:14px;height:14px;vertical-align:-2px;color:var(--primary)}.icu-corr-partial{color:var(--muted);font-weight:600}' +
      // External evidence (Phase 4)
      '.icu-ev-hubs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.icu-ev-hub{font:700 12px var(--font);text-decoration:none;background:var(--panel2);border:1px solid var(--border);color:var(--primary);border-radius:999px;padding:5px 11px}' +
      '.icu-ev-cite{display:block;text-decoration:none;background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:9px 11px;margin:6px 0}.icu-ev-cite .t{font:700 13.5px/1.4 var(--font);color:var(--ink)}.icu-ev-cite .m{font:600 11.5px var(--font);color:var(--muted);margin-top:3px}' +
      // Structured finding picker (autocomplete). Lives inside .icu-sheet (a bottom sheet that
      // overlays the whole dashboard) so results never overlap the bottom nav / camera FAB / MaiK sheet;
      // safe-area-inset is already handled by .icu-sheet padding.
      '#icuFindQ:focus{outline:none;border-color:var(--primary)}' +
      '.icu-find-res{margin-top:10px;max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '.icu-find-cath{font:800 11px var(--font);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:12px 0 5px}.icu-find-cath:first-child{margin-top:2px}' +
      '.icu-find-cnt{display:inline-block;background:var(--primary-soft);color:var(--primary);font:700 11px var(--font);padding:1px 8px;border-radius:999px;margin-left:5px;vertical-align:1px}' +
      '.icu-find-list{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;background:var(--panel2);overflow:hidden}' +
      '.icu-find-hit{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--border);padding:12px 13px;min-height:48px;cursor:pointer;color:var(--ink)}.icu-find-hit:last-child{border-bottom:none}.icu-find-hit:active{background:var(--primary-soft)}' +
      '.icu-fp{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--primary-soft);color:var(--primary);font:800 15px var(--font);flex:0 0 auto}' +
      '.icu-fl{flex:1;min-width:0}.icu-find-hit .nm{display:block;font:700 14.5px var(--font);color:var(--ink)}.icu-find-hit .mt{display:block;font:600 11px var(--font);color:var(--muted);margin-top:1px}' +
      '.icu-find-more{display:block;width:100%;border:none;background:none;font:700 12px var(--font);color:var(--primary);text-align:center;padding:9px 0;cursor:pointer}' +
      '.icu-find-empty{font:600 12.5px var(--font);color:var(--muted);padding:6px 0}' +
      '.icu-find-chips{display:flex;flex-wrap:wrap;gap:7px;margin:6px 0 4px}' +
      '.icu-find-chip{display:inline-flex;align-items:center;gap:2px;font:700 13px var(--font);background:var(--primary-soft);color:var(--primary);border:1px solid color-mix(in srgb,var(--primary) 30%,var(--border));border-radius:999px;padding:6px 6px 6px 12px}' +
      '.icu-find-chip.neg{background:var(--danger-soft);color:var(--danger);border-color:color-mix(in srgb,var(--danger) 30%,var(--border))}' +
      '.icu-find-chip.poss{background:var(--warn-soft);color:var(--warn);border-color:color-mix(in srgb,var(--warn) 30%,var(--border))}' +
      '.icu-find-chip.note{background:var(--panel2);color:var(--muted);border-color:var(--border)}' +
      '.icu-find-chip .fc-mod,.icu-find-chip .fc-x{border:none;background:none;cursor:pointer;color:inherit;font:800 15px var(--font);line-height:1;padding:2px 6px;border-radius:50%;opacity:.75}.icu-find-chip .fc-mod:active,.icu-find-chip .fc-x:active{opacity:1;background:color-mix(in srgb,currentColor 15%,transparent)}' +
      // ===== ICU v2 (smd_icu_v2) — all selectors scoped under #icuRoot.icu-v2. Additive only. =====
      // On the v2 patient screen the top tabs replace the old bottom bar + the old thin banner.
      '#icuRoot.icu-v2 .icu-ws-bar{display:none}' +
      '#icuRoot.icu-v2 .icu-banner{display:none}' +
      // top tabs (solid segmented control)
      '#icuRoot.icu-v2 .icu-v2-tabwrap{flex:0 0 auto;background:var(--panel);border-bottom:1px solid var(--border);padding:10px 12px}' +
      '#icuRoot.icu-v2 .icu-v2-tabs{display:flex;gap:3px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:4px}' +
      '#icuRoot.icu-v2 .icu-v2-tab{flex:1 1 0;min-width:0;min-height:44px;display:flex;align-items:center;justify-content:center;white-space:nowrap;border:none;background:none;color:var(--muted);border-radius:9px;font:700 12px var(--font);padding:9px 2px;cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-tab.on{background:var(--primary);color:#fff;box-shadow:0 1px 3px rgba(15,118,110,.35)}' +
      // patient banner (acuity-coloured, white text)
      '#icuRoot.icu-v2 .icu-v2-banner{flex:0 0 auto;color:#fff;padding:calc(10px + env(safe-area-inset-top)) 14px 12px;background:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-banner.crit,#icuRoot.icu-v2 .icu-v2-banner.critical{background:var(--danger)}' +
      '#icuRoot.icu-v2 .icu-v2-banner.review{background:var(--warn)}#icuRoot.icu-v2 .icu-v2-banner.stable{background:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-banner-top{display:flex;align-items:center;gap:8px}' +
      '#icuRoot.icu-v2 .icu-v2-back,#icuRoot.icu-v2 .icu-v2-handover{flex:0 0 auto;width:44px;height:44px;border-radius:12px;border:none;background:rgba(255,255,255,.18);color:#fff;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-handover .icu-ico{width:19px;height:19px}' +
      '#icuRoot.icu-v2 .icu-v2-banner-id{flex:1;min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-banner-nm{font:800 17px var(--font);display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '#icuRoot.icu-v2 .icu-v2-banner-pill{font:700 10px var(--font);background:rgba(255,255,255,.22);border-radius:999px;padding:3px 9px;white-space:nowrap}' +
      '#icuRoot.icu-v2 .icu-v2-banner-meta{font:500 12px var(--font);color:rgba(255,255,255,.85);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#icuRoot.icu-v2 .icu-v2-banner-vitals{display:flex;gap:7px;margin-top:11px}' +
      '#icuRoot.icu-v2 .icu-v2-mv{flex:1;background:rgba(255,255,255,.14);border-radius:10px;padding:6px 4px;text-align:center;min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-mv-k{font:600 9px var(--font);color:rgba(255,255,255,.8);letter-spacing:.03em}' +
      '#icuRoot.icu-v2 .icu-v2-mv-v{font:700 15px var(--mono);margin-top:1px;color:#fff}' +
      // presence + sync
      '#icuRoot.icu-v2 .icu-v2-presence{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:8px 15px;background:var(--panel);border-bottom:1px solid var(--border)}' +
      '#icuRoot.icu-v2 .icu-v2-viewer{width:24px;height:24px;flex:0 0 auto;border-radius:50%;background:var(--primary);color:#fff;font:700 9px var(--font);display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-presence-tx{font:500 11.5px var(--font);color:var(--muted);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#icuRoot.icu-v2 .icu-v2-synced{display:flex;align-items:center;gap:5px;font:600 11px var(--font);color:var(--ok);flex:0 0 auto}' +
      '#icuRoot.icu-v2 .icu-v2-dot{width:7px;height:7px;border-radius:50%;background:var(--ok)}' +
      // restyle the existing sub-nav into a wrapping row of pills (no hidden scroll)
      '#icuRoot.icu-v2 .icu-subnav{flex-wrap:wrap;overflow:visible;gap:6px;margin:0 0 12px;padding-bottom:0}' +
      '#icuRoot.icu-v2 .icu-seg{flex:0 0 auto;min-height:40px;border-radius:999px;padding:7px 13px;border:1px solid var(--border);background:var(--panel);color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-seg.on{background:var(--primary);border-color:var(--primary);color:#fff}' +
      // board / screen scroll (board bar overlays it, so pad the bottom)
      '#icuRoot.icu-v2 .icu-v2-scroll{padding:0 0 calc(84px + env(safe-area-inset-bottom))}' +
      // unit header
      '#icuRoot.icu-v2 .icu-v2-uhead{background:linear-gradient(160deg,var(--primary2),var(--primary));color:#fff;padding:calc(12px + env(safe-area-inset-top)) 16px 18px}' +
      '#icuRoot.icu-v2 .icu-v2-uhead-top{display:flex;align-items:center;gap:10px}' +
      '#icuRoot.icu-v2 .icu-v2-ubtn{position:relative;flex:0 0 auto;width:44px;height:44px;border-radius:12px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-ubtn .icu-ico{width:20px;height:20px}' +
      '#icuRoot.icu-v2 .icu-v2-ubadge{position:absolute;top:5px;right:6px;min-width:16px;height:16px;padding:0 3px;background:var(--danger);border:2px solid var(--primary);border-radius:50%;font:700 9px var(--font);display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-utitle{flex:1;min-width:0;font:700 17px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-usub{font:500 12px var(--font);color:rgba(255,255,255,.82);margin-top:1px}' +
      '#icuRoot.icu-v2 .icu-v2-strip{display:flex;gap:8px;margin-top:16px}' +
      '#icuRoot.icu-v2 .icu-v2-scount{flex:1;border:none;border-radius:14px;padding:9px 6px;cursor:pointer;text-align:center;background:rgba(255,255,255,.16);min-height:44px}' +
      '#icuRoot.icu-v2 .icu-v2-scount b{display:block;font:700 22px var(--mono);color:#fff}#icuRoot.icu-v2 .icu-v2-scount span{display:block;font:700 10px var(--font);letter-spacing:.03em;margin-top:1px;color:#fff}' +
      '#icuRoot.icu-v2 .icu-v2-scount.total{border:1px solid rgba(255,255,255,.2)}' +
      '#icuRoot.icu-v2 .icu-v2-scount.crit{background:var(--danger-soft)}#icuRoot.icu-v2 .icu-v2-scount.crit b,#icuRoot.icu-v2 .icu-v2-scount.crit span{color:var(--danger)}' +
      '#icuRoot.icu-v2 .icu-v2-scount.review{background:var(--warn-soft)}#icuRoot.icu-v2 .icu-v2-scount.review b,#icuRoot.icu-v2 .icu-v2-scount.review span{color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-scount.stable{background:var(--ok-soft)}#icuRoot.icu-v2 .icu-v2-scount.stable b,#icuRoot.icu-v2 .icu-v2-scount.stable span{color:var(--ok)}' +
      '#icuRoot.icu-v2 .icu-v2-scount.on{outline:2px solid #fff;outline-offset:1px}' +
      // board body
      '#icuRoot.icu-v2 .icu-v2-board{padding:16px}' +
      '#icuRoot.icu-v2 .icu-v2-sec-lbl{font:700 11px var(--font);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 2px 8px}' +
      '#icuRoot.icu-v2 .icu-v2-attn{display:flex;gap:10px;overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px 4px;padding:0 16px 4px;scrollbar-width:none}#icuRoot.icu-v2 .icu-v2-attn::-webkit-scrollbar{display:none}' +
      '#icuRoot.icu-v2 .icu-v2-attn-card{flex:0 0 auto;width:212px;text-align:left;background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--muted);border-radius:14px;padding:11px 13px;cursor:pointer;box-shadow:var(--sh)}' +
      '#icuRoot.icu-v2 .icu-v2-attn-card.critical{border-left-color:var(--danger)}#icuRoot.icu-v2 .icu-v2-attn-card.review{border-left-color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-attn-kind{font:700 11px var(--font);letter-spacing:.02em;color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-v2-attn-card.critical .icu-v2-attn-kind{color:var(--danger)}#icuRoot.icu-v2 .icu-v2-attn-card.review .icu-v2-attn-kind{color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-attn-name{font:700 14px var(--font);color:var(--ink);margin-top:6px}' +
      '#icuRoot.icu-v2 .icu-v2-attn-detail{font:500 12px var(--font);color:var(--muted);margin-top:3px;line-height:1.4}' +
      '#icuRoot.icu-v2 .icu-v2-filters{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 12px}' +
      '#icuRoot.icu-v2 .icu-v2-fchip{border:1px solid var(--border);background:var(--panel);color:var(--muted);border-radius:999px;font:700 12.5px var(--font);padding:8px 14px;min-height:40px;cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-fchip.on{background:var(--primary);border-color:var(--primary);color:#fff}' +
      // patient card
      '#icuRoot.icu-v2 .icu-v2-card{display:block;width:100%;text-align:left;background:var(--panel);border:1px solid var(--border);border-left:5px solid var(--primary);border-radius:16px;padding:0;cursor:pointer;overflow:hidden;box-shadow:var(--sh);margin-bottom:10px}' +
      '#icuRoot.icu-v2 .icu-v2-card.critical{border-left-color:var(--danger)}#icuRoot.icu-v2 .icu-v2-card.review{border-left-color:var(--warn)}#icuRoot.icu-v2 .icu-v2-card.stable{border-left-color:var(--ok)}' +
      '#icuRoot.icu-v2 .icu-v2-card-body{padding:13px 15px 11px}' +
      '#icuRoot.icu-v2 .icu-v2-card-top{display:flex;align-items:center;gap:10px}' +
      '#icuRoot.icu-v2 .icu-v2-bed{width:44px;height:44px;flex:0 0 auto;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--primary-soft)}' +
      '#icuRoot.icu-v2 .icu-v2-bed b{font:700 15px var(--mono);line-height:1;color:var(--primary)}#icuRoot.icu-v2 .icu-v2-bed span{font:700 7.5px var(--font);letter-spacing:.05em;color:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-bed.critical{background:var(--danger-soft)}#icuRoot.icu-v2 .icu-v2-bed.critical b,#icuRoot.icu-v2 .icu-v2-bed.critical span{color:var(--danger)}' +
      '#icuRoot.icu-v2 .icu-v2-bed.review{background:var(--warn-soft)}#icuRoot.icu-v2 .icu-v2-bed.review b,#icuRoot.icu-v2 .icu-v2-bed.review span{color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-bed.stable{background:var(--ok-soft)}#icuRoot.icu-v2 .icu-v2-bed.stable b,#icuRoot.icu-v2 .icu-v2-bed.stable span{color:var(--ok)}' +
      '#icuRoot.icu-v2 .icu-v2-card-id{flex:1;min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-card-name{font:700 16px var(--font);color:var(--ink);display:flex;align-items:center;gap:7px;flex-wrap:wrap}' +
      '#icuRoot.icu-v2 .icu-v2-card-demo{font:600 12px var(--font);color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-v2-card-dx{font:600 13px var(--font);color:var(--ink);opacity:.78;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#icuRoot.icu-v2 .icu-v2-pill{flex:0 0 auto;font:700 10px var(--font);border-radius:999px;padding:4px 9px;letter-spacing:.02em}' +
      '#icuRoot.icu-v2 .icu-v2-pill.critical{color:var(--danger);background:var(--danger-soft)}#icuRoot.icu-v2 .icu-v2-pill.review{color:var(--warn);background:var(--warn-soft)}#icuRoot.icu-v2 .icu-v2-pill.stable{color:var(--ok);background:var(--ok-soft)}' +
      '#icuRoot.icu-v2 .icu-v2-vstrip{display:flex;gap:16px;margin-top:11px;padding-top:10px;border-top:1px solid var(--border)}' +
      '#icuRoot.icu-v2 .icu-v2-vc{min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-vk{font:600 9px var(--font);color:var(--muted);letter-spacing:.04em;text-transform:uppercase}' +
      '#icuRoot.icu-v2 .icu-v2-vv{font:700 14px var(--mono);color:var(--ink);margin-top:1px}' +
      '#icuRoot.icu-v2 .icu-v2-vc.crit .icu-v2-vv{color:var(--danger)}#icuRoot.icu-v2 .icu-v2-vc.warn .icu-v2-vv{color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-card-foot{background:var(--panel2);padding:8px 15px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border)}' +
      '#icuRoot.icu-v2 .icu-v2-foot-av{width:22px;height:22px;flex:0 0 auto;border-radius:50%;background:var(--primary);color:#fff;font:700 9px var(--font);display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-foot-txt{font:700 12px var(--font);color:var(--ink)}' +
      '#icuRoot.icu-v2 .icu-v2-foot-ago{font:600 11px var(--font);color:var(--muted);margin-left:auto}' +
      '#icuRoot.icu-v2 .icu-v2-foot-tasks{display:inline-flex;align-items:center;gap:3px;font:700 11px var(--font);color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,transparent);padding:2px 8px;border-radius:999px}' +
      '#icuRoot.icu-v2 .icu-v2-foot-tasks svg{width:13px;height:13px}' +
      '#icuRoot.icu-v2 .icu-v2-foot-count{text-align:center;font:600 12px var(--font);color:var(--muted);padding:6px 0 2px}' +
      // empty states
      '#icuRoot.icu-v2 .icu-v2-empty{text-align:center;padding:40px 20px}' +
      '#icuRoot.icu-v2 .icu-v2-empty-ic .icu-ico{width:48px;height:48px;color:var(--primary);opacity:.9;stroke-width:1.4}' +
      '#icuRoot.icu-v2 .icu-v2-empty-t{font:800 18px var(--font);color:var(--ink);margin:12px 0 6px}' +
      '#icuRoot.icu-v2 .icu-v2-empty-p{font:500 13px var(--font);color:var(--muted);line-height:1.6;max-width:320px;margin:0 auto 4px}' +
      '#icuRoot.icu-v2 .icu-v2-empty-cta{width:auto!important;display:inline-block;margin-top:14px;padding:13px 24px}' +
      '#icuRoot.icu-v2 .icu-v2-empty2{font:600 13px var(--font);color:var(--muted);text-align:center;padding:24px 0}' +
      // screen header (alerts / team)
      '#icuRoot.icu-v2 .icu-v2-shead{background:var(--primary);color:#fff;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;display:flex;align-items:center;gap:10px}' +
      '#icuRoot.icu-v2 .icu-v2-sback{flex:0 0 auto;width:44px;height:44px;border-radius:11px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:18px;cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-shead-h{font:700 16px var(--font)}#icuRoot.icu-v2 .icu-v2-shead-s{font:500 12px var(--font);color:rgba(255,255,255,.82)}' +
      '#icuRoot.icu-v2 .icu-v2-slist,#icuRoot.icu-v2 .icu-v2-tlist{padding:14px 16px;display:flex;flex-direction:column;gap:9px}' +
      '#icuRoot.icu-v2 .icu-v2-note{font:600 12.5px var(--font);color:var(--ink);background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;line-height:1.55;margin:8px 0}#icuRoot.icu-v2 .icu-v2-note .icu-ico{width:14px;height:14px;vertical-align:-2px;color:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-note-x{flex:0 0 auto;background:none;border:none;color:inherit;font:700 13px var(--font);cursor:pointer;padding:0 2px;line-height:1;opacity:.7}#icuRoot.icu-v2 .icu-v2-note-x:hover{opacity:1}' +
      '#icuRoot.icu-v2 .icu-v2-alert-row{display:flex;gap:12px;align-items:flex-start;text-align:left;background:var(--panel);border:1px solid var(--border);border-left-width:4px;border-radius:14px;padding:13px 14px;cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-alert-row.critical{border-left-color:var(--danger)}#icuRoot.icu-v2 .icu-v2-alert-row.review{border-left-color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-alert-ic{flex:0 0 auto;width:38px;height:38px;border-radius:11px;background:var(--panel2);display:flex;align-items:center;justify-content:center}#icuRoot.icu-v2 .icu-v2-alert-ic .icu-ico{width:18px;height:18px}' +
      '#icuRoot.icu-v2 .icu-v2-alert-tx{flex:1;min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-alert-h{display:block;font:700 13.5px var(--font);color:var(--ink)}' +
      '#icuRoot.icu-v2 .icu-v2-alert-b{display:block;font:500 12.5px var(--font);color:var(--muted);margin-top:3px;line-height:1.45}' +
      '#icuRoot.icu-v2 .icu-v2-urg{font:700 9px var(--font);color:var(--danger);background:var(--danger-soft);border-radius:999px;padding:2px 7px;margin-left:6px;vertical-align:1px}' +
      '#icuRoot.icu-v2 .icu-v2-member{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:12px 14px}' +
      '#icuRoot.icu-v2 .icu-v2-member-av{width:40px;height:40px;flex:0 0 auto;border-radius:50%;background:var(--primary);color:#fff;font:700 13px var(--font);display:flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-member-id{flex:1;min-width:0}#icuRoot.icu-v2 .icu-v2-member-nm{display:block;font:700 14.5px var(--font);color:var(--ink)}#icuRoot.icu-v2 .icu-v2-member-role{display:block;font:600 12px var(--font);color:var(--muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#icuRoot.icu-v2 .icu-v2-member-state{flex:0 0 auto;font:600 11px var(--font);color:var(--ok);background:var(--ok-soft);border-radius:999px;padding:4px 10px}' +
      // Phase 5 — team screen: Doctor ID card, online dot, per-member remove, admin actions, role segments
      '#icuRoot.icu-v2 .icu-v2-idcard{display:flex;align-items:center;gap:12px;background:var(--primary-soft);border:1px solid var(--primary);border-radius:14px;padding:12px 14px}' +
      '#icuRoot.icu-v2 .icu-v2-idcard-l{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}' +
      '#icuRoot.icu-v2 .icu-v2-idcard-lbl{font:600 11px var(--font);color:var(--muted);text-transform:uppercase;letter-spacing:.04em}' +
      '#icuRoot.icu-v2 .icu-v2-idcard-code{font:800 20px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--primary);letter-spacing:.06em}' +
      '#icuRoot.icu-v2 .icu-v2-idcopy{flex:0 0 auto;min-height:44px;padding:0 14px;border:1px solid var(--primary);background:var(--panel);color:var(--primary);border-radius:11px;font:700 13px var(--font);cursor:pointer;display:inline-flex;align-items:center;gap:6px}#icuRoot.icu-v2 .icu-v2-idcopy .icu-ico{width:15px;height:15px}' +
      '#icuRoot.icu-v2 .icu-v2-member-av.on{box-shadow:0 0 0 2px var(--panel),0 0 0 4px var(--ok)}' +
      '#icuRoot.icu-v2 .icu-v2-memrm{flex:0 0 auto;min-height:36px;padding:0 12px;border:1px solid var(--border);background:var(--panel);color:var(--bad,#c0392b);border-radius:999px;font:700 12px var(--font);cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-teamacts{display:flex;flex-direction:column;gap:9px;margin-top:4px}' +
      '#icuRoot.icu-v2 .icu-v2-roleseg-row{display:flex;flex-wrap:wrap;gap:7px}' +
      '#icuRoot.icu-v2 .icu-v2-roleseg{min-height:40px;padding:0 13px;border:1px solid var(--border);background:var(--panel2);color:var(--ink);border-radius:999px;font:700 12.5px var(--font);cursor:pointer}' +
      '#icuRoot.icu-v2 .icu-v2-roleseg.on{background:var(--primary);border-color:var(--primary);color:#fff}' +
      '#icuRoot.icu-v2 .icu-v2-danger{color:var(--bad,#c0392b);border-color:var(--bad,#c0392b)}' +
      // bottom bar (board / alerts / team only)
      '#icuRoot.icu-v2 .icu-v2-bottombar{position:absolute;left:0;right:0;bottom:0;z-index:7;display:flex;background:var(--panel);border-top:1px solid var(--border);padding:8px 8px calc(8px + env(safe-area-inset-bottom))}' +
      '#icuRoot.icu-v2 .icu-v2-navbtn{flex:1;min-height:44px;background:none;border:none;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;color:var(--muted);font:600 10.5px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-navic{font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;height:22px}#icuRoot.icu-v2 .icu-v2-navbtn .icu-ico{width:22px;height:22px}' +
      '#icuRoot.icu-v2 .icu-v2-navbtn.on{color:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-admit{color:var(--primary)}#icuRoot.icu-v2 .icu-v2-admit-ic{width:30px;height:30px;border-radius:10px;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px}#icuRoot.icu-v2 .icu-v2-admit .icu-ico{width:18px;height:18px;color:#fff}' +
      // v2 FAB positions (no bottom bar on the patient screen)
      '#icuRoot.icu-v2 #icuSnap{bottom:calc(24px + env(safe-area-inset-bottom))}' +
      '#icuRoot.icu-v2 #icuWatch{bottom:calc(90px + env(safe-area-inset-bottom))}' +
      // ── group mode (smd_icu_groups, Phase 2) — additive, scoped under #icuRoot.icu-v2 ──
      // unit switcher (the header title becomes a tappable group picker)
      '#icuRoot.icu-v2 .icu-v2-gswitch{flex:1;min-width:0;border:none;background:none;color:inherit;text-align:left;cursor:pointer;padding:0;font:700 17px var(--font)}' +
      // member-avatar stack (→ Team sheet)
      '#icuRoot.icu-v2 .icu-v2-avatars{flex:0 0 auto;display:flex;align-items:center;border:none;background:none;cursor:pointer;padding:0}' +
      '#icuRoot.icu-v2 .icu-v2-av{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.22);color:#fff;font:700 10px var(--font);display:flex;align-items:center;justify-content:center;border:2px solid var(--primary);margin-left:-8px}' +
      '#icuRoot.icu-v2 .icu-v2-av.more{background:rgba(255,255,255,.16)}' +
      // live sync indicator (banner presence row) — Synced / Syncing / Offline
      '#icuRoot.icu-v2 .icu-v2-sync{display:flex;align-items:center;gap:5px;font:600 11px var(--font);color:var(--ok);flex:0 0 auto}' +
      '#icuRoot.icu-v2 .icu-v2-sync .icu-v2-dot{background:var(--ok)}' +
      '#icuRoot.icu-v2 .icu-v2-sync.syncing{color:var(--warn)}#icuRoot.icu-v2 .icu-v2-sync.syncing .icu-v2-dot{background:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-sync.offline{color:var(--warn)}#icuRoot.icu-v2 .icu-v2-sync.offline .icu-v2-dot{background:var(--warn)}' +
      // other viewers in the presence stack
      '#icuRoot.icu-v2 .icu-v2-viewer.alt{background:var(--warn);margin-left:-6px;border:2px solid var(--panel)}' +
      // "not reviewed" chip on a live card footer
      '#icuRoot.icu-v2 .icu-v2-unrev{font:700 9px var(--font);color:var(--warn);background:var(--warn-soft);border-radius:999px;padding:2px 6px;margin-right:5px}' +
      // shared instructions/timeline panel (Rounds tab)
      '#icuRoot.icu-v2 .icu-v2-collab{margin-bottom:6px}' +
      // ── Phase 3: round-note composer + timeline author avatar + smart-notification feed ──
      '#icuRoot.icu-v2 .icu-v2-addround{border:2px dashed var(--primary3);background:var(--panel2);color:var(--primary);box-shadow:none}' +
      '#icuRoot.icu-v2 .icu-v2-tlav{width:16px;height:16px;flex:0 0 auto;border-radius:50%;background:var(--primary);color:#fff;font:700 8px var(--font);display:inline-flex;align-items:center;justify-content:center}' +
      '#icuRoot.icu-v2 .icu-v2-rbody{flex:1;min-height:0;display:flex;flex-direction:column;gap:12px;padding:14px 16px;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '#icuRoot.icu-v2 .icu-v2-rscroll{padding:14px 16px;display:flex;flex-direction:column;gap:10px}' +
      /* suggestions box flexes to fill + scrolls internally; add-your-own + post stay pinned/visible */
      '#icuRoot.icu-v2 .icu-v2-sugbox{display:flex;flex-direction:column}' +
      '#icuRoot.icu-v2 .icu-v2-ownbox{flex:0 0 auto}' +
      '#icuRoot.icu-v2 .icu-v2-rpre{display:flex;flex-wrap:wrap;gap:9px;align-content:flex-start;padding:1px 1px 4px}' +
      '#icuRoot.icu-v2 .icu-v2-sugbox .icu-v2-rpre{margin:-2px -2px 0}' +
      '#icuRoot.icu-v2 .icu-v2-rchip{display:inline-flex;align-items:center;gap:8px;text-align:left;background:var(--panel2);border:2px solid var(--border);border-radius:13px;padding:10px 12px;cursor:pointer;color:var(--ink)}' +
      '#icuRoot.icu-v2 .icu-v2-rchip.on{border-color:var(--primary);background:var(--primary-soft)}' +
      '#icuRoot.icu-v2 .icu-v2-rbox{width:20px;height:20px;flex:0 0 auto;border-radius:6px;border:2px solid var(--border);background:var(--panel);color:transparent;display:flex;align-items:center;justify-content:center;font:800 12px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-rchip.on .icu-v2-rbox{background:var(--primary);border-color:var(--primary);color:#fff}' +
      '#icuRoot.icu-v2 .icu-v2-rtx{min-width:0;font:600 14px var(--font);color:var(--ink)}' +
      '#icuRoot.icu-v2 .icu-v2-rx{flex:0 0 auto;color:var(--muted);font:700 12px var(--font);margin-left:2px}' +
      /* priority picker (2x2) */
      '#icuRoot.icu-v2 .icu-v2-priopick{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
      '#icuRoot.icu-v2 .icu-v2-priochip{display:flex;flex-direction:column;align-items:flex-start;gap:3px;border:2px solid var(--border);background:var(--panel2);border-radius:12px;padding:9px 11px;cursor:pointer;color:var(--ink);text-align:left}' +
      '#icuRoot.icu-v2 .icu-v2-priochip.on{color:#fff}' +
      '#icuRoot.icu-v2 .icu-v2-prio-top{display:flex;align-items:center;gap:7px;font:700 13.5px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-priodot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}' +
      '#icuRoot.icu-v2 .icu-v2-priochip.on .icu-v2-priodot{background:#fff!important}' +
      '#icuRoot.icu-v2 .icu-v2-priosub{font:600 11px var(--font);color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-v2-priochip.on .icu-v2-priosub{color:rgba(255,255,255,.85)}' +
      /* "Instructed by" picker chips */
      '#icuRoot.icu-v2 .icu-v2-obpick{display:flex;flex-wrap:wrap;gap:8px}' +
      '#icuRoot.icu-v2 .icu-v2-obchip{display:inline-flex;align-items:center;gap:6px;border:2px solid var(--border);background:var(--panel2);border-radius:12px;padding:9px 12px;cursor:pointer;color:var(--ink);font:600 13px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-obchip.on{border-color:var(--primary);background:var(--primary-soft);color:var(--primary)}' +
      '#icuRoot.icu-v2 .icu-v2-obchip .icu-ico{width:15px;height:15px}' +
      '#icuRoot.icu-v2 .icu-v2-obrole{font:600 11px var(--font);color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-v2-tlfull{max-height:60vh;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
      '#icuRoot.icu-v2 .icu-v2-obchip.on .icu-v2-obrole{color:var(--primary);opacity:.8}' +
      /* task priority badge + overdue chip in the Instructions panel */
      '#icuRoot.icu-v2 .icu-v2-prio{display:inline-block;font:700 10px var(--font);color:#fff;border-radius:999px;padding:3px 9px;letter-spacing:.03em;vertical-align:middle}' +
      '#icuRoot.icu-v2 .icu-v2-due{font:600 11.5px/1.5 var(--font);color:var(--muted)}' +
      '#icuRoot.icu-v2 .icu-v2-due.over{color:var(--danger)}' +
      '#icuRoot.icu-v2 .icu-v2-taskexpl{font:600 11.5px/1.5 var(--font);color:var(--ink);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-top:6px}' +
      // Rounds/notifications breathing room (2026-07): a calm eyebrow -> title -> list rhythm. Scoped
      // to .icu-v2-collab so the app-wide .icu-sec-lbl/.icu-card/.icu-row base rules are untouched.
      '#icuRoot.icu-v2 .icu-v2-collab .icu-sec-lbl{margin:16px 2px 10px}' +
      '#icuRoot.icu-v2 .icu-v2-collab .icu-card{padding:16px 16px 4px}' +
      '#icuRoot.icu-v2 .icu-v2-collab .icu-card h3{font-size:15px;margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '#icuRoot.icu-v2 .icu-v2-collab .icu-card h3 .icu-phase{margin-left:0}' +
      '#icuRoot.icu-v2 .icu-v2-collab .icu-row{padding:13px 0;gap:12px;align-items:flex-start;font-size:14px;line-height:1.45}' +
      '#icuRoot.icu-v2 .icu-v2-addround{margin:2px 0 16px;padding:13px}' +
      '#icuRoot.icu-v2 .icu-v2-rcustom{display:flex;gap:8px;align-items:center}' +
      '#icuRoot.icu-v2 .icu-v2-rcustom input{flex:1;min-width:0;border:1px solid var(--border);border-radius:10px;padding:11px 12px;font:600 14px var(--font);color:var(--ink);background:var(--panel2)}' +
      '#icuRoot.icu-v2 .icu-v2-rcustom .icu-btn{width:auto;flex:0 0 auto;margin-top:0;padding:0 16px;min-height:44px}' +
      '#icuRoot.icu-v2 .icu-v2-rpost{flex:0 0 auto;background:var(--panel);border-top:1px solid var(--border);padding:12px 16px calc(16px + env(safe-area-inset-bottom))}' +
      '#icuRoot.icu-v2 .icu-v2-rpost .icu-btn{margin-top:0}#icuRoot.icu-v2 .icu-v2-rpost .icu-btn[disabled]{opacity:.5;cursor:default;filter:none}' +
      '#icuRoot.icu-v2 .icu-v2-alert-ic{font-size:18px}' +
      '#icuRoot.icu-v2 .icu-v2-alert-ago{display:block;font:600 11px var(--font);color:var(--muted);margin-top:5px}' +
      '#icuRoot.icu-v2 .icu-v2-alert-row.fresh{background:var(--primary-soft)}' +
      // ═══ Phase 4 (polish): empty/loading/error/offline states + a11y — additive, v2-scoped ═══
      // Calm loading: skeleton shimmer cards + a centered spinner. Reuses tokens (--panel2/--border/--primary).
      '#icuRoot.icu-v2 .icu-v2-skel{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:13px 15px;margin-bottom:10px}' +
      '#icuRoot.icu-v2 .icu-v2-skel-top{display:flex;align-items:center;gap:10px}' +
      '#icuRoot.icu-v2 .icu-v2-shim{background-color:var(--panel2);background-image:linear-gradient(90deg,transparent 0,var(--border) 40%,var(--border) 60%,transparent 100%);background-size:220% 100%;background-repeat:no-repeat;animation:icuv2shim 1.3s ease-in-out infinite;border-radius:7px}' +
      '@keyframes icuv2shim{0%{background-position:180% 0}100%{background-position:-80% 0}}' +
      '#icuRoot.icu-v2 .icu-v2-skel-bed{width:44px;height:44px;border-radius:12px;flex:0 0 auto}' +
      '#icuRoot.icu-v2 .icu-v2-skel-id{flex:1;min-width:0}' +
      '#icuRoot.icu-v2 .icu-v2-skel-l{height:13px;margin-bottom:7px}' +
      '#icuRoot.icu-v2 .icu-v2-skel-strip{height:30px;margin-top:12px;border-radius:10px}' +
      '#icuRoot.icu-v2 .icu-v2-loading{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:13px;padding:44px 20px;color:var(--muted);font:600 13px var(--font);text-align:center}' +
      '#icuRoot.icu-v2 .icu-v2-spin{width:30px;height:30px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:icuspin .9s linear infinite}' +
      // Offline: unobtrusive amber full-width strip (reuses --warn/--warn-soft, AA-verified).
      '#icuRoot.icu-v2 .icu-v2-offline{display:flex;align-items:center;gap:8px;background:var(--warn-soft);color:var(--warn);border-bottom:1px solid var(--warn);padding:9px 15px;font:600 12px var(--font)}' +
      '#icuRoot.icu-v2 .icu-v2-offline .icu-ico{width:15px;height:15px;flex:0 0 auto}' +
      // Error: a clear non-technical card with a Retry (re-subscribes) — never a raw error / blank board.
      '#icuRoot.icu-v2 .icu-v2-errcard{text-align:center;padding:32px 20px;background:var(--panel);border:1px solid var(--warn);border-radius:16px;margin-bottom:12px}' +
      '#icuRoot.icu-v2 .icu-v2-errcard .icu-v2-empty-ic .icu-ico{color:var(--warn)}' +
      '#icuRoot.icu-v2 .icu-v2-err-t{font:800 16px var(--font);color:var(--ink);margin:10px 0 6px}' +
      '#icuRoot.icu-v2 .icu-v2-err-p{font:500 13px/1.55 var(--font);color:var(--muted);max-width:320px;margin:0 auto 4px}' +
      // a11y: visible keyboard/switch focus ring (keeps -webkit-tap-highlight-color on touch untouched).
      '#icuRoot.icu-v2 button:focus-visible,#icuRoot.icu-v2 [data-icu-act]:focus-visible,#icuRoot.icu-v2 input:focus-visible,#icuRoot.icu-v2 select:focus-visible,#icuRoot.icu-v2 textarea:focus-visible{outline:2px solid var(--primary);outline-offset:2px}' +
      // white/high-contrast ring for controls that sit on the teal/acuity chrome (translucent-white buttons).
      '#icuRoot.icu-v2 .icu-v2-banner :focus-visible,#icuRoot.icu-v2 .icu-v2-ubtn:focus-visible,#icuRoot.icu-v2 .icu-v2-gswitch:focus-visible,#icuRoot.icu-v2 .icu-v2-avatars:focus-visible,#icuRoot.icu-v2 .icu-v2-scount.total:focus-visible,#icuRoot.icu-v2 .icu-v2-sback:focus-visible{outline-color:#fff}' +
      // ≥44px tap targets: bump the sub-44 controls (pills/chips stay ≥40 per the existing sub-nav rule).
      '#icuRoot.icu-v2 .icu-v2-avatars{min-height:44px}' +
      '#icuRoot.icu-v2 .icu-v2-gswitch{min-height:44px}' +
      '#icuRoot.icu-v2 .icu-v2-tasktog{min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}' +
      // Contrast (AA): in DARK theme the accent tokens are LIGHT, so white text on the vivid acuity
      // chrome fails (~1.7–2.8:1). Darken the chrome toward --bg via color-mix so white passes ≥4.6:1
      // (ratios documented in ICU_IMPLEMENTATION_RESULTS.md). Light theme already passes, untouched.
      'body.dark #icuRoot.icu-v2 .icu-v2-banner.crit,body.dark #icuRoot.icu-v2 .icu-v2-banner.critical{background:color-mix(in srgb,var(--danger) 55%,var(--bg))}' +
      'body.dark #icuRoot.icu-v2 .icu-v2-banner.review{background:color-mix(in srgb,var(--warn) 50%,var(--bg))}' +
      'body.dark #icuRoot.icu-v2 .icu-v2-banner.stable{background:color-mix(in srgb,var(--primary) 50%,var(--bg))}' +
      'body.dark #icuRoot.icu-v2 .icu-v2-uhead{background:linear-gradient(160deg,color-mix(in srgb,var(--primary2) 50%,var(--bg)),color-mix(in srgb,var(--primary) 50%,var(--bg)))}' +
      'body.dark #icuRoot.icu-v2 .icu-v2-shead{background:color-mix(in srgb,var(--primary) 50%,var(--bg))}' +
      // prefers-reduced-motion: silence v2 shimmer/spin/pulse + card transitions (scoped to v2 only).
      '@media (prefers-reduced-motion:reduce){#icuRoot.icu-v2 *,#icuRoot.icu-v2 *::before,#icuRoot.icu-v2 *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}' +
      // dark mode: v2 chrome inherits the token flip; only the badge cut-out border needs the darker teal
      'body.dark #icuRoot.icu-v2 .icu-v2-ubadge{border-color:var(--primary2)}' +
      'body.dark #icuRoot.icu-v2 .icu-v2-av{border-color:var(--primary2)}';
    var st = document.createElement("style"); st.id = "icu-css"; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ----------------------------------------------------------- components */
  function evidenceBadges(list) { return list && list.length ? '<div class="icu-ev">' + list.map(function (e) { return "<span>" + esc(e) + "</span>"; }).join("") + "</div>" : ""; }
  // Tile-sized sparkline (A6) from a [{ts,v}] series — no axes/labels; reuses vitalSeries/mapSeries/labSeries data.
  function miniSpark(series) {
    var pts = (series || []).filter(function (p) { return p && p.v != null && isFinite(p.v); }).sort(function (a, b) { return a.ts - b.ts; });
    if (pts.length < 2) return "";
    var W = 100, H = 22, pad = 2;
    var xs = pts.map(function (p) { return p.ts; }), ys = pts.map(function (p) { return p.v; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + (pad + (W - 2 * pad) * (p.ts - minX) / spanX).toFixed(1) + " " + (H - pad - (H - 2 * pad) * (p.v - minY) / spanY).toFixed(1); }).join(" ");
    return '<svg class="icu-spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }
  function vitalCard(label, value, unit, status, series) {
    // BUG #17: an empty tile means the value was NOT recorded — say so (visible dash is
    // muted + carries title/aria "not recorded") so "K⁺ —" is never mistaken for a real
    // measured value, and screen readers announce the full label + value or its absence.
    var empty = (value == null || value === "");
    var vv = empty
      ? '<span class="icu-vc-na" title="Not recorded" style="color:var(--muted)">—</span>'
      : (esc(value) + (unit ? '<span class="vu">' + esc(unit) + "</span>" : ""));
    var al = esc(label) + (empty ? ": not recorded" : ": " + esc(String(value)) + (unit ? " " + esc(unit) : ""));
    return '<div class="icu-vc ' + (status || "") + '" role="group" aria-label="' + al + '"><div class="vl">' + esc(label) + '</div><div class="vv">' + vv + "</div>" + (series ? miniSpark(series) : "") + "</div>";
  }
  function alertCard(a) { return '<div class="icu-alert ' + esc(a.severity) + '"><div><div class="at">' + esc(a.title) + '</div><div class="am">' + esc(a.msg) + '</div></div><div class="ax">' + esc(a.source || "") + "</div></div>"; }
  // BUG #7: group the alert list by TRUE source, in clinical priority order.
  function alertsGroupedHTML(alerts) {
    var by = {}; (alerts || []).forEach(function (a) { var s = a.source || "Other"; (by[s] = by[s] || []).push(a); });
    var order = (typeof ALERT_SOURCES !== "undefined" ? ALERT_SOURCES : []).concat(Object.keys(by).filter(function (s) { return (typeof ALERT_SOURCES === "undefined" || ALERT_SOURCES.indexOf(s) < 0); }));
    var seen = {};
    return order.filter(function (s) { return by[s] && !seen[s] && (seen[s] = 1); }).map(function (s) {
      return '<div class="icu-alert-grp">' + esc(s) + "</div>" + by[s].map(alertCard).join("");
    }).join("");
  }

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
    var pressors = (_raw.infusions || []).filter(function (i) { return isPressor(i.drug); });
    var cards = [
      vitalCard("Heart Rate", lv.hr, "bpm", vstat(lv.hr, 50, 110, 40, 140), vitalSeries("hr", _trendWin)),
      vitalCard("BP", (lv.sbp != null && lv.dbp != null) ? lv.sbp + "/" + lv.dbp : null, "", ""),
      vitalCard("MAP", mp, "mmHg", vstat(mp, 65, 110, 60, null), mapSeries(_trendWin)),
      vitalCard("SpO₂", lv.spo2, "%", vstat(lv.spo2, 92, null, 88, null), vitalSeries("spo2", _trendWin)),
      vitalCard("Resp Rate", lv.rr, "/min", vstat(lv.rr, 8, 24, null, 30), vitalSeries("rr", _trendWin)),
      vitalCard("Temp", lv.temp, "°C", vstat(lv.temp, 36, 38, 35, 39), vitalSeries("temp", _trendWin)),
      vitalCard("Urine", lv.uop, "mL/h", "", vitalSeries("uop", _trendWin)),
      vitalCard("Lactate", lv.lactate, "mmol/L", vstat(lv.lactate, null, 2, null, 4), vitalSeries("lactate", _trendWin)),
      vitalCard("Pressors", pressors.length ? pressors.map(function (p) { return p.drug; }).join(", ") : "None", "", pressors.length ? "warn" : "ok"),
      vitalCard("Infusions", (_raw.infusions || []).length || "0", "", ""),
      vitalCard("Net Fluid", f.net24h, "mL", ""),
      vitalCard("K⁺", L.k, "mEq/L", vstat(L.k, 3.5, 5.0, K_CRIT_LO, K_CRIT_HI), labSeries("k", _trendWin))   // BUG #5: shared crit constant with the alert engine
    ];
    return '<div class="icu-sec-lbl">' + ico("pulse", "❤️") + ' Live Patient Status</div><div class="icu-vitals">' + cards.join("") + "</div>";
  }

  /* --------------------------------------------------------- AI import panel */
  function renderAIImport() {
    var cards = [
      { d: "labs", ic: "🧪", svg: "flask", t: "Laboratory report", s: "CBC · LFT · RFT · Electrolytes" },
      { d: "abg", ic: "🩸", svg: "abg", t: "ABG report", s: "pH · PaCO₂ · PaO₂ · HCO₃" },
      { d: "ventilator", ic: "🫁", svg: "lungs", t: "Ventilator screen", s: "Mode · FiO₂ · PEEP · TV · Plateau" },
      { d: "monitor", ic: "❤️", svg: "pulse", t: "Monitor / vitals", s: "HR · BP · SpO₂ · Temp" }
    ];
    return '<div class="icu-sec-lbl">' + ico("refresh", "🔄") + ' Bring in patient data <span style="font-weight:600;text-transform:none;letter-spacing:0">· auto-fills fields you confirm</span></div>' +
      '<div class="icu-src-btns">' +
        '<button class="icu-srcbtn ward" data-icu-act="wardfetch"><span class="i">' + ico("hospital", "🏥") + '</span><span class="l">Fetch from Ward Sync</span><span class="d">Pick patient → CBC · electrolytes · RFT · LFT</span></button>' +
        // AI Vision (Camera / Upload) is on-device-first (native ML Kit OCR) — native only.
        (window.SMD_IS_NATIVE
          ? '<button class="icu-srcbtn" data-icu-act="impmethod:camera"><span class="i">' + ico("camera", "📷") + '</span><span class="l">Camera</span><span class="d">Snap any report/screen — labs, ABG, vitals &amp; vent read together</span></button>' +
            '<button class="icu-srcbtn" data-icu-act="impmethod:file"><span class="i">' + ico("upload", "📄") + '</span><span class="l">Upload PDF / image</span><span class="d">Every page read — e.g. electrolytes p1 + ABG p2</span></button>'
          : '') +
      '</div>' +
      '<div class="icu-ai-grid">' + cards.map(function (c) {
        return '<button class="icu-ai" data-icu-act="edit:' + (c.d === "abg" ? "abg" : c.d) + '"><div class="ic">' + ico(c.svg, c.ic) + '</div><div class="t">' + c.t + '</div><div class="s">' + c.s + '</div>' +
          '<span class="man">' + ico("edit", "✎") + ' Enter manually</span></button>';
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
      // Downscale hard by default to cut vision-token cost (monitor/vent/lab screens read
      // reliably at ~1024px). Hi-quality (1500px) stays available for dense reports.
      var maxEdge = _imgHiQ ? 1500 : 900, w = img.width, h = img.height;
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
      var ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(img, 0, 0, cw, ch);
      var q = _imgHiQ ? 0.72 : 0.6, out = cv.toDataURL("image/jpeg", q), guard = 0;
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
  // Lazy-load pdf.js only when a PDF is imported; render selected pages to
  // compressed images. Whole PDF is NEVER sent to AI — only rendered page images.
  // BUG #12: load the LOCALLY-BUNDLED copy first so PDF import works offline and in
  // the native (Capacitor) app where the CDN is unreachable; fall back to the CDN
  // only if the bundled file is missing.
  var _pdfjs = null;
  var PDFJS_LOCAL = "/vendor/pdfjs/pdf.min.js", PDFJS_LOCAL_W = "/vendor/pdfjs/pdf.worker.min.js";
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", PDFJS_CDN_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function loadPdfJs() {
    if (_pdfjs) return Promise.resolve(_pdfjs);
    if (window.pdfjsLib) { _pdfjs = window.pdfjsLib; try { _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_LOCAL_W; } catch (e) {} return Promise.resolve(_pdfjs); }
    return new Promise(function (res, rej) {
      function load(src, worker, next) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { try { _pdfjs = window.pdfjsLib; _pdfjs.GlobalWorkerOptions.workerSrc = worker; res(_pdfjs); } catch (e) { if (next) next(); else rej(e); } };
        s.onerror = function () { if (next) next(); else rej(new Error("pdf-load")); };
        document.head.appendChild(s);
      }
      load(PDFJS_LOCAL, PDFJS_LOCAL_W, function () { load(PDFJS_CDN, PDFJS_CDN_W, null); });
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
  // Run a set of page images through the SAME engine chooser the single-image path uses — so the
  // clinician keeps the AI Vision ↔ Apple/Device OCR choice for PDFs too. The engine (+ PHI consent)
  // is chosen ONCE on page 1; pages 2..N reuse it via engineOverride (no re-prompt). Each page is
  // parsed to SECTIONS independently and merged (first page to supply a field wins) so a chemistry
  // HCO₃ on page 1 never bleeds into the ABG section of page 2. gold249.
  function processImagesCombined(imgs, done) {
    var sections = {}, lines = [], engineChosen = null, idx = 0;
    function mergeInto(sec) {
      if (!sec) return;
      ["labs", "abg", "vitals", "ventilator"].forEach(function (g) {
        if (!sec[g]) return; sections[g] = sections[g] || {};
        Object.keys(sec[g]).forEach(function (k) { if (sections[g][k] == null) sections[g][k] = sec[g][k]; });
      });
    }
    (function next() {
      if (idx >= imgs.length) { done(sections, lines); return; }
      var opts = { image: imgs[idx], kind: "all" };
      if (engineChosen) opts.engineOverride = engineChosen;   // page 2+ : reuse page-1's choice
      SMD_IMAGE_ENGINE.process(opts).then(function (r) {
        if (!r || r.cancelled) { if (idx === 0) { done(null, null); return; } idx++; return next(); }
        if (r.engine && r.engine !== "manual") engineChosen = r.engine;
        if (r.fields) mergeInto(coerceSections(r.fields));
        if (r.lines) r.lines.forEach(function (l) { if (l) lines.push(String(l)); });
        if (r.engine === "manual") { done(sections, lines); return; }   // chose to type → open review to fill
        idx++; next();
      }).catch(function () { idx++; next(); });
    })();
  }

  var IMPORT_LBL = { na: "Sodium", k: "Potassium", cl: "Chloride", hco3: "HCO₃", ca: "Calcium", mg: "Magnesium", po4: "Phosphate", glu: "Glucose", creat: "Creatinine", urea: "Urea", alb: "Albumin", wbc: "WBC", hb: "Hb", plt: "Platelets", inr: "INR", crp: "CRP", bili: "Bilirubin", ast: "AST", alt: "ALT", lactate: "Lactate",
    hr: "Heart rate", sbp: "Systolic BP", dbp: "Diastolic BP", map: "MAP", rr: "Resp rate", spo2: "SpO₂", temp: "Temp", cvp: "CVP", etco2: "EtCO₂",
    ph: "pH", paco2: "PaCO₂", pao2: "PaO₂", be: "Base excess", fio2: "FiO₂", mode: "Mode", peep: "PEEP", tv: "Tidal volume", peak: "Peak", plateau: "Plateau" };
  var IMPORT_GROUP = { labs: "mapped", monitor: "vitals", abg: "abg", ventilator: "ventilator" };
  function importFileInput(kind, method) {
    // Native: a programmatic <input type=file>.click() does NOT open a picker in
    // WKWebView — use the Capacitor Camera plugin and feed its dataUrl into the SAME
    // OCR pipeline (compressImage → doOcr → SMD_AI.vision). Web keeps the file input.
    // NOTE: Camera returns IMAGES only (no PDF) — PDF import stays web-only.
    if (window.SMD_IS_NATIVE && window.SMD_NATIVE) {
      // Upload PDF/file → native document picker (PDF or image) → reuse the web
      // handleImportFile pipeline (pdf.js renders a PDF page; images go to OCR).
      if (method !== "camera" && window.SMD_NATIVE.pickFile) {
        importProgress("Opening files…");
        window.SMD_NATIVE.pickFile({ types: ["application/pdf", "image/*"] })
          .then(function (blob) { if (blob) handleImportFile(kind, blob); else importDone(); })
          .catch(function () { importDone(); });
        return;
      }
      // Camera (and fallback) → Capacitor Camera plugin → OCR pipeline.
      importProgress(method === "camera" ? "Opening camera…" : "Opening photos…");
      window.SMD_NATIVE.pickImage({ camera: method === "camera" }).then(function (dataUrl) {
        importProgress("Compressing image…");
        compressImage(dataUrl, function (d, meta) {
          if (!d) return importProgress("Could not read this image.", true);
          doOcr(kind, d, meta ? meta.kb + " KB" : "");
        });
      }).catch(function () { importDone(); });
      return;
    }
    var inp = document.createElement("input"); inp.type = "file";
    inp.accept = (method === "camera") ? "image/*" : "image/*,application/pdf";
    if (method === "camera") inp.setAttribute("capture", "environment");   // rear camera on mobile
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (f) handleImportFile(kind, f); inp.remove(); });
    inp.click();
  }
  // Camera / Upload → extract EVERYTHING in the report(s) at once (labs + ABG + vitals + vent),
  // across all pages. No "which report?" gate — the combined extractor sorts each value into its
  // own section, so a photo showing the monitor AND an ABG slip, or a PDF with electrolytes on
  // page 1 and an ABG on page 2, is fully captured (gold249).
  function importMethod(method) { importFileInput("all", method); }
  function wardSyncFetch() {
    if (typeof window.openGHIS === "function") { try { openGHIS(); } catch (e) {} }
    else if (window.SMD_setGhis) { try { SMD_setGhis(true); setTimeout(function () { try { window.openGHIS && openGHIS(); } catch (e) {} }, 400); } catch (e) {} }
    else if (window.toast) toast("Ward Sync is loading — try again in a moment.");
  }
  function importProgress(msg, err) {
    var el = document.getElementById("icuImpOv");
    if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov icu-modal"; document.body.appendChild(el); }
    el.innerHTML = '<div class="icu-imp-box">' + '<button class="icu-imp-x" id="icuImpX" aria-label="Close">✕</button>' + (err ? '<div class="icu-imp-err">' + esc(msg) + '</div><button class="icu-btn" id="icuImpClose">Close</button>' : '<div class="icu-imp-spin">◐</div><div>' + esc(msg) + "</div>") + "</div>";
    var x = el.querySelector("#icuImpX"); if (x) x.addEventListener("click", function () { el.remove(); });   // always-present dismiss, even while the spinner is shown
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
            var pages = Math.min(pdf.numPages, 6);   // read up to 6 pages (was: page 1 only)
            var capNote = pdf.numPages > 6 ? "First 6 of " + pdf.numPages + " pages" : "";
            // Combined "all": render EVERY page → run them through the engine chooser (AI Vision vs
            // Apple/Device OCR — clinician's choice, asked once) → merged grouped review, so page-1
            // electrolytes + page-2 ABG are both captured. Legacy per-category kinds keep page 1.
            if (kind === "all") {
              var imgs = [], p = 1;
              (function renderNext() {
                if (p > pages) {
                  if (!imgs.length) return importProgress("Could not read this PDF. Try a photo instead.", true);
                  importDone();   // process() shows its own engine chooser / busy indicator
                  processImagesCombined(imgs, function (sections, lines) {
                    if (sections === null) return;   // cancelled at the engine chooser
                    openImportReviewAll(sections || {}, imgs[0], lines || [], capNote, "Imported report");
                  });
                  return;
                }
                importProgress("Rendering page " + p + " of " + pages + "…");
                renderPdfPageToImage(pdf, p, function (img) { if (img) imgs.push(img); p++; renderNext(); });
              })();
              return;
            }
            importProgress("Rendering page 1 of " + pdf.numPages + "…");
            renderPdfPageToImage(pdf, 1, function (img) {
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
  // Map an engine result (fields keyed strictly) → the numeric field map the review uses.
  // Ingest mapping is UNCHANGED — values map by key exactly as before.
  function extractOcrFields(r) {
    var fields = {};
    if (r && r.mode === "fields") {
      var src = (r.fields && typeof r.fields === "object") ? r.fields : {};
      Object.keys(src).forEach(function (k) { if (k === "kind" || k === "fields") return; if (k === "mode") { if (src[k]) fields[k] = src[k]; } else if (src[k] != null && !isNaN(parseFloat(src[k]))) fields[k] = parseFloat(src[k]); });
    }
    return fields;
  }
  function doOcr(kind, dataUrl, note) {
    // Combined "all" → the engine returns SECTIONS ({labs,abg,vitals,ventilator}); route to the
    // grouped review so every category present in one image is captured at once (gold249).
    if (kind === "all") {
      if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.process) {
        SMD_IMAGE_ENGINE.process({ image: dataUrl, kind: "all" }).then(function (r) {
          importDone();
          if (!r || r.cancelled) return;
          openImportReviewAll(coerceSections(r && r.fields), dataUrl, (r && r.lines) || [], note, "Imported report");
        }).catch(function () { importDone(); openImportReviewAll({}, dataUrl, [], note, "Imported report"); });
        return;
      }
      importProgress("On-device reader unavailable — enter values manually.", true); return;
    }
    var mapKind = IMPORT_GROUP[kind] ? (kind === "abg" ? "abg" : kind) : "labs";
    // Route through the clinician-controlled Image Engine chooser (Private Device OCR vs
    // AI Vision). It handles engine choice, PHI consent, and graceful fallback, then resolves
    // the same { mode, fields, lines } shape the review already consumes. Falls back to the
    // legacy readImage path only if the module is somehow absent.
    if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.process) {
      SMD_IMAGE_ENGINE.process({ image: dataUrl, kind: mapKind }).then(function (r) {
        importDone();
        if (!r || r.cancelled) return;   // user cancelled — no dead end, just closes cleanly
        openImportReview(kind, extractOcrFields(r), dataUrl, (r && r.lines) || []);
      }).catch(function () { importDone(); openImportReview(kind, {}, dataUrl, []); });
      return;
    }
    importProgress("Reading on-device…" + (note ? " (" + note + ")" : ""));
    if (!(window.SMD_AI && SMD_AI.readImage)) { importProgress("On-device reader unavailable — enter values manually.", true); return; }
    SMD_AI.readImage(dataUrl, mapKind).then(function (r) {
      importDone();
      openImportReview(kind, extractOcrFields(r), dataUrl, (r && r.lines) || []);
    }).catch(function () { importDone(); importProgress("Could not read this on-device — enter values manually.", true); });
  }
  // Clinician review — nothing enters the patient context until confirmed here.
  // Fields shown per report kind when we fall back to manual/tap-to-fill (no AI fields).
  var IMPORT_FIELDS = {
    labs: ["na", "k", "cl", "hco3", "ca", "mg", "po4", "glu", "creat", "urea", "alb", "wbc", "hb", "plt", "inr", "crp", "bili", "ast", "alt", "lactate"],
    monitor: ["hr", "sbp", "dbp", "map", "rr", "spo2", "temp", "cvp", "etco2"],
    abg: ["ph", "paco2", "pao2", "hco3", "be", "lactate", "fio2"],
    ventilator: ["mode", "fio2", "peep", "tv", "rr", "peak", "plateau"]
  };
  // Review + tap-to-fill. `fields` = AI-structured values (may be empty on fallback);
  // `lines` = on-device OCR lines. When AI gave nothing, show the full field set and let
  // the clinician TAP a recognized value to drop it into the focused box. Nothing is
  // ingested until confirmed. Fully works offline / with AI off.
  function openImportReview(kind, fields, dataUrl, lines, source) {
    fields = fields || {}; lines = lines || [];
    var extracted = Object.keys(fields), aiMode = extracted.length > 0;
    var showKeys = aiMode ? extracted : (IMPORT_FIELDS[kind] || IMPORT_FIELDS.labs);
    if (!showKeys.length && !lines.length) { importProgress("No values could be read — please enter values manually.", true); return; }
    var el = document.getElementById("icuImpOv"); if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov icu-modal"; document.body.appendChild(el); }
    var L = _raw.labs.recent || {}, lastV = latestVitals();
    var rows = showKeys.map(function (k) {
      var val = fields[k] != null ? fields[k] : "";
      var cur = (kind === "labs") ? L[k] : (kind === "monitor") ? lastV[k] : (kind === "abg") ? (_raw.abg || {})[k] : (_raw.ventilator || {})[k];
      var dup = (val !== "" && cur != null && cur !== "" && String(cur) === String(val)) ? '<span class="icu-imp-dup">≈ already recorded</span>'
        : (val !== "" && cur != null && cur !== "") ? '<span class="icu-imp-diff">differs from current ' + esc(cur) + '</span>' : "";
      return '<label class="icu-imp-row"><span class="icu-imp-k">' + esc(IMPORT_LBL[k] || k) + '</span>' +
        '<input data-impk="' + k + '" aria-label="' + esc(IMPORT_LBL[k] || k) + '" value="' + esc(val) + '" ' + (k === "mode" ? 'type="text"' : 'type="number" step="any" inputmode="decimal"') + '>' + dup + "</label>";
    }).join("");
    var linesPanel = lines.length ? (
      '<div class="icu-imp-note" style="margin-top:8px">📝 <b>Recognized on-device</b> — tap a value to drop it into the focused box.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;max-height:170px;overflow:auto">' +
      lines.map(function (ln) { return '<button type="button" class="icu-imp-line" data-line="' + esc(ln) + '" style="font:600 12px var(--font);background:var(--panel2,#0F1A2B);border:1px solid var(--border,#1E2B43);color:var(--ink,#E7EDF5);border-radius:8px;padding:6px 9px;cursor:pointer;text-align:left">' + esc(ln) + '</button>'; }).join("") +
      '</div>'
    ) : "";
    var manual = (source === "Manual");
    el.innerHTML = '<div class="icu-imp-review"><div class="icu-imp-hd">Review values<button class="icu-imp-x" id="icuImpX">✕</button></div>' +
      '<div class="icu-imp-note">' + (manual
        ? '✎ <b>Manual entry</b> — confirm your values (checked against the current reading) before they enter the patient record.'
        : (aiMode
          ? '📷 Read on-device, structured by AI — <b>verify every value</b> against the report before applying.'
          : '📷 Read on-device — tap the recognized values below or type them. <b>Verify every value.</b>')) + ' Nothing is added until you confirm.</div>' +
      (dataUrl ? '<img class="icu-imp-thumb" src="' + dataUrl + '">' : "") +
      '<div class="icu-imp-rows">' + rows + "</div>" + linesPanel +
      '<div class="icu-imp-actions"><button class="icu-btn" id="icuImpCancel">Cancel</button><button class="icu-btn icu-imp-go" id="icuImpConfirm">✓ Add to patient context</button></div></div>';
    function close() { el.remove(); }
    var focused = el.querySelector("[data-impk]");
    el.querySelectorAll("[data-impk]").forEach(function (i) { i.addEventListener("focus", function () { focused = i; }); });
    el.querySelectorAll(".icu-imp-line").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = focused || el.querySelector("[data-impk]"); if (!f) return;
        var raw = b.getAttribute("data-line") || "";
        if (f.type === "number") { var num = (raw.match(/-?\d+(\.\d+)?/) || [])[0]; if (num != null) f.value = num; }
        else f.value = raw.trim();
        b.style.opacity = ".5"; try { f.focus(); } catch (e) {}
      });
    });
    el.querySelector("#icuImpX").addEventListener("click", close);
    el.querySelector("#icuImpCancel").addEventListener("click", close);
    el.querySelector("#icuImpConfirm").addEventListener("click", function () {
      var vals = {}; el.querySelectorAll("[data-impk]").forEach(function (i) { var k = i.getAttribute("data-impk"), v = i.value; if (v !== "" && v != null) vals[k] = (k === "mode") ? v : parseFloat(v); });
      if (!Object.keys(vals).length) { close(); return; }
      var bundle = { source: source || "Imported report" }; bundle[IMPORT_GROUP[kind] || "mapped"] = vals;
      var res = ICU.ingestFromWard(bundle);
      close(); paint();
      try { if (window.toast) toast((manual ? "Saved " : "Imported ") + Object.keys(vals).length + " value(s)" + (res && res.conflicts ? " · " + res.conflicts + " conflict(s) to review" : "")); } catch (e) {}
    });
  }
  /* ---- Combined "all" review (gold249): one report/photo/PDF → sections grouped by category,
   * each value routed to its own field group, ingested in ONE conflict-safe ingestFromWard.
   * Fixes: (1) capture no longer fetches only electrolytes; (2) ABG from a PDF (any page) is
   * read; (3) a photo containing BOTH a monitor and an ABG populates both. ---- */
  var SEC_META = [["labs", "🧪 Labs", "monitor→n/a"], ["abg", "🩸 ABG", ""], ["vitals", "❤️ Vitals", ""], ["ventilator", "🫁 Ventilator", ""]];
  // Coerce an engine result into clean numeric sections. Accepts the sectioned shape
  // {labs:{…},abg:{…},…}; ventilator.mode stays a string. Drops empty sections.
  function coerceSections(f) {
    var out = {}; if (!f || typeof f !== "object") return out;
    ["labs", "abg", "vitals", "ventilator"].forEach(function (sec) {
      var src = f[sec]; if (!src || typeof src !== "object") return;
      var g = {};
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (sec === "ventilator" && k === "mode") { if (v != null && String(v).trim()) g[k] = String(v).trim(); }
        else if (v != null && !isNaN(parseFloat(v))) g[k] = parseFloat(v);
      });
      if (Object.keys(g).length) out[sec] = g;
    });
    return out;
  }
  function openImportReviewAll(sections, dataUrl, lines, note, source) {
    sections = sections || {}; lines = lines || [];
    var hasVals = ["labs", "abg", "vitals", "ventilator"].some(function (s) { return sections[s] && Object.keys(sections[s]).length; });
    if (!hasVals && !lines.length) { importProgress("No values could be read — try a clearer photo, or enter values manually.", true); return; }
    var aiMode = hasVals;
    var el = document.getElementById("icuImpOv"); if (!el) { el = document.createElement("div"); el.id = "icuImpOv"; el.className = "icu-imp-ov icu-modal"; document.body.appendChild(el); }
    var L = _raw.labs.recent || {}, lastV = latestVitals(), curAbg = _raw.abg || {}, curVent = _raw.ventilator || {};
    function curOf(sec, k) { return sec === "labs" ? L[k] : sec === "vitals" ? lastV[k] : sec === "abg" ? curAbg[k] : curVent[k]; }
    var groupsHTML = SEC_META.map(function (m) {
      var sec = m[0], vals = sections[sec] || {}, keys = Object.keys(vals);
      // AI gave values → show only those; nothing found (tap-to-fill mode) → show the full field set.
      if (!keys.length) { if (aiMode) return ""; keys = IMPORT_FIELDS[sec === "vitals" ? "monitor" : sec] || []; }
      if (!keys.length) return "";
      var rows = keys.map(function (k) {
        var val = vals[k] != null ? vals[k] : "";
        var cur = curOf(sec, k);
        var dup = (val !== "" && cur != null && cur !== "" && String(cur) === String(val)) ? '<span class="icu-imp-dup">≈ already recorded</span>'
          : (val !== "" && cur != null && cur !== "") ? '<span class="icu-imp-diff">differs from current ' + esc(cur) + '</span>' : "";
        return '<label class="icu-imp-row"><span class="icu-imp-k">' + esc(IMPORT_LBL[k] || k) + '</span>' +
          '<input data-impk="' + k + '" data-impsec="' + sec + '" aria-label="' + esc(IMPORT_LBL[k] || k) + '" value="' + esc(val) + '" ' + (k === "mode" ? 'type="text"' : 'type="number" step="any" inputmode="decimal"') + '>' + dup + "</label>";
      }).join("");
      return '<div style="font:800 12px var(--font);color:var(--primary,#0f766e);margin:12px 0 6px;text-transform:uppercase;letter-spacing:.04em">' + m[1] + '</div>' + rows;
    }).join("");
    var linesPanel = lines.length ? (
      '<div class="icu-imp-note" style="margin-top:8px">📝 <b>Recognized on-device</b> — tap a value to drop it into the focused box.</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;max-height:150px;overflow:auto">' +
      lines.map(function (ln) { return '<button type="button" class="icu-imp-line" data-line="' + esc(ln) + '" style="font:600 12px var(--font);background:var(--panel2,#0F1A2B);border:1px solid var(--border,#1E2B43);color:var(--ink,#E7EDF5);border-radius:8px;padding:6px 9px;cursor:pointer;text-align:left">' + esc(ln) + '</button>'; }).join("") + '</div>'
    ) : "";
    el.innerHTML = '<div class="icu-imp-review"><div class="icu-imp-hd">Review values' + (note ? ' <span style="font:600 11px var(--font);color:var(--muted)">· ' + esc(note) + '</span>' : '') + '<button class="icu-imp-x" id="icuImpX">✕</button></div>' +
      '<div class="icu-imp-note">' + (aiMode ? '📷 Read from your report(s) — <b>verify every value</b> before applying.' : '📷 Tap the recognized values below or type them. <b>Verify every value.</b>') + ' Nothing is added until you confirm.</div>' +
      (dataUrl ? '<img class="icu-imp-thumb" src="' + dataUrl + '">' : "") +
      '<div class="icu-imp-rows">' + groupsHTML + "</div>" + linesPanel +
      '<div class="icu-imp-actions"><button class="icu-btn" id="icuImpCancel">Cancel</button><button class="icu-btn icu-imp-go" id="icuImpConfirm">✓ Add to patient context</button></div></div>';
    function close() { el.remove(); }
    var focused = el.querySelector("[data-impk]");
    el.querySelectorAll("[data-impk]").forEach(function (i) { i.addEventListener("focus", function () { focused = i; }); });
    el.querySelectorAll(".icu-imp-line").forEach(function (b) {
      b.addEventListener("click", function () {
        var f = focused || el.querySelector("[data-impk]"); if (!f) return;
        var raw = b.getAttribute("data-line") || "";
        if (f.type === "number") { var num = (raw.match(/-?\d+(\.\d+)?/) || [])[0]; if (num != null) f.value = num; }
        else f.value = raw.trim();
        b.style.opacity = ".5"; try { f.focus(); } catch (e) {}
      });
    });
    el.querySelector("#icuImpX").addEventListener("click", close);
    el.querySelector("#icuImpCancel").addEventListener("click", close);
    el.querySelector("#icuImpConfirm").addEventListener("click", function () {
      var bundle = { source: source || "Imported report" }, groups = { labs: {}, abg: {}, vitals: {}, ventilator: {} }, n = 0;
      el.querySelectorAll("[data-impk]").forEach(function (i) {
        var k = i.getAttribute("data-impk"), sec = i.getAttribute("data-impsec"), v = i.value;
        if (v === "" || v == null) return;
        groups[sec][k] = (k === "mode") ? v : parseFloat(v); n++;
      });
      if (!n) { close(); return; }
      if (Object.keys(groups.labs).length) bundle.mapped = groups.labs;         // pre-keyed labs → labs.recent
      if (Object.keys(groups.vitals).length) bundle.vitals = groups.vitals;
      if (Object.keys(groups.abg).length) bundle.abg = groups.abg;
      if (Object.keys(groups.ventilator).length) bundle.ventilator = groups.ventilator;
      var res = ICU.ingestFromWard(bundle);
      close(); paint();
      try { if (window.toast) toast("Imported " + n + " value(s)" + (res && res.conflicts ? " · " + res.conflicts + " conflict(s) to review" : "")); } catch (e) {}
    });
  }
  function startImport(kind) { importFileInput(IMPORT_GROUP[kind] ? kind : "labs"); }
  // MaiK Scribe → ICU: open the editable import-review sheet prefilled with voice-extracted
  // fields (tagged source:"Voice"; conflict-safe via ingestFromWard on confirm).
  function reviewVoice(fields, kind) {
    var k = IMPORT_GROUP[kind] ? kind : "labs";
    openImportReview(k, fields || {}, null, [], "Voice");
  }

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
    // Break the line across LARGE gaps so we never imply a continuous trajectory we don't have
    // (e.g. a 3-day hole between two labs). Gap threshold = 2.5× the median spacing, min 36 h.
    var dts = []; for (var gi = 1; gi < points.length; gi++) dts.push(points[gi].ts - points[gi - 1].ts);
    var sdt = dts.slice().sort(function (a, b) { return a - b; }); var med = sdt.length ? sdt[Math.floor(sdt.length / 2)] : 0;
    var maxGap = opts.maxGap || Math.max(med * 2.5, 36 * 3600 * 1000);
    var d = "", dots = "";
    points.forEach(function (p, i) {
      var brk = i === 0 || (p.ts - points[i - 1].ts) > maxGap;
      d += (brk ? "M" : "L") + X(p.ts).toFixed(1) + " " + Y(p.v).toFixed(1) + " ";
      dots += '<circle cx="' + X(p.ts).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="2.1" fill="var(--primary)"/>';
    });
    var band = "";
    if (opts.band) { var y1 = Y(opts.band[1]), y2 = Y(opts.band[0]); band = '<rect x="0" y="' + y1.toFixed(1) + '" width="' + W + '" height="' + Math.max(0, y2 - y1).toFixed(1) + '" fill="var(--ok-soft)" opacity=".7"/>'; }
    var dec = spanY < 5 ? 1 : 0, last = ys[ys.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:78px;display:block">' + band +
      '<path d="' + d.trim() + '" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' + dots + '</svg>' +
      '<div style="display:flex;justify-content:space-between;font:600 10px var(--font);color:var(--muted);margin-top:3px"><span>' + esc(minY.toFixed(dec)) + "–" + esc(maxY.toFixed(dec)) + (opts.unit ? " " + esc(opts.unit) : "") + '</span><span>last <b style="color:var(--ink)">' + esc(last) + "</b></span></div>";
  }
  function trendCard(title, series, opts) { return '<div class="icu-card"><div class="icu-sec-lbl" style="margin:0 0 8px">' + esc(title) + "</div>" + trendGraph(series, opts) + "</div>"; }
  function recsCard(title, recs, flags, ev) {
    return '<div class="icu-card"><h3>' + esc(title) + "</h3>" +
      ((flags && flags.length) ? flags.map(function (f) { return '<div class="icu-alert warn"><div><div class="am">⚠ ' + esc(f) + "</div></div></div>"; }).join("") : "") +
      (recs || []).map(function (r) { return '<p style="margin:9px 0 0">• ' + esc(r) + "</p>"; }).join("") + evidenceBadges(ev) + "</div>";
  }
  function winSelector() {
    var opts = [["24h", 864e5], ["48h", 1728e5], ["72h", 2592e5], ["7d", 6048e5], ["All", 0]];
    return '<div class="icu-trend-wins">' + opts.map(function (o) {
      return '<button class="icu-btn ghost" style="width:auto;margin:0;padding:7px 12px;font-size:12px;' + (_trendWin === o[1] ? "background:var(--primary-soft);border-color:var(--primary)" : "") + '" data-icu-act="win:' + o[1] + '">' + o[0] + "</button>";
    }).join("") + "</div>";
  }
  function vitalSeries(key, win) { var c = Date.now(); return (_raw.vitals || []).filter(function (v) { return v[key] != null && (!win || v.ts >= c - win); }).map(function (v) { return { ts: v.ts, v: v[key] }; }); }
  function mapSeries(win) { var c = Date.now(); return (_raw.vitals || []).filter(function (v) { return (v.map != null || (v.sbp != null && v.dbp != null)) && (!win || v.ts >= c - win); }).map(function (v) { return { ts: v.ts, v: v.map != null ? v.map : mapCalc(v.sbp, v.dbp) }; }); }
  function labSeries(key, win) { var c = Date.now(); return (_raw.labs.trends || []).filter(function (r) { return r[key] != null && (!win || r.ts >= c - win); }).map(function (r) { return { ts: r.ts, v: r[key] }; }); }

  /* ===================== ICU TRENDS — patient trajectory (config-driven) =====================
   * Direction semantics live in DATA, not the UI. good: which way is clinically GOOD
   * ('down' | 'up' | null=contextual). unit: the app's stored unit (SI where wardToSI converts —
   * creat µmol/L, ca/mg/po4/glu mmol/L, alb g/L; native otherwise). src: series store. */
  var TREND_INTERP = {
    hb:   { label: "Haemoglobin", unit: "g/dL", good: "up", src: "lab", ref: [12, 16], note: "fall — consider bleeding / haemodilution / sample variation" },
    hct:  { label: "Haematocrit", unit: "%", good: "up", src: "lab" },
    wbc:  { label: "WBC / TLC", unit: "", good: null, src: "lab", note: "correlate with infection / steroids / clinical status" },
    neut: { label: "Neutrophils", unit: "", good: null, src: "lab", note: "correlate clinically" },
    plt:  { label: "Platelets", unit: "", good: "up", src: "lab", ref: [150, 400], note: "fall — concerning (sepsis / DIC / drugs)" },
    creat:{ label: "Creatinine", unit: "mg/dL", good: "down", src: "lab", ref: [0.6, 1.3] },
    urea: { label: "Urea", unit: "mg/dL", good: "down", src: "lab", ref: [15, 45] },
    na:   { label: "Sodium", unit: "mEq/L", good: null, src: "lab", ref: [135, 145], crit: function (v) { return v < 120 || v > 160; } },
    k:    { label: "Potassium", unit: "mEq/L", good: null, src: "lab", ref: [3.5, 5.0], crit: function (v) { return v > 6.0 || v < 2.5; }, note: "K by safety threshold — >6.0 or <2.5 is critical" },
    cl:   { label: "Chloride", unit: "mEq/L", good: null, src: "lab", ref: [98, 107] },
    hco3: { label: "Bicarbonate", unit: "mEq/L", good: null, src: "lab", ref: [22, 28] },
    ca:   { label: "Calcium (total)", unit: "mg/dL", good: null, src: "lab", ref: [8.5, 10.5] },
    mg:   { label: "Magnesium", unit: "mg/dL", good: null, src: "lab", ref: [1.7, 2.4] },
    po4:  { label: "Phosphate", unit: "mg/dL", good: null, src: "lab", ref: [2.5, 4.5] },
    bili: { label: "Bilirubin (total)", unit: "mg/dL", good: "down", src: "lab", ref: [0.2, 1.2] },
    bili_d:{ label: "Bilirubin (direct)", unit: "mg/dL", good: "down", src: "lab" },
    ast:  { label: "AST / SGOT", unit: "U/L", good: "down", src: "lab" },
    alt:  { label: "ALT / SGPT", unit: "U/L", good: "down", src: "lab" },
    alp:  { label: "Alk phosphatase", unit: "U/L", good: "down", src: "lab" },
    alb:  { label: "Albumin", unit: "g/dL", good: "up", src: "lab", ref: [3.5, 5.2] },
    inr:  { label: "INR", unit: "", good: "down", src: "lab" },
    amylase:{ label: "Amylase", unit: "U/L", good: null, src: "lab", note: "trend only — correlate clinically" },
    lipase:{ label: "Lipase", unit: "U/L", good: null, src: "lab", note: "trend only — correlate clinically" },
    glu:  { label: "Glucose", unit: "mg/dL", good: null, src: "lab", ref: [70, 140] },
    lactate:{ label: "Lactate", unit: "mmol/L", good: "down", src: "vital" },
    crp:  { label: "CRP", unit: "mg/L", good: "down", src: "lab" },
    pct:  { label: "Procalcitonin", unit: "ng/mL", good: "down", src: "lab" },
    hr:   { label: "Heart rate", unit: "bpm", good: null, src: "vital" },
    map:  { label: "MAP", unit: "mmHg", good: "up", src: "map", ref: [65, 110], note: "MAP <65 — perfusion at risk" },
    spo2: { label: "SpO₂", unit: "%", good: "up", src: "vital", ref: [92, 100] },
    rr:   { label: "Resp rate", unit: "/min", good: null, src: "vital" },
    temp: { label: "Temperature", unit: "°C", good: null, src: "vital" },
    uop:  { label: "Urine output", unit: "mL/h", good: "up", src: "vital" }
  };
  var TREND_GROUPS = [
    { id: "cbc", name: "CBC / Haematology", keys: ["hb", "hct", "wbc", "neut", "plt"] },
    { id: "renal", name: "Renal / Electrolytes", keys: ["creat", "urea", "na", "k", "cl", "hco3", "ca", "mg", "po4"] },
    { id: "liver", name: "Liver / Coagulation", keys: ["bili", "bili_d", "ast", "alt", "alp", "alb", "inr"] },
    { id: "panc", name: "Pancreatic / Metabolic", keys: ["amylase", "lipase", "glu", "lactate", "crp", "pct"] },
    { id: "vitals", name: "Vitals / Haemodynamics", keys: ["hr", "map", "spo2", "rr", "temp", "uop"] }
  ];
  function trendSeriesFor(key, win) { var m = TREND_INTERP[key]; if (!m) return []; return m.src === "map" ? mapSeries(win) : m.src === "vital" ? vitalSeries(key, win) : labSeries(key, win); }
  function fmtDur(ms) { var h = Math.round(ms / 36e5); if (h < 1) return "<1 h"; if (h < 48) return h + " h"; var dd = Math.round(h / 24); return dd + " day" + (dd === 1 ? "" : "s"); }
  function fmtWhen(ts) { try { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" }) + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function fmtNum(v) { if (v == null) return "—"; var a = Math.abs(v), dp = a >= 100 ? 0 : a >= 10 ? 1 : 2, f = Math.pow(10, dp); return (Math.round(v * f) / f).toString(); }
  function interpret(key, series) {
    var m = TREND_INTERP[key] || {}; series = (series || []).slice().sort(function (a, b) { return a.ts - b.ts; });
    if (!series.length) return null;
    var latest = series[series.length - 1], prev = series.length > 1 ? series[series.length - 2] : null;
    var o = { key: key, meta: m, label: m.label || key, latest: latest.v, when: latest.ts, unit: m.unit || "", note: m.note || "" };
    o.status = (m.crit && m.crit(latest.v)) ? "critical" : m.ref ? ((latest.v < m.ref[0] || latest.v > m.ref[1]) ? "abnormal" : "normal") : "—";
    if (!prev) { o.dir = "single"; o.arrow = "•"; o.interp = "single reading"; o.tone = "flat"; return o; }
    o.prev = prev.v; o.delta = latest.v - prev.v; o.pct = prev.v !== 0 ? (o.delta / prev.v) * 100 : null; o.interval = fmtDur(latest.ts - prev.ts);
    var eps = Math.max(Math.abs(prev.v) * 0.02, 1e-9);
    o.dir = o.delta > eps ? "up" : o.delta < -eps ? "down" : "flat"; o.arrow = o.dir === "up" ? "↑" : o.dir === "down" ? "↓" : "→";
    if (o.dir === "flat") { o.interp = "stable"; o.tone = "flat"; }
    else if (m.good === "down") { o.interp = o.dir === "up" ? "worsening" : "improving"; o.tone = o.dir === "up" ? "bad" : "good"; }
    else if (m.good === "up") { o.interp = o.dir === "up" ? "improving" : "concerning"; o.tone = o.dir === "up" ? "good" : "bad"; }
    else { o.interp = "trend only — correlate clinically"; o.tone = "flat"; }
    if (m.crit && m.crit(latest.v)) o.tone = "bad";
    return o;
  }
  function analyteCard(key, win) {
    var series = trendSeriesFor(key, win), o = interpret(key, series); if (!o) return "";
    var m = o.meta, tc = o.tone === "bad" ? "var(--danger,#b91c1c)" : o.tone === "good" ? "var(--ok,#15803d)" : "var(--muted)";
    var pill = o.status === "critical" ? '<span class="icu-tr-st crit">critical</span>' : o.status === "abnormal" ? '<span class="icu-tr-st ab">abnormal</span>' : o.status === "normal" ? '<span class="icu-tr-st ok">normal</span>' : "";
    var src = (STATE.src[key] && STATE.src[key].source) || "Ward Sync";
    var head = '<div class="icu-tr-head"><span class="icu-tr-lbl">' + esc(o.label) + '</span><span class="icu-tr-val">' + esc(fmtNum(o.latest)) + (o.unit ? ' <span class="u">' + esc(o.unit) + '</span>' : '') + ' <b class="icu-tr-arrow" style="color:' + tc + '">' + o.arrow + '</b></span></div>';
    var sub = "";
    if (o.prev != null) {
      var pctStr = (o.pct != null && Math.abs(o.pct) >= 5) ? " · " + (o.pct > 0 ? "+" : "") + Math.round(o.pct) + "%" : "";
      sub = '<div class="icu-tr-sub">Previous ' + esc(fmtNum(o.prev)) + ' · ' + (o.delta > 0 ? "+" : "") + esc(fmtNum(o.delta)) + ' in ' + esc(o.interval) + pctStr + '</div>' +
        '<div class="icu-tr-interp" style="color:' + tc + '">' + esc(o.interp) + '</div>';
    }
    var note = (o.note && (o.tone === "bad" || m.good == null)) ? '<div class="icu-tr-note">' + esc(o.note) + '</div>' : "";
    var srcLine = '<div class="icu-tr-src">' + pill + '<span>' + esc(src) + ' · ' + esc(fmtWhen(o.when)) + '</span></div>';
    var chart = series.length >= 2 ? trendGraph(series, { unit: o.unit, band: m.ref }) : '<div class="icu-tr-single">Single reading — no trend yet</div>';
    return '<div class="icu-card icu-tr-card' + (key === _lwHighlight ? " lw-hi" : "") + '">' + head + sub + note + srcLine + chart + '</div>';
  }
  function groupSection(grp, win) {
    var have = grp.keys.filter(function (k) { return trendSeriesFor(k, win).length > 0; });
    if (!have.length) return '<details class="icu-tr-group"><summary>' + esc(grp.name) + ' <span class="icu-tr-none">no data</span></summary><div class="icu-tr-empty">No historical data available in this window.</div></details>';
    return '<details class="icu-tr-group" open><summary>' + esc(grp.name) + ' <span class="icu-tr-cnt">' + have.length + '</span></summary>' + have.map(function (k) { return analyteCard(k, win); }).join("") + '</details>';
  }
  function significantChanges(win) {
    var flags = [];
    Object.keys(TREND_INTERP).forEach(function (k) {
      var s = trendSeriesFor(k, win).slice().sort(function (a, b) { return a.ts - b.ts; }); if (s.length < 2) return;
      var m = TREND_INTERP[k], latest = s[s.length - 1], prev = s[s.length - 2], dt = latest.ts - prev.ts, pct = prev.v !== 0 ? (latest.v - prev.v) / prev.v * 100 : 0;
      if ((k === "k" || k === "na") && m.crit && m.crit(latest.v)) flags.push(m.label + " now " + fmtNum(latest.v) + " " + m.unit);
      else if (k === "creat" && dt <= 48 * 36e5 && pct >= 50) flags.push("Creatinine up " + Math.round(pct) + "% in " + fmtDur(dt));
      else if (k === "plt" && s.length >= 3 && latest.v < prev.v && prev.v < s[s.length - 3].v) flags.push("Platelets falling over 3+ results");
      else if (k === "lactate" && latest.v > prev.v && latest.v >= 2) flags.push("Lactate rising (now " + fmtNum(latest.v) + " mmol/L)");
      else if (m.good && Math.abs(pct) >= 50 && dt <= 72 * 36e5) flags.push(m.label + " " + (pct > 0 ? "up" : "down") + " " + Math.round(Math.abs(pct)) + "% in " + fmtDur(dt));
    });
    flags = flags.filter(function (f, i) { return flags.indexOf(f) === i; }).slice(0, 6);
    if (!flags.length) return "";
    return '<div class="icu-tr-flags"><div class="icu-tr-flags-h">' + ico("warn", "⚠️") + ' Significant changes <span>· trend flags — review clinically</span></div>' + flags.map(function (f) { return '<span class="icu-tr-flag">' + esc(f) + '</span>'; }).join("") + '</div>';
  }
  function hasTrendPatient() { var p = _raw.patient; return !!(p && (p.name || p.diagnosis)) || (_raw.labs.trends || []).length > 0 || (_raw.vitals || []).length > 0; }
  function trendsEmpty() {
    return '<div class="icu-empty-state"><div class="icu-empty-ic">' + ico("trend", "📈") + '</div>' +
      '<div class="icu-empty-t">Select a patient to view trends</div>' +
      '<div class="icu-empty-p">Trends chart a patient’s labs &amp; vitals over time — rising, falling, or stable — from Ward Sync history and your saved data.</div>' +
      '<div class="icu-tr-empty-btns">' +
        '<button class="icu-btn" data-icu-act="edit:patient">' + ico("user", "🧑") + ' Select patient</button>' +
        '<button class="icu-btn ghost" data-icu-act="patients">' + ico("folder", "📋") + ' Saved patients</button>' +
        '<button class="icu-btn ghost" data-icu-act="wardfetch">' + ico("hospital", "🏥") + ' Fetch from Ward Sync</button>' +
      '</div></div>';
  }

  /* ================================ LAB WATCH ================================
   * Patient-specific new-lab monitoring. PHASE 1 = IN-APP monitoring only: when a
   * Ward-Sync sync brings NEW results (labs.trends[]), a deterministic comparison
   * (reusing TREND_INTERP + interpret() — NO AI) fires an in-app alert for the analytes
   * the clinician chose to watch, per the chosen sensitivity. Optional device notification
   * fires ONLY while the app is running (a local notification, permission requested at Start).
   * TRUE background push when the app is closed is PHASE 2 (documented below) — it needs a
   * server-side patient-scoped subscription store + a scheduled worker that can poll GHIS
   * server-side + APNs/FCM. We NEVER pretend to do 24/7 background monitoring here.
   * Flag smd_lab_watch (default ON) + ?labwatch=0 kill-switch. Records are per-account
   * (ownerNow) + per-patient in localStorage; comparison is deterministic; dedup by reading
   * timestamp; no PHI in logs (device notifications carry only the analyte label + value,
   * i.e. exactly what is already on screen). */
  function labWatchOn() {
    try {
      var q = (location.search.match(/[?&]labwatch=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = localStorage.getItem("smd_lab_watch");
      return v === null ? true : v === "1";
    } catch (e) { return true; }
  }
  var LW_BASE = "smd_lab_watch";
  var _lwBadge = 0, _lwHighlight = null, _lwDraft = null;
  function lwKey() { return LW_BASE + ":" + ownerNow(); }
  // BUG H3: key on the STABLE ward patientId when available (ward patients get no _id until
  // saved), so two patients sharing a first name — or two unnamed patients — never share a watch.
  function lwPatientKey() { var p = _raw.patient || {}; return String(p._id || (_raw.wardSync && _raw.wardSync.patientId) || p.name || "cur"); }
  function lwLoadAll() { try { var m = JSON.parse(localStorage.getItem(lwKey())); return (m && typeof m === "object") ? m : {}; } catch (e) { return {}; } }
  function lwSaveAll(m) { try { localStorage.setItem(lwKey(), JSON.stringify(m)); } catch (e) {} }
  function lwGet() { return lwLoadAll()[lwPatientKey()] || null; }
  function lwSet(w) { var m = lwLoadAll(); if (w) m[lwPatientKey()] = w; else delete m[lwPatientKey()]; lwSaveAll(m); }
  function lwExpired(w) { return !!(w && w.expiresAt && nowTs() > w.expiresAt); }
  function lwActive(w) { w = w || lwGet(); return !!(labWatchOn() && w && !w.paused && !lwExpired(w)); }
  // Seed "seen" to each watched analyte's latest reading at Start, so only labs arriving
  // AFTER the clinician starts watching alert (never a backlog of existing history).
  function lwSeedSeen(analytes) { var seen = {}; (analytes || []).forEach(function (k) { var s = trendSeriesFor(k, 0); if (s.length) seen[k] = s[s.length - 1].ts; }); return seen; }

  // Deterministic detection — run after every Ward-Sync ingest (see ingestFromWard /
  // ingestWardHistory). Compares each watched analyte's latest reading against the previous
  // one via interpret(); fires per the watch's sensitivity mode; dedups by reading timestamp.
  function lwScan() {
    if (!labWatchOn()) return;
    var w = lwGet(); if (!lwActive(w)) return;
    w.seen = w.seen || {};
    var fresh = [];
    (w.analytes || []).forEach(function (k) {
      var series = trendSeriesFor(k, 0); if (!series.length) return;
      var o = interpret(k, series); if (!o) return;
      var ts = o.when;
      if (w.seen[k] != null && ts <= w.seen[k]) return;   // dedup: already evaluated this reading
      w.seen[k] = ts;                                       // mark evaluated regardless of firing
      var meta = TREND_INTERP[k] || {};
      var crit = (meta.crit && meta.crit(o.latest)) || o.status === "critical";
      var fire = false, kind = "new";
      if (crit) { fire = true; kind = "critical"; }
      else if (w.mode === "every") { fire = true; kind = "new"; }
      else if (w.mode === "meaningful") {
        if (o.status === "abnormal" || o.tone === "bad" || (o.pct != null && o.dir !== "flat" && Math.abs(o.pct) >= 20)) { fire = true; kind = "change"; }
      } // mode "critical": only crit fires
      if (!fire) return;
      var chg = (o.prev != null && o.dir !== "single") ? " (" + o.arrow + " from " + fmtNum(o.prev) + ")" : "";
      var text = o.label + " " + fmtNum(o.latest) + (o.unit ? " " + o.unit : "") + (kind === "critical" ? " — critical" : chg);
      var item = { ts: ts, analyte: k, label: o.label, value: o.latest, unit: o.unit, kind: kind, text: text, ack: false };
      w.activity = w.activity || []; w.activity.unshift(item); fresh.push(item);
    });
    if ((w.activity || []).length > 60) w.activity = w.activity.slice(0, 60);
    w.lastScan = nowTs();
    lwSet(w);
    if (fresh.length) lwAnnounce(w, fresh);
  }
  function lwAnnounce(w, items) {
    var crit = items.filter(function (i) { return i.kind === "critical"; });
    var head = crit.length ? "⚠ Lab Watch — critical" : "🔔 Lab Watch";
    var msg = items.length === 1
      ? head + ": " + items[0].text
      : head + ": " + items.length + " new results — " + items.slice(0, 3).map(function (i) { return i.label; }).join(", ") + (items.length > 3 ? "…" : "");
    _lwBadge += items.length;
    try { if (window.toast) toast(msg); } catch (e) {}
    if (w.delivery === "device" || w.delivery === "both") lwDeviceNotify(head, items.length === 1 ? items[0].text : items.length + " new lab results", crit.length > 0);
    if (ICU.isOpen()) paint();
    // PHI-safe telemetry only (counts + severity, never values/identifiers).
    try { console.log("[lab-watch] fired", items.length, "items; critical=" + crit.length); } catch (e) {}
  }
  // Device (local) notification — fires ONLY while the app process is alive. Phase-2-ready:
  // uses @capacitor/local-notifications if bundled; else the web Notification API; else it
  // silently relies on the in-app toast. Body carries only the analyte label/value/count.
  function lwDeviceNotify(title, body, urgent) {
    try {
      // Prefer the unified foreground banner helper from native-push.js (native via
      // @capacitor/local-notifications, web via Notification/toast) when it's loaded.
      if (typeof window.SMD_localNotify === "function") { window.SMD_localNotify(title, body, "/"); return true; }
      var P = (window.Capacitor && window.Capacitor.Plugins) || {};
      if (P.LocalNotifications && P.LocalNotifications.schedule) {
        P.LocalNotifications.schedule({ notifications: [{ id: (nowTs() % 2147483000) + 1, title: title, body: body, schedule: { at: new Date(nowTs() + 200) } }] }).catch(function () {});
        return true;
      }
      if (window.Notification && Notification.permission === "granted") { new Notification(title, { body: body, tag: "smd-lab-watch", renotify: !!urgent }); return true; }
    } catch (e) {}
    return false;
  }
  function lwRequestNotifyPermission() {
    return new Promise(function (res) {
      try {
        var P = (window.Capacitor && window.Capacitor.Plugins) || {};
        if (P.LocalNotifications && P.LocalNotifications.requestPermissions) { P.LocalNotifications.requestPermissions().then(function (r) { res(!!(r && r.display === "granted")); }).catch(function () { res(false); }); return; }
        if (window.Notification && Notification.requestPermission) { var p = Notification.requestPermission(); if (p && p.then) { p.then(function (s) { res(s === "granted"); }); return; } }
      } catch (e) {}
      res(false);
    });
  }

  // Search synonyms so a clinician can find an analyte by common names/abbreviations.
  var LW_SYN = {
    k: ["potassium", "k+", "serum k"], na: ["sodium", "na+"], creat: ["creatinine", "kidney", "renal", "egfr"],
    urea: ["urea", "bun", "blood urea"], hb: ["haemoglobin", "hemoglobin", "hgb"], hct: ["haematocrit", "hematocrit", "pcv"],
    wbc: ["wbc", "tlc", "leucocyte", "leukocyte", "white cell", "count"], neut: ["neutrophil", "anc"], plt: ["platelet", "thrombocyte"],
    cl: ["chloride"], hco3: ["bicarbonate"], ca: ["calcium"], mg: ["magnesium"], po4: ["phosphate", "phosphorus"],
    bili: ["bilirubin", "jaundice"], bili_d: ["direct bilirubin", "conjugated"], ast: ["ast", "sgot"], alt: ["alt", "sgpt"],
    alp: ["alkaline phosphatase", "alp"], alb: ["albumin"], inr: ["inr", "coagulation", "prothrombin"], amylase: ["amylase"],
    lipase: ["lipase", "pancreatitis"], glu: ["glucose", "sugar", "rbs", "fbs"], lactate: ["lactate", "lactic"],
    crp: ["crp", "c-reactive"], pct: ["procalcitonin"], hr: ["heart rate", "pulse"], map: ["map", "mean arterial", "blood pressure"],
    spo2: ["spo2", "oxygen", "saturation"], rr: ["respiratory rate", "resp"], temp: ["temperature", "fever"], uop: ["urine", "output"]
  };
  function lwAnalyteMatch(k, q) {
    if (!q) return true; q = q.toLowerCase();
    var m = TREND_INTERP[k]; if (!m) return false;
    if ((m.label || "").toLowerCase().indexOf(q) >= 0 || k.indexOf(q) === 0) return true;
    return (LW_SYN[k] || []).some(function (s) { return s.indexOf(q) >= 0 || q.indexOf(s) >= 0; });
  }
  function lwModeLabel(m) { return m === "every" ? "every new result" : m === "critical" ? "critical results only" : "meaningful changes"; }
  function lwDurLabel(d) { return d === "discharge" ? "until discharge" : (d === 0 || d === "stop") ? "until you stop" : d + " hours"; }
  function lwRemaining(w) { if (!w || !w.expiresAt) return w && w.untilDischarge ? "until discharge" : "until you stop"; var ms = w.expiresAt - nowTs(); return ms <= 0 ? "expired" : fmtDur(ms) + " left"; }

  function lwStart() {
    if (!lwHasPatient()) { if (window.toast) toast("Load a patient first — open Ward Sync → a patient → Load into ICU, then start Lab Watch."); return; }
    var d = _lwDraft || {}, analytes = (d.analytes || []).slice();
    if (!analytes.length) { if (window.toast) toast("Pick at least one lab to watch."); return; }
    var mode = d.mode || "meaningful", dur = (d.dur != null ? d.dur : 12), delivery = d.delivery || "inapp";
    function finalize(deliv) {
      var now = nowTs(), expiresAt = (typeof dur === "number" && dur > 0) ? now + dur * 36e5 : null;
      var prev = lwGet();
      lwSet({ analytes: analytes, mode: mode, dur: dur, delivery: deliv, startedAt: now, expiresAt: expiresAt, untilDischarge: dur === "discharge", paused: false, seen: lwSeedSeen(analytes), activity: (prev && prev.activity) || [] });
      _lwDraft = null; _lwBadge = 0;
      if (window.toast) toast("Lab Watch on — " + analytes.length + " lab" + (analytes.length === 1 ? "" : "s") + ", " + lwModeLabel(mode) + ".");
      openLabWatch();
    }
    if (delivery === "device" || delivery === "both") {
      lwRequestNotifyPermission().then(function (granted) {
        if (!granted) { if (window.toast) toast("Device notifications not enabled — Lab Watch will alert you in-app."); finalize("inapp"); }
        else finalize(delivery);
      });
    } else finalize(delivery);
  }
  function lwStop() { lwSet(null); _lwDraft = null; _lwBadge = 0; if (window.toast) toast("Lab Watch stopped."); openLabWatch(); }
  function lwPause() { var w = lwGet(); if (!w) return; w.paused = !w.paused; lwSet(w); if (window.toast) toast(w.paused ? "Lab Watch paused." : "Lab Watch resumed."); openLabWatch(); }
  function lwEdit() { var w = lwGet(); _lwDraft = w ? { analytes: (w.analytes || []).slice(), mode: w.mode, dur: w.dur, delivery: w.delivery, q: "" } : { analytes: [], mode: "meaningful", dur: 12, delivery: "inapp", q: "" }; openLabWatch(); }
  function lwOpenAnalyte(k) { _lwHighlight = k; _lwBadge = 0; closeForm(); _screen = "patient"; _active = "trends"; _ws = wsOf("trends"); _wsLast[_ws] = "trends"; paint(); setTimeout(function () { try { var el = rootEl && rootEl.querySelector('.icu-tr-card.lw-hi'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }, 60); }
  // Clear an "until discharge" watch when a discharge summary is generated.
  function lwOnDischarge() { var w = lwGet(); if (w && w.untilDischarge) { lwSet(null); } }

  // Bridge to the closed-app background watch (SMD_WATCH, watch-lab.js). The Lab Watch above is
  // per-analyte and fires only while the app is open; this registers a server-side watch that
  // alerts even when the app is fully closed. Consent-gated; needs a signed-in Google/Apple
  // account and a Ward-Sync-linked patient (so the server can poll GHIS for new labs).
  function lwWardPid() { try { return (_raw.wardSync && _raw.wardSync.patientId) || ""; } catch (e) { return ""; } }
  function lwHasPatient() { var p = _raw.patient || {}; return !!(p._id || lwWardPid() || (p.name && String(p.name).trim())); }
  function lwBgAvailable() { return !!(window.SMD_WATCH && window.SMD_AUTH && window.SMD_AUTH.currentUser && lwWardPid()); }
  function lwEnableBackground() {
    if (!(window.SMD_WATCH && window.SMD_AUTH && window.SMD_AUTH.currentUser)) { if (window.toast) toast("Sign in with your Google/Apple account for alerts when the app is closed."); return; }
    var pid = lwWardPid();
    if (!pid) { if (window.toast) toast("Open this patient from Ward Sync first — background alerts poll GHIS."); return; }
    var p = _raw.patient || {}, name = p.name || (_raw.wardSync && _raw.wardSync.name) || "patient";
    try { if (window.SMD_enableNativePush) window.SMD_enableNativePush(); } catch (e) {}
    try {
      window.SMD_WATCH.enableWithConsent({ patientId: pid, episodeId: (_raw.wardSync && _raw.wardSync.episodeId) || undefined, name: name })
        .then(function (r) { if (r && r.ok && window.toast) toast("Background alerts on — you’ll be alerted even when the app is closed."); })
        .catch(function () {});
    } catch (e) {}
  }
  function lwOpenManager() { if (window.SMD_WATCH && window.SMD_WATCH.openManager) window.SMD_WATCH.openManager(); else if (window.toast) toast("Sign in to view watched patients."); }

  function lwGroupChip(grp, sel) {
    var inGrp = grp.keys.filter(function (k) { return TREND_INTERP[k]; });
    var all = inGrp.length && inGrp.every(function (k) { return sel.indexOf(k) >= 0; });
    return '<button class="icu-lw-grpall' + (all ? " on" : "") + '" data-icu-act="lwgrp:' + grp.id + '">' + (all ? "✓ " : "") + esc(grp.name) + '</button>';
  }
  function lwListHTML(d) {
    var sel = d.analytes || [], q = (d.q || "").trim();
    var total = 0; TREND_GROUPS.forEach(function (grp) { grp.keys.forEach(function (k) { if (TREND_INTERP[k]) total++; }); });
    var ctrl = '<div class="icu-lw-allrow" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">' +
      '<button class="icu-lw-grpall' + (total && sel.length >= total ? " on" : "") + '" data-icu-act="lwall">' + (total && sel.length >= total ? "✓ " : "") + 'Select all</button>' +
      '<button class="icu-lw-grpall" data-icu-act="lwclear">Clear</button>' +
      '<span style="margin-left:auto;font:600 11.5px var(--font,system-ui);color:var(--muted,#94a3b8)">' + sel.length + ' / ' + total + ' selected</span>' +
      '</div>';
    var groups = TREND_GROUPS.map(function (grp) {
      var keys = grp.keys.filter(function (k) { return TREND_INTERP[k] && lwAnalyteMatch(k, q); });
      if (!keys.length) return "";
      var chips = keys.map(function (k) {
        var on = sel.indexOf(k) >= 0, m = TREND_INTERP[k];
        return '<button class="icu-lw-an' + (on ? " on" : "") + '" data-icu-act="lwtog:' + k + '" aria-pressed="' + on + '">' + (on ? "✓ " : "") + esc(m.label) + '</button>';
      }).join("");
      return '<div class="icu-lw-grp"><div class="icu-lw-grp-h">' + lwGroupChip(grp, sel) + '</div><div class="icu-lw-chips">' + chips + '</div></div>';
    }).join("");
    return ctrl + (groups || '<div class="icu-lw-none">No lab matches “' + esc(q) + '”.</div>');
  }
  function lwSetupHTML(d) {
    var seg = function (act, val, cur, label) { return '<button class="icu-lw-seg' + (String(cur) === String(val) ? " on" : "") + '" data-icu-act="' + act + ':' + val + '">' + esc(label) + '</button>'; };
    var bgRow = '<div class="icu-lw-bg">' +
      (lwBgAvailable()
        ? '<button class="icu-btn ghost" data-icu-act="lwbg">' + ico("bell", "🔔") + ' Turn on Lab Watch 24/7 (even when closed)</button>'
        : '<div class="icu-lw-hint">Tip: open this patient from Ward Sync (signed in) to also get alerts when the app is closed.</div>') +
      '<button class="icu-btn ghost" data-icu-act="lwmgr">View Lab Watch 24/7 list</button></div>';
    return '<div class="icu-sheet icu-lw-sheet"><h3>' + ico("bell", "🔔") + ' Lab Watch</h3>' +
      '<p class="icu-doc-sub">Watch this patient’s labs. When Ward Sync brings a new result you’ll get an alert here in the app. For alerts even when StewardMD is fully closed, use <b>Background alerts</b> below.</p>' +
      '<input id="icuLwq" type="search" autocomplete="off" placeholder="Search a lab — e.g. potassium, creatinine, CRP…" value="' + esc(d.q || "") + '" style="width:100%;box-sizing:border-box;font:600 15px var(--font);padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);margin-bottom:10px">' +
      '<div id="icuLwList" class="icu-lw-list">' + lwListHTML(d) + '</div>' +
      '<div class="icu-lw-opts">' +
        '<div class="icu-lw-opt"><label>Alert me on</label><div class="icu-lw-segs">' + seg("lwmode", "critical", d.mode, "Critical only") + seg("lwmode", "meaningful", d.mode, "Meaningful changes") + seg("lwmode", "every", d.mode, "Every result") + '</div></div>' +
        '<div class="icu-lw-opt"><label>Keep watching</label><div class="icu-lw-segs">' + seg("lwdur", "6", d.dur, "6 h") + seg("lwdur", "12", d.dur, "12 h") + seg("lwdur", "24", d.dur, "24 h") + seg("lwdur", "stop", d.dur, "Until I stop") + seg("lwdur", "discharge", d.dur, "Until discharge") + '</div></div>' +
        '<div class="icu-lw-opt"><label>Alerts</label><div class="icu-lw-segs">' + seg("lwdeliv", "inapp", d.delivery, "In-app") + seg("lwdeliv", "both", d.delivery, "In-app + device") + '</div>' +
          ((d.delivery === "both" || d.delivery === "device") ? '<div class="icu-lw-hint">Device banners appear while the app is open (you’ll be asked for permission once). For alerts when the app is fully closed, turn on <b>Background alerts</b> below.</div>' : '') + '</div>' +
      '</div>' +
      bgRow +
      '<div class="icu-lw-count">' + ((d.analytes || []).length) + ' lab' + ((d.analytes || []).length === 1 ? '' : 's') + ' selected · ' + lwModeLabel(d.mode || "meaningful") + ' · ' + lwDurLabel(d.dur != null ? d.dur : 12) + '</div>' +
      '<button class="icu-btn" data-icu-act="lwstart">' + ico("bell", "🔔") + ' Start Lab Watch</button>' +
      (lwGet() ? '<button class="icu-btn ghost" data-icu-act="labwatch">Back</button>' : '<button class="icu-btn ghost" data-icu-act="lwcancel">Cancel</button>') + '</div>';
  }
  function lwActivityHTML(w) {
    var acts = (w.activity || []);
    if (!acts.length) return '<div class="icu-lw-empty">No new results yet. You’ll see them here the moment Ward Sync brings them in.</div>';
    return '<div class="icu-lw-acts">' + acts.slice(0, 30).map(function (a) {
      var cls = a.kind === "critical" ? "crit" : a.kind === "change" ? "chg" : "new";
      return '<button class="icu-lw-act ' + cls + '" data-icu-act="lwopen:' + a.analyte + '"><span class="icu-lw-act-t">' + esc(a.text) + '</span><span class="icu-lw-act-w">' + esc(fmtWhen(a.ts)) + ' · tap to view trend</span></button>';
    }).join("") + '</div>';
  }
  function lwStatusHTML(w) {
    var expired = lwExpired(w), sel = (w.analytes || []);
    var chips = sel.map(function (k) { return '<span class="icu-lw-tag">' + esc((TREND_INTERP[k] || {}).label || k) + '</span>'; }).join("");
    var state = expired ? '<span class="icu-lw-state exp">Expired</span>' : w.paused ? '<span class="icu-lw-state pause">Paused</span>' : '<span class="icu-lw-state on">Watching</span>';
    return '<div class="icu-sheet icu-lw-sheet"><h3>' + ico("bell", "🔔") + ' Lab Watch ' + state + '</h3>' +
      '<div class="icu-lw-meta">' + sel.length + ' lab' + (sel.length === 1 ? '' : 's') + ' · ' + esc(lwModeLabel(w.mode)) + ' · ' + esc(lwRemaining(w)) + ' · ' + (w.delivery === "both" ? "in-app + device" : "in-app") + '</div>' +
      '<div class="icu-lw-tags">' + chips + '</div>' +
      '<div class="icu-lw-banner">In-app monitoring ' + (expired ? 'has ended' : w.paused ? 'is paused' : 'is active') + ' — alerts appear while StewardMD is open. For alerts when it’s fully closed, use Background alerts.</div>' +
      (lwBgAvailable() ? '<button class="icu-btn ghost" data-icu-act="lwbg">' + ico("bell", "🔔") + ' Turn on Lab Watch 24/7 (even when closed)</button>' : '') +
      '<button class="icu-btn ghost" data-icu-act="lwmgr">View Lab Watch 24/7 list</button>' +
      '<div class="icu-sec-lbl">' + ico("bell", "🔔") + ' Activity</div>' + lwActivityHTML(w) +
      '<div class="icu-lw-btns">' +
        (expired ? '<button class="icu-btn" data-icu-act="lwedit">Restart</button>' : '<button class="icu-btn" data-icu-act="lwpause">' + (w.paused ? "Resume" : "Pause") + '</button>') +
        '<button class="icu-btn ghost" data-icu-act="lwedit">Edit</button>' +
        '<button class="icu-btn ghost" data-icu-act="lwstop">Stop</button>' +
      '</div>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
  }
  function openLabWatch() {
    if (!labWatchOn()) { if (window.toast) toast("Lab Watch is turned off."); return; }
    injectCSS(); ensureModal();
    var w = lwGet();
    if (_lwDraft) { modalEl.innerHTML = lwSetupHTML(_lwDraft); }
    else if (w) { _lwBadge = 0; modalEl.innerHTML = lwStatusHTML(w); }
    else { _lwDraft = { analytes: [], mode: "meaningful", dur: 12, delivery: "inapp", q: "" }; modalEl.innerHTML = lwSetupHTML(_lwDraft); }
    modalEl.classList.add("on");
    var q = modalEl.querySelector("#icuLwq");
    if (q) q.oninput = function () { _lwDraft.q = q.value; var list = modalEl.querySelector("#icuLwList"); if (list) list.innerHTML = lwListHTML(_lwDraft); };
  }

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
      rows.push(["Expected PaCO₂", expA.toFixed(0) + " ± 5 mmHg (actual " + pco2 + ")"]);
      comp = pco2 < expA - 5 ? "Added respiratory alkalosis" : pco2 > expA + 5 ? "Added respiratory acidosis" : "Appropriate respiratory compensation";
    } else if (/Respiratory/.test(primary)) {
      comp = "Assess acute vs chronic by the HCO₃ shift (acute ≈1, chronic ≈3.5 mEq/L per 10 mmHg PaCO₂).";
    }
    if (L.na != null && L.cl != null) {
      var ag = L.na - (L.cl + hco3), agc = ag;
      if (L.alb != null) agc = ag + 2.5 * (4.0 - L.alb);     // albumin-corrected AG; albumin in g/dL (normal ~4.0)
      var agShown = L.alb != null ? agc : ag;
      rows.push(["Anion gap" + (L.alb != null ? " (albumin-corrected)" : ""), agShown.toFixed(0) + " mEq/L"]);
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
    if (g.pao2 != null && g.fio2) { var pf = Math.round(g.pao2 / (g.fio2 / 100)); rows.push(["P/F ratio", pf + (pf < 100 ? " (severe hypoxaemia)" : pf < 200 ? " (moderate hypoxaemia)" : pf < 300 ? " (mild hypoxaemia)" : "")]); }
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
    var pressors = (inf || []).filter(function (i) { return isPressor(i.drug); });
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
  // `ex` = a short worked example shown as the note-box placeholder, so a clinician unsure what to
  // record for an item sees the kind of thing to jot. Examples only — never auto-filled.
  var ROUNDS_ITEMS = [
    { k: "general", g: "General", label: "Overnight events / trajectory reviewed", ex: "e.g. Stable overnight; one self-resolving desat to 88%; overall improving — continue weaning support." },
    { k: "airway", g: "Airway", label: "Airway secure / ETT position & cuff", ex: "e.g. ETT 22 cm at lips, cuff 25 cmH₂O, well secured; CXR tip ~3 cm above carina." },
    { k: "breathing", g: "Breathing", label: "Ventilation & oxygenation reviewed", ex: "e.g. SIMV, tolerating wean; SpO₂ 96% on FiO₂ 0.4, PEEP 6; plan SBT tomorrow." },
    { k: "circulation", g: "Circulation", label: "Haemodynamics & pressors reviewed", ex: "e.g. MAP 72 off noradrenaline since 06:00; lactate cleared to 1.4." },
    { k: "fluids", g: "Fluids", label: "Fluid balance & strategy set", ex: "e.g. Net +1.2 L/24h; now deresuscitating — target −500 mL/day, furosemide 20 mg BD." },
    { k: "renal", g: "Renal", label: "Renal function / RRT need", ex: "e.g. Creatinine 1.8 stable, UO 0.6 mL/kg/h; no RRT needed today." },
    { k: "lytes", g: "Electrolytes", label: "Electrolytes corrected / monitored", ex: "e.g. K 3.2 → 40 mmol KCl replaced, recheck 14:00; Mg 1.8 topped up." },
    { k: "abg", g: "ABG", label: "Acid–base reviewed", ex: "e.g. pH 7.32 / pCO₂ 48 / HCO₃ 24 — compensated respiratory acidosis, improving." },
    { k: "nutrition", g: "Nutrition", label: "Feeding plan (enteral preferred)", ex: "e.g. NG feed 40 mL/h, tolerating; target 25 kcal/kg; no high gastric residuals." },
    { k: "sedation", g: "Sedation", label: "Sedation target / daily interruption", ex: "e.g. RASS target −1 to 0; daily sedation hold done — follows commands." },
    { k: "pain", g: "Pain", label: "Analgesia & delirium (CAM-ICU) assessed", ex: "e.g. CPOT 2, fentanyl PRN adequate; CAM-ICU negative." },
    { k: "cultures", g: "Cultures", label: "Cultures / micro results reviewed", ex: "e.g. Blood cultures NG at 48h; urine — E. coli sensitive to nitrofurantoin." },
    { k: "antibiotics", g: "Antibiotics", label: "Antibiotic indication / de-escalation / stop date", ex: "e.g. Day 4 pip-tazo for HAP; de-escalate to co-amoxiclav; stop date day 7." },
    { k: "dvt", g: "Prophylaxis", label: "DVT prophylaxis prescribed", ex: "e.g. Enoxaparin 40 mg SC OD; no active bleeding / contraindication." },
    { k: "ulcer", g: "Prophylaxis", label: "Stress-ulcer prophylaxis reviewed", ex: "e.g. Pantoprazole 40 mg IV OD while ventilated; review once feeding established." },
    { k: "lines", g: "Lines", label: "Central/arterial lines — still needed?", ex: "e.g. R IJ CVC day 5, site clean, still needed for pressors; a-line day 3." },
    { k: "catheter", g: "Catheters", label: "Urinary catheter — still needed?", ex: "e.g. IDC day 4 — still needed for strict UO; reassess for removal tomorrow." },
    { k: "drains", g: "Drains", label: "Drains reviewed", ex: "e.g. R chest drain 50 mL serous/24h, no air leak — consider removal." },
    { k: "family", g: "Family", label: "Family updated / counselling", ex: "e.g. Updated wife by phone 11:00 re: slow improvement; goals-of-care talk planned." },
    { k: "disposition", g: "Disposition", label: "Disposition / step-down plan", ex: "e.g. If extubated and off pressors, step down to HDU tomorrow." }
  ];
  // Plain-text of an imaging study's AI assist summary (for the daily summary export, clearly
  // labelled advisory). Uses the stored structured summary (rec.assist.data) when present.
  function imgAssistText(rec) {
    var a = rec && rec.assist; if (!a) return "";
    var d = a.data || {}, parts = [];
    var head = (typeof a.summary === "string" && a.summary) || (typeof d.summary === "string" && d.summary) || "";
    if (head) parts.push(head.replace(/\s+/g, " ").trim());
    function sec(label, arr) { if (Array.isArray(arr) && arr.length) parts.push(label + ": " + arr.map(function (x) { return String(x).replace(/\s+/g, " ").trim(); }).join("; ")); }
    sec("Key positives", d.positives);
    sec("Differential considerations", d.differentials);
    sec("Correlate with", d.correlateWith);
    sec("Urgent red flags", (Array.isArray(d.redFlags) && d.redFlags.length) ? d.redFlags : (rec.critical || []));
    sec("Suggested next checks", d.nextChecks);
    return parts.join("\n  ");
  }
  function buildSummary(st) {
    var s = st || _raw, p = s.patient || {}, vits = s.vitals || [], lv = latestByTs(s.vitals), L = s.labs && s.labs.recent || {}, g = s.abg || {}, f = s.fluids || {}, v = s.ventilator || {}, mp = (lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp)), rounds = s.rounds || {}, alerts = s.alerts || [], goals = s.goals || [], infusions = s.infusions || [], out = [];   // BUG #6: latest vital by max ts, not last-pushed
    out.push("STEWARDMD — DAILY ICU SUMMARY");
    out.push((p.name || "ICU patient") + (p.age != null ? ", " + p.age + "y" : "") + (p.sex ? " " + p.sex : "") + (p.bed ? " · Bed " + p.bed : "") + (p.icuDay != null ? " · ICU day " + p.icuDay : ""));
    if (p.diagnosis) out.push("Diagnosis: " + p.diagnosis);
    var finds = s.findings || [];
    if (finds.length) out.push("CLINICAL FINDINGS: " + finds.map(function (c) { return findChipLabel(c); }).join("; "));
    out.push("");
    out.push("HAEMODYNAMICS: HR " + (lv.hr != null ? lv.hr : "—") + ", BP " + (lv.sbp != null ? lv.sbp + "/" + lv.dbp : "—") + ", MAP " + (mp != null ? mp : "—") + ", lactate " + (lv.lactate != null ? lv.lactate : "—") + (infusions.length ? ", pressors/infusions: " + infusions.map(function (i) { return i.drug; }).join(", ") : ""));
    if (g.ph != null) { var ab = analyzeABG(g, L); out.push("ABG: pH " + g.ph + " / pCO₂ " + g.paco2 + " / HCO₃ " + g.hco3 + (ab ? " → " + ab.primary : "")); }
    var keyL = ["na", "k", "creat", "hb", "plt", "ferritin"].filter(function (k) { return L[k] != null; }).map(function (k) { return k.toUpperCase() + " " + L[k]; });
    if (keyL.length) out.push("LABS: " + keyL.join(", "));
    if (f.net24h != null || f.cumulative != null) out.push("FLUIDS: net 24h " + (f.net24h != null ? f.net24h + " mL" : "—") + ", cumulative " + (f.cumulative != null ? f.cumulative + " mL" : "—"));
    if (v.mode) out.push("VENT: " + v.mode + (v.fio2 ? ", FiO₂ " + v.fio2 + "%" : "") + (v.peep != null ? ", PEEP " + v.peep : "") + (v.tv != null ? ", TV " + v.tv + " mL" : ""));
    var imgs = (s.imaging || []).filter(function (r) { return !r.hidden && (r.inSummary || r.reviewed); });
    // Handover shows the radiologist's VERBATIM impression. An AI summary is included ONLY for a
    // study the clinician explicitly added via "Add to Daily Summary", and is CLEARLY LABELLED as
    // advisory (not the radiologist report) — it is added alongside, never supplanting, the impression.
    if (imgs.length) out.push("\nIMPORTANT IMAGING:\n" + imgs.map(function (r) { return "• " + (r.modality || "Imaging") + (r.reportDateTime ? " (" + imgFmtDate(r.reportDateTime) + ")" : "") + ": " + String(r.impressionRaw || r.findingsRaw || r.reportRaw || "").replace(/\s+/g, " ").trim().slice(0, 240) + ((r.critical || []).length ? "  [⚠ flagged: " + r.critical.join(", ") + " — verify]" : ""); }).join("\n"));
    var aiImgs = imgs.filter(function (r) { return r.inSummary && imgAssistText(r); });
    if (aiImgs.length) out.push("\nAI IMAGING SUMMARY (advisory — clinician-reviewed; NOT the radiologist report):\n" + aiImgs.map(function (r) { return "• " + (r.modality || "Imaging") + ":\n  " + imgAssistText(r); }).join("\n"));
    if (alerts.length) out.push("\nACTIVE ALERTS:\n" + alerts.map(function (a) { return "• [" + a.severity.toUpperCase() + "] " + a.title + " — " + a.msg; }).join("\n"));
    var pend = ROUNDS_ITEMS.filter(function (it) { return !(rounds[it.k] && rounds[it.k].done); });
    if (pend.length) out.push("\nROUNDS PENDING: " + pend.map(function (it) { return it.label; }).join("; "));
    var notes = ROUNDS_ITEMS.filter(function (it) { return rounds[it.k] && rounds[it.k].note; }).map(function (it) { return "• " + it.label + ": " + rounds[it.k].note; });
    if (notes.length) out.push("\nROUNDS NOTES:\n" + notes.join("\n"));
    if (goals.length) out.push("\nGOALS:\n" + goals.map(function (x) { return "• " + x; }).join("\n"));
    out.push("\n— Decision support only; verify against the patient. StewardMD ICU.");
    return out.join("\n");
  }

  // Build a Situation / Background / Assessment / Recommendation shift handover from RECORDED state.
  // Every line is derived from data the clinician entered or synced — never invented — and the SBAR
  // is advisory (reviewed before handover). This is the redesign's Documents -> Handover card, made
  // real (the prototype only had seed data). Returns [{label,color,body}] in S-B-A-R order.
  function buildSBAR(st) {
    var s = st || _raw, p = s.patient || {};
    var snap = v2Snapshot(s), sev = v2Severity(s), reason = v2Reason(snap);
    var L = (s.labs && s.labs.recent) || {}, g = s.abg || {};
    var infusions = s.infusions || [], press = infusions.filter(function (i) { return isPressor(i.drug); });
    var finds = s.findings || [], goals = s.goals || [];
    var crit = (s.alerts || []).filter(function (a) { return a.severity === "critical"; });
    var dx = p.workingDx || p.diagnosis || "";

    var who = [];
    if (p.age != null) who.push(p.age + (p.sex ? String(p.sex).charAt(0).toUpperCase() : "y"));
    else if (p.sex) who.push(String(p.sex));
    if (p.icuDay != null) who.push("ICU day " + p.icuDay);
    if (p.bed) who.push("Bed " + p.bed);

    // SITUATION — who, working diagnosis, current acuity.
    var sit = [];
    if (who.length) sit.push(who.join(", "));
    if (dx) sit.push(dx);
    sit.push("Currently " + String(V2_LABEL[sev] || "stable").toLowerCase() + (reason ? " (" + reason + ")" : "") + ".");
    // BACKGROUND — complaints, structured findings, active infusions.
    var bg = [];
    if (p.complaints) bg.push(String(p.complaints));
    if (finds.length) bg.push("Findings: " + finds.slice(0, 8).map(function (c) { return findChipLabel(c); }).join(", "));
    if (infusions.length) bg.push("On " + infusions.map(function (i) { return i.drug; }).join(", "));
    // ASSESSMENT — current haemodynamics, ABG, key labs, trajectory.
    var asmt = ["HR " + (snap.hr != null ? snap.hr : "—") + ", MAP " + (snap.map != null ? snap.map : "—") + ", SpO₂ " + (snap.spo2 != null ? snap.spo2 + "%" : "—") + ", lactate " + (snap.lactate != null ? snap.lactate : "—") + (press.length ? " on " + press.length + " pressor" + (press.length > 1 ? "s" : "") : "")];
    if (g.ph != null) { var ab = analyzeABG(g, L); asmt.push("ABG pH " + g.ph + (g.paco2 != null ? " / pCO₂ " + g.paco2 : "") + (g.hco3 != null ? " / HCO₃ " + g.hco3 : "") + (ab && ab.primary ? " → " + ab.primary : "")); }
    var keyL = ["na", "k", "creat", "hb", "plt", "crp", "lactate"].filter(function (k) { return L[k] != null; }).map(function (k) { return k.toUpperCase() + " " + L[k]; });
    if (keyL.length) asmt.push("Labs: " + keyL.join(", "));
    asmt.push(sev === "stable" ? "Clinically stable." : (sev === "review" ? "Needs review" : "Not yet stabilised") + (reason ? " — " + reason : "") + ".");
    // RECOMMENDATION — goals, active criticals, pending rounds, escalation thresholds.
    var rec = [];
    if (goals.length) rec.push("Today's goals: " + goals.slice(0, 5).join("; "));
    if (crit.length) rec.push("Active critical: " + crit.map(function (a) { return a.title; }).join("; "));
    var rnds = s.rounds || {}, pend = ROUNDS_ITEMS.filter(function (it) { return !(rnds[it.k] && rnds[it.k].done); });
    if (pend.length) rec.push("Pending rounds: " + pend.slice(0, 6).map(function (it) { return it.label; }).join(", "));
    rec.push("Escalate if MAP < 65, SpO₂ < 90%, rising lactate, or urine output < 0.5 mL/kg/h.");

    return [
      { label: "Situation", color: "#0F766E", body: sit.join(". ") },
      { label: "Background", color: "#64748B", body: bg.length ? bg.join(". ") : "No background recorded yet." },
      { label: "Assessment", color: "#92620A", body: asmt.join(". ") },
      { label: "Recommendation", color: (sev === "critical" ? "#B91C1C" : sev === "review" ? "#92620A" : "#15803D"), body: rec.join(". ") }
    ];
  }

  /* --------------------------------------------------------------- tabs */
  var TABS = [
    { id: "overview", ic: "❤️", svg: "pulse", label: "Overview" },
    { id: "hemo", ic: "🫀", svg: "hemo", label: "Hemo" },
    { id: "fluids", ic: "💧", svg: "droplet", label: "Fluids" },
    { id: "lytes", ic: "🧪", svg: "flask", label: "Lytes" },
    { id: "abg", ic: "🩸", svg: "abg", label: "ABG" },
    { id: "infusions", ic: "💉", svg: "syringe", label: "Infusions" },
    { id: "protocols", ic: "🚨", svg: "siren", label: "Protocols" },
    { id: "vent", ic: "🫁", svg: "lungs", label: "Vent" },
    { id: "trends", ic: "📈", svg: "trend", label: "Trends" },
    { id: "rounds", ic: "📋", svg: "rounds", label: "Rounds" },
    { id: "goals", ic: "🎯", svg: "check", label: "Goals" },
    { id: "documents", ic: "📄", svg: "copy", label: "Documents" },
    { id: "more", ic: "⋯", svg: "more", label: "More" }
  ];
  // 5 grouped workspaces for the bottom bar (mobile-friendly). Each opens a segmented
  // sub-nav of its members; members are the existing per-tab render keys (+ 3 new light
  // views) so every section and its saved data is preserved — this is a NAV layer only.
  var WORKSPACES = [
    { id: "overview", label: "Overview", svg: "pulse", members: ["overview", "rounds"] },
    { id: "monitoring", label: "Monitoring", svg: "heart", members: ["vitals", "trends", "hemo", "fluids", "lytes", "abg", "vent", "infusions"] },
    { id: "careplan", label: "Care Plan", svg: "rounds", members: ["dx", "treatment", "protocols", "goals", "interactions"] },
    { id: "documents", label: "Documents", svg: "copy", members: ["documents", "imaging", "handover", "discharge"] },
    { id: "more", label: "More", svg: "more", members: ["more"] }
  ];
  var MEMBER = {}; TABS.forEach(function (t) { MEMBER[t.id] = { label: t.label, svg: t.svg, ic: t.ic }; });
  MEMBER.dx = { label: "Diagnosis", svg: "search", ic: "🩺" };
  MEMBER.imaging = { label: "Imaging", svg: "camera", ic: "🩻" };
  MEMBER.documents = { label: "Summary", svg: "copy", ic: "📄" };        // Documents sub-tab 1 — "Summary" (design docTabs order: Summary·Imaging·Handover·Discharge)
  MEMBER.vitals = { label: "Vitals", svg: "pulse", ic: "❤️" };          // Monitoring sub-tab — Live Patient Status grid
  MEMBER.interactions = { label: "Interactions", svg: "warn", ic: "⚠️" }; // Care Plan sub-tab — drug interactions
  MEMBER.handover = { label: "Handover", svg: "copy", ic: "⇄" };        // Documents sub-tab — SBAR shift handover
  MEMBER.discharge = { label: "Discharge", svg: "rounds", ic: "📝" };    // Documents sub-tab — Discharge Creator + remove patient
  MEMBER.treatment = { label: "Treatment", svg: "syringe", ic: "💊" };   // Care Plan sub-tab — editable Current Treatment (drug DB + custom; any doctor add/remove; timeline-logged)
  // Treatment categories (colour-coded), shared by RENDER.treatment + the add composer.
  var TX_CATS = [
    { k: "abx",   label: "Antibiotics", color: "var(--danger)" },
    { k: "fluid", label: "Fluids",      color: "var(--primary)" },
    { k: "supp",  label: "Supportive",  color: "var(--warn)" },
    { k: "other", label: "Other",       color: "var(--muted)" }
  ];
  var TX_FREQS = ["OD", "BD", "TDS", "QID", "q6h", "q8h", "q12h", "STAT", "infusion", "SOS"];
  function txCatLabel(k) { for (var i = 0; i < TX_CATS.length; i++) if (TX_CATS[i].k === k) return TX_CATS[i].label; return "Other"; }
  var _txDraft = null;   // add-treatment composer draft { name, dose, route, freq, cat }
  var _txHits = [];      // transient drug-DB search results (indexed by txpick:N)
  function wsOf(m) { for (var i = 0; i < WORKSPACES.length; i++) if (WORKSPACES[i].members.indexOf(m) >= 0) return WORKSPACES[i].id; return "overview"; }
  function wsById(id) { for (var i = 0; i < WORKSPACES.length; i++) if (WORKSPACES[i].id === id) return WORKSPACES[i]; return WORKSPACES[0]; }
  // Workspace members visible under the current feature flags (Imaging is flag-gated,
  // so the kill-switch hides it from the sub-nav instantly — no reload).
  function wsMembers(w) { return (w && w.members || []).filter(function (m) { if (m === "imaging") return icuImagingOn(); if (m === "vent" && _wardMode) return false; return true; }); }
  function isMonWs() { return _ws === "overview" || _ws === "monitoring"; }
  var _active = "overview";
  var _ws = "overview";        // current workspace (bottom bar)
  var _wsLast = {};            // workspace id → last member viewed in it
  var _screen = "board";       // v2 only: "board" | "patient" | "alerts" | "team"
  // (_unit / _wardMode / ctxLabel + the unit model are declared near LS_KEY so the buffer key resolves
  //  to the right unit at module load. Ward mode = _unit.cat === "ward".)
  var _admitting = false;      // true while an Admit-opened patient form is up; cancelling it with no data returns to the board (not a blank patient page)
  var _v2Filter = "all";       // v2 board acuity filter: "all" | "critical" | "review" | "stable"
  var _imgFilter = "all";      // Imaging Notes filter bucket
  var _imgOpen = {};           // imaging card index → expanded (full report)
  // ---- ICU v2 group mode (smd_icu_groups, Phase 2) — live-collaboration state ----
  var _grp = null;             // active group {id,name,unit,hospital,roles,members,myRole} | null
  var _grpList = null;         // this user's groups (null = not loaded yet)
  var _grpPatients = null;     // live board list from Firestore (null = loading)
  var _grpPtId = null;         // open shared-patient doc id
  var _grpPtVM = null;         // {patient,timeline,tasks} live view-model for the open patient
  var _grpPresence = [];       // live viewers (excl. self)
  var _grpErr = null;          // last collab error text (inline degrade; never crashes the board)
  var _grpLastHash = null;     // last-synced patient-state hash (mirror echo-suppression)
  var _grpMirrorT = null;      // debounce timer for the ICU_STATE → Firestore mirror
  var _grpSubGroups = null, _grpSubPts = null, _grpSubPt = null, _grpSubPres = null;
  var _grpTaskSubs = {};       // pid -> unsub for the board's READ-ONLY per-patient open-task listeners (no writes → can't loop)
  var _grpTaskOpen = {};       // pid -> live open-task count, rendered as a board-card badge
  // ---- ICU v2 group mode Phase 5 (doctor identity + membership subcollection + invites) ----
  var _grpMembers = null;      // live unit roster from subscribeMembers [{uid,role,name,...}] (null = loading)
  var _grpSubMembers = null;   // members subscription teardown
  var _grpDoctorId = null;     // my StewardMD Doctor ID (SMD-XXXXXX), minted lazily under the flag
  var _grpInvRole = "junior_resident";   // invite-link role picker draft (LINK roles only)
  var _grpInvLink = null;      // last generated invite URL (shown + copyable in the sheet)
  var _grpJoinPending = null;  // stashed ?icujoin= raw value while signed out (processed after sign-in)
  var _grpJoinConfirm = null;  // pending invite awaiting the user's confirm {gid,code,inv}
  // ---- ICU v2 Phase 3 (round-note composer + auto-timeline + smart notifications) ----
  var _grpPrevSync = null;     // last-synced mirror payload — the auto-timeline diff baseline (null = no baseline yet)
  var _roundSel = {};          // round-note composer: preset index → chosen (true)
  var _roundExtra = [];        // round-note composer: custom instructions the user added
  var _roundText = "";         // round-note composer: current "add your own" input (kept across re-renders)
  var _grpNotifiedTs = 0;      // best-effort device-notify de-dupe: newest critical ts already notified
  var _grpOverdueNotified = {}; // taskId → true once we've locally notified/escalated its overdue
  // Task priority → time window before it's overdue (+ display). Consultant sets it when instructing.
  var TASK_PRIORITY = {
    immediate: { label: "Immediate", short: "NOW", sub: "act now", ms: 15 * 60000, color: "#B91C1C" },
    high:      { label: "High", short: "<4h", sub: "within 4 hours", ms: 4 * 3600000, color: "#92620A" },
    moderate:  { label: "Moderate", short: "<12h", sub: "within 12 hours", ms: 12 * 3600000, color: "#0F766E" },
    low:       { label: "Low", short: "24h", sub: "within 24 hours", ms: 24 * 3600000, color: "#15803D" }
  };
  var PRIORITY_ORDER = ["immediate", "high", "moderate", "low"];
  var _roundPriority = "high"; // round-note composer: selected priority for the instructions being posted
  var _roundOnBehalf = null;   // round-note composer: uid the instruction is attributed to (null = me). Lets a resident log a consultant's verbal order under the consultant's name.
  var _tlAll = false;          // timeline: show the FULL history (all events) vs the recent slice

  // Plain-language explanations for ICU jargon (A5) — content only, no logic change.
  var JARGON = {
    pf: ["P/F ratio", "How well the lungs oxygenate — arterial oxygen (PaO₂) divided by inspired oxygen fraction (FiO₂). Below 300 suggests ARDS; below 100 is severe."],
    rsbi: ["RSBI", "Rapid Shallow Breathing Index — breaths per minute ÷ tidal volume (in litres). Below 105 predicts a patient is likely to pass a breathing trial and be ready to wean off the ventilator."],
    dp: ["Driving pressure", "Plateau pressure minus PEEP — the pressure swing that actually inflates the lungs with each breath. Above 15 cmH₂O is linked to higher mortality in ARDS."],
    si: ["Shock index", "Heart rate ÷ systolic blood pressure. Above 0.9 can flag early (occult) shock before the blood pressure visibly falls."],
    delta: ["Δ-ratio", "Change in anion gap ÷ change in bicarbonate (ΔAG/ΔHCO₃). Detects a second acid–base disorder hidden behind a high-anion-gap acidosis: below 0.4 or above 2 suggests a mixed picture."],
    ag: ["Anion gap", "Sodium − (chloride + bicarbonate) — estimates unmeasured acids in the blood. Above 12 (corrected for albumin) points to acids such as lactate, ketones, or toxins."]
  };
  function jargonKey(label) {
    var l = String(label || "").toLowerCase();
    if (/p\/f/.test(l)) return "pf";
    if (/rsbi/.test(l)) return "rsbi";
    if (/driving pressure/.test(l)) return "dp";
    if (/shock index/.test(l)) return "si";
    if (/delta ratio|Δ-?ratio/.test(l)) return "delta";
    if (/anion gap/.test(l)) return "ag";
    return null;
  }
  function infoDot(key) { return ' <button class="icu-tip" data-icu-act="tip:' + key + '" aria-label="What does this mean?" title="What does this mean?">ⓘ</button>'; }
  function row(label, val, unit) { var jk = jargonKey(label); return '<div class="icu-row"><span>' + esc(label) + (jk ? infoDot(jk) : "") + '</span><b>' + (val == null || val === "" ? "—" : esc(val) + (unit ? " " + esc(unit) : "")) + "</b></div>"; }
  function showTip(key) {
    var j = JARGON[key]; if (!j) return;
    var old = document.getElementById("icuTipPop"); if (old) { try { old.remove(); } catch (e) {} }
    var pop = document.createElement("div"); pop.id = "icuTipPop"; pop.className = "icu-tip-pop";
    pop.innerHTML = '<div class="icu-tip-h"><span>' + esc(j[0]) + '</span><button class="icu-tip-x" type="button" aria-label="Close">✕</button></div><div class="icu-tip-b">' + esc(j[1]) + '</div>';
    document.body.appendChild(pop);
    requestAnimationFrame(function () { pop.classList.add("on"); });
    function close() { pop.classList.remove("on"); setTimeout(function () { try { pop.remove(); } catch (e) {} }, 220); }
    pop.querySelector(".icu-tip-x").addEventListener("click", close);
    clearTimeout(showTip._t); showTip._t = setTimeout(close, 9000);
  }
  function phaseNote(p, what) { return '<div class="icu-card"><h3>' + esc(what) + '<span class="icu-phase">' + esc(p) + "</span></h3><p>Reads live from the current ICU data. Full decision-support arrives in this phase.</p></div>"; }

  /* ---------------------------------------------- Imaging Notes rendering */
  var IMG_FILTERS = [
    { k: "all", label: "All" },
    { k: "ctmri", label: "CT / MRI" },
    { k: "us", label: "Ultrasound" },
    { k: "xray", label: "X-ray" },
    { k: "cardiac", label: "Cardiac" },
    { k: "endo", label: "Endoscopy" },
    { k: "reviewed", label: "Reviewed" },
    { k: "unreviewed", label: "Unreviewed" }
  ];
  function imgMatches(rec, f) {
    if (f === "all") return true;
    if (f === "reviewed") return !!rec.reviewed;
    if (f === "unreviewed") return !rec.reviewed;
    return rec.category === f;
  }
  function imgClamp(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s; }
  function imagingCard(rec) {
    var eid = encodeURIComponent(rec.id), open = !!_imgOpen[rec.id];
    var crit = (rec.critical || []).length
      ? '<div class="icu-img-crit">' + ico("warn", "⚠️") + ' <b>Potential urgent imaging finding</b> — verify report and escalate per local protocol.<div class="icu-img-crit-t">' + rec.critical.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + '</div></div>'
      : "";
    var imp = rec.impressionRaw || "";
    var impBlock = imp
      ? '<div class="icu-img-imp"><span class="icu-img-k">Impression</span>' + esc(open ? imp : imgClamp(imp, 220)) + "</div>"
      : (rec.reportRaw ? '<div class="icu-img-imp"><span class="icu-img-k">Report</span>' + esc(open ? rec.reportRaw : imgClamp(rec.reportRaw, 220)) + "</div>"
        : '<div class="icu-img-imp" style="color:var(--muted)">Insufficient report detail — open original radiology report.</div>');
    var expanded = open ? (
      (rec.indication ? '<div class="icu-img-sec"><span class="icu-img-k">Clinical indication</span>' + esc(rec.indication) + "</div>" : "") +
      (rec.findingsRaw ? '<div class="icu-img-sec"><span class="icu-img-k">Findings</span>' + esc(rec.findingsRaw) + "</div>" : "") +
      (rec.reportRaw && (rec.impressionRaw || rec.findingsRaw) ? '<div class="icu-img-sec"><span class="icu-img-k">Full report</span><div class="icu-img-raw">' + esc(rec.reportRaw) + "</div></div>" : "") +
      (rec.comment ? '<div class="icu-img-sec"><span class="icu-img-k">Clinician note</span>' + esc(rec.comment) + "</div>" : "")
    ) : "";
    var badges = '<span class="icu-img-badge">' + esc(rec.modality || "Imaging") + "</span>" +
      (rec.parsed ? '<span class="icu-img-tag" title="Sections auto-extracted from the report text — verify">Parsed — verify</span>' : "") +
      (rec.reviewed ? '<span class="icu-img-tag ok">Reviewed</span>' : "") +
      (rec.inSummary ? '<span class="icu-img-tag">In summary</span>' : "");
    var meta = [imgFmtDate(rec.reportDateTime) || "Date not documented", rec.source || "Ward Sync"];
    if (rec.radiologist) meta.push("Dr " + rec.radiologist);
    return '<div class="icu-img-card' + ((rec.critical || []).length ? " crit" : "") + '">' +
      '<button class="icu-img-hd" data-icu-act="imgexpand:' + eid + '"><div class="icu-img-hd-l">' +
        '<div class="icu-img-title">' + esc(rec.studyName || "Imaging Report") + "</div>" +
        '<div class="icu-img-badges">' + badges + "</div>" +
        '<div class="icu-img-meta">' + esc(meta.join(" · ")) + "</div>" +
      '</div><span class="icu-img-chev">' + (open ? "▾" : "▸") + "</span></button>" +
      crit + impBlock + expanded +
      '<div class="icu-img-acts">' +
        '<button class="icu-img-act" data-icu-act="imgexpand:' + eid + '">' + (open ? "Collapse" : "Open full report") + "</button>" +
        '<button class="icu-img-act' + (rec.reviewed ? " on" : "") + '" data-icu-act="imgreview:' + eid + '">' + (rec.reviewed ? "✓ Reviewed" : "Mark reviewed") + "</button>" +
        '<button class="icu-img-act' + (rec.inSummary ? " on" : "") + '" data-icu-act="imgsummary:' + eid + '">' + (rec.inSummary ? "✓ In summary" : "Add to summary") + "</button>" +
        '<button class="icu-img-act" data-icu-act="imgassist:' + eid + '">' + (rec.assist ? "✦ AI Assist ✓" : "✦ AI Assist") + "</button>" +
        '<button class="icu-img-act" data-icu-act="imgedit:' + eid + '">Annotate</button>' +
        '<button class="icu-img-act" data-icu-act="imghide:' + eid + '">Hide</button>' +
      "</div></div>";
  }

  // The ACTUAL loaded build (read from icu.js?v=goldNNN on the <script> tag) — shown in More so a
  // stale native bundle is obvious at a glance (incremental Xcode builds have shipped old public/).
  function icuBuildVer() {
    try { var s = document.querySelector('script[src*="icu.js?v="]'); var m = s && String(s.src).match(/[?&]v=([A-Za-z0-9]+)/); return m ? m[1] : ""; } catch (e) { return ""; }
  }
  // Auto-computed clinical scores panel (Feature B; from _raw.scores + CALC_LINKS suggestions).
  function scoreCalcTitle(id) {
    try { var arr = (window.MEDCALC && MEDCALC._calcs) || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i].title; } catch (e) {}
    return id;
  }
  function renderScoresPanel() {
    var rows = _raw.scores || [];
    var dx = (_raw.patient && (_raw.patient.workingDx || _raw.patient.diagnosis)) || "";
    var linkIds = (window.CALC_LINKS && dx) ? CALC_LINKS.forText(dx) : [];
    var done = {}; rows.forEach(function (r) { done[r.id] = 1; });
    var suggest = linkIds.filter(function (id) { return !done[id]; });
    if (!rows.length && !suggest.length) return "";
    var body = rows.map(function (r) {
      if (r.missing) return '<div class="icu-score miss" data-icu-act="calc:' + esc(r.id) + '"><span class="icu-score-n">' + esc(r.label) + '</span><span class="icu-score-need">needs: ' + esc(r.missing.join(", ")) + '</span></div>';
      var iv = r.interp ? String(r.interp).replace(/<[^>]*>/g, "") : "";
      return '<div class="icu-score" data-icu-act="calc:' + esc(r.id) + '"><span class="icu-score-n">' + esc(r.label) + '</span><span class="icu-score-v">' + esc(String(r.value) + (r.unit ? " " + r.unit : "")) + '</span>' + (iv ? '<span class="icu-score-i">' + esc(iv) + '</span>' : "") + '</div>';
    }).join("");
    var sug = suggest.length ? '<div class="icu-score-sug">Suggested for “' + esc(dx) + '”: ' + suggest.map(function (id) { return '<button type="button" class="icu-score-chip" data-icu-act="calc:' + esc(id) + '">' + esc(scoreCalcTitle(id)) + '</button>'; }).join(" ") + '</div>' : "";
    return '<div class="icu-sec-lbl">📊 Scores</div><div class="icu-card">' + body + sug +
      '<p class="icu-doc-sub" style="margin:8px 0 0">Auto-calculated from entered data — tap any score to open the full calculator and confirm. Decision-support only.</p></div>';
  }

  var RENDER = {
    // Redesign Overview: Current status (author+time) -> Active problems -> Critical alerts ->
    // Rounds & instructions (group) -> Current treatment -> Lab Watch -> Trends -> Goals. Every
    // existing capability is preserved (alerts/trends/goals) and the new design cards fold in.
    overview: function () {
      var p = _raw.patient || {}, alerts = _raw.alerts || [], f = _raw.fluids || {}, v = _raw.ventilator || {};
      var infusions = _raw.infusions || [], press = infusions.filter(function (i) { return isPressor(i.drug); });
      var finds = _raw.findings || [];
      var sev = v2Severity(_raw), reason = v2Reason(v2Snapshot(_raw));
      var updTs = (_raw.meta && _raw.meta.updated) || null;
      var who = v2AccountName();
      if (grpActive() && _grpPtVM && _grpPtVM.patient && _grpPtVM.patient.lastUpdate && _grpPtVM.patient.lastUpdate.byName) who = _grpPtVM.patient.lastUpdate.byName;
      var out = "";

      // 1) Current status (author + time).
      var statusTx = p.status ? p.status : (V2_LABEL[sev] + (reason ? " — " + reason : ""));
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("pulse", "❤️") + ' Current status</div>' +
        '<p class="icu-dx-cur" style="margin:0 0 4px">' + esc(statusTx) + '</p>' +
        '<p class="icu-doc-sub" style="margin:0">' + esc(who) + (updTs ? " · updated " + fmtAgo(updTs) : "") + '</p>' +
        '<button class="icu-btn ghost" data-icu-act="edit:patient" style="margin-top:10px">' + ico("edit", "✎") + ' Update status &amp; details</button></div>';

      // 2) Active problems — colored severity dots + a short note (design parity). Derived from the
      //    working diagnosis + present structured findings.
      var sevDot = { critical: "#B91C1C", review: "#92620A", stable: "#15803D" };
      var probs = [];
      if (p.workingDx || p.diagnosis) probs.push({ name: (p.workingDx || p.diagnosis), color: (sevDot[sev] || "#92620A"), note: (p.icuDay != null ? "Day " + p.icuDay : "") });
      finds.filter(function (c) { return c.polarity !== "absent" && c.canonicalFindingId && String(c.canonicalFindingId).indexOf("note:") !== 0; }).slice(0, 6).forEach(function (c) { probs.push({ name: findChipLabel(c), color: "#92620A", note: "" }); });
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("rounds", "🩺") + ' Active problems</div>' +
        (probs.length ? '<div style="display:flex;flex-direction:column;gap:9px;margin-top:2px">' + probs.map(function (pr) {
          return '<div class="icu-ov-prob"><span class="icu-ov-dot" style="background:' + pr.color + '"></span><span class="icu-ov-prob-nm">' + esc(pr.name) + '</span>' + (pr.note ? '<span class="icu-ov-prob-note">' + esc(pr.note) + '</span>' : "") + '</div>';
        }).join("") + '</div>'
          : '<p class="icu-doc-sub" style="margin:0">No problems recorded yet. Set a working diagnosis in Care Plan.</p>') +
        '<button class="icu-btn ghost" data-icu-act="ws:careplan" style="margin-top:10px">' + ico("search", "🩺") + ' Open Care Plan</button></div>';

      // 3) Last consultant instruction (group) — teal card + prominent "View N open tasks".
      if (grpActive() && _grpPtVM) {
        var gtasks = _grpPtVM.tasks || [], gopen = gtasks.filter(function (t) { return t.status !== "done"; }).length;
        var latest = null; gtasks.forEach(function (t) { if (!latest || (t.ts || 0) > (latest.ts || 0)) latest = t; });
        out += '<div class="icu-card icu-ov-instr"><div class="icu-sec-lbl" style="color:var(--primary);margin-bottom:8px">' + ico("rounds", "🩺") + ' Last consultant instruction</div>' +
          (latest ? '<p class="icu-ov-instr-tx">“' + esc(latest.text || "Instruction") + '”</p><p class="icu-ov-instr-by">' + esc(latest.assignedByName || "Consultant") + (latest.ts ? " · " + fmtAgo(latest.ts) : "") + '</p>'
            : '<p class="icu-doc-sub" style="margin:0">No instructions yet — add one from Rounds.</p>') +
          '<button class="icu-ov-viewtasks" data-icu-act="tab:rounds">View ' + gopen + ' open task' + (gopen === 1 ? "" : "s") + ' →</button></div>';
      }

      // 4) Current treatment — the editable Treatment list (drug DB + free text) when present, else
      //    fall back to infusions/ventilation (design parity for patients with no explicit treatment).
      var txList = (_raw.treatment || []).map(function (i) { return { name: i.name, dose: [i.dose, i.route, i.freq].filter(Boolean).join(" · ") }; });
      var tx = txList;
      if (!txList.length) {
        tx = infusions.map(function (i) { return { name: i.drug, dose: (i.dose != null ? i.dose + (i.unit ? " " + i.unit : "") : (i.rateMlHr != null ? i.rateMlHr + " mL/h" : "")) }; }).filter(function (t) { return t.name; });
        if (v.mode) tx.push({ name: "Ventilation", dose: v.mode + (v.fio2 ? " · FiO₂ " + v.fio2 + "%" : "") });
      }
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("syringe", "💊") + ' Current treatment</div>' +
        (tx.length ? tx.map(function (t) { return '<div class="icu-ov-tx"><span class="icu-ov-tx-nm">' + esc(t.name) + '</span><span class="icu-ov-tx-dose">' + esc(t.dose || "—") + '</span></div>'; }).join("")
          : '<p class="icu-doc-sub" style="margin:0">No treatment recorded yet.</p>') +
        '<button class="icu-btn ghost" data-icu-act="tab:treatment" style="margin-top:10px">' + ico("syringe", "💊") + ' Add / manage treatment</button></div>';

      // 5) Critical alerts — the engine-grouped detail (below the design cards; not in the mock but valuable).
      out += '<div class="icu-sec-lbl">' + ico("warn", "🚨") + ' Critical alerts</div>';
      out += alerts.length ? alertsGroupedHTML(alerts) : '<div class="icu-card"><p class="icu-doc-sub" style="margin:0">No active alerts. Enter vitals/labs to populate the dashboard.</p></div>';

      // 5b) Auto-computed clinical scores (Feature B) — always-on vitals scores + diagnosis-linked.
      out += renderScoresPanel();

      // 6) Lab Watch toggle (redesign inline card) — only when the feature is on.
      if (labWatchOn()) {
        var lwOn = lwActive();
        out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("bell", "🔔") + ' Lab Watch</div>' +
          '<p class="icu-doc-sub" style="margin:0 0 10px">' + (lwOn ? "Watching this patient’s labs and alerting on critical changes." : "Get alerted when this patient’s labs cross critical thresholds.") + '</p>' +
          '<button class="icu-btn' + (lwOn ? " ghost" : "") + '" data-icu-act="labwatch">' + ico("bell", "🔔") + (lwOn ? " Manage Lab Watch (on)" : " Turn on Lab Watch") + '</button></div>';
      }

      // 7) Trends shortcut (kept — one tap to the chart).
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("trend", "📈") + ' Trends</div>' +
        '<p class="icu-doc-sub" style="margin:0 0 8px">See how this patient’s vitals and labs are moving over time.</p>' +
        '<button class="icu-btn" data-icu-act="tab:trends">' + ico("trend", "📈") + ' View vitals &amp; labs trends</button></div>';

      // 8) Today's goals (kept).
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🎯") + " Today's goals</div>" +
        ((_raw.goals || []).length ? (_raw.goals).map(function (g) { return '<div class="icu-row"><span>• ' + esc(g) + '</span></div>'; }).join("") : '<div class="icu-empty">No goals set</div>') +
        '<button class="icu-btn ghost" data-icu-act="edit:goals" style="margin-top:8px">＋ Edit goals</button></div>';

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
      var out = '<div class="icu-sec-lbl">' + ico("flask", "🧪") + ' Electrolytes &amp; correction</div>';
      if (!hasAny) {
        return out + '<div class="icu-card"><div class="icu-empty">No electrolyte values entered yet.</div>' +
          '<button class="icu-btn" data-icu-act="edit:labs">✎ Enter electrolytes</button></div>';
      }
      var grid = '<div class="icu-vitals">' + Object.keys(map).map(function (k) { return vitalCard(labels[k], map[k].v, "", map[k].s); }).join("") + "</div>";
      // provenance line — where these electrolyte values came from + freshness
      var srcs = {}; keys.forEach(function (k) { var s = (_raw.src || {})[k]; if (s && L[k] != null) srcs[s.source] = Math.max(srcs[s.source] || 0, s.ts || 0); });
      var srcLine = Object.keys(srcs).length ? '<div class="icu-src">' + Object.keys(srcs).map(function (s) { return "📎 " + esc(s) + " · " + fmtAgo(srcs[s]); }).join("  ·  ") + "</div>" : "";
      grid += srcLine;
      // Correction guidance rendered INLINE (no redirect) — reuses the validated Electrolyte Engine
      // analyzers via ELYTE.analyze(). ICU labs are now stored in CONVENTIONAL (Indian) units
      // (mg/dL / mEq/L / g/dL) — the units ELYTE itself works in — so pass "conventional" (NOT "si",
      // which would make ELYTE convert again and mis-dose).
      var pt = { weight: p.weightKg, age: p.age, sex: (String(p.sex).toLowerCase() === "f" ? "f" : "m") };
      var res = [];
      try { if (window.ELYTE && ELYTE.analyze) res = ELYTE.analyze(L, pt, "conventional"); } catch (e) { res = []; }
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
        '<p style="margin:8px 0 0;color:var(--muted);font:600 11px var(--font)">Conventional (Indian) units — mg/dL · mEq/L · g/dL, as entered in Labs.</p></div>';
    },
    abg: function () {
      var g = _raw.abg || {}, L = _raw.labs.recent || {}, r = analyzeABG(g, L);
      var head = '<div class="icu-card"><h3>ABG &amp; Acid–Base</h3>' +
        row("pH", g.ph) + row("PaCO₂", g.paco2, "mmHg") + row("PaO₂", g.pao2, "mmHg") +
        row("HCO₃⁻", g.hco3, "mEq/L") + row("FiO₂", g.fio2, "%") + row("Base excess", g.be) +
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
      return '<div class="icu-sec-lbl">' + ico("syringe", "💉") + ' Infusions</div>' + list + quick;
    },
    // Editable Current Treatment — antibiotics / fluids / supportive / other. Any doctor (consultant
    // or resident) may add (drug DB or free-text) or remove; each change is written to the shared
    // timeline (group). Stored in ICU_STATE.treatment so it auto-persists + mirrors to the whole team.
    treatment: function () {
      var tx = _raw.treatment || [];
      var out = '<div class="icu-sec-lbl">' + ico("syringe", "💊") + ' Current treatment' +
        (tx.length ? ' <span style="color:var(--muted);font-weight:600">· ' + tx.length + ' item' + (tx.length === 1 ? "" : "s") + '</span>' : "") + '</div>';
      if (!tx.length) {
        out += '<div class="icu-card"><div class="icu-empty">No treatment recorded yet. Tap ＋ Add treatment to add antibiotics, fluids or supportive drugs — from the drug database or your own.</div></div>';
      } else {
        TX_CATS.forEach(function (c) {
          var items = tx.filter(function (x) { return (x.cat || "other") === c.k; });
          if (!items.length) return;
          out += '<div class="icu-sec-lbl" style="margin:14px 0 6px;font-size:12px">' +
            '<span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + c.color + ';margin-right:7px;vertical-align:middle"></span>' + esc(c.label) + '</div>' +
            '<div class="icu-card" style="padding:4px 12px">' + items.map(function (x) {
              var dsg = [x.dose, x.route, x.freq].filter(Boolean).join(" · ");
              return '<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">' +
                '<span style="flex:0 0 4px;align-self:stretch;border-radius:3px;background:' + c.color + '"></span>' +
                '<div style="flex:1;min-width:0"><div style="font:800 14.5px var(--font);color:var(--ink)">' + esc(x.name) + '</div>' +
                (dsg ? '<div style="font-family:var(--mono,monospace);font-size:12.5px;color:var(--primary);margin-top:2px">' + esc(dsg) + '</div>' : "") +
                (x.by ? '<div style="font:600 10.5px var(--font);color:var(--muted);margin-top:3px">added by ' + esc(x.by) + '</div>' : "") + '</div>' +
                '<button class="icu-tip" data-icu-act="txdel:' + encodeURIComponent(x.id) + '" title="Remove treatment" aria-label="Remove ' + esc(x.name) + '" style="color:var(--danger);font-size:15px;flex:0 0 auto">🗑</button>' +
              '</div>';
            }).join("") + '</div>';
        });
      }
      out += '<button class="icu-btn" data-icu-act="txadd" style="margin-top:12px">＋ Add treatment</button>' +
        '<p class="icu-doc-sub" style="margin:10px 2px 0;text-align:center">Any doctor — consultant or resident — can add or remove treatment. Every change is recorded on the patient timeline.</p>';
      return out;
    },
    protocols: function () {
      return '<div class="icu-sec-lbl">🚨 Critical Care Protocols</div>' +
        PROTOCOLS.map(function (p, i) { return protocolCard(p, i); }).join("") +
        '<button class="icu-btn" data-icu-act="launch:protocols">Open full protocol / drug library</button>' +
        '<button class="icu-btn ghost" data-icu-act="launch:interactions">💊⚠️ Check Drug Interactions</button>';
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
      if (!hasTrendPatient()) return trendsEmpty();
      var w = _trendWin;
      return '<div class="icu-tr-wrap">' + significantChanges(w) + winSelector() +
        TREND_GROUPS.map(function (g) { return groupSection(g, w); }).join("") + "</div>";
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
        '<button class="icu-btn" data-icu-act="gensummary">' + ico("copy", "📋") + ' Generate Daily ICU Summary</button>';
    },
    // Care Plan → Diagnosis. Owner-confirmed ordered flow (one door, forward-flowing):
    //   1) Presenting complaints  2) Structured findings (single picker)  3) Clinical context (summary)
    //   4) Deep clinical review (AI — enabled as soon as there IS context; NOT gated on a working dx)
    //   5) Working diagnosis (deterministic differential / KB search → management brief + protocol).
    dx: function () {
      var p = _raw.patient;
      var pid = p._id || p.name || "cur";
      if (_dxPt !== pid) { _dxPt = pid; _dxShow = false; _dxWhy = {}; _dxAdvanced = false; _corrCache = {}; _corrErr = null; _corrBusy = false; }   // reset guided-dx + correlation state on patient switch (no cross-patient leak)
      if (icuDxFlowOn()) maybeAutoTour();   // first-use guided-diagnosis tour (per account; once)
      var cc = p.complaints ? esc(p.complaints) : '<span style="color:var(--muted)">Not documented yet.</span>';
      var dxTxt = p.diagnosis ? "<b>" + esc(p.diagnosis) + "</b>" : '<span style="color:var(--muted)">Not set</span>';
      var fchips = findChipsHTML(false);
      var hasDx = !!(p.workingDx || p.diagnosis);

      // 1) Presenting complaints (FIRST).
      var out = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("edit", "📝") + ' Presenting complaints</div>' +
        '<p class="icu-dx-cc">' + cc + "</p>" +
        '<button class="icu-btn ghost" data-icu-act="edit:patient">' + ico("edit", "✎") + (p.complaints ? ' Edit complaints &amp; details' : ' Add presenting complaints') + '</button></div>';

      // 2) Structured findings — the searchable picker. ONE "＋ Add findings" (documentation only).
      out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("pulse", "🧾") + ' Structured findings</div>' +
        (fchips || '<p class="icu-doc-sub" style="margin:0 0 8px">Add symptoms, signs, vitals, labs or imaging findings from a fast clinical picker. Documentation only — this does not change any diagnosis or scoring.</p>') +
        '<button class="icu-btn" data-icu-act="findpick" style="margin-top:10px">' + ico("plus", "＋") + ' Add findings</button></div>';

      if (icuDxFlowOn()) {
        var present = (_raw.findings || []).filter(function (c) { return c.polarity !== "absent" && c.canonicalFindingId && c.canonicalFindingId.indexOf("note:") !== 0; }).length;
        var labN = Object.keys(_raw.labs.recent || {}).length, imgN = (_raw.imaging || []).filter(function (r) { return !r.hidden; }).length, vitN = latestVitalsSummary().length;
        var usable = deepReviewUsable();   // findings / labs / imaging / vitals present
        // Deep Review shares the correlation cache/state; a cached result renders here too.
        var dKey = (p._id || "cur") + ":" + correlationHash(buildClinicalContext()), dDeep = _corrCache[dKey];   // MUST match runCorrelationDeep's key
        var deepDone = !!dDeep;

        // 3) Clinical context — a compact auto-summary of what is available for reasoning (no second
        //    Add-findings door here; when empty it is a HINT, not a button).
        if (usable) {
          var summ = '<div class="icu-corr-meta">' + present + " finding" + (present === 1 ? "" : "s") + " · " + labN + " lab" + (labN === 1 ? "" : "s") + " · imaging " + (imgN ? "✓ (" + imgN + ")" : "—") + " · vitals " + (vitN ? "✓" : "—") + "</div>";
          out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🧠") + ' Clinical context</div>' +
            '<p class="icu-doc-sub" style="margin:0 0 6px">What is available for reasoning and deep review:</p>' + summ + '</div>';
        } else {
          out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("info", "🧠") + ' Clinical context</div>' +
            '<p class="icu-doc-sub" style="margin:0">Add structured findings above, sync labs (Ward Sync), or add imaging / vitals to build the context used to identify a working diagnosis.</p></div>';
        }

        // 4) Deep clinical review (AI) — PROMINENT, ENABLED as soon as there is usable context.
        //    NOT gated on a working diagnosis: its output HELPS identify the diagnosis + correlate.
        var dBlock = _corrBusy ? '<div class="icu-assist-msg" style="margin-top:10px">Running deep clinical review…</div>' : (dDeep ? '<div class="icu-corr-deep">' + corrDeepHTML(dDeep) + "</div>" : (_corrErr ? '<div class="icu-corr-deep">' + corrDeepHTML(_corrErr) + "</div>" : ""));
        out += '<div class="icu-card"><div class="icu-sec-lbl">' + ico("pulse", "✨") + ' Deep clinical review <span class="icu-phase">AI</span></div>' +
          '<p class="icu-doc-sub" style="margin:0 0 8px">Correlates your findings with available labs, imaging and vitals against StewardMD’s trusted sources — to help identify the diagnosis, flag what doesn’t fit and suggest next checks. Advisory only; you confirm the de-identified context that is sent.</p>' +
          '<button class="icu-btn" data-icu-act="corrdeep"' + ((_corrBusy || !usable) ? " disabled" : "") + (!usable ? ' title="Add findings, labs, imaging or vitals first"' : "") + '>' + ico("pulse", "✨") + " Deep clinical review</button>" +
          (!usable ? '<p class="icu-doc-sub" style="margin:6px 0 0">Add findings, labs, imaging or vitals above to enable deep review.</p>' : "") + dBlock +
          // "Search trusted sources" — external guideline/evidence lookup (corrext → openEvidenceLookup),
          // shown directly BELOW Deep clinical review exactly as in the classic ICU: always visible,
          // NOT gated on a deep review or a working diagnosis (disabled only if turned off in Settings).
          (extEvidenceOn()
            ? '<button class="icu-btn ghost" data-icu-act="corrext" style="margin-top:8px">' + ico("search", "🔎") + " Search trusted sources</button>"
            : '<button class="icu-btn ghost" disabled title="Turned off in Settings" style="margin-top:8px">' + ico("search", "🔎") + " Search trusted sources</button>") +
          (deepDone ? '<p class="icu-doc-sub" style="margin-top:6px">Use the review to choose a working diagnosis below, or search trusted sources for guideline support.</p>' : "") + '</div>';
      }

      // 5) Working diagnosis — set from the review’s suggestion (deterministic differential) or KB
      //    search. Once set, surface the advisory management brief + an applicable StewardMD protocol.
      var wdx = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🩺") + ' Working diagnosis</div>' +
        '<p class="icu-dx-cur">' + dxTxt + "</p>";
      if (!hasDx) {
        wdx += '<p class="icu-doc-sub" style="margin:0 0 8px">Use your findings, labs and vitals to generate a working differential, or search the knowledge base.</p>' +
          (icuDxFlowOn() ? '<button class="icu-btn" data-icu-act="finddx">' + ico("pulse", "🩺") + ' Find working diagnosis</button>' +
            (_dxShow ? '<div style="margin-top:10px">' + dxDifferentialHTML() + "</div>" : "") : "") +
          '<button class="icu-btn ghost" data-icu-act="dxsearch" style="margin-top:8px">' + ico("search", "🔎") + ' Search &amp; select diagnosis</button>' +
          '<p class="icu-doc-sub" style="margin-top:8px">Searches StewardMD’s clinical knowledge base and sets the working diagnosis — clinician-editable, never auto-applied.</p>';
      } else {
        // Management / treatment considerations surface ONLY once a working diagnosis is selected, and stay advisory.
        wdx += (icuDxFlowOn() ? '<div class="icu-corr-note">' + ico("info", "ⓘ") + ' Management considerations for <b>' + esc(p.diagnosis) + '</b> are <b>advisory</b> — verify against local protocol, ICMR/guideline sources and your clinical judgement.</div>' : "") +
          dxManagementHTML(p.diagnosis) +
          '<button class="icu-btn ghost" data-icu-act="dxsearch" style="margin-top:10px">' + ico("search", "🔎") + ' Change working diagnosis</button>';
      }
      wdx += "</div>";
      return out + wdx;
    },
    goals: function () {
      var g = _raw.goals || [];
      var list = g.length ? g.map(function (x) { return '<div class="icu-row"><span>• ' + esc(x) + "</span></div>"; }).join("") : '<div class="icu-empty">No goals set for today.</div>';
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🎯") + ' Goals for today</div>' + list +
        '<button class="icu-btn ghost" data-icu-act="edit:goals" style="margin-top:10px">' + ico("edit", "✎") + ' Edit goals</button></div>' +
        '<button class="icu-btn ghost" data-icu-act="launch:interactions">' + ico("warn", "⚠️") + ' Check drug interactions</button>';
    },
    documents: function () {
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("copy", "📄") + ' Summary &amp; documents</div>' +
        '<p class="icu-doc-sub">Generate clinician-reviewable documents from this patient’s recorded data. Nothing is finalised without your review.</p>' +
        '<button class="icu-btn" data-icu-act="summary">' + ico("copy", "📋") + ' Daily ICU summary</button>' +
        '<button class="icu-btn ghost" data-icu-act="sharecase">' + ico("share", "📤") + ' Share case</button>' +
        '<button class="icu-btn ghost" data-icu-act="printsummary">' + ico("upload", "🖨") + ' Print / Export PDF</button>' +
        '</div>';
    },
    imaging: function () {
      if (!icuImagingOn()) return '<div class="icu-card"><p>Imaging Notes is turned off.</p></div>';
      var all = _raw.imaging || [], visible = all.filter(function (r) { return !r.hidden; }), hidden = all.filter(function (r) { return r.hidden; });
      var header = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("camera", "🩻") + ' Imaging Notes</div>' +
        '<p class="icu-doc-sub">Radiology reports from Ward Sync (report text only) plus your manual notes. Any urgent-finding flag is a deterministic keyword prompt to review — never a diagnosis.</p>' +
        '<div class="icu-img-btns"><button class="icu-btn" data-icu-act="imgfetch">' + ico("hospital", "🏥") + ' Fetch imaging from Ward Sync</button>' +
        '<button class="icu-btn ghost" data-icu-act="imgadd">' + ico("plus", "＋") + ' Add imaging note</button></div></div>';
      if (!all.length) return header + '<div class="icu-empty">No imaging reports available from Ward Sync for this patient.</div>' + correlationCard();
      var filters = '<div class="icu-img-filters">' + IMG_FILTERS.map(function (f) {
        return '<button class="icu-img-chip ' + (_imgFilter === f.k ? "on" : "") + '" data-icu-act="imgfilter:' + f.k + '">' + esc(f.label) + "</button>";
      }).join("") + "</div>";
      var shown = visible.filter(function (r) { return imgMatches(r, _imgFilter); });
      var cards = shown.length ? shown.map(function (r) { return imagingCard(r); }).join("") : '<div class="icu-empty">No imaging matches this filter.</div>';
      var hiddenRows = hidden.length ? ('<div class="icu-sec-lbl" style="margin-top:12px">Hidden (' + hidden.length + ")</div>" + hidden.map(function (r) {
        return '<div class="icu-img-hidden"><span>' + esc(r.studyName || "Imaging") + '</span><button class="icu-img-act" data-icu-act="imghide:' + encodeURIComponent(r.id) + '">Unhide</button></div>';
      }).join("")) : "";
      return header + filters + cards + hiddenRows + correlationCard();
    },
    // Monitoring -> Vitals sub-tab (redesign parity): the Live Patient Status grid as a first-class
    // section with Update + Snapshot affordances (was previously only a collapsed <details>).
    vitals: function () {
      return '<div class="icu-card">' + renderLiveStatus() +
        '<div class="icu-img-btns" style="margin-top:10px">' +
          '<button class="icu-btn" data-icu-act="edit:monitor">' + ico("edit", "✎") + ' Update vitals</button>' +
          '<button class="icu-btn ghost" data-icu-act="snapshot">' + ico("camera", "📷") + ' Snapshot / Ward Sync</button>' +
        '</div></div>';
    },
    // Care Plan -> Interactions sub-tab (redesign parity): active-med chips + the full DDI checker.
    interactions: function () {
      var meds = (_raw.infusions || []).map(function (i) { return i.drug; }).filter(Boolean);
      var chips = meds.length
        ? '<div class="icu-elyte-alerts" style="margin-top:8px">' + meds.map(function (m) { return '<span class="icu-chip" style="cursor:default">' + esc(m) + '</span>'; }).join("") + '</div>'
        : '<p class="icu-doc-sub" style="margin:6px 0 0">No active infusions recorded. Add them under Monitoring → Infusions, or open the full checker to search any drugs.</p>';
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("warn", "⚠️") + ' Drug interactions</div>' +
        '<p class="icu-doc-sub" style="margin:0">Check this patient’s active medications against each other and against any drug you’re considering. Advisory — verify against the full label.</p>' +
        chips +
        '<button class="icu-btn" data-icu-act="launch:interactions" style="margin-top:10px">' + ico("warn", "⚠️") + ' Check drug interactions</button></div>';
    },
    // Documents -> Handover sub-tab (redesign parity): a real, auto-built SBAR shift handover.
    handover: function () {
      var sbar = buildSBAR(_raw), any = hasData();
      var tlN = (grpActive() && _grpPtVM && (_grpPtVM.timeline || []).length) || 0;
      var srcNote = "Auto-built from this patient’s recorded data" + (tlN ? " and today’s timeline (" + tlN + " event" + (tlN === 1 ? "" : "s") + ")" : "") + ". Advisory — review before you hand over.";
      var cards = sbar.map(function (sec) {
        return '<div class="icu-sbar" style="border-left-color:' + sec.color + '"><div class="icu-sbar-lbl" style="color:' + sec.color + '">' + esc(sec.label) + '</div><div class="icu-sbar-body">' + esc(sec.body) + '</div></div>';
      }).join("");
      return '<div class="icu-card icu-sbar-head"><div class="icu-sec-lbl">' + ico("copy", "⇄") + ' Shift handover (SBAR)</div><p class="icu-doc-sub" style="margin:0">' + esc(srcNote) + '</p></div>' +
        '<div class="icu-card">' + cards +
          (any ? "" : '<p class="icu-doc-sub" style="margin:8px 0 0">Add patient details, findings, vitals or labs to fill out the handover.</p>') +
          '<button class="icu-btn" data-icu-act="copyhandover" style="margin-top:12px">' + ico("copy", "⇄") + ' Copy handover</button>' +
          (grpActive() ? '<button class="icu-btn ghost" data-icu-act="handovershift" style="margin-top:8px">' + ico("check", "→") + ' Hand over to next shift</button>' : "") +
        '</div>';
    },
    // Documents -> Discharge sub-tab (redesign parity): the guided Discharge Creator + the
    // discharge/remove-patient action (both live under "Discharge").
    discharge: function () {
      var txN = (_raw.treatment || []).length;
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("rounds", "📝") + ' Discharge Creator</div>' +
        '<p class="icu-doc-sub" style="margin:0 0 10px">A structured discharge summary auto-filled from this patient’s recorded course — diagnosis, hospital course, investigations, condition' + (txN ? ' and ' + txN + ' discharge medication' + (txN === 1 ? "" : "s") + ' from the Treatment list' : '') + '. Complete each section, then copy, print or share. Marked “Draft — review required”; nothing is finalised without you.</p>' +
        '<button class="icu-btn" data-icu-act="discharge">' + ico("rounds", "📝") + ' Open Discharge Creator</button></div>' +
        dischargePatientCard();
    },
    more: function () {
      var n = rosterCount();
      // The ONE ICU toggle: solo (this device) vs shared Group mode. v2 is now the only ICU, so
      // there is no longer a separate "new/classic" toggle — just this. Flips smd_icu_groups + reloads.
      var grpOn = icuGroupsOn();
      var grpCard = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("user", "👥") + ' ICU Group mode</div>' +
        '<p class="icu-doc-sub" style="margin:0 0 10px">' + (grpOn
          ? "Group mode is ON — shared units. Tap to switch to solo ICU."
          : "Solo ICU (this device). Tap to turn on shared units — invite your team, shared patients & round tasks.") + '</p>' +
        '<button class="icu-btn' + (grpOn ? " ghost" : "") + '" data-icu-act="grptoggle">' + (grpOn
          ? ico("refresh", "↩") + " Group mode ON — switch to solo ICU"
          : ico("user", "👥") + " Turn on Group mode (shared units)") + '</button></div>';
      // Every classic header-chip action folds in here (nothing lost): Patient details, Save/update,
      // Saved patients, Ward Sync, Lab Watch (per-patient), Share case, and a guarded Clear.
      return grpCard +
        '<div class="icu-card"><div class="icu-sec-lbl">' + ico("more", "⋯") + ' Patient &amp; tools</div>' +
        '<button class="icu-btn ghost" data-icu-act="edit:patient">' + ico("user", "🧑") + ' Patient details</button>' +
        '<button class="icu-btn ghost" data-icu-act="savept">' + ico("save", "💾") + ' Save / update this patient</button>' +
        '<button class="icu-btn ghost" data-icu-act="patients">' + ico("folder", "📋") + ' Saved patients' + (n ? " (" + n + ")" : "") + '</button>' +
        '<button class="icu-btn ghost" data-icu-act="wardfetch">' + ico("hospital", "🏥") + ' Ward Sync</button>' +
        (labWatchOn() ? '<button class="icu-btn ghost" data-icu-act="labwatch">' + ico("bell", "🔔") + ' Lab Watch' + (lwActive() ? " (watching)" : "") + '</button>' : "") +
        '<button class="icu-btn ghost" data-icu-act="sharecase">' + ico("share", "📤") + ' Share case</button>' +
        "" /* classic coach link retired in v2 */ +
        (icuDxFlowOn() ? '<button class="icu-btn ghost" data-icu-act="dxtour">' + ico("pulse", "🧭") + ' Show ICU diagnosis tour</button>' : "") +
        '<button class="icu-btn ghost" data-icu-act="clearfindings">' + ico("trash", "🧹") + ' Clear current findings</button>' +
        '<button class="icu-btn ghost" data-icu-act="tab:discharge">' + ico("rounds", "📝") + ' Discharge &amp; remove patient</button>' +
        '</div>' +
        '<button class="icu-btn ghost" data-icu-act="testpush" style="margin-top:8px">' + ico("bell", "🔔") + ' Send me a test notification</button>' +
        (grpActive() ? '<button class="icu-btn ghost" data-icu-act="notifprefs" style="margin-top:8px">' + ico("settings", "⚙️") + ' Notification preferences</button>' : "") +
        '<p class="icu-doc-sub" style="text-align:center;margin-top:16px;opacity:.55">StewardMD ICU · ' + esc(icuBuildVer() || "build") + '</p>';
    }
  };

  /* ---------------------------------------------------------- shell render */
  var rootEl = null;
  // Crisp line-icons from the shared home.js catalog; emoji fallback keeps ICU safe if the
  // catalog hasn't loaded yet (home.js is loaded before icu.js, so this normally hits window.icon).
  function ico(name, fallback, cls) {
    try { if (window.icon && window.ICONS && window.ICONS.has(name)) return window.icon(name, "icu-ico" + (cls ? " " + cls : "")); } catch (e) {}
    return '<span class="icu-emoji">' + (fallback || "") + "</span>";
  }
  // (Retired 2026-07 consolidation) The classic renderHeader() 9-chip cluster and renderTabBar()
  // bottom workspace bar are gone — v2 (paintV2) is the only chrome now. Every chip action they
  // exposed lives on in v2: Patient/Save/Saved/Ward Sync/Lab Watch/Share/Clear in RENDER.more,
  // New/Admit on the board bottom bar, and the workspace nav is renderV2TopTabs + renderSubNav.
  // Segmented sub-navigation of the current workspace's members (only when >1).
  function renderSubNav() {
    var w = wsById(_ws), mem = wsMembers(w); if (mem.length < 2) return "";
    return '<div class="icu-subnav">' + mem.map(function (m) {
      var meta = MEMBER[m] || { label: m };
      return '<button class="icu-seg ' + (m === _active ? "on" : "") + '" data-icu-act="tab:' + m + '">' + esc(meta.label) + "</button>";
    }).join("") + "</div>";
  }
  // one-line vitals summary for the collapsed status on non-overview tabs
  function liveSummaryLine() {
    var lv = latestVitals(), L = _raw.labs.recent || {}, mp = curMap();
    function v(x, u) { return (x == null || x === "") ? "—" : x + (u || ""); }
    return ico("pulse", "❤️") + ' Vitals &amp; status' +
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
  // A bare duration ("20 min", "3 h") for task due/overdue countdowns.
  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + " s"; if (s < 3600) return Math.round(s / 60) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h"; return Math.round(s / 86400) + " d";
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
    return '<div class="icu-sec-lbl">' + ico("warn", "⚠️") + ' Value conflicts — your choice</div>' + cs.map(function (c) {
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
    return '<div class="icu-elyte-alerts">' + ico("warn", "⚠️") + ' Electrolyte alerts: ' + ab.map(function (r) {
      // name + severity word only — the grid below shows the numeric value + units
      // (r.value from ELYTE is in its own display units, so we don't repeat it here).
      return '<span class="icu-elyte-pill" style="border-color:' + (COLOR[r.level] || "var(--muted)") + ';color:' + (COLOR[r.level] || "var(--ink)") + '">' + esc(r.name) + (r.severity ? " · " + esc(r.severity) : "") + "</span>";
    }).join("") + '</div>';
  }
  // First-run orientation (one-time) + empty state. No demo patient is ever auto-loaded.
  var _coachForce = false;
  function icuSeen() { try { return localStorage.getItem("stewardmd_icu_seen") === "1"; } catch (e) { return false; } }
  function setIcuSeen() { try { localStorage.setItem("stewardmd_icu_seen", "1"); } catch (e) {} }
  function hasData() {
    try {
      if (Object.keys(_raw.labs.recent || {}).length) return true;
      if ((_raw.vitals || []).length) return true;
      if (_raw.abg && Object.keys(_raw.abg).filter(function (k) { return k !== "ts"; }).length) return true;
      if (_raw.ventilator && Object.keys(_raw.ventilator).length) return true;
      if ((_raw.imaging || []).length) return true;
      if ((_raw.infusions || []).length) return true;
      if ((_raw.treatment || []).length) return true;
      if (_raw.patient && (_raw.patient.name || _raw.patient.diagnosis)) return true;
    } catch (e) {}
    return false;
  }
  // State-agnostic version of hasData() — "does this state object carry any real clinical content?"
  // Used to stop a blank/stale REMOTE snapshot from overwriting good local (possibly-unsynced) data.
  function stateHasData(st) {
    try {
      st = st || {};
      if (st.labs && Object.keys(st.labs.recent || {}).length) return true;
      if ((st.vitals || []).length) return true;
      if (st.abg && Object.keys(st.abg).filter(function (k) { return k !== "ts"; }).length) return true;
      if (st.ventilator && Object.keys(st.ventilator).length) return true;
      if ((st.imaging || []).length) return true;
      if ((st.infusions || []).length) return true;
      if ((st.treatment || []).length) return true;
      if ((st.findings || []).length) return true;
      if (st.patient && (st.patient.name || st.patient.diagnosis)) return true;
    } catch (e) {}
    return false;
  }
  function coachCard() {
    return '<div class="icu-coach"><div class="icu-coach-h"><span>👋 How the ICU workstation works</span><button class="icu-coach-x" data-icu-act="coachdone" aria-label="Dismiss">✕</button></div>' +
      '<p class="icu-coach-p">Track one ICU patient — <b>enter, speak, or snap</b> their vitals &amp; labs to get instant interpretation, alerts, and a round-ready summary.</p>' +
      '<ol class="icu-coach-steps"><li>Tap <b>＋ Add my patient</b> — type it, <b>🎤 speak it</b>, or <b>📷 snap a photo</b>.</li>' +
      '<li>Review the values — nothing is applied until you confirm.</li>' +
      '<li>Read the alerts, trends &amp; round-ready summary across the tabs.</li></ol>' +
      '<button class="icu-btn" data-icu-act="coachdone">Got it</button></div>';
  }
  function emptyStateCard() {
    return '<div class="icu-empty-state"><div class="icu-empty-ic">' + ico("pulse", "🫀") + '</div>' +
      '<div class="icu-empty-t">No patient data yet</div>' +
      '<p class="icu-empty-p">Track one ICU patient — enter, speak, or snap their vitals &amp; labs to get instant interpretation, alerts, and a round-ready summary.</p>' +
      '<button class="icu-btn icu-empty-cta" data-icu-act="adddata">＋ Add my patient</button></div>';
  }
  // Persistent one-line patient banner (A6): name · ICU day · MAP · lactate · pressors.
  function patientBanner() {
    if (!hasData()) return "";
    var p = _raw.patient || {}, lv = latestVitals(), mp = curMap();
    var press = (_raw.infusions || []).filter(function (i) { return /nor|adrenaline|epinephrine|vasopressin|dopamine|dobutamine|phenylephrine/i.test(i.drug || ""); });
    var parts = ['<b>' + esc(p.name || "ICU patient") + "</b>"];
    if (p.icuDay != null) parts.push("ICU day " + esc(p.icuDay));
    if (mp != null) parts.push('<span class="' + (mp < 65 ? "bad" : "") + '">MAP ' + esc(mp) + "</span>");
    if (lv.lactate != null) parts.push('<span class="' + (lv.lactate > 2 ? "bad" : "") + '">Lactate ' + esc(lv.lactate) + "</span>");
    parts.push(press.length ? '<span class="bad">' + press.length + " pressor" + (press.length > 1 ? "s" : "") + "</span>" : "No pressors");
    return '<div class="icu-banner">' + parts.join('<span class="sep">·</span>') + "</div>";
  }
  function severityKey() {
    return '<div class="icu-sevkey"><span><i class="ok"></i>Normal</span><span><i class="warn"></i>Caution</span><span><i class="bad"></i>Critical</span></div>';
  }
  function renderBody() {
    var tab = "", isOv = _active === "overview", mon = isMonWs();
    try { tab = RENDER[_active] ? RENDER[_active]() : ""; } catch (e) { tab = '<div class="icu-card"><p>Tab error.</p></div>'; }
    // Vitals status + Add-data belong to the monitoring workspaces; Care Plan / Documents /
    // More show only their own content (below the sub-nav). Overview shows the full grid.
    var status = !mon ? "" : (isOv ? renderLiveStatus()
      : '<details class="icu-vitals-c"><summary>' + liveSummaryLine() + '</summary>' + renderLiveStatus() + '</details>');
    var elyteAlerts = (isOv || _active === "lytes") ? renderElyteAlerts() : "";
    var hd = hasData();
    var addBtn = !mon ? "" : '<button class="icu-adddata" data-icu-act="adddata">' + (hd ? "＋ Add / update data" : "＋ Add my patient") + '</button>';
    // Empty overview → one inviting empty state (its own CTA); otherwise grid/summary + add button.
    var mid = (isOv && !hd) ? emptyStateCard() : (status + addBtn);
    return '<div class="icu-scroll"><div class="icu-wrap">' +
      patientBanner() +
      renderSubNav() +
      "" /* v2: classic "How it works" coach retired — it overlapped the diagnosis tour and used stale solo-patient copy */ +
      ((isOv && hd) ? severityKey() : "") +
      (mon ? renderWardBanner() : "") +
      renderConflicts() +
      elyteAlerts +
      mid +
      tab +   // each tab renders its own descriptive header — no redundant generic label
      '</div></div>';
  }
  // One-shot: set true right before a paint() that should land at the TOP (a real context switch —
  // load/new/clear patient). Every other repaint keeps the user where they were.
  var _paintTop = false;
  function paint() {
    if (!rootEl) return;
    paintV2();   // v2 (unit board + restyled workspace) is the only ICU now — classic chrome retired.
  }
  // Live collab snapshots (roster / presence / members / metadata) fire in bursts — a presence
  // heartbeat or a pending-write metadata flip can repaint every second or two. paintV2 preserves
  // scrollTop, but rebuilding innerHTML mid-scroll still CANCELS the in-progress inertial scroll
  // ("syncing stops the scroll"). So route those repaints through paintLive(): coalesce them and
  // never rebuild while the user is actively scrolling — apply once scrolling settles (~160ms).
  // Navigation and user actions still call paint() directly for an immediate response.
  var _liveRaf = 0, _liveScrolling = 0, _liveScrollT = 0, _livePending = 0, _liveBound = 0;
  function _bindLiveScroll() {
    if (_liveBound || !rootEl) return; _liveBound = 1;
    rootEl.addEventListener("scroll", function () {
      _liveScrolling = 1; clearTimeout(_liveScrollT);
      _liveScrollT = setTimeout(function () { _liveScrolling = 0; if (_livePending) { _livePending = 0; paint(); } }, 160);
    }, true);   // capture: catches the .icu-scroll container that paintV2 recreates each render
  }
  function paintLive() {
    _bindLiveScroll();
    if (_liveScrolling) { _livePending = 1; return; }   // defer: don't rebuild during an active scroll
    if (_liveRaf) { _livePending = 1; return; }
    _liveRaf = requestAnimationFrame(function () { _liveRaf = 0; if (_liveScrolling) { _livePending = 1; return; } paint(); });
  }

  /* ================================================================ ICU v2
   * (smd_icu_v2) — unit patient board + restyled patient workspace. PRESENTATION /
   * NAV LAYER ONLY: reuses renderBody() for tab bodies, loadRoster() for the board,
   * every existing engine/threshold/ingest contract untouched. LOCAL data only in
   * Phase 1 (single-device roster; presence/team/notifications are local stubs
   * clearly labelled until Phase 2 Firestore). All markup gated behind #icuRoot.icu-v2.
   */
  // Acuity derived from RAW values WITHOUT calling recompute (entry.state.alerts is stripped on save).
  function v2Snapshot(st) {
    st = st || {};
    var lv = latestByTs(st.vitals || []);
    var mp = lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp);
    var press = (st.infusions || []).filter(function (i) { return isPressor(i.drug); });
    var L = (st.labs && st.labs.recent) || {};
    return { map: mp, hr: lv.hr, spo2: lv.spo2, lactate: lv.lactate, temp: lv.temp, pressors: press.length, k: L.k };
  }
  function v2Severity(st) {
    var s = v2Snapshot(st);
    if ((s.map != null && s.map < 65) || (s.lactate != null && s.lactate > 4) || (s.spo2 != null && s.spo2 < 90) || s.pressors >= 1) return "critical";
    if ((s.map != null && s.map < 70) || (s.lactate != null && s.lactate > 2) || (s.spo2 != null && s.spo2 < 93) || (s.k != null && (s.k > K_WARN_HI || s.k < K_WARN_LO))) return "review";
    return "stable";
  }
  var V2_LABEL = { critical: "Critical", review: "Needs review", stable: "Stable" };
  function v2Reason(s) {
    var r = [];
    if (s.map != null && s.map < 70) r.push("MAP " + s.map);
    if (s.lactate != null && s.lactate > 2) r.push("Lactate " + s.lactate);
    if (s.spo2 != null && s.spo2 < 93) r.push("SpO₂ " + s.spo2 + "%");
    if (s.pressors >= 1) r.push(s.pressors + " pressor" + (s.pressors > 1 ? "s" : ""));
    if (s.k != null && (s.k > K_WARN_HI || s.k < K_WARN_LO)) r.push("K⁺ " + s.k);
    return r.join(" · ");
  }
  function v2AccountProfile() { try { return (window.SMD_ACCOUNT && SMD_ACCOUNT.profile) ? SMD_ACCOUNT.profile() : null; } catch (e) { return null; } }
  function v2AccountName() { var p = v2AccountProfile(); return (p && (p.name || p.email)) || "You"; }
  function v2Initials(s) {
    s = String(s || "").trim();
    if (!s) return "You";
    if (s.indexOf("@") > 0) s = s.split("@")[0];
    var parts = s.split(/[\s._-]+/).filter(Boolean);
    var ini = parts.slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join("");
    return ini || s.charAt(0).toUpperCase();
  }
  function v2BedNum(b) { var n = parseInt(String(b == null ? "" : b).replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 9999 : n; }
  // The unit board list: the LOCAL roster + the current open patient (if it has data and isn't saved yet).
  function v2BoardList() {
    var list = loadRoster().map(function (e) {
      return { id: e.id, name: e.name, dx: e.dx, bed: e.bed, savedAt: e.savedAt, state: e.state || {} };
    });
    try {
      if (hasData()) {
        var curId = _raw.patient._id || "cur";
        if (!list.some(function (x) { return x.id === curId; })) {
          list.unshift({ id: curId, name: _raw.patient.name || "Current patient", dx: _raw.patient.diagnosis || "", bed: _raw.patient.bed || "", savedAt: (_raw.meta && _raw.meta.updated) || nowTs(), state: _raw, _current: true });
        }
      }
    } catch (e) {}
    list.forEach(function (p) {
      p.sev = v2Severity(p.state);
      p.snap = v2Snapshot(p.state);
      p.age = (p.state.patient && p.state.patient.age != null) ? p.state.patient.age : null;
      p.sex = (p.state.patient && p.state.patient.sex) || "";
    });
    var rank = { critical: 0, review: 1, stable: 2 };
    list.sort(function (a, b) { var d = (rank[a.sev] || 9) - (rank[b.sev] || 9); return d ? d : (v2BedNum(a.bed) - v2BedNum(b.bed)); });
    return list;
  }
  function v2CardVitals(s) {
    function mk(k, val, sst) { return { k: k, val: (val == null ? "—" : val), st: sst || "" }; }
    var v = [];
    v.push(mk("MAP", s.map, s.map == null ? "" : (s.map < 65 ? "crit" : s.map < 70 ? "warn" : "")));
    v.push(mk("LACT", s.lactate, s.lactate == null ? "" : (s.lactate > 4 ? "crit" : s.lactate > 2 ? "warn" : "")));
    v.push(mk("SpO₂", s.spo2 == null ? null : (s.spo2 + "%"), s.spo2 == null ? "" : (s.spo2 < 90 ? "crit" : s.spo2 < 93 ? "warn" : "")));
    if (s.pressors >= 1) v.push(mk("PRESS", s.pressors, "crit"));
    return v;
  }
  // Sticky, acuity-coloured patient banner (white text) + live mini-vitals.
  function renderV2Banner() {
    var p = _raw.patient || {}, sev = v2Severity(_raw), snap = v2Snapshot(_raw);
    var meta = [];
    if (p.bed) meta.push("Bed " + esc(p.bed));
    if (p.age != null) meta.push(esc(p.age) + (p.sex ? "/" + esc(p.sex) : ""));
    if (p.icuDay != null) meta.push("ICU day " + esc(p.icuDay));
    if (p.diagnosis) meta.push(esc(p.diagnosis));
    var mv = [
      { k: "MAP", val: snap.map != null ? snap.map : "—" },
      { k: "HR", val: snap.hr != null ? snap.hr : "—" },
      { k: "SpO₂", val: snap.spo2 != null ? snap.spo2 + "%" : "—" },
      { k: "LACT", val: snap.lactate != null ? snap.lactate : "—" }
    ];
    return '<div class="icu-v2-banner ' + sev + '"><div class="icu-v2-banner-top">' +
      '<button class="icu-v2-back" data-icu-act="icuboard" aria-label="Back to unit board">‹</button>' +
      '<div class="icu-v2-banner-id">' +
        '<div class="icu-v2-banner-nm">' + esc(p.name || "ICU patient") + '<span class="icu-v2-banner-pill">' + V2_LABEL[sev] + '</span></div>' +
        '<div class="icu-v2-banner-meta">' + (meta.length ? meta.join(" · ") : "Add patient details") + '</div>' +
      '</div>' +
      '<button class="icu-v2-handover" data-icu-act="tab:handover" aria-label="Shift handover (SBAR)" title="Shift handover (SBAR)">' + ico("copy", "⇄") + '</button>' +
      '</div><div class="icu-v2-banner-vitals">' + mv.map(function (v) {
        return '<div class="icu-v2-mv"><div class="icu-v2-mv-k">' + v.k + '</div><div class="icu-v2-mv-v">' + esc(v.val) + '</div></div>';
      }).join("") + '</div></div>';
  }
  // Presence + sync line — Phase 1 is LOCAL/single-user; group mode shows real viewers + live sync.
  function renderV2Presence() {
    if (grpActive()) return renderV2PresenceGroup();
    return '<div class="icu-v2-presence">' +
      '<span class="icu-v2-viewer">' + esc(v2Initials(v2AccountName())) + '</span>' +
      '<span class="icu-v2-presence-tx">Only you are viewing · saved on this device</span>' +
      '<span class="icu-v2-synced"><span class="icu-v2-dot"></span>Synced</span></div>';
  }
  // Five solid segmented top tabs → existing (_ws,_active) via existing dispatch verbs.
  function renderV2TopTabs() {
    // Rounds carries an open-task badge (design parity) — live in group mode where tasks exist.
    var openTasks = (grpActive() && _grpPtVM && _grpPtVM.tasks) ? _grpPtVM.tasks.filter(function (t) { return t.status !== "done"; }).length : 0;
    var tabs = [
      { label: "Overview", act: "tab:overview", on: _active === "overview" },
      { label: "Monitoring", act: "ws:monitoring", on: _ws === "monitoring" },
      { label: "Care Plan", act: "ws:careplan", on: _ws === "careplan" },
      { label: "Rounds", act: "tab:rounds", on: _active === "rounds", badge: openTasks },
      { label: "Documents", act: "ws:documents", on: _ws === "documents" }
    ];
    return '<div class="icu-v2-tabwrap"><div class="icu-v2-tabs">' + tabs.map(function (t) {
      return '<button class="icu-v2-tab' + (t.on ? " on" : "") + '" data-icu-act="' + t.act + '">' + esc(t.label) + (t.badge ? '<span class="icu-v2-tabbadge">' + t.badge + '</span>' : "") + '</button>';
    }).join("") + '</div></div>';
  }
  // Unit board — the "front door". Local roster in Phase 1; LIVE shared unit in group mode.
  // Unit picker card (hospital / category / unit-type / group row).
  function unitCardHTML(act, iconHtml, title, subtitleHTML, active) {
    return '<button data-icu-act="' + act + '" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:10px;color:var(--ink);cursor:pointer">' +
      '<span style="width:42px;height:42px;border-radius:11px;background:var(--primary-soft);display:flex;align-items:center;justify-content:center;font-size:20px;flex:0 0 auto">' + iconHtml + '</span>' +
      '<span style="flex:1;min-width:0"><span style="display:block;font:800 15px var(--font)">' + (active ? "● " : "") + esc(title) + '</span>' +
      (subtitleHTML ? '<span style="display:block;font:600 12px var(--font);color:var(--muted);margin-top:2px">' + subtitleHTML + '</span>' : "") + '</span>' +
      '<span style="color:var(--muted);font-size:20px;flex:0 0 auto">›</span></button>';
  }
  // Unit navigation: hospital → category (ICU | Ward) → unit type. In group mode the "units" step
  // lists the user's shared units of that category (kind-filtered) + a create option; in solo mode
  // it lists the fixed unit types, each with its own patient list.
  function renderUnitPicker() {
    var hosp = _unit.hospital || "";
    var shead = function (backAct, h, s) {
      return '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="' + backAct + '" aria-label="Back">‹</button>' +
        '<div><div class="icu-v2-shead-h">' + h + '</div><div class="icu-v2-shead-s">' + s + '</div></div></div>';
    };
    if (_pickStep === "hospital") {
      var hosps = ["GIMSR", "My Hospital"]; if (hosp && hosps.indexOf(hosp) < 0) hosps.unshift(hosp);
      var hrows = hosps.map(function (h) { return unitCardHTML("unithosp:" + encodeURIComponent(h), ico("hospital", "🏥"), h, "", h === hosp); }).join("");
      return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + shead("close", "Select hospital", "Choose your hospital") +
        '<div style="padding:14px 16px">' + hrows + '</div></div>';
    }
    if (_pickStep === "category") {
      var crows = UNIT_CATS.map(function (c) {
        return unitCardHTML("unitcat:" + c.cat, ico(c.svg, c.ic), c.label, esc(c.sub) + ' · ' + c.types.length + ' units', false);
      }).join("");
      var sub = "Select ICU or Ward" + (hosp ? ' · <button class="icu-tip" data-icu-act="unithospchg" style="color:var(--primary)">change hospital</button>' : "");
      return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + shead("close", esc(hosp || "Choose a unit"), sub) +
        '<div style="padding:14px 16px">' + crows + '</div></div>';
    }
    // units step
    var cat = _pickCat || "icu", meta = unitCatMeta(cat), body;
    if (groupMode()) {
      var mine = (_grpList || []).filter(function (g) { return (g.kind || "icu") === cat; });
      body = mine.length ? mine.map(function (g) {
        var active = grpActive() && _grp && _grp.id === g.id;
        return unitCardHTML("grpsel:" + encodeURIComponent(g.id), ico(meta.svg, meta.ic), g.name || meta.label,
          esc(g.unitType || g.unit || meta.label) + (g.hospital ? ' · ' + esc(g.hospital) : ""), active);
      }).join("") : '<div class="icu-empty" style="margin:6px 0 12px">' + (_grpList === null ? "Connecting to your shared units…" : "No shared " + esc(meta.label) + " units yet.") + '</div>';
      body += '<button class="icu-btn" data-icu-act="unitgrpnew:' + cat + '">' + ico("plus", "＋") + ' Create a ' + esc(meta.label) + ' unit</button>';
    } else {
      body = meta.types.map(function (tp) {
        var active = _unit.cat === cat && _unit.type === tp;
        return unitCardHTML("unitsel:" + cat + ":" + encodeURIComponent(tp), ico(meta.svg, meta.ic), tp, "", active);
      }).join("");
    }
    return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + shead("unitback", esc(meta.label) + (hosp ? " · " + esc(hosp) : ""), "Choose a unit") +
      '<div style="padding:14px 16px">' + body + '</div></div>';
  }
  function renderV2Board() {
    if (groupMode()) return renderV2BoardGroup();   // Phase 2: live Firestore unit (additive, gated)
    var list = v2BoardList();
    var counts = { total: list.length, critical: 0, review: 0, stable: 0 };
    list.forEach(function (p) { counts[p.sev]++; });
    var unread = counts.critical + counts.review;
    var uhead = '<div class="icu-v2-uhead"><div class="icu-v2-uhead-top">' +
      '<button class="icu-v2-ubtn" data-icu-act="close" aria-label="Close ' + ctxLabel() + ' — back to home" title="Close ' + ctxLabel() + ' — back to home">' + ico("home", "⌂") + '</button>' +
      '<button class="icu-v2-utitle" data-icu-act="unitpick" aria-label="Switch unit" style="background:none;border:none;color:inherit;text-align:left;cursor:pointer;padding:0;width:100%">My ' + ctxLabel() + ' patients <span aria-hidden="true" style="opacity:.55;font-size:13px">▾</span><div class="icu-v2-usub">' + (_unit.type && _unit.type !== ctxLabel() ? esc(_unit.type) + ' · ' : "") + (_unit.hospital ? esc(_unit.hospital) + ' · ' : "") + counts.total + ' patient' + (counts.total === 1 ? "" : "s") + '</div></button>' +
      '<button class="icu-v2-ubtn" data-icu-act="icualerts" aria-label="Notifications' + (unread ? " (" + unread + " unread)" : "") + '">' + ico("bell", "🔔") + (unread ? '<span class="icu-v2-ubadge">' + unread + '</span>' : "") + '</button>' +
      '</div><div class="icu-v2-strip">' +
      '<button class="icu-v2-scount total' + (_v2Filter === "all" ? " on" : "") + '" data-icu-act="icufilter:all"' + v2StripAria("all", counts.total, "All patients") + '><b>' + counts.total + '</b><span>Patients</span></button>' +
      '<button class="icu-v2-scount crit' + (_v2Filter === "critical" ? " on" : "") + '" data-icu-act="icufilter:critical"' + v2StripAria("critical", counts.critical, "Critical") + '><b>' + counts.critical + '</b><span>Critical</span></button>' +
      '<button class="icu-v2-scount review' + (_v2Filter === "review" ? " on" : "") + '" data-icu-act="icufilter:review"' + v2StripAria("review", counts.review, "Needs review") + '><b>' + counts.review + '</b><span>Review</span></button>' +
      '<button class="icu-v2-scount stable' + (_v2Filter === "stable" ? " on" : "") + '" data-icu-act="icufilter:stable"' + v2StripAria("stable", counts.stable, "Stable") + '><b>' + counts.stable + '</b><span>Stable</span></button>' +
      '</div></div>';
    if (!list.length) {
      return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board"><div class="icu-v2-empty">' +
        '<div class="icu-v2-empty-ic">' + ico("pulse", "🫀") + '</div>' +
        '<div class="icu-v2-empty-t">No patients yet</div>' +
        '<p class="icu-v2-empty-p">Admit your first ' + ctxLabel() + ' patient to start tracking vitals, labs, instructions and a round-ready summary — all on this device.</p>' +
        '<button class="icu-btn icu-v2-empty-cta" data-icu-act="icuadmit">＋ Admit patient</button></div></div></div>';
    }
    var attn = list.filter(function (p) { return p.sev !== "stable"; });
    var attnHTML = (_v2Filter === "all" && attn.length)
      ? '<div class="icu-v2-sec-lbl">Needs your attention</div><div class="icu-v2-attn">' + attn.map(function (p) {
          return '<button class="icu-v2-attn-card ' + p.sev + '" data-icu-act="openpt:' + encodeURIComponent(p.id) + '"' + v2CardAria(p) + '>' +
            '<div class="icu-v2-attn-kind">' + V2_LABEL[p.sev] + '</div>' +
            '<div class="icu-v2-attn-name">Bed ' + esc(p.bed || "—") + ' · ' + esc(p.name || "Patient") + '</div>' +
            '<div class="icu-v2-attn-detail">' + (esc(v2Reason(p.snap)) || "Review recommended") + '</div></button>';
        }).join("") + '</div>'
      : "";
    var chips = [{ k: "all", label: "All" }, { k: "critical", label: "Critical" }, { k: "review", label: "Needs review" }, { k: "stable", label: "Stable" }];
    var filters = '<div class="icu-v2-filters" role="group" aria-label="Filter patients">' + chips.map(function (c) {
      return '<button class="icu-v2-fchip' + (_v2Filter === c.k ? " on" : "") + '" data-icu-act="icufilter:' + c.k + '"' + v2ChipAria(c.k, c.label) + '>' + esc(c.label) + '</button>';
    }).join("") + '</div>';
    var shown = _v2Filter === "all" ? list : list.filter(function (p) { return p.sev === _v2Filter; });
    var ini = esc(v2Initials(v2AccountName()));
    var cards = shown.length ? shown.map(function (p) {
      var demo = (p.age != null) ? (p.age + (p.sex ? "/" + p.sex : "")) : "";
      var vits = v2CardVitals(p.snap);
      var tOpen = (grpActive() && _grpTaskOpen[p.id]) || 0;   // live open-task count (board task listeners)
      return '<button class="icu-v2-card ' + p.sev + '" data-icu-act="openpt:' + encodeURIComponent(p.id) + '"' + v2CardAria(p) + '><div class="icu-v2-card-body"><div class="icu-v2-card-top">' +
        '<div class="icu-v2-bed ' + p.sev + '"><b>' + esc(p.bed || "—") + '</b><span>BED</span></div>' +
        '<div class="icu-v2-card-id"><div class="icu-v2-card-name">' + esc(p.name || "Patient") + (demo ? '<span class="icu-v2-card-demo">' + esc(demo) + '</span>' : "") + '</div>' +
        '<div class="icu-v2-card-dx">' + (p.dx ? esc(p.dx) : "No diagnosis") + '</div></div>' +
        '<span class="icu-v2-pill ' + p.sev + '">' + V2_LABEL[p.sev] + '</span></div>' +
        '<div class="icu-v2-vstrip">' + vits.map(function (v) {
          return '<div class="icu-v2-vc ' + v.st + '"><div class="icu-v2-vk">' + v.k + '</div><div class="icu-v2-vv">' + esc(v.val) + '</div></div>';
        }).join("") + '</div></div>' +
        '<div class="icu-v2-card-foot"><span class="icu-v2-foot-av">' + ini + '</span><span class="icu-v2-foot-txt">Saved</span>' +
        '<span class="icu-v2-foot-ago">' + esc(fmtAgo(p.savedAt) || fmtWhen(p.savedAt)) + '</span></div></button>';
    }).join("") : '<div class="icu-v2-empty2">No patients match this filter.</div>';
    var foot = '<div class="icu-v2-foot-count">Showing ' + shown.length + ' of ' + counts.total + '</div>';
    return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + attnHTML + filters + cards + foot + '</div></div>';
  }
  // Board / alerts / team bottom bar: Unit · Alerts · Team · Admit.
  function renderV2BottomBar() {
    var items = [
      { k: "board", label: "Unit", al: "Unit board", act: "icuboard", svg: "list", em: "🏥" },
      { k: "alerts", label: "Alerts", al: "Alerts / notifications", act: "icualerts", svg: "bell", em: "🔔" },
      { k: "team", label: "Team", al: "Care team", act: "icuteam", svg: "user", em: "👥" },
      { k: "more", label: "Settings", al: "Settings & tools", act: "icumore", svg: "sliders", em: "⚙" }
    ];
    return '<nav class="icu-v2-bottombar" aria-label="ICU navigation">' + items.map(function (it) {
      var on = (it.k === "more") ? (_screen === "patient" && _active === "more") : (_screen === it.k);
      return '<button class="icu-v2-navbtn' + (on ? " on" : "") + '" data-icu-act="' + it.act + '" aria-label="' + esc(it.al) + '"' + (on ? ' aria-current="page"' : '') + '><span class="icu-v2-navic">' + ico(it.svg, it.em) + '</span><span>' + it.label + '</span></button>';
    }).join("") + '<button class="icu-v2-navbtn icu-v2-admit" data-icu-act="icuadmit" aria-label="Admit patient"><span class="icu-v2-admit-ic">' + ico("plus", "＋") + '</span><span>Admit</span></button></nav>';
  }
  // Notifications — deterministic acuity across the roster (local in Phase 1; the LIVE shared unit
  // in group mode). Real event-stream notifications land in a later phase.
  function renderV2Alerts() {
    if (grpActive()) return renderV2AlertsGroup();   // Phase 3: live smart-notification feed
    var list = v2BoardListActive(), rows = [];
    list.forEach(function (p) {
      if (p.sev === "stable") return;
      rows.push({ id: p.id, sev: p.sev, title: V2_LABEL[p.sev] + " · Bed " + (p.bed || "—") + " · " + (p.name || "Patient"), body: v2Reason(p.snap) || "Review recommended" });
    });
    rows.sort(function (a, b) { return (a.sev === "critical" ? 0 : 1) - (b.sev === "critical" ? 0 : 1); });
    var header = '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="icuboard" aria-label="Back to unit board">‹</button><div><div class="icu-v2-shead-h">Notifications</div><div class="icu-v2-shead-s">Only clinically meaningful events</div></div></div>';
    var note = '<div class="icu-v2-note">' + ico("info", "ⓘ") + (grpActive()
      ? ' Derived from each patient’s latest values in this shared unit.'
      : ' Derived from each patient’s latest values on this device.') + '</div>';
    var body = rows.length ? rows.map(function (r) {
      return '<button class="icu-v2-alert-row ' + r.sev + '" data-icu-act="openpt:' + encodeURIComponent(r.id) + '" aria-label="' + esc((r.sev === "critical" ? "Urgent: " : "") + r.title + ". " + (r.body || "") + " — open patient") + '">' +
        '<span class="icu-v2-alert-ic" aria-hidden="true">' + (r.sev === "critical" ? ico("warn", "⚠️") : ico("bell", "🔔")) + '</span>' +
        '<span class="icu-v2-alert-tx"><span class="icu-v2-alert-h">' + esc(r.title) + (r.sev === "critical" ? '<span class="icu-v2-urg">URGENT</span>' : "") + '</span>' +
        '<span class="icu-v2-alert-b">' + esc(r.body) + '</span></span></button>';
    }).join("") : '<div class="icu-v2-empty2">No active alerts across your patients.</div>';
    return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + header + '<div class="icu-v2-slist">' + note + body + '</div></div>';
  }
  // Care team — Phase 1 shows the signed-in user only; group mode shows the real unit roster + roles.
  function renderV2Team() {
    if (grpActive()) return renderV2TeamGroup();
    var name = v2AccountName(), p = v2AccountProfile(), email = (p && p.email) || "";
    var header = '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="icuboard" aria-label="Back to unit board">‹</button><div><div class="icu-v2-shead-h">Care team</div><div class="icu-v2-shead-s">This device</div></div></div>';
    var member = '<div class="icu-v2-member"><span class="icu-v2-member-av">' + esc(v2Initials(name)) + '</span>' +
      '<span class="icu-v2-member-id"><span class="icu-v2-member-nm">' + esc(name) + '</span><span class="icu-v2-member-role">' + (email ? esc(email) : "Signed in on this device") + '</span></span>' +
      '<span class="icu-v2-member-state">You</span></div>';
    var note = '<div class="icu-v2-note">' + ico("info", "ⓘ") + ' Multi-doctor units — roles (who can give instructions vs. update status) and a shared audit trail — are available in Group mode. Turn it on in More.</div>';
    return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + header + '<div class="icu-v2-tlist">' + member + note + '</div></div>';
  }
  /* ============================================================ ICU v2 GROUP MODE
   * (smd_icu_groups, Phase 2) — the LIVE Firestore collaboration layer wired into the v2
   * board/workspace. Everything here is ADDITIVE and gated on groupMode(); with the groups flag
   * OFF, groupMode() is false and NONE of this runs — the Phase-1 LOCAL path (and, with v2 off,
   * the classic UI) is byte-for-byte unchanged. icu-collab.js (window.SMD_ICU_GROUPS) owns all
   * Firestore I/O; this section is presentation + lifecycle only. Never throws to the board.
   */
  function grpRoleLabel(r) {
    var api = groupsApi(); if (api && api.roleLabel) { try { return api.roleLabel(r); } catch (e) {} }
    var M = { head: "Unit Head", professor: "Professor", assistant: "Assistant Professor", senior_resident: "Senior Resident", junior_resident: "Junior Resident", intern: "Intern" };
    return M[r] || (r ? String(r) : "Member");
  }
  function grpCanInstruct(role) { var api = groupsApi(); if (api && api.canInstruct) { try { return !!api.canInstruct(role); } catch (e) {} } return ["head", "professor", "assistant", "senior_resident"].indexOf(role) >= 0; }
  // Phase 5: admin (head|professor) may manage membership. UI-gate only — rules are the boundary.
  function grpIsAdmin(role) { var api = groupsApi(); if (api && api.isAdminRole) { try { return !!api.isAdminRole(role); } catch (e) {} } return ["head", "professor"].indexOf(role) >= 0; }
  function grpPrefKey() { return "smd_icu_active_group:" + (typeof ownerNow === "function" ? ownerNow() : "anon"); }
  function grpPrefId() { try { return localStorage.getItem(grpPrefKey()) || ""; } catch (e) { return ""; } }
  function grpById(id) { var l = _grpList || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function grpErrText(e) {
    var m = (e && (e.code || e.message)) || "";
    if (/permission|denied|forbidden/i.test(m)) return "You don’t have permission for that in this unit.";
    return "Couldn’t reach the shared unit — your changes are kept and will sync when you’re back online.";
  }
  // Only DERIVED alerts + volatile meta are excluded from the hash, so the mirror fires on real
  // clinical changes but not on its own echo (or a no-op meta.updated bump).
  function grpMirrorPayload(st) { var c; try { c = JSON.parse(JSON.stringify(st || {})); } catch (e) { c = {}; } c.alerts = []; if (c.meta) delete c.meta; return c; }
  // Order-INSENSITIVE stringify: Firestore returns map keys in canonical (sorted) order, which
  // differs from local insertion order. A plain JSON.stringify then makes the round-tripped remote
  // state hash DIFFERENTLY from the identical local state, so the echo-check below always fired →
  // grpApplyState re-applied every snapshot → the mirror re-wrote (severity/updatedAt) → echoed back
  // → a ~1.4s write loop that hammered Firestore/CapacitorHttp and stalled scrolling. Sorting keys
  // makes equal data hash equal, so a pure echo is suppressed. (Only affects comparison, never what
  // is written — grpMirrorPayload is unchanged.)
  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) { var a = []; for (var i = 0; i < v.length; i++) a.push(stableStringify(v[i])); return "[" + a.join(",") + "]"; }
    var ks = Object.keys(v).sort(), out = [];
    for (var j = 0; j < ks.length; j++) out.push(JSON.stringify(ks[j]) + ":" + stableStringify(v[ks[j]]));
    return "{" + out.join(",") + "}";
  }
  function grpStateHash(st) {
    var s; try { s = stableStringify(grpMirrorPayload(st)); } catch (e) { s = ""; }
    var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36) + ":" + s.length;
  }
  // Load a shared patient's state into ICU_STATE so every existing renderer/tab shows it. Sets the
  // echo-suppression hash so the resulting reactive notify() does NOT bounce back to Firestore.
  function grpApplyState(state, id) {
    try {
      // Defense-in-depth: never let a BLANK/stale remote snapshot wipe good local data for the SAME
      // patient (e.g. a Ward-Sync fill still queued to sync up). If the incoming remote state has no
      // clinical content but we currently hold some for this id, keep local and let the mirror push it.
      if (state && !stateHasData(state) && hasData() && (STATE.patient && STATE.patient._id === id)) return;
      Object.keys(DEFAULT_STATE).forEach(function (k) { STATE[k] = (state[k] != null) ? clone(state[k]) : clone(DEFAULT_STATE[k]); });
      STATE.patient._id = id;
      _grpLastHash = grpStateHash(_raw);
      _grpPrevSync = grpMirrorPayload(_raw);   // Phase 3: re-baseline the auto-timeline diff to the applied remote state (no re-emit)
    } catch (e) {}
  }
  // The list source the board/alerts consume: LIVE shared unit when a group is active; empty while
  // group mode is on but no unit is selected; the LOCAL roster otherwise (Phase-1 behaviour).
  function v2BoardListActive() {
    if (grpActive()) return grpEnrichedList();
    if (groupMode()) return [];
    return v2BoardList();
  }
  // Live docs → the same enriched card shape v2BoardList produces (deterministic acuity via the
  // SAME v2Severity/v2Snapshot — single source of truth for scoring; the doc's stored severity is
  // only a hint used server-side/for notifications).
  function grpEnrichedList() {
    var list = (_grpPatients || []).map(function (p) {
      return { id: p.id, name: p.name, dx: p.dx, bed: p.bed, savedAt: p.savedAt || p.reviewedAt || null, state: p.state || {}, lastUpdate: p.lastUpdate, reviewedAt: p.reviewedAt, reviewedByName: p.reviewedByName, assignedTo: p.assignedTo };
    });
    list.forEach(function (p) {
      p.sev = v2Severity(p.state); p.snap = v2Snapshot(p.state);
      p.age = (p.state.patient && p.state.patient.age != null) ? p.state.patient.age : null;
      p.sex = (p.state.patient && p.state.patient.sex) || "";
      p.reviewed = !!p.reviewedAt;
    });
    var rank = { critical: 0, review: 1, stable: 2 };
    list.sort(function (a, b) { var d = (rank[a.sev] || 9) - (rank[b.sev] || 9); return d ? d : (v2BedNum(a.bed) - v2BedNum(b.bed)); });
    return list;
  }

  /* --------------------------- Phase 4: a11y attribute helpers -------------------------------- */
  // Acuity-strip count buttons + filter chips: descriptive label + toggle state (aria-pressed).
  function v2StripAria(key, count, name) { return ' aria-pressed="' + (_v2Filter === key) + '" aria-label="' + esc(name + ", " + count + ". Filter the unit.") + '"'; }
  function v2ChipAria(key, label) { return ' aria-pressed="' + (_v2Filter === key) + '" aria-label="' + esc("Show " + label + " patients") + '"'; }
  // Patient / attention cards: an explicit open-target label instead of concatenated inner text.
  function v2CardAria(p) { return ' aria-label="' + esc("Open Bed " + (p.bed || "—") + ", " + (p.name || "Patient") + ", " + (V2_LABEL[p.sev] || "")) + '"'; }

  /* --------------------------- Phase 4: loading / offline / error state helpers --------------- */
  // A single calm shimmer placeholder shaped like a patient card. DOM-free; no data leaks.
  function v2SkeletonCard() {
    return '<div class="icu-v2-skel" aria-hidden="true"><div class="icu-v2-skel-top">' +
      '<div class="icu-v2-shim icu-v2-skel-bed"></div>' +
      '<div class="icu-v2-skel-id"><div class="icu-v2-shim icu-v2-skel-l" style="width:58%"></div><div class="icu-v2-shim icu-v2-skel-l" style="width:82%;margin-bottom:0"></div></div></div>' +
      '<div class="icu-v2-shim icu-v2-skel-strip"></div></div>';
  }
  function v2SkeletonCards(n) { var out = ""; for (var i = 0; i < (n || 3); i++) out += v2SkeletonCard(); return out; }
  // Centered spinner + label — for a "connecting" phase where a card shape would be misleading.
  function v2Spinner(text) {
    return '<div class="icu-v2-loading" role="status"><div class="icu-v2-spin" aria-hidden="true"></div><div>' + esc(text || "Loading…") + '</div></div>';
  }
  // Offline = navigator.onLine false OR the collab layer reports offline. Group mode only (the LOCAL
  // board is on-device and always "synced", so no offline strip there).
  function grpIsOffline() {
    try { if (typeof navigator !== "undefined" && navigator.onLine === false) return true; } catch (e) {}
    try { var api = groupsApi(); if (api && api.syncState && api.syncState() === "offline") return true; } catch (e) {}
    return false;
  }
  function grpOfflineBar() {
    if (!grpActive() || !grpIsOffline()) return "";
    return '<div class="icu-v2-offline" role="status">' + ico("warn", "⚠") + '<span>Offline — changes will sync when you reconnect</span></div>';
  }
  // Non-technical error card. Permission errors are informational (no Retry helps); connection
  // errors get a Retry that re-subscribes. Never renders a raw error string or a blank board.
  function grpErrIsPermission() { return /permission/i.test(_grpErr || ""); }
  function grpErrCard() {
    var perm = grpErrIsPermission();
    return '<div class="icu-v2-errcard" role="alert">' +
      '<div class="icu-v2-empty-ic">' + ico("warn", "⚠️") + '</div>' +
      '<div class="icu-v2-err-t">' + (perm ? "You don’t have access here" : "Couldn’t reach the unit") + '</div>' +
      '<p class="icu-v2-err-p">' + esc(_grpErr || (perm ? "Ask the unit head to add you." : "Check your connection and try again.")) + '</p>' +
      (perm ? '' : '<button class="icu-btn icu-v2-empty-cta" data-icu-act="grpretry" aria-label="Retry connecting to the unit">' + ico("refresh", "↻") + ' Retry</button>') +
      '</div>';
  }
  // Open-patient workspace while its live view-model has not returned yet — calm loading, not a
  // blank/stale screen. Keeps the sync indicator visible so the clinician knows it is fetching.
  function renderV2PatientLoading() {
    return '<div class="icu-v2-banner stable"><div class="icu-v2-banner-top">' +
      '<button class="icu-v2-back" data-icu-act="icuboard" aria-label="Back to unit board">‹</button>' +
      '<div class="icu-v2-banner-id"><div class="icu-v2-banner-nm">Loading patient…</div>' +
      '<div class="icu-v2-banner-meta">Fetching the latest shared record</div></div></div></div>' +
      renderV2PresenceGroup() +
      '<div class="icu-scroll icu-v2-scroll"><div class="icu-v2-board">' + grpOfflineBar() + v2SkeletonCards(2) + '</div></div>';
  }
  // Board-only, READ-ONLY per-patient task listeners → a live open-task badge on each card.
  // Writes NOTHING (so it can never re-introduce a sync loop); it just counts open tasks per
  // patient and repaints the board (deferred while scrolling, via paintLive). Listeners are
  // added/removed to match the current roster and cleared when the unit changes or ICU closes.
  function grpTaskOpenCount(tasks) { var n = 0, a = tasks || []; for (var i = 0; i < a.length; i++) { if (a[i] && a[i].status !== "done") n++; } return n; }
  function grpSyncTaskSubs(list) {
    var api = groupsApi(); if (!api || !api.subscribeTasks || !_grp) return;
    var want = {}; (list || []).forEach(function (p) { if (p && p.id) want[p.id] = 1; });
    Object.keys(want).forEach(function (pid) {
      if (_grpTaskSubs[pid]) return;
      _grpTaskSubs[pid] = api.subscribeTasks(_grp.id, pid, function (tasks) {
        var n = grpTaskOpenCount(tasks);
        if (_grpTaskOpen[pid] === n) return;                         // unchanged → no repaint
        _grpTaskOpen[pid] = n;
        if (ICU.isOpen() && _screen === "board") paintLive();
      });
    });
    Object.keys(_grpTaskSubs).forEach(function (pid) {
      if (want[pid]) return;                                         // patient left the board → drop its listener
      try { _grpTaskSubs[pid](); } catch (e) {}
      delete _grpTaskSubs[pid]; delete _grpTaskOpen[pid];
    });
  }
  function grpClearTaskSubs() {
    Object.keys(_grpTaskSubs).forEach(function (pid) { try { _grpTaskSubs[pid](); } catch (e) {} });
    _grpTaskSubs = {}; _grpTaskOpen = {};
  }
  // Retry: clear the error and re-open the failed subscription(s). Safe/idempotent.
  function grpRetry() {
    _grpErr = null;
    try { if (!_grpSubGroups) grpEnsureGroupsSub(); } catch (e) {}
    var api = groupsApi();
    if (grpActive() && api) {
      if (_grpSubPts) { try { _grpSubPts(); } catch (e) {} _grpSubPts = null; }
      _grpPatients = null;
      _grpSubPts = api.subscribePatients(_grp.id, function (list) {
        _grpPatients = list || []; grpNotifTick(); grpSyncTaskSubs(_grpPatients);
        if (ICU.isOpen() && _screen === "board") paintLive();
      }, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen()) paint(); });
    }
    _paintTop = true; paint();
  }

  /* --------------------------- subscription lifecycle (no listener leaks) --------------------- */
  var _grpCreating = false;      // guard: a createGroup is in flight — block duplicate unit creation
  var _grpJustCreated = null;    // {id, ts}: a just-created unit not yet propagated to the collectionGroup listener
  function grpEnsureGroupsSub() {
    if (!groupMode()) return;
    var api = groupsApi(); if (!api) return;
    try { if (api.setSeverityFn) api.setSeverityFn(function (st) { try { return v2Severity(st); } catch (e) { return null; } }); } catch (e) {}
    // Phase 5: mint the account-linked StewardMD Doctor ID lazily (first team engagement).
    try { if (api.ensureIdentity) api.ensureIdentity(function (id) { _grpDoctorId = id || null; if (ICU.isOpen() && _screen === "team") paint(); }); } catch (e) {}
    if (_grpSubGroups) return;
    _grpSubGroups = api.subscribeGroups(function (groups) {
      _grpList = groups || [];
      if (_grp) {
        var prev = _grp, found = null, i; for (i = 0; i < _grpList.length; i++) if (_grpList[i].id === prev.id) { found = _grpList[i]; break; }
        if (found) {                                            // reconcile the optimistic/selected unit to the live doc
          _grp = found;
          try { if (api.setActiveGroup) api.setActiveGroup(_grp.id, _grp.myRole); } catch (e) {}
          if (_grpJustCreated && _grpJustCreated.id === found.id) _grpJustCreated = null;
        } else if (_grpJustCreated && _grpJustCreated.id === prev.id && (nowTs() - _grpJustCreated.ts) < 20000) {
          _grp = prev;                                          // a unit we JUST created hasn't reached the collectionGroup listener yet — KEEP it (don't make the create "vanish")
        } else {                                                // Phase 5: genuinely left/removed/deleted → drop roster + go back to the board
          if (_grpSubMembers) { try { _grpSubMembers(); } catch (e) {} _grpSubMembers = null; }
          _grpMembers = null; grpTeardownPatient(); grpClearTaskSubs(); _grp = null; _screen = "board";
        }
      }
      if (!_grp && _grpList.length) {
        var pref = grpPrefId(), sel = null, j; for (j = 0; j < _grpList.length; j++) if (_grpList[j].id === pref) { sel = _grpList[j]; break; }
        grpSelect(sel || _grpList[0], true);
      }
      if (ICU.isOpen() && (_screen === "board" || _screen === "team")) paintLive();
    }, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen() && _screen === "board") paintLive(); });   // Phase 4: surface a groups-load failure as the error card
  }
  function grpSelect(group, silent) {
    if (!group) return;
    // A shared unit IS a unit context — adopt its category/type so the dashboard opens in the right
    // mode (ward hides the ventilator, relabels), and the ICU/Ward split follows the group's kind.
    _unit = { cat: group.kind || "icu", type: group.unitType || (group.kind === "ward" ? "Ward" : "ICU"), hospital: group.hospital || _unit.hospital || "" };
    _lastType[_unit.cat] = _unit.type;
    _wardMode = (_unit.cat === "ward");
    try { unitSavePref(); } catch (e) {}
    var changed = !_grp || _grp.id !== group.id;
    _grp = group;
    try { localStorage.setItem(grpPrefKey(), group.id); } catch (e) {}
    var api = groupsApi();
    try { if (api && api.setActiveGroup) api.setActiveGroup(group.id, group.myRole); } catch (e) {}
    if (changed) {
      grpTeardownPatient();
      grpClearTaskSubs();   // switching units → drop the previous unit's board task listeners
      _grpNotifiedTs = nowTs();   // Phase 3: seed device-notify baseline so the first snapshot never retro-fires the roster
      if (_grpSubPts) { try { _grpSubPts(); } catch (e) {} _grpSubPts = null; }
      _grpPatients = null; _grpErr = null;
      if (api) _grpSubPts = api.subscribePatients(group.id, function (list) {
        _grpPatients = list || [];
        grpNotifTick();   // Phase 3: best-effort device notification for a NEW critical event
        grpSyncTaskSubs(_grpPatients);   // keep the board's per-patient open-task listeners in sync with the roster
        if (ICU.isOpen() && _screen === "board") paintLive();
      }, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen() && _screen === "board") paintLive(); });   // Phase 4: unit-load failure → error card + Retry
      // Phase 5: the live unit roster (members subcollection) — for the Team screen + avatars.
      if (_grpSubMembers) { try { _grpSubMembers(); } catch (e) {} _grpSubMembers = null; }
      _grpMembers = null;
      if (api && api.subscribeMembers) _grpSubMembers = api.subscribeMembers(group.id, function (list) {
        _grpMembers = list || [];
        if (ICU.isOpen() && (_screen === "team" || _screen === "board")) paintLive();
      });
      // Offer ICU push once, the first time this doctor enters an active shared unit (root cause
      // of the "task assigned but nobody notified" gap: there was previously NO on-ramp to push
      // registration from ICU collaboration at all). Small delay so it doesn't compete with the
      // board's own loading/skeleton paint.
      setTimeout(function () { try { grpMaybeOfferPush(); } catch (e) {} }, 1500);
    }
    if (!silent) { _screen = "board"; _paintTop = true; paint(); }
  }
  // Push opt-in — explain-then-ask, ICU-specific (mirrors the Lab Watch 24/7 / Auto-fetch consent
  // sheets' tone). Reuses the EXISTING native registration path (window.SMD_enableNativePush,
  // native-push.js) — there is exactly one place a device token is ever requested/stored; this
  // sheet only supplies ICU-specific context for WHY, so residents connect "enable notifications"
  // to "get pinged when a consultant assigns me a task" rather than a generic pitch. Shown once
  // per account (accept OR decline) so it never nags on every unit open.
  function grpPushPromptSeen() { try { return localStorage.getItem("smd_icu_push_prompt_seen") === "1"; } catch (e) { return false; } }
  function grpMarkPushPromptSeen() { try { localStorage.setItem("smd_icu_push_prompt_seen", "1"); } catch (e) {} }
  function grpMaybeOfferPush() {
    if (!window.SMD_NATIVE_PUSH) return;                            // native push plugin not present on this build/platform
    if (window.SMD_nativePushOn && SMD_nativePushOn()) return;       // already enabled
    if (grpPushPromptSeen()) return;
    if (document.getElementById("icuPushSheet")) return;
    grpMarkPushPromptSeen();
    var wrap = document.createElement("div");
    wrap.id = "icuPushSheet";
    wrap.setAttribute("style", "position:fixed;inset:0;z-index:20000;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
    wrap.innerHTML =
      '<div role="dialog" aria-label="Enable ICU task alerts" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25)">'
      + '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:6px">🔔 Get notified for ICU tasks</div>'
      + '<div style="font:500 12.5px/1.55 var(--sans,system-ui);color:var(--slate,#5a7184)">Get notified the instant your consultant assigns you a task in this unit — even when the app is closed. You can turn this off anytime in Settings.</div>'
      + '<div style="display:flex;gap:10px;margin-top:14px">'
      + '<button id="icuPushLater" style="flex:1;padding:12px;border:1px solid var(--line,#e4eae8);border-radius:11px;background:var(--panel,#fff);color:var(--ink,#16232e);font:700 14px var(--sans,system-ui);cursor:pointer">Not now</button>'
      + '<button id="icuPushYes" style="flex:2;padding:12px;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Enable</button>'
      + '</div></div>';
    document.body.appendChild(wrap);
    var close = function () { try { wrap.remove(); } catch (e) {} };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector("#icuPushLater").addEventListener("click", close);
    wrap.querySelector("#icuPushYes").addEventListener("click", function () {
      close();
      try {
        window.SMD_enableNativePush().then(function (granted) {
          if (window.toast) toast(granted ? "Notifications enabled ✅" : "Notifications not enabled.");
        }, function () { if (window.toast) toast("Couldn’t enable notifications."); });
      } catch (e) {}
    });
  }
  function grpTeardownPatient() {
    if (_grpSubPt) { try { _grpSubPt(); } catch (e) {} _grpSubPt = null; }
    if (_grpSubPres) { try { _grpSubPres(); } catch (e) {} _grpSubPres = null; }
    if (_grpMirrorT) { try { clearTimeout(_grpMirrorT); } catch (e) {} _grpMirrorT = null; }
    var api = groupsApi(); if (api && api.leavePatient) { try { api.leavePatient(); } catch (e) {} }
    _grpPtId = null; _grpPtVM = null; _grpPresence = []; _grpLastHash = null; _grpPrevSync = null;
  }
  // Open a shared patient: subscribe to the doc (+ timeline + tasks) + presence, join presence.
  function grpOpenPatient(id) {
    if (!grpActive() || !id) return;
    if (id === _grpPtId) { _paintTop = true; paint(); return; }
    grpTeardownPatient();
    _grpPtId = id; _grpPtVM = null; _grpPresence = []; _grpErr = null;
    var api = groupsApi(), gid = _grp.id;
    if (api) {
      _grpSubPt = api.subscribePatient(gid, id, function (vm) {
        _grpPtVM = vm || null;
        if (vm && vm.patient && vm.patient.state && grpStateHash(vm.patient.state) !== grpStateHash(_raw)) grpApplyState(vm.patient.state, id);
        grpNotifTick();
        if (ICU.isOpen() && _screen === "patient") paintLive();
      });
      _grpSubPres = api.subscribePresence(gid, id, function (viewers) {
        _grpPresence = viewers || [];
        if (ICU.isOpen() && _screen === "patient") paintLive();
      });
      try { api.enterPatient(gid, id); } catch (e) {}
    }
    _active = "overview"; _ws = "overview"; _wsLast = {}; _paintTop = true; paint();
  }
  // Admit a NEW patient into the active unit: a blank workspace whose first edit creates the doc.
  function grpAdmit() {
    if (!grpActive()) return;
    grpTeardownPatient();
    var id = "p" + nowTs();
    _grpPtId = id; _grpPtVM = { patient: null, timeline: [], tasks: [] }; _grpPresence = [];
    Object.keys(DEFAULT_STATE).forEach(function (k) { STATE[k] = clone(DEFAULT_STATE[k]); });
    STATE.patient._id = id;
    _grpLastHash = grpStateHash(_raw);                          // baseline to the BLANK state: the empty admit is NOT written; the first real edit / Ward-Sync fill changes the hash and creates the doc (no more blank "Patient · No diagnosis" cards from abandoned admits)
    _grpPrevSync = grpMirrorPayload(_raw);                      // Phase 3: blank baseline so the first edits self-log to the timeline
    var api = groupsApi(), gid = _grp.id;
    if (api) {
      _grpSubPt = api.subscribePatient(gid, id, function (vm) {
        _grpPtVM = vm || _grpPtVM;
        if (vm && vm.patient && vm.patient.state && grpStateHash(vm.patient.state) !== grpStateHash(_raw)) grpApplyState(vm.patient.state, id);
        grpNotifTick();
        if (ICU.isOpen() && _screen === "patient") paintLive();
      });
      _grpSubPres = api.subscribePresence(gid, id, function (v) { _grpPresence = v || []; if (ICU.isOpen() && _screen === "patient") paintLive(); });
      try { api.enterPatient(gid, id); } catch (e) {}
    }
    _active = "overview"; _ws = "overview"; _wsLast = {}; closeForm(); _paintTop = true; paint();
    openForm("patient");
  }

  /* --------------------------- group-mode renderers (reuse the v2 classes) -------------------- */
  function grpAvatarsHTML() {
    // Phase 5: member count comes from the live roster (members subcollection), not the group doc.
    var count = (_grpMembers && _grpMembers.length) ? _grpMembers.length : 1;
    var meIni = esc(v2Initials(v2AccountName())), others = count - 1;
    return '<button class="icu-v2-avatars" data-icu-act="icuteam" aria-label="Care team"><span class="icu-v2-av">' + meIni + '</span>' +
      (others > 0 ? '<span class="icu-v2-av more">+' + others + '</span>' : "") + '</button>';
  }
  function renderV2BoardGroup() {
    var loadingGroups = (_grpList === null);
    var list = grpActive() ? grpEnrichedList() : [];
    // Phase 4: a hard error (nothing to show yet) → a full error card + Retry, not a blank/empty board.
    // A transient error while data is already on screen degrades to a non-blocking inline note.
    var errFull = _grpErr && !list.length;
    var errNote = (_grpErr && !errFull) ? '<div class="icu-v2-note" style="border-color:var(--warn);color:var(--warn)">' + ico("warn", "⚠️") + ' ' + esc(_grpErr) + '</div>' : "";
    var offBar = grpOfflineBar();
    // Header: unit switcher + member avatars + notifications.
    var gname = _grp ? (_grp.name || _grp.unit || "ICU unit") : (loadingGroups ? "Connecting…" : "Choose a unit");
    var gsub = _grp
      ? ((_grp.unit ? esc(_grp.unit) + " · " : "") + (grpActive() && _grpPatients ? _grpPatients.length + " patient" + (_grpPatients.length === 1 ? "" : "s") : "…") + (_grp.myRole ? " · " + esc(grpRoleLabel(_grp.myRole)) : ""))
      : "Tap to open or create a shared unit";
    var counts = { total: list.length, critical: 0, review: 0, stable: 0 };
    list.forEach(function (p) { counts[p.sev]++; });
    // Phase 3: the bell badge = count of meaningful UNSEEN events (per-user last-seen), not raw acuity.
    var unread = grpActive() ? grpUnreadCount(grpNotifRows(), grpNotifSeen()) : (counts.critical + counts.review);
    var uhead = '<div class="icu-v2-uhead"><div class="icu-v2-uhead-top">' +
      '<button class="icu-v2-ubtn" data-icu-act="close" aria-label="Close ICU — back to home" title="Close ICU — back to home">' + ico("home", "⌂") + '</button>' +
      '<button class="icu-v2-utitle icu-v2-gswitch" data-icu-act="grppick" aria-label="Switch or create a unit">' + esc(gname) + ' ▾<div class="icu-v2-usub">' + gsub + '</div></button>' +
      (grpActive() ? grpAvatarsHTML() : "") +
      '<button class="icu-v2-ubtn" data-icu-act="icualerts" aria-label="Notifications' + (unread ? " (" + unread + " unread)" : "") + '">' + ico("bell", "🔔") + (unread ? '<span class="icu-v2-ubadge">' + unread + '</span>' : "") + '</button>' +
      '</div>' + (grpActive() ? (
        '<div class="icu-v2-strip">' +
        '<button class="icu-v2-scount total' + (_v2Filter === "all" ? " on" : "") + '" data-icu-act="icufilter:all"' + v2StripAria("all", counts.total, "All patients") + '><b>' + counts.total + '</b><span>Patients</span></button>' +
        '<button class="icu-v2-scount crit' + (_v2Filter === "critical" ? " on" : "") + '" data-icu-act="icufilter:critical"' + v2StripAria("critical", counts.critical, "Critical") + '><b>' + counts.critical + '</b><span>Critical</span></button>' +
        '<button class="icu-v2-scount review' + (_v2Filter === "review" ? " on" : "") + '" data-icu-act="icufilter:review"' + v2StripAria("review", counts.review, "Needs review") + '><b>' + counts.review + '</b><span>Review</span></button>' +
        '<button class="icu-v2-scount stable' + (_v2Filter === "stable" ? " on" : "") + '" data-icu-act="icufilter:stable"' + v2StripAria("stable", counts.stable, "Stable") + '><b>' + counts.stable + '</b><span>Stable</span></button>' +
        '</div>') : "") + '</div>';
    // Hard error state — takes precedence over loading/empty (never a raw error / blank screen).
    if (errFull) {
      return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + offBar + grpErrCard() + '</div></div>';
    }
    // No unit selected → an inviting "open or create a unit" state (calm spinner while connecting).
    if (!grpActive()) {
      var body = loadingGroups
        ? v2Spinner("Connecting to your shared units…")
        : '<div class="icu-v2-empty"><div class="icu-v2-empty-ic">' + ico("users", "👥") + '</div>' +
          '<div class="icu-v2-empty-t">Work your ICU as a team</div>' +
          '<p class="icu-v2-empty-p">Open or create a shared unit so your consultants and residents see the same patients, instructions and timeline — live, with a full audit trail.</p>' +
          '<button class="icu-btn icu-v2-empty-cta" data-icu-act="grppick">' + ico("folder", "📋") + ' Open a unit</button>' +
          '<button class="icu-btn ghost" data-icu-act="grpnew" style="margin-top:10px">' + ico("plus", "＋") + ' Create a unit</button></div>';
      return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + offBar + body + '</div></div>';
    }
    // Live unit board — calm skeleton while the first snapshot has not returned.
    if (_grpPatients === null) {
      return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + offBar + '<div class="icu-v2-sec-lbl">Loading unit…</div>' + v2SkeletonCards(3) + '</div></div>';
    }
    if (!list.length) {
      return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + offBar + '<div class="icu-v2-empty">' +
        '<div class="icu-v2-empty-ic">' + ico("pulse", "🫀") + '</div><div class="icu-v2-empty-t">No patients in this unit yet</div>' +
        '<p class="icu-v2-empty-p">Admit the first patient — everyone in ' + esc(gname) + ' will see them instantly.</p>' +
        '<button class="icu-btn icu-v2-empty-cta" data-icu-act="icuadmit">＋ Admit patient</button></div></div></div>';
    }
    var attn = list.filter(function (p) { return p.sev !== "stable"; });
    var attnHTML = (_v2Filter === "all" && attn.length)
      ? '<div class="icu-v2-sec-lbl">Needs your attention</div><div class="icu-v2-attn">' + attn.map(function (p) {
          return '<button class="icu-v2-attn-card ' + p.sev + '" data-icu-act="openpt:' + encodeURIComponent(p.id) + '"' + v2CardAria(p) + '>' +
            '<div class="icu-v2-attn-kind">' + V2_LABEL[p.sev] + '</div>' +
            '<div class="icu-v2-attn-name">Bed ' + esc(p.bed || "—") + ' · ' + esc(p.name || "Patient") + '</div>' +
            '<div class="icu-v2-attn-detail">' + (esc(v2Reason(p.snap)) || "Review recommended") + '</div></button>';
        }).join("") + '</div>'
      : "";
    var chips = [{ k: "all", label: "All" }, { k: "critical", label: "Critical" }, { k: "review", label: "Needs review" }, { k: "stable", label: "Stable" }];
    var filters = '<div class="icu-v2-filters" role="group" aria-label="Filter patients">' + chips.map(function (c) {
      return '<button class="icu-v2-fchip' + (_v2Filter === c.k ? " on" : "") + '" data-icu-act="icufilter:' + c.k + '"' + v2ChipAria(c.k, c.label) + '>' + esc(c.label) + '</button>';
    }).join("") + '</div>';
    var shown = _v2Filter === "all" ? list : list.filter(function (p) { return p.sev === _v2Filter; });
    var cards = shown.length ? shown.map(function (p) {
      var demo = (p.age != null) ? (p.age + (p.sex ? "/" + p.sex : "")) : "";
      var vits = v2CardVitals(p.snap);
      var tOpen = (grpActive() && _grpTaskOpen[p.id]) || 0;   // live open-task count (board task listeners)
      var lu = p.lastUpdate || null;
      var footAv = esc(v2Initials(lu && lu.byName ? lu.byName : v2AccountName()));
      var footTxt = lu && lu.text ? esc(lu.text) : (p.reviewed ? "Reviewed" : "Updated");
      var footAgo = esc(fmtAgo((lu && lu.at) || p.savedAt) || fmtWhen((lu && lu.at) || p.savedAt));
      return '<button class="icu-v2-card ' + p.sev + '" data-icu-act="openpt:' + encodeURIComponent(p.id) + '"' + v2CardAria(p) + '><div class="icu-v2-card-body"><div class="icu-v2-card-top">' +
        '<div class="icu-v2-bed ' + p.sev + '"><b>' + esc(p.bed || "—") + '</b><span>BED</span></div>' +
        '<div class="icu-v2-card-id"><div class="icu-v2-card-name">' + esc(p.name || "Patient") + (demo ? '<span class="icu-v2-card-demo">' + esc(demo) + '</span>' : "") + '</div>' +
        '<div class="icu-v2-card-dx">' + (p.dx ? esc(p.dx) : "No diagnosis") + '</div></div>' +
        '<span class="icu-v2-pill ' + p.sev + '">' + V2_LABEL[p.sev] + '</span></div>' +
        '<div class="icu-v2-vstrip">' + vits.map(function (v) {
          return '<div class="icu-v2-vc ' + v.st + '"><div class="icu-v2-vk">' + v.k + '</div><div class="icu-v2-vv">' + esc(v.val) + '</div></div>';
        }).join("") + '</div></div>' +
        '<div class="icu-v2-card-foot"><span class="icu-v2-foot-av">' + footAv + '</span><span class="icu-v2-foot-txt">' + footTxt + '</span>' +
        (tOpen > 0 ? '<span class="icu-v2-foot-tasks" aria-label="' + tOpen + ' open task' + (tOpen > 1 ? 's' : '') + '">' + ico("rounds", "🗒") + ' ' + tOpen + ' task' + (tOpen > 1 ? 's' : '') + '</span>' : '') +
        '<span class="icu-v2-foot-ago">' + (p.reviewed ? "" : '<span class="icu-v2-unrev">Not reviewed</span> ') + footAgo + '</span></div></button>';
    }).join("") : '<div class="icu-v2-empty2">No patients match this filter.</div>';
    var foot = '<div class="icu-v2-foot-count">Showing ' + shown.length + ' of ' + counts.total + '</div>';
    return '<div class="icu-scroll icu-v2-scroll">' + uhead + '<div class="icu-v2-board">' + offBar + errNote + grpPushNoteHTML() + attnHTML + filters + cards + foot + '</div></div>';
  }
  // Phase 5: the Team screen — your StewardMD Doctor ID (copyable), the live unit roster (from the
  // members subcollection), admin add/invite/remove actions, and leave/delete. Role-gated in the UI
  // (rules enforce server-side). Reuses the v2 member/note/sheet classes; new bits are additive CSS.
  function grpMemberOnline(uid, me) {
    if (uid === me) return true;
    var v = _grpPresence || []; for (var i = 0; i < v.length; i++) if (v[i].uid === uid) return true;
    return false;
  }
  function renderV2TeamGroup() {
    var g = _grp, me = ownerNow();
    var canManage = grpIsAdmin(g && g.myRole);
    var iAmHead = (g && g.myRole) === "head";
    var members = _grpMembers;                         // null = loading
    var count = members ? members.length : null;
    var header = '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="icuboard" aria-label="Back to unit board">‹</button><div><div class="icu-v2-shead-h">' + esc(g.name || "Care team") + '</div><div class="icu-v2-shead-s">' + (count != null ? (count + ' member' + (count === 1 ? "" : "s")) : "Loading team…") + (g.unit ? " · " + esc(g.unit) : "") + '</div></div></div>';

    // Your StewardMD Doctor ID — copyable so a colleague can add you by it.
    var idVal = _grpDoctorId || "";
    var idCard = '<div class="icu-v2-idcard"><div class="icu-v2-idcard-l"><span class="icu-v2-idcard-lbl">Your StewardMD ID</span>' +
      '<span class="icu-v2-idcard-code">' + (idVal ? esc(idVal) : "Generating…") + '</span></div>' +
      (idVal ? '<button class="icu-v2-idcopy" data-icu-act="grpcopyid" aria-label="Copy your StewardMD ID">' + ico("copy", "📋") + ' Copy</button>' : "") +
      '</div>';

    // Roster rows (from the live members subcollection).
    var rows;
    if (members == null) {
      rows = '<div class="icu-v2-member" aria-busy="true"><span class="icu-v2-member-av">…</span><span class="icu-v2-member-id"><span class="icu-v2-member-nm">Loading team…</span></span></div>';
    } else if (!members.length) {
      rows = '<div class="icu-v2-empty2">No members yet.</div>';
    } else {
      var order = { head: 0, professor: 1, assistant: 2, senior_resident: 3, junior_resident: 4, intern: 5 };
      rows = members.slice().sort(function (a, b) { return (order[a.role] == null ? 9 : order[a.role]) - (order[b.role] == null ? 9 : order[b.role]); }).map(function (m) {
        var isMe = m.uid === me, isHead = m.role === "head", online = grpMemberOnline(m.uid, me);
        var nm = isMe ? v2AccountName() : (m.name || grpRoleLabel(m.role));
        var ini = v2Initials(isMe ? v2AccountName() : (m.name || grpRoleLabel(m.role)));
        var sub = grpRoleLabel(m.role) + (isMe ? " · you" : "");
        var rm = (canManage && !isMe && !isHead) ? '<button class="icu-v2-memrm" data-icu-act="grprm:' + encodeURIComponent(m.uid) + '" aria-label="Remove ' + esc(nm) + ' from this unit">Remove</button>' : "";
        var badge = isMe ? '<span class="icu-v2-member-state">You</span>' : (rm || '<span class="icu-v2-member-role" style="flex:0 0 auto">' + esc(grpRoleLabel(m.role)) + '</span>');
        return '<div class="icu-v2-member"><span class="icu-v2-member-av' + (online ? " on" : "") + '">' + esc(ini || "DR") + '</span>' +
          '<span class="icu-v2-member-id"><span class="icu-v2-member-nm">' + esc(nm) + '</span><span class="icu-v2-member-role">' + esc(sub) + '</span></span>' +
          badge + '</div>';
      }).join("");
    }

    // Admin actions (role-gated; rules enforce too).
    var admin = canManage
      ? '<div class="icu-v2-teamacts">' +
          '<button class="icu-btn" data-icu-act="grpinvlink">' + ico("share", "🔗") + ' Invite by link</button>' +
          '<button class="icu-btn ghost" data-icu-act="grpaddid">' + ico("plus", "＋") + ' Add by StewardMD ID or email</button>' +
        '</div>'
      : "";

    // Leave / delete.
    var leave = iAmHead
      ? '<button class="icu-btn ghost icu-v2-danger" data-icu-act="grpdelete">' + ico("trash", "🗑") + ' Delete this unit</button>'
      : '<button class="icu-btn ghost icu-v2-danger" data-icu-act="grpleave">' + ico("close", "↩") + ' Leave this unit</button>';

    var note = '<div class="icu-v2-note">' + ico("info", "ⓘ") + ' Roles set who can give instructions vs. update status. Anyone can leave on their own; only the unit head or a professor can add or remove others, and the head cannot be removed. An invite link only ever adds a resident/intern — never an admin.' + '</div>';
    var err = _grpErr ? '<div class="icu-v2-note" style="border-color:var(--warn);color:var(--warn)">' + ico("warn", "⚠️") + ' ' + esc(_grpErr) + '</div>' : "";
    return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + header + '<div class="icu-v2-tlist">' + idCard + err + rows + admin + leave + note + '</div></div>';
  }
  function grpJoinNames(a) {
    if (!a.length) return "";
    if (a.length === 1) return a[0];
    if (a.length === 2) return a[0] + " & " + a[1];
    return a[0] + ", " + a[1] + " +" + (a.length - 2) + " more";
  }
  function grpSyncHTML() {
    var s = "synced"; try { var api = groupsApi(); if (api && api.syncState) s = api.syncState(); } catch (e) {}
    var label = s === "offline" ? "Offline" : s === "syncing" ? "Syncing…" : "Synced";
    return '<span class="icu-v2-sync ' + s + '"><span class="icu-v2-dot"></span>' + label + '</span>';
  }
  function renderV2PresenceGroup() {
    var viewers = _grpPresence || [];
    var av = '<span class="icu-v2-viewer">' + esc(v2Initials(v2AccountName())) + '</span>';
    viewers.slice(0, 3).forEach(function (v) { av += '<span class="icu-v2-viewer alt">' + esc(v2Initials(v.name)) + '</span>'; });
    var txt = viewers.length ? (grpJoinNames(viewers.map(function (v) { return v.name; })) + (viewers.length === 1 ? " is" : " are") + " also viewing · " + (viewers.length + 1) + " viewing") : "Only you are viewing";
    return '<div class="icu-v2-presence">' + av + '<span class="icu-v2-presence-tx">' + esc(txt) + '</span>' + grpSyncHTML() + '</div>';
  }
  function grpTlIcon(type) { var m = { round: "🩺", task: "✅", imaging: "🩻", abg: "🫁", vent: "🌬", pressor: "💉", note: "📝" }; return m[type] || "•"; }
  // Prepended to the Rounds tab in group mode — the LIVE instructions/tasks + append-only timeline
  // from subscribePatient, plus the reviewed state. (The no-type round-note composer is a later phase.)
  function grpRoundsPanel() {
    var vm = _grpPtVM;
    if (!vm) return '<div class="icu-card"><p class="icu-doc-sub" style="margin:0">Loading shared instructions & timeline…</p></div>';
    var tasks = vm.tasks || [], tl = vm.timeline || [], pt = vm.patient || {};
    var open = tasks.filter(function (t) { return t.status !== "done"; }).length;
    // Auto-declutter: a completed task drops off this list 6h after completion (the completion stays
    // in the Timeline below). Open + just-completed (<6h) tasks remain visible.
    var visibleTasks = tasks.filter(function (t) { return t.status !== "done" || !t.completedAt || (nowTs() - t.completedAt) < 6 * 3600000; });
    var hiddenDone = tasks.length - visibleTasks.length;
    var out = '<div class="icu-v2-collab">';
    // Self-heal: the unit CREATOR should be its head. If they aren't (e.g. an older invite-link
    // self-join demoted them), their round instructions post as plain notes, not tracked tasks —
    // offer a one-tap restore so the team sees their instructions again.
    if (_grp && _grp.myRole !== "head" && _grp.createdBy && typeof ownerNow === "function" && _grp.createdBy === ownerNow()) {
      out += '<div class="icu-card" style="border-color:var(--warn)"><div class="icu-sec-lbl" style="color:var(--warn)">' + ico("warn", "⚠️") + " You are not this unit's head</div>" +
        '<p class="icu-doc-sub" style="margin:0 0 10px">You created this unit, but your role here is ' + esc(grpRoleLabel(_grp.myRole)) + '. Restore yourself as Unit Head so your round instructions become tracked tasks for the team.</p>' +
        '<button class="icu-btn" data-icu-act="grpreclaimhead">' + ico("user", "👑") + ' Restore me as Unit Head</button></div>';
    }
    out += '<div class="icu-sec-lbl">' + ico("pulse", "🩺") + ' Shared unit — ' + esc((_grp && _grp.name) || "ICU") + '</div>';
    // Primary compose action pinned to the TOP of the panel (above instructions & tasks) so it's the
    // first thing on the round. Instructors post tracked tasks + a timeline event; everyone else posts
    // a plain (untracked) note. Rules enforce the write boundary too.
    var roundLbl = grpCanInstruct(_grp && _grp.myRole) ? "Add round note / instruction" : "Add a note";
    out += '<button class="icu-btn ghost icu-v2-addround" data-icu-act="grpround">' + ico("plus", "＋") + ' ' + roundLbl + '</button>';
    out += '<div class="icu-card"><h3>Instructions &amp; tasks <span class="icu-phase">' + open + ' open</span></h3>';
    if (visibleTasks.length) {
      out += visibleTasks.map(function (t) {
        var overdue = t.dueAt && t.status !== "done" && nowTs() > t.dueAt;
        var pr = TASK_PRIORITY[t.priority] || TASK_PRIORITY.moderate;
        var mark = t.status === "done" ? "☑" : t.status === "progress" ? "◐" : "☐";
        var col = t.status === "done" ? "var(--ok)" : t.status === "progress" ? "var(--warn)" : "var(--muted)";
        var badge = '<span class="icu-v2-prio" style="background:' + pr.color + '">' + esc(pr.short) + "</span> ";
        var dueTxt = t.status === "done"
          ? (t.completedByName ? "done by " + t.completedByName : "done")
          : (t.dueAt ? (overdue ? "Overdue by " + fmtDur(nowTs() - t.dueAt) : "Due in " + fmtDur(t.dueAt - nowTs())) : "");
        var instructorNm = t.onBehalfOfName || t.assignedByName;
        var byTxt = instructorNm ? ("by " + instructorNm + ((t.onBehalfOfName && t.assignedByName && t.onBehalfOfName !== t.assignedByName) ? " · logged by " + t.assignedByName : "")) : "";
        var meta = [byTxt, dueTxt].filter(Boolean).join(" · ");
        var expl = t.explanation ? '<div class="icu-v2-taskexpl">' + ico("info", "ⓘ") + " " + esc(t.explanation) + (t.explainedByName ? " — " + esc(t.explainedByName) : "") + "</div>" : "";
        var explBtn = (t.status !== "done") ? '<button class="icu-btn ghost" data-icu-act="grptaskexplain:' + encodeURIComponent(t.id) + '" style="margin-top:6px;padding:6px 10px;min-height:32px;width:auto;font:700 12px var(--font)">' + ico("edit", "✎") + (t.explanation ? " Update explanation" : (overdue ? " Explain the delay" : " Add explanation")) + "</button>" : "";
        // Instructing roles can re-ping the executor roles (SR/JR/intern) to do the task — or, once
        // it's marked done, to do it again. Server (task-remind) re-checks the caller's role.
        var nudgeBtn = grpCanInstruct(_grp && _grp.myRole) ? '<button class="icu-btn ghost" data-icu-act="grpnudge:' + encodeURIComponent(t.id) + '" style="margin-top:6px;margin-left:6px;padding:6px 10px;min-height:32px;width:auto;font:700 12px var(--font)">' + ico("bell", "🔔") + (t.status === "done" ? " Remind to redo" : " Nudge") + "</button>" : "";
        return '<div class="icu-row" style="align-items:flex-start;gap:8px' + (overdue ? ";border-left:3px solid var(--danger);padding-left:9px" : "") + '"><button class="icu-v2-tasktog" data-icu-act="grptask:' + encodeURIComponent(t.id) + '" aria-label="Change status of: ' + esc(t.text || "task") + '" style="border:none;background:none;cursor:pointer;font-size:19px;line-height:1;margin:-6px 0;color:' + col + '">' + mark + "</button>" +
          '<span style="flex:1;min-width:0">' + badge + '<span style="' + (t.status === "done" ? "text-decoration:line-through;opacity:.6" : "") + '">' + esc(t.text) + "</span>" +
          (meta ? '<span class="icu-v2-due' + (overdue ? " over" : "") + '" style="display:block;margin-top:3px">' + esc(meta) + "</span>" : "") +
          expl + explBtn + nudgeBtn + "</span></div>";
      }).join("");
    } else {
      out += '<p class="icu-doc-sub" style="margin:0">No open instructions. ' + (grpCanInstruct(_grp && _grp.myRole) ? "Give one on the round and it will appear here for the team." : "Awaiting a consultant instruction.") + '</p>';
    }
    if (hiddenDone > 0) out += '<p class="icu-doc-sub" style="margin:8px 0 0;opacity:.7">' + hiddenDone + ' completed task' + (hiddenDone === 1 ? "" : "s") + ' cleared (older than 6h) — kept in the Timeline below.</p>';
    out += '</div>';
    var revTxt = pt.reviewedAt ? ("Reviewed " + (fmtAgo(pt.reviewedAt) || "") + (pt.reviewedByName ? " by " + pt.reviewedByName : "")) : "Mark reviewed";
    out += '<button class="icu-btn ghost" data-icu-act="grpreviewed">' + ico("check", "✓") + ' ' + esc(revTxt) + '</button>';
    out += '<div class="icu-sec-lbl" style="margin-top:12px">' + ico("clock", "🕑") + ' Timeline' + (tl.length ? ' <span class="icu-phase">' + tl.length + '</span>' : "") + '</div>';
    if (tl.length) {
      var TL_RECENT = 15, tlShown = _tlAll ? tl : tl.slice(0, TL_RECENT);
      out += '<div class="icu-card' + (_tlAll ? " icu-v2-tlfull" : "") + '">' + tlShown.map(function (e) {
        var by = (e.byName || "") + (e.byRole ? " · " + grpRoleLabel(e.byRole) : "") + (e.ts ? " · " + (fmtAgo(e.ts) || fmtWhen(e.ts)) : "");
        return '<div class="icu-row" style="align-items:flex-start;gap:8px;border-bottom:1px solid var(--border);padding:7px 0"><span style="flex:0 0 auto;font-size:15px">' + grpTlIcon(e.type) + '</span>' +
          '<span style="flex:1"><b>' + esc(e.title || "Update") + '</b>' + (e.detail ? '<span style="display:block;color:var(--muted);font-size:12px;margin-top:1px">' + esc(e.detail) + '</span>' : "") +
          '<span style="display:flex;align-items:center;gap:5px;margin-top:3px"><span class="icu-v2-tlav">' + esc(v2Initials(e.byName || "")) + '</span><span style="font:600 11px var(--font);color:var(--muted)">' + esc(by) + '</span></span></span></div>';
      }).join("") + '</div>';
      // Full-history button — the whole audit trail is fetched (no cap); this just reveals it all.
      if (tl.length > TL_RECENT) out += '<button class="icu-btn ghost" data-icu-act="tlall">' + ico("clock", "🕑") + (_tlAll ? ' Show recent only' : ' View full history (' + tl.length + ' events)') + '</button>';
    } else {
      out += '<div class="icu-card"><p class="icu-doc-sub" style="margin:0">No timeline events yet. Actions on this patient appear here, author- and time-stamped.</p></div>';
    }
    // Retention notice — so doctors know how long the shared history is kept.
    out += '<p class="icu-doc-sub" style="margin:10px 2px 0;opacity:.75;font-size:11.5px">' + ico("info", "ⓘ") + ' Shared timeline &amp; tasks are kept for 7 days, then cleared automatically — and removed when the patient is discharged. Export or note anything you need to keep.</p>';
    out += '</div>';
    return out;
  }

  /* --------------------------- group-mode action sheets + write actions ----------------------- */
  function grpOpenPicker() {
    ensureModal();
    // Only units of the CURRENT category (ICU vs Ward) — the two stay separate. Older units without a
    // kind are treated as ICU (backward compat).
    var cat = _unit.cat || "icu";
    var list = (_grpList || []).filter(function (g) { return (g.kind || "icu") === cat; });
    var rows = list.length ? list.map(function (g) {
      var active = _grp && _grp.id === g.id;
      return '<button class="icu-btn ghost" data-icu-act="grpsel:' + encodeURIComponent(g.id) + '" style="justify-content:flex-start;text-align:left">' +
        (active ? "● " : "") + '<span style="flex:1">' + esc(g.name || (ctxLabel() + " unit")) + (g.unitType || g.unit ? " · " + esc(g.unitType || g.unit) : "") +
        '<span style="display:block;font:600 11px var(--font);color:var(--muted)">' + esc(grpRoleLabel(g.myRole)) + '</span></span></button>';
    }).join("") : '<div class="icu-empty">' + (_grpList === null ? "Connecting to your shared units…" : "No shared " + ctxLabel() + " units yet.") + '</div>';
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Your ' + ctxLabel() + ' units"><h3>Your ' + ctxLabel() + ' units</h3>' + rows +
      '<button class="icu-btn" data-icu-act="grpnew" style="margin-top:10px">' + ico("plus", "＋") + ' Create a ' + ctxLabel() + ' unit</button>' +
      '<button class="icu-btn ghost" data-icu-act="unitpick" style="margin-top:8px">Switch ICU / Ward</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Close</button></div>';
    modalEl.classList.add("on");
  }
  function grpOpenCreate(cat) {
    ensureModal();
    _grpNewCat = (cat === "ward" || cat === "icu") ? cat : (_unit.cat || "icu");
    var meta = unitCatMeta(_grpNewCat);
    var typeOpts = meta.types.map(function (tp) { return '<option value="' + esc(tp) + '"' + (tp === _unit.type ? " selected" : "") + '>' + esc(tp) + '</option>'; }).join("");
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Create a ' + esc(meta.label) + ' unit"><h3>Create a ' + esc(meta.label) + ' unit</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 10px">A shared unit lets your team see the same patients, instructions and timeline live. You become the unit head.</p>' +
      '<div class="icu-fld"><label for="grpType">Unit type</label><select id="grpType">' + typeOpts + '</select></div>' +
      '<div class="icu-fld"><label for="grpNm">Unit name</label><input id="grpNm" type="text" placeholder="e.g. ' + esc(meta.types[0]) + ' — Unit I"></div>' +
      '<div class="icu-fld"><label for="grpHosp">Hospital (optional)</label><input id="grpHosp" type="text" placeholder="e.g. GIMSR" value="' + esc(_unit.hospital || "") + '"></div>' +
      '<button class="icu-btn" data-icu-act="grpcreate">Create unit</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function grpVal(id) { try { var el = modalEl && modalEl.querySelector(id); return el ? String(el.value || "") : ""; } catch (e) { return ""; } }
  function grpDoCreate() {
    var api = groupsApi(); if (!api) return;
    var nm = grpVal("#grpNm"); if (!nm.trim()) { if (window.toast) toast("Enter a unit name"); return; }
    if (_grpCreating) return;                          // a create is already in flight → never make a second unit
    _grpCreating = true;
    var cat = (_grpNewCat === "ward") ? "ward" : "icu";
    var utype = grpVal("#grpType") || (cat === "ward" ? "Male Ward" : "ICU");
    var hosp = grpVal("#grpHosp"), unit = utype;
    closeForm();
    api.createGroup({ name: nm, unit: unit, hospital: hosp, kind: cat, unitType: utype }).then(function (id) {
      _grpCreating = false;
      if (window.toast) toast("Unit created");
      // Select the new unit IMMEDIATELY (optimistic). Do NOT wait for the collectionGroup
      // subscription to round-trip — that delay showed NOTHING, so users thought creation failed
      // and created DUPLICATE units, then saw both on reopen. The live subscription reconciles _grp
      // to the real doc when it lands; _grpJustCreated keeps it from being dropped in the meantime.
      _grpJustCreated = { id: id, ts: nowTs() };
      try { grpEnsureGroupsSub(); } catch (e) {}
      var g = grpById(id) || { id: id, name: nm, unit: unit, hospital: hosp, kind: cat, unitType: utype, myRole: "head", roles: {}, members: [], createdBy: (typeof ownerNow === "function" ? ownerNow() : null) };
      grpSelect(g, false);
    }, function (e) {
      _grpCreating = false;
      _grpErr = grpErrText(e);
      if (window.toast) toast("Couldn’t create the unit — " + grpErrText(e));
      if (ICU.isOpen()) paint();
    });
  }
  /* --------------------------- Phase 5: add-by-ID/email + invite-by-link + leave/remove ------- */
  // Add a colleague by StewardMD Doctor ID OR email (admin only). The role picker excludes head
  // (only the head may grant professor — rules enforce that too). "grpinvite" (kept) aliases here.
  function grpOpenAddById() {
    if (!grpActive() || !grpIsAdmin(_grp && _grp.myRole)) return;
    ensureModal();
    var iAmHead = (_grp && _grp.myRole) === "head";
    var roles = ["professor", "assistant", "senior_resident", "junior_resident", "intern"].filter(function (r) { return r !== "professor" || iAmHead; });
    var opts = roles.map(function (r) { return '<option value="' + r + '"' + (r === "junior_resident" ? " selected" : "") + '>' + esc(grpRoleLabel(r)) + '</option>'; }).join("");
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Add a doctor by ID or email"><h3>' + ico("plus", "＋") + ' Add a doctor</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 10px">Add a colleague to <b>' + esc((_grp && _grp.name) || "this unit") + '</b> by their <b>StewardMD ID</b> (e.g. SMD-7F3K2C) or the email on their StewardMD account.</p>' +
      '<div class="icu-fld"><label for="grpAddId">StewardMD ID or email</label><input id="grpAddId" type="text" autocapitalize="characters" autocomplete="off" placeholder="SMD-XXXXXX or name@hospital.org"></div>' +
      '<div class="icu-fld"><label for="grpAddRole">Role</label><select id="grpAddRole">' + opts + '</select></div>' +
      '<button class="icu-btn" data-icu-act="grpinvitesend">Add to unit</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function grpDoAddById() {
    var api = groupsApi(); if (!api || !grpActive() || !api.addByIdOrEmail) return;
    var idOrEmail = grpVal("#grpAddId").trim(), role = grpVal("#grpAddRole") || "junior_resident";
    if (!idOrEmail) { if (window.toast) toast("Enter a StewardMD ID or email"); return; }
    closeForm();
    var byEmail = idOrEmail.indexOf("@") >= 0;
    api.addByIdOrEmail(_grp.id, idOrEmail, role).then(function (doc) {
      if (window.toast) toast("Added " + ((doc && doc.name) || "doctor") + " to the unit");
    }, function (e) {
      var m = (e && e.message) || "";
      // not-found = no directory entry for that email/ID. The email→doctor lookup (doctorDirectory/
      // e_<emailHash>) is created on ensureIdentity — so a colleague who has never opened ICU has no
      // entry yet. Guide the user with a clear, actionable message (email path gets a full sheet).
      if (m === "not-found") { if (byEmail) grpAddNotFoundEmail(); else if (window.toast) toast("No StewardMD account found for that ID — check it, or use the invite link instead."); }
      else if (window.toast) toast("Couldn’t add — head/professor only");
      _grpErr = null; if (ICU.isOpen()) paint();
    });
  }
  // No StewardMD account is registered for a typed email (no doctorDirectory/e_<hash> entry). Explain
  // why and offer the invite link — reachable straight from here.
  function grpAddNotFoundEmail() {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="No StewardMD account found"><h3>' + ico("info", "ⓘ") + ' No StewardMD account found</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 12px">No StewardMD account found for that email — ask them to open <b>StewardMD → ICU</b> once (to get a StewardMD ID), then add them by ID or email. Or use the invite link instead.</p>' +
      '<button class="icu-btn" data-icu-act="grpinvlink">' + ico("share", "🔗") + ' Invite by link instead</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Close</button></div>';
    modalEl.classList.add("on");
  }
  // Generate a shareable invite LINK (admin only). The role is a LINK role (default JR) — a link
  // can never confer head/professor. On generate we copy the URL to the clipboard; a repeat tap
  // re-copies the SAME link (changing the role clears it so the next generate mints a fresh one).
  function grpOpenInviteLink() {
    if (!grpActive() || !grpIsAdmin(_grp && _grp.myRole)) return;
    ensureModal();
    var linkRoles = (groupsApi() && groupsApi().LINK_ROLES) ? groupsApi().LINK_ROLES : ["assistant", "senior_resident", "junior_resident", "intern"];
    var segs = linkRoles.map(function (r) {
      return '<button class="icu-v2-roleseg' + (r === _grpInvRole ? " on" : "") + '" data-icu-act="grpinvrole:' + r + '" aria-pressed="' + (r === _grpInvRole) + '">' + esc(grpRoleLabel(r)) + '</button>';
    }).join("");
    var linkBox = _grpInvLink
      ? '<div class="icu-fld"><label for="grpInvLinkVal">Shareable link (copied)</label><input id="grpInvLinkVal" type="text" readonly value="' + esc(_grpInvLink) + '"></div>' +
        '<p class="icu-doc-sub" style="margin:-4px 0 10px">Anyone who opens this link and signs in joins <b>' + esc((_grp && _grp.name) || "this unit") + '</b> as <b>' + esc(grpRoleLabel(_grpInvRole)) + '</b> (after a confirm). Expires in ~14 days.</p>'
      : '<p class="icu-doc-sub" style="margin:0 0 10px">Create a link a colleague can tap to join <b>' + esc((_grp && _grp.name) || "this unit") + '</b>. A link only ever adds a resident/intern/assistant — never a head or professor.</p>';
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Invite by link"><h3>' + ico("share", "🔗") + ' Invite by link</h3>' +
      '<div class="icu-fld"><label>They join as</label><div class="icu-v2-roleseg-row" role="group" aria-label="Link role">' + segs + '</div></div>' +
      linkBox +
      '<button class="icu-btn" data-icu-act="grpinvlink">' + ico("copy", "📋") + ' ' + (_grpInvLink ? "Copy link again" : "Generate & copy link") + '</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Done</button></div>';
    modalEl.classList.add("on");
  }
  function grpSetInvRole(role) {
    var api = groupsApi();
    var ok = (api && api.LINK_ROLES) ? api.LINK_ROLES : ["assistant", "senior_resident", "junior_resident", "intern"];
    _grpInvRole = ok.indexOf(role) >= 0 ? role : "junior_resident";
    _grpInvLink = null;                                 // role changed → force a fresh link on next generate
    grpOpenInviteLink();
  }
  function grpDoInviteLink() {
    var api = groupsApi(); if (!api || !grpActive() || !api.createInvite) return;
    if (_grpInvLink) { grpCopyText(_grpInvLink, "Invite link copied"); grpOpenInviteLink(); return; }   // re-copy + keep the sheet open
    api.createInvite(_grp.id, _grpInvRole).then(function (res) {
      _grpInvLink = (res && res.url) || null;
      if (_grpInvLink) grpCopyText(_grpInvLink, "Invite link copied — share it with your colleague");
      grpOpenInviteLink();
    }, function (e) { _grpErr = grpErrText(e); if (window.toast) toast("Couldn’t create the link — head/professor only"); if (ICU.isOpen()) paint(); });
  }
  // Clipboard copy (reuses the app's existing navigator.clipboard pattern) with a toast.
  function grpCopyText(txt, msg) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(String(txt || "")); } catch (e) {}
    if (window.toast) toast(msg || "Copied");
  }
  function grpCopyId() { if (_grpDoctorId) grpCopyText(_grpDoctorId, "Your StewardMD ID copied"); }
  function grpDoLeave() {
    var api = groupsApi(); if (!api || !grpActive() || !api.leaveGroup) return;
    if (!window.confirm("Leave " + ((_grp && _grp.name) || "this unit") + "? You will lose access to its patients until you are added again.")) return;
    api.leaveGroup(_grp.id).then(function () { if (window.toast) toast("You left the unit"); }, function (e) {
      var m = (e && e.message) || "";
      if (window.toast) toast(m === "head-cannot-leave" ? "You are the head — delete the unit instead" : "Couldn’t leave the unit");
      _grpErr = null; if (ICU.isOpen()) paint();
    });
  }
  function grpReclaimHead() {
    var api = groupsApi(); if (!api || !api.reclaimHead || !grpActive()) return;
    api.reclaimHead(_grp.id).then(function () {
      if (_grp) _grp.myRole = "head";                                  // optimistic — instructions work immediately
      try { if (api.setActiveGroup) api.setActiveGroup(_grp.id, "head"); } catch (e) {}
      if (window.toast) toast("You are now the Unit Head");
      if (ICU.isOpen()) paint();
    }, function (e) { _grpErr = grpErrText(e); if (window.toast) toast("Couldn’t restore head — " + grpErrText(e)); if (ICU.isOpen()) paint(); });
  }
  function grpDoDelete() {
    var api = groupsApi(); if (!api || !grpActive() || !api.deleteGroup) return;
    if ((_grp && _grp.myRole) !== "head") { if (window.toast) toast("Only the unit head can delete the unit"); return; }
    if (!window.confirm("Delete " + ((_grp && _grp.name) || "this unit") + " for everyone? This cannot be undone.")) return;
    api.deleteGroup(_grp.id).then(function () { if (window.toast) toast("Unit deleted"); }, function (e) { _grpErr = grpErrText(e); if (window.toast) toast("Couldn’t delete the unit"); if (ICU.isOpen()) paint(); });
  }
  function grpDoRemove(uid) {
    var api = groupsApi(); if (!api || !grpActive() || !uid || !api.removeMember) return;
    var m = null, arr = _grpMembers || []; for (var i = 0; i < arr.length; i++) if (arr[i].uid === uid) { m = arr[i]; break; }
    var nm = (m && m.name) || "this member";
    if (!window.confirm("Remove " + nm + " from " + ((_grp && _grp.name) || "the unit") + "?")) return;
    api.removeMember(_grp.id, uid).then(function () { if (window.toast) toast("Removed from unit"); }, function (e) { _grpErr = grpErrText(e); if (window.toast) toast("Couldn’t remove — head/professor only"); if (ICU.isOpen()) paint(); });
  }
  /* --------------------------- Phase 5: join-by-link (?icujoin=<gid>.<code>) ------------------- */
  function grpJoinParam() { try { return (location.search.match(/[?&]icujoin=([^&]+)/) || [])[1] || ""; } catch (e) { return ""; } }
  function grpCleanJoinParam() {
    try { var u = new URL(location.href); u.searchParams.delete("icujoin"); history.replaceState(null, "", u.pathname + (u.search || "") + (u.hash || "")); } catch (e) {}
  }
  // Boot handler: with the flag ON, an ?icujoin= link previews the invite and asks the user to
  // confirm before joining. Signed out → stash + prompt sign-in (re-run after auth resolves).
  // Flag OFF → ignored entirely (no reads, no UI). Never throws.
  function grpBootJoin() {
    if (!icuGroupsOn()) return;
    var api = groupsApi(); if (!api || !api.getInvite || !api._parseJoinParam) return;
    var raw = _grpJoinPending || grpJoinParam();
    if (!raw) return;
    var parsed = api._parseJoinParam(decodeURIComponent(raw));
    if (!parsed) { _grpJoinPending = null; grpCleanJoinParam(); return; }
    var uid = ownerNow();
    if (!uid || uid === "anon") {                       // signed out → stash + nudge sign-in
      _grpJoinPending = raw;
      try { window.SMD_loadFirebase && window.SMD_loadFirebase(); } catch (e) {}
      if (window.toast) toast("Sign in to join the ICU unit you were invited to.");
      return;
    }
    _grpJoinPending = null; grpCleanJoinParam();
    api.getInvite(parsed.gid, parsed.code).then(function (inv) {
      if (!inv) { if (window.toast) toast("That invite link is not valid."); return; }
      if (inv.expired) { if (window.toast) toast("That invite link has expired."); return; }
      _grpJoinConfirm = { gid: parsed.gid, code: parsed.code, inv: inv };
      grpShowJoinConfirm(inv);
    }, function () { if (window.toast) toast("Couldn’t open that invite link."); });
  }
  function grpShowJoinConfirm(inv) {
    injectCSS(); ensureModal();   // the confirm can appear before the dashboard was ever opened
    var unit = inv.name || inv.unit || "an ICU unit";
    var who = inv.createdByName ? (" invited by " + esc(inv.createdByName)) : "";
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Join ICU unit"><h3>' + ico("users", "👥") + ' Join ' + esc(unit) + '?</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 12px">You have been invited to join <b>' + esc(unit) + '</b>' + who + ' as <b>' + esc(grpRoleLabel(inv.role)) + '</b>. You will see the unit’s shared patients, instructions and timeline.</p>' +
      '<button class="icu-btn" data-icu-act="grpjoinaccept">' + ico("check", "✓") + ' Join as ' + esc(grpRoleLabel(inv.role)) + '</button>' +
      '<button class="icu-btn ghost" data-icu-act="grpjoindecline" style="margin-top:8px">Not now</button></div>';
    modalEl.classList.add("on");
  }
  function grpDoJoinAccept() {
    var c = _grpJoinConfirm, api = groupsApi();
    if (!c || !api || !api.joinByInvite) { closeForm(); _grpJoinConfirm = null; return; }
    closeForm();
    api.joinByInvite(c.gid, c.code).then(function (gid) {
      _grpJoinConfirm = null;
      if (window.toast) toast("Joined the unit");
      try { if (!ICU.isOpen()) ICU.open(); } catch (e) {}
      try { grpEnsureGroupsSub(); } catch (e) {}
      // Select the joined unit once it appears in the live list.
      var tries = 0, iv = setInterval(function () {
        var g = grpById(gid);
        if (g) { clearInterval(iv); grpSelect(g, false); _screen = "board"; _paintTop = true; if (ICU.isOpen()) paint(); }
        else if (++tries > 60) clearInterval(iv);
      }, 200);
    }, function (e) {
      _grpJoinConfirm = null;
      var m = (e && e.message) || "";
      if (window.toast) toast(m === "invite-expired" ? "That invite link has expired." : "Couldn’t join — the invite may be invalid.");
    });
  }
  function grpDoJoinDecline() { _grpJoinConfirm = null; grpCleanJoinParam(); closeForm(); }
  // Kept for back-compat: the old "Invite a doctor" verbs now route to the add-by-ID/email sheet.
  function grpOpenInvite() { grpOpenAddById(); }
  function grpDoInvite() { grpDoAddById(); }
  function grpDoReviewed() {
    var api = groupsApi(); if (!api || !grpActive() || !_grpPtId) return;
    api.setReviewed(_grp.id, _grpPtId).then(function () { if (window.toast) toast("Marked reviewed"); }, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen()) paint(); });
    try { api.addTimelineEvent(_grp.id, _grpPtId, { type: "note", title: "Marked reviewed" }); } catch (e) {}
  }
  function grpCycleTask(taskId) {
    var api = groupsApi(); if (!api || !grpActive() || !_grpPtId || !_grpPtVM) return;
    var t = null, arr = _grpPtVM.tasks || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === taskId) { t = arr[i]; break; }
    if (!t) return;
    var next = t.status === "pending" ? "progress" : t.status === "progress" ? "done" : "pending";
    api.setTaskStatus(_grp.id, _grpPtId, taskId, next).then(function () {}, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen()) paint(); });
    // Completing a task self-logs an author-stamped audit event (see the auto-timeline set).
    if (next === "done") { try { api.addTimelineEvent(_grp.id, _grpPtId, { type: "task", title: "Task completed — " + (t.text || "task") }); } catch (e) {} }
  }
  // Resident explains why a task is late / not yet done. Opens a small sheet; saves to the task +
  // posts an author-stamped timeline note so the whole unit sees the reason.
  var _explainTaskId = null;
  function grpTaskExplain(taskId) {
    _explainTaskId = taskId;
    var t = null, arr = (_grpPtVM && _grpPtVM.tasks) || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === taskId) { t = arr[i]; break; }
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Explain task"><h3>' + ico("edit", "✎") + ' Explanation</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 10px">' + esc((t && t.text) || "Task") + ' — note why it is delayed or not yet done. The whole team will see this.</p>' +
      '<textarea id="icuExplain" rows="3" style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;padding:10px;font:600 14px var(--font);color:var(--ink);background:var(--panel2)" placeholder="e.g. ABG machine down — sample sent to central lab, result expected by 3 PM">' + esc((t && t.explanation) || "") + '</textarea>' +
      '<button class="icu-btn" data-icu-act="grptaskexplainsave" style="margin-top:10px">Save explanation</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function grpTaskExplainSave() {
    var api = groupsApi();
    var el = modalEl && modalEl.querySelector("#icuExplain"), txt = el ? String(el.value || "").trim() : "";
    if (!txt) { if (window.toast) toast("Type an explanation first"); return; }
    if (!api || !api.explainTask || !grpActive() || !_grpPtId || !_explainTaskId) { closeForm(); return; }
    var id = _explainTaskId, t = null, arr = (_grpPtVM && _grpPtVM.tasks) || []; for (var i = 0; i < arr.length; i++) if (arr[i].id === id) { t = arr[i]; break; }
    api.explainTask(_grp.id, _grpPtId, id, txt).then(function () { if (window.toast) toast("Explanation saved"); }, function (e) { if (window.toast) toast("Couldn’t save — " + grpErrText(e)); });
    try { api.addTimelineEvent(_grp.id, _grpPtId, { type: "note", title: "Explanation — " + ((t && t.text) || "task"), detail: txt }); } catch (e) {}
    _explainTaskId = null; closeForm();
  }

  /* ============================================================ ICU v2 PHASE 3
   * Round-note composer → tasks + one timeline event · automatic audit timeline ·
   * smart notifications · presence/audit surfacing. Everything here is gated on grpActive()
   * (a shared unit is selected); with the groups flag OFF none of it runs. The DETERMINISTIC
   * transforms below (grpRoundPlan / grpDiffEvents / grpDeriveNotifs / grpUnreadCount) are PURE
   * and DOM-free — exposed as ICU._grp* test seams and unit-tested without Firestore.
   */
  // Common round instructions (editable). The prototype's exact set. Presets → tracked tasks.
  // Common consultant→resident instructions, tap-to-add (no typing). Procedures, investigations,
  // lines, orders, referrals & monitoring — the everyday things asked on a round.
  var ROUND_PRESETS = ["Do ABG", "Do ascitic tap", "Send CBNAAT", "Do dressing", "Send blood cultures", "Repeat CBC", "Do ECG", "Chest X-ray", "Insert central line", "Foley catheterisation", "Increase noradrenaline", "Maintain MAP > 65", "Nephrology referral", "Strict I/O charting", "Reduce sedation", "Review antibiotics"];

  // PURE: a chosen list of instructions → the tasks to create + the ONE summarising timeline
  // event (never one event per task). Instructors create tracked tasks; everyone else posts a
  // plain (untracked) note — the UI role-gates and firestore.rules enforce the real boundary.
  function grpRoundPlan(instructions, canInstruct, authorName, priority, onBehalf) {
    instructions = (instructions || []).filter(function (s) { return s && String(s).trim(); }).map(function (s) { return String(s).trim(); });
    authorName = authorName || "Clinician";
    var n = instructions.length;
    if (!n) return { tasks: [], event: null };
    var ob = (onBehalf && onBehalf.uid && onBehalf.name) ? onBehalf : null;   // attribute to a named consultant
    if (canInstruct) {
      var prio = TASK_PRIORITY[priority] ? priority : "moderate";
      var dueAt = nowTs() + TASK_PRIORITY[prio].ms;   // client clock — a small skew is fine for a soft deadline
      var tasks = instructions.map(function (s) { return { text: s, priority: prio, dueAt: dueAt, onBehalfOfUid: ob ? ob.uid : null, onBehalfOfName: ob ? ob.name : "" }; });
      var by = ob ? ob.name : authorName;
      return { tasks: tasks, event: { type: "round", title: "Round instruction — " + by, detail: n + " instruction" + (n === 1 ? "" : "s") + " · " + TASK_PRIORITY[prio].label + " priority" + (ob ? " · logged by " + authorName : "") } };
    }
    return { tasks: [], event: { type: "note", title: "Round note — " + authorName, detail: instructions.join("; ") } };
  }

  /* --------------------------- automatic timeline (audit trail) ------------------------------- */
  // PURE, DOM-free change-descriptors. Given two sanitised state fragments (prev → next) return
  // the meaningful clinical actions between them. Implemented as a DIFF at the mirror chokepoint
  // (NOT by wrapping each ICU.ingest*) so EVERY write path — manual forms, ICU Snapshot, Ward
  // Sync, imaging, the calculator bridge — is covered through one seam, and a burst of ingests
  // from one import naturally COALESCES into per-domain events (the mirror is debounced ~1.5s and
  // echo-suppressed, so a remote snapshot we just applied never re-emits). old→new diffs are cheap
  // here because we hold both fragments; where a previous value is unknown we emit just the new.
  function grpObjDiff(a, b, keys) {
    a = a || {}; b = b || {};
    for (var i = 0; i < keys.length; i++) { var k = keys[i]; if (String(a[k] == null ? "" : a[k]) !== String(b[k] == null ? "" : b[k])) return true; }
    return false;
  }
  function grpLastVit(st) { var arr = (st && st.vitals) || []; return arr.length ? arr[arr.length - 1] : null; }
  function grpFmtVit(v) {
    if (!v) return "";
    var p = [];
    if (v.map != null) p.push("MAP " + v.map);
    if (v.hr != null) p.push("HR " + v.hr);
    if (v.spo2 != null) p.push("SpO₂ " + v.spo2 + "%");
    return p.join(" · ");
  }
  function grpDiffEvents(prev, next) {
    prev = prev || {}; next = next || {};
    var ev = [];
    // Vitals — a new/changed latest reading.
    var pv = grpLastVit(prev), nv = grpLastVit(next);
    if (nv && JSON.stringify(nv) !== JSON.stringify(pv)) ev.push({ type: "note", title: "Vitals updated", detail: grpFmtVit(nv) });
    // ABG.
    var pa = prev.abg || {}, na = next.abg || {};
    if (grpObjDiff(pa, na, ["ph", "paco2", "pao2", "hco3", "fio2", "be"])) {
      var ad = [];
      if (na.ph != null) ad.push("pH " + na.ph);
      if (na.paco2 != null) ad.push("pCO₂ " + na.paco2);
      if (na.hco3 != null) ad.push("HCO₃ " + na.hco3);
      ev.push({ type: "abg", title: "ABG uploaded", detail: ad.join(" · ") });
    }
    // Ventilator — old→new for FiO₂/PEEP when the previous value is known.
    var pvt = prev.ventilator || {}, nvt = next.ventilator || {};
    if (grpObjDiff(pvt, nvt, ["mode", "fio2", "peep", "tv", "rr", "plateau"])) {
      var vd = [];
      if (nvt.mode != null && nvt.mode !== "") vd.push("Mode " + nvt.mode);
      if (nvt.fio2 != null) vd.push("FiO₂ " + (pvt.fio2 != null && String(pvt.fio2) !== String(nvt.fio2) ? pvt.fio2 + "→" : "") + nvt.fio2 + "%");
      if (nvt.peep != null) vd.push("PEEP " + (pvt.peep != null && String(pvt.peep) !== String(nvt.peep) ? pvt.peep + "→" : "") + nvt.peep);
      ev.push({ type: "vent", title: "Ventilator settings changed", detail: vd.join(" · ") });
    }
    // Infusions — started (new drug) or rate changed (old→new when known).
    var pm = {}; (prev.infusions || []).forEach(function (i) { if (i && i.drug) pm[String(i.drug).toLowerCase()] = i; });
    (next.infusions || []).forEach(function (i) {
      if (!i || !i.drug) return;
      var k = String(i.drug).toLowerCase(), old = pm[k];
      var rate = (i.rateMlHr != null ? i.rateMlHr + " mL/h" : (i.dose != null ? i.dose + " " + (i.unit || "") : ""));
      if (!old) { ev.push({ type: "pressor", title: i.drug + " started", detail: rate }); return; }
      var oldR = (old.rateMlHr != null ? old.rateMlHr : old.dose), newR = (i.rateMlHr != null ? i.rateMlHr : i.dose);
      if (oldR != null && newR != null && String(oldR) !== String(newR)) ev.push({ type: "pressor", title: i.drug + " changed", detail: "Rate " + oldR + " → " + newR });
    });
    // Imaging — new studies added.
    var pim = {}; (prev.imaging || []).forEach(function (r) { if (r && r.id) pim[r.id] = 1; });
    var newImg = (next.imaging || []).filter(function (r) { return r && r.id && !pim[r.id]; });
    if (newImg.length === 1) ev.push({ type: "imaging", title: "Imaging added — " + (newImg[0].studyName || "study"), detail: "" });
    else if (newImg.length > 1) ev.push({ type: "imaging", title: "Imaging added — " + newImg.length + " studies", detail: "" });
    // Labs — source-aware (Ward Sync vs Manual), collapsed to one event per burst.
    var pl = (prev.labs && prev.labs.recent) || {}, nl = (next.labs && next.labs.recent) || {};
    var changed = []; Object.keys(nl).forEach(function (k) { if (String(nl[k]) !== String(pl[k])) changed.push(k); });
    if (changed.length) {
      var src = next.src || {}, ward = 0; changed.forEach(function (k) { if (src[k] && /ward/i.test(src[k].source || "")) ward++; });
      ev.push({ type: "note", title: ward > 0 ? "Ward Sync — labs updated" : "Labs updated", detail: changed.length + " value" + (changed.length === 1 ? "" : "s") });
    }
    return ev;
  }
  // A short "what changed" line for the board card footer + notifications (from the diff events).
  function grpChangeSummary(events) {
    if (!events || !events.length) return "Updated patient";
    if (events.length === 1) return events[0].title;
    return events[0].title + " +" + (events.length - 1) + " more";
  }

  /* --------------------------- smart notifications (derive-from-snapshot) --------------------- */
  // PURE. Given the enriched unit patients snapshot + the OPEN patient's live view-model, derive
  // only clinically-meaningful notification rows (newest first, deduped, capped). Unit-wide signals
  // come from each patient doc's severity / lastUpdate / assignedTo (NOT N per-patient listeners);
  // the open patient additionally contributes its live tasks + timeline. A full per-event unit feed
  // (its own collection streamed for every patient) is a later refinement — see the results doc.
  function grpNotifIcon(text) {
    var t = String(text || "").toLowerCase();
    if (/vent/.test(t)) return "🌬";
    if (/abg/.test(t)) return "🫁";
    if (/started|changed|noradr|adren|infus|pressor|rate|med/.test(t)) return "💉";
    if (/imaging|ct|x-ray|scan/.test(t)) return "🩻";
    if (/lab|ward sync/.test(t)) return "🧪";
    return "📝";
  }
  function grpNotifFromEvent(e) {
    if (!e) return null;
    switch (e.type) {
      case "round": return { icon: "🩺", title: e.title || "Round instruction" };
      case "imaging": return { icon: "🩻", title: e.title || "Investigation added" };
      case "pressor": return { icon: "💉", title: e.title || "Medication changed" };
      case "vent": return { icon: "🌬", title: e.title || "Ventilator changed" };
      case "abg": return { icon: "🫁", title: e.title || "ABG uploaded" };
      case "task": return { icon: "✅", title: e.title || "Task completed" };
      default: return null;   // plain notes are not surfaced as notifications (avoid fatigue)
    }
  }
  function grpDeriveNotifs(patients, ptVM, myUid, now) {
    now = now || Date.now(); patients = patients || [];
    var openId = (ptVM && ptVM.patient && ptVM.patient.id) || null, byId = {};
    patients.forEach(function (p) { byId[p.id] = p; });
    function label(p) { return "Bed " + (p.bed || "—") + " · " + (p.name || "Patient"); }
    var rows = [];
    patients.forEach(function (p) {
      var ts = (p.lastUpdate && p.lastUpdate.at) || p.reviewedAt || p.savedAt || now;
      if (p.sev === "critical") rows.push({ key: "crit:" + p.id + ":" + ts, id: p.id, urgent: true, icon: "⚠️", title: label(p) + " — Critical", body: p.reason || "Deterioration — review this patient", ts: ts });
      if (p.assignedTo && p.assignedTo === myUid) rows.push({ key: "assign:" + p.id, id: p.id, urgent: false, icon: "🩺", title: label(p) + " — Assigned to you", body: "You are the named clinician for this patient", ts: ts });
      // "What changed" from the doc's lastUpdate — skip the OPEN patient (its rich timeline is used).
      if (p.id !== openId && p.lastUpdate && p.lastUpdate.text && !/^updated patient$/i.test(p.lastUpdate.text))
        rows.push({ key: "lu:" + p.id + ":" + ts, id: p.id, urgent: false, icon: grpNotifIcon(p.lastUpdate.text), title: label(p) + " — " + p.lastUpdate.text, body: (p.lastUpdate.byName ? "by " + p.lastUpdate.byName : "Updated"), ts: ts });
    });
    if (ptVM && openId && byId[openId]) {
      var op = byId[openId];
      (ptVM.tasks || []).forEach(function (t) {
        // OVERDUE instruction — urgent alert for the whole team (fires a device notification via the
        // tick). Body flags whether the resident has explained the delay yet.
        if (t.dueAt && t.status !== "done" && now > t.dueAt)
          rows.push({ key: "overdue:" + t.id, id: openId, urgent: true, icon: "⏰", title: label(op) + " — Task overdue", body: (t.text || "task") + " · " + ((TASK_PRIORITY[t.priority] || {}).label || "") + (t.explanation ? " · explained" : " · explanation needed"), ts: t.dueAt });
        if (t.assignedTo === myUid && t.status !== "done") rows.push({ key: "task:" + t.id, id: openId, urgent: true, icon: "🩺", title: label(op) + " — Instruction for you", body: t.text || "", ts: t.ts || now });
        else if (t.status === "done" && t.completedAt) rows.push({ key: "taskdone:" + t.id, id: openId, urgent: false, icon: "✅", title: label(op) + " — Task completed", body: (t.text || "") + (t.completedByName ? " · by " + t.completedByName : ""), ts: t.completedAt });
      });
      (ptVM.timeline || []).forEach(function (e) {
        var m = grpNotifFromEvent(e); if (!m) return;
        rows.push({ key: "tl:" + e.id, id: openId, urgent: false, icon: m.icon, title: label(op) + " — " + m.title, body: e.detail || "", ts: e.ts || now });
      });
    }
    rows.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    var seen = {}, out = [];
    for (var i = 0; i < rows.length; i++) { if (seen[rows[i].key]) continue; seen[rows[i].key] = 1; out.push(rows[i]); if (out.length >= 30) break; }
    return out;
  }
  // PURE: how many rows are newer than the per-user "last seen" timestamp → the bell badge.
  function grpUnreadCount(rows, lastSeen) {
    lastSeen = lastSeen || 0; var n = 0;
    (rows || []).forEach(function (r) { if ((r.ts || 0) > lastSeen) n++; });
    return n;
  }
  // Non-pure wrappers: enrich the live board list + open patient into notification rows.
  function grpNotifRows() {
    var pts = grpEnrichedList().map(function (p) {
      return { id: p.id, name: p.name, bed: p.bed, sev: p.sev, reason: v2Reason(p.snap || {}), lastUpdate: p.lastUpdate, reviewedAt: p.reviewedAt, savedAt: p.savedAt, assignedTo: p.assignedTo };
    });
    return grpDeriveNotifs(pts, _grpPtVM, ownerNow(), Date.now());
  }
  function grpNotifSeenKey() { return "smd_icu_notif_seen:" + (typeof ownerNow === "function" ? ownerNow() : "anon"); }
  function grpNotifSeen() { try { return +localStorage.getItem(grpNotifSeenKey()) || 0; } catch (e) { return 0; } }
  function grpNotifMarkSeen() { try { localStorage.setItem(grpNotifSeenKey(), String(Date.now())); } catch (e) {} }
  // Optional device notification (best-effort): reuse the native SMD_localNotify path (native-push.js)
  // for a NEW critical event while grouped. Never crashes when the helper is absent — the in-app feed
  // is the deliverable. De-duped via _grpNotifiedTs (seeded to "now" when a unit is selected, so the
  // first snapshot never retro-fires the whole roster).
  function grpDeviceNotifyNew(rows) {
    try {
      if (typeof window.SMD_localNotify !== "function") return;
      var newest = _grpNotifiedTs;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r.urgent && (r.ts || 0) > _grpNotifiedTs) {
          window.SMD_localNotify("⚠ " + (r.title || "ICU alert"), r.body || "Review this patient", "/");
          if ((r.ts || 0) > newest) newest = r.ts || 0;
          break;   // one per tick — the in-app feed carries the rest
        }
      }
      if (newest > _grpNotifiedTs) _grpNotifiedTs = newest;
    } catch (e) {}
  }
  function grpNotifTick() { if (!grpActive()) return; try { grpDeviceNotifyNew(grpNotifRows()); } catch (e) {} try { grpEscalateOverdue(); } catch (e) {} }
  // When a shared task goes overdue, ask the backend to push the WHOLE unit (APNs/FCM) so a member
  // whose app is CLOSED still gets alerted. The server re-verifies overdue + membership and de-dups
  // via escalatedAt; we also de-dup per-session (_grpOverdueNotified) to avoid re-hitting the endpoint.
  function grpEscalateOverdue() {
    if (!grpActive() || !_grpPtId || !_grpPtVM) return;
    var gid = _grp.id, pid = _grpPtId, tasks = _grpPtVM.tasks || [], now = nowTs();
    tasks.forEach(function (t) {
      if (!t.dueAt || t.status === "done" || now <= t.dueAt) return;    // not overdue
      if (t.escalatedAt) { _grpOverdueNotified[t.id] = true; return; }  // already pushed (server-stamped)
      if (_grpOverdueNotified[t.id]) return;                           // already triggered this session
      _grpOverdueNotified[t.id] = true;
      try {
        idToken().then(function (tok) {
          if (!tok) return;
          fetch(grpPushUrl("/api/push/task-overdue"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ gid: gid, pid: pid, taskId: t.id }) }).catch(function () {});
        }, function () {});
      } catch (e) {}
    });
  }
  // Self-test push (ICU More → "Send me a test notification"): verifies push delivery on THIS device
  // in one tap, independent of groups/roles. The response tells us if a token is even registered.
  function grpTestPush() {
    if (window.toast) toast("Sending a test notification…");
    try {
      idToken().then(function (tok) {
        if (!tok) { if (window.toast) toast("Sign in first, then try the test push"); return; }
        fetch(grpPushUrl("/api/push/test"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok } })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!window.toast) return;
            if (j && j.sent) toast("Test notification sent — check your notifications");
            else if (j && j.total === 0) toast("No device is registered for push yet. Allow notifications + reopen the app, then retry.");
            else toast("Couldn't send the test push" + (j && j.error ? " (" + j.error + ")" : ""));
          })
          .catch(function () { if (window.toast) toast("Test push failed — check your connection"); });
      }, function () { if (window.toast) toast("Couldn't get your auth token"); });
    } catch (e) {}
  }
  // On-demand nudge: re-push a task's reminder to the unit's executor roles (SR/JR/intern), excluding
  // the sender. Only instructing roles reach here (button is role-gated; server re-checks). For a
  // task already marked done it sends a "please repeat" instead. Reach is surfaced on the board note.
  function grpNudgeTask(id) {
    if (!grpActive() || !_grpPtId || !id) return;
    if (!grpCanInstruct(_grp && _grp.myRole)) return;
    var gid = _grp.id, pid = _grpPtId, tasks = (_grpPtVM && _grpPtVM.tasks) || [], t = null;
    for (var i = 0; i < tasks.length; i++) { if (tasks[i].id === id) { t = tasks[i]; break; } }
    if (!t) return;
    var redo = t.status === "done";
    if (window.toast) toast(redo ? "Asking the team to repeat…" : "Nudging the team…");
    function note(kind, msg) { _grpLastPush = { ts: nowTs(), kind: kind, text: msg }; if (ICU.isOpen() && _screen === "board") paintLive(); }
    try {
      idToken().then(function (tok) {
        if (!tok) { note("error", "Couldn't send the reminder — you weren't signed in."); return; }
        fetch(grpPushUrl("/api/push/task-remind"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ gid: gid, pid: pid, taskId: id, redo: redo }) })
          .then(function (r) { return r.json().catch(function () { return null; }); })
          .then(function (j) {
            if (j && j.sent > 0) { _grpLastPush = null; if (ICU.isOpen() && _screen === "board") paintLive(); if (window.toast) toast("Reminder sent to " + j.sent + " device" + (j.sent === 1 ? "" : "s")); return; }
            if (j && j.error === "forbidden") { if (window.toast) toast("Only instructing roles can nudge."); return; }
            if (j && j.reminded > 0) { note("none", "Reminder queued, but no resident has notifications on yet — ask them to enable them in Settings."); return; }
            note("error", "Couldn't send the reminder — no resident is on this unit yet, or the push service is unreachable.");
          }, function () { note("error", "Couldn't send the reminder — check your connection."); })
          .catch(function () { note("error", "Couldn't send the reminder — check your connection."); });
      }, function () { note("error", "Couldn't send the reminder — you weren't signed in."); });
    } catch (e) {}
  }
  // ── Per-user ICU notification preferences ───────────────────────────────────────────────────────
  // The panel writes the three Tier-2/3 category booleans to the current user's members/{uid}.notif
  // doc (via icu-collab setNotifPrefs); the push server reads them during fan-out. Tier-1 (critical /
  // overdue / urgent orders) is shown locked-on and can't be muted.
  function grpMyUid() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser && SMD_AUTH.currentUser.uid) || null; } catch (e) { return null; } }
  function grpNotifPrefsGet() {
    var supervising = ["head", "professor", "assistant"].indexOf(_grp && _grp.myRole) >= 0;
    var def = { orderRoutine: !supervising, activity: !supervising, handover: true };   // role default (mirrors server)
    var uid = grpMyUid(), mine = null, i;
    for (i = 0; _grpMembers && i < _grpMembers.length; i++) { if (_grpMembers[i].uid === uid) { mine = _grpMembers[i]; break; } }
    var n = mine && mine.notif;
    if (!n || typeof n !== "object") return def;
    return {
      orderRoutine: typeof n.orderRoutine === "boolean" ? n.orderRoutine : def.orderRoutine,
      activity: typeof n.activity === "boolean" ? n.activity : def.activity,
      handover: typeof n.handover === "boolean" ? n.handover : def.handover,
    };
  }
  function grpNotifPrefsSave(prefs) {
    var api = groupsApi(), gid = _grp && _grp.id, uid = grpMyUid(), i;
    if (_grpMembers && uid) { for (i = 0; i < _grpMembers.length; i++) { if (_grpMembers[i].uid === uid) { _grpMembers[i].notif = prefs; break; } } }   // optimistic
    if (api && api.setNotifPrefs && gid) { try { api.setNotifPrefs(gid, prefs).catch(function () { if (window.toast) toast("Couldn't save — check your connection."); }); } catch (e) {} }
  }
  function grpOpenNotifPrefs() {
    if (!grpActive() || document.getElementById("icuNotifPrefs")) return;
    var prefs = grpNotifPrefsGet();
    var wrap = document.createElement("div");
    wrap.id = "icuNotifPrefs";
    wrap.setAttribute("style", "position:fixed;inset:0;z-index:20000;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center");
    function lockRow(title, sub) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 2px;border-bottom:1px solid var(--line,#e4eae8)"><div style="flex:1"><div style="font:600 14px var(--sans,system-ui);color:var(--ink,#16232e)">' + title + '</div><div style="font:500 12px var(--sans,system-ui);color:var(--slate,#5a7184)">' + sub + '</div></div><span style="font:700 12px var(--sans,system-ui);color:var(--teal,#0e6e63);display:flex;align-items:center;gap:4px">' + ico("lock", "🔒") + ' On</span></div>';
    }
    function togRow(key, title, sub) {
      var on = !!prefs[key];
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 2px;border-bottom:1px solid var(--line,#e4eae8)"><div style="flex:1"><div style="font:600 14px var(--sans,system-ui);color:var(--ink,#16232e)">' + title + '</div><div style="font:500 12px var(--sans,system-ui);color:var(--slate,#5a7184)">' + sub + '</div></div>' +
        '<button data-tog="' + key + '" role="switch" aria-checked="' + on + '" aria-label="' + title + '" style="flex:none;width:44px;height:26px;border-radius:13px;border:none;cursor:pointer;background:' + (on ? "var(--teal,#0e6e63)" : "var(--line,#cfd8d6)") + ';position:relative"><span style="position:absolute;top:3px;left:' + (on ? "21px" : "3px") + ';width:20px;height:20px;border-radius:50%;background:#fff"></span></button></div>';
    }
    wrap.innerHTML =
      '<div role="dialog" aria-label="Notification preferences" style="background:var(--panel,#fff);color:var(--ink,#0f172a);width:100%;max-width:460px;border-radius:18px 18px 0 0;padding:18px 18px calc(20px + env(safe-area-inset-bottom));font-family:var(--sans,system-ui);box-shadow:0 -10px 40px rgba(0,0,0,.25);max-height:86vh;overflow:auto">' +
      '<div style="font:800 17px/1.2 var(--serif,Georgia,serif);margin-bottom:4px">🔔 Notification preferences</div>' +
      '<div style="font:500 12.5px/1.5 var(--sans,system-ui);color:var(--slate,#5a7184);margin-bottom:12px">Choose what this unit pings you about. Critical and overdue alerts always come through.</div>' +
      lockRow("Critical &amp; overdue", "Patient safety — can't be turned off") +
      lockRow("Urgent orders (immediate / high)", "Time-critical — can't be turned off") +
      togRow("handover", "Shift handovers", "SBAR when a shift hands over") +
      togRow("orderRoutine", "Routine orders", "New moderate / low priority tasks") +
      togRow("activity", "Unit activity", "Task completions, new admissions") +
      '<button id="icuNotifDone" style="width:100%;margin-top:16px;padding:12px;border:none;border-radius:11px;background:var(--teal,#0e6e63);color:#fff;font:800 14px var(--sans,system-ui);cursor:pointer">Done</button>' +
      '</div>';
    document.body.appendChild(wrap);
    var close = function () { try { wrap.remove(); } catch (e) {} };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector("#icuNotifDone").addEventListener("click", close);
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-tog]"), function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-tog");
        prefs[key] = !prefs[key];
        var on = prefs[key];
        btn.setAttribute("aria-checked", String(on));
        btn.style.background = on ? "var(--teal,#0e6e63)" : "var(--line,#cfd8d6)";
        var knob = btn.querySelector("span"); if (knob) knob.style.left = on ? "21px" : "3px";
        grpNotifPrefsSave({ orderRoutine: prefs.orderRoutine, handover: prefs.handover, activity: prefs.activity });
      });
    });
  }
  // Last on-issue push attempt's outcome, so a 0-reach or failed push stays VISIBLE on the board
  // (not just a toast that auto-dismisses right as grpRoundBack() navigates away — easy to miss
  // mid-rounds). Cleared once a later attempt reaches at least one device. Read by grpPushNoteHTML().
  var _grpLastPush = null;   // { ts, kind: 'none'|'error', text }
  // On native the WebView origin is https://localhost, so a relative "/api/..." fetch hits the local
  // app shell (nonexistent) and fails — the real cause of "task assigned but nobody notified". Every
  // API call MUST be absolute via SMD_API_BASE (empty on web, https://stewardmd.in on device), the
  // same idiom native-push.js / watch-lab.js already use.
  function grpPushUrl(p) { return (window.SMD_API_BASE || "") + p; }
  function grpPushNoteHTML() {
    if (!_grpLastPush) return "";
    if ((nowTs() - _grpLastPush.ts) > 30 * 60000) return "";   // stale (>30 min) — stop showing it
    return '<div class="icu-v2-note" style="border-color:var(--warn);color:var(--warn);display:flex;align-items:flex-start;gap:8px">' +
      '<span style="flex:1">' + ico("warn", "⚠️") + ' ' + esc(_grpLastPush.text) + '</span>' +
      '<button class="icu-v2-note-x" data-icu-act="pushnotedismiss" aria-label="Dismiss">✕</button></div>';
  }
  function grpPushNoteDismiss() { _grpLastPush = null; if (ICU.isOpen()) paintLive(); }
  // Immediate push to the unit when an instruction is issued (called from grpDoPostRound). The server
  // pushes the other members (or the author if solo, so it's verifiable) — no waiting for overdue.
  function grpNotifyInstruction(gid, pid, chosen, priority) {
    var text = (chosen && chosen[0]) || "New instruction";
    function note(kind, msg) { _grpLastPush = { ts: nowTs(), kind: kind, text: msg }; if (ICU.isOpen() && _screen === "board") paintLive(); }
    // Self-diagnosing failure banner: the version tag (g412) proves which build is running, the base
    // shows the origin the request targeted, and the reason gives the HTTP status / error — so one
    // screenshot pinpoints the failing layer instead of a generic "check your connection". Only shows
    // on failure; trim the bracket once push is confirmed working end-to-end on device.
    var VER = "g417";
    var base = window.SMD_API_BASE || "(relative)";
    function fail(reason) { note("error", "Push failed — teammates not alerted. [" + VER + " · " + base + " · " + reason + "]"); }
    try {
      idToken().then(function (tok) {
        if (!tok) { note("error", "Not signed in — teammates won't be alerted. [" + VER + " · token missing]"); return; }
        var status = 0;
        fetch(grpPushUrl("/api/push/instruction"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ gid: gid, pid: pid, text: text, priority: priority, count: (chosen ? chosen.length : 1) }) })
          .then(function (r) { status = r.status; return r.json().catch(function () { return null; }); })
          .then(function (j) {
            // Surface push REACH so it's obvious when teammates aren't registered for notifications.
            if (j && j.sent > 0) { _grpLastPush = null; if (window.toast) toast("Pushed to " + j.sent + " device" + (j.sent === 1 ? "" : "s")); return; }
            if (j && j.notified > 0) { note("none", "No teammate is registered for push yet — ask them to enable notifications in Settings › Ward Integration."); return; }
            // Teammates exist but none opted into this category (e.g. a routine order the seniors have
            // muted) — that's a deliberate preference, not a delivery failure, so don't alarm the sender.
            if (j && j.eligible > 0) { _grpLastPush = null; if (ICU.isOpen() && _screen === "board") paintLive(); return; }
            fail("HTTP " + status + (j && j.error ? " " + j.error : ""));
          })
          .catch(function (e) { fail("fetch " + ((e && e.message) || e || "failed")); });
      }, function () { note("error", "Not signed in — teammates won't be alerted. [" + VER + " · idToken rejected]"); });
    } catch (e) { fail("throw " + ((e && e.message) || e)); }
  }
  // "Hand over to next shift" → push the unit (incoming shift) that a handover is ready.
  function grpNotifyHandover(gid, pid, sbar) {
    try {
      var text = (sbar && sbar[0] && sbar[0].body) || "Shift handover";   // the Situation line
      idToken().then(function (tok) {
        if (!tok) return;
        fetch(grpPushUrl("/api/push/instruction"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok }, body: JSON.stringify({ gid: gid, pid: pid, text: text, kind: "handover" }) })
          .then(function (r) { return r.json(); })
          .then(function (j) { if (window.toast && j && !j.sent && j.notified > 0) toast("Handover recorded — but no teammate is registered for push yet"); }, function () {})
          .catch(function () {});
      }, function () {});
    } catch (e) {}
  }
  // The Notifications screen in group mode — the LIVE smart feed (replaces the acuity-only stub).
  function renderV2AlertsGroup() {
    var rows = grpNotifRows(), seen = grpNotifSeen();
    var header = '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="icuboard" aria-label="Back to unit board">‹</button><div><div class="icu-v2-shead-h">Notifications</div><div class="icu-v2-shead-s">Only clinically meaningful events</div></div></div>';
    var note = '<div class="icu-v2-note">' + ico("info", "ⓘ") + ' Live from this shared unit — critical acuity, instructions for you, completed tasks, new investigations and med changes. Derived from the unit snapshot plus the open patient’s timeline; a full per-event unit feed is a later refinement.</div>';
    var body = rows.length ? rows.map(function (r) {
      var fresh = (r.ts || 0) > seen;
      return '<button class="icu-v2-alert-row ' + (r.urgent ? "critical" : "review") + (fresh ? " fresh" : "") + '" data-icu-act="openpt:' + encodeURIComponent(r.id) + '" aria-label="' + esc((r.urgent ? "Urgent: " : "") + (fresh ? "New. " : "") + r.title + (r.body ? ". " + r.body : "") + " — open patient") + '">' +
        '<span class="icu-v2-alert-ic" aria-hidden="true">' + esc(r.icon || "🔔") + '</span>' +
        '<span class="icu-v2-alert-tx"><span class="icu-v2-alert-h">' + esc(r.title) + (r.urgent ? '<span class="icu-v2-urg">URGENT</span>' : "") + '</span>' +
        (r.body ? '<span class="icu-v2-alert-b">' + esc(r.body) + '</span>' : "") +
        '<span class="icu-v2-alert-ago">' + esc(fmtAgo(r.ts) || fmtWhen(r.ts) || "") + '</span></span></button>';
    }).join("") : '<div class="icu-v2-empty2">No new alerts. Critical changes, consultant instructions, completed tasks and new investigations will appear here.</div>';
    return '<div class="icu-scroll icu-v2-scroll icu-v2-screen">' + header + '<div class="icu-v2-slist">' + note + body + '</div></div>';
  }

  /* --------------------------- round-note composer (full-screen) ------------------------------ */
  function grpRoundChosen() {
    var out = [], i;
    for (i = 0; i < ROUND_PRESETS.length; i++) if (_roundSel[i]) out.push(ROUND_PRESETS[i]);
    for (i = 0; i < _roundExtra.length; i++) if (_roundExtra[i]) out.push(_roundExtra[i]);
    var pend = String(_roundText || "").trim(); if (pend) out.push(pend);
    return out;
  }
  function grpRoundCaptureText() { try { var el = rootEl && rootEl.querySelector("#icuRoundCustom"); if (el) _roundText = String(el.value || ""); } catch (e) {} }
  // Priority picker (instructing roles only) — sets the deadline window a task must be done within.
  function priorityPickerHTML() {
    return '<div class="icu-card"><div class="icu-sec-lbl" style="margin:0 0 10px">Priority — done within</div><div class="icu-v2-priopick">' +
      PRIORITY_ORDER.map(function (k) {
        var pr = TASK_PRIORITY[k], on = _roundPriority === k;
        return '<button class="icu-v2-priochip' + (on ? " on" : "") + '" data-icu-act="grproundprio:' + k + '" aria-pressed="' + on + '"' + (on ? ' style="border-color:' + pr.color + ';background:' + pr.color + '"' : "") + '>' +
          '<span class="icu-v2-prio-top"><span class="icu-v2-priodot" style="background:' + pr.color + '"></span>' + esc(pr.label) + '</span>' +
          '<span class="icu-v2-priosub">' + esc(pr.sub) + '</span></button>';
      }).join("") + '</div></div>';
  }
  // "Instructed by" picker — attribute an order to a named colleague (a resident logging a
  // consultant's verbal round order). Shown only when there ARE teammates. Default = Me.
  function onBehalfPickerHTML() {
    var members = _grpMembers || [], myUid = (typeof ownerNow === "function") ? ownerNow() : null;
    var others = members.filter(function (m) { return m.uid && m.uid !== myUid; });
    if (!others.length) return "";
    var chips = '<button class="icu-v2-obchip' + (_roundOnBehalf ? "" : " on") + '" data-icu-act="grproundbehalf:self">' + ico("user", "🧑") + ' Me</button>' +
      others.map(function (m) {
        var on = _roundOnBehalf === m.uid;
        return '<button class="icu-v2-obchip' + (on ? " on" : "") + '" data-icu-act="grproundbehalf:' + encodeURIComponent(m.uid) + '">' + esc(m.name || grpRoleLabel(m.role)) + (m.role ? ' <span class="icu-v2-obrole">' + esc(grpRoleLabel(m.role)) + '</span>' : "") + '</button>';
      }).join("");
    return '<div class="icu-card"><div class="icu-sec-lbl" style="margin:0 0 8px">Instructed by <span style="opacity:.6">· optional</span></div>' +
      '<p class="icu-doc-sub" style="margin:0 0 9px">Log a colleague’s verbal order under their name — e.g. a consultant’s round instruction.</p>' +
      '<div class="icu-v2-obpick">' + chips + '</div></div>';
  }
  function grpRoundSetBehalf(uid) { grpRoundCaptureText(); _roundOnBehalf = (!uid || uid === "self") ? null : decodeURIComponent(uid); paint(); }
  function renderV2RoundNote() {
    var pt = (_grpPtVM && _grpPtVM.patient) || {}, p = _raw.patient || {};
    var bed = pt.bed || p.bed || "—", nm = pt.name || p.name || "Patient";
    var instr = grpCanInstruct(_grp && _grp.myRole);
    var header = '<div class="icu-v2-shead"><button class="icu-v2-sback" data-icu-act="grproundback" aria-label="Back to rounds">‹</button>' +
      '<div><div class="icu-v2-shead-h">Add round note</div><div class="icu-v2-shead-s">Bed ' + esc(bed) + ' · ' + esc(nm) + '</div></div></div>';
    var intro = '<div class="icu-v2-note">' + ico("info", "ⓘ") + ' Tap an order — each becomes a tracked task at your chosen priority. Add your own below, and optionally log it under the consultant who gave it.</div>';
    var errNote = _grpErr ? '<div class="icu-v2-note" style="border-color:var(--warn);color:var(--warn)">' + ico("warn", "⚠️") + ' ' + esc(_grpErr) + '</div>' : "";
    var prio = priorityPickerHTML();
    // BOX 1 — suggestions: capped-height, scrolls INSIDE; presets + custom-added chips as wrapping tags.
    var chips = ROUND_PRESETS.map(function (txt, i) {
      var on = !!_roundSel[i];
      return '<button class="icu-v2-rchip' + (on ? " on" : "") + '" data-icu-act="grproundtog:' + i + '" aria-pressed="' + on + '" aria-label="' + esc(txt) + '"><span class="icu-v2-rbox" aria-hidden="true">' + (on ? "✓" : "") + '</span><span class="icu-v2-rtx">' + esc(txt) + '</span></button>';
    }).join("") + _roundExtra.map(function (txt, i) {
      return '<button class="icu-v2-rchip on" data-icu-act="grproundrm:' + i + '" aria-label="' + esc("Remove: " + txt) + '"><span class="icu-v2-rbox" aria-hidden="true">✓</span><span class="icu-v2-rtx">' + esc(txt) + '</span><span class="icu-v2-rx" aria-hidden="true">✕</span></button>';
    }).join("");
    var sugBox = '<div class="icu-card icu-v2-sugbox"><div class="icu-sec-lbl" style="margin:0 0 10px">Common instructions — tap to add</div><div class="icu-v2-rpre">' + chips + '</div></div>';
    // BOX 2 — add your own (always visible, right below the suggestions box).
    var custom = '<div class="icu-card icu-v2-ownbox"><div class="icu-sec-lbl" style="margin:0 0 8px">Add your own</div>' +
      '<div class="icu-v2-rcustom"><input id="icuRoundCustom" type="text" aria-label="Add your own instruction" placeholder="e.g. Increase PEEP to 8" value="' + esc(_roundText) + '"><button class="icu-btn" data-icu-act="grproundadd" aria-label="Add this instruction">Add</button></div></div>';
    var n = grpRoundChosen().length;
    var btnLbl = n ? "Post " + n + " instruction" + (n === 1 ? "" : "s") + " · " + TASK_PRIORITY[_roundPriority].label : "Choose or type an instruction";
    var post = '<div class="icu-v2-rpost"><button class="icu-btn' + (n ? "" : " ghost") + '" data-icu-act="grproundpost"' + (n ? "" : " disabled") + '>' + esc(btnLbl) + '</button></div>';
    // Flex column: header (fixed) · body (intro/priority/add-your-own fixed + suggestions box flexes &
    // scrolls) · post bar (fixed). Both boxes stay on screen; only the suggestions list scrolls.
    return '<div class="icu-v2-dialog" role="dialog" aria-modal="true" aria-label="Add round note" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden">' +
      header + '<div class="icu-v2-rbody">' + errNote + intro + prio + sugBox + custom + onBehalfPickerHTML() + '</div>' + post + '</div>';
  }
  function grpRoundSetPriority(k) { grpRoundCaptureText(); if (TASK_PRIORITY[k]) _roundPriority = k; paint(); }
  function grpOpenRound() {
    if (!grpActive() || !_grpPtId) return;
    _roundSel = {}; _roundExtra = []; _roundText = ""; _roundPriority = "high"; _roundOnBehalf = null; _grpErr = null;
    _screen = "round"; _paintTop = true; paint();
  }
  function grpRoundToggle(i) { grpRoundCaptureText(); i = +i; _roundSel[i] = !_roundSel[i]; paint(); }
  function grpRoundAddCustom() {
    grpRoundCaptureText();
    var t = String(_roundText || "").trim();
    if (t) { _roundExtra.push(t); _roundText = ""; }
    paint();
    try { var el = rootEl && rootEl.querySelector("#icuRoundCustom"); if (el) el.focus(); } catch (e) {}
  }
  function grpRoundRemove(i) { grpRoundCaptureText(); i = +i; if (i >= 0 && i < _roundExtra.length) _roundExtra.splice(i, 1); paint(); }
  function grpRoundBack() { _screen = "patient"; _active = "rounds"; _ws = wsOf("rounds"); _wsLast[_ws] = "rounds"; _paintTop = true; paint(); }
  function grpDoPostRound() {
    grpRoundCaptureText();
    var api = groupsApi(); if (!api || !grpActive() || !_grpPtId) return;
    var chosen = grpRoundChosen(); if (!chosen.length) return;
    var instr = true;   // any unit member can log a tracked instruction now (the consultant often says it orally + a resident notes it down — attribute via "Instructed by")
    var onBehalf = null;
    if (_roundOnBehalf) { var _m = (_grpMembers || []).filter(function (x) { return x.uid === _roundOnBehalf; })[0]; if (_m) onBehalf = { uid: _m.uid, name: _m.name || grpRoleLabel(_m.role) }; }
    var plan = grpRoundPlan(chosen, instr, v2AccountName(), _roundPriority, onBehalf);
    var gid = _grp.id, pid = _grpPtId, i;
    for (i = 0; i < plan.tasks.length; i++) {
      (function (task) { try { var pr = api.addTask(gid, pid, task); if (pr && pr.then) pr.then(null, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen()) paint(); }); } catch (e) {} })(plan.tasks[i]);
    }
    if (plan.event) { try { var pe = api.addTimelineEvent(gid, pid, plan.event); if (pe && pe.then) pe.then(null, function () {}); } catch (e) {} }
    // Immediate push to the unit when an instruction is ISSUED (not just when it later goes overdue) —
    // so residents are alerted the moment a high/immediate order is given.
    if (instr && plan.tasks.length) { try { grpNotifyInstruction(gid, pid, chosen, _roundPriority); } catch (e) {} }
    _roundSel = {}; _roundExtra = []; _roundText = ""; _roundOnBehalf = null;
    if (window.toast) toast(instr ? (plan.tasks.length + " instruction" + (plan.tasks.length === 1 ? "" : "s") + " posted" + (onBehalf ? " for " + onBehalf.name : "")) : "Note posted");
    grpRoundBack();
  }

  // Rounds tab in group mode → prepend the LIVE shared instructions/tasks + audit timeline. The
  // wrap is additive: with group mode off, grpActive() is false and the original Rounds is returned
  // untouched (RENDER.rounds is already defined above, so this runs at load once).
  (function () {
    var _origRounds = RENDER.rounds;
    RENDER.rounds = function () {
      var base = _origRounds ? _origRounds.apply(RENDER, arguments) : "";
      return grpActive() ? (grpRoundsPanel() + base) : base;
    };
  })();

  function paintV2() {
    if (!rootEl) return;
    var _osc = rootEl.querySelector(".icu-scroll");
    var _keepTop = (_paintTop || !_osc) ? 0 : _osc.scrollTop;
    _paintTop = false;
    if (_screen === "board") {
      rootEl.innerHTML = renderV2Board() + renderV2BottomBar();
    } else if (_screen === "units") {
      rootEl.innerHTML = renderUnitPicker();
    } else if (_screen === "round") {
      rootEl.innerHTML = renderV2RoundNote();   // Phase 3: full-screen round-note composer (no bottom bar)
    } else if (_screen === "alerts") {
      rootEl.innerHTML = renderV2Alerts() + renderV2BottomBar();
    } else if (_screen === "team") {
      rootEl.innerHTML = renderV2Team() + renderV2BottomBar();
    } else if (grpActive() && _grpPtId && _grpPtVM === null) {
      // Phase 4: an open shared patient whose live view-model has not returned yet — calm loading.
      rootEl.innerHTML = renderV2PatientLoading();
    } else {
      var fab = isMonWs() ? '<button id="icuSnap" data-icu-act="snapshot" aria-label="ICU Snapshot">' + ico("camera", "📷") + '</button>' : "";
      var watchFab = labWatchOn()
        ? '<button id="icuWatch" data-icu-act="lwmgr" aria-label="Lab Watch 24/7 — alerts even when the app is closed">' + ico("bell", "🔔") + '<span>Lab Watch 24/7</span></button>'
        : "";
      rootEl.innerHTML = renderV2Banner() + renderV2Presence() + grpOfflineBar() + renderV2TopTabs() + renderBody() + watchFab + fab;
    }
    if (_keepTop) { var _nsc = rootEl.querySelector(".icu-scroll"); if (_nsc) _nsc.scrollTop = _keepTop; }
  }

  /* ---------------------------------------------------- manual entry forms */
  var FORMS = {
    patient: { title: "Patient details", domain: "patient", fields: [
      { k: "name", l: "Name / initials", t: "text" }, { k: "age", l: "Age", t: "number" }, { k: "sex", l: "Sex", t: "select", opts: ["", "M", "F", "Other"] },
      { k: "weightKg", l: "Weight (kg)", t: "number" }, { k: "heightCm", l: "Height (cm)", t: "number" }, { k: "bed", l: "Bed", t: "text" },
      { k: "icuDay", l: "ICU day", t: "number" }, { k: "hospital", l: "Hospital", t: "text" }, { k: "complaints", l: "Presenting complaints", t: "textarea", wide: true }, { k: "diagnosis", l: "Working diagnosis", t: "text", wide: true }, { k: "status", l: "Current status", t: "text", wide: true } ] },
    monitor: { title: "Vitals (ICU monitor)", ingest: ingestMonitor, fields: [
      { k: "hr", l: "Heart rate", t: "number" }, { k: "sbp", l: "Systolic BP", t: "number" }, { k: "dbp", l: "Diastolic BP", t: "number" }, { k: "map", l: "MAP (optional)", t: "number" },
      { k: "rr", l: "Resp rate", t: "number" }, { k: "spo2", l: "SpO₂ %", t: "number" }, { k: "temp", l: "Temp °C", t: "number" }, { k: "uop", l: "Urine mL/h", t: "number" },
      { k: "lactate", l: "Lactate mmol/L", t: "number" }, { k: "cvp", l: "CVP mmHg", t: "number" }, { k: "etco2", l: "EtCO₂ mmHg", t: "number" } ] },
    labs: { title: "Laboratory values", ingest: ingestLabs, fields: [
      { k: "na", l: "Na mEq/L", t: "number" }, { k: "k", l: "K mEq/L", t: "number" }, { k: "cl", l: "Cl mEq/L", t: "number" }, { k: "hco3", l: "HCO₃ mEq/L", t: "number" },
      { k: "ca", l: "Ca mg/dL", t: "number" }, { k: "mg", l: "Mg mg/dL", t: "number" }, { k: "po4", l: "PO₄ mg/dL", t: "number" }, { k: "creat", l: "Creatinine mg/dL", t: "number" },
      { k: "alb", l: "Albumin g/dL", t: "number" }, { k: "glu", l: "Glucose mg/dL", t: "number" }, { k: "wbc", l: "WBC", t: "number" }, { k: "hb", l: "Hb g/dL", t: "number" },
      { k: "plt", l: "Platelets", t: "number" }, { k: "ferritin", l: "Ferritin", t: "number" }, { k: "crp", l: "CRP", t: "number" }, { k: "inr", l: "INR", t: "number" } ] },
    abg: { title: "Arterial blood gas", ingest: function (o) { Object.keys(o).forEach(function (k) { STATE.abg[k] = o[k]; }); STATE.abg.ts = nowTs(); }, fields: [
      { k: "ph", l: "pH", t: "number" }, { k: "paco2", l: "PaCO₂ mmHg", t: "number" }, { k: "pao2", l: "PaO₂ mmHg", t: "number" }, { k: "hco3", l: "HCO₃ mEq/L", t: "number" }, { k: "fio2", l: "FiO₂ %", t: "number" }, { k: "be", l: "Base excess", t: "number" } ] },
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

  var modalEl = null, _formDomain = null;
  // BUG #16: a guest session expires after 5 min (in the frozen app.js gate, which reloads
  // the page). Persist the in-progress data-entry draft to localStorage on every keystroke
  // so a half-typed form survives the expiry/reload and is restored when it reopens. Drafts
  // are per-account (ownerNow) and cleared on Save or Cancel; only an interrupted session
  // ever leaves one behind. Local-device only, same class as the state already persisted.
  function formDraftKey(domain) { return "smd_icu_draft:" + (typeof ownerNow === "function" ? ownerNow() : "anon") + ":" + domain; }
  function readFormDraft(domain) { try { var d = JSON.parse(localStorage.getItem(formDraftKey(domain)) || "null"); if (d && d.at && (nowTs() - d.at) < 1800000 && d.vals) return d.vals; } catch (e) {} return null; }
  function writeFormDraft(domain, vals) { try { if (vals && Object.keys(vals).length) localStorage.setItem(formDraftKey(domain), JSON.stringify({ at: nowTs(), vals: vals })); else localStorage.removeItem(formDraftKey(domain)); } catch (e) {} }
  function clearFormDraft(domain) { try { if (domain) localStorage.removeItem(formDraftKey(domain)); } catch (e) {} }
  function collectFormValues() { var obj = {}; if (modalEl) modalEl.querySelectorAll("[data-k]").forEach(function (el) { var v = el.value; if (v !== "" && v != null) obj[el.getAttribute("data-k")] = v; }); return obj; }
  function openForm(domain) {
    var F = FORMS[domain]; if (!F) return;
    ensureModal();
    _formDomain = domain;
    var cur = domain === "patient" ? _raw.patient : domain === "abg" ? _raw.abg : domain === "ventilator" ? _raw.ventilator : domain === "flowsheet" ? _raw.fluids : domain === "labs" ? _raw.labs.recent : {};
    var draft = readFormDraft(domain), restored = false;
    var fieldsHTML = F.fields.map(function (f) {
      var v;
      if (draft && draft[f.k] != null && draft[f.k] !== "") { v = draft[f.k]; restored = true; }
      else v = (F.custom === "goals") ? (_raw.goals || []).join("\n") : (cur[f.k] != null ? cur[f.k] : "");
      // BUG #15: every input carries a stable id + name + aria-label and an associated
      // <label for> so screen readers announce each field (11 vitals inputs et al.).
      var fid = "icufld-" + domain + "-" + f.k, al = esc(f.l), attrs = ' id="' + fid + '" name="' + esc(f.k) + '" aria-label="' + al + '"';
      var inp;
      if (f.t === "select") inp = '<select data-k="' + f.k + '"' + attrs + '>' + f.opts.map(function (o) { return '<option' + (String(o) === String(v) ? " selected" : "") + ">" + esc(o || "—") + "</option>"; }).join("") + "</select>";
      else if (f.t === "textarea") inp = '<textarea data-k="' + f.k + '"' + attrs + ' rows="5" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(v) + "</textarea>";
      else inp = '<input data-k="' + f.k + '"' + attrs + ' type="' + (f.t === "number" ? "number" : "text") + '" step="any"' + (f.t === "number" ? ' inputmode="decimal"' : "") + ' value="' + esc(v) + '">';
      return '<div class="icu-fld" style="' + (f.wide ? "grid-column:1/-1" : "") + '"><label for="' + fid + '">' + al + "</label>" + inp + "</div>";
    }).join("");
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + esc(F.title) + '</h3>' +
      (restored ? '<div class="icu-draft-note" role="status" style="font:600 12px var(--font);color:var(--primary);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-bottom:10px">↩ Restored your unsaved draft — review before saving.</div>' : "") +
      '<div class="icu-grid2">' + fieldsHTML + "</div>" +
      '<button class="icu-btn" data-icu-act="save:' + domain + '">Save</button><button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
    // Persist the draft as the clinician types, so it survives a guest-session expiry/reload.
    modalEl.oninput = function () { writeFormDraft(domain, collectFormValues()); };
  }
  function closeForm() { if (modalEl) modalEl.classList.remove("on"); clearFormDraft(_formDomain); _formDomain = null; }
  function saveForm(domain) {
    var F = FORMS[domain]; if (!F || !modalEl) return;
    var inputs = modalEl.querySelectorAll("[data-k]"), obj = {};
    inputs.forEach(function (el) { var k = el.getAttribute("data-k"), val = el.value; obj[k] = (el.type === "number") ? num(val) : val; });
    // BUG #13: manual Vitals/Labs entry — the two domains that fire critical alerts — is
    // routed through the SAME clinician review sheet the imports use, so a mistyped value
    // (e.g. K 68 for 6.8) is shown against the current reading and NOTHING is applied until
    // the clinician confirms. Values are already in app units (mapped/vitals skip wardToSI),
    // so it's unit-safe; source "Manual" keeps the override-vs-Ward-Sync conflict behaviour.
    if (domain === "monitor" || domain === "labs") {
      var mfields = {}; Object.keys(obj).forEach(function (k) { if (obj[k] != null && obj[k] !== "" && !(typeof obj[k] === "number" && isNaN(obj[k]))) mfields[k] = obj[k]; });
      closeForm();
      if (Object.keys(mfields).length) openImportReview(domain, mfields, null, null, "Manual");
      return;
    }
    if (F.custom === "goals") { STATE.goals = (obj.goals || "").split("\n").map(function (s) { return s.trim(); }).filter(Boolean); }
    else if (F.custom === "infusion") { if (obj.drug) ingestInfusion({ drug: obj.drug, dose: num(obj.dose), unit: obj.unit, rateMlHr: num(obj.rateMlHr), indication: obj.indication, source: "manual" }); }
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
    // Snapshot capture is available whenever an image engine can run on this device —
    // native device OCR (Apple Vision) OR AI Vision. The clinician chooses the engine per
    // image via SMD_IMAGE_ENGINE. Hidden on web (no native capture/OCR).
    var canSnap = !!(window.SMD_IS_NATIVE && ((window.SMD_NATIVE && window.SMD_NATIVE.ocr) ||
      (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.aiAvailable && SMD_IMAGE_ENGINE.aiAvailable())));
    var steps = [["📷", "ICU Monitor", "monitor", "pulse"], ["🩸", "ABG report", "abg", "abg"], ["🧪", "Laboratory Report", "labs", "flask"], ["🫁", "Ventilator", "ventilator", "lungs"], ["📋", "ICU Flow Sheet", "flowsheet", "droplet"]];
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("camera", "📷") + ' ICU Snapshot</h3>' +
      '<div class="icu-steps">' + steps.map(function (s, i) {
        return '<div class="icu-step"><div class="n">' + (i + 1) + '</div><div style="flex:1"><div style="font:700 14px var(--font)">' + ico(s[3], s[0]) + " Capture " + s[1] + "</div>" +
          (canSnap
            ? '<label class="icu-btn" style="display:inline-flex;width:auto;margin:6px 8px 0 0;padding:7px 12px;font-size:12px;cursor:pointer">' + ico("camera", "📷") + ' Capture / upload<input type="file" accept="image/*" capture="environment" data-snap="' + s[2] + '" style="display:none"></label><span class="man" data-icu-act="edit:' + s[2] + '" style="color:var(--primary);font:700 12px var(--font)">or ' + ico("edit", "✎") + ' enter manually</span><div class="snap-out" data-out="' + s[2] + '" style="font:600 11px var(--font);color:var(--muted);margin-top:4px"></div>'
            : '<span class="man" data-icu-act="edit:' + s[2] + '" style="color:var(--primary);font:700 12px var(--font)">' + ico("edit", "✎") + ' Enter manually for now</span>') +
          "</div></div>";
      }).join("") + "</div>" +
      (canSnap
        ? '<div class="icu-card" style="margin-top:12px"><span class="icu-badge" style="background:var(--ok-soft);color:var(--ok)">' + ico("camera", "📷") + ' Image Engine ready</span><p style="margin-top:8px">Capture any screen or report — you\'ll choose <b>Private Device OCR</b> (free, on-device) or <b>AI Vision</b> (Pro). Each capture reads the <b>whole report</b> and fills <b>every</b> relevant tab (an ABG slip fills both ABG <i>and</i> electrolytes). <b>Verify every value.</b></p></div>'
        : '<div class="icu-card" style="margin-top:12px;text-align:center"><span class="icu-badge">🚧 Snapshot · mobile app only</span><p style="margin-top:8px">Capture ICU screens and have them read into the tabs. Available in the StewardMD iOS/Android app.</p></div>') +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
    if (canSnap) {
      var ING = { monitor: "ingestMonitor", labs: "ingestLabs", ventilator: "ingestVentilator", flowsheet: "ingestFlowsheet" };
      // Shared body: compress a dataUrl/File then run vision and fill the tabs.
      function linesMsg(out, r) {
        if (r && r.lines && r.lines.length) { if (out) out.innerHTML = "Read on-device — couldn't auto-structure. Recognized: <span style=\"color:var(--muted)\">" + r.lines.slice(0, 8).map(function (s) { return String(s).replace(/[<>&]/g, ""); }).join(" · ") + "</span>. Tap ✎ to enter manually."; return true; }
        return false;
      }
      function runSnap(kind, out, dataUrl) {
        if (!dataUrl) { if (out) out.textContent = "Couldn't read that image — try again or enter manually."; return; }
        // COMBINED extraction (gold250): whichever report the clinician taps (Monitor/ABG/Labs/
        // Ventilator), read the WHOLE image/report and route EVERY value to its own tab — so an
        // ABG slip fills the ABG tab (pH, PaCO₂, PaO₂, HCO₃, base excess, lactate) AND the
        // electrolytes into Labs, not just electrolytes. Flow Sheet keeps its own schema (its
        // intake/output fields aren't in the combined set). Route via the clinician-controlled
        // Image Engine (device OCR vs AI Vision — choice preserved).
        var combined = (kind !== "flowsheet");
        var useKind = combined ? "all" : "flowsheet";
        var run = (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.process)
          ? SMD_IMAGE_ENGINE.process({ image: dataUrl, kind: useKind })
          : ((window.SMD_AI && SMD_AI.readImage) ? SMD_AI.readImage(dataUrl, useKind) : Promise.reject(new Error("no-reader")));
        run.then(function (r) {
          if (!r || r.cancelled) { if (out) out.textContent = ""; return; }
          if (combined) {
            var sec = coerceSections(r && r.fields), keys = [];
            ["labs", "abg", "vitals", "ventilator"].forEach(function (sc) { if (sec[sc]) keys = keys.concat(Object.keys(sec[sc])); });
            if (keys.length) {
              var bundle = { source: "ICU Snapshot" };
              if (sec.labs) bundle.mapped = sec.labs;
              if (sec.vitals) bundle.vitals = sec.vitals;
              if (sec.abg) bundle.abg = sec.abg;
              if (sec.ventilator) bundle.ventilator = sec.ventilator;
              try { ingestFromWard(bundle); paint(); } catch (e) {}
              if (out) out.textContent = "✓ Imported " + keys.length + " value(s): " + keys.join(", ") + " — verify in the tabs.";
            } else if (!linesMsg(out, r) && out) out.textContent = "Couldn't read that image — try again or enter manually.";
            return;
          }
          if (r.mode === "fields" && r.fields && Object.keys(r.fields).length) {
            try { if (ICU[ING[kind]]) ICU[ING[kind]](r.fields); } catch (e) {}
            if (out) out.textContent = "✓ Imported: " + Object.keys(r.fields).join(", ") + " — verify in the tabs.";
          } else if (!linesMsg(out, r) && out) out.textContent = "Couldn't read that image — try again or enter manually.";
        }).catch(function () { if (out) out.textContent = "Couldn't read this — enter manually."; });
      }
      if (window.SMD_IS_NATIVE && window.SMD_NATIVE) {
        // Native: the hidden <input type=file> never opens a picker in WKWebView.
        // Intercept the label tap and use the Camera plugin instead (same pipeline).
        modalEl.querySelectorAll("label input[data-snap]").forEach(function (inp) {
          var label = inp.parentNode, kind = inp.getAttribute("data-snap");
          label.addEventListener("click", function (e) {
            e.preventDefault();
            var out = modalEl.querySelector('[data-out="' + kind + '"]');
            if (out) out.textContent = "✨ Reading…";
            window.SMD_NATIVE.pickImage({ prompt: true }).then(function (dataUrl) {
              compressImage(dataUrl, function (d) { runSnap(kind, out, d); });
            }).catch(function () { if (out) out.textContent = ""; });
          });
        });
      } else {
        modalEl.querySelectorAll("input[data-snap]").forEach(function (inp) {
          inp.addEventListener("change", function () {
            var kind = inp.getAttribute("data-snap"), out = modalEl.querySelector('[data-out="' + kind + '"]');
            var f = inp.files && inp.files[0]; if (!f) return; if (out) out.textContent = "✨ Reading…";
            // Compress before sending to vision (was sending the raw full-res image → wasted
            // AI tokens). compressImage downscales to ~1024px / q0.6.
            compressImage(f, function (dataUrl) { runSnap(kind, out, dataUrl); });
          });
        });
      }
    }
  }

  function ensureModal() { if (!modalEl) { modalEl = document.createElement("div"); modalEl.className = "icu-modal"; modalEl.id = "icuModal"; document.body.appendChild(modalEl); modalEl.addEventListener("click", function (e) { if (e.target === modalEl) closeForm(); }); modalEl.addEventListener("click", onClick); } }
  function openRoundNote(k) {
    ensureModal();
    var it = ROUNDS_ITEMS.filter(function (x) { return x.k === k; })[0] || { label: k };
    var cur = (_raw.rounds[k] || {}).note || "";
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + esc(it.label) + '</h3><div class="icu-fld"><label>Note</label><textarea data-k="note" rows="4" placeholder="' + esc(it.ex || "Add a short note for this item…") + '" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(cur) + "</textarea></div>" +
      '<button class="icu-btn ghost" data-icu-act="roundmic:' + k + '" style="margin-bottom:8px">' + ico("mic", "🎤") + ' Speak <span style="opacity:.8;font-weight:700">· MaiK Scribe</span></button>' +
      '<button class="icu-btn" data-icu-act="saveroundnote:' + k + '">Save note</button><button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  // MaiK Scribe → round note: dictate into the note textarea (append), reusing the shared voice
  // dialog used by the Add-data sheet and MaiK chat. No new engine; native/Whisper/web STT.
  function roundNoteDictate(k) {
    if (!(window.SMD_VOICE && SMD_VOICE.openDialog)) { if (window.toast) toast("Voice intake is still loading…"); return; }
    var ta = modalEl && modalEl.querySelector("[data-k=note]");
    SMD_VOICE.openDialog({ target: "text", onText: function (t) {
      if (!t || !ta) return;
      var base = (ta.value || "").trim();
      ta.value = (base ? base + " " : "") + t;
      try { ta.focus(); } catch (e) {}
    } });
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
  // Print / Export-PDF: open a clean print view of the summary (device "Save as PDF" from the
  // print sheet). If pop-ups are blocked (some WKWebViews), fall back to the summary + Share.
  function printSummary() { phiExportConfirm("print / PDF export", doPrintSummary); }   // KI-H6 consent gate
  function doPrintSummary() {
    var name = _raw.patient.name || "ICU patient";
    var html = '<!doctype html><meta charset="utf-8"><title>StewardMD ICU — ' + esc(name) + '</title>' +
      '<style>body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;padding:24px;max-width:720px;margin:auto}h1{font-size:18px;margin:0 0 4px}.m{color:#666;font-size:12px;margin-bottom:16px}pre{white-space:pre-wrap;font:inherit}</style>' +
      '<h1>StewardMD ICU Summary</h1><div class="m">' + esc(name) + ' · generated for clinician review — verify before use</div><pre>' + esc(buildSummary()) + "</pre>";
    var w = null; try { w = window.open("", "_blank"); } catch (e) {}
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350); }
    else { openSummary(); if (window.toast) toast("Pop-up blocked — use Share to export as PDF"); }
  }

  /* ---- Discharge Creator: a STRUCTURED, clinician-reviewable discharge summary. Each section is a
   * fillable field, auto-filled from the patient's RECORDED data (demographics, working dx, complaints,
   * hospital course from rounds + significant trend changes, condition at discharge, key investigations)
   * and — crucially — DISCHARGE MEDICATIONS are pre-filled from the editable Treatment list. The clinician
   * edits every field; the draft persists (survives a guest-session reload). Copy / Print (formatted) /
   * Share — nothing is auto-sent. Works for ICU and Ward (labels follow the unit). ---- */
  var DISCHARGE_FIELDS = [
    { k: "admitDate", l: "Admission date", t: "text", ph: "e.g. 10 Jul 2026" },
    { k: "dischargeDate", l: "Discharge date", t: "text", ph: "e.g. 15 Jul 2026" },
    { k: "finalDx", l: "Final diagnosis", t: "text", wide: true },
    { k: "secondaryDx", l: "Secondary diagnoses / comorbidities", t: "textarea", wide: true },
    { k: "complaints", l: "Reason for admission", t: "textarea", wide: true },
    { k: "course", l: "Hospital course", t: "textarea", wide: true, rows: 6 },
    { k: "investigations", l: "Key investigations", t: "textarea", wide: true, rows: 4 },
    { k: "procedures", l: "Procedures / interventions", t: "textarea", wide: true },
    { k: "condition", l: "Condition at discharge", t: "textarea", wide: true, rows: 4 },
    { k: "meds", l: "Discharge medications", t: "textarea", wide: true, rows: 6 },
    { k: "followup", l: "Follow-up", t: "textarea", wide: true },
    { k: "advice", l: "Advice to patient / carer", t: "textarea", wide: true },
    { k: "doctor", l: "Discharging doctor", t: "text", wide: true }
  ];
  // Auto-filled defaults from recorded data (used when the clinician hasn't edited that field yet).
  function dischargeDefaults(st) {
    var s = st || _raw, p = s.patient || {}, lv = latestByTs(s.vitals), L = (s.labs && s.labs.recent) || {}, g = s.abg || {}, f = s.fluids || {}, v = s.ventilator || {}, mp = (lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp)), rounds = s.rounds || {}, alerts = s.alerts || [], infusions = s.infusions || [], tx = s.treatment || [];
    var d = {};
    var today = ""; try { today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) {}
    d.admitDate = "";
    d.dischargeDate = today;
    d.finalDx = p.diagnosis || "";
    d.secondaryDx = "";
    d.complaints = p.complaints || "";
    // Hospital course = rounds notes + significant trend changes (flattened plain text).
    var course = [];
    ROUNDS_ITEMS.forEach(function (it) { if (rounds[it.k] && rounds[it.k].note) course.push(it.label + ": " + rounds[it.k].note); });
    try { var sig = significantChanges(0); if (sig) sig.replace(/<[^>]+>/g, "|").split("|").map(function (x) { return x.trim(); }).filter(function (x) { return x && !/Significant changes|trend flags/.test(x); }).forEach(function (x) { course.push(x); }); } catch (e) {}
    var finds = s.findings || []; if (finds.length) course.unshift("Presented with " + finds.map(function (c) { return findChipLabel(c); }).join(", "));
    d.course = course.length ? course.map(function (x) { return "- " + x; }).join("\n") : "";
    // Key investigations
    var inv = [];
    var keyL = ["hb", "wbc", "plt", "na", "k", "creat", "urea", "crp", "inr"].filter(function (k) { return L[k] != null; }).map(function (k) { return k.toUpperCase() + " " + L[k]; });
    if (keyL.length) inv.push("Labs: " + keyL.join(", "));
    if (g.ph != null) inv.push("ABG: pH " + g.ph + (g.paco2 != null ? " / pCO₂ " + g.paco2 : "") + (g.hco3 != null ? " / HCO₃ " + g.hco3 : ""));
    (s.imaging || []).filter(function (im) { return im && !im.hidden; }).slice(0, 4).forEach(function (im) { inv.push((im.studyName || im.modality || "Imaging") + (im.impressionRaw ? ": " + String(im.impressionRaw).replace(/\s+/g, " ").slice(0, 160) : "")); });
    d.investigations = inv.map(function (x) { return "- " + x; }).join("\n");
    d.procedures = "";
    // Condition at discharge
    var cond = [];
    cond.push("Haemodynamics: HR " + (lv.hr != null ? lv.hr : "—") + ", BP " + (lv.sbp != null ? lv.sbp + "/" + lv.dbp : "—") + (mp != null ? ", MAP " + mp : "") + (lv.spo2 != null ? ", SpO₂ " + lv.spo2 + "%" : "") + (lv.temp != null ? ", Temp " + lv.temp : ""));
    if (v.mode && !_wardMode) cond.push("Respiratory support: " + v.mode + (v.fio2 ? ", FiO₂ " + v.fio2 + "%" : ""));
    if (f.net24h != null || f.cumulative != null) cond.push("Fluid balance: net 24h " + (f.net24h != null ? f.net24h + " mL" : "—") + (f.cumulative != null ? ", cumulative " + f.cumulative + " mL" : ""));
    var crit = alerts.filter(function (a) { return a.severity === "crit"; }); if (crit.length) cond.push("Active issues: " + crit.map(function (a) { return a.title; }).join("; "));
    d.condition = cond.map(function (x) { return "- " + x; }).join("\n");
    // Discharge medications — pre-filled from the editable Treatment list (fallback: running infusions).
    var meds = tx.map(function (t) { var dsg = [t.dose, t.route, t.freq].filter(Boolean).join(" "); return "- " + t.name + (dsg ? " " + dsg : "") + (t.cat && t.cat !== "other" ? "  (" + txCatLabel(t.cat) + ")" : ""); });
    if (!meds.length) meds = infusions.map(function (i) { return "- " + i.drug + (i.dose != null ? " " + i.dose + (i.unit || "") : ""); });
    d.meds = meds.join("\n");
    d.followup = "";
    d.advice = "";
    var who = v2AccountName(); if (who === "You") who = ""; if (who && grpActive() && _grp && _grp.myRole) who += " (" + grpRoleLabel(_grp.myRole) + ")";
    d.doctor = who;
    return d;
  }
  var _dischargeDefaults = {};
  function dischargeHeaderLine(p) {
    return (p.name || (ctxLabel() + " patient")) + (p.age != null ? ", " + p.age + "y" : "") + (p.sex ? " " + p.sex : "") +
      (p.bed ? " · Bed " + p.bed : "") + (_unit.type ? " · " + _unit.type : "") + (p.hospital || _unit.hospital ? " · " + (p.hospital || _unit.hospital) : "");
  }
  function openDischarge() {
    injectCSS(); ensureModal();
    lwOnDischarge();   // an "until discharge" Lab Watch ends when the discharge summary is created
    // No cross-session draft: fields auto-fill FRESH from this patient's recorded data each open (a
    // per-owner draft could leak one patient's discharge edits onto another). In-progress edits live
    // in the DOM until Copy/Print/Close, which is all a single discharge sitting needs.
    _dischargeDefaults = dischargeDefaults();
    var p = _raw.patient || {};
    var fieldsHTML = DISCHARGE_FIELDS.map(function (fl) {
      var v = _dischargeDefaults[fl.k] || "";
      var fid = "dis-" + fl.k, al = esc(fl.l);
      var inp = (fl.t === "textarea")
        ? '<textarea id="' + fid + '" data-k="' + fl.k + '" rows="' + (fl.rows || 2) + '" spellcheck="false" style="width:100%;box-sizing:border-box;font:500 13px/1.5 var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);resize:vertical">' + esc(v) + '</textarea>'
        : '<input id="' + fid + '" data-k="' + fl.k + '" type="text" placeholder="' + esc(fl.ph || "") + '" value="' + esc(v) + '">';
      return '<div class="icu-fld" style="' + (fl.wide ? "grid-column:1/-1" : "") + '"><label for="' + fid + '">' + al + '</label>' + inp + '</div>';
    }).join("");
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("rounds", "📝") + ' Discharge Creator <span style="font:700 11px var(--font);color:var(--warn);background:var(--warn-soft);padding:2px 7px;border-radius:999px;vertical-align:middle">DRAFT</span></h3>' +
      '<div style="font:700 14px var(--font);color:var(--ink);margin:-2px 0 2px">' + esc(dischargeHeaderLine(p)) + '</div>' +
      '<p class="icu-doc-sub" style="margin:0 0 12px">Auto-filled from recorded data (incl. discharge meds from the Treatment list). <b>Review &amp; complete every section</b>, then copy, print or share. Nothing is sent anywhere.</p>' +
      '<div class="icu-grid2">' + fieldsHTML + '</div>' +
      '<button class="icu-btn" data-icu-act="dischargecopy">' + ico("copy", "📋") + ' Copy summary</button>' +
      '<button class="icu-btn ghost" data-icu-act="dischargeprint">' + ico("copy", "🖨") + ' Print / PDF</button>' +
      '<button class="icu-btn ghost" data-icu-act="sharecase">' + ico("share", "📤") + ' Share</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
  }
  // Collect the current field values from the open form, falling back to the auto-filled default.
  function dischargeFieldVals() {
    var vals = {}; var cur = (modalEl ? collectFormValues() : {});
    DISCHARGE_FIELDS.forEach(function (fl) { vals[fl.k] = (cur[fl.k] != null && cur[fl.k] !== "") ? cur[fl.k] : (_dischargeDefaults[fl.k] || ""); });
    return vals;
  }
  // Assemble the final plain-text summary from field values (empty sections are omitted).
  function assembleDischarge(f) {
    f = f || dischargeFieldVals();
    var p = _raw.patient || {}, out = [];
    out.push("STEWARDMD — " + ctxLabel().toUpperCase() + " DISCHARGE SUMMARY (DRAFT — clinician review required)");
    out.push(dischargeHeaderLine(p));
    if (f.admitDate || f.dischargeDate) out.push("Admitted: " + (f.admitDate || "[ ]") + "    Discharged: " + (f.dischargeDate || "[ ]"));
    out.push("");
    var sec = function (title, val) { if (val && String(val).trim()) { out.push(title + ":"); out.push(String(val).trim()); out.push(""); } };
    out.push("FINAL DIAGNOSIS: " + (f.finalDx || "[ complete ]"));
    if (f.secondaryDx && f.secondaryDx.trim()) out.push("SECONDARY DIAGNOSES: " + f.secondaryDx.trim());
    out.push("");
    sec("REASON FOR ADMISSION", f.complaints);
    sec("HOSPITAL COURSE", f.course);
    sec("KEY INVESTIGATIONS", f.investigations);
    sec("PROCEDURES / INTERVENTIONS", f.procedures);
    sec("CONDITION AT DISCHARGE", f.condition);
    sec("DISCHARGE MEDICATIONS", f.meds);
    sec("FOLLOW-UP", f.followup);
    sec("ADVICE TO PATIENT / CARER", f.advice);
    if (f.doctor && f.doctor.trim()) out.push("Discharging doctor: " + f.doctor.trim());
    out.push("— Draft generated from recorded data. Verify every value before use. Decision support only. StewardMD.");
    return out.join("\n");
  }
  function copyDischarge() {
    var t = assembleDischarge();
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t); } catch (e) {}
    if (window.toast) toast("Discharge summary copied — verify before use");
  }
  function printDischarge() { phiExportConfirm("discharge print / PDF export", doPrintDischarge); }   // KI-H6 consent gate
  function doPrintDischarge() {
    var f = dischargeFieldVals(), p = _raw.patient || {}, name = p.name || (ctxLabel() + " patient");
    var esc2 = function (x) { return esc(x == null ? "" : x); };
    var block = function (title, val) { return (val && String(val).trim()) ? '<h2>' + esc2(title) + '</h2><div class="b">' + esc2(String(val).trim()).replace(/\n/g, "<br>") + '</div>' : ""; };
    var html = '<!doctype html><meta charset="utf-8"><title>Discharge summary — ' + esc2(name) + '</title>' +
      '<style>body{font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#111;padding:26px;max-width:740px;margin:auto}h1{font-size:19px;margin:0 0 2px}h2{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:#0f766e;margin:16px 0 4px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}.id{font-size:13px;margin:2px 0 2px;font-weight:600}.m{color:#666;font-size:11px;margin-bottom:8px}.b{white-space:normal}.draft{display:inline-block;font-size:10px;font-weight:700;color:#92620a;background:#fef3c7;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}.dx{font-size:14px;font-weight:700;margin:14px 0 2px}</style>' +
      '<h1>StewardMD ' + esc2(ctxLabel()) + ' Discharge Summary<span class="draft">DRAFT</span></h1>' +
      '<div class="id">' + esc2(dischargeHeaderLine(p)) + '</div>' +
      ((f.admitDate || f.dischargeDate) ? '<div class="m">Admitted: ' + esc2(f.admitDate || "—") + ' &nbsp;&middot;&nbsp; Discharged: ' + esc2(f.dischargeDate || "—") + '</div>' : '') +
      '<div class="dx">Final diagnosis: ' + esc2(f.finalDx || "[ complete ]") + '</div>' +
      (f.secondaryDx && f.secondaryDx.trim() ? '<div class="b">Secondary: ' + esc2(f.secondaryDx.trim()).replace(/\n/g, "<br>") + '</div>' : '') +
      block("Reason for admission", f.complaints) + block("Hospital course", f.course) + block("Key investigations", f.investigations) +
      block("Procedures / interventions", f.procedures) + block("Condition at discharge", f.condition) + block("Discharge medications", f.meds) +
      block("Follow-up", f.followup) + block("Advice to patient / carer", f.advice) +
      (f.doctor && f.doctor.trim() ? '<h2>Discharging doctor</h2><div class="b">' + esc2(f.doctor.trim()) + '</div>' : '') +
      '<div class="m" style="margin-top:18px">Draft generated from recorded data — verify every value before use. Decision support only. StewardMD.</div>';
    var w = null; try { w = window.open("", "_blank"); } catch (e) {}
    if (w && w.document) { w.document.open(); w.document.write(html); w.document.close(); setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 350); }
    else if (window.toast) toast("Pop-up blocked — use Copy or Share to export (Print needs a browser)");
  }

  // Search & select diagnosis — reuses the clinical reasoning engine's KB disease search
  // (window.SMD_REASON.search). Selecting sets the patient's WORKING diagnosis (clinician-
  // editable, never auto-applied elsewhere). Deterministic; no MaiK/provider call.
  function openDxSearch() {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("search", "🔎") + ' Search &amp; select diagnosis</h3>' +
      '<p class="icu-doc-sub">Searches StewardMD’s clinical knowledge base. Selecting sets this patient’s working diagnosis — you can edit it any time.</p>' +
      '<input id="icuDxq" type="search" autocomplete="off" placeholder="Type a diagnosis — e.g. sepsis, DKA, pancreatitis…" style="width:100%;box-sizing:border-box;font:600 15px var(--font);padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink)">' +
      '<div id="icuDxResults" class="icu-dx-results"></div>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:10px">Close</button></div>';
    modalEl.classList.add("on");
    var inp = modalEl.querySelector("#icuDxq"), res = modalEl.querySelector("#icuDxResults");
    function run() {
      var q = (inp.value || "").trim();
      if (q.length < 2) { res.innerHTML = '<div class="icu-dx-hint">Type at least 2 letters to search…</div>'; return; }
      var hits = (window.SMD_REASON && SMD_REASON.search) ? SMD_REASON.search(q, 14) : [];
      res.innerHTML = hits.length ? hits.map(function (d) {
        return '<button class="icu-dx-hit" data-icu-act="pickdx:' + encodeURIComponent(d.name) + '"><span class="nm">' + esc(d.name) + "</span>" + (d.sys ? '<span class="sys">' + esc(d.sys) + "</span>" : "") + "</button>";
      }).join("") : '<div class="icu-dx-hint">No match — you can still type the diagnosis in Patient details.</div>';
    }
    if (inp) inp.addEventListener("input", run);
    setTimeout(function () { try { if (inp) inp.focus(); } catch (e) {} }, 60);
  }
  /* ===== Structured clinical finding picker (autocomplete) — maps clinician language →
   * canonical finding IDs via window.SMD_VOCAB. Chips are structured + clinician-confirmed and are
   * DOCUMENTATION ONLY — they are NOT fed to the reasoning engine / do not change any scoring. ===== */
  var FIND_STATES = ["present", "absent", "possible", "historical", "resolved"];  // ▾ cycles through these
  function findStateOf(c) { if (c.temporality === "historical") return "historical"; if (c.temporality === "resolved") return "resolved"; return c.polarity || "present"; }
  function applyFindState(c, st) {
    if (st === "absent") { c.polarity = "absent"; c.temporality = "current"; }
    else if (st === "possible") { c.polarity = "possible"; c.temporality = "current"; }
    else if (st === "historical") { c.polarity = "present"; c.temporality = "historical"; }
    else if (st === "resolved") { c.polarity = "present"; c.temporality = "resolved"; }
    else { c.polarity = "present"; c.temporality = "current"; }
  }
  function addFindingChip(c, source) {
    if (!c || !c.canonicalFindingId) return false;
    var pol = c.polarity || "present", temp = c.temporality || "current", list = STATE.findings || [];
    // Dedupe by canonical id, but the LATEST explicit action wins: update the existing chip's
    // polarity/temporality (so re-picking "no headache" after "headache" flips it, rather than
    // silently keeping the stale state — and compound sub-chips refresh instead of being dropped).
    for (var i = 0; i < list.length; i++) if (list[i].canonicalFindingId === c.canonicalFindingId) { list[i].polarity = pol; list[i].temporality = temp; list[i].at = nowTs(); return true; }
    STATE.findings.push({ canonicalFindingId: c.canonicalFindingId, displayLabel: c.displayLabel || c.canonicalFindingId, polarity: pol, temporality: temp, source: source || "manual_picker", clinicianConfirmed: true, inReasoning: !!c.inReasoning, at: nowTs() });
    return true;
  }
  // A negation/temporality cue typed into the autocomplete ("no fever", "h/o seizure", "possible …")
  // is stripped from the SEARCH query by SMD_VOCAB — re-read it here so the added chip carries the
  // clinician's intended polarity/temporality instead of defaulting to present/current.
  function queryFindingMod(q) {
    q = " " + String(q || "").toLowerCase() + " ";
    if (/\b(no|without|denies|denied|absent|nil|negative for|ruled out|rule out|r\/o)\b/.test(q)) return { polarity: "absent", temporality: "current" };
    if (/\b(possible|probable|suspected|query|likely)\b/.test(q) || q.indexOf("?") >= 0) return { polarity: "possible", temporality: "current" };
    if (/\b(resolved|resolving|settled)\b/.test(q)) return { polarity: "present", temporality: "resolved" };
    if (/\b(h\/o|history of|old|previous|prior|past|k\/c\/o|known case of)\b/.test(q)) return { polarity: "present", temporality: "historical" };
    return null;
  }
  function findChipLabel(c) {
    var pre = c.polarity === "absent" ? "No " : c.polarity === "possible" ? "? " : c.temporality === "historical" ? "H/o " : "";
    var suf = c.temporality === "resolved" ? " (resolved)" : "";
    return pre + c.displayLabel + suf;
  }
  function findChipsHTML(interactive) {
    var list = _raw.findings || []; if (!list.length) return interactive ? '<div class="icu-find-empty">No findings added yet.</div>' : "";
    return '<div class="icu-find-chips">' + list.map(function (c, i) {
      var cls = "icu-find-chip" + (c.polarity === "absent" ? " neg" : c.polarity === "possible" ? " poss" : "") + (c.inReasoning ? "" : " note");
      return '<span class="' + cls + '">' + esc(findChipLabel(c)) +
        (interactive ? '<button class="fc-mod" data-icu-act="findmod:' + i + '" title="Present / Absent / Possible / History of / Resolved">▾</button><button class="fc-x" data-icu-act="findrm:' + i + '" aria-label="Remove">×</button>' : "") + "</span>";
    }).join("") + "</div>";
  }
  // Build an SMD_NLP context from the vocab so the existing deterministic extractor (negation/typo/
  // temporal aware) can pull findings from free text, mapped to canonical/vocab ids.
  function vocabNlpCtx() {
    var valid = {}, labels = {}, syn = {};
    try { (window.SMD_VOCAB.all() || []).forEach(function (e) { var id = e.cid || ("note:" + e.id); valid[id] = true; labels[id] = e.label; syn[id] = (syn[id] || []).concat(e.syn || []); }); } catch (x) {}
    return { valid: valid, labels: labels, syn: syn };
  }
  function openFindingPicker() {
    ensureModal();
    var _extract = null;   // reviewable extracted suggestions (never auto-added)
    var _showAll = false, _lastList = null, VIS = 8;
    // Category grouping order for the dropdown (Red flags surface first; never hidden).
    var GORD = { "Red flags": 0, "Symptoms": 1, "Signs": 2, "Vitals": 3, "Laboratory": 4, "Labs": 4, "Imaging": 5, "History": 6 };
    // Row styled to match the Clinical Reasoning finding list: a circular "+" affordance + label,
    // with a small subtitle (system · red flag · reasoning status).
    function hitHTML(x) {
      var meta = (x.sys || "") + (x.red ? " · red flag" : "") + (x.inReasoning === false ? " · not yet in reasoning" : "");
      return '<button class="icu-find-hit" data-find="' + esc(x.id) + '"><span class="icu-fp">+</span><span class="icu-fl"><span class="nm">' + esc(x.label) + "</span>" + (meta ? '<span class="mt">' + esc(meta) + "</span>" : "") + "</span></button>";
    }
    // Grouped renderer: top-VIS (by score) are bucketed by category (ordered GORD), each group a
    // count-badged header + a bordered list of rows — same visual language as the reasoning tab.
    function groupHTML(list, header) {
      if (!list || !list.length) return "";
      var visible;
      if (_showAll) visible = list;
      else { visible = list.slice(0, VIS); list.slice(VIS).forEach(function (x) { if (x.red) visible.push(x); }); }   // a matched emergency finding is never hidden behind "Show more"
      var buckets = {};
      visible.forEach(function (x) { (buckets[x.group] = buckets[x.group] || []).push(x); });
      var order = Object.keys(buckets).sort(function (a, b) { return (GORD[a] == null ? 9 : GORD[a]) - (GORD[b] == null ? 9 : GORD[b]); });
      var html = header ? '<div class="icu-find-cath">' + esc(header) + "</div>" : "";
      order.forEach(function (g) { html += '<div class="icu-find-cath">' + esc(g) + ' <span class="icu-find-cnt">' + buckets[g].length + "</span></div><div class=\"icu-find-list\">" + buckets[g].map(hitHTML).join("") + "</div>"; });
      if (list.length > visible.length) html += '<button class="icu-find-more" data-find-more="1">Show ' + (list.length - visible.length) + " more…</button>";
      return html;
    }
    function render() {
      modalEl.innerHTML = '<div class="icu-sheet" id="icuFindSheet"><h3>' + ico("search", "🔎") + ' Add clinical findings</h3>' +
        '<p class="icu-doc-sub">Type a symptom, sign, or shorthand — tap a suggestion to add it as a chip. Free text below.</p>' +
        '<input id="icuFindQ" type="search" autocomplete="off" placeholder="e.g. head, vom, quad, AMS, b/l plantar…" style="width:100%;box-sizing:border-box;font:600 15px var(--font);padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink)">' +
        '<div id="icuFindRes" class="icu-find-res">' + groupHTML(_extract, "Extracted — tap to add (review first)") + "</div>" +
        findChipsHTML(true) +
        '<div style="font:800 11px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 6px">Free text</div>' +
        '<textarea id="icuFindFree" rows="2" placeholder="Add complaint, finding, or note…" style="width:100%;box-sizing:border-box;font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink)"></textarea>' +
        '<div class="icu-img-btns"><button class="icu-btn ghost" id="icuFindNote">' + ico("edit", "✎") + ' Add as note</button><button class="icu-btn ghost" id="icuFindExtract">' + ico("pulse", "✦") + ' Extract findings</button></div>' +
        '<button class="icu-btn" data-icu-act="closeform" style="margin-top:10px">Done</button></div>';
      modalEl.classList.add("on");
      bind();
    }
    function bind() {
      var inp = modalEl.querySelector("#icuFindQ"), res = modalEl.querySelector("#icuFindRes"), t;
      function run() {
        var q = (inp.value || "").trim();
        if (q.length < 1) { _lastList = null; res.innerHTML = groupHTML(_extract, _extract ? "Extracted — tap to add (review first)" : ""); return; }
        var r = (window.SMD_VOCAB && SMD_VOCAB.search) ? SMD_VOCAB.search(q, { workspace: "im", limit: 24 }) : null;
        _lastList = (r && r.results) || [];   // search() returns [] when the query strips to a cue word (e.g. "no")
        res.innerHTML = _lastList.length ? groupHTML(_lastList) : '<div class="icu-dx-hint">No match — add it below as free text.</div>';
      }
      if (inp) inp.addEventListener("input", function () { _showAll = false; clearTimeout(t); t = setTimeout(run, 120); });   // ~120ms debounce; local only
      if (res) res.addEventListener("click", function (e) {
        var more = e.target.closest && e.target.closest("[data-find-more]");
        if (more) { _showAll = true; res.innerHTML = groupHTML(_lastList || _extract, _lastList ? "" : (_extract ? "Extracted — tap to add (review first)" : "")); return; }
        var b = e.target.closest && e.target.closest("[data-find]"); if (!b) return;
        var id = b.getAttribute("data-find");
        var mod = _extract ? null : queryFindingMod(inp && inp.value);   // Extract path is already present-only + negation-filtered
        try { (SMD_VOCAB.toChips(id) || []).forEach(function (ch) { if (mod) { ch.polarity = mod.polarity; ch.temporality = mod.temporality; } addFindingChip(ch, _extract ? "extract" : "manual_picker"); }); } catch (x) {}
        if (_extract) _extract = _extract.filter(function (x) { return x.id !== id; });   // consume the reviewed suggestion
        render(); var i2 = modalEl.querySelector("#icuFindQ"); if (i2) { setTimeout(function () { try { i2.focus(); } catch (e) {} }, 10); }
      });
      // chip modifier ▾ / remove × (handled here so the modal re-renders in place)
      var chips = modalEl.querySelector(".icu-find-chips");
      if (chips) chips.addEventListener("click", function (e) {
        var m = e.target.closest && e.target.closest("[data-icu-act]"); if (!m) return;
        e.preventDefault(); e.stopPropagation();
        var act = m.getAttribute("data-icu-act"), ix = +act.split(":")[1], c = STATE.findings[ix]; if (!c) return;
        if (act.indexOf("findrm") === 0) STATE.findings.splice(ix, 1);
        else if (act.indexOf("findmod") === 0) applyFindState(c, FIND_STATES[(FIND_STATES.indexOf(findStateOf(c)) + 1) % FIND_STATES.length]);
        render();
      });
      var free = modalEl.querySelector("#icuFindFree"), note = modalEl.querySelector("#icuFindNote"), ext = modalEl.querySelector("#icuFindExtract");
      if (note) note.addEventListener("click", function () { var txt = (free.value || "").trim(); if (!txt) return; STATE.patient.complaints = (STATE.patient.complaints ? STATE.patient.complaints + "; " : "") + txt; free.value = ""; if (window.toast) toast("Added to complaints"); });
      if (ext) ext.addEventListener("click", function () {
        var txt = (free.value || "").trim(); if (!txt) { if (window.toast) toast("Type a note first, then Extract."); return; }
        var keys = [];
        try { if (window.SMD_NLP && SMD_NLP.extract) { var r = SMD_NLP.extract(txt, vocabNlpCtx()); keys = (r && r.present) || (r && r.findings ? r.findings.filter(function (f) { return f.polarity === "present"; }).map(function (f) { return f.canonicalFindingId; }) : []); } } catch (x) {}
        // map extracted keys → vocab entries (reviewable, NOT auto-added)
        var seen = {}, sugg = [];
        (window.SMD_VOCAB.all() || []).forEach(function (e) { var cid = e.cid || ("note:" + e.id); if (keys.indexOf(cid) >= 0 && !seen[cid]) { seen[cid] = 1; sugg.push({ id: e.id, label: e.label, group: e.group, sys: e.sys, red: !!e.red, inReasoning: !!(e.cid || (e.cids && e.cids.length)), syn: "" }); } });
        _extract = sugg.length ? sugg : null;
        if (!sugg.length && window.toast) toast("No structured findings recognised — add manually or keep as note.");
        render();
      });
      setTimeout(function () { try { if (inp) inp.focus(); } catch (e) {} }, 60);
    }
    render();
  }
  function pickDiagnosis(name) {
    if (!name) return;
    STATE.patient.diagnosis = name;
    if (icuDxFlowOn()) STATE.patient.workingDx = { name: name, clinicianConfirmed: true, source: "manual", at: nowTs(), contextHash: correlationHash(buildClinicalContext()) };
    _dxShow = false;
    closeForm();
    if (window.toast) toast("Working diagnosis set: " + name);
  }
  // Manual imaging note (idx null) or annotate/correct an existing record (idx set).
  function openImagingForm(id) {
    ensureModal();
    var idx = id != null ? imgIndexById(id) : -1;
    var editing = idx >= 0;
    var cur = editing ? _raw.imaging[idx] : {};
    var dateVal = "";
    if (editing && cur.reportDateTime) { try { var d = new Date(cur.reportDateTime); dateVal = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); } catch (e) {} }
    var F = [
      { k: "modality", l: "Modality (e.g. CECT, MRI, USG)", t: "text", v: cur.modality || "" },
      { k: "studyName", l: "Study / title", t: "text", wide: true, v: cur.studyName || "" },
      { k: "date", l: "Study date", t: "date", v: dateVal },
      { k: "bodyRegion", l: "Body region", t: "text", v: cur.bodyRegion || "" },
      { k: "indication", l: "Clinical indication", t: "text", wide: true, v: cur.indication || "" },
      { k: "findings", l: "Findings", t: "textarea", wide: true, v: cur.findingsRaw || "" },
      { k: "impression", l: "Impression", t: "textarea", wide: true, v: cur.impressionRaw || "" },
      { k: "comment", l: "Clinician note (optional)", t: "textarea", wide: true, v: cur.comment || "" }
    ];
    var fieldsHTML = F.map(function (f) {
      var inp = (f.t === "textarea")
        ? '<textarea data-imgk="' + f.k + '" rows="3" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(f.v) + "</textarea>"
        : '<input data-imgk="' + f.k + '" type="' + f.t + '" value="' + esc(f.v) + '">';
      return '<div class="icu-fld" style="' + (f.wide ? "grid-column:1/-1" : "") + '"><label>' + esc(f.l) + "</label>" + inp + "</div>";
    }).join("");
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("camera", "🩻") + " " + (editing ? "Correct / annotate imaging" : "Add imaging note") + "</h3>" +
      '<p class="icu-doc-sub">Manual entry. Any urgent-finding flag is a deterministic keyword prompt to review — never a diagnosis.</p>' +
      '<div class="icu-grid2">' + fieldsHTML + "</div>" +
      '<button class="icu-btn" id="icuImgSave">Save imaging note</button><button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
    var btn = modalEl.querySelector("#icuImgSave");
    if (btn) btn.addEventListener("click", function () {
      var o = {}; modalEl.querySelectorAll("[data-imgk]").forEach(function (el) { o[el.getAttribute("data-imgk")] = el.value; });
      if (!o.studyName && !o.modality && !o.findings && !o.impression) { closeForm(); return; }
      var payload = { modality: o.modality, studyName: o.studyName || o.modality || "Imaging note", bodyRegion: o.bodyRegion, indication: o.indication, findingsRaw: o.findings, impressionRaw: o.impression, comment: o.comment, reportDateTime: parseWardDate(o.date) || (editing ? cur.reportDateTime : null) };
      if (editing) {
        payload.reportRaw = cur.reportRaw; payload.reportId = cur.reportId; payload.radiologist = cur.radiologist;
        var merged = normalizeImagingRecord(payload, cur.source || "Manual");
        merged.id = cur.id; merged.wardPatientId = cur.wardPatientId; merged.reviewed = cur.reviewed; merged.inSummary = cur.inSummary; merged.hidden = cur.hidden; merged.parsed = false;
        // Re-resolve the index at save time (capImaging front-splice may have shifted it).
        var i2 = imgIndexById(cur.id);
        if (i2 >= 0) STATE.imaging[i2] = merged; else { STATE.imaging.push(merged); capImaging(); }
      } else { ingestImaging(payload); }
      closeForm();
      if (window.toast) toast(editing ? "Imaging note updated" : "Imaging note added");
    });
  }

  /* ===== AI Imaging Assist (Phase 2) — clinician chooses AI summary OR deterministic extract.
   * Critical-term flag is ALWAYS deterministic (Phase 1 imgCritical). Advisory only; never a
   * diagnosis; the deterministic reasoning engine stays the diagnostic authority. ============ */
  function imgRedact(s) { try { return window.SMD_redactPHI ? window.SMD_redactPHI(String(s == null ? "" : s)) : String(s == null ? "" : s); } catch (e) { return String(s == null ? "" : s); } }
  function ageBandOf(age) { if (age == null || age === "" || isNaN(+age)) return ""; var a = +age; if (a < 1) return "<1"; if (a < 18) return "1-17"; var lo = Math.floor(a / 10) * 10; return lo + "-" + (lo + 9); }
  // DE-IDENTIFIED packet for the AI path. Includes ONLY: modality/study/indication (redacted),
  // age BAND (never DOB), sex, working dx, relevant complaints + a compact lab subset, specialty,
  // care setting, and PHI-REDACTED report text. NEVER name/MRN/bed/phone/full payload/other patients.
  function buildImagingAiPacket(rec) {
    rec = rec || {};
    var p = _raw.patient || {}, L = (_raw.labs && _raw.labs.recent) || {};
    var labs = [];
    ["na", "k", "creat", "urea", "bili", "ast", "alt", "alp", "amylase", "lipase", "wbc", "hb", "plt", "inr", "crp", "lactate", "ca", "trig"].forEach(function (k) { if (L[k] != null && L[k] !== "") labs.push(k.toUpperCase() + " " + L[k]); });
    return {
      modality: imgRedact(rec.modality || ""),   // manual-entry modality is free text → redact like its siblings
      studyName: imgRedact(rec.studyName || ""),
      indication: imgRedact(rec.indication || ""),
      ageBand: ageBandOf(p.age),
      sex: p.sex ? String(p.sex) : "",
      specialty: "",
      careSetting: "ICU",
      workingDx: imgRedact(p.diagnosis || ""),
      symptoms: p.complaints ? [imgRedact(p.complaints)] : [],
      labs: labs,
      reportText: imgRedact(rec.reportRaw || rec.impressionRaw || rec.findingsRaw || "")
      // NB: no exact date leaves the device — a service timestamp is a HIPAA/DPDP identifier.
    };
  }
  // Deterministic "correlate with" suggestions from report keywords (offline; no LLM).
  var IMG_CORRELATE = [
    [/pancreat/i, ["Lipase/amylase trend", "Serum calcium", "Triglycerides", "LFT & bilirubin", "Severity score (e.g. BISAP)"]],
    [/\bcbd\b|biliary|cholang|choledoch/i, ["LFT (cholestatic pattern)", "Bilirubin", "Amylase/lipase", "USG/MRCP for stones"]],
    [/h[ae]?emorrhage|bleed|intracerebral|subdural|subarachnoid|infarct|stroke/i, ["Blood pressure", "Coagulation (INR/platelets)", "GCS / neuro obs", "Repeat CT if deteriorating"]],
    [/consolidation|pneumon|infiltrat|ground-?glass/i, ["WBC / CRP / procalcitonin", "Sputum & blood cultures", "Oxygenation (SpO₂ / ABG)"]],
    [/pneumothorax/i, ["Oxygenation (SpO₂)", "Chest drain review"]],
    [/effusion|ascites/i, ["Diagnostic tap (SAAG for ascites)", "Albumin", "Cell count & culture"]],
    [/hydronephros|obstruct|calculus|ureteric/i, ["Renal function (creatinine/urea)", "Urine output", "Urgent urology if infected/obstructed"]],
    [/embol/i, ["Oxygenation", "RV strain on echo", "Anticoagulation review"]]
  ];
  function imgCorrelateFor(rec) {
    var t = [rec.impressionRaw, rec.findingsRaw, rec.reportRaw, rec.studyName].join(" ");
    for (var i = 0; i < IMG_CORRELATE.length; i++) {
      var re = new RegExp(IMG_CORRELATE[i][0].source, "gi"), m, hit = false;
      while ((m = re.exec(t))) {
        if (!negClause(t, m.index)) { hit = true; break; }
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      if (hit) return IMG_CORRELATE[i][1];
    }
    return ["Correlate with the clinical findings and relevant laboratory trends"];
  }
  // Offline extract — impression + ALWAYS-deterministic critical flag + modality-based correlations.
  function imagingDeterministic(rec) {
    var imp = rec.impressionRaw || rec.findingsRaw || rec.reportRaw || "";
    return {
      summary: imp ? ("Imaging report — impression: " + imgClamp(imp, 220)) : "Insufficient report detail for reliable interpretation — review original radiology report.",
      positives: [], negatives: [], significance: [], differentials: [],
      correlateWith: imp ? imgCorrelateFor(rec) : [],
      redFlags: rec.critical || [], nextChecks: [], deterministic: true
    };
  }
  // Coerce whatever the model returned into an array of strings — a string/number field must
  // never throw and abort the render (that would suppress the always-deterministic critical banner).
  function assistSection(label, arr) { arr = Array.isArray(arr) ? arr : (arr != null && arr !== "" ? [String(arr)] : []); return arr.length ? '<div class="icu-img-sec"><span class="icu-img-k">' + esc(label) + '</span><ul class="icu-assist-ul">' + arr.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : ""; }
  function renderAssistResult(res, rec, mode) {
    if (!res || res.error) {
      var msg = (res && res.error === "ai-off") ? "AI summary is turned off (cloud text disabled in Settings). Use the deterministic extract instead."
        : (res && res.error === "quota") ? "AI usage limit reached for now — try again later, or use the deterministic extract."
        : "Couldn’t generate an AI summary right now. Use the deterministic extract instead.";
      return '<div class="icu-assist-msg">' + esc(msg) + "</div>";
    }
    var s = (mode === "ai") ? (res.summary || {}) : res;
    var crit = (rec.critical || []).length ? '<div class="icu-img-crit">' + ico("warn", "⚠️") + ' <b>Potential urgent imaging finding</b> — verify report and escalate per local protocol.<div class="icu-img-crit-t">' + rec.critical.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + '</div></div>' : "";
    var redFlags = (Array.isArray(s.redFlags) && s.redFlags.length) ? s.redFlags : (rec.critical || []);
    var bodyH = '<div class="icu-assist-summary">' + esc(s.summary || "") + "</div>" +
      assistSection("Key positive findings", s.positives) +
      assistSection("Important negatives", s.negatives) +
      assistSection("Possible significance", s.significance) +
      assistSection("Differential considerations", s.differentials) +
      assistSection("Correlate with", s.correlateWith) +
      assistSection("Urgent red flags", redFlags) +
      assistSection("Suggested next checks", s.nextChecks);
    var src = "Source: " + (mode === "ai" ? "AI summary" : "Deterministic extract") + " of " + (rec.modality || "imaging") + " — Ward Sync report" + (rec.reportDateTime ? " dated " + imgFmtDate(rec.reportDateTime) : "");
    return crit +
      '<div class="icu-assist-draft">' + (mode === "ai" ? "Draft — clinician review required. Advisory only; not a diagnosis." : "Deterministic extract. Advisory only; not a diagnosis.") + "</div>" +
      bodyH + '<div class="icu-assist-src">' + esc(src) + "</div>" +
      '<button class="icu-btn" data-icu-act="imgsummaryadd:' + encodeURIComponent(rec.id) + '" style="margin-top:10px">Add to Daily Summary</button>';
  }
  function openImagingAssist(id) {
    var rec = imgById(id); if (!rec) return;
    ensureModal();
    var seq = 0;   // monotonic choice token: a later choice supersedes an in-flight AI apply
    function shell(resultHTML, busy) {
      modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("pulse", "🩻") + ' AI Assist — ' + esc(rec.studyName || "imaging") + '</h3>' +
        '<p class="icu-doc-sub">Choose how to summarize this report. Advisory only — the deterministic engine remains the diagnostic authority; nothing here is a diagnosis. The urgent-finding flag is always deterministic.</p>' +
        '<div class="icu-img-btns"><button class="icu-btn" id="icuAsAI"' + (busy ? " disabled" : "") + '>' + ico("pulse", "✨") + ' AI summary</button>' +
        '<button class="icu-btn ghost" id="icuAsDet">' + ico("check", "▤") + ' Deterministic extract</button></div>' +
        '<div id="icuAsOut" class="icu-assist-out">' + (busy ? '<div class="icu-assist-msg">Generating…</div>' : (resultHTML || '<div class="icu-assist-msg" style="color:var(--muted)">Pick a mode above.</div>')) + '</div>' +
        '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:10px">Close</button></div>';
      modalEl.classList.add("on");
      var ai = modalEl.querySelector("#icuAsAI"), det = modalEl.querySelector("#icuAsDet");
      if (det) det.addEventListener("click", runDet);
      if (ai && !busy) ai.addEventListener("click", runAI);   // disabled while an AI call is in flight (no double charge)
    }
    function runDet() {
      ++seq;   // supersede any in-flight AI apply — the clinician just chose deterministic
      var res = imagingDeterministic(rec);
      try { rec.assist = { mode: "deterministic", summary: res.summary, at: nowTs() }; } catch (e) {}
      shell(renderAssistResult(res, rec, "deterministic"));
    }
    function runAI() {
      var mine = ++seq;
      shell(null, true);
      var out = modalEl.querySelector("#icuAsOut");
      function live() { return mine === seq && out && out.isConnected && modalEl.classList.contains("on"); }
      var pkt = buildImagingAiPacket(rec);
      (window.SMD_AI && SMD_AI.imagingSummary ? SMD_AI.imagingSummary(pkt) : Promise.resolve({ error: "ai-off" })).then(function (res) {
        if (!live()) return;   // superseded by a newer choice, or the modal was closed/replaced
        if (res && res.summary && !res.error) { try { rec.assist = { mode: "ai", summary: (res.summary.summary || ""), data: res.summary, at: nowTs() }; } catch (e) {} }
        shell(renderAssistResult(res, rec, "ai"));
      }).catch(function () { if (live()) shell(renderAssistResult({ error: "server" }, rec, "ai")); });
    }
    shell("");
  }

  /* ===== CLINICAL CORRELATION ASSISTANT (Phase 3) — advisory only =========
   * Staged pipeline: local deterministic extraction (imaging concepts + lab abnormalities +
   * clinician findings) → compact de-identified packet → map the subset that have EXISTING
   * engine finding-keys and run SMD_REASON.assess() READ-ONLY for a deterministic KB signal →
   * optional Deep AI synthesis (opt-in, evidence-hash cached). It NEVER sets a diagnosis, never
   * adds findings to the live engine, and never alters ranking. No new finding-keys are added
   * (that would churn the golden engine). External-evidence fallback is deferred to Phase 4. */
  var _corrAnalysed = false, _corrBusy = false, _corrCache = {}, _corrErr = null;   // in-memory Deep cache (not persisted → no onChange loop)
  // Negation scoped to the CURRENT clause/sentence (from the last terminator up to the match) —
  // not a fixed byte window — so a leading negation governs a whole enumeration ("No A, B or C").
  function negClause(text, idx) { return IMG_NEG.test(text.slice(0, idx).split(/[.;:\n]/).pop()); }
  // Imaging report keyword → human concept label (negation-guarded, like imgCritical).
  var IMG_CONCEPTS = [
    [/peripancreatic|fat stranding/i, "peripancreatic inflammatory change"],
    [/pancreat/i, "pancreatic inflammation"],
    [/\bcbd\b|common bile duct|choledoch|biliary (?:duct|dilat)/i, "biliary duct involvement"],
    [/cholangit/i, "cholangitis features"],
    [/consolidation|air ?space opacit/i, "pulmonary consolidation"],
    [/ground.?glass/i, "ground-glass opacity"],
    [/pleural effusion/i, "pleural effusion"],
    [/ascites|free fluid|free intraperitoneal fluid/i, "ascites"],
    [/hydronephros|obstruct\w* (?:kidney|ureter|collecting|renal)/i, "urinary tract obstruction"],
    [/h[ae]?emorrhage|\bbleed\b|h[ae]?ematoma/i, "haemorrhage"],
    [/midline shift|mass effect/i, "mass effect"],
    [/infarct/i, "infarct"],
    [/hepatomegaly|splenomegaly|hepatospleno/i, "organomegaly"],
    [/lymphadenopathy|enlarged lymph node/i, "lymphadenopathy"],
    [/abscess|infected collection/i, "collection / abscess"]
  ];
  // Concepts that map to an EXISTING engine finding-key (others stay context-only, never scored).
  var CONCEPT_KEY = { "pulmonary consolidation": "consolidation", "ascites": "ascites", "lymphadenopathy": "lymphadenopathy", "organomegaly": "hepatosplenomegaly" };
  function nonNeg(t, re0) {
    var re = new RegExp(re0.source, "gi"), m;
    while ((m = re.exec(t))) { if (!negClause(t, m.index)) return true; if (m.index === re.lastIndex) re.lastIndex++; }
    return false;
  }
  function extractImagingConcepts() {
    var out = [], seen = {}, imgs = (_raw.imaging || []).filter(function (r) { return !r.hidden; });
    imgs.forEach(function (r) {
      var t = [r.impressionRaw, r.findingsRaw, r.reportRaw].join(" ");
      IMG_CONCEPTS.forEach(function (c) { if (nonNeg(t, c[0]) && !seen[c[1]]) { seen[c[1]] = 1; out.push(c[1]); } });
    });
    return out;
  }
  function imagingCriticalFlags() {
    var out = [], seen = {};
    (_raw.imaging || []).filter(function (r) { return !r.hidden; }).forEach(function (r) { (r.critical || []).forEach(function (c) { if (!seen[c]) { seen[c] = 1; out.push(c); } }); });
    return out;
  }
  // Direction of a lab over the recorded series (earliest vs latest, >25% move).
  function labDir(key) {
    var pts = (_raw.labs.trends || []).filter(function (s) { return s[key] != null && s[key] !== ""; });
    if (pts.length < 2) return null;
    var a = +pts[0][key], b = +pts[pts.length - 1][key]; if (isNaN(a) || isNaN(b) || a === 0) return null;
    var d = (b - a) / Math.abs(a);
    return d > 0.25 ? "rising" : d < -0.25 ? "falling" : null;
  }
  function extractLabConcepts() {
    var L = _raw.labs.recent || {}, out = [], seen = {}, add = function (s) { if (s && !seen[s]) { seen[s] = 1; out.push(s); } };
    try { if (window.ELYTE && ELYTE.analyze) { var p = _raw.patient || {}; ELYTE.analyze(L, { weight: p.weightKg, age: p.age, sex: (String(p.sex).toLowerCase() === "f" ? "f" : "m") }, "si").filter(function (r) { return r.level && r.level !== "ok"; }).forEach(function (r) { add(r.name + (r.severity ? " (" + r.severity + ")" : "")); }); } } catch (e) {}
    if (L.plt != null && L.plt < 150) add("thrombocytopenia");
    if (L.wbc != null && L.wbc > 11) add("leukocytosis"); else if (L.wbc != null && L.wbc < 4) add("leukopenia");
    if (L.hb != null && L.hb < 10) add("anaemia");
    if (L.bili != null && L.bili > 2) add("hyperbilirubinaemia");
    if (L.alp != null && L.alp > 150 && (L.alt == null || L.alt < 120)) add("cholestatic LFT pattern");
    if ((L.ast != null && L.ast > 120) || (L.alt != null && L.alt > 120)) add("hepatocellular injury");
    if (L.lipase != null && L.lipase > 180) add("pancreatic enzyme elevation");
    if (L.amylase != null && L.amylase > 300) add("pancreatic enzyme elevation");
    if (L.crp != null && L.crp > 50) add("raised inflammatory markers");
    // trend directions for high-yield analytes
    ["creat", "bili", "lipase", "crp", "lactate"].forEach(function (k) { var d = labDir(k); if (d === "rising") add({ creat: "rising creatinine", bili: "rising bilirubin", lipase: "falling/rising lipase — trend only", crp: "rising CRP", lactate: "rising lactate" }[k]); });
    if (labDir("plt") === "falling") add("falling platelets");
    return out;
  }
  // Compact latest-vitals concept strings (numbers only — no identifiers). Feeds the unified context.
  function latestVitalsSummary() {
    var v = latestByTs(_raw.vitals || []), out = [];
    if (!v || !Object.keys(v).length) return out;
    if (v.sbp != null && v.dbp != null) { var mp = mapCalc(v.sbp, v.dbp); out.push("BP " + v.sbp + "/" + v.dbp + (mp != null ? " (MAP " + mp + ")" : "")); }
    if (v.hr != null) out.push("HR " + v.hr);
    if (v.rr != null) out.push("RR " + v.rr);
    if (v.spo2 != null) out.push("SpO₂ " + v.spo2 + "%");
    if (v.temp != null) out.push("Temp " + v.temp + "°C");
    if (v.lactate != null) out.push("Lactate " + v.lactate);
    return out;
  }
  // Unified, de-identified clinical context — the SINGLE reusable service (A6) feeding both the
  // deterministic pass and the Deep Review packet. When smd_icu_dxflow is ON, it folds in the
  // structured finding chips (negation preserved) + latest vitals so Deep Review reasons over the
  // FULL picture, not just imaging + labs. When OFF, findings/vitals are omitted (old behavior).
  function correlationEvidence() {
    var p = _raw.patient || {}, img = extractImagingConcepts(), crit = imagingCriticalFlags(), labs = extractLabConcepts(), clinical = [];
    if (p.complaints) clinical.push(String(p.complaints));
    if (p.diagnosis) clinical.push("working diagnosis: " + p.diagnosis);
    var findings = [], vitals = [];
    if (icuDxFlowOn()) {
      (_raw.findings || []).forEach(function (c) { findings.push({ id: c.canonicalFindingId, label: c.displayLabel, polarity: c.polarity, temporality: c.temporality, inReasoning: !!c.inReasoning }); });
      vitals = latestVitalsSummary();
    }
    return { img: img, crit: crit, labs: labs, findings: findings, vitals: vitals, clinical: clinical,
      counts: { imaging: (_raw.imaging || []).filter(function (r) { return !r.hidden; }).length, labs: labs.length, findings: findings.length, vitals: vitals.length } };
  }
  function buildClinicalContext() { return correlationEvidence(); }   // A6: canonical name for the unified context service

  /* ===== Guided working-diagnosis pass (smd_icu_dxflow) — DETERMINISTIC, read-only ============
   * Feeds the clinician's structured finding chips (present/possible; negation excluded) + the
   * labs the engine can score into SMD_REASON.assess() (PURE) for a working-diagnosis differential.
   * Advisory only — never sets a diagnosis unless the clinician taps Select; never alters ranking. */
  var _dxShow = false, _dxWhy = {}, _dxPt = null, _dxAdvanced = false;
  function dxFindingKeys() {
    var f = {};
    (_raw.findings || []).forEach(function (c) {
      if (!c || !c.canonicalFindingId || c.canonicalFindingId.indexOf("note:") === 0) return;   // note:* aren't engine keys
      if (c.polarity === "absent") return;                                                      // respect negation
      f[c.canonicalFindingId] = true;                                                            // present / possible
    });
    return f;
  }
  function dxLabel(k) { try { return (window.SMD_REASON && SMD_REASON.label) ? SMD_REASON.label(k) : k; } catch (e) { return k; } }
  function runWorkingDx() {
    var ctx = buildClinicalContext(), f = dxFindingKeys();
    correlationMappedKeys(ctx).forEach(function (k) { f[k] = true; });   // + labs the engine can score (imaging mostly has no key → Deep Review only)
    var keys = Object.keys(f), assess = null;
    try { if (window.SMD_REASON && SMD_REASON.assess && keys.length) assess = SMD_REASON.assess(f); } catch (e) {}
    var cards = (assess ? (assess.infectious || []).concat(assess.nonInfectious || []) : []).slice()
      .sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); })
      .map(function (c) {
        var conf = c.confidence || 0;   // infective soft-suggestions are engine-capped at 56, so they can't reach Strong
        var lvl = conf >= 65 ? "Strong" : conf >= 40 ? "Moderate" : conf >= 25 ? "Possible" : "Weak";
        return { c: c, lvl: lvl };
      }).filter(function (x) { return x.lvl !== "Weak"; }).slice(0, 5);
    var sufficient = keys.length >= 1 && cards.length && (cards[0].c.confidence || 0) >= 25;
    return { ctx: ctx, keys: keys, cards: cards, sufficient: sufficient, suggestions: (assess && assess.suggestions) || [] };
  }
  function dxDifferentialHTML() {
    var r = runWorkingDx();
    if (!r.keys.length) return '<div class="icu-corr-note">' + ico("info", "ⓘ") + ' Add symptoms/signs the engine can reason on (or run Deep clinical review) to generate a working differential.</div>';
    if (!r.sufficient) return '<div class="icu-corr-note">' + ico("info", "ⓘ") + ' Insufficient context for a confident differential — add focused findings' + (r.suggestions.length ? " (e.g. " + r.suggestions.slice(0, 3).map(function (k) { return esc(dxLabel(k)); }).join(", ") + ")" : "") + ', or run Deep clinical review.</div>';
    var cards = r.cards.map(function (x) {
      var c = x.c, open = !!_dxWhy[c.id], red = (c.redFlags && c.redFlags.length) ? ' <span class="icu-dx-red">⚠ red flag</span>' : "", supN = (c.supporting || []).length;
      // Expanded detail — shown only when the card is tapped open (collapsed by default: BUG B).
      var why = open ? '<div class="icu-dx-why">' +
        (c.reason ? '<div class="icu-corr-note" style="margin:6px 0">' + esc(c.reason) + "</div>" : "") +
        ((c.supporting || []).length ? '<div class="icu-corr-sub">Supporting</div>' + corrChips(c.supporting, "ok") : "") +
        ((c.contradictory || []).length ? '<div class="icu-corr-sub">Against</div>' + corrChips(c.contradictory, "muted") : "") +
        ((c.missing || []).length ? '<div class="icu-corr-sub">Missing / to check</div>' + corrChips(c.missing, "muted") : "") +
        ((c.investigations || []).length ? '<div class="icu-corr-sub">Suggested investigations</div>' + corrChips(c.investigations, "muted") : "") + "</div>" : "";
      return '<div class="icu-dx-card">' +
        '<button class="icu-dx-h" data-icu-act="dxwhy:' + esc(c.id) + '" aria-expanded="' + (open ? "true" : "false") + '" aria-label="' + (open ? "Hide" : "View") + " reasoning for " + esc(c.name) + '"><span class="icu-dx-nm">' + esc(c.name) + red + '</span><span class="icu-dx-lvl ' + x.lvl.toLowerCase() + '">' + x.lvl + '</span><span class="icu-dx-chev">' + (open ? "▾" : "▸") + "</span></button>" +
        (!open && c.reason ? '<div class="icu-dx-rsn icu-clamp1">' + esc(c.reason) + "</div>" : "") +
        (!open && supN ? '<div class="icu-dx-sup">' + supN + " supporting</div>" : "") +
        why +
        '<div class="icu-dx-acts"><button class="icu-btn" data-icu-act="dxpick:' + encodeURIComponent(c.name) + '" aria-label="Select ' + esc(c.name) + ' as working diagnosis">Select as working diagnosis</button></div></div>';
    }).join("");
    return cards + '<div class="icu-img-btns" style="margin-top:8px"><button class="icu-btn ghost" data-icu-act="dxmanual">' + ico("search", "🔎") + ' Add my own</button><button class="icu-btn ghost" data-icu-act="dxskip">Continue without</button></div>' +
      '<p class="icu-doc-sub" style="margin-top:8px">Deterministic pattern support — not a probability or a confirmed diagnosis. You decide.</p>';
  }
  function pickWorkingDx(name, source) {
    if (!name) return;
    STATE.patient.diagnosis = name;
    STATE.patient.workingDx = { name: name, clinicianConfirmed: true, source: source || "manual", at: nowTs(), contextHash: correlationHash(buildClinicalContext()) };
    _dxShow = false;
    if (window.toast) toast("Working diagnosis set — " + name);
  }
  // ---- Working-dx → management brief + StewardMD protocol (advisory; verify) --------------------
  // Resolve a working-dx NAME to its curated DX_MGMT brief. Direct name/synonym match first, then
  // fall back to the KB search (name → id) — reuses the same DX_MGMT registry the reasoning engine uses.
  function dxMgmtFor(name) {
    if (!name || !window.DX_MGMT) return null;
    var M = window.DX_MGMT, n = String(name).toLowerCase().trim(), id, m, i, syn;
    for (id in M) {
      if (!Object.prototype.hasOwnProperty.call(M, id)) continue;
      m = M[id]; if (!m) continue;
      if ((m.name || "").toLowerCase() === n) return { id: id, m: m };
      syn = m.syn || []; for (i = 0; i < syn.length; i++) if (String(syn[i]).toLowerCase() === n) return { id: id, m: m };
    }
    try {
      var hits = (window.SMD_REASON && SMD_REASON.search) ? SMD_REASON.search(name, 6) : [];
      for (i = 0; i < hits.length; i++) if (hits[i] && M[hits[i].id] && (hits[i].name || "").toLowerCase() === n) return { id: hits[i].id, m: M[hits[i].id] };
      for (i = 0; i < hits.length; i++) if (hits[i] && M[hits[i].id]) return { id: hits[i].id, m: M[hits[i].id] };
    } catch (e) {}
    return null;
  }
  // Map a working-dx name → an applicable Critical Care Protocol (index into PROTOCOLS). Word-boundary
  // matched; sepsis is tested before generic "shock" so septic shock resolves to the sepsis protocol.
  var PROTO_RE = [
    /sepsis|septic/,
    /undifferentiated shock|\bshock\b/,
    /\bdka\b|\bhhs\b|ketoacidosis|hyperosmolar|diabetic keto/,
    /gi bleed|gastrointestinal (?:h?a?emorrhage|bleed)|variceal|h[ae]matemesis|mel[ae]na|upper gi bleed/,
    /coronary|\bacs\b|stemi|nstemi|myocardial infarct|unstable angina/,
    /\bstroke\b|\bcva\b|cerebrovascular|cerebral infarct|isch[ae]mic stroke/,
    /\bards\b|acute respiratory distress/,
    /hyperkal/,
    /status epilepticus|epilepticus/,
    /pulmonary embol|\bpe\b/,
    /anaphylax/
  ];
  function protocolIndexFor(name) {
    if (!name) return -1;
    var n = String(name).toLowerCase();
    for (var i = 0; i < PROTO_RE.length; i++) { try { if (PROTO_RE[i].test(n)) return i; } catch (e) {} }
    return -1;
  }
  // Advisory management brief + applicable StewardMD protocol for the selected working dx. Reuses the
  // DX_MGMT registry (dxmgmt.js) + the existing protocolCard renderer / proto: toggle + protocols tab.
  function dxManagementHTML(name) {
    var out = "", mg = dxMgmtFor(name);
    if (mg && mg.m) {
      var m = mg.m;
      out += '<div class="icu-corr-note" style="margin-top:10px"><div class="icu-corr-sub">Treatment considerations (advisory)</div>';
      if (m.dx) out += '<p class="icu-doc-sub" style="margin:4px 0"><b>Confirm:</b> ' + esc(m.dx) + '</p>';
      if (m.tx && m.tx.length) out += '<div class="icu-corr-sub" style="margin-top:6px">First-line management</div>' + m.tx.map(function (s) { return '<div class="icu-row"><span>• ' + esc(s) + '</span></div>'; }).join("");
      if (m.ix && m.ix.length) out += '<div class="icu-corr-sub" style="margin-top:6px">Key investigations</div>' + m.ix.map(function (s) { return '<div class="icu-row"><span>• ' + esc(s) + '</span></div>'; }).join("");
      if (m.dispo) out += '<p class="icu-doc-sub" style="margin:6px 0 0"><b>Disposition:</b> ' + esc(m.dispo) + '</p>';
      if (m.src) out += '<p class="icu-doc-sub" style="margin:4px 0 0;color:var(--muted)">Source: ' + esc(m.src) + '</p>';
      out += '</div>';
    }
    var pi = protocolIndexFor(name);
    if (pi >= 0) {
      out += '<div style="margin-top:10px"><div class="icu-sec-lbl">' + ico("siren", "🚨") + ' Applicable protocol</div>' + protocolCard(PROTOCOLS[pi], pi) +
        '<button class="icu-btn ghost" data-icu-act="tab:protocols" style="margin-top:4px">' + ico("siren", "🚨") + ' Open all Critical Care Protocols</button></div>';
    }
    return out;
  }
  function correlationMappedKeys(ev) {
    var keys = {};
    ev.img.forEach(function (c) { if (CONCEPT_KEY[c]) keys[CONCEPT_KEY[c]] = true; });
    ev.labs.forEach(function (l) { var lc = l.toLowerCase(); if (/thrombocyto|falling platelet/.test(lc)) keys.thrombocytopenia = true; if (/lactate/.test(lc)) keys.lactateElevated = true; if (/creatinin|renal|\baki\b/.test(lc)) keys.renalImpairment = true; });
    return Object.keys(keys);
  }
  function runQuickCorrelation() {
    var ev = correlationEvidence(), keys = correlationMappedKeys(ev), assess = null;
    try { if (window.SMD_REASON && SMD_REASON.assess && keys.length) { var f = {}; keys.forEach(function (k) { f[k] = true; }); assess = SMD_REASON.assess(f); } } catch (e) {}
    var cands = assess ? (assess.infectious || []).concat(assess.nonInfectious || []).slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); }).slice(0, 3) : [];
    var top = cands[0], evItems = ev.img.length + ev.labs.length + ev.clinical.length, status;
    if (!keys.length || !top) status = evItems < 2 ? "Insufficient data" : "No adequate internal match";
    else if (cands.length >= 2 && Math.abs((cands[0].confidence || 0) - (cands[1].confidence || 0)) < 8 && (cands[0].contradictory || []).length) status = "Conflicting evidence";
    else if ((top.confidence || 0) >= 70 && (top.supporting || []).length >= 2) status = "Strong internal match";
    else if ((top.confidence || 0) >= 45) status = "Partial internal match";
    else status = "Broad syndrome match only";
    // Findings the deterministic engine did NOT see (no matching key) — across BOTH imaging and
    // labs. The ranked list is trustworthy only when nothing dominant was left out.
    var mappedLabRe = /thrombocyto|falling platelet|lactate|creatinin|renal|\baki\b/i;
    var unmapped = ev.img.filter(function (c) { return !CONCEPT_KEY[c]; }).concat(ev.labs.filter(function (l) { return !mappedLabRe.test(l); }));
    return { ev: ev, keys: keys, candidates: cands, status: status, unmapped: unmapped };
  }
  // Evidence hash for the Deep-review cache (patient-scoped; de-identified content only).
  function correlationHash(ev) { return imgHash(JSON.stringify([ev.img, ev.crit, ev.labs, ev.clinical, ev.findings || [], ev.vitals || []])); }
  function buildCorrelationPacket(ev) {
    var p = _raw.patient || {};
    var pkt = {
      patientContext: { ageBand: ageBandOf(p.age), sex: p.sex ? String(p.sex) : "", specialty: "", careSetting: "ICU" },
      imaging: { concepts: ev.img, criticalFlags: ev.crit },
      labs: { abnormalities: ev.labs },
      clinical: { approvedFindings: (ev.clinical || []).map(imgRedact) }
    };
    // Structured findings (with polarity/temporality so the AI sees negation) + vitals — controlled
    // vocabulary + numbers, re-run through redactPHI as a backstop. Present only when non-empty.
    if ((ev.findings || []).length) pkt.findings = ev.findings.map(function (f) { return { finding: imgRedact(f.label), polarity: f.polarity || "present", temporality: f.temporality || "current" }; });
    if ((ev.vitals || []).length) pkt.vitals = ev.vitals.map(imgRedact);
    return pkt;
  }
  function runCorrelationDeep() {
    var ev = correlationEvidence(); if (!(ev.img.length || ev.labs.length || (ev.findings || []).length || (ev.vitals || []).length)) { if (window.toast) toast("Add findings, imaging, or labs first."); return; }
    var key = (_raw.patient._id || "cur") + ":" + correlationHash(ev);
    if (_corrCache[key]) { paint(); return; }   // cache hit (SUCCESS only) — reuse, no AI call (token control)
    _corrErr = null; _corrBusy = true; paint();
    var pkt = buildCorrelationPacket(ev);
    // Safe developer diagnostics only — NO PHI (counts + status/error category, never patient data).
    try { console.log("[ICU deep-review] started · context", { findings: (ev.findings || []).length, labs: ev.labs.length, imaging: ev.img.length, vitals: (ev.vitals || []).length, workingDx: !!_raw.patient.diagnosis }); } catch (e) {}
    // Robust lifecycle: a JS-level deadline with a single-settle guard so the spinner can NEVER
    // outlive the timeout — even if the native transport stalls and the promise never settles.
    var settled = false;
    var TO_MS = (typeof window !== "undefined" && +window.SMD_ICU_DEEP_TIMEOUT_MS) || 40000;   // test seam; prod default 40s
    var to = setTimeout(function () {
      if (settled) return; settled = true;
      try { console.warn("[ICU deep-review] timeout — surfacing retry"); } catch (e) {}
      _corrErr = { error: "timeout" }; _corrBusy = false; paint();
    }, TO_MS);   // > native 30s so a real backend error surfaces first; backstops the never-settles case
    var done = function (fn) { return function (x) { if (settled) return; settled = true; clearTimeout(to); fn(x); }; };
    (window.SMD_AI && SMD_AI.correlate ? SMD_AI.correlate(pkt) : Promise.resolve({ error: "ai-off" }))
      .then(done(function (res) {
        // Cache ONLY a successful correlation — transient errors (quota/server/parse) stay retryable.
        if (res && res.correlation && !res.error) _corrCache[key] = res; else _corrErr = res || { error: "server" };
        try { console.log("[ICU deep-review] response · " + (res && res.error ? "error:" + res.error : res && res.correlation ? "ok" : "empty")); } catch (e) {}
        _corrBusy = false; paint();
      }))
      .catch(done(function (e) { try { console.warn("[ICU deep-review] rejected:" + String(e && e.message || e)); } catch (x) {} _corrErr = { error: "server" }; _corrBusy = false; paint(); }));
  }
  // Explicit opt-in confirm before ANY AI call (A5): shows exactly what de-identified context will be
  // sent, lets the clinician edit it first, and blocks the call entirely when there's nothing usable.
  function deepReviewItems() {
    var ev = buildClinicalContext();
    return [
      { ok: (ev.findings || []).length, label: "Structured findings", n: (ev.findings || []).length },
      { ok: (ev.clinical || []).length, label: "Narrative / complaints", n: (ev.clinical || []).length },
      { ok: ev.labs.length, label: "Labs & trends", n: ev.labs.length },
      { ok: ev.img.length, label: "Imaging findings", n: ev.img.length },
      { ok: (ev.vitals || []).length, label: "Vitals", n: (ev.vitals || []).length },
      { ok: _raw.patient.diagnosis ? 1 : 0, label: "Working diagnosis", n: _raw.patient.diagnosis ? 1 : 0 }
    ];
  }
  function deepReviewUsable() { var ev = buildClinicalContext(); return !!(ev.img.length || ev.labs.length || (ev.findings || []).length || (ev.vitals || []).length); }
  function openDeepReviewConfirm() {
    ensureModal();
    var items = deepReviewItems(), usable = deepReviewUsable();
    var list = items.map(function (it) { return '<div class="icu-deep-chk ' + (it.ok ? "on" : "off") + '">' + (it.ok ? "✓ " : "○ ") + esc(it.label) + (it.ok && it.n > 1 ? " (" + it.n + ")" : "") + (it.ok ? "" : " — not available") + "</div>"; }).join("");
    modalEl.innerHTML = '<div class="icu-sheet" id="icuDeepSheet" role="dialog" aria-label="Deep Clinical Review — confirm context"><h3>' + ico("pulse", "✨") + " Deep Clinical Review</h3>" +
      '<p class="icu-doc-sub">' + (usable ? "This sends a <b>de-identified</b> summary of the context below — no name, MRN, or bed. Advisory only; verify against local protocol and your judgement." : "No usable clinical context yet — add at least one finding, lab, imaging report or vital first.") + "</p>" +
      '<div class="icu-deep-list">' + list + "</div>" +
      (usable
        ? '<button class="icu-btn" data-icu-act="deepgo">' + ico("pulse", "✨") + " Review with current context</button>" +
          '<button class="icu-btn ghost" data-icu-act="deepedit" style="margin-top:8px">Edit context first</button>' +
          '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button>'
        : '<button class="icu-btn" data-icu-act="deepedit">' + ico("plus", "＋") + " Add findings</button>" +
          '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button>') +
      "</div>";
    modalEl.classList.add("on");
    setTimeout(function () { try { var b = modalEl.querySelector('[data-icu-act="deepgo"],[data-icu-act="deepedit"]'); if (b) b.focus(); } catch (e) {} }, 40);
  }

  /* ===== First-use guided-diagnosis tour (smd_icu_dxflow) — lightweight spotlight ==============
   * A 4-step coach-mark (built on the tip-pop primitive) that explains the findings → working-dx →
   * Deep-Review flow. Per-ACCOUNT state (keyed by ownerNow()); never re-triggers the disclaimer;
   * shows only on the first eligible Diagnosis entry (or one more time after a plain Skip). */
  var TOUR_VERSION = 1;
  var TOUR_STEPS = [
    { sel: '[data-icu-act="findpick"]', title: "Structured findings", text: "Add symptoms, signs and examination findings in a structured form." },
    { sel: '[data-icu-act="finddx"]', title: "Find working diagnosis", text: "StewardMD combines your findings with available labs, imaging, vitals and trends to suggest working diagnoses." },
    { sel: ".icu-dx-card", title: "You stay in control", text: "Select a suggested diagnosis, add your own, or continue without one — nothing is auto-applied." },
    { sel: '[data-icu-act="corrdeep"]', title: "Deep Clinical Review", text: "As soon as you have clinical context (findings, labs, imaging or vitals), Deep review uses the context you confirm for advisory correlation, missing data and guideline-supported considerations — and helps identify the working diagnosis. External evidence appears after this." }
  ];
  var _tourEl = null, _tourStep = 0, _tourSessionDone = false;
  function tourKey() { try { return "smd_icu_dxtour:" + ownerNow(); } catch (e) { return "smd_icu_dxtour:anon"; } }
  function tourState() { try { return JSON.parse(localStorage.getItem(tourKey())) || {}; } catch (e) { return {}; } }
  function saveTourState(s) { try { localStorage.setItem(tourKey(), JSON.stringify(s)); } catch (e) {} }
  function tourShouldShow() {
    if (!icuDxFlowOn()) return false;
    var s = tourState();
    if (s.dontShowAgain) return false;                 // explicit opt-out — never again
    if (s.completedVersion === TOUR_VERSION) return false;   // completed this version
    if ((s.skippedCount || 0) >= 2) return false;      // skipped → at most one extra showing
    return true;
  }
  function clearTourHL() { var e; while ((e = document.querySelector(".icu-tour-hl"))) e.classList.remove("icu-tour-hl"); }
  function ensureTourEl() { if (!_tourEl) { _tourEl = document.createElement("div"); _tourEl.id = "icuTour"; _tourEl.className = "icu-tour"; document.body.appendChild(_tourEl); _tourEl.addEventListener("click", onTourClick); } }
  function startTour() { ensureTourEl(); _tourStep = 0; renderTour(); }
  function renderTour() {
    var n = TOUR_STEPS.length, step = TOUR_STEPS[_tourStep], last = _tourStep === n - 1;
    clearTourHL();
    var tgt = document.querySelector(step.sel);
    if (tgt) { try { tgt.scrollIntoView({ block: "center" }); } catch (e) {} tgt.classList.add("icu-tour-hl"); }
    _tourEl.innerHTML = '<div class="icu-tour-card" role="dialog" aria-label="ICU diagnosis tour">' +
      '<div class="icu-tour-step">Step ' + (_tourStep + 1) + " of " + n + "</div>" +
      '<div class="icu-tour-t">' + esc(step.title) + "</div>" +
      '<div class="icu-tour-x">' + esc(step.text) + "</div>" +
      (last ? '<label class="icu-tour-chk"><input type="checkbox" id="icuTourDont"> Don’t show this again</label>' : "") +
      '<div class="icu-tour-btns">' +
        (_tourStep > 0 ? '<button class="icu-btn ghost" data-icu-act="tourback">Back</button>' : "") +
        '<button class="icu-btn ghost" data-icu-act="tourskip">Skip</button>' +
        (last ? '<button class="icu-btn" data-icu-act="tourdone">Done</button>' : '<button class="icu-btn" data-icu-act="tournext">Next</button>') +
      "</div></div>";
    _tourEl.classList.add("on");
    setTimeout(function () { try { var b = _tourEl.querySelector('[data-icu-act="tournext"],[data-icu-act="tourdone"]'); if (b) b.focus(); } catch (e) {} }, 40);   // keyboard/SR lands on the tour
  }
  function closeTour() { clearTourHL(); if (_tourEl) { _tourEl.classList.remove("on"); _tourEl.innerHTML = ""; } }
  function onTourClick(e) {
    var b = e.target.closest && e.target.closest("[data-icu-act]"); if (!b) return;
    var act = b.getAttribute("data-icu-act");
    if (act === "tourback") { if (_tourStep > 0) _tourStep--; renderTour(); }
    else if (act === "tournext") { if (_tourStep < TOUR_STEPS.length - 1) _tourStep++; renderTour(); }
    else if (act === "tourskip") { var s = tourState(); s.skippedVersion = TOUR_VERSION; s.skippedCount = (s.skippedCount || 0) + 1; s.skippedAt = nowTs(); saveTourState(s); closeTour(); }
    else if (act === "tourdone") { var s2 = tourState(); s2.completedVersion = TOUR_VERSION; s2.completedAt = nowTs(); if ((document.getElementById("icuTourDont") || {}).checked) s2.dontShowAgain = true; saveTourState(s2); closeTour(); }
  }
  function maybeAutoTour() { if (!_tourSessionDone && tourShouldShow()) { _tourSessionDone = true; setTimeout(function () { try { startTour(); } catch (e) {} }, 500); } }

  /* ---- External trusted-evidence fallback (Phase 4) — opt-in, de-identified TOPIC only ---- */
  var _evCache = {}, _evBusy = false, _evErr = null;
  function extEvidenceOn() { try { var q = (location.search.match(/[?&]extevidence=([^&]+)/) || [])[1]; if (q != null) return q === "1" || q === "on"; var v = localStorage.getItem("smd_ext_evidence"); return v === null ? true : v === "1"; } catch (e) { return true; } }
  // Curated allowlist of trusted guideline organisations (landing pages — always valid; PubMed gets
  // the topic). NOT open web search.
  // Curated allowlist — every entry carries {q} so the chip runs an ACTUAL topic search on that
  // trusted org's own site (not the open web). Searchable orgs first; ICMR (no clean site search) last.
  var EVIDENCE_HUBS = [
    { org: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov/?term={q}" },
    { org: "NICE guidance", url: "https://www.nice.org.uk/search?q={q}" },
    { org: "CDC", url: "https://search.cdc.gov/search/?query={q}" },
    { org: "WHO", url: "https://www.who.int/home/search?query={q}" },
    { org: "ICMR", url: "https://www.icmr.gov.in/" }
  ];
  // Collapse StewardMD's internal imaging vocabulary → literature/MeSH-style roots so a citation
  // search actually hits (its own controlled labels return zero PubMed results).
  var CONCEPT_LIT = {
    "peripancreatic inflammatory change": "pancreatitis", "pancreatic inflammation": "pancreatitis",
    "biliary duct involvement": "biliary obstruction", "cholangitis features": "cholangitis",
    "pulmonary consolidation": "pneumonia", "ground-glass opacity": "ground glass opacity",
    "urinary tract obstruction": "urinary tract obstruction", "haemorrhage": "haemorrhage",
    "mass effect": "mass effect", "infarct": "infarction", "organomegaly": "organomegaly",
    "lymphadenopathy": "lymphadenopathy", "collection / abscess": "abscess"
  };
  function correlationTopic(ev) {
    // A SHORT, literature-phrased topic: canonical diagnosis first (high-yield), then at most a couple
    // of imaging concepts collapsed to literature roots + deduped. Never AND a long internal-vocab
    // string. Only the canonical KB disease name is used for the free-text diagnosis (drops any hidden
    // name/MRN); digits stripped as a PHI backstop. PHI must not reach any external service.
    var p = _raw.patient || {}, parts = [];
    var push = function (t) {
      t = String(t == null ? "" : t).trim(); if (!t) return; var k = t.toLowerCase();
      // substring-aware dedupe: skip if an existing part already contains this term or vice-versa
      // (so "Chronic Pancreatitis" + collapsed "pancreatitis" doesn't repeat the word).
      for (var i = 0; i < parts.length; i++) { var e = parts[i].toLowerCase(); if (e === k || e.indexOf(k) >= 0 || k.indexOf(e) >= 0) return; }
      parts.push(t);
    };
    if (p.diagnosis) { try { var h = ((window.SMD_REASON && SMD_REASON.search) ? (SMD_REASON.search(p.diagnosis, 1) || []) : [])[0]; if (h && h.name) push(h.name); } catch (e) {} }
    (ev.img || []).forEach(function (c) { if (parts.length < 3) push(CONCEPT_LIT[c] || c); });
    if (parts.length < 2) (ev.labs || []).slice(0, 1).forEach(function (l) { push(l.replace(/\s*\(.*\)$/, "")); });
    return parts.join(" ").replace(/\b\d+\b/g, " ").replace(/[^\w\s,\-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  function evResultsHTML(topic) {
    if (_evBusy) return '<div class="icu-assist-msg">Searching trusted references…</div>';
    var res = _evCache[topic];
    var terms = topic ? '<div class="icu-corr-sub">Search terms</div><div class="icu-corr-chips"><span class="icu-corr-chip">' + esc(topic) + "</span></div>" : "";
    var hubs = '<div class="icu-corr-sub">Trusted guideline sources — tap to search this topic</div><div class="icu-ev-hubs">' + EVIDENCE_HUBS.map(function (h) {
      var u = h.url.indexOf("{q}") >= 0 ? h.url.replace("{q}", encodeURIComponent(topic)) : h.url;
      return '<a class="icu-ev-hub" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(h.org) + "</a>";
    }).join("") + "</div>";
    var cites = "";
    if (_evErr) cites = '<div class="icu-assist-msg">' + esc(_evErr.error === "quota" ? "Usage limit reached — try again later; use the trusted sources above." : "Couldn’t reach the reference service right now — use the trusted sources above.") + "</div>";
    else if (res && res.results && res.results.length) cites = '<div class="icu-corr-sub">Peer-reviewed guidelines &amp; reviews (' + esc(res.source || "PubMed") + ')</div>' + res.results.map(function (r) {
      return '<a class="icu-ev-cite" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer"><div class="t">' + esc(r.title) + '</div><div class="m">' + esc([r.journal, r.year, r.pubtype].filter(Boolean).join(" · ")) + "</div></a>";
    }).join("");
    else if (res) cites = '<div class="icu-assist-msg" style="color:var(--muted)">StewardMD’s built-in citation lookup returned nothing for this exact query — this does <b>not</b> mean no evidence exists. Tap a trusted source above to search this topic.</div>';
    return terms + hubs + cites + '<div class="icu-assist-src">External references — <b>not StewardMD-verified</b>. Confirm against the source and local protocol before acting.</div>';
  }
  function openEvidenceLookup() {
    if (!extEvidenceOn()) { if (window.toast) toast("External references are turned off in Settings."); return; }
    ensureModal();
    var topic = correlationTopic(correlationEvidence());
    // Only repaint if the EVIDENCE sheet is still the one showing (modalEl is shared by every ICU
    // modal) — a late PubMed response must never clobber an imaging/patient/snapshot modal.
    function evLive() { return modalEl.classList.contains("on") && !!modalEl.querySelector("#icuEvSheet"); }
    function render(confirmed) {
      modalEl.innerHTML = '<div class="icu-sheet" id="icuEvSheet"><h3>' + ico("search", "🔎") + ' Evidence beyond StewardMD</h3>' +
        '<p class="icu-doc-sub">StewardMD may not have sufficient internal coverage for this pattern. Search trusted external clinical references for <b>' + esc(topic || "this patient’s findings") + '</b>?</p>' +
        (confirmed ? evResultsHTML(topic) :
          '<div class="icu-img-btns"><button class="icu-btn" id="icuEvGo">' + ico("search", "🔎") + ' Search trusted references</button>' +
          '<button class="icu-btn ghost" data-icu-act="closeform">Continue with StewardMD only</button>' +
          '<button class="icu-btn ghost" data-icu-act="imgadd">Add a manual note</button></div>') +
        '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:10px">Close</button></div>';
      modalEl.classList.add("on");
      var go = modalEl.querySelector("#icuEvGo");
      if (go) go.addEventListener("click", function () {
        if (_evBusy) { render(true); return; }                       // in-flight — reuse the pending request (no double fetch/charge)
        if (_evCache[topic]) { _evErr = null; render(true); return; }  // cached SUCCESS — no repeat fetch
        _evErr = null; _evBusy = true; render(true);
        (window.SMD_AI && SMD_AI.evidence ? SMD_AI.evidence(topic) : Promise.resolve({ error: "off" })).then(function (res) {
          _evBusy = false;
          if (res && !res.error) _evCache[topic] = res; else _evErr = res || { error: "server" };   // cache SUCCESS only → errors stay retryable
          if (evLive()) render(true);
        }).catch(function () { _evBusy = false; _evErr = { error: "server" }; if (evLive()) render(true); });
      });
    }
    _evErr = null;
    render(false);
  }
  function corrChips(arr, cls) { return (arr && arr.length) ? '<div class="icu-corr-chips">' + arr.map(function (x) { return '<span class="icu-corr-chip ' + (cls || "") + '">' + esc(x) + "</span>"; }).join("") + "</div>" : ""; }
  function corrDeepHTML(res) {
    if (!res || res.error) {
      var msg = res && res.error === "ai-off" ? "Deep review is turned off (cloud text disabled in Settings)."
        : res && res.error === "quota" ? "AI usage limit reached — try again later. Your findings remain saved."
        : res && res.error === "timeout" ? "Deep review timed out. Your findings remain saved — tap Deep clinical review to retry, or review/edit the context."
        : "Deep review could not be completed. Your findings remain saved. Retry, or review/edit the context.";
      return '<div class="icu-assist-msg">' + ico("warn", "⚠️") + " " + esc(msg) + "</div>";
    }
    var s = res.correlation || res;
    return '<div class="icu-assist-draft">Draft — clinician review required. Advisory only; not a diagnosis.</div>' +
      (s.clinicalCorrelation ? '<div class="icu-assist-summary">' + esc(s.clinicalCorrelation) + "</div>" : "") +
      assistSection("Top considerations", s.topConsiderations) +
      assistSection("Why these fit", s.whyFit) +
      assistSection("Important alternatives / mimics", s.alternatives) +
      assistSection("What does not fit", s.whatDoesntFit) +
      assistSection("Missing information / investigations", s.missing) +
      assistSection("Urgent red flags", s.redFlags) +
      assistSection("Suggested next checks", s.nextChecks) +
      assistSection("Relevant StewardMD protocols", s.protocols) +
      '<div class="icu-assist-src">Advisory synthesis from de-identified StewardMD imaging + labs — verify against the report and the deterministic engine.</div>';
  }
  var _corrPt = null;
  function correlationCard() {
    if (!icuImagingOn()) return "";
    var pid = _raw.patient._id || _raw.patient.name || "cur";
    if (_corrPt !== pid) { _corrPt = pid; _corrAnalysed = false; _corrBusy = false; _corrCache = {}; _corrErr = null; }   // reset ALL correlation state on patient switch (no cross-patient leak)
    var imgs = (_raw.imaging || []).filter(function (r) { return !r.hidden; }), labN = Object.keys(_raw.labs.recent || {}).length;
    var fN0 = icuDxFlowOn() ? (_raw.findings || []).length : 0, vN0 = icuDxFlowOn() ? latestVitalsSummary().length : 0;
    var header = '<div class="icu-sec-lbl" style="margin-top:14px">' + ico("pulse", "🧠") + ' Clinical Correlation</div>';
    if (!hasData()) return header + '<div class="icu-empty">Select a patient to correlate imaging and laboratory findings.</div>';
    if (!imgs.length && !labN && !fN0 && !vN0) return header + '<div class="icu-empty">Add findings, imaging or laboratory data to correlate them.</div>';
    if (!_corrAnalysed) {
      var fN = icuDxFlowOn() ? (_raw.findings || []).length : 0;
      return header + '<div class="icu-card"><p class="icu-doc-sub">Correlate this patient’s ' + (fN ? "structured findings, " : "") + 'imaging concepts, laboratory abnormalities' + (icuDxFlowOn() ? " and vitals" : "") + ' against StewardMD’s knowledge base. Advisory only — the deterministic engine remains the diagnostic authority.</p>' +
        '<div class="icu-corr-meta">' + (fN ? fN + " finding" + (fN === 1 ? "" : "s") + " · " : "") + imgs.length + " imaging report" + (imgs.length === 1 ? "" : "s") + " · " + labN + " lab value" + (labN === 1 ? "" : "s") + "</div>" +
        '<button class="icu-btn" data-icu-act="corranalyse">' + ico("pulse", "✨") + ' Analyse ' + (fN ? "findings + " : "") + 'imaging + labs</button></div>';
    }
    var q = runQuickCorrelation(), ev = q.ev, deep = _corrCache[(_raw.patient._id || "cur") + ":" + correlationHash(ev)];
    var cls = /Strong/.test(q.status) ? "ok" : /No adequate|Insufficient/.test(q.status) ? "muted" : /Conflicting/.test(q.status) ? "warn" : "partial";
    var badge = '<span class="icu-corr-badge ' + cls + '">' + esc(q.status) + "</span>";
    // The Quick deterministic signal is only trustworthy when the mapped keys actually represent
    // the evidence. If imaging findings did NOT map to an engine key (the common case — the engine
    // has no imaging vocabulary), a ranked "Top considerations" from the leftover labs alone is
    // MISLEADING (e.g. pancreatitis imaging + thrombocytopenia → the engine returns Dengue/Malaria).
    // So when imaging concepts are unmapped, suppress the ranked list and steer to Deep review.
    var considBlock, supporting = "", missing = "";
    if ((q.unmapped || []).length) {
      considBlock = '<div class="icu-corr-note">' + ico("info", "ⓘ") + " Some findings aren’t machine-matched to the knowledge base yet: <b>" + esc(q.unmapped.join(", ")) + "</b>. Run <b>Deep clinical review</b> below for a full imaging + lab correlation." +
        (q.candidates.length ? ' <span class="icu-corr-partial">(The mapped findings alone point to ' + esc(q.candidates.slice(0, 2).map(function (c) { return c.name; }).join(", ")) + " — partial, do not rely on this.)</span>" : "") + "</div>";
    } else if (q.candidates.length) {
      considBlock = '<div class="icu-corr-sub">Top considerations (pattern-based, advisory)</div><ol class="icu-corr-ol">' + q.candidates.map(function (c) { return "<li>" + esc(c.name) + ' <span class="icu-corr-conf">' + (c.confidence != null ? c.confidence + "/100" : "") + "</span></li>"; }).join("") + "</ol>";
      supporting = (q.candidates[0] && (q.candidates[0].supporting || []).length) ? '<div class="icu-corr-sub">Supporting</div>' + corrChips(q.candidates[0].supporting, "ok") : "";
      missing = (q.candidates[0] && (q.candidates[0].missing || []).length) ? '<div class="icu-corr-sub">Missing / to review</div>' + corrChips(q.candidates[0].missing, "muted") : "";
    } else {
      considBlock = '<div class="icu-corr-sub" style="color:var(--muted)">No confident internal match — run a Deep clinical review for a full correlation.</div>';
    }
    var redflags = ev.crit.length ? '<div class="icu-img-crit">' + ico("warn", "⚠️") + ' <b>Urgent imaging findings</b> — verify & escalate.<div class="icu-img-crit-t">' + ev.crit.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("") + "</div></div>" : "";
    // Evidence assembled now surfaces the structured findings (with negation prefix) + vitals too,
    // so the clinician sees their symptoms are included — not just imaging + labs.
    var fLabels = (ev.findings || []).map(function (f) { return (f.polarity === "absent" ? "No " : f.polarity === "possible" ? "? " : f.temporality === "historical" ? "H/o " : "") + f.label; });
    var evAll = fLabels.concat(ev.img).concat(ev.labs).concat(ev.vitals || []);
    var evidence = evAll.length ? '<div class="icu-corr-sub">Evidence assembled</div>' + corrChips(evAll) : "";
    var deepBlock = _corrBusy ? '<div class="icu-assist-msg">Running deep clinical review…</div>' : (deep ? '<div class="icu-corr-deep">' + corrDeepHTML(deep) + "</div>" : (_corrErr ? '<div class="icu-corr-deep">' + corrDeepHTML(_corrErr) + "</div>" : ""));
    return header + '<div class="icu-card">' + badge + redflags + considBlock + supporting + missing + evidence +
      '<div class="icu-img-btns" style="margin-top:10px">' +
        '<button class="icu-btn" data-icu-act="corrdeep"' + (_corrBusy ? " disabled" : "") + '>' + ico("pulse", "✨") + ' Deep clinical review</button>' +
        (extEvidenceOn() ? '<button class="icu-btn ghost" data-icu-act="corrext">Find evidence beyond StewardMD</button>' : '<button class="icu-btn ghost" disabled title="Turned off in Settings">Find evidence beyond StewardMD</button>') +
      "</div>" + deepBlock +
      '<p class="icu-doc-sub" style="margin-top:8px">Advisory only. The deterministic engine owns the diagnosis; this never changes any ranking.</p></div>';
  }

  /* --------------------------------------------------- share & clear findings */
  // Share a case exactly like the Clinical Reasoning dashboard: Web Share API
  // (system share sheet) with a clipboard-copy fallback where it isn't supported.
  // KI-H6: patient-identifiable EXPORTS (OS share sheet, print/PDF) pass through a one-tap
  // consent gate first — buildSummary/buildDischarge carry the patient's name/bed/hospital/labs/
  // imaging, and the share sheet forwards them to any app. Nothing leaves the device until the
  // clinician confirms. (Copy-to-clipboard stays on-device and keeps its own "copied" toast.)
  var _phiPending = null;
  function phiExportConfirm(what, proceed) {
    injectCSS(); ensureModal(); _phiPending = proceed;
    var isPrint = what.indexOf("rint") >= 0;
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("warn", "⚠️") + ' Patient-identifiable data</h3>' +
      '<p class="icu-doc-sub">This ' + esc(what) + ' includes the patient’s name, bed, hospital, labs and imaging. Send it only through <b>approved, secure</b> channels — never personal messaging or public posts — per your local data-protection policy.</p>' +
      '<button class="icu-btn" data-icu-act="phiexportgo">' + ico(isPrint ? "copy" : "share", isPrint ? "🖨️" : "📤") + ' ' + (isPrint ? "Print anyway" : "Share anyway") + '</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function shareText(title, txt) {
    // Native: navigator.share is unreliable in WKWebView — use the Capacitor share
    // sheet (guest-safe: buildSummary is plain text, no Firebase/Firestore needed).
    if (window.SMD_IS_NATIVE && window.SMD_NATIVE) {
      try { window.SMD_NATIVE.share({ title: title, text: txt, dialogTitle: title }).catch(function () {}); return true; } catch (e) {}
    }
    try { if (navigator.share) { navigator.share({ title: title, text: txt }).catch(function () {}); return true; } } catch (e) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); if (window.toast) toast("Case summary copied — sharing not supported here"); return true; } } catch (e) {}
    return false;
  }
  function doShareCase() { if (!shareText("StewardMD ICU — " + (_raw.patient.name || "ICU patient"), buildSummary())) openSummary(); }
  function shareCase() { phiExportConfirm("share to another app", doShareCase); }   // KI-H6 consent gate
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
  function clearFindings() { ICU.reset(); _lytesExp = {}; _active = "overview"; _ws = "overview"; _wsLast = {}; closeForm(); _paintTop = true; paint(); if (window.toast) toast("Findings cleared"); }

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
  function rosterKey(owner) { return ROSTER_BASE + ":" + (owner || ownerNow()) + unitSuffix(); }
  function loadRoster() { try { var r = JSON.parse(localStorage.getItem(rosterKey())); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function saveRoster(r) { try { localStorage.setItem(rosterKey(), JSON.stringify(r)); } catch (e) {} }
  // React to sign-in / sign-out / account-switch. Only ever called from Firebase's
  // onAuthStateChanged (a RELIABLE, resolved signal) — never from the transient
  // "firebase not loaded yet" state — so we don't wipe a user's own work at startup.
  // KI-M3: load THIS owner's own scoped live buffer into STATE (used on account switch / the
  // first post-load sync). Migrates the legacy unscoped buffer if the scoped one is absent.
  function loadOwnerBuffer(owner) {
    try {
      var raw = JSON.parse(localStorage.getItem(bufKey(owner)) || localStorage.getItem(LS_KEY) || "null");
      if (raw && typeof raw === "object") Object.keys(DEFAULT_STATE).forEach(function (k) { STATE[k] = (raw[k] != null) ? clone(raw[k]) : clone(DEFAULT_STATE[k]); });
    } catch (e) {}
  }
  var _ownerBufSynced = false;   // KI-M3: has the live buffer been synced to the RESOLVED owner yet?
  function reconcileOwner() {
    var now = ownerNow(), stored = null;
    try { stored = localStorage.getItem(OWNER_KEY); } catch (e) {}
    if (stored == null) {
      // First run under the scoped scheme: migrate the legacy shared buckets (roster + live
      // buffer) into THIS device's current owner once (data preserved, not destroyed).
      try {
        var legacy = localStorage.getItem(ROSTER_BASE);
        if (legacy && !localStorage.getItem(rosterKey(now))) localStorage.setItem(rosterKey(now), legacy);
        if (legacy) localStorage.removeItem(ROSTER_BASE);
        var legacyBuf = localStorage.getItem(LS_KEY);
        if (legacyBuf && !localStorage.getItem(bufKey(now))) localStorage.setItem(bufKey(now), legacyBuf);
        if (legacyBuf) localStorage.removeItem(LS_KEY);
      } catch (e) {}
      _ownerBufSynced = true;   // _raw already holds the (now migrated) buffer from init
    } else if (stored !== now) {
      if (stored === "anon" && now !== "anon") {
        // Signing in from an anon session → claim the anon roster + live buffer (keep the work
        // the clinician did before signing in).
        try { var anon = localStorage.getItem(rosterKey("anon"));
          if (anon && !localStorage.getItem(rosterKey(now))) localStorage.setItem(rosterKey(now), anon);
          localStorage.removeItem(rosterKey("anon"));
          var anonBuf = localStorage.getItem(bufKey("anon"));
          if (anonBuf && !localStorage.getItem(bufKey(now))) localStorage.setItem(bufKey(now), anonBuf);
          localStorage.removeItem(bufKey("anon")); } catch (e) {}
        _ownerBufSynced = true;   // keep current _raw (the anon work, now owned by `now`)
      } else {
        // Real account switch or sign-out → wipe the previous clinician's open patient, then
        // load THIS owner's OWN saved buffer (so they see their work, not an empty dashboard).
        try { if (typeof ICU !== "undefined" && ICU.reset) ICU.reset(); } catch (e) {}
        loadOwnerBuffer(now);
        _ownerBufSynced = true;
      }
    } else if (!_ownerBufSynced) {
      // Same owner as last session, FIRST reconcile after load: init read the pre-auth (:anon)
      // key, so sync to this owner's own buffer once. Never on later refreshes (a spurious
      // same-owner auth event must not clobber in-session work).
      loadOwnerBuffer(now);
      _ownerBufSynced = true;
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
    _screen = "patient";   // v2: loading a saved patient opens its workspace (not the board)
    _lytesExp = {}; _active = "overview"; _ws = "overview"; _wsLast = {}; closeForm(); _paintTop = true; paint();
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
  // Shared removal: drop a saved case from the local roster + the cloud (best-effort). Returns the
  // cloud-delete promise. Reused by the roster Delete AND the patient-workspace Discharge/remove.
  function rosterRemove(id) { saveRoster(loadRoster().filter(function (x) { return x.id !== id; })); return cloudDel(id); }
  function deletePatient(id) {
    rosterRemove(id).then(function () { openRoster(); });
    openRoster();                                            // optimistic refresh
  }
  // Destructive "Discharge / remove patient" card for the patient workspace (Documents + More).
  // Solo → dischargept. Group → grprmpt, only when a patient is open AND the role can instruct.
  function dischargePatientCard() {
    if (grpActive()) {
      var api = groupsApi();
      var canDel = _grpPtId && api && api.canInstruct && api.canInstruct(_grp && _grp.myRole);
      if (!canDel) return "";
      return '<div class="icu-card"><div class="icu-sec-lbl" style="color:var(--danger)">' + ico("trash", "🗑") + ' Remove patient</div>' +
        '<p class="icu-doc-sub" style="margin:0 0 10px">Remove this patient from the shared unit for everyone. This cannot be undone.</p>' +
        '<button class="icu-btn ghost" data-icu-act="grprmpt" style="color:var(--danger);border-color:var(--danger)">' + ico("trash", "🗑") + ' Remove patient from unit</button></div>';
    }
    return '<div class="icu-card"><div class="icu-sec-lbl" style="color:var(--danger)">' + ico("trash", "🗑") + ' Discharge / remove patient</div>' +
      '<p class="icu-doc-sub" style="margin:0 0 10px">Remove this patient from your board and saved patients. This cannot be undone.</p>' +
      '<button class="icu-btn ghost" data-icu-act="dischargept" style="color:var(--danger);border-color:var(--danger)">' + ico("trash", "🗑") + ' Discharge / remove patient</button></div>';
  }
  // Discharge / remove the CURRENT patient from the workspace → confirm → remove saved copy (if any)
  // → clear the live state → back to the unit board. Solo mode (group has grpRemovePatient).
  function dischargePatient() {
    ensureModal();
    var nm = (_raw.patient && _raw.patient.name) || "this patient";
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-modal="true" aria-label="Discharge or remove patient"><h3>' + ico("trash", "🗑") + ' Discharge / remove ' + esc(nm) + '?</h3>' +
      '<p class="icu-doc-sub" style="margin:0 0 14px">Removes this patient from your ICU board and your saved patients on this device (and your cloud copy). This cannot be undone — export or share the case first if you need a record.</p>' +
      '<button class="icu-btn" data-icu-act="dischargeptgo" style="background:var(--danger);background-image:none;box-shadow:none">' + ico("trash", "🗑") + ' Remove patient</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button></div>';
    modalEl.classList.add("on");
  }
  function dischargePatientGo() {
    var id = _raw.patient && _raw.patient._id;
    if (id) rosterRemove(id);                                // remove saved copy locally + cloud (best-effort)
    ICU.reset();
    _lytesExp = {}; _active = "overview"; _ws = "overview"; _wsLast = {};
    closeForm(); _screen = "board"; _paintTop = true; paint();
    if (window.toast) toast("Patient removed");
  }
  // Group mode: remove the shared patient doc from the unit (icu-collab; rules allow if canInstruct).
  function grpRemovePatient() {
    var api = groupsApi();
    if (!api || !grpActive() || !_grpPtId || !api.removePatient) return;
    if (!(api.canInstruct && api.canInstruct(_grp && _grp.myRole))) { if (window.toast) toast("Only instructing roles can remove a patient"); return; }
    var nm = (_raw.patient && _raw.patient.name) || "this patient";
    if (!window.confirm("Remove " + nm + " from " + ((_grp && _grp.name) || "the unit") + " for everyone? This cannot be undone.")) return;
    var gid = _grp.id, pid = _grpPtId;
    api.removePatient(gid, pid).then(function () {
      if (window.toast) toast("Patient removed from unit");
      grpTeardownPatient(); _screen = "board"; _paintTop = true; if (ICU.isOpen()) paint();
    }, function (e) { _grpErr = grpErrText(e); if (window.toast) toast("Couldn’t remove — instructing roles only"); if (ICU.isOpen()) paint(); });
  }
  function newPatient() {
    ICU.reset();
    _lytesExp = {}; _active = "overview"; _ws = "overview"; _wsLast = {}; closeForm(); _paintTop = true; paint();
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
    ["🧑", "Patient details", "patient", "user"], ["❤️", "Vitals (monitor)", "monitor", "pulse"], ["🩸", "Labs / electrolytes", "labs", "flask"],
    ["🫁", "ABG", "abg", "abg"], ["🌬", "Ventilator", "ventilator", "lungs"], ["💧", "Fluid balance", "flowsheet", "droplet"],
    ["💉", "Infusion", "infusion", "syringe"], ["🎯", "Today's goals", "goals", "check"]
  ];
  // ONE consolidated "Add / import data" sheet — Speak (MaiK Scribe) · Snap · Ward · Type.
  function openDataMenu() {
    ensureModal();
    var A = ' style="justify-content:flex-start;text-align:left"';
    modalEl.innerHTML = '<div class="icu-sheet"><h3>Add / import data</h3>' +
      '<p style="margin:0 0 12px;color:var(--muted);font:600 13px var(--font)">Enter, speak, or snap this patient’s vitals, labs, ABG or ventilator settings. Nothing is applied until you review it.</p>' +
      '<div class="icu-grid2">' +
        '<button class="icu-btn" data-icu-act="voice"' + A + '>' + ico("mic", "🎤") + ' Speak <span style="opacity:.8;font-weight:700">· MaiK Scribe</span></button>' +
        '<button class="icu-btn ghost" data-icu-act="snapshot"' + A + '>' + ico("camera", "📷") + ' Snap a photo</button>' +
        '<button class="icu-btn ghost" data-icu-act="impmethod:file"' + A + '>' + ico("upload", "📄") + ' Upload PDF / image</button>' +
        '<button class="icu-btn ghost" data-icu-act="wardfetch"' + A + '>' + ico("hospital", "🏥") + ' Import from ward</button>' +
      '</div>' +
      '<div style="font:800 11px var(--font);text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:14px 0 8px">Type it in</div>' +
      '<div class="icu-grid2">' + DATA_MENU.map(function (m) {
        return '<button class="icu-btn ghost" data-icu-act="edit:' + m[2] + '"' + A + '>' + ico(m[3], m[0]) + " " + m[1] + "</button>";
      }).join("") + "</div>" +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:10px">Close</button></div>';
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
      case "calc": { var _scp = (STATE.scores || []).filter(function (x) { return x.id === arg && x.inputs; })[0]; try { if (window.MEDCALC && MEDCALC.open) MEDCALC.open(arg, _scp ? _scp.inputs : undefined); } catch (e) {} break; }
      case "tab": if (icuV2On()) _screen = "patient"; _active = arg; _ws = wsOf(arg); _wsLast[_ws] = arg; paint(); var sc = rootEl && rootEl.querySelector(".icu-scroll"); if (sc) sc.scrollTop = 0; break;
      case "ws": { if (icuV2On()) _screen = "patient"; _ws = arg; var _m = wsMembers(wsById(arg)), _l = _wsLast[arg]; _active = (_l && _m.indexOf(_l) >= 0) ? _l : _m[0]; paint(); var sc2 = rootEl && rootEl.querySelector(".icu-scroll"); if (sc2) sc2.scrollTop = 0; break; }
      // ---- ICU v2 (smd_icu_v2) — board / alerts / team / admit / filter, all flag-only ----
      case "icuboard": if (grpActive()) grpTeardownPatient(); _screen = "board"; _paintTop = true; paint(); break;
      case "icualerts": if (grpActive()) grpNotifMarkSeen(); _screen = "alerts"; _paintTop = true; paint(); break;
      case "icuteam": _screen = "team"; _paintTop = true; paint(); break;
      case "icuadmit": _admitting = true; _screen = "patient"; if (grpActive()) grpAdmit(); else newPatient(); break;
      case "icumore": _screen = "patient"; _active = "more"; _ws = "more"; _paintTop = true; paint(); break;
      case "testpush": grpTestPush(); break;
      case "notifprefs": grpOpenNotifPrefs(); break;   // per-user ICU notification category toggles
      case "openpt": { var _op = decodeURIComponent(arg); _screen = "patient"; if (grpActive()) { grpOpenPatient(_op); } else if (_op === (_raw.patient._id || "cur") || _op === "cur") { _paintTop = true; paint(); } else { loadPatient(_op); } break; }
      case "icufilter": _v2Filter = arg; paint(); break;
      // ---- Unit picker: hospital → category (ICU|Ward) → unit type ----
      case "unitpick": _screen = "units"; _pickStep = _unit.hospital ? "category" : "hospital"; _pickCat = null; _paintTop = true; paint(); break;
      case "unithosp": _unit.hospital = decodeURIComponent(arg); unitSavePref(); _pickStep = "category"; _paintTop = true; paint(); break;
      case "unithospchg": _pickStep = "hospital"; _paintTop = true; paint(); break;
      case "unitcat": _pickCat = arg; _pickStep = "units"; _paintTop = true; paint(); break;
      case "unitback": _pickStep = "category"; _paintTop = true; paint(); break;
      case "unitsel": { var _uc = arg.indexOf(":"); selectUnit({ cat: arg.slice(0, _uc), type: decodeURIComponent(arg.slice(_uc + 1)) }); _paintTop = true; paint(); break; }
      case "unitgrpnew": grpOpenCreate(arg); break;
      case "grptoggle": try { if (localStorage.getItem("smd_icu_groups") === "1") localStorage.removeItem("smd_icu_groups"); else localStorage.setItem("smd_icu_groups", "1"); } catch (e) {} try { location.reload(); } catch (e) {} break;
      // ---- ICU v2 group mode (smd_icu_groups, Phase 2) — unit switcher / create / invite / tasks ----
      case "grppick": grpOpenPicker(); break;
      case "grpsel": { var _gsel = grpById(decodeURIComponent(arg)); if (_gsel) grpSelect(_gsel, false); closeForm(); if (_screen === "units") { _screen = "board"; _paintTop = true; paint(); } break; }
      case "grpnew": grpOpenCreate(_unit.cat); break;
      case "grpcreate": grpDoCreate(); break;
      case "grpinvite": grpOpenInvite(); break;
      case "grpinvitesend": grpDoAddById(); break;
      case "grpreviewed": grpDoReviewed(); break;
      case "grptask": grpCycleTask(decodeURIComponent(arg)); break;
      case "grptaskexplain": grpTaskExplain(decodeURIComponent(arg)); break;
      case "grptaskexplainsave": grpTaskExplainSave(); break;
      case "grpnudge": grpNudgeTask(decodeURIComponent(arg)); break;   // re-push a task reminder to the executor roles
      case "tlall": _tlAll = !_tlAll; _paintTop = true; paint(); break;
      case "grpretry": grpRetry(); break;   // Phase 4: re-subscribe after a connection/error state
      case "pushnotedismiss": grpPushNoteDismiss(); break;   // dismiss the "teammates weren't alerted" board notice
      // ---- ICU v2 group mode Phase 5 — doctor ID + membership (add/invite-link/leave/remove/join) ----
      case "grpcopyid": grpCopyId(); break;
      case "grpaddid": grpOpenAddById(); break;
      case "grpinvlink": grpDoInviteLink(); break;
      case "grpinvrole": grpSetInvRole(arg); break;
      case "grpleave": grpDoLeave(); break;
      case "grpdelete": grpDoDelete(); break;
      case "grpreclaimhead": grpReclaimHead(); break;
      case "grprm": grpDoRemove(decodeURIComponent(arg)); break;
      case "grpjoinaccept": grpDoJoinAccept(); break;
      case "grpjoindecline": grpDoJoinDecline(); break;
      // ---- ICU v2 Phase 3 — round-note composer (no-type instruction → tasks + timeline) ----
      case "grpround": grpOpenRound(); break;
      case "grproundback": grpRoundBack(); break;
      case "grproundtog": grpRoundToggle(arg); break;
      case "grproundadd": grpRoundAddCustom(); break;
      case "grproundrm": grpRoundRemove(arg); break;
      case "grproundprio": grpRoundSetPriority(arg); break;
      case "grproundbehalf": grpRoundSetBehalf(arg); break;
      case "grproundpost": grpDoPostRound(); break;
      case "summary": openSummary(); break;
      case "printsummary": printSummary(); break;
      case "discharge": openDischarge(); break;
      case "copyhandover": {
        var _sb = buildSBAR(_raw), _p0 = _raw.patient || {};
        var _htxt = "SHIFT HANDOVER (SBAR) — " + (_p0.name || "ICU patient") + (_p0.bed ? " · Bed " + _p0.bed : "") + "\n\n" +
          _sb.map(function (x) { return x.label.toUpperCase() + ":\n" + x.body; }).join("\n\n") +
          "\n\n— Decision support only; verify against the patient. StewardMD ICU.";
        grpCopyText(_htxt, "Handover copied — verify before use");
        break;
      }
      case "handovershift": {
        if (!grpActive() || !_grpPtId) { if (window.toast) toast("Open a shared (Group) patient to hand over to the unit"); break; }
        var _api2 = groupsApi();
        var _sb = buildSBAR(_raw), _detail = _sb.map(function (x) { return x.label + ": " + x.body; }).join(" | ");
        // 1) record the full SBAR in the shared timeline (the incoming shift reads it there)
        if (_api2 && _api2.addTimelineEvent) { try { _api2.addTimelineEvent(_grp.id, _grpPtId, { type: "handover", title: "Shift handover", detail: _detail }).then(null, function () {}); } catch (e) {} }
        // 2) notify the unit (best-effort push to registered teammates = the incoming shift)
        try { grpNotifyHandover(_grp.id, _grpPtId, _sb); } catch (e) {}
        if (window.toast) toast("Handover posted to the unit timeline");
        // 3) jump to Rounds so the handover entry is visible (so it clearly did something)
        _active = "rounds"; _ws = wsOf("rounds"); _wsLast[_ws] = "rounds"; _tlAll = false; _paintTop = true; paint();
        break;
      }
      case "dischargecopy": copyDischarge(); break;
      case "dischargeprint": printDischarge(); break;
      // Lab Watch
      case "labwatch": _lwDraft = null; openLabWatch(); break;
      case "lwtog": { var _lk = arg; _lwDraft.analytes = _lwDraft.analytes || []; var _li = _lwDraft.analytes.indexOf(_lk); if (_li >= 0) _lwDraft.analytes.splice(_li, 1); else _lwDraft.analytes.push(_lk); openLabWatch(); break; }
      case "lwgrp": { var _grp = null; for (var _gi = 0; _gi < TREND_GROUPS.length; _gi++) if (TREND_GROUPS[_gi].id === arg) _grp = TREND_GROUPS[_gi]; if (_grp) { _lwDraft.analytes = _lwDraft.analytes || []; var _ks = _grp.keys.filter(function (k) { return TREND_INTERP[k]; }); var _all = _ks.every(function (k) { return _lwDraft.analytes.indexOf(k) >= 0; }); if (_all) _lwDraft.analytes = _lwDraft.analytes.filter(function (k) { return _ks.indexOf(k) < 0; }); else _ks.forEach(function (k) { if (_lwDraft.analytes.indexOf(k) < 0) _lwDraft.analytes.push(k); }); openLabWatch(); } break; }
      case "lwmode": _lwDraft.mode = arg; openLabWatch(); break;
      case "lwdur": _lwDraft.dur = (arg === "stop" ? "stop" : arg === "discharge" ? "discharge" : +arg); openLabWatch(); break;
      case "lwall": { _lwDraft.analytes = []; TREND_GROUPS.forEach(function (g) { g.keys.forEach(function (k) { if (TREND_INTERP[k] && _lwDraft.analytes.indexOf(k) < 0) _lwDraft.analytes.push(k); }); }); openLabWatch(); break; }
      case "lwclear": _lwDraft.analytes = []; openLabWatch(); break;
      case "lwdeliv": _lwDraft.delivery = arg; openLabWatch(); break;
      case "lwbg": lwEnableBackground(); break;
      case "lwmgr": lwOpenManager(); break;
      case "lwstart": lwStart(); break;
      case "lwcancel": _lwDraft = null; closeForm(); break;
      case "lwstop": lwStop(); break;
      case "lwpause": lwPause(); break;
      case "lwedit": lwEdit(); break;
      case "lwopen": lwOpenAnalyte(arg); break;
      case "dxsearch": openDxSearch(); break;
      case "findpick": openFindingPicker(); break;
      case "finddx": _dxShow = true; paint(); break;
      case "dxpick": pickWorkingDx(decodeURIComponent(arg), "deterministic_suggestion"); paint(); break;
      case "dxwhy": { var _dk = arg; _dxWhy[_dk] = !_dxWhy[_dk]; paint(); break; }
      case "dxmanual": openDxSearch(); break;
      case "dxskip": _dxShow = false; paint(); break;
      case "dxadv": _dxAdvanced = true; paint(); break;
      case "pickdx": pickDiagnosis(decodeURIComponent(arg)); break;
      case "imgfetch": imagingFetch(); break;
      case "imgadd": openImagingForm(null); break;
      case "imgassist": openImagingAssist(decodeURIComponent(arg)); break;
      case "imgedit": openImagingForm(decodeURIComponent(arg)); break;
      case "imgfilter": _imgFilter = arg; paint(); break;
      case "imgexpand": { var _ie = decodeURIComponent(arg); _imgOpen[_ie] = !_imgOpen[_ie]; paint(); break; }
      case "imgreview": { var _ir = imgById(decodeURIComponent(arg)); if (_ir) _ir.reviewed = !_ir.reviewed; paint(); break; }
      case "imgsummary": { var _is = imgById(decodeURIComponent(arg)); if (_is) _is.inSummary = !_is.inSummary; paint(); if (window.toast) toast(_is && _is.inSummary ? "Added to Daily Summary" : "Removed from Daily Summary"); break; }
      case "imgsummaryadd": { var _isa = imgById(decodeURIComponent(arg)); if (_isa) { _isa.inSummary = true; if (window.toast) toast(_isa.assist ? "Added to Daily Summary (incl. AI summary) — open 📋 Daily Summary" : "Added to Daily Summary — open 📋 Daily Summary"); } paint(); break; }
      case "corranalyse": _corrAnalysed = true; paint(); break;
      case "corrdeep": openDeepReviewConfirm(); break;
      case "deepgo": closeForm(); runCorrelationDeep(); break;
      case "deepedit": closeForm(); openFindingPicker(); break;
      case "corrext": openEvidenceLookup(); break;
      case "imghide": { var _ih = imgById(decodeURIComponent(arg)); if (_ih) _ih.hidden = !_ih.hidden; paint(); break; }
      case "win": _trendWin = isNaN(+arg) ? _trendWin : +arg; paint(); break;   // 0 = All (no window)
      case "round": { var rc = _raw.rounds[arg] || {}; STATE.rounds[arg] = { done: !rc.done, note: rc.note || "" }; break; }
      case "roundnote": openRoundNote(arg); break;
      case "roundmic": roundNoteDictate(arg); break;
      case "saveroundnote": saveRoundNote(arg); break;
      case "proto": _openProto[arg] = !_openProto[arg]; paint(); break;
      case "drug": launch(function () { if (!window.INF) return; (INF.openDrug ? INF.openDrug(arg) : INF.open()); infWeightBridge(); installInfBridge(); }, "infOverlay"); break;
      case "infdupupd": if (_infDup) { ingestInfusion(Object.assign({}, _infDup.rec, { replaceIndex: _infDup.idx })); if (window.toast) toast(_infDup.rec.drug + " updated."); _infDup = null; } closeForm(); paint(); break;
      case "infdupsep": if (_infDup) { ingestInfusion(_infDup.rec); if (window.toast) toast(_infDup.rec.drug + " added as a separate line."); _infDup = null; } closeForm(); paint(); break;
      // ---- Current Treatment (editable; any doctor add/remove; group changes → timeline) ----
      case "txadd": _txDraft = { name: "", dose: "", route: "", freq: "", cat: "other" }; _txHits = []; openTxForm(); break;
      case "txcat": txSyncInputs(); if (_txDraft) _txDraft.cat = arg; openTxForm(); break;
      case "txfreq": txSyncInputs(); if (_txDraft) _txDraft.freq = (_txDraft.freq === arg ? "" : arg); openTxForm(); break;
      case "txpick": { var _th = _txHits[+arg]; if (_th && _txDraft) { txSyncInputs(); _txDraft.name = _th.name; _txDraft.cat = _th.cat || _txDraft.cat; var _tp = txParseDose(_th.dose); if (!_txDraft.dose && _tp.dose) _txDraft.dose = _tp.dose; if (!_txDraft.route && _tp.route) _txDraft.route = _tp.route; if (!_txDraft.freq && _tp.freq) _txDraft.freq = _tp.freq; openTxForm(); } break; }
      case "txsave": txSave(); break;
      case "txdel": txDelete(decodeURIComponent(arg)); break;
      case "gensummary": openSummary(); break;
      case "copysummary": copySummary(); break;
      case "edit": openForm(arg); break;
      case "ai": openForm(arg); break;            // "Coming soon" → manual entry fallback for now
      case "adddata": openDataMenu(); break;
      case "coach": _coachForce = true; paint(); break;
      case "dxtour": startTour(); break;
      case "coachdone": setIcuSeen(); _coachForce = false; paint(); break;
      case "tip": showTip(arg); break;
      case "voice": if (modalEl) modalEl.classList.remove("on"); if (window.SMD_VOICE && SMD_VOICE.openDialog) SMD_VOICE.openDialog({ target: "icu" }); else alert("Voice intake is loading — try again in a moment."); break;
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
      case "dischargept": dischargePatient(); break;         // solo: confirm-first discharge/remove of the current patient
      case "dischargeptgo": dischargePatientGo(); break;
      case "grprmpt": grpRemovePatient(); break;             // group: remove the shared patient doc (canInstruct)
      case "sharept": sharePatient(arg); break;
      case "sharecase": shareCase(); break;
      case "phiexportgo": { var _pe = _phiPending; _phiPending = null; closeForm(); if (_pe) _pe(); break; }   // KI-H6: confirmed PHI export
      case "clearfindings": openClearConfirm(); break;
      case "clearconfirm": clearFindings(); break;
      case "newpt": newPatient(); break;
      case "lyte": _lytesExp[arg] = !_lytesExp[arg]; paint(); break;
      case "save": _admitting = false; saveForm(arg); break;
      case "closeform": {
        var _wasAdmit = _admitting; _admitting = false;
        closeForm();
        // Cancelling an Admit with nothing entered = abandoned admit → go BACK to the unit board,
        // not left stranded on a blank patient workspace. (A real edit / saved patient has data → stay.)
        if (_wasAdmit && !hasData()) { if (grpActive()) { try { grpTeardownPatient(); } catch (e) {} } _screen = "board"; _active = "overview"; _ws = "overview"; _paintTop = true; paint(); }
        break;
      }
      case "snapshot": openSnapshot(); break;
      case "launch":
        if (arg === "elyte") launch(function () {
          if (!window.ELYTE) return;
          var p = _raw.patient || {}, L = _raw.labs.recent || {};
          var pt = {}; if (p.weightKg != null) pt.weight = p.weightKg; if (p.age != null) pt.age = p.age; if (p.sex) pt.sex = String(p.sex).toLowerCase() === "f" ? "f" : "m"; if (p.diagnosis) pt.dx = p.diagnosis;
          var labs = {}; ["na", "k", "cl", "hco3", "ca", "mg", "po4", "glu", "creat", "alb", "egfr", "urea"].forEach(function (k) { if (L[k] != null && L[k] !== "") labs[k] = L[k]; });
          ELYTE.open((Object.keys(labs).length || Object.keys(pt).length) ? { labs: labs, pt: pt } : undefined);
        }, "eceOverlay");
        else if (arg === "inf") launch(function () { if (!window.INF) return; INF.open(); infWeightBridge(); installInfBridge(); }, "infOverlay");
        else if (arg === "protocols") launch(function () { if (!window.INF) return; (INF.openProtocols ? INF.openProtocols() : INF.open()); infWeightBridge(); installInfBridge(); }, "infOverlay");
        else if (arg === "interactions") launch(function () { window.MEDDRUGS && window.MEDDRUGS.openInteractions && window.MEDDRUGS.openInteractions(); }, "miOverlay");
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

  /* ===== Infusion bridge (BUG E) + universal weight (BUG F) ===================================
   * The vasopressor/pump calculator (INF) lives in the frozen minified app.js and writes only to
   * its own legacy store — never to STATE.infusions. We (a) expose ICU.ingestInfusion, (b) seed the
   * calculator's weight from the canonical patient weight on open, and (c) wrap INF._dashAddCurrent
   * so "Add to ICU Dashboard" mirrors the infusion into the ICU workstation. No app.js edit. */
  function ingestInfusion(o) {
    if (!o || !o.drug) return false;
    var rec = { drug: o.drug, dose: (o.dose != null ? o.dose : null), unit: o.unit || "", rateMlHr: (o.rateMlHr != null ? o.rateMlHr : null), concentration: o.concentration || "", indication: o.indication || "", weightKg: (o.weightKg != null ? o.weightKg : null), source: o.source || "manual", startedAt: o.startedAt || nowTs() };
    var list = STATE.infusions || [], idx = -1;
    if (o.replaceIndex != null && list[o.replaceIndex]) idx = o.replaceIndex;
    if (idx >= 0) STATE.infusions[idx] = rec; else STATE.infusions.push(rec);   // Proxy auto-persists + repaints
    return true;
  }

  /* ------------------------------------------------- Current Treatment (editable) ----
   * ICU_STATE.treatment is an editable list any doctor can add to / remove from. It auto-persists
   * (solo roster) and auto-mirrors to the shared patient doc (whole team). Group add/remove is also
   * written to the shared timeline. Drug names + doses come from the Drug Index (window.MEDDRUGS)
   * the prescription pad uses, or the clinician's own free text. */
  function txSearchDrugs(q) {
    q = String(q || "").trim().toLowerCase(); if (q.length < 2) return [];
    var list = (window.MEDDRUGS && MEDDRUGS._list) || [], out = [];
    for (var i = 0; i < list.length && out.length < 7; i++) {
      var d = list[i]; if (!d || !d.generic) continue;
      var g = String(d.generic).toLowerCase(), cls = String(d.cls || "").toLowerCase();
      if (g.indexOf(q) >= 0 || cls.indexOf(q) >= 0 || (d.brands || []).some(function (b) { return String(b).toLowerCase().indexOf(q) >= 0; }))
        out.push({ name: d.generic, dose: d.dose || "", cls: d.cls || "", cat: txGuessCat(d) });
    }
    return out;
  }
  function txGuessCat(d) {
    var s = ((d.cat || "") + " " + (d.cls || "") + " " + (d.generic || "")).toLowerCase();
    if (/antibiot|antimicrob|penicillin|cephalosporin|carbapenem|glycopeptide|macrolide|quinolone|fluoroquinolone|aminoglycoside|antifungal|antiviral|nitroimidazole|metronidazole|linezolid|colistin/.test(s)) return "abx";
    if (/fluid|saline|crystalloid|ringer|dextrose|colloid|\balbumin\b|\bns\b|\brl\b/.test(s)) return "fluid";
    return "supp";
  }
  // Light heuristic split of a Drug-Index dose string ("40 mg IV/PO once daily") into dose/route/freq.
  function txParseDose(str) {
    str = String(str || ""); var o = { dose: "", route: "", freq: "" };
    var rt = str.match(/\b(IV|PO|SC|IM|NG|PR|SL|neb|inhaled)\b/i); if (rt) o.route = rt[1].toUpperCase();
    var ds = str.match(/(\d[\d.–—\-]*\s*(?:mcg|µg|mg|g|mL|ml|units?|IU)\b)/i); if (ds) o.dose = ds[1].replace(/\s+/g, " ").trim();
    if (/\bonce (?:a )?daily\b|\bOD\b|\bq24\s?h?\b/i.test(str)) o.freq = "OD";
    else if (/\btwice\b|\bBD\b|\bq12\s?h?\b/i.test(str)) o.freq = "BD";
    else if (/\bthrice\b|three times\b|\bTDS\b|\bq8\s?h?\b|every 8\s?h/i.test(str)) o.freq = "TDS";
    else if (/four times\b|\bQID\b|\bq6\s?h?\b|every 6\s?h/i.test(str)) o.freq = "q6h";
    return o;
  }
  function txAuthorName() {
    var nm = v2AccountName();
    if (grpActive() && _grp && _grp.myRole) return nm + " (" + grpRoleLabel(_grp.myRole) + ")";
    return nm;
  }
  function txLogTimeline(action, item) {
    if (!grpActive() || !_grpPtId) return;
    var api = groupsApi(); if (!api || !api.addTimelineEvent) return;
    var dsg = [item.dose, item.route, item.freq].filter(Boolean).join(" ");
    var title = (action === "add" ? "Treatment added: " : "Treatment stopped: ") + item.name;
    var detail = (dsg ? dsg + " · " : "") + txCatLabel(item.cat);
    try { api.addTimelineEvent(_grp.id, _grpPtId, { type: "treatment", title: title, detail: detail }).then(null, function () {}); } catch (e) {}
  }
  function txChip(act, label, on, dotColor) {
    return '<button class="icu-chip" data-icu-act="' + act + '" style="margin:0 6px 6px 0;' +
      (on ? "border-color:var(--primary);background:var(--primary-soft);color:var(--primary)" : "") + '">' +
      (dotColor ? '<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:' + dotColor + '"></span>' : "") + esc(label) + '</button>';
  }
  function openTxForm() {
    ensureModal();
    var d = _txDraft || (_txDraft = { name: "", dose: "", route: "", freq: "", cat: "other" });
    var freqChips = TX_FREQS.map(function (f) { return txChip("txfreq:" + f, f, d.freq === f, null); }).join("");
    var catChips = TX_CATS.map(function (c) { return txChip("txcat:" + c.k, c.label, d.cat === c.k, c.color); }).join("");
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("syringe", "💊") + ' Add treatment</h3>' +
      '<div class="icu-fld" style="grid-column:1/-1"><label for="txq">Drug — search the database or type your own</label>' +
      '<input id="txq" autocomplete="off" placeholder="e.g. Ceftriaxone · Normal Saline · chest physio" value="' + esc(d.name) + '"></div>' +
      '<div id="txsug" style="margin:-4px 0 6px"></div>' +
      '<div class="icu-grid2">' +
        '<div class="icu-fld"><label for="txdose">Dose</label><input id="txdose" autocomplete="off" placeholder="e.g. 1 g" value="' + esc(d.dose) + '"></div>' +
        '<div class="icu-fld"><label for="txroute">Route</label><input id="txroute" autocomplete="off" placeholder="IV / PO / SC" value="' + esc(d.route) + '"></div>' +
      '</div>' +
      '<div class="icu-fld" style="grid-column:1/-1"><label>Frequency</label><div style="display:flex;flex-wrap:wrap">' + freqChips + '</div></div>' +
      '<div class="icu-fld" style="grid-column:1/-1"><label>Category</label><div style="display:flex;flex-wrap:wrap">' + catChips + '</div></div>' +
      '<button class="icu-btn" data-icu-act="txsave">Add to treatment</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Cancel</button></div>';
    modalEl.classList.add("on");
    var q = modalEl.querySelector("#txq");
    if (q) { q.oninput = function () { if (_txDraft) _txDraft.name = this.value; txRenderSug(this.value); }; txRenderSug(d.name); setTimeout(function () { try { q.focus(); } catch (e) {} }, 40); }
  }
  function txRenderSug(q) {
    var box = modalEl && modalEl.querySelector("#txsug"); if (!box) return;
    _txHits = txSearchDrugs(q);
    if (!_txHits.length) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="icu-card" style="padding:2px 0;margin:0">' + _txHits.map(function (h, i) {
      var col = "var(--muted)"; for (var j = 0; j < TX_CATS.length; j++) if (TX_CATS[j].k === h.cat) col = TX_CATS[j].color;
      return '<button data-icu-act="txpick:' + i + '" style="width:100%;text-align:left;background:none;border:none;border-bottom:1px solid var(--border);padding:9px 12px;cursor:pointer;color:var(--ink)">' +
        '<span style="float:right;font:700 9.5px var(--font);color:#fff;background:' + col + ';border-radius:6px;padding:2px 6px">' + esc(txCatLabel(h.cat)) + '</span>' +
        '<div style="font:700 13.5px var(--font)">' + esc(h.name) + '</div>' +
        (h.cls ? '<div style="font:600 11px var(--font);color:var(--muted)">' + esc(h.cls) + (h.dose ? " · " + esc(h.dose) : "") + '</div>' : "") + '</button>';
    }).join("") + '</div>';
  }
  function txSyncInputs() {
    if (!modalEl || !_txDraft) return;
    var q = modalEl.querySelector("#txq"), dz = modalEl.querySelector("#txdose"), rt = modalEl.querySelector("#txroute");
    if (q) _txDraft.name = q.value; if (dz) _txDraft.dose = dz.value; if (rt) _txDraft.route = rt.value;
  }
  function txSave() {
    txSyncInputs();
    var d = _txDraft || {}, name = String(d.name || "").trim();
    if (name.length < 2) { if (window.toast) toast("Enter a drug or treatment name"); return; }
    var item = { id: "tx_" + nowTs() + "_" + Math.floor(Math.random() * 1e6), name: name,
      dose: String(d.dose || "").trim(), route: String(d.route || "").trim(), freq: d.freq || "",
      cat: d.cat || "other", by: txAuthorName(), ts: nowTs() };
    STATE.treatment = (_raw.treatment || []).concat([item]);   // reassign → reactive persist + group mirror
    txLogTimeline("add", item);
    _txDraft = null; _txHits = [];
    closeForm();
    _active = "treatment"; _ws = wsOf("treatment"); _wsLast[_ws] = "treatment"; paint();
    if (window.toast) toast("Added to treatment" + (grpActive() ? " · logged to timeline" : ""));
  }
  function txDelete(id) {
    var list = _raw.treatment || [], item = null;
    for (var i = 0; i < list.length; i++) if (String(list[i].id) === String(id)) { item = list[i]; break; }
    if (!item) return;
    STATE.treatment = list.filter(function (x) { return String(x.id) !== String(id); });
    txLogTimeline("del", item);
    paint();
    if (window.toast) toast("Removed" + (grpActive() ? " · logged to timeline" : ""));
  }
  // Seed the frozen calculator's weight from the canonical patient weight (BUG F). Runs AFTER
  // INF.openDrug so the calc's own `a.weight||=70` default cannot clobber it.
  function infWeightBridge() {
    try {
      var w = (STATE.patient || {}).weightKg;
      if (w != null && w !== "" && !isNaN(+w) && window.INF && typeof INF._d === "function") { INF._d("wt", +w); if (window.toast) toast("Using patient weight: " + (+w) + " kg"); }
    } catch (e) {}
  }
  var _infBridged = false, _infDup = null;
  function installInfBridge() {
    if (_infBridged || !window.INF || typeof INF._dashAddCurrent !== "function") return;
    _infBridged = true;
    var orig = INF._dashAddCurrent;
    INF._dashAddCurrent = function () {
      var r; try { r = orig.apply(this, arguments); } catch (e) { r = null; }
      try {
        var dash = JSON.parse(localStorage.getItem("smd_icu_dashboard_v1") || "{}"), arr = (dash && dash.infusions) || [], last = arr[arr.length - 1];
        if (last && last.key) bridgeInfusionFromCalc(last); else if (window.toast) toast("Couldn’t read the calculator result — add the infusion manually.");
      } catch (e) { if (window.toast) toast("Couldn’t add to ICU dashboard — retry, or add manually."); }
      return r;
    };
  }
  // Reconstruct a full infusion record from the legacy {key,dose} + INFUSION_DRUGS meta + patient weight.
  function bridgeInfusionFromCalc(last) {
    var meta = (window.INFUSION_DRUGS || {})[last.key] || {}, wt = (STATE.patient || {}).weightKg;
    var dose = last.dose, unit = meta.doseUnit || "", prep = meta.prep || {};
    var concMcg = (prep.amt && prep.vol) ? (prep.amt * (prep.unit === "mg" ? 1000 : prep.unit === "g" ? 1e6 : 1) / prep.vol) : null;
    var concStr = (prep.amt && prep.vol) ? (prep.amt + " " + (prep.unit || "mg") + " / " + prep.vol + " mL") : "";
    var rate = null;   // compute ONLY for the unambiguous weight-based / per-minute microgram cases
    if (concMcg && dose != null) {
      if (unit === "mcg/kg/min" && wt != null) rate = +(dose * (+wt) * 60 / concMcg).toFixed(1);
      else if (unit === "mcg/min") rate = +(dose * 60 / concMcg).toFixed(1);
    }
    bridgeInfusion({ drug: String(meta.name || last.key).split(" (")[0], dose: dose, unit: unit, rateMlHr: rate, concentration: concStr, weightKg: (unit.indexOf("/kg/") >= 0 ? (wt != null ? +wt : null) : null), source: "calculator", startedAt: nowTs() });
  }
  function bridgeInfusion(rec) {
    var list = STATE.infusions || [], idx = -1;
    for (var i = 0; i < list.length; i++) if (String(list[i].drug).toLowerCase() === String(rec.drug).toLowerCase()) { idx = i; break; }
    if (idx < 0) { ingestInfusion(rec); if (window.toast) toast(rec.drug + " added to ICU dashboard."); paint(); return; }
    _infDup = { rec: rec, idx: idx }; openInfDupConfirm(rec.drug);   // same drug already on the dashboard → ask (prevents silent dupes)
  }
  function openInfDupConfirm(name) {
    ensureModal();
    modalEl.innerHTML = '<div class="icu-sheet" role="dialog" aria-label="Infusion already on dashboard"><h3>' + ico("warn", "💉") + " Already on the dashboard</h3>" +
      '<p class="icu-doc-sub">' + esc(name) + " is already recorded in ICU Infusions. Update it with the new rate, or add it as a separate line?</p>" +
      '<button class="icu-btn" data-icu-act="infdupupd">Update existing</button>' +
      '<button class="icu-btn ghost" data-icu-act="infdupsep" style="margin-top:8px">Add as separate</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform" style="margin-top:8px">Cancel</button></div>';
    modalEl.classList.add("on");
  }

  /* ------------------------------------------------------------- controller */
  var ICU = {
    open: function (target, ward) {
      injectCSS();
      // Context switch (ICU ↔ Ward): each category has a SEPARATE patient namespace, so swap the live
      // buffer + land on the board (restoring the last unit type of that category). No-op if unchanged.
      var wantCat = ward ? "ward" : "icu";
      if ((_unit.cat || "icu") !== wantCat) selectUnit({ cat: wantCat, type: _lastType[wantCat] });
      if (!rootEl) {
        rootEl = document.createElement("div"); rootEl.id = "icuRoot";
        document.body.appendChild(rootEl);
        rootEl.addEventListener("click", onClick);
        // Phase 4: reflect connectivity promptly (offline strip + sync indicator) — repaint only
        // when a shared unit is open. Attached once; a no-op while the dashboard is closed.
        try {
          var _onNet = function () { if (ICU.isOpen() && grpActive()) paint(); };
          window.addEventListener("online", _onNet);
          window.addEventListener("offline", _onNet);
        } catch (e) {}
      }
      rootEl.classList.toggle("icu-v2", icuV2On());   // v2 (smd_icu_v2) chrome is gated on this class
      if (groupMode()) { try { grpEnsureGroupsSub(); } catch (e) {} }   // Phase 2: start the live unit subscription
      // BUG #14: an optional sub-tab id opens the dashboard directly on that workspace —
      // the syringe FAB opens Infusions (its actual purpose), distinct from the Home
      // "ICU" tile which opens Overview. No argument = unchanged (open at current tab).
      if (target && typeof target === "string" && RENDER[target]) { _active = target; _ws = wsOf(target); }
      // v2: a target tab (syringe FAB / Home tile) opens the patient workspace on that tab;
      // a plain open lands on the unit board (the front door).
      if (icuV2On()) _screen = (target && typeof target === "string" && RENDER[target]) ? "patient" : "board";
      paint();
      rootEl.classList.add("on");
      document.body.style.overflow = "hidden";
    },
    // My Ward — the SAME dashboard tuned for ward patients (ventilator tab hidden, "Ward" labels,
    // separate solo namespace). Opened from the Ward Sync tab. Reuses every engine + the Treatment
    // tab + deep review + imaging + discharge + (group) instructions.
    openWard: function (target) { return ICU.open(target, true); },
    // Unit picker — hospital → ICU/Ward category → unit type. The full navigation entry (e.g. Ward Sync).
    openUnits: function () { ICU.open(undefined, _unit.cat === "ward"); _screen = "units"; _pickStep = _unit.hospital ? "category" : "hospital"; _pickCat = null; _paintTop = true; paint(); },
    curUnit: function () { return { cat: _unit.cat, type: _unit.type, hospital: _unit.hospital }; },
    // Resume-where-you-left-off (home.js snapshots this on background; replays it on the next launch).
    // curView captures the exact screen + sub-tab (+ open shared-patient id); resume reopens ICU in the
    // SAME unit category (no switch) and resumeView navigates to that exact view.
    curView: function () { return { screen: _screen, active: _active, ptId: _grpPtId || null }; },
    resumeView: function (v) {
      try {
        if (!v) return;
        if (v.screen === "patient") {
          if (grpActive() && v.ptId) {
            try { grpOpenPatient(v.ptId); } catch (e) {}
            if (v.active && RENDER[v.active]) setTimeout(function () { try { if (_screen === "patient") { _active = v.active; _ws = wsOf(v.active); _wsLast[_ws] = v.active; paint(); } } catch (e) {} }, 500);
          } else if (v.active && RENDER[v.active]) {
            _screen = "patient"; _active = v.active; _ws = wsOf(v.active); _wsLast[_ws] = v.active; _paintTop = true; paint();
          }
        } else if (v.screen === "alerts" || v.screen === "team") {
          _screen = v.screen; _paintTop = true; paint();
        }
      } catch (e) {}
    },
    resume: function (view) {
      ICU.open(undefined, _unit.cat === "ward");   // reopen in the SAME unit category (no switch), on the board
      if (view) { try { ICU.resumeView(view); } catch (e) {} }
    },
    // Deep link → join a unit. A Universal/App Link (…?icujoin=gid.code, or /i/gid.code) opens the
    // native app; the URL arrives NATIVELY (not in this WebView's location), so native-bridge.js
    // forwards it here. An invite implies shared units → turn Group mode on, stash the code, and run
    // the same confirm-then-join flow the web uses. Returns true if the URL carried an invite.
    handleJoinUrl: function (url) {
      try {
        var s = String(url || "");
        var m = s.match(/[?&]icujoin=([^&#]+)/) || s.match(/\/i\/([^/?#]+)/);
        if (!m || !m[1]) return false;
        try { if (localStorage.getItem("smd_icu_groups") !== "1") localStorage.setItem("smd_icu_groups", "1"); } catch (e) {}
        _grpJoinPending = m[1];
        try { window.SMD_loadFirebase && window.SMD_loadFirebase(); } catch (e) {}
        setTimeout(function () { try { grpBootJoin(); } catch (e) {} }, 60);
        return true;
      } catch (e) { return false; }
    },
    close: function () { if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; try { grpTeardownPatient(); } catch (e) {} },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    isWard: function () { return !!_wardMode; },
    // Drug Interactions entry point — delegates to drugs.js's window.MEDDRUGS.openInteractions,
    // the single shared MEDLIST overlay (Task 5/6), same as the "launch:interactions" action.
    openInteractions: function () { if (window.MEDDRUGS && window.MEDDRUGS.openInteractions) window.MEDDRUGS.openInteractions(); },
    // public data API (manual entry + future Vision share these)
    state: function () { return STATE; },
    update: function (patch) { if (patch && typeof patch === "object") Object.keys(patch).forEach(function (k) { STATE[k] = patch[k]; }); },
    subscribe: function (fn) { if (typeof fn === "function") { _subs.push(fn); return function () { var i = _subs.indexOf(fn); if (i >= 0) _subs.splice(i, 1); }; } },
    recompute: function () { onChange(); },
    reset: function () { resetState(); },
    ingestMonitor: ingestMonitor, ingestLabs: ingestLabs, ingestVentilator: ingestVentilator, ingestFlowsheet: ingestFlowsheet, ingestPatient: ingestPatient,
    ingestInfusion: ingestInfusion, _bridgeInfusion: bridgeInfusion, _bridgeInfusionFromCalc: bridgeInfusionFromCalc, _installInfBridge: installInfBridge, _infWeightBridge: infWeightBridge,
    ingestFromWard: ingestFromWard, ingestWardHistory: ingestWardHistory, parseWardDate: parseWardDate, mapWardLab: mapWardLab, _compressImage: compressImage, startImport: startImport, _review: openImportReview, reviewVoice: reviewVoice,
    ingestImaging: ingestImaging, ingestWardImaging: ingestWardImaging, imagingOn: icuImagingOn, _imgModality: imgModality, _imgCritical: imgCritical, _parseImaging: parseImagingSections,
    _buildImagingAiPacket: buildImagingAiPacket, _imagingDeterministic: imagingDeterministic,
    openFindingPicker: openFindingPicker, _addFindingChip: addFindingChip, _applyFindState: applyFindState, _findStateOf: findStateOf, _vocabNlpCtx: vocabNlpCtx,
    _correlationEvidence: correlationEvidence, _runQuickCorrelation: runQuickCorrelation, _buildCorrelationPacket: buildCorrelationPacket, _correlationTopic: correlationTopic, extEvidenceOn: extEvidenceOn,
    _buildClinicalContext: buildClinicalContext, _correlationHash: correlationHash, _latestVitalsSummary: latestVitalsSummary, dxFlowOn: icuDxFlowOn,
    _runWorkingDx: runWorkingDx, _pickWorkingDx: pickWorkingDx, _dxFindingKeys: dxFindingKeys,
    _openDeepReviewConfirm: openDeepReviewConfirm, _deepReviewUsable: deepReviewUsable, _deepReviewItems: deepReviewItems,
    _startTour: startTour, _tourShouldShow: tourShouldShow, _tourState: tourState, _tourKey: tourKey, _tourSteps: TOUR_STEPS,
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
    shareCase: shareCase, clearFindings: clearFindings, summary: buildSummary,
    // Lab Watch (Phase 1, in-app) + Discharge Creator
    labWatchOn: labWatchOn, openLabWatch: openLabWatch, _lwScan: lwScan, _lwGet: lwGet, _lwSet: lwSet, _lwActive: lwActive,
    _lwBadge: function () { return _lwBadge; },
    _lwStartWith: function (cfg) { cfg = cfg || {}; _lwDraft = { analytes: (cfg.analytes || []).slice(), mode: cfg.mode || "meaningful", dur: cfg.dur != null ? cfg.dur : 12, delivery: "inapp", q: "" }; lwStart(); return lwGet(); },
    buildDischarge: function (st) { _dischargeDefaults = dischargeDefaults(st); return assembleDischarge(_dischargeDefaults); }, openDischarge: openDischarge,
    // KI-M3 test seams (per-account live-buffer scoping)
    _bufKey: bufKey, _reconcileOwner: reconcileOwner, _loadOwnerBuffer: loadOwnerBuffer, _resetBufSync: function () { _ownerBufSynced = false; },
    // Phase 3 pure-transform test seams (deterministic, DOM-free): round-note→plan, auto-timeline
    // diff, notification derive + unread-count.
    _grpRoundPlan: grpRoundPlan, _grpDiffEvents: grpDiffEvents, _grpChangeSummary: grpChangeSummary,
    _grpDeriveNotifs: grpDeriveNotifs, _grpUnreadCount: grpUnreadCount
  };
  window.ICU = ICU;

  // KI-M3 backstop: on app resume (a shared ward device may have been handed over + re-authed
  // while backgrounded), re-check the owner. reconcileOwner only wipes/reloads if the owner
  // actually CHANGED — a same-owner resume is a no-op, so no in-session work is ever lost.
  try { document.addEventListener("visibilitychange", function () { if (!document.hidden) { try { reconcileOwner(); } catch (e) {} } }); } catch (e) {}

  // re-render the open dashboard whenever the state changes (any source)
  _subs.push(function () { if (ICU.isOpen()) paint(); });

  // Task-deadline heartbeat: while a shared patient is open, re-check every 60s so due countdowns
  // tick, tasks flip to OVERDUE on time, and the overdue device-notification fires even when the unit
  // is otherwise idle. Fully guarded (no-op unless in group mode with a patient open + ICU visible).
  try {
    setInterval(function () {
      try {
        if (!grpActive() || !_grpPtId || !ICU.isOpen()) return;
        grpNotifTick();
        if (_screen === "patient" && (_active === "rounds" || _active === "overview")) paint();
        else if (_screen === "alerts") paint();
      } catch (e) {}
    }, 60000);
  } catch (e) {}

  // Group mode (Phase 2): mirror the open shared patient's ICU_STATE → Firestore on change
  // (debounced). Echo-suppressed via the state hash so a remote snapshot we just applied never
  // bounces back. Engine-scored source tags (ICU_STATE.src) are carried through by upsertPatient;
  // only DERIVED alerts are stripped. Inert unless a shared patient is open in group mode.
  _subs.push(function () {
    // NOTE: intentionally NOT gated on _screen. _grpPtId being set ⇒ STATE holds that patient's
    // data, and grpTeardownPatient() clears _grpPtId on every "leave patient" path — so the mirror
    // can never fire for a board/foreign context. Gating on _screen === "patient" used to DROP a
    // Ward-Sync fill: ghis-ward.js calls ICU.open() right after ingest, flipping _screen to "board"
    // synchronously before the async reactive notify() reached this subscriber → the sync was lost
    // and only grpAdmit's blank doc survived. (Paired with ghis-ward.js: ICU.open('overview').)
    if (!grpActive() || !_grpPtId || !ICU.isOpen()) return;
    if (grpStateHash(_raw) === _grpLastHash) return;             // unchanged vs last synced → no write
    if (_grpMirrorT) { try { clearTimeout(_grpMirrorT); } catch (e) {} }
    _grpMirrorT = setTimeout(function () {
      _grpMirrorT = null;
      var h = grpStateHash(_raw); if (h === _grpLastHash) return;
      _grpLastHash = h;
      // Phase 3: derive the author-stamped audit events for this coalesced burst (the debounce is the
      // de-dupe window; a remote echo never reaches here because grpApplyState re-baselines the hash).
      var nextPayload = grpMirrorPayload(_raw);
      var events = (_grpPrevSync != null) ? grpDiffEvents(_grpPrevSync, nextPayload) : [];
      _grpPrevSync = nextPayload;
      var luText = grpChangeSummary(events);   // richer "what changed" line for the board footer + notifications
      try {
        var api = groupsApi();
        if (api && api.upsertPatient) api.upsertPatient(_grp.id, _grpPtId, _raw, luText).then(function () { _grpErr = null; }, function (e) { _grpErr = grpErrText(e); if (ICU.isOpen()) paint(); });
        if (api && api.addTimelineEvent) {
          for (var i = 0; i < events.length; i++) {
            (function (ev) { try { var pr = api.addTimelineEvent(_grp.id, _grpPtId, ev); if (pr && pr.then) pr.then(null, function () {}); } catch (e) {} })(events[i]);
          }
        }
      } catch (e) {}
    }, 1500);
  });

  // Per-account on-device isolation: attach to Firebase auth once it's loaded so
  // sign-in / sign-out / account-switch re-point the roster and clear a previous
  // account's working buffer. Firebase is lazy-loaded, so keep trying until ready.
  (function watchAuth() {
    var tries = 0;
    function attach() {
      try {
        var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
        if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { reconcileOwner(); try { grpBootJoin(); } catch (e) {} }); return true; }
      } catch (e) {}
      return false;
    }
    if (attach()) return;
    var iv = setInterval(function () { if (attach() || ++tries > 60) clearInterval(iv); }, 500);
  })();
  // Phase 5: process a ?icujoin=<gid>.<code> invite link on boot (flag-gated — a no-op when
  // smd_icu_groups is off). If a link is present, nudge Firebase to load so auth resolves and the
  // auth watcher above re-runs grpBootJoin once signed in. Delayed so groupsApi()/toast exist.
  (function () {
    try {
      if (!icuGroupsOn() || !grpJoinParam()) return;
      try { window.SMD_loadFirebase && window.SMD_loadFirebase(); } catch (e) {}
      setTimeout(function () { try { grpBootJoin(); } catch (e) {} }, 800);
    } catch (e) {}
  })();
  // Opening the dashboard nudges Firebase to load so auth (and thus the correct
  // per-account roster) resolves promptly instead of waiting for idle.
  (function () {
    var _open = ICU.open;
    ICU.open = function () { try { window.SMD_loadFirebase && window.SMD_loadFirebase(); } catch (e) {} return _open.apply(ICU, arguments); };
  })();
})();
