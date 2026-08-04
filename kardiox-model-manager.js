/* kardiox-model-manager.js — KardiQ X AI · on-device model pack manager (SMD_KARDIOX_MODELMGR).
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

  // Pack registry. `bytes`/`sha256` = exact size + hash on R2 (verified live) → byte-weighted progress
  // + post-download integrity. v1 ships the 7 EcgLib heads the on-device analyzer runs (≈ 146 MiB);
  // ecg_diagnosis + HeartGPT are already on R2 for the full-ensemble follow-up (kept out of v1 so first
  // use downloads only what runs). int8 shrink is a later optimisation.
  var PACKS = {
    diagnosis: {
      label: "KardiQ X AI (analysis)",
      files: [
        { name: "ecglib_AFIB.onnx", bytes: 22506708, sha256: "9d8f446df4e5abdb198d3325dce7fd09adf6ebc58224b97b1f753ed01249d260" },
        { name: "ecglib_1AVB.onnx", bytes: 22506708, sha256: "060307a9bc2a86ffe570be3c7bf7b0b548060333da2ee0770c61681102fac370" },
        { name: "ecglib_SBRAD.onnx", bytes: 22506708, sha256: "f9dc675ae4a11b6ab4c5b6aa0c3b75e1b85f0ee3fa5818cc5a082902d1147cb2" },
        { name: "ecglib_STACH.onnx", bytes: 22506708, sha256: "3a65c8e8272961363d1a36992fdb9af17a726c05f0dd3bb63175e3c60e355b98" },
        { name: "ecglib_PVC.onnx", bytes: 22506708, sha256: "a2e2938c15f4b26b4c3aba3349b0468c317d6e42f3e0b757e6d28e6ee03ddee7" },
        { name: "ecglib_CRBBB.onnx", bytes: 22506708, sha256: "1f37e51563a6f5e7b7bc6fee3498aff771087e4b03a8bc54d9825c0cf03e1d94" },
        { name: "ecglib_IRBBB.onnx", bytes: 22506708, sha256: "69fc68ad49f17e3acdcd53a5c28758c8b69a9495899ac69c1da34b9172cef8e8" }
      ]
    }
    // digitiser pack + full-ensemble (ecg_diagnosis/heartgpt) packs added in later increments
  };
  function totalBytes(id) { return pack(id).files.reduce(function (s, f) { return s + (f.bytes || 0); }, 0); }

  function cap() { try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; } }
  function isNative() { var c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); }
  function fs() { var c = cap(); return (c && c.Plugins && c.Plugins.Filesystem) || null; }
  // Prefer the original, streamable web fetch (window.CapacitorWebFetch) for the model downloads.
  // On native, CapacitorHttp replaces window.fetch with a native-bridge version that base64-marshals
  // the whole response over the JS bridge — fragile for the ECG models (7 x ~22.5 MB = ~157 MB) and
  // can fail ("Load failed"). CapacitorWebFetch downloads straight through the WebView's native
  // networking, so the large downloads complete reliably. Falls back to global fetch on web / tests.
  function fetchImpl() {
    try { if (typeof window !== "undefined" && typeof window.CapacitorWebFetch === "function") return window.CapacitorWebFetch.bind(window); } catch (e) {}
    return (typeof fetch !== "undefined") ? fetch : null;
  }
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

  // ── download the whole pack (skip files already present); reports 0..1 byte-weighted progress ──
  function ensure(id, onProgress) {
    var F = fs(), fx = fetchImpl();
    if (!fx) return Promise.reject(new Error("no fetch"));
    if (!isNative() || !F) return Promise.resolve({ cached: false });   // web: stream from host at load time
    var files = pack(id).files, total = totalBytes(id) || files.length, doneBytes = 0;
    function tick(f) { doneBytes += (f.bytes || (total / files.length)); if (onProgress) onProgress(Math.min(1, doneBytes / total)); }
    function step(i) {
      if (i >= files.length) { if (onProgress) onProgress(1); return Promise.resolve({ cached: true }); }
      var f = files[i], rp = relPath(f.name);
      return F.stat({ path: rp, directory: DIR }).then(function (s) { return (s && s.size) > 0; }).catch(function () { return false; })
        .then(function (present) {
          if (present) { tick(f); return step(i + 1); }
          return fx(HOST + "/" + f.name).then(function (r) {
            if (!r || !r.ok) throw new Error("download failed: " + f.name + " (" + (r && r.status) + ")");
            return r.arrayBuffer();
          }).then(function (ab) {
            // integrity: a corrupt/truncated weight file must never silently reach inference
            if (f.bytes && ab.byteLength !== f.bytes) throw new Error("size mismatch: " + f.name + " got " + ab.byteLength + " want " + f.bytes);
            return F.writeFile({ path: rp, data: abToB64(ab), directory: DIR, recursive: true });
          }).then(function () { tick(f); return step(i + 1); });
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

  var API = { PACKS: PACKS, HOST: HOST, totalBytes: totalBytes, installed: installed, ensure: ensure,
              remove: remove, source: source, _b64: { abToB64: abToB64, b64ToU8: b64ToU8 } };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_KARDIOX_MODELMGR = API;
})();
