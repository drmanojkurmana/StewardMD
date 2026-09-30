/* StewardMD - neonatal baby record (window.SMD_NEO). Phase 0 of the neonatal layer, flag smd_neo.
 *
 * Enter the baby once; every neonatal tool reads the same record: GA at birth (weeks + days), date
 * and time of birth, current weight and birth weight (grams), sex. Derived: postnatal age in hours
 * and days, day of life, postmenstrual age, corrected age.
 *
 * Definitions follow data/neo/age.json (PedCRIN tool, quoted): age is never rounded up; PMA = GA +
 * postnatal age; corrected age uses the expected date of delivery at 40 weeks (before it, corrected
 * age equals PMA; after it, the weeks of prematurity come off postnatal age); neonatal period is
 * below 28 days. Day of life counts the first 24 hours as day 1 and is always shown next to the exact
 * postnatal age in hours, which is what hour-specific tools (bilirubin) use.
 *
 * Storage: memory only. Never written to localStorage, never sent, never logged; clear() and a page
 * close wipe it (same rule as dose-calc.js). Guards (owner plan): GA 22 to 44 weeks, weight 300 to
 * 8,000 g, weights always in grams (a value that looks like kilograms is refused, not converted).
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  var TERM_DAYS = 40 * 7;          // data/neo/age.json rules.corrected term_wk
  var NEONATAL_DAYS = 28;          // data/neo/age.json rules.neonatal_period days_lt
  var LIMITS = { gaMin: 22, gaMax: 44, wMin: 300, wMax: 8000 };

  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Wall-clock minutes since the epoch for a local date + time, computed with Date.UTC so a daylight
   * saving change or a month end never shifts the day count. */
  function wallMin(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h || 0, mi || 0) / 60000; }
  function parseDob(dob, tob) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || "").trim()); if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = /^(\d{1,2}):(\d{2})$/.exec(String(tob || "").trim());
    var h = t ? +t[1] : 0, mi = t ? +t[2] : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    var dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCDate() !== d) return null;   // 31 Feb etc.
    return { min: wallMin(y, mo, d, h, mi), timed: !!t };
  }
  /* now: a Date (its local wall clock is used) or "YYYY-MM-DDTHH:MM" (tests). */
  function nowMin(now) {
    if (typeof now === "string") { var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(now); if (m) return wallMin(+m[1], +m[2], +m[3], +m[4], +m[5]); }
    var n = now instanceof Date ? now : new Date();
    return wallMin(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes());
  }
  function wd(days) { return { w: Math.floor(days / 7), d: days % 7 }; }
  function fmtWD(x) { return x.w + "+" + x.d; }

  function check(r) {
    var errs = [], ga = num(r.gaW), gd = num(r.gaD), w = num(r.weightG), bw = num(r.birthWeightG);
    if (ga != null) {
      if (ga % 1) errs.push("Enter gestation as whole weeks plus days.");
      else if (ga < LIMITS.gaMin || ga > LIMITS.gaMax) errs.push("Gestation " + ga + " weeks is outside " + LIMITS.gaMin + " to " + LIMITS.gaMax + " weeks. Check the number.");
    }
    if (gd != null && (gd < 0 || gd > 6 || gd % 1)) errs.push("Gestation days must be 0 to 6.");
    [["Weight", w], ["Birth weight", bw]].forEach(function (x) {
      if (x[1] == null) return;
      if (x[1] > 0 && x[1] < 30) errs.push(x[0] + " " + x[1] + " looks like kilograms. Enter it in grams (for example " + Math.round(x[1] * 1000) + " g).");
      else if (x[1] < LIMITS.wMin || x[1] > LIMITS.wMax) errs.push(x[0] + " " + x[1] + " g is outside " + LIMITS.wMin + " to " + LIMITS.wMax.toLocaleString("en-IN") + " g. Check the number.");
    });
    if (r.dob && !parseDob(r.dob, r.tob)) errs.push("Check the date and time of birth.");
    return errs;
  }

  /* Everything a tool needs, from the raw record. Missing inputs leave their outputs null. */
  function derive(r, now) {
    r = r || {};
    var out = { errors: check(r), gaDays: null, ga: null, pnaMin: null, pnaHours: null, pnaDays: null, dol: null, pma: null, pmaDays: null, pmaWeeks: null, corrected: null, weightG: num(r.weightG), birthWeightG: num(r.birthWeightG), sex: r.sex === "M" || r.sex === "F" ? r.sex : "", neonate: null, timed: false, future: false };
    out.weightKg = out.weightG != null ? out.weightG / 1000 : null;
    var ga = num(r.gaW), gd = num(r.gaD);
    if (ga != null && !out.errors.some(function (e) { return /Gestation/.test(e); })) { out.gaDays = ga * 7 + (gd || 0); out.ga = wd(out.gaDays); out.gaWeeks = out.gaDays / 7; }
    var b = parseDob(r.dob, r.tob);
    if (b) {
      out.timed = b.timed;
      var mins = nowMin(now) - b.min;
      if (mins < 0) { out.future = true; out.errors.push("Birth is in the future. Check the date and time of birth."); }
      else {
        out.pnaMin = mins; out.pnaHours = Math.floor(mins / 60); out.pnaDays = Math.floor(mins / 1440); out.dol = out.pnaDays + 1;
        out.neonate = out.pnaDays < NEONATAL_DAYS;
      }
    }
    if (out.gaDays != null && out.pnaDays != null) {
      out.pmaDays = out.gaDays + out.pnaDays; out.pma = wd(out.pmaDays); out.pmaWeeks = out.pmaDays / 7;
      if (out.gaDays < TERM_DAYS) {
        if (out.pmaDays < TERM_DAYS) out.corrected = { beforeTerm: true, asPma: out.pma, text: fmtWD(out.pma) + " weeks (before term: corrected age = PMA)" };
        else { var c = out.pnaDays - (TERM_DAYS - out.gaDays); out.corrected = { beforeTerm: false, days: c, weeks: wd(c), text: fmtWD(wd(c)) + " weeks corrected" }; }
      }
    }
    return out;
  }

  function summary(d) {
    var p = [];
    if (d.ga) p.push("GA " + fmtWD(d.ga));
    if (d.pnaDays != null) p.push("DOL " + d.dol + " (" + (d.pnaHours < 96 ? d.pnaHours + " h" : d.pnaDays + " d") + ")");
    if (d.pma) p.push("PMA " + fmtWD(d.pma));
    if (d.weightG != null) p.push(Math.round(d.weightG).toLocaleString("en-IN") + " g");
    if (d.sex) p.push(d.sex === "M" ? "Male" : "Female");
    return p.join(" · ");
  }

  /* ---- Age and weight bands, shared by every neonatal tool (dose, fluids, reference values, ...) ----
   * A band's `when` holds conditions copied as the source words them (data/neo/README.md): min (>=),
   * gt (>), max (<=), lt (<). Gestation and PMA compare in COMPLETED weeks (never rounded up); postnatal
   * age in days, weeks, months or years compares as elapsed time, so "one week or less" ends at 7 days.
   * Months are days / (365.25 / 12). Weights compare in the unit the band states (g or kg).
   * "First week of life" is the first 7 days (postnatal age below 7 days). */
  var DAYS_PER_MONTH = 365.25 / 12;
  function context(d) {
    d = d || {};
    var pd = d.pnaMin != null ? d.pnaMin / 1440 : d.pnaDays;
    return {
      ga_wk: d.gaDays != null ? Math.floor(d.gaDays / 7) : null,
      pma_wk: d.pmaDays != null ? Math.floor(d.pmaDays / 7) : null,
      pna_d: d.pnaDays != null ? d.pnaDays : null,
      pna_wk: pd != null ? pd / 7 : null,
      pna_mo: pd != null ? pd / DAYS_PER_MONTH : null,
      age_mo: pd != null ? pd / DAYS_PER_MONTH : null, age_months: pd != null ? pd / DAYS_PER_MONTH : null,
      age_yr: pd != null ? pd / 365.25 : null, age_years: pd != null ? pd / 365.25 : null,
      dol: d.dol != null ? d.dol : null,
      hours: d.pnaHours != null ? d.pnaHours : null,
      life_week: d.pnaDays != null ? (d.pnaDays < 7 ? "first" : "after_first") : null,
      at_birth: d.pnaHours != null ? d.pnaHours < 1 : null,
      wt_g: d.weightG != null ? d.weightG : null,
      bw_g: d.birthWeightG != null ? d.birthWeightG : null
    };
  }
  var NEEDS = { ga_wk: "gestation at birth", pma_wk: "gestation and date of birth (for PMA)", pna_d: "date of birth", pna_wk: "date of birth", pna_mo: "date of birth", age_mo: "date of birth", age_months: "date of birth", age_yr: "date of birth", age_years: "date of birth", dol: "date of birth", hours: "date and time of birth", life_week: "date of birth", at_birth: "date and time of birth", wt: "current weight", bw: "birth weight" };
  function test1(c, v) {
    if (v == null) return null;
    if (typeof c !== "object" || c === null) return c === v;               // text or boolean keys (life_week, at_birth)
    if (c.eq != null) return c.eq === v;
    if (c.min != null && !(v >= c.min)) return false;
    if (c.gt != null && !(v > c.gt)) return false;
    if (c.max != null && !(v <= c.max)) return false;
    if (c.lt != null && !(v < c.lt)) return false;
    return true;
  }
  function valueFor(key, c, ctx) {
    if (key === "wt" || key === "bw") { var g = ctx[key + "_g"]; if (g == null) return null; return c && c.unit === "kg" ? g / 1000 : g; }
    return key in ctx ? ctx[key] : undefined;
  }
  /* { ok: true | false | null (unknown), needs: [labels], unknownKeys: [keys the engine does not know] } */
  function matches(when, ctx) {
    var ok = true, needs = [], unk = [];
    Object.keys(when || {}).forEach(function (k) {
      var v = valueFor(k, when[k], ctx);
      if (v === undefined) { unk.push(k); needs.push("a condition this app cannot read (" + k + ")"); ok = ok === true ? null : ok; return; }
      var r = test1(when[k], v);
      if (r === null) { needs.push(NEEDS[k] || k); if (ok === true) ok = null; }
      else if (r === false) ok = false;
    });
    return { ok: ok, needs: needs, unknownKeys: unk };
  }
  function condText(when) {
    var out = [], L = { ga_wk: ["GA", "wk"], pma_wk: ["PMA", "wk"], pna_d: ["PNA", "d"], pna_wk: ["PNA", "wk"], pna_mo: ["PNA", "mo"], age_mo: ["Age", "mo"], age_months: ["Age", "mo"], age_yr: ["Age", "y"], age_years: ["Age", "y"], dol: ["Day of life", ""], hours: ["Age", "h"], wt: ["Weight", ""], bw: ["Birth weight", ""] };
    Object.keys(when || {}).forEach(function (k) {
      var c = when[k];
      if (k === "life_week") { out.push(c === "first" ? "First week of life" : "After the first week of life"); return; }
      if (k === "at_birth") { out.push("At birth"); return; }
      if (typeof c !== "object" || c === null) { out.push(k + " " + c); return; }
      var l = L[k] || [k, ""], u = c.unit || l[1], p = [];
      if (c.min != null) p.push(">= " + c.min); if (c.gt != null) p.push("> " + c.gt);
      if (c.max != null) p.push("<= " + c.max); if (c.lt != null) p.push("< " + c.lt);
      out.push(l[0] + " " + p.join(" and ") + (u ? " " + u : ""));
    });
    return out.join(", ");
  }

  var ENGINE = { derive: derive, check: check, parseDob: parseDob, summary: summary, fmtWD: fmtWD, context: context, matches: matches, condText: condText, LIMITS: LIMITS, TERM_DAYS: TERM_DAYS, NEONATAL_DAYS: NEONATAL_DAYS };
  G.SMD_NEO_ENGINE = ENGINE;
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ RECORD (memory only) ================================ */
  var EMPTY = { gaW: "", gaD: "", dob: "", tob: "", weightG: "", birthWeightG: "", sex: "" };
  var rec = {}, listeners = [];
  function reset() { rec = {}; Object.keys(EMPTY).forEach(function (k) { rec[k] = EMPTY[k]; }); }
  reset();
  function emit() { var d = derived(); listeners.forEach(function (f) { try { f(rec, d); } catch (e) {} }); }
  function get() { var o = {}; Object.keys(rec).forEach(function (k) { o[k] = rec[k]; }); return o; }
  function set(part) { Object.keys(part || {}).forEach(function (k) { if (k in EMPTY) rec[k] = part[k] == null ? "" : String(part[k]); }); emit(); }
  function clear() { reset(); emit(); }
  function derived(now) { return derive(rec, now); }
  function has() { return !!(rec.weightG || rec.gaW || rec.dob); }
  /* The dose calculator's patient shape: weight in kg, age in days. */
  function toDoseCalcPatient() {
    var d = derived(); if (!d.weightKg) return null;
    return { weight: String(Math.round(d.weightKg * 1000) / 1000), age: d.pnaDays != null ? String(d.pnaDays) : "", ageUnit: "days", sex: d.sex };
  }
  /* Prefill from an ICU / OPD patient the dose calculator already lists (weight kg, age). Fills only
   * what those screens know; the doctor adds GA and time of birth. */
  function fromPatient(p) {
    if (!p) return;
    var part = {};
    var w = num(p.weight); if (w != null && w > 0) part.weightG = String(Math.round(w * 1000));
    if (p.sex === "M" || p.sex === "F") part.sex = p.sex;
    set(part);
  }
  G.SMD_NEO = { get: get, set: set, clear: clear, derived: derived, has: has, on: function (f) { if (typeof f === "function") listeners.push(f); }, off: function (f) { listeners = listeners.filter(function (x) { return x !== f; }); }, summary: function () { return summary(derived()); }, toDoseCalcPatient: toDoseCalcPatient, fromPatient: fromPatient, engine: ENGINE };
})(typeof window !== "undefined" ? window : globalThis);
