// functions/_connect/abdm/abha-link.js — the ABHA <-> local patient binding (M1).
//
// Certification test case TAGGING_UNIQUEPATIENTID_UNIQUEABHANUMBER is mandatory:
//   "Integrator's HIMS System should allow tagging of one ABHA Number with unique patient Id.
//    ABHA Number should be validated in the database if already exists before creating a new patient
//    id to avoid tagging of multiple patient id with same ABHA Number."
//
// So this is the gate every registration path must go through, and it is deliberately the ONLY place
// that writes the binding. Storage rules (DPDP + no-phi R16): the ABHA number is never stored raw -
// only its HMAC pseudonym and last 4 digits. The ABHA address is stored, because HIP/HIU linking needs
// it and it is the patient's chosen public handle.

import { hmacPseudonym } from "../audit.js";

export class AbhaLinkError extends Error {
  constructor(message, code) { super(message); this.code = code || "abha_link_error"; }
}

export const ABHA_LINK_TABLE = "connect_abha_link";

/**
 * Row shape: one per (tenant, abha). `patient_ref` is the local patient id (GHIS MRN, queue ticket
 * patient ref, clinic record id - whatever that tenant uses).
 */
export function abhaLinkRow({ tenantId, abhaHash, abhaLast4, abhaAddress, patientRef, now }) {
  return {
    tenant_id: tenantId,
    patient_abha_hash: abhaHash,
    abha_last4: abhaLast4,
    abha_address: abhaAddress || null,
    patient_ref: patientRef,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Resolve what a registration attempt should do. PURE - all I/O is the caller's, which keeps the
 * mandatory rule unit-testable.
 *
 * @param existing  the row already stored for this ABHA in this tenant, or null
 * @param patientRef the local patient id the operator is about to use
 * @returns {{action:"create"|"reuse", patientRef:string}}
 *          create - first time we have seen this ABHA: write the binding
 *          reuse  - same ABHA, same patient: nothing to do, open the existing patient
 * Throws `abha_already_linked` when the same ABHA is presented for a DIFFERENT patient id - that is
 * the case the certification rule exists to prevent.
 */
export function resolveLink(existing, patientRef) {
  if (!patientRef) throw new AbhaLinkError("a local patient reference is required", "patient_ref_required");
  if (!existing) return { action: "create", patientRef };
  if (existing.patient_ref === patientRef) return { action: "reuse", patientRef };
  // The certification rule: do not create a second patient id for the same ABHA.
  throw new AbhaLinkError(
    "This ABHA is already linked to patient " + existing.patient_ref + ". Open that record instead of creating a new one.",
    "abha_already_linked");
}

/** Look up the binding for an ABHA number within a tenant. Returns null when absent. */
export async function findLink(deps, { tenantId, abhaNumber }) {
  const { db, env } = deps;
  if (!db) throw new AbhaLinkError("no database binding", "no_db");
  const abhaHash = await abhaHashFor(env, tenantId, abhaNumber);
  const row = await db.prepare(
    `SELECT tenant_id, patient_abha_hash, abha_last4, abha_address, patient_ref, created_at, updated_at
       FROM ${ABHA_LINK_TABLE} WHERE tenant_id = ? AND patient_abha_hash = ? LIMIT 1`)
    .bind(tenantId, abhaHash).first();
  return row || null;
}

/**
 * Bind an ABHA to a local patient, enforcing the one-to-one rule. Idempotent for the same pair;
 * throws `abha_already_linked` when the same ABHA is presented for a different patient id.
 */
export async function linkAbhaToPatient(deps, { tenantId, abhaNumber, abhaAddress, patientRef }) {
  const { db, env, now } = deps;
  if (!db) throw new AbhaLinkError("no database binding", "no_db");
  if (!tenantId) throw new AbhaLinkError("tenant is required", "tenant_required");
  const digits = String(abhaNumber || "").replace(/\D/g, "");
  if (digits.length !== 14) throw new AbhaLinkError("ABHA number must be 14 digits", "bad_abha");

  const existing = await findLink(deps, { tenantId, abhaNumber: digits });
  const decision = resolveLink(existing, patientRef);   // throws on conflict
  const stamp = typeof now === "function" ? now() : new Date().toISOString();

  if (decision.action === "create") {
    const row = abhaLinkRow({
      tenantId, abhaHash: await abhaHashFor(env, tenantId, digits), abhaLast4: digits.slice(-4),
      abhaAddress, patientRef, now: stamp,
    });
    await db.prepare(
      `INSERT INTO ${ABHA_LINK_TABLE}
         (tenant_id, patient_abha_hash, abha_last4, abha_address, patient_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(row.tenant_id, row.patient_abha_hash, row.abha_last4, row.abha_address, row.patient_ref, row.created_at, row.updated_at)
      .run();
    return { ...decision, created: true };
  }

  // reuse: refresh the address if the patient has since changed their preferred one
  if (abhaAddress && abhaAddress !== existing.abha_address) {
    await db.prepare(`UPDATE ${ABHA_LINK_TABLE} SET abha_address = ?, updated_at = ? WHERE tenant_id = ? AND patient_abha_hash = ?`)
      .bind(abhaAddress, stamp, tenantId, existing.patient_abha_hash).run();
  }
  return { ...decision, created: false };
}

/**
 * The HMAC pseudonym is the only durable form of an ABHA number anywhere in Connect.
 * INVARIANT: this must be the exact derivation every other ABDM surface uses for
 * `patient_abha_hash` - `hmacPseudonym(env, tenantId, <14 digits, no separators>)`. It is
 * tenant-scoped on purpose, so the same ABHA cannot be correlated across tenants. If the HIP
 * care-context sources derive it any other way, discovery silently matches nothing.
 */
export async function abhaHashFor(env, tenantId, abhaNumber) {
  const digits = String(abhaNumber || "").replace(/\D/g, "");
  if (!digits) throw new AbhaLinkError("ABHA number is required", "bad_abha");
  if (!tenantId) throw new AbhaLinkError("tenant is required", "tenant_required");
  return hmacPseudonym(env, tenantId, digits);
}
