/* StewardMD — MaiK on-device model pack manager (window.SMD_MAIK_MODELS).
 * ===========================================================================
 * Downloads, verifies, caches and deletes the GGUF weights the offline MaiK engine runs
 * (see maik-engine.js for the engine picker, maik-local.js for inference).
 *
 * WHY NOT kardiox-model-manager.js: that module base64-encodes the WHOLE file for
 * Filesystem.writeFile. At 22 MB per ONNX head that is fine; at 2.5 GB it is a 2.5 GB buffer plus
 * a ~3.3 GB base64 string and the app is killed instantly. So this module streams instead.
 *
 * DOWNLOAD DESIGN — the owner's requirement was "make it easy, don't make it hard for someone
 * with ample storage and network speed, and make it resumable":
 *   • RESUMABLE. We stat what is already on disk and continue with an HTTP Range request from that
 *     byte. Closing the app, losing signal or switching networks costs you the current chunk, not
 *     the download. Filesystem.downloadFile() streams natively but cannot resume, which is why we
 *     do our own chunked Range loop instead.
 *   • NO Wi-Fi GATE, no metered-network nag, no "are you sure" wall. If someone taps download, they
 *     get the download.
 *   • BOUNDED MEMORY. Chunks are CHUNK_BYTES at a time (base64 of one chunk, not of the file), so
 *     peak overhead is tens of MB regardless of model size.
 *   • Progress is a real byte fraction, so a big download shows honest movement.
 *
 * INTEGRITY: we check the exact byte length, then the GGUF magic, then let llama.cpp's own loader
 * reject anything structurally wrong. We deliberately do NOT hash the whole file on device.
 * ponytail: size + magic + loader validation, not a full SHA-256 (which would mean reading 2.5 GB
 * back through the bridge). The sha256 below is for OFF-device verification only.
 *
 * CAUTION on those hashes: HuggingFace's API `lfs.oid` is NOT the file's SHA-256 for Xet-backed
 * repos (these are - the responses carry an X-Xet-Hash header), it is a Xet content hash. The
 * MedGemma value below was recomputed with `shasum -a 256` over the fully downloaded 2,489,894,976
 * bytes and IS the real digest. The E2B one is still the API's oid and is NOT verified - do not
 * trust it until someone downloads that file and re-hashes it.
 * ======================================================================== */
(function () {
  "use strict";

  var DIR = "DATA";                 // @capacitor/filesystem Directory (persistent)
  var SUBDIR = "maik-models";
  var CHUNK_BYTES = 24 * 1024 * 1024;   // 24 MiB per Range request (~32 MiB base64 peak)
  var MARK_PREFIX = "smd_maik_pack_";   // localStorage install marker (sync check for settingsHTML)

  /* Pack registry.
   *
   * Sizes and sha256 are the REAL values read from the HuggingFace API on 2026-08-20, not
   * estimates. The lineup is decided by what fits the floor device (iPhone 15 Pro, 8 GB):
   *
   *   MedGemma 1.5 4B Q4_K_M  2.49 GB  PRIMARY. Medical-tuned and the only candidate that fits
   *                                    the 8 GB device with comfortable headroom.
   *   Gemma 4 E2B Q4_K_M      3.11 GB  Comparison pack. Newer general base, official QAT lineage.
   *                                    Feasible only with the increased-memory-limit entitlement.
   *
   * Gemma 4 E4B is NOT offered: the "E" is EFFECTIVE parameters (Per-Layer Embeddings) but the
   * GGUF is sized by RAW parameters, so E4B Q4_K_M is 4.98 GB and its smallest sane quant
   * (Q3_K_S) is still 3.86 GB. It does not fit the floor device, whatever the benchmarks say.
   *
   * Hosting: HuggingFace CDN (public, ungated, supports Range). Moving these to the existing
   * models.stewardmd.in R2 bucket is the production step - it gives us control over availability
   * and avoids a third party rate-limiting a clinician mid-download.
   */
  var HF = "https://huggingface.co";
  var PACKS = {
    "maik-local-v1": {
      label: "MedGemma 1.5 4B (Q4_K_M)",
      note: "Medical-tuned. Fits every supported iPhone and Pixel.",
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "medgemma-1.5-4b-it-Q4_K_M.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/medgemma-1.5-4b-it-Q4_K_M.gguf?download=true",
        bytes: 2489894976,   // exact, from the HuggingFace API 2026-08-20
        sha256: "49bfba86b0f3607d250fba3489299a46d4f83e657da5ad87bca08b2948abda1a"   // VERIFIED off-device
      }]
    },
    "maik-local-e2b": {
      label: "Gemma 4 E2B (Q4_K_M)",
      note: "General-purpose comparison model. Needs a little more memory.",
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "gemma-4-E2B-it-Q4_K_M.gguf",
        url: HF + "/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf?download=true",
        bytes: 3106738272,
        sha256: "740185b21d22ceb83a11c3aa62ad5842ef32c70f6096d756bbee85a1e4ec34b8"   // UNVERIFIED: HF Xet oid, not a real sha256
      }]
    }
  };

  function pack(id) { var p = PACKS[id]; if (!p) throw new Error("unknown pack: " + id); return p; }
  function relPath(f) { return SUBDIR + "/" + f; }
  function totalBytes(id) { return pack(id).files.reduce(function (s, f) { return s + (f.bytes || 0); }, 0); }
  function sizeLabel(id) {
    var gb = totalBytes(id) / 1e9;
    return (gb >= 1 ? gb.toFixed(2) + " GB" : Math.round(totalBytes(id) / 1e6) + " MB");
  }

  function cap() { try { return (typeof window !== "undefined" && window.Capacitor) || null; } catch (e) { return null; } }
  function isNative() { var c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); }
  function fs() { var c = cap(); return (c && c.Plugins && c.Plugins.Filesystem) || null; }
  function llama() { var c = cap(); return (c && c.Plugins && c.Plugins.Llama) || null; }

  // Prefer the pristine WebView fetch: on native, CapacitorHttp replaces window.fetch with a
  // bridge version that base64-marshals whole responses. Same reasoning as kardiox-model-manager.
  function fetchImpl() {
    try { if (typeof window !== "undefined" && typeof window.CapacitorWebFetch === "function") return window.CapacitorWebFetch.bind(window); } catch (e) {}
    return (typeof fetch !== "undefined") ? fetch : null;
  }

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function abToB64(ab) {
    var bytes = new Uint8Array(ab), bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bytes).toString("base64");
  }

  // ── on-disk size of one file (0 when absent) ──
  function sizeOf(name) {
    var F = fs(); if (!F) return Promise.resolve(0);
    return F.stat({ path: relPath(name), directory: DIR })
      .then(function (s) { return (s && s.size) || 0; })
      .catch(function () { return 0; });
  }

  // ── install state ──
  // installedCached() is SYNCHRONOUS because maik-engine.js settingsHTML() renders synchronously.
  // The marker is only written after a verified download, and cleared by remove().
  function installedCached(id) { return lget(MARK_PREFIX + id) === "1"; }

  function installed(id) {
    if (!isNative() || !fs()) return Promise.resolve(false);
    var files = pack(id).files;
    return files.reduce(function (chain, f) {
      return chain.then(function (ok) {
        if (!ok) return false;
        return sizeOf(f.name).then(function (n) { return f.bytes ? n === f.bytes : n > 0; });
      });
    }, Promise.resolve(true)).then(function (ok) {
      if (ok) lset(MARK_PREFIX + id, "1"); else lrem(MARK_PREFIX + id);
      return ok;
    });
  }

  // ── absolute on-device path for the native plugin's load() ──
  function pathFor(id) {
    var F = fs(); if (!F) return Promise.reject(new Error("no filesystem"));
    return F.getUri({ path: relPath(pack(id).files[0].name), directory: DIR })
      .then(function (r) { return String((r && r.uri) || "").replace(/^file:\/\//, ""); });
  }

  /**
   * Download every file in the pack, resuming whatever is already on disk.
   * onProgress(fraction, note) is called as bytes land.
   */
  function ensure(id, onProgress) {
    var F = fs(), fx = fetchImpl();
    if (!isNative() || !F) return Promise.reject(new Error("on-device models need the native app"));
    if (!fx) return Promise.reject(new Error("no fetch available"));

    var files = pack(id).files;
    var grandTotal = totalBytes(id) || 1;
    var doneBefore = 0;

    function report(currentFileBytes, note) {
      if (!onProgress) return;
      var frac = Math.min(1, (doneBefore + currentFileBytes) / grandTotal);
      onProgress(frac, note);
    }

    // Ensure the directory exists, and keep a 2.5 GB re-downloadable model out of iCloud backup.
    function prepDir() {
      return F.mkdir({ path: SUBDIR, directory: DIR, recursive: true }).catch(function () { /* exists */ })
        .then(function () {
          var L = llama();
          if (!L || !L.excludeFromBackup) return null;
          return L.excludeFromBackup({ path: SUBDIR }).catch(function () { return null; });
        });
    }

    function oneFile(f) {
      return sizeOf(f.name).then(function (have) {
        if (f.bytes && have === f.bytes) { report(have, "Already downloaded"); return; }
        // A file LONGER than expected is corrupt (a previous bad append) - start it over.
        if (f.bytes && have > f.bytes) {
          return F.deleteFile({ path: relPath(f.name), directory: DIR }).catch(function () {})
            .then(function () { return pull(f, 0); });
        }
        if (have > 0) report(have, "Resuming at " + (have / 1e9).toFixed(2) + " GB");
        return pull(f, have);
      });
    }

    function pull(f, from) {
      var total = f.bytes || 0;

      function step(offset) {
        if (total && offset >= total) return verify(f, offset);
        var end = total ? Math.min(offset + CHUNK_BYTES, total) - 1 : offset + CHUNK_BYTES - 1;
        return fx(f.url, { headers: { Range: "bytes=" + offset + "-" + end } }).then(function (r) {
          // 206 = ranged (expected). 200 = server ignored Range; only usable from a cold start.
          if (!r || (r.status !== 206 && r.status !== 200)) throw new Error("download failed (" + (r && r.status) + ")");
          if (r.status === 200 && offset > 0) throw new Error("server ignored resume; delete the model and retry");
          if (!total) {
            var cr = r.headers && r.headers.get && r.headers.get("Content-Range");
            var m = cr && /\/(\d+)$/.exec(cr);
            if (m) total = parseInt(m[1], 10);
          }
          return r.arrayBuffer();
        }).then(function (ab) {
          // A ranged response with no body means the source has fewer bytes than the registry says
          // (truncated mirror, or a stale pack entry). Fall through to verify() so the user gets
          // "size mismatch" — which names the real problem — instead of "empty chunk at 4988000".
          if (!ab || ab.byteLength === 0) return verify(f, offset);
          if (offset === 0) checkMagic(ab);
          return F.appendFile({ path: relPath(f.name), data: abToB64(ab), directory: DIR })
            .then(function () {
              var next = offset + ab.byteLength;
              report(next, null);
              return step(next);
            });
        });
      }
      return step(from);
    }

    // GGUF files begin with the ASCII magic "GGUF". Catches an HTML error page saved as a model.
    function checkMagic(ab) {
      var b = new Uint8Array(ab, 0, Math.min(4, ab.byteLength));
      if (b.length < 4 || b[0] !== 0x47 || b[1] !== 0x47 || b[2] !== 0x55 || b[3] !== 0x46) {
        throw new Error("that is not a GGUF model file");
      }
    }

    function verify(f, written) {
      return sizeOf(f.name).then(function (n) {
        if (f.bytes && n !== f.bytes) throw new Error("size mismatch: got " + n + " want " + f.bytes);
        doneBefore += n;
        return null;
      });
    }

    return prepDir().then(function () {
      return files.reduce(function (chain, f) { return chain.then(function () { return oneFile(f); }); }, Promise.resolve());
    }).then(function () {
      lset(MARK_PREFIX + id, "1");
      if (onProgress) onProgress(1, "Ready");
      return { installed: true };
    });
  }

  // ── delete the cached pack (frees storage) ──
  function remove(id) {
    var F = fs();
    lrem(MARK_PREFIX + id);
    if (!isNative() || !F) return Promise.resolve();
    return pack(id).files.reduce(function (chain, f) {
      return chain.then(function () { return F.deleteFile({ path: relPath(f.name), directory: DIR }).catch(function () {}); });
    }, Promise.resolve());
  }

  var API = {
    PACKS: PACKS, SUBDIR: SUBDIR, CHUNK_BYTES: CHUNK_BYTES,
    totalBytes: totalBytes, sizeLabel: sizeLabel,
    installed: installed, installedCached: installedCached,
    ensure: ensure, remove: remove, pathFor: pathFor,
    _abToB64: abToB64
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_MAIK_MODELS = API;
})();
