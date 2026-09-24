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
import { mintStewardId, normalizeStewardId } from "./_steward_id.js";

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

  // WHO issues the MR — the workplace decides, never the presence of a typed number. externalMrn
  // (org.wardsynq.externalMrn) is the hospital opting into its own numbering; see resolveMrn().
  const r = resolveMrn(mode, (body && body.mrn) || "", !!(org && org.wardsynq && org.wardsynq.externalMrn));
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
  /* MRN UNIQUENESS. A minted MR (nextSeq's atomic counter) can never collide, so this guard never
   * fires for one. A SUPPLIED one can: ghis/connect always supply their own, and now so does a
   * native hospital with wardsynq.externalMrn on. Before this, the patient doc was written with a
   * plain wUpdate - a second registration under the SAME supplied MRN silently overwrote the first
   * patient's record instead of failing. wCreate's exists:false guard makes that collision fail the
   * commit instead, which fsCommit turns into a "precondition" error caught below. */
  /* THE STEWARDID IS MINTED AND RESERVED HERE, in the same commit as the patient. The reservation doc
   * q_steward_ids/<id> is a create-only write, so two registrations can never hold one number - on any
   * device, at any clinic - and the patient never exists without the number printed on their card. A
   * failed commit is either this MR being taken (the patient doc exists) or, in theory, a StewardID
   * clash; the second is retried with a fresh number. See functions/_steward_id.js. */
  let stewardId = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    stewardId = mintStewardId();
    const writes = [wCreate(env, "q_patients/" + id, Object.assign({}, fields, { stewardId })),
      wCreate(env, "q_steward_ids/" + stewardId, { stewardId, orgId, patientId: id, mrn, status: "active", createdBy: actorId || "", createdAt: now() })];
    if (dupKey) writes.push(wUpdate(env, "q_patient_index/" + sanitize(dupKey), { orgId, mrn, patientId: id, stewardId, updatedAt: now() }));
    try {
      await fsCommit(env, writes);
      break;
    } catch (e) {
      if (!(e && e.code === "precondition")) throw e;
      const taken = await fsGet(env, "q_patients/" + id).catch(() => null);
      if (taken) return { ok: false, error: "mrn_taken", message: "MR number " + mrn + " is already in use at this hospital." };
      if (attempt === 4) throw Object.assign(new Error("stewardid_contention"), { status: 503 });
    }
  }
  await qAudit(env, { hospitalId: orgId, ticketId: id, actor: actorId || "", action: "patient:register", meta: mrSource + " " + mrn + " " + stewardId });
  return { ok: true, patientId: id, mrn, mrSource, stewardId, pending: !!r.pending, patient: Object.assign({}, p, { mrn, mrSource, stewardId }) };
}

/* Who is already registered here under this mobile number, from the same index registerPatient checks; null for nobody. A
 * failed read throws: an import must not read "could not check" as "no duplicate" (legacy-import.js). */
export async function mobileDuplicateOf(env, orgId, mobile) {
  const k = duplicateKey(orgId, mobile);
  if (!k) return null;
  const d = await fsGet(env, "q_patient_index/" + sanitize(k));
  return d && d.fields && d.fields.mrn ? { mrn: d.fields.mrn } : null;
}

export async function getPatient(env, orgId, mrn) {
  const d = await fsGet(env, "q_patients/" + sanitize(String(orgId) + "__" + String(mrn))).catch(() => null);
  if (!d || !d.fields || String(d.fields.orgId) !== String(orgId)) return null;
  const f = d.fields;
  return {
    mrn: f.mrn, mrSource: f.mrSource, pending: !!f.pending, hospitalRef: f.hospitalRef || "", stewardId: f.stewardId || "",
    name: await decPHI(env, f.encName), mobile: await decPHI(env, f.encMobile),
    gender: f.gender, birthDate: f.birthDate, approxDob: !!f.approxDob,
    ageYears: f.ageYears, ageMonths: f.ageMonths,
    abhaNumber: f.abhaNumber || "", abhaAddress: f.abhaAddress || "", abhaConsent: !!f.abhaConsent,
    district: f.district || "", state: f.state || "", pincode: f.pincode || "",
    referredBy: f.referredBy || "", createdAt: f.createdAt,
    supersededBy: f.supersededBy || "", previousMrn: f.previousMrn || ""
  };
}

/* ---- StewardID resolve + revoke: the one lookup behind QR, Ni-Key, barcode and typed entry ----------
 *
 * Every carrier lands here with whatever it read. The ID is normalised and CHECKED first
 * (_steward_id.js), so a smudged card or a mistyped character is "not a StewardID", never a different
 * patient. Resolution is scoped to the hospital asking: a number reserved by another clinic answers
 * "not found here" rather than handing over a patient this hospital has no relationship with.
 *
 * Revocation is on the SERVER. It used to be an array in one browser tab, so a lost Ni-Key card was
 * revoked on the device that noticed and kept working everywhere else. */
export async function resolveStewardId(env, orgId, input) {
  const sid = normalizeStewardId(input);
  if (!sid) return { ok: false, error: "not_a_steward_id", message: "That is not a valid StewardID. Check the characters or scan again." };
  const d = await fsGet(env, "q_steward_ids/" + sid);   // a failed read throws: never "not found" by accident
  const f = d && d.fields;
  if (!f || String(f.orgId) !== String(orgId)) return { ok: false, error: "not_found", stewardId: sid, message: "No patient with this StewardID at this hospital." };
  if (f.status === "revoked") return { ok: false, error: "revoked", stewardId: sid, reason: f.revokedReason || "", message: "This card was reported lost or replaced. Ask for the new card or search by name." };
  const patient = await getPatient(env, orgId, f.mrn);
  if (!patient) return { ok: false, error: "not_found", stewardId: sid, message: "No patient with this StewardID at this hospital." };
  return { ok: true, stewardId: sid, mrn: f.mrn, patientId: f.patientId, patient };
}

export async function revokeStewardId(env, orgId, input, reason, actorId) {
  const sid = normalizeStewardId(input);
  if (!sid) return { ok: false, error: "not_a_steward_id" };
  const why = String(reason || "").trim();
  if (!why) return { ok: false, error: "reason_required", message: "Say why the card is being revoked (lost, damaged, replaced)." };
  const d = await fsGet(env, "q_steward_ids/" + sid);
  if (!d || !d.fields || String(d.fields.orgId) !== String(orgId)) return { ok: false, error: "not_found" };
  await fsCommit(env, [wUpdate(env, "q_steward_ids/" + sid, { status: "revoked", revokedReason: why.slice(0, 200), revokedBy: actorId || "", revokedAt: now() }, { updateTime: d.updateTime })]);
  await qAudit(env, { hospitalId: orgId, ticketId: d.fields.patientId || sid, actor: actorId || "", action: "patient:stewardid_revoke", meta: sid + " " + why.slice(0, 80) });
  return { ok: true, stewardId: sid, status: "revoked" };
}

// The hospital EMR finally issued a real MR for a patient we queued on a provisional id. Swap it, and
// keep the old id so anything already printed or filed can still be traced.
export async function linkHospitalMrn(env, orgId, provisionalMrn, hospitalMrn, mrSource, actorId) {
  const cur = await getPatient(env, orgId, provisionalMrn);
  if (!cur) return { ok: false, error: "not_found" };
  if (!String(hospitalMrn || "").trim()) return { ok: false, error: "mrn_required" };
  const oldId = sanitize(String(orgId) + "__" + String(provisionalMrn));
  const newId = sanitize(String(orgId) + "__" + String(hospitalMrn));
  if (oldId === newId) return { ok: false, error: "same_mrn" };
  const d = await fsGet(env, "q_patients/" + oldId);
  if (d.fields.supersededBy) return { ok: false, error: "already_linked", mrn: String(d.fields.supersededBy) };
  const fields = Object.assign({}, d.fields, {
    mrn: String(hospitalMrn), mrSource: mrSource === "connect" ? "connect" : "ghis",
    pending: false, previousMrn: String(provisionalMrn), updatedAt: now()
  });
  /* wCreate, not wUpdate: an upsert onto a hospital MR that already belongs to somebody overwrote that
   * person's record with this one's name and mobile. The whole commit fails instead. */
  try {
    await fsCommit(env, [wCreate(env, "q_patients/" + newId, fields), wUpdate(env, "q_patients/" + oldId, { supersededBy: String(hospitalMrn), updatedAt: now() }, { exists: true })]);
  } catch (e) {
    if (await getPatient(env, orgId, hospitalMrn)) return { ok: false, error: "mrn_in_use" };
    throw e;
  }
  await qAudit(env, { hospitalId: orgId, ticketId: newId, actor: actorId || "", action: "patient:mrn_link", meta: provisionalMrn + "->" + hospitalMrn });
  return { ok: true, mrn: String(hospitalMrn) };
}

/* DPDP Act 2023 erasure (functions/_wardsynq/dpdp.js): the details a patient chose to give at registration and that
 * identifying and treating them does not need - address, district, state, PIN code, who referred them and the ABHA
 * link. Name, mobile, sex and date of birth stay: they are how the patient is identified at the desk. This document
 * keeps no versions, so the values are gone from it; the audit row records that it happened, not what was removed. */
const OPTIONAL_REGISTRATION = Object.freeze({ encAddress: "address", district: "district", state: "state", pincode: "pincode", referredBy: "referredBy", abhaNumber: "abhaNumber", abhaAddress: "abhaAddress", abhaConsent: "abhaConsent" });
export async function clearOptionalRegistration(env, orgId, mrn, actorId) {
  const id = sanitize(String(orgId) + "__" + String(mrn || ""));
  const d = await fsGet(env, "q_patients/" + id).catch(() => null);
  if (!d || !d.fields || String(d.fields.orgId) !== String(orgId)) return { ok: false, error: "not_found" };
  const blank = {}, cleared = [];
  for (const k of Object.keys(OPTIONAL_REGISTRATION)) {
    const v = d.fields[k];
    if (v === undefined || v === "" || v === false || v === 0 || v === null) continue;
    blank[k] = k === "abhaConsent" ? false : ""; cleared.push(OPTIONAL_REGISTRATION[k]);
  }
  if (!cleared.length) return { ok: true, cleared: [] };
  if (blank.abhaConsent === false) blank.abhaConsentAt = 0;
  await fsCommit(env, [wUpdate(env, "q_patients/" + id, Object.assign(blank, { updatedAt: now() }), { exists: true })]);
  await qAudit(env, { hospitalId: orgId, ticketId: id, actor: actorId || "", action: "patient:dpdp_erasure", meta: cleared.join(",") });
  return { ok: true, cleared };
}

export { normalizeMobile };
