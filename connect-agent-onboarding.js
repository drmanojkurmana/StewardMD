/* StewardMD Connect Agent onboarding and session UI.
 *
 * Doctor-facing replacement for the old read-only test console. Flow:
 * hospital picker -> explicit consent -> embedded sign in viewport ->
 * live job progress -> success, plus a returning-doctor reconnect path.
 *
 * Buildless ES5 IIFE. Styles ship as an injected <style> block (same convention
 * as the console this file replaces). No frameworks, no dependencies.
 *
 * API SEAM: every network call goes through api(path, opts), which resolves
 * {s: <http status>, d: <decoded body>}. Production api() calls fetch() against
 * /api/connect/agent (the broker router owns those routes). Tests replace the
 * transport with window.SMD_CONNECT_AGENT.__setApi(fn); no backend needed.
 *
 * LOGIN VIEWPORT: the iframe src is set from POST /sessions/:id/viewer-token.
 * In production that URL is a broker-issued, actor-bound, short-lived viewer
 * URL (noVNC-style session). It is never the raw EMR address and never carries
 * credentials. Tests point it at a same-origin fixture page.
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

  function toast(m) { try { if (window.toast) window.toast(m); } catch (e) {} }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  /* Transport seam. fn(path, opts) must return a Promise of {s, d}. */
  var apiImpl = function (path, opts) {
    var method = (opts && opts.method) || "GET";
    var body = (opts && opts.body) ? opts.body : null;
    return fetch(AGENT_BASE + path, {
      method: method,
      headers: { "content-type": "application/json" },
      body: body,
      cache: "no-store"
    }).then(function (r) {
      return r.text().then(function (t) {
        var d = null;
        try { d = t ? JSON.parse(t) : null; } catch (e) { d = { ok: false, error: "bad-response" }; }
        return { s: r.status, d: d };
      });
    }).catch(function () { return { s: 0, d: { ok: false, error: "network" } }; });
  };

  function api(path, opts) { return apiImpl(path, opts || {}); }

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
      ".smd-connect-hosp{display:flex;align-items:center;gap:0.75rem;width:100%;box-sizing:border-box;text-align:left;border:1px solid var(--line,#d7dee3);border-radius:0.875rem;padding:0.875rem;background:var(--panel,#fff);color:var(--ink,#14202b);font:600 0.9375rem var(--sans,system-ui);cursor:pointer;margin:0.5rem 0;min-height:3.25rem;letter-spacing:0}",
      ".smd-connect-hosp:active{transform:scale(.98);transition:transform 100ms ease-out}",
      ".smd-connect-hosp small{display:block;font-weight:400;font-size:0.75rem;color:var(--slate-soft,#5a7184);margin-top:0.125rem}",
      ".smd-connect-badge{display:inline-flex;align-items:center;gap:0.375rem;padding:0.4375rem 0.625rem;border-radius:999px;background:var(--teal-soft,#e3f1ee);color:var(--teal,#0e6e63);font-size:0.75rem;font-weight:800;white-space:nowrap}",
      ".smd-connect-badge.new{background:var(--paper,#f6f7f5);color:var(--slate,#2d4356);border:1px solid var(--line,#d7dee3)}",
      ".smd-connect-scope{margin:0.625rem 0 0;padding-left:1.25rem;color:var(--slate,#2d4356);font-size:0.875rem;line-height:1.6;letter-spacing:0}",
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

  /* Per-state clinician copy. Four kinds: status (default), done, warn, bad. */
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
      hospitals: renderHospitals,
      reconnect: renderReconnect,
      consent: renderConsent,
      login: renderLogin,
      progress: renderProgress,
      done: renderDone
    }[screen];
    if (render) render();
  }

  function refresh() {
    if (S) show(S.screen);
  }

  /* ---- Screen 1: hospital picker ---- */
  function renderHospitals() {
    var b = body();
    if (!b) return;
    var items = "";
    for (var i = 0; i < S.hospitals.length; i++) {
      items += hospitalRow(S.hospitals[i]);
    }
    b.innerHTML =
      '<h2 class="smd-connect-display">Choose your hospital</h2>' +
      '<p class="smd-connect-lead">Pick your hospital to begin. Search by name, or enter the hospital EMR address below.</p>' +
      '<div class="smd-connect-card"><label class="smd-connect-label" for="smd-connect-q">Search hospitals</label>' +
      '<div class="smd-connect-row" style="margin-top:0"><input id="smd-connect-q" class="smd-connect-input" type="search" autocomplete="off" placeholder="Hospital name" value="' + esc(S.query) + '"/>' +
      '<button id="smd-connect-search" class="smd-connect-btn primary" type="button">Search</button></div></div>' +
      '<div id="smd-connect-list">' + (items || '<p class="smd-connect-note">No hospitals found. Try another search, or enter the EMR address.</p>') + '</div>' +
      '<div class="smd-connect-card"><label class="smd-connect-label" for="smd-connect-url">Hospital EMR address</label>' +
      '<input id="smd-connect-url" class="smd-connect-input" type="url" inputmode="url" autocomplete="off" placeholder="https://emr.hospital.example"/>' +
      '<div class="smd-connect-row"><button id="smd-connect-urlgo" class="smd-connect-btn" type="button">Continue with this address</button></div>' +
      '<div class="smd-connect-note">Use a hospital-authorized address. Entering an address does not grant access. Access is checked after you sign in. Never enter passwords or patient data here.</div></div>';
    setStatus("", S.listNote || "");

    bindHospitalList(b);
    var q = b.querySelector("#smd-connect-q");
    function doSearch() {
      S.query = q.value;
      setStatus("", "Searching hospitals.");
      var seq = (S.resolveSeq = (S.resolveSeq || 0) + 1);
      api("/hospitals/resolve", { method: "POST", body: JSON.stringify({ query: S.query }) }).then(function (r) {
        if (!overlay() || !S || seq !== S.resolveSeq) return;
        if (r.s === 200 && r.d && r.d.ok && r.d.hospitals) {
          S.hospitals = r.d.hospitals;
          S.listNote = "";
          show("hospitals");
        } else {
          setStatus("bad", "Hospital lookup failed. Check your connection and try again.");
        }
      });
    }
    b.querySelector("#smd-connect-search").onclick = doSearch;
    q.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doSearch(); } };
    q.oninput = function () { filterHospitalList(q.value); };
    b.querySelector("#smd-connect-urlgo").onclick = function () {
      var url = (b.querySelector("#smd-connect-url").value || "").trim();
      if (!/^https:\/\//i.test(url)) {
        setStatus("bad", "Enter an HTTPS EMR address first, for example https://emr.hospital.example.");
        return;
      }
      setStatus("", "Checking this address.");
      var useq = (S.resolveSeq = (S.resolveSeq || 0) + 1);
      api("/hospitals/resolve", { method: "POST", body: JSON.stringify({ emrUrl: url }) }).then(function (r) {
        if (!overlay() || !S || useq !== S.resolveSeq) return;
        // A hospital nobody has onboarded yet is the NORMAL first-time case, not an error: the lookup
        // answering "no deployment of yours matches" (an empty list, or a not-found) is exactly how a
        // brand-new hospital looks, and it must continue to consent. Treating that as a failure
        // dead-ended the primary "enter my hospital's EMR address" path entirely. Only a genuine
        // transport/server fault is an error worth stopping on.
        var notFound = r.s === 404 || (r.s === 200 && r.d && r.d.ok && !(r.d.hospitals && r.d.hospitals.length));
        if (r.s === 200 && r.d && r.d.ok && r.d.hospitals && r.d.hospitals.length) {
          S.hospitals = r.d.hospitals;
          S.listNote = "";
          show("hospitals");
        } else if (notFound) {
          S.selected = { hospitalId: null, name: "New hospital deployment", emrUrl: url, hasActiveAdapter: false };
          show("consent");
        } else {
          setStatus("bad", "Could not reach StewardMD to check this address. Check your connection and try again.");
        }
      });
    };
    var first = b.querySelector("#smd-connect-q");
    if (first && !reducedMotion()) { try { first.focus(); } catch (e) {} }
  }

  function hospitalRow(h) {
    var badge = h.hasActiveAdapter
      ? '<span class="smd-connect-badge">Connected</span>'
      : '<span class="smd-connect-badge new">New</span>';
    return '<button class="smd-connect-hosp" type="button" data-hosp="' + esc(h.hospitalId || "") + '" data-url="' + esc(h.emrUrl || "") + '" data-name="' + esc(h.name || "") + '" data-ver="' + esc(h.adapterVersion || "") + '" data-active="' + (h.hasActiveAdapter ? "1" : "") + '">' +
      '<span style="flex:1"><span>' + esc(h.name || "Unnamed hospital") + '</span>' +
      (h.emrUrl ? '<small>' + esc(h.emrUrl) + '</small>' : '') + '</span>' + badge + '</button>';
  }

  function bindHospitalList(b) {
    var nodes = b.querySelectorAll(".smd-connect-hosp");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].onclick = function () {
        var active = this.getAttribute("data-active") === "1";
        S.selected = {
          hospitalId: this.getAttribute("data-hosp") || null,
          name: this.getAttribute("data-name"),
          emrUrl: this.getAttribute("data-url"),
          adapterVersion: this.getAttribute("data-ver"),
          hasActiveAdapter: active
        };
        show(active ? "reconnect" : "consent");
      };
    }
  }

  function filterHospitalList(q) {
    var b = body();
    if (!b) return;
    q = (q || "").toLowerCase();
    var nodes = b.querySelectorAll(".smd-connect-hosp");
    for (var i = 0; i < nodes.length; i++) {
      var t = (nodes[i].textContent || "").toLowerCase();
      nodes[i].style.display = t.indexOf(q) >= 0 ? "" : "none";
    }
  }

  /* ---- Returning-doctor path: existing adapter, re-authenticate only ---- */
  function renderReconnect() {
    var b = body();
    if (!b || !S.selected) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">Welcome back</h2>' +
      '<p class="smd-connect-lead">' + esc(S.selected.name) + ' already has a validated connection' +
      (S.selected.adapterVersion ? ' (version ' + esc(S.selected.adapterVersion) + ')' : '') +
      '. Sign in again to reuse it. Discovery is skipped.</p>' +
      '<div class="smd-connect-row"><button id="smd-connect-rego" class="smd-connect-btn primary" type="button">Sign in to reconnect</button>' +
      '<button id="smd-connect-back1" class="smd-connect-btn" type="button">Back</button></div>';
    setStatus("", "");
    b.querySelector("#smd-connect-rego").onclick = function () {
      S.reuse = true;
      createSession();
    };
    b.querySelector("#smd-connect-back1").onclick = function () { show("hospitals"); };
  }

  /* ---- Screen 2: explicit consent, no pre-checked boxes ---- */
  function renderConsent() {
    var b = body();
    if (!b || !S.selected) return;
    b.innerHTML =
      '<h2 class="smd-connect-display">How this connection works</h2>' +
      '<p class="smd-connect-lead">Before you sign in, here is exactly what the Connect Agent will do at ' + esc(S.selected.name) + '.</p>' +
      '<div class="smd-connect-card"><ul class="smd-connect-scope">' +
      '<li>Read only. The agent reads the worklist and patient summaries. It cannot order, prescribe, or edit records.</li>' +
      '<li>You sign in yourself. Sign in happens in a hospital sign in frame. StewardMD never asks for your EMR password.</li>' +
      '<li>You stay in control. Pause the agent any time and take over the session.</li>' +
      '</ul>' +
      '<label class="smd-connect-checkrow"><input id="smd-connect-agree" class="smd-connect-check" type="checkbox"/>' +
      '<span>I understand this connection is read only, and I agree to continue.</span></label>' +
      '<div class="smd-connect-row"><button id="smd-connect-consentgo" class="smd-connect-btn primary" type="button" disabled>Agree and continue</button>' +
      '<button id="smd-connect-back2" class="smd-connect-btn" type="button">Back</button></div></div>';
    setStatus("", "");
    var box = b.querySelector("#smd-connect-agree");
    var go = b.querySelector("#smd-connect-consentgo");
    box.onchange = function () { go.disabled = !box.checked; };
    b.querySelector("#smd-connect-back2").onclick = function () { show(S.selected.hasActiveAdapter ? "reconnect" : "hospitals"); };
    go.onclick = function () {
      if (!box.checked) return;
      go.disabled = true;
      setStatus("", "Recording your consent.");
      api("/sessions", {
        method: "POST",
        body: JSON.stringify({
          hospitalId: S.selected.hospitalId,
          emrUrl: S.selected.emrUrl,
          reconnect: !!S.reuse,
          consent: { scope: "read", agreed: true }
        })
      }).then(function (r) {
        if (!overlay()) return;
        if (r.s === 200 && r.d && r.d.ok && r.d.sessionId) {
          S.sessionId = r.d.sessionId;
          S.jobId = r.d.jobId || null;
          S.reuse = !!S.reuse;
          show("login");
          loadViewer();
        } else if (r.s === 404) {
          setStatus("bad", "Connections are not enabled yet. Try again later.");
          go.disabled = false;
        } else {
          setStatus("bad", "Could not start the session. Check your connection and try again.");
          go.disabled = false;
        }
      });
    };
  }

  function createSession() {
    setStatus("", "Starting your session.");
    api("/sessions", {
      method: "POST",
      body: JSON.stringify({
        hospitalId: S.selected.hospitalId,
        emrUrl: S.selected.emrUrl,
        reconnect: true,
        consent: { scope: "read", agreed: true }
      })
    }).then(function (r) {
      if (!overlay()) return;
      if (r.s === 200 && r.d && r.d.ok && r.d.sessionId) {
        S.sessionId = r.d.sessionId;
        S.jobId = r.d.jobId || null;
        show("login");
        loadViewer();
      } else {
        setStatus("bad", "Could not start the session. Check your connection and try again.");
        show("reconnect");
      }
    });
  }

  /* ---- Screen 3: embedded sign in viewport with pause/resume ---- */
  function renderLogin() {
    var b = body();
    if (!b) return;
    var paused = S.controlOwner === "clinician";
    b.innerHTML =
      '<h2 class="smd-connect-display">Sign in to the hospital EMR</h2>' +
      '<p class="smd-connect-lead">Complete sign in in the frame below. The agent is paused and cannot see what you type.</p>' +
      '<iframe id="smd-connect-frame" class="smd-connect-view" title="Hospital sign in" src="about:blank"></iframe>' +
      '<div class="smd-connect-row"><button id="smd-connect-signedin" class="smd-connect-btn primary" type="button">I have signed in</button>' +
      '<button id="smd-connect-pause" class="smd-connect-btn" type="button">' + (paused ? "Resume agent" : "Pause agent") + '</button>' +
      '<button id="smd-connect-cancel" class="smd-connect-btn danger" type="button">Cancel connection</button></div>';
    if (S.viewerUrl) {
      var f = b.querySelector("#smd-connect-frame");
      if (f) f.src = S.viewerUrl;
    }
    setStatus(paused ? "warn" : "", paused ? "Agent paused. You control the session." : (S.statusText || ""));
    b.querySelector("#smd-connect-signedin").onclick = handoff;
    b.querySelector("#smd-connect-pause").onclick = togglePause;
    b.querySelector("#smd-connect-cancel").onclick = cancelSession;
  }

  function loadViewer() {
    if (!S.sessionId) return;
    setStatus("", "Preparing the secure sign in frame.");
    api("/sessions/" + encodeURIComponent(S.sessionId) + "/viewer-token", { method: "POST", body: "{}" }).then(function (r) {
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
    if (!S.sessionId) return;
    var pausing = S.controlOwner !== "clinician";
    var path = "/sessions/" + encodeURIComponent(S.sessionId) + (pausing ? "/pause" : "/resume");
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

  function handoff() {
    if (!S.sessionId) return;
    setStatus("", "Confirming sign in and starting discovery.");
    api("/sessions/" + encodeURIComponent(S.sessionId) + "/handoff", { method: "POST", body: "{}" }).then(function (r) {
      if (!overlay() || !S) return;
      if (r.s === 200 && r.d && r.d.ok) {
        show("progress");
        fetchStatus();
        startPoll();
      } else if (r.s === 404) {
        setStatus("bad", "Connections are not enabled yet. Try again later.");
      } else {
        setStatus("bad", "Sign in was not detected yet. Finish signing in, then try again.");
      }
    });
  }

  function cancelSession() {
    if (!S.sessionId) { show("hospitals"); return; }
    setStatus("", "Cancelling the session.");
    api("/sessions/" + encodeURIComponent(S.sessionId), { method: "DELETE" }).then(function () {
      if (!overlay() || !S) return;
      stopPoll();
      S.sessionId = null;
      S.viewerUrl = null;
      S.controlOwner = "agent";
      show("hospitals");
      setStatus("warn", "Connection cancelled. The session was closed.");
    });
  }

  /* ---- Screen 4: live job progress with honest per-state copy ---- */
  function renderProgress() {
    var b = body();
    if (!b) return;
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
    b.querySelector("#smd-connect-retry").onclick = handoff;
    b.querySelector("#smd-connect-reauth").onclick = function () {
      stopPoll();
      show("login");
      loadViewer();
    };
    b.querySelector("#smd-connect-startover").onclick = function () {
      stopPoll();
      S.sessionId = null;
      S.jobState = null;
      show("hospitals");
    };
    paintJobState();
  }

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
    if (!S || !S.sessionId) return;
    api("/sessions/" + encodeURIComponent(S.sessionId), {}).then(function (r) {
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

  /* ---- Screen 5: success with a path back to the clinical surface ---- */
  function renderDone() {
    var b = body();
    if (!b) return;
    var name = (S.selected && S.selected.name) || "Your hospital";
    b.innerHTML =
      '<h2 class="smd-connect-display">Connection active</h2>' +
      '<p class="smd-connect-lead">' + esc(name) + ' is connected' +
      (S.selected && S.selected.adapterVersion ? ' (version ' + esc(S.selected.adapterVersion) + ')' : '') +
      '. Your worklist now uses this connection.</p>' +
      '<div class="smd-connect-row"><button id="smd-connect-open" class="smd-connect-btn primary" type="button">Open worklist</button>' +
      '<button id="smd-connect-done" class="smd-connect-btn" type="button">Done</button></div>' +
      '<div class="smd-connect-note">Worklist integration lands separately. This button is a placeholder and does not open patient data yet.</div>';
    setStatus("done", "Connection active. You can close this panel.");
    /* Placeholder path back to the clinical surface. connect-source.js
     * integration is deliberately out of scope for this UI. */
    b.querySelector("#smd-connect-open").onclick = function () {
      toast("Worklist integration lands separately. This button is a placeholder.");
      setStatus("done", "Connection active. Worklist integration lands separately.");
    };
    b.querySelector("#smd-connect-done").onclick = function () { close(); };
  }

  function open() {
    injectCSS();
    if (overlay()) close(true);
    S = {
      screen: "hospitals",
      hospitals: [],
      query: "",
      listNote: "Loading hospitals.",
      selected: null,
      sessionId: null,
      jobId: null,
      jobState: null,
      jobError: null,
      jobDetail: null,
      viewerUrl: null,
      controlOwner: "agent",
      reuse: false,
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
      '<div class="smd-connect-sub">Connect Agent onboarding</div></div>' +
      '<button class="smd-connect-x" type="button" aria-label="Close">×</button></div>' +
      '<div class="smd-connect-body" id="smd-connect-body"></div>' +
      '<div style="padding:0 1.125rem calc(1rem + env(safe-area-inset-bottom))"><div id="smd-connect-status" class="smd-connect-status" role="status" aria-live="polite"></div></div>' +
      '</section>';
    document.body.appendChild(ov);
    ov.querySelector(".smd-connect-x").onclick = function () { close(); };
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.addEventListener("keydown", onKey, true);
    bindDrag(ov.querySelector("#smd-connect-bar"));
    show("hospitals");
    anchorToLauncher();
    animateOpen();
    /* Initial hospital list. A real backend router may not exist yet; the
     * mocked api() seam in tests answers this call. */
    var iseq = (S.resolveSeq = (S.resolveSeq || 0) + 1);
    api("/hospitals/resolve", { method: "POST", body: JSON.stringify({ query: "" }) }).then(function (r) {
      if (!overlay() || !S || iseq !== S.resolveSeq) return;
      if (r.s === 200 && r.d && r.d.ok && r.d.hospitals) {
        S.hospitals = r.d.hospitals;
        S.listNote = "";
        if (S.screen === "hospitals") show("hospitals");
      } else {
        S.listNote = "Hospital list is unavailable. You can still enter an EMR address below.";
        if (S.screen === "hospitals") show("hospitals");
      }
    });
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
        sessionId: S.sessionId,
        jobState: S.jobState,
        statusKind: S.statusKind,
        statusText: S.statusText,
        controlOwner: S.controlOwner,
        reuse: S.reuse,
        hospitalCount: S.hospitals.length
      };
    }
  };
})();
