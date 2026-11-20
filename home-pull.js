/* StewardMD Home: "Pull for a pulse" (home-pull.js). window.SMD_HOME_PULL. ES5.
 * Owner 2026-11-20 (screenshot): pulling Home down showed a pale empty band and a stray Back button above the hero:
 * "pulling down look ugly, do something creative".
 *
 * What the pull shows now: the space above the hero is the hero's own deep teal (it stretches; it never tears away),
 * and an ECG trace draws itself across it as you pull, "Pull for a pearl" under it. Past the trigger the trace beats
 * (pull-refresh.js's haptic tick); let go and it sweeps like a monitor with a lub-dub haptic while a short clinical
 * pearl holds the band open for a moment, then it springs home. A fling that bounces past the top natively (iOS)
 * fills with the same teal and trace, never the pale page.
 * Mechanics: Home's scroller is registered with pull-refresh.js (register(el, fn, { draw, hold, own })), so the drag,
 * resistance, springs and catch-mid-settle are the app's one pull engine; this file only draws. While the band is open
 * body.hv-pulling is set and swipe-back.js keeps its global Back button hidden.
 * Kill switch: localStorage smd_home_pull = "0". Reduced motion: no sweep animation; the trace and pearl still show. */
(function () {
  "use strict";
  // Short, true, and kind. No em-dash (app text rule). MaiK's own pearls are used when maik-companion.js is loaded.
  var OWN = ["Common things are common.", "Treat the patient, not the number.", "A good history beats a hundred tests.",
    "Trends tell you more than single values.", "If in doubt, examine again.", "Check the dose, then check it again.",
    "Listen to the patient. They are telling you the diagnosis.", "Kindness is a clinical skill.", "Rest is part of good care too."];
  var PURE = {
    // progress of the trace for a pull of px, against the trigger (72 px in pull-refresh.js)
    prog: function (px, trigger) { return Math.max(0, Math.min(1, px / (trigger || 72))); },
    pick: function (list, n) { return list.length ? list[((n % list.length) + list.length) % list.length] : ""; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = PURE;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  function off() { try { return localStorage.getItem("smd_home_pull") === "0"; } catch (e) { return false; } }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }

  // One trace: baseline, P wave, QRS, T wave, baseline; pathLength 100 so the draw is a plain dash offset.
  var ECG = "M0 32 H118 q7 -7 14 0 H150 l5 5 7 -27 7 35 5 -13 H196 q11 -12 22 0 H262 q7 -7 14 0 H294 l5 5 7 -27 7 35 5 -13 H340 q11 -12 22 0 H400";
  // Doubled id: appearance.css sets every child of Home to position:relative (html[data-appearance] #homeV2.rnav > *),
  // which would put the band in Home's column and push the scroller down by its own height.
  var CSS = "html #homeV2#homeV2 > .hv-pull{position:absolute;left:0;right:0;top:0;height:0;z-index:0;overflow:hidden;pointer-events:none;" +
      "background:var(--hrf-h0,#0c3b3e);display:flex;flex-direction:column;align-items:center;justify-content:flex-end;contain:strict}" +
    "#homeV2 > .hv-pull .hvp-in{display:flex;flex-direction:column;align-items:center;gap:6px;width:100%;padding:0 0 12px;opacity:0;transition:opacity .12s linear}" +
    "#homeV2 > .hv-pull svg{display:block;width:min(100%,420px);height:40px;overflow:visible}" +
    "#homeV2 > .hv-pull path.tr{fill:none;stroke:var(--hrf-mint,#6ee7c8);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:100;stroke-dashoffset:100;" +
      "filter:drop-shadow(0 0 4px color-mix(in srgb,var(--hrf-mint,#6ee7c8) 55%,transparent))}" +
    "#homeV2 > .hv-pull path.bg{fill:none;stroke:rgba(255,255,255,.08);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}" +
    "#homeV2 > .hv-pull .hvp-t{font:500 13px/1.3 var(--rds-font,-apple-system,system-ui,sans-serif);letter-spacing:.01em;color:rgba(255,255,255,.72);text-align:center;padding:0 24px;max-width:340px;transition:opacity .15s ease}" +
    "#homeV2 > .hv-pull.armed path.tr{stroke-width:2.6}" +
    "#homeV2 > .hv-pull.armed .hvp-t,#homeV2 > .hv-pull.busy .hvp-t{color:#fff}" +
    "#homeV2 > .hv-pull.busy .hvp-t{font-size:15px;font-weight:600;letter-spacing:0;animation:hvp-in .35s cubic-bezier(.23,1,.32,1) both}" +
    "#homeV2 > .hv-pull.busy path.tr{animation:hvp-sweep 1.1s cubic-bezier(.4,0,.2,1) 2}" +
    "#homeV2 > .hv-pull.native .hvp-t{opacity:0}" +
    "@keyframes hvp-sweep{0%{stroke-dashoffset:100;opacity:1}70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:.35}}" +
    "@keyframes hvp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion: reduce){#homeV2 > .hv-pull.busy path.tr{animation:none;stroke-dashoffset:0}#homeV2 > .hv-pull.busy .hvp-t{animation:none}}";

  var S = { home: null, sc: null, band: null, path: null, txt: null, n: Math.floor(Math.random() * 1000), phase: "home", h: 0, mo: null };
  function css() { if (document.getElementById("hvp-css")) return; var st = document.createElement("style"); st.id = "hvp-css"; st.textContent = CSS; document.head.appendChild(st); }
  function band() {
    if (S.band && S.band.isConnected && S.band.parentNode === S.home) return S.band;
    css();
    var b = document.createElement("div"); b.className = "hv-pull"; b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<div class="hvp-in"><svg viewBox="0 0 400 48" preserveAspectRatio="xMidYMid meet"><path class="bg" d="' + ECG + '"/><path class="tr" pathLength="100" d="' + ECG + '"/></svg><p class="hvp-t">Pull for a pearl</p></div>';
    S.home.insertBefore(b, S.home.firstChild);
    S.band = b; S.path = b.querySelector("path.tr"); S.txt = b.querySelector(".hvp-t");
    return b;
  }
  function pearls() { var P = window.MaiKCompanion && window.MaiKCompanion.PEARLS; return P && P.length ? P : OWN; }

  /* setH(px, phase, native): the band's height is the gap the pull opened; the trace draws with the pull. */
  function setH(px, phase, native) {
    if (!S.home) return;
    var b = band(), h = Math.max(0, Math.round(px));
    S.h = h; S.phase = phase;
    // The band fills from the top of Home down to wherever the scroller's top is now (the drag translates the scroller;
    // a native bounce moves its content), so no strip of page shows between the band and the hero on any layout.
    var gap = 0;
    if (h > 0) try {
      var top = S.sc.getBoundingClientRect().top - S.home.getBoundingClientRect().top;
      gap = native ? top + h : top;
    } catch (e) { gap = h; }
    b.style.height = Math.max(h, Math.round(gap)) + "px";
    b.classList.toggle("native", !!native);
    b.classList.toggle("armed", phase === "armed");
    var wasBusy = b.classList.contains("busy");
    b.classList.toggle("busy", phase === "busy");
    // After the pearl the band springs shut with the pearl still in it (no flash of the prompt on the way down).
    if (wasBusy && phase !== "busy") S.closing = true;
    if (h === 0) S.closing = false;
    if (phase === "busy") S.path.style.strokeDashoffset = "";
    else if (S.closing) S.path.style.strokeDashoffset = "0";
    else {
      S.txt.textContent = phase === "armed" ? "Let go" : "Pull for a pearl";
      S.path.style.strokeDashoffset = String(100 - 100 * PURE.prog(h, 72));
    }
    b.firstChild.style.opacity = String(Math.min(1, h / 44));
    document.body.classList.toggle("hv-pulling", h > 0);
  }

  // The release: lub-dub, a pearl, the band held open for a moment (pull-refresh.js waits for this promise).
  function beat() {
    S.n++;
    if (S.txt) S.txt.textContent = PURE.pick(pearls(), S.n);
    try { if (window.SMD_HAPTICS) { SMD_HAPTICS.light(); setTimeout(function () { try { SMD_HAPTICS.light(); } catch (e) {} }, 170); } } catch (e) {}
    return new Promise(function (res) { setTimeout(res, reduced() ? 2000 : 2400); });
  }

  // A native bounce past the top (iOS fling): the same teal and trace, no words, drawn from the negative scrollTop.
  function onScroll() {
    if (!S.sc || (window.SMD_pullRefresh && SMD_pullRefresh.active && SMD_pullRefresh.active())) return;
    var y = S.sc.scrollTop;
    if (y < 0) setH(-y, "pull", true);
    else if (S.h && S.phase !== "busy") setH(0, "home", true);
  }

  function attach() {
    if (off()) return;
    var home = document.getElementById("homeV2"), sc = home && home.querySelector(":scope > .v3-main");
    if (!home || !sc || !window.SMD_pullRefresh) return;
    if (S.sc === sc && S.home === home) return;
    if (S.sc) S.sc.removeEventListener("scroll", onScroll);
    S.home = home; S.sc = sc;
    SMD_pullRefresh.register(sc, beat, { hold: 104, own: true, draw: function (px, phase) { setH(px, phase, false); } });
    sc.addEventListener("scroll", onScroll, { passive: true });
    band();
    // Home can rebuild its scroller: follow it.
    if (S.mo) S.mo.disconnect();
    try { S.mo = new MutationObserver(function () { if (!S.sc || !S.sc.isConnected || S.sc.parentNode !== S.home) attach(); }); S.mo.observe(home, { childList: true }); } catch (e) {}
  }
  function boot() {
    attach();
    if (!S.sc) { var tries = 0, t = setInterval(function () { attach(); if (S.sc || ++tries > 60) clearInterval(t); }, 500); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.SMD_HOME_PULL = { open: function () { return S.h > 0; }, attach: attach, _s: function () { return S; }, _draw: setH, _beat: beat, _pure: PURE };
})();
