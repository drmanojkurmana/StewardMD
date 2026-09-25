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
  var KITS_V = "4440affd8c32";
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
  var MINE_KEY = "smd_my_specialty";
  function mySpecialty() { try { return (G.localStorage && G.localStorage.getItem(MINE_KEY)) || ""; } catch (e) { return ""; } }
  function setMySpecialty(id) { try { if (G.localStorage) { if (id) G.localStorage.setItem(MINE_KEY, id); else G.localStorage.removeItem(MINE_KEY); } } catch (e) {} }
  function ks(key) {
    if (!KS[key]) KS[key] = { kitId: "", vals: {}, tools: {} };
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
      f.opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select>" + hint + "</label>";
    if (f.type === "textarea") return '<label class="kit-field wide" for="' + id + '">' + lab + '<textarea id="' + id + '" rows="2" class="kit-inp" data-kit-f="' + name + '" placeholder="' + ph + '">' + esc(val) + "</textarea>" + hint + "</label>";
    var type = f.type === "number" ? 'type="number" inputmode="decimal" step="any"' : f.type === "date" ? 'type="date"' : 'type="text"';
    return '<label class="kit-field" for="' + id + '">' + lab + "<input " + type + ' id="' + id + '" class="kit-inp" data-kit-f="' + name + '" value="' + esc(val) + '" placeholder="' + ph + '">' + hint + "</label>";
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
      title: "Pregnancy dating", icon: "event",
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
      title: "Growth (WHO z-scores)", icon: "monitoring",
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
          fieldHtml({ id: "oedema", label: "Bilateral pitting oedema", type: "check" }, t.oedema, "growth") + "</div>";
      },
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
          "</tbody></table>" + notes(r.notes);
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
      title: "Developmental milestones (CDC 2022)", icon: "child_care",
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
      title: "Visual acuity and IOP", icon: "visibility",
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
      title: "Hearing (tuning forks and audiometry)", icon: "hearing",
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
      title: "Dental chart (FDI) and DMFT", icon: "dentistry",
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
      title: "PASI (psoriasis severity)", icon: "dermatology",
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
    }
  };
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
    var chips = '<div class="kit-chips" role="group" aria-label="Specialty">' + list.map(function (x) {
      return '<button type="button" class="kit-chip' + (x.id === k.kitId ? " on" : "") + '" data-kit-act="kit:' + esc(x.id) + '" aria-pressed="' + (x.id === k.kitId) + '">' + esc(x.short) + (x.id === mine ? ' <span class="kit-star" aria-label="my specialty">' + ms("star") + "</span>" : "") + "</button>";
    }).join("") + "</div>";
    if (!kit) return chips + '<div class="kit-empty">No kit selected.</div>';
    var blocked = host.kind === "opd" && !host.canWrite() ? '<div class="kit-status">' + ms("lock") + "<span>" + esc(writeNote(host)) + "</span></div>"
      : host.kind === "opd" && !host.ready() ? '<div class="kit-status">' + ms("hourglass_top") + "<span>" + esc(host.readyNote ? host.readyNote() : "Loading the assessment…") + "</span></div>" : "";
    var head = '<div class="kit-head"><div><span class="kit-kicker">Specialty kit</span><h2>' + esc(kit.label) + "</h2></div>" +
      (kit.id === mine ? '<span class="kit-mine">' + ms("star") + "My specialty</span>" : '<button type="button" class="kit-link" data-kit-act="mine:' + esc(kit.id) + '">Set as my specialty</button>') + "</div>";
    var tools = (kit.tools || []).map(function (id) { return toolHtml(id, k, host); }).join("");
    var secs = (kit.sections || []).map(function (s) { return sectionHtml(kit, s, k, host); }).join("");
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
    return '<div class="kit" data-kit-root data-kit-key="' + esc(ctx.key) + '" data-kit-host="' + host.kind + '">' + chips + head + reviewNote(kit, host) + blocked + tools + secs + adv + inv + protos + calcs + src + "</div>";
  }
  function protoTitle(id) {
    try { var idx = G.SMD_KBPROTO && G.SMD_KBPROTO.index && G.SMD_KBPROTO.index(); if (idx) { var p = idx.protocols.filter(function (x) { return x.id === id; })[0]; if (p) return p.title; } } catch (e) {}
    return id.replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function calcTitle(id) { try { var c = G.MEDCALC && G.MEDCALC.get && G.MEDCALC.get(id); if (c && c.title) return c.title; } catch (e) {} return id; }

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
    if (opts && opts.kit) ks("standalone").kitId = opts.kit;
    el.classList.add("on"); D.body.style.overflow = "hidden"; D.documentElement.classList.add("kit-lock");
    renderSheet();
    var b = el.querySelector(".kit-sheet-body"); if (b) b.scrollTop = 0;
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
    var toolId = { dating: "pregnancy-dating", growth: "growth-who", milestones: "milestones", vision: "visual-acuity", hearing: "hearing", pasi: "pasi" }[scope];
    if (!toolId) return;
    var t = toolState(k, toolId);
    if (toolId === "milestones" && fid.indexOf("done:") === 0) { t.done = t.done || {}; t.done[fid.slice(5)] = val; return; }
    t[fid] = val;
    var out = el.closest("[data-kit-root]").querySelector('[data-kit-out="' + toolId + '"]');
    if (out) out.innerHTML = TOOLS[toolId].out(t);
  }
  function onClick(e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-kit-act]"); if (!btn) return;
    var act = btn.getAttribute("data-kit-act"), i = act.indexOf(":"), cmd = i < 0 ? act : act.slice(0, i), arg = i < 0 ? "" : act.slice(i + 1);
    if (cmd === "close") { close(); return; }
    var key = keyOf(btn); if (!key) return;
    var host = hostFor(btn), k = ks(key), kit = kitById(k.kitId);
    if (cmd === "kit") { k.kitId = arg; var kk = kitById(arg); if (kk && kk.scribe && host.setScribe) host.setScribe(kk.scribe); host.repaint(); return; }
    if (cmd === "mine") { setMySpecialty(arg); toast("Saved as your specialty."); host.repaint(); return; }
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
  }

  var API = {
    open: open, close: close, html: kitBody, loadKits: loadKits, loadGrowth: loadGrowth, kits: kitList, kit: kitById,
    mySpecialty: mySpecialty, setMySpecialty: setMySpecialty, state: ks, forget: forget, on: flagOn,
    KITS_V: KITS_V, GROWTH_V: GROWTH_V, TOOL_IDS: Object.keys(TOOLS),
    // pure, for tests
    _dating: dating, _acogThreshold: acogThreshold, _growth: growth, _lmsZ: lmsZ, _lmsZAdj: lmsZAdj, _pct: pct,
    _whoVision: whoVision, _logmar: logmar, _whoHearing: whoHearing, _tuningFork: tuningFork, _pasi: pasi, _pasiArea: pasiArea,
    _dmft: dmft, _composeSection: composeSection, _tools: TOOLS, _setBundle: function (b) { BUNDLE = b; }, _setGrowth: function (g) { GROWTH = g; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.SMD_KITS = API;
  if (D && D.addEventListener) { if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", install); else install(); }
})(typeof window !== "undefined" ? window : globalThis);
