/* StewardMD Connect Hospital onboarding and session UI.
 *
 * Doctor-facing flow: connections list -> hospital URL -> explicit consent ->
 * sign in (native in-app browser on phone, embedded iframe elsewhere) -> live
 * discovery progress -> capabilities result with reviewer approval, plus an
 * "already connected" reuse shortcut and a returning-doctor reconnect path.
 *
 * Buildless ES5 IIFE. Styles ship as an injected <style> block. No frameworks,
 * no dependencies. Coded against connect-agent/phone/CONTRACT.md (broker
 * routes) and local-plugins/capacitor-connect-browser/README.md (native
 * ConnectBrowser plugin). Those two files are the source of truth for wire
 * shapes; this file never guesses at either without a re-read.
 *
 * API SEAM: every network call goes through api(path, opts), which resolves
 * {s: <http status>, d: <decoded body>}. Production api() calls fetch() against
 * /api/connect/agent (the broker router owns those routes). Tests replace the
 * transport with window.SMD_CONNECT_AGENT.__setApi(fn); no backend needed.
 *
 * PHONE RUNNER: when window.Capacitor.Plugins.ConnectBrowser exists, sign in
 * and discovery run through that native plugin (see hasPlugin()/getPlugin()).
 * Discovery itself is driven by connect-agent/phone/index.mjs's
 * runPhoneDiscovery({plugin, api, session, deployment, startUrl, onProgress}),
 * loaded lazily via loadPhoneEngine() (an ES5-safe wrapper around import(),
 * per repo convention: `new Function('p','return import(p)')`). Tests stub the
 * engine with window.__SMD_PHONE_ENGINE_TEST__ so no real .mjs file is needed.
 *
 * WEB/DESKTOP FALLBACK: when the plugin is absent, sign in and discovery keep
 * using the pre-existing iframe viewer + server-driven (Camofox) job-state
 * polling, unchanged from before this rewrite.
 */
(function () {
  "use strict";

  var AGENT_BASE = "/api/connect/agent";
  var POLL_MS = 1500;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function enc(s) { return encodeURIComponent(String(s == null ? "" : s)); }

  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  function originOf(url) {
    try { return new URL(url).origin; } catch (e) { return null; }
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return String(url || ""); }
  }

  /* Transport seam. fn(path, opts) must return a Promise of {s, d}. */
  /* The caller's Firebase id token, exactly as connect-source.js sends it; the SERVER derives identity.
   * Without it every call was a 401 and the sheet only ever said "Could not load your connections". */
  function idToken() {
    try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; return (u && u.getIdToken) ? u.getIdToken() : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }
  var apiImpl = function (path, opts) {
    var method = (opts && opts.method) || "GET";
    var body = (opts && opts.body) ? opts.body : null;
    // The chosen hospital rides on every call as ?tenant= (the server reads it for GET and POST alike).
    var q = (S && S.tenant) ? (path.indexOf("?") >= 0 ? "&" : "?") + "tenant=" + encodeURIComponent(S.tenant) : "";
    return idToken().then(function (t) {
      var h = { "content-type": "application/json" };
      if (t) h.Authorization = "Bearer " + t;
      return fetch(AGENT_BASE + path + q, { method: method, headers: h, body: body, cache: "no-store" });
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = { ok: false, error: "bad-response" }; }
        return { s: r.status, d: d };
      });
    }).catch(function () { return { s: 0, d: { ok: false, error: "network" } }; });
  };

  function api(path, opts) { return apiImpl(path, opts || {}); }

  /* ---- Native ConnectBrowser plugin (phone runner) ---- */
  function hasPlugin() {
    try { return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ConnectBrowser); }
    catch (e) { return false; }
  }
  function getPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ConnectBrowser) || null; }
    catch (e) { return null; }
  }

  /* ES5-safe dynamic import (import() is not valid ES5 syntax to parse). Tests
   * stub the module directly so no real connect-agent/phone/index.mjs file is
   * required to exercise the UI. */
  function loadPhoneEngine() {
    if (window.__SMD_PHONE_ENGINE_TEST__) return Promise.resolve(window.__SMD_PHONE_ENGINE_TEST__);
    try {
      var imp = new Function("p", "return import(p)");
      return imp("/connect-agent/phone/index.mjs");
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function injectCSS() {
    if (document.getElementById("smd-connect-css")) return;
    var st = document.createElement("style");
    st.id = "smd-connect-css";
    st.textContent = [
      ".smd-connect-ov{position:fixed;inset:0;z-index:100000;background:rgba(7,17,25,.48);display:flex;align-items:flex-end;justify-content:center;padding:0}",
      ".smd-connect-sheet{width:min(620px,100vw);max-height:92vh;display:flex;flex-direction:column;background:var(--panel,#fff);color:var(--ink,#14202b);border-radius:22px 22px 0 0;box-shadow:0 -18px 60px rgba(0,0,0,.22);font-family:var(--sans,system-ui);will-change:transform}",
      ".smd-connect-bar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:0.75rem;padding:0.625rem 1rem calc(0.625rem + env(safe-area-inset-top));background:rgba(255,255,255,.6);backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border-top:1px solid rgba(255,255,255,.4);border-radius:22px 22px 0 0;touch-action:none;cursor:grab}",
      ".smd-connect-grip{position:absolute;top:0.375rem;left:50%;width:2.5rem;height:0.25rem;margin-left:-1.25rem;border-radius:999px;background:var(--line,#d7dee3)}",
      ".smd-connect-title{font-size:1.0625rem;font-weight:800;line-height:1.2;letter-spacing:0}",
      ".smd-connect-sub{font-size:0.75rem;color:var(--slate-soft,#5a7184);margin-top:0.125rem;line-height:1.4;letter-spacing:0}",
      ".smd-connect-x{margin-left:auto;border:0;background:none;color:var(--slate-soft,#5a7184);font-size:1.5rem;line-height:1;min-width:2.75rem;min-height:2.75rem;cursor:pointer;border-radius:0.625rem}",
      ".smd-connect-body{overflow:auto;padding:0 1.125rem calc(1.5rem + env(safe-area-inset-bottom))}",
      ".smd-connect-display{font-size:1.5rem;font-weight:800;line-height:1.1;letter-spacing:-0.02em;margin:1rem 0 0.25rem}",
      ".smd-connect-lead{font-size:0.875rem;line-height:1.5;letter-spacing:0;color:var(--slate,#2d4356);margin:0.25rem 0 0}",
      ".smd-connect-card{border:1px solid var(--line,#d7dee3);border-radius:0.875rem;padding:0.875rem;margin:0.625rem 0;background:var(--paper,#f6f7f5)}",
      ".smd-connect-label{display:block;font-size:0.75rem;font-weight:800;margin:0 0 0.375rem;letter-spacing:0}",
      ".smd-connect-input{width:100%;box-sizing:border-box;border:1px solid var(--line,#d7dee3);border-radius:0.625rem;padding:0.6875rem 0.75rem;background:var(--panel,#fff);color:var(--ink,#14202b);font:500 0.875rem var(--sans,system-ui);min-height:2.75rem}",
      ".smd-connect-row{display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-top:0.625rem}",
      ".smd-connect-btn{border:1px solid var(--line,#d7dee3);border-radius:0.625rem;padding:0.625rem 0.8125rem;background:var(--panel,#fff);color:var(--ink,#14202b);font:700 0.8125rem var(--sans,system-ui);cursor:pointer;min-height:2.75rem;letter-spacing:0}",
      ".smd-connect-btn.primary{background:var(--teal,#0e6e63);border-color:var(--teal,#0e6e63);color:#fff}",
      ".smd-connect-btn.danger{color:var(--red,#ab1c2c);border-color:var(--red-line,#efa9b1)}",
      ".smd-connect-btn:disabled{opacity:.5;cursor:not-allowed}",
      ".smd-connect-btn:active{transform:scale(.97);transition:transform 100ms ease-out}",
      ".smd-connect-x:active{background:var(--paper,#f6f7f5)}",
      ".smd-connect-btn:focus-visible,.smd-connect-x:focus-visible,.smd-connect-input:focus-visible,.smd-connect-hosp:focus-visible,.smd-connect-check:focus-visible{outline:2px solid var(--teal,#0e6e63);outline-offset:2px}",
      ".smd-connect-hosp{display:flex;align-items:center;gap:0.75rem;width:100%;box-sizing:border-box;text-align:left;border:1px solid var(--line,#d7dee3);border-radius:0.875rem;padding:0.875rem;background:var(--panel,#fff);color:var(--ink,#14202b);font:600 0.9375rem var(--sans,system-ui);margin:0.5rem 0;min-height:3.25rem;letter-spacing:0}",
      "button.smd-connect-hosp{cursor:pointer}",
      "button.smd-connect-hosp:active{transform:scale(.98);transition:transform 100ms ease-out}",
      ".smd-connect-hosp small{display:block;font-weight:400;font-size:0.75rem;color:var(--slate-soft,#5a7184);margin-top:0.125rem}",
      ".smd-connect-badge{display:inline-flex;align-items:center;gap:0.375rem;padding:0.4375rem 0.625rem;border-radius:999px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);font-size:0.75rem;font-weight:800;white-space:nowrap}",
      ".smd-connect-badge.new{background:var(--paper,#f6f7f5);color:var(--slate,#2d4356);border:1px solid var(--line,#d7dee3)}",
      ".smd-connect-badge.warn{background:var(--amber-soft,#fdf0d5);color:var(--amber,#92620a)}",
      ".smd-connect-scope{margin:0.625rem 0 0;padding-left:1.25rem;color:var(--slate,#2d4356);font-size:0.875rem;line-height:1.6;letter-spacing:0}",
      ".smd-connect-caps{margin:0.625rem 0 0;padding-left:0;list-style:none;color:var(--slate,#2d4356);font-size:0.875rem;line-height:1.8;letter-spacing:0}",
      ".smd-connect-checkrow{display:flex;gap:0.625rem;align-items:flex-start;margin-top:0.875rem;font-size:0.875rem;line-height:1.5}",
      ".smd-connect-check{width:1.375rem;height:1.375rem;margin-top:0.125rem;accent-color:var(--teal,#0e6e63);flex-shrink:0}",
      ".smd-connect-view{width:100%;box-sizing:border-box;height:16rem;border:1px solid var(--line,#d7dee3);border-radius:0.875rem;background:var(--paper,#f6f7f5);margin-top:0.625rem}",
      ".smd-connect-status{font-size:0.8125rem;line-height:1.5;letter-spacing:0;color:var(--slate,#2d4356);margin-top:0.625rem}",
      ".smd-connect-status.done{color:var(--green,#1c7a4a);font-weight:700}",
      ".smd-connect-status.warn{color:var(--amber,#92620a);font-weight:700}",
      ".smd-connect-status.bad{color:var(--red,#ab1c2c);font-weight:700}",
      ".smd-connect-stages{list-style:none;margin:0.625rem 0 0;padding:0;font-size:0.875rem;line-height:1.5}",
      ".smd-connect-stages li{display:flex;gap:0.625rem;align-items:baseline;padding:0.375rem 0;border-bottom:1px solid var(--line,#d7dee3);color:var(--slate-soft,#5a7184)}",
      ".smd-connect-stages li.on{color:var(--ink,#14202b);font-weight:700}",
      ".smd-connect-stages li.ok{color:var(--green,#1c7a4a)}",
      ".smd-connect-dot{flex:0 0 auto;width:0.625rem;height:0.625rem;border-radius:50%;background:var(--line,#d7dee3);transform:translateY(-0.0625rem)}",
      ".smd-connect-stages li.on .smd-connect-dot{background:var(--teal,#0e6e63)}",
      ".smd-connect-stages li.ok .smd-connect-dot{background:var(--green,#1c7a4a)}",
      ".smd-connect-note{font-size:0.6875rem;line-height:1.5;letter-spacing:0;color:var(--slate-soft,#5a7184);margin-top:0.625rem}",
      ".smd-connect-counts{display:flex;justify-content:space-between;margin-top:0}",
      ".smd-connect-ov[data-motion=\"fade\"] .smd-connect-sheet{transition:opacity 160ms ease;transform:none!important}",
      "@media (prefers-reduced-motion: reduce){.smd-connect-sheet{transition:opacity 160ms ease;transform:none!important}.smd-connect-btn:active,.smd-connect-hosp:active,.smd-connect-x:active{transform:none}}",
      "@media (prefers-reduced-transparency: reduce){.smd-connect-bar{background:var(--panel,#fff);backdrop-filter:none;-webkit-backdrop-filter:none}.smd-connect-ov{background:rgba(7,17,25,.72)}}",
      "body.dark .smd-connect-ov{background:rgba(0,0,0,.65)}",
      "body.dark .smd-connect-bar{background:rgba(19,32,48,.72)}",
      "body.dark .smd-connect-hosp{background:var(--panel)}"
    ].join("");
    (document.head || document.documentElement).appendChild(st);
  }

  /* Critically-damped spring helper. Animates a scalar from current value to
   * target with requestAnimationFrame, semi-implicit Euler in substeps.
   * Interruptible: start a new spring from spring.value() and cancel the old.
   * o: {from, to, vel, response (sec), damping (1 = no bounce), onUpdate, onDone}
   */
  function spring(o) {
    var w = 2 * Math.PI / (o.response || 0.35);
    var z = (o.damping == null) ? 1 : o.damping;
    var k = w * w, c = 2 * z * w;
    var x = o.from, v = o.vel || 0;
    var raf = 0, dead = false, last = 0;
    function frame(t) {
      if (dead) return;
      if (!last) last = t;
      var dt = Math.min(0.032, (t - last) / 1000);
      last = t;
      var n = 4, h = dt / n, i;
      for (i = 0; i < n; i++) {
        var a = -k * (x - o.to) - c * v;
        v += a * h;
        x += v * h;
      }
      o.onUpdate(x);
      if (Math.abs(x - o.to) < 0.4 && Math.abs(v) < 6) {
        o.onUpdate(o.to);
        if (o.onDone) o.onDone();
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return {
      cancel: function () { dead = true; cancelAnimationFrame(raf); },
      value: function () { return x; },
      velocity: function () { return v; }
    };
  }

  /* Apple-style momentum projection (exponential decay form). */
  function project(vel, rate) {
    var d = rate || 0.998;
    return (vel / 1000) * d / (1 - d);
  }

  function rubberband(overshoot, dimension, constant) {
    var c = constant || 0.55;
    var m = Math.abs(overshoot);
    return (overshoot * dimension * c) / (dimension + c * m);
  }

  /* Per-state clinician copy for the fallback (server-driven / Camofox) job
   * poll. Four kinds: status (default), done, warn, bad. */
  var STATE_COPY = {
    CREATED: ["Request created. Preparing your secure session.", ""],
    AWAITING_LOGIN: ["Waiting for sign in. Complete sign in in the frame above, then choose I have signed in.", ""],
    AUTHENTICATED: ["Sign in confirmed. Starting discovery of approved read workflows.", ""],
    DISCOVERING: ["Reading approved read workflows. The agent makes no changes to the EMR.", ""],
    COMPILING: ["Building the connection draft from what was observed.", ""],
    VALIDATING: ["Checking the draft for safety and completeness.", ""],
    AWAITING_APPROVAL: ["Draft ready. Waiting for hospital approval before activation.", "warn"],
    ACTIVE: ["Connection active.", "done"],
    NEEDS_REAUTH: ["The hospital session expired. Sign in again to continue. The existing connection is kept.", "warn"],
    NEEDS_REPAIR: ["The connection needs attention before it can be used.", "warn"],
    FAILED: ["Connection failed. No data was changed.", "bad"],
    CANCELLED: ["Connection cancelled. The session was closed and control tokens revoked.", "warn"],
    EXPIRED: ["This request expired. Start again to create a fresh session.", "warn"],
    REVOKED: ["Access was revoked. Contact your hospital administrator.", "bad"]
  };

  var STAGES = [
    ["AUTHENTICATED", "Signed in"],
    ["DISCOVERING", "Discovering read workflows"],
    ["COMPILING", "Building connection draft"],
    ["VALIDATING", "Validating draft"],
    ["AWAITING_APPROVAL", "Hospital approval"],
    ["ACTIVE", "Active"]
  ];

  /* Capability resource keys shown on the result screen, in a fixed clinical
   * order. Matches the CONTRACT's evidence/versions "capabilities" shape:
   * [{operation, resource, proven, how}]. */
  var CAP_ORDER = ["worklist", "patient_summary", "medications", "allergies", "results", "encounters", "notes"];
  var CAP_LABELS = {
    worklist: "Worklist",
    patient_summary: "Patient summary",
    medications: "Medications",
    allergies: "Allergies",
    results: "Results",
    encounters: "Encounters",
    notes: "Notes"
  };

  var S = null; /* per-open session state, reset in open() */

  function launcher() { return document.getElementById("smd-connect-agent-launch"); }

  function overlay() { return document.getElementById("smd-connect-ov"); }

  function sheet() {
    var ov = overlay();
    return ov ? ov.querySelector(".smd-connect-sheet") : null;
  }

  function stopPoll() {
    if (S && S.pollTimer) { clearInterval(S.pollTimer); S.pollTimer = null; }
  }

  function setStatus(kind, text) {
    if (!S) return;
    S.statusKind = kind || "";
    S.statusText = text || "";
    var el = overlay() && overlay().querySelector("#smd-connect-status");
    if (el) {
      el.className = "smd-connect-status" + (kind ? " " + kind : "");
      el.textContent = text || "";
    }
  }

  function sheetTravel() {
    var sh = sheet();
    if (!sh) return 0;
    return Math.max(80, sh.getBoundingClientRect().height + 40);
  }

  function setSheetY(y) {
    var sh = sheet();
    if (sh) sh.style.transform = "translateY(" + Math.round(y * 10) / 10 + "px)";
  }

  function animateOpen() {
    var sh = sheet();
    if (!sh) return;
    if (S.anim) { S.anim.cancel(); S.anim = null; }
    if (reducedMotion()) { sh.style.transform = ""; return; }
    var dist = sheetTravel();
    S.anim = spring({
      from: dist, to: 0, vel: 0, response: 0.35, damping: 1,
      onUpdate: setSheetY,
      onDone: function () { S.anim = null; }
    });
  }

  function animateClose(done) {
    var sh = sheet();
    if (!sh || reducedMotion()) { done(); return; }
    if (S.anim) { S.anim.cancel(); S.anim = null; }
    var cur = S.animY != null ? S.animY : 0;
    S.anim = spring({
      from: cur, to: sheetTravel(), vel: 0, response: 0.32, damping: 1,
      onUpdate: function (y) { S.animY = y; setSheetY(y); },
      onDone: function () { S.anim = null; done(); }
    });
  }

  /* Anchor the sheet's transform-origin to the launcher that opened it, so the
   * sheet grows out of its source and dismisses back along the same path. */
  function anchorToLauncher() {
    var b = launcher(), sh = sheet();
    if (!b || !sh) return;
    var r = b.getBoundingClientRect(), s = sh.getBoundingClientRect();
    var x = r.left + r.width / 2 - s.left;
    x = Math.max(0, Math.min(s.width, x));
    sh.style.transformOrigin = Math.round(x) + "px 100%";
  }

  function focusables() {
    var ov = overlay();
    if (!ov) return [];
    var nodes = ov.querySelectorAll("button, input, iframe, [tabindex]");
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.disabled && n.getAttribute("tabindex") !== "-1" && n.offsetParent !== null) out.push(n);
    }
    return out;
  }

  function trapTab(e) {
    if (e.key !== "Tab") return;
    var f = focusables();
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function onKey(e) {
    if (!overlay()) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    trapTab(e);
  }

  /* Drag-to-dismiss on the top bar. Tracks the pointer 1:1, rubber-bands past
   * the top edge, projects momentum on release, and stays interruptible: a new
   * gesture or open/close animation starts from the live on-screen value. */
  function bindDrag(bar) {
    var dragging = false, startY = 0, baseY = 0, hist = [];
    function curY() {
      if (S.anim) return S.anim.value();
      return S.animY != null ? S.animY : 0;
    }
    bar.addEventListener("pointerdown", function (e) {
      if (e.button != null && e.button !== 0) return;
      if (S.anim) { S.anim.cancel(); S.anim = null; }
      S.animY = curY();
      dragging = true;
      startY = e.clientY;
      baseY = S.animY;
      hist = [{ y: e.clientY, t: performance.now() }];
      try { bar.setPointerCapture(e.pointerId); } catch (x) {}
      bar.style.cursor = "grabbing";
    });
    bar.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dy = e.clientY - startY;
      var y = baseY + dy;
      if (y < 0) y = rubberband(y, 220);
      S.animY = y;
      setSheetY(y);
      hist.push({ y: e.clientY, t: performance.now() });
      if (hist.length > 6) hist.shift();
    });
    function release(e) {
      if (!dragging) return;
      dragging = false;
      bar.style.cursor = "grab";
      var vel = 0;
      if (hist.length >= 2) {
        var a = hist[0], b = hist[hist.length - 1];
        var dt = (b.t - a.t) / 1000;
        if (dt > 0.01) vel = (b.y - a.y) / dt;
      }
      var y = S.animY != null ? S.animY : 0;
      var projected = y + project(vel);
      var dist = sheetTravel();
      var hadVelocity = Math.abs(vel) > 120;
      if (S.anim) { S.anim.cancel(); S.anim = null; }
      if ((vel > 0 && projected > dist * 0.35) || projected > dist * 0.6) {
        /* Dismiss along the same downward path. Slight overshoot only when the
         * gesture itself carried velocity. */
        S.anim = spring({
          from: y, to: dist, vel: vel, response: 0.3, damping: hadVelocity ? 0.8 : 1,
          onUpdate: function (v) { S.animY = v; setSheetY(v); },
          onDone: function () { S.anim = null; close(true); }
        });
      } else {
        S.anim = spring({
          from: y, to: 0, vel: vel, response: 0.3, damping: hadVelocity ? 0.8 : 1,
          onUpdate: function (v) { S.animY = v; setSheetY(v); },
          onDone: function () { S.anim = null; }
        });
      }
    }
    bar.addEventListener("pointerup", release);
    bar.addEventListener("pointercancel", release);
  }

  function close(fromAnim) {
    var ov = overlay();
    if (!ov) { S = null; return; }
    if (!fromAnim && S && !reducedMotion() && sheet()) {
      animateClose(function () { finishClose(); });
      return;
    }
    finishClose();
  }

  function finishClose() {
    stopPoll();
    removePluginListeners();
    var plugin = getPlugin();
    if (S && (S.screen === "login" || S.screen === "progress" || S.screen === "origins") && plugin && plugin.close) {
      try { plugin.close(); } catch (e) {}
    }
    if (S && S.anim) { S.anim.cancel(); S.anim = null; }
    document.removeEventListener("keydown", onKey, true);
    var ov = overlay();
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var b = launcher();
    if (b && b.focus) {
      try { b.focus(); } catch (e) {}
    }
    S = null;
  }

  function body() {
    var ov = overlay();
    return ov ? ov.querySelector("#smd-connect-body") : null;
  }

  function show(screen) {
    if (S) S.screen = screen;
    var render = {
      connections: renderConnections,
      url: renderUrl,
      consent: renderConsent,
      reuse: renderReuse,
      login: renderLogin,
      origins: renderOrigins,
      progress: renderProgress,
      result: renderResult,
      done: renderDone
    }[screen];
    if (render) render();
  }

  function refresh() {
    if (S) show(S.screen);
  }

  /* ---- Plugin event wiring (phone runner) ---- */
  function bindPluginListeners(plugin) {
    removePluginListeners();
    if (!plugin || !plugin.addListener) return;
    S.pluginListeners = [];
    function on(name, fn) {
      try { S.pluginListeners.push(plugin.addListener(name, fn)); } catch (e) {}
    }
    on("navigated", function (e) {
      var o = e && e.url ? originOf(e.url) : null;
      if (o && S && S.visitedOrigins.indexOf(o) < 0) S.visitedOrigins.push(o);
    });
    on("loggedIn", function () {
      if (!S) return;
      /* Guided step: the agent asked the doctor to show it a screen; Done resolves that ask. */
      if (S.guideResolve) { var r = S.guideResolve; S.guideResolve = null; S.guide = null; r({ done: true }); paintProgress(); return; }
      if (S.loginHandled) return;
      S.loginHandled = true;
      doHandoff();
    });
    on("stopped", function () {
      if (S) S.stopRequested = true;
      if (S && S.guideResolve) { var r2 = S.guideResolve; S.guideResolve = null; S.guide = null; r2({ done: false }); }
      if (S && S.screen === "progress") stopDiscovery();
    });
  }

  function removePluginListeners() {
    if (S && S.pluginListeners) {
      for (var i = 0; i < S.pluginListeners.length; i++) {
        try { S.pluginListeners[i].remove(); } catch (e) {}
      }
    }
    if (S) S.pluginListeners = [];
  }

  /* ---- Screen 1: connections list ---- */
  function pillFor(c) {
    if (c && c.lastSessionState === "NEEDS_REAUTH") return { cls: "warn", label: "Needs sign-in" };
    if (c && c.activeVersionId) return { cls: "", label: "Active" };
    if (c && c.pendingVersionId) return { cls: "warn", label: "Pending approval" };
    return { cls: "new", label: "Not connected" };
  }

  function connectionHost(c) {
    var o = c && c.origins && c.origins[0];
    return o ? hostOf(o) : ((c && c.deploymentId) || "Hospital");
  }

  function connectionRow(c) {
    var pill = pillFor(c);
    return '<div class="smd-connect-hosp"><span style="flex:1"><span>' + esc(connectionHost(c)) + '</span></span>' +
      '<span class="smd-connect-badge' + (pill.cls ? " " + pill.cls : "") + '">' + esc(pill.label) + '</span></div>';
  }

  var TENANT_KEY = "smd_connect_agent_tenant";
  function storedTenant() { try { return localStorage.getItem(TENANT_KEY) || ""; } catch (e) { return ""; } }
  function storeTenant(id) { try { if (id) localStorage.setItem(TENANT_KEY, id); else localStorage.removeItem(TENANT_KEY); } catch (e) {} }
  /* Which hospital? An account that belongs to several tenants (an owner, a super-admin) must say
   * which one it is connecting; the server refuses to guess. One tenant: nothing to ask. */
  function pickTenantThenLoad() {
    api("/tenants", {}).then(function (r) {
      if (!overlay() || !S) return;
      var list = (r.s === 200 && r.d && r.d.tenants) || [];
      if (list.length > 1) {
        S.tenants = list;
        var known = list.some(function (t) { return t.tenantId === S.tenant; });
        if (!known) { S.tenant = ""; storeTenant(""); if (S.screen === "connections") renderConnections(); return; }
      } else if (list.length === 1 && S.tenant && S.tenant !== list[0].tenantId) { S.tenant = ""; storeTenant(""); }
      loadConnections();
    });
  }
  function renderTenantPicker(b) {
    var rows = "";
    for (var i = 0; i < S.tenants.length; i++) {
      var t = S.tenants[i];
      rows += '<div class="smd-connect-row"><button class="smd-connect-btn" type="button" data-tenant="' + esc(t.tenantId) + '">' + esc(t.name || t.tenantId) + "</button></div>";
    }
    b.innerHTML =
      '<h2 class="smd-connect-display">Which hospital?</h2>' +
      '<p class="smd-connect-lead">Your account belongs to more than one. Pick the hospital you are connecting.</p>' +
      '<div id="smd-connect-tenants">' + rows + "</div>";
    setStatus("", "");
    var btns = b.querySelectorAll("[data-tenant]");
    for (var j = 0; j < btns.length; j++) {
      btns[j].onclick = function () { S.tenant = this.getAttribute("data-tenant"); storeTenant(S.tenant); loadConnections(); };
    }
    if (btns[0]) btns[0].focus();
  }
  function loadConnections() {
    S.connLoading = true;
    S.connError = false;
    if (S.screen === "connections") renderConnections();
    var seq = (S.connSeq = (S.connSeq || 0) + 1);
    api("/connections", {}).then(function (r) {
      if (!overlay() || !S || seq !== S.connSeq) return;
      S.connLoading = false;
      if (r.s === 200 && r.d) {
        S.connections = Array.isArray(r.d) ? r.d : (r.d.connections || []);
      } else {
        S.connections = [];
        S.connError = true;
      }
      if (S.screen === "connections") renderConnections();
    });
  }

  function renderConnections() {
    var b = body();
    if (!b) return;
    if (S.tenants && !S.tenant) return renderTenantPicker(b);
    var rows = "";
    for (var i = 0; i < S.connections.length; i++) rows += connectionRow(S.connections[i]);
    b.innerHTML =
      '<h2 class="smd-connect-display">Your hospitals</h2>' +
      (S.connLoading
        ? '<p class="smd-connect-lead">Loading your connections.</p>'
        : (S.connections.length
            ? '<div id="smd-connect-connlist">' + rows + '</div>'
            : '<p class="smd-connect-lead">You have not connected a hospital yet. Connect your hospital so StewardMD can read your worklist safely, once a reviewer approves it.</p>')) +
      '<div class="smd-connect-row"><button id="smd-connect-add" class="smd-connect-btn primary" type="button">Connect a hospital</button>' +
      (S.tenants ? '<button id="smd-connect-switch" class="smd-connect-btn" type="button">Switch hospital</button>' : "") + "</div>";
    setStatus(S.connError ? "bad" : "", S.connError ? "Could not load your connections. Check your connection and try again." : "");
    var sw = b.querySelector("#smd-connect-switch");
    if (sw) sw.onclick = function () { S.tenant = ""; storeTenant(""); renderConnections(); };
    b.querySelector("#smd-connect-add").onclick = function () {
      S.selected = null; S.emrUrl = "";
      show("url");
    };
    var first = b.querySelector("#smd-connect-add");
    if (first && !reducedMotion() && !S.connLoading) { try { first.focus(); } catch (e) {} }
  }

  /* ---- Screen 2: hospital URL ---- */
  function renderUrl() {
    var b = body();
    if (!b) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">Connect a hospital</h2>' +
      '<p class="smd-connect-lead">Enter your hospital EMR address to begin.</p>' +
      '<div class="smd-connect-card"><label class="smd-connect-label" for="smd-connect-url">Hospital EMR address</label>' +
      '<input id="smd-connect-url" class="smd-connect-input" type="url" inputmode="url" autocomplete="off" placeholder="https://emr.hospital.example" value="' + esc(S.emrUrl || "") + '"/>' +
      '<div class="smd-connect-note">Use a hospital-authorized address. Entering an address does not grant access; access is checked after you sign in.</div></div>' +
      '<div class="smd-connect-row"><button id="smd-connect-urlgo" class="smd-connect-btn primary" type="button">Continue</button>' +
      '<button id="smd-connect-urlback" class="smd-connect-btn" type="button">Back</button></div>';
    setStatus("", "");
    var input = b.querySelector("#smd-connect-url");
    function go() {
      var url = (input.value || "").trim();
      if (!/^https:\/\//i.test(url)) {
        setStatus("bad", "Enter an HTTPS hospital address, for example https://emr.hospital.example.");
        return;
      }
      S.emrUrl = url;
      S.selected = { emrUrl: url };
      show("consent");
    }
    b.querySelector("#smd-connect-urlgo").onclick = go;
    input.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } };
    b.querySelector("#smd-connect-urlback").onclick = function () { show("connections"); };
    if (!reducedMotion()) { try { input.focus(); } catch (e) {} }
  }

  /* ---- Screen 3: explicit consent, no pre-checked boxes ---- */
  function renderConsent() {
    var b = body();
    if (!b || !S.selected) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">Before you sign in</h2>' +
      '<div class="smd-connect-card"><ul class="smd-connect-scope">' +
      '<li>You sign in yourself. StewardMD never asks for or stores your EMR password.</li>' +
      '<li>The agent only reads. It cannot order, prescribe, or edit records.</li>' +
      '<li>You can stop the agent at any time.</li>' +
      '<li>A human reviewer approves the connection before another doctor can use it.</li>' +
      '</ul>' +
      '<label class="smd-connect-checkrow"><input id="smd-connect-agree" class="smd-connect-check" type="checkbox"/>' +
      '<span>I agree to continue.</span></label>' +
      '<div class="smd-connect-row"><button id="smd-connect-consentgo" class="smd-connect-btn primary" type="button" disabled>I agree, continue</button>' +
      '<button id="smd-connect-back2" class="smd-connect-btn" type="button">Back</button></div></div>';
    setStatus("", "");
    var box = b.querySelector("#smd-connect-agree");
    var go = b.querySelector("#smd-connect-consentgo");
    box.onchange = function () { go.disabled = !box.checked; };
    b.querySelector("#smd-connect-back2").onclick = function () { show("url"); };
    go.onclick = function () {
      if (!box.checked) return;
      go.disabled = true;
      setStatus("", "Starting your session.");
      S.runner = hasPlugin() ? "phone" : null;
      var payload = { emrUrl: S.selected.emrUrl, consent: { agreed: true } };
      if (S.runner === "phone") payload.runner = "phone";
      api("/sessions", { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
        if (!overlay() || !S) return;
        // The server answers sessionView(): a FLAT { ok, sessionId, state, ... }, never a nested
        // `session` object. Requiring r.d.session meant every successful start was read as a failure
        // and the doctor saw "Could not start the session" on a 200 with a real session id.
        var sid = r.d && (r.d.sessionId || (r.d.session && r.d.session.id));
        if (r.s === 200 && r.d && r.d.ok !== false && sid) {
          S.session = { id: sid, state: r.d.state || null };
          S.deployment = r.d.deployment || null;
          S.reuse = !!r.d.reuse;
          S.visitedOrigins = [];
          S.pendingOrigins = [];
          S.loginOpened = false;
          S.loginHandled = false;
          show(S.reuse ? "reuse" : "login");
        } else if (r.s === 404) {
          setStatus("bad", "Connections are not enabled yet. Try again later.");
          go.disabled = false;
        } else {
          // Say WHY when the server said why: a code like not-configured or forbidden is actionable,
          // "check your connection" is not.
          var why = r.d && (r.d.message || r.d.code || r.d.error);
          setStatus("bad", why ? "Could not start the session: " + why + "." : "Could not start the session. Check your connection and try again.");
          go.disabled = false;
        }
      });
    };
  }

  /* ---- Screen 4: already-connected shortcut (reuse:true) ---- */
  function renderReuse() {
    var b = body();
    if (!b || !S.selected) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">Already connected</h2>' +
      '<p class="smd-connect-lead">This hospital is already connected (adapter active).</p>' +
      '<div class="smd-connect-row"><button id="smd-connect-reusego" class="smd-connect-btn primary" type="button">Sign in to use it</button>' +
      '<button id="smd-connect-reuseback" class="smd-connect-btn" type="button">Back</button></div>';
    setStatus("", "");
    b.querySelector("#smd-connect-reuseback").onclick = function () { resetToConnections(""); };
    b.querySelector("#smd-connect-reusego").onclick = function () {
      S.loginOpened = false;
      S.loginHandled = false;
      show("login");
    };
  }

  function finishReuse() {
    var plugin = getPlugin();
    if (plugin && plugin.close) { try { plugin.close(); } catch (e) {} }
    show("done");
  }

  /* ---- Screen 5: sign in ---- */
  function renderLogin() {
    var b = body();
    if (!b) return;
    if (S.runner === "phone") { renderLoginPhone(b); return; }
    renderLoginFallback(b);
  }

  function renderLoginPhone(b) {
    var host = hostOf(S.selected.emrUrl);
    b.innerHTML =
      '<h2 class="smd-connect-display">Sign in to ' + esc(host) + '</h2>' +
      '<p class="smd-connect-lead">Sign in yourself inside the hospital website that just opened. StewardMD never asks for or stores your password.</p>' +
      '<div class="smd-connect-note">Keep your phone unlocked and StewardMD open until the connection finishes. The screen stays awake while the hospital website is open.</div>' +
      '<div class="smd-connect-row"><button id="smd-connect-cancel" class="smd-connect-btn danger" type="button">Cancel connection</button></div>';
    setStatus("", S.statusText || "Opening the hospital website.");
    b.querySelector("#smd-connect-cancel").onclick = cancelSession;
    openLoginPlugin();
  }

  function openLoginPlugin() {
    if (S.loginOpened) return;
    S.loginOpened = true;
    var plugin = getPlugin();
    if (!plugin) { setStatus("bad", "The in-app browser is unavailable on this device."); return; }
    var host = hostOf(S.selected.emrUrl);
    bindPluginListeners(plugin);
    loadPhoneEngine().then(function (engine) {
      S.engine = engine;
      if (engine && engine.createPluginClient) {
        var client = engine.createPluginClient({ plugin: plugin, storeId: S.deployment.id, origins: S.deployment.origins, title: host });
        S.pluginClient = client;
        return client.createTab({ url: S.selected.emrUrl });
      }
      /* ENGINE HOOK: the phone engine has not loaded yet, so there is no
       * observer install script to inject. Open with none; runPhoneDiscovery
       * installs its own observer once discovery actually starts. */
      return plugin.open({ url: S.selected.emrUrl, origins: S.deployment.origins, storeId: S.deployment.id, title: host, initScript: "" });
    }).catch(function () {
      return plugin.open({ url: S.selected.emrUrl, origins: S.deployment.origins, storeId: S.deployment.id, title: host, initScript: "" });
    }).catch(function () {
      if (overlay() && S) setStatus("bad", "Could not open the hospital website. Try again.");
    });
  }

  function renderLoginFallback(b) {
    var paused = S.controlOwner === "clinician";
    b.innerHTML =
      '<h2 class="smd-connect-display">Sign in to the hospital EMR</h2>' +
      '<p class="smd-connect-lead">Complete sign in in the frame below. The agent is paused and cannot see what you type.</p>' +
      '<div class="smd-connect-note">On your phone this opens the hospital website inside StewardMD.</div>' +
      '<iframe id="smd-connect-frame" class="smd-connect-view" title="Hospital sign in" src="about:blank"></iframe>' +
      '<div class="smd-connect-row"><button id="smd-connect-signedin" class="smd-connect-btn primary" type="button">I have signed in</button>' +
      '<button id="smd-connect-pause" class="smd-connect-btn" type="button">' + (paused ? "Resume agent" : "Pause agent") + '</button>' +
      '<button id="smd-connect-cancel" class="smd-connect-btn danger" type="button">Cancel connection</button></div>';
    if (S.viewerUrl) {
      var f = b.querySelector("#smd-connect-frame");
      if (f) f.src = S.viewerUrl;
    }
    setStatus(paused ? "warn" : "", paused ? "Agent paused. You control the session." : (S.statusText || ""));
    b.querySelector("#smd-connect-signedin").onclick = doHandoff;
    b.querySelector("#smd-connect-pause").onclick = togglePause;
    b.querySelector("#smd-connect-cancel").onclick = cancelSession;
    loadViewer();
  }

  function loadViewer() {
    if (!S.session) return;
    setStatus("", "Preparing the secure sign in frame.");
    api("/sessions/" + enc(S.session.id) + "/viewer-token", { method: "POST", body: "{}" }).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok && r.d.viewerUrl) {
        S.viewerUrl = r.d.viewerUrl;
        if (S.screen === "login") {
          var f = body() && body().querySelector("#smd-connect-frame");
          if (f) f.src = S.viewerUrl;
          setStatus("", "Sign in frame ready. Complete sign in below.");
        }
      } else {
        setStatus("bad", "Could not prepare the sign in frame. Check your connection and try again.");
      }
    });
  }

  function togglePause() {
    if (!S.session) return;
    var pausing = S.controlOwner !== "clinician";
    var path = "/sessions/" + enc(S.session.id) + (pausing ? "/pause" : "/resume");
    var btn = body() && body().querySelector("#smd-connect-pause");
    if (btn) btn.disabled = true;
    setStatus("", pausing ? "Pausing the agent." : "Resuming the agent.");
    api(path, { method: "POST", body: "{}" }).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok) {
        S.controlOwner = r.d.controlOwner || (pausing ? "clinician" : "agent");
        if (S.screen === "login") {
          show("login");
          setStatus(S.controlOwner === "clinician" ? "warn" : "done",
            S.controlOwner === "clinician"
              ? "Agent paused. You control the session."
              : "Agent resumed. It can now continue the connection.");
        }
      } else {
        setStatus("bad", "Could not change who controls the session. Try again.");
        if (btn) btn.disabled = false;
      }
    });
  }

  /* ---- Handoff: doctor confirmed sign in (either runner) ---- */
  function doHandoff() {
    if (!S || !S.session) return;
    setStatus("", "Confirming sign in.");
    api("/sessions/" + enc(S.session.id) + "/handoff", {
      method: "POST",
      body: JSON.stringify({ visitedOrigins: S.visitedOrigins || [] })
    }).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok !== false) {
        S.deployment = S.deployment || {};
        S.deployment.origins = r.d.origins || S.deployment.origins;
        S.pendingOrigins = r.d.pendingOrigins || [];
        if (S.reuse) { finishReuse(); return; }
        if (S.pendingOrigins.length) { show("origins"); return; }
        if (S.runner === "phone") { beginAgentMode(); return; }
        show("progress");
        fetchStatus();
        startPoll();
      } else if (r.s === 404) {
        setStatus("bad", "Connections are not enabled yet. Try again later.");
      } else {
        setStatus("bad", "Sign in was not detected yet. Finish signing in, then try again.");
        S.loginHandled = false;
      }
    });
  }

  function cancelSession() {
    removePluginListeners();
    var plugin = getPlugin();
    if (plugin && plugin.close) { try { plugin.close(); } catch (e) {} }
    if (!S.session) { resetToConnections(""); return; }
    setStatus("", "Cancelling the session.");
    api("/sessions/" + enc(S.session.id), { method: "DELETE" }).then(function () {
      if (!overlay() || !S) return;
      resetToConnections("Connection cancelled. The session was closed.");
    });
  }

  function resetToConnections(msg) {
    stopPoll();
    removePluginListeners();
    S.session = null;
    S.deployment = null;
    S.reuse = false;
    S.visitedOrigins = [];
    S.pendingOrigins = [];
    S.result = null;
    S.versionId = null;
    S.jobState = null;
    S.runner = hasPlugin() ? "phone" : null;
    S.loginOpened = false;
    S.loginHandled = false;
    show("connections");
    loadConnections();
    if (msg) setStatus("warn", msg);
  }

  /* ---- Screen 6a: pending-origin confirm (phone runner) ---- */
  function renderOrigins() {
    var b = body();
    if (!b) return;
    var items = "";
    for (var i = 0; i < S.pendingOrigins.length; i++) items += "<li>" + esc(S.pendingOrigins[i]) + "</li>";
    b.innerHTML =
      '<h2 class="smd-connect-display">Another website was used</h2>' +
      '<p class="smd-connect-lead">The sign in used another website:</p>' +
      '<ul class="smd-connect-scope">' + items + '</ul>' +
      '<p class="smd-connect-lead">Allow StewardMD to read from it too?</p>' +
      '<div class="smd-connect-row"><button id="smd-connect-originsyes" class="smd-connect-btn primary" type="button">Allow</button>' +
      '<button id="smd-connect-originsno" class="smd-connect-btn" type="button">Not now</button></div>';
    setStatus("", "");
    b.querySelector("#smd-connect-originsyes").onclick = function () {
      api("/sessions/" + enc(S.session.id) + "/origins", {
        method: "POST",
        body: JSON.stringify({ approve: S.pendingOrigins })
      }).then(function (r) {
        if (!overlay() || !S) return;
        if (r.s === 200 && r.d && r.d.ok !== false) {
          S.deployment.origins = r.d.origins || S.deployment.origins;
          S.pendingOrigins = [];
          beginAgentMode();
        } else {
          setStatus("bad", "Could not confirm the extra website. Try again.");
        }
      });
    };
    b.querySelector("#smd-connect-originsno").onclick = function () {
      S.pendingOrigins = [];
      beginAgentMode();
    };
  }

  function beginAgentMode() {
    var plugin = getPlugin();
    if (plugin && plugin.setMode) {
      try { plugin.setMode({ mode: "agent", origins: S.deployment.origins }); } catch (e) {}
    }
    startPhoneDiscovery();
  }

  /* ---- Screen 6b: live discovery progress ---- */
  function phoneApi(sessionId) {
    function call(path, body) {
      return api("/sessions/" + enc(sessionId) + path, { method: "POST", body: JSON.stringify(body || {}) }).then(function (r) {
        if (r.s === 401 || (r.d && r.d.error === "NEEDS_REAUTH")) {
          var e = new Error("reauth"); e.reauth = true; throw e;
        }
        if (r.s < 200 || r.s >= 300 || !r.d || r.d.ok === false) {
          // The server names the reason in `detail` (router catch); carry it so the sheet can say it.
          throw new Error((r.d && (r.d.detail || r.d.error)) || "request-failed");
        }
        return r.d;
      });
    }
    return {
      plan: function (body) { return call("/plan", body); },
      progress: function (body) { return call("/progress", body); },
      discovery: function (body) { return call("/discovery", body); },
      evidence: function (body) { return call("/evidence", body); }
    };
  }

  function startPhoneDiscovery() {
    S.progressCounts = { pages: 0, requests: 0, phase: "DISCOVERING", opening: "", found: [], looking: [] };
    S.progressFailed = false;
    S.stopRequested = false;
    S.guide = null;
    S.guideResolve = null;
    show("progress");
    loadPhoneEngine().then(function (engine) {
      if (!engine || !engine.runPhoneDiscovery) throw new Error("engine-unavailable");
      S.engine = engine;
      // The engine needs the six-method client built at login (evaluate/snapshot/click over the
      // plugin), not the raw Capacitor plugin. Build one here only if login never created it.
      if (!S.pluginClient && engine.createPluginClient) {
        S.pluginClient = engine.createPluginClient({ plugin: getPlugin(), storeId: S.deployment.id, origins: S.deployment.origins, title: hostOf(S.selected.emrUrl) });
      }
      return engine.runPhoneDiscovery({
        plugin: S.pluginClient || getPlugin(),
        api: phoneApi(S.session.id),
        session: S.session,
        deployment: S.deployment,
        startUrl: S.selected.emrUrl,
        stopSignal: function () { return !!(S && S.stopRequested); },
        /* The agent could not find something: hand the screen to the doctor (plugin guide mode) and
         * resolve when they tap Done in the browser header, or Skip here. */
        askDoctor: function (q) {
          return new Promise(function (resolve) {
            if (!S || S.screen !== "progress" || S.stopRequested) { resolve({ done: false }); return; }
            S.guide = { gap: q.gap, text: q.text };
            S.guideResolve = resolve;
            paintProgress();
          });
        },
        onProgress: function (p) {
          if (!S || S.screen !== "progress") return;
          // The engine reports {phase, steps, events, opening, found, looking}: steps are pages the
          // agent opened, events are requests it observed, opening is the control it is clicking now,
          // found / looking are the canonical views captured so far / still missing.
          var c = S.progressCounts;
          S.progressCounts = {
            pages: (p && p.steps != null) ? p.steps : (p && p.pages != null) ? p.pages : c.pages,
            requests: (p && p.events != null) ? p.events : (p && p.requests != null) ? p.requests : c.requests,
            phase: (p && p.phase) || c.phase,
            opening: (p && p.phase === "CRAWLING") ? (p.opening || "") : "",
            found: (p && p.found) || c.found || [],
            looking: (p && p.looking) || c.looking || []
          };
          paintProgress();
        }
      });
    }).then(function (result) {
      if (!overlay() || !S) return;
      S.result = result || {};
      S.versionId = (result && result.candidateVersionId) || null;
      loadVersionAndShowResult();
    }).catch(function (e) {
      if (!overlay() || !S) return;
      if (e && e.reauth) {
        stopDiscoveryPlugin();
        show("login");
        S.loginOpened = false;
        S.loginHandled = false;
        setStatus("warn", "The hospital session expired. Sign in again to continue. The existing connection is kept.");
        return;
      }
      S.progressFailed = true;
      /* NAME THE FAILURE. This swallowed e.message and said only "could not complete", so a crawl
       * that had walked 21 pages and posted its findings left the doctor, and whoever they call,
       * with nothing to act on. The engine's errors are codes (request-failed, engine-unavailable,
       * the server's own error string), not stack traces, so they are safe to show. */
      var why = e && e.message ? String(e.message).slice(0, 120) : "";
      setStatus("bad", why ? "Discovery could not complete: " + why + ". You can try again." : "Discovery could not complete. You can try again.");
      paintProgress();
    });
  }

  function stopDiscoveryPlugin() {
    var plugin = getPlugin();
    if (plugin && plugin.close) { try { plugin.close(); } catch (e) {} }
    removePluginListeners();
  }

  function stopDiscovery() {
    setStatus("", "Stopping.");
    stopDiscoveryPlugin();
    if (!S.session) { resetToConnections(""); return; }
    api("/sessions/" + enc(S.session.id), { method: "DELETE" }).then(function () {
      if (!overlay() || !S) return;
      resetToConnections("Connection cancelled.");
    });
  }

  function phaseLabel(p) {
    if (p === "COMPILING") return "Building the connection draft.";
    if (p === "VALIDATING") return "Checking the draft for safety and completeness.";
    if (p === "CRAWLING") return "Opening every view of one patient record, read-only.";
    if (p === "ASKING") return "The agent needs your help to find a view.";
    return "Discovering read-only workflows. The agent makes no changes to the EMR.";
  }

  var VIEW_NAMES = { worklist: "Worklist", patient: "Patient details", medications: "Medications", labs: "Lab results", radiology: "Radiology reports", discharge: "Discharge summary", history: "Visit history" };
  function viewNames(list) {
    var out = [];
    for (var i = 0; i < (list || []).length; i++) out.push(esc(VIEW_NAMES[list[i]] || list[i]));
    return out.length ? out.join(", ") : "none yet";
  }
  function progressDetail() {
    var c = S.progressCounts || {};
    if (S.guide) {
      return '<div class="smd-connect-card"><p class="smd-connect-lead">' + esc(S.guide.text) + '</p>' +
        '<div class="smd-connect-note">Tap inside the hospital website, then tap Done at the top. Skip if your hospital has no such view.</div>' +
        '<div class="smd-connect-row"><button id="smd-connect-guideskip" class="smd-connect-btn" type="button">Skip</button></div></div>';
    }
    return '<div class="smd-connect-card">' +
      (c.opening ? '<div class="smd-connect-row smd-connect-counts"><span>Opening</span><strong>' + esc(c.opening) + '</strong></div>' : "") +
      '<div class="smd-connect-row smd-connect-counts"><span>Found</span><strong>' + viewNames(c.found) + '</strong></div>' +
      '<div class="smd-connect-row smd-connect-counts"><span>Still looking for</span><strong>' + viewNames(c.looking) + '</strong></div>' +
      '<div class="smd-connect-row smd-connect-counts"><span>Pages visited</span><strong id="smd-connect-pages">' + c.pages + '</strong></div>' +
      '<div class="smd-connect-row smd-connect-counts"><span>Requests observed</span><strong id="smd-connect-reqs">' + c.requests + '</strong></div>' +
      '</div>';
  }

  function renderProgress() {
    var b = body();
    if (!b) return;
    if (S.runner !== "phone") { renderProgressFallback(b); return; }
    var c = S.progressCounts || { pages: 0, requests: 0, phase: "DISCOVERING", found: [], looking: [] };
    b.innerHTML =
      '<h2 class="smd-connect-display">Reading ' + esc(hostOf(S.selected.emrUrl)) + '</h2>' +
      '<p id="smd-connect-phase" class="smd-connect-lead">' + phaseLabel(S.guide ? "ASKING" : c.phase) + '</p>' +
      '<div id="smd-connect-detail">' + progressDetail() + '</div>' +
      '<div class="smd-connect-note">Keep your phone unlocked and StewardMD open. Do not switch apps or lock the screen: a locked phone stops the agent and can sign you out of the hospital. This takes a few minutes.</div>' +
      '<div class="smd-connect-row"><button id="smd-connect-stop" class="smd-connect-btn danger" type="button">Stop</button>' +
      '<button id="smd-connect-progretry" class="smd-connect-btn primary" type="button" style="display:' + (S.progressFailed ? "" : "none") + '">Try again</button></div>';
    setStatus(S.progressFailed ? "bad" : "", S.statusText || "");
    b.querySelector("#smd-connect-stop").onclick = function () { S.stopRequested = true; stopDiscovery(); };
    b.querySelector("#smd-connect-progretry").onclick = function () { beginAgentMode(); };
    wireGuideSkip(b);
  }

  function wireGuideSkip(b) {
    var skip = b.querySelector("#smd-connect-guideskip");
    if (skip) skip.onclick = function () {
      if (!S || !S.guideResolve) return;
      var r = S.guideResolve; S.guideResolve = null; S.guide = null;
      r({ done: false });
      paintProgress();
    };
  }

  function paintProgress() {
    var b = body();
    if (!b || !S || S.screen !== "progress" || S.runner !== "phone") return;
    var c = S.progressCounts;
    var lead = b.querySelector("#smd-connect-phase"); if (lead) lead.textContent = phaseLabel(S.guide ? "ASKING" : c.phase);
    var detail = b.querySelector("#smd-connect-detail"); if (detail) { detail.innerHTML = progressDetail(); wireGuideSkip(b); }
    var retry = b.querySelector("#smd-connect-progretry"); if (retry) retry.style.display = S.progressFailed ? "" : "none";
  }

  /* ---- Fallback (no plugin): server-driven job-state polling, unchanged. ---- */
  function stageList(st) {
    var order = ["AUTHENTICATED", "DISCOVERING", "COMPILING", "VALIDATING", "AWAITING_APPROVAL", "ACTIVE"];
    var idx = order.indexOf(st);
    var failed = (st === "FAILED" || st === "NEEDS_REPAIR");
    var out = "";
    for (var i = 0; i < STAGES.length; i++) {
      var cls = "";
      if (!failed && (i < idx || st === "ACTIVE")) cls = "ok";
      else if (!failed && (i === idx || (idx < 0 && i === 0))) cls = "on";
      else if (failed && i === 0) cls = "ok";
      out += '<li class="' + cls + '"><span class="smd-connect-dot"></span><span>' + STAGES[i][1] + '</span></li>';
    }
    return out;
  }

  function renderProgressFallback(b) {
    var st = S.jobState || "CREATED";
    var head, lead;
    if (S.reuse) {
      head = "Reconnecting";
      lead = "Checking compatibility with the existing connection. Discovery is skipped.";
    } else {
      head = "Connecting";
      lead = "The agent is working. This can take a minute.";
    }
    var html = '<h2 class="smd-connect-display">' + head + '</h2>' +
      '<p class="smd-connect-lead">' + lead + '</p>';
    if (!S.reuse) {
      html += '<ol class="smd-connect-stages">' + stageList(st) + '</ol>';
    }
    html += '<div class="smd-connect-row">' +
      '<button id="smd-connect-retry" class="smd-connect-btn primary" type="button" style="display:none">Try again</button>' +
      '<button id="smd-connect-reauth" class="smd-connect-btn primary" type="button" style="display:none">Sign in again</button>' +
      '<button id="smd-connect-startover" class="smd-connect-btn" type="button" style="display:none">Start over</button>' +
      '<button id="smd-connect-cancel2" class="smd-connect-btn danger" type="button">Cancel connection</button></div>';
    b.innerHTML = html;
    b.querySelector("#smd-connect-cancel2").onclick = cancelSession;
    b.querySelector("#smd-connect-retry").onclick = doHandoff;
    b.querySelector("#smd-connect-reauth").onclick = function () {
      stopPoll();
      S.loginOpened = false;
      S.loginHandled = false;
      show("login");
    };
    b.querySelector("#smd-connect-startover").onclick = function () {
      stopPoll();
      resetToConnections("");
    };
    paintJobState();
  }

  function paintJobState() {
    var b = body();
    if (!b || !S) return;
    var st = S.jobState || "CREATED";
    var copy = STATE_COPY[st] || ["Working.", ""];
    var extra = "";
    if ((st === "FAILED" || st === "NEEDS_REPAIR") && S.jobError) extra = " Reason: " + S.jobError;
    if (st === "AWAITING_APPROVAL" && S.jobDetail) extra = " " + S.jobDetail;
    setStatus(copy[1], copy[0] + extra);
    if (!S.reuse) {
      var ol = b.querySelector(".smd-connect-stages");
      if (ol) ol.innerHTML = stageList(st);
    }
    var retry = b.querySelector("#smd-connect-retry");
    var reauth = b.querySelector("#smd-connect-reauth");
    var over = b.querySelector("#smd-connect-startover");
    if (retry) retry.style.display = (st === "FAILED" || st === "NEEDS_REPAIR") ? "" : "none";
    if (reauth) reauth.style.display = (st === "NEEDS_REAUTH") ? "" : "none";
    if (over) over.style.display = (st === "FAILED" || st === "NEEDS_REPAIR" || st === "NEEDS_REAUTH" || st === "CANCELLED" || st === "EXPIRED" || st === "REVOKED") ? "" : "none";
  }

  function fetchStatus() {
    if (!S || !S.session) return;
    api("/sessions/" + enc(S.session.id), {}).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok) {
        S.jobState = r.d.state || "CREATED";
        S.jobError = r.d.errorDetail || r.d.errorCode || null;
        S.jobDetail = r.d.stageDetail || null;
        if (r.d.hospitalName && S.selected) S.selected.name = r.d.hospitalName;
        if (r.d.adapterVersion && S.selected) S.selected.adapterVersion = r.d.adapterVersion;
        if (S.jobState === "ACTIVE") {
          stopPoll();
          show("done");
          return;
        }
        if (S.jobState === "NEEDS_REAUTH" || S.jobState === "AWAITING_LOGIN" ||
            S.jobState === "FAILED" || S.jobState === "NEEDS_REPAIR" ||
            S.jobState === "CANCELLED" || S.jobState === "EXPIRED" || S.jobState === "REVOKED") {
          stopPoll();
          if (S.screen === "progress" && S.jobState === "AWAITING_LOGIN") { paintJobState(); return; }
        }
        if (S.screen === "progress") paintJobState();
      } else if (r.s === 404) {
        stopPoll();
        if (S.screen === "progress") setStatus("bad", "Connections are not enabled yet. Try again later.");
      } else {
        if (S.screen === "progress") setStatus("bad", "Status update failed. Checking again shortly.");
      }
    });
  }

  function startPoll() {
    stopPoll();
    S.pollTimer = setInterval(function () {
      if (!overlay() || !S || S.screen !== "progress") { stopPoll(); return; }
      fetchStatus();
    }, POLL_MS);
  }

  /* ---- Screen 7: result (capabilities + reviewer approval) ---- */
  function loadVersionAndShowResult() {
    show("result");
    S.canApprove = true; /* optimistic; server enforces on approve/reject, see below */
    if (!S.versionId) { paintResult(); return; }
    api("/versions/" + enc(S.versionId), {}).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok !== false) {
        S.result.capabilities = r.d.capabilities || S.result.capabilities;
        S.result.state = r.d.state;
      }
      if (S.screen === "result") paintResult();
    });
  }

  function renderResult() {
    var b = body();
    if (!b) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">What the agent can read</h2>' +
      '<p class="smd-connect-lead">Proven at ' + esc(hostOf((S.selected && S.selected.emrUrl) || "")) + '.</p>' +
      '<ul id="smd-connect-caps" class="smd-connect-caps"></ul>' +
      '<div class="smd-connect-note">Awaiting approval. A StewardMD reviewer approves before other doctors can use this.</div>' +
      '<div id="smd-connect-approverow" class="smd-connect-row" style="display:none">' +
      '<button id="smd-connect-approve" class="smd-connect-btn primary" type="button">Approve</button>' +
      '<button id="smd-connect-reject" class="smd-connect-btn danger" type="button">Reject</button></div>' +
      '<div class="smd-connect-row"><button id="smd-connect-resultdone" class="smd-connect-btn" type="button">Done</button></div>';
    setStatus("warn", "Awaiting approval.");
    b.querySelector("#smd-connect-resultdone").onclick = function () { resetToConnections(""); };
    b.querySelector("#smd-connect-approve").onclick = function () {
      api("/versions/" + enc(S.versionId) + "/approve", { method: "POST", body: "{}" }).then(function (r) {
        if (!overlay() || !S) return;
        if (r.s === 200 && r.d && r.d.ok !== false) {
          show("done");
        } else if (r.s === 403) {
          S.canApprove = false;
          paintResult();
          toast("You do not have permission to approve connections.");
        } else {
          setStatus("bad", "Could not approve. Try again.");
        }
      });
    };
    b.querySelector("#smd-connect-reject").onclick = function () {
      if (!window.confirm("Reject this connection? The draft will be discarded.")) return;
      api("/versions/" + enc(S.versionId) + "/reject", { method: "POST", body: JSON.stringify({}) }).then(function (r) {
        if (!overlay() || !S) return;
        if (r.s === 200 && r.d && r.d.ok !== false) {
          resetToConnections("Connection rejected.");
        } else if (r.s === 403) {
          S.canApprove = false;
          paintResult();
          toast("You do not have permission to reject connections.");
        } else {
          setStatus("bad", "Could not reject. Try again.");
        }
      });
    };
    paintResult();
  }

  function paintResult() {
    var b = body();
    if (!b || !S || !S.result) return;
    var caps = S.result.capabilities || [];
    var byResource = {};
    for (var i = 0; i < caps.length; i++) { if (caps[i] && caps[i].resource) byResource[caps[i].resource] = caps[i]; }
    var html = "";
    for (var j = 0; j < CAP_ORDER.length; j++) {
      var key = CAP_ORDER[j];
      var c = byResource[key];
      var proven = !!(c && c.proven);
      html += '<li class="' + (proven ? "" : "smd-connect-note") + '">' +
        (proven ? "✓ " : "") + esc(CAP_LABELS[key]) + (proven ? "" : " (not found at this hospital)") + '</li>';
    }
    var list = b.querySelector("#smd-connect-caps");
    if (list) list.innerHTML = html;
    var row = b.querySelector("#smd-connect-approverow");
    if (row) row.style.display = S.canApprove ? "" : "none";
  }

  /* ---- Screen 8: connected ---- */
  function renderDone() {
    var b = body();
    if (!b) return;
    var name = hostOf((S.selected && S.selected.emrUrl) || "");
    var msg = S.reuse ? "Signed in. You can use this connection now." : "Approved. This connection is now active.";
    b.innerHTML =
      '<h2 class="smd-connect-display">Connected</h2>' +
      '<p class="smd-connect-lead">' + esc(name) + '. ' + msg + '</p>' +
      '<div class="smd-connect-row"><button id="smd-connect-donebtn" class="smd-connect-btn primary" type="button">Done</button></div>';
    setStatus("done", "Connection active.");
    b.querySelector("#smd-connect-donebtn").onclick = function () { close(); };
  }

  function open() {
    injectCSS();
    if (overlay()) close(true);
    S = {
      tenant: storedTenant(), tenants: null,
      screen: "connections",
      connections: [],
      connLoading: true,
      connError: false,
      emrUrl: "",
      selected: null,
      runner: hasPlugin() ? "phone" : null,
      session: null,
      deployment: null,
      reuse: false,
      visitedOrigins: [],
      pendingOrigins: [],
      loginOpened: false,
      loginHandled: false,
      pluginListeners: [],
      progressCounts: { pages: 0, requests: 0, phase: "DISCOVERING" },
      progressFailed: false,
      result: null,
      versionId: null,
      canApprove: false,
      jobState: null,
      jobError: null,
      jobDetail: null,
      viewerUrl: null,
      controlOwner: "agent",
      statusKind: "",
      statusText: "",
      pollTimer: null,
      anim: null,
      animY: 0
    };
    var ov = document.createElement("div");
    ov.id = "smd-connect-ov";
    ov.className = "smd-connect-ov";
    ov.setAttribute("data-motion", reducedMotion() ? "fade" : "spring");
    ov.innerHTML =
      '<section class="smd-connect-sheet" role="dialog" aria-modal="true" aria-labelledby="smd-connect-title">' +
      '<div class="smd-connect-bar" id="smd-connect-bar"><span class="smd-connect-grip" aria-hidden="true"></span>' +
      '<div><div class="smd-connect-title" id="smd-connect-title">Connect Hospital</div>' +
      '<div class="smd-connect-sub">Sign in yourself. StewardMD reads only.</div></div>' +
      '<button class="smd-connect-x" type="button" aria-label="Close">×</button></div>' +
      '<div class="smd-connect-body" id="smd-connect-body"></div>' +
      '<div style="padding:0 1.125rem calc(1rem + env(safe-area-inset-bottom))"><div id="smd-connect-status" class="smd-connect-status" role="status" aria-live="polite"></div></div>' +
      '</section>';
    document.body.appendChild(ov);
    ov.querySelector(".smd-connect-x").onclick = function () { close(); };
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey, true);
    bindDrag(ov.querySelector("#smd-connect-bar"));
    show("connections");
    anchorToLauncher();
    animateOpen();
    pickTenantThenLoad();
  }

  window.SMD_CONNECT_AGENT = {
    open: open,
    close: function () { close(); },
    refresh: refresh,
    __setApi: function (fn) { apiImpl = fn; },
    __debug: function () {
      if (!S) return { open: !!overlay() };
      return {
        open: !!overlay(),
        screen: S.screen,
        runner: S.runner,
        sessionId: S.session && S.session.id,
        reuse: S.reuse,
        pendingOrigins: S.pendingOrigins,
        visitedOrigins: S.visitedOrigins,
        jobState: S.jobState,
        statusKind: S.statusKind,
        statusText: S.statusText,
        controlOwner: S.controlOwner,
        connectionCount: S.connections.length,
        canApprove: S.canApprove
      };
    }
  };
})();
