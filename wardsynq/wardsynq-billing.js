/* wardsynq/wardsynq-billing.js — where money pulls on the clinical record.
 *
 * A billing module inside an EMR is a safety module, and not for the reason people expect. The
 * danger is not that a bill is wrong. It is that the money starts deciding what the chart says.
 *
 * Every incentive in revenue cycle management points one way: a more serious diagnosis pays more, a
 * documented complication pays more, a longer stay under one package pays more. The pressure is
 * applied to the clinical record, which is also the document a future clinician will treat as true
 * about this patient. A record bent for a claim is a record that lies to whoever reads it next, and
 * that patient may be unconscious at the time.
 *
 * So the rule this file is built around is a separation:
 *
 *   THE CLINICAL RECORD IS THE SOURCE. BILLING READS IT AND NEVER WRITES TO IT.
 *
 *   1. A CODE MUST BE SUPPORTED BY SOMETHING THAT WAS ALREADY IN THE CHART. A charge whose diagnosis
 *      appears nowhere in the clinical record is refused, not queried. Adding the diagnosis
 *      afterwards to support the charge is the exact motion this prevents, and it must go through
 *      the clinical path, by a clinician, on clinical grounds.
 *   2. UPCODING IS DETECTABLE AND IS DETECTED. A claim whose severity exceeds what the record
 *      supports is flagged with what is missing, at the point of coding, where it is still a
 *      question rather than a fraud.
 *   3. A DENIED CLAIM IS NEVER RESUBMITTED WITH A BIGGER DIAGNOSIS. Resubmission may correct an
 *      administrative error. If the clinical content changed between submissions, that is recorded
 *      and flagged, because "we found more documentation" after a denial is the commonest shape of
 *      real upcoding.
 *   4. FINANCIAL STATE MUST NEVER GATE CARE. There is one function here that decides whether a
 *      clinical action may proceed, and it always returns yes. It exists so that no caller has to
 *      invent its own answer, and so that the intent is written down where somebody would have to
 *      deliberately remove it.
 *   5. A PRE-AUTHORISATION IS A FUNDING DECISION, NOT A CLINICAL ONE. A refused pre-auth means the
 *      payer will not pay. It does not mean the treatment is not indicated, and the two are recorded
 *      as different facts.
 *
 * NOT MODELLED: any real tariff, package or scheme rate card; claim file formats and payer
 * transports; ICD or procedure code validity, which needs a real code set; DRG grouping logic;
 * refunds, write-offs and ledgers.
 *
 * STATUS: IMPLEMENTED and TESTED. Not a billing system and not certified for any payer.
 *
 * node --test test/wardsynq-billing.test.mjs
 */

const CLAIM_STATE = Object.freeze({
  DRAFT: "draft",
  CODED: "coded",
  SUBMITTED: "submitted",
  QUERIED: "queried",       // payer wants more information
  DENIED: "denied",
  PAID: "paid",
  WRITTEN_OFF: "written-off",
});

const PREAUTH_STATE = Object.freeze({
  REQUESTED: "requested",
  APPROVED: "approved",
  REFUSED: "refused",
  EXPIRED: "expired",
});

/** How strongly the clinical record supports a code. */
const SUPPORT = Object.freeze({
  DOCUMENTED: "documented",       // the condition is on the problem list or an encounter diagnosis
  INFERRED: "inferred",           // supported by an observation or order, not stated as a diagnosis
  UNSUPPORTED: "unsupported",     // nothing in the record supports it
});

class BillingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BillingError";
    this.code = code || "BILLING_VIOLATION";
  }
}

/**
 * THE function. It always returns true, and it is here so nobody writes their own.
 *
 * A hospital may refuse to schedule elective work for an unpaid account, and that is a scheduling
 * decision made by people. It is not a decision a clinical system makes at the point of care, and
 * the way that boundary gets crossed is a well-meaning caller writing `if (account.inArrears)`
 * somewhere in a treatment path. This exists so that call has an answer, and so that removing the
 * boundary requires deliberately deleting a function whose comment says what it is for.
 */
function mayProceedClinically() {
  return {
    allowed: true,
    reason: "Financial state does not gate clinical care. This function exists so that no caller has to invent its own answer, and it has no code path that returns false.",
  };
}

/**
 * How well the clinical record supports a diagnosis code.
 *
 * `record` is read-only here, on purpose: this module has no write path to the chart at all.
 */
function supportFor(code, record) {
  const r = record || {};
  const conditions = (r.conditions || []).map((c) => String(c.code || c).toUpperCase());
  const target = String(code || "").toUpperCase();

  if (conditions.includes(target)) {
    return { support: SUPPORT.DOCUMENTED, code, evidence: ["problem list or encounter diagnosis"] };
  }

  // Inferred support: something happened that is consistent with the code, but nobody wrote the
  // diagnosis down. That is a prompt to ask a clinician, never a licence to add it.
  const evidence = [];
  for (const o of r.observations || []) {
    if ((o.supportsCodes || []).map(String).map((s) => s.toUpperCase()).includes(target)) {
      evidence.push(`observation ${o.code}`);
    }
  }
  for (const m of r.medications || []) {
    if ((m.supportsCodes || []).map(String).map((s) => s.toUpperCase()).includes(target)) {
      evidence.push(`medication ${m.drug || m.drugCode}`);
    }
  }

  if (evidence.length) {
    return {
      support: SUPPORT.INFERRED, code, evidence,
      note: "The record contains evidence consistent with this code but no recorded diagnosis. Ask the treating clinician to document it if it is true. Do NOT add it to support the claim.",
    };
  }
  return { support: SUPPORT.UNSUPPORTED, code, evidence: [] };
}

/**
 * Codes a claim from the clinical record.
 *
 * Unsupported codes are REFUSED rather than queried, because a queried code sits in a work list
 * until somebody makes it go away, and the cheapest way to make it go away is to add the diagnosis.
 */
function codeClaim({ encounterId, patientId, record, codes, codedBy, now, invoiceId } = {}) {
  if (!encounterId || !patientId) throw new BillingError("a claim belongs to an encounter and a patient", "NO_ENCOUNTER");
  if (!codedBy) throw new BillingError("coding must name the coder", "NO_ACTOR");
  if (!codes || !codes.length) throw new BillingError("a claim needs at least one code", "NO_CODES");

  const assessed = codes.map((c) => {
    const code = typeof c === "string" ? c : c.code;
    return { ...supportFor(code, record), severity: (typeof c === "object" && c.severity) || null };
  });

  const unsupported = assessed.filter((a) => a.support === SUPPORT.UNSUPPORTED);
  if (unsupported.length) {
    throw new BillingError(
      `${unsupported.map((u) => u.code).join(", ")} ${unsupported.length > 1 ? "are" : "is"} not supported by anything in the clinical record. A charge cannot create its own justification: if the diagnosis is true, a clinician documents it on clinical grounds through the clinical path, and the claim is coded afterwards`,
      "UNSUPPORTED_CODE");
    }

  const at = now || new Date().toISOString();
  return {
    id: `claim-${encounterId}-${Date.parse(at)}`,
    encounterId, patientId, codedBy, at,
    // TASK 4.8: which invoice this claim reconciles against, when the hospital raised one. A plain
    // reference, never a computed match - two records that already existed, made findable from
    // each other, nothing more.
    invoiceId: invoiceId || null,
    state: CLAIM_STATE.CODED,
    codes: assessed,
    // Surfaced rather than silently accepted. An inferred code is a question for a clinician.
    inferredCodes: assessed.filter((a) => a.support === SUPPORT.INFERRED).map((a) => a.code),
    queries: assessed.filter((a) => a.support === SUPPORT.INFERRED)
      .map((a) => ({ code: a.code, question: `Is ${a.code} a diagnosis for this admission? Evidence: ${a.evidence.join(", ")}. If yes, document it clinically; this claim will not add it.` })),
    history: [{ at, event: "coded", by: codedBy, detail: assessed.map((a) => `${a.code}:${a.support}`).join(", ") }],
    // A fingerprint of the clinical content, so a later resubmission can be compared against it.
    clinicalFingerprint: fingerprint(assessed),
  };
}

function fingerprint(assessed) {
  return assessed.map((a) => `${String(a.code).toUpperCase()}@${a.severity || "-"}`).sort().join("|");
}

/**
 * Detects a claim whose severity exceeds what the record supports.
 *
 * Called at coding time, where an over-severe code is still a question. The same finding a year
 * later, from an auditor, is a fraud investigation.
 */
function detectUpcoding(claim, record) {
  const findings = [];
  for (const c of claim.codes) {
    if (!c.severity) continue;
    const supported = ((record && record.severityEvidence) || {})[String(c.code).toUpperCase()] || null;
    if (supported === null) {
      findings.push({
        code: c.code, claimed: c.severity, supported: null,
        reason: `${c.code} is claimed at severity "${c.severity}" and the record carries no severity evidence for it`,
      });
      continue;
    }
    const order = ["mild", "moderate", "severe", "critical"];
    if (order.indexOf(c.severity) > order.indexOf(supported)) {
      findings.push({
        code: c.code, claimed: c.severity, supported,
        reason: `${c.code} is claimed at "${c.severity}" and the record supports "${supported}"`,
      });
    }
  }
  return {
    clean: findings.length === 0,
    findings,
    reading: findings.length
      ? `${findings.length} code${findings.length > 1 ? "s exceed" : " exceeds"} what the record supports. This is a question now and an audit finding later; resolve it by correcting the code or by asking a clinician to document the severity if it is real.`
      : "No code exceeds the documented severity.",
  };
}

function submit(claim, { by, now, submittedAmount } = {}) {
  if (!by) throw new BillingError("submission names who submitted it", "NO_ACTOR");
  claim.state = CLAIM_STATE.SUBMITTED;
  claim.submittedAt = now || new Date().toISOString();
  // TASK 4.8: what the hospital is asking the payer for. A plain number the caller supplies, never
  // computed here - this module invents no tariff and adjudicates nothing.
  if (Number.isFinite(Number(submittedAmount))) claim.submittedAmount = Number(submittedAmount);
  claim.submissions = (claim.submissions || []).concat([{ at: claim.submittedAt, by, fingerprint: claim.clinicalFingerprint }]);
  claim.history.push({ at: claim.submittedAt, event: "submitted", by });
  return claim;
}

function deny(claim, { reason, by, now, deniedAmount } = {}) {
  if (!reason) throw new BillingError("a denial carries the payer's reason", "NO_REASON");
  claim.state = CLAIM_STATE.DENIED;
  claim.denialReason = reason;
  if (Number.isFinite(Number(deniedAmount))) claim.deniedAmount = Number(deniedAmount);
  claim.history.push({ at: now || new Date().toISOString(), event: "denied", by: by || "payer", detail: reason });
  return claim;
}

/**
 * TASK 4.8: records what the payer said it will pay - a fact arriving from outside, never a
 * computation this module performs. Separate from submit/deny on purpose: a payer's adjudicated
 * amount can arrive alongside a query, a partial approval, or a denial, and forcing it through one
 * state transition would either invent a state nobody asked for or hide the amount inside a reason
 * string. This never changes claim.state - state is still only submit/deny/resubmit's to move.
 */
function recordAdjudication(claim, { approvedAmount, deniedAmount, by, now, reason } = {}) {
  if (!by) throw new BillingError("an adjudication names who recorded it", "NO_ACTOR");
  const hasApproved = Number.isFinite(Number(approvedAmount));
  const hasDenied = Number.isFinite(Number(deniedAmount));
  if (!hasApproved && !hasDenied) throw new BillingError("an adjudication needs an approved or a denied amount", "NO_AMOUNT");
  const at = now || new Date().toISOString();
  if (hasApproved) claim.approvedAmount = Number(approvedAmount);
  if (hasDenied) claim.deniedAmount = Number(deniedAmount);
  claim.history.push({
    at, event: "adjudicated", by,
    detail: [hasApproved ? `approved ${claim.approvedAmount}` : null, hasDenied ? `denied ${claim.deniedAmount}` : null, reason || null].filter(Boolean).join(", "),
  });
  return claim;
}

/**
 * Resubmits a denied claim.
 *
 * The check that matters: if the clinical content changed between the denial and the resubmission,
 * that is recorded and flagged. "We found more documentation" after a denial is the commonest shape
 * of real upcoding, and the point is not to block it, because a genuine correction happens too. The
 * point is that it can never happen invisibly.
 */
function resubmit(claim, { codes, record, by, reason, now, submittedAmount } = {}) {
  if (claim.state !== CLAIM_STATE.DENIED && claim.state !== CLAIM_STATE.QUERIED) {
    throw new BillingError("only a denied or queried claim is resubmitted", "NOT_DENIED");
  }
  if (!by || !reason) throw new BillingError("a resubmission names who did it and why", "NO_REASON");

  const at = now || new Date().toISOString();
  let changed = false;
  let newFingerprint = claim.clinicalFingerprint;

  if (codes) {
    const assessed = codes.map((c) => {
      const code = typeof c === "string" ? c : c.code;
      return { ...supportFor(code, record), severity: (typeof c === "object" && c.severity) || null };
    });
    const unsupported = assessed.filter((a) => a.support === SUPPORT.UNSUPPORTED);
    if (unsupported.length) {
      throw new BillingError(`${unsupported.map((u) => u.code).join(", ")} is not supported by the clinical record`, "UNSUPPORTED_CODE");
    }
    newFingerprint = fingerprint(assessed);
    changed = newFingerprint !== claim.clinicalFingerprint;
    claim.codes = assessed;
    claim.clinicalFingerprint = newFingerprint;
  }

  claim.state = CLAIM_STATE.SUBMITTED;
  if (Number.isFinite(Number(submittedAmount))) claim.submittedAmount = Number(submittedAmount);
  claim.submissions = (claim.submissions || []).concat([{ at, by, fingerprint: newFingerprint, resubmission: true, reason }]);
  claim.history.push({ at, event: "resubmitted", by, detail: reason });

  if (changed) {
    claim.clinicalContentChangedAfterDenial = true;
    claim.upcodingFlag = {
      at, by,
      previousFingerprint: claim.submissions[claim.submissions.length - 2].fingerprint,
      newFingerprint,
      reason: "The clinical coding changed between the denial and the resubmission. This is not blocked, because a genuine correction happens too, but it is recorded permanently: 'we found more documentation' after a denial is the commonest shape of real upcoding, and it must never be invisible.",
    };
    claim.history.push({ at, event: "clinical-content-changed-after-denial", by, detail: `${claim.upcodingFlag.previousFingerprint} -> ${newFingerprint}` });
  }
  return claim;
}

/**
 * A pre-authorisation. A funding decision, recorded as one.
 */
function preAuthorisation({ patientId, scheme, treatment, state, decidedAt, reason, requestedBy, invoiceId, authorizedAmount } = {}) {
  if (!patientId || !treatment) throw new BillingError("a pre-auth names the patient and the treatment", "NO_TREATMENT");
  if (!Object.values(PREAUTH_STATE).includes(state)) throw new BillingError("a pre-auth needs a state", "NO_STATE");

  return {
    patientId, scheme: scheme || null, treatment, state, reason: reason || null,
    requestedBy: requestedBy || null, decidedAt: decidedAt || new Date().toISOString(),
    // TASK 4.8: the same plain, uncomputed reference and amount fields the plan asks a
    // pre-authorisation to carry - "authorization number" is this record's own id; the amount is
    // whatever the payer actually authorized, supplied by the caller, never estimated here.
    invoiceId: invoiceId || null,
    authorizedAmount: Number.isFinite(Number(authorizedAmount)) ? Number(authorizedAmount) : null,
    // The distinction this record exists to preserve.
    isClinicalDecision: false,
    note: state === PREAUTH_STATE.REFUSED
      ? "The payer will not fund this. That is a funding decision and NOT a clinical one: it does not mean the treatment is not indicated. If it is indicated it should be provided, and the funding disagreement pursued separately."
      : "A funding decision. Clinical indication is decided independently and is not recorded here.",
  };
}

/** Claims whose coding changed after a denial. The list a compliance officer should read monthly. */
function upcodingWatchlist(claims) {
  const flagged = (claims || []).filter((c) => c.clinicalContentChangedAfterDenial);
  return {
    count: flagged.length,
    claims: flagged.map((c) => ({ id: c.id, patientId: c.patientId, flag: c.upcodingFlag })),
    reading: flagged.length
      ? `${flagged.length} claim${flagged.length > 1 ? "s had" : " had"} its clinical coding changed after a payer denial. Each may be a legitimate correction. Each should be checked against the clinical record by somebody who is not paid on collections.`
      : "No claim had its clinical coding changed after a denial.",
  };
}

export {
  CLAIM_STATE, PREAUTH_STATE, SUPPORT, BillingError,
  mayProceedClinically, supportFor, codeClaim, detectUpcoding,
  submit, deny, resubmit, recordAdjudication, preAuthorisation, upcodingWatchlist,
};
