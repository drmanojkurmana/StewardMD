/* insulin.js - Insulin module: routed shell (Dashboard / Calculator / Settings).
 * Wires the pure engine (INSULIN_ENGINE) + safety engine (INSULIN_SAFETY) to a
 * transparent, confirm-gated UI. Overlay module: window.INSULIN = {open, close, isOn}.
 * Settings + dose history persist in localStorage (per-uid). Units (mg/dL <-> mmol/L)
 * are converted at the engine boundary; the engine stays canonical mg/dL.
 * Motion via window.Motion (vendored). Hard-gated on the smd_insulin flag. */
(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;

  var ROOT_ID = "insulinRoot";

  function flags() { return window.SMD_INSULIN_FLAGS; }
  function on() { var f = flags(); return !!(f && f.bool("smd_insulin")); }
  function reduced() { try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } }

  /* ---------- per-user storage ---------- */
  function uid() {
    try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.uid) return SMD_ACCOUNT.uid() || "guest"; } catch (e) {}
    try { if (window.SMD_OWNER_KEY) return SMD_OWNER_KEY() || "guest"; } catch (e) {}
    return "guest";
  }
  function keyFor(base) { return "smd_insulin_" + base + "_" + uid(); }

  var DEFAULTS = { units: "mgdl", increment: 1, target: 120, maxBolus: 15, maxDaily: 100, institution: "", bolusInsulin: "aspart" };
  var SET = clone(DEFAULTS);
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadSettings() {
    try { var raw = localStorage.getItem(keyFor("settings")); var s = raw ? JSON.parse(raw) : {}; var out = clone(DEFAULTS);
      for (var k in DEFAULTS) if (s[k] != null) out[k] = s[k]; return out; } catch (e) { return clone(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(keyFor("settings"), JSON.stringify(SET)); } catch (e) {} }

  function loadLog() { try { return JSON.parse(localStorage.getItem(keyFor("log")) || "[]"); } catch (e) { return []; } }
  function saveLog(list) { try { localStorage.setItem(keyFor("log"), JSON.stringify(list.slice(0, 50))); } catch (e) {} }
  function pushLog(entry) { var l = loadLog(); l.unshift(entry); saveLog(l); }
  function todayTotal() {
    var l = loadLog(), n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate(), sum = 0;
    for (var i = 0; i < l.length; i++) { var e = l[i]; if (!e.ts) continue; var t = new Date(e.ts);
      if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d) sum += Number(e.confirmedDose) || 0; }
    return sum;
  }

  /* ---------- patient profiles (dedicated per-uid store; no MRN/DOB) ---------- */
  var pidSeq = 0;
  function loadPatients() { try { return JSON.parse(localStorage.getItem(keyFor("patients")) || "[]"); } catch (e) { return []; } }
  function savePatients(list) { try { localStorage.setItem(keyFor("patients"), JSON.stringify(list.slice(0, 100))); } catch (e) {} }
  function savePatient(p) {
    var list = loadPatients();
    if (!p.id) p.id = "p" + Date.now() + "_" + (pidSeq++);
    p.savedAt = Date.now();
    var i = -1, j; for (j = 0; j < list.length; j++) if (list[j].id === p.id) { i = j; break; }
    if (i > -1) list[i] = p; else list.unshift(p);
    savePatients(list); return p;
  }
  function getPatient(id) { var l = loadPatients(), i; for (i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function deletePatient(id) { savePatients(loadPatients().filter(function (p) { return p.id !== id; })); }
  function newProfile() {
    return { id: null, name: "", sex: "", age: "", heightCm: "", weightKg: "", notes: "", dxType: "", regimen: "",
      pregnancy: false, renal: false, hepatic: false, steroids: false,
      icr: "", isf: "", target: "", tdd: "", dia: "", maxBolus: "", maxDaily: "", bolus: st.bolus };
  }
  function bmiOf(p) {
    if (!num(p.heightCm) || !num(p.weightKg) || Number(p.heightCm) <= 0) return null;
    var mtr = Number(p.heightCm) / 100;
    return Math.round((Number(p.weightKg) / (mtr * mtr)) * 10) / 10;
  }
  function applyProfile(p) {
    st.patientId = p.id; st.patientName = p.name || "Unnamed";
    if (num(p.age)) st.ctx.age = Number(p.age);
    if (num(p.weightKg)) st.ctx.weightKg = Number(p.weightKg);
    st.ctx.pregnancy = !!p.pregnancy; st.ctx.renal = !!p.renal; st.ctx.hepatic = !!p.hepatic; st.ctx.steroids = !!p.steroids;
    if (num(p.icr)) st.icr = Number(p.icr);
    if (num(p.isf)) st.isf = Number(p.isf);
    if (num(p.target)) st.target = Number(p.target);
    if (num(p.tdd)) st.tdd = Number(p.tdd);
    if (p.bolus) st.bolus = p.bolus;
  }
  function num(x) { return x !== "" && x != null && isFinite(Number(x)); }

  /* ---------- units (display <-> canonical mg/dL) ---------- */
  function mmolMode() { return SET.units === "mmol"; }
  function gUnit() { return mmolMode() ? "mmol/L" : "mg/dL"; }
  function isfUnit() { return mmolMode() ? "mmol/L/u" : "mg/dL/u"; }
  function toMgdl(v) { return mmolMode() ? v * 18 : v; }          // glucose/target/ISF share the /18 factor
  function gStep() { return mmolMode() ? 0.5 : 5; }
  function targetPresets() { return mmolMode() ? [5, 6, 7, 8] : [100, 120, 140, 180]; }

  /* ---------- state ---------- */
  var st = { screen: "dashboard", mode: "combined",
    glucose: 180, target: 120, carbs: 45, icr: 10, isf: 50, iob: 2, increment: 1,
    ctx: { age: 40, weightKg: 70, pregnancy: false, renal: false, hepatic: false, exercise: false, steroids: false },
    acked: false, confirmed: false, bolus: "aspart", iobNote: "",
    tdd: 40, isfRule: 1800, icrRule: 500, tddFactor: 0.4, basalFraction: 0.5,
    dkaRate: 0.1, dkaMax: "", pedStage: "prepubertal", dkaPaeds: false, advAck: false,
    libQ: "", libClass: "all", libOpen: null, compare: [],
    patientId: null, patientName: "", editP: null, patQ: "",
    convFrom: "glargine100", convTo: "degludec", convDose: 20, convReason: "", convAck: false,
    histFilter: "all" };

  function initState() {
    var m = mmolMode();
    st.mode = st.mode || "combined";
    st.glucose = m ? 10 : 180;
    st.target = SET.target;          // stored in SET.units
    st.carbs = 45; st.icr = 10;
    st.isf = m ? 3 : 50;
    st.iob = 2; st.increment = SET.increment;
    st.bolus = SET.bolusInsulin || "aspart"; st.iobNote = "";
    st.tdd = 40; st.isfRule = 1800; st.icrRule = 500; st.tddFactor = 0.4; st.basalFraction = 0.5;
    st.dkaRate = 0.1; st.dkaMax = ""; st.pedStage = "prepubertal"; st.dkaPaeds = false; st.advAck = false;
    st.ctx = { age: 40, weightKg: 70, pregnancy: false, renal: false, hepatic: false, exercise: false, steroids: false };
    st.acked = false; st.confirmed = false;
    st.patientId = null; st.patientName = ""; st.editP = null; st.patQ = "";
    st.convFrom = "glargine100"; st.convTo = "degludec"; st.convDose = 20; st.convReason = ""; st.convAck = false;
  }

  /* ---------- icons ---------- */
  var ICON_AI = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.3 6.3 4.9 4.9M19.1 19.1l-1.4-1.4M17.7 6.3l1.4-1.4M4.9 19.1l1.4-1.4"/><circle cx="12" cy="12" r="4"/></svg>';
  var ICON_GEAR = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  var ICON_BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
  var SVG_TRI = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
  var SVG_EXC = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>';
  var SVG_INFO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
  var ICON_BOOK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
  var ICON_CHEV = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  var ICON_PILL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg>';
  var ICON_CHEVR = '<svg class="chevr" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
  var ICON_SEARCH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
  var ICON_USER = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  var ICON_SWAP = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l4 4-4 4"/><path d="M21 7H7"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h14"/></svg>';
  function sevIcon(s) { return s === "critical" || s === "warning" ? SVG_TRI : s === "caution" ? SVG_EXC : SVG_INFO; }
  function sevLabel(s) { return s === "critical" ? "Critical" : s === "warning" ? "Warning" : s === "caution" ? "Caution" : "Note"; }
  function modeLabel(m) {
    var L = { combined: "Combined meal + correction", meal: "Meal bolus", correction: "Correction",
      basal: "Basal initiation", isf: "Insulin sensitivity factor", icr: "Insulin-to-carb ratio",
      iob: "Active insulin (IOB)", pediatric: "Paediatric initiation", dka: "DKA insulin infusion" };
    return L[m] || "Insulin dose";
  }

  function howItWorks(mode) {
    if (mode === "meal")
      return "This covers the carbohydrates in the meal. It divides the grams of carbohydrate by the " +
        "insulin-to-carbohydrate ratio (ICR), so one unit of insulin is given for every ICR grams. The result is then rounded.";
    if (mode === "correction")
      return "This brings a high glucose down toward target. It takes how far the current glucose is above " +
        "target and divides by the insulin sensitivity factor (ISF), where one unit lowers glucose by ISF. No correction is given at or below target.";
    if (mode === "basal")
      return "Weight-based basal-bolus initiation. Total daily dose = weight x a starting factor (u/kg/day); a share of that " +
        "is basal and the remainder is split across three meals. A deliberately conservative start - titrate to targets.";
    if (mode === "isf")
      return "The insulin sensitivity (correction) factor estimated from total daily dose: 1800 divided by TDD for rapid " +
        "analogues (1500 for regular insulin). It is how many mg/dL one unit is expected to lower glucose - an estimate to titrate.";
    if (mode === "icr")
      return "The insulin-to-carbohydrate ratio estimated from total daily dose: 500 divided by TDD for rapid analogues " +
        "(450 for regular). It is the grams of carbohydrate covered by one unit - an estimate to titrate.";
    if (mode === "iob")
      return "Active insulin (insulin on board) summed from your confirmed bolus doses in the log, each decayed linearly over " +
        "the selected insulin's duration of action. Subtract it from a new correction to avoid stacking.";
    if (mode === "pediatric")
      return "Weight-based paediatric initiation. TDD = weight x an age-stage factor, split basal and prandial. Specialist-guided, " +
        "conservative, and not for ketoacidosis; titrate to age-appropriate targets.";
    if (mode === "dka")
      return "Fixed-rate intravenous insulin infusion for DKA: weight x the protocol rate per kg (units/hour), after fluids and a " +
        "potassium check. Continue until ketoacidosis resolves, adding dextrose as glucose falls. Follow your institutional protocol.";
    return "This combines two doses. First it covers the meal: grams of carbohydrate divided by the ICR. Then it " +
      "adds a correction for a high glucose: the amount above target divided by the ISF. It then subtracts any insulin " +
      "still active from earlier doses (IOB) so a dose is not stacked, floors the total at zero, and rounds.";
  }

  /* ---------- Motion ---------- */
  function withMotion(cb) {
    if (window.Motion && window.Motion.animate) return cb(window.Motion);
    if (!document.getElementById("smd-motion-js")) {
      var s = document.createElement("script"); s.id = "smd-motion-js"; s.src = "/vendor/motion/motion.js"; s.defer = true;
      (document.head || document.documentElement).appendChild(s);
    }
    var tries = 0;
    (function wait() { if (window.Motion && window.Motion.animate) return cb(window.Motion); if (tries++ > 60) return; setTimeout(wait, 40); })();
  }
  function springIn(el) {
    if (!el || reduced()) return;
    withMotion(function (M) { try { M.animate(el, { opacity: [0, 1], scale: [0.985, 1], y: [8, 0] },
      { duration: 0.42, easing: [0.2, 0.7, 0.2, 1] }); } catch (e) {} });
  }
  function countUp(el, to) {
    var target = Number(to) || 0;
    if (reduced()) { el.textContent = fmt(target); return; }
    var start = 0, t0 = null, dur = 460;
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur), eased = 1 - Math.pow(1 - p, 3), cur = start + (target - start) * eased;
      el.textContent = fmt(st.increment === 0.5 ? Math.round(cur * 2) / 2 : Math.round(cur));
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(target);
    }
    requestAnimationFrame(frame);
  }
  function fmt(n) { return (Math.round(Number(n) * 10) / 10).toString(); }

  /* ---------- shell + router ---------- */
  function root() {
    var el = document.getElementById(ROOT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = ROOT_ID; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Insulin dose calculator");
    el.innerHTML = '<div class="ins-gridbg"></div><div class="ins-scroll"><div class="ins-wrap">' +
      '<div id="insHeader"></div><div id="insScreen"></div></div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    return el;
  }
  function paint() {
    document.getElementById("insHeader").innerHTML = headerHTML();
    var s = document.getElementById("insScreen");
    if (st.screen === "dashboard") { s.innerHTML = dashboardHTML(); }
    else if (st.screen === "settings") { s.innerHTML = settingsHTML(); }
    else if (st.screen === "library") { s.innerHTML = libraryHTML(); renderLibList(); }
    else if (st.screen === "compare") { s.innerHTML = compareHTML(); }
    else if (st.screen === "patients") { s.innerHTML = patientsHTML(); renderPatientList(); }
    else if (st.screen === "patient") { s.innerHTML = patientEditHTML(); }
    else if (st.screen === "convert") { s.innerHTML = convertHTML(); renderConvert(); }
    else if (st.screen === "history") { s.innerHTML = historyHTML(); renderHistList(); }
    else { s.innerHTML = calcHTML(); renderInputs(); render(); }
  }
  function go(screen) { st.screen = screen; paint(); springIn(document.getElementById("insScreen")); }

  function headerHTML() {
    if (st.screen === "dashboard") {
      return '<div class="ins-head ins-bf"><div class="ins-badge">Iu</div>' +
        '<div><div class="ins-title">Insulin</div><div class="ins-sub">Clinical decision support</div></div>' +
        '<button class="ins-hbtn" data-ins="go-settings" aria-label="Settings">' + ICON_GEAR + '</button>' +
        '<button class="ins-hbtn" data-ins="close" aria-label="Close">&times;</button></div>';
    }
    var title, sub, back = "go-dash";
    if (st.screen === "settings") { title = "Settings"; sub = "Preferences and safety limits"; }
    else if (st.screen === "library") { title = "Insulin library"; sub = "Reference and comparison"; }
    else if (st.screen === "compare") { title = "Compare insulins"; sub = st.compare.length + " selected"; back = "go-library"; }
    else if (st.screen === "patients") { title = "Patients"; sub = loadPatients().length + " saved profiles"; }
    else if (st.screen === "patient") { title = st.editP && st.editP.id ? "Edit patient" : "New patient"; sub = "Reusable profile (no MRN or DOB)"; back = "go-patients"; }
    else if (st.screen === "convert") { title = "Insulin conversion"; sub = "Clinician-guided switch"; }
    else if (st.screen === "history") { title = "Dose history"; sub = loadLog().length + " records (audit trail)"; }
    else { title = "Insulin dose"; sub = modeLabel(st.mode); }
    return '<div class="ins-head ins-bf"><button class="ins-hbtn" data-ins="' + back + '" aria-label="Back">' + ICON_BACK + '</button>' +
      '<div><div class="ins-title">' + title + '</div><div class="ins-sub">' + sub + '</div></div>' +
      '<button class="ins-hbtn" data-ins="close" aria-label="Close">&times;</button></div>';
  }

  /* ---------- Dashboard ---------- */
  function dashboardHTML() {
    var log = loadLog(), recent = "";
    if (log.length) {
      recent = log.slice(0, 4).map(function (e) {
        var u = e.unit && e.unit.indexOf("hour") > -1 ? "u/h" : "u";
        return '<div class="ins-rec-row"><div class="ins-rec-dose">' + e.confirmedDose + '<span>' + u + '</span></div>' +
          '<div class="ins-rec-meta"><div class="ins-rec-mode">' + modeLabel(e.mode) + '</div>' +
          '<div class="ins-rec-time">' + timeStr(e.ts) + (e.warnings && e.warnings.length ? ' &middot; ' + e.warnings.length + ' flag' + (e.warnings.length > 1 ? 's' : '') : '') + '</div></div></div>';
      }).join("");
    } else {
      recent = '<div class="ins-empty">No doses yet. When you accept a recommendation it is logged here as an audit trail.</div>';
    }

    // Real profile parameters only when a patient is loaded (glucose/IOB are live inputs, not dashboard data).
    var summary = st.patientId ? '<div class="ins-stats ins-bf">' +
        statTile("Target", fmt(st.target), gUnit()) + statTile("Carb ratio", fmt(st.icr), "g/u") + statTile("Sensitivity", fmt(st.isf), isfUnit()) +
      '</div>' : "";

    return patientBarHTML() + summary +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Start a calculation</div>' +
        '<div class="ins-qa">' + qa("combined", "Combined dose") + qa("meal", "Meal bolus") + qa("correction", "Correction") + '</div>' +
        '<div class="ins-hint">More inside each calculation: basal, sensitivity (ISF), carb ratio, active insulin, and the clinician DKA and paediatric calculators.</div>' +
      '</div>' +
      libEntryHTML() + convEntryHTML() +
      '<div class="ins-card ins-bf"><div class="ins-card-t ins-card-t-row">Recent doses' +
        (log.length ? '<button class="ins-linkbtn" data-ins="go-history">View all and export</button>' : '') + '</div>' + recent + '</div>';
  }
  function convEntryHTML() {
    if (!window.INSULIN_DB) return "";
    return '<button class="ins-lib-entry ins-bf" data-ins="go-convert">' +
      '<span class="ins-lib-ic">' + ICON_SWAP + '</span>' +
      '<span class="ins-lib-tx"><span class="ins-lib-t">Insulin conversion</span>' +
      '<span class="ins-lib-s">Guided switch with assumptions, monitoring and follow-up</span></span>' +
      ICON_CHEVR + '</button>';
  }
  function libEntryHTML() {
    var db = window.INSULIN_DB;
    if (!db) return "";
    return '<button class="ins-lib-entry ins-bf" data-ins="go-library">' +
      '<span class="ins-lib-ic">' + ICON_PILL + '</span>' +
      '<span class="ins-lib-tx"><span class="ins-lib-t">Insulin library</span>' +
      '<span class="ins-lib-s">' + db.list().length + ' insulins across ' + db.CLASSES.length + ' classes - search and compare</span></span>' +
      ICON_CHEVR + '</button>';
  }
  function patientBarHTML() {
    if (st.patientId) {
      var p = getPatient(st.patientId), meta = [];
      if (p && p.age) meta.push(p.age + " y");
      if (p && p.sex) meta.push(p.sex);
      return '<div class="ins-patbar ins-bf"><button class="ins-patbar-main" data-ins="go-patients">' + ICON_USER +
        '<span class="ins-patbar-tx"><span class="ins-patbar-t">' + esc(st.patientName) + '</span>' +
        (meta.length ? '<span class="ins-patbar-s">' + meta.join(" &middot; ") + '</span>' : '') + '</span></button>' +
        '<button class="ins-patbar-x" data-ins="p-clear" aria-label="Clear patient">&times;</button></div>';
    }
    return '<button class="ins-patbar ins-patbar-empty ins-bf" data-ins="go-patients">' + ICON_USER +
      '<span class="ins-patbar-tx"><span class="ins-patbar-t">No patient selected</span>' +
      '<span class="ins-patbar-s">Choose or create a reusable profile</span></span>' + ICON_CHEVR + '</button>';
  }
  function statTile(label, val, unit) {
    return '<div class="ins-stat"><div class="ins-stat-l">' + label + '</div>' +
      '<div class="ins-stat-v">' + val + '<span>' + unit + '</span></div></div>';
  }
  function qa(mode, label) { return '<button class="ins-qa-btn" data-ins="qa" data-mode="' + mode + '">' + label + '</button>'; }
  function timeStr(ts) { try { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }

  /* ---------- dose history (filter + export) ---------- */
  function historyHTML() {
    var filters = ["all", "combined", "meal", "correction", "basal", "pediatric", "dka"];
    var chips = filters.map(function (f) {
      return '<button class="ins-chip" data-ins="hist-filter" data-v="' + f + '" aria-pressed="' + (st.histFilter === f ? "true" : "false") + '">' + (f === "all" ? "All" : modeLabel(f)) + '</button>';
    }).join("");
    return '<div class="ins-libchips ins-chips ins-bf">' + chips + '</div>' +
      '<div class="ins-patrow-actions ins-bf"><button class="ins-qa-btn" data-ins="hist-export">Copy CSV to clipboard</button></div>' +
      '<div id="insHistList"></div>';
  }
  function histFiltered() {
    var log = loadLog();
    return st.histFilter === "all" ? log : log.filter(function (e) { return e.mode === st.histFilter; });
  }
  function renderHistList() {
    var list = document.getElementById("insHistList"); if (!list) return;
    var rows = histFiltered();
    if (!rows.length) { list.innerHTML = '<div class="ins-empty">No records' + (st.histFilter === "all" ? " yet." : " for this filter.") + '</div>'; return; }
    list.innerHTML = rows.map(function (e) {
      var w = (e.warnings && e.warnings.length) ? e.warnings.length + " flag" + (e.warnings.length > 1 ? "s" : "") : "no flags";
      var u = e.unit && e.unit.indexOf("hour") > -1 ? "u/h" : "u";
      return '<div class="ins-rec-row"><div class="ins-rec-dose">' + e.confirmedDose + '<span>' + u + '</span></div>' +
        '<div class="ins-rec-meta"><div class="ins-rec-mode">' + modeLabel(e.mode) + '</div>' +
        '<div class="ins-rec-time">' + timeStr(e.ts) + ' &middot; ' + w + '</div></div></div>';
    }).join("");
  }
  function histCSV() {
    var rows = histFiltered();
    var lines = rows.map(function (e) {
      return [new Date(e.ts).toISOString(), e.mode, e.calculatedDose, e.confirmedDose, (e.unit || "units"), '"' + (e.warnings || []).join("; ") + '"'].join(",");
    });
    return ["timestamp,mode,calculated,confirmed,unit,warnings"].concat(lines).join("\n");
  }

  /* ---------- Settings ---------- */
  function settingsHTML() {
    return '<div class="ins-card ins-bf"><div class="ins-card-t">Units and rounding</div>' +
        '<div class="ins-field"><div class="ins-lab">Glucose units</div>' +
          '<div class="ins-static">mg/dL - India standard (fixed)</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Dose rounding</div><div class="ins-round">' +
          '<button data-ins="round" data-v="1" aria-pressed="' + (SET.increment === 1 ? "true" : "false") + '">1 unit</button>' +
          '<button data-ins="round" data-v="0.5" aria-pressed="' + (SET.increment === 0.5 ? "true" : "false") + '">0.5 unit</button>' +
        '</div></div>' +
      '</div>' +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Defaults and safety limits</div>' +
        '<div class="ins-grid2">' +
          setNum("target", "Default target " + gUnit(), SET.target) +
          setNum("maxBolus", "Max single bolus (u)", SET.maxBolus) +
          setNum("maxDaily", "Max daily dose (u)", SET.maxDaily) +
        '</div>' +
        '<div class="ins-field" style="margin-top:12px"><div class="ins-lab">Institution label</div>' +
          '<input class="ins-set-text" data-ins="set-text" data-k="institution" type="text" placeholder="e.g. ICU protocol v2" value="' + (SET.institution || "") + '"></div>' +
      '</div>' +
      '<div class="ins-tgt-note ins-bf">Settings are stored on this device and applied to new calculations. Max limits drive the critical safety interrupts.</div>';
  }
  function setNum(k, label, val) {
    return '<div class="ins-mini"><label>' + label + '</label>' +
      '<input data-ins="set-num" data-k="' + k + '" type="number" inputmode="decimal" value="' + val + '"></div>';
  }

  /* ---------- Insulin library ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function libraryHTML() {
    var db = window.INSULIN_DB;
    if (!db) return '<div class="ins-empty">Insulin database not loaded.</div>';
    var chips = '<button class="ins-chip" data-ins="lib-class" data-c="all" aria-pressed="' + (st.libClass === "all" ? "true" : "false") + '">All</button>';
    db.CLASSES.forEach(function (c) {
      chips += '<button class="ins-chip" data-ins="lib-class" data-c="' + c + '" aria-pressed="' + (st.libClass === c ? "true" : "false") + '">' + c + '</button>';
    });
    return '<div class="ins-search ins-bf">' + ICON_SEARCH +
        '<input id="insLibQ" data-ins="lib-q" type="search" placeholder="Search generic, brand, maker, U-100, India" value="' + esc(st.libQ) + '" aria-label="Search insulins"></div>' +
      '<div class="ins-chips ins-libchips ins-bf">' + chips + '</div>' +
      '<div id="insCmpBar"></div><div id="insLibList"></div>';
  }

  function renderLibList() {
    var db = window.INSULIN_DB, list = document.getElementById("insLibList");
    if (!db || !list) return;
    var res = db.search(st.libQ);
    if (st.libClass !== "all") res = res.filter(function (d) { return d.cls === st.libClass; });
    var bar = document.getElementById("insCmpBar");
    if (bar) bar.innerHTML = st.compare.length ?
      '<div class="ins-cmpbar"><span>' + st.compare.length + ' selected</span><span class="ins-cmpbar-b">' +
      '<button class="ins-cmpbar-clear" data-ins="cmp-clear">Clear</button>' +
      '<button class="ins-cmpbar-go" data-ins="go-compare"' + (st.compare.length < 2 ? " disabled" : "") + '>Compare</button></span></div>' : "";
    if (!res.length) { list.innerHTML = '<div class="ins-empty">No insulins match. Try a generic, brand, maker, concentration (U-100), country, or class.</div>'; return; }
    var html = "", i, j;
    for (i = 0; i < db.CLASSES.length; i++) {
      var cls = db.CLASSES[i], group = res.filter(function (d) { return d.cls === cls; });
      if (!group.length) continue;
      html += '<div class="ins-il-cls">' + cls + ' <span>' + group.length + '</span></div>';
      for (j = 0; j < group.length; j++) html += cardHTML(group[j]);
    }
    list.innerHTML = html;
  }

  function cardHTML(d) {
    var db = window.INSULIN_DB, open = st.libOpen === d.id, checked = st.compare.indexOf(d.id) > -1;
    var brands = d.brands.map(function (b) { return b.name; }).join(", ");
    var pk = '<span>Onset<b>' + d.onset + '</b></span><span>Peak<b>' + d.peak + '</b></span><span>Duration<b>' + d.duration + '</b></span>';
    var detail = "";
    if (open) {
      detail = '<div class="ins-il-detail">' + dlrow("Timing", d.timing) + dlrow("Route", d.route) + dlrow("Devices", d.devices) +
        dlrow("Pregnancy", d.pregnancy) + dlrow("Paediatric", d.pediatric) + dlrow("Renal", d.renal) + dlrow("Hepatic", d.hepatic) +
        dlrow("Storage", d.storage) + dlrow("Notes", d.notes) +
        dlrow("Brands", d.brands.map(function (b) { return b.name + " (" + b.mfr + ")"; }).join("; ")) +
        dlrow("Availability", db.brandCountries(d).map(function (c) { return db.COUNTRIES[c] || c; }).join(", ")) +
        (d.references ? dlrow("References", d.references) : "") + '</div>';
    }
    return '<div class="ins-il-card' + (open ? " open" : "") + '">' +
      '<button class="ins-il-head" data-ins="lib-open" data-id="' + d.id + '" aria-expanded="' + (open ? "true" : "false") + '">' +
        '<span class="ins-il-name">' + d.generic + '<span class="ins-il-sub">' + d.strengths.join(", ") + '  ·  ' + brands + '</span></span>' + ICON_CHEV + '</button>' +
      '<div class="ins-il-pk">' + pk + '</div>' +
      '<label class="ins-il-cmp"><input type="checkbox" data-ins="cmp" data-id="' + d.id + '"' + (checked ? " checked" : "") + '> Add to compare</label>' +
      detail + '</div>';
  }
  function dlrow(k, v) { return '<div class="ins-dl"><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }

  function compareHTML() {
    var db = window.INSULIN_DB;
    var items = st.compare.map(function (id) { return db.get(id); }).filter(Boolean);
    if (items.length < 2) return '<div class="ins-empty">Select at least two insulins in the library to compare.</div>';
    var rows = [["Class", "cls"], ["Strength", function (d) { return d.strengths.join(", "); }],
      ["Onset", "onset"], ["Peak", "peak"], ["Duration", "duration"], ["Typical timing", "timing"],
      ["Devices", "devices"], ["Availability", function (d) { return db.brandCountries(d).join(", "); }]];
    var cells = '<div class="ins-cmp-h ins-cmp-corner"></div>';
    items.forEach(function (d) { cells += '<div class="ins-cmp-h">' + d.generic + '</div>'; });
    rows.forEach(function (r) {
      cells += '<div class="ins-cmp-k">' + r[0] + '</div>';
      items.forEach(function (d) { var v = typeof r[1] === "function" ? r[1](d) : d[r[1]]; cells += '<div class="ins-cmp-v">' + v + '</div>'; });
    });
    var cols = "grid-template-columns:94px repeat(" + items.length + ",minmax(120px,1fr));";
    return '<div class="ins-cmp-note ins-bf">Side-by-side reference. Onset, peak and duration are approximate label ranges - verify against local product information.</div>' +
      '<div class="ins-cmp-scroll ins-bf"><div class="ins-cmp" style="' + cols + '">' + cells + '</div></div>';
  }
  function pressLibClass() { var b = document.querySelectorAll('[data-ins="lib-class"]'); for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", b[i].getAttribute("data-c") === st.libClass); }

  /* ---------- patient profiles UI ---------- */
  function patientsHTML() {
    var hasCases = !!(window.SMD_CASES && window.SMD_OWNER_KEY);
    return '<div class="ins-search ins-bf">' + ICON_SEARCH +
        '<input id="insPatQ" data-ins="pat-q" type="search" placeholder="Search patients" value="' + esc(st.patQ) + '" aria-label="Search patients"></div>' +
      '<div class="ins-patrow-actions ins-bf"><button class="ins-qa-btn" data-ins="p-new">New patient</button>' +
        (hasCases ? '<button class="ins-qa-btn" data-ins="p-import">Import from saved cases</button>' : '') + '</div>' +
      '<div id="insPatList"></div>';
  }
  function renderPatientList() {
    var list = document.getElementById("insPatList"); if (!list) return;
    var q = st.patQ.toLowerCase().trim(), all = loadPatients();
    var pts = all.filter(function (p) {
      if (!q) return true;
      return (p.name || "").toLowerCase().indexOf(q) > -1 || (p.dxType || "").toLowerCase().indexOf(q) > -1 || (p.notes || "").toLowerCase().indexOf(q) > -1;
    });
    if (!pts.length) { list.innerHTML = '<div class="ins-empty">' + (all.length ? "No patients match." : "No saved patients yet. Create a reusable profile to carry ICR, ISF, target and flags between calculations. No MRN or DOB is stored.") + '</div>'; return; }
    list.innerHTML = pts.map(function (p) {
      var meta = [];
      if (p.age) meta.push(p.age + " y"); if (p.sex) meta.push(p.sex); if (p.dxType) meta.push(p.dxType);
      var params = [];
      if (num(p.icr)) params.push("ICR " + p.icr); if (num(p.isf)) params.push("ISF " + p.isf); if (num(p.target)) params.push("Tgt " + p.target);
      return '<div class="ins-pt-card"><button class="ins-pt-main" data-ins="p-open" data-id="' + p.id + '">' +
        '<span class="ins-pt-name">' + esc(p.name || "Unnamed") + '<span class="ins-pt-sub">' + (meta.join(" &middot; ") || "No details") + (params.length ? "  ·  " + params.join(" · ") : "") + '</span></span></button>' +
        '<button class="ins-pt-use" data-ins="p-use" data-id="' + p.id + '">Use</button></div>';
    }).join("");
  }
  function patientEditHTML() {
    var p = st.editP || newProfile();
    function fld(k, label, val, type) { return '<div class="ins-mini"><label>' + label + '</label><input data-ins="p-field" data-k="' + k + '" type="' + (type || "text") + '"' + (type === "number" ? ' inputmode="decimal"' : '') + ' value="' + esc(val == null ? "" : val) + '"></div>'; }
    function tog(k, label) { return '<button class="ins-chip" data-ins="p-flag" data-k="' + k + '" aria-pressed="' + (p[k] ? "true" : "false") + '">' + label + '</button>'; }
    function bsel() {
      var db = window.INSULIN_DB; if (!db) return "";
      function opts(cls) { return '<optgroup label="' + cls + '">' + db.byClass(cls).map(function (d) { return '<option value="' + d.id + '"' + (d.id === p.bolus ? " selected" : "") + '>' + d.generic + '</option>'; }).join("") + '</optgroup>'; }
      return '<select class="ins-select" data-ins="p-field" data-k="bolus" aria-label="Preferred bolus insulin">' + opts("Rapid-acting") + opts("Short-acting") + '</select>';
    }
    var bmi = bmiOf(p);
    return '<div class="ins-card ins-bf"><div class="ins-card-t">Identity</div>' +
        '<div class="ins-field">' + fld("name", "Name", p.name) + '</div>' +
        '<div class="ins-field"><div class="ins-grid2">' + fld("age", "Age (years)", p.age, "number") + fld("sex", "Sex", p.sex) + '</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + fld("heightCm", "Height (cm)", p.heightCm, "number") + fld("weightKg", "Weight (kg)", p.weightKg, "number") + '</div>' +
          (bmi ? '<div class="ins-tgt-note">BMI ' + bmi + ' kg/m2 (auto)</div>' : '') + '</div>' +
        '<div class="ins-field">' + fld("dxType", "Diabetes type", p.dxType) + '</div>' +
        '<div class="ins-field">' + fld("regimen", "Current insulin regimen", p.regimen) + '</div>' +
        '<div class="ins-field">' + fld("notes", "Clinical notes", p.notes) + '</div></div>' +
      '<div class="ins-card ins-bf"><div class="ins-card-t">Insulin parameters</div>' +
        '<div class="ins-field"><div class="ins-grid2">' + fld("icr", "ICR g/u", p.icr, "number") + fld("isf", "ISF mg/dL/u", p.isf, "number") + fld("target", "Target mg/dL", p.target, "number") + '</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + fld("tdd", "TDD units/day", p.tdd, "number") + fld("dia", "Insulin action DIA (h)", p.dia, "number") + '</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + fld("maxBolus", "Max bolus (u)", p.maxBolus, "number") + fld("maxDaily", "Max daily (u)", p.maxDaily, "number") + '</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Preferred bolus insulin</div>' + bsel() + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Flags</div><div class="ins-chips">' + tog("pregnancy", "Pregnancy") + tog("renal", "Renal") + tog("hepatic", "Hepatic") + tog("steroids", "Steroids") + '</div></div></div>' +
      '<button class="ins-cta" data-ins="p-save">' + (p.id ? "Save changes" : "Save patient") + '</button>' +
      (p.id ? '<div class="ins-patedit-actions"><button class="ins-qa-btn" data-ins="p-use" data-id="' + p.id + '">Use in calculator</button>' +
        '<button class="ins-pt-del" data-ins="p-del" data-id="' + p.id + '">Delete</button></div>' : '');
  }

  /* ---------- insulin conversion ---------- */
  function convInsOpts(sel) {
    var db = window.INSULIN_DB;
    return db.CLASSES.map(function (c) {
      return '<optgroup label="' + c + '">' + db.byClass(c).map(function (d) {
        return '<option value="' + d.id + '"' + (d.id === sel ? " selected" : "") + '>' + d.generic + '</option>';
      }).join("") + '</optgroup>';
    }).join("");
  }
  function convertHTML() {
    if (!window.INSULIN_DB) return '<div class="ins-empty">Insulin database not loaded.</div>';
    var reasons = ["", "Simplify regimen", "Reduce hypoglycaemia", "Cost or availability", "Improve control", "Device preference", "Renal or hepatic change", "Pregnancy planning"];
    var ropts = reasons.map(function (rz) { return '<option value="' + rz + '"' + (rz === st.convReason ? " selected" : "") + '>' + (rz || "Select a reason (optional)") + '</option>'; }).join("");
    return '<div class="ins-card ins-bf"><div class="ins-card-t">Switch details</div>' +
        '<div class="ins-field"><div class="ins-lab">Current insulin</div><select class="ins-select" data-ins="conv-sel" data-k="convFrom">' + convInsOpts(st.convFrom) + '</select></div>' +
        '<div class="ins-field"><div class="ins-lab">Current total daily dose <span class="u">units</span></div>' + stepper("convDose", st.convDose, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Target insulin</div><select class="ins-select" data-ins="conv-sel" data-k="convTo">' + convInsOpts(st.convTo) + '</select></div>' +
        '<div class="ins-field"><div class="ins-lab">Reason for switching</div><select class="ins-select" data-ins="conv-sel" data-k="convReason">' + ropts + '</select></div>' +
      '</div><div id="insConvOut"></div>';
  }
  function renderConvert() {
    var out = document.getElementById("insConvOut"); if (!out || !window.INSULIN_CONVERT) return;
    st.convAck = false;
    var res = window.INSULIN_CONVERT.convert({ fromId: st.convFrom, toId: st.convTo, dose: st.convDose, reason: st.convReason });
    if (res.error) { out.innerHTML = '<div class="ins-card ins-result"><div class="ins-card-t">Suggested regimen</div><p style="color:var(--ins-muted);font-size:13px;margin:0">' + res.error + '</p></div>'; return; }
    var headline;
    if (res.suggested && typeof res.suggested === "object") {
      headline = '<div class="ins-conv-regimen"><div class="ins-conv-cell"><span class="ins-conv-n">' + res.suggested.basal + '</span><span class="ins-conv-u">units basal</span></div>' +
        '<div class="ins-conv-cell"><span class="ins-conv-n">' + res.suggested.bolusEach + '</span><span class="ins-conv-u">units per meal</span></div></div>' +
        '<div class="ins-fromraw">' + res.fromName + ' &rarr; basal-bolus &middot; prandial ' + res.suggested.bolusInsulin + '</div>';
    } else {
      headline = '<div class="ins-dose"><span class="n">' + res.suggested + '</span><span class="unit">units/day</span></div>' +
        '<div class="ins-fromraw">' + res.fromName + ' &rarr; ' + res.toName + ' &middot; ' + res.kind + '</div>';
    }
    function list(items) { return items.map(function (x) { return '<li>' + x + '</li>'; }).join(""); }
    var steps = (res.steps || []).map(function (s) { return '<li><span class="k">' + s.label + '<br><span class="e">' + s.expr + '</span></span><span class="v">' + s.value + '</span></li>'; }).join("");
    var warnHTML = (res.warnings || []).map(function (w) {
      return '<div class="ins-warn caution"><span class="ins-warn-band">' + sevIcon("caution") + '</span><div class="ins-warn-body"><span class="ins-warn-sig">Caution</span><span class="bd">' + w + '</span></div></div>';
    }).join("");
    out.innerHTML =
      '<div class="ins-card ins-result ins-bf"><div class="ins-card-t">Suggested starting regimen</div>' + headline +
        (steps ? '<ul class="ins-steps">' + steps + '</ul>' : '') +
        (res.assumptions.length ? '<div class="ins-conv-sec"><h4>Assumptions</h4><ul>' + list(res.assumptions) + '</ul></div>' : '') +
        (res.monitoring.length ? '<div class="ins-conv-sec"><h4>Monitoring</h4><ul>' + list(res.monitoring) + '</ul></div>' : '') +
        '<div class="ins-conv-sec"><h4>Follow-up</h4><p>' + res.followUp + '</p></div>' +
        '<div class="ins-conv-sec ins-howp-src"><h4>Reference</h4><ul>' + list(res.refs) + '</ul></div>' +
      '</div>' +
      (warnHTML ? '<div class="ins-card ins-warns ins-bf"><div class="ins-card-t">Safety</div>' + warnHTML + '</div>' : '') +
      '<label class="ins-ack"><input type="checkbox" data-ins="conv-ack"> I have reviewed this switch and will verify it against my institutional protocol.</label>' +
      '<button class="ins-cta" data-ins="conv-confirm" disabled>Confirm and record switch</button>' +
      '<div class="ins-done" id="insConvDone" style="display:none">Switch recorded. Titrate to target and review at follow-up. The order remains the physician\'s to place.</div>';
  }

  /* ---------- Calculator ---------- */
  function stGet(f) { if (f.indexOf(".") > -1) { var p = f.split("."); return Number(st[p[0]][p[1]]) || 0; } return Number(st[f]) || 0; }
  function stSet(f, v) { if (f.indexOf(".") > -1) { var p = f.split("."); st[p[0]][p[1]] = v; } else st[f] = v; }

  var MODES = [
    { id: "combined", label: "Combined" }, { id: "meal", label: "Meal bolus" }, { id: "correction", label: "Correction" },
    { id: "basal", label: "Basal init" }, { id: "isf", label: "ISF" }, { id: "icr", label: "Carb ratio" },
    { id: "iob", label: "Active insulin" },
    { id: "pediatric", label: "Pediatric", clin: true }, { id: "dka", label: "DKA infusion", clin: true }
  ];
  function glucoseMode(m) { return m === "combined" || m === "correction"; }
  function bolusMode(m) { return ["combined", "meal", "correction", "iob"].indexOf(m) > -1; }
  function clinMode(m) { return m === "pediatric" || m === "dka"; }
  function doseUnitMode(m) { return ["combined", "meal", "correction", "basal", "pediatric"].indexOf(m) > -1; }

  function calcHTML() {
    return (st.patientId ? '<div class="ins-patchip ins-bf">' + ICON_USER + '<span>' + esc(st.patientName) + '</span>' +
        '<button data-ins="p-clear" aria-label="Clear patient">&times;</button></div>' : '') +
      '<div class="ins-ai ins-bf">' + ICON_AI +
        '<div><b>AI-assisted recommendation.</b> The treating physician makes the final decision. ' +
        'Every value below is shown with its formula and assumptions - nothing is hidden.</div></div>' +
      '<div class="ins-modes ins-bf" role="tablist">' + MODES.map(function (m) {
        return '<button class="ins-modebtn' + (m.clin ? " clin" : "") + '" role="tab" data-ins="mode" data-mode="' + m.id + '" aria-pressed="' + (st.mode === m.id ? "true" : "false") + '">' + m.label + '</button>';
      }).join("") + '</div>' +
      '<div class="ins-card ins-bf" id="insInputs"></div>' +
      '<div id="insOut"></div>';
  }
  function clinBanner(m) {
    return '<div class="ins-clin ins-bf"><span class="ins-warn-band">' + SVG_TRI + '</span>' +
      '<div class="ins-warn-body"><span class="ins-warn-sig">Trained clinicians only</span>' +
      '<span class="bd">' + (m === "dka" ? "Clinician DKA insulin protocol. Verify against your institutional DKA guideline; start after fluids and a potassium check." :
        "Paediatric insulin initiation. Specialist-guided; not for ketoacidosis.") + '</span></div></div>';
  }
  function rule(g, v, label) {
    return '<button class="ins-round-b" data-ins="rule" data-g="' + g + '" data-v="' + v + '" aria-pressed="' + (st[g] === v ? "true" : "false") + '">' + label + '</button>';
  }
  function stepper(id, val, stepv) {
    return '<div class="ins-step">' +
      '<button data-ins="dec" data-f="' + id + '" data-s="' + stepv + '" aria-label="decrease">-</button>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '">' +
      '<button data-ins="inc" data-f="' + id + '" data-s="' + stepv + '" aria-label="increase">+</button></div>';
  }
  function mini(id, label, val) {
    return '<div class="ins-mini"><label>' + label + '</label>' +
      '<input data-ins="num" data-f="' + id + '" type="number" inputmode="decimal" value="' + val + '"></div>';
  }
  function ctxChip(key, label) { return '<button class="ins-chip" data-ins="ctx" data-k="' + key + '" aria-pressed="' + (st.ctx[key] ? "true" : "false") + '">' + label + '</button>'; }
  function tgtChip(v) { return '<button class="ins-chip" data-ins="target-chip" data-v="' + v + '" aria-pressed="' + (st.target === v ? "true" : "false") + '">' + v + '</button>'; }

  /* ---------- selected bolus insulin (influences timing, IOB DIA, safety) ---------- */
  function bolusInsulin() { var db = window.INSULIN_DB; return db ? db.get(st.bolus) : null; }
  function bolusDia() { var d = bolusInsulin(); return d && d.dia ? d.dia : 4; }
  function bolusSelectHTML() {
    var db = window.INSULIN_DB; if (!db) return "";
    function opts(cls) {
      var g = db.byClass(cls).map(function (d) {
        var brand = d.brands && d.brands[0] ? " (" + d.brands[0].name + ")" : "";
        return '<option value="' + d.id + '"' + (d.id === st.bolus ? " selected" : "") + '>' + d.generic + brand + '</option>';
      }).join("");
      return '<optgroup label="' + cls + '">' + g + '</optgroup>';
    }
    return '<select class="ins-select" data-ins="bolus" aria-label="Bolus insulin">' + opts("Rapid-acting") + opts("Short-acting") + '</select>';
  }
  function bolusGuideHTML() {
    var d = bolusInsulin(); if (!d) return "";
    return '<div class="ins-guide">Give ' + d.timing.charAt(0).toLowerCase() + d.timing.slice(1) +
      '. Onset ' + d.onset + ' &middot; peak ' + d.peak + ' &middot; lasts ' + d.duration + '.</div>';
  }
  function recentBolusDoses() {
    var dia = bolusDia(), log = loadLog(), now = Date.now(), doses = [], i;
    for (i = 0; i < log.length; i++) {
      var e = log[i]; if (!e.ts) continue;
      if (["meal", "correction", "combined"].indexOf(e.mode) < 0) continue;
      var mins = (now - e.ts) / 60000;
      if (mins < 0 || mins > dia * 60) continue;
      doses.push({ units: Number(e.confirmedDose) || 0, minutesAgo: mins });
    }
    return doses;
  }
  function estimateIOB() {
    var doses = recentBolusDoses(), dia = bolusDia();
    var r = window.INSULIN_ENGINE.activeInsulin({ doses: doses, dia: dia });
    return { iob: r.result, n: doses.length, dia: dia };
  }

  function pedChip(v, label) { return '<button class="ins-chip" data-ins="pedstage" data-v="' + v + '" aria-pressed="' + (st.pedStage === v ? "true" : "false") + '">' + label + '</button>'; }
  function renderInputs() {
    var m = st.mode, h = "", presets = targetPresets(), i;
    if (clinMode(m)) h += clinBanner(m);
    if (bolusMode(m)) h += '<div class="ins-field"><div class="ins-lab">Bolus insulin</div>' + bolusSelectHTML() + bolusGuideHTML() + '</div>';

    if (glucoseMode(m)) {
      h += '<div class="ins-field"><div class="ins-lab">Current glucose <span class="u">' + gUnit() + '</span></div>' + stepper("glucose", st.glucose, gStep()) + '</div>';
      var chips = ""; for (i = 0; i < presets.length; i++) chips += tgtChip(presets[i]);
      h += '<div class="ins-field"><div class="ins-lab">Target glucose <span class="u">' + gUnit() + '</span></div>' +
        '<div class="ins-tgt"><input class="ins-tgt-in" data-ins="num" data-f="target" type="number" inputmode="decimal" min="1" value="' + st.target + '" aria-label="Target glucose">' +
        '<div class="ins-chips">' + chips + '</div></div>' +
        '<div class="ins-tgt-note">Type any target - a higher interim target gives gradual correction of a very high glucose.</div></div>';
    }
    if (m === "combined" || m === "meal") h += '<div class="ins-field"><div class="ins-lab">Carbohydrates <span class="u">g</span></div>' + stepper("carbs", st.carbs, 5) + '</div>';

    if (glucoseMode(m) || m === "meal") {
      h += '<div class="ins-field"><div class="ins-grid2">';
      if (glucoseMode(m)) h += mini("isf", "ISF " + isfUnit(), st.isf);
      if (m === "combined" || m === "meal") h += mini("icr", "ICR g/u", st.icr);
      if (m === "combined") h += mini("iob", "Active insulin (IOB) u", st.iob);
      h += '</div></div>';
      if (m === "combined") {
        var nd = recentBolusDoses().length;
        h += '<div class="ins-field"><button class="ins-iob-est" data-ins="iob-est"' + (nd ? "" : " disabled") + '>' +
          (nd ? 'Estimate IOB from ' + nd + ' recent dose' + (nd > 1 ? 's' : '') : 'No recent doses to estimate IOB') + '</button>' +
          (st.iobNote ? '<div class="ins-iob-note">' + st.iobNote + '</div>' : '') + '</div>';
      }
    }

    if (m === "isf")
      h += '<div class="ins-field"><div class="ins-lab">Total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Rule</div><div class="ins-round">' + rule("isfRule", 1800, "1800 (rapid)") + rule("isfRule", 1500, "1500 (regular)") + '</div></div>';
    if (m === "icr")
      h += '<div class="ins-field"><div class="ins-lab">Total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Rule</div><div class="ins-round">' + rule("icrRule", 500, "500 (rapid)") + rule("icrRule", 450, "450 (regular)") + '</div></div>';
    if (m === "basal")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("tddFactor", "Start factor u/kg/day", st.tddFactor) + mini("basalFraction", "Basal fraction", st.basalFraction) + '</div></div>';
    if (m === "pediatric")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Stage</div><div class="ins-chips">' + pedChip("prepubertal", "Prepubertal") + pedChip("newlydx", "Newly diagnosed") + pedChip("pubertal", "Pubertal") + '</div></div>';
    if (m === "dka")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Infusion rate</div><div class="ins-round">' +
          '<button class="ins-round-b" data-ins="dkarate" data-v="0.1" aria-pressed="' + (st.dkaRate === 0.1 ? "true" : "false") + '">0.1 u/kg/h</button>' +
          '<button class="ins-round-b" data-ins="dkarate" data-v="0.05" aria-pressed="' + (st.dkaRate === 0.05 ? "true" : "false") + '">0.05 u/kg/h</button></div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("dkaMax", "Max rate u/h (optional)", st.dkaMax) + '</div>' +
          '<button class="ins-chip" data-ins="dkapaeds" aria-pressed="' + (st.dkaPaeds ? "true" : "false") + '" style="margin-top:10px">Paediatric DKA</button></div>';
    if (m === "iob") {
      var doses = recentBolusDoses();
      h += '<div class="ins-field"><div class="ins-lab">Active insulin from recent doses</div>' +
        '<div class="ins-guide">Sums confirmed bolus doses within the selected insulin duration of action (' + bolusDia() + ' h). ' + doses.length + ' dose' + (doses.length !== 1 ? 's' : '') + ' in window.</div></div>';
    }

    if (doseUnitMode(m)) h += '<div class="ins-field"><div class="ins-lab">Rounding</div><div class="ins-round">' +
      '<button data-ins="round" data-v="1" aria-pressed="' + (st.increment === 1 ? "true" : "false") + '">1 unit</button>' +
      '<button data-ins="round" data-v="0.5" aria-pressed="' + (st.increment === 0.5 ? "true" : "false") + '">0.5 unit</button></div></div>';

    if (["isf", "icr", "iob"].indexOf(m) < 0) h += '<div class="ins-field"><div class="ins-lab">Patient context</div><div class="ins-chips">' +
      ctxChip("pregnancy", "Pregnancy") + ctxChip("renal", "Renal") + ctxChip("hepatic", "Hepatic") + ctxChip("exercise", "Exercise") + ctxChip("steroids", "Steroids") +
      (m !== "pediatric" ? '<button class="ins-chip" data-ins="peds" aria-pressed="' + (st.ctx.age < 18 ? "true" : "false") + '">Pediatric</button>' : '') + '</div></div>';

    document.getElementById("insInputs").innerHTML = h;
  }

  function compute() {
    var E = window.INSULIN_ENGINE, m = st.mode, G = toMgdl(st.glucose), T = toMgdl(st.target), ISF = toMgdl(st.isf);
    if (m === "meal") return E.mealBolus({ carbs: st.carbs, icr: st.icr, increment: st.increment });
    if (m === "correction") return E.correctionDose({ glucose: G, target: T, isf: ISF, increment: st.increment });
    if (m === "basal") return E.basalInitiation({ weightKg: st.ctx.weightKg, tddFactor: st.tddFactor, basalFraction: st.basalFraction, increment: st.increment });
    if (m === "isf") return E.isfFromTdd({ tdd: st.tdd, rule: st.isfRule });
    if (m === "icr") return E.icrFromTdd({ tdd: st.tdd, rule: st.icrRule });
    if (m === "iob") return E.activeInsulin({ doses: recentBolusDoses(), dia: bolusDia() });
    if (m === "pediatric") return E.pediatricInit({ weightKg: st.ctx.weightKg, stage: st.pedStage, increment: st.increment });
    if (m === "dka") return E.dkaInsulin({ weightKg: st.ctx.weightKg, ratePerKg: st.dkaRate,
      maxRate: (st.dkaMax !== "" && isFinite(Number(st.dkaMax)) ? Number(st.dkaMax) : undefined), paeds: st.dkaPaeds });
    return E.combinedDose({ carbs: st.carbs, icr: st.icr, glucose: G, target: T, isf: ISF, iob: st.iob, increment: st.increment });
  }
  function safety(res) {
    var S = window.INSULIN_SAFETY, m = st.mode;
    if (["isf", "icr", "iob"].indexOf(m) > -1) return S.evaluate({}, { noGlucose: true }, res);
    var input = glucoseMode(m) ? { glucose: toMgdl(st.glucose), target: toMgdl(st.target), iob: m === "combined" ? st.iob : 0 } : { noGlucose: true };
    var boluses = ["combined", "meal", "correction"].indexOf(m) > -1;
    var ctx = { age: st.ctx.age, weightKg: st.ctx.weightKg, pregnancy: st.ctx.pregnancy, renal: st.ctx.renal, hepatic: st.ctx.hepatic,
      exercise: st.ctx.exercise, steroids: st.ctx.steroids };
    if (boluses) { ctx.maxBolus = SET.maxBolus; ctx.maxDaily = SET.maxDaily; if (res && res.rounded != null) res.dailyTotal = todayTotal() + res.rounded; }
    return S.evaluate(ctx, input, res);
  }

  function render() {
    st.acked = false; st.confirmed = false;
    var res = compute(), warns = safety(res), hasCritical = false, i;
    var selIns = bolusInsulin();
    if (bolusMode(st.mode) && selIns && selIns.cls === "Short-acting") warns.push({ id: "reg_timing", severity: "info",
      title: "Short-acting (regular) insulin selected",
      detail: "Onset about 30 min, peak 2 to 4 h. Give about 30 min before the meal and re-check glucose before stacking a correction.", interrupt: false });
    for (i = 0; i < warns.length; i++) if (warns[i].interrupt) hasCritical = true;
    var out = document.getElementById("insOut");
    if (!out) return;

    if (res.error || res.rounded == null) {
      out.innerHTML = '<div class="ins-card ins-result"><div class="ins-card-t">Recommendation</div>' +
        '<p style="color:var(--ins-muted);font-size:13px;margin:0">' + res.error + '</p></div>';
      return;
    }

    var stepsHTML = res.steps.map(function (s) {
      return '<li><span class="k">' + s.label + '<br><span class="e">' + s.expr + '</span></span><span class="v">' + s.value + '</span></li>';
    }).join("");
    var assumeHTML = (res.assumptions || []).concat(res.clinicalNotes || []).map(function (a) { return '<li>' + a + '</li>'; }).join("");
    var refsHTML = (res.refs || []).map(function (r) { return '<li>' + r + '</li>'; }).join("");
    var warnHTML = warns.map(function (w) {
      return '<div class="ins-warn ' + w.severity + '"><span class="ins-warn-band">' + sevIcon(w.severity) + '</span>' +
        '<div class="ins-warn-body"><span class="ins-warn-sig">' + sevLabel(w.severity) + '</span>' +
        '<span class="wt">' + w.title + '</span><span class="bd">' + w.detail + '</span></div></div>';
    }).join("");

    var m = st.mode;
    var actionable = ["combined", "meal", "correction", "basal", "pediatric", "dka"].indexOf(m) > -1;
    var cardTitle = (m === "isf" || m === "icr") ? "Result" : m === "iob" ? "Active insulin (IOB)" : m === "dka" ? "Infusion rate" : (m === "basal" || m === "pediatric") ? "Suggested regimen" : "Recommended dose";
    var extraRaw = m === "combined" ? 'meal ' + res.mealComponent + 'u + correction ' + res.correctionComponent + 'u - IOB ' + res.iobSubtracted + 'u' : "";
    var unitNote = mmolMode() ? ' &middot; working shown in mg/dL (canonical); entries converted from mmol/L' : '';
    var fromraw = 'Computed ' + res.result + ' ' + res.unit + (doseUnitMode(m) ? ', rounded to ' + st.increment + ' unit' : '') + (extraRaw ? ' &middot; ' + extraRaw : '') + unitNote;
    var monitoringHTML = (res.monitoring && res.monitoring.length) ? '<div class="ins-conv-sec"><h4>Monitoring</h4><ul>' + res.monitoring.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' : "";
    var showCritAck = hasCritical && !clinMode(m);
    var ctaDisabled = showCritAck || (clinMode(m) && !st.advAck);

    out.innerHTML =
      '<div class="ins-card ins-result ins-bf"><div class="ins-card-t">' + cardTitle + '</div>' +
        '<div class="ins-dose"><span class="n" id="insDoseN">0</span><span class="unit">' + res.unit + '</span></div>' +
        '<div class="ins-fromraw">' + fromraw + '</div>' +
        '<div class="ins-formula">' + res.formula + '</div>' +
        '<ul class="ins-steps">' + stepsHTML + '</ul>' + monitoringHTML +
        '<button class="ins-how" data-ins="how" aria-expanded="false">' + ICON_BOOK + '<span>How it works</span>' + ICON_CHEV + '</button>' +
        '<div class="ins-howp" hidden>' +
          '<div class="ins-howp-sec"><h4>Method</h4><p>' + howItWorks(m) + '</p></div>' +
          '<div class="ins-howp-sec"><h4>Formula</h4><code>' + res.formula + '</code></div>' +
          (assumeHTML ? '<div class="ins-howp-sec"><h4>What the numbers mean</h4><ul>' + assumeHTML + '</ul></div>' : '') +
          (refsHTML ? '<div class="ins-howp-sec ins-howp-src"><h4>Trusted medical source</h4><ul>' + refsHTML + '</ul></div>' : '') +
        '</div>' +
      '</div>' +
      (warnHTML ? '<div class="ins-card ins-warns ins-bf"><div class="ins-card-t">Safety checks</div>' + warnHTML +
        (showCritAck ? '<label class="ins-ack"><input type="checkbox" data-ins="ack"> I have reviewed the critical warning above and take clinical responsibility.</label>' : '') + '</div>' : '') +
      (actionable ?
        (clinMode(m) ? '<label class="ins-ack"><input type="checkbox" data-ins="adv-ack"' + (st.advAck ? " checked" : "") + '> I am a trained clinician, have verified this against my institutional protocol, and take clinical responsibility.</label>' : '') +
        '<button class="ins-cta" data-ins="confirm"' + (ctaDisabled ? ' disabled' : '') + '>Accept ' + res.rounded + ' ' + res.unit + '</button>' +
        '<div class="ins-done" id="insDone" style="display:none">Recorded to history. The order remains the physician\'s to place.</div>' : '');

    var dn = document.getElementById("insDoseN"); if (dn) countUp(dn, res.rounded);
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "close") return close();
    if (a === "go-settings") return go("settings");
    if (a === "go-dash") return go("dashboard");
    if (a === "go-library") return go("library");
    if (a === "go-compare") { if (st.compare.length >= 2) go("compare"); return; }
    if (a === "cmp-clear") { st.compare = []; renderLibList(); return; }
    if (a === "lib-class") { st.libClass = t.getAttribute("data-c"); pressLibClass(); renderLibList(); return; }
    if (a === "lib-open") { var lid = t.getAttribute("data-id"); st.libOpen = st.libOpen === lid ? null : lid; renderLibList(); return; }
    if (a === "go-patients") { st.editP = null; return go("patients"); }
    if (a === "p-new") { st.editP = newProfile(); return go("patient"); }
    if (a === "p-open") { st.editP = clone(getPatient(t.getAttribute("data-id")) || newProfile()); return go("patient"); }
    if (a === "p-save") { if (st.editP) savePatient(st.editP); st.editP = null; return go("patients"); }
    if (a === "p-del") { var did = t.getAttribute("data-id"); deletePatient(did); if (st.patientId === did) { st.patientId = null; st.patientName = ""; } st.editP = null; return go("patients"); }
    if (a === "p-flag") { if (!st.editP) st.editP = newProfile(); var fk = t.getAttribute("data-k"); st.editP[fk] = !st.editP[fk]; t.setAttribute("aria-pressed", st.editP[fk]); return; }
    if (a === "p-clear") { st.patientId = null; st.patientName = ""; paint(); return; }
    if (a === "p-use") {
      var pu = (st.screen === "patient" && st.editP) ? savePatient(st.editP) : getPatient(t.getAttribute("data-id"));
      if (pu) { applyProfile(pu); go("calc"); }
      return;
    }
    if (a === "p-import") {
      if (!window.SMD_CASES || !window.SMD_OWNER_KEY) return;
      try {
        SMD_CASES.getAll(SMD_OWNER_KEY(), false, function (cases) {
          var existing = {}; loadPatients().forEach(function (p) { existing[(p.name || "").toLowerCase()] = 1; });
          var added = 0;
          (cases || []).forEach(function (c) {
            var nm = (c.name || "").trim(); if (!nm || existing[nm.toLowerCase()]) return;
            savePatient({ id: null, name: nm, sex: c.sex || "", age: c.age || "", weightKg: "", notes: c.notes || "",
              dxType: "", pregnancy: false, renal: false, hepatic: false, icr: "", isf: "", target: "", bolus: st.bolus });
            existing[nm.toLowerCase()] = 1; added++;
          });
          renderPatientList();
          if (window.toast) toast(added ? added + " patient" + (added > 1 ? "s" : "") + " imported from cases" : "No new cases to import");
        });
      } catch (e) {}
      return;
    }
    if (a === "go-convert") return go("convert");
    if (a === "go-history") return go("history");
    if (a === "hist-filter") { st.histFilter = t.getAttribute("data-v"); var hb = document.querySelectorAll('[data-ins="hist-filter"]'); for (var hi = 0; hi < hb.length; hi++) hb[hi].setAttribute("aria-pressed", hb[hi].getAttribute("data-v") === st.histFilter); renderHistList(); return; }
    if (a === "hist-export") { var csv = histCSV(); try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(csv); } catch (e) {} if (window.toast) toast("Dose history CSV copied to clipboard"); else t.textContent = "Copied"; return; }
    if (a === "conv-confirm") {
      var cc = document.querySelector(".ins-cta"); if (cc && cc.disabled) return;
      if (cc) cc.style.display = "none";
      var cd = document.getElementById("insConvDone"); if (cd) { cd.style.display = "block"; springIn(cd); }
      return;
    }
    if (a === "qa") { st.mode = t.getAttribute("data-mode"); go("calc"); return; }
    if (a === "mode") { st.mode = t.getAttribute("data-mode"); syncSeg(); renderInputs(); render(); return; }
    if (a === "inc" || a === "dec") {
      var f = t.getAttribute("data-f"), s = parseFloat(t.getAttribute("data-s"));
      var nv = Math.max(0, Math.round((stGet(f) + (a === "inc" ? s : -s)) * 100) / 100);
      stSet(f, nv);
      var inp = t.parentNode.querySelector('input[data-f="' + f + '"]'); if (inp) inp.value = nv;
      if (st.screen === "convert") renderConvert(); else render(); return;
    }
    if (a === "round") { st.increment = parseFloat(t.getAttribute("data-v")); SET.increment = st.increment; saveSettings(); pressGroup("round"); if (st.screen === "calc") render(); return; }
    if (a === "target-chip") { st.target = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "rule") { st[t.getAttribute("data-g")] = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "pedstage") { st.pedStage = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "dkarate") { st.dkaRate = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "dkapaeds") { st.dkaPaeds = !st.dkaPaeds; renderInputs(); render(); return; }
    if (a === "ctx") { var k = t.getAttribute("data-k"); st.ctx[k] = !st.ctx[k]; t.setAttribute("aria-pressed", st.ctx[k]); render(); return; }
    if (a === "peds") { st.ctx.age = st.ctx.age < 18 ? 40 : 8; t.setAttribute("aria-pressed", st.ctx.age < 18); render(); return; }
    if (a === "iob-est") {
      var est = estimateIOB(); st.iob = est.iob;
      var bd = bolusInsulin();
      st.iobNote = "IOB " + est.iob + " u estimated from " + est.n + " recent dose" + (est.n > 1 ? "s" : "") +
        " using " + (bd ? bd.generic : "the selected insulin") + " (duration " + est.dia + " h).";
      renderInputs(); render(); return;
    }
    if (a === "how") {
      var exp = t.getAttribute("aria-expanded") === "true", panel = t.nextElementSibling;
      t.setAttribute("aria-expanded", exp ? "false" : "true");
      if (exp) { if (panel) panel.hidden = true; }
      else if (panel) { panel.hidden = false; if (!reduced()) withMotion(function (M) { try { M.animate(panel, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.28, easing: [0.2, 0.7, 0.2, 1] }); } catch (e) {} }); }
      return;
    }
    if (a === "confirm") return confirmDose(t);
  }
  function onInput(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "num") { var f = t.getAttribute("data-f"); stSet(f, parseFloat(t.value)); if (f === "target") syncTargetChips(); if (f === "iob") { st.iobNote = ""; var nEl = document.querySelector(".ins-iob-note"); if (nEl) nEl.remove(); } if (st.screen === "convert") renderConvert(); else render(); return; }
    if (a === "bolus") { st.bolus = t.value; SET.bolusInsulin = st.bolus; saveSettings(); renderInputs(); render(); return; }
    if (a === "set-num") { var k = t.getAttribute("data-k"); var v = parseFloat(t.value); if (isFinite(v)) { SET[k] = v; saveSettings(); } return; }
    if (a === "set-text") { SET[t.getAttribute("data-k")] = t.value; saveSettings(); return; }
    if (a === "lib-q") { st.libQ = t.value; renderLibList(); return; }
    if (a === "pat-q") { st.patQ = t.value; renderPatientList(); return; }
    if (a === "p-field") { if (!st.editP) st.editP = newProfile(); st.editP[t.getAttribute("data-k")] = t.value; return; }
    if (a === "conv-sel") { st[t.getAttribute("data-k")] = t.value; renderConvert(); return; }
    if (a === "conv-ack") { st.convAck = t.checked; var cvc = document.querySelector(".ins-cta"); if (cvc) cvc.disabled = !st.convAck; return; }
    if (a === "cmp") {
      var cid = t.getAttribute("data-id"), idx = st.compare.indexOf(cid);
      if (t.checked) { if (idx === -1) { if (st.compare.length >= 3) { t.checked = false; return; } st.compare.push(cid); } }
      else if (idx > -1) st.compare.splice(idx, 1);
      renderLibList(); return;
    }
    if (a === "ack") { st.acked = t.checked; var cta = document.querySelector(".ins-cta"); if (cta) cta.disabled = !st.acked; return; }
    if (a === "adv-ack") { st.advAck = t.checked; var cta2 = document.querySelector(".ins-cta"); if (cta2) cta2.disabled = !st.advAck; return; }
  }
  function syncSeg() {
    var b = document.querySelectorAll('[data-ins="mode"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", b[i].getAttribute("data-mode") === st.mode);
  }
  function pressGroup(name) {
    var b = document.querySelectorAll('[data-ins="' + name + '"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.increment);
  }
  function syncTargetChips() {
    var b = document.querySelectorAll('[data-ins="target-chip"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.target);
  }
  function confirmDose(btn) {
    if (btn.disabled) return;
    var res = compute(), warns = safety(res);
    pushLog({ mode: st.mode, inputs: snapshot(), calculatedDose: res.rounded, confirmedDose: res.rounded,
      unit: res.unit, warnings: warns.map(function (w) { return w.id; }), engineVersion: 1, ts: Date.now() });
    btn.style.display = "none";
    var d = document.getElementById("insDone"); if (d) { d.style.display = "block"; springIn(d); }
  }
  function snapshot() {
    return { units: SET.units, bolus: st.bolus, glucose: st.glucose, target: st.target, carbs: st.carbs, icr: st.icr,
      isf: st.isf, iob: st.iob, increment: st.increment, ctx: clone(st.ctx) };
  }

  /* ---------- open / close ---------- */
  function open() {
    if (!on()) return;
    if (!window.INSULIN_ENGINE || !window.INSULIN_SAFETY) return;
    SET = loadSettings();
    SET.units = "mgdl";                   // mg/dL only (India standard); no other units
    if (!(SET.target >= 60 && SET.target <= 400)) SET.target = DEFAULTS.target;  // sanitise any stale/implausible target
    saveSettings();
    initState();
    var el = root();
    el.classList.add("ins-open");
    document.documentElement.classList.add("ins-lock");
    document.body.classList.add("ins-lock");
    st.screen = "dashboard";
    paint();
    springIn(el.querySelector(".ins-wrap"));
  }
  function close() {
    var el = document.getElementById(ROOT_ID);
    if (el) el.classList.remove("ins-open");
    document.documentElement.classList.remove("ins-lock");
    document.body.classList.remove("ins-lock");
  }

  window.INSULIN = { open: open, close: close, isOn: on };
})();
