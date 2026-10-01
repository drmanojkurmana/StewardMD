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
  /* Every drug, three layers (owner 2026-10-01: "see our drug monographs we already have covering all drugs"):
   *   1. a sourced neonatal band (data/neo/dose-bands-*.json): calculated for this baby;
   *   2. the StewardMD monograph's own neonatal rows (data/dose-rules.json.gz, pop "neonate"): calculated
   *      with the dose calculator's engine, neonatal rows only;
   *   3. what the monograph says about newborns (data/neo/monograph-neonatal.json, verbatim sentences).
   * A drug with none of these says "No neonatal dose on file. Do not extrapolate." Child and adult rows
   * are never shown as a newborn dose. */
  var ALL = null, pend = null, MONO = null, STMT = null, ENTRIES = null;
  function hub() { return G.SMD_NEO_HUB; }
  function load() {
    if (ALL) return Promise.resolve(ALL);
    if (pend) return pend;
    var H = hub(); if (!H) return Promise.reject(new Error("hub"));
    var DC = G.SMD_DOSECALC;
    pend = Promise.all(FILES.map(function (f) { return H.api.dataOrNull(f); }).concat([H.api.dataOrNull("monograph-neonatal"), DC && DC.load ? DC.load().then(null, function () { return null; }) : Promise.resolve(null)]))
      .then(function (fs) { STMT = (fs[FILES.length] || {}).drugs || {}; MONO = fs[FILES.length + 1]; ALL = indexDrugs(fs.slice(0, FILES.length)); ENTRIES = null; pend = null; return ALL; });
    return pend;
  }
  function on() { var F = G.SMD_NEO_FLAGS; return !!(F && F.feature("dose")); }
  function nameVariants(n) {
    var v = [n], m = /^(.*?)\s*\((.*)\)\s*$/.exec(n || "");
    if (m) { v.push(m[1]); m[2].split(/[\/,;]| or /).forEach(function (x) { x = x.trim(); if (x) v.push(x); }); }
    return v;
  }
  function bandFor(name) { if (!ALL) return null; var v = nameVariants(name); for (var i = 0; i < v.length; i++) { var b = findIn(ALL, v[i]); if (b) return b; } return null; }
  function find(name) { return bandFor(name); }
  function monoNeo(m) { return !!(m && (m.rows || []).some(function (r) { return r.pop === "neonate"; })); }
  /* One list of every drug the app knows, each with its neonatal status. */
  function entries() {
    if (ENTRIES) return ENTRIES;
    var out = [], used = {};
    ((MONO && MONO.drugs) || []).forEach(function (m) {
      var b = bandFor(m.n); if (b) used[b.id] = 1;
      out.push({ key: "m:" + m.n, name: m.n, cls: m.c || "", band: b, mono: m, neoRows: monoNeo(m), stmts: STMT[m.n] || [] });
    });
    (ALL || []).forEach(function (b) { if (!used[b.id]) out.push({ key: "b:" + b.id, name: b.name, cls: b["class"] || "", band: b, mono: null, neoRows: false, stmts: [] }); });
    out.forEach(function (e) { e.status = e.band ? "calc" : e.neoRows ? "mono" : e.stmts.length ? "info" : "none"; e._q = (e.name + " " + (e.band ? [e.band.name].concat(e.band.aliases || []).join(" ") : "")).toLowerCase(); });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    ENTRIES = out; return out;
  }
  function entryFor(id) {
    var E = entries(), i, q = String(id || "").toLowerCase();
    for (i = 0; i < E.length; i++) if (E[i].key === id) return E[i];
    for (i = 0; i < E.length; i++) if (E[i].band && E[i].band.id === id) return E[i];
    var b = bandFor(id); if (b) for (i = 0; i < E.length; i++) if (E[i].band === b) return E[i];
    for (i = 0; i < E.length; i++) if (E[i].name.toLowerCase() === q) return E[i];
    var m = G.SMD_DOSECALC && G.SMD_DOSECALC.find ? G.SMD_DOSECALC.find(id) : null;
    if (m) for (i = 0; i < E.length; i++) if (E[i].mono === m) return E[i];
    return null;
  }
  var CHIP = { calc: ["calc", "Newborn dose"], mono: ["mono", "Newborn dose (monograph)"], info: ["info", "Newborn notes only"], none: ["none", "No newborn dose"] };
  function chip(st) { var c = CHIP[st]; return '<span class="nh-chip ' + c[0] + '">' + c[1] + "</span>"; }
  function when(b) { return [b.every_h ? "every " + b.every_h + " hours" : b.freq || "", b.infuse || ""].filter(Boolean).join(" · "); }

  /* The sourced band result: the answer first, the working and the source folded away. */
  function blockHtml(drug, d, opts) {
    var A = hub().api, esc = A.esc, r = compute(drug, d), doc = drug._doc, h = "";
    opts = opts || {};
    if (!opts.noHeader) h += '<div class="nh-row"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font:700 18px var(--nh-f,inherit)">' + esc(drug.name) + "</b>" + A.badge(doc) + "</div>" + (drug["class"] ? '<div class="nh-work">' + esc(drug["class"]) + "</div>" : "") + "</div>";
    if (drug.highAlert) h += A.secondCheckHtml(drug.name);
    if (r.none) return h + '<div class="nh-note bad">' + esc(NO_DOSE) + "</div>";
    if (!d.weightG) h += A.note("Add today's weight (in grams) to the baby details to see the dose in mg.");
    if (r.needs.length) h += A.note("To show every dose, also add: " + r.needs.join(", ") + ".", "info");
    var lines = [];
    r.regimens.forEach(function (R, ri) {
      if (!R.hits.length && !R.unknown.length && R.eligible && !R.noMatch) return;
      var title = [R.indication, R.route].filter(Boolean).join(" · ") || "Dose";
      if (!R.eligible) { h += '<div class="nh-row"><div class="nh-lbl">' + esc(title) + "</div>" + A.note("Not for this baby: the source only covers " + R.why.charAt(0).toLowerCase() + R.why.slice(1) + ".", "bad") + A.srcLine(doc, R.rg) + "</div>"; return; }
      if (R.noMatch) { h += '<div class="nh-row"><div class="nh-lbl">' + esc(title) + "</div>" + A.note("None of this source's doses fits this baby. " + NO_DOSE, "bad") + "<details><summary>Doses in the source</summary>" + (R.rg.bands || []).map(function (b) { return '<div class="nh-work">' + esc((b.label ? b.label + ": " : "") + (condText(b.when) || "all babies")) + "</div>"; }).join("") + "</details></div>"; return; }
      h += '<div class="nh-row"><div class="nh-lbl">' + esc(title) + "</div>";
      if (R.scope && R.scope !== "neonatal") h += A.note("The source gives this dose for infants or children including newborns. It is not a newborn-only dose.", "info");
      if (R.rg.when && R.rg.src) h += '<div class="nh-work">Only for: ' + esc(condText(R.rg.when)) + "</div>" + A.srcLine(doc, R.rg);
      if (R.overlap) h += A.note("More than one dose in the source fits this baby. Both are shown: choose using the source.");
      R.hits.forEach(function (hit, hi) {
        var b = hit.band, a = hit.amt;
        h += '<div class="nh-answer">' + (b.label ? '<div class="nh-lbl" style="color:var(--nh-mut)">' + esc(b.label) + "</div>" : "");
        if (a.needsWeight) h += '<div style="font:600 15px var(--nh-f)">' + esc(a.birth ? "Add the birth weight: this dose is worked out from it." : "Add today's weight to work out this dose.") + "</div>";
        else if (a.textOnly) {
          h += '<div style="font:600 16px var(--nh-f)">' + esc(a.text) + "</div>" + (a.max && a.max.v != null ? '<div class="nh-work">' + esc("Maximum " + a.max.v + " " + (a.max.unit || "") + (a.max.per ? "/" + a.max.per : "") + (a.max.basis ? " (" + a.max.basis + ")" : "")) + "</div>" : "");
          if (when(b)) h += '<div style="font:600 14px var(--nh-f)">' + esc(when(b).charAt(0).toUpperCase() + when(b).slice(1)) + "</div>";
          lines.push((b.label ? b.label + ": " : "") + a.text);
        } else {
          var main = a.perTime ? amtText(a.perTime, a.unit) + " per " + (a.rate === "min" ? "minute" : "hour") : a.total ? amtText(a.perDose, a.unit) + " total" : a.perDose ? amtText(a.perDose, a.unit) + " per dose" : amtText(a.daily, a.unit) + " per day";
          h += '<div class="nh-val">' + esc(main) + "</div>";
          if (when(b)) h += '<div style="font:600 14px var(--nh-f)">' + esc(when(b).charAt(0).toUpperCase() + when(b).slice(1)) + "</div>";
          if (a.capped) h += A.note("Capped at the source's maximum.");
          lines.push((R.indication ? R.indication + ": " : "") + (b.label ? b.label + ": " : "") + "Dose: " + main + (when(b) ? ", " + when(b) : "") + " (" + a.working + ")");
        }
        h += '<div class="nh-work">For: ' + esc(hit.cond || "all newborns in this source") + "</div></div>";
        if (!a.needsWeight && !a.textOnly) {
          h += "<details><summary>How this was worked out</summary>" + '<div class="nh-work">' + esc(a.working) + "</div>" +
            (a.daily && a.perDose ? '<div class="nh-work">' + esc(amtText(a.daily, a.unit) + " a day, split into " + a.perDose.n + " doses") + "</div>" : "") +
            (a.dividedText ? '<div class="nh-work">' + esc("Split into " + a.dividedText + " doses a day; the amount per dose depends on how many") + "</div>" : "") + "</details>";
          if (!a.perTime && !a.total) h += '<label class="nh-plan">Check a dose before giving it<span class="nh-u"><input inputmode="decimal" data-plan="' + ri + ":" + hi + '" placeholder="dose you plan to give"><span>' + esc(a.unit) + '</span></span><span class="nh-hint">Catches a slip of 10 times. The unit is fixed to ' + esc(a.unit) + ".</span></label><div data-guard=\"" + ri + ":" + hi + '"></div>';
          if (!a.perTime && !a.total && a.perDose && opts.prepare !== false) h += '<div class="nh-acts"><button type="button" class="nh-btn" data-neo-prep="' + esc(drug.id) + '" data-dose="' + (a.perDose.hi != null ? a.perDose.hi : a.perDose.lo) + '" data-unit="' + esc(a.unit) + '">Prepare this dose</button>' + (drug.highAlert || a.rate ? '<button type="button" class="nh-btn" data-neo-pump="' + esc(drug.id) + '">Pump rate</button>' : "") + "</div>";
          else if (a.perTime) h += '<div class="nh-acts"><button type="button" class="nh-btn" data-neo-pump="' + esc(drug.id) + '">Work out the pump rate</button></div>';
        }
        h += A.srcLine(doc, b);
      });
      if (R.unknown.length) h += "<details><summary>" + R.unknown.length + " more dose(s) need more baby details</summary>" + R.unknown.map(function (u) { return '<div class="nh-work">' + esc((u.band.label ? u.band.label + ": " : "") + u.cond + ". Needs " + u.needs.join(", ") + ".") + "</div>"; }).join("") + "</details>";
      h += "</div>";
    });
    if ((drug.notes || []).length) h += '<div class="nh-row"><div class="nh-lbl">Warnings for newborns</div>' + drug.notes.map(function (n) { return A.note(n.text) + A.srcLine(doc, n); }).join("") + "</div>";
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

  /* Layer 2: the monograph's own neonatal rows, calculated by the dose calculator's engine (neonate rows only). */
  function monoHtml(e, d, lines) {
    var A = hub().api, esc = A.esc, DC = G.SMD_DOSECALC;
    if (!e.mono || !e.neoRows || !DC || !DC.engine) return "";
    var wKg = d.weightG != null ? d.weightG / 1000 : null;
    var h = '<div class="nh-row"><div class="nh-lbl">Newborn dose in the StewardMD monograph</div>';
    if (d.pnaDays != null && d.neonate === false) h += A.note("This baby is over 28 days old. These are the monograph's newborn doses.", "info");
    if (!wKg) return h + A.note("Add today's weight (in grams) to work out the dose.") + "</div>";
    var res = DC.engine.compute(e.mono, { weight: String(wKg), age: "0", ageUnit: "days", sex: d.sex || "", height: "", scr: "", crcl: "", childPugh: "", dialysis: false, neoStrict: true });
    if (res.errors) return h + res.errors.map(function (x) { return A.note(x, "bad"); }).join("") + "</div>";
    (res.rows || []).forEach(function (row) {
      row.lines.forEach(function (l) {
        h += '<div class="nh-answer"><div class="nh-lbl" style="color:var(--nh-mut)">' + esc(row.row.ctx || "Dose") + (row.row.rt ? " · " + esc(row.row.rt) : "") + '</div><div class="nh-val">' + esc(l.value) + "</div>" + (row.row.t ? '<div style="font:600 14px var(--nh-f)">' + esc(row.row.t) + "</div>" : "") + "</div>" +
          "<details><summary>How this was worked out</summary><div class=\"nh-work\">" + esc(l.working) + "</div>" + (l.practical ? '<div class="nh-work">' + esc("Rounded to a measurable amount: about " + l.practical) + "</div>" : "") + (l.capped ? '<div class="nh-work">' + esc(l.capped) + "</div>" : "") + "</details>";
        lines.push((row.row.ctx || "Dose") + ": " + l.value + (row.row.t ? ", " + row.row.t : "") + " (" + l.working + ")");
      });
      row.notes.forEach(function (n) { h += A.note(n, "info"); });
      h += '<div class="nh-work">Monograph text: ' + esc([row.row.d, row.row.t, row.row.note].filter(Boolean).join(" · ")) + "</div>";
    });
    (res.other || []).forEach(function (o) { h += '<div class="nh-answer"><div class="nh-lbl" style="color:var(--nh-mut)">' + esc(o.ctx || "Dose") + (o.rt ? " · " + esc(o.rt) : "") + '</div><div style="font:600 16px var(--nh-f)">' + esc(o.d) + "</div>" + (o.t || o.note ? '<div class="nh-work">' + esc([o.t, o.note].filter(Boolean).join(" · ")) + "</div>" : "") + "</div>"; lines.push((o.ctx || "Dose") + ": " + o.d); });
    return h + '<div class="nh-work">From the StewardMD drug monograph (the same one the dose calculator uses).</div></div>';
  }
  /* Layer 3: verbatim newborn statements from the monograph. */
  function stmtHtml(stmts, open) {
    if (!stmts || !stmts.length) return "";
    var A = hub().api, esc = A.esc, by = {}, order = [];
    stmts.forEach(function (x) { if (!by[x.section]) { by[x.section] = []; order.push(x.section); } by[x.section].push(x.text); });
    return "<details class=\"nh-row\"" + (open ? " open" : "") + "><summary>What our monograph says about newborns (" + stmts.length + ")</summary>" +
      order.map(function (sec) { return '<div class="nh-lbl" style="color:var(--nh-mut);margin-top:6px">' + esc(sec) + "</div>" + by[sec].map(function (t) { return '<div class="nh-work" style="color:var(--nh-ink)">' + esc(t) + "</div>"; }).join(""); }).join("") +
      '<div class="nh-work">Quoted word for word from the StewardMD monograph. A dose here that is not marked for newborns is not a newborn dose.</div></details>';
  }
  function statementsFor(name) { if (!STMT) return []; var v = nameVariants(name); for (var i = 0; i < v.length; i++) if (STMT[v[i]]) return STMT[v[i]]; return []; }

  /* Hub screen: search every drug, see what is on file for this baby. */
  var S = { q: "", id: null };
  function resultHtml(A, e, d) {
    var esc = A.esc, h = "", lines = [];
    h += '<div class="nh-row"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font:700 19px var(--nh-f)">' + esc(e.name) + "</b>" + chip(e.status) + (e.band ? A.badge(e.band._doc) : "") + "</div>" + (e.cls ? '<div class="nh-work">' + esc(e.cls) + "</div>" : "") + "</div>";
    if (e.band) { h += blockHtml(e.band, d, { noHeader: true }); lines = lines.concat((blockHtml.last && blockHtml.last._lines) || []); }
    else if (e.neoRows) h += monoHtml(e, d, lines);
    if (!e.band && !e.neoRows) h += '<div class="nh-note bad">' + esc(NO_DOSE) + " Adult and child doses are not shown for newborns.</div>";
    h += stmtHtml(e.stmts, !e.band && !e.neoRows);
    if (e.band && e.neoRows) h += "<details><summary>Also: the StewardMD monograph's newborn dose</summary>" + monoHtml(e, d, []) + "</details>";
    if (e.mono) h += '<button type="button" class="nh-li" data-neo-mono="' + esc(e.name) + '"><span>Open the full drug page</span><small>All doses, side effects, interactions</small></button>';
    A.setSheet("dose", { title: e.name + " (newborn dose)", tag: "Neonatal dose", lines: ["Baby: " + (G.SMD_NEO ? G.SMD_NEO.summary() : "")].concat(lines.length ? lines : [NO_DOSE]) });
    return h;
  }
  function screen(el, A, opts) {
    if (opts && opts.drug) { S.id = opts.drug; opts.drug = null; }
    el.innerHTML = '<section class="nh-card"><div class="nh-none">Loading drugs…</div></section>';
    load().then(function () {
      var d = A.neo(), E = entries(), e = S.id ? entryFor(S.id) : null;
      if (S.id && !e) { S.q = S.id; S.id = null; }   // named from elsewhere but not in the app: say so for that name
      if (e) {
        el.innerHTML = '<section class="nh-card" aria-live="polite"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>Newborn dose</h3><button type="button" class="nh-btn" data-neo-change="1">Another drug</button></div>' + resultHtml(A, e, d) + A.actionsHtml("dose") + '<div class="nh-foot">Beta. Check against the source before you prescribe.</div></section>';
        if (e.band) wireGuards(el, e.band, d);
        return;
      }
      var q = S.q.toLowerCase().trim(), list;
      if (q) { var starts = [], has = []; E.forEach(function (x) { var i = x._q.indexOf(q); if (i === 0) starts.push(x); else if (i > 0) has.push(x); }); list = starts.concat(has); }
      else list = E.filter(function (x) { return x.status === "calc"; });
      var counts = { calc: 0, mono: 0 }; E.forEach(function (x) { if (counts[x.status] != null) counts[x.status]++; });
      el.innerHTML = '<section class="nh-card"><h3>Find a drug ' + A.badge((ALL[0] && ALL[0]._doc) || null) + '</h3><input type="search" data-neo-q="1" placeholder="Search any drug, e.g. ampicillin" value="' + A.esc(S.q) + '" aria-label="Search any drug" autocomplete="off">' +
        '<div class="nh-work">' + E.length.toLocaleString("en-IN") + " drugs. " + counts.calc + " have a worked-out newborn dose, " + counts.mono + " more have a newborn dose in our monograph. Others show what is known, or say there is no newborn dose.</div>" +
        (!E.length ? A.noData("drugs") : q && !list.length ? '<div class="nh-none">No drug called "' + A.esc(S.q) + '" in the app. No neonatal dose on file. Do not extrapolate from adult or child doses.</div>' :
        (!q ? '<div class="nh-sec">Common newborn drugs</div>' : "") +
        '<div class="nh-list">' + list.slice(0, 80).map(function (x) { return '<button type="button" class="nh-li" data-neo-drug="' + A.esc(x.key) + '"><span>' + A.esc(x.name) + (x.band && x.band.highAlert ? " <small>high-alert</small>" : "") + "<br><small>" + A.esc(x.cls) + "</small></span>" + chip(x.status) + "</button>"; }).join("") + "</div>" + (list.length > 80 ? '<div class="nh-work">Showing 80 of ' + list.length + ". Type more letters to narrow.</div>" : "")) + "</section>";
    }, function () { el.innerHTML = '<section class="nh-card">' + A.noData("drugs") + "</section>"; });
  }
  G.document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.closest) return;
    var fo = t.closest("[data-neo-dose-open]"); if (fo && on()) { e.preventDefault(); S.id = fo.getAttribute("data-neo-dose-open"); hub().open("dose", { drug: S.id }); return; }
    if (!t.closest("#neoHub, #doseCalc")) return;
    var dr = t.closest("[data-neo-drug]"); if (dr) { S.id = dr.getAttribute("data-neo-drug"); hub().api.go("dose"); return; }
    if (t.closest("[data-neo-change]")) { S.id = null; S.q = ""; hub().api.go("dose"); return; }
    var mo = t.closest("[data-neo-mono]"); if (mo) { var nm = mo.getAttribute("data-neo-mono"); hub().close(); try { if (G.MEDDB && G.MEDDB.openComposition) G.MEDDB.openComposition(nm); else if (G.SMD_DOSECALC) G.SMD_DOSECALC.open({ drug: nm }); } catch (x) {} return; }
    var pr = t.closest("[data-neo-prep]"); if (pr) { if (G.SMD_DOSECALC && G.document.getElementById("doseCalc") && !G.document.getElementById("doseCalc").hidden) G.SMD_DOSECALC.close(); hub().open("prep", { drug: pr.getAttribute("data-neo-prep"), dose: +pr.getAttribute("data-dose"), unit: pr.getAttribute("data-unit") }); return; }
    var pu = t.closest("[data-neo-pump]"); if (pu) { if (G.SMD_DOSECALC && G.document.getElementById("doseCalc") && !G.document.getElementById("doseCalc").hidden) G.SMD_DOSECALC.close(); hub().open("inf", { drug: pu.getAttribute("data-neo-pump") }); return; }
  }, false);
  G.document.addEventListener("input", function (e) {
    var t = e.target; if (!t || !t.getAttribute || !t.getAttribute("data-neo-q")) return;
    S.q = t.value; var pos = t.selectionStart; hub().api.go("dose"); var n = G.document.querySelector("[data-neo-q]"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} }
  }, false);

  G.SMD_NEO_DOSE = { engine: ENGINE, load: load, find: find, on: on, blockHtml: blockHtml, wireGuards: wireGuards, statementsFor: statementsFor, stmtHtml: stmtHtml, entries: entries, NO_DOSE: NO_DOSE, loaded: function () { return !!ALL; } };
  function reg() { if (G.SMD_NEO_HUB) G.SMD_NEO_HUB.register({ id: "dose", flag: "dose", order: 1, icon: "medication", title: "Neonatal dosing", sub: "By GA, PNA, PMA, weight", kw: "dose dosing drug medicine antibiotic gentamicin ampicillin caffeine any drug", render: screen }); }
  reg();
})(typeof window !== "undefined" ? window : globalThis);
