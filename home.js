/* StewardMD — premium home (v2). DEFAULT UI as of gold25.
   Advanced UI by MaiK is on for everyone by default. Users can switch to
   Classic from Settings / the sidebar (persists as smd_home_v2="0"), or via
   ?home=classic. ?home=v2 forces it back on. Presentation layer only: every
   control delegates to the existing global functions. Nothing is removed.
   To roll back to Classic-default, revert this commit (restore the "==='1'"
   gate); the classic-ui-stable backup is independent and untouched. */
(function () {
  "use strict";
  function flagged() {
    try {
      if (/[?&]home=v2\b/.test(location.search)) { localStorage.setItem("smd_home_v2", "1"); return true; }
      if (/[?&]home=classic\b/.test(location.search)) { localStorage.setItem("smd_home_v2", "0"); return false; }
      return localStorage.getItem("smd_home_v2") !== "0"; // default ON; only an explicit Classic choice ("0") disables
    } catch (e) { return !/[?&]home=classic\b/.test(location.search); }
  }
  var IS_V2 = flagged();

  // Add an "Interface: Advanced UI (by MaiK) / Classic UI" switch into the existing
  // ── Sidebar navigation cleanup (gold121) ─────────────────────────────────
  // Clinician-first mobile sidebar. Consolidates every previously-appended block
  // (Interface, Credits, Experimental toggles, MaiK provider card, standalone Ward
  // Sync) into: primary clinical actions at the top + advanced controls tucked into
  // the existing Settings section as collapsible subgroups + credits inside About.
  // Functionality/flags unchanged — this only reorganises navigation. Runs on each
  // SB.open (the menu is rebuilt) and is idempotent.
  function setupSidebarToggle(isV2) {
    function flag(k, def) { try { var v = localStorage.getItem(k); return v === null ? def : v === "1"; } catch (e) { return def; } }
    function injectCSS() {
      if (document.getElementById("smd-nav-css")) return;
      var st = document.createElement("style"); st.id = "smd-nav-css";
      st.textContent = [
        "#sbMenu [data-smd-top]{margin:0}",
        ".smd-nav-grp{border-top:1px solid var(--line,#d7dee3);margin-top:6px;padding-top:6px}",
        ".smd-nav-gh{display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;padding:8px 18px 8px 32px;font:700 12px/1.3 var(--sans,system-ui);color:var(--ink,#14202b);text-transform:uppercase;letter-spacing:.04em}",
        ".smd-nav-chev{color:var(--slate-soft,#5a7184);font-size:11px}",
        ".smd-nav-gb{padding:2px 18px 6px 32px}",
        ".smd-nav-row{display:flex;align-items:center;gap:10px;padding:7px 0}",
        ".smd-nav-rl{flex:1;min-width:0}.smd-nav-lbl{font:600 13.5px/1.3 var(--sans,system-ui);color:var(--ink,#14202b)}.smd-nav-sub{font:500 11px/1.35 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:1px}",
        ".smd-nav-sw{flex:0 0 auto;position:relative;width:40px;height:23px;border:none;border-radius:999px;cursor:pointer;background:var(--line,#d7dee3);transition:background .15s}.smd-nav-sw.on{background:var(--teal,#0e6e63)}.smd-nav-sw>span{position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .15s}.smd-nav-sw.on>span{left:20px}",
        ".smd-nav-btn{display:block;width:100%;text-align:left;margin:5px 0 0;padding:9px 11px;border:1px solid var(--line,#d7dee3);border-radius:9px;background:var(--paper,#f6f7f5);color:var(--ink,#14202b);font:600 13px var(--sans,system-ui);cursor:pointer}.smd-nav-btn.on{border-color:var(--teal,#0e6e63);color:var(--teal,#0e6e63)}",
        ".smd-nav-note{font:500 11px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184);padding:2px 0 4px}"
      ].join("");
      (document.head || document.documentElement).appendChild(st);
    }
    function swRow(id, label, sub, on) {
      return '<div class="smd-nav-row"><div class="smd-nav-rl"><div class="smd-nav-lbl">' + label + '</div>' + (sub ? '<div class="smd-nav-sub">' + sub + '</div>' : '') + '</div>' +
        '<button class="smd-nav-sw' + (on ? ' on' : '') + '" data-tgl="' + id + '" role="switch" aria-checked="' + on + '" aria-label="' + label + '"><span></span></button></div>';
    }
    function group(key, title, body, openDefault) {
      return '<div class="smd-nav-grp" data-smd-adv="1"><button class="smd-nav-gh" data-grp="' + key + '">' + title + '<span class="smd-nav-chev">' + (openDefault ? '▾' : '▸') + '</span></button>' +
        '<div class="smd-nav-gb" data-grpbody="' + key + '"' + (openDefault ? '' : ' style="display:none"') + '>' + body + '</div></div>';
    }
    function topBtn(icon, label, beta, onclick) {
      var b = document.createElement("button"); b.className = "sb-main sb-main-link"; b.setAttribute("data-smd-top", "1");
      b.innerHTML = '<span class="ic">' + icon + '</span><span>' + label + (beta ? ' <span class="sb-beta" style="font:700 9px/1 var(--sans,system-ui);background:var(--teal,#0e6e63);color:#fff;border-radius:5px;padding:2px 5px;vertical-align:middle;margin-left:5px">beta</span>' : '') + '</span>';
      b.addEventListener("click", function () { try { if (window.SB && SB.close) SB.close(); } catch (e) {} setTimeout(onclick, 60); });
      return b;
    }
    function reorganize() {
      var menu = document.getElementById("sbMenu"); if (!menu) return;
      injectCSS();
      // 0) strip any legacy appended blocks (older builds / re-open)
      ["[data-smd-ui]", "[data-smd-labs]", "[data-ghis-menu]", "[data-smd-nav]", "[data-smd-top]"].forEach(function (sel) { menu.querySelectorAll(sel).forEach(function (e) { e.remove(); }); });

      // 1) TOP primary actions — add "Dx My Patient" + "Ward Sync" beside the existing
      //    Clinical Reasoning / Drugs Database links.
      var links = Array.prototype.slice.call(menu.querySelectorAll(".sb-main-link"));
      var cr = links.filter(function (b) { return /Clinical Reasoning/i.test(b.textContent); })[0];
      if (cr && cr.parentNode) {
        var dx = topBtn("🩺", "Dx My Patient", false, function () { try { openDxChooser(); } catch (e) {} });
        var ws = topBtn("🏥", "Ward Sync (testing mode)", false, function () { try { if (window.openGHIS) openGHIS(); else toast("Ward Sync loading…"); } catch (e) {} });
        cr.parentNode.insertBefore(dx, cr);            // Dx My Patient first
        cr.parentNode.insertBefore(ws, cr.nextSibling); // Ward Sync after Clinical Reasoning
      }

      // 2) Advanced controls INTO Settings (#sbsub_set) as collapsible subgroups
      var setBody = document.getElementById("sbsub_set");
      if (setBody && !setBody.querySelector("[data-smd-adv]")) {
        var interfaceBody = '<button class="smd-nav-btn' + (isV2 ? ' on' : '') + '" data-ui="v2">Advanced UI' + (isV2 ? ' ✓' : '') + '</button>' +
          '<button class="smd-nav-btn' + (!isV2 ? ' on' : '') + '" data-ui="classic">Classic UI' + (!isV2 ? ' ✓' : '') + '</button>';
        var engineBody = swRow("reason", "Reasoning v2", "Live differential in the workflow", flag("smd_reason_v2", true)) +
          swRow("expanded", "Expanded Harrison KB", "+268 reference diseases as candidates", flag("smd_kb_expanded", false)) +
          '<div class="smd-nav-note">⚗️ Experimental — for clinician review.</div>';
        var aiBody = swRow("ai", "MaiK — Medical AI Knowledge", "Powered by Google AI", flag("smd_ai", false)) +
          '<div class="smd-nav-note">AI advisory — clinician confirmation required.</div>';
        var wardBody = swRow("ghis", "GHIS Ward Sync", "Live inpatient labs & radiology", flag("smd_ghis_ward", true)) +
          '<button class="smd-nav-btn" data-open-ghis="1">🏥 Open Ward Sync (testing mode)</button>';
        setBody.insertAdjacentHTML("beforeend",
          group("interface", "Interface", interfaceBody, false) +
          group("engine", "Clinical Engine (Advanced)", engineBody, false) +
          group("ai", "AI Assistant", aiBody, false) +
          group("ward", "Ward Integration", wardBody, false));
        // wire subgroup collapse
        setBody.querySelectorAll("[data-grp]").forEach(function (h) {
          h.addEventListener("click", function () {
            var b = setBody.querySelector('[data-grpbody="' + h.getAttribute("data-grp") + '"]'); if (!b) return;
            var open = b.style.display !== "none"; b.style.display = open ? "none" : "";
            var ch = h.querySelector(".smd-nav-chev"); if (ch) ch.textContent = open ? "▸" : "▾";
          });
        });
        // wire toggles
        setBody.querySelectorAll("[data-tgl]").forEach(function (sw) {
          sw.addEventListener("click", function () {
            var k = sw.getAttribute("data-tgl"), on = sw.classList.contains("on"), nv = !on;
            try {
              if (k === "reason" && window.SMD_REASON) SMD_REASON.setFlag(nv);
              else if (k === "expanded" && window.SMD_setKbExpanded) SMD_setKbExpanded(nv);
              else if (k === "ai" && window.SMD_AI) SMD_AI.setFlag(nv);
              else if (k === "ghis" && window.SMD_setGhis) SMD_setGhis(nv);
            } catch (e) {}
            sw.classList.toggle("on", nv); sw.setAttribute("aria-checked", nv);
          });
        });
        // wire interface + open-ward
        setBody.querySelectorAll("[data-ui]").forEach(function (b) {
          b.addEventListener("click", function () { try { if (window.SMD_setUI) SMD_setUI(b.getAttribute("data-ui") === "v2"); } catch (e) {} try { if (window.SB && SB.close) SB.close(); } catch (e) {} });
        });
        var og = setBody.querySelector("[data-open-ghis]");
        if (og) og.addEventListener("click", function () { try { if (window.SB && SB.close) SB.close(); } catch (e) {} setTimeout(function () { try { if (window.openGHIS) openGHIS(); } catch (e) {} }, 60); });
      }

      // 3) Credits INTO About & Help (#sbsub_about)
      var aboutBody = document.getElementById("sbsub_about");
      if (aboutBody && !aboutBody.querySelector("[data-smd-cred]")) {
        var ack = document.createElement("button"); ack.className = "sb-subitem"; ack.setAttribute("data-smd-cred", "1");
        ack.innerHTML = '<span class="ic">★</span><span>Acknowledgements &amp; Contributors</span>';
        ack.addEventListener("click", function () { try { if (window.SB && SB.close) SB.close(); } catch (e) {} setTimeout(function () { try { openAck(); } catch (e) {} }, 60); });
        aboutBody.appendChild(ack);
      }
    }
    try { if (window.SB && typeof SB.open === "function") { var orig = SB.open; SB.open = function () { var r = orig.apply(this, arguments); setTimeout(reorganize, 40); return r; }; } } catch (e) {}
    setTimeout(reorganize, 1500);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setupSidebarToggle(IS_V2); }); else setupSidebarToggle(IS_V2);

  var ICON = {
    menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
    shieldPlus: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>',
    stcase: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="12" y1="12" x2="12" y2="18"/><line x1="9" y1="15" x2="15" y2="15"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    framework: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    icu: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M6 11h2.5l1.5-3 2.5 6 1.5-3H18"/><path d="M9 22h6"/>',
    ai: '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M5 15l.7 1.9L8 18l-2.3.6L5 21l-.7-1.9L2 18l2.3-.6Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    reasoning: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
    folder: '<path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    book: '<path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="12" y1="11" x2="12.01" y2="11"/><line x1="16" y1="11" x2="16.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pills: '<path d="M10.5 13.5 3 21M2 18a4 4 0 0 0 6 3l9-9a4 4 0 0 0-6-6L2 14a4 4 0 0 0 0 4Z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3"/><path d="M7.5 15h9"/>',
    home: '<path d="M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 5 7 7-7 7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1Z"/>',
    x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13 7 22l5-3 5 3-1.2-9"/>'
  };
  function svg(name, cls) { return '<svg viewBox="0 0 24 24" class="' + (cls || "") + '">' + (ICON[name] || "") + '</svg>'; }
  function call(fn) { try { fn(); } catch (e) { console.warn("home action failed", e); } }
  function has(path) { try { return !!path(); } catch (e) { return false; } }

  var root, fab;
  function hideV2() { if (root) root.classList.remove("on"); if (fab) fab.classList.add("on"); try { if (window.SB && SB.closeRef) SB.closeRef(); } catch (e) {} }
  function showV2() { if (root) root.classList.add("on"); if (fab) fab.classList.remove("on"); var m = root && root.querySelector(".v3-main"); if (m) m.scrollTop = 0; }
  // Universal "go home" — closes any open overlay/sheet and returns to the v3 home. Wired to the
  // logo (anywhere) and the home FAB, so the user can get home from any area.
  function goHome() {
    // 1) Close every module via its own API (resets internal state + restores body scroll).
    var apis = [
      window.DX && window.DX.close, window.ELYTE && window.ELYTE.close,
      window.MEDCALC && window.MEDCALC.close, window.INF && window.INF.close,
      window.MEDDB && window.MEDDB.close, window.SB && window.SB.closeRef,
      window.SB && window.SB.close, window.closeCalc, window.closeMyCases, window.closeSearch
    ];
    apis.forEach(function (fn) { try { if (typeof fn === "function") fn(); } catch (e) {} });
    try { closeSheet(); } catch (e) {}
    try { if (window.closeDrawer) window.closeDrawer(); } catch (e) {}
    // 2) Backstop — force-hide EVERY overlay/drawer/modal so nothing keeps running underneath.
    //    open-class overlays: just remove their show-class (do NOT add .hidden, or they can't reopen).
    ["aspOverlay", "csOverlay", "eceOverlay", "infOverlay", "mcOverlay", "mdOverlay", "dxOverlay", "dbOverlay",
      "myCasesPanel", "smdSearchPanel", "sbrefOverlay", "dbDrawer", "dbScrim", "sbDrawer", "sbBackdrop",
      "hvSheet", "hvScrim"].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.classList.remove("open", "on", "active", "visible", "show");
    });
    //    hidden-class modals: add .hidden (global .hidden{display:none}); reopening removes it.
    ["modalBackdrop", "aboutModal", "disclaimerModal", "privacyModal", "termsModal", "contactModal",
      "spBackdrop", "spCalcPopup", "storageChoiceModal"].forEach(function (id) {
      var el = document.getElementById(id); if (el) el.classList.add("hidden");
    });
    try { document.body.style.overflow = ""; } catch (e) {}
    if (document.body.classList.contains("ui-v2")) { try { showV2(); } catch (e) {} }
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  // logo (and brand text) anywhere → go home
  document.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.brand, .v3-mark, .v3-shield, img[alt="StewardMD"]') : null;
    if (t) { e.preventDefault(); goHome(); }
  }, false);
  // In v2 the app's own Simple/Advanced screen must NEVER appear (the v3 chooser replaces it).
  // The app auto-reveals #modeSelect ~1.2s after login; keep it hidden so only ONE prompt shows.
  var _msObs;
  function suppressModeSelect() {
    var ms = document.getElementById("modeSelect"); if (!ms) return;
    if (!ms.classList.contains("hidden")) ms.classList.add("hidden");
    if (_msObs) return;
    try {
      _msObs = new MutationObserver(function () {
        if (document.body.classList.contains("ui-v2") && ms && !ms.classList.contains("hidden")) ms.classList.add("hidden");
      });
      _msObs.observe(ms, { attributes: true, attributeFilter: ["class"] });
    } catch (e) {}
  }

  // Add a second CTA below "Generate Clinical Decision": "Generate Clinical Reasoning",
  // which opens the differential workspace (DX). Findings already ticked carry over via
  // the DX bridge (SMD_getFindings). Two-colour language so first-time users get it:
  //   RED  = Clinical Decision  -> quick antibiotic yes/no & which
  //   BLUE = Clinical Reasoning -> full differential incl. non-infective causes
  var _rbObs;
  function injectReasonBtn() {
    if (!document.body.classList.contains("ui-v2")) return; // v3 feature; Classic untouched
    var runBtn = document.getElementById("runBtn");
    if (!runBtn || document.getElementById("smdReasonBtn")) return;
    var wrap = document.createElement("div");
    wrap.className = "smd-reason-wrap"; wrap.id = "smdReasonWrap";
    wrap.innerHTML =
      '<div class="smd-or">or</div>' +
      '<button type="button" class="reason-btn" id="smdReasonBtn">' +
        '<span class="rb-title">Generate Clinical Reasoning</span>' +
        '<span class="rb-sub">Work through the full differential — including non-infective causes</span>' +
      '</button>' +
      '<div class="decision-legend">' +
        '<div class="dl-row"><span class="dl-dot dl-red"></span><span><b>Clinical Decision</b> — quick antibiotic answer: yes / no &amp; which agent</span></div>' +
        '<div class="dl-row"><span class="dl-dot dl-blue"></span><span><b>Clinical Reasoning</b> — explore all likely diagnoses, not just infection</span></div>' +
      '</div>';
    runBtn.parentNode.insertBefore(wrap, runBtn.nextSibling);
    document.getElementById("smdReasonBtn").addEventListener("click", function () {
      try { if (document.body.classList.contains("ui-v2")) hideV2(); } catch (e) {}
      try {
        if (window.DX && DX.openWorkspace) DX.openWorkspace();
        else if (window.DX && DX.open) DX.open({ workspace: true });
        else toast("Clinical Reasoning is loading…");
      } catch (e) {}
    });
  }
  function watchReasonBtn() {
    var card = document.getElementById("inputCard");
    if (card && !_rbObs) {
      try { _rbObs = new MutationObserver(function () { injectReasonBtn(); }); _rbObs.observe(card, { childList: true, subtree: true }); } catch (e) {}
    }
    injectReasonBtn();
    watchCaseShare();
  }

  // Inject a Share / Save-as-PDF bar into the main clinical-decision output (#outputArea)
  // whenever a decision is rendered. v3 layer only; reuses the in-page print-stylesheet
  // approach so mobile shows the native sheet (Cancel returns — no stuck tab).
  var _osObs;
  function injectCaseShare() {
    if (!document.body.classList.contains("ui-v2")) return;
    var out = document.getElementById("outputArea");
    if (!out || !out.children.length) return;          // only when a decision is present
    if (out.querySelector("#smdCaseShare")) return;
    var bar = document.createElement("div");
    bar.id = "smdCaseShare"; bar.className = "smd-caseshare";
    bar.innerHTML = '<button type="button" data-cs="share">📤 Share case</button>'
                  + '<button type="button" data-cs="pdf">🖨 Save as PDF</button>';
    out.insertBefore(bar, out.firstChild);
    // listeners handled by ONE delegated document listener (watchCaseShare) — survives re-renders.
  }
  var _csDelegated = false;
  function watchCaseShare() {
    if (!_csDelegated) {
      _csDelegated = true;
      document.addEventListener("click", function (e) {
        var b = e.target && e.target.closest ? e.target.closest("[data-cs]") : null;
        if (!b) return;
        var a = b.getAttribute("data-cs");
        try { console.log("[smd] case-share click:", a); } catch (x) {}
        if (a === "share") { try { shareCase(); } catch (er) { try { console.error("[smd] shareCase err", er); } catch (z) {} toast("Share error — try again"); } }
        else if (a === "pdf") { try { printCase(); } catch (er) {} }
      }, true);
    }
    var out = document.getElementById("outputArea");
    if (out && !_osObs) {
      try { _osObs = new MutationObserver(function () { injectCaseShare(); }); _osObs.observe(out, { childList: true }); } catch (e) {}
    }
    injectCaseShare();
  }
  function caseText() {
    var out = document.getElementById("outputArea");
    var t = out ? (out.innerText || out.textContent || "") : "";
    t = t.replace(/\n{3,}/g, "\n\n").trim();
    return "StewardMD — Clinical decision\n\n" + t + "\n\nDecision support only — verify against clinical judgment & local protocol.";
  }
  function shareCase(out) {
    if (window.CASESHARE && CASESHARE.shareCurrent) { try { CASESHARE.shareCurrent(); return; } catch (e) {} }
    var txt = caseText();
    try { if (navigator.share) { navigator.share({ title: "StewardMD — Clinical decision", text: txt }).catch(function () {}); return; } } catch (e) {}
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); toast("Case copied to clipboard"); return; } } catch (e) {}
    toast("Sharing not supported here");
  }
  // Build the full differential (all DDs) from the reasoning engine for the current findings.
  // Guarded: if the engine isn't available, returns "" and the PDF simply omits it.
  function caseDifferentialHTML() {
    try {
      if (!window.DX || !DX._differential) return "";
      var f = (window.SMD_getFindings ? SMD_getFindings() : null) || (DX._state && DX._state.f) || {};
      if (DX._state) DX._state.f = f;
      var d = DX._differential();
      if (!d) return "";
      function e(x) { return String(x == null ? "" : x).replace(/[&<>]/g, function (c) { return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
      function rows(a) { return (a || []).slice(0, 15).map(function (r, i) { return '<div style="display:flex;justify-content:space-between;gap:10px;font:500 12.5px/1.7 sans-serif;padding:1px 0"><span>' + (i + 1) + ". " + e(r.name) + '</span><span style="color:#64748B">' + (r.score != null ? r.score + "/100" : "") + "</span></div>"; }).join("") || '<div style="font-size:12px;color:#888">—</div>'; }
      return '<div style="margin-top:18px;padding-top:12px;border-top:1px solid #E2E8F0"><div style="font:800 13px sans-serif;margin-bottom:6px">Full differential — infectious</div>' + rows(d.inf) + '<div style="font:800 13px sans-serif;margin:12px 0 6px">Non-infectious</div>' + rows(d.ni) + '<div style="font:500 10px sans-serif;color:#888;margin-top:8px">Reasoning differential (decision support) — not a confirmed diagnosis.</div></div>';
    } catch (err) { return ""; }
  }
  function printCase() {
    try {
      var out = document.getElementById("outputArea");
      if (!out || !out.children.length) { toast("Generate a clinical decision first."); return; }
      var old = document.getElementById("smdPrintArea"); if (old) old.remove();
      if (!document.getElementById("smd-caseprint-style")) {
        var st = document.createElement("style"); st.id = "smd-caseprint-style";
        // clone the decision into a TOP-LEVEL node so ancestor display:none / overflow (v3 overlays) can't blank it
        st.textContent = "@media print{body>*{display:none!important}#smdPrintArea{display:block!important;position:static}#smdPrintArea #smdCaseShare{display:none!important}@page{margin:12mm}}#smdPrintArea{display:none}";
        document.head.appendChild(st);
      }
      var area = document.createElement("div"); area.id = "smdPrintArea";
      var clone = out.cloneNode(true);
      var bar = clone.querySelector("#smdCaseShare"); if (bar) bar.remove();
      area.appendChild(clone);
      try { var dh = caseDifferentialHTML(); if (dh) { var dd = document.createElement("div"); dd.innerHTML = dh; area.appendChild(dd); } } catch (e) {}
      document.body.appendChild(area);
      var cleaned = false;
      function cleanup() { if (cleaned) return; cleaned = true; try { area.remove(); } catch (e) {} window.removeEventListener("afterprint", cleanup); }
      window.addEventListener("afterprint", cleanup);
      setTimeout(function () { try { window.print(); } catch (e) { toast("Print unavailable"); cleanup(); } }, 80);
      setTimeout(cleanup, 60000);
    } catch (e) { toast("Print unavailable"); }
  }

  // Start a Case -> new-design Simple/Advanced chooser (rendered inside the v2 home), wired to the real cards.
  function openCaseChooser() {
    if (!root) build();
    root.classList.add("on"); if (fab) fab.classList.remove("on");
    var p = root.querySelector("#hvCase");
    if (!p) {
      p = document.createElement("div"); p.id = "v3case"; p.className = "v3-screen";
      p.innerHTML =
        '<header class="v3-header"><button class="v3-ic" data-cx="back" aria-label="Back">' + svg("chev") + '</button><div class="v3-brand"><div style="min-width:0"><div class="v3-brand-tt">Start a Case</div><div class="v3-brand-sub">Choose how to enter findings</div></div></div></header>' +
        '<main class="v3-main"><div class="v3-stack">' +
          '<button class="v3-primary" data-m="simple"><div class="ic">' + svg("reasoning") + '</div><div style="flex:1;min-width:0"><div class="tt">Simple</div><div class="sub">Guided, step-by-step — pick the problem, answer a few questions</div></div><div class="arr">' + svg("arrow") + '</div></button>' +
          '<button class="v3-secondary" data-m="advanced"><div class="ic">' + svg("sliders") + '</div><div style="flex:1;min-width:0"><div class="tt">Advanced</div><div class="sub">Full clinical form — all findings, vitals, labs &amp; risk at once</div></div><div class="arr">' + svg("chev") + '</div></button>' +
          '<div class="v3-foot">You can switch modes anytime from the header.</div>' +
        '</div></main>';
      root.appendChild(p);
      p.addEventListener("click", function (e) {
        e.stopPropagation();
        if (e.target.closest('[data-cx="back"]')) { p.classList.remove("on"); return; }
        var b = e.target.closest("[data-m]"); if (!b) return;
        var m = b.getAttribute("data-m");
        p.classList.remove("on"); hideV2();
        var card = document.getElementById(m === "advanced" ? "modeAdvancedCard" : "modeSimpleCard");
        if (card) card.click(); else { var ms = document.getElementById("modeSelect"); if (ms) ms.classList.remove("hidden"); }
      });
    }
    p.classList.add("on");
  }
  // --- action delegates. Overlay screens (drawer/search/calculators/drugs/guidelines/about) layer OVER the v2 home
  //     (higher z-index) and return to it when closed — so we DON'T hide the home for them. Only in-shell flows hide it. ---
  var ACT = {
    startcase: openCaseChooser,
    reasoning: function () { openDxChooser(); },
    search: function () { if (typeof openSearch === "function") openSearch(); else if (window.MEDDB) MEDDB.openList(); },
    cases: function () { if (typeof openMyCases === "function") openMyCases(); else toast("My Cases unavailable"); },
    calculators: function () { if (window.MEDCALC && MEDCALC.openList) MEDCALC.openList(); else toast("Calculators loading…"); },
    guidelines: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Guidelines loading…"); },
    drugs: function () { if (window.MEDDB && MEDDB.openList) MEDDB.openList(); else toast("Drugs database loading…"); },
    electrolytes: function () { if (window.ELYTE && ELYTE.open) ELYTE.open(); else toast("Electrolyte engine loading…"); },
    framework: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Framework"); },
    icu: function () { if (window.ICU && ICU.open) ICU.open(); else if (window.INF && INF.openDashboard) INF.openDashboard(); else if (window.INF && INF.open) INF.open(); else toast("ICU loading…"); },
    askai: function () { openAskAi(); },
    theme: function () { if (window.SB && SB.toggleTheme) SB.toggleTheme(); else document.body.classList.toggle("dark"); },
    menu: function () { if (window.SB && SB.open) SB.open(); },
    about: function () { if (window.SB && SB.modal) SB.modal("aboutModal"); else if (typeof openModal === "function") openModal("aboutModal"); },
    account: function () { if (window.SB && SB.open) SB.open(); },
    recent: function () { if (typeof openMyCases === "function") openMyCases(); }
  };
  function injectCSS() {
    if (document.getElementById("smd-home-css")) return;
    var st = document.createElement("style"); st.id = "smd-home-css";
    st.textContent = [
      "#homeV2{--hp:#0F766E;--hp2:#115E59;--hps:#CCFBF1;--hbg:#F8FAFC;--hpanel:#fff;--hbd:#E2E8F0;--hink:#0F172A;--hmut:#64748B;--hsh:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06);--hslg:0 8px 30px rgba(15,118,110,.22);--hfont:'Inter',-apple-system,'SF Pro Display','Segoe UI',Roboto,system-ui,sans-serif;position:fixed;inset:0;z-index:90;background:var(--hbg);color:var(--hink);font-family:var(--hfont);overflow:hidden;display:none;flex-direction:column}",
      "#homeV2.on{display:flex}",
      "body.dark #homeV2{--hbg:#0B1220;--hpanel:#111B2E;--hbd:#1E2B43;--hink:#E7EDF5;--hmut:#8597AD;--hps:#0c2e2a;--hsh:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35)}",
      "#homeV2 svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:0 0 auto}",
      "#homeV2 button{font-family:inherit;-webkit-tap-highlight-color:transparent}",
      ".hv-hdr{height:72px;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--hpanel);border-bottom:1px solid var(--hbd);padding-top:env(safe-area-inset-top);flex:0 0 auto}",
      ".hv-ib{width:42px;height:42px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--hink);border-radius:12px;cursor:pointer;transition:background .18s}.hv-ib:active{transform:scale(.94)}.hv-ib:hover{background:var(--hbg)}",
      ".hv-mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,var(--hp),var(--hp2));display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-mark svg{width:19px;height:19px;stroke:#fff}",
      ".hv-bz{display:flex;align-items:center;gap:10px;min-width:0}.hv-tt{font:800 16px/1.1 var(--hfont);letter-spacing:-.01em}.hv-ts{font:500 11.5px/1.2 var(--hfont);color:var(--hmut);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".hv-sp{flex:1}",
      ".hv-av{width:34px;height:34px;border-radius:50%;background:var(--hps);color:var(--hp);display:flex;align-items:center;justify-content:center;font:700 13px var(--hfont);border:1px solid var(--hbd);cursor:pointer}",
      ".hv-dot{position:relative}.hv-dot:after{content:'';position:absolute;top:9px;right:10px;width:7px;height:7px;border-radius:50%;background:#ef4444;border:2px solid var(--hpanel)}",
      ".hv-main{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px 16px 96px}.hv-stack{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:16px}",
      ".hv-hero{background:var(--hpanel);border:1px solid var(--hbd);border-radius:16px;box-shadow:var(--hsh);padding:20px;display:flex;align-items:center;gap:14px}",
      ".hv-hero h1{font:800 28px/1.05 var(--hfont);letter-spacing:-.02em;margin:0}.hv-tag{display:inline-block;margin-top:10px;font:700 11px var(--hfont);text-transform:uppercase;letter-spacing:.06em;color:var(--hp);background:var(--hps);padding:4px 10px;border-radius:999px}.hv-hero p{font:500 14px/1.45 var(--hfont);color:var(--hmut);margin:10px 0 0}",
      ".hv-shield{width:74px;height:74px;border-radius:20px;background:linear-gradient(135deg,var(--hp),var(--hp2));display:flex;align-items:center;justify-content:center;flex:0 0 auto;box-shadow:var(--hslg)}.hv-shield svg{width:38px;height:38px;stroke:#fff}",
      ".hv-qrow{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}",
      ".hv-qc{height:62px;background:var(--hpanel);border:1px solid var(--hbd);border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;color:var(--hink);transition:transform .15s,box-shadow .18s}.hv-qc:active{transform:scale(.96)}.hv-qc:hover{box-shadow:var(--hsh)}.hv-qc svg{width:19px;height:19px;color:var(--hp)}.hv-qc span{font:600 11px var(--hfont);color:var(--hmut)}",
      ".hv-primary{display:flex;align-items:center;gap:15px;padding:20px;border:none;border-radius:18px;background:linear-gradient(135deg,#14B8A6,var(--hp) 55%,var(--hp2));color:#fff;box-shadow:var(--hslg);cursor:pointer;width:100%;text-align:left;transition:transform .15s,filter .18s}.hv-primary:active{transform:scale(.985)}.hv-primary:hover{filter:brightness(1.04)}",
      ".hv-pic{width:52px;height:52px;border-radius:15px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-pic svg{width:27px;height:27px;stroke:#fff}",
      ".hv-pb{flex:1;min-width:0}.hv-ptit{font:800 19px/1.1 var(--hfont);letter-spacing:-.01em}.hv-psub{font:500 13px/1.35 var(--hfont);color:rgba(255,255,255,.88);margin-top:3px}.hv-parr svg{stroke:#fff;opacity:.9}",
      ".hv-sec{display:flex;align-items:center;gap:15px;padding:18px 20px;border:1px solid var(--hbd);border-radius:18px;background:var(--hpanel);color:var(--hink);box-shadow:var(--hsh);cursor:pointer;width:100%;text-align:left;transition:transform .15s,box-shadow .18s}.hv-sec:active{transform:scale(.985)}",
      ".hv-sic{width:52px;height:52px;border-radius:15px;background:var(--hps);display:flex;align-items:center;justify-content:center;flex:0 0 auto}.hv-sic svg{stroke:var(--hp);width:26px;height:26px}.hv-stit{font:700 17px/1.1 var(--hfont)}.hv-ssub{font:500 13px/1.35 var(--hfont);color:var(--hmut);margin-top:3px}.hv-sarr svg{stroke:var(--hmut)}",
      ".hv-lbl{font:700 12px var(--hfont);text-transform:uppercase;letter-spacing:.06em;color:var(--hmut);margin:2px 2px -4px}",
      ".hv-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}",
      ".hv-tile{background:var(--hpanel);border:1px solid var(--hbd);border-radius:16px;box-shadow:var(--hsh);padding:16px;display:flex;align-items:center;gap:12px;cursor:pointer;color:var(--hink);transition:transform .15s,box-shadow .18s}.hv-tile:active{transform:scale(.97)}",
      ".hv-tic{width:42px;height:42px;border-radius:12px;background:var(--hbg);display:flex;align-items:center;justify-content:center;flex:0 0 auto;border:1px solid var(--hbd)}.hv-tic svg{width:21px;height:21px;color:var(--hp)}.hv-tl{font:600 14px var(--hfont)}.hv-tc{font:500 11.5px var(--hfont);color:var(--hmut);margin-top:1px}",
      ".hv-info{font:500 12px/1.6 var(--hfont);color:var(--hmut);text-align:center;padding:4px 8px}.hv-info b{color:var(--hink)}",
      ".hv-tab{position:absolute;left:0;right:0;bottom:0;background:var(--hpanel);border-top:1px solid var(--hbd);display:flex;justify-content:space-around;padding:6px 6px calc(6px + env(safe-area-inset-bottom));flex:0 0 auto}.hv-t{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:7px 0;border:none;background:transparent;color:var(--hmut);cursor:pointer;border-radius:12px}.hv-t svg{width:22px;height:22px}.hv-t span{font:600 10.5px var(--hfont)}.hv-t.active{color:var(--hp)}.hv-t:active{transform:scale(.93)}",
      // sheet (More / Display)
      ".hv-scrim{position:fixed;inset:0;background:rgba(8,18,26,.5);opacity:0;pointer-events:none;transition:opacity .2s;z-index:130}.hv-scrim.on{opacity:1;pointer-events:auto}",
      ".hv-sheet{--hpanel:var(--v3-panel,#fff);--hink:var(--v3-ink,#0F172A);--hmut:var(--v3-muted,#64748B);--hbd:var(--v3-border,#E2E8F0);--hbg:var(--v3-bg,#F8FAFC);--hp:var(--v3-primary,#0F766E);--hps:var(--v3-primary-soft,#CCFBF1);--hfont:'Inter',-apple-system,'Segoe UI',Roboto,system-ui,sans-serif;position:fixed;left:0;right:0;bottom:0;z-index:131;background:var(--hpanel,#fff);color:var(--hink,#0F172A);border-radius:20px 20px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.22);transform:translateY(100%);transition:transform .26s cubic-bezier(.2,.7,.2,1);max-height:86vh;overflow-y:auto;font-family:var(--hfont)}.hv-sheet.on{transform:none}.hv-sheet-wrap{max-width:480px;margin:0 auto;padding:8px 18px calc(22px + env(safe-area-inset-bottom))}",
      ".hv-grab{width:38px;height:4px;border-radius:2px;background:var(--hbd);margin:8px auto 12px}",
      ".hv-sh-t{font:800 17px var(--hfont);margin:2px 0 12px}",
      ".hv-mi{display:flex;align-items:center;gap:13px;width:100%;text-align:left;background:transparent;border:none;border-radius:12px;padding:13px 8px;cursor:pointer;color:var(--hink)}.hv-mi:hover{background:var(--hbg)}.hv-mi:active{transform:scale(.99)}.hv-mi svg{width:21px;height:21px;color:var(--hp)}.hv-mi .ml{flex:1;font:600 14.5px var(--hfont)}.hv-mi .mc{font:500 12px var(--hfont);color:var(--hmut);margin-top:1px}.hv-mi .marr svg{stroke:var(--hmut);width:18px;height:18px}",
      ".hv-mi+.hv-mi{border-top:1px solid var(--hbd)}",
      // display engine controls
      ".hv-d-sec{margin:6px 0 16px}.hv-d-sec h4{font:800 11px var(--hfont);text-transform:uppercase;letter-spacing:.05em;color:var(--hmut);margin:0 0 9px}",
      ".hv-d-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}.hv-d-val{font:800 14px var(--hfont);color:var(--hp)}",
      "#homeV2 input[type=range],.hv-sheet input[type=range]{width:100%;accent-color:var(--hp);height:30px}",
      ".hv-seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.hv-seg button,.hv-pre button{background:var(--hbg);border:1.5px solid var(--hbd);border-radius:10px;padding:9px 6px;font:700 12px var(--hfont);color:var(--hmut);cursor:pointer}.hv-seg button.on{background:var(--hp);border-color:var(--hp);color:#fff}",
      ".hv-pre{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.hv-pre button{padding:12px 8px}",
      ".hv-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--hbg);border:1px solid var(--hbd);border-radius:12px;padding:11px 13px;margin-top:6px}.hv-sw .lab{font:700 13px var(--hfont)}.hv-sw .sub{font:500 11px var(--hfont);color:var(--hmut);margin-top:2px}.hv-tg{position:relative;width:48px;height:28px;flex:0 0 auto;border-radius:999px;background:var(--hbd);border:none;cursor:pointer;transition:.18s}.hv-tg.on{background:var(--hp)}.hv-tg:after{content:'';position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:.18s}.hv-tg.on:after{left:23px}",
      ".hv-reset{width:100%;background:#fbe7e9;color:#ab1c2c;border:1px solid #efa9b1;border-radius:11px;padding:12px;font:700 13px var(--hfont);cursor:pointer;margin-top:6px}",
      ".hv-back{display:block;width:100%;text-align:center;color:var(--hmut);background:transparent;border:none;font:600 12px var(--hfont);padding:10px;cursor:pointer;margin-top:4px}",
      ".hv-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:#0F172A;color:#fff;font:600 13px var(--hfont);padding:10px 16px;border-radius:11px;z-index:200;opacity:0;transition:opacity .2s;pointer-events:none}.hv-toast.on{opacity:.96}",
      ".hv-fab{position:fixed;right:16px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:9999;width:54px;height:54px;border-radius:50%;border:none;background:linear-gradient(135deg,#14B8A6,#0F766E);color:#fff;box-shadow:0 8px 24px rgba(15,118,110,.42);align-items:center;justify-content:center;cursor:pointer;display:flex}.hv-fab svg{width:34px;height:34px}.hv-fab svg image{opacity:.96}.hv-fab:active{transform:scale(.92)}",
      ".brand,.v3-mark,.v3-shield,img[alt=\"StewardMD\"]{cursor:pointer}",
      // account/profile block injected into the sidebar (settings)
      ".smd-sba{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(127,127,127,.18);background:linear-gradient(180deg,rgba(20,184,166,.10),transparent)}",
      ".smd-sba-pic{width:42px;height:42px;border-radius:50%;object-fit:cover;flex:0 0 auto;background:#0F766E}",
      ".smd-sba-ph{display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:17px}",
      ".smd-sba-info{flex:1;min-width:0}",
      ".smd-sba-name{font-weight:700;font-size:14px;color:var(--ink,#14202b);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".smd-sba-email{font-size:12px;color:var(--slate-soft,#5a7184);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".smd-sba-prov{font-size:10.5px;color:#0F766E;font-weight:600;margin-top:1px}",
      ".smd-sba-btn{flex:0 0 auto;border:1px solid var(--line,#d7dee3);background:var(--panel,#fff);color:#0F766E;font-weight:600;font-size:12px;padding:7px 11px;border-radius:8px;cursor:pointer}",
      ".smd-sba-btn:active{transform:scale(.96)}",
      // account panel inside the More sheet
      ".hv-acct{text-align:center;padding:6px 4px 2px}",
      ".hv-acct-pic{width:74px;height:74px;border-radius:50%;object-fit:cover;margin:4px auto 12px;display:block;background:var(--hp)}",
      ".hv-acct-ph{display:flex;align-items:center;justify-content:center;color:#fff;font:800 28px var(--hfont)}",
      ".hv-acct-name{font:800 19px var(--hfont);color:var(--hink)}",
      ".hv-acct-email{font:500 13px var(--hfont);color:var(--hmut);margin-top:3px;word-break:break-all}",
      ".hv-acct-badge{display:inline-block;margin-top:11px;font:700 11px var(--hfont);color:var(--hp);background:var(--hps);padding:4px 12px;border-radius:999px}",
      ".hv-acct-btn{display:block;width:100%;margin-top:18px;border:none;border-radius:12px;background:var(--hp);color:#fff;font:700 15px var(--hfont);padding:13px;cursor:pointer}",
      ".hv-acct-btn.out{background:transparent;border:1px solid var(--hbd);color:var(--hink)}",
      ".hv-acct-btn:active{transform:scale(.98)}",
      ".hv-acct-note{font:500 12px/1.5 var(--hfont);color:var(--hmut);margin-top:13px}",
      // About modal: tabs + version-history timeline + facts
      ".smd-ab-tabs{display:flex;gap:4px;margin:-4px 0 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}",
      ".smd-ab-tab{border:none;background:none;font:700 12.5px var(--sans);color:var(--slate-soft);padding:8px 2px;margin-right:14px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}",
      ".smd-ab-tab.on{color:var(--teal);border-bottom-color:var(--teal)}",
      ".smd-ab-badge{display:inline-block;background:var(--teal-soft);color:var(--teal);font:700 11px var(--sans);padding:3px 10px;border-radius:999px;margin-bottom:12px}",
      ".smd-vh-item{padding:0 0 16px 16px;border-left:2px solid var(--line);position:relative}",
      ".smd-vh-item:last-child{border-left-color:transparent;padding-bottom:2px}",
      ".smd-vh-item:before{content:'';position:absolute;left:-6px;top:3px;width:10px;height:10px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 3px var(--teal-soft)}",
      ".smd-vh-ver{font:800 14px var(--sans);color:var(--ink);margin-bottom:6px}",
      ".smd-vh ul{margin:0;padding-left:15px}",
      ".smd-vh li{margin:4px 0;font-size:12.5px;color:var(--slate);line-height:1.55}",
      ".smd-vh li b{color:var(--teal);font-weight:700}",
      ".smd-vh-now{color:#b5460f;font-weight:800}",
      "ul.smd-facts{list-style:none;padding:0;margin:0}",
      "ul.smd-facts li{display:flex;gap:12px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--line);font-size:13px;color:var(--slate);line-height:1.5}",
      "ul.smd-facts .fn{font:800 17px var(--sans);color:var(--teal);min-width:62px;flex:0 0 auto}",
      // density (spacing) — independent of font zoom
      "body.smd-dens-compact #homeV2 .hv-stack{gap:11px}body.smd-dens-comfortable #homeV2 .hv-stack{gap:20px}body.smd-dens-large #homeV2 .hv-stack{gap:26px}",
      "body.smd-dens-compact #homeV2 .hv-hero{padding:14px}body.smd-dens-comfortable #homeV2 .hv-hero{padding:24px}body.smd-dens-large #homeV2 .hv-hero{padding:28px}",
      "body.smd-dens-compact #homeV2 .hv-tile,body.smd-dens-compact #homeV2 .hv-primary,body.smd-dens-compact #homeV2 .hv-sec{padding:13px}body.smd-dens-large #homeV2 .hv-tile{padding:20px}",
      // ===== Advanced UI theme — restyles the WHOLE app by overriding its design tokens (active only with body.ui-v2) =====
      "body.ui-v2{--teal:#0F766E;--teal-soft:#CCFBF1;--paper:#F8FAFC;--panel:#FFFFFF;--line:#E2E8F0;--ink:#0F172A;--slate:#334155;--slate-soft:#64748B;--sans:'Inter',-apple-system,'SF Pro Display','Segoe UI',Roboto,system-ui,sans-serif}",
      "body.ui-v2.dark{--paper:#0B1220;--panel:#111B2E;--line:#1E2B43;--ink:#E7EDF5;--slate:#9FB2C6;--slate-soft:#7E92A8;--teal:#2DD4BF;--teal-soft:#0C2E2A}",
      "body.ui-v2{font-family:var(--sans)}",
      "body.ui-v2 .card,body.ui-v2 .score-card,body.ui-v2 .quick-answer-card,body.ui-v2 .simple-candidates-card,body.ui-v2 .drug-card,body.ui-v2 .sp-card,body.ui-v2 .scm-card,body.ui-v2 .demo-card,body.ui-v2 .mcp-case-card,body.ui-v2 .aware-card,body.ui-v2 .no-match-card{border-radius:16px!important;border:1px solid var(--line)!important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06)!important}",
      "body.ui-v2 .mode-select-inner{max-width:480px;margin:0 auto}body.ui-v2 .mode-card{border-radius:16px!important;padding:18px!important;border:1px solid var(--line)!important;box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.06)!important;transition:transform .15s,box-shadow .18s}body.ui-v2 .mode-card:active{transform:scale(.985)}",
      "body.ui-v2 .group-tab,body.ui-v2 .asp-tab,body.ui-v2 .inf-tab,body.ui-v2 .sbref-tab{border-radius:999px!important;padding:8px 15px!important;font-weight:600}",
      "body.ui-v2 .radio-opt,body.ui-v2 .scm-opt,body.ui-v2 .finding-item,body.ui-v2 .asp-opt,body.ui-v2 .simple-chip{border-radius:12px!important;min-height:44px}",
      "body.ui-v2 .numeric-field input,body.ui-v2 .numeric-field select,body.ui-v2 .sp-input,body.ui-v2 .inf-input,body.ui-v2 .calc-input,body.ui-v2 .scp-input,body.ui-v2 .tester-input{border-radius:12px!important;min-height:46px}",
      "body.ui-v2 .run-btn,body.ui-v2 .asp-launch-btn,body.ui-v2 .calc-btn,body.ui-v2 .scp-save-btn,body.ui-v2 .unlock-btn,body.ui-v2 .none-above-btn{border-radius:14px!important;min-height:52px!important;font-weight:700!important;letter-spacing:.01em}",
      "body.ui-v2 .step-nav-btn{border-radius:12px!important;min-height:48px!important;font-weight:600}body.ui-v2 .step-progress-fill{background:var(--teal)!important}",
      "body.ui-v2 .my-cases-btn,body.ui-v2 .smd-search-btn,body.ui-v2 .system-picker-btn,body.ui-v2 .asp-mini-btn,body.ui-v2 .inf-minibtn{border-radius:12px!important}",
      "body.ui-v2 .app-head{border-bottom:1px solid var(--line)}body.ui-v2 .brand{letter-spacing:-.01em}",
      "body.ui-v2 .score-chip,body.ui-v2 .sp-chip,body.ui-v2 .dash-chip,body.ui-v2 .factor-chip,body.ui-v2 .ref-chip,body.ui-v2 .evidence-pill,body.ui-v2 .simple-chip{border-radius:999px!important}",
      // in-form screens: system tabs, symptom/finding pickers, framework steps, score/results
      "body.ui-v2 .num{background:var(--teal)!important;color:#fff!important;border-radius:8px!important}",
      "body.ui-v2 .group-tabs{gap:8px}body.ui-v2 .group-tab.active{background:var(--teal)!important;color:#fff!important;border-color:var(--teal)!important}",
      "body.ui-v2 .finding-section{border:1px solid var(--line);border-radius:14px;padding:12px;margin-bottom:12px;background:var(--panel)}",
      "body.ui-v2 .finding-item,body.ui-v2 .radio-opt,body.ui-v2 .scm-opt{padding:11px 12px;border:1px solid var(--line)!important}",
      "body.ui-v2 .radio-opt.selected,body.ui-v2 .finding-item.selected,body.ui-v2 .scm-opt.selected,body.ui-v2 .simple-chip.selected,body.ui-v2 .asp-opt.selected{background:var(--teal-soft)!important;border-color:var(--teal)!important;color:var(--teal)!important}",
      "body.ui-v2 .simple-section-label,body.ui-v2 .sp-section-label,body.ui-v2 .tier-label,body.ui-v2 .radio-field-label{font-weight:700;letter-spacing:.02em}",
      "body.ui-v2 .simple-chip-grid,body.ui-v2 .finding-grid{gap:8px}body.ui-v2 .simple-chip{padding:9px 13px;border:1px solid var(--line)!important}",
      "body.ui-v2 .step-progress-bar{border-radius:999px;overflow:hidden;background:var(--line)}body.ui-v2 .step-progress-fill{background:var(--teal)}body.ui-v2 .step-progress-label{font-weight:700}",
      "body.ui-v2 .findings-count{font-weight:600;color:var(--slate-soft)}",
      "body.ui-v2 .score-card-head,body.ui-v2 .qa-header,body.ui-v2 .sp-header,body.ui-v2 .mcp-header,body.ui-v2 .scm-opt-title{font-weight:800;letter-spacing:-.01em}",
      "body.ui-v2 .score-recommendation,body.ui-v2 .pregnancy-recommendation,body.ui-v2 .antibiogram-recommendation,body.ui-v2 .quick-answer-card{border-radius:14px!important;border:1px solid var(--line)!important}",
      "body.ui-v2 .coverage-table-wrap{border-radius:12px;overflow:auto;border:1px solid var(--line)}",
      "body.ui-v2 .system-picker-btn{border:1px solid var(--line)!important;border-radius:12px!important;min-height:48px}",
      "body.ui-v2 .pathogen-tier,body.ui-v2 .tier-very-likely,body.ui-v2 .tier-likely,body.ui-v2 .tier-possible{border-radius:12px!important}",
      "body.ui-v2 .sb-drawer{border-right:1px solid var(--line)}body.ui-v2 .sb-head{border-bottom:1px solid var(--line)}body.ui-v2 #sbMenu>div,body.ui-v2 #sbMenu>button{border-radius:12px}",
      "body.ui-v2 .sbref-overlay{z-index:140!important}",
      "body.ui-v2 .brandrow{flex-wrap:nowrap!important;align-items:center!important;justify-content:space-between!important;gap:10px}",
      "body.ui-v2 .brandrow>div:first-child{flex:0 1 auto;min-width:0}",
      "body.ui-v2 .brandrow .tagline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}",
      "body.ui-v2 .app-head-actions{flex:1 1 auto;min-width:0;justify-content:flex-end!important;flex-wrap:wrap;gap:8px}",
      "#homeV2 .v3-devfoot{max-width:var(--v3-maxw);margin:20px auto 4px;padding:18px 16px 8px;border-top:1px solid var(--v3-border,#E2E8F0);text-align:center}",
      "#homeV2 .v3-devlabel{font:700 10px/1 var(--v3-font);letter-spacing:.14em;color:var(--v3-muted,#64748B);margin-bottom:10px}",
      "#homeV2 .v3-devlogo{height:38px;width:auto;max-width:200px;display:block;margin:0 auto 8px;object-fit:contain}",
      "body.v3-dark #homeV2 .v3-devlogo,body.dark #homeV2 .v3-devlogo,body.v3-dark .hv-sheet #v3AiLogo,body.dark .hv-sheet #v3AiLogo{filter:brightness(0) invert(1) opacity(.88)}",
      "#homeV2 .v3-devname{font:700 14px/1.2 var(--v3-font);color:var(--v3-ink,#0F172A);margin-bottom:8px}",
      "#homeV2 .v3-devmeta{font:500 11px/1.55 var(--v3-font);color:var(--v3-muted,#64748B);max-width:340px;margin:2px auto 0}",
      ".hv-sheet .hv-ack{font-family:var(--hfont);color:var(--hink);font-size:13px;line-height:1.6;padding:2px 0}",
      ".hv-sheet .hv-ack h2,.hv-sheet .hv-ack h3,.hv-sheet .hv-ack .ack-title,.hv-sheet .hv-ack .ack-role,.hv-sheet .hv-ack b,.hv-sheet .hv-ack strong{color:var(--hink)}",
      ".hv-sheet .hv-ack .ack-group{border-top:1px solid var(--hbd);padding:12px 0;margin:0}",
      ".hv-sheet .hv-ack .ack-role{font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--hmut);margin-bottom:4px}",
      ".hv-sheet .hv-ack .num{color:var(--hp)}",
      // ===== Step 3: in-case screens (system / symptoms / framework / results) to v3 =====
      "body.ui-v2 .app-head{padding:12px 16px!important}",
      "body.ui-v2 .card{padding:18px!important;margin-bottom:14px}",
      "body.ui-v2 .card h2{font:800 16px/1.2 var(--sans)!important;display:flex;align-items:center;gap:10px;margin:0 0 14px}",
      "body.ui-v2 .num{display:inline-flex;align-items:center;justify-content:center;min-width:30px;height:30px;padding:0 8px;font:800 12px var(--sans)!important;border-radius:9px!important}",
      "body.ui-v2 .group-tabs{display:flex;gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px;scrollbar-width:none}body.ui-v2 .group-tabs::-webkit-scrollbar{display:none}",
      "body.ui-v2 .group-tab{white-space:nowrap;font:600 13px var(--sans)!important;padding:9px 16px!important}",
      "body.ui-v2 .finding-section{padding:14px!important;margin-bottom:14px!important}",
      "body.ui-v2 .simple-section-label,body.ui-v2 .radio-field-label{font:700 13px var(--sans)!important;color:var(--ink)!important;margin-bottom:8px;display:block}",
      "body.ui-v2 .finding-grid,body.ui-v2 .simple-chip-grid,body.ui-v2 .numeric-field-grid{gap:8px!important}",
      "body.ui-v2 .finding-item,body.ui-v2 .radio-opt,body.ui-v2 .scm-opt,body.ui-v2 .simple-chip{padding:12px 14px!important;font:600 13.5px var(--sans)!important;transition:transform .1s,background .12s,border-color .12s}body.ui-v2 .finding-item:active,body.ui-v2 .radio-opt:active,body.ui-v2 .scm-opt:active{transform:scale(.985)}",
      "body.ui-v2 .numeric-field input,body.ui-v2 .numeric-field select{font:600 14px var(--sans)!important;padding:0 12px!important}",
      "body.ui-v2 .run-btn{width:100%;background:var(--teal)!important;color:#fff!important;font:800 15px var(--sans)!important;letter-spacing:.01em;box-shadow:0 8px 22px rgba(15,118,110,.25)!important;margin-top:10px}body.ui-v2 .run-btn:disabled{opacity:.5;box-shadow:none!important}",
      "body.ui-v2 .step-nav{display:flex;gap:10px!important;margin-top:14px}body.ui-v2 .step-nav-btn{flex:1;font:700 14px var(--sans)!important}body.ui-v2 .step-nav-next,body.ui-v2 .step-nav-btn.primary{background:var(--teal)!important;color:#fff!important;border-color:var(--teal)!important}",
      "body.ui-v2 .step-progress{margin:6px 2px 14px}body.ui-v2 .step-progress-bar{height:8px!important;border-radius:999px!important;overflow:hidden}body.ui-v2 .step-progress-label{font:700 12px var(--sans)!important;color:var(--slate-soft)}",
      "body.ui-v2 .findings-count{font:600 12.5px var(--sans)!important;color:var(--slate-soft)!important;text-align:center;margin:10px 0}",
      "body.ui-v2 .score-card,body.ui-v2 .quick-answer-card,body.ui-v2 .drug-card,body.ui-v2 .no-match-card,body.ui-v2 .simple-candidates-card{padding:16px!important;margin-bottom:14px!important}",
      "body.ui-v2 .score-card-head,body.ui-v2 .qa-header{font:800 16px/1.25 var(--sans)!important;letter-spacing:-.01em;margin-bottom:8px}",
      "body.ui-v2 .score-value{font:800 30px var(--sans)!important;color:var(--teal)!important;line-height:1}",
      "body.ui-v2 .score-recommendation,body.ui-v2 .pregnancy-recommendation,body.ui-v2 .antibiogram-recommendation{padding:14px!important;line-height:1.6}",
      "body.ui-v2 .coverage-table th{background:var(--paper)!important;font:700 10.5px var(--sans)!important;text-transform:uppercase;letter-spacing:.04em;color:var(--slate-soft)!important}body.ui-v2 .coverage-table td{padding:8px 10px!important}",
      "body.ui-v2 .system-picker-btn,body.ui-v2 .scm-card{padding:14px!important;min-height:52px}",
      "body.ui-v2 .scm-opt-title{font:700 14px var(--sans)!important}body.ui-v2 .scm-opt-sub{font:500 12px var(--sans)!important;color:var(--slate-soft)!important;margin-top:2px}",
      "#homeV2 .hv-casepanel{position:absolute;inset:0;z-index:6;background:var(--hbg);display:none;flex-direction:column}#homeV2 .hv-casepanel.on{display:flex;animation:cfade .2s ease}@keyframes cfade{from{opacity:0}to{opacity:1}}",
      "#homeV2 .v3-screen{position:absolute;inset:0;z-index:6;display:none;flex-direction:column;background:var(--v3-bg,#F8FAFC)}#homeV2 .v3-screen.on{display:flex;animation:cfade .2s ease}",
      /* ---- Drugs DB (db-*) v3 polish ---- */
      "body.ui-v2 #dbOverlay,body.ui-v2 .db-overlay{font-family:var(--sans)!important;background:var(--paper)!important}",
      "body.ui-v2 .db-top{background:var(--panel)!important;border-bottom:1px solid var(--line)!important}",
      "body.ui-v2 .db-title{font:800 17px/1.2 var(--sans)!important;color:var(--ink)!important;letter-spacing:-.01em}",
      "body.ui-v2 .db-close,body.ui-v2 .db-dwx{border-radius:10px!important;color:var(--slate-soft)!important;font-weight:700}",
      "body.ui-v2 .db-brandbtn{border-radius:999px!important;background:var(--teal-soft)!important;color:var(--teal)!important;border:1px solid var(--teal-soft)!important;font:700 13px var(--sans)!important;padding:8px 14px!important}",
      "body.ui-v2 .db-search{border-radius:12px!important;border:1px solid var(--line)!important;background:var(--panel)!important;color:var(--ink)!important;font:500 14px var(--sans)!important;padding:12px 14px!important}",
      "body.ui-v2 .db-comp{width:100%;text-align:left;border-radius:14px!important;border:1px solid var(--line)!important;background:var(--panel)!important;padding:14px 16px!important;margin-bottom:10px!important;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:transform .12s,box-shadow .16s,border-color .16s}",
      "body.ui-v2 .db-comp:hover{border-color:var(--teal)!important;box-shadow:0 4px 16px rgba(15,23,42,.08)}body.ui-v2 .db-comp:active{transform:scale(.99)}",
      "body.ui-v2 .db-comp-name{font:700 15px/1.3 var(--sans)!important;color:var(--ink)!important}body.ui-v2 .db-comp-sub{font:500 12.5px var(--sans)!important;color:var(--slate-soft)!important;margin-top:3px}",
      "body.ui-v2 .db-gen{font:800 22px/1.2 var(--sans)!important;color:var(--ink)!important;letter-spacing:-.01em}",
      "body.ui-v2 .db-chip{border-radius:999px!important;background:var(--teal-soft)!important;color:var(--teal)!important;font:700 11.5px var(--sans)!important;padding:5px 11px!important}",
      "body.ui-v2 .db-drawer{background:var(--panel)!important;border-left:1px solid var(--line)!important;border-radius:18px 0 0 18px!important}",
      "body.ui-v2 .db-brand{border-radius:14px!important;border:1px solid var(--line)!important;background:var(--panel)!important;padding:13px 14px!important;margin-bottom:10px!important;box-shadow:0 1px 2px rgba(15,23,42,.04)}",
      "body.ui-v2 .db-brand-name{font:700 14.5px var(--sans)!important;color:var(--ink)!important}body.ui-v2 .db-brand-mfr{font:500 12px var(--sans)!important;color:var(--slate-soft)!important}body.ui-v2 .db-brand-price{font:800 15px var(--sans)!important;color:var(--teal)!important}",
      "body.ui-v2 .db-tier,body.ui-v2 .db-sort{border-radius:999px!important;border:1px solid var(--line)!important;font:600 12px var(--sans)!important;padding:6px 12px!important}body.ui-v2 .db-tier.on,body.ui-v2 .db-sort.on{background:var(--teal)!important;color:#fff!important;border-color:var(--teal)!important}",
      /* ---- Calculators (mc-*) v3 polish ---- */
      "body.ui-v2 #mcOverlay,body.ui-v2 .mc-overlay{font-family:var(--sans)!important;background:var(--paper)!important}",
      "body.ui-v2 .mc-top{background:var(--panel)!important;border-bottom:1px solid var(--line)!important}",
      "body.ui-v2 .mc-back{border-radius:10px!important;color:var(--teal)!important;font:700 14px var(--sans)!important}",
      "body.ui-v2 .mc-title{font:800 17px/1.2 var(--sans)!important;color:var(--ink)!important;letter-spacing:-.01em}body.ui-v2 .mc-count{background:var(--teal-soft)!important;color:var(--teal)!important;border-radius:999px!important;font:700 12px var(--sans)!important;padding:2px 9px!important}",
      "body.ui-v2 .mc-search{border-radius:12px!important;border:1px solid var(--line)!important;background:var(--panel)!important;color:var(--ink)!important;font:500 14px var(--sans)!important;padding:12px 14px!important}",
      "body.ui-v2 .mc-cat{border-radius:999px!important;border:1px solid var(--line)!important;background:var(--panel)!important;color:var(--slate)!important;font:600 12.5px var(--sans)!important;padding:7px 13px!important}body.ui-v2 .mc-cat.on{background:var(--teal)!important;color:#fff!important;border-color:var(--teal)!important}",
      "body.ui-v2 .mc-grp-h{font:700 11px var(--sans)!important;text-transform:uppercase;letter-spacing:.06em;color:var(--slate-soft)!important;margin:18px 2px 8px}",
      "body.ui-v2 .mc-card{border-radius:14px!important;border:1px solid var(--line)!important;background:var(--panel)!important;box-shadow:0 1px 2px rgba(15,23,42,.04)!important;overflow:hidden;margin-bottom:10px!important}body.ui-v2 .mc-card.open{box-shadow:0 4px 18px rgba(15,23,42,.08)!important;border-color:var(--teal)!important}",
      "body.ui-v2 .mc-card-t{font:700 14.5px var(--sans)!important;color:var(--ink)!important}body.ui-v2 .mc-card-d{font:500 12.5px var(--sans)!important;color:var(--slate-soft)!important}body.ui-v2 .mc-ic{color:var(--teal)!important}",
      "body.ui-v2 .mc-input{border-radius:10px!important;border:1px solid var(--line)!important;background:var(--panel)!important;color:var(--ink)!important;font:500 14px var(--sans)!important;padding:10px 12px!important}",
      "body.ui-v2 .mc-lbl{font:600 13px var(--sans)!important;color:var(--slate)!important}body.ui-v2 .mc-unit{color:var(--slate-soft)!important;font-weight:500}",
      "body.ui-v2 .mc-calc-btn{width:100%;border-radius:14px!important;min-height:50px!important;background:var(--teal)!important;color:#fff!important;border:none!important;font:800 15px var(--sans)!important;letter-spacing:.01em;box-shadow:0 8px 22px rgba(15,118,110,.22)!important;margin-top:6px}",
      "body.ui-v2 .mc-res-box{border-radius:14px!important;background:var(--teal-soft)!important;border:1px solid var(--teal-soft)!important;padding:16px!important}body.ui-v2 .mc-res-num{font:800 30px var(--sans)!important;color:var(--teal)!important;line-height:1}body.ui-v2 .mc-res-i{font:500 13.5px/1.6 var(--sans)!important;color:var(--ink)!important;margin-top:6px}",
      /* ---- My Cases (mcp-*) refinement ---- */
      "body.ui-v2 .mcp-case-card{padding:16px!important}body.ui-v2 .mcp-case-avatar{background:var(--teal-soft)!important;color:var(--teal)!important;border-radius:12px!important;font:800 14px var(--sans)!important}",
      "body.ui-v2 .mcp-case-label{font:700 15px var(--sans)!important;color:var(--ink)!important}",
      "body.ui-v2 .mcp-pill{border-radius:999px!important;background:var(--paper)!important;border:1px solid var(--line)!important;color:var(--slate-soft)!important;font:600 11px var(--sans)!important;padding:3px 9px!important}",
      "body.ui-v2 .mcp-view-btn{border-radius:12px!important;background:var(--teal)!important;color:#fff!important;border:none!important;font:700 13px var(--sans)!important;padding:9px 16px!important}",
      "body.ui-v2 .mcp-empty{color:var(--slate-soft)!important;font:500 14px/1.6 var(--sans)!important;text-align:center}",
      /* ---- Guidelines / References (sbref-*) refinement ---- */
      "body.ui-v2 .sbref-sec>h3,body.ui-v2 .sbref-sec h3{font:700 13px var(--sans)!important;color:var(--ink)!important;letter-spacing:-.01em}",
      "body.ui-v2 .sbref-row,body.ui-v2 .sbref-gl,body.ui-v2 .sbref-syn{border-radius:12px!important;border:1px solid var(--line)!important;background:var(--panel)!important;padding:12px 14px!important;margin-bottom:8px!important;font-family:var(--sans)!important;color:var(--ink)!important}",
      "body.ui-v2 .sbref-bar{border-radius:999px!important}",
      /* ---- Reasoning workspace (dx-*) light touch ---- */
      "body.ui-v2 .dx-overlay{font-family:var(--sans)!important}",
      "body.ui-v2 .dx-card,body.ui-v2 .dx-policy,body.ui-v2 .dx-gate-card,body.ui-v2 .dx-cmp-col{border-radius:14px!important}",
      "body.ui-v2 .dx-card{box-shadow:0 1px 2px rgba(15,23,42,.04)!important}body.ui-v2 .dx-card.open{box-shadow:0 4px 18px rgba(15,23,42,.08)!important}",
      "body.ui-v2 .dx-back,body.ui-v2 .dx-reset{border-radius:10px!important;font-family:var(--sans)!important}",
      /* ---- Dual CTA: Clinical Decision (red) + Clinical Reasoning (blue) ---- */
      "body.ui-v2 .run-btn{background:#DC2626!important;box-shadow:0 8px 22px rgba(220,38,38,.26)!important}",
      "body.ui-v2 .smd-reason-wrap{margin-top:14px;font-family:var(--sans)}",
      "body.ui-v2 .smd-or{text-align:center;font:700 11px var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--slate-soft);margin:4px 0 10px;position:relative}",
      "body.ui-v2 .smd-or::before,body.ui-v2 .smd-or::after{content:'';position:absolute;top:50%;width:38%;height:1px;background:var(--line)}body.ui-v2 .smd-or::before{left:0}body.ui-v2 .smd-or::after{right:0}",
      "body.ui-v2 .reason-btn{width:100%;display:flex;flex-direction:column;align-items:center;gap:3px;border:none;border-radius:14px;background:#1E40AF;color:#fff;padding:13px 16px;cursor:pointer;font-family:var(--sans);box-shadow:0 8px 22px rgba(30,64,175,.26);transition:transform .12s,box-shadow .16s}",
      "body.ui-v2 .reason-btn:hover{box-shadow:0 10px 28px rgba(30,64,175,.34)}body.ui-v2 .reason-btn:active{transform:scale(.99)}",
      "body.ui-v2 .reason-btn .rb-title{font-weight:800;font-size:15px;letter-spacing:.01em}body.ui-v2 .reason-btn .rb-sub{font-weight:500;font-size:11.5px;line-height:1.35;opacity:.9;text-align:center}",
      "body.ui-v2 .decision-legend{margin-top:12px;display:flex;flex-direction:column;gap:7px;padding:12px 14px;border-radius:12px;background:var(--paper);border:1px solid var(--line)}",
      "body.ui-v2 .decision-legend .dl-row{display:flex;align-items:flex-start;gap:9px;font:500 12px/1.45 var(--sans);color:var(--slate)}",
      "body.ui-v2 .decision-legend b{color:var(--ink);font-weight:700}",
      "body.ui-v2 .dl-dot{flex:0 0 auto;width:10px;height:10px;border-radius:50%;margin-top:3px}body.ui-v2 .dl-red{background:#DC2626}body.ui-v2 .dl-blue{background:#1E40AF}",
      "body.ui-v2 .smd-caseshare{display:flex;gap:8px;margin:0 0 14px;flex-wrap:wrap}",
      "body.ui-v2 .smd-caseshare button{flex:1;min-width:130px;border:1px solid var(--line)!important;background:var(--panel);color:var(--teal);font:700 13px var(--sans);padding:11px 14px;border-radius:12px;cursor:pointer}",
      "body.ui-v2 .smd-caseshare button:active{transform:scale(.99)}",
      "@media(prefers-reduced-motion:reduce){#homeV2 *{transition:none!important;animation:none!important}}"
    ].join("\n");
    document.head.appendChild(st);
  }

  function build() {
    if (root) return;
    injectCSS(); injectV3CSS();
    root = document.createElement("div"); root.id = "homeV2"; root.className = "v3";
    root.innerHTML =
      '<header class="v3-header">' +
        '<button class="v3-ic" data-act="menu" aria-label="Menu">' + svg("menu") + '</button>' +
        '<div class="v3-brand"><div class="v3-mark" style="background:none;box-shadow:none"><img src="/logo.png" alt="StewardMD" style="width:100%;height:100%;object-fit:contain"></div><div style="min-width:0"><div class="v3-brand-tt">Steward<span class="v3-md">MD</span></div><div class="v3-brand-sub">Antibiotic Stewardship</div></div></div>' +
        '<div class="v3-spacer"></div>' +
        '<button class="v3-ic" data-act="theme" aria-label="Theme">' + svg("moon") + '</button>' +
        '<button class="v3-ic v3-dotbadge" data-act="more" aria-label="Notifications">' + svg("bell") + '</button>' +
        '<button class="v3-avatar" data-act="more" aria-label="Account">G</button>' +
      '</header>' +
      '<main class="v3-main"><div class="v3-stack">' +
        '<section class="v3-card v3-hero"><div style="flex:1;min-width:0"><h1 class="v3-h-hero">Steward<span class="v3-md">MD</span></h1><span class="v3-tag">Antibiotic Decision Engine</span><p>Evidence-based antimicrobial recommendations at the point of care.</p></div><div class="v3-shield" style="background:none;box-shadow:none"><img src="/logo.png" alt="StewardMD" style="width:62px;height:62px;object-fit:contain"></div></section>' +
        '<div class="v3-qrow">' +
          '<button class="v3-qc" data-act="more">' + svg("user") + '<span>Account</span></button>' +
          '<button class="v3-qc" data-act="search">' + svg("search") + '<span>Search</span></button>' +
          '<button class="v3-qc" data-act="icu">' + svg("icu") + '<span>ICU</span></button>' +
          '<button class="v3-qc" data-act="theme">' + svg("sun") + '<span>Theme</span></button>' +
        '</div>' +
        '<button class="v3-primary" data-act="startcase"><div class="ic">' + svg("stcase") + '</div><div style="flex:1;min-width:0"><div class="tt">Start a Case</div><div class="sub">New clinical decision — choose Simple or Advanced</div></div><div class="arr">' + svg("arrow") + '</div></button>' +
        '<button class="v3-secondary" data-act="reasoning"><div class="ic">' + svg("reasoning") + '</div><div style="flex:1;min-width:0"><div class="tt">Dx My Patient <span style="color:var(--v3-primary);font-size:12px;font-weight:700">(Beta)</span></div><div class="sub">Reason through your patient — live differential, confidence &amp; next steps</div></div><div class="arr">' + svg("chev") + '</div></button>' +
        '<div class="v3-sec-label">Quick access</div>' +
        '<div class="v3-grid">' +
          '<button class="v3-tile" data-act="cases"><div class="ic">' + svg("folder") + '</div><div style="min-width:0"><div class="tt">My Cases</div><div class="sub">Saved assessments</div></div></button>' +
          '<button class="v3-tile" data-act="calculators"><div class="ic">' + svg("calc") + '</div><div style="min-width:0"><div class="tt">Calculators</div><div class="sub">70+ clinical tools</div></div></button>' +
          '<button class="v3-tile" data-act="drugs"><div class="ic">' + svg("pills") + '</div><div style="min-width:0"><div class="tt">Drugs DB</div><div class="sub">Brands · doses · price</div></div></button>' +
          '<button class="v3-tile" data-act="electrolytes"><div class="ic">' + svg("flask") + '</div><div style="min-width:0"><div class="tt">Electrolyte Engine</div><div class="sub">ICU correction · doses · rates</div></div></button>' +
        '</div>' +
        '<div class="v3-foot">For qualified clinicians · <b>AI-summarised, verify doses</b></div>' +
        '<div class="v3-devfoot">' +
          '<div class="v3-devlabel">DEVELOPED BY</div>' +
          '<img id="v3DevLogo" class="v3-devlogo" alt="MaiKnowledge" />' +
          '<div class="v3-devname">MaiKnowledge</div>' +
          '<div class="v3-devmeta">© 2026 StewardMD · Developed by MaiKnowledge · Dr. Manoj Kumar Kurmana, MD</div>' +
          '<div class="v3-devmeta">An educational clinical reasoning aid · Not a substitute for clinical judgment</div>' +
        '</div>' +
      '</div></main>' +
      '<nav class="v3-tabbar">' +
        '<button class="v3-tab" data-act="search">' + svg("search") + '<span>Search</span></button>' +
        '<button class="v3-tab" data-act="cases">' + svg("folder") + '<span>Cases</span></button>' +
        '<button class="v3-tab" data-act="guidelines">' + svg("book") + '<span>Guides</span></button>' +
        '<button class="v3-tab" data-act="askai">' + svg("ai") + '<span>Ask AI</span></button>' +
        '<button class="v3-tab" data-act="more">' + svg("more") + '<span>More</span></button>' +
      '</nav>';
    document.body.appendChild(root);

    try {
      var _dl = document.querySelector(".dev-studio-logo,.about-dev-logo");
      var _fl = root.querySelector("#v3DevLogo");
      if (_dl && _fl && _dl.src) _fl.src = _dl.src;
      else if (_fl) _fl.src = "/logo.png";
    } catch (e) {}

    var scrim = document.getElementById("hvScrim");
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "hv-scrim"; scrim.id = "hvScrim"; document.body.appendChild(scrim); scrim.addEventListener("click", closeSheet); }
    if (!document.getElementById("hvSheet")) { var sheet = document.createElement("div"); sheet.className = "hv-sheet"; sheet.id = "hvSheet"; document.body.appendChild(sheet); }
    fab = document.createElement("button"); fab.className = "hv-fab"; fab.id = "hvFab"; fab.setAttribute("aria-label", "StewardMD home");
    // Home FAB = house outline with the StewardMD logo mark inside it.
    fab.innerHTML = '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><path d="M4 23 L24 6 L44 23 M9 22 V43 H39 V22" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><image href="/logo.png" xlink:href="/logo.png" x="15" y="26.5" width="18" height="13.5" preserveAspectRatio="xMidYMid meet"/></svg>';
    fab.style.display = "none"; // hidden until past the splash/disclaimer/login gates
    document.body.appendChild(fab);
    fab.addEventListener("click", goHome);
    // Only show the home button once the user is on the landing page / inside the app —
    // never on the intro splash, disclaimer, or login gates.
    function refreshFab() {
      if (!fab) return;
      var gateUp = ["introPoster", "splash", "accountGate", "disclaimerModal"].some(function (id) {
        var el = document.getElementById(id); if (!el) return false;
        // A gate counts as "up" only if genuinely visible — these gates fade out via
        // opacity/visibility but stay display:flex (width>0), so offsetWidth alone would
        // keep the home button hidden forever once the gate is dismissed.
        var cs = window.getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.01;
      });
      var want = gateUp ? "none" : "flex";
      if (fab.style.display !== want) fab.style.display = want;
    }
    refreshFab();
    setInterval(refreshFab, 400);

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "more") return openMore();
      if (a === "home") { window.scrollTo(0, 0); var m = root.querySelector(".v3-main"); if (m) m.scrollTo({ top: 0, behavior: "smooth" }); return; }
      if (ACT[a]) ACT[a]();
    });
  }

  // ---- More sheet ----
  function sheetEl() {
    var s = document.getElementById("hvSheet");
    if (!s) {
      var scrim = document.getElementById("hvScrim");
      if (!scrim) { scrim = document.createElement("div"); scrim.className = "hv-scrim"; scrim.id = "hvScrim"; document.body.appendChild(scrim); scrim.addEventListener("click", closeSheet); }
      s = document.createElement("div"); s.className = "hv-sheet"; s.id = "hvSheet"; document.body.appendChild(s);
      try { injectCSS(); } catch (e) {}
    }
    return s;
  }
  function openSheet(html) { var s = sheetEl(); s.innerHTML = '<div class="hv-sheet-wrap"><div class="hv-grab"></div>' + html + '</div>'; document.getElementById("hvScrim").classList.add("on"); s.classList.add("on"); }
  function closeSheet() { var s = sheetEl(); s.classList.remove("on"); document.getElementById("hvScrim").classList.remove("on"); }
  function mi(icon, label, cap, act) { return '<button class="hv-mi" data-mi="' + act + '">' + svg(icon) + '<div class="ml">' + label + (cap ? '<div class="mc">' + cap + '</div>' : '') + '</div><span class="marr">' + svg("chev") + '</span></button>'; }
  function openMore() {
    openSheet(
      '<div class="hv-sh-t">More</div>' +
      '<div class="hv-d-sec"><h4>Interface</h4><div class="hv-seg" id="hvUi" style="grid-template-columns:1fr 1fr">' +
        '<button data-ui="v2" class="on">Advanced UI<br><span style="font-weight:600;opacity:.85;font-size:10px">by MaiK</span></button>' +
        '<button data-ui="classic">Classic UI<br><span style="font-weight:600;opacity:.85;font-size:10px">previous</span></button>' +
      '</div></div>' +
      mi("info", "About StewardMD", "Version, credits, disclaimer", "about") +
      mi("search", "Open shared case", "Retrieve by case code", "opencase") +
      mi("award", "Acknowledgements", "Contributors &amp; credits", "ack") +
      mi("user", "Account &amp; sign-in", "Google sign-in, guest session", "account") +
      mi("spark", "Subscription", "Plans &amp; billing", "subscription") +
      mi("settings", "Display &amp; Accessibility", "Font size, density, auto-fit", "display") +
      mi("book", "Guidelines &amp; References", "IDSA · WHO · ICMR", "guidelines") +
      mi("calc", "Calculators", "50+ clinical tools", "calculators")
    );
    var s = sheetEl();
    s.querySelectorAll("[data-ui]").forEach(function (b) {
      b.addEventListener("click", function () { if (window.SMD_setUI) SMD_setUI(b.getAttribute("data-ui") === "v2"); });
    });
    s.querySelectorAll("[data-mi]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-mi");
        if (a === "display") return openDisplay();
        if (a === "account") return openAccount();
        if (a === "subscription") return openSubscription();
        if (a === "ack") { closeSheet(); return openAck(); }
        if (a === "opencase") { closeSheet(); if (window.CASESHARE && CASESHARE.openPrompt) return CASESHARE.openPrompt(); return toast("Loading…"); }
        closeSheet();
        if (ACT[a]) ACT[a]();
      });
    });
  }
  function openAccount() {
    var a = readAccount();
    var body;
    if (a && a.email) {
      var initial = (((a.name || a.email).trim()[0]) || "U").toUpperCase();
      var pic = a.picture
        ? '<img class="hv-acct-pic" src="' + smdEsc(a.picture) + '" referrerpolicy="no-referrer" alt="" onerror="this.outerHTML=\'<div class=&quot;hv-acct-pic hv-acct-ph&quot;>' + smdEsc(initial) + '</div>\'">'
        : '<div class="hv-acct-pic hv-acct-ph">' + smdEsc(initial) + '</div>';
      body = '<div class="hv-acct">' + pic +
        '<div class="hv-acct-name">' + smdEsc(a.name || "Signed in") + '</div>' +
        '<div class="hv-acct-email">' + smdEsc(a.email) + '</div>' +
        '<div class="hv-acct-badge">' + (a.type === "google" ? "Google · cloud sync on" : "Signed in") + '</div>' +
        '<button class="hv-acct-btn out" data-acct="signout" type="button">Sign out</button></div>';
    } else {
      body = '<div class="hv-acct">' +
        '<div class="hv-acct-pic hv-acct-ph">?</div>' +
        '<div class="hv-acct-name">Not signed in</div>' +
        '<div class="hv-acct-email">Guest mode — cases stay on this device only</div>' +
        '<button class="hv-acct-btn" data-acct="signin" type="button">Sign in with Google</button>' +
        '<div class="hv-acct-note">Sign in to sync your cases across devices and share them by code.</div></div>';
    }
    openSheet('<div class="hv-sh-t">Account &amp; sign-in</div>' + body);
    var s = sheetEl();
    var so = s.querySelector('[data-acct="signout"]');
    if (so) so.addEventListener("click", function () { var b = document.getElementById("sessionSignOut"); if (b) b.click(); setTimeout(openAccount, 150); });
    var si = s.querySelector('[data-acct="signin"]');
    if (si) si.addEventListener("click", function () { try { if (window.SMD_signInWithGoogle) window.SMD_signInWithGoogle(); } catch (_) {} setTimeout(openAccount, 900); });
  }
  // ---- About modal: add Version History + Facts tabs (run once) ----
  function aboutVersionHTML() {
    return '<div class="smd-vh">' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v0 · Genesis</div><ul>' +
        '<li><b>v0.1</b> — First static prototype mapping a clinical syndrome to an empiric antibiotic.</li>' +
        '<li><b>v0.5</b> — The 8-question antimicrobial-stewardship framework defined as the core engine.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v1 · Clinical engine</div><ul>' +
        '<li><b>v1.0</b> — Structured clinical-findings wizard (vitals, system, risk factors).</li>' +
        '<li><b>v1.1</b> — Added syndrome confidence scoring and a ranked differential.</li>' +
        '<li><b>v1.2</b> — Tested on real cases; scoring edge-case bugs detected and fixed.</li>' +
        '<li><b>v1.5</b> — Grew to dozens of internal-medicine syndromes.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v2 · Knowledge base</div><ul>' +
        '<li><b>v2.0</b> — Drug monograph database: dosing, route, spectrum, cautions.</li>' +
        '<li><b>v2.1</b> — &quot;Gold format&quot; rewrite of every drug entry for consistency.</li>' +
        '<li><b>v2.3</b> — IDSA / WHO / ICMR / Surviving Sepsis references wired throughout.</li>' +
        '<li><b>v2.6</b> — Bug sweep: dosing display &amp; renal-adjustment corrections.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v3 · Ground-up interface</div><ul>' +
        '<li><b>v3.0</b> — Complete frontend rebuild — the &quot;Advanced UI by MaiK&quot;.</li>' +
        '<li><b>v3.2</b> — Responsive layout for mobile / tablet / desktop, plus dark mode.</li>' +
        '<li><b>v3.4</b> — Accessibility: font scaling, density control, auto-fit.</li>' +
        '<li><b>v3.7</b> — Testing round: iOS viewport/zoom bugs detected and fixed.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v4 · Intelligence</div><ul>' +
        '<li><b>v4.0</b> — Clinical reasoning engine producing an explainable differential.</li>' +
        '<li><b>v4.2</b> — Electrolyte engine: 13 analysis engines (Na, K, Mg, Ca, Cl, anion gap…).</li>' +
        '<li><b>v4.4</b> — Medical calculators expanded to 74 bedside tools.</li>' +
        '<li><b>v4.6</b> — Bug detected: reasoning &quot;select diagnosis&quot; mis-routed → fixed.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v5 · Connected &amp; polished</div><ul>' +
        '<li><b>v5.0</b> — Google sign-in and cloud sync of saved cases.</li>' +
        '<li><b>v5.1</b> — Share a case by unique code; the My Cases library.</li>' +
        '<li><b>v5.2</b> — Account panel and guest mode.</li>' +
        '<li><b>v5.3</b> — Universal home button; electrolyte overlay click-block fixed; mobile header cleaned up.</li>' +
        '<li><b>v5.4</b> — Automated headless-browser regression testing introduced.</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver"><span class="smd-vh-now">v6 · Medical Knowledge Base (current)</span></div><ul>' +
        '<li><b>v6.0</b> — Every disease migrated into a single declarative Medical Knowledge Base; the reasoning engine now runs entirely from the KB — regression-locked and byte-identical to the trusted engine.</li>' +
        '<li><b>v6.1</b> — Harrison&#39;s Principles of Internal Medicine (22e) knowledge integrated into all 140 diagnostic diseases: clinical pearls, pathophysiology, mimics, red flags, prognosis, pitfalls — paraphrased and page-cited.</li>' +
        '<li><b>v6.2</b> — Knowledge base expanded to the full Harrison disease universe — <b>444 searchable entries</b> (140 diagnostic + 304 reference, including clinically-useful diagnostic &amp; procedural chapters), each with a page-cited Harrison reference panel.</li>' +
        '<li><b>v6.3</b> — Reasoning upgrades: the stewardship engine now covers all 140 diagnoses, smart next-question suggestions, and broader non-infective finding inputs.</li>' +
        '<li><b>v6.4</b> — AI-ready infrastructure (RAG-ready knowledge index, evidence engine, AI interface) — fully functional with no AI today, and Gemini-ready (decision-first, explanation second).</li>' +
      '</ul></div>' +
    '</div>' +
    '<p style="font-size:11.5px;color:var(--slate-soft);margin-top:6px">The development journey of StewardMD — built and refined case by case at the bedside.</p>';
  }
  function aboutFactsHTML() {
    return '<span class="smd-ab-badge">By the numbers</span>' +
      '<ul class="smd-facts">' +
      '<li><span class="fn">444</span> searchable entries — 140 with full diagnostic reasoning + 304 Harrison reference conditions &amp; clinical chapters.</li>' +
      '<li><span class="fn">51</span> infective syndromes, each with a full empiric-therapy stewardship rationale.</li>' +
      '<li><span class="fn">21,487</span> page-cited Harrison 22e knowledge chunks — RAG-ready, no AI required.</li>' +
      '<li><span class="fn">1,465</span> drug monographs in structured &quot;gold&quot; format.</li>' +
      '<li><span class="fn">74</span> bedside clinical calculators.</li>' +
      '<li><span class="fn">13</span> dedicated electrolyte analysis engines.</li>' +
      '<li><span class="fn">~1.4&nbsp;MB</span> of hand-written clinical logic — no frameworks, no build step.</li>' +
      '<li><span class="fn">100%</span> offline-capable PWA — works with no signal at the bedside.</li>' +
      '<li><span class="fn">8</span> stewardship questions answered for <i>every</i> recommendation.</li>' +
      '<li><span class="fn">1</span> clinician built the entire engine end to end.</li>' +
      '</ul>' +
      '<div class="smd-modal-section" style="margin-top:18px">What makes it unique</div>' +
      '<p>StewardMD is one of the most content-dense clinical decision tools ever shipped as a single, buildless static web app — every syndrome, drug, calculator and reasoning rule is hand-authored, runs entirely in the browser, and works fully offline. Unlike a black-box AI, every antibiotic recommendation is <b>explainable</b>: it states why the diagnosis fits, why antibiotics are (or are not) needed, the likely pathogens, why each agent was chosen, what it covers, what it misses, and when to de-escalate or stop.</p>' +
      '<p style="font-size:11.5px;color:var(--slate-soft)">Engineered and curated by Dr. Manoj Kumar Kurmana, MD — Internal Medicine physician and Stanford-certified antimicrobial-stewardship practitioner.</p>';
  }
  function enhanceAbout() {
    var modal = document.getElementById("aboutModal"); if (!modal) return;
    var body = modal.querySelector(".smd-modal-body"); if (!body || body.querySelector(".smd-ab-tabs")) return;
    var aboutPanel = document.createElement("div"); aboutPanel.className = "smd-ab-panel"; aboutPanel.setAttribute("data-tab", "about");
    while (body.firstChild) aboutPanel.appendChild(body.firstChild); // move existing About content into its panel
    var nav = document.createElement("div"); nav.className = "smd-ab-tabs";
    nav.innerHTML = '<button class="smd-ab-tab on" data-t="about" type="button">About</button>' +
      '<button class="smd-ab-tab" data-t="version" type="button">Version history</button>' +
      '<button class="smd-ab-tab" data-t="facts" type="button">Facts &amp; milestones</button>';
    var vPanel = document.createElement("div"); vPanel.className = "smd-ab-panel"; vPanel.setAttribute("data-tab", "version"); vPanel.style.display = "none"; vPanel.innerHTML = aboutVersionHTML();
    var fPanel = document.createElement("div"); fPanel.className = "smd-ab-panel"; fPanel.setAttribute("data-tab", "facts"); fPanel.style.display = "none"; fPanel.innerHTML = aboutFactsHTML();
    body.appendChild(nav); body.appendChild(aboutPanel); body.appendChild(vPanel); body.appendChild(fPanel);
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-t]"); if (!b) return;
      var t = b.getAttribute("data-t");
      nav.querySelectorAll(".smd-ab-tab").forEach(function (x) { x.classList.toggle("on", x === b); });
      body.querySelectorAll(".smd-ab-panel").forEach(function (pn) { pn.style.display = (pn.getAttribute("data-tab") === t) ? "" : "none"; });
      body.scrollTop = 0;
    });
  }
  function openAck() {
    var src = document.getElementById("ackCard");
    var inner = "";
    if (src) {
      var c = src.cloneNode(true);
      c.removeAttribute("id");
      var hdr = c.querySelector(".ack-header-row"); if (hdr) hdr.parentNode.removeChild(hdr);
      inner = '<div class="hv-ack">' + c.innerHTML + '</div>';
    } else {
      inner = '<div class="hv-ack" style="text-align:center;color:var(--hmut);font:500 13px/1.6 var(--hfont)">' +
        '<p><b>Concept, content &amp; development</b><br>Dr. Manoj Kumar Kurmana, MD</p>' +
        '<p>Developed by MaiKnowledge.</p></div>';
    }
    openSheet('<div class="hv-sh-t">Acknowledgements</div>' + inner +
      '<button class="hv-reset" style="margin-top:14px" data-close="1">Close</button>');
    var s = sheetEl();
    var cl = s.querySelector("[data-close]");
    if (cl) cl.addEventListener("click", closeSheet);
  }
  function openSubscription() {
    openSheet('<div class="hv-sh-t">Subscription</div>' +
      '<div style="text-align:center;padding:6px 4px 2px">' +
        '<div style="font:800 30px/1 var(--hfont);color:var(--hp)"><span style="text-decoration:line-through;color:var(--hmut);font-size:19px;font-weight:700">₹999 / year</span>&nbsp;&nbsp;Free</div>' +
        '<div style="font:600 13px var(--hfont);color:var(--hmut);margin-top:7px">Free for all doctors for now — full access while we test.</div>' +
      '</div>' +
      '<div style="margin-top:14px;border:1px solid var(--hbd);border-radius:14px;padding:14px;background:var(--hbg)">' +
        '<div style="font:700 12px var(--hfont);text-transform:uppercase;letter-spacing:.05em;color:var(--hmut);margin-bottom:8px">Included</div>' +
        '<div style="font:500 13px/1.9 var(--hfont);color:var(--hink)">✓ Full antibiotic decision engine<br>✓ 1,465-drug database — doses &amp; brands<br>✓ 50+ calculators · guidelines · ICU tools<br>✓ Clinical Reasoning (beta)</div>' +
      '</div>' +
      '<button class="hv-reset" style="background:var(--hp);color:#fff;border-color:var(--hp);margin-top:14px" data-close="1">Continue — it\'s free</button>');
    var subClose = sheetEl().querySelector("[data-close]");
    if (subClose) subClose.addEventListener("click", closeSheet);
  }
  function openDxChooser() {
    openSheet('<div class="hv-sh-t">Dx My Patient</div>' +
      '<p style="font:500 13px/1.5 var(--hfont);color:var(--hmut);text-align:center;margin:0 0 16px">Reason through a patient — live differential, confidence &amp; next steps.</p>' +
      '<button id="dxAddNew" style="width:100%;background:var(--hp);color:#fff;border:none;border-radius:12px;padding:14px;font:800 15px var(--hfont);cursor:pointer;margin-bottom:10px;text-align:center">➕ Add New Patient<div style="font:500 11.5px var(--hfont);opacity:.9;margin-top:2px">Enter symptoms &amp; findings manually</div></button>' +
      '<button id="dxImportPt" style="width:100%;background:var(--hpanel);color:var(--hink);border:1px solid var(--hbd);border-radius:12px;padding:14px;font:800 15px var(--hfont);cursor:pointer;margin-bottom:10px;text-align:center">🏥 Import Patient<div style="font:500 11.5px var(--hfont);color:var(--hmut);margin-top:2px">Pull labs · imaging · culture from Ward Sync, then add symptoms</div></button>' +
      '<button class="hv-back" data-close="1">Close</button>');
    var s = sheetEl();
    var addN = s.querySelector("#dxAddNew");
    if (addN) addN.addEventListener("click", function () { closeSheet(); hideV2(); try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); else toast("Clinical reasoning is loading…"); } catch (e) {} });
    var imp = s.querySelector("#dxImportPt");
    if (imp) imp.addEventListener("click", function () { closeSheet(); hideV2(); try { if (window.GHIS && GHIS.startImport) GHIS.startImport(); else toast("Ward Sync is loading — try again in a moment."); } catch (e) {} });
    var c = s.querySelector("[data-close]");
    if (c) c.addEventListener("click", closeSheet);
  }

  // Ask MaiK — a dedicated chat. RAG-FIRST: each question retrieves only the top-K
  // StewardMD knowledge-base chunks and sends just those + the question to the model
  // (the whole KB never transits), so answers stay grounded AND cheap on tokens.
  // ── Ask MaiK — mobile consult sheet (gold122) ────────────────────────────
  // Dedicated bottom sheet: sticky header + sticky composer, only the message area
  // scrolls, ≤90vh, iOS safe-areas, all other FABs hidden while open. No provider/
  // model names anywhere; a single persistent advisory badge replaces per-message
  // disclaimers; answers render as safe Markdown with human-readable Sources ▸.
  var _maikHist = [];
  function maikEscH(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function maikCSS() {
    if (document.getElementById("maik-sheet-css")) return;
    var st = document.createElement("style"); st.id = "maik-sheet-css";
    st.textContent = [
      "#maikScrim{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:16000;opacity:0;transition:opacity .2s}#maikScrim.on{opacity:1}",
      "#maikSheet{position:fixed;left:0;right:0;bottom:0;z-index:16001;background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:18px 18px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;max-height:90vh;height:90vh;transform:translateY(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);font-family:var(--hfont,system-ui)}",
      "#maikSheet.on{transform:translateY(0)}",
      ".maik-hd{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:13px 14px 6px}",
      ".maik-hd .mk-ti{flex:1 1 auto;min-width:0}",
      ".maik-hd .mk-t{font:800 17px var(--hfont);color:var(--hink);line-height:1.1}.maik-hd .mk-s{font:600 12px var(--hfont);color:var(--hmut,#64748b);margin-top:2px}",
      ".maik-hd .mk-logo{height:26px;width:auto;flex:0 0 auto;display:block}",
      ".maik-adv{flex:0 0 auto;padding:0 16px 10px;border-bottom:1px solid var(--hbd,#e2e8f0)}",
      ".maik-badge{display:inline-block;font:700 10.5px var(--hfont);color:var(--hp,#0f766e);background:var(--hps,#ccfbf1);border-radius:999px;padding:5px 11px;white-space:nowrap;letter-spacing:.01em}",
      ".maik-x{margin-left:auto;flex:0 0 auto;width:34px;height:34px;border:none;background:var(--hbg,#f1f5f9);color:var(--hink);border-radius:50%;font-size:17px;cursor:pointer;line-height:1}",
      ".maik-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 16px;display:flex;flex-direction:column;gap:10px}",
      ".maik-cmp{flex:0 0 auto;display:flex;gap:8px;align-items:flex-end;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid var(--hbd,#e2e8f0);background:var(--hpanel,#fff)}",
      ".maik-cmp textarea{flex:1 1 auto;min-width:0;resize:none;max-height:120px;background:var(--hbg,#f8fafc);border:1px solid var(--hbd,#e2e8f0);border-radius:12px;color:var(--hink);font:500 15px var(--hfont);padding:10px 12px;box-sizing:border-box}",
      ".maik-cmp button{flex:0 0 auto;background:var(--hp,#0f766e);color:#fff;border:none;border-radius:12px;padding:0 16px;height:44px;font:800 14px var(--hfont);cursor:pointer}",
      ".maik-b{max-width:90%;padding:10px 13px;border-radius:14px;font:500 14px/1.55 var(--hfont);word-break:break-word}",
      ".maik-b.you{align-self:flex-end;background:var(--hp,#0f766e);color:#fff}",
      ".maik-b.ai{align-self:flex-start;background:var(--hbg,#f8fafc);border:1px solid var(--hbd,#e2e8f0);color:var(--hink)}",
      ".maik-b .maik-h{font:800 13.5px var(--hfont);margin:8px 0 3px;color:var(--hp,#0f766e)}.maik-b .maik-h:first-child{margin-top:0}",
      ".maik-b p{margin:4px 0}.maik-b ul,.maik-b ol{margin:4px 0;padding-left:20px}.maik-b li{margin:2px 0}.maik-b code{background:rgba(100,116,139,.15);border-radius:4px;padding:0 4px;font-size:12.5px}",
      ".maik-edu{font:600 11px var(--hfont);color:var(--hmut);background:rgba(100,116,139,.1);border-radius:8px;padding:5px 8px;margin-bottom:6px}",
      ".maik-src{margin-top:8px;font:600 11.5px var(--hfont);color:var(--hmut)}.maik-src summary{cursor:pointer;color:var(--hp,#0f766e)}.maik-src ul{margin:4px 0 0;padding-left:18px}",
      ".maik-more{background:none;border:none;color:var(--hp,#0f766e);font:700 12px var(--hfont);cursor:pointer;padding:4px 0}",
      ".maik-chips{display:flex;flex-wrap:wrap;gap:8px}.maik-chip{background:var(--hpanel,#fff);border:1px solid var(--hbd,#e2e8f0);border-radius:999px;padding:9px 13px;font:600 13px var(--hfont);color:var(--hink);cursor:pointer}",
      ".maik-welcome{font:500 14px/1.6 var(--hfont);color:var(--hink)}",
      "body.maik-open #hvFab,body.maik-open #infFab,body.maik-open #dxLaunch,body.maik-open .inf-fab,body.maik-open .ghis-ward-fab{display:none!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }
  function maikActiveCase() { try { return !!(window.DX && DX._state && Object.keys(DX._state.f || {}).length >= 1); } catch (e) { return false; } }
  function openAskAi() {
    maikCSS();
    var old = document.getElementById("maikSheet"); if (old) old.remove();
    var oldS = document.getElementById("maikScrim"); if (oldS) oldS.remove();
    var scrim = document.createElement("div"); scrim.id = "maikScrim"; document.body.appendChild(scrim);
    var sheet = document.createElement("div"); sheet.id = "maikSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Ask MaiK");
    sheet.innerHTML =
      '<div class="maik-hd"><img class="mk-logo" src="/maik-logo.webp" alt="MaiK" /><div class="mk-ti"><div class="mk-s">Medical AI Knowledge · Powered by Google AI</div></div>' +
        '<button class="maik-x" id="maikX" aria-label="Close">✕</button></div>' +
      '<div class="maik-adv"><span class="maik-badge">✓ Advisory — clinician verifies</span></div>' +
      '<div class="maik-body" id="maikBody"></div>' +
      '<div class="maik-cmp"><textarea id="maikQ" rows="1" placeholder="Ask a clinical question…"></textarea><button id="maikSend">Send</button></div>';
    document.body.appendChild(sheet);
    document.body.classList.add("maik-open");
    requestAnimationFrame(function () { scrim.classList.add("on"); sheet.classList.add("on"); });
    var body = sheet.querySelector("#maikBody"), qEl = sheet.querySelector("#maikQ"), sendBtn = sheet.querySelector("#maikSend");
    function close() { sheet.classList.remove("on"); scrim.classList.remove("on"); document.body.classList.remove("maik-open"); setTimeout(function () { sheet.remove(); scrim.remove(); }, 260); }
    function scroll() { body.scrollTop = body.scrollHeight; }
    function bubble(who, html) { var d = document.createElement("div"); d.className = "maik-b " + (who === "you" ? "you" : "ai"); d.innerHTML = html; body.appendChild(d); scroll(); return d; }
    function chips(list) {
      var w = document.createElement("div"); w.className = "maik-chips";
      list.forEach(function (c) { var b = document.createElement("button"); b.className = "maik-chip"; b.textContent = c.label; b.addEventListener("click", c.on); w.appendChild(b); });
      body.appendChild(w); scroll();
    }
    function emptyState() {
      bubble("ai", '<div class="maik-welcome">Hello — I’m <b>MaiK</b>, your clinical knowledge assistant. Ask a general clinical question and I’ll answer from StewardMD’s knowledge base, or start a patient assessment.</div>');
      if (maikActiveCase()) chips([
        { label: "What findings are missing?", on: function () { qEl.value = "What findings are missing for the current differential?"; send(); } },
        { label: "Explain this differential", on: function () { qEl.value = "Explain the leading diagnosis in the current assessment."; send(); } },
        { label: "What investigations next?", on: function () { qEl.value = "What investigations should I order next?"; send(); } },
        { label: "Culture-directed options", on: function () { qEl.value = "What are the culture-directed antibiotic options?"; send(); } }
      ]);
      else chips([
        { label: "Start a clinical assessment", on: function () { close(); try { openDxChooser(); } catch (e) {} } },
        { label: "Ask a general knowledge question", on: function () { qEl.value = "How to treat organophosphate poisoning?"; try { qEl.focus(); } catch (e) {} } },
        { label: "Open Drug Index", on: function () { close(); var b = document.querySelector('#homeV2 [data-act="drugs"]'); if (b) b.click(); else toast("Open Drugs from the home screen."); } },
        { label: "Open calculator", on: function () { close(); var b = document.querySelector('#homeV2 [data-act="calculators"]'); if (b) b.click(); else toast("Open Calculators from the home screen."); } }
      ]);
    }
    // patient-specific (individualized) request with NO active case → redirect, don't answer
    function isPatientSpecific(q) { return /\b(my patient|this patient|the patient|my case|this case|should i (give|start|prescribe|treat)|what.?s wrong with|dose for (my|this)|diagnos(e|is) (my|this))\b/i.test(q); }
    function isGreeting(q) { return q.length <= 24 && /^(hi|hey|hello|yo|thanks|thank you|thx|ok|okay|cool|good (morning|afternoon|evening)|namaste)\b/i.test(q); }
    function send() {
      var q = (qEl.value || "").trim(); if (!q) return; qEl.value = "";
      _maikHist.push({ q: q }); bubble("you", maikEscH(q));
      var active = maikActiveCase();
      if (isGreeting(q) && !active) { bubble("ai", '<div class="maik-welcome">Hi! Ask me a clinical knowledge question (e.g. “how to treat DKA?”), or start a patient assessment.</div>'); return; }
      if (isPatientSpecific(q) && !active) {
        var d = bubble("ai", 'For advice about a specific patient, use <b>Dx My Patient</b> / <b>Clinical Reasoning</b> so StewardMD’s engine computes the assessment first — MaiK then adds commentary on it.');
        var b = document.createElement("button"); b.className = "maik-chip"; b.style.marginTop = "8px"; b.textContent = "Open Dx My Patient";
        b.addEventListener("click", function () { close(); try { openDxChooser(); } catch (e) {} }); d.appendChild(b); scroll(); return;
      }
      var think = bubble("ai", "✨ Searching StewardMD knowledge…");
      Promise.resolve()
        .then(function () { try { if (window.SMD_AI && SMD_AI.setFlag) SMD_AI.setFlag(true); } catch (e) {} return window.StewardRAG ? StewardRAG.ready() : Promise.reject(new Error("knowledge base loading")); })
        .then(function () { var findings = active ? DX._state.f : {}; return StewardRAG.buildPackage(window.SMD_REASON.assess(findings), { question: q }); })
        .then(function (pkg) {
          return window.SMD_AI.explainGrounded(pkg).then(function (r) {
            if (r && r.error) { think.innerHTML = r.error === "ai-off" ? "MaiK is currently off — enable it in Settings › AI Assistant." : maikEscH("MaiK is unavailable right now. " + (r.error || "")); return; }
            var md = (r && r.text) ? String(r.text) : "No response.";
            var rendered = (window.SMD_MaiK && SMD_MaiK.renderMarkdown) ? SMD_MaiK.renderMarkdown(md) : maikEscH(md);
            var titles = (window.SMD_MaiK && SMD_MaiK.sourceTitles) ? SMD_MaiK.sourceTitles(pkg.retrieved || []) : [];
            var srcHTML = titles.length ? '<details class="maik-src"><summary>Sources ▸</summary><ul>' + titles.map(function (t) { return "<li>" + maikEscH(t) + "</li>"; }).join("") + '</ul></details>' : "";
            var eduHTML = active ? "" : '<div class="maik-edu">Educational clinical reference — verify with local protocol.</div>';
            var full = eduHTML + rendered + srcHTML;
            // long answers: collapse behind "Show more"
            if (md.length > 700) {
              think.innerHTML = eduHTML + '<div class="maik-collapsed">' + rendered + '</div>' + srcHTML;
              var cd = think.querySelector(".maik-collapsed"); cd.style.maxHeight = "220px"; cd.style.overflow = "hidden";
              var mb = document.createElement("button"); mb.className = "maik-more"; mb.textContent = "Show more ▾";
              mb.addEventListener("click", function () { var open = cd.style.maxHeight === "none"; cd.style.maxHeight = open ? "220px" : "none"; mb.textContent = open ? "Show more ▾" : "Show less ▴"; });
              think.insertBefore(mb, think.querySelector(".maik-src") || null);
            } else { think.innerHTML = full; }
            scroll();
          });
        })
        .catch(function (e) { think.innerHTML = maikEscH("MaiK unavailable: " + (e && e.message || e)); });
    }
    // restore prior session history, else empty state
    if (_maikHist.length) { _maikHist.forEach(function (m) { bubble("you", maikEscH(m.q)); }); } else { emptyState(); }
    sheet.querySelector("#maikX").addEventListener("click", close);
    scrim.addEventListener("click", close);
    sendBtn.addEventListener("click", send);
    qEl.addEventListener("input", function () { qEl.style.height = "auto"; qEl.style.height = Math.min(120, qEl.scrollHeight) + "px"; });
    qEl.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } });
    setTimeout(function () { try { qEl.focus(); } catch (e) {} }, 300);
  }

  // ---- Display & Accessibility engine ----
  var DKEY = "smd_display_v1", DENS = { compact: 0.86, default: 1, comfortable: 1.18, large: 1.4 }, DDEF = { fontScale: 1, density: "default", autoFit: false };
  var ds = loadD();
  function loadD() { try { var o = JSON.parse(localStorage.getItem(DKEY)); if (o && o.density in DENS) return { fontScale: Math.min(1.5, Math.max(.8, +o.fontScale || 1)), density: o.density, autoFit: !!o.autoFit }; } catch (e) {} return Object.assign({}, DDEF); }
  function saveD() { try { localStorage.setItem(DKEY, JSON.stringify(ds)); } catch (e) {} }
  function applyD() {
    try { document.documentElement.style.zoom = ds.fontScale; } catch (e) {}
    document.body.classList.remove("smd-dens-compact", "smd-dens-comfortable", "smd-dens-large");
    if (ds.density !== "default") document.body.classList.add("smd-dens-" + ds.density);
    saveD();
  }
  function autoFitD() {
    var w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1, fs, d;
    if (w < 340) { fs = .9; d = "compact"; } else if (w < 400) { fs = .95; d = "compact"; } else if (w < 600) { fs = 1.0; d = "default"; } else if (w < 900) { fs = 1.08; d = "comfortable"; } else { fs = 1.15; d = "comfortable"; }
    if (w > h && h < 500) d = "compact";
    if (dpr >= 3 && w >= 400) fs = Math.min(1.2, fs + .05);
    ds.fontScale = fs; ds.density = d; applyD(); refreshD();
  }
  var DPRE = { default: { fontScale: 1, density: "default" }, small: { fontScale: .9, density: "compact" }, large: { fontScale: 1.15, density: "comfortable" }, senior: { fontScale: 1.4, density: "large" } };
  function openDisplay() {
    openSheet('<div class="hv-sh-t">Display &amp; Accessibility</div>' +
      '<div class="hv-d-sec"><div class="hv-d-row"><h4 style="margin:0">Font size</h4><span class="hv-d-val" id="hvFsv">100%</span></div><input type="range" id="hvFs" min="80" max="150" step="5" value="100"></div>' +
      '<div class="hv-d-sec"><h4>Display density</h4><div class="hv-seg" id="hvDens"><button data-d="compact">Compact</button><button data-d="default">Default</button><button data-d="comfortable">Comfort</button><button data-d="large">Large</button></div></div>' +
      '<div class="hv-d-sec"><h4>Quick presets</h4><div class="hv-pre" id="hvPre"><button data-p="default">Default</button><button data-p="small">Small screen</button><button data-p="large">Large screen</button><button data-p="senior">Senior friendly</button></div></div>' +
      '<div class="hv-d-sec"><h4>Auto fit</h4><div class="hv-sw"><div><div class="lab">Optimise for this device</div><div class="sub" id="hvDet"></div></div><button class="hv-tg" id="hvAuto"></button></div></div>' +
      '<button class="hv-reset" id="hvReset">Reset to defaults</button>' +
      '<div class="hv-info" style="margin-top:12px">Changes readability &amp; spacing only — never medical content. Saved on this device.</div>');
    var s = sheetEl();
    s.querySelector("#hvFs").addEventListener("input", function () { ds.autoFit = false; ds.fontScale = (+this.value) / 100; applyD(); refreshD(); });
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.addEventListener("click", function () { ds.autoFit = false; ds.density = b.getAttribute("data-d"); applyD(); refreshD(); }); });
    s.querySelectorAll("#hvPre button").forEach(function (b) { b.addEventListener("click", function () { var p = DPRE[b.getAttribute("data-p")]; ds.autoFit = false; ds.fontScale = p.fontScale; ds.density = p.density; applyD(); refreshD(); }); });
    s.querySelector("#hvAuto").addEventListener("click", function () { ds.autoFit = !ds.autoFit; if (ds.autoFit) autoFitD(); else { applyD(); refreshD(); } });
    s.querySelector("#hvReset").addEventListener("click", function () { ds = Object.assign({}, DDEF); applyD(); refreshD(); });
    refreshD();
  }
  function refreshD() {
    var s = sheetEl(); if (!s) return;
    var fs = s.querySelector("#hvFs"); if (fs) fs.value = Math.round(ds.fontScale * 100);
    var v = s.querySelector("#hvFsv"); if (v) v.textContent = Math.round(ds.fontScale * 100) + "%";
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-d") === ds.density); });
    var a = s.querySelector("#hvAuto"); if (a) a.classList.toggle("on", ds.autoFit);
    var d = s.querySelector("#hvDet"); if (d) d.textContent = window.innerWidth + "×" + window.innerHeight + " · DPR " + (window.devicePixelRatio || 1).toFixed(2);
  }

  // ---- toast ----
  var tEl, tTimer;
  function toast(msg) { if (!tEl) { tEl = document.createElement("div"); tEl.className = "hv-toast"; document.body.appendChild(tEl); } tEl.textContent = msg; tEl.classList.add("on"); clearTimeout(tTimer); tTimer = setTimeout(function () { tEl.classList.remove("on"); }, 1800); }

  // ---- show after entry (when the shell becomes visible) ----
  function shellVisible() { var sh = document.querySelector(".shell"); return sh && sh.offsetParent !== null; }
  function injectFont() {
    if (document.getElementById("smd-inter")) return;
    var l = document.createElement("link"); l.id = "smd-inter"; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
    document.head.appendChild(l);
  }
  function injectV3CSS() {
    if (document.getElementById("smd-uiv3")) return;
    var l = document.createElement("link"); l.id = "smd-uiv3"; l.rel = "stylesheet"; l.href = "/ui-v3.css?v=s3";
    document.head.appendChild(l);
  }
  // Live, in-place UI switch — NO page reload, NO re-splash / re-consent / re-login.
  function setUI(on) {
    try { localStorage.setItem("smd_home_v2", on ? "1" : "0"); } catch (e) {}
    document.body.classList.toggle("ui-v2", on);
    if (on) { build(); suppressModeSelect(); showV2(); try { injectReasonBtn(); } catch (e) {} } else { if (root) root.classList.remove("on"); if (fab) fab.classList.remove("on"); var rw = document.getElementById("smdReasonWrap"); if (rw && rw.parentNode) rw.parentNode.removeChild(rw); }
    try { closeSheet(); } catch (e) {}
  }
  window.SMD_setUI = setUI;
  // Inject a "Find shared case by code" button into My Cases → opens the retrieve-by-code prompt.
  function injectMyCasesSearch() {
    var body = document.getElementById("mcpBody"); if (!body) return;
    if (body.querySelector("#smdFindCaseBtn")) return;
    var b = document.createElement("button");
    b.id = "smdFindCaseBtn"; b.type = "button";
    b.textContent = "🔎 Find shared case by code";
    b.style.cssText = "display:block;width:100%;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line,#E2E8F0);border-radius:12px;background:var(--panel,#fff);color:var(--teal,#0F766E);font:700 13px var(--sans,'Inter',system-ui,sans-serif);cursor:pointer";
    b.addEventListener("click", function () { if (window.CASESHARE && CASESHARE.openPrompt) CASESHARE.openPrompt(); });
    var bar = body.querySelector(".mcp-storage-bar");
    if (bar && bar.nextSibling) body.insertBefore(b, bar.nextSibling); else body.insertBefore(b, body.firstChild);
  }
  function wrapMyCases() {
    if (typeof window.openMyCases === "function" && !window.openMyCases._smdWrapped) {
      var orig = window.openMyCases;
      window.openMyCases = function () { var r = orig.apply(this, arguments); try { injectMyCasesSearch(); } catch (e) {} return r; };
      window.openMyCases._smdWrapped = true;
    }
  }
  // ---- Account / profile block in the sidebar (settings) ----
  function smdEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function readAccount() { try { return JSON.parse(localStorage.getItem("stewardmd_account") || "null"); } catch (e) { return null; } }
  function injectSbAccount() {
    var drawer = document.getElementById("sbDrawer"); if (!drawer) return;
    var head = drawer.querySelector(".sb-head"); if (!head) return;
    var box = document.getElementById("smdSbAccount");
    if (!box) { box = document.createElement("div"); box.id = "smdSbAccount"; box.className = "smd-sba"; head.insertAdjacentElement("afterend", box); }
    var a = readAccount();
    if (a && a.email) {
      var initial = (((a.name || a.email).trim()[0]) || "U").toUpperCase();
      var pic = a.picture
        ? '<img class="smd-sba-pic" src="' + smdEsc(a.picture) + '" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;smd-sba-pic smd-sba-ph&quot;>' + smdEsc(initial) + '</div>\'">'
        : '<div class="smd-sba-pic smd-sba-ph">' + smdEsc(initial) + '</div>';
      box.innerHTML = pic +
        '<div class="smd-sba-info"><div class="smd-sba-name">' + smdEsc(a.name || "Signed in") + '</div>' +
        '<div class="smd-sba-email">' + smdEsc(a.email) + '</div>' +
        '<div class="smd-sba-prov">' + (a.type === "google" ? "Google account" : "Account") + '</div></div>' +
        '<button class="smd-sba-btn" id="smdSbSignOut" type="button">Sign out</button>';
    } else {
      box.innerHTML = '<div class="smd-sba-pic smd-sba-ph">?</div>' +
        '<div class="smd-sba-info"><div class="smd-sba-name">Not signed in</div>' +
        '<div class="smd-sba-email">Guest mode — cloud sync off</div></div>' +
        '<button class="smd-sba-btn" id="smdSbSignIn" type="button">Sign in</button>';
    }
  }
  function wrapSidebar() {
    if (window.SB && typeof window.SB.open === "function" && !window.SB.open._smdWrapped) {
      var orig = window.SB.open;
      window.SB.open = function () { var r = orig.apply(this, arguments); try { injectSbAccount(); } catch (e) {} return r; };
      window.SB.open._smdWrapped = true;
    }
  }
  // sign-in / sign-out buttons are re-created on each open → delegate.
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t || !t.id) return;
    if (t.id === "smdSbSignOut") { var b = document.getElementById("sessionSignOut"); if (b) b.click(); setTimeout(injectSbAccount, 80); }
    else if (t.id === "smdSbSignIn") { try { if (window.SMD_signInWithGoogle) window.SMD_signInWithGoogle(); } catch (_) {} }
  }, false);
  function start() {
    injectFont(); build(); applyD(); if (ds.autoFit) autoFitD(); watchReasonBtn(); wrapMyCases(); wrapSidebar(); try { enhanceAbout(); } catch (e) {}
    if (IS_V2) {
      // show the new home as soon as the user is past splash/login, COVERING the app's own
      // Simple/Advanced screen so it isn't seen twice. Theme applies then (never on splash/consent).
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var ms = document.getElementById("modeSelect"), sh = document.querySelector(".shell");
        var entered = (ms && !ms.classList.contains("hidden")) || (sh && sh.offsetParent !== null);
        if (entered || tries > 60) { clearInterval(iv); document.body.classList.add("ui-v2"); suppressModeSelect(); showV2(); }
      }, 120);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
