/* ============================================================================
   StewardMD — Antibiotic Decision Engine · design-handoff CHROME layer
   ----------------------------------------------------------------------------
   ADDITIVE, presentation-only. Touches ZERO engine logic / compute / ids that
   logic depends on. It only:
     • swaps the emoji in the system boxes for Material Symbols Rounded icons
       (the self-hosted `.rds-icon` font already shipped in redesign-system.css),
     • adds the "Tap to open" / "N selected" caption line to each system box,
     • injects the ICMR "Hospital policy" banner at the top of the wizard,
     • marks the Simple/Advanced toggle so CSS can render it as a segmented pill.
   All work is idempotent (data-abx-* guards) and re-applied on DOM changes so it
   survives the wizard's own re-renders. Gated by the html.abx-ui flag.
   Every clinical string / finding / id / handler is left exactly as the app made it.
   ============================================================================ */
(function () {
  "use strict";
  if (!document.documentElement.classList.contains("abx-ui")) return;

  // system-label (lower-cased) → Material Symbols Rounded glyph name.
  // Mirrors the handoff prototype's FIELD_GROUPS icons; matched by substring so
  // it survives the app's own label wording without touching any data.
  var SYS_ICON = [
    [/respir|pulmon|lung/, "respiratory_rate"],
    [/renal|urinary|genitourin|kidney/, "water_drop"],
    [/abdom|gi|hepat|gastro|liver|biliary/, "gastroenterology"],
    [/skin|soft ?tissue|haem|derma|rheum/, "dermatology"],
    [/neuro|cns|central nervous|meningi/, "neurology"],
    [/systemic|unclear|sepsis|oncolog|febrile|fuo/, "bloodtype"],
    [/cardi|vascular|endocard/, "cardiology"],
    [/tropical|malaria|dengue|fever/, "thermostat"],
    [/endocrine|metabol|dka|thyroid/, "endocrinology"],
    [/tox|poison|overdose|general/, "medication"],
    [/vital|general/, "monitor_heart"],
    [/clinical course|iv.?po/, "sync_alt"],
    [/mdr|resist|risk/, "coronavirus"],
    [/lab|science/, "science"]
  ];
  function iconFor(label) {
    var s = (label || "").toLowerCase();
    for (var i = 0; i < SYS_ICON.length; i++) if (SYS_ICON[i][0].test(s)) return SYS_ICON[i][1];
    return "check_indeterminate_small";
  }
  function msIcon(name) {
    var sp = document.createElement("span");
    sp.className = "rds-icon abx-ms";
    sp.setAttribute("aria-hidden", "true");
    sp.textContent = name;
    return sp;
  }

  // ---- system boxes: swap emoji glyph → Material Symbols + add caption -------
  function enhanceSystemBoxes(scope) {
    (scope || document).querySelectorAll(".system-picker-btn").forEach(function (btn) {
      if (btn.getAttribute("data-abx-box") === "1") return;
      var iconEl = btn.querySelector(".system-picker-icon");
      var labelEl = btn.querySelector("span:not(.system-picker-icon)");
      var label = labelEl ? labelEl.textContent : (btn.textContent || "");
      if (iconEl) {
        iconEl.textContent = "";
        iconEl.appendChild(msIcon(iconFor(label)));
      }
      // "Tap to open" caption, matching the handoff (documentation only).
      if (labelEl && !btn.querySelector(".abx-sys-cap")) {
        var cap = document.createElement("span");
        cap.className = "abx-sys-cap";
        cap.setAttribute("aria-hidden", "true");
        cap.textContent = "Tap to open";
        labelEl.insertAdjacentElement("afterend", cap);
      }
      btn.setAttribute("data-abx-box", "1");
    });
  }

  // ---- ICMR "Hospital policy" banner (static, informational) ----------------
  function bannerNode() {
    var b = document.createElement("div");
    b.className = "abx-policy-banner";
    b.setAttribute("data-abx-banner", "1");
    b.innerHTML =
      '<span class="rds-icon abx-ms" aria-hidden="true">policy</span>' +
      '<div class="abx-policy-txt"><b>Hospital policy</b> · ICMR (National) · AMRSN 2024 ' +
      '<span class="abx-policy-rec">· Recommended</span></div>' +
      '<span class="abx-policy-pill">Educational aid</span>' +
      '<button type="button" class="abx-uiswitch" data-abx-tomarinam="1" aria-label="Switch to MARINAM UI">' +
        '<span class="rds-icon abx-ms" aria-hidden="true">swap_horiz</span>MARINAM UI</button>';
    return b;
  }
  function ensureBanner(host) {
    if (!host || host.querySelector(":scope > .abx-policy-banner")) return;
    // place it at the very top of the wizard card, above the first heading/tabs
    host.insertBefore(bannerNode(), host.firstChild);
  }
  function enhanceBanners() {
    var ic = document.getElementById("inputCard");
    if (ic && ic.offsetParent !== null) ensureBanner(ic);
    var si = document.getElementById("simpleInputArea");
    if (si && si.offsetParent !== null) ensureBanner(si);
  }

  // ---- mark the Simple/Advanced toggle so CSS can style it as a segment ------
  function markToggle() {
    var t = document.getElementById("modeSwitchBtn") || document.getElementById("modeSwitchRow");
    if (t) t.setAttribute("data-abx-seg", "1");
  }

  var raf = 0;
  function runAll() {
    try { enhanceSystemBoxes(document); enhanceBanners(); markToggle(); } catch (e) {}
  }
  function schedule() {
    if (raf) return;
    raf = (window.requestAnimationFrame || setTimeout)(function () { raf = 0; runAll(); }, 60);
  }

    // Classic → MARINAM UI switch: set the pref and open the wizard overlay.
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-abx-tomarinam]");
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      try { localStorage.setItem("smd_abx_wizard", "1"); } catch (x) {}
      if (window.ABX_WIZARD && ABX_WIZARD.open) ABX_WIZARD.open();
    }, true);

  function boot() {
    runAll();
    // the wizard renders/re-renders dynamically (mode switch, step change) — keep applying.
    try {
      var mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes && muts[i].addedNodes.length) { schedule(); return; }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    [300, 900, 2000].forEach(function (d) { setTimeout(runAll, d); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
