/* StewardMD - the Rust PDF reader on the phone (window.SMD_RUST_PDF). ES5, no build step.
 * research_pdf.wasm is built from backend/research/rust-pdf (see its README). It reads a PDF's text layer the same way
 * the ResearchMD server reader (backend/research/worker/research_worker/extract.py) does, word for word and
 * table for table, so the phone and the server give the same result. It does not draw pages or read scans:
 * pdf.js and the phone's own OCR still do that.
 *   SMD_RUST_PDF.extract(u8, { maxPages, maxBytes }) -> Promise(extract.py result, or null)
 *   SMD_RUST_PDF.lines(u8, [pageNumbers], { maxBytes }) -> Promise({ pages: [{ n, lines: [{ tx, size, bold }] }], total }, or null)
 * null means "use the old reader": the reader is off, failed to load, or met a PDF feature it does not copy.
 * Kill switch: localStorage smd_rust_pdf = "0" (or ?rust_pdf=0) turns it off on this device.
 * Nothing here sends anything anywhere. No em or en dashes. */
(function (G) {
  "use strict";

  var WASM_URL = "/vendor/rust-pdf/research_pdf.wasm";
  var DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
  var _ready = null;
  var _wasmBytes = null;

  function isEnabled() {
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rust_pdf=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem("smd_rust_pdf") !== "0";
    } catch (e2) {}
    return true;
  }

  // Tests (Node) hand the wasm bytes in; the app fetches them from the bundle.
  function setWasm(bytes) { _wasmBytes = bytes; _ready = null; }

  function load() {
    if (_ready) return _ready;
    if (typeof WebAssembly === "undefined") return Promise.resolve(null);
    var bytesP = _wasmBytes ? Promise.resolve(_wasmBytes)
      : (typeof fetch === "function" ? fetch(WASM_URL).then(function (r) {
          if (!r.ok) throw new Error("wasm " + r.status);
          return r.arrayBuffer();
        }) : Promise.reject(new Error("no fetch")));
    _ready = bytesP.then(function (bytes) {
      return WebAssembly.instantiate(bytes, {});
    }).then(function (r) {
      return (r && r.instance) ? r.instance.exports : r.exports;
    }).catch(function () {
      _ready = null;
      return null;
    });
    return _ready;
  }

  function call(x, run) {
    var len = x.rs_result_len();
    var out = run;
    var text = new TextDecoder("utf-8").decode(new Uint8Array(x.memory.buffer, out, len).slice());
    x.rs_free(out, len);
    return JSON.parse(text);
  }

  function copyIn(x, u8) {
    var ptr = x.rs_alloc(u8.length);
    new Uint8Array(x.memory.buffer, ptr, u8.length).set(u8);
    return ptr;
  }

  function extract(u8, opts) {
    opts = opts || {};
    if (!isEnabled()) return Promise.resolve(null);
    return load().then(function (x) {
      if (!x) return null;
      try {
        var maxPages = typeof opts.maxPages === "number" && opts.maxPages > 0 ? Math.floor(opts.maxPages) : 60;
        var maxBytes = typeof opts.maxBytes === "number" && opts.maxBytes > 0 ? Math.floor(opts.maxBytes) : DEFAULT_MAX_BYTES;
        var ptr = copyIn(x, u8);
        var res = call(x, x.rs_run_limits(ptr, u8.length, maxPages, maxBytes));
        return res && Array.isArray(res.pages) ? res : null;
      } catch (e) {
        _ready = null; // a trap can leave the module unusable; load a fresh one next time
        return null;
      }
    });
  }

  function lines(u8, pages, opts) {
    opts = opts || {};
    if (!isEnabled()) return Promise.resolve(null);
    return load().then(function (x) {
      if (!x) return null;
      try {
        var maxBytes = typeof opts.maxBytes === "number" && opts.maxBytes > 0 ? Math.floor(opts.maxBytes) : 50 * 1024 * 1024;
        var list = (pages || []).filter(function (p) { return p >= 1 && p === Math.floor(p); });
        var ptr = copyIn(x, u8);
        var pp = x.rs_alloc(list.length * 4);
        var view = new DataView(x.memory.buffer, pp, list.length * 4);
        for (var i = 0; i < list.length; i++) view.setUint32(i * 4, list[i], true);
        var res = call(x, x.rs_lines(ptr, u8.length, pp, list.length, maxBytes));
        return res && Array.isArray(res.pages) ? res : null;
      } catch (e) {
        _ready = null;
        return null;
      }
    });
  }

  var API = { isEnabled: isEnabled, load: load, setWasm: setWasm, extract: extract, lines: lines, WASM_URL: WASM_URL };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RUST_PDF = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
