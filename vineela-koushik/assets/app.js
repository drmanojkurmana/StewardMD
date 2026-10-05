/* App: boot sequence and every guest interaction. */
(function () {
  "use strict";
  var VK = (window.VK = window.VK || {});
  var root = document.documentElement;
  var REDUCED = root.classList.contains("rm");
  var FINE = window.matchMedia && window.matchMedia("(pointer:fine)").matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var gsap = window.gsap;
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ─────────── Scene 0: preloader ─────────── */
  function preloader() {
    var g = $(".pre-dots"), ns = "http://www.w3.org/2000/svg";
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2, c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", (Math.cos(a) * 54).toFixed(2)); c.setAttribute("cy", (Math.sin(a) * 54).toFixed(2)); c.setAttribute("r", 1.6);
      c.style.animationDelay = (i * .1) + "s"; g.appendChild(c);
    }
    var t0 = performance.now();
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('italic 400 40px "Bodoni Moda"'), document.fonts.load('400 40px "Bodoni Moda"'),
      document.fonts.load('400 30px "Suranna"', "శుభలేఖ"), document.fonts.load('400 16px "Mukta"')
    ]).catch(function () {}) : Promise.resolve();
    var timeout = new Promise(function (r) { setTimeout(r, 2800); });
    return Promise.race([fonts, timeout]).then(function () {
      var wait = Math.max(0, 1100 - (performance.now() - t0));
      return new Promise(function (r) { setTimeout(r, wait); });
    });
  }

  /* ─────────── Scene 1: the closed invitation ─────────── */
  var tilt = { x: 0, y: 0, tx: 0, ty: 0, raf: 0, input: false, t: 0 };
  function cover() {
    var face = $(".panel-l .face"), right = $(".panel-r");
    right.appendChild(face.cloneNode(true));
    // the clone's gradient ids must stay unique
    var clone = right.querySelector(".face-frame");
    clone.querySelectorAll("[id]").forEach(function (n) { n.id = n.id + "-r"; });
    clone.innerHTML = clone.innerHTML.replace(/url\(#(foil|teeth)\)/g, "url(#$1-r)");
    document.body.classList.add("cover-open");
    $("#story").setAttribute("inert", "");
    var card = $("#card"), cw = card.offsetWidth;
    window.addEventListener("resize", function () { cw = card.offsetWidth; });
    function loop(t) {
      if ($("#cover").classList.contains("gone")) return;
      if (!tilt.input && !REDUCED) { tilt.tx = Math.sin(t / 2600) * 2.2; tilt.ty = Math.cos(t / 3400) * 3; }
      tilt.x += (tilt.tx - tilt.x) * .06; tilt.y += (tilt.ty - tilt.y) * .06;
      card.style.setProperty("--rx", tilt.x.toFixed(2) + "deg");
      card.style.setProperty("--ry", tilt.y.toFixed(2) + "deg");
      card.style.setProperty("--shx", ((tilt.y * 2.2 - tilt.x) * cw / 100).toFixed(1) + "px");
      tilt.raf = requestAnimationFrame(loop);
    }
    if (!REDUCED) tilt.raf = requestAnimationFrame(loop);
    if (FINE) {
      $("#cover").addEventListener("pointermove", function (e) {
        tilt.input = true;
        tilt.ty = (e.clientX / innerWidth - .5) * 10;
        tilt.tx = -(e.clientY / innerHeight - .5) * 8;
      });
      $("#cover").addEventListener("pointerleave", function () { tilt.input = false; });
    }
    if (gsap && !REDUCED) {
      gsap.from(".card-wrap", { opacity: 0, y: 40, scale: .94, duration: 2, ease: "expo.out", delay: .1 });
      gsap.from(".cover-cta > *", { opacity: 0, y: 14, duration: 1.4, stagger: .15, ease: "power3.out", delay: .9 });
    }
  }

  function onOrientation(e) {
    if (e.gamma == null) return;
    var g = Math.max(-30, Math.min(30, e.gamma)), b = Math.max(-30, Math.min(30, (e.beta || 45) - 45));
    tilt.input = true; tilt.ty = g / 30 * 5; tilt.tx = -b / 30 * 4;
    VK.fx && VK.fx.setTilt(g * 7);
  }

  var opened = false;
  function openInvitation() {
    if (opened) return; opened = true;
    var A = VK.audio;
    A.haptic(14);
    if (A.supported && A.init()) {
      A.start(); A.open();
      var btn = $("#soundToggle"); btn.hidden = false; btn.setAttribute("aria-pressed", "true");
    }
    $(".thread").hidden = false;
    VK.scenes.open(function () {
      document.body.classList.remove("cover-open");
      $("#story").removeAttribute("inert");
      window.scrollTo(0, 0);
      if (window.ScrollTrigger) window.ScrollTrigger.refresh();
      VK.scenes.playTitle();
      var h = $("#hero-names"); h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true });
    });
  }

  /* ─────────── sound toggle ─────────── */
  function soundToggle() {
    var b = $("#soundToggle");
    b.addEventListener("click", function () {
      var A = VK.audio;
      if (!A.ready) { if (A.init()) A.start(); }
      var on = b.getAttribute("aria-pressed") !== "true";
      A.setEnabled(on);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", on ? "Music on" : "Music off");
      A.haptic(6);
    });
  }

  /* ─────────── talambralu ─────────── */
  var measure = document.createElement("canvas").getContext("2d");
  var glyphCache = {};
  function glyphLedges(el) {
    var key = el.id + innerWidth + "x" + innerHeight;
    if (!glyphCache[key]) {
      var cs = getComputedStyle(el), text = el.textContent.trim();
      measure.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
      var fs = parseFloat(cs.fontSize), ls = parseFloat(cs.letterSpacing) || 0;
      var full = measure.measureText(text);
      var fa = full.fontBoundingBoxAscent || fs * .9, fd = full.fontBoundingBoxDescent || fs * .25;
      var lh = parseFloat(cs.lineHeight) || fs;
      var baseline = (lh - (fa + fd)) / 2 + fa;
      var out = [], x = 0;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i], m = measure.measureText(ch), w = m.width;
        var asc = m.actualBoundingBoxAscent != null ? m.actualBoundingBoxAscent : fs * .7;
        var left = m.actualBoundingBoxLeft || 0, right = m.actualBoundingBoxRight || w;
        var gw = right + left;
        // italic tops sit to the right: use the upper part of the glyph box
        out.push({ x1: x - left + gw * .28, x2: x + right - gw * .08, y: baseline - asc + 1.5 });
        x += w + ls;
      }
      glyphCache[key] = { glyphs: out, width: x - ls };
    }
    return glyphCache[key];
  }
  function ledges() {
    var res = [];
    ["nameV", "nameK"].forEach(function (id) {
      var el = document.getElementById(id); if (!el) return;
      var g = glyphLedges(el), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.bottom < -50 || r.top > innerHeight + 50) return;
      var tx = cs.textAlign === "right" || cs.textAlign === "end" ? r.right - g.width : r.left;
      g.glyphs.forEach(function (L) { res.push({ x1: tx + L.x1, x2: tx + L.x2, y: r.top + L.y, c: id === "nameV" ? .62 : .9 }); });
    });
    // the parents' lines catch a few grains too
    $$(".couple-stage .parents").forEach(function (p) {
      var r = p.getBoundingClientRect(); if (r.width) res.push({ x1: r.left + 4, x2: r.right - 4, y: r.top + 5, c: .18 });
    });
    return res;
  }
  function talambralu() {
    var btn = $("#talambralu"), stage = $("#coupleStage"), count = +(store.get("vk-blessings") || 0), out = $("#blessCount");
    VK.fx && VK.fx.setLedges(ledges);
    function label(n) { return n === 1 ? "Your blessings have been showered" : "Blessings showered " + n + " times"; }
    if (count) out.textContent = label(count);
    btn.addEventListener("click", function () {
      var v = $("#nameV").getBoundingClientRect(), k = $("#nameK").getBoundingClientRect();
      var area = { left: Math.min(v.left, k.left), right: Math.max(v.right, k.right), top: Math.min(v.top, k.top), bottom: Math.max(v.bottom, k.bottom) };
      VK.fx && VK.fx.shower(area);
      VK.audio.patter(1.8, REDUCED ? 30 : 90);
      VK.audio.chime(.05);
      VK.audio.haptic([8, 40, 8, 40, 8]);
      stage.classList.add("glow");
      if (gsap) gsap.fromTo(".couple-light", { opacity: .45 }, { opacity: 1, duration: .5, yoyo: true, repeat: 1, repeatDelay: 1.2, ease: "power2.inOut", onComplete: function () { gsap.to(".couple-light", { opacity: .45, duration: 1 }); } });
      clearTimeout(btn._t); btn._t = setTimeout(function () { stage.classList.remove("glow"); }, 2600);
      count++; store.set("vk-blessings", count); out.textContent = label(count);
    });
  }

  /* ─────────── lamps ─────────── */
  var DIYA_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5A3D12"/><stop offset=".22" stop-color="#C8963A"/><stop offset=".42" stop-color="#FFF0B8"/><stop offset=".58" stop-color="#E8C46A"/><stop offset=".85" stop-color="#8C6222"/><stop offset="1" stop-color="#4E3410"/></linearGradient>' +
    '<linearGradient id="brassV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6DB8E"/><stop offset=".5" stop-color="#A87A2C"/><stop offset="1" stop-color="#4E3410"/></linearGradient>' +
    '<radialGradient id="oil" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#5A3810"/><stop offset="1" stop-color="#1E1204"/></radialGradient>' +
    '<radialGradient id="bowlLight" cx=".85" cy="0" r="1"><stop offset="0" stop-color="#FFD58A" stop-opacity=".85"/><stop offset=".6" stop-color="#FFB050" stop-opacity=".18"/><stop offset="1" stop-color="#FFB050" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="flameOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE9A8" stop-opacity=".1"/><stop offset=".3" stop-color="#FFD55A"/><stop offset=".72" stop-color="#FF8A1A"/><stop offset="1" stop-color="#D94A08"/></linearGradient>' +
    '<linearGradient id="flameIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFF4C2"/><stop offset="1" stop-color="#FFC94A"/></linearGradient>' +
    '</defs></svg>';
  var DIYA = '<span class="halo" aria-hidden="true"></span><svg viewBox="0 0 120 120" aria-hidden="true">' +
    '<ellipse cx="60" cy="113" rx="42" ry="4.5" fill="rgba(0,0,0,.5)"/>' +
    '<g class="bowl">' +
    '<path d="M42 103 Q60 98 78 103 L75 110 Q60 114 45 110 Z" fill="url(#brassV)"/>' +
    '<path d="M12 74 Q60 62 106 74 Q101 99 60 102 Q19 99 12 74 Z" fill="url(#brass)"/>' +
    '<path d="M98 71 Q112 66 117 57 Q114 73 104 80 Z" fill="url(#brass)"/>' +
    '<ellipse cx="58" cy="73.5" rx="46.5" ry="8.5" fill="url(#oil)" stroke="#FFE3A0" stroke-width="1.1"/>' +
    '<path d="M18 84 Q60 95 100 84" stroke="#5A3D12" stroke-width="1.3" fill="none" opacity=".75"/>' +
    '<path d="M21 89 Q60 99 97 89" stroke="#FFE0A0" stroke-width=".8" fill="none" opacity=".55"/>' +
    '<path class="bowl-light" d="M12 74 Q60 62 106 74 Q101 99 60 102 Q19 99 12 74 Z" fill="url(#bowlLight)"/>' +
    '</g>' +
    '<path d="M108 65 q3 -4 3.5 -9" stroke="#2E1C08" stroke-width="2.4" stroke-linecap="round" fill="none"/>' +
    '<g class="flame"><path d="M111.5 14 C123 32 124 46 111.5 57 C99 46 100 32 111.5 14 Z" fill="url(#flameOut)"/>' +
    '<path d="M111.5 31 C117 40 117 48 111.5 55 C106 48 106 40 111.5 31 Z" fill="url(#flameIn)"/>' +
    '<ellipse cx="111.5" cy="55" rx="3" ry="1.8" fill="rgba(90,130,255,.55)"/></g></svg>';

  function lamps() {
    var list = $("#diyas"), sec = $("#lamps"), msg = $("#lampMsg");
    document.body.insertAdjacentHTML("beforeend", DIYA_DEFS);
    var lit = 0;
    for (var i = 0; i < 5; i++) {
      var li = document.createElement("li");
      li.innerHTML = '<button type="button" class="diya" aria-pressed="false" aria-label="Light lamp ' + (i + 1) + ' of 5">' + DIYA + "</button>";
      list.appendChild(li);
    }
    $$(".diya", list).forEach(function (b, i) {
      b.addEventListener("click", function () {
        var r = b.getBoundingClientRect(), fx = r.left + r.width * .93, fy = r.top + r.height * .22;
        if (b.classList.contains("lit")) {
          VK.fx && VK.fx.sparks(fx, fy, 8); VK.audio.ignite(i); VK.audio.haptic(6);
          return;
        }
        b.classList.add("lit"); b.setAttribute("aria-pressed", "true"); b.setAttribute("aria-label", "Lamp " + (i + 1) + " of 5, lit");
        lit++;
        VK.fx && VK.fx.sparks(fx, fy, 18);
        VK.audio.ignite(i); VK.audio.haptic(12);
        sec.style.setProperty("--lit", lit);
        VK.scenes.setWarmth(lit / 5);
        if (lit >= 3 && !msg.classList.contains("show")) { msg.classList.add("show"); }
        if (lit === 5) {
          sec.classList.add("all-lit");
          setTimeout(function () { VK.audio.chime(.07); }, 500);
        }
      });
    });
  }

  /* ─────────── countdown ─────────── */
  function countdown() {
    var row = $(".cd-row"), cap = $("#cdCaption");
    var nums = {}, strips = {};
    $$(".cd-num", row).forEach(function (n) { nums[n.dataset.unit] = n; });
    function build(unit, digits) {
      var el = nums[unit]; el.textContent = new Array(digits + 1).join("0");
      strips[unit] = VK.scenes.odometer(el);
    }
    function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
    var lastMin = -1;
    function update() {
      var diff = VK.muhurthamAt - Date.now();
      if (diff <= 0) {
        row.hidden = true;
        cap.textContent = "The muhurtham has been blessed. Thank you for your blessings.";
        return false;
      }
      var s = Math.floor(diff / 1000), v = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
      ["d", "h", "m", "s"].forEach(function (u) {
        var str = pad(v[u], 2);
        if (!strips[u] || strips[u].length !== str.length) build(u, str.length);
        strips[u].forEach(function (st, i) { VK.scenes.setDigit(st, +str[i]); });
      });
      if (v.m !== lastMin) {
        lastMin = v.m;
        row.setAttribute("aria-label", v.d + " days, " + v.h + " hours and " + v.m + " minutes until the muhurtham");
      }
      return true;
    }
    if (update()) { var t = setInterval(function () { if (!update()) clearInterval(t); }, 1000); }
  }

  /* ─────────── sheets: calendar and share ─────────── */
  var lastFocus = null;
  function openSheet(sheet) {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    requestAnimationFrame(function () { requestAnimationFrame(function () { sheet.classList.add("open"); }); });
    var first = sheet.querySelector(".sheet-opt"); if (first) first.focus({ preventScroll: true });
    VK.audio.haptic(6);
  }
  function closeSheet(sheet) {
    sheet.classList.remove("open");
    setTimeout(function () { sheet.hidden = true; }, 420);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }
  function wireSheet(sheet) {
    $$("[data-close]", sheet).forEach(function (c) { c.addEventListener("click", function () { closeSheet(sheet); }); });
    sheet.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSheet(sheet);
      if (e.key === "Tab") {
        var f = $$("a,button", sheet).filter(function (x) { return x.offsetParent; }), a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    });
  }
  function calendar() {
    var sheet = $("#calSheet"), ev = null, src = null;
    wireSheet(sheet);
    $$("[data-cal]").forEach(function (b) {
      b.addEventListener("click", function () {
        ev = VK.events[b.dataset.cal]; src = b;
        $("#calTitle").textContent = "Add the " + ev.label.toLowerCase() + " to your calendar";
        $("#calSub").textContent = ev.when + ". " + ev.location;
        $("#calGoogle").href = VK.links.google(ev);
        openSheet(sheet);
      });
    });
    $("#calGoogle").addEventListener("click", function () { if (src) src.classList.add("done"); setTimeout(function () { closeSheet(sheet); }, 200); });
    $("#calIcs").addEventListener("click", function () {
      if (!ev) return;
      var ics = VK.links.ics(ev);
      var iOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (iOS) {
        window.location.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
      } else {
        var url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
        var a = document.createElement("a"); a.href = url; a.download = ev.file; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
      }
      if (src) src.classList.add("done");
      closeSheet(sheet);
    });
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? res() : rej(); } catch (e) { rej(e); } finally { ta.remove(); }
    });
  }
  function sharing() {
    var status = $("#shareStatus"), copyBtn = $("#copyBtn"), sheet = $("#shareSheet");
    wireSheet(sheet);
    $("#shareWa").href = "https://wa.me/?text=" + encodeURIComponent(VK.page.shareText + "\n" + VK.page.url);
    function copied() {
      copyBtn.classList.add("copied");
      copyBtn.querySelector(".btn-label").textContent = "Link copied";
      status.textContent = "The invitation link is ready to paste.";
      VK.audio.chime(.04); VK.audio.haptic(10);
      clearTimeout(copyBtn._t);
      copyBtn._t = setTimeout(function () {
        copyBtn.classList.remove("copied"); copyBtn.querySelector(".btn-label").textContent = "Copy link"; status.textContent = "";
      }, 2800);
    }
    function doCopy() { copyText(VK.page.url).then(copied, function () { status.textContent = VK.page.url; }); }
    copyBtn.addEventListener("click", doCopy);
    $("#shareCopy").addEventListener("click", function () { closeSheet(sheet); doCopy(); });
    $("#shareBtn").addEventListener("click", function () {
      VK.audio.haptic(8);
      if (navigator.share) {
        navigator.share({ title: VK.page.shareTitle, text: VK.page.shareText, url: VK.page.url }).catch(function () {});
      } else {
        openSheet(sheet);
      }
    });
  }

  /* ─────────── small things ─────────── */
  function magnetic() {
    if (!FINE || REDUCED) return;
    $$(".magnetic").forEach(function (b) {
      b.addEventListener("pointermove", function (e) {
        var r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        b.style.transform = "translate(" + (dx * .14).toFixed(1) + "px," + (dy * .22).toFixed(1) + "px)";
      });
      b.addEventListener("pointerleave", function () { b.style.transform = ""; });
    });
  }
  function pointerLight() {
    if (!FINE) return;
    var bd = $("#backdrop"); bd.style.setProperty("--pa", "1");
    window.addEventListener("pointermove", function (e) {
      bd.style.setProperty("--px", e.clientX + "px"); bd.style.setProperty("--py", e.clientY + "px");
    }, { passive: true });
  }
  function chapters() {
    $$('.thread a, .skip').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href").slice(1);
        e.preventDefault();
        if (!opened) { openInvitation(); setTimeout(function () { go(id); }, 2100); return; }
        go(id);
      });
    });
    function go(id) {
      window.scrollTo({ top: VK.scenes.chapterY(id), behavior: REDUCED ? "auto" : "smooth" });
    }
  }
  function mapsLinks() {
    $$("[data-maps]").forEach(function (a) { a.href = VK.links.maps(VK.events[a.dataset.maps]); });
  }

  /* ─────────── boot ─────────── */
  function fail(err) {
    // never let effects stand between a guest and the details
    try { console.warn("Invitation fallback:", err); } catch (e) {}
    var c = $("#cover"); if (c) c.classList.add("gone");
    var p = $("#preloader"); if (p) p.classList.add("done");
    document.body.classList.remove("cover-open");
    var s = $("#story"); if (s) s.removeAttribute("inert");
  }

  function boot() {
    try {
      mapsLinks();
      VK.fx && VK.fx.init();
      lamps();
      VK.scenes.init();
      cover();
      soundToggle(); talambralu(); countdown(); calendar(); sharing(); magnetic(); pointerLight(); chapters();
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== "function") {
        window.addEventListener("deviceorientation", onOrientation, { passive: true });
      }
      $("#openBtn").addEventListener("click", openInvitation);
      if (!VK.audio.supported) $(".sound-hint").hidden = true;
    } catch (e) { fail(e); return; }
    preloader().then(function () { $("#preloader").classList.add("done"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.addEventListener("error", function (e) { if (!opened && !$("#cover").classList.contains("gone") && /VK|gsap|ScrollTrigger/.test(String(e.message))) fail(e.message); });
})();
