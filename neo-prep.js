/* StewardMD - neonatal dose preparation (window.SMD_NEO_PREP). Phase 2, flags smd_neo + smd_neo_prep.
 *
 * Given a dose, pick a presentation (Indian catalogue strengths first, then US label strengths), show
 * the reconstitution volume and final concentration from the source, the volume to draw up, the
 * number of vials, and a dilution step when the source sets a maximum concentration for giving.
 * Data: data/neo/prep.json (every number quoted from its source). Nothing is filled in: a drug or a
 * vial with no reconstitution data says "No data on file" for that step.
 *
 * Rounding (owner plan): volumes to 0.01 mL below 1 mL and 0.1 mL from 1 mL, with the rule and the
 * rounding error shown on screen. mg, mcg and g convert exactly; other units never mix.
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  var TO_MG = { mcg: 0.001, microgram: 0.001, mg: 1, g: 1000 };

  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function conv(v, from, to) {
    if (from === to) return v;
    if (TO_MG[from] && TO_MG[to]) return v * TO_MG[from] / TO_MG[to];
    return null;
  }
  function roundVol(ml) {
    if (!(ml > 0)) return { v: ml, step: null, rule: "" };
    var step = ml < 1 ? 0.01 : 0.1, v = Math.round(ml / step) * step;
    v = Math.round(v * 100) / 100;
    return { v: v, step: step, rule: ml < 1 ? "rounded to 0.01 mL (below 1 mL)" : "rounded to 0.1 mL (1 mL and above)" };
  }

  /* Concentration a presentation gives, per mL, in the presentation's unit, and how it gets there. */
  /* data/neo/prep.json conventions: a solution gives v either in vol_ml (whole vial) or per per_ml mL;
   * with neither, the source wrote "v unit/mL" and per_ml is 1. A powder has a concentration only
   * through a reconstitution row for the same vial strength. */
  function isPowder(p) { return /powder|lyophil/i.test(p.form || ""); }
  function concOf(p, recons) {
    if (!isPowder(p) && p.v != null) {
      if (p.per_ml) return { c: p.v / p.per_ml, unit: p.unit, how: "solution", recon: null };
      if (p.vol_ml) return { c: p.v / p.vol_ml, unit: p.unit, how: "solution", recon: null };
      return { c: p.v, unit: p.unit, how: "solution", recon: null };
    }
    var r = (recons || []).filter(function (x) { return x.vial_v === p.v && (x.vial_unit || p.unit) === p.unit && x.final_v != null; })[0];
    if (r) return { c: r.final_v / (r.final_per_ml || 1), unit: r.final_unit || p.unit, how: "reconstituted", recon: r };
    return null;
  }

  /* dose: { v, unit }. Returns { options: [...], pick, notes }. */
  function prepare(drug, dose) {
    var out = { options: [], pick: null, notes: [] };
    var dv = num(dose && dose.v); if (!(dv > 0)) { out.notes.push("Enter the dose."); return out; }
    (drug.presentations || []).forEach(function (p) {
      // Drug in one vial: a powder's strength, or a solution's v when v is the whole vial (vol_ml).
      var vialAmt = isPowder(p) || p.vol_ml ? conv(p.v, p.unit, dose.unit) : null, sameUnit = conv(1, p.unit, dose.unit) != null;
      var co = concOf(p, drug.reconstitution);
      var o = { p: p, vialAmt: vialAmt, conc: null, draw: null, vials: null, recon: co && co.recon, how: co ? co.how : null, sameUnit: sameUnit };
      if (!sameUnit) { o.why = "Unit " + p.unit + " does not match the dose unit " + dose.unit + "."; out.options.push(o); return; }
      if (vialAmt != null) o.vials = Math.ceil(dv / vialAmt - 1e-9);
      if (co) {
        var c = conv(co.c, co.unit, dose.unit);
        if (c != null && c > 0) { o.conc = c; o.draw = dv / c; o.drawR = roundVol(o.draw); o.err = o.drawR.v ? Math.abs(o.drawR.v * c - dv) / dv : null; }
      } else o.why = "No reconstitution volume on file for this vial.";
      out.options.push(o);
    });
    // Choice: calculable options first; Indian catalogue before US; one vial that covers the dose,
    // smallest such vial; otherwise the largest vial (fewest vials).
    var calc = out.options.filter(function (o) { return o.conc; });
    var pool = calc.length ? calc : out.options.filter(function (o) { return o.sameUnit; });
    pool.sort(function (a, b) {
      var ma = a.p.market === "IN" ? 0 : 1, mb = b.p.market === "IN" ? 0 : 1; if (ma !== mb) return ma - mb;
      var va = a.vialAmt == null ? Infinity : a.vialAmt, vb = b.vialAmt == null ? Infinity : b.vialAmt;
      var ca = va >= dv ? 0 : 1, cb = vb >= dv ? 0 : 1; if (ca !== cb) return ca - cb;
      return ca === 0 ? va - vb : vb - va;
    });
    out.pick = pool[0] || null;
    if (!drug.presentations || !drug.presentations.length) out.notes.push("No presentation on file.");
    // Dilution for giving, when the source sets a maximum concentration.
    if (out.pick && out.pick.conc) {
      var lim = (drug.dilution || []).filter(function (x) { return x.final_max_v != null && conv(x.final_max_v, x.final_max_unit, dose.unit) != null; })[0];
      if (lim) {
        var maxC = conv(lim.final_max_v, lim.final_max_unit, dose.unit) / (lim.final_max_per_ml || 1);
        if (out.pick.conc > maxC + 1e-12) {
          var total = dv / maxC, add = total - out.pick.draw;
          out.dilute = { maxC: maxC, total: roundVol(total), add: roundVol(add), src: lim };
        } else out.dilute = { ok: true, maxC: maxC, src: lim };
      }
    }
    return out;
  }

  var ENGINE = { prepare: prepare, roundVol: roundVol, conv: conv, concOf: concOf };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  function hub() { return G.SMD_NEO_HUB; }
  var S = { id: null, dose: "", unit: "", pickIdx: null };
  function fmtN(v) { return v == null ? "" : (Math.round(v * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 }); }
  function presTxt(p) { var pw = /powder|lyophil/i.test(p.form || ""); return fmtN(p.v) + " " + p.unit + (p.per_ml ? " per " + fmtN(p.per_ml) + " mL" : p.vol_ml ? " in " + fmtN(p.vol_ml) + " mL" : pw ? "" : " per mL") + (p.form ? " " + p.form : "") + (p.market ? " (" + p.market + ")" : ""); }

  function resultHtml(A, doc, drug) {
    var esc = A.esc, dose = { v: S.dose, unit: S.unit }, r = prepare(drug, dose), h = "", lines = [];
    if (S.pickIdx != null && r.options[S.pickIdx] && r.options[S.pickIdx].sameUnit) r.pick = r.options[S.pickIdx];
    r.notes.forEach(function (n) { h += A.note(n, "info"); });
    var o = r.pick;
    if (!o) return h + A.noData("a presentation that matches " + esc(S.unit || "this unit"));
    var p = o.p;
    h += '<div class="nh-row"><div class="nh-lbl">1. Vial</div><div class="nh-val" style="font-size:19px">' + esc(presTxt(p)) + "</div>" + A.srcLine(doc, p) + "</div>";
    lines.push("Dose: " + fmtN(num(S.dose)) + " " + S.unit, "Vial: " + presTxt(p));
    if (o.how === "reconstituted") {
      var rc = o.recon;
      h += '<div class="nh-row"><div class="nh-lbl">2. Reconstitute</div><div class="nh-val" style="font-size:19px">Add ' + esc(fmtN(rc.add_ml)) + " mL " + esc(rc.diluent || "") + "</div><div class=\"nh-work\">Gives " + esc(fmtN(rc.final_v) + " " + (rc.final_unit || p.unit) + " per " + (rc.final_per_ml && rc.final_per_ml !== 1 ? fmtN(rc.final_per_ml) + " " : "") + "mL") + "</div>" + A.srcLine(doc, rc) + "</div>";
      lines.push("Reconstitute: add " + fmtN(rc.add_ml) + " mL " + (rc.diluent || "") + " to give " + fmtN(rc.final_v) + " " + (rc.final_unit || p.unit) + "/" + (rc.final_per_ml && rc.final_per_ml !== 1 ? fmtN(rc.final_per_ml) : "") + "mL");
    } else if (o.how === "solution") {
      h += '<div class="nh-row"><div class="nh-lbl">2. Concentration</div><div class="nh-work">' + esc(fmtN(o.conc) + " " + S.unit + " per mL (solution as supplied)") + "</div></div>";
    } else h += '<div class="nh-row"><div class="nh-lbl">2. Reconstitute</div>' + A.noData("reconstituting this vial") + "</div>";
    if (o.conc) {
      h += '<div class="nh-row"><div class="nh-lbl">3. Draw up</div><div class="nh-val">' + esc(fmtN(o.drawR.v)) + ' mL</div><div class="nh-work">' + esc(fmtN(num(S.dose)) + " " + S.unit + " / " + fmtN(o.conc) + " " + S.unit + "/mL = " + fmtN(o.draw) + " mL, " + o.drawR.rule + (o.err ? "; rounding changes the dose by " + (Math.round(o.err * 1000) / 10) + "%" : "")) + "</div></div>";
      lines.push("Draw up: " + fmtN(o.drawR.v) + " mL (" + fmtN(o.conc) + " " + S.unit + "/mL; " + o.drawR.rule + ")");
    }
    if (o.vials != null) { h += '<div class="nh-row"><div class="nh-lbl">Vials needed</div><div class="nh-val" style="font-size:19px">' + o.vials + "</div></div>"; lines.push("Vials: " + o.vials); }
    else h += '<div class="nh-row"><div class="nh-lbl">Vials needed</div>' + A.noData("the volume in one vial") + "</div>";
    if (r.dilute && !r.dilute.ok) {
      h += '<div class="nh-row"><div class="nh-lbl">4. Dilute before giving</div><div class="nh-val" style="font-size:19px">Make up to ' + esc(fmtN(r.dilute.total.v)) + " mL</div><div class=\"nh-work\">" + esc("Add " + fmtN(r.dilute.add.v) + " mL so the concentration is at most " + fmtN(r.dilute.maxC) + " " + S.unit + "/mL") + "</div>" + A.srcLine(doc, r.dilute.src) + "</div>";
      lines.push("Dilute: make up to " + fmtN(r.dilute.total.v) + " mL (max " + fmtN(r.dilute.maxC) + " " + S.unit + "/mL)");
    } else if (r.dilute && r.dilute.ok) h += '<div class="nh-row"><div class="nh-work">Within the source maximum concentration for giving (' + esc(fmtN(r.dilute.maxC) + " " + S.unit + "/mL") + ").</div>" + A.srcLine(doc, r.dilute.src) + "</div>";
    ["infusion", "stability", "compatibility"].forEach(function (k) {
      var xs = drug[k] || []; if (!xs.length) return;
      h += '<div class="nh-row"><div class="nh-lbl">' + (k === "infusion" ? "Giving" : k === "stability" ? "Stability" : "Compatibility") + "</div>" + xs.map(function (x) { return '<div class="nh-work" style="font-family:inherit">' + esc(x.text || "") + "</div>" + A.srcLine(doc, x); }).join("") + "</div>";
    });
    if (r.options.length > 1) h += "<details><summary>Other presentations (" + r.options.length + ")</summary>" + r.options.map(function (x, i) { return '<button type="button" class="nh-li" data-prep-pick="' + i + '"' + (x.sameUnit ? "" : " disabled") + "><span>" + esc(presTxt(x.p)) + "<br><small>" + esc(x.conc ? fmtN(x.conc) + " " + S.unit + "/mL, draw " + fmtN(x.drawR.v) + " mL" + (x.vials != null ? ", " + x.vials + " vial(s)" : "") : x.why || "") + "</small></span></button>"; }).join("") + "</details>";
    A.setSheet("prep", { title: drug.name + " preparation", tag: "Neonatal preparation", lines: ["Baby: " + (G.SMD_NEO ? G.SMD_NEO.summary() : "")].concat(lines) });
    return h;
  }

  function screen(el, A, opts) {
    if (opts && opts.drug) { S.id = opts.drug; if (opts.dose != null) S.dose = String(opts.dose); if (opts.unit) S.unit = opts.unit; S.pickIdx = null; opts.drug = null; }
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("prep").then(function (doc) {
      if (!doc || !(doc.drugs || []).length) { el.innerHTML = '<section class="nh-card"><h3>Preparation</h3>' + A.noData("preparation") + "</section>"; return; }
      var drug = null; (doc.drugs || []).forEach(function (x) { if (x.id === S.id) drug = x; });
      var units = {}; if (drug) (drug.presentations || []).forEach(function (p) { if (conv(1, p.unit, "mg") != null) { units.mg = 1; units.mcg = 1; } else units[p.unit] = 1; });
      if (drug && !S.unit) S.unit = Object.keys(units)[0] || "mg";
      el.innerHTML = '<section class="nh-card"><h3>Preparation ' + A.badge(doc) + "</h3>" +
        '<label>Drug<select data-prep="id"><option value="">Choose a drug</option>' + doc.drugs.map(function (x) { return '<option value="' + A.esc(x.id) + '"' + (x.id === S.id ? " selected" : "") + ">" + A.esc(x.name) + "</option>"; }).join("") + "</select></label>" +
        (drug ? '<div class="nh-grid"><label>Dose<span class="nh-u"><input inputmode="decimal" data-prep="dose" value="' + A.esc(S.dose) + '" placeholder="per dose"></span></label><label>Unit<select data-prep="unit">' + Object.keys(units).map(function (u) { return '<option' + (u === S.unit ? " selected" : "") + ">" + A.esc(u) + "</option>"; }).join("") + "</select></label></div>" +
          (G.SMD_NEO_DOSE && G.SMD_NEO_DOSE.find(drug.id) && G.SMD_NEO_DOSE.find(drug.id).highAlert ? A.secondCheckHtml(drug.name) : "") +
          '<div data-prep-out="1">' + resultHtml(A, doc, drug) + "</div>" + A.actionsHtml("prep") : "") +
        '<div class="nh-foot">Check the vial in your hand against the label before drawing up.</div></section>';
      el.onchange = el.oninput = function (e) {
        var k = e.target.getAttribute && e.target.getAttribute("data-prep"); if (!k) return;
        if (k === "id") { S.id = e.target.value; S.unit = ""; S.pickIdx = null; screen(el, A); return; }
        if (k === "unit") { S.unit = e.target.value; S.pickIdx = null; }
        if (k === "dose") S.dose = e.target.value;
        var out = el.querySelector("[data-prep-out]"); if (out && drug) out.innerHTML = resultHtml(A, doc, drug);
      };
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-prep-pick]"); if (!b || !drug) return; S.pickIdx = +b.getAttribute("data-prep-pick"); var out = el.querySelector("[data-prep-out]"); if (out) out.innerHTML = resultHtml(A, doc, drug); };
    });
  }
  G.SMD_NEO_PREP = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "prep", flag: "prep", order: 2, icon: "vaccines", title: "Prepare a dose", sub: "Vial, dilution, draw-up", kw: "preparation reconstitution dilution vial draw up volume", render: screen });
})(typeof window !== "undefined" ? window : globalThis);
