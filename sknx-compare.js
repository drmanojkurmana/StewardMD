// sknx-compare.js — SknX AI · educational side-by-side "Compare Diseases" builder (SMD_SKNX_COMPARE).
//
// compare(labelA, labelB, deps) -> { rows, sources, a, b } — a small, deterministic, textbook-accurate
// feature matrix over a curated set of common dermatology conditions, plus grounded citations pulled
// from sknx-evidence.js (the vetted mock-RAG corpus; never invented). This is decision-SUPPORT
// educational content for a clinician audience — general/standard teaching points only, no doses, no
// prescribing language.
//
// html(cmp) -> string renders an inert `<table class="sknx-compare">` + a sources list, safe to drop
// into innerHTML (all text HTML-escaped, no inline event handlers).
//
// Dual export: `window.SMD_SKNX_COMPARE` in the browser, `module.exports` in Node (tests).
(function () {
  "use strict";

  // Resolve the evidence corpus's retrieve() in both Node and browser without a hard build-time
  // dependency — mirrors the require/window pattern used across the other sknx-*.js modules.
  var EVID = (typeof require !== "undefined") ? require("./sknx-evidence.js") : (typeof window !== "undefined" ? window.SMD_SKNX_EVIDENCE : null);

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // Scheme allowlist - only http(s) citation URLs become clickable (esc neutralizes HTML, not a
  // javascript:/data: href); anything else renders as inert text.
  function safeHref(u) { var s = String(u == null ? "" : u); return /^https?:\/\//i.test(s) ? s : ""; }

  function normLabel(l) { return String(l == null ? "" : l).toLowerCase().trim(); }

  // Synonym / alias map -> canonical CONDITIONS key.
  var SYNONYMS = {
    "basal cell carcinoma": "bcc",
    "squamous cell carcinoma": "scc",
    "tinea corporis": "tinea",
    "ringworm": "tinea",
    "atopic dermatitis": "eczema",
    "mole": "nevus",
    "melanocytic nevus": "nevus",
    "melanocytic naevus": "nevus",
    "naevus": "nevus"
  };

  function canonicalLabel(l) {
    var n = normLabel(l);
    return SYNONYMS.hasOwnProperty(n) ? SYNONYMS[n] : n;
  }

  // ── Curated, standard/textbook educational feature matrix. Same feature keys across every
  // condition so comparison rows always align. General teaching points only — no doses, no
  // prescribing guidance (this module renders education content, not treatment). ──
  var FEATURE_KEYS = ["morphology", "distribution", "surfaceScale", "keyDifferentiator", "onsetEvolution", "itchPain"];
  var FEATURE_LABELS = {
    morphology: "Morphology",
    distribution: "Distribution",
    surfaceScale: "Surface / scale",
    keyDifferentiator: "Key differentiator",
    onsetEvolution: "Onset / evolution",
    itchPain: "Itch / pain"
  };

  var CONDITIONS = {
    psoriasis: {
      morphology: "Well demarcated erythematous plaques",
      distribution: "Extensor surfaces, scalp, sacrum",
      surfaceScale: "Thick silvery scale",
      keyDifferentiator: "Auspitz sign; symmetrical extensor plaques",
      onsetEvolution: "Chronic, relapsing",
      itchPain: "Variable itch"
    },
    tinea: {
      morphology: "Annular plaque with central clearing",
      distribution: "Any site; often trunk/limbs",
      surfaceScale: "Fine scale at the advancing edge",
      keyDifferentiator: "Active scaly border with central clearing; KOH positive",
      onsetEvolution: "Gradual centrifugal spread",
      itchPain: "Itchy"
    },
    eczema: {
      morphology: "Poorly demarcated erythematous patches, may weep or lichenify",
      distribution: "Flexural areas (antecubital/popliteal fossae); face in infants",
      surfaceScale: "Fine scale; excoriation and lichenification with chronic scratching",
      keyDifferentiator: "Personal/family history of atopy; flexural pattern",
      onsetEvolution: "Chronic, relapsing with flares",
      itchPain: "Intensely itchy"
    },
    melanoma: {
      morphology: "Irregularly pigmented macule or plaque, may ulcerate",
      distribution: "Any site; sun-exposed skin, also nails/palms/soles/mucosa",
      surfaceScale: "Usually no scale; surface may be irregular or ulcerated",
      keyDifferentiator: "ABCDE criteria (Asymmetry, Border irregularity, Color variegation, Diameter over 6mm, Evolution)",
      onsetEvolution: "Progressive change in size/shape/color over weeks to months",
      itchPain: "Usually asymptomatic; occasional itch, bleeding, or tenderness"
    },
    nevus: {
      morphology: "Symmetric, uniformly pigmented macule or papule",
      distribution: "Any site; typically sun-exposed skin",
      surfaceScale: "Smooth surface, no scale",
      keyDifferentiator: "Stable in size, shape, and color over time",
      onsetEvolution: "Stable for years; new change should prompt re-evaluation",
      itchPain: "Asymptomatic"
    },
    bcc: {
      morphology: "Pearly papule or nodule with telangiectasia; may ulcerate centrally",
      distribution: "Sun-exposed skin, especially head and neck",
      surfaceScale: "Smooth, waxy surface; rolled border; central ulceration in some",
      keyDifferentiator: "Pearly rolled border with telangiectasia; rarely metastasizes",
      onsetEvolution: "Slow growing over months to years",
      itchPain: "Usually asymptomatic; may bleed or crust"
    },
    scc: {
      morphology: "Scaly, hyperkeratotic papule or plaque; may ulcerate",
      distribution: "Sun-exposed skin; lip, ear, hands",
      surfaceScale: "Rough, scaly, or crusted surface; may be indurated",
      keyDifferentiator: "Firm, indurated, scaly/ulcerated lesion; potential for local invasion and metastasis if untreated",
      onsetEvolution: "Progressive growth over weeks to months, faster than BCC",
      itchPain: "May be tender; can ulcerate or bleed"
    },
    rosacea: {
      morphology: "Facial erythema with papules and pustules; telangiectasia",
      distribution: "Central face - cheeks, nose, chin, forehead",
      surfaceScale: "No comedones; skin may appear flushed rather than scaly",
      keyDifferentiator: "Flushing/blushing trigger history; absence of comedones distinguishes from acne",
      onsetEvolution: "Chronic, episodic flushing progressing to persistent erythema",
      itchPain: "Burning or stinging more common than itch"
    },
    acne: {
      morphology: "Comedones, papules, pustules, and in severe disease nodules/cysts",
      distribution: "Face, chest, and back (sebaceous-gland-rich areas)",
      surfaceScale: "No diffuse scale; follicular plugging (comedones) is characteristic",
      keyDifferentiator: "Presence of comedones (open/closed); onset around puberty",
      onsetEvolution: "Onset in adolescence; may persist or recur into adulthood",
      itchPain: "Usually minimal itch; inflamed lesions may be tender"
    }
  };

  function humanLabel(canonical) {
    if (!canonical) return "";
    return canonical.charAt(0).toUpperCase() + canonical.slice(1);
  }

  function buildRows(condA, condB) {
    var rows = [];
    for (var i = 0; i < FEATURE_KEYS.length; i++) {
      var key = FEATURE_KEYS[i];
      var aVal = (condA && condA[key]) ? condA[key] : null;
      var bVal = (condB && condB[key]) ? condB[key] : null;
      if (aVal == null && bVal == null) continue;
      rows.push({ feature: FEATURE_LABELS[key], a: aVal || "-", b: bVal || "-" });
    }
    if (!rows.length) {
      // Neither condition is in the curated matrix — still return a non-empty generic skeleton so the
      // UI never breaks on an unrecognized pair.
      for (var j = 0; j < FEATURE_KEYS.length; j++) {
        rows.push({ feature: FEATURE_LABELS[FEATURE_KEYS[j]], a: "-", b: "-" });
      }
    }
    return rows;
  }

  function sourcesFor(retrieveFn, canonicalA, canonicalB) {
    var raw = [];
    if (typeof retrieveFn === "function") {
      raw = raw.concat(retrieveFn([canonicalA]) || []).concat(retrieveFn([canonicalB]) || []);
    }
    var seen = {}, out = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      if (!r || !r.url || seen[r.url]) continue;
      seen[r.url] = 1;
      out.push({ source: r.source, title: r.title, url: r.url });
    }
    return out;
  }

  function compare(labelA, labelB, deps) {
    deps = deps || {};
    var retrieveFn = typeof deps.retrieve === "function" ? deps.retrieve : (EVID && EVID.retrieve);

    var rawA = normLabel(labelA);
    var rawB = normLabel(labelB);
    var canonicalA = canonicalLabel(labelA);
    var canonicalB = canonicalLabel(labelB);

    var condA = CONDITIONS.hasOwnProperty(canonicalA) ? CONDITIONS[canonicalA] : null;
    var condB = CONDITIONS.hasOwnProperty(canonicalB) ? CONDITIONS[canonicalB] : null;

    var rows = buildRows(condA, condB);
    var sources = sourcesFor(retrieveFn, canonicalA, canonicalB);

    return { rows: rows, sources: sources, a: rawA, b: rawB };
  }

  function tableHtml(cmp) {
    var labelA = humanLabel(canonicalLabel(cmp.a));
    var labelB = humanLabel(canonicalLabel(cmp.b));
    var rowsHtml = cmp.rows.map(function (r) {
      return "<tr><td>" + esc(r.feature) + "</td><td>" + esc(r.a) + "</td><td>" + esc(r.b) + "</td></tr>";
    }).join("");
    return '<table class="sknx-compare">' +
      "<thead><tr><th>Feature</th><th>" + esc(labelA) + "</th><th>" + esc(labelB) + "</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody>" +
      "</table>";
  }

  function sourcesHtml(sources) {
    if (!sources || !sources.length) return "";
    var items = sources.map(function (s) {
      var url = safeHref(s.url), label = esc(s.title) + " (" + esc(s.source) + ")";
      var inner = url ? ('<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>") : ('<span>' + label + "</span>");
      return "<li>" + inner + "</li>";
    }).join("");
    return '<ul class="sknx-compare-sources">' + items + "</ul>";
  }

  function html(cmp) {
    cmp = cmp || { rows: [], sources: [], a: "", b: "" };
    var note = '<p class="sknx-compare-note">Educational comparison only, not a diagnosis.</p>';
    return '<div class="sknx-compare-wrap">' + tableHtml(cmp) + sourcesHtml(cmp.sources) + note + "</div>";
  }

  var API = {
    compare: compare,
    html: html,
    CONDITIONS: CONDITIONS,
    FEATURE_KEYS: FEATURE_KEYS,
    FEATURE_LABELS: FEATURE_LABELS
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_COMPARE = API;
})();
