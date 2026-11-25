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
    // the hero artwork's top edge, mirrored: at the join the pixels are the hero's own, and its waves carry on upward
    "#homeV2 > .hv-pull .hvp-art{position:absolute;left:0;right:0;bottom:0;height:88px;background-repeat:no-repeat;transform:scaleY(-1);" +
      // only a short strip at the join, fading into the band's flat colour above (a full mirror reflected the stethoscope)
      "-webkit-mask-image:linear-gradient(180deg,#000 0,rgba(0,0,0,.55) 45%,transparent 100%);mask-image:linear-gradient(180deg,#000 0,rgba(0,0,0,.55) 45%,transparent 100%)}" +
    "#homeV2 > .hv-pull::before{content:'';position:absolute;inset:0;background:radial-gradient(56% 64% at 50% 70%,rgba(245,196,98,.10),transparent 72%);opacity:0;transition:opacity .4s ease;" +
      // the glow fades out before the band's bottom edge, so it never draws a line where the band meets the hero
      "-webkit-mask-image:linear-gradient(180deg,#000 55%,transparent 92%);mask-image:linear-gradient(180deg,#000 55%,transparent 92%)}" +
    "#homeV2 > .hv-pull.armed::before,#homeV2 > .hv-pull.busy::before{opacity:1}" +
    "#homeV2 > .hv-pull .hvp-in{position:relative;display:flex;flex-direction:column-reverse;align-items:center;gap:8px;width:100%;padding:0 0 16px;opacity:0;transition:opacity .14s linear}" +
    "#homeV2 > .hv-pull svg{display:block;width:min(68%,264px);height:auto;aspect-ratio:503/109;overflow:visible}" +
    // a monitor trace: a fine line that fades in and out at its ends, a soft phosphor afterglow under it, a bright head
    "#homeV2 > .hv-pull .ln,#homeV2 > .hv-pull .gl{fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1}" +
    "#homeV2 > .hv-pull .ln{stroke:url(#hvpGr);stroke-width:1.75px}" +
    "#homeV2 > .hv-pull .gl{stroke:#f5c462;stroke-width:8px;opacity:.28;filter:url(#hvpSoft)}" +
    "#homeV2 > .hv-pull .dot{fill:#fff7e0;filter:url(#hvpHalo);opacity:0;transition:opacity .2s ease}" +
    // the heart: a soft gradient, no outline; pops past the line and beats lub-dub
    "#homeV2 > .hv-pull .ht{fill:url(#hvpHt);filter:url(#hvpHtGlow);transform-box:fill-box;transform-origin:50% 55%;transform:scale(0);opacity:0}" +
    "#homeV2 > .hv-pull.armed .ht{animation:hvp-pop .55s cubic-bezier(.2,1.4,.4,1) forwards,hvp-lubdub 1.15s ease-in-out .55s infinite}" +
    "#homeV2 > .hv-pull.busy .ht{opacity:0;transform:scale(0)}" +
    "#homeV2 > .hv-pull.busy .ht.beat{animation:hvp-pop .5s cubic-bezier(.2,1.4,.4,1) forwards,hvp-lubdub 1.15s ease-in-out .5s 2}" +
    "#homeV2 > .hv-pull .hvp-t{margin:0;font:500 12.5px/1.35 var(--rds-font,-apple-system,system-ui,sans-serif);letter-spacing:.012em;color:rgba(255,255,255,.62);text-align:center;padding:0 32px;max-width:320px;min-height:2.7em;display:flex;align-items:center;justify-content:center;text-wrap:balance;transition:color .2s ease}" +
    "#homeV2 > .hv-pull.armed .hvp-t{color:rgba(255,255,255,.92)}" +
    "#homeV2 > .hv-pull.busy .hvp-t{font-size:16px;font-weight:600;letter-spacing:-.012em;line-height:1.3;color:#fff;animation:hvp-in .45s cubic-bezier(.23,1,.32,1) .12s both}" +
    "#homeV2 > .hv-pull.native .hvp-t{opacity:0}" +
    "@keyframes hvp-pop{from{opacity:0;transform:scale(.2)}to{opacity:1;transform:scale(1)}}" +
    "@keyframes hvp-lubdub{0%,100%{transform:scale(1)}12%{transform:scale(1.14)}24%{transform:scale(.98)}36%{transform:scale(1.07)}50%{transform:scale(1)}}" +
    "@keyframes hvp-in{from{opacity:0;transform:translateY(5px);filter:blur(2px)}to{opacity:1;transform:none;filter:none}}" +
    "@media (prefers-reduced-motion: reduce){#homeV2 > .hv-pull .ht,#homeV2 > .hv-pull.armed .ht,#homeV2 > .hv-pull.busy .ht.beat,#homeV2 > .hv-pull.busy .hvp-t{animation:none}" +
      "#homeV2 > .hv-pull.armed .ht,#homeV2 > .hv-pull.busy .ht.beat{opacity:1;transform:none}}";

  // The filled heart is recentred on the heart the line traces (its loop centres at x 238, the shape's own at 249) and drawn
  // at 80%, so it sits inside the strokes as a soft fill rather than a second, offset heart.
  // Order (column-reverse): the line sits next to the hero, so it is the first thing a pull reveals; the words come above.
  // The trace's defs: an end-faded stroke, the afterglow blur, the head's halo, the heart's gradient.
  var DEFS = '<defs>' +
    '<linearGradient id="hvpGr" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="503" y2="0"><stop offset="0" stop-color="#e9b24f" stop-opacity="0"/><stop offset=".14" stop-color="#e9b24f"/><stop offset=".5" stop-color="#ffe6a6"/><stop offset=".86" stop-color="#e9b24f"/><stop offset="1" stop-color="#e9b24f" stop-opacity="0"/></linearGradient>' +
    '<filter id="hvpSoft" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="3.2"/></filter>' +
    '<filter id="hvpHalo" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '<radialGradient id="hvpHt" cx="36%" cy="30%" r="85%"><stop offset="0" stop-color="#d4224a"/><stop offset=".5" stop-color="#8e0c2c"/><stop offset="1" stop-color="#4c0315"/></radialGradient>' +
    '<filter id="hvpHtGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/><feFlood flood-color="#ff2b55" flood-opacity=".85"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
    '</defs>';

  var S = { home: null, sc: null, band: null, path: null, txt: null, n: Math.floor(Math.random() * 1000), phase: "home", h: 0, mo: null };
  function css() { if (document.getElementById("hvp-css")) return; var st = document.createElement("style"); st.id = "hvp-css"; st.textContent = CSS; document.head.appendChild(st); }
  function band() {
    if (S.band && S.band.isConnected && S.band.parentNode === S.home) return S.band;
    css();
    var b = document.createElement("div"); b.className = "hv-pull"; b.setAttribute("aria-hidden", "true");
    b.innerHTML = '<div class="hvp-art"></div><div class="hvp-in"><svg viewBox="0 0 502.98 108.61" preserveAspectRatio="xMidYMid meet">' + DEFS +
      '<path class="gl" pathLength="1" d="' + LINE + '"/><g transform="translate(238 56) scale(.8) translate(-249.1 -54.6)"><path class="ht" d="' + HEART + '"/></g><path class="ln" pathLength="1" d="' + LINE + '"/><circle class="dot" r="5.5" cx="5" cy="78"/></svg><p class="hvp-t">Pull for a pearl</p></div>';
    S.home.insertBefore(b, S.home.firstChild);
    S.band = b; S.inner = b.querySelector(".hvp-in"); S.path = b.querySelector(".ln"); S.glow = b.querySelector(".gl"); S.dot = b.querySelector(".dot"); S.heart = b.querySelector(".ht"); S.txt = b.querySelector(".hvp-t");
    try { S.len = S.path.getTotalLength(); } catch (e) { S.len = 0; }
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
      if (Math.abs(ir.top - hr.top) > 2 || ir.width < hr.width * 0.9) { S.band.style.removeProperty("--hvp-bg"); var a0 = S.band.querySelector(".hvp-art"); if (a0) a0.style.backgroundImage = ""; return; }   // art not along the top edge (wide screens)
      // The mirror: the same image at the same width and left edge as the hero's, flipped, so its top row meets the hero's.
      var art = S.band.querySelector(".hvp-art"), hm = S.home.getBoundingClientRect();
      if (art) {
        art.style.backgroundImage = "url(\"" + (img.currentSrc || img.src) + "\")";
        art.style.backgroundSize = Math.round(ir.width) + "px auto";
        art.style.backgroundPosition = Math.round(ir.left - hm.left) + "px top";
      }
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
  /* trace(p, head): the line drawn to p (0..1), its afterglow with it, and the bright head at the tip while drawing. */
  function trace(p, head) {
    p = Math.max(0, Math.min(1, p));
    var off = String(1 - p);
    S.path.style.strokeDashoffset = off; S.glow.style.strokeDashoffset = off;
    if (!S.len || !head || p <= 0.002 || p >= 0.998) { S.dot.style.opacity = "0"; return; }
    try { var pt = S.path.getPointAtLength(p * S.len); S.dot.setAttribute("cx", pt.x.toFixed(1)); S.dot.setAttribute("cy", pt.y.toFixed(1)); S.dot.style.opacity = "1"; } catch (e) {}
  }
  function pearls() { var P = window.MaiKCompanion && window.MaiKCompanion.PEARLS; return P && P.length ? P : OWN; }

  /* setH(px, phase, native): the band's height is the gap the pull opened; the trace draws with the pull. */
  function setH(px, phase, native) {
    if (!S.home) return;
    // raw: the exact (fractional) gap; a bounce under half a pixel must still be covered, so sizing never rounds to 0.
    var b = band(), raw = Math.max(0, +px || 0), h = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
    S.h = h; S.phase = phase;
    // The band fills from the top of Home down to wherever the scroller's top is now (the drag translates the scroller;
    // a native bounce moves its content), so no strip of page shows between the band and the hero on any layout.
    var gap = 0;
    if (h > 0) try {
      var top = S.sc.getBoundingClientRect().top - S.home.getBoundingClientRect().top;
      gap = native ? top + raw : top;
    } catch (e) { gap = raw; }
    // Ceil plus 2 px: the band tucks under the hero (which covers it), so a fractional hero top can never leave a hairline
    // of the pale page between them (owner recording 2026-11-21: a light line flashed in at the start of a pull).
    b.style.height = (raw > 0 ? Math.ceil(Math.max(raw, gap)) + 2 : 0) + "px";
    b.classList.toggle("native", !!native);
    b.classList.toggle("armed", phase === "armed");
    var wasBusy = b.classList.contains("busy");
    b.classList.toggle("busy", phase === "busy");
    // After the pearl the band springs shut with the pearl still in it (no flash of the prompt on the way down).
    if (wasBusy && phase !== "busy") S.closing = true;
    if (h === 0) { S.closing = false; S.sweep = (S.sweep || 0) + 1; if (S.heart) S.heart.classList.remove("beat"); }
    if (phase === "busy") { /* the sweep (beat) owns the line */ }
    else if (S.closing) trace(1, false);
    else {
      S.txt.textContent = phase === "armed" ? "Let go" : "Pull for a pearl";
      trace(PURE.prog(h, 72), !native && phase !== "armed");
    }
    S.inner.style.opacity = String(Math.min(1, h / 44));
    document.body.classList.toggle("hv-pulling", h > 0);
  }

  // The release: lub-dub, a pearl, the band held open for a moment (pull-refresh.js waits for this promise).
  /* The release: the pearl appears, the monitor sweeps the trace once (linear, like a real sweep, its head leading), and
     as the sweep passes the heart in the middle the heart pops and beats lub-dub with a matching double haptic. */
  function haptic() { try { if (window.SMD_HAPTICS) SMD_HAPTICS.light(); } catch (e) {} }
  function beat() {
    S.n++;
    if (S.txt) S.txt.textContent = PURE.pick(pearls(), S.n);
    var b = S.band; if (S.heart) S.heart.classList.remove("beat");
    haptic();
    if (reduced() || !b) { trace(1, false); if (S.heart) S.heart.classList.add("beat"); }
    else {
      var t0 = performance.now(), dur = 1500, beaten = false, me = S.sweep = (S.sweep || 0) + 1;
      var step = function () {
        if (S.sweep !== me) return;                                 // closed, or a newer pull took over: stop
        var p = Math.min(1, (performance.now() - t0) / dur);
        trace(p, true);
        if (!beaten && p >= 0.5) { beaten = true; S.heart.classList.add("beat"); haptic(); setTimeout(haptic, 150); }
        if (p < 1) requestAnimationFrame(step); else trace(1, false);
      };
      trace(0, false); requestAnimationFrame(step);
    }
    return new Promise(function (res) { setTimeout(res, reduced() ? 2000 : 2600); });
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
    SMD_pullRefresh.register(sc, beat, { hold: Math.round(safeTop() + 128), own: true, draw: function (px, phase) { setH(px, phase, false); } });
    sc.addEventListener("scroll", onScroll, { passive: true });
    band();
    try { new MutationObserver(function () { setTimeout(tone, 60); }).observe(document.body, { attributes: true, attributeFilter: ["class"] }); } catch (e) {}
    window.addEventListener("resize", function () { clearTimeout(S.rt); S.rt = setTimeout(tone, 150); });
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
