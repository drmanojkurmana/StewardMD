/* StewardMD — Medication list builder. Exposes window.MEDLIST.
   Deterministic parsing only (no AI). Keeps original text until the clinician
   confirms an uncertain drug mapping. */
(function () {
  "use strict";
  var FORM_PREFIX = { t: "tablet", tab: "tablet", tabs: "tablet", cap: "capsule", caps: "capsule",
    inj: "injection", syp: "syrup", syr: "syrup", susp: "suspension", drop: "drops", oint: "ointment",
    neb: "nebulisation", inh: "inhaler" };
  var ROUTES = { iv: "IV", po: "PO", oral: "PO", im: "IM", sc: "SC", sl: "SL", pr: "PR",
    inh: "INH", neb: "NEB", top: "TOP", topical: "TOP", ng: "NG" };
  var FREQ = { od: "OD", bd: "BD", bid: "BD", tds: "TDS", tid: "TDS", qid: "QID", qds: "QID",
    hs: "HS", sos: "SOS", stat: "STAT", "q6h": "Q6H", "q8h": "Q8H", "q12h": "Q12H", qd: "OD",
    morning: "OD", night: "HS", "once daily": "OD", "twice daily": "BD" };
  var UNIT_RE = /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?|%)\b/i;
  var BARE_NUM_RE = /\b(\d+(?:\.\d+)?)\b/;

  function tokens(s) { return s.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean); }

  function parseEntry(text) {
    var raw = (text || "").trim();
    var out = { raw: raw, name: null, generic: null, strength: null, unit: null, form: null,
      route: null, freq: null, freqText: null, confidence: "low", candidates: [] };
    if (!raw) return out;
    var toks = tokens(raw), rest = [];
    // form prefix (first token)
    if (toks.length && FORM_PREFIX[toks[0]]) { out.form = FORM_PREFIX[toks[0]]; toks = toks.slice(1); }
    // strength (with unit if present; falls back to a bare number, e.g. "metformin 500 bd")
    var m = raw.match(UNIT_RE);
    if (m) { out.strength = parseFloat(m[1]); out.unit = m[2].toLowerCase().replace(/s$/, ""); }
    else { var bm = raw.match(BARE_NUM_RE); if (bm) out.strength = parseFloat(bm[1]); }
    // route + freq + strip numerics/units; remaining tokens = drug name
    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];
      if (ROUTES[tk]) { out.route = ROUTES[tk]; continue; }
      if (FREQ[tk]) { out.freq = FREQ[tk]; out.freqText = tk; continue; }
      if (/^\d/.test(tk) || /^(mg|mcg|g|ml|iu|units?|%)$/.test(tk)) continue;
      rest.push(tk);
    }
    out.name = rest.join(" ").trim() || null;
    // form from injection route default
    if (!out.form && out.route === "IV") out.form = "injection";
    return out;   // generic resolution + confidence scoring happens in Task 2 (resolveGeneric)
  }

  window.MEDLIST = { parseEntry: parseEntry };
})();
