/* functions/_wardsynq/register-routes.js - the doors to the statutory registers (registers.js, controlled-drugs.js).
 *
 * WHO decides BEFORE this file runs: the router's fail-closed capability table in functions/api/queue/[[path]].js
 * (the ward block), one capability per register, alternatives named there. Nothing here widens that. What this file
 * adds is the second half of every write: the patient named must be a patient of THIS hospital, read through the
 * record service as the signed-in person, so a register entry can never point at a chart the writer cannot see.
 *
 *   GET  register-schema        ?kind=                         any member (form definitions, no data)
 *   GET  register-formf         ?period= | ?id= | &format=csv   register.pcpndt
 *   POST register-formf         save or correct                 register.pcpndt
 *   GET  register-mtp           ?period= | ?id= | &format=csv|form2   register.mtp
 *   POST register-mtp                                            register.mtp
 *   GET  register-vital         ?kind=birth|death|stillbirth|mccd &period= | ?id= | &format=csv | ?pending=1 | ?prefill=  register.records
 *   POST register-vital         birth, death, still birth       register.records
 *   GET  register-mccd          ?patientId=                     emr.treat (the certifying doctor)
 *   POST register-mccd                                           emr.treat
 *   GET  register-mlc           ?period= | ?id= | &format=csv   register.records
 *   POST register-mlc                                            mlc.record, or register.records
 *   GET  mlc-patient            ?patientId=                     mlc.record, or register.records
 *   GET  mlc-flag               ?patientId=                     emr.view (yes/no and the MLC number, nothing else)
 *   GET  register-notification  ?week= | ?id= | &format=csv    register.ihip
 *   POST register-notification                                   emr.treat, or register.ihip
 *   GET  notifiable-prompts     ?patientId=                     emr.view
 *   GET  register-ndps          ?from=&to=                      register.ndps
 *   POST register-ndps          a shift count                   register.ndps
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { REGISTERS, saveEntry, listEntries, entryHistory, csvFor, schemaOf, mtpFormII, typeOf } from "./registers.js";
import { ndpsRegister, recordNdpsCount } from "./controlled-drugs.js";
import { notifiablePrompts, weeklyExport } from "./notifiable.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const SUBMISSION = "Submission is manual. WardSynQ has not sent this anywhere: file it with the authority named.";

const SUBS = new Set(["register-schema", "register-formf", "register-mtp", "register-vital", "register-mccd", "register-mlc", "mlc-patient", "mlc-flag",
  "register-notification", "notifiable-prompts", "register-ndps"]);

async function openSvc(request, env, ctx) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }) };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error" } };
  }
}

/** The patient, read as the signed-in person, or the refusal. */
async function patientOf(svc, patientId, mrn) {
  if (!str(patientId) && !str(mrn)) return { error: { ok: false, status: 422, error: "patient_required", message: "Name the patient this entry is for.", written: 0 } };
  try {
    if (!str(patientId)) {
      // By hospital number: exactly one patient, or the person picks again. Never the first of several.
      const hits = await svc.findPatientsByIdentifier({ mrn: str(mrn) });
      if (hits.length !== 1) return { error: { ok: false, status: hits.length ? 409 : 404, error: hits.length ? "patient_ambiguous" : "patient_not_found", message: hits.length ? "More than one patient has this hospital number." : "No patient has this hospital number.", written: 0 } };
      return { patient: hits[0] };
    }
    const p = await svc.get("Patient", str(patientId));
    return p ? { patient: p } : { error: { ok: false, status: 404, error: "patient_not_found", message: "No such patient in this hospital.", written: 0 } };
  } catch (e) {
    if (e instanceof GovernanceError) return { error: { ok: false, status: 403, error: "permission", written: 0 } };
    return { error: { ok: false, status: 502, error: "record_read_failed", message: "The patient could not be read, so nothing was saved.", written: 0 } };
  }
}

/* ------------------------------------------------------------------------------------------------ PURE helpers */

/** PURE. Is this imaging request an obstetric ultrasound, the procedure Form F exists for? Named, never guessed wide. */
const OBSTETRIC = /\b(obstetric|obstetrical|antenatal|ante-natal|pregnan\w*|foetal|fetal|foetus|fetus|nt[- ]scan|nuchal|anomaly scan|growth scan|dating scan|gestation\w*|biophysical profile|umbilical artery doppler)\b/i;
const ULTRASOUND = /\b(ultrasound|ultrasonography|usg|sonography|sonogram|doppler|\bus\b)\b/i;
function isObstetricUltrasound(sr, modality) {
  const text = `${str(sr && sr.display)} ${str(sr && sr.code)} ${str(sr && sr.name)}`;
  const us = /^us$/i.test(str(modality)) || ULTRASOUND.test(text);
  return !!(sr && (sr.category === "imaging" || us) && us && OBSTETRIC.test(text));
}
const formFIdFor = (serviceRequestId) => `reg-formf-sr-${slug(serviceRequestId)}`;

/** PURE. Delivery record fields the birth and still-birth reports start from. The person completes the rest. */
function prefillFromDelivery(delivery, mother, orgName) {
  const method = { vaginal: "natural", caesarean: "caesarean", instrumental: "forceps-vacuum" }[str(delivery && delivery.mode)] || undefined;
  return {
    dateOfBirth: str(delivery && delivery.deliveredAt).slice(0, 10) || undefined, motherName: str(mother && mother.name) || undefined,
    methodOfDelivery: method, placeOfBirthType: "hospital", placeOfBirthName: str(orgName) || undefined,
  };
}
function prefillFromDeath(patient, orgName) {
  const d = (patient && patient.deceased) || {};
  const sex = ["male", "female"].includes(str(patient && patient.sex)) ? str(patient.sex) : undefined;
  return {
    death: { dateOfDeath: str(d.at).slice(0, 10) || undefined, deceasedName: str(patient && patient.name) || undefined, deceasedDob: /^\d{4}-\d{2}-\d{2}$/.test(str(patient && patient.dob)) ? str(patient.dob) : undefined,
      sex, placeOfDeathType: "hospital", placeOfDeathName: str(orgName) || undefined, diseaseOrCause: str(d.cause) || undefined, medicalAttention: "institutional" },
    mccd: { form: "4", dateOfDeath: str(d.at).slice(0, 10) || undefined, timeOfDeath: /T(\d{2}:\d{2})/.test(str(d.at)) ? str(d.at).match(/T(\d{2}:\d{2})/)[1] : undefined, deceasedName: str(patient && patient.name) || undefined, sex },
  };
}

/* ------------------------------------------------------------------------------------------------ the doors */

const KIND_OF = { "register-formf": "formf", "register-mtp": "mtp", "register-mccd": "mccd", "register-mlc": "mlc", "register-notification": "notification" };
const VITAL = new Set(["birth", "death", "stillbirth", "mccd"]);

function csvResponse(kind, entries, period, extra) {
  return { ok: true, register: kind, format: "csv", filename: `${kind}-${period || "all"}.csv`, csv: csvFor(kind, entries), rows: entries.length, submission: SUBMISSION, ...(extra || {}) };
}

async function readList(ctx, kind, q, extra) {
  if (str(q.id)) return entryHistory({ ...ctx, kind, id: q.id });
  const r = await listEntries({ ...ctx, kind, period: q.period, from: q.from, to: q.to, patientId: q.patientId });
  if (!r.ok) return r;
  if (q.format === "csv") {
    /* A register's confidential fields never leave in an export or a list (the MTP woman's name, relation and address:
     * regulations 5 to 7). They are read only by opening the one entry, which is audited. */
    return { ...csvResponse(kind, r.entries, q.period), ...(r.truncated ? { truncated: true, truncatedWarning: r.truncatedWarning } : {}) };
  }
  return { ...r, ...(extra || {}), submission: SUBMISSION };
}

/**
 * One register door. ctx: { migration, actorDeps, recordDeps, wsqCfg, orgName, actor: {id, role}, sub, method, body, query,
 * witnessCheck, isControlled, idempotencyKey }
 */
async function registerRoute(request, env, ctx) {
  const { sub, method } = ctx;
  // A hospital number is never taken from a URL (no PHI in URLs): reads name the patient by id, writes may give the MRN in the body.
  const q = ctx.query || {}, body = ctx.body || {};

  if (sub === "register-schema" && method === "GET") {
    const kinds = str(q.kind) ? [str(q.kind)] : Object.keys(REGISTERS);
    const out = kinds.map(schemaOf).filter(Boolean);
    return out.length ? { ok: true, schemas: out } : { ok: false, status: 404, error: "unknown_register" };
  }

  if (sub === "register-ndps") {
    if (method === "GET") return ndpsRegister(request, env, { ...ctx, cfg: ctx.wsqCfg, from: q.from, to: q.to });
    if (method === "POST") return recordNdpsCount(request, env, { ...ctx, cfg: ctx.wsqCfg, code: body.code, location: body.location, unit: body.unit, counted: body.counted, shift: body.shift, note: body.note, countedOn: body.countedOn, witnessId: body.witnessId, idempotencyKey: body.idempotencyKey });
  }

  if (sub === "mlc-flag" && method === "GET") {
    const r = await listEntries({ ...ctx, kind: "mlc", patientId: q.patientId });
    if (!r.ok) return r;
    // Yes or no and the number. The injuries, the police station and the history stay in the register.
    const open = r.entries.filter((e) => e.fields && e.fields.status !== "withdrawn");
    return { ok: true, patientId: str(q.patientId), mlc: open.length > 0, cases: open.map((e) => ({ serial: e.serial, encounterId: e.encounterId, eventDate: e.eventDate })) };
  }
  if (sub === "mlc-patient") {
    /* GET by patient id; POST by hospital number in the body, so an MRN never travels in a URL. */
    let patientId = str(q.patientId);
    if (method === "POST") {
      const { svc, error } = await openSvc(request, env, ctx);
      if (error) return error;
      const p = await patientOf(svc, body.patientId, body.mrn);
      if (p.error) return p.error;
      patientId = p.patient.id;
    }
    if (!patientId) return { ok: false, status: 422, error: "patient_required" };
    return listEntries({ ...ctx, kind: "mlc", patientId });
  }

  if (sub === "notifiable-prompts" && method === "GET") {
    return notifiablePrompts(request, env, { ...ctx, patientId: q.patientId });
  }

  if (sub === "register-mccd" && method === "GET") {
    if (!str(q.patientId)) return { ok: false, status: 422, error: "patient_required" };
    return listEntries({ ...ctx, kind: "mccd", patientId: q.patientId });
  }

  if (sub === "register-vital" && method === "GET") {
    const kind = str(q.kind);
    if (!VITAL.has(kind)) return { ok: false, status: 422, error: "unknown_register", message: "kind is birth, death, stillbirth or mccd." };
    if (q.pending === "1" || str(q.prefill)) return vitalPendingOrPrefill(request, env, ctx, kind, q);
    return readList(ctx, kind, q);
  }

  const kind = sub === "register-vital" ? str(body.kind) : KIND_OF[sub];
  if (!kind || (sub === "register-vital" && !["birth", "death", "stillbirth"].includes(kind))) return { ok: false, status: 422, error: "unknown_register" };

  if (method === "GET") {
    if (kind === "mtp" && q.format === "form2") {
      const r = await listEntries({ ...ctx, kind: "mtp", period: q.period });
      if (!r.ok) return r;
      if (!str(q.period)) return { ok: false, status: 422, error: "bad_period", message: "Form II is monthly: give the month as YYYY-MM." };
      return { ok: true, register: "mtp", period: q.period, form: "Form II (MTP Regulations 2003, reg.4(5))", statement: mtpFormII(r.entries, ctx.orgName, q.state),
        submission: SUBMISSION, sendTo: "The Chief Medical Officer named in regulation 4(5) (of the State, as read; confirm with your district office)" };
    }
    if (kind === "notification" && str(q.week)) {
      return weeklyExport(ctx, q.week, q.format);
    }
    return readList(ctx, kind, q);
  }

  if (method !== "POST") return { ok: false, status: 404, error: "not_found" };

  /* A correction keeps the patient and links of the version it corrects (registers.js); a new entry names them. */
  const correcting = !!str(body.id);
  let patientId = null, links = {}, entryId = null, encounterId = str(body.encounterId) || null;
  const def = REGISTERS[kind];
  if (!correcting && def.patient !== "none") {
    const { svc, error } = await openSvc(request, env, ctx);
    if (error) return { ...error, written: 0 };
    const p = await patientOf(svc, body.patientId, body.mrn);
    if (p.error) return p.error;
    patientId = p.patient.id;
    if (kind === "formf" && str(body.serviceRequestId)) {
      let sr;
      try { sr = await svc.get("ServiceRequest", str(body.serviceRequestId)); } catch { sr = null; }
      if (!sr || sr.patientId !== patientId) return { ok: false, status: 404, error: "request_not_found", message: "No such imaging request for this patient.", written: 0 };
      links = { serviceRequestId: sr.id };
      entryId = formFIdFor(sr.id);
    }
    if ((kind === "birth" || kind === "stillbirth") && str(body.deliveryId)) {
      let d;
      try { d = await svc.get("DeliveryRecord", str(body.deliveryId)); } catch { d = null; }
      if (!d || d.patientId !== patientId) return { ok: false, status: 404, error: "delivery_not_found", message: "No such delivery for this mother.", written: 0 };
      links = { deliveryId: d.id };
      encounterId = d.encounterId || encounterId;
    }
    if (kind === "death" || kind === "mccd") {
      if (!p.patient.deceased) return { ok: false, status: 409, error: "death_not_recorded", message: "Record the death on the patient's chart first; the register follows the chart.", written: 0 };
      entryId = `reg-${kind}-${slug(patientId)}`;
    }
    if (kind === "mlc" && encounterId) entryId = `reg-mlc-enc-${slug(encounterId)}`;
  }
  const r = await saveEntry({ ...ctx, kind, id: body.id, entryId, expectedVersion: body.expectedVersion, reason: body.reason,
    patientId, encounterId, links, fields: body.fields, idempotencyKey: body.idempotencyKey });
  return r.ok ? { ...r, submission: def.internal ? undefined : SUBMISSION } : r;
}

async function vitalPendingOrPrefill(request, env, ctx, kind, q) {
  const { svc, error } = await openSvc(request, env, ctx);
  if (error) return error;
  if (str(q.prefill)) {
    const id = str(q.prefill);
    try {
      if (kind === "birth" || kind === "stillbirth") {
        const d = await svc.get("DeliveryRecord", id);
        if (!d) return { ok: false, status: 404, error: "delivery_not_found" };
        const mother = await svc.get("Patient", d.patientId);
        return { ok: true, kind, patientId: d.patientId, deliveryId: d.id, fields: prefillFromDelivery(d, mother, ctx.orgName), note: "Filled from the delivery record. Check every field and complete the rest before saving." };
      }
      const p = await svc.get("Patient", id);
      if (!p) return { ok: false, status: 404, error: "patient_not_found" };
      if (!p.deceased) return { ok: false, status: 409, error: "death_not_recorded", message: "No death is recorded on this patient's chart." };
      return { ok: true, kind, patientId: p.id, fields: prefillFromDeath(p, ctx.orgName)[kind === "mccd" ? "mccd" : "death"], note: "Filled from the death recorded on the chart. Check every field and complete the rest before saving." };
    } catch (e) {
      return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed" };
    }
  }
  const period = str(q.period);
  if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, status: 422, error: "bad_period", message: "Give the month as YYYY-MM." };
  /* WHAT IS STILL OWED TO THE REGISTRAR: every delivery and every death recorded on a chart this month that has no
   * report yet. Read from the record, so a birth nobody reported cannot fall out of the register by being forgotten. */
  let deliveries, patients;
  try { [deliveries, patients] = await Promise.all([svc.list("DeliveryRecord", 1000), svc.list("Patient", 1000)]); }
  catch (e) { return { ok: false, status: e instanceof GovernanceError ? 403 : 502, error: e instanceof GovernanceError ? "permission" : "record_read_failed", message: "Deliveries and deaths could not be read. Do not read this as nothing owed." }; }
  const [births, stills, deaths, mccds] = await Promise.all(["birth", "stillbirth", "death", "mccd"].map((k) => listEntries({ ...ctx, kind: k })));
  const failed = [births, stills, deaths, mccds].find((x) => !x.ok);
  if (failed) return failed;
  const reported = new Set([...births.entries, ...stills.entries].map((e) => e.links && e.links.deliveryId).filter(Boolean));
  const deathFor = new Set(deaths.entries.map((e) => e.patientId)), mccdFor = new Set(mccds.entries.map((e) => e.patientId));
  const names = new Map(patients.map((p) => [p.id, p]));
  const due = (iso) => new Date(Date.parse(str(iso)) + 21 * 86400000).toISOString().slice(0, 10);
  return {
    ok: true, period,
    deliveries: deliveries.filter((d) => str(d.deliveredAt).slice(0, 7) === period && !reported.has(d.id))
      .map((d) => ({ deliveryId: d.id, patientId: d.patientId, name: (names.get(d.patientId) || {}).name || null, mrn: (names.get(d.patientId) || {}).mrn || null, deliveredAt: d.deliveredAt, dueBy: due(d.deliveredAt) })),
    deaths: patients.filter((p) => p.deceased && str(p.deceased.at).slice(0, 7) === period && (!deathFor.has(p.id) || !mccdFor.has(p.id)))
      .map((p) => ({ patientId: p.id, name: p.name, mrn: p.mrn, diedAt: p.deceased.at, deathReport: deathFor.has(p.id), mccd: mccdFor.has(p.id), dueBy: due(p.deceased.at) })),
    ...(deliveries.length >= 1000 || patients.length >= 1000 ? { truncated: true, truncatedWarning: "More than 1000 deliveries or patients exist; only the newest were read, so something owed may be missing here." } : {}),
    rule: "Model RBD Rules 1999 r.5(3): reported within twenty one days of the birth, death or still birth.",
  };
}

/**
 * The Form F gate for a final obstetric ultrasound report (radiology-report.js asks). An obstetric ultrasound is not
 * finalised without a COMPLETE Form F linked to its request. ctx: { migration, recordDeps }.
 */
async function formFGate(ctx, sr, modality) {
  if (!isObstetricUltrasound(sr, modality)) return { required: false };
  let entry;
  try { entry = await ctx.recordDeps.repository.latest(ctx.migration.tenantId, typeOf("formf"), formFIdFor(sr.id)); }
  catch { return { required: true, ok: false, error: "formf_unreadable", detail: "Form F could not be checked, so the report was not finalised." }; }
  if (!entry) return { required: true, ok: false, error: "formf_required", detail: "This is an obstetric ultrasound. Complete PCPNDT Form F for this request (Registers) before finalising the report." };
  if (!entry.complete) return { required: true, ok: false, error: "formf_incomplete", detail: `Form F for this request is not complete (missing: ${(entry.missing || []).join(", ")}). Complete it before finalising the report.`, missing: entry.missing || [] };
  return { required: true, ok: true, formFId: entry.id };
}

export { SUBS as REGISTER_SUBS, registerRoute, formFGate, isObstetricUltrasound, formFIdFor, prefillFromDelivery, prefillFromDeath, SUBMISSION };
