/* functions/_wardsynq/register-routes.js - the doors to the statutory registers (registers.js, controlled-drugs.js).
 *
 * WHO decides BEFORE this file runs: the router's fail-closed capability table in functions/api/queue/[[path]].js
 * (the ward block), one capability per register, alternatives named there. Nothing here widens that. What this file
 * adds is the second half of every write: the patient named must be a patient of THIS hospital, read through the
 * record service as the signed-in person, so a register entry can never point at a chart the writer cannot see.
 *
 * A register's companion records share its door and its capability (legal review 2026-09-17): the Form F printout and
 * monthly report with Form F; Form D (Medical Board), Form E and Form II with MTP; the dying declaration with MLC;
 * Forms 3E, 3J and 3-I with NDPS. `kind` names which one, and only a kind of that door's family is accepted.
 *
 *   GET  register-schema        ?kind=                                              any member (form definitions, no data)
 *   GET  register-formf         ?period= | ?id= | &format=csv|monthly|print | &kind=formfprint|statreturn   register.pcpndt
 *   POST register-formf         kind formf | formfprint | statreturn                 register.pcpndt
 *   GET  register-mtp           ?period= | ?id= | &format=csv (with a legal authority)|form2 | &kind=mtpboard|mtpforme|statreturn   register.mtp
 *   POST register-mtp           kind mtp | mtpboard | mtpforme | statreturn          register.mtp
 *   GET  register-vital         ?kind=birth|death|stillbirth|mccd &period= | ?id= | &format=csv | ?pending=1 | ?prefill=  register.records
 *   POST register-vital         birth, death, still birth                           register.records
 *   GET  register-mccd          ?patientId=                                         emr.treat (the certifying doctor)
 *   POST register-mccd                                                               emr.treat
 *   GET  register-mlc           ?period= | ?id= | &format=csv | &kind=dyingdecl     register.records
 *   POST register-mlc           kind mlc | dyingdecl                                 mlc.record, or register.records
 *   GET  mlc-patient            ?patientId=                                         mlc.record, or register.records
 *   GET  mlc-flag               ?patientId=                                         emr.view (yes/no and the MLC number, nothing else)
 *   GET  register-notification  ?week= | ?id= | &format=csv                         register.ihip
 *   POST register-notification                                                       emr.treat, or register.ihip
 *   GET  notifiable-prompts     ?patientId=                                         emr.view
 *   GET  register-ndps          ?from=&to= | ?view=annual&year= | ?view=form3e&patientId= | ?view=list&kind=   register.ndps
 *   POST register-ndps          a shift count, or kind form3e | form3esign | form3j | form3i | statreturn     register.ndps
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { REGISTERS, saveEntry, listEntries, entryHistory, csvFor, schemaOf, mtpFormII, typeOf, entryHash, FORMF_DECLARATION, FREE_TREATMENT, mlcClocks, FOETAL_SEX, MAX_LIST } from "./registers.js";
import { ndpsRegister, recordNdpsCount, ndpsAnnual, form3eView } from "./controlled-drugs.js";
import { notifiablePrompts, weeklyExport } from "./notifiable.js";
import { registerSettings, NOTES, formFMonthlyClock, mtpFormIIClock, rbdClock, pcpndtCentreAlerts } from "./register-settings.js";
import { hospitalToday } from "./expected-discharge.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
const SUBMISSION = "Submission is manual. WardSynQ has not sent this anywhere: file it with the authority named.";

const SUBS = new Set(["register-schema", "register-formf", "register-mtp", "register-vital", "register-mccd", "register-mlc", "mlc-patient", "mlc-flag",
  "register-notification", "notifiable-prompts", "register-ndps"]);

/* The records each door keeps, the first being its own register. */
const FAMILY = {
  "register-formf": ["formf", "formfprint", "statreturn"], "register-mtp": ["mtp", "mtpboard", "mtpforme", "statreturn"],
  "register-mccd": ["mccd"], "register-mlc": ["mlc", "dyingdecl"], "register-notification": ["notification"],
  "register-ndps": ["form3e", "form3esign", "form3j", "form3i", "statreturn"],
};
/* Which returns each custodian files. */
const RETURNS_FOR = { "register-formf": ["formf-monthly"], "register-mtp": ["mtp-form2"], "register-ndps": ["ndps-3j", "ndps-3i"] };

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

/** PURE. A single full name as the name parts a 2024 form asks for. A prefill only: the person checks it. */
function nameParts(full) {
  const t = str(full).split(/\s+/).filter(Boolean);
  if (!t.length) return undefined;
  return t.length === 1 ? { first: t[0] } : t.length === 2 ? { first: t[0], last: t[1] } : { first: t[0], middle: t.slice(1, -1).join(" "), last: t[t.length - 1] };
}

/** PURE. Delivery record fields the birth and still-birth reports start from. The person completes the rest. */
function prefillFromDelivery(delivery, mother, orgName) {
  const method = { vaginal: "natural", caesarean: "caesarean", instrumental: "forceps-vacuum" }[str(delivery && delivery.mode)] || undefined;
  return {
    dateOfBirth: str(delivery && delivery.deliveredAt).slice(0, 10) || undefined, motherName: nameParts(mother && mother.name),
    methodOfDelivery: method, placeOfBirthType: "hospital", placeOfBirthName: str(orgName) || undefined,
  };
}
function prefillFromDeath(patient, orgName) {
  const d = (patient && patient.deceased) || {};
  const sex = ["male", "female"].includes(str(patient && patient.sex)) ? str(patient.sex) : undefined;
  return {
    death: { dateOfDeath: str(d.at).slice(0, 10) || undefined, deceasedName: nameParts(patient && patient.name), deceasedDob: /^\d{4}-\d{2}-\d{2}$/.test(str(patient && patient.dob)) ? str(patient.dob) : undefined,
      sex, placeOfDeathType: "hospital", placeOfDeathName: str(orgName) || undefined, diseaseOrCause: str(d.cause) || undefined, medicalAttention: "institutional" },
    mccd: { form: "4", dateOfDeath: str(d.at).slice(0, 10) || undefined, timeOfDeath: /T(\d{2}:\d{2})/.test(str(d.at)) ? str(d.at).match(/T(\d{2}:\d{2})/)[1] : undefined, deceasedName: nameParts(patient && patient.name), sex },
  };
}
const prevPeriod = (today) => { const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

/* ------------------------------------------------------------------------------------------------ the doors */

const KIND_OF = { "register-formf": "formf", "register-mtp": "mtp", "register-mccd": "mccd", "register-mlc": "mlc", "register-notification": "notification" };
const VITAL = new Set(["birth", "death", "stillbirth", "mccd"]);

function csvResponse(kind, entries, period, extra) {
  return { ok: true, register: kind, format: "csv", filename: `${kind}-${period || "all"}.csv`, csv: csvFor(kind, entries), rows: entries.length, submission: SUBMISSION, ...(extra || {}) };
}

async function readList(ctx, kind, q, extra, filter) {
  if (str(q.id)) return entryHistory({ ...ctx, kind, id: q.id });
  const r = await listEntries({ ...ctx, kind, period: q.period, from: q.from, to: q.to, patientId: q.patientId, filter });
  if (!r.ok) return r;
  if (q.format === "csv") {
    /* A register's confidential fields never leave in an export or a list (the MTP woman's name, relation and address:
     * regulations 5 to 7). They are read only by opening the one entry, which is audited. */
    return { ...csvResponse(kind, r.entries, q.period), ...(r.truncated ? { truncated: true, truncatedWarning: r.truncatedWarning } : {}) };
  }
  return { ...r, ...(extra ? extra(r) : {}), submission: SUBMISSION };
}

/**
 * One register door. ctx: { migration, actorDeps, recordDeps, wsqCfg, clock, orgName, actor: {id, role}, sub, method, body, query,
 * witnessCheck, isControlled, idempotencyKey }
 */
async function registerRoute(request, env, ctx) {
  const { sub, method } = ctx;
  // A hospital number is never taken from a URL (no PHI in URLs): reads name the patient by id, writes may give the MRN in the body.
  const q = ctx.query || {}, body = ctx.body || {};
  const settings = registerSettings(ctx.wsqCfg);
  const today = hospitalToday(Date.now(), ctx.clock);

  if (sub === "register-schema" && method === "GET") {
    const kinds = str(q.kind) ? [str(q.kind)] : Object.keys(REGISTERS);
    const out = kinds.map(schemaOf).filter(Boolean);
    return out.length ? { ok: true, schemas: out, notes: NOTES } : { ok: false, status: 404, error: "unknown_register" };
  }

  if (sub === "register-ndps" && method === "GET") {
    if (q.view === "annual") return ndpsAnnual(request, env, { ...ctx, cfg: ctx.wsqCfg, year: q.year });
    if (q.view === "form3e") return form3eView(request, env, { ...ctx, cfg: ctx.wsqCfg, patientId: q.patientId });
    if (q.view === "list") {
      const kind = str(q.kind);
      if (!FAMILY[sub].includes(kind)) return { ok: false, status: 422, error: "unknown_register" };
      return readList(ctx, kind, q, null, kind === "statreturn" ? (e) => RETURNS_FOR[sub].includes(e.fields && e.fields.returnKind) : null);
    }
    return ndpsRegister(request, env, { ...ctx, cfg: ctx.wsqCfg, from: q.from, to: q.to });
  }
  if (sub === "register-ndps" && method === "POST" && !str(body.kind)) {
    return recordNdpsCount(request, env, { ...ctx, cfg: ctx.wsqCfg, code: body.code, location: body.location, unit: body.unit, counted: body.counted, shift: body.shift, note: body.note, countedOn: body.countedOn, witnessId: body.witnessId, idempotencyKey: body.idempotencyKey });
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
    if (q.pending === "1" || str(q.prefill)) return vitalPendingOrPrefill(request, env, ctx, kind, q, today);
    /* RBD Rules r.5(3): each report carries its 21-day clock until it is submitted. */
    return readList(ctx, kind, q, kind === "mccd" ? null : (r) => ({ entries: r.entries.map((e) => ({ ...e, clock: rbdClock(e.eventDate, today, e.fields && e.fields.submittedOn) })) }));
  }

  const family = FAMILY[sub];
  const requested = method === "GET" ? str(q.kind) : str(body.kind);
  const kind = sub === "register-vital" ? str(body.kind) : (requested && family && family.includes(requested) ? requested : requested ? null : KIND_OF[sub]);
  if (!kind || (sub === "register-vital" && !["birth", "death", "stillbirth"].includes(kind))) return { ok: false, status: 422, error: "unknown_register" };
  const returnsOnly = (e) => RETURNS_FOR[sub] && RETURNS_FOR[sub].includes(e.fields && e.fields.returnKind);

  if (method === "GET") {
    if (kind === "statreturn") return readList(ctx, kind, q, null, returnsOnly);
    if (kind === "formf") return formFRead(ctx, q, settings, today);
    if (kind === "mtp") return mtpRead(ctx, q, settings, today);
    if (kind === "mlc") {
      const now = Date.now();
      return readList(ctx, kind, q, (r) => {
        const entries = r.entries.map((e) => ({ ...e, clocks: mlcClocks(e, now, settings) }));
        const all = entries.flatMap((e) => e.clocks);
        return { entries, clockSummary: { policeIntimationPending: all.filter((c) => c.kind === "police-intimation").length, pocsoReportDue: all.filter((c) => c.kind === "pocso-report").length,
          ioReportDue: all.filter((c) => c.kind === "io-report").length, inquestPapersPending: all.filter((c) => c.kind === "inquest-papers").length,
          overdue: all.filter((c) => c.state === "overdue").length }, medleapr: settings.mlc.medleapr };
      });
    }
    if (kind === "notification" && str(q.week)) return weeklyExport(ctx, q.week, q.format);
    return readList(ctx, kind, q);
  }

  if (method !== "POST") return { ok: false, status: 404, error: "not_found" };

  /* A correction keeps the patient and links of the version it corrects (registers.js); a new entry names them. */
  const correcting = !!str(body.id);
  const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
  let patientId = null, links = {}, entryId = null, encounterId = str(body.encounterId) || null, serverFields;
  const def = REGISTERS[kind];
  if (kind === "statreturn") {
    if (!RETURNS_FOR[sub].includes(str(fields.returnKind))) return { ok: false, status: 422, error: "not_this_register", message: "This register does not file that return.", written: 0 };
    if (!correcting) entryId = `reg-statreturn-${slug(fields.returnKind)}-${slug(fields.period)}`;
  }
  if (kind === "form3j" && !correcting) entryId = `reg-form3j-${slug(fields.year)}-${slug(fields.estimateKind)}-${slug(fields.drug)}-${slug(fields.unit)}`;
  if (kind === "formfprint" && !correcting) entryId = `reg-formfprint-${slug(fields.formFId)}-v${slug(fields.formFVersion)}`;
  if (kind === "form3i") {
    /* Form 3-I's numbers are the ledger's, worked out now; the person adds the justification and attests. */
    const year = Number(fields.year);
    const annual = await ndpsAnnual(request, env, { ...ctx, cfg: ctx.wsqCfg, year });
    if (!annual.ok) return { ...annual, written: 0 };
    const row = annual.form3i.find((x) => x.drug.toLowerCase() === str(fields.drug).toLowerCase() && x.unit.toLowerCase() === str(fields.unit).toLowerCase());
    if (!row) return { ok: false, status: 422, error: "no_such_drug", message: "No controlled drug with that name and unit in the year's register.", written: 0 };
    if (row.overEstimate && str(fields.justification).length < 10) return { ok: false, status: 422, error: "invalid_fields", problems: ["justification: disbursement is more than 10 per cent above the estimate (Form 3-I): give the justification"], written: 0 };
    serverFields = { estimate: row.estimate, revisedEstimate: row.revisedEstimate, openingStock: row.openingStock, procured: row.procured, disbursed: row.disbursed, closingStock: row.closingStock };
    if (!correcting) entryId = `reg-form3i-${year}-${slug(row.drug)}-${slug(row.unit)}`;
  }
  if (!correcting && sub === "register-ndps" && def.patient === "required") {
    /* The pharmacy keeps the NDPS register but does not read charts (its record grant has no Patient). The patient is
     * named by id, from the supply on the register, and confirmed to exist in this hospital's store; nothing else is
     * read. A Form 3E signature is further checked against the supply itself (registers FORM3ESIGN.check). */
    if (!str(body.patientId)) return { ok: false, status: 422, error: "patient_required", message: "Name the patient from the supply on the register.", written: 0 };
    let p;
    try { p = await ctx.recordDeps.repository.latest(ctx.migration.tenantId, "Patient", str(body.patientId)); }
    catch { return { ok: false, status: 502, error: "record_read_failed", message: "The patient could not be checked, so nothing was saved.", written: 0 }; }
    if (!p) return { ok: false, status: 404, error: "patient_not_found", message: "No such patient in this hospital.", written: 0 };
    patientId = p.id;
    entryId = kind === "form3e" ? `reg-form3e-${slug(patientId)}` : `reg-form3esign-${slug(fields.dispenseId)}`;
  } else if (!correcting && def.patient !== "none" && !(def.patient === "optional" && !str(body.patientId) && !str(body.mrn))) {
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
    if (kind === "form3e") entryId = `reg-form3e-${slug(patientId)}`;
    if (kind === "form3esign") entryId = `reg-form3esign-${slug(fields.dispenseId)}`;
  }
  const r = await saveEntry({ ...ctx, kind, id: body.id, entryId, expectedVersion: body.expectedVersion, reason: body.reason,
    patientId, encounterId, links, fields, serverFields, idempotencyKey: body.idempotencyKey });
  if (!r.ok) return r;
  const out = { ...r, submission: def.internal ? undefined : SUBMISSION };
  if (kind === "mlc" && FREE_TREATMENT.includes(r.entry.fields.category)) out.freeTreatment = "BNSS s.397: first aid and medical treatment are free of cost for this case, and the police are informed immediately. Invoices for this patient are refused while the case is open.";
  if (kind === "mtp" && Number(r.entry.fields.age) < 18 && r.entry.fields.pocsoIntimation !== "intimated" && r.entry.fields.pocsoIntimation !== "identity-withheld") out.pocso = "A minor: intimation under POCSO Act s.19(1) is still to be made and recorded.";
  if (kind === "mccd" && r.entry.fields.mannerOfDeath && r.entry.fields.mannerOfDeath !== "natural") {
    /* A manner of death other than natural is a medico-legal case (legal review E.4.6): say so if none is open. */
    const mlc = await listEntries({ ...ctx, kind: "mlc", patientId: r.entry.patientId });
    out.mlcPrompt = !mlc.ok ? "The medico-legal register could not be checked: confirm a medico-legal case is recorded for this death."
      : mlc.entries.some((e) => e.fields && e.fields.status !== "withdrawn") ? null : "The manner of death is not natural and no medico-legal case is open for this patient. Record one; the body is released only with police clearance.";
  }
  return out;
}

/* PCPNDT Form F reads: the list with the presumed-contravention count, the monthly report (r.9(8)), and the
 * authenticated printout (r.9(7)). */
async function formFRead(ctx, q, settings, today) {
  if (q.format === "print") {
    const h = await entryHistory({ ...ctx, kind: "formf", id: q.id });
    if (!h.ok) return h;
    const e = h.entry;
    if (!e.complete) return { ok: false, status: 409, error: "formf_incomplete", message: `Only a complete Form F is printed for authentication (missing: ${(e.missing || []).join(", ")}).` };
    return { ok: true, register: "formf", entry: e, printId: `${e.serial || e.id}@v${e.version}`, hash: await entryHash(e), declaration: FORMF_DECLARATION,
      authenticate: "Rule 9(7): print, sign and seal this copy, then record who authenticated it, their registration number, the date and where the signed copy is kept." };
  }
  if (q.format === "monthly") {
    const period = str(q.period);
    if (!/^\d{4}-\d{2}$/.test(period)) return { ok: false, status: 422, error: "bad_period", message: "The monthly report is for a month: give it as YYYY-MM." };
    const [r, filed] = await Promise.all([listEntries({ ...ctx, kind: "formf", period }), listEntries({ ...ctx, kind: "statreturn" })]);
    if (!r.ok) return r;
    if (!filed.ok) return filed;
    const sub = filed.entries.find((e) => e.fields.returnKind === "formf-monthly" && e.fields.period === period);
    /* Every Form F of the month, the incomplete ones flagged in the Complete column, never dropped. */
    return { ...csvResponse("formf", r.entries, period), format: "monthly", filename: `formf-monthly-${period}.csv`, total: r.entries.length, incomplete: r.entries.filter((e) => !e.complete).length,
      clock: formFMonthlyClock(period, today, sub && sub.fields.submittedOn), submitted: sub || null, ...(r.truncated ? { truncated: true, truncatedWarning: r.truncatedWarning } : {}),
      rule: "PC&PNDT Rules r.9(8): a complete report of the month's procedures by the 5th day of the following month to the Appropriate Authority." };
  }
  return readList(ctx, "formf", q, (r) => ({
    incomplete: r.entries.filter((e) => !e.complete).length,
    presumedContravention: "An incomplete Form F is presumed a contravention of section 5 or 6 unless the contrary is proved (Act s.4(3) proviso). Complete every one.",
    centre: pcpndtCentreAlerts(settings, today), onlinePortal: settings.pcpndt.onlinePortal, formGVersion: settings.pcpndt.formGVersion,
  }));
}

/* MTP reads. Regulation 6: the register is not open to inspection except under the authority of law, so an export names
 * the officer, the law and the reference, and that is audited. */
async function mtpRead(ctx, q, settings, today) {
  if (q.format === "form2") {
    if (!str(q.period) || !/^\d{4}-\d{2}$/.test(str(q.period))) return { ok: false, status: 422, error: "bad_period", message: "Form II is monthly: give the month as YYYY-MM." };
    const [r, filed] = await Promise.all([listEntries({ ...ctx, kind: "mtp", period: q.period }), listEntries({ ...ctx, kind: "statreturn" })]);
    if (!r.ok) return r;
    if (!filed.ok) return filed;
    const sub = filed.entries.find((e) => e.fields.returnKind === "mtp-form2" && e.fields.period === q.period);
    const f2 = mtpFormII(r.entries, ctx.orgName, q.state, settings);
    return { ok: true, register: "mtp", period: q.period, form: "Form II (MTP Regulations 2003, reg.4(5))", ...f2, submission: SUBMISSION,
      sendTo: settings.mtp.formIIRecipient === "state" ? "The Chief Medical Officer of the State" : "The Chief Medical Officer of the District", recipientNote: NOTES.formIIRecipient,
      clock: mtpFormIIClock(q.period, settings, today, sub && sub.fields.submittedOn), dueNote: NOTES.formIIDueDay, submitted: sub || null };
  }
  if (q.format === "csv") {
    const authority = { officer: str(q.authorityOfficer), law: str(q.authorityLaw), reference: str(q.authorityReference) };
    if (authority.officer.length < 3 || authority.law.length < 3 || authority.reference.length < 3) {
      return { ok: false, status: 422, error: "legal_authority_required", message: "MTP Regulations 2003 reg 6: the register is opened only under the authority of law. Name the requesting officer, the law and the reference." };
    }
    const r = await listEntries({ ...ctx, kind: "mtp", period: q.period, from: q.from, to: q.to });
    if (!r.ok) return r;
    try {
      await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, { ts: new Date().toISOString(), actor: str(ctx.actor && ctx.actor.id), connectorId: "wardsynq-registers", action: "register.export", outcome: "ok",
        scope: { register: "mtp", period: str(q.period) || null, rows: r.entries.length, authority }, patientRefHash: null });
    } catch { return { ok: false, status: 502, error: "register_read_failed", message: "The export could not be audited, so it was not produced." }; }
    return { ...csvResponse("mtp", r.entries, q.period), authority };
  }
  return readList(ctx, "mtp", q, (r) => ({
    entries: r.entries.map((e) => ({ ...e, flags: { formICertifiedLate: e.fields.formICertifiedLate === true, pocsoPending: Number(e.fields.age) < 18 && !["intimated", "identity-withheld"].includes(e.fields.pocsoIntimation) } })),
    form2: mtpFormIIClock(prevPeriod(today), settings, today, null), formIIRecipient: settings.mtp.formIIRecipient,
  }));
}

async function vitalPendingOrPrefill(request, env, ctx, kind, q, today) {
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
  return {
    ok: true, period,
    deliveries: deliveries.filter((d) => str(d.deliveredAt).slice(0, 7) === period && !reported.has(d.id))
      .map((d) => ({ deliveryId: d.id, patientId: d.patientId, name: (names.get(d.patientId) || {}).name || null, mrn: (names.get(d.patientId) || {}).mrn || null, deliveredAt: d.deliveredAt, dueBy: rbdClock(d.deliveredAt, today).dueBy, clock: rbdClock(d.deliveredAt, today) })),
    deaths: patients.filter((p) => p.deceased && str(p.deceased.at).slice(0, 7) === period && (!deathFor.has(p.id) || !mccdFor.has(p.id)))
      .map((p) => ({ patientId: p.id, name: p.name, mrn: p.mrn, diedAt: p.deceased.at, deathReport: deathFor.has(p.id), mccd: mccdFor.has(p.id), dueBy: rbdClock(p.deceased.at, today).dueBy, clock: rbdClock(p.deceased.at, today) })),
    /* Reports written but not yet recorded as submitted to the Registrar, with their clocks. */
    notSubmitted: [...births.entries, ...stills.entries, ...deaths.entries].filter((e) => !(e.fields && e.fields.submittedOn))
      .map((e) => ({ kind: e.kind, id: e.id, eventDate: e.eventDate, clock: rbdClock(e.eventDate, today) })),
    ...(deliveries.length >= 1000 || patients.length >= 1000 ? { truncated: true, truncatedWarning: "More than 1000 deliveries or patients exist; only the newest were read, so something owed may be missing here." } : {}),
    rule: "Model RBD Rules 1999 r.5(3): reported within twenty one days of the birth, death or still birth. After thirty days a late registration needs the District Registrar's permission and a fee (RBD Act s.13).",
  };
}

/**
 * The Form F gate for an obstetric ultrasound report (radiology-report.js asks, for every status).
 *   Rule 10(1A): the woman declares BEFORE the procedure, so no report of an obstetric ultrasound, even a preliminary
 *   one, is written without her declaration recorded on the Form F linked to the request; a final report needs the
 *   complete Form F. The doctor's declaration is printed on the report (returned as `declaration`).
 *   s.5(2), s.6: a report that names the sex of the foetus is refused, and the refusal is audited without its text.
 * ctx: { migration, recordDeps }; texts: { findings, impression, status, actorId }.
 */
async function formFGate(ctx, sr, modality, texts) {
  if (!isObstetricUltrasound(sr, modality)) return { required: false };
  const t = texts || {};
  const flagged = ["findings", "impression"].filter((k) => FOETAL_SEX.test(str(t[k])));
  if (flagged.length) {
    try {
      await ctx.recordDeps.repository.auditOnly(ctx.migration.tenantId, { ts: new Date().toISOString(), actor: str(t.actorId), connectorId: "wardsynq-registers", action: "pcpndt.disclosure_refused", outcome: "refused",
        scope: { register: "formf", on: "imaging-report", fields: flagged, serviceRequestId: sr.id }, patientRefHash: null });
    } catch { /* the refusal is the protection */ }
    return { required: true, ok: false, error: "foetal_sex_refused", status: 422, detail: "PC&PNDT Act s.5(2) and s.6: an obstetric ultrasound report must not state the sex of the foetus. Nothing was saved.", fields: flagged };
  }
  let entry;
  try { entry = await ctx.recordDeps.repository.latest(ctx.migration.tenantId, typeOf("formf"), formFIdFor(sr.id)); }
  catch { return { required: true, ok: false, error: "formf_unreadable", detail: "Form F could not be checked, so the report was not saved." }; }
  const declared = entry && entry.fields && entry.fields.womanDeclaration && entry.fields.declarationDate && entry.fields.declarationTime;
  if (!entry || !declared) return { required: true, ok: false, error: "formf_declaration_required", detail: "This is an obstetric ultrasound. Record the pregnant woman's declaration, with its date and time before the procedure, on PCPNDT Form F for this request (Registers) before any report (rule 10(1A))." };
  if (t.status === "preliminary") return { required: true, ok: true, formFId: entry.id };
  if (!entry.complete) return { required: true, ok: false, error: "formf_incomplete", detail: `Form F for this request is not complete (missing: ${(entry.missing || []).join(", ")}). Complete it before finalising the report.`, missing: entry.missing || [] };
  return { required: true, ok: true, formFId: entry.id,
    declaration: { text: FORMF_DECLARATION, doctor: entry.fields.doctorDeclaration && entry.fields.doctorDeclaration.name, registrationNo: entry.fields.doctorDeclarationRegistrationNo || null, formF: entry.serial || entry.id } };
}

/* ------------------------------------------------------------------------------------------------ MTP name suppression */

/* MTP Regulations 2003 reg 7: "No entry shall be made in any case-sheet, operation theatre register, follow-up card or any
 * other document or register other than the Admission Register ... indicating therein the name of the pregnant woman";
 * every other record uses the Admission Register serial number. Act s.5A backs it. So, while an MTP episode is current,
 * the ward list and chart header, the bed board, the ED list, the discharge summary, the case-sheet timeline and the
 * front desk patient lookup show the serial number instead of her name to anyone who does not keep the MTP register
 * (register.mtp: the treating obstetricians, medical records as custodian, and the hospital head as admin).
 * THE EPISODE: from admission to discharge (or today) plus 42 days of follow-up. A later, unrelated visit shows her name,
 * because a serial number on a fracture clinic's list would itself disclose the termination.
 * NOT MASKED, deliberately: an identity band or specimen label (misidentifying a patient is a clinical harm), FHIR, HL7
 * and ABDM exchange, insurance and PM-JAY claims, and the patient's own portal. How reg 7 applies to claims is on the list
 * for a practising lawyer.
 * ponytail: one register read per masked request; an index record per episode if it shows in ward list latency. */
const MTP_FOLLOW_UP_DAYS = 42;
const MTP_MASKED_SUBS = new Set(["list", "ed-list", "beds", "discharge-summary", "timeline"]);

/** PURE. The current MTP episodes: patientId -> [{ encounterId, serial }]. */
function mtpEpisodes(entries, today) {
  const out = new Map();
  const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  for (const e of entries || []) {
    const v = (e && e.fields) || {};
    if (!e.patientId || !e.serial || !v.admissionDate || v.admissionDate > today) continue;
    if (addDays(v.dischargeDate || today, MTP_FOLLOW_UP_DAYS) < today) continue;
    const list = out.get(e.patientId) || [];
    list.push({ encounterId: e.encounterId || null, serial: e.serial });
    out.set(e.patientId, list);
  }
  return out;
}

/** PURE. The response with the woman's name replaced by the serial wherever a row names a patient in a current episode:
 * an object carrying patientId (or a Patient resource) has its name/display replaced, and so does its `patient` child.
 * A row for a different encounter than the episode's is left alone. */
function maskMtpNames(value, episodes) {
  if (!episodes || !episodes.size) return value;
  const serialFor = (pid, enc) => {
    const list = episodes.get(pid);
    if (!list) return null;
    const hit = list.find((x) => !x.encounterId || !enc || x.encounterId === enc);
    return hit ? hit.serial : null;
  };
  const swap = (o, serial) => {
    if (typeof o.name === "string" && o.name) o.name = serial;
    if (typeof o.display === "string" && o.display) o.display = serial;
    o.nameWithheld = "MTP Regulations 2003 reg 7";
  };
  const walk = (x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    const pid = x.patientId || (x.resourceType === "Patient" ? x.id : null);
    const serial = pid ? serialFor(pid, x.encounterId || null) : null;
    if (serial) {
      if (typeof x.name === "string" || typeof x.display === "string") swap(x, serial);
      if (x.patient && typeof x.patient === "object") swap(x.patient, serial);
    }
    for (const k of Object.keys(x)) if (x[k] && typeof x[k] === "object") walk(x[k]);
  };
  const copy = JSON.parse(JSON.stringify(value));
  walk(copy);
  return copy;
}

/**
 * Masks a response for a reader who does not keep the MTP register. canMtp: whether the reader holds register.mtp.
 * The real names are also taken out of sentences in a one-patient timeline. A register that cannot be read withholds
 * the response rather than risk showing a name (returns { ok: false } for the caller to send).
 */
async function mtpNameMask(ctx, canMtp, sub, response) {
  if (canMtp || !response || response.ok === false || !MTP_MASKED_SUBS.has(sub) || !ctx.migration || !ctx.migration.tenantId) return response;
  const refuse = { ok: false, status: 502, error: "record_read_failed", message: "Whether a name must be withheld (MTP Regulations reg 7) could not be checked, so this was not shown." };
  const repo = ctx.recordDeps.repository, tenantId = ctx.migration.tenantId;
  let rows;
  try { rows = await repo.latestByType(tenantId, typeOf("mtp"), MAX_LIST, { newest: true }); } catch { return refuse; }
  const episodes = mtpEpisodes(rows, hospitalToday(Date.now(), ctx.clock));
  if (!episodes.size) return response;
  let out = maskMtpNames(response, episodes);
  /* A one-patient timeline also writes her name inside sentences ("... registered"): those are replaced as well. */
  if (sub === "timeline" && out.patientId && episodes.has(out.patientId)) {
    let p;
    try { p = await repo.latest(tenantId, "Patient", out.patientId); } catch { return refuse; }
    const name = JSON.stringify(str(p && p.name)).slice(1, -1);
    // Whole words only: a name must not be cut out of a drug or a test that happens to contain it.
    if (name.length >= 2) out = JSON.parse(JSON.stringify(out).replace(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "gu"), episodes.get(out.patientId)[0].serial));
  }
  return out;
}

export { SUBS as REGISTER_SUBS, registerRoute, formFGate, isObstetricUltrasound, formFIdFor, prefillFromDelivery, prefillFromDeath, SUBMISSION, FAMILY, RETURNS_FOR,
  mtpEpisodes, maskMtpNames, mtpNameMask, MTP_MASKED_SUBS, nameParts };
