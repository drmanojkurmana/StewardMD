// functions/_connect/maik/patient-brief.js — Part 4 CAPSTONE: Unified Clinical Context Engine (MaiK patient brief).
//
// The SINGLE entry point that composes the four Part-4 modules into the one "patient brief" MaiK receives when a
// doctor opens a patient. It calls, IN ORDER:
//   1. assembleClinicalContext(bundle, opts)            -> the structured clinical context           (context)
//   2. deriveClinicalAlerts(context, opts).alerts       -> deterministic safety FLAGS                (alerts)
//   3. suggestRelevantModules(context, alerts, opts)    -> relevant-module suggestions               (suggestedModules)
//   4. buildClinicalTimeline(bundle, opts)              -> chronological patient history             (timeline)
// and then folds their outputs into a deterministic, COUNT-AND-FACT-ONLY `brief` summary object.
//
// DETERMINISTIC, PURE, NO SIDE EFFECTS, NO LLM, NO NETWORK, NO WALL CLOCK, NO RANDOMNESS. This is a THIN
// composition layer: it does NOT reimplement any sub-module's logic and it does NOT modify them. It only
// ASSEMBLES + SUMMARIZES what the four modules produced.
//
// CRITICAL SAFETY BOUNDARY (identical to the rest of Part 4 / FollowCare): the composition adds NOTHING that
// decides, diagnoses, recommends, or fabricates. Every STRING the brief emits is copied VERBATIM from a
// sub-module output (the assembler's counts-only summary, an alert's own message, a module id, or a verbatim
// timeline date). Every NUMBER is a faithful count/derivation of a sub-result length (the same class of value the
// sub-modules already emit). The surface-not-decide, no-directive, no-fabrication guards the four modules enforce
// are PRESERVED because this layer re-surfaces their output and authors no new clinical prose of its own.
//
// Missing/empty/partial/hostile input must NOT throw: each sub-call already fail-safes, and the composition is
// additionally wrapped so a catastrophic failure still returns a safe, empty brief. Bounded: the sub-modules are
// already bounded (their own caps + opts), and this layer adds only O(alerts + suggestions) counting work.

import { assembleClinicalContext } from "./clinical-context.js";
import { deriveClinicalAlerts } from "./clinical-alerts.js";
import { suggestRelevantModules } from "./module-orchestrator.js";
import { buildClinicalTimeline } from "./clinical-timeline.js";

const DEFAULT_MAX_TOP_ALERTS = 5; // how many alert messages the brief surfaces up top (bounded, opts-overridable)

const asArray = (x) => (Array.isArray(x) ? x : []);

// The empty clinical-context shape (mirrors assembleClinicalContext's safe-empty return) — used only if the
// assembler itself somehow returns a non-object, so downstream reads never touch undefined.
function emptyContext() {
  return { patient: null, activeProblems: [], currentMedications: [], allergies: [], recentAbnormalLabs: [], recentEncounters: [], keyProcedures: [], diagnosticReports: [], summary: "" };
}
function emptyTimeline() { return { events: [], undated: [], counts: {} }; }

// The safe, fully-empty result — returned only on a catastrophic composition failure (defense in depth; each
// sub-call already fail-safes on its own).
function emptyResult() {
  const context = emptyContext();
  return {
    patient: null,
    context,
    alerts: [],
    suggestedModules: [],
    timeline: emptyTimeline(),
    brief: {
      headline: context.summary,
      alertCount: 0,
      criticalAlertCount: 0,
      topAlerts: [],
      suggestedModuleIds: [],
      problemCount: 0,
      medicationCount: 0,
      allergyCount: 0,
      abnormalLabCount: 0,
      timelineEventCount: 0,
      timelineSpan: {},
    },
  };
}

// Attach a span endpoint only when the timeline actually carries a dated event at that end — never invent a date.
// The timeline engine sorts events date-DESCENDING (most recent first), so events[0] is the latest dated event
// and the last element is the earliest. Both `date` values are VERBATIM strings copied from the record.
function timelineSpan(events) {
  const span = {};
  if (events.length) {
    const latest = events[0] && events[0].date;
    const earliest = events[events.length - 1] && events[events.length - 1].date;
    if (latest != null) span.latest = latest;
    if (earliest != null) span.earliest = earliest;
  }
  return span;
}

// ---- public API --------------------------------------------------------------------------------------------

// buildMaikPatientBrief(sccmBundle, opts) -> { patient, context, alerts, suggestedModules, timeline, brief }
// opts is threaded UNCHANGED into each sub-module, so every sub-cap the modules already honor applies here:
//   context:   asOf, maxLabs, maxEncounters, maxProcedures, maxReports
//   alerts:    maxPerKind, polypharmacyThreshold
//   modules:   maxSuggestions, maxEvidence, thinSignalMax
//   timeline:  maxEvents
// plus this layer's own: maxTopAlerts (how many alert messages the brief surfaces; default 5).
export function buildMaikPatientBrief(sccmBundle, opts = {}) {
  try {
    const o = opts && typeof opts === "object" ? opts : {};
    const maxTopAlerts = Number.isInteger(o.maxTopAlerts) && o.maxTopAlerts >= 0 ? o.maxTopAlerts : DEFAULT_MAX_TOP_ALERTS;

    // 1..4 — call the four pure modules in order, threading opts through. Each already fail-safes internally.
    const context = (() => { const c = assembleClinicalContext(sccmBundle, o); return c && typeof c === "object" ? c : emptyContext(); })();
    const alerts = asArray(deriveClinicalAlerts(context, o).alerts);
    const suggestedModules = asArray(suggestRelevantModules(context, alerts, o).suggestions);
    const timeline = (() => { const t = buildClinicalTimeline(sccmBundle, o); return t && typeof t === "object" ? t : emptyTimeline(); })();

    const events = asArray(timeline.events);
    const problems = asArray(context.activeProblems);
    const meds = asArray(context.currentMedications);
    const allergies = asArray(context.allergies);
    const labs = asArray(context.recentAbnormalLabs);

    // brief — a deterministic, COUNT-AND-FACT-ONLY summary. Numbers are faithful counts of sub-results; strings
    // (headline, topAlerts, suggestedModuleIds, span dates) are copied VERBATIM from a sub-module output. This
    // layer authors NO clinical prose: it decides/diagnoses/recommends nothing.
    const brief = {
      headline: typeof context.summary === "string" ? context.summary : "", // assembler's counts-only summary, verbatim
      alertCount: alerts.length,
      criticalAlertCount: alerts.reduce((n, a) => n + (a && a.severity === "critical" ? 1 : 0), 0),
      topAlerts: alerts.slice(0, maxTopAlerts).map((a) => (a && a.message != null ? a.message : "")), // verbatim alert messages
      suggestedModuleIds: suggestedModules.map((s) => (s && s.moduleId != null ? s.moduleId : null)).filter((x) => x != null),
      problemCount: problems.length,
      medicationCount: meds.length,
      allergyCount: allergies.length,
      abnormalLabCount: labs.length,
      timelineEventCount: events.length,
      timelineSpan: timelineSpan(events), // verbatim earliest/latest dated-event dates (omitted when none)
    };

    return { patient: context.patient != null ? context.patient : null, context, alerts, suggestedModules, timeline, brief };
  } catch {
    // Belt-and-suspenders: a catastrophic failure in the composition must never throw. Return the safe empty brief.
    return emptyResult();
  }
}
