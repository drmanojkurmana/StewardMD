/* functions/_wardsynq/dpdp.js - the Digital Personal Data Protection Act 2023, as a hospital has to run it.
 *
 * Four records, each append-only, each written by the person who did the act:
 *
 *   PrivacyNotice           the notice s5 requires, written by the hospital, one record per language (s5(3):
 *                           English or any language in the Eighth Schedule), a new version per edit. It names
 *                           the Data Protection Officer's contact, which s8(9) says must be published.
 *   PrivacyAcknowledgement  that a patient was given a particular version of it, at registration or in the portal.
 *   DataPrincipalRequest    access (s11), correction or erasure (s12), grievance (s13), nomination (s14), with the
 *                           hospital's own answer clock and the answer.
 *   DataBreach              detection, assessment, and WHEN the Board and each affected patient were told (s8(6)).
 *
 * WHICH LAW, AND WHICH CLOCK. The DPDP duties of a hospital commence about 13 May 2027 (G.S.R. 843(E); Rules r.1,
 * G.S.R. 846(E)); until then IT Act s.43A with the SPDI Rules 2011 and the CERT-In Directions 2022 apply. The dates, the
 * confirmed periods and their citations live in privacy-law.js (legal opinion of 17 Sep 2026, section A). A DPDP clock
 * (a request's answer period, the Board's 72-hour detailed report) runs only from commencement; the SPDI one-month
 * grievance clock and the CERT-In 6-hour report apply today. A hospital may shorten a period, never lengthen it past
 * the legal cap.
 *
 * TREATMENT NEEDS NO CONSENT, AND ERASURE DOES NOT ERASE A CHART. s7(f) and s7(g) let a hospital process data for a
 * medical emergency and public health without consent, and s8(7) and s12(3) keep what a law requires to be retained.
 * So erasure withdraws the consents that are not about care, removes the details a patient chose to give, and says
 * plainly that the clinical record is kept and why. A value removed from the current record is still in the record's
 * version history, which is append-only; this file never calls that "erased".
 */

import { GovernanceError, makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { PatientConsent, statusOf as consentStatus, TYPE as CONSENT_TYPE } from "./consent.js";
import { clocksOf, requestClock, lawOn, CITE, HOUR } from "./privacy-law.js";
import { retentionFacts, retentionView, retentionAnswer, LEGAL } from "./retention.js";

const str = (v) => (v == null ? "" : String(v).trim());
const NOTICE = "PrivacyNotice", ACK = "PrivacyAcknowledgement", REQ = "DataPrincipalRequest", BREACH = "DataBreach";
const REQUEST_KINDS = Object.freeze({ access: "s11", correction: "s12", erasure: "s12", grievance: "s13", nomination: "s14" });
const RECEIVED_VIA = Object.freeze(["in-person", "email", "letter", "phone", "portal"]);
const ACK_METHODS = Object.freeze(["given-printed", "read-aloud", "shown-on-screen", "portal"]);
const GIVERS = Object.freeze(["patient", "parent", "legal-guardian", "next-of-kin", "power-of-attorney"]);
/* The consents erasure never withdraws: they are about the patient's care, which s7 does not make depend on consent,
 * and withdrawing a transfusion refusal or a procedure consent on a data request would change clinical facts. */
const CARE_CONSENTS = Object.freeze(["treatment", "blood-products", "procedure"]);
/* Identifiers a patient chooses to give. Linking an ABHA is voluntary; the MR number is not. */
const OPTIONAL_IDENTIFIERS = Object.freeze(["abha-number", "abha-address"]);
/* Owner's guidance of 17 Sep 2026 (item 4): only a period from an identified statutory provision is "required by law".
 * The answer says which classes the law keeps and which the hospital's retention policy keeps, and never calls a policy
 * a legal requirement. */
const RETENTION_REASON = "A record the law requires is kept for the period that law sets, and each such class names the law and provision; the Act allows this: s8(7) and s12(3). A record kept only under the hospital's retention policy is named as policy, not as a legal requirement.";
/* From DPDP commencement, a class kept only under a RETENTION_POLICY layer is the DPO's documented decision: retain,
 * with the purpose or necessity written down, or erase (destroyed or de-identified by the medical records officer). */
const RETENTION_DECISIONS = Object.freeze(["retain", "erase"]);
const isoOrNull = (v) => { const s = str(v); const t = Date.parse(s); return s && Number.isFinite(t) ? new Date(t).toISOString() : null; };
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const stamp = (iso) => iso.replace(/[^0-9]/g, "").slice(0, 17);

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { resolved, svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
/* The patient's own service in the portal: the session proved who they are, and this actor reaches only the four
 * types a patient's privacy page needs, for their own id. */
function patientService(ctx, patientId, write) {
  const actor = makeActor({ id: `patient:${patientId}`, kind: KIND.HUMAN, tier: TIER.DRAFT, scope: { read: [NOTICE, ACK, REQ], write } });
  return new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: { id: ctx.migration.tenantId }, actor, role: "patient-portal", roleSource: "wardsynq-patient-access" });
}
function failure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (ctx) => ({ mode: ctx.migration && ctx.migration.mode, tenantId: (ctx.migration && ctx.migration.tenantId) || null });
const off = (ctx) => !ctx.migration || ctx.migration.mode === "off";
const strip = (r) => { if (!r) return r; const { meta, ...rest } = r; return rest; };

/* ------------------------------------------------------------------ notices */

/* What a notice must itemise before it is published (opinion A.4.4). DPDP Rules 2025 r.3 and Act s.5: the itemised
 * data, the specified purposes, how to withdraw consent, how to exercise the rights and how to complain to the Board.
 * SPDI Rules 2011 r.5(3), in force now and kept after commencement: the recipients and the collecting agency's name and
 * address. The Board complaint line is required once DPDP applies: before then there is no Board to complain to. */
const NOTICE_PARTS = Object.freeze([
  ["dataItems", 10, "an itemised list of the personal data collected (DPDP Rules 2025 r.3)"],
  ["purposes", 10, "the purposes, with the specific services or uses (DPDP Rules 2025 r.3)"],
  ["withdrawConsent", 5, "how to withdraw consent, as easily as it was given (DPDP Rules 2025 r.3)"],
  ["rights", 5, "how to exercise the rights to access, correct, erase and nominate (DPDP Rules 2025 r.3)"],
  ["recipients", 3, "the intended recipients of the data (SPDI Rules 2011 r.5(3))"],
  ["collectingAgency", 10, "the name and address of the hospital collecting the data (SPDI Rules 2011 r.5(3))"],
]);

/** PURE. Validates what the notice must say. Returns { error } or { notice }. law: lawOn(). */
function noticeInput(i, law) {
  const language = str(i.language).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return { error: "language_required", detail: "language must be a language code, e.g. en, hi, te" };
  const parts = {};
  for (const [key, min, what] of NOTICE_PARTS) {
    parts[key] = str(i[key]).slice(0, 4000);
    if (parts[key].length < min) return { error: "notice_part_required", part: key, detail: "the notice must give " + what };
  }
  parts.boardComplaint = str(i.boardComplaint).slice(0, 2000) || null;
  if (law && law.dpdpInForce && (!parts.boardComplaint || parts.boardComplaint.length < 5)) return { error: "notice_part_required", part: "boardComplaint", detail: "the notice must say how to complain to the Data Protection Board (DPDP Rules 2025 r.3)" };
  const dpoContact = str(i.dpoContact);
  if (!dpoContact) return { error: "dpo_contact_required", detail: "the Data Protection Officer or Grievance Officer contact must be published (DPDP Rules 2025 r.9; SPDI Rules 2011 r.5(9))" };
  return { notice: { language, title: str(i.title).slice(0, 200) || null, text: str(i.text).slice(0, 20000) || null, ...parts, dpoContact: dpoContact.slice(0, 300), grievanceContact: str(i.grievanceContact).slice(0, 300) || null } };
}

/** ctx: { migration, language, title?, text?, dataItems, purposes, withdrawConsent, rights, recipients, collectingAgency, boardComplaint?, dpoContact, grievanceContact?, dpdp, actorDeps, recordDeps } */
async function publishNotice(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const law = lawOn(ctx.dpdp, Date.now());
  const v = noticeInput(ctx, law);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, part: v.part || null, detail: v.detail, written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = `wsq-privacy-notice-${v.notice.language}`;
  let current;
  try { current = await svc.get(NOTICE, id); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  const rec = { resourceType: NOTICE, id, ...v.notice, regime: law.regime, publishedBy: resolved.actor.id, publishedAt: new Date().toISOString(), source: { system: "wardsynq-native", sourceId: `privacy-notice:${id}` } };
  try {
    const out = await svc.put(rec, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, notice: { ...strip(rec), version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, actorDeps, recordDeps } - every published notice, newest version of each language. */
async function privacyNotices(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", notices: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, notices: null };
  try {
    const rows = await svc.list(NOTICE, 100);
    return { ...base, ok: true, law: lawOn(ctx.dpdp, Date.now()), notices: rows.filter(Boolean).map(strip).sort((a, b) => a.language.localeCompare(b.language)) };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", notices: null }; }
}

/* ------------------------------------------------------------------ acknowledgements */

/* SPDI Rules 2011 r.5(1), in force now: consent to collecting health data is taken in writing before collection. The
 * desk records which written form it took: a signed paper form (its scan may be a patient document) or an electronic
 * acknowledgement. Whether an electronic acknowledgement satisfies "in writing through letter or fax or email" is on
 * the opinion's list for a lawyer, so the form is recorded rather than assumed. */
const HEALTH_CONSENT_FORMS = Object.freeze(["signed-paper", "e-acknowledged"]);
function ackRecord(patientId, notice, i, by) {
  const at = new Date().toISOString();
  const consent = i.healthDataConsent === true && HEALTH_CONSENT_FORMS.includes(i.consentForm)
    ? { given: true, form: i.consentForm, documentId: str(i.consentDocumentId).slice(0, 200) || null, citation: CITE.spdiConsent } : null;
  return {
    resourceType: ACK, id: `wsq-privacy-ack-${slug(patientId)}-${notice.language}-v${notice.version}`, patientId,
    noticeId: notice.id, noticeVersion: notice.version, language: notice.language,
    method: ACK_METHODS.includes(i.method) ? i.method : null, givenBy: GIVERS.includes(i.givenBy) ? i.givenBy : "patient",
    giverName: str(i.giverName).slice(0, 200) || null, healthDataConsent: consent, recordedBy: by, acknowledgedAt: at,
    source: { system: "wardsynq-native", sourceId: `privacy-ack:${patientId}` },
  };
}
async function writeAck(svc, patientId, language, i, by, idempotencyKey) {
  if (i.healthDataConsent === true && !HEALTH_CONSENT_FORMS.includes(i.consentForm)) return { ok: false, status: 422, error: "consent_form_required", detail: `say how the written consent was taken: ${HEALTH_CONSENT_FORMS.join(" or ")} (SPDI Rules 2011 r.5(1))`, written: 0 };
  const notice = await svc.get(NOTICE, `wsq-privacy-notice-${language}`);
  if (!notice) return { ok: false, status: 409, error: "no_notice_in_language", detail: "No privacy notice is published in this language.", written: 0 };
  const rec = ackRecord(patientId, notice, i, by);
  if (!rec.method) return { ok: false, status: 422, error: "method_required", detail: `method must be one of ${ACK_METHODS.join(", ")}`, written: 0 };
  const current = await svc.get(ACK, rec.id);
  if (current) return { ok: true, written: 0, skipped: "already_acknowledged", acknowledgement: strip(current) };
  const out = await svc.put(rec, { idempotencyKey: idempotencyKey || null });
  return { ok: true, written: 1, acknowledgement: { ...strip(rec), version: out.record.version } };
}

/** ctx: { migration, patientId, language, method, givenBy?, giverName?, actorDeps, recordDeps } */
async function acknowledgePrivacy(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId), language = str(ctx.language).toLowerCase();
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!/^[a-z]{2,3}$/.test(language)) return { ...base, ok: false, status: 422, error: "language_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    if (!(await svc.get("Patient", patientId))) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    return { ...base, ...(await writeAck(svc, patientId, language, ctx, resolved.actor.id, ctx.idempotencyKey)) };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, patientId, actorDeps, recordDeps } */
async function privacyAcknowledgements(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", acknowledgements: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", acknowledgements: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, acknowledgements: null };
  try {
    const rows = await svc.byPatient(ACK, patientId);
    return { ...base, ok: true, patientId, acknowledgements: rows.filter(Boolean).map(strip).sort((a, b) => String(b.acknowledgedAt).localeCompare(String(a.acknowledgedAt))) };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", acknowledgements: null }; }
}

/* ------------------------------------------------------------------ data principal requests */

/** PURE. A new request, with the clock of the law in force on the day it was received (privacy-law.js requestClock). */
function newRequest(i, clocks, by) {
  const kind = str(i.kind);
  if (!REQUEST_KINDS[kind]) return { error: "unknown_kind", detail: `kind must be one of ${Object.keys(REQUEST_KINDS).join(", ")}` };
  const detail = str(i.detail).slice(0, 4000);
  if (detail.length < 5) return { error: "detail_required", detail: "say what the patient is asking for" };
  let nominee = null;
  if (kind === "nomination") {
    const n = i.nominee || {};
    if (!str(n.name) || !str(n.relationship)) return { error: "nominee_required", detail: "s14: name the nominee and their relationship" };
    nominee = { name: str(n.name).slice(0, 200), relationship: str(n.relationship).slice(0, 100), contact: str(n.contact).slice(0, 200) || null };
  }
  const receivedVia = RECEIVED_VIA.includes(i.receivedVia) ? i.receivedVia : null;
  if (!receivedVia) return { error: "received_via_required", detail: `receivedVia must be one of ${RECEIVED_VIA.join(", ")}` };
  const receivedAt = new Date(Date.now()).toISOString();
  const { dueBy, clock } = requestClock(kind, receivedAt, clocks);
  return { request: {
    resourceType: REQ, id: `wsq-dpr-${slug(i.patientId)}-${kind}-${stamp(receivedAt)}`, patientId: str(i.patientId),
    kind, section: REQUEST_KINDS[kind], detail, nominee, receivedVia, receivedAt, receivedBy: by, dueBy, clock,
    state: "received", history: [{ at: receivedAt, by, state: "received" }],
    source: { system: "wardsynq-native", sourceId: `dpr:${str(i.patientId)}` },
  } };
}

/** ctx: { migration, patientId, kind, detail, receivedVia, nominee?, dpdp, actorDeps, recordDeps } */
async function fileDataRequest(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  if (!str(ctx.patientId)) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const v = newRequest(ctx, clocksOf(ctx.dpdp), resolved.actor.id);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, detail: v.detail, written: 0 };
  try {
    if (!(await svc.get("Patient", v.request.patientId))) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    const out = await svc.put(v.request, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, request: { ...strip(v.request), version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/* ERASURE, done for real and reported exactly. Every step is attempted; any step that fails leaves the request in
 * progress with what did and did not happen written on it, and the answer is not ok. */
async function runErasure(svc, req, by, ctx, retained, decisions) {
  const done = { consentsWithdrawn: [], removedFromCurrentRecord: [], registrationDetailsRemoved: [], failures: [] };
  const at = new Date().toISOString();
  let consents = [];
  try { consents = await svc.byPatient(CONSENT_TYPE, req.patientId); } catch (e) { done.failures.push({ step: "read-consents", detail: str(e && e.message) }); }
  for (const c of consents.filter(Boolean)) {
    if (CARE_CONSENTS.includes(c.scope) || consentStatus(c) !== "granted") continue;
    const { meta, version, ...rest } = c;
    try {
      await svc.put(PatientConsent({ ...rest, decision: "withdrawn", withdrawnBy: by, withdrawnAt: at, withdrawalReason: `Erasure request ${req.id} (DPDP Act 2023 s12).` }), { expectedVersion: version });
      done.consentsWithdrawn.push(c.scope);
    } catch (e) { done.failures.push({ step: "withdraw-consent", scope: c.scope, detail: str(e && e.message) }); }
  }
  let patient = null;
  try { patient = await svc.get("Patient", req.patientId); } catch (e) { done.failures.push({ step: "read-patient", detail: str(e && e.message) }); }
  if (patient) {
    const ids = Array.isArray(patient.identifiers) ? patient.identifiers : [];
    const drop = ids.filter((x) => x && OPTIONAL_IDENTIFIERS.includes(x.system));
    if (drop.length) {
      const { meta, version, ...rest } = patient;
      try {
        await svc.put({ ...rest, identifiers: ids.filter((x) => !drop.includes(x)) }, { expectedVersion: version });
        done.removedFromCurrentRecord.push(...drop.map((x) => x.system));
      } catch (e) { done.failures.push({ step: "remove-identifiers", detail: str(e && e.message) }); }
    }
    /* The registration desk's copy (address, district, referral, ABHA link). Passed in by the router so this file
     * holds no storage binding; without it the step is reported as not done, never skipped silently. */
    if (typeof ctx.clearRegistrationDetails === "function") {
      try {
        const r = await ctx.clearRegistrationDetails(patient.mrn);
        if (r && r.ok) done.registrationDetailsRemoved.push(...(r.cleared || []));
        else done.failures.push({ step: "registration-details", detail: str(r && (r.error || r.detail)) || "not removed" });
      } catch (e) { done.failures.push({ step: "registration-details", detail: str(e && e.message) }); }
    } else done.failures.push({ step: "registration-details", detail: "the registration store is not available here" });
  } else if (!done.failures.length) done.failures.push({ step: "read-patient", detail: "patient not found" });
  /* WardSynQ never erases or de-identifies a clinical record itself (records are append-only). A DPO decision to erase a
   * policy-only class is carried out by the medical records officer by hand; until the destruction record's reference
   * is given the request stays open and says so. */
  const byClass = new Map((decisions || []).map((d) => [d.class, d]));
  for (const d of decisions || []) {
    if (d.decision === "erase" && !d.destructionReference) done.failures.push({ step: "erase-class", class: d.class, detail: "WardSynQ does not erase or de-identify a clinical record itself. The medical records officer destroys or de-identifies it and records the destruction; complete the request again with that reference." });
  }
  return {
    ...done,
    /* H.4.5: each class kept, what keeps it (the law and provision, or the hospital's policy) and the date it ends, with
     * the DPO's decision where the policy alone kept it. The consents and details above are what was erased. */
    retained: { what: "clinical-record", reason: RETENTION_REASON, classes: (retained || []).map((x) => compactRetained(x, byClass.get(x.class))) },
    retentionDecisions: decisions ? decisions.map((d) => ({ ...d, decidedBy: by, decidedAt: at })) : null,
    historyNote: "Values removed from the current record stay in its version history, which cannot be edited. They are not erased.",
  };
}

/** PURE. A retained class as written on the request: the dates, the basis and the answer, without each layer's notes. */
function compactRetained(x, decision) {
  const bases = (x.bases || []).map((b) => ({ id: b.id, type: b.type, sourceType: b.sourceType, instrument: b.instrument, provision: b.provision, jurisdiction: b.jurisdiction, until: b.until, inForce: b.inForce, ...(b.notInForce ? { notInForce: b.notInForce } : {}) }));
  return { class: x.class, rule: x.rule, years: x.years, source: x.source, records: x.records, lastAt: x.lastAt || null, keepUntil: x.keepUntil, legalUntil: x.legalUntil || null, policyUntil: x.policyUntil || null,
    basisType: x.basisType || null, policyOnly: !!x.policyOnly, untilProceedingsEnd: !!x.untilProceedingsEnd, minorRule: x.minorRule || null, bases, answer: retentionAnswer(x), decision: decision || null };
}

/**
 * PURE. From DPDP commencement every retained class not kept by a LEGAL_OBLIGATION layer needs the DPO's decision.
 * input: [{ class, decision: retain|erase, reason, destructionReference? }]. Returns { decisions } or { error, needed, missing }.
 */
function retentionDecisionsOf(retained, input) {
  const needed = (retained || []).filter((x) => x.basisType !== LEGAL).map((x) => compactRetained(x));
  const given = new Map((Array.isArray(input) ? input : []).filter((d) => d && typeof d === "object").map((d) => [str(d.class), d]));
  const decisions = [], missing = [];
  for (const n of needed) {
    const d = given.get(n.class) || {};
    const decision = RETENTION_DECISIONS.includes(d.decision) ? d.decision : null, reason = str(d.reason).slice(0, 2000);
    if (!decision || reason.length < 10) { missing.push(n.class); continue; }
    decisions.push({ class: n.class, basisType: n.basisType, keepUntil: n.keepUntil, decision, reason, destructionReference: decision === "erase" ? str(d.destructionReference).slice(0, 300) || null : null });
  }
  if (missing.length) return { error: "retention_decision_required", needed, missing,
    detail: `These records are kept only under the hospital's retention policy, which is not a legal requirement: ${missing.join(", ")}. The DPO decides for each: retain, with the purpose or necessity written down (at least 10 characters), or erase. Nothing was erased; the request stays open.` };
  return { decisions };
}

/** PURE. The contact every answer carries (DPDP Rules 2025 r.9; SPDI Rules 2011 r.5(9)): the published notice's DPO or
 * Grievance Officer, English first. null when no notice names one. */
function responseContactOf(notices) {
  const rows = (notices || []).filter((n) => n && str(n.dpoContact || n.grievanceContact));
  const n = rows.find((x) => x.language === "en") || rows[0];
  return n ? { dpoContact: str(n.dpoContact) || null, grievanceContact: str(n.grievanceContact) || null, noticeId: n.id, noticeVersion: n.version || null } : null;
}

/** ctx: { migration, requestId, action: start|complete|reject, response?, retention, dpdp, retentionDecisions?, actorDeps, recordDeps, clearRegistrationDetails? } */
async function actOnDataRequest(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const action = str(ctx.action), response = str(ctx.response).slice(0, 8000);
  if (!["start", "complete", "reject"].includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", written: 0 };
  if (action !== "start" && response.length < 5) return { ...base, ok: false, status: 422, error: "response_required", detail: "write the answer given to the patient", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(REQ, str(ctx.requestId)); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "request_not_found", written: 0 };
  if (current.state === "completed" || current.state === "rejected") return { ...base, ok: false, status: 409, error: "already_closed", state: current.state, written: 0 };
  let contact = null;
  if (action !== "start") {
    try { contact = responseContactOf(await svc.list(NOTICE, 100)); } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "the published notice could not be read, so the answer cannot carry the DPO contact", written: 0 }; }
    if (!contact) return { ...base, ok: false, status: 409, error: "contact_required", detail: "Every answer carries the Data Protection Officer or Grievance Officer contact (DPDP Rules 2025 r.9; SPDI Rules 2011 r.5(9)). Publish a privacy notice that names one first.", written: 0 };
  }
  let retained = null, decisions = null;
  if (action === "complete" && current.kind === "erasure") {
    /* Nothing is erased on a picture that could not be completed, and nothing under a legal hold (Act s.17(1)(a), (c)). */
    let view;
    try { view = retentionView(await retentionFacts(svc, ctx.recordDeps.repository, ctx.migration.tenantId, current.patientId), ctx.retention, Date.now()); }
    catch (e) { return { ...base, ok: false, status: 502, error: "retention_unreadable", detail: "What the law requires the hospital to keep could not be worked out, so nothing was erased.", written: 0 }; }
    if (view.holds.length) return { ...base, ok: false, status: 409, error: "legal_hold", holds: view.holds, retained: view.retained, detail: "This patient's record is under a legal hold. Nothing was erased; the request stays open.", written: 0 };
    retained = view.retained;
    /* Before commencement the SPDI regime applies and erasure behaves as before, with each basis labelled. */
    if (lawOn(ctx.dpdp, Date.now()).dpdpInForce) {
      const d = retentionDecisionsOf(retained, ctx.retentionDecisions);
      if (d.error) return { ...base, ok: false, status: 409, error: d.error, detail: d.detail, decisionsNeeded: d.needed, missing: d.missing, written: 0 };
      decisions = d.decisions;
    }
  }
  const by = resolved.actor.id, at = new Date().toISOString();
  const { meta, version, ...rest } = current;
  const next = { ...rest, history: [...(current.history || [])] };
  let erasure = null;
  if (action === "start") next.state = "in-progress";
  else if (action === "reject") Object.assign(next, { state: "rejected", response, responseContact: contact, closedAt: at, closedBy: by });
  else {
    if (current.kind === "erasure") erasure = await runErasure(svc, current, by, ctx, retained, decisions);
    const partial = erasure && erasure.failures.length > 0;
    Object.assign(next, partial ? { state: "in-progress", erasureAttempt: { at, by, ...erasure } } : { state: "completed", response, responseContact: contact, closedAt: at, closedBy: by, ...(erasure ? { erasure } : {}) });
  }
  next.history.push({ at, by, state: next.state, action });
  try {
    const out = await svc.put(next, { expectedVersion: version });
    const saved = { ...strip(next), version: out.record.version };
    if (erasure && erasure.failures.length) return { ...base, ok: false, status: 502, error: "erasure_partial", written: 1, request: saved, erasure, detail: "Some of the erasure could not be done. The request stays open and says what was and was not done." };
    return { ...base, ok: true, written: 1, request: saved, ...(erasure ? { erasure } : {}) };
  } catch (e) { return { ...base, ...failure(e, { written: 0, ...(erasure ? { erasure } : {}) }) }; }
}

/** PURE. Overdue against the request's own clock. A request saved before clocks existed has no due date and is not
 * called overdue or on time. */
function withClock(r, nowMs) {
  const open_ = r.state === "received" || r.state === "in-progress";
  const due = Date.parse(r.dueBy || "");
  return { ...r, overdue: open_ && Number.isFinite(due) ? nowMs > due : null };
}

/** PURE. Patients whose every acknowledgement is dated before DPDP commencement (IST day), newest first. */
function renoticeDue(acks, dpdpStart) {
  const start = Date.parse(dpdpStart + "T00:00:00+05:30"), last = new Map();
  for (const a of acks || []) {
    if (!a || !a.patientId) continue;
    const t = Date.parse(a.acknowledgedAt || "");
    if (Number.isFinite(t) && (!last.has(a.patientId) || t > last.get(a.patientId))) last.set(a.patientId, t);
  }
  return [...last].filter(([, t]) => t < start).sort((a, b) => b[1] - a[1]).map(([patientId, t]) => ({ patientId, lastAcknowledgedAt: new Date(t).toISOString() }));
}

/** ctx: { migration, dpdp, actorDeps, recordDeps } - the DPO's queue: requests, breaches, the clocks and the re-notice list. */
async function dpoQueue(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", requests: [], breaches: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: null, breaches: null };
  const nowMs = Date.now(), LIMIT = 1000;
  let reqs, breaches;
  try { [reqs, breaches] = await Promise.all([svc.list(REQ, LIMIT), svc.list(BREACH, LIMIT)]); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", requests: null, breaches: null }; }
  const law = lawOn(ctx.dpdp, nowMs);
  /* Act s.5(2): a patient whose notice was given before commencement gets a fresh one "as soon as it is reasonably
   * practicable" (opinion A.4.4). Listed from commencement; before it the queue is not open. A failed read is false. */
  let renotice = { open: law.dpdpInForce, from: law.dpdpStart, patients: [] };
  if (law.dpdpInForce) {
    try { renotice.patients = renoticeDue(await svc.list(ACK, LIMIT), law.dpdpStart); }
    catch (e) { renotice = false; }
  }
  return {
    ...base, ok: true, clocks: clocksOf(ctx.dpdp, nowMs), law, renotice,
    requests: reqs.filter(Boolean).map(strip).map((r) => withClock(r, nowMs)).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))),
    breaches: breaches.filter(Boolean).map(strip).map((b) => breachClock(b, nowMs)).sort((a, b) => String(b.detectedAt).localeCompare(String(a.detectedAt))),
    truncated: reqs.length >= LIMIT || breaches.length >= LIMIT,
  };
}

/** ctx: { migration, patientId, actorDeps, recordDeps } - what the hospital holds about one patient, by record type
 * (the s11 access answer). Counts only; the DPO opens the chart for the content. */
async function dataHoldings(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", holdings: [] };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", holdings: null };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, holdings: null };
  try {
    const chart = await svc.chart(patientId);
    const holdings = Object.keys(chart).map((type) => ({ type, count: chart[type].length })).filter((h) => h.count > 0).sort((a, b) => a.type.localeCompare(b.type));
    /* What erasure would have to keep, and why. false when it could not be read: never an empty list. */
    let retention;
    try { retention = retentionView(await retentionFacts(svc, ctx.recordDeps.repository, ctx.migration.tenantId, patientId), ctx.retention, Date.now()); } catch (e) { retention = false; }
    return { ...base, ok: true, patientId, holdings, retentionReason: RETENTION_REASON, retention: retention && { retained: retention.retained, holds: retention.holds } };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", holdings: null }; }
}

/* ------------------------------------------------------------------ breaches */

/* The intimation to each affected Data Principal, DPDP Rules 2025 r.7(1)(a) to (e): all five are required before the
 * patients are marked told. The detailed report to the Board, r.7(2)(b): the first five are required; the sixth, the
 * report on the intimations given, is filled from what was recorded about the patients. */
const PRINCIPAL_HEADINGS = Object.freeze(["nature", "consequences", "mitigation", "safetyMeasures", "contact"]);
const BOARD_HEADINGS = Object.freeze(["facts", "circumstances", "mitigation", "findings", "remedial"]);

/** PURE. Lateness of each clock. A clock the law has not started for this breach is null, never "on time". */
function breachClock(b, nowMs) {
  const late = (due, done) => { const d = Date.parse(due || ""); return Number.isFinite(d) ? (done ? Date.parse(done) > d : nowMs > d) : null; };
  const boardDue = b.boardExtendedTo || b.boardDetailedDueBy || b.boardDueBy;
  const shut = b.state === "withdrawn";
  return { ...b, certInLate: shut ? null : late(b.certInDueBy, b.certInReportedAt), boardLate: shut ? null : late(boardDue, b.boardNotifiedAt), principalsLate: shut ? null : late(b.principalsDueBy, b.principalsNotifiedAt) };
}

/** ctx: { migration, detectedAt, awareAt?, description, dataCategories, affectedCount, dpdp, actorDeps, recordDeps } */
async function recordBreach(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const detectedAt = isoOrNull(ctx.detectedAt), description = str(ctx.description).slice(0, 8000);
  if (!detectedAt || Date.parse(detectedAt) > Date.now() + 60000) return { ...base, ok: false, status: 422, error: "detected_at_required", detail: "when the breach was found, not in the future", written: 0 };
  /* r.7 runs from "becoming aware", which may be after the incident was first noticed; stored on its own. */
  const awareAt = ctx.awareAt ? isoOrNull(ctx.awareAt) : detectedAt;
  if (!awareAt || Date.parse(awareAt) < Date.parse(detectedAt) || Date.parse(awareAt) > Date.now() + 60000) return { ...base, ok: false, status: 422, error: "aware_at_invalid", detail: "when the hospital became aware: not before it was found, not in the future", written: 0 };
  if (description.length < 10) return { ...base, ok: false, status: 422, error: "description_required", written: 0 };
  const count = ctx.affectedCount == null || ctx.affectedCount === "" ? null : Number(ctx.affectedCount);
  if (count != null && !(Number.isInteger(count) && count >= 0)) return { ...base, ok: false, status: 422, error: "affected_count_invalid", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const clocks = clocksOf(ctx.dpdp, Date.now()), by = resolved.actor.id, at = new Date().toISOString();
  const awareMs = Date.parse(awareAt);
  /* The Board duty exists only for a breach the hospital became aware of from DPDP commencement. */
  const boardDuty = awareMs >= Date.parse(clocks.law.dpdpStart + "T00:00:00+05:30");
  const rec = {
    resourceType: BREACH, id: `wsq-breach-${stamp(detectedAt)}-${slug(description).slice(0, 24)}`,
    detectedAt, awareAt, description, dataCategories: (Array.isArray(ctx.dataCategories) ? ctx.dataCategories : []).map(str).filter(Boolean).slice(0, 20),
    affectedCount: count, state: "open", recordedBy: by, recordedAt: at,
    certInDueBy: new Date(awareMs + clocks.certInHours * HOUR).toISOString(), certInReportedAt: null, certInReference: null,
    boardDuty, boardInitialAt: null, boardInitialText: null,
    boardDetailedDueBy: boardDuty ? new Date(awareMs + clocks.boardDetailedHours * HOUR).toISOString() : null, boardExtensionRef: null, boardExtendedTo: null,
    principalsDueBy: new Date(awareMs + clocks.breachPrincipalHours * HOUR).toISOString(),
    clock: {
      certInHours: clocks.certInHours, certInCitation: CITE.certIn,
      boardHours: boardDuty ? clocks.boardDetailedHours : null, boardCitation: CITE.dpdpBoard, boardFrom: clocks.law.dpdpStart,
      principalHours: clocks.breachPrincipalHours, principalBasis: "hospital-policy", principalCitation: CITE.dpdpPrincipals, regime: clocks.law.regime,
    },
    assessment: null, boardNotifiedAt: null, boardReference: null, boardReport: null, principalsNotifiedAt: null, principalsNotifiedCount: null, principalsMethod: null, principalIntimation: null,
    notBreachProposal: null, actions: [], history: [{ at, by, event: "recorded" }], source: { system: "wardsynq-native", sourceId: "data-breach" },
  };
  try {
    if (await svc.get(BREACH, rec.id)) return { ...base, ok: false, status: 409, error: "already_recorded", written: 0 };
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, breach: breachClock({ ...strip(rec), version: out.record.version }, Date.now()) };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** PURE. Applies one update to a breach. Returns { error } or { breach }. The times are when it HAPPENED, entered by
 * the person who did it, and may not be before detection or in the future. */
function applyBreachUpdate(b, i, by, nowIso) {
  const event = str(i.event);
  const when = (v) => { const t = isoOrNull(v); return t && Date.parse(t) >= Date.parse(b.detectedAt) && Date.parse(t) <= Date.parse(nowIso) + 60000 ? t : null; };
  const headings = (src, keys) => { const o = {}; for (const k of keys) { o[k] = str(src && src[k]).slice(0, 4000); if (o[k].length < 5) return { missing: k }; } return { value: o }; };
  if (b.state === "closed" || b.state === "withdrawn") return { error: "closed" };
  const next = { ...b, actions: [...(b.actions || [])], history: [...(b.history || [])] };
  if (event === "assess") {
    const text = str(i.assessment).slice(0, 8000);
    if (text.length < 10) return { error: "assessment_required" };
    next.assessment = { text, at: nowIso, by };
  } else if (event === "cert-in-reported") {
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time CERT-In was told: after detection, not in the future" };
    Object.assign(next, { certInReportedAt: at, certInReference: str(i.reference).slice(0, 200) || null });
  } else if (event === "board-initial") {
    /* r.7(2)(a): "without delay", a description of the nature, extent, timing, location and likely impact. */
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time the Board was first told: after detection, not in the future" };
    const text = str(i.text).slice(0, 8000); if (text.length < 10) return { error: "initial_text_required", detail: "the nature, extent, timing, location and likely impact given to the Board (DPDP Rules 2025 r.7(2)(a))" };
    Object.assign(next, { boardInitialAt: at, boardInitialText: text });
  } else if (event === "board-extension") {
    /* r.7(2)(b): the 72 hours move only by "such longer period as the Board may allow on a request made in writing". */
    if (!b.boardDuty) return { error: "no_board_duty", detail: "the Board report duty does not apply to a breach the hospital became aware of before DPDP commencement" };
    const to = isoOrNull(i.extendedTo), ref = str(i.reference).slice(0, 200);
    if (ref.length < 3) return { error: "extension_reference_required", detail: "the Board's reference allowing the longer period" };
    if (!to || !(Date.parse(to) > Date.parse(b.boardDetailedDueBy || b.detectedAt))) return { error: "extension_date_invalid", detail: "the new date must be after the 72-hour deadline" };
    Object.assign(next, { boardExtensionRef: ref, boardExtendedTo: to });
  } else if (event === "board-notified") {
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time the Board was told: after detection, not in the future" };
    const h = headings(i.report, BOARD_HEADINGS); if (h.missing) return { error: "board_report_incomplete", part: h.missing, detail: "the detailed report needs each heading of DPDP Rules 2025 r.7(2)(b)" };
    const intimations = next.principalsNotifiedAt
      ? `Affected patients told on ${next.principalsNotifiedAt}: ${next.principalsNotifiedCount} people, by ${next.principalsMethod || "a method not recorded"}.`
      : "The affected patients have not yet been recorded as told.";
    Object.assign(next, { boardNotifiedAt: at, boardReference: str(i.reference).slice(0, 200) || null, boardReport: { ...h.value, intimations } });
  } else if (event === "principals-notified") {
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time the patients were told: after detection, not in the future" };
    const n = Number(i.count); if (!(Number.isInteger(n) && n >= 0)) return { error: "count_required" };
    const h = headings(i.intimation, PRINCIPAL_HEADINGS); if (h.missing) return { error: "intimation_incomplete", part: h.missing, detail: "what the patients were told needs each heading of DPDP Rules 2025 r.7(1)(a) to (e)" };
    Object.assign(next, { principalsNotifiedAt: at, principalsNotifiedCount: n, principalsMethod: str(i.method).slice(0, 200) || null, principalIntimation: h.value });
  } else if (event === "action") {
    const text = str(i.text).slice(0, 4000); if (text.length < 5) return { error: "action_required" };
    next.actions.push({ text, at: nowIso, by });
  } else if (event === "not-a-breach") {
    /* There is no "not notifiable" state (opinion A.4.2). The only way out without telling anyone is a finding that
     * this was not a personal data breach at all, with reasons, confirmed by a second person. */
    const reasons = str(i.reasons).slice(0, 4000); if (reasons.length < 20) return { error: "reasons_required", detail: "why this was not a personal data breach, in at least 20 characters" };
    next.notBreachProposal = { reasons, by, at: nowIso };
  } else if (event === "confirm-not-a-breach") {
    if (!next.notBreachProposal) return { error: "no_proposal" };
    if (next.notBreachProposal.by === by) return { error: "second_approver_required", detail: "a different person confirms that this was not a personal data breach" };
    Object.assign(next, { state: "withdrawn", withdrawnAt: nowIso, withdrawnBy: by, notBreachProposal: { ...next.notBreachProposal, confirmedBy: by, confirmedAt: nowIso } });
  } else if (event === "close") {
    const summary = str(i.summary).slice(0, 4000);
    if (!next.assessment) return { error: "assessment_required" };
    /* A breach is closed only once everyone the law says must be told has been: CERT-In now, each affected patient,
     * and the Board where its duty applies. */
    const missing = [!next.certInReportedAt && "cert-in", !next.principalsNotifiedAt && "principals", next.boardDuty && !next.boardNotifiedAt && "board"].filter(Boolean);
    if (missing.length) return { error: "notifications_required", missing, detail: "record every notification before closing, or record that this was not a personal data breach" };
    Object.assign(next, { state: "closed", closedAt: nowIso, closedBy: by, closeSummary: summary || null });
  } else return { error: "unknown_event" };
  next.history.push({ at: nowIso, by, event });
  return { breach: next };
}

/** ctx: { migration, breachId, event, ...fields, actorDeps, recordDeps } */
async function updateBreach(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let current;
  try { current = await svc.get(BREACH, str(ctx.breachId)); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  if (!current) return { ...base, ok: false, status: 404, error: "breach_not_found", written: 0 };
  const { meta, version, ...rest } = current;
  const v = applyBreachUpdate(rest, ctx, resolved.actor.id, new Date().toISOString());
  if (v.error) return { ...base, ok: false, status: v.error === "closed" ? 409 : v.error === "unknown_event" ? 400 : 422, error: v.error, detail: v.detail || null, part: v.part || null, missing: v.missing || null, written: 0 };
  try {
    const out = await svc.put(v.breach, { expectedVersion: version });
    return { ...base, ok: true, written: 1, breach: breachClock({ ...v.breach, version: out.record.version }, Date.now()) };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/* ------------------------------------------------------------------ the patient's own portal */

/** session: the verified sessionPatient() result. ctx: { migration, recordDeps, language } */
async function portalPrivacy(ctx, session) {
  const base = baseOf(ctx);
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid" };
  const patientId = str(session.patientId), svc = patientService(ctx, patientId, []);
  try {
    const [notices, acks, reqs] = await Promise.all([svc.list(NOTICE, 100), svc.byPatient(ACK, patientId), svc.byPatient(REQ, patientId)]);
    const lang = str(ctx.language).toLowerCase();
    const pick = (l) => (notices || []).find((n) => n && n.language === l);
    const notice = pick(lang) || pick("en") || null;
    return {
      ...base, ok: true, notice: notice ? strip(notice) : null, languages: (notices || []).filter(Boolean).map((n) => n.language).sort(),
      acknowledged: !!(notice && (acks || []).some((a) => a && a.noticeId === notice.id && a.noticeVersion === notice.version)),
      proxy: !!session.proxy,
      requests: (reqs || []).filter(Boolean).map((r) => ({ id: r.id, kind: r.kind, state: r.state, receivedAt: r.receivedAt, dueBy: r.dueBy, response: r.response || null, closedAt: r.closedAt || null }))
        .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))),
    };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
}

/** ctx: { migration, recordDeps, language } */
async function portalAcknowledge(ctx, session) {
  const base = baseOf(ctx);
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid", written: 0 };
  if (session.proxy) return { ...base, ok: false, status: 403, error: "patient_only", detail: "Only the patient can acknowledge the privacy notice here.", written: 0 };
  const patientId = str(session.patientId), language = str(ctx.language).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return { ...base, ok: false, status: 422, error: "language_required", written: 0 };
  try { return { ...base, ...(await writeAck(patientService(ctx, patientId, [ACK]), patientId, language, { method: "portal", givenBy: "patient" }, `patient:${patientId}`)) }; }
  catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** ctx: { migration, recordDeps, kind, detail, nominee?, dpdp } */
async function portalDataRequest(ctx, session) {
  const base = baseOf(ctx);
  if (!session || !session.ok) return { ...base, ok: false, status: 401, error: "not_valid", written: 0 };
  if (session.proxy) return { ...base, ok: false, status: 403, error: "patient_only", detail: "Only the patient can make this request here.", written: 0 };
  const patientId = str(session.patientId), by = `patient:${patientId}`;
  const v = newRequest({ ...ctx, patientId, receivedVia: "portal" }, clocksOf(ctx.dpdp), by);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, detail: v.detail, written: 0 };
  try {
    await patientService(ctx, patientId, [REQ]).put(v.request);
    return { ...base, ok: true, written: 1, request: { id: v.request.id, kind: v.request.kind, state: v.request.state, receivedAt: v.request.receivedAt, dueBy: v.request.dueBy },
      note: "Your request has reached the hospital's Data Protection Officer." };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

export {
  NOTICE, ACK, REQ, BREACH, REQUEST_KINDS, RECEIVED_VIA, ACK_METHODS, CARE_CONSENTS, OPTIONAL_IDENTIFIERS, RETENTION_REASON, RETENTION_DECISIONS, retentionDecisionsOf, compactRetained,
  clocksOf, noticeInput, newRequest, applyBreachUpdate, withClock, breachClock, responseContactOf, renoticeDue, NOTICE_PARTS, PRINCIPAL_HEADINGS, BOARD_HEADINGS, HEALTH_CONSENT_FORMS,
  publishNotice, privacyNotices, acknowledgePrivacy, privacyAcknowledgements, fileDataRequest, actOnDataRequest, dpoQueue, dataHoldings,
  recordBreach, updateBreach, portalPrivacy, portalAcknowledge, portalDataRequest,
};
