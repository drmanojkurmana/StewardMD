/* kardiox-model-manager.js — KardioX AI · on-device model pack manager (SMD_KARDIOX_MODELMGR).
 *
 * Mirrors the Whisper pattern (native-bridge.js): the app bundle stays small; the ONNX model pack is
 * DOWNLOADED on first use from the re-host (models.stewardmd.in/kardiox), cached on-device via
 * @capacitor/filesystem, and can be DELETED to free space. onnxruntime-web then loads each model from the
 * cached bytes and runs inference ON-DEVICE (no server, no PHI upload). Web fallback streams from the host
 * (no persistent cache). Pure logic — Capacitor + fetch are looked up lazily so this is unit-testable.
 *
 * Packs (download only what's needed):
 *   diagnosis — EcgLib 7 heads + ECG-Diagnosis + HeartGPT (the analysis ensemble)
 *   digitiser — the image→signal model (added in the next increment)
 */
(function () {
  "use strict";

  var HOST = "https://models.stewardmd.in/kardiox";   // R2 (stewardmd-models) via the models.* domain
  var DIR = "DATA";                                    // @capacitor/filesystem Directory (persistent)
  var SUBDIR = "kardiox-models";

  // Pack registry. `bytes` is the expected size (integrity + progress); sha256 optional (native verify).
  // Filled with the int8-quantised ONNX once uploaded to R2; sizes are placeholders until then.
  var PACKS = {
    diagnosis: {
      label: "KardioX AI (analysis)",
      files: [
        { name: "ecglib_AFIB.onnx" }, { name: "ecglib_1AVB.onnx" }, { name: "ecglib_SBRAD.onnx" },
        { name: "ecglib_STACH.onnx" }, { name: "ecglib_PVC.onnx" }, { name: "ecglib_CRBBB.onnx" },
        { name: "ecglib_IRBBB.onnx" }, { name: "ecg_diagnosis.onnx" },
        { name: "heartgpt_afib.onnx" }, { name: "heartgpt_afib.onnx.data" }
      ]
    }
    // digitiser pack added next increment
  };

  function cap() { try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; } }
  function isNative() { var c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); }
  function fs() { var c = cap(); return (c && c.Plugins && c.Plugins.Filesystem) || null; }
  function fetchImpl() { return (typeof fetch !== "undefined") ? fetch : null; }
  function pack(id) { var p = PACKS[id]; if (!p) throw new Error("unknown pack: " + id); return p; }
  function relPath(file) { return SUBDIR + "/" + file; }

  // ── base64 <-> ArrayBuffer (Filesystem stores binary as base64) ──
  function abToB64(ab) {
    var bytes = new Uint8Array(ab), bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bytes).toString("base64");
  }
  function b64ToU8(b64) {
    var bin = (typeof atob !== "undefined") ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8;
  }

  // ── is a pack fully cached on-device? ──
  function installed(id) {
    var F = fs(); if (!isNative() || !F) return Promise.resolve(false);
    var files = pack(id).files;
    return files.reduce(function (chain, f) {
      return chain.then(function (ok) {
        if (!ok) return false;
        return F.stat({ path: relPath(f.name), directory: DIR }).then(function (s) { return (s && s.size) > 0; }).catch(function () { return false; });
      });
    }, Promise.resolve(true));
  }

  // ── download the whole pack (skip files already present); reports 0..1 progress ──
  function ensure(id, onProgress) {
    var F = fs(), fx = fetchImpl();
    if (!fx) return Promise.reject(new Error("no fetch"));
    if (!isNative() || !F) return Promise.resolve({ cached: false });   // web: stream from host at load time
    var files = pack(id).files, done = 0;
    function step(i) {
      if (i >= files.length) { if (onProgress) onProgress(1); return Promise.resolve({ cached: true }); }
      var f = files[i], rp = relPath(f.name);
      return F.stat({ path: rp, directory: DIR }).then(function (s) { return (s && s.size) > 0; }).catch(function () { return false; })
        .then(function (present) {
          if (present) { done++; if (onProgress) onProgress(done / files.length); return step(i + 1); }
          return fx(HOST + "/" + f.name).then(function (r) {
            if (!r || !r.ok) throw new Error("download failed: " + f.name + " (" + (r && r.status) + ")");
            return r.arrayBuffer();
          }).then(function (ab) {
            return F.writeFile({ path: rp, data: abToB64(ab), directory: DIR, recursive: true });
          }).then(function () { done++; if (onProgress) onProgress(done / files.length); return step(i + 1); });
        });
    }
    return step(0);
  }

  // ── delete the cached pack (frees storage) ──
  function remove(id) {
    var F = fs(); if (!isNative() || !F) return Promise.resolve();
    return pack(id).files.reduce(function (chain, f) {
      return chain.then(function () { return F.deleteFile({ path: relPath(f.name), directory: DIR }).catch(function () {}); });
    }, Promise.resolve());
  }

  // ── model bytes for onnxruntime-web: cached file on native, else the remote URL (web) ──
  //    Returns { bytes: Uint8Array } | { url: string } for ort.InferenceSession.create(...).
  function source(file) {
    var F = fs();
    if (isNative() && F) {
      return F.readFile({ path: relPath(file), directory: DIR }).then(function (r) { return { bytes: b64ToU8(r.data) }; });
    }
    return Promise.resolve({ url: HOST + "/" + file });
  }

  var API = { PACKS: PACKS, HOST: HOST, installed: installed, ensure: ensure, remove: remove, source: source,
              _b64: { abToB64: abToB64, b64ToU8: b64ToU8 } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_MODELMGR = API;
})();
