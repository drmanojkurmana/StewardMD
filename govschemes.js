/* ============================================================================
   StewardMD — Government Health Schemes browser (window.SMD_GOVSCHEMES)
   Full-screen overlay over India's state/UT/central government health-assurance scheme
   packages (rates, native codes, investigations, provenance). Copies the Drugs Database
   overlay pattern in api.js (search "Drugs Database — full-screen browser overlay"):
   ensureRoot/#gsOverlay/.gs-top with a real Back button (aria-label="Back" so swipe-back.js
   picks it up for free), z-index above home, same-origin fetch. This module's CSS is a real
   file (govschemes.css, linked in index.html) rather than injected from JS - patient-register.js
   uses the same split; api.js injects its own CSS from JS - both patterns exist in this app.

   Flag: smd_govt_schemes (govschemes-flags.js / window.SMD_GOVSCHEMES_FLAGS), default OFF -
   see vault/modules/Government Health Schemes.md and vault/decisions/Decisions.md (2026-09-02):
   the data is unverified government reference data until an admin review pass exists, so every
   detail panel shows the source's verification_status and flags an "unverified" source visibly.

   API contract this module calls (same-origin Cloudflare Pages Functions, functions/api/schemes/,
   field names verified against functions/_schemes_repo.js):
     GET /api/schemes/jurisdictions              -> { jurisdictions: [ { id, name, type, schemes, packages } ] }
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

  var MINLEN = 2, DEBOUNCE = 250;

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
    search: function (q, jurisdiction, limit) {
      var p = "/api/schemes/search?q=" + encodeURIComponent(q) + "&limit=" + (limit || 40);
      if (jurisdiction) p += "&state=" + encodeURIComponent(jurisdiction);
      return api(p);
    },
    pkg: function (id) { return api("/api/schemes/package/" + encodeURIComponent(id)); },
    compare: function (q) { return api("/api/schemes/compare?q=" + encodeURIComponent(q)); }
  };

  var root = null, timer = null, seq = 0;
  var st = { view: "list", q: "", jurisdiction: "", compare: false, jur: null };

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
      if (st.view === "detail") { st.view = "list"; renderList(); } else close();
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
    });
  }
  function fillStateSelect(sel) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">All India</option>' +
      (st.jur || []).map(function (j) { return '<option value="' + esc(j.id) + '">' + esc(j.name) + "</option>"; }).join("");
    sel.value = cur || st.jurisdiction || "";
  }

  /* ---------------- list view: search + state filter + compare toggle ---------------- */
  function renderList() {
    setTitle("Scheme Search");
    var b = root.querySelector("#gsBody");
    b.innerHTML =
      '<div class="gs-searchbar">' + gsIco("search", "gs-ico gs-search-ic") +
        '<input id="gsSearch" class="gs-search" type="text" autocomplete="off" ' +
        'placeholder="Disease, procedure or govt code, e.g. mastectomy, S7.1.5.1" value="' + esc(st.q) + '"></div>' +
      '<div class="gs-row2">' +
        '<select id="gsState" class="gs-state"' + (st.compare ? " disabled" : "") + '><option value="">All India</option></select>' +
        '<label class="gs-cmp"><input type="checkbox" id="gsCmp"' + (st.compare ? " checked" : "") + '> Compare across states</label>' +
      '</div>' +
      '<div id="gsResults" class="gs-results"></div>';
    var sel = b.querySelector("#gsState");
    if (st.jur) fillStateSelect(sel); else sel.value = "";
    var si = b.querySelector("#gsSearch");
    si.addEventListener("input", function () { onQueryInput(si.value); });
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    sel.addEventListener("change", function () { st.jurisdiction = sel.value; runQuery(); });
    b.querySelector("#gsCmp").addEventListener("change", function (e) { st.compare = e.target.checked; renderList(); runQuery(); });
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
      r.innerHTML = '<div class="gs-hint">Type a disease, procedure or government code to search scheme packages.</div>';
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
    if (!rows.length) { r.innerHTML = '<div class="gs-empty">No scheme packages match “' + esc(q) + '”.</div>'; return; }
    r.innerHTML = rows.map(rowHTML).join("");
    r.querySelectorAll(".gs-card").forEach(function (c) { c.addEventListener("click", function () { openDetail(c.getAttribute("data-id")); }); });
  }
  function rowHTML(x) {
    var amt = inr(x.package_amount), tier = g(x, "rate_tier");
    return '<button type="button" class="gs-card" data-id="' + esc(x.package_id) + '">' +
      '<div class="gs-card-name">' + esc(g(x, "treatment_name")) + '</div>' +
      '<div class="gs-pills">' +
        (g(x, "scheme") ? '<span class="gs-pill">' + esc(x.scheme) + '</span>' : "") +
        (g(x, "state") ? '<span class="gs-pill">' + esc(x.state) + '</span>' : "") +
        (g(x, "treatment_code") ? '<span class="gs-pill gs-pill-code">' + esc(x.treatment_code) + '</span>' : "") +
      '</div>' +
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
