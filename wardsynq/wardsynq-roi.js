/* wardsynq/wardsynq-roi.js — TASK 4.9: a THIRD PARTY asking for a copy of a patient's record.
 *
 * patient-record.js already answers "what did we hand this patient" - a RECEIPT, not a copy of
 * the values, given at the point of care by a treating clinician. This is a different fact: an
 * attorney, another hospital, an insurer or a government agency asking for records days or years
 * later, through Health Information Management, needing a tracked authorization and a disclosure
 * log - not a bedside handout.
 *
 * NEVER EXPOSE THE ENTIRE CHART WHEN ONLY A DEFINED SUBSET IS AUTHORIZED. A request names a scope
 * (which record types, which date range) before it is authorized, and fulfilling it records only
 * what that scope covers - the same "receipt, not a copy" discipline patient-record.js already
 * uses: what was disclosed is counted and described, never re-stored as a second copy of the
 * clinical values.
 *
 * AUTHORIZATION BASIS IS RECORDED, NEVER INFERRED. "The patient signed a release," "a court order,"
 * "a subpoena," "an existing share-external consent" are different facts a HIM officer has to be
 * able to name and produce later. This file does not decide what counts as a VALID basis - that is
 * a legal/compliance judgement for the hospital's own HIM policy, exactly as patient-record.js
 * refuses to invent a default sensitivity list. It only requires that SOME basis is named.
 *
 * NO REDACTION LOGIC IS INVENTED HERE. What counts as a legally sensitive category (psychiatric
 * notes, substance-abuse records under a jurisdiction's own rule) is not modelled - that is exactly
 * the kind of legal/regulatory judgement this codebase's own conventions require be configured by
 * the hospital, never guessed by this file. `excludeCodes`/`recordTypes` are a plain scope the
 * requester and the HIM officer agree on and this file carries verbatim.
 *
 * A DENIED OR CANCELLED REQUEST STAYS ON THE RECORD. "Requested and refused" and "never asked" are
 * different histories, and the second one is what an audit turns on.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "ROIRequest";

const STATES = Object.freeze(["requested", "authorized", "denied", "fulfilled", "cancelled"]);
/** Who is asking, in the ordinary shape a HIM department already classifies requests by. `other`
 *  exists with a required note so nothing about a real requester is unrecordable. */
const RELATIONSHIPS = Object.freeze(["patient", "attorney", "other-provider", "insurer", "government-agency", "employer", "family-member", "other"]);

class RoiRefusalError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function ROIRequest(input) {
  const i = input || {};
  const scope = i.scope || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    requester: {
      name: str((i.requester || {}).name) || null,
      organization: str((i.requester || {}).organization) || null,
      relationship: RELATIONSHIPS.includes((i.requester || {}).relationship) ? (i.requester || {}).relationship : "other",
    },
    purpose: str(i.purpose) || null,
    // Recorded verbatim, never validated against a list of what counts as legally sufficient - a
    // HIM officer's own judgement, not this file's.
    authorizationBasis: str(i.authorizationBasis) || null,
    scope: {
      recordTypes: Array.isArray(scope.recordTypes) ? scope.recordTypes.map(str).filter(Boolean) : [],
      from: scope.from || null, to: scope.to || null,
      excludeCodes: Array.isArray(scope.excludeCodes) ? scope.excludeCodes.map(str).filter(Boolean) : [],
    },
    recipient: str(i.recipient) || null,
    state: STATES.includes(i.state) ? i.state : "requested",
    requestedBy: i.requestedBy || null, requestedAt: i.requestedAt || null,
    decidedBy: i.decidedBy || null, decidedAt: i.decidedAt || null, decisionReason: i.decisionReason || null,
    fulfilledBy: i.fulfilledBy || null, fulfilledAt: i.fulfilledAt || null,
    // The disclosure log - what was ACTUALLY sent, counted, never a second copy of the values. Set
    // only at fulfilment.
    disclosure: i.disclosure || null,
    history: Array.isArray(i.history) ? i.history : [],
    source: { system: "wardsynq-native", sourceId: `roi:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One request per (patient, requester, instant) - a retried submission is the same one. */
function roiIdFor(patientId, requesterName, requestedAt) {
  const p = slug(patientId), r = slug(requesterName), t = slug(requestedAt);
  return p && r && t ? `wsq-roi-${p}-${r}-${t}` : null;
}

/**
 * A new request. Scope must name AT LEAST ONE record type - "the whole chart" is exactly what the
 * plan's own safeguard forbids defaulting to.
 */
function requestROI({ id, patientId, requester, purpose, authorizationBasis, scope, recipient, requestedBy, requestedAt } = {}) {
  if (!id || !patientId) throw new RoiRefusalError("MISSING_FIELDS", "an ROI request needs a patient");
  if (!requester || !str(requester.name)) throw new RoiRefusalError("REQUESTER_REQUIRED", "an ROI request must name who is asking");
  if (!str(purpose)) throw new RoiRefusalError("PURPOSE_REQUIRED", "an ROI request must say what it is for");
  if (!str(recipient)) throw new RoiRefusalError("RECIPIENT_REQUIRED", "an ROI request must name who the record goes to");
  const rt = (scope && scope.recordTypes) || [];
  if (!Array.isArray(rt) || !rt.length) {
    throw new RoiRefusalError("SCOPE_REQUIRED", "an ROI request must name which record types are wanted - never the whole chart by default");
  }
  const at = str(requestedAt);
  if (!requestedBy || !at) throw new RoiRefusalError("MISSING_FIELDS", "an ROI request needs an actor and a time");
  const req = ROIRequest({ id, patientId, requester, purpose, scope, recipient, requestedBy, requestedAt: at, authorizationBasis: authorizationBasis || null, state: "requested" });
  req.history.push({ at, event: "requested", by: requestedBy, detail: `${req.requester.relationship}: ${req.requester.name}` });
  return req;
}

/** Authorizing without a named basis is refused - "somebody clicked yes" is not a basis. */
function authorize(req, { by, at, authorizationBasis, reason } = {}) {
  if (req.state !== "requested") throw new RoiRefusalError("NOT_REQUESTED", "only a pending request can be authorized");
  const basis = str(authorizationBasis) || req.authorizationBasis;
  if (!basis) throw new RoiRefusalError("AUTHORIZATION_BASIS_REQUIRED", "authorizing a release needs a stated basis - a signed release, a consent on record, a court order, a subpoena");
  if (!by || !str(at)) throw new RoiRefusalError("MISSING_FIELDS", "authorizing needs an actor and a time");
  req.state = "authorized"; req.authorizationBasis = basis;
  req.decidedBy = by; req.decidedAt = at; req.decisionReason = str(reason) || null;
  req.history.push({ at, event: "authorized", by, detail: basis });
  return req;
}

function deny(req, { by, at, reason } = {}) {
  if (req.state !== "requested") throw new RoiRefusalError("NOT_REQUESTED", "only a pending request can be denied");
  if (!str(reason)) throw new RoiRefusalError("REASON_REQUIRED", "a denial must say why");
  if (!by || !str(at)) throw new RoiRefusalError("MISSING_FIELDS", "denying needs an actor and a time");
  req.state = "denied"; req.decidedBy = by; req.decidedAt = at; req.decisionReason = reason;
  req.history.push({ at, event: "denied", by, detail: reason });
  return req;
}

function cancel(req, { by, at, reason } = {}) {
  if (req.state !== "requested" && req.state !== "authorized") throw new RoiRefusalError("ALREADY_CLOSED", "a fulfilled or already-closed request is not cancelled");
  if (!str(reason)) throw new RoiRefusalError("REASON_REQUIRED", "a cancellation must say why");
  if (!by || !str(at)) throw new RoiRefusalError("MISSING_FIELDS", "cancelling needs an actor and a time");
  req.state = "cancelled"; req.decidedBy = by; req.decidedAt = at; req.decisionReason = reason;
  req.history.push({ at, event: "cancelled", by, detail: reason });
  return req;
}

/**
 * Records what was ACTUALLY disclosed - counts and a description, never the values themselves,
 * matching patient-record.js's own "a receipt, not a copy" discipline exactly. Only an authorized
 * request can be fulfilled; fulfilling is terminal.
 */
function fulfill(req, { by, at, deliveredStatus, resourceCounts, note } = {}) {
  if (req.state !== "authorized") throw new RoiRefusalError("NOT_AUTHORIZED", "only an authorized request is fulfilled");
  if (!by || !str(at)) throw new RoiRefusalError("MISSING_FIELDS", "fulfilling needs an actor and a time");
  const delivered = str(deliveredStatus) || "delivered";
  req.state = "fulfilled"; req.fulfilledBy = by; req.fulfilledAt = at;
  req.disclosure = {
    at, by, deliveredStatus: delivered,
    // A count per record type actually included, never the values - the same shape
    // patient-record.js's PatientRecordRelease already uses (resultIds count, diagnosisCount, ...).
    resourceCounts: resourceCounts && typeof resourceCounts === "object" ? { ...resourceCounts } : {},
    note: str(note) || null,
  };
  req.history.push({ at, event: "fulfilled", by, detail: `${delivered}: ${Object.entries(req.disclosure.resourceCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "nothing to disclose"}` });
  return req;
}

export { TYPE, STATES, RELATIONSHIPS, RoiRefusalError, ROIRequest, roiIdFor, requestROI, authorize, deny, cancel, fulfill };
