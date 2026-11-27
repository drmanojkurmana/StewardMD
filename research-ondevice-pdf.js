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

  function sha256Hex(u8) {
    var subtle = G && G.crypto && G.crypto.subtle;
    if (!subtle || typeof subtle.digest !== "function") return Promise.resolve(null);
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
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
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

    if (signal && signal.aborted) {
      return Promise.reject(makeError("aborted", "Extraction aborted"));
    }

    var pdfjsPromise = opts.pdfjs ? Promise.resolve(opts.pdfjs) : loadPdfJs();
    return Promise.all([pdfjsPromise, toUint8Array(source)]).then(function (pair) {
      var pdfjs = pair[0];
      var u8 = pair[1];
      if (signal && signal.aborted) throw makeError("aborted", "Extraction aborted");
      var preSha = (typeof opts.sha256 === "string" && /^[0-9a-f]{64}$/.test(opts.sha256)) ? opts.sha256 : null;
      return (preSha ? Promise.resolve(preSha) : sha256Hex(u8)).then(function (sha256Val) {
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

          function buildSnapshot(nextPage, isPartial) {
            return {
              pages: pages.slice(),
              ocr: anyOcr,
              sha256: sha256Val,
              engine: "ondevice",
              ocrEngine: anyOcr ? usedEngine : null,
              partial: isPartial,
              nextPage: nextPage,
              engineVersion: ENGINE_VERSION
            };
          }

          function processPage(pNo) {
            if (signal && signal.aborted) {
              return Promise.reject(makeError("aborted", "Extraction aborted", pNo));
            }
            if (pNo > total) {
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

                if (!customOcr && !hasNativeOcr()) {
                  cleanupPage();
                  throw makeError("ocr-unavailable", "Native OCR is unavailable on this device", pNo);
                }
                if (!ocrFn) {
                  cleanupPage();
                  throw makeError("ocr-unavailable", "Native OCR is unavailable on this device", pNo);
                }

                inOcrBranch = true;
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
                var renderPromise = (renderTask && renderTask.promise) ? renderTask.promise : Promise.resolve(renderTask);

                return renderPromise.then(function () {
                  var dataUrl = canvas.toDataURL("image/jpeg", 0.9);
                  cleanupPage();
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
    hasNativeOcr: hasNativeOcr,
    detectOcrEngine: detectOcrEngine,
    loadPdfJs: loadPdfJs,
    sha256: sha256,
    extract: extract,
    ENGINE_VERSION: ENGINE_VERSION
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RMD_ONDEVICE_PDF = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
