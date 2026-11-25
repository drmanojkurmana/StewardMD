/* PrepNucleus startup logo reveal (owner 2026-11-25) -> window.PREP_STARTUP. ES5.
 *
 * Plays the orientation-matched silent startup logo reveal clip when PrepNucleus opens from Home or via a plain
 * PREP.open():
 * - Portrait (innerWidth <= innerHeight): /prep/startup/prep-startup-v.mp4 (720x1280, 9:16)
 * - Landscape (innerWidth > innerHeight): /prep/startup/prep-startup-h.mp4 (1280x720, 16:9)
 *
 * Mixing & screen fit:
 * - A darkened blurred start still fills the viewport from frame 0, then a live 32x32 edge-sampling canvas mirrors
 *   the active video frame's colors across the screen so dark cosmic, deep teal, and warm cream #efede0 backgrounds
 *   transition seamlessly with zero banding or hard seams.
 * - The stage is sized to the clip's exact 9:16 / 16:9 aspect ratio so the logo and "PrepNucleus / AI-POWERED
 *   MEDICAL PREP" subtitle are never clipped on tall phones or 4:3 iPads, and only the padded axis feathers softly
 *   into the ambient backdrop.
 * - Adapts live on orientation change while playing, preserving playback position.
 * - Deep links (opts with id, lesson, subject, module, query, mode, play, social) skip the startup reveal and jump
 *   straight to the target. Reduced motion shows the settled logo reveal still briefly without video.
 * - Kill switches: localStorage "smd_prep_startup" = "0", ?prepstartup=0, or window.SMD_PREP_STARTUP = false. */
(function (G) {
  "use strict";
  if (!G || !G.document || G.PREP_STARTUP) return;
  var D = G.document;

  var CLIPS = {
    v: {
      src: "/prep/startup/prep-startup-v.mp4",
      start: "/prep/startup/prep-startup-v-start.webp",
      end: "/prep/startup/prep-startup-v-end.webp",
      ratio: 9 / 16
    },
    h: {
      src: "/prep/startup/prep-startup-h.mp4",
      start: "/prep/startup/prep-startup-h-start.webp",
      end: "/prep/startup/prep-startup-h-end.webp",
      ratio: 16 / 9
    }
  };
  var V = "2";
  var REVEAL_AT = 8.35;

  function qParam() {
    try {
      var m = /[?&]prepstartup=([^&]+)/.exec(G.location && G.location.search ? G.location.search : "");
      return m ? m[1] : null;
    } catch (e) { return null; }
  }
  function enabled() {
    if (G.SMD_PREP_STARTUP === false) return false;
    var q = qParam();
    if (q != null) return q === "1" || q === "on" || q === "true";
    // UI test harnesses set SMD_PREP_ONBOARD = false without setting SMD_PREP_STARTUP = true.
    if (G.SMD_PREP_STARTUP !== true && G.SMD_PREP_ONBOARD === false) return false;
    try { if (G.localStorage && G.localStorage.getItem("smd_prep_startup") === "0") return false; } catch (e) {}
    return true;
  }
  function isDeepLink(opts) {
    if (!opts || typeof opts !== "object") return false;
    return !!(opts.id || opts.lesson || opts.subject || opts.module || opts.query || opts.mode || opts.play || opts.social);
  }
  function willPlay(opts) {
    return enabled() && !isDeepLink(opts);
  }
  function reduced() {
    try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function isLandscape() {
    return (G.innerWidth || 0) > (G.innerHeight || 0);
  }
  function orientKey() {
    return isLandscape() ? "h" : "v";
  }

  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var s = D.createElement("style");
    s.id = "smdPrepStartupCss";
    s.textContent = [
      "#smdPrepStartup{position:fixed;inset:0;z-index:100002;background:#071318;display:flex;align-items:center;justify-content:center;overflow:hidden;opacity:0;transition:opacity .28s ease,background-color .85s ease;-webkit-user-select:none;user-select:none}",
      "#smdPrepStartup.psv-on{opacity:1}",
      "#smdPrepStartup.psv-reveal{background:#efede0}",
      "#smdPrepStartup.psv-out{opacity:0;pointer-events:none;transition:opacity .38s ease,background-color .85s ease}",
      "#smdPrepStartup .psv-amb{position:absolute;inset:-14%;background:#071318 center/cover no-repeat;filter:blur(52px) saturate(1.15) brightness(.44);transform:scale(1.08);transition:opacity .85s ease;pointer-events:none}",
      "#smdPrepStartup .psv-amb.b{background:#efede0;filter:none;opacity:0}",
      "#smdPrepStartup.psv-reveal .psv-amb.b{opacity:1}",
      "#smdPrepStartup.psv-reveal .psv-amb.a{opacity:0}",
      "#smdPrepStartup .psv-live-amb{position:absolute;inset:-12%;width:124%;height:124%;filter:blur(36px) saturate(1.15) brightness(.88);opacity:0;transition:opacity .45s ease;pointer-events:none}",
      "#smdPrepStartup .psv-live-amb.on{opacity:1}",
      "#smdPrepStartup.psv-reveal .psv-live-amb{opacity:0}",
      "#smdPrepStartup .psv-glow{position:absolute;left:50%;top:50%;width:110vmin;height:110vmin;transform:translate(-50%,-50%) scale(.9);border-radius:50%;background:radial-gradient(closest-side,rgba(66,205,181,.18),rgba(15,52,96,.10) 56%,transparent 76%);opacity:.75;transition:opacity .8s ease,transform 1.1s cubic-bezier(.2,.8,.2,1);pointer-events:none;mix-blend-mode:screen}",
      "#smdPrepStartup.psv-reveal .psv-glow{opacity:0;transform:translate(-50%,-50%) scale(1.12)}",
      "#smdPrepStartup .psv-stage{position:relative;flex:0 0 auto;display:flex;align-items:center;justify-content:center;overflow:hidden;transform:scale(.985);filter:blur(8px);transition:transform .72s cubic-bezier(.2,.8,.2,1),filter .55s ease}",
      "#smdPrepStartup.psv-on .psv-stage{transform:none;filter:none}",
      "#smdPrepStartup.psv-out .psv-stage{transform:scale(1.02);filter:blur(6px);transition:transform .38s ease,filter .38s ease}",
      "#smdPrepStartup.psv-pad-y .psv-stage{-webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.38) 5%,rgba(0,0,0,.85) 10%,#000 16%,#000 84%,rgba(0,0,0,.85) 90%,rgba(0,0,0,.38) 95%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.38) 5%,rgba(0,0,0,.85) 10%,#000 16%,#000 84%,rgba(0,0,0,.85) 90%,rgba(0,0,0,.38) 95%,transparent 100%)}",
      "#smdPrepStartup.psv-pad-x .psv-stage{-webkit-mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.38) 4%,rgba(0,0,0,.85) 9%,#000 14%,#000 86%,rgba(0,0,0,.85) 91%,rgba(0,0,0,.38) 96%,transparent 100%);mask-image:linear-gradient(90deg,transparent 0,rgba(0,0,0,.38) 4%,rgba(0,0,0,.85) 9%,#000 14%,#000 86%,rgba(0,0,0,.85) 91%,rgba(0,0,0,.38) 96%,transparent 100%)}",
      "#smdPrepStartup.psv-pad-xy .psv-stage{-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%),linear-gradient(90deg,transparent 0,#000 12%,#000 88%,transparent 100%);-webkit-mask-composite:source-in;mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%),linear-gradient(90deg,transparent 0,#000 12%,#000 88%,transparent 100%);mask-composite:intersect}",
      "#smdPrepStartup video,#smdPrepStartup .psv-still{display:block;width:100%;height:100%;object-fit:cover;background:transparent}",
      "#smdPrepStartup .psv-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 100% at 50% 50%,transparent 62%,rgba(4,14,17,.36) 100%);transition:opacity .8s ease}",
      "#smdPrepStartup.psv-reveal .psv-vig{opacity:0}",
      "@media (prefers-reduced-motion:reduce){#smdPrepStartup,#smdPrepStartup *{transition:none!important;filter:none!important;transform:none!important}}"
    ].join("\n");
    (D.head || D.documentElement).appendChild(s);
  }

  var active = null;

  function applyFit(el, key) {
    var clip = CLIPS[key] || CLIPS.v;
    var w = el.clientWidth || G.innerWidth || 390;
    var h = el.clientHeight || G.innerHeight || 844;
    var vr = w / h, cr = clip.ratio;
    var sw, sh;
    if (vr > cr) { sh = h; sw = Math.round(h * cr); }
    else { sw = w; sh = Math.round(w / cr); }
    var stage = el.querySelector(".psv-stage");
    if (stage) {
      stage.style.width = sw + "px";
      stage.style.height = sh + "px";
    }
    el.classList.remove("psv-v", "psv-h", "psv-pad-x", "psv-pad-y", "psv-pad-xy");
    el.classList.add("psv-" + key);
    if (vr > cr + 0.03) el.classList.add("psv-pad-x");
    else if (vr < cr - 0.03) el.classList.add("psv-pad-y");
  }

  function play(o) {
    o = o || {};
    if (active) return true;
    if (!D.body || !enabled() || isDeepLink(o.opts)) return false;
    injectCSS();

    var key = orientKey();
    var clip = CLIPS[key];
    var still = reduced();
    var el = D.createElement("div");
    el.id = "smdPrepStartup";
    el.setAttribute("data-own-motion", "");
    el.setAttribute("data-no-motion", "");
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "PrepNucleus");

    el.innerHTML =
      '<div class="psv-amb a" style="background-image:url(' + clip.start + "?v=" + V + ')"></div>' +
      '<div class="psv-amb b"></div>' +
      (still ? "" : '<canvas class="psv-live-amb" width="32" height="32" aria-hidden="true"></canvas>') +
      '<div class="psv-glow" aria-hidden="true"></div>' +
      '<div class="psv-stage">' +
        (still
          ? '<img class="psv-still" alt="PrepNucleus" src="' + clip.end + "?v=" + V + '">'
          : '<video muted playsinline webkit-playsinline disablepictureinpicture preload="auto" poster="' + clip.start + "?v=" + V + '" src="' + clip.src + "?v=" + V + '"></video>') +
      "</div>" +
      '<div class="psv-vig" aria-hidden="true"></div>';

    D.body.appendChild(el);
    applyFit(el, key);
    if (still) el.classList.add("psv-reveal");

    var rec = active = {
      el: el,
      key: key,
      done: false,
      pending: !!o.pending,
      wantClose: false,
      holdT: 0,
      revealT: 0,
      endT: 0,
      ambTimer: 0,
      ro: null,
      onResize: null,
      onKey: null,
      finish: null
    };

    var raf = G.requestAnimationFrame || function (fn) { return G.setTimeout(fn, 16); };
    raf(function () { if (!rec.done) el.classList.add("psv-on"); });

    function reveal() {
      if (rec.done || el.classList.contains("psv-reveal")) return;
      el.classList.add("psv-reveal");
    }

    function teardown(immediate) {
      if (rec.done) return;
      rec.done = true;
      G.clearTimeout(rec.holdT);
      G.clearTimeout(rec.revealT);
      G.clearTimeout(rec.endT);
      G.clearInterval(rec.ambTimer);
      if (rec.ro) { try { rec.ro.disconnect(); } catch (e) {} }
      if (rec.onResize) {
        G.removeEventListener("resize", rec.onResize);
        G.removeEventListener("orientationchange", rec.onResize);
      }
      if (rec.onKey) D.removeEventListener("keydown", rec.onKey, true);
      var v = el.querySelector("video");
      if (v) { try { v.pause(); } catch (e) {} }
      function rm() {
        try { if (v) { v.removeAttribute("src"); v.load(); } } catch (e) {}
        if (el.parentNode) el.parentNode.removeChild(el);
        if (active === rec) active = null;
      }
      if (immediate) return rm();
      el.classList.add("psv-out");
      el.classList.remove("psv-on");
      G.setTimeout(rm, 380);
    }

    function requestFinish(handoffLoader) {
      if (rec.done) return;
      rec.wantClose = true;
      if (rec.pending) {
        if (handoffLoader && o.pendingPromise && G.SMD_LOADER) {
          teardown(true);
          G.SMD_LOADER.during(o.pendingPromise);
        }
        return;
      }
      teardown(false);
    }
    rec.finish = requestFinish;

    rec.onKey = function (e) {
      if (e.key === "Escape") { e.preventDefault(); requestFinish(true); }
    };
    D.addEventListener("keydown", rec.onKey, true);

    if (still) {
      rec.endT = G.setTimeout(function () { requestFinish(false); }, 950);
      return true;
    }

    var v = el.querySelector("video");
    try { v.disablePictureInPicture = true; v.muted = true; } catch (e) {}

    rec.onResize = function () {
      if (rec.done) return;
      var nk = orientKey();
      if (nk !== rec.key) {
        rec.key = nk;
        var nc = CLIPS[nk];
        var ambA = el.querySelector(".psv-amb.a");
        if (ambA) ambA.style.backgroundImage = "url(" + nc.start + "?v=" + V + ")";
        var ct = 0;
        try { ct = v.currentTime || 0; } catch (e) {}
        v.poster = nc.start + "?v=" + V;
        v.src = nc.src + "?v=" + V;
        var restore = function () {
          v.removeEventListener("loadedmetadata", restore);
          try { if (ct > 0.1 && ct < (v.duration || 10) - 0.2) v.currentTime = ct; } catch (e) {}
          v.muted = true;
          try { var np = v.play(); if (np && np.catch) np.catch(function () {}); } catch (e) {}
        };
        v.addEventListener("loadedmetadata", restore);
        try { v.load(); } catch (e) {}
      }
      applyFit(el, rec.key);
    };
    G.addEventListener("resize", rec.onResize);
    G.addEventListener("orientationchange", rec.onResize);
    try {
      if (G.ResizeObserver) {
        rec.ro = new G.ResizeObserver(function () { if (!rec.done && rec.onResize) rec.onResize(); });
        rec.ro.observe(el);
      }
    } catch (e) {}

    // Mirror only the outer 8% perimeter strips of the live video frame into the blurred ambient canvas,
    // so bright center highlights or dark logo strokes never bleed into the screen margins.
    var ambCanvas = el.querySelector(".psv-live-amb");
    var ambCtx = null;
    try { ambCtx = ambCanvas && ambCanvas.getContext ? ambCanvas.getContext("2d") : null; } catch (e) { ambCtx = null; }
    function sampleAmb() {
      if (rec.done || !ambCtx || !v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
      try {
        var vw = v.videoWidth, vh = v.videoHeight;
        var ew = Math.max(4, Math.round(vw * 0.08)), eh = Math.max(4, Math.round(vh * 0.08));
        ambCtx.drawImage(v, 0, 0, vw, eh, 0, 0, 32, 16);
        ambCtx.drawImage(v, 0, vh - eh, vw, eh, 0, 16, 32, 16);
        ambCtx.drawImage(v, 0, 0, ew, vh, 0, 0, 8, 32);
        ambCtx.drawImage(v, vw - ew, 0, ew, vh, 24, 0, 8, 32);
        if (!ambCanvas.classList.contains("on")) ambCanvas.classList.add("on");
      } catch (e) {}
    }
    if (ambCtx) rec.ambTimer = G.setInterval(sampleAmb, 120);

    function onError() {
      teardown(true);
    }
    v.addEventListener("error", onError);
    v.addEventListener("loadeddata", sampleAmb);
    v.addEventListener("seeked", sampleAmb);
    v.addEventListener("timeupdate", function () {
      if (v.currentTime >= REVEAL_AT) reveal();
    });
    v.addEventListener("ended", function () {
      reveal();
      rec.holdT = G.setTimeout(function () { requestFinish(false); }, 360);
    });

    try {
      var p = v.play();
      if (p && p.catch) p.catch(function (err) { if (err && err.name === "AbortError") return; onError(); });
    } catch (e) { onError(); }

    rec.revealT = G.setTimeout(reveal, 8900);
    rec.endT = G.setTimeout(function () { requestFinish(false); }, 12500);
    return true;
  }

  function ready() {
    if (!active || active.done) return;
    active.pending = false;
    if (active.wantClose && active.finish) active.finish(false);
  }

  function skip() {
    if (!active || active.done) return false;
    if (active.finish) active.finish(true);
    return true;
  }

  function abort() {
    if (!active || active.done) return;
    var el = active.el;
    active.done = true;
    G.clearTimeout(active.holdT);
    G.clearTimeout(active.revealT);
    G.clearTimeout(active.endT);
    G.clearInterval(active.ambTimer);
    if (active.ro) { try { active.ro.disconnect(); } catch (e) {} }
    if (active.onResize) {
      G.removeEventListener("resize", active.onResize);
      G.removeEventListener("orientationchange", active.onResize);
    }
    if (active.onKey) D.removeEventListener("keydown", active.onKey, true);
    var v = el.querySelector("video");
    if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch (e) {} }
    if (el.parentNode) el.parentNode.removeChild(el);
    active = null;
  }

  G.PREP_STARTUP = {
    play: play,
    ready: ready,
    skip: skip,
    abort: abort,
    willPlay: willPlay,
    enabled: enabled,
    orientKey: orientKey,
    clips: CLIPS,
    _active: function () { return !!(active && !active.done); }
  };
})(typeof window !== "undefined" ? window : this);
