/* StewardMD - neonatal fluids and GIR (window.SMD_NEO_FLUIDS). Phase 4, flags smd_neo + smd_neo_fluids.
 *
 * Three tools on one screen, all reading the baby record:
 *   GIR          glucose infusion rate (mg/kg/min) from rate (mL/h), dextrose % and weight.
 *   Volumes      day-of-life fluid volume bands (mL/kg/day) from data/neo/fluids.json, quoted.
 *   Bag builder  target GIR + total fluid volume -> dextrose % needed, then how to mix it from two stock
 *                dextrose solutions (D50 + sterile water for units without D10 / D12.5, or D10 + D50),
 *                with Na / K / Ca additives taking their share of the bag.
 * GIR arithmetic is unit conversion only: mL/h x (g per 100 mL) x 1000 mg/g / 60 min/h / kg, i.e.
 * rate x % / (6 x kg); the formula as the source writes it is shown with its quote. Electrolyte stock
 * strengths are whatever the unit stocks: they are typed in, never defaulted.
 * GIR and day-of-life volume also register as calculators in calculators.js (category Neonatology).
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }

  function gir(rateMlH, dexPct, wKg) {
    var r = num(rateMlH), p = num(dexPct), w = num(wKg);
    if (!(r >= 0) || !(p >= 0) || !(w > 0)) return null;
    return r * p * 10 / (60 * w);          // mg/kg/min
  }
  /* The dextrose % that gives a target GIR at a rate. */
  function pctFor(targetGir, rateMlH, wKg) {
    var g = num(targetGir), r = num(rateMlH), w = num(wKg);
    if (!(g >= 0) || !(r > 0) || !(w > 0)) return null;
    return g * 60 * w / (r * 10);
  }
  /* Mix `volMl` of `pct` % dextrose from a high and a low stock, leaving `addMl` for additives.
   * Returns { hi, lo } mL or { error }. Sterile water is a low stock of 0 %. */
  function mix(pct, volMl, hiPct, loPct, addMl) {
    var P = num(pct), V = num(volMl), H = num(hiPct), L = num(loPct), A = num(addMl) || 0;
    if (P == null || !(V > 0) || H == null || L == null) return null;
    var free = V - A;
    if (free <= 0) return { error: "The additives fill the whole bag." };
    if (H <= L) return { error: "The high stock must be stronger than the low stock." };
    // hi*H + lo*L = P*V (grams x 100), hi + lo = free
    var hi = (P * V - L * free) / (H - L), lo = free - hi;
    if (hi < -1e-9) return { error: "The low stock alone is stronger than " + Math.round(P * 100) / 100 + "% in this volume. Use a weaker low stock." };
    if (lo < -1e-9) return { error: Math.round(P * 100) / 100 + "% cannot be reached with these stocks in this volume (needs more than the high stock gives)." };
    return { hi: Math.max(0, hi), lo: Math.max(0, lo), free: free };
  }
  /* mmol (or mEq) per bag for a per-kg-per-day requirement, and the stock volume. */
  function additive(reqPerKgDay, wKg, bagMl, dailyMl, stockPerMl) {
    var q = num(reqPerKgDay), w = num(wKg), V = num(bagMl), Dd = num(dailyMl), s = num(stockPerMl);
    if (!(q >= 0) || !(w > 0) || !(V > 0) || !(Dd > 0)) return null;
    var amt = q * w * V / Dd, ml = s > 0 ? amt / s : null;
    return { amount: amt, ml: ml };
  }
  /* Shared band matcher (neo-patient.js SMD_NEO_ENGINE). */
  function inBand(when, d) {
    var E = G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine);
    var m = E.matches(when, E.context(d)); return { ok: m.ok, need: m.needs };
  }
  function volumesFor(doc, d) {
    return ((doc && doc.daily_volumes) || []).map(function (r) { var m = inBand(r.when, d); return { row: r, ok: m.ok, need: m.need }; });
  }
  var ENGINE = { gir: gir, pctFor: pctFor, mix: mix, additive: additive, inBand: inBand, volumesFor: volumesFor };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  var S = { tab: "gir", rate: "", pct: "", tgir: "", vol: "", bag: "", hi: "50", lo: "0", na: "", naS: "", k: "", kS: "", ca: "", caS: "" };
  function r2(v) { return v == null || !isFinite(v) ? "" : (Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function condTxt(w) { var E = G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine); return E ? E.condText(w || {}) : ""; }

  function girOut(A, doc, wKg) {
    if (!wKg) return A.note("Add the baby's weight today (in grams) at the top first.");
    var g = gir(S.rate, S.pct, wKg); if (g == null) return A.note("Enter the drip rate and the sugar (dextrose) strength.", "info");
    var h = '<div class="nh-row"><div class="nh-lbl">Sugar the baby is getting (GIR)</div><div class="nh-val">' + r2(g) + ' mg/kg/min</div><div class="nh-work">= ' + r2(g * 1440 / 1000) + " g/kg/day (x 1440 min/day / 1000 mg/g)</div>" + '<div class="nh-work">' + A.esc(num(S.rate) + " mL/h x " + num(S.pct) + "% x 10 / (60 x " + wKg + " kg)") + "</div></div>";
    var G0 = doc && doc.gir; if (G0 && G0.quote) h += '<div class="nh-work">How the source works it out: ' + A.esc(G0.formula || "") + "</div>" + A.srcLine(doc, G0);
    ((G0 && G0.targets) || []).forEach(function (t) { var m = inBand(t.when, A.neo()); if (m.ok === false) return; h += '<div class="nh-work">' + A.esc((t.label || "Target") + ": " + (t.lo != null ? t.lo : "") + (t.hi != null ? " to " + t.hi : "") + " " + (t.unit || "mg/kg/min")) + "</div>" + A.srcLine(doc, t); });
    if (!G0 || !(G0.targets || []).length) h += A.note("No newborn GIR target on file.", "info");
    A.setSheet("fl", { title: "Glucose infusion rate", tag: "Neonatal fluids", lines: ["Baby: " + G.SMD_NEO.summary(), "GIR: " + r2(g) + " mg/kg/min (" + num(S.rate) + " mL/h of " + num(S.pct) + "% dextrose, " + wKg + " kg)"] });
    return h;
  }
  function volOut(A, doc, d) {
    var rows = volumesFor(doc, d); if (!rows.length) return A.noData("day-of-life fluid volumes");
    var hit = rows.filter(function (x) { return x.ok === true; }), h = "";
    if (d.dol == null) h += A.note("Add the date and time of birth at the top to highlight today's row.", "info");
    h += '<div class="nh-scroll"><table class="nh-tbl"><tr><th>Which babies</th><th>mL per kg per day</th></tr>' + rows.map(function (x) {
      var r = x.row; return '<tr class="' + (x.ok === true ? "hit" : "") + '"><td>' + A.esc((r.label ? r.label + ": " : "") + condTxt(r.when)) + "</td><td>" + A.esc((r.lo != null ? r.lo : "") + (r.hi != null ? " to " + r.hi : "")) + "</td></tr>";
    }).join("") + "</table></div>";
    hit.forEach(function (x) { h += A.srcLine(doc, x.row); });
    if (!hit.length && d.dol != null) h += A.note("No row fits this baby exactly. Pick from the table and check the source.");
    ["resuscitation", "maintenance_fluid", "pn_stop", "ratios"].forEach(function (k) {
      (doc[k] || []).forEach(function (x) { if (x.when && inBand(x.when, d).ok === false) return; h += '<div class="nh-work" style="font-family:inherit">' + A.esc(x.label || "") + "</div>" + A.srcLine(doc, x); });
    });
    if (doc.daily_volumes_context) h += A.note(doc.daily_volumes_context.text, "info");
    if (doc.licence_note) h += A.note(doc.licence_note.text, "info");
    (doc.electrolytes || []).forEach(function (e) { var m = inBand(e.when, d); if (m.ok === false) return; h += '<div class="nh-work">' + A.esc(e.ion + ": " + (e.lo != null ? e.lo : "") + (e.hi != null ? " to " + e.hi : "") + " " + (e.unit || "") + (e.when ? " (" + condTxt(e.when) + ")" : "")) + "</div>" + A.srcLine(doc, e); });
    return h;
  }
  function bagOut(A, doc, d, wKg) {
    if (!wKg) return A.note("Add the baby's weight today (in grams) at the top first.");
    var vol = num(S.vol), tg = num(S.tgir); if (!(vol > 0) || tg == null) return A.note("Enter the total fluid a day (mL/kg/day) and the sugar target (GIR).", "info");
    var daily = vol * wKg, rate = daily / 24, pct = pctFor(tg, rate, wKg), bag = num(S.bag) || daily, h = "", lines = [];
    h += '<div class="nh-row"><div class="nh-lbl">Run the bag at</div><div class="nh-val">' + r2(rate) + ' mL/h</div><div class="nh-work">' + A.esc(vol + " mL/kg/day x " + wKg + " kg = " + r2(daily) + " mL/day") + "</div></div>";
    h += '<div class="nh-row"><div class="nh-lbl">Sugar strength needed</div><div class="nh-val">' + r2(pct) + ' %</div><div class="nh-work">' + A.esc(tg + " mg/kg/min x 60 x " + wKg + " kg / (" + r2(rate) + " mL/h x 10)") + "</div></div>";
    lines.push("Rate: " + r2(rate) + " mL/h (" + vol + " mL/kg/day)", "GIR: " + tg + " mg/kg/min needs " + r2(pct) + "% dextrose");
    var dx = (doc && doc.dextrose) || [];
    dx.forEach(function (x) { if (x.kind === "max" && x.v != null && pct > x.v) h += '<div class="nh-note bad">' + A.esc("Above " + x.v + (x.unit || "%") + ": " + (x.label || "")) + "</div>" + A.srcLine(doc, x); });
    // additives
    var adds = [["Na", S.na, S.naS], ["K", S.k, S.kS], ["Ca", S.ca, S.caS]], addMl = 0, addTxt = [];
    adds.forEach(function (a) {
      if (num(a[1]) == null) return;
      var r = additive(a[1], wKg, bag, daily, a[2]);
      if (!r) return;
      if (r.ml == null) { addTxt.push(a[0] + ": " + r2(r.amount) + " per bag (enter the bottle strength to get mL)"); return; }
      addMl += r.ml; addTxt.push(a[0] + ": " + r2(r.amount) + " per bag = " + r2(r.ml) + " mL from the bottle");
    });
    var m = mix(pct, bag, S.hi, S.lo, addMl);
    h += '<div class="nh-row"><div class="nh-lbl">To make a ' + r2(bag) + " mL bag, mix</div>";
    if (!m) h += A.note("Choose the bottles you have.", "info");
    else if (m.error) h += '<div class="nh-note bad">' + A.esc(m.error) + "</div>";
    else {
      var loName = num(S.lo) === 0 ? "sterile water" : "D" + num(S.lo);
      h += '<div class="nh-val" style="font-size:19px">' + A.esc("D" + num(S.hi) + " " + r2(m.hi) + " mL + " + loName + " " + r2(m.lo) + " mL") + "</div>";
      lines.push("Bag: " + r2(bag) + " mL = D" + num(S.hi) + " " + r2(m.hi) + " mL + " + loName + " " + r2(m.lo) + " mL" + (addMl ? " + additives " + r2(addMl) + " mL" : ""));
    }
    addTxt.forEach(function (t) { h += '<div class="nh-work">' + A.esc(t) + "</div>"; lines.push(t); });
    h += "</div>";
    A.setSheet("fl", { title: "Neonatal fluid bag", tag: "Neonatal fluids", lines: ["Baby: " + G.SMD_NEO.summary()].concat(lines) });
    return h;
  }

  function screen(el, A) {
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("fluids").then(function (doc) {
      var d = A.neo(), wKg = d.weightG ? d.weightG / 1000 : null, esc = A.esc;
      function f(k, label, unit, ph) { return '<label>' + label + '<span class="nh-u"><input inputmode="decimal" data-fl="' + k + '" value="' + esc(S[k]) + '" placeholder="' + esc(ph || "") + '"><span>' + unit + "</span></span></label>"; }
      var body = S.tab === "gir" ? '<div class="nh-grid">' + f("rate", "Drip rate", "mL/h") + f("pct", "Sugar (dextrose)", "%") + "</div>" :
        S.tab === "vol" ? "" :
        '<div class="nh-grid">' + f("vol", "Total fluid a day", "mL/kg/day") + f("tgir", "Sugar target (GIR)", "mg/kg/min") + f("bag", "Bag size", "mL", "one day") + '<label class="nh-full">Bottles you have (strong + weak)<span class="nh-u"><select data-fl="hi">' + ["50", "25", "12.5", "10"].map(function (x) { return "<option" + (x === S.hi ? " selected" : "") + ' value="' + x + '">D' + x + "</option>"; }).join("") + '</select><select data-fl="lo">' + ["0", "5", "10"].map(function (x) { return "<option" + (x === S.lo ? " selected" : "") + ' value="' + x + '">' + (x === "0" ? "Sterile water" : "D" + x) + "</option>"; }).join("") + "</select></span></label>" +
          f("na", "Sodium (Na)", "mmol/kg/d") + f("naS", "Sodium bottle", "mmol/mL") + f("k", "Potassium (K)", "mmol/kg/d") + f("kS", "Potassium bottle", "mmol/mL") + f("ca", "Calcium (Ca)", "mmol/kg/d") + f("caS", "Calcium bottle", "mmol/mL") + "</div>";
      el.innerHTML = '<section class="nh-card"><h3>Fluids and sugar ' + (doc ? A.badge(doc) : "") + '</h3><div class="nh-tabs" role="group" aria-label="Fluid tool">' + [["gir", "Sugar rate (GIR)"], ["vol", "Daily fluids"], ["bag", "Make a bag"]].map(function (t) { return '<button type="button" data-fl-tab="' + t[0] + '" aria-pressed="' + (S.tab === t[0]) + '">' + t[1] + "</button>"; }).join("") + "</div>" +
        body + '<div data-fl-out="1"></div>' + (S.tab !== "vol" ? A.actionsHtml("fl") : "") + '<div class="nh-foot">D50 means 50% dextrose (sugar). Use the salt bottle strengths your unit stocks.</div></section>';
      function paint() { var o = el.querySelector("[data-fl-out]"); d = A.neo(); wKg = d.weightG ? d.weightG / 1000 : null; o.innerHTML = S.tab === "gir" ? girOut(A, doc, wKg) : S.tab === "vol" ? volOut(A, doc, d) : bagOut(A, doc, d, wKg); }
      paint();
      el.oninput = el.onchange = function (e) { var k = e.target.getAttribute && e.target.getAttribute("data-fl"); if (!k) return; S[k] = e.target.value; paint(); };
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-fl-tab]"); if (b) { S.tab = b.getAttribute("data-fl-tab"); screen(el, A); } };
    });
  }

  /* calculators.js registry entries (only while the flag is on). */
  function registerCalcs() {
    var M = G.MEDCALC, F = G.SMD_NEO_FLAGS; if (!M || !M.register || !F || !F.feature("fluids")) return;
    M.register({ id: "neo_gir", cat: "Neonatology", icon: "", title: "Glucose Infusion Rate (GIR)", desc: "mg/kg/min from infusion rate, dextrose % and weight.", draft: true, kw: ["gir", "glucose infusion rate", "dextrose", "neonatal"],
      inputs: [{ id: "rate", label: "Infusion rate", type: "number", unit: "mL/h", step: "0.1" }, { id: "pct", label: "Dextrose", type: "number", unit: "%", step: "0.5" }, { id: "wt", label: "Weight", type: "number", unit: "g", step: "10" }],
      compute: function (v) { if (!(v.wt > 0) || isNaN(v.rate) || isNaN(v.pct)) return { err: "Enter all required values." }; if (v.wt < 30) return { err: "Enter the weight in grams." }; var g = gir(v.rate, v.pct, v.wt / 1000); return { v: Math.round(g * 100) / 100, u: "mg/kg/min", i: "rate x % x 10 / (60 x kg). Draft neonatal tool: verify locally." }; } });
    G.SMD_NEO_HUB.api.dataOrNull("fluids").then(function (doc) {
      if (!doc || !(doc.daily_volumes || []).length) return;
      M.register({ id: "neo_fluid_dol", cat: "Neonatology", icon: "", title: "Neonatal Fluid Volume by Day of Life", desc: "mL/kg/day band for day of life and gestation or birth weight, from the cited source.", draft: true, kw: ["fluid", "day of life", "neonatal", "maintenance"],
        inputs: [{ id: "dol", label: "Day of life", type: "number", step: "1" }, { id: "ga", label: "Gestation at birth", type: "number", unit: "weeks", step: "1" }, { id: "bw", label: "Birth weight", type: "number", unit: "g", step: "10" }],
        compute: function (v) {
          if (isNaN(v.dol)) return { err: "Enter the day of life." };
          var d = { dol: v.dol, gaDays: isNaN(v.ga) ? null : v.ga * 7, birthWeightG: isNaN(v.bw) ? null : v.bw };
          var hits = volumesFor(doc, d).filter(function (x) { return x.ok === true; });
          if (!hits.length) return { err: "No row on file fits these values." };
          var r = hits[0].row; return { v: (r.lo != null ? r.lo : "") + (r.hi != null ? "-" + r.hi : ""), u: "mL/kg/day", i: (r.label || "") + (hits.length > 1 ? " (" + hits.length + " rows match; see the Neonatal tools screen)" : "") + ". Source: " + ((doc.sources[r.src] || {}).title || r.src) + ". Draft." };
        } });
    });
  }
  G.SMD_NEO_FLUIDS = { engine: ENGINE, registerCalcs: registerCalcs };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "fluids", flag: "fluids", order: 4, icon: "water_full", title: "Fluids and GIR", sub: "GIR, day of life, bag", kw: "fluids gir glucose dextrose d50 d10 bag maintenance sodium potassium calcium", render: screen, onRecord: function (el, A) { screen(el, A); } });
  if (G.document.readyState === "loading") G.document.addEventListener("DOMContentLoaded", function () { setTimeout(registerCalcs, 0); }); else setTimeout(registerCalcs, 0);
})(typeof window !== "undefined" ? window : globalThis);
