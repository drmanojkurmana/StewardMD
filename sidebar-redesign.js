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
    atlas: '<circle cx="12" cy="4.6" r="2.4"/><path d="M12 7v9M8.2 10h7.6M9.6 16 8 21M14.4 16 16 21"/>',
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
    watch: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l.7-3h4.6l.7 3M9 18l.7 3h4.6l.7-3"/><path d="M12 9v3l2 1"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    flask: '<path d="M10 2v5.5L4.4 18.5A2 2 0 0 0 6.1 21h11.8a2 2 0 0 0 1.7-2.5L14 7.5V2h-4Z"/><path d="M8.5 2h7M7 14h10"/>'
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
    atlas: function () { if (window.ATLAS && ATLAS.open) ATLAS.open(); else toast("RadioAnatome loading…"); },
    // Connect Hospital: the doctor onboards their own hospital by signing in to its EMR themselves.
    agentconnect: function () {
      var b = window.SMD_CONNECT_AGENT_BOOT;
      if (b && b.open) b.open().catch(function (e) { toast("Connect Hospital unavailable: " + (e && e.message ? e.message : "load failed")); });
      else toast("Connect Hospital is not enabled");
    },
    guidelines: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Guidelines loading…"); },
    tour: function () { if (window.SMD_TOUR && SMD_TOUR.start) SMD_TOUR.start({ replay: true }); else toast("Tour loading…"); },
    feedback: function () {
      if (window.SMD_openFeedback) return SMD_openFeedback();
      var b = document.querySelector('[data-act="feedback"],#v3FeedbackBtn'); if (b && b !== this) return b.click();
      try { location.href = "mailto:Support@StewardMD.in?subject=StewardMD%20feedback"; } catch (e) {}
    },
    ack: function () { if (window.openAbout) openAbout(); else if (window.SB && SB.modal) SB.modal("aboutModal"); else if (window.openAck) openAck(); else toast("Acknowledgements loading…"); },
    offlinedb: function () { if (window.SMD_OFFLINEDB && SMD_OFFLINEDB.open) SMD_OFFLINEDB.open(); else toast("Offline drug database — available in the app"); },
    experimental: function () { closeSB(); setTimeout(openExperimentalPage, 60); },
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
    // The full profile: StewardMD ID, hospital/college, city, plan. Distinct from "Account &
    // Verification" above, which is the registration-certificate flow.
    profile: function () { if (window.SMD_openProfile) SMD_openProfile(); else toast("Profile loading…"); },
    applewatch: function () { if (window.SMD_APPLE_WATCH && SMD_APPLE_WATCH.open) SMD_APPLE_WATCH.open(); else toast("Apple Watch settings loading…"); },
    wearos: function () { if (window.SMD_WEAROS && SMD_WEAROS.open) return SMD_WEAROS.open(); toast("StewardMD runs on your paired Wear OS watch. Open the app on the watch and sign in there. Your ward session syncs from this phone automatically."); },
    clinic: function () { if (window.SMD_CLINIC && SMD_CLINIC.open) SMD_CLINIC.open(); else toast("My Clinic loading…"); },
    // Specialty / branch selector — opens the Clinical Workspaces bottom sheet (workspaces.js).
    workspace: function () { if (window.SMD_WS && SMD_WS.open) SMD_WS.open(); else toast("Workspaces loading…"); }
    // "settings" is handled specially (expands the Advanced block) — see wiring below.
  };

  // Advanced & Experimental — every working toggle from the old Settings group,
  // preserved so nothing is lost in the lean redesign. Each maps to the same
  // global / localStorage key home.js used.
  var ADV_TOGGLES = [
    { id: "reason", title: "Reasoning v2", sub: "Live differential in the workflow", def: true, key: "smd_reason_v2" },
    { id: "safety", title: "Organ-safety overlay", sub: "Renal / hepatic / QT flags on advice", def: true, key: "smd_safety_overlay" },
    { id: "ai", title: "Ask Maik - Medical AI", sub: "Grounded knowledge assistant", def: true, key: "smd_ai" },
    { id: "ghis", title: "GHIS Ward Sync", sub: "Live inpatient labs & radiology", def: true, key: "smd_ghis_ward" },
    { id: "clinic", title: "My Clinic (on-device EMR)", sub: "Personal clinic: local patients + consults, back up to Drive", def: false, key: "smd_personal_clinic" }
  ];

  var EXP_TOGGLES = [
    { id: "fundx", title: "FundX AI · Retinal (Beta)", sub: "AI-guided fundus imaging · reload to apply", def: false, key: "smd_fundx" },
    { id: "kardiox", title: "KardiQ X AI · ECG (Beta)", sub: "On-device 12-lead ECG interpretation · reload to apply", def: false, key: "smd_kardiox" },
    { id: "thorex", title: "ThoreX AI · Chest X-ray (Beta)", sub: "On-device chest X-ray interpretation · reload to apply", def: false, key: "smd_thorex" },
    { id: "sknx", title: "SknX AI · Dermatology (Beta)", sub: "Skin lesion / rash analysis · reload to apply", def: false, key: "smd_sknx" },
    // def matches clinix-flags.js (both TRUE, owner decisions 2026-08-23/26); a false here only
    // made this switch DISPLAY off while the module was actually on.
    { id: "clinix", title: "CliniX · Clinical learning (Beta)", sub: "Bedside skills for students · reload to apply", def: true, key: "smd_clinix" },
    { id: "clinixtutor", title: "MaiK Examiner (Beta)", sub: "AI review inside CliniX Viva, only when the free keyword grade can't judge it", def: true, key: "smd_clinix_tutor" },
    { id: "surgx", title: "SURGX · Surgical Intelligence (Beta)", sub: "Notes, protocols, procedures, evidence, cases · reload to apply", def: true, key: "smd_surgx" },
    { id: "surgxdraft", title: "SURGX draft content", sub: "Show surgical content that is not yet clinician-approved. Turn OFF before any non-tester release", def: true, key: "smd_surgx_draft" },
    { id: "whisper", title: "Clinical Dictation (Beta)", sub: "On-device Whisper voice→text · native app only", def: false, key: "smd_whisper_clinical_dictation" },
    { id: "oncoprotolib", title: "Oncology Protocol Library (Beta)", sub: "Draft standard protocol library in oncology workbench", def: true, key: "smd_onco_protolib" },
    { id: "maikperf", title: "Show AI response time", sub: "Diagnostics under each MaiK answer", def: false, key: "smd_maik_perf" }
  ];

  var TOGGLES = ADV_TOGGLES.concat(EXP_TOGGLES);

  function setToggle(id, key, on) {
    try {
      if (id === "reason" && window.SMD_REASON) SMD_REASON.setFlag(on);
      else if (id === "safety" && window.SMD_SAFETY) SMD_SAFETY.setFlag(on);
      else if (id === "ai" && window.SMD_AI) SMD_AI.setFlag(on);
      else if (id === "expanded" && window.SMD_setKbExpanded) SMD_setKbExpanded(on);
      else if (id === "ghis" && window.SMD_setGhis) SMD_setGhis(on);
      else if (id === "oncoprotolib") localStorage.setItem("smd_onco_protolib", on ? "1" : "0");
      else localStorage.setItem(key, on ? "1" : "0");   // whisper, maikperf, etc.
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
      "#sbMenu[data-sbr] .sbr-card{border:1px solid var(--line,#d7dee3);border-radius:14px;overflow:hidden;background:var(--panel,#fff);margin:2px 0 6px}",
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
      "#sbMenu[data-sbr] .sbr-adv .smd-nav-row{padding:8px 0}",
      /* ── Frosted "liquid glass" sidebar — readable dark text on translucent frost. Recovery tag pre-sidebar-v2. ── */
      "#sbDrawer{background:rgba(236,243,240,.72)!important;-webkit-backdrop-filter:blur(24px) saturate(1.4);backdrop-filter:blur(24px) saturate(1.4)}",
      "#sbDrawer .sb-head{background:rgba(255,255,255,.3)!important;border-bottom:1px solid rgba(14,110,99,.14)!important}",
      "#sbDrawer .sb-head *{color:#14202b!important}",
      "#sbDrawer .smd-sba{background:rgba(255,255,255,.6)!important;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.7)!important;border-radius:18px!important;margin:10px 12px!important;padding:12px!important;box-shadow:0 8px 22px -12px rgba(14,110,99,.4)!important}",
      "#sbDrawer .smd-sba-name{color:#14202b!important}",
      "#sbDrawer .smd-sba-email,#sbDrawer .smd-sba-prov{color:#5a7184!important}",
      "#sbDrawer .smd-sba-hosp{color:#0b5a50!important;font-weight:700}",
      "#sbDrawer .smd-sba-btn{background:rgba(14,110,99,.12)!important;color:#0b5a50!important;border:1px solid rgba(14,110,99,.28)!important}",
      "#sbMenu[data-sbr]{background:transparent}",
      "#sbMenu[data-sbr] .sbr-sec{color:#0b5a50}",
      "#sbMenu[data-sbr] .sbr-row{color:#14202b;border-radius:14px;padding:12px 15px}",
      "#sbMenu[data-sbr] .sbr-row:hover{background:rgba(14,110,99,.09)}",
      "#sbMenu[data-sbr] .sbr-ic{color:#0e6e63}",
      "#sbMenu[data-sbr] .sbr-badge{background:rgba(14,110,99,.14);color:#0b5a50}",
      "#sbMenu[data-sbr] .sbr-chev{color:#0e6e63}",
      "#sbMenu[data-sbr] .sbr-card{background:rgba(255,255,255,.55);border-color:rgba(255,255,255,.7);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}",
      "#sbMenu[data-sbr] .sbr-tg-t{color:#14202b}",
      "#sbMenu[data-sbr] .sbr-tg-s{color:#5a7184}",
      "#sbMenu[data-sbr] .sbr-sw{background:#c4cec9}",
      "#sbMenu[data-sbr] .sbr-sw.on{background:#0e6e63}",
      "#sbMenu[data-sbr] .sbr-note{color:#5a7184}",
      "#sbMenu[data-sbr] .sbr-adv button{color:#14202b}",
      "#sbMenu[data-sbr] .sbr-status{margin:16px 4px 6px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.5);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.6);display:flex;align-items:center;gap:9px;color:#0b5a50;font:600 12.5px/1 var(--sans,system-ui)}",
      "#sbMenu[data-sbr] .sbr-status b{width:9px;height:9px;border-radius:50%;background:#12b886;display:inline-block;box-shadow:0 0 0 3px rgba(18,184,134,.2)}",
      /* ── Dark mode overrides for liquid glass sidebar ── */
      "body.dark #sbDrawer,body.v3-dark #sbDrawer{background:rgba(15,23,42,.92)!important;-webkit-backdrop-filter:blur(24px) saturate(1.8);backdrop-filter:blur(24px) saturate(1.8)}",
      "body.dark #sbDrawer .sb-head,body.v3-dark #sbDrawer .sb-head{background:rgba(30,41,59,.7)!important;border-bottom:1px solid rgba(51,65,85,.6)!important}",
      "body.dark #sbDrawer .sb-head *,body.v3-dark #sbDrawer .sb-head *{color:#f8fafc!important}",
      "body.dark #sbDrawer .smd-sba,body.v3-dark #sbDrawer .smd-sba{background:rgba(30,41,59,.7)!important;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border:1px solid rgba(51,65,85,.8)!important;box-shadow:0 8px 22px -12px rgba(0,0,0,.6)!important}",
      "body.dark #sbDrawer .smd-sba-name,body.v3-dark #sbDrawer .smd-sba-name{color:#f8fafc!important}",
      "body.dark #sbDrawer .smd-sba-email,body.dark #sbDrawer .smd-sba-prov,body.v3-dark #sbDrawer .smd-sba-email,body.v3-dark #sbDrawer .smd-sba-prov{color:#94a3b8!important}",
      "body.dark #sbDrawer .smd-sba-hosp,body.v3-dark #sbDrawer .smd-sba-hosp{color:#2dd4bf!important}",
      "body.dark #sbDrawer .smd-sba-btn,body.v3-dark #sbDrawer .smd-sba-btn{background:rgba(20,184,166,.2)!important;color:#2dd4bf!important;border:1px solid rgba(20,184,166,.4)!important}",
      "body.dark #sbMenu[data-sbr] .sbr-sec,body.v3-dark #sbMenu[data-sbr] .sbr-sec{color:#2dd4bf}",
      "body.dark #sbMenu[data-sbr] .sbr-row,body.v3-dark #sbMenu[data-sbr] .sbr-row{color:#f8fafc}",
      "body.dark #sbMenu[data-sbr] .sbr-row:hover,body.v3-dark #sbMenu[data-sbr] .sbr-row:hover{background:rgba(30,41,59,.6)}",
      "body.dark #sbMenu[data-sbr] .sbr-ic,body.v3-dark #sbMenu[data-sbr] .sbr-ic{color:#2dd4bf}",
      "body.dark #sbMenu[data-sbr] .sbr-badge,body.v3-dark #sbMenu[data-sbr] .sbr-badge{background:rgba(20,184,166,.25);color:#5eead4}",
      "body.dark #sbMenu[data-sbr] .sbr-chev,body.v3-dark #sbMenu[data-sbr] .sbr-chev{color:#94a3b8}",
      "body.dark #sbMenu[data-sbr] .sbr-card,body.v3-dark #sbMenu[data-sbr] .sbr-card{background:rgba(30,41,59,.55);border-color:rgba(51,65,85,.6)}",
      "body.dark #sbMenu[data-sbr] .sbr-tg-t,body.v3-dark #sbMenu[data-sbr] .sbr-tg-t{color:#f8fafc}",
      "body.dark #sbMenu[data-sbr] .sbr-tg-s,body.v3-dark #sbMenu[data-sbr] .sbr-tg-s{color:#94a3b8}",
      "body.dark #sbMenu[data-sbr] .sbr-sw,body.v3-dark #sbMenu[data-sbr] .sbr-sw{background:#334155}",
      "body.dark #sbMenu[data-sbr] .sbr-sw.on,body.v3-dark #sbMenu[data-sbr] .sbr-sw.on{background:#0d9488}",
      "body.dark #sbMenu[data-sbr] .sbr-note,body.v3-dark #sbMenu[data-sbr] .sbr-note{color:#94a3b8}",
      "body.dark #sbMenu[data-sbr] .sbr-adv button,body.v3-dark #sbMenu[data-sbr] .sbr-adv button{color:#f8fafc}",
      "body.dark #sbMenu[data-sbr] .sbr-status,body.v3-dark #sbMenu[data-sbr] .sbr-status{background:rgba(30,41,59,.5);border-color:rgba(51,65,85,.6);color:#2dd4bf}",
      /* ── Settings page (dedicated full-screen module) ── */
      ".sbr-set-ov{position:fixed;inset:0;z-index:100200;background:var(--paper,#f6f7f5);color:var(--ink,#14202b);overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;font-family:var(--sans,system-ui,-apple-system,sans-serif);animation:sbrSetIn .18s ease}",
      // The settings page had NO box-sizing rule, so every `width:100%` row with padding
      // (.sbr-row is width:100% + 12px padding) overflowed its container by ~24px and the
      // whole page scrolled SIDEWAYS. border-box fixes the existing rows as well as the
      // answer-engine block; overflow-x:hidden above is the belt-and-braces guard.
      ".sbr-set-ov,.sbr-set-ov *{box-sizing:border-box}",
      ".sbr-set-ov img,.sbr-set-ov svg{max-width:100%}",
      "@keyframes sbrSetIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}",
      "body.dark .sbr-set-ov,body.v3-dark .sbr-set-ov{background:#0d1b26;color:#e8edf2}",
      ".sbr-set-head{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:inherit;border-bottom:1px solid var(--line,#d7dee3)}",
      ".sbr-set-head h2{margin:0;font:800 19px/1.2 var(--sans,system-ui)}",
      ".sbr-set-back{display:inline-flex;align-items:center;gap:2px;border:none;background:none;color:var(--teal,#0e6e63);font:700 15px/1 var(--sans,system-ui);cursor:pointer;padding:6px 8px 6px 0}",
      ".sbr-set-chev{font-size:24px;line-height:1}",
      ".sbr-set-body{padding:6px 12px calc(28px + env(safe-area-inset-bottom))}",
      ".sbr-set-ov .sbr-sec{padding:16px 4px 6px;font:700 11px/1.2 var(--sans,system-ui);letter-spacing:.075em;text-transform:uppercase;color:var(--slate-soft,#5a7184)}",
      ".sbr-set-ov .sbr-row{position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:13px 12px;margin-top:2px;border:none;border-radius:12px;background:var(--panel,#fff);cursor:pointer;text-align:left;color:var(--ink,#14202b);font:600 15px/1.3 var(--sans,system-ui)}",
      "body.dark .sbr-set-ov .sbr-row{background:#132030}",
      ".sbr-set-ov .sbr-row:active{opacity:.7}",
      ".sbr-set-ov .sbr-ic{width:20px;height:20px;flex:0 0 auto;color:var(--teal,#0e6e63)}",
      ".sbr-set-ov .sbr-lbl{flex:1;min-width:0}",
      ".sbr-set-ov .sbr-chev{flex:0 0 auto;font-size:12px;color:var(--slate-soft,#5a7184)}",
      ".sbr-set-ov .sbr-badge{flex:0 0 auto;font:700 9px/1 var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border-radius:5px;padding:3px 6px}",
      ".sbr-set-ov .sbr-card{border:1px solid var(--line,#d7dee3);border-radius:14px;overflow:hidden;background:var(--panel,#fff);margin:2px 0 8px}",
      ".sbr-set-ov .sbr-tg,.sbr-set-ov .smd-nav-row{display:flex;align-items:center;gap:10px;padding:12px;background:var(--panel,#fff);border-radius:12px;margin-top:2px}",
      "body.dark .sbr-set-ov .sbr-tg,body.dark .sbr-set-ov .smd-nav-row,body.dark .sbr-set-ov .sbr-card{background:#132030;border-color:#233242}",
      ".sbr-set-ov .sbr-card .sbr-tg{border-top:1px solid var(--line,#d7dee3);border-radius:0;margin:0}",
      ".sbr-set-ov .sbr-card .sbr-tg:first-child{border-top:0}",
      ".sbr-set-ov .sbr-tg-l{flex:1;min-width:0}",
      ".sbr-set-ov .sbr-tg-t{display:block;font:600 14px/1.3 var(--sans,system-ui);color:var(--ink,#14202b)}",
      ".sbr-set-ov .sbr-tg-s{display:block;font:500 11.5px/1.35 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:1px}",
      ".sbr-set-ov .sbr-sw{position:relative;flex:0 0 auto;width:40px;height:24px;border:none;border-radius:999px;background:#c4cec9;cursor:pointer;transition:background .15s}",
      ".sbr-set-ov .sbr-sw.on{background:var(--teal,#0e6e63)}",
      ".sbr-set-ov .sbr-sw>span{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}",
      ".sbr-set-ov .sbr-sw.on>span{left:19px}",
      ".sbr-set-ov .sbr-note{font:500 11.5px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184);padding:6px 4px}",
      /* ── Experimental section & subpage styling ── */
      ".sbr-set-ov.sbr-exp-ov{z-index:100250}",
      "#xaGate{z-index:100300!important}",
      ".sbr-badge-beta{background:#fef3c7!important;color:#92400e!important;border:1px solid rgba(245,158,11,.3)!important}",
      "body.dark .sbr-badge-beta{background:rgba(245,158,11,.18)!important;color:#fbbf24!important;border-color:rgba(245,158,11,.3)!important}",
      ".sbr-badge-ok{background:#dcfce7!important;color:#166534!important;border:1px solid rgba(34,197,94,.3)!important}",
      "body.dark .sbr-badge-ok{background:rgba(34,197,94,.18)!important;color:#4ade80!important;border-color:rgba(34,197,94,.3)!important}",
      ".sbr-badge-lock{background:#f1f5f9!important;color:#64748b!important;border:1px solid rgba(100,116,139,.2)!important}",
      "body.dark .sbr-badge-lock{background:rgba(100,116,139,.18)!important;color:#94a3b8!important;border-color:rgba(100,116,139,.3)!important}",
      ".sbr-callout{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;margin:6px 0 14px;background:rgba(14,110,99,.08);border:1px solid rgba(14,110,99,.22);border-radius:14px;color:var(--ink,#14202b)}",
      "body.dark .sbr-callout{background:rgba(20,184,166,.1);border-color:rgba(20,184,166,.25);color:#e8edf2}",
      ".sbr-callout-ic{font-size:22px;line-height:1;flex:0 0 auto;color:var(--teal,#0e6e63)}",
      ".sbr-callout-text{flex:1;min-width:0;font:500 12.5px/1.45 var(--sans,system-ui)}",
      ".sbr-callout-text b{font-weight:700;color:var(--teal,#0e6e63)}",
      "body.dark .sbr-callout-text b{color:#2dd4bf}",
      ".sbr-exp-desc{padding:0 4px 8px;font:500 12px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184)}",
      ".sbr-xa-row{display:flex;align-items:center;gap:12px;padding:13px 14px;border-top:1px solid var(--line,#d7dee3)}",
      ".sbr-card .sbr-xa-row:first-child{border-top:0}",
      ".sbr-xa-ic{font-size:20px;line-height:1;flex:0 0 auto;width:28px;text-align:center}",
      ".sbr-xa-info{flex:1;min-width:0}",
      ".sbr-xa-title{display:flex;align-items:center;gap:8px;font:600 14px/1.3 var(--sans,system-ui);color:var(--ink,#14202b);flex-wrap:wrap}",
      ".sbr-xa-desc{font:500 11.5px/1.35 var(--sans,system-ui);color:var(--slate-soft,#5a7184);margin-top:2px}",
      ".sbr-xa-btn{flex:0 0 auto;padding:7px 13px;border-radius:8px;font:700 12px/1 var(--sans,system-ui);cursor:pointer;border:none;transition:opacity .15s}",
      ".sbr-xa-btn:active{opacity:.7}",
      ".sbr-xa-btn.pri{background:var(--teal,#0e6e63);color:#fff}",
      ".sbr-xa-btn.sec{background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);border:1px solid rgba(14,110,99,.25)}",
      "body.dark .sbr-xa-btn.sec{background:rgba(20,184,166,.15);color:#2dd4bf;border-color:rgba(20,184,166,.3)}",
      ".sbr-dev-badge{display:flex;align-items:center;gap:6px;margin:10px 4px 4px;padding:9px 12px;border-radius:10px;background:#fef3c7;border:1px solid rgba(245,158,11,.3);color:#92400e;font:600 12px/1.3 var(--sans,system-ui)}",
      "body.dark .sbr-dev-badge{background:rgba(245,158,11,.15);border-color:rgba(245,158,11,.3);color:#fbbf24}",
      /* Sub-component button styles inside settings overlay */
      ".sbr-set-ov .smd-nav-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:8px;padding:10px 14px;border:1px solid var(--line,#d7dee3);border-radius:10px;background:var(--panel,#fff);color:var(--ink,#14202b);font:600 13px/1.3 var(--sans,system-ui);cursor:pointer;transition:all .15s}",
      ".sbr-set-ov .smd-nav-btn:hover{background:var(--paper,#eef2f0)}",
      ".sbr-set-ov .smd-nav-btn.on{border-color:var(--teal,#0e6e63);color:var(--teal,#0e6e63);background:var(--teal-soft,#e3f1ee)}",
      "body.dark .sbr-set-ov .smd-nav-btn{background:#182838;border-color:#2b3e52;color:#e8edf2}",
      "body.dark .sbr-set-ov .smd-nav-btn:hover{background:#22364a}",
      "body.dark .sbr-set-ov .smd-nav-btn.on{border-color:#14b8a6;color:#14b8a6;background:rgba(20,184,166,.15)}",
      "body.dark .sbr-set-ov .ie-seg [role=radiogroup],body.dark .sbr-set-ov .me-seg [role=radiogroup]{background:#132030!important;border-color:#233242!important}",
      "body.dark .sbr-set-ov [data-ie-opt],body.dark .sbr-set-ov [data-me-opt]{color:#e8edf2!important;border-top-color:#233242!important}",
      "body.dark .sbr-set-ov [data-ie-opt][aria-checked=true],body.dark .sbr-set-ov [data-me-opt][aria-checked=true]{background:rgba(14,110,99,.25)!important}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  // Wearable companion is platform-specific: Apple Watch on iOS, Wear OS on Android, none on web.
  // Showing "Apple Watch" on Android was wrong (that bridge is iOS-only).
  function watchPlat() { try { var C = window.Capacitor; return (C && (typeof C.getPlatform === "function" ? C.getPlatform() : C.platform)) || "web"; } catch (e) { return "web"; } }
  function watchRow() {
    var p = watchPlat();
    if (p === "ios") return row("applewatch", "watch", "Apple Watch");
    if (p === "android") return row("wearos", "watch", "Wear OS");
    return "";   // web build has no paired wearable
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
    var html = '<div class="sbr-card">' + ADV_TOGGLES.map(toggle).join("") + '</div>';
    // Image Engine keeps its own settings sub-UI (native inference model picker etc.).
    try {
      if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.settingsHTML) {
        html += '<div class="smd-nav-row" style="display:block"><div class="sbr-tg-t" style="margin-bottom:6px">Image Engine</div>' + SMD_IMAGE_ENGINE.settingsHTML() + "</div>";
      }
    } catch (e) {}
    // MaiK Scribe voice-model dashboard (enable tiers + download/delete on-device models).
    try {
      if (window.SMD_VOICE && SMD_VOICE.modelSettingsHTML) {
        html += '<div class="smd-nav-row" style="display:block"><div class="sbr-tg-t" style="margin-bottom:6px">MaiK Scribe · Voice models</div>' + SMD_VOICE.modelSettingsHTML() + "</div>";
      }
    } catch (e) {}
    // MaiK answer engine (KB only / Cloud / On-device) + the on-device model pack manager.
    // This is the ONLY live settings surface: home.js's old Settings group stands down when
    // SMD_SBR is set, so wiring it there alone would render nothing.
    try {
      if (window.SMD_MAIK_ENGINE && SMD_MAIK_ENGINE.settingsHTML) {
        html += '<div class="smd-nav-row" style="display:block"><div class="sbr-tg-t" style="margin-bottom:6px">MaiK · Answers</div>' + SMD_MAIK_ENGINE.settingsHTML() + "</div>";
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
    // Owner-only: review + approve/decline hospital-add requests.
    try {
      var _oe = ((window.SMD_AUTH && SMD_AUTH.currentUser && SMD_AUTH.currentUser.email) || "").toLowerCase();
      if (["drmanojkurmana@gmail.com", "mkkmanojkumar0@gmail.com", "kdiwakar45@gmail.com", "stewardmd.in@gmail.com"].indexOf(_oe) >= 0) {
        html += '<button class="sbr-row" data-sbr-act="hospadmin">' + svg("shield") +
          '<span style="flex:1">Hospital requests</span><span class="sbr-badge">OWNER</span></button>';
      }
    } catch (e) {}
    html += '<div class="sbr-note">Clinical engine settings for this device.</div>';
    return html;
  }

  // Software Update — Apple-style: Automatic-updates toggle + Check + Download & install.
  // BUG (2026-08-23, user report): home.js has carried this exact UI since before the 1 Aug OTA
  // teardown, but it was wired into home.js's OWN Settings-group builder, which stands down the
  // moment this file sets window.SMD_SBR (see the file banner above) - so it has never actually
  // rendered anywhere the user could reach it. Rebuilt here, in the live Settings page, using this
  // file's own sbr-tg/sbr-sw markup (styled by THIS file's injectCSS, unlike home.js's - which
  // never runs either, for the same reason).
  function otaSectionHTML() {
    try { if (!(window.SMD_OTA && SMD_OTA.available())) return ""; } catch (e) { return ""; }
    var on = false; try { on = !!SMD_OTA.isAuto(); } catch (e) {}
    var ver = "current"; try { ver = SMD_OTA.currentVersion() || "current"; } catch (e) {}
    return '<div class="sbr-sec">Software Update</div>' +
      '<div class="sbr-card"><div class="sbr-tg"><div class="sbr-tg-l"><span class="sbr-tg-t">Automatic updates</span>' +
        '<span class="sbr-tg-s">Fetch new versions in the background</span></div>' +
        '<button class="sbr-sw' + (on ? " on" : "") + '" data-ota-auto="1" role="switch" aria-checked="' + on + '" aria-label="Automatic updates"><span></span></button></div></div>' +
      '<div class="sbr-note" id="otaStatus">Version ' + ver + '</div>' +
      '<button class="sbr-row" id="otaCheck">' + svg("refresh") + '<span class="sbr-lbl">Check for updates</span></button>' +
      '<button class="sbr-row" id="otaInstall" style="display:none">' + svg("download") + '<span class="sbr-lbl">Download &amp; install</span></button>';
  }
  // Wires the section rendered by otaSectionHTML() - separate from the generic [data-sbr-tg]
  // delegation (setToggle()'s localStorage-flag model doesn't fit SMD_OTA.setAuto()) and from the
  // generic [data-sbr-act] delegation (Check/Install need live status text + a pending-update
  // handle between the two taps, not a fire-and-forget action).
  function wireOtaSection(root) {
    if (!(window.SMD_OTA && SMD_OTA.available())) return;
    var autoSw = root.querySelector("[data-ota-auto]"), statusEl = root.querySelector("#otaStatus");
    var checkBtn = root.querySelector("#otaCheck"), installBtn = root.querySelector("#otaInstall");
    var pending = null;
    if (autoSw) autoSw.addEventListener("click", function () {
      var on = !autoSw.classList.contains("on");
      try { SMD_OTA.setAuto(on); } catch (e) {}
      autoSw.classList.toggle("on", on); autoSw.setAttribute("aria-checked", on);
    });
    if (checkBtn) checkBtn.addEventListener("click", function () {
      checkBtn.disabled = true; if (statusEl) statusEl.textContent = "Checking…";
      SMD_OTA.check().then(function (r) {
        checkBtn.disabled = false; r = r || {};
        if (r.status === "available") { pending = r; if (statusEl) statusEl.textContent = "Update available: v" + r.version; if (installBtn) installBtn.style.display = ""; }
        else if (r.status === "uptodate") { pending = null; if (statusEl) statusEl.textContent = "You're up to date" + (r.current ? " (v" + r.current + ")" : ""); if (installBtn) installBtn.style.display = "none"; }
        else { if (statusEl) statusEl.textContent = "Couldn't check — " + (r.error || "try again"); }
      });
    });
    if (installBtn) installBtn.addEventListener("click", function () {
      if (!pending) return;
      installBtn.disabled = true;
      SMD_OTA.install(pending, function (pct) { if (statusEl) statusEl.textContent = "Downloading… " + pct + "%"; }).then(function (res) {
        if (res && res.ok) { if (statusEl) statusEl.textContent = "Update ready — reopening…"; }
        else { installBtn.disabled = false; if (statusEl) statusEl.textContent = "Install failed — " + ((res && res.error) || "try again"); }
      });
    });
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
      row("agentconnect", "steth", "Connect Hospital") +
      (flag("smd_personal_clinic", false) ? row("clinic", "steth", "My Clinic") : "") +
      '<div class="sbr-sec">Reference &amp; Help</div>' +
      row("guidelines", "book", "Guidelines &amp; Protocols") +
        (flag("smd_atlas", true) ? row("atlas", "atlas", "RadioAnatome") : "") +
      row("tour", "info", "How it works · App tour") +
      row("feedback", "edit", "Send Feedback") +
      row("ack", "award", "About &amp; Acknowledgements") +
      '<div class="sbr-sec">Settings</div>' +
      // One entry → the full Settings page (account, notifications, appearance, watch, advanced +
      // experimental). Replaces the old inline "Advanced & Experimental" expand-in-sidebar.
      '<button class="sbr-row" data-sbr-act="settings">' + svg("sliders") + '<span class="sbr-lbl">Settings</span><span class="sbr-chev">▸</span></button>' +
      '<div class="sbr-status"><b></b>System Online</div>';

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
      // Everything else → its action global (settings → the dedicated Settings page)
      var r = t.closest("[data-sbr-act]");
      if (r) {
        var a = r.getAttribute("data-sbr-act");
        if (a === "settings") { closeSB(); setTimeout(openSettingsPage, 60); return; }
        closeSB(); setTimeout(function () { try { ACT[a] && ACT[a](); } catch (x) {} }, 60);
      }
    }, false);
  }

  // Toggle the Advanced & Experimental block open/closed. (Legacy; the Settings page replaces the
  // inline expand, but kept harmless in case another caller references it.)
  function openAdvanced(menu) {
    var b = menu && menu.querySelector("[data-sbr-advbody]"); if (!b) return;
    var chev = menu.querySelector('[data-sbr-adv] .sbr-chev');
    var open = !b.classList.contains("open");
    b.classList.toggle("open", open);
    if (chev) chev.textContent = open ? "▾" : "▸";
  }

  // ---- Experimental page (dedicated full-screen module) --------------------------------------------
  function xaFeatureActive(feat) {
    try {
      if (window.SMD_XACCESS && SMD_XACCESS.isActiveCached) {
        return !!SMD_XACCESS.isActiveCached(feat);
      }
    } catch (e) {}
    return false;
  }

  function xaRowHTML(feat, icon, title, desc) {
    var active = xaFeatureActive(feat);
    var badge = active
      ? '<span class="sbr-badge sbr-badge-ok">ACTIVE</span>'
      : '<span class="sbr-badge sbr-badge-lock">CODE REQUIRED</span>';
    var btnText = active ? "Manage Access" : "Enter Code";
    var btnClass = active ? "sbr-xa-btn sec" : "sbr-xa-btn pri";
    return '<div class="sbr-xa-row" data-xa-row="' + feat + '">' +
      '<div class="sbr-xa-ic">' + icon + '</div>' +
      '<div class="sbr-xa-info">' +
        '<div class="sbr-xa-title">' + title + ' ' + badge + '</div>' +
        '<div class="sbr-xa-desc">' + desc + '</div>' +
      '</div>' +
      '<button class="' + btnClass + '" data-xa-open="' + feat + '">' + btnText + '</button>' +
    '</div>';
  }

  function refreshExperimentalUI() {
    var roots = [document.getElementById("sbrExperimental"), document.getElementById("sbrSettings")];
    roots.forEach(function (root) {
      if (!root) return;
      ["fundx", "kardiox", "thorex", "sknx"].forEach(function (f) {
        var row = root.querySelector('[data-xa-row="' + f + '"]');
        if (row) {
          var act = xaFeatureActive(f);
          var badge = row.querySelector(".sbr-badge");
          if (badge) {
            badge.className = "sbr-badge " + (act ? "sbr-badge-ok" : "sbr-badge-lock");
            badge.textContent = act ? "ACTIVE" : "CODE REQUIRED";
          }
          var btn = row.querySelector("[data-xa-open]");
          if (btn) {
            btn.className = "sbr-xa-btn " + (act ? "sec" : "pri");
            btn.textContent = act ? "Manage Access" : "Enter Code";
          }
        }
      });
    });
  }

  function expBodyHTML() {
    var devActive = false;
    try {
      if (window.SMD_XACCESS && SMD_XACCESS.devBypass && SMD_XACCESS.devBypass()) {
        devActive = true;
      }
    } catch (e) {}

    return '<div class="sbr-callout">' +
        '<div class="sbr-callout-ic">' + svg("flask") + '</div>' +
        '<div class="sbr-callout-text"><b>Beta &amp; Research Features</b><br>' +
        'These modules are experimental and under active clinical evaluation. All decisions require independent clinician verification.</div>' +
      '</div>' +

      '<div class="sbr-sec">Private Beta Access Codes</div>' +
      '<div class="sbr-exp-desc">Enter access codes from the StewardMD team to unlock private beta modules on this device.</div>' +
      '<div class="sbr-card sbr-xa-card">' +
        xaRowHTML("fundx", "🔬", "FundX AI", "AI-guided retinal screening &amp; fundus imaging") +
        xaRowHTML("kardiox", "🫀", "KardiQ X AI", "On-device 12-lead ECG rhythm &amp; ischemia interpretation") +
        xaRowHTML("thorex", "🫁", "ThoreX AI", "On-device chest radiograph interpretation") +
        xaRowHTML("sknx", '<img src="/sknx-mark.png?v=sx2" alt="" width="20" height="20" style="object-fit:contain;vertical-align:middle;display:inline-block;">', "SknX AI", "Skin lesion, rash &amp; dermatoscope analysis") +
      '</div>' +

      '<div class="sbr-sec">AI Diagnostic Modules</div>' +
      '<div class="sbr-card">' +
        toggle({ id: "fundx", title: "FundX AI · Retinal (Beta)", sub: "AI-guided fundus imaging · reload to apply", def: false, key: "smd_fundx" }) +
        toggle({ id: "kardiox", title: "KardiQ X AI · ECG (Beta)", sub: "On-device 12-lead ECG interpretation · reload to apply", def: false, key: "smd_kardiox" }) +
        toggle({ id: "thorex", title: "ThoreX AI · Chest X-ray (Beta)", sub: "On-device chest X-ray interpretation · reload to apply", def: false, key: "smd_thorex" }) +
        toggle({ id: "sknx", title: "SknX AI · Dermatology (Beta)", sub: "Skin lesion / rash analysis · reload to apply", def: false, key: "smd_sknx" }) +
      '</div>' +

      '<div class="sbr-sec">Clinical Intelligence &amp; Skills</div>' +
      '<div class="sbr-card">' +
        toggle({ id: "clinix", title: "CliniX · Clinical learning (Beta)", sub: "Bedside skills for students · reload to apply", def: false, key: "smd_clinix" }) +
        toggle({ id: "clinixtutor", title: "MaiK Examiner (Beta)", sub: "AI review inside CliniX Viva, only when free keyword grade cannot judge", def: false, key: "smd_clinix_tutor" }) +
        toggle({ id: "surgx", title: "SURGX · Surgical Intelligence (Beta)", sub: "Notes, protocols, procedures, evidence, cases · reload to apply", def: true, key: "smd_surgx" }) +
        toggle({ id: "surgxdraft", title: "SURGX draft content", sub: "Show surgical content that is not yet clinician-approved", def: true, key: "smd_surgx_draft" }) +
      '</div>' +

      '<div class="sbr-sec">Voice &amp; Protocols</div>' +
      '<div class="sbr-card">' +
        toggle({ id: "whisper", title: "Clinical Dictation (Beta)", sub: "On-device Whisper voice→text · native app only", def: false, key: "smd_whisper_clinical_dictation" }) +
        toggle({ id: "oncoprotolib", title: "Oncology Protocol Library (Beta)", sub: "Draft standard protocol library in oncology workbench", def: true, key: "smd_onco_protolib" }) +
      '</div>' +

      '<div class="sbr-sec">Diagnostics</div>' +
      '<div class="sbr-card">' +
        toggle({ id: "maikperf", title: "Show AI response time", sub: "Diagnostics under each MaiK answer", def: false, key: "smd_maik_perf" }) +
      '</div>' +
      (devActive ? '<div class="sbr-dev-badge">⚡ Developer bypass active · access codes unlocked on debug build</div>' : '') +
      '<div class="sbr-note">Reload the app after changing feature flags to update navigation and home tiles.</div>';
  }

  function closeExperimentalPage() {
    var ov = document.getElementById("sbrExperimental");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    if (!document.getElementById("sbrSettings")) {
      document.body.classList.remove("sbr-set-open");
    }
  }

  function openExperimentalPage() {
    injectCSS();
    closeExperimentalPage();
    var ov = document.createElement("div");
    ov.id = "sbrExperimental";
    ov.className = "sbr-set-ov sbr-exp-ov";
    document.body.appendChild(ov);
    ov.innerHTML =
      '<header class="sbr-set-head"><button class="sbr-set-back" data-sexp="close" aria-label="Back"><span class="sbr-set-chev">‹</span><span>Settings</span></button><h2>Experimental</h2></header>' +
      '<div class="sbr-set-body">' +
        expBodyHTML() +
      '</div>';
    document.body.classList.add("sbr-set-open");

    try {
      if (window.SMD_XACCESS && SMD_XACCESS.onChange) {
        SMD_XACCESS.onChange(refreshExperimentalUI);
      }
    } catch (e) {}

    ov.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-sexp=close]")) {
        closeExperimentalPage();
        return;
      }
      var xaBtn = t.closest("[data-xa-open]");
      if (xaBtn) {
        var feat = xaBtn.getAttribute("data-xa-open");
        if (window.SMD_XACCESS && SMD_XACCESS.openGate) {
          SMD_XACCESS.openGate(feat, function () {
            refreshExperimentalUI();
          });
        } else {
          toast("Access code gate loading…");
        }
        return;
      }
      var sw = t.closest("[data-sbr-tg]");
      if (sw) {
        var id = sw.getAttribute("data-sbr-tg"), key = sw.getAttribute("data-sbr-key"), on = !sw.classList.contains("on");
        var isXa = (id === "fundx" || id === "kardiox" || id === "thorex" || id === "sknx");
        if (on && isXa && window.SMD_XACCESS && SMD_XACCESS.isActiveCached && !SMD_XACCESS.isActiveCached(id)) {
          if (window.SMD_XACCESS.openGate) {
            SMD_XACCESS.openGate(id, function () {
              setToggle(id, key, true);
              sw.classList.add("on");
              sw.setAttribute("aria-checked", "true");
              refreshExperimentalUI();
            });
            return;
          }
        }
        setToggle(id, key, on);
        sw.classList.toggle("on", on);
        sw.setAttribute("aria-checked", on);
        refreshExperimentalUI();
        return;
      }
    }, false);
  }

  function expSectionHTML() {
    return '<button class="sbr-row" data-sbr-act="experimental">' + svg("flask") +
      '<span class="sbr-lbl">Experimental Features</span>' +
      '<span class="sbr-badge sbr-badge-beta">BETA</span>' +
      '<span class="sbr-chev">▸</span></button>' +
      '<div class="sbr-card">' +
        toggle({ id: "clinix", title: "CliniX · Clinical learning (Beta)", sub: "Bedside skills for students · reload to apply", def: false, key: "smd_clinix" }) +
        toggle({ id: "surgx", title: "SURGX · Surgical Intelligence (Beta)", sub: "Notes, protocols, procedures, evidence · reload to apply", def: true, key: "smd_surgx" }) +
        toggle({ id: "fundx", title: "FundX AI · Retinal (Beta)", sub: "AI-guided fundus imaging · reload to apply", def: false, key: "smd_fundx" }) +
        toggle({ id: "kardiox", title: "KardiQ X AI · ECG (Beta)", sub: "On-device 12-lead ECG interpretation · reload to apply", def: false, key: "smd_kardiox" }) +
      '</div>' +
      '<div class="sbr-note">Private beta access codes &amp; all research modules in Experimental Features above.</div>';
  }

  // ---- Settings page (dedicated full-screen module) ------------------------------------------------
  // All app settings live here now (not inline toggles in the sidebar): account/verification,
  // notifications, appearance, wearable, and the advanced + experimental controls (engine, image
  // engine, voice models, offline DB, owner tools). Opened from the sidebar's single "Settings" row.
  function closeSettingsPage() {
    closeExperimentalPage();
    var ov = document.getElementById("sbrSettings");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    document.body.classList.remove("sbr-set-open");
  }

  function openSettingsPage() {
    injectCSS();
    closeSettingsPage();
    var ov = document.createElement("div"); ov.id = "sbrSettings"; ov.className = "sbr-set-ov"; document.body.appendChild(ov);
    ov.innerHTML =
      '<header class="sbr-set-head"><button class="sbr-set-back" data-sset="close" aria-label="Back"><span class="sbr-set-chev">‹</span><span>Back</span></button><h2>Settings</h2></header>' +
      '<div class="sbr-set-body">' +
        '<div class="sbr-sec">Account</div>' +
        row("profile", "steth", "Profile &amp; StewardMD ID") +
        '<button class="sbr-row" data-sbr-act="account" data-smd-verify="1">' + svg("shield") + '<span class="sbr-lbl">Account &amp; Verification</span></button>' +
        '<div class="sbr-sec">Preferences</div>' +
        row("notifications", "bell", "Notifications") +
        row("appearance", "sun", "Appearance &amp; Theme") +
        watchRow() +
        otaSectionHTML() +
        '<div class="sbr-sec">Advanced</div>' +
        advBody() +
        '<div class="sbr-sec">Experimental</div>' +
        expSectionHTML() +
      "</div>";
    document.body.classList.add("sbr-set-open");
    // let the Image Engine + Voice wire their controls inside the page (same seams as the old block)
    try { if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.wireSettings) SMD_IMAGE_ENGINE.wireSettings(ov.querySelector(".sbr-set-body")); } catch (e) {}
    try { if (window.SMD_VOICE && SMD_VOICE.wireModelSettings) SMD_VOICE.wireModelSettings(ov.querySelector(".sbr-set-body")); } catch (e) {}
    try { if (window.SMD_MAIK_ENGINE && SMD_MAIK_ENGINE.wireSettings) SMD_MAIK_ENGINE.wireSettings(ov.querySelector(".sbr-set-body")); } catch (e) {}
    try { wireOtaSection(ov.querySelector(".sbr-set-body")); } catch (e) {}
    ov.addEventListener("click", function (e) {
      var t = e.target; if (!t || !t.closest) return;
      if (t.closest("[data-sset=close]")) { closeSettingsPage(); return; }
      var sw = t.closest("[data-sbr-tg]");
      if (sw) {
        var id = sw.getAttribute("data-sbr-tg"), key = sw.getAttribute("data-sbr-key"), on = !sw.classList.contains("on");
        var isXa = (id === "fundx" || id === "kardiox" || id === "thorex" || id === "sknx");
        if (on && isXa && window.SMD_XACCESS && SMD_XACCESS.isActiveCached && !SMD_XACCESS.isActiveCached(id)) {
          if (window.SMD_XACCESS.openGate) {
            SMD_XACCESS.openGate(id, function () {
              setToggle(id, key, true);
              sw.classList.add("on");
              sw.setAttribute("aria-checked", "true");
            });
            return;
          }
        }
        setToggle(id, key, on);
        sw.classList.toggle("on", on);
        sw.setAttribute("aria-checked", on);
        return;
      }
      var r = t.closest("[data-sbr-act]");
      if (r) {
        var a = r.getAttribute("data-sbr-act");
        if (a === "settings") return;
        if (a === "experimental") { openExperimentalPage(); return; }
        closeSettingsPage();
        setTimeout(function () { try { ACT[a] && ACT[a](); } catch (x) {} }, 60);
      }
    }, false);
  }
  try {
    if (typeof window !== "undefined") {
      window.SMD_openSettings = openSettingsPage;
      window.SMD_openExperimental = openExperimentalPage;
    }
  } catch (e) {}

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
