/* StewardMD - ResearchMD on-device PDF extraction & OCR (window.SMD_RMD_ONDEVICE_PDF).
 * ES5 IIFE. Dual export for browser and Node tests.
 * Reads text-layer PDFs with pdf.js and image-only pages with native on-device OCR
 * (Apple Vision via VisionOcr on iOS/iPadOS/macOS, ML Kit via TextRecognition on Android).
 * Output matches backend/research/worker/research_worker/extract.py result.json shape.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var D = G && G.document;
  var FLAG = "smd_rmd_ondevice_ocr";
  var NATIVE_JOB_FLAG = "smd_rmd_od_native_job";
  var NATIVE_POLL_MS = 1000;
  var NATIVE_MAX_RESTARTS = 5;
  var ENGINE_VERSION = "rod1";
  var DEFAULT_MAX_PAGES = 200;
  var DEFAULT_DPI = 200;
  var MAX_RENDER_PX = 2400;
  var TEXT_LAYER_MIN_CHARS = 20;

  var _pdfLibPromise = null;
  var PDFJS_LOCAL = "/vendor/pdfjs/pdf.min.js";
  var PDFJS_LOCAL_W = "/vendor/pdfjs/pdf.worker.min.js";
  var PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  var PDFJS_CDN_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  /* Feature flag: DEFAULT ON. Off per device with ?rmd_ondevice_ocr=0 or localStorage.smd_rmd_ondevice_ocr = "0" */
  function isEnabled() {
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_ondevice_ocr=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(FLAG) !== "0";
      }
    } catch (e) {}
    return true;
  }

  /* Phase 05 kill switch, DEFAULT ON (needs the main flag on too). Off per device with ?rmd_od_native_job=0
     or localStorage.smd_rmd_od_native_job = "0". When on and the native plugin has the job methods, scanned
     pages are read by one native background job (keeps going when the app is put away) instead of page by page. */
  function isNativeJobEnabled() {
    if (!isEnabled()) return false;
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_od_native_job=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem(NATIVE_JOB_FLAG) !== "0";
    } catch (e) {}
    return true;
  }

  function nativeJobApi(opts) {
    if (opts && opts.nativeJob === false) return null;
    var J = (opts && opts.nativeJob) || (G && G.SMD_NATIVE && G.SMD_NATIVE.pdfJob) || null;
    if (!J || typeof J.available !== "function") return null;
    try { return J.available() ? J : null; } catch (e) { return null; }
  }

  function isForeground() {
    try { if (D && D.visibilityState) return D.visibilityState === "visible"; } catch (e) {}
    return true;
  }

  /* A page from the native job: words have NORMALIZED top-left boxes {t,x,y,w,h}; convert to PDF points with
     the page size pdf.js measured, the same way ocrResultToPage does for single-page OCR. */
  function nativePageToPage(np, pageNum, width, height) {
    var src = (np && Array.isArray(np.words)) ? np.words : [];
    var words = [];
    for (var i = 0; i < src.length; i++) {
      var b = src[i];
      if (!b || b.t == null) continue;
      var t = String(b.t).trim();
      if (!t) continue;
      var x = Number(b.x) || 0, y = Number(b.y) || 0, w = Number(b.w) || 0, h = Number(b.h) || 0;
      words.push({ t: t, x0: round2(x * width), y0: round2(y * height), x1: round2((x + w) * width), y1: round2((y + h) * height) });
    }
    return {
      n: pageNum,
      width: round2(width),
      height: round2(height),
      text: np && np.text != null ? String(np.text) : "",
      words: words,
      tables: (np && Array.isArray(np.tables)) ? np.tables : [],
      ocr: true
    };
  }

  function nativeError(code) {
    if (code === "password") return makeError("password", "PDF is password-protected");
    if (code === "cancelled") return makeError("aborted", "Extraction aborted");
    if (code === "pdf-open-failed" || code === "not-found") return makeError("pdf-open-failed", "Failed to open PDF");
    return makeError("ocr-failed", "Background page reading failed" + (code ? " (" + code + ")" : ""));
  }

  function detectOcrEngine() {
    var P = G && G.Capacitor && G.Capacitor.Plugins;
    if (P && P.VisionOcr && typeof P.VisionOcr.detectText === "function") return "vision";
    if (P && P.TextRecognition && typeof P.TextRecognition.processImage === "function") return "mlkit";
    return null;
  }

  function hasNativeOcr() {
    return detectOcrEngine() !== null;
  }

  function isNativeShell() {
    var C = G && G.Capacitor;
    if (!C) return false;
    if (typeof C.isNativePlatform === "function") return !!C.isNativePlatform();
    return !!(C.platform && C.platform !== "web");
  }

  function loadPdfJs() {
    if (_pdfLibPromise) return _pdfLibPromise;
    if (G && G.pdfjsLib) {
      try { G.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_LOCAL_W; } catch (e) {}
      _pdfLibPromise = Promise.resolve(G.pdfjsLib);
      return _pdfLibPromise;
    }
    if (!D) return Promise.reject(makeError("pdf-open-failed", "pdf.js is unavailable"));
    _pdfLibPromise = new Promise(function (resolve, reject) {
      function tryLoad(src, worker, fallback) {
        var s = D.createElement("script");
        s.src = src;
        s.onload = function () {
          var lib = G && G.pdfjsLib;
          if (!lib) {
            if (fallback) fallback();
            else { _pdfLibPromise = null; reject(makeError("pdf-open-failed", "Failed to load pdf.js")); }
            return;
          }
          try { lib.GlobalWorkerOptions.workerSrc = worker; } catch (e) {}
          resolve(lib);
        };
        s.onerror = function () {
          if (fallback) fallback();
          else { _pdfLibPromise = null; reject(makeError("pdf-open-failed", "Failed to load pdf.js")); }
        };
        D.head.appendChild(s);
      }
      tryLoad(PDFJS_LOCAL, PDFJS_LOCAL_W, function () { tryLoad(PDFJS_CDN, PDFJS_CDN_W, null); });
    });
    return _pdfLibPromise;
  }

  function makeError(code, message, page) {
    var err = new Error(message || code);
    err.code = code;
    if (page != null) err.page = page;
    return err;
  }

  function round2(v) {
    var n = Math.round(Number(v) * 100) / 100;
    return n === 0 ? 0 : n;
  }

  function toUint8Array(source) {
    if (!source) return Promise.reject(makeError("pdf-open-failed", "No PDF source provided"));
    if (source instanceof Uint8Array) return Promise.resolve(source);
    if (typeof ArrayBuffer !== "undefined") {
      if (source instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(source));
      if (typeof ArrayBuffer.isView === "function" && ArrayBuffer.isView(source)) {
        return Promise.resolve(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
      }
    }
    if (typeof source.arrayBuffer === "function") {
      return source.arrayBuffer().then(function (ab) {
        return new Uint8Array(ab);
      }, function (err) {
        throw makeError("pdf-open-failed", (err && err.message) || "Could not read PDF bytes");
      });
    }
    return Promise.reject(makeError("pdf-open-failed", "Unsupported PDF source"));
  }

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256BytesPure(u8) {
    var len = u8.length;
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    function compress(buf, off) {
      var t, a, b, c, d, e, f, g, h, S1, ch, temp1, S0, maj, temp2, s0, s1;
      for (t = 0; t < 16; t++) {
        W[t] = ((buf[off + t * 4] << 24) | (buf[off + t * 4 + 1] << 16) |
          (buf[off + t * 4 + 2] << 8) | buf[off + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (t = 0; t < 64; t++) {
        S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ ((~e) & g);
        temp1 = (h + S1 + ch + SHA_K[t] + W[t]) >>> 0;
        S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var fullEnd = len - (len % 64);
    var i;
    for (i = 0; i < fullEnd; i += 64) {
      compress(u8, i);
    }
    var rem = len - fullEnd;
    var tailLen = rem < 56 ? 64 : 128;
    var tail = new Uint8Array(tailLen);
    for (i = 0; i < rem; i++) tail[i] = u8[fullEnd + i];
    tail[rem] = 0x80;
    var bitLen = len * 8;
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    tail[tailLen - 8] = (hi >>> 24) & 0xff;
    tail[tailLen - 7] = (hi >>> 16) & 0xff;
    tail[tailLen - 6] = (hi >>> 8) & 0xff;
    tail[tailLen - 5] = hi & 0xff;
    tail[tailLen - 4] = (lo >>> 24) & 0xff;
    tail[tailLen - 3] = (lo >>> 16) & 0xff;
    tail[tailLen - 2] = (lo >>> 8) & 0xff;
    tail[tailLen - 1] = lo & 0xff;
    for (i = 0; i < tailLen; i += 64) {
      compress(tail, i);
    }
    var hex = "";
    for (i = 0; i < 8; i++) {
      var part = H[i].toString(16);
      while (part.length < 8) part = "0" + part;
      hex += part;
    }
    return hex;
  }

  function sha256Hex(u8) {
    var subtle = G && G.crypto && G.crypto.subtle;
    if (subtle && typeof subtle.digest === "function") {
      try {
        return Promise.resolve(subtle.digest("SHA-256", u8)).then(function (digest) {
          var bytes = new Uint8Array(digest);
          var hex = "";
          for (var i = 0; i < bytes.length; i++) {
            var h = bytes[i].toString(16);
            hex += h.length < 2 ? "0" + h : h;
          }
          return hex;
        }, function () {
          return sha256BytesPure(u8);
        });
      } catch (e) {}
    }
    return Promise.resolve(sha256BytesPure(u8));
  }

  function sha256(source) {
    return toUint8Array(source).then(sha256Hex, function () { return null; });
  }

  function mulMatrix(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function hypot(a, b) {
    return Math.sqrt(a * a + b * b);
  }

  function extractTextLayer(items, vp) {
    var vpTransform = (vp && vp.transform && vp.transform.length >= 6)
      ? vp.transform
      : [1, 0, 0, -1, 0, vp.height];
    var words = [];
    var lines = [];
    var curLine = [];
    var curKey = null;
    var curSize = 12;

    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var str = String(it.str || "");
      var hasNonSpace = str.replace(/\s+/g, "").length > 0;
      var m = (it.transform && it.transform.length >= 6) ? it.transform : [12, 0, 0, 12, 0, 0];
      var tx = mulMatrix(vpTransform, m);
      var aNorm = hypot(tx[0], tx[1]) || 1;
      var ux = tx[0] / aNorm;
      var uy = tx[1] / aNorm;
      var cNorm = hypot(tx[2], tx[3]);
      var vx = cNorm > 0 ? tx[2] / cNorm : uy;
      var vy = cNorm > 0 ? tx[3] / cNorm : -ux;
      var hLen = (typeof it.height === "number" && it.height > 0) ? it.height : (cNorm || aNorm || 12);
      var wLen = (typeof it.width === "number" && it.width >= 0) ? it.width : 0;
      var baseKey = -tx[4] * uy + tx[5] * ux;

      if (hasNonSpace) {
        if (curKey !== null && Math.abs(baseKey - curKey) > Math.max(3, 0.5 * curSize)) {
          if (curLine.length) {
            lines.push(curLine.join(" "));
            curLine = [];
          }
        }

        var len = str.length || 1;
        var tokRe = /\S+/g;
        var match;
        while ((match = tokRe.exec(str)) !== null) {
          var tok = match[0];
          var s0 = match.index / len;
          var s1 = (match.index + tok.length) / len;
          var ox = tx[4] + ux * (wLen * s0);
          var oy = tx[5] + uy * (wLen * s0);
          var span = wLen * (s1 - s0);
          var p0x = ox, p0y = oy;
          var p1x = ox + ux * span, p1y = oy + uy * span;
          var p2x = ox + vx * hLen, p2y = oy + vy * hLen;
          var p3x = p1x + vx * hLen, p3y = p1y + vy * hLen;
          words.push({
            t: tok,
            x0: round2(Math.min(p0x, p1x, p2x, p3x)),
            y0: round2(Math.min(p0y, p1y, p2y, p3y)),
            x1: round2(Math.max(p0x, p1x, p2x, p3x)),
            y1: round2(Math.max(p0y, p1y, p2y, p3y))
          });
          curLine.push(tok);
        }
        curKey = baseKey;
        curSize = hLen;
      }

      if (it.hasEOL && curLine.length) {
        lines.push(curLine.join(" "));
        curLine = [];
        curKey = null;
      }
    }
    if (curLine.length) lines.push(curLine.join(" "));
    return {
      words: words,
      text: lines.join("\n")
    };
  }

  function createPageCanvas(w, h, opts) {
    if (opts && typeof opts.createCanvas === "function") {
      return opts.createCanvas(w, h);
    }
    if (!D || typeof D.createElement !== "function") {
      throw makeError("ocr-failed", "Canvas is unavailable for rendering scanned pages");
    }
    var canvas = D.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }

  function ocrResultToPage(ocrRes, pageNum, width, height) {
    var boxes = (ocrRes && Array.isArray(ocrRes.boxes)) ? ocrRes.boxes : [];
    var words = [];
    for (var i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!b || b.text == null) continue;
      var t = String(b.text).trim();
      if (!t) continue;
      var x = Number(b.x) || 0;
      var y = Number(b.y) || 0;
      var w = Number(b.w) || 0;
      var h = Number(b.h) || 0;
      words.push({
        t: t,
        x0: round2(x * width),
        y0: round2(y * height),
        x1: round2((x + w) * width),
        y1: round2((y + h) * height)
      });
    }
    var lines;
    if (ocrRes && Array.isArray(ocrRes.lines)) {
      lines = ocrRes.lines.map(function (ln) { return String(ln == null ? "" : ln); });
    } else if (ocrRes && ocrRes.text != null) {
      lines = String(ocrRes.text).split(/\r?\n/);
    } else {
      lines = [];
    }
    return {
      n: pageNum,
      width: round2(width),
      height: round2(height),
      text: lines.join("\n"),
      words: words,
      tables: [],
      ocr: true
    };
  }

  /* The Rust PDF reader (vendor/rust-pdf/rust-pdf.js, a WebAssembly copy of the server's reader). It gives the same
     text, words and tables as the server for every page that has a text layer, about 50x faster than the Python
     reader. Pages it marks needs_ocr, and any Rust failure, take the pdf.js + OCR path below as before.
     opts.rust: false = off, an object = use it (tests); otherwise window.SMD_RUST_PDF, loaded on first use. */
  var RUST_URL = "/vendor/rust-pdf/rust-pdf.js", rustLoad = null;
  function loadRust() {
    if (G && G.SMD_RUST_PDF) return Promise.resolve(G.SMD_RUST_PDF);
    if (rustLoad) return rustLoad;
    if (!G || !G.document || !G.document.createElement) return Promise.resolve(null);
    rustLoad = new Promise(function (res) {
      var s = G.document.createElement("script");
      s.src = RUST_URL;
      s.onload = function () { res(G.SMD_RUST_PDF || null); };
      s.onerror = function () { rustLoad = null; res(null); };
      (G.document.head || G.document.documentElement).appendChild(s);
    });
    return rustLoad;
  }
  function rustPagesFor(u8, opts, maxPages) {
    if (opts.rust === false) return Promise.resolve(null);
    var src = (opts.rust && typeof opts.rust.extract === "function") ? Promise.resolve(opts.rust) : loadRust();
    return src.then(function (R) {
      if (!R || (typeof R.isEnabled === "function" && !R.isEnabled())) return null;
      return R.extract(u8, { maxPages: maxPages });
    }).then(function (res) {
      if (!res || !Array.isArray(res.pages)) return null;
      var byN = {};
      res.pages.forEach(function (p) {
        if (p && typeof p.n === "number" && !p.needs_ocr && Array.isArray(p.words) && Array.isArray(p.tables)) byN[p.n] = p;
      });
      return byN;
    }, function () { return null; });
  }

  function extract(source, opts) {
    opts = opts || {};
    var maxPages = (typeof opts.maxPages === "number" && opts.maxPages > 0) ? opts.maxPages : DEFAULT_MAX_PAGES;
    var dpi = (typeof opts.dpi === "number" && opts.dpi > 0) ? opts.dpi : DEFAULT_DPI;
    var signal = opts.signal || null;
    var onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    var onPage = typeof opts.onPage === "function" ? opts.onPage : null;
    var resume = opts.resume || null;
    var customOcr = typeof opts.ocr === "function" ? opts.ocr : null;
    var detectedEngine = detectOcrEngine();
    var ocrFn = customOcr || (G && G.SMD_NATIVE && typeof G.SMD_NATIVE.ocr === "function" ? G.SMD_NATIVE.ocr : null);
    // Phase 05: one native background job for all scanned pages (not with a custom per-page OCR function).
    var nativeJob = (!customOcr && isNativeJobEnabled()) ? nativeJobApi(opts) : null;
    var nativePollMs = (typeof opts.nativePollMs === "number" && opts.nativePollMs >= 0) ? opts.nativePollMs : NATIVE_POLL_MS;
    var onNativeState = typeof opts.onNativeState === "function" ? opts.onNativeState : null;

    if (signal && signal.aborted) {
      return Promise.reject(makeError("aborted", "Extraction aborted"));
    }

    var pdfjsPromise = opts.pdfjs ? Promise.resolve(opts.pdfjs) : loadPdfJs();
    return Promise.all([pdfjsPromise, toUint8Array(source)]).then(function (pair) {
      var pdfjs = pair[0];
      var u8 = pair[1];
      if (signal && signal.aborted) throw makeError("aborted", "Extraction aborted");
      var preSha = (typeof opts.sha256 === "string" && /^[0-9a-f]{64}$/.test(opts.sha256)) ? opts.sha256 : null;
      return Promise.all([preSha ? Promise.resolve(preSha) : sha256Hex(u8), rustPagesFor(u8, opts, maxPages)]).then(function (sr) {
        var sha256Val = sr[0], rustPages = sr[1], usedRust = false;
        if (signal && signal.aborted) throw makeError("aborted", "Extraction aborted");
        var openOpts = isNativeShell() ? { data: u8, disableWorker: true } : { data: u8 };
        var docPromise;
        try {
          var task = pdfjs.getDocument(openOpts);
          docPromise = (task && task.promise) ? task.promise : Promise.resolve(task);
        } catch (syncErr) {
          docPromise = Promise.reject(syncErr);
        }
        return docPromise.catch(function (err) {
          if (err && (err.name === "PasswordException" || err.code === "password")) {
            throw makeError("password", "PDF is password-protected");
          }
          if (openOpts.disableWorker) {
            throw makeError("pdf-open-failed", (err && err.message) || "Failed to open PDF");
          }
          var retryPromise;
          try {
            var task2 = pdfjs.getDocument({ data: u8, disableWorker: true });
            retryPromise = (task2 && task2.promise) ? task2.promise : Promise.resolve(task2);
          } catch (syncErr2) {
            retryPromise = Promise.reject(syncErr2);
          }
          return retryPromise.catch(function (err2) {
            if (err2 && (err2.name === "PasswordException" || err2.code === "password")) {
              throw makeError("password", "PDF is password-protected");
            }
            throw makeError("pdf-open-failed", (err2 && err2.message) || "Failed to open PDF");
          });
        }).then(function (pdf) {
          var total = (pdf && pdf.numPages) || 0;
          if (!total) throw makeError("pdf-open-failed", "PDF has no pages");
          if (total > maxPages) throw makeError("too-many-pages", "PDF has " + total + " pages (max " + maxPages + ")");

          var pages = [];
          var anyOcr = false;
          var startPage = 1;
          if (resume && sha256Val && resume.sha256 === sha256Val && Array.isArray(resume.pages) &&
              typeof resume.nextPage === "number" && resume.nextPage > 1) {
            var keepUntil = Math.min(total + 1, Math.floor(resume.nextPage));
            for (var r = 0; r < resume.pages.length; r++) {
              var rp = resume.pages[r];
              if (rp && typeof rp.n === "number" && rp.n < keepUntil) {
                pages.push(rp);
                if (rp.ocr) anyOcr = true;
              }
            }
            startPage = keepUntil;
          }

          var usedEngine = anyOcr ? (detectedEngine || (resume && resume.ocrEngine) || opts.ocrEngine || null) : null;
          // Scanned pages waiting for the native job: [{n, w, h}] (w/h in points from pdf.js).
          var pending = [];

          function buildSnapshot(nextPage, isPartial) {
            // While scanned pages wait for the native job, a resume restarts at the first of them (the job's
            // own finished pages stay on disk, so nothing is read twice); pages are always in page order.
            for (var q = 0; q < pending.length; q++) {
              if (pending[q].n < nextPage) { nextPage = pending[q].n; isPartial = true; }
            }
            var sorted = pages.slice().sort(function (a, b) { return a.n - b.n; });
            return {
              pages: sorted,
              ocr: anyOcr,
              sha256: sha256Val,
              engine: "ondevice",
              ocrEngine: anyOcr ? usedEngine : null,
              partial: isPartial,
              nextPage: nextPage,
              engineVersion: usedRust ? ENGINE_VERSION + "-rs1" : ENGINE_VERSION
            };
          }

          // Render one scanned page and OCR it in-process (the phase 01 path). Owns its canvas.
          function renderAndOcr(page, pNo, ptW, ptH) {
            if ((!customOcr && !hasNativeOcr()) || !ocrFn) {
              return Promise.reject(makeError("ocr-unavailable", "Native OCR is unavailable on this device", pNo));
            }
            var canvas = null;
            function dropCanvas() {
              if (canvas) { try { canvas.width = 0; canvas.height = 0; } catch (e) {} canvas = null; }
            }
            return Promise.resolve().then(function () {
              var scale = dpi / 72;
              var longSide = Math.max(ptW, ptH);
              if (longSide > 0 && longSide * scale > MAX_RENDER_PX) {
                scale = MAX_RENDER_PX / longSide;
              }
              var rvp = page.getViewport({ scale: scale });
              var cw = Math.max(1, Math.round(rvp.width));
              var ch = Math.max(1, Math.round(rvp.height));
              canvas = createPageCanvas(cw, ch, opts);
              var ctx = canvas.getContext ? canvas.getContext("2d") : null;
              var renderTask = page.render({ canvasContext: ctx, viewport: rvp });
              return (renderTask && renderTask.promise) ? renderTask.promise : Promise.resolve(renderTask);
            }).then(function () {
              var dataUrl = canvas.toDataURL("image/jpeg", 0.9);
              dropCanvas();
              return Promise.resolve().then(function () {
                return ocrFn(dataUrl, { languageCorrection: true });
              }).then(function (ocrRes) {
                usedEngine = detectedEngine || opts.ocrEngine || null;
                return ocrResultToPage(ocrRes, pNo, ptW, ptH);
              }, function (ocrErr) {
                if (ocrErr && (ocrErr.code === "ocr-unavailable" || ocrErr.message === "ocr-unavailable")) {
                  throw makeError("ocr-unavailable", ocrErr.message, pNo);
                }
                throw makeError("ocr-failed", (ocrErr && ocrErr.message) || "OCR failed on page " + pNo, pNo);
              });
            }, function (err) {
              dropCanvas();
              if (err && err.code) throw err;
              throw makeError("ocr-failed", (err && err.message) || "OCR failed on page " + pNo, pNo);
            });
          }

          function addPage(pageObj) {
            for (var q = 0; q < pending.length; q++) {
              if (pending[q].n === pageObj.n) { pending.splice(q, 1); break; }
            }
            pages.push(pageObj);
            if (pageObj.ocr) anyOcr = true;
            if (onPage) return Promise.resolve(onPage(buildSnapshot(total + 1, pending.length > 0)));
            return Promise.resolve();
          }

          // The native job could not start (older app build, plugin error): read the waiting pages in-process.
          function inlineFallback() {
            var list = pending.slice();
            var i = 0;
            function next() {
              if (i >= list.length) return Promise.resolve();
              var it = list[i++];
              if (signal && signal.aborted) return Promise.reject(makeError("aborted", "Extraction aborted", it.n));
              if (onProgress) onProgress(it.n, total);
              var pageRef = null;
              return Promise.resolve(pdf.getPage(it.n)).then(function (page) {
                pageRef = page;
                return renderAndOcr(page, it.n, it.w, it.h);
              }).then(function (pageObj) {
                if (pageRef && typeof pageRef.cleanup === "function") { try { pageRef.cleanup(); } catch (e) {} }
                return addPage(pageObj);
              }, function (err) {
                if (pageRef && typeof pageRef.cleanup === "function") { try { pageRef.cleanup(); } catch (e) {} }
                if (err && err.code) { if (err.page == null && err.code !== "aborted") err.page = it.n; throw err; }
                throw makeError("ocr-failed", (err && err.message) || "OCR failed on page " + it.n, it.n);
              }).then(next);
            }
            return next();
          }

          // Phase 05: hand every scanned page to one native job, wait for it (it keeps going in the background),
          // then merge its pages in page order. Paused time is reported through onNativeState so a caller's
          // "too slow" clock can stop while the app is put away.
          function runNative() {
            var J = nativeJob;
            var shaPart = sha256Val ? String(sha256Val).slice(0, 40) : ("tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8));
            var key = "rmd-" + shaPart + "-" + Math.round(dpi);
            var want = pending.map(function (p) { return p.n; });
            var doneBefore = total - want.length;
            var clock = (opts && opts.clock) || {
              setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
              clearTimeout: function (id) { return clearTimeout(id); }
            };
            var tmpUri = null, listener = null, started = false, restarts = 0, pausedPolls = 0, lastState = null, lastDone = -1;
            var waitTimer = null, waitReject = null, abortListener = null, cancelSent = false;

            function cancelNativeOnce() {
              if (cancelSent) return;
              cancelSent = true;
              try { Promise.resolve(J.cancel(key)).catch(function () {}); } catch (e) {}
            }
            function tidy() {
              if (waitTimer != null) { clock.clearTimeout(waitTimer); waitTimer = null; }
              waitReject = null;
              if (abortListener && signal && typeof signal.removeEventListener === "function") {
                try { signal.removeEventListener("abort", abortListener); } catch (e) {}
              }
              abortListener = null;
              if (listener && typeof listener.remove === "function") { try { listener.remove(); } catch (e) {} }
              listener = null;
              if (tmpUri && typeof J.removeTempPdf === "function") { try { J.removeTempPdf(tmpUri); } catch (e) {} }
              tmpUri = null;
            }
            function onAbortSignal() {
              var rej = waitReject;
              waitReject = null;
              cancelNativeOnce();
              tidy();
              if (rej) {
                rej(makeError("aborted", "Extraction aborted"));
              }
            }
            if (signal && typeof signal.addEventListener === "function") {
              abortListener = onAbortSignal;
              signal.addEventListener("abort", abortListener);
            }
            function wait() {
              if (signal && signal.aborted) {
                cancelNativeOnce();
                return Promise.reject(makeError("aborted", "Extraction aborted"));
              }
              return new Promise(function (res, rej) {
                waitReject = rej;
                waitTimer = clock.setTimeout(function () {
                  waitTimer = null;
                  waitReject = null;
                  res();
                }, nativePollMs);
              });
            }
            function report(state, st) {
              if (state !== lastState) {
                lastState = state;
                if (onNativeState) {
                  try { onNativeState({ state: state, done: (st && st.donePages ? st.donePages.length : 0), total: want.length }); } catch (e) {}
                }
              }
            }
            function startJob() {
              return J.start({ jobKey: key, path: tmpUri, pages: want, dpi: dpi });
            }
            function poll() {
              if (signal && signal.aborted) {
                cancelNativeOnce();
                return Promise.reject(makeError("aborted", "Extraction aborted"));
              }
              return Promise.resolve(J.get(key)).then(function (st) {
                if (signal && signal.aborted) {
                  cancelNativeOnce();
                  throw makeError("aborted", "Extraction aborted");
                }
                st = st || {};
                if (st.state === "done") { report("done", st); return; }
                if (st.state === "failed") throw nativeError(st.error);
                if (st.state === "paused") {
                  report("paused", st);
                  if (isForeground()) {
                    // Back in the app but the job is still stopped (Android stopped the worker, or iOS has not
                    // resumed it yet): start it again; finished pages on disk are skipped.
                    pausedPolls++;
                    if (pausedPolls >= 2) {
                      pausedPolls = 0;
                      if (++restarts > NATIVE_MAX_RESTARTS) throw makeError("ocr-failed", "Background page reading kept stopping");
                      return Promise.resolve(startJob()).then(wait).then(poll);
                    }
                  }
                  return wait().then(poll);
                }
                pausedPolls = 0;
                report("running", st);
                // Progress from the poll too, in case the native listener is not delivering (iOS suspended,
                // or the plugin was reloaded): a caller's per-page clock is reset by each new page.
                var nowDone = st.donePages ? st.donePages.length : 0;
                if (nowDone !== lastDone) {
                  lastDone = nowDone;
                  if (onProgress) onProgress(Math.min(total, doneBefore + nowDone + 1), total);
                }
                return wait().then(poll);
              });
            }

            return Promise.resolve().then(function () {
              if (signal && signal.aborted) {
                cancelNativeOnce();
                throw makeError("aborted", "Extraction aborted");
              }
              return J.writeTempPdf(u8);
            }).then(function (uri) {
              tmpUri = uri;
              if (signal && signal.aborted) {
                cancelNativeOnce();
                throw makeError("aborted", "Extraction aborted");
              }
              return Promise.resolve(typeof J.onProgress === "function" ? J.onProgress(function (ev) {
                if (!ev || ev.jobKey !== key || !onProgress) return;
                onProgress(Math.min(total, doneBefore + (Number(ev.done) || 0) + 1), total);
              }) : null).then(null, function () { return null; });
            }).then(function (h) {
              listener = h;
              if (signal && signal.aborted) {
                cancelNativeOnce();
                throw makeError("aborted", "Extraction aborted");
              }
              return startJob();
            }).then(function () {
              started = true;
              return poll();
            }).then(function () {
              var i = 0;
              function readNext() {
                if (i >= want.length) return Promise.resolve();
                var n = want[i++];
                var meta = null;
                for (var q = 0; q < pending.length; q++) if (pending[q].n === n) meta = pending[q];
                return Promise.resolve(J.readPage(key, n)).then(function (np) {
                  usedEngine = detectedEngine || opts.ocrEngine || null;
                  return addPage(nativePageToPage(np, n, meta ? meta.w : (np && np.width) || 0, meta ? meta.h : (np && np.height) || 0));
                }, function () {
                  throw makeError("ocr-failed", "Background page reading lost page " + n, n);
                }).then(readNext);
              }
              return readNext();
            }).then(function () {
              tidy();
              return Promise.resolve(J.clear(key)).then(function () {}, function () {});
            }, function (err) {
              tidy();
              if (!started && !(err && err.code === "aborted")) {
                // Could not hand the job over: read the waiting pages here instead (the phase 01 way).
                return inlineFallback();
              }
              throw (err && err.code) ? err : makeError("ocr-failed", (err && err.message) || "Background page reading failed");
            });
          }

          function processPage(pNo) {
            if (signal && signal.aborted) {
              return Promise.reject(makeError("aborted", "Extraction aborted", pNo));
            }
            if (pNo > total) {
              if (pending.length) {
                return runNative().then(function () { return buildSnapshot(total + 1, false); });
              }
              return Promise.resolve(buildSnapshot(total + 1, false));
            }
            if (onProgress) onProgress(pNo, total);

            var pageRef = null;
            var canvas = null;
            var cleaned = false;
            var inOcrBranch = false;
            function cleanupPage() {
              if (canvas) {
                try { canvas.width = 0; canvas.height = 0; } catch (e) {}
                canvas = null;
              }
              if (!cleaned && pageRef && typeof pageRef.cleanup === "function") {
                cleaned = true;
                try { pageRef.cleanup(); } catch (e2) {}
              }
            }

            return Promise.resolve().then(function () {
              return pdf.getPage(pNo);
            }).then(function (page) {
              pageRef = page;
              var vp = page.getViewport({ scale: 1 });
              var ptW = vp.width;
              var ptH = vp.height;
              var rp = rustPages && rustPages[pNo];
              if (rp) {
                usedRust = true;
                cleanupPage();
                return { n: pNo, width: rp.width, height: rp.height, text: String(rp.text || ""),
                  words: rp.words, tables: rp.tables, ocr: false };
              }

              return Promise.resolve(page.getTextContent()).then(function (tc) {
                var items = (tc && tc.items) || [];
                var nonSpace = 0;
                for (var i = 0; i < items.length; i++) {
                  nonSpace += String((items[i] && items[i].str) || "").replace(/\s+/g, "").length;
                }
                if (nonSpace >= TEXT_LAYER_MIN_CHARS) {
                  var tl = extractTextLayer(items, vp);
                  cleanupPage();
                  return {
                    n: pNo,
                    width: round2(ptW),
                    height: round2(ptH),
                    text: tl.text,
                    words: tl.words,
                    tables: [],
                    ocr: false
                  };
                }

                if (nativeJob) {
                  // Read later by the native background job, together with the other scanned pages.
                  cleanupPage();
                  return { n: pNo, _nativePending: true, _w: ptW, _h: ptH };
                }

                inOcrBranch = true;
                return renderAndOcr(page, pNo, ptW, ptH).then(function (pageObj) {
                  cleanupPage();
                  return pageObj;
                });
              });
            }).catch(function (err) {
              cleanupPage();
              if (err && err.code) {
                if (err.page == null && err.code !== "aborted") err.page = pNo;
                throw err;
              }
              if (err && err.name === "PasswordException") {
                throw makeError("password", (err && err.message) || "PDF is password-protected", pNo);
              }
              throw makeError(
                inOcrBranch ? "ocr-failed" : "pdf-open-failed",
                (err && err.message) || (inOcrBranch ? "OCR failed on page " + pNo : "Failed to read page " + pNo),
                pNo
              );
            }).then(function (pageObj) {
              if (pageObj && pageObj._nativePending) {
                pending.push({ n: pageObj.n, w: pageObj._w, h: pageObj._h });
                return processPage(pNo + 1);
              }
              pages.push(pageObj);
              if (pageObj.ocr) anyOcr = true;
              var snap = buildSnapshot(pNo + 1, pNo < total);
              if (onPage) {
                return Promise.resolve(onPage(snap)).then(function () {
                  return processPage(pNo + 1);
                });
              }
              return processPage(pNo + 1);
            });
          }

          return processPage(startPage).then(function (finalRes) {
            if (pdf && typeof pdf.destroy === "function") {
              try { pdf.destroy(); } catch (e) {}
            }
            return finalRes;
          }, function (err) {
            if (pdf && typeof pdf.destroy === "function") {
              try { pdf.destroy(); } catch (e) {}
            }
            throw err;
          });
        });
      });
    });
  }

  var API = {
    isEnabled: isEnabled,
    isNativeJobEnabled: isNativeJobEnabled,
    hasNativeOcr: hasNativeOcr,
    detectOcrEngine: detectOcrEngine,
    loadPdfJs: loadPdfJs,
    loadRust: loadRust,
    sha256: sha256,
    extract: extract,
    ENGINE_VERSION: ENGINE_VERSION
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RMD_ONDEVICE_PDF = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
