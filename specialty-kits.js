/* StewardMD - Specialty kits (window.SMD_KITS).
 *
 * The specialty layer of the OPD consult, for doctors who are not physicians: O&G, Paediatrics,
 * Orthopaedics, Ophthalmology, ENT, Dermatology, Psychiatry, Dental. A kit is
 *   - structured history / examination SECTIONS whose composed text is ADDED to the existing Initial
 *     Assessment fields (opd-emr.js), so it is saved by the normal "Save to GHIS/EMR" action. Nothing
 *     here saves, signs or orders anything by itself;
 *   - TOOLS computed in code: pregnancy dating (ACOG redating rule), WHO growth z-scores (exactly the
 *     WHO anthro / anthroplus method), developmental milestones (CDC 2022), visual acuity with the
 *     WHO ICD-11 category, hearing (WHO 2021 grades, tuning forks), dental chart with DMFT, PASI;
 *   - shortcuts to investigations (OPD search), protocols (Knowledge Library) and calculators;
 *   - short patient-advice texts.
 * Content: kb/specialty-kits/kits.json (built from kb/specialty-kits/src by
 * scripts/build-specialty-kits.mjs; KITS_V keeps the SW cache honest). Growth LMS data:
 * kb/growth/who-growth.json (scripts/build-who-growth.mjs), fetched only when the growth tool runs.
 *
 * Hosts: inside the OPD EMR (#smdOpdEmr, via G.OPDEMR.kitHost: add to assessment, open the
 * investigation search / protocol / immunisation tab), or the standalone sheet (#smdKit, from Home),
 * where "Add" becomes "Copy". Flag: smd_specialty_kits (specialty-kits-flags.js, default ON, ?kits=0).
 * Decision support only: every kit shows its review status; the doctor verifies and saves.
 * Buildless ES5 IIFE; the pure maths is exported for node tests.
 */
(function (root) {
  "use strict";
  var G = root, D = root.document;
  var KITS_V = "236992a6fc7f";
  var GROWTH_V = "3f0c86f21010";

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function ms(n) { return '<span class="material-symbols-outlined kit-ic" aria-hidden="true">' + n + "</span>"; }
  function num(v) { if (v === "" || v == null) return null; var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function flagOn() { try { return !G.SMD_KITS_FLAGS || G.SMD_KITS_FLAGS.on(); } catch (e) { return true; } }

  /* ================================ pure maths (node-tested) ================================ */

  // ---- dates (UTC midnight, so day arithmetic never crosses a DST edge) ----
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim()); if (!m) return null;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (d.getUTCMonth() === +m[2] - 1) ? d : null;
  }
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
  function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
  function dayDiff(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
  function fmtDate(d) { return d ? d.getUTCDate() + " " + MON[d.getUTCMonth()] + " " + d.getUTCFullYear() : ""; }
  function fmtGA(days) { return Math.floor(days / 7) + "+" + (days % 7) + " weeks"; }

  // ---- pregnancy dating: LMP (Naegele with cycle adjustment) and ultrasound, ACOG CO 700 redating ----
  // Redate to the ultrasound EDD when the LMP and scan disagree by more than the threshold for the GA
  // at the scan (ACOG Committee Opinion 700, Table 1). GA in days.
  function acogThreshold(gaScanDays) {
    if (gaScanDays <= 62) return 5;         // up to 8+6
    if (gaScanDays <= 97) return 7;         // 9+0 to 13+6
    if (gaScanDays <= 111) return 7;        // 14+0 to 15+6
    if (gaScanDays <= 153) return 10;       // 16+0 to 21+6
    if (gaScanDays <= 195) return 14;       // 22+0 to 27+6
    return 21;                              // 28+0 onwards
  }
  /** o: { lmp, cycle, lmpUncertain, usgDate, usgWeeks, usgDays, asOf } (dates ISO). */
  function dating(o) {
    o = o || {};
    var out = { ok: false, notes: [] };
    var asOf = parseISO(o.asOf) || parseISO(todayISO());
    var lmp = parseISO(o.lmp), usg = parseISO(o.usgDate);
    var cyc = num(o.cycle), adj = (cyc != null && cyc >= 21 && cyc <= 45) ? cyc - 28 : 0;
    var uw = num(o.usgWeeks), ud = num(o.usgDays) || 0;
    var gaScan = (usg && uw != null && uw >= 4 && uw <= 42 && ud >= 0 && ud <= 6) ? Math.round(uw * 7 + ud) : null;
    if (lmp) { out.eddLmp = addDays(lmp, 280 + adj); out.gaLmp = dayDiff(lmp, asOf) - adj; if (adj) out.notes.push("EDD by LMP adjusted for a " + cyc + "-day cycle."); }
    if (gaScan != null) { out.eddUsg = addDays(usg, 280 - gaScan); out.gaUsg = gaScan + dayDiff(usg, asOf); }
    if (!out.eddLmp && !out.eddUsg) return out;
    var basis = out.eddLmp ? "LMP" : "ultrasound";
    if (out.eddLmp && out.eddUsg) {
      var gaLmpAtScan = dayDiff(lmp, usg) - adj;
      out.discrepancy = Math.abs(gaLmpAtScan - gaScan);
      out.threshold = acogThreshold(gaScan);
      if (o.lmpUncertain) { basis = "ultrasound"; out.notes.push("LMP uncertain: dated by ultrasound."); }
      else if (out.discrepancy > out.threshold) { basis = "ultrasound"; out.notes.push("LMP and scan differ by " + out.discrepancy + " days (more than " + out.threshold + " at this gestation): redate to the ultrasound EDD (ACOG)."); }
      else out.notes.push("LMP and scan differ by " + out.discrepancy + " days (within " + out.threshold + "): keep the LMP EDD (ACOG).");
    }
    if (gaScan != null && gaScan > 153 && basis === "ultrasound" && !out.eddLmp) out.notes.push("First scan after 22 weeks: the pregnancy is suboptimally dated (ACOG).");
    out.basis = basis;
    out.edd = basis === "LMP" ? out.eddLmp : out.eddUsg;
    out.ga = basis === "LMP" ? out.gaLmp : out.gaUsg;
    if (out.ga < 0 || out.ga > 44 * 7) { out.notes.push("The gestational age is outside 0 to 44 weeks: check the dates."); return out; }
    out.ok = true;
    out.trimester = out.ga < 98 ? "First trimester" : out.ga < 196 ? "Second trimester" : "Third trimester";
    var base = addDays(out.edd, -280);
    var win = function (label, fromW, toW) { return { label: label, from: addDays(base, fromW), to: toW != null ? addDays(base, toW) : null }; };
    out.milestones = [
      win("First-trimester scan and screening (11+0 to 13+6)", 77, 97),
      win("Anomaly scan (18+0 to 22+0)", 126, 154),
      win("Test for gestational diabetes (24+0 to 28+0)", 168, 196),
      win("Anti-D prophylaxis if RhD negative (28+0)", 196),
      win("Term (37+0)", 259),
      win("Offer induction if not in labour (41+0)", 287)
    ];
    return out;
  }

  // ---- WHO growth: the anthro (0 to 5 y) and anthroplus (5 to 19 y) algorithms ----
  var DAYS_PER_MONTH = 30.4375;
  function lmsZ(y, l, m, s) { return Math.abs(l) < 1e-12 ? Math.log(y / m) / s : (Math.pow(y / m, l) - 1) / (s * l); }
  // WHO's restricted application: beyond +/-3 SD the distance is measured in the 2-to-3 SD interval,
  // so extreme weights are not exaggerated by the skewed tail (anthro compute_zscore_adjusted).
  function lmsZAdj(y, l, m, s) {
    var z = lmsZ(y, l, m, s);
    var sd = function (k) { return m * Math.pow(1 + l * s * k, 1 / l); };
    if (z > 3) { var p3 = sd(3), p23 = p3 - sd(2); z = 3 + (y - p3) / p23; }
    else if (z < -3) { var n3 = sd(-3), n23 = sd(-2) - n3; z = -3 + (y - n3) / n23; }
    return z;
  }
  function roundUp(x) { return Math.floor(x + 0.5); }
  function atIndex(t, i) { return (i >= 0 && i < t.l.length) ? { l: t.l[i], m: t.m[i], s: t.s[i] } : null; }
  function interp(a, b, f) { return { l: a.l + f * (b.l - a.l), m: a.m + f * (b.m - a.m), s: a.s + f * (b.s - a.s) }; }
  function byDay(tab, sex, day) { var t = tab && tab[sex]; return t ? atIndex(t, day - t.start) : null; }
  function byCm(tab, sex, cm) {        // 0.1 cm grid; linear interpolation like anthro
    var t = tab && tab[sex]; if (!t) return null;
    var tenth = Math.floor(cm * 10 + 1e-9), i = tenth - Math.round(t.start * 10), f = (cm * 10 - tenth);
    var a = atIndex(t, i); if (!a) return null;
    if (f > 1e-9) { var b = atIndex(t, i + 1); if (!b) return null; return interp(a, b, f); }
    return a;
  }
  function byMonth(tab, sex, months) { // monthly grid; linear interpolation like anthroplus
    var t = tab && tab[sex]; if (!t) return null;
    var lo = Math.floor(months), f = months - lo, a = atIndex(t, lo - t.start); if (!a) return null;
    if (f > 1e-12) { var b = atIndex(t, lo + 1 - t.start); if (!b) return null; return interp(a, b, f); }
    return a;
  }
  function pct(z) {                      // standard normal CDF (Abramowitz and Stegun 7.1.26)
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    var p = z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
    return Math.round(p * 1000) / 10;
  }
  function band(z, cuts) { for (var i = 0; i < cuts.length; i++) if (cuts[i][0](z)) return cuts[i][1]; return "Normal range"; }
  var LO = function (v) { return function (z) { return z < v; }; }, HI = function (v) { return function (z) { return z > v; }; };
  var CLASS = {
    wfa: [[LO(-3), "Severely underweight"], [LO(-2), "Underweight"], [HI(2), "High for age: judge by weight-for-length/height or BMI"]],
    lhfa: [[LO(-3), "Severely stunted"], [LO(-2), "Stunted"], [HI(3), "Very tall: rarely a problem unless an endocrine cause is suspected"]],
    wflh: [[LO(-3), "Severe wasting (SAM range)"], [LO(-2), "Wasting (MAM range)"], [HI(3), "Obese"], [HI(2), "Overweight"], [HI(1), "Possible risk of overweight"]],
    hcfa: [[LO(-3), "Below -3 SD: severe microcephaly range"], [LO(-2), "Below -2 SD: microcephaly range, assess"], [HI(2), "Above +2 SD: macrocephaly range, assess"]],
    acfa: [[LO(-3), "Below -3 SD"], [LO(-2), "Below -2 SD"]],
    hfa07: [[LO(-3), "Severely short for age"], [LO(-2), "Short for age (stunted)"]],
    wfa07: [[LO(-3), "Severely underweight"], [LO(-2), "Underweight"]],
    bfa07: [[LO(-3), "Severe thinness"], [LO(-2), "Thinness"], [HI(2), "Obesity"], [HI(1), "Overweight"]]
  };
  var LABEL = { wfa: "Weight-for-age", lhfa: "Length/height-for-age", wflh: "Weight-for-length/height", bfa: "BMI-for-age",
    hcfa: "Head circumference-for-age", acfa: "MUAC-for-age", hfa07: "Height-for-age", wfa07: "Weight-for-age", bfa07: "BMI-for-age" };
  // WHO flags for biologically implausible z-scores (anthro / anthroplus defaults).
  var FLAG = { wfa: [-6, 5], lhfa: [-6, 6], wflh: [-5, 5], bfa: [-5, 5], hcfa: [-5, 5], acfa: [-5, 5], hfa07: [-6, 6], wfa07: [-6, 5], bfa07: [-5, 5] };
  function result(key, z, cls) {
    z = r2(z); var f = FLAG[key];
    return { key: key, label: LABEL[key], z: z, pct: pct(z), flag: z < f[0] || z > f[1], cls: band(z, CLASS[cls || key]) };
  }
  /** in: { sex: 1|2, ageDays, weight, lenhei, measured: "l"|"h", hc, muac, oedema } -> results. */
  function growth(W, x) {
    var out = { rows: [], notes: [], sam: false };
    var sex = String(x.sex), ageDays = x.ageDays, months = ageDays / DAYS_PER_MONTH;
    if (sex !== "1" && sex !== "2") { out.notes.push("Select the sex."); return out; }
    if (ageDays == null || ageDays < 0) { out.notes.push("Enter the date of birth or age."); return out; }
    var w = num(x.weight), lh = num(x.lenhei), hc = num(x.hc), muac = num(x.muac), oed = !!x.oedema;
    if (oed) { out.sam = true; out.notes.push("Bilateral pitting oedema: severe acute malnutrition regardless of anthropometry (WHO). Weight-based z-scores are not calculated."); }
    out.months = months;
    if (months < 60) {
      var day = roundUp(ageDays), meas = x.measured === "h" ? "h" : x.measured === "l" ? "l" : null;
      if (meas === "h" && months < 9) { out.notes.push("Height measured standing under 9 months is implausible (WHO); measure lying down."); meas = null; }
      var clh = lh;
      if (lh != null && meas) { if (day < 731 && meas === "h") clh = lh + 0.7; if (day >= 731 && meas === "l") clh = lh - 0.7; }
      if (clh != null && clh !== lh) out.notes.push("Length/height standardised to " + r2(clh) + " cm (" + (clh > lh ? "+" : "") + "0.7 cm, WHO).");
      out.clenhei = clh;
      var p;
      if (w != null && w > 0 && !oed && (p = byDay(W.wfa, sex, day))) out.rows.push(result("wfa", lmsZAdj(w, p.l, p.m, p.s)));
      if (clh != null && clh > 0 && (p = byDay(W.lhfa, sex, day))) out.rows.push(result("lhfa", lmsZ(clh, p.l, p.m, p.s)));
      if (w != null && w > 0 && clh != null && !oed) {
        var useL = day < 731, lo = useL ? 45 : 65, hi = useL ? 110 : 120;
        if (clh >= lo && clh <= hi && (p = byCm(useL ? W.wfl : W.wfh, sex, clh))) out.rows.push(result("wflh", lmsZAdj(w, p.l, p.m, p.s)));
        else out.notes.push((useL ? "Weight-for-length needs 45 to 110 cm" : "Weight-for-height needs 65 to 120 cm") + ".");
        var bmi = w / Math.pow(clh / 100, 2); out.bmi = r2(bmi);
        if ((p = byDay(W.bfa, sex, day))) out.rows.push(result("bfa", lmsZAdj(bmi, p.l, p.m, p.s), "wflh"));
      }
      if (hc != null && hc > 0 && (p = byDay(W.hcfa, sex, day))) out.rows.push(result("hcfa", lmsZ(hc, p.l, p.m, p.s)));
      if (muac != null && muac > 0) {
        if (day >= 91 && (p = byDay(W.acfa, sex, day))) out.rows.push(result("acfa", lmsZAdj(muac, p.l, p.m, p.s)));
        if (months >= 6) {
          if (muac < 11.5) { out.sam = true; out.notes.push("MUAC below 11.5 cm: severe acute malnutrition (WHO)."); }
          else if (muac < 12.5) out.notes.push("MUAC 11.5 to 12.4 cm: moderate acute malnutrition (WHO).");
        }
      }
      out.rows.forEach(function (r) { if ((r.key === "wflh") && r.z < -3) out.sam = true; });
      out.reference = "WHO Child Growth Standards (0 to 5 years)";
    } else if (months < 229) {
      var q, h = lh, bmi7;
      if (h != null && h > 0 && (q = byMonth(W.hfa07, sex, months))) out.rows.push(result("hfa07", lmsZ(h, q.l, q.m, q.s)));
      if (w != null && w > 0 && !oed && months < 121 && (q = byMonth(W.wfa07, sex, months))) out.rows.push(result("wfa07", lmsZAdj(w, q.l, q.m, q.s)));
      if (w != null && w > 0 && h != null && h > 0 && !oed) {
        bmi7 = w / Math.pow(h / 100, 2); out.bmi = r2(bmi7);
        if ((q = byMonth(W.bfa07, sex, months))) out.rows.push(result("bfa07", lmsZAdj(bmi7, q.l, q.m, q.s)));
      }
      if (months >= 121) out.notes.push("Weight-for-age is not used after 10 years (WHO): use BMI-for-age.");
      out.reference = "WHO Growth Reference 2007 (5 to 19 years)";
    } else out.notes.push("WHO growth references cover birth to 19 years.");
    out.rows.forEach(function (r) { if (r.flag) out.notes.push(r.label + " z-score is outside the WHO plausible range: recheck the measurement."); });
    return out;
  }

  // ---- growth chart: WHO SD curves (-3, -2, 0, +2, +3) with the child's measurements over time ----
  var CHARTS = { wfa: ["Weight-for-age", "kg", "weight"], lhfa: ["Length/height-for-age", "cm", "lenhei"], wflh: ["Weight-for-length/height", "kg", "weight"],
    bfa: ["BMI-for-age", "kg/m2", "bmi"], hcfa: ["Head circumference-for-age", "cm", "hc"], hfa07: ["Height-for-age", "cm", "lenhei"], wfa07: ["Weight-for-age", "kg", "weight"], bfa07: ["BMI-for-age", "kg/m2", "bmi"] };
  function sdValue(p, z) { return Math.abs(p.l) < 1e-12 ? p.m * Math.exp(p.s * z) : p.m * Math.pow(1 + p.l * p.s * z, 1 / p.l); }
  function growthPoints(t, W) {
    var dob = parseISO(t.dob); if (!dob) return [];
    var rows = [{ date: t.asOf || todayISO(), weight: t.weight, lenhei: t.lenhei, hc: t.hc, now: true }].concat((t.hist || []).map(function (h) { return { date: h.date, weight: h.weight, lenhei: h.lenhei, hc: h.hc }; }));
    return rows.map(function (r) {
      var d = parseISO(r.date); if (!d) return null;
      var days = dayDiff(dob, d), w = num(r.weight), lh = num(r.lenhei), hc = num(r.hc);
      if (days < 0) return null;
      return { date: d, days: days, months: days / DAYS_PER_MONTH, weight: w, lenhei: lh, hc: hc, bmi: w && lh ? w / Math.pow(lh / 100, 2) : null, now: !!r.now };
    }).filter(Boolean).sort(function (a, b) { return a.days - b.days; });
  }
  function chartKeysFor(months) { return months < 60 ? ["wfa", "lhfa", "wflh", "bfa", "hcfa"] : ["hfa07", "wfa07", "bfa07"]; }
  /** Pure: series geometry for one chart. Returns { key, xLabel, unit, x0, x1, curves: [{z, pts:[[x,y]...]}], points: [{x,y,label}] } or null. */
  function growthChart(W, t, key) {
    if (!W || !CHARTS[key]) return null;
    var sex = t.sex === "Male" ? "1" : t.sex === "Female" ? "2" : ""; if (!sex) return null;
    var pts = growthPoints(t, W); if (!pts.length) return null;
    var def = CHARTS[key], curves = [], x0, x1, xs = [], tab, byX;
    var maxDays = pts[pts.length - 1].days;
    if (key === "wflh") {
      var useL = pts[pts.length - 1].days < 731; tab = useL ? W.wfl : W.wfh; x0 = useL ? 45 : 65; x1 = useL ? 110 : 120;
      for (var cm = x0; cm <= x1 + 1e-9; cm += 1) xs.push(cm);
      byX = function (x) { return byCm(tab, sex, x); };
    } else if (/07$/.test(key)) {
      tab = W[key]; x0 = 61; x1 = key === "wfa07" ? 120 : 228;
      for (var mo = x0; mo <= x1; mo += 1) xs.push(mo);
      byX = function (x) { return byMonth(tab, sex, x); };
    } else {
      tab = W[key]; x0 = key === "hcfa" || key === "wfa" || key === "lhfa" || key === "bfa" ? 0 : 0; x1 = maxDays < 731 ? 730 : 1826;
      for (var dd = x0; dd <= x1; dd += 7) xs.push(dd);
      if (xs[xs.length - 1] !== x1) xs.push(x1);
      byX = function (x) { return byDay(tab, sex, Math.round(x)); };
    }
    [-3, -2, 0, 2, 3].forEach(function (z) {
      var line = []; xs.forEach(function (x) { var p = byX(x); if (p) line.push([x, sdValue(p, z)]); });
      curves.push({ z: z, pts: line });
    });
    var points = [];
    pts.forEach(function (p) {
      var y = p[def[2]], x;
      if (y == null || y <= 0) return;
      if (key === "wflh") { x = p.lenhei; if (x == null) return; } else if (/07$/.test(key)) x = p.months; else x = p.days;
      if (x < x0 || x > x1) return;
      points.push({ x: x, y: y, label: fmtDate(p.date) + ": " + r2(y) + " " + def[1] + (p.now ? " (this visit)" : "") });
    });
    return { key: key, title: def[0], unit: def[1], xLabel: key === "wflh" ? "Length/height (cm)" : /07$/.test(key) ? "Age (years)" : x1 > 730 ? "Age (years)" : "Age (months)",
      xUnit: key === "wflh" ? "cm" : /07$/.test(key) ? "month" : "day", x0: x0, x1: x1, curves: curves, points: points };
  }
  function niceStep(span, n) { var raw = span / n, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10)), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
  function growthChartSvg(c) {
    if (!c || !c.curves.length) return "";
    var L = 38, R = 312, T = 12, B = 186, ys = [];
    c.curves.forEach(function (cv) { cv.pts.forEach(function (p) { ys.push(p[1]); }); }); c.points.forEach(function (p) { ys.push(p.y); });
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys), pad = (y1 - y0) * 0.04; y0 = Math.max(0, y0 - pad); y1 += pad;
    var sx = function (x) { return L + (x - c.x0) / (c.x1 - c.x0) * (R - L); }, sy = function (y) { return B - (y - y0) / (y1 - y0) * (B - T); };
    var f1 = function (v) { return Math.round(v * 10) / 10; };
    var g = "", step = niceStep(y1 - y0, 5), v;
    for (v = Math.ceil(y0 / step) * step; v <= y1 + 1e-9; v += step) g += '<line class="kit-gc-grid" x1="' + L + '" x2="' + R + '" y1="' + f1(sy(v)) + '" y2="' + f1(sy(v)) + '"/><text class="kit-gc-tick" x="' + (L - 4) + '" y="' + f1(sy(v) + 3) + '" text-anchor="end">' + r2(v) + "</text>";
    // x ticks: months (0 to 24), years (0 to 5, 5 to 19) or cm
    var xt = [];
    if (c.xUnit === "cm") { for (v = Math.ceil(c.x0 / 10) * 10; v <= c.x1; v += 10) xt.push([v, String(v)]); }
    else if (c.xUnit === "month") { for (v = 72; v <= c.x1; v += 24) xt.push([v, String(v / 12)]); }
    else if (c.x1 <= 730) { for (v = 0; v <= 24; v += 3) xt.push([v * DAYS_PER_MONTH, String(v)]); }
    else { for (v = 0; v <= 5; v += 1) xt.push([v * 365.25, String(v)]); }
    xt.forEach(function (x) { if (x[0] < c.x0 - 1e-9 || x[0] > c.x1 + 1e-9) return; g += '<line class="kit-gc-grid" y1="' + T + '" y2="' + B + '" x1="' + f1(sx(x[0])) + '" x2="' + f1(sx(x[0])) + '"/><text class="kit-gc-tick" x="' + f1(sx(x[0])) + '" y="' + (B + 13) + '" text-anchor="middle">' + x[1] + "</text>"; });
    var curves = c.curves.map(function (cv) {
      if (!cv.pts.length) return "";
      var d = cv.pts.map(function (p, i) { return (i ? "L" : "M") + f1(sx(p[0])) + " " + f1(sy(p[1])); }).join("");
      var last = cv.pts[cv.pts.length - 1];
      return '<path class="kit-gc-z kit-gc-z' + Math.abs(cv.z) + '" d="' + d + '"/><text class="kit-gc-zl" x="' + (R + 4) + '" y="' + f1(sy(last[1]) + 3) + '">' + (cv.z > 0 ? "+" + cv.z : String(cv.z)) + "</text>";
    }).join("");
    var pts = c.points.slice().sort(function (a, b) { return a.x - b.x; });
    var path = pts.length > 1 ? '<path class="kit-gc-line" d="' + pts.map(function (p, i) { return (i ? "L" : "M") + f1(sx(p.x)) + " " + f1(sy(p.y)); }).join("") + '"/>' : "";
    var dots = pts.map(function (p) { return '<circle class="kit-gc-pt" cx="' + f1(sx(p.x)) + '" cy="' + f1(sy(p.y)) + '" r="4.5"><title>' + esc(p.label) + "</title></circle>"; }).join("");
    return '<figure class="kit-gc"><figcaption>' + esc(c.title) + " (WHO), " + esc(c.unit) + '</figcaption><svg viewBox="0 0 340 206" role="img" aria-label="' + esc(c.title + " chart with WHO standard deviation curves and " + pts.length + " measurement" + (pts.length === 1 ? "" : "s")) + '">' +
      g + curves + path + dots + '<text class="kit-gc-tick" x="' + ((L + R) / 2) + '" y="' + (B + 26) + '" text-anchor="middle">' + esc(c.xLabel) + "</text></svg></figure>";
  }

  // ---- vision: Snellen to logMAR, WHO ICD-11 category from presenting VA in the better eye ----
  var SNELLEN = ["6/5", "6/6", "6/7.5", "6/9", "6/12", "6/18", "6/24", "6/36", "6/60", "5/60", "4/60", "3/60", "2/60", "1/60", "CF", "HM", "PL", "NPL"];
  function snellenDecimal(v) { var m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(v || "")); return m ? (+m[1]) / (+m[2]) : (v === "CF" ? 0.014 : v === "HM" ? 0.005 : v === "PL" ? 0.002 : v === "NPL" ? 0 : null); }
  function logmar(v) { var m = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(String(v || "")); return m ? r2(Math.log(+m[2] / +m[1]) / Math.LN10) : null; }
  function whoVision(re, le) {
    var dr = snellenDecimal(re), dl = snellenDecimal(le);
    if (dr == null && dl == null) return null;
    var best = Math.max(dr == null ? -1 : dr, dl == null ? -1 : dl);
    if (best >= 0.5 - 1e-9) return "No visual impairment (better eye 6/12 or better)";
    if (best >= 1 / 3 - 1e-9) return "Mild visual impairment (worse than 6/12 to 6/18)";
    if (best >= 0.1 - 1e-9) return "Moderate visual impairment (worse than 6/18 to 6/60)";
    if (best >= 0.05 - 1e-9) return "Severe visual impairment (worse than 6/60 to 3/60)";
    return "Blindness range (worse than 3/60 in the better eye)";
  }

  // ---- hearing: WHO World report on hearing (2021) grades; tuning-fork interpretation ----
  function whoHearing(better, worse) {
    var b = num(better), w = num(worse);
    if (b == null) return null;
    var g = b < 20 ? "Normal hearing" : b < 35 ? "Mild hearing loss" : b < 50 ? "Moderate hearing loss" : b < 65 ? "Moderately severe hearing loss" :
      b < 80 ? "Severe hearing loss" : b < 95 ? "Profound hearing loss" : "Complete or total hearing loss";
    if (b < 20 && w != null && w >= 35) g = "Unilateral hearing loss (better ear normal, worse ear 35 dB or more)";
    return g + " (WHO 2021, better-ear average " + b + " dB HL)";
  }
  function tuningFork(weber, rinneR, rinneL) {
    if (!weber || !rinneR || !rinneL) return null;
    var negR = rinneR === "Negative", negL = rinneL === "Negative";
    if (weber === "Central") return (!negR && !negL) ? "Normal, or symmetrical sensorineural loss: confirm with audiometry." : "Bilateral conductive component likely: confirm with audiometry.";
    var side = weber === "Right" ? "right" : "left", other = side === "right" ? "left" : "right";
    var negSide = side === "right" ? negR : negL, negOther = side === "right" ? negL : negR;
    if (negSide && !negOther) return "Conductive hearing loss in the " + side + " ear likely.";
    if (!negSide && !negOther) return "Sensorineural hearing loss in the " + other + " ear likely.";
    if (!negSide && negOther) return "Possible severe sensorineural loss in the " + other + " ear (false negative Rinne): confirm with audiometry and masking.";
    return "Mixed or bilateral conductive pattern: confirm with audiometry.";
  }

  // ---- PASI (psoriasis area and severity index) ----
  var PASI_REGIONS = [["head", "Head and neck", 0.1], ["upper", "Upper limbs", 0.2], ["trunk", "Trunk", 0.3], ["lower", "Lower limbs", 0.4]];
  function pasiArea(p) { p = num(p); if (p == null || p <= 0) return 0; return p < 10 ? 1 : p < 30 ? 2 : p < 50 ? 3 : p < 70 ? 4 : p < 90 ? 5 : 6; }
  function pasi(v) {
    var total = 0, any = false;
    PASI_REGIONS.forEach(function (r) {
      var e = num(v[r[0] + "_e"]) || 0, i = num(v[r[0] + "_i"]) || 0, d = num(v[r[0] + "_d"]) || 0, a = pasiArea(v[r[0] + "_a"]);
      if (e || i || d || a) any = true;
      total += r[2] * (e + i + d) * a;
    });
    return any ? r2(total) : null;
  }

  // ---- dental chart (FDI two-digit notation) and DMFT / dmft ----
  var PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  var PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
  var TOOTH = [["", "Sound"], ["D", "Decayed"], ["F", "Filled"], ["M", "Missing (caries)"], ["X", "Missing (other)"], ["C", "Crown"], ["R", "Root canal treated"], ["T", "Fractured"], ["U", "Unerupted"]];
  function toothLabel(code) { for (var i = 0; i < TOOTH.length; i++) if (TOOTH[i][0] === code) return TOOTH[i][1]; return "Sound"; }
  function dmft(chart, primary) {
    var d = 0, m = 0, f = 0;
    (primary ? PRIMARY : PERMANENT).forEach(function (t) {
      var c = chart[t] || ""; if (c === "D") d++; else if (c === "M") m++; else if (c === "F") f++;
    });
    return { d: d, m: m, f: f, total: d + m + f };
  }

  // ---- reference-data tools (numbers come from kb/specialty-kits/src/data-*.json, each with its source) ----
  function DATA(name) { return (BUNDLE && BUNDLE.data && BUNDLE.data[name]) || null; }
  function srcName(d) { var s = d && d.source; if (Array.isArray(s)) s = s[0]; return s ? s.org + (s.year ? " " + s.year : "") : "reference"; }
  function pad2(n) { return ("0" + n).slice(-2); }
  function nowLocal() { var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }

  // Local anaesthetic maximum dose: min(mg/kg x weight, ceiling); volume from the % strength (1% = 10 mg/mL).
  function laDrug(t) { var d = DATA("la-doses"); return d ? (d.drugs.filter(function (x) { return x.label === t.drug; })[0] || null) : null; }
  // Williams and Walker 2014 (and the BNF) dose on ideal body weight, counting nobody above 70 kg. Without this
  // cap the preparations that have no mg ceiling (with adrenaline, ropivacaine) would grow without limit.
  var LA_WEIGHT_CAP = 70;
  function laCalc(t) {
    var drug = laDrug(t), w0 = num(t.weight); if (!drug || w0 == null || w0 <= 0) return null;
    var withA = t.adr === "With adrenaline" && !!drug.withAdrenaline, p = withA ? drug.withAdrenaline : drug.plain; if (!p) return null;
    var w = Math.min(w0, LA_WEIGHT_CAP), byWt = p.mgPerKg != null ? p.mgPerKg * w : null;
    var mg = byWt == null ? p.maxMg : (p.maxMg != null ? Math.min(byWt, p.maxMg) : byWt); if (mg == null) return null;
    var pct = num(String(t.strength || "").replace("%", "")); if (pct != null && (drug.strengths || []).indexOf(pct) < 0) pct = null;
    return { drug: drug, withA: withA, p: p, w: w, wCapped: w0 > LA_WEIGHT_CAP, mg: Math.round(mg * 10) / 10, capped: byWt != null && p.maxMg != null && byWt > p.maxMg, pct: pct, ml: pct ? Math.round(mg / (pct * 10) * 10) / 10 : null };
  }

  // Burns: Lund and Browder chart (region % by age column) x fraction burnt; Parkland 4 mL x kg x %TBSA.
  var FRAC = { "1/4": 0.25, "1/2": 0.5, "3/4": 0.75, "All": 1 };
  function burnsAgeLabel(a) { var n = +a; return isNaN(n) ? String(a) : n === 0 ? "Under 1 year" : "Age " + n + (n === 1 ? " year" : " years"); }
  function burnsAge(t, d) { return d.ages.map(burnsAgeLabel).indexOf(t.age); }
  function burnsCalc(t) {
    var d = DATA("lund-browder"); if (!d) return null; var ai = burnsAge(t, d); if (ai < 0) return null;
    var tbsa = 0, parts = [];
    d.regions.forEach(function (r) { var f = FRAC[t["r_" + r.id]]; if (f) { tbsa += r.percent[ai] * f; parts.push(r.label + " " + (t["r_" + r.id] === "All" ? "all" : t["r_" + r.id])); } });
    tbsa = Math.round(tbsa * 10) / 10;
    var w = num(t.weight), pk = w && tbsa ? Math.round(4 * w * tbsa) : null;
    return { tbsa: tbsa, parts: parts, ageLabel: burnsAgeLabel(d.ages[ai]), parkland: pk, first8: pk != null ? Math.round(pk / 2) : null };
  }

  // CKD: KDIGO G and A categories and the heat-map risk; eGFR by CKD-EPI 2021 (race-free) from creatinine.
  function ckdEpi2021(scr, age, female) {
    var k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302;
    return 142 * Math.pow(Math.min(scr / k, 1), a) * Math.pow(Math.max(scr / k, 1), -1.2) * Math.pow(0.9938, age) * (female ? 1.012 : 1);
  }
  var CKD_RISK = [[0, 1, 2], [0, 1, 2], [1, 2, 3], [2, 3, 3], [3, 3, 3], [3, 3, 3]];
  var RISK_LABEL = ["Low", "Moderately increased", "High", "Very high"];
  function ckdCalc(t) {
    var e = num(t.egfr), computed = false;
    if (e == null) {
      var scr = num(t.scr), age = num(t.age);
      if (scr != null && scr > 0 && age != null && age >= 18 && (t.sex === "Male" || t.sex === "Female")) { e = ckdEpi2021(scr, age, t.sex === "Female"); computed = true; }
    }
    if (e == null || e < 0) return null; e = Math.round(e);
    var gi = e >= 90 ? 0 : e >= 60 ? 1 : e >= 45 ? 2 : e >= 30 ? 3 : e >= 15 ? 4 : 5;
    var acr = num(t.acr), unit = t.acrUnit === "mg/mmol" ? "mg/mmol" : "mg/g", ai = -1;
    if (acr != null && acr >= 0) { var lo = unit === "mg/g" ? 30 : 3, hi = unit === "mg/g" ? 300 : 30; ai = acr < lo ? 0 : acr <= hi ? 1 : 2; }
    return { egfr: e, computed: computed, g: ["G1", "G2", "G3a", "G3b", "G4", "G5"][gi], a: ai >= 0 ? "A" + (ai + 1) : "", acrText: ai >= 0 ? acr + " " + unit : "", risk: ai >= 0 ? CKD_RISK[gi][ai] : null };
  }

  // 28-joint count: DAS28-ESR, DAS28-CRP (CRP mg/L), CDAI, SDAI (CRP mg/dL). Patient global 0 to 100 mm.
  var JOINTS = [["shoulder", "Shoulder"], ["elbow", "Elbow"], ["wrist", "Wrist"], ["mcp1", "MCP 1"], ["mcp2", "MCP 2"], ["mcp3", "MCP 3"], ["mcp4", "MCP 4"], ["mcp5", "MCP 5"],
    ["pip1", "Thumb IP"], ["pip2", "PIP 2"], ["pip3", "PIP 3"], ["pip4", "PIP 4"], ["pip5", "PIP 5"], ["knee", "Knee"]];
  var JOINT_STATE = { "": "not involved", T: "tender", S: "swollen", TS: "tender and swollen" };
  var DAS_BANDS = [[2.6, "Remission", 1], [3.2, "Low activity"], [5.1, "Moderate activity"], [1e9, "High activity"]];
  var CDAI_BANDS = [[2.8, "Remission"], [10, "Low activity"], [22, "Moderate activity"], [1e9, "High activity"]];
  var SDAI_BANDS = [[3.3, "Remission"], [11, "Low activity"], [26, "Moderate activity"], [1e9, "High activity"]];
  function activity(v, b) { for (var i = 0; i < b.length; i++) if (b[i][2] ? v < b[i][0] : v <= b[i][0]) return b[i][1]; return b[b.length - 1][1]; }
  function jointCalc(t) {
    var j = t.j || {}, tender = [], swollen = [];
    JOINTS.forEach(function (jt) {
      ["R", "L"].forEach(function (s) { var c = j[s + ":" + jt[0]] || "", nm = s + " " + jt[1]; if (c.indexOf("T") >= 0) tender.push(nm); if (c.indexOf("S") >= 0) swollen.push(nm); });
    });
    var tjc = tender.length, sjc = swollen.length, esr = num(t.esr), crp = num(t.crp), pg = num(t.ptga), eg = num(t.evga);
    var base = 0.56 * Math.sqrt(tjc) + 0.28 * Math.sqrt(sjc), rd = function (x) { return Math.round(x * 100) / 100; };
    return {
      tjc: tjc, sjc: sjc, tender: tender, swollen: swollen,
      das28esr: esr != null && esr > 0 && pg != null ? rd(base + 0.70 * Math.log(esr) + 0.014 * pg) : null,
      das28crp: crp != null && crp >= 0 && pg != null ? rd(base + 0.36 * Math.log(crp + 1) + 0.014 * pg + 0.96) : null,
      cdai: pg != null && eg != null ? rd(tjc + sjc + pg / 10 + eg) : null,
      sdai: pg != null && eg != null && crp != null ? rd(tjc + sjc + pg / 10 + eg + crp / 10) : null
    };
  }

  // Injury body chart: front view (patient's right on the viewer's left) and back view (right on the right).
  var BODY = [
    ["f-head", "Head and face", "f", ["e", 60, 22, 14, 17]], ["f-neck", "Front of neck", "f", ["r", 53, 40, 14, 10]],
    ["f-chest-r", "Right chest", "f", ["r", 36, 51, 24, 34]], ["f-chest-l", "Left chest", "f", ["r", 60, 51, 24, 34]],
    ["f-abdomen", "Abdomen", "f", ["r", 38, 86, 44, 30]], ["f-pelvis", "Groin and genitalia", "f", ["r", 38, 117, 44, 18]],
    ["f-uarm-r", "Right upper arm, front", "f", ["r", 20, 52, 14, 42]], ["f-uarm-l", "Left upper arm, front", "f", ["r", 86, 52, 14, 42]],
    ["f-farm-r", "Right forearm, front", "f", ["r", 16, 96, 14, 38]], ["f-farm-l", "Left forearm, front", "f", ["r", 90, 96, 14, 38]],
    ["f-hand-r", "Right palm", "f", ["e", 22, 145, 8, 10]], ["f-hand-l", "Left palm", "f", ["e", 98, 145, 8, 10]],
    ["f-thigh-r", "Right thigh, front", "f", ["r", 40, 137, 19, 56]], ["f-thigh-l", "Left thigh, front", "f", ["r", 61, 137, 19, 56]],
    ["f-leg-r", "Right shin", "f", ["r", 42, 195, 16, 56]], ["f-leg-l", "Left shin", "f", ["r", 62, 195, 16, 56]],
    ["f-foot-r", "Right foot", "f", ["e", 50, 259, 10, 6]], ["f-foot-l", "Left foot", "f", ["e", 70, 259, 10, 6]],
    ["b-head", "Back of head", "b", ["e", 200, 22, 14, 17]], ["b-neck", "Back of neck", "b", ["r", 193, 40, 14, 10]],
    ["b-back-l", "Left upper back", "b", ["r", 176, 51, 24, 34]], ["b-back-r", "Right upper back", "b", ["r", 200, 51, 24, 34]],
    ["b-lback", "Lower back", "b", ["r", 178, 86, 44, 30]], ["b-butt", "Buttocks", "b", ["r", 178, 117, 44, 18]],
    ["b-uarm-l", "Left upper arm, back", "b", ["r", 160, 52, 14, 42]], ["b-uarm-r", "Right upper arm, back", "b", ["r", 226, 52, 14, 42]],
    ["b-farm-l", "Left forearm, back", "b", ["r", 156, 96, 14, 38]], ["b-farm-r", "Right forearm, back", "b", ["r", 230, 96, 14, 38]],
    ["b-hand-l", "Back of left hand", "b", ["e", 162, 145, 8, 10]], ["b-hand-r", "Back of right hand", "b", ["e", 238, 145, 8, 10]],
    ["b-thigh-l", "Left thigh, back", "b", ["r", 180, 137, 19, 56]], ["b-thigh-r", "Right thigh, back", "b", ["r", 201, 137, 19, 56]],
    ["b-leg-l", "Left calf", "b", ["r", 182, 195, 16, 56]], ["b-leg-r", "Right calf", "b", ["r", 202, 195, 16, 56]],
    ["b-heel-l", "Left heel", "b", ["e", 190, 259, 10, 6]], ["b-heel-r", "Right heel", "b", ["e", 210, 259, 10, 6]]
  ];
  var INJURY_TYPES = ["Abrasion", "Contusion (bruise)", "Laceration", "Incised wound", "Stab wound", "Firearm wound", "Burn or scald", "Bite mark", "Swelling", "Deformity", "Other"];
  function regionName(id) { var r = BODY.filter(function (x) { return x[0] === id; })[0]; return r ? r[1] : id; }

  // MCCD Form 4: order of Part I, the lowest used line as the underlying cause, no mode of dying there.
  function mccdCheck(t) {
    var d = DATA("mccd") || {}, lines = [], warn = [], i, n = (d.partI || []).length || 3;   // Form 4: (a) to (c)
    for (i = 0; i < n; i++) { var c = String(t["c" + i] || "").trim(); if (c) lines.push({ i: i, c: c, iv: String(t["i" + i] || "").trim() }); }
    if (!lines.length) return { lines: lines, warnings: warn, underlying: "" };
    for (i = 0; i < lines.length; i++) if (lines[i].i !== i) { warn.push("Fill Part I from line (a) downward, without gaps."); break; }
    var low = lines[lines.length - 1], lc = norm(low.c);
    var bad = (d.modesOfDying || []).concat(d.vagueTerms || []).filter(function (m) { var k = norm(m); return lc.indexOf(k) >= 0 && low.c.length <= String(m).length + 12; });
    if (bad.length) warn.push("The lowest line (" + low.c + ") is a mode of dying or a vague term. Enter the disease or injury that started the sequence as the underlying cause.");
    if (lines.some(function (x) { return !x.iv; })) warn.push("Give the approximate interval between onset and death on each line.");
    return { lines: lines, warnings: warn, underlying: low.c };
  }

  // WHO Labour Care Guide: alert values per row, and the time-based cervix and second-stage alerts.
  function lcgAlert(row, v) {
    var a = row && row.alert; if (!a || v == null || v === "") return false;
    if (a.is) return a.is.indexOf(String(v)) >= 0;
    var n = num(v); if (n == null) return false;
    return (a.below != null && n < a.below) || (a.atOrAbove != null && n >= a.atOrAbove) || (a.above != null && n > a.above) || (a.atOrBelow != null && n <= a.atOrBelow);
  }
  function lcgMs(at) { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(at || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null; }
  function lcgTime(at, short) { var ms_ = lcgMs(at); if (ms_ == null) return "time not set"; var d = new Date(ms_), hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes()); return short ? hm : d.getDate() + " " + MON[d.getMonth()] + " " + hm; }
  function lcgSorted(t) {
    return (t.e || []).map(function (x, i) { return { i: i, at: x.at, v: x.v || {}, ss: !!x.ss, ms: lcgMs(x.at) }; })
      .sort(function (a, b) { return (a.ms == null ? 1e15 : a.ms) - (b.ms == null ? 1e15 : b.ms); });
  }
  function lcgLabel(d, id) { var r = null; (d.sections || []).forEach(function (s) { s.rows.forEach(function (x) { if (x.id === id) r = x; }); }); return r ? r.label : id; }
  function lcgAlerts(t) {
    var d = DATA("lcg"); if (!d) return [];
    var e = lcgSorted(t), out = [], hrs = function (a, b) { return Math.round((b - a) / 36e5 * 10) / 10; };
    e.forEach(function (x) {
      d.sections.forEach(function (s) { s.rows.forEach(function (r) { var v = x.v[r.id]; if (lcgAlert(r, v)) out.push(r.label + " " + v + (r.unit && !r.alert.is ? " " + r.unit : "") + " at " + lcgTime(x.at, true)); }); });
    });
    var cx = e.filter(function (x) { return x.ms != null && num(x.v.cervix) != null; });
    (d.cervixAlertHours || []).forEach(function (c) {
      var at = cx.filter(function (x) { return num(x.v.cervix) === c.cm; }); if (at.length < 2) return;
      var first = at[0], later = cx.filter(function (x) { return x.ms > first.ms && num(x.v.cervix) > c.cm; })[0];
      var last = at.filter(function (x) { return !later || x.ms < later.ms; }).pop(), span = hrs(first.ms, last.ms);
      if (span >= c.hours) out.push("cervix at " + c.cm + " cm for " + span + " h (alert at " + c.hours + " h)");
    });
    var ss = e.filter(function (x) { return x.ss && x.ms != null; })[0], lastT = e.filter(function (x) { return x.ms != null; }).pop(), s2 = d.secondStage || {};
    if (ss && lastT && lastT.ms > ss.ms) {
      var par = num((t.b || {}).parity), lim = par === 0 ? s2.alertHoursNulliparous : s2.alertHoursMultiparous, span2 = hrs(ss.ms, lastT.ms);
      if (lim != null && par != null && span2 >= lim) out.push("second stage " + span2 + " h without birth recorded (alert at " + lim + " h)");
    }
    return out;
  }
  function lcgField(f, v, fid) {
    var map = { number: "number", text: "text", datetime: "datetime", check: "check", select: "select" };
    return fieldHtml({ id: fid, label: f.label, type: map[f.type] || "text", unit: f.unit, opts: f.options, optLabels: f.optionLabels }, v, "lcg");
  }

  // ---- section text: only what was filled in, in the kit's order ----
  function composeSection(sec, vals) {
    var parts = [];
    (sec.fields || []).forEach(function (f) {
      var v = vals[f.id];
      if (f.type === "check") { if (v) parts.push(f.label); return; }
      if (v == null || String(v).trim() === "") return;
      var s = String(v).trim();
      if (f.type === "date") { var d = parseISO(s); if (d) s = fmtDate(d); }
      parts.push(f.label + ": " + s + (f.unit ? " " + f.unit : ""));
    });
    return parts.length ? sec.title + ": " + parts.join("; ") + "." : "";
  }

  /* ===================================== state + data ===================================== */
  var BUNDLE = null, GROWTH = null, pendKits = null, pendGrowth = null, KS = {};
  function kitList() { return (BUNDLE && BUNDLE.kits) || []; }
  function kitById(id) { var k = kitList().filter(function (x) { return x.id === id; })[0]; return k || null; }
  function loadKits() {
    if (BUNDLE) return Promise.resolve(BUNDLE);
    if (pendKits) return pendKits;
    pendKits = fetch("/kb/specialty-kits/kits.json?v=" + encodeURIComponent(KITS_V)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (b) { BUNDLE = b; pendKits = null; return b; }, function (e) { pendKits = null; throw e; });
    return pendKits;
  }
  function loadGrowth() {
    if (GROWTH) return Promise.resolve(GROWTH);
    if (pendGrowth) return pendGrowth;
    pendGrowth = fetch("/kb/growth/who-growth.json?v=" + encodeURIComponent(GROWTH_V)).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (g) { GROWTH = g; pendGrowth = null; return g; }, function (e) { pendGrowth = null; throw e; });
    return pendGrowth;
  }
  var MINE_KEY = "smd_my_specialty", RECENT_KEY = "smd_kit_recent";
  // Recently opened kits (ids only, never patient data) so the chip row stays short with 26 kits.
  function recentKits() { try { var a = JSON.parse((G.localStorage && G.localStorage.getItem(RECENT_KEY)) || "[]"); return Array.isArray(a) ? a.filter(function (x) { return typeof x === "string"; }) : []; } catch (e) { return []; } }
  function pushRecent(id) {
    try { if (!G.localStorage || !id) return; var a = recentKits().filter(function (x) { return x !== id; }); a.unshift(id); G.localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 6))); } catch (e) {}
  }
  function groupList() { return (BUNDLE && BUNDLE.groups) || []; }
  // Notifiable diseases (data-notifiable.json): conditions whose keywords appear as whole words in text.
  function norm(t) { return " " + String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " "; }
  function notifiable(text) {
    var d = BUNDLE && BUNDLE.data && BUNDLE.data.notifiable, t = norm(text);
    if (!d || !d.conditions || t.length < 3) return [];
    return d.conditions.filter(function (c) { return (c.keywords || []).some(function (kw) { var k = norm(kw); return k.length > 2 && t.indexOf(k) >= 0; }); });
  }
  function mySpecialty() { try { return (G.localStorage && G.localStorage.getItem(MINE_KEY)) || ""; } catch (e) { return ""; } }
  // src "manual" (Set as my specialty) always wins over "profile" (mapped from the sign-up speciality).
  function setMySpecialty(id, src) {
    try {
      if (!G.localStorage) return;
      if (id) G.localStorage.setItem(MINE_KEY, id); else G.localStorage.removeItem(MINE_KEY);
      G.localStorage.setItem(MINE_KEY + "_src", src || "manual");
    } catch (e) {}
  }
  // A1: the profile's speciality (profile-setup.js SPECIALITIES) and degree -> the matching kit.
  var SPEC_TO_KIT = {
    "Obstetrics & Gynaecology": "obgyn", "Paediatrics": "paediatrics", "Neonatology": "paediatrics", "Paediatric Cardiology": "paediatrics",
    "Paediatric Surgery": "paediatrics", "Orthopaedics": "orthopaedics", "Sports Medicine": "orthopaedics", "Trauma Surgery": "emergency",
    "Ophthalmology": "ophthalmology", "Otorhinolaryngology (ENT)": "ent", "Dermatology, Venereology & Leprosy": "dermatology",
    "Psychiatry": "psychiatry", "Dentistry / OMFS": "dental", "Anaesthesiology": "anaesthesia", "Critical Care Medicine": "anaesthesia",
    "Emergency Medicine": "emergency", "General Surgery": "general-surgery", "Surgical Oncology": "general-surgery",
    "Surgical Gastroenterology": "general-surgery", "Endocrine Surgery": "general-surgery", "Plastic & Reconstructive Surgery": "general-surgery",
    "Vascular Surgery": "general-surgery", "Cardiothoracic & Vascular Surgery": "cardiology", "Cardiology": "cardiology",
    "Respiratory Medicine": "pulmonology", "Neurology": "neurology", "Neurosurgery": "neurology", "Nephrology": "nephrology-urology",
    "Urology": "nephrology-urology", "Endocrinology": "diabetes-endocrine", "Gastroenterology": "gastro-hepatology", "Hepatology": "gastro-hepatology",
    "Rheumatology": "rheumatology", "Clinical Immunology": "rheumatology", "Geriatric Medicine": "geriatrics", "Palliative Medicine": "palliative",
    "Physical Medicine & Rehabilitation": "rehabilitation", "Community Medicine": "community-medicine", "Family Medicine": "community-medicine",
    "Forensic Medicine": "forensic", "Medical Oncology": "cancer-screening", "Radiation Oncology": "cancer-screening"
  };
  function kitForProfile(spec, degree) { return SPEC_TO_KIT[String(spec || "").trim()] || (/\b(BDS|MDS)\b/.test(String(degree || "")) ? "dental" : ""); }
  function onProfile(e) {
    var d = (e && e.detail) || {}, id = kitForProfile(d.speciality, d.degree);
    try { if (!id || (G.localStorage && G.localStorage.getItem(MINE_KEY + "_src") === "manual")) return; } catch (x) { return; }
    if (id !== mySpecialty()) setMySpecialty(id, "profile");
  }
  // The MaiK Scribe template for my specialty, when the kit names one (A1: the scribe's default).
  function myScribe() {
    var id = mySpecialty(); if (!id) return "";
    var k = kitById(id); if (k) return k.scribe || "";
    try { var L = G.SMD_SCRIBETPL && G.SMD_SCRIBETPL.list(); return L && L.some(function (x) { return x.id === id; }) ? id : ""; } catch (e) { return ""; }
  }
  function myLabel() {
    var id = mySpecialty(); if (!id) return ""; var k = kitById(id); if (k) return k.label;
    for (var s in SPEC_TO_KIT) if (SPEC_TO_KIT[s] === id) return s;
    return id;
  }
  function ks(key) {
    if (!KS[key]) KS[key] = { kitId: "", vals: {}, tools: {}, picker: false, pickerQ: "" };
    return KS[key];
  }
  // Kit values can be clinical findings: memory only, and dropped when the consult they belong to ends.
  function forget(key) { delete KS[key]; }
  function toolState(k, id) { k.tools[id] = k.tools[id] || {}; return k.tools[id]; }

  /* ======================================== hosts ======================================== */
  function standaloneHost() {
    return {
      kind: "standalone", canWrite: function () { return true; }, ready: function () { return true; },
      addLabel: function () { return "Copy"; },
      insert: function (field, text) { copyText(text); },
      setField: function () {},
      repaint: function () { renderSheet(); },
      protocol: function (id) { if (G.SMD_KBPROTO && G.SMD_KBPROTO.open) G.SMD_KBPROTO.open({ id: id }); },
      calculator: function (id) { if (G.MEDCALC && G.MEDCALC.open) G.MEDCALC.open(id); },
      investigate: null, openTab: null, setScribe: null,
      patient: function () { return {}; }
    };
  }
  function hostFor(el) {
    if (el && el.closest && el.closest("#smdOpdEmr") && G.OPDEMR && G.OPDEMR.kitHost) return G.OPDEMR.kitHost;
    return standaloneHost();
  }
  // Copy that works in the Android and iOS WebViews: the hidden-textarea copy runs synchronously inside the
  // tap, where the async clipboard API can reject or never settle (no focus, no permission). The async API
  // is the fallback, with a time limit, and the toast reports what actually happened (as queue.js does).
  function legacyCopy(s) {
    try {
      var ta = D.createElement("textarea"); ta.value = s; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
      D.body.appendChild(ta); ta.select(); var ok = D.execCommand && D.execCommand("copy"); D.body.removeChild(ta); return !!ok;
    } catch (e) { return false; }
  }
  function copyText(text) {
    if (legacyCopy(text)) { toast("Copied to the clipboard."); return; }
    var settled = false, finish = function (ok) { if (settled) return; settled = true; toast(ok ? "Copied to the clipboard." : "Could not copy. " + text); };
    try {
      if (G.navigator && G.navigator.clipboard && G.navigator.clipboard.writeText) {
        G.navigator.clipboard.writeText(text).then(function () { finish(true); }, function () { finish(false); });
        setTimeout(function () { finish(false); }, 1500); return;
      }
    } catch (e) {}
    finish(false);
  }
  function toast(m) { try { (G.toast || G.SMD_toast) && (G.toast || G.SMD_toast)(m); } catch (e) {} }

  /* ======================================= rendering ======================================= */
  function reviewNote(kit, host) {
    var st = (kit.review && kit.review.status) || "ai_drafted";
    if (st === "approved" || st === "reviewed") return '<div class="kit-status ok" role="note">' + ms("verified") + "<span><strong>Clinically " + (st === "approved" ? "approved" : "reviewed") + "</strong>" + (kit.review.reviewer ? " by " + esc(kit.review.reviewer) : "") + ".</span></div>";
    return '<div class="kit-status" role="note">' + ms("info") + "<span><strong>Draft kit, pending clinical review.</strong> " +
      (host && host.kind === "opd" ? "It only adds text you can edit; nothing is saved until you save the assessment." : "It only prepares text for you to copy and check; nothing is saved.") + "</span></div>";
  }
  function fieldHtml(f, v, scope) {
    var id = "kit_" + scope + "_" + f.id, name = scope + ":" + f.id, val = v == null ? "" : v;
    var lab = '<span class="kit-fl">' + esc(f.label) + (f.unit ? ' <small>' + esc(f.unit) + "</small>" : "") + "</span>";
    // A short hint is the placeholder of a text input; a long one (clipped in a half-width field) and any
    // hint on a select or checkbox, which have no placeholder, go below the field.
    var below = f.hint && (f.type === "select" || f.type === "check" || f.hint.length > 28);
    var hint = below ? '<small class="kit-hint">' + esc(f.hint) + "</small>" : "", ph = below ? "" : esc(f.hint || "");
    if (f.type === "check") return '<label class="kit-check"><input type="checkbox" data-kit-f="' + name + '"' + (val ? " checked" : "") + "><span>" + esc(f.label) + hint + "</span></label>";
    if (f.type === "select") return '<label class="kit-field" for="' + id + '">' + lab + '<select id="' + id + '" class="kit-inp" data-kit-f="' + name + '"><option value=""></option>' +
      (f.opts || []).map(function (o, oi) { return '<option value="' + esc(o) + '"' + (String(o) === String(val) ? " selected" : "") + ">" + esc(f.optLabels ? f.optLabels[oi] : o) + "</option>"; }).join("") + "</select>" + hint + "</label>";
    if (f.type === "textarea") return micWrap(f, name, '<label class="kit-field wide" for="' + id + '">' + lab + '<textarea id="' + id + '" rows="2" class="kit-inp" data-kit-f="' + name + '" placeholder="' + ph + '">' + esc(val) + "</textarea>" + hint + "</label>", true);
    var type = f.type === "number" ? 'type="number" inputmode="decimal" step="any"' : f.type === "date" ? 'type="date"' : f.type === "datetime" ? 'type="datetime-local"' : 'type="text"';
    var html = '<label class="kit-field" for="' + id + '">' + lab + "<input " + type + ' id="' + id + '" class="kit-inp" data-kit-f="' + name + '" value="' + esc(val) + '" placeholder="' + ph + '">' + hint + "</label>";
    return f.type === "text" ? micWrap(f, name, html, false) : html;
  }
  // E5: a mic beside free-text kit fields, on the app's on-device voice engine (SMD_VOICE, no cloud).
  function voiceOK() { try { return !!(G.SMD_VOICE && G.SMD_VOICE.listen); } catch (e) { return false; } }
  function micWrap(f, name, html, wide) {
    if (!voiceOK()) return html;
    return '<div class="kit-micwrap' + (wide ? " wide" : "") + '">' + html + '<button type="button" class="kit-mic' + (MIC.name === name ? " on" : "") + '" data-kit-act="mic:' + esc(name) + '" aria-label="Dictate ' + esc(f.label) + '" aria-pressed="' + (MIC.name === name) + '">' + ms(MIC.name === name ? "stop_circle" : "mic") + "</button></div>";
  }
  var MIC = { name: "", session: null };
  function micStop() { if (MIC.session) { try { MIC.session.stop(); } catch (e) {} } MIC.session = null; var n = MIC.name; MIC.name = ""; micUI(n, false); }
  function micUI(name, on) {
    if (!D || !name) return;
    Array.prototype.forEach.call(D.querySelectorAll('[data-kit-act="mic:' + name + '"]'), function (b) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.innerHTML = ms(on ? "stop_circle" : "mic"); });
  }
  function micPut(root, name, text) {
    var el = root && root.querySelector('[data-kit-f="' + name + '"]'); if (!el || !text) return;
    var cur = String(el.value || "").trim(); el.value = cur ? cur + (el.tagName === "TEXTAREA" ? "\n" : "; ") + text : text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function micStart(btn, name, host) {
    if (MIC.name === name) { micStop(); return; }
    micStop();
    if (host.canDictate && !host.canDictate()) { toast("Stop MaiK Scribe first to dictate a single field."); return; }
    var root = btn.closest("[data-kit-root]"); MIC.name = name; micUI(name, true);
    toast("Listening. Tap the mic again when you finish.");
    var done = function (t) {
      var s = String(t || "").trim(); micStop(); if (!s) { toast("Nothing was heard. Try again, closer to the mic."); return; }
      if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(s) && G.SMD_AI && G.SMD_AI.translate) {     // the record is in English
        G.SMD_AI.translate(s).then(function (r) { micPut(root, name, (r && r.text && !r.error) ? r.text : s); }, function () { micPut(root, name, s); });
      } else micPut(root, name, s);
    };
    MIC.session = G.SMD_VOICE.listen({ noCloud: true, onFinal: done, onError: function () { micStop(); toast("Dictation stopped. Try again, or type it."); } });
    if (!MIC.session) { micStop(); toast("On-device voice could not start. Type it instead."); }
  }
  function addBtn(act, host, label) {
    var dis = !host.canWrite() || !host.ready();
    return '<button type="button" class="kit-add" data-kit-act="' + act + '"' + (dis ? " disabled" : "") + ">" + ms(host.kind === "opd" ? "playlist_add" : "content_copy") + esc(label || host.addLabel()) + "</button>";
  }
  function targetName(host, field) { return host.fieldLabel ? host.fieldLabel(field) : field; }
  function sectionHtml(kit, sec, k, host) {
    var anyCheck = (sec.fields || []).some(function (f) { return f.type === "check" && k.vals[f.id]; });
    return '<section class="kit-card" data-kit-sec="' + esc(sec.id) + '"><h3>' + esc(sec.title) + "</h3>" +
      (sec.alert ? '<div class="kit-alert" data-kit-alert="' + esc(sec.id) + '"' + (anyCheck ? "" : " hidden") + ' role="alert">' + ms("warning") + "<span>" + esc(sec.alert) + "</span></div>" : "") +
      '<div class="kit-grid">' + sec.fields.map(function (f) { return fieldHtml(f, k.vals[f.id], "f"); }).join("") + "</div>" +
      '<div class="kit-row">' + addBtn("sec:" + sec.id, host, host.kind === "opd" ? "Add to " + targetName(host, sec.target) : "Copy") +
      '<button type="button" class="kit-clear" data-kit-act="clr:' + esc(sec.id) + '">Clear</button></div></section>';
  }

  // ---- tools ----
  var TOOLS = {
    "pregnancy-dating": {
      title: "Pregnancy dating", icon: "event", kw: "EDD due date gestational age LMP ultrasound redate ACOG",
      form: function (t) {
        return '<div class="kit-grid">' +
          fieldHtml({ id: "lmp", label: "LMP", type: "date" }, t.lmp, "dating") +
          fieldHtml({ id: "cycle", label: "Cycle length", type: "number", unit: "days", hint: "28" }, t.cycle, "dating") +
          fieldHtml({ id: "usgDate", label: "Earliest scan date", type: "date" }, t.usgDate, "dating") +
          fieldHtml({ id: "usgWeeks", label: "GA at that scan: weeks", type: "number" }, t.usgWeeks, "dating") +
          fieldHtml({ id: "usgDays", label: "and days", type: "number" }, t.usgDays, "dating") +
          fieldHtml({ id: "asOf", label: "As of", type: "date" }, t.asOf || todayISO(), "dating") +
          fieldHtml({ id: "lmpUncertain", label: "LMP uncertain", type: "check" }, t.lmpUncertain, "dating") + "</div>";
      },
      out: function (t) {
        var r = dating(t);
        if (!r.edd) return '<p class="kit-muted">Enter the LMP, the earliest scan, or both.</p>' + notes(r.notes);
        var html = '<div class="kit-result"><div><span>EDD</span><strong>' + esc(fmtDate(r.edd)) + "</strong><small>by " + esc(r.basis) + "</small></div>" +
          (r.ok ? "<div><span>Gestation</span><strong>" + esc(fmtGA(r.ga)) + "</strong><small>" + esc(r.trimester) + "</small></div>" : "") + "</div>";
        if (r.eddLmp && r.eddUsg) html += '<p class="kit-muted">By LMP ' + esc(fmtDate(r.eddLmp)) + ", by scan " + esc(fmtDate(r.eddUsg)) + ".</p>";
        html += notes(r.notes);
        if (r.ok) html += '<ul class="kit-dates">' + r.milestones.map(function (m) { return "<li><span>" + esc(m.label) + "</span><b>" + esc(fmtDate(m.from)) + (m.to ? " to " + esc(fmtDate(m.to)) : "") + "</b></li>"; }).join("") + "</ul>";
        return html;
      },
      text: function (t) {
        var r = dating(t); if (!r.edd) return "";
        var s = "Pregnancy dating: " + (t.lmp ? "LMP " + fmtDate(parseISO(t.lmp)) + "; " : "") + "EDD " + fmtDate(r.edd) + " (by " + r.basis + ")";
        if (r.ok) s += "; gestation " + fmtGA(r.ga) + " on " + fmtDate(parseISO(t.asOf) || parseISO(todayISO()));
        return s + ".";
      },
      target: "History_present_illness",
      sets: function (t) { return t.lmp && parseISO(t.lmp) ? { LMP: fmtDate(parseISO(t.lmp)) } : {}; }
    },
    "growth-who": {
      title: "Growth (WHO z-scores)", icon: "monitoring", kw: "growth chart z score centile weight for age height for age BMI MUAC stunting wasting malnutrition WHO",
      form: function (t) {
        return '<div class="kit-grid">' +
          fieldHtml({ id: "sex", label: "Sex", type: "select", opts: ["Male", "Female"] }, t.sex, "growth") +
          fieldHtml({ id: "dob", label: "Date of birth", type: "date" }, t.dob, "growth") +
          fieldHtml({ id: "asOf", label: "Measured on", type: "date" }, t.asOf || todayISO(), "growth") +
          fieldHtml({ id: "weight", label: "Weight", type: "number", unit: "kg" }, t.weight, "growth") +
          fieldHtml({ id: "lenhei", label: "Length / height", type: "number", unit: "cm" }, t.lenhei, "growth") +
          fieldHtml({ id: "measured", label: "Measured", type: "select", opts: ["Lying (length)", "Standing (height)"] }, t.measured, "growth") +
          fieldHtml({ id: "hc", label: "Head circumference", type: "number", unit: "cm" }, t.hc, "growth") +
          fieldHtml({ id: "muac", label: "MUAC", type: "number", unit: "cm" }, t.muac, "growth") +
          fieldHtml({ id: "oedema", label: "Bilateral pitting oedema", type: "check" }, t.oedema, "growth") + "</div>" +
          (t.hist || []).map(function (h, i) {
            return '<fieldset class="kit-ms"><legend>Earlier measurement ' + (i + 1) + '</legend><div class="kit-grid">' +
              fieldHtml({ id: "h:" + i + ":date", label: "Date", type: "date" }, h.date, "growth") + fieldHtml({ id: "h:" + i + ":weight", label: "Weight", type: "number", unit: "kg" }, h.weight, "growth") +
              fieldHtml({ id: "h:" + i + ":lenhei", label: "Length / height", type: "number", unit: "cm" }, h.lenhei, "growth") + fieldHtml({ id: "h:" + i + ":hc", label: "Head circumference", type: "number", unit: "cm" }, h.hc, "growth") +
              '</div><div class="kit-row"><button type="button" class="kit-clear" data-kit-act="ghrm:' + i + '">Remove</button></div></fieldset>';
          }).join("") + '<div class="kit-row"><button type="button" class="kit-clear" data-kit-act="ghadd">' + ms("add") + "Add an earlier measurement for the chart</button></div>";
      },
      set: function (t, fid, val) { var m = /^h:(\d+):(\w+)$/.exec(fid); if (m) { if (t.hist && t.hist[+m[1]]) t.hist[+m[1]][m[2]] = val; } else t[fid] = val; },
      compute: function (t) {
        if (!GROWTH) return null;
        var dob = parseISO(t.dob), asOf = parseISO(t.asOf) || parseISO(todayISO());
        return growth(GROWTH, { sex: t.sex === "Male" ? 1 : t.sex === "Female" ? 2 : "", ageDays: dob ? dayDiff(dob, asOf) : null,
          weight: t.weight, lenhei: t.lenhei, measured: /Standing/.test(t.measured || "") ? "h" : /Lying/.test(t.measured || "") ? "l" : "", hc: t.hc, muac: t.muac, oedema: t.oedema });
      },
      out: function (t) {
        if (!GROWTH) { loadGrowth().then(refreshAllTools, function () { toast("Growth tables could not be loaded."); }); return '<p class="kit-muted">Loading WHO growth tables…</p>'; }
        var r = TOOLS["growth-who"].compute(t);
        if (!r || !r.rows.length) return notes((r && r.notes) || []) || '<p class="kit-muted">Enter sex, date of birth and at least one measurement.</p>';
        return '<p class="kit-muted">' + esc(r.reference) + ", age " + esc(ageText(r.months)) + (r.bmi ? ", BMI " + esc(r.bmi) : "") + ".</p>" +
          '<table class="kit-table"><thead><tr><th>Indicator</th><th>z</th><th>Centile</th><th>Interpretation</th></tr></thead><tbody>' +
          r.rows.map(function (x) { return '<tr class="' + (x.z < -2 || x.z > 2 ? "kit-abn" : "") + '"><td>' + esc(x.label) + "</td><td>" + esc(x.z.toFixed(2)) + "</td><td>" + esc(x.pct) + "</td><td>" + esc(x.cls) + "</td></tr>"; }).join("") +
          "</tbody></table>" + notes(r.notes) + growthChartBlock(t, r);
      },
      text: function (t) {
        var r = TOOLS["growth-who"].compute(t); if (!r || !r.rows.length) return "";
        return "Growth (" + r.reference + ", age " + ageText(r.months) + "): " + r.rows.map(function (x) { return x.label + " z " + x.z.toFixed(2) + " (" + x.cls + ")"; }).join("; ") +
          (r.sam ? "; meets criteria for severe acute malnutrition" : "") + ".";
      },
      target: "Nutrtion",
      sets: function (t) { var o = {}; if (num(t.weight) != null) o.Weight = String(num(t.weight)); if (num(t.lenhei) != null) o.Height = String(num(t.lenhei)); if (num(t.muac) != null) o.muac_cm = String(num(t.muac)); return o; }
    },
    "milestones": {
      title: "Developmental milestones (CDC 2022)", icon: "child_care", kw: "developmental milestones delay CDC act early",
      form: function (t) {
        var ages = msAges(); if (!ages.length) return '<p class="kit-muted">Milestone data not loaded.</p>';
        var cur = t.age || String(ages[0].months);
        return '<label class="kit-field" for="kit_ms_age"><span class="kit-fl">Checkpoint</span><select id="kit_ms_age" class="kit-inp" data-kit-f="milestones:age">' +
          ages.map(function (a) { return '<option value="' + a.months + '"' + (String(a.months) === cur ? " selected" : "") + ">" + esc(a.label) + "</option>"; }).join("") + "</select></label>";
      },
      out: function (t) {
        var a = msAt(t.age); if (!a) return "";
        var done = t.done || {};
        return a.domains.map(function (d) {
          return '<fieldset class="kit-ms"><legend>' + esc(d.label) + "</legend>" + d.items.map(function (it, i) {
            var key = a.months + ":" + d.id + ":" + i;
            return '<label class="kit-check"><input type="checkbox" data-kit-f="milestones:done:' + esc(key) + '"' + (done[key] ? " checked" : "") + "><span>" + esc(it) + "</span></label>";
          }).join("") + "</fieldset>";
        }).join("") + '<p class="kit-muted">Tick what the child does now. Unticked milestones at this checkpoint, or any lost skill, need developmental assessment (CDC: act early).</p>';
      },
      text: function (t) {
        var a = msAt(t.age); if (!a) return "";
        var done = t.done || {}, yes = [], no = [];
        a.domains.forEach(function (d) { d.items.forEach(function (it, i) { (done[a.months + ":" + d.id + ":" + i] ? yes : no).push(it); }); });
        if (!yes.length && !no.length) return "";
        return "Developmental milestones (" + a.label + " checkpoint, CDC 2022): achieved " + yes.length + " of " + (yes.length + no.length) + (no.length ? "; not yet: " + no.join("; ") : "") + ".";
      },
      target: "History_past_illness"
    },
    "immunisation": {
      title: "Immunisation", icon: "vaccines",
      opdOnly: true,
      form: function () { return '<p class="kit-muted">Record and review doses on the Immunisation tab (India schedule).</p><div class="kit-row"><button type="button" class="kit-add" data-kit-act="imm">' + ms("vaccines") + "Open the Immunisation tab</button></div>"; },
      out: function () { return ""; }
    },
    "visual-acuity": {
      title: "Visual acuity and IOP", icon: "visibility", kw: "visual acuity Snellen logMAR IOP intraocular pressure blindness low vision",
      form: function (t) {
        var sel = function (id, label) { return fieldHtml({ id: id, label: label, type: "select", opts: SNELLEN }, t[id], "vision"); };
        return '<div class="kit-grid">' + sel("re", "Right eye (presenting)") + sel("le", "Left eye (presenting)") + sel("rePh", "Right, pinhole") + sel("lePh", "Left, pinhole") +
          fieldHtml({ id: "reNear", label: "Right near (N)", type: "text", hint: "N6" }, t.reNear, "vision") + fieldHtml({ id: "leNear", label: "Left near (N)", type: "text", hint: "N6" }, t.leNear, "vision") +
          fieldHtml({ id: "reIop", label: "Right IOP", type: "number", unit: "mmHg" }, t.reIop, "vision") + fieldHtml({ id: "leIop", label: "Left IOP", type: "number", unit: "mmHg" }, t.leIop, "vision") +
          fieldHtml({ id: "iopMethod", label: "IOP method", type: "select", opts: ["Goldmann applanation", "Non-contact", "Rebound", "Schiotz"] }, t.iopMethod, "vision") + "</div>";
      },
      out: function (t) {
        var cat = whoVision(t.re, t.le), rows = [];
        [["Right", t.re, t.rePh], ["Left", t.le, t.lePh]].forEach(function (e) { if (e[1]) rows.push("<li><span>" + e[0] + "</span><b>" + esc(e[1]) + (logmar(e[1]) != null ? " (logMAR " + logmar(e[1]).toFixed(2) + ")" : "") + (e[2] ? ", pinhole " + esc(e[2]) : "") + "</b></li>"); });
        var iop = [["Right", num(t.reIop)], ["Left", num(t.leIop)]].filter(function (x) { return x[1] != null; });
        var warn = iop.filter(function (x) { return x[1] > 21; }).map(function (x) { return x[0] + " IOP above 21 mmHg: assess for glaucoma (AAO)."; });
        if (!cat && !iop.length) return '<p class="kit-muted">Record the presenting acuity for each eye.</p>';
        return (rows.length ? '<ul class="kit-dates">' + rows.join("") + "</ul>" : "") + (cat ? '<p class="kit-strong">' + esc(cat) + " (WHO ICD-11)</p>" : "") + notes(warn);
      },
      text: function (t) {
        var parts = [];
        if (t.re || t.le) parts.push("VA presenting RE " + (t.re || "not recorded") + ", LE " + (t.le || "not recorded") + (t.rePh || t.lePh ? "; pinhole RE " + (t.rePh || "-") + ", LE " + (t.lePh || "-") : ""));
        if (t.reNear || t.leNear) parts.push("near RE " + (t.reNear || "-") + ", LE " + (t.leNear || "-"));
        if (num(t.reIop) != null || num(t.leIop) != null) parts.push("IOP RE " + (num(t.reIop) != null ? num(t.reIop) : "-") + ", LE " + (num(t.leIop) != null ? num(t.leIop) : "-") + " mmHg" + (t.iopMethod ? " (" + t.iopMethod + ")" : ""));
        var cat = whoVision(t.re, t.le); if (cat) parts.push(cat);
        return parts.length ? "Visual acuity: " + parts.join("; ") + "." : "";
      },
      target: "local_examination"
    },
    "hearing": {
      title: "Hearing (tuning forks and audiometry)", icon: "hearing", kw: "hearing loss Rinne Weber audiometry deafness grade",
      form: function (t) {
        var rin = ["Positive", "Negative"];
        return '<div class="kit-grid">' +
          fieldHtml({ id: "rinneR", label: "Rinne, right", type: "select", opts: rin }, t.rinneR, "hearing") + fieldHtml({ id: "rinneL", label: "Rinne, left", type: "select", opts: rin }, t.rinneL, "hearing") +
          fieldHtml({ id: "weber", label: "Weber lateralises to", type: "select", opts: ["Central", "Right", "Left"] }, t.weber, "hearing") +
          fieldHtml({ id: "ptaR", label: "PTA right (0.5 to 4 kHz)", type: "number", unit: "dB HL" }, t.ptaR, "hearing") + fieldHtml({ id: "ptaL", label: "PTA left", type: "number", unit: "dB HL" }, t.ptaL, "hearing") + "</div>";
      },
      out: function (t) {
        var tf = tuningFork(t.weber, t.rinneR, t.rinneL), r = num(t.ptaR), l = num(t.ptaL), g = null;
        if (r != null && l != null) g = whoHearing(Math.min(r, l), Math.max(r, l)); else if (r != null || l != null) g = whoHearing(r != null ? r : l, null);
        if (!tf && !g) return '<p class="kit-muted">Enter the tuning-fork results or the pure-tone averages.</p>';
        return (tf ? '<p class="kit-strong">' + esc(tf) + "</p>" : "") + (g ? '<p class="kit-strong">' + esc(g) + "</p>" : "");
      },
      text: function (t) {
        var parts = [];
        if (t.rinneR || t.rinneL || t.weber) parts.push("Rinne R " + (t.rinneR || "-") + ", L " + (t.rinneL || "-") + "; Weber " + (t.weber || "-"));
        var tf = tuningFork(t.weber, t.rinneR, t.rinneL); if (tf) parts.push(tf.replace(/\.$/, ""));
        var r = num(t.ptaR), l = num(t.ptaL);
        if (r != null || l != null) parts.push("PTA R " + (r != null ? r : "-") + ", L " + (l != null ? l : "-") + " dB HL");
        if (r != null && l != null) parts.push(whoHearing(Math.min(r, l), Math.max(r, l)));
        return parts.length ? "Hearing: " + parts.join("; ") + "." : "";
      },
      target: "ENT_exam"
    },
    "odontogram": {
      title: "Dental chart (FDI) and DMFT", icon: "dentistry", kw: "dental chart odontogram DMFT caries teeth FDI",
      form: function (t) {
        var prim = !!t.primary, chart = t.chart || {}, teeth = prim ? PRIMARY : PERMANENT, q = teeth.length / 4;
        var cell = function (n) { var c = chart[n] || ""; return '<button type="button" class="kit-tooth' + (c ? " s-" + c : "") + '" data-kit-act="tooth:' + n + '" aria-label="Tooth ' + n + ": " + esc(toothLabel(c)) + '"><small>' + n + "</small><b>" + esc(c || "") + "</b></button>"; };
        // Chart order as the dentist faces the patient: patient's right on the left (18 to 11 | 21 to 28).
        var jaw = function (label, from) {
          return '<p class="kit-jaw-label">' + label + '</p><div class="kit-jaw" role="group" aria-label="' + label + '">' +
            '<div class="kit-quad" style="--q:' + q + '">' + teeth.slice(from, from + q).map(cell).join("") + "</div>" +
            '<div class="kit-quad" style="--q:' + q + '">' + teeth.slice(from + q, from + 2 * q).map(cell).join("") + "</div></div>";
        };
        return '<div class="kit-row"><button type="button" class="kit-seg' + (prim ? "" : " on") + '" data-kit-act="dent:perm" aria-pressed="' + !prim + '">Permanent</button><button type="button" class="kit-seg' + (prim ? " on" : "") + '" data-kit-act="dent:prim" aria-pressed="' + prim + '">Primary</button></div>' +
          jaw("Upper jaw", 0) + jaw("Lower jaw", 2 * q) +
          '<p class="kit-muted">Tap a tooth to cycle: ' + TOOTH.slice(1).map(function (x) { return x[0] + " " + x[1].toLowerCase(); }).join(", ") + ".</p>";
      },
      out: function (t) {
        var r = dmft(t.chart || {}, !!t.primary);
        return '<p class="kit-strong">' + (t.primary ? "dmft " : "DMFT ") + r.total + " (" + (t.primary ? "d " : "D ") + r.d + ", " + (t.primary ? "m " : "M ") + r.m + ", " + (t.primary ? "f " : "F ") + r.f + ")</p>";
      },
      text: function (t) {
        var chart = t.chart || {}, teeth = t.primary ? PRIMARY : PERMANENT, list = [];
        teeth.forEach(function (n) { if (chart[n]) list.push(n + " " + toothLabel(chart[n]).toLowerCase()); });
        if (!list.length) return "";
        var r = dmft(chart, !!t.primary);
        return "Dental chart (FDI): " + list.join(", ") + "; " + (t.primary ? "dmft " : "DMFT ") + r.total + ".";
      },
      target: "teeth_exam"
    },
    "pasi": {
      title: "PASI (psoriasis severity)", icon: "dermatology", kw: "PASI psoriasis area severity index",
      form: function (t) {
        var sc = ["0", "1", "2", "3", "4"];
        return PASI_REGIONS.map(function (r) {
          return '<fieldset class="kit-ms"><legend>' + esc(r[1]) + '</legend><div class="kit-grid">' +
            fieldHtml({ id: r[0] + "_a", label: "Area involved", type: "number", unit: "%" }, t[r[0] + "_a"], "pasi") +
            fieldHtml({ id: r[0] + "_e", label: "Erythema", type: "select", opts: sc }, t[r[0] + "_e"], "pasi") +
            fieldHtml({ id: r[0] + "_i", label: "Induration", type: "select", opts: sc }, t[r[0] + "_i"], "pasi") +
            fieldHtml({ id: r[0] + "_d", label: "Desquamation", type: "select", opts: sc }, t[r[0] + "_d"], "pasi") + "</div></fieldset>";
        }).join("");
      },
      out: function (t) {
        var p = pasi(t); if (p == null) return '<p class="kit-muted">Score each region: severity 0 to 4 and the percentage involved.</p>';
        return '<p class="kit-strong">PASI ' + p.toFixed(1) + " of 72</p>" + (p >= 10 ? notes(["PASI 10 or more: severe by the rule of tens; with DLQI over 10, meets NICE criteria for systemic or biologic assessment."]) : "");
      },
      text: function (t) { var p = pasi(t); return p == null ? "" : "PASI " + p.toFixed(1) + "."; },
      target: "skin"
    }    ,
    "la-dose": {
      title: "Local anaesthetic maximum dose", icon: "vaccines", reform: ["drug"],
      kw: "local anaesthetic anesthetic lignocaine lidocaine bupivacaine ropivacaine prilocaine maximum safe dose toxic LAST",
      form: function (t) {
        var d = DATA("la-doses"); if (!d) return '<p class="kit-muted">Reference data not loaded.</p>';
        var cur = laDrug(t);
        return '<div class="kit-grid">' +
          fieldHtml({ id: "weight", label: "Ideal body weight", type: "number", unit: "kg", hint: "Doses count nobody above 70 kg." }, t.weight, "la") +
          fieldHtml({ id: "drug", label: "Drug", type: "select", opts: d.drugs.map(function (x) { return x.label; }) }, t.drug, "la") +
          fieldHtml({ id: "adr", label: "Preparation", type: "select", opts: cur && cur.withAdrenaline ? ["Plain", "With adrenaline"] : ["Plain"] }, t.adr, "la") +
          fieldHtml({ id: "strength", label: "Strength", type: "select", opts: ((cur && cur.strengths) || []).map(function (x) { return x + "%"; }) }, t.strength, "la") + "</div>";
      },
      out: function (t) {
        var r = laCalc(t), d = DATA("la-doses");
        if (!r) return '<p class="kit-muted">Enter the weight and choose the drug.</p>';
        var basis = (r.p.mgPerKg != null ? r.p.mgPerKg + " mg/kg" : "") + (r.p.maxMg != null ? (r.p.mgPerKg != null ? ", not more than " : "at most ") + r.p.maxMg + " mg" : "");
        return '<div class="kit-result"><div><span>Maximum dose</span><strong>' + esc(r.mg) + ' mg</strong><small>' + esc(r.drug.label + (r.withA ? " with adrenaline" : ", plain")) + "</small></div>" +
          (r.ml != null ? "<div><span>Volume</span><strong>" + esc(r.ml) + " mL</strong><small>of " + esc(r.pct) + "% (" + esc(r.pct * 10) + " mg/mL)</small></div>" : "") + "</div>" +
          '<p class="kit-muted">' + esc(basis) + (r.capped ? ": the weight-based dose is above the ceiling, so the ceiling applies" : "") + (r.wCapped ? ". Worked out for 70 kg, the most the source counts" : "") + ". Source: " + esc(srcName(d)) + ".</p>" + notes(d.notes);
      },
      text: function (t) {
        var r = laCalc(t); if (!r) return "";
        return "Local anaesthetic maximum dose (" + srcName(DATA("la-doses")) + "): " + r.drug.label + (r.withA ? " with adrenaline" : " plain") + ", dosing weight " + r.w + " kg" + (r.wCapped ? " (capped at 70)" : "") + ": " + r.mg + " mg" +
          (r.ml != null ? " = " + r.ml + " mL of " + r.pct + "%" : "") + ".";
      },
      target: "management_plan"
    },
    "burns-chart": {
      title: "Burns area (Lund and Browder)", icon: "local_fire_department", reform: ["age"],
      kw: "burns burn tbsa lund browder parkland fluid resuscitation child",
      form: function (t) {
        var d = DATA("lund-browder"); if (!d) return '<p class="kit-muted">Reference data not loaded.</p>';
        var ai = burnsAge(t, d), fr = ["1/4", "1/2", "3/4", "All"];
        return '<div class="kit-grid">' + fieldHtml({ id: "age", label: "Age column", type: "select", opts: d.ages.map(burnsAgeLabel) }, t.age, "burns") +
          fieldHtml({ id: "weight", label: "Weight", type: "number", unit: "kg" }, t.weight, "burns") + "</div>" +
          '<p class="kit-muted">For each region, how much has partial or full thickness burn (not simple redness).</p><div class="kit-grid">' +
          d.regions.map(function (r) { return fieldHtml({ id: "r_" + r.id, label: r.label + (ai >= 0 ? " (" + r.percent[ai] + "%)" : ""), type: "select", opts: fr }, t["r_" + r.id], "burns"); }).join("") + "</div>";
      },
      out: function (t) {
        var r = burnsCalc(t); if (!r) return '<p class="kit-muted">Choose the age column, then mark the burnt regions.</p>';
        return '<div class="kit-result"><div><span>Total burn area</span><strong>' + esc(r.tbsa) + '% TBSA</strong><small>Lund and Browder, ' + esc(r.ageLabel) + "</small></div>" +
          (r.parkland != null ? "<div><span>Parkland estimate</span><strong>" + esc(r.parkland) + " mL / 24 h</strong><small>" + esc(r.first8) + " mL in the first 8 h from the time of burn</small></div>" : "") + "</div>" +
          notes(["Parkland: 4 mL x kg x % TBSA of crystalloid over 24 hours, half in the first 8 hours from the time of the burn, then titrate to urine output. Check the burns unit's protocol for children and for maintenance fluid."]);
      },
      text: function (t) {
        var r = burnsCalc(t); if (!r) return "";
        return "Burns (Lund and Browder, " + r.ageLabel + "): " + r.tbsa + "% TBSA partial and full thickness" + (r.parts.length ? " (" + r.parts.join(", ") + ")" : "") +
          (r.parkland != null ? "; Parkland estimate " + r.parkland + " mL over 24 h, " + r.first8 + " mL in the first 8 h from the time of burn" : "") + ".";
      },
      target: "local_examination"
    },
    "ckd-grid": {
      title: "CKD stage (KDIGO)", icon: "grid_view",
      kw: "ckd chronic kidney disease stage kdigo egfr ckd-epi albuminuria acr heat map",
      form: function (t) {
        return '<div class="kit-grid">' +
          fieldHtml({ id: "egfr", label: "eGFR, if known", type: "number", unit: "mL/min/1.73 m2" }, t.egfr, "ckd") +
          fieldHtml({ id: "scr", label: "or serum creatinine", type: "number", unit: "mg/dL" }, t.scr, "ckd") +
          fieldHtml({ id: "age", label: "Age", type: "number", unit: "years" }, t.age, "ckd") +
          fieldHtml({ id: "sex", label: "Sex", type: "select", opts: ["Male", "Female"] }, t.sex, "ckd") +
          fieldHtml({ id: "acr", label: "Urine albumin-creatinine ratio", type: "number" }, t.acr, "ckd") +
          fieldHtml({ id: "acrUnit", label: "ACR unit", type: "select", opts: ["mg/g", "mg/mmol"] }, t.acrUnit, "ckd") + "</div>";
      },
      out: function (t) {
        var r = ckdCalc(t); if (!r) return '<p class="kit-muted">Enter the eGFR (or creatinine with age and sex) and, if known, the ACR.</p>';
        var G = ["G1", "G2", "G3a", "G3b", "G4", "G5"], A = ["A1", "A2", "A3"];
        var html = '<div class="kit-tablewrap"><table class="kit-table kit-ckd"><thead><tr><th>eGFR</th>' + A.map(function (a) { return "<th>" + a + "</th>"; }).join("") + "</tr></thead><tbody>" +
          G.map(function (g, gi) {
            return "<tr><th>" + g + "</th>" + A.map(function (a, ai) {
              var risk = CKD_RISK[gi][ai], on = r.g === g && r.a === a;
              return '<td class="kit-r' + risk + (on ? " kit-here" : "") + '">' + (on ? "Here" : "") + "</td>";
            }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
        return '<div class="kit-result"><div><span>Stage</span><strong>' + esc(r.g + (r.a ? " " + r.a : "")) + "</strong><small>eGFR " + esc(r.egfr) + (r.computed ? " (CKD-EPI 2021)" : "") + (r.a ? ", ACR " + esc(r.acrText) : "") + "</small></div>" +
          (r.a ? "<div><span>Risk</span><strong>" + esc(RISK_LABEL[r.risk]) + "</strong><small>KDIGO heat map</small></div>" : "") + "</div>" +
          (r.a ? html : "") + notes(["CKD needs abnormal kidney markers or eGFR below 60 for more than 3 months: confirm with repeat tests before labelling.", "Legend: green low, yellow moderately increased, orange high, red very high risk."]);
      },
      text: function (t) {
        var r = ckdCalc(t); if (!r) return "";
        return "CKD staging (KDIGO): eGFR " + r.egfr + " mL/min/1.73 m2" + (r.computed ? " (CKD-EPI 2021)" : "") + " (" + r.g + ")" + (r.a ? ", ACR " + r.acrText + " (" + r.a + "): " + RISK_LABEL[r.risk].toLowerCase() + " risk" : "") + ".";
      },
      target: "Renal_details"
    },
    "joint-chart": {
      title: "28-joint count (DAS28, CDAI, SDAI)", icon: "back_hand",
      kw: "das28 cdai sdai 28 joint count tender swollen rheumatoid arthritis disease activity",
      form: function (t) {
        var j = t.j || {};
        var cell = function (side, jt) {
          var key = side + ":" + jt[0], c = j[key] || "";
          return '<td><button type="button" class="kit-joint' + (c ? " s-" + c : "") + '" data-kit-act="joint:' + key + '" aria-label="' + esc((side === "R" ? "Right " : "Left ") + jt[1] + ": " + JOINT_STATE[c]) + '">' + esc(c === "TS" ? "T+S" : c || " ") + "</button></td>";
        };
        return '<div class="kit-tablewrap"><table class="kit-table kit-joints"><thead><tr><th>Joint</th><th>Right</th><th>Left</th></tr></thead><tbody>' +
          JOINTS.map(function (jt) { return "<tr><th>" + esc(jt[1]) + "</th>" + cell("R", jt) + cell("L", jt) + "</tr>"; }).join("") + "</tbody></table></div>" +
          '<p class="kit-muted">Tap a joint to cycle: tender (T), swollen (S), both, none.</p><div class="kit-grid">' +
          fieldHtml({ id: "esr", label: "ESR", type: "number", unit: "mm/h" }, t.esr, "joints") +
          fieldHtml({ id: "crp", label: "CRP", type: "number", unit: "mg/L" }, t.crp, "joints") +
          fieldHtml({ id: "ptga", label: "Patient global", type: "number", unit: "0 to 100 mm" }, t.ptga, "joints") +
          fieldHtml({ id: "evga", label: "Evaluator global", type: "number", unit: "0 to 10" }, t.evga, "joints") + "</div>";
      },
      out: function (t) {
        var r = jointCalc(t);
        var rows = [["DAS28-ESR", r.das28esr, DAS_BANDS], ["DAS28-CRP", r.das28crp, DAS_BANDS], ["CDAI", r.cdai, CDAI_BANDS], ["SDAI", r.sdai, SDAI_BANDS]].filter(function (x) { return x[1] != null; });
        return '<p class="kit-strong">Tender ' + r.tjc + ", swollen " + r.sjc + " of 28</p>" + (rows.length ? '<table class="kit-table"><thead><tr><th>Score</th><th>Value</th><th>Activity</th></tr></thead><tbody>' +
          rows.map(function (x) { return "<tr><td>" + x[0] + "</td><td>" + esc(x[1]) + "</td><td>" + esc(activity(x[1], x[2])) + "</td></tr>"; }).join("") + "</tbody></table>" : '<p class="kit-muted">Add ESR or CRP and the global assessments for the scores.</p>');
      },
      text: function (t) {
        var r = jointCalc(t); if (!r.tjc && !r.sjc && r.das28esr == null && r.cdai == null) return "";
        var parts = ["tender " + r.tjc + (r.tender.length ? " (" + r.tender.join(", ") + ")" : ""), "swollen " + r.sjc + (r.swollen.length ? " (" + r.swollen.join(", ") + ")" : "")];
        [["DAS28-ESR", r.das28esr, DAS_BANDS], ["DAS28-CRP", r.das28crp, DAS_BANDS], ["CDAI", r.cdai, CDAI_BANDS], ["SDAI", r.sdai, SDAI_BANDS]].forEach(function (x) { if (x[1] != null) parts.push(x[0] + " " + x[1] + " (" + activity(x[1], x[2]).toLowerCase() + ")"); });
        return "28-joint count: " + parts.join("; ") + ".";
      },
      target: "musculo_skeletal_system"
    },
    "body-chart": {
      title: "Injury body chart", icon: "accessibility",
      kw: "injury chart body diagram mlc medico legal wound abrasion laceration contusion",
      set: function (t, fid, val) { var m = /^inj:(\d+):(\w+)$/.exec(fid); if (m && t.inj && t.inj[+m[1]]) t.inj[+m[1]][m[2]] = val; },
      form: function (t) {
        var inj = t.inj || [], marks = {};
        inj.forEach(function (x, i) { (marks[x.r] = marks[x.r] || []).push(i + 1); });
        var shape = function (r) {
          var c = r[3], m = marks[r[0]], cls = "kit-bz" + (m ? " on" : ""), a = 'data-kit-act="bodyreg:' + r[0] + '" role="button" tabindex="0" aria-label="' + esc(r[1] + (m ? ", injuries " + m.join(", ") : "")) + '"';
          var el = c[0] === "e" ? '<ellipse class="' + cls + '" ' + a + ' cx="' + c[1] + '" cy="' + c[2] + '" rx="' + c[3] + '" ry="' + c[4] + '"><title>' + esc(r[1]) + "</title></ellipse>"
            : '<rect class="' + cls + '" ' + a + ' x="' + c[1] + '" y="' + c[2] + '" width="' + c[3] + '" height="' + c[4] + '" rx="4"><title>' + esc(r[1]) + "</title></rect>";
          var cx = c[0] === "e" ? c[1] : c[1] + c[3] / 2, cy = c[0] === "e" ? c[2] : c[2] + c[4] / 2;
          return el + (m ? '<text class="kit-bzn" x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle">' + m.join(",") + "</text>" : "");
        };
        return '<p class="kit-muted">Tap the region of each injury. Front view on the left, back view on the right; the patient\'s right is marked R.</p>' +
          '<svg class="kit-body" viewBox="0 0 270 290" role="group" aria-label="Body chart">' +
          '<text class="kit-bzl" x="60" y="286" text-anchor="middle">Front</text><text class="kit-bzl" x="200" y="286" text-anchor="middle">Back</text>' +
          '<text class="kit-bzl" x="8" y="60">R</text><text class="kit-bzl" x="104" y="60">L</text><text class="kit-bzl" x="148" y="60">L</text><text class="kit-bzl" x="246" y="60">R</text>' +
          BODY.map(shape).join("") + "</svg>" +
          inj.map(function (x, i) {
            return '<fieldset class="kit-ms"><legend>Injury ' + (i + 1) + ": " + esc(regionName(x.r)) + '</legend><div class="kit-grid">' +
              fieldHtml({ id: "inj:" + i + ":type", label: "Type", type: "select", opts: INJURY_TYPES }, x.type, "body") +
              fieldHtml({ id: "inj:" + i + ":size", label: "Size", type: "text", hint: "e.g. 4 x 1 cm" }, x.size, "body") +
              fieldHtml({ id: "inj:" + i + ":desc", label: "Description", type: "textarea", hint: "shape, margins, colour, depth, direction, surroundings" }, x.desc, "body") +
              '</div><div class="kit-row"><button type="button" class="kit-clear" data-kit-act="bodyrm:' + i + '">Remove injury ' + (i + 1) + "</button></div></fieldset>";
          }).join("");
      },
      out: function (t) {
        var n = (t.inj || []).length;
        return n ? '<p class="kit-strong">' + n + " injur" + (n > 1 ? "ies" : "y") + " charted</p>" + notes(["Describe what you see. The chart records findings only; any opinion on the nature or cause of an injury is yours to write."]) : '<p class="kit-muted">No injuries charted yet.</p>';
      },
      text: function (t) {
        var list = (t.inj || []).map(function (x, i) { return (i + 1) + ". " + [x.type || "Injury", x.size, regionName(x.r)].filter(Boolean).join(", ") + (x.desc ? ": " + String(x.desc).trim() : ""); });
        return list.length ? "Injuries (body chart): " + list.join("; ") + "." : "";
      },
      target: "local_examination"
    },
    "mccd": {
      title: "Cause of death (MCCD Form 4)", icon: "description",
      kw: "mccd death certificate cause of death form 4 underlying cause icd",
      form: function (t) {
        var d = DATA("mccd"); if (!d) return '<p class="kit-muted">Reference data not loaded.</p>';
        var labels = d.partI || [];
        return '<p class="kit-muted">Part I: one condition per line, the immediate cause on line (a), the underlying cause on the lowest line used. Part II: other significant conditions.</p>' +
          labels.map(function (lab, i) {
            return '<div class="kit-grid">' + fieldHtml({ id: "c" + i, label: lab, type: "text" }, t["c" + i], "mccd") +
              fieldHtml({ id: "i" + i, label: "Interval from onset to death", type: "text", hint: "e.g. 2 days" }, t["i" + i], "mccd") + "</div>";
          }).join("") + '<div class="kit-grid">' +
          fieldHtml({ id: "p2", label: "Part II: other significant conditions", type: "textarea" }, t.p2, "mccd") +
          fieldHtml({ id: "manner", label: "Manner of death", type: "select", opts: d.manner || [] }, t.manner, "mccd") +
          ((d.maternal || []).length ? fieldHtml({ id: "maternal", label: "If a woman: pregnancy", type: "select", opts: d.maternal }, t.maternal, "mccd") : "") + "</div>" +
          '<div class="kit-row"><button type="button" class="kit-pill" data-kit-act="icd">' + ms("search") + "Look up ICD codes</button></div>";
      },
      out: function (t) {
        var r = mccdCheck(t), d = DATA("mccd") || {};
        if (!r.lines.length) return '<p class="kit-muted">Start with line (a), the disease or condition directly leading to death.</p>' + notes(d.tips);
        return '<p class="kit-strong">Underlying cause: ' + esc(r.underlying) + "</p>" + notes(r.warnings) + (r.warnings.length ? "" : notes(d.tips));
      },
      text: function (t) {
        var r = mccdCheck(t), d = DATA("mccd") || {}; if (!r.lines.length) return "";
        var s = "MCCD (Form 4) draft: Part I " + r.lines.map(function (x) { return "(" + "abcd".charAt(x.i) + ") " + x.c + (x.iv ? " (" + x.iv + ")" : ""); }).join("; ");
        if (t.p2 && String(t.p2).trim()) s += "; Part II " + String(t.p2).trim();
        if (t.manner) s += "; manner: " + t.manner;
        if (t.maternal) s += "; pregnancy: " + t.maternal;
        return s + ".";
      },
      target: "management_plan"
    },
    "labour-care": {
      title: "WHO Labour Care Guide", icon: "monitor_heart",
      kw: "labour care guide lcg partograph active labour fetal heart cervix alert",
      set: function (t, fid, val) {
        var m = /^e:(\d+):(\w+)$/.exec(fid), b = /^b:(\w+)$/.exec(fid);
        if (b) { t.b = t.b || {}; t.b[b[1]] = val; return; }
        if (m && t.e && t.e[+m[1]]) { var e = t.e[+m[1]]; if (m[2] === "at") e.at = val; else if (m[2] === "ss") e.ss = !!val; else { e.v = e.v || {}; e.v[m[2]] = val; } }
      },
      form: function (t) {
        var d = DATA("lcg"); if (!d) return '<p class="kit-muted">Reference data not loaded.</p>';
        var b = t.b || {}, e = t.e || [], cur = t.cur != null && e[t.cur] ? t.cur : e.length - 1;
        var base = '<div class="kit-grid">' + d.baseline.map(function (f) { return lcgField(f, b[f.id], "b:" + f.id); }).join("") + "</div>";
        var edit = "";
        if (cur >= 0) {
          var en = e[cur];
          edit = '<fieldset class="kit-ms"><legend>Observations at ' + esc(lcgTime(en.at)) + '</legend><div class="kit-grid">' +
            lcgField({ id: "at", label: "Time", type: "datetime" }, en.at, "e:" + cur + ":at") +
            lcgField({ id: "ss", label: "Second stage (pushing) began at this time", type: "check" }, en.ss, "e:" + cur + ":ss") + "</div>" +
            d.sections.map(function (s) {
              return "<h4 class=\"kit-lcg-h\">" + esc(s.label) + '</h4><div class="kit-grid">' + s.rows.map(function (r) { return lcgField(r, (en.v || {})[r.id], "e:" + cur + ":" + r.id); }).join("") + "</div>";
            }).join("") + '<div class="kit-row"><button type="button" class="kit-clear" data-kit-act="lcgdel:' + cur + '">Delete this time point</button></div></fieldset>';
        }
        return '<p class="kit-muted">Start at active first stage (cervix 5 cm or more). Add a time point for each set of observations; alert values are highlighted.</p>' + base +
          '<div class="kit-row"><button type="button" class="kit-add" data-kit-act="lcgadd">' + ms("more_time") + "Add time point</button></div>" + edit;
      },
      out: function (t) {
        var d = DATA("lcg"); if (!d) return "";
        var e = lcgSorted(t);
        if (!e.length) return '<p class="kit-muted">No observations yet.</p>' + notes(d.notes);
        var cur = t.cur != null && t.e[t.cur] ? t.cur : t.e.length - 1;
        var head = "<tr><th>Time</th>" + e.map(function (x) { return '<th><button type="button" class="kit-lcg-t' + (x.i === cur ? " on" : "") + '" data-kit-act="lcgsel:' + x.i + '">' + esc(lcgTime(x.at, true)) + "</button></th>"; }).join("") + "</tr>";
        var body = d.sections.map(function (s) {
          return '<tr class="kit-lcg-sec"><th colspan="' + (e.length + 1) + '">' + esc(s.label) + "</th></tr>" + s.rows.map(function (r) {
            return "<tr><th>" + esc(r.label) + "</th>" + e.map(function (x) {
              var v = (x.v || {})[r.id], a = lcgAlert(r, v);
              return '<td class="' + (a ? "kit-alertcell" : "") + '">' + esc(v == null ? "" : v) + "</td>";
            }).join("") + "</tr>";
          }).join("");
        }).join("");
        var al = lcgAlerts(t);
        return (al.length ? '<div class="kit-alert" role="alert">' + ms("warning") + "<span><b>" + al.length + " alert" + (al.length > 1 ? "s" : "") + ":</b> " + esc(al.join("; ")) + ". Reassess and record the plan (shared decision-making).</span></div>" : "") +
          '<div class="kit-tablewrap"><table class="kit-table kit-lcg"><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" + notes(d.notes);
      },
      text: function (t) {
        var d = DATA("lcg"), e = lcgSorted(t); if (!d || !e.length) return "";
        var b = t.b || {}, last = e[e.length - 1], lv = last.v || {}, show = [];
        [["cervix", " cm"], ["fhr", " bpm"], ["contractions", " per 10 min"], ["sbp", ""], ["pulse", " bpm"]].forEach(function (k) { if (lv[k[0]] != null && lv[k[0]] !== "") show.push(lcgLabel(d, k[0]).toLowerCase() + " " + lv[k[0]] + k[1]); });
        var al = lcgAlerts(t);
        return "Labour care (WHO LCG): " + (b.activeLabour ? "active labour from " + lcgTime(b.activeLabour) + "; " : "") + (b.parity !== undefined && b.parity !== "" ? "parity " + b.parity + "; " : "") +
          e.length + " time points, last " + lcgTime(last.at) + (show.length ? ": " + show.join(", ") : "") + (al.length ? "; alerts: " + al.join("; ") : "; no alerts") + ".";
      },
      target: "History_present_illness"
    }
  };
  function growthChartBlock(t, r) {
    var keys = chartKeysFor(r.months), key = keys.indexOf(t.chart) >= 0 ? t.chart : keys[0];
    var c = growthChart(GROWTH, t, key); if (!c) return "";
    return '<div class="kit-row kit-gc-pick" role="group" aria-label="Chart">' + keys.map(function (k) {
      return '<button type="button" class="kit-seg' + (k === key ? " on" : "") + '" data-kit-act="gchart:' + k + '" aria-pressed="' + (k === key) + '">' + esc(CHARTS[k][0].replace("-for-", " for ")) + "</button>";
    }).join("") + "</div>" + growthChartSvg(c) +
      (c.points.length ? '<table class="kit-table"><thead><tr><th>Date</th><th>' + esc(CHARTS[key][0].split("-for-")[0]) + "</th></tr></thead><tbody>" + c.points.map(function (p) { var s = p.label.split(": "); return "<tr><td>" + esc(s[0]) + "</td><td>" + esc(s.slice(1).join(": ")) + "</td></tr>"; }).join("") + "</tbody></table>" : "");
  }
  function notes(list) { return (list && list.length) ? '<ul class="kit-notes">' + list.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : ""; }
  function ageText(months) { var y = Math.floor(months / 12), m = Math.floor(months - y * 12); return (y ? y + " y " : "") + m + " m"; }
  function msAges() { return (BUNDLE && BUNDLE.data && BUNDLE.data.milestones && BUNDLE.data.milestones.ages) || []; }
  function msAt(age) { var a = msAges(); if (!a.length) return null; var m = a.filter(function (x) { return String(x.months) === String(age); })[0]; return m || a[0]; }

  function toolHtml(id, k, host) {
    var T = TOOLS[id]; if (!T) return "";
    if (T.opdOnly && host.kind !== "opd") return "";
    var t = toolState(k, id);
    if (id === "growth-who" && !t.sex && host.patient) {       // the OPD knows the patient's sex; age/DOB it does not
      var ps = String((host.patient() || {}).sex || "");
      if (/^m/i.test(ps)) t.sex = "Male"; else if (/^f/i.test(ps)) t.sex = "Female";
    }
    return '<section class="kit-card kit-tool" data-kit-tool="' + id + '"><h3>' + ms(T.icon) + esc(T.title) + "</h3>" + T.form(t) +
      '<div class="kit-out" data-kit-out="' + id + '" aria-live="polite">' + T.out(t) + "</div>" +
      (T.text ? '<div class="kit-row">' + addBtn("tool:" + id, host, host.kind === "opd" ? "Add to " + targetName(host, T.target) : "Copy") + "</div>" : "") + "</section>";
  }

  /** The kit body for a host. ctx: { host, key, defaultKit } */
  function kitBody(ctx) {
    var host = ctx.host, k = ks(ctx.key);
    if (!BUNDLE) {
      loadKits().then(function () { host.repaint(); }, function () { host.repaint(); });
      return '<div class="kit-empty">' + ms("hourglass_top") + "Loading specialty kits…</div>";
    }
    var list = kitList();
    if (!k.kitId) k.kitId = (kitById(ctx.defaultKit) && ctx.defaultKit) || (kitById(mySpecialty()) && mySpecialty()) || (list[0] && list[0].id) || "";
    var kit = kitById(k.kitId);
    var mine = mySpecialty();
    var chips = chipRow(k, mine) + (k.picker ? pickerHtml(k, mine) : "");
    if (!kit) return '<div class="kit" data-kit-root data-kit-key="' + esc(ctx.key) + '" data-kit-host="' + host.kind + '">' + chips + '<div class="kit-empty">No kit selected.</div></div>';
    var blocked = host.kind === "opd" && !host.canWrite() ? '<div class="kit-status">' + ms("lock") + "<span>" + esc(writeNote(host)) + "</span></div>"
      : host.kind === "opd" && !host.ready() ? '<div class="kit-status">' + ms("hourglass_top") + "<span>" + esc(host.readyNote ? host.readyNote() : "Loading the assessment…") + "</span></div>" : "";
    var head = '<div class="kit-head"><div><span class="kit-kicker">Specialty kit</span><h2>' + esc(kit.label) + "</h2></div>" +
      (kit.id === mine ? '<span class="kit-mine">' + ms("star") + "My specialty</span>" : '<button type="button" class="kit-link" data-kit-act="mine:' + esc(kit.id) + '">Set as my specialty</button>') + "</div>";
    var tools = (kit.tools || []).map(function (id) { return toolHtml(id, k, host); }).join("");
    var docs = (G.SMD_DOCS && G.SMD_DOCS.on && G.SMD_DOCS.on()) ? '<button type="button" class="kit-pill kit-docs" data-kit-act="docs">' + ms("description") +
      (host.kind === "opd" ? "Certificate, referral letter, consent form or handout for this patient" : "Certificates, consent forms and handouts") + "</button>" : "";
    var secs = (kit.sections || []).map(function (s) { return sectionHtml(kit, s, k, host); }).join("");
    var osets = (host.queueTests && (kit.orderSets || []).length) ? '<section class="kit-card"><h3>' + ms("playlist_add_check") + "Order sets</h3>" +
      '<p class="kit-muted">Queues the tests on the Investigations tab; you still search and order each one.</p>' +
      kit.orderSets.map(function (o) {
        return '<div class="kit-oset"><div><b>' + esc(o.label) + "</b><p>" + esc(o.tests.join(", ")) + "</p></div>" +
          '<button type="button" class="kit-pill" data-kit-act="oset:' + esc(o.id) + '">' + ms("playlist_add") + "Queue " + o.tests.length + " tests</button></div>";
      }).join("") + "</section>" : "";
    var inv = (host.investigate && (kit.investigations || []).length) ? '<section class="kit-card"><h3>' + ms("biotech") + "Investigations</h3><p class=\"kit-muted\">Opens the investigation search with the test name filled in.</p><div class=\"kit-links\">" +
      kit.investigations.map(function (x, i) { return '<button type="button" class="kit-pill" data-kit-act="inv:' + i + '">' + esc(x.label) + "</button>"; }).join("") + "</div></section>" : "";
    var protos = (kit.protocols || []).length ? '<section class="kit-card"><h3>' + ms("account_tree") + "Protocols</h3><div class=\"kit-links\">" +
      kit.protocols.map(function (id) { return '<button type="button" class="kit-pill" data-kit-act="proto:' + esc(id) + '">' + esc(protoTitle(id)) + "</button>"; }).join("") + "</div></section>" : "";
    var calcs = (host.calculator && (kit.calculators || []).length) ? '<section class="kit-card"><h3>' + ms("calculate") + "Calculators</h3><div class=\"kit-links\">" +
      kit.calculators.map(function (id) { return '<button type="button" class="kit-pill" data-kit-act="calc:' + esc(id) + '">' + esc(calcTitle(id)) + "</button>"; }).join("") + "</div></section>" : "";
    var adv = (kit.advice || []).length ? '<section class="kit-card"><h3>' + ms("record_voice_over") + "Patient advice</h3>" + kit.advice.map(function (a) {
      return '<div class="kit-adv"><b>' + esc(a.title) + "</b><p>" + esc(a.text) + "</p>" + addBtn("adv:" + a.id, host, host.kind === "opd" ? "Add to " + targetName(host, a.target) : "Copy") + "</div>";
    }).join("") + "</section>" : "";
    var src = '<section class="kit-card kit-src"><h3>' + ms("menu_book") + "Sources</h3><ol>" + (kit.sources || []).map(function (s) {
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a><span>" + esc(s.org) + " · " + esc(s.year) + "</span></li>";
    }).join("") + '</ol><p class="kit-muted">Decision support only. The kit adds text for you to check and edit; it never saves, signs or orders anything.</p></section>';
    return '<div class="kit" data-kit-root data-kit-key="' + esc(ctx.key) + '" data-kit-host="' + host.kind + '">' + chips + head + reviewNote(kit, host) + blocked + docs + tools + secs + adv + osets + inv + protos + calcs + src + "</div>";
  }
  // Quick chips: the current kit, my specialty and recent kits (at most 5), then "All kits".
  function chipRow(k, mine) {
    var ids = [k.kitId, mine].concat(recentKits()), seen = {}, quick = [];
    ids.forEach(function (id) { if (id && !seen[id] && kitById(id) && quick.length < 5) { seen[id] = 1; quick.push(kitById(id)); } });
    if (quick.length < 3) kitList().forEach(function (x) { if (!seen[x.id] && quick.length < 3) { seen[x.id] = 1; quick.push(x); } });
    return '<div class="kit-chips" role="group" aria-label="Specialty">' + quick.map(function (x) {
      return '<button type="button" class="kit-chip' + (x.id === k.kitId ? " on" : "") + '" data-kit-act="kit:' + esc(x.id) + '" aria-pressed="' + (x.id === k.kitId) + '">' + esc(x.short) + (x.id === mine ? ' <span class="kit-star" aria-label="my specialty">' + ms("star") + "</span>" : "") + "</button>";
    }).join("") + '<button type="button" class="kit-chip kit-all' + (k.picker ? " on" : "") + '" data-kit-act="picker" aria-expanded="' + !!k.picker + '">' + ms("apps") + "All " + kitList().length + " kits</button></div>";
  }
  function pickerList(k, mine) {
    var q = String(k.pickerQ || "").toLowerCase().trim(), groups = groupList(), html = "";
    // Matches the kit name and what its tools do, so "burns" finds Emergency and "partograph" O&G.
    var match = function (x) {
      if (!q) return true;
      var hay = x.label + " " + x.short + " " + x.id + " " + (x.tools || []).map(function (id) { var T = TOOLS[id]; return T ? T.title + " " + (T.kw || "") : ""; }).join(" ");
      return hay.toLowerCase().indexOf(q) >= 0;
    };
    groups.forEach(function (g) {
      var items = kitList().filter(function (x) { return x.group === g[0] && match(x); });
      if (!items.length) return;
      html += '<div class="kit-pgroup"><h4>' + esc(g[1]) + '</h4><div class="kit-links">' + items.map(function (x) {
        return '<button type="button" class="kit-pill' + (x.id === k.kitId ? " on" : "") + '" data-kit-act="kit:' + esc(x.id) + '">' + ms(x.icon) + esc(x.label) + (x.id === mine ? " " + ms("star") : "") + "</button>";
      }).join("") + "</div></div>";
    });
    return html || '<p class="kit-muted">No kit matches "' + esc(k.pickerQ) + '".</p>';
  }
  function pickerHtml(k, mine) {
    return '<div class="kit-picker" data-kit-picker><label class="kit-field wide" for="kit_picker_q"><span class="kit-fl">Find a specialty kit</span>' +
      '<input id="kit_picker_q" type="search" class="kit-inp" data-kit-f="picker:q" value="' + esc(k.pickerQ || "") + '" placeholder="e.g. cardiology, burns, palliative" autocomplete="off"></label>' +
      '<div data-kit-pickerlist>' + pickerList(k, mine) + "</div></div>";
  }
  function protoTitle(id) {
    try { var idx = G.SMD_KBPROTO && G.SMD_KBPROTO.index && G.SMD_KBPROTO.index(); if (idx) { var p = idx.protocols.filter(function (x) { return x.id === id; })[0]; if (p) return p.title; } } catch (e) {}
    return id.replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }
  // Some older calculator titles carry em or en dashes; the kit shows them without (app text rule).
  function calcTitle(id) { try { var c = G.MEDCALC && G.MEDCALC.get && G.MEDCALC.get(id); if (c && c.title) return String(c.title).replace(/\s+[\u2013\u2014]\s+/g, ", ").replace(/[\u2013\u2014]/g, "-"); } catch (e) {} return id; }

  function refreshAllTools() {
    if (!D) return;
    Array.prototype.forEach.call(D.querySelectorAll("[data-kit-root]"), function (rootEl) {
      var k = ks(rootEl.getAttribute("data-kit-key"));
      Array.prototype.forEach.call(rootEl.querySelectorAll("[data-kit-out]"), function (o) {
        var id = o.getAttribute("data-kit-out"), T = TOOLS[id]; if (T) o.innerHTML = T.out(toolState(k, id));
      });
    });
  }

  /* ======================================= standalone sheet ======================================= */
  function sheetEl() { return D && D.getElementById("smdKit"); }
  function renderSheet() {
    var el = sheetEl(); if (!el) return;
    var body = el.querySelector(".kit-sheet-body"); if (!body) return;
    var top = body.scrollTop;
    body.innerHTML = kitBody({ host: standaloneHost(), key: "standalone" });
    body.scrollTop = top;
  }
  /** Open the standalone kit sheet (Home). opts.kit selects a kit. */
  function open(opts) {
    if (!D || !flagOn()) return;
    var el = sheetEl();
    if (!el) {
      el = D.createElement("div"); el.id = "smdKit"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Specialty kit");
      el.innerHTML = '<div class="kit-sheet"><header class="kit-sheet-top"><button type="button" class="kit-x" data-kit-act="close" aria-label="Close specialty kit">' + ms("close") + '</button><h1>Specialty kit</h1><span></span></header><div class="kit-sheet-body"></div></div>';
      D.body.appendChild(el);
    }
    if (opts && opts.kit && kitById(opts.kit)) { ks("standalone").kitId = opts.kit; pushRecent(opts.kit); }
    else if (opts && opts.kit) ks("standalone").kitId = opts.kit;     // bundle not loaded yet: kitBody resolves it
    el.classList.add("on"); D.body.style.overflow = "hidden"; D.documentElement.classList.add("kit-lock");
    renderSheet();
    var b = el.querySelector(".kit-sheet-body"); if (b) b.scrollTop = 0;
    if (opts && opts.tool) {                 // deep link to a tool (Universal Search, MaiK)
      var go = function () { var t = el.querySelector('[data-kit-tool="' + opts.tool + '"]'); if (t && t.scrollIntoView) t.scrollIntoView({ block: "start" }); return !!t; };
      if (!go()) loadKits().then(function () { renderSheet(); go(); }, function () {});
    }
  }
  function close() { var el = sheetEl(); if (el) el.classList.remove("on"); if (D) { D.body.style.overflow = ""; D.documentElement.classList.remove("kit-lock"); } }

  /* ======================================= events ======================================= */
  function keyOf(el) { var r = el.closest && el.closest("[data-kit-root]"); return r ? r.getAttribute("data-kit-key") : null; }
  function findSection(kit, id) { return (kit.sections || []).filter(function (s) { return s.id === id; })[0]; }
  function onInput(e) {
    var el = e.target, name = el && el.getAttribute && el.getAttribute("data-kit-f"); if (!name) return;
    var key = keyOf(el); if (!key) return;
    var k = ks(key), val = el.type === "checkbox" ? el.checked : el.value;
    var i = name.indexOf(":"), scope = name.slice(0, i), fid = name.slice(i + 1);
    if (scope === "picker") {
      k.pickerQ = val;
      var pl = el.closest("[data-kit-root]").querySelector("[data-kit-pickerlist]");
      if (pl) pl.innerHTML = pickerList(k, mySpecialty());
      return;
    }
    if (scope === "f") {
      k.vals[fid] = val;
      if (el.type === "checkbox") {        // a ticked red flag shows the section alert without a repaint
        var kit = kitById(k.kitId), secEl = el.closest("[data-kit-sec]");
        if (kit && secEl) {
          var sec = findSection(kit, secEl.getAttribute("data-kit-sec")), al = secEl.querySelector("[data-kit-alert]");
          if (sec && al) al.hidden = !(sec.fields || []).some(function (f) { return f.type === "check" && k.vals[f.id]; });
        }
      }
      return;
    }
    var toolId = { dating: "pregnancy-dating", growth: "growth-who", milestones: "milestones", vision: "visual-acuity", hearing: "hearing", pasi: "pasi",
      la: "la-dose", burns: "burns-chart", ckd: "ckd-grid", joints: "joint-chart", body: "body-chart", mccd: "mccd", lcg: "labour-care" }[scope];
    if (!toolId) return;
    var t = toolState(k, toolId), TT = TOOLS[toolId];
    if (toolId === "milestones" && fid.indexOf("done:") === 0) { t.done = t.done || {}; t.done[fid.slice(5)] = val; return; }
    if (TT.set) TT.set(t, fid, val); else t[fid] = val;
    if (TT.reform && TT.reform.indexOf(fid) >= 0) { hostFor(el).repaint(); return; }
    var out = el.closest("[data-kit-root]").querySelector('[data-kit-out="' + toolId + '"]');
    if (out) out.innerHTML = TOOLS[toolId].out(t);
  }
  function onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-kit-act]"); if (!btn) return;
    var act = btn.getAttribute("data-kit-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { micStop(); close(); return; }
    var key = keyOf(btn); if (!key) return;
    var host = hostFor(btn), k = ks(key), kit = kitById(k.kitId);
    if (cmd === "kit") { k.kitId = arg; k.picker = false; k.pickerQ = ""; pushRecent(arg); var kk = kitById(arg); if (kk && kk.scribe && host.setScribe) host.setScribe(kk.scribe); host.repaint(); return; }
    if (cmd === "mic") { micStart(btn, arg, host); return; }
    if (cmd === "docs") { if (G.SMD_DOCS) G.SMD_DOCS.open({ ctx: host.patient && host.kind === "opd" && host.consult ? host.consult() : null }); return; }
    if (cmd === "picker") { k.picker = !k.picker; host.repaint(); if (k.picker && D) { var qi = D.getElementById("kit_picker_q"); if (qi) try { qi.focus(); } catch (e) {} } return; }
    if (cmd === "mine") { setMySpecialty(arg, "manual"); toast("Saved as your specialty."); host.repaint(); return; }
    if (!kit) return;
    if (cmd === "sec") {
      var sec = findSection(kit, arg); if (!sec) return;
      var text = composeSection(sec, k.vals);
      var sets = {};
      sec.fields.forEach(function (f) { if (f.set && k.vals[f.id] != null && String(k.vals[f.id]).trim() !== "" && f.type !== "check") sets[f.set] = f.type === "date" && parseISO(k.vals[f.id]) ? fmtDate(parseISO(k.vals[f.id])) : String(k.vals[f.id]).trim(); });
      if (!text) { toast("Fill in at least one finding first."); return; }
      apply(host, sec.target, text, sets); return;
    }
    if (cmd === "clr") { var s2 = findSection(kit, arg); if (s2) s2.fields.forEach(function (f) { delete k.vals[f.id]; }); host.repaint(); return; }
    if (cmd === "tool") {
      var T = TOOLS[arg]; if (!T || !T.text) return;
      var tt = T.text(toolState(k, arg));
      if (!tt) { toast(arg === "growth-who" && !GROWTH ? "Growth tables are still loading." : "Nothing to add yet."); return; }
      apply(host, T.target, tt, T.sets ? T.sets(toolState(k, arg)) : {}); return;
    }
    if (cmd === "adv") { var a = (kit.advice || []).filter(function (x) { return x.id === arg; })[0]; if (a) apply(host, a.target, a.text, {}); return; }
    if (cmd === "inv") { var inv = (kit.investigations || [])[+arg]; if (inv && host.investigate) host.investigate(inv.query); return; }
    if (cmd === "oset") { var os = (kit.orderSets || []).filter(function (x) { return x.id === arg; })[0]; if (os && host.queueTests) host.queueTests(os.tests, os.label); return; }
    if (cmd === "proto") { if (host.protocol) host.protocol(arg); return; }
    if (cmd === "calc") { if (host.calculator) host.calculator(arg); return; }
    if (cmd === "imm") { if (host.openTab) host.openTab("immun"); return; }
    if (cmd === "tooth") {
      var t = toolState(k, "odontogram"); t.chart = t.chart || {};
      var codes = TOOTH.map(function (x) { return x[0]; }), cur = t.chart[arg] || "", nx = codes[(codes.indexOf(cur) + 1) % codes.length];
      if (nx) t.chart[arg] = nx; else delete t.chart[arg];
      host.repaint(); return;
    }
    if (cmd === "dent") { var td = toolState(k, "odontogram"); td.primary = arg === "prim"; host.repaint(); return; }
    if (cmd === "gchart") { toolState(k, "growth-who").chart = arg; var go = btn.closest("[data-kit-root]").querySelector('[data-kit-out="growth-who"]'); if (go) go.innerHTML = TOOLS["growth-who"].out(toolState(k, "growth-who")); return; }
    if (cmd === "ghadd") { var tg = toolState(k, "growth-who"); tg.hist = tg.hist || []; tg.hist.push({}); host.repaint(); return; }
    if (cmd === "ghrm") { var th = toolState(k, "growth-who"); if (th.hist) th.hist.splice(+arg, 1); host.repaint(); return; }
    if (cmd === "joint") {
      var tj = toolState(k, "joint-chart"), cyc = ["", "T", "S", "TS"]; tj.j = tj.j || {};
      var nj = cyc[(cyc.indexOf(tj.j[arg] || "") + 1) % cyc.length]; if (nj) tj.j[arg] = nj; else delete tj.j[arg];
      host.repaint(); return;
    }
    if (cmd === "bodyreg") { var tb = toolState(k, "body-chart"); tb.inj = tb.inj || []; tb.inj.push({ r: arg }); host.repaint(); return; }
    if (cmd === "bodyrm") { var tr = toolState(k, "body-chart"); if (tr.inj) tr.inj.splice(+arg, 1); host.repaint(); return; }
    if (cmd === "lcgadd") { var tl = toolState(k, "labour-care"); tl.e = tl.e || []; tl.e.push({ at: nowLocal(), v: {} }); tl.cur = tl.e.length - 1; host.repaint(); return; }
    if (cmd === "lcgsel") { toolState(k, "labour-care").cur = +arg; host.repaint(); return; }
    if (cmd === "lcgdel") { var tx = toolState(k, "labour-care"); if (tx.e) { tx.e.splice(+arg, 1); tx.cur = tx.e.length ? Math.min(+arg, tx.e.length - 1) : null; } host.repaint(); return; }
    if (cmd === "icd") { if (host.icd) host.icd(); else if (G.SMD_ICD && G.SMD_ICD.open) G.SMD_ICD.open(); return; }
  }
  function writeNote(host) { return host.writeNote ? host.writeNote() : "Open the patient in write mode to add kit findings to the assessment."; }
  function apply(host, target, text, sets) {
    if (!host.canWrite()) { toast(writeNote(host)); return; }
    if (!host.ready()) { toast("The assessment is still loading."); return; }
    host.insert(target, text, sets || {});
  }

  function install() {
    if (!D || !D.addEventListener || G.__smdKitsWired) return;
    G.__smdKitsWired = true;
    D.addEventListener("input", onInput, false);
    D.addEventListener("change", onInput, false);
    D.addEventListener("click", onClick, false);
    D.addEventListener("smd:profile-loaded", onProfile, false);
  }

  var API = {
    open: open, close: close, html: kitBody, loadKits: loadKits, loadGrowth: loadGrowth, kits: kitList, kit: kitById,
    mySpecialty: mySpecialty, setMySpecialty: setMySpecialty, myScribe: myScribe, myLabel: myLabel, kitForProfile: kitForProfile, state: ks, forget: forget, on: flagOn, notifiable: notifiable, groups: groupList,
    KITS_V: KITS_V, GROWTH_V: GROWTH_V, TOOL_IDS: Object.keys(TOOLS),
    // pure, for tests
    _dating: dating, _acogThreshold: acogThreshold, _growth: growth, _lmsZ: lmsZ, _lmsZAdj: lmsZAdj, _pct: pct,
    _whoVision: whoVision, _logmar: logmar, _whoHearing: whoHearing, _tuningFork: tuningFork, _pasi: pasi, _pasiArea: pasiArea,
    _dmft: dmft, _composeSection: composeSection, _laCalc: laCalc, _burnsCalc: burnsCalc, _ckdCalc: ckdCalc, _ckdEpi2021: ckdEpi2021,
    _jointCalc: jointCalc, _growthChart: growthChart, _sdValue: sdValue, _activity: activity, _mccdCheck: mccdCheck, _lcgAlert: lcgAlert, _lcgAlerts: lcgAlerts, _BODY: BODY, _BANDS: { das: DAS_BANDS, cdai: CDAI_BANDS, sdai: SDAI_BANDS }, _SPEC_TO_KIT: SPEC_TO_KIT, _tools: TOOLS, _setBundle: function (b) { BUNDLE = b; }, _setGrowth: function (g) { GROWTH = g; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KITS = API;
  if (D && D.addEventListener) { if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", install); else install(); }
})(typeof window !== "undefined" ? window : globalThis);
