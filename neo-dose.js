/* StewardMD - neonatal dosing by band (window.SMD_NEO_DOSE). Phase 1, flags smd_neo + smd_neo_dose.
 *
 * Data: data/neo/dose-bands-*.json (every band quoted from its source; scripts/neo/validate.mjs).
 * A band row is chosen by the baby record: gestation at birth and PMA in COMPLETED weeks (age is
 * never rounded up, data/neo/age.json), postnatal age in completed days, current weight and birth
 * weight in grams (a band written in kg is compared in kg). Rows that need a value the record lacks
 * are listed as "needs ..." instead of guessed.
 *
 * Safety (owner plan 2026-09-30): no adult or child dose is ever shown as a neonatal dose; a drug with
 * no neonatal row says "No neonatal dose on file. Do not extrapolate."; a planned dose more than
 * 2 times the band maximum is a hard stop (tenfold guard), above the band a warning; the planned dose
 * field is locked to the band's unit (mg and mcg never share a field); high-alert drugs ask for an
 * independent second check before Copy / Print.
 * The engine is pure and exported for node tests; the hub screen and the dose-calc.js block follow.
 */
(function (G) {
  "use strict";
  var GUARD_STOP = 2;       // owner plan: hard stop above 2 x band maximum
  var FILES = ["dose-bands-ai", "dose-bands-other"];
  var NO_DOSE = "No neonatal dose on file. Do not extrapolate.";

  function num(v) { if (v == null || v === "") return null; var n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : null; }
  function tidy(v) { return v == null ? null : v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : v >= 1 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000; }

  /* Band matching lives in neo-patient.js (SMD_NEO_ENGINE): one definition of "which band is this baby in". */
  function PE() { var e = G.SMD_NEO_ENGINE || (G.SMD_NEO && G.SMD_NEO.engine); if (!e) throw new Error("neo-patient.js must load first"); return e; }
  function context(d) { return PE().context(d); }
  function matches(when, ctx) { return PE().matches(when, ctx); }
  function condText(when) { return PE().condText(when); }

  /* Amounts for one band at this weight. */
  function amounts(band, wKg, bwKg) {
    var dz = band.dose || {};
    // A row with no dose (a ceiling, a timing rule) or a dose per something other than kg or a fixed
    // dose (for example mg per g of amino acids) is shown as the source words it, not calculated.
    if (dz.lo == null && dz.hi == null) return { textOnly: true, text: band.label || "", max: band.max || null };
    if (dz.per !== "kg" && dz.per !== "dose") return { textOnly: true, text: (dz.lo != null ? dz.lo : "") + (dz.hi != null && dz.hi !== dz.lo ? "-" + dz.hi : "") + " " + dz.unit + " per " + dz.per + (dz.basis === "day" ? " per day" : ""), max: band.max || null };
    var useBw = /birth/i.test(dz.weight || ""), wUse = useBw ? bwKg : wKg, per = dz.per === "kg" ? wUse : 1;
    if (dz.per === "kg" && !wUse) return { needsWeight: true, birth: useBw };
    wKg = wUse;
    var lo = dz.lo != null ? dz.lo * per : null, hi = dz.hi != null ? dz.hi * per : null;
    var out = { unit: dz.unit, rate: dz.rate || null, basis: dz.basis || "dose", daily: null, perDose: null, working: "" };
    var w = (dz.per === "kg" ? (dz.lo != null ? dz.lo : "") + (dz.hi != null && dz.hi !== dz.lo ? (dz.lo != null ? "-" : "up to ") + dz.hi : "") + " " + dz.unit + "/kg" + (dz.rate ? "/" + dz.rate : dz.basis === "day" ? "/day" : "") + " x " + tidy(wKg) + " kg" : "");
    out.working = w + (useBw ? " (birth weight)" : "");
    if (dz.basis === "total loading") out.total = true;
    if (dz.rate) { out.perTime = { lo: tidy(lo), hi: tidy(hi) }; return out; }
    if (dz.basis === "day") {
      out.daily = { lo: tidy(lo), hi: tidy(hi) };
      // divided: a number of doses; true = "divided" with the interval in every_h; text ("3 to 4") = not calculable per dose.
      var n = typeof dz.divided === "number" && dz.divided > 0 ? dz.divided : band.every_h ? 24 / band.every_h : null;
      if (typeof dz.divided === "string") { n = null; out.dividedText = dz.divided; }
      if (n) out.perDose = { lo: tidy(lo != null ? lo / n : null), hi: tidy(hi != null ? hi / n : null), n: n };
    } else out.perDose = { lo: tidy(lo), hi: tidy(hi) };
    // Ceilings from the source row.
    var m = band.max;
    if (m && m.unit === dz.unit) {
      var key = m.basis === "day" ? "daily" : "perDose", x = out[key];
      if (x) { if (x.hi != null && x.hi > m.v) { x.hi = m.v; out.capped = true; } if (x.lo != null && x.lo > m.v) { x.lo = m.v; out.capped = true; } }
    }
    return out;
  }
  function amtText(x, unit) { if (!x) return ""; if (x.lo != null && x.hi != null && x.hi !== x.lo) return x.lo.toLocaleString("en-IN") + "-" + x.hi.toLocaleString("en-IN") + " " + unit; var v = x.lo != null ? x.lo : x.hi; return (x.lo == null ? "up to " : "") + v.toLocaleString("en-IN") + " " + unit; }

  /* Everything for one drug and one baby. */
  function compute(drug, d) {
    var ctx = context(d), wKg = d && d.weightG ? d.weightG / 1000 : null, bwKg = d && d.birthWeightG ? d.birthWeightG / 1000 : null, res = { drug: drug, regimens: [], none: false, needs: [] };
    (drug.regimens || []).forEach(function (rg) {
      var R = { indication: rg.indication || "", route: rg.route || "", scope: rg.ageScope || "", hits: [], unknown: [], eligible: true, rg: rg };
      // Eligibility written once for the whole regimen (for example a birth-weight window) applies to
      // every row; a band's own condition on the same key is stricter and wins.
      var rgm = matches(rg.when, ctx);
      if (rgm.ok === false) { R.eligible = false; R.why = condText(rg.when); res.regimens.push(R); return; }
      if (rgm.ok === null) rgm.needs.forEach(function (n) { if (res.needs.indexOf(n) < 0) res.needs.push(n); });
      (rg.bands || []).forEach(function (b) {
        var when = {}; Object.keys(rg.when || {}).forEach(function (k) { when[k] = rg.when[k]; }); Object.keys(b.when || {}).forEach(function (k) { when[k] = b.when[k]; });
        var m = matches(when, ctx);
        if (m.ok === true) R.hits.push({ band: b, amt: amounts(b, wKg, bwKg), cond: condText(b.when) });
        else if (m.ok === null) { R.unknown.push({ band: b, needs: m.needs, cond: condText(when) }); m.needs.forEach(function (n) { if (res.needs.indexOf(n) < 0) res.needs.push(n); }); }
      });
      // Bands exist but none fits this baby (a gap in the source, e.g. exactly on a boundary it leaves open).
      R.noMatch = !R.hits.length && !R.unknown.length && (rg.bands || []).length > 0;
      // Two rows for the same step (for example two maintenance rows) both match: say so.
      var seen = {}; R.hits.forEach(function (h) { var k = h.band.label || ""; seen[k] = (seen[k] || 0) + 1; });
      R.overlap = Object.keys(seen).some(function (k) { return seen[k] > 1; });
      res.regimens.push(R);
    });
    res.none = !res.regimens.some(function (R) { return R.hits.length || R.unknown.length || R.noMatch || !R.eligible; });
    if (!(drug.regimens || []).length) res.none = true;
    return res;
  }

  /* Tenfold guard: a planned single dose (in the band's own unit) against the band. */
  function guard(planned, amt) {
    var p = num(planned); if (p == null || !amt || amt.textOnly || amt.total) return null;
    var x = amt.perDose || amt.perTime; if (!x) return null;
    var top = x.hi != null ? x.hi : x.lo, bottom = x.lo != null ? x.lo : null;
    if (top == null || !(top > 0)) return null;
    var ratio = p / top;
    if (ratio > GUARD_STOP) return { level: "stop", ratio: ratio, text: "STOP: " + p + " " + amt.unit + " is " + (Math.round(ratio * 10) / 10) + " times the band maximum (" + top + " " + amt.unit + "). Check for a tenfold or unit error." };
    if (ratio > 1) return { level: "warn", ratio: ratio, text: "Above the band: " + p + " " + amt.unit + " is more than " + top + " " + amt.unit + ". Check before giving." };
    if (bottom != null && p < bottom) return { level: "low", ratio: ratio, text: "Below the band (" + bottom + " " + amt.unit + "). Check the dose." };
    return { level: "ok", ratio: ratio, text: "Within the band." };
  }

  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function indexDrugs(files) {
    var all = [];
    files.forEach(function (f) { if (!f) return; (f.drugs || []).forEach(function (x) { x._doc = f; all.push(x); }); });
    return all;
  }
  function findIn(all, name) {
    var q = norm(name); if (!q) return null;
    var base = q.replace(/\s+(sodium|potassium|sulfate|sulphate|hydrochloride|hcl|citrate|lysine|trihydrate)$/, "");
    for (var i = 0; i < all.length; i++) {
      var x = all[i], names = [x.id, x.name].concat(x.aliases || []).map(norm);
      if (names.indexOf(q) >= 0 || names.indexOf(base) >= 0) return x;
    }
    for (i = 0; i < all.length; i++) { var n = norm(all[i].name); if (q.indexOf(n + " ") === 0 || n.indexOf(q + " ") === 0) return all[i]; }
    return null;
  }

  var ENGINE = { context: context, matches: matches, amounts: amounts, compute: compute, guard: guard, condText: condText, findIn: findIn, indexDrugs: indexDrugs, amtText: amtText, GUARD_STOP: GUARD_STOP, NO_DOSE: NO_DOSE };
  if (typeof module !== "undefined" && module.exports) { module.exports = ENGINE; return; }

  /* ================================ DATA + UI ================================ */
  var ALL = null, pend = null;
  function hub() { return G.SMD_NEO_HUB; }
  function load() {
    if (ALL) return Promise.resolve(ALL);
    if (pend) return pend;
    var H = hub(); if (!H) return Promise.reject(new Error("hub"));
    pend = Promise.all(FILES.map(function (f) { return H.api.dataOrNull(f); })).then(function (fs) { ALL = indexDrugs(fs); pend = null; return ALL; });
    return pend;
  }
  function on() { var F = G.SMD_NEO_FLAGS; return !!(F && F.feature("dose")); }
  function find(name) { return ALL ? findIn(ALL, name) : null; }

  /* The neonatal block: used by the hub screen and by dose-calc.js for a neonate. */
  function blockHtml(drug, d, opts) {
    var A = hub().api, esc = A.esc, r = compute(drug, d), doc = drug._doc, h = "";
    opts = opts || {};
    h += '<div class="nh-row"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font:700 18px var(--nh-f,inherit)">' + esc(drug.name) + "</b>" + A.badge(doc) + "</div>" + (drug["class"] ? '<div class="nh-work">' + esc(drug["class"]) + "</div>" : "") + "</div>";
    if (drug.highAlert) h += A.secondCheckHtml(drug.name);
    if (r.none) return h + '<div class="nh-note bad">' + esc(NO_DOSE) + "</div>";
    if (!d.weightG) h += A.note("Enter the current weight in grams in the baby record to calculate doses.");
    if (r.needs.length) h += A.note("Some rows need: " + r.needs.join(", ") + ". Add them to the baby record.", "info");
    var lines = [];
    r.regimens.forEach(function (R, ri) {
      if (!R.hits.length && !R.unknown.length) return;
      if (!R.eligible) { h += '<div class="nh-row"><div class="nh-lbl">' + esc([R.indication, R.route].filter(Boolean).join(" · ") || "Dose") + "</div>" + A.note("This baby is outside the source's eligibility for this use (" + R.why + ").", "bad") + A.srcLine(doc, R.rg) + "</div>"; return; }
      if (R.noMatch) { h += '<div class="nh-row"><div class="nh-lbl">' + esc([R.indication, R.route].filter(Boolean).join(" · ") || "Dose") + "</div>" + A.note("No row in this source fits this baby. " + NO_DOSE, "bad") + "<details><summary>Rows in the source</summary>" + (R.rg.bands || []).map(function (b) { return '<div class="nh-work">' + esc((b.label ? b.label + ": " : "") + (condText(b.when) || "no condition")) + "</div>"; }).join("") + "</details></div>"; return; }
      h += '<div class="nh-row"><div class="nh-lbl">' + esc([R.indication, R.route].filter(Boolean).join(" · ") || "Dose") + "</div>";
      if (R.scope && R.scope !== "neonatal") h += A.note("The source gives this dose for infants or children including neonates; it is not a neonatal-specific dose.", "info");
      if (R.rg.when && R.rg.src) h += '<div class="nh-work">Eligibility: ' + esc(condText(R.rg.when)) + "</div>" + A.srcLine(doc, R.rg);
      if (R.overlap) h += A.note("More than one row in the source matches this baby. Both are shown; choose with the source.");
      R.hits.forEach(function (hit, hi) {
        var b = hit.band, a = hit.amt;
        h += "<div>" + (b.label ? '<div class="nh-lbl" style="color:var(--nh-mut)">' + esc(b.label) + "</div>" : "");
        if (a.needsWeight) h += A.note(a.birth ? "Needs birth weight (this row doses by birth weight)." : "Needs current weight.");
        else if (a.textOnly) {
          h += '<div class="nh-fixed" style="font:600 15px var(--nh-f)">' + esc(a.text) + "</div>" + (a.max && a.max.v != null ? '<div class="nh-work">' + esc("Maximum " + a.max.v + " " + (a.max.unit || "") + (a.max.per ? "/" + a.max.per : "") + (a.max.basis ? " (" + a.max.basis + ")" : "")) + "</div>" : "");
          h += '<div class="nh-work">' + esc([b.every_h ? "Every " + b.every_h + " hours" : b.freq || "", b.infuse || ""].filter(Boolean).join(" · ")) + "</div>";
          lines.push((b.label ? b.label + ": " : "") + a.text);
        }
        else {
          var main = a.perTime ? amtText(a.perTime, a.unit) + " per " + (a.rate === "min" ? "minute" : "hour") : a.total ? amtText(a.perDose, a.unit) + " total" : a.perDose ? amtText(a.perDose, a.unit) + " per dose" : amtText(a.daily, a.unit) + " per day";
          h += '<div class="nh-val">' + esc(main) + "</div>";
          if (a.dividedText) h += '<div class="nh-work">' + esc("Divided into " + a.dividedText + " doses a day (per-dose amount depends on the number of doses)") + "</div>";
          if (a.daily && a.perDose) h += '<div class="nh-work">' + esc(amtText(a.daily, a.unit) + " per day in " + a.perDose.n + " doses") + "</div>";
          h += '<div class="nh-work">' + esc(a.working) + "</div>";
          h += '<div class="nh-work">' + esc([b.every_h ? "Every " + b.every_h + " hours" : b.freq || "", b.infuse || ""].filter(Boolean).join(" · ")) + "</div>";
          if (a.capped) h += A.note("Capped at the source maximum.");
          lines.push((R.indication ? R.indication + ": " : "") + (b.label ? b.label + ": " : "") + "Dose: " + main + (b.every_h ? ", every " + b.every_h + " h" : b.freq ? ", " + b.freq : "") + " (" + a.working + ")");
          // Planned dose check, locked to this row's unit.
          if (!a.perTime && !a.total) h += '<label class="nh-plan">Dose you plan to give<span class="nh-u"><input inputmode="decimal" data-plan="' + ri + ":" + hi + '" placeholder="per dose"><span>' + esc(a.unit) + '</span></span></label><div data-guard="' + ri + ":" + hi + '"></div>';
          var pid = drug.id + "-" + ri + "-" + hi;
          if (!a.perTime && !a.total && a.perDose && opts.prepare !== false) h += '<div class="nh-acts"><button type="button" class="nh-btn" data-neo-prep="' + A.esc(drug.id) + '" data-dose="' + (a.perDose.hi != null ? a.perDose.hi : a.perDose.lo) + '" data-unit="' + esc(a.unit) + '">Prepare</button>' + (drug.highAlert || a.rate ? '<button type="button" class="nh-btn" data-neo-pump="' + esc(drug.id) + '">Pump rate</button>' : "") + "</div>";
          else if (a.perTime) h += '<div class="nh-acts"><button type="button" class="nh-btn" data-neo-pump="' + esc(drug.id) + '">Pump rate</button></div>';
          void pid;
        }
        h += '<div class="nh-work">Row: ' + esc(hit.cond || "all neonates in this source") + "</div>" + A.srcLine(doc, b) + "</div>";
      });
      if (R.unknown.length) h += "<details><summary>" + R.unknown.length + " more row(s) need more of the baby record</summary>" + R.unknown.map(function (u) { return '<div class="nh-work">' + esc((u.band.label ? u.band.label + ": " : "") + u.cond + " (needs " + u.needs.join(", ") + ")") + "</div>"; }).join("") + "</details>";
      h += "</div>";
    });
    (drug.notes || []).forEach(function (n) { h += '<div class="nh-row">' + A.note(n.text) + A.srcLine(doc, n) + "</div>"; });
    r._lines = lines;
    blockHtml.last = r;
    return h;
  }
  function wireGuards(scope, drug, d) {
    var r = compute(drug, d);
    scope.addEventListener("input", function (e) {
      var t = e.target, k = t && t.getAttribute && t.getAttribute("data-plan"); if (!k) return;
      var ij = k.split(":"), R = r.regimens[+ij[0]], hit = R && R.hits[+ij[1]], out = scope.querySelector('[data-guard="' + k + '"]');
      if (!hit || !out) return;
      var g = guard(t.value, hit.amt);
      out.innerHTML = !g ? "" : '<div class="nh-note' + (g.level === "stop" ? " bad" : g.level === "ok" ? " info" : "") + '" role="' + (g.level === "stop" ? "alert" : "status") + '">' + hub().api.esc(g.text) + "</div>";
      scope.querySelectorAll("[data-acts] .nh-btn,[data-neo-prep]").forEach(function (b) { b.disabled = !!(g && g.level === "stop"); });
    });
  }

  /* Hub screen: pick a neonatal drug, see the band result for the pinned baby. */
  var S = { q: "", id: null };
  function screen(el, A, opts) {
    if (opts && opts.drug) { S.id = opts.drug; opts.drug = null; }
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading neonatal doses…</div></section>';
    load().then(function (all) {
      var drug = S.id ? findIn(all, S.id) : null, d = A.neo();
      if (S.id && !drug) { S.q = S.id; S.id = null; }   // named from elsewhere but not on file: say so for that name
      if (drug) {
        el.innerHTML = '<section class="nh-card" aria-live="polite"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Neonatal dose</h3><button type="button" class="nh-btn" data-neo-change="1">Change drug</button></div>' + blockHtml(drug, d) + A.actionsHtml("dose") + '<div class="nh-foot">Draft neonatal decision support. Verify against the source before prescribing.</div></section>';
        A.setSheet("dose", { title: drug.name + " (neonatal dose)", tag: "Neonatal dose", lines: [hub() && G.SMD_NEO ? "Baby: " + G.SMD_NEO.summary() : ""].concat((blockHtml.last && blockHtml.last._lines) || []) });
        wireGuards(el, drug, d);
        return;
      }
      var q = S.q.toLowerCase(), list = all.filter(function (x) { return !q || (x.name + " " + (x.aliases || []).join(" ")).toLowerCase().indexOf(q) >= 0; });
      el.innerHTML = '<section class="nh-card"><h3>Neonatal dosing ' + (all[0] ? A.badge(all[0]._doc) : "") + '</h3><input type="search" data-neo-q="1" placeholder="Search a drug, e.g. ampicillin" value="' + A.esc(S.q) + '" aria-label="Search neonatal drugs" autocomplete="off">' +
        (!all.length ? A.noData("neonatal doses") : !list.length ? '<div class="nh-none">No neonatal dose on file for "' + A.esc(S.q) + '". Do not extrapolate from adult or child doses.</div>' :
        '<div class="nh-list">' + list.map(function (x) { return '<button type="button" class="nh-li" data-neo-drug="' + A.esc(x.id) + '"><span>' + A.esc(x.name) + (x.highAlert ? " <small>high-alert</small>" : "") + "</span><small>" + A.esc(x["class"] || "") + "</small></button>"; }).join("") + "</div>") + "</section>";
    }, function () { el.innerHTML = '<section class="nh-card">' + A.noData("neonatal doses") + "</section>"; });
  }
  G.document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var fo = t.closest("[data-neo-dose-open]"); if (fo && on()) { e.preventDefault(); S.id = fo.getAttribute("data-neo-dose-open"); hub().open("dose", { drug: S.id }); return; }
    if (!t.closest("#neoHub, #doseCalc")) return;
    var dr = t.closest("[data-neo-drug]"); if (dr) { S.id = dr.getAttribute("data-neo-drug"); hub().api.go("dose"); return; }
    if (t.closest("[data-neo-change]")) { S.id = null; hub().api.go("dose"); return; }
    var pr = t.closest("[data-neo-prep]"); if (pr) { if (G.SMD_DOSECALC && G.document.getElementById("doseCalc") && !G.document.getElementById("doseCalc").hidden) G.SMD_DOSECALC.close(); hub().open("prep", { drug: pr.getAttribute("data-neo-prep"), dose: +pr.getAttribute("data-dose"), unit: pr.getAttribute("data-unit") }); return; }
    var pu = t.closest("[data-neo-pump]"); if (pu) { if (G.SMD_DOSECALC && G.document.getElementById("doseCalc") && !G.document.getElementById("doseCalc").hidden) G.SMD_DOSECALC.close(); hub().open("inf", { drug: pu.getAttribute("data-neo-pump") }); return; }
  }, false);
  G.document.addEventListener("input", function (e) {
    var t = e.target; if (!t || !t.getAttribute || !t.getAttribute("data-neo-q")) return;
    S.q = t.value; var pos = t.selectionStart; hub().api.go("dose"); var n = G.document.querySelector("[data-neo-q]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} }
  }, false);

  G.SMD_NEO_DOSE = { engine: ENGINE, load: load, find: find, on: on, blockHtml: blockHtml, wireGuards: wireGuards, NO_DOSE: NO_DOSE, loaded: function () { return !!ALL; } };
  function reg() { if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "dose", flag: "dose", order: 1, icon: "medication", title: "Neonatal dosing", sub: "By GA, PNA, PMA, weight", kw: "dose dosing drug antibiotic gentamicin ampicillin caffeine", render: screen }); }
  reg();
})(typeof window !== "undefined" ? window : globalThis);
