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
    composition: function (name, sort, tier, limit, offset) {
      return api("/composition?name=" + encodeURIComponent(name) + "&sort=" + (sort || "relevance") + "&tier=" + (tier || "all") + "&limit=" + (limit || PAGE) + "&offset=" + (offset || 0));
    },
    drug: function (id) { return api("/drug/" + encodeURIComponent(id)); }
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
  var st = { name: null, sort: "relevance", tier: "all", info: null, brands: [], total: 0, offset: 0, loading: false };
  var TIER_LABEL = { all: "", branded: "top-branded", generic: "top-generic" };

  function ensureRoot() {
    if (root) return root;
    injectCSS();
    root = document.createElement("div");
    root.id = "dbOverlay"; root.className = "db-overlay";
    root.innerHTML =
      '<div class="db-top">' +
        '<button class="db-back" id="dbBack">‹ Back</button>' +
        '<div class="db-title" id="dbTitle">Drugs Database</div>' +
        '<button class="db-close" id="dbClose" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="db-body" id="dbBody"></div>';
    document.body.appendChild(root);
    root.querySelector("#dbClose").addEventListener("click", close);
    root.querySelector("#dbBack").addEventListener("click", function () {
      if (st.name) { st.name = null; renderList(); } else close();
    });
    return root;
  }
  function setTitle(t, showBack) {
    root.querySelector("#dbTitle").textContent = t;
    root.querySelector("#dbBack").style.visibility = showBack ? "visible" : "hidden";
  }

  /* ---- list/search view ---- */
  function renderList() {
    st.name = null; setTitle("Drugs Database", false);
    var b = root.querySelector("#dbBody");
    b.innerHTML =
      '<input id="dbSearch" class="db-search" type="text" placeholder="🔍 Search a drug or brand (e.g. pantoprazole, augmentin, monocef)…" autocomplete="off" value="' + esc(q2) + '">' +
      '<div class="db-note">253,975 Indian brands · search a molecule or brand name, then open it for all brands &amp; prices.</div>' +
      '<div id="dbResults" class="db-results"></div>';
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
  function runList(q) {
    MEDAPI.searchCompositions(q, 30).then(function (d) {
      if (q !== q2 || st.name) return;
      var r = root.querySelector("#dbResults"); if (!r) return;
      var list = (d && d.results) || [];
      if (!list.length) { r.innerHTML = '<div class="db-empty">No drugs match “' + esc(q) + '”.</div>'; return; }
      r.innerHTML = list.map(function (x) {
        var sub = [x["class"], (x.brands != null ? x.brands.toLocaleString() + " brands" : "")].filter(Boolean).join(" · ");
        return '<button class="db-comp" data-comp="' + esc(x.composition) + '"><span class="db-comp-ic">💊</span><span class="db-comp-main"><span class="db-comp-name">' + esc(x.composition) + '</span><span class="db-comp-sub">' + esc(sub) + '</span></span><span class="db-chev">›</span></button>';
      }).join("");
      r.querySelectorAll(".db-comp").forEach(function (b) { b.addEventListener("click", function () { openComposition(b.getAttribute("data-comp")); }); });
    });
  }

  /* ---- composition detail view ---- */
  function openComposition(name, sort, tier) {
    ensureRoot();
    if (!root.classList.contains("on")) { root.classList.add("on"); document.body.classList.add("db-lock"); }
    st.name = name; st.sort = sort || "relevance"; st.tier = tier || "all"; st.info = null; st.brands = []; st.total = 0; st.offset = 0;
    setTitle(name, true);
    root.querySelector("#dbBody").innerHTML = '<div class="db-empty">Loading ' + esc(name) + '…</div>';
    loadComposition(true);
  }
  function loadComposition(first) {
    if (st.loading) return; st.loading = true;
    MEDAPI.composition(st.name, st.sort, st.tier, PAGE, st.offset).then(function (d) {
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
    b.innerHTML =
      '<div class="db-head"><div class="db-gen">' + esc(d.composition) + '</div><div class="db-chips">' + chips + '</div></div>' +
      (d.uses ? '<div class="db-sec"><div class="db-sec-h">Uses</div><div class="db-sec-b">' + esc(d.uses) + '</div></div>' : '') +
      (d.side_effects ? '<div class="db-sec"><div class="db-sec-h">Side effects <span class="db-sec-note">(apply to the molecule — all brands below)</span></div><div class="db-sec-b">' + esc(d.side_effects) + '</div></div>' : '') +
      (!d.uses && !d.side_effects ? '<div class="db-sec"><div class="db-sec-h">Clinical details</div><div class="db-sec-b db-soon">Indication, dosage, pregnancy, renal/hepatic adjustment, interactions &amp; monitoring — being added from open regulatory sources (openFDA / DailyMed).</div></div>' : '') +
      (d.habit_forming ? '<div class="db-hf">Habit forming: <b>' + esc(d.habit_forming) + '</b></div>' : '') +
      '<div class="db-filters"><span class="db-filt-l">Show</span>' + tierBtn("all", "All") + tierBtn("branded", "Top branded") + tierBtn("generic", "Top generic") + '</div>' +
      '<div class="db-brands-h"><span>' + (st.total ? st.total.toLocaleString() : st.brands.length) + ' brands</span>' +
        '<span class="db-sorts">' + sortBtn("relevance", "Relevance") + sortBtn("price_asc", "Price ↑") + sortBtn("price_desc", "Price ↓") + '</span></div>' +
      '<div id="dbBrands" class="db-brand-list">' + brandsBody + '</div>' +
      '<div id="dbMore"></div>';
    b.querySelectorAll(".db-sort").forEach(function (x) {
      x.addEventListener("click", function () { var s = x.getAttribute("data-sort"); if (s !== st.sort) openComposition(st.name, s, st.tier); });
    });
    b.querySelectorAll(".db-tier").forEach(function (x) {
      x.addEventListener("click", function () { var tt = x.getAttribute("data-tier"); if (tt !== st.tier) openComposition(st.name, st.sort, tt); });
    });
    renderMore();
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

  function openList() {
    ensureRoot();
    if (st.name) st.name = null;
    root.classList.add("on"); document.body.classList.add("db-lock");
    renderList();
  }
  function close() { if (root) { root.classList.remove("on"); document.body.classList.remove("db-lock"); } }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && root && root.classList.contains("on")) close(); });

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
      ".db-note{font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#888);margin:8px 2px 12px;line-height:1.5}",
      ".db-empty,.db-allshown{font:500 13px var(--sans,system-ui);color:var(--slate-soft,#888);padding:18px;text-align:center}",
      ".db-comp{display:flex;align-items:center;gap:11px;width:100%;text-align:left;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 13px;margin-bottom:8px;cursor:pointer}",
      ".db-comp-ic{font-size:19px}.db-comp-main{flex:1;min-width:0}",
      ".db-comp-name{display:block;font:700 13.5px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".db-comp-sub{display:block;font:500 11.5px var(--sans,system-ui);color:var(--slate-soft,#888);margin-top:2px}",
      ".db-chev{color:var(--slate-soft,#888);font-size:18px}",
      ".db-head{margin-bottom:12px}.db-gen{font:800 20px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.25}",
      ".db-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}",
      ".db-chip{font:700 10.5px var(--sans,system-ui);background:var(--teal-soft,#e0f2f1);color:var(--teal,#0a9396);border-radius:7px;padding:3px 9px;text-transform:capitalize}",
      ".db-sec{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:11px;padding:11px 13px;margin-bottom:9px}",
      ".db-sec-h{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft,#888);margin-bottom:5px}",
      ".db-sec-note{text-transform:none;letter-spacing:0;font-weight:500;color:var(--slate-soft,#888)}",
      ".db-sec-b{font:500 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.6}",
      ".db-soon{color:var(--slate-soft,#888);font-style:italic}",
      ".db-hf{font:600 12px var(--sans,system-ui);color:var(--slate,#555);margin:0 2px 10px}",
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
