/* ward-dicom-viewer.js - the in-app DICOM viewer's engine: parse, decode, window/level, draw, interact.
 *
 * NO WORDS HERE. Every label, error sentence and header line is ward.js's (wT/wTH, 8 language packs); this
 * file returns codes ("unsupported_transfer_syntax", ...) and numbers.
 *
 * LIBRARY. dicom-parser 1.8.21 (MIT, cornerstonejs/dicomParser), pinned, loaded from cdn.jsdelivr.net with
 * Subresource Integrity, and only when a viewer is opened. dwv was not used (GPL-3.0); cornerstone3D was not
 * used (its codecs run as cross-origin web workers and WASM, which a Capacitor WebView loading from a CDN
 * does not do cleanly). Decoding is here: uncompressed (implicit/explicit little endian, explicit big endian)
 * and JPEG baseline (1.2.840.10008.1.2.4.50) through the browser's own JPEG decoder. Anything else is
 * reported as unsupported with its transfer syntax UID, never drawn wrongly.
 *
 * MEMORY ONLY. Decoded images live in this viewer's object and are dropped by destroy(). Nothing is written
 * to localStorage, IndexedDB or the Cache API.
 */
(function (G) {
  "use strict";
  var PARSER_URL = "https://cdn.jsdelivr.net/npm/dicom-parser@1.8.21/dist/dicomParser.min.js";
  var PARSER_SRI = "sha384-Z8ua3fbU1i9fPqw0gGLF0aw6yqnTK3GO6R9CFvnlvXB0x0AIFi6JqYvQ6v+s9kuw";
  var TS = { "1.2.840.10008.1.2": "le", "1.2.840.10008.1.2.1": "le", "1.2.840.10008.1.2.2": "be", "1.2.840.10008.1.2.4.50": "jpeg" };
  /* CT presets in Hounsfield units: [window width, window centre]. */
  var PRESETS = { brain: [80, 40], lung: [1500, -600], bone: [1800, 400], abdomen: [400, 50] };
  var parserP = null;

  function loadParser() {
    if (G.dicomParser) return Promise.resolve(G.dicomParser);
    if (parserP) return parserP;
    parserP = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = PARSER_URL; s.integrity = PARSER_SRI; s.crossOrigin = "anonymous";
      s.onload = function () { if (G.dicomParser) res(G.dicomParser); else { parserP = null; rej(new Error("parser_load_failed")); } };
      s.onerror = function () { parserP = null; rej(new Error("parser_load_failed")); };
      document.head.appendChild(s);
    });
    return parserP;
  }

  function fail(code, extra) { var e = new Error(code); e.code = code; if (extra) e.detail = extra; return e; }
  function fnum(ds, t, i) { var v = ds.string(t); if (!v) return null; var n = parseFloat(v.split("\\")[i || 0]); return isFinite(n) ? n : null; }

  function jpegPixels(bytes, rows, cols) {
    var blob = new Blob([bytes], { type: "image/jpeg" });
    return G.createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" }).then(function (bmp) {
      var c = document.createElement("canvas"); c.width = cols; c.height = rows;
      var x = c.getContext("2d"); x.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return x.getImageData(0, 0, cols, rows).data;
    }, function () { throw fail("decode_failed"); });
  }

  /** One frame of one instance -> { rows, cols, spp, px (Float32Array, modality values), min, max, wc, ww, invert, spacing, frames } */
  function decode(buffer, frame) {
    frame = frame || 0;
    return loadParser().then(function (dp) {
      var bytes = new Uint8Array(buffer), ds;
      try { ds = dp.parseDicom(bytes); } catch (e) { throw fail("not_dicom"); }
      var tsuid = (ds.string("x00020010") || "1.2.840.10008.1.2").replace(/\0/g, "").trim();
      var pe = ds.elements.x7fe00010;
      if (!pe) throw fail("no_pixel_data");
      var kind = TS[tsuid];
      if (!kind) throw fail("unsupported_transfer_syntax", tsuid);
      var rows = ds.uint16("x00280010"), cols = ds.uint16("x00280011"), spp = ds.uint16("x00280002") || 1;
      var bits = ds.uint16("x00280100") || 8, signed = ds.uint16("x00280103") === 1;
      var photometric = (ds.string("x00280004") || "MONOCHROME2").trim();
      var frames = parseInt(ds.string("x00280008"), 10) || 1;
      if (!rows || !cols || (spp !== 1 && spp !== 3) || frame >= frames) throw fail("unsupported_image");
      var slope = fnum(ds, "x00281053"), intercept = fnum(ds, "x00281052");
      slope = slope == null || slope === 0 ? 1 : slope; intercept = intercept || 0;
      var sp = ds.string("x00280030"), spacing = null;
      if (sp) { var a = sp.split("\\").map(parseFloat); if (a.length === 2 && a[0] > 0 && a[1] > 0) spacing = a; }
      var n = rows * cols, px = new Float32Array(n * spp);
      var done;
      if (kind === "jpeg") {
        if (!pe.encapsulatedPixelData) throw fail("not_dicom");
        var frag = frames > 1
          ? dp.readEncapsulatedImageFrame(ds, pe, frame, pe.basicOffsetTable.length ? pe.basicOffsetTable : dp.createJPEGBasicOffsetTable(ds, pe))
          : dp.readEncapsulatedPixelDataFromFragments(ds, pe, 0, pe.fragments.length);
        done = jpegPixels(frag, rows, cols).then(function (rgba) {
          for (var i = 0; i < n; i++) {
            if (spp === 1) px[i] = rgba[i * 4] * slope + intercept;
            else { px[i * 3] = rgba[i * 4]; px[i * 3 + 1] = rgba[i * 4 + 1]; px[i * 3 + 2] = rgba[i * 4 + 2]; }
          }
        });
      } else {
        if (bits !== 8 && bits !== 16) throw fail("unsupported_image");
        var bpp = bits / 8, off = pe.dataOffset + frame * n * spp * bpp, le = kind === "le";
        if (off + n * spp * bpp > bytes.length) throw fail("truncated");
        var dv = new DataView(bytes.buffer, bytes.byteOffset);
        var planar = spp === 3 && ds.uint16("x00280006") === 1;
        for (var i = 0; i < n * spp; i++) {
          var v = bits === 8 ? (signed ? dv.getInt8(off + i) : bytes[off + i]) : (signed ? dv.getInt16(off + 2 * i, le) : dv.getUint16(off + 2 * i, le));
          if (spp === 1) px[i] = v * slope + intercept;
          else if (planar) { var p = Math.floor(i / n), k = i % n; px[k * 3 + p] = v; }
          else px[i] = v;
        }
        done = Promise.resolve();
      }
      return done.then(function () {
        var min = Infinity, max = -Infinity;
        for (var j = 0; j < px.length; j++) { if (px[j] < min) min = px[j]; if (px[j] > max) max = px[j]; }
        var wc = fnum(ds, "x00281050"), ww = fnum(ds, "x00281051");
        if (spp === 3 || ww == null || ww <= 0 || wc == null) { ww = Math.max(1, max - min); wc = min + ww / 2; }
        return { rows: rows, cols: cols, spp: spp, px: px, min: min, max: max, wc: wc, ww: ww, invert: photometric === "MONOCHROME1",
          spacing: spacing, frames: frames, tsuid: tsuid };
      });
    });
  }

  /** Draws `img` into `canvas` at view { wc, ww, zoom, panX, panY }, plus an optional measurement line. */
  function render(canvas, img, v, line) {
    var off = img._off;
    if (!off) { off = img._off = document.createElement("canvas"); off.width = img.cols; off.height = img.rows; img._id = off.getContext("2d").createImageData(img.cols, img.rows); }
    var d = img._id.data, px = img.px, n = img.rows * img.cols, lo = v.wc - v.ww / 2, sc = 255 / Math.max(1, v.ww);
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < 3; c++) {
        var g = ((img.spp === 3 ? px[i * 3 + c] : px[i]) - lo) * sc;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i * 4 + c] = img.invert ? 255 - g : g;
      }
      d[i * 4 + 3] = 255;
    }
    off.getContext("2d").putImageData(img._id, 0, 0);
    var ctx = canvas.getContext("2d"), cw = canvas.width, ch = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cw, ch);
    var s = Math.min(cw / img.cols, ch / img.rows) * v.zoom;
    var x0 = (cw - img.cols * s) / 2 + v.panX, y0 = (ch - img.rows * s) / 2 + v.panY;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.drawImage(off, x0, y0, img.cols * s, img.rows * s);
    if (line && line.a && line.b) {
      ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 2 * (G.devicePixelRatio || 1);
      ctx.beginPath(); ctx.moveTo(x0 + line.a[0] * s, y0 + line.a[1] * s); ctx.lineTo(x0 + line.b[0] * s, y0 + line.b[1] * s); ctx.stroke();
    }
    return { scale: s, x0: x0, y0: y0 };
  }

  /** PURE. A line's length: millimetres when the image has PixelSpacing (row, column), else pixels. */
  function lengthOf(img, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    if (img.spacing) return { value: Math.sqrt(Math.pow(dx * img.spacing[1], 2) + Math.pow(dy * img.spacing[0], 2)), unit: "mm" };
    return { value: Math.sqrt(dx * dx + dy * dy), unit: "px" };
  }

  /**
   * The interactive viewer on one canvas. opts: { load(i) -> Promise<ArrayBuffer>, count, frameOf(i)?, onChange(state), onClose() }
   * Slice i of the stack is load(i) decoded at frameOf(i) (default 0). Tools: scroll (default), wl, pan, zoom, measure.
   */
  function Viewer(canvas, opts) {
    var self = this, cache = {}, order = [], layout = null, drag = null;
    self.index = 0; self.count = opts.count; self.tool = "scroll"; self.view = null; self.img = null; self.error = null; self.line = null; self.loading = false;

    function emit() {
      var len = self.line && self.line.b && self.img ? lengthOf(self.img, self.line.a, self.line.b) : null;
      opts.onChange && opts.onChange({ index: self.index, count: self.count, tool: self.tool, wc: self.view ? Math.round(self.view.wc) : null, ww: self.view ? Math.round(self.view.ww) : null,
        zoom: self.view ? self.view.zoom : 1, error: self.error, loading: self.loading, length: len, frames: self.img ? self.img.frames : null });
    }
    function fit() {
      var r = canvas.getBoundingClientRect(), dpr = G.devicePixelRatio || 1;
      var w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    function draw() { if (self.img && self.view) { fit(); layout = render(canvas, self.img, self.view, self.line); } }
    function get(i) {
      if (cache[i]) return cache[i];
      var p = cache[i] = Promise.resolve(opts.load(i)).then(function (buf) { return decode(buf, opts.frameOf ? opts.frameOf(i) : 0); });
      p.catch(function () { delete cache[i]; });
      order.push(i); if (order.length > 400) delete cache[order.shift()];   // ponytail: FIFO memory cap, LRU if big studies thrash
      return p;
    }
    self.go = function (i) {
      i = Math.max(0, Math.min(self.count - 1, i | 0));
      self.index = i; self.loading = true; emit();
      return get(i).then(function (img) {
        if (self.index !== i || self.destroyed) return;
        if (!self.view) self.view = { wc: img.wc, ww: img.ww, zoom: 1, panX: 0, panY: 0 };
        self.img = img; self.error = null; self.loading = false; draw(); emit();
        if (i + 1 < self.count) get(i + 1).catch(function () {});
      }, function (e) {
        if (self.index !== i || self.destroyed) return;
        self.img = null; self.loading = false; self.error = { code: (e && e.code) || (e && e.message) || "load_failed", detail: e && e.detail };
        var ctx = canvas.getContext("2d"); fit(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        emit();
      });
    };
    self.scroll = function (d) { return self.go(self.index + d); };
    self.setWL = function (wc, ww) { if (!self.view) return; self.view.wc = wc; self.view.ww = Math.max(1, ww); draw(); emit(); };
    self.preset = function (name) { var p = PRESETS[name]; if (p) self.setWL(p[1], p[0]); };
    self.zoomBy = function (f) { if (!self.view) return; self.view.zoom = Math.max(0.25, Math.min(16, self.view.zoom * f)); draw(); emit(); };
    self.reset = function () { if (!self.img) return; self.view = { wc: self.img.wc, ww: self.img.ww, zoom: 1, panX: 0, panY: 0 }; self.line = null; draw(); emit(); };
    self.setTool = function (t) { self.tool = t; if (t !== "measure") self.line = null; draw(); emit(); };
    self.redraw = draw;

    function imgPoint(e) {
      var r = canvas.getBoundingClientRect(), dpr = canvas.width / Math.max(1, r.width);
      return [((e.clientX - r.left) * dpr - layout.x0) / layout.scale, ((e.clientY - r.top) * dpr - layout.y0) / layout.scale];
    }
    function onWheel(e) { e.preventDefault(); if (e.ctrlKey) self.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); else self.scroll(e.deltaY > 0 ? 1 : -1); }
    function onDown(e) {
      if (!self.view) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, acc: 0, view: { wc: self.view.wc, ww: self.view.ww, zoom: self.view.zoom, panX: self.view.panX, panY: self.view.panY } };
      if (self.tool === "measure" && layout) { var p = imgPoint(e); self.line = { a: p, b: p }; }
    }
    function onMove(e) {
      if (!drag || !self.view) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y, dpr = G.devicePixelRatio || 1, v = self.view;
      if (self.tool === "wl") { var k = Math.max(1, drag.view.ww) / 300; v.ww = Math.max(1, drag.view.ww + dx * k); v.wc = drag.view.wc + dy * k; draw(); emit(); }
      else if (self.tool === "pan") { v.panX = drag.view.panX + dx * dpr; v.panY = drag.view.panY + dy * dpr; draw(); }
      else if (self.tool === "zoom") { v.zoom = Math.max(0.25, Math.min(16, drag.view.zoom * Math.pow(1.01, -dy))); draw(); emit(); }
      else if (self.tool === "measure" && self.line && layout) { self.line.b = imgPoint(e); draw(); emit(); }
      else if (self.tool === "scroll") { var step = Math.trunc((dy - drag.acc) / 12); if (step) { drag.acc += step * 12; self.scroll(step); } }
    }
    function onUp() { drag = null; }
    function onKey(e) {
      var t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      var k = e.key, handled = true;
      if (k === "ArrowDown" || k === "ArrowRight" || k === "PageDown") self.scroll(k === "PageDown" ? 10 : 1);
      else if (k === "ArrowUp" || k === "ArrowLeft" || k === "PageUp") self.scroll(k === "PageUp" ? -10 : -1);
      else if (k === "Home") self.go(0);
      else if (k === "End") self.go(self.count - 1);
      else if (k === "+" || k === "=") self.zoomBy(1.2);
      else if (k === "-") self.zoomBy(1 / 1.2);
      else if (k === "r" || k === "R") self.reset();
      else if (k === "1") self.preset("brain"); else if (k === "2") self.preset("lung"); else if (k === "3") self.preset("bone"); else if (k === "4") self.preset("abdomen");
      else if (k === "s") self.setTool("scroll"); else if (k === "w") self.setTool("wl"); else if (k === "p") self.setTool("pan"); else if (k === "z") self.setTool("zoom"); else if (k === "m") self.setTool("measure");
      else if (k === "Escape") { if (opts.onClose) opts.onClose(); }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    }
    canvas.style.touchAction = "none";
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
    G.addEventListener("keydown", onKey, true);
    G.addEventListener("resize", draw);
    self.destroy = function () {
      self.destroyed = true; cache = {}; order = []; self.img = null;
      canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      G.removeEventListener("keydown", onKey, true); G.removeEventListener("resize", draw);
    };
  }

  G.WardDicom = { loadParser: loadParser, decode: decode, render: render, lengthOf: lengthOf, Viewer: Viewer, PRESETS: PRESETS, TRANSFER_SYNTAXES: Object.keys(TS) };
})(typeof window !== "undefined" ? window : this);
