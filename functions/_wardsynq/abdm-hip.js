/* functions/_wardsynq/abdm-hip.js - the WardSynQ inpatient record as an ABDM HIP source (design S6 3.4, phase A3).
 *
 * The existing HIP sources serve the OPD timeline, FollowCare, clinic billing and a connected EMR. This one serves
 * the hospital's own WardSynQ record: one care context per record of a stay, read at the moment ABDM asks, through
 * RecordService, and serialised by the SAME NRCES serializer (functions/_connect/connectors/abdm/serialize.js).
 *
 * CARE CONTEXTS. A reference names the stay and the record: `IPD:<encounterId>:<kind>` for an admission,
 * `OPD:<encounterId>:OPC` for an emergency visit that was not admitted. One per record because the profiles say so:
 *   DS      DischargeSummaryRecord   the SIGNED discharge summary (an unsigned draft is never shared)
 *   RX      PrescriptionRecord       the stay's medication orders (active, on hold, stopped or completed)
 *   DR-<h>  DiagnosticReportRecord   one released report (final or corrected); the profile holds one report
 *   IMM     ImmunizationRecord       doses given in the stay with a coded vaccine (NRCES needs the coding)
 *   INV-<h> InvoiceRecord            one invoice of the stay in one currency, untaxed; the profile holds one invoice
 *   OPC     OPConsultRecord          an emergency visit with a recorded problem or note
 * <h> is the first 10 hex of the record id's SHA-256, so a reference is short, stable and carries no clinical detail.
 * The display is data-blind (carecontext.js assertDataBlind): record kind and date, never a finding.
 *
 * WHO READS. ABDM is the caller and nobody is signed in, so the read runs as a SERVICE actor that may read the
 * record types a stay's documents are made of and write nothing. Every read is audited by RecordService as usual.
 *
 * SUBJECT. The care context row is keyed by the pseudonym of the patient's ABHA address (the one consent and
 * discovery use). At serve time that pseudonym is recomputed from the Patient record's own ABHA address, held only
 * under the patient's recorded consent (migrate-registration.js). A patient whose ABHA is gone is not served, and
 * hip.js assertServeAllowed refuses the whole transfer on any mismatch.
 *
 * LINKING (HIP-initiated, ABDM M2 document v2.7, 12-08-2025, section 4.3). On discharge and when the summary is
 * signed, the stay's care contexts are registered (discoverable at once) and linked at ABDM: with a cached link token
 * straight away, otherwise a token is requested and the contexts are linked when it arrives
 * (linkPendingAfterToken). The token is requested with the ABHA ADDRESS and demographics only, never the number, so
 * the later link, made from the callback that carries only the address, matches it (FAQ Q32). Every step is audited
 * in connect_audit_event under the patient pseudonym, and nothing here ever blocks the discharge that triggered it.
 */

import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { RecordService, isExternalRecord } from "./service.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";
import { invoicesForStay } from "./invoice.js";
import { statusOf, chargeTotal } from "../../wardsynq/wardsynq-invoice.js";
import { systemUri } from "./terminology.js";
import { careContextRef, careContextDisplay, assertDataBlind } from "../_connect/abdm/carecontext.js";
import { bundle, patient as sccmPatient, encounter as sccmEncounter, condition, allergyIntolerance, medicationStatement,
  observation, diagnosticReport, documentReference, immunization, invoice } from "../_connect/canonical/model.js";
import { coding, codeable } from "../_connect/canonical/coding.js";
import { NDHM_BILLING, NDHM_PRICE } from "../_connect/abdm/hip-sources/clinic-billing.js";
import { consentedStoreSource } from "../_connect/abdm/consented-store.js";
import { hmacPseudonym, makeAuditSink } from "../_connect/audit.js";
import { getCachedToken, claimAttempt, buildGenerateTokenBody } from "../_connect/abdm/linktoken.js";
import { guardedKvPut } from "../_connect/abdm/no-phi.js";
import { loadConnection, gatewayFor } from "./abdm-connect.js";

const str = (v) => (v == null ? "" : String(v).trim());
export const SOURCE_ID = "wardsynq-record";
const LOINC = "http://loinc.org";
const NDHM_ID_TYPE = "https://nrces.in/ndhm/fhir/r4/CodeSystem/ndhm-identifier-type-code";
const HEALTH_ID_SYSTEM = "https://healthid.ndhm.gov.in";

/* kind -> the HI type ABDM links it under and the NRCES profile it is served as. */
const KINDS = Object.freeze({
  DS: { hiType: "DischargeSummary", profile: "DischargeSummaryRecord" },
  RX: { hiType: "Prescription", profile: "PrescriptionRecord" },
  DR: { hiType: "DiagnosticReport", profile: "DiagnosticReportRecord" },
  IMM: { hiType: "ImmunizationRecord", profile: "ImmunizationRecord" },
  INV: { hiType: "Invoice", profile: "InvoiceRecord" },
  OPC: { hiType: "OPConsultation", profile: "OPConsultRecord" },
});
const READABLE = ["Patient", "Encounter", "Condition", "AllergyIntolerance", "Observation", "MedicationOrder", "ServiceRequest", "DiagnosticReport", "ClinicalNote", "Immunization", "Invoice"];

function hipActor() {
  return makeActor({ id: "service:abdm-hip", kind: KIND.SERVICE, tier: TIER.READ, display: "ABDM health information provider", scope: { read: READABLE, write: [] } });
}
function hipService(recordDeps, tenantId) {
  return new RecordService({ repository: recordDeps.repository, pseudonym: recordDeps.pseudonym || (async () => null), tenant: { id: tenantId },
    actor: hipActor(), role: "abdm-hip", roleSource: "wardsynq-abdm" });
}

async function sha10(s) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  return [...h].slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---- reading a stay ----------------------------------------------------------------------------------- */

/** Everything one encounter's records are made of. Any failed read throws: a record served from a partial read is
 *  worse than none, because the receiving hospital cannot tell what is missing. */
async function readStay(svc, encounterId) {
  const encounter = await svc.get("Encounter", encounterId);
  if (!encounter) { const e = new Error("encounter not found"); e.code = "encounter_not_found"; throw e; }
  const pid = encounter.patientId;
  const [patient, orders, reports, observations, requests, notes, conditions, allergies, immunizations, invoices, summary] = await Promise.all([
    svc.get("Patient", pid), svc.byPatient("MedicationOrder", pid), svc.byPatient("DiagnosticReport", pid),
    svc.byPatient("Observation", pid), svc.byPatient("ServiceRequest", pid), svc.byPatient("ClinicalNote", pid),
    svc.byPatient("Condition", pid), svc.byPatient("AllergyIntolerance", pid), svc.byPatient("Immunization", pid),
    svc.byPatient("Invoice", pid), svc.get("ClinicalNote", dischargeSummaryIdFor(encounterId)),
  ]);
  return { encounter, patient, orders: orders || [], reports: reports || [], observations: observations || [], requests: requests || [],
    notes: notes || [], conditions: conditions || [], allergies: allergies || [], immunizations: immunizations || [], invoices: invoices || [], summary };
}

/** PURE. The patient's ABHA as the record holds it, which is only under the patient's recorded consent. */
function patientAbha(p) {
  const ids = (p && p.identifiers) || [];
  const pick = (systems) => { const hit = ids.find((i) => i && systems.includes(str(i.system).toLowerCase()) && str(i.value)); return hit ? str(hit.value) : ""; };
  return { abhaAddress: pick(["abha-address"]), abhaNumber: pick(["abha-number", "abha", HEALTH_ID_SYSTEM]).replace(/\D/g, "") };
}

const native = (rows) => rows.filter((r) => r && !isExternalRecord(r));
const RX_STATUSES = ["active", "on-hold", "stopped", "completed"];
const isAdmission = (enc) => ADMISSION_CLASSES.includes(enc && enc.class);

/** PURE. What of a stay can be served, as record parts. */
function stayParts(s) {
  const encId = s.encounter.id, mine = (r) => r && r.encounterId === encId;
  const myRequests = new Set(native(s.requests).filter(mine).map((r) => r.id));
  const reports = native(s.reports).filter((r) => ["final", "corrected"].includes(r.status) && !r.awaitingVerification && (mine(r) || myRequests.has(r.serviceRequestId)));
  const orders = native(s.orders).filter((o) => mine(o) && RX_STATUSES.includes(o.status));
  const immunizations = native(s.immunizations).filter((i) => mine(i) && i.status === "completed" && str(i.vaccineCode) && systemUri(i.vaccineCodeSystem));
  const invoices = invoicesForStay(native(s.invoices), s.encounter, [], Date.now())
    .filter((inv) => statusOf(inv) !== "void" && str(inv.currency) && (inv.lines || []).length && !(inv.lines || []).some((l) => Number(l.tax) > 0));
  const signedSummary = s.summary && s.summary.signedBy && !isExternalRecord(s.summary) ? s.summary : null;
  const visitNotes = native(s.notes).filter((n) => mine(n) && n.noteType !== "discharge-summary");
  const visitConditions = native(s.conditions).filter(mine);
  return { reports, orders, immunizations, invoices, signedSummary, visitNotes, visitConditions };
}

/** The care contexts a stay offers, with their data-blind displays. */
async function careContextsForStay(s) {
  const enc = s.encounter, p = stayParts(s), out = [];
  const date = enc.periodEnd || enc.periodStart;
  const add = (kindCode, suffix, when) => {
    const kind = isAdmission(enc) ? "ipd" : "opd";
    let ref;
    try { ref = careContextRef({ kind, id: `${enc.id}:${suffix}` }); } catch { return; }   // an id with unsafe characters is not offered
    const hiType = KINDS[kindCode].hiType;
    out.push({ ref, kind: kindCode, hiType, display: assertDataBlind(careContextDisplay({ kind, date: when || date, types: [hiType] })) });
  };
  if (isAdmission(enc)) {
    if (p.signedSummary) add("DS", "DS");
    if (p.orders.length) add("RX", "RX");
    for (const r of p.reports) add("DR", "DR-" + await sha10(r.id), r.reportedAt || date);
    if (p.immunizations.length) add("IMM", "IMM");
    for (const inv of p.invoices) add("INV", "INV-" + await sha10(inv.id));
  } else if (enc.class === "ED" && (p.visitNotes.length || p.visitConditions.length)) {
    add("OPC", "OPC");
  }
  return out;
}

/** PURE. "IPD:<encounterId>:<suffix>" -> { encounterId, kind, hash }, or null. */
function parseWardsynqRef(ref) {
  const m = /^(IPD|OPD):(.+):(DS|RX|IMM|OPC|DR-[0-9a-f]{10}|INV-[0-9a-f]{10})$/.exec(str(ref));
  if (!m) return null;
  const [kind, hash] = m[3].split("-");
  return { encounterId: m[2], kind, hash: hash || null };
}

/* ---- projecting one record to SCCM ------------------------------------------------------------------- */

const FHIR_SEX = { male: "male", female: "female", other: "other", m: "male", f: "female", o: "other" };
const ENC_CLASS = { IPD: "IMP", ICU: "IMP", MATERNITY: "IMP", PEDIATRICS: "IMP", NICU: "IMP", ED: "EMER" };
const iso = (v) => { const t = Date.parse(str(v)); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const words = (k) => str(k).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

function projectPatient(s, tenantId) {
  const p = s.patient || {}, abha = patientAbha(p);
  const identifiers = [{ system: `https://wardsynq.com/fhir/mrn/${tenantId}`, value: str(p.mrn) || str(p.id) }];
  // NRCES ndhm-identifier-type-code: HIN is the 14-digit Health ID number, ABHA the ABHA (address) ID.
  if (abha.abhaNumber.length === 14) identifiers.push({ system: HEALTH_ID_SYSTEM, value: abha.abhaNumber.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})$/, "$1-$2-$3-$4"), type: { system: NDHM_ID_TYPE, code: "HIN", display: "Health ID issued by NDHM" } });
  if (abha.abhaAddress) identifiers.push({ system: HEALTH_ID_SYSTEM, value: abha.abhaAddress, type: { system: NDHM_ID_TYPE, code: "ABHA", display: "Ayushman Bharat Health Account (ABHA) ID" } });
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(str(p.dob)) && str(p.dob) !== "0000-00-00" ? str(p.dob) : null;
  return sccmPatient({ id: p.id, identifiers, name: p.name ? { text: str(p.name) } : null, gender: FHIR_SEX[str(p.sex).toLowerCase()] || "unknown", birthDate: dob });
}
function projectEncounter(enc) {
  const e = sccmEncounter({ id: enc.id, status: enc.status === "finished" ? "finished" : "in-progress", class: ENC_CLASS[enc.class] || "AMB",
    period: { start: iso(enc.periodStart), ...(enc.periodEnd ? { end: iso(enc.periodEnd) } : {}) } });
  return e;
}
const orderLine = (o) => [str(o.drug), o.dose && o.dose.value != null ? `${o.dose.value} ${str(o.dose.unit)}`.trim() : "", str(o.route), str(o.frequency)].filter(Boolean).join(" ");
function projectOrder(o) {
  const coded = str(o.drugCode) && systemUri(o.drugCodeSystem) ? [coding({ system: systemUri(o.drugCodeSystem), code: str(o.drugCode), display: str(o.drug) })] : [];
  const m = medicationStatement({ id: o.id, medication: codeable({ coding: coded, text: str(o.drug) }), origin: "order", status: o.status, dosage: { text: orderLine(o) || "As directed" } });
  m.authoredOn = iso(o.meta && o.meta.recordedAt) || null;
  return m;
}
function projectObservation(o) {
  const system = /^loinc$/i.test(str(o.codeSystem)) ? LOINC : systemUri(o.codeSystem) || null;
  const code = codeable({ coding: system ? [coding({ system, code: str(o.code), display: str(o.display || o.code) })] : [], text: str(o.display || o.code) });
  const numeric = typeof o.value === "number";
  return observation({ id: o.id, category: str(o.category) || null, code, status: "final", effectiveDateTime: iso(o.effectiveAt || (o.meta && o.meta.recordedAt)),
    value: numeric ? { value: o.value, unit: str(o.unit) || null, ...(o.unit ? { system: "http://unitsofmeasure.org", code: str(o.unit) } : {}) } : (o.value != null ? { text: String(o.value) } : null) });
}
function projectReport(r) {
  return diagnosticReport({ id: r.id, code: codeable({ text: str(r.code) || "Report" }), status: r.status, category: str(r.category) || null,
    effectiveDateTime: iso(r.reportedAt || (r.meta && r.meta.recordedAt)), conclusion: str(r.conclusion || r.impression) || null,
    results: (r.resultObservationIds || []).map((id) => ({ type: "Observation", id })) });
}
const narrativeDoc = (id, title, text, date) => documentReference({ id, status: "current", type: codeable({ text: title }), date, text });

/** The SCCM record for one care context of a stay. PURE apart from the report/invoice id hashing. */
async function projectStayRecord(s, parsed, { tenantId, now }) {
  const enc = s.encounter, p = stayParts(s), kind = parsed.kind, generatedAt = (now && now()) || new Date().toISOString();
  const base = { tenantId, sourceConnector: SOURCE_ID, generatedAt, patient: projectPatient(s, tenantId), encounters: [projectEncounter(enc)] };
  let rec = null;
  if (kind === "DS" && p.signedSummary) {
    const secs = p.signedSummary.sections || {};
    const text = Object.keys(secs).filter((k) => str(secs[k])).map((k) => `${words(k)}: ${str(secs[k])}`).join("\n");
    rec = bundle({ ...base, conditions: native(s.conditions).map((c) => condition({ id: c.id, code: codeable({ text: str(c.display || c.code) }), clinicalStatus: c.clinicalStatus })),
      allergies: s.allergies.map((a) => allergyIntolerance({ id: a.id, code: codeable({ text: str(a.substance) }), criticality: a.criticality })),
      medications: p.orders.map(projectOrder), documents: [narrativeDoc(p.signedSummary.id, "Discharge summary", text || "Discharge summary", generatedAt)] });
  } else if (kind === "RX" && p.orders.length) {
    rec = bundle({ ...base, medications: p.orders.map(projectOrder), documents: [narrativeDoc(`${enc.id}-rx`, "Prescription", p.orders.map(orderLine).join("\n"), generatedAt)] });
  } else if (kind === "DR") {
    let report = null;
    for (const r of p.reports) if ((await sha10(r.id)) === parsed.hash) report = r;
    if (report) {
      const obs = s.observations.filter((o) => (report.resultObservationIds || []).includes(o.id));
      rec = bundle({ ...base, diagnosticReports: [projectReport(report)], observations: obs.map(projectObservation),
        documents: [narrativeDoc(`${report.id}-text`, "Diagnostic report", [str(report.code), str(report.conclusion || report.impression)].filter(Boolean).join(": ") || "Diagnostic report", generatedAt)] });
    }
  } else if (kind === "IMM" && p.immunizations.length) {
    rec = bundle({ ...base, immunizations: p.immunizations.map((i) => immunization({ id: i.id, status: "completed", occurrenceDateTime: iso(i.occurredOn) || str(i.occurredOn),
      vaccineCode: codeable({ coding: [coding({ system: systemUri(i.vaccineCodeSystem), code: str(i.vaccineCode), display: str(i.vaccine) })], text: str(i.vaccine) }),
      doseNumber: i.doseNumber || undefined, lotNumber: str(i.lotNumber) || undefined })),
      documents: [narrativeDoc(`${enc.id}-imm`, "Immunization record", p.immunizations.map((i) => `${str(i.vaccine)} ${str(i.occurredOn)}`).join("\n"), generatedAt)] });
  } else if (kind === "INV") {
    let inv = null;
    for (const x of p.invoices) if ((await sha10(x.id)) === parsed.hash) inv = x;
    if (inv) {
      const cur = str(inv.currency), money = (v) => ({ value: Math.round((Number(v) || 0) * 100) / 100, currency: cur });
      const total = chargeTotal(inv);
      rec = bundle({ ...base, invoices: [invoice({ id: inv.id, identifierValue: inv.id, status: statusOf(inv) === "paid" ? "balanced" : "issued",
        type: codeable({ coding: [coding({ system: NDHM_BILLING, code: "02", display: "IPD" })], text: "IPD" }), date: iso(((inv.events || [])[0] || {}).at),
        lineItems: inv.lines.map((l, i) => ({ sequence: i + 1, chargeItem: codeable({ coding: [coding({ system: NDHM_BILLING, code: "02", display: "IPD" })], text: str(l.display || l.code) || "charge" }),
          priceComponents: [{ type: "base", code: codeable({ coding: [coding({ system: NDHM_PRICE, code: "01", display: "Rate" })], text: "Rate" }), amount: money(l.amount), factor: Math.max(1, Number(l.quantity) || 1) }] })),
        totalNet: money(total), totalGross: money(total), encounter: { type: "Encounter", id: enc.id } })],
        documents: [narrativeDoc(`${inv.id}-text`, "Invoice Record", `Invoice ${inv.id}, total ${cur} ${total.toFixed(2)}`, generatedAt)] });
    }
  } else if (kind === "OPC" && enc.class === "ED") {
    rec = bundle({ ...base, conditions: p.visitConditions.map((c) => condition({ id: c.id, code: codeable({ text: str(c.display || c.code) }), clinicalStatus: c.clinicalStatus })),
      allergies: s.allergies.map((a) => allergyIntolerance({ id: a.id, code: codeable({ text: str(a.substance) }), criticality: a.criticality })),
      medications: p.orders.map(projectOrder), observations: s.observations.filter((o) => o.encounterId === enc.id).map(projectObservation),
      documents: [narrativeDoc(`${enc.id}-opc`, "Clinical consultation report", p.visitNotes.map((n) => Object.values(n.sections || {}).map(str).filter(Boolean).join(" ")).filter(Boolean).join("\n") || "Emergency visit", generatedAt)] });
  }
  if (!rec) return null;
  rec.profile = KINDS[kind].profile;
  rec.recordType = KINDS[kind].profile;
  return rec;
}

/* ---- the HIP source ------------------------------------------------------------------------------------ */

/**
 * opts: { recordDepsFor(env, tenantId) -> { repository, pseudonym }, facilityFor(env, tenantId) -> Promise<{hfrId, name}|null> }
 * loadRecord throws on anything it cannot serve truthfully; serveTransfer then refuses or reports the context failed.
 */
function wardsynqHipSource(opts) {
  return {
    id: SOURCE_ID,
    hiTypes: Object.values(KINDS).map((k) => k.hiType),
    async listCareContexts(env, deps, { tenantId, patientAbhaHash } = {}) {
      if (!deps || !deps.db || !tenantId || !patientAbhaHash) return [];
      const { results = [] } = await deps.db.prepare("SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, patientAbhaHash).all();
      return results.filter((r) => r.source === SOURCE_ID).map((r) => ({ referenceNumber: r.ref, display: r.display, hiType: r.hi_type }));
    },
    async loadRecord(env, deps, { tenantId, careContextRef: ref } = {}) {
      const parsed = parseWardsynqRef(ref);
      if (!parsed) throw new Error("not a WardSynQ care context");
      const s = await readStay(hipService(opts.recordDepsFor(env, tenantId), tenantId), parsed.encounterId);
      const abha = patientAbha(s.patient);
      if (!abha.abhaAddress) throw new Error("the patient's ABHA address is no longer on the record under consent");
      const record = await projectStayRecord(s, parsed, { tenantId, now: () => new Date().toISOString() });
      if (!record) throw new Error("this record is no longer servable");
      record.facility = opts.facilityFor ? await opts.facilityFor(env, tenantId) : null;
      return { record, patientAbhaHash: await hmacPseudonym(env, tenantId, abha.abhaAddress), hiType: KINDS[parsed.kind].hiType, recordType: KINDS[parsed.kind].profile };
    },
  };
}

/** One source for the receiver: a context registered by WardSynQ is served from the record, every other one as before. */
function hipSourceFor(wardsynq, fallback) {
  const other = fallback || consentedStoreSource;
  return {
    id: "composite",
    hiTypes: [...new Set([...wardsynq.hiTypes, ...other.hiTypes])],
    async listCareContexts(env, deps, args) {
      return [...(await wardsynq.listCareContexts(env, deps, args)), ...(await other.listCareContexts(env, deps, args))];
    },
    async loadRecord(env, deps, args) {
      const row = deps && deps.db ? await deps.db.prepare("SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND ref=?").bind(args.tenantId, args.careContextRef).first() : null;
      return row && row.source === SOURCE_ID ? wardsynq.loadRecord(env, deps, args) : other.loadRecord(env, deps, args);
    },
  };
}

/* ---- registering and linking ----------------------------------------------------------------------------- */

const PENDING = (hipId, hash) => `connect:abdm:linkpending:${hipId}:${hash}`;
const GENDER = { male: "M", female: "F", other: "O", m: "M", f: "F", o: "O" };

/** Register each care context row once (discoverable and servable at once). Returns the refs newly registered. */
async function registerContexts(env, db, { tenantId, patientHash, contexts, now }) {
  const added = [];
  for (const c of contexts) {
    const id = await hmacPseudonym(env, tenantId, `carecontext:${patientHash}:${c.ref}`);
    const existing = await db.prepare("SELECT * FROM connect_abdm_carecontext WHERE id=?").bind(id).first();
    if (existing) continue;
    const res = await db.prepare("INSERT INTO connect_abdm_carecontext (id,tenant_id,patient_abha_hash,source,ref,hi_type,display,linked_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, tenantId, patientHash, SOURCE_ID, c.ref, c.hiType, c.display, now).run();
    if (!res || res.success === false) throw new Error("care context registration failed");
    added.push(c.ref);
  }
  return added;
}

/** PURE. The link/carecontext body (M2 v2.7 4.3): one patient entry per HI type, count = its contexts. No ABHA number. */
function linkBody({ abhaAddress, patientRef, contexts }) {
  const groups = new Map();
  for (const c of contexts) { if (!groups.has(c.hiType)) groups.set(c.hiType, []); groups.get(c.hiType).push({ referenceNumber: c.ref, display: c.display }); }
  return { abhaAddress, patient: [...groups.entries()].map(([hiType, careContexts]) => ({ referenceNumber: patientRef, display: "Hospital records", careContexts, hiType, count: careContexts.length })) };
}

/**
 * The stay's care contexts, registered and linked at ABDM (or a link token requested). Never throws.
 * ctx: { tenantId, encounterId, recordDeps, trigger, fetchImpl?, kv? } -> { ok, state, registered, contexts, reason? }
 * state: "not-connected" | "no-abha" | "nothing-to-link" | "linked-requested" | "token-requested" | "failed"
 */
async function linkStayCareContexts(env, ctx) {
  const tenantId = ctx.tenantId, db = env.CONNECT_DB, now = new Date().toISOString();
  const audit = db ? makeAuditSink(env, db) : async () => {};
  const say = (state, extra) => ({ ok: state !== "failed", state, ...(extra || {}) });
  try {
    const conn = await loadConnection(env, ctx.recordDeps.repository, tenantId);
    if (!conn.connected) return say("not-connected", { reason: conn.code });
    if (!db) return say("failed", { reason: "no_connect_db" });
    const s = await readStay(hipService(ctx.recordDeps, tenantId), ctx.encounterId);
    const abha = patientAbha(s.patient);
    if (!abha.abhaAddress) return say("no-abha");
    const patientHash = await hmacPseudonym(env, tenantId, abha.abhaAddress);
    const contexts = await careContextsForStay(s);
    if (!contexts.length) {
      await audit({ action: "abdm.hip.link.skipped", outcome: "skipped", ts: now, tenantId, patientRefHash: patientHash, scope: { trigger: ctx.trigger, reason: "nothing-final" } }).catch(() => null);
      return say("nothing-to-link");
    }
    const registered = await registerContexts(env, db, { tenantId, patientHash, contexts, now });
    await audit({ action: "abdm.hip.registered", outcome: "ok", ts: now, tenantId, patientRefHash: patientHash, resourceCounts: { careContexts: contexts.length, newlyRegistered: registered.length }, scope: { trigger: ctx.trigger } }).catch(() => null);

    const kv = ctx.kv || env.MAIK_KV, gw = gatewayFor(env, conn, { fetchImpl: ctx.fetchImpl, kv });
    const token = await getCachedToken({ kv, now: () => new Date().toISOString() }, { hipId: conn.hipId, abhaHash: patientHash });
    if (token) {
      const r = await gw.post("linkCareContext", linkBody({ abhaAddress: abha.abhaAddress, patientRef: patientHash, contexts }), { "X-LINK-TOKEN": token });
      await audit({ action: "abdm.hip.link.requested", outcome: "ok", ts: now, tenantId, patientRefHash: patientHash, transactionId: r.requestId, resourceCounts: { careContexts: contexts.length }, scope: { trigger: ctx.trigger, httpStatus: r.status } }).catch(() => null);
      return say("linked-requested", { registered: registered.length, contexts: contexts.length });
    }
    // No token yet: remember WHICH contexts wait for it (hashes of the references, never a reference), then ask.
    const refHashes = await Promise.all(contexts.map((c) => sha10(c.ref)));
    let prior = [];
    try { prior = JSON.parse((kv && (await kv.get(PENDING(conn.hipId, patientHash)))) || "[]"); } catch { prior = []; }
    if (kv) await guardedKvPut(kv, PENDING(conn.hipId, patientHash), JSON.stringify([...new Set([...prior, ...refHashes])]), { expirationTtl: 7 * 24 * 3600 });
    const p = s.patient || {};
    const yob = /^\d{4}/.test(str(p.dob)) && !str(p.dob).startsWith("0000") ? Number(str(p.dob).slice(0, 4)) : null;
    const { body } = buildGenerateTokenBody({ abhaAddress: abha.abhaAddress, name: str(p.name), gender: GENDER[str(p.sex).toLowerCase()] || "O", yearOfBirth: yob });
    await claimAttempt({ kv, now: () => new Date().toISOString() }, { hipId: conn.hipId, abhaHash: patientHash });
    const r = await gw.post("tokenGenerate", body);
    await audit({ action: "abdm.hip.linktoken.requested", outcome: "ok", ts: now, tenantId, patientRefHash: patientHash, transactionId: r.requestId, resourceCounts: { careContexts: contexts.length }, scope: { trigger: ctx.trigger, httpStatus: r.status } }).catch(() => null);
    return say("token-requested", { registered: registered.length, contexts: contexts.length });
  } catch (e) {
    await audit({ action: "abdm.hip.link.failed", outcome: "failed", ts: now, tenantId, scope: { trigger: ctx.trigger, code: str(e && (e.code || e.name)).slice(0, 40) || "error" } }).catch(() => null);
    return say("failed", { reason: str(e && (e.code || e.message)).slice(0, 120) });
  }
}

/**
 * The link token arrived (functions/api/v3 on-generate-token): link the WardSynQ contexts that were waiting for it.
 * deps: { db, kv, gateway, audit, now }. args: { tenantId, hipId, abhaAddress, token }. Never throws.
 */
async function linkPendingAfterToken(env, deps, { tenantId, hipId, abhaAddress, token }) {
  try {
    if (!deps.kv || !deps.db || !abhaAddress || !token) return { linked: 0 };
    const patientHash = await hmacPseudonym(env, tenantId, abhaAddress);
    let pending = [];
    try { pending = JSON.parse((await deps.kv.get(PENDING(hipId, patientHash))) || "[]"); } catch { pending = []; }
    if (!pending.length) return { linked: 0 };
    const { results = [] } = await deps.db.prepare("SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, patientHash).all();
    const contexts = [];
    for (const r of results) if (r.source === SOURCE_ID && pending.includes(await sha10(r.ref))) contexts.push({ ref: r.ref, hiType: r.hi_type, display: r.display });
    if (!contexts.length) return { linked: 0 };
    const r = await deps.gateway.post("linkCareContext", linkBody({ abhaAddress, patientRef: patientHash, contexts }), { "X-LINK-TOKEN": token });
    try { await deps.kv.delete(PENDING(hipId, patientHash)); } catch { /* the next token repeats an already-linked context, which ABDM answers ABDM-1056 */ }
    if (deps.audit) await deps.audit({ action: "abdm.hip.link.requested", outcome: "ok", ts: new Date().toISOString(), tenantId, patientRefHash: patientHash, transactionId: r.requestId, resourceCounts: { careContexts: contexts.length }, scope: { trigger: "link-token", httpStatus: r.status } }).catch(() => null);
    return { linked: contexts.length };
  } catch (e) {
    if (deps.audit) await deps.audit({ action: "abdm.hip.link.failed", outcome: "failed", ts: new Date().toISOString(), tenantId, scope: { trigger: "link-token", code: str(e && e.name) || "error" } }).catch(() => null);
    return { linked: 0, error: true };
  }
}

export {
  KINDS, READABLE, readStay, patientAbha, stayParts, careContextsForStay, parseWardsynqRef, projectStayRecord,
  wardsynqHipSource, hipSourceFor, registerContexts, linkBody, linkStayCareContexts, linkPendingAfterToken,
};
