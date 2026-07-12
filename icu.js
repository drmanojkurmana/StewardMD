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
    vitals: [],                 // [{ ts, hr, sbp, dbp, map, rr, spo2, temp, uop, lactate, cvp, etco2 }]
    labs: { recent: {}, trends: [] },  // recent: { na,k,cl,hco3,ca,mg,po4,glu,creat,alb,wbc,hb,plt,inr,ferritin,trig,fibrinogen,... }
    abg: {},                    // { ts, ph, paco2, pao2, hco3, fio2, lactate, be }
    ventilator: {},             // { mode, fio2, peep, tv, rr, peak, plateau, drivingP, compliance, pf }
    fluids: { intake24h: null, output24h: null, urine24h: null, drains: null, net24h: null, cumulative: null, strategyPhase: "" },
    infusions: [],              // [{ drug, dose, unit, rateMlHr, indication }]
    imaging: [],                // [{ id, ts, modality, category, studyName, bodyRegion, indication, findingsRaw, impressionRaw, reportRaw, keyPos[], keyNeg[], critical[], parsed, comment, source, reportId, reportDateTime, radiologist, reviewed, inSummary, hidden, importedAt }] — Ward Sync radiology + manual imaging notes (sibling of labs/vitals; NOT scored by any engine)
    findings: [],               // [{ canonicalFindingId(engine id | note:*), displayLabel, polarity:present|absent|possible, temporality:current|historical|resolved, source, clinicianConfirmed, inReasoning, at }] — structured clinician-picked findings (documentation; NOT fed to scoring)
    goals: [],                  // [string]
    rounds: {},                 // checklist state (Phase 3)
    alerts: [],                 // DERIVED — written by recompute()
    src: {},                    // per-field provenance: { <field>: { source, ts } } source ∈ Ward Sync|Imported report|Manual
    wardSync: { connected: false, lastTs: null, newUpdate: false, patientId: null },
    conflicts: [],              // [{ key, label, ward, manual, wardTs, manualTs }] — clinician resolves
    meta: { updated: null }
  };
  var LS_KEY = "stewardmd_icu_state";                       // legacy (unscoped) key — migrated once
  // KI-M3: the live working buffer is PHI (name/bed/labs/imaging). Scope it PER signed-in
  // account (like the roster) so two clinicians sharing one physical device can never read each
  // other's open patient — isolation no longer depends on the auth-reset firing. ownerNow() is a
  // hoisted function; at first load it is "anon" until Firebase resolves, then reconcileOwner()
  // syncs the buffer to the resolved owner exactly once.
  function bufKey(owner) { return LS_KEY + ":" + (owner || ownerNow()); }

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
      '.icu-tabs{position:absolute;left:0;right:0;bottom:0;display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;background:color-mix(in srgb,var(--panel) 88%,transparent);-webkit-backdrop-filter:saturate(1.4) blur(12px);backdrop-filter:saturate(1.4) blur(12px);border-top:1px solid var(--border);padding:5px 6px calc(5px + env(safe-area-inset-bottom));z-index:5}' +
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
      '.icu-find-chip .fc-mod,.icu-find-chip .fc-x{border:none;background:none;cursor:pointer;color:inherit;font:800 15px var(--font);line-height:1;padding:2px 6px;border-radius:50%;opacity:.75}.icu-find-chip .fc-mod:active,.icu-find-chip .fc-x:active{opacity:1;background:color-mix(in srgb,currentColor 15%,transparent)}';
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
  function lwOpenAnalyte(k) { _lwHighlight = k; _lwBadge = 0; closeForm(); _active = "trends"; _ws = wsOf("trends"); _wsLast[_ws] = "trends"; paint(); setTimeout(function () { try { var el = rootEl && rootEl.querySelector('.icu-tr-card.lw-hi'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {} }, 60); }
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
    { id: "monitoring", label: "Monitoring", svg: "heart", members: ["trends", "hemo", "fluids", "lytes", "abg", "vent", "infusions"] },
    { id: "careplan", label: "Care Plan", svg: "rounds", members: ["dx", "protocols", "goals"] },
    { id: "documents", label: "Documents", svg: "copy", members: ["documents", "imaging"] },
    { id: "more", label: "More", svg: "more", members: ["more"] }
  ];
  var MEMBER = {}; TABS.forEach(function (t) { MEMBER[t.id] = { label: t.label, svg: t.svg, ic: t.ic }; });
  MEMBER.dx = { label: "Diagnosis", svg: "search", ic: "🩺" };
  MEMBER.imaging = { label: "Imaging", svg: "camera", ic: "🩻" };
  function wsOf(m) { for (var i = 0; i < WORKSPACES.length; i++) if (WORKSPACES[i].members.indexOf(m) >= 0) return WORKSPACES[i].id; return "overview"; }
  function wsById(id) { for (var i = 0; i < WORKSPACES.length; i++) if (WORKSPACES[i].id === id) return WORKSPACES[i]; return WORKSPACES[0]; }
  // Workspace members visible under the current feature flags (Imaging is flag-gated,
  // so the kill-switch hides it from the sub-nav instantly — no reload).
  function wsMembers(w) { return (w && w.members || []).filter(function (m) { return m === "imaging" ? icuImagingOn() : true; }); }
  function isMonWs() { return _ws === "overview" || _ws === "monitoring"; }
  var _active = "overview";
  var _ws = "overview";        // current workspace (bottom bar)
  var _wsLast = {};            // workspace id → last member viewed in it
  var _imgFilter = "all";      // Imaging Notes filter bucket
  var _imgOpen = {};           // imaging card index → expanded (full report)

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

  var RENDER = {
    overview: function () {
      var p = _raw.patient, alerts = _raw.alerts || [], f = _raw.fluids || {}, v = _raw.ventilator || {}, mp = curMap();
      var out = "";
      out += '<div class="icu-sec-lbl">🚨 Critical Alerts</div>';
      out += alerts.length ? alertsGroupedHTML(alerts) : '<div class="icu-card"><p>No active alerts. Enter vitals/labs to populate the dashboard.</p></div>';
      // Surface Trends up front (it was buried as the last Monitoring sub-tab) — one tap to the chart.
      out += '<div class="icu-sec-lbl">' + ico("trend", "📈") + ' Trends</div><div class="icu-card">' +
        '<p class="icu-doc-sub" style="margin:0 0 8px">See how this patient’s vitals and labs are moving over time.</p>' +
        '<button class="icu-btn" data-icu-act="tab:trends">' + ico("trend", "📈") + ' View vitals &amp; labs trends</button></div>';
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
    dx: function () {
      var p = _raw.patient;
      var pid = p._id || p.name || "cur";
      if (_dxPt !== pid) { _dxPt = pid; _dxShow = false; _dxWhy = {}; _dxAdvanced = false; _corrCache = {}; _corrErr = null; _corrBusy = false; }   // reset guided-dx + correlation state on patient switch (no cross-patient leak)
      if (icuDxFlowOn()) maybeAutoTour();   // first-use guided-diagnosis tour (per account; once)
      var cc = p.complaints ? esc(p.complaints) : '<span style="color:var(--muted)">Not documented — add manually.</span>';
      var dxTxt = p.diagnosis ? "<b>" + esc(p.diagnosis) + "</b>" : '<span style="color:var(--muted)">Not set</span>';
      var fchips = findChipsHTML(false);
      // (smd_icu_dxflow) "Clinical context ready" → Find working diagnosis → deterministic differential.
      var guided = "";
      if (icuDxFlowOn()) {
        var present = (_raw.findings || []).filter(function (c) { return c.polarity !== "absent" && c.canonicalFindingId && c.canonicalFindingId.indexOf("note:") !== 0; }).length;
        var labN = Object.keys(_raw.labs.recent || {}).length, imgN = (_raw.imaging || []).filter(function (r) { return !r.hidden; }).length, vitN = latestVitalsSummary().length;
        var hasCtx = present > 0 || labN > 0 || imgN > 0;
        if (hasCtx) {
          var summ = '<div class="icu-corr-meta">' + [present + " finding" + (present === 1 ? "" : "s"), labN + " lab" + (labN === 1 ? "" : "s"), imgN + " imaging", (vitN ? "vitals ✓" : "no vitals")].join(" · ") + "</div>";
          // Deep Review shares the correlation cache/state; a cached result renders here too.
          var dKey = (p._id || "cur") + ":" + correlationHash(buildClinicalContext()), dDeep = _corrCache[dKey];   // MUST match runCorrelationDeep's key
          var dBlock = _corrBusy ? '<div class="icu-assist-msg" style="margin-top:10px">Running deep clinical review…</div>' : (dDeep ? '<div class="icu-corr-deep">' + corrDeepHTML(dDeep) + "</div>" : (_corrErr ? '<div class="icu-corr-deep">' + corrDeepHTML(_corrErr) + "</div>" : ""));
          // Sequential gating (BUG C): Deep Review disabled until a working dx is identified/chosen;
          // external evidence hidden until a dx is selected OR deep review completed. Advanced = escape.
          var hasDx = !!(p.workingDx || p.diagnosis);
          var deepDone = !!dDeep;
          var canDeep = hasDx || _dxAdvanced;
          var showExt = hasDx || deepDone || _dxAdvanced;
          guided = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "✅") + ' Clinical context ready</div>' +
            '<p class="icu-doc-sub" style="margin:0 0 4px">Use your findings with available labs, imaging and vitals to identify a working diagnosis.</p>' + summ +
            '<button class="icu-btn" data-icu-act="finddx">' + ico("pulse", "🩺") + ' Find working diagnosis</button>' +
            (_dxShow ? '<div style="margin-top:10px">' + dxDifferentialHTML() + "</div>" : "") +
            '<button class="icu-btn ghost" data-icu-act="corrdeep" style="margin-top:10px"' + ((_corrBusy || !canDeep) ? " disabled" : "") + ' title="' + (!canDeep ? "First identify or choose a working diagnosis" : "") + '">' + ico("pulse", "✨") + " Deep clinical review</button>" +
            (!canDeep ? '<p class="icu-doc-sub" style="margin:6px 0 0">First identify or choose a working diagnosis.</p>' : "") + dBlock +
            (extEvidenceOn() && showExt ? '<button class="icu-btn ghost" data-icu-act="corrext" style="margin-top:8px">' + ico("search", "🔎") + " Find evidence beyond StewardMD</button>" : "") +
            (deepDone ? '<p class="icu-doc-sub" style="margin-top:6px">Need guideline support? Use “Find evidence beyond StewardMD”.</p>' : "") +
            (!hasDx && !_dxAdvanced ? '<button class="icu-btn ghost" data-icu-act="dxadv" style="margin-top:8px">' + ico("info", "⏩") + " Advanced — skip ahead</button>" : "") +
            '<p class="icu-doc-sub" style="margin-top:8px">Deep review sends a de-identified context summary for advisory correlation — you confirm what is sent.</p></div>';
        } else {
          guided = '<div class="icu-card"><div class="icu-sec-lbl">' + ico("info", "ⓘ") + ' No clinical context yet</div>' +
            '<p class="icu-doc-sub" style="margin:0 0 8px">Add findings, labs or imaging to identify a working diagnosis.</p>' +
            '<button class="icu-btn ghost" data-icu-act="findpick">' + ico("plus", "＋") + ' Add findings</button></div>';
        }
      }
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("edit", "📝") + ' Presenting complaints</div>' +
        '<p class="icu-dx-cc">' + cc + "</p>" +
        '<button class="icu-btn ghost" data-icu-act="edit:patient">' + ico("edit", "✎") + ' Edit complaints &amp; details</button></div>' +
        '<div class="icu-card"><div class="icu-sec-lbl">' + ico("pulse", "🧾") + ' Structured findings</div>' +
        (fchips || '<p class="icu-doc-sub" style="margin:0 0 8px">Add symptoms, signs, vitals, labs or imaging findings from a fast clinical picker. Documentation only — this does not change any diagnosis or scoring.</p>') +
        '<button class="icu-btn" data-icu-act="findpick" style="margin-top:10px">' + ico("plus", "＋") + ' Add findings</button></div>' +
        guided +
        '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🩺") + ' Working diagnosis</div>' +
        '<p class="icu-dx-cur">' + dxTxt + "</p>" +
        // Management considerations are surfaced ONLY once a working diagnosis is selected, and stay advisory.
        (icuDxFlowOn() && p.diagnosis ? '<div class="icu-corr-note">' + ico("info", "ⓘ") + ' Management considerations for <b>' + esc(p.diagnosis) + '</b> are <b>advisory</b> — verify against local protocol, ICMR/guideline sources and your clinical judgement. Run <b>Deep clinical review</b> above for correlation and guideline-supported considerations.</div>' : "") +
        '<button class="icu-btn" data-icu-act="dxsearch">' + ico("search", "🔎") + ' Search &amp; select diagnosis</button>' +
        '<p class="icu-doc-sub" style="margin-top:8px">Searches StewardMD’s clinical knowledge base and sets the working diagnosis — clinician-editable, never auto-applied.</p></div>';
    },
    goals: function () {
      var g = _raw.goals || [];
      var list = g.length ? g.map(function (x) { return '<div class="icu-row"><span>• ' + esc(x) + "</span></div>"; }).join("") : '<div class="icu-empty">No goals set for today.</div>';
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("check", "🎯") + ' Goals for today</div>' + list +
        '<button class="icu-btn ghost" data-icu-act="edit:goals" style="margin-top:10px">' + ico("edit", "✎") + ' Edit goals</button></div>' +
        '<button class="icu-btn ghost" data-icu-act="launch:interactions">' + ico("warn", "⚠️") + ' Check drug interactions</button>';
    },
    documents: function () {
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("copy", "📄") + ' Documents</div>' +
        '<p class="icu-doc-sub">Generate clinician-reviewable documents from this patient’s recorded data. Nothing is finalised without your review.</p>' +
        '<button class="icu-btn" data-icu-act="summary">' + ico("copy", "📋") + ' Daily ICU summary</button>' +
        '<button class="icu-btn ghost" data-icu-act="sharecase">' + ico("share", "📤") + ' Share case</button>' +
        '<button class="icu-btn ghost" data-icu-act="printsummary">' + ico("upload", "🖨") + ' Print / Export PDF</button>' +
        '<button class="icu-btn ghost" data-icu-act="discharge">' + ico("rounds", "📝") + ' Discharge Creator</button>' +
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
    more: function () {
      var n = rosterCount();
      return '<div class="icu-card"><div class="icu-sec-lbl">' + ico("more", "⋯") + ' More</div>' +
        '<button class="icu-btn ghost" data-icu-act="edit:patient">' + ico("user", "🧑") + ' Patient details</button>' +
        '<button class="icu-btn ghost" data-icu-act="patients">' + ico("folder", "📋") + ' Saved patients' + (n ? " (" + n + ")" : "") + '</button>' +
        '<button class="icu-btn ghost" data-icu-act="wardfetch">' + ico("hospital", "🏥") + ' Ward Sync</button>' +
        '<button class="icu-btn ghost" data-icu-act="coach">' + ico("info", "ⓘ") + ' How the ICU workstation works</button>' +
        (icuDxFlowOn() ? '<button class="icu-btn ghost" data-icu-act="dxtour">' + ico("pulse", "🧭") + ' Show ICU diagnosis tour</button>' : "") +
        '</div>';
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
      '<button class="icu-x" data-icu-act="coach" aria-label="How this works" title="How this works">' + ico("info", "ⓘ") + '</button>' +
      '<button class="icu-x" data-icu-act="close" aria-label="Close ICU">' + ico("close", "✕") + '</button>' +
      '</div><div class="icu-hd-meta">' + (meta.length ? meta.join("<span>·</span>") : "Tap Patient, then Enter data below") + "</div>" +
      '<div class="icu-hd-actions">' +
        '<button class="icu-chip" data-icu-act="edit:patient">' + ico("edit", "✎") + '<span>Patient</span></button>' +
        '<button class="icu-chip" data-icu-act="savept">' + ico("save", "💾") + '<span>Save</span></button>' +
        '<button class="icu-chip" data-icu-act="patients">' + ico("folder", "📋") + '<span>Patients' + (n ? " (" + n + ")" : "") + '</span></button>' +
        (labWatchOn() ? '<button class="icu-chip' + (lwActive() ? " icu-chip-lw" : "") + '" data-icu-act="labwatch" aria-label="Lab Watch — monitor new labs for this patient">' + ico("bell", "🔔") + '<span>' + (lwActive() ? "Watching" : "Lab Watch") + (_lwBadge ? ' <b class="icu-lw-badge">' + _lwBadge + '</b>' : "") + '</span></button>' : "") +
        (labWatchOn() ? '<button class="icu-chip" data-icu-act="lwmgr" aria-label="Lab Watch 24/7 — background lab alerts across your account">' + ico("bell", "🔔") + '<span>Lab Watch 24/7</span></button>' : "") +
        '<button class="icu-chip" data-icu-act="sharecase">' + ico("share", "📤") + '<span>Share</span></button>' +
        '<button class="icu-chip" data-icu-act="clearfindings">' + ico("trash", "🧹") + '<span>Clear</span></button>' +
        '<button class="icu-chip icu-chip-primary" data-icu-act="newpt">' + ico("plus", "＋") + '<span>New</span></button>' +
      '</div></div>';
  }
  // Fixed 5-workspace bottom bar (was 10 crowded tabs). Highlights the current workspace.
  function renderTabBar() {
    return '<div class="icu-tabs icu-ws-bar">' + WORKSPACES.map(function (w) {
      return '<button class="icu-tab ' + (w.id === _ws ? "on" : "") + '" data-icu-act="ws:' + w.id + '"><span class="ti">' + ico(w.svg, w.ic) + '</span><span class="tl">' + w.label + "</span></button>";
    }).join("") + "</div>";
  }
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
      if (_raw.patient && (_raw.patient.name || _raw.patient.diagnosis)) return true;
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
      ((isOv && (!icuSeen() || _coachForce)) ? coachCard() : "") +
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
    // Preserve scroll across the full innerHTML rebuild. Without this, EVERY state change (ticking a
    // rounds checkbox, marking imaging reviewed, ingesting data…) recreated the .icu-scroll container
    // and snapped the list back to the top — so you couldn't work down the rounds checklist. Genuine
    // context switches opt out via _paintTop; tab/workspace changes reset to 0 explicitly after paint.
    var _osc = rootEl.querySelector(".icu-scroll");
    var _keepTop = (_paintTop || !_osc) ? 0 : _osc.scrollTop;
    _paintTop = false;
    // Camera FAB is contextual — only where snapping a monitor/lab/ABG/vent is relevant.
    var fab = isMonWs() ? '<button id="icuSnap" data-icu-act="snapshot" aria-label="ICU Snapshot">' + ico("camera", "📷") + '</button>' : "";
    // Prominent, ALWAYS-visible "Lab Watch 24/7" FAB (sits just above the Snapshot camera button)
    // that opens the account's background watched-patients list — alerts even when the app is closed.
    var watchFab = labWatchOn()
      ? '<button id="icuWatch" data-icu-act="lwmgr" aria-label="Lab Watch 24/7 — alerts even when the app is closed">' + ico("bell", "🔔") + '<span>Lab Watch 24/7</span></button>'
      : "";
    rootEl.innerHTML = renderHeader() + renderBody() + watchFab + fab + renderTabBar();
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
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + esc(it.label) + '</h3><div class="icu-fld"><label>Note</label><textarea data-k="note" rows="4" style="font:600 14px var(--font);padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--ink);width:100%">' + esc(cur) + "</textarea></div>" +
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

  /* ---- Discharge Creator: draft a clinician-reviewable ICU discharge summary from the
   * patient's RECORDED data (demographics, working dx, complaints, hospital course from
   * rounds notes + significant trend changes, status at discharge, active issues, current
   * infusions). Discharge-specific fields the app doesn't hold (discharge meds, follow-up,
   * advice) are bracketed placeholders the clinician completes. Editable before Copy/Print;
   * nothing is auto-sent. Reuses buildSummary's data extraction + significantChanges(). ---- */
  function buildDischarge(st) {
    var s = st || _raw, p = s.patient || {}, lv = latestByTs(s.vitals), L = (s.labs && s.labs.recent) || {}, g = s.abg || {}, f = s.fluids || {}, v = s.ventilator || {}, mp = (lv.map != null ? lv.map : mapCalc(lv.sbp, lv.dbp)), rounds = s.rounds || {}, alerts = s.alerts || [], infusions = s.infusions || [], out = [];
    out.push("STEWARDMD — ICU DISCHARGE SUMMARY (DRAFT — clinician review required)");
    out.push((p.name || "ICU patient") + (p.age != null ? ", " + p.age + "y" : "") + (p.sex ? " " + p.sex : "") + (p.bed ? " · Bed " + p.bed : "") + (p.icuDay != null ? " · ICU day " + p.icuDay : "") + (p.hospital ? " · " + p.hospital : ""));
    out.push("Working diagnosis: " + (p.diagnosis || "[ complete ]"));
    if (p.complaints) out.push("Reason for admission: " + p.complaints);
    var finds = s.findings || [];
    if (finds.length) out.push("Clinical findings: " + finds.map(function (c) { return findChipLabel(c); }).join("; "));
    // Hospital course = rounds notes + significant trend changes (plain text of the flags).
    var course = [];
    ROUNDS_ITEMS.forEach(function (it) { if (rounds[it.k] && rounds[it.k].note) course.push(it.label + ": " + rounds[it.k].note); });
    var sig = significantChanges(0);
    if (sig) { var tmp = sig.replace(/<[^>]+>/g, "|").split("|").map(function (x) { return x.trim(); }).filter(function (x) { return x && !/Significant changes|trend flags/.test(x); }); tmp.forEach(function (x) { course.push(x); }); }
    out.push("\nHOSPITAL COURSE:");
    out.push(course.length ? course.map(function (x) { return "• " + x; }).join("\n") : "[ summarise the ICU course ]");
    out.push("\nSTATUS AT DISCHARGE:");
    out.push("• Haemodynamics: HR " + (lv.hr != null ? lv.hr : "—") + ", BP " + (lv.sbp != null ? lv.sbp + "/" + lv.dbp : "—") + ", MAP " + (mp != null ? mp : "—") + (lv.spo2 != null ? ", SpO₂ " + lv.spo2 + "%" : ""));
    var keyL = ["na", "k", "creat", "urea", "hb", "wbc", "plt", "crp"].filter(function (k) { return L[k] != null; }).map(function (k) { return k.toUpperCase() + " " + L[k]; });
    if (keyL.length) out.push("• Labs: " + keyL.join(", "));
    if (g.ph != null) out.push("• ABG: pH " + g.ph + " / pCO₂ " + g.paco2 + " / HCO₃ " + g.hco3);
    if (v.mode) out.push("• Ventilation: " + v.mode + (v.fio2 ? ", FiO₂ " + v.fio2 + "%" : "") + (v.peep != null ? ", PEEP " + v.peep : ""));
    if (f.net24h != null || f.cumulative != null) out.push("• Fluids: net 24h " + (f.net24h != null ? f.net24h + " mL" : "—") + ", cumulative " + (f.cumulative != null ? f.cumulative + " mL" : "—"));
    if (alerts.length) out.push("\nACTIVE ISSUES AT DISCHARGE:\n" + alerts.map(function (a) { return "• [" + a.severity.toUpperCase() + "] " + a.title + " — " + a.msg; }).join("\n"));
    if (infusions.length) out.push("\nINFUSIONS RUNNING (reconcile before discharge):\n" + infusions.map(function (i) { return "• " + i.drug + (i.dose != null ? " " + i.dose + (i.unit || "") : "") + (i.rateMlHr != null ? " @ " + i.rateMlHr + " mL/h" : ""); }).join("\n"));
    out.push("\nDISCHARGE MEDICATIONS: [ complete ]");
    out.push("FOLLOW-UP: [ complete ]");
    out.push("ADVICE TO PATIENT / CARER: [ complete ]");
    out.push("\n— Draft generated from recorded ICU data. Verify every value and complete the bracketed sections before use. Decision support only. StewardMD ICU.");
    return out.join("\n");
  }
  function openDischarge() {
    injectCSS(); ensureModal();
    lwOnDischarge();   // an "until discharge" Lab Watch ends when the discharge summary is created
    var draft = buildDischarge();
    modalEl.innerHTML = '<div class="icu-sheet"><h3>' + ico("copy", "📝") + ' Discharge Creator <span style="font:700 11px var(--font);color:var(--warn);background:var(--warn-soft);padding:2px 7px;border-radius:999px;vertical-align:middle">DRAFT</span></h3>' +
      '<p class="icu-doc-sub">Drafted from this patient’s recorded ICU data. <b>Edit below</b>, complete the bracketed sections, and verify every value — then copy or print. Nothing is sent anywhere.</p>' +
      '<textarea id="icuDischargeText" spellcheck="false" style="width:100%;box-sizing:border-box;white-space:pre-wrap;font:500 12.5px/1.55 var(--mono);background:var(--panel2);border:1px solid var(--border);border-radius:10px;padding:12px;color:var(--ink);height:48vh;resize:vertical">' + esc(draft) + '</textarea>' +
      '<button class="icu-btn" data-icu-act="dischargecopy">' + ico("copy", "📋") + ' Copy</button>' +
      '<button class="icu-btn ghost" data-icu-act="sharecase">' + ico("share", "📤") + ' Share</button>' +
      '<button class="icu-btn ghost" data-icu-act="closeform">Close</button></div>';
    modalEl.classList.add("on");
  }
  function copyDischarge() { var ta = modalEl && modalEl.querySelector("#icuDischargeText"); var t = ta ? ta.value : buildDischarge(); try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t); } catch (e) {} if (window.toast) toast("Discharge summary copied — verify before use"); }

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
    { sel: '[data-icu-act="corrdeep"]', title: "Deep Clinical Review", text: "Once you’ve chosen a working diagnosis, Deep review uses the context you confirm for advisory correlation, missing data and guideline-supported considerations. External evidence appears after this." }
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
  function rosterKey(owner) { return ROSTER_BASE + ":" + (owner || ownerNow()); }
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
  function deletePatient(id) {
    saveRoster(loadRoster().filter(function (x) { return x.id !== id; }));
    cloudDel(id).then(function () { openRoster(); });
    openRoster();                                            // optimistic refresh
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
      case "tab": _active = arg; _ws = wsOf(arg); _wsLast[_ws] = arg; paint(); var sc = rootEl && rootEl.querySelector(".icu-scroll"); if (sc) sc.scrollTop = 0; break;
      case "ws": { _ws = arg; var _m = wsMembers(wsById(arg)), _l = _wsLast[arg]; _active = (_l && _m.indexOf(_l) >= 0) ? _l : _m[0]; paint(); var sc2 = rootEl && rootEl.querySelector(".icu-scroll"); if (sc2) sc2.scrollTop = 0; break; }
      case "summary": openSummary(); break;
      case "printsummary": printSummary(); break;
      case "discharge": openDischarge(); break;
      case "dischargecopy": copyDischarge(); break;
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
      case "sharept": sharePatient(arg); break;
      case "sharecase": shareCase(); break;
      case "phiexportgo": { var _pe = _phiPending; _phiPending = null; closeForm(); if (_pe) _pe(); break; }   // KI-H6: confirmed PHI export
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
    open: function (target) {
      injectCSS();
      if (!rootEl) {
        rootEl = document.createElement("div"); rootEl.id = "icuRoot";
        document.body.appendChild(rootEl);
        rootEl.addEventListener("click", onClick);
      }
      // BUG #14: an optional sub-tab id opens the dashboard directly on that workspace —
      // the syringe FAB opens Infusions (its actual purpose), distinct from the Home
      // "ICU" tile which opens Overview. No argument = unchanged (open at current tab).
      if (target && typeof target === "string" && RENDER[target]) { _active = target; _ws = wsOf(target); }
      paint();
      rootEl.classList.add("on");
      document.body.style.overflow = "hidden";
    },
    close: function () { if (rootEl) rootEl.classList.remove("on"); document.body.style.overflow = ""; },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
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
    buildDischarge: buildDischarge, openDischarge: openDischarge,
    // KI-M3 test seams (per-account live-buffer scoping)
    _bufKey: bufKey, _reconcileOwner: reconcileOwner, _loadOwnerBuffer: loadOwnerBuffer, _resetBufSync: function () { _ownerBufSynced = false; }
  };
  window.ICU = ICU;

  // KI-M3 backstop: on app resume (a shared ward device may have been handed over + re-authed
  // while backgrounded), re-check the owner. reconcileOwner only wipes/reloads if the owner
  // actually CHANGED — a same-owner resume is a no-op, so no in-session work is ever lost.
  try { document.addEventListener("visibilitychange", function () { if (!document.hidden) { try { reconcileOwner(); } catch (e) {} } }); } catch (e) {}

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
