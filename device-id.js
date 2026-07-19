/* StewardMD — stable per-device identity (window.SMD_DEVICE).
 *
 * The Experimental Access framework binds a one-time code to ONE device. That needs a device id
 * that is stable across launches. StewardMD has no @capacitor/device plugin, so:
 *   • getId()  → a persistent id. On first run it derives one — the native hardware id if the
 *     Device plugin is ever added, else a crypto UUID — and stores it under localStorage. From
 *     then on it ALWAYS returns the stored value, so adding the plugin later can't change the id
 *     and break existing activations. (The binding is enforced server-side regardless.)
 *   • getModel()   → a human label for the admin console (Device plugin info, else a coarse UA guess).
 *   • getPlatform()→ "ios" | "android" | "web".
 * All async (Promise) so it can transparently upgrade to the native plugin without a signature change.
 */
(function () {
  "use strict";
  var KEY = "smd_device_id";
  function C() { try { return window.Capacitor; } catch (e) { return null; } }
  function platform() { try { var c = C(); return (c && (c.getPlatform ? c.getPlatform() : c.platform)) || "web"; } catch (e) { return "web"; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function pluginDevice() { try { var c = C(); return c && c.Plugins && c.Plugins.Device; } catch (e) { return null; } }
  function uuid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    var b; try { b = new Uint8Array(16); crypto.getRandomValues(b); } catch (e) { b = []; for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256); }
    return Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
  }
  function coarseModel() {
    try {
      var ua = navigator.userAgent || "";
      if (/iPad/.test(ua)) return "iPad";
      if (/iPhone/.test(ua)) return "iPhone";
      var m = ua.match(/Android[^;]*;\s*([^);]+)/); if (m) return m[1].replace(/Build.*/, "").trim();
      if (/Macintosh/.test(ua)) return "Mac";
      if (/Windows/.test(ua)) return "Windows PC";
    } catch (e) {}
    return platform() + " device";
  }
  function getId() {
    var cur = lsGet(KEY); if (cur) return Promise.resolve(cur);
    var D = pluginDevice(), p = Promise.resolve(null);
    if (D && D.getId) p = Promise.resolve().then(function () { return D.getId(); }).then(function (r) { var hw = r && (r.identifier || r.uuid); return hw ? ("hw-" + hw) : null; }).catch(function () { return null; });
    return p.then(function (hw) { var id = hw || ("dev-" + uuid()); lsSet(KEY, id); return id; });
  }
  function getModel() {
    var D = pluginDevice();
    if (D && D.getInfo) return Promise.resolve().then(function () { return D.getInfo(); }).then(function (i) { return (i && ([i.manufacturer, i.model].filter(Boolean).join(" ") || i.model)) || coarseModel(); }).catch(coarseModel);
    return Promise.resolve(coarseModel());
  }
  window.SMD_DEVICE = { getId: getId, getModel: getModel, getPlatform: platform };
})();
