/* bug-report.js - shake the phone to report a bug, and the Bug Report Centre.
 * ============================================================================================
 * Owner request 2026-09-26: "shake the iphone to report a bug feature where bugs are directly save
 * in our server where user can point out the button or screen whatever and write what is the
 * problem. and save it promise user to will be solved in 24hrs and give a bug report centre in side
 * bar for all bugs reported and reply from developer to user."
 *
 * Flow: shake -> the screen is captured (html2canvas, lazy) BEFORE any sheet appears -> "Point at
 * the problem" (tap the button or area; it is outlined on the screenshot) or "Whole screen" ->
 * "What went wrong?" -> sent to /api/support {action:"bug"} as a ticket of kind "bug" with a fix
 * promised within 24 hours -> the Bug Report Centre (sidebar) lists every report with its status,
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

  function api(method, path, body) {
    var u = user();
    if (!u || typeof u.getIdToken !== "function") return Promise.resolve({ ok: false, error: "sign-in-required", status: 401 });
    return u.getIdToken().then(function (tok) {
      var o = { method: method, headers: { "Authorization": "Bearer " + tok } };
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
  // The visible viewport at half resolution, as a canvas. Never rejects (null when it cannot).
  function capture() {
    return loadH2C().then(function (h2c) {
      var w = window.innerWidth, h = window.innerHeight;
      return h2c(document.body, { x: window.scrollX, y: window.scrollY, width: w, height: h, windowWidth: w, windowHeight: h,
        scale: Math.min(1, 720 / Math.max(1, w)), backgroundColor: pageBg(), logging: false, useCORS: true,
        ignoreElements: function (el) { return el && (el.id === R || el.id === C || el.id === "bugrPick"); } });
    }).catch(function () { return null; });
  }
  // The screenshot as JPEG, with the pointed-at element outlined in red.
  function shotData(canvas, rect) {
    if (!canvas) return "";
    try {
      var out = document.createElement("canvas"); out.width = canvas.width; out.height = canvas.height;
      var g = out.getContext("2d"); g.fillStyle = pageBg(); g.fillRect(0, 0, out.width, out.height); g.drawImage(canvas, 0, 0);
      if (rect) {
        var k = canvas.width / Math.max(1, window.innerWidth);
        g.strokeStyle = "#e5484d"; g.lineWidth = Math.max(3, 4 * k);
        g.strokeRect(rect.x * k - 4, rect.y * k - 4, rect.w * k + 8, rect.h * k + 8);
      }
      var q = 0.6, d = out.toDataURL("image/jpeg", q);
      while (d.length > 880 * 1024 && q > 0.25) { q -= 0.12; d = out.toDataURL("image/jpeg", q); }
      return d.length > 880 * 1024 ? "" : d;
    } catch (e) { return ""; }
  }

  /* ── describing the pointed element ──────────────────────────────────────────────────────── */
  function describe(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    // The smallest control under the finger; a plain area is reported as itself.
    var t = (el.closest && el.closest("button,a,[role=button],[role=tab],[role=switch],input,select,textarea,label,[data-act],[data-sbr-act]")) || el;
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
    var label = (t.getAttribute && (t.getAttribute("aria-label") || t.getAttribute("title"))) || (t.innerText || t.value || "").trim().replace(/\s+/g, " ");
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
      "#bugrPick .bp-box{position:fixed;border:3px solid #e5484d;border-radius:8px;box-shadow:0 0 0 9999px rgba(8,12,18,.35);pointer-events:none;transition:all .12s}",
      "#" + C + "{position:fixed;inset:0;z-index:2147482990;display:none;flex-direction:column;background:var(--bg);color:var(--ink);font-family:var(--f)}",
      "#" + C + ".on{display:flex}",
      "#" + C + " .bc-head{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 12px;border-bottom:1px solid var(--line)}",
      "#" + C + " .bc-head b{flex:1;font:800 19px var(--f)}",
      "#" + C + " .bc-ic{width:40px;height:40px;border:0;border-radius:12px;background:var(--soft);color:var(--ink);display:flex;align-items:center;justify-content:center;cursor:pointer}",
      "#" + C + " .bc-ic svg{width:20px;height:20px}",
      "#" + C + " .bc-body{flex:1;overflow-y:auto;padding:14px 16px calc(env(safe-area-inset-bottom,0px) + 20px);-webkit-overflow-scrolling:touch}",
      "#" + C + " .bc-new{width:100%;min-height:50px;border:0;border-radius:15px;background:linear-gradient(140deg,var(--acc),var(--acc2));color:#fff;font:800 15.5px var(--f);display:flex;gap:10px;align-items:center;justify-content:center;cursor:pointer}",
      "#" + C + " .bc-new svg{width:20px;height:20px}",
      "#" + C + " .bc-promise{font:500 13px/1.5 var(--f);color:var(--mut);margin:10px 2px 14px}",
      "#" + C + " .bc-tg{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:var(--soft);margin-bottom:16px}",
      "#" + C + " .bc-tg div{flex:1;font:700 14px var(--f)}#" + C + " .bc-tg small{display:block;font:500 12.5px var(--f);color:var(--mut);margin-top:2px}",
      "#" + C + " .bc-sw{width:48px;height:28px;border-radius:14px;border:0;background:var(--line);position:relative;cursor:pointer;flex:0 0 auto}",
      "#" + C + " .bc-sw span{position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 3px rgba(0,0,0,.3)}",
      "#" + C + " .bc-sw.on{background:var(--acc)}#" + C + " .bc-sw.on span{left:23px}",
      "#" + C + " .bc-row{display:flex;gap:12px;align-items:center;padding:13px 4px;border-bottom:1px solid var(--line);cursor:pointer}",
      "#" + C + " .bc-row .m{flex:1;min-width:0}",
      "#" + C + " .bc-row b{display:block;font:700 14.5px/1.35 var(--f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      "#" + C + " .bc-row small{display:block;font:500 12.5px var(--f);color:var(--mut);margin-top:3px}",
      "#" + C + " .bc-dot{width:9px;height:9px;border-radius:50%;background:var(--red);flex:0 0 auto}",
      "#" + C + " .bc-pill{font:800 11.5px var(--f);padding:5px 9px;border-radius:999px;background:var(--soft);color:var(--amber);white-space:nowrap}",
      "#" + C + " .bc-pill.ok{color:var(--ok)}#" + C + " .bc-pill.late{color:var(--red)}",
      "#" + C + " .bc-empty{text-align:center;color:var(--mut);font:500 14px/1.5 var(--f);padding:36px 12px}",
      "#" + C + " .bc-msg{margin:8px 0;padding:10px 12px;border-radius:14px;max-width:86%;font:500 14px/1.45 var(--f);white-space:pre-wrap;background:var(--soft)}",
      "#" + C + " .bc-msg.dev{margin-left:auto;background:var(--acc);color:#fff}",
      "#" + C + " .bc-msg small{display:block;font:800 10.5px var(--f);opacity:.75;margin-bottom:3px}",
      "#" + C + " .bc-shot{max-width:160px;border-radius:12px;border:1px solid var(--line);margin:4px 0 10px}",
      "#" + C + " textarea{width:100%;box-sizing:border-box;min-height:80px;border-radius:14px;border:1px solid var(--line);background:var(--soft);color:var(--ink);font:500 15px/1.45 var(--f);padding:12px;margin-top:10px}",
      "#" + C + " .bc-send{margin-top:8px;min-height:46px;width:100%;border:0;border-radius:14px;background:var(--acc);color:#fff;font:800 15px var(--f);cursor:pointer}",
      "#" + C + " .bc-meta{font:500 12.5px/1.5 var(--f);color:var(--mut);margin:2px 0 10px}",
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
  function pointStep() {
    var el = document.getElementById(R); if (el) { el.classList.remove("on"); }
    var pk = document.createElement("div"); pk.id = "bugrPick";
    pk.innerHTML = '<div class="bp-box" style="display:none"></div><div class="bp-bar"><span>Tap the button or area with the problem</span><button type="button" class="bp-cancel">Back</button></div>';
    styleOnce(); document.body.appendChild(pk);
    var box = pk.querySelector(".bp-box"), bar = pk.querySelector(".bp-bar"), picked = null;
    function done(back) { try { pk.remove(); } catch (e) {} if (back) askStep(); }
    pk.addEventListener("click", function (e) {
      if (bar.contains(e.target)) {
        if (e.target.classList.contains("bp-use")) { st.element = picked; done(false); writeStep(); }
        else if (e.target.classList.contains("bp-cancel")) done(true);
        return;
      }
      e.preventDefault(); e.stopPropagation();
      pk.style.pointerEvents = "none";
      var under = document.elementFromPoint(e.clientX, e.clientY);
      pk.style.pointerEvents = "";
      picked = describe(under);
      if (!picked) return;
      var r = picked.rect;
      box.style.display = "block"; box.style.left = (r.x - 4) + "px"; box.style.top = (r.y - 4) + "px"; box.style.width = (r.w + 8) + "px"; box.style.height = (r.h + 8) + "px";
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
      '<div class="bg-sla">' + ICO.clock + '<span>We will fix it within 24 hours and reply to you in the Bug Report Centre in the menu.</span></div>' +
      '</div><div class="bg-foot"><button type="button" class="bg-btn" id="bgDone">Done</button><button type="button" class="bg-alt" id="bgOpenC">Open Bug Report Centre</button></div>');
    el.querySelector("#bgDone").onclick = closeReport;
    el.querySelector("#bgOpenC").onclick = function () { closeReport(); openCentre(); };
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

  /* ── Bug Report Centre ───────────────────────────────────────────────────────────────────── */
  var _tickets = [], _unread = 0, _open = null;
  function bugs(ts) { return (ts || []).filter(function (t) { return t.kind === "bug"; }); }
  function unread() { return _unread; }
  function refresh() {
    if (!user()) return Promise.resolve([]);
    return api("GET", "").then(function (r) {
      _tickets = bugs(r && r.tickets);
      _unread = _tickets.filter(function (t) { return t.userUnread; }).length;
      paintBadge();
      return _tickets;
    }, function () { return _tickets; });
  }
  function paintBadge() {
    try {
      var row = document.querySelector('[data-sbr-act="bugs"]'); if (!row) return;
      var b = row.querySelector(".sbr-badge");
      if (_unread) { if (!b) { b = document.createElement("span"); b.className = "sbr-badge"; row.appendChild(b); } b.textContent = String(_unread); }
      else if (b) b.remove();
    } catch (e) {}
  }
  // "Fix due in 5 h" / "Overdue, we are on it" / "Fixed"
  function slaText(t, now) {
    now = now || Date.now();
    if (t.status === "resolved") return { txt: "Fixed", cls: "ok" };
    var left = (t.dueAt || (t.createdAt + 86400000)) - now;
    if (left <= 0) return { txt: "Overdue, we are on it", cls: "late" };
    var h = Math.ceil(left / 3600000);
    return { txt: h <= 1 ? "Fix due within the hour" : "Fix due in " + h + " h", cls: "" };
  }
  function when(ts) { try { return new Date(ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function centreShell(inner, sub) {
    var el = root(C);
    el.innerHTML = '<div role="dialog" aria-modal="true" aria-label="Bug Report Centre" style="display:contents"><div class="bc-head">' + (sub ? '<button type="button" class="bc-ic" id="bcBack" aria-label="Back">' + ICO.back + "</button>" : "") +
      "<b>" + (sub ? "Bug report" : "Bug Report Centre") + '</b><button type="button" class="bc-ic" id="bcClose" aria-label="Close">' + ICO.close + "</button></div>" +
      '<div class="bc-body">' + inner + "</div></div>";
    el.classList.add("on");
    el.querySelector("#bcClose").onclick = closeCentre;
    var bk = el.querySelector("#bcBack"); if (bk) bk.onclick = function () { _open = null; renderList(); };
    return el;
  }
  function renderList() {
    var shakeRow = '<div class="bc-tg"><div>Shake to report' + '<small>Shake your phone on any screen to report a problem</small></div>' +
      '<button type="button" class="bc-sw' + (shakeOn() && (!needsPermission() || lsGet(PERM_KEY) === "granted") ? " on" : "") + '" id="bcShake" role="switch" aria-label="Shake to report"><span></span></button></div>';
    var list = !user() ? '<div class="bc-empty">Sign in to see your bug reports and our replies.</div>'
      : (!_tickets.length ? '<div class="bc-empty">No bug reports yet. When something does not work, shake your phone or tap Report a bug.</div>'
      : _tickets.map(function (t) {
          var s = slaText(t);
          return '<div class="bc-row" data-bc="' + esc(t.id) + '">' + (t.userUnread ? '<span class="bc-dot" aria-label="New reply"></span>' : "") +
            '<div class="m"><b>' + esc(String(t.subject || "").replace(/^Bug:\s*/, "")) + "</b><small>" + esc(t.id) + " · " + esc(when(t.createdAt)) + "</small></div>" +
            '<span class="bc-pill ' + s.cls + '">' + esc(s.txt) + "</span></div>";
        }).join(""));
    var el = centreShell('<button type="button" class="bc-new" id="bcNew">' + ICO.bug + "<span>Report a bug</span></button>" +
      '<p class="bc-promise">Every report reaches the StewardMD team directly. We aim to fix each one within 24 hours and reply to you here.</p>' +
      shakeRow + list);
    el.querySelector("#bcNew").onclick = function () { closeCentre(); setTimeout(function () { report({ via: "centre" }); }, 120); };
    el.querySelector("#bcShake").onclick = function () {
      var b = this;
      if (b.classList.contains("on")) { lsSet(SHAKE_KEY, "0"); b.classList.remove("on"); return; }
      enableShake().then(function (ok) { b.classList.toggle("on", ok); if (!ok) toast("Motion access was not allowed. Turn it on in Settings, then try again."); });
    };
    Array.prototype.forEach.call(el.querySelectorAll("[data-bc]"), function (r) { r.onclick = function () { openTicket(r.getAttribute("data-bc")); }; });
  }
  function openTicket(id) {
    var t = _tickets.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    _open = id;
    var s = slaText(t);
    var msgs = (t.messages || []).filter(function (m) { return m.text; }).map(function (m) {
      var dev = m.from === "support";
      return '<div class="bc-msg' + (dev ? " dev" : "") + '"><small>' + (dev ? "StewardMD developer" : "You") + " · " + esc(when(m.ts)) + "</small>" + esc(m.text) + "</div>";
    }).join("");
    var el = centreShell(
      '<div class="bc-meta"><b>' + esc(t.id) + '</b> · <span class="bc-pill ' + s.cls + '">' + esc(s.txt) + "</span><br>" +
      (t.bug && t.bug.element && t.bug.element.label ? "You pointed at: " + esc(t.bug.element.label) + "<br>" : "") + "Reported " + esc(when(t.createdAt)) + "</div>" +
      (t.hasShot && t.status !== "resolved" ? '<img class="bc-shot" id="bcShot" alt="Your screenshot">' : "") +
      msgs +
      (t.status === "resolved" ? '<div class="bc-meta">Marked fixed. If it still happens, reply below and we will reopen it.</div>' : "") +
      '<textarea id="bcTx" maxlength="2000" placeholder="Add more detail or reply to the developer"></textarea><button type="button" class="bc-send" id="bcSend">Send</button>', true);
    el.querySelector("#bcSend").onclick = function () {
      var tx = el.querySelector("#bcTx"), v = (tx.value || "").trim(); if (!v) return;
      this.disabled = true;
      api("POST", "", { action: "reply", id: id, text: v }).then(function (r) {
        if (r && r.ok && r.ticket) { _tickets = _tickets.map(function (x) { return x.id === id ? r.ticket : x; }); openTicket(id); }
        else toast("Could not send. Try again.");
      }, function () { toast("You are offline. Try again once you are connected."); });
    };
    if (t.userUnread) { t.userUnread = false; _unread = Math.max(0, _unread - 1); paintBadge(); api("POST", "", { action: "seen", id: id }); }
    var img = el.querySelector("#bcShot");
    if (img) {
      var u = user();
      if (u && u.getIdToken) u.getIdToken().then(function (tok) { return fetch("/api/support?shot=" + encodeURIComponent(id), { headers: { "Authorization": "Bearer " + tok } }); })
        .then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) { if (b && img.isConnected) img.src = URL.createObjectURL(b); else if (img) img.remove(); }, function () { img.remove(); });
    }
  }
  function openCentre() {
    renderList();
    flush().then(refresh).then(function () { var el = document.getElementById(C); if (el && el.classList.contains("on")) { if (_open) openTicket(_open); else renderList(); } });
  }
  function closeCentre() { var el = document.getElementById(C); if (el) { el.classList.remove("on"); el.innerHTML = ""; } _open = null; }

  /* ── boot ────────────────────────────────────────────────────────────────────────────────── */
  function boot() {
    bootShake();
    window.addEventListener("online", function () { flush(); });
    // A push tap opens https://stewardmd.in/#bugs
    if (location.hash === "#bugs") setTimeout(openCentre, 900);
    window.addEventListener("hashchange", function () { if (location.hash === "#bugs") openCentre(); });
    // Badge + outbox once auth has resolved.
    var n = 0, t = setInterval(function () { n++; if (user()) { clearInterval(t); flush().then(refresh); } else if (n > 40) clearInterval(t); }, 1500);
  }
  if (document.readyState !== "loading") setTimeout(boot, 600);
  else document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 600); });

  window.SMD_BUGS = { report: report, openCentre: openCentre, closeCentre: closeCentre, unread: unread, refresh: refresh,
    enableShake: enableShake, _shake: onShake, _detector: detector, _slaText: slaText, _describe: describe, _payload: payload };
})();
