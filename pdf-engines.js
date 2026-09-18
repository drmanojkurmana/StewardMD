/* pdf-engines.js — on-demand loader for the PDF/raster vendor engines (window.SMD_PDF_ENGINES).
 *
 * WHY THIS EXISTS. vendor-html2canvas.js (194 KB) + vendor-jspdf.js (357 KB) = 551 KB that every
 * cold start parsed, for two features most sessions never touch: exporting a prescription and the
 * native HTML->PDF fallback. The app ships as a Capacitor bundle read off LOCAL DISK, so deferring
 * a payload costs a file read plus parse (tens of ms), not a download — which is what makes this
 * trade nearly free here and would NOT be true for a web app.
 *
 * IT ALSO FIXES A RACE. Eager `defer` does not guarantee availability: prescription.js had to say
 * "Export engine still loading — try again" because a doctor could reach Export before the 551 KB
 * finished parsing. Awaiting a loader removes that window instead of apologising for it.
 *
 * CONTRACT UNCHANGED: the engines still land on window.html2canvas / window.jspdf with the same
 * shapes. Callers await ensure() first; every existing "engine unavailable" guard stays as the
 * fail-safe, so a load failure degrades exactly as before rather than throwing somewhere new.
 */
(function () {
  "use strict";
  var SRC = ["/vendor-html2canvas.js?v=1", "/vendor-jspdf.js?v=1"];
  var _p = null;

  function has() {
    return !!(window.html2canvas && ((window.jspdf && window.jspdf.jsPDF) || window.jsPDF));
  }
  function loadOne(src) {
    return new Promise(function (res, rej) {
      var sel = 'script[data-smdpdf="' + src + '"]';
      if (document.querySelector(sel)) { res(); return; }          // already injected by an earlier ensure()
      var s = document.createElement("script");
      s.src = src; s.defer = true; s.setAttribute("data-smdpdf", src);
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error("pdf-engine-load-failed:" + src)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  /* Resolves true when both engines are on window, false if they could not be loaded. NEVER
   * rejects: every call site already branches on the globals being absent, and turning a missing
   * export engine into an unhandled rejection would be a new failure mode, not a fixed one.
   * The promise is cached, so N concurrent exports inject the scripts once. */
  function ensure() {
    if (has()) return Promise.resolve(true);
    if (_p) return _p;
    _p = SRC.reduce(function (chain, src) {                        // sequential: jspdf is the heavier parse
      return chain.then(function () { return loadOne(src); });
    }, Promise.resolve())
      .then(function () { return has(); })
      .catch(function () { _p = null; return false; });            // clear so a later retry can work
    return _p;
  }

  /* NOT window.SMD_PDF — native-bridge.js already owns that name for its fromHtml()
 * renderer, and clobbering it would break PDF export in MaiK, onco and reports. */
window.SMD_PDF_ENGINES = { ensure: ensure, loaded: has, _sources: SRC };
})();
