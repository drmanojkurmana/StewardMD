/* Drug fuzzy-matcher — window.DrugFuzzy  (UMD: browser + node-testable)
 *
 * Corrects OCR / handwriting near-misses to a known generic when EXACT + brand matching both fail,
 * e.g. "Atorvastain" -> atorvastatin, "Clarithomycin" -> clarithromycin. Used by the Scan-Meds flow
 * (medlist.js resolveGeneric) as a LAST resort, and only surfaced at MEDIUM confidence — the
 * clinician confirms; a fuzzy hit is never silently committed as a definite drug (safety).
 *
 * Deliberately conservative to avoid dangerous mis-maps:
 *   • only for names >= 6 chars (short tokens like "asa" are too ambiguous),
 *   • edit distance <= min(3, round(len*0.2)),
 *   • the best match must be STRICTLY closer than the 2nd best (a tie = ambiguous -> no match).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;   // node / tests
  if (root) root.DrugFuzzy = api;                                              // browser
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function norm(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // Levenshtein edit distance (iterative, two-row).
  function editDistance(a, b) {
    a = String(a); b = String(b);
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // Best generic in `vocab` for a (possibly misspelled) OCR `name`, or null if none is confidently
  // close / the match is ambiguous. opts: { minLen=6, ratio=0.2, maxDist=3 }.
  function bestGenericMatch(name, vocab, opts) {
    opts = opts || {};
    var q = norm(name);
    var minLen = opts.minLen || 6;
    if (q.length < minLen || !vocab || !vocab.length) return null;
    var maxD = Math.min(opts.maxDist || 3, Math.max(1, Math.round(q.length * (opts.ratio || 0.2))));
    var best = null, bestD = Infinity, second = Infinity;
    for (var i = 0; i < vocab.length; i++) {
      var v = norm(vocab[i]); if (!v) continue;
      if (Math.abs(v.length - q.length) > maxD) continue;   // length prune
      if (v === q) return { generic: vocab[i], distance: 0 }; // exact (shouldn't happen — caller tried exact first)
      var d = editDistance(q, v);
      if (d < bestD) { second = bestD; bestD = d; best = vocab[i]; }
      else if (d < second) { second = d; }
    }
    if (best != null && bestD <= maxD && bestD < second) return { generic: best, distance: bestD };
    return null; // no close match, or ambiguous (tie within threshold)
  }

  return { editDistance: editDistance, bestGenericMatch: bestGenericMatch, norm: norm };
});
