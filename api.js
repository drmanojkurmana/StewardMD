/* ============================================================================
   StewardMD — National Drug Database client + browser (Cloudflare Worker + D1)
   Composition-centric: search returns GENERICS; opening one shows its shared
   uses/side-effects (a property of the molecule, not the brand) and ALL its
   brands (brand → manufacturer + price), sortable by relevance / price.
   - Universal search: appends a "Drugs · national database" section (generics)
     as a sibling of #spResults (never touches the app's own render).
   - window.MEDDB.openList()/openComposition(): full-screen Drugs Database browser
     (also reachable from the sidebar).
   Lightweight, additive, graceful-offline. Only small JSON is fetched on demand.
   ========================================================================== */
(function () {
  "use strict";

  // Production API (Cloudflare Worker + D1). Dev fallback:
  // https://stewardmd-api.drmanojkurmana.workers.dev
  var API_BASE = "https://api.stewardmd.in";
  var MINLEN = 3, DEBOUNCE = 250, PAGE = 60;

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function inr(v) { return (v == null || v === "") ? "" : "₹" + v; }

  /* ---------------- fetch client ---------------- */
  function api(path) {
    return fetch(API_BASE + path).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  var MEDAPI = {
    base: API_BASE,
    searchCompositions: function (q, limit) { return api("/search?q=" + encodeURIComponent(q || "") + "&limit=" + (limit || 20)).then(function (d) { return d || { results: [] }; }); },
    // Brand-name search — returns individual brands whose name matches q (e.g.
    // "pantocid"). Degrades to empty if the API predates the endpoint (404 → null).
    searchBrands: function (q, limit) { return api("/brand-search?q=" + encodeURIComponent(q || "") + "&limit=" + (limit || 12)).then(function (d) { return d || { results: [] }; }); },
    composition: function (name, sort, tier, limit, offset, q) {
      return api("/composition?name=" + encodeURIComponent(name) + "&sort=" + (sort || "relevance") + "&tier=" + (tier || "all") + "&limit=" + (limit || PAGE) + "&offset=" + (offset || 0) + (q ? "&q=" + encodeURIComponent(q) : ""));
    },
    drug: function (id) { return api("/drug/" + encodeURIComponent(id)); },
    monograph: function (name) { return api("/monograph?name=" + encodeURIComponent(name)); },
    structured: function (name) { return api("/structured?name=" + encodeURIComponent(name)); },
    // Live total drug/brand count — /health returns {rows}. Memoized so the label never
    // goes stale again (falls back to the constant if the API is unreachable).
    _count: null,
    count: function () {
      var self = this;
      if (self._count != null) return Promise.resolve(self._count);
      return api("/health").then(function (d) { var n = d && typeof d.rows === "number" ? d.rows : null; if (n) self._count = n; return n; });
    }
  };

  /* ============================================================
   * Universal-search hook — composition results under #spResults
   * ============================================================ */
  var box = null, lastQ = "", timer = null;
  function ensureBox() {
    if (box) return box;
    var res = el("spResults"); if (!res || !res.parentNode) return null;
    box = document.createElement("div"); box.id = "smdBrandResults";
    res.parentNode.insertBefore(box, res.nextSibling);
    return box;
  }
  function suppressLocalEmpty(has) {
    var res = el("spResults"); if (!res) return;
    var e = res.querySelector(".sp-empty"); if (e) e.style.display = has ? "none" : "";
  }
  function clearBox() { if (box) box.innerHTML = ""; suppressLocalEmpty(false); }

  function renderSearch(data) {
    if (!ensureBox()) return;
    var list = (data && data.results) || [];
    suppressLocalEmpty(list.length > 0);
    if (!list.length) { box.innerHTML = ""; return; }
    var html = '<div class="sp-section-label">💊 Drugs · national database</div>';
    list.forEach(function (r) {
      var sub = [r["class"], (r.brands != null ? r.brands.toLocaleString() + " brands" : "")].filter(Boolean).join(" · ");
      html += '<div class="sp-card smddb-hit" data-comp="' + esc(r.composition) + '">' +
        '<div class="sp-card-top"><span class="sp-card-icon">💊</span><div><div class="sp-card-type">Generic — tap for brands &amp; prices</div><div class="sp-card-title">' + esc(r.composition) + '</div></div></div>' +
        '<div class="sp-card-desc">' + esc(sub) + '</div></div>';
    });
    box.innerHTML = html;
    box.querySelectorAll(".smddb-hit").forEach(function (c) {
      c.addEventListener("click", function (e) { e.stopPropagation(); MEDDB.openComposition(c.getAttribute("data-comp")); });
    });
  }
  function onInput(v) {
    lastQ = (v || "").trim();
    if (timer) clearTimeout(timer);
    if (lastQ.length < MINLEN) { clearBox(); return; }
    var q = lastQ;
    timer = setTimeout(function () {
      if (q !== lastQ) return;
      MEDAPI.searchCompositions(q).then(function (d) { if (q === lastQ) renderSearch(d); });
    }, DEBOUNCE);
  }

  /* ============================================================
   * Drugs Database — full-screen browser overlay (window.MEDDB)
   * ============================================================ */
  var root = null, q2 = "", t2 = null;
  var st = { name: null, sort: "relevance", tier: "all", info: null, brands: [], total: 0, offset: 0, loading: false, bq: "" };
  var TIER_LABEL = { all: "", branded: "top-branded", generic: "top-generic" };
  var monoCache = {};

  // Shared monochrome SVG icon accessor (window.ICONS catalog from home.js); guarded for
  // load order with an empty-string fallback. Keeps the Drugs Database (#dbOverlay) chrome
  // consistent with the rest of the app's icon set instead of stray emoji / ASCII glyphs.
  function dbIco(n, c) { return (window.ICONS && ICONS.get) ? ICONS.get(n, c || "db-ico") : ""; }

  function ensureRoot() {
    if (root) return root;
    injectCSS();
    root = document.createElement("div");
    root.id = "dbOverlay"; root.className = "db-overlay";
    root.innerHTML =
      '<div class="db-top">' +
        '<button class="db-back" id="dbBack">‹ Back</button>' +
        '<div class="db-title" id="dbTitle">Drugs Database</div>' +
        '<button class="db-brandbtn" id="dbBrandBtn" style="display:none" aria-label="Available brands">' + dbIco("pills") + ' Brands</button>' +
        '<button class="db-close" id="dbClose" aria-label="Close">' + dbIco("close") + '</button>' +
      '</div>' +
      '<div class="db-body" id="dbBody"></div>' +
      '<div class="db-scrim" id="dbScrim"></div>' +
      '<aside class="db-drawer" id="dbDrawer" aria-label="Available brands">' +
        '<div class="db-dwh"><span class="db-dwt">' + dbIco("pills") + ' Available brands</span><button class="db-dwx" id="dbDwx" aria-label="Close brands">' + dbIco("close") + '</button></div>' +
        '<div class="db-dwbody" id="dbDwBody"></div>' +
      '</aside>';
    document.body.appendChild(root);
    root.querySelector("#dbClose").addEventListener("click", close);
    root.querySelector("#dbBrandBtn").addEventListener("click", openDrawer);
    root.querySelector("#dbDwx").addEventListener("click", closeDrawer);
    root.querySelector("#dbScrim").addEventListener("click", closeDrawer);
    root.querySelector("#dbBack").addEventListener("click", function () {
      closeDrawer(); if (st.name) { st.name = null; renderList(); } else close();
    });
    return root;
  }
  function setTitle(t, showBack) {
    root.querySelector("#dbTitle").textContent = t;
    root.querySelector("#dbBack").style.visibility = showBack ? "visible" : "hidden";
  }

  /* ---- dynamic drug-count label (never goes stale) ---- */
  function updateCount() {
    var el = root && root.querySelector("#dbCount"); if (!el) return;
    // When an offline copy is installed, show ITS row count (authoritative for offline).
    try {
      var off = window.SMD_OFFLINEDB;
      if (off && off.installed && off.installed()) { var info = off.info && off.info(); if (info && info.rowCount) { el.textContent = info.rowCount.toLocaleString(); return; } }
    } catch (e) {}
    MEDAPI.count().then(function (n) { var e2 = root && root.querySelector("#dbCount"); if (e2 && n) e2.textContent = n.toLocaleString(); }).catch(function () {});
  }

  /* ---- list/search view ---- */
  function renderList() {
    st.name = null; setTitle("Drugs Database", false);
    var bb = root.querySelector("#dbBrandBtn"); if (bb) bb.style.display = "none"; closeDrawer();
    var b = root.querySelector("#dbBody");
    b.innerHTML =
      '<div class="db-searchbar">' + dbIco("search", "db-search-ic") + '<input id="dbSearch" class="db-search" type="text" placeholder="Search a drug or brand (e.g. pantoprazole, augmentin, monocef)…" autocomplete="off" value="' + esc(q2) + '"></div>' +
      '<div class="db-note"><span id="dbCount">412,224</span> Indian brands · search a molecule or brand name, then open it for all brands &amp; prices.</div>' +
      '<div id="dbResults" class="db-results"></div>';
    updateCount();
    var si = b.querySelector("#dbSearch");
    si.addEventListener("input", function () { onListInput(si.value); });
    si.addEventListener("keydown", function (e) { e.stopPropagation(); });
    setTimeout(function () { try { si.focus(); } catch (e) {} }, 50);
    if (q2.length >= MINLEN) runList(q2);
  }
  function onListInput(v) {
    q2 = (v || "").trim();
    if (t2) clearTimeout(t2);
    var r = root.querySelector("#dbResults");
    if (q2.length < MINLEN) { if (r) r.innerHTML = '<div class="db-empty">Type at least 3 letters…</div>'; return; }
    var q = q2;
    if (r) r.innerHTML = '<div class="db-empty">Searching…</div>';
    t2 = setTimeout(function () { if (q === q2) runList(q); }, DEBOUNCE);
  }
  function compCardHTML(x) {
    var sub = [x["class"], (x.brands != null ? x.brands.toLocaleString() + " brands" : "")].filter(Boolean).join(" · ");
    return '<button class="db-comp" data-comp="' + esc(x.composition) + '"><span class="db-comp-ic">' + dbIco("pills") + '</span><span class="db-comp-main"><span class="db-comp-name">' + esc(x.composition) + '</span><span class="db-comp-sub">' + esc(sub) + '</span></span><span class="db-chev">' + dbIco("chev") + '</span></button>';
  }
  // Brand hit: brand name (carries the dose, e.g. "Pantocid 40 Tablet") on top,
  // composition + manufacturer/form/price underneath. Tapping opens its molecule.
  function brandHitHTML(bd) {
    var meta = [bd.manufacturer, bd.form, (bd.mrp != null ? inr(bd.mrp) : "")].filter(Boolean).join(" · ");
    return '<button class="db-comp db-brandhit' + (bd.discontinued ? " disc" : "") + '" data-comp="' + esc(bd.composition || "") + '">' +
      '<span class="db-comp-ic">' + dbIco("pills") + '</span><span class="db-comp-main">' +
        '<span class="db-comp-name">' + esc(bd.brand) + (bd.discontinued ? ' <span class="db-disc">discontinued</span>' : '') + '</span>' +
        '<span class="db-comp-sub"><b class="db-bh-comp">' + esc(bd.composition || "—") + '</b>' + (meta ? ' · ' + esc(meta) : '') + '</span>' +
      '</span><span class="db-chev">' + dbIco("chev") + '</span></button>';
  }
  function runList(q) {
    // brand-name hits + molecule/composition hits in parallel; brands shown first
    // so doctors who type a brand (e.g. "pantocid") see the brand itself on top.
    Promise.all([MEDAPI.searchBrands(q, 12), MEDAPI.searchCompositions(q, 30)]).then(function (arr) {
      if (q !== q2 || st.name) return;
      var r = root.querySelector("#dbResults"); if (!r) return;
      var brands = (arr[0] && arr[0].results) || [], comps = (arr[1] && arr[1].results) || [];
      if (!brands.length && !comps.length) { r.innerHTML = '<div class="db-empty">No drugs match “' + esc(q) + '”.</div>'; return; }
      var html = "";
      if (brands.length) html += '<div class="db-sec-l">' + dbIco("pills") + ' Brands matching “' + esc(q) + '”</div>' + brands.map(brandHitHTML).join("");
      if (comps.length) html += '<div class="db-sec-l">' + dbIco("flask") + ' Molecules &amp; compositions</div>' + comps.map(compCardHTML).join("");
      r.innerHTML = html;
      r.querySelectorAll(".db-comp").forEach(function (b) { b.addEventListener("click", function () { openComposition(b.getAttribute("data-comp")); }); });
    });
  }

  /* ---- composition detail view ---- */
  function openComposition(name, sort, tier) {
    ensureRoot();
    if (!root.classList.contains("on")) { root.classList.add("on"); document.body.classList.add("db-lock"); }
    if (st.name !== name) st.bq = "";   // fresh molecule → clear the brand filter; sort/tier changes keep it
    st.name = name; st.sort = sort || "relevance"; st.tier = tier || "all"; st.info = null; st.brands = []; st.total = 0; st.offset = 0;
    setTitle(name, true);
    root.querySelector("#dbBody").innerHTML = '<div class="db-empty">Loading ' + esc(name) + '…</div>';
    loadComposition(true);
  }
  function loadComposition(first) {
    if (st.loading) return; st.loading = true;
    MEDAPI.composition(st.name, st.sort, st.tier, PAGE, st.offset, st.bq).then(function (d) {
      st.loading = false;
      if (!d || st.name !== d.composition) { if (first) root.querySelector("#dbBody").innerHTML = '<div class="db-empty">Could not load this drug.</div>'; return; }
      if (first) { st.info = d; st.total = d.total || 0; st.brands = d.brands || []; renderDetail(); }
      else { st.brands = st.brands.concat(d.brands || []); appendBrands(d.brands || []); }
    });
  }
  function sortBtn(key, label) {
    return '<button class="db-sort' + (st.sort === key ? " on" : "") + '" data-sort="' + key + '">' + label + '</button>';
  }
  function tierBtn(key, label) {
    return '<button class="db-tier' + (st.tier === key ? " on" : "") + '" data-tier="' + key + '">' + label + '</button>';
  }
  function brandHTML(b) {
    var meta = [b.form, b.pack].filter(Boolean).join(" · ");
    return '<div class="db-brand' + (b.discontinued ? " disc" : "") + '">' +
      '<div class="db-brand-main"><div class="db-brand-name">' + esc(b.brand) + (b.discontinued ? ' <span class="db-disc">discontinued</span>' : '') + '</div>' +
      '<div class="db-brand-mfr">' + esc(b.manufacturer || "—") + '</div>' +
      (meta ? '<div class="db-brand-meta">' + esc(meta) + '</div>' : '') + '</div>' +
      '<div class="db-brand-price">' + (b.mrp != null ? esc(inr(b.mrp)) : '<span class="db-na">—</span>') + '</div>' +
      '</div>';
  }
  function renderDetail() {
    var d = st.info, b = root.querySelector("#dbBody");
    var chips = [d["class"], d.action_class].filter(Boolean).map(function (c) { return '<span class="db-chip">' + esc(c) + '</span>'; }).join("");
    var brandsBody = st.brands.length ? st.brands.map(brandHTML).join("")
      : '<div class="db-empty">No ' + (TIER_LABEL[st.tier] ? TIER_LABEL[st.tier] + " " : "") + 'brands listed for this generic.</div>';
    var cnt = st.total ? st.total.toLocaleString() : st.brands.length;
    // monograph + footer disclaimer in the main body (no top banner)
    b.innerHTML =
      '<div class="db-head"><div class="db-gen">' + esc(d.composition) + '</div><div class="db-chips">' + chips + '</div>' +
        ((window.SMD_RENAL_DOSE && SMD_RENAL_DOSE.buttonHTML) ? SMD_RENAL_DOSE.buttonHTML(d.composition) : '') + '</div>' +
      (d.habit_forming ? '<div class="db-hf">Habit forming: <b>' + esc(d.habit_forming) + '</b></div>' : '') +
      '<div id="dbMono" class="db-mono"><div class="db-soon">Loading prescribing details…</div></div>';
    // brands (all filters + sorts preserved) -> right-side slide-in drawer
    var dw = root.querySelector("#dbDwBody");
    dw.innerHTML =
      '<div class="db-dwsearch">' + dbIco("search", "db-dwsearch-ic") + '<input id="dbBrandQ" class="db-dwsearch-i" type="text" placeholder="Search brands by name…" autocomplete="off" value="' + esc(st.bq) + '"></div>' +
      '<div class="db-filters"><span class="db-filt-l">Show</span>' + tierBtn("all", "All") + tierBtn("branded", "Top branded") + tierBtn("generic", "Top generic") + '</div>' +
      '<div class="db-brands-h"><span>' + cnt + ' brands</span>' +
        '<span class="db-sorts">' + sortBtn("relevance", "Relevance") + sortBtn("price_asc", "Price: Low→High") + sortBtn("price_desc", "Price: High→Low") + '</span></div>' +
      '<div id="dbBrands" class="db-brand-list">' + brandsBody + '</div>' +
      '<div id="dbMore"></div>';
    var bqi = dw.querySelector("#dbBrandQ");
    if (bqi) {
      bqi.addEventListener("keydown", function (e) { e.stopPropagation(); });
      bqi.addEventListener("input", function () {
        var v = bqi.value.trim();
        if (st._bqt) clearTimeout(st._bqt);
        st._bqt = setTimeout(function () { if (v !== st.bq) { st.bq = v; reloadBrands(); } }, DEBOUNCE);
      });
    }
    dw.querySelectorAll(".db-sort").forEach(function (x) {
      x.addEventListener("click", function () { var s = x.getAttribute("data-sort"); if (s !== st.sort) { dwOpen = true; openComposition(st.name, s, st.tier); } });
    });
    dw.querySelectorAll(".db-tier").forEach(function (x) {
      x.addEventListener("click", function () { var tt = x.getAttribute("data-tier"); if (tt !== st.tier) { dwOpen = true; openComposition(st.name, st.sort, tt); } });
    });
    // glowing "Available brands (N)" button in the header
    var bb = root.querySelector("#dbBrandBtn");
    if (bb) { bb.style.display = ""; bb.innerHTML = dbIco("pills") + ' Available brands <span class="db-bb-ct">' + cnt + '</span>'; }
    if (dwOpen) openDrawer();
    loadStructured(d.composition);
    renderMore();
  }

  var MONO_SECS = [["Indications", "indication"], ["Dosage & administration", "dosage"],
    ["Renal / hepatic & special populations", "specific_pop"], ["Pregnancy & lactation", "pregnancy"],
    ["Adverse effects", "adverse"], ["Interactions (incl. alcohol)", "interactions"],
    ["Warnings & monitoring", "warnings"], ["Forms & strengths", "forms"]];
  function loadMonograph(name) {
    var c = root.querySelector("#dbMono"); if (!c) return;
    if (monoCache[name] !== undefined) { renderMono(c, monoCache[name]); return; }
    clinicalLookup(MEDAPI.monograph, name).then(function (resp) {   // strength-stripped base retry (see clinicalKey)
      monoCache[name] = resp || null;
      if (st.name === name) { var cc = root.querySelector("#dbMono"); if (cc) renderMono(cc, resp || null); }
    });
  }
  function sectionsHTML(mono, openKeys) {
    var html = '<div class="db-msrc">℞ <b>' + esc(mono.source || "openFDA") + '</b><span>Verify against local guidance. Decision support only.</span></div>';
    MONO_SECS.forEach(function (s) {
      var v = mono[s[1]]; if (!v) return; var op = openKeys[s[1]];
      html += '<div class="db-msec"><button class="db-msec-h' + (op ? " open" : "") + '">' + esc(s[0]) + '<span class="db-msec-x">' + dbIco("chev") + '</span></button>' +
        '<div class="db-msec-b"' + (op ? "" : ' style="display:none"') + '>' + esc(v) + '</div></div>';
    });
    return html;
  }
  function wireToggles(c) {
    c.querySelectorAll(".db-msec-h").forEach(function (h) {
      h.addEventListener("click", function () {
        var b = h.nextElementSibling, hidden = b.style.display === "none";
        b.style.display = hidden ? "" : "none"; h.classList.toggle("open", hidden);
        // Chevron orientation is driven by the `.open` class via CSS rotation (no glyph swap).
      });
    });
  }
  function renderMono(c, resp) {
    if (!resp || !resp.found) { c.innerHTML = '<div class="db-mono-none">No prescribing monograph for this molecule yet (India-only or not matched). Brand &amp; price data below.</div>'; return; }
    if (resp.combo) {
      var html = '<div class="db-msrc">Combination product — prescribing details shown per component. Verify against local guidance.</div>';
      (resp.components || []).forEach(function (comp) {
        html += '<div class="db-cmono"><div class="db-cmono-h">' + dbIco("pills") + ' ' + esc(comp.name) + '</div>' +
          (comp.monograph ? sectionsHTML(comp.monograph, { indication: 1 }) : '<div class="db-mono-none">No monograph available for this component yet.</div>') +
          '</div>';
      });
      c.innerHTML = html; wireToggles(c); return;
    }
    c.innerHTML = sectionsHTML(resp.monograph, { indication: 1, dosage: 1 });
    wireToggles(c);
  }
  function appendBrands(arr) {
    var c = root.querySelector("#dbBrands"); if (!c) return;
    c.insertAdjacentHTML("beforeend", arr.map(brandHTML).join(""));
    renderMore();
  }
  function renderMore() {
    var m = root.querySelector("#dbMore"); if (!m) return;
    if (!st.brands.length) { m.innerHTML = ""; return; }
    if (st.brands.length < st.total) {
      m.innerHTML = '<button class="db-more" id="dbMoreBtn">Load more (' + (st.total - st.brands.length).toLocaleString() + ' more)</button>';
      m.querySelector("#dbMoreBtn").addEventListener("click", function () { st.offset = st.brands.length; loadComposition(false); m.innerHTML = '<div class="db-empty">Loading…</div>'; });
    } else m.innerHTML = '<div class="db-allshown">All ' + st.brands.length.toLocaleString() + ' brands shown</div>';
  }

  // Re-query only the brand list for the drawer's "search brands by name" box.
  // Replaces the list in place (keeps the search input focused); race-safe via a
  // query token so a slower earlier response can't clobber a newer search.
  function reloadBrands() {
    var myq = st.bq; st.offset = 0;
    var list = root.querySelector("#dbBrands"); if (list) list.innerHTML = '<div class="db-empty">Searching…</div>';
    MEDAPI.composition(st.name, st.sort, st.tier, PAGE, 0, myq).then(function (d) {
      if (myq !== st.bq || !d || st.name !== d.composition) return;   // superseded or stale
      st.total = d.total || 0; st.brands = d.brands || [];
      var l = root.querySelector("#dbBrands");
      if (l) l.innerHTML = st.brands.length ? st.brands.map(brandHTML).join("")
        : '<div class="db-empty">No brands' + (st.bq ? ' match “' + esc(st.bq) + '”' : ' listed') + '.</div>';
      var h = root.querySelector(".db-brands-h span"); if (h) h.textContent = (st.total ? st.total.toLocaleString() : st.brands.length) + ' brands';
      renderMore();
    });
  }

  function openList() {
    ensureRoot();
    if (st.name) st.name = null;
    root.classList.add("on"); document.body.classList.add("db-lock");
    renderList();
  }
  function close() { if (root) { closeDrawer(); var bb = root.querySelector("#dbBrandBtn"); if (bb) bb.style.display = "none"; root.classList.remove("on"); document.body.classList.remove("db-lock"); } }
  var dwOpen = false;
  function openDrawer() { dwOpen = true; if (!root) return; var s = root.querySelector("#dbScrim"), d = root.querySelector("#dbDrawer"); if (s) s.classList.add("on"); if (d) d.classList.add("on"); }
  function closeDrawer() { dwOpen = false; if (!root) return; var s = root.querySelector("#dbScrim"), d = root.querySelector("#dbDrawer"); if (s) s.classList.remove("on"); if (d) d.classList.remove("on"); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root && root.classList.contains("on")) close(); });

  /* ---- structured clinical cards (new default) ---- */
  var ST_SECS = [["Indications","summary"],["Dosage","adult_dose"],["Paediatric dose","ped_dose"],
    ["Geriatric","geriatric"],["Mechanism of action","moa"],["Administration","administration"],
    ["Renal adjustment","renal_adjust"],["Hepatic adjustment","hepatic_adjust"],["Pregnancy","pregnancy"],
    ["Lactation","lactation"],["Contraindications","contraindications"],["Boxed warning","boxed_warning"],
    ["Precautions / warnings","precautions"],["Common side effects","common_se"],["Serious effects","serious_se"],
    ["Interactions","interactions"],["Monitoring","monitoring"],["Overdose","overdose"],["Counselling","counseling"]];
  var ST_OPEN = { summary: 1, adult_dose: 1 };
  function firstSent(t) { t = (t || "").trim(); if (!t) return ""; var i = t.indexOf(". "); return (i > 0 && i < 130) ? t.slice(0, i + 1) : t.slice(0, 96); }
  function qfGrid(s) {
    var items = [["Adult dose", firstSent(s.adult_dose)], ["Meal", s.food_timing], ["Pregnancy", firstSent(s.pregnancy)],
      ["Renal", s.renal_adjust], ["Hepatic", s.hepatic_adjust], ["Half-life", s.half_life], ["Alcohol", s.alcohol], ["Monitoring", s.monitoring]];
    return '<div class="db-qf">' + items.map(function (p) { return '<div><div class="db-qf-k">' + esc(p[0]) + '</div><div class="db-qf-v">' + esc((p[1] || "—").slice(0, 90)) + '</div></div>'; }).join("") + '</div>';
  }
  function stSections(s, openKeys) {
    var html = '<div class="db-msrc">℞ <b>Structured from official FDA label (openFDA / DailyMed)</b><span>Faithful summary — pending clinician review; US labelling, verify against local guidance.</span></div>';
    ST_SECS.forEach(function (sec) {
      var v = s[sec[1]]; if (!v) return; var op = openKeys[sec[1]];
      html += '<div class="db-msec"><button class="db-msec-h' + (op ? " open" : "") + '">' + esc(sec[0]) + '<span class="db-msec-x">' + dbIco("chev") + '</span></button><div class="db-msec-b"' + (op ? "" : ' style="display:none"') + '>' + esc(v) + '</div></div>';
    });
    return html;
  }
  function renderStructured(c, resp) {
    if (!resp || !resp.found) { c.innerHTML = '<div class="db-mono-none">No structured clinical record for this molecule yet (India-only or not matched). Brand &amp; price data below.</div>'; return; }
    if (resp.combo) {
      var html = '<div class="db-msrc">Combination product — clinical details per component. Verify locally.</div>';
      (resp.components || []).forEach(function (cp) {
        html += '<div class="db-cmono"><div class="db-cmono-h">' + dbIco("pills") + ' ' + esc(cp.name) + '</div>' +
          (cp.data ? ((cp.data.gold && parseGold(cp.data.gold)) ? goldHTML(parseGold(cp.data.gold)) : (qfGrid(cp.data) + stSections(cp.data, { summary: 1 }))) : '<div class="db-mono-none">No structured record for this component yet.</div>') + '</div>';
      });
      c.innerHTML = html; wireToggles(c); return;
    }
    var g = resp.data && resp.data.gold && parseGold(resp.data.gold);
    if (g) { c.innerHTML = goldHTML(g); return; }
    c.innerHTML = qfGrid(resp.data) + stSections(resp.data, ST_OPEN); wireToggles(c);
  }
  // Strip strength / concentration / form so a brand-list composition ("Ceftriaxone (1000mg)",
  // "Ceftriaxone 500 mg", "Vitamin D3 (60000IU)") resolves to its BASE molecule's gold record.
  // The clinical DB is keyed by molecule ("Ceftriaxone"); the composition list is keyed WITH strength,
  // so without this a strength variant showed "No structured clinical record" while the plain molecule
  // worked. Verified vs the live API: /structured?name=Ceftriaxone → found; "Ceftriaxone (1000mg)" → not.
  function clinicalKey(name) {
    var s = String(name || "");
    s = s.replace(/\s*\([^)]*\)/g, " ");                                                 // ANY parenthetical → base molecule: strength "(1000mg)"/"(5 mg/ml)"/"(60000IU)" OR qualifier "(NA)"/"(Micronized)"/"(Natural Micronized)". Safe because clinicalLookup tries the ORIGINAL name first, so a paren-specific record still wins.
    s = s.replace(/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|l|%|iu|units?|meq|mmol)\b/gi, " "); // trailing "500 mg", "1 g", "0.5%"
    return s.replace(/\s*\+\s*/g, " + ").replace(/\s{2,}/g, " ").trim();                 // tidy combo spacing after strips
  }
  // The clinical API is case-SENSITIVE and keyed in Title Case, but the brand list often lowercases
  // trailing words ("Acetic acid", "Azilsartan medoxomil") — try a Title-Cased candidate too.
  function titleCase(s) { return String(s || "").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }
  // Curated British/BAN ⇄ INN/US spelling pairs (same molecule) — the gold DB and the Indian brand
  // list often disagree on spelling (e.g. list "Amoxicillin" vs DB "Amoxycillin"), so a base match
  // still missed. Tried in BOTH directions; only found:true responses are ever accepted, so a curated
  // pair can only ADD a correct match, never surface a wrong drug. Add pairs here as more surface.
  var CLIN_SYN = [
    ["Amoxicillin", "Amoxycillin"], ["Furosemide", "Frusemide"], ["Lidocaine", "Lignocaine"],
    ["Rifampicin", "Rifampin"], ["Paracetamol", "Acetaminophen"], ["Salbutamol", "Albuterol"],
    ["Chlorphenamine", "Chlorpheniramine"], ["Cefalexin", "Cephalexin"], ["Cefazolin", "Cephazolin"],
    ["Sulfamethoxazole", "Sulphamethoxazole"], ["Sulfasalazine", "Sulphasalazine"],
    ["Noradrenaline", "Norepinephrine"], ["Adrenaline", "Epinephrine"], ["Beclometasone", "Beclomethasone"],
    ["Guaifenesin", "Guaiphenesin"], ["Oestradiol", "Estradiol"], ["Ciclosporin", "Cyclosporine"],
    ["Glyceryl Trinitrate", "Nitroglycerin"]
  ];
  function synVariants(name) {
    var out = [], nm = String(name || "");
    CLIN_SYN.forEach(function (p) {
      for (var i = 0; i < 2; i++) {
        var from = p[i], to = p[1 - i];
        var re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
        if (re.test(nm)) { var v = nm.replace(re, to); if (v !== nm && out.indexOf(v) < 0) out.push(v); }
      }
    });
    return out;
  }
  // Resolve a clinical record for a brand-list composition: try the name, then the strength-stripped
  // base, then curated spelling variants — first found:true wins; otherwise the original response is
  // returned (so the honest "no record" state still renders). `fn` = MEDAPI.structured / .monograph.
  function clinicalLookup(fn, name) {
    var base = clinicalKey(name), tries = [], seen = {};
    function add(n) { if (n && !seen[n]) { seen[n] = 1; tries.push(n); } }
    // For name and base: the raw form, its Title-Cased form (case-sensitive API), and curated
    // spelling variants (raw + Title-Cased). Combos ("A + B") are split server-side.
    // `bare` also drops DESCRIPTIVE parentheticals the strength strip keeps — "(Salmon)", "(hCG)",
    // "(HES)", "(Including Pvp)" — which block a match when the plain molecule IS in the DB. Additive
    // (base is still tried first), and only found:true is accepted, so it can't surface a wrong drug.
    var bare = base.replace(/\s*\([^)]*\)/g, " ").replace(/\s*\+\s*/g, " + ").replace(/\s{2,}/g, " ").trim();
    [name, base, bare].forEach(function (n) {
      add(n); add(titleCase(n));
      synVariants(n).forEach(function (v) { add(v); add(titleCase(v)); });
    });
    var first = { done: false };
    function step(i) {
      if (i >= tries.length) return Promise.resolve(first.resp);
      return fn(tries[i]).then(function (resp) {
        if (!first.done) { first.done = true; first.resp = resp; }
        if (resp && resp.found) return resp;
        return step(i + 1);
      });
    }
    return step(0);
  }
  function loadStructured(name) {
    var c = root.querySelector("#dbMono"); if (!c) return;
    if (monoCache["S:" + name] !== undefined) { renderStructured(c, monoCache["S:" + name]); return; }
    clinicalLookup(MEDAPI.structured, name).then(function (resp) {
      monoCache["S:" + name] = resp || null;
      if (st.name === name) { var cc = root.querySelector("#dbMono"); if (cc) renderStructured(cc, resp || null); }
    });
  }

  /* ---- GOLD-STANDARD template renderer (from curated gold JSON) ---- */
  function goldHTML(g) {
    function bl(a) { return '<ul class="gd-b">' + (a || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>'; }
    function S(ic, t, q, body) { return '<div class="gd-sec"><div class="gd-h">' + ic + ' ' + esc(t) + (q ? '<span class="gd-q">' + esc(q) + '</span>' : '') + '</div>' + body + '</div>'; }
    var H = "";
    if (g.quick) H += S('⚡', 'Quick Facts', '10 seconds', '<div class="gd-qf">' + g.quick.map(function (p) { return '<div><div class="gd-qk">' + esc(p[0]) + '</div><div class="gd-qv">' + esc(p[1]) + '</div></div>'; }).join("") + '</div>');
    if (g.summary) H += S('📋', 'Summary', 'What is it?', '<div>' + esc(g.summary) + '</div>');
    if (g.indications) H += S('🎯', 'Indications', 'When?', bl(g.indications));
    if (g.dosage) H += S('💊', 'Dosage', 'How much?', '<div class="gd-tw"><table class="gd-t"><tr><th>Condition</th><th>Route</th><th>Dose</th><th>Duration</th><th>Notes</th></tr>' + g.dosage.map(function (r) { return '<tr><td><b>' + esc(r.c) + '</b></td><td>' + esc(r.r) + '</td><td><b>' + esc(r.d) + '</b></td><td>' + esc(r.t) + '</td><td>' + esc(r.n) + '</td></tr>'; }).join("") + '</table></div>');
    if (g.admin) H += S('✓', 'Administration', 'How to give?', '<ul class="gd-chk">' + g.admin.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>');
    if (g.moa) H += S('🧭', 'Mechanism', 'How it works', '<div>' + esc(g.moa) + '</div>');
    if (g.contra) H += S('⛔', 'Contraindications & Cautions', 'Avoid when?', '<div class="gd-sev red"><h4>Absolute</h4>' + bl(g.contra.absolute) + '</div><div class="gd-sev amber"><h4>Relative / precautions</h4>' + bl(g.contra.relative) + '</div><div class="gd-sev blue"><h4>Monitor</h4>' + bl(g.contra.monitor) + '</div>');
    H += '<div class="gd-2">' + S('🤰', 'Pregnancy & Lactation', 'Can I use it?', '<div class="gd-kv"><b>Preg</b><span>' + esc(g.preg || '—') + '</span></div><div class="gd-kv"><b>Lact</b><span>' + esc(g.lact || '—') + '</span></div>') + S('🫘', 'Renal / Hepatic', 'Adjust?', '<div class="gd-kv"><b>Renal</b><span>' + esc(g.renal || '—') + '</span></div><div class="gd-kv"><b>Hepatic</b><span>' + esc(g.hepatic || '—') + '</span></div>') + '</div>';
    if (g.interactions) { var ix = g.interactions; H += S('🔗', 'Interactions', 'Worry about?', '<div class="gd-sev red"><h4>Major</h4>' + bl(ix.major) + '</div><div class="gd-sev amber"><h4>Moderate</h4>' + bl(ix.moderate) + '</div><div class="gd-sev grey"><h4>Minor</h4>' + bl(ix.minor) + '</div><div class="gd-kv"><b>Food</b><span>' + esc(ix.food || '—') + '</span></div><div class="gd-kv"><b>Alcohol</b><span>' + esc(ix.alcohol || '—') + '</span></div>' + (ix.diagnostics ? '<div class="gd-kv"><b>Dx</b><span>' + esc(ix.diagnostics) + '</span></div>' : '')); }
    if (g.se) { var s = g.se; H += S('⚠️', 'Side Effects', 'What happens?', '<div class="gd-2"><div class="gd-sev green"><h4>Common</h4>' + bl(s.common) + '</div><div class="gd-sev red"><h4>Serious</h4>' + bl(s.serious) + '</div><div class="gd-sev amber"><h4>Rare (long-term)</h4>' + bl(s.rare) + '</div><div class="gd-sev red"><h4>🚨 Emergency</h4>' + bl(s.emergency) + '</div></div>'); }
    if (g.monitoring) H += S('📈', 'Monitoring', 'Follow what?', '<ul class="gd-mon">' + g.monitoring.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>');
    H += '<div class="gd-2">' + (g.counsel ? S('🗣', 'Counselling', 'Tell patient', bl(g.counsel)) : '') + S('⏱', 'Pharmacokinetics', 'Onset / duration', '<div class="gd-pk">' + (g.pk || []).map(function (p) { return '<div><div class="gd-qk">' + esc(p[0]) + '</div><div class="gd-qv">' + esc(p[1]) + '</div></div>'; }).join("") + '</div>' + (g.missed ? '<div class="gd-kv"><b>Missed</b><span>' + esc(g.missed) + '</span></div>' : '') + (g.overdose ? '<div class="gd-kv"><b>Overdose</b><span>' + esc(g.overdose) + '</span></div>' : '')) + '</div>';
    if (g.pearls) H += '<div class="gd-sec gd-pearls"><div class="gd-h">💡 Clinical Pearls <span class="gd-q">Expert tips</span></div>' + bl(g.pearls) + '</div>';
    H += S('📚', 'References', 'Source', '<div class="gd-src">' + (g.refs || []).map(function (r) { return '<a href="' + r[1] + '" target="_blank">' + esc(r[0]) + '</a>'; }).join(" · ") + '</div><div class="gd-foot">Faithful summary — pending clinician sign-off; verify locally. Full official label preserved internally.</div>');
    return H;
  }
  function parseGold(s) { try { return JSON.parse(s); } catch (e) { return null; } }

  /* ---- styles ---- */
  function injectCSS() {
    if (el("smd-db-styles")) return;
    var css = [
      "#smdBrandResults:not(:empty){margin-top:6px}",
      ".db-overlay{position:fixed;inset:0;z-index:880;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}",
      ".db-overlay.on{display:flex;animation:dbIn .22s ease}@keyframes dbIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.db-lock{overflow:hidden}",
      ".db-top{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0);z-index:3}",
      ".db-back,.db-close{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);cursor:pointer}",
      ".db-back{color:var(--teal,#0a9396);border-color:var(--teal,#0a9396)}",
      ".db-title{flex:1;text-align:center;font:800 16px var(--sans,system-ui);color:var(--ink,#1a1a1a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".db-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:860px;margin:0 auto;width:100%;box-sizing:border-box;padding-bottom:calc(40px + env(safe-area-inset-bottom))}",
      ".db-search{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 14px;font:500 14px var(--sans,system-ui);background:var(--panel,#fff);color:var(--ink,#1a1a1a)}",
      ".db-search:focus{outline:none;border-color:var(--teal,#0a9396)}",
      // Shared monochrome SVG icons (BUG 6) — replace stray emoji / ASCII glyphs on #dbOverlay.
      ".db-ico{width:16px;height:16px;flex:0 0 auto;vertical-align:-3px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      ".db-brandbtn .db-ico,.db-close .db-ico,.db-dwx .db-ico{width:17px;height:17px;vertical-align:-3px}",
      ".db-close,.db-dwx{display:inline-flex;align-items:center;justify-content:center}",
      ".db-dwt{display:inline-flex;align-items:center;gap:6px}",
      ".db-searchbar{position:relative}.db-searchbar .db-search{padding-left:38px}",
      ".db-search-ic{position:absolute;left:13px;top:50%;transform:translateY(-50%);width:17px;height:17px;color:var(--slate-soft,#888);pointer-events:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      ".db-dwsearch{position:relative}.db-dwsearch .db-dwsearch-i{padding-left:34px}",
      ".db-dwsearch-ic{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:var(--slate-soft,#888);pointer-events:none;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}",
      ".db-comp-ic{color:var(--teal,#0a9396);display:inline-flex;align-items:center}.db-comp-ic .db-ico{width:19px;height:19px;vertical-align:middle}",
      ".db-chev .db-ico{width:18px;height:18px;vertical-align:middle}",
      ".db-sec-l .db-ico{width:13px;height:13px;vertical-align:-2px;margin-right:5px}",
      ".db-cmono-h .db-ico{width:15px;height:15px;vertical-align:-2px;margin-right:4px;color:var(--teal,#0a9396)}",
      ".db-msec-x .db-ico{width:15px;height:15px;vertical-align:middle;transition:transform .18s}.db-msec-h.open .db-msec-x .db-ico{transform:rotate(90deg)}",
      ".db-note{font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#888);margin:8px 2px 12px;line-height:1.5}",
      ".db-empty,.db-allshown{font:500 13px var(--sans,system-ui);color:var(--slate-soft,#888);padding:18px;text-align:center}",
      ".db-comp{display:flex;align-items:center;gap:11px;width:100%;text-align:left;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 13px;margin-bottom:8px;cursor:pointer}",
      ".db-comp-ic{font-size:19px}.db-comp-main{flex:1;min-width:0}",
      ".db-comp-name{display:block;font:700 13.5px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".db-comp-sub{display:block;font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:2px}",
      ".db-chev{color:var(--slate-soft,#888);font-size:18px}",
      ".db-sec-l{font:800 11px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888);margin:12px 2px 8px}",
      ".db-sec-l:first-child{margin-top:2px}",
      ".db-brandhit{border-left:3px solid var(--teal,#0a9396)}",
      ".db-brandhit .db-bh-comp{color:var(--teal,#0a9396);font-weight:700}",
      ".db-brandhit.disc{opacity:.6}",
      ".db-dwsearch{margin:2px 2px 10px}",
      ".db-dwsearch-i{width:100%;box-sizing:border-box;border:1.5px solid var(--line,#e5e5e0);border-radius:9px;padding:9px 11px;font:500 13px var(--sans,system-ui);background:var(--paper,#f7f7f5);color:var(--ink,#1a1a1a)}",
      ".db-dwsearch-i:focus{outline:none;border-color:var(--teal,#0a9396)}",
      ".db-head{margin-bottom:12px}.db-gen{font:800 20px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.25}",
      ".db-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}",
      ".db-chip{font:700 10.5px var(--sans,system-ui);background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:7px;padding:3px 9px;text-transform:capitalize}",
      ".db-sec{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 13px;margin-bottom:9px}",
      ".db-sec-h{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888);margin-bottom:5px}",
      ".db-sec-note{text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate-soft,#888)}",
      ".db-sec-b{font:500 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.6}",
      ".db-soon{color:var(--slate-soft,#888);font-style:italic}",
      ".db-mono{margin:10px 0 4px}",
      ".db-msrc{font:600 11px var(--sans,system-ui);color:var(--slate,#555);background:var(--teal-soft,#e0f2f1);border:1px solid var(--teal,#0a9396);border-radius:9px;padding:8px 11px;margin-bottom:8px;line-height:1.5}",
      ".db-msrc span{display:block;font-weight:500;color:var(--slate-soft,#888);margin-top:2px}",
      ".db-msec{border:1px solid var(--line,#e5e5e0);border-radius:10px;margin-bottom:7px;overflow:hidden;background:var(--panel,#fff)}",
      ".db-msec-h{width:100%;text-align:left;background:transparent;border:none;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 12px;font:700 12px var(--sans,system-ui);color:var(--ink,#1a1a1a);cursor:pointer}",
      ".db-msec-h.open{border-bottom:1px solid var(--line,#e5e5e0)}",
      ".db-msec-x{color:var(--teal,#0a9396);font-weight:800;font-size:15px;flex:0 0 auto}",
      ".db-msec-b{padding:10px 12px;font:500 12.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.6;white-space:pre-line}",
      ".db-mono-none{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);background:var(--paper,#f7f7f5);border:1px dashed var(--line,#e5e5e0);border-radius:9px;padding:10px 12px}",
      ".db-cmono{border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:10px;margin-bottom:9px;background:var(--paper,#f7f7f5)}",
      ".db-cmono-h{font:800 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);margin-bottom:7px}",
      ".db-qf{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:4px 0 11px}",
      "@media(min-width:560px){.db-qf{grid-template-columns:repeat(4,1fr)}}",
      ".db-qf>div{background:var(--paper,#f7f7f5);border:1px solid var(--line,#e5e5e0);border-radius:9px;padding:7px 9px}",
      ".db-qf-k{font:700 9.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888)}",
      ".db-qf-v{font:700 12px var(--sans,system-ui);color:var(--ink,#1a1a1a);margin-top:2px;line-height:1.35}",
      // gold-standard template
      ".gd-sec{background:var(--panel,#fff);border:1px solid var(--line,#e4eaed);border-radius:11px;padding:11px 13px;margin-bottom:9px}",
      ".gd-h{font:800 11px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.06em;color:var(--teal,#0a9396);display:flex;align-items:center;gap:6px;margin-bottom:8px}",
      ".gd-h .gd-q{margin-left:auto;font-weight:600;letter-spacing:0;text-transform:none;color:var(--slate-soft,#8aa0ab);font-size:10px}",
      ".gd-2{display:grid;grid-template-columns:1fr;gap:9px}@media(min-width:620px){.gd-2{grid-template-columns:1fr 1fr}}",
      ".gd-b{margin:0;padding-left:16px}.gd-b li{margin:2px 0;font-size:13px}",
      ".gd-qf{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}@media(min-width:620px){.gd-qf{grid-template-columns:repeat(4,1fr)}}",
      ".gd-qf>div{background:var(--paper,#f4f7f8);border:1px solid var(--line,#e4eaed);border-radius:8px;padding:7px 9px}",
      ".gd-qk{font:700 9px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#8aa0ab)}",
      ".gd-qv{font:800 12.5px var(--sans,system-ui);color:var(--ink,#15242b);margin-top:2px;line-height:1.3}",
      ".gd-tw{overflow-x:auto}.gd-t{width:100%;border-collapse:collapse;font-size:12.5px}",
      ".gd-t th{text-align:left;font:700 9px var(--sans,system-ui);text-transform:uppercase;color:var(--slate-soft,#8aa0ab);padding:6px 8px;border-bottom:1px solid var(--line,#e4eaed)}",
      ".gd-t td{padding:6px 8px;border-bottom:1px solid var(--line,#e4eaed);vertical-align:top}",
      ".gd-chk{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr;gap:4px}@media(min-width:560px){.gd-chk{grid-template-columns:1fr 1fr}}",
      ".gd-chk li{padding-left:20px;position:relative;font-size:13px}.gd-chk li:before{content:'✓';position:absolute;left:0;color:var(--green,#1f8a4c);font-weight:800}",
      ".gd-mon{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px}",
      ".gd-mon li{padding-left:20px;position:relative;font-size:13px}.gd-mon li:before{content:'☐';position:absolute;left:0;color:#1f6feb;font-weight:700}",
      ".gd-sev{border-radius:8px;padding:8px 10px;margin-bottom:7px}.gd-sev h4{margin:0 0 4px;font:800 10px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em}.gd-sev .gd-b li{font-size:12.5px}",
      ".gd-sev.red{background:#fdecea;border:1px solid #f3c2bb}.gd-sev.red h4{color:#c0392b}",
      ".gd-sev.amber{background:#fff6e0;border:1px solid #f0d9a0}.gd-sev.amber h4{color:#9a6700}",
      ".gd-sev.blue{background:#e9f1fe;border:1px solid #bcd4fb}.gd-sev.blue h4{color:#1f6feb}",
      ".gd-sev.green{background:#e8f6ee;border:1px solid #bfe3cd}.gd-sev.green h4{color:#1f8a4c}",
      ".gd-sev.grey{background:var(--paper,#f4f7f8);border:1px solid var(--line,#e4eaed)}.gd-sev.grey h4{color:var(--slate,#4b5b66)}",
      ".gd-kv{display:grid;grid-template-columns:74px 1fr;gap:8px;padding:4px 0;border-top:1px dashed var(--line,#e4eaed);font-size:12.5px}.gd-kv:first-child{border-top:none}.gd-kv b{color:var(--slate-soft,#8aa0ab);font:700 9.5px var(--sans,system-ui);text-transform:uppercase;padding-top:2px}",
      ".gd-pk{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}@media(min-width:560px){.gd-pk{grid-template-columns:repeat(5,1fr)}}",
      ".gd-pk>div{background:var(--paper,#f4f7f8);border:1px solid var(--line,#e4eaed);border-radius:8px;padding:6px;text-align:center}",
      ".gd-pearls{background:linear-gradient(135deg,#e7f3f3,#eef7ee);border:1px solid #bfe3e3}",
      ".gd-src a{color:var(--teal,#0a9396)}.gd-foot{font:500 10px var(--sans,system-ui);color:var(--slate-soft,#8aa0ab);margin-top:5px}",
      // severity/pearls blocks have fixed light pastel backgrounds — force dark text so they stay readable in dark mode
      ".gd-sev{color:#1f2d34}.gd-sev .gd-b li{color:#1f2d34}.gd-pearls,.gd-pearls .gd-b li{color:#173a36}",
      ".db-sev{color:#1f2d34}.db-sev .db-b li,.db-sev li{color:#1f2d34}",
      ".db-hf{font:600 12px var(--sans,system-ui);color:var(--slate,#555);margin:0 2px 10px}",
      ".db-brandbtn{display:inline-flex;align-items:center;gap:6px;background:var(--teal,#0a9396);color:#fff;border:none;border-radius:10px;height:34px;padding:0 13px;font:700 12.5px var(--sans,system-ui);cursor:pointer;animation:dbGlow 1.8s ease-in-out infinite}",
      ".db-brandbtn:hover{filter:brightness(1.06)}",
      ".db-bb-ct{background:rgba(255,255,255,.24);border-radius:6px;padding:1px 7px;font-size:11.5px}",
      "@keyframes dbGlow{0%,100%{box-shadow:0 0 0 0 rgba(10,147,150,.55)}50%{box-shadow:0 0 0 7px rgba(10,147,150,0)}}",
      "@media(prefers-reduced-motion:reduce){.db-brandbtn{animation:none;box-shadow:0 0 0 3px rgba(10,147,150,.35)}}",
      ".db-scrim{position:fixed;inset:0;background:rgba(0,0,0,.34);opacity:0;pointer-events:none;transition:opacity .2s;z-index:889}.db-scrim.on{opacity:1;pointer-events:auto}",
      ".db-drawer{position:fixed;top:0;right:0;height:100%;width:390px;max-width:90vw;background:var(--panel,#fff);border-left:1px solid var(--line,#e5e5e0);box-shadow:-6px 0 24px rgba(0,0,0,.13);transform:translateX(100%);transition:transform .24s ease;z-index:890;display:flex;flex-direction:column}.db-drawer.on{transform:none}",
      ".db-dwh{display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 16px 12px;border-bottom:1px solid var(--line,#e5e5e0)}.db-dwt{font:800 15px var(--sans,system-ui);color:var(--ink,#1a1a1a)}.db-dwx{margin-left:auto;background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:8px;height:32px;width:32px;font-size:15px;cursor:pointer;color:var(--slate,#555)}",
      ".db-dwbody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 16px calc(30px + env(safe-area-inset-bottom))}",
      ".db-disc-foot{font:500 11px var(--sans,system-ui);color:var(--slate-soft,#888);line-height:1.55;margin:14px 2px 4px;padding-top:11px;border-top:1px solid var(--line,#e5e5e0)}.db-disc-foot b{color:var(--slate,#555)}",
      ".db-brands-h{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:14px 2px 9px;font:800 13px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".db-sorts{display:flex;gap:6px}",
      ".db-sort{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:5px 10px;font:600 11.5px var(--sans,system-ui);color:var(--slate,#555);cursor:pointer}",
      ".db-sort.on{background:var(--teal,#0a9396);border-color:var(--teal,#0a9396);color:#fff}",
      ".db-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 2px 0}",
      ".db-filt-l{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888);margin-right:2px}",
      ".db-tier{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:8px;padding:5px 11px;font:600 11.5px var(--sans,system-ui);color:var(--slate,#555);cursor:pointer}",
      ".db-tier.on{background:var(--ink,#1a1a1a);border-color:var(--ink,#1a1a1a);color:#fff}",
      ".db-brand-list{display:flex;flex-direction:column;gap:7px}",
      ".db-brand{display:flex;align-items:flex-start;gap:12px;border:1px solid var(--line,#e5e5e0);border-radius:10px;background:var(--panel,#fff);padding:10px 13px}",
      ".db-brand.disc{opacity:.6}",
      ".db-brand-main{flex:1;min-width:0}",
      ".db-brand-name{font:700 13.5px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".db-disc{font-size:9px;font-weight:800;background:var(--red-bg,#fdecea);color:var(--red,#c0392b);border-radius:4px;padding:1px 5px;vertical-align:middle;text-transform:uppercase}",
      ".db-brand-mfr{font:500 12px var(--sans,system-ui);color:var(--slate,#555);margin-top:2px}",
      ".db-brand-meta{font:500 11px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:2px}",
      ".db-brand-price{font:800 15px var(--sans,system-ui);color:var(--teal,#0a9396);white-space:nowrap;flex:0 0 auto}",
      ".db-na{color:var(--slate-soft,#888);font-weight:600}",
      ".db-more{width:100%;border:1px dashed var(--teal,#0a9396);background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:10px;padding:11px;font:700 12.5px var(--sans,system-ui);cursor:pointer;margin-top:10px}"
    ].join("");
    var s = document.createElement("style"); s.id = "smd-db-styles"; s.textContent = css; document.head.appendChild(s);
  }

  /* ---- init ---- */
  function init() {
    injectCSS();
    var inp = el("smdSearchInput");
    if (inp) {
      ensureBox();
      inp.addEventListener("input", function () { onInput(inp.value); });
      var clr = el("smdSearchClear");
      if (clr) clr.addEventListener("click", function () { lastQ = ""; clearBox(); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  window.MEDAPI = MEDAPI;
  var MEDDB = { openList: openList, openComposition: openComposition, close: close };
  window.MEDDB = MEDDB;
})();
