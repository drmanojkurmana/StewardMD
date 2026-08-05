// sknx-engines.js — SknX dual-engine result logic + malignancy/red-flag referral guardrail.
(function () {
  "use strict";
  // Cutaneous malignancies (and other refer-mandatory neoplasms) that MUST route to "refer, do not
  // prescribe". Broadened beyond the big three (melanoma/BCC/SCC) after a real-image test surfaced a
  // classifier emitting "Mycosis Fungoides" (a cutaneous lymphoma / cancer) that the old set let
  // through. Purely false-negative-averse: adding an entry can only ADD referrals, never remove one.
  // Matching is EXACT-KEY (see MALIGNANT_SYNONYMS + normalizeMalignantLabel), so a benign look-alike
  // (e.g. "dermatofibroma") can never be mis-hit by a malignant key (e.g. "dermatofibrosarcoma
  // protuberans"). R1 CLINICAL REVIEW GATE: this list is the guardrail's ground truth - review before
  // any real deployment; err toward inclusion.
  var MALIGNANT = ["melanoma", "BCC", "SCC", "Merkel cell carcinoma", "cutaneous lymphoma", "Kaposi sarcoma", "cutaneous sarcoma", "sebaceous carcinoma", "adnexal carcinoma", "cutaneous Paget disease", "cutaneous metastasis"];
  var REFER_THRESHOLD = 0.15; // false-negative-averse: refer on even a low malignancy signal
  // Drug-reaction patterns that can be early SJS/TEN/DRESS (a dermatologic emergency). Exact-key (lower).
  // Used for a SEVERE-REACTION caution, not a hard referral - most drug rashes are benign.
  var SCAR_RISK = { "drug rash": 1, "erythema multiforme": 1 };
  // Synonym/case map -> canonical MALIGNANT entry. A real classifier may emit "Melanoma", "bcc",
  // "basal cell carcinoma", "Mycosis Fungoides", "MCC", etc.; normalize before matching so the referral
  // guardrail below can't be slipped past by casing/label-text drift. Add a label variant here (never
  // a substring rule) whenever a classifier's class name maps to a refer-mandatory malignancy.
  var MALIGNANT_SYNONYMS = {
    // melanoma (+ subtypes; exact-key, so every variant string a classifier may emit is enumerated.
    // NOTE: bare "lentigo"/"solar lentigo" are benign and deliberately NOT here; "lentigo maligna" is
    // melanoma in situ and IS.)
    "melanoma": "melanoma",
    "mel": "melanoma",
    "malignant melanoma": "melanoma",
    "melanoma, nos": "melanoma",
    "melanoma invasive": "melanoma",
    "melanoma in situ": "melanoma",
    "melanoma metastasis": "melanoma",
    "metastatic melanoma": "melanoma",
    "amelanotic melanoma": "melanoma",
    "nodular melanoma": "melanoma",
    "acral lentiginous melanoma": "melanoma",
    "superficial spreading melanoma": "melanoma",
    "desmoplastic melanoma": "melanoma",
    "lentigo maligna": "melanoma",
    "lentigo maligna melanoma": "melanoma",
    // basal cell carcinoma
    "bcc": "BCC",
    "basal cell carcinoma": "BCC",
    "basal cell carcinoma, nos": "BCC",
    // squamous cell carcinoma (incl. Bowen disease / SCC in situ; keratoacanthoma = well-differentiated
    // SCC variant, refer to exclude - a clinical judgment call, kept in on the false-negative-averse side)
    "scc": "SCC",
    "squamous cell carcinoma": "SCC",
    "cutaneous squamous cell carcinoma": "SCC",
    "invasive squamous cell carcinoma": "SCC",
    "squamous cell carcinoma, nos": "SCC",
    "squamous cell carcinoma in situ": "SCC",
    "squamous cell carcinoma in situ, bowen disease": "SCC",
    "bowen disease": "SCC",
    "bowen's disease": "SCC",
    "verrucous carcinoma": "SCC",
    "keratoacanthoma": "SCC",
    // Merkel cell carcinoma
    "merkel cell carcinoma": "Merkel cell carcinoma",
    "merkel cell": "Merkel cell carcinoma",
    "mcc": "Merkel cell carcinoma",
    // cutaneous lymphoma (CTCL/CBCL, mycosis fungoides, Sezary)
    "cutaneous lymphoma": "cutaneous lymphoma",
    "primary cutaneous lymphoma": "cutaneous lymphoma",
    "cutaneous t-cell lymphoma": "cutaneous lymphoma",
    "cutaneous b-cell lymphoma": "cutaneous lymphoma",
    "ctcl": "cutaneous lymphoma",
    "cbcl": "cutaneous lymphoma",
    "mycosis fungoides": "cutaneous lymphoma",
    "sezary syndrome": "cutaneous lymphoma",
    "sézary syndrome": "cutaneous lymphoma",
    // Kaposi sarcoma
    "kaposi sarcoma": "Kaposi sarcoma",
    "kaposi's sarcoma": "Kaposi sarcoma",
    "kaposi": "Kaposi sarcoma",
    // other cutaneous sarcomas / atypical fibroxanthoma (DFSP is intermediate-grade but still refer)
    "cutaneous sarcoma": "cutaneous sarcoma",
    "angiosarcoma": "cutaneous sarcoma",
    "cutaneous angiosarcoma": "cutaneous sarcoma",
    "dermatofibrosarcoma protuberans": "cutaneous sarcoma",
    "dfsp": "cutaneous sarcoma",
    "atypical fibroxanthoma": "cutaneous sarcoma",
    "afx": "cutaneous sarcoma",
    // sebaceous carcinoma (NOT sebaceous hyperplasia/adenoma/nevus, which are benign and absent here)
    "sebaceous carcinoma": "sebaceous carcinoma",
    // cutaneous adnexal carcinomas
    "adnexal carcinoma": "adnexal carcinoma",
    "cutaneous adnexal carcinoma": "adnexal carcinoma",
    "microcystic adnexal carcinoma": "adnexal carcinoma",
    "porocarcinoma": "adnexal carcinoma",
    "hidradenocarcinoma": "adnexal carcinoma",
    "trichilemmal carcinoma": "adnexal carcinoma",
    // cutaneous Paget disease (extramammary + mammary; an intraepithelial adenocarcinoma)
    "cutaneous paget disease": "cutaneous Paget disease",
    "extramammary paget disease": "cutaneous Paget disease",
    "extramammary paget's disease": "cutaneous Paget disease",
    "mammary paget disease": "cutaneous Paget disease",
    "paget disease of the nipple": "cutaneous Paget disease",
    // cutaneous metastasis
    "cutaneous metastasis": "cutaneous metastasis",
    "skin metastasis": "cutaneous metastasis",
    "cutaneous metastases": "cutaneous metastasis"
  };
  function normalizeMalignantLabel(label) {
    var k = String(label == null ? "" : label).toLowerCase().trim();
    return MALIGNANT_SYNONYMS[k] || null;
  }
  function band(p) { return p >= 0.66 ? "high" : p >= 0.33 ? "moderate" : "low"; }
  function rank(arr) { return (arr || []).slice().sort(function (a, b) { return b.prob - a.prob; }).map(function (x) { return { label: x.label, prob: x.prob, band: band(x.prob) }; }); }
  function redFlag(f) {
    if (!f) return false;
    var abcde = (f.asymmetry ? 1 : 0) + (f.borderIrregular ? 1 : 0) + (f.colorVariegation ? 1 : 0) + ((f.diameterMm || 0) >= 6 ? 1 : 0) + (f.evolving ? 1 : 0);
    return abcde >= 2 || !!f.bleeding || !!f.ulceration || !!f.rapidGrowth || !!f.systemicSymptoms;
  }
  // H7 (R1 clinical): the deployed differential model has NO melanoma class, so a melanoma can be read
  // as a benign pigmented/melanocytic lesion (nevus, lentigo, seborrheic keratosis) with no ABCDE ticked
  // and no OOD - which would otherwise pass as benign + Rx-eligible. For ANY pigmented/melanocytic TOP
  // differential we cannot exclude melanoma: surface a point-of-decision caveat and force rxEligible=false
  // (never prescribe onto a possible melanoma). Substring match keeps it robust to label-string variants.
  // Includes non-pigmented melanoma MIMICS (dermatofibroma, vascular lesion) that a nodular/amelanotic
  // melanoma can be read as (R1 re-review). The always-on educational disclaimer additionally states the
  // tool cannot detect melanoma on EVERY read - the deployed differential taxonomy has no melanocytic class,
  // so a melanoma read as an inflammatory label would otherwise carry no lesion-specific caveat here.
  var PIGMENTED_KEYWORDS = ["nevus", "naevus", "melanocytic", "melanoma", "mole", "lentigo", "lentigin", "pigment", "seborrheic keratosis", "seborrhoeic keratosis", "benign keratosis", "freckle", "ephelis", "cafe au lait", "café", "dermatofibroma", "vascular lesion"];
  function isPigmentedMelanocytic(label) {
    var k = String(label == null ? "" : label).toLowerCase();
    for (var i = 0; i < PIGMENTED_KEYWORDS.length; i++) { if (k.indexOf(PIGMENTED_KEYWORDS[i]) !== -1) return true; }
    return false;
  }
  function makeAnalysis(raw, entitlement) {
    raw = raw || {};
    var differential = rank(raw.generalProbs);
    var lesion = null, referral = false, reason = null;
    // SAFETY GUARDRAIL - runs at EVERY tier. The malignancy referral must NOT be entitlement-gated:
    // a vision engine selectable at v1 (e.g. the cloud classifier, whose available() is tier-independent)
    // can emit a named carcinoma in lesionProbs, and a tier gate here would let it pass as benign+Rx-
    // eligible (R1 finding C1). False-negative-averse: refer on any malignant signal >= threshold.
    var malig = (raw.lesionProbs || []).filter(function (x) { return !!normalizeMalignantLabel(x.label); }).sort(function (a, b) { return b.prob - a.prob; })[0];
    if (malig && malig.prob >= REFER_THRESHOLD) { referral = true; reason = "Possible " + malig.label + " - specialist referral, do not prescribe."; }
    // The lesion DISPLAY object (top lesion class + confidence band surfaced in the UI) stays a v2beta
    // surfacing - a paid feature, not a safety mechanism.
    if (entitlement === "v2beta") {
      var lr = rank(raw.lesionProbs)[0] || null;
      if (lr) { lesion = { top: lr.label, prob: lr.prob, band: lr.band }; }
    }
    if (redFlag(raw.features)) { referral = true; reason = reason || "Red-flag features (ABCDE / bleeding / ulceration) - specialist referral, do not prescribe."; }
    // SEVERE CUTANEOUS ADVERSE REACTION caution (R1 finding I1): a prominent drug-reaction pattern may be
    // early SJS/TEN/DRESS - a dermatologic emergency. Surface a caution (not a hard referral: most drug
    // rashes are benign) prompting the clinician to check for the danger features. Fires when a SCAR-risk
    // condition is the top differential or scores high.
    var caution = null;
    var scar = (differential || []).filter(function (x) { return !!SCAR_RISK[String(x.label == null ? "" : x.label).toLowerCase().trim()] && (x === differential[0] || x.prob >= 0.5); })[0];
    if (scar) { caution = "Possible " + scar.label + " - if mucosal involvement, skin pain, blistering, target lesions, or systemic symptoms, treat as a possible severe reaction (SJS / TEN / DRESS) and refer urgently."; }
    // H7: pigmented/melanocytic TOP differential -> melanoma cannot be excluded (see isPigmentedMelanocytic).
    // Force rxEligible=false and surface the melanoma caveat (as the caution when nothing more urgent has
    // already claimed it, so the referral > OOD > caution banner still shows the strongest finding).
    var pigmented = !!(differential && differential[0] && isPigmentedMelanocytic(differential[0].label));
    var melanomaCaveat = pigmented
      ? "Cannot exclude melanoma. This tool does not detect melanoma, and any pigmented, nodular, or changing lesion needs clinical judgement. Do not prescribe; use dermoscopy or refer if the lesion is new, changing, irregular, or otherwise concerning."
      : null;
    if (pigmented && !caution) caution = melanomaCaveat;
    // OOD / low-confidence (vision engine withheld a differential): never Rx-eligible, and surfaced as a
    // distinct "no confident reading" state - not a benign result (AI-safety C1).
    var ood = !!raw.ood;
    return {
      differential: differential,
      lesion: lesion,
      referral: referral,
      referralReason: reason,
      caution: caution,
      melanomaCaveat: melanomaCaveat,
      ood: ood,
      oodReason: ood ? (raw.oodReason || null) : null,
      rxEligible: !referral && !ood && !pigmented,
      disclaimerKey: "educational_not_clinical"
    };
  }
  var API = { makeAnalysis: makeAnalysis, MALIGNANT: MALIGNANT, REFER_THRESHOLD: REFER_THRESHOLD };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_SKNX_ENGINES = API;
})();
