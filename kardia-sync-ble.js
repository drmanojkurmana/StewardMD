/* StewardMD: Kardia SyncProbe BLE transport adapter.
 *
 * Implements the SyncProbe transport interface (see the shared contract) over the
 * KardiaBle Capacitor plugin. The Display is the GATT peripheral and the Probe is
 * the central. This file only moves the contract binary frames; pairing, crypto,
 * sequencing and validation stay in kardia-sync.js (KARDIA_SYNC).
 *
 * Frames are sent whole. A frame larger than the negotiated MTU minus 3 is
 * refused (send returns false). Android requests MTU 185, so the payload is
 * 182 bytes, which fits every contract frame including HELLO.
 *
 * On the web build there is no plugin, so capabilities reports available false.
 * Exposed as window.KARDIA_SYNC_BLE for tests and diagnostics. */
(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : {});
  if (W.KARDIA_SYNC_BLE && W.KARDIA_SYNC_BLE._installed) return;

  var SERVICE_UUID = "A91E0001-9D3C-4F5A-B2C4-1A2B3C4D5E6F";
  var INFO_UUID = "A91E0002-9D3C-4F5A-B2C4-1A2B3C4D5E6F";
  var DOWN_UUID = "A91E0003-9D3C-4F5A-B2C4-1A2B3C4D5E6F";
  var UP_UUID = "A91E0004-9D3C-4F5A-B2C4-1A2B3C4D5E6F";

  function bytesToBase64(bytes) {
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return W.btoa ? W.btoa(s) : "";
  }
  function base64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    var s = W.atob(b64);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }
  function normalizeBase64(v) {
    if (!v) return "";
    var s = String(v).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return s;
  }
  function bytesToHex(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += ("0" + bytes[i].toString(16)).slice(-2);
    return s;
  }
  function nowMs() { return typeof Date !== "undefined" ? Date.now() : 0; }

  var DISCOVER_TIMEOUT_MS = 10000;
  var DISCOVER_PAIRING_TTL_MS = 5 * 60 * 1000;
  var DISCOVER_NOT_FOUND = "No display found for that code. Check the code and keep both phones close together.";

  function normalizeShortCode(s) {
    return String(s == null ? "" : s).toUpperCase().replace(/[^A-Z2-9]/g, "");
  }
  function b64stdToB64url(s) {
    return String(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function notFoundError() {
    var e = new Error(DISCOVER_NOT_FOUND);
    e.reason = "not-found"; e.code = "not-found";
    return e;
  }
  function discoverBackoffMs(attempt) {
    return Math.min(2000 * Math.pow(2, Math.max(0, attempt || 0)), 15000);
  }
  function toDiscoveredPairing(res, code) {
    if (!res) throw notFoundError();
    var sid = String(res.sessionId || "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(sid)) throw notFoundError();
    var pubStd = String(res.displayPub || "");
    if (!pubStd) throw notFoundError();
    var pubBytes = base64ToBytes(normalizeBase64(pubStd));
    if (pubBytes.length !== 65 || pubBytes[0] !== 4) {
      throw new Error("That display did not return a valid key. Show a new code and try again.");
    }
    var exp = Number(res.expiresAt);
    if (!isFinite(exp) || exp <= 0) exp = nowMs() + DISCOVER_PAIRING_TTL_MS;
    var pubUrl = b64stdToB64url(pubStd);
    return {
      sessionId: sid, displayPub: pubUrl, shortCode: code, expiresAt: exp,
      protocolVersion: res.protocolVersion || 1,
      payload: "kardia-sync:1:" + sid + ":" + pubUrl + ":" + code + ":" + exp
    };
  }
  function toDiscoverError(err) {
    if (err && (err.reason === "not-found" || err.code === "not-found")) return err;
    var msg = (err && err.message) || "";
    if (/no display|not found|timed out|timeout/i.test(msg)) {
      var e = new Error(msg || DISCOVER_NOT_FOUND);
      e.reason = "not-found"; e.code = "not-found";
      return e;
    }
    return err instanceof Error ? err : new Error(msg || DISCOVER_NOT_FOUND);
  }

  function sha256Hex(text) {
    var c = W.crypto || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    if (!c || !c.subtle || !c.subtle.digest) return Promise.resolve("");
    var enc;
    if (typeof TextEncoder !== "undefined") enc = new TextEncoder().encode(text);
    else { enc = new Uint8Array(text.length); for (var i = 0; i < text.length; i++) enc[i] = text.charCodeAt(i) & 0xff; }
    return c.subtle.digest("SHA-256", enc).then(function (buf) {
      return bytesToHex(new Uint8Array(buf));
    }, function () { return ""; });
  }

  function findPlugin() {
    try {
      var C = W.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
      if (C.isPluginAvailable && !C.isPluginAvailable("KardiaBle")) return null;
      return (C.Plugins && C.Plugins.KardiaBle) || null;
    } catch (e) { return null; }
  }
  function platformName(pluginPlatform) {
    if (pluginPlatform) return pluginPlatform;
    try {
      var C = W.Capacitor;
      if (C && C.getPlatform) { var p = C.getPlatform(); if (p === "ios" || p === "android") return p; }
    } catch (e) {}
    return "web";
  }

  function createTransport(pluginOverride) {
    var plugin = pluginOverride || null;
    var handlers = null;
    var role = "";
    var connected = false;
    var maxPayload = 20;
    var listenerHandles = [];
    var sentCount = 0, recvCount = 0, sentWindow = [], recvWindow = [], lastRecvAt = 0;
    // Short code discovery state. One BLE scan at a time: concurrent discover
    // calls share the in-flight search. discoverAttempt counts consecutive
    // failures for the contract back-off ladder (2 s, 4 s, 8 s, cap 15 s).
    var discoverPending = null;
    var discoverAttempt = 0;

    function getPlugin() { return plugin || findPlugin(); }
    function prune(arr, t) { while (arr.length && t - arr[0] > 1000) arr.shift(); }
    function perSec(arr) { var t = nowMs(); prune(arr, t); return arr.length; }

    function attach(h) {
      handlers = h;
      var p = getPlugin();
      if (!p || !p.addListener) return Promise.resolve();
      var names = ["bytesReceived", "peerConnected", "peerLost", "bleError", "stateChanged"];
      var jobs = names.map(function (name) {
        var pr;
        try { pr = p.addListener(name, function (ev) { onEvent(name, ev || {}); }); }
        catch (e) { return Promise.resolve(); }
        return Promise.resolve(pr).then(function (handle) {
          if (handle) listenerHandles.push(handle);
        }, function () {});
      });
      return Promise.all(jobs).then(function () {});
    }
    function detach() {
      listenerHandles.forEach(function (h) { try { if (h && h.remove) h.remove(); } catch (e) {} });
      listenerHandles = [];
    }
    function onEvent(name, ev) {
      if (name === "bytesReceived") {
        var bytes = base64ToBytes(ev.data || "");
        recvCount++; recvWindow.push(nowMs()); lastRecvAt = nowMs();
        if (handlers && handlers.onBytes) handlers.onBytes(bytes);
      } else if (name === "peerConnected") {
        connected = true;
        if (typeof ev.maxPayload === "number" && ev.maxPayload > 0) maxPayload = ev.maxPayload;
        if (handlers && handlers.onPeerConnected) handlers.onPeerConnected(ev);
      } else if (name === "peerLost") {
        connected = false;
        if (handlers && handlers.onPeerLost) handlers.onPeerLost(ev.reason || "The other device disconnected.");
      } else if (name === "bleError") {
        if (handlers && handlers.onError) handlers.onError(new Error(ev.message || "Bluetooth error."));
      } else if (name === "stateChanged") {
        if (typeof ev.maxPayload === "number" && ev.maxPayload > 0) maxPayload = ev.maxPayload;
        if (ev.available === false && connected) {
          connected = false;
          if (handlers && handlers.onPeerLost) handlers.onPeerLost(ev.reason || "Bluetooth is no longer available.");
        }
      }
    }

    function codeHashHex(pairing) {
      if (pairing && pairing.codeHashHex) return Promise.resolve(String(pairing.codeHashHex).slice(0, 8).toLowerCase());
      if (!pairing || !pairing.shortCode) return Promise.resolve("");
      return sha256Hex(String(pairing.shortCode)).then(function (hex) { return hex.slice(0, 8); });
    }

    var transport = {
      id: "ble",
      kind: "direct",
      capabilities: function () {
        var p = getPlugin();
        if (!p) {
          return Promise.resolve({ available: false, reason: "Bluetooth pairing is only available in the app.", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 20, platform: "web" });
        }
        if (!p.getCapabilities) {
          return Promise.resolve({ available: false, reason: "The Bluetooth plugin is not ready.", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 20, platform: platformName("") });
        }
        return p.getCapabilities().then(function (c) {
          c = c || {};
          if (typeof c.maxPayload === "number" && c.maxPayload > 0) maxPayload = c.maxPayload;
          return {
            available: !!c.available,
            reason: c.reason || "",
            canAdvertise: !!c.canAdvertise,
            canScan: !!c.canScan,
            needsInternet: false,
            maxPayload: maxPayload,
            platform: platformName(c.platform)
          };
        }, function (e) {
          return { available: false, reason: (e && e.message) || "Bluetooth is not available.", canAdvertise: false, canScan: false, needsInternet: false, maxPayload: 20, platform: platformName("") };
        });
      },
      host: function (pairing, h) {
        var p = getPlugin();
        if (!p) return Promise.reject(new Error("Bluetooth pairing is only available in the app."));
        role = "display"; connected = false;
        return attach(h).then(function () { return codeHashHex(pairing); }).then(function (hash) {
          return p.host({
            sessionId: (pairing && pairing.sessionId) || "",
            codeHashHex: hash,
            displayPub: normalizeBase64(pairing && pairing.displayPub)
          });
        }).then(function () {
          // Refresh the real payload ceiling for this radio.
          if (p.getCapabilities) return p.getCapabilities().then(function (c) {
            if (c && typeof c.maxPayload === "number" && c.maxPayload > 0) maxPayload = c.maxPayload;
          }, function () {});
        });
      },
      join: function (pairing, h) {
        var p = getPlugin();
        if (!p) return Promise.reject(new Error("Bluetooth pairing is only available in the app."));
        role = "probe"; connected = false;
        return attach(h).then(function () { return codeHashHex(pairing); }).then(function (hash) {
          return p.join({
            sessionId: (pairing && pairing.sessionId) || "",
            codeHashHex: hash
          });
        });
      },
      discover: function (shortCode, timeoutMs) {
        var code = normalizeShortCode(shortCode);
        if (!code || code.length !== 6) {
          var bad = new Error("Enter the 6 character code shown on the display.");
          bad.reason = "not-found"; bad.code = "not-found";
          return Promise.reject(bad);
        }
        if (discoverPending) return discoverPending;
        var timeout = (typeof timeoutMs === "number" && timeoutMs > 0) ? timeoutMs : DISCOVER_TIMEOUT_MS;
        if (timeout > 30000) timeout = 30000;
        discoverPending = codeHashHex({ shortCode: code }).then(function (hash) {
          var p = getPlugin();
          if (!p) throw new Error("Bluetooth pairing is only available in the app.");
          if (!p.discover || typeof p.discover !== "function") {
            throw new Error("Bluetooth discovery needs the latest app build. Scan the QR code instead.");
          }
          var native;
          try {
            native = p.discover({ codeHashHex: hash, timeoutMs: timeout });
          } catch (e) { throw e; }
          var timer = null;
          var limit = new Promise(function (resolve, reject) {
            timer = setTimeout(function () { reject(notFoundError()); }, timeout);
          });
          return Promise.race([Promise.resolve(native), limit]).then(function (res) {
            if (timer) clearTimeout(timer);
            return toDiscoveredPairing(res, code);
          }, function (err) {
            if (timer) clearTimeout(timer);
            throw toDiscoverError(err);
          });
        }).then(function (pairing) {
          discoverAttempt = 0;
          return pairing;
        }, function (err) {
          discoverAttempt++;
          throw err;
        });
        var current = discoverPending;
        discoverPending.then(function () { if (discoverPending === current) discoverPending = null; },
          function () { if (discoverPending === current) discoverPending = null; });
        return discoverPending;
      },
      send: function (bytes) {
        if (!connected || !bytes) return false;
        var p = getPlugin();
        if (!p || !p.send) return false;
        if (bytes.length > maxPayload) return false;
        try {
          var r = p.send({ data: bytesToBase64(bytes) });
          if (r && typeof r.then === "function") r.then(function () {}, function () {});
        } catch (e) { return false; }
        sentCount++; sentWindow.push(nowMs());
        return true;
      },
      close: function () {
        var p = getPlugin();
        connected = false; role = "";
        detach();
        handlers = null;
        if (!p || !p.close) return Promise.resolve();
        return Promise.resolve(p.close({ reason: "closed" })).then(function () {}, function () {});
      },
      stats: function () {
        return { rttMs: 0, lossPct: 0, sentPerSec: perSec(sentWindow), recvPerSec: perSec(recvWindow), lastRecvAt: lastRecvAt };
      },
      // Test and diagnostic helpers (not part of the transport contract).
      _setConnected: function (v, payload) { connected = !!v; if (typeof payload === "number") maxPayload = payload; },
      _isConnected: function () { return connected; },
      _role: function () { return role; },
      _maxPayload: function () { return maxPayload; },
      _counts: function () { return { sent: sentCount, recv: recvCount }; },
      _discovering: function () { return !!discoverPending; },
      _discoverAttempt: function () { return discoverAttempt; },
      _discoverBackoffMs: function () { return discoverBackoffMs(discoverAttempt); }
    };
    return transport;
  }

  var transport = createTransport(null);
  var registered = false;
  function register() {
    if (registered) return true;
    try {
      var S = W.KARDIA_SYNC;
      if (S && typeof S.registerTransport === "function") {
        S.registerTransport(transport);
        registered = true;
        return true;
      }
    } catch (e) {}
    return false;
  }

  var api = {
    _installed: true,
    SERVICE_UUID: SERVICE_UUID,
    INFO_UUID: INFO_UUID,
    DOWN_UUID: DOWN_UUID,
    UP_UUID: UP_UUID,
    DISCOVER_TIMEOUT_MS: DISCOVER_TIMEOUT_MS,
    DISCOVER_NOT_FOUND: DISCOVER_NOT_FOUND,
    createTransport: createTransport,
    transport: transport,
    register: register,
    bytesToBase64: bytesToBase64,
    base64ToBytes: base64ToBytes,
    normalizeBase64: normalizeBase64,
    normalizeShortCode: normalizeShortCode,
    discoverBackoffMs: discoverBackoffMs
  };
  W.KARDIA_SYNC_BLE = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (!register() && typeof W.addEventListener === "function") {
    // KARDIA_SYNC may load after this file. Retry briefly without polling forever.
    var tries = 0;
    var timer = null;
    function retry() {
      tries++;
      if (register() || tries >= 20) { if (timer) clearInterval(timer); return; }
    }
    if (typeof setInterval !== "undefined") timer = setInterval(retry, 500);
    try { W.addEventListener("load", retry); } catch (e) {}
  }
})();
