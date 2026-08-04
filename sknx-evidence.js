// sknx-evidence.js — SknX seeded dermatology evidence corpus + deterministic retrieval.
// Mock-first stand-in for a real Cloudflare Vectorize RAG index: the corpus below IS the
// source of truth, so citations returned here can never be hallucinated. Swap point for the
// real engine: replace retrieve() with a Vectorize query (embed labels -> nearest-neighbor
// search over an indexed guideline corpus) while keeping this exact return shape.
(function () {
  "use strict";

  var CORPUS = [
    { id: "psoriasis-aad-1", source: "AAD", title: "Psoriasis: Overview",
      snippet: "Psoriasis is a chronic immune-mediated skin condition marked by well-demarcated, erythematous, scaly plaques.",
      url: "https://www.aad.org/public/diseases/psoriasis",
      tags: ["psoriasis"] },
    { id: "psoriasis-nice-1", source: "NICE", title: "Psoriasis: assessment and management",
      snippet: "Psoriasis severity is commonly assessed using body surface area and impact on quality of life.",
      url: "https://www.nice.org.uk/guidance/cg153",
      tags: ["psoriasis"] },
    { id: "eczema-aad-1", source: "AAD", title: "Eczema Types: Atopic Dermatitis",
      snippet: "Atopic dermatitis typically presents with pruritic, poorly demarcated, eczematous patches in flexural areas.",
      url: "https://www.aad.org/public/diseases/eczema/types/atopic-dermatitis",
      tags: ["eczema", "atopic dermatitis"] },
    { id: "eczema-dermnet-1", source: "DermNet", title: "Atopic dermatitis",
      snippet: "Atopic dermatitis is a relapsing inflammatory skin disease often associated with a personal or family history of atopy.",
      url: "https://dermnetnz.org/topics/atopic-dermatitis",
      tags: ["eczema", "atopic dermatitis"] },
    { id: "contact-dermatitis-dermnet-1", source: "DermNet", title: "Contact dermatitis",
      snippet: "Contact dermatitis is an inflammatory skin reaction caused by direct exposure to an irritant or allergen.",
      url: "https://dermnetnz.org/topics/contact-dermatitis",
      tags: ["contact dermatitis", "eczema"] },
    { id: "acne-aad-1", source: "AAD", title: "Acne: Overview",
      snippet: "Acne vulgaris results from follicular hyperkeratinization, excess sebum, and Cutibacterium acnes colonization.",
      url: "https://www.aad.org/public/diseases/acne",
      tags: ["acne"] },
    { id: "acne-bad-1", source: "BAD", title: "Acne Patient Information Leaflet",
      snippet: "Acne severity ranges from comedonal to nodulocystic and guides the choice of topical versus systemic therapy.",
      url: "https://www.skinhealthinfo.org.uk/condition/acne/",
      tags: ["acne"] },
    { id: "tinea-dermnet-1", source: "DermNet", title: "Tinea corporis",
      snippet: "Tinea corporis is a superficial dermatophyte infection presenting as an annular, scaly plaque with central clearing.",
      url: "https://dermnetnz.org/topics/tinea-corporis",
      tags: ["tinea", "tinea corporis", "ringworm"] },
    { id: "tinea-who-1", source: "WHO", title: "Dermatophytosis (ringworm)",
      snippet: "Dermatophyte skin infections are among the most common fungal infections globally and are treated with topical or oral antifungals.",
      url: "https://www.who.int/health-topics/fungal-diseases",
      tags: ["tinea", "ringworm"] },
    { id: "urticaria-bad-1", source: "BAD", title: "Urticaria (Hives) Patient Information",
      snippet: "Urticaria presents as transient, pruritic, well-circumscribed wheals that individually resolve within 24 hours.",
      url: "https://www.skinhealthinfo.org.uk/condition/urticaria/",
      tags: ["urticaria", "hives"] },
    { id: "urticaria-dermnet-1", source: "DermNet", title: "Urticaria",
      snippet: "Chronic urticaria is defined as recurrent wheals occurring on most days for six weeks or longer.",
      url: "https://dermnetnz.org/topics/urticaria",
      tags: ["urticaria", "hives"] },
    { id: "impetigo-aad-1", source: "AAD", title: "Impetigo: Overview",
      snippet: "Impetigo is a superficial bacterial skin infection, most often caused by Staphylococcus aureus or Streptococcus pyogenes, presenting with honey-colored crusted lesions.",
      url: "https://www.aad.org/public/diseases/a-z/impetigo-overview",
      tags: ["impetigo"] },
    { id: "cellulitis-nice-1", source: "NICE", title: "Cellulitis and erysipelas",
      snippet: "Cellulitis presents as an acute, poorly demarcated, spreading area of erythema, warmth, and swelling, usually of the lower limb.",
      url: "https://www.nice.org.uk/guidance/ng141",
      tags: ["cellulitis"] },
    { id: "rosacea-aad-1", source: "AAD", title: "Rosacea: Overview",
      snippet: "Rosacea is a chronic inflammatory condition of the central face characterized by flushing, erythema, papules, and telangiectasia.",
      url: "https://www.aad.org/public/diseases/rosacea",
      tags: ["rosacea"] },
    { id: "melanoma-aad-1", source: "AAD", title: "Melanoma: Signs and Symptoms",
      snippet: "Melanoma detection relies on the ABCDE criteria - asymmetry, border irregularity, color variation, diameter over 6mm, and evolution.",
      url: "https://www.aad.org/public/diseases/skin-cancer/melanoma/signs",
      tags: ["melanoma"] },
    { id: "melanoma-who-1", source: "WHO", title: "Skin cancers - melanoma",
      snippet: "Melanoma is the most serious form of skin cancer and its incidence is strongly linked to ultraviolet radiation exposure.",
      url: "https://www.who.int/news-room/questions-and-answers/item/skin-cancers",
      tags: ["melanoma"] },
    { id: "bcc-aad-1", source: "AAD", title: "Basal Cell Carcinoma: Overview",
      snippet: "Basal cell carcinoma is the most common skin cancer and typically presents as a pearly papule with telangiectasia, often on sun-exposed skin.",
      url: "https://www.aad.org/public/diseases/skin-cancer/bcc",
      tags: ["bcc", "basal cell carcinoma"] },
    { id: "scc-aad-1", source: "AAD", title: "Squamous Cell Carcinoma: Overview",
      snippet: "Squamous cell carcinoma often presents as a scaly, hyperkeratotic papule or plaque that can ulcerate and, if untreated, may metastasize.",
      url: "https://www.aad.org/public/diseases/skin-cancer/squamous-cell-carcinoma",
      tags: ["scc", "squamous cell carcinoma"] },
    { id: "nevus-dermnet-1", source: "DermNet", title: "Melanocytic naevus",
      snippet: "A melanocytic naevus is a common benign proliferation of melanocytes that is typically stable in size, shape, and color over time.",
      url: "https://dermnetnz.org/topics/melanocytic-naevus",
      tags: ["nevus", "mole"] },
    { id: "actinic-keratosis-aad-1", source: "AAD", title: "Actinic Keratosis: Overview",
      snippet: "Actinic keratosis is a common precancerous lesion caused by chronic ultraviolet exposure, presenting as a rough, scaly patch on sun-exposed skin.",
      url: "https://www.aad.org/public/diseases/skin-cancer/actinic-keratosis",
      tags: ["actinic keratosis"] }
  ];

  function normLabel(l) { return String(l == null ? "" : l).toLowerCase().trim(); }

  function retrieve(labels, opts) {
    opts = opts || {};
    var limit = typeof opts.limit === "number" && opts.limit > 0 ? opts.limit : 6;
    var wanted = (labels || []).map(normLabel).filter(function (l) { return l.length > 0; });
    if (!wanted.length) return [];

    var scored = [];
    for (var i = 0; i < CORPUS.length; i++) {
      var entry = CORPUS[i];
      var entryTags = entry.tags.map(normLabel);
      var overlap = 0;
      for (var j = 0; j < wanted.length; j++) {
        if (entryTags.indexOf(wanted[j]) !== -1) overlap++;
      }
      if (overlap > 0) scored.push({ entry: entry, overlap: overlap, idx: i });
    }

    // Rank by overlap count descending; stable tie-break by original corpus order (id order).
    scored.sort(function (a, b) {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return a.idx - b.idx;
    });

    return scored.slice(0, limit).map(function (s) {
      var e = s.entry;
      return { id: e.id, source: e.source, title: e.title, snippet: e.snippet, url: e.url, tags: e.tags.slice() };
    });
  }

  var API = { CORPUS: CORPUS, retrieve: retrieve };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_EVIDENCE = API;
})();
