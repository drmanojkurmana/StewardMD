/* StewardMD — Offline CLINICAL data (structured "gold" records + openFDA monographs).
 * ===========================================================================
 * The drug detail screen's clinical sections (Quick Facts / Summary / Indications /
 * dosing / renal / hepatic / safety) come from the API's /structured and /monograph
 * endpoints. Offline, those returned nothing ("No structured clinical record…").
 *
 * This module ships a compact, gzipped clinical bundle INSIDE the app
 * (data/offline-clinical.json.gz, built by scripts/build-offline-clinical.mjs — 1,465
 * gold molecules + 934 monographs) and routes MEDAPI.structured / MEDAPI.monograph to
 * it when the drug API is unreachable, returning the SAME response shapes so the UI
 * renders identically to online. Data is lazy-loaded + decompressed on first use.
 *
 * Native-only (the file is bundled; the web PWA uses the live API). Reversible:
 * localStorage "stewardmd_offline_clinical"="0" disables it. No API-shape guessing —
 * mirrors worker/src/index.js handleStructured / handleMonograph exactly.
 * ======================================================================== */
(function () {
  "use strict";
  var C = window.Capacitor;
  var isNative = !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  if (!isNative) { window.SMD_OFFLINE_CLINICAL = { isNative: false }; return; }

  var VER = "gold239";                            // bump with the bundle so a cached gz is busted
  var URL_GZ = "/offline-clinical.json.gz?v=" + VER;
  var FLAG = "stewardmd_offline_clinical";        // "0" disables
  var _data = null;      // { v, struct:{comp:{gold|fields}}, mono:{comp:{…}} }
  var _lc = null;        // lowercased alias index → exact key ("s:"/"m:" prefixed)
  var _loading = null;   // in-flight load promise

  function enabled() { try { return localStorage.getItem(FLAG) !== "0"; } catch (e) { return true; } }
  function online() { return typeof navigator === "undefined" || navigator.onLine !== false; }

  /* -------- lazy load + decompress the bundled gz, cached in memory -------- */
  function fflateText(gz) {
    if (window.fflate && window.fflate.gunzipSync) return Promise.resolve(new TextDecoder().decode(window.fflate.gunzipSync(gz)));
    return Promise.reject(new Error("no gunzip available"));
  }
  function gunzipToText(gz) {
    if (typeof DecompressionStream !== "undefined") {
      try {
        var ds = new Response(new Blob([gz])).body.pipeThrough(new DecompressionStream("gzip"));
        // Fall back to fflate on BOTH a sync throw (below) and an async stream error (.catch).
        return new Response(ds).text().catch(function () { return fflateText(gz); });
      } catch (e) { /* sync construction failure → fflate */ }
    }
    return fflateText(gz);
  }
  function ensureData() {
    if (_data) return Promise.resolve(_data);
    if (_loading) return _loading;
    _loading = fetch(URL_GZ)
      .then(function (res) { if (!res.ok) throw new Error("clinical fetch " + res.status); return res.arrayBuffer(); })
      .then(function (ab) { return gunzipToText(new Uint8Array(ab)); })
      .then(function (txt) {
        var d = JSON.parse(txt);
        _lc = {};
        Object.keys(d.struct || {}).forEach(function (k) { _lc["s:" + k.toLowerCase()] = k; });
        Object.keys(d.mono || {}).forEach(function (k) { _lc["m:" + k.toLowerCase()] = k; });
        _data = d;
        return d;
      })
      .catch(function (e) { _loading = null; throw e; });   // allow a later retry
    return _loading;
  }

  /* -------- lookups (exact, then case-insensitive) -------- */
  function lookStruct(name) { var s = _data.struct || {}; if (s[name]) return s[name]; var k = _lc["s:" + String(name).toLowerCase()]; return k ? s[k] : null; }
  function lookMono(name) { var m = _data.mono || {}; if (m[name]) return m[name]; var k = _lc["m:" + String(name).toLowerCase()]; return k ? m[k] : null; }
  function isCombo(name) { return /\s\+\s/.test(String(name)); }
  function splitCombo(name) { return String(name).split(/\s*\+\s*/).map(function (s) { return s.trim(); }).filter(Boolean); }

  /* -------- response builders — identical shapes to the worker handlers -------- */
  function structResp(name) {
    return ensureData().then(function () {
      if (isCombo(name)) {
        var comps = splitCombo(name).map(function (p) { return { name: p, data: lookStruct(p) || null }; });
        return { composition: name, combo: true, found: comps.some(function (c) { return c.data; }), components: comps };
      }
      var d = lookStruct(name);
      return d ? { composition: name, found: true, data: d } : { composition: name, found: false };
    });
  }
  function monoResp(name) {
    return ensureData().then(function () {
      if (isCombo(name)) {
        var comps = splitCombo(name).map(function (p) { return { name: p, monograph: lookMono(p) || null }; });
        return { composition: name, combo: true, found: comps.some(function (c) { return c.monograph; }), components: comps };
      }
      var d = lookMono(name);
      return d ? { composition: name, found: true, monograph: d } : { composition: name, found: false };
    });
  }

  /* -------- route MEDAPI.structured / .monograph to local when API is unreachable -------- */
  function installRouting() {
    var M = window.MEDAPI; if (!M || M._smdClinicalWrapped) return;
    function wrap(name, localFn) {
      var orig = M[name];
      M[name] = function (arg) {
        if (enabled() && !online()) return localFn(arg).catch(function () { return { composition: arg, found: false }; });  // offline → local
        return orig.apply(M, arguments).then(function (res) {
          if (enabled() && res == null) return localFn(arg).catch(function () { return null; });  // API null/unreachable → local backfill
          return res;
        }).catch(function () { return enabled() ? localFn(arg).catch(function () { return null; }) : null; });
      };
    }
    wrap("structured", structResp);
    wrap("monograph", monoResp);
    M._smdClinicalWrapped = true;
  }

  // MEDAPI (api.js) loads before us, but guard for load-order regardless.
  (function whenMedapi() {
    if (window.MEDAPI) { installRouting(); return; }
    var n = 0, t = setInterval(function () { if (window.MEDAPI || ++n > 100) { clearInterval(t); if (window.MEDAPI) installRouting(); } }, 50);
  })();

  window.SMD_OFFLINE_CLINICAL = {
    isNative: true,
    isEnabled: enabled,
    setEnabled: function (on) { try { localStorage.setItem(FLAG, on ? "1" : "0"); } catch (e) {} },
    preload: ensureData,                    // optional warm-up (e.g. when the Drugs DB opens)
    structured: structResp,
    monograph: monoResp,
    stats: function () { return _data ? { struct: Object.keys(_data.struct || {}).length, mono: Object.keys(_data.mono || {}).length } : null; }
  };
})();
