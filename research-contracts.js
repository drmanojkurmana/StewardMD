/* StewardMD - ResearchMD locked contracts (window.SMD_RESEARCH_CONTRACTS).
 * ES5 IIFE. Dual export: module.exports and the browser global.
 * Study types, journeys, checklists, store kinds and step labels.
 * Also the item 0 stubs window.RMDIec.status and window.RMDCtri.registered.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var STUDY_TYPES = ["case-report", "case-series", "case-control", "cohort", "rct"];

  var JOURNEYS = {
    "case-report": ["casefile", "novelty", "iec", "pubconsent", "images", "manuscript", "checklist", "ready"],
    "case-series": ["casefile", "novelty", "iec", "pubconsent", "images", "masterchart", "manuscript", "checklist", "ready"],
    "case-control": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "cohort": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "rct": ["plan", "protocol", "iec", "ctri", "randomise", "masterchart", "manuscript", "checklist", "ready"]
  };

  var CHECKLISTS = {
    "case-report": { protocol: "none", publication: "care", note: "SCARE for surgical case reports" },
    "case-series": { protocol: "none", publication: "care", note: "PROCESS 2025 for surgical case series" },
    "case-control": { protocol: "none", publication: "strobe" },
    "cohort": { protocol: "none", publication: "strobe" },
    "rct": { protocol: "spirit", publication: "consort" }
  };

  var STORE_KINDS = [
    "casefile", "masterchart", "image", "randomlist", "randomfingerprint", "consort",
    "iec", "ctri", "blinding", "samplesize", "draftmeta", "pubconsent"
  ];

  var STEP_LABELS = {
    plan: "Plan",
    protocol: "Protocol",
    masterchart: "Master chart",
    manuscript: "Manuscript",
    checklist: "Checklist",
    ready: "Submit",
    casefile: "Case file",
    novelty: "Novelty",
    iec: "Ethics committee",
    pubconsent: "Consent for publication",
    images: "Images",
    ctri: "CTRI",
    randomise: "Randomise",
    consort: "CONSORT flow",
    backup: "Backup",
    studies: "Studies",
    search: "Search",
    screening: "Screening",
    conflicts: "Conflicts",
    prisma: "PRISMA",
    pdf: "PDF",
    extract: "Extract",
    rob: "Risk of bias",
    data: "Data",
    run: "Run",
    grade: "GRADE",
    thesis: "Thesis",
    "thesis-type": "Paper type",
    "thesis-journal": "Journal",
    "thesis-draft": "Draft",
    "thesis-tables": "Tables",
    "thesis-refs": "References"
  };

  var CONTRACTS = {
    STUDY_TYPES: STUDY_TYPES,
    JOURNEYS: JOURNEYS,
    CHECKLISTS: CHECKLISTS,
    STORE_KINDS: STORE_KINDS,
    STEP_LABELS: STEP_LABELS
  };

  function iecStatus() {
    return Promise.resolve("none");
  }

  function ctriRegistered() {
    return Promise.resolve(false);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CONTRACTS;
  }
  if (G) {
    G.SMD_RESEARCH_CONTRACTS = CONTRACTS;
    G.RMDIec = { status: iecStatus };
    G.RMDCtri = { registered: ctriRegistered };
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
