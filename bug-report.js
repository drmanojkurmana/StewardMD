/* bug-report.js - Help & Support: shake to report a bug, questions, feedback, one live chat centre.
 * (2026-09-27: the Bug Report Centre, "Help & support" and "Send Feedback" became ONE centre,
 *  window.SMD_HELP / SMD_BUGS; see the "Help & Support centre" section below.)
 * ============================================================================================
 * Owner request 2026-09-26: "shake the iphone to report a bug feature where bugs are directly save
 * in our server where user can point out the button or screen whatever and write what is the
 * problem. and save it promise user to will be solved in 24hrs and give a bug report centre in side
 * bar for all bugs reported and reply from developer to user."
 *
 * Flow: shake -> the screen is captured (html2canvas, lazy) BEFORE any sheet appears -> "Point at
 * the problem" (tap the button or area; it is outlined on the screenshot) or "Whole screen" ->
 * "What went wrong?" -> sent to /api/support {action:"bug"} as a ticket of kind "bug" with a fix
 * promised within 24 hours -> Help & Support (sidebar) lists every conversation with its status,
 * the time left, and the developer's replies; the doctor can answer back. Replies from the owner
 * arrive as a push (admin console, Support pane).
 *
 * iOS: motion events need DeviceMotionEvent.requestPermission() from a TAP. The Centre has a
 * "Shake to report" switch that asks; once granted, the permission is re-asked silently on the first
 * tap of each app open (iOS may not keep it across launches in a WKWebView). Android needs nothing.
 * The Centre's "Report a bug" button does the same flow without a shake (web, desktop, no sensor).
 *
 * PRIVACY: a screenshot can show a patient. The doctor sees it before sending and can leave it out;
 * the server keeps it 30 days at most and drops it when the bug is resolved. No PHI in the push.
 *
 * Settings: localStorage smd_shake_report ("0" = off; default on). Exposes window.SMD_BUGS =
 * { report, openCentre, closeCentre, unread, refresh, enableShake, _shake(test), _detector }.
 * Inline SVG only, no emoji. Light and dark.
 * ============================================================================================ */
(function () {
  "use strict";

  var SHAKE_KEY = "smd_shake_report", PERM_KEY = "smd_shake_perm", OUTBOX = "smd_bug_outbox";
  var R = "bugrRoot", C = "bugcRoot";

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function toast(m) { try { (window.toast || window.SMD_toast || function () {})(m); } catch (e) {} }
  function user() { try { return (window.SMD_AUTH && SMD_AUTH.currentUser) || null; } catch (e) { return null; } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function shakeOn() { return lsGet(SHAKE_KEY) !== "0"; }
  function platform() { try { var c = window.Capacitor; return (c && (c.getPlatform ? c.getPlatform() : c.platform)) || "web"; } catch (e) { return "web"; } }
  function build() { try { return (window.SMD_OTA && SMD_OTA.versionLabel && SMD_OTA.versionLabel()) || ""; } catch (e) { return ""; } }

  /* A request that got no answer at all (fetch or the token refresh rejected). Offline only when the
   * phone says so; a server or token problem on a good connection must not send the doctor to check
   * their Wi-Fi (owner, 2026-09-28; same fix as the profile sheet on 09-26). */
  function failText(e) {
    try { if (navigator.onLine === false) return "You are offline. Try again once you are connected."; } catch (x) {}
    return "Couldn't reach StewardMD. Check your connection and try again.";
  }
  function api(method, path, body, signal) {
    var u = user();
    if (!u || typeof u.getIdToken !== "function") return Promise.resolve({ ok: false, error: "sign-in-required", status: 401 });
    return u.getIdToken().then(function (tok) {
      var o = { method: method, headers: { "Authorization": "Bearer " + tok } };
      if (signal) o.signal = signal;
      if (body) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(body); }
      return fetch("/api/support" + (path || ""), o);
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: "bad-response" }; }).then(function (j) { j.status = r.status; return j; }); });
  }

  /* ── shake detection ──────────────────────────────────────────────────────────────────────── */
  /* Pure and testable: feed it accelerationIncludingGravity samples; it fires when the change in
   * acceleration crosses THRESHOLD three times within WINDOW ms (a deliberate shake, not a bump or
   * a phone put down on a desk), then stays quiet for COOLDOWN ms. */
  var THRESHOLD = 14, WINDOW = 1000, COOLDOWN = 4000;
  function detector(onShake) {
    var last = null, peaks = [], quietUntil = 0;
    return function sample(x, y, z, t) {
      if (x == null || y == null || z == null) return false;
      if (last) {
        var d = Math.abs(x - last.x) + Math.abs(y - last.y) + Math.abs(z - last.z);
        if (d > THRESHOLD && t >= quietUntil) {
          if (!peaks.length || t - peaks[peaks.length - 1] > 90) peaks.push(t);   // one peak per swing
          while (peaks.length && t - peaks[0] > WINDOW) peaks.shift();
          if (peaks.length >= 3) { peaks = []; quietUntil = t + COOLDOWN; last = { x: x, y: y, z: z }; onShake(); return true; }
        }
      }
      last = { x: x, y: y, z: z };
      return false;
    };
  }
  var _sample = detector(function () { onShake(); });
  var _listening = false;
  function listen() {
    if (_listening) return;
    _listening = true;
    window.addEventListener("devicemotion", function (e) {
      var a = e && (e.accelerationIncludingGravity || e.acceleration);
      if (!a) return;
      _sample(a.x, a.y, a.z, Date.now());
    }, false);
  }
  function needsPermission() { try { return typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"; } catch (e) { return false; } }
  // Must run inside a tap on iOS. -> Promise<boolean>
  function enableShake() {
    lsSet(SHAKE_KEY, "1");
    if (!needsPermission()) { listen(); return Promise.resolve(true); }
    return DeviceMotionEvent.requestPermission().then(function (r) {
      var ok = r === "granted"; lsSet(PERM_KEY, ok ? "granted" : "denied");
      if (ok) listen();
      return ok;
    }, function () { return false; });
  }
  function bootShake() {
    if (!shakeOn()) return;
    if (!needsPermission()) { listen(); return; }
    // iOS: re-ask silently on the first tap of this app open, but only if the doctor said yes before.
    if (lsGet(PERM_KEY) !== "granted") return;
    var once = function () { document.removeEventListener("touchend", once, true); document.removeEventListener("click", once, true); enableShake(); };
    document.addEventListener("touchend", once, true); document.addEventListener("click", once, true);
  }

  /* ── capture ─────────────────────────────────────────────────────────────────────────────── */
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    var lazy = window.smdLazy || function (src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); };
    return lazy("/vendor-html2canvas.js?v=1").then(function () { if (!window.html2canvas) throw new Error("no-h2c"); return window.html2canvas; });
  }
  // JPEG has no transparency: a transparent capture encodes as black. Paint the page colour under it.
  function pageBg() {
    try {
      var c = getComputedStyle(document.body).backgroundColor;
      if (!c || c === "transparent" || /rgba\(0, 0, 0, 0\)/.test(c)) c = getComputedStyle(document.documentElement).backgroundColor;
      if (!c || c === "transparent" || /rgba\(0, 0, 0, 0\)/.test(c)) c = (document.body.classList.contains("dark") ? "#0e141c" : "#ffffff");
      return c;
    } catch (e) { return "#ffffff"; }
  }
  // The screen in the page's OWN css px. With the Display zoom on (documentElement.style.zoom),
  // innerWidth is not the width the page lays out in; a fixed inset:0 box is, on every engine.
  function layoutViewport() {
    try {
      var p = document.createElement("div");
      p.style.cssText = "position:fixed;left:0;top:0;right:0;bottom:0;visibility:hidden;pointer-events:none";
      document.body.appendChild(p);
      var v = { w: p.clientWidth || window.innerWidth, h: p.clientHeight || window.innerHeight };
      p.remove();
      return v;
    } catch (e) { return { w: window.innerWidth, h: window.innerHeight }; }
  }
  // The visible viewport at half resolution, as a canvas. Never rejects (null when it cannot).
  function capture() {
    return loadH2C().then(function (h2c) {
      var v = layoutViewport(), w = v.w, h = v.h;
      if (st) st.vw = w;   // the screenshot's width in page px, for placing the outline on it
      return h2c(document.body, { x: window.scrollX, y: window.scrollY, width: w, height: h, windowWidth: w, windowHeight: h,
        scale: Math.min(1, 720 / Math.max(1, w)), backgroundColor: pageBg(), logging: false, useCORS: true,
        ignoreElements: function (el) { return el && (el.id === R || el.id === C || el.id === "bugrPick"); },
        // Owner's iPhone, 2026-09-27: the screenshot arrived BLANK. body is overflow:hidden with zero
        // height here (every screen is a fixed layer), and html2canvas clips to body's box, so it drew
        // nothing. Lift the clip on the CLONE only; the live page is untouched.
        onclone: function (d) { try { d.body.style.overflow = "visible"; d.body.style.height = h + "px"; d.documentElement.style.overflow = "visible"; } catch (e) {} } });
    }).catch(function () { return null; });
  }
  // The screenshot as JPEG, with the pointed-at element outlined in red.
  function shotData(canvas, rect) {
    if (!canvas) return "";
    try {
      var out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height;
      var g = out.getContext("2d"); g.fillStyle = pageBg(); g.fillRect(0, 0, out.width, out.height); g.drawImage(canvas, 0, 0);
      if (rect) {
        var k = canvas.width / Math.max(1, (st && st.vw) || window.innerWidth);
        g.strokeStyle = "#e5484d"; g.lineWidth = Math.max(3, 4 * k);
        g.strokeRect(rect.x * k - 4, rect.y * k - 4, rect.w * k + 8, rect.h * k + 8);
      }
      var q = 0.6, d = out.toDataURL("image/jpeg", q);
      while (d.length > 880 * 1024 && q > 0.25) { q -= 0.12; d = out.toDataURL("image/jpeg", q); }
      return d.length > 880 * 1024 ? "" : d;
    } catch (e) { return ""; }
  }

  /* ── describing the pointed element ──────────────────────────────────────────────────────── */
  // The smallest control under the finger; a plain area is reported as itself.
  function target(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    return (el.closest && el.closest("button,a,[role=button],[role=tab],[role=switch],input,select,textarea,label,[data-act],[data-sbr-act]")) || el;
  }
  function safeText(t) {
    try {
      if (t.hasAttribute && t.hasAttribute("data-phi-input")) return "";
      var c = t.cloneNode(true);
      [].forEach.call(c.querySelectorAll ? c.querySelectorAll("[data-phi]") : [], function (e) { e.textContent = e.getAttribute("data-phi") || ""; });
      var txt = (c.textContent || "").trim().replace(/\s+/g, " ");
      return txt || (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ? "" : String(t.value || "").trim());
    } catch (e) { return ""; }
  }
  function describe(el) {
    var t = target(el);
    if (!t) return null;
    var r = t.getBoundingClientRect();
    var sel = [], n = t;
    for (var i = 0; n && n.nodeType === 1 && i < 4; i++) {
      var s = n.tagName.toLowerCase();
      if (n.id) { sel.unshift(s + "#" + n.id); break; }
      var cls = (typeof n.className === "string" ? n.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      var act = n.getAttribute && (n.getAttribute("data-act") || n.getAttribute("data-sbr-act"));
      sel.unshift(s + (cls ? "." + cls : "") + (act ? '[data-act="' + act + '"]' : ""));
      n = n.parentElement;
    }
    // No patient identifier may reach a report (repo rule: no PHI in logs), whatever privacy mode is
    // set to: use the privacy-mode masks (data-phi-* label copies, [data-phi] spans) and never an
    // identifier input's value. Identifiers on screens privacy mode does not cover can still appear.
    var label = (t.getAttribute && (t.getAttribute("data-phi-aria-label") || t.getAttribute("aria-label") ||
      t.getAttribute("data-phi-title") || t.getAttribute("title"))) || safeText(t);
    label = String(label || "");
    if (label.length > 60) label = label.slice(0, 57).replace(/\s+\S*$/, "") + "...";
    return { tag: t.tagName.toLowerCase(), sel: sel.join(" > ").slice(0, 300), label: label,
             rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
  }
  function route() {
    try {
      var open = [].slice.call(document.querySelectorAll(".modal.on,.sheet.on,[role=dialog].on,.overlay.on")).map(function (e) { return e.id || e.className.split(" ")[0]; }).filter(Boolean).slice(0, 3);
      return (location.hash || "#home") + (open.length ? " | " + open.join(",") : "");
    } catch (e) { return location.hash || ""; }
  }

  /* ── look ────────────────────────────────────────────────────────────────────────────────── */
  var ICO = {
    bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M12 20v-9M8 11H4M16 11h4M8 16H5M16 16h3M9 6.5 7 4M15 6.5 17 4M10 6a2 2 0 0 1 4 0"/></svg>',
    point: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11M12 10V4.5a1.5 1.5 0 0 1 3 0V11M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.9-2.6L3.5 14a1.5 1.5 0 0 1 2.4-1.8L9 15"/></svg>',
    screen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M8.5 11h7M8.5 14h4.5"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
  };
  function styleOnce() {
    if (document.getElementById("bugrCss")) return;
    var st = document.createElement("style"); st.id = "bugrCss";
    var P = "#" + R + ",#" + C + ",#bugrPick";
    st.textContent = [
      P + "{--bg:#ffffff;--ink:#0f172a;--mut:#5b6b7b;--line:rgba(15,23,42,.10);--soft:rgba(15,23,42,.045);--acc:#0e6e63;--acc2:#139a8a;--red:#e5484d;--ok:#1f9d63;--amber:#b7791f;--f:var(--hfont,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif)}",
      "body.dark #" + R + ",body.dark #" + C + ",body.v3-dark #" + R + ",body.v3-dark #" + C + "{--bg:#0e141c;--ink:#eef3f8;--mut:#93a3b4;--line:rgba(255,255,255,.09);--soft:rgba(255,255,255,.055);--acc:#2fc4b0;--acc2:#5ad8c8}",
      "#" + R + "{position:fixed;inset:0;z-index:2147483000;display:none;align-items:flex-end;justify-content:center;background:rgba(8,12,18,.45)}",
      "#" + R + ".on{display:flex}",
      "#" + R + " .bg-card{width:100%;max-width:520px;max-height:calc(100% - 44px);display:flex;flex-direction:column;background:var(--bg);color:var(--ink);border-radius:26px 26px 0 0;overflow:hidden;animation:bugUp .28s cubic-bezier(.2,.9,.3,1) both;font-family:var(--f)}",
      "@keyframes bugUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}",
      "#" + R + " .bg-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 20px 6px;-webkit-overflow-scrolling:touch}",
      "#" + R + " .bg-foot{flex:0 0 auto;padding:12px 20px calc(env(safe-area-inset-bottom,0px) + 14px);border-top:1px solid var(--line);display:flex;flex-direction:column;gap:8px}",
      "#" + R + " .bg-grab{width:38px;height:5px;border-radius:3px;background:var(--line);margin:0 auto 12px}",
      "#" + R + " .bg-mark{width:44px;height:44px;border-radius:14px;background:linear-gradient(140deg,var(--acc),var(--acc2));color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:12px}",
      "#" + R + " .bg-mark svg{width:23px;height:23px}",
      "#" + R + " .bg-t{font:800 22px/1.2 var(--f);letter-spacing:-.02em;margin:0 0 6px}",
      "#" + R + " .bg-s{font:500 14px/1.5 var(--f);color:var(--mut);margin:0 0 14px}",
      "#" + R + " .bg-s b{color:var(--ink)}",
      "#" + R + " .bg-opt{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:14px;border-radius:16px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:700 15px var(--f);margin-bottom:10px;cursor:pointer}",
      "#" + R + " .bg-opt svg{width:22px;height:22px;color:var(--acc);flex:0 0 auto}",
      "#" + R + " .bg-opt small{display:block;font:500 12.5px/1.4 var(--f);color:var(--mut);margin-top:2px}",
      "#" + R + " textarea{width:100%;box-sizing:border-box;min-height:110px;border-radius:14px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:500 15px/1.45 var(--f);padding:12px;resize:vertical}",
      "#" + R + " .bg-thumb{display:flex;gap:12px;align-items:flex-start;margin:12px 0 4px}",
      "#" + R + " .bg-thumb img{width:84px;border-radius:10px;border:1px solid var(--line)}",
      "#" + R + " .bg-thumb label{font:600 13.5px/1.4 var(--f);display:flex;gap:8px;align-items:flex-start}",
      "#" + R + " .bg-thumb small{display:block;font:500 12px/1.4 var(--f);color:var(--mut);margin-top:4px}",
      "#" + R + " .bg-el{font:600 12.5px/1.4 var(--f);color:var(--mut);margin:0 0 10px;padding:8px 10px;border-radius:10px;background:var(--soft)}",
      "#" + R + " .bg-err{color:var(--red);font:600 13px var(--f);min-height:0}",
      "#" + R + " .bg-btn{width:100%;min-height:50px;border:0;border-radius:15px;background:linear-gradient(140deg,var(--acc),var(--acc2));color:#fff;font:800 16px var(--f);cursor:pointer}",
      "#" + R + " .bg-btn[disabled]{opacity:.55}",
      "#" + R + " .bg-alt{width:100%;min-height:44px;border:0;background:none;color:var(--acc);font:700 14.5px var(--f);cursor:pointer}",
      "#" + R + " .bg-sla{display:flex;gap:10px;align-items:center;padding:12px;border-radius:14px;background:var(--soft);font:600 13.5px/1.45 var(--f);margin:6px 0 4px}",
      "#" + R + " .bg-sla svg{width:20px;height:20px;color:var(--acc);flex:0 0 auto}",
      "#bugrPick{position:fixed;inset:0;z-index:2147483001;cursor:crosshair;background:rgba(229,72,77,.04)}",
      "#bugrPick .bp-bar{position:fixed;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 14px);background:#0f172a;color:#fff;border-radius:16px;padding:12px 14px;font:700 14px/1.4 var(--f);display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.35)}",
      "#bugrPick .bp-bar span{flex:1}",
      "#bugrPick .bp-bar button{border:0;border-radius:11px;padding:9px 12px;font:800 13.5px var(--f);cursor:pointer}",
      "#bugrPick .bp-use{background:#2fc4b0;color:#06201c}#bugrPick .bp-cancel{background:rgba(255,255,255,.12);color:#fff}",
      "#bugrPick .bp-box{position:absolute;border:3px solid #e5484d;border-radius:8px;box-shadow:0 0 0 9999px rgba(8,12,18,.35);pointer-events:none;transition:all .12s}",
      "#" + C + "{position:fixed;inset:0;z-index:2147482990;display:none;flex-direction:column;background:var(--bg);color:var(--ink);font-family:var(--f)}",
      "#" + C + ".on{display:flex}",
      "#" + C + " .bc-head{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;border-bottom:1px solid var(--line);background:var(--bg)}",
      "#" + C + " .bc-ttl{flex:1;min-width:0}#" + C + " .bc-ttl b{display:block;font:800 18px/1.2 var(--f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#" + C + " .bc-ttl small{display:block;margin-top:3px;font:600 12px var(--f);color:var(--mut)}",
      "#" + C + " .bc-ic{width:40px;height:40px;border:0;border-radius:12px;background:var(--soft);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}",
      "#" + C + " .bc-ic svg{width:20px;height:20px}",
      "#" + C + " .bc-body{flex:1;overflow-y:auto;padding:16px 16px calc(env(safe-area-inset-bottom,0px) + 20px);-webkit-overflow-scrolling:touch;overscroll-behavior:contain}",
      "#" + C + " .bc-body.chat{padding-bottom:12px;background:var(--soft)}",
      "#" + C + " .hs-hero{padding:6px 2px 16px}",
      "#" + C + " .hs-hi{font:700 15px var(--f);color:var(--mut)}#" + C + " .hs-q{font:800 26px/1.15 var(--f);letter-spacing:-.02em;margin:2px 0 10px}",
      "#" + C + " .hs-team{display:flex;gap:8px;align-items:flex-start;font:500 13px/1.45 var(--f);color:var(--mut)}",
      "#" + C + " .hs-live{width:9px;height:9px;border-radius:50%;background:var(--ok);flex:0 0 auto;margin-top:4px;box-shadow:0 0 0 3px rgba(31,157,99,.18)}",
      "#" + C + " .hs-acts{display:flex;flex-direction:column;gap:10px;margin-bottom:22px}",
      "#" + C + " .hs-act{display:flex;align-items:center;gap:14px;width:100%;text-align:left;padding:15px;border-radius:18px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.05)}",
      "#" + C + " .hs-act svg{width:24px;height:24px;color:#fff;background:linear-gradient(140deg,var(--acc),var(--acc2));padding:9px;border-radius:13px;flex:0 0 auto;box-sizing:content-box}",
      "#" + C + " .hs-act b{display:block;font:800 15.5px var(--f)}#" + C + " .hs-act small{display:block;font:500 12.5px/1.4 var(--f);color:var(--mut);margin-top:2px}",
      "#" + C + " .hs-sec{font:800 12px var(--f);letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin:0 2px 6px}",
      "#" + C + " .bc-row{display:flex;gap:12px;align-items:flex-start;padding:13px 4px;border-bottom:1px solid var(--line);cursor:pointer}",
      "#" + C + " .bc-kic{width:36px;height:36px;border-radius:12px;background:var(--soft);display:flex;align-items:center;justify-content:center;flex:0 0 auto;color:var(--acc)}",
      "#" + C + " .bc-kic svg{width:19px;height:19px}#" + C + " .bc-kic.k-bug{color:var(--red)}#" + C + " .bc-kic.k-feedback{color:var(--amber)}",
      "#" + C + " .bc-row .m{flex:1;min-width:0}",
      "#" + C + " .bc-row .r1{display:flex;gap:8px;align-items:baseline}#" + C + " .bc-row .r1 b{flex:1;min-width:0;font:700 14.5px/1.35 var(--f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#" + C + " .bc-row time{font:600 11.5px var(--f);color:var(--mut);flex:0 0 auto}",
      "#" + C + " .bc-row .r2{display:flex;gap:8px;align-items:center;margin-top:3px}#" + C + " .bc-row .pv{flex:1;min-width:0;font:500 13px/1.4 var(--f);color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#" + C + " .bc-row.unread .pv{color:var(--ink);font-weight:700}#" + C + " .bc-row.unread .r1 b{font-weight:800}",
      "#" + C + " .bc-row .r3{display:flex;gap:6px;align-items:center;margin-top:6px}#" + C + " .chip{font:800 10.5px var(--f);text-transform:uppercase;letter-spacing:.04em;color:var(--mut);background:var(--soft);padding:4px 7px;border-radius:7px}",
      "#" + C + " .bc-dot{width:10px;height:10px;border-radius:50%;background:var(--acc);flex:0 0 auto}",
      "#" + C + " .bc-pill{font:800 11.5px var(--f);padding:4px 8px;border-radius:999px;background:var(--soft);color:var(--amber);white-space:nowrap}",
      "#" + C + " .bc-pill.ok{color:var(--ok)}#" + C + " .bc-pill.late{color:var(--red)}",
      "#" + C + " .bc-empty{text-align:center;color:var(--mut);font:500 14px/1.5 var(--f);padding:26px 12px}",
      "#" + C + " .bc-tg{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:var(--soft);margin:20px 0 8px}",
      "#" + C + " .bc-tg div{flex:1;font:700 14px var(--f)}#" + C + " .bc-tg small{display:block;font:500 12.5px var(--f);color:var(--mut);margin-top:2px}",
      "#" + C + " .bc-sw{width:48px;height:28px;border-radius:14px;border:0;background:var(--line);position:relative;cursor:pointer;flex:0 0 auto}",
      "#" + C + " .bc-sw span{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.3)}",
      "#" + C + " .bc-sw.on{background:var(--acc)}#" + C + " .bc-sw.on span{left:23px}",
      "#" + C + " .hs-note{font:500 12px var(--f);color:var(--mut);text-align:center;margin:10px 0 0}",
      "#" + C + " .hs-thread{display:flex;flex-direction:column;gap:6px}",
      "#" + C + " .hs-day{align-self:center;font:700 11.5px var(--f);color:var(--mut);background:var(--bg);padding:4px 10px;border-radius:999px;margin:8px 0 4px}",
      "#" + C + " .hs-b{max-width:82%;padding:9px 12px 6px;border-radius:18px;font:500 15px/1.42 var(--f);box-shadow:0 1px 1px rgba(15,23,42,.06)}",
      "#" + C + " .hs-b.them{align-self:flex-start;background:var(--bg);color:var(--ink);border-bottom-left-radius:6px}",
      "#" + C + " .hs-b.me{align-self:flex-end;background:linear-gradient(140deg,var(--acc),var(--acc2));color:#fff;border-bottom-right-radius:6px}",
      "#" + C + " .hs-b.pending{opacity:.7}",
      "#" + C + " .hs-who{font:800 11px var(--f);color:var(--acc);margin-bottom:2px}",
      "#" + C + " .hs-tx{white-space:pre-wrap;word-wrap:break-word}",
      "#" + C + " .hs-ts{font:600 10.5px var(--f);opacity:.7;text-align:right;margin-top:3px}",
      "#" + C + " .hs-dots{display:flex;gap:4px;padding:4px 2px}",
      "#" + C + " .hs-dots i{width:7px;height:7px;border-radius:50%;background:currentColor;opacity:.35;animation:hsDot 1.2s infinite}",
      "#" + C + " .hs-dots i:nth-child(2){animation-delay:.2s}",
      "#" + C + " .hs-dots i:nth-child(3){animation-delay:.4s}",
      "@keyframes hsDot{0%,60%,100%{opacity:.35;transform:none}30%{opacity:.9;transform:translateY(-3px)}}",
      "@media (prefers-reduced-motion:reduce){#" + C + " .hs-dots i{animation:none}}",
      "#" + C + " .hs-bug{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:12px;margin-bottom:12px}",
      "#" + C + " .hs-bug-h{display:flex;gap:8px;align-items:center;font:800 13.5px var(--f)}#" + C + " .hs-bug-h svg{width:18px;height:18px;color:var(--red)}",
      "#" + C + " .hs-bug-l{font:500 12.5px/1.45 var(--f);color:var(--mut);margin-top:6px}",
      "#" + C + " .bc-shot{max-width:150px;border-radius:12px;border:1px solid var(--line);margin-top:10px;display:block}",
      "#" + C + " .hs-solved{display:flex;gap:8px;align-items:center;justify-content:center;font:600 12.5px var(--f);color:var(--ok);margin:14px 0 4px}#" + C + " .hs-solved svg{width:16px;height:16px}",
      "#" + C + " .hs-comp{display:flex;gap:8px;align-items:flex-end;padding:10px 12px calc(env(safe-area-inset-bottom,0px) + 10px);border-top:1px solid var(--line);background:var(--bg)}",
      "#" + C + " .hs-comp textarea{flex:1;min-height:42px;max-height:140px;resize:none;box-sizing:border-box;border-radius:21px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:500 15.5px/1.4 var(--f);padding:10px 14px}",
      "#" + C + " .hs-send{width:42px;height:42px;border-radius:50%;border:0;background:var(--line);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto;transition:background .15s}",
      "#" + C + " .hs-send.ready{background:linear-gradient(140deg,var(--acc),var(--acc2))}#" + C + " .hs-send svg{width:20px;height:20px}",
      "#hsToast{position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:2147482995;display:flex;gap:12px;align-items:center;text-align:left;padding:12px 14px;border:0;border-radius:18px;background:#0f172a;color:#fff;box-shadow:0 12px 30px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;cursor:pointer;animation:hsIn .3s cubic-bezier(.2,.9,.3,1) both;transition:opacity .35s,transform .35s}",
      "#hsToast.out{opacity:0;transform:translateY(-12px)}",
      "@keyframes hsIn{from{transform:translateY(-16px);opacity:0}to{transform:none;opacity:1}}",
      "#hsToast .hs-t-ic{width:36px;height:36px;border-radius:12px;background:#2fc4b0;color:#06201c;display:flex;align-items:center;justify-content:center;flex:0 0 auto}#hsToast .hs-t-ic svg{width:20px;height:20px}",
      "#hsToast .hs-t-m{flex:1;min-width:0}#hsToast b{display:block;font:800 14px/1.3 inherit}#hsToast .hs-t-m span{display:block;font:500 13px/1.35 inherit;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "@media (prefers-reduced-motion:reduce){#" + R + " .bg-card{animation:none}}"
    ].join("\n");
    document.head.appendChild(st);
  }
  function root(id) {
    var el = document.getElementById(id);
    if (el) return el;
    styleOnce();
    // The dialog ROLE goes on the inner card, not this root: dialog-motion.js springs every
    // [role=dialog] that gains .on, which fights this sheet's own entrance and left it half-faded.
    el = document.createElement("div"); el.id = id;
    document.body.appendChild(el);
    return el;
  }

  /* ── the report flow ─────────────────────────────────────────────────────────────────────── */
  var st = null;   // { canvas, element, busy, capturing }
  function closeReport() { var el = document.getElementById(R); if (el) { el.classList.remove("on"); el.innerHTML = ""; } st = null; }
  function sheet(html) { var el = root(R); el.innerHTML = '<div class="bg-card" role="dialog" aria-modal="true" aria-label="Report a bug">' + html + "</div>"; el.classList.add("on"); return el; }

  function onShake() {
    if (!shakeOn()) return;
    if (document.getElementById(R) && document.getElementById(R).classList.contains("on")) return;
    if (document.getElementById("bugrPick")) return;
    report({ via: "shake" });
  }
  // Public entry: capture first (the sheet must not be in the picture), then ask.
  function report(opts) {
    if (st && st.capturing) return;
    st = { capturing: true, via: (opts && opts.via) || "button" };
    var cur = st;
    capture().then(function (cv) { if (st !== cur) return; st.canvas = cv; st.capturing = false; askStep(); });
  }
  function askStep() {
    var el = sheet(
      '<div class="bg-body"><div class="bg-grab"></div><div class="bg-mark">' + ICO.bug + '</div>' +
      '<div class="bg-t">Report a problem</div>' +
      '<p class="bg-s">Show us where it went wrong. It goes straight to the StewardMD team and we aim to <b>fix it within 24 hours</b>.</p>' +
      '<button type="button" class="bg-opt" id="bgPoint">' + ICO.point + '<span>Point at the problem<small>Tap the button or area that is not working</small></span></button>' +
      '<button type="button" class="bg-opt" id="bgWhole">' + ICO.screen + '<span>The whole screen<small>Something is wrong with this page in general</small></span></button>' +
      '</div><div class="bg-foot"><button type="button" class="bg-alt" id="bgCancel">Cancel</button></div>');
    el.querySelector("#bgPoint").onclick = pointStep;
    el.querySelector("#bgWhole").onclick = function () { st.element = null; writeStep(); };
    el.querySelector("#bgCancel").onclick = closeReport;
  }
  /* Owner's iPhone, 2026-09-27: the red outline sat above and smaller than the tile tapped. The
   * rect was measured ONCE, at the tap, while the page was still settling from the report sheet
   * closing (a scale/scroll animation); the outline then stayed where the element had been. Now
   * the outline FOLLOWS the element every frame until "Use this", and the rect used for the
   * screenshot is re-measured at that moment. The sheet is emptied (not just hidden) first. */
  function pointStep() {
    var el = document.getElementById(R); if (el) { el.classList.remove("on"); el.innerHTML = ""; }
    var pk = document.createElement("div"); pk.id = "bugrPick";
    pk.innerHTML = '<div class="bp-box" style="display:none"></div><div class="bp-bar"><span>Tap the button or area with the problem</span><button type="button" class="bp-cancel">Back</button></div>';
    styleOnce(); document.body.appendChild(pk);
    var box = pk.querySelector(".bp-box"), bar = pk.querySelector(".bp-bar"), picked = null, node = null, raf = 0;
    box.style.transition = "none";
    // Re-measure the picked element and move the outline onto it.
    // The Display setting zooms the whole page (home.js applyD: documentElement.style.zoom), and
    // engines disagree on whether getBoundingClientRect reports zoomed px. The overlay always covers
    // exactly the screen, so its own rect vs its own CSS size IS the conversion, on any engine:
    // overlay px for drawing the outline, and screen-fraction px (innerWidth-based) for the screenshot.
    function place() {
      if (!node || !picked) return;
      var r = node.getBoundingClientRect(), o = pk.getBoundingClientRect();
      if (!o.width || !o.height) return;
      var fx = pk.clientWidth / o.width, fy = pk.clientHeight / o.height;
      // Page px (the same space the screenshot was captured in), so the outline lands on the image too.
      picked.rect = { x: Math.round((r.left - o.left) * fx), y: Math.round((r.top - o.top) * fy), w: Math.round(r.width * fx), h: Math.round(r.height * fy) };
      box.style.display = "block";
      box.style.left = ((r.left - o.left) * fx - 4) + "px"; box.style.top = ((r.top - o.top) * fy - 4) + "px";
      box.style.width = (r.width * fx + 8) + "px"; box.style.height = (r.height * fy + 8) + "px";
    }
    function follow() { place(); raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(follow); }
    function stop() { try { (window.cancelAnimationFrame || clearTimeout)(raf); } catch (e) {} raf = 0; window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); }
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    function done(back) { stop(); try { pk.remove(); } catch (e) {} if (back) askStep(); }
    // Taps are ignored until the sheet that just closed has finished moving the page.
    var armedAt = Date.now() + 350;
    pk.addEventListener("click", function (e) {
      if (bar.contains(e.target)) {
        if (e.target.classList.contains("bp-use")) { place(); st.element = picked; done(false); writeStep(); }
        else if (e.target.classList.contains("bp-cancel")) done(true);
        return;
      }
      e.preventDefault(); e.stopPropagation();
      if (Date.now() < armedAt) return;
      pk.style.pointerEvents = "none";
      var under = document.elementFromPoint(e.clientX, e.clientY);
      pk.style.pointerEvents = "";
      node = target(under); pk.__node = node;   // test hook: which element the outline tracks
      picked = describe(under);
      if (!picked) { node = null; return; }
      place(); if (!raf) follow();
      bar.innerHTML = "<span>" + esc(picked.label ? '"' + picked.label.slice(0, 40) + '"' : "This area") + ' selected</span><button type="button" class="bp-cancel">Back</button><button type="button" class="bp-use">Use this</button>';
    }, true);
  }
  function writeStep() {
    var shot = shotData(st.canvas, st.element && st.element.rect);
    st.shot = shot;
    var el = sheet(
      '<div class="bg-body"><div class="bg-grab"></div>' +
      '<div class="bg-t">What went wrong?</div>' +
      (st.element ? '<div class="bg-el">You pointed at: ' + esc(st.element.label || st.element.tag) + '</div>' : "") +
      '<textarea id="bgText" maxlength="2000" placeholder="For example: I tapped Save and nothing happened. Please do not type patient names or details."></textarea>' +
      (shot ? '<div class="bg-thumb"><img alt="Screenshot" src="' + shot + '"><label><input type="checkbox" id="bgShot" checked><span>Include this screenshot<small>Untick it if a patient\'s details are on the screen.</small></span></label></div>' : "") +
      '<div class="bg-err" id="bgErr"></div>' +
      '</div><div class="bg-foot"><button type="button" class="bg-btn" id="bgSend">Send report</button><button type="button" class="bg-alt" id="bgBack">Back</button></div>');
    var ta = el.querySelector("#bgText");
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 300);
    el.querySelector("#bgBack").onclick = askStep;
    el.querySelector("#bgSend").onclick = function () {
      var text = (ta.value || "").trim();
      if (text.length < 3) { el.querySelector("#bgErr").textContent = "Tell us in a few words what went wrong."; return; }
      var inc = el.querySelector("#bgShot");
      send({ text: text, shot: inc && !inc.checked ? "" : st.shot, element: st.element });
    };
  }
  function payload(p) {
    return { action: "bug", text: p.text, shot: p.shot || "", platform: platform(), build: build(),
      bug: { route: route(), element: p.element || null, screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 }, ua: (navigator.userAgent || "").slice(0, 200) } };
  }
  function send(p) {
    var btn = document.getElementById("bgSend"); if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
    var body = payload(p);
    api("POST", "", body).then(function (r) {
      if (r && r.ok && r.ticket) { sentStep(r.ticket); refresh(); return; }
      if (r && r.error === "sign-in-required") return failStep("Sign in to report a bug, so we can reply to you.");
      if (r && r.error === "too-many") return failStep("You have sent a lot of reports today. Thank you. Please try again tomorrow.");
      queue(body); sentStep(null);
    }).catch(function () { queue(body); sentStep(null); });
  }
  function sentStep(t) {
    var el = sheet(
      '<div class="bg-body"><div class="bg-grab"></div><div class="bg-mark">' + ICO.check + '</div>' +
      '<div class="bg-t">Thank you. We are on it.</div>' +
      (t ? '<p class="bg-s">Your report <b>' + esc(t.id) + '</b> is with the StewardMD team.</p>'
         : '<p class="bg-s">You are offline, so the report is saved on this phone and will be sent as soon as you are connected.</p>') +
      '<div class="bg-sla">' + ICO.clock + '<span>We will fix it within 24 hours and reply to you in Help &amp; Support in the menu.</span></div>' +
      '</div><div class="bg-foot"><button type="button" class="bg-btn" id="bgDone">Done</button><button type="button" class="bg-alt" id="bgOpenC">Open Help &amp; Support</button></div>');
    el.querySelector("#bgDone").onclick = closeReport;
    el.querySelector("#bgOpenC").onclick = function () { closeReport(); openCentre(t ? { ticket: t.id } : null); };
  }
  function failStep(msg) {
    var el = sheet('<div class="bg-body"><div class="bg-grab"></div><div class="bg-t">Could not send</div><p class="bg-s">' + esc(msg) + '</p></div><div class="bg-foot"><button type="button" class="bg-btn" id="bgDone">OK</button></div>');
    el.querySelector("#bgDone").onclick = closeReport;
  }

  /* ── offline outbox ──────────────────────────────────────────────────────────────────────── */
  function readOutbox() { try { return JSON.parse(lsGet(OUTBOX) || "[]") || []; } catch (e) { return []; } }
  function queue(body) { var q = readOutbox(); q.push({ body: body, at: Date.now() }); lsSet(OUTBOX, JSON.stringify(q.slice(-10))); }
  var _flushing = false;
  function flush() {
    var q = readOutbox();
    if (!q.length || _flushing || !user()) return Promise.resolve(0);
    _flushing = true;
    var left = [], sent = 0;
    return q.reduce(function (p, item) {
      return p.then(function () {
        return api("POST", "", item.body).then(function (r) { if (r && r.ok) sent++; else if (!(r && (r.error === "too-many" || r.error === "empty"))) left.push(item); }, function () { left.push(item); });
      });
    }, Promise.resolve()).then(function () { lsSet(OUTBOX, JSON.stringify(left)); _flushing = false; if (sent) refresh(); return sent; });
  }

  /* ── Help & Support centre (one place: bugs, questions, feedback), live chat ─────────────────
   * Owner 2026-09-27: "rather than having feedback, help and support, bug centre three different
   * tabs, one single Help & support centre, world class, with real time chatting. I replied
   * immediately but it never reached the user". Conversations are the support tickets
   * (functions/_support.js, kinds bug | help | feedback). The chat is live: while it is open the
   * app long-polls /api/support?live=1&after=<seq>&wait=20 (D1, strongly consistent): the server holds
   * the request and answers the moment a reply, status change, "Seen" or "typing" lands, and the app
   * asks again at once (owner: "as fast as WhatsApp"). The server checks every 350 ms while a chat is
   * on screen, 1.2 s on the centre's list, 3 s elsewhere in the app; nothing runs while the app is in
   * the background (push covers that). A KV re-read is the fallback when live is unavailable. */
  var _tickets = [], _unread = 0, _open = null, _compose = null, _seq = null, _live = true, _pollT = 0, _lastFull = 0;
  var _ctl = null, _ctlFast = "", _fails = 0, _typingSent = 0, _typingT = 0;
  var WAIT_S = 20, RETRY_MS = 3000, FALLBACK_MS = 5000, FULL_EVERY = 60000, TYPING_EVERY = 3000, TYPING_SHOW = 6000;
  var KIND = { bug: { label: "Bug", icon: "bug" }, help: { label: "Question", icon: "chat" }, feedback: { label: "Feedback", icon: "spark" } };
  function unread() { return _unread; }
  function kindOf(t) { return (t && KIND[t.kind]) ? t.kind : "help"; }
  function byId(id) { return _tickets.filter(function (x) { return x.id === id; })[0] || null; }
  function sortTickets() { _tickets.sort(function (a, b) { return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0); }); }
  function countUnread() { _unread = _tickets.filter(function (t) { return t.userUnread; }).length; paintBadge(); }
  function refresh() {
    if (!user()) return Promise.resolve([]);
    return api("GET", "").then(function (r) {
      if (r && r.tickets) {
        // Keep live-only state (seen receipts) across a full re-read.
        var prev = {}; _tickets.forEach(function (t) { prev[t.id] = t; });
        _tickets = r.tickets.map(function (t) {
          var p = prev[t.id]; if (!p) return t;
          if (p._seenAt && !t.supportSeenAt) t.supportSeenAt = p._seenAt;
          if (p._typingUntil) t._typingUntil = p._typingUntil;
          // A message still sending, or one that reached this phone live, stays on screen even if this
          // read came from an edge copy that has not caught up yet.
          (p.messages || []).forEach(function (m) {
            if (!m.pending && Date.now() - (m.ts || 0) > 600000) return;
            var has = (t.messages || []).some(function (x) { return x.from === m.from && x.text === m.text && Math.abs((x.ts || 0) - (m.ts || 0)) < 5000; });
            if (!has) (t.messages = t.messages || []).push(m);
          });
          (t.messages || []).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          return t;
        });
        sortTickets(); countUnread(); _lastFull = Date.now();
      }
      return _tickets;
    }, function () { return _tickets; });
  }
  function paintBadge() {
    try {
      ['[data-sbr-act="help"]', '[data-sbr-act="bugs"]'].forEach(function (sel) {
        var row = document.querySelector(sel); if (!row) return;
        var b = row.querySelector(".sbr-badge");
        if (_unread) { if (!b) { b = document.createElement("span"); b.className = "sbr-badge"; row.appendChild(b); } b.textContent = String(_unread); }
        else if (b) b.remove();
      });
    } catch (e) {}
  }
  // "Fix due in 5 h" / "Overdue, we are on it" / "Fixed" (bugs); "Solved" / "Open" (the rest)
  function slaText(t, now) {
    now = now || Date.now();
    if (t.status === "resolved") return { txt: t.kind === "bug" ? "Fixed" : "Solved", cls: "ok" };
    if (t.kind !== "bug") return { txt: t.status === "in_progress" ? "Working on it" : "Open", cls: "" };
    var left = (t.dueAt || (t.createdAt + 86400000)) - now;
    if (left <= 0) return { txt: "Overdue, we are on it", cls: "late" };
    var h = Math.ceil(left / 3600000);
    if (t.status === "in_progress") return { txt: h <= 1 ? "Working on it, due within the hour" : "Working on it, due in " + h + " h", cls: "" };
    return { txt: h <= 1 ? "Fix due within the hour" : "Fix due in " + h + " h", cls: "" };
  }
  function when(ts) { try { return new Date(ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function clock(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function dayLabel(ts) {
    try { var d = new Date(ts), n = new Date(); var y = new Date(n.getTime() - 86400000);
      if (d.toDateString() === n.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday";
      return d.toLocaleDateString([], { day: "numeric", month: "short" }); } catch (e) { return ""; }
  }
  function firstName() {
    try { var u = user(); var n = (u && (u.displayName || "")) || ""; n = n.replace(/^dr\.?\s+/i, "").split(/\s+/)[0]; return n ? "Dr " + n : ""; } catch (e) { return ""; }
  }

  /* ── live events ── */
  function applyEvents(evs) {
    var fresh = [], need = false, typing = false;
    (evs || []).forEach(function (e) {
      var t = byId(e.ticket);
      if (!t) { need = true; return; }   // a conversation this device has not seen yet (other device)
      if (e.kind === "msg") {
        var dup = (t.messages || []).some(function (m) { return m.from === e.sender && m.text === e.text && Math.abs((m.ts || 0) - e.ts) < 5000; });
        if (!dup) { (t.messages = t.messages || []).push({ from: e.sender, text: e.text, ts: e.ts }); t.updatedAt = e.ts; if (e.sender === "support") { t.userUnread = true; t._typingUntil = 0; fresh.push(t); } }
      } else if (e.kind.indexOf("status:") === 0) { t.status = e.kind.slice(7); t.updatedAt = e.ts; if (t.status === "resolved") t.resolvedAt = e.ts; }
      else if (e.kind === "read" && e.sender === "support") { t.supportSeenAt = e.ts; t._seenAt = e.ts; }
      else if (e.kind.indexOf("new") === 0 && e.sender === "user") need = true;
      else if (e.kind === "typing" && e.sender === "support" && Date.now() - e.ts < TYPING_SHOW) { t._typingUntil = Date.now() + TYPING_SHOW; typing = true; }
    });
    sortTickets();
    // A reply for the conversation that is open on screen is read the moment it lands.
    fresh.forEach(function (t) { if (_open === t.id && centreOpen() && !document.hidden) { t.userUnread = false; api("POST", "", { action: "seen", id: t.id }); } });
    countUnread();
    var other = fresh.filter(function (t) { return !(_open === t.id && centreOpen()); });
    if (other.length) notifyReply(other[other.length - 1]);
    if (need) refresh().then(repaint);
    if (evs && evs.length) repaint();
    if (typing) { clearTimeout(_typingT); _typingT = setTimeout(function () { if (_open && centreOpen()) paintThread(); }, TYPING_SHOW + 100); }
  }
  // Server check rate for the held request: fast in a chat, normal in the centre, slow elsewhere in
  // the app (the banner; a push covers the rest).
  function mode() { return !centreOpen() ? "bg" : (_open || _compose) ? "fast" : ""; }
  function stopPoll() { clearTimeout(_pollT); _pollT = 0; if (_ctl) { try { _ctl.abort(); } catch (e) {} _ctl = null; } }
  function poll() {
    stopPoll();
    if (document.hidden) return;                         // resumes on visibilitychange; push covers the background
    if (!user()) { _pollT = setTimeout(poll, RETRY_MS); return; }
    if (!_live) {                                        // no D1: re-read the list now and then
      var due = Date.now() - _lastFull > (centreOpen() ? FALLBACK_MS : 30000);
      (due ? refresh().then(repaint) : Promise.resolve()).then(function () { _pollT = setTimeout(poll, FALLBACK_MS); });
      return;
    }
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    _ctl = ctl || { abort: function () {} }; _ctlFast = mode();
    var mine = _ctl, t0 = Date.now(), head = _seq == null;
    var q = _seq == null ? "?live=1" : "?live=1&after=" + _seq + "&wait=" + WAIT_S + (_ctlFast ? "&" + _ctlFast + "=1" : "");
    api("GET", q, null, ctl && ctl.signal).then(function (r) {
      if (_ctl !== mine) return;                         // superseded by a newer poll
      _ctl = null;
      if (!r || !r.ok) { _fails++; _pollT = setTimeout(poll, RETRY_MS); return; }
      _fails = 0;
      if (r.live === false) { _live = false; _pollT = setTimeout(poll, 0); return; }
      if (_seq == null) _seq = +r.seq || 0;
      else { _seq = Math.max(_seq, +r.seq || 0); applyEvents(r.events); }
      // A full re-read now and then heals anything the live log missed (it is a fast path, not the record).
      var heal = Date.now() - _lastFull > FULL_EVERY && centreOpen() ? refresh().then(repaint) : null;
      if (heal) heal.then(null, function () {});
      // Ask again at once: the server holds it open. An empty answer that came straight back means
      // it did not hold (an older server, a proxy): pace those rather than spin.
      var quick = !head && !(r.events && r.events.length) && Date.now() - t0 < 1000;
      _pollT = setTimeout(poll, quick ? 2500 : 0);
    }, function () {
      if (_ctl !== mine) return;                         // aborted on purpose
      _ctl = null; _fails++;
      _pollT = setTimeout(poll, Math.min(15000, RETRY_MS * _fails));
    });
  }
  // Keep one long-poll running. Going into a chat restarts it at the fast rate at once; other screen
  // changes take effect on the next round. (Native /api calls cannot be cancelled, so restarting on
  // every screen change would stack held requests on the phone's HTTP bridge.)
  function schedule() {
    if (document.hidden) { stopPoll(); return; }
    if (_ctl && (_ctlFast === mode() || mode() !== "fast")) return;
    if (_ctl || !_pollT) poll();
  }
  // "typing…" for the developer, at most once every few seconds while the doctor writes.
  function sendTyping() {
    if (!_open || Date.now() - _typingSent < TYPING_EVERY) return;
    _typingSent = Date.now();
    api("POST", "", { action: "typing", id: _open }).then(null, function () {});
  }
  function centreOpen() { var el = document.getElementById(C); return !!(el && el.classList.contains("on")); }
  // A reply while the doctor is elsewhere in the app: a tappable banner, the way a messenger does it.
  function notifyReply(t) {
    try {
      var old = document.getElementById("hsToast"); if (old) old.remove();
      styleOnce();
      var n = document.createElement("button"); n.type = "button"; n.id = "hsToast";
      var last = (t.messages || [])[t.messages.length - 1] || {};
      n.innerHTML = '<span class="hs-t-ic">' + ICO.chat + '</span><span class="hs-t-m"><b>StewardMD support replied</b><span>' + esc(String(last.text || "").slice(0, 90)) + "</span></span>";
      n.onclick = function () { n.remove(); openCentre({ ticket: t.id }); };
      document.body.appendChild(n);
      setTimeout(function () { try { n.classList.add("out"); setTimeout(function () { n.remove(); }, 400); } catch (e) {} }, 7000);
    } catch (e) {}
  }

  /* ── views ── */
  function shell(title, inner, opts) {
    opts = opts || {};
    var el = root(C);
    el.removeAttribute("data-thread");
    el.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Help and Support" style="display:contents"><div class="bc-head">' +
      (opts.back ? '<button type="button" class="bc-ic" id="bcBack" aria-label="Back">' + ICO.back + "</button>" : "") +
      '<div class="bc-ttl"><b>' + title + "</b>" + (opts.sub ? "<small>" + opts.sub + "</small>" : "") + "</div>" +
      '<button type="button" class="bc-ic" id="bcClose" aria-label="Close">' + ICO.close + "</button></div>" +
      '<div class="bc-body' + (opts.chat ? " chat" : "") + '" id="bcBody">' + inner + "</div>" + (opts.foot || "") + "</div>";
    el.classList.add("on");
    el.querySelector("#bcClose").onclick = closeCentre;
    var bk = el.querySelector("#bcBack"); if (bk) bk.onclick = function () { _open = null; _compose = null; renderHome(); schedule(); };
    return el;
  }
  function repaint() {
    if (!centreOpen()) return;
    if (_open) paintThread(); else if (!_compose) renderHome();
  }
  function renderHome() {
    _open = null; _compose = null;
    var hi = firstName();
    var shakeOk = shakeOn() && (!needsPermission() || lsGet(PERM_KEY) === "granted");
    var convs = !user() ? '<div class="bc-empty">Sign in to talk to us and see your conversations.</div>'
      : (!_tickets.length ? '<div class="bc-empty">No conversations yet. Whatever it is, a bug, a question or an idea, start one above and a real person from the team will answer.</div>'
      : _tickets.map(function (t) {
          var s = slaText(t), k = KIND[kindOf(t)], last = (t.messages || []).filter(function (m) { return m.text; }).slice(-1)[0] || {};
          var pv = last.text ? (last.from === "support" ? "StewardMD: " : "You: ") + last.text : "";
          return '<div class="bc-row' + (t.userUnread ? " unread" : "") + '" data-bc="' + esc(t.id) + '"><span class="bc-kic k-' + kindOf(t) + '">' + ICO[k.icon] + "</span>" +
            '<div class="m"><div class="r1"><b>' + esc(String(t.subject || "").replace(/^Bug:\s*/, "")) + "</b><time>" + esc(dayLabel(t.updatedAt || t.createdAt) === "Today" ? clock(t.updatedAt || t.createdAt) : dayLabel(t.updatedAt || t.createdAt)) + "</time></div>" +
            '<div class="r2"><span class="pv">' + esc(pv.slice(0, 90)) + "</span>" + (t.userUnread ? '<span class="bc-dot" aria-label="New reply"></span>' : "") + "</div>" +
            '<div class="r3"><span class="chip">' + k.label + '</span><span class="bc-pill ' + s.cls + '">' + esc(s.txt) + "</span></div></div></div>";
        }).join(""));
    var el = shell("Help &amp; Support",
      '<div class="hs-hero"><div class="hs-hi">' + (hi ? "Hi " + esc(hi) + "," : "Hi,") + '</div><div class="hs-q">How can we help?</div>' +
        '<div class="hs-team"><span class="hs-live"></span>Real people from the StewardMD team. Questions answered within hours, bugs fixed within 24 hours.</div></div>' +
      '<div class="hs-acts">' +
        '<button type="button" class="hs-act" data-new="bug">' + ICO.bug + '<span><b>Report a problem</b><small>Point at what is not working</small></span></button>' +
        '<button type="button" class="hs-act" data-new="help">' + ICO.chat + '<span><b>Ask a question</b><small>Chat with the team</small></span></button>' +
        '<button type="button" class="hs-act" data-new="feedback">' + ICO.spark + '<span><b>Share feedback or an idea</b><small>What should we build or change?</small></span></button>' +
      "</div>" +
      '<div class="hs-sec">Your conversations</div>' + convs +
      '<div class="bc-tg"><div>Shake to report<small>Shake your phone on any screen to report a problem</small></div>' +
        '<button type="button" class="bc-sw' + (shakeOk ? " on" : "") + '" id="bcShake" role="switch" aria-label="Shake to report"><span></span></button></div>' +
      '<p class="hs-note">Solved conversations are kept for 30 days, then deleted.</p>');
    Array.prototype.forEach.call(el.querySelectorAll("[data-new]"), function (b) {
      b.onclick = function () {
        var k = b.getAttribute("data-new");
        if (k === "bug") { closeCentre(); setTimeout(function () { report({ via: "centre" }); }, 120); return; }
        if (!user()) { toast("Sign in to talk to us."); return; }
        _compose = k; paintCompose();
      };
    });
    el.querySelector("#bcShake").onclick = function () {
      var b = this;
      if (b.classList.contains("on")) { lsSet(SHAKE_KEY, "0"); b.classList.remove("on"); return; }
      enableShake().then(function (ok) { b.classList.toggle("on", ok); if (!ok) toast("Motion access was not allowed. Turn it on in Settings, then try again."); });
    };
    Array.prototype.forEach.call(el.querySelectorAll("[data-bc]"), function (r) { r.onclick = function () { openThread(r.getAttribute("data-bc")); }; });
  }
  function composer(ph) {
    return '<div class="hs-comp"><textarea id="bcTx" rows="1" maxlength="4000" placeholder="' + esc(ph) + '"></textarea>' +
      '<button type="button" class="hs-send" id="bcSend" aria-label="Send">' + ICO.send + "</button></div>";
  }
  function wireComposer(el, onSend) {
    var tx = el.querySelector("#bcTx"), btn = el.querySelector("#bcSend");
    var grow = function () { tx.style.height = "auto"; tx.style.height = Math.min(140, tx.scrollHeight) + "px"; btn.classList.toggle("ready", !!tx.value.trim()); };
    tx.addEventListener("input", grow); grow();
    btn.onclick = function () { var v = (tx.value || "").trim(); if (!v || btn.disabled) return; onSend(v, tx, btn); };
  }
  function bubble(m, mine, tail) {
    return '<div class="hs-b ' + (mine ? "me" : "them") + (m.pending ? " pending" : "") + '">' + (!mine && tail ? '<div class="hs-who">StewardMD support</div>' : "") +
      '<div class="hs-tx">' + esc(m.text) + '</div><div class="hs-ts">' + esc(clock(m.ts)) + (m.status ? " · " + m.status : "") + "</div></div>";
  }
  function paintCompose() {
    var k = _compose, intro = k === "feedback"
      ? "Tell us what to improve, or an idea you would like us to build. We read every message."
      : "Ask us anything about StewardMD. A real person from the team will reply here, usually within a few hours.";
    var el = shell(k === "feedback" ? "Feedback or an idea" : "Ask a question",
      '<div class="hs-thread">' + bubble({ text: intro, ts: Date.now() }, false, true) + "</div>",
      { back: true, chat: true, sub: "The StewardMD team", foot: composer(k === "feedback" ? "Write your feedback" : "Write your question") });
    wireComposer(el, function (v, tx, btn) {
      btn.disabled = true;
      api("POST", "", { action: "create", kind: k, text: v, platform: platform(), build: build() }).then(function (r) {
        btn.disabled = false;
        if (r && r.ok && r.ticket) { _tickets.unshift(r.ticket); _compose = null; openThread(r.ticket.id); }
        else toast(r && r.error === "too-many" ? "You have started a lot of conversations today. Please add to an existing one." : r && r.error === "sign-in-required" ? "Sign in to talk to us." : "Could not send. Try again.");
      }, function (e) { btn.disabled = false; toast(failText(e)); });
    });
    setTimeout(function () { try { el.querySelector("#bcTx").focus(); } catch (e) {} }, 250);
    schedule();
  }
  function openThread(id) {
    var t = byId(id); if (!t) return;
    _open = id; _compose = null;
    paintThread(true);
    if (t.userUnread) { t.userUnread = false; countUnread(); api("POST", "", { action: "seen", id: id }); }
    schedule();
  }
  function paintThread(first) {
    var t = byId(_open); if (!t) { renderHome(); return; }
    var body = document.getElementById("bcBody");
    var keep = body && !first ? { atEnd: body.scrollTop + body.clientHeight >= body.scrollHeight - 40, draft: (document.getElementById("bcTx") || {}).value || "" } : { atEnd: true, draft: "" };
    var s = slaText(t), k = KIND[kindOf(t)];
    var msgs = (t.messages || []).filter(function (m) { return m.text; });
    var mineLast = -1; msgs.forEach(function (m, i) { if (m.from !== "support") mineLast = i; });
    var seen = t.supportSeenAt || 0, html = "", lastDay = "";
    msgs.forEach(function (m, i) {
      var d = dayLabel(m.ts); if (d !== lastDay) { html += '<div class="hs-day">' + esc(d) + "</div>"; lastDay = d; }
      var mine = m.from !== "support";
      var mm = { text: m.text, ts: m.ts, pending: m.pending, status: mine && i === mineLast ? (m.pending ? "Sending" : (seen >= m.ts ? "Seen" : "Sent")) : "" };
      html += bubble(mm, mine, !mine && (i === 0 || msgs[i - 1].from !== "support"));
    });
    var bugBox = "";
    if (t.kind === "bug") {
      bugBox = '<div class="hs-bug"><div class="hs-bug-h">' + ICO.bug + "<span>" + esc(s.txt) + "</span></div>" +
        (t.bug && t.bug.element && t.bug.element.label ? '<div class="hs-bug-l">You pointed at: ' + esc(t.bug.element.label) + "</div>" : "") +
        (t.hasShot && t.status !== "resolved" ? '<img class="bc-shot" id="bcShot" alt="Your screenshot">' : "") + "</div>";
    }
    var solved = t.status === "resolved" ? '<div class="hs-solved">' + ICO.check + "<span>" + (t.kind === "bug" ? "Marked fixed." : "Marked solved.") + " Still happening? Reply and we reopen it.</span></div>" : "";
    if ((t._typingUntil || 0) > Date.now()) html += '<div class="hs-b them hs-typing" aria-live="polite"><div class="hs-who">StewardMD support</div><div class="hs-dots" aria-label="typing"><i></i><i></i><i></i></div></div>';
    var inner = bugBox + '<div class="hs-thread">' + html + "</div>" + solved;
    var sub = '<span class="bc-pill ' + s.cls + '">' + esc(s.txt) + "</span>", ph = t.status === "resolved" ? "Reply to reopen" : "Message";
    // Live updates repaint only the messages: rebuilding the composer would drop the keyboard mid-sentence.
    var cur = document.getElementById(C), tx0 = document.getElementById("bcTx");
    if (!first && cur && cur.getAttribute("data-thread") === t.id && tx0 && body) {
      var oldShot = document.getElementById("bcShot");
      body.innerHTML = inner;
      var sm = cur.querySelector(".bc-ttl small"); if (sm) sm.innerHTML = sub;
      tx0.setAttribute("placeholder", ph);
      var ns = document.getElementById("bcShot"); if (ns && oldShot && oldShot.src) ns.src = oldShot.src;
      else if (ns) loadShot(ns, t.id);
      if (keep.atEnd) body.scrollTop = body.scrollHeight;
      return;
    }
    var el = shell(esc(k.label) + " · " + esc(t.id), inner, { back: true, chat: true, sub: sub, foot: composer(ph) });
    el.setAttribute("data-thread", t.id);
    var txT = el.querySelector("#bcTx"); if (txT) txT.addEventListener("input", function () { if (txT.value.trim()) sendTyping(); });
    wireComposer(el, function (v, tx, btn) {
      var pend = { from: "user", text: v, ts: Date.now(), pending: true };
      (t.messages = t.messages || []).push(pend); tx.value = ""; paintThread();
      api("POST", "", { action: "reply", id: t.id, text: v }).then(function (r) {
        if (r && r.ok && r.ticket) { var i = _tickets.indexOf(t); if (i > -1) { r.ticket.supportSeenAt = t.supportSeenAt; _tickets[i] = r.ticket; } }
        else { t.messages.splice(t.messages.indexOf(pend), 1); toast("Could not send. Try again."); }
        paintThread();
      }, function (e) { t.messages.splice(t.messages.indexOf(pend), 1); paintThread(); toast(failText(e)); });
    });
    var tx2 = document.getElementById("bcTx"); if (tx2 && keep.draft) { tx2.value = keep.draft; tx2.dispatchEvent(new Event("input")); }
    var b2 = document.getElementById("bcBody"); if (b2 && keep.atEnd) b2.scrollTop = b2.scrollHeight;
    var img = document.getElementById("bcShot");
    if (img) loadShot(img, t.id);
  }
  function loadShot(img, id) {
    var u = user();
    if (u && u.getIdToken) u.getIdToken().then(function (tok) { return fetch("/api/support?shot=" + encodeURIComponent(id), { headers: { "Authorization": "Bearer " + tok } }); })
      .then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { if (b && img.isConnected) img.src = URL.createObjectURL(b); else if (img) img.remove(); }, function () { try { img.remove(); } catch (e) {} });
  }
  // opts: { ticket: id } opens that conversation; { compose: "help"|"feedback" } starts one.
  function openCentre(opts) {
    opts = opts || {};
    if (opts.compose && user()) { _compose = opts.compose === "feedback" ? "feedback" : "help"; paintCompose(); }
    else renderHome();
    flush().then(refresh).then(function () {
      if (!centreOpen()) return;
      if (opts.ticket && byId(opts.ticket)) openThread(opts.ticket); else repaint();
    });
    schedule();
  }
  function closeCentre() { var el = document.getElementById(C); if (el) { el.classList.remove("on"); el.innerHTML = ""; } _open = null; _compose = null; schedule(); }

  /* ── boot ────────────────────────────────────────────────────────────────────────────────── */
  function boot() {
    bootShake();
    window.addEventListener("online", function () { flush(); poll(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden) stopPoll(); else poll(); });
    // A push tap opens https://stewardmd.in/#help (older pushes: #bugs)
    var deep = function () { var h = location.hash; if (h === "#help" || h === "#bugs") openCentre(); };
    setTimeout(deep, 900);
    window.addEventListener("hashchange", deep);
    // Badge + outbox + live feed once auth has resolved.
    var n = 0, t = setInterval(function () { n++; if (user()) { clearInterval(t); flush().then(refresh).then(poll); } else if (n > 40) clearInterval(t); }, 1500);
  }
  if (document.readyState !== "loading") setTimeout(boot, 600);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });

  var API = { report: report, openCentre: openCentre, closeCentre: closeCentre, unread: unread, refresh: refresh, poll: poll,
    enableShake: enableShake, _shake: onShake, _capture: capture, _detector: detector, _slaText: slaText, _describe: describe, _payload: payload,
    _state: function () { return { seq: _seq, live: _live, open: _open, compose: _compose, tickets: _tickets.length }; }, _failText: failText };
  window.SMD_BUGS = API;
  window.SMD_HELP = API;
  // The one place every "feedback" entry point in the app lands (sidebar, quick action, home.js).
  window.SMD_openFeedback = function () { openCentre({ compose: "feedback" }); };
})();
