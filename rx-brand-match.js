/* rx-brand-match.js — the Rx brand field's matching rules, as pure functions.
 *
 * WHY THIS FILE EXISTS: the prescription pad's brand autocomplete used to resolve the typed DRUG to a
 * composition and then filter that molecule's brands. It never asked the brand-name endpoint. So when
 * the drug field held a clinical shorthand the composition index does not carry - "Amoxiclav" for
 * Amoxycillin + Clavulanic Acid - typing "Augmen" found nothing, while the Drugs Database, which
 * queries BOTH /search and /brand-search on the SAME backend, listed every Augmentin instantly. Same
 * data, one missing query. The empty state then said "Type the drug first" even though a drug WAS
 * typed, which sent the clinician looking for the wrong mistake.
 *
 * Pulled out here, exactly like functions/_sse_parse.js, so the merge and empty-state rules can be
 * unit-tested without booting the whole app in a browser.
 *
 * Dual export: window.SMD_RX_BRANDS for the app, module.exports for node tests.
 */
(function (root) {
  "use strict";

  function name(b) { return String((b && b.brand) || ""); }

  /* Brands to show = the molecule's brands (filtered by what is typed) PLUS brands matched by name,
   * de-duplicated case-insensitively, molecule hits first so the resolved drug still leads. */
  function merge(molBrands, typedBrands, query) {
    var q = String(query == null ? "" : query).trim().toLowerCase();
    var base = molBrands || [];
    if (q) base = base.filter(function (b) { return name(b).toLowerCase().indexOf(q) >= 0; });
    var seen = {}, out = [];
    base.concat(typedBrands || []).forEach(function (b) {
      var k = name(b).toLowerCase();
      if (!k || seen[k]) return;
      seen[k] = 1; out.push(b);
    });
    return out;
  }

  /* What to say when nothing matches. Never claim the drug field is empty when it is not. */
  function emptyMessage(drug, query, busy) {
    if (busy) return "Searching…";
    var d = String(drug == null ? "" : drug).trim();
    if (!d) return "Type the drug first, then tap here for brands";
    var q = String(query == null ? "" : query).trim();
    return q ? "No brand matches “" + q + "”" : "No brands found for “" + d + "”";
  }

  /* A brand-name search is only worth issuing once the user has typed enough to be selective. */
  function shouldSearchBrands(query) { return String(query == null ? "" : query).trim().length >= 3; }

  var api = { merge: merge, emptyMessage: emptyMessage, shouldSearchBrands: shouldSearchBrands };
  try { root.SMD_RX_BRANDS = api; } catch (e) {}
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
