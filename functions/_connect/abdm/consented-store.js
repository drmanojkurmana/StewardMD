// functions/_connect/abdm/consented-store.js — the ABDM consented-records store.
//
// WHY THIS EXISTS. Linking a care context to an ABHA is a promise to serve that record on demand,
// indefinitely, with no human in the loop: ABDM allows ~20 minutes and a linked context can never be
// withdrawn. For a local-first clinic the decryption key lives on the doctor's phone, so a design that
// waits for the device fails the case that matters - patient treated in Vizag in March, presenting at
// another hospital in July, doctor's phone off. What the other hospital would see is a care context that
// never loads, which is worse than no record at all: the patient gets re-tested and delayed.
//
// THE BOUNDARY, and it is the whole point. This store holds ONLY the records of patients who have
// consented to share them through ABDM. It never holds the clinic database. StewardMD still cannot read
// a local-first clinic's `.smdbak`; what crosses the boundary is exactly what the patient authorised.
//
// This is NOT a new security posture. The OPD queue already stores names and mobiles server-side under
// encPHI with a server-held key, and FollowCare stores discharge episodes the same way. This extends that
// existing, accepted pattern to consented ABDM records and nothing else.
//
// AT REST: the bundle is sealed with the Connect master key (AES-256-GCM, per-object IV) via
// secrets.seal, so an R2 compromise alone yields ciphertext. Blobs live in R2 (cheap, free egress); a D1
// row is the index. The R2 key carries the tenant, the patient PSEUDONYM and a HASH of the care-context
// reference - never a raw reference, per the no-PHI residency rule (a careContextReference is allowed in
// a D1 column but not in an object key).
//
// RETENTION: as long as the care context is linked. Deleted on consent revoke, consent expiry, and ABHA
// opt-out - see deleteForPatient(), which the state.js erasure sweep must call.

export class ConsentedStoreError extends Error {}

// STORAGE POLICY: store STRUCTURE, never a rendered document.
// A generated record (consultation, prescription, vitals, lab entered in OPD) is stored as the coded
// bundle plus its narrative text - about 5-20 KB. A PDF of the same thing is 100 KB - 2 MB, so storing
// the rendering costs 20-100x for information we already hold. StewardMD renders a PDF on demand when a
// human wants one, and an HIU renders the FHIR itself - ABDM never needs a PDF from us. This is also the
// direction ABDM is pushing: attachment-style bundles are the starter option, structured coded FHIR is
// what integrators are expected to produce.
//
// The exception is a genuinely scanned artefact (paper report a patient brought in, an image), which
// cannot be reconstructed from structure and must be stored as bytes. Those are HealthDocumentRecord and
// are the only case where the cap below should be raised deliberately.
//
// The cap is a guard, not a limit to design around: if a record exceeds it, something is embedding a
// rendering that should have stayed a rendering.
export const MAX_RECORD_BYTES = 256 * 1024;

export const CONSENTED_TABLE = "connect_abdm_consented_record";

/** Stable, PHI-free object key. The reference is hashed because object keys are a forbidden sink for it. */
export async function objectKeyFor({ tenantId, patientAbhaHash, ref }) {
  if (!tenantId || !patientAbhaHash || !ref) throw new ConsentedStoreError("tenant, pseudonym and reference are all required");
  const refHash = await sha256hex(String(ref));
  return { key: "abdm/consented/" + tenantId + "/" + patientAbhaHash + "/" + refHash, refHash };
}

async function sha256hex(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Persist one consented record.
 *
 * @param deps.r2       R2 bucket binding
 * @param deps.db       D1 binding
 * @param deps.secrets  makeSecrets(env) - seal/open with the Connect master key
 * @param record        the projected bundle (SCCM or FHIR); serialised then sealed
 */
export async function putRecord(env, deps, { tenantId, patientAbhaHash, careContextRef, hiType, record, source }) {
  const { r2, db, secrets, now } = deps;
  if (!r2) throw new ConsentedStoreError("no R2 binding for the consented store");
  if (!db) throw new ConsentedStoreError("no D1 binding for the consented store");
  if (!secrets || typeof secrets.seal !== "function") throw new ConsentedStoreError("no sealing key - refusing to store plaintext");
  if (!record) throw new ConsentedStoreError("nothing to store");

  const { key, refHash } = await objectKeyFor({ tenantId, patientAbhaHash, ref: careContextRef });
  const plain = JSON.stringify(record);
  if (plain.length > MAX_RECORD_BYTES) {
    // Refuse rather than quietly storing a fat blob: at this size the record almost certainly carries an
    // embedded PDF or image that should have been left as structure and rendered on demand.
    throw new ConsentedStoreError(
      "record is " + plain.length + " bytes, over the " + MAX_RECORD_BYTES +
      " cap - store structure and render on demand rather than embedding a document");
  }
  const sealed = await secrets.seal(plain);
  await r2.put(key, sealed);

  const stamp = typeof now === "function" ? now() : new Date().toISOString();
  // The care-context reference IS stored in a D1 column - it is protocol-visible by design, and the
  // erasure sweep needs it. It must never reach KV, a log line, a URL or an object key.
  await db.prepare(
    `INSERT INTO ${CONSENTED_TABLE}
       (tenant_id, patient_abha_hash, ref_hash, care_context_ref, hi_type, r2_key, bytes, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, ref_hash) DO UPDATE SET
       hi_type = excluded.hi_type, r2_key = excluded.r2_key, bytes = excluded.bytes,
       source = excluded.source, updated_at = excluded.updated_at`)
    .bind(tenantId, patientAbhaHash, refHash, String(careContextRef), String(hiType || ""), key,
      sealed.length, String(source || ""), stamp, stamp)
    .run();

  return { key, refHash, bytes: sealed.length };
}

/** Read one consented record back, unsealed. Returns null when absent. */
export async function getRecord(env, deps, { tenantId, careContextRef }) {
  const { r2, db, secrets } = deps;
  if (!r2 || !db) throw new ConsentedStoreError("consented store is not bound");
  const row = await db.prepare(
    `SELECT patient_abha_hash, hi_type, r2_key FROM ${CONSENTED_TABLE} WHERE tenant_id = ? AND ref_hash = ? LIMIT 1`)
    .bind(tenantId, await sha256hex(String(careContextRef))).first();
  if (!row) return null;

  const obj = await r2.get(row.r2_key);
  // Index row without a blob means the object was lost or swept out of order. Say so rather than
  // returning an empty record, which would read to the patient as "no data exists".
  if (!obj) throw new ConsentedStoreError("index row has no stored object: " + row.r2_key);
  const sealed = typeof obj.text === "function" ? await obj.text() : String(obj);
  let record;
  try { record = JSON.parse(await secrets.open(sealed)); }
  catch (e) { throw new ConsentedStoreError("stored record could not be opened: " + (e && e.message)); }
  return { record, patientAbhaHash: row.patient_abha_hash, hiType: row.hi_type };
}

/** Everything stored for one patient at one tenant - what discovery advertises. */
export async function listForPatient(env, deps, { tenantId, patientAbhaHash }) {
  const { db } = deps;
  if (!db) throw new ConsentedStoreError("consented store is not bound");
  if (!tenantId || !patientAbhaHash) return [];
  const r = await db.prepare(
    `SELECT care_context_ref, hi_type, created_at FROM ${CONSENTED_TABLE}
       WHERE tenant_id = ? AND patient_abha_hash = ? ORDER BY created_at DESC`)
    .bind(tenantId, patientAbhaHash).all();
  return (r && r.results) || [];
}

/**
 * Erase everything held for one patient at one tenant. Called on consent revoke, consent expiry and
 * ABHA opt-out - the three mandatory HIP deletion cases (HIP_INIT_REVOKE / EXPIRE / ABHA_OPTOUT).
 * Deletes the blobs first, so a partial failure leaves an index row pointing at nothing (which
 * getRecord reports) rather than an orphaned readable blob with no index.
 */
export async function deleteForPatient(env, deps, { tenantId, patientAbhaHash }) {
  const { r2, db } = deps;
  if (!r2 || !db) throw new ConsentedStoreError("consented store is not bound");
  const r = await db.prepare(
    `SELECT r2_key FROM ${CONSENTED_TABLE} WHERE tenant_id = ? AND patient_abha_hash = ?`)
    .bind(tenantId, patientAbhaHash).all();
  const rows = (r && r.results) || [];
  let blobs = 0;
  for (const row of rows) {
    try { await r2.delete(row.r2_key); blobs++; }
    catch { /* keep going: one stuck object must not block the rest of an erasure */ }
  }
  await db.prepare(`DELETE FROM ${CONSENTED_TABLE} WHERE tenant_id = ? AND patient_abha_hash = ?`)
    .bind(tenantId, patientAbhaHash).run();
  return { rows: rows.length, blobs };
}

/** Erase one care context (a single record), for a targeted correction. */
export async function deleteCareContext(env, deps, { tenantId, careContextRef }) {
  const { r2, db } = deps;
  if (!r2 || !db) throw new ConsentedStoreError("consented store is not bound");
  const refHash = await sha256hex(String(careContextRef));
  const row = await db.prepare(`SELECT r2_key FROM ${CONSENTED_TABLE} WHERE tenant_id = ? AND ref_hash = ?`)
    .bind(tenantId, refHash).first();
  if (!row) return { deleted: false };
  try { await r2.delete(row.r2_key); } catch { /* index removal below is what makes it unreachable */ }
  await db.prepare(`DELETE FROM ${CONSENTED_TABLE} WHERE tenant_id = ? AND ref_hash = ?`).bind(tenantId, refHash).run();
  return { deleted: true };
}

// ── the HipSource face ──────────────────────────────────────────────────────────────────────────────
// Same shape as the other sources, so the serve path treats it identically. This is the ONLY source that
// can answer for a local-first clinic, because it is the only one that does not need the doctor's device.
export const consentedStoreSource = {
  id: "consented-store",
  hiTypes: ["OPConsultation", "Prescription", "DiagnosticReport", "DischargeSummary", "WellnessRecord", "ImmunizationRecord", "HealthDocumentRecord", "Invoice"],

  async listCareContexts(env, deps, { tenantId, patientAbhaHash } = {}) {
    if (!patientAbhaHash) return [];
    const rows = await listForPatient(env, deps, { tenantId, patientAbhaHash });
    // The display was already validated data-blind when the context was linked; it is not re-derived
    // here because this store holds the record, not the visit metadata.
    return rows.map((r) => ({ referenceNumber: r.care_context_ref, hiType: r.hi_type || "OPConsultation" }));
  },

  async loadRecord(env, deps, { tenantId, careContextRef } = {}) {
    const found = await getRecord(env, deps, { tenantId, careContextRef });
    if (!found) throw new ConsentedStoreError("no consented record for " + careContextRef);
    return {
      record: found.record,
      patientAbhaHash: found.patientAbhaHash,
      hiType: found.hiType || "OPConsultation",
      recordType: (found.record && found.record.recordType) || "OPConsultRecord",
    };
  },
};
