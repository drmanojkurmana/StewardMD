/* StewardMD — premium home (v2). DEFAULT UI as of gold25.
   Advanced UI by MaiK is on for everyone by default. Users can switch to
   Classic from Settings / the sidebar (persists as smd_home_v2="0"), or via
   ?home=classic. ?home=v2 forces it back on. Presentation layer only: every
   control delegates to the existing global functions. Nothing is removed.
   To roll back to Classic-default, revert this commit (restore the "==='1'"
   gate); the classic-ui-stable backup is independent and untouched. */
(function () {
  "use strict";

  // ── FundX AI · dev-build auto-enable ─────────────────────────────────────
  // On DEBUG native builds (Xcode / adb installs — dev phones) default the FundX
  // master flag ON so a fresh install launches straight into it. RELEASE builds
  // (App Store / Play) report debug=false → FundX stays OFF until clinical
  // validation. The native plugin's capabilities() reports the build type; on the
  // very first launch we set the flag once and reload so home.js + fundx.js read it
  // synchronously on the next paint (both gate the tile/module at load time). The
  // null-check respects an explicit user choice ("0"/"1") and prevents any reload loop.
  (function () {
    try {
      if (localStorage.getItem("smd_fundx") !== null) return;         // already decided (incl. user-off)
      if (/[?&]fundx=/.test(location.search)) return;                 // explicit ?fundx= wins
      var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FundxDepth;
      if (!P || !P.capabilities) return;                              // not a native build → leave OFF
      P.capabilities().then(function (c) {
        if (c && c.debug && localStorage.getItem("smd_fundx") === null) {
          try { localStorage.setItem("smd_fundx", "1"); } catch (e) { return; }
          try { location.reload(); } catch (e) {}                     // one-time; next load reads the flag
        }
      }, function () {});
    } catch (e) {}
  })();

  function flagged() { return true; }  // Classic UI removed — Advanced (by MaiK) is the only UI.
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
    // A collapsible-group child row (matches app.js .sb-subitem markup); `mark` tags it for idempotent strip/skip.
    function subItem(icon, label, onclick, mark) {
      var b = document.createElement("button"); b.className = "sb-subitem"; if (mark) b.setAttribute(mark, "1");
      b.innerHTML = '<span class="ic">' + icon + '</span><span>' + label + '</span>';
      b.addEventListener("click", function () { try { if (window.SB && SB.close) SB.close(); } catch (e) {} setTimeout(onclick, 60); });
      return b;
    }
    function reorganize() {
      var menu = document.getElementById("sbMenu"); if (!menu) return;
      // The lean sidebar redesign (sidebar-redesign.js) owns #sbMenu when loaded; keep the
      // harmless ICU-dashboard reroute below but skip the legacy grouped rebuild it replaces.
      if (window.SMD_SBR) { try { if (window.INF && window.ICU && ICU.open && INF.openDashboard !== ICU.open) INF.openDashboard = ICU.open; } catch (e) {} return; }
      injectCSS();
      // Retire the OLD ICU dashboard: route every INF.openDashboard() caller (base sidebar
      // "ICU Dashboard" item, legacy links) to the NEW flagship ICU.open(). The new dashboard
      // already integrates infusion + electrolyte, so the old one is redundant. Safe: icu.js
      // never calls INF.openDashboard, so no recursion. Idempotent.
      try { if (window.INF && window.ICU && ICU.open && INF.openDashboard !== ICU.open) INF.openDashboard = ICU.open; } catch (e) {}
      // 0) strip any legacy appended blocks (older builds / re-open) — idempotent
      ["[data-smd-ui]", "[data-smd-labs]", "[data-ghis-menu]", "[data-smd-nav]", "[data-smd-top]"].forEach(function (sel) { menu.querySelectorAll(sel).forEach(function (e) { e.remove(); }); });

      // 1) Collapse the flat top of the menu into grouped navigation:
      //    - Remove the two standalone top links: "Clinical Reasoning" (Dx My Patient replaces it)
      //      and "Drugs Database" (moves inside the Clinical group).
      //    - Pin three quick-links at the very top: Dx My Patient, Ward Sync, ICU Dashboard.
      var links = Array.prototype.slice.call(menu.querySelectorAll(".sb-main-link"));
      var crLink = links.filter(function (b) { return /Clinical Reasoning/i.test(b.textContent); })[0];
      var drugLink = links.filter(function (b) { return /Drugs Database/i.test(b.textContent); })[0];
      if (crLink) crLink.remove();
      if (drugLink) drugLink.remove();
      var topFrag = document.createDocumentFragment();
      topFrag.appendChild(topBtn(svg("brain", "smd-ico"), "Dx My Patient", false, function () { try { openDxChooser(); } catch (e) {} }));
      topFrag.appendChild(topBtn(svg("hospital", "smd-ico"), "Ward Sync", false, function () { try { if (window.openGHIS) openGHIS(); else toast("Ward Sync loading…"); } catch (e) {} }));
      topFrag.appendChild(topBtn(svg("pulse", "smd-ico"), "ICU Dashboard", false, function () { try { if (window.ICU && ICU.open) ICU.open(); else if (window.INF) INF.openDashboard(); else toast("ICU loading…"); } catch (e) {} }));
      menu.insertBefore(topFrag, menu.firstChild);

      // 1b) Clinical group (sbsub_clinical): fold Dx My Patient + Drugs Database in; drop the
      //     redundant "New clinical decision" (Dx My Patient / Start a Case cover it).
      var clin = document.getElementById("sbsub_clinical");
      if (clin && !clin.querySelector("[data-smd-sub]")) {
        clin.querySelectorAll(".sb-subitem").forEach(function (b) { if (/New clinical decision/i.test(b.textContent)) b.style.display = "none"; });
        var cf = document.createDocumentFragment();
        cf.appendChild(subItem(svg("brain", "smd-ico"), "Dx My Patient", function () { try { openDxChooser(); } catch (e) {} }, "data-smd-sub"));
        cf.appendChild(subItem(svg("pills", "smd-ico"), "Drugs Database", function () { try { if (window.MEDDB) MEDDB.openList(); else toast("Drugs loading…"); } catch (e) {} }, "data-smd-sub"));
        clin.insertBefore(cf, clin.firstChild);
      }

      // 1c) Drop the redundant per-category calculator shortcuts (Browse-all covers them).
      ["Cardiovascular", "Critical care & sepsis", "Renal & electrolytes", "Neurology & stroke"].forEach(function (t) {
        var b = Array.prototype.slice.call(menu.querySelectorAll(".sb-subitem, .sb-main-link")).filter(function (x) { return x.textContent.replace(/\s+/g, " ").indexOf(t) >= 0; })[0];
        if (b) b.style.display = "none";
      });

      // 2) Advanced controls INTO Settings (#sbsub_set) as collapsible subgroups
      var setBody = document.getElementById("sbsub_set");
      if (setBody && !setBody.querySelector("[data-smd-adv]")) {
        var engineBody = swRow("reason", "Reasoning v2", "Live differential in the workflow", flag("smd_reason_v2", true)) +
          swRow("expanded", "Expanded Harrison KB", "+268 reference diseases as candidates", flag("smd_kb_expanded", false)) +
          swRow("safety", "Organ-safety overlay", "Renal / hepatic / QT flags on antibiotic advice", flag("smd_safety_overlay", true)) +
          '<div class="smd-nav-note">' + svg("flask", "smd-ico") + ' Experimental — for clinician review.</div>';
        var aiBody = swRow("ai", "MaiK — Medical AI Knowledge", "Grounded clinical knowledge assistant", flag("smd_ai", false)) +
          swRow("maikperf", "Show AI response time", "Prints MaiK first-token + full-answer time under each answer (diagnostics)", flag("smd_maik_perf", false)) +
          '<div class="smd-nav-note">AI advisory — clinician confirmation required.</div>';
        var wardBody = swRow("ghis", "GHIS Ward Sync", "Live inpatient labs & radiology", flag("smd_ghis_ward", true)) +
          (window.SMD_IS_NATIVE ? swRow("autofetch", "Auto-fetch reports", "Keep a linked patient's labs/imaging fresh on launch & resume · GHIS login stored on THIS device only (Keychain/Keystore), per-patient consent · turn on/off per patient from the Ward Sync bar", flag("smd_autofetch", true)) : "") +
          '<button class="smd-nav-btn" data-open-ghis="1">' + svg("hospital", "smd-ico") + ' Open Ward Sync</button>';
        var toolsBody = swRow("whisper", "Clinical Dictation (Beta)", "On-device Whisper voice→text in MaiK Scribe · native app only (model downloads on first use)", flag("smd_whisper_clinical_dictation", false)) +
          ((window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.settingsHTML)
            ? '<div class="smd-nav-row" style="display:block"><div class="smd-nav-lbl" style="margin-bottom:6px">Image Engine</div>' + SMD_IMAGE_ENGINE.settingsHTML() + '</div>'
            : "");
        // Experimental Access — the primary "Settings → Experimental Features → FundX AI" entry.
        // Reusable: future beta features (ECG AI, etc.) add a button here. The gate (experimental.js)
        // enforces the one-code/one-device access server-side; this is just discovery.
        var xaActive = false; try { xaActive = !!(window.SMD_XACCESS && SMD_XACCESS.isActiveCached && SMD_XACCESS.isActiveCached("fundx")); } catch (e) {}
        var kxActive = false; try { kxActive = !!(window.SMD_XACCESS && SMD_XACCESS.isActiveCached && SMD_XACCESS.isActiveCached("kardiox")); } catch (e) {}
        var xaBody = '<div class="smd-nav-note">Private beta — unlock with an access code from the StewardMD team. One code activates one device.</div>' +
          '<button class="smd-nav-btn' + (xaActive ? ' on' : '') + '" data-xa-open="fundx">' + (xaActive ? '🟢 FundX AI — enabled' : '🔬 FundX AI — enter access code') + '</button>' +
          '<button class="smd-nav-btn' + (kxActive ? ' on' : '') + '" data-xa-open="kardiox">' + (kxActive ? '🟢 KardioX AI — enabled' : '🫀 KardioX AI — enter access code') + '</button>';
        setBody.insertAdjacentHTML("beforeend",
          group("engine", "Clinical Engine (Advanced)", engineBody, false) +
          (toolsBody ? group("tools", "Clinical Tools", toolsBody, false) : "") +
          group("ai", "AI Assistant", aiBody, false) +
          group("beta", "Experimental Features", xaBody, false) +
          group("ward", "Ward Integration", wardBody, false));
        try { if (window.SMD_IMAGE_ENGINE && SMD_IMAGE_ENGINE.wireSettings) SMD_IMAGE_ENGINE.wireSettings(setBody); } catch (e) {}
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
              else if (k === "safety" && window.SMD_SAFETY) SMD_SAFETY.setFlag(nv);
              else if (k === "expanded" && window.SMD_setKbExpanded) SMD_setKbExpanded(nv);
              else if (k === "ai" && window.SMD_AI) SMD_AI.setFlag(nv);
              else if (k === "ghis" && window.SMD_setGhis) SMD_setGhis(nv);
              else if (k === "autofetch") {
                localStorage.setItem("smd_autofetch", nv ? "1" : "0");
                // Turning the MASTER switch off also stops it working for every patient, but a
                // patient's individual enable + saved device credential are left alone (so
                // re-enabling here resumes exactly where they left off — no need to re-consent).
                if (!nv) { try { toast("Auto-fetch off. Per-patient settings are kept — turn this back on to resume."); } catch (e) {} }
              }
              else if (k === "whisper") { localStorage.setItem("smd_whisper_clinical_dictation", nv ? "1" : "0"); }
              else if (k === "maikperf") { localStorage.setItem("smd_maik_perf", nv ? "1" : "0"); }
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
        setBody.querySelectorAll("[data-xa-open]").forEach(function (xb) {
          xb.addEventListener("click", function () {
            var feat = xb.getAttribute("data-xa-open");
            try { if (window.SB && SB.close) SB.close(); } catch (e) {}
            setTimeout(function () {
              function openFeat() {
                if (feat === "kardiox") {
                  try { localStorage.setItem("smd_kardiox", "1"); } catch (e) {}
                  if (window.KARDIOX && KARDIOX.open) KARDIOX.open(); else toast("KardioX AI loading…");
                  return;
                }
                try { localStorage.setItem("smd_fundx", "1"); } catch (e) {}
                if (window.FUNDX && FUNDX.open) FUNDX.open(); else toast("FundX AI loading…");
              }
              try { if (window.SMD_XACCESS && SMD_XACCESS.openGate) { SMD_XACCESS.openGate(feat, openFeat); return; } } catch (e) {}
              openFeat();
            }, 60);
          });
        });
      }

      // 3) Merge "About & Help" INTO "Reference" -> one "Reference & Help" group. Move the About
      //    children across, hide the About header/body, add Acknowledgements + the App-tour replay.
      var refBody = document.getElementById("sbsub_ref");
      var refHead = document.getElementById("sbmain_ref");
      var aboutBody = document.getElementById("sbsub_about");
      var aboutHead = document.getElementById("sbmain_about");
      if (refBody && aboutBody && refHead && !refBody.querySelector("[data-smd-merged]")) {
        var marker = document.createElement("span"); marker.setAttribute("data-smd-merged", "1"); marker.style.display = "none"; refBody.appendChild(marker);
        // Acknowledgements (was previously injected into About)
        refBody.appendChild(subItem("★", "Acknowledgements & Contributors", function () { try { openAck(); } catch (e) {} }, "data-smd-sub"));
        // Bring every About & Help child into the Reference group
        Array.prototype.slice.call(aboutBody.children).forEach(function (c) { refBody.appendChild(c); });
        if (aboutHead) aboutHead.style.display = "none";
        aboutBody.style.display = "none";
        // App tour — replay the guided onboarding
        refBody.appendChild(subItem(svg("info", "smd-ico"), "App tour", function () { try { if (window.SMD_TOUR) SMD_TOUR.start({ replay: true }); else toast("Tour loading…"); } catch (e) {} }, "data-smd-sub"));
        // Rename the Reference header to "Reference & Help"
        var hs = refHead.querySelectorAll("span");
        for (var k = 0; k < hs.length; k++) { if (!hs[k].classList.contains("ic") && !hs[k].classList.contains("chev")) { hs[k].textContent = "Reference & Help"; break; } }
      }
    }
    try { if (window.SB && typeof SB.open === "function") { var orig = SB.open; SB.open = function () { var r = orig.apply(this, arguments); setTimeout(function () { reorganize(); try { if (redesignNavOn()) iconifyEmoji(document.getElementById("sbDrawer")); } catch (e) {} }, 40); return r; }; } } catch (e) {}
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
    ward: '<path d="M4 21V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v15"/><path d="M2 21h20"/><path d="M10 21v-4h4v4"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="9.5" y1="10.5" x2="14.5" y2="10.5"/>',
    syndromes: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3.2A1.2 1.2 0 0 1 10.2 2h3.6A1.2 1.2 0 0 1 15 3.2V4"/><line x1="8.5" y1="9" x2="15.5" y2="9"/><line x1="8.5" y1="12.5" x2="15.5" y2="12.5"/><line x1="8.5" y1="16" x2="12.5" y2="16"/>',
    ai: '<path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/><path d="M5 15l.7 1.9L8 18l-2.3.6L5 21l-.7-1.9L2 18l2.3-.6Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
    reasoning: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sliders: '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.4" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="2.4" fill="currentColor" stroke="none"/>',
    folder: '<path d="M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/>',
    book: '<path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/>',
    calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8.01" y2="11"/><line x1="12" y1="11" x2="12.01" y2="11"/><line x1="16" y1="11" x2="16.01" y2="11"/><line x1="8" y1="16" x2="8.01" y2="16"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
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
    award: '<circle cx="12" cy="8" r="6"/><path d="M8.2 13 7 22l5-3 5 3-1.2-9"/>',
    antibiogram: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/>',
    interact: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
    // ── ICU-flagship line icons (PART 1). 24×24, currentColor, ~1.75 stroke; consistent with the above.
    heart: '<path d="M12 21s-7-4.5-9.3-8.9A5 5 0 0 1 12 6.2 5 5 0 0 1 21.3 12C19 16.5 12 21 12 21Z"/>',
    pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    hemo: '<path d="M3 12h3l1.6-3.5L11 16l2-4 1 2h4"/><path d="M12 20.5C9 18.6 4.5 15.3 3.3 11"/><path d="M20.7 11A5 5 0 0 0 12 7.4"/>',
    droplet: '<path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z"/>',
    abg: '<path d="M12 3s5.5 6 5.5 10.5a5.5 5.5 0 0 1-11 0C6.5 9 12 3 12 3Z"/><line x1="12" y1="10.5" x2="12" y2="16"/><line x1="9.25" y1="13.25" x2="14.75" y2="13.25"/>',
    syringe: '<path d="M18 2l4 4"/><path d="M15 5l4 4"/><path d="M16 6 5 17l-2 4 4-2L18 8"/><path d="M9 12l3 3"/>',
    siren: '<path d="M7 18a5 5 0 0 1 10 0"/><rect x="4" y="18" width="16" height="3" rx="1"/><line x1="12" y1="6" x2="12" y2="3"/><line x1="6.5" y1="8" x2="4.8" y2="6.3"/><line x1="17.5" y1="8" x2="19.2" y2="6.3"/>',
    lungs: '<path d="M12 4v9"/><path d="M12 8c-1-2-3.2-2.4-4.6-1.3C6 8 5 10.2 5 13.2A2.9 2.9 0 0 0 10.8 14"/><path d="M12 8c1-2 3.2-2.4 4.6-1.3C18 8 19 10.2 19 13.2A2.9 2.9 0 0 1 13.2 14"/>',
    trend: '<path d="M3 3v18h18"/><path d="m7 14 3-4 3 3 5-7"/>',
    rounds: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="m9 13 2 2 4-4"/>',
    camera: '<path d="M4 8a2 2 0 0 1 2-2h1.6l1-2h6.8l1 2H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.4"/>',
    snapshot: '<path d="M3 7V6a2 2 0 0 1 2-2h1"/><path d="M18 4h1a2 2 0 0 1 2 2v1"/><path d="M21 17v1a2 2 0 0 1-2 2h-1"/><path d="M6 20H5a2 2 0 0 1-2-2v-1"/><circle cx="12" cy="12" r="3.4"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/>',
    upload: '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
    hospital: '<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="12" y1="6.5" x2="12" y2="11.5"/><line x1="9.5" y1="9" x2="14.5" y2="9"/><path d="M9 21v-3.5h6V21"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    close: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    save: '<path d="M5 4h11l3 3v13H5Z"/><path d="M8 4v5h7"/><rect x="8" y="13" width="8" height="5"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>',
    list: '<line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    warn: '<path d="M12 3 1.7 21h20.6L12 3Z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.6" r=".6"/>',
    // ── Specialty line-icons (calculators / knowledge-library categories). Same 24×24,
    // currentColor, ~1.75 stroke. One per specialty; each calculator inherits its category icon.
    microbe: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3.3v-1M12 21.7v-1M3.3 12h-1M21.7 12h-1M6.3 6.3l-.8-.8M18.5 18.5l-.8-.8M17.7 6.3l.8-.8M5.5 18.5l.8-.8"/><circle cx="10.3" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="13.7" cy="13.4" r="1" fill="currentColor" stroke="none"/>',
    kidney: '<path d="M13.8 4C9.5 4 6 7.6 6 12s3.5 8 7.8 8c2.4 0 4.2-1.9 4.2-4 0-1.6-1-2.4-1-4s1-2.4 1-4c0-2.1-1.8-4-4.2-4Z"/><path d="M18 12h-2"/>',
    liver: '<path d="M3.5 7.5c5-2.2 12-2.2 17 0-.2 4.3-1.4 8.2-5.5 10.2-2 1-4.5 1-6.5 0-3.3-1.7-4.6-5.6-5-10.2Z"/><path d="M15 9c-1.2.8-3 .9-4.3.2"/>',
    brain: '<path d="M12 4.6a3 3 0 0 0-5 1.6A2.8 2.8 0 0 0 4.6 11a2.8 2.8 0 0 0 1 4.6A2.6 2.6 0 0 0 9 19a2.6 2.6 0 0 0 3 .6"/><path d="M12 4.6a3 3 0 0 1 5 1.6A2.8 2.8 0 0 1 19.4 11a2.8 2.8 0 0 1-1 4.6A2.6 2.6 0 0 1 15 19a2.6 2.6 0 0 1-3 .6"/><path d="M12 5v14"/>',
    endocrine: '<path d="M12 9c-1.4-2.2-3.8-3-5.6-2.1S4.2 10.4 5 12.6s3.2 2.9 5 1.8C11 13.7 12 11.4 12 9Z"/><path d="M12 9c1.4-2.2 3.8-3 5.6-2.1s2.2 3.5 1.4 5.7-3.2 2.9-5 1.8C13 13.7 12 11.4 12 9Z"/><path d="M12 9v3.5"/>',
    stomach: '<path d="M8.5 3v3.5c0 1.6-1 2.4-2 3.4a5.5 5.5 0 0 0 4 9.1c3 0 5.5-2.3 5.9-5.3.2-1.6.9-2.4 2.1-2.7a2 2 0 0 0-.5-3.9c-2.6 0-3.4 2-5.1 2S12 9.9 12 6.5V3"/>',
    ribbon: '<path d="M12 12 8 21l2.6-1.2L12 22l1.4-2.2L16 21Z"/><path d="M12 12c-2.2-1.3-3.7-3.6-3.7-6.2A3.7 3.7 0 0 1 12 2a3.7 3.7 0 0 1 3.7 3.8c0 2.6-1.5 4.9-3.7 6.2Z"/>',
    joint: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M10 10l4 4"/>',
    bone: '<path d="M8 16 16 8"/><path d="M8 16a2.2 2.2 0 1 1-1.2-2 2.2 2.2 0 1 1 2-1.2"/><path d="M16 8a2.2 2.2 0 1 0 1.2 2 2.2 2.2 0 1 0-2-1.2"/>',
    skin: '<rect x="3.5" y="9.5" width="17" height="5" rx="2.5" transform="rotate(-40 12 12)"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9.6" cy="9.6" r=".6" fill="currentColor" stroke="none"/><circle cx="14.4" cy="14.4" r=".6" fill="currentColor" stroke="none"/>',
    psych: '<path d="M6 20v-2.5C4.8 16.3 4 14.3 4 12a8 8 0 1 1 16 0c0 2.3-.8 4.3-2 5.5V20"/><circle cx="9.5" cy="11.5" r="1"/><path d="M12.5 10a2 2 0 1 1 1.8 3"/>',
    baby: '<circle cx="12" cy="7" r="3.2"/><path d="M6 20a6 6 0 0 1 12 0"/><circle cx="10.8" cy="6.7" r=".5" fill="currentColor" stroke="none"/><circle cx="13.2" cy="6.7" r=".5" fill="currentColor" stroke="none"/><path d="M10.9 8.5a2 2 0 0 0 2.2 0"/>',
    pregnant: '<circle cx="11" cy="4.2" r="2"/><path d="M11 6.5c-1 0-2 .8-2 2v3.5"/><path d="M9 12c0 3.3 1.5 5.5 4.2 5.5A3.8 3.8 0 0 0 17 13.7c0-2.6-2-4.6-4.5-4.7"/><path d="M9 12v8"/>',
    eye: '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/>',
    skull: '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.3 2.8 5.4v2.3a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1v-2.3c1.5-1.1 2.8-2.8 2.8-5.4A7.5 7.5 0 0 0 12 3Z"/><circle cx="9" cy="11" r="1.5"/><circle cx="15" cy="11" r="1.5"/><path d="M12 14v2M10 19.2v-2M14 19.2v-2"/>',
    scales: '<path d="M12 3v18M8 21h8"/><path d="M5 7h14"/><path d="M5 7 2.5 13a3 3 0 0 0 5 0Z"/><path d="M19 7l-2.5 6a3 3 0 0 0 5 0Z"/>',
    // ── UI line-icons
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.3-9 6 6 0 0 1 11.5-.5A4 4 0 0 1 17.5 18Z"/>',
    note: '<path d="M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/>',
    aware: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.6"/>',
    print: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M6 15h12v6H6z"/><circle cx="17.5" cy="12" r=".8" fill="currentColor" stroke="none"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".6" fill="currentColor" stroke="none"/>',
    link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5"/>',
    clear: '<path d="M8 20H5a2 2 0 0 1-1.4-3.4L14 6a2 2 0 0 1 2.8 0L21 10.2a2 2 0 0 1 0 2.8L13 21H8Z"/><path d="M13 21H8l-3.6-3.6"/><path d="M9 11l4 4"/>',
    xray: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 7a3 3 0 0 0-2 5c0 1.6 2 2 2 4M12 7a3 3 0 0 1 2 5c0 1.6-2 2-2 4"/><path d="M8 11h8M8.5 14h7"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-6Z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.9 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.9-3.8-9S9.5 5.6 12 3Z"/>',
    bug: '<path d="M8 8a4 4 0 0 1 8 0v3a4 4 0 0 1-8 0Z"/><path d="M9 7 7.5 5.5M15 7l1.5-1.5"/><path d="M4 11h4M16 11h4M4 16h4M16 16h4M12 12v9"/><path d="M4.5 20 8 18M19.5 20 16 18"/>',
    thumbUp: '<path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"/><path d="M7 11l4-7a2 2 0 0 1 3.8 1v3.5h4.2a2 2 0 0 1 2 2.4l-1.3 6A2 2 0 0 1 17.7 20H7"/>',
    thumbDown: '<path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1Z"/><path d="M17 13l-4 7a2 2 0 0 1-3.8-1v-3.5H5a2 2 0 0 1-2-2.4l1.3-6A2 2 0 0 1 6.3 4H17"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    play: '<path d="M7 4.5v15l13-7.5Z"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16a3 3 0 0 1 6 0"/><path d="M14 10h4M14 13h4"/>',
    device: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><line x1="10.5" y1="18" x2="13.5" y2="18"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    hourglass: '<path d="M6 3h12M6 21h12"/><path d="M7 3c0 4.5 4 5.5 5 9-1 3.5-5 4.5-5 9M17 3c0 4.5-4 5.5-5 9 1 3.5 5 4.5 5 9"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'
  };
  function svg(name, cls) { return '<svg viewBox="0 0 24 24" class="' + (cls || "") + '">' + (ICON[name] || "") + '</svg>'; }
  // Shared icon accessor so icu.js / antibiogram.js / sheets use ONE catalog (no emojis, no dup SVG).
  // Callers should guard (window.ICONS && ICONS.get(...)) with a text fallback for load-order safety.
  try {
    window.ICONS = { get: function (name, cls) { return svg(name, cls || "smd-ico"); }, has: function (name) { return !!ICON[name]; }, names: function () { return Object.keys(ICON); } };
    window.icon = function (name, cls) { return svg(name, cls || "smd-ico"); };
  } catch (e) {}
  function call(fn) { try { fn(); } catch (e) { console.warn("home action failed", e); } }
  function has(path) { try { return !!path(); } catch (e) { return false; } }

  var root, fab;
  function hideV2() { if (root) root.classList.remove("on"); if (fab) fab.classList.add("on"); try { if (window.SB && SB.closeRef) SB.closeRef(); } catch (e) {}
    // Classic engine screen is now visible → swap its header emoji to Material Symbols.
    try { if (redesignNavOn()) { iconifyEmoji(document.querySelector(".app-head")); [400, 1200].forEach(function (d) { setTimeout(function () { try { iconifyEmoji(document.querySelector(".app-head")); } catch (e) {} }, d); }); } } catch (e) {} }
  // Exposed so the Clinical Reasoning "Select this diagnosis" flow can reveal the classic
  // stewardship output (#outputArea) instead of leaving it hidden behind the v4 Home.
  window.SMD_hideHome = hideV2;
  function showV2() { if (root) root.classList.add("on"); if (fab) fab.classList.remove("on"); var m = root && root.querySelector(".v3-main"); if (m) m.scrollTop = 0; try { if (root && root.classList.contains("rnav") && typeof hydrateRnav === "function") hydrateRnav(); } catch (e) {} }
  // Universal "go home" — closes any open overlay/sheet and returns to the v3 home. Wired to the
  // logo (anywhere) and the home FAB, so the user can get home from any area.
  function goHome() {
    // 1) Close every module via its own API (resets internal state + restores body scroll).
    var apis = [
      window.DX && window.DX.close, window.ELYTE && window.ELYTE.close,
      window.MEDCALC && window.MEDCALC.close, window.INF && window.INF.close,
      window.MEDDB && window.MEDDB.close, window.SB && window.SB.closeRef,
      window.SB && window.SB.close, window.ABG && window.ABG.close,
      window.closeCalc, window.closeMyCases, window.closeSearch
    ];
    apis.forEach(function (fn) { try { if (typeof fn === "function") fn(); } catch (e) {} });
    try { closeSheet(); } catch (e) {}
    try { if (window.closeDrawer) window.closeDrawer(); } catch (e) {}
    // 2) Backstop — force-hide EVERY overlay/drawer/modal so nothing keeps running underneath.
    //    open-class overlays: just remove their show-class (do NOT add .hidden, or they can't reopen).
    ["aspOverlay", "csOverlay", "eceOverlay", "infOverlay", "mcOverlay", "mdOverlay", "dxOverlay", "dbOverlay",
      "myCasesPanel", "smdSearchPanel", "sbrefOverlay", "dbDrawer", "dbScrim", "sbDrawer", "sbBackdrop",
      "abgOverlay", "hvSheet", "hvScrim", "swShell", "swSheet", "swScrim"].forEach(function (id) {
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
  // Exposed so the Specialty Workspaces branch selector can return the user Home after picking a branch.
  window.SMD_goHome = goHome;
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
    bar.innerHTML = '<button type="button" data-cs="share">' + svg("share", "smd-ico") + ' Share case</button>'
                  + '<button type="button" data-cs="pdf">' + svg("print", "smd-ico") + ' Save as PDF</button>';
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
      // Native: window.print() is a no-op in WKWebView — export the FULL expanded
      // decision (cloned output + full differential) as a styled page FILE, then open
      // the iOS share sheet, which offers Print → Save as PDF / Save to Files. Web keeps
      // real window.print() below.
      if (window.SMD_IS_NATIVE && window.SMD_NATIVE && window.SMD_NATIVE.saveHtmlFile) {
        try {
          var nclone = out.cloneNode(true);
          var nbar = nclone.querySelector("#smdCaseShare"); if (nbar) nbar.remove();
          var nfrag = nclone.innerHTML;
          try { var ndh = caseDifferentialHTML(); if (ndh) nfrag += ndh; } catch (e) {}
          window.SMD_NATIVE.saveHtmlFile(nfrag, "StewardMD — Clinical decision", "StewardMD-clinical-decision").catch(function () { toast("Save unavailable"); });
        } catch (e) { window.SMD_NATIVE.exportPdf(caseText(), "StewardMD — Clinical decision").catch(function () { toast("Save unavailable"); }); }
        return;
      }
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

  // Start a Case -> open the engine DIRECTLY (the Simple/Advanced interstitial
  // "gate" is removed). Advanced is the default; the Simple/Advanced toggle lives
  // in the engine header, so users can still switch modes anytime.
  function openCaseChooser() {
    // A specialty workspace (e.g. Surgery) still starts the case in THAT engine.
    try { if (window.SMD_WS && SMD_WS.startActiveCase && SMD_WS.startActiveCase()) return; } catch (e) {}
    hideV2();
    var card = document.getElementById("modeAdvancedCard");
    if (card) { card.click(); return; }
    var ms = document.getElementById("modeSelect"); if (ms) ms.classList.remove("hidden");
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
    drugmenu: function () {
      openSheet('<div class="hv-sh-t">Drugs &amp; Interactions</div>' +
        mi("pills", "Drug Database", "Brands · doses · spectrum · cautions", "db") +
        mi("interact", "Interaction Checker", "Check drug–drug interactions", "ix"));
      sheetEl().querySelectorAll("[data-mi]").forEach(function (b) {
        b.addEventListener("click", function () {
          var a = b.getAttribute("data-mi"); closeSheet();
          setTimeout(function () { if (a === "ix") ACT.interactions(); else ACT.drugs(); }, 70);
        });
      });
    },
    electrolytes: function () { if (window.ELYTE && ELYTE.open) ELYTE.open(); else toast("Electrolyte engine loading…"); },
    interactions: function () { if (window.MEDDRUGS && MEDDRUGS.openInteractions) MEDDRUGS.openInteractions(); else toast("Drug interactions loading…"); },
    framework: function () { if (window.SB && SB.openRef) SB.openRef("guidelines"); else toast("Framework"); },
    icu: function () { if (window.ICU && ICU.open) ICU.open(); else if (window.INF && INF.openDashboard) INF.openDashboard(); else if (window.INF && INF.open) INF.open(); else toast("ICU loading…"); },
    ward: function () { if (window.openGHIS) window.openGHIS(); else if (window.GHIS && GHIS.open) GHIS.open(); else toast("Ward Sync loading…"); },
    syndromes: function () { if (window.SB && SB.openRef) SB.openRef("syndromes"); else if (window.SB && SB.openSyn) SB.openSyn(); else if (window.ASP && ASP.open) ASP.open(); else toast("Syndromes loading…"); },
    askai: function () { openAskAi(); },
    antibiogram: function () { if (window.ABG && ABG.open) ABG.open(); else toast("Antibiogram loading…"); },
    theme: function () { if (window.SB && SB.toggleTheme) SB.toggleTheme(); else document.body.classList.toggle("dark"); },
    menu: function () { if (window.SB && SB.open) SB.open(); },
    about: function () { if (window.SB && SB.modal) SB.modal("aboutModal"); else if (typeof openModal === "function") openModal("aboutModal"); },
    account: function () { if (window.SB && SB.open) SB.open(); },
    recent: function () { if (typeof openMyCases === "function") openMyCases(); },
    dictate: function () { if (window.SMD_VOICE && SMD_VOICE.openDialog) SMD_VOICE.openDialog({ target: "text" }); else toast("Voice dictation loading…"); },
    retinalscan: function () {
      // FundX is gated by the Experimental Access framework (one code = one device, server-verified).
      // Debug builds + a valid activation open it directly; otherwise the access gate is shown. If the
      // framework failed to load, fall back to opening directly so the tile is never bricked.
      function openFundx() { try { localStorage.setItem("smd_fundx", "1"); } catch (e) {} if (window.FUNDX && FUNDX.open) FUNDX.open(); else toast("FundX AI loading…"); }
      try { if (window.SMD_XACCESS && SMD_XACCESS.gate) { SMD_XACCESS.gate("fundx", openFundx); return; } } catch (e) {}
      openFundx();
    }
  };
  // --- Resume where you left off. iOS suspends a backgrounded app and, under memory pressure,
  //     TERMINATES it after a while; the next launch is a COLD START — the WebView reloads index.html
  //     and lands on Home, losing the screen the user was on (e.g. an ICU patient). There is no true
  //     background execution on iOS for a WebView app. So: snapshot the currently-open overlay when the
  //     app backgrounds, and reopen it on the next launch IF it's recent — so the user returns where they
  //     were. Purely local + defensive; worst case it does nothing and Home shows (today's behaviour). ---
  var RESUME_KEY = "smd_resume_route";
  var RESUME_MAX_MS = 12 * 3600 * 1000;   // resume only within ~a shift; a genuinely fresh open still shows Home
  // Ordered by z-index (ICU/Ward dashboard is topmost → matched first). Each maps an overlay's open
  // marker to the ACT that reopens it.
  var RESUME_ROUTES = [
    { sel: "#icuRoot.on", act: "icu" },
    { sel: "#ghisPanel.open", act: "ward" },
    { sel: "#mcOverlay.on", act: "calculators" },
    { sel: "#mdOverlay.on", act: "drugs" },
    { sel: "#miOverlay.on", act: "interactions" },
    { sel: "#abgOverlay.on", act: "antibiogram" },
    { sel: "#eceOverlay.on", act: "electrolytes" }
  ];
  function resumeSnapshot() {
    try {
      var hit = null;
      for (var i = 0; i < RESUME_ROUTES.length; i++) { if (document.querySelector(RESUME_ROUTES[i].sel)) { hit = RESUME_ROUTES[i].act; break; } }
      if (hit) {
        var rec = { act: hit, at: Date.now() };
        // ICU/Ward: also capture the exact screen + sub-tab so resume lands on that tab, not just the board.
        if (hit === "icu" && window.ICU && ICU.curView) { try { rec.view = ICU.curView(); } catch (e) {} }
        localStorage.setItem(RESUME_KEY, JSON.stringify(rec));
      } else localStorage.removeItem(RESUME_KEY);   // on Home → clear, so a plain reload stays on Home
    } catch (e) {}
  }
  function resumeRestore() {
    try {
      var d = JSON.parse(localStorage.getItem(RESUME_KEY) || "null");
      localStorage.removeItem(RESUME_KEY);   // one-shot — consume it so it only fires on this launch
      if (!d || !d.act || !d.at || (Date.now() - d.at) > RESUME_MAX_MS) return;
      // Do NOT auto-reopen the ICU/Ward dashboard on launch — it yanked the user straight into a
      // patient (with an auto-sync "labs synced" flash) on every open. Home shows a "Resume ICU
      // patient" card instead, so returning is one deliberate tap. Lightweight tool overlays
      // (calculators/drugs/etc.) still resume — they are quick and do not auto-sync.
      if (d.act === "icu" || d.act === "ward") return;
      setTimeout(function () {
        try {
          // ICU/Ward: resume the exact screen + sub-tab (falls back to a plain open if unavailable).
          if (d.act === "icu" && window.ICU && ICU.resume) ICU.resume(d.view);
          else if (typeof ACT[d.act] === "function") ACT[d.act]();
        } catch (e) {}
      }, 350);
    } catch (e) {}
  }
  var _resumeWired = false;
  function initResume() {
    if (_resumeWired) return; _resumeWired = true;
    try {
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") resumeSnapshot(); });
      window.addEventListener("pagehide", resumeSnapshot);
      window.addEventListener("beforeunload", resumeSnapshot);
    } catch (e) {}
  }
  // Native-feel sidebar: app.js only slides the drawer open — it never locks the page, so on iOS a
  // touch-drag over the drawer scrolled the page BEHIND it (the "right side goes up/down", web-page
  // feel). While the drawer is open, allow touch-scroll ONLY inside its menu when the menu actually
  // overflows; block it everywhere else so the background can't move. One document listener, idempotent.
  var _sbGuardWired = false;
  function installSbScrollGuard() {
    if (_sbGuardWired) return; _sbGuardWired = true;
    try {
      var d = document.getElementById("sbDrawer");
      if (!d) return;
      // Block background scroll ONLY while the sidebar is open — and, critically, ATTACH the
      // non-passive touchmove listener ONLY for that window, removing it on close. A permanently
      // registered non-passive `touchmove` on document forces iOS/WKWebView off the fast
      // (threaded) scroll path and janks ALL scrolling app-wide, even though the old handler
      // early-returned when the sidebar was closed. overscroll-behavior:contain on
      // #sbDrawer/#sbMenu already stops scroll chaining; this only cancels drags on the
      // non-scrolling backdrop while the drawer is open.
      var block = function (e) {
        var sc = e.target && e.target.closest ? e.target.closest("#sbMenu") : null;
        if (sc && sc.scrollHeight > sc.clientHeight + 1) return;   // real, scrollable menu → allow native scroll
        try { e.preventDefault(); } catch (x) {}                   // else block (background / short menu / header)
      };
      var attached = false;
      var sync = function () {
        var open = d.classList.contains("open");
        if (open && !attached) { document.addEventListener("touchmove", block, { passive: false }); attached = true; }
        else if (!open && attached) { document.removeEventListener("touchmove", block, { passive: false }); attached = false; }
      };
      new MutationObserver(sync).observe(d, { attributes: true, attributeFilter: ["class"] });
      sync();
    } catch (e) {}
  }
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
      ".hv-fab{position:fixed;right:16px;bottom:calc(86px + env(safe-area-inset-bottom));z-index:9999;width:54px;height:54px;border-radius:50%;border:none;background:var(--teal,#0F766E);color:#fff;box-shadow:0 8px 24px rgba(15,118,110,.42);align-items:center;justify-content:center;cursor:pointer;display:flex}.hv-fab svg{width:34px;height:34px}.hv-fab svg image{opacity:.96}.hv-fab:active{transform:scale(.92)}",
      // While any bottom sheet (More / Acknowledgements / etc.) is open, hide the floating Home FAB
      // and the rotating quote popup so they never cover the sheet's content (e.g. the contributor card).
      "body.hv-sheet-open .hv-fab,body.hv-sheet-open #harrisonQuotePopup,body.hv-sheet-open .ghis-ward-fab{display:none!important}",
      ".hv-sheet{z-index:calc(var(--z-cases, 600) + 40)}.hv-scrim{z-index:calc(var(--z-cases, 600) + 39)}",
      // Acknowledgements sheet: render the names' hover tooltips (roles, bios, publications)
      // INLINE as readable cards — visible on touch, no overlap. Names stack; each description
      // sits under its name.
      ".hv-ack .ack-names{display:block!important}",
      ".hv-ack .ack-role{font:700 11px var(--hfont,var(--sans))!important;text-transform:uppercase;letter-spacing:.05em;color:var(--hmut,#5a7184)!important;margin:18px 0 2px!important}",
      ".hv-ack .ack-contrib-name,.hv-ack .creator-name{display:block!important;position:relative!important;font:800 15px var(--hfont,var(--sans))!important;color:var(--hink,#14202b)!important;margin:14px 0 0!important;padding:0!important;cursor:default!important;border:none!important}",
      ".hv-ack .ack-tip,.hv-ack .creator-tip{display:block!important;position:static!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;max-width:none!important;max-height:none!important;overflow:visible!important;box-shadow:none!important;z-index:auto!important;transform:none!important;margin:6px 0 2px!important;border:1px solid var(--hbd,#dde4e8)!important;border-radius:12px!important;background:var(--hbg,#f6f8f8)!important;color:var(--hink,#14202b)!important;padding:11px 13px!important;font:500 12.5px/1.55 var(--hfont,var(--sans))!important;white-space:normal!important}",
      ".hv-ack .creator-tip{display:flex!important;flex-direction:column!important;padding:0 0 12px!important;background:var(--hpanel,#fff)!important}",
      ".hv-ack .ack-tip strong{display:block;color:var(--hp,var(--teal))!important;font-weight:800;margin-bottom:3px}",
      ".hv-ack .ack-tip::before,.hv-ack .ack-tip::after,.hv-ack .creator-tip::before,.hv-ack .creator-tip::after{display:none!important}",
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
      /* Native-feel sidebar scroll: the drawer scrolls INTERNALLY and never chains to the page behind
         it (app.js slides the drawer but doesn't lock the page → on iOS a drag over the drawer scrolled
         the background, feeling like a web page). overscroll-behavior:contain + the touchmove guard fix it. */
      /* Make #sbMenu the bounded scroller (the touchmove guard only un-blocks a scrollable #sbMenu).
         app.js lays the drawer out as display:block, so #sbMenu grows to fit ALL items → scrollHeight
         == clientHeight → guard treats it as "short" and preventDefault()s every drag → nothing scrolls
         and the footer/last items are clipped. Flex-column the drawer so head/account/foot keep their
         height and #sbMenu (flex:1;min-height:0) clamps to the leftover space and scrolls natively. */
      "#sbDrawer{overscroll-behavior:contain;display:flex;flex-direction:column}#sbMenu{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}",
      /* Remove the stray right-chevron "back" affordance from the Start-a-Case chooser header
         (it points the wrong way and reads as a random glyph); the title then sits flush-left. */
      "#v3case .v3-header [data-cx=\"back\"]{display:none}#v3case .v3-header{padding-left:4px}",
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

  // ---- v4 home redesign (opt-in flag: localStorage smd_home_v4="1" or ?home=v4) ----
  // Renders a coherent, de-duplicated authenticated home. Reuses the ACT dispatch and
  // data-act wiring 1:1 so no routes change; styled by the scoped .hv4 layer in ui-v3.css.
  function homeV4On() { try { var q = location.search || ""; if (/[?&]home=v3\b/.test(q)) return false; if (/[?&]home=v4\b/.test(q)) return true; if (localStorage.getItem("smd_home_v4") === "0") return false; return true; } catch (e) { return true; } }
  function greetV4() { try { var h = (new Date()).getHours(); return h < 12 ? "Good morning" : (h < 17 ? "Good afternoon" : "Good evening"); } catch (e) { return "Welcome"; } }
  function dateV4() { try { return (new Date()).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }); } catch (e) { return ""; } }
  // First name of the signed-in Google account → "Dr <name>"; empty for guests.
  function acctFirstV4() {
    try {
      var a = JSON.parse(localStorage.getItem("stewardmd_account") || "{}");
      var n = String((a && a.name) || "").trim();
      if (!n || (a && a.type === "guest" && !a.name)) return "";
      if (n.indexOf("@") > -1) return "";                 // Apple private-relay etc. store an email as "name" — don't greet with it
      return n.split(/\s+/)[0];
    } catch (e) { return ""; }
  }
  function escV4(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function greetLineV4() {
    var f = acctFirstV4(), nm = f ? ", Dr " + escV4(f) : "";
    var d = new Date(), mins = d.getHours() * 60 + d.getMinutes();      // minutes since midnight
    if (mins <= 270) return "Hi night owl" + nm + " \u2014 it\u2019s too early to say good morning";  // 00:00\u201304:30
    return greetV4() + nm;
  }
  function tileV4(act, icon, tt, sub) {
    return '<button class="v4-tile" data-act="' + act + '" aria-label="' + tt + '"><span class="ic">' + svg(icon) + '</span><span class="tt">' + tt + '</span><span class="sub">' + sub + '</span></button>';
  }
  function homeV4Markup() {
    return '' +
      '<header class="v3-header">' +
        '<button class="v3-ic" data-act="menu" aria-label="Menu">' + svg("menu") + '</button>' +
        '<div class="v3-brand"><span class="v3-logo" aria-hidden="true"></span><div class="v3-brand-tt">Steward<span class="v3-md">MD</span></div></div>' +
        '<div class="v3-spacer"></div>' +
        '<button class="v3-ic" id="v4ThemeBtn" data-act="theme" aria-label="Toggle light / dark theme">' + svg("moon") + '</button>' +
        '<button class="v3-ic v3-dotbadge" id="v3BellBtn" data-act="notifications" aria-label="Notifications">' + svg("bell") + '</button>' +
        '<button class="v3-avatar" data-act="more" aria-label="Account">G</button>' +
      '</header>' +
      '<main class="v3-main"><div class="v3-stack">' +
        '<div class="v4-greet"><div class="ey">' + dateV4() + '</div><div class="hi">' + greetLineV4() + '</div><div class="q">What would you like to do?</div></div>' +
        '<section class="v4-hero" data-act="about" role="button" tabindex="0" aria-label="About & Acknowledgements" style="cursor:pointer"><div class="v4-hero-bd"><div class="v4-hero-tt">Steward<span class="v3-md">MD</span></div><span class="v4-hero-tag">Clinical decision support</span><p class="v4-hero-p">Evidence-based decisions at the point of care — antimicrobials, differentials, ICU &amp; more.</p></div><div class="v4-hero-logo"><img src="/logo.png" alt="StewardMD"></div></section>' +
        '<div class="v4-qrow">' +
          '<button class="v4-qc" data-act="syndromes" aria-label="Syndromes">' + svg("syndromes") + '<span>Syndromes</span></button>' +
          '<button class="v4-qc" data-act="ward" aria-label="Ward Sync">' + svg("ward") + '<span>Ward Sync</span></button>' +
          '<button class="v4-qc" data-act="icu" aria-label="ICU">' + svg("icu") + '<span>ICU</span></button>' +
          '<button class="v4-qc" data-act="antibiogram" aria-label="Antibiogram">' + svg("antibiogram") + '<span>Antibiogram</span></button>' +
        '</div>' +
        '<button class="v4-action primary" data-act="startcase" aria-label="Start a Case"><span class="ic">' + svg("stcase") + '</span><span class="bd"><span class="tt">Start a Case</span><span class="sub">Structured clinical assessment</span></span><span class="arr">' + svg("arrow") + '</span></button>' +
        '<button class="v4-action secondary" data-act="reasoning" aria-label="Dx My Patient"><span class="ic">' + svg("reasoning") + '</span><span class="bd"><span class="tt">Dx My Patient</span><span class="sub">Live differential reasoning &amp; next steps</span></span><span class="arr">' + svg("chev") + '</span></button>' +
        '<div class="v4-sec">Clinical tools</div>' +
        '<div class="v4-grid">' +
          tileV4("calculators", "calc", "Calculators", "400+ clinical tools") +
          tileV4("drugmenu", "pills", "Drugs &amp; Interactions", "Database · interaction checker") +
          tileV4("electrolytes", "flask", "Electrolytes", "ICU correction") +
          tileV4("guidelines", "book", "Guides", "Protocols &amp; references") +
        '</div>' +
        '<div class="v4-foot"><div class="disc">Only for qualified clinicians</div>' +
          '<a class="v4-maik" href="https://maiknowledge.in" target="_blank" rel="noopener" aria-label="Created by MaiK"><span class="lbl">Created by</span><img class="v4-maik-logo v4-maik-light" src="/maik-logo.png" alt="MaiK"><img class="v4-maik-logo v4-maik-dark" src="/maik-logo-white.png" alt="MaiK"><span class="v4-maik-name"><span class="mk-b">MaiK</span><span class="mk-s">nowledge</span></span></a>' +
          '<div class="cred">© 2026 StewardMD · All rights reserved</div>' +
          '<div class="v4-legal" style="margin-top:6px;font:500 11.5px/1.6 var(--v3-font,sans-serif);color:var(--v3-muted,#889)"><a role="button" tabindex="0" onclick="openModal(\'privacyModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Privacy Policy</a> · <a role="button" tabindex="0" onclick="openModal(\'termsModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Terms of Use</a> · <a role="button" tabindex="0" onclick="openModal(\'contactModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Support</a></div><div class="v4-rev" style="margin-top:4px;font:500 11px/1.5 var(--v3-font,sans-serif);color:var(--v3-muted,#889)">Clinical content last reviewed · 5 Jul 2026</div></div>' +
      '</div></main>' +
      '<nav class="v3-tabbar">' +
        '<button class="v3-tab active" data-act="home" aria-label="Home">' + svg("home") + '<span>Home</span></button>' +
        '<button class="v3-tab" data-act="cases" aria-label="Cases">' + svg("folder") + '<span>Cases</span></button>' +
        '<button class="v3-tab" data-act="search" aria-label="Search">' + svg("search") + '<span>Search</span></button>' +
        '<button class="v3-tab" data-act="askai" aria-label="Ask MaiK">' + svg("ai") + '<span>Ask MaiK</span></button>' +
        '<button class="v3-tab" data-act="more" aria-label="More">' + svg("more") + '<span>More</span></button>' +
      '</nav>';
  }

  // ---- Redesign navigation shell + dashboard (Phase 2, opt-in flag) -----------
  // Additive + reversible: default OFF. Enable with localStorage smd_redesign_nav="1"
  // or ?rnav=1 (disable with ?rnav=0). Renders inside the SAME #homeV2 root and reuses
  // the SAME data-act wiring / ACT dispatch / goHome / scrim-sheet-FAB, so every route
  // and back-navigation behaviour is identical to the shipped home. Styled by the
  // #homeV2.rnav layer in redesign-system.css (rds-* tokens).
  function redesignNavOn() {
    try {
      var q = location.search || "";
      if (/[?&]rnav=0\b/.test(q)) return false;                 // explicit off
      if (/[?&]rnav=1\b/.test(q)) return true;                  // explicit on
      return localStorage.getItem("smd_redesign_nav") !== "0";  // DEFAULT ON (off only if user opted out)
    } catch (e) { return true; }
  }
  function ric(name) { return '<span class="rds-icon" aria-hidden="true">' + name + '</span>'; }
  // Flag-gated runtime emoji → Material Symbols swap for the classic header (.app-head)
  // and sidebar (#sbDrawer), which are rendered by the minified app.js. Additive: replaces
  // emoji in .ic spans and header buttons; marks [data-ic] to avoid re-work; never throws.
  var EMOJI2SYM = { "☰": "menu", "🧠": "neurology", "⏻": "logout", "🔍": "search",
    "📂": "folder_open", "📁": "folder", "🗄️": "medication", "🗄": "medication",
    "🏠": "add_circle", "📋": "content_paste", "🔢": "calculate", "🫀": "cardiology",
    "🩺": "stethoscope", "🏥": "local_hospital", "📚": "menu_book", "⚙️": "settings",
    "⚙": "settings", "ℹ️": "info", "ℹ": "info", "💉": "vaccines", "🧬": "biotech",
    "🦠": "coronavirus", "🧪": "science", "💊": "medication", "⚡": "bolt",
    "📊": "monitoring", "🔬": "biotech", "🫁": "pulmonology", "🔔": "notifications",
    "👤": "person", "✨": "auto_awesome", "🎤": "mic", "📷": "photo_camera",
    "💧": "water_drop", "🩸": "bloodtype", "⚗️": "science", "🗂️": "folder",
    "🧾": "receipt_long", "🧮": "calculate", "🚨": "emergency", "🫘": "nephrology",
    "🔵": "lens", "📖": "menu_book", "🌓": "contrast", "💾": "save", "⚖️": "balance",
    "⚖": "balance", "🔒": "lock", "📜": "description", "✉️": "mail", "✉": "mail",
    "🐞": "bug_report", "★": "star", "☀️": "light_mode", "🌙": "dark_mode",
    "📁": "folder", "🗂️": "folder", "🩹": "healing", "🦴": "orthopedics" };
  function iconifyEmoji(scope) {
    if (!scope) return;
    try {
      // 1) dedicated .ic icon spans (sidebar rows, some header) — whole content is the emoji
      scope.querySelectorAll(".ic:not([data-ic])").forEach(function (el) {
        var sym = EMOJI2SYM[(el.textContent || "").trim()];
        if (sym) { el.innerHTML = '<span class="rds-icon" aria-hidden="true">' + sym + "</span>"; el.setAttribute("data-ic", "1"); }
      });
      // theme knob (☀️/🌙) — NOT marked data-ic so it re-swaps after app.js flips it on toggle
      scope.querySelectorAll(".toggle-knob").forEach(function (el) {
        var s = EMOJI2SYM[(el.textContent || "").trim()];
        if (s) el.innerHTML = '<span class="rds-icon" aria-hidden="true">' + s + "</span>";
      });
      // 2) header buttons/links: emoji is the whole text or a leading text node before a label span
      scope.querySelectorAll("button:not([data-ic]),a:not([data-ic])").forEach(function (b) {
        var whole = (b.childNodes.length === 1 && b.firstChild && b.firstChild.nodeType === 3) ? (b.textContent || "").trim() : null;
        if (whole && EMOJI2SYM[whole]) { b.innerHTML = '<span class="rds-icon" aria-hidden="true">' + EMOJI2SYM[whole] + "</span>"; b.setAttribute("data-ic", "1"); return; }
        var fc = b.firstChild;
        if (fc && fc.nodeType === 3) {
          var lead = fc.nodeValue;
          for (var em in EMOJI2SYM) {
            if (lead.indexOf(em) === 0) {
              var rest = lead.slice(em.length);
              var sp = document.createElement("span"); sp.className = "rds-icon"; sp.setAttribute("aria-hidden", "true"); sp.textContent = EMOJI2SYM[em];
              b.replaceChild(sp, fc);
              if (rest && rest.replace(/\s/g, "")) b.insertBefore(document.createTextNode(rest), sp.nextSibling);
              b.setAttribute("data-ic", "1"); break;
            }
          }
        }
      });
    } catch (e) {}
  }
  window.SMD_iconify = iconifyEmoji;
  function rtile(act, icon, tt, sub) {
    return '<button class="rnav-tile" data-act="' + act + '" aria-label="' + tt + '">' + ric(icon) +
      '<span class="rnav-tile-tt">' + tt + '</span><span class="rnav-tile-sub">' + sub + '</span></button>';
  }
  function homeRedesignMarkup() {
    return '' +
      '<header class="rnav-head rds-safe-top">' +
        '<button class="rds-icon-btn" data-act="menu" aria-label="Menu">' + ric("menu") + '</button>' +
        '<div class="rnav-brand"><img src="/logo.png" alt="StewardMD"><span>Steward<b>MD</b></span></div>' +
        '<div class="rnav-head-sp"></div>' +
        '<button class="rds-icon-btn" data-act="search" aria-label="Search">' + ric("search") + '</button>' +
        '<button class="rds-icon-btn" id="v4ThemeBtn" data-act="theme" aria-label="Toggle light / dark theme">' + ric("dark_mode") + '</button>' +
        '<button class="rds-icon-btn rnav-bell v3-dotbadge" id="v3BellBtn" data-act="notifications" aria-label="Notifications">' + ric("notifications") + '</button>' +
      '</header>' +
      '<main class="v3-main rnav-main"><div class="rnav-stack">' +
        '<div class="rnav-greet"><div class="rnav-eyebrow">' + dateV4() + '</div><div class="rnav-hi">' + greetLineV4() + '</div></div>' +
        '<div id="rnavWatch"></div>' +
        '<div id="rnavResume"></div>' +
        '<div class="rnav-qa">' +
          '<button class="rnav-qa-btn" data-act="startcase" aria-label="Start a Case">' + ric("stethoscope") + '<span>Start Case</span></button>' +
          '<button class="rnav-qa-btn" data-act="reasoning" aria-label="Dx My Patient">' + ric("neurology") + '<span>Dx Patient</span></button>' +
          '<button class="rnav-qa-btn" data-act="drugmenu" aria-label="Drugs &amp; Interactions">' + ric("medication") + '<span>Drugs</span></button>' +
          '<button class="rnav-qa-btn" data-act="calculators" aria-label="Calculators">' + ric("calculate") + '<span>Calculators</span></button>' +
        '</div>' +
        '<section class="rnav-hero" data-act="about" role="button" tabindex="0" aria-label="About & Acknowledgements" style="cursor:pointer"><div class="rnav-hero-bd"><div class="rnav-hero-tt">Steward<b style="color:#0a2320">MD</b></div><div class="rnav-hero-tag">Clinical decision support</div><p class="rnav-hero-p">Evidence-based decisions at the point of care.</p></div><img class="rnav-hero-logo" src="/logo.png" alt=""></section>' +
        '<div class="rnav-qrow">' +
          '<button class="rnav-qc" data-act="syndromes" aria-label="Syndromes">' + ric("coronavirus") + '<span>Syndromes</span></button>' +
          '<button class="rnav-qc" data-act="ward" aria-label="Ward Sync">' + ric("local_hospital") + '<span>Ward Sync</span></button>' +
          '<button class="rnav-qc" data-act="icu" aria-label="ICU">' + ric("monitor_heart") + '<span>ICU</span></button>' +
          '<button class="rnav-qc" data-act="antibiogram" aria-label="Antibiogram">' + ric("biotech") + '<span>Antibiogram</span></button>' +
        '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Clinical tools</span></div>' +
        '<div class="rnav-grid">' +
          (function () {
            // FundX AI retinal-scan tile — shown only when the smd_fundx flag is on
            // (?fundx=1 or Settings). Self-contained + order-independent so it never
            // depends on fundx.js having loaded first.
            try {
              var q = (location.search.match(/[?&]fundx=([^&]+)/) || [])[1];
              var on = q != null ? (q === "1" || q === "on" || q === "true") : (localStorage.getItem("smd_fundx") === "1");
              return on ? rtile("retinalscan", "visibility", "Retinal Scan", "FundX AI · fundus") : "";
            } catch (e) { return ""; }
          })() +
          rtile("dictate", "mic", "Dictate", "Voice to text") +
          rtile("interactions", "photo_camera", "Scan Meds", "Photo scan · interactions") +
          rtile("electrolytes", "science", "Electrolytes", "ICU correction") +
          rtile("guidelines", "book_2", "Guides", "Protocols &amp; references") +
        '</div>' +
        '<div id="rnavRecent"></div>' +
        '<div class="v4-foot rnav-foot"><div class="disc">Only for qualified clinicians</div>' +
          '<a class="v4-maik" href="https://maiknowledge.in" target="_blank" rel="noopener" aria-label="Created by MaiK"><span class="lbl">Created by</span><img class="v4-maik-logo v4-maik-light" src="/maik-logo.png" alt="MaiK"><img class="v4-maik-logo v4-maik-dark" src="/maik-logo-white.png" alt="MaiK"><span class="v4-maik-name"><span class="mk-b">MaiK</span><span class="mk-s">nowledge</span></span></a>' +
          '<div class="cred">© 2026 StewardMD · All rights reserved</div>' +
          '<div class="v4-legal" style="margin-top:6px;font:500 11.5px/1.6 var(--v3-font,sans-serif);color:var(--v3-muted,#889)"><a role="button" tabindex="0" onclick="openModal(\'privacyModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Privacy Policy</a> · <a role="button" tabindex="0" onclick="openModal(\'termsModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Terms of Use</a> · <a role="button" tabindex="0" onclick="openModal(\'contactModal\')" style="cursor:pointer;color:inherit;text-decoration:underline">Support</a></div><div class="v4-rev" style="margin-top:4px;font:500 11px/1.5 var(--v3-font,sans-serif);color:var(--v3-muted,#889)">Clinical content last reviewed · 5 Jul 2026</div></div>' +
      '</div></main>' +
      '<nav class="rnav-tabbar rds-safe-bottom">' +
        '<button class="rnav-tab active" data-act="home" aria-label="Home">' + ric("home") + '<span>Home</span></button>' +
        '<button class="rnav-tab" data-act="cases" aria-label="Cases">' + ric("folder_open") + '<span>Cases</span></button>' +
        '<button class="rnav-tab rnav-tab-maik" data-act="askai" aria-label="Ask MaiK">' + ric("forum") + '<span>MaiK</span></button>' +
        '<button class="rnav-tab" data-act="drugmenu" aria-label="Drugs">' + ric("medication") + '<span>Drugs</span></button>' +
        '<button class="rnav-tab" data-act="more" aria-label="More">' + ric("more_horiz") + '<span>More</span></button>' +
      '</nav>';
  }
  // Populate the dashboard cards from REAL data only (no placeholders). Anything with
  // no real data is left empty. data-act clicks route via the delegated handler; data-rid
  // (recent) clicks are wired here to SMD_RECENT.open.
  function hydrateRnav() {
    if (!root || !root.classList.contains("rnav")) return;
    // Watch-Lab / ICU critical alert banner (only if a real critical alert exists)
    try {
      var w = root.querySelector("#rnavWatch");
      if (w) {
        var alerts = (window.ICU_STATE && Array.isArray(window.ICU_STATE.alerts)) ? window.ICU_STATE.alerts : [];
        var crit = alerts.filter(function (a) { return a && (a.severity === "crit" || a.severity === "critical"); });
        if (crit.length) {
          var pn = (window.ICU_STATE && window.ICU_STATE.patient && window.ICU_STATE.patient.name) ? " · " + escV4(window.ICU_STATE.patient.name) : "";
          w.innerHTML = '<button class="rds-banner rds-banner--critical rnav-alert" data-act="icu" aria-label="Open ICU critical alerts">' + ric("warning") +
            '<span class="rds-banner-body"><span class="rds-banner-title">' + crit.length + ' critical alert' + (crit.length > 1 ? "s" : "") + '</span>' +
            '<span class="rds-banner-meta">Open ICU workspace' + pn + '</span></span>' + svg("chev") + '</button>';
        } else { w.innerHTML = ""; }
      }
    } catch (e) {}
    // Resume active patient (ICU active buffer) OR most-recent case
    try {
      var res = root.querySelector("#rnavResume");
      if (res) {
        var pt = (window.ICU_STATE && window.ICU_STATE.patient) ? window.ICU_STATE.patient : null;
        var recent = (window.SMD_RECENT && SMD_RECENT.get) ? (SMD_RECENT.get() || []) : [];
        if (pt && pt.name) {
          var meta = [pt.bed ? "Bed " + escV4(pt.bed) : "", pt.dx ? escV4(pt.dx) : ""].filter(Boolean).join(" · ");
          res.innerHTML = '<button class="rnav-resume rds-card" data-act="icu" aria-label="Resume patient">' +
            '<span class="rnav-resume-ic rds-icon">monitor_heart</span><span class="rnav-resume-bd"><span class="rnav-resume-lbl">Resume ICU patient</span>' +
            '<span class="rnav-resume-nm">' + escV4(pt.name) + '</span>' + (meta ? '<span class="rnav-resume-mt">' + meta + '</span>' : "") + '</span>' + svg("chev") + '</button>';
        } else if (recent.length) {
          var r0 = recent[0];
          res.innerHTML = '<button class="rnav-resume rds-card" data-rid="' + escV4(r0.caseId) + '" aria-label="Resume last case">' +
            '<span class="rnav-resume-ic rds-icon">history</span><span class="rnav-resume-bd"><span class="rnav-resume-lbl">Resume last case</span>' +
            '<span class="rnav-resume-nm">' + escV4(r0.title || "Case") + '</span>' + (r0.summary ? '<span class="rnav-resume-mt">' + escV4(r0.summary) + '</span>' : "") + '</span>' + svg("chev") + '</button>';
          var rb = res.querySelector("[data-rid]");
          if (rb) rb.addEventListener("click", function () { try { SMD_RECENT.open(rb.getAttribute("data-rid")); } catch (e) {} });
        } else { res.innerHTML = ""; }
      }
    } catch (e) {}
    // Recent activity list
    try {
      var rc = root.querySelector("#rnavRecent");
      if (rc) {
        var list = (window.SMD_RECENT && SMD_RECENT.get) ? (SMD_RECENT.get() || []) : [];
        if (list.length) {
          // BUG-11: de-duplicate consecutive identical sessions; add a feature icon + relative
          // timestamp; keep the card styling consistent with the rest of the app.
          var _rmap = { reasoning: "neurology", decision: "gavel", icu: "monitor_heart", abx: "gavel" };
          function _rago(ts) { if (!ts) return ""; var m = Math.round((Date.now() - ts) / 60000); if (m < 1) return "just now"; if (m < 60) return m + "m ago"; var h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago"; }
          var _rprev = null;
          var rows = list.filter(function (it) { var k = (it.title || "") + "|" + (it.summary || ""); if (k === _rprev) return false; _rprev = k; return true; }).slice(0, 5).map(function (it) {
            return '<button class="rds-list-row rnav-recent-row" data-rid="' + escV4(it.caseId) + '">' +
              '<span class="rds-list-lead rds-icon">' + (_rmap[it.feature] || "history") + '</span><span class="rds-list-main">' +
              '<span class="rnav-recent-tt">' + escV4(it.title || "Case") + '</span>' +
              (it.summary ? '<span class="rnav-recent-sub">' + escV4(it.summary) + '</span>' : "") + '</span>' +
              (it.ts ? '<span class="rnav-recent-time" style="margin-left:8px;flex:0 0 auto;font:600 11px var(--sans,system-ui);color:var(--slate-soft,#5a7184);white-space:nowrap">' + _rago(it.ts) + '</span>' : "") +
              '<span class="rds-list-trail">' + svg("chev") + '</span></button>';
          }).join("");
          rc.innerHTML = '<div class="rds-section-header"><span class="rds-section-title">Recent activity</span></div><div class="rds-card rnav-recent">' + rows + '</div>';
          rc.querySelectorAll("[data-rid]").forEach(function (b) {
            b.addEventListener("click", function () { try { SMD_RECENT.open(b.getAttribute("data-rid")); } catch (e) {} });
          });
        } else { rc.innerHTML = ""; }
      }
    } catch (e) {}
  }
  window.SMD_hydrateRnav = hydrateRnav;

  function build() {
    if (root) return;
    // Phase 3: flag → global body.rds-on so the clinical-surface restyle layer
    // (redesign-system.css, scoped `html body.rds-on …`) applies app-wide. Off = untouched.
    try { document.body.classList.toggle("rds-on", redesignNavOn()); } catch (e) {}
    injectCSS(); injectV3CSS();
    root = document.createElement("div"); root.id = "homeV2"; root.className = "v3";
    root.innerHTML =
      '<header class="v3-header">' +
        '<button class="v3-ic" data-act="menu" aria-label="Menu">' + svg("menu") + '</button>' +
        '<div class="v3-brand"><div class="v3-mark" style="background:none;box-shadow:none"><img src="/logo.png" alt="StewardMD" style="width:100%;height:100%;object-fit:contain"></div><div style="min-width:0"><div class="v3-brand-tt">Steward<span class="v3-md">MD</span></div><div class="v3-brand-sub">Antibiotic Stewardship</div></div></div>' +
        '<div class="v3-spacer"></div>' +
        '<button class="v3-ic" data-act="theme" aria-label="Theme">' + svg("moon") + '</button>' +
        '<button class="v3-ic v3-dotbadge" id="v3BellBtn" data-act="notifications" aria-label="Notifications">' + svg("bell") + '</button>' +
        '<button class="v3-avatar" data-act="more" aria-label="Account">G</button>' +
      '</header>' +
      '<main class="v3-main"><div class="v3-stack">' +
        '<section class="v3-card v3-hero"><div style="flex:1;min-width:0"><h1 class="v3-h-hero">Steward<span class="v3-md">MD</span></h1><span class="v3-tag">Clinical decision support for doctors</span><p>StewardMD is a clinical decision-support platform for doctors — structured case review, clinical workflow and decision support.</p></div><div class="v3-shield" style="background:none;box-shadow:none"><img src="/logo.png" alt="StewardMD logo" style="width:62px;height:62px;object-fit:contain"></div></section>' +
        '<div class="v3-qrow">' +
          '<button class="v3-qc" data-act="more">' + svg("user") + '<span>Account</span></button>' +
          '<button class="v3-qc" data-act="search">' + svg("search") + '<span>Search</span></button>' +
          '<button class="v3-qc" data-act="icu">' + svg("icu") + '<span>ICU</span></button>' +
          '<button class="v3-qc" data-act="theme">' + svg("sun") + '<span>Theme</span></button>' +
        '</div>' +
        '<button class="v3-primary" data-act="startcase"><div class="ic">' + svg("stcase") + '</div><div style="flex:1;min-width:0"><div class="tt">Start a Case</div><div class="sub">New clinical decision — choose Simple or Advanced</div></div><div class="arr">' + svg("arrow") + '</div></button>' +
        '<button class="v3-secondary" data-act="reasoning"><div class="ic">' + svg("reasoning") + '</div><div style="flex:1;min-width:0"><div class="tt">Dx My Patient</div><div class="sub">Reason through your patient — live differential, confidence &amp; next steps</div></div><div class="arr">' + svg("chev") + '</div></button>' +
        '<div class="v3-sec-label">Quick access</div>' +
        '<div class="v3-grid">' +
          '<button class="v3-tile" data-act="cases"><div class="ic">' + svg("folder") + '</div><div style="min-width:0"><div class="tt">My Cases</div><div class="sub">Saved assessments</div></div></button>' +
          '<button class="v3-tile" data-act="calculators"><div class="ic">' + svg("calc") + '</div><div style="min-width:0"><div class="tt">Calculators</div><div class="sub">400+ clinical tools</div></div></button>' +
          '<button class="v3-tile" data-act="drugmenu"><div class="ic">' + svg("pills") + '</div><div style="min-width:0"><div class="tt">Drugs</div><div class="sub">Database · interactions · doses</div></div></button>' +
          '<button class="v3-tile" data-act="electrolytes"><div class="ic">' + svg("flask") + '</div><div style="min-width:0"><div class="tt">Electrolyte Engine</div><div class="sub">ICU correction · doses · rates</div></div></button>' +
        '</div>' +
        '<div class="v3-foot">For qualified clinicians · <b>AI-summarised, verify doses</b></div>' +
        '<div class="v3-devfoot">' +
          '<div class="v3-devlabel">DEVELOPED BY</div>' +
          '<img id="v3DevLogo" class="v3-devlogo" alt="MaiKnowledge" />' +
          '<div class="v3-devname">MaiKnowledge</div>' +
          '<div class="v3-devmeta">© 2026 StewardMD · All rights reserved · Developed by MaiKnowledge · Dr. Manoj Kumar Kurmana, MD</div>' +
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

    // Redesign nav shell (opt-in) takes precedence; else v4 coherent home; else classic v3.
    // All three reuse the SAME data-act wiring.
    if (redesignNavOn()) {
      root.classList.add("hv4", "rnav"); root.innerHTML = homeRedesignMarkup();
      var _rtb = root.querySelector("#v4ThemeBtn");
      if (_rtb) { var _rsync = function () { _rtb.innerHTML = document.body.classList.contains("dark") ? ric("light_mode") : ric("dark_mode"); };
        _rsync(); _rtb.addEventListener("click", function () { setTimeout(_rsync, 40); }); }
      try { hydrateRnav(); } catch (e) {}
    } else if (homeV4On()) {
      root.classList.add("hv4"); root.innerHTML = homeV4Markup();
      // header theme toggle reflects current theme (moon in light, sun in dark)
      var _tb = root.querySelector("#v4ThemeBtn");
      if (_tb) { var _sync = function () { _tb.innerHTML = document.body.classList.contains("dark") ? svg("sun") : svg("moon"); };
        _sync(); _tb.addEventListener("click", function () { setTimeout(_sync, 40); }); }
    }
    try { mountKuChip(root); } catch (e) {}   // KU: header chip (both header variants)

    try {
      var _dl = document.querySelector(".dev-studio-logo,.about-dev-logo");
      var _fl = root.querySelector("#v3DevLogo");
      if (_dl && _fl && _dl.src) _fl.src = _dl.src;
      else if (_fl) _fl.src = "/logo.png";
    } catch (e) {}

    var scrim = document.getElementById("hvScrim");
    if (!scrim) { scrim = document.createElement("div"); scrim.className = "hv-scrim"; scrim.id = "hvScrim"; document.body.appendChild(scrim); scrim.addEventListener("click", closeSheet); }
    if (!document.getElementById("hvSheet")) { var sheet = document.createElement("div"); sheet.className = "hv-sheet"; sheet.id = "hvSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "StewardMD"); document.body.appendChild(sheet); }
    fab = document.createElement("button"); fab.className = "hv-fab"; fab.id = "hvFab"; fab.setAttribute("aria-label", "StewardMD home");
    // Home FAB = house outline with the StewardMD logo mark inside it.
    fab.innerHTML = '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><path d="M4 23 L24 6 L44 23 M9 22 V43 H39 V22" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><image href="/logo.png" xlink:href="/logo.png" x="15" y="26.5" width="18" height="13.5" preserveAspectRatio="xMidYMid meet"/></svg>';
    fab.style.display = "none"; // hidden until past the splash/disclaimer/login gates
    document.body.appendChild(fab);
    fab.addEventListener("click", goHome);
    // Only show the home button once the user is on the landing page / inside the app —
    // never on the intro splash, disclaimer, or login gates.
    // Is the v4 home the thing the user is actually looking at right now? We sample the
    // element on top at the viewport centre: if it lives inside #homeV2 the bare home is
    // in front (hide the Home button); if anything else is on top — any overlay, sheet,
    // modal, OR the classic app screen opened via "Start a Case" — show the Home button.
    function homeIsForeground() {
      var h = document.getElementById("homeV2");
      if (!h || !h.classList.contains("on")) return false;
      var cs = window.getComputedStyle(h);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      try {
        var el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
        return !!(el && h.contains(el));
      } catch (e) { return true; }
    }
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
      // The notifications list and the Medical-Update detail are full-screen overlays with their
      // own "‹ Back" button. The Home FAB (z-index 9999) would otherwise float over their bottom
      // action bar and swallow taps on the buttons there (Open Official Guideline / Bookmark /
      // Share) — so treat those overlays like a gate and hide the FAB.
      var overlayUp = !!document.querySelector(".ntf-overlay.on");
      var show;
      if (gateUp || overlayUp) show = false;
      else if (homeV4On() || redesignNavOn()) show = !homeIsForeground(); // v4/redesign: Home button on every inner screen/dialog, hidden only on the bare home
      else show = true;                                // classic UI: keep the persistent behaviour
      var want = show ? "flex" : "none";
      if (fab.style.display !== want) fab.style.display = want;
    }
    refreshFab();
    // Scroll fluidity: refreshFab reads layout (elementFromPoint + getComputedStyle), which
    // forces a synchronous reflow. The old blind 400ms poll ran that ~2.5x/s during scroll and
    // stuttered the UI. Make it event-driven, rAF-coalesced, and NEVER probe mid-scroll — only
    // once scrolling settles. A slow 1.2s safety net covers anything the events miss.
    var _fabRaf = 0, _fabScrolling = 0, _fabScrollT = 0;
    function scheduleFab() { if (_fabRaf) return; _fabRaf = requestAnimationFrame(function () { _fabRaf = 0; if (!_fabScrolling) refreshFab(); }); }
    ["click", "hashchange", "transitionend", "animationend"].forEach(function (ev) { window.addEventListener(ev, scheduleFab, true); });
    document.addEventListener("visibilitychange", scheduleFab, true);
    // Capture-phase catches scrolls on inner scroll containers too (ICU, Ward Sync, drawers).
    window.addEventListener("scroll", function () { _fabScrolling = 1; clearTimeout(_fabScrollT); _fabScrollT = setTimeout(function () { _fabScrolling = 0; scheduleFab(); }, 140); }, true);
    setInterval(scheduleFab, 1200);

    // Notifications: probe once for unread medical updates, then hourly.
    try { setTimeout(refreshBadge, 1500); setInterval(function () { _notifItems = null; refreshBadge(); }, 3600000); } catch (e) {}

    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]"); if (!b) return;
      var a = b.getAttribute("data-act");
      if (a === "about") e.stopPropagation();   // hero banner → About & Acknowledgements; keep the StewardMD logo tap from also firing goHome
      if (a === "notifications") return openNotifications();
      if (a === "ku") return openKuPanel();
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
  function openSheet(html) { var s = sheetEl(); s.innerHTML = '<div class="hv-sheet-wrap"><div class="hv-grab"></div>' + html + '</div>'; document.getElementById("hvScrim").classList.add("on"); s.classList.add("on"); document.body.classList.add("hv-sheet-open"); }
  function closeSheet() { var s = sheetEl(); s.classList.remove("on"); document.getElementById("hvScrim").classList.remove("on"); document.body.classList.remove("hv-sheet-open"); }

  // ---- Knowledge Units: header chip + progress panel ----
  function kuFmt(n) { n = Number(n) || 0; return n >= 1000 ? (Math.round(n / 100) / 10 + "").replace(/\.0$/, "") + "k" : String(n); }
  function kuInjectCSS() {
    if (document.getElementById("kuCss")) return;
    var s = document.createElement("style"); s.id = "kuCss";
    s.textContent =
      ".v3-ku{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--hbd,#e2e8f0);background:var(--hpanel,#fff);color:var(--hink,#0f172a);border-radius:999px;padding:5px 10px;font:800 12.5px var(--hfont,system-ui);cursor:pointer;line-height:1}.v3-ku .kudia{color:#f59e0b}"
      + ".ku-panel{padding:4px 2px 8px}.ku-h{font:800 17px var(--hfont,system-ui);color:var(--hink,#0f172a);margin:2px 0}.ku-bal{font:800 34px/1 var(--hfont,system-ui);color:var(--hink,#0f172a);letter-spacing:-.02em;margin-top:8px}.ku-bal .kudia{color:#f59e0b}.ku-sub{color:var(--hmut,#64748b);font:600 12.5px var(--hfont,system-ui);margin-top:6px}"
      + ".ku-bar{height:10px;border-radius:999px;background:rgba(100,116,139,.18);overflow:hidden;margin:12px 0 6px}.ku-bar>i{display:block;height:100%;background:linear-gradient(90deg,#f59e0b,#ef8f00)}"
      + ".ku-tiers{display:flex;flex-direction:column;gap:8px;margin-top:14px}.ku-tier{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--hbd,#e2e8f0);border-radius:12px;padding:10px 12px;font:600 13px var(--hfont,system-ui);color:var(--hink,#0f172a)}.ku-tier.on{border-color:#f59e0b;background:rgba(245,158,11,.08)}.ku-tier .kt-r{color:var(--hmut,#64748b);font-weight:700}.ku-tier.on .kt-r{color:#b45309}"
      + ".ku-brk{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.ku-brk span{background:rgba(100,116,139,.1);border-radius:999px;padding:5px 10px;font:600 12px var(--hfont,system-ui);color:var(--hink,#0f172a)}"
      + ".ku-signin{margin-top:14px;border:0;border-radius:999px;background:#f59e0b;color:#fff;font:800 14px var(--hfont,system-ui);padding:10px 18px;cursor:pointer}"
      + ".ku-note{color:var(--hmut,#64748b);font:500 11.5px var(--hfont,system-ui);margin-top:16px;line-height:1.45}";
    document.head.appendChild(s);
  }
  function mountKuChip(root) {
    if (!window.SMD_KU) return;
    var hdr = root.querySelector(".rnav-head, .v3-header"); if (!hdr || hdr.querySelector(".v3-ku")) return;
    kuInjectCSS();
    var chip = document.createElement("button");
    chip.className = "v3-ku"; chip.setAttribute("data-act", "ku"); chip.setAttribute("aria-label", "Knowledge Points");
    function paint() { chip.innerHTML = '<span class="kudia">◆</span>' + kuFmt(SMD_KU.balance()); chip.style.display = SMD_KU.signedIn() ? "inline-flex" : "none"; }
    paint(); try { SMD_KU.onChange(paint); } catch (e) {}
    var anchor = hdr.querySelector("#v4ThemeBtn") || hdr.querySelector("#v3BellBtn");
    if (anchor) hdr.insertBefore(chip, anchor); else hdr.appendChild(chip);
    try { SMD_KU.summary(); } catch (e) {}   // refresh balance from server on home mount
  }
  function openKuPanel() {
    kuInjectCSS();
    if (!window.SMD_KU || !SMD_KU.signedIn()) {
      openSheet('<div class="ku-panel"><div class="ku-h">Knowledge Points</div><div class="ku-sub">Sign in to start earning Knowledge Units. The more you read and use StewardMD, the more you earn toward subscription discounts.</div><button class="ku-signin" id="kuSignin">Sign in</button></div>');
      var sb = document.getElementById("kuSignin"); if (sb) sb.addEventListener("click", function () { closeSheet(); try { openMore(); } catch (e) {} });
      return;
    }
    function render(sum) {
      sum = sum || { balance: SMD_KU.balance(), tiers: [], byType: {}, streak: 0, nextTier: null, progressPct: 0 };
      var LBL = { read: "Reading", "case": "Cases", calc: "Calculators", maik: "MaiK", streak: "Streak" };
      var brk = Object.keys(sum.byType || {}).map(function (k) { return '<span>' + (LBL[k] || k) + ': ' + (sum.byType[k] || 0) + '</span>'; }).join("");
      var tiers = (sum.tiers || []).map(function (t) { return '<div class="ku-tier' + (t.unlocked ? ' on' : '') + '"><span>' + (t.unlocked ? svg("check", "smd-ico") + ' ' : '') + t.ku + ' KU</span><span class="kt-r">' + t.label + '</span></div>'; }).join("");
      var goal = sum.nextTier ? ((sum.nextTier.ku - (sum.balance || 0)) + ' KU to ' + sum.nextTier.label) : 'Top tier unlocked 🎉';
      openSheet('<div class="ku-panel">'
        + '<div class="ku-h">Knowledge Points</div>'
        + '<div class="ku-bal"><span class="kudia">◆</span> ' + (sum.balance || 0) + ' <span style="font-size:15px;color:var(--hmut,#64748b)">KU</span></div>'
        + '<div class="ku-sub">' + (sum.streak ? svg("bolt", "smd-ico") + ' ' + sum.streak + '-day streak · ' : '') + goal + '</div>'
        + '<div class="ku-bar"><i style="width:' + (sum.progressPct || 0) + '%"></i></div>'
        + '<div class="ku-tiers">' + tiers + '</div>'
        + (brk ? '<div class="ku-brk">' + brk + '</div>' : '')
        + '<div class="ku-note">Earn KU by reading clinical content, running cases &amp; calculators, and using MaiK. Discounts apply at renewal once redemption launches; KU are provisional until verified.</div>'
        + '</div>');
    }
    render(null);   // instant paint from cached balance
    SMD_KU.summary().then(function (s) { if (s) render(s); }).catch(function () {});
  }
  function mi(icon, label, cap, act) { return '<button class="hv-mi" data-mi="' + act + '">' + svg(icon) + '<div class="ml">' + label + (cap ? '<div class="mc">' + cap + '</div>' : '') + '</div><span class="marr">' + svg("chev") + '</span></button>'; }
  function openMore() {
    openSheet(
      '<div class="hv-sh-t">More</div>' +
      // In-app toggle for the redesign (so it can be enabled/reviewed on a native device
      // where there is no URL bar for ?rnav=1). Toggles smd_redesign_nav + reloads.
      '<button class="hv-mi" style="width:100%" onclick="try{var on=localStorage.getItem(\'smd_redesign_nav\')!==\'0\';localStorage.setItem(\'smd_redesign_nav\',on?\'0\':\'1\');location.reload();}catch(e){}">' +
        svg("spark") + '<div class="ml">New design <span class="mc">' +
        (redesignNavOn() ? "On — tap to switch back" : "Beta — tap to try it") +
        '</span></div><span class="marr">' + svg("chev") + '</span></button>' +
      mi("info", "About StewardMD", "Version, credits, disclaimer", "about") +
      mi("search", "Open shared case", "Retrieve by case code", "opencase") +
      mi("award", "Acknowledgements", "Contributors &amp; credits", "ack") +
      mi("user", "Account &amp; sign-in", "Google sign-in, guest session", "account") +
      mi("spark", "Subscription", "Plans &amp; billing", "subscription") +
      mi("settings", "Display &amp; Accessibility", "Font size, density, auto-fit", "display") +
      mi("bell", "Notification preferences", "Choose which specialties alert you", "notifprefs") +
      mi("book", "Guidelines &amp; References", "IDSA · WHO · ICMR", "guidelines") +
      mi("calc", "Calculators", "50+ clinical tools", "calculators") +
      mi("play", "App tour", "Replay the guided tour", "apptour") +
      '<div style="font:700 11px var(--hfont,sans-serif);text-transform:uppercase;letter-spacing:.06em;color:var(--hmut,#889);margin:16px 6px 6px">Legal &amp; safety</div>' +
      mi("shield", "Medical disclaimer", "Decision support — not medical advice", "disclaimer") +
      mi("lock", "Privacy policy", "How your data is handled", "privacy") +
      mi("book", "Terms of use", "Terms &amp; conditions", "terms")
    );
    var s = sheetEl();
    s.querySelectorAll("[data-ui]").forEach(function (b) {
      b.addEventListener("click", function () { if (window.SMD_setUI) SMD_setUI(b.getAttribute("data-ui") === "v2"); });
    });
    s.querySelectorAll("[data-mi]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-mi");
        if (a === "display") return openDisplay();
        if (a === "notifprefs") return openNotifPrefs();
        if (a === "account") return openAccount();
        if (a === "subscription") return openSubscription();
        if (a === "ack") { closeSheet(); return openAck(); }
        if (a === "opencase") { closeSheet(); if (window.CASESHARE && CASESHARE.openPrompt) return CASESHARE.openPrompt(); return toast("Loading…"); }
        if (a === "apptour") { closeSheet(); setTimeout(function () { try { if (window.SMD_TOUR) SMD_TOUR.start({ replay: true }); else toast("Tour loading…"); } catch (e) {} }, 120); return; }
        // Legal & Safety: open the in-app modals (z-index 700, above the home shell) — same as
        // the footer links. The old window.location.href="/disclaimer" navigated the WebView to a
        // path that doesn't exist in the bundled native app (only disclaimer.html does), so Capacitor
        // fell back to index.html and the whole app "restarted". Modals work on web + native.
        if (a === "disclaimer") { closeSheet(); if (typeof openModal === "function") openModal("disclaimerModal"); return; }
        if (a === "privacy") { closeSheet(); if (typeof openModal === "function") openModal("privacyModal"); return; }
        if (a === "terms") { closeSheet(); if (typeof openModal === "function") openModal("termsModal"); return; }
        closeSheet();
        if (ACT[a]) ACT[a]();
      });
    });
  }
  function openAccount() {
    var a = readAccount();
    var body;
    // Profile is driven by the unified account layer (real provider, photo, name) with the
    // legacy stored object as fallback.
    var P = (window.SMD_ACCOUNT && window.SMD_ACCOUNT.profile && window.SMD_ACCOUNT.profile()) || null;
    var signedIn = P ? P.signedIn : !!(a && (a.email || a.type === "google" || a.type === "apple"));
    var dot = '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#16a34a;margin-right:6px;vertical-align:middle"></span>';
    var dangerBtn = 'style="width:100%;margin-top:10px;background:transparent;color:var(--hdanger,#c0392b);border:1px solid var(--hdanger,#c0392b);border-radius:12px;padding:12px;font:700 13px var(--hfont);cursor:pointer"';
    if (signedIn) {
      var nm = (P && P.name) || (a && a.name) || "Signed in";
      var em = (P && P.email) || (a && a.email) || "";
      var pc = (P && P.picture) || (a && a.picture) || "";
      var initial = (((nm || em || "U").trim()[0]) || "U").toUpperCase();
      var pic = pc
        ? '<img class="hv-acct-pic" src="' + smdEsc(pc) + '" referrerpolicy="no-referrer" alt="" onerror="this.outerHTML=\'<div class=&quot;hv-acct-pic hv-acct-ph&quot;>' + smdEsc(initial) + '</div>\'">'
        : '<div class="hv-acct-pic hv-acct-ph">' + smdEsc(initial) + '</div>';
      body = '<div class="hv-acct">' + pic +
        '<div class="hv-acct-name">' + smdEsc(nm) + '</div>' +
        (em ? '<div class="hv-acct-email">' + smdEsc(em) + '</div>' : '') +
        '<div class="hv-acct-badge">' + dot + acctProviderLabel(a, true) + '</div>' +
        '<button class="hv-acct-btn out" data-acct="signout" type="button">Sign out</button>' +
        '<button data-acct="delete" type="button" ' + dangerBtn + '>Delete account &amp; data</button></div>';
    } else {
      body = '<div class="hv-acct">' +
        '<div class="hv-acct-pic hv-acct-ph">?</div>' +
        '<div class="hv-acct-name">Guest mode</div>' +
        '<div class="hv-acct-email">Cases stay on this device only</div>' +
        '<button class="hv-acct-btn" data-acct="signin" type="button">Sign in to save your cases</button>' +
        '<div class="hv-acct-note">Sign in with Google or Apple to sync your cases across devices, keep them safe, and share by code. Your current cases move with you.</div>' +
        '<button data-acct="erase" type="button" ' + dangerBtn.replace("margin-top:10px", "margin-top:12px") + '>Erase all data on this device</button></div>';
    }
    openSheet('<div class="hv-sh-t">Account &amp; sign-in</div>' + body);
    var s = sheetEl();
    var so = s.querySelector('[data-acct="signout"]');
    if (so) so.addEventListener("click", function () { var b = document.getElementById("sessionSignOut"); if (b) b.click(); setTimeout(openAccount, 150); });
    var si = s.querySelector('[data-acct="signin"]');
    if (si) si.addEventListener("click", function () { try { if (window.SMD_signInWithGoogle) window.SMD_signInWithGoogle(); } catch (_) {} setTimeout(openAccount, 900); });
    var del = s.querySelector('[data-acct="delete"], [data-acct="erase"]');
    if (del) del.addEventListener("click", confirmDeleteAccount);
    // Re-render the sheet live when auth resolves (sign-in can outlast a fixed timeout).
    if (!openAccount._smdSub && window.SMD_ACCOUNT && window.SMD_ACCOUNT.onChange) {
      openAccount._smdSub = true;
      window.SMD_ACCOUNT.onChange(function () { try { var sh = sheetEl(); if (sh && sh.querySelector(".hv-acct")) openAccount(); } catch (e) {} });
    }
  }
  // ---- Account + data deletion (store requirement: Apple 5.1.1(v) / Google Play) ----
  // Wipes the user's cloud cases (Firestore users/{key}/cases), every local app key,
  // and the Firebase auth account. Works for a signed-in account and for guest (local-only).
  function smdWipeLocalData() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (/^stewardmd_/.test(k) || /^smd_/.test(k) || /^ghis_/.test(k))) kill.push(k);
      }
      kill.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) {}
    try { if (window.SMD_RECENT && SMD_RECENT.clear) SMD_RECENT.clear(); } catch (e) {}
  }
  function doDeleteAccount() {
    var a = readAccount();
    var email = a && a.email;
    var uk = email ? ("u_" + email.replace(/[^a-z0-9]/gi, "_")) : "guest";
    var finish = function (msg) {
      smdWipeLocalData();
      try { closeSheet(); } catch (e) {}
      try { toast(msg); } catch (e) {}
      setTimeout(function () { try { location.reload(); } catch (e) {} }, 1000);
    };
    var afterCases = function () {
      try {
        var u = window.SMD_AUTH && SMD_AUTH.currentUser;
        if (u && u.delete) {
          var signOutFallback = function () {
            try { var b = document.getElementById("sessionSignOut"); if (b) b.click(); } catch (e) {}
            finish("Your data was deleted and you've been signed out.");
          };
          u.delete()
            .then(function () { finish("Your account and all data were deleted."); })
            .catch(function (err) {
              // Firebase needs a recent login to delete the auth record — reauthenticate
              // with Google, then retry the delete so the account is fully removed.
              if (err && err.code === "auth/requires-recent-login" && u.reauthenticateWithPopup && window.firebase) {
                try {
                  u.reauthenticateWithPopup(new firebase.auth.GoogleAuthProvider())
                    .then(function () { return u.delete(); })
                    .then(function () { finish("Your account and all data were deleted."); })
                    .catch(signOutFallback);
                  return;
                } catch (e) {}
              }
              signOutFallback();
            });
          return;
        }
      } catch (e) {}
      finish(email ? "Your data was deleted." : "All data on this device was erased.");
    };
    // NB: SMD_CASES.clear only invokes its callback on the Firestore (signed-in) path;
    // for guest (useFirestore=false) it clears synchronously and never calls back, so we
    // drive afterCases ourselves there.
    try {
      if (email && window.SMD_CASES && SMD_CASES.clear) { SMD_CASES.clear(uk, true, afterCases); }
      else { try { if (window.SMD_CASES && SMD_CASES.clear) SMD_CASES.clear(uk, false); } catch (e) {} afterCases(); }
    } catch (e) { afterCases(); }
  }
  function confirmDeleteAccount() {
    var guest = !(readAccount() && readAccount().email);
    openSheet('<div class="hv-sh-t">' + (guest ? "Erase all data?" : "Delete account &amp; data?") + '</div>' +
      '<p style="font:500 13px/1.6 var(--hfont,sans-serif);color:var(--hmut,#667);text-align:center;margin:0 0 16px">' +
      (guest
        ? "This permanently erases all saved cases and settings stored on this device. This cannot be undone."
        : "This permanently deletes your StewardMD account and all saved cases — from this device and the cloud. This cannot be undone.") + '</p>' +
      '<button id="smdDelYes" type="button" style="width:100%;background:var(--hdanger,#c0392b);color:#fff;border:none;border-radius:12px;padding:14px;font:800 15px var(--hfont,sans-serif);cursor:pointer;margin-bottom:10px">Yes, delete everything</button>' +
      '<button class="hv-back" data-close="1" type="button">Cancel</button>');
    var s = sheetEl();
    var yes = s.querySelector("#smdDelYes");
    if (yes) yes.addEventListener("click", function () { yes.disabled = true; yes.textContent = "Deleting…"; doDeleteAccount(); });
    var c = s.querySelector("[data-close]");
    if (c) c.addEventListener("click", openAccount);
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
      '<div class="smd-vh-item"><div class="smd-vh-ver">v6 · Medical Knowledge Base</div><ul>' +
        '<li><b>v6.0</b> — Every disease migrated into a single declarative Medical Knowledge Base; the reasoning engine now runs entirely from the KB — regression-locked and byte-identical to the trusted engine.</li>' +
        '<li><b>v6.1</b> — Harrison&#39;s Principles of Internal Medicine (22e) knowledge integrated into all 140 diagnostic diseases: clinical pearls, pathophysiology, mimics, red flags, prognosis, pitfalls — paraphrased and page-cited.</li>' +
        '<li><b>v6.2</b> — Knowledge base expanded to the full Harrison disease universe — <b>444 searchable entries</b> (140 diagnostic + 304 reference, including clinically-useful diagnostic &amp; procedural chapters), each with a page-cited Harrison reference panel.</li>' +
        '<li><b>v6.3</b> — Reasoning upgrades: the stewardship engine now covers all 140 diagnoses, smart next-question suggestions, and broader non-infective finding inputs.</li>' +
        '<li><b>v6.4</b> — AI-ready infrastructure (RAG-ready knowledge index, evidence engine, AI interface) — fully functional with no AI today, and AI-ready (decision-first, explanation second).</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v7 · Redesigned workspace</div><ul>' +
        '<li><b>v7.0</b> — Ground-up redesign of the mobile home — editorial layout, personalised time-based greeting, and the StewardMD banner as an antibiotic decision engine.</li>' +
        '<li><b>v7.1</b> — New <b>Antibiogram</b> explorer: an interactive antibiotic-coverage grid (green/red spectrum of activity) plus resistance rates from the ICMR AMRSN 2024 national antibiogram and the GIMSR hospital antibiogram.</li>' +
        '<li><b>v7.2</b> — Ward Sync fetches live reports (labs / medications) directly from the GHIS hospital system for point-of-care calculators.</li>' +
        '<li><b>v7.3</b> — Whole-app appearance themes now recolour the home too; restored the sidebar menu and a universal Home button on every screen.</li>' +
        '<li><b>v7.4</b> — Brand polish: rounded StewardMD wordmark, refreshed footer with the MaiKnowledge signature.</li>' +
        '<li><b>v7.5</b> — Native iOS &amp; Android apps (Capacitor): StewardMD is now installable as a real app, with offline clinical data and native push notifications.</li>' +
        '<li><b>v7.6</b> — MaiK, the AI clinical assistant: grounded, page-cited explanations with comparison tables, per-claim citations, and streaming answers — decision first, explanation second.</li>' +
        '<li><b>v7.7</b> — Knowledge Units: earn points as you read references and work cases, unlocking subscription discounts.</li>' +
        '<li><b>v7.8</b> — Lab Watch: monitor a patient&#39;s labs for new results — in-app alerts plus optional 24/7 background alerts (Ward Sync / GHIS-linked, consent-gated) even when the app is closed.</li>' +
        '<li><b>v7.9</b> — App-style navigation is now the default (bottom tab bar, quick-action tiles); plus reliability &amp; alignment polish across web, iOS and Android (global toast feedback, home-tile and sidebar alignment fixes).</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver">v8 · Reference-grade breadth</div><ul>' +
        '<li><b>v8.0</b> — Calculators expanded to an MDCalc-scale library — <b>400+</b> validated bedside tools across every specialty, each formula executed and checked before shipping.</li>' +
        '<li><b>v8.1</b> — Knowledge base grown to <b>4,800+</b> searchable conditions (Harrison plus Nelson paediatrics, ophthalmology and further specialties), each with a page-cited reference panel.</li>' +
        '<li><b>v8.2</b> — Scores wired to diagnoses: relevant clinical scores are suggested on every diagnosis, and the ICU dashboard now auto-computes scores (SOFA, qSOFA, NEWS2, APACHE II, BISAP, MELD…) from fetched labs and vitals — tap any score to open the calculator pre-filled.</li>' +
        '<li><b>v8.3</b> — Management for every reference condition: condition-specific, guideline-aligned management now appears on all <b>4,600+</b> reference diseases (AI-drafted decision-support — verify before acting).</li>' +
      '</ul></div>' +
      '<div class="smd-vh-item"><div class="smd-vh-ver"><span class="smd-vh-now">v9 · Clinical command centre (current)</span></div><ul>' +
        '<li><b>v9.0</b> — ICU &amp; Ward dashboard: real-time collaborative unit boards (ICU / MICU / wards), a live care team with clinical designations &amp; permissions, shift handover, and task instructions with native push.</li>' +
        '<li><b>v9.1</b> — Ward Sync 2.0: tick a GHIS patient to add them straight to your unit board; per-patient, device-secure auto-fetch keeps their labs &amp; imaging fresh; full patient info (MR, treating doctor, department) imported.</li>' +
        '<li><b>v9.2</b> — Doctor verification: an NMC registration check unlocks verified access, with an owner admin console.</li>' +
        '<li><b>v9.3</b> — Engagement: reading streaks, levels, quests, badges and a shareable stats card.</li>' +
        '<li><b>v9.4</b> — Prescription generator (℞) and a drug&ndash;drug interaction checker.</li>' +
        '<li><b>v9.5</b> — Calculator results now flow back to the ICU Scores panel — compute any score in the full calculator and it&#39;s saved on the patient.</li>' +
      '</ul></div>' +
    '</div>' +
    '<p style="font-size:11.5px;color:var(--slate-soft);margin-top:6px">The development journey of StewardMD — built and refined case by case at the bedside.</p>';
  }
  function aboutFactsHTML() {
    return '<span class="smd-ab-badge">By the numbers</span>' +
      '<ul class="smd-facts">' +
      '<li><span class="fn">4,804</span> searchable conditions — 140 with full diagnostic reasoning + 4,664 reference conditions, each with a page-cited reference panel and condition-specific management.</li>' +
      '<li><span class="fn">51</span> infective syndromes, each with a full empiric-therapy stewardship rationale.</li>' +
      '<li><span class="fn">21,487</span> page-cited Harrison 22e knowledge chunks — RAG-ready, no AI required.</li>' +
      '<li><span class="fn">1,465</span> drug monographs in structured &quot;gold&quot; format.</li>' +
      '<li><span class="fn">405</span> bedside clinical calculators — MDCalc-scale, every formula executed &amp; checked.</li>' +
      '<li><span class="fn">13</span> dedicated electrolyte analysis engines.</li>' +
      '<li><span class="fn">47</span> antibiotics × <span class="fn">23</span> organisms (6 clinical groups) in the interactive coverage grid, plus <span class="fn">2</span> antibiogram sources — ICMR AMRSN 2024 national + GIMSR hospital resistance rates.</li>' +
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
      '<button class="smd-ab-tab" data-t="ack" type="button">Acknowledgements</button>' +
      '<button class="smd-ab-tab" data-t="version" type="button">Version history</button>' +
      '<button class="smd-ab-tab" data-t="facts" type="button">Facts &amp; milestones</button>';
    var vPanel = document.createElement("div"); vPanel.className = "smd-ab-panel"; vPanel.setAttribute("data-tab", "version"); vPanel.style.display = "none"; vPanel.innerHTML = aboutVersionHTML();
    var fPanel = document.createElement("div"); fPanel.className = "smd-ab-panel"; fPanel.setAttribute("data-tab", "facts"); fPanel.style.display = "none"; fPanel.innerHTML = aboutFactsHTML();
    var aPanel = document.createElement("div"); aPanel.className = "smd-ab-panel"; aPanel.setAttribute("data-tab", "ack"); aPanel.style.display = "none"; aPanel.innerHTML = ackHTML();
    body.appendChild(nav); body.appendChild(aboutPanel); body.appendChild(vPanel); body.appendChild(fPanel); body.appendChild(aPanel);
    nav.addEventListener("click", function (e) {
      var b = e.target.closest("[data-t]"); if (!b) return;
      var t = b.getAttribute("data-t");
      nav.querySelectorAll(".smd-ab-tab").forEach(function (x) { x.classList.toggle("on", x === b); });
      body.querySelectorAll(".smd-ab-panel").forEach(function (pn) { pn.style.display = (pn.getAttribute("data-tab") === t) ? "" : "none"; });
      body.scrollTop = 0;
    });
  }
  // Acknowledgements content — shared by the About-box "Acknowledgements" tab and the legacy sheet.
  function ackHTML() {
    var src = document.getElementById("ackCard");
    if (src) {
      var c = src.cloneNode(true);
      c.removeAttribute("id");
      var hdr = c.querySelector(".ack-header-row"); if (hdr) hdr.parentNode.removeChild(hdr);
      c.classList.add("hv-ack-inline");
      return '<div class="hv-ack">' + c.outerHTML + '</div>';
    }
    return '<div class="hv-ack" style="text-align:center;color:var(--hmut);font:500 13px/1.6 var(--hfont)">' +
      '<p><b>Concept, content &amp; development</b><br>Dr. Manoj Kumar Kurmana, MD</p>' +
      '<p>Developed by MaiKnowledge.</p></div>';
  }
  // Open the About box (optionally to a tab: about|version|facts|ack). Exposed globally so the
  // redesigned sidebar's "About & Acknowledgements" item opens it (acknowledgements live in About).
  function openAbout(tab) {
    try { enhanceAbout(); } catch (e) {}
    try { if (window.SB && SB.modal) SB.modal("aboutModal"); else if (typeof openModal === "function") openModal("aboutModal"); } catch (e) {}
    if (tab) { try { var m = document.getElementById("aboutModal"); var b = m && m.querySelector('.smd-ab-tab[data-t="' + tab + '"]'); if (b) b.click(); } catch (e) {} }
  }
  try { window.openAbout = openAbout; window.openAck = openAck; } catch (e) {}
  function openAck() {
    var src = document.getElementById("ackCard");
    var inner = "";
    if (src) {
      var c = src.cloneNode(true);
      c.removeAttribute("id");
      var hdr = c.querySelector(".ack-header-row"); if (hdr) hdr.parentNode.removeChild(hdr);
      // The names carry rich hover tooltips (.ack-tip / .creator-tip: roles, bios, publications).
      // Hover doesn't exist on touch and, cloned here, they'd overlap. Mark this clone so the
      // sheet CSS renders every tooltip INLINE as a readable card (see .hv-ack .ack-tip below) —
      // so all contributor descriptions and the creator profile are fully visible, not hidden.
      c.classList.add("hv-ack-inline");
      inner = '<div class="hv-ack">' + c.outerHTML + '</div>';
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
    // Prefer the full Pro paywall (plans + PhonePe checkout); fall back to the simple notice below.
    try { if (window.SMD_PRO && SMD_PRO.openPaywall) { SMD_PRO.openPaywall("menu"); return; } } catch (e) {}
    openSheet('<div class="hv-sh-t">Subscription</div>' +
      '<div style="text-align:center;padding:6px 4px 2px">' +
        '<div style="font:800 30px/1 var(--hfont);color:var(--hp)"><span style="text-decoration:line-through;color:var(--hmut);font-size:19px;font-weight:700">₹999 / year</span>&nbsp;&nbsp;Free</div>' +
        '<div style="font:600 13px var(--hfont);color:var(--hmut);margin-top:7px">Free for all doctors for now — full access while we test.</div>' +
      '</div>' +
      '<div style="margin-top:14px;border:1px solid var(--hbd);border-radius:14px;padding:14px;background:var(--hbg)">' +
        '<div style="font:700 12px var(--hfont);text-transform:uppercase;letter-spacing:.05em;color:var(--hmut);margin-bottom:8px">Included</div>' +
        '<div style="font:500 13px/1.9 var(--hfont);color:var(--hink)">' + svg("check", "smd-ico") + ' Full antibiotic decision engine<br>' + svg("check", "smd-ico") + ' 1,465-drug database — doses &amp; brands<br>' + svg("check", "smd-ico") + ' 400+ calculators · guidelines · ICU tools<br>' + svg("check", "smd-ico") + ' Clinical Reasoning</div>' +
      '</div>' +
      '<button class="hv-reset" style="background:var(--hp);color:#fff;border-color:var(--hp);margin-top:14px" data-close="1">Continue — it\'s free</button>');
    var subClose = sheetEl().querySelector("[data-close]");
    if (subClose) subClose.addEventListener("click", closeSheet);
  }
  function openDxChooser() {
    // If a specialty workspace (e.g. Surgery) is the active clinical workspace, start a new
    // case in THAT engine instead of the Internal Medicine chooser. IM → falls through below.
    try { if (window.SMD_WS && SMD_WS.startActiveCase && SMD_WS.startActiveCase()) return; } catch (e) {}
    openSheet('<div class="hv-sh-t">Dx My Patient</div>' +
      '<p style="font:500 13px/1.5 var(--hfont);color:var(--hmut);text-align:center;margin:0 0 16px">Reason through a patient — live differential, confidence &amp; next steps.</p>' +
      '<button id="dxAddNew" style="width:100%;background:var(--hp);color:#fff;border:none;border-radius:12px;padding:14px;font:800 15px var(--hfont);cursor:pointer;margin-bottom:10px;text-align:center">' + window.icon("plus") + ' Add New Patient<div style="font:500 11.5px var(--hfont);opacity:.9;margin-top:2px">Enter symptoms &amp; findings manually</div></button>' +
      '<button id="dxImportPt" style="width:100%;background:var(--hpanel);color:var(--hink);border:1px solid var(--hbd);border-radius:12px;padding:14px;font:800 15px var(--hfont);cursor:pointer;margin-bottom:10px;text-align:center">' + window.icon("hospital") + ' Import Patient<div style="font:500 11.5px var(--hfont);color:var(--hmut);margin-top:2px">Pull labs · imaging · culture from Ward Sync, then add symptoms</div></button>' +
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
  var MAIK_LS = "smd_maik_thread";
  function maikSaveThread(h) { try { localStorage.setItem(MAIK_LS, h || ""); } catch (e) {} }
  // full rendered conversation (questions + answers); persisted device-local so it survives reloads/app relaunch (cleared with the New button). It is the app's own escaped markup, restored the same way the in-session copy already was.
  var _maikBodyHTML = (function () { try { return localStorage.getItem(MAIK_LS) || ""; } catch (e) { return ""; } })();
  var _maikBusy = false;          // idempotency guard: one in-flight provider call at a time
  var _maikCache = {};            // session cache: normalized clinical query → rendered answer HTML
  // Session-only conversation topic memory (smd_maik_v2): current canonical clinical topic so
  // follow-ups ("give in detail", "what antibiotics?", "dose?", "what next?") resolve against it
  // instead of being treated as new questions. Never persisted; not PHI; cleared on close.
  var _maikTopic = null;          // { topic, question, depth, lastDrug, ts }
  var _maikTurns = [];            // recent {q, a-gist} turns sent to the provider for conversational continuity (not persisted; not PHI)
  function maikV2() { try { var v = localStorage.getItem("smd_maik_v2"); return v === null ? true : v !== "0"; } catch (e) { return true; } }
  function maikEscH(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // ── MaiK "Aurora" wordmark + icon set (design_handoff_maik_assistant/IMPLEMENTATION.md §2) ──
  var MK_LOGO = function () { return (document.body.classList.contains("dark") || document.body.classList.contains("v3-dark")) ? "/maik-wordmark-white.png" : "/maik-wordmark-color.png"; };
  var MK = {
    new: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    close: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--mk-teal)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/></svg>',
    spark: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mk-teal)" stroke-width="2" stroke-linejoin="round"><path d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4Z"/></svg>',
    book: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    mic: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/></svg>',
    send: '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
    cAssess: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg>',
    cKnow: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M3 5h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v13h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3H3Z"/></svg>',
    cDrug: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 13.5 3 21"/><path d="M2 18a4 4 0 0 0 6 3l9-9a4 4 0 0 0-6-6L2 14a4 4 0 0 0 0 4Z"/></svg>'
  };
  // §3 sheet shell — markup verbatim from IMPLEMENTATION.md (kept the app's extract label so it
  // stays consistent with the extract handler's own text; #maikClose replaces the old #maikX id).
  function maikShellHTML() {
    return '' +
      '<div class="maik-grab" id="maikGrab" aria-hidden="true"></div>' +
      '<div class="maik-hd"><div class="maik-hd-row">' +
        '<div class="maik-logo-wrap"><div class="maik-logo-glow"></div><img class="maik-logo" src="' + MK_LOGO() + '" alt="MaiK"></div>' +
        '<span style="flex:1"></span>' +
        '<button class="maik-hd-btn" id="maikNew" type="button" title="New conversation" aria-label="New conversation">' + MK.new + '</button>' +
        '<button class="maik-hd-btn" id="maikClose" type="button" title="Close" aria-label="Close assistant">' + MK.close + '</button>' +
      '</div></div>' +
      '<div class="maik-disc">' + MK.shield + '<span>Grounded &middot; AI-generated, verify independently</span></div>' +
      '<div class="maik-body" id="maikBody"></div>' +
      '<div class="maik-cmp">' +
        '<button class="maik-extract" id="maikExtract" type="button">' + svg("brain", "smd-ico") + ' Extract findings for Clinical Reasoning →</button>' +
        '<div class="maik-cmp-in">' +
          '<button class="maik-mic" id="maikMic" type="button" title="Dictate" aria-label="Dictate to MaiK">' + MK.mic + '</button>' +
          '<textarea class="maik-ta" id="maikQ" rows="1" placeholder="Ask a clinical question…"></textarea>' +
          '<button class="maik-send" id="maikSend" type="button" title="Send" aria-label="Send">' + MK.send + '</button>' +
        '</div>' +
      '</div>';
  }
  // ── MaiK "Aurora" styles: IMPLEMENTATION.md §1 verbatim, then a support block (retokenized to
  //    --mk-*) that keeps the app's markdown answers, streaming caret, tables, <details> sources,
  //    chips, welcome/edu/assume notes and FAB-hiding working. #maikSheet lives outside #homeV2, so
  //    the tokens sit on the sheet itself and flip via `body.dark #maikSheet` (+ v3-dark mirror). ──
  function maikCSS() {
    if (document.getElementById("maik-sheet-css")) return;
    var st = document.createElement("style"); st.id = "maik-sheet-css";
    st.textContent = `
#maikScrim{position:fixed;inset:0;background:rgba(15,23,42,.45);opacity:0;pointer-events:none;transition:opacity .2s;z-index:998}
#maikScrim.on{opacity:1;pointer-events:auto}
#maikSheet{
  --mk-bg:#fff;--mk-ink:#0f172a;--mk-mut:#64748b;--mk-faint:#9aa7b6;--mk-bd:#eaeef3;--mk-soft:#f5f7f9;--mk-field:#f2f5f8;
  --mk-teal:#0f766e;--mk-tsoft:#d7f5ef;--mk-acc:#2563eb;--mk-glow:rgba(20,184,166,.35);
  --mk-userbub:linear-gradient(140deg,#15a89a,#0f766e);--mk-userink:#fff;--mk-usersh:0 4px 12px rgba(15,118,110,.28);
  --mk-send:linear-gradient(140deg,#19b8a8,#0e6e63);
  position:fixed;left:0;right:0;bottom:0;z-index:999;height:86vh;max-height:86vh;
  background:var(--mk-bg);border-radius:20px 20px 0 0;box-shadow:0 -8px 40px rgba(0,0,0,.28);
  display:flex;flex-direction:column;overflow:hidden;
  transform:translateY(100%);transition:transform .24s cubic-bezier(.4,0,.2,1);
  font-family:'Inter',-apple-system,system-ui,sans-serif}
#maikSheet.on{transform:translateY(0)}
body.dark #maikSheet{
  --mk-bg:#101a2c;--mk-ink:#eaf0f7;--mk-mut:#8c9ab0;--mk-faint:#5d6e86;--mk-bd:#233149;--mk-soft:#182338;--mk-field:#0e1829;
  --mk-teal:#2dd4bf;--mk-tsoft:#0e2e2b;--mk-acc:#7db3ff;--mk-glow:rgba(45,212,191,.42);
  --mk-userbub:linear-gradient(140deg,#0f766e,#0b5a53);--mk-userink:#eafff9;--mk-usersh:0 4px 12px rgba(0,0,0,.35);
  box-shadow:0 -8px 40px rgba(0,0,0,.6)}

.maik-grab{width:38px;height:5px;border-radius:3px;background:var(--mk-bd);margin:9px auto 2px;flex:0 0 auto;cursor:grab}

/* header (shared) */
.maik-hd{position:relative;padding:8px 14px 10px;background:linear-gradient(180deg,var(--mk-tsoft),transparent);flex:0 0 auto}
.maik-hd-row{display:flex;align-items:center;gap:11px}
.maik-logo-wrap{position:relative;display:flex;align-items:center;flex:0 0 auto}
.maik-logo-glow{position:absolute;left:-8px;right:-8px;top:-4px;bottom:-4px;border-radius:50%;background:radial-gradient(ellipse,var(--mk-glow),transparent 70%)}
.maik-logo{position:relative;height:24px;width:auto;display:block}
.maik-hd-btn{width:34px;height:34px;border-radius:50%;border:1px solid var(--mk-bd);background:var(--mk-soft);color:var(--mk-ink);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;transition:.15s}
.maik-hd-btn:hover{border-color:var(--mk-teal);color:var(--mk-teal)}
.maik-hd-btn:active{transform:scale(.94)}

/* disclaimer (shared, wraps — never clips) */
.maik-disc{display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--mk-soft);border-top:1px solid var(--mk-bd);border-bottom:1px solid var(--mk-bd);flex:0 0 auto}
.maik-disc svg{flex:0 0 auto}
.maik-disc span{font:600 11px/1.3 'Inter';color:var(--mk-mut)}

/* body (shared scroll area) */
.maik-body{position:relative;flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px}
.maik-wm{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:230px;opacity:.05;pointer-events:none}
body.dark .maik-wm{opacity:.06}

/* EMPTY / START screen (from #2b) */
.maik-empty{position:relative;flex:1;display:flex;flex-direction:column;justify-content:center;padding:6px 4px}
.maik-hero{display:flex;flex-direction:column;align-items:center;margin-bottom:16px}
.maik-hero-logo{position:relative;display:flex;align-items:center;justify-content:center;padding:5px 0}
.maik-hero-glow{position:absolute;width:160px;height:64px;border-radius:50%;background:radial-gradient(ellipse,var(--mk-glow),transparent 70%);animation:maikGlow 3.2s ease-in-out infinite}
.maik-hero-logo img{position:relative;height:32px;width:auto;display:block}
.maik-kicker{font:700 10px 'Inter';color:var(--mk-teal);text-transform:uppercase;letter-spacing:.09em;margin-top:8px}
.maik-h1{font:800 22px/1.24 'Inter';letter-spacing:-.02em;color:var(--mk-ink)}
.maik-sub{font:500 12.5px/1.5 'Inter';color:var(--mk-mut);margin-top:8px}
.maik-cards{margin-top:15px;display:flex;flex-direction:column;gap:8px}
.maik-card{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--mk-bd);border-radius:14px;background:var(--mk-bg);cursor:pointer;text-align:left;box-shadow:0 1px 2px rgba(15,23,42,.04);transition:.15s}
.maik-card:hover{border-color:var(--mk-teal);box-shadow:0 6px 16px rgba(15,118,110,.14)}
body.dark .maik-card{background:var(--mk-soft);box-shadow:none}
.maik-card-ic{width:34px;height:34px;border-radius:10px;background:linear-gradient(140deg,var(--mk-tsoft),var(--mk-soft));color:var(--mk-teal);display:flex;align-items:center;justify-content:center;flex:0 0 auto}
body.dark .maik-card-ic{background:var(--mk-tsoft)}
.maik-card-tx{flex:1;min-width:0}
.maik-card-tt{display:block;font:700 13px 'Inter';color:var(--mk-ink)}
.maik-card-sb{display:block;font:500 11px 'Inter';color:var(--mk-mut);margin-top:1px}
.maik-card-ch{color:var(--mk-faint);display:flex}

/* CONVERSATION bubbles (from #final) */
.maik-b{position:relative;max-width:92%}
.maik-b.you{align-self:flex-end;max-width:82%;background:var(--mk-userbub);color:var(--mk-userink);border-radius:16px 16px 6px 16px;padding:9px 12px;font:500 12.5px/1.5 'Inter';box-shadow:var(--mk-usersh)}
.maik-b.ai{align-self:flex-start;background:var(--mk-soft);border:1px solid var(--mk-bd);border-radius:16px 16px 16px 6px;padding:11px 13px;box-shadow:0 2px 8px rgba(15,23,42,.05)}
body.dark .maik-b.ai{box-shadow:0 2px 8px rgba(0,0,0,.25)}
.maik-attr{display:flex;align-items:center;gap:6px;margin-bottom:7px}
.maik-attr span{font:800 10.5px 'Inter';color:var(--mk-teal);text-transform:uppercase;letter-spacing:.06em}
.maik-h{font:800 12.5px 'Inter';color:var(--mk-ink);margin-bottom:4px}
.maik-p{font:500 12px/1.5 'Inter';color:var(--mk-ink)}
.maik-ul{margin:6px 0 2px;display:flex;flex-direction:column;gap:4px}
.maik-li{display:flex;gap:7px;font:500 12px/1.45 'Inter';color:var(--mk-ink)}
.maik-li .dot{color:var(--mk-teal);font-weight:800}
.maik-cite{color:var(--mk-acc);font-weight:700;font-size:.7em;vertical-align:super}
.maik-note{font:500 11.5px/1.45 'Inter';color:var(--mk-mut);margin-top:6px}
.maik-src{margin-top:9px;padding-top:8px;border-top:1px solid var(--mk-bd);display:flex;align-items:center;gap:6px;font:600 10.5px 'Inter';color:var(--mk-teal)}
.maik-followups{position:relative;display:flex;flex-wrap:wrap;gap:7px;margin-top:1px}
.maik-fu{font:600 11.5px 'Inter';color:var(--mk-teal);background:var(--mk-tsoft);border:1px solid var(--mk-tsoft);border-radius:999px;padding:6px 11px;cursor:pointer;transition:.15s}
.maik-fu:hover{border-color:var(--mk-teal)}

/* composer (shared) */
.maik-cmp{padding:6px 14px 15px;flex:0 0 auto}
.maik-extract{width:100%;margin-bottom:8px;padding:9px;border:1px dashed var(--mk-teal);border-radius:12px;background:transparent;color:var(--mk-teal);font:700 12px 'Inter';cursor:pointer;display:none}
.maik-extract.show{display:block}
.maik-cmp-in{display:flex;align-items:center;gap:8px;background:var(--mk-bg);border:1px solid var(--mk-bd);border-radius:24px;padding:6px 6px 6px 8px;box-shadow:0 6px 20px rgba(15,23,42,.1);transition:.15s}
body.dark .maik-cmp-in{background:var(--mk-field);box-shadow:0 6px 20px rgba(0,0,0,.3)}
.maik-cmp-in:focus-within{border-color:var(--mk-teal)}
.maik-mic{width:36px;height:36px;border-radius:50%;border:none;background:var(--mk-soft);color:var(--mk-mut);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;transition:.15s}
.maik-mic:hover{color:var(--mk-teal);background:var(--mk-tsoft)}
.maik-mic.live{background:#fee2e2;color:#dc2626;animation:maikPulse 1.2s ease-in-out infinite}
.maik-ta{flex:1;border:none;background:transparent;outline:none;resize:none;font:500 14px 'Inter';color:var(--mk-ink);max-height:88px;padding:8px 0}
.maik-ta::placeholder{color:var(--mk-faint)}
.maik-send{width:40px;height:40px;border-radius:50%;border:none;background:var(--mk-send);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;box-shadow:0 6px 16px rgba(15,118,110,.5)}
.maik-send:active{transform:scale(.94)}

@keyframes maikGlow{0%,100%{opacity:.5;transform:scale(1)}50%{opacity:.92;transform:scale(1.08)}}
@keyframes maikPulse{0%,100%{box-shadow:0 0 0 0 rgba(220,38,38,.4)}50%{box-shadow:0 0 0 6px rgba(220,38,38,0)}}
` + `
/* ── support: app behaviors mapped onto the Aurora tokens (not a design change) ── */
#maikSheet{color:var(--mk-ink)}
#maikSheet *{box-sizing:border-box}
body.v3-dark #maikSheet{--mk-bg:#101a2c;--mk-ink:#eaf0f7;--mk-mut:#8c9ab0;--mk-faint:#5d6e86;--mk-bd:#233149;--mk-soft:#182338;--mk-field:#0e1829;--mk-teal:#2dd4bf;--mk-tsoft:#0e2e2b;--mk-acc:#7db3ff;--mk-glow:rgba(45,212,191,.42);--mk-userbub:linear-gradient(140deg,#0f766e,#0b5a53);--mk-userink:#eafff9;--mk-usersh:0 4px 12px rgba(0,0,0,.35);box-shadow:0 -8px 40px rgba(0,0,0,.6)}
body.v3-dark .maik-wm{opacity:.06}
body.v3-dark #maikSheet .maik-b.ai{box-shadow:0 2px 8px rgba(0,0,0,.25)}
body.v3-dark #maikSheet .maik-card{background:var(--mk-soft);box-shadow:none}
body.v3-dark #maikSheet .maik-card-ic{background:var(--mk-tsoft)}
body.v3-dark #maikSheet .maik-cmp-in{background:var(--mk-field);box-shadow:0 6px 20px rgba(0,0,0,.3)}
@media (prefers-reduced-motion:reduce){.maik-logo-glow,.maik-hero-glow,.maik-mic.live{animation:none}}
/* markdown answer body (SMD_MaiK.renderMarkdown output) inside the AI bubble */
.maik-b.ai>*:first-child{margin-top:0}
.maik-b.ai p{margin:6px 0;font:500 12.5px/1.55 'Inter';color:var(--mk-ink)}
.maik-b.ai h1,.maik-b.ai h2,.maik-b.ai h3,.maik-b.ai h4{font:800 12.5px/1.35 'Inter';color:var(--mk-ink);margin:10px 0 4px}
.maik-b.ai ul,.maik-b.ai ol{margin:6px 0;padding-left:18px}
.maik-b.ai li{margin:3px 0;font:500 12.5px/1.5 'Inter';color:var(--mk-ink)}
.maik-b.ai ul li::marker{color:var(--mk-teal)}
.maik-b.ai strong,.maik-b.ai b{font-weight:800;color:var(--mk-ink)}
.maik-b.ai em{font-style:italic}
.maik-b.ai code{background:rgba(100,116,139,.15);border-radius:4px;padding:0 4px;font:500 12px/1.4 ui-monospace,monospace;color:var(--mk-ink)}
.maik-b.ai a{color:var(--mk-acc);text-decoration:underline}
.maik-collapsed{position:relative}
/* streaming caret + thinking dots (kept, retokenized) */
.maik-streaming{font:500 12.5px/1.55 'Inter';color:var(--mk-ink)}
.maik-caret{display:inline-block;width:6px;height:13px;background:var(--mk-acc);margin-left:2px;vertical-align:text-bottom;animation:maikBlink 1s steps(2) infinite}
@keyframes maikBlink{0%,100%{opacity:1}50%{opacity:0}}
.maik-thinking{color:var(--mk-mut);font:500 12.5px 'Inter'}
.maik-thinking .d{display:inline-block;animation:maikThink 1.3s ease-in-out infinite}
.maik-thinking .d2{animation-delay:.18s}.maik-thinking .d3{animation-delay:.36s}
@keyframes maikThink{0%,100%{opacity:.45}50%{opacity:1}}
/* tables */
.maik-tblwrap{overflow-x:auto;margin:8px 0;-webkit-overflow-scrolling:touch}
.maik-tbl{border-collapse:collapse;width:100%;font:400 12px 'Inter'}
.maik-tbl th,.maik-tbl td{border:1px solid var(--mk-bd);padding:6px 9px;text-align:left;vertical-align:top;color:var(--mk-ink)}
.maik-tbl th{background:var(--mk-soft);font-weight:700}
.maik-cite{cursor:pointer;padding:0 1px;line-height:0}
/* expandable <details> sources — the app uses <details class="maik-src">, so make it a
   disclosure block (overrides the spec's flat flex row while keeping its border/spacing/teal) */
.maik-src{display:block}
.maik-src summary{cursor:pointer;color:var(--mk-teal);display:flex;align-items:center;gap:5px;list-style:none;font:600 10.5px 'Inter'}
.maik-src summary::-webkit-details-marker{display:none}
.maik-src summary svg{width:12px;height:12px}
.maik-src ol{margin:6px 0 0 18px;padding:0;color:var(--mk-mut);font:500 10.5px/1.5 'Inter'}
.maik-src li{margin:2px 0}
.maik-more{background:none;border:none;color:var(--mk-teal);font:700 12px 'Inter';cursor:pointer;padding:4px 0}
/* generic chips still used by web-research / Rx / help / patient / extract replies */
.maik-chip{background:var(--mk-tsoft);border:1px solid var(--mk-tsoft);border-radius:999px;padding:6px 11px;font:600 11.5px 'Inter';color:var(--mk-teal);cursor:pointer}
.maik-chip:hover{border-color:var(--mk-teal)}
.maik-chip:active{transform:scale(.96)}
/* status / helper note bubbles */
.maik-welcome{font:500 12.5px/1.55 'Inter';color:var(--mk-ink)}
.maik-edu{font:600 11px 'Inter';color:var(--mk-mut);background:var(--mk-soft);border-radius:10px;padding:6px 9px;margin-bottom:6px}
.maik-assume{font:600 12px 'Inter';color:var(--mk-ink);background:rgba(37,99,235,.08);border-left:3px solid var(--mk-acc);border-radius:10px;padding:7px 10px;margin-bottom:8px}
.maik-assume b{color:var(--mk-acc)}
/* content sits above the faint watermark */
.maik-body>.maik-wm{z-index:0}
.maik-body>*:not(.maik-wm){position:relative;z-index:1}
/* keep launch FABs (they sit at a high z-index) from floating over the sheet */
body.maik-open #hvFab,body.maik-open #infFab,body.maik-open #dxLaunch,body.maik-open .inf-fab,body.maik-open .ghis-ward-fab,body.maik-open .hv-fab{display:none!important}
`;
    (document.head || document.documentElement).appendChild(st);
  }
  function maikActiveCase() { try { return !!(window.DX && DX._state && Object.keys(DX._state.f || {}).length >= 1); } catch (e) { return false; } }
  function openAskAi(prefill) {
    maikCSS();
    var old = document.getElementById("maikSheet");
    if (old) { var ob = old.querySelector("#maikBody"); if (ob && ob.innerHTML.trim()) _maikBodyHTML = ob.innerHTML; old.remove(); }
    var oldS = document.getElementById("maikScrim"); if (oldS) oldS.remove();
    var scrim = document.createElement("div"); scrim.id = "maikScrim"; document.body.appendChild(scrim);
    var sheet = document.createElement("div"); sheet.id = "maikSheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Ask MaiK");
    sheet.innerHTML = maikShellHTML();
    document.body.appendChild(sheet);
    document.body.classList.add("maik-open");
    requestAnimationFrame(function () { scrim.classList.add("on"); sheet.classList.add("on"); });
    var body = sheet.querySelector("#maikBody"), qEl = sheet.querySelector("#maikQ"), sendBtn = sheet.querySelector("#maikSend");
    function close() { try { if (body && body.innerHTML.trim()) { _maikBodyHTML = body.innerHTML; maikSaveThread(_maikBodyHTML); } } catch (e) {} sheet.classList.remove("on"); scrim.classList.remove("on"); document.body.classList.remove("maik-open"); setTimeout(function () { sheet.remove(); scrim.remove(); }, 260); }
    function scroll() { body.scrollTop = body.scrollHeight; }
    // Prepend the faint centered wordmark watermark (§1 .maik-wm) behind the thread the first time a
    // bubble is added. emptyState() renders its own hero logo instead, so it deliberately omits this.
    function bubble(who, html) { if (!body.querySelector(".maik-wm")) { var wm = document.createElement("img"); wm.className = "maik-wm"; wm.src = MK_LOGO(); wm.alt = ""; wm.setAttribute("aria-hidden", "true"); body.insertBefore(wm, body.firstChild); } var d = document.createElement("div"); d.className = "maik-b " + (who === "you" ? "you" : "ai"); d.innerHTML = html; body.appendChild(d); scroll(); try { _maikBodyHTML = body.innerHTML; maikSaveThread(_maikBodyHTML); } catch (e) {} return d; }
    // (chips() removed — Aurora uses the §4 start-screen cards and §5 .maik-fu follow-ups instead)
    // Aurora start screen (IMPLEMENTATION.md §4, reference #2b): glowing hero wordmark + kicker,
    // headline, sub, and three list cards. Active-case swaps to the three case-aware prompts. Same
    // handlers as before (openDxChooser / focus #maikQ / Drug Index).
    function emptyState() {
      var active = maikActiveCase();
      var cards = active ? [
        ["cAssess", "What findings are missing?", "Complete the picture"],
        ["cKnow", "Explain this differential", "Reasoning & evidence"],
        ["cDrug", "What investigations next?", "Targeted workup"]
      ] : [
        ["cAssess", "Start a clinical assessment", "Guided differential & workup"],
        ["cKnow", "Ask a knowledge question", "Cited, page-level answers"],
        ["cDrug", "Open Drug Index & calculators", "Doses, spectrum, tools"]
      ];
      var cardHTML = cards.map(function (c, i) {
        return '<button class="maik-card" data-mk-card="' + i + '">' +
          '<span class="maik-card-ic">' + MK[c[0]] + '</span>' +
          '<span class="maik-card-tx"><span class="maik-card-tt">' + maikEscH(c[1]) + '</span><span class="maik-card-sb">' + maikEscH(c[2]) + '</span></span>' +
          '<span class="maik-card-ch">' + MK.chevron + '</span></button>';
      }).join("");
      body.innerHTML = '<div class="maik-empty">' +
        '<div class="maik-hero"><div class="maik-hero-logo"><div class="maik-hero-glow"></div><img src="' + MK_LOGO() + '" alt="MaiK"></div><div class="maik-kicker">Medical AI Knowledge</div></div>' +
        '<div class="maik-h1">Ask MaiK anything clinical.</div>' +
        '<div class="maik-sub">Grounded answers from StewardMD&rsquo;s knowledge base &mdash; with sources you can verify.</div>' +
        '<div class="maik-cards">' + cardHTML + '</div></div>';
      var cardEls = body.querySelectorAll(".maik-card");
      if (active) {
        var qs = ["What findings are missing for the current differential?", "Explain the leading diagnosis in the current assessment.", "What investigations should I order next?"];
        cardEls.forEach(function (el, i) { el.addEventListener("click", function () { qEl.value = qs[i]; send(); }); });
      } else {
        if (cardEls[0]) cardEls[0].addEventListener("click", function () { close(); try { openDxChooser(); } catch (e) {} });
        if (cardEls[1]) cardEls[1].addEventListener("click", function () { qEl.value = "How to treat organophosphate poisoning?"; try { qEl.focus(); } catch (e) {} });
        if (cardEls[2]) cardEls[2].addEventListener("click", function () { close(); var b = document.querySelector('#homeV2 [data-act="drugs"]'); if (b) b.click(); else if (typeof toast === "function") toast("Open Drugs from the home screen."); });
      }
      scroll();
    }
    // patient-specific (individualized) request with NO active case → redirect, don't answer
    function isPatientSpecific(q) { return /\b(my patient|this patient|the patient|my case|this case|should i (give|start|prescribe|treat)|what.?s wrong with|dose for (my|this)|diagnos(e|is) (my|this))\b/i.test(q) || /\b(mrn|uhid)\b/i.test(q) || /\bpatient\s+[a-z]+\s+(has|with|is|presenting|aged)/i.test(q) || /\bgive (him|her|them|the patient)\b/i.test(q) || /\b\d{1,3}\s*(yo|y\/o|year[- ]?old|yrs?)\b.*\b(patient|give|start|prescribe|dose)\b/i.test(q); }
    // ---- Intent router (Part A/B): natural-language routing BEFORE any KB retrieval
    // or provider call. Casual + app-help are answered locally (₹0 provider cost);
    // only genuine clinical questions reach the one grounded Gemini/Vertex call.
    function maikLev(a, b) { // small Levenshtein for typo/fuzzy casual matching
      a = a || ""; b = b || ""; var m = a.length, n = b.length; if (Math.abs(m - n) > 2) return 3;
      var d = []; for (var i = 0; i <= m; i++) d[i] = [i]; for (var j = 0; j <= n; j++) d[0][j] = j;
      for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      return d[m][n];
    }
    function maikNorm(q) {
      return String(q || "").toLowerCase().trim()
        .replace(/[^a-z0-9\s'?]/g, " ")            // strip punctuation (keep ? for question detection)
        .replace(/([a-z])\1{2,}/g, "$1$1")          // collapse 3+ repeats: heyyy→heyy, hellooo→helloo
        .replace(/\s+/g, " ").trim();
    }
    // Normalise common txt-speak / typos so a casual follow-up ("wat iz da treatment doze?") is still
    // recognised as a continuation of the current topic instead of dead-ending to a web search on a
    // garbage token ("doze"). Only unambiguous non-clinical slang — applied ONLY in follow-up resolution.
    var _MAIK_DESLANG = { iz: "is", da: "the", doze: "dose", pls: "please", plz: "please", ur: "your", wat: "what", abt: "about", nd: "and", hw: "how" };
    function maikDeslang(s) {
      return String(s || "").replace(/\b(iz|da|doze|pls|plz|ur|wat|abt|nd|hw)\b/gi, function (w) { return _MAIK_DESLANG[w.toLowerCase()] || w; });
    }
    var MAIK_CASUAL = ["hi", "hii", "hey", "helo", "hello", "yo", "hiya", "sup", "namaste", "hai"];
    var MAIK_ACK = ["thanks", "thank", "thankyou", "thx", "ty", "ok", "okay", "k", "kk", "cool", "great", "nice", "got", "gotit", "fine", "alright", "sure", "yep", "yes", "no"];
    function maikRoute(q, active) {
      var n = maikNorm(q), toks = n.split(" ").filter(Boolean), first = toks[0] || "";
      var isShort = toks.length <= 4;
      if (!n || /^[?.\s]+$/.test(n)) return { kind: "clarify" };                       // empty / punctuation-only
      if (/^(dose|doses|dosage|what dose|which dose|drug|drugs|which drug|what drug)\??$/.test(n)) return { kind: "clarify" };  // bare dose/drug with no drug named
      if (/\b(weather|joke|jokes|funny|movie|movies|song|songs|music|sport|sports|cricket|football|news|poem|story|stories|recipe|cook|game|games|stock|horoscope|who won|what time|time is it|date today|your name)\b/.test(n) && !/(treat|manage|dose|drug|patient|symptom|sign|diagnos|infection|fever|pain|therapy|antibiotic|disease|syndrome|management|shock|sepsis|poison)/.test(n)) return { kind: "casual", reply: "I\u2019m MaiK \u2014 I focus on clinical knowledge, drug information, calculators, and patient assessment. Ask me a medical question and I\u2019ll help." };
      // A/B casual conversation — fuzzy (typo-tolerant) match on the FIRST token / short phrase
      var casualHit = MAIK_CASUAL.some(function (w) { return first === w || maikLev(first, w) <= 1; })
        || /^(hello|hey|hi)\b/.test(n) || /^good (morning|afternoon|evening|night)\b/.test(n) || /^how (are|r) (you|u)\b/.test(n) || /^how'?s it going\b/.test(n) || /^whats up\b|^what'?s up\b/.test(n);
      var ackHit = isShort && MAIK_ACK.some(function (w) { return toks.indexOf(w) >= 0 || maikLev(first, w) <= 1; });
      var byeHit = isShort && /^(bye|goodbye|see ya|cya|good night)\b/.test(n);
      // A greeting is only "casual" when the message is essentially JUST the greeting. If a real
      // question follows it ("hi rx of uti", "hey dose of atropine"), answer that instead of the
      // scripted hello. (The old guard was a narrow keyword allow-list that missed rx/uti and most
      // disease names, so "hi <anything clinical>" wrongly got the canned reply.)
      var afterGreet = n
        .replace(/^(hi+|hey+|hello|helo|yo|hiya|sup|namaste|hai|greetings|good (morning|afternoon|evening|night))\b/i, "")
        .replace(/^\s*(there|doc|doctor|team|everyone|all|maik|sir|ma'?am|maam)\b/i, "")
        .replace(/[\s,!.?]+/g, " ").trim();
      var greetOnly = afterGreet.split(" ").filter(function (w) { return w.length >= 2 && MAIK_CASUAL.indexOf(w) < 0; }).length === 0;
      if (isShort && /how (are|r) (you|u)/.test(n)) return { kind: "casual", reply: "I’m well, thank you. I’m here to support clinical questions, drug information, calculations, or patient assessment. What would you like to discuss?" };
      if (byeHit) return { kind: "casual", reply: "Goodbye — StewardMD is here whenever you need clinical support." };
      if (isShort && /(thanks|thank you|thankyou|thx|^ty\b)/.test(n)) return { kind: "casual", reply: "You’re welcome. Let me know if you want to review a clinical topic or assess a patient." };
      if (casualHit && isShort && greetOnly) return { kind: "casual", reply: "Hello. I can help with clinical knowledge, drug information, calculators, or a patient assessment. What would you like to discuss?" };
      if (ackHit && !/(treat|manage|dose|sign|approach|explain|patient|what|how|why|which)/.test(n)) return { kind: "casual", reply: "Sure — let me know if you’d like to review a clinical topic, look up a drug, or assess a patient." };
      // B product/help
      if (/what (can|do) you do|what is maik|who are you|how (do i|to) use|how (do i|to) start|how does this work|where('?s| is)? (the )?(drug|calculator|calc|ward|icu|dx)/.test(n)) return { kind: "help" };
      // E patient-specific (existing detector) with no active case → guided assessment
      if (isPatientSpecific(q) && !active) return { kind: "patient" };
      // C/D anything else with clinical substance → one grounded provider call.
      // Very short, non-clinical, unmatched → ask a clarifying question (no call).
      // Only clarify a 1-2 word query when it does NOT look like a clinical topic. Disease/topic
      // names (e.g. "paraquat poisoning", "kawasaki disease", "-itis/-osis") must route to clinical.
      if (isShort && toks.length <= 2 && !/(dka|op|tb|uti|copd|ards|hiv|mi|pe|sepsis|shock|fever|pain|dose|drug|poison|toxic|overdose|antidote|envenom|snakebite|syndrome|disease|disorder|infection|itis|osis|aemia|emia|pathy|opathy|crisis|failure|bleed|haemorrhage|hemorrhage|stroke|embolism|infarct|arrest|malaria|meningitis|pneumonia|tetanus|rabies|dengue|typhoid|cholera)/.test(n)) return { kind: "clarify" };
      return { kind: "clinical" };
    }
    // ---- Conversation-aware clinical helpers (smd_maik_v2) ----
    function maikCanonTopic(q) {
      var t = String(q || "").trim().replace(/\?+$/, "").trim();
      // Strip leading filler/greeting/lead-in prefixes REPEATEDLY (e.g. "Hello tell dka
      // treatment" → "dka treatment") so the KB matcher sees the real topic, not "hello tell".
      var _px = /^((hello|hi|hey|please|kindly|ok|okay|so|and|the)( there)?[,.:!\s]+|how\s+(do\s+(we|i|you)|to)\s+|what('?s| is| are)(\s+the)?\s+|whats\s+|explain\s+|describe\s+|tell( me| us)? about\s+|tell( me| us)?\s+|speak( to me)?( about| on)?\s+|talk( to me)?( about| on)?\s+|read( out)?( about| on)?\s+|discuss\s+|go (over|through)\s+|walk me through\s+|(give me |show me )?(info|information|details?)( on| about)\s+|about\s+|approach to\s+|management of\s+|treat(ment of|ing)?\s+|signs?\s+of\s+|symptoms?\s+of\s+|diagnosis of\s+|work\s?up (of|for)\s+|drug of choice (for|in)\s+|rx (of|for)?\s*|mx (of|for)?\s*)/i;
      var _prev; do { _prev = t; t = t.replace(_px, "").trim(); } while (t && t !== _prev);
      t = t.replace(/^(treat(ment of|ing)?|manage(ment of)?|management of|rx( of)?|mx( of)?|do we treat|to treat|assess(ment of)?|evaluate)\s+/i, "").trim();
      t = t.replace(/\b(management|treatment)\b/gi, "").replace(/\s+/g, " ").trim();
      return t || String(q || "").trim();
    }
    function maikResolveFollowup(q) {
      var t = _maikTopic; if (!t || !t.topic) return null;
      if (t.ts && (Date.now() - t.ts) > 30 * 60 * 1000) { _maikTopic = null; return null; }   // session continuity only
      q = maikDeslang(q);   // "wat iz da treatment doze?" → "what is the treatment dose?" so the branches below match
      var n = maikNorm(q), wc = n.split(" ").filter(Boolean).length;
      if (/(in (more )?detail|more detail|detailed answer|full(er)? answer|elaborate|explain (more|further)|go on|tell me more|in depth)/.test(n) || /^(more|detail|details|elaborate|expand|continue)\b/.test(n)) {
        return { question: "Provide a detailed, complete clinical answer on the management of " + t.topic + ".", depth: "detailed", topic: t.topic, retrieval: t.topic + " detailed management" };
      }
      if (/(antibiotic|antibiotics|abx|antimicrobial|drug of choice|which agent)/.test(n) && wc <= 7) {
        return { question: "Empiric antimicrobial therapy for " + t.topic + " — agent/class choice, severity and host adjustment, and culture-directed de-escalation principles.", depth: "concise", topic: "antibiotics for " + t.topic, retrieval: t.topic + " empiric antibiotics antimicrobial therapy de-escalation" };
      }
      if (/^(dose|dosage|doses|how much)\b/.test(n) || (/\bdose\b/.test(n) && wc <= 6)) {
        var _pop = /\b(paediatric|pediatric|child|neonat)/i.test(n) ? "Paediatric" : (/\b(renal|dialysis|ckd)\b/i.test(n) ? "Renal-adjusted" : (/\b(hepatic|liver)\b/i.test(n) ? "Hepatic-adjusted" : (/\bpregnan/i.test(n) ? "Pregnancy" : "Adult")));
        var _drug = q.replace(/\?+/g, " ").replace(/\b(dose|dosage|doses|dosing|of|the|a|an|in|for|adult|paediatric|pediatric|child|neonatal|neonate|renal|dialysis|ckd|hepatic|liver|pregnancy|pregnant|how|much|what|whats|is|are|please|pls|give|me|and|standard|its|it|treatment|treatments|therapy|regimen|regimens|drug|drugs|medication|medications|agent|agents|antibiotic|antibiotics)\b/gi, " ").replace(/\s+/g, " ").trim();
        _drug = _drug || t.lastDrug;
        if (_drug) return { question: _pop + " dosing of " + _drug + " for " + t.topic + " \u2014 dose, route, titration and renal-adjustment principles. Verify locally.", depth: "concise", topic: "dose of " + _drug, retrieval: _drug + " " + t.topic + " dose dosing route renal adjustment" };
        return { clarify: "Which drug’s dose would you like — e.g. “ceftriaxone dose” or “atropine dose in OP poisoning”?" };
      }
      if (/^(what next|whats next|next|next steps?|then( what)?|and then|what to do next)\b/.test(n) || (/\bnext\b/.test(n) && wc <= 4)) {
        return { question: "Next steps, ongoing management and monitoring for " + t.topic + ".", depth: "concise", topic: "next steps for " + t.topic, retrieval: t.topic + " monitoring ongoing management next steps escalation" };
      }
      if (/\b(in pregnancy|pregnan)/.test(n) && wc <= 5) {
        return { question: t.topic + " — management considerations in pregnancy.", depth: "concise", topic: t.topic + " in pregnancy", retrieval: t.topic + " pregnancy management" };
      }
      if (/\b(renal (failure|impairment)|ckd|dialysis|kidney)\b/.test(n) && wc <= 6) {
        return { question: t.topic + " — management considerations with renal impairment.", depth: "concise", topic: t.topic + " with renal impairment", retrieval: t.topic + " renal impairment dose adjustment" };
      }
      var m = q.match(/^(what about|how about|and)\s+(.+)/i);
      if (m && m[2]) { var rest = m[2].replace(/\?+$/, "").trim(); if (rest) return { question: t.topic + " — " + rest + ".", depth: "concise", topic: t.topic + " · " + rest, retrieval: t.topic + " " + rest }; }
      // Affirmative reply to MaiK's own closing question -> continue on the offered content (or, if the
      // exact offer wasn't captured, the topic's management). Gated on t.offer/askedMore so a stray
      // "ok"/"yes" with no pending question still falls through to the casual acknowledgement.
      if ((t.offer || t.askedMore) && /^(?:y|yes|yeah|yep|yup|sure|ok|okay|okey|please|pls|do it|go ahead|go on|both|either|sounds good|yes please|please do|go for it)\s*\??$/.test(n)) {
        var off = (t.offer || "").trim();
        if (off) return { question: t.topic + " — " + off + ".", depth: "detailed", topic: t.topic + " · " + off, retrieval: t.topic + " " + off };
        return { question: "Continue with the management and treatment of " + t.topic + " — key steps, medications, and monitoring.", depth: "detailed", topic: "management of " + t.topic, retrieval: t.topic + " management treatment medications monitoring" };
      }
      // GENERIC continuation — a short message made ONLY of generic clinical words
      // ("ok first line treatment?", "complications?", "yes investigations") stays ON
      // the current topic. Without this, the raw fragment was retrieved standalone and
      // keyword-matched a random disease (a real case: "Ok First Line Treatment?" after
      // an ascites answer retrieved FIRST Bite Syndrome). Any non-generic token means
      // the clinician may be naming a NEW topic → fall through to normal routing.
      var GENERIC_FU = /^(ok(ay)?|yes|yeah|yep|sure|please|pls|go|ahead|and|so|also|what|whats|about|the|of|for|in|a|an|is|are|its|tell|me|give|now|then|this|that|first|second|third|line|initial|choice|best|treatment|treat|therapy|therapies|management|manage|mx|rx|drug|drugs|medication|medications|dose|doses|dosing|option|options|step|steps|investigation|investigations|workup|work-up|test|tests|lab|labs|complication|complications|cause|causes|sign|signs|symptom|symptoms|prognosis|criteria|classification|type|types|feature|features|diagnosis|differential|differentials|monitoring|follow|followup|up|red|flag|flags)$/;
      if (wc <= 7) {
        var toksF = n.replace(/\?/g, "").split(" ").filter(Boolean);   // maikNorm keeps '?' — drop it for token matching
        if (toksF.length && toksF.every(function (w) { return GENERIC_FU.test(w); })) {
          var ask = q.replace(/^\s*(ok(ay)?|yes|yeah|yep|sure|please|pls)[,!. ]*/i, "").replace(/\?+$/, "").trim();
          if (!ask) return null;                                    // bare "ok"/"yes" → let the ack handling reply
          return { question: t.topic + " — " + ask + ".", depth: "concise", topic: t.topic + " · " + ask, retrieval: t.topic + " " + ask };
        }
      }
      return null;
    }
    // Phase 2 — streaming is ON by default (self-falls-back on any failure); set localStorage
    // smd_maik_stream="0" to force the classic non-stream path.
    function maikStreamOn() { try { return localStorage.getItem("smd_maik_stream") !== "0"; } catch (e) { return true; } }
    // Diagnostics: when smd_maik_perf="1" (Settings › Interface › "AI response timing"), MaiK prints
    // first-token + full-answer time under each answer so real-device / native TTFT is readable.
    function maikPerfOn() { try { return localStorage.getItem("smd_maik_perf") === "1"; } catch (e) { return false; } }
    function maikNow() { try { return (window.performance && performance.now) ? performance.now() : Date.now(); } catch (e) { return Date.now(); } }
    // ── Web-research helper (extracted so the KB-miss branch AND the assume-tier refine chip
    //    share one implementation). Opt-in, one call, clearly labelled non-StewardMD.
    function maikRunWeb(container, q, srcEl) {
      if (srcEl) srcEl.disabled = true;
      container.insertAdjacentHTML("beforeend", '<div class="maik-webbusy" style="margin-top:8px;color:var(--slate-soft,#64748b)">' + svg("spark", "smd-ico") + ' Researching…</div>');
      var busy = container.querySelector(".maik-webbusy");
      return window.SMD_AI.research(q).then(function (r) {
        if (busy) busy.remove();
        if (r && r.text) {
          var bd = (window.SMD_MaiK && SMD_MaiK.renderMarkdown) ? SMD_MaiK.renderMarkdown(String(r.text)) : maikEscH(String(r.text));
          // Clickable source links — the TinyFish fast path returns r.sources = [{title,url,site}]
          // (numbered to match the [n] citations in the answer); the Gemini-grounding fallback
          // returns none. URLs are scheme-validated (http/https only) + escaped to stay XSS-safe.
          var srcHTML = "";
          if (r.sources && r.sources.length) {
            var items = r.sources.map(function (s) {
              var t = maikEscH((s && (s.title || s.site || s.url)) || "source");
              var safeU = (s && s.url && /^https?:\/\//i.test(s.url)) ? maikEscH(s.url) : "";
              var siteTag = (s && s.site) ? ' <span style="color:var(--slate-soft,#94a3b8)">· ' + maikEscH(s.site) + '</span>' : '';
              return '<li>' + (safeU ? '<a href="' + safeU + '" target="_blank" rel="noopener noreferrer" style="color:#0e6e63">' + t + '</a>' : t) + siteTag + '</li>';
            }).join("");
            srcHTML = '<details class="maik-src" style="margin-top:6px"><summary>' + MK.book + r.sources.length + ' web source' + (r.sources.length > 1 ? 's' : '') + '</summary><ol>' + items + '</ol></details>';
          }
          container.insertAdjacentHTML("beforeend", '<div class="maik-b ai" style="margin-top:8px"><div class="maik-attr" style="display:flex;align-items:center;gap:6px;font:600 11px var(--sans,system-ui);color:var(--slate-soft,#94a3b8);margin-bottom:6px">' + svg("spark", "smd-ico") + '<span>MaiK</span><span style="opacity:.7">· web-sourced, verify independently</span></div>' + bd + srcHTML + '</div>');
        } else {
          container.insertAdjacentHTML("beforeend", '<div class="maik-welcome" style="margin-top:8px">Web research is unavailable right now' + ((r && r.reason === "quota") ? ' (usage limit reached)' : '') + '. Please verify against a reference source.</div>');
        }
        try { scroll(); } catch (e) {}
        try { _maikBodyHTML = body.innerHTML; maikSaveThread(_maikBodyHTML); } catch (e) {}
      }).catch(function () {
        // research() bounds itself (raceTimeout → {error}) so this is belt-and-suspenders: if it
        // ever rejects/throws, still clear the spinner and fail gracefully rather than hang forever.
        if (busy) busy.remove();
        container.insertAdjacentHTML("beforeend", '<div class="maik-welcome" style="margin-top:8px">Web research is unavailable right now. Please verify against a reference source.</div>');
        try { scroll(); } catch (e) {}
        try { _maikBodyHTML = body.innerHTML; maikSaveThread(_maikBodyHTML); } catch (e) {}
      });
    }
    function maikWebChipEl(q) {
      var rb = document.createElement("button"); rb.className = "maik-chip"; rb.style.marginTop = "8px"; rb.innerHTML = svg("search", "smd-ico") + " Research on the web";
      rb.addEventListener("click", function () { maikRunWeb(rb.parentNode || body, q, rb); });
      return rb;
    }
    // ── Deterministic follow-up chips (ZERO extra AI tokens): derived purely from the grounded
    //    package's own sections + resolved treatment. Each chip re-runs a grounded query only IF
    //    the clinician taps it (and hits the answer cache if repeated). Skips the section the
    //    clinician just asked about. This is the "contextual follow-ups" UpToDate spends an LLM
    //    call on — we get it for free from KB structure.
    function maikFollowupChips(pkg, question) {
      try {
        var g = pkg && pkg.grounding && pkg.grounding[0]; if (!g) return [];
        var name = g.name || (pkg.topicMatch && (pkg.topicMatch.grounded || pkg.topicMatch.nearest)) || ""; if (!name) return [];
        var secs = (g.knowledge || []).map(function (k) { return String(k.section || ""); }).join("|");
        var qn = maikNorm(question || ""), out = [];
        var askedTx = /\b(treat|treatment|treating|manage|management|therapy|regimen|antibiotic|antibiotics|drug|drugs|dose|dosing)\b/.test(qn);
        var askedRf = /\b(red ?flag|danger|warning|escalate|admit|worry|miss)\b/.test(qn);
        var askedIx = /\b(investigat|work ?up|test|tests|labs?|imaging|bloods?)\b/.test(qn);
        var askedDx = /\b(differential|ddx|mimic|versus|\bvs\b|distinguish)\b/.test(qn);
        if (/redflag/i.test(secs) && !askedRf) out.push({ label: "🚩 Red flags not to miss", q: name + " red flags" });
        if ((/management|treatment/i.test(secs) || (pkg.treatment && pkg.treatment.default)) && !askedTx) out.push({ label: "💊 First-line treatment", q: "treatment of " + name });
        if (/investigation/i.test(secs) && !askedIx) out.push({ label: "🔬 What to investigate", q: "investigations for " + name });
        if (/differential|mimic/i.test(secs) && !askedDx) out.push({ label: "🔀 Differentials & mimics", q: name + " differential diagnosis" });
        return out.slice(0, 3);
      } catch (e) { return []; }
    }
    // Chips are emitted as data-attribute buttons (not live listeners) so they survive the
    // innerHTML answer-cache and are handled by ONE delegated listener on the chat body.
    function maikFollowupsHTML(pkg, question, assume) {
      var chips = maikFollowupChips(pkg, question), html = "";
      chips.forEach(function (c) { html += '<button class="maik-fu" data-maik-q="' + maikEscH(c.q) + '">' + maikEscH(c.label) + '</button>'; });
      if (assume) html += '<button class="maik-fu" data-maik-web="' + maikEscH(question) + '">' + svg("search", "smd-ico") + ' Different topic — search the web</button>';
      return html ? '<div class="maik-followups">' + html + '</div>' : "";
    }
    function maikRenderAnswer(think, r, pkg, active, cacheKey, topicLabel, question, depth, assume) {
      // The provider call has returned and we are rendering the interactive answer, so clear the busy
      // guard NOW rather than in the trailing .then(). On native the answer is revealed via a
      // requestAnimationFrame typewriter (explainGroundedStream fallback replay) that held _maikBusy
      // true for the WHOLE animation, so the follow-up chips were visible but taps silently no-op'd
      // until the next turn cleared it ("tapped First-line treatment, nothing; sent Hi, then it worked").
      _maikBusy = false; if (sendBtn) sendBtn.disabled = false;
      if (r && r.error === "quota") { think.innerHTML = '<div class="maik-welcome">' + (r.reason === "rate" ? 'One moment — you’re asking questions quickly. Please try again in a few seconds.' : 'MaiK usage limit reached for now. Clinical reasoning, calculators, and reference tools remain available.') + '</div>'; return; }
      if (r && r.error) { think.innerHTML = r.error === "ai-off" ? "MaiK is currently off — enable it in Settings › AI Assistant." : '<div class="maik-welcome">MaiK is unavailable right now — the deterministic StewardMD engine, calculators and reference tools remain available.</div>'; return; }
      var md = (r && r.text) ? String(r.text).trim() : "";
      if (!md || /\b(no (relevant |specific )?information|does not (cover|contain)|unable to (find|answer)|i (don'?t|do not) have (enough|any))\b/i.test(md)) {
        think.innerHTML = '<div class="maik-welcome">I found limited StewardMD material on this. Would you like a general overview, or to start a patient assessment?</div>';
        var ab = document.createElement("button"); ab.className = "maik-chip"; ab.style.marginTop = "8px"; ab.textContent = "Start Dx My Patient"; ab.addEventListener("click", function () { close(); try { openDxChooser(); } catch (e) {} }); think.appendChild(ab); think.appendChild(maikWebChipEl(question)); scroll(); return;
      }
      var rendered = (window.SMD_MaiK && SMD_MaiK.renderMarkdown) ? SMD_MaiK.renderMarkdown(md) : maikEscH(md);
      // Phase 2 — numbered sources footer (matches the [n] markers). Prefer the package's own
      // numbered list (identical numbering to what the model was given) so citations line up.
      var srcArr = (pkg && pkg.sources && pkg.sources.length) ? pkg.sources.map(function (s) { return s.title; })
        : ((window.SMD_MaiK && SMD_MaiK.sourceList) ? SMD_MaiK.sourceList(pkg).map(function (s) { return s.title; })
          : ((window.SMD_MaiK && SMD_MaiK.sourceTitles) ? SMD_MaiK.sourceTitles(pkg.retrieved || []) : []));
      var bookSvg = MK.book;
      var srcHTML = srcArr.length ? '<details class="maik-src"><summary>' + bookSvg + srcArr.length + ' source' + (srcArr.length > 1 ? 's' : '') + '</summary><ol>' + srcArr.map(function (t) { return "<li>" + maikEscH(t) + "</li>"; }).join("") + '</ol></details>' : "";
      // MaiK attribution row (sparkle + MAIK) atop every answer bubble.
      var attrHTML = '<div class="maik-attr">' + MK.spark + '<span>MaiK</span></div>';
      var assumeHTML = assume ? ('<div class="maik-assume">Assuming you mean <b>' + maikEscH(assume.name) + '</b> — not quite? Tap a topic below or search the web.</div>') : "";
      var eduHTML = assumeHTML + (active ? "" : '<div class="maik-edu">Educational clinical reference — verify with local protocol.</div>');
      var full = attrHTML + eduHTML + rendered + srcHTML;
      if (md.length > 700) {
        think.innerHTML = attrHTML + eduHTML + '<div class="maik-collapsed">' + rendered + '</div>' + srcHTML;
        var cd = think.querySelector(".maik-collapsed"); cd.style.maxHeight = "260px"; cd.style.overflow = "hidden";
        var mb = document.createElement("button"); mb.className = "maik-more"; mb.textContent = "Show more ▾";
        // Toggle is handled by the delegated body listener (below) so it keeps working after a
        // saved thread is restored via innerHTML, which would otherwise drop a direct listener.
        think.insertBefore(mb, think.querySelector(".maik-src") || null);
      } else { think.innerHTML = full; }
      // deterministic contextual follow-ups (0 tokens) — appended into the cached HTML; a single
      // delegated listener on the chat body handles taps even after cache restore.
      var chipsHTML = maikFollowupsHTML(pkg, question, assume);
      if (chipsHTML) think.insertAdjacentHTML("beforeend", chipsHTML);
      if (!active) _maikCache[cacheKey] = think.innerHTML;
      // ℞ Create Prescription — shown on EVERY MaiK answer (prominent), with pkg in closure so
      // treatment answers pre-fill the grounded regimen (doses DB-first via the Drug Index) and
      // any other answer opens the pad for manual entry. SMD_RX gates on doctor verification.
      // Live-only (appended after cache write). Treatment answers get a hint sub-label.
      try {
        if (window.SMD_RX) {
          var _isTx = (pkg && pkg.treatment && pkg.treatment.default) || /\b(treat|treatment|treating|manage|management|therapy|regimen|prescri|\brx\b|antibiotic|antibiotics|first[- ]?line|dose|dosing)\b/.test(maikNorm(question || ""));
          var _rxc = document.createElement("button");
          _rxc.className = "maik-chip maik-rx";
          _rxc.style.cssText = "margin-top:10px;background:#0e6e63;color:#fff;border-color:#0e6e63;font-weight:700";
          _rxc.textContent = "℞ Create prescription" + (_isTx ? " (pre-fill from this)" : "");
          _rxc.addEventListener("click", function () { try { SMD_RX.open({ topic: topicLabel || question, pkg: pkg, answerText: md }); } catch (e) {} });
          think.appendChild(_rxc);
        }
      } catch (e) {}
      _maikTurns.push({ q: question, a: md.slice(0, 320) }); if (_maikTurns.length > 8) _maikTurns.shift();
      try { if (window.SMD_KU && question) { var _kh = 0, _ks = String(question); for (var _ki = 0; _ki < _ks.length; _ki++) { _kh = ((_kh << 5) - _kh + _ks.charCodeAt(_ki)) | 0; } SMD_KU.emit("maik", "q" + (_kh >>> 0).toString(36)); } } catch (e) {}   // KU: read a MaiK answer
      if (maikV2()) {
        // Capture MaiK's own closing offer ("Would you like to discuss X?") so a bare "yes"/"sure"
        // reply can continue on X instead of dead-ending as a casual acknowledgement.
        var _offer = "";
        try {
          var _oq = String(md || "").match(/\b(?:would you like|shall i|do you want|want(?: me to)?|should i|i can(?: also)?)\b([^?]*)\?/i);
          if (_oq && _oq[1]) _offer = _oq[1]
            .replace(/^\s*(?:me\s+)?(?:to\s+)?(?:discuss|explore|delve into|review|go over|hear about|know about|cover|outline|detail|walk you through|provide)\s+/i, "")
            .replace(/^\s*(?:about|the)\s+/i, "").replace(/\s+/g, " ").trim();
        } catch (e) {}
        var _ld = (_maikTopic && _maikTopic.lastDrug) || null;
        try { var _tp = pkg && pkg.treatment && pkg.treatment.default; if (_tp && _tp.dosing && _tp.dosing.length && _tp.dosing[0].drug) _ld = _tp.dosing[0].drug; else if (_tp && _tp.drugRefs && _tp.drugRefs.length) _ld = _tp.drugRefs[0]; } catch (e) {}
        _maikTopic = { topic: topicLabel, question: question, depth: depth, lastDrug: _ld, offer: _offer, askedMore: /\?\s*$/.test(String(md || "").trim()), ts: Date.now() };
      }
      scroll();
      try { _maikBodyHTML = body.innerHTML; maikSaveThread(_maikBodyHTML); } catch (e) {}
    }
    function runClinical(question, retrieval, depth, active, topicLabel) {
      var cacheKey = maikNorm(question) + (active ? "|case" : "");
      if (!active && _maikCache[cacheKey]) { bubble("ai", _maikCache[cacheKey]); if (maikV2()) _maikTopic = { topic: topicLabel, question: question, depth: depth, lastDrug: (_maikTopic && _maikTopic.lastDrug) || null, ts: Date.now() }; return; }
      _maikBusy = true; if (sendBtn) sendBtn.disabled = true;
      var think = bubble("ai", '<span class="maik-thinking">' + svg("spark", "smd-ico") + ' Searching StewardMD knowledge<span class="d">.</span><span class="d d2">.</span><span class="d d3">.</span></span>');
      // Hard client-side ceiling: the grounding chain (KB index load → buildPackage → grounded call)
      // must never leave the user stuck on 'Searching…' forever if a promise never settles (BUG-05).
      // On timeout we surface a clear message + a one-tap retry, and free the composer.
      var _maikDone = false, MAIK_TO_MS = 90000, _maikTO = null, _streamStarted = false, _stageT = [];
      function _clearStages() { _stageT.forEach(function (t) { try { clearTimeout(t); } catch (e) {} }); _stageT = []; }
      // Watchdog, NOT a fixed total ceiling. On web (real SSE) onDelta resets it on every streamed token so
      // a long but ACTIVELY-STREAMING answer is never killed. On native there is no SSE (CapacitorHttp
      // buffers it) — the answer is fetched whole then typed out — so nothing lands until the end and the
      // ceiling must comfortably cover a cold Vertex/KB start + a full grounded answer. The old fixed 40s
      // nuked in-flight answers ("took too long" WHILE it was still generating). Fires only if truly stuck.
      function _maikTimedOut() {
        if (_maikDone) return; _maikDone = true; _clearStages();
        try {
          think.innerHTML = '<div class="maik-welcome">MaiK took too long to respond — the knowledge search may be busy. <a href="#" class="maik-retry" style="color:var(--mk-teal,#0e6e63);font-weight:700;text-decoration:none">Tap to retry</a></div>';
          var _rl = think.querySelector(".maik-retry");
          if (_rl) _rl.addEventListener("click", function (ev) { ev.preventDefault(); try { think.parentNode && think.parentNode.removeChild(think); } catch (e) {} runClinical(question, retrieval, depth, active, topicLabel); });
        } catch (e) {}
        _maikBusy = false; if (sendBtn) sendBtn.disabled = false;
        try { console.warn("[MaiK] knowledge search timed out after " + MAIK_TO_MS + "ms with no progress:", question); } catch (e) {}
        try { scroll(); } catch (e) {}
      }
      function _armTO() { clearTimeout(_maikTO); _maikTO = setTimeout(_maikTimedOut, MAIK_TO_MS); }
      // Reassurance while a (native) answer generates — otherwise the bubble sits on one "Searching…" line
      // for the whole wait and reads as frozen/broken. Neutered the instant tokens/answer land.
      [[7000, "Reviewing the evidence"], [16000, "Composing your answer"], [30000, "Almost there — finalizing"]].forEach(function (s) {
        _stageT.push(setTimeout(function () {
          if (_maikDone || _streamStarted) return;
          try { think.innerHTML = '<span class="maik-thinking">' + svg("spark", "smd-ico") + ' ' + s[1] + '<span class="d">.</span><span class="d d2">.</span><span class="d d3">.</span></span>'; scroll(); } catch (e) {}
        }, s[0]));
      });
      _armTO();
      Promise.resolve()
        .then(function () { try { if (window.SMD_AI && SMD_AI.setFlag) SMD_AI.setFlag(true); } catch (e) {} return window.StewardRAG ? StewardRAG.ready() : Promise.reject(new Error("knowledge base loading")); })
        .then(function () {
          // Ground on the active case ONLY when the question is about that patient ("this/my
          // patient", "the case/diagnosis"). A standalone knowledge question (e.g. "treatment of
          // paraquat poisoning") must be grounded on its OWN topic, never on the ambient case —
          // otherwise a stale case's differential (e.g. cholangitis) hijacks the answer.
          var caseRef = /\b(this|that|the|my|our|current)\s+(patient|case|pt|dx|diagnosis|condition|scenario)\b|\bthis (patient|case|dx)\b|\b(above|current) (case|patient)\b/.test(maikNorm(question));
          var findings = (active && caseRef) ? DX._state.f : {};
          return StewardRAG.buildPackage(window.SMD_REASON.assess(findings), { question: retrieval || question });
        })
        .then(function (pkg) {
          if (pkg && question) pkg.question = question;
          var tm = (pkg && pkg.topicMatch) || null;
          // NONE tier: topic genuinely absent from the KB. MaiK answers every question, so
          // instead of dead-ending we AUTO-RUN web research (Google-grounded, clearly labelled
          // "not StewardMD-verified") — no tap required. We still don't let the KB model describe
          // a lexically-near but different condition; the web tier researches the ACTUAL topic.
          if (tm && tm.matched === false && tm.mode !== "assume") {
            var tp = maikEscH(tm.topic || question);
            think.innerHTML = '<div class="maik-welcome">' + svg("spark", "smd-ico") + ' Researching <b>' + tp + '</b>…</div>';
            try { maikRunWeb(think, question); } catch (e) { think.appendChild(maikWebChipEl(question)); }
            try { scroll(); } catch (e) {}
            return;
          }
          if (pkg && maikV2() && _maikTurns.length) pkg.history = _maikTurns.slice(-4);
          // ASSUME tier: partial KB match → answer the NEAREST topic (grounding already scoped to it)
          // under a STATED assumption; maikRenderAnswer prints the banner + refine chips. Same single
          // grounded call as the confident path — no extra tokens, we just stopped dead-ending.
          var assume = (tm && tm.mode === "assume") ? tm.assume : null;
          // Phase 2 — stream tokens live (UpToDate-style), then maikRenderAnswer re-renders the final
          // answer with sources/chips/collapse. Fully additive: explainGroundedStream self-falls-back
          // to the non-stream call on any hiccup, so this can't regress the answer.
          var _perfT0 = maikNow(), _perfTTFT = 0;
          var onDelta = function (acc) {
            if (_maikDone) return;                              // a timeout already fired — don't paint over the retry prompt
            _streamStarted = true; _clearStages(); _armTO();    // progress: stop reassurance + reset the no-progress watchdog
            if (!_perfTTFT) _perfTTFT = maikNow();
            var rn = (window.SMD_MaiK && SMD_MaiK.renderMarkdown) ? SMD_MaiK.renderMarkdown(acc) : maikEscH(acc);
            think.innerHTML = '<div class="maik-streaming">' + rn + '<span class="maik-caret"></span></div>';
            try { scroll(); } catch (e) {}
          };
          var call = (window.SMD_AI.explainGroundedStream && maikStreamOn())
            ? window.SMD_AI.explainGroundedStream(pkg, { depth: depth }, onDelta)
            : window.SMD_AI.explainGrounded(pkg, { depth: depth });
          return call.then(function (r) {
            maikRenderAnswer(think, r, pkg, active, cacheKey, topicLabel, question, depth, assume);
            // TTFT diagnostics (flag-gated) — readable on the real app incl. native.
            try {
              if (maikPerfOn()) {
                var total = ((maikNow() - _perfT0) / 1000).toFixed(1);
                var ttft = _perfTTFT ? ((_perfTTFT - _perfT0) / 1000).toFixed(1) : null;
                var el = document.createElement("div");
                el.className = "maik-perf";
                el.style.cssText = "margin-top:8px;font:600 11px/1.4 var(--sans,system-ui);color:var(--slate-soft,#5a7184);opacity:.9";
                el.textContent = "⏱ " + (ttft ? ("first token " + ttft + "s · ") : "") + "full answer " + total + "s" + (r && r.mode ? " · " + r.mode : "");
                think.appendChild(el);
                try { console.debug("[MaiK TTFT]", { ttft_s: ttft, total_s: total, mode: r && r.mode }); } catch (e) {}
              }
            } catch (e) {}
          });
        })
        .catch(function (e) { if (!_maikDone) { _clearStages(); think.innerHTML = '<div class="maik-welcome">MaiK is unavailable right now — clinical reasoning, calculators, and reference tools remain available.</div>'; } })
        .then(function () { if (_maikDone) return; _maikDone = true; _clearStages(); clearTimeout(_maikTO); _maikBusy = false; if (sendBtn) sendBtn.disabled = false; });
    }
    function send() {
      if (_maikBusy) return;
      var q = (qEl.value || "").trim(); if (!q) return; qEl.value = "";
      try { var _ex = sheet.querySelector("#maikExtract"); if (_ex) _ex.classList.remove("show"); } catch (e) {}
      _maikHist.push({ q: q }); bubble("you", maikEscH(q));
      try { if (qEl) qEl.placeholder = "Ask a follow-up…"; } catch (e) {}
      var active = maikActiveCase();
      if (maikV2()) {
        var fu = maikResolveFollowup(q);
        if (fu && fu.clarify) { bubble("ai", '<div class="maik-welcome">' + maikEscH(fu.clarify) + '</div>'); return; }
        if (fu) { runClinical(fu.question, fu.retrieval, fu.depth, active, fu.topic); return; }
      }
      var route = maikRoute(q, active);
      if (route.kind === "casual") { bubble("ai", '<div class="maik-welcome">' + maikEscH(route.reply) + '</div>'); return; }
      if (route.kind === "help") {
        var h = bubble("ai", '<div class="maik-welcome"><b>MaiK</b> is StewardMD’s clinical knowledge assistant. I can:<br>• answer general clinical & drug questions (grounded in StewardMD’s knowledge base)<br>• point you to the calculators and drug reference<br>• add commentary once you’ve run a patient assessment.<br><br>To assess a patient, start <b>Dx My Patient</b> or <b>Clinical Reasoning</b> and enter the findings.</div>');
        [["Ask a clinical question", function () { qEl.value = "How do we treat DKA?"; try { qEl.focus(); } catch (e) {} }], ["Start Dx My Patient", function () { close(); try { openDxChooser(); } catch (e) {} }]].forEach(function (c) { var b = document.createElement("button"); b.className = "maik-chip"; b.style.margin = "8px 6px 0 0"; b.textContent = c[0]; b.addEventListener("click", c[1]); h.appendChild(b); }); scroll(); return;
      }
      if (route.kind === "patient") {
        var d = bubble("ai", 'I can help you assess this. Start <b>Dx My Patient</b> or <b>Clinical Reasoning</b> and enter the findings, vitals and labs — StewardMD’s engine computes the assessment, then MaiK adds commentary on it.');
        var b = document.createElement("button"); b.className = "maik-chip"; b.style.marginTop = "8px"; b.textContent = "Open Dx My Patient";
        b.addEventListener("click", function () { close(); try { openDxChooser(); } catch (e) {} }); d.appendChild(b); scroll(); return;
      }
      if (route.kind === "clarify") { bubble("ai", '<div class="maik-welcome">Could you tell me the condition, symptoms, or what aspect you’d like to review? For example: “how to treat DKA?” or “signs of meningitis”.</div>'); return; }
      var topic = maikV2() ? maikCanonTopic(q) : q;
      var depth = /(in (more )?detail|detailed|elaborate|in depth)/.test(maikNorm(q)) ? "detailed" : "concise";
      runClinical(q, q, depth, active, topic);
    }
    // test hook (dev/regression harnesses only — closures are otherwise unreachable)
    try { window.__MAIK_TEST = { resolveFollowup: maikResolveFollowup, getTopic: function () { return _maikTopic; }, setTopic: function (t) { _maikTopic = t; } }; } catch (e) {}
    // restore the prior conversation verbatim (questions AND answers) for this session; else empty state
    if (_maikBodyHTML && /maik-b you/.test(_maikBodyHTML)) { body.innerHTML = _maikBodyHTML; scroll(); } else { emptyState(); }
    function maikNewThread() { _maikBodyHTML = ""; _maikTurns = []; _maikTopic = null; _maikCache = {}; _maikHist = []; maikSaveThread(""); if (body) body.innerHTML = ""; emptyState(); if (qEl) { qEl.value = ""; qEl.placeholder = "Ask a clinical question…"; qEl.focus(); } }
    sheet.querySelector("#maikClose").addEventListener("click", close);
    var _newBtn = sheet.querySelector("#maikNew"); if (_newBtn) _newBtn.addEventListener("click", maikNewThread);
    var _grab = sheet.querySelector("#maikGrab"); if (_grab) _grab.addEventListener("click", close);
    scrim.addEventListener("click", close);
    sendBtn.addEventListener("click", send);
    // One delegated listener handles every follow-up / refine chip (data-maik-q re-runs a grounded
    // query; data-maik-web opens opt-in web research). Delegation survives the innerHTML answer-cache.
    body.addEventListener("click", function (ev) {
      // Phase 2 — citation chip → reveal the numbered sources footer in the same answer bubble.
      var cite = ev.target && ev.target.closest ? ev.target.closest(".maik-cite") : null;
      if (cite) { var bub = cite.closest(".maik-b.ai") || cite.closest(".maik-b"); var det = bub && bub.querySelector(".maik-src"); if (det) { det.open = true; try { det.scrollIntoView({ block: "nearest" }); } catch (e) {} } return; }
      // Sources disclosure ("N sources"): WebKit does NOT fire the native <details> toggle when the
      // <summary> is display:flex (our styling), so the row looks tappable but never opens. Drive it
      // explicitly — works live and after a cached thread is restored, on any WebKit version.
      var sum = ev.target && ev.target.closest ? ev.target.closest(".maik-src summary") : null;
      if (sum) { var dts = sum.parentNode; if (dts && dts.tagName === "DETAILS") { ev.preventDefault(); dts.open = !dts.open; } return; }
      // Show more / less: delegated (the live-render listener is gone once the thread HTML is rebuilt
      // from cache), so it keeps working when a saved conversation is reopened.
      var more = ev.target && ev.target.closest ? ev.target.closest(".maik-more") : null;
      if (more) { var mbub = more.closest(".maik-b.ai"); var cd2 = mbub && mbub.querySelector(".maik-collapsed"); if (cd2) { var opened = cd2.style.maxHeight === "none"; cd2.style.maxHeight = opened ? "260px" : "none"; cd2.style.overflow = opened ? "hidden" : ""; more.textContent = opened ? "Show more ▾" : "Show less ▴"; } return; }
      var el = ev.target && ev.target.closest ? ev.target.closest("[data-maik-q],[data-maik-web]") : null;
      if (!el) return;
      ev.preventDefault();
      var fq = el.getAttribute("data-maik-q");
      if (fq) {
        if (_maikBusy) return;
        var tpc = maikV2() ? maikCanonTopic(fq) : fq;
        var dp = /(in (more )?detail|detailed|elaborate|in depth)/.test(maikNorm(fq)) ? "detailed" : "concise";
        runClinical(fq, fq, dp, maikActiveCase(), tpc); return;
      }
      var wq = el.getAttribute("data-maik-web");
      if (wq) { el.disabled = true; maikRunWeb(el.closest(".maik-b.ai") || body, wq, el); }
    });
    // ---- MaiK Scribe: voice dictation into the chat box + inline findings extraction (spec C2) ----
    var micBtn = sheet.querySelector("#maikMic"), extractBtn = sheet.querySelector("#maikExtract");
    function reasoningReady() { return !!(window.SMD_AI && SMD_AI.extract && window.DX && DX.addFindings && DX.findingCatalog); }
    function autosizeQ() { qEl.style.height = "auto"; qEl.style.height = Math.min(120, qEl.scrollHeight) + "px"; }
    function refreshExtract() { if (extractBtn) extractBtn.classList.toggle("show", !!((qEl.value || "").trim() && reasoningReady())); }
    // MaiK Scribe mic → the shared voice dialog (the same one that works in Clinical
    // Reasoning), in text mode: dictate into the chat box, then send to MaiK or tap
    // "Extract findings →". (Inline capture in the composer was unreliable while the
    // keyboard held focus, and the dialog sits above the sheet at z-index 17000.)
    if (micBtn) micBtn.addEventListener("click", function () {
      if (!(window.SMD_VOICE && SMD_VOICE.openDialog)) { toast("Voice intake is still loading…"); return; }
      try { qEl.blur(); } catch (e) {}
      SMD_VOICE.openDialog({ target: "text", onText: function (t) {
        if (!t) return;
        var base = (qEl.value || "").trim();
        qEl.value = (base ? base + " " : "") + t;
        autosizeQ(); refreshExtract();
        try { qEl.focus(); } catch (e) {}
      } });
    });
    if (extractBtn) extractBtn.addEventListener("click", function () {
      var q = (qEl.value || "").trim();
      if (!q) { extractBtn.classList.remove("show"); return; }
      if (!reasoningReady()) { toast("Clinical Reasoning isn’t ready yet."); return; }
      var catalog = []; try { catalog = DX.findingCatalog() || []; } catch (e) {}
      extractBtn.disabled = true; extractBtn.textContent = "Extracting findings…";
      SMD_AI.extract(q, "reasoning", catalog).then(function (r) {
        extractBtn.disabled = false; extractBtn.innerHTML = svg("brain", "smd-ico") + " Extract findings for Clinical Reasoning →";
        var raw = (r && r.findings) || [];
        var keys = raw.map(function (f) { return typeof f === "string" ? f : (f && f.key); }).filter(Boolean);
        if (!keys.length) { bubble("ai", '<div class="maik-welcome">I couldn’t map that to any findings in StewardMD’s catalog. Try naming the symptoms, signs, or labs explicitly — e.g. “fever, neck stiffness, photophobia”.</div>'); return; }
        try { DX.addFindings(keys); } catch (e) {}
        var labelOf = {}; catalog.forEach(function (c) { labelOf[c.key] = c.label || c.key; });
        var names = keys.map(function (k) { return labelOf[k] || k; });
        var d = bubble("ai", '<div class="maik-welcome">Added <b>' + names.length + '</b> finding' + (names.length === 1 ? "" : "s") + ' to Clinical Reasoning — <i>' + maikEscH(names.join(", ")) + '</i>. Nothing is diagnosed automatically; open the workspace to review the differential.</div>');
        var ob = document.createElement("button"); ob.className = "maik-chip"; ob.style.marginTop = "8px"; ob.textContent = "Open Clinical Reasoning →";
        ob.addEventListener("click", function () { close(); try { if (window.DX && DX.openWorkspace) DX.openWorkspace(); else if (window.DX && DX.open) DX.open({ workspace: true }); } catch (e) {} });
        d.appendChild(ob); scroll(); extractBtn.classList.remove("show");
      }).catch(function () { extractBtn.disabled = false; extractBtn.innerHTML = svg("brain", "smd-ico") + " Extract findings for Clinical Reasoning →"; toast("Couldn’t extract findings right now — please try again."); });
    });
    qEl.addEventListener("input", function () { qEl.style.height = "auto"; qEl.style.height = Math.min(120, qEl.scrollHeight) + "px"; refreshExtract(); });
    qEl.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); } });
    if (prefill && typeof prefill === "string") { try { qEl.value = prefill; qEl.style.height = "auto"; qEl.style.height = Math.min(120, qEl.scrollHeight) + "px"; } catch (e) {} }
    setTimeout(function () { try { qEl.focus(); } catch (e) {} }, 300);
  }
  // Open the MaiK assistant with an optional pre-filled question (used by Specialty
  // Workspaces' point-of-care "Ask MaiK" hand-off). The clinician reviews and sends.
  window.SMD_askMaik = function (q) { try { openAskAi(q); } catch (e) {} };

  // ---- Display & Accessibility engine ----
  var DKEY = "smd_display_v1", DENS = { compact: 0.86, default: 1, comfortable: 1.18, large: 1.4 }, DDEF = { fontScale: 1, density: "default", autoFit: false, theme: "classic", font: "plex", headingStyle: "default" };
  var THEMES = [
    { id: "classic", name: "Classic", accent: "#0e6e63", paper: "#f6f7f5" },
    { id: "blue", name: "Clinical Blue", accent: "#1560b0", paper: "#f5f7fa" },
    { id: "ocean", name: "Ocean", accent: "#0a7d8c", paper: "#f4f8f8" },
    { id: "tiranga", name: "Tiranga", accent: "#1a7a41", paper: "#fbf8f2" },
    { id: "amber", name: "Warm Amber", accent: "#a86412", paper: "#faf7f1" },
    { id: "slate", name: "Slate", accent: "#3d5166", paper: "#f5f6f7" },
    { id: "contrast", name: "High-Contrast", accent: "#00463d", paper: "#ffffff" }
  ];
  var FONTS = [
    { id: "plex", name: "IBM Plex Sans", web: null },
    { id: "system", name: "System", web: null },
    { id: "arial", name: "Arial", web: null },
    { id: "serif", name: "Serif", web: null },
    { id: "atkinson", name: "Atkinson Hyperlegible", web: "Atkinson+Hyperlegible:wght@400;700" },
    { id: "lexend", name: "Lexend", web: "Lexend:wght@400;600;700" },
    { id: "inter", name: "Inter", web: "Inter:wght@400;600;700;800" }
  ];
  var SCRIPT_FONT = "Dancing+Script:wght@600;700";
  function ensureFont(fam) {
    if (!fam) return; var id = "smd-webfont-" + fam.split(":")[0].replace(/[^a-z0-9]/gi, "");
    if (document.getElementById(id)) return;
    var l = document.createElement("link"); l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=" + fam + "&display=swap";
    (document.head || document.documentElement).appendChild(l);
  }
  var ds = loadD();
  function loadD() {
    try {
      var o = JSON.parse(localStorage.getItem(DKEY));
      if (o && o.density in DENS) {
        var okTheme = THEMES.some(function (t) { return t.id === o.theme; });
        var okFont = FONTS.some(function (f) { return f.id === o.font; });
        return {
          fontScale: Math.min(1.25, Math.max(.8, +o.fontScale || 1)),
          density: o.density, autoFit: !!o.autoFit,
          theme: okTheme ? o.theme : "classic",
          font: okFont ? o.font : "plex",
          headingStyle: o.headingStyle === "script" ? "script" : "default"
        };
      }
    } catch (e) {}
    return Object.assign({}, DDEF);
  }
  function saveD() { try { localStorage.setItem(DKEY, JSON.stringify(ds)); } catch (e) {} }
  function applyD() {
    try {
      var _sc = Math.min(1.25, Math.max(.8, +ds.fontScale || 1)); ds.fontScale = _sc;   // BUG-07: bound scale to a reachable max
      document.documentElement.style.zoom = _sc;
      // BUG-07: keep the Display sheet + its Reset OUT of the app zoom (counter-zoom) so the
      // controls needed to recover are always reachable, even at max scale.
      var _inv = 1 / _sc;
      var _sh = document.getElementById("hvSheet"); if (_sh) _sh.style.zoom = _inv;
      var _scr = document.getElementById("hvScrim"); if (_scr) _scr.style.zoom = _inv;
    } catch (e) {}
    document.body.classList.remove("smd-dens-compact", "smd-dens-comfortable", "smd-dens-large");
    if (ds.density !== "default") document.body.classList.add("smd-dens-" + ds.density);
    var el = document.documentElement;
    if (ds.theme && ds.theme !== "classic") el.setAttribute("data-theme", ds.theme); else el.removeAttribute("data-theme");
    if (ds.font && ds.font !== "plex") el.setAttribute("data-font", ds.font); else el.removeAttribute("data-font");
    if (ds.headingStyle === "script") { el.setAttribute("data-head", "script"); ensureFont(SCRIPT_FONT); } else el.removeAttribute("data-head");
    var f = FONTS.filter(function (x) { return x.id === ds.font; })[0]; if (f && f.web) ensureFont(f.web);
    saveD();
  }
  function autoFitD() {
    var w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1, fs, d;
    if (w < 340) { fs = .9; d = "compact"; } else if (w < 400) { fs = .95; d = "compact"; } else if (w < 600) { fs = 1.0; d = "default"; } else if (w < 900) { fs = 1.08; d = "comfortable"; } else { fs = 1.15; d = "comfortable"; }
    if (w > h && h < 500) d = "compact";
    if (dpr >= 3 && w >= 400) fs = Math.min(1.2, fs + .05);
    ds.fontScale = fs; ds.density = d; applyD(); refreshD();
  }
  var DPRE = { default: { fontScale: 1, density: "default" }, small: { fontScale: .9, density: "compact" }, large: { fontScale: 1.15, density: "comfortable" }, senior: { fontScale: 1.25, density: "large" } };
  function openDisplay() {
    openSheet('<div class="hv-sh-t">Display &amp; Accessibility</div>' +
      '<div class="hv-d-sec"><div class="hv-d-row"><h4 style="margin:0">Font size</h4><span class="hv-d-val" id="hvFsv">100%</span></div><input type="range" id="hvFs" min="80" max="125" step="5" value="100"></div>' +
      '<div class="hv-d-sec"><h4>Display density</h4><div class="hv-seg" id="hvDens"><button data-d="compact">Compact</button><button data-d="default">Default</button><button data-d="comfortable">Comfort</button><button data-d="large">Large</button></div></div>' +
      '<div class="hv-d-sec"><h4>Quick presets</h4><div class="hv-pre" id="hvPre"><button data-p="default">Default</button><button data-p="small">Small screen</button><button data-p="large">Large screen</button><button data-p="senior">Senior friendly</button></div></div>' +
      '<div class="hv-d-sec"><h4>Auto fit</h4><div class="hv-sw"><div><div class="lab">Optimise for this device</div><div class="sub" id="hvDet"></div></div><button class="hv-tg" id="hvAuto"></button></div></div>' +
      ((window.SMD_HAPTICS && SMD_HAPTICS.supported()) ? '<div class="hv-d-sec"><h4>Haptics</h4><div class="hv-sw"><div><div class="lab">Vibration feedback on tap</div><div class="sub">A subtle tap on buttons and actions</div></div><button class="hv-tg" id="hvHaptics"></button></div></div>' : '') +
      '<div class="hv-d-sec"><h4>Theme</h4><div class="hv-theme" id="hvTheme">' +
        THEMES.map(function (t) { return '<button class="hv-th" data-t="' + t.id + '" style="--sw-paper:' + t.paper + ';--sw-acc:' + t.accent + '"><span class="hv-th-dot"></span><span class="hv-th-nm">' + t.name + '</span></button>'; }).join("") +
      '</div></div>' +
      '<div class="hv-d-sec"><h4>Font</h4><div class="hv-fonts" id="hvFont">' +
        FONTS.map(function (f) { return '<button class="hv-fn" data-f="' + f.id + '" data-font="' + f.id + '">' + f.name + '</button>'; }).join("") +
      '</div></div>' +
      '<div class="hv-d-sec"><h4>Headings</h4><div class="hv-seg" id="hvHead"><button data-h="default">Default</button><button data-h="script">Script</button></div><div class="hv-info" style="margin-top:6px">Decorative — titles only; never doses.</div></div>' +
      '<button class="hv-reset" id="hvReset">Reset to defaults</button>' +
      '<div class="hv-info" style="margin-top:12px">Changes readability &amp; spacing only — never medical content. Saved on this device.</div>');
    var s = sheetEl();
    try { var _z = 1 / (Math.min(1.25, Math.max(.8, +ds.fontScale || 1))); s.style.zoom = _z; var _sc0 = document.getElementById("hvScrim"); if (_sc0) _sc0.style.zoom = _z; } catch (e) {}
    s.querySelector("#hvFs").addEventListener("input", function () { ds.autoFit = false; ds.fontScale = (+this.value) / 100; applyD(); refreshD(); });
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.addEventListener("click", function () { ds.autoFit = false; ds.density = b.getAttribute("data-d"); applyD(); refreshD(); }); });
    s.querySelectorAll("#hvPre button").forEach(function (b) { b.addEventListener("click", function () { var p = DPRE[b.getAttribute("data-p")]; ds.autoFit = false; ds.fontScale = p.fontScale; ds.density = p.density; applyD(); refreshD(); }); });
    s.querySelector("#hvAuto").addEventListener("click", function () { ds.autoFit = !ds.autoFit; if (ds.autoFit) autoFitD(); else { applyD(); refreshD(); } });
    var hp = s.querySelector("#hvHaptics");
    if (hp) hp.addEventListener("click", function () { var on = !(window.SMD_HAPTICS && SMD_HAPTICS.enabled()); if (window.SMD_HAPTICS) { SMD_HAPTICS.setEnabled(on); if (on) SMD_HAPTICS.medium(); } refreshD(); });
    s.querySelector("#hvReset").addEventListener("click", function () { ds = Object.assign({}, DDEF); applyD(); refreshD(); });
    s.querySelectorAll("#hvTheme .hv-th").forEach(function (b) { b.addEventListener("click", function () { ds.theme = b.getAttribute("data-t"); applyD(); refreshD(); }); });
    s.querySelectorAll("#hvFont .hv-fn").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-f"); var f = FONTS.filter(function (x) { return x.id === id; })[0]; if (f && f.web) ensureFont(f.web); ds.font = id; applyD(); refreshD(); }); });
    s.querySelectorAll("#hvHead button").forEach(function (b) { b.addEventListener("click", function () { ds.headingStyle = b.getAttribute("data-h"); applyD(); refreshD(); }); });
    refreshD();
  }
  // Exposed so the sidebar's "Appearance & Theme" row opens the font & display sheet directly.
  try { window.SMD_openDisplay = openDisplay; } catch (e) {}
  function refreshD() {
    var s = sheetEl(); if (!s) return;
    var fs = s.querySelector("#hvFs"); if (fs) fs.value = Math.round(ds.fontScale * 100);
    var v = s.querySelector("#hvFsv"); if (v) v.textContent = Math.round(ds.fontScale * 100) + "%";
    s.querySelectorAll("#hvDens button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-d") === ds.density); });
    var a = s.querySelector("#hvAuto"); if (a) a.classList.toggle("on", ds.autoFit);
    var hp = s.querySelector("#hvHaptics"); if (hp) hp.classList.toggle("on", !!(window.SMD_HAPTICS && SMD_HAPTICS.enabled()));
    var d = s.querySelector("#hvDet"); if (d) d.textContent = window.innerWidth + "×" + window.innerHeight + " · DPR " + (window.devicePixelRatio || 1).toFixed(2);
    s.querySelectorAll("#hvTheme .hv-th").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-t") === ds.theme); });
    s.querySelectorAll("#hvFont .hv-fn").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-f") === ds.font); });
    s.querySelectorAll("#hvHead button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-h") === ds.headingStyle); });
  }

  // ---- toast ----
  var tEl, tTimer;
  function toast(msg) { if (!tEl) { tEl = document.createElement("div"); tEl.className = "hv-toast"; document.body.appendChild(tEl); } tEl.textContent = msg; tEl.classList.add("on"); clearTimeout(tTimer); tTimer = setTimeout(function () { tEl.classList.remove("on"); }, 1800); }

  /* ================= Notifications (🔔 bell → Notifications + Medical Updates) ================= */
  var NOTIF_API = "/api/updates", NOTIF_SEEN = "smd_updates_seen_ts", NOTIF_BM = "smd_updates_bm";
  // Owner allowlist — mirrors functions/_adminauth.js OWNER_EMAILS. Client gate only shows the
  // in-app Delete affordance; the server (ownerOK on DELETE /api/updates/:id) is the real enforcement.
  var NOTIF_OWNERS = ["stewardmd.in@gmail.com", "drmanojkurmana@gmail.com"];
  function nIsOwner() { try { var u = window.SMD_AUTH && SMD_AUTH.currentUser; return !!(u && u.email && NOTIF_OWNERS.indexOf(String(u.email).toLowerCase()) >= 0); } catch (e) { return false; } }
  var _notifItems = null;                 // Tab 1: manual app notices (auto=0)
  var _feedItems = [], _feedCursor = null, _feedEnd = false, _feedLoading = false;
  var _feedType = "all", _feedQ = "", _feedBranch = "all";
  var _notifRoot = null, _activeTab = "updates", _detailRoot = null;
  function nEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // Inline: escape, then render **bold**/__bold__ only (safe — no raw HTML passthrough).
  function nMdInline(t) { return nEsc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/__([^_]+)__/g, "<b>$1</b>"); }
  // Light markdown → HTML for update summaries: bold, "• " bullets, and bold colon-headings.
  // Escapes first, so AI-authored text can never inject markup. Plain prose still renders fine.
  function nMd(src) {
    var out = [], list = [], para = [];
    function flushList() { if (list.length) { out.push('<ul class="dt-ul">' + list.join("") + "</ul>"); list = []; } }
    function flushPara() { if (para.length) { out.push('<p class="dt-p">' + para.join(" ") + "</p>"); para = []; } }
    String(src || "").replace(/\r/g, "").split("\n").forEach(function (raw) {
      var ln = raw.trim();
      if (!ln) { flushList(); flushPara(); return; }
      var b = ln.match(/^[•\-\*]\s+(.+)$/);                                  // bullet line
      if (b) { flushPara(); list.push("<li>" + nMdInline(b[1]) + "</li>"); return; }
      flushList();
      var hb = ln.match(/^\*\*(.+?)\*\*:?$/);                                // whole-line bold = heading
      var colonHead = /:$/.test(ln) && ln.replace(/\*\*/g, "").length <= 64 && ln.split(/\s+/).length <= 9;
      if (hb || colonHead) { flushPara(); out.push('<div class="dt-h">' + nMdInline((hb ? hb[1] : ln.replace(/:$/, "")).trim()) + "</div>"); return; }
      para.push(nMdInline(ln));
    });
    flushList(); flushPara();
    return out.join("");
  }
  function nSeen() { try { return parseInt(localStorage.getItem(NOTIF_SEEN) || "0", 10) || 0; } catch (e) { return 0; } }
  function nSetSeen(ts) { try { localStorage.setItem(NOTIF_SEEN, String(ts || Date.now())); } catch (e) {} }
  function nMaxTs(items) { var m = 0; (items || []).forEach(function (x) { if ((x.ts || 0) > m) m = x.ts; }); return m; }
  function nWhen(ts) {
    if (!ts) return ""; var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago"; if (s < 604800) return Math.floor(s / 86400) + "d ago";
    try { return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }); } catch (e) { return ""; }
  }
  function nDate(ts) { try { return ts ? new Date(ts).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : ""; } catch (e) { return ""; } }
  var NCAT = { drug: svg("pills","smd-ico")+" Drug", approval: svg("check","smd-ico")+" Approval", safety: svg("warn","smd-ico")+" Safety", recall: svg("close","smd-ico")+" Recall", guideline: svg("list","smd-ico")+" Guideline", study: svg("flask","smd-ico")+" Study", general: svg("bell","smd-ico")+" Update" };
  var WSLBL = { internal_medicine: "Internal Medicine", surgery: "Surgery", ent: "ENT", ophthalmology: "Ophthalmology", obstetrics_gynaecology: "Obstetrics & Gynaecology", urology: "Urology", dentistry_omfs: "Dentistry / OMFS", paediatrics: "Paediatrics" };
  // Internal-Medicine sub-specialties ("branches") — used to filter the feed and in Notification preferences.
  var BRANCH_ORDER = ["cardiology", "nephrology", "pulmonology", "endocrinology", "infectious_diseases", "critical_care", "gastroenterology", "hepatology", "oncology", "emergency_medicine", "family_medicine"];
  var BRANCH_LBL = { cardiology: "Cardiology", nephrology: "Nephrology", pulmonology: "Pulmonology", endocrinology: "Endocrinology", infectious_diseases: "Infectious Diseases", critical_care: "Critical Care", gastroenterology: "Gastroenterology", hepatology: "Hepatology", oncology: "Oncology", emergency_medicine: "Emergency Medicine", family_medicine: "Family Medicine" };
  var TYPE_FILTERS = [["all", "All"], ["guideline", "Guidelines"], ["drug_approval", "Drug Approvals"], ["safety_alert", "Safety Alerts"], ["trial", "Major Trials"]];
  var TYPE_TAG = { guideline: svg("list","smd-ico")+" Guideline", drug_approval: svg("check","smd-ico")+" Approval", safety_alert: svg("warn","smd-ico")+" Safety", trial: svg("flask","smd-ico")+" Trial" };

  function bmGet() { try { return JSON.parse(localStorage.getItem(NOTIF_BM) || "[]") || []; } catch (e) { return []; } }
  function bmHas(id) { return bmGet().indexOf(id) >= 0; }
  function bmToggle(id) {
    var a = bmGet(), i = a.indexOf(id), on;
    if (i >= 0) { a.splice(i, 1); on = false; } else { a.push(id); on = true; }
    try { localStorage.setItem(NOTIF_BM, JSON.stringify(a)); } catch (e) {}
    // best-effort cross-device sync (signed-in only; guests stay local)
    try {
      idToken().then(function (t) {
        if (!t) return;
        var h = { "Content-Type": "application/json", "Authorization": "Bearer " + t };
        fetch(NOTIF_API + "/bookmarks" + (on ? "" : "/" + encodeURIComponent(id)), { method: on ? "POST" : "DELETE", headers: h, body: on ? JSON.stringify({ id: id }) : undefined }).catch(function () {});
      });
    } catch (e) {}
    return on;
  }
  // Merge server-side bookmarks into local (cross-device), signed-in only.
  function bmMergeFromServer() {
    try {
      idToken().then(function (t) {
        if (!t) return;
        fetch(NOTIF_API + "/bookmarks", { headers: { "Authorization": "Bearer " + t } }).then(function (r) { return r.json(); }).then(function (j) {
          if (j && Array.isArray(j.ids)) { var merged = bmGet(); j.ids.forEach(function (id) { if (merged.indexOf(id) < 0) merged.push(id); }); try { localStorage.setItem(NOTIF_BM, JSON.stringify(merged)); } catch (e) {} }
        }).catch(function () {});
      });
    } catch (e) {}
  }

  /* ---- data ---- */
  function fetchNotices() {
    return fetch(NOTIF_API + "?auto=0&limit=50", { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); })
      .then(function (j) { _notifItems = (j && j.items) || []; return _notifItems; }).catch(function () { _notifItems = _notifItems || []; return _notifItems; });
  }
  function fetchFeed(reset) {
    if (_feedLoading) return Promise.resolve(_feedItems);
    if (reset) { _feedCursor = null; _feedEnd = false; }
    if (_feedEnd && !reset) return Promise.resolve(_feedItems);
    _feedLoading = true;
    var u = NOTIF_API + "?limit=15";
    if (_feedType && _feedType !== "all") u += "&type=" + encodeURIComponent(_feedType);
    if (_feedBranch && _feedBranch !== "all") u += "&branch=" + encodeURIComponent(_feedBranch);
    if (_feedQ) u += "&q=" + encodeURIComponent(_feedQ);
    if (_feedCursor && !reset) u += "&before=" + encodeURIComponent(_feedCursor);
    return fetch(u, { headers: { "Accept": "application/json" } }).then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.items) || [];
        _feedItems = reset ? items : _feedItems.concat(items);
        _feedCursor = (j && j.nextCursor) || null; _feedEnd = !_feedCursor;
        _feedLoading = false; return _feedItems;
      }).catch(function () { _feedLoading = false; _feedEnd = true; return _feedItems; });
  }
  function refreshBadge() {
    var badge = function () { var b = document.getElementById("v3BellBtn"); if (b) b.classList.toggle("has-unread", nMaxTs(_feedItems) > nSeen()); };
    if (_feedItems && _feedItems.length) { badge(); return; }
    fetchFeed(true).then(badge);
  }
  try { window.SMD_refreshNotifBadge = refreshBadge; } catch (e) {}

  /* ---- Tab 1: app notices ---- */
  function nItemHTML(it) {
    var cat = NCAT[it.category] || NCAT.general;
    var link = it.url ? '<a class="ntf-link" href="' + nEsc(it.url) + '" target="_blank" rel="noopener noreferrer">Read source ↗</a>' : "";
    var src = it.source ? '<span class="ntf-src">' + nEsc(it.source) + '</span>' : "";
    var hi = it.importance === "high" || it.importance === "critical";
    return '<div class="ntf-card' + (hi ? " hi" : "") + '">' +
      '<div class="ntf-top"><span class="ntf-cat cat-' + nEsc(it.category || "general") + '">' + cat + '</span>' +
        (hi ? '<span class="ntf-hi">Important</span>' : "") + '<span class="ntf-time">' + nEsc(nWhen(it.ts)) + '</span></div>' +
      '<div class="ntf-title">' + nEsc(it.title) + '</div>' +
      (it.body ? '<div class="ntf-body">' + nEsc(it.body) + '</div>' : "") +
      '<div class="ntf-foot">' + src + link + '</div></div>';
  }
  function renderNotices() {
    var body = _notifRoot && _notifRoot.querySelector("#ntfNotices"); if (!body) return;
    var items = _notifItems || [];
    body.innerHTML = items.length ? items.map(nItemHTML).join("")
      : '<div class="ntf-empty">🔕 No notifications.<div>App notices and announcements from StewardMD will appear here.</div></div>';
  }

  /* ---- Tab 2: medical updates feed ---- */
  function feedCardHTML(it) {
    var tag = TYPE_TAG[it.type] || NCAT.general;
    var hi = it.importance === "high" || it.importance === "critical";
    var badge = it.importance === "critical" ? '<span class="ntf-hi crit">Critical</span>' : (it.importance === "high" ? '<span class="ntf-hi">Important</span>' : "");
    var read = it.est_read_min ? '<span class="fd-read">⏱ ' + it.est_read_min + ' min</span>' : "";
    var ws = it.workspace ? '<span class="fd-ws">' + nEsc(WSLBL[it.workspace] || it.workspace) + '</span>' : "";
    var org = it.organization || it.source || "";
    var prev = String(it.summary || it.body || "");
    var lead = prev.split("\n")[0].replace(/\*\*/g, "").replace(/^[•\-\*]\s+/, "");   // lead sentence, markdown stripped for the teaser; full bullets render in detail
    var more = prev.length > lead.length || lead.length > 220;
    return '<div class="fd-card' + (hi ? " hi" : "") + '" data-uid="' + nEsc(it.id) + '" role="button" tabindex="0">' +
      '<div class="ntf-top"><span class="ntf-cat cat-' + nEsc(it.category || "general") + '">' + tag + '</span>' + badge +
        '<span class="ntf-time">' + nEsc(nDate(it.ts)) + '</span></div>' +
      '<div class="ntf-title">' + nEsc(it.title) + '</div>' +
      (org ? '<div class="fd-org">' + nEsc(org) + '</div>' : "") +
      (prev ? '<div class="ntf-body">' + nEsc(lead.slice(0, 220)) + (more ? "…" : "") + '</div>' : "") +
      '<div class="fd-meta">' + ws + read + '<span class="fd-open">Open ›</span></div></div>';
  }
  function renderFeed() {
    var body = _notifRoot && _notifRoot.querySelector("#ntfFeed"); if (!body) return;
    var items = _feedItems || [];
    var cards = items.length ? items.map(feedCardHTML).join("")
      : '<div class="ntf-empty">🩺 No medical updates yet.<div>New guidelines, drug approvals, safety alerts and major trials appear here once the daily sync runs.</div></div>';
    var more = (!_feedEnd && items.length) ? '<div class="fd-more">Loading more…</div>' : (items.length ? '<div class="fd-end">— end —</div>' : "");
    body.innerHTML = cards + more;
  }

  /* ---- weekly "This Week in Medicine" digest banner + detail ---- */
  function fetchDigest() {
    return fetch(NOTIF_API + "/digest", { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); }).then(function (j) { return j && j.digest; }).catch(function () { return null; });
  }
  function renderDigestBanner() {
    var el = _notifRoot && _notifRoot.querySelector("#ntfDigest"); if (!el) return;
    fetchDigest().then(function (dg) {
      if (!dg || !dg.data) { el.innerHTML = ""; return; }
      var d = dg.data;
      el.innerHTML = '<button class="dg-banner" id="dgOpen"><div class="dg-badge">📰 This Week in Medicine</div>' +
        '<div class="dg-h">' + nEsc(d.headline || "Weekly digest") + '</div>' +
        (d.intro ? '<div class="dg-sub">' + nEsc(String(d.intro).slice(0, 140)) + '</div>' : "") +
        '<div class="dg-go">Read the weekly digest ›</div></button>';
      var b = el.querySelector("#dgOpen"); if (b) b.addEventListener("click", function () { openDigest(d); });
    });
  }
  function openDigest(d) {
    buildDetail(); _detailRoot.classList.add("on");
    var body = _detailRoot.querySelector("#dtBody"); if (!body) return;
    var hi = (d.highlights || []).map(function (x) { return "<li>" + nEsc(x) + "</li>"; }).join("");
    var secs = (d.sections || []).map(function (s) {
      return '<div class="dt-sec"><h4>' + nEsc(s.label || "") + '</h4><ul>' + (s.items || []).map(function (x) { return "<li>" + nEsc(x) + "</li>"; }).join("") + '</ul></div>';
    }).join("");
    body.innerHTML = '<div class="dt-head"><div class="ntf-top"><span class="ntf-cat cat-guideline">📰 Weekly digest</span></div>' +
      '<h2>' + nEsc(d.headline || "This Week in Medicine") + '</h2></div>' +
      (d.intro ? '<div class="dt-summary">' + nMd(d.intro) + '</div>' : "") +
      (hi ? '<div class="dt-sec"><h4>Highlights</h4><ul>' + hi + '</ul></div>' : "") + secs;
  }

  /* ---- shell ---- */
  function switchTab(t) {
    _activeTab = t; if (!_notifRoot) return;
    _notifRoot.querySelectorAll(".ntf-tab").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === t); });
    _notifRoot.querySelector("#paneNotices").style.display = t === "notices" ? "block" : "none";
    _notifRoot.querySelector("#paneUpdates").style.display = t === "updates" ? "block" : "none";
    if (t === "notices" && _notifItems == null) fetchNotices().then(renderNotices);
  }
  function buildNotif() {
    if (_notifRoot) return _notifRoot;
    injectNotifCSS();
    _notifRoot = document.createElement("div"); _notifRoot.id = "ntfOverlay"; _notifRoot.className = "ntf-overlay"; _notifRoot.setAttribute("role", "dialog"); _notifRoot.setAttribute("aria-modal", "true"); _notifRoot.setAttribute("aria-label", "Notifications");
    var chips = TYPE_FILTERS.map(function (f) { return '<button class="fd-chip' + (f[0] === "all" ? " on" : "") + '" data-fchip="' + f[0] + '">' + f[1] + '</button>'; }).join("");
    var branchOpts = '<option value="all">All specialties</option>' + BRANCH_ORDER.map(function (b) { return '<option value="' + b + '"' + (_feedBranch === b ? " selected" : "") + '>' + nEsc(BRANCH_LBL[b]) + '</option>'; }).join("");
    _notifRoot.innerHTML =
      '<div class="ntf-top-bar"><button class="ntf-close" id="ntfClose" aria-label="Close">‹ Close</button>' +
        '<div class="ntf-h">' + svg("bell","smd-ico") + ' Alerts</div><button class="ntf-refresh" id="ntfRefresh" aria-label="Refresh" title="Refresh">↻</button></div>' +
      '<div class="ntf-tabs"><button class="ntf-tab" data-tab="notices">Notifications</button>' +
        '<button class="ntf-tab on" data-tab="updates">Medical Updates</button></div>' +
      '<div class="ntf-scroll" id="ntfScroll">' +
        '<div id="paneNotices" style="display:none">' +
          '<div id="ntfNotices" class="ntf-list"><div class="ntf-empty">Loading…</div></div></div>' +
        '<div id="paneUpdates">' +
          '<div id="ntfPush" class="ntf-push"></div>' +
          '<div id="ntfDigest" class="ntf-digest"></div>' +
          '<div class="fd-tools"><div class="fd-chips">' + chips + '</div>' +
            '<div class="fd-row2"><select id="fdBranch" class="fd-branch" aria-label="Specialty">' + branchOpts + '</select>' +
            '<input id="fdSearch" class="fd-search" type="search" placeholder="Search…" autocomplete="off"></div></div>' +
          '<div id="ntfFeed" class="ntf-list"><div class="ntf-empty">Loading…</div></div></div>' +
      '</div>';
    document.body.appendChild(_notifRoot);
    _notifRoot.querySelector("#ntfClose").addEventListener("click", closeNotifications);
    _notifRoot.querySelector("#ntfRefresh").addEventListener("click", function () {
      if (_activeTab === "notices") { fetchNotices().then(renderNotices); }
      else { fetchFeed(true).then(function () { renderFeed(); nSetSeen(nMaxTs(_feedItems)); refreshBadge(); }); }
    });
    _notifRoot.querySelectorAll(".ntf-tab").forEach(function (b) { b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); }); });
    _notifRoot.querySelectorAll("[data-fchip]").forEach(function (b) {
      b.addEventListener("click", function () {
        _feedType = b.getAttribute("data-fchip");
        _notifRoot.querySelectorAll("[data-fchip]").forEach(function (x) { x.classList.toggle("on", x === b); });
        fetchFeed(true).then(renderFeed);
      });
    });
    var si = _notifRoot.querySelector("#fdSearch"), sT = null;
    if (si) si.addEventListener("input", function () { clearTimeout(sT); sT = setTimeout(function () { _feedQ = si.value.trim(); fetchFeed(true).then(renderFeed); }, 350); });
    var bsel = _notifRoot.querySelector("#fdBranch");
    if (bsel) bsel.addEventListener("change", function () { _feedBranch = bsel.value; fetchFeed(true).then(renderFeed); });
    var sc = _notifRoot.querySelector("#ntfScroll");
    sc.addEventListener("scroll", function () {
      if (_activeTab !== "updates" || _feedEnd || _feedLoading) return;
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 120) fetchFeed(false).then(renderFeed);
    });
    _notifRoot.querySelector("#ntfFeed").addEventListener("click", function (e) {
      var card = e.target.closest && e.target.closest(".fd-card"); if (card) openDetail(card.getAttribute("data-uid"));
    });
    return _notifRoot;
  }
  function openNotifications() {
    buildNotif(); _notifRoot.classList.add("on"); document.body.classList.add("ntf-lock");
    switchTab(_activeTab); renderPushRow(); bmMergeFromServer(); renderDigestBanner();
    fetchFeed(true).then(function () { renderFeed(); nSetSeen(nMaxTs(_feedItems)); refreshBadge(); });
  }
  function closeNotifications() { if (_notifRoot) { _notifRoot.classList.remove("on"); document.body.classList.remove("ntf-lock"); } }

  /* ---- Guideline / update detail overlay ---- */
  function detailSection(title, arr) {
    if (!arr || !arr.length) return "";
    return '<div class="dt-sec"><h4>' + nEsc(title) + '</h4><ul>' + arr.map(function (x) { return "<li>" + nMdInline(x) + "</li>"; }).join("") + '</ul></div>';
  }
  // Prescribing snapshot for DRUG updates — concise pharma info (class/indications/dose/duration/
  // contraindications) from the update's structured payload (summary_json.pharma). Only rendered for
  // drug_approval / drug safety_alert items that actually carry pharma. Inline styles are theme-agnostic.
  function pharmaSection(it, s) {
    var ph = s && s.pharma;
    if (!ph || !(it.type === "drug_approval" || it.type === "safety_alert")) return "";
    function pr(lbl, val) {
      if (!val || (Array.isArray(val) && !val.length)) return "";
      var v = Array.isArray(val) ? val.map(nEsc).join("; ") : nEsc(val);
      return '<div style="display:flex;gap:12px;padding:7px 0;border-bottom:1px solid rgba(128,128,128,.22)"><span style="flex:0 0 108px;opacity:.6;font-weight:600;font-size:12.5px">' + nEsc(lbl) + '</span><div style="flex:1;font-size:13.5px;line-height:1.5">' + v + '</div></div>';
    }
    var rows = pr("Class", ph.drug_class) + pr("Indications", ph.indications) + pr("Dose", ph.dose) + pr("Duration", ph.duration) + pr("Contraindications", ph.contraindications);
    if (!rows) return "";
    return '<div class="dt-sec"><h4>💊 Prescribing snapshot</h4>' + rows + '<div style="margin-top:8px;font-size:11.5px;opacity:.6">AI-summarised — verify against the official label before prescribing.</div></div>';
  }
  function renderDetail(data) {
    var body = _detailRoot && _detailRoot.querySelector("#dtBody"); if (!body) return;
    if (!data || !data.item) { body.innerHTML = '<div class="ntf-empty">Couldn\'t load this update.</div>'; return; }
    var it = data.item, s = data.structured || {};
    var refs = [];
    if (it.url) refs.push('<a href="' + nEsc(it.url) + '" target="_blank" rel="noopener noreferrer">Official website ↗</a>');
    if (s.official_pdf_url) refs.push('<a href="' + nEsc(s.official_pdf_url) + '" target="_blank" rel="noopener noreferrer">Official PDF ↗</a>');
    if (it.doi) refs.push('<a href="https://doi.org/' + nEsc(it.doi) + '" target="_blank" rel="noopener noreferrer">DOI: ' + nEsc(it.doi) + ' ↗</a>');
    if (it.pmid) refs.push('<a href="https://pubmed.ncbi.nlm.nih.gov/' + nEsc(it.pmid) + '/" target="_blank" rel="noopener noreferrer">PubMed ' + nEsc(it.pmid) + ' ↗</a>');
    var wc = "", lastV = (data.versions || [])[0], changes = [];
    try { changes = lastV && lastV.whats_changed_json ? JSON.parse(lastV.whats_changed_json) : []; } catch (e) {}
    if (changes && changes.length) {
      wc = '<div class="dt-sec"><h4>What\'s Changed</h4><table class="dt-wc"><tr><th>Topic</th><th>Previous</th><th>Current</th><th>Impact</th></tr>' +
        changes.map(function (c) { return '<tr><td>' + nEsc(c.topic) + '</td><td>' + nEsc(c.previous) + '</td><td>' + nEsc(c.current) + '</td><td>' + nEsc(c.impact) + '</td></tr>'; }).join("") + '</table></div>';
    } else if (data.has_whats_changed) {
      wc = '<div class="dt-sec"><h4>What\'s Changed</h4><div class="dt-muted">A newer version was detected; a change comparison will appear here.</div></div>';
    }
    var hi = it.importance === "critical" ? '<span class="ntf-hi crit">Critical</span>' : (it.importance === "high" ? '<span class="ntf-hi">Important</span>' : "");
    body.innerHTML =
      '<div class="dt-head"><div class="ntf-top"><span class="ntf-cat cat-' + nEsc(it.category || "general") + '">' + (TYPE_TAG[it.type] || NCAT.general) + '</span>' + hi +
        (it.est_read_min ? '<span class="fd-read">⏱ ' + it.est_read_min + ' min</span>' : "") + '</div>' +
      '<h2>' + nEsc(it.title) + '</h2>' +
      '<div class="dt-sub">' + nEsc(it.organization || it.source || "") + (s.version ? " · " + nEsc(s.version) : "") + (it.ts ? " · " + nEsc(nDate(it.ts)) : "") + (it.workspace ? " · " + nEsc(WSLBL[it.workspace] || it.workspace) : "") + '</div></div>' +
      ((s.summary || it.summary) ? '<div class="dt-summary">' + nMd(s.summary || it.summary) + '</div>' : "") +
      pharmaSection(it, s) +
      detailSection("What's New", (s.major_changes || []).concat(s.new_recommendations || [])) +
      wc +
      detailSection("Clinical pearls", s.clinical_pearls) +
      (s.clinical_impact ? '<div class="dt-sec"><h4>Practice impact</h4><p>' + nEsc(s.clinical_impact) + '</p></div>' : "") +
      detailSection("Practice points", s.practice_points) +
      detailSection("Removed recommendations", s.removed_recommendations) +
      (refs.length ? '<div class="dt-sec"><h4>References</h4><div class="dt-refs">' + refs.join("") + '</div></div>' : "") +
      '<div class="dt-actions">' +
        (it.url ? '<a class="dt-btn primary" href="' + nEsc(it.url) + '" target="_blank" rel="noopener noreferrer">Open Official Guideline</a>' : "") +
        '<button class="dt-btn" id="dtBookmark">' + (bmHas(it.id) ? "★ Bookmarked" : "☆ Bookmark") + '</button>' +
        '<button class="dt-btn" id="dtShare">Share</button>' +
        (nIsOwner() ? '<button class="dt-btn" id="dtDelete" style="color:#dc2626;border-color:rgba(220,38,38,.4)">Delete</button>' : "") +
        '</div>';
    var bm = body.querySelector("#dtBookmark");
    if (bm) bm.addEventListener("click", function () { bm.textContent = bmToggle(it.id) ? "★ Bookmarked" : "☆ Bookmark"; });
    var sh = body.querySelector("#dtShare");
    if (sh) sh.addEventListener("click", function () {
      var url = it.url || location.href, txt = it.title || "StewardMD medical update";
      if (navigator.share) { navigator.share({ title: txt, url: url }).catch(function () {}); }
      else { try { navigator.clipboard.writeText(txt + " — " + url); toast("Link copied"); } catch (e) {} }
    });
    var dl = body.querySelector("#dtDelete");
    if (dl) dl.addEventListener("click", function () {
      if (!confirm("Delete this notification for everyone? This can't be undone.")) return;
      dl.disabled = true;
      idToken().then(function (t) {
        if (!t) { dl.disabled = false; if (window.toast) toast("Sign in as owner to delete"); return; }
        fetch(NOTIF_API + "/" + encodeURIComponent(it.id), { method: "DELETE", headers: { "Authorization": "Bearer " + t } })
          .then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (j) {
            if (j && j.ok) { if (window.toast) toast("Deleted"); if (_detailRoot) _detailRoot.classList.remove("on"); try { fetchFeed(true).then(renderFeed); } catch (e) {} }
            else { dl.disabled = false; if (window.toast) toast(j && j.error === "unauthorised" ? "Not an owner account" : "Couldn't delete"); }
          }, function () { dl.disabled = false; if (window.toast) toast("Couldn't delete — check connection"); });
      }, function () { dl.disabled = false; });
    });
  }
  function buildDetail() {
    if (_detailRoot) return _detailRoot;
    _detailRoot = document.createElement("div"); _detailRoot.id = "ntfDetail"; _detailRoot.className = "ntf-overlay dt-overlay"; _detailRoot.setAttribute("role", "dialog"); _detailRoot.setAttribute("aria-modal", "true");
    _detailRoot.innerHTML =
      '<div class="ntf-top-bar"><button class="ntf-close" id="dtClose" aria-label="Back">‹ Back</button><div class="ntf-h">Medical Update</div><span style="width:38px"></span></div>' +
      '<div class="ntf-scroll"><div id="dtBody" class="dt-body"><div class="ntf-empty">Loading…</div></div></div>';
    document.body.appendChild(_detailRoot);
    _detailRoot.querySelector("#dtClose").addEventListener("click", function () { _detailRoot.classList.remove("on"); });
    return _detailRoot;
  }
  function openDetail(id) {
    if (!id) return;
    buildDetail(); _detailRoot.classList.add("on");
    var body = _detailRoot.querySelector("#dtBody"); if (body) body.innerHTML = '<div class="ntf-empty">Loading…</div>';
    fetch(NOTIF_API + "?id=" + encodeURIComponent(id), { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); }).then(renderDetail).catch(function () { renderDetail(null); });
  }

  /* ---- auth + notification preferences (Phase 2) ---- */
  var NOTIF_PREFS = "smd_notif_prefs";
  function idToken() { try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; return u ? u.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } }
  function authHeaders() { return idToken().then(function (t) { var h = { "Content-Type": "application/json" }; if (t) h["Authorization"] = "Bearer " + t; return h; }); }
  function defaultWorkspace() { try { if (window.SMD_WS && window.SMD_WS.active) return window.SMD_WS.active() || "internal_medicine"; } catch (e) {} return "internal_medicine"; }
  function prefsGetLocal() { try { var a = JSON.parse(localStorage.getItem(NOTIF_PREFS) || "null"); if (a && Array.isArray(a.workspaces) && a.workspaces.length) return a; } catch (e) {} return { workspaces: [defaultWorkspace()], branches: [], push_enabled: true }; }
  function prefsSetLocal(p) { try { localStorage.setItem(NOTIF_PREFS, JSON.stringify(p)); } catch (e) {} }
  function selectedWorkspaces() { return prefsGetLocal().workspaces || ["internal_medicine"]; }
  function selectedBranches() { var b = prefsGetLocal().branches; return Array.isArray(b) ? b : []; }
  // Push the current workspace selection onto this device's push subscription so the
  // server can target specialty alerts. Web: re-POST /api/push/subscribe. Native: the
  // registration listener re-posts with workspaces; nudge it by re-registering.
  function syncPushWorkspaces() {
    var ws = selectedWorkspaces();
    try {
      if (pushSupported() && navigator.serviceWorker) {
        navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
          if (!sub) return;
          authHeaders().then(function (h) { fetch("/api/push/subscribe", { method: "POST", headers: h, body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub, workspaces: ws }) }).catch(function () {}); });
        }).catch(function () {});
      }
    } catch (e) {}
    try { var P = nativePush(); if (P && P.register) P.register(); } catch (e) {}   // re-fires registration → re-posts workspaces
  }
  function openNotifPrefs() {
    var sel = selectedWorkspaces(), selB = selectedBranches();
    var order = ["internal_medicine", "surgery", "ent", "ophthalmology", "obstetrics_gynaecology", "urology", "dentistry_omfs", "paediatrics"];
    var rows = order.map(function (w) {
      var on = sel.indexOf(w) >= 0;
      var row = '<label class="np-row"><span>' + nEsc(WSLBL[w] || w) + '</span>' +
        '<input type="checkbox" class="np-ck" value="' + w + '"' + (on ? " checked" : "") + '></label>';
      if (w === "internal_medicine") {
        var brs = BRANCH_ORDER.map(function (b) {
          return '<label class="np-brow"><span>' + nEsc(BRANCH_LBL[b]) + '</span><input type="checkbox" class="np-bck" value="' + b + '"' + (selB.indexOf(b) >= 0 ? " checked" : "") + '></label>';
        }).join("");
        row += '<div class="np-branches" id="npBranches" style="' + (on ? "" : "display:none") + '"><div class="np-blabel">Internal Medicine specialties (filter your feed)</div>' + brs + '</div>';
      }
      return row;
    }).join("");
    openSheet('<div class="hv-sh-t">🔔 Notification preferences</div>' +
      '<div class="np-hint">Choose which specialties send you push alerts. Under Internal Medicine, pick sub-specialties (branches) to filter your Medical Updates feed. All updates still appear in the feed regardless.</div>' +
      '<div class="np-list">' + rows + '</div>' +
      '<button class="np-save" id="npSave">Save preferences</button>' +
      '<div class="np-msg" id="npMsg"></div>');
    injectNotifCSS();
    var s = (typeof sheetEl === "function") ? sheetEl() : document;
    var imCk = [].filter.call(s.querySelectorAll(".np-ck"), function (c) { return c.value === "internal_medicine"; })[0];
    var brWrap = s.querySelector("#npBranches");
    if (imCk && brWrap) imCk.addEventListener("change", function () { brWrap.style.display = imCk.checked ? "" : "none"; });
    var save = s.querySelector("#npSave");
    if (save) save.addEventListener("click", function () {
      var ws = [].map.call(s.querySelectorAll(".np-ck:checked"), function (c) { return c.value; });
      if (!ws.length) ws = ["internal_medicine"];
      var br = [].map.call(s.querySelectorAll(".np-bck:checked"), function (c) { return c.value; });
      if (ws.indexOf("internal_medicine") < 0) br = [];   // branches only apply within Internal Medicine
      var p = { workspaces: ws, branches: br, push_enabled: true };
      prefsSetLocal(p);
      _feedBranch = br.length === 1 ? br[0] : "all";       // one branch → default the feed filter to it
      var msg = s.querySelector("#npMsg"); if (msg) msg.textContent = "Saving…";
      authHeaders().then(function (h) {
        return fetch(NOTIF_API + "/prefs", { method: "POST", headers: h, body: JSON.stringify(p) }).then(function (r) { return r.json().catch(function () { return {}; }); });
      }).then(function (j) {
        syncPushWorkspaces();
        if (msg) msg.textContent = (j && j.ok) ? "✅ Saved" : "Saved on this device";
        try { toast("Notification preferences saved"); } catch (e) {}
      }).catch(function () { syncPushWorkspaces(); if (msg) msg.textContent = "Saved on this device"; });
    });
  }
  try { window.SMD_openNotifPrefs = openNotifPrefs; } catch (e) {}

  // Deep link from a push notification → open the Medical Updates bell on that guideline's
  // card (NOT the external source URL). Used by the SW + native tap handlers via /?u=<id>.
  function openUpdate(id) {
    if (!id) return;
    try {
      _activeTab = "updates";
      openNotifications();
      setTimeout(function () { try { openDetail(String(id)); } catch (e) {} }, 220);
    } catch (e) {}
  }
  try { window.SMD_openUpdate = openUpdate; } catch (e) {}
  // Cold-start tap: the app opened at /?u=<id> — open that card once the shell is up.
  try {
    var _um = (location.search || "").match(/[?&]u=([^&]+)/);
    if (_um && _um[1]) {
      var _uid = decodeURIComponent(_um[1]);
      window.addEventListener("load", function () { setTimeout(function () { try { openUpdate(_uid); } catch (e) {} }, 800); });
    }
  } catch (e) {}

  /* ---- Web Push (OS banner) opt-in for this device ---- */
  function pushSupported() { return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window); }
  function isStandalone() { try { return window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches); } catch (e) { return false; } }
  function isIOS() { try { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); } catch (e) { return false; } }
  function urlB64ToU8(s) { var pad = "=".repeat((4 - s.length % 4) % 4); var b = (s + pad).replace(/-/g, "+").replace(/_/g, "/"); var raw = atob(b); var a = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) a[i] = raw.charCodeAt(i); return a; }
  function pushIsOn() { try { return localStorage.getItem("smd_push_on") === "1" && ("Notification" in window) && Notification.permission === "granted"; } catch (e) { return false; } }
  function renderPushRow() {
    var el = _notifRoot && _notifRoot.querySelector("#ntfPush"); if (!el) return;
    if (nativePush()) { renderPushRowNative(el); return; }   // native app: use @capacitor/push-notifications
    if (!pushSupported()) {
      // iOS only exposes Push inside the installed (home-screen) PWA.
      el.innerHTML = (isIOS() && !isStandalone())
        ? '<div class="ntf-push-hint">📲 To get alerts on your phone: tap <b>Share → Add to Home Screen</b>, then open StewardMD from the home-screen icon and enable notifications here.</div>'
        : '';
      return;
    }
    if (pushIsOn()) {
      el.innerHTML = '<div class="ntf-push-on"><span>' + svg("bell","smd-ico") + ' Phone alerts are <b>on</b> for this device</span><button class="ntf-push-btn ghost" data-push="off">Turn off</button></div>';
    } else if (("Notification" in window) && Notification.permission === "denied") {
      el.innerHTML = '<div class="ntf-push-hint">🔕 Notifications are blocked in your device settings. Enable them for StewardMD to get phone alerts.</div>';
    } else {
      el.innerHTML = '<div class="ntf-push-off"><span>Get a phone banner when new medical updates arrive</span><button class="ntf-push-btn" data-push="on">Enable notifications</button></div>';
    }
    var b = el.querySelector("[data-push]");
    if (b) b.addEventListener("click", function () { b.getAttribute("data-push") === "on" ? enablePush() : disablePush(); });
  }
  function enablePush() {
    if (!pushSupported()) { toast("Push isn't supported here."); return; }
    fetch("/api/push/status").then(function (r) { return r.json(); }).then(function (st) {
      if (!st || !st.enabled || !st.publicKey) { toast("Push isn't switched on server-side yet."); return; }
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") { toast("Permission not granted."); renderPushRow(); return; }
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (sub) {
            return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(st.publicKey) });
          });
        }).then(function (sub) {
          return authHeaders().then(function (h) { return fetch("/api/push/subscribe", { method: "POST", headers: h, body: JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub, workspaces: selectedWorkspaces() }) }); });
        }).then(function () {
          try { localStorage.setItem("smd_push_on", "1"); } catch (e) {}
          toast("Phone alerts enabled ✅"); renderPushRow();
        });
      });
    }).catch(function () { toast("Couldn't enable notifications — try again."); renderPushRow(); });
  }
  function disablePush() {
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (!sub) return;
        return fetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).then(function () { return sub.unsubscribe(); });
      });
    }).catch(function () {}).then(function () {
      try { localStorage.removeItem("smd_push_on"); } catch (e) {}
      toast("Phone alerts turned off."); renderPushRow();
    });
  }
  /* ---- Native push (Capacitor @capacitor/push-notifications) — the native app has no
     service-worker/web-push, so the panel uses a real "Turn on notifications" button and
     the OS permission dialog instead of the web "Add to Home Screen" hint. ---- */
  function nativePush() { return (window.SMD_IS_NATIVE && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null; }
  function renderPushRowNative(el) {
    var P = nativePush(); if (!P) { el.innerHTML = ""; return; }
    P.checkPermissions().then(function (res) {
      var st = res && res.receive;
      if (st === "granted") {
        el.innerHTML = '<div class="ntf-push-on"><span>' + svg("bell","smd-ico") + ' Phone alerts are <b>on</b> for this device</span></div>';
      } else if (st === "denied") {
        el.innerHTML = '<div class="ntf-push-hint">' + svg("warn","smd-ico") + ' Notifications are blocked. Turn them on in <b>iOS Settings › StewardMD › Notifications</b>.</div>';
      } else {
        el.innerHTML = '<div class="ntf-push-off"><span>Get a phone alert when new medical updates arrive</span><button class="ntf-push-btn" data-pushnative="on">Turn on notifications</button></div>';
        var b = el.querySelector("[data-pushnative]"); if (b) b.addEventListener("click", function () { enablePushNative(); });
      }
    }).catch(function () { el.innerHTML = ""; });
  }
  function enablePushNative() {
    var P = nativePush(); if (!P) return;
    initNativePushListeners();
    P.requestPermissions().then(function (res) {
      if (res && res.receive === "granted") {
        try { P.register(); } catch (e) {}
        try { localStorage.setItem("smd_push_on", "1"); } catch (e) {}
        try { toast("Notifications enabled ✅"); } catch (e) {}
      } else { try { toast("Notifications not enabled."); } catch (e) {} }
      try { renderPushRow(); } catch (e) {}
    }).catch(function () { try { toast("Couldn't enable notifications."); } catch (e) {} });
  }
  // Forward the APNs device token to the server (best-effort; server-side delivery is
  // provisioned separately — the client flow works regardless).
  function initNativePushListeners() {
    var P = nativePush(); if (!P || P.__smdListen) return; P.__smdListen = true;
    try {
      P.addListener("registration", function (t) {
        var token = t && t.value; if (!token) return;
        try { fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ native: true, platform: "ios", token: token }) }).catch(function () {}); } catch (e) {}
      });
      P.addListener("registrationError", function () {});
    } catch (e) {}
  }
  // On native app open: if notifications aren't decided yet, offer a one-tap enable popup.
  // Already-granted → silently re-register; denied → respect it (no popup).
  function maybeOfferPushOnOpen() {
    var P = nativePush(); if (!P || window.__smdPushOffered) return; window.__smdPushOffered = true;
    initNativePushListeners();
    P.checkPermissions().then(function (res) {
      var st = res && res.receive;
      if (st === "granted") { try { P.register(); } catch (e) {} return; }
      if (st !== "prompt") return;   // denied → don't nag
      showPushPopup();
    }).catch(function () {});
  }
  function showPushPopup() {
    if (document.getElementById("smdPushPop")) return;
    var d = document.createElement("div"); d.id = "smdPushPop";
    d.style.cssText = "position:fixed;inset:0;z-index:16050;background:rgba(8,18,26,.55);display:flex;align-items:flex-end;justify-content:center";
    d.innerHTML = '<div style="background:var(--panel,#fff);color:var(--ink,#14202b);max-width:460px;width:100%;margin:0 12px 12px;border-radius:18px;padding:20px 18px calc(18px + env(safe-area-inset-bottom));box-shadow:0 -8px 40px rgba(0,0,0,.3)">' +
      '<div style="font:800 17px var(--sans,system-ui);margin-bottom:6px">🔔 Turn on notifications?</div>' +
      '<div style="font:500 14px var(--sans,system-ui);color:var(--slate,#5a7184);line-height:1.5;margin-bottom:16px">Get trusted medical updates — drug approvals, safety alerts and recalls — plus notices from StewardMD.</div>' +
      '<div style="display:flex;gap:10px"><button id="smdPushLater" style="flex:1;padding:12px;border:1px solid var(--line,#d7dee3);border-radius:12px;background:transparent;color:var(--slate,#5a7184);font:700 14px var(--sans,system-ui);cursor:pointer">Not now</button>' +
      '<button id="smdPushYes" style="flex:2;padding:12px;border:none;border-radius:12px;background:var(--teal,#0e6e63);color:#fff;font:700 14px var(--sans,system-ui);cursor:pointer">Turn on</button></div></div>';
    document.body.appendChild(d);
    function close() { if (d.parentNode) d.parentNode.removeChild(d); }
    d.querySelector("#smdPushLater").addEventListener("click", close);
    d.addEventListener("click", function (e) { if (e.target === d) close(); });
    d.querySelector("#smdPushYes").addEventListener("click", function () { close(); enablePushNative(); });
  }
  // Offer the notification popup shortly after the app is up (native only).
  if (window.SMD_IS_NATIVE) {
    try { window.addEventListener("load", function () { setTimeout(function () { try { maybeOfferPushOnOpen(); } catch (e) {} }, 1800); }); } catch (e) {}
  }
  function injectNotifCSS() {
    if (document.getElementById("ntf-css")) return;
    var css = [
      ".v3-dotbadge{position:relative}.v3-dotbadge.has-unread::after{content:'';position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#ef4444;border:2px solid var(--panel,#fff);box-shadow:0 0 0 1px #ef4444}",
      ".ntf-overlay{position:fixed;inset:0;z-index:855;background:var(--paper,#f7f7f5);display:none;flex-direction:column;overflow:hidden}",
      ".ntf-overlay.on{display:flex;animation:ntfIn .22s ease}@keyframes ntfIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}",
      "body.ntf-lock{overflow:hidden}",
      ".ntf-top-bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0);z-index:2}",
      ".ntf-close,.ntf-refresh{background:transparent;border:1px solid var(--line,#e5e5e0);border-radius:9px;height:34px;padding:0 12px;font:600 13px var(--sans,system-ui);color:var(--teal,#0a9396);cursor:pointer}",
      ".ntf-refresh{margin-left:auto;width:38px;padding:0}",
      ".ntf-h{flex:1;text-align:center;font:800 16px var(--sans,system-ui);color:var(--ink,#1a1a1a)}",
      ".ntf-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px;max-width:720px;margin:0 auto;width:100%;box-sizing:border-box;padding-bottom:calc(40px + env(safe-area-inset-bottom))}",
      ".ntf-note{font:500 12px var(--sans,system-ui);color:var(--slate-soft,#888);background:var(--teal-soft,#e0f2f1);border-radius:10px;padding:10px 12px;margin-bottom:14px;line-height:1.5}",
      ".ntf-list{display:flex;flex-direction:column;gap:10px}",
      ".ntf-card{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:13px;padding:12px 14px;border-left:4px solid var(--line,#e5e5e0)}",
      ".ntf-card.hi{border-left-color:#ef4444}",
      ".ntf-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}",
      ".ntf-cat{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.03em;color:var(--teal,#0a9396);background:var(--teal-soft,#e0f2f1);border-radius:6px;padding:2px 8px}",
      ".ntf-cat.cat-safety,.ntf-cat.cat-recall{color:#b45309;background:#fef3c7}",
      ".ntf-hi{font:800 9.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:#fff;background:#ef4444;border-radius:5px;padding:2px 7px}",
      ".ntf-time{margin-left:auto;font:600 11px var(--sans,system-ui);color:var(--slate-soft,#888)}",
      ".ntf-title{font:800 15px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.3}",
      ".ntf-body{font:500 13px var(--sans,system-ui);color:var(--slate,#555);line-height:1.55;margin-top:5px}",
      ".ntf-foot{display:flex;align-items:center;gap:10px;margin-top:9px}",
      ".ntf-src{font:600 11px var(--sans,system-ui);color:var(--slate-soft,#888)}",
      ".ntf-link{margin-left:auto;font:700 12px var(--sans,system-ui);color:var(--teal,#0a9396);text-decoration:none}",
      ".ntf-empty{text-align:center;color:var(--slate-soft,#888);font:600 14px var(--sans,system-ui);padding:40px 16px}.ntf-empty div{font-weight:500;font-size:12.5px;margin-top:8px;line-height:1.5}",
      ".ntf-push{margin-bottom:12px}.ntf-push:empty{display:none}",
      ".ntf-push-off,.ntf-push-on{display:flex;align-items:center;gap:10px;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:12px;padding:11px 13px}",
      ".ntf-push-off span,.ntf-push-on span{flex:1;font:600 12.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.4}",
      ".ntf-push-btn{flex:0 0 auto;border:none;background:var(--teal,#0a9396);color:#fff;font:700 12.5px var(--sans,system-ui);border-radius:9px;padding:9px 13px;cursor:pointer}",
      ".ntf-push-btn.ghost{background:transparent;color:var(--teal,#0a9396);border:1px solid var(--line,#e5e5e0)}",
      ".ntf-push-hint{background:var(--teal-soft,#e0f2f1);border:1px solid var(--line,#e5e5e0);border-radius:12px;padding:11px 13px;font:500 12.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.5}.ntf-push-hint b{color:var(--ink,#1a1a1a)}",
      // tabs
      ".ntf-tabs{display:flex;gap:6px;padding:8px 14px 0;background:var(--panel,#fff);border-bottom:1px solid var(--line,#e5e5e0);position:sticky;top:0;z-index:1}",
      ".ntf-tab{flex:1;background:transparent;border:none;border-bottom:2.5px solid transparent;padding:10px 6px;font:700 13px var(--sans,system-ui);color:var(--slate-soft,#888);cursor:pointer}",
      ".ntf-tab.on{color:var(--teal,#0a9396);border-bottom-color:var(--teal,#0a9396)}",
      // feed tools (filters + search)
      ".fd-tools{display:flex;flex-direction:column;gap:9px;margin-bottom:12px}",
      ".fd-chips{display:flex;gap:7px;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:2px}",
      ".fd-chip{flex:0 0 auto;background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:999px;padding:6px 12px;font:600 12px var(--sans,system-ui);color:var(--slate,#555);cursor:pointer;white-space:nowrap}",
      ".fd-chip.on{background:var(--teal,#0a9396);border-color:var(--teal,#0a9396);color:#fff}",
      ".fd-search{width:100%;box-sizing:border-box;border:1px solid var(--line,#e5e5e0);border-radius:10px;padding:9px 12px;font:500 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);background:var(--panel,#fff)}",
      // feed card
      ".fd-card{background:var(--panel,#fff);border:1px solid var(--line,#e5e5e0);border-radius:13px;padding:12px 14px;border-left:4px solid var(--teal,#0a9396);cursor:pointer;transition:transform .08s ease,box-shadow .12s ease}",
      ".fd-card:hover,.fd-card:focus{box-shadow:0 3px 14px rgba(0,0,0,.08);outline:none}.fd-card:active{transform:scale(.995)}",
      ".fd-card.hi{border-left-color:#ef4444}",
      ".fd-org{font:700 12px var(--sans,system-ui);color:var(--teal,#0a9396);margin-top:3px}",
      ".fd-meta{display:flex;align-items:center;gap:10px;margin-top:9px;flex-wrap:wrap}",
      ".fd-ws{font:600 11px var(--sans,system-ui);color:var(--slate-soft,#888);background:var(--teal-soft,#e0f2f1);border-radius:6px;padding:2px 8px}",
      ".fd-read{font:600 11px var(--sans,system-ui);color:var(--slate-soft,#888)}",
      ".fd-open{margin-left:auto;font:700 12px var(--sans,system-ui);color:var(--teal,#0a9396)}",
      ".fd-more,.fd-end{text-align:center;font:600 12px var(--sans,system-ui);color:var(--slate-soft,#888);padding:16px}",
      ".ntf-hi.crit{background:#b91c1c}",
      // detail overlay
      ".dt-overlay{z-index:860}",
      ".dt-body{max-width:720px}",
      ".dt-head h2{font:800 20px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.25;margin:8px 0 4px}",
      ".dt-sub{font:600 12.5px var(--sans,system-ui);color:var(--slate-soft,#888);line-height:1.5}",
      ".dt-summary{font:500 14.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);line-height:1.65;margin:14px 0}",
      ".dt-summary .dt-p{margin:9px 0}",
      ".dt-summary .dt-h{font:800 15px var(--sans,system-ui);color:var(--ink,#14202b);margin:16px 0 6px;letter-spacing:-.01em}",
      ".dt-summary .dt-h:first-child{margin-top:2px}",
      ".dt-summary .dt-ul{margin:6px 0 10px;padding-left:20px}",
      ".dt-summary .dt-ul>li{margin:5px 0;line-height:1.55}",
      ".dt-summary b,.dt-sec li b{font-weight:800;color:var(--ink,#14202b)}",
      ".dt-sec{margin:16px 0;border-top:1px solid var(--line,#e5e5e0);padding-top:14px}",
      ".dt-sec h4{font:800 13px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--teal,#0a9396);margin:0 0 8px}",
      ".dt-sec ul{margin:0;padding-left:18px}.dt-sec li{font:500 13.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.6;margin-bottom:5px}",
      ".dt-sec p{font:500 13.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.6;margin:0}",
      ".dt-muted{font:500 13px var(--sans,system-ui);color:var(--slate-soft,#888);font-style:italic}",
      ".dt-wc{width:100%;border-collapse:collapse;font:500 12.5px var(--sans,system-ui)}",
      ".dt-wc th{text-align:left;font-weight:800;color:var(--ink,#1a1a1a);border-bottom:2px solid var(--line,#e5e5e0);padding:6px 8px}",
      ".dt-wc td{color:var(--slate,#555);border-bottom:1px solid var(--line,#e5e5e0);padding:6px 8px;vertical-align:top}",
      ".dt-refs{display:flex;flex-direction:column;gap:7px}.dt-refs a{font:600 13px var(--sans,system-ui);color:var(--teal,#0a9396);text-decoration:none}",
      ".dt-actions{display:flex;gap:9px;flex-wrap:wrap;margin:20px 0 10px}",
      ".dt-btn{border:1px solid var(--line,#e5e5e0);background:var(--panel,#fff);color:var(--ink,#1a1a1a);font:700 13px var(--sans,system-ui);border-radius:10px;padding:11px 15px;cursor:pointer;text-decoration:none}",
      ".dt-btn.primary{background:var(--teal,#0a9396);border-color:var(--teal,#0a9396);color:#fff}",
      // notification preferences sheet
      ".np-hint{font:500 12.5px var(--sans,system-ui);color:var(--slate,#555);line-height:1.5;margin:2px 0 12px}",
      ".np-list{display:flex;flex-direction:column;gap:2px;margin-bottom:14px}",
      ".np-row{display:flex;align-items:center;justify-content:space-between;padding:11px 2px;border-bottom:1px solid var(--line,#e5e5e0);font:600 14px var(--sans,system-ui);color:var(--ink,#1a1a1a);cursor:pointer}",
      ".np-row input{width:20px;height:20px;accent-color:var(--teal,#0a9396)}",
      ".np-save{width:100%;border:none;background:var(--teal,#0a9396);color:#fff;font:700 14px var(--sans,system-ui);border-radius:11px;padding:12px;cursor:pointer}",
      ".np-msg{text-align:center;font:600 12.5px var(--sans,system-ui);color:var(--teal,#0a9396);min-height:16px;margin-top:8px}",
      // feed branch dropdown
      ".fd-row2{display:flex;gap:8px;align-items:center}",
      ".fd-branch{flex:0 0 auto;max-width:52%;border:1px solid var(--line,#e5e5e0);border-radius:10px;padding:9px 10px;font:600 12.5px var(--sans,system-ui);color:var(--ink,#1a1a1a);background:var(--panel,#fff)}",
      ".fd-row2 .fd-search{flex:1}",
      // nested Internal-Medicine branches in the prefs sheet
      ".np-branches{margin:2px 0 6px;padding:8px 10px;background:var(--teal-soft,#e0f2f1);border-radius:10px}",
      ".np-blabel{font:700 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.04em;color:var(--teal,#0a9396);margin:2px 0 4px}",
      ".np-brow{display:flex;align-items:center;justify-content:space-between;padding:7px 2px;font:600 13px var(--sans,system-ui);color:var(--ink,#1a1a1a);cursor:pointer}",
      ".np-brow input{width:18px;height:18px;accent-color:var(--teal,#0a9396)}",
      // weekly digest banner
      ".ntf-digest:empty{display:none}.ntf-digest{margin-bottom:12px}",
      ".dg-banner{display:block;width:100%;text-align:left;cursor:pointer;background:var(--teal,#0a9396);border:none;border-radius:13px;padding:13px 15px;color:#fff}",
      ".dg-badge{font:800 10.5px var(--sans,system-ui);text-transform:uppercase;letter-spacing:.05em;opacity:.9;margin-bottom:5px}",
      ".dg-h{font:800 15.5px var(--sans,system-ui);line-height:1.3}",
      ".dg-sub{font:500 12.5px var(--sans,system-ui);opacity:.92;line-height:1.45;margin-top:4px}",
      ".dg-go{font:700 12px var(--sans,system-ui);opacity:.95;margin-top:9px}"
    ].join("");
    var st = document.createElement("style"); st.id = "ntf-css"; st.textContent = css; document.head.appendChild(st);
  }

  // ---- show after entry (when the shell becomes visible) ----
  function shellVisible() { var sh = document.querySelector(".shell"); return sh && sh.offsetParent !== null; }
  function injectFont() {
    if (document.getElementById("smd-inter")) return;
    var l = document.createElement("link"); l.id = "smd-inter"; l.rel = "stylesheet";
    // v4 home adds an editorial serif (Newsreader) for the wordmark + greeting.
    var fam = "Inter:wght@400;500;600;700;800";
    if (homeV4On()) fam += "&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Nunito:wght@700;800;900&family=Sacramento";
    l.href = "https://fonts.googleapis.com/css2?family=" + fam + "&display=swap";
    document.head.appendChild(l);
  }
  function injectV3CSS() {
    if (document.getElementById("smd-uiv3")) return;
    var l = document.createElement("link"); l.id = "smd-uiv3"; l.rel = "stylesheet"; l.href = "/ui-v3.css?v=s11";
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
    b.innerHTML = window.icon("search") + " Find shared case by code";
    b.style.cssText = "display:block;width:100%;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line,#E2E8F0);border-radius:12px;background:var(--panel,#fff);color:var(--teal,#0F766E);font:700 13px var(--sans,'Inter',system-ui,sans-serif);cursor:pointer";
    b.addEventListener("click", function () { if (window.CASESHARE && CASESHARE.openPrompt) CASESHARE.openPrompt(); });
    var bar = body.querySelector(".mcp-storage-bar");
    if (bar && bar.nextSibling) body.insertBefore(b, bar.nextSibling); else body.insertBefore(b, body.firstChild);
  }
  // Inject a "Recent Cases" button into My Cases → opens the rolling last-5 trail.
  function injectRecentCasesBtn() {
    var body = document.getElementById("mcpBody"); if (!body) return;
    if (body.querySelector("#smdRecentCasesBtn")) return;
    var b = document.createElement("button");
    b.id = "smdRecentCasesBtn"; b.type = "button";
    b.innerHTML = window.icon("clock") + " Recent Cases <span style=\"font-weight:600;opacity:.7\">— last 5 you worked on</span>";
    b.style.cssText = "display:block;width:100%;margin:0 0 12px;padding:12px 14px;border:1px solid var(--line,#E2E8F0);border-radius:12px;background:var(--panel,#fff);color:var(--teal,#0F766E);font:700 13px var(--sans,'Inter',system-ui,sans-serif);cursor:pointer;text-align:left";
    b.addEventListener("click", function () { if (window.SMD_openRecentCases) window.SMD_openRecentCases(); else toast("Recent cases loading…"); });
    var bar = body.querySelector(".mcp-storage-bar");
    if (bar && bar.nextSibling) body.insertBefore(b, bar.nextSibling); else body.insertBefore(b, body.firstChild);
  }
  function wrapMyCases() {
    if (typeof window.openMyCases === "function" && !window.openMyCases._smdWrapped) {
      var orig = window.openMyCases;
      window.openMyCases = function () { var r = orig.apply(this, arguments); try { injectRecentCasesBtn(); } catch (e) {} try { injectMyCasesSearch(); } catch (e) {} return r; };
      window.openMyCases._smdWrapped = true;
    }
  }
  // ---- Account / profile block in the sidebar (settings) ----
  function smdEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function readAccount() { try { return JSON.parse(localStorage.getItem("stewardmd_account") || "null"); } catch (e) { return null; } }
  // Provider is the SOURCE OF TRUTH from Firebase (app.js stores type:"google" for every
  // provider, so account.type alone mislabels Apple). Falls back to the stored type.
  function acctProvider(a) {
    try {
      var u = (window.SMD_AUTH || (window.firebase && window.firebase.auth && window.firebase.auth()) || {}).currentUser;
      var pid = u && u.providerData && u.providerData[0] && u.providerData[0].providerId;
      if (pid === "apple.com") return "apple";
      if (pid === "google.com") return "google";
      if (pid === "password") return "email";
    } catch (e) {}
    return (a && a.type) || "";
  }
  function acctProviderLabel(a, withSync) {
    var p = acctProvider(a);
    var name = p === "apple" ? "Apple" : p === "google" ? "Google" : p === "email" ? "Email" : "";
    if (!name) return "Signed in";
    return name + (withSync ? " · cloud sync on" : " account");
  }
  function injectSbAccount() {
    var drawer = document.getElementById("sbDrawer"); if (!drawer) return;
    var head = drawer.querySelector(".sb-head"); if (!head) return;
    var box = document.getElementById("smdSbAccount");
    if (!box) { box = document.createElement("div"); box.id = "smdSbAccount"; box.className = "smd-sba"; head.insertAdjacentElement("afterend", box); }
    var a = readAccount();
    if (a && (a.email || a.type === "google" || a.type === "apple")) {
      var initial = (((a.name || a.email).trim()[0]) || "U").toUpperCase();
      var pic = a.picture
        ? '<img class="smd-sba-pic" src="' + smdEsc(a.picture) + '" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;smd-sba-pic smd-sba-ph&quot;>' + smdEsc(initial) + '</div>\'">'
        : '<div class="smd-sba-pic smd-sba-ph">' + smdEsc(initial) + '</div>';
      box.innerHTML = pic +
        '<div class="smd-sba-info"><div class="smd-sba-name">' + smdEsc(a.name || "Signed in") + '</div>' +
        '<div class="smd-sba-email">' + smdEsc(a.email) + '</div>' +
        '<div class="smd-sba-prov">' + acctProviderLabel(a, false) + '</div></div>' +
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
  // Keep the sidebar account row in sync when Firebase auth resolves. Google sign-in
  // via popup can complete asynchronously (onAuthStateChanged), not via the popup
  // promise, so refresh the row on any auth change once the account state is written.
  (function watchSbAuth() {
    var tries = 0;
    function attach() {
      try {
        var a = window.SMD_AUTH || (window.firebase && firebase.auth && firebase.auth());
        if (a && a.onAuthStateChanged) { a.onAuthStateChanged(function () { setTimeout(function () { try { injectSbAccount(); } catch (e) {} }, 60); }); return true; }
      } catch (e) {}
      return false;
    }
    if (attach()) return;
    var iv = setInterval(function () { if (attach() || ++tries > 60) clearInterval(iv); }, 500);
  })();
  function start() {
    injectFont(); build(); applyD(); if (ds.autoFit) autoFitD(); watchReasonBtn(); wrapMyCases(); wrapSidebar(); try { enhanceAbout(); } catch (e) {}
    try { initResume(); } catch (e) {}
    try { installSbScrollGuard(); } catch (e) {}
    if (IS_V2) {
      // show the new home as soon as the user is past splash/login, COVERING the app's own
      // Simple/Advanced screen so it isn't seen twice. Theme applies then (never on splash/consent).
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        var ms = document.getElementById("modeSelect"), sh = document.querySelector(".shell");
        var entered = (ms && !ms.classList.contains("hidden")) || (sh && sh.offsetParent !== null);
        if (entered || tries > 60) { clearInterval(iv); document.body.classList.add("ui-v2"); suppressModeSelect(); showV2(); try { resumeRestore(); } catch (e) {} }
      }, 120);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
