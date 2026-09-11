/* functions/_wardsynq/resource-booking.js — the room, the theatre and the scanner.
 *
 * scheduling.js books a CLINICIAN's time. This books a PLACE or a MACHINE, and the difference is not
 * cosmetic:
 *
 *   A CLINICIAN'S DIARY MAY BE OVERBOOKED. Real clinics overbook, a system that refuses is worked
 *   around, and scheduling.js therefore ALLOWS it as a deliberate, recorded act.
 *
 *   A ROOM MAY NOT. Two patients cannot be inside one CT scanner, and no amount of "deliberate"
 *   makes them fit. Offering an override here would produce a diary that says two people are in a
 *   place only one of them can be in - which is worse than no diary, because the ward acts on it.
 *
 * So the clash is a REFUSAL, always, and it names the booking already there. A refusal a scheduler
 * cannot act on is one they will work around with a paper list.
 *
 * A RESOURCE THE HOSPITAL DOES NOT HAVE CANNOT BE BOOKED. The list is org configuration, like the
 * beds and the order sets. Accepting a booking against a made-up room is how a patient is sent
 * somewhere that does not exist, and nobody finds out until they are standing in a corridor.
 *
 * CANCELLING FREES IT IMMEDIATELY AND KEEPS THE HISTORY, exactly as an appointment does: "it was
 * booked and cancelled" and "it was never booked" are different facts, and the second is what a
 * complaint turns on.
 *
 * NOTHING IS BOOKED AUTOMATICALLY, and no resource is chosen for anybody. A system that picked the
 * next free scanner would pick one on the wrong floor for a patient who cannot be moved.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { overlaps } from "./scheduling.js";
import { blackedOutBy } from "./blackout.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "ResourceBooking";
const STATES = Object.freeze(["booked", "cancelled", "completed"]);
const KINDS = Object.freeze(["room", "theatre", "equipment", "other"]);

/** PURE. The hospital's resources, validated. An unusable entry is reported, never silently absent:
 *  a room that vanished from the list looks exactly like one the hospital does not have. */
function resolveResources(list) {
  const rows = Array.isArray(list) ? list : [];
  const resources = [], problems = [];
  rows.forEach((raw, index) => {
    const r = raw && typeof raw === "object" ? raw : {};
    const id = str(r.id);
    if (!id) { problems.push({ index, reason: "no_id" }); return; }
    resources.push({ id, name: str(r.name) || id, kind: KINDS.includes(str(r.kind)) ? str(r.kind) : "other", location: str(r.location) || null });
  });
  return { resources, ...(problems.length ? { problems } : {}) };
}

function ResourceBooking(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    resourceId: i.resourceId,
    resourceName: i.resourceName || null,
    patientId: i.patientId || null,          // a room may be booked for maintenance, with no patient
    encounterId: i.encounterId || null,
    purpose: i.purpose || null,
    startAt: i.startAt || null,
    minutes: Number.isFinite(i.minutes) ? i.minutes : null,
    state: STATES.includes(i.state) ? i.state : "booked",
    bookedBy: i.bookedBy || null, bookedAt: i.bookedAt || null,
    changedBy: i.changedBy || null, changedAt: i.changedAt || null, changeReason: i.changeReason || null,
    source: { system: "wardsynq-native", sourceId: `resource-booking:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One booking per (resource, instant). A retried booking is the same one. */
function bookingIdFor(resourceId, startAt) {
  const r = slug(resourceId), t = slug(startAt);
  return r && t ? `wsq-res-${r}-${t}` : null;
}

/**
 * PURE. The booking this one would collide with, or null.
 *
 * Only a LIVE booking blocks: a cancelled one has freed the room, and treating it as a clash would
 * make a cancelled slot unbookable forever.
 */
function clashWith(candidate, existing) {
  return (existing || []).find((b) => b && b.state === "booked" && b.id !== candidate.id
    && str(b.resourceId) === str(candidate.resourceId) && overlaps(candidate, b)) || null;
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

function summary(b) {
  return {
    bookingId: b.id, resourceId: b.resourceId, resourceName: b.resourceName || null,
    patientId: b.patientId || null, encounterId: b.encounterId || null, purpose: b.purpose || null,
    startAt: b.startAt, minutes: b.minutes, state: b.state,
    bookedBy: b.bookedBy, bookedAt: b.bookedAt,
    changedBy: b.changedBy || null, changedAt: b.changedAt || null, changeReason: b.changeReason || null,
    version: b.version,
  };
}

/** ctx: { migration, resources, resourceId, startAt, minutes, patientId?, purpose?, ... } */
async function bookResource(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const resourceId = str(ctx.resourceId), startAt = str(ctx.startAt);
  const minutes = Number(ctx.minutes);
  if (!resourceId || !startAt) return { ...base, ok: false, status: 422, error: "resource_and_start_required", written: 0 };
  if (!Number.isFinite(Date.parse(startAt))) return { ...base, ok: false, status: 422, error: "bad_start", detail: "startAt must be an instant", written: 0 };
  // A booking with no length has no end, so nothing can ever clash with it - which would silently
  // disable the one rule this file exists for.
  if (!Number.isFinite(minutes) || minutes <= 0) return { ...base, ok: false, status: 422, error: "minutes_required", detail: "a booking needs a length, or nothing can clash with it", written: 0 };

  /* A RESOURCE THE HOSPITAL DOES NOT HAVE CANNOT BE BOOKED. Accepting a made-up room is how a patient
   * is sent somewhere that does not exist. */
  const { resources } = resolveResources(ctx.resources);
  const resource = resources.find((r) => r.id === resourceId) || null;
  if (!resource) {
    return {
      ...base, ok: false, status: 404, error: "resource_not_found",
      detail: resources.length ? `this hospital has no resource "${resourceId}"` : "this hospital has configured no bookable resources",
      known: resources.map((r) => r.id), written: 0,
    };
  }

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = bookingIdFor(resourceId, startAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let existing, blackouts;
  try { [existing, blackouts] = await Promise.all([svc.list(TYPE, 500), svc.list("Blackout", 500).catch(() => [])]); existing = existing || []; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  // A BLACKOUT IS A REFUSAL, NEVER AN OVERRIDE - the same rule scheduling.js applies to a
  // clinician's diary, here for the resource: this file already has no override for a clash, so a
  // blackout is refused exactly the same way a double-booking is.
  const blocked = blackedOutBy(blackouts, resourceId, { startAt, minutes });
  if (blocked) {
    return { ...base, ok: false, status: 409, error: "blacked_out", detail: `${resource.name} is unavailable ${blocked.from} to ${blocked.to}: ${blocked.reason}`, blackoutId: blocked.id, resourceId, written: 0 };
  }

  const candidate = ResourceBooking({
    id, resourceId, resourceName: resource.name,
    patientId: str(ctx.patientId) || null, encounterId: str(ctx.encounterId) || null,
    purpose: str(ctx.purpose) || null, startAt, minutes, state: "booked",
    bookedBy: resolved.actor.id, bookedAt: new Date().toISOString(),
  });

  const current = existing.find((b) => b && b.id === id) || null;
  if (current && current.state === "booked") return { ...base, ok: true, written: 0, skipped: "already_booked", ...summary(current) };

  /* THE REFUSAL, and there is no override. Two patients cannot be inside one CT scanner, and no
   * amount of "deliberate" makes them fit. It names the booking already there, because a refusal a
   * scheduler cannot act on is one they replace with a paper list. */
  const clash = clashWith(candidate, existing);
  if (clash) {
    return {
      ...base, ok: false, status: 409, error: "resource_busy",
      detail: `${resource.name} is already booked from ${clash.startAt} for ${clash.minutes} minutes.`,
      resourceId, clashesWith: summary(clash), written: 0,
    };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...candidate, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { bookingId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** ctx: { migration, bookingId, state: "cancelled" | "completed", reason? } */
async function setBookingState(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const bookingId = str(ctx.bookingId), state = str(ctx.state);
  if (!bookingId) return { ...base, ok: false, status: 422, error: "booking_required", written: 0 };
  if (state !== "cancelled" && state !== "completed") return { ...base, ok: false, status: 400, error: "unknown_state", detail: "state must be cancelled or completed", written: 0 };
  const reason = str(ctx.reason);
  if (state === "cancelled" && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the booking was cancelled", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, bookingId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "booking_not_found", bookingId, written: 0 };
  if (current.state !== "booked") return { ...base, ok: true, written: 0, skipped: "already_closed", ...summary(current) };

  const next = ResourceBooking({ ...current, state, changedBy: resolved.actor.id, changedAt: new Date().toISOString(), changeReason: reason || null });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    /* The slot frees immediately and the record still shows it was booked and cancelled and by whom:
     * "they cancelled" and "they never had one" are different facts. */
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { bookingId, written: 0, actor: resolved.actor.id }) };
  }
}

/** The day's bookings per resource. ctx: { migration, resources, resourceId?, from?, to? } */
async function resourceSchedule(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", resources: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, resources: [] };

  let rows;
  try { rows = (await svc.list(TYPE, 1000)) || []; }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), resources: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), resources: [] };
  }

  const fromMs = Date.parse(str(ctx.from)), toMs = Date.parse(str(ctx.to));
  const inWindow = (b) => {
    const t = Date.parse(str(b.startAt));
    if (!Number.isFinite(t)) return false;
    if (Number.isFinite(fromMs) && t < fromMs) return false;
    if (Number.isFinite(toMs) && t > toMs) return false;
    return true;
  };

  const { resources, problems } = resolveResources(ctx.resources);
  const wanted = str(ctx.resourceId);
  const out = resources.filter((r) => !wanted || r.id === wanted).map((r) => {
    const bookings = rows.filter((b) => b && str(b.resourceId) === r.id && inWindow(b))
      .map(summary)
      .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
    return { ...r, bookings, booked: bookings.filter((b) => b.state === "booked").length };
  });

  return {
    ...base, ok: true, resources: out,
    /* Stated, so "no bookings" is never confused with "we do not know what rooms exist" - the same
     * distinction the bed board draws with bedsConfigured. */
    resourcesConfigured: resources.length > 0,
    ...(problems ? { problems } : {}),
  };
}

export { TYPE, STATES, KINDS, resolveResources, ResourceBooking, bookingIdFor, clashWith, bookResource, setBookingState, resourceSchedule };
