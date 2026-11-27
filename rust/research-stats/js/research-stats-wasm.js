/* StewardMD - ResearchMD statistics, Rust core compiled to WebAssembly.
 * Same results as backend/research/stats (regression and survival), checked
 * against R. Works in the app's WebView and in a Cloudflare Worker.
 * Dual export: browser global SMD_RESEARCH_STATS_WASM and CommonJS.
 *
 *   var stats = await SMD_RESEARCH_STATS_WASM.load(wasmBytesOrModule);
 *   var out = stats.run({ family: "km", time: [...], event: [...],
 *                         compliance: { ipdApproved: true, evidenceId: "..." } });
 *   // out = { ok: true, result: {...} } or { ok: false, error: "code" }
 *
 * In a Worker, import the .wasm file as a module (wrangler bundles it) and
 * pass that WebAssembly.Module to load(). No network, no model calls.
 */
(function (G) {
  "use strict";

  function wrap(instance) {
    var ex = instance.exports;
    var enc = new TextEncoder();
    var dec = new TextDecoder();
    function run(request) {
      var bytes = enc.encode(typeof request === "string" ? request : JSON.stringify(request));
      var ptr = ex.rs_alloc(bytes.length);
      new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
      var out = ex.rs_run(ptr, bytes.length); // frees the request buffer
      var len = ex.rs_result_len();
      var text = dec.decode(new Uint8Array(ex.memory.buffer, out, len).slice());
      ex.rs_free(out, len);
      return JSON.parse(text);
    }
    return { run: run };
  }

  function load(source) {
    var p;
    if (source instanceof WebAssembly.Module) {
      p = WebAssembly.instantiate(source, {});
    } else {
      p = WebAssembly.instantiate(source, {}).then(function (r) { return r.instance; });
    }
    return Promise.resolve(p).then(wrap);
  }

  var API = { load: load };
  if (G) { G.SMD_RESEARCH_STATS_WASM = API; }
  if (typeof module !== "undefined" && module.exports) { module.exports = API; }
})(typeof globalThis !== "undefined" ? globalThis : this);
