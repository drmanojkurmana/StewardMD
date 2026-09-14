/* functions/_wardsynq/referral.js — one patient sent from one clinician to another, and back.
 *
 * `requested -> accepted -> scheduled -> seen -> responded -> closed`, with `declined` and `cancelled`
 * as the two ways out before the patient is seen.
 *
 * A REFERRAL THAT NOBODY OWNS IS THE HAZARD. The paper version fails the same way every time: a letter
 * is written, handed over, and neither side knows whether the patient was ever seen. So every referral
 * has exactly one state at a time, every change is a new version with who, when and why, and the
 * referring clinician's list shows what is still open on their side - including the ones that were
 * declined, which are the ones most likely to be forgotten.
 *
 * ACCEPTING IS SOMEONE ELSE'S ACT. The referrer may not accept, schedule, see or respond to their own
 * referral; those belong to the receiving side. The referrer may cancel before it is accepted, and
 * closes it once the response is back. An EXTERNAL referral (another facility) has no receiving user
 * here, so its steps are recorded by staff on that facility's behalf and marked as such.
 *
 * NOTHING IS CLOSED AUTOMATICALLY. A response does not close the referral: the referrer reads it and
 * closes, because "the other team replied" and "I have acted on the reply" are different facts.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const TYPE = "Referral";
const str = (v) => (v == null ? "" : String(v).trim());
const URGENCY = Object.freeze(["emergency", "urgent", "routine"]);
const KINDS = Object.freeze(["internal", "external"]);
const OPEN = Object.freeze(["requested", "accepted", "scheduled", "seen", "responded"]);

/* PURE. action -> { from: allowed states, to, by: "receiver" | "referrer", needs: [fields] } */
const ACTIONS = Object.freeze({
  accept:   { from: ["requested"], to: "accepted", by: "receiver" },
  decline:  { from: ["requested"], to: "declined", by: "receiver", needs: ["reason"] },
  schedule: { from: ["accepted", "scheduled"], to: "scheduled", by: "receiver", needs: ["appointmentAt"] },
  seen:     { from: ["accepted", "scheduled"], to: "seen", by: "receiver" },
  respond:  { from: ["seen"], to: "responded", by: "receiver", needs: ["response"] },
  close:    { from: ["responded", "declined"], to: "closed", by: "referrer" },
  cancel:   { from: ["requested"], to: "cancelled", by: "referrer", needs: ["reason"] },
});

class ReferralError extends Error { constructor(code, message) { super(message); this.code = code; } }

/**
 * PURE. The next state of a referral after `action` by `actorId`, or a ReferralError saying why not.
 * input: { action, actorId, at, reason?, appointmentAt?, response?, onBehalfOf? }
 */
function applyReferralAction(ref, input) {
  const i = input || {};
  const a = ACTIONS[i.action];
  if (!a) throw new ReferralError("unknown_action", `"${i.action}" is not something a referral can do`);
  if (!a.from.includes(ref.status)) throw new ReferralError("bad_transition", `a ${ref.status} referral cannot be ${a.to}`);
  const isReferrer = i.actorId === ref.referringProvider;
  if (a.by === "receiver" && isReferrer && ref.kind === "internal") {
    throw new ReferralError("referrer_cannot_receive", "the clinician who made the referral cannot also accept, schedule, see or answer it");
  }
  if (a.by === "referrer" && !isReferrer) {
    throw new ReferralError("only_referrer", "only the clinician who made the referral can " + i.action + " it");
  }
  for (const f of a.needs || []) if (!str(i[f])) throw new ReferralError(f + "_required", `${i.action} needs ${f}`);
  if (a.needs && a.needs.includes("appointmentAt") && isNaN(new Date(i.appointmentAt).getTime())) throw new ReferralError("bad_appointment", "the appointment time is not a date");
  const event = { action: i.action, status: a.to, at: i.at, by: i.actorId,
    ...(ref.kind === "external" && a.by === "receiver" ? { onBehalfOf: ref.destinationFacility, recordedByStaff: true } : {}),
    ...(i.reason ? { reason: str(i.reason) } : {}) };
  return {
    ...ref, status: a.to,
    ...(a.to === "accepted" ? { receivingProvider: ref.kind === "internal" ? i.actorId : ref.receivingProvider } : {}),
    ...(i.appointmentAt && a.to === "scheduled" ? { appointmentAt: new Date(i.appointmentAt).toISOString() } : {}),
    ...(a.to === "responded" ? { response: str(i.response), respondedBy: i.actorId, respondedAt: i.at } : {}),
    ...(a.to === "declined" ? { declineReason: str(i.reason) } : {}),
    ...(a.to === "cancelled" ? { cancelReason: str(i.reason) } : {}),
    ...(a.to === "closed" ? { closedAt: i.at } : {}),
    history: [...(ref.history || []), event],
  };
}

/** PURE. A new referral from what the referrer entered, or a ReferralError. */
function newReferral(input) {
  const i = input || {};
  const kind = KINDS.includes(i.kind) ? i.kind : "internal";
  if (!str(i.patientId)) throw new ReferralError("patient_required", "a referral is for a patient");
  if (!str(i.specialty)) throw new ReferralError("specialty_required", "say which specialty the patient is referred to");
  if (!str(i.reason)) throw new ReferralError("reason_required", "say why the patient is referred");
  if (!str(i.clinicalSummary)) throw new ReferralError("summary_required", "a referral without a clinical summary makes the receiving team start from nothing");
  if (kind === "external" && !str(i.destinationFacility)) throw new ReferralError("facility_required", "an external referral needs the facility it goes to");
  return {
    resourceType: TYPE, id: i.id, patientId: str(i.patientId), encounterId: str(i.encounterId) || null,
    kind, specialty: str(i.specialty), urgency: URGENCY.includes(i.urgency) ? i.urgency : "routine",
    reason: str(i.reason), clinicalSummary: str(i.clinicalSummary),
    referringProvider: i.actorId, receivingProvider: str(i.receivingProvider) || null,
    destinationFacility: kind === "external" ? str(i.destinationFacility) : null,
    attachments: Array.isArray(i.attachments) ? i.attachments.map(str).filter(Boolean).slice(0, 20) : [],
    status: "requested", requestedAt: i.at, appointmentAt: null, response: null,
    history: [{ action: "request", status: "requested", at: i.at, by: i.actorId }],
  };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}
function failure(e, extra) {
  if (e instanceof ReferralError) return { ok: false, status: 422, error: e.code, detail: e.message, ...extra };
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: "this referral changed since you opened it - reload it", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

async function createReferral(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const at = new Date().toISOString();
  let ref;
  try {
    ref = newReferral({ ...ctx.input, actorId: resolved.actor.id, at, id: `wsq-ref-${str(ctx.input && ctx.input.patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}` });
    const patient = await svc.get("Patient", ref.patientId);
    if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    for (const docId of ref.attachments) {
      const d = await svc.get("DocumentReference", docId);
      if (!d || d.patientId !== ref.patientId) return { ...base, ok: false, status: 422, error: "attachment_not_this_patient", detail: `document ${docId} is not on this patient's record`, written: 0 };
    }
    const out = await svc.put(ref, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, referral: { ...ref, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

async function actOnReferral(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  try {
    const cur = await svc.get(TYPE, str(ctx.referralId));
    if (!cur) return { ...base, ok: false, status: 404, error: "referral_not_found", written: 0 };
    if (ctx.expectedVersion != null && Number(ctx.expectedVersion) !== cur.version) throw new VersionConflictError("stale");
    const next = applyReferralAction(cur, { ...ctx.input, actorId: resolved.actor.id, at: new Date().toISOString() });
    delete next.version;
    const out = await svc.put(next, { expectedVersion: cur.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, referral: { ...next, version: out.record.version } };
  } catch (e) { return { ...base, ...failure(e, { written: 0 }) }; }
}

/** One patient's referrals, newest first. */
async function patientReferrals(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", referrals: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try {
    const rows = await svc.byPatient(TYPE, str(ctx.patientId));
    return { ...base, ok: true, referrals: (rows || []).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))) };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
}

const INBOX_CAP = 500;
/**
 * The hospital's open referrals: "to my specialty" for the receiving side, "sent by me" for the
 * referrer. Emergency first, then oldest first. A full scan page is reported as partial.
 */
async function referralInbox(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", referrals: [] };
  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try {
    const rows = await svc.list(TYPE, INBOX_CAP);
    const specialty = str(ctx.specialty).toLowerCase();
    const mine = ctx.view === "sent";
    const rank = (u) => URGENCY.indexOf(u);
    const out = (rows || [])
      .filter((r) => OPEN.includes(r.status) || (mine && r.status === "declined"))
      .filter((r) => (mine ? r.referringProvider === resolved.actor.id : (!specialty || r.specialty.toLowerCase() === specialty)))
      .sort((a, b) => rank(a.urgency) - rank(b.urgency) || String(a.requestedAt).localeCompare(String(b.requestedAt)));
    return { ...base, ok: true, referrals: out, partial: (rows || []).length >= INBOX_CAP, ...(rows && rows.length >= INBOX_CAP ? { partialWarning: `Only the latest ${INBOX_CAP} referrals were checked; older open ones may be missing.` } : {}) };
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
}

export { TYPE, ACTIONS, URGENCY, OPEN, ReferralError, applyReferralAction, newReferral, createReferral, actOnReferral, patientReferrals, referralInbox };
