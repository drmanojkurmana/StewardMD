/* StewardMD - Antibiogram in the Antimicrobial Stewardship Console.
 * ===========================================================================
 * The Stewardship Console (window.ASP, minified in app.js) renders its Step-4 "Antibiogram"
 * from the ICMR national summary only. This module AUGMENTS window.ASP.open (no app.js edit):
 * after the console renders, it hides that block and injects the shared profile selector and
 * a % resistant panel for the syndrome's organisms, read from antibiogram-store.js for the
 * active profile. The specimen and setting follow the syndrome (urine for a UTI, blood for
 * sepsis, respiratory and ICU for VAP); every figure shows its isolate number and source,
 * rows under 30 isolates are marked, intrinsic resistance is never shown as a number, and
 * the AWaRe group of each agent is shown. ICMR stays the default; this is decision support.
 * ======================================================================== */
(function () {
  "use strict";
  function ready() { return window.ASP && typeof window.ASP.open === "function" && window.HOSPITAL && window.HOSPITAL.getAntibiogram; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function R() { return window.ABG_RULES; }
  function S() { return window.ABG_STORE; }
  function drugLabel(k) { var r = R(); return r ? r.drugLabel(k) : k; }
  function rColor(v) { return v >= 70 ? "#B91C1C" : v >= 50 ? "#EA580C" : v >= 25 ? "#D97706" : v >= 10 ? "#65a30d" : "#047857"; }
  function fmtN(n) { return n == null ? "" : Number(n).toLocaleString("en-IN"); }
  var SPEC = { blood: "blood", urine: "urine", respiratory: "respiratory samples", pus: "pus and wounds", deep: "deep infections", sterile: "sterile fluids", csf: "CSF", stool: "stool", nonurine: "all specimens except urine", all: "all specimens" };
  var SET = { opd: "outpatients", ward: "wards", icu: "ICU", inpatient: "inpatients", all: "all settings" };
  var AW = { A: ["Access", "#047857"], W: ["Watch", "#B45309"], R: ["Reserve", "#B91C1C"] };

  var _syn = null, _orgs = [], _orgIdx = 0;

  function organismsFor(synId) {
    var orgs = (window.ASP_DATA && window.ASP_DATA[synId] && window.ASP_DATA[synId].abgOrganisms) || null;
    if (orgs && orgs.length) return orgs.slice();
    var tabs = document.querySelectorAll("#aspAbgTabsNational .asp-tab");     // fallback: the console's own tabs
    return [].map.call(tabs, function (b) { return b.textContent.trim(); });
  }

  /* The active profile's scope, or ICMR's when the profile has no antibiogram. */
  function scopeInfo() {
    var H = window.HOSPITAL, prof = H.current(), icmr = null;
    (H.list || []).forEach(function (h) { if (h.id === "ICMR") icmr = h; });
    if (prof.abgScope) return { prof: prof, scope: prof.abgScope, borrowed: false };
    return { prof: prof, scope: icmr && icmr.abgScope, borrowed: true };
  }

  function panelHTML() {
    var H = window.HOSPITAL, curId = H.current().id;
    var opts = H.optionsHTML ? H.optionsHTML(curId) : '<option value="ICMR" selected>ICMR (National)</option>';
    var h = '<div class="asp-region" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:12px;background:var(--panel,#fff)">';
    h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      '<label for="aspRegionSel" style="font:800 11px system-ui;text-transform:uppercase;letter-spacing:.05em;color:var(--slate-soft,#64748b)">Antibiogram</label>' +
      '<select id="aspRegionSel" onchange="ASP._abgRegion(this.value)" style="flex:1;min-width:180px;max-width:100%;border:1px solid var(--line,#e2e8f0);border-radius:9px;padding:9px 10px;font:700 13px system-ui;background:var(--panel,#fff);color:var(--ink,#0f172a)">' + opts + '</select></div>';
    if (_orgs.length > 1) {
      h += '<div class="asp-tabs" role="tablist" style="margin-bottom:8px">';
      _orgs.forEach(function (o, i) { h += '<button type="button" role="tab" aria-selected="' + (i === _orgIdx) + '" class="asp-tab' + (i === _orgIdx ? " active" : "") + '" onclick="ASP._abgOrg(' + i + ')">' + esc(o) + '</button>'; });
      h += '</div>';
    }
    h += '<div id="aspRegionBody" aria-live="polite">' + bodyHTML() + '</div>';
    h += '<div style="margin-top:10px;font:500 10.5px/1.45 system-ui;color:var(--slate-soft,#64748b)">% <b>resistant</b> (red = worse), with isolates tested. A, W, R = WHO AWaRe group. Figures from fewer than 30 isolates are marked. ICMR national guidance remains the baseline; check your own hospital antibiogram. Tap a value for its source.</div>';
    h += '<button type="button" onclick="ASP._abgOpenFull()" style="margin-top:8px;border:1px solid var(--line,#e2e8f0);background:none;border-radius:9px;padding:8px 10px;font:700 12px system-ui;color:var(--tl,#0f766e);cursor:pointer">Open the full antibiogram</button>';
    return h + '</div>';
  }

  function note(t) { return '<div style="font:600 12.5px/1.45 system-ui;color:var(--slate-soft,#64748b)">' + t + '</div>'; }

  function bodyHTML() {
    var org = _orgs[_orgIdx];
    if (!org) return note("No organism selected.");
    var st = S(), rl = R();
    if (!st || !rl) return legacyBody(org);
    if (!st.loaded()) {
      st.load().then(function () { refresh(); }).catch(function () { var b = document.getElementById("aspRegionBody"); if (b) b.innerHTML = legacyBody(org); });
      return note("Loading the antibiogram...");
    }
    var info = scopeInfo();
    if (!info.scope) return legacyBody(org);
    // The stratum is chosen per organism: reports print organism groups at different granularity.
    var ctx = st.synCtx(_syn), strat = st.pickStratumFor(info.scope, org, ctx.spec, ctx.set, ctx);
    var t = st.table(info.scope, strat.spec, strat.set), rows = st.orgRows(t, org, strat.cohort);
    var name = info.borrowed ? "ICMR (National)" : (info.prof.label || info.prof.name);
    var head = info.borrowed ? '<div style="font:600 11.5px/1.4 system-ui;color:#B45309;margin-bottom:6px">No antibiogram is held for ' + esc(info.prof.name) + '; ICMR national figures are shown.</div>' : "";
    if (!rows.length) return head + note('<i>' + esc(org) + '</i>: no ' + (strat.only ? esc(strat.only.map(function (x) { return SPEC[x] || x; }).join(" or ")) + ' ' : '') + 'data in <b>' + esc(name) + '</b>' + (strat.only ? ' (for meningitis only CSF figures, read with meningitis breakpoints, apply)' : '') + '. Choose another source above, or open the full antibiogram.');
    var want = ctx.spec[0], fb = "";
    if (want && !strat.specMatch) fb = "No " + (SPEC[want] || want) + " data in this source, so " + (SPEC[strat.spec] || strat.spec) + " is shown. ";
    else if (strat.wantSet && strat.wantSet !== "all" && !strat.setMatch) fb = "No " + (SET[strat.wantSet] || strat.wantSet) + " figures here, so " + (SET[strat.set] || strat.set) + " are shown. ";
    return head + (fb ? '<div style="font:600 11.5px/1.4 system-ui;color:#B45309;margin-bottom:6px">' + esc(fb) + '</div>' : "") + rows.map(function (o) { return orgBlock(t, o, name); }).join("");
  }

  function orgBlock(t, o, name) {
    var st = S(), rl = R();
    var meta = [SPEC[t.spec] || t.spec, SET[t.set] || t.set];
    if (o.n) meta.push(fmtN(o.n) + " isolates");
    if (t.pooled) meta.push((o.k || 0) + (o.k === 1 ? " institution" : " institutions"));
    else meta.push(o.rows[0].src.short + " " + (o.rows[0].src.year || ""));
    var low = t.pooled ? o.lowOnly : (o.lowN || o.noN);
    var h = '<div style="margin-bottom:8px"><div style="font:700 13px system-ui"><i>' + esc(rl.orgLabel(o.org)) + '</i>' + (o.pheno ? " (" + esc(o.pheno) + ")" : "") +
      ' <span style="font-style:normal;font-weight:600;font-size:10.5px;color:var(--slate-soft,#64748b)">' + esc(meta.join(", ")) + '</span></div>';
    if (o.cohort === "hai") h += '<div style="font:600 11px system-ui;color:var(--slate-soft,#64748b)">ICU device-associated infection surveillance</div>';
    if (low) h += '<div style="font:700 11px system-ui;color:#B45309;margin:2px 0">' + (o.noN ? "Isolate number not reported" : "Fewer than 30 isolates") + ': interpret with caution (CLSI M39).</div>';
    var drugs = st.sortDrugs(Object.keys(o.cells)).filter(function (d) { var c = o.cells[d]; return c.act === "keep" || c.act === "caution" || c.act === "intrinsic"; });
    if (!drugs.length) return h + note("No usable figures.") + '</div>';
    drugs.forEach(function (d) {
      var c = o.cells[d], aw = AW[rl.aware(d)];
      var awb = aw ? ' <span title="WHO AWaRe: ' + aw[0] + '" style="font:800 9.5px system-ui;color:' + aw[1] + ';border:1px solid ' + aw[1] + ';border-radius:5px;padding:0 4px">' + rl.aware(d) + '</span>' : "";
      if (c.act === "intrinsic") {
        h += '<div class="asp-region-row" data-drug="' + esc(d) + '" data-org="' + esc(o.org) + '" data-pheno="' + esc(o.pheno || "") + '" data-spec="' + esc(t.spec) + '" data-set="' + esc(t.set) + '" style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;font:600 12.5px system-ui;cursor:pointer" title="' + esc(c.why || "") + '">' +
          '<span>' + esc(drugLabel(d)) + awb + '</span><span style="font:800 11px system-ui;color:var(--ink,#0f172a);background:var(--line,#e2e8f0);padding:2px 8px;border-radius:999px">Intrinsic R</span></div>';
        return;
      }
      // A figure that failed a check, or that rests on fewer than 30 isolates, is shown in grey,
      // never in the reliable colour scale.
      var fewNt = c.nt != null && c.nt < 30;
      var Rv = Math.round(100 - c.s), col = (c.act === "caution" || fewNt || low) ? "#94A3B8" : rColor(Rv), n = c.nt || o.n, star = c.act === "caution" ? "*" : "";
      h += '<div class="asp-region-row" data-drug="' + esc(d) + '" data-org="' + esc(o.org) + '" data-pheno="' + esc(o.pheno || "") + '" data-spec="' + esc(t.spec) + '" data-set="' + esc(t.set) + '" style="padding:5px 0;cursor:pointer"' + (c.act === "caution" ? ' title="' + esc(c.why || "") + '"' : (fewNt ? ' title="tested on ' + c.nt + ' isolates only"' : "")) + '>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font:600 12.5px system-ui;gap:8px">' +
        '<span>' + esc(drugLabel(d)) + awb + (n ? ' <span style="font-weight:600;font-size:10px;color:var(--slate-soft,#64748b)">n ' + fmtN(n) + '</span>' : "") + '</span>' +
        '<span style="font:800 12px system-ui;color:#fff;background:' + col + ';padding:2px 8px;border-radius:999px;min-width:56px;text-align:center">' + Rv + '% R' + star + '</span></div>' +
        '<div style="height:5px;border-radius:3px;background:var(--line,#eef1f4);margin-top:3px;overflow:hidden"><i style="display:block;height:100%;width:' + Rv + '%;background:' + col + '"></i></div></div>';
    });
    if (drugs.some(function (d) { return o.cells[d].act === "caution"; })) h += '<div style="font:500 10.5px system-ui;color:var(--slate-soft,#64748b)">* grey: failed a data check (tap for the reason); shown for reference, not used in pooled figures or reasoning.</div>';
    return h + '</div>';
  }

  /* When the store is unavailable: the older {org:{name:{d}}} shape from HOSPITAL. */
  function legacyBody(org) {
    var ab = window.HOSPITAL.getAntibiogram(), o = ab && ab.org && (ab.org[org] || null);
    if (!o && ab && ab.org) {
      var cn = window.HOSPITAL.canonOrg ? window.HOSPITAL.canonOrg(org) : org, keys = Object.keys(ab.org);
      for (var i = 0; i < keys.length && !o; i++) if (keys[i] === cn || keys[i].toLowerCase() === String(org).toLowerCase()) o = ab.org[keys[i]];
    }
    if (!o || !o.d) return note('<i>' + esc(org) + '</i>: no data in the national summary.');
    return '<div style="font:700 13px system-ui;margin-bottom:4px"><i>' + esc(org) + '</i></div>' + Object.keys(o.d).map(function (k) {
      var c = o.d[k]; if (c.s == null) return "";
      var Rv = Math.round(100 - c.s);
      return '<div style="display:flex;justify-content:space-between;padding:4px 0;font:600 12.5px system-ui"><span>' + esc(drugLabel(k)) + '</span><span style="font:800 12px system-ui;color:#fff;background:' + rColor(Rv) + ';padding:2px 8px;border-radius:999px">' + Rv + '% R</span></div>';
    }).join("");
  }

  /* Provenance for a tapped value. */
  function provenance(orgKey, pheno, drug, spec, set) {
    var st = S(), rl = R(); if (!st || !st.loaded()) return null;
    var info = scopeInfo(); if (!info.scope) return null;
    var cl = st.cell(info.scope, spec, set, orgKey, pheno || null, drug);
    if (!cl || !cl.cell) return null;
    var c = cl.cell, lab = rl.drugLabel(drug) + ", " + rl.orgShort(orgKey) + (pheno ? " " + pheno : "") + ": ";
    if (c.act === "intrinsic") return lab + "intrinsic resistance. " + (c.why || "");
    if (cl.pooled) return lab + "pooled from " + c.k + " institution" + (c.k === 1 ? "" : "s") + " (" + fmtN(c.nt) + " isolates; range " + Math.round(100 - c.max) + " to " + Math.round(100 - c.min) + "% R). " + cl.parts.filter(function (p) { return p.act === "keep" && !p.lowN; }).map(function (p) { return p.src.short + " " + p.src.year; }).join(", ");
    var p = cl.parts[0]; if (!p) return null;
    return lab + p.src.name + " " + p.src.year + (p.page ? ", page " + p.page : "") + (c.act === "caution" ? ". Caution: " + (c.why || "") : "") + (c.fromR ? ". Reported as % resistant." : "");
  }

  function refresh() { var b = document.getElementById("aspRegionBody"); if (b) b.innerHTML = bodyHTML(); }

  function enhance(synId) {
    try {
      var body = document.getElementById("aspBody"); if (!body) return;
      var secs = body.querySelectorAll(".asp-sec"), target = null;
      [].forEach.call(secs, function (sec) { var h = sec.querySelector(".asp-sec-h"); if (h && /antibiogram/i.test(h.textContent)) target = sec; });
      if (!target) return;                                   // non-bacterial syndrome: nothing to do
      _orgs = organismsFor(synId); _orgIdx = 0;
      if (!_orgs.length) return;
      ["aspAbgTabsNational", "aspAbgBodyNational", "aspHospToggle", "aspHospWrap"].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = "none"; });
      var old = target.querySelector(".asp-region"); if (old) old.parentNode.removeChild(old);
      var hdr = target.querySelector(".asp-sec-h");
      var wrap = document.createElement("div"); wrap.innerHTML = panelHTML();
      if (hdr && hdr.nextSibling) target.insertBefore(wrap.firstChild, hdr.nextSibling);
      else target.appendChild(wrap.firstChild);
    } catch (e) { /* never break the console */ }
  }

  function install() {
    var origOpen = window.ASP.open;
    window.ASP.open = function (synId) { _syn = synId; var r = origOpen.apply(window.ASP, arguments); enhance(synId); return r; };
    if (typeof window.ASP.openSyn === "function") {
      var origSyn = window.ASP.openSyn;
      window.ASP.openSyn = function () { var r = origSyn.apply(window.ASP, arguments); enhance(_syn); return r; };
    }
    window.ASP._abgRegion = function (id) { try { if (window.HOSPITAL && window.HOSPITAL.setProfile) window.HOSPITAL.setProfile(id); } catch (e) {} refresh(); };
    window.ASP._abgOrg = function (i) {
      _orgIdx = i; refresh();
      var tabs = document.querySelectorAll(".asp-region .asp-tabs .asp-tab");
      [].forEach.call(tabs, function (t, k) { t.classList.toggle("active", k === i); t.setAttribute("aria-selected", String(k === i)); });
    };
    window.ASP._abgOpenFull = function () {
      try {
        var info = scopeInfo();
        if (window.ABG && typeof window.ABG.open === "function") window.ABG.open({ tab: "resistance", scope: info.scope });
      } catch (e) {}
    };
    document.addEventListener("click", function (e) {
      var row = e.target.closest && e.target.closest(".asp-region-row[data-drug]");
      if (!row) return;
      var msg = null;
      try { msg = provenance(row.getAttribute("data-org"), row.getAttribute("data-pheno"), row.getAttribute("data-drug"), row.getAttribute("data-spec"), row.getAttribute("data-set")); } catch (x) {}
      if (msg && window.toast) window.toast(msg);
    });
    // Profile list grows when the store loads (every institution becomes selectable).
    try { document.addEventListener("smd:abg-ready", function () { var sel = document.getElementById("aspRegionSel"); if (sel && window.HOSPITAL.optionsHTML) sel.innerHTML = window.HOSPITAL.optionsHTML(window.HOSPITAL.current().id); refresh(); }); } catch (e) {}
  }

  var n = 0, t = setInterval(function () { if (ready() || ++n > 200) { clearInterval(t); if (ready()) install(); } }, 50);
})();
