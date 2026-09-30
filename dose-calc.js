/* StewardMD - Dose calculator (window.SMD_DOSECALC). Owner request 2026-09-28.
 *
 * "Add patient details or select a patient, pick a drug from our database, see the dose for that
 * patient": weight x the dose per kg from our monograph (levothyroxine 1.6 mcg/kg x 55 kg = 88 mcg),
 * with the adult or child row chosen by age, ceilings applied, ideal/adjusted weight when the
 * monograph says so, CrCl (Cockcroft-Gault) or bedside Schwartz eGFR, the monograph's own renal bands
 * and dialysis note, and its Child-Pugh advice.
 *
 * Data: dose-rules.json.gz, built from worker/data/gold by scripts/build-dose-rules.mjs (only
 * unambiguous numbers are rules; everything else is shown as the monograph wrote it). Loaded lazily.
 * Flag: smd_dose_calc, DEFAULT ON (owner 2026-09-28: the monograph doses are verified). Off per device
 * with smd_dose_calc = "0" or ?dosecalc=0. Patient values stay in memory on this device: never stored, sent or logged.
 *
 * The engine (compute, crcl, ibw, ...) is pure and exported for node tests; the UI is below it.
 */
(function (G) {
  "use strict";

  /* ================================ ENGINE (pure) ================================ */
  var TO_MG = { mcg: 0.001, mg: 1, g: 1000 };

  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function r1(n) { return Math.round(n * 10) / 10; }

  /* Devine ideal body weight; needs sex and height. */
  function ibw(sex, heightCm) {
    var h = num(heightCm); if (!h || (sex !== "M" && sex !== "F")) return null;
    var inches = h / 2.54, v = (sex === "M" ? 50 : 45.5) + 2.3 * (inches - 60);
    return v > 0 ? r1(v) : null;
  }
  function adjbw(tbw, ib) { return (tbw && ib) ? r1(ib + 0.4 * (tbw - ib)) : null; }
  function bsa(w, h) { w = num(w); h = num(h); return (w && h) ? Math.round(Math.sqrt(w * h / 3600) * 100) / 100 : null; }
  function bmi(w, h) { w = num(w); h = num(h); return (w && h) ? r1(w / Math.pow(h / 100, 2)) : null; }

  function ageYears(p) {
    var a = num(p.age); if (a == null) return null;
    if (p.ageUnit === "days") return a / 365.25;
    if (p.ageUnit === "months") return a / 12;
    return a;
  }
  function group(ageY) { if (ageY == null) return "adult"; if (ageY < 28 / 365.25) return "neonate"; if (ageY < 18) return "child"; return "adult"; }

  /* Kidney function. Adults: Cockcroft-Gault (mL/min), weight = actual if under ideal, ideal if
   * normal, adjusted if obese (>120% of ideal). Children: bedside Schwartz eGFR (needs height).
   * A CrCl the doctor typed always wins. Returns { value, how, weightUsed } or null. */
  function renalFn(p, derived) {
    var typed = num(p.crcl);
    if (typed != null && typed >= 0) return { value: Math.round(typed), how: "entered" };
    var scr = num(p.scr), ageY = derived.ageY, w = num(p.weight);
    if (!scr || scr <= 0) return null;
    if (ageY != null && ageY < 18) {
      var h = num(p.height); if (!h) return null;
      return { value: Math.round(0.413 * h / scr), how: "bedside Schwartz eGFR" };
    }
    if (ageY == null || !w || (p.sex !== "M" && p.sex !== "F")) return null;
    var wUse = w, wLab = "actual weight";
    if (derived.ibw) {
      if (w < derived.ibw) { wUse = w; wLab = "actual weight"; }
      else if (w > 1.2 * derived.ibw) { wUse = derived.adjbw; wLab = "adjusted weight"; }
      else { wUse = derived.ibw; wLab = "ideal weight"; }
    }
    var v = ((140 - ageY) * wUse) / (72 * scr) * (p.sex === "F" ? 0.85 : 1);
    return { value: Math.round(v), how: "Cockcroft-Gault, " + wLab + " " + r1(wUse) + " kg" };
  }

  function derive(p) {
    var d = { ageY: ageYears(p), weight: num(p.weight), height: num(p.height) };
    d.group = group(d.ageY);
    d.ibw = ibw(p.sex, d.height);
    d.adjbw = d.weight ? adjbw(d.weight, d.ibw) : null;
    d.bsa = bsa(d.weight, d.height);
    d.bmi = bmi(d.weight, d.height);
    d.obese = !!((d.ibw && d.weight > 1.2 * d.ibw) || (d.bmi && d.bmi >= 30));
    d.renal = renalFn(p, d);
    return d;
  }

  /* Sensible bounds: refuse to calculate on a value that is almost certainly a typo. */
  function check(p) {
    var errs = [], w = num(p.weight), a = num(p.age), h = num(p.height), s = num(p.scr), c = num(p.crcl);
    if (w == null) errs.push("Enter the weight in kg.");
    else if (w < 0.3 || w > 350) errs.push("Weight " + w + " kg is outside 0.3 to 350 kg. Check the number.");
    if (a != null && (a < 0 || (p.ageUnit !== "days" && p.ageUnit !== "months" && a > 120))) errs.push("Check the age.");
    if (h != null && (h < 30 || h > 250)) errs.push("Height " + h + " cm is outside 30 to 250 cm. Check the number.");
    if (s != null && (s <= 0 || s > 25)) errs.push("Creatinine " + s + " mg/dL looks wrong. Enter it in mg/dL.");
    if (c != null && (c < 0 || c > 250)) errs.push("Check the CrCl.");
    return errs;
  }

  /* Rounded to a step a nurse or pharmacist can measure; the exact value is always shown too. */
  function practical(v) {
    if (!(v > 0)) return v;
    var step = v < 1 ? 0.05 : v < 10 ? 0.5 : v < 100 ? 1 : v < 250 ? 5 : v < 1000 ? 25 : 50;
    return Math.round(Math.round(v / step) * step * 100) / 100;
  }
  function tidy(v) { return v >= 100 ? Math.round(v) : v >= 10 ? r1(v) : Math.round(v * 100) / 100; }
  /* 1500 mcg reads better as 1.5 mg; 12000 mg as 12 g. */
  function show(v, u) {
    if (u === "mcg" && v >= 1000) return { v: tidy(v / 1000), u: "mg" };
    if (u === "mg" && v >= 10000) return { v: tidy(v / 1000), u: "g" };
    return { v: tidy(v), u: u };
  }
  function fmtAmt(lo, hi, u) {
    var a = lo != null ? show(lo, u) : null, b = hi != null ? show(hi, u) : null;
    if (a && b) { if (a.u === b.u) return a.v.toLocaleString("en-IN") + "-" + b.v.toLocaleString("en-IN") + " " + a.u; return a.v + " " + a.u + " - " + b.v + " " + b.u; }
    var x = a || b; return (a ? "" : "up to ") + x.v.toLocaleString("en-IN") + " " + x.u;
  }
  function perTxt(tm) { return tm === "day" ? " per day" : tm === "dose" ? " per dose" : tm === "h" ? " per hour" : tm === "min" ? " per minute" : tm === "week" ? " per week" : ""; }

  /* Which weight a per-kg row multiplies by. */
  function weightFor(row, drugBasis, d, notes) {
    var basis = row.b !== "actual" ? row.b : (d.obese && drugBasis) ? drugBasis : "actual";
    if (basis === "ideal") {
      if (d.ibw) { notes.push("Uses ideal body weight " + d.ibw + " kg, as the monograph says."); return Math.min(d.ibw, d.weight); }
      notes.push("The monograph asks for ideal body weight: add height and sex. Using actual weight for now.");
    } else if (basis === "adjusted") {
      if (d.adjbw) { notes.push("Uses adjusted body weight " + d.adjbw + " kg (obese), as the monograph says."); return d.adjbw; }
      notes.push("The monograph asks for adjusted body weight: add height and sex. Using actual weight for now.");
    }
    return d.weight;
  }

  /* Apply the row's ceilings to one computed amount. */
  function applyCaps(row, part, lo, hi, factor) {
    var capped = null, top = hi != null ? hi : lo, notes = [];
    (row.cap || []).forEach(function (c) {
      var capV = c.per === "kg" ? c.v * factor : c.v, cu = c.u, sameTime = (c.tm || null) === (part.tm || null);
      var inPartUnits = null;
      if (cu === part.u) inPartUnits = capV;
      else if (TO_MG[cu] && TO_MG[part.u]) inPartUnits = capV * TO_MG[cu] / TO_MG[part.u];
      if (inPartUnits == null) return;
      if (sameTime && top > inPartUnits) {
        if (capped == null || inPartUnits < capped.v) capped = { v: inPartUnits, src: c.src };
      } else if (!sameTime) {
        var s = show(inPartUnits, part.u);
        notes.push("Maximum " + s.v.toLocaleString("en-IN") + " " + s.u + perTxt(c.tm) + " (" + c.src + ").");
      }
    });
    return { capped: capped, notes: notes };
  }

  function computeRow(row, drug, d) {
    var out = { row: row, lines: [], notes: [], kind: row.k };
    if (row.k === "perkg" || row.k === "perm2") {
      var drugBasis = null;
      (drug.rows || []).forEach(function (r) { if (r.b && r.b !== "actual") drugBasis = drugBasis || r.b; });
      row.p.forEach(function (p) {
        if (p.per !== "kg" && p.per !== "m2") return;
        var f, by;
        if (p.per === "kg") { f = weightFor(row, drugBasis, d, out.notes); by = r1(f) + " kg"; }
        else { if (!d.bsa) { out.notes.push("This dose is per m² of body surface: add height to calculate it."); return; } f = d.bsa; by = d.bsa + " m²"; }
        var lo = p.lo != null ? p.lo * f : null, hi = p.hi != null ? p.hi * f : null;
        var cap = applyCaps(row, p, lo, hi, f);
        cap.notes.forEach(function (n) { if (out.notes.indexOf(n) < 0) out.notes.push(n); });
        var fin = { lo: lo, hi: hi };
        if (cap.capped) { if (hi != null && hi > cap.capped.v) fin.hi = cap.capped.v; if (lo != null && lo > cap.capped.v) fin.lo = cap.capped.v; }
        var top = fin.hi != null ? fin.hi : fin.lo;
        out.lines.push({
          label: p.l || "",
          per: p.tm,
          working: (p.lo != null ? p.lo : "up to ") + (p.hi != null ? (p.lo != null ? "-" : "") + p.hi : "") + " " + p.u + "/" + (p.per === "kg" ? "kg" : "m²") + " × " + by,
          value: fmtAmt(fin.lo, fin.hi, p.u) + perTxt(p.tm),
          raw: { lo: fin.lo, hi: fin.hi, u: p.u, tm: p.tm },
          capped: cap.capped ? "Capped at the monograph maximum (" + cap.capped.src + ")." : "",
          practical: top != null && fin.lo != null && fin.hi == null ? (function () { var s = show(practical(top), p.u); return s.v.toLocaleString("en-IN") + " " + s.u; })() : ""
        });
      });
    }
    return out;
  }

  var NEO_NONE = "No neonatal dose on file. Do not extrapolate.";
  function pickRows(drug, d, strictNeo) {
    var g = d.group, rows = drug.rows || [], notes = [];
    // Neonatal layer (smd_neo + smd_neo_dose): a neonate sees neonatal rows only. No child or adult
    // row is ever shown as a neonatal dose; with none on file the answer is NEO_NONE.
    if (g === "neonate" && strictNeo) {
      var neo = rows.filter(function (r) { return r.pop === "neonate"; });
      return { rows: neo, notes: neo.length ? [] : [NEO_NONE], strictNeo: true };
    }
    var mine = rows.filter(function (r) { return r.pop === g || r.pop === "any"; });
    if (g === "neonate" && !mine.some(function (r) { return r.pop === "neonate"; })) {
      var ch = rows.filter(function (r) { return r.pop === "child"; });
      if (ch.length) { notes.push("No neonatal dose in our monograph; showing the children's rows. Check a neonatal reference."); mine = mine.concat(ch); }
    }
    if (g !== "adult" && !mine.some(function (r) { return r.pop === g || r.pop === "neonate" || r.pop === "child"; })) {
      notes.push("No children's dose in our monograph. The adult rows below are for reference only; do not scale them to a child.");
      mine = rows.filter(function (r) { return r.pop === "adult" || r.pop === "any"; });
    }
    if (!mine.length) mine = rows.slice();
    return { rows: mine, notes: notes };
  }

  function renalFor(drug, p, d) {
    var ren = drug.ren || {}, out = { text: ren.text || "", dialysis: !!p.dialysis };
    if (p.dialysis) { out.advice = ren.dia || ""; out.note = ren.dia ? "" : "Our monograph has no dialysis-specific dose. Read the renal note."; return out; }
    if (!d.renal) { out.needs = true; return out; }
    out.fn = d.renal;
    var v = d.renal.value, bands = (ren.bands || []).slice().sort(function (a, b) { return a.lo - b.lo; });
    if (!bands.length) return out;
    var hit = null;
    for (var i = 0; i < bands.length; i++) { var b = bands[i]; if (v >= b.lo && (b.hi == null || v <= b.hi)) { hit = b; break; } }
    if (!hit) { var top = bands.reduce(function (m, b) { return Math.max(m, b.hi == null ? Infinity : b.hi); }, 0); out.normal = v > top; return out; }
    if (hit.mixed) { out.unclear = true; return out; }
    out.band = hit;
    out.boundary = bands.some(function (b) { return b !== hit && v >= b.lo && (b.hi == null || v <= b.hi); });
    return out;
  }

  function hepaticFor(drug, p) {
    var hep = drug.hep || {}, cp = p.childPugh;
    var out = { text: hep.text || "" };
    if (cp && hep.cp && hep.cp[cp]) out.cls = { k: cp, advice: hep.cp[cp].advice, avoid: !!hep.cp[cp].avoid, none: !!hep.cp[cp].none, factor: hep.cp[cp].factor || null };
    else if (cp) out.noRule = true;
    return out;
  }

  /* The whole answer for one drug and one patient. */
  function compute(drug, p) {
    var errs = check(p);
    if (errs.length) return { errors: errs };
    var d = derive(p), picked = pickRows(drug, d, !!p.neoStrict);
    var res = { drug: drug.n, cls: drug.c, kind: drug.k, derived: d, notes: picked.notes.slice(), rows: [], other: [], strictNeo: !!picked.strictNeo };
    if (d.ageY == null) res.notes.push("Age not entered: showing adult doses.");
    picked.rows.forEach(function (r) {
      if (r.k === "perkg" || r.k === "perm2") res.rows.push(computeRow(r, drug, d));
      else res.other.push({ ctx: r.ctx, rt: r.rt, d: r.d, t: r.t, note: r.note, fixed: r.k === "fixed" });
    });
    res.weightBased = res.rows.some(function (x) { return x.lines.length; });
    res.renal = renalFor(drug, p, d);
    res.hepatic = hepaticFor(drug, p);
    // A renal or liver factor ("half dose", "50%") also shows as an adjusted amount on each line.
    var fac = (res.renal.band && res.renal.band.factor) || (res.hepatic.cls && res.hepatic.cls.factor) || null;
    if (fac) res.rows.forEach(function (row) { row.lines.forEach(function (l) {
      var lo = l.raw.lo != null ? l.raw.lo * fac : null, hi = l.raw.hi != null ? l.raw.hi * fac : null;
      l.adjusted = fmtAmt(lo, hi, l.raw.u) + perTxt(l.raw.tm) + " (" + Math.round(fac * 100) + "% for " + (res.renal.band && res.renal.band.factor ? "kidney function" : "liver function") + ")";
    }); });
    res.avoid = !!((res.renal.band && res.renal.band.avoid) || (res.hepatic.cls && res.hepatic.cls.avoid));
    return res;
  }

  var ENGINE = { compute: compute, derive: derive, ibw: ibw, adjbw: adjbw, bsa: bsa, bmi: bmi, practical: practical, check: check, group: group, NEO_NONE: NEO_NONE };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ DATA ================================ */
  var VER = "dr1", URL = "/dose-rules.json.gz?v=" + VER, _data = null, _loading = null;
  function gunzipText(gz) {
    // A server that sends the .gz with Content-Encoding: gzip has already inflated it.
    if (!(gz[0] === 0x1f && gz[1] === 0x8b)) return Promise.resolve(new TextDecoder().decode(gz));
    if (typeof DecompressionStream !== "undefined") {
      try { return new Response(new Response(new Blob([gz])).body.pipeThrough(new DecompressionStream("gzip"))).text(); } catch (e) {}
    }
    if (G.fflate && G.fflate.gunzipSync) return Promise.resolve(new TextDecoder().decode(G.fflate.gunzipSync(gz)));
    return Promise.reject(new Error("no gunzip"));
  }
  function load() {
    if (_data) return Promise.resolve(_data);
    if (_loading) return _loading;
    _loading = fetch(URL).then(function (r) { if (!r.ok) throw new Error("rules " + r.status); return r.arrayBuffer(); })
      .then(function (ab) { return gunzipText(new Uint8Array(ab)); })
      .then(function (t) {
        var j = JSON.parse(t);
        j.byName = {};
        j.drugs.forEach(function (x) { x._q = x.n.toLowerCase(); j.byName[x._q] = x; });
        _data = j; return j;
      })
      .catch(function (e) { _loading = null; throw e; });
    return _loading;
  }
  function findDrug(name) {
    if (!_data || !name) return null;
    var q = String(name).toLowerCase().trim();
    if (_data.byName[q]) return _data.byName[q];
    var base = q.replace(/\s*\(.*\)\s*$/, "").replace(/\s+(sodium|potassium|hydrochloride|hcl|sulfate|sulphate|acetate|citrate|maleate|mesylate|tartrate|succinate|phosphate|bromide|chloride)$/, "");
    for (var i = 0; i < _data.drugs.length; i++) { var n = _data.drugs[i]._q; if (n === base || n.indexOf(base + " ") === 0 || n.indexOf(base + " (") === 0 || n.replace(/\s*\(.*\)\s*$/, "") === base) return _data.drugs[i]; }
    return null;
  }
  function search(q, limit) {
    if (!_data) return [];
    q = String(q || "").toLowerCase().trim(); if (!q) return [];
    var starts = [], has = [];
    _data.drugs.forEach(function (x) { var i = x._q.indexOf(q); if (i === 0) starts.push(x); else if (i > 0) has.push(x); });
    return starts.concat(has).slice(0, limit || 30);
  }

  /* ================================ FLAG ================================ */
  var FLAG = "smd_dose_calc";
  function on() {
    try { var m = (location.search.match(/[?&]dosecalc=([^&]+)/) || [])[1]; if (m != null) return m === "1" || m === "on" || m === "true"; } catch (e) {}
    try { return localStorage.getItem(FLAG) !== "0"; } catch (e) { return true; }
  }

  /* ================================ PATIENTS ================================ */
  /* Patients the doctor already has on this device: the ICU patient open now, the saved ICU roster
   * (which also holds patients brought in from Ward Sync), and the OPD patient open now. Read only. */
  function fromIcuState(st, label) {
    var p = (st && st.patient) || {}, labs = (st && st.labs && st.labs.recent) || {};
    var sc = labs.creat; if (sc && typeof sc === "object") sc = sc.value != null ? sc.value : sc.v;
    return { label: label || p.name || "Unnamed patient", sub: [p.bed ? "Bed " + p.bed : "", p.age != null && p.age !== "" ? p.age + " y" : "", p.sex || "", p.weightKg ? p.weightKg + " kg" : "no weight"].filter(Boolean).join(" · "),
      patient: { weight: p.weightKg || "", age: p.age != null ? p.age : "", ageUnit: "years", sex: p.sex === "M" || p.sex === "F" ? p.sex : "", height: p.heightCm || "", scr: sc != null ? sc : "" } };
  }
  function listPatients() {
    var out = [], seen = {};
    try {
      if (G.ICU && G.ICU.state) { var cur = G.ICU.state(); if (cur && cur.patient && (cur.patient.name || cur.patient.weightKg)) { var c = fromIcuState(cur); c.src = "ICU, open now"; out.push(c); seen[cur.patient._id || c.label] = 1; } }
    } catch (e) {}
    try {
      if (G.ICU && G.ICU.listPatients) G.ICU.listPatients().forEach(function (e) {
        var st = e && e.state; if (!st || !st.patient) return;
        var k = st.patient._id || e.id || e.name; if (seen[k]) return; seen[k] = 1;
        var x = fromIcuState(st, e.name); x.src = e.source === "ward" || e.ward ? "Ward Sync" : "Saved patient"; out.push(x);
      });
    } catch (e) {}
    try {
      if (G.OPDEMR && G.OPDEMR._state) {
        var o = G.OPDEMR._state(), op = (o && o.patient) || null, v = (o && o.assessVals) || {};
        if (op && (op.name || v.Weight)) out.push({ label: op.name || "OPD patient", src: "OPD, open now", sub: [op.age ? op.age + " y" : "", op.sex || op.gender || "", v.Weight ? v.Weight + " kg" : "no weight"].filter(Boolean).join(" · "),
          patient: { weight: v.Weight || "", height: v.Height || "", age: op.age || "", ageUnit: "years", sex: /^m/i.test(op.sex || op.gender || "") ? "M" : /^f/i.test(op.sex || op.gender || "") ? "F" : "", scr: "" } });
      }
    } catch (e) {}
    return out;
  }

  /* ================================ UI ================================ */
  var D = G.document, root = null;
  var S = { p: { weight: "", age: "", ageUnit: "years", sex: "", height: "", scr: "", crcl: "", childPugh: "", dialysis: false }, drug: null, q: "", source: "" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function haptic() { try { if (G.SMD_HAPTICS && G.SMD_HAPTICS.light) G.SMD_HAPTICS.light(); } catch (e) {} }

  function css() {
    if (D.getElementById("dcCss")) return;
    var s = D.createElement("style"); s.id = "dcCss";
    s.textContent = [
      "#doseCalc{--dc-bg:#f4f7f6;--dc-panel:#fff;--dc-ink:#12202a;--dc-mut:#5b6b75;--dc-line:#dce4e2;--dc-acc:#0f766e;--dc-acc-soft:#e3f2ef;--dc-warn:#9a5b00;--dc-warn-soft:#fff3dd;--dc-bad:#b42318;--dc-bad-soft:#fdecea;--dc-f:-apple-system,BlinkMacSystemFont,'SF Pro Text',system-ui,sans-serif;--dc-mono:ui-monospace,'SF Mono',Menlo,monospace;position:fixed;inset:0;z-index:10050;background:var(--dc-bg);color:var(--dc-ink);font:15px/1.45 var(--dc-f);display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}",
      // The rule above sets display:flex, which beats the UA [hidden]{display:none}: without this line a
      // "closed" calculator stayed on screen and swallowed every tap (SMD-MSCQX9).
      "#doseCalc[hidden]{display:none!important}",
      "body.dark #doseCalc,body.v3-dark #doseCalc{--dc-bg:#0d1417;--dc-panel:#151f23;--dc-ink:#e3ecea;--dc-mut:#93a4a8;--dc-line:#26363b;--dc-acc:#37b8a6;--dc-acc-soft:#153430;--dc-warn:#f0b454;--dc-warn-soft:#352812;--dc-bad:#ff7b6e;--dc-bad-soft:#3a1714}",
      "#doseCalc .dc-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 16px 10px;border-bottom:1px solid var(--dc-line);background:var(--dc-panel)}",
      "#doseCalc .dc-x{border:0;background:none;color:var(--dc-acc);font:600 16px var(--dc-f);padding:6px 4px;min-height:40px;cursor:pointer}",
      "#doseCalc .dc-t{flex:1;font:700 17px var(--dc-f)}",
      "#doseCalc .dc-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 30px);display:flex;flex-direction:column;gap:14px}",
      "#doseCalc .dc-card{background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}",
      "#doseCalc h3{margin:0;font:700 13px var(--dc-f);letter-spacing:.06em;text-transform:uppercase;color:var(--dc-mut)}",
      "#doseCalc .dc-hrow{display:flex;align-items:center;justify-content:space-between;gap:8px}",
      "#doseCalc .dc-pick{border:1px solid var(--dc-acc);color:var(--dc-acc);background:transparent;border-radius:10px;font:600 13.5px var(--dc-f);padding:7px 11px;min-height:36px;cursor:pointer}",
      "#doseCalc .dc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}",
      "#doseCalc label{display:flex;flex-direction:column;gap:4px;font:600 12.5px var(--dc-f);color:var(--dc-mut);min-width:0}",
      "#doseCalc input,#doseCalc select{width:100%;box-sizing:border-box;font:500 16px var(--dc-f);color:var(--dc-ink);background:var(--dc-bg);border:1.5px solid var(--dc-line);border-radius:10px;padding:10px 11px;min-height:44px;-webkit-appearance:none;appearance:none}",
      "#doseCalc input:focus,#doseCalc select:focus{outline:none;border-color:var(--dc-acc)}",
      "#doseCalc .dc-req{color:var(--dc-bad)}",
      "#doseCalc .dc-age{display:flex;gap:6px}#doseCalc .dc-age input{flex:1;min-width:0}#doseCalc .dc-age select{flex:0 0 92px}",
      "#doseCalc .dc-seg{display:flex;border:1.5px solid var(--dc-line);border-radius:10px;overflow:hidden;min-height:44px}#doseCalc .dc-seg button{flex:1;border:0;background:var(--dc-bg);color:var(--dc-ink);font:600 14px var(--dc-f);cursor:pointer}#doseCalc .dc-seg button+button{border-left:1.5px solid var(--dc-line)}#doseCalc .dc-seg button[aria-pressed=true]{background:var(--dc-acc);color:#fff}",
      "#doseCalc .dc-tog{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:10px;font:600 14px var(--dc-f);color:var(--dc-ink);grid-column:1/-1}#doseCalc .dc-tog input{width:48px;height:28px;min-height:0;padding:0;border-radius:14px;flex:0 0 auto;position:relative;cursor:pointer;background:var(--dc-line);border:0}#doseCalc .dc-tog input:checked{background:var(--dc-acc)}#doseCalc .dc-tog input::after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s}#doseCalc .dc-tog input:checked::after{left:23px}",
      "#doseCalc .dc-der{font:500 13px var(--dc-f);color:var(--dc-mut)}#doseCalc .dc-der b{color:var(--dc-ink);font-variant-numeric:tabular-nums}",
      "#doseCalc .dc-full{grid-column:1/-1}",
      "#doseCalc .dc-err{font:600 13.5px var(--dc-f);color:var(--dc-bad);background:var(--dc-bad-soft);border-radius:10px;padding:9px 12px}",
      "#doseCalc .dc-hits{display:flex;flex-direction:column}#doseCalc .dc-hit{display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;border:0;border-top:1px solid var(--dc-line);background:none;color:var(--dc-ink);font:600 15px var(--dc-f);padding:11px 2px;min-height:44px;cursor:pointer}#doseCalc .dc-hit:first-child{border-top:0}",
      "#doseCalc .dc-k{flex:0 0 auto;font:600 11px var(--dc-f);color:var(--dc-acc);background:var(--dc-acc-soft);border-radius:999px;padding:3px 8px}#doseCalc .dc-k.f{color:var(--dc-mut);background:var(--dc-bg)}",
      "#doseCalc .dc-drug{display:flex;align-items:baseline;justify-content:space-between;gap:8px}#doseCalc .dc-drug b{font:700 18px var(--dc-f)}#doseCalc .dc-chg{flex:0 0 auto;white-space:nowrap;border:0;background:none;color:var(--dc-acc);font:600 14px var(--dc-f);cursor:pointer;padding:4px}",
      "#doseCalc .dc-cls{font:500 12.5px var(--dc-f);color:var(--dc-mut);margin-top:-6px}",
      "#doseCalc .dc-row{border-top:1px solid var(--dc-line);padding-top:10px;display:flex;flex-direction:column;gap:6px}#doseCalc .dc-row:first-of-type{border-top:0;padding-top:0}",
      "#doseCalc .dc-ctx{font:600 13px var(--dc-f);color:var(--dc-mut)}",
      "#doseCalc .dc-val{font:700 24px/1.2 var(--dc-f);letter-spacing:-.01em;font-variant-numeric:tabular-nums}#doseCalc .dc-lbl{font:700 11px var(--dc-f);letter-spacing:.06em;text-transform:uppercase;color:var(--dc-acc);display:block;margin-bottom:2px}",
      "#doseCalc .dc-work{font:500 13px var(--dc-mono);color:var(--dc-mut)}",
      "#doseCalc .dc-prac{font:600 13.5px var(--dc-f);color:var(--dc-ink)}#doseCalc .dc-prac span{color:var(--dc-mut);font-weight:500}",
      "#doseCalc .dc-adj{font:700 15px var(--dc-f);color:var(--dc-warn)}",
      "#doseCalc .dc-note{font:500 13px var(--dc-f);color:var(--dc-warn);background:var(--dc-warn-soft);border-radius:9px;padding:7px 10px}",
      "#doseCalc .dc-avoid{font:700 14px var(--dc-f);color:var(--dc-bad);background:var(--dc-bad-soft);border-radius:10px;padding:10px 12px}",
      "#doseCalc .dc-src{font:500 12.5px/1.5 var(--dc-mono);color:var(--dc-mut);border-left:3px solid var(--dc-line);padding-left:9px}",
      "#doseCalc .dc-fixed{font:600 15px var(--dc-f)}",
      "#doseCalc .dc-pill{align-self:flex-start;font:700 10.5px var(--dc-f);letter-spacing:.05em;text-transform:uppercase;color:var(--dc-mut);background:var(--dc-bg);border-radius:999px;padding:3px 8px}",
      "#doseCalc details summary{font:600 13.5px var(--dc-f);color:var(--dc-acc);cursor:pointer;min-height:36px;display:flex;align-items:center}",
      "#doseCalc .dc-foot{font:500 12px var(--dc-f);color:var(--dc-mut);text-align:center;padding:4px 8px}",
      "#doseCalc .dc-plist{display:flex;flex-direction:column;gap:2px;max-height:50vh;overflow:auto}#doseCalc .dc-pl{text-align:left;border:0;border-top:1px solid var(--dc-line);background:none;color:var(--dc-ink);padding:10px 2px;cursor:pointer;font:600 15px var(--dc-f)}#doseCalc .dc-pl small{display:block;font:500 12.5px var(--dc-f);color:var(--dc-mut)}",
      "@media(min-width:720px){#doseCalc .dc-body{max-width:720px;margin:0 auto;width:100%}#doseCalc .dc-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}"
    ].join("\n");
    D.head.appendChild(s);
  }

  function field(k, label, attrs) { return '<label>' + label + '<input id="dc_' + k + '" data-k="' + k + '" inputmode="decimal" autocomplete="off" value="' + esc(S.p[k]) + '"' + (attrs || "") + "></label>"; }
  function patientHtml() {
    var p = S.p, d = derive(p), der = [];
    if (d.ibw) der.push("Ideal weight <b>" + d.ibw + " kg</b>");
    if (d.bsa) der.push("BSA <b>" + d.bsa + " m²</b>");
    if (d.bmi) der.push("BMI <b>" + d.bmi + "</b>" + (d.obese ? " (obese)" : ""));
    if (d.renal) der.push((d.ageY != null && d.ageY < 18 && d.renal.how !== "entered" ? "eGFR" : "CrCl") + " <b>" + d.renal.value + " mL/min</b> <span>(" + esc(d.renal.how) + ")</span>");
    return '<section class="dc-card" aria-labelledby="dcPt"><div class="dc-hrow"><h3 id="dcPt">Patient' + (S.source ? " · " + esc(S.source) : "") + '</h3><button class="dc-pick" data-dc="pick">Select patient</button></div>' +
      '<div class="dc-grid">' +
        field("weight", '<span>Weight (kg) <span class="dc-req">*</span></span>', ' placeholder="e.g. 55"') +
        '<label>Age<span class="dc-age"><input id="dc_age" data-k="age" inputmode="decimal" autocomplete="off" value="' + esc(p.age) + '" placeholder="e.g. 45"><select id="dc_ageUnit" data-k="ageUnit"><option value="years"' + (p.ageUnit === "years" ? " selected" : "") + '>years</option><option value="months"' + (p.ageUnit === "months" ? " selected" : "") + '>months</option><option value="days"' + (p.ageUnit === "days" ? " selected" : "") + '>days</option></select></span></label>' +
        '<label>Sex<span class="dc-seg" role="group" aria-label="Sex"><button type="button" data-sex="M" aria-pressed="' + (p.sex === "M") + '">Male</button><button type="button" data-sex="F" aria-pressed="' + (p.sex === "F") + '">Female</button></span></label>' +
        field("height", "Height (cm)", ' placeholder="for ideal weight, BSA"') +
        field("scr", "Creatinine (mg/dL)", ' placeholder="for CrCl"') +
        field("crcl", "Or CrCl (mL/min)", ' placeholder="if known"') +
        '<label class="dc-full">Liver (Child-Pugh)<span class="dc-seg" role="group" aria-label="Child-Pugh class">' + [["", "Normal"], ["A", "A"], ["B", "B"], ["C", "C"]].map(function (c) { return '<button type="button" data-cp="' + c[0] + '" aria-pressed="' + (p.childPugh === c[0]) + '">' + c[1] + "</button>"; }).join("") + "</span></label>" +
        '<label class="dc-tog">On dialysis<input type="checkbox" id="dc_dialysis" data-k="dialysis"' + (p.dialysis ? " checked" : "") + "></label>" +
      "</div>" + (der.length ? '<div class="dc-der">' + der.join(" · ") + "</div>" : "") + "</section>";
  }

  function drugPickerHtml() {
    var hits = S.q ? search(S.q, 30) : [];
    return '<section class="dc-card" aria-labelledby="dcDr"><h3 id="dcDr">Drug</h3>' +
      '<input id="dc_q" type="search" placeholder="Search a drug, e.g. amikacin" autocomplete="off" autocorrect="off" autocapitalize="off" value="' + esc(S.q) + '" aria-label="Search a drug">' +
      (!_data ? '<div class="dc-der">Loading our drug database…</div>' : S.q && !hits.length ? '<div class="dc-der">No drug in our database matches "' + esc(S.q) + '".</div>' :
        '<div class="dc-hits">' + hits.map(function (x) { return '<button class="dc-hit" data-drug="' + esc(x.n) + '"><span>' + esc(x.n) + '</span><span class="dc-k' + (x.k === "perkg" || x.k === "perm2" ? "" : " f") + '">' + (x.k === "perkg" ? "per kg" : x.k === "perm2" ? "per m²" : x.k === "fixed" ? "fixed dose" : "see text") + "</span></button>"; }).join("") + "</div>") +
      "</section>";
  }

  /* Neonatal layer on for this device (neo-flags.js): a neonate is dosed from the neonatal band table. */
  function neoOn() { try { return !!(G.SMD_NEO_FLAGS && G.SMD_NEO_FLAGS.feature("dose") && G.SMD_NEO_DOSE); } catch (e) { return false; } }
  function neoBlock(x, res) {
    var ND = G.SMD_NEO_DOSE, N = G.SMD_NEO;
    if (!ND.loaded()) { ND.load().then(function () { render(); }, function () {}); return { html: '<div class="dc-der">Loading neonatal doses…</div>', has: false }; }
    var band = ND.find(x.n);
    if (!band) return { html: "", has: false };
    // The band table needs the baby record (GA, date of birth); weight comes from here if the record has none.
    var rec = N.get(); if (!rec.weightG && num(S.p.weight)) N.fromPatient({ weight: S.p.weight, sex: S.p.sex });
    var d = N.derived();
    if (G.SMD_NEO_HUB && G.SMD_NEO_HUB.api.css) G.SMD_NEO_HUB.api.css();
    return { has: true, html: '<div class="neo-blk" data-neo-blk="1">' + ND.blockHtml(band, d, { prepare: true }) +
      '<div class="dc-der">Neonatal band table from the baby record: ' + esc(N.summary() || "no baby entered") + '. <button class="dc-chg" data-neo-babyrec="' + esc(band.id) + '">Baby record</button></div></div>' };
  }
  function withNeo(p) { var o = {}; Object.keys(p).forEach(function (k) { o[k] = p[k]; }); o.neoStrict = true; return o; }
  function resultHtml() {
    var x = S.drug, strict = neoOn(), res = compute(x, strict ? withNeo(S.p) : S.p), h = '<section class="dc-card" aria-live="polite"><div class="dc-drug"><b>' + esc(x.n) + '</b><button class="dc-chg" data-dc="change">Change drug</button></div><div class="dc-cls">' + esc(x.c) + "</div>";
    if (res.errors) return h + res.errors.map(function (e) { return '<div class="dc-err">' + esc(e) + "</div>"; }).join("") + "</section>";
    if (res.strictNeo) {
      var nb = neoBlock(x, res);
      if (nb.has) return h + nb.html + '<div class="dc-foot">Neonate: the neonatal band table replaces the monograph rows. Decision support: verify before prescribing.</div></section>';
      if (nb.html) h += nb.html;
    }
    if (res.avoid) h += '<div class="dc-avoid">Avoid or do not use at this ' + (res.renal.band && res.renal.band.avoid ? "kidney function" : "liver class") + ": read the note below.</div>";
    res.notes.forEach(function (n) { h += '<div class="dc-note">' + esc(n) + "</div>"; });
    if (!res.weightBased) h += '<span class="dc-pill">Not weight-based</span>';
    res.rows.forEach(function (row) {
      h += '<div class="dc-row"><div class="dc-ctx">' + esc(row.row.ctx || "Dose") + (row.row.rt ? " · " + esc(row.row.rt) : "") + "</div>";
      row.lines.forEach(function (l) {
        h += '<div><span class="dc-lbl">' + esc(l.label || "Dose") + '</span><div class="dc-val">' + esc(l.value) + '</div><div class="dc-work">' + esc(l.working) + "</div>" +
          (l.practical ? '<div class="dc-prac">Suggested: about ' + esc(l.practical) + " <span>(round to an available strength)</span></div>" : "") +
          (l.adjusted ? '<div class="dc-adj">Adjusted: ' + esc(l.adjusted) + "</div>" : "") +
          (l.capped ? '<div class="dc-note">' + esc(l.capped) + "</div>" : "") + "</div>";
      });
      row.notes.forEach(function (n) { h += '<div class="dc-note">' + esc(n) + "</div>"; });
      h += '<div class="dc-src">' + esc([row.row.d, row.row.t, row.row.note].filter(Boolean).join(" · ")) + "</div></div>";
    });
    // Kidney and liver sit right under the calculated dose (they change it); the monograph's other
    // doses follow, collapsed when a weight-based dose was calculated.
    var other = "";
    if (res.other.length) {
      var inner = res.other.map(function (o) { return '<div class="dc-row"><div class="dc-ctx">' + esc(o.ctx || "Dose") + (o.rt ? " · " + esc(o.rt) : "") + '</div><div class="dc-fixed">' + esc(o.d) + "</div>" + (o.t || o.note ? '<div class="dc-src">' + esc([o.t, o.note].filter(Boolean).join(" · ")) + "</div>" : "") + "</div>"; }).join("");
      other = "<details" + (res.weightBased ? "" : " open") + "><summary>" + (res.weightBased ? "Other doses for this drug" : "Doses in our monograph") + " (" + res.other.length + ")</summary>" + inner + "</details>";
    }
    // Kidney. The app's clinician-verified renal table (antibiotics, renal-dose.js / reasoning.js)
    // wins over the monograph band where it has the drug; its draft table is labelled as draft.
    var R = res.renal, V = !R.dialysis && R.fn ? verifiedRenal(x.n, R.fn.value) : null;
    h += '<div class="dc-row"><div class="dc-ctx">Kidney</div>';
    if (V) h += '<div class="dc-fixed">' + (V.noChange ? "No kidney adjustment at " + esc(R.fn.value) + " mL/min" : esc(R.fn.value) + " mL/min: " + esc(V.dose)) + "</div>" + (V.note ? '<div class="dc-der">' + esc(V.note) + "</div>" : "") +
      '<div class="dc-der">From the StewardMD ' + (V.draft ? "draft renal table (verify locally)" : "verified renal table") + ".</div>";
    if (V) { /* shown above */ }
    else if (R.dialysis) h += R.advice ? '<div class="dc-fixed">' + esc(R.advice) + "</div>" : '<div class="dc-note">' + esc(R.note) + "</div>";
    else if (R.needs) h += '<div class="dc-der">Add creatinine (with age and sex) or a CrCl to check kidney dosing.</div>';
    else if (R.band) h += '<div class="dc-fixed">' + (R.fn.how === "entered" ? "CrCl " : "") + esc(R.fn.value) + " mL/min: " + esc(R.band.advice) + "</div>" + (R.boundary ? '<div class="dc-note">This value sits on the edge of two bands in the monograph; the lower-function band is shown. Check the note.</div>' : "");
    else if (R.normal) h += '<div class="dc-der">' + esc(R.fn.value) + " mL/min is above every adjustment band: no kidney adjustment in our monograph.</div>";
    else if (R.unclear) h += '<div class="dc-note">Our monograph gives several kidney bands in one sentence; read it below and choose.</div>';
    if (R.text && !R.dialysis) h += "<details><summary>Monograph kidney note</summary><div class=\"dc-src\">" + esc(R.text) + "</div></details>";
    h += "</div>";
    // Liver
    var H = res.hepatic;
    if (H.cls || H.text) {
      h += '<div class="dc-row"><div class="dc-ctx">Liver</div>';
      if (H.cls) h += '<div class="dc-fixed">Child-Pugh ' + esc(H.cls.k) + ": " + esc(H.cls.advice) + "</div>";
      else if (H.noRule) h += '<div class="dc-der">No Child-Pugh ' + esc(S.p.childPugh) + " guidance in our monograph; read the note.</div>";
      if (H.text) h += "<details" + (H.noRule ? " open" : "") + "><summary>Monograph liver note</summary><div class=\"dc-src\">" + esc(H.text) + "</div></details>";
      h += "</div>";
    }
    return h + other + '<div class="dc-foot">Calculated from the StewardMD monograph shown above. Decision support: verify before prescribing.</div></section>';
  }

  function render(keepFocus) {
    if (!root) return;
    var fid = keepFocus && D.activeElement && D.activeElement.id, pos = fid && D.activeElement.selectionStart;
    var body = root.querySelector(".dc-body");
    body.innerHTML = patientHtml() + (S.drug ? resultHtml() : drugPickerHtml());
    var blk = body.querySelector("[data-neo-blk]");
    if (blk && G.SMD_NEO_DOSE) { var bd = G.SMD_NEO_DOSE.find(S.drug.n); if (bd) G.SMD_NEO_DOSE.wireGuards(blk, bd, G.SMD_NEO.derived()); }
    if (fid) { var el = D.getElementById(fid); if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) {} } }
  }

  function verifiedRenal(name, crcl) {
    try {
      var RD = G.SMD_RENAL_DOSE, SF = G.SMD_SAFETY; if (!RD || !SF || !SF.renalDoseFor) return null;
      var a = RD.isAntibiotic(name.replace(/\s*\(.*$/, "")); if (!a) return null;
      return SF.renalDoseFor(a.slug, a.label, crcl);
    } catch (e) { return null; }
  }

  function openPatientPicker() {
    var list = listPatients(), body = root.querySelector(".dc-body");
    var h = '<section class="dc-card"><div class="dc-hrow"><h3>Select patient</h3><button class="dc-chg" data-dc="back">Back</button></div>';
    if (!list.length) h += '<div class="dc-der">No patients on this device yet. Patients open or saved in ICU, brought in from Ward Sync, or open in OPD appear here. Enter the details by hand for now.</div>';
    else h += '<div class="dc-plist">' + list.map(function (x, i) { return '<button class="dc-pl" data-pi="' + i + '">' + esc(x.label) + "<small>" + esc([x.src, x.sub].filter(Boolean).join(" · ")) + "</small></button>"; }).join("") + "</div>";
    body.innerHTML = h + "</section>";
    body._list = list;
  }

  function onClick(e) {
    var t = e.target;
    if (t.closest("[data-dc=close]")) { close(); return; }
    var sx = t.closest("[data-sex]"); if (sx) { S.p.sex = S.p.sex === sx.dataset.sex ? "" : sx.dataset.sex; haptic(); render(); return; }
    var cp = t.closest("[data-cp]"); if (cp) { S.p.childPugh = cp.dataset.cp; haptic(); render(); return; }
    if (t.closest("[data-dc=pick]")) { openPatientPicker(); return; }
    if (t.closest("[data-dc=back]")) { render(); return; }
    var pi = t.closest("[data-pi]");
    if (pi) { var x = root.querySelector(".dc-body")._list[+pi.dataset.pi]; if (x) { Object.keys(x.patient).forEach(function (k) { S.p[k] = x.patient[k] == null ? "" : String(x.patient[k]); }); S.source = x.label; } haptic(); render(); return; }
    var dr = t.closest("[data-drug]"); if (dr) { S.drug = findDrug(dr.dataset.drug); haptic(); render(); var b = root.querySelector(".dc-body"); if (b) b.scrollTop = 0; return; }
    var br = t.closest("[data-neo-babyrec]"); if (br && G.SMD_NEO_HUB) { var id = br.getAttribute("data-neo-babyrec"); close(); G.SMD_NEO_HUB.open("dose", { drug: id }); return; }
    if (t.closest("[data-dc=change]")) { S.drug = null; render(); setTimeout(function () { var q = D.getElementById("dc_q"); if (q) q.focus(); }, 50); return; }
  }
  function onInput(e) {
    var t = e.target, k = t.getAttribute && t.getAttribute("data-k");
    if (t.id === "dc_q") { S.q = t.value; render(true); return; }
    if (!k) return;
    S.p[k] = t.type === "checkbox" ? t.checked : t.value;
    if (k !== "ageUnit") S.source = S.source ? S.source + " (edited)" : "";
    if (/ \(edited\) \(edited\)$/.test(S.source)) S.source = S.source.replace(/ \(edited\)$/, "");
    render(true);
  }

  function open(opts) {
    opts = opts || {};
    css();
    if (!root) {
      root = D.createElement("div"); root.id = "doseCalc"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Dose calculator");
      root.innerHTML = '<div class="dc-top"><button class="dc-x" data-dc="close" aria-label="Close dose calculator">‹ Close</button><div class="dc-t">Dose calculator</div></div><div class="dc-body"></div>';
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("change", onInput);
      D.body.appendChild(root);
    }
    root.hidden = false;
    D.body.classList.add("smd-dosecalc-open");
    if (opts.patient) { Object.keys(S.p).forEach(function (k) { if (opts.patient[k] != null) S.p[k] = typeof S.p[k] === "boolean" ? !!opts.patient[k] : String(opts.patient[k]); }); S.source = opts.source || "prefilled"; }
    render();
    load().then(function () {
      if (opts.drug) { var f = findDrug(opts.drug); S.drug = f || null; if (!f) S.q = String(opts.drug).replace(/\s*\(.*$/, ""); }
      render();
      if (!S.drug && !opts.patient) { var w = D.getElementById("dc_weight"); if (w && !S.p.weight) w.focus(); }
    }).catch(function () {
      var b = root.querySelector(".dc-body"); if (b) b.insertAdjacentHTML("beforeend", '<div class="dc-err">Could not load the drug database. Close and try again.</div>');
    });
  }
  function close() {
    if (root) root.hidden = true;
    D.body.classList.remove("smd-dosecalc-open");
    // Patient values are not kept once the calculator closes (no PHI lingers in memory).
    S.p = { weight: "", age: "", ageUnit: "years", sex: "", height: "", scr: "", crcl: "", childPugh: "", dialysis: false }; S.drug = null; S.q = ""; S.source = "";
  }

  /* Drug page button (api.js renderDetail). Shown only when the flag is on; a drug with no monograph
   * in our rules still opens the calculator with the name in the search box. */
  function buttonHTML(composition) {
    if (!on() || !composition) return "";
    if (!D.getElementById("dcBtnCss")) { var s = D.createElement("style"); s.id = "dcBtnCss"; s.textContent = ".db-dose-btn{display:inline-flex;align-items:center;gap:6px;margin-top:8px;margin-left:6px;border:1.5px solid #0f766e;color:#0f766e;background:transparent;border-radius:999px;font:600 13px -apple-system,system-ui,sans-serif;padding:6px 12px;min-height:34px;cursor:pointer}body.dark .db-dose-btn,body.v3-dark .db-dose-btn{border-color:#37b8a6;color:#37b8a6}"; D.head.appendChild(s); }
    return '<button type="button" class="db-dose-btn" data-dosecalc-drug="' + esc(composition) + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h1M14 12h1M9 16h1M14 16h1"/></svg><span>Dose for a patient</span></button>';
  }
  D.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-dosecalc-drug]") : null;
    if (!b) return;
    e.preventDefault();
    open({ drug: b.getAttribute("data-dosecalc-drug"), source: "" });
  }, false);
  D.addEventListener("keydown", function (e) { if (e.key === "Escape" && root && !root.hidden) close(); }, false);

  G.SMD_DOSECALC = { open: open, close: close, on: on, buttonHTML: buttonHTML, load: load, find: function (n) { return findDrug(n); }, has: function (n) { return !!findDrug(n); }, listPatients: listPatients, engine: ENGINE, FLAG: FLAG };
})(typeof window !== "undefined" ? window : globalThis);
