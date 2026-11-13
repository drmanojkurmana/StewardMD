/* Today in Medical History (flag smd_today_history, default ON; "0" turns it off).
 *
 * The home Pro banner flips like a card to show today's event in medical history for 5 seconds,
 * flips back for 5 seconds, and repeats while the banner is on screen (paused when it scrolls away,
 * the app is in the background, or a sheet is open). Days with two events alternate between them.
 * Tapping the banner while it shows history opens a sheet with all of today's events; the front
 * face keeps its own tap (StewardMD facts). The home date also opens the sheet, at any time.
 * Data: data/history/MM.json, one small file per month (scripts/history/build-history.mjs).
 * Content is compiled from public sources, ai_drafted, pending review (vault/modules/Today in
 * Medical History.md). Nothing here is clinical advice.
 */
(function () {
  "use strict";
  var W = window, D = document;
  var FLAG = "smd_today_history", VER = "th19";
  var FACE_MS = 5000;
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var HOSTS = { "litfl.com": "LITFL", "en.wikipedia.org": "Wikipedia", "www.britannica.com": "Britannica", "www.cdc.gov": "CDC",
    "www.nobelprize.org": "Nobel Prize", "www.hiv.gov": "HIV.gov", "www.who.int": "WHO", "www.nih.gov": "NIH", "www.fda.gov": "FDA" };

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function q(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }
  function enabled() { return q("todayhistory") !== "0" && ls(FLAG) !== "0"; }
  if (!enabled()) return;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function reduced() { try { return W.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function hostLabel(u) {
    try { var h = new URL(u).hostname; return HOSTS[h] || h.replace(/^www\./, ""); } catch (e) { return ""; }
  }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || "")) ? String(u) : ""; }

  /* ---- data: one month at a time ---- */
  var cache = {};
  function loadMonth(m) {
    var mm = pad(m);
    if (!cache[mm]) {
      cache[mm] = fetch("/data/history/" + mm + ".json?v=" + VER).then(function (r) {
        if (!r.ok) throw new Error("history " + r.status); return r.json();
      });
      cache[mm].catch(function () { delete cache[mm]; });
    }
    return cache[mm];
  }
  function eventsFor(m, d) { return loadMonth(m).then(function (j) { return (j && j[pad(m) + "-" + pad(d)]) || []; }); }

  /* ---- the flip ---- */
  function dateEl() { return D.querySelector("#homeV2 .hrf-date"); }
  function banner() { return D.getElementById("hrfBanner"); }
  function todayKey() { var n = new Date(); return { m: n.getMonth() + 1, d: n.getDate() }; }
  function onScreen(el) {
    if (!el || D.visibilityState === "hidden") return false;
    if (sheet && sheet.classList.contains("on")) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40 || r.bottom < 24 || r.top > innerHeight - 24) return false;
    var hit = D.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }

  var todays = [], pick = 0, showing = false, busy = false, timer = 0, frontLabel = "";

  // Picture on the right of the history face: the day's own image when one ships (month file "img"),
  // otherwise a line drawing for the event's category. Decorative: the words carry the meaning.
  var ART = {
    "Pioneer": '<ellipse cx="60" cy="50" rx="34" ry="42" class="a-ring"/><ellipse cx="60" cy="50" rx="28" ry="36"/>' +
      '<path d="M60 26c-8 0-13 6-13 14 0 6 3 10 5 12-6 3-13 9-15 19M60 26c8 0 13 6 13 14 0 6-3 10-5 12 6 3 13 9 15 19"/><path d="M52 52c2 3 5 5 8 5s6-2 8-5"/>',
    "Discovery": '<path d="M44 84h52M54 84c0-12 8-20 20-22"/><path d="M62 18l14 8-16 28-14-8z"/><path d="M58 50l-6 10M66 30l6-10 6 3-6 10"/>' +
      '<circle cx="80" cy="58" r="6" class="a-glow"/><path d="M74 62c4 6 4 14-2 22"/><path d="M40 62h20"/>',
    "Nobel & Award": '<circle cx="60" cy="56" r="22" class="a-glow"/><circle cx="60" cy="56" r="15"/><path d="M48 18l12 18 12-18M44 18h32"/>' +
      '<path d="M30 70c-6-8-6-20 0-28M28 58l-6-2M28 48l-5-4M90 70c6-8 6-20 0-28M92 58l6-2M92 48l5-4"/><path d="M55 56l4 4 7-8"/>',
    "Public Health": '<path d="M60 14l30 10v22c0 20-13 32-30 40-17-8-30-20-30-40V24z"/><path d="M60 34v28M46 48h28" class="a-hi"/>' +
      '<circle cx="60" cy="48" r="20" class="a-glow"/>',
    "Surgery": '<path d="M24 80l50-50c4-4 10-4 12 0 2 3 0 7-4 10L32 86z"/><path d="M68 36l10 10" class="a-hi"/>' +
      '<path d="M96 80L56 40M92 84L52 44M52 44l-6-10 10 6"/><circle cx="76" cy="40" r="10" class="a-glow"/>',
    "Vaccine & Drug": '<path d="M28 82l8-8M36 74l34-34 10 10-34 34z"/><path d="M66 36l8-8 12 12-8 8M80 22l12 12M48 62l6 6M56 54l6 6"/>' +
      '<rect x="80" y="58" width="16" height="26" rx="4"/><path d="M80 66h16M84 54h8v4h-8z"/><circle cx="88" cy="74" r="8" class="a-glow"/>',
    "Observance": '<circle cx="60" cy="40" r="22" class="a-glow"/><circle cx="60" cy="40" r="14"/><path d="M48 58l-10 30 12-6 6 12 6-20M72 58l10 30-12-6-6 12-6-20"/>' +
      '<path d="M60 31l3 6 6 1-4.5 4 1 6.5-5.5-3-5.5 3 1-6.5L51 38l6-1z" class="a-hi"/>',
    "Institution": '<path d="M24 40l36-20 36 20zM28 84h64M24 90h72"/><path d="M34 44v36M48 44v36M72 44v36M86 44v36"/>' +
      '<path d="M54 84V62a6 6 0 0 1 12 0v22" class="a-hi"/><circle cx="60" cy="32" r="4"/>'
  };
  function art(e) {
    if (e.img) return '<img class="th-face-img" src="/data/history/img/' + esc(e.img) + '" alt="" decoding="async">';
    return '<svg class="th-face-art" viewBox="0 0 120 100" aria-hidden="true" focusable="false">' + (ART[e.c] || ART.Discovery) + '</svg>';
  }
  var CAL = '<svg class="th-cal" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 7h12M5 1.5v3M11 1.5v3"/><path d="M5 10h1M8 10h1M11 10h1" class="c-dot"/></svg>';
  function face(e) {
    var t = todayKey();
    return '<div class="th-face-pic">' + art(e) + '</div>' +
      '<div class="th-face-txt">' +
        '<div class="th-face-ey">' + t.d + " " + MONTHS[t.m - 1].toUpperCase() + '<span class="th-dot" aria-hidden="true"></span><span class="th-face-lg">This day in medical history</span><span class="th-face-sm">This day in history</span></div>' +
        '<div class="th-face-tt">' + esc(e.t) + '</div>' +
        '<div class="th-face-yr">' + CAL + (e.ob ? "Observed every year" : esc(e.y)) + '</div>' +
        '<div class="th-face-sm-txt">' + esc(e.s) + '</div>' +
      '</div>' +
      '<div class="th-face-go">Tap to explore<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg></div>';
  }
  // Long titles take two lines; the summary then gets one, else two. Nothing spills out of the banner.
  function fit(f) {
    var tt = f.querySelector(".th-face-tt"), sm = f.querySelector(".th-face-sm-txt");
    if (!tt || !sm) return;
    var lh = parseFloat(getComputedStyle(tt).lineHeight) || 20;
    sm.style.webkitLineClamp = tt.offsetHeight > lh * 1.5 ? "1" : "2";   // offsetHeight: the banner may be mid-fold
  }
  function ensureFace(b) {
    var f = b.querySelector(".th-face");
    if (!f) { f = D.createElement("div"); f.className = "th-face"; f.setAttribute("aria-hidden", "true"); b.appendChild(f); }
    return f;
  }
  // The MaiK Aurora (React Bits shader, exported by maik-atmosphere.js) behind the history face, at about a third
  // of MaiK's speed. India's saffron, white and green when the headline is Indian; emerald otherwise. One WebGL
  // context for the life of the page; it draws only while the face shows, the app is visible and motion is allowed,
  // at most 30 frames a second. Without WebGL2 or the shader, the CSS light pools stay (today-history.css).
  var AUR = { speed: 0.42, india: { c: ["#e8641c", "#e4e0d8", "#17803a"], blend: 0.62 }, base: { c: ["#0fa36f", "#8ff0d2", "#0e7490"], blend: 0.58 } };
  var aur = null, reduceMq = W.matchMedia ? W.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function auroraInit() {
    if (aur !== null) return aur;
    var sh = W.SMD_MAIK_ATMOSPHERE && W.SMD_MAIK_ATMOSPHERE.SHADER;
    if (!sh) return false;   // maik-atmosphere.js not loaded yet: try again next flip
    aur = false;
    try {
      var cv = D.createElement("canvas"); cv.className = "th-aurora"; cv.setAttribute("aria-hidden", "true");
      var gl = cv.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) return aur;
      var comp = function (t, src) { var x = gl.createShader(t); gl.shaderSource(x, src); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error("aurora"); return x; };
      var pr = gl.createProgram(); gl.attachShader(pr, comp(gl.VERTEX_SHADER, sh.VERT)); gl.attachShader(pr, comp(gl.FRAGMENT_SHADER, sh.FRAG)); gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error("aurora");
      gl.useProgram(pr);
      var bf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      var pos = gl.getAttribLocation(pr, "position"); gl.enableVertexAttribArray(pos); gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
      var u = {}; ["uTime", "uAmplitude", "uBlend", "uResolution", "uLightMode", "uColorStops[0]"].forEach(function (n) { u[n] = gl.getUniformLocation(pr, n); });
      gl.uniform1f(u.uAmplitude, 1.0); gl.uniform1f(u.uLightMode, 0); gl.clearColor(0, 0, 0, 0);
      aur = { cv: cv, gl: gl, u: u, raf: 0, t: Math.random() * 40, last: 0, pal: AUR.base };
    } catch (x) { aur = false; }
    return aur;
  }
  function auroraPaint() {
    var gl = aur.gl, u = aur.u, p = aur.pal;
    gl.uniform1f(u.uTime, aur.t * AUR.speed); gl.uniform1f(u.uBlend, p.blend);
    gl.uniform3fv(u["uColorStops[0]"], new Float32Array(hexRgb(p.c[0]).concat(hexRgb(p.c[1]), hexRgb(p.c[2]))));
    gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function auroraStill() { return (reduceMq && reduceMq.matches) || !!(W.SMD_POWER && W.SMD_POWER.low); }
  function auroraFrame(ts) {
    aur.raf = 0;
    if (!showing || D.hidden || auroraStill() || !aur.cv.isConnected) return;
    if (ts - aur.last >= 33) { aur.t += Math.min((ts - aur.last) / 1000, 0.1); aur.last = ts; auroraPaint(); }
    aur.raf = requestAnimationFrame(auroraFrame);
  }
  function auroraAttach(f, india) {
    if (!auroraInit()) return;
    f.insertBefore(aur.cv, f.firstChild); f.classList.add("th-gl");
    var dpr = Math.min(W.devicePixelRatio || 1, 1.5), w = Math.round((f.offsetWidth || 1) * dpr), h = Math.round((f.offsetHeight || 1) * dpr);
    if (aur.cv.width !== w || aur.cv.height !== h) { aur.cv.width = w; aur.cv.height = h; aur.gl.viewport(0, 0, w, h); aur.gl.uniform2f(aur.u.uResolution, w, h); }
    aur.pal = india ? AUR.india : AUR.base;
    auroraPaint();
    if (aur.raf) cancelAnimationFrame(aur.raf);
    aur.raf = 0;
    if (!auroraStill()) { aur.last = performance.now(); aur.raf = requestAnimationFrame(auroraFrame); }
  }
  function auroraStop() { if (aur && aur.raf) { cancelAnimationFrame(aur.raf); aur.raf = 0; } }

  function setShowing(b, on) {
    showing = on;
    b.classList.toggle("th-back", on);
    if (on) {
      var e = todays[pick % todays.length]; pick++;
      var f = ensureFace(b); f.className = "th-face" + (e.in ? " th-india" : ""); f.innerHTML = face(e); fit(f); auroraAttach(f, !!e.in);
      // Playfair Display can land after the face is drawn; measure the title again once it has
      if (D.fonts && D.fonts.load) D.fonts.load("600 18px 'Playfair Display'").then(function () { fit(f); }, function () {});
      if (!frontLabel) frontLabel = b.getAttribute("aria-label") || "";
      b.setAttribute("aria-label", "This day in medical history, " + (e.ob ? "observed every year" : e.y) + ": " + e.t + ". Tap to explore");
    } else { auroraStop(); if (frontLabel) b.setAttribute("aria-label", frontLabel); }
  }
  // Fold to the edge, swap faces at 90 degrees (nothing to see edge-on), unfold the other face.
  function flip(b, toBack, done) {
    if (reduced()) {
      b.classList.add("th-fade");
      setTimeout(function () { setShowing(b, toBack); b.classList.remove("th-fade"); done(); }, 220);
      return;
    }
    busy = true;
    b.classList.remove("th-flipin"); void b.offsetWidth;
    b.classList.add("th-flipout");
    setTimeout(function () {
      setShowing(b, toBack);
      b.classList.remove("th-flipout"); void b.offsetWidth; b.classList.add("th-flipin");
      setTimeout(function () { b.classList.remove("th-flipin"); busy = false; done(); }, 300);
    }, 220);
  }
  function tick() {
    clearTimeout(timer);
    var b = banner();
    if (!b || !todays.length || busy) { timer = setTimeout(tick, 600); return; }
    if (!b.querySelector(".th-face") && showing) showing = false;      // home re-rendered the banner
    if (!onScreen(b)) {
      if (showing) setShowing(b, false);                               // come back to the front, quietly
      timer = setTimeout(tick, 700); return;
    }
    flip(b, !showing, function () { timer = setTimeout(tick, FACE_MS); });
  }

  // Swipe to flip, in either direction: a sideways drag turns the card about its vertical axis, an
  // up or down drag tumbles it top to bottom. It follows the finger, swaps faces edge-on at 90
  // degrees, and on release finishes the turn (far or fast enough) or springs back. The banner owns
  // every drag that starts on it (touch-action: none); the rest of the page scrolls as before.
  var drag = null, swallowUntil = 0;
  function dragPaint(b, a) {
    var over = Math.abs(a) >= 90, want = over ? !drag.from : drag.from;
    if (showing !== want) { if (want) pick = drag.pick; setShowing(b, want); }
    var shown = over ? a - (a > 0 ? 180 : -180) : a, s = Math.sin(Math.abs(a) * Math.PI / 180);
    b.style.transform = "perspective(900px) rotate" + (drag.ax === "x" ? "Y" : "X") + "(" + shown.toFixed(2) + "deg) scale(" + (1 - 0.03 * s).toFixed(4) + ")";
    b.style.filter = "brightness(" + (1 - 0.32 * s).toFixed(3) + ")";
  }
  function dragEnd(b, commit) {
    var d = drag, from = d.a, to = commit ? (d.a >= 0 ? 180 : -180) : 0;
    var dur = Math.max(160, Math.min(420, Math.abs(to - from) * 2.6)), t0 = performance.now();
    function step(now) {
      var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      d.a = from + (to - from) * e; dragPaint(b, d.a);
      if (k < 1) { requestAnimationFrame(step); return; }
      b.style.transform = ""; b.style.filter = ""; b.style.transition = "";
      drag = null; busy = false; clearTimeout(timer); timer = setTimeout(tick, FACE_MS);
    }
    requestAnimationFrame(step);
  }
  function armSwipe(b) {
    if (b.getAttribute("data-th-swipe")) return;
    b.setAttribute("data-th-swipe", "1");
    var x0 = 0, y0 = 0, id = -1, live = false, ax = "", span = 1, l = 0, lt = 0, v = 0;
    b.addEventListener("pointerdown", function (e) {
      if (drag || busy || !todays.length || (e.pointerType === "mouse" && e.button !== 0)) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; lt = e.timeStamp; v = 0; live = false; ax = "";
    });
    b.addEventListener("pointermove", function (e) {
      if (e.pointerId !== id) return;
      var dx = e.clientX - x0, dy = e.clientY - y0;
      if (!live) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        ax = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";               // the axis locks on the first 8 px
        var r = b.getBoundingClientRect();
        span = ax === "x" ? (r.width || 1) : Math.max(r.height * 1.5, 150);   // a short card needs a longer pull
        l = ax === "x" ? x0 : y0;
        live = true; busy = true; clearTimeout(timer);
        drag = { from: showing, pick: showing ? pick - 1 : pick, a: 0, ax: ax };   // the event on show, or the one coming
        b.style.transition = "none";
        try { b.setPointerCapture(id); } catch (er) {}
      }
      var p = ax === "x" ? e.clientX : e.clientY, dt = e.timeStamp - lt;
      if (dt > 0) v = 0.7 * v + 0.3 * ((p - l) / dt);
      l = p; lt = e.timeStamp;
      if (reduced()) return;
      // a drag down brings the top edge toward you, as if pulling the card over
      var d = ax === "x" ? dx : dy;
      drag.a = Math.max(-180, Math.min(180, d / span * 200)); dragPaint(b, drag.a);
    });
    function up(e) {
      if (e.pointerId !== id) return;
      id = -1;
      if (!live) return;
      live = false; swallowUntil = Date.now() + 400;
      var d = l - (ax === "x" ? x0 : y0), fast = Math.abs(v) > 0.45 && (v > 0) === (d > 0);
      if (reduced()) {
        drag = null; b.style.transition = "";
        if (Math.abs(d) > 40 || fast) flip(b, !showing, function () { timer = setTimeout(tick, FACE_MS); });
        else { busy = false; timer = setTimeout(tick, FACE_MS); }
        return;
      }
      var commit = e.type !== "pointercancel" && (Math.abs(drag.a) >= 90 || (fast && Math.abs(drag.a) > 20));
      dragEnd(b, commit);
    }
    b.addEventListener("pointerup", up);
    b.addEventListener("pointercancel", up);
  }
  // a finished swipe is not a tap: keep it from opening the sheet or the facts page
  W.addEventListener("click", function (e) {
    if (Date.now() < swallowUntil && e.target && e.target.closest && e.target.closest("#hrfBanner")) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  // While history shows, a tap (or Enter/Space) on the banner opens the sheet, not the facts page.
  function onHistory(t) { var b = t && t.closest && t.closest("#hrfBanner"); return b && showing && b.classList.contains("th-back") ? b : null; }
  D.addEventListener("click", function (e) {
    var b = onHistory(e.target);
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    openSheet(null, null, b);
  }, true);
  D.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var b = onHistory(e.target);
    if (b && e.target === b) { e.preventDefault(); e.stopPropagation(); openSheet(null, null, b); }
  }, true);

  // The date is a quiet way in at any time.
  function armDate() {
    var el = dateEl();
    if (!el || el.getAttribute("data-th")) return;
    el.setAttribute("data-th", "1");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", (el.textContent || "").trim() + ". Open today in medical history");
  }
  D.addEventListener("click", function (e) {
    var el = e.target && e.target.closest && e.target.closest("#homeV2 .hrf-date");
    if (el) openSheet(null, null, el);
  });
  D.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches("#homeV2 .hrf-date")) {
      e.preventDefault(); openSheet(null, null, e.target);
    }
  });

  function start() {
    setInterval(function () { armDate(); var b = banner(); if (b) armSwipe(b); }, 1000); armDate();
    var t = todayKey();
    eventsFor(t.m, t.d).then(function (evs) {
      // the event with a picture leads; the rest keep their order
      // the event with a picture leads, then India's; otherwise oldest first
      // an observance day leads, then the event with a picture, then India's; otherwise oldest first
      todays = (evs || []).slice().sort(function (a, b) { return ((b.ob ? 4 : 0) + (b.img ? 2 : 0) + (b.in ? 1 : 0)) - ((a.ob ? 4 : 0) + (a.img ? 2 : 0) + (a.in ? 1 : 0)); });
      if (todays.length) timer = setTimeout(tick, FACE_MS);           // the front face gets its 5 s first
    }).catch(function () {});
    D.addEventListener("visibilitychange", function () {
      if (D.visibilityState === "visible" && todays.length) { clearTimeout(timer); timer = setTimeout(tick, FACE_MS); }
    });
  }

  /* ---- the sheet ---- */
  var sheet = null, scrim = null, opener = null, cur = null;
  var LEAP = 2028;   // navigate inside a leap year so 29 February is reachable

  function card(e) {
    var u = safeUrl(e.u), h = u ? hostLabel(u) : "";
    return '<li class="th-ev' + (e.ob ? ' th-ev-ob' : '') + '">' +
      '<div class="th-yr' + (e.ob ? ' th-yr-ob' : '') + '">' + (e.ob ? "Every<br>year" : esc(e.y)) + '</div>' +
      '<div class="th-bd">' +
        '<div class="th-tags">' + (e.in ? '<span class="th-in">India</span>' : '') + '<span class="th-cat">' + esc(e.c) + '</span>' + (e.sp ? '<span class="th-sp">' + esc(e.sp) + '</span>' : '') + '</div>' +
        '<h3 class="th-tt">' + esc(e.t) + '</h3>' +
        '<p class="th-sm">' + esc(e.s) + '</p>' +
        (u ? '<a class="th-src" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">Source: ' + esc(h) + '</a>' : '') +
      '</div></li>';
  }

  function render(m, d) {
    cur = { m: m, d: d };
    var title = sheet.querySelector(".th-date"), list = sheet.querySelector(".th-list");
    var today = new Date(), isToday = today.getMonth() + 1 === m && today.getDate() === d;
    title.textContent = d + " " + MONTHS[m - 1];
    sheet.querySelector(".th-ey").textContent = isToday ? "Today in medical history" : "On this day in medical history";
    sheet.querySelector(".th-today").hidden = isToday;
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<li class="th-msg">Loading…</li>';
    eventsFor(m, d).then(function (evs) {
      if (!cur || cur.m !== m || cur.d !== d) return;
      list.innerHTML = evs.length ? evs.map(card).join("") : '<li class="th-msg">Nothing to mark on this day. Try the next one.</li>';
      list.removeAttribute("aria-busy");
      var body = sheet.querySelector(".th-body"); if (body) body.scrollTop = 0;
    }).catch(function () {
      if (!cur || cur.m !== m || cur.d !== d) return;
      list.innerHTML = '<li class="th-msg">Could not load this day. Try again in a moment.</li>';
      list.removeAttribute("aria-busy");
    });
  }
  function step(n) {
    if (!cur) return;
    var x = new Date(LEAP, cur.m - 1, cur.d + n);
    render(x.getMonth() + 1, x.getDate());
  }

  function build() {
    scrim = D.createElement("div"); scrim.id = "thScrim"; scrim.className = "th-scrim";
    scrim.addEventListener("click", closeSheet);
    sheet = D.createElement("div"); sheet.id = "thSheet"; sheet.className = "th-sheet";
    sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", "thDate");
    sheet.innerHTML =
      '<div class="th-grab" aria-hidden="true"></div>' +
      '<div class="th-head">' +
        '<div class="th-ttl"><div class="th-ey"></div><h2 class="th-date" id="thDate" tabindex="-1"></h2></div>' +
        '<button type="button" class="th-x" data-act="close" aria-label="Close">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</div>' +
      '<div class="th-nav">' +
        '<button type="button" class="th-step" data-step="-1" aria-label="Previous day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>' +
        '<button type="button" class="th-today" hidden>Back to today</button>' +
        '<button type="button" class="th-step" data-step="1" aria-label="Next day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>' +
      '</div>' +
      '<div class="th-body"><ol class="th-list" aria-live="polite"></ol>' +
        '<p class="th-foot">Compiled from public sources. Check the source before you cite it.</p></div>';
    sheet.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("button") : null;
      if (!t) return;
      if (t.classList.contains("th-x")) closeSheet();
      else if (t.hasAttribute("data-step")) step(parseInt(t.getAttribute("data-step"), 10));
      else if (t.classList.contains("th-today")) { var n = new Date(); render(n.getMonth() + 1, n.getDate()); }
    });
    sheet.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); closeSheet(); return; }
      if (e.key !== "Tab") return;
      var f = sheet.querySelectorAll("button:not([hidden]),a[href],[tabindex='-1']");
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && D.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && D.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    D.body.appendChild(scrim); D.body.appendChild(sheet);
  }

  function openSheet(m, d, from) {
    if (!sheet || !sheet.isConnected) build();
    var wasOpen = sheet.classList.contains("on"), o = from || D.activeElement;
    if (!wasOpen || !opener) opener = (o && !sheet.contains(o)) ? o : dateEl();
    var n = new Date();
    render(m || n.getMonth() + 1, d || n.getDate());
    scrim.classList.add("on"); sheet.classList.add("on");
    D.documentElement.classList.add("th-open");
    setTimeout(function () { var h = sheet.querySelector(".th-date"); if (h) h.focus({ preventScroll: true }); }, 30);
  }
  function closeSheet() {
    if (!sheet || !sheet.classList.contains("on")) return;
    scrim.classList.remove("on"); sheet.classList.remove("on");
    D.documentElement.classList.remove("th-open");
    sheet.style.transform = ""; sheet.style.transition = "";   // sheet-drag may have left its pull
    var o = opener; opener = null;
    if (o && o.isConnected && o.focus) { try { o.focus({ preventScroll: true }); } catch (e) {} }
    else { var de = dateEl(); if (de) try { de.focus({ preventScroll: true }); } catch (e) {} }
  }

  W.SMD_todayHistory = { open: openSheet, close: closeSheet, eventsFor: eventsFor,
    _state: function () { return { showing: showing, busy: busy, events: todays.length }; } };

  if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", start); else start();
})();
