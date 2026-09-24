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
 *   opts.extract = optional (text) -> Promise<[condition phrases]>, e.g. the OpenMed disease tagger
 *                  (openmed-ner.js `diseases`). When it finds TWO or more conditions in one diagnosis
 *                  ("CAP with T2DM and CKD 3"), each is searched on its own and the rows are merged
 *                  round-robin, so every condition gets a code offered. Fewer than two, or any failure,
 *                  is the single-query behaviour exactly. Each merged row carries `span`.
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
    var q0 = String(diagnosisText == null ? "" : diagnosisText).trim();
    if (!q0 || typeof opts.search !== "function" || typeof opts.extract !== "function") return suggestOne(diagnosisText, opts);
    var ep;
    try { ep = opts.extract(q0); } catch (e) { ep = null; }
    if (!ep || typeof ep.then !== "function") return suggestOne(diagnosisText, opts);
    return ep.then(function (spans) {
      var seen = {}, list = [];
      (Array.isArray(spans) ? spans : []).forEach(function (x) {
        var t = String(x == null ? "" : x).trim(), k = t.toLowerCase();
        if (t.length >= 3 && !seen[k]) { seen[k] = 1; list.push(t); }
      });
      if (list.length < 2) return suggestOne(diagnosisText, opts);
      var max = opts.max || 5;
      return Promise.all(list.map(function (sp) { return suggestOne(sp, { search: opts.search, limit: opts.limit, max: max }); }))
        .then(function (per) {
          var out = [], codes = {}, i = 0, more = true;
          while (out.length < max && more) {
            more = false;
            for (var j = 0; j < per.length && out.length < max; j++) {
              var r = per[j][i]; if (!r) continue;
              more = true;
              if (codes[r.code]) continue;
              codes[r.code] = 1; r.span = list[j]; out.push(r);
            }
            i++;
          }
          return out;
        });
    }, function () { return suggestOne(diagnosisText, opts); }).then(null, function () { return []; });
  }

  function suggestOne(diagnosisText, opts) {
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
