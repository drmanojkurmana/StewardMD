/* StewardMD - device power state for ambient motion (owner decision 2026-10-03).
 * window.SMD_POWER.low is true while iOS Low Power Mode / Android Battery Saver is on; the
 * "smd-power" window event fires on every change and html.smd-low-power mirrors it for CSS.
 * Source: the app-local SmdDevice plugin (getPowerState + powerStateChange). Web, or a native
 * build that predates the plugin (JS shipped by OTA), stays low=false, i.e. today's behavior.
 * Consumers: maik-atmosphere.js, thinking-orbs.js go still while low is true.
 *
 * Text size (owner-approved Premium-Feel plan B3): the system text size (iOS Text Size, Android Font
 * size) is applied to the app, which ignored it before. iOS: -webkit-text-size-adjust on html + body
 * (what @capacitor/text-zoom does); Android: WebView textZoom via SmdDevice.setTextZoom. Clamped to
 * 85-200% so the densest clinical tables stay usable; window.SMD_TEXT.scale is the applied value.
 * localStorage smd_text_scale="0" keeps the app at 100%. */
(function () {
  "use strict";
  if (window.SMD_POWER) return;
  var P = { low: false };
  window.SMD_POWER = P;

  function set(v) {
    v = !!v;
    if (v === P.low) return;
    P.low = v;
    try { document.documentElement.classList.toggle("smd-low-power", v); } catch (e) {}
    try { window.dispatchEvent(new Event("smd-power")); } catch (e) {}
  }
  function plugin() {
    try { var C = window.Capacitor; return (C && C.Plugins && C.Plugins.SmdDevice) || null; } catch (e) { return null; }
  }

  // The bridge can proxy the plugin after this deferred script runs, so look again for ~10s.
  var tries = 0;
  (function attach() {
    var pl = plugin();
    if (!pl || typeof pl.getPowerState !== "function") { if (++tries < 20) setTimeout(attach, 500); return; }
    try { pl.getPowerState().then(function (r) { set(r && r.lowPower); }, function () {}); } catch (e) {}
    try { pl.addListener("powerStateChange", function (r) { set(r && r.lowPower); }); } catch (e) {}
    if (typeof pl.getTextScale === "function") {
      try { pl.getTextScale().then(function (r) { applyText(pl, r && r.scale); }, function () {}); } catch (e) {}
      try { pl.addListener("textScaleChange", function (r) { applyText(pl, r && r.scale); }); } catch (e) {}
    }
  })();

  var T = { scale: 1 };
  window.SMD_TEXT = T;
  function textScale(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.round(Math.max(0.85, Math.min(2, n)) * 100) / 100;
  }
  T.clamp = textScale; // test seam
  function applyText(pl, raw) {
    try { if (localStorage.getItem("smd_text_scale") === "0") return; } catch (e) {}
    var k = textScale(raw), pct = Math.round(k * 100) + "%", plat = "";
    try { plat = window.Capacitor.getPlatform(); } catch (e) {}
    T.scale = k;
    if (plat === "android") {
      try { pl.setTextZoom({ percent: Math.round(k * 100) }); } catch (e) {}
    } else {
      try { document.documentElement.style.webkitTextSizeAdjust = pct; } catch (e) {}
      try { if (document.body) document.body.style.webkitTextSizeAdjust = pct; } catch (e) {}
    }
    try { window.dispatchEvent(new Event("smd-text-scale")); } catch (e) {}
  }
})();
