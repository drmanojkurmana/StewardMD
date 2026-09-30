/* StewardMD - bilirubin plotter (window.SMD_NEO_BILI). Phase 6, flags smd_neo + smd_neo_bili.
 *
 * Hour-specific treatment thresholds from data/neo/bili.json, plotted with the baby's TSB:
 *   AAP 2022 (35 weeks or more, mg/dL): phototherapy and exchange by gestation week, with or without
 *     neurotoxicity risk factors (Supplemental Tables, one value per hour of life); escalation of care =
 *     exchange minus 2 mg/dL, as the source defines it.
 *   NICE CG98 (all gestations, micromol/L): 38 weeks or more from the 6-hourly table (values between
 *     the published hours read as a straight line); 23 to 37 weeks drawn from the construction rule the
 *     guideline states (straight line from the birth value to the formula value at 72 hours, then the
 *     formula: phototherapy GA x 10 - 100, exchange GA x 10).
 * Unit lock: each guideline is used in its own unit; the app never converts mg/dL and micromol/L.
 * Links to the Knowledge Library protocol "neonatal-jaundice". The engine is pure and exported.
 */
(function (G) {
  "use strict";
  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function PE() { return G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine); }

  /* AAP: value at a whole hour of life from a day x h0..h23 table; past the table, the last value. */
  function aapAt(curve, hours) {
    var t = curve.data.table, h = Math.floor(hours), day = Math.floor(h / 24), col = h % 24;
    var row = null; t.forEach(function (r) { if (r[0] === day) row = r; });
    if (!row) { var last = t[t.length - 1]; for (var i = last.length - 1; i > 0; i--) if (last[i] != null) return { v: last[i], beyond: true }; return null; }
    var v = row[col + 1];
    return v == null ? null : { v: v };
  }
  function aapCurve(doc, set, anyRisk, gaWk) {
    var E = PE(), want = anyRisk ? "any" : "none", hit = null;
    ((doc && doc.aap && doc.aap.curves) || []).forEach(function (c) {
      if (c.set !== set || c.neurotoxicity_risk !== want) return;
      if (E.matches(c.when, { ga_wk: gaWk }).ok === true) hit = c;
    });
    return hit;
  }
  /* NICE 38 weeks or more: straight line between the published 6-hourly points; the last row applies onward. */
  function niceTermAt(doc, key, hours) {
    var T = doc.nice.term.data, ci = T.columns.indexOf(key), rows = T.table;
    if (hours >= rows[rows.length - 1][0]) return rows[rows.length - 1][ci];
    for (var i = 0; i < rows.length - 1; i++) {
      var a = rows[i], b = rows[i + 1];
      if (hours >= a[0] && hours <= b[0]) return a[ci] + (b[ci] - a[ci]) * (hours - a[0]) / (b[0] - a[0]);
    }
    return null;
  }
  function nicePretermAt(doc, which, gaWk, hours) {
    var p = doc.nice.preterm[which]; if (!p) return null;
    var atFrom = which === "phototherapy" ? gaWk * p.ga_multiplier - p.minus : gaWk * p.ga_multiplier;
    if (hours >= p.from_h) return atFrom;
    return p.before.at_birth + (atFrom - p.before.at_birth) * hours / p.from_h;
  }
  /* One call for the plotter: { unit, photo, escalation, exchange, notes } at an hour, or { na }. */
  function thresholds(doc, guide, gaWk, hours, anyRisk) {
    if (guide === "aap") {
      if (gaWk == null || gaWk < 35) return { na: "The AAP 2022 curves cover 35 weeks or more. Use NICE." };
      var pc = aapCurve(doc, "phototherapy", anyRisk, gaWk), ec = aapCurve(doc, "exchange", anyRisk, gaWk);
      if (!pc || !ec) return { na: "No AAP curve on file for this gestation and risk." };
      var p = aapAt(pc, hours), e = aapAt(ec, hours), esc = (doc.aap.rules || []).filter(function (r) { return r.id === "escalation"; })[0];
      return { unit: pc.unit, photo: p && p.v, exchange: e && e.v, escalation: e && esc ? Math.round((e.v - esc.below_exchange) * 10) / 10 : null, beyond: !!(p && p.beyond), curves: [pc, ec], escRule: esc };
    }
    if (gaWk == null) return { na: "Enter gestation at birth." };
    var N = doc.nice;
    if (PE().matches(N.term.when, { ga_wk: gaWk }).ok === true) return { unit: N.term.unit, photo: niceTermAt(doc, "phototherapy_gt", hours), exchange: niceTermAt(doc, "exchange_gt", hours), gt: true, src: N.term };
    if (PE().matches(N.preterm.when, { ga_wk: gaWk }).ok === true) return { unit: N.preterm.unit, photo: nicePretermAt(doc, "phototherapy", gaWk, hours), exchange: nicePretermAt(doc, "exchange", gaWk, hours), gt: true, src: N.preterm, drawn: true };
    return { na: "No NICE threshold on file for this gestation." };
  }
  var ENGINE = { aapAt: aapAt, aapCurve: aapCurve, niceTermAt: niceTermAt, nicePretermAt: nicePretermAt, thresholds: thresholds };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  var S = { guide: "aap", tsb: "", hours: "", rf: {} };
  function r1(v) { return v == null ? "" : (Math.round(v * 10) / 10).toString(); }
  function plot(doc, gaWk, anyRisk, pt) {
    var maxH = S.guide === "aap" ? 168 : 120, W = 320, H = 200, pl = 34, pb = 22, pr = 8, ptop = 8;
    var series = [["photo", "#0f766e"], ["escalation", "#b7791f"], ["exchange", "#b42318"]], pts = { photo: [], escalation: [], exchange: [] }, ymax = 0;
    for (var h = 0; h <= maxH; h += 2) { var t = thresholds(doc, S.guide, gaWk, h, anyRisk); if (t.na) return ""; series.forEach(function (s) { var v = t[s[0]]; if (v != null) { pts[s[0]].push([h, v]); if (v > ymax) ymax = v; } }); }
    if (pt && pt.v > ymax) ymax = pt.v; ymax = Math.ceil(ymax * 1.1);
    var X = function (h) { return pl + (W - pl - pr) * h / maxH; }, Y = function (v) { return ptop + (H - ptop - pb) * (1 - v / ymax); };
    var g = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Bilirubin thresholds by age in hours" style="width:100%;font:10px -apple-system,system-ui,sans-serif">';
    for (var gy = 0; gy <= 4; gy++) { var v = ymax * gy / 4; g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="currentColor" stroke-opacity=".12"/><text x="' + (pl - 4) + '" y="' + (Y(v) + 3) + '" text-anchor="end" fill="currentColor" fill-opacity=".6">' + Math.round(v) + "</text>"; }
    for (var gx = 0; gx <= maxH; gx += 24) g += '<text x="' + X(gx) + '" y="' + (H - 6) + '" text-anchor="middle" fill="currentColor" fill-opacity=".6">' + gx + "</text>";
    series.forEach(function (s) { var p = pts[s[0]]; if (p.length) g += '<polyline fill="none" stroke="' + s[1] + '" stroke-width="2" ' + (s[0] === "escalation" ? 'stroke-dasharray="4 3" ' : "") + 'points="' + p.map(function (q) { return X(q[0]).toFixed(1) + "," + Y(q[1]).toFixed(1); }).join(" ") + '"/>'; });
    if (pt && pt.h <= maxH) g += '<circle cx="' + X(pt.h) + '" cy="' + Y(pt.v) + '" r="5" fill="#2563eb" stroke="#fff" stroke-width="1.5"/>';
    return g + "</svg>" + '<div class="nh-work"><span style="color:#0f766e">Phototherapy</span> · ' + (S.guide === "aap" ? '<span style="color:#b7791f">Escalation</span> · ' : "") + '<span style="color:#b42318">Exchange</span> · <span style="color:#2563eb">Baby</span> · x: hours of life</div>';
  }
  function out(A, doc, d) {
    var esc = A.esc, gaWk = d.gaDays != null ? Math.floor(d.gaDays / 7) : null;
    var hours = num(S.hours) != null ? num(S.hours) : d.pnaHours, tsb = num(S.tsb);
    var rfs = (doc.aap && doc.aap.risk_factors && doc.aap.risk_factors.items) || [];
    var anyRisk = rfs.some(function (r) { if (r.ga_wk) return gaWk != null && PE().matches({ ga_wk: r.ga_wk }, { ga_wk: gaWk }).ok === true; return !!S.rf[r.id]; });
    if (hours == null) return A.note("Enter the date and time of birth, or the age in hours.");
    var t = thresholds(doc, S.guide, gaWk, hours, anyRisk), h = "", lines = [];
    if (t.na) return A.note(t.na, "info");
    var unit = t.unit;
    h += '<div class="nh-work">' + esc("At " + Math.floor(hours) + " h" + (S.guide === "aap" ? ", GA " + gaWk + " wk, " + (anyRisk ? "with" : "no") + " neurotoxicity risk factor" : ", GA " + gaWk + " wk")) + "</div>";
    var rows = [["Phototherapy", t.photo], ["Escalation of care", t.escalation], ["Exchange transfusion", t.exchange]].filter(function (r) { return r[1] != null; });
    h += '<table class="nh-tbl"><tr><th>Threshold</th><th>' + esc(unit) + "</th><th>Baby</th></tr>" + rows.map(function (r) {
      // AAP: at or above the threshold; NICE prints ">value": above it.
      var hitR = tsb != null && (t.gt ? tsb > r[1] : tsb >= r[1]);
      var st = tsb == null ? "" : hitR ? (t.gt ? "above" : "at or above") : (t.gt ? "not above" : "below");
      return '<tr class="' + (hitR ? "hit" : "") + '"><td>' + esc(r[0]) + "</td><td>" + esc(r1(r[1])) + "</td><td>" + esc(st + (tsb != null ? " (" + r1(tsb - r[1]) + ")" : "")) + "</td></tr>";
    }).join("") + "</table>";
    if (t.beyond) h += A.note("Age is past the published table; the last published value is used.", "info");
    if (t.drawn) h += A.note("Below 38 weeks NICE publishes graphs; this line is drawn from the guideline's stated construction rule.", "info");
    if (tsb != null) {
      var worst = t.exchange != null && (t.gt ? tsb > t.exchange : tsb >= t.exchange) ? "Exchange transfusion threshold reached" : t.escalation != null && tsb >= t.escalation ? "Escalation-of-care threshold reached" : t.photo != null && (t.gt ? tsb > t.photo : tsb >= t.photo) ? "Phototherapy threshold reached" : "Below the phototherapy threshold";
      h += '<div class="nh-note' + (/Exchange|Escalation/.test(worst) ? " bad" : /Phototherapy/.test(worst) ? "" : " info") + '">' + esc(worst) + "</div>";
      lines.push("Result: TSB " + tsb + " " + unit + " at " + Math.floor(hours) + " h: " + worst);
    }
    h += plot(doc, gaWk, anyRisk, tsb != null ? { h: hours, v: tsb } : null);
    if (S.guide === "aap") { (t.curves || []).forEach(function (c) { h += A.srcLine(doc, c); }); if (t.escRule) h += A.srcLine(doc, t.escRule); h += A.srcLine(doc, doc.aap.risk_factors); }
    else { h += A.srcLine(doc, t.src); if (t.src && t.src.phototherapy) h += A.srcLine(doc, t.src.phototherapy) + A.srcLine(doc, t.src.phototherapy.before) + A.srcLine(doc, t.src.exchange) + A.srcLine(doc, t.src.exchange.before); }
    var rules = S.guide === "aap" ? doc.aap.rules : doc.nice.rules;
    h += "<details><summary>Rules in the source</summary>" + (rules || []).map(function (r) { return r.text ? '<div class="nh-work" style="font-family:inherit">' + esc(r.text) + "</div>" + A.srcLine(doc, r) : ""; }).join("") + "</details>";
    A.setSheet("bili", { title: "Bilirubin (" + (S.guide === "aap" ? "AAP 2022" : "NICE CG98") + ")", tag: "Neonatal bilirubin", lines: ["Baby: " + G.SMD_NEO.summary()].concat(rows.map(function (r) { return r[0] + ": " + r1(r[1]) + " " + unit; }), lines) });
    return h;
  }
  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("bili").then(function (doc) {
      var esc = A.esc, d = A.neo();
      if (!doc) { el.innerHTML = '<section class="nh-card"><h3>Bilirubin</h3>' + A.noData("bilirubin thresholds") + "</section>"; return; }
      var unit = S.guide === "aap" ? "mg/dL" : "micromol/L", rfs = (doc.aap && doc.aap.risk_factors && doc.aap.risk_factors.items) || [];
      el.innerHTML = '<section class="nh-card"><h3>Bilirubin ' + A.badge(doc) + '</h3><span class="nh-seg" role="group" aria-label="Guideline"><button type="button" data-bili-g="aap" aria-pressed="' + (S.guide === "aap") + '">AAP 2022 (35+ wk)</button><button type="button" data-bili-g="nice" aria-pressed="' + (S.guide === "nice") + '">NICE CG98</button></span>' +
        '<div class="nh-grid"><label>TSB<span class="nh-u"><input inputmode="decimal" data-bili="tsb" value="' + esc(S.tsb) + '"><span>' + esc(unit) + '</span></span></label><label>Age<span class="nh-u"><input inputmode="decimal" data-bili="hours" value="' + esc(S.hours) + '" placeholder="' + esc(d.pnaHours != null ? d.pnaHours + " (record)" : "") + '"><span>hours</span></span></label></div>' +
        (S.guide === "aap" ? '<div class="nh-work" style="font-family:inherit">Neurotoxicity risk factors:</div>' + rfs.map(function (r) { if (r.ga_wk) return '<div class="nh-work">' + esc(r.label + " (from the baby record)") + "</div>"; return '<label class="nh-2cl" style="flex-direction:row"><input type="checkbox" data-bili-rf="' + esc(r.id) + '"' + (S.rf[r.id] ? " checked" : "") + "> " + esc(r.label) + "</label>"; }).join("") : "") +
        '<div class="nh-work">Unit lock: AAP in mg/dL, NICE in micromol/L. The app does not convert between them.</div>' +
        '<div data-bili-out="1"></div>' + A.actionsHtml("bili") + '<button type="button" class="nh-li" data-bili-proto="' + esc(doc.protocol || "neonatal-jaundice") + '"><span>Neonatal jaundice protocol</span><small>Knowledge Library</small></button></section>';
      function paint() { var o = el.querySelector("[data-bili-out]"); if (o) o.innerHTML = out(A, doc, A.neo()); }
      paint();
      el.oninput = el.onchange = function (e) { var t = e.target; var k = t.getAttribute && t.getAttribute("data-bili"); var rf = t.getAttribute && t.getAttribute("data-bili-rf"); if (k) S[k] = t.value; else if (rf) S.rf[rf] = t.checked; else return; paint(); };
      el.onclick = function (e) {
        var g = e.target.closest && e.target.closest("[data-bili-g]"); if (g) { S.guide = g.getAttribute("data-bili-g"); S.tsb = ""; screen(el, A); return; }
        var p = e.target.closest && e.target.closest("[data-bili-proto]"); if (p) { var P = G.SMD_KBPROTO; if (P && P.open) { G.SMD_NEO_HUB.close(); P.open({ id: p.getAttribute("data-bili-proto") }); } else A.toast("Knowledge Library loading…"); }
      };
    });
  }
  G.SMD_NEO_BILI = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "bili", flag: "bili", order: 6, icon: "light_mode", title: "Bilirubin", sub: "AAP 2022 and NICE curves", kw: "bilirubin jaundice phototherapy exchange transfusion tsb hyperbilirubinemia aap nice", render: screen, onRecord: function (el, A) { var o = el.querySelector("[data-bili-out]"); if (o) screen(el, A); } });
})(typeof window !== "undefined" ? window : globalThis);
