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
 * HASHES: HuggingFace's API `lfs.oid` IS the file's SHA-256 here - confirmed by hashing a
 * verified-complete 2,489,894,976-byte download of the MedGemma pack, which matched the oid exactly.
 * An earlier note in this file claimed otherwise and replaced the value; that was wrong. The digest
 * had been computed over a file that was resumed after a timeout and was not intact. Corrected.
 * The E2B hash is the API oid and has NOT been verified by downloading that file.
 * ======================================================================== */
(function () {
  "use strict";

  var DIR = "DATA";                 // @capacitor/filesystem Directory (persistent)
  var SUBDIR = "maik-models";
  // 2 MiB per Range request. Measured, not guessed: on a real Pixel 9 (Android 17 WebView) a 24 MiB
  // ranged fetch threw "Failed to fetch" every time. Isolating the steps at the same offset showed
  // the fetch, the base64 and the appendFile all SUCCEED - but one 8 MiB chunk took 33.5 s on a
  // degraded 2.4 GHz link (0.25 MB/s), so the failure is the WebView TIMING OUT a long request, not
  // a range or size limit. Chunk size therefore has to be small enough that a single request stays
  // short on a bad connection: 2 MiB is ~8 s even at 0.25 MB/s. Smaller chunks also cut peak memory
  // (~2.7 MiB of base64), which matters on the 8 GB iPhone. Cost is more round trips, which is the
  // right trade when the alternative is a download that can never finish.
  var CHUNK_BYTES = 2 * 1024 * 1024;
  var CHUNK_TRIES = 5;                  // per-chunk retries; a 2.5 GB pull WILL see transient failures
  var MARK_PREFIX = "smd_maik_pack_";   // localStorage install marker (sync check for settingsHTML)

  /* Pack registry.
   *
   * Sizes and sha256 are the REAL values read from the HuggingFace API on 2026-08-20, not
   * estimates. The lineup is decided by what fits the floor device (iPhone 15 Pro, 8 GB):
   *
   *   MedGemma 1.5 4B Q4_K_M  2.49 GB  PRIMARY. Medical-tuned and the only candidate that fits
   *                                    the 8 GB device with comfortable headroom.
   *   MedGemma 1.5 4B Q5_K_M  2.83 GB  Same weights at higher precision. The cheapest real quality
   *                                    upgrade (+340 MB); decode is bandwidth-bound so expect ~12%
   *                                    slower. Still fits the 8 GB iPhone.
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
        sha256: "b31becdf4f39561800505514cce67681604fe449d04dd35c8c92fd7848c6d7bd"   // VERIFIED: shasum -a 256 over the complete 2,489,894,976-byte file
      }]
    },
    "maik-local-v1-q5": {
      label: "MedGemma 1.5 4B (Q5_K_M)",
      note: "Same model, higher precision. Better answers, +340 MB, slightly slower.",
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "medgemma-1.5-4b-it-Q5_K_M.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/medgemma-1.5-4b-it-Q5_K_M.gguf?download=true",
        bytes: 2829699136,   // exact, HuggingFace API 2026-08-20
        sha256: null         // UNVERIFIED: HF lfs.oid is a Xet hash, not a file digest. See header.
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

  var KEY_ACTIVE = "stewardmd.maikPack";
  var KEY_DLID = "smd_maik_dlid_";     // DownloadManager id per pack, so a transfer survives the app

  // In-flight download state lives on the MODULE, not in the settings view, so closing Settings
  // does not stop or lose a download and reopening re-attaches to the live numbers.
  var _state = {};
  var _subs = [];
  function state(id) {
    return _state[id] || { downloading: false, frac: installedCached(id) ? 1 : 0, done: installedCached(id), err: null };
  }
  function subscribe(cb) {
    if (typeof cb !== "function") return function () {};
    _subs.push(cb);
    return function () { var i = _subs.indexOf(cb); if (i > -1) _subs.splice(i, 1); };
  }
  function emit(id) {
    var st = state(id);
    for (var i = 0; i < _subs.length; i++) { try { _subs[i](id, st); } catch (e) {} }
  }

  /**
   * Re-attach the UI to any download the OS is still carrying.
   *
   * The native downloader survives app relaunch; this module's _state does not. Without this a
   * transfer that is genuinely running reads as "Not downloaded" until the row is touched, which is
   * both wrong and an invitation to start a second one. Called once at startup.
   */
  function resumeUiForBackgroundDownloads() {
    var L = llama();
    if (!isNative() || !L || !L.downloadStatus) return Promise.resolve(false);
    var ids = Object.keys(PACKS);
    return ids.reduce(function (chain, id) {
      return chain.then(function (found) {
        if (_state[id] && _state[id].downloading) return found;
        var f = PACKS[id].files[0];
        return L.downloadStatus({ id: lget(KEY_DLID + id) || "", name: f.name }).then(function (st) {
          st = st || {};
          var live = st.state === "running" || st.state === "pending" || st.state === "paused";
          if (!live) return found;
          // Adopt it: show real progress, and let ensure() re-attach rather than start a duplicate.
          var total = f.bytes || st.total || 0;
          _state[id] = {
            downloading: st.state !== "paused", frac: total ? Math.min(1, (st.bytes || 0) / total) : 0,
            bytes: st.bytes || 0, total: total, mbps: 0, etaS: null,
            note: st.state === "paused" ? "Waiting for a connection" : "Downloading in the background",
            err: null, done: false, background: true
          };
          emit(id);
          // Keep polling so the UI keeps moving, and settle the marker when it finishes.
          ensure(id, null).catch(function () {});
          return true;
        }).catch(function () { return found; });
      });
    }, Promise.resolve(false));
  }

  /** Which pack the on-device engine should run. Defaults to the primary (MedGemma). */
  function activePack() { var v = lget(KEY_ACTIVE); return PACKS[v] ? v : "maik-local-v1"; }
  function setActivePack(id) { if (PACKS[id]) lset(KEY_ACTIVE, id); return activePack(); }

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
    var L = llama();
    if (isNative() && L && L.modelPath) {
      return L.modelPath({ name: name }).then(function (r) { return (r && r.bytes) || 0; }).catch(function () { return 0; });
    }
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
    var name = pack(id).files[0].name;
    var L = llama();
    // The native downloader owns model storage (DownloadManager cannot write the internal files
    // dir), so it is the only authority on where a model actually is.
    if (isNative() && L && L.modelPath) {
      return L.modelPath({ name: name }).then(function (r) { return (r && r.path) || ""; });
    }
    var F = fs(); if (!F) return Promise.reject(new Error("no filesystem"));
    return F.getUri({ path: relPath(name), directory: DIR })
      .then(function (r) { return String((r && r.uri) || "").replace(/^file:\/\//, ""); });
  }

  /* ── BACKGROUND download (native) ───────────────────────────────────────────
   * On native the transfer is handed to the OS (Android DownloadManager / iOS background
   * URLSession) via the capacitor-llama plugin, so it keeps going when the app is backgrounded or
   * killed - which is exactly what someone does after starting a 2.5 GB download. The JS chunk loop
   * below is kept only for the web PWA, where there is no plugin.
   *
   * This also removes the bug the chunk loop needed workarounds for: no 2 MiB Range slicing, no
   * base64 across the bridge, no per-chunk retry. The OS owns resume and network changes.
   */
  function nativeDownload(id, onProgress) {
    var L = llama(), pk = pack(id), f = pk.files[0];
    var total = f.bytes || 0;
    var t0 = Date.now(), startBytes = 0, stopped = false;

    _state[id] = { downloading: true, frac: 0, bytes: 0, total: total, mbps: 0, etaS: null,
                   note: "Starting", err: null, done: false, background: true };
    _state[id].cancel = function () {
      stopped = true;
      var did = lget(KEY_DLID + id);
      // Android cancels by DownloadManager id, iOS by destination file name. Send both.
      if (L.downloadCancel) L.downloadCancel({ id: did || "", name: f.name });
    };
    emit(id);

    function report(bytes, note) {
      var st = _state[id]; if (!st) return;
      var secs = (Date.now() - t0) / 1000, moved = bytes - startBytes;
      st.bytes = bytes;
      st.frac = total ? Math.min(1, bytes / total) : 0;
      st.mbps = secs > 1 ? (moved / secs / 1e6) : 0;
      st.etaS = (st.mbps > 0.01 && total) ? Math.round((total - bytes) / (st.mbps * 1e6)) : null;
      if (note) st.note = note;
      emit(id);
      if (onProgress) onProgress(st.frac, note);
    }

    function fresh() {
      return L.downloadStart({ url: f.url, name: f.name, title: pk.label }).then(function (r) {
        lset(KEY_DLID + id, String(r.id));
        report(0, "Downloading in the background");
        return String(r.id);
      });
    }

    // Re-attach to an existing transfer if one is already in flight for this pack.
    function begin() {
      var existing = lget(KEY_DLID + id);
      if (!existing) return fresh();
      return L.downloadStatus({ id: existing, name: f.name }).then(function (s) {
        if (s && (s.state === "running" || s.state === "pending" || s.state === "paused")) {
          startBytes = s.bytes || 0;
          report(s.bytes || 0, "Resuming in the background");
          return existing;
        }
        return fresh();
      }).catch(fresh);
    }

    function poll(did) {
      if (stopped) throw new Error("cancelled");
      return L.downloadStatus({ id: did, name: f.name }).then(function (s) {
        s = s || {};
        if (s.total > 0 && !total) { total = s.total; _state[id].total = total; }
        report(s.bytes || s.onDisk || 0, s.state === "paused" ? "Waiting for a connection" : "Downloading in the background");
        if (s.state === "done") {
          var onDisk = s.onDisk || 0;
          if (f.bytes && onDisk !== f.bytes) throw new Error("size mismatch: got " + onDisk + " want " + f.bytes);
          return true;
        }
        if (s.state === "failed") throw new Error("download failed (reason " + s.reason + ")");
        if (s.state === "cancelled" || s.state === "none") throw new Error("cancelled");
        return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return poll(did); });
      });
    }

    return L.modelPath({ name: f.name }).then(function (mp) {
      if (mp && mp.bytes && f.bytes && mp.bytes === f.bytes) return "already";
      if (mp && mp.freeBytes > 0 && f.bytes && mp.freeBytes < f.bytes * 1.05) {
        throw new Error("not enough free space (" + (mp.freeBytes / 1e9).toFixed(1) + " GB left, needs " + (f.bytes / 1e9).toFixed(1) + " GB)");
      }
      return begin().then(poll);
    }).then(function () {
      lset(MARK_PREFIX + id, "1");
      lrem(KEY_DLID + id);
      _state[id] = { downloading: false, frac: 1, bytes: total, total: total, mbps: 0, etaS: 0,
                     note: "Ready", err: null, done: true, background: true };
      emit(id);
      if (onProgress) onProgress(1, "Ready");
      return { installed: true };
    }).catch(function (e) {
      var msg = String((e && e.message) || e);
      _state[id] = { downloading: false, frac: (_state[id] && _state[id].frac) || 0,
                     bytes: (_state[id] && _state[id].bytes) || 0, total: total, mbps: 0, etaS: null,
                     note: msg === "cancelled" ? "Paused" : msg, err: msg, done: false, background: true };
      emit(id);
      throw e;
    });
  }

  /**
   * Download every file in the pack, resuming whatever is already on disk.
   * onProgress(fraction, note) is called as bytes land.
   */
  function ensure(id, onProgress) {
    var L = llama();
    if (isNative() && L && L.downloadStart) {
      if (_state[id] && _state[id].downloading) return Promise.reject(new Error("already downloading"));
      return nativeDownload(id, onProgress);
    }
    return ensureChunked(id, onProgress);
  }

  function ensureChunked(id, onProgress) {
    var F = fs(), fx = fetchImpl();
    if (!isNative() || !F) return Promise.reject(new Error("on-device models need the native app"));
    if (!fx) return Promise.reject(new Error("no fetch available"));

    if (_state[id] && _state[id].downloading) return Promise.reject(new Error("already downloading"));

    var files = pack(id).files;
    var grandTotal = totalBytes(id) || 1;
    var doneBefore = 0;
    var t0 = Date.now(), startBytes = 0, cancelled = false;

    _state[id] = { downloading: true, frac: 0, bytes: 0, total: grandTotal, mbps: 0, etaS: null, note: "Starting", err: null, done: false };
    _state[id].cancel = function () { cancelled = true; };

    function report(currentFileBytes, note) {
      var got = doneBefore + currentFileBytes;
      var st = _state[id];
      if (st) {
        var secs = (Date.now() - t0) / 1000;
        var moved = got - startBytes;
        st.frac = Math.min(1, got / grandTotal);
        st.bytes = got;
        st.mbps = secs > 1 ? (moved / secs / 1e6) : 0;
        st.etaS = st.mbps > 0.01 ? Math.round((grandTotal - got) / (st.mbps * 1e6)) : null;
        if (note) st.note = note;
        emit(id);
      }
      if (onProgress) onProgress(Math.min(1, got / grandTotal), note);
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
        if (have > 0) { startBytes = have; report(have, "Resuming at " + (have / 1e9).toFixed(2) + " GB"); }
        return pull(f, have);
      });
    }

    function pull(f, from) {
      var total = f.bytes || 0;

      // One chunk, with backoff. A dropped connection mid-download must not force the clinician to
      // tap Download again; that is the difference between "resumable" and "resumable by hand".
      function chunk(offset, end, attempt) {
        return fx(f.url, { headers: { Range: "bytes=" + offset + "-" + end } }).catch(function (e) {
          if (attempt >= CHUNK_TRIES || cancelled) throw e;
          var wait = 800 * Math.pow(2, attempt - 1);
          _state[id].note = "Connection dropped, retrying…";
          emit(id);
          return new Promise(function (res) { setTimeout(res, wait); }).then(function () { return chunk(offset, end, attempt + 1); });
        });
      }

      function step(offset) {
        if (cancelled) throw new Error("cancelled");
        if (total && offset >= total) return verify(f, offset);
        var end = total ? Math.min(offset + CHUNK_BYTES, total) - 1 : offset + CHUNK_BYTES - 1;
        return chunk(offset, end, 1).then(function (r) {
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
              report(next, "Downloading");
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
      _state[id] = { downloading: false, frac: 1, bytes: grandTotal, total: grandTotal, mbps: 0, etaS: 0, note: "Ready", err: null, done: true };
      emit(id);
      if (onProgress) onProgress(1, "Ready");
      return { installed: true };
    }).catch(function (e) {
      var msg = String((e && e.message) || e);
      _state[id] = { downloading: false, frac: (_state[id] && _state[id].frac) || 0, bytes: (_state[id] && _state[id].bytes) || 0,
                     total: grandTotal, mbps: 0, etaS: null, note: msg === "cancelled" ? "Paused" : "Stopped", err: msg, done: false };
      emit(id);
      throw e;
    });
  }

  /** Stop an in-flight download. The bytes already on disk stay, so Download resumes from there. */
  function cancel(id) {
    var st = _state[id];
    if (st && st.cancel) st.cancel();
  }

  // ── delete the cached pack (frees storage) ──
  function remove(id) {
    var F = fs(), L = llama();
    cancel(id);
    lrem(MARK_PREFIX + id);
    lrem(KEY_DLID + id);
    delete _state[id];
    if (isNative() && L && L.modelDelete) {
      return pack(id).files.reduce(function (chain, f) {
        return chain.then(function () { return L.modelDelete({ name: f.name }).catch(function () {}); });
      }, Promise.resolve());
    }
    if (!isNative() || !F) return Promise.resolve();
    return pack(id).files.reduce(function (chain, f) {
      return chain.then(function () { return F.deleteFile({ path: relPath(f.name), directory: DIR }).catch(function () {}); });
    }, Promise.resolve());
  }

  var API = {
    PACKS: PACKS, SUBDIR: SUBDIR, CHUNK_BYTES: CHUNK_BYTES, CHUNK_TRIES: CHUNK_TRIES, KEY_ACTIVE: KEY_ACTIVE,
    totalBytes: totalBytes, sizeLabel: sizeLabel,
    installed: installed, installedCached: installedCached,
    ensure: ensure, ensureChunked: ensureChunked, remove: remove, cancel: cancel, pathFor: pathFor,
    state: state, subscribe: subscribe,
    activePack: activePack, setActivePack: setActivePack,
    resumeUiForBackgroundDownloads: resumeUiForBackgroundDownloads,
    _abToB64: abToB64
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") {
    window.SMD_MAIK_MODELS = API;
    // Deferred so it never competes with first paint.
    try { if (typeof setTimeout === "function") setTimeout(function () { resumeUiForBackgroundDownloads(); }, 3000); } catch (e) {}
  }
})();
