/* StewardMD - device power state for ambient motion (owner decision 2026-10-03).
 * window.SMD_POWER.low is true while iOS Low Power Mode / Android Battery Saver is on; the
 * "smd-power" window event fires on every change and html.smd-low-power mirrors it for CSS.
 * Source: the app-local SmdDevice plugin (getPowerState + powerStateChange). Web, or a native
 * build that predates the plugin (JS shipped by OTA), stays low=false, i.e. today's behavior.
 * Consumers: maik-atmosphere.js, thinking-orbs.js go still while low is true. */
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
  })();
})();
