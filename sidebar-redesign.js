/* StewardMD — sidebar redesign (lean utility drawer).
   Additive, like home.js: wraps SB.open and rebuilds #sbMenu on each open, and
   becomes the SINGLE authoritative builder for that menu (home.js's legacy
   reorganizer stands down when window.SMD_SBR is set — see home.js).

   Removes the home-screen duplicates (Dx My Patient, Clinical Reasoning,
   Antibiogram, Syndromes, Ward Sync, ICU — all already on the Home hero) and
   regroups the remainder into Tools / Reference & Help / Settings + a
   collapsible Advanced & Experimental block. Per product decision the lean
   look is adopted WITHOUT losing functionality: every working toggle that used
   to live in the old Settings group (Reasoning v2, Organ-safety, MaiK,
   Expanded Harrison KB, GHIS Ward Sync, Clinical Dictation, AI response time,
   and the Image Engine settings) is folded into Advanced, and "App Settings"
   expands that block. Every row delegates to the existing globals, so no
   clinical logic is touched. Idempotent; runs after home.js. Fails open — on
   any error the previously-rendered menu is left as-is.

   INSTALL: added once, after home.js, in index.html:
       <script defer src="/sidebar-redesign.js?v=..."></script>
*/
(function () {
  "use strict";

  // Legacy home.js reorganizer stands down while this file owns #sbMenu.
  try { window.SMD_SBR = true; } catch (e) {}

  var ICON = {
    pills: '<path d="M10.5 13.5 3 21M2 18a4 4 0 0 0 6 3l9-9a4 4 0 0 0-6-6L2 14a4 4 0 0 0 0 4Z"/>',
    interact: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="12" y1="11" x2="12.01" y2="11"/><line x1="16" y1="11" x2="16.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>',
    book: '<path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/>',
    info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13 7 22l5-3 5 3-1.2-9"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
    spark: '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M5 15l.7 1.9L8 18l-2.3.6L5 21l-.7-1.9L2 18l2.3-.6Z"/>',
    steth: '<path d="M4.5 3v6a4.5 4.5 0 0 0 9 0V3"/><path d="M4.5 3H3M13.5 3H12"/><path d="M9 13.5V16a5 5 0 0 0 10 0v-1.2"/><circle cx="19" cy="12.5" r="2.2"/>',
    watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l.7-3h4.6l.7 3M9 18l.7 3h4.6l.7-3"/><path d="M12 9v3l2 1"/>'
  };
  function svg(name) {
    return '<svg viewBox="0 0 24 24" class="sbr-ic"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICON[name] || "") + "</g></svg>";
  }
  function flag(k, def) { try { var v = localStorage.getItem(k); return v === null ? def : v === "1"; } catch (e) { return def; } }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }
  function closeSB() { try { if (window.SB && SB.close) SB.close(); } catch (e) {} }

  // Row actions → existing globals, with graceful fallbacks.
  var ACT = {
    drugs: function () { if (window.MEDDB && MEDDB.openList) MEDDB.openList(); else toast("Drugs database loading…"); },
    interactions: function () { if (window.MEDDRUGS && MEDDRUGS.openInteractions) MEDDRUGS.openInteractions(); else toast("Drug interactions loading…"); },
    calculators: function () { if (window.MEDCALC && MEDCALC.openList) MEDCALC.openList(); else toast("Calculators loading…"); },
    guidelines: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Guidelines loading…"); },
    tour: function () { if (window.SMD_TOUR && SMD_TOUR.start) SMD_TOUR.start({ replay: true }); else toast("Tour loading…"); },
    feedback: function () {
      if (window.SMD_openFeedback) return SMD_openFeedback();
      var b = document.querySelector('[data-act="feedback"],#v3FeedbackBtn'); if (b && b !== this) return b.click();
      try { location.href = "mailto:Support@StewardMD.in?subject=StewardMD%20feedback"; } catch (e) {}
    },
    ack: function () { if (window.openAbout) openAbout(); else if (window.SB && SB.modal) SB.modal("aboutModal"); else if (window.openAck) openAck(); else toast("Acknowledgements loading…"); },
    offlinedb: function () { if (window.SMD_OFFLINEDB && SMD_OFFLINEDB.open) SMD_OFFLINEDB.open(); else toast("Offline drug database — available in the app"); },
    notifications: function () {
      var b = document.getElementById("v3BellBtn"); if (b) return b.click();
      if (window.SMD_openNotifications) return SMD_openNotifications();
      toast("Notifications");
    },
    appearance: function () {
      // Opens the full Display & Accessibility sheet (font size, font family, theme, density…).
      if (window.SMD_openDisplay) return SMD_openDisplay();
      if (window.SMD_openAppearance) return SMD_openAppearance();
      if (window.SB && SB.toggleTheme) return SB.toggleTheme();
      document.body.classList.toggle("dark");
    },
    account: function () { if (window.SMD_VERIFY && SMD_VERIFY.openPanel) SMD_VERIFY.openPanel(); else toast("Account loading…"); },
    applewatch: function () { if (window.SMD_APPLE_WATCH && SMD_APPLE_WATCH.open) SMD_APPLE_WATCH.open(); else toast("Apple Watch settings loading…"); },
    // Specialty / branch selector — opens the Clinical Workspaces bottom sheet (workspaces.js).
    workspace: function () { if (window.SMD_WS && SMD_WS.open) SMD_WS.open(); else toast("Workspaces loading…"); }
    // "settings" is handled specially (expands the Advanced block) — see wiring below.
  };

  // Advanced & Experimental — every working toggle from the old Settings group,
  // preserved so nothing is lost in the lean redesign. Each maps to the same
  // global / localStorage key home.js used.
  var TOGGLES = [
    { id: "reason", title: "Reasoning v2", sub: "Live differential in the workflow", def: true, key: "smd_reason_v2" },
    { id: "safety", title: "Organ-safety overlay", sub: "Renal / hepatic / QT flags on advice", def: true, key: "smd_safety_overlay" },
    { id: "ai", title: "Ask Maik — Medical AI", sub: "Grounded knowledge assistant", def: true, key: "smd_ai" },
    { id: "expanded", title: "Expanded Harrison KB", sub: "+268 reference diseases as candidates", def: false, key: "smd_kb_expanded" },
    { id: "ghis", title: "GHIS Ward Sync", sub: "Live inpatient labs & radiology", def: true, key: "smd_ghis_ward" },
    { id: "whisper", title: "Clinical Dictation (Beta)", sub: "On-device Whisper voice→text · native app only", def: false, key: "smd_whisper_clinical_dictation" },
    { id: "maikperf", title: "Show AI response time", sub: "Diagnostics under each MaiK answer", def: false, key: "smd_maik_perf" },
    { id: "fundx", title: "FundX AI · Retinal (Beta)", sub: "AI-guided fundus imaging · reload to apply", def: false, key: "smd_fundx" },
    { id: "kardiox", title: "KardiQ X AI · ECG (Beta)", sub: "On-device 12-lead ECG interpretation · reload to apply", def: true, key: "smd_kardiox" }
  ];
  function setToggle(id, key, on) {
    try {
      if (id === "reason" && window.SMD_REASON) SMD_REASON.setFlag(on);
      else if (id === "safety" && window.SMD_SAFETY) SMD_SAFETY.setFlag(on);
      else if (id === "ai" && window.SMD_AI) SMD_AI.setFlag(on);
      else if (id === "expanded" && window.SMD_setKbExpanded) SMD_setKbExpanded(on);
      else if (id === "ghis" && window.SMD_setGhis) SMD_setGhis(on);
      else localStorage.setItem(key, on ? "1" : "0");   // whisper, maikperf — flag-only
    } catch (e) {}
  }

  function injectCSS() {
    if (document.getElementById("sbr-css")) return;
    var st = document.createElement("style"); st.id = "sbr-css";
    st.textContent = [
      "#sbMenu[data-sbr]{padding:12px 10px 8px}",
      "#sbMenu[data-sbr] .sbr-sec{padding:14px 14px 5px;font:700 11px/1.2 var(--sans,system-ui);letter-spacing:.075em;text-transform:uppercase;color:var(--slate-soft,#5a7184)}",
      "#sbMenu[data-sbr] .sbr-sec:first-child{padding-top:4px}",
      "#sbMenu[data-sbr] .sbr-row{position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:8px 14px;margin-top:1px;border:none;border-radius:9px;background:none;cursor:pointer;text-align:left;color:var(--ink,#14202b);font:600 14px/1.3 var(--sans,system-ui)}",
      "#sbMenu[data-sbr] .sbr-row:hover{background:var(--paper,#eef2f0)}",
      "#sbMenu[data-sbr] .sbr-ic{width:19px;height:19px;flex:0 0 auto;color:var(--slate-soft,#5a7184)}",
      "#sbMenu[data-sbr] .sbr-lbl{flex:1;min-width:0}",
      "#sbMenu[data-sbr] .sbr-badge{flex:0 0 auto;font:700 9px/1 var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:5px;padding:3px 6px}",
      "#sbMenu[data-sbr] .sbr-chev{flex:0 0 auto;font-size:11px;color:var(--slate-soft,#5a7184)}",
      "#sbMenu[data-sbr] .sbr-adv{display:none;padding:2px 14px 6px 44px}",
      "#sbMenu[data-sbr] .sbr-adv.open{display:block}",
      "#sbMenu[data-sbr] .sbr-card{border:1px solid var(--line,#d7dee3);border-radius:14px;overflow:hidden;background:var(--card,#fff);margin:2px 0 6px}",
      "#sbMenu[data-sbr] .sbr-tg{display:flex;align-items:center;gap:10px;padding:11px 14px}",
      "#sbMenu[data-sbr] .sbr-card .sbr-tg{border-top:1px solid var(--line,#d7dee3)}",
      "#sbMenu[data-sbr] .sbr-card .sbr-tg:first-child{border-top:0}",
      "#sbMenu[data-sbr] .sbr-tg-l{flex:1;min-width:0}",
      "#sbMenu[data-sbr] .sbr-tg-t{display:block;font:600 13px/1.3 var(--sans,system-ui);color:var(--ink,#14202b)}",
      "#sbMenu[data-sbr] .sbr-tg-s{display:block;font:500 11px/1.35 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:1px}",
      "#sbMenu[data-sbr] .sbr-sw{position:relative;flex:0 0 auto;width:38px;height:22px;border:none;border-radius:999px;background:var(--line,#d7dee3);cursor:pointer;transition:background .15s}",
      "#sbMenu[data-sbr] .sbr-sw.on{background:var(--teal,#0e6e63)}",
      "#sbMenu[data-sbr] .sbr-sw>span{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s}",
      "#sbMenu[data-sbr] .sbr-sw.on>span{left:19px}",
      "#sbMenu[data-sbr] .sbr-note{font:500 11px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184);padding-top:2px}",
      "#sbMenu[data-sbr] .sbr-adv .smd-nav-row{padding:8px 0}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  function row(act, icon, label, badge) {
    return '<button class="sbr-row" data-sbr-act="' + act + '">' + svg(icon) +
      '<span class="sbr-lbl">' + label + "</span>" +
      (badge ? '<span class="sbr-badge">' + badge + "</span>" : "") + "</button>";
  }
  function toggle(t) {
    var on = flag(t.key, t.def);
    return '<div class="sbr-tg"><div class="sbr-tg-l"><span class="sbr-tg-t">' + t.title + '</span><span class="sbr-tg-s">' + t.sub + '</span></div>' +
      '<button class="sbr-sw' + (on ? " on" : "") + '" data-sbr-tg="' + t.id + '" data-sbr-key="' + t.key + '" role="switch" aria-checked="' + on + '" aria-label="' + t.title + '"><span></span></button></div>';
  }

  function advBody() {
    var html = '<div class="sbr-card">' + TOGGLES.map(toggle).join("") + '</div>';
    // Image Engine keeps its own settings sub-UI (native inference model picker etc.).
    try {
      if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.settingsHTML) {
        html += '<div class="smd-nav-row" style="display:block"><div class="sbr-tg-t" style="margin-bottom:6px">Image Engine</div>' + SMD_IMAGE_ENGINE.settingsHTML() + "</div>";
      }
    } catch (e) {}
    // Offline drug database (NATIVE + PRO only) — restored under Advanced. Hidden on web where the
    // plugin is a no-op stub (SMD_OFFLINEDB.open absent).
    try {
      if (window.SMD_OFFLINEDB && SMD_OFFLINEDB.open) {
        html += '<button data-sbr-act="offlinedb" style="display:flex;align-items:center;gap:10px;width:100%;padding:9px 0;border:none;background:none;cursor:pointer;text-align:left;color:var(--ink,#14202b);font:600 13px/1.3 var(--sans,system-ui)">' + svg("pills") +
          '<span style="flex:1">Offline Drug Database</span><span class="sbr-badge">PRO</span></button>';
      }
    } catch (e) {}
    html += '<div class="sbr-note">Experimental. Clinician review required.</div>';
    return html;
  }

  // Clinical workspace / specialty ("branch") selector — restored here because this file now OWNS
  // #sbMenu and rebuilds it on every open (which was wiping workspaces.js's own injected switcher).
  // Rendered as a normal row (consistent styling) → opens the Specialty Workspaces sheet. Only shown
  // when the feature is live (window.SMD_WS exists — it early-returns when the kill-switch is set).
  function wsRow() {
    if (!(window.SMD_WS && SMD_WS.active)) return "";
    var name = "";
    try {
      var id = SMD_WS.active(), reg = SMD_WS.registry || [];   // registry is an ARRAY of {id,name,…}
      for (var i = 0; i < reg.length; i++) { if (reg[i] && reg[i].id === id) { name = reg[i].name || reg[i].label || ""; break; } }
    } catch (e) {}
    return '<div class="sbr-sec">Clinical workspace</div>' +
      '<button class="sbr-row" data-sbr-act="workspace">' + svg("steth") +
        '<span class="sbr-lbl">' + (name || "Choose specialty") + '</span><span class="sbr-chev">▾</span></button>';
  }
  function build(menu) {
    menu.setAttribute("data-sbr", "1");
    menu.innerHTML =
      wsRow() +
      '<div class="sbr-sec">Tools</div>' +
      row("drugs", "pills", "Drugs Database") +
      row("interactions", "interact", "Interaction Checker") +
      row("calculators", "calc", "Calculators") +
      '<div class="sbr-sec">Reference &amp; Help</div>' +
      row("guidelines", "book", "Guidelines &amp; Protocols") +
      row("tour", "info", "How it works · App tour") +
      row("feedback", "edit", "Send Feedback") +
      row("ack", "award", "About &amp; Acknowledgements") +
      '<div class="sbr-sec">Settings</div>' +
      // Carries verify.js's own [data-smd-verify] marker so its legacy base-styled injector
      // bails (its guard checks for that marker) — we render this row consistently instead.
      '<button class="sbr-row" data-sbr-act="account" data-smd-verify="1">' + svg("shield") + '<span class="sbr-lbl">Account &amp; Verification</span></button>' +
      row("notifications", "bell", "Notifications") +
      row("appearance", "sun", "Appearance &amp; Theme") +
      row("applewatch", "watch", "Apple Watch") +
      '<button class="sbr-row" data-sbr-adv="1">' + svg("spark") +
        '<span class="sbr-lbl">Advanced &amp; Experimental</span><span class="sbr-chev">▸</span></button>' +
      '<div class="sbr-adv" data-sbr-advbody>' + advBody() + "</div>";

    // Let the Image Engine wire up its own controls inside the freshly-built block.
    try { if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.wireSettings) SMD_IMAGE_ENGINE.wireSettings(menu.querySelector("[data-sbr-advbody]")); } catch (e) {}

    if (menu.__sbrClick) return;   // delegate once per element (survives innerHTML rebuilds)
    menu.__sbrClick = true;
    menu.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      // Advanced block toggle (chevron / header row)
      var adv = t.closest("[data-sbr-adv]");
      if (adv) { openAdvanced(menu); return; }
      // Individual experimental switches
      var sw = t.closest("[data-sbr-tg]");
      if (sw) {
        var id = sw.getAttribute("data-sbr-tg"), key = sw.getAttribute("data-sbr-key"), on = !sw.classList.contains("on");
        setToggle(id, key, on);
        sw.classList.toggle("on", on); sw.setAttribute("aria-checked", on);
        return;
      }
      // Everything else → its action global
      var r = t.closest("[data-sbr-act]");
      if (r) { var a = r.getAttribute("data-sbr-act"); closeSB(); setTimeout(function () { try { ACT[a] && ACT[a](); } catch (x) {} }, 60); }
    }, false);
  }

  // Toggle the Advanced & Experimental block open/closed.
  function openAdvanced(menu) {
    var b = menu.querySelector("[data-sbr-advbody]"); if (!b) return;
    var chev = menu.querySelector('[data-sbr-adv] .sbr-chev');
    var open = !b.classList.contains("open");
    b.classList.toggle("open", open);
    if (chev) chev.textContent = open ? "▾" : "▸";
  }

  function reorganize() {
    try {
      var menu = document.getElementById("sbMenu");
      if (!menu) return;
      // app.js rewrites #sbMenu.innerHTML on every open while keeping the element (and any
      // leftover attributes), so guard on OUR content, not a marker attribute — otherwise a
      // stale data-sbr would let app.js's base menu show through.
      if (menu.querySelector("[data-sbr-advbody]")) return; // already rebuilt this cycle
      injectCSS();
      build(menu);
    } catch (e) { /* fail open */ }
  }

  function install() {
    try {
      if (window.SB && typeof SB.open === "function" && !SB.__sbrWrapped) {
        var orig = SB.open;
        SB.open = function () { var r = orig.apply(this, arguments); setTimeout(reorganize, 60); return r; };
        SB.__sbrWrapped = true;
      }
    } catch (e) {}
    setTimeout(reorganize, 1600);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
