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

  var VER = "gold241";                            // bump with the bundle so a cached gz is busted
  var URL_GZ = "/offline-clinical.json.gz?v=" + VER;
  // The 104 authored monographs the SQL-derived bundle never contained (Atropine sulfate,
  // Enoxaparin sodium, Clopidogrel bisulfate, Caspofungin acetate …). Built by
  // scripts/build-clinical-supplement.mjs; merged UNDER the bundle so a bundled record always wins.
  var SUP_VER = "sup1";
  var URL_SUP = "/clinical-supplement.json.gz?v=" + SUP_VER;
  // Name/class/tags only, so search costs 329 KB instead of the 6 MB bundle. Loaded on the first
  // search, not at boot. Built by scripts/build-clinical-index.mjs.
  var IDX_VER = "idx1";
  var URL_IDX = "/clinical-index.js?v=" + IDX_VER;
  var FLAG = "stewardmd_offline_clinical";        // "0" disables
  var _data = null;      // { v, struct:{comp:{gold|fields}}, mono:{comp:{…}} }
  var _lc = null;        // lowercased alias index → exact key ("s:"/"m:" prefixed)
  var _loading = null;   // in-flight load promise
  var _idx = null;       // in-flight/settled index load promise

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
  function fetchGz(url) {
    return fetch(url)
      .then(function (res) { if (!res.ok) throw new Error("clinical fetch " + res.status); return res.arrayBuffer(); })
      .then(function (ab) { return gunzipToText(new Uint8Array(ab)); })
      .then(function (txt) { return JSON.parse(txt); });
  }
  function ensureData() {
    if (_data) return Promise.resolve(_data);
    if (_loading) return _loading;
    // The supplement is optional: a missing or corrupt one must degrade to the bundle we always
    // had, never fail the lookup. Only the bundle's own failure is fatal.
    _loading = Promise.all([
      fetchGz(URL_GZ),
      fetchGz(URL_SUP).catch(function () { return null; })
    ])
      .then(function (parts) {
        var d = parts[0], sup = parts[1];
        if (sup && sup.struct) {
          var st = d.struct || (d.struct = {});
          Object.keys(sup.struct).forEach(function (k) { if (!st[k]) st[k] = sup.struct[k]; });
        }
        _lc = {};
        Object.keys(d.struct || {}).forEach(function (k) { _lc["s:" + k.toLowerCase()] = k; });
        Object.keys(d.mono || {}).forEach(function (k) { _lc["m:" + k.toLowerCase()] = k; });
        _data = d;
        return d;
      })
      .catch(function (e) { _loading = null; throw e; });   // allow a later retry
    return _loading;
  }

  /* -------- the search index: small, separate, loaded on the first search -------- */
  function ensureIndex() {
    if (window.SMD_CLINICAL_INDEX) return Promise.resolve(window.SMD_CLINICAL_INDEX);
    if (_idx) return _idx;
    _idx = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = URL_IDX;
      s.onload = function () { window.SMD_CLINICAL_INDEX ? resolve(window.SMD_CLINICAL_INDEX) : reject(new Error("index did not define SMD_CLINICAL_INDEX")); };
      s.onerror = function () { reject(new Error("index load failed")); };
      (document.head || document.documentElement).appendChild(s);
    }).catch(function (e) { _idx = null; throw e; });
    return _idx;
  }
  /* Resolves to [{ n, c, t, m }] — the molecules we hold a monograph for whose name, class or tag
   * matches. Never rejects: search must degrade to "nothing extra found", not to a broken screen. */
  function searchLocal(q, limit) {
    if (!enabled() || !String(q || "").trim()) return Promise.resolve([]);
    return ensureIndex()
      .then(function (I) { return I.search(q, limit || 25) || []; })
      .catch(function () { return []; });
  }

  /* -------- lookups (exact, then canonical/case-insensitive) -------- */
  function cleanComp(name) {
    var s = String(name || "").trim();
    if (/^sacubitril\s*[\/|+]\s*valsartan/i.test(s)) return "Sacubitril + Valsartan";
    if (/rabies\s*vaccine|human\s*\+\s*rabies|rabies.*human/i.test(s)) return "Rabies Vaccine";
    if (/tetanus\s*toxoid|tdap|\btt\b|adsorbed\s*tetanus/i.test(s)) return "Adsorbed Tetanus Vaccine";
    if (/rotavirus\s*vaccine/i.test(s)) return "Rotavirus Vaccine";
    if (/typhoid\s*vaccine|salmonella\s*typhi|purified\s*vi.*typhoid/i.test(s)) return "Purified Vi Polysaccharide Typhoid Vaccine";
    if (/hepatitis\s*b\s*vaccine|aluminium.*hepatitis\s*b/i.test(s)) return "Hepatitis B Vaccine";
    if (/hepatitis\s*a\s*vaccine/i.test(s)) return "Inactivated Hepatitis A Vaccine";
    if (/influenza\s*vaccine/i.test(s)) return "Inactivated Influenza Vaccine";
    if (/pneumococc\w*\s*(?:polysaccharide\s*)?conjugate\s*vaccine/i.test(s)) return "Pneumococcal Polysaccharide Conjugate Vaccine";
    if (/pneumococc\w*\s*polysaccharide\s*vaccine/i.test(s)) return "Pneumococcal Polysaccharide Vaccine";
    if (/measles.*mumps.*rubella|mmr/i.test(s)) return "Measles Vaccine";
    if (/varicella\s*vaccine/i.test(s)) return "Varicella Vaccine";
    if (/human\s*papilloma\w*|hpv/i.test(s)) return "Human Papillomavirus Vaccine";
    if (/herpes\s*zoster|shingles/i.test(s)) return "Herpes Zoster Vaccine";
    if (/\bbcg\b/i.test(s)) return "BCG Vaccine";
    if (/cholera\s*vaccine/i.test(s)) return "Cholera Vaccine";
    if (/polio\s*vaccine/i.test(s)) return "Polio Vaccine";
    if (/^dabigatran(?:\s+etexilate)?$/i.test(s)) return "Dabigatran Etexilate";
    if (/^metoprolol(?:\s+(?:succinate|tartrate))?$/i.test(s)) return "Metoprolol Succinate";
    if (/^noradrenaline(?:\s*\(.*?\))?$/i.test(s)) return "Norepinephrine";
    if (/^levothyroxine$/i.test(s)) return "Thyroxine";
    if (/^chlorphen(?:ir)?amine(?:\s+maleate)?$/i.test(s)) return "Chlorpheniramine Maleate";
    if (/^magnesium\s*sul(?:f|ph)ate$/i.test(s)) return "Magnesium Sulphate";
    if (/^insulin(?:\s*\(regular\))?$/i.test(s)) return "Human Insulin";
    s = s.replace(/\s*\([^)]*\)/g, " ");
    s = s.replace(/\s+\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|ml|l|%|iu|units?|meq|mmol)\b/gi, " ");
    return s.replace(/\s*\/\s*/g, " + ").replace(/\s*\+\s*/g, " + ").replace(/\s{2,}/g, " ").trim();
  }
  function lookStruct(name) {
    var s = _data.struct || {};
    if (s[name]) return s[name];
    var k = _lc["s:" + String(name).toLowerCase()];
    if (k && s[k]) return s[k];
    var cl = cleanComp(name);
    if (cl && cl !== name) {
      if (s[cl]) return s[cl];
      var kcl = _lc["s:" + cl.toLowerCase()];
      if (kcl && s[kcl]) return s[kcl];
    }
    return null;
  }
  function lookMono(name) {
    var m = _data.mono || {};
    if (m[name]) return m[name];
    var k = _lc["m:" + String(name).toLowerCase()];
    if (k && m[k]) return m[k];
    var cl = cleanComp(name);
    if (cl && cl !== name) {
      if (m[cl]) return m[cl];
      var kcl = _lc["m:" + cl.toLowerCase()];
      if (kcl && m[kcl]) return m[kcl];
    }
    return null;
  }
  function isCombo(name) { return /\s\+\s|\s*\/\s*/.test(String(name)); }
  function splitCombo(name) { return String(name).split(/\s*\+\s*|\s*\/\s*/).map(function (s) { return s.trim(); }).filter(Boolean); }

  /* -------- response builders — identical shapes to the worker handlers -------- */
  function structResp(name) {
    return ensureData().then(function () {
      if (isCombo(name)) {
        var comps = splitCombo(name).map(function (p) { return { name: p, data: lookStruct(p) || null }; });
        var hasAny = comps.some(function (c) { return c.data; });
        if (hasAny) {
          return { composition: name, combo: true, found: true, components: comps };
        }
      }
      var d = lookStruct(name);
      return d ? { composition: name, found: true, data: d } : { composition: name, found: false };
    });
  }
  function monoResp(name) {
    return ensureData().then(function () {
      if (isCombo(name)) {
        var comps = splitCombo(name).map(function (p) { return { name: p, monograph: lookMono(p) || null }; });
        var hasAny = comps.some(function (c) { return c.monograph; });
        if (hasAny) {
          return { composition: name, combo: true, found: true, components: comps };
        }
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
          if (enabled() && (!res || !res.found)) {
            return localFn(arg).then(function (loc) {
              return (loc && loc.found) ? loc : res;
            }).catch(function () { return res; });
          }
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
    search: searchLocal,                    // api.js falls back to this when the server finds nothing
    indexReady: function () { return !!window.SMD_CLINICAL_INDEX; },
    stats: function () { return _data ? { struct: Object.keys(_data.struct || {}).length, mono: Object.keys(_data.mono || {}).length, index: window.SMD_CLINICAL_INDEX ? SMD_CLINICAL_INDEX.count() : null } : null; }
  };
})();
