/* StewardMD guided onboarding (onboarding.js) — additive, self-contained. Exposes window.SMD_TOUR.
 *
 * A world-class, replayable, once-per-account interactive tour:
 *   1) a first-launch WELCOME + role picker,
 *   2) a 5-step APP tour that spotlights the REAL home,
 *   3) a 16-step ICU v2 tour that spotlights the REAL ICU dashboard — the full patient-workspace
 *      walkthrough when the unit has patients, a board-level orientation when it's empty.
 * Plus a first-time ICU contextual tip, a Resume pill, and a "Guided tours" replay centre.
 * It never renders mock screens — every step highlights existing app UI; nothing in the home or
 * ICU design is changed.
 *
 * Design: mirrors "StewardMD Tour.dc.html" (flow, copy, step order). Engine = dim backdrop with a
 * pulsing spotlight cut-out measured via getBoundingClientRect (re-measured on resize/scroll/step)
 * + a coach-mark card that auto-flips above/below/centre. Tokens match #icuRoot,.icu-modal,.icu-tour
 * (--primary #0F766E, --danger #B91C1C, --warn #92620A, --ok #15803D) — no new colours invented.
 *
 * ADDITIVE ONLY: no engine / ICU_STATE / ingest / existing id/class/verb/string is touched. This
 * module reads existing [data-act]/[data-icu-act] DOM and adds an overlay layer. When the tour flag
 * is OFF the app is byte-for-byte unchanged (including the legacy ICU coach, which is only retired
 * while the tour is ON, via its own localStorage flag).
 *
 * Flag: localStorage "smd_onboarding_tour" (default ON). ?tour=0 disables, ?tour=1 forces.
 * State: per-account under "smd_apptour:<owner>". Replay from More / sidebar Reference & Help. */
(function () {
  "use strict";

  var TOUR_VERSION = 2;   // bumped from the legacy 8-step home tour → the unified welcome+app+ICU tour

  // ---- identity + persistence -------------------------------------------------------------
  function owner() {
    try { if (window.SMD_ACCOUNT && SMD_ACCOUNT.profile) { var p = SMD_ACCOUNT.profile(); if (p && p.email) return p.email; } } catch (e) {}
    try { var a = JSON.parse(localStorage.getItem("stewardmd_account") || "{}"); if (a && a.email) return a.email; } catch (e) {}
    return "anon";
  }
  function flagOn() {
    try {
      var q = (location.search.match(/[?&]tour=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on";
      var v = localStorage.getItem("smd_onboarding_tour");
      return v !== "0" && v !== "false";   // DEFAULT ON
    } catch (e) { return true; }
  }
  function skey() { return "smd_apptour:" + owner(); }
  function getState() { try { return JSON.parse(localStorage.getItem(skey())) || {}; } catch (e) { return {}; } }
  function setState(s) { try { localStorage.setItem(skey(), JSON.stringify(s)); } catch (e) {} }
  function shouldAuto() {
    if (!flagOn()) return false;
    var s = getState();
    if (s.dontShowAgain) return false;
    if (s.completedVersion === TOUR_VERSION) return false;
    if ((s.skippedCount || 0) >= 2) return false;   // a plain Skip allows one more showing
    return true;
  }
  function emit(phase, extra) { try { window.dispatchEvent(new CustomEvent("smd:tour", { detail: Object.assign({ phase: phase, version: TOUR_VERSION }, extra || {}) })); } catch (e) {} }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function reduceMotion() { try { return window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches; } catch (e) { return false; } }

  // ---- tour content (mirrors StewardMD Tour.dc.html) --------------------------------------
  var ROLES = [
    { id: "senior", label: "👴 Senior physician" },
    { id: "junior", label: "🩺 Junior / resident" },
    { id: "icu", label: "🫀 ICU specialist" },
    { id: "gp", label: "🏥 General physician" },
    { id: "explore", label: "✨ Just exploring" }
  ];

  // APP tour — targets the REAL home (rnav layout, scoped to #homeV2). Container-level selectors
  // group by section exactly like the design; steps whose target is absent auto-skip.
  var APP_TOUR = [
    { sel: ".rnav-qa,.v4-qc,.v3-primary", title: "Start here every shift",
      body: "Your most-used actions sit up top — start a structured Case, get a live differential with Dx Patient, check drugs, or open the calculators. Whatever the moment calls for." },
    { sel: ".rnav-qrow,.v4-tiles,.v3-qc", title: "Jump to any ward tool",
      body: "Syndromes, Ward Sync, the ICU dashboard and your unit Antibiogram are one tap away — no digging through menus mid-round." },
    { sel: ".rnav-grid,.v4-grid", title: "Reference at the bedside",
      body: "Calculators, a Drugs & interactions checker, Electrolyte correction and protocol Guides — the everyday tools, always to hand." },
    { sel: ".rnav-tabbar,.v3-tabbar", title: "Always know where you are",
      body: "Home, Cases, Drugs and More stay pinned to the bottom, with MaiK — your AI assistant — front and centre. One tap always brings you back here." },
    { sel: '.rnav-qc[data-act="icu"],.v4-qc[data-act="icu"],[data-act="icu"]', kind: "tap",
      title: "Let’s open the ICU dashboard", tapHint: "Tap the ICU tile",
      body: "This is the busiest part of StewardMD, so it has its own guided tour. Go ahead — tap ICU to open it.", then: "icu" }
  ];

  // ICU tour — spotlights the REAL ICU. `live` is the real selector; `liveBody` is the copy shown
  // (generic, since it's the user's own unit). `demo` is just a stable step key used for grouping.
  // Patient-workspace steps run only when a real patient card exists; tap steps advance on the real
  // outcome (patient opened / monitoring active / board returned).
  var ICU_TOUR = [
    { scr: "board", demo: "board-title", live: ".icu-v2-uhead-top,.icu-v2-uhead",
      title: "Your whole unit, one screen",
      body: "This is the ICU unit board — every patient you’re covering, in one place. The header shows the unit and how many patients are on your list.",
      liveBody: "This is your ICU unit board — every patient you’re covering in one place. The header shows the unit and how many patients are on your list." },
    { scr: "board", demo: "acuity-strip", live: ".icu-v2-strip",
      title: "Triage in a single glance",
      body: "Patients are counted by acuity — Critical, Needs review, Stable. Tap any count to filter the board, so on a busy shift you see the sickest first.",
      liveBody: "Patients are counted by acuity — Critical, Needs review, Stable. Tap any count to filter the board, so on a busy shift you see the sickest first." },
    { scr: "board", demo: "attn", live: ".icu-v2-attn",
      title: "Who needs you first",
      body: "“Needs your attention” pulls the critical and review patients to the top, each with the reason — e.g. Bed 4’s MAP 61 and lactate 4.2. Start your round here.",
      liveBody: "“Needs your attention” pulls the critical and review patients to the top, each with the reason why. Start your round here.", optional: true },
    { scr: "board", demo: "patient-card", live: ".icu-v2-card", kind: "tap", doneSel: ".icu-v2-banner",
      title: "Anatomy of a patient card", tapHint: "Tap a patient card",
      body: "Each card shows the bed, name, diagnosis, an acuity pill and key vitals (MAP · lactate · SpO₂), colour-tinted so danger stands out. Let’s open Bed 4 — Ravi Kumar, in septic shock.",
      liveBody: "Each card shows the bed, name, diagnosis, an acuity pill and key vitals, colour-tinted so danger stands out. Tap a card to open that patient." },
    { scr: "patient", demo: "banner", live: ".icu-v2-banner",
      title: "The patient workspace",
      body: "The banner takes the patient’s colour — red for critical — so you always know how sick they are. It carries the name, acuity, bed, age/sex, ICU day and diagnosis. Tap ‹ any time to go back.",
      liveBody: "The banner takes the patient’s acuity colour, and carries the name, bed, age/sex, ICU day and diagnosis. Tap ‹ any time to go back to the board." },
    { scr: "patient", demo: "mini-vitals", live: ".icu-v2-banner-vitals",
      title: "Live vitals, always in view",
      body: "MAP, HR, SpO₂ and lactate stay pinned under the banner as you move between sections — the numbers that decide your next move are never more than a glance away.",
      liveBody: "Key vitals stay pinned under the banner as you move between sections — never more than a glance away." },
    { scr: "patient", demo: "presence", live: ".icu-v2-presence",
      title: "Saved, and in sync",
      body: "Everything you enter is saved on the device automatically — nothing lost between rounds. In a shared unit, your team sees the same live record and who else is viewing.",
      liveBody: "Everything you enter is saved automatically. In a shared unit, your team sees the same live record and who else is viewing.", optional: true },
    { scr: "patient", demo: "top-tabs", live: ".icu-v2-tabwrap,.icu-v2-tabs",
      title: "Five focused workspaces",
      body: "Overview, Monitoring, Care Plan, Rounds and Records. Each groups the tools for one part of the work, so the screen never feels crowded.",
      liveBody: "These workspaces group the tools for each part of the work, so the screen never feels crowded." },
    { scr: "patient", tab: "overview", demo: "status-grid", live: ".icu-v2-body,#icuRoot .icu-grid",
      title: "Overview — the full picture",
      body: "Every vital and key lab on one screen, with today’s ICU goals underneath. Red values are outside the safe range: HR 118, MAP 61, lactate 4.2, K⁺ 6.4 all need action.",
      liveBody: "The Overview brings every vital and key lab onto one screen. Values outside the safe range are flagged so what needs action stands out." },
    { scr: "patient", demo: "icu-tab-monitoring", live: '[data-icu-act="ws:monitoring"]', kind: "tap", doneSel: ".icu-elyte-alerts,.icu-subnav",
      title: "Let’s look at Monitoring", tapHint: "Tap Monitoring",
      body: "That K⁺ of 6.4 is dangerous. Open the Monitoring workspace to see how StewardMD guides correction.",
      liveBody: "Open the Monitoring workspace to see how StewardMD interprets results and guides correction." },
    { scr: "patient", tab: "monitoring", demo: "lytes-alerts", live: ".icu-elyte-alerts",
      title: "The app flags the danger for you",
      body: "StewardMD interprets every result and surfaces the alerts first: severe hyperkalaemia, hyponatraemia, metabolic acidosis. You read the clinical picture, not just raw numbers.",
      liveBody: "StewardMD interprets every result and surfaces the alerts first — so you read the clinical picture, not just raw numbers.", optional: true },
    { scr: "patient", tab: "monitoring", demo: "lytes-grid", live: ".icu-elyte-alerts,.icu-v2-body",
      title: "Colour tells the story",
      body: "Each electrolyte is colour-coded — red critical, amber out-of-range, white normal. Tap any tile to enter a value and StewardMD suggests the correction.",
      liveBody: "Each electrolyte is colour-coded — red critical, amber out-of-range, normal in white. Tap a tile to enter a value and get a suggested correction." },
    { scr: "patient", demo: "handover", live: '.icu-v2-handover,[data-icu-act="tab:handover"]',
      title: "Handover in one tap",
      body: "The ⇄ button builds a clean SBAR round summary — vitals, labs, active problems and plan — ready to hand to the on-call team or paste into your notes.",
      liveBody: "The ⇄ button builds a clean SBAR round summary — vitals, labs, active problems and plan — ready for the on-call team.", optional: true },
    { scr: "patient", demo: "back-board", live: '.icu-v2-back,[data-icu-act="icuboard"]', kind: "tap", doneSel: ".icu-v2-uhead",
      title: "Back to the whole unit", tapHint: "Tap ‹ to go back",
      body: "Managing several beds? Tap ‹ to return to the board and switch patients. Each keeps their own vitals, labs, goals and tasks.",
      liveBody: "Tap ‹ to return to the board and switch patients. Each keeps their own vitals, labs, goals and tasks." },
    { scr: "board", demo: "bottombar", live: ".icu-v2-bottombar",
      title: "Your unit tools",
      body: "Unit takes you here; Alerts collects meaningful events across every bed; Team shows who’s on; Admit adds a new patient. That’s the whole ICU in your pocket.",
      liveBody: "Unit takes you here; Alerts collects events across every bed; Team shows who’s on; Admit adds a new patient. The whole ICU in your pocket." },
    { scr: "board", demo: null, live: null, title: "You’re ready to round 🎉", cta: "Finish",
      body: "That’s the ICU workflow end to end: scan the unit → open a patient → review → correct → hand over → move to the next bed. Replay this tour any time from Menu → About & Help.",
      liveBody: "That’s the ICU workflow end to end: scan the unit → open a patient → review → correct → hand over → move on. Replay any time from Menu → About & Help." }
  ];

  // ---- CSS (self-contained, light + dark) --------------------------------------------------
  function injectCSS() {
    if (document.getElementById("smdTourCss")) return;
    var st = document.createElement("style"); st.id = "smdTourCss";
    st.textContent = [
      // spotlight cut-out (dim backdrop via a huge ring shadow) + pulse
      ".smdt-spot{position:fixed;z-index:100040;border-radius:16px;pointer-events:none;box-shadow:0 0 0 9999px rgba(12,22,38,.62),0 0 0 3px rgba(255,255,255,.95),0 0 0 6px rgba(15,118,110,.55);transition:top .28s cubic-bezier(.4,0,.2,1),left .28s cubic-bezier(.4,0,.2,1),width .28s cubic-bezier(.4,0,.2,1),height .28s cubic-bezier(.4,0,.2,1);animation:smdtPulse 2.4s ease-in-out infinite}",
      "@keyframes smdtPulse{0%,100%{box-shadow:0 0 0 9999px rgba(12,22,38,.62),0 0 0 3px rgba(255,255,255,.95),0 0 0 6px rgba(15,118,110,.55)}50%{box-shadow:0 0 0 9999px rgba(12,22,38,.62),0 0 0 3px rgba(255,255,255,.95),0 0 0 10px rgba(15,118,110,.18)}}",
      ".smdt-veil{position:fixed;inset:0;z-index:100039;background:rgba(12,22,38,.62)}",
      // block taps outside the spotlight for non-tap steps
      ".smdt-block{position:fixed;inset:0;z-index:100038}",
      // coach-mark card
      ".smdt-card{position:fixed;z-index:100050;width:min(340px,calc(100vw - 24px));background:#fff;color:#0f172a;border:1px solid rgba(15,118,110,.14);border-radius:20px;box-shadow:0 24px 60px -18px rgba(15,23,42,.5);padding:18px;font-family:var(--sans,'Inter',system-ui,-apple-system,'IBM Plex Sans',sans-serif)}",
      ".smdt-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}",
      ".smdt-eyebrow{display:flex;align-items:center;gap:8px;font:700 10.5px/1 inherit;letter-spacing:1px;color:#0F766E}",
      ".smdt-skip{border:0;background:none;font:600 12px inherit;color:#94a3b8;cursor:pointer;padding:4px 2px}",
      ".smdt-bar{height:4px;border-radius:4px;background:#e6eef0;overflow:hidden;margin-bottom:15px}.smdt-bar>i{display:block;height:100%;background:#0F766E;border-radius:4px;transition:width .35s ease}",
      ".smdt-title{font:700 17px/1.25 inherit;letter-spacing:-.2px;color:#0f172a}",
      ".smdt-text{font:500 13.5px/1.6 inherit;color:#475569;margin-top:9px}",
      ".smdt-tap{margin-top:14px;background:#eef6f4;border:1px dashed #7cc4ba;border-radius:12px;padding:11px 13px;display:flex;align-items:center;gap:9px}",
      ".smdt-tap .h{font-size:16px}.smdt-tap.anim .h{animation:smdtBob 1.2s ease-in-out infinite}",
      ".smdt-tap .t{font:600 13px inherit;color:#0b5b54}",
      "@keyframes smdtBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}",
      ".smdt-btns{display:flex;align-items:center;gap:10px;margin-top:17px}",
      ".smdt-b{border:0;border-radius:12px;cursor:pointer;font:700 14px inherit}",
      ".smdt-b.pri{flex:1;text-align:center;color:#fff;background:#0F766E;padding:12px;box-shadow:0 8px 18px -10px rgba(15,118,110,.9)}",
      ".smdt-b.gho{color:#64748b;background:none;border:1px solid #e2e8f0;padding:11px 15px}",
      ".smdt-b:focus-visible{outline:2px solid #0F766E;outline-offset:2px}",
      // welcome (full-screen, first launch + replay)
      ".smdt-wel{position:fixed;inset:0;z-index:100055;background:radial-gradient(120% 80% at 50% -10%,#0f766e 0%,#0b5b54 42%,#073d39 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:calc(56px + env(safe-area-inset-top)) 28px calc(28px + env(safe-area-inset-bottom));font-family:var(--sans,'Inter',system-ui,sans-serif);animation:smdtFade .4s ease}",
      "@keyframes smdtFade{from{opacity:0}to{opacity:1}}",
      ".smdt-wel-ic{width:72px;height:72px;border-radius:22px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;font-size:34px}",
      ".smdt-wel-brand{font:700 26px/1 'IBM Plex Mono',monospace;letter-spacing:-.5px;color:#fff;margin-top:20px}.smdt-wel-brand b{color:#8fe3d4;font-weight:700}",
      ".smdt-wel-h{font:600 28px/1.15 inherit;color:#fff;margin-top:18px;letter-spacing:-.3px}",
      ".smdt-wel-p{font:500 15px/1.55 inherit;color:rgba(255,255,255,.82);margin:12px 0 0;max-width:300px}",
      ".smdt-roles{display:flex;flex-wrap:wrap;gap:9px;justify-content:center;margin-top:24px;max-width:340px}",
      ".smdt-role{font:600 13.5px inherit;border-radius:14px;padding:11px 15px;cursor:pointer;min-height:44px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.22);transition:.15s}",
      ".smdt-role.on{background:#fff;color:#0b5b54;border-color:#fff;box-shadow:0 6px 16px -8px rgba(0,0,0,.4)}",
      ".smdt-wel-cta{width:100%;max-width:330px;margin-top:auto;background:#fff;color:#0b5b54;font:700 16px inherit;border:0;border-radius:16px;padding:17px;cursor:pointer;box-shadow:0 10px 24px -10px rgba(0,0,0,.4)}",
      ".smdt-wel-skip{background:none;border:0;color:rgba(255,255,255,.8);font:500 13.5px inherit;padding:16px;cursor:pointer;margin-top:4px}",
      // resume pill
      ".smdt-resume{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));z-index:100045;display:flex;align-items:center;gap:9px;background:#0f172a;color:#fff;border:0;border-radius:22px;padding:11px 18px;font:600 13.5px var(--sans,system-ui,sans-serif);cursor:pointer;box-shadow:0 12px 26px -12px rgba(0,0,0,.6);animation:smdtToast .3s ease}",
      // contextual tip
      ".smdt-tip{position:fixed;left:14px;right:14px;bottom:calc(96px + env(safe-area-inset-bottom));z-index:100046;max-width:380px;margin:0 auto;background:#0f172a;color:#f8fafc;border-radius:18px;box-shadow:0 16px 34px -14px rgba(0,0,0,.6);padding:16px;font-family:var(--sans,system-ui,sans-serif);animation:smdtToast .3s ease}",
      ".smdt-tip-row{display:flex;align-items:flex-start;gap:11px}.smdt-tip-row .i{font-size:20px}",
      ".smdt-tip-t{font:700 14.5px inherit;color:#fff}.smdt-tip-x{font:500 12.5px/1.5 inherit;color:#c7d2da;margin-top:3px}",
      ".smdt-tip-btns{display:flex;gap:9px;margin-top:13px}",
      ".smdt-tip-b{border:0;border-radius:11px;cursor:pointer;font:600 13px inherit;min-height:40px}",
      ".smdt-tip-b.gho{background:none;color:#c7d2da;padding:9px 14px}.smdt-tip-b.pri{flex:1;text-align:center;background:#fff;color:#0f172a;font-weight:700;padding:10px}",
      "@keyframes smdtToast{from{opacity:0;transform:translate(-50%,12px)}to{opacity:1;transform:translate(-50%,0)}}",
      ".smdt-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(104px + env(safe-area-inset-bottom));z-index:100070;background:rgba(15,23,42,.94);color:#fff;font:600 13px var(--sans,system-ui,sans-serif);border-radius:12px;padding:11px 17px;white-space:nowrap;box-shadow:0 12px 26px -12px rgba(0,0,0,.5);opacity:0;pointer-events:none;transition:opacity .2s}",
      ".smdt-toast.on{opacity:1}",
      // replay centre
      ".smdt-replay{position:fixed;inset:0;z-index:100065;background:#f8fafc;display:flex;flex-direction:column;font-family:var(--sans,system-ui,sans-serif);animation:smdtFade .3s ease}",
      ".smdt-rp-head{flex:none;display:flex;align-items:center;justify-content:space-between;padding:calc(52px + env(safe-area-inset-top)) 18px 14px;background:#fff;border-bottom:1px solid #eef2f6}",
      ".smdt-rp-head h2{margin:0;font:700 20px inherit;color:#0f172a}",
      ".smdt-rp-x{width:40px;height:40px;border:0;border-radius:11px;background:#f1f5f9;color:#334155;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center}",
      ".smdt-rp-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:20px 18px calc(40px + env(safe-area-inset-bottom))}",
      ".smdt-rp-h{font:600 26px/1.15 inherit;color:#0f172a;letter-spacing:-.3px}",
      ".smdt-rp-p{font:500 14px/1.55 inherit;color:#64748b;margin:8px 0 20px}",
      ".smdt-rp-list{display:flex;flex-direction:column;gap:11px}",
      ".smdt-rp-card{display:flex;align-items:center;gap:14px;background:#fff;border:1px solid #eaeef2;border-radius:16px;padding:16px;text-align:left}",
      ".smdt-rp-card .e{font-size:24px}.smdt-rp-card .m{flex:1;min-width:0}",
      ".smdt-rp-card .n{font:700 15.5px inherit;color:#0f172a}.smdt-rp-card .s{font:500 13px inherit;color:#64748b;margin-top:2px}",
      ".smdt-rp-go{border:1px solid #b6ddd7;background:none;color:#0F766E;font:700 13px inherit;border-radius:11px;padding:9px 14px;min-height:40px;cursor:pointer}",
      ".smdt-rp-card.soon{opacity:.72}.smdt-rp-card .soon-tag{font:600 12px inherit;color:#94a3b8}",
      ".smdt-rp-sec{font:700 11px inherit;letter-spacing:1.2px;color:#94a3b8;margin:26px 2px 12px}",
      // dark mode
      "body.dark .smdt-card,body.v3-dark .smdt-card{background:#111b2e;color:#e7edf5;border-color:rgba(45,212,191,.3)}",
      "body.dark .smdt-text,body.v3-dark .smdt-text{color:#8fa3ba}",
      "body.dark .smdt-b.gho,body.v3-dark .smdt-b.gho{color:#8fa3ba;border-color:#2a3a52}",
      "body.dark .smdt-replay,body.v3-dark .smdt-replay{background:#0b1220}",
      "body.dark .smdt-rp-head,body.dark .smdt-rp-card,body.v3-dark .smdt-rp-head,body.v3-dark .smdt-rp-card{background:#111b2e;border-color:#22314a}",
      "body.dark .smdt-rp-head h2,body.dark .smdt-rp-h,body.dark .smdt-rp-card .n,body.v3-dark .smdt-rp-head h2,body.v3-dark .smdt-rp-h,body.v3-dark .smdt-rp-card .n{color:#e7edf5}",
      "body.dark .smdt-rp-x,body.v3-dark .smdt-rp-x{background:#1a2740;color:#c7d2da}",
      "@media (prefers-reduced-motion:reduce){.smdt-spot{transition:none;animation:none}.smdt-tap.anim .h{animation:none}}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- geometry ----------------------------------------------------------------------------
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    if (r.bottom < 0 || r.top > (window.innerHeight || 0)) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  function firstVisible(sel, scope) {
    if (!sel) return null;
    scope = scope || document;
    var list = sel.split(",");
    for (var i = 0; i < list.length; i++) {
      var els; try { els = scope.querySelectorAll(list[i].trim()); } catch (e) { continue; }
      for (var j = 0; j < els.length; j++) { if (visible(els[j])) return els[j]; }
    }
    return null;
  }
  // Does the tapped node sit inside any selector in a comma-list? Uses closest (element identity)
  // so it survives the app hiding/re-rendering the target during the very click that triggers it.
  function closestAny(target, selList) {
    if (!target || !target.closest || !selList) return false;
    var parts = selList.split(",");
    for (var i = 0; i < parts.length; i++) { try { if (target.closest(parts[i].trim())) return true; } catch (e) {} }
    return false;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    var kids = el.children, any = false;
    var top = r.top, left = r.left, bottom = r.bottom, right = r.right;
    for (var i = 0; kids && i < kids.length; i++) {
      var cs = window.getComputedStyle(kids[i]);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      var cr = kids[i].getBoundingClientRect();
      if (cr.width < 1 || cr.height < 1) continue;
      any = true;
      if (cr.top < top) top = cr.top; if (cr.left < left) left = cr.left;
      if (cr.bottom > bottom) bottom = cr.bottom; if (cr.right > right) right = cr.right;
    }
    if (!any) return { top: r.top, left: r.left, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
    return { top: top, left: left, bottom: bottom, right: right, width: right - left, height: bottom - top };
  }

  // ---- spotlight + coach-mark engine -------------------------------------------------------
  // A "run" is driven by a controller: { id, icon, steps, scope(), resolve(step), enter(step,cb),
  //   onDomTap(el,step) -> advanced?, finish(completed) }. Shared card/spotlight for every tour.
  var _spot = null, _card = null, _veil = null, _block = null, _run = null, _step = 0, _onKey = null, _tapListener = null, _tapTimer = null, _dir = 1;

  // Robust tap advancement: rather than intercept the click (racy against the app's own handler,
  // which may open ICU / re-render and hide the target on the same event), poll for the OUTCOME the
  // step expects (ICU opened, patient opened, board returned). Demo taps use a direct handler.
  function clearTapWatch() { if (_tapTimer) { clearInterval(_tapTimer); _tapTimer = null; } }
  function startTapWatch(s) {
    clearTapWatch();
    if (!_run || !_run.tapWatch) return;
    _tapTimer = setInterval(function () {
      if (!_run) { clearTapWatch(); return; }
      if (curStep() !== s) { clearTapWatch(); return; }
      var ok = false; try { ok = _run.tapWatch(s); } catch (e) {}
      if (ok) { clearTapWatch(); if (s.then === "icu") startIcuTour(); else next(); }
    }, 200);
  }

  function ensureEls() {
    injectCSS();
    if (!_spot) { _spot = document.createElement("div"); _spot.className = "smdt-spot"; document.body.appendChild(_spot); }
    if (!_veil) { _veil = document.createElement("div"); _veil.className = "smdt-veil"; document.body.appendChild(_veil); }
    if (!_block) { _block = document.createElement("div"); _block.className = "smdt-block"; _block.addEventListener("click", function (e) { e.stopPropagation(); e.preventDefault(); }); document.body.appendChild(_block); }
    if (!_card) {
      _card = document.createElement("div"); _card.className = "smdt-card"; _card.setAttribute("role", "dialog");
      _card.setAttribute("aria-modal", "false"); _card.setAttribute("aria-label", "StewardMD guided tour");
      document.body.appendChild(_card); _card.addEventListener("click", onCardClick);
    }
  }
  function positionSpot(tgt) {
    if (!tgt) { _spot.style.display = "none"; _veil.style.display = "block"; return null; }
    _veil.style.display = "none";
    var r = rectOf(tgt), pad = 8;
    var top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    var w = r.width + pad * 2, h = r.height + pad * 2;
    _spot.style.display = "block";
    _spot.style.top = top + "px"; _spot.style.left = left + "px";
    _spot.style.width = w + "px"; _spot.style.height = h + "px";
    return { top: top, left: left, bottom: top + h, right: left + w, width: w, height: h };
  }
  function positionCard(spot) {
    var cw = _card.offsetWidth || 320, ch = _card.offsetHeight || 200, vw = window.innerWidth, vh = window.innerHeight, m = 12, gap = 16, top, left;
    if (!spot) { left = (vw - cw) / 2; top = Math.max(m, (vh - ch) / 2); }
    else {
      left = Math.min(Math.max(m, spot.left + spot.width / 2 - cw / 2), vw - cw - m);
      var below = spot.bottom + gap, above = spot.top - gap - ch;
      if (below + ch + m <= vh) top = below;
      else if (above >= m) top = above;
      else { top = Math.max(m, Math.min((vh - ch) / 2, vh - ch - m)); }   // centre fallback
    }
    _card.style.left = left + "px"; _card.style.top = Math.max(m, top) + "px";
  }

  function curStep() { return _run && _run.steps[_step]; }
  function isTapStep(s) { return !!(s && s.kind === "tap"); }

  function paint() {
    var s = curStep(); if (!s) return;
    ensureEls();
    var n = _run.steps.length, last = _step === n - 1;
    var tgt = _run.resolve(s);
    if (tgt) { try { tgt.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {} }
    var body = (_run.live && s.liveBody) ? s.liveBody : s.body;
    var tap = isTapStep(s);
    _card.innerHTML =
      '<div class="smdt-top"><div class="smdt-eyebrow"><span>' + esc(_run.icon) + "</span><span>STEP " + (_step + 1) + " OF " + n + "</span></div>" +
        '<button class="smdt-skip" data-t="skip" aria-label="Skip tour">Skip</button></div>' +
      '<div class="smdt-bar"><i style="width:' + Math.round((_step + 1) / n * 100) + '%"></i></div>' +
      '<div class="smdt-title">' + esc(s.title) + "</div>" +
      '<div class="smdt-text">' + esc(body) + "</div>" +
      (tap ? '<div class="smdt-tap' + (reduceMotion() ? "" : " anim") + '"><span class="h">👆</span><span class="t">' + esc(s.tapHint || "Tap the highlighted control") + "</span></div>" : "") +
      (tap ? "" :
        '<div class="smdt-btns">' +
          (_step > 0 ? '<button class="smdt-b gho" data-t="back">Back</button>' : "") +
          '<button class="smdt-b pri" data-t="next">' + esc(s.cta || (last ? "Done" : "Next")) + "</button>" +
        "</div>");
    // tap steps let the user touch the real/demo control; non-tap steps block the backdrop.
    _block.style.display = tap ? "none" : "block";
    var spot = positionSpot(tgt); positionCard(spot);
    requestAnimationFrame(function () { positionCard(positionSpot(_run.resolve(s))); });
    if (!tap) setTimeout(function () { try { var b = _card.querySelector('[data-t="next"]'); if (b) b.focus(); } catch (e) {} }, 40);
    if (tap) startTapWatch(s); else clearTapWatch();
    emit("step_view", { tour: _run.id, step: _step });
  }

  function reflow() { if (!_run) return; var s = curStep(); if (!s) return; positionCard(positionSpot(_run.resolve(s))); }

  // Move to a specific step index, letting the controller prepare the screen first.
  function goStep(i) {
    if (!_run) return;
    if (i >= _run.steps.length) { finishRun(true); return; }
    if (i < 0) i = 0;
    _step = i;
    var s = _run.steps[i];
    showChromeForRun();
    // hide card until the target screen is ready to avoid a flash on the wrong screen
    _run.enter(s, function () {
      // Real-UI step whose element isn't present → skip it (in the current direction) rather than
      // show a coach-mark over nothing. Keeps the tour honest to whatever the live app actually shows.
      if (s.optional && !_run.resolve(s)) { goStep(_step + (_dir < 0 ? -1 : 1)); return; }
      paint();
    });
  }
  function showChromeForRun() {
    ensureEls();
    if (_spot) _spot.style.display = "block";
    if (_card) _card.style.display = "block";
    if (_block) _block.style.display = "block";
  }
  function next() { _dir = 1; var s = curStep(); if (s && s.then === "icu") { startIcuTour(); return; } goStep(_step + 1); }
  function back() { _dir = -1; if (_step > 0) goStep(_step - 1); }
  function onCardClick(e) {
    var b = e.target.closest && e.target.closest("[data-t]"); if (!b) return;
    var t = b.getAttribute("data-t");
    if (t === "back") back(); else if (t === "next") next(); else if (t === "skip") skipRun();
  }

  function startRun(controller, startStep) {
    endRun(false, true);   // clear any prior run without marking skipped
    _run = controller; _step = startStep || 0;
    ensureEls(); showChromeForRun();
    window.addEventListener("resize", reflow); window.addEventListener("scroll", reflow, true);
    _onKey = function (e) { if (e.key === "Escape") skipRun(); else if (e.key === "ArrowRight") { var s = curStep(); if (!isTapStep(s)) next(); } else if (e.key === "ArrowLeft") { var s2 = curStep(); if (!isTapStep(s2)) back(); } };
    document.addEventListener("keydown", _onKey);
    // global capture-phase tap listener so real/demo controls can advance tap steps
    _tapListener = function (e) {
      if (!_run || !_run.onDomTap) return; var s = curStep(); if (!isTapStep(s)) return;
      try { _run.onDomTap(e.target, s); } catch (x) {}   // demo taps; non-target clicks pass through
    };
    document.addEventListener("click", _tapListener, true);
    emit("started", { tour: _run.id });
    goStep(_step);
  }
  function teardownChrome() {
    clearTapWatch();
    if (_spot) _spot.style.display = "none";
    if (_veil) _veil.style.display = "none";
    if (_block) _block.style.display = "none";
    if (_card) { _card.style.display = "none"; _card.innerHTML = ""; }
    window.removeEventListener("resize", reflow); window.removeEventListener("scroll", reflow, true);
    if (_onKey) { document.removeEventListener("keydown", _onKey); _onKey = null; }
    if (_tapListener) { document.removeEventListener("click", _tapListener, true); _tapListener = null; }
  }
  function endRun(completed, silent) {
    var r = _run; _run = null; _step = 0;
    teardownChrome();
    if (completed) {
      var s = getState(); s.completedVersion = TOUR_VERSION; s.lastCompletedAt = new Date().toISOString(); setState(s);
      _pausedAt = null; hideResume();
    }
    if (r && r.finish) { try { r.finish(completed); } catch (e) {} }
    if (!silent) emit(completed ? "completed" : "skipped", { tour: r && r.id });
  }
  function finishRun(completed) { var wasLast = _run && _step === _run.steps.length - 1; endRun(completed, false); if (completed) toast("Tour complete 🎉"); }
  function skipRun() {
    var s = getState(); s.skippedVersion = TOUR_VERSION; s.skippedCount = (s.skippedCount || 0) + 1; setState(s);
    var paused = _run ? { tour: _run.id, step: _step } : null;
    endRun(false, false);
    _pausedAt = paused; if (paused) showResume();
  }

  // ---- APP tour (real home) ----------------------------------------------------------------
  function appController() {
    return {
      id: "app", icon: "🧭", live: false, steps: APP_TOUR,
      scope: function () { return document.getElementById("homeV2") || document; },
      resolve: function (s) { return firstVisible(s.sel, this.scope()); },
      enter: function (s, cb) { cb(); },
      // The user taps the real ICU tile → hand off to the ICU tour immediately (matched by element
      // identity so it survives the app opening/hiding things on the same click). startIcuTour then
      // decides live-vs-demo on its own, so this doesn't depend on the real ICU finishing opening.
      onDomTap: function (target, s) {
        if (closestAny(target, '[data-act="icu"]')) {
          setTimeout(function () { if (s.then === "icu") startIcuTour(); else next(); }, 80);
          return true;
        }
        return false;
      },
      finish: function () {}
    };
  }
  function startAppTour() { markLaunch(); startRun(appController(), 0); }

  var _startingIcu = false;

  // ---- ICU tour (hybrid) -------------------------------------------------------------------
  function liveIcuOpen() { var r = document.getElementById("icuRoot"); return !!(r && visible(r) && r.classList.contains("on")); }
  function liveHasPatients() { return !!document.querySelector("#icuRoot .icu-v2-card"); }
  function clickLive(sel) { var el = firstVisible(sel, document.getElementById("icuRoot") || document); if (el) { try { el.click(); return true; } catch (e) {} } return false; }

  // Build the step list for THIS run of the ICU tour from what the real unit actually shows.
  // No demo, no mock screens — we only ever spotlight the existing ICU UI. Patient-workspace steps
  // are included solely when a real patient card exists; on an empty unit we tour the board only.
  function assembleIcuSteps() {
    var hasCards = liveHasPatients();
    var boardOnly = { "board-title": 1, "acuity-strip": 1, "attn": 1, "bottombar": 1 };
    var list = ICU_TOUR.filter(function (s) { return hasCards || boardOnly[s.demo] || !s.live; });
    list = list.map(function (s) {
      var step = { scr: s.scr, live: s.live, tab: s.tab, kind: s.kind, doneSel: s.doneSel, title: s.title, cta: s.cta };
      // On the real UI we always use the generic copy (the demo-specific patient numbers don't apply).
      step.body = s.liveBody || s.body;
      // Real-UI steps skip if their element isn't on screen; the closing card (no target) always shows.
      if (s.live) step.optional = true;
      return step;
    });
    if (!hasCards) {
      var done = list[list.length - 1];
      if (done && !done.live) done.body = "Your unit board lives here — patients, acuity and alerts in one place. Admit a patient and you get the full workspace: vitals, labs, goals, electrolyte correction and one-tap handover. Replay this tour any time from Menu → About & Help.";
    }
    return list;
  }

  function icuController(steps) {
    return {
      id: "icu", icon: "🫀", live: true, steps: steps,
      scope: function () { return document.getElementById("icuRoot") || document; },
      resolve: function (s) { return s.live ? firstVisible(s.live, this.scope()) : null; },
      // Drive the REAL ICU into the right state for this step (open a patient / switch tab), then paint.
      enter: function (s, cb) {
        var root = document.getElementById("icuRoot") || document;
        if (s.scr === "patient") {
          if (!root.querySelector(".icu-v2-banner")) { var c = root.querySelector(".icu-v2-card"); if (c) { try { c.click(); } catch (e) {} } }
          setTimeout(function () {
            if (s.tab === "monitoring") { clickLive('[data-icu-act="ws:monitoring"]'); setTimeout(cb, 240); }
            else if (s.tab === "overview") { clickLive('[data-icu-act="tab:overview"]'); setTimeout(cb, 200); }
            else cb();
          }, root.querySelector(".icu-v2-banner") ? 20 : 260);
          return;
        }
        // board step — if a patient workspace is open, return to the board first
        if (root.querySelector(".icu-v2-banner") && !firstVisible(".icu-v2-uhead", root)) { clickLive('.icu-v2-back,[data-icu-act="icuboard"]'); setTimeout(cb, 220); return; }
        setTimeout(cb, 20);
      },
      // Tap steps advance when the real outcome appears (patient opened, monitoring active, board back).
      tapWatch: function (s) { return !!firstVisible(s.doneSel || s.live, document.getElementById("icuRoot") || document); },
      finish: function (completed) { if (completed) { var st = getState(); st.icuTourDone = true; setState(st); } }
    };
  }

  // Tour the REAL ICU. Open it if needed, wait for the board to paint, then spotlight live elements.
  function startIcuTour() {
    markLaunch(); hideResume(); hideTip();
    if (_startingIcu) return; _startingIcu = true;
    if (!liveIcuOpen()) {
      try { if (window.ICU && ICU.open) ICU.open(); else { var t = firstVisible('[data-act="icu"]', document); if (t) t.click(); } } catch (e) {}
    }
    var waited = 0;
    (function wait() {
      var boardUp = liveIcuOpen() && (document.querySelector("#icuRoot .icu-v2-uhead") || document.querySelector("#icuRoot .icu-v2-card") || document.querySelector("#icuRoot .icu-v2-strip"));
      if (boardUp || waited >= 1600) { _startingIcu = false; startRun(icuController(assembleIcuSteps()), 0); return; }
      waited += 150; setTimeout(wait, 150);
    })();
  }

  // ---- WELCOME (first launch + replay) -----------------------------------------------------
  var _welEl = null, _selRole = null;
  function showWelcome(fromReplay) {
    injectCSS();
    if (!_welEl) { _welEl = document.createElement("div"); _welEl.className = "smdt-wel"; document.body.appendChild(_welEl); }
    _selRole = null;
    var roles = ROLES.map(function (r) { return '<button class="smdt-role" data-role="' + r.id + '">' + esc(r.label) + "</button>"; }).join("");
    _welEl.innerHTML =
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
        '<div class="smdt-wel-ic">🧭</div>' +
        '<div class="smdt-wel-brand">Steward<b>MD</b></div>' +
        '<div class="smdt-wel-h">Welcome, Doctor.</div>' +
        '<p class="smdt-wel-p">Let’s take two minutes to get you comfortable. First — which best describes you? We’ll tailor the tour.</p>' +
        '<div class="smdt-roles">' + roles + "</div>" +
      "</div>" +
      '<button class="smdt-wel-cta" data-w="start">Start the guided tour  →</button>' +
      '<button class="smdt-wel-skip" data-w="skip">Skip — I’ll explore on my own</button>';
    _welEl.style.display = "flex";
    _welEl.onclick = function (e) {
      var role = e.target.closest && e.target.closest("[data-role]");
      if (role) { _selRole = role.getAttribute("data-role"); try { localStorage.setItem("smd_tour_role", _selRole); } catch (x) {} var all = _welEl.querySelectorAll(".smdt-role"); for (var i = 0; i < all.length; i++) all[i].classList.remove("on"); role.classList.add("on"); return; }
      var w = e.target.closest && e.target.closest("[data-w]"); if (!w) return;
      var act = w.getAttribute("data-w");
      hideWelcome();
      if (act === "start") { startAppTour(); }
      else { var s = getState(); s.skippedCount = (s.skippedCount || 0) + 1; setState(s); toast("You can replay tours from Menu → About & Help"); emit("skipped", { tour: "welcome" }); }
    };
    emit("started", { tour: "welcome", replay: !!fromReplay });
  }
  function hideWelcome() { if (_welEl) { _welEl.style.display = "none"; _welEl.onclick = null; } }

  // ---- resume pill -------------------------------------------------------------------------
  var _pausedAt = null, _resumeEl = null;
  function showResume() {
    if (!_pausedAt) return; injectCSS();
    if (!_resumeEl) { _resumeEl = document.createElement("button"); _resumeEl.className = "smdt-resume"; _resumeEl.setAttribute("aria-label", "Resume tour"); document.body.appendChild(_resumeEl); _resumeEl.onclick = resumeTour; }
    _resumeEl.innerHTML = '<span>▶</span><span>Resume tour</span>';
    _resumeEl.style.display = "flex";
  }
  function hideResume() { if (_resumeEl) _resumeEl.style.display = "none"; }
  function resumeTour() { if (!_pausedAt) return; var p = _pausedAt; _pausedAt = null; hideResume(); if (p.tour === "icu") startIcuTour(); else startAppTour(); }

  // ---- contextual ICU tip ------------------------------------------------------------------
  var _tipEl = null, _tipWired = false;
  function icuTipSeen() { var s = getState(); return !!(s.icuTipSeen || s.icuTourDone); }
  function showIcuTip() {
    if (!flagOn() || icuTipSeen()) return;
    if (_run) return;   // not during a tour
    injectCSS();
    var s = getState(); s.icuTipSeen = true; setState(s);
    if (!_tipEl) { _tipEl = document.createElement("div"); _tipEl.className = "smdt-tip"; _tipEl.setAttribute("role", "dialog"); _tipEl.setAttribute("aria-label", "ICU tour tip"); document.body.appendChild(_tipEl); }
    _tipEl.innerHTML =
      '<div class="smdt-tip-row"><span class="i">🫀</span><div><div class="smdt-tip-t">New to the ICU dashboard?</div><div class="smdt-tip-x">Take a 2-minute guided walkthrough of the full clinical workflow.</div></div></div>' +
      '<div class="smdt-tip-btns"><button class="smdt-tip-b gho" data-tt="no">Not now</button><button class="smdt-tip-b pri" data-tt="go">Start the ICU tour</button></div>';
    _tipEl.style.display = "block";
    _tipEl.onclick = function (e) { var b = e.target.closest && e.target.closest("[data-tt]"); if (!b) return; hideTip(); if (b.getAttribute("data-tt") === "go") startIcuTour(); };
  }
  function hideTip() { if (_tipEl) { _tipEl.style.display = "none"; _tipEl.onclick = null; } }
  function watchIcuTip() {
    // First time the live ICU board opens (outside a tour), offer the ICU tour.
    var last = false;
    setInterval(function () {
      if (!flagOn()) return;
      var open = liveIcuOpen();
      if (open && !last && !_run && !icuTipSeen()) { setTimeout(function () { if (liveIcuOpen() && !_run) showIcuTip(); }, 700); }
      if (!open) hideTip();
      last = open;
    }, 700);
  }

  // ---- toast -------------------------------------------------------------------------------
  var _toastEl = null, _toastT = null;
  function toast(msg) {
    injectCSS();
    if (!_toastEl) { _toastEl = document.createElement("div"); _toastEl.className = "smdt-toast"; document.body.appendChild(_toastEl); }
    _toastEl.textContent = msg; _toastEl.classList.add("on");
    clearTimeout(_toastT); _toastT = setTimeout(function () { _toastEl.classList.remove("on"); }, 1800);
  }

  // ---- replay centre -----------------------------------------------------------------------
  var _replayEl = null;
  function openReplay() {
    injectCSS();
    if (!_replayEl) { _replayEl = document.createElement("div"); _replayEl.className = "smdt-replay"; _replayEl.setAttribute("role", "dialog"); _replayEl.setAttribute("aria-label", "Guided tours"); document.body.appendChild(_replayEl); }
    function card(emoji, name, sub, tour) { return '<div class="smdt-rp-card"><span class="e">' + emoji + '</span><div class="m"><div class="n">' + esc(name) + '</div><div class="s">' + esc(sub) + '</div></div><button class="smdt-rp-go" data-rp="' + tour + '">Replay</button></div>'; }
    function soon(emoji, name) { return '<div class="smdt-rp-card soon"><span class="e">' + emoji + '</span><div class="m"><div class="n">' + esc(name) + '</div><div class="s">Coming soon</div></div><span class="soon-tag">Soon</span></div>'; }
    _replayEl.innerHTML =
      '<div class="smdt-rp-head"><h2>About &amp; Help</h2><button class="smdt-rp-x" data-rp="close" aria-label="Close">✕</button></div>' +
      '<div class="smdt-rp-body">' +
        '<div class="smdt-rp-h">Guided tours</div><p class="smdt-rp-p">Replay any walkthrough at your own pace. Nothing you’ve entered is changed.</p>' +
        '<div class="smdt-rp-list">' +
          card("👋", "First-launch welcome", "Role pick & warm intro · 30s", "welcome") +
          card("🧭", "App overview", "Find your way around home · 1 min", "app") +
          card("🫀", "ICU Dashboard", "The full clinical workflow · 2 min", "icu") +
        "</div>" +
        '<div class="smdt-rp-sec">MODULE TOURS</div>' +
        '<div class="smdt-rp-list">' + soon("🧠", "Clinical Reasoning") + soon("🧮", "Calculators") + "</div>" +
      "</div>";
    _replayEl.style.display = "flex";
    _replayEl.onclick = function (e) {
      var b = e.target.closest && e.target.closest("[data-rp]"); if (!b) return;
      var v = b.getAttribute("data-rp"); closeReplay();
      if (v === "welcome") showWelcome(true);
      else if (v === "app") startAppTour();
      else if (v === "icu") startIcuTour();
    };
  }
  function closeReplay() { if (_replayEl) { _replayEl.style.display = "none"; _replayEl.onclick = null; } }

  // ---- launch bookkeeping + auto trigger ---------------------------------------------------
  function markLaunch() { var s = getState(); s.launchCount = (s.launchCount || 0) + 1; setState(s); }

  // Blocking pre-home gates (kept structurally stable — a harness extracts gateUp()/homeForeground()).
  function gateUp() {
    var ids = ["accountGate", "introPoster", "verifyGate", "splash", "smdBootSplash"];
    for (var i = 0; i < ids.length; i++) { var el = document.getElementById(ids[i]); if (el && visible(el)) return true; }
    return false;
  }
  function entered() {
    try {
      if (window.SMD_ACCOUNT && typeof SMD_ACCOUNT.profile === "function") {
        var p = SMD_ACCOUNT.profile() || {};
        return p.signedIn === true || p.isGuest === true || (p.type != null && p.type !== "");
      }
    } catch (e) {}
    return null;
  }
  function appOverlayUp() {
    var sels = ["#icuRoot.on", "#ghisPanel.open", "#mcOverlay.on", "#mdOverlay.on", "#miOverlay.on", "#abgOverlay.on", "#eceOverlay.on", "#sbDrawer.open"];
    for (var i = 0; i < sels.length; i++) { var el = document.querySelector(sels[i]); if (el && visible(el)) return true; }
    return false;
  }
  function homeIsTopmost(h) {
    try {
      var el = document.elementFromPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight * 0.45));
      return !el || h.contains(el);
    } catch (e) { return true; }
  }
  function homeForeground() {
    var h = document.getElementById("homeV2");
    if (!h || !visible(h) || !h.classList.contains("on")) return false;
    if (gateUp() || appOverlayUp()) return false;
    if (entered() === false) return false;
    if (!homeIsTopmost(h)) return false;
    return true;
  }
  var _arming = false, _sessionShown = false;
  function maybeAuto() {
    if (_sessionShown || _arming || _welEl && _welEl.style.display === "flex") return;
    if (!shouldAuto()) return;
    if (!homeForeground()) return;
    _arming = true;
    setTimeout(function () {
      _arming = false;
      if (_sessionShown || !shouldAuto() || !homeForeground()) return;
      _sessionShown = true;
      try { showWelcome(false); } catch (e) {}
    }, 650);
  }
  function watch() {
    var tries = 0;
    var iv = setInterval(function () {
      if (_sessionShown || !shouldAuto()) { clearInterval(iv); return; }
      if (homeForeground()) { maybeAuto(); return; }
      if (gateUp() || entered() === false) tries = 0;
      else if (++tries > 80) clearInterval(iv);
    }, 500);
  }

  // Retire the legacy one-time ICU coach so it never competes with the new tour/tip — but only
  // while the new tour is enabled, so a flag-OFF app is byte-for-byte unchanged.
  function retireLegacyCoach() {
    if (!flagOn()) return;
    try { if (localStorage.getItem("stewardmd_icu_seen") !== "1") localStorage.setItem("stewardmd_icu_seen", "1"); } catch (e) {}
  }

  // ---- public API --------------------------------------------------------------------------
  window.SMD_TOUR = {
    // start(id) — 'welcome' | 'app' | 'icu'. Any other value (incl. legacy {replay:true}) opens the chooser.
    start: function (opts) {
      try {
        var id = typeof opts === "string" ? opts : (opts && opts.tour);
        if (id === "welcome") return showWelcome(true);
        if (id === "app") return startAppTour();
        if (id === "icu") return startIcuTour();
        return openReplay();
      } catch (e) {}
    },
    replay: openReplay,
    welcome: function () { try { showWelcome(true); } catch (e) {} },
    app: function () { try { startAppTour(); } catch (e) {} },
    icu: function () { try { startIcuTour(); } catch (e) {} },
    maybeAuto: maybeAuto,
    reset: function () { try { localStorage.removeItem(skey()); } catch (e) {} },
    version: TOUR_VERSION
  };

  function boot() { retireLegacyCoach(); watch(); watchIcuTip(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
