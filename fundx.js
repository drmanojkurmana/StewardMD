/* fundx.js — FundX AI · module shell + UI (StewardMD).
 *
 * AI-guided smartphone fundus imaging, built INSIDE StewardMD. This file owns the
 * full-screen overlay, the screen router, and (in later milestones) the live camera,
 * guided-acquisition coaching, and review/result screens. It consumes the Vision
 * Engine (window.SMD_FUNDX_VISION) and persistence (window.SMD_FUNDX_STORE) through
 * their public contracts only.
 *
 * Additive + reversible: gated behind the smd_fundx feature flag (DEFAULT OFF; enable
 * with ?fundx=1 or the Settings toggle). When the flag is off this module returns
 * early and does nothing — no globals beyond a stub, no entry points, zero change to
 * existing behaviour. Phase A UI is the frozen source of truth; any deviation forced
 * by a web/Capacitor limitation is documented in the design spec's Deviations log.
 */
(function () {
  "use strict";

  function fundxOn() {
    try {
      var q = (location.search.match(/[?&]fundx=([^&]+)/) || [])[1];
      if (q != null) return q === "1" || q === "on" || q === "true";
      var v = localStorage.getItem("smd_fundx");
      return v === null ? false : v === "1";   // DEFAULT OFF
    } catch (e) { return false; }
  }

  // Even when off, expose a stub so callers (home tile, ICU button) can no-op safely.
  if (!fundxOn()) {
    if (typeof window !== "undefined" && !window.FUNDX) {
      window.FUNDX = { open: function () { try { if (window.toast) toast("FundX AI is off — enable it in Settings."); } catch (e) {} }, close: function () {}, isOpen: function () { return false; }, enabled: function () { return false; } };
    }
    return;
  }

  var V = window.SMD_FUNDX_VISION || null;
  var STORE = window.SMD_FUNDX_STORE || null;
  var H = window.SMD_HAPTICS || null;

  var rootEl = null, ctx = null, screen = "home";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function ric(name) { return '<span class="rds-icon" aria-hidden="true">' + name + '</span>'; }
  function haptic(kind) { try { if (H && H[kind]) H[kind](); } catch (e) {} }
  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  var DISCLAIMER = 'Vision detection preview — not a diagnosis. Images stay on this device.';

  // ---- screens ------------------------------------------------------------
  function screenHome() {
    var who = ctx && ctx.name ? '<div class="fundx-sub">' + esc(ctx.name) + (ctx.meta ? ' · ' + esc(ctx.meta) : '') + '</div>' : '';
    return '' +
      '<header class="fundx-head rds-safe-top">' +
        '<button class="fundx-close" data-fx="close" aria-label="Close">' + ric("arrow_back_ios_new") + '</button>' +
        '<div class="fundx-head-tt"><b>FundX<span>AI</span></b>' + who + '</div>' +
        '<div class="fundx-head-sp"></div>' +
      '</header>' +
      '<main class="fundx-scroll">' +
        '<button class="fundx-cta" data-fx="newscan">' + ric("visibility") +
          '<div class="fundx-cta-tx"><b>New retinal scan</b><span>Guided capture with the 20D lens</span></div>' +
          ric("chevron_right") + '</button>' +
        '<div class="fundx-row2">' +
          '<button class="fundx-tile" data-fx="training">' + ric("school") + '<b>Training</b><span>Learn to align the lens</span></button>' +
          '<button class="fundx-tile" data-fx="gallery">' + ric("collections") + '<b>Scans</b><span>Review captures</span></button>' +
        '</div>' +
        '<div class="rds-section-header"><span class="rds-section-title">Recent scans</span></div>' +
        '<div id="fundxRecent" class="fundx-recent"><div class="fundx-empty">' + ric("hourglass_empty") + '<span>Loading…</span></div></div>' +
        '<p class="fundx-disc">' + DISCLAIMER + '</p>' +
      '</main>';
  }

  function paintRecent() {
    var box = document.getElementById("fundxRecent");
    if (!box || !STORE) return;
    STORE.listScans(ctx && ctx.ref).then(function (list) {
      if (!list || !list.length) {
        box.innerHTML = '<div class="fundx-empty">' + ric("photo_camera") + '<span>No scans yet. Tap “New retinal scan” to begin.</span></div>';
        return;
      }
      box.innerHTML = list.slice(0, 20).map(function (m) {
        var q = m.quality && m.quality.overall != null ? m.quality.overall : "—";
        var eye = (m.acquisition && m.acquisition.eye) || m.eye || "";
        var when = m.timestamp ? new Date(m.timestamp).toLocaleString() : "";
        return '<button class="fundx-scan" data-fx="open" data-id="' + esc(m.id) + '">' +
          (m.thumbnail ? '<img src="' + esc(m.thumbnail) + '" alt="">' : '<span class="fundx-scan-ph">' + ric("visibility") + '</span>') +
          '<div class="fundx-scan-m"><b>' + esc(eye ? eye.toUpperCase() + " eye" : "Scan") + '</b><span>' + esc(when) + '</span></div>' +
          '<span class="fundx-q">Q ' + esc(q) + '</span></button>';
      }).join("");
    }).catch(function () { box.innerHTML = '<div class="fundx-empty">' + ric("error") + '<span>Could not load scans.</span></div>'; });
  }

  function render() {
    if (!rootEl) return;
    if (screen === "home") { rootEl.innerHTML = screenHome(); paintRecent(); }
  }

  // ---- controller ---------------------------------------------------------
  function onClick(e) {
    var b = e.target.closest("[data-fx]"); if (!b) return;
    var a = b.getAttribute("data-fx");
    if (a === "close") return FUNDX.close();
    if (a === "newscan") { haptic("medium"); return toast("Guided capture arrives in the acquisition milestone."); }
    if (a === "training") { haptic("light"); return toast("Guided Training Mode arrives in a later milestone."); }
    if (a === "gallery") { haptic("light"); return toast("Scan gallery arrives with persistence."); }
    if (a === "open") { haptic("light"); return toast("Scan viewer arrives with persistence."); }
  }

  var FUNDX = {
    open: function (context) {
      ctx = context || null; screen = "home";
      if (!rootEl) {
        rootEl = document.createElement("div"); rootEl.id = "fundxRoot";
        document.body.appendChild(rootEl); rootEl.addEventListener("click", onClick);
      }
      render();
      rootEl.classList.add("on");
      document.body.style.overflow = "hidden";
      haptic("tap");
    },
    close: function () {
      if (rootEl) rootEl.classList.remove("on");
      document.body.style.overflow = "";
      haptic("tap");
    },
    isOpen: function () { return !!(rootEl && rootEl.classList.contains("on")); },
    enabled: function () { return true; },
    // expose the current screen for tests / resume
    _screen: function () { return screen; }
  };

  window.FUNDX = FUNDX;
})();
