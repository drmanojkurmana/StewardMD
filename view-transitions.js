/* StewardMD — shared-element screen transitions (view-transitions.js).
 *
 * Tap a list row (a drug, a patient, a protocol, a menu item) and its title morphs into the title
 * of the screen it opens while the rest of the screen pushes in from the right (smd-motion.js), instead of the screen cutting over.
 * Uses the platform View Transitions API (WebKit iOS 18+, Android WebView 111+): the browser
 * snapshots before and after and animates between them on the compositor.
 *
 * How, without touching any module: a capture-phase click on a ROW (a full-width tappable element
 * with a bold title inside) is held, a view transition starts, and the same click is re-dispatched
 * on the original target inside the transition's update callback. The callback resolves once the
 * DOM has changed and gone quiet (or after 180ms, so a tap never feels laggy), and the new screen's heading whose text matches the row's title
 * is given the same view-transition-name, so the title flies there. No match: the push alone.
 *
 * Skipped: no API, reduced motion, modifier clicks, inner controls inside the row (stars, toggles,
 * checkboxes), anything marked [data-no-vt], form submits, toggles (aria-pressed/aria-expanded/switch),
 * and rows inside modal dialogs ([role=dialog]/[aria-modal]: module overlays apply taps synchronously).
 * Kill switch: localStorage smd_view_tx=0. */
(function () {
  "use strict";
  function norm(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  // A heading "matches" a row title when one contains the other, ignoring case/spacing; the title
  // must be substantial so a "Back" or "1" never matches.
  function titleMatch(rowTitle, heading) {
    var a = norm(rowTitle), b = norm(heading);
    if (a.length < 3 || b.length < 3) return false;
    return a === b || (b.indexOf(a) === 0 && b.length - a.length < 40) || (a.indexOf(b) === 0 && b.length >= 4);
  }
  function isRowRect(r, vw) { return r.width >= vw * 0.7 && r.height >= 40 && r.height <= 180; }
  // Module overlays (Tokos, PrepNucleus, Narke: role=dialog roots) apply taps synchronously: holding
  // one of their rows for a transition would delay the screen by a frame and break same-tick
  // contracts (a Tokos clinic tap must paint its caliper steppers in the first markup). Never hold those.
  function inOverlay(el) { return !!(el && el.closest && el.closest('[role="dialog"],[aria-modal="true"]')); }
  var seam = { titleMatch: titleMatch, isRowRect: isRowRect, norm: norm, inOverlay: inOverlay };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;
  try { if (localStorage.getItem("smd_view_tx") === "0") return; } catch (e) {}
  if (typeof document.startViewTransition !== "function") return;
  window.SMD_VT_SEAM = seam;

  var NAME = "smd-hero";
  var ROW = "button,a[href],[role='button'],[role='link'],[onclick],[data-act]";
  var SKIP = "[data-no-vt],[aria-pressed],[aria-expanded],[role='switch'],[role='tab'],[role='checkbox'],[type='submit'],input,select,textarea,label,summary,.rnav-tile,.rnav-tab";

  var css = document.createElement("style");
  css.textContent =
    "::view-transition-group(*){animation-duration:.42s;animation-timing-function:cubic-bezier(.32,.72,0,1)}" +
    // The root (the rest of the screen) slides as a push: smd-motion.js. No cross-fade (owner, 2026-10-31).
    "::view-transition-old(" + NAME + "),::view-transition-new(" + NAME + "){animation-duration:.42s;height:100%;object-fit:none;object-position:left center}" +
    "@media (prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}";
  (document.head || document.documentElement).appendChild(css);

  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  // On screen and not hidden. Opacity is NOT checked: a new screen's content is often mid
  // entrance-fade (syndromes-motion.js) at the moment the transition captures it.
  function shown(el) {
    if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) if (getComputedStyle(n).visibility === "hidden") return false;
    return true;
  }
  // The row's title: its boldest, largest short text leaf.
  function titleOf(row) {
    var best = null, bs = 0, all = row.querySelectorAll("*");
    for (var i = 0; i < all.length && i < 60; i++) {
      var n = all[i];
      if (n.children.length) continue;
      var t = n.textContent.trim(); if (t.length < 3 || t.length > 80) continue;
      var cs = getComputedStyle(n), w = parseInt(cs.fontWeight, 10) || 400, fs = parseFloat(cs.fontSize) || 14;
      if (w < 550) continue;
      var score = fs * 10 + w / 100;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }
  function findHeading(text, exclude) {
    var c = document.querySelectorAll("h1,h2,h3,[class*='title'],[class*='bigt'],[class*='-gen'],[class*='name'],[class*='head'] > div");
    // The screen's LARGE title wins over a small nav-bar title with the same text (iOS large titles).
    var best = null, bs = -1;
    for (var i = 0; i < c.length; i++) {
      var n = c[i]; if (n === exclude || (exclude && exclude.contains(n)) || n.children.length > 3) continue;
      if (!titleMatch(text, n.textContent) || !shown(n)) continue;
      var score = (parseFloat(getComputedStyle(n).fontSize) || 0) * 1000 - n.getBoundingClientRect().top;
      if (score > bs) { bs = score; best = n; }
    }
    return best;
  }
  // Resolve once the DOM has changed and gone quiet, or after `ms`.
  function settled(ms) {
    return new Promise(function (res) {
      var done = false, mo;
      function fin() { if (done) return; done = true; try { mo.disconnect(); } catch (e) {} setTimeout(res, 16); }   // not rAF: rendering is paused during the update phase
      var quiet = 0;   // wait for the DOM to go quiet (30ms without mutations), so the whole new screen is there
      try { mo = new MutationObserver(function () { clearTimeout(quiet); quiet = setTimeout(fin, 30); }); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] }); } catch (e) {}
      setTimeout(fin, ms);
    });
  }

  var replaying = false, busy = false;
  document.addEventListener("click", function (e) {
    if (replaying || busy || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (reduced()) return;
    var t = e.target; if (!t || !t.closest) return;
    var row = t.closest(ROW); if (!row) return;
    if (inOverlay(t) || inOverlay(row)) return;
    if (t.closest(SKIP) || row.closest("[data-no-vt]")) return;
    if (!isRowRect(row.getBoundingClientRect(), innerWidth)) return;
    if (row.disabled || row.getAttribute("aria-disabled") === "true") return;
    if (row.tagName === "A" && (row.target === "_blank" || /^(mailto|tel|sms|https?):/i.test(row.getAttribute("href") || "") && row.host !== location.host)) return;
    var title = titleOf(row); if (!title) return;
    var text = title.textContent.trim();

    e.stopImmediatePropagation(); e.preventDefault();
    busy = true; window.__smdVtAt = Date.now();
    title.style.viewTransitionName = NAME;
    var target = e.target, init = { bubbles: true, cancelable: true, composed: true, view: window,
      clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, detail: e.detail || 1 };
    var hero = null;
    var vt;
    try {
      vt = document.startViewTransition(function () {
        title.style.viewTransitionName = "";
        replaying = true;
        try {
          var ev = new MouseEvent("click", init);
          var ok = target.dispatchEvent(ev);
          // Default action for links (a synthetic event does not navigate on its own in every engine).
          if (ok && row.tagName === "A" && row.href && !ev.defaultPrevented) location.href = row.href;
        } finally { replaying = false; }
        return settled(180).then(function () {
          hero = findHeading(text, row);
          if (hero) hero.style.viewTransitionName = NAME;
        });
      });
    } catch (x) {
      title.style.viewTransitionName = ""; busy = false; replaying = true;
      try { target.dispatchEvent(new MouseEvent("click", init)); } finally { replaying = false; }
      return;
    }
    var clear = function () { busy = false; if (hero) hero.style.viewTransitionName = ""; title.style.viewTransitionName = ""; };
    vt.finished.then(clear, clear);
    setTimeout(clear, 1500);
  }, true);
})();
