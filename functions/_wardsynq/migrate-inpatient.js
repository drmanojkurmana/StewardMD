/* functions/_wardsynq/migrate-inpatient.js — the inpatient half of the ward vertical: admission,
 * the ward list, ward vitals, and the inpatient medication order that the eMAR then administers.
 *
 * WHY THIS EXISTS AT ALL. Every clinical write WardSynQ could do was an OPD write keyed to a queue
 * TICKET: `patientIdForTicket`, `encounterIdForTicket`, `opd-vitals-<ticketId>`. A ward has no
 * ticket. The Encounter model has carried `class: "IPD"` and `location: {facilityId, ward, bed}`
 * since it was written and nothing had ever constructed one — the 2026-09-07 audit found that only
 * `"OPD"` is ever built. This file is the missing constructor, and nothing more: it introduces no
 * new store, no new identity scheme, no second vitals vocabulary.
 *
 * WHAT IT REUSES, DELIBERATELY:
 *   - the canonical Encounter/Observation/MedicationOrder factories (wardsynq-model.js)
 *   - `vitalsToObservations` verbatim, via its new idPrefix (migrate-vitals.js) — one LOINC table
 *   - `resolveClinicalActor` + RecordService, so ward writes are governed exactly like OPD writes
 *   - `patientIdForMrn`, so an inpatient IS the same patient as their OPD self, by construction
 *
 * THE WARD LIST IS A QUERY, NOT A TABLE. There is no `ward_patients` table and there must not be:
 * the admission Encounter already says who is admitted, where, and whether the visit is open.
 * `listWard` reads the record's own latest-per-id projection and filters. A separate ward roster is
 * a second source of truth that drifts the first time someone is discharged.
 *
 * ADMISSION IS NOT A DISCHARGE DECISION. Nothing here closes an encounter automatically. A visit
 * ends when someone says it ended; an inpatient stay that quietly finished because a job ran is a
 * chart that lies.
 */

import { Encounter, MedicationOrder } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { vitalsToObservations } from "./migrate-vitals.js";
import { patientIdForMrn, admissionIdFor } from "./opd-identity.js";

const IPD = "IPD";
const OPEN = "in-progress";

const str = (v) => (v == null ? "" : String(v).trim());

/** Builds the per-request governed service, or a shaped refusal. Never throws. */
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

/** Shapes a write failure the same way every sibling migration does. */
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/**
 * PURE. The admission request to a canonical inpatient Encounter.
 * `location` is what makes this a WARD record rather than an abstract visit.
 */
function encounterFromAdmission(input) {
  const mrn = str(input && input.mrn);
  const patientId = patientIdForMrn(mrn);
  const admittedAt = str(input && input.admittedAt) || new Date().toISOString();
  const id = admissionIdFor(mrn, admittedAt);
  if (!patientId || !id) return null;

  const enc = Encounter({
    id, patientId, class: IPD, status: OPEN,
    identifiers: [{ system: "opd-mrn", value: mrn }],
    location: {
      facilityId: str(input.facilityId) || null,
      ward: str(input.ward) || null,
      bed: str(input.bed) || null,
    },
    periodStart: admittedAt,
    periodEnd: null,
    source: { system: "wardsynq-native", sourceId: `inpatient-admission:${id}` },
  });
  // Bolted on, the convention every sibling migration uses for a fact the canonical shape has no
  // field for. The attending is who the ward should call, not who typed the admission.
  const attending = str(input.attendingId);
  if (attending) enc.attendingId = attending;
  const reason = str(input.reason);
  if (reason) enc.reason = reason;
  return enc;
}

/** PURE. Same admission, unchanged — nothing to write. Mirrors sameDemographics/sameEncounter. */
function sameAdmission(a, b) {
  if (!a || !b) return false;
  const loc = (x) => JSON.stringify((x && x.location) || null);
  return a.patientId === b.patientId && a.class === b.class && a.status === b.status
    && loc(a) === loc(b) && (a.attendingId || null) === (b.attendingId || null)
    && (a.periodEnd || null) === (b.periodEnd || null);
}

/**
 * Admits a patient. ctx: { migration, admission: {mrn, ward, bed, facilityId?, attendingId?,
 * reason?, admittedAt?}, actorDeps, recordDeps }.
 */
async function admitPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const candidate = encounterFromAdmission(ctx.admission);
  if (!candidate) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0 };
  if (!candidate.location.ward) return { ...base, ok: false, status: 422, error: "ward_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("Encounter", candidate.id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  if (current && sameAdmission(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", encounterId: candidate.id, patientId: candidate.patientId, version: current.version, actor: resolved.actor.id };
  }
  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId: candidate.id, patientId: candidate.patientId, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { encounterId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The ward's open admissions, from the record itself. ctx: { migration, ward?, actorDeps, recordDeps }.
 * A caller with no read grant gets a refusal, not an empty list — an empty ward and a forbidden ward
 * must never look the same to a nurse.
 */
async function listWard(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", patients: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, patients: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), patients: [] }; }

  const want = str(ctx.ward).toLowerCase();
  const patients = (encounters || [])
    .filter((e) => e && e.class === IPD && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want)
    .map((e) => ({
      encounterId: e.id, patientId: e.patientId,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null, attendingId: e.attendingId || null, version: e.version,
    }));
  return { ...base, ok: true, patients };
}

/**
 * Ward vitals. Same coded Observations as the OPD path, anchored to the admission encounter instead
 * of a ticket. ctx: { migration, encounterId, patientId, vitals, recordedAt?, actorDeps, recordDeps }.
 */
async function recordWardVitals(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  const patientId = str(ctx.patientId);
  if (!encounterId || !patientId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const observations = vitalsToObservations({
    vitals: ctx.vitals, patientId, ticketId: encounterId, encounterId,
    recordedAt: ctx.recordedAt || new Date().toISOString(), idPrefix: "wsq-ward-vitals",
  });
  if (!observations.length) return { ...base, ok: true, written: 0, skipped: "no_numeric_values" };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let written = 0;
  const results = [];
  for (const obs of observations) {
    try {
      const current = await svc.get("Observation", obs.id);
      if (current) { results.push({ id: obs.id, skipped: "already_recorded" }); continue; }
      await svc.put(obs, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${obs.id}` : null });
      written += 1;
      results.push({ id: obs.id, written: 1 });
    } catch (e) {
      const f = writeFailure(e, {});
      results.push({ id: obs.id, error: f.error });
      // A governance refusal is the whole batch's answer: the actor may not write vitals at all.
      if (f.status === 403) return { ...base, ...f, written, observations: results };
    }
  }
  return { ...base, ok: true, written, encounterId, patientId, observations: results, actor: resolved.actor.id, role: resolved.role };
}

/**
 * PURE. An inpatient medication order.
 *
 * A DOSE IS REQUIRED HERE, unlike the OPD prescription (migrate-prescription.js deliberately writes
 * `dose: null`, because the OPD form captures a dispensing quantity and a quantity is not a dose).
 * The bedside 5-rights check compares the prepared dose against the ordered dose, so an order with
 * no dose can never be administered — it would fail `right dose` at every scan. Requiring it at
 * order entry is the difference between a prescription and something a nurse can act on.
 */
function orderFromWardRequest(input) {
  const drug = str(input && input.drug);
  const patientId = str(input && input.patientId);
  const encounterId = str(input && input.encounterId);
  const dose = input && input.dose;
  const value = dose && Number(dose.value);
  const unit = str(dose && dose.unit);
  if (!drug || !patientId || !encounterId || !input.prescriberId) return null;
  if (!Number.isFinite(value) || value <= 0 || !unit) return null;

  const id = `wsq-rx-${String(encounterId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(drug).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const order = MedicationOrder({
    id, patientId, encounterId, drug,
    drugCode: str(input.drugCode) || null,
    drugCodeSystem: str(input.drugCodeSystem) || "unspecified",
    // What the ward will actually scan. Falls back to the product name so a site without unit-dose
    // barcodes can still run the check against something real, rather than the check being skipped.
    drugBarcode: str(input.drugBarcode) || drug,
    dose: { value, unit },
    route: str(input.route) || null,
    frequency: str(input.frequency) || null,
    prescriberId: input.prescriberId,
    // Signed by the prescriber at entry: an inpatient order a nurse may act on is not a draft. The
    // governed store re-checks that the signer IS the acting actor and holds EXECUTE.
    status: "active",
    signedBy: input.prescriberId,
    source: { system: "wardsynq-native", sourceId: `inpatient-order:${id}` },
  });
  return order;
}

/**
 * Creates an inpatient medication order. The CDSS pre-check is run and REPORTED, never used to gate:
 * the content is unapproved seed data (see rx-safety.js) and this file does not get to invent a new
 * clinical control. ctx: { migration, order: {...}, safety?, actorDeps, recordDeps }.
 */
async function createWardMedicationOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const candidate = orderFromWardRequest({ ...(ctx.order || {}), prescriberId: resolved.actor.id });
  if (!candidate) return { ...base, ok: false, status: 422, error: "order_incomplete", detail: "drug, patientId, encounterId and a numeric dose {value, unit} are all required", written: 0 };

  let current;
  try { current = await svc.get("MedicationOrder", candidate.id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, orderId: candidate.id, patientId: candidate.patientId, encounterId: candidate.encounterId, version: out.record.version, status: candidate.status, safety: ctx.safety || null, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { orderId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }
}

export {
  IPD, OPEN,
  encounterFromAdmission, sameAdmission, admitPatient, listWard,
  recordWardVitals, orderFromWardRequest, createWardMedicationOrder,
};
