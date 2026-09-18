/* StewardMD — MaiK Scribe: ICD-10 code suggestions for a dictated diagnosis.
 * ---------------------------------------------------------------------------
 * Thin ranking layer over the app's offline ICD index (SMD_ICD.localSearch, injected).
 * Suggestions only — the clinician picks the code; nothing is ever auto-assigned.
 *
 * suggest(diagnosisText, opts) -> Promise<[{code, term, score}]>  (at most 5)
 *   opts.search = window.SMD_ICD.localSearch  -> Promise<[{code, title, ...}]>  (injected)
 *   opts.limit  = how many rows to ask the index for (default 20)
 *   opts.max    = how many suggestions to return  (default 5)
 *
 * Never throws and never rejects: no search engine, a thrown search, a rejected promise
 * or a junk result all resolve to []. score is the fraction of the query's words the term
 * matched (0-1); the index's own ranking decides the order.
 *
 * window.SMD_SCRIBEICD + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  function words(s) {
    return String(s == null ? "" : s).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) {
      return w.length > 2;
    });
  }

  function suggest(diagnosisText, opts) {
    opts = opts || {};
    var max = opts.max || 5;
    var q = String(diagnosisText == null ? "" : diagnosisText).trim();
    if (!q || typeof opts.search !== "function") return Promise.resolve([]);

    var p;
    try { p = opts.search(q, opts.limit || 20); } catch (e) { return Promise.resolve([]); }
    if (!p || typeof p.then !== "function") return Promise.resolve([]);

    var qw = words(q);
    return p.then(function (rows) {
      if (!Array.isArray(rows)) return [];
      var out = [];
      for (var i = 0; i < rows.length && out.length < max; i++) {
        var r = rows[i];
        if (!r || !r.code) continue;
        var term = r.title || r.term || "";
        var tw = words(term), hit = 0;
        for (var j = 0; j < qw.length; j++) {
          for (var k = 0; k < tw.length; k++) {
            if (tw[k].indexOf(qw[j]) === 0 || qw[j].indexOf(tw[k]) === 0) { hit++; break; }
          }
        }
        out.push({
          code: r.code,
          term: term,
          score: qw.length ? Math.round((hit / qw.length) * 100) / 100 : 0
        });
      }
      return out;
    }, function () { return []; });
  }

  var API = { suggest: suggest, _version: "1.0" };
  if (root) root.SMD_SCRIBEICD = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
