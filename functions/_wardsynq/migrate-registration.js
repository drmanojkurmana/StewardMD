/* functions/_wardsynq/migrate-registration.js — the second clinical write to move onto the record:
 * OPD patient registration.
 *
 * Vitals (migrate-vitals.js) attach to `opd-pat-<mrn>` but nothing creates that identity: it is a
 * derived id with no Patient behind it. This is the write that creates the Patient master, so that
 * a real WardSynQ record — with a name, a date of birth, a sex — exists at the id every later
 * migration will reference, rather than a bare string an Observation happens to share.
 *
 * SAME THREE MODES as vitals (functions/_wardsynq/migration-tenant.js), from
 * `connect_tenant.settings.wardsynq.migrations.registration`. off / shadow are mechanically
 * identical to vitals: nothing, or write-and-report-never-block. `authoritative` is NOT mechanically
 * identical, and the difference is stated here rather than hidden:
 *
 *   VITALS' authoritative mode can put the record FIRST, because a vitals save is a plain write with
 *   no other consequence: if the record refuses, the timeline copy is simply never made, and the
 *   nurse re-enters the values. REGISTRATION cannot do that. Allocating an MR number
 *   (_opd_patient_store.js nextSeq, an atomic per-org counter) is the part of this operation whose
 *   uniqueness guarantee this migration is EXPLICITLY told to preserve, and a counter that hands out
 *   SMD-CLINIC-00042 cannot be "un-handed-out" if something downstream fails — the next registration
 *   must not receive 00042 again. So the existing GHIS/Firestore registration ALWAYS runs first, in
 *   BOTH shadow and authoritative mode; what "authoritative" changes is that a refusal from the
 *   record is surfaced as an ERROR to the desk rather than logged and swallowed. The MR number the
 *   desk already has is not undone. This is a real, stated limitation, not a design this file
 *   pretends is a two-phase commit.
 *
 * IDENTITY, NOT MERELY A WRITE. The WardSynQ id is deterministic from the MRN
 * (opd-identity.js patientIdForMrn), so there is structurally no way for this function to create TWO
 * Patient entities for one MRN: a second registration under the same MRN can only ever produce a new
 * VERSION of the one entity already at that id. If the demographics are unchanged, no version is
 * written at all (`skipped: "unchanged"`) rather than padding the append-only history with identical
 * copies every time the same returning patient checks in again. If they differ, a new version is
 * written — an update to the ONE identity behind that MRN, never a merge of two different ones.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not touch `linkHospitalMrn`, the operation that
 * promotes a provisional TMP- id to a real hospital MR once the EMR issues one. A patient registered
 * here while provisional gets a WardSynQ Patient with `provisional: true` at `opd-pat-tmp-NNNNNN`;
 * when the hospital later issues a real MR, Firestore re-keys the OPD patient document, but the
 * WardSynQ Patient at the OLD id is not automatically re-keyed or merged into a new one. That would
 * be exactly the identity merge this migration is told to keep an explicit, separate, governed
 * operation, not a side effect of registration. It is a known, stated gap, not an oversight.
 *
 * WHAT IS RECORDED. Name, date of birth, sex, MRN, and — only where the OPD record itself has
 * recorded consent (`_opd_patient.js abhaLinkable`) — the ABHA identifiers. Nothing is normalised or
 * invented beyond what OPD's own validated registration already produced: the birth date is exactly
 * what `validateRegistration` resolved (typed, or derived from a typed age and flagged approximate),
 * never re-derived here.
 */

import { Patient } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { abhaLinkable } from "../_opd_patient.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForMrn } from "./opd-identity.js";

/** PURE. The tenant's mode for this migration. Unknown or absent is "off". */
async function registrationMigration(env, ctx, deps) {
  const orgId = ctx && ctx.orgId;
  return resolveMigration(env, orgId, "registration", deps);
}

/**
 * PURE. The OPD registration result to a canonical Patient. Demographics travel exactly as OPD
 * resolved them; nothing here re-derives an age or guesses a name.
 *
 * @param {{mrn: string, mrSource: string, pending?: boolean,
 *   patient: {name, birthDate, gender, abhaNumber?, abhaAddress?, abhaConsent?}}} reg
 */
function patientFromRegistration(reg) {
  const patientId = patientIdForMrn(reg && reg.mrn);
  if (!patientId) return null;
  const p = (reg && reg.patient) || {};
  const identifiers = [{ system: "opd-mrn", value: String(reg.mrn) }];
  if (abhaLinkable(p)) {
    if (p.abhaNumber) identifiers.push({ system: "abha-number", value: p.abhaNumber });
    if (p.abhaAddress) identifiers.push({ system: "abha-address", value: p.abhaAddress });
  }
  const patient = Patient({
    id: patientId,
    mrn: String(reg.mrn),
    name: p.name,
    dob: p.birthDate,
    sex: p.gender || "unknown",
    identifiers,
    provisional: reg.mrSource === "provisional",
    source: { system: "wardsynq-native", sourceId: `opd-registration:${patientId}` },
  });
  // Bolted on, same convention the GHIS and SCCM adapters use for a fact the canonical model has no
  // field for: this is stated once, here, rather than silently dropped or silently treated as exact.
  patient.approxDob = !!p.approxDob;
  return patient;
}

/** PURE. Same identity (same MRN) with unchanged demographics is not a new fact — nothing to write. */
function sameDemographics(a, b) {
  if (!a || !b) return false;
  return a.name === b.name && a.dob === b.dob && a.sex === b.sex && a.mrn === b.mrn
    && a.provisional === b.provisional && a.approxDob === b.approxDob
    && JSON.stringify(a.identifiers) === JSON.stringify(b.identifiers);
}

/**
 * Writes the registration to the record as the request's own governed actor. Never throws when the
 * caller only needs the outcome reported (`shadow`); `mode: "authoritative"` failures are still
 * returned, not thrown, so the route decides how loudly to say so.
 *
 * ctx: { migration, registration: {mrn, mrSource, pending, patient}, actorDeps, recordDeps }
 */
async function registerPatientRecord(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  const candidate = patientFromRegistration(ctx.registration);
  if (!candidate) return { ...base, ok: false, status: 422, error: "no_mrn", written: 0 };
  const patientId = candidate.id;

  const __t0 = Date.now();
  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
    console.log("REGDIAG resolveClinicalActor +" + (Date.now() - __t0) + "ms, source=" + resolved.source);
  } catch (e) {
    console.log("REGDIAG resolveClinicalActor THREW +" + (Date.now() - __t0) + "ms: " + (e && e.message));
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0, patientId };
  }
  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("Patient", patientId);
    console.log("REGDIAG svc.get Patient +" + (Date.now() - __t0) + "ms");
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), patientId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, patientId };
  }
  // Same MRN, same identity by construction. Unchanged demographics: nothing to write, and this is
  // what makes a duplicate/retried registration idempotent without needing a caller-supplied key.
  if (current && sameDemographics(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", patientId, version: current.version, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    console.log("REGDIAG svc.put Patient +" + (Date.now() - __t0) + "ms");
    return { ...base, ok: true, written: 1, updated: !!current, patientId, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), patientId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", patientId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, patientId, actor: resolved.actor.id };
  }
}

export { registrationMigration, patientFromRegistration, sameDemographics, registerPatientRecord };
