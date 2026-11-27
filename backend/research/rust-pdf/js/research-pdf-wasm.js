// Load research_pdf.wasm and read a PDF. Works in a browser/WebView, a
// Cloudflare Worker and Node (ES5-style, no build step, no imports needed).
//
//   var reader = await loadResearchPdf(wasmBytesOrModule);
//   var result = reader.extract(pdfUint8Array);            // default ceilings
//   var result = reader.extract(pdfUint8Array, 60, 25 * 1024 * 1024);
//
// result is the extract.py JSON, or {error: code}, or {unsupported: reason}
// (meaning: use the existing reader for this file).
function loadResearchPdf(source) {
  var p = source instanceof WebAssembly.Module
    ? WebAssembly.instantiate(source, {})
    : WebAssembly.instantiate(source, {}).then(function (r) { return r.instance; });
  return p.then(function (instance) {
    var x = instance.exports;
    return {
      extract: function (pdf, maxPages, maxBytes) {
        var ptr = x.rs_alloc(pdf.length);
        new Uint8Array(x.memory.buffer, ptr, pdf.length).set(pdf);
        var out = maxPages === undefined
          ? x.rs_run(ptr, pdf.length)
          : x.rs_run_limits(ptr, pdf.length, maxPages, maxBytes);
        var len = x.rs_result_len();
        var text = new TextDecoder("utf-8").decode(new Uint8Array(x.memory.buffer, out, len).slice());
        x.rs_free(out, len);
        return JSON.parse(text);
      }
    };
  });
}

if (typeof module !== "undefined") module.exports = { loadResearchPdf: loadResearchPdf };
