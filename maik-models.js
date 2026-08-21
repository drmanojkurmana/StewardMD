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
  // Rate is averaged over this window so the number tracks the CURRENT connection, not the whole run.
  var RATE_WINDOW_MS = 20000;
  // Bytes unchanged for this long means the connection is throttled to nothing. Reported, never
  // auto-restarted: a restart at high progress would discard gigabytes.
  var STALL_MS = 45000;
  var CHUNK_BYTES = 2 * 1024 * 1024;
  var CHUNK_TRIES = 5;                  // per-chunk retries; a 2.5 GB pull WILL see transient failures
  var MARK_PREFIX = "smd_maik_pack_";   // localStorage install marker (sync check for settingsHTML)
  // Set when the CLINICIAN taps Pause, so startup auto-resume does not override a deliberate stop.
  var KEY_USERPAUSE = "smd_maik_userpause_";

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
  var R2 = "https://models.stewardmd.in/maik";   // Cloudflare R2, APAC-located (same bucket as kardiox/whisper)

  /* MAiK model tiers, in the order a clinician should consider them:
   *
   *   MAiK MxCore   MedGemma 1.5 4B Q4_K_M  2.49 GB  fastest, lightest, lowest RAM
   *   MAiK Neural   MedGemma 1.5 4B Q5_K_M  2.83 GB  higher quality, modestly more RAM/storage
   *   MAiK Horizon  Gemma 4 E2B Q4_K_M      3.11 GB  general-purpose, broader reasoning
   *
   * Fastest -> strongest medical -> broadest general.
   *
   * `actual` is the real upstream model. It is deliberately NOT rendered anywhere in the UI - the
   * product decision is that clinicians see the MAiK tier name only. It stays in the registry
   * because logs, bug reports and the eval harness need to say which weights actually answered.
   *
   * Sizes and hashes are REAL values, not estimates. Only MxCore's sha256 has been verified by
   * hashing a complete download; the others are the HuggingFace API digest and are marked as such.
   */
  /* Plain-language guide shown in Settings so a clinician can choose without knowing anything about
   * quantisation. Deliberately says what on-device mode CANNOT do - no sources, no citations, can be
   * wrong - because that is the part that matters at the bedside and it is easy to leave out. */
  var GUIDE_INTRO = [
    "Answers come from a model stored on your phone. No internet, no AI tokens.",
    "It answers from its own training, not from StewardMD's knowledge base, so there are no sources or citations and it can be wrong. Verify against local protocol.",
    "You can keep more than one downloaded and switch between them. Only the selected one runs.",
    "Downloading needs the space shown plus room to run it. Wi-Fi is easier, mobile data works, and a download resumes if it is interrupted."
  ];

  /* HARDWARE WARNING, shown before download AND at selection.
   *
   * These are 2.5 to 3.2 GB models held in memory while they answer. On a phone without the RAM and
   * the AI accelerator for it, the app does not degrade gracefully - it stalls or the OS kills it. A
   * clinician is entitled to know that BEFORE spending 3 GB of data, and again before switching the
   * engine over to it, which is why the same text appears in both places.
   *
   * The device list is the owner's, kept verbatim rather than turned into a vague "recent flagship".
   */
  var DEVICE_SUPPORTED = "iPhone 18 Pro, 17 Pro, 16 Pro. Samsung Galaxy Fold 7, 6, 5 or S24, S25, S26 Ultra.";
  var DEVICE_WARNING = "Built for flagship, AI-enabled phones: " + DEVICE_SUPPORTED +
    " On any other phone this is at your own risk. It may hang or crash the phone.";

  var PACKS = {
    "maik-mxcore": {
      label: "MAiK MxCore",
      actual: "MedGemma 1.5 4B (Q4_K_M)",
      tier: 1,
      note: "Fastest and lightest. Lowest RAM use, best on any supported phone.",
      guide: {
        speed: 3, medical: 2, general: 1,
        bestFor: "Everyday clinical questions on any supported phone.",
        why: "Medically tuned, and the lightest of the three on memory.",
        pick: "Start here. If you install only one, install this one."
      },
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "medgemma-1.5-4b-it-Q4_K_M.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/medgemma-1.5-4b-it-Q4_K_M.gguf?download=true",
        bytes: 2489894976,   // exact
        sha256: "b31becdf4f39561800505514cce67681604fe449d04dd35c8c92fd7848c6d7bd"   // VERIFIED against a complete download
      }],
      // Vision is a SEPARATE, optional download. The base pack stays 2.49 GB so a clinician who only
      // wants text answers never pays for the projector.
      vision: {
        name: "mmproj-medgemma-1.5-4b-F16.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/mmproj-F16.gguf?download=true",
        bytes: 851252224,    // exact, HuggingFace paths-info
        sha256: "f45f0f750587494e8f976d952cb396dfaa3158662120e2f9c224fc11f3882c83"
      }
    },
    "maik-neural": {
      label: "MAiK Neural",
      actual: "MedGemma 1.5 4B (Q5_K_M)",
      tier: 2,
      note: "Strongest medical answers. Slightly higher quality, a little more RAM and storage.",
      guide: {
        speed: 2, medical: 3, general: 1,
        bestFor: "When you want the most dependable medical detail.",
        why: "Same medical tuning held at higher precision, so figures and regimens drift less.",
        pick: "Choose this if you have the storage to spare and answer quality matters more than speed."
      },
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "medgemma-1.5-4b-it-Q5_K_M.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/medgemma-1.5-4b-it-Q5_K_M.gguf?download=true",
        bytes: 2829699136,   // exact, HuggingFace API
        sha256: null         // UNVERIFIED - nobody has hashed a complete copy of this file yet
      }],
      // Same weights as MxCore at higher precision, so the SAME projector from the same repo applies.
      // Deliberately not shared by reference: each pack states its own file so a future divergence
      // cannot silently point one tier at the wrong projector.
      vision: {
        name: "mmproj-medgemma-1.5-4b-F16.gguf",
        url: HF + "/unsloth/medgemma-1.5-4b-it-GGUF/resolve/main/mmproj-F16.gguf?download=true",
        bytes: 851252224,
        sha256: "f45f0f750587494e8f976d952cb396dfaa3158662120e2f9c224fc11f3882c83"
      }
    },
    "maik-horizon": {
      label: "MAiK Horizon",
      actual: "Gemma 4 E2B (Q4_K_M)",
      tier: 3,
      note: "Broadest general knowledge and reasoning. Not medically fine-tuned.",
      guide: {
        speed: 1, medical: 1, general: 3,
        bestFor: "Broader reasoning and topics at the edges of clinical work.",
        why: "A newer general-purpose base with wider world knowledge.",
        pick: "Not medically tuned. Prefer MxCore or Neural for clinical answers."
      },
      nCtx: 4096,
      nPredict: 512,
      files: [{
        name: "gemma-4-E2B-it-Q4_K_M.gguf",
        url: HF + "/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf?download=true",
        bytes: 3106738272,   // exact, HuggingFace API
        sha256: null         // UNVERIFIED
      }],
      vision: {
        name: "mmproj-gemma-4-E2B-F16.gguf",
        url: HF + "/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-F16.gguf?download=true",
        bytes: 985654080,    // exact, HuggingFace paths-info
        sha256: "140be8d7849741f88c50757d529b84373ee8e27052cc2236855b537f4a8215fa"
      }
    },
    /* FLAGSHIP tier. A medical fine-tune of Qwen3 4B - a newer, stronger base than the other three,
     * which is the whole reason to carry a fourth option.
     *
     * WHY Q5_K_M AND NOT Q8_0: q8_0 exists at 4.69 GB and would score better, but a 4.69 GB mapping on
     * an 8 GB iPhone is the wrong side of the memory limit (2.5 GB already needs the
     * increased-memory-limit entitlement) and its decode is slower - which loses the "speed" half of
     * the brief. Q5_K_M lands at 3.16 GB, the same footprint class as Horizon, which is already proven
     * to load and run on both test phones. The -imat suffix is importance-matrix calibration: better
     * quality per byte than a plain quant at the same size.
     *
     * THINKING MODE: Qwen3 emits <think> blocks by default. Left unchecked they eat the whole nPredict
     * budget and the doctor gets reasoning with no answer, so `noThink` suppresses them at the prompt
     * (see maik-local.js) and stripReasoning() is the backstop.
     */
    "maik-apex": {
      label: "MAiK Apex",
      actual: "MedPsy 4B (Q5_K_M, imatrix)",
      tier: 4,
      flagship: true,
      noThink: true,
      note: "Strongest reasoning. Flagship phones only, and the largest download.",
      guide: {
        speed: 1, medical: 3, general: 3,
        bestFor: "Flagship phones, when you want the best on-device answer and can wait a little longer.",
        why: "A medical fine-tune on a newer, stronger base than the other tiers, so it reasons better across both clinical and general questions.",
        pick: "Best quality here, slowest of the four. On an older phone prefer MxCore."
      },
      nCtx: 4096,
      nPredict: 768,          // more headroom: a reasoning-capable base spends tokens before answering
      files: [{
        name: "medpsy-4b-q5_k_m-imat.gguf",
        url: HF + "/qvac/MedPsy-4B-GGUF/resolve/main/medpsy-4b-q5_k_m-imat.gguf?download=true",
        bytes: 3156921120,   // exact: HuggingFace paths-info AND a live content-length check agree
        sha256: "68bd5e14cd87ff40bba5d08fbef2da9a6088b11aacab8466ef3f13a602e2d868"   // lfs.oid from the HF API
      }]
    }
  };

  /** Packs in recommended order: MxCore -> Neural -> Horizon. */
  function packIds() {
    return Object.keys(PACKS).sort(function (a, b) { return (PACKS[a].tier || 99) - (PACKS[b].tier || 99); });
  }

  /* VISION AS A SUB-PACK, "<packId>#vision".
   *
   * The projector (mmproj) is a second, optional file: 851 MB for MxCore/Neural, 986 MB for Horizon,
   * on top of a 2.5-3.1 GB model. The native downloader reads files[0], so a multi-file pack would
   * have meant reworking the download loop, the queue, the sidecar and the progress UI.
   *
   * Instead a synthetic pack id resolves to the vision file alone. Everything downstream - the
   * one-at-a-time queue, chunked ranged parts, the .parts sidecar, resume, the progress rows - works
   * on it unchanged, because as far as those are concerned it is just another pack with one file.
   */
  var VISION_SUFFIX = "#vision";
  function isVisionId(id) { return String(id || "").slice(-VISION_SUFFIX.length) === VISION_SUFFIX; }
  function baseIdOf(id) { return isVisionId(id) ? String(id).slice(0, -VISION_SUFFIX.length) : String(id); }
  function visionIdOf(id) { return baseIdOf(id) + VISION_SUFFIX; }
  /** The vision file for a pack, or null when that model cannot see (Apex is text-only). */
  function visionFile(id) { var p = PACKS[baseIdOf(id)]; return (p && p.vision) || null; }
  function hasVision(id) { return !!visionFile(id); }

  function pack(id) {
    if (isVisionId(id)) {
      var base = PACKS[baseIdOf(id)], vf = base && base.vision;
      if (!vf) throw new Error("no vision pack for: " + id);
      // A one-file synthetic pack. nPredict/nCtx are irrelevant here (nothing generates from it).
      return { label: base.label + " vision", actual: base.actual + " projector", tier: base.tier,
               files: [vf], visionOf: baseIdOf(id) };
    }
    var p = PACKS[id]; if (!p) throw new Error("unknown pack: " + id); return p;
  }
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
    // Vision sub-packs are included: a projector download can outlive the app exactly like a model
    // one, and if it is not adopted here the UI reports it as absent and offers to start a second.
    var ids = Object.keys(PACKS);
    Object.keys(PACKS).forEach(function (b) { if (PACKS[b].vision) ids.push(b + VISION_SUFFIX); });
    return ids.reduce(function (chain, id) {
      return chain.then(function (found) {
        if (_state[id] && _state[id].downloading) return found;
        var f = pack(id).files[0];   // pack(), not PACKS[], so "<id>#vision" resolves too
        return L.downloadStatus({ id: lget(KEY_DLID + id) || "", name: f.name }).then(function (st) {
          st = st || {};
          var live = st.state === "running" || st.state === "pending" || st.state === "paused";
          /* AUTO-RESUME AN INTERRUPTED DOWNLOAD.
           *
           * A transfer can be left half-done with no live task behind it: the app was updated, the
           * process was killed, or the OS dropped the session. The native side reports "paused" with
           * committed parts on disk, and until now nothing restarted it - the row simply sat at 63%
           * until somebody noticed and tapped Download. That is a poor outcome for a 2.5 GB file that
           * has already been paid for, and worse when the model is the thing the app is waiting on.
           *
           * NOT resumed when the clinician paused it themselves. Overriding a deliberate pause on a
           * metered connection would be its own bug, so an explicit Pause records a marker here and
           * this skips those.
           */
          if (!live) {
            var partial = (st.bytes || 0) > 0 && !installedCached(id);
            var userPaused = lget(KEY_USERPAUSE + id) === "1";
            if (partial && !userPaused) {
              _state[id] = { downloading: true, frac: (f.bytes ? Math.min(1, st.bytes / f.bytes) : 0),
                             bytes: st.bytes || 0, total: f.bytes || st.total || 0, mbps: 0, etaS: null,
                             note: "Resuming where it stopped", err: null, done: false, background: true };
              emit(id);
              ensure(id, null).catch(function () {});
              return true;
            }
            return found;
          }
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
  function activePack() { var v = lget(KEY_ACTIVE); return PACKS[v] ? v : "maik-mxcore"; }
  function setActivePack(id) { if (PACKS[id]) lset(KEY_ACTIVE, id); return activePack(); }

  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lrem(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function abToB64(ab) {
    var bytes = new Uint8Array(ab), bin = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bytes).toString("base64");
  }

  /* ── on-disk size of one file (0 when absent, and 0 when INCOMPLETE) ──
   *
   * A partial chunked download reports 0, not its byte count, and that is deliberate. The native
   * chunked downloader creates the final file at its FULL length up front so parts can be written at
   * their own offsets, so an unfinished 2.49 GB model measures exactly 2.49 GB on disk. Every
   * completeness test here compares size against the expected size, so without this a half-downloaded
   * model was reported INSTALLED - it was never resumed, and it was offered as ready to run.
   *
   * Observed: a download stranded at 24/38 parts by an app update, with the UI calling it complete.
   *
   * Only the native path can be partial in this sense; the web chunked loop appends progressively and
   * writes no sidecar, so its callers (resume offset, verify) are unaffected.
   */
  function sizeOf(name) {
    var L = llama();
    if (isNative() && L && L.modelPath) {
      return L.modelPath({ name: name })
        .then(function (r) { return (r && r.partial) ? 0 : ((r && r.bytes) || 0); })
        .catch(function () { return 0; });
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
    var t0 = Date.now(), startBytes = 0, stopped = false;   // startBytes re-seeded just below

    /* SEED FROM WHAT IS ALREADY KNOWN, do not zero it.
     *
     * resumeUiForBackgroundDownloads() adopts a transfer that outlived the app and fills in its real
     * byte count, then calls ensure() to keep polling. Zeroing here threw that away, so the bar
     * dropped to 0% and climbed back on the next poll - and a transfer resumed at 89% looked like it
     * had restarted from nothing. startBytes also has to begin from those bytes, or the first rate
     * sample counts already-downloaded data as though it arrived just now.
     */
    var prev = _state[id] || {};
    startBytes = prev.bytes || 0;
    _state[id] = { downloading: true, frac: prev.frac || 0, bytes: prev.bytes || 0, total: total,
                   mbps: 0, etaS: null, note: prev.note || "Starting", err: null, done: false,
                   background: true };
    _state[id].cancel = function () {
      stopped = true;
      var did = lget(KEY_DLID + id);
      // Android cancels by DownloadManager id, iOS by destination file name. Send both.
      if (L.downloadCancel) L.downloadCancel({ id: did || "", name: f.name });
    };
    emit(id);

    /* RATE OVER A ROLLING WINDOW, not an average since the start.
     *
     * The average-since-start is the reason a stalled transfer showed "89.7% of 2.83 GB" with no rate
     * and no ETA at all: once a stream is throttled, dividing all bytes by all elapsed time decays
     * towards zero, the rate rounds to 0.0 and the UI drops both fields. A rolling window reports
     * what the connection is doing NOW, which is the number a clinician can actually act on.
     */
    var samples = [];
    function report(bytes, note) {
      var st = _state[id]; if (!st) return;
      var now = Date.now();
      samples.push({ t: now, b: bytes });
      while (samples.length > 2 && now - samples[0].t > RATE_WINDOW_MS) samples.shift();
      var head = samples[0], dt = (now - head.t) / 1000, moved = bytes - head.b;
      st.bytes = bytes;
      st.frac = total ? Math.min(1, bytes / total) : 0;
      st.mbps = dt >= 2 ? Math.max(0, moved / dt / 1e6) : 0;
      st.etaS = (st.mbps > 0.01 && total) ? Math.round((total - bytes) / (st.mbps * 1e6)) : null;
      if (note) st.note = note;
      emit(id);
      if (onProgress) onProgress(st.frac, note);
    }

    function fresh() {
      // `total` lets the native side split the file into ranged parts. iOS throttles background
      // transfers PER TASK (measured: 1.08 MB/s on one stream, 4.77 MB/s on four), so the expected
      // size is what turns a slow download into a fast one.
      return L.downloadStart({ url: f.url, name: f.name, title: pk.label, total: f.bytes || 0 }).then(function (r) {
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

    var lastBytes = -1, lastMoved = Date.now();
    function poll(did) {
      if (stopped) throw new Error("cancelled");
      return L.downloadStatus({ id: did, name: f.name }).then(function (s) {
        s = s || {};
        if (s.total > 0 && !total) { total = s.total; _state[id].total = total; }
        var seen = s.bytes || s.onDisk || 0;
        /* SAY SO WHEN NOTHING IS MOVING.
         *
         * The host throttles individual connections hard and unpredictably - the same file measured
         * 0.5 MB/s on one stream and 21 MB/s on another minutes apart. A transfer can therefore sit
         * at the same byte count for minutes while the UI still shows a progress bar and a Pause
         * button, which reads as the app being broken. It is NOT restarted automatically: at 89.7% of
         * 2.83 GB a restart would throw away 2.5 GB to chase a faster connection. Report it and let
         * the clinician choose.
         */
        if (seen > lastBytes) { lastBytes = seen; lastMoved = Date.now(); }
        var stalledFor = Date.now() - lastMoved;
        var note = s.state === "paused" ? "Waiting for a connection"
                 : stalledFor > STALL_MS ? "Stalled on a slow connection, still trying. Pause and start again to get a new one."
                 : "Downloading in the background";
        report(seen, note);
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
      // `partial` is what distinguishes "2.49 GB of finished model" from "2.49 GB of preallocated
      // file with 14 parts still missing". Size alone cannot tell them apart.
      if (mp && !mp.partial && mp.bytes && f.bytes && mp.bytes === f.bytes) return "already";
      // The final file is created at full length up front and parts are written into it in place, so
      // the overhead is only the parts in flight (8 x 64 MB), not a second copy of the model.
      if (mp && mp.freeBytes > 0 && f.bytes && mp.freeBytes < f.bytes * 1.05 + 600e6) {
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
  /* ONE TRANSFER AT A TIME, and this is not a style preference.
   *
   * The old guard only stopped downloading the SAME pack twice, so tapping Download on all three
   * tiers started three multi-GB transfers at once. Measured against the real host: three concurrent
   * streams came back at 12.2, 0.5 and 8.6 MB/s - one of the three throttled to a fortieth of the
   * others. On device that showed up as every row frozen (0.0%, 89.7%, 0.0%) with no rate and no ETA,
   * because the average-since-start rate of a stalled transfer rounds to zero.
   *
   * Three at a third of the speed is also the wrong thing to want: a clinician needs ONE working
   * model as soon as possible, not three that are each 30% done.
   */
  var _active = null;                    // pack id currently transferring
  var _queue = [];                       // [{ id, onProgress, resolve, reject }]

  function queuedIds() { return _queue.map(function (q) { return q.id; }); }
  function activeId() { return _active; }

  function _exec(id, onProgress) {
    var L = llama();
    if (isNative() && L && L.downloadStart) return nativeDownload(id, onProgress);
    return ensureChunked(id, onProgress);
  }

  function _drain() {
    if (_active || !_queue.length) return;
    var job = _queue.shift();
    _active = job.id;
    var settle = function (fn, v) {
      _active = null;
      // Re-label whatever is still waiting, then start the next one.
      _queue.forEach(function (q) { _markQueued(q.id); });
      try { fn(v); } finally { _drain(); }
    };
    _exec(job.id, job.onProgress).then(function (r) { settle(job.resolve, r); },
                                      function (e) { settle(job.reject, e); });
  }

  function _markQueued(id) {
    var head = _active && pack(_active) ? pack(_active).label : "another model";
    _state[id] = { downloading: false, queued: true, frac: 0, bytes: 0, total: totalBytes(id),
                   mbps: 0, etaS: null, note: "Waiting for " + head, err: null, done: false };
    emit(id);
  }

  function ensure(id, onProgress) {
    lrem(KEY_USERPAUSE + id);          // asking for it again clears any earlier deliberate pause
    if (_active === id) return Promise.reject(new Error("already downloading"));
    if (queuedIds().indexOf(id) >= 0) return Promise.reject(new Error("already queued"));
    return new Promise(function (res, rej) {
      _queue.push({ id: id, onProgress: onProgress, resolve: res, reject: rej });
      if (_active) _markQueued(id);
      _drain();
    });
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
    // A QUEUED pack has no transfer to stop, only a place in line. Without this branch its Pause
    // button did nothing and the pack stayed queued for a download the clinician had given up on.
    var qi = queuedIds().indexOf(id);
    if (qi >= 0 && _active !== id) {
      var job = _queue.splice(qi, 1)[0];
      _state[id] = { downloading: false, frac: 0, bytes: 0, total: totalBytes(id), mbps: 0, etaS: null,
                     note: "Not downloaded", err: null, done: false };
      emit(id);
      try { job.reject(new Error("cancelled")); } catch (e) {}
      return;
    }
    // An explicit Pause is a decision, not a failure: remember it so the next launch does not
    // helpfully restart a download the clinician stopped on purpose.
    lset(KEY_USERPAUSE + id, "1");
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
    PACKS: PACKS, GUIDE_INTRO: GUIDE_INTRO, DEVICE_WARNING: DEVICE_WARNING, DEVICE_SUPPORTED: DEVICE_SUPPORTED,
    hasVision: hasVision, visionFile: visionFile, visionIdOf: visionIdOf, isVisionId: isVisionId, baseIdOf: baseIdOf,
    activeId: activeId, queuedIds: queuedIds, SUBDIR: SUBDIR, CHUNK_BYTES: CHUNK_BYTES, CHUNK_TRIES: CHUNK_TRIES, KEY_ACTIVE: KEY_ACTIVE,
    totalBytes: totalBytes, sizeLabel: sizeLabel,
    installed: installed, installedCached: installedCached,
    packIds: packIds, ensure: ensure, ensureChunked: ensureChunked, remove: remove, cancel: cancel, pathFor: pathFor,
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
