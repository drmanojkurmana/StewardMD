/* functions/_opd_patient_store.js — Firestore I/O for OPD patient identity + MR allocation.
 *
 * Thin I/O over the PURE rules in _opd_patient.js; every DECISION lives there and is unit-tested.
 *
 * MR ALLOCATION IS THE POINT OF THIS FILE. Before it, three places minted MR numbers independently and
 * one derived the sequence from a collection LENGTH:
 *     var seq = padSeq((((store.listPatients && store.listPatients()) || []).length) + 1);
 * so deleting a patient made the next registration reuse a discharged patient's MR. Here the sequence
 * comes from a per-org counter document written with an updateTime precondition (compare-and-set): two
 * desks registering at the same instant cannot receive the same number - the loser's commit fails the
 * precondition and retries against the new value.
 */
import { fsGet, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import { encPHI, decPHI } from "./_queue.js";
import {
  validateRegistration, resolveMrn, makeClinicMrn, makeProvisionalMrn,
  duplicateKey, normalizeMobile
} from "./_opd_patient.js";

const now = () => Date.now();
const sanitize = (x) => String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 120);
// Worst case, N simultaneous racers need N attempts: each loser re-reads and takes the next number.
// A clinic desk sees 2-3 at once, but a bulk import can burst, so leave real headroom + a short
// jittered backoff so racers de-synchronise instead of colliding again on the same tick.
const COUNTER_TRIES = 40;
const backoff = (i) => new Promise((r) => setTimeout(r, Math.min(60, 2 + i * 2) + Math.floor(Math.random() * 6)));

// ---- atomic sequence -----------------------------------------------------------------------------
// Returns the next integer in `series` for this org. Never returns the same value twice.
export async function nextSeq(env, orgId, series) {
  const path = "q_counters/" + sanitize(orgId) + "__" + sanitize(series || "mrn");
  let lastErr = null;
  for (let i = 0; i < COUNTER_TRIES; i++) {
    const doc = await fsGet(env, path).catch(() => null);
    const cur = doc && doc.fields && Number(doc.fields.value) > 0 ? Math.round(Number(doc.fields.value)) : 0;
    const next = cur + 1;
    try {
      if (!doc) await fsCommit(env, [wCreate(env, path, { value: next, series: String(series || "mrn"), orgId: String(orgId), updatedAt: now() })]);
      else await fsCommit(env, [wUpdate(env, path, { value: next, updatedAt: now() }, { updateTime: doc.updateTime })]);
      return next;
    } catch (e) {
      // Someone else took this number between our read and our write. Re-read and try again.
      if (e && e.code === "precondition") { lastErr = e; await backoff(i); continue; }
      throw e;
    }
  }
  // ponytail: optimistic CAS with bounded retries. If a clinic ever exhausts 40, the answer is a
  // Durable Object (single-threaded counter), not a bigger number here.
  throw Object.assign(new Error("mrn_contention"), { status: 503, cause: lastErr });
}

// ---- registration --------------------------------------------------------------------------------
// org: { id, code, mode }  ("native" | "connect"; a GHIS workplace passes mode "ghis")
// Returns { ok, patient, mrn, mrSource, pending, duplicateOf? } or { ok:false, errors }.
export async function registerPatient(env, org, body, actorId) {
  // The hospital's own country decides what a valid phone number is. See functions/_region.js.
  const v = validateRegistration(body || {}, now(), org && org.region);
  if (!v.ok) return { ok: false, error: "invalid", errors: v.errors };
  const p = v.patient;
  const orgId = String((org && org.id) || "");
  const mode = String((body && body.workplaceMode) || (org && org.mode) || "native");

  // Same mobile at the same clinic is almost always the same person returning. We surface it rather
  // than blocking: twins and shared family phones are real, so the desk decides.
  const dupKey = duplicateKey(orgId, p.mobile);
  let duplicateOf = null;
  if (dupKey) {
    const d = await fsGet(env, "q_patient_index/" + sanitize(dupKey)).catch(() => null);
    if (d && d.fields && d.fields.mrn) duplicateOf = { mrn: d.fields.mrn, patientId: d.fields.patientId || "" };
  }
  if (duplicateOf && !(body && body.confirmDuplicate)) {
    return { ok: false, error: "duplicate", duplicateOf };
  }

  // WHO issues the MR — the workplace decides, never the presence of a typed number.
  const r = resolveMrn(mode, (body && body.mrn) || "");
  let mrn = r.mrn, mrSource = r.mrSource;
  if (r.needsAllocation) {
    if (mrSource === "stewardmd") mrn = makeClinicMrn((org && org.code) || orgId, await nextSeq(env, orgId, "mrn"));
    else mrn = makeProvisionalMrn(await nextSeq(env, orgId, "tmp"));   // hospital has not issued one yet
  }

  const id = sanitize(orgId + "__" + mrn);
  const fields = {
    orgId, mrn, mrSource, pending: !!r.pending,
    hospitalRef: r.hospitalRef || "",
    encName: await encPHI(env, p.name), encMobile: await encPHI(env, p.mobile),
    mobileLast4: String(p.mobile).slice(-4),
    gender: p.gender, birthDate: p.birthDate, approxDob: !!p.approxDob,
    ageYears: p.ageYears == null ? 0 : p.ageYears, ageMonths: p.ageMonths == null ? 0 : p.ageMonths,
    abhaNumber: p.abhaNumber || "", abhaAddress: p.abhaAddress || "", abhaConsent: !!p.abhaConsent,
    abhaConsentAt: p.abhaConsent ? now() : 0,
    encAddress: p.address ? await encPHI(env, p.address) : "",
    district: p.district || "", state: p.state || "", pincode: p.pincode || "",
    referredBy: p.referredBy || "",
    createdBy: actorId || "", createdAt: now(), updatedAt: now()
  };
  const writes = [wUpdate(env, "q_patients/" + id, fields)];
  if (dupKey) writes.push(wUpdate(env, "q_patient_index/" + sanitize(dupKey), { orgId, mrn, patientId: id, updatedAt: now() }));
  await fsCommit(env, writes);
  await qAudit(env, { hospitalId: orgId, ticketId: id, actor: actorId || "", action: "patient:register", meta: mrSource + " " + mrn });
  return { ok: true, patientId: id, mrn, mrSource, pending: !!r.pending, patient: Object.assign({}, p, { mrn, mrSource }) };
}

export async function getPatient(env, orgId, mrn) {
  const d = await fsGet(env, "q_patients/" + sanitize(String(orgId) + "__" + String(mrn))).catch(() => null);
  if (!d || !d.fields || String(d.fields.orgId) !== String(orgId)) return null;
  const f = d.fields;
  return {
    mrn: f.mrn, mrSource: f.mrSource, pending: !!f.pending, hospitalRef: f.hospitalRef || "",
    name: await decPHI(env, f.encName), mobile: await decPHI(env, f.encMobile),
    gender: f.gender, birthDate: f.birthDate, approxDob: !!f.approxDob,
    ageYears: f.ageYears, ageMonths: f.ageMonths,
    abhaNumber: f.abhaNumber || "", abhaAddress: f.abhaAddress || "", abhaConsent: !!f.abhaConsent,
    district: f.district || "", state: f.state || "", pincode: f.pincode || "",
    referredBy: f.referredBy || "", createdAt: f.createdAt
  };
}

// The hospital EMR finally issued a real MR for a patient we queued on a provisional id. Swap it, and
// keep the old id so anything already printed or filed can still be traced.
export async function linkHospitalMrn(env, orgId, provisionalMrn, hospitalMrn, mrSource, actorId) {
  const cur = await getPatient(env, orgId, provisionalMrn);
  if (!cur) return { ok: false, error: "not_found" };
  if (!String(hospitalMrn || "").trim()) return { ok: false, error: "mrn_required" };
  const oldId = sanitize(String(orgId) + "__" + String(provisionalMrn));
  const newId = sanitize(String(orgId) + "__" + String(hospitalMrn));
  const d = await fsGet(env, "q_patients/" + oldId);
  const fields = Object.assign({}, d.fields, {
    mrn: String(hospitalMrn), mrSource: mrSource === "connect" ? "connect" : "ghis",
    pending: false, previousMrn: String(provisionalMrn), updatedAt: now()
  });
  await fsCommit(env, [wUpdate(env, "q_patients/" + newId, fields), wUpdate(env, "q_patients/" + oldId, { supersededBy: String(hospitalMrn), updatedAt: now() })]);
  await qAudit(env, { hospitalId: orgId, ticketId: newId, actor: actorId || "", action: "patient:mrn_link", meta: provisionalMrn + "->" + hospitalMrn });
  return { ok: true, mrn: String(hospitalMrn) };
}

export { normalizeMobile };
