/* ============================================================================
   StewardMD — Government Health Schemes browser (window.SMD_GOVSCHEMES)
   Full-screen overlay over India's state/UT/central government health-assurance scheme
   packages (rates, native codes, investigations, provenance). Copies the Drugs Database
   overlay pattern in api.js (search "Drugs Database — full-screen browser overlay"):
   ensureRoot/#gsOverlay/.gs-top with a real Back button (aria-label="Back" so swipe-back.js
   picks it up for free), z-index above home, same-origin fetch. This module's CSS is a real
   file (govschemes.css, linked in index.html) rather than injected from JS - patient-register.js
   uses the same split; api.js injects its own CSS from JS - both patterns exist in this app.

   Flag: smd_govt_schemes (govschemes-flags.js / window.SMD_GOVSCHEMES_FLAGS), default ON as of
   2026-09-04 - see vault/modules/Government Health Schemes.md and vault/decisions/Decisions.md.
   The data is unverified government reference data (admin review pass not yet run), so every
   detail panel shows the source's verification_status and flags an "unverified" source visibly.

   Two entry modes, a segmented tab under the search bar (2026-09-04 redesign - the old
   search-only screen scored 1/10 with the owner: no way to see what's there without already
   knowing what to type):
     - Browse: tap-only drill-down, no typing required. States (with package counts) -> Schemes
       /branches within a state (skipped automatically when a state has exactly one scheme -
       true for 26 of 29 states/UTs today) -> Specialities/categories (chip grid with counts,
       "Other / uncategorised" bucket last for packages with no speciality tag) -> paginated
       package list. A breadcrumb bar appears once drilled past the state level; each crumb is
       tappable to jump back a level.
     - Search: the original free-text / native-code search + optional state filter + compare
       -across-states mode, unchanged in behaviour.

   API contract this module calls (same-origin Cloudflare Pages Functions, functions/api/schemes/,
   field names verified against functions/_schemes_repo.js):
     GET /api/schemes/jurisdictions              -> { jurisdictions: [ { id, name, type, schemes, packages } ] }
     GET /api/schemes/schemes?state=              -> { schemes: [ { id, name, authority, packages } ] }
     GET /api/schemes/specialities?state=&scheme= -> { specialities: [ { code, name, packages } ] }
     GET /api/schemes/browse?state=&scheme=&speciality=&limit=&offset=
                                                   -> { results: [ ...packages ], total }
     GET /api/schemes/search?q=&state=&limit=
                                                   -> { results: [ { package_id, treatment_name, treatment_code,
                                                        speciality_name, package_amount, rate_tier,
                                                        scheme, state, version_label } ] }
     GET /api/schemes/package/<id>                -> { package_id, treatment_name, treatment_code, treatment_type,
                                                        speciality_code, speciality_name, package_code,
                                                        package_name, package_amount, rider_amount, rate_tier,
                                                        los_days, pre_investigation, post_investigation,
                                                        eligibility, documentation, preauth_required,
                                                        implant_criteria, stratification_criteria, icd_code,
                                                        ichi_code, version_label, scheme, state,
                                                        source: { authority, url, retrieved_ts, verification_status } }
     GET /api/schemes/compare?q=                  -> { groups: [ { treatment_name_normalised,
                                                        rows: [ { treatment_name, state, treatment_code,
                                                        package_amount, rate_tier } ] } ] }
   Every fetch fails safe (network error / non-2xx / bad JSON -> null), and every screen shows
   explicit text on empty/error - never a blank panel.
   ========================================================================== */
(function () {
  "use strict";

  var MINLEN = 2, DEBOUNCE = 250, PAGE = 40;

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function el(id) { return document.getElementById(id); }
  // Shared monochrome SVG icon accessor (window.ICONS catalog from home.js), guarded for load
  // order exactly like api.js's dbIco() - empty-string fallback keeps layout intact if ICONS
  // isn't loaded yet (home.js loads before this module, but degrade gracefully regardless).
  function gsIco(n, cls) { return (window.ICONS && ICONS.get) ? ICONS.get(n, cls || "gs-ico") : ""; }
  function inr(n) {
    var v = Number(n);
    if (!isFinite(v) || v <= 0) return "";
    return "₹" + v.toLocaleString("en-IN");
  }
  function g(o, k) { return (o && o[k] != null) ? o[k] : ""; }

  function api(path) {
    return fetch(path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  var GSAPI = {
    jurisdictions: function () { return api("/api/schemes/jurisdictions"); },
    schemesFor: function (stateId) { return api("/api/schemes/schemes?state=" + encodeURIComponent(stateId)); },
    specialities: function (stateId, schemeId) {
      var p = "/api/schemes/specialities?state=" + encodeURIComponent(stateId);
      if (schemeId) p += "&scheme=" + encodeURIComponent(schemeId);
      return api(p);
    },
    browse: function (opts) {
      opts = opts || {};
      var p = "/api/schemes/browse?limit=" + (opts.limit || PAGE) + "&offset=" + (opts.offset || 0);
      p += "&state=" + encodeURIComponent(opts.stateId);
      if (opts.schemeId) p += "&scheme=" + encodeURIComponent(opts.schemeId);
      if (opts.speciality != null) p += "&speciality=" + encodeURIComponent(opts.speciality);
      return api(p);
    },
    search: function (q, jurisdiction, limit) {
      var p = "/api/schemes/search?q=" + encodeURIComponent(q) + "&limit=" + (limit || 40);
      if (jurisdiction) p += "&state=" + encodeURIComponent(jurisdiction);
      return api(p);
    },
    pkg: function (id) { return api("/api/schemes/package/" + encodeURIComponent(id)); },
    compare: function (q) { return api("/api/schemes/compare?q=" + encodeURIComponent(q)); }
  };

  var root = null, timer = null, seq = 0;
  var st = {
    view: "list", mode: "browse", q: "", jurisdiction: "", compare: false, jur: null,
    // browse.level: "states" | "schemes" | "specialities" | "packages"
    browse: { level: "states", stateId: "", stateName: "", schemes: null, schemeId: "", schemeName: "",
      specialities: null, speciality: null, specialityName: "", rows: [], total: 0, offset: 0 }
  };

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "gsOverlay"; root.className = "gs-overlay";
    root.innerHTML =
      '<div class="gs-top">' +
        '<button class="gs-back" id="gsBack" aria-label="Back">‹ Back</button>' +
        '<div class="gs-title" id="gsTitle">Scheme Search</div>' +
        '<span class="gs-top-sp"></span>' +
      '</div>' +
      '<div class="gs-body" id="gsBody"></div>';
    document.body.appendChild(root);
    root.querySelector("#gsBack").addEventListener("click", function () {
      if (st.view === "detail") { st.view = "list"; renderList(); return; }
      if (st.mode === "browse" && st.browse.level !== "states") { browseUp(); return; }
      close();
    });
    loadJurisdictions();
    return root;
  }
  function setTitle(t) { var e = root.querySelector("#gsTitle"); if (e) e.textContent = t; }

  function loadJurisdictions() {
    GSAPI.jurisdictions().then(function (d) {
      st.jur = (d && d.jurisdictions) || [];
      var sel = root.querySelector("#gsState");
      if (sel) fillStateSelect(sel);
      if (st.mode === "browse" && st.browse.level === "states") renderBrowseBody();
    });
  }
  function fillStateSelect(sel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">All India</option>' +
      (st.jur || []).map(function (j) { return '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>"; }).join("");
    sel.value = cur || st.jurisdiction || "";
  }

  /* ---------------- shell: tabs + breadcrumb + body ---------------- */
  function renderList() {
    setTitle("Scheme Search");
    var b = root.querySelector("#gsBody");
    b.innerHTML =
      '<div class="gs-tabs">' +
        '<button type="button" class="gs-tab' + (st.mode === "browse" ? " on" : "") + '" data-m="browse">Browse</button>' +
        '<button type="button" class="gs-tab' + (st.mode === "search" ? " on" : "") + '" data-m="search">Search</button>' +
      '</div>' +
      '<div id="gsCrumbs"></div>' +
      '<div id="gsMode"></div>';
    b.querySelectorAll(".gs-tab").forEach(function (t) {
      t.addEventListener("click", function () { st.mode = t.getAttribute("data-m"); renderList(); });
    });
    if (st.mode === "browse") renderBrowseShell(); else renderSearchShell();
  }

  function renderCrumbs() {
    var c = root.querySelector("#gsCrumbs"); if (!c) return;
    if (st.mode !== "browse" || st.browse.level === "states") { c.innerHTML = ""; return; }
    var parts = [];
    parts.push({ t: st.browse.stateName, lvl: "states" });
    if (st.browse.schemes && st.browse.schemes.length > 1) parts.push({ t: st.browse.schemeName, lvl: "schemes" });
    if (st.browse.level === "specialities" || st.browse.level === "packages") {
      parts.push({ t: st.browse.level === "packages" ? (st.browse.specialityName || "All categories") : "Category", lvl: "specialities", current: st.browse.level === "specialities" });
    }
    c.innerHTML = '<div class="gs-crumbs">' + parts.map(function (p, i) {
      var last = i === parts.length - 1;
      return '<button type="button" class="gs-crumb' + (last ? " cur" : "") + '" data-lvl="' + p.lvl + '"' + (last ? " disabled" : "") + '>' + esc(p.t) + '</button>' +
        (last ? "" : '<span class="gs-crumb-sep">›</span>');
    }).join("") + '</div>';
    c.querySelectorAll(".gs-crumb:not([disabled])").forEach(function (btn) {
      btn.addEventListener("click", function () { jumpToLevel(btn.getAttribute("data-lvl")); });
    });
  }
  function jumpToLevel(lvl) {
    if (lvl === "states") { st.browse.level = "states"; st.browse.stateId = ""; }
    else if (lvl === "schemes") { st.browse.level = "schemes"; }
    else if (lvl === "specialities") { st.browse.level = "specialities"; }
    renderBrowseBody();
  }
  function browseUp() {
    var lvl = st.browse.level;
    if (lvl === "packages") jumpToLevel(st.browse.schemes && st.browse.schemes.length > 1 ? "schemes" : (st.browse.specialities ? "specialities" : "schemes"));
    else if (lvl === "specialities") jumpToLevel(st.browse.schemes && st.browse.schemes.length > 1 ? "schemes" : "states");
    else if (lvl === "schemes") jumpToLevel("states");
    else close();
  }

  /* ---------------- Browse: states -> schemes -> specialities -> packages ---------------- */
  function renderBrowseShell() {
    var m = root.querySelector("#gsMode");
    m.innerHTML = '<div id="gsBrowse" class="gs-browse"></div>';
    renderCrumbs();
    renderBrowseBody();
  }
  function renderBrowseBody() {
    var m = root.querySelector("#gsBrowse"); if (!m) return;
    renderCrumbs();
    if (st.browse.level === "states") return renderStatesGrid(m);
    if (st.browse.level === "schemes") return renderSchemesList(m);
    if (st.browse.level === "specialities") return renderSpecialitiesGrid(m);
    if (st.browse.level === "packages") return renderBrowsePackages(m);
  }
  function renderStatesGrid(m) {
    if (!st.jur) { m.innerHTML = '<div class="gs-hint">Loading states…</div>'; return; }
    if (!st.jur.length) { m.innerHTML = '<div class="gs-err">Could not reach the government schemes service. Check your connection and try again.</div>'; return; }
    m.innerHTML = '<div class="gs-cat-grid">' + st.jur.map(function (j) {
      return '<button type="button" class="gs-cat" data-id="' + esc(j.id) + '" data-name="' + esc(j.name) + '">' +
        '<span class="gs-cat-name">' + esc(j.name) + '</span>' +
        '<span class="gs-cat-count">' + (j.packages || 0).toLocaleString("en-IN") + ' package' + (j.packages === 1 ? "" : "s") + '</span>' +
      '</button>';
    }).join("") + '</div>';
    m.querySelectorAll(".gs-cat").forEach(function (c) {
      c.addEventListener("click", function () { pickState(c.getAttribute("data-id"), c.getAttribute("data-name")); });
    });
  }
  function pickState(id, name) {
    st.browse.stateId = id; st.browse.stateName = name;
    st.browse.level = "schemes"; st.browse.schemes = null;
    renderBrowseBody();
    GSAPI.schemesFor(id).then(function (d) {
      if (st.browse.stateId !== id) return;
      var list = (d && d.schemes) || [];
      st.browse.schemes = list;
      if (list.length <= 1) {
        st.browse.schemeId = list[0] ? list[0].id : "";
        st.browse.schemeName = list[0] ? list[0].name : "";
        pickScheme(st.browse.schemeId, st.browse.schemeName, true);
      } else {
        renderBrowseBody();
      }
    });
  }
  function renderSchemesList(m) {
    if (st.browse.schemes == null) { m.innerHTML = '<div class="gs-hint">Loading schemes in ' + esc(st.browse.stateName) + '…</div>'; return; }
    if (!st.browse.schemes.length) { m.innerHTML = '<div class="gs-empty">No schemes on file yet for ' + esc(st.browse.stateName) + '. Try Search instead.</div>'; return; }
    m.innerHTML = st.browse.schemes.map(function (s) {
      return '<button type="button" class="gs-card gs-schemecard" data-id="' + esc(s.id) + '" data-name="' + esc(s.name) + '">' +
        '<div class="gs-card-name">' + esc(s.name) + '</div>' +
        (s.authority ? '<div class="gs-scheme-auth">' + esc(s.authority) + '</div>' : "") +
        '<div class="gs-cat-count">' + (s.packages || 0).toLocaleString("en-IN") + ' package' + (s.packages === 1 ? "" : "s") + '</div>' +
      '</button>';
    }).join("");
    m.querySelectorAll(".gs-schemecard").forEach(function (c) {
      c.addEventListener("click", function () { pickScheme(c.getAttribute("data-id"), c.getAttribute("data-name")); });
    });
  }
  function pickScheme(id, name, skipRender) {
    st.browse.schemeId = id; st.browse.schemeName = name;
    st.browse.level = "specialities"; st.browse.specialities = null;
    if (!skipRender) renderBrowseBody(); else renderCrumbs();
    GSAPI.specialities(st.browse.stateId, id).then(function (d) {
      if (st.browse.schemeId !== id) return;
      var list = (d && d.specialities) || [];
      st.browse.specialities = list;
      // No real category data for this scheme (source never carried a speciality tag) - the
      // grid would only ever show "All categories" next to an identical "Other" bucket, so skip
      // straight to the package list rather than making the clinician pick between duplicates.
      if (list.length === 1 && list[0].code === "" && list[0].name === "Other / uncategorised") {
        pickSpeciality(null, "", true);
      } else if (st.browse.level === "specialities") {
        renderBrowseBody();
      }
    });
  }
  function renderSpecialitiesGrid(m) {
    if (st.browse.specialities == null) { m.innerHTML = '<div class="gs-hint">Loading categories…</div>'; return; }
    if (!st.browse.specialities.length) { pickSpeciality(null, "", true); return; }
    var chips = '<button type="button" class="gs-cat gs-cat-all" data-spec="">' +
      '<span class="gs-cat-name">All categories</span>' +
      '<span class="gs-cat-count">Browse every package</span></button>';
    chips += st.browse.specialities.map(function (sp) {
      return '<button type="button" class="gs-cat" data-spec="' + esc(sp.name === "Other / uncategorised" ? "" : sp.name) + '" data-label="' + esc(sp.name) + '">' +
        '<span class="gs-cat-name">' + esc(sp.name) + '</span>' +
        '<span class="gs-cat-count">' + (sp.packages || 0).toLocaleString("en-IN") + '</span></button>';
    }).join("");
    m.innerHTML = '<div class="gs-cat-grid">' + chips + '</div>';
    m.querySelectorAll(".gs-cat").forEach(function (c) {
      c.addEventListener("click", function () {
        var spec = c.hasAttribute("data-spec") && c.getAttribute("data-spec") !== "" ? c.getAttribute("data-spec") : (c.classList.contains("gs-cat-all") ? null : "");
        var label = c.classList.contains("gs-cat-all") ? "" : (c.getAttribute("data-label") || "");
        pickSpeciality(spec, label);
      });
    });
  }
  // spec: null = no filter (All categories), "" = the Other/uncategorised bucket, else exact speciality_name.
  function pickSpeciality(spec, label, skipRender) {
    st.browse.speciality = spec; st.browse.specialityName = label;
    st.browse.level = "packages"; st.browse.rows = null; st.browse.total = 0; st.browse.offset = 0;
    if (!skipRender) renderBrowseBody(); else renderCrumbs();
    loadBrowsePage(true);
  }
  function loadBrowsePage(reset) {
    var mySeq = ++seq;
    var opts = { stateId: st.browse.stateId, schemeId: st.browse.schemeId, speciality: st.browse.speciality, offset: reset ? 0 : st.browse.offset };
    GSAPI.browse(opts).then(function (d) {
      if (mySeq !== seq) return;
      if (d == null) { renderBrowsePackagesError(); return; }
      if (reset) st.browse.rows = (d.results || []); else st.browse.rows = st.browse.rows.concat(d.results || []);
      st.browse.total = d.total || 0;
      st.browse.offset = st.browse.rows.length;
      var m = root.querySelector("#gsBrowse"); if (m) renderBrowsePackages(m);
    });
  }
  function renderBrowsePackagesError() {
    var m = root.querySelector("#gsBrowse"); if (!m) return;
    m.innerHTML = '<div class="gs-err">Could not reach the government schemes service. Check your connection and try again.</div>';
  }
  function renderBrowsePackages(m) {
    if (st.browse.rows === null) { m.innerHTML = '<div class="gs-hint">Loading packages…</div>'; return; }
    if (!st.browse.rows.length) {
      m.innerHTML = '<div class="gs-empty">No packages in this category yet. Try "All categories" or Search instead.</div>';
      return;
    }
    var html = st.browse.rows.map(function (x) { return rowHTML(x, { showSpeciality: !st.browse.speciality && st.browse.speciality !== "" }); }).join("");
    if (st.browse.rows.length < st.browse.total) {
      html += '<button type="button" class="gs-more" id="gsMore">Show more (' + (st.browse.total - st.browse.rows.length).toLocaleString("en-IN") + ' left)</button>';
    }
    m.innerHTML = html;
    m.querySelectorAll(".gs-card[data-id]").forEach(function (c) { c.addEventListener("click", function () { openDetail(c.getAttribute("data-id")); }); });
    var more = m.querySelector("#gsMore");
    if (more) more.addEventListener("click", function () { more.textContent = "Loading…"; more.disabled = true; loadBrowsePage(false); });
  }

  /* ---------------- Search: free text + state filter + compare toggle ---------------- */
  function renderSearchShell() {
    var m = root.querySelector("#gsMode");
    m.innerHTML =
      '<div class="gs-searchbar">' + gsIco("search", "gs-ico gs-search-ic") +
        '<input id="gsSearch" class="gs-search" type="text" autocomplete="off" ' +
        'placeholder="Disease, procedure or govt code, e.g. mastectomy, S7.1.5.1" value="' + esc(st.q) + '"></div>' +
      '<div class="gs-row2">' +
        '<select id="gsState" class="gs-state"' + (st.compare ? " disabled" : "") + '><option value="">All India</option></select>' +
        '<label class="gs-cmp"><input type="checkbox" id="gsCmp"' + (st.compare ? " checked" : "") + '> Compare across states</label>' +
      '</div>' +
      '<div id="gsResults" class="gs-results"></div>';
    var sel = m.querySelector("#gsState");
    if (st.jur) fillStateSelect(sel); else sel.value = "";
    var si = m.querySelector("#gsSearch");
    si.addEventListener("input", function () { onQueryInput(si.value); });
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    sel.addEventListener("change", function () { st.jurisdiction = sel.value; runQuery(); });
    m.querySelector("#gsCmp").addEventListener("change", function (e) { st.compare = e.target.checked; renderSearchShell(); runQuery(); });
    setTimeout(function () { try { si.focus(); } catch (e) {} }, 50);
    runQuery();
  }
  function onQueryInput(v) {
    st.q = (v || "").trim();
    if (timer) clearTimeout(timer);
    timer = setTimeout(runQuery, DEBOUNCE);
  }
  function runQuery() {
    var r = root.querySelector("#gsResults"); if (!r) return;
    if (st.q.length < MINLEN) {
      r.innerHTML = '<div class="gs-hint">Type a disease, procedure or government code to search scheme packages - or switch to Browse to look without typing.</div>';
      return;
    }
    r.innerHTML = '<div class="gs-hint">Searching…</div>';
    var mySeq = ++seq, q = st.q;
    var p = st.compare ? GSAPI.compare(q) : GSAPI.search(q, st.jurisdiction);
    p.then(function (d) {
      if (mySeq !== seq || q !== st.q) return;
      if (d == null) { r.innerHTML = '<div class="gs-err">Could not reach the government schemes service. Check your connection and try again.</div>'; return; }
      st.compare ? renderCompareResults(r, d, q) : renderSearchResults(r, d, q);
    });
  }
  function renderSearchResults(r, d, q) {
    var rows = (d && d.results) || [];
    if (!rows.length) { r.innerHTML = '<div class="gs-empty">No scheme packages match “' + esc(q) + '”. Try a shorter term, or switch to Browse.</div>'; return; }
    r.innerHTML = rows.map(function (x) { return rowHTML(x, { showState: true, showScheme: true }); }).join("");
    r.querySelectorAll(".gs-card[data-id]").forEach(function (c) { c.addEventListener("click", function () { openDetail(c.getAttribute("data-id")); }); });
  }
  // opts: { showState, showScheme, showSpeciality } - which context pills to show. Browse views
  // already filtered to one state/scheme so those pills would be redundant noise there; Search
  // results span states so they need the pills instead. Code + amount + tier are always shown -
  // they're the reason this tool exists.
  function rowHTML(x, opts) {
    opts = opts || {};
    var amt = inr(x.package_amount), tier = g(x, "rate_tier"), code = g(x, "treatment_code");
    var pills = "";
    if (opts.showScheme && g(x, "scheme")) pills += '<span class="gs-pill">' + esc(x.scheme) + '</span>';
    if (opts.showState && g(x, "state")) pills += '<span class="gs-pill">' + esc(x.state) + '</span>';
    if (opts.showSpeciality && g(x, "speciality_name")) pills += '<span class="gs-pill">' + esc(x.speciality_name) + '</span>';
    return '<button type="button" class="gs-card" data-id="' + esc(x.package_id) + '">' +
      (code ? '<div class="gs-card-code">' + esc(code) + '</div>' : "") +
      '<div class="gs-card-name">' + esc(g(x, "treatment_name")) + '</div>' +
      (pills ? '<div class="gs-pills">' + pills + '</div>' : "") +
      '<div class="gs-amtrow">' +
        (amt ? '<span class="gs-amt">' + amt + '</span>' : '<span class="gs-amt unset">Amount not stated</span>') +
        (tier ? '<span class="gs-tier">' + esc(tier) + '</span>' : '<span class="gs-tier unset">tier not stated</span>') +
      '</div></button>';
  }

  /* ---------------- compare mode ---------------- */
  function renderCompareResults(r, d, q) {
    var groups = (d && d.groups) || [];
    if (!groups.length) { r.innerHTML = '<div class="gs-empty">No state-by-state comparison found for “' + esc(q) + '”.</div>'; return; }
    r.innerHTML = groups.map(cmpCardHTML).join("");
  }
  function cmpCardHTML(c) {
    var states = c.rows || [];
    var name = (states[0] && states[0].treatment_name) || g(c, "treatment_name_normalised");
    return '<div class="gs-cmpcard"><div class="gs-cmpname">' + esc(name) + '</div>' +
      (states.length ? states.map(cmpRowHTML).join("") : '<div class="gs-hint">No states report this procedure.</div>') +
      '</div>';
  }
  function cmpRowHTML(s) {
    var amt = inr(s.package_amount), tier = g(s, "rate_tier");
    return '<div class="gs-cmprow"><span class="gs-cmpstate">' + esc(g(s, "state")) + '</span>' +
      (g(s, "treatment_code") ? '<span class="gs-pill gs-pill-code">' + esc(s.treatment_code) + '</span>' : "") +
      (amt ? '<span class="gs-amt">' + amt + '</span>' : '<span class="gs-amt unset">Amount not stated</span>') +
      (tier ? '<span class="gs-tier">' + esc(tier) + '</span>' : '<span class="gs-tier unset">tier not stated</span>') +
      '</div>';
  }

  /* ---------------- detail view ---------------- */
  function openDetail(id) {
    st.view = "detail"; st.detailId = id;
    setTitle("Package detail");
    var b = root.querySelector("#gsBody");
    b.innerHTML = '<div class="gs-hint">Loading…</div>';
    var mySeq = ++seq;
    GSAPI.pkg(id).then(function (d) {
      if (mySeq !== seq || st.view !== "detail" || st.detailId !== id) return;
      if (d == null) { b.innerHTML = '<div class="gs-err">Could not load this package. Check your connection and try again.</div>'; return; }
      renderDetail(b, d);
    });
  }
  function kv(label, val, mono) {
    if (val == null || val === "") return "";
    return '<div class="gs-kv"><b>' + esc(label) + '</b><span>' + (mono ? '<code>' + esc(val) + '</code>' : esc(val)) + '</span></div>';
  }
  function renderDetail(b, d) {
    setTitle(g(d, "treatment_name") || "Package detail");
    var amt = inr(d.package_amount), rider = inr(d.rider_amount), tier = g(d, "rate_tier");
    var src = d.source || {};
    // The API may nest verification_status under source (matches the sources table) or flatten it
    // onto the package payload - read both. No status at all fails SAFE (shows the warning): this
    // is safety-critical financial/eligibility data and silence must never read as "verified".
    var vstatus = g(src, "verification_status") || g(d, "verification_status") || "";
    var unverified = vstatus !== "verified";

    var html = '<div class="gs-dhead"><div class="gs-dname">' + esc(g(d, "treatment_name")) + '</div>' +
      '<div class="gs-pills">' +
        (g(d, "scheme") ? '<span class="gs-pill">' + esc(d.scheme) + '</span>' : "") +
        (g(d, "state") ? '<span class="gs-pill">' + esc(d.state) + '</span>' : "") +
        (g(d, "version_label") ? '<span class="gs-pill">v' + esc(d.version_label) + '</span>' : "") +
      '</div>' +
      '<div class="gs-amtrow" style="margin-top:9px">' +
        (amt ? '<span class="gs-amt" style="font-size:19px">' + amt + '</span>' : '<span class="gs-amt unset">Amount not stated</span>') +
        (tier ? '<span class="gs-tier">' + esc(tier) + '</span>' : '<span class="gs-tier unset">tier not stated</span>') +
      '</div></div>';

    if (unverified) {
      html += '<div class="gs-warn">' + gsIco("warn") +
        '<span>Unverified government reference data - confirm with the scheme portal before relying on it.</span></div>';
    }

    html += '<div class="gs-sec"><div class="gs-sec-h">Codes</div>' +
      kv("Speciality", (g(d, "speciality_code") ? d.speciality_code + " - " : "") + g(d, "speciality_name")) +
      kv("Treatment code", g(d, "treatment_code"), true) +
      kv("Treatment type", g(d, "treatment_type")) +
      kv("Package code", g(d, "package_code"), true) +
      kv("Package name", g(d, "package_name")) +
      kv("ICD code", g(d, "icd_code"), true) +
      kv("ICHI code", g(d, "ichi_code"), true) +
      '</div>';

    html += '<div class="gs-sec"><div class="gs-sec-h">Amount &amp; stay</div>' +
      kv("Rate tier", tier || "not stated") +
      (rider ? kv("Rider / top-up amount", rider) : "") +
      kv("Length of stay", g(d, "los_days") ? d.los_days + " day" + (Number(d.los_days) === 1 ? "" : "s") : "") +
      kv("Pre-authorisation", g(d, "preauth_required") ? "Required" : (d.preauth_required === 0 ? "Not required" : "")) +
      '</div>';

    var invHtml = kv("Pre-investigation", g(d, "pre_investigation")) + kv("Post-investigation", g(d, "post_investigation")) +
      kv("Eligibility", g(d, "eligibility")) + kv("Documentation", g(d, "documentation")) +
      kv("Implant criteria", g(d, "implant_criteria")) + kv("Stratification criteria", g(d, "stratification_criteria"));
    if (invHtml) html += '<div class="gs-sec"><div class="gs-sec-h">Investigations &amp; eligibility</div>' + invHtml + '</div>';

    var retrieved = "";
    try { var ts = Number(g(src, "retrieved_ts") || g(d, "retrieved_ts")); if (ts) retrieved = new Date(ts).toLocaleDateString("en-IN"); } catch (e) {}
    html += '<div class="gs-sec"><div class="gs-sec-h">Source</div><div class="gs-src">' +
      esc(g(src, "authority") || g(d, "scheme_authority") || "Not stated") +
      (unverified ? "" : '<span class="gs-verified">verified</span>') + '<br>' +
      (g(src, "url") ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener noreferrer">' + esc(src.url) + "</a><br>" : "") +
      (retrieved ? "Retrieved " + esc(retrieved) : "") +
      '</div></div>';

    b.innerHTML = html;
  }

  function open() {
    ensureRoot();
    root.classList.add("on");
    document.body.classList.add("gs-lock");
    st.view = "list";
    renderList();
  }
  function close() {
    if (!root) return;
    root.classList.remove("on");
    document.body.classList.remove("gs-lock");
  }

  window.SMD_GOVSCHEMES = { open: open, close: close };
})();
