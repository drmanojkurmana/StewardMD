/* functions/_wardsynq/mortuary.js - receiving, keeping and releasing a body.
 *
 * FROM THE DEATH RECORD, NEVER BEFORE IT. A body is received only for a patient the chart records as deceased
 * (patient-identity.js recordDeath); the time of death and who certified it are read from there, not typed
 * again. One case per patient (`wsq-mort-<patientId>`), versioned at every change.
 *
 * ONE BODY, ONE CHAMBER. The hospital lists its cold chambers (supportServices.mortuaryChambers); a chamber
 * holding a body not yet released is refused to a second one. No chambers configured means none can be
 * allocated, said as such.
 *
 * MEDICO-LEGAL IS READ, NOT DECIDED HERE. If the stay or the patient record carries an MLC flag it is shown and
 * enforced: release needs the police no-objection, and a post-mortem report where one is required. If nothing
 * records it either way, release asks the mortuary to name who confirmed it is not a medico-legal case.
 *
 * RELEASE IS A CHECKLIST THE SERVER KEEPS. Who received the body, their relationship and identity proof, and
 * each document: death certificate, police no-objection (MLC), post-mortem report (when required), belongings
 * handed over. A missing item is refused by name. Nothing is ever deleted: release is the last version.
 *
 * THE MEDICO-LEGAL REGISTER TOO (legal review 2026-09-17, D.4.3). The route hands in this patient's open medico-legal
 * register cases (registers.js MLC), so a case recorded there needs the police no-objection like the chart flag, and a death
 * in custody or of a woman within seven years of marriage (BNSS ss.194, 196) is not released until the inquest or
 * Magistrate inquiry papers are recorded on the case, with their reference.
 */

import { str, baseOf, offOf, openSvc, writeFailure, readFailure, readAllOf } from "./support-common.js";

const CASE_TYPE = "MortuaryCase";
const caseIdFor = (patientId) => `wsq-mort-${str(patientId)}`;
const ID_PROOFS = Object.freeze(["aadhaar", "voter-id", "passport", "driving-licence", "police-id", "other"]);
const RELEASE_TO = Object.freeze(["relatives", "police"]);

/** PURE. The MLC flag as recorded: true, false, or null when nothing records it. */
function mlcOf(patient, encounter) {
  for (const src of [encounter, patient]) {
    if (!src) continue;
    for (const k of ["mlc", "medicoLegal"]) if (typeof src[k] === "boolean") return { flag: src[k], source: (src === encounter ? "Encounter." : "Patient.") + k };
  }
  return { flag: null, source: null };
}

/** PURE. Belongings as listed: [{ item, quantity, note }], or { error }. */
function belongingsFrom(list) {
  const rows = (Array.isArray(list) ? list : []).map((b) => ({ item: str(b && b.item).slice(0, 120), quantity: Number(b && b.quantity) || 1, note: str(b && b.note).slice(0, 200) || null }));
  const bad = rows.findIndex((r) => !r.item || !Number.isInteger(r.quantity) || r.quantity < 1);
  return bad >= 0 ? { error: "bad_belonging", line: bad } : { rows };
}

const INQUEST_CATEGORIES = ["death-in-custody", "death-woman-married-under-7-years"];

/** PURE. What is missing before release, or []. registerMlc: this patient's open medico-legal register cases
 * [{ serial, category, inquestPapersReceived, inquestPapersReference }], or undefined when not handed in. */
function releaseMissing(c, rel, registerMlc) {
  const r = rel || {}, d = r.documents || {}, missing = [];
  const cases = Array.isArray(registerMlc) ? registerMlc : [];
  if (!RELEASE_TO.includes(str(r.to))) missing.push("released_to");
  if (!str(r.receiverName)) missing.push("receiver_name");
  if (str(r.to) === "relatives" && !str(r.relationship)) missing.push("relationship");
  if (!ID_PROOFS.includes(str(r.idProofType)) || !str(r.idProofNumber)) missing.push("identity_proof");
  if (r.bodyIdentified !== true) missing.push("body_identified_by_receiver");
  if (d.deathCertificate !== true) missing.push("death_certificate");
  if (((c.mlc && c.mlc.flag === true) || cases.length) && d.policeNoc !== true) missing.push("police_noc");
  if (c.mlc && c.mlc.flag === null && !cases.length && !str(r.mlcConfirmedNotBy)) missing.push("mlc_status_confirmed");
  if (cases.some((x) => INQUEST_CATEGORIES.includes(x.category) && !(x.inquestPapersReceived === "yes" && str(x.inquestPapersReference)))) missing.push("inquest_papers");
  if (c.postMortem && c.postMortem.required === "yes" && d.postMortemReport !== true) missing.push("post_mortem_report");
  if (c.postMortem && c.postMortem.required === "undecided") missing.push("post_mortem_decision");
  if ((c.belongings || []).length && d.belongingsHandedOver !== true) missing.push("belongings_handed_over");
  return missing;
}

function chamberClash(cases, chamber, selfId) {
  return (cases || []).find((x) => x && x.id !== selfId && x.state !== "released" && str(x.chamber) === str(chamber)) || null;
}

/* Every case (service.listAll). Past the ceiling it throws: a chamber clash or release checked on a short read is unsafe. */
async function readAll(svc) { return readAllOf(svc, CASE_TYPE); }

/** Receives a body. ctx: { patientId, encounterId, broughtBy, identifiedBy, chamber, belongings, chambers } */
async function receiveBody(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", written: 0 };
  if (!str(ctx.broughtBy) || !str(ctx.identifiedBy)) return { ...base, ok: false, status: 422, error: "handover_required", detail: "Record who brought the body and who identified it against the wristband.", written: 0 };
  const b = belongingsFrom(ctx.belongings);
  if (b.error) return { ...base, ok: false, status: 422, ...b, written: 0 };
  const chambers = Array.isArray(ctx.chambers) ? ctx.chambers.map(str).filter(Boolean) : [];
  const chamber = str(ctx.chamber);
  if (chamber && !chambers.includes(chamber)) return { ...base, ok: false, status: 422, error: "unknown_chamber", detail: chambers.length ? "That is not one of this hospital's chambers." : "This hospital has not listed its cold chambers.", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let patient, encounter, cases;
  try {
    patient = await svc.get("Patient", patientId);
    encounter = str(ctx.encounterId) ? await svc.get("Encounter", str(ctx.encounterId)) : null;
    cases = await readAll(svc);
  } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
  if (!patient.deceased) return { ...base, ok: false, status: 409, error: "not_recorded_deceased", detail: "The chart does not record this patient's death. A doctor records the death first.", written: 0 };
  if (encounter && str(encounter.patientId) !== patientId) return { ...base, ok: false, status: 409, error: "patient_mismatch", written: 0 };
  if (cases.find((x) => x.id === caseIdFor(patientId))) return { ...base, ok: false, status: 409, error: "already_received", written: 0 };
  if (chamber && chamberClash(cases, chamber, null)) return { ...base, ok: false, status: 409, error: "chamber_occupied", detail: `Chamber ${chamber} already holds a body.`, written: 0 };
  const at = new Date().toISOString();
  const record = { resourceType: CASE_TYPE, id: caseIdFor(patientId), patientId, encounterId: encounter ? encounter.id : null, state: "received",
    deceasedAt: patient.deceased.at || null, certifiedBy: patient.deceased.certifiedBy || null,
    receivedAt: at, receivedBy: resolved.actor.id, broughtBy: str(ctx.broughtBy).slice(0, 120), identifiedBy: str(ctx.identifiedBy).slice(0, 120),
    chamber: chamber || null, belongings: b.rows, mlc: mlcOf(patient, encounter), postMortem: { required: "undecided", reason: null, orderedBy: null } };
  try {
    const out = await svc.put(record, { expectedVersion: 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId: record.id, mlc: record.mlc, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Changes a case before release: chamber, belongings, post-mortem. ctx: { caseId, chamber, belongings, postMortem, chambers } */
async function updateMortuaryCase(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur, cases;
  try { cases = await readAll(svc); cur = cases.find((x) => x.id === str(ctx.caseId)) || null; } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "case_not_found", written: 0 };
  if (cur.state === "released") return { ...base, ok: false, status: 409, error: "released", detail: "This body has been released; the record is closed.", written: 0 };
  const next = { ...cur, updatedAt: new Date().toISOString(), updatedBy: resolved.actor.id };
  delete next.version; delete next.meta;
  if (ctx.chamber !== undefined) {
    const chambers = Array.isArray(ctx.chambers) ? ctx.chambers.map(str).filter(Boolean) : [];
    const chamber = str(ctx.chamber);
    if (chamber && !chambers.includes(chamber)) return { ...base, ok: false, status: 422, error: "unknown_chamber", written: 0 };
    if (chamber && chamberClash(cases, chamber, cur.id)) return { ...base, ok: false, status: 409, error: "chamber_occupied", detail: `Chamber ${chamber} already holds a body.`, written: 0 };
    next.chamber = chamber || null;
  }
  if (ctx.belongings !== undefined) {
    const b = belongingsFrom(ctx.belongings);
    if (b.error) return { ...base, ok: false, status: 422, ...b, written: 0 };
    next.belongings = b.rows;
  }
  if (ctx.postMortem !== undefined) {
    const p = ctx.postMortem || {}, req = str(p.required);
    if (!["yes", "no", "undecided"].includes(req)) return { ...base, ok: false, status: 422, error: "bad_post_mortem", written: 0 };
    if (req !== "undecided" && !str(p.orderedBy)) return { ...base, ok: false, status: 422, error: "post_mortem_decider_required", detail: "Say who decided: the police, a magistrate, or the treating doctor.", written: 0 };
    if (req === "no" && cur.mlc && cur.mlc.flag === true && !str(p.reason)) return { ...base, ok: false, status: 422, error: "post_mortem_waiver_reason_required", detail: "A medico-legal case without a post-mortem needs the waiver recorded.", written: 0 };
    next.postMortem = { required: req, reason: str(p.reason).slice(0, 300) || null, orderedBy: str(p.orderedBy).slice(0, 120) || null, decidedAt: next.updatedAt };
  }
  try {
    const out = await svc.put(next, { expectedVersion: cur.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId: cur.id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** Releases a body. ctx: { caseId, release: { to, receiverName, relationship, idProofType, idProofNumber, bodyIdentified, mlcConfirmedNotBy, documents } } */
async function releaseBody(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off", written: 0 };
  const { svc, resolved, error } = await openSvc(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  let cur;
  try { cur = await svc.get(CASE_TYPE, str(ctx.caseId)); } catch (e) { return { ...base, ...readFailure(e), written: 0 }; }
  if (!cur) return { ...base, ok: false, status: 404, error: "case_not_found", written: 0 };
  if (cur.state === "released") return { ...base, ok: false, status: 409, error: "released", written: 0 };
  const r = ctx.release || {};
  const missing = releaseMissing(cur, r, ctx.registerMlc);
  if (missing.length) return { ...base, ok: false, status: 422, error: "release_incomplete", missing, written: 0 };
  const d = r.documents || {};
  const next = { ...cur, state: "released", release: {
    to: str(r.to), receiverName: str(r.receiverName).slice(0, 120), relationship: str(r.relationship).slice(0, 60) || null,
    idProofType: str(r.idProofType), idProofNumber: str(r.idProofNumber).slice(0, 40), bodyIdentified: true,
    mlcConfirmedNotBy: str(r.mlcConfirmedNotBy).slice(0, 120) || null,
    documents: { deathCertificate: d.deathCertificate === true, policeNoc: d.policeNoc === true, postMortemReport: d.postMortemReport === true, belongingsHandedOver: d.belongingsHandedOver === true },
    at: new Date().toISOString(), by: resolved.actor.id } };
  delete next.version; delete next.meta;
  try {
    const out = await svc.put(next, { expectedVersion: cur.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, caseId: cur.id, version: out.record.version };
  } catch (e) { return { ...base, ...writeFailure(e), written: 0 }; }
}

/** The mortuary register: bodies held, chambers, recently released, and deaths recorded with no body received. */
async function mortuaryBoard(request, env, ctx) {
  const base = baseOf(ctx.migration);
  if (offOf(ctx.migration)) return { ...base, ok: true, skipped: "off" };
  const { svc, error } = await openSvc(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  let cases, patients;
  /* Patients: only for names and deaths with no body received. Past the ceiling the newest charts are not read, so
   * the board still shows the bodies held and says the awaiting list may be short. */
  try { cases = await readAll(svc); patients = await svc.listAll("Patient", { max: 100000 }); }
  catch (e) { return { ...base, ...readFailure(e) }; }
  const patientsTruncated = patients.truncated;
  patients = patients.rows;
  const byId = new Map(patients.map((p) => [p.id, p]));
  const who = (id) => { const p = byId.get(id); return p ? { name: p.name || p.display || null, mrn: p.mrn || null } : { name: null, mrn: null }; };
  const received = new Set(cases.map((c) => str(c.patientId)));
  const chambers = Array.isArray(ctx.chambers) ? ctx.chambers.map(str).filter(Boolean) : [];
  const held = cases.filter((c) => c.state !== "released").map((c) => ({ ...c, ...who(c.patientId), /* What this body's release will ask for beyond the receiver and the death certificate. */
    releaseNeeds: releaseMissing(c, {}, ctx.registerMlc ? ctx.registerMlc.get(str(c.patientId)) : undefined).filter((m) => ["police_noc", "mlc_status_confirmed", "post_mortem_report", "post_mortem_decision", "belongings_handed_over", "inquest_papers"].includes(m)) }));
  return { ...base, ok: true,
    ...((!ctx.registerMlc || patientsTruncated) ? { warnings: [
      ...(ctx.registerMlc ? [] : ["The medico-legal register could not be read, so what a release needs for a medico-legal case may be missing here. Release still checks it."]),
      ...(patientsTruncated ? ["More patient records exist than can be read at once; the newest were not read, so a recent death may be missing from those awaiting a body and some names may be blank."] : []),
    ] } : {}),
    held: held.sort((a, b) => str(a.receivedAt).localeCompare(str(b.receivedAt))),
    released: cases.filter((c) => c.state === "released").sort((a, b) => str(b.release && b.release.at).localeCompare(str(a.release && a.release.at))).slice(0, 50).map((c) => ({ ...c, ...who(c.patientId) })),
    chambers: chambers.map((ch) => { const c = held.find((x) => str(x.chamber) === ch); return { chamber: ch, caseId: c ? c.id : null }; }),
    awaiting: patients.filter((p) => p && p.deceased && !received.has(p.id)).map((p) => ({ patientId: p.id, name: p.name || p.display || null, mrn: p.mrn || null, deceasedAt: p.deceased.at || null })) };
}

export {
  CASE_TYPE, ID_PROOFS, INQUEST_CATEGORIES, caseIdFor, mlcOf, belongingsFrom, releaseMissing,
  receiveBody, updateMortuaryCase, releaseBody, mortuaryBoard,
};
