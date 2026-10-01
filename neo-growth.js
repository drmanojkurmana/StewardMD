/* StewardMD - neonatal growth (window.SMD_NEO_GROWTH). Phase 5, flags smd_neo + smd_neo_growth.
 *
 *   Size at birth   INTERGROWTH-21st Very Preterm Size at Birth (24+0 to 32+6) and Newborn Size
 *                   Standards (33+0 to 42+6), by exact GA in weeks + days and sex.
 *   Preterm growth  INTERGROWTH-21st Postnatal Growth Standards for preterm infants, by PMA (27 to 64 wk).
 *   WHO 0 to 5 y    the app's existing WHO engine (specialty-kits.js SMD_KITS._growth, kb/growth/who-growth.json),
 *                   by chronological or corrected age.
 *   Velocity        g/kg/day, two-point average model (Patel 2009, quoted). The exponential model is shown
 *                   as text only: its authors restrict it to research use without a licence.
 *   Milestones      CDC "Learn the Signs. Act Early." (public domain), by corrected age.
 *   Reflexes        primitive reflexes (StatPearls and open papers).
 * INTERGROWTH tables give the measurement at z = -3..+3 (data/neo/growth-preterm.json). Reading a
 * z-score between those columns is linear interpolation, and between two whole PMA weeks the row values
 * are interpolated by day; both are this app's reading of the published tables, not a published formula,
 * and the screen says so. Weights are entered in grams and converted to kg for the tables.
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  var ZCOLS = ["z_minus3", "z_minus2", "z_minus1", "z_0", "z_plus1", "z_plus2", "z_plus3"];

  /* The 7 values at z -3..+3 from a table row (by column name). */
  function zVals(block, row) { return ZCOLS.map(function (c) { return row[block.columns.indexOf(c)]; }); }
  function zFrom(vals, x) {
    if (x == null || !vals || vals.some(function (v) { return v == null; })) return null;
    if (x < vals[0]) return { z: null, below: true, text: "below -3 SD" };
    if (x > vals[6]) return { z: null, above: true, text: "above +3 SD" };
    for (var i = 0; i < 6; i++) if (x <= vals[i + 1]) { var f = (x - vals[i]) / (vals[i + 1] - vals[i] || 1); return { z: i - 3 + f }; }
    return { z: 3 };
  }
  function centile(z) {                       // standard normal CDF (Abramowitz and Stegun 7.1.26)
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + y) / 2 * 100 : (1 - y) / 2 * 100;
  }
  /* Size at birth: GA in days, sex "male"|"female", measure "weight"|"length"|"hc", x in the table's unit. */
  function atBirth(doc, gaDays, sex, measure, x) {
    var w = Math.floor(gaDays / 7), d = gaDays % 7, charts = (doc && doc.charts) || [];
    for (var i = 0; i < charts.length; i++) {
      var c = charts[i]; if (c.x !== "ga_at_birth") continue;
      var b = c.sexes && c.sexes[sex] && c.sexes[sex][measure]; if (!b) continue;
      var iw = b.columns.indexOf("ga_wk"), id = b.columns.indexOf("ga_d");
      for (var j = 0; j < b.table.length; j++) { var r = b.table[j]; if (r[iw] === w && r[id] === d) { var zr = zFrom(zVals(b, r), x); return zr ? { chart: c, block: b, row: r, z: zr.z, text: zr.text, below: !!zr.below, above: !!zr.above, unit: b.unit } : null; } }
    }
    return { outOfRange: true };
  }
  /* Postnatal preterm: PMA in days. Rows are whole weeks; between two rows the values are interpolated by day. */
  function postnatal(doc, pmaDays, sex, measure, x) {
    var charts = (doc && doc.charts) || [], c = null;
    charts.forEach(function (k) { if (k.x === "pma") c = k; });
    var b = c && c.sexes && c.sexes[sex] && c.sexes[sex][measure]; if (!b) return { outOfRange: true };
    var ip = b.columns.indexOf("pma_wk"), wk = pmaDays / 7, lo = null, hi = null;
    b.table.forEach(function (r) { if (r[ip] <= wk && (!lo || r[ip] > lo[ip])) lo = r; if (r[ip] >= wk && (!hi || r[ip] < hi[ip])) hi = r; });
    if (!lo || !hi) return { outOfRange: true, chart: c };
    var va = zVals(b, lo), vb = zVals(b, hi), f = hi[ip] === lo[ip] ? 0 : (wk - lo[ip]) / (hi[ip] - lo[ip]);
    var vals = va.map(function (v, i) { return v + f * (vb[i] - v); });
    var zr = zFrom(vals, x);
    return zr ? { chart: c, block: b, z: zr.z, text: zr.text, below: !!zr.below, above: !!zr.above, unit: b.unit, interpolated: f > 0 && f < 1 } : null;
  }
  /* Two-point average growth velocity (g/kg/day), Patel 2009: 1000 x (Wn - W1) / ((Dn - D1) x (Wn + W1)/2). */
  function velocity2pt(w1, wn, d1, dn) {
    w1 = num(w1); wn = num(wn); d1 = num(d1); dn = num(dn);
    if (!(w1 > 0) || !(wn > 0) || d1 == null || dn == null || !(dn > d1)) return null;
    return 1000 * (wn - w1) / ((dn - d1) * ((wn + w1) / 2));
  }
  function ageMonthsOf(age) { if (!age) return null; var u = String(age.unit || "").toLowerCase(); return /month/.test(u) ? age.v : /year/.test(u) ? age.v * 12 : null; }
  /* The milestone age at or below a corrected age in months, and the next one. */
  function milestonesFor(doc, months) {
    var ages = ((doc && doc.ages) || []).slice().sort(function (a, b) { return ageMonthsOf(a.age) - ageMonthsOf(b.age); });
    var cur = null, next = null;
    ages.forEach(function (a) { var m = ageMonthsOf(a.age); if (m <= months + 1e-9) cur = a; else if (!next) next = a; });
    return { current: cur, next: next };
  }
  var ENGINE = { zFrom: zFrom, centile: centile, atBirth: atBirth, postnatal: postnatal, velocity2pt: velocity2pt, milestonesFor: milestonesFor, ageMonthsOf: ageMonthsOf };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  var S = { tab: "birth", len: "", hc: "", w1: "", d1: "", wn: "", dn: "", useCorrected: true };
  var WHO = null;
  function r1(v) { return v == null ? "" : (Math.round(v * 10) / 10).toFixed(1); }
  function r2(v) { return v == null ? "" : (Math.round(v * 100) / 100).toFixed(2); }
  function sexKey(d) { return d.sex === "M" ? "male" : d.sex === "F" ? "female" : null; }
  function zRow(A, label, res, xText) {
    if (!res) return "";
    if (res.outOfRange) return '<div class="nh-work">' + A.esc(label + ": outside the chart's age range") + "</div>";
    var zt = res.z != null ? "z " + r2(res.z) + " (" + r1(centile(res.z)) + "th centile)" : res.text;
    return '<div class="nh-row"><div class="nh-lbl">' + A.esc(label) + '</div><div class="nh-val" style="font-size:20px">' + A.esc(zt) + '</div><div class="nh-work">' + A.esc(xText + " on " + (res.chart ? res.chart.name : "")) + (res.interpolated ? A.esc(" (between whole PMA weeks: row values interpolated by day)") : "") + "</div></div>";
  }
  function birthOut(A, doc, d) {
    var sx = sexKey(d); if (!sx) return A.note("Choose Boy or Girl in the baby details at the top.");
    if (d.gaDays == null) return A.note("Add the weeks of pregnancy at birth in the baby details at the top.");
    var h = "", bw = d.birthWeightG, lines = [];
    if (bw != null) { var r = atBirth(doc, d.gaDays, sx, "weight", bw / 1000); h += zRow(A, "Birth weight", r, bw + " g"); if (r && r.z != null) lines.push("Result: birth weight z " + r2(r.z)); }
    else h += A.note("Add the birth weight in the baby details at the top.", "info");
    if (num(S.len) != null) h += zRow(A, "Length at birth", atBirth(doc, d.gaDays, sx, "length", num(S.len)), num(S.len) + " cm");
    if (num(S.hc) != null) h += zRow(A, "Head circumference at birth", atBirth(doc, d.gaDays, sx, "hc", num(S.hc)), num(S.hc) + " cm");
    var ch = null; (doc.charts || []).forEach(function (c) { var b = c.sexes && c.sexes[sx] && c.sexes[sx].weight; if (c.x === "ga_at_birth" && b) { var iw = b.columns.indexOf("ga_wk"); if (b.table.some(function (r) { return r[iw] === Math.floor(d.gaDays / 7); })) ch = c; } });
    if (ch && ch.note) h += A.srcLine(doc, ch.note);
    A.setSheet("gr", { title: "Size at birth", tag: "Neonatal growth", lines: ["Baby: " + G.SMD_NEO.summary()].concat(lines) });
    return h;
  }
  function pnOut(A, doc, d) {
    var sx = sexKey(d); if (!sx) return A.note("Choose Boy or Girl in the baby details at the top.");
    if (d.pmaDays == null) return A.note("Enter gestation and date of birth for PMA.");
    var h = "";
    if (d.weightG != null) h += zRow(A, "Weight", postnatal(doc, d.pmaDays, sx, "weight", d.weightG / 1000), d.weightG + " g");
    if (num(S.len) != null) h += zRow(A, "Length", postnatal(doc, d.pmaDays, sx, "length", num(S.len)), num(S.len) + " cm");
    if (num(S.hc) != null) h += zRow(A, "Head circumference", postnatal(doc, d.pmaDays, sx, "hc", num(S.hc)), num(S.hc) + " cm");
    return h || A.note("Enter weight, length or head circumference.", "info");
  }
  function whoOut(A, d) {
    var K = G.SMD_KITS; if (!K || !K._growth) return A.noData("the WHO growth engine");
    if (!WHO) return '<div class="nh-none">Loading WHO tables…</div>';
    if (!d.sex || d.pnaDays == null) return A.note("Add Boy or Girl and the date of birth in the baby details at the top.");
    var ageDays = d.pnaDays, usedCorr = false;
    if (S.useCorrected && d.corrected && !d.corrected.beforeTerm) { ageDays = d.corrected.days; usedCorr = true; }
    else if (S.useCorrected && d.corrected && d.corrected.beforeTerm) return A.note("Before term: use the preterm postnatal chart (PMA) instead of WHO.", "info");
    var r = K._growth(WHO, { sex: d.sex === "M" ? 1 : 2, ageDays: ageDays, weight: d.weightG != null ? d.weightG / 1000 : null, lenhei: num(S.len), measured: "l", hc: num(S.hc) });
    var h = '<div class="nh-work">' + A.esc("Age used: " + ageDays + " days (" + (usedCorr ? "corrected" : "chronological") + ")") + "</div>";
    (r.notes || []).forEach(function (n) { h += A.note(n, "info"); });
    (r.rows || []).forEach(function (x) { h += '<div class="nh-row"><div class="nh-lbl">' + A.esc(x.label) + '</div><div class="nh-val" style="font-size:20px">z ' + A.esc(String(x.z)) + " (" + A.esc(String(x.pct)) + 'th centile)</div><div class="nh-work">' + A.esc(x.cls) + "</div></div>"; });
    return h + '<div class="nh-work">WHO Child Growth Standards (the app\'s existing WHO tables).</div>';
  }
  function velOut(A, doc) {
    var v = doc.velocity || {}, g = velocity2pt(S.w1, S.wn, S.d1, S.dn), h = "";
    if (g == null) h += A.note("Enter two weights (g) and the days they were taken.", "info");
    else { h += '<div class="nh-row"><div class="nh-lbl">Growth velocity</div><div class="nh-val">' + r1(g) + ' g/kg/day</div><div class="nh-work">' + A.esc("1000 x (" + S.wn + " - " + S.w1 + ") / ((" + S.dn + " - " + S.d1 + ") x (" + S.wn + " + " + S.w1 + ")/2)") + "</div></div>"; A.setSheet("gr", { title: "Growth velocity", tag: "Neonatal growth", lines: ["Result: " + r1(g) + " g/kg/day (two-point average model)"] }); }
    if (v.two_point) h += '<div class="nh-work">Two-point average model: ' + A.esc(v.two_point.formula) + "</div>" + A.srcLine(doc, v.two_point);
    if (v.target) h += '<div class="nh-work">' + A.esc("Example rate the authors compare against: " + v.target.v + " " + v.target.unit + " (" + (v.target.text || "") + ")") + "</div>" + A.srcLine(doc, v.target);
    if (v.exponential) h += A.note("The exponential model (" + v.exponential.formula + ") is not calculated here: its authors permit research use only without a licence.", "info") + A.srcLine(doc, v.exponential);
    return h;
  }
  function msOut(A, doc, d) {
    if (!doc) return A.noData("milestones");
    var months = null, how = "";
    if (d.pnaDays != null) {
      if (d.corrected && !d.corrected.beforeTerm) { months = d.corrected.days / (365.25 / 12); how = "corrected age"; }
      else if (d.corrected && d.corrected.beforeTerm) { months = 0; how = "before term"; }
      else { months = d.pnaDays / (365.25 / 12); how = "age"; }
    }
    var h = "", pick = months != null ? milestonesFor(doc, months) : { current: null, next: null };
    if (months != null) h += '<div class="nh-work">' + A.esc("By " + how + ": " + (Math.round(months * 10) / 10) + " months") + "</div>";
    function block(a, title) { if (!a) return ""; return '<div class="nh-row"><div class="nh-lbl">' + A.esc(title + ": " + a.label) + "</div>" + (a.domains || []).map(function (dm) { return '<div class="nh-work" style="font-family:inherit"><b>' + A.esc(dm.heading) + "</b><br>" + (dm.items || []).map(A.esc).join("<br>") + "</div>"; }).join("") + A.srcLine(doc, a) + "</div>"; }
    h += block(pick.current, "Should have") + block(pick.next, "Next");
    if (!pick.current && !pick.next) h += "<details><summary>All ages</summary>" + (doc.ages || []).map(function (a) { return block(a, "Age"); }).join("") + "</details>";
    (doc.notes || []).forEach(function (n) { if (n.text) h += A.note(n.text, "info") + A.srcLine(doc, n); });
    return h;
  }
  function rxOut(A, doc) {
    if (!doc) return A.noData("primitive reflexes");
    function part(t, x) { if (!x) return ""; var txt = x.text || x.quote || ""; return '<div class="nh-work" style="font-family:inherit"><b>' + A.esc(t) + ":</b> " + A.esc(txt) + "</div>" + A.srcLine(doc, x); }
    return (doc.reflexes || []).map(function (r) {
      return "<details class=\"nh-row\"><summary><b>" + A.esc(r.name) + "</b></summary>" + part("Elicit", r.elicit) + part("Response", r.response) + part("Appears", r.appears) + part("Disappears", r.disappears) + part("Abnormal", r.abnormal) + ((r.alt || []).length ? "<details><summary>Other sources disagree</summary>" + r.alt.map(function (a) { return part(a.topic || "Also", a); }).join("") + "</details>" : "") + "</details>";
    }).join("") + ((doc.missing || []).length ? A.note("Not on file: " + doc.missing.map(function (m) { return m.name || m; }).join(", "), "info") : "");
  }

  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    Promise.all([A.dataOrNull("growth-preterm"), A.dataOrNull("milestones"), A.dataOrNull("reflexes")]).then(function (fs) {
      var gp = fs[0], ms = fs[1], rx = fs[2], d = A.neo(), esc = A.esc;
      var tabs = [["birth", "Size at birth"], ["pn", "Preterm chart"], ["who", "Chart 0 to 5 years"], ["vel", "Weight gain"], ["ms", "Milestones"], ["rx", "Reflexes"]];
      var inputs = (S.tab === "birth" || S.tab === "pn" || S.tab === "who") ? '<div class="nh-grid"><label>Length<span class="nh-u"><input inputmode="decimal" data-gr="len" value="' + esc(S.len) + '"><span>cm</span></span></label><label>Head size (around)<span class="nh-u"><input inputmode="decimal" data-gr="hc" value="' + esc(S.hc) + '"><span>cm</span></span></label></div>' +
        (S.tab === "who" ? '<label class="nh-2cl" style="flex-direction:row"><input type="checkbox" data-gr="useCorrected"' + (S.useCorrected ? " checked" : "") + "> Use corrected age (for a baby born early)</label>" : "") + '<div class="nh-work">Weight comes from the baby details at the top (grams).</div>' :
        S.tab === "vel" ? '<div class="nh-grid"><label>First weight<span class="nh-u"><input inputmode="decimal" data-gr="w1" value="' + esc(S.w1) + '"><span>g</span></span></label><label>on day<span class="nh-u"><input inputmode="numeric" data-gr="d1" value="' + esc(S.d1) + '"></span></label><label>Latest weight<span class="nh-u"><input inputmode="decimal" data-gr="wn" value="' + esc(S.wn) + '"><span>g</span></span></label><label>on day<span class="nh-u"><input inputmode="numeric" data-gr="dn" value="' + esc(S.dn) + '"></span></label></div>' : "";
      el.innerHTML = '<section class="nh-card"><h3>Growth ' + (gp ? A.badge(gp) : "") + '</h3><div class="nh-tabs" role="group" aria-label="Growth tool">' + tabs.map(function (t) { return '<button type="button" data-gr-tab="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>" + inputs + '<div data-gr-out="1"></div>' + (S.tab === "birth" || S.tab === "vel" ? A.actionsHtml("gr") : "") +
        (S.tab === "birth" || S.tab === "pn" ? '<div class="nh-foot">Centiles between the published columns are read in a straight line between them (this app\'s method).</div>' : "") + "</section>";
      function paint() {
        d = A.neo(); var o = el.querySelector("[data-gr-out]");
        o.innerHTML = S.tab === "birth" ? (gp ? birthOut(A, gp, d) : A.noData("a preterm size chart")) : S.tab === "pn" ? (gp ? pnOut(A, gp, d) : A.noData("a preterm growth chart")) : S.tab === "who" ? whoOut(A, d) : S.tab === "vel" ? (gp ? velOut(A, gp) : A.noData("growth velocity")) : S.tab === "ms" ? msOut(A, ms, d) : rxOut(A, rx);
      }
      paint();
      if (S.tab === "who" && !WHO) fetch("/kb/growth/who-growth.json?v=" + ((G.SMD_KITS && G.SMD_KITS.GROWTH_V) || "g1")).then(function (r) { return r.json(); }).then(function (j) { WHO = j; paint(); }, function () { var o = el.querySelector("[data-gr-out]"); if (o) o.innerHTML = A.noData("WHO growth tables"); });
      el.oninput = el.onchange = function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-gr"); if (!k) return; S[k] = e.target.type === "checkbox" ? e.target.checked : e.target.value; paint(); };
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-gr-tab]"); if (b) { S.tab = b.getAttribute("data-gr-tab"); screen(el, A); } };
    });
  }
  G.SMD_NEO_GROWTH = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "growth", flag: "growth", order: 5, icon: "monitoring", title: "Growth", sub: "Centiles, velocity, milestones", kw: "growth centile percentile z score intergrowth who weight length head circumference velocity milestones reflexes moro", render: screen });
})(typeof window !== "undefined" ? window : globalThis);
