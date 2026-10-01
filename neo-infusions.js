/* StewardMD - neonatal infusions (window.SMD_NEO_INF). Phase 3, flags smd_neo + smd_neo_inf.
 *
 * Standard neonatal concentrations and dose ranges from data/neo/infusions.json (each quoted from its
 * source), and the pump arithmetic both ways: dose (e.g. mcg/kg/min) to mL/h and mL/h back to dose.
 * Separate from window.INFUSION_DRUGS in the frozen app.js, which is not touched; it augments the app
 * the way infusion-actions.js does and reuses that file's Copy / Print (SMD_PRINT).
 * A concentration the unit made up itself can be typed in ("as prepared"); there is no default for it.
 * A drug with no neonatal range on file says so; adult ranges are never shown for a baby.
 * The engine is pure and exported for node tests.
 */
(function (G) {
  "use strict";
  var AMT = { mcg: 0.001, mg: 1, g: 1000, units: null, unit: null, milliunits: null };

  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  /* "mcg/kg/min" -> { amt: "mcg", perKg: true, time: "min" } */
  function parseUnit(u) {
    var m = /^\s*([a-z]+)\s*\/\s*kg\s*\/\s*(min|h|hr|hour)\s*$/i.exec(u || "");
    if (!m) return null;
    return { amt: m[1].toLowerCase(), perKg: true, time: /^min/i.test(m[2]) ? "min" : "h" };
  }
  function toAmt(v, from, to) {
    from = String(from).toLowerCase(); to = String(to).toLowerCase();
    if (from === to) return v;
    if (from === "unit") from = "units"; if (to === "unit") to = "units";
    if (from === to) return v;
    if (AMT[from] && AMT[to]) return v * AMT[from] / AMT[to];
    if (from === "milliunits" && to === "units") return v / 1000;
    if (from === "units" && to === "milliunits") return v * 1000;
    return null;
  }
  /* conc: { v, unit, per_ml } -> amount per mL in the dose's amount unit */
  function concPerMl(conc, amtUnit) { var c = toAmt(conc.v, conc.unit, amtUnit); return c == null ? null : c / (conc.per_ml || 1); }

  function rateFromDose(dose, doseUnit, wKg, conc) {
    var U = parseUnit(doseUnit), d = num(dose); if (!U || d == null || !(wKg > 0)) return null;
    var c = concPerMl(conc, U.amt); if (!(c > 0)) return null;
    var perH = d * wKg * (U.time === "min" ? 60 : 1);
    return { mlh: perH / c, amtPerH: perH, concPerMl: c, working: d + " " + doseUnit + " x " + wKg + " kg" + (U.time === "min" ? " x 60 min/h" : "") + " / " + c + " " + U.amt + "/mL" };
  }
  function doseFromRate(mlh, doseUnit, wKg, conc) {
    var U = parseUnit(doseUnit), r = num(mlh); if (!U || r == null || !(wKg > 0)) return null;
    var c = concPerMl(conc, U.amt); if (!(c > 0)) return null;
    return { dose: r * c / (wKg * (U.time === "min" ? 60 : 1)), concPerMl: c, working: r + " mL/h x " + c + " " + U.amt + "/mL / " + wKg + " kg" + (U.time === "min" ? " / 60 min/h" : "") };
  }
  function inRange(dose, range) {
    if (!range || dose == null) return null;
    if (range.lo != null && dose < range.lo - 1e-12) return "below";
    if (range.hi != null && dose > range.hi + 1e-12) return "above";
    return "in";
  }

  var ENGINE = { parseUnit: parseUnit, toAmt: toAmt, concPerMl: concPerMl, rateFromDose: rateFromDose, doseFromRate: doseFromRate, inRange: inRange };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ UI ================================ */
  /* Concentrations the source conditions on weight (for example 500 g or more) show only when they fit;
   * an unknown weight keeps them. */
  function usableConcs(drug, d) {
    var E = G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine);
    return (drug.concentrations || []).filter(function (c) { return !c.when || !E || E.matches(c.when, E.context(d)).ok !== false; });
  }
  var S = { id: null, ci: "0", custom: "", mode: "dose", dose: "", rate: "" };
  function r3(v) { return v == null ? "" : (Math.round(v * 1000) / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 }); }
  function r2(v) { return v == null ? "" : (Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }

  function out(A, doc, drug) {
    var esc = A.esc, d = A.neo(), wKg = d.weightG ? d.weightG / 1000 : null, U = parseUnit(drug.doseUnit), h = "", lines = [];
    var concs = usableConcs(drug, d), conc = null;
    if (S.ci === "custom") { var cv = num(S.custom); if (cv > 0 && U) conc = { v: cv, unit: U.amt, per_ml: 1, label: "As prepared" }; }
    else conc = concs[+S.ci] || null;
    if (!wKg) return A.note("Add the baby's weight today (in grams) at the top first.");
    if (!U) return A.noData("the dose unit of " + drug.name);
    if (!conc) return S.ci === "custom" ? A.note("Type the concentration you prepared, in " + U.amt + " per mL.", "info") : A.noData("a standard concentration for " + drug.name);
    var res, doseVal;
    if (S.mode === "dose") {
      res = rateFromDose(S.dose, drug.doseUnit, wKg, conc); if (!res) return A.note("Enter the dose in " + drug.doseUnit + ".", "info");
      doseVal = num(S.dose);
      h += '<div class="nh-row"><div class="nh-lbl">Set the pump to</div><div class="nh-val">' + esc(r2(res.mlh)) + ' mL/h</div><div class="nh-work">' + esc(res.working + " = " + r3(res.mlh) + " mL/h") + "</div></div>";
      lines.push("Rate: " + r2(res.mlh) + " mL/h for " + doseVal + " " + drug.doseUnit);
    } else {
      res = doseFromRate(S.rate, drug.doseUnit, wKg, conc); if (!res) return A.note("Enter the pump rate in mL/h.", "info");
      doseVal = res.dose;
      h += '<div class="nh-row"><div class="nh-lbl">The baby is getting</div><div class="nh-val">' + esc(r3(res.dose)) + " " + esc(drug.doseUnit) + '</div><div class="nh-work">' + esc(res.working) + "</div></div>";
      lines.push("Result: " + r3(res.dose) + " " + drug.doseUnit + " at " + num(S.rate) + " mL/h");
    }
    lines.unshift("Set pump: concentration " + r3(res.concPerMl) + " " + U.amt + "/mL (" + (conc.label || "") + "), weight " + wKg + " kg");
    var rg = drug.range, st = inRange(doseVal, rg);
    if (!rg) h += A.note("No newborn dose range on file for " + drug.name + ". Adult ranges are not shown.", "info");
    else if (st === "above") h += '<div class="nh-note bad" role="alert">' + esc("Higher than the usual range (" + (rg.lo != null ? rg.lo + " to " : "up to ") + rg.hi + " " + (rg.unit || drug.doseUnit) + "). Check the dose, weight and concentration.") + "</div>";
    else if (st === "below") h += A.note("Lower than the usual range (" + rg.lo + (rg.hi != null ? " to " + rg.hi : "") + " " + (rg.unit || drug.doseUnit) + ").");
    else h += '<div class="nh-work">Usual range ' + esc((rg.lo != null ? rg.lo : "") + (rg.hi != null ? " to " + rg.hi : "") + " " + (rg.unit || drug.doseUnit)) + "</div>";
    if (rg) h += A.srcLine(doc, rg);
    if (S.ci !== "custom") h += A.srcLine(doc, conc);
    A.setSheet("inf", { title: drug.name + " infusion", tag: "Neonatal infusion", lines: ["Baby: " + (G.SMD_NEO ? G.SMD_NEO.summary() : "")].concat(lines) });
    return h;
  }

  function screen(el, A, opts) {
    if (opts && opts.drug) { S.id = opts.drug; S.ci = "0"; opts.drug = null; }
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading…</div></section>';
    A.dataOrNull("infusions").then(function (doc) {
      if (!doc || !(doc.drugs || []).length) { el.innerHTML = '<section class="nh-card"><h3>Infusions</h3>' + A.noData("neonatal infusions") + "</section>"; return; }
      var drug = null; doc.drugs.forEach(function (x) { if (x.id === S.id) drug = x; });
      var esc = A.esc, concs = drug ? usableConcs(drug, A.neo()) : [];
      var E = G.SMD_NEO_ENGINE;
      el.innerHTML = '<section class="nh-card"><h3>Drip rate ' + A.badge(doc) + "</h3>" +
        '<label>Which drip?<select data-inf="id"><option value="">Choose a drug</option>' + doc.drugs.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === S.id ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></label>" +
        (drug ? (drug.highAlert ? A.secondCheckHtml(drug.name) : "") +
          '<label>Strength of the syringe or bag<select data-inf="ci">' + concs.map(function (c, i) { return '<option value="' + i + '"' + (String(i) === S.ci ? " selected" : "") + ">" + esc((c.label ? c.label + ": " : "") + c.v + " " + c.unit + " per " + (c.per_ml && c.per_ml !== 1 ? c.per_ml + " " : "") + "mL" + (c.when && E ? " (" + E.condText(c.when) + ")" : "")) + "</option>"; }).join("") + '<option value="custom"' + (S.ci === "custom" ? " selected" : "") + ">My own strength (type it)</option></select></label>" +
          (S.ci === "custom" ? '<label>Strength you made up<span class="nh-u"><input inputmode="decimal" data-inf="custom" value="' + esc(S.custom) + '"><span>' + esc((parseUnit(drug.doseUnit) || {}).amt || "") + '/mL</span></span></label>' : "") +
          '<span class="nh-seg" role="group" aria-label="What do you know?"><button type="button" data-inf-mode="dose" aria-pressed="' + (S.mode === "dose") + '">I know the dose</button><button type="button" data-inf-mode="rate" aria-pressed="' + (S.mode === "rate") + '">I know the pump rate</button></span>' +
          (S.mode === "dose" ? '<label>Dose you want<span class="nh-u"><input inputmode="decimal" data-inf="dose" value="' + esc(S.dose) + '"><span>' + esc(drug.doseUnit) + "</span></span></label>" : '<label>Pump rate<span class="nh-u"><input inputmode="decimal" data-inf="rate" value="' + esc(S.rate) + '"><span>mL/h</span></span></label>') +
          '<div data-inf-out="1">' + out(A, doc, drug) + "</div>" + A.actionsHtml("inf") +
          (drug.initial || []).map(function (x) { return '<div class="nh-work">' + esc("Usual starting dose: " + (x.lo != null ? x.lo : x.v != null ? x.v : "") + (x.hi != null && x.hi !== x.lo ? " to " + x.hi : "") + " " + (x.unit || drug.doseUnit) + (x.when && E ? " (" + E.condText(x.when) + ")" : "")) + "</div>" + A.srcLine(doc, x); }).join("") +
          (drug.highAlertBasis ? A.srcLine(doc, drug.highAlertBasis) : "") +
          (drug.notes || []).map(function (n) { return A.note(n.text) + A.srcLine(doc, n); }).join("") : "") +
        '<div class="nh-foot">Newborn drips only (the adult drip calculator is separate). Check every rate before starting.</div></section>';
      el.oninput = el.onchange = function (e) {
        var k = e.target.getAttribute && e.target.getAttribute("data-inf"); if (!k) return;
        if (k === "id") { S.id = e.target.value; S.ci = "0"; screen(el, A); return; }
        if (k === "ci") { S.ci = e.target.value; screen(el, A); return; }
        S[k] = e.target.value;
        var o = el.querySelector("[data-inf-out]"); if (o && drug) o.innerHTML = out(A, doc, drug);
      };
      el.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-inf-mode]"); if (b) { S.mode = b.getAttribute("data-inf-mode"); screen(el, A); } };
    });
  }
  G.SMD_NEO_INF = { engine: ENGINE };
  if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "inf", flag: "inf", order: 3, icon: "water_drop", title: "Infusions", sub: "mcg/kg/min to mL/h", kw: "infusion pump rate dopamine dobutamine adrenaline milrinone morphine fentanyl midazolam insulin prostaglandin", render: screen, onRecord: function (el, A) { var o = el.querySelector("[data-inf-out]"); if (o) screen(el, A); } });
})(typeof window !== "undefined" ? window : globalThis);
