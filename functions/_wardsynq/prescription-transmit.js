/* functions/_wardsynq/prescription-transmit.js — sending a prescription somewhere, and knowing it arrived.
 *
 * WardSynQ could write a prescription and print it. It could not send one, and more importantly it
 * had no way to know whether one that was sent ever arrived. Those are two different features and
 * the second is the one that matters: a prescription that silently failed to transmit is a patient
 * who goes to the pharmacy and is told there is nothing for them.
 *
 * TRANSMISSION IS A DELIVERY FACT, NOT A CLINICAL ONE. Sending does not change the prescription. The
 * MedicationOrder is untouched by everything in this file - no status change, no annotation - because
 * "we sent this" is a statement about a message, not about the treatment. A file that quietly moved
 * an order to "completed" on transmission would be saying the patient had their medicine.
 *
 * NOTHING IS EVER MARKED SENT BECAUSE IT WAS SUBMITTED. The states here are deliberately: queued ->
 * sent -> acknowledged, and FAILED at any point. `sent` means the transport reported it left;
 * `acknowledged` means the far end said it has it. Collapsing those two is how a system tells a
 * clinician a prescription is at the pharmacy when it is sitting in an outbox.
 *
 * A FAILURE IS LOUD AND STAYS LOUD. It does not retry forever into silence and it does not clear
 * itself. An undelivered prescription is on the outstanding list until a human deals with it,
 * because the fallback - printing it and handing it over - needs a person to decide to do it.
 *
 * IT TRANSMITS WHAT WAS PRESCRIBED, AND NOTHING ELSE. The payload is built from the stored order at
 * the version it was read, and the version travels with it. If the prescriber changes the dose
 * afterwards, what was sent is still what was sent, and the record shows both.
 *
 * NO TRANSPORT IS IMPLEMENTED HERE, and that is deliberate rather than unfinished. Real
 * e-prescribing is a national network with its own certification, credentials and message format -
 * NCPDP SCRIPT, an HIE, a state registry - and inventing a fake one would produce a system that
 * looked connected and delivered nothing. This records the intent, the outcome and the evidence; a
 * site plugs its own transport into the outbox.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { sendTransmission } from "./transmit-send.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "PrescriptionTransmission";

/** Where a transmission is. `sent` and `acknowledged` are deliberately not the same thing. */
const STATES = Object.freeze(["queued", "sent", "acknowledged", "failed"]);
/** The ones that still need somebody. */
const OUTSTANDING = Object.freeze(["queued", "sent", "failed"]);

/** Where it is going. `print` is a first-class destination, not a failure to have a network. */
const CHANNELS = Object.freeze(["pharmacy", "patient", "print", "external-system"]);

function PrescriptionTransmission(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    orderId: i.orderId,
    /* The version of the order that was sent. If the prescriber changes the dose afterwards, what
     * was sent is still what was sent - and the record shows both. */
    orderVersion: Number.isFinite(i.orderVersion) ? i.orderVersion : null,
    channel: CHANNELS.includes(i.channel) ? i.channel : "print",
    destination: i.destination || null,
    state: STATES.includes(i.state) ? i.state : "queued",
    /* The payload AS SENT, kept verbatim. A transmission record whose content could be regenerated
     * from the current order would answer "what does the order say now", not "what did they get". */
    payload: i.payload || null,
    reference: i.reference || null,      // the far end's own id for it, when it gives one
    failureReason: i.failureReason || null,
    attempts: Number.isFinite(i.attempts) ? i.attempts : 0,
    queuedBy: i.queuedBy || null, queuedAt: i.queuedAt || null,
    sentAt: i.sentAt || null, acknowledgedAt: i.acknowledgedAt || null,
    lastAttemptAt: i.lastAttemptAt || null,
    resolvedBy: i.resolvedBy || null, resolvedAt: i.resolvedAt || null, resolution: i.resolution || null,
    source: { system: "wardsynq-native", sourceId: `transmission:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** One transmission per (order version, channel). Re-sending the same version to the same place is
 *  the same transmission; sending a CHANGED order is a new one. */
function transmissionIdFor(orderId, orderVersion, channel) {
  const o = slug(orderId), c = slug(channel);
  /* `Number(null)` is 0 and 0 is finite, so a missing version would have silently become "v0" - an
   * id that reads as "version zero was sent" when the truth is that nobody knows which version was.
   * It would also collide with a genuine v0. The version is required, and absence is null. */
  if (orderVersion === null || orderVersion === undefined || orderVersion === "") return null;
  const v = Number(orderVersion);
  return o && c && Number.isFinite(v) ? `wsq-tx-${o}-v${v}-${c}` : null;
}

/**
 * PURE. The payload for one order. Built from the STORED order, never from a caller's copy.
 *
 * It carries what a dispenser needs to dispense safely and nothing more: no notes, no diagnosis, no
 * chart. A prescription sent with the patient's whole history attached is a privacy incident waiting
 * to be one, and none of it helps somebody count out tablets.
 */
function payloadFor(order, patient) {
  if (!order) return null;
  const p = patient || {};
  return {
    prescription: {
      drug: order.drug,
      drugCode: order.drugCode || null,
      drugCodeSystem: order.drugCode ? (order.drugCodeSystem || "unspecified") : null,
      dose: order.dose || null,
      route: order.route || null,
      frequency: order.frequency || null,
      stopAt: order.stopAt || null,
      prescriberId: order.prescriberId || null,
      // Which version of the order this is, so a pharmacy holding two can tell them apart.
      orderId: order.id, orderVersion: order.version,
    },
    patient: {
      // The minimum that identifies the right person at a counter, and no clinical content at all.
      name: p.name || null, mrn: p.mrn || null, dob: p.dob || null, sex: p.sex || null,
    },
  };
}

/** PURE. Does this transmission still need a human? */
function isOutstanding(t) { return !!t && OUTSTANDING.includes(t.state) && !t.resolvedAt; }

async function open(request, env, ctx, need) {
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
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

function summary(t) {
  return {
    transmissionId: t.id, orderId: t.orderId, orderVersion: t.orderVersion,
    channel: t.channel, destination: t.destination || null, state: t.state,
    reference: t.reference || null, failureReason: t.failureReason || null, attempts: t.attempts || 0,
    queuedBy: t.queuedBy, queuedAt: t.queuedAt, sentAt: t.sentAt || null, acknowledgedAt: t.acknowledgedAt || null,
    resolvedBy: t.resolvedBy || null, resolvedAt: t.resolvedAt || null, resolution: t.resolution || null,
    outstanding: isOutstanding(t), version: t.version,
  };
}

/** Queues a prescription for sending. ctx: { migration, orderId, channel, destination?, ... } */
async function queueTransmission(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const orderId = str(ctx.orderId);
  const channel = str(ctx.channel) || "print";
  if (!orderId) return { ...base, ok: false, status: 422, error: "order_required", written: 0 };
  if (!CHANNELS.includes(channel)) return { ...base, ok: false, status: 400, error: "unknown_channel", detail: `channel must be one of ${CHANNELS.join(", ")}`, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let order, patient;
  try {
    order = await svc.get("MedicationOrder", orderId);
    patient = order ? await svc.get("Patient", order.patientId).catch(() => null) : null;
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId, written: 0 };
  // A draft or cancelled order is not sent anywhere. Only a live prescription travels.
  if (order.status !== "active") return { ...base, ok: false, status: 409, error: "order_not_active", detail: `this order is ${order.status}`, orderId, written: 0 };

  const id = transmissionIdFor(orderId, order.version, channel);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch { current = null; }
  // Re-queueing something already acknowledged is not a resend: the far end has it.
  if (current && current.state === "acknowledged") {
    return { ...base, ok: true, written: 0, skipped: "already_acknowledged", ...summary(current) };
  }

  const now = new Date().toISOString();
  const tx = PrescriptionTransmission({
    id, patientId: order.patientId, encounterId: order.encounterId || null,
    orderId, orderVersion: order.version, channel, destination: str(ctx.destination) || null,
    state: "queued", payload: payloadFor(order, patient),
    attempts: current ? current.attempts : 0,
    queuedBy: (current && current.queuedBy) || resolved.actor.id,
    queuedAt: (current && current.queuedAt) || now,
  });
  try {
    const out = await svc.put(tx, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...tx, version: out.record.version }),
      /* Said on every response, because the distinction is the whole point: QUEUED is not SENT. */
      note: "Queued. Nothing has been transmitted yet, and the order is unchanged.",
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { transmissionId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Records what the transport reported.
 * ctx: { migration, transmissionId, state, reference?, failureReason?, actorDeps, recordDeps }
 */
async function recordOutcome(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const transmissionId = str(ctx.transmissionId);
  const state = str(ctx.state);
  if (!transmissionId) return { ...base, ok: false, status: 422, error: "transmission_required", written: 0 };
  if (!STATES.includes(state) || state === "queued") {
    return { ...base, ok: false, status: 400, error: "unknown_state", detail: `state must be one of ${STATES.filter((s) => s !== "queued").join(", ")}`, written: 0 };
  }
  const failureReason = str(ctx.failureReason);
  // A failure with no reason cannot be acted on, and acting on it is the entire point.
  if (state === "failed" && !failureReason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why it failed, so somebody can act on it", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, transmissionId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "transmission_not_found", transmissionId, written: 0 };
  /* ACKNOWLEDGED IS TERMINAL. The far end said it has the prescription; nothing after that can
   * un-say it, and a later "failed" would be a message about a different attempt. */
  if (current.state === "acknowledged") return { ...base, ok: true, written: 0, skipped: "already_acknowledged", ...summary(current) };

  const now = new Date().toISOString();
  const next = PrescriptionTransmission({
    ...current, state,
    reference: str(ctx.reference) || current.reference,
    failureReason: state === "failed" ? failureReason : null,
    attempts: (current.attempts || 0) + 1,
    lastAttemptAt: now,
    sentAt: state === "sent" || state === "acknowledged" ? (current.sentAt || now) : current.sentAt,
    acknowledgedAt: state === "acknowledged" ? now : current.acknowledgedAt,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { transmissionId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * A human deals with a stuck or failed transmission - usually by printing it and handing it over.
 * ctx: { migration, transmissionId, resolution, actorDeps, recordDeps }
 */
async function resolveTransmission(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const transmissionId = str(ctx.transmissionId), resolution = str(ctx.resolution);
  if (!transmissionId) return { ...base, ok: false, status: 422, error: "transmission_required", written: 0 };
  // Clearing it off the list without saying what was done would leave a patient with no prescription
  // and no trace of why nobody chased it.
  if (!resolution) return { ...base, ok: false, status: 422, error: "resolution_required", detail: "say what was done instead - printed and handed over, re-sent, cancelled", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, transmissionId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "transmission_not_found", transmissionId, written: 0 };
  if (current.resolvedAt) return { ...base, ok: true, written: 0, skipped: "already_resolved", ...summary(current) };

  const next = PrescriptionTransmission({
    ...current, resolvedBy: resolved.actor.id, resolvedAt: new Date().toISOString(), resolution,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    // The state is NOT changed to acknowledged: it was never acknowledged, and saying so would put a
    // delivery that did not happen on the record.
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { transmissionId, written: 0, actor: resolved.actor.id }) };
  }
}

/** The outbox. ctx: { migration, patientId?, outstandingOnly?, actorDeps, recordDeps } */
async function listTransmissions(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", transmissions: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, transmissions: [] };

  let rows;
  try {
    rows = str(ctx.patientId) ? await svc.byPatient(TYPE, str(ctx.patientId)) : await svc.list(TYPE, 300);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), transmissions: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), transmissions: [] };
  }

  const RANK = { failed: 0, queued: 1, sent: 2, acknowledged: 3 };
  const transmissions = (rows || []).filter(Boolean).map(summary)
    .filter((t) => (ctx.outstandingOnly ? t.outstanding : true))
    .sort((a, b) => (RANK[a.state] - RANK[b.state]) || String(a.queuedAt || "").localeCompare(String(b.queuedAt || "")));
  return {
    ...base, ok: true, transmissions,
    /* A FAILURE STAYS LOUD. It does not retry into silence and does not clear itself: an undelivered
     * prescription is a patient who goes to the pharmacy and is told there is nothing for them. */
    outstanding: transmissions.filter((t) => t.outstanding).length,
    failed: transmissions.filter((t) => t.state === "failed" && !t.resolvedAt).length,
  };
}

/**
 * Sends a queued transmission and records what the transport reported.
 *
 * The transport (transmit-send.js) performs the HTTP and decides nothing; this records the outcome
 * through `recordOutcome`, so the state machine keeps exactly ONE author. A second writer would be a
 * second opinion about what "delivered" means.
 *
 * ctx: { migration, transmissionId, endpoints, fetchImpl?, actorDeps, recordDeps }
 */
async function sendQueued(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", sent: 0 };

  const transmissionId = str(ctx.transmissionId);
  if (!transmissionId) return { ...base, ok: false, status: 422, error: "transmission_required", sent: 0 };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, sent: 0 };

  let current;
  try { current = await svc.get(TYPE, transmissionId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), sent: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "transmission_not_found", transmissionId, sent: 0 };

  /* ACKNOWLEDGED IS TERMINAL and re-sending one would duplicate a prescription the far end has
   * already confirmed it holds. Refused here as well as in recordOutcome, because by the time
   * recordOutcome saw it the message would already have gone out. */
  if (current.state === "acknowledged") {
    return { ...base, ok: true, sent: 0, skipped: "already_acknowledged", ...summary(current),
      note: "The far end has already confirmed it holds this prescription. Sending again would duplicate it." };
  }

  const report = await sendTransmission({
    channel: current.channel, payload: current.payload, endpoints: ctx.endpoints, fetchImpl: ctx.fetchImpl,
  });

  /* NOTHING RECORDED unless the transport is certain. `indeterminate` and "no endpoint configured"
   * both leave the transmission exactly as it was: still queued, still outstanding, still a human's
   * to resolve. Writing `failed` here would invite a re-send that duplicates a prescription; writing
   * `sent` would lose one silently. */
  if (!report.attempted || report.outcome === "indeterminate") {
    return { ...base, ok: !!report.ok, sent: 0, ...summary(current), transport: report,
      note: report.note || report.detail };
  }

  const outcome = await recordOutcome(request, env, {
    ...ctx,
    transmissionId,
    state: report.outcome,
    ...(report.outcome === "failed" ? { failureReason: report.detail } : {}),
  });
  return { ...outcome, sent: report.outcome === "sent" ? 1 : 0, transport: report };
}

export {
  TYPE, STATES, OUTSTANDING, CHANNELS, PrescriptionTransmission,
  transmissionIdFor, payloadFor, isOutstanding,
  queueTransmission, recordOutcome, resolveTransmission, listTransmissions, sendQueued,
};
