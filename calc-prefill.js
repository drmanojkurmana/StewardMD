/* calc-prefill.js — map parsed clinical values onto a MEDCALC calculator's inputs (Edge Wave 0).
 * ---------------------------------------------------------------------------
 * Input:  a calculator definition (MEDCALC.get(id)) and the result of SMD_CPARAMS.parse(text).
 * Output: { prefill:{inputId:value}, used:[...], notStated:[...], skipped:[...] }
 *
 * Safety rules (vault/plans/Edge-Master-Plan.md section 2):
 *   - Only `usable` values (assertion present, time current, unambiguous) are mapped.
 *   - A value is mapped only when the input's unit is the same quantity in a known unit; a
 *     conversion is applied only for a documented factor. Unknown or different unit: skipped.
 *   - Checkbox (threshold) inputs are filled only for calculators in CHECK_RULES, from explicit
 *     values. A checkbox with no evidence is NOT filled and is listed in notStated, so the card can
 *     say "not stated" instead of letting an unchecked box read as "no" (rule S6).
 *   - The calculator still does the arithmetic (rule S3). This module never computes a score.
 * window.SMD_CALC_PREFILL + module.exports. ES5.
 */
(function (root) {
  "use strict";

  function normUnit(u) { return String(u || "").toLowerCase().replace(/\s+/g, "").replace("μ", "µ").replace("mol/l", "mol/l"); }

  // field -> list of { unit (normalised input unit), factor } the value can be converted to.
  // factor multiplies the canonical parser value (see clinical-params.js FIELDS units).
  var UNIT_MAP = {
    scr_mg_dl:      [{ u: "mg/dl", f: 1 }, { u: "µmol/l", f: 88.4 }, { u: "umol/l", f: 88.4 }, { u: "mmol/l", f: 0.0884 }],
    sodium:         [{ u: "meq/l", f: 1 }, { u: "mmol/l", f: 1 }],
    potassium:      [{ u: "meq/l", f: 1 }, { u: "mmol/l", f: 1 }],
    chloride:       [{ u: "meq/l", f: 1 }, { u: "mmol/l", f: 1 }],
    bicarbonate:    [{ u: "meq/l", f: 1 }, { u: "mmol/l", f: 1 }],
    albumin_g_dl:   [{ u: "g/dl", f: 1 }, { u: "g/l", f: 10 }],
    glucose_mg_dl:  [{ u: "mg/dl", f: 1 }, { u: "mmol/l", f: 1 / 18 }],
    bun_mg_dl:      [{ u: "mg/dl", f: 1 }],
    urea_mmol_l:    [{ u: "mmol/l", f: 1 }],
    calcium_mg_dl:  [{ u: "mg/dl", f: 1 }],
    bilirubin_mg_dl:[{ u: "mg/dl", f: 1 }, { u: "µmol/l", f: 17.1 }, { u: "umol/l", f: 17.1 }],
    inr:            [{ u: "", f: 1 }],
    hb_g_dl:        [{ u: "g/dl", f: 1 }],
    age_years:      [{ u: "yrs", f: 1 }, { u: "years", f: 1 }, { u: "y", f: 1 }, { u: "", f: 1 }],
    weight_kg:      [{ u: "kg", f: 1 }],
    height_cm:      [{ u: "cm", f: 1 }],
    hr:             [{ u: "bpm", f: 1 }, { u: "/min", f: 1 }, { u: "", f: 1 }],
    rr:             [{ u: "/min", f: 1 }, { u: "", f: 1 }],
    sbp:            [{ u: "mmhg", f: 1 }],
    dbp:            [{ u: "mmhg", f: 1 }],
    spo2:           [{ u: "%", f: 1 }],
    temp_c:         [{ u: "°c", f: 1 }],
    gcs:            [{ u: "", f: 1 }]
  };
  // input id (lowercase) or lab hint -> parser field. Ids are matched exactly, never by substring.
  var BY_LAB = { creat: "scr_mg_dl", na: "sodium", k: "potassium", cl: "chloride", hco3: "bicarbonate", alb: "albumin_g_dl",
    glu: "glucose_mg_dl", bun: "bun_mg_dl", ca: "calcium_mg_dl", bili: "bilirubin_mg_dl", inr: "inr", hb: "hb_g_dl" };
  var BY_ID = { age: "age_years", wt: "weight_kg", weight: "weight_kg", ht: "height_cm", height: "height_cm",
    hr: "hr", pulse: "hr", rr: "rr", sbp: "sbp", dbp: "dbp", spo2: "spo2", temp: "temp_c", gcs: "gcs",
    scr: "scr_mg_dl", creat: "scr_mg_dl", cr: "scr_mg_dl", na: "sodium", k: "potassium", cl: "chloride",
    hco3: "bicarbonate", alb: "albumin_g_dl", glu: "glucose_mg_dl", bun: "bun_mg_dl", urea: "urea_mmol_l",
    ca: "calcium_mg_dl", bili: "bilirubin_mg_dl", inr: "inr", hb: "hb_g_dl" };

  // Threshold checkboxes, per calculator. Each rule returns true/false from explicit values, or
  // undefined when the evidence needed is missing (then the box is left alone and listed).
  var CHECK_RULES = {
    curb65: {
      conf: function (v) { return v.confusion; },
      urea: function (v) { return v.urea_mmol_l != null ? v.urea_mmol_l > 7 : (v.bun_mg_dl != null ? v.bun_mg_dl > 19 : undefined); },
      rr:   function (v) { return v.rr != null ? v.rr >= 30 : undefined; },
      bp:   function (v) { return (v.sbp != null && v.dbp != null) ? (v.sbp < 90 || v.dbp <= 60) : undefined; },
      age:  function (v) { return v.age_years != null ? v.age_years >= 65 : undefined; }
    },
    qsofa: {
      rr:  function (v) { return v.rr != null ? v.rr >= 22 : undefined; },
      ams: function (v) { return v.confusion != null ? v.confusion : (v.gcs != null ? v.gcs < 15 : undefined); },
      sbp: function (v) { return v.sbp != null ? v.sbp <= 100 : undefined; }
    }
  };

  function round(v) {
    if (Math.abs(v) >= 100) return Math.round(v);
    return Math.round(v * 100) / 100;
  }

  function build(calc, parsed) {
    var out = { prefill: {}, used: [], notStated: [], skipped: [] };
    if (!calc || !calc.inputs || !parsed || !parsed.usable) return out;
    var u = parsed.usable, plain = {};
    for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) plain[k] = u[k].value;
    var rules = CHECK_RULES[calc.id] || null;

    calc.inputs.forEach(function (inp) {
      var label = String(inp.label || inp.id).replace(/\s*\(.*$/, "");
      // checkbox thresholds
      if (inp.type === "check") {
        var rule = rules && rules[inp.id];
        var res = rule ? rule(plain) : undefined;
        if (res === undefined) { out.notStated.push(label); return; }
        out.prefill[inp.id] = !!res;
        out.used.push({ inputId: inp.id, label: label, field: "rule:" + calc.id + "." + inp.id, value: !!res, source_text: sourcesFor(calc.id, inp.id, u) });
        return;
      }
      // sex select
      if (inp.type === "select" && (inp.demo === "sex" || inp.id === "sex")) {
        if (!u.sex) { out.notStated.push(label); return; }
        var want = u.sex.value, opt = null;
        (inp.opts || []).forEach(function (o) {
          var t = String(o.t || o.v || "").toLowerCase(), v = String(o.v || "").toLowerCase();
          if (want === "female" && (t === "female" || v === "f" || v === "female")) opt = o;
          if (want === "male" && (t === "male" || v === "m" || v === "male")) opt = o;
        });
        if (!opt) { out.skipped.push({ inputId: inp.id, reason: "no matching option" }); return; }
        out.prefill[inp.id] = opt.v;
        out.used.push({ inputId: inp.id, label: label, field: "sex", value: opt.t || opt.v, source_text: u.sex.source_text });
        return;
      }
      if (inp.type !== "number") { out.notStated.push(label); return; }
      var field = (inp.lab && BY_LAB[inp.lab]) || (inp.demo === "age" ? "age_years" : null) || BY_ID[String(inp.id).toLowerCase()];
      if (!field) { out.notStated.push(label); return; }
      if (!u[field]) { out.notStated.push(label); return; }
      var conv = null, iu = normUnit(inp.unit);
      (UNIT_MAP[field] || []).forEach(function (c) { if (c.u === iu) conv = c; });
      if (!conv) { out.skipped.push({ inputId: inp.id, reason: "unit '" + (inp.unit || "") + "' not mapped for " + field }); return; }
      var val = round(u[field].value * conv.f);
      out.prefill[inp.id] = val;
      out.used.push({ inputId: inp.id, label: label, field: field, value: val, unit: inp.unit || "",
        source_text: u[field].source_text, converted: conv.f !== 1 });
    });
    return out;
  }

  function sourcesFor(calcId, inputId, u) {
    var map = { conf: ["confusion"], ams: ["confusion", "gcs"], urea: ["urea_mmol_l", "bun_mg_dl"], rr: ["rr"],
      bp: ["sbp"], sbp: ["sbp"], age: ["age_years"] };
    var fs = map[inputId] || [];
    for (var i = 0; i < fs.length; i++) if (u[fs[i]]) return u[fs[i]].source_text;
    return "";
  }

  // Convenience: parse + build in one call. Returns null when nothing usable maps.
  function forText(calcId, text, opts) {
    var M = root && root.MEDCALC, P = (root && root.SMD_CPARAMS) || tryReq("./clinical-params.js");
    var calc = (opts && opts.calc) || (M && M.get ? M.get(calcId) : null);
    if (!calc || !P) return null;
    var r = build(calc, P.parse(text, opts));
    return r.used.length ? r : null;
  }
  function tryReq(p) { try { return typeof require !== "undefined" ? require(p) : null; } catch (e) { return null; } }

  var API = { build: build, forText: forText, CHECK_RULES: CHECK_RULES, _version: "1.0" };
  if (root) root.SMD_CALC_PREFILL = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
