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
 * WHAT IS NOT LAW HERE. The Act leaves response times and the breach reporting window to the Rules. The DPDP Rules
 * 2025 text was not confirmed when this was built, so no time is hard-coded: every clock is the hospital's own
 * setting (wardsynq.dpdp), returned with `confirmed: false`, and with no setting there is no due date at all rather
 * than an invented one.
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
const RETENTION_REASON = "Medical records must be kept for as long as the law requires. The Act allows this: s8(7) and s12(3).";
const CLOCK_NOTE = "Hospital-set. The DPDP Rules 2025 times were not confirmed when this was built; check them before relying on these.";

/** PURE. The hospital's clocks, sanitised. Nothing invented: an unset clock is null. */
function clocksOf(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const n = (v, max) => { const x = Number(v); return Number.isInteger(x) && x > 0 && x <= max ? x : null; };
  const days = {};
  for (const k of Object.keys(REQUEST_KINDS)) days[k] = n(c.responseDays && c.responseDays[k], 365);
  return { responseDays: days, breachBoardHours: n(c.breachBoardHours, 720), breachPrincipalHours: n(c.breachPrincipalHours, 720), confirmed: false, note: CLOCK_NOTE };
}
const addMs = (iso, ms) => (ms == null ? null : new Date(Date.parse(iso) + ms).toISOString());
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

/** PURE. Validates what s5 needs a notice to be able to say. Returns { error } or { notice }. */
function noticeInput(i) {
  const language = str(i.language).toLowerCase();
  if (!/^[a-z]{2,3}$/.test(language)) return { error: "language_required", detail: "language must be a language code, e.g. en, hi, te" };
  const text = str(i.text);
  if (text.length < 50) return { error: "text_required", detail: "write the notice: the data collected, why, how to withdraw consent, how to raise a grievance and how to complain to the Board" };
  const dpoContact = str(i.dpoContact);
  if (!dpoContact) return { error: "dpo_contact_required", detail: "s8(9): the Data Protection Officer's contact must be published" };
  return { notice: { language, title: str(i.title).slice(0, 200) || null, text: text.slice(0, 20000), dpoContact: dpoContact.slice(0, 300), grievanceContact: str(i.grievanceContact).slice(0, 300) || null } };
}

/** ctx: { migration, language, title?, text, dpoContact, grievanceContact?, actorDeps, recordDeps } */
async function publishNotice(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const v = noticeInput(ctx);
  if (v.error) return { ...base, ok: false, status: 422, error: v.error, detail: v.detail, written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const id = `wsq-privacy-notice-${v.notice.language}`;
  let current;
  try { current = await svc.get(NOTICE, id); } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
  const rec = { resourceType: NOTICE, id, ...v.notice, publishedBy: resolved.actor.id, publishedAt: new Date().toISOString(), source: { system: "wardsynq-native", sourceId: `privacy-notice:${id}` } };
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
    return { ...base, ok: true, notices: rows.filter(Boolean).map(strip).sort((a, b) => a.language.localeCompare(b.language)) };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", notices: null }; }
}

/* ------------------------------------------------------------------ acknowledgements */

function ackRecord(patientId, notice, i, by) {
  const at = new Date().toISOString();
  return {
    resourceType: ACK, id: `wsq-privacy-ack-${slug(patientId)}-${notice.language}-v${notice.version}`, patientId,
    noticeId: notice.id, noticeVersion: notice.version, language: notice.language,
    method: ACK_METHODS.includes(i.method) ? i.method : null, givenBy: GIVERS.includes(i.givenBy) ? i.givenBy : "patient",
    giverName: str(i.giverName).slice(0, 200) || null, recordedBy: by, acknowledgedAt: at,
    source: { system: "wardsynq-native", sourceId: `privacy-ack:${patientId}` },
  };
}
async function writeAck(svc, patientId, language, i, by, idempotencyKey) {
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

/** PURE. A new request, with the hospital's clock applied (or none). */
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
  const receivedAt = new Date().toISOString();
  const days = clocks.responseDays[kind];
  return { request: {
    resourceType: REQ, id: `wsq-dpr-${slug(i.patientId)}-${kind}-${stamp(receivedAt)}`, patientId: str(i.patientId),
    kind, section: REQUEST_KINDS[kind], detail, nominee, receivedVia, receivedAt, receivedBy: by,
    dueBy: addMs(receivedAt, days ? days * 86400000 : null), clock: { days, basis: "hospital-set", confirmed: false },
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
async function runErasure(svc, req, by, ctx) {
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
  return {
    ...done,
    retained: { what: "clinical-record", reason: RETENTION_REASON },
    historyNote: "Values removed from the current record stay in its version history, which cannot be edited. They are not erased.",
  };
}

/** ctx: { migration, requestId, action: start|complete|reject, response?, actorDeps, recordDeps, clearRegistrationDetails? } */
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
  const by = resolved.actor.id, at = new Date().toISOString();
  const { meta, version, ...rest } = current;
  const next = { ...rest, history: [...(current.history || [])] };
  let erasure = null;
  if (action === "start") next.state = "in-progress";
  else if (action === "reject") Object.assign(next, { state: "rejected", response, closedAt: at, closedBy: by });
  else {
    if (current.kind === "erasure") erasure = await runErasure(svc, current, by, ctx);
    const partial = erasure && erasure.failures.length > 0;
    Object.assign(next, partial ? { state: "in-progress", erasureAttempt: { at, by, ...erasure } } : { state: "completed", response, closedAt: at, closedBy: by, ...(erasure ? { erasure } : {}) });
  }
  next.history.push({ at, by, state: next.state, action });
  try {
    const out = await svc.put(next, { expectedVersion: version });
    const saved = { ...strip(next), version: out.record.version };
    if (erasure && erasure.failures.length) return { ...base, ok: false, status: 502, error: "erasure_partial", written: 1, request: saved, erasure, detail: "Some of the erasure could not be done. The request stays open and says what was and was not done." };
    return { ...base, ok: true, written: 1, request: saved, ...(erasure ? { erasure } : {}) };
  } catch (e) { return { ...base, ...failure(e, { written: 0, ...(erasure ? { erasure } : {}) }) }; }
}

/** PURE. Overdue is computed against the hospital's clock, never invented where there is none. */
function withClock(r, nowMs) {
  const open_ = r.state === "received" || r.state === "in-progress";
  const due = Date.parse(r.dueBy || "");
  return { ...r, overdue: open_ && Number.isFinite(due) ? nowMs > due : null };
}

/** ctx: { migration, dpdp, actorDeps, recordDeps } - the DPO's queue: requests, breaches and the clocks. */
async function dpoQueue(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", requests: [], breaches: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: null, breaches: null };
  const nowMs = Date.now(), LIMIT = 1000;
  let reqs, breaches;
  try { [reqs, breaches] = await Promise.all([svc.list(REQ, LIMIT), svc.list(BREACH, LIMIT)]); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", requests: null, breaches: null }; }
  return {
    ...base, ok: true, clocks: clocksOf(ctx.dpdp),
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
    return { ...base, ok: true, patientId, holdings, retentionReason: RETENTION_REASON };
  } catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", holdings: null }; }
}

/* ------------------------------------------------------------------ breaches */

function breachClock(b, nowMs) {
  const late = (due, done) => { const d = Date.parse(due || ""); return Number.isFinite(d) ? (done ? Date.parse(done) > d : nowMs > d) : null; };
  return { ...b, boardLate: late(b.boardDueBy, b.boardNotifiedAt), principalsLate: late(b.principalsDueBy, b.principalsNotifiedAt) };
}

/** ctx: { migration, detectedAt, description, dataCategories, affectedCount, dpdp, actorDeps, recordDeps } */
async function recordBreach(request, env, ctx) {
  const base = baseOf(ctx);
  if (off(ctx)) return { ...base, ok: true, skipped: "off", written: 0 };
  const detectedAt = isoOrNull(ctx.detectedAt), description = str(ctx.description).slice(0, 8000);
  if (!detectedAt || Date.parse(detectedAt) > Date.now() + 60000) return { ...base, ok: false, status: 422, error: "detected_at_required", detail: "when the breach was found, not in the future", written: 0 };
  if (description.length < 10) return { ...base, ok: false, status: 422, error: "description_required", written: 0 };
  const count = ctx.affectedCount == null || ctx.affectedCount === "" ? null : Number(ctx.affectedCount);
  if (count != null && !(Number.isInteger(count) && count >= 0)) return { ...base, ok: false, status: 422, error: "affected_count_invalid", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const clocks = clocksOf(ctx.dpdp), by = resolved.actor.id, at = new Date().toISOString();
  const rec = {
    resourceType: BREACH, id: `wsq-breach-${stamp(detectedAt)}-${slug(description).slice(0, 24)}`,
    detectedAt, description, dataCategories: (Array.isArray(ctx.dataCategories) ? ctx.dataCategories : []).map(str).filter(Boolean).slice(0, 20),
    affectedCount: count, state: "open", recordedBy: by, recordedAt: at,
    boardDueBy: addMs(detectedAt, clocks.breachBoardHours ? clocks.breachBoardHours * 3600000 : null),
    principalsDueBy: addMs(detectedAt, clocks.breachPrincipalHours ? clocks.breachPrincipalHours * 3600000 : null),
    clock: { boardHours: clocks.breachBoardHours, principalHours: clocks.breachPrincipalHours, basis: "hospital-set", confirmed: false },
    assessment: null, boardNotifiedAt: null, boardReference: null, principalsNotifiedAt: null, principalsNotifiedCount: null, principalsMethod: null,
    actions: [], history: [{ at, by, event: "recorded" }], source: { system: "wardsynq-native", sourceId: "data-breach" },
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
  if (b.state === "closed") return { error: "closed" };
  const next = { ...b, actions: [...(b.actions || [])], history: [...(b.history || [])] };
  if (event === "assess") {
    const text = str(i.assessment).slice(0, 8000);
    if (text.length < 10) return { error: "assessment_required" };
    next.assessment = { text, at: nowIso, by };
  } else if (event === "board-notified") {
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time the Board was told: after detection, not in the future" };
    Object.assign(next, { boardNotifiedAt: at, boardReference: str(i.reference).slice(0, 200) || null });
  } else if (event === "principals-notified") {
    const at = when(i.at); if (!at) return { error: "time_invalid", detail: "the time the patients were told: after detection, not in the future" };
    const n = Number(i.count); if (!(Number.isInteger(n) && n >= 0)) return { error: "count_required" };
    Object.assign(next, { principalsNotifiedAt: at, principalsNotifiedCount: n, principalsMethod: str(i.method).slice(0, 200) || null });
  } else if (event === "action") {
    const text = str(i.text).slice(0, 4000); if (text.length < 5) return { error: "action_required" };
    next.actions.push({ text, at: nowIso, by });
  } else if (event === "close") {
    const summary = str(i.summary).slice(0, 4000);
    /* Closing without both notifications needs a stated reason: a breach closed silently without telling anyone is
     * exactly what s8(6) is written against. */
    if ((!next.boardNotifiedAt || !next.principalsNotifiedAt) && summary.length < 20) return { error: "reason_required", detail: "the Board or the patients were not recorded as told: say why in at least 20 characters" };
    if (!next.assessment) return { error: "assessment_required" };
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
  if (v.error) return { ...base, ok: false, status: v.error === "closed" ? 409 : v.error === "unknown_event" ? 400 : 422, error: v.error, detail: v.detail || null, written: 0 };
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
  NOTICE, ACK, REQ, BREACH, REQUEST_KINDS, RECEIVED_VIA, ACK_METHODS, CARE_CONSENTS, OPTIONAL_IDENTIFIERS, RETENTION_REASON,
  clocksOf, noticeInput, newRequest, applyBreachUpdate, withClock, breachClock,
  publishNotice, privacyNotices, acknowledgePrivacy, privacyAcknowledgements, fileDataRequest, actOnDataRequest, dpoQueue, dataHoldings,
  recordBreach, updateBreach, portalPrivacy, portalAcknowledge, portalDataRequest,
};
