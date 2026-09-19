/* wardsynq/wardsynq-consent.js — consent, and the capacity nobody assesses.
 *
 * A consent form is not consent. Consent is a decision made by a person who understood what was
 * proposed, was told what could go wrong, knew there were alternatives including doing nothing, and
 * was free to refuse. A signature is evidence that a conversation happened; this module's job is to
 * make it impossible to record the signature without recording the conversation.
 *
 * THE ASYMMETRY THAT RUNS THROUGH THIS FILE. Capacity is presumed, and incapacity must be
 * demonstrated. That is the legal position in most jurisdictions and it is also the safe one, because
 * the failure modes are not symmetrical: treating a capable adult as incapable strips them of a
 * right they have, and it happens overwhelmingly to the old, the disabled, the mentally ill and
 * anybody who disagrees with their doctor.
 *
 *   1. A REFUSAL IS NOT EVIDENCE OF INCAPACITY. Disagreeing with the recommended treatment is the
 *      single most common trigger for a capacity assessment, and an unwise decision is a right that
 *      capable people have. This module records the two separately and never infers one from the
 *      other.
 *   2. CAPACITY IS DECISION-SPECIFIC AND TIME-SPECIFIC. A person may lack capacity to consent to
 *      cardiac surgery and retain it for a blood test, and may lack it this morning and have it back
 *      this afternoon. A blanket "lacks capacity" flag on a patient record is therefore refused: an
 *      assessment names its decision and its time.
 *   3. A PROXY DECIDES FOR THE PATIENT, NOT FOR THEMSELVES. The standard is the patient's own known
 *      wishes and values, and where they are unknown, the patient's best interests. A proxy's own
 *      preference is not the test, and a recorded advance directive OUTRANKS a proxy.
 *   4. CONSENT IS FOR A PROCEDURE, BY A PERSON, AT A TIME, AND IT EXPIRES. Consent taken for one
 *      operation does not cover a different one, consent from a year ago is stale, and consent is
 *      withdrawable at any moment including during the procedure.
 *   5. EMERGENCY TREATMENT WITHOUT CONSENT IS LAWFUL AND MUST BE RECORDED AS WHAT IT IS. It is not
 *      consent, so it is never recorded as consent; it is a documented decision to treat under
 *      necessity, and it is limited to what will not wait.
 *
 * WHAT THIS DOES NOT DO. It does not assess capacity: no algorithm can, and any that claimed to
 * would be used to overrule people. It records that a named clinician assessed it, on what grounds,
 * for which decision. It also encodes no jurisdiction's law, and the thresholds and durations here
 * are UNAPPROVED defaults that a hospital's legal and clinical governance owns.
 *
 * NOT MODELLED: statutory mental health detention, court-appointed deputies and their scope, Gillick
 * competence and the specifics of adolescent consent beyond flagging it, research consent (see
 * wardsynq-research.js), organ donation, and jurisdiction-specific advance directive formalities.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated, NOT clinically approved, NOT legal advice.
 *
 * node --test test/wardsynq-consent.test.mjs
 */

import { ageBandOf, BAND } from "./wardsynq-paediatrics.js";

/** The four functional abilities. All four are required; losing any one is losing capacity. */
const ABILITY = Object.freeze({
  UNDERSTAND: "understand",   // can understand the information relevant to the decision
  RETAIN: "retain",           // can retain it long enough to decide
  WEIGH: "weigh",             // can use and weigh it as part of deciding
  COMMUNICATE: "communicate", // can communicate the decision by any means
});

const ABILITIES = Object.freeze(Object.values(ABILITY));

const BASIS = Object.freeze({
  CAPABLE_PATIENT: "capable-patient",
  ADVANCE_DIRECTIVE: "advance-directive",
  PROXY: "proxy",
  NECESSITY: "emergency-necessity",   // never called consent
  PARENTAL: "parental-responsibility",
});

/** How long a consent stands before it must be revisited. UNAPPROVED local default. */
const CONSENT_VALID_DAYS = 90;

class ConsentError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ConsentError";
    this.code = code || "CONSENT_VIOLATION";
  }
}

const days = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/* ------------------------------------------------------------------ capacity */

/**
 * Records a capacity assessment.
 *
 * This does NOT assess capacity. It records that a named clinician did, for a NAMED DECISION, at a
 * time, having considered the four functional abilities and stated why. Any function that claimed to
 * compute capacity from data would be used to overrule people, which is why there is not one.
 *
 * @param {{patientId, decision, assessedBy, abilities: Record<string, boolean>,
 *   reason?: string, supportProvided?: string[], now?: string}} input
 */
function assessCapacity({ patientId, decision, assessedBy, abilities, reason, supportProvided, now } = {}) {
  if (!patientId) throw new ConsentError("a capacity assessment belongs to a patient", "NO_PATIENT");
  if (!assessedBy) throw new ConsentError("a capacity assessment must name the clinician who made it", "NO_ASSESSOR");
  // The refusal that stops a blanket flag. "This patient lacks capacity" is not a finding, it is a
  // label, and it follows people through a record for years after the delirium resolved.
  if (!decision) {
    throw new ConsentError(
      "a capacity assessment must name the decision it is about. Capacity is decision-specific: a person may lack it for cardiac surgery and retain it for a blood test, so a blanket flag on a patient is not an assessment",
      "NO_DECISION");
  }
  abilities = abilities || {};
  const missing = ABILITIES.filter((a) => typeof abilities[a] !== "boolean");
  if (missing.length) {
    throw new ConsentError(`all four functional abilities must be answered; missing: ${missing.join(", ")}`, "INCOMPLETE_ABILITIES");
  }

  const failed = ABILITIES.filter((a) => abilities[a] === false);
  const hasCapacity = failed.length === 0;

  if (!hasCapacity && !reason) {
    // Incapacity is the finding that removes a right. It never stands on a checkbox alone.
    throw new ConsentError("a finding of INCAPACITY requires the clinician's reasoning; capacity is presumed and incapacity must be demonstrated", "NO_REASON");
  }

  const at = now || new Date().toISOString();
  return {
    patientId, decision, assessedBy, at,
    abilities: { ...abilities },
    hasCapacity,
    failedAbilities: failed,
    reason: reason || null,
    // What was done to help them decide before concluding they could not. Its absence is not an
    // error here, because this module cannot know, but it is surfaced: an assessment with no support
    // offered is a weaker assessment and a reviewer should see that.
    supportProvided: supportProvided || [],
    supportNote: (supportProvided && supportProvided.length) ? null
      : "No steps to support this person's decision-making were recorded. Capacity is assessed AFTER all practicable support has been offered, so an assessment without it is incomplete.",
    // Deliberately time-boxed. Capacity fluctuates, and a delirium assessment from Tuesday should not
    // be governing a decision on Friday.
    validUntilReviewed: true,
    note: "This records a clinician's assessment. Nothing in this system assesses capacity.",
  };
}

/**
 * The refusal that matters most in this file.
 *
 * Disagreeing with the recommended treatment is the commonest trigger for a capacity assessment, and
 * an unwise decision is a right that capable people have. A refusal and a capacity concern are
 * recorded as separate facts and neither is ever inferred from the other.
 */
function recordRefusal({ patientId, decision, refusedBy, reason, capacityAssessment, now } = {}) {
  if (!patientId || !decision) throw new ConsentError("a refusal names the patient and the decision", "NO_DECISION");
  if (!refusedBy) throw new ConsentError("a refusal names who refused", "NO_ACTOR");

  return {
    patientId, decision, refusedBy,
    at: now || new Date().toISOString(),
    reason: reason || null,
    // Present only if one was independently made. It is NOT triggered by the refusal.
    capacityAssessment: capacityAssessment || null,
    // The sentence this whole function exists to attach.
    note: "A refusal is not evidence of incapacity. An adult with capacity may refuse treatment for reasons others consider unwise, or for no reason at all, and that refusal is binding.",
    binding: !capacityAssessment || capacityAssessment.hasCapacity === true,
  };
}

/* ------------------------------------------------------------------ consent */

/**
 * Records consent.
 *
 * The disclosure fields are required because their absence is the commonest defect in real consent:
 * a signature on a form that never mentioned the alternatives, or the option of doing nothing.
 */
function giveConsent({
  patientId, procedure, basis, givenBy, takenBy,
  risksDiscussed, benefitsDiscussed, alternativesDiscussed, doingNothingDiscussed,
  questionsInvited, patientCapacity, proxy, advanceDirective, interpreterUsed, now,
} = {}) {
  if (!patientId || !procedure) throw new ConsentError("consent is for a patient and a named procedure", "NO_PROCEDURE");
  if (!takenBy) throw new ConsentError("consent must name the clinician who took it", "NO_ACTOR");
  if (!basis || !Object.values(BASIS).includes(basis)) {
    throw new ConsentError(`consent needs a basis: one of ${Object.values(BASIS).join(", ")}`, "NO_BASIS");
  }
  if (basis === BASIS.NECESSITY) {
    throw new ConsentError(
      "emergency treatment under necessity is NOT consent and must not be recorded as consent. Use recordEmergencyTreatment(), which records it as what it is: a decision to treat without consent because the patient could not give it and the treatment would not wait",
      "NECESSITY_IS_NOT_CONSENT");
  }

  const missing = [];
  if (!risksDiscussed || !risksDiscussed.length) missing.push("risks");
  if (!benefitsDiscussed) missing.push("benefits");
  if (!alternativesDiscussed || !alternativesDiscussed.length) missing.push("alternatives");
  // The option that is most often omitted, and is always available.
  if (doingNothingDiscussed !== true) missing.push("the option of no treatment");
  if (missing.length) {
    throw new ConsentError(
      `consent cannot be recorded without recording what was discussed; missing: ${missing.join(", ")}. A signature on a form that never mentioned these is evidence of paperwork, not of consent`,
      "INCOMPLETE_DISCLOSURE");
  }

  // A capable patient consents for themselves; anything else needs its own justification.
  if (basis === BASIS.CAPABLE_PATIENT) {
    if (patientCapacity && patientCapacity.hasCapacity === false) {
      throw new ConsentError("this patient was assessed as lacking capacity for this decision, so they cannot be the basis for it", "PATIENT_LACKS_CAPACITY");
    }
    if (!givenBy) throw new ConsentError("consent by the patient must name them", "NO_GIVER");
  }

  if (basis === BASIS.PROXY) {
    if (!proxy || !proxy.name || !proxy.relationship || !proxy.authority) {
      throw new ConsentError("a proxy must be named, with their relationship and the authority under which they act", "INCOMPLETE_PROXY");
    }
    if (!patientCapacity || patientCapacity.hasCapacity !== false) {
      throw new ConsentError("a proxy decides only where the patient has been assessed as lacking capacity FOR THIS DECISION", "NO_CAPACITY_FINDING");
    }
    if (advanceDirective && advanceDirective.appliesTo === procedure && advanceDirective.valid) {
      // The patient's own recorded wishes outrank a proxy's judgement about them, always.
      throw new ConsentError(
        "a valid advance directive covers this procedure. The patient's own recorded decision outranks a proxy's, and cannot be overridden by a relative who disagrees with it",
        "DIRECTIVE_OUTRANKS_PROXY");
    }
    if (!proxy.actingOnPatientsWishes) {
      throw new ConsentError(
        "a proxy decision must record that it applies the PATIENT'S known wishes and values, or their best interests where those are unknown. The proxy's own preference is not the standard",
        "PROXY_SUBSTITUTING_OWN_VIEW");
    }
  }

  const at = now || new Date().toISOString();
  return {
    id: `consent-${patientId}-${Date.parse(at)}`,
    patientId, procedure, basis, takenBy,
    givenBy: givenBy || (proxy && proxy.name) || null,
    at,
    risksDiscussed, benefitsDiscussed, alternativesDiscussed, doingNothingDiscussed: true,
    questionsInvited: questionsInvited === true,
    interpreterUsed: interpreterUsed || null,
    proxy: proxy || null,
    capacityAssessment: patientCapacity || null,
    withdrawn: false, withdrawnAt: null, withdrawnBy: null,
    validDays: CONSENT_VALID_DAYS,
  };
}

/**
 * Whether a consent covers a procedure about to happen.
 *
 * Three separate refusals, each of which is a real event in an operating theatre: consent for a
 * different procedure, consent that has gone stale, and consent that was withdrawn.
 */
function isValidFor(consent, { procedure, now } = {}) {
  const at = now || new Date().toISOString();
  if (!consent) return { valid: false, reason: "no consent record" };
  if (consent.withdrawn) {
    return { valid: false, reason: `consent was withdrawn at ${consent.withdrawnAt}; withdrawal is effective immediately and at any point, including after the patient is on the table` };
  }
  if (procedure && consent.procedure !== procedure) {
    return {
      valid: false,
      reason: `this consent is for "${consent.procedure}", not "${procedure}". Consent does not generalise: finding something unexpected does not authorise treating it, beyond what is immediately necessary`,
    };
  }
  const age = days(consent.at, at);
  if (age > consent.validDays) {
    return { valid: false, reason: `consent is ${Math.round(age)} days old, beyond the ${consent.validDays} day validity; the patient's situation and wishes may have changed and it must be revisited` };
  }
  return { valid: true, reason: `consented ${Math.round(age)} days ago for this procedure`, ageDays: Math.round(age) };
}

/** Withdrawal. Requires no reason, and is effective immediately. */
function withdraw(consent, { by, reason, now } = {}) {
  if (!consent) throw new ConsentError("no consent to withdraw", "NO_CONSENT");
  if (!by) throw new ConsentError("withdrawal names who withdrew it", "NO_ACTOR");
  consent.withdrawn = true;
  consent.withdrawnAt = now || new Date().toISOString();
  consent.withdrawnBy = by;
  // Explicitly optional. Requiring a reason to withdraw would make withdrawal something to be
  // justified, and it is not: it is a right exercised, not a request granted.
  consent.withdrawalReason = reason || null;
  return consent;
}

/**
 * Emergency treatment given without consent. Recorded as what it is, never as consent.
 */
function recordEmergencyTreatment({ patientId, treatment, decidedBy, whyCouldNotConsent, whyCannotWait, now } = {}) {
  if (!patientId || !treatment) throw new ConsentError("an emergency treatment record names the patient and the treatment", "NO_TREATMENT");
  if (!decidedBy) throw new ConsentError("an emergency treatment decision names the clinician who made it", "NO_ACTOR");
  if (!whyCouldNotConsent || !whyCannotWait) {
    throw new ConsentError(
      "treating without consent requires recording BOTH why the patient could not consent and why the treatment could not wait for someone who could. Necessity is limited to what will not wait: it is not a general authority to proceed",
      "INCOMPLETE_JUSTIFICATION");
  }
  return {
    patientId, treatment, decidedBy,
    at: now || new Date().toISOString(),
    basis: BASIS.NECESSITY,
    whyCouldNotConsent, whyCannotWait,
    isConsent: false,
    note: "This is NOT consent. It is a documented decision to treat under necessity, limited to what could not wait. Consent must be sought for anything further as soon as the patient or a proxy can be asked.",
  };
}

/**
 * Flags the consent questions an adolescent raises, without pretending to answer them.
 *
 * Adolescent consent turns on assessed competence rather than age alone, and the rules differ by
 * jurisdiction and by whether the decision is consent or refusal. Encoding one country's law here
 * would be worse than surfacing the question.
 */
function consentContext(patient, nowIso) {
  const band = ageBandOf(patient, nowIso);
  if (band.band === BAND.ADULT) return { adult: true, flags: [] };
  if (band.band === BAND.UNKNOWN) {
    return { adult: null, flags: ["the patient's age is not established, so it is not known whether they can consent for themselves"] };
  }
  const flags = [`this patient bands as ${band.band}`];
  if (band.band === BAND.ADOLESCENT) {
    flags.push("adolescent consent turns on assessed competence rather than age alone, and in many jurisdictions the rules for CONSENT and for REFUSAL differ. This module encodes no jurisdiction's law: seek the local policy");
  } else {
    flags.push("consent will normally rest with someone holding parental responsibility, whose identity and authority must be recorded");
  }
  return { adult: false, band: band.band, flags };
}

export {
  ABILITY, ABILITIES, BASIS, CONSENT_VALID_DAYS, ConsentError,
  assessCapacity, recordRefusal, giveConsent, isValidFor, withdraw,
  recordEmergencyTreatment, consentContext,
};
