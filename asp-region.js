/* StewardMD - Regional antibiogram in the Antimicrobial Stewardship Console.
 * ===========================================================================
 * The Stewardship Console (window.ASP, minified in app.js) renders its Step-4
 * "Antibiogram" from ICMR national only (its o()/ASP_ABG are private and _abgTab
 * hardcodes "national"). This module AUGMENTS window.ASP.open (no app.js edit):
 * after the console renders, it hides the national-only block and injects a
 * grouped Region/source selector + a region-aware % Resistant panel driven by the
 * global HOSPITAL profile system - so the console matches the rest of the app.
 * ICMR stays the default; regional data is decision-support, shown with its source.
 * ======================================================================== */
(function () {
  "use strict";
  function ready() { return window.ASP && typeof window.ASP.open === "function" && window.HOSPITAL && window.HOSPITAL.getAntibiogram; }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var DRUG_LABEL = {
    piptazo: "Piperacillin-tazobactam", cefotaxime: "Cefotaxime", ceftazidime: "Ceftazidime", ceftriaxone: "Ceftriaxone",
    cefepime: "Cefepime", cefuroxime: "Cefuroxime", cefoperazone: "Cefoperazone-sulbactam", cefixime: "Cefixime", cefazolin: "Cefazolin",
    ampicillin: "Ampicillin", amoxicillin: "Amoxicillin", amoxiclav: "Amoxicillin-clavulanate", ampsulbactam: "Ampicillin-sulbactam",
    ciprofloxacin: "Ciprofloxacin", levofloxacin: "Levofloxacin", norfloxacin: "Norfloxacin", ofloxacin: "Ofloxacin",
    imipenem: "Imipenem", meropenem: "Meropenem", ertapenem: "Ertapenem", doripenem: "Doripenem", aztreonam: "Aztreonam",
    amikacin: "Amikacin", gentamicin: "Gentamicin", tobramycin: "Tobramycin", netilmicin: "Netilmicin",
    colistin: "Colistin", nitrofurantoin: "Nitrofurantoin", fosfomycin: "Fosfomycin", cotrimoxazole: "Co-trimoxazole",
    doxycycline: "Doxycycline", minocycline: "Minocycline", tetracycline: "Tetracycline", tigecycline: "Tigecycline",
    chloramphenicol: "Chloramphenicol", cefoxitin: "Cefoxitin (MRSA)", erythromycin: "Erythromycin", clindamycin: "Clindamycin",
    vancomycin: "Vancomycin", teicoplanin: "Teicoplanin", linezolid: "Linezolid", daptomycin: "Daptomycin", azithromycin: "Azithromycin"
  };
  // Preferred display order (drugs not listed fall to the end, alphabetical).
  var ORDER = ["ampicillin", "amoxicillin", "amoxiclav", "ampsulbactam", "piptazo", "cefuroxime", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime", "cefoperazone", "aztreonam",
    "ertapenem", "imipenem", "meropenem", "amikacin", "gentamicin", "ciprofloxacin", "levofloxacin", "cotrimoxazole", "nitrofurantoin", "fosfomycin", "colistin",
    "cefoxitin", "erythromycin", "clindamycin", "doxycycline", "minocycline", "vancomycin", "teicoplanin", "linezolid", "daptomycin"];
  function drugLabel(k) { return DRUG_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1)); }
  function orderDrugs(keys) {
    return keys.slice().sort(function (a, b) {
      var ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      if (ia < 0 && ib < 0) return a < b ? -1 : 1;
      if (ia < 0) return 1; if (ib < 0) return -1; return ia - ib;
    });
  }
  function rColor(R) { return R >= 70 ? "#B91C1C" : R >= 50 ? "#EA580C" : R >= 25 ? "#D97706" : R >= 10 ? "#65a30d" : "#047857"; }

  /* Grouped region/source options (mirrors the Antibiogram screen). */
  function regionOptions(cur) {
    var list = window.HOSPITAL.list;
    function opt(id, label) { return '<option value="' + id + '"' + (id === cur ? " selected" : "") + '>' + esc(label) + '</option>'; }
    function studiesOf(rg) { return list.filter(function (x) { return x.type === "study" && x.region === rg; }).sort(function (a, b) { return (a.credibility || 9) - (b.credibility || 9); }); }
    var comp = {}; list.forEach(function (x) { if (x.type === "region") comp[x.region] = x; });
    var h = '<optgroup label="National">';
    if (list.some(function (x) { return x.id === "ICMR"; })) h += opt("ICMR", "ICMR AMRSN 2024 · National (default)");
    studiesOf("national").forEach(function (s) { h += opt(s.id, "↳ " + s.name); });
    h += '</optgroup>';
    [["south", "South India"], ["north", "North India"], ["east", "East & NE India"], ["west", "West & Central India"]].forEach(function (rr) {
      var c = comp[rr[0]], sts = studiesOf(rr[0]);
      if (!c && !sts.length) return;
      h += '<optgroup label="' + rr[1] + '">';
      if (c) h += opt(c.id, (c.short || rr[1]) + " - regional composite (best-of)");
      sts.forEach(function (s) { h += opt(s.id, "↳ " + s.name); });
      h += '</optgroup>';
    });
    if (list.some(function (x) { return x.id === "GIMSR"; }) && window.ASP_ABG && window.ASP_ABG.hospital && window.ASP_ABG.hospital.org && Object.keys(window.ASP_ABG.hospital.org).length)
      h += '<optgroup label="Hospital">' + opt("GIMSR", "GIMSR, Visakhapatnam") + '</optgroup>';
    return h;
  }

  /* Find the active profile's antibiogram record for an organism (canonical + genus fallback). */
  function orgRecord(orgName) {
    var ab = window.HOSPITAL.getAntibiogram(); if (!ab || !ab.org) return { ab: ab, o: null };
    var o = ab.org[orgName]; if (o) return { ab: ab, o: o };
    var cn = window.HOSPITAL.canonOrg ? window.HOSPITAL.canonOrg(orgName) : orgName;
    var keys = Object.keys(ab.org), i;
    for (i = 0; i < keys.length; i++) if (keys[i] === cn || keys[i].toLowerCase() === String(orgName).toLowerCase()) return { ab: ab, o: ab.org[keys[i]] };
    var genus = String(cn).split(/\s+/)[0].toLowerCase();
    for (i = 0; i < keys.length; i++) if (keys[i].toLowerCase().split(/\s+/)[0] === genus) return { ab: ab, o: ab.org[keys[i]] };
    return { ab: ab, o: null };
  }

  var _syn = null, _orgs = [], _orgIdx = 0;

  function organismsFor(synId) {
    var orgs = (window.ASP_DATA && window.ASP_DATA[synId] && window.ASP_DATA[synId].abgOrganisms) || null;
    if (orgs && orgs.length) return orgs.slice();
    // fallback: read the console's own organism tab labels
    var tabs = document.querySelectorAll("#aspAbgTabsNational .asp-tab");
    return [].map.call(tabs, function (b) { return b.textContent.trim(); });
  }

  function panelHTML() {
    var curId = window.HOSPITAL.current().id;
    var h = '<div class="asp-region" style="border:1px solid var(--line,#e2e8f0);border-radius:12px;padding:12px;margin-bottom:12px;background:var(--panel,#fff)">';
    h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
      '<span style="font:800 11px system-ui;text-transform:uppercase;letter-spacing:.05em;color:var(--slate-soft,#64748b)">Region / source</span>' +
      '<select id="aspRegionSel" onchange="ASP._abgRegion(this.value)" style="flex:1;min-width:180px;border:1px solid var(--line,#e2e8f0);border-radius:9px;padding:9px 10px;font:700 13px system-ui;background:var(--panel,#fff);color:var(--ink,#0f172a)">' + regionOptions(curId) + '</select></div>';
    // organism tabs
    if (_orgs.length > 1) {
      h += '<div class="asp-tabs" style="margin-bottom:8px">';
      _orgs.forEach(function (o, i) { h += '<button class="asp-tab' + (i === _orgIdx ? " active" : "") + '" onclick="ASP._abgOrg(' + i + ')">' + esc(o) + '</button>'; });
      h += '</div>';
    }
    h += '<div id="aspRegionBody">' + bodyHTML() + '</div>';
    h += '<div style="margin-top:10px;font:500 10.5px/1.45 system-ui;color:var(--slate-soft,#64748b)">Shown as % <b>resistant</b> (red = worse). ICMR national guidance remains the baseline; regional/local data is decision support - verify against your own antibiogram. Tap a value for its source.</div>';
    h += '</div>';
    return h;
  }

  function bodyHTML() {
    var org = _orgs[_orgIdx]; if (!org) return '<div style="font:500 12px system-ui;color:var(--slate-soft,#64748b)">No organism selected.</div>';
    var rec = orgRecord(org), o = rec.o, prof = window.HOSPITAL.current();
    var srcName = prof.name || prof.short || "ICMR national";
    if (!o || !o.d || !Object.keys(o.d).length)
      return '<div style="font:600 12.5px system-ui;color:var(--slate-soft,#64748b)"><i>' + esc(org) + '</i> - no data in <b>' + esc(srcName) + '</b>' + (prof.id === "ICMR" ? "" : " (ICMR national remains the baseline)") + '.</div>';
    var rows = orderDrugs(Object.keys(o.d)).map(function (k) {
      var c = o.d[k];
      if (c.s == null) return '<div style="display:flex;justify-content:space-between;padding:4px 0;font:600 12.5px system-ui"><span>' + esc(drugLabel(k)) + '</span><span style="color:var(--slate-soft,#64748b)">' + esc(c.q || "-") + '</span></div>';
      var R = Math.round(100 - c.s), col = rColor(R);
      var prov = c.src ? ' title="source: ' + esc(srcLabel(c.src)) + '" data-src="' + esc(c.src) + '"' : '';
      return '<div class="asp-region-row"' + prov + ' style="padding:5px 0;' + (c.src ? 'cursor:pointer;' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font:600 12.5px system-ui">' +
        '<span>' + esc(drugLabel(k)) + (c.src ? ' <span style="color:var(--tl,#0f766e);font-size:10px">ⓘ</span>' : '') + '</span>' +
        '<span style="font:800 12px system-ui;color:#fff;background:' + col + ';padding:2px 8px;border-radius:999px;min-width:52px;text-align:center">' + (c.approx ? "~" : "") + R + '% R</span></div>' +
        '<div style="height:5px;border-radius:3px;background:#eef1f4;margin-top:3px;overflow:hidden"><i style="display:block;height:100%;width:' + R + '%;background:' + col + '"></i></div></div>';
    }).join("");
    var meta = [];
    if (o.n != null) meta.push(o.n + " isolates");
    if (o.specimen) meta.push(esc(o.specimen));
    return '<div style="font:700 13px system-ui;font-style:italic;margin-bottom:4px">' + esc(org) +
      (meta.length ? ' <span style="font-style:normal;font-weight:600;font-size:10.5px;color:var(--slate-soft,#64748b)">· ' + meta.join(" · ") + '</span>' : '') + '</div>' + rows;
  }

  function srcLabel(id) {
    try { var st = window.ABG_DATA && window.ABG_DATA.getStudy && window.ABG_DATA.getStudy(id); if (st) return st.label; } catch (e) {}
    return id;
  }

  function enhance(synId) {
    try {
      var body = document.getElementById("aspBody"); if (!body) return;
      // locate the Step-4 "Antibiogram" section
      var secs = body.querySelectorAll(".asp-sec"), target = null;
      [].forEach.call(secs, function (sec) { var h = sec.querySelector(".asp-sec-h"); if (h && /antibiogram/i.test(h.textContent)) target = sec; });
      if (!target) return;                                   // non-bacterial syndrome → nothing to do
      _orgs = organismsFor(synId); _orgIdx = 0;
      if (!_orgs.length) return;
      // hide the console's national-only block (keep the section header)
      ["aspAbgTabsNational", "aspAbgBodyNational", "aspHospToggle", "aspHospWrap"].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = "none"; });
      // remove any prior injected panel, then insert ours right after the header
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
    window.ASP._abgRegion = function (id) { try { if (window.HOSPITAL && window.HOSPITAL.setProfile) window.HOSPITAL.setProfile(id); } catch (e) {} var b = document.getElementById("aspRegionBody"); if (b) b.innerHTML = bodyHTML(); };
    window.ASP._abgOrg = function (i) { _orgIdx = i; var b = document.getElementById("aspRegionBody"); if (b) b.innerHTML = bodyHTML(); var tabs = document.querySelectorAll(".asp-region .asp-tabs .asp-tab"); [].forEach.call(tabs, function (t, k) { t.classList.toggle("active", k === i); }); };
    // provenance tap
    document.addEventListener("click", function (e) {
      var row = e.target.closest && e.target.closest(".asp-region-row[data-src]");
      if (row) { var s = row.getAttribute("data-src"); if (s && window.toast) window.toast("Source: " + srcLabel(s)); }
    });
  }

  var n = 0, t = setInterval(function () { if (ready() || ++n > 200) { clearInterval(t); if (ready()) install(); } }, 50);
})();
