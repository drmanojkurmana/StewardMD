/* clinic-model.js — Shared Clinic EMR data model (Phase 1). PURE: the record envelope, the change
 * journal, per-record versioning, and conflict detection. No storage, no crypto, no Drive/network —
 * those are later phases. This is the contract the local store (Phase 5) and the encrypted Drive-delta
 * sync engine (Phase 6/8) build on.
 *
 * Extends Personal OPD, does not fork it: the SAME clinical records (patient fields, encounter
 * assessVals, etc.) travel inside `record.data` — the model only adds the sync metadata a multi-device
 * clinic needs (globally-unique id, version, author/device, change journal, conflict detection).
 *
 * Optimistic concurrency: every change records the BASE version it was made from. On the receiving
 * device, a change fast-forwards only if the local record is still at that base; if the local record
 * moved on independently, it is a CONFLICT (never a silent overwrite) — the caller (Phase 8) decides
 * field-level, and clinical fields raise a review card.
 *
 * window.SMD_CLINIC_MODEL + module.exports (Node-testable). Generic for all clinics/small hospitals —
 * NO ONCQIS / oncology anything.
 */
(function () {
  "use strict";

  // Entity kinds a shared clinic syncs. Patient + encounter are the core; the rest arrive in later
  // phases but the model treats every entity identically (opaque `data`).
  var ENTITY = {
    PATIENT: "patient",
    ENCOUNTER: "encounter",
    PRESCRIPTION: "prescription",
    INVESTIGATION: "investigation",
    DOCUMENT: "document",
    APPOINTMENT: "appointment",
    VITAL: "vital"
  };
  var OP = { CREATE: "create", UPDATE: "update", DELETE: "delete" };

  // Globally-unique id across devices: "<deviceId>.<base36 time>.<base36 seq>". personal-clinic's uid()
  // ("pc" + time + seq) is device-local and CAN collide when two devices mint ids in the same ms — this
  // cannot, because the deviceId prefix partitions the space per device.
  var _seq = 0;
  function makeId(deviceId, nowMs) {
    _seq = (_seq + 1) % 0x1000000;
    return String(deviceId || "dev") + "." + Number(nowMs || 0).toString(36) + "." + _seq.toString(36);
  }

  // Build a fresh record envelope at version 1. `data` is the domain payload (opaque here).
  function envelope(entityType, data, ctx) {
    ctx = ctx || {};
    var now = ctx.now || 0;
    return {
      id: ctx.id || makeId(ctx.deviceId, now),
      entityType: entityType,
      clinicId: ctx.clinicId || "",
      patientId: ctx.patientId || "",     // parent link (empty on a patient record itself)
      version: 1,
      deviceId: ctx.deviceId || "",
      authorUid: ctx.userId || "",
      createdAt: now,
      updatedAt: now,
      deleted: false,
      data: data || {}
    };
  }

  // Next version of a record: bump version, restamp author/device/updatedAt, replace data + deleted.
  function bump(rec, data, ctx) {
    ctx = ctx || {};
    var now = ctx.now || 0;
    return {
      id: rec.id, entityType: rec.entityType, clinicId: rec.clinicId, patientId: rec.patientId,
      version: (rec.version || 1) + 1,
      deviceId: ctx.deviceId || rec.deviceId,
      authorUid: ctx.userId || rec.authorUid,
      createdAt: rec.createdAt,
      updatedAt: now,
      deleted: ctx.deleted != null ? !!ctx.deleted : !!rec.deleted,
      data: data == null ? rec.data : data
    };
  }

  // A change-journal entry — the delta unit that later gets encrypted + shipped through Drive. `base`
  // = the version the edit started from (0 for a create). `record` = the full resulting envelope; it
  // is encrypted as one opaque blob before upload, so the journal metadata carries no clinical fields.
  function change(op, rec, base, ctx) {
    ctx = ctx || {};
    return {
      changeId: makeId(ctx.deviceId || rec.deviceId, ctx.now || rec.updatedAt),
      clinicId: rec.clinicId,
      recordId: rec.id,
      entityType: rec.entityType,
      op: op,
      base: base || 0,
      version: rec.version,
      deviceId: rec.deviceId,
      userId: rec.authorUid,
      timestamp: ctx.now || rec.updatedAt,
      record: rec
    };
  }

  // ---- author-side helpers: each returns { record, change } so the caller persists both ----------
  function create(entityType, data, ctx) {
    var rec = envelope(entityType, data, ctx);
    return { record: rec, change: change(OP.CREATE, rec, 0, ctx) };
  }
  function edit(rec, data, ctx) {
    var base = rec.version || 1;
    var next = bump(rec, data, ctx);
    return { record: next, change: change(OP.UPDATE, next, base, ctx) };
  }
  function remove(rec, ctx) {
    ctx = ctx || {};
    var base = rec.version || 1;
    var next = bump(rec, rec.data, { now: ctx.now, deviceId: ctx.deviceId, userId: ctx.userId, deleted: true });
    return { record: next, change: change(OP.DELETE, next, base, ctx) };
  }

  // ---- receiving-side merge: apply an incoming change against the local record ------------------
  // Returns { kind, record?, local?, incoming?, fields? }:
  //   "created"     — never seen this record; take it.
  //   "fastforward" — local is still at the change's base; advance to the incoming record.
  //   "duplicate"   — we already have this exact version from this device; no-op.
  //   "stale"       — the incoming change is behind what we already have; ignore.
  //   "conflict"    — local moved on independently from the base; caller resolves (fields differ).
  function apply(localRec, chg) {
    if (!chg || !chg.record) return { kind: "stale" };
    var incoming = chg.record;
    if (!localRec) return { kind: "created", record: incoming };
    if (incoming.id !== localRec.id) return { kind: "stale" };                 // wrong record, ignore
    if (localRec.version === chg.base) return { kind: "fastforward", record: incoming };
    if (localRec.version >= incoming.version) {
      // we're at or ahead of the incoming version. Same version + same device = the identical change.
      if (localRec.version === incoming.version && localRec.deviceId === incoming.deviceId &&
          localRec.updatedAt === incoming.updatedAt) return { kind: "duplicate", record: localRec };
      // strictly ahead (we already merged past this) OR same version different origin -> if same
      // version but different origin it's a real conflict; if we're strictly ahead it's stale.
      if (localRec.version > incoming.version) return { kind: "stale" };
    }
    // local diverged from the base the change was made on -> conflict; no silent overwrite.
    return { kind: "conflict", local: localRec, incoming: incoming, fields: diffFields(localRec.data, incoming.data) };
  }

  // Field-level diff of two data payloads (string-compared). Used to show a clinical conflict card
  // and to auto-merge safe non-conflicting fields (Phase 8).
  function diffFields(a, b) {
    a = a || {}; b = b || {};
    var out = [], seen = {};
    Object.keys(a).forEach(function (k) {
      seen[k] = 1;
      if (norm(a[k]) !== norm(b[k])) out.push(k);
    });
    Object.keys(b).forEach(function (k) {
      if (!seen[k] && norm(b[k]) !== "") out.push(k);
    });
    return out;
  }
  function norm(v) { return String(v == null ? "" : v); }

  var API = {
    ENTITY: ENTITY, OP: OP,
    makeId: makeId,
    create: create, edit: edit, remove: remove,
    apply: apply, diffFields: diffFields,
    _envelope: envelope, _bump: bump, _change: change   // exposed for tests
  };
  if (typeof window !== "undefined") window.SMD_CLINIC_MODEL = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})();
