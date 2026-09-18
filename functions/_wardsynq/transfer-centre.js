/* functions/_wardsynq/transfer-centre.js - a patient another hospital asks us to take.
 *
 * A nursing home or a smaller hospital rings: they have a patient who needs our ICU, our cath lab, our surgeon. The
 * call was taken on paper, the answer given by whoever picked up, and nobody could say how long the referring doctor
 * waited for a yes or a no, or what the beds looked like when the answer was no. One TransferCentreRequest per call:
 *
 *   requested -> accepted (a consultant; an admission request is made)      requested -> declined (a consultant, why)
 *   requested -> cancelled (the referring hospital withdrew, why)
 *
 * NO PATIENT RECORD IS MADE FROM A PHONE CALL. The request holds what the caller said about the patient (age, sex, the
 * referring hospital's own reference and the clinical summary), not an identity. Accepting needs the MRN of a patient
 * registered through the ordinary registration, which is where the duplicate and identity checks already live; if the
 * registered sex or age does not match what the caller said, the consultant has to confirm it is the same person.
 *
 * ACCEPTING MAKES AN ADMISSION REQUEST AND NEVER A BED. The acceptance goes through admission-request.js
 * requestAdmission(), so the patient joins the same waiting list as anybody else and no bed is held (that file's own
 * invariant). The capacity the consultant saw (beds by state per ward, and how many are already waiting) is copied onto
 * the request at the moment of the decision, so a decline can later be read against the beds of that moment.
 *
 * Time to decision is computed from the stored times, never stored.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-discharge-capacity.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { patientIdForMrn } from "./opd-identity.js";
import { requestAdmission } from "./admission-request.js";
import { listBeds, listWards } from "../_opd_org_store.js";
import { patientLabels, labelKey } from "./patient-label.js";
import { median } from "./discharge-milestones.js";

const TCR_TYPE = "TransferCentreRequest";
const URGENCY = Object.freeze(["emergency", "urgent", "routine"]);
const UNITS = Object.freeze(["ward", "icu"]);
const SEXES = Object.freeze(["male", "female", "other"]);
/* The waiting list's own words for how soon (admission-request.js URGENCY). A routine transfer is "soon", not elective:
 * another hospital is holding the patient until we take them. */
const ADMISSION_URGENCY = Object.freeze({ emergency: "emergency", urgent: "urgent", routine: "soon" });
const str = (v) => (v == null ? "" : String(v).trim());
const ms = (t) => { const v = Date.parse(str(t)); return Number.isFinite(v) ? v : null; };

async function openService(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this request changed since it was shown; refresh and look again", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

/** PURE. Minutes from the call to the answer, or null while it is unanswered. */
function minutesToDecision(req) {
  const a = ms(req && req.receivedAt), d = ms(req && req.decidedAt);
  return a == null || d == null || d < a ? null : Math.round((d - a) / 60000);
}

/** PURE. Beds by state per ward from the hospital's own bed master; null when it could not be read, never zeros. */
function capacityFrom(wards, beds, waiting, atIso) {
  const byWard = new Map((wards || []).map((w) => [w.id, { ward: w.name || w.id, type: w.type || "general", available: 0, reserved: 0, occupied: 0, other: 0, total: 0 }]));
  for (const b of beds || []) {
    if (!b || b.active === false) continue;
    if (!byWard.has(b.wardId)) byWard.set(b.wardId, { ward: b.wardId, type: "general", available: 0, reserved: 0, occupied: 0, other: 0, total: 0 });
    const w = byWard.get(b.wardId);
    w.total += 1;
    if (b.state === "available" || b.state === "reserved" || b.state === "occupied") w[b.state] += 1; else w.other += 1;
  }
  const list = beds == null ? null : [...byWard.values()].filter((w) => w.total > 0);
  return {
    at: atIso,
    wards: list,
    bedsAvailable: list ? list.reduce((n, w) => n + w.available, 0) : null,
    waitingForBed: Number.isFinite(waiting) ? waiting : null,
  };
}

/** Reads the capacity of this moment. Never throws; an unreadable part is null. */
async function capacityNow(env, orgId, svc, nowIso) {
  const [wards, beds, waiting] = await Promise.all([
    orgId ? listWards(env, orgId).catch(() => null) : Promise.resolve(null),
    orgId ? listBeds(env, orgId).catch(() => null) : Promise.resolve(null),
    // R4-2: every request (listAll; was the oldest 500), null when unread or past 50,000.
    svc.listAll("AdmissionRequest", { max: 50000, throwOnTruncate: true }).then((g) => g.rows.filter((x) => x && x.state === "waiting").length, () => null),
  ]);
  return capacityFrom(wards || [], beds, waiting, nowIso);
}

/**
 * Records the call. ctx: { migration, facility, contactName?, contactPhone?, facilityRef?, ageYears?, sex?,
 * clinicalSummary, requestedService, requestedUnit?, urgency, receivedAt?, now?, actorDeps, recordDeps }
 */
async function createInboundTransfer(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const facility = str(ctx.facility), summary = str(ctx.clinicalSummary), service = str(ctx.requestedService);
  const urgency = str(ctx.urgency).toLowerCase(), unit = str(ctx.requestedUnit).toLowerCase() || "ward", sex = str(ctx.sex).toLowerCase();
  const nowMs = ms(ctx.now) || Date.now();
  if (!facility) return { ...base, ok: false, status: 422, error: "facility_required", detail: "name the hospital asking", written: 0 };
  if (summary.length < 10) return { ...base, ok: false, status: 422, error: "summary_required", detail: "give the clinical summary the referring doctor gave", written: 0 };
  if (!service) return { ...base, ok: false, status: 422, error: "service_required", detail: "say which specialty or service is asked for", written: 0 };
  if (!URGENCY.includes(urgency)) return { ...base, ok: false, status: 422, error: "urgency_invalid", detail: `urgency is one of ${URGENCY.join(", ")}`, written: 0 };
  if (!UNITS.includes(unit)) return { ...base, ok: false, status: 422, error: "unit_invalid", detail: `the unit is one of ${UNITS.join(", ")}`, written: 0 };
  if (sex && !SEXES.includes(sex)) return { ...base, ok: false, status: 422, error: "sex_invalid", written: 0 };
  let age = null;
  if (str(ctx.ageYears) !== "") { age = Number(ctx.ageYears); if (!Number.isInteger(age) || age < 0 || age > 130) return { ...base, ok: false, status: 422, error: "age_invalid", written: 0 }; }
  const receivedMs = str(ctx.receivedAt) ? ms(ctx.receivedAt) : nowMs;
  if (receivedMs == null || receivedMs > nowMs + 5 * 60000) return { ...base, ok: false, status: 422, error: "received_at_invalid", detail: "the time the call came in, not a time still to come", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const receivedAt = new Date(receivedMs).toISOString();
  const record = {
    resourceType: TCR_TYPE, id: `wsq-tcr-${nowMs.toString(36)}-${crypto.randomUUID().slice(0, 8)}`, patientId: null,
    status: "requested", facility, contactName: str(ctx.contactName).slice(0, 120) || null, contactPhone: str(ctx.contactPhone).slice(0, 20) || null,
    facilityRef: str(ctx.facilityRef).slice(0, 60) || null, ageYears: age, sex: sex || null,
    clinicalSummary: summary.slice(0, 4000), requestedService: service.slice(0, 120), requestedUnit: unit, urgency,
    receivedAt, takenBy: resolved.actor.id, steps: [{ status: "requested", by: resolved.actor.id, at: new Date(nowMs).toISOString() }],
    source: { system: "wardsynq-native", sourceId: "transfer-centre" },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, requestId: record.id, status: record.status, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** Loads a requested request, checking the version the screen showed. Returns { svc, resolved, req } or { refuse }. */
async function loadOpen(request, env, ctx, base) {
  const requestId = str(ctx.requestId);
  if (!requestId) return { refuse: { ...base, ok: false, status: 422, error: "request_required", written: 0 } };
  if (!Number.isInteger(ctx.expectedVersion)) return { refuse: { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version of the request being answered", written: 0 } };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { refuse: { ...base, ...error, written: 0 } };
  let req;
  try { req = await svc.get(TCR_TYPE, requestId); }
  catch (e) {
    if (e instanceof GovernanceError) return { refuse: { ...base, ...writeFailure(e, { written: 0 }) } };
    return { refuse: { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The request could not be read, so nothing was changed.", written: 0 } };
  }
  if (!req) return { refuse: { ...base, ok: false, status: 404, error: "request_not_found", written: 0 } };
  if (req.version !== ctx.expectedVersion) return { refuse: { ...base, ok: false, status: 409, error: "version_conflict", detail: "this request changed since it was shown; refresh and look again", version: req.version, written: 0 } };
  if (req.status !== "requested") return { refuse: { ...base, ok: false, status: 409, error: "wrong_state", detail: `this request is already ${req.status}`, written: 0 } };
  return { svc, resolved, req };
}
function nextVersion(req, fields, by, at, note) {
  const next = { ...req, ...fields, steps: [...(req.steps || []), { status: fields.status, by, at, ...(note ? { note } : {}) }] };
  delete next.version; delete next.meta;
  return next;
}

/** PURE. What differs between what the caller said and the registered patient, or []. */
function identityMismatch(req, patient, nowMs) {
  const out = [];
  const said = str(req.sex).charAt(0), reg = str(patient && patient.sex).toLowerCase().charAt(0);
  if ((said === "m" || said === "f") && (reg === "m" || reg === "f") && said !== reg) out.push("sex");
  const dob = ms(patient && patient.dob);
  if (Number.isInteger(req.ageYears) && dob != null && Math.abs((nowMs - dob) / (365.25 * 86400000) - req.ageYears) > 2) out.push("age");
  return out;
}

/**
 * A consultant's answer. ctx: { migration, orgId?, requestId, decision: accept|decline, reason?, mrn? (accept),
 * identityConfirmed?, expectedVersion, now?, actorDeps, recordDeps }
 */
async function decideInboundTransfer(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const decision = str(ctx.decision).toLowerCase(), reason = str(ctx.reason);
  if (decision !== "accept" && decision !== "decline") return { ...base, ok: false, status: 422, error: "decision_invalid", detail: "accept or decline", written: 0 };
  if (decision === "decline" && reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the transfer is declined", written: 0 };
  const patientId = decision === "accept" ? patientIdForMrn(str(ctx.mrn)) : null;
  if (decision === "accept" && !patientId) return { ...base, ok: false, status: 422, error: "mrn_required", detail: "register the patient first, then give the MRN", written: 0 };

  const loaded = await loadOpen(request, env, ctx, base);
  if (loaded.refuse) return loaded.refuse;
  const { svc, resolved, req } = loaded;
  const nowMs = ms(ctx.now) || Date.now(), at = new Date(nowMs).toISOString();
  const capacity = await capacityNow(env, ctx.orgId, svc, at);

  if (decision === "decline") {
    const next = nextVersion(req, { status: "declined", decidedBy: resolved.actor.id, decidedAt: at, declineReason: reason, capacityAtDecision: capacity }, resolved.actor.id, at, reason);
    try {
      const out = await svc.put(next, { expectedVersion: req.version, idempotencyKey: ctx.idempotencyKey || null });
      return { ...base, ok: true, written: 1, requestId: req.id, status: "declined", minutesToDecision: minutesToDecision(next), capacityAtDecision: capacity, version: out.record.version, actor: resolved.actor.id };
    } catch (e) { return { ...base, ...writeFailure(e, { requestId: req.id, written: 0, actor: resolved.actor.id }) }; }
  }

  let patient;
  try { patient = await svc.get("Patient", patientId); }
  catch (e) { return { ...base, ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "governance" : "record_read_failed", written: 0 }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", detail: "no patient is registered with that MRN; register the patient first", written: 0 };
  const mismatch = identityMismatch(req, patient, nowMs);
  if (mismatch.length && ctx.identityConfirmed !== true) {
    return { ...base, ok: false, status: 409, error: "identity_mismatch", mismatch, detail: `the registered patient's ${mismatch.join(" and ")} does not match what the referring hospital said. Confirm this is the same person.`, written: 0 };
  }

  /* The admission request's time is the call's time, so a retry after a failed update finds the same request
   * (admission-request.js requestIdFor) instead of putting the patient on the list twice. */
  const adm = await requestAdmission(request, env, {
    ...ctx, mrn: str(ctx.mrn), specialty: req.requestedService, ward: req.requestedUnit === "icu" ? "ICU" : null,
    reason: `Inbound transfer from ${req.facility}: ${req.clinicalSummary}`.slice(0, 1000), urgency: ADMISSION_URGENCY[req.urgency] || "soon",
    requestedAt: req.receivedAt, idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:adm` : null,
  });
  if (!adm.ok) return { ...base, ...adm, error: adm.error || "admission_request_failed", written: 0 };
  const next = nextVersion(req, {
    status: "accepted", patientId, mrn: str(ctx.mrn), decidedBy: resolved.actor.id, decidedAt: at, admissionRequestId: adm.requestId,
    capacityAtDecision: capacity, identityConfirmed: mismatch.length ? { mismatch, by: resolved.actor.id, at } : null,
  }, resolved.actor.id, at, null);
  try {
    const out = await svc.put(next, { expectedVersion: req.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1 + (adm.written || 0), requestId: req.id, status: "accepted", admissionRequestId: adm.requestId, bedReserved: false,
      minutesToDecision: minutesToDecision(next), capacityAtDecision: capacity, version: out.record.version, actor: resolved.actor.id,
      note: "Accepted. The patient is on the waiting list for a bed; no bed is reserved." };
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "request_not_closed", admissionRequestId: adm.requestId, written: adm.written || 0,
      detail: "The patient was put on the waiting list, but this transfer could not be marked accepted. Refresh and accept it again; the waiting list will not take the patient twice." };
  }
}

/** The referring hospital withdrew. ctx: { migration, requestId, reason, expectedVersion } */
async function cancelInboundTransfer(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const reason = str(ctx.reason);
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the request is withdrawn", written: 0 };
  const loaded = await loadOpen(request, env, ctx, base);
  if (loaded.refuse) return loaded.refuse;
  const { svc, resolved, req } = loaded;
  const at = new Date().toISOString();
  const next = nextVersion(req, { status: "cancelled", cancelledBy: resolved.actor.id, cancelledAt: at, cancelReason: reason }, resolved.actor.id, at, reason);
  try {
    const out = await svc.put(next, { expectedVersion: req.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, requestId: req.id, status: "cancelled", version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { requestId: req.id, written: 0, actor: resolved.actor.id }) }; }
}

/**
 * Open requests first (the most urgent, then the longest waiting), then those answered in the last `days`, with the
 * capacity of this moment. ctx: { migration, orgId?, days?, now?, actorDeps, recordDeps }
 */
async function listInboundTransfers(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", open: [], decided: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, open: null, decided: null };
  const nowMs = ms(ctx.now) || Date.now(), days = Math.min(90, Math.max(1, Number(ctx.days) || 30));
  let rows;
  // Every request (service.listAll, paged; the old read was the OLDEST 2,000, so a new referral was missing).
  // past 50,000 it throws (ListCeilingError) rather than answer short. ponytail: audit O20 is the upgrade if paging is slow.
  try { rows = (await svc.listAll(TCR_TYPE, { max: 50000, throwOnTruncate: true })).rows.filter(Boolean); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", open: null, decided: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "Transfer centre requests could not be read. Do not read this as none.", open: null, decided: null };
  }
  const rank = (u) => URGENCY.indexOf(u);
  const shape = (q) => ({ ...q, minutesToDecision: minutesToDecision(q), minutesWaiting: q.status === "requested" && ms(q.receivedAt) != null ? Math.max(0, Math.round((nowMs - ms(q.receivedAt)) / 60000)) : null });
  const open = rows.filter((q) => q.status === "requested").sort((a, b) => (rank(a.urgency) - rank(b.urgency)) || String(a.receivedAt).localeCompare(String(b.receivedAt))).map(shape);
  const fromMs = nowMs - days * 86400000;
  let decided = rows.filter((q) => q.status !== "requested" && ms(q.decidedAt || q.cancelledAt) != null && ms(q.decidedAt || q.cancelledAt) >= fromMs)
    .sort((a, b) => String(b.decidedAt || b.cancelledAt).localeCompare(String(a.decidedAt || a.cancelledAt))).map(shape);
  const labels = await patientLabels(svc, decided.filter((q) => q.patientId).map((q) => ({ patientId: q.patientId })));
  decided = decided.map((q) => { const l = q.patientId ? labels.get(labelKey({ patientId: q.patientId })) || {} : {}; return { ...q, name: l.name || null }; });
  const answered = decided.filter((q) => q.status === "accepted" || q.status === "declined");
  return {
    ...base, ok: true, days, open, decided: decided.slice(0, 200),
    summary: {
      accepted: answered.filter((q) => q.status === "accepted").length, declined: answered.filter((q) => q.status === "declined").length,
      cancelled: decided.filter((q) => q.status === "cancelled").length, medianMinutesToDecision: median(answered.map((q) => q.minutesToDecision)),
    },
    capacityNow: await capacityNow(env, ctx.orgId, svc, new Date(nowMs).toISOString()),
    truncated: false,
  };
}

export { TCR_TYPE, URGENCY, UNITS, ADMISSION_URGENCY, minutesToDecision, capacityFrom, identityMismatch, createInboundTransfer, decideInboundTransfer, cancelInboundTransfer, listInboundTransfers };
