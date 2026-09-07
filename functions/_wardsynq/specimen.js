/* functions/_wardsynq/specimen.js — the sample somebody actually has to take.
 *
 * WardSynQ could order a test and could result one, and between those two acts there was nothing.
 * That gap is not cosmetic: AN ORDER NOBODY COLLECTED LOOKS EXACTLY LIKE AN ORDER AWAITING A RESULT.
 * Both are "requested, no result yet", and only one of them has a nurse who still has to go and do
 * something. Wards lose whole days to that - the round assumes the bloods went, the lab has never
 * heard of the patient, and the first anyone knows is when a decision is waiting on a potassium
 * nobody drew.
 *
 * THREE STATES, AND ONE OF THEM IS A FAILURE THAT STAYS VISIBLE:
 *
 *   collected   somebody took the sample, at a time, and their name is on it
 *   received    the laboratory has it
 *   failed      the attempt did not produce a usable sample - a missed vein, a clotted tube, a
 *               haemolysed one the lab rejected. The order goes back to needing collection, LOUDLY,
 *               rather than sitting as "collected" forever while nobody waits for a result that
 *               is never coming.
 *
 * COLLECTED IS NOT RECEIVED. A tube in a nurse's pocket and a tube on the laboratory bench are
 * different facts, and the space between them is where samples are lost. Collapsing them would let a
 * ward believe the lab has something it has never seen.
 *
 * IT NEVER RESULTS ANYTHING. Nothing here writes an Observation or a DiagnosticReport. Collection is
 * a specimen fact; the result is the laboratory's, through its own authority, and a file that could
 * do both would let whoever draws the blood also say what it showed.
 *
 * NO SPECIMEN TYPE IS INVENTED. The container and the specimen type are what the collector recorded.
 * Nothing here derives "serum" from a test name, because a system that guesses the tube is a system
 * that tells the lab the wrong thing with total confidence.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "SpecimenCollection";

const STATES = Object.freeze(["collected", "received", "failed"]);
/** The ones where somebody is still waiting on a sample. `failed` is outstanding: it needs redoing. */
const OUTSTANDING = Object.freeze(["collected", "failed"]);

function SpecimenCollection(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    serviceRequestId: i.serviceRequestId,
    /* What the collector said it was. Never derived from the test name: a system that guesses the
     * tube tells the laboratory the wrong thing with total confidence. */
    specimenType: i.specimenType || null,
    container: i.container || null,
    state: STATES.includes(i.state) ? i.state : "collected",
    collectedBy: i.collectedBy || null, collectedAt: i.collectedAt || null,
    receivedAt: i.receivedAt || null, receivedBy: i.receivedBy || null,
    failureReason: i.failureReason || null, failedAt: i.failedAt || null,
    // The label a ward and a laboratory read off the tube. Deterministic, so the same collection
    // relabelled is the same specimen and not a second one.
    label: i.label || null,
    source: { system: "wardsynq-native", sourceId: `specimen:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * PURE. One specimen per (request, attempt time).
 *
 * The time is in the id because A SECOND ATTEMPT IS A SECOND SPECIMEN: the first was haemolysed and
 * the second was not, and an id keyed only on the request would overwrite the failure - erasing the
 * fact that the patient was bled twice, which is exactly what a complaint asks about.
 */
function specimenIdFor(serviceRequestId, collectedAt) {
  const r = slug(serviceRequestId), t = slug(collectedAt);
  return r && t ? `wsq-spec-${r}-${t}` : null;
}

/** PURE. Does this request still need somebody to go and take a sample? */
function isOutstanding(s) { return !!s && OUTSTANDING.includes(s.state); }

/**
 * PURE. Where a request stands on collection - the question the ward round actually asks.
 *
 * `none` is the important answer and the reason this file exists: it is what "requested, no result"
 * really means when nobody has been yet, and it is indistinguishable from "waiting on the lab"
 * without this.
 */
function collectionState(specimens) {
  const rows = (specimens || []).filter(Boolean);
  if (!rows.length) return { state: "none", detail: "No sample has been taken for this request." };
  const received = rows.find((s) => s.state === "received");
  if (received) return { state: "received", at: received.receivedAt, specimenId: received.id };
  const collected = rows.filter((s) => s.state === "collected")
    .sort((a, b) => String(b.collectedAt || "").localeCompare(String(a.collectedAt || "")))[0];
  if (collected) return { state: "collected", at: collected.collectedAt, specimenId: collected.id };
  /* Every attempt failed. This is the state that must never read as "in progress": the order needs
   * doing again and nobody is going to be told by a result arriving. */
  const failed = rows.sort((a, b) => String(b.failedAt || "").localeCompare(String(a.failedAt || "")))[0];
  return { state: "failed", attempts: rows.length, reason: failed.failureReason || null, detail: "Every attempt failed. This sample still needs taking." };
}

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

function summary(s) {
  return {
    specimenId: s.id, serviceRequestId: s.serviceRequestId, patientId: s.patientId,
    specimenType: s.specimenType || null, container: s.container || null, label: s.label || null,
    state: s.state, outstanding: isOutstanding(s),
    collectedBy: s.collectedBy, collectedAt: s.collectedAt,
    receivedAt: s.receivedAt || null, receivedBy: s.receivedBy || null,
    failureReason: s.failureReason || null, failedAt: s.failedAt || null,
    version: s.version,
  };
}

/** A sample was taken. ctx: { migration, serviceRequestId, specimenType?, container?, at?, ... } */
async function collectSpecimen(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const serviceRequestId = str(ctx.serviceRequestId);
  if (!serviceRequestId) return { ...base, ok: false, status: 422, error: "request_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let sr;
  try { sr = await svc.get("ServiceRequest", serviceRequestId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  // A sample is never taken against an order that does not exist: that is how an unlabelled tube
  // reaches a laboratory with a request number nobody can match.
  if (!sr) return { ...base, ok: false, status: 404, error: "request_not_found", serviceRequestId, written: 0 };
  if (sr.status === "revoked" || sr.status === "completed") {
    return { ...base, ok: false, status: 409, error: "request_not_open", detail: `this request is ${sr.status}`, serviceRequestId, written: 0 };
  }

  const at = str(ctx.at) || new Date().toISOString();
  const id = specimenIdFor(serviceRequestId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch { current = null; }
  if (current) return { ...base, ok: true, written: 0, skipped: "already_collected", ...summary(current) };

  const record = SpecimenCollection({
    id, patientId: sr.patientId, encounterId: sr.encounterId || null, serviceRequestId,
    specimenType: str(ctx.specimenType) || null, container: str(ctx.container) || null,
    state: "collected", collectedBy: resolved.actor.id, collectedAt: at,
    label: id,
  });
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...record, version: out.record.version }),
      /* Said every time, because the gap between these two is where samples are lost. */
      note: "Collected. The laboratory has not received it yet, and no result has been produced.",
      ...(record.specimenType ? {} : { warning: "No specimen type was recorded. Nothing here guesses one from the test name." }),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { specimenId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The laboratory has it, or the attempt failed.
 * ctx: { migration, specimenId, state: "received" | "failed", failureReason?, ... }
 */
async function specimenOutcome(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const specimenId = str(ctx.specimenId), state = str(ctx.state);
  if (!specimenId) return { ...base, ok: false, status: 422, error: "specimen_required", written: 0 };
  if (state !== "received" && state !== "failed") {
    return { ...base, ok: false, status: 400, error: "unknown_state", detail: "state must be received or failed", written: 0 };
  }
  const failureReason = str(ctx.failureReason);
  // A failure with no reason cannot be acted on, and "take it again" is the action.
  if (state === "failed" && !failureReason) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why - missed vein, clotted, haemolysed, insufficient - so the ward knows what to do differently", written: 0 };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, specimenId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "specimen_not_found", specimenId, written: 0 };
  /* RECEIVED IS TERMINAL. The laboratory said it has the sample; a later "failed" is a statement
   * about the ASSAY, not the specimen, and it belongs on the result. */
  if (current.state === "received") return { ...base, ok: true, written: 0, skipped: "already_received", ...summary(current) };

  const now = new Date().toISOString();
  const next = SpecimenCollection({
    ...current, state,
    receivedAt: state === "received" ? now : current.receivedAt,
    receivedBy: state === "received" ? resolved.actor.id : current.receivedBy,
    failureReason: state === "failed" ? failureReason : current.failureReason,
    failedAt: state === "failed" ? now : current.failedAt,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }),
      ...(state === "failed" ? { note: "This sample still needs taking. The request is not waiting on a result." } : {}),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { specimenId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The collection worklist: every open request for this patient, and where its sample is.
 * ctx: { migration, patientId, ... }
 */
async function collectionList(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", requests: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", requests: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: [] };

  let orders, specimens;
  try {
    [orders, specimens] = await Promise.all([
      svc.byPatient("ServiceRequest", patientId),
      svc.byPatient(TYPE, patientId).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), requests: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), requests: [] };
  }

  const byRequest = new Map();
  for (const s of specimens || []) {
    if (!s) continue;
    const k = str(s.serviceRequestId);
    byRequest.set(k, [...(byRequest.get(k) || []), s]);
  }

  const requests = (orders || [])
    .filter((o) => o && o.status !== "revoked" && o.status !== "completed")
    .map((o) => ({
      serviceRequestId: o.id, code: o.code, display: o.display || o.code, category: o.category || null,
      requestedAt: (o.meta && o.meta.recordedAt) || null,
      collection: collectionState(byRequest.get(str(o.id))),
    }))
    /* Uncollected first, then failed, then collected, then received. The top of this list is work
     * somebody has to do; the bottom is work that is done. */
    .sort((a, b) => ({ none: 0, failed: 1, collected: 2, received: 3 })[a.collection.state] - ({ none: 0, failed: 1, collected: 2, received: 3 })[b.collection.state]);

  return {
    ...base, ok: true, patientId, requests,
    /* THE NUMBER THE WARD ROUND NEEDS. Without it an order nobody has been to looks exactly like one
     * waiting on the laboratory. */
    awaitingCollection: requests.filter((r) => r.collection.state === "none" || r.collection.state === "failed").length,
    inTransit: requests.filter((r) => r.collection.state === "collected").length,
  };
}

export { TYPE, STATES, OUTSTANDING, SpecimenCollection, specimenIdFor, isOutstanding, collectionState, collectSpecimen, specimenOutcome, collectionList };
