/* StewardMD - therapeutic drug monitoring (window.SMD_NEO_TDM). Phase 10, flags smd_neo + smd_neo_tdm.
 *
 * Vancomycin AUC from two levels after one dose (Sawchuk-Zaske style, equations quoted in
 * data/neo/tdm.json): ke = ln(C1/C2)/(t2 - t1); Cmax back-extrapolated from the first level to the end
 * of the infusion; Cmin at the end of the interval; AUC over the infusion by trapezoid and over the
 * elimination phase as (Cmax - Cmin)/ke; AUC24 = (AUCinf + AUCelim) x 24/tau. Times are hours from the
 * START of the infusion. Compared with the guideline targets on file.
 * Gentamicin: the neonatal level statements on file (NICE NG195 trough and peak, FDA paediatric label).
 * Extended-interval (Hartford) starting intervals are shown as the source gives them, labelled adult and
 * not validated in neonates; the nomogram lines are not on file, so a level is not read against it.
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }

  /* x: { tau, tin, c1, t1, c2, t2 } (hours from the start of the infusion; mg/L). */
  function vancoAuc(x) {
    var tau = num(x.tau), tin = num(x.tin), c1 = num(x.c1), t1 = num(x.t1), c2 = num(x.c2), t2 = num(x.t2);
    if ([tau, tin, c1, t1, c2, t2].some(function (v) { return v == null; })) return { needs: true };
    if (!(c1 > 0 && c2 > 0)) return { error: "Levels must be above zero." };
    if (!(t2 > t1)) return { error: "The second level must be taken after the first." };
    if (!(t1 >= tin)) return { error: "The first level must be taken after the infusion ends." };
    if (!(c1 > c2)) return { error: "The second level must be lower than the first (elimination phase)." };
    if (!(tau > tin)) return { error: "The dosing interval must be longer than the infusion." };
    var ke = Math.log(c1 / c2) / (t2 - t1), half = Math.log(2) / ke;
    var cmax = c1 / Math.exp(-ke * (t1 - tin)), cmin = cmax * Math.exp(-ke * (tau - tin));
    var aucInf = tin * (cmax + cmin) / 2, aucElim = (cmax - cmin) / ke, auc24 = (aucInf + aucElim) * 24 / tau;
    return { ke: ke, half: half, cmax: cmax, cmin: cmin, aucInf: aucInf, aucElim: aucElim, auc24: auc24 };
  }
  /* Gentamicin trough against the NICE statement: below 2 mg/L, or below 1 mg/L past 3 doses. */
  function gentTrough(trough, doses, rules) {
    var t = num(trough); if (t == null || !rules) return null;
    var lim = rules.trough_lt && rules.trough_lt.v, longc = rules.long_course;
    if (lim == null) return null;
    var useLong = longc && num(doses) != null && num(doses) > longc.doses_gt;
    var target = useLong ? longc.trough_lt.v : lim;
    return { target: target, ok: t < target, long: !!useLong };
  }
  var ENGINE = { vancoAuc: vancoAuc, gentTrough: gentTrough };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  var S = { tab: "vanco", tau: "", tin: "", c1: "", t1: "", c2: "", t2: "", trough: "", doses: "", peak: "" };
  function r1(v) { return v == null || !isFinite(v) ? "" : (Math.round(v * 10) / 10).toLocaleString("en-IN"); }
  function r3(v) { return v == null || !isFinite(v) ? "" : (Math.round(v * 1000) / 1000).toString(); }
  function vancoOut(A, doc) {
    var V = doc.vancomycin || {}, r = vancoAuc(S), h = "", esc = A.esc;
    if (r.needs) h += A.note("Enter how often the dose is given, how long it runs, and two blood levels with the times they were taken.", "info");
    else if (r.error) h += '<div class="nh-err">' + esc(r.error) + "</div>";
    else {
      h += '<div class="nh-row"><div class="nh-lbl">Exposure over 24 h (AUC24)</div><div class="nh-val">' + r1(r.auc24) + " mg·h/L</div>" +
        '<div class="nh-work">' + esc("ke " + r3(r.ke) + " /h, half-life " + r1(r.half) + " h, Cmax " + r1(r.cmax) + " mg/L, Cmin " + r1(r.cmin) + " mg/L; AUC infusion " + r1(r.aucInf) + " + elimination " + r1(r.aucElim) + " per " + num(S.tau) + " h interval") + "</div></div>";
      var t = V.auc_target, n = V.neonatal;
      if (t) { var st = r.auc24 < t.lo ? "below" : r.auc24 > t.hi ? "above" : "within"; h += '<div class="nh-note' + (st === "within" ? " info" : "") + '">' + esc("AUC24 is " + st + " the guideline range " + t.lo + " to " + t.hi + " " + t.unit + (t.label ? " (" + t.label + ")" : "")) + "</div>" + A.srcLine(doc, t); }
      if (n) h += (Array.isArray(n) ? n : [n]).map(function (x) { return A.note(x.label || x.text || "", "info") + A.srcLine(doc, x); }).join("");
      A.setSheet("tdm", { title: "Vancomycin AUC", tag: "Neonatal TDM", lines: ["Baby: " + G.SMD_NEO.summary(), "Result: AUC24 " + r1(r.auc24) + " mg·h/L", "Levels: " + S.c1 + " mg/L at " + S.t1 + " h, " + S.c2 + " mg/L at " + S.t2 + " h; interval " + S.tau + " h; infusion " + S.tin + " h", "ke " + r3(r.ke) + " /h, half-life " + r1(r.half) + " h, Cmax " + r1(r.cmax) + ", Cmin " + r1(r.cmin)] });
    }
    h += "<details><summary>How this is worked out</summary>" + (V.equations || []).map(function (e) { return '<div class="nh-work" style="font-family:inherit"><b>' + esc(e.name) + "</b>" + (e.form ? ": " + esc(e.form) : "") + (e.caveat ? "<br>" + esc(e.caveat) : "") + "</div>" + A.srcLine(doc, e); }).join("") + "</details>";
    ["trough_only", "sampling"].forEach(function (k) { var x = V[k]; if (!x) return; (Array.isArray(x) ? x : [x]).forEach(function (y) { h += A.note(y.label || y.text || "", "info") + A.srcLine(doc, y); }); });
    (V.notes || []).forEach(function (y) { h += A.note(y.text || y.label || "", "info") + A.srcLine(doc, y); });
    return h;
  }
  function gentOut(A, doc) {
    var AE = doc.aminoglycoside_ei || {}, NG = AE.neonatal_gentamicin || {}, esc = A.esc, h = "";
    var rules = (NG.nice || []).filter(function (x) { return x.id === "trough-target"; })[0];
    var g = gentTrough(S.trough, S.doses, rules);
    if (g) { h += '<div class="nh-row"><div class="nh-lbl">Trough</div><div class="nh-val" style="font-size:20px">' + esc(num(S.trough) + " mg/L: " + (g.ok ? "below" : "not below") + " " + g.target + " mg/L") + "</div>" + (g.ok ? "" : '<div class="nh-note">Adjust the dose interval as the source says.</div>') + A.srcLine(doc, rules) + "</div>"; }
    var pk = (NG.nice || []).filter(function (x) { return x.id === "peak-low"; })[0], pv = num(S.peak);
    if (pk && pv != null) h += '<div class="nh-row"><div class="nh-lbl">Peak</div><div class="nh-work" style="font-family:inherit">' + esc(pv < pk.peak_lt.v ? "Below " + pk.peak_lt.v + " mg/L: " + pk.label : "Not below " + pk.peak_lt.v + " mg/L.") + "</div>" + A.srcLine(doc, pk) + "</div>";
    h += "<details open><summary>Neonatal gentamicin monitoring on file</summary>" + (NG.nice || []).concat(NG.fda || []).map(function (x) { return '<div class="nh-work" style="font-family:inherit">' + esc(x.label || "") + "</div>" + A.srcLine(doc, x); }).join("") + "</details>";
    var HF = AE.hartford;
    if (HF) {
      h += "<details><summary>Extended-interval (Hartford): adults, not validated in neonates</summary>" + A.note(HF.label || "", "info");
      if (HF.dose_interval) h += '<div class="nh-work">' + esc((HF.dose_interval.bands || []).map(function (b) { var c = b.crcl_ml_min || {}; return "CrCl " + (c.min != null ? c.min : "") + (c.max != null ? " to " + c.max : " or more") + " mL/min: every " + b.every_h + " h"; }).join("; ")) + "</div>" + A.srcLine(doc, HF.dose_interval);
      if (HF.level_window) h += A.srcLine(doc, HF.level_window);
      if (HF.nomogram_lines_missing) h += A.note("Nomogram lines not on file: " + HF.nomogram_lines_missing, "info");
      h += "</details>";
    }
    A.setSheet("tdm", { title: "Gentamicin levels", tag: "Neonatal TDM", lines: ["Baby: " + G.SMD_NEO.summary()].concat(g ? ["Result: trough " + num(S.trough) + " mg/L, target below " + g.target + " mg/L"] : []) });
    return h;
  }
  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("tdm").then(function (doc) {
      var esc = A.esc;
      function f(k, label, unit) { return '<label>' + label + '<span class="nh-u"><input inputmode="decimal" data-tdm="' + k + '" value="' + esc(S[k]) + '"><span>' + unit + "</span></span></label>"; }
      var h = '<section class="nh-card"><h3>Drug levels ' + (doc ? A.badge(doc) : "") + '</h3><span class="nh-seg" role="group" aria-label="Drug"><button type="button" data-tdm-tab="vanco" aria-pressed="' + (S.tab === "vanco") + '">Vancomycin</button><button type="button" data-tdm-tab="gent" aria-pressed="' + (S.tab === "gent") + '">Gentamicin</button></span>';
      if (!doc) h += A.noData("drug monitoring");
      else if (S.tab === "vanco") h += '<div class="nh-grid">' + f("tau", "Dose every", "h") + f("tin", "Each dose runs over", "h") + f("c1", "First level", "mg/L") + f("t1", "taken at", "h") + f("c2", "Second level", "mg/L") + f("t2", "taken at", "h") + '</div><div class="nh-work">"Taken at" means hours after that dose started running.</div>';
      else h += '<div class="nh-grid">' + f("trough", "Trough (level just before a dose)", "mg/L") + f("doses", "Doses given so far", "") + f("peak", "Peak (level after a dose)", "mg/L") + "</div>";
      h += '<div data-tdm-out="1"></div>' + A.actionsHtml("tdm") + "</section>";
      el.innerHTML = h;
      function paint() { var o = el.querySelector("[data-tdm-out]"); if (o && doc) o.innerHTML = S.tab === "vanco" ? vancoOut(A, doc) : gentOut(A, doc); }
      paint();
      el.oninput = function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-tdm"); if (!k) return; S[k] = e.target.value; paint(); };
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-tdm-tab]"); if (b) { S.tab = b.getAttribute("data-tdm-tab"); screen(el, A); } };
    });
  }
  G.SMD_NEO_TDM = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "tdm", flag: "tdm", order: 10, icon: "science", title: "Drug levels", sub: "Vancomycin AUC, gentamicin", kw: "tdm therapeutic drug monitoring vancomycin auc trough peak gentamicin aminoglycoside hartford extended interval level", render: screen });
})(typeof window !== "undefined" ? window : globalThis);
