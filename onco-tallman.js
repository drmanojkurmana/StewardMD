/* onco-tallman.js — tall-man lettering for confusable oncology drug NAMES (window.SMD_ONCOTALLMAN).
 * Phase 8 P1. Buildless ES5 IIFE. Pure lookup, no DOM, no fetch, no clinical facts (no doses,
 * no indications) — ONLY the spelling emphasis that reduces look-alike name errors.
 *
 * SOURCE (single, cited, small): ISMP List of Confused Drug Names (tall-man lettering). Every form
 * below is taken from that list. We NEVER invent a tall-man form. Pairs kept deliberately minimal —
 * the well-established oncology look-alikes only.
 * window.SMD_ONCOTALLMAN + module.exports (fully testable in Node). */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;

  var SOURCE = "ISMP List of Confused Drug Names (tall-man lettering)";

  // generic (lowercase key) -> { tallman: display form, confusedWith: [generics] }
  var MAP = {
    doxorubicin:  { tallman: "DOXOrubicin",  confusedWith: ["daunorubicin", "idarubicin"] },
    daunorubicin: { tallman: "DAUNOrubicin", confusedWith: ["doxorubicin"] },
    idarubicin:   { tallman: "IDArubicin",   confusedWith: ["doxorubicin"] },
    vincristine:  { tallman: "vinCRIStine",  confusedWith: ["vinblastine"] },
    vinblastine:  { tallman: "vinBLAStine",  confusedWith: ["vincristine"] },
    cisplatin:    { tallman: "CISplatin",    confusedWith: ["carboplatin"] },
    carboplatin:  { tallman: "CARBOplatin",  confusedWith: ["cisplatin"] }
  };

  function entry(name) {
    if (!name) return null;
    return MAP[String(name).trim().toLowerCase()] || null;
  }

  // apply(name): returns the ISMP tall-man form when `name` is (or contains, as a whole word) a
  // mapped generic; otherwise returns `name` unchanged. Case-insensitive, whole-word only so we
  // never mangle an unrelated substring. Never fabricates a form for an unmapped drug.
  function apply(name) {
    if (name == null) return name;
    var s = String(name);
    var direct = MAP[s.trim().toLowerCase()];
    if (direct) return direct.tallman;                 // exact whole-name match
    for (var gen in MAP) {                              // token inside a longer name (e.g. "Doxorubicin liposomal")
      if (!Object.prototype.hasOwnProperty.call(MAP, gen)) continue;
      var re;
      try { re = new RegExp("\\b" + gen + "\\b", "i"); } catch (e) { continue; }
      if (re.test(s)) return s.replace(re, MAP[gen].tallman);
    }
    return s;
  }

  // confusedWith(name): the ISMP-cited look-alike partners (tall-man forms) for a tooltip, or [].
  function confusedWith(name) {
    var e = entry(name);
    if (!e) return [];
    return (e.confusedWith || []).map(function (g) { return (MAP[g] && MAP[g].tallman) || g; });
  }

  var API = { MAP: MAP, SOURCE: SOURCE, apply: apply, entry: entry, confusedWith: confusedWith, _version: "1.0" };
  G.SMD_ONCOTALLMAN = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
