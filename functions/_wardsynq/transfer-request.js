/* functions/_wardsynq/transfer-request.js - asking for a transfer, and the receiving unit's answer.
 *
 * /ward/transfer (migrate-inpatient.js transferPatient) moves a patient at once. Between wards that is
 * usually a conversation first: the sending team asks, the receiving unit accepts or declines, a bed is
 * found, and only then does the patient move. This is that conversation as a record:
 *
 *   requested -> accepted -> bed-assigned -> completed      (the move itself: transferPatient, unchanged)
 *            \-> declined (with a reason)        any open state -> cancelled (with a reason)
 *
 * One TransferRequest record per request, every step a new version (who, when, and why on a decline or a
 * cancel), so the history reads as the conversation. One open request per stay. Executing re-checks that
 * the patient is still where the request said, and the move goes through transferPatient, so the bed
 * collision and bed-state checks are the same ones a direct transfer gets. A move that happened while the
 * request could not be closed is reported as exactly that, never as success.
 *
 * WHO. Asking is a clinical decision (emr.treat). Answering, assigning the bed, moving and cancelling are
 * the bed-management acts /ward/transfer already needs (queue.add). The server does not know which unit a
 * person belongs to, so it does not check that the one accepting works on the receiving ward; it records
 * who did each step.
 *
 * node --test --experimental-test-module-mocks test/wardsynq-stay-flow.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES, OPEN, transferPatient } from "./migrate-inpatient.js";
import { patientLabels, labelKey } from "./patient-label.js";

const XFER_TYPE = "TransferRequest";
const OPEN_STATES = Object.freeze(["requested", "accepted", "bed-assigned"]);
const URGENCY = Object.freeze(["routine", "urgent", "emergency"]);
const UNITS = Object.freeze(["ward", "icu"]);
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const low = (v) => str(v).toLowerCase();

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
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

/**
 * Asks for a transfer. ctx: { migration, encounterId, toUnit, toWard, toBed?, reason, urgency, actorDeps, recordDeps }
 */
async function requestTransfer(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId), toWard = str(ctx.toWard), reason = str(ctx.reason);
  const toUnit = low(ctx.toUnit) || "ward", urgency = low(ctx.urgency);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  if (!UNITS.includes(toUnit)) return { ...base, ok: false, status: 422, error: "unit_invalid", detail: `the destination is one of ${UNITS.join(", ")}`, written: 0 };
  if (!toWard) return { ...base, ok: false, status: 422, error: "ward_required", detail: "name the ward or unit the patient should move to", written: 0 };
  if (!URGENCY.includes(urgency)) return { ...base, ok: false, status: 422, error: "urgency_invalid", detail: `urgency is one of ${URGENCY.join(", ")}`, written: 0 };
  if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the patient needs to move", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let enc, mine;
  try {
    enc = await svc.get("Encounter", encounterId);
    mine = enc ? await svc.byPatient(XFER_TYPE, enc.patientId) : [];
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The stay could not be read, so nothing was requested.", written: 0 };
  }
  if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 };
  if (!ADMISSION_CLASSES.includes(enc.class) || enc.status !== OPEN) return { ...base, ok: false, status: 409, error: "not_admitted", detail: "a transfer is requested for an open inpatient stay", written: 0 };
  const open = (mine || []).find((r) => r && r.encounterId === encounterId && OPEN_STATES.includes(r.status));
  if (open) return { ...base, ok: false, status: 409, error: "transfer_already_requested", detail: `a transfer to ${open.to && open.to.ward} is already ${open.status}`, requestId: open.id, written: 0 };
  const from = { ward: (enc.location && enc.location.ward) || null, bed: (enc.location && enc.location.bed) || null, class: enc.class };
  if (low(from.ward) === low(toWard) && !str(ctx.toBed)) return { ...base, ok: false, status: 422, error: "same_ward", detail: "the patient is already on that ward; name a different ward, or a bed", written: 0 };

  const requestedAt = new Date().toISOString();
  const record = {
    resourceType: XFER_TYPE, id: `wsq-xfer-${slug(encounterId)}-${slug(requestedAt)}`, encounterId, patientId: enc.patientId,
    status: "requested", from, to: { unit: toUnit, ward: toWard, requestedBed: str(ctx.toBed) || null }, reason, urgency,
    requestedBy: resolved.actor.id, requestedAt, steps: [{ status: "requested", by: resolved.actor.id, at: requestedAt }],
    source: { system: "wardsynq-native", sourceId: `transfer-request:${encounterId}` },
  };
  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, requestId: record.id, status: record.status, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) }; }
}

/** Loads a request and applies one step to it. step(req, resolved) returns the changed fields, or { refuse }. */
async function advance(request, env, ctx, step) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const requestId = str(ctx.requestId);
  if (!requestId) return { ...base, ok: false, status: 422, error: "request_required", written: 0 };
  if (!Number.isInteger(ctx.expectedVersion)) return { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version of the request being answered", written: 0 };
  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let req;
  try { req = await svc.get(XFER_TYPE, requestId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The request could not be read, so nothing was changed.", written: 0 };
  }
  if (!req) return { ...base, ok: false, status: 404, error: "request_not_found", written: 0 };
  if (req.version !== ctx.expectedVersion) return { ...base, ok: false, status: 409, error: "version_conflict", detail: "this request changed since it was shown; refresh and look again", version: req.version, status_: req.status, written: 0 };
  const change = await step(req, resolved, svc, base);
  if (change.refuse) return { ...base, ...change.refuse, requestId, written: 0 };
  const at = new Date().toISOString();
  const next = { ...req, ...change.fields, steps: [...(req.steps || []), { status: change.fields.status, by: resolved.actor.id, at, ...(change.note ? { note: change.note } : {}) }] };
  delete next.version;
  try {
    const out = await svc.put(next, { expectedVersion: req.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, requestId, status: next.status, version: out.record.version, actor: resolved.actor.id, ...(change.extra || {}) };
  } catch (e) { return { ...base, ...writeFailure(e, { requestId, written: 0, actor: resolved.actor.id, ...(change.extra || {}) }) }; }
}
const refuseState = (req, allowed) => ({ refuse: { ok: false, status: 409, error: "wrong_state", detail: `this request is ${req.status}; this step needs it to be ${allowed.join(" or ")}` } });

/** ctx: { migration, requestId, decision: "accept"|"decline", reason?, expectedVersion } */
function respondTransfer(request, env, ctx) {
  return advance(request, env, ctx, (req, r) => {
    if (req.status !== "requested") return refuseState(req, ["requested"]);
    const decision = low(ctx.decision), reason = str(ctx.reason), at = new Date().toISOString();
    if (decision === "accept") return { fields: { status: "accepted", acceptedBy: r.actor.id, acceptedAt: at } };
    if (decision !== "decline") return { refuse: { ok: false, status: 422, error: "decision_invalid", detail: "accept or decline" } };
    if (reason.length < 5) return { refuse: { ok: false, status: 422, error: "reason_required", detail: "say why the transfer is declined" } };
    return { fields: { status: "declined", declinedBy: r.actor.id, declinedAt: at, declineReason: reason }, note: reason };
  });
}

/** ctx: { migration, requestId, bed, expectedVersion } - on an accepted request, or to change the bed before the move. */
function assignTransferBed(request, env, ctx) {
  return advance(request, env, ctx, (req, r) => {
    if (req.status !== "accepted" && req.status !== "bed-assigned") return refuseState(req, ["accepted", "bed-assigned"]);
    const bed = str(ctx.bed);
    if (!bed) return { refuse: { ok: false, status: 422, error: "bed_required", detail: "name the bed on the receiving ward" } };
    return { fields: { status: "bed-assigned", bed: { bed, assignedBy: r.actor.id, assignedAt: new Date().toISOString() } } };
  });
}

/** ctx: { migration, requestId, reason, expectedVersion } */
function cancelTransfer(request, env, ctx) {
  return advance(request, env, ctx, (req, r) => {
    if (!OPEN_STATES.includes(req.status)) return refuseState(req, OPEN_STATES);
    const reason = str(ctx.reason);
    if (reason.length < 5) return { refuse: { ok: false, status: 422, error: "reason_required", detail: "say why the request is cancelled" } };
    return { fields: { status: "cancelled", cancelledBy: r.actor.id, cancelledAt: new Date().toISOString(), cancelReason: reason }, note: reason };
  });
}

/**
 * The move. Only a request with a bed assigned; only while the patient is still where the request found
 * them; through transferPatient. ctx: { migration, orgId?, requestId, expectedVersion, emergencyOverride?, ... }
 */
async function executeTransfer(request, env, ctx) {
  let moved = null;
  const out = await advance(request, env, ctx, async (req, r, svc) => {
    if (req.status !== "bed-assigned") return refuseState(req, ["bed-assigned"]);
    let enc;
    try { enc = await svc.get("Encounter", req.encounterId); }
    catch (e) { return { refuse: { ok: false, status: 502, error: "record_read_failed", detail: "The stay could not be read, so the patient was not moved." } }; }
    if (!enc || enc.status !== OPEN) return { refuse: { ok: false, status: 409, error: "not_admitted", detail: "this stay is no longer open; cancel the request" } };
    const here = { ward: (enc.location && enc.location.ward) || null, bed: (enc.location && enc.location.bed) || null };
    if (low(here.ward) !== low(req.from.ward) || low(here.bed) !== low(req.from.bed)) {
      return { refuse: { ok: false, status: 409, error: "moved_since_request", detail: `the patient is now on ${here.ward || "no ward"}${here.bed ? ", bed " + here.bed : ""}, not where this request was made; cancel it and ask again` } };
    }
    moved = await transferPatient(request, env, {
      ...ctx, encounterId: req.encounterId, ward: req.to.ward, bed: req.bed.bed,
      reason: `Transfer request (${req.urgency}): ${req.reason}`, idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:move` : null,
    });
    if (!moved.ok) return { refuse: { ...moved, transferred: false } };
    return { fields: { status: "completed", completedBy: r.actor.id, completedAt: new Date().toISOString(), movedAt: moved.movedAt || null }, extra: { transferred: true, to: moved.to || null, encounterVersion: moved.version || null } };
  });
  // The patient moved but the request was not closed: say so, never success, and never "not moved".
  if (!out.ok && moved && moved.ok) {
    return { ...out, status: 502, error: "request_not_closed", transferred: true, detail: "The patient was moved, but this request could not be marked complete. Refresh; do not move the patient again." };
  }
  return out;
}

/**
 * Open requests (or one stay's requests, closed included). ctx: { migration, ward?, encounterId?, actorDeps, recordDeps }
 * A ward sees a request it sends from and one it receives into.
 */
async function listTransferRequests(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", requests: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, requests: [] };
  const encounterId = str(ctx.encounterId), ward = low(ctx.ward);
  let rows;
  try {
    // Every request (service.listAll, paged; the old read was the OLDEST 2,000, so a new request was missing).
    // past 50,000 it throws (ListCeilingError) rather than answer short. ponytail: audit O20 is the upgrade if paging is slow.
    rows = (await svc.listAll(XFER_TYPE, { max: 50000, throwOnTruncate: true })).rows;
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((x) => x.code), requests: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "Transfer requests could not be read. Do not read this as none.", requests: [] };
  }
  let requests = (rows || []).filter(Boolean);
  requests = encounterId ? requests.filter((q) => q.encounterId === encounterId)
    : requests.filter((q) => OPEN_STATES.includes(q.status) && (!ward || low(q.from && q.from.ward) === ward || low(q.to && q.to.ward) === ward));
  const rank = { emergency: 0, urgent: 1, routine: 2 };
  requests.sort((a, b) => (rank[a.urgency] - rank[b.urgency]) || String(a.requestedAt).localeCompare(String(b.requestedAt)));
  const labels = await patientLabels(svc, requests.map((q) => ({ patientId: q.patientId })));
  requests = requests.map((q) => { const l = labels.get(labelKey({ patientId: q.patientId })) || {}; return { ...q, name: l.name || null, mrn: l.mrn || null }; });
  return { ...base, ok: true, requests };
}

export { XFER_TYPE, OPEN_STATES, URGENCY, UNITS, requestTransfer, respondTransfer, assignTransferBed, cancelTransfer, executeTransfer, listTransferRequests };
