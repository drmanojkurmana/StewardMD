/* PrepNucleus startup logo reveal (owner 2026-11-25, recut 2026-11-26) -> window.PREP_STARTUP. ES5.
 *
 * Plays the orientation-matched silent startup clip when PrepNucleus opens from Home or via a plain PREP.open():
 * - Portrait (innerWidth <= innerHeight): /prep/startup/prep-startup-v.mp4 (1512x2688 HEVC 60 fps, 7.8 s)
 * - Landscape (innerWidth > innerHeight): /prep/startup/prep-startup-h.mp4 (2688x1512 HEVC 60 fps, 6.35 s)
 *
 * Screen fit: the clip fills the whole screen (object-fit: cover), centred, on every iPhone and iPad shape. The logo and
 * wordmark sit in the middle third of both clips, so the crop on tall phones and 4:3 iPads only trims the starfield.
 * Both clips end on the settled logo; the overlay holds that frame until PrepNucleus has opened underneath it
 * (prep-loader.js opens the app during the clip), then fades straight into the ready home screen.
 * - Orientation change while playing swaps clip at the same fraction of the run.
 * - Deep links (opts with id, lesson, subject, module, query, mode, play, social) skip the reveal.
 *   Reduced motion shows the settled logo still briefly without video. A clip that cannot play closes at once.
 * - Kill switches: localStorage "smd_prep_startup" = "0", ?prepstartup=0, or window.SMD_PREP_STARTUP = false. */
(function (G) {
  "use strict";
  if (!G || !G.document || G.PREP_STARTUP) return;
  var D = G.document;

  var CLIPS = {
    v: { src: "/prep/startup/prep-startup-v.mp4", start: "/prep/startup/prep-startup-v-start.webp", end: "/prep/startup/prep-startup-v-end.webp", ratio: 9 / 16, dur: 7.8 },
    h: { src: "/prep/startup/prep-startup-h.mp4", start: "/prep/startup/prep-startup-h-start.webp", end: "/prep/startup/prep-startup-h-end.webp", ratio: 16 / 9, dur: 6.35 }
  };
  var V = "3";

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
  function willPlay(opts) { return enabled() && !isDeepLink(opts); }
  function reduced() {
    try { return !!(G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; }
  }
  function orientKey() { return (G.innerWidth || 0) > (G.innerHeight || 0) ? "h" : "v"; }
  function url(p) { return p + "?v=" + V; }

  var cssInjected = false;
  function injectCSS() {
    if (cssInjected) return;
    cssInjected = true;
    var s = D.createElement("style");
    s.id = "smdPrepStartupCss";
    s.textContent = [
      "#smdPrepStartup{position:fixed;inset:0;z-index:100002;background:#071318;overflow:hidden;opacity:0;transition:opacity .32s cubic-bezier(.2,.8,.2,1);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}",
      "#smdPrepStartup.psv-on{opacity:1}",
      "#smdPrepStartup.psv-out{opacity:0;pointer-events:none;transition:opacity .5s cubic-bezier(.4,0,.2,1)}",
      "#smdPrepStartup video,#smdPrepStartup .psv-still{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:cover;object-position:50% 50%;background:#071318 center/cover no-repeat;transform:scale(1.015);transition:transform .9s cubic-bezier(.2,.8,.2,1)}",
      "#smdPrepStartup.psv-on video,#smdPrepStartup.psv-on .psv-still{transform:none}",
      "#smdPrepStartup.psv-out video,#smdPrepStartup.psv-out .psv-still{transform:scale(1.04);transition:transform .5s cubic-bezier(.4,0,.2,1)}",
      "@media (prefers-reduced-motion:reduce){#smdPrepStartup,#smdPrepStartup *{transition:none!important;transform:none!important}}"
    ].join("\n");
    (D.head || D.documentElement).appendChild(s);
  }

  var active = null;

  function stopRec(rec) {
    rec.done = true;
    G.clearTimeout(rec.holdT);
    G.clearTimeout(rec.endT);
    if (rec.onResize) {
      G.removeEventListener("resize", rec.onResize);
      G.removeEventListener("orientationchange", rec.onResize);
    }
    if (rec.onKey) D.removeEventListener("keydown", rec.onKey, true);
    var v = rec.el.querySelector("video");
    if (v) { try { v.pause(); } catch (e) {} }
    return v;
  }
  function removeRec(rec, v) {
    try { if (v) { v.removeAttribute("src"); v.load(); } } catch (e) {}
    if (rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
    if (active === rec) active = null;
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
    el.innerHTML = still
      ? '<img class="psv-still" alt="PrepNucleus" src="' + url(clip.end) + '">'
      : '<video muted playsinline webkit-playsinline disablepictureinpicture disableremoteplayback preload="auto" aria-hidden="true" poster="' + url(clip.start) + '" style="background-image:url(' + url(clip.start) + ')" src="' + url(clip.src) + '"></video>';
    D.body.appendChild(el);

    var rec = active = { el: el, key: key, done: false, pending: !!o.pending, holdT: 0, endT: 0, onResize: null, onKey: null, finish: null };
    var raf = G.requestAnimationFrame || function (fn) { return G.setTimeout(fn, 16); };
    raf(function () { raf(function () { if (!rec.done) el.classList.add("psv-on"); }); });

    function teardown(immediate) {
      if (rec.done) return;
      var v = stopRec(rec);
      if (immediate) return removeRec(rec, v);
      el.classList.add("psv-out");
      G.setTimeout(function () { removeRec(rec, v); }, 520);
    }
    // Close once both the clip has finished and PrepNucleus is ready underneath; a loader takes over on a skip while loading.
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
    rec.onKey = function (e) { if (e.key === "Escape") { e.preventDefault(); requestFinish(true); } };
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
      if (nk === rec.key) return;
      var oc = CLIPS[rec.key], nc = CLIPS[nk], frac = 0;
      try { frac = (v.currentTime || 0) / (v.duration || oc.dur); } catch (e) {}
      rec.key = nk;
      v.poster = url(nc.start);
      v.style.backgroundImage = "url(" + url(nc.start) + ")";
      v.src = url(nc.src);
      var restore = function () {
        v.removeEventListener("loadedmetadata", restore);
        try { if (frac > 0.02) v.currentTime = Math.min(frac, 0.995) * (v.duration || nc.dur); } catch (e) {}
        v.muted = true;
        try { var np = v.play(); if (np && np.catch) np.catch(function () {}); } catch (e) {}
      };
      v.addEventListener("loadedmetadata", restore);
      try { v.load(); } catch (e) {}
    };
    G.addEventListener("resize", rec.onResize);
    G.addEventListener("orientationchange", rec.onResize);

    function onError() { teardown(true); }
    v.addEventListener("error", onError);
    // The last frame (settled logo) stays on screen after "ended" until PrepNucleus is ready.
    v.addEventListener("ended", function () {
      rec.holdT = G.setTimeout(function () { requestFinish(false); }, 280);
    });
    try {
      var p = v.play();
      if (p && p.catch) p.catch(function (err) { if (err && err.name === "AbortError") return; onError(); });
    } catch (e) { onError(); }

    // Safety net if "ended" never fires (stalled decode): longest clip plus slack.
    rec.endT = G.setTimeout(function () { requestFinish(false); }, 11000);
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
    var rec = active;
    removeRec(rec, stopRec(rec));
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
