/* StewardMD - ResearchMD locked contracts (window.SMD_RESEARCH_CONTRACTS).
 * ES5 only, pure (no DOM, no I/O). Dual export: browser global and CommonJS.
 * The single source for study type keys, journeys, checklist keys, storage
 * kinds and the plain edge-case messages. docs/research/contracts.md is the
 * prose copy. A change here needs the plan owner's approval.
 */
(function (G) {
  "use strict";

  var TYPES = ["case-report", "case-series", "case-control", "cohort", "rct"];

  /* Journeys. Existing step keys keep their names; new keys: casefile,
   * novelty, iec, pubconsent, images, ctri, randomise. */
  var JOURNEYS = {
    "case-report": ["casefile", "novelty", "iec", "pubconsent", "images", "manuscript", "checklist", "ready"],
    "case-series": ["casefile", "novelty", "iec", "pubconsent", "images", "masterchart", "manuscript", "checklist", "ready"],
    "case-control": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "cohort": ["plan", "protocol", "iec", "masterchart", "manuscript", "checklist", "ready"],
    "rct": ["plan", "protocol", "iec", "ctri", "randomise", "masterchart", "checklist", "manuscript", "ready"]
  };

  /* Checklist ids as served by /v1/checklists (functions/api/research/_checklists.js).
   * strobe is one combined file; consort is the 2010 file until item 9 lands. */
  var CHECKLISTS = {
    "case-report": { protocol: "", publication: "care", note: "For a surgical case report, many journals ask for SCARE. Check the journal's instructions." },
    "case-series": { protocol: "", publication: "care", note: "For a surgical case series, many journals ask for PROCESS 2025. Check the journal's instructions." },
    "case-control": { protocol: "strobe", publication: "strobe", note: "Use the case-control items of STROBE." },
    "cohort": { protocol: "strobe", publication: "strobe", note: "Use the cohort items of STROBE." },
    "rct": { protocol: "spirit", publication: "consort", note: "" }
  };

  var KINDS = ["casefile", "masterchart", "image", "randomlist", "randomfingerprint", "consort",
    "iec", "ctri", "blinding", "samplesize", "draftmeta"];

  var NEXT_LINES = {
    casefile: "fill in the case file (no name or hospital number).",
    novelty: "check whether this case has been published before.",
    iec: "record your ethics committee approval or waiver.",
    pubconsent: "get consent for publication signed.",
    images: "hide names, dates and faces on your images.",
    ctri: "register the trial on CTRI before the first patient.",
    randomise: "make the allocation list (list keeper only)."
  };

  var MESSAGES = {
    noEventsGroup: "No one in group {g} had the event, so median survival is not reached.",
    noEvents: "No events yet, so the groups cannot be compared.",
    smallGroup: "Group {g} has only {n} patients; treat these numbers as unreliable.",
    excluded: "{n} rows were left out because the time or event value was missing or invalid.",
    coxNotConverged: "The model did not settle on an answer. Do not report a hazard ratio; ask your statistician.",
    coxSeparation: "One group had no events (or only events), so its hazard ratio cannot be estimated.",
    coxEpv: "Too few events for this many factors; use fewer factors.",
    coxPh: "Hazard ratios assume the effect stays the same over time. If the survival curves cross, ask your statistician before reporting.",
    matchedNoDiscordant: "No pairs differ in exposure, so the matched odds ratio cannot be calculated.",
    matchedInfinite: "The odds ratio is very large; report only the lower limit.",
    matchedFew: "Very few pairs differ; the interval is wide.",
    caseControlBad: "The odds ratio must differ from 1 and exposure must be between 0% and 100%.",
    hrOne: "A hazard ratio of 1 means no difference; choose the smallest difference that matters.",
    blockRatio: "Block size {b} cannot split {r}; use {ok}.",
    describeSmall: "With so few patients, each value is listed instead of an average."
  };

  /* Map a project's free-text studyType onto a type key. case-control and
   * case-series are tested before case-report; the bare word "case" never matches. */
  function typeKey(studyType) {
    var t = String(studyType || "").toLowerCase();
    if (/systematic|meta-analysis|meta analysis|thesis|master ?chart/.test(t)) return "";
    if (/case[\s-]*control/.test(t)) return "case-control";
    if (/case[\s-]*series/.test(t)) return "case-series";
    if (/case[\s-]*report/.test(t)) return "case-report";
    if (/randomi[sz]ed|\brct\b|clinical trial|\btrial\b/.test(t)) return "rct";
    if (/cohort/.test(t) && t.indexOf("synthesis") < 0) return "cohort";
    return "";
  }

  function journey(type) { return JOURNEYS[type] ? JOURNEYS[type].slice() : null; }

  function checklistFor(type, stage) {
    var c = CHECKLISTS[type];
    if (!c) return null;
    return stage === "protocol" ? c.protocol : c.publication;
  }

  function message(name, vars) {
    var s = MESSAGES[name] || "";
    if (vars) {
      for (var k in vars) {
        if (vars.hasOwnProperty(k)) s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }

  var C = {
    TYPES: TYPES.slice(),
    JOURNEYS: JOURNEYS,
    CHECKLISTS: CHECKLISTS,
    KINDS: KINDS.slice(),
    NEXT_LINES: NEXT_LINES,
    MESSAGES: MESSAGES,
    typeKey: typeKey,
    journey: journey,
    checklistFor: checklistFor,
    message: message
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = C; }
  if (G) { G.SMD_RESEARCH_CONTRACTS = C; }

})(typeof window !== "undefined" ? window : undefined);
