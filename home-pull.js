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

  /* The ECG (owner 2026-11-20: "use this ecg css and make it blend", a heart-rate loader): one line whose middle beat
     traces a heart, and a heart that pops and beats on top of it. pathLength 1, so the draw is a dash offset of 1 to 0.
     Recoloured to the hero's mint with a soft pink heart; drawn by the pull, played once on release. */
  var LINE = "M5.32 78.13c.96-.01 5-8.5 5.54-8.54.58-.05 6.1 8.51 7.1 8.51 3.66 0 9.29.06 10.71.05 2.53-.01 4.82-72.88 4.82-72.88l4.76 97.28 3.97-24.45 20.45-.22C64 77.86 77.1 63.66 78.36 63.8c1.31.15 6.68 14.08 7.94 14.07 2.3-.03 33.32.04 35.76.02.96 0 5-8.5 5.53-8.53.59-.05 6.1 8.51 7.1 8.5 3.66 0 9.3.07 10.72.06 2.53-.02 4.81-72.89 4.81-72.89l4.77 97.28 3.97-24.44s83.34-3.33 74.69 7.67c-8.65 11-45.3-42.94-31.65-53.58 25.6-19.96 49.96 36.94 40.26 36.5-12.2-.53 1.8-62.32 23.41-51.7 32.24 15.86-17.56 84.92-26.4 81.77-5.73-2.05-.68-21.68 31.4-26.58 26.65-6.42 29.5 2.35 52.62 7.11 2.53-.02 4.82-72.89 4.82-72.89l4.76 97.28 3.97-24.44 20.45-.22c1.31-.02 14.41-14.22 15.68-14.07 1.32.15 6.7 14.08 7.95 14.07 2.29-.03 33.32.04 35.76.02.95 0 5-8.5 5.53-8.54.58-.04 6.1 8.52 7.1 8.52 3.66 0 9.3.06 10.72.05 2.53-.02 4.81-72.89 4.81-72.89l4.77 97.28 3.97-24.44 20.45-.23c1.31-.01 14.4-14.22 15.68-14.07 1.32.16 6.69 14.09 7.94 14.07";
  var HEART = "M213.35 29.43c19.41-15.19 33.68 10.86 37.73 18.82-.28-13.61 11.64-40.98 25.94-34.01 32.3 15.74-15.88 83.8-26.4 81.76-13.24-9-51.35-53.3-37.27-66.57Z";
  // Doubled id: appearance.css sets every child of Home to position:relative (html[data-appearance] #homeV2.rnav > *),
  // which would put the band in Home's column and push the scroller down by its own height.
  var CSS = "html #homeV2#homeV2 > .hv-pull{position:absolute;left:0;right:0;top:0;height:0;z-index:0;overflow:hidden;pointer-events:none;" +
      "background:var(--hvp-bg,var(--hrf-h0,#0c3b3e));display:flex;flex-direction:column;align-items:center;justify-content:flex-end;contain:strict}" +
    // a whisper of light from the line, so the band reads as one lit surface with the hero rather than a flat slab
    "#homeV2 > .hv-pull::before{content:'';position:absolute;inset:0;background:radial-gradient(60% 70% at 50% 72%,color-mix(in srgb,var(--hrf-mint,#6ee7c8) 10%,transparent),transparent 70%);opacity:0;transition:opacity .3s ease;" +
      // the glow fades out before the band's bottom edge, so it never draws a line where the band meets the hero
      "-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent 92%);mask-image:linear-gradient(180deg,#000 55%,transparent 92%)}" +
    "#homeV2 > .hv-pull.armed::before,#homeV2 > .hv-pull.busy::before{opacity:1}" +
    "#homeV2 > .hv-pull .hvp-in{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:100%;padding:0 0 14px;opacity:0;transition:opacity .12s linear}" +
    "#homeV2 > .hv-pull svg{display:block;width:min(64%,250px);height:auto;aspect-ratio:503/109;overflow:visible}" +
    "#homeV2 > .hv-pull .ln{fill:none;stroke:var(--hrf-mint,#6ee7c8);stroke-width:2.2px;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;" +
      "filter:drop-shadow(0 0 3px color-mix(in srgb,var(--hrf-mint,#6ee7c8) 60%,transparent))}" +
    "#homeV2 > .hv-pull .ht{fill:#ff9eb0;stroke:#ff9eb0;stroke-width:1.5;transform-box:fill-box;transform-origin:50% 50%;transform:scale(0);opacity:0;" +
      "filter:drop-shadow(0 0 6px rgba(255,140,165,.55))}" +
    "#homeV2 > .hv-pull.armed .ht{animation:hvp-pop .5s cubic-bezier(.3,1.6,.5,1) forwards,hvp-beat 1s ease-in-out .5s infinite}" +
    "#homeV2 > .hv-pull .hvp-t{margin:0;font:500 13px/1.3 var(--rds-font,-apple-system,system-ui,sans-serif);letter-spacing:.01em;color:rgba(255,255,255,.72);text-align:center;padding:0 28px;max-width:340px;min-height:2.6em;display:flex;align-items:center;transition:opacity .15s ease}" +
    "#homeV2 > .hv-pull.armed .hvp-t,#homeV2 > .hv-pull.busy .hvp-t{color:#fff}" +
    "#homeV2 > .hv-pull.busy .hvp-t{font-size:15px;font-weight:600;letter-spacing:0;animation:hvp-in .35s cubic-bezier(.23,1,.32,1) both}" +
    // the release: the loader's own timing, once, in the 2.4 s the pearl is up (draw to 80%, the heart blinks 60-100%)
    "#homeV2 > .hv-pull.busy .ln{stroke-dashoffset:0;animation:hvp-dash 2.4s linear both}" +
    "#homeV2 > .hv-pull.busy .ht{animation:hvp-blink 2.4s linear both}" +
    "#homeV2 > .hv-pull.native .hvp-t{opacity:0}" +
    "@keyframes hvp-dash{0%{stroke-dashoffset:1}80%,100%{stroke-dashoffset:0}}" +
    "@keyframes hvp-blink{0%,60%{opacity:0;transform:scale(0)}70%{opacity:1;transform:scale(1.2)}75%{opacity:1;transform:scale(1)}80%{opacity:1;transform:scale(1.2)}85%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}" +
    "@keyframes hvp-pop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}" +
    "@keyframes hvp-beat{0%,100%{transform:scale(1)}15%{transform:scale(1.18)}30%{transform:scale(1)}45%{transform:scale(1.12)}60%{transform:scale(1)}}" +
    "@keyframes hvp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}" +
    "@media (prefers-reduced-motion: reduce){#homeV2 > .hv-pull.busy .ln,#homeV2 > .hv-pull.busy .ht,#homeV2 > .hv-pull.armed .ht,#homeV2 > .hv-pull.busy .hvp-t{animation:none}" +
      "#homeV2 > .hv-pull.busy .ln{stroke-dashoffset:0}#homeV2 > .hv-pull.armed .ht,#homeV2 > .hv-pull.busy .ht{opacity:1;transform:none}}";

  var S = { home: null, sc: null, band: null, path: null, txt: null, n: Math.floor(Math.random() * 1000), phase: "home", h: 0, mo: null };
  function css() { if (document.getElementById("hvp-css")) return; var st = document.createElement("style"); st.id = "hvp-css"; st.textContent = CSS; document.head.appendChild(st); }
  function band() {
    if (S.band && S.band.isConnected && S.band.parentNode === S.home) return S.band;
    css();
    var b = document.createElement("div"); b.className = "hv-pull"; b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<div class="hvp-in"><svg viewBox="0 0 502.98 108.61" preserveAspectRatio="xMidYMid meet"><path class="ht" d="' + HEART + '"/><path class="ln" pathLength="1" d="' + LINE + '"/></svg><p class="hvp-t">Pull for a pearl</p></div>';
    S.home.insertBefore(b, S.home.firstChild);
    S.band = b; S.path = b.querySelector(".ln"); S.txt = b.querySelector(".hvp-t");
    tone();
    return b;
  }
  /* The band's colour is the hero's own top edge: the artwork's first rows, averaged (it is opaque there and covers the
     full width on a phone), so band and hero meet without a seam. Fallback: the hero's gradient top (--hrf-h0). */
  function tone() {
    try {
      if (!S.band || !S.home) return;
      var img = S.home.querySelector(".hrf-art"), hero = S.home.querySelector(".hrf-hero");
      if (!img || !hero || !img.complete || !img.naturalWidth) { if (img && !img.complete) img.addEventListener("load", tone, { once: true }); return; }
      var ir = img.getBoundingClientRect(), hr = hero.getBoundingClientRect();
      if (Math.abs(ir.top - hr.top) > 2 || ir.width < hr.width * 0.9) { S.band.style.removeProperty("--hvp-bg"); return; }   // art not along the top edge (wide screens)
      var c = document.createElement("canvas"); c.width = 24; c.height = 2;
      var x = c.getContext("2d"); x.drawImage(img, 0, 0, img.naturalWidth, Math.max(2, img.naturalHeight * 0.006), 0, 0, 24, 2);
      var d = x.getImageData(0, 0, 24, 2).data, r = 0, g = 0, bl = 0, n = 0;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
      S.band.style.setProperty("--hvp-bg", "rgb(" + Math.round(r / n) + "," + Math.round(g / n) + "," + Math.round(bl / n) + ")");
    } catch (e) { /* a tainted or missing image: the variable fallback stays */ }
  }
  // The status bar's height, so the held band clears the Dynamic Island / notch.
  function safeTop() {
    try { var p = document.createElement("div"); p.style.cssText = "position:fixed;top:0;height:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden"; document.body.appendChild(p); var v = parseFloat(getComputedStyle(p).paddingTop) || 0; p.remove(); return v; } catch (e) { return 0; }
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
      S.path.style.strokeDashoffset = String(1 - PURE.prog(h, 72));
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
    // Held open tall enough for the line and a two-line pearl below the status bar.
    SMD_pullRefresh.register(sc, beat, { hold: Math.round(safeTop() + 112), own: true, draw: function (px, phase) { setH(px, phase, false); } });
    sc.addEventListener("scroll", onScroll, { passive: true });
    band();
    try { new MutationObserver(function () { setTimeout(tone, 60); }).observe(document.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
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
