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

  // showRounding: rounding is a device/setup preference, set once in Settings. It is only
  // repeated per-calculation for users who ask for it (0.5 u pens, paediatric practice).
  // dxSkipped is a PREFERENCE and persists: a clinician who has said "don't ask me the type"
  // should not be asked again on every launch. The type itself is deliberately NOT persisted
  // globally - it belongs to a patient, and carrying one patient's type to the next is exactly
  // the sort of silent staleness this module is trying to remove.
  var DEFAULTS = { units: "mgdl", increment: 1, target: 120, maxBolus: 15, maxDaily: 100, institution: "", bolusInsulin: "aspart", homeGlass: "standard", showRounding: false, dxSkipped: false };
  var GLASS_MAP = { frosted: "ins-glass ins-glass-frost", liquid: "ins-glass ins-glass-frost ins-glass-sheen",
    tinted: "ins-glass ins-glass-tint", blend: "ins-glass ins-glass-tint ins-glass-sheen" };
  var SET = clone(DEFAULTS);
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function loadSettings() {
    try { var raw = localStorage.getItem(keyFor("settings")); var s = raw ? JSON.parse(raw) : {}; var out = clone(DEFAULTS);
      for (var k in DEFAULTS) if (s[k] != null) out[k] = s[k]; return out; } catch (e) { return clone(DEFAULTS); }
  }
  function saveSettings() { try { localStorage.setItem(keyFor("settings"), JSON.stringify(SET)); } catch (e) {} }

  function loadLog() { try { return JSON.parse(localStorage.getItem(keyFor("log")) || "[]"); } catch (e) { return []; } }
  function saveLog(list) { try { localStorage.setItem(keyFor("log"), JSON.stringify(list.slice(0, 200))); } catch (e) {} }
  function pushLog(entry) { var l = loadLog(); l.unshift(entry); saveLog(l); }

  /* The log is per-DEVICE (one uid, one phone) but a ward round is many patients on that
   * one phone. Every read of the log for a CLINICAL purpose - insulin on board, running
   * daily total - must therefore be scoped to the selected patient, or bed 4's 8 units
   * become bed 7's IOB and six patients share one "max daily dose exceeded" interrupt.
   * A record with no patientId belongs to no patient and is never reused clinically. */
  function logForPatient() {
    var pid = st.patientId;
    if (!pid) return [];                       // no patient selected -> nothing is attributable
    return loadLog().filter(function (e) { return e.patientId === pid; });
  }
  // Only true single boluses count toward a daily UNIT total. Basal/paediatric results are
  // whole-day totals and DKA is units/HOUR - summing those into a unit count is meaningless.
  var BOLUS_LOG_MODES = ["combined", "meal", "correction"];
  function todayTotal() {
    var l = logForPatient(), n = new Date(), y = n.getFullYear(), m = n.getMonth(), d = n.getDate(), sum = 0;
    for (var i = 0; i < l.length; i++) {
      var e = l[i]; if (!e.ts) continue;
      if (BOLUS_LOG_MODES.indexOf(e.mode) < 0) continue;
      if ((e.unit || "units") !== "units") continue;
      var t = new Date(e.ts);
      if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === d) sum += Number(e.givenDose != null ? e.givenDose : e.confirmedDose) || 0;
    }
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
  function wardAvailable() { try { return !!(window.GHIS && window.GHIS.pickPatient && window.GHIS.isConnected && window.GHIS.isConnected()); } catch (e) { return false; } }
  /* Build an insulin profile from a Ward Sync record.
   * DELIBERATELY NOT COPIED: date of birth and any MRN as an identity field. This module's
   * store is MRN/DOB-free by design (see the vault gotcha) and the CSV audit export must stay
   * that way. GHIS carries AGE in its `dob` field, so age is safe to take. The hospital ids
   * live in a separate `ward` block used only to re-link to the roster; they are never written
   * into the dose log and never leave in the CSV export. Weight is NOT guessed - it is the one
   * number every weight-based calculation needs, so the clinician must enter it. */
  function wardProfile(sel, full) {
    var f = full || {}, age = "";
    var a = parseInt(f.dob, 10); if (!isNaN(a) && a > 0 && a < 130) age = a;
    var sex = (f.gender || "").toLowerCase();
    sex = sex.indexOf("f") === 0 ? "F" : sex.indexOf("m") === 0 ? "M" : "";
    var bed = (f.bedName || "").trim(), dept = (f.deptDescription || "").trim();
    return { id: null, name: (sel.name || f.patientFirstName || "Ward patient").trim(),
      sex: sex, age: age, heightCm: "", weightKg: "", dxType: "", regimen: "",
      notes: [dept, bed ? "Bed " + bed : ""].filter(Boolean).join(" - "),
      pregnancy: false, renal: false, hepatic: false, steroids: false,
      icr: "", isf: "", target: "", tdd: "", dia: "", maxBolus: "", maxDaily: "", bolus: st.bolus,
      ward: { source: "ghis", patientId: sel.patientId || "", episodeId: sel.episodeId || "", bed: bed, dept: dept, linkedAt: Date.now() } };
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
    // A saved diabetes type carries through, so the scale band and warnings are right without
    // asking again. Only a recognised id counts - the field is free text on older profiles.
    if (p.dxType && dxTypes()[p.dxType]) {
      st.dxType = p.dxType;
      var g = window.INSULIN_ENGINE.dxGuidance(p.dxType);
      st.scaleResist = g.resistance || "usual";
      if (p.dxType === "t1" || p.dxType === "secondary") st.npoType1 = true;
    }
  }
  function num(x) { return x !== "" && x != null && isFinite(Number(x)); }
  // Blank stays blank. Passing 0 for an empty field would let the engine compute a dose
  // from a value the clinician never entered, which is exactly what the empty defaults fix.
  function N(x) { return num(x) ? Number(x) : undefined; }

  /* ---------- units (display <-> canonical mg/dL) ---------- */
  function mmolMode() { return SET.units === "mmol"; }
  function gUnit() { return mmolMode() ? "mmol/L" : "mg/dL"; }
  function isfUnit() { return mmolMode() ? "mmol/L/u" : "mg/dL/u"; }
  function toMgdl(v) { return mmolMode() ? v * 18 : v; }          // glucose/target/ISF share the /18 factor
  function gStep() { return mmolMode() ? 0.5 : 5; }
  function targetPresets() { return mmolMode() ? [5, 6, 7, 8] : [100, 120, 140, 180]; }

  /* ---------- state ---------- */
  var st = { screen: "dashboard", mode: "correction", group: "now",
    glucose: 180, target: 120, carbs: 45, icr: 10, isf: 50, iob: 2, increment: 1,
    ctx: { age: "", weightKg: "", pregnancy: false, renal: false, hepatic: false, exercise: false, steroids: false, pediatric: false, egfr: null, dialysis: false, trimester: null },
    acked: false, confirmed: false, bolus: "aspart", iobNote: "",
    tdd: 40, isfRule: 1800, icrRule: 500, tddFactor: 0.4, basalFraction: 0.5,
    dkaRate: 0.1, dkaMax: "", pedStage: "prepubertal", dkaPaeds: false, advAck: false,
    libQ: "", libClass: "all", libOpen: null, compare: [],
    patientId: null, patientName: "", editP: null, patQ: "",
    convFrom: "glargine100", convTo: "degludec", convDose: 20, convReason: "", convFromFreq: "bd", convAck: false,
    histFilter: "all" };

  function initState() {
    st.mode = st.mode || "correction"; st.group = groupOf(st.mode);
    /* EVERY clinical input starts EMPTY. This screen previously opened pre-filled with
     * glucose 180, carbs 45, ICR 10, ISF 50, IOB 2, weight 70 - a complete fictional
     * patient - and therefore opened already displaying a "recommended dose" for nobody.
     * The IOB default of 2 was the worst of them: it silently subtracted 2 units from
     * every correction unless the user noticed and cleared it. A dose calculator must
     * ask, never assume. `stGet` coerces "" to 0 so the steppers still work. */
    st.glucose = ""; st.carbs = ""; st.icr = ""; st.isf = ""; st.iob = "";
    st.target = SET.target;          // a real, configured default - not patient data
    st.increment = SET.increment;
    st.bolus = SET.bolusInsulin || "aspart"; st.iobNote = "";
    st.tdd = ""; st.isfRule = 1800; st.icrRule = 500; st.tddFactor = 0.4; st.basalFraction = 0.5;
    // Diabetes type is asked once, up front, and drives the scale band, the suggested
    // workflows and the type-specific warnings. dxSkipped remembers "just take me to the
    // calculator" so the gate is never shown twice in a session.
    st.dxType = st.dxType || ""; st.dxSkipped = !!(st.dxSkipped || SET.dxSkipped);
    st.askQ = "";
    st.nutCarbs = ""; st.nutFeed = "continuous"; st.nutFeeds = 4; st.nutDextrose = "";
    st.hba1c = ""; st.inpBasal = "";
    // Ward workflow inputs - also empty; only method/rule choices carry a default.
    st.curBasal = ""; st.fasting = ""; st.preDinner = ""; st.titrMethod = "units";
    st.scaleResist = "usual"; st.scaleMax = 10;
    st.steroidKind = "prednisolone"; st.steroidMg = "";
    st.ivRate = ""; st.ivPercent = 0.8;
    st.pmMorning = ""; st.pmEvening = ""; st.npoType1 = false; st.npoHypoRisk = false;
    st.creatinine = "";
    st.dkaRate = 0.1; st.dkaMax = ""; st.pedStage = "prepubertal"; st.dkaPaeds = false; st.advAck = false;
    // First-dose / no-prior-data correction pathway (correction mode only). Default "isf" keeps the
    // existing manual behaviour untouched.
    st.corrSource = "isf";           // isf | tdd | estimate
    st.fdNaive = true;               // insulin-naive vs already-using
    st.fdFactor = 0.3;               // insulin-naive TDD assumption (u/kg/day) — editable, shown as an assumption
    st.fdTdd = 30;                   // known usual TDD (u/day)
    st.fdPriorUnits = 0; st.fdPriorMins = 0;   // a prior rapid-acting dose (for IOB when NOT naive)
    st.isfOverride = "";             // optional manual ISF override in tdd/estimate sub-modes
    st.fdRoute = "";                 // "" | dka | pediatric — routes away from a routine correction
    st.ctx = { age: "", weightKg: "", pregnancy: false, renal: false, hepatic: false, exercise: false, steroids: false, pediatric: false, egfr: null, dialysis: false, trimester: null };
    st.acked = false; st.confirmed = false;
    st.patientId = null; st.patientName = ""; st.editP = null; st.patQ = "";
    st.convFrom = "glargine100"; st.convTo = "degludec"; st.convDose = 20; st.convReason = ""; st.convFromFreq = "bd"; st.convAck = false;
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
      iob: "Active insulin (IOB)", pediatric: "Paediatric initiation", dka: "DKA insulin infusion",
      basalT2: "Basal initiation (type 2)", inpatient: "Inpatient basal-bolus initiation",
      premix: "Premix initiation", premixTitr: "Premix titration", titrate: "Basal titration",
      scale: "Correction scale", npo: "Nil by mouth regimen", steroid: "Glucocorticoid cover",
      ivsc: "Intravenous to subcutaneous transition", nutrition: "Enteral or parenteral nutrition",
      periop: "Perioperative regimen", discharge: "Discharge regimen", sick: "Sick-day rules" };
    return L[m] || "Insulin dose";
  }

  function howItWorks(mode) {
    if (mode === "titrate")
      return "Basal insulin is judged on the FASTING glucose alone. If fasting is above target the dose goes up by 2 units and is then held for 3 days, because a basal analogue takes 3 to 4 days to reach steady state. Any hypoglycaemic reading overrides a high average: the dose comes down 10% (20% below 54 mg/dL) and the cause is looked for first. Above about 0.5 units/kg/day more basal stops helping - that is overbasalization, and the missing piece is prandial insulin.";
    if (mode === "scale")
      return "A supplemental correction table built from this patient's own insulin sensitivity rather than a photocopied chart. Each glucose band is (band midpoint - target) divided by the ISF, rounded and capped. It is given before meals, or every 4 to 6 hours if the patient is not eating, ALONGSIDE basal insulin - a correction-only regimen is explicitly discouraged.";
    if (mode === "basalT2")
      return "Type 2 basal initiation. The starting dose is 10 units a day or 0.2 units/kg/day, whichever is lower, and nothing else changes on day one. Prandial insulin is not started at the same time. The dose is then titrated on fasting readings.";
    if (mode === "inpatient")
      return "Weight-based basal-bolus for an admitted patient. The starting factor comes from the admission glucose (0.4 units/kg/day up to 200 mg/dL, 0.5 above it) and drops to 0.3 for age 70 or over or creatinine 2.0 or above. Half is basal, half is split across three meals, and a correction scale sits on top.";
    if (mode === "premix")
      return "Premixed insulin twice daily: about 0.3 units/kg/day to start, two-thirds before breakfast and one-third before dinner. The ratio is fixed, so basal and prandial cannot be moved separately - the patient has to eat on time.";
    if (mode === "premixTitr")
      return "Each premix injection is judged by the reading before the NEXT injection: the morning dose against the pre-dinner value, the evening dose against the fasting value. Only the responsible injection is changed, by 2 units, or reduced 20% for a hypoglycaemic reading.";
    if (mode === "npo")
      return "Nil by mouth. Prandial insulin stops because there is no meal to cover; basal continues because it covers the body's background need, not food. In type 1 the basal is never stopped - doing so causes ketoacidosis even with a normal glucose. In type 2 it is usually reduced. Correction insulin continues every 4 to 6 hours.";
    if (mode === "steroid")
      return "Glucocorticoids raise glucose mainly after lunch and dinner, so cover is matched to the steroid's own curve: NPH given at the same time as the steroid, at 0.1 units/kg/day for every 10 mg of prednisolone equivalent, capped at 0.4 units/kg/day. It is additional to the usual insulin, and it must be tapered on the same day the steroid is.";
    if (mode === "ivsc")
      return "Coming off an insulin infusion. The last 6 hours of stable infusion rates are extrapolated to 24 hours, and 60 to 80% of that becomes the subcutaneous total daily dose. The critical step is timing: the subcutaneous basal must be given 2 to 4 hours BEFORE the drip stops, because it is not active for hours and the gap is what causes rebound hyperglycaemia and recurrent ketoacidosis.";
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
    el.innerHTML = '<div class="ins-gridbg"></div><div class="ins-orbs"></div><div class="ins-scroll"><div class="ins-wrap">' +
      '<div id="insHeader"></div><div id="insScreen"></div></div></div>';
    document.body.appendChild(el);
    el.addEventListener("click", onClick);
    el.addEventListener("input", onInput);
    return el;
  }
  function paint() {
    var root = document.getElementById(ROOT_ID);
    if (root) {
      "ins-glass ins-glass-frost ins-glass-tint ins-glass-sheen".split(" ").forEach(function (c) { root.classList.remove(c); });
      if (st.screen === "dashboard" && SET.homeGlass && SET.homeGlass !== "standard" && GLASS_MAP[SET.homeGlass])
        GLASS_MAP[SET.homeGlass].split(" ").forEach(function (c) { root.classList.add(c); });
    }
    document.getElementById("insHeader").innerHTML = headerHTML();
    var s = document.getElementById("insScreen");
    if (st.screen === "dxgate") { s.innerHTML = dxGateHTML(); }
    else if (st.screen === "dashboard") { s.innerHTML = dashboardHTML(); }
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
    if (st.screen === "dxgate") { title = "Diabetes type"; sub = "Sets the scale, the doses and the safety checks"; }
    else if (st.screen === "settings") { title = "Settings"; sub = "Preferences and safety limits"; }
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

  /* ---------- Diabetes type gate ----------
   * Asked ONCE, before anything else. The type is not cosmetic: it decides the correction
   * scale band, which workflows are offered, and whether a correction-only regimen is
   * standard care (stress hyperglycaemia) or malpractice (type 1). Skippable in one tap,
   * because a clinician who already knows what they want should not be interrogated. */
  function dxTypes() { var E = window.INSULIN_ENGINE; return (E && E.DX_TYPES) || {}; }
  function dxGateHTML() {
    var T = dxTypes(), ids = ["t1", "t2", "stress", "steroid", "secondary"];
    var cards = ids.filter(function (id) { return T[id]; }).map(function (id) {
      var d = T[id];
      return '<button class="ins-askbtn" data-ins="dx-pick" data-v="' + id + '">' +
        '<span class="ins-ask-q">' + esc(d.label) + '</span>' +
        '<span class="ins-ask-d">' + esc(d.detail) + '</span>' + ICON_CHEVR + '</button>';
    }).join("");
    return '<div class="ins-card ins-bf"><div class="ins-card-t">Which patient is this?</div>' +
      '<div class="ins-hint" style="margin-bottom:10px">The type sets the correction scale, the starting doses and the safety checks. Type 1 and type 2 are not interchangeable here.</div>' +
      '<div class="ins-ask">' + cards + '</div></div>' +
      '<button class="ins-skip ins-bf" data-ins="dx-skip">Skip - take me straight to the calculator</button>' +
      '<div class="ins-tgt-note ins-bf">Skipping is safe: every calculation still works, you just get the general scale instead of a type-specific one, and no type-specific warnings.</div>';
  }
  function dxChipHTML() {
    var T = dxTypes(), d = T[st.dxType];
    if (!d) return '<button class="ins-dxchip ins-dxchip-empty ins-bf" data-ins="dx-open">' +
      '<span>No diabetes type set</span><span class="ins-dxchip-a">Choose</span></button>';
    return '<button class="ins-dxchip ins-bf" data-ins="dx-open">' +
      '<span class="ins-dxchip-t">' + esc(d.short) + '</span>' +
      '<span class="ins-dxchip-s">' + esc(d.label) + '</span>' +
      '<span class="ins-dxchip-a">Change</span></button>';
  }
  // Guidance for the chosen type, shown once on the result rather than repeated per field.
  function dxNotesHTML() {
    var E = window.INSULIN_ENGINE; if (!E || !st.dxType) return "";
    var d = E.dxGuidance(st.dxType);
    if (!d.notes || !d.notes.length) return "";
    return '<div class="ins-conv-sec ins-dxnotes"><h4>' + esc(d.label) + '</h4><ul>' +
      d.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join("") + '</ul></div>';
  }

  /* ---------- Dashboard ---------- */
  function dashboardHTML() {
    var log = loadLog(), recent = "";
    if (log.length) {
      recent = log.slice(0, 4).map(function (e) {
        var u = e.unit && e.unit.indexOf("hour") > -1 ? "u/h" : "u";
        var shown = e.givenDose != null ? e.givenDose : e.confirmedDose;
        var who = e.patientName ? ' &middot; ' + esc(e.patientName) : '';
        return '<div class="ins-rec-row"><div class="ins-rec-dose">' + shown + '<span>' + u + '</span></div>' +
          '<div class="ins-rec-meta"><div class="ins-rec-mode">' + modeLabel(e.mode) + who + '</div>' +
          '<div class="ins-rec-time">' + timeStr(e.ts) + (e.warnings && e.warnings.length ? ' &middot; ' + e.warnings.length + ' flag' + (e.warnings.length > 1 ? 's' : '') : '') + '</div></div></div>';
      }).join("");
    } else {
      recent = '<div class="ins-empty">No doses yet. When you accept a recommendation it is logged here as an audit trail.</div>';
    }

    // Real profile parameters only when a patient is loaded (glucose/IOB are live inputs, not dashboard data).
    var summary = st.patientId ? '<div class="ins-stats ins-bf">' +
        statTile("Target", fmt(st.target), gUnit()) + statTile("Carb ratio", fmt(st.icr), "g/u") + statTile("Sensitivity", fmt(st.isf), isfUnit()) +
      '</div>' : "";

    return patientBarHTML() + dxChipHTML() + summary +
      askCardHTML() +
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
  function ask(mode, question, detail) {
    return '<button class="ins-askbtn" data-ins="qa" data-mode="' + mode + '">' +
      '<span class="ins-ask-q">' + question + '</span><span class="ins-ask-d">' + detail + '</span>' + ICON_CHEVR + '</button>';
  }

  /* Every calculator phrased as the question a clinician actually arrives with, plus the
   * words they might search for. One table, so the dashboard, the search and the "other
   * tasks" list can never drift apart. */
  var QUESTIONS = {
    titrate:    ["Sugars are high on the current dose", "Titrate the basal against the fasting reading", "titration adjust increase basal fasting 2 units"],
    scale:      ["Write a correction scale", "A q6h supplemental scale from this patient's own sensitivity", "sliding scale supplemental correction chart"],
    basalT2:    ["Start insulin in type 2 diabetes", "Basal-only initiation, then titration", "begin start new glargine 10 units type 2"],
    inpatient:  ["Admit and start basal-bolus", "Weight-based inpatient regimen with a correction scale", "admission ward rabbit weight based"],
    correction: ["Bring down a single high reading", "One correction dose now", "high sugar stat correction bolus"],
    combined:   ["Cover a meal and a high reading", "Meal bolus plus correction in one dose", "carb counting combined bolus"],
    meal:       ["Cover a meal", "Carbohydrate bolus only", "prandial mealtime carb"],
    premix:     ["Start premixed insulin", "Twice-daily 30/70, two-thirds morning", "mixtard novomix premix 30/70 biphasic"],
    premixTitr: ["Adjust premixed insulin", "Which of the two injections to move", "premix titration mixtard adjust"],
    npo:        ["Patient is nil by mouth", "What to hold, what to continue", "npo fasting nbm not eating"],
    steroid:    ["Steroids have raised the sugars", "NPH cover matched to the steroid dose", "prednisolone dexamethasone steroid glucocorticoid"],
    ivsc:       ["Come off the insulin drip", "Convert the infusion to a subcutaneous regimen", "infusion iv to subcut transition drip"],
    nutrition:  ["Patient is on a tube feed or TPN", "Insulin matched to the feed", "enteral ryles peg tpn parenteral feed"],
    periop:     ["Patient is going for surgery", "What to hold and what to give on the morning", "surgery operation preop perioperative theatre"],
    discharge:  ["Send the patient home", "Home regimen, education and follow-up", "discharge home going out"],
    sick:       ["Patient is unwell at home", "Sick-day rules and extra insulin", "sick day illness fever vomiting ketones"],
    dka:        ["Diabetic ketoacidosis", "Fixed-rate insulin infusion", "dka hhs ketoacidosis infusion"],
    pediatric:  ["A child needs insulin started", "Weight-based paediatric initiation", "child paediatric pediatric kid"],
    isf:        ["Work out the correction factor", "ISF from the total daily dose", "isf sensitivity 1800 rule"],
    icr:        ["Work out the carbohydrate ratio", "ICR from the total daily dose", "icr carb ratio 500 rule"],
    iob:        ["How much insulin is still acting", "Insulin on board from recorded doses", "iob active insulin stacking"],
    basal:      ["Basal-bolus with my own factor", "Weight-based, you choose the u/kg/day", "custom factor basal bolus"]
  };
  function askOf(id) { var q = QUESTIONS[id]; return q ? ask(id, q[0], q[1]) : ""; }

  /* The chosen diagnosis reorders this list. A type 1 should not have to read past
   * "Start insulin in type 2 diabetes" to reach the thing they need, and stress
   * hyperglycaemia genuinely does want the correction scale first. */
  function askCardHTML() {
    var E = window.INSULIN_ENGINE;
    var dx = (E && st.dxType) ? E.dxGuidance(st.dxType) : null;
    var suggested = (dx && dx.suggest && dx.suggest.length) ? dx.suggest : null;
    var DEFAULT_ORDER = ["titrate", "scale", "basalT2", "inpatient", "correction", "npo", "steroid", "ivsc"];
    var primary = suggested || DEFAULT_ORDER;
    var seen = {}, primaryHTML = "";
    primary.forEach(function (id) { if (QUESTIONS[id] && !seen[id]) { seen[id] = 1; primaryHTML += askOf(id); } });
    var restHTML = Object.keys(QUESTIONS).filter(function (id) { return !seen[id]; }).map(askOf).join("");
    var title = dx ? "For " + esc(dx.label.toLowerCase()) : "What do you need to do?";
    return '<div class="ins-card ins-bf"><div class="ins-card-t">' + title + '</div>' +
      (dx ? '<div class="ins-hint" style="margin-bottom:10px">Ordered for this diagnosis. Everything else is still below.</div>' : '') +
      '<div class="ins-search"><span class="ins-search-ic">' + ICON_SEARCH + '</span>' +
        '<input class="ins-search-in" data-ins="ask-q" type="search" placeholder="Search all calculators" ' +
        'aria-label="Search all calculators" value="' + esc(st.askQ || "") + '"></div>' +
      '<div class="ins-ask" id="insAskList">' + primaryHTML + '</div>' +
      '<details class="ins-more"><summary>Everything else (' + Object.keys(QUESTIONS).filter(function (id) { return !seen[id]; }).length + ')</summary>' +
        '<div class="ins-ask">' + restHTML + '</div></details>' +
    '</div>';
  }
  // Search across ALL calculators, matched on the question, the detail and the keyword list.
  function renderAskSearch() {
    var list = document.getElementById("insAskList"); if (!list) return;
    var q = (st.askQ || "").trim().toLowerCase();
    var more = document.querySelector(".ins-more");
    if (!q) { if (more) more.style.display = ""; paint(); return; }
    if (more) more.style.display = "none";
    var hits = Object.keys(QUESTIONS).filter(function (id) {
      return QUESTIONS[id].join(" ").toLowerCase().indexOf(q) > -1 || modeLabel(id).toLowerCase().indexOf(q) > -1;
    });
    list.innerHTML = hits.length ? hits.map(askOf).join("")
      : '<div class="ins-empty">Nothing matches "' + esc(st.askQ) + '". Try "steroid", "surgery", "premix" or "nil by mouth".</div>';
  }
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
      var shown = e.givenDose != null ? e.givenDose : e.confirmedDose;
      // An audit trail has to name the patient and show where the given dose differed
      // from the suggestion, or it is an audit of the calculator rather than of care.
      var who = e.patientName ? esc(e.patientName) : (e.patientId ? "patient " + esc(e.patientId) : "no patient recorded");
      var ovr = e.overridden ? ' &middot; <span class="ins-rec-ovr">overridden from ' + e.calculatedDose + u + '</span>' : '';
      return '<div class="ins-rec-row"><div class="ins-rec-dose">' + shown + '<span>' + u + '</span></div>' +
        '<div class="ins-rec-meta"><div class="ins-rec-mode">' + modeLabel(e.mode) + ' &middot; ' + who + '</div>' +
        '<div class="ins-rec-time">' + timeStr(e.ts) + ' &middot; ' + w + ovr + '</div></div></div>';
    }).join("");
  }
  function histCSV() {
    var rows = histFiltered();
    function q(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
    var lines = rows.map(function (e) {
      return [new Date(e.ts).toISOString(), e.mode, q(e.patientName || ""), q(e.patientId || ""),
        e.calculatedDose, (e.givenDose != null ? e.givenDose : e.confirmedDose), (e.overridden ? "yes" : "no"),
        (e.unit || "units"), q((e.warnings || []).join("; "))].join(",");
    });
    return ["timestamp,mode,patient,patient_id,calculated,given,overridden,unit,warnings"].concat(lines).join("\n");
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
        '<div class="ins-field"><div class="ins-lab">Home appearance</div>' +
          '<select class="ins-select" data-ins="set-glass">' +
          [["standard", "Standard"], ["frosted", "Frosted glass"], ["liquid", "Liquid glass (sheen)"], ["tinted", "Tinted 3D glass"], ["blend", "Blend (tinted + sheen)"]].map(function (o) {
            return '<option value="' + o[0] + '"' + (SET.homeGlass === o[0] ? " selected" : "") + '>' + o[1] + '</option>';
          }).join("") + '</select>' +
          '<div class="ins-tgt-note">Liquid-glass styling for the home screen only. Change it and return home to see it.</div></div>' +
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
        (hasCases ? '<button class="ins-qa-btn" data-ins="p-import">Import from saved cases</button>' : '') +
        (wardAvailable() ? '<button class="ins-qa-btn" data-ins="p-ward">Add from Ward Sync</button>' : '') + '</div>' +
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
      if (p.age) meta.push(p.age + " y"); if (p.sex) meta.push(p.sex);
      if (p.dxType) meta.push((dxTypes()[p.dxType] && dxTypes()[p.dxType].short) || p.dxType);
      if (p.ward && p.ward.bed) meta.push("Bed " + p.ward.bed);
      else if (p.ward) meta.push("Ward Sync");
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
        // Once- vs twice-daily NPH changes the starting dose per labelling (20%
        // reduction applies only when coming off twice-daily), so ask when it matters.
        (st.convFrom === "nph" ? '<div class="ins-field"><div class="ins-lab">Current NPH frequency</div><div class="ins-chips">' +
          '<button class="ins-chip" data-ins="convfreq" data-v="bd" aria-pressed="' + (st.convFromFreq !== "od" ? "true" : "false") + '">Twice daily</button>' +
          '<button class="ins-chip" data-ins="convfreq" data-v="od" aria-pressed="' + (st.convFromFreq === "od" ? "true" : "false") + '">Once daily</button></div></div>' : '') +
        '<div class="ins-field"><div class="ins-lab">Target insulin</div><select class="ins-select" data-ins="conv-sel" data-k="convTo">' + convInsOpts(st.convTo) + '</select></div>' +
        '<div class="ins-field"><div class="ins-lab">Reason for switching</div><select class="ins-select" data-ins="conv-sel" data-k="convReason">' + ropts + '</select></div>' +
      '</div><div id="insConvOut"></div>';
  }
  function renderConvert() {
    var out = document.getElementById("insConvOut"); if (!out || !window.INSULIN_CONVERT) return;
    st.convAck = false;
    var res = window.INSULIN_CONVERT.convert({ fromId: st.convFrom, toId: st.convTo, dose: st.convDose, reason: st.convReason, fromFreq: st.convFromFreq });
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

  /* Modes are grouped by the CLINICAL QUESTION being asked, not by the formula used.
   * The old split was Simple vs Advanced, which put ISF and carb ratio - the two numbers
   * the "simple" calculators demand as input - behind a tab labelled for specialists.
   * A resident was sent to the advanced screen to obtain a value the beginner screen
   * required. Grouping by task removes that, and every group is reachable in one tap. */
  var GROUPS = [
    { id: "start",  label: "Starting insulin",  hint: "A patient who needs insulin begun." },
    { id: "adjust", label: "Adjusting",         hint: "Already on insulin, the numbers are wrong." },
    { id: "now",    label: "High sugar now",    hint: "A single reading to bring down." },
    { id: "special", label: "Special situations", hint: "Fasting, steroids, drips, DKA, children." },
    { id: "derive", label: "Work out a ratio",  hint: "Derive ISF, carb ratio or insulin on board." }
  ];
  var MODES = [
    // Starting insulin
    { id: "basalT2",   label: "Start basal (T2DM)", group: "start" },
    { id: "inpatient", label: "Start basal-bolus",  group: "start" },
    { id: "premix",    label: "Start premix",       group: "start" },
    { id: "basal",     label: "Basal-bolus (custom factor)", group: "start" },
    // Adjusting
    { id: "titrate",     label: "Titrate basal",  group: "adjust" },
    { id: "premixTitr",  label: "Titrate premix", group: "adjust" },
    // High sugar now
    { id: "correction", label: "Correction",    group: "now" },
    { id: "scale",      label: "Correction scale", group: "now" },
    { id: "combined",   label: "Meal + correction", group: "now" },
    { id: "meal",       label: "Meal bolus",    group: "now" },
    // Special situations
    { id: "npo",       label: "Nil by mouth",  group: "special" },
    { id: "steroid",   label: "Steroid cover", group: "special" },
    { id: "ivsc",      label: "Drip to subcut", group: "special" },
    { id: "nutrition", label: "Tube feed / TPN", group: "special" },
    { id: "periop",    label: "Surgery",       group: "special" },
    { id: "sick",      label: "Sick day",      group: "special" },
    { id: "discharge", label: "Discharge",     group: "adjust" },
    { id: "pediatric", label: "Pediatric",     group: "special", clin: true },
    { id: "dka",       label: "DKA infusion",  group: "special", clin: true },
    // Derivations
    { id: "isf", label: "ISF",           group: "derive" },
    { id: "icr", label: "Carb ratio",    group: "derive" },
    { id: "iob", label: "Active insulin", group: "derive" }
  ];
  function groupOf(id) { var m = MODES.filter(function (x) { return x.id === id; })[0]; return m ? m.group : "now"; }
  function activeGroup() { return st.group || groupOf(st.mode); }
  function visibleModes() { var g = activeGroup(); return MODES.filter(function (m) { return m.group === g; }); }
  function firstModeIn(g) { var l = MODES.filter(function (m) { return m.group === g; }); return l.length ? l[0].id : "correction"; }
  function glucoseMode(m) { return m === "combined" || m === "correction"; }
  function bolusMode(m) { return ["combined", "meal", "correction", "iob"].indexOf(m) > -1; }
  function clinMode(m) { return m === "pediatric" || m === "dka"; }
  function doseUnitMode(m) { return ["combined", "meal", "correction", "basal", "pediatric", "inpatient", "premix", "npo", "steroid", "ivsc", "basalT2"].indexOf(m) > -1; }

  function calcHTML() {
    return (st.patientId ? '<div class="ins-patchip ins-bf">' + ICON_USER + '<span>' + esc(st.patientName) + '</span>' +
        '<button data-ins="p-clear" aria-label="Clear patient">&times;</button></div>' : '') +
      '<div class="ins-ai ins-bf">' + ICON_AI +
        '<div><b>AI-assisted recommendation.</b> The treating physician makes the final decision. ' +
        'Every value below is shown with its formula and assumptions - nothing is hidden.</div></div>' +
      '<div class="ins-groups ins-bf" role="tablist" aria-label="Clinical task">' + GROUPS.map(function (g) {
        var sel = activeGroup() === g.id;
        return '<button class="ins-groupbtn" role="tab" data-ins="group" data-g="' + g.id + '"' +
          ' aria-selected="' + (sel ? "true" : "false") + '" tabindex="' + (sel ? "0" : "-1") + '">' + g.label + '</button>';
      }).join("") + '</div>' +
      '<div class="ins-level-h ins-bf">' + (GROUPS.filter(function (g) { return g.id === activeGroup(); })[0] || GROUPS[0]).hint + '</div>' +
      // role="tab" needs aria-selected and roving tabindex, and must point at the panel it
      // controls - otherwise a screen-reader user hears 18 unlabelled buttons.
      '<div class="ins-modes ins-bf" role="tablist" aria-label="Calculation">' + visibleModes().map(function (m) {
        var sel = st.mode === m.id;
        return '<button class="ins-modebtn' + (m.clin ? " clin" : "") + '" role="tab" id="insTab-' + m.id + '"' +
          ' aria-controls="insInputs" aria-selected="' + (sel ? "true" : "false") + '" tabindex="' + (sel ? "0" : "-1") + '"' +
          ' data-ins="mode" data-mode="' + m.id + '">' + m.label + '</button>';
      }).join("") + '</div>' +
      '<div class="ins-card ins-bf" id="insInputs" role="tabpanel" aria-labelledby="insTab-' + st.mode + '"></div>' +
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
  // Scoped to the SELECTED PATIENT (see logForPatient): insulin on board is the single
  // most patient-specific number here, and borrowing another bed's doses would silently
  // subtract insulin this patient never received.
  function recentBolusDoses() {
    var dia = bolusDia(), log = logForPatient(), now = Date.now(), doses = [], i;
    for (i = 0; i < log.length; i++) {
      var e = log[i]; if (!e.ts) continue;
      if (BOLUS_LOG_MODES.indexOf(e.mode) < 0) continue;
      var mins = (now - e.ts) / 60000;
      if (mins < 0 || mins > dia * 60) continue;
      doses.push({ units: Number(e.givenDose != null ? e.givenDose : e.confirmedDose) || 0, minutesAgo: mins });
    }
    return doses;
  }
  function estimateIOB() {
    var doses = recentBolusDoses(), dia = bolusDia();
    var r = window.INSULIN_ENGINE.activeInsulin({ doses: doses, dia: dia });
    return { iob: r.result, n: doses.length, dia: dia };
  }

  function pedChip(v, label) { return '<button class="ins-chip" data-ins="pedstage" data-v="' + v + '" aria-pressed="' + (st.pedStage === v ? "true" : "false") + '">' + label + '</button>'; }

  // ---- First-dose / no-prior-data correction inputs (correction mode only) ----
  function iobEstBtn() {
    // IOB is now scoped to the selected patient, so with no patient there is nothing
    // legitimate to estimate from. Say that, rather than showing a dead "no doses" button.
    if (!st.patientId) {
      return '<div class="ins-field"><button class="ins-iob-est" data-ins="go-patients">Select a patient to estimate insulin on board</button>' +
        '<div class="ins-tgt-note">Active insulin is counted from that patient\'s own recorded doses only. Without a patient selected it cannot be estimated, and is left for you to enter.</div></div>';
    }
    var nd = recentBolusDoses().length;
    return '<div class="ins-field"><button class="ins-iob-est" data-ins="iob-est"' + (nd ? "" : " disabled") + '>' +
      (nd ? 'Estimate IOB from ' + nd + ' recorded dose' + (nd > 1 ? 's' : '') + ' for ' + esc(st.patientName) : 'No recorded doses for ' + esc(st.patientName) + ' in the last ' + bolusDia() + ' h') + '</button>' +
      (st.iobNote ? '<div class="ins-iob-note">' + st.iobNote + '</div>' : '') + '</div>';
  }
  function fdSrcBtn(v, label) { return '<button class="ins-chip" data-ins="corr-source" data-v="' + v + '" aria-pressed="' + (st.corrSource === v ? "true" : "false") + '">' + label + '</button>'; }
  function firstDoseInputs() {
    var h = '<div class="ins-field"><div class="ins-lab">No previous insulin data?</div><div class="ins-chips">' +
      fdSrcBtn("isf", "Known ISF") + fdSrcBtn("tdd", "Known TDD") + fdSrcBtn("estimate", "First dose / Estimate") + '</div></div>';
    if (st.corrSource === "isf") {
      h += '<div class="ins-field"><div class="ins-grid2">' + mini("isf", "ISF " + isfUnit(), st.isf) + mini("iob", "Active insulin (IOB) u", st.iob) + '</div></div>' + iobEstBtn();
      return h;
    }
    if (st.corrSource === "tdd") {
      h += '<div class="ins-field"><div class="ins-lab">Known usual total daily dose <span class="u">u/day</span></div>' + stepper("fdTdd", st.fdTdd, 1) +
        '<div class="ins-tgt-note">Estimated ISF = 1800 / TDD (shown in the result). Enter a known ISF below to override.</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("isfOverride", "Override ISF " + isfUnit() + " (optional)", st.isfOverride) + mini("iob", "Active insulin (IOB) u", st.iob) + '</div></div>' + iobEstBtn();
      return h;
    }
    // estimate
    h += '<div class="ins-field"><div class="ins-lab">Patient weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
      '<div class="ins-field"><div class="ins-lab">Insulin status</div><div class="ins-chips">' +
        '<button class="ins-chip" data-ins="fd-naive" data-v="1" aria-pressed="' + (st.fdNaive ? "true" : "false") + '">Insulin-naive</button>' +
        '<button class="ins-chip" data-ins="fd-naive" data-v="0" aria-pressed="' + (!st.fdNaive ? "true" : "false") + '">Already using insulin</button></div></div>';
    if (st.fdNaive) {
      h += '<div class="ins-field"><div class="ins-lab">Initial TDD assumption <span class="u">u/kg/day</span></div>' + mini("fdFactor", "u/kg/day", st.fdFactor) +
        '<div class="ins-tgt-note">An ASSUMPTION, not a known value. Estimated TDD + ISF and IOB 0 u are shown with their sources in the result.</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("isfOverride", "Override ISF " + isfUnit() + " (optional)", st.isfOverride) + '</div></div>';
    } else {
      h += '<div class="ins-field"><div class="ins-grid2">' + mini("fdTdd", "Known usual TDD u/day (optional)", st.fdTdd) + mini("isfOverride", "Override ISF " + isfUnit() + " (optional)", st.isfOverride) + '</div>' +
        '<div class="ins-tgt-note">A known TDD (or ISF) overrides the weight estimate.</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Recent rapid-acting dose (for IOB)</div><div class="ins-grid2">' + mini("fdPriorUnits", "Units", st.fdPriorUnits) + mini("fdPriorMins", "Minutes ago", st.fdPriorMins) + '</div>' +
        '<div class="ins-tgt-note">Leave units at 0 if none or unknown - IOB is never fabricated.</div></div>';
    }
    h += '<div class="ins-field"><div class="ins-lab">Clinical context</div><div class="ins-chips">' +
      '<button class="ins-chip" data-ins="fd-route" data-v="" aria-pressed="' + (!st.fdRoute ? "true" : "false") + '">Stable / ward</button>' +
      '<button class="ins-chip" data-ins="fd-route" data-v="dka" aria-pressed="' + (st.fdRoute === "dka" ? "true" : "false") + '">DKA / HHS</button>' +
      '<button class="ins-chip" data-ins="fd-route" data-v="pediatric" aria-pressed="' + (st.fdRoute === "pediatric" ? "true" : "false") + '">Pediatric</button></div>' +
      '<div class="ins-tgt-note">DKA/HHS and pediatric route to the correct protocol, not a routine correction. Renal, hepatic, pregnancy and steroid context are set with the chips below.</div></div>';
    return h;
  }
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
        (st.targetNote ? '<div class="ins-tgt-note ins-tgt-changed">' + st.targetNote + '</div>' : '') +
        '<div class="ins-tgt-note">Type any target - a higher interim target gives gradual correction of a very high glucose.</div></div>';
    }
    if (m === "combined" || m === "meal") h += '<div class="ins-field"><div class="ins-lab">Carbohydrates <span class="u">g</span></div>' + stepper("carbs", st.carbs, 5) + '</div>';

    if (m === "correction") {
      // Correction gets the first-dose / no-prior-data pathway (Known ISF | Known TDD | First dose).
      h += firstDoseInputs();
    } else if (glucoseMode(m) || m === "meal") {   // combined + meal keep the plain ISF/ICR/IOB inputs
      h += '<div class="ins-field"><div class="ins-grid2">';
      if (glucoseMode(m)) h += mini("isf", "ISF " + isfUnit(), st.isf);
      if (m === "combined" || m === "meal") h += mini("icr", "ICR g/u", st.icr);
      // IOB matters just as much for a PURE correction (the classic stacking scenario) as
      // for a combined bolus, so it is collected in both.
      if (glucoseMode(m)) h += mini("iob", "Active insulin (IOB) u", st.iob);
      h += '</div></div>';
      if (glucoseMode(m)) h += iobEstBtn();
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
    /* ---- ward workflows ---- */
    if (m === "titrate") {
      h += '<div class="ins-field"><div class="ins-lab">Current basal dose <span class="u">units/day</span></div>' + stepper("curBasal", st.curBasal, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Fasting glucose <span class="u">mg/dL</span></div>' + stepper("fasting", st.fasting, 10) +
          '<div class="ins-tgt-note">Use the last 2 to 3 fasting values if you have them - enter the lowest one you are worried about and the calculator will not titrate up through a hypo.</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span> (for the overbasalization check)</div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Step size</div><div class="ins-round">' +
          '<button class="ins-round-b" data-ins="titrmethod" data-v="units" aria-pressed="' + (st.titrMethod === "units" ? "true" : "false") + '">2 units every 3 days</button>' +
          '<button class="ins-round-b" data-ins="titrmethod" data-v="percent" aria-pressed="' + (st.titrMethod === "percent" ? "true" : "false") + '">10% steps</button></div></div>';
    }
    if (m === "scale") {
      h += '<div class="ins-field"><div class="ins-lab">Total daily insulin dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 2) +
        '<div class="ins-tgt-note">Leave blank to estimate from weight and the sensitivity band below.</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span> (used only if no TDD)</div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Insulin sensitivity</div><div class="ins-chips">' +
          ["sensitive", "usual", "resistant"].map(function (v) {
            return '<button class="ins-chip" data-ins="resist" data-v="' + v + '" aria-pressed="' + (st.scaleResist === v ? "true" : "false") + '">' + v.charAt(0).toUpperCase() + v.slice(1) + '</button>';
          }).join("") + '</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("scaleMax", "Max units per dose", st.scaleMax) + mini("target", "Correction target mg/dL", st.target) + '</div></div>';
    }
    if (m === "basalT2")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) +
        '<div class="ins-tgt-note">Type 2 basal is started at 10 units a day, or 0.1 to 0.2 units/kg/day - whichever is lower is the safer start.</div></div>';
    if (m === "inpatient")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Admission glucose <span class="u">mg/dL</span></div>' + stepper("glucose", st.glucose, 10) + '</div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("ctx.age", "Age (years)", st.ctx.age) + mini("creatinine", "Creatinine mg/dL", st.creatinine) + '</div>' +
          '<div class="ins-tgt-note">Age 70 or over, or creatinine 2.0 or above, drops the starting dose to 0.3 u/kg/day.</div></div>';
    if (m === "premix")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Or a known total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 2) +
          '<div class="ins-tgt-note">A known total daily dose is used in preference to the weight estimate.</div></div>';
    if (m === "premixTitr")
      h += '<div class="ins-field"><div class="ins-grid2">' + mini("pmMorning", "Morning premix (u)", st.pmMorning) + mini("pmEvening", "Evening premix (u)", st.pmEvening) + '</div></div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("fasting", "Fasting glucose mg/dL", st.fasting) + mini("preDinner", "Pre-dinner glucose mg/dL", st.preDinner) + '</div>' +
          '<div class="ins-tgt-note">The morning dose is judged on the pre-dinner reading and the evening dose on the fasting reading. Each injection is judged by the value before the next one.</div></div>';
    if (m === "npo")
      h += '<div class="ins-field"><div class="ins-lab">Current basal dose <span class="u">units/day</span></div>' + stepper("curBasal", st.curBasal, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Or a total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Patient</div><div class="ins-chips">' +
          '<button class="ins-chip" data-ins="npoflag" data-k="npoType1" aria-pressed="' + (st.npoType1 ? "true" : "false") + '">Type 1 diabetes</button>' +
          '<button class="ins-chip" data-ins="npoflag" data-k="npoHypoRisk" aria-pressed="' + (st.npoHypoRisk ? "true" : "false") + '">Hypoglycaemia risk</button></div>' +
          '<div class="ins-tgt-note">In type 1 the basal is never stopped: stopping it causes ketoacidosis even when the glucose looks normal.</div></div>';
    if (m === "steroid")
      h += '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Glucocorticoid</div>' +
          '<select class="ins-select" data-ins="steroidkind">' + ["prednisolone", "prednisone", "methylprednisolone", "dexamethasone", "hydrocortisone"].map(function (k) {
            return '<option value="' + k + '"' + (st.steroidKind === k ? " selected" : "") + '>' + k.charAt(0).toUpperCase() + k.slice(1) + '</option>';
          }).join("") + '</select></div>' +
        '<div class="ins-field"><div class="ins-lab">Daily steroid dose <span class="u">mg</span></div>' + stepper("steroidMg", st.steroidMg, 5) + '</div>';
    if (m === "ivsc")
      h += '<div class="ins-field"><div class="ins-lab">Mean insulin infusion rate <span class="u">units/hour</span></div>' + stepper("ivRate", st.ivRate, 0.5) +
        '<div class="ins-tgt-note">Average the last 6 hours of STABLE rates, not the whole infusion - the early high rates belong to the resuscitation.</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Proportion carried over</div><div class="ins-round">' +
          '<button class="ins-round-b" data-ins="ivpct" data-v="0.8" aria-pressed="' + (st.ivPercent === 0.8 ? "true" : "false") + '">80% (stable, eating)</button>' +
          '<button class="ins-round-b" data-ins="ivpct" data-v="0.6" aria-pressed="' + (st.ivPercent === 0.6 ? "true" : "false") + '">60% (frail, renal, poor intake)</button></div></div>';

    if (m === "nutrition")
      h += '<div class="ins-field"><div class="ins-lab">Feed type</div><div class="ins-chips">' +
        [["continuous", "Continuous"], ["bolus", "Bolus feeds"], ["tpn", "Parenteral (TPN)"]].map(function (o) {
          return '<button class="ins-chip" data-ins="nutfeed" data-v="' + o[0] + '" aria-pressed="' + (st.nutFeed === o[0] ? "true" : "false") + '">' + o[1] + '</button>';
        }).join("") + '</div></div>' +
        '<div class="ins-field"><div class="ins-lab">Carbohydrate in the feed <span class="u">g per day</span></div>' + stepper("nutCarbs", st.nutCarbs, 10) + '</div>' +
        (st.nutFeed === "bolus" ? '<div class="ins-field"><div class="ins-grid2">' + mini("nutFeeds", "Feeds per day", st.nutFeeds) + '</div></div>' : '') +
        (st.nutFeed === "tpn" ? '<div class="ins-field"><div class="ins-grid2">' + mini("nutDextrose", "Dextrose in the bag (g/day)", st.nutDextrose) + '</div></div>' : '') +
        '<div class="ins-field"><div class="ins-lab">Weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>';
    if (m === "periop")
      h += '<div class="ins-field"><div class="ins-lab">Usual basal dose <span class="u">units/day</span></div>' + stepper("curBasal", st.curBasal, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Or a total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 2) + '</div>';
    if (m === "discharge")
      h += '<div class="ins-field"><div class="ins-lab">Inpatient basal dose <span class="u">units/day</span></div>' + stepper("inpBasal", st.inpBasal, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-grid2">' + mini("hba1c", "HbA1c %", st.hba1c) + mini("tdd", "Inpatient TDD (optional)", st.tdd) + '</div>' +
          '<div class="ins-tgt-note">The HbA1c decides the regimen that goes home: it reflects control BEFORE this admission, which the inpatient doses do not.</div></div>';
    if (m === "sick")
      h += '<div class="ins-field"><div class="ins-lab">Usual total daily dose <span class="u">units/day</span></div>' + stepper("tdd", st.tdd, 2) + '</div>' +
        '<div class="ins-field"><div class="ins-lab">Or weight <span class="u">kg</span></div>' + stepper("ctx.weightKg", st.ctx.weightKg, 1) + '</div>';

    if (m === "iob") {
      var doses = recentBolusDoses();
      h += '<div class="ins-field"><div class="ins-lab">Active insulin from recent doses</div>' +
        '<div class="ins-guide">Sums confirmed bolus doses within the selected insulin duration of action (' + bolusDia() + ' h). ' + doses.length + ' dose' + (doses.length !== 1 ? 's' : '') + ' in window.</div></div>';
    }

    // Rounding is a device/setup preference, not a per-dose decision — Advanced only
    // (Simple uses the saved default, shown in the result line).
    if (doseUnitMode(m) && SET.showRounding) h += '<div class="ins-field"><div class="ins-lab">Rounding</div><div class="ins-round">' +
      '<button data-ins="round" data-v="1" aria-pressed="' + (st.increment === 1 ? "true" : "false") + '">1 unit</button>' +
      '<button data-ins="round" data-v="0.5" aria-pressed="' + (st.increment === 0.5 ? "true" : "false") + '">0.5 unit</button></div></div>';

    // Context chips only where the engine actually consumes them. Showing five chips that
    // change nothing on a titration or a correction table is noise that reads as a bug.
    if (["isf", "icr", "iob", "scale", "titrate", "premixTitr", "npo", "steroid", "ivsc", "premix",
         "nutrition", "periop", "discharge", "sick"].indexOf(m) < 0) {
      h += '<div class="ins-field"><div class="ins-lab">Patient context</div><div class="ins-chips">' +
      ctxChip("pregnancy", "Pregnancy") + ctxChip("renal", "Renal") + ctxChip("hepatic", "Hepatic") + ctxChip("exercise", "Exercise") + ctxChip("steroids", "Steroids") +
      (m !== "pediatric" ? '<button class="ins-chip" data-ins="peds" aria-pressed="' + (st.ctx.pediatric ? "true" : "false") + '">Pediatric</button>' : '') + '</div></div>';
      // Renal and pregnancy carry QUANTIFIED guideline adjustments, so collect the one
      // value each needs (eGFR band / trimester) instead of applying a blanket factor.
      if (st.ctx.renal) h += '<div class="ins-field"><div class="ins-grid2">' + mini("ctx.egfr", "eGFR mL/min", st.ctx.egfr == null ? "" : st.ctx.egfr) +
        '<div class="ins-chips"><button class="ins-chip" data-ins="ctx" data-k="dialysis" aria-pressed="' + (st.ctx.dialysis ? "true" : "false") + '">On dialysis</button></div></div></div>';
      if (st.ctx.pregnancy) h += '<div class="ins-field"><div class="ins-lab">Trimester</div><div class="ins-chips">' +
        [1, 2, 3].map(function (t) { return '<button class="ins-chip" data-ins="tri" data-v="' + t + '" aria-pressed="' + (st.ctx.trimester === t ? "true" : "false") + '">T' + t + '</button>'; }).join("") + '</div></div>';
    }

    document.getElementById("insInputs").innerHTML = h;
  }

  /* Which named inputs this mode still needs. Declared per mode so the empty-state can say
   * "Still needed: current basal dose, fasting glucose" instead of making the user hunt for
   * the blank box. `any` groups alternatives - only one of them has to be filled. */
  var NEEDS = {
    correction: [["glucose", "current glucose"], ["isf", "ISF"]],
    combined:   [["glucose", "current glucose"], ["target", "target glucose"], ["isf", "ISF"], ["carbs", "carbohydrates"], ["icr", "carb ratio"]],
    meal:       [["carbs", "carbohydrates"], ["icr", "carb ratio"]],
    isf:        [["tdd", "total daily dose"]],
    icr:        [["tdd", "total daily dose"]],
    basal:      [["ctx.weightKg", "weight"]],
    basalT2:    [["ctx.weightKg", "weight"]],
    inpatient:  [["ctx.weightKg", "weight"]],
    pediatric:  [["ctx.weightKg", "weight"]],
    dka:        [["ctx.weightKg", "weight"]],
    titrate:    [["curBasal", "current basal dose"], ["fasting", "fasting glucose"]],
    scale:      [{ any: [["tdd", "total daily dose"], ["ctx.weightKg", "weight"]] }],
    premix:     [{ any: [["tdd", "total daily dose"], ["ctx.weightKg", "weight"]] }],
    premixTitr: [["pmMorning", "morning dose"], ["pmEvening", "evening dose"], { any: [["fasting", "fasting glucose"], ["preDinner", "pre-dinner glucose"]] }],
    npo:        [{ any: [["curBasal", "current basal dose"], ["tdd", "total daily dose"]] }],
    steroid:    [["ctx.weightKg", "weight"], ["steroidMg", "steroid dose in mg"]],
    ivsc:       [["ivRate", "infusion rate"]],
    nutrition:  [{ any: [["nutCarbs", "carbohydrate in the feed"], ["ctx.weightKg", "weight"]] }],
    periop:     [{ any: [["curBasal", "usual basal dose"], ["tdd", "total daily dose"]] }],
    discharge:  [{ any: [["inpBasal", "inpatient basal dose"], ["tdd", "total daily dose"]] }],
    sick:       [{ any: [["tdd", "total daily dose"], ["ctx.weightKg", "weight"]] }]
  };
  function fieldFilled(path) {
    var v = path.indexOf(".") > -1 ? st[path.split(".")[0]][path.split(".")[1]] : st[path];
    return num(v) && Number(v) > 0;
  }
  function missingFields(m) {
    var spec = NEEDS[m]; if (!spec) return [];
    var out = [];
    spec.forEach(function (item) {
      if (item.any) {
        if (!item.any.some(function (p) { return fieldFilled(p[0]); }))
          out.push(item.any.map(function (p) { return p[1]; }).join(" or "));
      } else if (!fieldFilled(item[0])) out.push(item[1]);
    });
    return out;
  }

  function compute() {
    var E = window.INSULIN_ENGINE, m = st.mode, G = toMgdl(st.glucose), T = toMgdl(st.target), ISF = toMgdl(st.isf);
    if (m === "meal") return E.mealBolus({ carbs: st.carbs, icr: st.icr, increment: st.increment, ctx: st.ctx });
    if (m === "correction") {
      if (st.corrSource === "isf") return E.correctionDose({ glucose: G, target: T, isf: ISF, iob: st.iob, increment: st.increment, ctx: st.ctx });
      // Known-TDD / first-dose-estimate pathway — resolve ISF+IOB with provenance in the engine.
      var fd = { glucose: G, target: T, increment: st.increment, ctx: st.ctx, rule: st.isfRule || 1800, dia: bolusDia(), route: st.fdRoute || null };
      if (num(st.isfOverride) && Number(st.isfOverride) > 0) fd.isf = toMgdl(Number(st.isfOverride));
      if (st.corrSource === "tdd") { if (num(st.fdTdd)) fd.tdd = Number(st.fdTdd); }
      else {   // estimate
        if (st.fdNaive) { fd.insulinNaive = true; fd.weightKg = Number(st.ctx.weightKg); fd.tddFactor = Number(st.fdFactor); }
        else {
          if (num(st.fdTdd) && Number(st.fdTdd) > 0) fd.tdd = Number(st.fdTdd);
          else { fd.weightKg = Number(st.ctx.weightKg); fd.tddFactor = Number(st.fdFactor); }
          if (num(st.fdPriorUnits) && Number(st.fdPriorUnits) > 0) fd.priorDose = { units: Number(st.fdPriorUnits), minutesAgo: Number(st.fdPriorMins) || 0 };
        }
      }
      return E.firstDoseCorrection(fd);
    }
    if (m === "basal") return E.basalInitiation({ weightKg: st.ctx.weightKg, tddFactor: st.tddFactor, basalFraction: st.basalFraction, increment: st.increment, ctx: st.ctx });
    /* ---- ward workflows ---- */
    if (m === "titrate") return E.basalTitration({ currentDose: N(st.curBasal), fastingGlucose: N(st.fasting),
      weightKg: N(st.ctx.weightKg), method: st.titrMethod });
    if (m === "scale") return E.correctionScale({ tdd: N(st.tdd), weightKg: N(st.ctx.weightKg),
      dxType: st.dxType || null, resistance: st.scaleResist, target: toMgdl(st.target),
      maxPerDose: N(st.scaleMax), rule: st.isfRule });
    if (m === "nutrition") return E.nutritionInsulin({ carbGramsPerDay: N(st.nutCarbs), weightKg: N(st.ctx.weightKg),
      feed: st.nutFeed, feedsPerDay: N(st.nutFeeds), dextroseGrams: N(st.nutDextrose), increment: st.increment });
    if (m === "periop") return E.periopRegimen({ basalDose: N(st.curBasal), tdd: N(st.tdd),
      dxType: st.dxType || null, increment: st.increment });
    if (m === "discharge") return E.dischargeRegimen({ inpatientBasal: N(st.inpBasal), tdd: N(st.tdd),
      hba1c: N(st.hba1c), dxType: st.dxType || null, increment: st.increment });
    if (m === "sick") return E.sickDayRules({ tdd: N(st.tdd), weightKg: N(st.ctx.weightKg),
      dxType: st.dxType || null, increment: st.increment });
    if (m === "basalT2") {
      // ADA type 2 initiation: 10 units/day OR 0.1-0.2 u/kg/day, whichever is the lower start.
      var w = N(st.ctx.weightKg);
      if (w == null) return E.basalInitiation({});                       // reuse the shared "enter values" guard
      var byWeight = Math.round(w * 0.2), start = Math.min(10, byWeight);
      return { result: start, rounded: start, unit: "units/day", tdd: start, basal: start,
        steps: [{ label: "Weight-based option", expr: w + " kg x 0.2 u/kg/day", value: byWeight },
                { label: "Fixed-dose option", expr: "ADA flat start", value: 10 },
                { label: "Start at the lower of the two", expr: "min(" + byWeight + ", 10)", value: start }],
        formula: "type 2 basal start = min(10 units/day, weight x 0.2 u/kg/day)",
        assumptions: ["Basal insulin ONLY. Prandial insulin is not started at the same time in type 2.",
          "Continue metformin unless contraindicated; review sulfonylurea (reduce or stop to avoid hypoglycaemia)."],
        clinicalNotes: ["Titrate by 2 units every 3 days to a fasting glucose of 80 to 130 mg/dL - use the Titrate basal screen.",
          "Do not exceed about 0.5 u/kg/day of basal. Above that the problem is missing prandial cover, not too little basal.",
          "Review in 1 to 2 weeks with a fasting glucose log."],
        refs: ["ADA Standards of Care in Diabetes 2026, ch.9: initiate basal insulin at 10 units/day or 0.1-0.2 units/kg/day."] };
    }
    if (m === "inpatient") return E.inpatientInit({ weightKg: N(st.ctx.weightKg), glucose: N(st.glucose),
      age: N(st.ctx.age), creatinine: N(st.creatinine), increment: st.increment });
    if (m === "premix") return E.premixInit({ weightKg: N(st.ctx.weightKg), tdd: N(st.tdd), increment: st.increment });
    if (m === "premixTitr") return E.premixTitration({ morning: N(st.pmMorning), evening: N(st.pmEvening),
      fasting: N(st.fasting), preDinner: N(st.preDinner) });
    if (m === "npo") return E.npoRegimen({ basalDose: N(st.curBasal), tdd: N(st.tdd),
      dxType: st.dxType || null, type1: st.npoType1, hypoRisk: st.npoHypoRisk, increment: st.increment });
    if (m === "steroid") return E.steroidCover({ weightKg: N(st.ctx.weightKg), steroid: st.steroidKind,
      steroidMg: N(st.steroidMg), increment: st.increment });
    if (m === "ivsc") return E.ivToSubcut({ avgRatePerHour: N(st.ivRate), percent: st.ivPercent, increment: st.increment });
    if (m === "isf") return E.isfFromTdd({ tdd: st.tdd, rule: st.isfRule });
    if (m === "icr") return E.icrFromTdd({ tdd: st.tdd, rule: st.icrRule });
    if (m === "iob") return E.activeInsulin({ doses: recentBolusDoses(), dia: bolusDia() });
    if (m === "pediatric") return E.pediatricInit({ weightKg: st.ctx.weightKg, stage: st.pedStage, increment: st.increment });
    if (m === "dka") return E.dkaInsulin({ weightKg: st.ctx.weightKg, ratePerKg: st.dkaRate,
      maxRate: (st.dkaMax !== "" && isFinite(Number(st.dkaMax)) ? Number(st.dkaMax) : undefined), paeds: st.dkaPaeds });
    return E.combinedDose({ carbs: st.carbs, icr: st.icr, glucose: G, target: T, isf: ISF, iob: st.iob, increment: st.increment, ctx: st.ctx });
  }
  function safety(res) {
    var S = window.INSULIN_SAFETY, m = st.mode;
    if (["isf", "icr", "iob"].indexOf(m) > -1) return S.evaluate({}, { noGlucose: true }, res);
    // Pass the real IOB for BOTH glucose modes — a pure correction on top of active
    // insulin is the commonest stacking error, so the caution must fire there too.
    var input = glucoseMode(m) ? { glucose: toMgdl(st.glucose), target: toMgdl(st.target), iob: st.iob } : { noGlucose: true };
    var boluses = ["combined", "meal", "correction"].indexOf(m) > -1;
    var ctx = { age: num(st.ctx.age) ? Number(st.ctx.age) : null, weightKg: st.ctx.weightKg,
      pregnancy: st.ctx.pregnancy, renal: st.ctx.renal, hepatic: st.ctx.hepatic, pediatric: st.ctx.pediatric,
      exercise: st.ctx.exercise, steroids: st.ctx.steroids, egfr: st.ctx.egfr, dialysis: st.ctx.dialysis, trimester: st.ctx.trimester,
      dailyTotalTracked: !!st.patientId };
    if (boluses) {
      ctx.maxBolus = SET.maxBolus;
      // Only run the max-DAILY check when the running total is attributable to one patient.
      // Aggregating six patients' doses on a shared device produced false critical interrupts.
      if (st.patientId) { ctx.maxDaily = SET.maxDaily; if (res && res.rounded != null) res.dailyTotal = todayTotal() + res.rounded; }
    }
    // Weight-based initiation computes a whole-day TDD — check it against the daily cap so a weight typo
    // (e.g. 700 kg -> 280 u/day) trips the critical interrupt instead of returning a dangerous number.
    if (m === "basal" || m === "pediatric") { ctx.maxDaily = SET.maxDaily; if (res && num(res.tdd)) res.dailyTotal = res.tdd; }
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
    st._hasCritical = hasCritical;
    var out = document.getElementById("insOut");
    if (!out) return;

    if (res.error || res.rounded == null) {
      // "Enter all required values" leaves the user hunting for which box is empty. Name them.
      // st.mode, NOT the `m` declared further down - var-hoisting makes it undefined up here.
      var missing = missingFields(st.mode);
      var msg = res.routing || (missing.length ? "" : (res.error || (res.assumptions && res.assumptions[0]) || "Enter the required inputs to calculate."));
      out.innerHTML = '<div class="ins-card ins-result"><div class="ins-card-t">' + (res.route ? "Use a different protocol" : "Recommendation") + '</div>' +
        (missing.length ? '<p class="ins-need">Still needed: <b>' + missing.join("</b>, <b>") + '</b></p>' : '') +
        (msg ? '<p style="color:var(--ins-muted);font-size:13px;margin:0">' + msg + '</p>' : '') + '</div>';
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
    var actionable = ["combined", "meal", "correction", "basal", "pediatric", "dka",
      "basalT2", "inpatient", "premix", "premixTitr", "titrate", "npo", "steroid", "ivsc",
      "nutrition", "periop", "discharge", "sick"].indexOf(m) > -1;
    /* A regimen the diagnosis forbids is shown, not hidden - the resident needs to know the
     * scale exists and why it is wrong here, or they will build one by hand instead. */
    var blockedHTML = res.blocked ? '<div class="ins-warn warning"><span class="ins-warn-band">' + SVG_TRI + '</span>' +
      '<div class="ins-warn-body"><span class="ins-warn-sig">Not appropriate for this diagnosis</span>' +
      '<span class="bd">' + esc(res.blocked) + '</span></div></div>' : "";
    var cardTitle = (m === "isf" || m === "icr") ? "Result" : m === "iob" ? "Active insulin (IOB)" : m === "dka" ? "Infusion rate"
      : m === "scale" ? "Correction scale" : m === "titrate" ? "New basal dose"
      : ["basal", "pediatric", "inpatient", "premix", "premixTitr", "npo", "ivsc", "basalT2"].indexOf(m) > -1 ? "Suggested regimen"
      : m === "steroid" ? "Steroid cover (in addition to usual insulin)" : "Recommended dose";
    // Mirror the engine exactly: IOB nets off the CORRECTION, never the meal cover.
    var extraRaw = m === "combined"
      ? 'meal ' + res.mealComponent + 'u + correction ' + (res.iobSubtracted ? '(' + res.correctionComponent + ' - IOB ' + res.iobSubtracted + ' = ' + res.correctionAfterIob + ')u' : res.correctionComponent + 'u')
      : (m === "correction" && res.iobSubtracted) ? 'correction ' + res.grossCorrection + 'u - IOB ' + res.iobSubtracted + 'u' : "";
    var unitNote = mmolMode() ? ' &middot; working shown in mg/dL (canonical); entries converted from mmol/L' : '';
    var fromraw = 'Computed ' + res.result + ' ' + res.unit + (doseUnitMode(m) ? ', rounded to ' + st.increment + ' unit' : '') + (extraRaw ? ' &middot; ' + extraRaw : '') + unitNote;
    // First-dose provenance: show every resolved value (ISF/TDD/IOB) WITH its source so an estimate never reads as measured.
    var provHTML = (res.provenance && res.provenance.length) ? '<div class="ins-prov">' + res.provenance.map(function (p) {
      return '<div class="ins-prov-row"><span class="k">' + p.label + '</span><span class="v">' + p.value + '</span><span class="s">' + p.source + '</span></div>';
    }).join("") + '</div>' : "";
    var monitoringHTML = (res.monitoring && res.monitoring.length) ? '<div class="ins-conv-sec"><h4>Monitoring</h4><ul>' + res.monitoring.map(function (x) { return '<li>' + x + '</li>'; }).join("") + '</ul></div>' : "";

    /* A correction scale is a TABLE, not a single number - a resident copies it onto the
     * chart. Rendering it as one headline dose would make it useless for its actual job. */
    var scaleHTML = (res.rows && res.rows.length) ? '<div class="ins-scale"><table><thead><tr>' +
      '<th>Glucose (mg/dL)</th><th>Give</th></tr></thead><tbody>' +
      res.rows.map(function (r) {
        return '<tr><td>' + r.label + '</td><td><b>' + r.units + '</b> u' + (r.cappedAt ? ' <span class="cap">capped</span>' : '') + '</td></tr>';
      }).join("") + '</tbody></table>' +
      '<div class="ins-tgt-note">Below ' + res.rows[0].from + ' mg/dL give nothing. Built from ISF ' + res.isf + ' mg/dL per unit.</div></div>' : "";

    /* Multi-part regimens (basal + prandial, morning + evening premix) must show every
     * component. Collapsing them to one "dose" is how a resident gives the total at once. */
    var parts = [];
    if (res.basal != null && (m !== "npo" || true)) parts.push(["Basal", res.basal + " u" + (m === "npo" ? " daily" : " once daily")]);
    if (res.mealBolusEach != null && res.mealBolusEach > 0) parts.push(["Each meal", res.mealBolusEach + " u before each of 3 meals"]);
    if (m === "npo") parts.push(["Prandial", "HELD while nil by mouth"]), parts.push(["Correction", res.correctionFrequency]);
    if (res.morning != null) parts.push(["Before breakfast", res.morning + " u"]);
    if (res.evening != null) parts.push(["Before dinner", res.evening + " u"]);
    if (m === "steroid" && res.nph != null) parts.push(["NPH with the steroid", res.nph + " u"]);
    if (m === "titrate") {
      parts.push(["Previous dose", res.previousDose + " u"]);
      parts.push([res.action === "HOLD" ? "No change" : res.action === "INCREASE" ? "Increase to" : "Reduce to", res.rounded + " u/day"]);
    }
    var partsHTML = parts.length ? '<div class="ins-regimen">' + parts.map(function (p) {
      return '<div class="ins-reg-row"><span class="k">' + p[0] + '</span><span class="v">' + p[1] + '</span></div>';
    }).join("") + '</div>' : "";
    // Patient-context effect on a BOLUS: concrete adjusted figures, shown rather than
    // silently applied (ICR/ISF may already account for the context — see engine note).
    var ctxAdvHTML = "";
    if (bolusMode(m) && m !== "iob" && res.rounded != null) {
      var adv = window.INSULIN_ENGINE.bolusContextAdvice(res.rounded, st.ctx) || [];
      if (adv.length) ctxAdvHTML = '<div class="ins-conv-sec ins-ctxadj"><h4>Patient-context adjustment</h4>' +
        adv.map(function (a) { return '<div class="ins-ctxadj-row"><div class="ins-ctxadj-top"><span class="k">' + a.label + '</span><span class="v">' + a.value + '</span></div><div class="d">' + a.detail + '</div></div>'; }).join("") + '</div>';
    }
    /* A critical interrupt must gate the Accept button in EVERY mode. Paediatric and DKA
     * previously skipped the critical acknowledgement entirely (`&& !clinMode(m)`), so the
     * two highest-harm workflows were the only ones where a critical warning did not have
     * to be acknowledged - the generic "I am a trained clinician" tick alone released it.
     * Both gates now apply, and both must be satisfied. */
    var showCritAck = hasCritical;
    var ctaDisabled = (hasCritical && !st.acked) || (clinMode(m) && !st.advAck);

    out.innerHTML =
      '<div class="ins-card ins-result ins-bf"><div class="ins-card-t">' + cardTitle + '</div>' +
        '<div class="ins-dose"><span class="n" id="insDoseN">0</span><span class="unit">' + res.unit + '</span></div>' +
        '<div class="ins-fromraw">' + fromraw + '</div>' + blockedHTML + provHTML + partsHTML + scaleHTML +
        '<div class="ins-formula">' + res.formula + '</div>' +
        '<ul class="ins-steps">' + stepsHTML + '</ul>' + ctxAdvHTML + monitoringHTML + dxNotesHTML() +
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
        // What was ACTUALLY prescribed, which is often not what the calculator said.
        '<div class="ins-given"><label for="insGiven">Dose actually given</label>' +
          '<input id="insGiven" data-ins="given" type="number" inputmode="decimal" placeholder="' + res.rounded + '" aria-label="Dose actually given">' +
          '<span class="u">' + res.unit + '</span></div>' +
        '<div class="ins-tgt-note">Leave blank to record the suggested ' + res.rounded + ' ' + res.unit + '. Enter a different number if you are giving something else - the audit trail, the daily total and the insulin-on-board estimate all follow what was given.</div>' +
        '<button class="ins-cta" data-ins="confirm"' + (ctaDisabled ? ' disabled' : '') + '>Accept and record</button>' +
        '<div class="ins-done" id="insDone" style="display:none">Recorded to history. The order remains the physician\'s to place.</div>' : '');

    // Animate only when the dose genuinely changes to a new value, and never mid-typing:
    // re-running the count-up on every keystroke made the number flicker from 0 constantly.
    var dn = document.getElementById("insDoseN");
    if (dn) {
      if (st._lastMode === m) dn.textContent = fmt(res.rounded);   // typing: update in place
      else countUp(dn, res.rounded);                               // arriving on a screen: animate once
      st._lastMode = m;
    }
  }

  /* ---------- events ---------- */
  function onClick(e) {
    var t = e.target.closest("[data-ins]"); if (!t) return;
    var a = t.getAttribute("data-ins");
    if (a === "close") return close();
    if (a === "dx-pick") {
      st.dxType = t.getAttribute("data-v");
      // The diagnosis sets the scale band unless the user later overrides it by hand.
      var dg = window.INSULIN_ENGINE.dxGuidance(st.dxType);
      st.scaleResist = dg.resistance || "usual";
      if (st.dxType === "t1" || st.dxType === "secondary") st.npoType1 = true;
      return go("dashboard");
    }
    if (a === "dx-skip") { st.dxSkipped = true; SET.dxSkipped = true; saveSettings(); return go("dashboard"); }
    if (a === "dx-open") return go("dxgate");
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
    /* Add a patient straight from Ward Sync (GHIS / Connect EMR).
     * Ward Sync already owns the roster, its search and filters, the sign-in and the session,
     * and a real ward is hundreds of patients - so a second list here would duplicate all of
     * it and then drift. GHIS.pickPatient() opens that roster in one-shot pick mode and hands
     * back the tapped patient; the full record (age, sex, bed, unit) comes from getPatients().
     * Same handoff SurgX uses. */
    if (a === "p-ward") {
      if (!wardAvailable()) { if (window.toast) toast("Ward Sync is not loaded"); return; }
      close();                                   // the picker is full-screen; give it the screen
      window.GHIS.pickPatient(function (sel) {
        var p = null;
        try {
          if (!sel) return;
          var full = null, list = window.GHIS.getPatients ? window.GHIS.getPatients() : [];
          for (var i = 0; i < list.length; i++) if (String(list[i].patientId) === String(sel.patientId)) { full = list[i]; break; }
          p = savePatient(wardProfile(sel, full));
        } catch (e) { p = null; }
        // Reopen either way, so backing out of the picker never strands the user elsewhere.
        open();
        if (!p) { if (window.toast) toast("Could not read that patient"); return; }
        applyProfile(p);
        // A ward patient has a diagnosis to establish before any scale is built.
        st.screen = st.dxType ? "calc" : "dxgate";
        paint();
        if (window.toast) toast("Added " + p.name + " from Ward Sync");
      });
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
    if (a === "qa") { st.mode = t.getAttribute("data-mode"); st.group = groupOf(st.mode); st.advAck = false; go("calc"); return; }
    if (a === "mode") { st.mode = t.getAttribute("data-mode"); st.advAck = false; syncSeg(); renderInputs(); render(); return; }
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
    if (a === "corr-source") { st.corrSource = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "fd-naive") { st.fdNaive = t.getAttribute("data-v") === "1"; renderInputs(); render(); return; }
    if (a === "fd-route") { st.fdRoute = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "nutfeed") { st.nutFeed = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "titrmethod") { st.titrMethod = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "resist") { st.scaleResist = t.getAttribute("data-v"); renderInputs(); render(); return; }
    if (a === "npoflag") { var nk = t.getAttribute("data-k"); st[nk] = !st[nk]; t.setAttribute("aria-pressed", st[nk]); render(); return; }
    if (a === "ivpct") { st.ivPercent = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "dkarate") { st.dkaRate = parseFloat(t.getAttribute("data-v")); renderInputs(); render(); return; }
    if (a === "dkapaeds") { st.dkaPaeds = !st.dkaPaeds; renderInputs(); render(); return; }
    if (a === "ctx") {
      var k = t.getAttribute("data-k"); st.ctx[k] = !st.ctx[k]; t.setAttribute("aria-pressed", st.ctx[k]);
      // Pregnancy raises insulin need, and auto-increasing a dose is the one direction
      // that can kill — so instead of a hidden multiplier we tighten the TARGET (which
      // is a visible field the clinician can see and override). A lower target legitimately
      // increases the correction. Restored when pregnancy is switched off.
      // The change is announced rather than made behind the user's back, and a target the
      // user typed themselves while pregnancy was on is not clobbered when it goes off.
      if (k === "pregnancy") {
        if (st.ctx.pregnancy) {
          if (st.target > 110) { st._preTarget = st.target; st.target = 100; st.targetNote = "Target tightened from " + st._preTarget + " to 100 mg/dL for pregnancy. Type any value to override."; }
        } else {
          if (st._preTarget && st.target === 100) st.target = st._preTarget;
          st._preTarget = null; st.targetNote = "";
        }
      }
      // Rebuild the INPUT card, not just the result: some chips own a dependent field
      // (Renal -> eGFR + dialysis, Pregnancy -> trimester) which otherwise never
      // appears/disappears when the chip is toggled.
      renderInputs();
      render(); return;
    }
    // A real flag, not a fabricated age. This chip used to write age 8 / age 40 into the
    // patient context, so a 15-year-old's profile read as "pressed" and one tap made them 40.
    if (a === "peds") { st.ctx.pediatric = !st.ctx.pediatric; t.setAttribute("aria-pressed", st.ctx.pediatric); render(); return; }
    if (a === "tri") { var tv = parseInt(t.getAttribute("data-v"), 10); st.ctx.trimester = (st.ctx.trimester === tv ? null : tv); render(); return; }
    if (a === "convfreq") { st.convFromFreq = t.getAttribute("data-v"); paint(); return; }
    if (a === "group") {
      var g = t.getAttribute("data-g");
      st.group = g;
      // Landing on a tab that is not in the chosen group would leave the user staring at
      // inputs for a calculation they did not pick - always land on the group's first mode.
      if (groupOf(st.mode) !== g) { st.mode = firstModeIn(g); st.advAck = false; }
      paint(); return;
    }
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
    if (a === "steroidkind") { st.steroidKind = t.value; render(); return; }
    if (a === "set-num") { var k = t.getAttribute("data-k"); var v = parseFloat(t.value); if (isFinite(v)) { SET[k] = v; saveSettings(); } return; }
    if (a === "set-text") { SET[t.getAttribute("data-k")] = t.value; saveSettings(); return; }
    if (a === "set-glass") { SET.homeGlass = t.value; saveSettings(); return; }
    if (a === "ask-q") { st.askQ = t.value; renderAskSearch(); return; }
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
    // Both gates are independent and BOTH must be satisfied - setting one must never
    // release the button on its own (that was how a critical warning got past DKA mode).
    if (a === "ack") { st.acked = t.checked; syncCta(); return; }
    if (a === "adv-ack") { st.advAck = t.checked; syncCta(); return; }
  }
  // Single source of truth for whether Accept is releasable.
  function syncCta() {
    var cta = document.querySelector(".ins-cta");
    if (cta) cta.disabled = (st._hasCritical && !st.acked) || (clinMode(st.mode) && !st.advAck);
  }
  function syncSeg() {
    var b = document.querySelectorAll('[data-ins="mode"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-selected", b[i].getAttribute("data-mode") === st.mode);
  }
  function pressGroup(name) {
    var b = document.querySelectorAll('[data-ins="' + name + '"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.increment);
  }
  function syncTargetChips() {
    var b = document.querySelectorAll('[data-ins="target-chip"]');
    for (var i = 0; i < b.length; i++) b[i].setAttribute("aria-pressed", parseFloat(b[i].getAttribute("data-v")) === st.target);
  }
  /* The physician routinely gives something other than the calculated number ("it says 9,
   * I'm giving 6"). An audit trail that can only record the calculator's own output is an
   * audit of the calculator, not of care - and the IOB and daily total that read back from
   * it would then be wrong too. givenDose is what was actually prescribed. */
  function confirmDose(btn) {
    if (btn.disabled) return;
    var res = compute(), warns = safety(res);
    var gi = document.querySelector('[data-ins="given"]');
    var given = gi && gi.value !== "" && isFinite(parseFloat(gi.value)) ? parseFloat(gi.value) : res.rounded;
    pushLog({ mode: st.mode, patientId: st.patientId || null, patientName: st.patientId ? st.patientName : "",
      inputs: snapshot(), calculatedDose: res.rounded, confirmedDose: res.rounded, givenDose: given,
      overridden: given !== res.rounded,
      unit: res.unit, warnings: warns.map(function (w) { return w.id; }), engineVersion: 2, ts: Date.now() });
    btn.style.display = "none";
    var d = document.getElementById("insDone");
    if (d) {
      d.innerHTML = given !== res.rounded
        ? "Recorded " + given + " " + res.unit + " as given (calculator suggested " + res.rounded + "). The order remains the physician's to place."
        : "Recorded to history. The order remains the physician's to place.";
      d.style.display = "block"; springIn(d);
    }
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
    // Ask the type first, unless it is already known (from a patient profile) or was skipped.
    st.screen = (st.dxType || st.dxSkipped) ? "dashboard" : "dxgate";
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
  /* Test-only surface (mirrors oncotree.js `_st`): lets test/insulin-ui.test.mjs drive the real
   * state through the real HTML builders in Node, with no browser. Not used by the app. */
  window.INSULIN._st = st;
  window.INSULIN._set = SET;
  window.INSULIN._build = { dashboard: dashboardHTML, dxGate: dxGateHTML, dxChip: dxChipHTML,
    calc: calcHTML, modes: visibleModes, groupOf: groupOf, wardProfile: wardProfile,
    compute: compute, safety: safety, modeLabel: modeLabel, howItWorks: howItWorks,
    todayTotal: todayTotal, logForPatient: logForPatient,
    questions: function () { return QUESTIONS; }, missingFields: missingFields,
    render: render, renderInputs: renderInputs };
})();
