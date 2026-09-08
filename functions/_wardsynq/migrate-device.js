/* functions/_wardsynq/migrate-device.js — bed/device association for the ICU vertical (Task 2.2),
 * persisted.
 *
 * wardsynq/wardsynq-iomt.js's DeviceGateway already has everything this hazard needs: it refuses a
 * reading from a device with no positive patient association, it derives artifact/scoreEligible
 * server-side so a device cannot assert its own data clean, and it will not associate a device
 * without BOTH the patient's wristband and the device's own asset tag being scanned. NONE of that
 * is reimplemented here.
 *
 * WHAT THIS FILE ADDS, AND ONLY THIS: a Cloudflare Pages Function is stateless between requests.
 * DeviceGateway keeps its associations in an in-memory Map, which is correct for one long-lived
 * process and useless across two HTTP requests a second apart - the very next request would find no
 * association and refuse every reading as NOT_ASSOCIATED. So a gateway is REHYDRATED from the last
 * stored DeviceAssociation record on every call, exactly the pattern migrate-resus.js already uses
 * to rehydrate an EmergencyBundle: the real class runs, its own validation and derivation intact,
 * seeded from disk instead of from memory that was never going to survive the request.
 *
 * node --test test/wardsynq-device.test.mjs
 */

import { DeviceGateway, DeviceGatewayError } from "../../wardsynq/wardsynq-iomt.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "DeviceAssociation";

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
  if (e instanceof DeviceGatewayError) return { ok: false, status: 422, error: e.code, detail: e.message, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

function deviceAssociationId(deviceId) {
  const slug = str(deviceId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `wsq-device-${slug}` : null;
}

/**
 * Rehydrates a DeviceGateway whose in-memory map holds exactly the one stored association for this
 * device (if any, and if it has not already ended) - real prior state, read from the record.
 */
async function hydrateGateway(svc, deviceId) {
  const gw = new DeviceGateway({});
  const id = deviceAssociationId(deviceId);
  const current = id ? await svc.get("DeviceAssociation", id).catch(() => null) : null;
  if (current && !current.endedAt) gw.associations.set(deviceId, { ...current });
  return { gw, current };
}

/** DeviceAssociation, plain and versioned like every other record in this codebase. */
function associationRecord(id, association, patientId) {
  return { resourceType: TYPE, id, patientId, ...association, source: { system: "wardsynq-native", sourceId: `device-association:${id}` } };
}

/**
 * Binds a device to a patient. Both barcodes must have been physically scanned.
 * ctx: { migration, association: { device:{deviceId,assetTag,kind}, patient:{id}, encounterId,
 *   scannedWristband, scannedAssetTag }, actorDeps, recordDeps }
 *
 * `patient.mrn`/`patient.wristbandBarcode` are NEVER taken from the caller - only `patient.id` says
 * WHICH patient, and the MRN the scanned wristband is checked against is read from that patient's
 * own canonical record. Trusting a client-supplied MRN here would let the wristband check be
 * satisfied by whatever the request merely claimed, which defeats the entire reason two barcodes
 * must be scanned in the first place.
 */
async function deviceAssociate(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const input = ctx.association || {};
  const deviceId = str(input.device && input.device.deviceId);
  const id = deviceAssociationId(deviceId);
  if (!id) return { ...base, ok: false, status: 422, error: "device_required", written: 0 };
  const patientId = str(input.patient && input.patient.id);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let realPatient;
  try { realPatient = await svc.get("Patient", patientId); }
  catch (e) { return { ...base, ...writeFailure(e, { written: 0 }) }; }
  if (!realPatient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
  const mrn = ((realPatient.identifiers || []).find((i) => i && i.system === "opd-mrn") || {}).value || null;

  const { gw, current } = await hydrateGateway(svc, deviceId);
  let association;
  try {
    association = await gw.associate({
      device: input.device, encounterId: input.encounterId,
      patient: { id: patientId, mrn, wristbandBarcode: mrn },
      scannedWristband: input.scannedWristband, scannedAssetTag: input.scannedAssetTag,
      actorId: resolved.actor.id,
    });
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }

  try {
    const out = await svc.put(associationRecord(id, association, patientId), {
      expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null,
    });
    return { ...base, ok: true, written: 1, deviceId, association, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) };
  }
}

/** Ends an association deliberately (patient discharged, monitor freed). ctx: { migration, deviceId, reason?, actorDeps, recordDeps } */
async function deviceDissociate(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const deviceId = str(ctx.deviceId);
  const id = deviceAssociationId(deviceId);
  if (!id) return { ...base, ok: false, status: 422, error: "device_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const { gw, current } = await hydrateGateway(svc, deviceId);
  if (!current || current.endedAt) return { ...base, ok: true, written: 0, skipped: "not_associated", deviceId };

  const association = await gw.dissociate(deviceId, resolved.actor.id, str(ctx.reason) || null);
  try {
    const out = await svc.put(associationRecord(id, association, current.patientId), {
      expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null,
    });
    return { ...base, ok: true, written: 1, deviceId, association, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * One device reading, turned into a canonical Observation by the real DeviceGateway logic, then
 * persisted through the SAME governed door every other Observation goes through. Refuses outright
 * (NOT_ASSOCIATED) if the device has no active, stored association - a reading nobody owns must not
 * reach a chart, whether the process just started or has been running for a day.
 * ctx: { migration, reading: {deviceId, code, value, unit?, signalQualityIndex?, measuredAt?, codeSystem?}, actorDeps, recordDeps }
 */
async function deviceIngest(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const reading = ctx.reading || {};
  const deviceId = str(reading.deviceId);
  if (!deviceId) return { ...base, ok: false, status: 422, error: "device_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const { gw } = await hydrateGateway(svc, deviceId);
  let observation;
  try {
    observation = await gw.ingest(reading);
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0 }) };
  }

  try {
    const out = await svc.put(observation, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, observationId: observation.id, patientId: observation.patientId, artifact: observation.artifact, scoreEligible: observation.scoreEligible, qualityFlags: observation.qualityFlags, version: out.record.version, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { written: 0, actor: resolved.actor.id }) };
  }
}

/** The active association for one device, or null. ctx: { migration, deviceId, actorDeps, recordDeps } */
async function deviceStatus(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", association: null };

  const deviceId = str(ctx.deviceId);
  const id = deviceAssociationId(deviceId);
  if (!id) return { ...base, ok: false, status: 422, error: "device_required", association: null };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, association: null };

  let current;
  try { current = await svc.get("DeviceAssociation", id); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), association: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), association: null };
  }
  return { ...base, ok: true, deviceId, association: current && !current.endedAt ? current : null };
}

/** Every ACTIVE device association for one patient - what is actually on them right now. ctx: { migration, patientId, actorDeps, recordDeps } */
async function deviceList(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", devices: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", devices: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, devices: [] };

  let rows;
  try { rows = await svc.byPatient("DeviceAssociation", patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), devices: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), devices: [] };
  }
  return { ...base, ok: true, devices: (rows || []).filter((r) => r && !r.endedAt) };
}

export { TYPE, deviceAssociationId, deviceAssociate, deviceDissociate, deviceIngest, deviceStatus, deviceList };
