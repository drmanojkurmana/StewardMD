/* StewardMD - Antibiogram screen v2: resistance view, sources and census, the hospital's own
 * antibiogram. Plugs into the Antibiogram overlay (antibiogram.js) through window.ABG_V2:
 *   ABG_V2.on()                  flag smd_abg_v2 (antibiogram-flags.js; ON unless "0" or ?abg2=0,
 *                                which restore the old view)
 *   ABG_V2.tabs()                extra tabs to show
 *   ABG_V2.render(tab, rerender) HTML for "resistance" | "sources" | "mine"
 *   ABG_V2.click(e, api)         handles data-v2 actions; returns true when handled
 *   ABG_V2.change(e, api)        handles select/checkbox/file changes
 *   ABG_V2.css                   styles (injected once by antibiogram.js)
 * Data comes from window.ABG_STORE (antibiogram-store.js) and the rules from
 * window.ABG_RULES (antibiogram-rules.js). Every number on screen has a source one tap away;
 * a figure that failed a check is never shown as if it were fine.
 * Decision support only: the screen says so, and it never picks a drug for the patient.
 * ======================================================================================== */
(function () {
  "use strict";
  var S = function () { return window.ABG_STORE; };
  var R = function () { return window.ABG_RULES; };
  var VIEW_KEY = "smd_abg_view";
  var st = { scope: null, spec: null, set: "all", mode: "s", q: "", drugA: "", drugB: "", cons: false, noReserve: true, srcQ: "", imp: null, impMode: "summary" };
  try { var saved = JSON.parse(localStorage.getItem(VIEW_KEY) || "{}"); ["scope", "spec", "set", "mode", "noReserve"].forEach(function (k) { if (saved[k] != null) st[k] = saved[k]; }); } catch (e) {}
  function persist() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ scope: st.scope, spec: st.spec, set: st.set, mode: st.mode, noReserve: st.noReserve })); } catch (e) {} }

  function on() {
    if (window.SMD_ABG_FLAGS) return window.SMD_ABG_FLAGS.on();
    try { return localStorage.getItem("smd_abg_v2") !== "0"; } catch (e) { return true; }
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(x) { return x == null ? "" : (Math.round(x * 10) / 10).toString(); }
  function fmtN(n) { return n == null ? "n not given" : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

  /* Colour bands for %S (CLSI M39 style); the number is always printed, colour is secondary. */
  function band(s) { return s >= 90 ? "b5" : s >= 80 ? "b4" : s >= 60 ? "b3" : s >= 40 ? "b2" : "b1"; }
  function shown(s) { return st.mode === "r" ? Math.round(10 * (100 - s)) / 10 : s; }
  function awareChip(d) {
    var a = R().aware(d); if (!a) return "";
    var t = { A: "Access", W: "Watch", R: "Reserve" }[a];
    return '<span class="v2-aw v2-aw' + a + '" title="WHO AWaRe: ' + t + '">' + a + "</span>";
  }

  /* ---------------------------------------------------------------- scope --- */
  function defaultScope() {
    try { var h = window.HOSPITAL && window.HOSPITAL.current && window.HOSPITAL.current(); if (h && h.abgScope) return h.abgScope; } catch (e) {}
    return "india";
  }
  var SPEC_ORDER = ["all", "nonurine", "blood", "urine", "respiratory", "pus", "deep", "sterile", "csf", "stool"];
  // Any listed scope, or an older edition opened from the Sources tab ("src:<id>").
  function validScope(id) {
    if (!id) return false;
    if (S().scopes().some(function (x) { return x.id === id; })) return true;
    return /^src:/.test(id) && !!S().sourceById(id.slice(4));
  }
  function ensureState() {
    if (!validScope(st.scope)) st.scope = validScope(defaultScope()) ? defaultScope() : "india";
    var strata = S().strata(st.scope);
    if (!st.spec || !strata.specs[st.spec]) st.spec = SPEC_ORDER.filter(function (x) { return strata.specs[x]; })[0] || Object.keys(strata.specs)[0] || "all";
    var sets = setsFor(st.scope, st.spec);
    if (sets.indexOf(st.set) < 0) st.set = sets[0] || "all";
  }
  function setsFor(scope, spec) {
    var have = {};
    S().scopeRows(scope).forEach(function (r) { if (r.spec === spec) have[r.set] = 1; });
    return ["all", "inpatient", "ward", "icu", "opd"].filter(function (x) { return have[x]; });
  }
  function scopeSelect() {
    var groups = {}, order = [], list = S().scopes();
    if (!list.some(function (x) { return x.id === st.scope; }) && /^src:/.test(st.scope)) {
      var old = S().sourceById(st.scope.slice(4));
      if (old) list = [{ id: st.scope, label: old.short + " " + old.year + " (older edition)", group: "Older edition" }].concat(list);
    }
    list.forEach(function (s) { if (!groups[s.group]) { groups[s.group] = []; order.push(s.group); } groups[s.group].push(s); });
    return '<select class="v2-sel" id="v2Scope" aria-label="Antibiogram source">' + order.map(function (g) {
      return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === st.scope ? " selected" : "") + ">" + esc(s.label) + "</option>"; }).join("") + "</optgroup>";
    }).join("") + "</select>";
  }
  function chips() {
    var strata = S().strata(st.scope), specs = SPEC_ORDER.filter(function (x) { return strata.specs[x]; });
    var sets = setsFor(st.scope, st.spec);
    var h = '<div class="v2-chips" role="group" aria-label="Specimen">' + specs.map(function (x) {
      return '<button class="v2-chip' + (x === st.spec ? " on" : "") + '" data-v2="spec" data-v="' + x + '" aria-pressed="' + (x === st.spec) + '">' + esc(R().SPECIMENS[x].label) + "</button>";
    }).join("") + "</div>";
    if (sets.length > 1) h += '<div class="v2-chips" role="group" aria-label="Setting">' + sets.map(function (x) {
      return '<button class="v2-chip v2-chip2' + (x === st.set ? " on" : "") + '" data-v2="set" data-v="' + x + '" aria-pressed="' + (x === st.set) + '">' + esc(R().SETTINGS[x].label) + "</button>";
    }).join("") + "</div>";
    return h;
  }

  /* --------------------------------------------------------------- resistance --- */
  function metaLine(t) {
    if (t.pooled) {
      var inst = {}, iso = 0;
      t.orgs.forEach(function (o) { o.rows.forEach(function (r) { if (r.n >= 30) inst[r.src.inst] = r.src; }); });
      var k = Object.keys(inst).length;
      t.orgs.forEach(function (o) { if (!o.pheno) iso += o.n || 0; });
      return '<div class="v2-meta"><b>Pooled from ' + k + " institution" + (k === 1 ? "" : "s") + "</b> (latest edition of each), " + fmtN(iso) + " isolates in this view. " +
        "Each figure is the isolate-weighted mean of the institutions that reported it; tap a cell to see them. Rows under 30 isolates and figures that failed a check are left out of pools. Surveillance network reports are listed separately so the same isolates are not counted twice.</div>";
    }
    var src = (t.orgs[0] && t.orgs[0].rows[0].src) || null;
    if (!src) { var sc = S().scopes().filter(function (x) { return x.id === st.scope; })[0]; src = sc && sc.src; }
    if (!src) return "";
    var eds = src.local ? [] : S().editions(src.inst);
    var v = src.verification || {};
    var vs = v.status === "double-checked" ? "Checked twice against the source" : v.status === "transcribed" ? "Transcribed summary: isolate counts not given, figures shown but never pooled" : v.status === "local" ? "Imported on this device" : "Checked once";
    var anyR = t.orgs.some(function (o) { return o.measure === "R"; }), hai = t.orgs.some(function (o) { return o.cohort === "hai"; });
    return '<div class="v2-meta"><b>' + esc(src.name || src.short) + "</b>" + (src.city ? ", " + esc(src.city) : "") + (src.period ? " · " + esc(src.period) : " · " + esc(src.year || "")) +
      '<br><span class="v2-mut">' + esc(vs) + ". " + (src.citation ? esc(src.citation) + ". " : "") + "</span>" +
      (anyR ? '<br><span class="v2-mut">This report prints % resistant. % susceptible is shown as 100 minus % resistant, so intermediate results count as susceptible here.</span>' : "") +
      (hai ? '<br><span class="v2-mut">Rows marked ICU HAI come from ICU device-associated infection surveillance (bloodstream, urinary and ventilator-associated infections), not from all ICU isolates.</span>' : "") +
      (src.checks && src.checks.length ? '<br><span class="v2-mut">The source\'s own tables disagree in ' + src.checks.length + " place" + (src.checks.length === 1 ? "" : "s") + ' (see Sources).</span>' : "") +
      (src.url ? '<button class="v2-link" data-v2="open-url" data-url="' + esc(src.url) + '">Open the source</button>' : "") +
      (eds.length > 1 ? ' <span class="v2-mut">Editions: ' + eds.map(function (e) { return esc(e.edLabel || e.year); }).join(", ") + " (tap a cell for the trend)</span>" : "") + "</div>";
  }
  function phenoStrip() {
    var p = S().phenotypes(st.scope, st.spec, st.set);
    if (!p.length) return "";
    return '<div class="v2-ph" role="list" aria-label="Resistance phenotypes">' + p.map(function (x) {
      var cls = x.pct >= 50 ? "hi" : x.pct >= 20 ? "mid" : "lo";
      return '<div class="v2-phc ' + cls + '" role="listitem"><div class="v2-php">' + num(x.pct) + '%</div><div class="v2-phl">' + esc(x.label) + '</div><div class="v2-phn">' + esc(x.basis) + (x.n ? ", " + fmtN(x.n) + " isolates" : "") + "</div></div>";
    }).join("") + "</div>";
  }
  function cellHtml(o, d) {
    var c = o.cells[d];
    if (!c) return '<td class="v2-c v2-na"></td>';
    var attrs = ' data-v2="cell" data-org="' + o.org + '" data-pheno="' + esc(o.pheno || "") + '" data-drug="' + d + '"';
    if (c.act === "intrinsic") return '<td class="v2-c v2-ir"' + attrs + ' title="Intrinsic resistance">IR</td>';
    if (c.act === "hide") return '<td class="v2-c v2-na"' + attrs + ' title="' + esc(c.why) + '"></td>';
    if (c.act === "suppress") return '<td class="v2-c v2-x"' + attrs + ' title="' + esc(c.why) + '">!</td>';
    var low = !o.pooled && (o.lowN || o.noN || (c.nt != null && c.nt < 30));
    var v = shown(c.s), cls = low ? "v2-low" : (st.mode === "r" ? band(100 - v) : band(v));
    if (low && !(o.lowN || o.noN)) attrs += ' title="tested on ' + c.nt + ' isolates only"';
    // A figure that failed a check is not coloured like a reliable one.
    if (c.act === "caution") return '<td class="v2-c v2-cau"' + attrs + ' title="' + esc(c.why) + '">' + num(v) + "*</td>";
    return '<td class="v2-c ' + cls + '"' + attrs + ">" + num(v) + "</td>";
  }
  function orgLabel(o) {
    var R0 = R(), lab = R0.orgShort(o.org) + (o.pheno ? " (" + o.pheno + ")" : "");
    return lab;
  }
  function resistance(rerender) {
    if (!S() || !R()) return '<div class="v2-empty">Antibiogram data is not available.</div>';
    if (!S().loaded()) {
      S().load().then(function () { rerender(); }, function () { rerender(); });
      return '<div class="v2-empty" aria-busy="true"><div class="v2-spin"></div>Loading the antibiogram data...</div>';
    }
    ensureState();
    var t = S().table(st.scope, st.spec, st.set), q = (st.q || "").toLowerCase().trim();
    var drugs = t.drugs.filter(function (d) { return t.orgs.some(function (o) { var c = o.cells[d]; return c && c.act !== "hide"; }); });
    var orgs = t.orgs;
    if (q) {
      var dq = drugs.filter(function (d) { return R().drugLabel(d).toLowerCase().indexOf(q) >= 0 || d.indexOf(q) >= 0; });
      var oq = orgs.filter(function (o) { return (R().orgLabel(o.org) + " " + R().orgShort(o.org) + " " + (o.pheno || "")).toLowerCase().indexOf(q) >= 0; });
      if (dq.length) drugs = dq; if (oq.length) orgs = oq;
    }
    var h = '<div class="v2">';
    h += '<div class="v2-bar"><label class="v2-lab" for="v2Scope">Source</label>' + scopeSelect() + "</div>";
    h += chips();
    h += '<div class="v2-tools"><input type="search" class="v2-q" id="v2Q" placeholder="Find an organism or antibiotic" value="' + esc(st.q) + '" autocomplete="off" aria-label="Find an organism or antibiotic">' +
      '<div class="v2-seg" role="group" aria-label="Show"><button data-v2="mode" data-v="s" class="' + (st.mode === "s" ? "on" : "") + '" aria-pressed="' + (st.mode === "s") + '">% susceptible</button><button data-v2="mode" data-v="r" class="' + (st.mode === "r" ? "on" : "") + '" aria-pressed="' + (st.mode === "r") + '">% resistant</button></div></div>';
    h += metaLine(t);
    h += phenoStrip();
    if (!orgs.length) {
      h += '<div class="v2-empty">No data for this specimen and setting in this source. Try another specimen or "All settings".</div>';
    } else {
      h += '<div class="v2-tw" tabindex="0" aria-label="Antibiogram table, scrolls sideways"><table class="v2-t"><caption class="sr-only">' + esc(S().scopeLabel(st.scope)) + ", " + esc(R().SPECIMENS[st.spec].label) + ", " + esc(R().SETTINGS[st.set].label) + ", " + (st.mode === "r" ? "percent resistant" : "percent susceptible") + "</caption><thead><tr>" +
        '<th scope="col" class="v2-oh">Organism</th><th scope="col" class="v2-nh">' + (t.pooled ? "Isolates (sites)" : "Isolates") + "</th>" +
        drugs.map(function (d) { return '<th scope="col" class="v2-dh"><button data-v2="drug" data-drug="' + d + '" title="' + esc(R().drugLabel(d)) + '"><span>' + esc(R().drugLabel(d)) + "</span></button>" + awareChip(d) + "</th>"; }).join("") +
        "</tr></thead><tbody>";
      orgs.forEach(function (o) {
        var low = t.pooled ? o.lowOnly : (o.lowN || o.noN);
        h += '<tr class="' + (low ? "v2-lowrow" : "") + '"><th scope="row" class="v2-o"><button data-v2="org" data-org="' + o.org + '" data-pheno="' + esc(o.pheno || "") + '"><i>' + esc(orgLabel(o)) + "</i></button>" +
          (o.derived ? '<span class="v2-der" title="' + esc("Combined by StewardMD from the " + o.how) + '">combined</span>' : "") +
          (o.cohort === "hai" ? '<span class="v2-der" title="ICU device-associated infection surveillance">ICU HAI</span>' : "") + "</th>" +
          '<td class="v2-n">' + (t.pooled ? (o.lowOnly ? '<span class="v2-mut">' + fmtN(o.rows.reduce(function (a, r) { return a + (r.n || 0); }, 0)) + " (under 30 each)</span>" : fmtN(o.n) + " (" + o.k + ")") : (o.n == null ? '<span class="v2-mut">not given</span>' : fmtN(o.n) + (o.n < 30 ? ' <span class="v2-mut">under 30</span>' : ""))) + "</td>" +
          drugs.map(function (d) { return cellHtml(o, d); }).join("") + "</tr>";
      });
      h += "</tbody></table></div>";
      h += '<div class="v2-legend"><span><i class="v2-sw b5"></i>90 or more</span><span><i class="v2-sw b4"></i>80 to 89</span><span><i class="v2-sw b3"></i>60 to 79</span><span><i class="v2-sw b2"></i>40 to 59</span><span><i class="v2-sw b1"></i>under 40</span>' +
        '<span>(% susceptible)</span><span><b>IR</b> intrinsic resistance</span><span><b>*</b> grey: failed a data check, shown for reference (tap)</span><span><b>!</b> not shown: failed a check (tap)</span><span class="v2-mut">Grey rows: under 30 isolates (CLSI M39), not pooled</span></div>';
    }
    h += wiscaHtml(t);
    h += '<div class="v2-foot"><button class="v2-btn" data-v2="csv">Export CSV</button><button class="v2-btn" data-v2="pdf">Save as PDF</button>' +
      '<p class="v2-mut">Cumulative antibiograms show how often isolates were susceptible in the past; they do not replace a culture for your patient. Every figure links to its source and the checks it passed. Intrinsic resistance per CLSI M100 Appendix B and EUCAST expected resistant phenotypes; AWaRe per WHO 2023. Decision support only.</p></div>';
    h += "</div>";
    return h;
  }

  /* -------------------------------------------------------------------- WISCA --- */
  function wiscaHtml(t) {
    var drugs = t.drugs.filter(function (d) { return !R().DRUGS[d].kind && t.orgs.some(function (o) { var c = o.cells[d]; return c && (c.act === "keep"); }); });
    if (!drugs.length) return "";
    var opt = function (sel) { return '<option value="">' + (sel === "B" ? "None" : "Choose an antibiotic") + "</option>" + drugs.map(function (d) { var v = sel === "A" ? st.drugA : st.drugB; return '<option value="' + d + '"' + (v === d ? " selected" : "") + ">" + esc(R().drugLabel(d)) + " (" + (R().aware(d) || "") + ")</option>"; }).join(""); };
    var h = '<section class="v2-wis" aria-label="Estimated empiric coverage"><h3>Estimated empiric coverage</h3>' +
      '<p class="v2-mut">For the organisms that grew from ' + esc(R().SPECIMENS[st.spec].label.toLowerCase()) + " specimens (" + esc(R().SETTINGS[st.set].label.toLowerCase()) + ") in this source: the share of isolates a regimen would have covered, weighted by how often each organism grew (weighted-incidence method).</p>" +
      '<div class="v2-wrow"><select class="v2-sel" id="v2DrugA" aria-label="First antibiotic">' + opt("A") + '</select><span class="v2-plus">+</span><select class="v2-sel" id="v2DrugB" aria-label="Second antibiotic (optional)">' + opt("B") + "</select></div>" +
      (st.spec === "blood" ? '<label class="v2-chk"><input type="checkbox" id="v2Cons"' + (st.cons ? " checked" : "") + "> Count coagulase-negative staphylococci (often contaminants)</label>" : "");
    if (st.drugA) {
      var reg = [st.drugA].concat(st.drugB && st.drugB !== st.drugA ? [st.drugB] : []);
      var w = S().wisca(st.scope, st.spec, st.set, reg, { excludeCoNS: !st.cons });
      if (w.coverage == null) h += '<div class="v2-wres">Not enough data to estimate coverage for this regimen here.</div>';
      else {
        h += '<div class="v2-wres"><div class="v2-wbig">' + (reg.length > 1 && w.high !== w.low ? num(w.low) + " to " + num(w.high) + "%" : num(w.coverage) + "%") + "</div>" +
          '<div>estimated coverage of ' + fmtN(w.known) + " isolates with data (" + num(w.knownPct) + "% of the " + fmtN(w.total) + " isolates" + (w.noData ? "; the rest grew organisms with no susceptibility data" : "") + ")." +
          (reg.length > 1 ? " A cumulative antibiogram cannot say which isolates are covered by both drugs, so a two-drug regimen is shown as a range." : "") + "</div>" +
          '<ul class="v2-wdet">' + w.detail.map(function (x) { return "<li><i>" + esc(R().orgShort(x.org)) + "</i> " + fmtN(x.n) + " isolates: " + (x.s == null ? '<span class="v2-mut">no data</span>' : num(x.s) + "% covered") + "</li>"; }).join("") + "</ul></div>";
      }
    }
    var rk = S().rank(st.scope, st.spec, st.set, { noReserve: st.noReserve, excludeCoNS: !st.cons });
    if (rk.length) {
      h += '<div class="v2-rank"><div class="v2-rankh"><b>Single agents ranked by estimated coverage</b><label class="v2-chk"><input type="checkbox" id="v2NoRes"' + (st.noReserve ? " checked" : "") + "> Hide Reserve antibiotics</label></div><ol>" +
        rk.slice(0, 10).map(function (x) { return '<li><button data-v2="pick-a" data-drug="' + x.drug + '">' + esc(R().drugLabel(x.drug)) + "</button> " + awareChip(x.drug) + ' <b>' + num(x.coverage) + '%</b> <span class="v2-mut">(data for ' + num(x.knownPct) + "% of isolates)</span></li>"; }).join("") +
        '</ol><p class="v2-mut">Prefer the narrowest Access or Watch agent that fits the patient. Ranking is not a recommendation: allergies, site of infection, severity, kidney function and local policy decide.</p></div>';
    }
    return h + "</section>";
  }

  /* ------------------------------------------------------------------- sheets --- */
  function sparkline(pts) {
    if (!pts || pts.length < 2) return "";
    var W = 240, H = 60, x0 = pts[0].year, x1 = pts[pts.length - 1].year, dx = (x1 - x0) || 1;
    var P = pts.map(function (p) { return [8 + (W - 16) * (p.year - x0) / dx, H - 10 - (H - 20) * p.s / 100]; });
    return '<svg class="v2-spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Trend: ' + pts.map(function (p) { return (p.label || p.year) + " " + num(p.s) + "%"; }).join(", ") + '">' +
      '<polyline fill="none" stroke="currentColor" stroke-width="2" points="' + P.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") + '"/>' +
      P.map(function (p, i) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3"/><text x="' + p[0].toFixed(1) + '" y="' + (p[1] - 6).toFixed(1) + '" font-size="9" text-anchor="middle">' + num(pts[i].s) + "</text>"; }).join("") +
      "</svg>" + '<div class="v2-mut">' + pts.map(function (p) { return (p.label || p.year) + (p.reported ? " (from the report's trend table)" : ""); }).join(", ") + "</div>";
  }
  function cellSheet(scope, org, pheno, drug) {
    var R0 = R(), spec = st.spec, set = st.set;
    var c = S().cell(scope, spec, set, org, pheno || null, drug);
    // Comparing from a stratum the target scope does not have (e.g. a network's "all specimens
    // except urine"): use the target's closest stratum and say so.
    if (!c && scope !== st.scope) {
      var alt = S().pickStratum(scope, [spec], set);
      if (!alt.empty) { spec = alt.spec; set = alt.set; c = S().cell(scope, spec, set, org, pheno || null, drug); }
    }
    var title = R0.orgShort(org) + (pheno ? " (" + pheno + ")" : "") + " and " + R0.drugLabel(drug);
    var h = '<div class="v2-sh"><div class="v2-shh"><b>' + esc(title) + '</b><button class="v2-x" data-v2="sheet-close" aria-label="Close">Close</button></div>';
    if (!c) return h + '<p class="v2-mut">' + esc(S().scopeLabel(scope)) + " has no figure for this organism and antibiotic in " + esc(R0.SPECIMENS[st.spec].label.toLowerCase()) + ", " + esc(R0.SETTINGS[st.set].label.toLowerCase()) + ".</p></div>";
    h += '<div class="v2-mut">' + esc(R0.SPECIMENS[spec].label) + ", " + esc(R0.SETTINGS[set].label.toLowerCase()) + " · " + esc(S().scopeLabel(scope)) + " " + awareChip(drug) + "</div>";
    if (spec !== st.spec || set !== st.set) h += '<div class="v2-note">Shown for ' + esc(R0.SPECIMENS[spec].label.toLowerCase()) + ", " + esc(R0.SETTINGS[set].label.toLowerCase()) + ": " + esc(S().scopeLabel(scope)) + " has no " + esc(R0.SPECIMENS[st.spec].label.toLowerCase()) + ", " + esc(R0.SETTINGS[st.set].label.toLowerCase()) + " figure.</div>";
    var cc = c.cell;
    if (cc && cc.act === "keep" && typeof cc.s === "number") {
      h += '<div class="v2-big ' + band(cc.s) + '">' + num(cc.s) + "% susceptible</div>";
      h += '<div class="v2-mut">' + (c.pooled ? "Pooled from " + cc.k + " institution" + (cc.k === 1 ? "" : "s") + ", " + fmtN(cc.nt) + " isolates" + (cc.k > 1 ? "; range " + num(cc.min) + " to " + num(cc.max) + "%" : "") : fmtN(cc.nt || c.n) + " isolates tested") + ".</div>";
      if (cc.fromR) h += '<div class="v2-mut">Reported as ' + num(100 - cc.s) + "% resistant; intermediate results are counted as susceptible here.</div>";
      else if (cc.mixR) h += '<div class="v2-mut">Some institutions report % resistant; for those, intermediate results are counted as susceptible.</div>';
    } else if (cc && cc.act === "intrinsic") {
      h += '<div class="v2-big b1">Intrinsic resistance</div><p>' + esc(cc.why) + ". This antibiotic should not be used for this organism whatever a laboratory figure says.</p>";
    } else if (cc && cc.why) {
      h += '<div class="v2-note">' + (cc.act === "suppress" ? "Not shown: " : cc.act === "hide" ? "Not relevant here: " : "Caution: ") + esc(cc.why) + ".</div>";
    }
    if (c.parts.length) {
      h += '<h4>' + (c.pooled ? "Each institution" : "Source") + "</h4><ul class=\"v2-parts\">" + c.parts.map(function (p) {
        var ok = p.act === "keep" && !(p.n != null && p.n < 30), w = typeof p.s === "number" ? Math.max(2, p.s) : 0;
        return '<li class="' + (ok ? "" : "v2-dim") + '"><div class="v2-pl"><b>' + esc(p.src.short) + "</b> " + esc(p.src.year) + (p.derived ? " (combined)" : "") + '<span class="v2-mut"> · ' + fmtN(p.nt || p.n) + " isolates" + (p.page ? " · page " + p.page : "") + "</span></div>" +
          (p.act === "intrinsic" ? '<div class="v2-mut">intrinsic resistance</div>' : '<div class="v2-bar2"><i style="width:' + w + '%"></i><span>' + (typeof p.s === "number" ? num(p.s) + "%" : "") + "</span></div>") +
          (!ok ? '<div class="v2-mut">' + esc(p.act !== "keep" ? (p.why || p.act) : "fewer than 30 isolates: shown, not pooled") + "</div>" : "") +
          (p.note ? '<div class="v2-mut">Source note: ' + esc(p.note) + "</div>" : "") +
          (p.src.url ? '<button class="v2-link" data-v2="open-url" data-url="' + esc(p.src.url) + '">Open source</button>' : "") + "</li>";
      }).join("") + "</ul>";
    }
    if (!c.pooled && c.parts[0] && !c.parts[0].src.local) {
      var tr = S().trend(c.parts[0].src.inst, spec, set, org, pheno || null, drug);
      if (tr.length > 1) h += "<h4>Trend at " + esc(c.parts[0].src.short) + "</h4>" + sparkline(tr);
      h += '<button class="v2-btn" data-v2="compare" data-org="' + org + '" data-pheno="' + esc(pheno || "") + '" data-drug="' + drug + '">Compare across India</button>';
    }
    h += '<button class="v2-btn" data-v2="druginfo" data-drug="' + drug + '">About ' + esc(R0.drugLabel(drug)) + "</button></div>";
    return h;
  }
  function orgSheet(org, pheno) {
    var t = S().table(st.scope, st.spec, st.set), o = t.orgs.filter(function (x) { return x.org === org && (x.pheno || "") === (pheno || ""); })[0], R0 = R();
    if (!o) return "";
    var ds = Object.keys(o.cells).filter(function (d) { return o.cells[d].act !== "hide"; });
    ds.sort(function (a, b) { var ca = o.cells[a], cb = o.cells[b]; var va = ca.act === "keep" ? ca.s : (ca.act === "intrinsic" ? -2 : -1), vb = cb.act === "keep" ? cb.s : (cb.act === "intrinsic" ? -2 : -1); return vb - va; });
    var h = '<div class="v2-sh"><div class="v2-shh"><b><i>' + esc(R0.orgLabel(org)) + "</i>" + (pheno ? " (" + esc(pheno) + ")" : "") + '</b><button class="v2-x" data-v2="sheet-close" aria-label="Close">Close</button></div>';
    h += '<div class="v2-mut">' + esc(R0.SPECIMENS[st.spec].label) + ", " + esc(R0.SETTINGS[st.set].label.toLowerCase()) + " · " + (o.n != null ? fmtN(o.n) + " isolates" : "isolates not given") + (t.pooled ? " from " + o.k + " institution" + (o.k === 1 ? "" : "s") : "") + "</div>";
    if (o.as && o.as !== R0.orgLabel(o.org)) h += '<div class="v2-mut">Reported as: ' + esc(o.as) + "</div>";
    if (o.derived) h += '<div class="v2-note">Combined by StewardMD from the ' + esc(o.how) + ", weighting each by its isolates.</div>";
    if ((t.pooled && o.lowOnly) || (!t.pooled && (o.lowN || o.noN))) h += '<div class="v2-note">Fewer than 30 isolates (or no count given): the percentages are unstable and are not pooled or used by reasoning (CLSI M39).</div>';
    h += '<ul class="v2-parts">' + ds.map(function (d) {
      var c = o.cells[d];
      return '<li><div class="v2-pl"><button class="v2-link" data-v2="cell" data-org="' + org + '" data-pheno="' + esc(pheno || "") + '" data-drug="' + d + '">' + esc(R0.drugLabel(d)) + "</button> " + awareChip(d) + "</div>" +
        (c.act === "keep" ? '<div class="v2-bar2"><i class="' + band(c.s) + '" style="width:' + Math.max(2, c.s) + '%"></i><span>' + num(c.s) + "%</span></div>" : '<div class="v2-mut">' + (c.act === "intrinsic" ? "intrinsic resistance" : c.act === "caution" ? num(c.s) + "% with a caution: " + esc(c.why) : "not shown: " + esc(c.why)) + "</div>") + "</li>";
    }).join("") + "</ul>";
    h += '<button class="v2-btn" data-v2="dossier" data-org="' + org + '">Microbiology notes</button></div>';
    return h;
  }
  function drugSheet(drug) {
    var t = S().table(st.scope, st.spec, st.set), R0 = R(), rows = t.orgs.filter(function (o) { return o.cells[drug] && o.cells[drug].act !== "hide"; });
    var h = '<div class="v2-sh"><div class="v2-shh"><b>' + esc(R0.drugLabel(drug)) + "</b> " + awareChip(drug) + '<button class="v2-x" data-v2="sheet-close" aria-label="Close">Close</button></div>' +
      '<div class="v2-mut">' + esc(R0.DRUGS[drug].cls) + " · " + esc(R0.SPECIMENS[st.spec].label) + ", " + esc(R0.SETTINGS[st.set].label.toLowerCase()) + "</div><ul class=\"v2-parts\">";
    h += rows.map(function (o) {
      var c = o.cells[drug];
      return '<li><div class="v2-pl"><i>' + esc(orgLabel(o)) + "</i> <span class=\"v2-mut\">" + (o.n != null ? fmtN(c.nt || o.n) + " isolates" : "") + "</span></div>" +
        (c.act === "keep" ? '<div class="v2-bar2"><i class="' + band(c.s) + '" style="width:' + Math.max(2, c.s) + '%"></i><span>' + num(c.s) + "%</span></div>" : '<div class="v2-mut">' + (c.act === "intrinsic" ? "intrinsic resistance" : esc(c.why)) + "</div>") + "</li>";
    }).join("") + "</ul>" + '<button class="v2-btn" data-v2="druginfo" data-drug="' + drug + '">Dosing and details</button></div>';
    return h;
  }

  /* ------------------------------------------------------------------ sources --- */
  function sources() {
    if (!S().loaded()) return '<div class="v2-empty" aria-busy="true"><div class="v2-spin"></div>Loading...</div>';
    var D = S().data(), reg = D.register || [], q = (st.srcQ || "").toLowerCase();
    var integrated = D.sources.filter(function (s) { return !s.local; });
    var notInt = reg.filter(function (x) { return !x.integrated; });
    var reasons = {};
    notInt.forEach(function (x) { var r = x.reason || x.status || "not integrated"; reasons[r] = (reasons[r] || 0) + 1; });
    var C = D.census || null;
    var h = '<div class="v2"><section class="v2-card"><h3>Where the numbers come from</h3>' +
      "<p>StewardMD searched Indian hospital, medical college and surveillance-network websites for published antibiograms (the census)" +
      (C && C.websites ? ": at least <b>" + fmtN(C.websites) + "</b> websites checked" + (C.pagesCrawled ? " (" + fmtN(C.pagesCrawled) + " pages crawled)" : "") + (C.searches ? ", " + fmtN(C.searches) + " web searches" : "") : "") + ". " +
      "<b>" + reg.length + "</b> documents found" + (reg.length ? ", <b>" + (reg.length - notInt.length) + "</b> integrated" : "") + ". Integrated sources: <b>" + integrated.length + "</b> (" +
      integrated.filter(function (s) { return s.kind === "institution"; }).length + " institution antibiograms, " + integrated.filter(function (s) { return s.kind === "network"; }).length + " network reports, " +
      integrated.filter(function (s) { return s.kind === "study"; }).length + " published hospital studies), " + fmtN(D.stats.isolates) + " isolates.</p>" +
      (Object.keys(reasons).length ? '<p class="v2-mut">Not integrated: ' + Object.keys(reasons).map(function (r) { return esc(r) + " (" + reasons[r] + ")"; }).join("; ") + ".</p>" : "") +
      '<p class="v2-mut">Most Indian hospitals do not publish their antibiogram online, and some websites refuse connections from outside India; a hospital missing here may still have one. Your own laboratory\'s antibiogram can be added under My hospital.</p>' +
      '<p class="v2-mut">' + (function () {
        var v = { dc: 0, sc: 0, tr: 0 };
        integrated.forEach(function (x) { var k = x.verification && x.verification.status; if (k === "double-checked") v.dc++; else if (k === "transcribed") v.tr++; else v.sc++; });
        return "Figures were read from each source document: " + v.dc + " sources checked twice against the document" + (v.sc ? ", " + v.sc + " checked once" : "") + (v.tr ? ", " + v.tr + " transcribed summaries without isolate counts" : "") + ". ";
      })() + 'Every cell then went through automatic checks (intrinsic resistance, impossible percentages for the isolate count, MRSA consistency, paired antibiotics that must agree, specimen relevance, and agreement with the source\'s own isolate-count tables). ' +
      fmtN(D.stats.act.caution) + " figures carry a caution, " + fmtN(D.stats.act.suppress) + " were not shown, " + fmtN(D.stats.act.intrinsic) + " were intrinsic resistance.</p></section>";
    h += '<input type="search" class="v2-q" id="v2SrcQ" placeholder="Find an institution, city or state" value="' + esc(st.srcQ) + '" aria-label="Find a source">';
    var groups = [["national", "National networks"], ["north", "North India"], ["south", "South India"], ["east", "East and North-East India"], ["west", "West and Central India"]];
    groups.forEach(function (g) {
      var list = integrated.filter(function (s) { return s.region === g[0] && (!q || (s.name + " " + s.short + " " + (s.city || "") + " " + (s.state || "")).toLowerCase().indexOf(q) >= 0); })
        .sort(function (a, b) { return a.short < b.short ? -1 : a.short > b.short ? 1 : b.year - a.year; });
      if (!list.length) return;
      h += '<h3 class="v2-gh">' + g[1] + '</h3><ul class="v2-src">' + list.map(function (s) {
        var fl = S().flagged(s.id).length;
        return '<li><button data-v2="src" data-id="' + esc(s.id) + '"><b>' + esc(s.short) + "</b> " + esc(s.year) + ' <span class="v2-kind">' + esc(s.kind === "institution" ? "antibiogram" : s.kind === "network" ? "network" : "study") + "</span>" +
          '<br><span class="v2-mut">' + esc(s.specs.map(function (x) { return R().SPECIMENS[x].label; }).join(", ")) + " · " + fmtN(s.isolates) + " isolates" + (fl ? " · " + fl + " checks" : "") + (s.verification.status === "transcribed" ? " · transcribed" : "") + "</span></button></li>";
      }).join("") + "</ul>";
    });
    if (notInt.length) {
      h += '<h3 class="v2-gh">Found but not integrated</h3><ul class="v2-src">' + notInt.filter(function (x) { return !q || ((x.institution || "") + " " + (x.city || "") + " " + (x.state || "")).toLowerCase().indexOf(q) >= 0; }).map(function (x) {
        return '<li><div><b>' + esc(x.short || x.institution) + "</b> " + esc(x.year || "") + '<br><span class="v2-mut">' + esc(x.reason || x.status || "") + "</span>" + (x.url ? ' <button class="v2-link" data-v2="open-url" data-url="' + esc(x.url) + '">Open</button>' : "") + "</div></li>";
      }).join("") + "</ul>";
    }
    return h + "</div>";
  }
  function srcSheet(id) {
    var s = S().sourceById(id); if (!s) return "";
    var fl = S().flagged(id), eds = S().editions(s.inst);
    var h = '<div class="v2-sh"><div class="v2-shh"><b>' + esc(s.name) + '</b><button class="v2-x" data-v2="sheet-close" aria-label="Close">Close</button></div>' +
      '<div class="v2-mut">' + esc([s.city, s.state].filter(Boolean).join(", ")) + " · " + esc(s.period || s.year) + " · " + esc(s.sector) + "</div>" +
      "<p>" + esc(s.citation) + "</p>" + (s.notes ? '<p class="v2-mut">' + esc(s.notes) + "</p>" : "") +
      "<p><b>Checking:</b> " + esc((s.verification && s.verification.note) || "") + "</p>" +
      (s.url ? '<button class="v2-btn" data-v2="open-url" data-url="' + esc(s.url) + '">Open the source document</button>' : "") +
      (s.page ? '<button class="v2-btn" data-v2="open-url" data-url="' + esc(s.page) + '">Open the web page that lists it</button>' : "") +
      '<button class="v2-btn" data-v2="view-src" data-id="' + esc(s.id) + '">View this antibiogram</button>';
    if (eds.length > 1) h += "<h4>Editions</h4><ul class=\"v2-parts\">" + eds.map(function (e) { return '<li><button class="v2-link" data-v2="view-src" data-id="' + esc(e.id) + '">' + esc(e.edLabel || e.year) + "</button> " + esc(e.period || "") + "</li>"; }).join("") + "</ul>";
    if (s.checks && s.checks.length) h += "<h4>The source's own tables disagree</h4><ul class=\"v2-parts\">" + s.checks.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul><p class=\"v2-mut\">Figures are shown as printed. Isolate numbers in these rows come from the antibiogram table.</p>";
    if (s.issues && s.issues.length) h += "<h4>Notes from the second reader</h4><ul class=\"v2-parts\">" + s.issues.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>";
    if (s.excluded && s.excluded.length) h += "<h4>Left out at extraction</h4><ul class=\"v2-parts\">" + s.excluded.map(function (x) { return "<li>" + esc((x.org || "") + " " + (x.drug || "")) + ": " + esc(x.why) + "</li>"; }).join("") + "</ul>";
    if (fl.length) h += "<h4>Figures with a check (" + fl.length + ")</h4><ul class=\"v2-parts\">" + fl.map(function (x) {
      return "<li><i>" + esc(R().orgShort(x.org)) + (x.pheno ? " (" + esc(x.pheno) + ")" : "") + "</i>, " + esc(R().drugLabel(x.drug)) + " " + (typeof x.s === "number" ? num(x.s) + "%" : "") + " (" + esc(R().SPECIMENS[x.spec].label) + ", " + esc(R().SETTINGS[x.set].label.toLowerCase()) + "): <b>" + esc({ intrinsic: "intrinsic", hide: "not relevant", suppress: "not shown", caution: "caution" }[x.act]) + "</b>, " + esc(x.why) + "</li>";
    }).join("") + "</ul>";
    return h + "</div>";
  }

  /* ---------------------------------------------------------------- my hospital --- */
  function mine() {
    var loc = S().localGet(), R0 = R();
    var h = '<div class="v2"><section class="v2-card"><h3>Your hospital\'s antibiogram</h3>' +
      "<p>Load your laboratory's antibiogram and it becomes a source everywhere in StewardMD: this screen, the stewardship console and syndrome reasoning (choose it as the active profile).</p>" +
      '<p class="v2-mut">The file is read and checked on this device. Nothing is uploaded. Patient identifiers in an isolate list are used only to keep the first isolate per patient and are then discarded; only the summary is saved.</p></section>';
    if (loc) {
      h += '<section class="v2-card"><h3>' + esc(loc.name) + "</h3><p>" + esc(loc.period || "") + " · " + esc(loc.method === "isolates" ? "from an isolate list (" + fmtN(loc.stats && loc.stats.isolates) + " isolates, " + fmtN(loc.stats && loc.stats.firstIsolates) + " first isolates per patient)" : "from a summary table") + " · " + loc.rows.length + " rows · saved " + esc((loc.imported || "").slice(0, 10)) + "</p>" +
        '<button class="v2-btn" data-v2="view-local">View it</button><button class="v2-btn" data-v2="use-local">Use as the active profile</button><button class="v2-btn v2-danger" data-v2="del-local">Remove from this device</button></section>';
    }
    h += '<section class="v2-card"><h3>' + (loc ? "Replace it" : "Import") + "</h3>" +
      '<div class="v2-seg" role="group" aria-label="File type"><button data-v2="imp-mode" data-v="summary" class="' + (st.impMode === "summary" ? "on" : "") + '">Summary table</button><button data-v2="imp-mode" data-v="isolates" class="' + (st.impMode === "isolates" ? "on" : "") + '">Isolate list</button></div>' +
      '<p class="v2-mut">' + (st.impMode === "summary" ? "A CSV with one row per organism: organism, specimen, setting, n (isolates), then one column per antibiotic holding % susceptible. Antibiotic columns may use names or laboratory codes (AMK, TZP, MEM...)." :
        "A CSV with one row per isolate: patient ID, date, specimen, location, organism, then one column per antibiotic holding S, I or R (a WHONET or laboratory export saved as CSV works if it has interpretations). StewardMD keeps the first isolate per patient per organism (CLSI M39) and computes % susceptible.") + "</p>" +
      '<button class="v2-btn" data-v2="template">Download a template</button>' +
      '<label class="v2-lab" for="v2Name">Name</label><input class="v2-in" id="v2Name" value="' + esc((st.imp && st.imp.name) || (loc && loc.name) || "") + '" placeholder="e.g. City Hospital 2025">' +
      '<label class="v2-lab" for="v2Period">Period</label><input class="v2-in" id="v2Period" value="' + esc((st.imp && st.imp.period) || "") + '" placeholder="e.g. January to December 2025">' +
      '<label class="v2-lab" for="v2File">File (CSV)</label><input type="file" id="v2File" accept=".csv,.txt,text/csv">' +
      '<label class="v2-lab" for="v2Paste">or paste the CSV</label><textarea class="v2-in" id="v2Paste" rows="4" placeholder="organism,specimen,setting,n,AMK,MEM,..."></textarea>' +
      '<button class="v2-btn v2-pri" data-v2="imp-check">Check</button></section>';
    if (st.imp && st.imp.res) {
      var r = st.imp.res;
      h += '<section class="v2-card" aria-live="polite"><h3>Check result</h3>';
      if (r.errors.length) h += '<div class="v2-note">' + r.errors.map(esc).join("<br>") + "</div>";
      if (st.impMode === "isolates" && r.isolates != null) h += "<p>" + fmtN(r.isolates) + " isolates read, " + fmtN(r.firstIsolates) + " kept as first isolates per patient and organism.</p>";
      if (r.rows.length) {
        var flags = 0, low = 0;
        r.rows.forEach(function (row) { var v = R0.validateRow(row); if (v.flags.indexOf("lowN") >= 0) low++; Object.keys(v.cells).forEach(function (d) { if (v.cells[d].act !== "keep") flags++; }); });
        h += "<p>" + r.rows.length + " rows ready. " + (low ? low + " rows have fewer than 30 isolates (shown greyed, never pooled). " : "") + (flags ? flags + " figures will carry a check (intrinsic resistance or a data problem); you will see why." : "All figures passed the checks.") + "</p>";
      }
      if (r.warnings.length) h += '<details><summary>' + r.warnings.length + " warnings</summary><ul class=\"v2-parts\">" + r.warnings.slice(0, 60).map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul></details>";
      if (r.rows.length && !r.errors.length) h += '<button class="v2-btn v2-pri" data-v2="imp-save">Save on this device</button>';
      h += "</section>";
    }
    return h + "</div>";
  }

  /* ------------------------------------------------------------------- files --- */
  function saveText(text, name, mime) {
    var P = window.Capacitor && window.Capacitor.Plugins;
    if (window.SMD_IS_NATIVE && P && P.Filesystem && P.Filesystem.writeFile && P.Filesystem.getUri && P.Share && P.Share.share) {
      return P.Filesystem.writeFile({ path: name, data: text, directory: "CACHE", encoding: "utf8" })
        .then(function () { return P.Filesystem.getUri({ path: name, directory: "CACHE" }); })
        .then(function (r) { return P.Share.share({ title: name, files: [r.uri], dialogTitle: "Save or share" }); });
    }
    try {
      var b = new Blob([text], { type: mime || "text/csv" }), u = URL.createObjectURL(b), a = document.createElement("a");
      a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
    } catch (e) {}
    return Promise.resolve();
  }
  function pdfHtml() {
    var t = S().table(st.scope, st.spec, st.set), R0 = R();
    var drugs = t.drugs.filter(function (d) { return t.orgs.some(function (o) { var c = o.cells[d]; return c && c.act !== "hide"; }); });
    var head = "<tr><th>Organism</th><th>Isolates</th>" + drugs.map(function (d) { return "<th>" + esc(R0.drugLabel(d)) + "</th>"; }).join("") + "</tr>";
    var body = t.orgs.map(function (o) {
      return "<tr><td><i>" + esc(orgLabel(o)) + "</i></td><td>" + (o.n == null ? "" : fmtN(o.n)) + "</td>" + drugs.map(function (d) {
        var c = o.cells[d]; if (!c) return "<td></td>"; if (c.act === "intrinsic") return "<td>IR</td>"; if (c.act !== "keep" && c.act !== "caution") return "<td></td>";
        return "<td>" + num(c.s) + (c.act === "caution" ? "*" : "") + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>Antibiogram</title><style>body{font:11px -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 4px;text-align:center}th:first-child,td:first-child{text-align:left}h1{font-size:16px}p{color:#444}</style></head><body>" +
      "<h1>Antibiogram: " + esc(S().scopeLabel(st.scope)) + "</h1><p>" + esc(R0.SPECIMENS[st.spec].label) + ", " + esc(R0.SETTINGS[st.set].label.toLowerCase()) + ". Percent susceptible. IR = intrinsic resistance; * = caution (see the app for the reason); rows under 30 isolates are unstable.</p>" +
      "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table><p>Exported from StewardMD on " + new Date().toISOString().slice(0, 10) + ". Decision support only; verify against the source.</p></body></html>";
  }

  /* ------------------------------------------------------------------ events --- */
  function sheet(api, html) { var el = api.root.querySelector("#abgV2Sheet"); if (!el) return; el.innerHTML = html; el.classList.toggle("on", !!html); if (html) { var x = el.querySelector(".v2-x"); if (x) x.focus(); } }
  function click(e, api) {
    var b = e.target.closest && e.target.closest("[data-v2]");
    if (!b) { if (e.target && e.target.id === "abgV2Sheet") { sheet(api, ""); return true; } return false; }
    var a = b.getAttribute("data-v2");
    if (a === "spec") { st.spec = b.getAttribute("data-v"); var sets = setsFor(st.scope, st.spec); if (sets.indexOf(st.set) < 0) st.set = sets[0] || "all"; persist(); api.render(); return true; }
    if (a === "set") { st.set = b.getAttribute("data-v"); persist(); api.render(); return true; }
    if (a === "mode") { st.mode = b.getAttribute("data-v"); persist(); api.render(); return true; }
    if (a === "cell") { sheet(api, cellSheet(st.scope, b.getAttribute("data-org"), b.getAttribute("data-pheno"), b.getAttribute("data-drug"))); return true; }
    if (a === "compare") { sheet(api, cellSheet("india", b.getAttribute("data-org"), b.getAttribute("data-pheno"), b.getAttribute("data-drug"))); return true; }
    if (a === "org") { sheet(api, orgSheet(b.getAttribute("data-org"), b.getAttribute("data-pheno"))); return true; }
    if (a === "drug") { sheet(api, drugSheet(b.getAttribute("data-drug"))); return true; }
    if (a === "sheet-close") { sheet(api, ""); return true; }
    if (a === "druginfo") { sheet(api, ""); if (api.openDrug) api.openDrug(R().drugLabel(b.getAttribute("data-drug"))); return true; }
    if (a === "dossier") { sheet(api, ""); if (api.openOrg) api.openOrg(R().orgLabel(b.getAttribute("data-org"))); return true; }
    if (a === "open-url") { var u = b.getAttribute("data-url"); try { window.open(u, "_blank", "noopener"); } catch (x) {} return true; }
    if (a === "pick-a") { st.drugA = b.getAttribute("data-drug"); api.render(); var w = api.root.querySelector(".v2-wis"); if (w && w.scrollIntoView) w.scrollIntoView({ block: "start" }); return true; }
    if (a === "csv") { var t = S().table(st.scope, st.spec, st.set); saveText(S().csv(t, { scope: S().scopeLabel(st.scope) }), "antibiogram-" + st.scope.replace(/[^a-z0-9]+/gi, "-") + "-" + st.spec + "-" + st.set + ".csv", "text/csv"); return true; }
    if (a === "pdf") { if (window.SMD_NATIVE && window.SMD_NATIVE.sharePdfFromHtml) window.SMD_NATIVE.sharePdfFromHtml(pdfHtml(), "antibiogram-" + st.spec, "Antibiogram").catch(function () {}); else saveText(pdfHtml(), "antibiogram.html", "text/html"); return true; }
    if (a === "src") { sheet(api, srcSheet(b.getAttribute("data-id"))); return true; }
    if (a === "view-src") { var s = S().sourceById(b.getAttribute("data-id")); if (s) { st.scope = s.kind === "network" ? "src:" + s.id : (s.latest ? "inst:" + s.inst : "src:" + s.id); st.spec = null; persist(); sheet(api, ""); api.setTab("resistance"); } return true; }
    if (a === "imp-mode") { st.impMode = b.getAttribute("data-v"); st.imp = null; api.render(); return true; }
    if (a === "template") { var R0 = R(); saveText(st.impMode === "summary" ? R0.summaryTemplate() : R0.isolateTemplate(), st.impMode === "summary" ? "antibiogram-summary-template.csv" : "antibiogram-isolates-template.csv", "text/csv"); return true; }
    if (a === "imp-check") { runImport(api); return true; }
    if (a === "imp-save") {
      var r = st.imp && st.imp.res; if (!r || !r.rows.length) return true;
      var obj = { name: (st.imp.name || "My hospital").slice(0, 80), period: (st.imp.period || "").slice(0, 80), method: st.impMode, imported: new Date().toISOString(), rows: r.rows,
        stats: { isolates: r.isolates || null, firstIsolates: r.firstIsolates || null } };
      if (S().localSave(obj)) { st.imp = null; st.scope = "local"; st.spec = null; persist(); api.toast && api.toast("Saved on this device"); api.setTab("resistance"); }
      else api.toast && api.toast("Could not save on this device (storage full or blocked)");
      return true;
    }
    if (a === "view-local") { st.scope = "local"; st.spec = null; persist(); api.setTab("resistance"); return true; }
    if (a === "use-local") { try { if (window.HOSPITAL && window.HOSPITAL.setProfile) window.HOSPITAL.setProfile("LOCAL"); } catch (x) {} api.toast && api.toast("Your hospital is now the active profile"); return true; }
    if (a === "del-local") { if (window.confirm && !window.confirm("Remove your hospital's antibiogram from this device?")) return true; S().localClear(); if (st.scope === "local") st.scope = null; api.render(); return true; }
    return false;
  }
  function runImport(api) {
    var root = api.root, name = (root.querySelector("#v2Name") || {}).value || "", period = (root.querySelector("#v2Period") || {}).value || "";
    var file = root.querySelector("#v2File"), paste = (root.querySelector("#v2Paste") || {}).value || "";
    var go = function (text) {
      var res = st.impMode === "summary" ? R().importSummaryCsv(text) : R().importIsolateCsv(text);
      st.imp = { name: name.trim(), period: period.trim(), res: res }; api.render();
    };
    if (file && file.files && file.files[0]) {
      var f = file.files[0];
      if (f.size > 20 * 1024 * 1024) { st.imp = { name: name, period: period, res: { rows: [], errors: ["The file is larger than 20 MB."], warnings: [] } }; api.render(); return; }
      var fr = new FileReader(); fr.onload = function () { go(String(fr.result || "")); }; fr.onerror = function () { st.imp = { name: name, period: period, res: { rows: [], errors: ["The file could not be read."], warnings: [] } }; api.render(); }; fr.readAsText(f);
    } else if (paste.trim()) go(paste);
    else { st.imp = { name: name, period: period, res: { rows: [], errors: ["Choose a CSV file or paste the table first."], warnings: [] } }; api.render(); }
  }
  function change(e, api) {
    var id = e.target && e.target.id;
    if (id === "v2Scope") { st.scope = e.target.value; st.spec = null; st.drugA = ""; st.drugB = ""; persist(); syncProfile(); api.render(); return true; }
    if (id === "v2DrugA") { st.drugA = e.target.value; api.render(); return true; }
    if (id === "v2DrugB") { st.drugB = e.target.value; api.render(); return true; }
    if (id === "v2Cons") { st.cons = !!e.target.checked; api.render(); return true; }
    if (id === "v2NoRes") { st.noReserve = !!e.target.checked; persist(); api.render(); return true; }
    return false;
  }
  function input(e, api) {
    var id = e.target && e.target.id;
    if (id === "v2Q") { st.q = e.target.value; var pos = e.target.selectionStart; api.render(); var el = api.root.querySelector("#v2Q"); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) {} } return true; }
    if (id === "v2SrcQ") { st.srcQ = e.target.value; var p2 = e.target.selectionStart; api.render(); var e2 = api.root.querySelector("#v2SrcQ"); if (e2) { e2.focus(); try { e2.setSelectionRange(p2, p2); } catch (x) {} } return true; }
    return false;
  }
  // Keep the app-wide profile (reasoning, stewardship console) in step with the chosen source.
  function syncProfile() {
    try {
      if (!(window.HOSPITAL && window.HOSPITAL.profileForScope && window.HOSPITAL.setProfile)) return;
      var pid = window.HOSPITAL.profileForScope(st.scope); if (pid) window.HOSPITAL.setProfile(pid);
    } catch (e) {}
  }
  function render(tab, rerender) {
    if (tab === "resistance") return resistance(rerender);
    if (tab === "sources") return sources();
    if (tab === "mine") return mine();
    return "";
  }

  var css = [
    ".v2{display:flex;flex-direction:column;gap:12px;padding-bottom:28px}",
    ".v2-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.v2-lab{font:800 11px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--mut);display:block;margin-top:6px}",
    ".v2-sel{flex:1;min-width:0;max-width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:700 14px var(--f);background:var(--panel);color:var(--ink)}",
    ".v2-chips{display:flex;gap:6px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}.v2-chip{flex:0 0 auto;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:8px 12px;font:700 13px var(--f);min-height:36px}",
    ".v2-chip.on{background:var(--tl);border-color:var(--tl);color:#fff}.v2-chip2.on{background:var(--ink);border-color:var(--ink);color:var(--bg)}",
    ".v2-tools{display:flex;gap:8px;flex-wrap:wrap}.v2-q,.v2-in{flex:1;min-width:180px;border:1px solid var(--line);border-radius:10px;padding:10px;font:500 14px var(--f);background:var(--panel);color:var(--ink);width:100%;box-sizing:border-box}",
    ".v2-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}.v2-seg button{border:0;background:var(--panel);color:var(--ink);padding:8px 12px;font:700 12.5px var(--f);min-height:36px}.v2-seg button.on{background:var(--tl);color:#fff}",
    ".v2-meta{font:500 12.5px/1.5 var(--f);color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px}.v2-mut{color:var(--mut);font:500 12px/1.45 var(--f)}",
    ".v2-link{border:0;background:none;color:var(--tl);font:700 12.5px var(--f);padding:4px 0;text-decoration:underline;cursor:pointer}",
    ".v2-ph{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}.v2-phc{flex:0 0 150px;border-radius:12px;padding:10px;border:1px solid var(--line);background:var(--panel)}",
    ".v2-phc.hi{border-color:#b91c1c}.v2-phc.mid{border-color:#d97706}.v2-phc.lo{border-color:#15803d}.v2-php{font:800 20px var(--f);color:var(--ink)}.v2-phc.hi .v2-php{color:#b91c1c}.v2-phc.mid .v2-php{color:#b45309}.v2-phc.lo .v2-php{color:#15803d}",
    "body.dark .v2-phc.hi .v2-php{color:#f87171}body.dark .v2-phc.mid .v2-php{color:#fbbf24}body.dark .v2-phc.lo .v2-php{color:#4ade80}",
    ".v2-phl{font:700 12px/1.3 var(--f);color:var(--ink)}.v2-phn{font:500 11px/1.3 var(--f);color:var(--mut);margin-top:3px}",
    ".v2-tw{overflow:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:12px;background:var(--panel);max-height:70vh}",
    ".v2-t{border-collapse:separate;border-spacing:0;font:600 12.5px var(--f);color:var(--ink)}.v2-t th,.v2-t td{border-bottom:1px solid var(--line);padding:0}",
    ".v2-t thead th{position:sticky;top:0;background:var(--panel);z-index:2}.v2-oh,.v2-o{position:sticky;left:0;background:var(--panel);z-index:3;text-align:left;min-width:128px;max-width:150px}",
    ".v2-t thead .v2-oh{z-index:4}.v2-o button{border:0;background:none;color:var(--ink);font:700 12.5px var(--f);text-align:left;padding:8px;cursor:pointer;width:100%}",
    ".v2-nh,.v2-n{font:600 11px var(--f);color:var(--mut);padding:6px!important;white-space:nowrap;text-align:right}",
    ".v2-dh{vertical-align:bottom;height:112px;min-width:40px}.v2-dh button{border:0;background:none;color:var(--ink);font:700 11.5px var(--f);writing-mode:vertical-rl;transform:rotate(180deg);padding:6px 4px;cursor:pointer;white-space:nowrap}",
    ".v2-c{text-align:center;min-width:40px;height:38px;font:800 12.5px var(--f);cursor:pointer;border-left:1px solid var(--line)}",
    ".v2-c.b5{background:#15803d;color:#fff}.v2-c.b4{background:#65a30d;color:#fff}.v2-c.b3{background:#fde68a;color:#422006}.v2-c.b2{background:#fb923c;color:#1c0a00}.v2-c.b1{background:#b91c1c;color:#fff}",
    ".v2-c.v2-low{background:repeating-linear-gradient(45deg,var(--panel),var(--panel) 4px,var(--line) 4px,var(--line) 5px);color:var(--mut);font-style:italic}",
    ".v2-c.v2-cau{background:repeating-linear-gradient(135deg,var(--panel),var(--panel) 5px,var(--line) 5px,var(--line) 6px);color:var(--ink);text-decoration:underline dotted}.v2-c.v2-ir{color:var(--mut);font:800 10.5px var(--f)}.v2-c.v2-x{color:#b91c1c}.v2-c.v2-na{cursor:default}",
    ".v2-lowrow .v2-o button{color:var(--mut)}.v2-der{display:inline-block;margin:0 8px 6px;font:700 10px var(--f);color:var(--mut);border:1px solid var(--line);border-radius:6px;padding:1px 5px}",
    ".v2-aw{display:inline-block;font:800 9.5px var(--f);border-radius:5px;padding:1px 4px;margin:2px;color:#fff}.v2-awA{background:#15803d}.v2-awW{background:#b45309}.v2-awR{background:#7c3aed}",
    ".v2-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font:600 11.5px var(--f);color:var(--ink)}.v2-sw{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-2px;margin-right:4px}",
    ".v2-sw.b5{background:#15803d}.v2-sw.b4{background:#65a30d}.v2-sw.b3{background:#fde68a}.v2-sw.b2{background:#fb923c}.v2-sw.b1{background:#b91c1c}",
    ".v2-wis,.v2-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px}.v2-wis h3,.v2-card h3{margin:0 0 6px;font:800 15px var(--f);color:var(--ink)}",
    ".v2-card p{font:500 13px/1.5 var(--f);color:var(--ink);margin:6px 0}.v2-wrow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.v2-plus{font:800 16px var(--f);color:var(--mut)}",
    ".v2-chk{display:flex;gap:8px;align-items:center;font:600 12.5px var(--f);color:var(--ink);margin-top:8px}",
    ".v2-wres{margin-top:10px;font:500 13px/1.5 var(--f);color:var(--ink)}.v2-wbig{font:800 26px var(--f);color:var(--tl)}.v2-wdet{margin:6px 0 0;padding-left:18px;font:500 12.5px/1.6 var(--f)}",
    ".v2-rank{margin-top:12px}.v2-rankh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;font:600 13px var(--f);color:var(--ink)}.v2-rank ol{padding-left:22px;margin:8px 0;font:500 13px/1.8 var(--f);color:var(--ink)}",
    ".v2-rank ol button{border:0;background:none;color:var(--tl);font:700 13px var(--f);padding:0;cursor:pointer;text-decoration:underline}",
    ".v2-btn{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:10px 14px;font:700 13px var(--f);margin:6px 6px 0 0;min-height:40px;cursor:pointer}.v2-pri{background:var(--tl);border-color:var(--tl);color:#fff}.v2-danger{color:#b91c1c;border-color:#b91c1c}",
    ".v2-foot p{margin-top:10px}.v2-empty{padding:30px 16px;text-align:center;font:600 14px var(--f);color:var(--mut)}.v2-spin{width:26px;height:26px;border:3px solid var(--line);border-top-color:var(--tl);border-radius:50%;margin:0 auto 10px;animation:v2s 1s linear infinite}",
    "@keyframes v2s{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.v2-spin{animation:none}}",
    ".v2-gh{font:800 13px var(--f);text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:14px 0 4px}.v2-src{list-style:none;margin:0;padding:0}.v2-src li{border-bottom:1px solid var(--line)}",
    ".v2-src button,.v2-src li>div{border:0;background:none;width:100%;text-align:left;padding:10px 4px;font:600 13.5px/1.4 var(--f);color:var(--ink);cursor:pointer}.v2-kind{font:700 10px var(--f);border:1px solid var(--line);border-radius:6px;padding:1px 5px;color:var(--mut);text-transform:uppercase}",
    "#abgV2Sheet{position:fixed;inset:0;z-index:960;background:rgba(15,23,42,.45);display:none;align-items:flex-end;justify-content:center}#abgV2Sheet.on{display:flex}",
    ".v2-sh{background:var(--panel);color:var(--ink);width:100%;max-width:640px;max-height:88vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));font:500 13.5px/1.5 var(--f)}",
    ".v2-shh{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;font:800 16px/1.3 var(--f)}.v2-x{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:9px;padding:7px 11px;font:700 12.5px var(--f);cursor:pointer}",
    ".v2-big{display:inline-block;margin:10px 0 4px;padding:6px 12px;border-radius:10px;font:800 20px var(--f)}.v2-big.b5{background:#15803d;color:#fff}.v2-big.b4{background:#65a30d;color:#fff}.v2-big.b3{background:#fde68a;color:#422006}.v2-big.b2{background:#fb923c;color:#1c0a00}.v2-big.b1{background:#b91c1c;color:#fff}",
    ".v2-note{margin:10px 0;padding:10px 12px;border-radius:10px;background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.4);font:600 12.5px/1.5 var(--f);color:var(--ink)}",
    ".v2-sh h4{margin:14px 0 6px;font:800 12px var(--f);text-transform:uppercase;letter-spacing:.05em;color:var(--mut)}.v2-parts{list-style:none;padding:0;margin:0}.v2-parts li{padding:8px 0;border-bottom:1px solid var(--line)}",
    ".v2-parts li.v2-dim{opacity:.62}.v2-pl{font:600 13px var(--f)}.v2-bar2{position:relative;height:18px;background:var(--line);border-radius:6px;margin-top:4px;overflow:hidden}",
    ".v2-bar2 i{position:absolute;left:0;top:0;bottom:0;background:var(--tl)}.v2-bar2 i.b5{background:#15803d}.v2-bar2 i.b4{background:#65a30d}.v2-bar2 i.b3{background:#eab308}.v2-bar2 i.b2{background:#fb923c}.v2-bar2 i.b1{background:#b91c1c}",
    ".v2-bar2 span{position:relative;font:800 11.5px/18px var(--f);padding-left:6px;color:var(--ink);mix-blend-mode:normal}.v2-spark{width:220px;height:60px;color:var(--tl);margin-top:6px}.v2-spark circle{fill:currentColor}.v2-spark text{fill:var(--ink)}",
    "@media (min-width:760px){.v2-sh{border-radius:18px;margin-bottom:6vh}#abgV2Sheet{align-items:center}}"
  ].join("");

  window.ABG_V2 = { on: on, render: render, click: click, change: change, input: input, css: css, state: st,
    tabs: function () { return on() ? [["resistance", "Resistance rates"], ["sources", "Sources"], ["mine", "My hospital"]] : null; },
    _cellSheet: cellSheet, _pdfHtml: pdfHtml };
})();
