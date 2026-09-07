/* wardsynq/wardsynq-population.js — the patients nobody is looking at.
 *
 * Every other module in this build reacts to a patient who is in front of somebody. This one is
 * about the opposite population: the person with diabetes whose HbA1c was last checked nineteen
 * months ago, who is not in any clinic today, and about whom no alert will ever fire because nothing
 * is happening to them. That is most of the harm in chronic disease, and it is invisible by
 * construction to a system that only responds to events.
 *
 *   1. A CARE GAP IS AN ABSENCE, SO IT MUST BE COMPUTED, NOT DETECTED. There is no event to hook.
 *      Registries are evaluated on a schedule against the passage of time, which is why this module
 *      is a sweep and not a listener.
 *   2. AN OUTREACH LIST IS A LIST OF PEOPLE, AND CONTACTING THEM COSTS THEM SOMETHING. A recall
 *      letter to someone in palliative care, or to a patient who has died, is a cruelty the system
 *      caused. Suppression rules are therefore first-class, mandatory, and checked before the list
 *      is produced rather than after.
 *   3. DECLINING IS A DECISION, AND IT PERSISTS. A patient who has said no to screening is not a gap
 *      to be re-detected every month. Ignoring that turns a care system into a nuisance and teaches
 *      people to ignore it, which costs them the one letter that mattered.
 *   4. A REGISTRY IS A LABEL APPLIED TO PEOPLE, AND LABELS ARE STICKY. Entry criteria are recorded
 *      with each membership, so a patient can see and challenge why they are on a list, and a
 *      clinician can tell a coded diagnosis from an inference drawn by software.
 *   5. THE GAP IS NOT THE HARM. Being overdue for a test is not the same as being unwell, and an
 *      outreach system that speaks as though it were generates fear in the well and does nothing for
 *      the sick. Priority here is by clinical risk, never by how overdue something is.
 *
 * NOT MODELLED: message delivery of any kind (an outreach list is produced, not sent), appointment
 * booking, deprivation or equity weighting, predictive risk models, and any national screening
 * programme's actual eligibility rules.
 *
 * PROVENANCE: the seeded registries and intervals are structurally faithful and UNAPPROVED. Real
 * recall intervals are set by national programmes and local policy.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-population.test.mjs
 */

/** Why a patient is on a registry. A coded diagnosis and a software inference are not the same. */
const ENTRY = Object.freeze({
  CODED: "coded-diagnosis",
  MEDICATION: "inferred-from-medication",
  RESULT: "inferred-from-result",
  MANUAL: "added-by-clinician",
});

/** Why a patient is NOT contacted. Every one of these is somebody the system could have hurt. */
const SUPPRESSION = Object.freeze({
  DECEASED: "deceased",
  PALLIATIVE: "palliative-or-end-of-life",
  DECLINED: "patient-declined",
  OPTED_OUT: "opted-out-of-contact",
  NO_CONTACT_DETAILS: "no-usable-contact-details",
  RECENTLY_CONTACTED: "contacted-recently",
  UNDER_ACTIVE_CARE: "already-under-active-care-for-this",
  SAFEGUARDING: "safeguarding-or-sensitive-flag",
});

/** How long a recent contact suppresses another. UNAPPROVED local default. */
const CONTACT_COOLDOWN_DAYS = 60;

/** How long a decline stands before it is respectfully asked again. UNAPPROVED. */
const DECLINE_HONOURED_DAYS = 365;

class PopulationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "PopulationError";
    this.code = code || "POPULATION_VIOLATION";
  }
}

const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/**
 * Defines a registry.
 *
 * `criteria` returns an ENTRY reason or null, so membership always carries its own justification.
 */
function defineRegistry({ id, label, version, criteria, gaps }) {
  if (!id || !version) throw new PopulationError("a registry needs an id and a version", "NO_VERSION");
  if (typeof criteria !== "function") throw new PopulationError("a registry needs criteria()", "NO_CRITERIA");
  return Object.freeze({ id, label: label || id, version, criteria, gaps: gaps || [] });
}

/**
 * Defines a care gap: something that should have happened by now and has not.
 *
 * `risk` is the clinical consequence of the gap, not how overdue it is. An HbA1c three months late in
 * a well-controlled patient is not more urgent than a missed retinal screen in someone losing sight,
 * however much larger the overdue number looks.
 */
function defineGap({ id, label, intervalDays, lastDone, risk = "routine", appliesTo }) {
  if (!id || typeof intervalDays !== "number") throw new PopulationError("a gap needs an id and an interval", "NO_INTERVAL");
  if (typeof lastDone !== "function") throw new PopulationError("a gap needs lastDone()", "NO_LAST_DONE");
  return Object.freeze({ id, label: label || id, intervalDays, lastDone, risk, appliesTo: appliesTo || (() => true) });
}

/** Registry membership for one patient, with the reason recorded. */
function evaluateMembership(registry, patient) {
  const reason = registry.criteria(patient);
  if (!reason) return null;
  return {
    registryId: registry.id, registryVersion: registry.version,
    patientId: patient.id, entry: reason,
    // Attached so a patient can be told why software put them on a list, and challenge it.
    explanation: reason === ENTRY.CODED ? "a coded diagnosis in the record"
      : reason === ENTRY.MEDICATION ? "inferred from a prescribed medication, not from a recorded diagnosis"
        : reason === ENTRY.RESULT ? "inferred from a laboratory result, not from a recorded diagnosis"
          : "added by a clinician",
    inferred: reason !== ENTRY.CODED && reason !== ENTRY.MANUAL,
  };
}

/**
 * Open care gaps for one patient.
 *
 * A gap never done at all is open, which is the case a "days since last" calculation silently drops
 * by producing NaN and comparing it to a threshold.
 */
function openGaps(registry, patient, nowIso) {
  const now = nowIso || new Date().toISOString();
  const open = [];
  for (const gap of registry.gaps) {
    if (!gap.appliesTo(patient)) continue;
    const last = gap.lastDone(patient);
    if (!last) {
      open.push({ gapId: gap.id, label: gap.label, risk: gap.risk, lastDone: null, overdueDays: null, neverDone: true });
      continue;
    }
    const age = daysBetween(last, now);
    if (age > gap.intervalDays) {
      open.push({ gapId: gap.id, label: gap.label, risk: gap.risk, lastDone: last, overdueDays: Math.round(age - gap.intervalDays), neverDone: false });
    }
  }
  return open;
}

/**
 * Whether this patient may be contacted, and why not.
 *
 * Returns EVERY applicable reason rather than the first, because a list of one reason invites
 * somebody to clear it and re-run.
 */
function suppressionFor(patient, { gapId, now } = {}) {
  const reasons = [];
  const at = now || new Date().toISOString();

  if (patient.deceased === true || patient.deceasedAt) reasons.push({ code: SUPPRESSION.DECEASED, detail: "a recall letter to a family who has just had a death is a cruelty the system caused" });
  if (patient.palliative === true) reasons.push({ code: SUPPRESSION.PALLIATIVE, detail: "screening and recall are not what this patient needs" });
  if (patient.optedOutOfOutreach === true) reasons.push({ code: SUPPRESSION.OPTED_OUT, detail: "the patient has asked not to be contacted" });
  if (patient.safeguardingFlag === true) reasons.push({ code: SUPPRESSION.SAFEGUARDING, detail: "contact must be reviewed by a named person before it is sent" });

  const declined = (patient.declined || []).find((d) => d.gapId === gapId);
  if (declined && daysBetween(declined.at, at) < DECLINE_HONOURED_DAYS) {
    reasons.push({
      code: SUPPRESSION.DECLINED,
      detail: `declined ${Math.round(daysBetween(declined.at, at))} days ago; a decision is not a gap to be re-detected every month, and ignoring it teaches people to ignore the letter that mattered`,
    });
  }

  if (patient.underActiveCareFor && patient.underActiveCareFor.includes(gapId)) {
    reasons.push({ code: SUPPRESSION.UNDER_ACTIVE_CARE, detail: "already being dealt with; a letter would confuse" });
  }

  const lastContact = (patient.outreachContacts || [])
    .map((c) => c.at).sort().reverse()[0];
  if (lastContact && daysBetween(lastContact, at) < CONTACT_COOLDOWN_DAYS) {
    reasons.push({ code: SUPPRESSION.RECENTLY_CONTACTED, detail: `contacted ${Math.round(daysBetween(lastContact, at))} days ago` });
  }

  const hasContact = !!(patient.phone || patient.email || patient.address);
  if (!hasContact) reasons.push({ code: SUPPRESSION.NO_CONTACT_DETAILS, detail: "no usable contact details; this patient needs finding, not writing to" });

  return { suppressed: reasons.length > 0, reasons };
}

const RISK_ORDER = Object.freeze({ urgent: 0, high: 1, moderate: 2, routine: 3 });

/**
 * Builds an outreach list.
 *
 * Suppression is applied BEFORE the list exists, not as a filter over a list somebody might export
 * first. Ordering is by clinical risk, never by how overdue the gap is, because the largest overdue
 * number and the sickest patient are rarely the same person.
 */
function buildOutreachList(registry, patients, { now, includeSuppressed = false } = {}) {
  const at = now || new Date().toISOString();
  const contact = [];
  const suppressed = [];
  const notMembers = [];

  for (const patient of patients || []) {
    const membership = evaluateMembership(registry, patient);
    if (!membership) { notMembers.push(patient.id); continue; }

    const gaps = openGaps(registry, patient, at);
    if (!gaps.length) continue;

    for (const gap of gaps) {
      const s = suppressionFor(patient, { gapId: gap.gapId, now: at });
      const row = { patientId: patient.id, membership, gap, suppression: s };
      if (s.suppressed) suppressed.push(row);
      else contact.push(row);
    }
  }

  contact.sort((a, b) => {
    const r = (RISK_ORDER[a.gap.risk] ?? 9) - (RISK_ORDER[b.gap.risk] ?? 9);
    if (r !== 0) return r;
    // Only inside a risk band does overdue-ness break the tie.
    return (b.gap.overdueDays ?? Infinity) - (a.gap.overdueDays ?? Infinity);
  });

  const bySuppression = {};
  for (const s of suppressed) {
    for (const r of s.suppression.reasons) bySuppression[r.code] = (bySuppression[r.code] || 0) + 1;
  }

  return {
    registryId: registry.id, registryVersion: registry.version, at,
    contact,
    contactCount: contact.length,
    suppressedCount: suppressed.length,
    suppressedBy: bySuppression,
    // Included only when explicitly asked for. The default list is the one it is safe to act on.
    suppressed: includeSuppressed ? suppressed : undefined,
    notMembers: notMembers.length,
    // The sentence to put at the top of the list.
    caution: "Being overdue for a test is not the same as being unwell. This list is ordered by clinical risk, not by how overdue anything is, and it is a list of people for whom contact costs something.",
  };
}

/** Records a patient's decision to decline. It persists, which is the entire point. */
function recordDecline(patient, { gapId, at, reason } = {}) {
  if (!gapId) throw new PopulationError("a decline is for a specific thing", "NO_GAP");
  patient.declined = (patient.declined || []).concat([{ gapId, at: at || new Date().toISOString(), reason: reason || null }]);
  return patient;
}

/* ------------------------------------------------------------------ seeded registries */

const hasCode = (patient, code) => (patient.conditions || []).some((c) => String(c.code || c).toUpperCase().startsWith(code));

const DIABETES = defineRegistry({
  id: "diabetes", label: "Diabetes register", version: "0.1.0-unapproved",
  criteria: (p) => {
    if (hasCode(p, "E10") || hasCode(p, "E11")) return ENTRY.CODED;
    if ((p.medications || []).some((m) => /metformin|insulin|gliclazide|sitagliptin/i.test(m.drug || ""))) return ENTRY.MEDICATION;
    if ((p.results || []).some((r) => r.code === "4548-4" && Number(r.value) >= 6.5)) return ENTRY.RESULT;
    return null;
  },
  gaps: [
    defineGap({
      id: "hba1c", label: "HbA1c", intervalDays: 180, risk: "moderate",
      lastDone: (p) => (p.results || []).filter((r) => r.code === "4548-4").map((r) => r.at).sort().reverse()[0] || null,
    }),
    defineGap({
      id: "retinal-screening", label: "Retinal screening", intervalDays: 365, risk: "high",
      lastDone: (p) => p.lastRetinalScreening || null,
    }),
    defineGap({
      id: "foot-check", label: "Foot check", intervalDays: 365, risk: "moderate",
      lastDone: (p) => p.lastFootCheck || null,
    }),
  ],
});

export {
  ENTRY, SUPPRESSION, CONTACT_COOLDOWN_DAYS, DECLINE_HONOURED_DAYS, RISK_ORDER, DIABETES,
  PopulationError,
  defineRegistry, defineGap, evaluateMembership, openGaps, suppressionFor,
  buildOutreachList, recordDecline,
};
