/* img-compress.js — ONE image/PDF compressor for every StewardMD vision path.
 *
 * WHY THIS FILE EXISTS: the same ~20-line canvas compressor had been copy-pasted into icu.js
 * (compressImage), medlist.js (_compressImage) and sknx-cloudvision.js, and the constants had already
 * drifted apart - 900px here, 1024px there, 1500px for hi-quality. This is that code, once, so a fix or
 * a tuned constant lands everywhere. The callers keep their own limits; only the mechanism is shared.
 *
 * WHAT ACTUALLY COSTS AI TOKENS. Vision tokens scale with PIXEL DIMENSIONS, not file bytes. A model
 * bills by tiles/patches over width x height, so:
 *   - shrinking the LONG EDGE cuts tokens, roughly with the square of the scale;
 *   - lowering JPEG QUALITY cuts upload bytes and storage, and changes tokens NOT AT ALL.
 * Both are worth doing, for different reasons, and it is worth being clear which is which - "compress
 * harder to save tokens" is a trap that costs image quality for no token saving.
 *
 * PDFs ARE THE BIG WIN AND WERE BEING MISSED. Every PDF was rasterised to a page image and sent to the
 * vision model. A digitally generated lab report already carries its text, so rasterising it pays ~1000+
 * vision tokens per page to OCR text we could simply read for a few hundred text tokens - and OCR can
 * misread a decimal point or a drug name, which a text layer cannot. pdfParts() reads the text layer when
 * there is a real one and only rasterises genuinely scanned pages.
 *
 * CLINICAL FLOOR: these images are drug strips, ABG printouts, monitor screens and lab reports. Downscale
 * far enough and a potassium value or a drug name stops being legible - a wrong read here is a clinical
 * error, not a cosmetic one. MIN_EDGE is a hard floor the byte-fitting loop may never cross.
 *
 * Buildless ES5 IIFE. Pure helpers are exported for tests; the canvas/pdf.js paths need a browser.
 * window.SMD_IMG + module.exports.
 */
(function () {
  "use strict";
  var g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : this);

  /* ---------------- tuning ---------------- */
  var DEFAULTS = {
    maxEdge: 900,        // long edge in px. THE token lever.
    quality: 0.6,        // JPEG quality. Bytes only - never tokens.
    maxBytes: 1.6 * 1024 * 1024,
    minEdge: 700         // never shrink the long edge below this: dense lab text stops being legible
  };
  // Dense text (lab reports, discharge summaries) needs more pixels than a monitor screen.
  var PRESETS = {
    screen: { maxEdge: 900, quality: 0.6 },    // monitor / vent / pump displays: big glyphs
    strip: { maxEdge: 1100, quality: 0.65 },   // drug strips, blister packs: small print
    report: { maxEdge: 1500, quality: 0.72 },  // lab reports, ABG printouts, dense tables
    photo: { maxEdge: 1024, quality: 0.7 }     // clinical photos (skin, wound)
  };

  function opts(o) {
    o = o || {};
    var base = PRESETS[o.preset] || {};
    return {
      maxEdge: o.maxEdge || base.maxEdge || DEFAULTS.maxEdge,
      quality: (o.quality != null) ? o.quality : (base.quality != null ? base.quality : DEFAULTS.quality),
      maxBytes: o.maxBytes || DEFAULTS.maxBytes,
      minEdge: o.minEdge || DEFAULTS.minEdge
    };
  }

  /* ---------------- pure helpers (unit-tested) ---------------- */

  // Target canvas size for a source image. Never upscales - enlarging invents detail and costs tokens.
  function planScale(w, h, maxEdge) {
    var longEdge = Math.max(w, h);
    if (!longEdge) return { w: 0, h: 0, scale: 1 };
    var scale = Math.min(1, maxEdge / longEdge);
    return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)), scale: scale };
  }

  // Rough vision-token cost of an image. `perTokenPx` is the model's pixels-per-token; the default
  // matches a ~750 px/token family. Used to SHOW the saving, never to make a clinical decision.
  function tokenEstimate(w, h, perTokenPx) {
    return Math.ceil((Math.max(0, w) * Math.max(0, h)) / (perTokenPx || 750));
  }

  // Bytes behind a data-URL, without materialising the buffer.
  function dataUrlBytes(u) {
    if (typeof u !== "string") return 0;
    var i = u.indexOf(",");
    if (i < 0) return 0;
    var b64 = u.length - (i + 1), pad = u.charAt(u.length - 1) === "=" ? (u.charAt(u.length - 2) === "=" ? 2 : 1) : 0;
    return Math.max(0, Math.floor(b64 * 3 / 4) - pad);
  }

  /**
   * Is a PDF page's text layer good enough to use instead of OCR?
   * A scanned page usually still yields a few stray characters, so "has any text" is not the test.
   * Require enough characters AND enough distinct words to be a real text layer.
   */
  function textLayerUsable(text, o) {
    o = o || {};
    var minChars = o.minChars || 120, minWords = o.minWords || 20;
    var s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length < minChars) return false;
    var words = s.split(" ").filter(function (w) { return w.length > 1; });
    return words.length >= minWords;
  }

  // Decide per page: read the text, or rasterise and OCR it.
  function pickMode(text, o) { return textLayerUsable(text, o) ? "text" : "image"; }

  /* ---------------- the compressor (browser) ---------------- */
  /**
   * compress(fileOrDataUrl, opts, cb) -> cb(dataUrl|null, meta)
   * meta = { w, h, kb, quality, tokensBefore, tokensAfter }
   * Canvas re-encode also strips EXIF/GPS/timestamp metadata, which is why every vision path must go
   * through here rather than uploading a raw camera file.
   */
  function compress(fileOrDataUrl, o, cb) {
    if (typeof o === "function") { cb = o; o = {}; }
    var c = opts(o);
    var doc = g.document;
    if (!doc || !doc.createElement) { cb(null); return; }
    var img = new g.Image();
    img.onload = function () {
      var srcW = img.width, srcH = img.height;
      var p = planScale(srcW, srcH, c.maxEdge);
      var cw = p.w, ch = p.h;
      var cv = doc.createElement("canvas"), ctx;
      function paint() {
        cv.width = cw; cv.height = ch;
        ctx = cv.getContext("2d");
        // White ground: a transparent PNG flattened to JPEG otherwise goes black and hides the text.
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
      }
      paint();
      var q = c.quality, out = cv.toDataURL("image/jpeg", q), guard = 0;
      // Fit the byte budget by dropping quality first (free in token terms), and only then shrinking -
      // and never below minEdge, because past that the numbers stop being readable.
      while (dataUrlBytes(out) > c.maxBytes && guard++ < 8) {
        if (q > 0.42) { q -= 0.12; }
        else if (Math.max(cw, ch) > c.minEdge) {
          var f = Math.max(c.minEdge / Math.max(cw, ch), 0.85);
          cw = Math.round(cw * f); ch = Math.round(ch * f); paint(); q = c.quality;
        } else break;   // at the clinical floor: hand back a slightly-too-big image rather than mush
        out = cv.toDataURL("image/jpeg", Math.max(0.35, q));
      }
      cb(out, {
        w: cw, h: ch, kb: Math.round(dataUrlBytes(out) / 1024), quality: Math.max(0.35, q),
        tokensBefore: tokenEstimate(srcW, srcH), tokensAfter: tokenEstimate(cw, ch)
      });
    };
    img.onerror = function () { cb(null); };
    try {
      img.src = (typeof fileOrDataUrl === "string") ? fileOrDataUrl : g.URL.createObjectURL(fileOrDataUrl);
    } catch (e) { cb(null); }
  }

  /**
   * pdfParts(pdf, opts) -> Promise<[{ page, mode:"text", text } | { page, mode:"image", dataUrl, meta }]>
   * `pdf` is an already-opened pdf.js document (the caller owns loading it - icu.js lazy-loads the
   * bundled copy). Pages with a real text layer come back as TEXT, which is both far cheaper and more
   * accurate than OCR; only scanned pages are rendered.
   */
  function pdfParts(pdf, o) {
    var c = opts(o);
    var pages = (o && o.pages) || null;         // 1-based; default = all
    var n = pdf.numPages || 0;
    var list = pages || (function () { var a = []; for (var i = 1; i <= n; i++) a.push(i); return a; })();
    var out = [];
    return list.reduce(function (chain, pageNum) {
      return chain.then(function () {
        return pdf.getPage(pageNum).then(function (page) {
          return page.getTextContent().then(function (tc) {
            var text = ((tc && tc.items) || []).map(function (it) { return it.str; }).join(" ");
            if (pickMode(text, o) === "text") { out.push({ page: pageNum, mode: "text", text: text }); return; }
            return renderPage(page, c).then(function (r) {
              out.push({ page: pageNum, mode: "image", dataUrl: r.dataUrl, meta: r.meta });
            });
          }, function () {
            // No text layer at all (or pdf.js could not read one): rasterise.
            return renderPage(page, c).then(function (r) {
              out.push({ page: pageNum, mode: "image", dataUrl: r.dataUrl, meta: r.meta });
            });
          });
        });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  // Render one pdf.js page to a compressed JPEG at a scale that lands on maxEdge.
  function renderPage(page, c) {
    var doc = g.document;
    var base = page.getViewport({ scale: 1 });
    var scale = Math.min(2, Math.max(0.5, c.maxEdge / Math.max(base.width, base.height)));
    var vp = page.getViewport({ scale: scale });
    var cv = doc.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
      var dataUrl = cv.toDataURL("image/jpeg", c.quality);
      return {
        dataUrl: dataUrl,
        meta: { w: cv.width, h: cv.height, kb: Math.round(dataUrlBytes(dataUrl) / 1024), tokensAfter: tokenEstimate(cv.width, cv.height) }
      };
    });
  }

  var API = {
    compress: compress, pdfParts: pdfParts,
    planScale: planScale, tokenEstimate: tokenEstimate, dataUrlBytes: dataUrlBytes,
    textLayerUsable: textLayerUsable, pickMode: pickMode,
    PRESETS: PRESETS, DEFAULTS: DEFAULTS
  };
  if (typeof window !== "undefined") window.SMD_IMG = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
