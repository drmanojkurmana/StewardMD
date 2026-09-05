/* wardsynq/wardsynq-incidents.js — the reports you never receive.
 *
 * An incident system's failure mode is not a bad severity matrix. It is silence. The reports that
 * matter most are the ones nobody files, and they go unfiled for reasons that are entirely rational
 * from the reporter's side: it takes twenty minutes, it names them, their manager reads it, and the
 * last colleague who reported something was disciplined. Every design choice here is aimed at that,
 * because a beautifully structured system that receives no near misses is worse than a paper box on
 * a wall that receives them.
 *
 *   1. A NEAR MISS IS THE POINT. It is the free lesson: the same system failure, without the patient
 *      harmed. A system that treats near misses as a lesser class of report, or makes them as
 *      laborious as a death, will collect none of them. They are reportable in a minimal form, and
 *      the report ledger reports the near-miss ratio prominently, because a unit reporting only harm
 *      is a unit that has stopped noticing.
 *   2. SEVERITY IS THE OUTCOME, NOT THE CULPABILITY. The two get fused constantly, and the fusion is
 *      what makes people hide things: the same drug error is "a near miss" or "a homicide" depending
 *      on luck the clinician did not control. They are separate axes here and the accountability
 *      axis is deliberately NOT computed from the severity axis.
 *   3. AN ANONYMOUS REPORT IS A FIRST-CLASS REPORT. Not a degraded one. It cannot be followed up
 *      with its author, and that is a real cost, and it is a smaller cost than the report not
 *      existing. What CANNOT be anonymous is the investigation's own conclusions.
 *   4. THE SYSTEM ANSWERS THE FIVE WHYS BADLY IF IT ANSWERS THEM AT ALL. "Human error" is a place to
 *      start an investigation, never a place to finish one, so an RCA whose root cause is a person
 *      is refused. So is a CAPA whose only action is to retrain, remind or re-educate, which is the
 *      most common and least effective action in patient safety and is chosen because it is cheap.
 *   5. AN OPEN CAPA WITH NO OWNER AND NO DATE IS A CLOSED INCIDENT WEARING A COSTUME.
 *
 * WHAT THIS DOES NOT DO. It does not judge culpability, does not identify individuals for sanction,
 * and produces no output intended to support disciplinary action. It records what happened and what
 * the system will change. If it were used to build a case against a reporter it would destroy the
 * reporting it depends on, and there is nothing in the code that can prevent that; the note is here
 * because that is the failure that kills an incident system.
 *
 * NOT MODELLED: statutory external reporting and its deadlines, mortality and morbidity meeting
 * workflow, coroner and medico-legal disclosure, and any national incident taxonomy.
 *
 * PROVENANCE: the SAC matrix shape is the standard severity-times-likelihood grid used across
 * healthcare. The specific bandings and response requirements attached to it are UNAPPROVED.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-incidents.test.mjs
 */

/** What actually happened to the patient. An OUTCOME axis. */
const SEVERITY = Object.freeze({
  NEAR_MISS: "near-miss",       // reached nobody: caught before it reached the patient
  NO_HARM: "no-harm",           // reached the patient, no detectable harm
  MINOR: "minor",
  MODERATE: "moderate",
  MAJOR: "major",
  CATASTROPHIC: "catastrophic", // death or permanent severe harm
});

const SEVERITY_RANK = Object.freeze({
  [SEVERITY.NEAR_MISS]: 0, [SEVERITY.NO_HARM]: 1, [SEVERITY.MINOR]: 2,
  [SEVERITY.MODERATE]: 3, [SEVERITY.MAJOR]: 4, [SEVERITY.CATASTROPHIC]: 5,
});

const LIKELIHOOD = Object.freeze({
  RARE: "rare", UNLIKELY: "unlikely", POSSIBLE: "possible", LIKELY: "likely", FREQUENT: "frequent",
});

const LIKELIHOOD_RANK = Object.freeze({
  [LIKELIHOOD.RARE]: 0, [LIKELIHOOD.UNLIKELY]: 1, [LIKELIHOOD.POSSIBLE]: 2,
  [LIKELIHOOD.LIKELY]: 3, [LIKELIHOOD.FREQUENT]: 4,
});

const STATE = Object.freeze({
  REPORTED: "reported",
  TRIAGED: "triaged",
  INVESTIGATING: "investigating",
  ACTIONS_OPEN: "actions-open",   // RCA accepted, CAPAs outstanding
  CLOSED: "closed",
});

/**
 * Actions that are almost never sufficient on their own.
 *
 * Retraining and reminding are the most-chosen and least-effective interventions in patient safety:
 * they place the entire burden of the fix on the next tired human to stand in the same place. They
 * are permitted here only alongside something that changes the system.
 */
const WEAK_ACTIONS = Object.freeze(["retrain", "re-train", "training", "educate", "education", "remind", "reminder", "awareness", "counsel", "counselling", "brief the team", "circulate", "policy update", "email"]);

/** The hierarchy of controls, strongest first. Used to tell a real fix from a gesture. */
const CONTROL_STRENGTH = Object.freeze({
  FORCING_FUNCTION: { rank: 5, label: "Forcing function or constraint: the error becomes impossible" },
  AUTOMATION: { rank: 4, label: "Automation or computerisation" },
  SIMPLIFICATION: { rank: 3, label: "Simplification or standardisation of the process" },
  CHECKLIST: { rank: 2, label: "Checklist, double-check or independent verification" },
  EDUCATION: { rank: 1, label: "Education, training, reminders or policy" },
});

class IncidentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "IncidentError";
    this.code = code || "INCIDENT_VIOLATION";
  }
}

/**
 * The SAC score: severity against likelihood of recurrence, 1 (most serious) to 4.
 *
 * The matrix is the standard shape. What is NOT here is any inference about who was at fault: SAC
 * describes how much investigation the event warrants, not how much blame anybody deserves.
 */
function sacScore(severity, likelihood) {
  const s = SEVERITY_RANK[severity];
  const l = LIKELIHOOD_RANK[likelihood];
  if (s === undefined || l === undefined) {
    throw new IncidentError("SAC needs a known severity and likelihood", "BAD_SAC_INPUT");
  }
  const combined = s + l;
  const sac = s >= 4 && l >= 2 ? 1 : combined >= 6 ? 1 : combined >= 4 ? 2 : combined >= 2 ? 3 : 4;
  return {
    sac,
    severity, likelihood,
    // The response is about investigation, never about sanction.
    response: sac === 1 ? "Full root cause analysis, executive notified, within 48 hours"
      : sac === 2 ? "Structured investigation by the service lead"
        : sac === 3 ? "Local review and aggregate analysis"
          : "Aggregate analysis only",
    rcaRequired: sac <= 2,
  };
}

let seq = 0;

/**
 * Files an incident.
 *
 * The required fields are deliberately few. Every additional mandatory field is a reason not to
 * report, and the reports lost to friction are not a random sample: they are the minor and the
 * near-miss ones, which is to say the ones that were still cheap to learn from.
 */
function report({ what, when, severity, reportedBy, anonymous = false, patientId, likelihood, contributingFactors, now } = {}) {
  if (!what || String(what).trim().length < 3) {
    throw new IncidentError("an incident needs a description of what happened", "NO_DESCRIPTION");
  }
  if (!severity || SEVERITY_RANK[severity] === undefined) {
    throw new IncidentError(`severity must be one of ${Object.values(SEVERITY).join(", ")}`, "NO_SEVERITY");
  }
  // Anonymity is a first-class choice, not a degraded one. What it costs is follow-up with the
  // author; what it buys is the report existing at all, and that is the better trade.
  if (!anonymous && !reportedBy) {
    throw new IncidentError("a named report needs the reporter, or set anonymous: true", "NO_REPORTER");
  }

  const at = now || new Date().toISOString();
  return {
    id: `inc-${++seq}`,
    what: String(what).trim(),
    when: when || at,
    reportedAt: at,
    severity,
    // Present only when supplied. Asking a reporter at 3am to estimate recurrence likelihood is a
    // triage question dressed as a reporting question, so it is triage's job.
    likelihood: likelihood || null,
    sac: likelihood ? sacScore(severity, likelihood) : null,
    anonymous: !!anonymous,
    reportedBy: anonymous ? null : reportedBy,
    patientId: patientId || null,
    contributingFactors: contributingFactors || [],
    state: STATE.REPORTED,
    rca: null,
    capas: [],
    history: [{ at, event: "reported", by: anonymous ? "anonymous" : reportedBy }],
  };
}

/** Triage assigns likelihood and therefore the SAC, and names who did it. */
function triage(incident, { likelihood, triagedBy, now } = {}) {
  if (!triagedBy) throw new IncidentError("triage must name who did it", "NO_ACTOR");
  incident.likelihood = likelihood;
  incident.sac = sacScore(incident.severity, likelihood);
  incident.state = STATE.TRIAGED;
  incident.triagedBy = triagedBy;
  incident.history.push({ at: now || new Date().toISOString(), event: "triaged", by: triagedBy, detail: `SAC ${incident.sac.sac}` });
  return incident;
}

/**
 * Records a root cause analysis.
 *
 * The refusal is the content. "Human error", "staff did not follow policy", "nurse forgot" are
 * places an investigation starts, never places it finishes: the question they leave unasked is why
 * the system made that error easy, likely or invisible. An RCA whose root cause is a person is
 * refused with that sentence attached.
 */
const PERSON_CAUSE = /\b(human error|staff error|nurse|doctor|clinician|technician|pharmacist|midwife|operator|user)\b.*\b(error|mistake|failure|forgot|failed|omitted|negligen\w*|careless\w*)\b|\b(error|mistake|forgot|failed to follow|did not follow|non[- ]compliance)\b.*\b(by|of) (the )?(nurse|doctor|staff|clinician|pharmacist|midwife)\b|^\s*human error\s*$/i;

function recordRCA(incident, { rootCause, contributingFactors, method, conductedBy, now } = {}) {
  if (!conductedBy) throw new IncidentError("an RCA must name who conducted it; the investigation's own conclusions are never anonymous", "NO_ACTOR");
  if (!rootCause || String(rootCause).trim().length < 5) {
    throw new IncidentError("an RCA needs a root cause", "NO_ROOT_CAUSE");
  }
  if (PERSON_CAUSE.test(String(rootCause))) {
    throw new IncidentError(
      `"${rootCause}" names a person as the root cause. That is where an investigation starts, not where it finishes: it leaves unasked why the system made this error easy, likely, or invisible until it reached the patient. Describe the system condition instead.`,
      "PERSON_AS_ROOT_CAUSE");
  }

  incident.rca = {
    rootCause: String(rootCause).trim(),
    contributingFactors: contributingFactors || [],
    method: method || "unspecified",
    conductedBy,
    at: now || new Date().toISOString(),
  };
  incident.state = STATE.INVESTIGATING;
  incident.history.push({ at: incident.rca.at, event: "rca-recorded", by: conductedBy });
  return incident;
}

const looksWeak = (text) => {
  const t = String(text || "").toLowerCase();
  return WEAK_ACTIONS.some((w) => t.includes(w));
};

/**
 * Adds a corrective or preventive action.
 *
 * Two refusals. An action with no owner and no date is not an action, it is a wish; and a set of
 * actions consisting only of retraining and reminders is the cheapest possible response and the one
 * that reliably fails, because it asks the next tired human to be more careful in the same place.
 */
function addCAPA(incident, { action, owner, dueBy, strength, now } = {}) {
  if (!action) throw new IncidentError("a CAPA needs an action", "NO_ACTION");
  if (!owner || !dueBy) {
    throw new IncidentError("a CAPA needs an owner and a due date; an action with neither is a wish, and an incident closed on wishes is a closed incident wearing a costume", "NO_OWNER_OR_DATE");
  }
  if (strength && !CONTROL_STRENGTH[strength]) {
    throw new IncidentError(`strength must be one of ${Object.keys(CONTROL_STRENGTH).join(", ")}`, "BAD_STRENGTH");
  }

  const inferred = strength || (looksWeak(action) ? "EDUCATION" : null);
  const capa = {
    id: `capa-${incident.id}-${incident.capas.length + 1}`,
    action: String(action).trim(),
    owner, dueBy,
    strength: inferred,
    strengthLabel: inferred ? CONTROL_STRENGTH[inferred].label : null,
    weak: inferred === "EDUCATION",
    state: "open",
    completedAt: null, completedBy: null, evidence: null,
    createdAt: now || new Date().toISOString(),
  };
  incident.capas.push(capa);
  incident.state = STATE.ACTIONS_OPEN;
  incident.history.push({ at: capa.createdAt, event: "capa-added", by: owner, detail: capa.action });
  return capa;
}

function completeCAPA(incident, capaId, { by, evidence, now } = {}) {
  const capa = incident.capas.find((c) => c.id === capaId);
  if (!capa) throw new IncidentError(`no CAPA ${capaId}`, "NO_CAPA");
  if (!by || !evidence) {
    throw new IncidentError("completing an action needs who did it and what shows it was done; 'done' with no evidence is the same as not done", "NO_EVIDENCE");
  }
  capa.state = "complete";
  capa.completedBy = by;
  capa.evidence = evidence;
  capa.completedAt = now || new Date().toISOString();
  incident.history.push({ at: capa.completedAt, event: "capa-completed", by, detail: capaId });
  return capa;
}

/**
 * Closes an incident, refusing the two ways closure is faked.
 */
function close(incident, { by, now } = {}) {
  if (!by) throw new IncidentError("closing an incident must name who closed it", "NO_ACTOR");
  if (incident.sac && incident.sac.rcaRequired && !incident.rca) {
    throw new IncidentError(`a SAC ${incident.sac.sac} incident cannot be closed without a root cause analysis`, "NO_RCA");
  }
  const open = incident.capas.filter((c) => c.state !== "complete");
  if (open.length) {
    throw new IncidentError(`${open.length} action${open.length > 1 ? "s remain" : " remains"} open`, "OPEN_CAPAS");
  }
  if (incident.capas.length && incident.capas.every((c) => c.weak)) {
    throw new IncidentError(
      "every action on this incident is education, retraining or a reminder. That is the most-chosen and least-effective response in patient safety: it asks the next tired person to be more careful in the same place, and changes nothing about the place. Add at least one action that changes the system.",
      "ALL_ACTIONS_WEAK");
  }
  incident.state = STATE.CLOSED;
  incident.closedBy = by;
  incident.closedAt = now || new Date().toISOString();
  incident.history.push({ at: incident.closedAt, event: "closed", by });
  return incident;
}

/**
 * The ledger a safety committee should actually read.
 *
 * It leads with the near-miss ratio, because that is the health of the REPORTING system rather than
 * of the hospital, and a unit whose reports are all harm is a unit that has stopped noticing the
 * free lessons. A falling incident count is celebrated everywhere and is usually bad news.
 */
function reportingHealth(incidents, nowIso) {
  const all = incidents || [];
  const now = nowIso || new Date().toISOString();
  const nearMiss = all.filter((i) => i.severity === SEVERITY.NEAR_MISS).length;
  const harm = all.filter((i) => SEVERITY_RANK[i.severity] >= SEVERITY_RANK[SEVERITY.MINOR]).length;
  const overdue = all.flatMap((i) => i.capas.filter((c) => c.state !== "complete" && Date.parse(c.dueBy) < Date.parse(now))
    .map((c) => ({ incidentId: i.id, capaId: c.id, owner: c.owner, dueBy: c.dueBy })));

  const allCapas = all.flatMap((i) => i.capas);
  const weak = allCapas.filter((c) => c.weak).length;

  return {
    total: all.length,
    nearMiss,
    harm,
    anonymous: all.filter((i) => i.anonymous).length,
    nearMissRatio: harm === 0 ? null : Math.round((nearMiss / harm) * 100) / 100,
    openCapas: allCapas.filter((c) => c.state !== "complete").length,
    overdueCapas: overdue,
    weakActionPercent: allCapas.length ? Math.round((weak / allCapas.length) * 100) : null,
    reading: nearMiss === 0 && all.length > 0
      ? "NO near misses reported. That is not a sign of safety: a unit that reports only harm has stopped noticing the events that were free to learn from, and the reporting system should be treated as failing."
      : `${nearMiss} near misses against ${harm} events reaching harm.`,
    actionReading: allCapas.length
      ? `${Math.round((weak / allCapas.length) * 100)} percent of actions are education, retraining or reminders.`
      : null,
  };
}

export {
  SEVERITY, SEVERITY_RANK, LIKELIHOOD, STATE, CONTROL_STRENGTH, WEAK_ACTIONS,
  IncidentError,
  sacScore, report, triage, recordRCA, addCAPA, completeCAPA, close, reportingHealth,
};
