/* functions/_wardsynq/abdm-chart.js - ABDM on a patient's chart: this hospital's records linked to the patient's ABHA
 * (HIP, abdm-hip.js) and records asked for from other facilities (HIU, design S6 3.5).
 *
 *   GET  /ward/abdm-records         what is linked, every request with its consent status, and what has been filed
 *   POST /ward/abdm-link-stay       register and link one stay's records now (the retry for a discharge that could not)
 *   POST /ward/abdm-consent-request ask the patient, through their ABHA app, for records from other facilities
 *   POST /ward/abdm-fetch           fetch the records a GRANTED consent covers; they land through abdm-land.js
 *
 * The consent request names the doctor by registration number (resolveClinicalActor's credential), uses this
 * hospital's own HIU ID, and goes through functions/_connect/abdm/hiu.js unchanged in what it checks: the consent is
 * re-read and re-validated before any data request, the window is clamped to the grant, and the 14-day re-fetch
 * rule holds. Received data is filed as DRAFT on behalf of the requester, MPI-reconciled (abdm-land.js), and stays on
 * the chart marked as received under that consent even if the consent is later withdrawn (owner A4).
 *
 * Status words are the consent row's own (INITIATED, GRANTED, DENIED, REVOKED, EXPIRED); nothing is shown as granted
 * that the verified artefact did not grant. An unreadable list is a failure, never an empty list.
 */

import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { hmacPseudonym, makeAuditSink } from "../_connect/audit.js";
import { makeSecrets } from "../_connect/secrets.js";
import { requestConsent, requestHealthInformation } from "../_connect/abdm/hiu.js";
import { AbdmError } from "../_connect/abdm/gateway.js";
import { HI_TYPES } from "../_connect/abdm/carecontext.js";
import { loadConnection, connectionView, gatewayFor } from "./abdm-connect.js";
import { patientAbha, careContextsForStay, stayParts, linkStayCareContexts, READABLE } from "./abdm-hip.js";
import { dischargeSummaryIdFor } from "./migrate-discharge.js";

const str = (v) => (v == null ? "" : String(v).trim());
const PURPOSES = Object.freeze({ CAREMGT: "Care Management", BTG: "Break the Glass", HPAYMT: "Healthcare Payment" });
const DAY = 86400000;
const LANDED_TYPES = ["Encounter", "Condition", "AllergyIntolerance", "Observation", "MedicationOrder", "DiagnosticReport", "ClinicalNote", "Immunization", "ImagingStudy"];

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** The patient, their ABHA under consent and its pseudonym, and the hospital's connection. */
async function patientContext(request, env, ctx, need) {
  const o = await open(request, env, ctx, need);
  if (o.error) return o;
  let patient, conn;
  try { patient = await o.svc.get("Patient", str(ctx.patientId)); conn = await loadConnection(env, ctx.recordDeps.repository, ctx.migration.tenantId); }
  catch { return { error: { ok: false, status: 502, error: "record_read_failed", message: "The patient or this hospital's ABDM profile could not be read." } }; }
  if (!patient) return { error: { ok: false, status: 404, error: "patient_not_found" } };
  const abha = patientAbha(patient);
  const hash = abha.abhaAddress && env.CONNECT_HMAC_SALT ? await hmacPseudonym(env, ctx.migration.tenantId, abha.abhaAddress) : null;
  return { ...o, patient, conn, abha, hash };
}

/** GET. ctx: { migration, actorDeps, recordDeps, patientId } */
async function abdmRecordsView(request, env, ctx) {
  const c = await patientContext(request, env, ctx, "record:read");
  if (c.error) return c.error;
  const tenantId = ctx.migration.tenantId, db = env.CONNECT_DB;
  const out = { ok: true, connection: connectionView(c.conn), purposes: Object.entries(PURPOSES).map(([code, text]) => ({ code, text })), hiTypes: HI_TYPES,
    abha: { onRecord: !!c.abha.abhaAddress, last4: c.abha.abhaNumber ? c.abha.abhaNumber.slice(-4) : null } };
  if (!c.hash || !db) return { ...out, stays: [], requests: [], received: [] };

  try {
    // This hospital's stays and what each offers, next to what is registered and what ABDM answered.
    const encounters = (await c.svc.byPatient("Encounter", c.patient.id)).filter((e) => e && (e.class === "ED" || ["IPD", "ICU", "MATERNITY", "PEDIATRICS", "NICU"].includes(e.class)))
      .sort((a, b) => String(b.periodStart || "").localeCompare(String(a.periodStart || ""))).slice(0, 10);
    /* A type this reader's role may not read is named, never shown as nothing: what a stay offers may be more than listed. */
    const shared = {}, unreadable = [];
    for (const t of READABLE.filter((x) => !["Patient", "Encounter"].includes(x))) {
      try { shared[t] = await c.svc.byPatient(t, c.patient.id); } catch { shared[t] = []; unreadable.push(t); }
    }
    out.unreadableTypes = unreadable;
    const { results: rows = [] } = await db.prepare("SELECT * FROM connect_abdm_carecontext WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, c.hash).all();
    const { results: events = [] } = await db.prepare("SELECT * FROM connect_audit_event WHERE tenant_id=? AND patient_ref_hash=?").bind(tenantId, c.hash).all();
    const results = [];
    for (const e of events.filter((x) => x.action === "abdm.hip.link.requested" && x.transaction_id)) {
      const { results: r = [] } = await db.prepare("SELECT * FROM connect_audit_event WHERE transaction_id=? AND action=?").bind(e.transaction_id, "abdm.link.result").all();
      results.push(...r);
    }
    out.stays = [];
    for (const enc of encounters) {
      const stay = { encounter: enc, patient: c.patient, orders: shared.MedicationOrder, reports: shared.DiagnosticReport, observations: shared.Observation, requests: shared.ServiceRequest,
        notes: shared.ClinicalNote, conditions: shared.Condition, allergies: shared.AllergyIntolerance, immunizations: shared.Immunization, invoices: shared.Invoice,
        summary: (shared.ClinicalNote || []).find((n) => n.id === dischargeSummaryIdFor(enc.id)) || null };
      const offers = await careContextsForStay(stay);
      out.stays.push({ encounterId: enc.id, class: enc.class, status: enc.status, admittedAt: enc.periodStart || null, dischargedAt: enc.periodEnd || null,
        unsignedSummary: !!(stay.summary && !stayParts(stay).signedSummary),
        records: offers.map((o) => ({ hiType: o.hiType, display: o.display, registered: rows.some((r) => r.ref === o.ref) })) });
    }
    out.linkEvents = events.filter((x) => /^abdm\.(hip\.|link\.result)/.test(x.action)).concat(results)
      .map((x) => ({ action: x.action, outcome: x.outcome, at: x.ts, transactionId: x.transaction_id || null, detail: safeScope(x.scope) }))
      .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20);

    // Requests this hospital made for this patient, newest first.
    const { results: reqs = [] } = await db.prepare("SELECT * FROM connect_abdm_consent_req WHERE tenant_id=? AND patient_abha_hash=?").bind(tenantId, c.hash).all();
    out.requests = reqs.filter((r) => r.actor).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((r) => ({
      requestId: r.request_id, status: r.status, consentGranted: !!r.consent_id, hiTypes: parseList(r.hi_types), purpose: parseObj(r.purpose),
      dateRange: parseObj(r.date_range), requestedAt: r.created_at, updatedAt: r.updated_at, expiresAt: r.expires_at || null, lastFetchedAt: r.last_fetched_at || null,
      requestedBy: r.actor }));

    // What arrived and was filed: the records whose source is ABDM.
    const received = [];
    for (const t of LANDED_TYPES) {
      const rowsOfType = t === "Encounter" ? await c.svc.byPatient(t, c.patient.id) : (shared[t] || await c.svc.byPatient(t, c.patient.id).catch(() => []));
      for (const r of rowsOfType || []) {
        if (!(r && r.meta && r.meta.source && r.meta.source.system === "abdm")) continue;
        received.push({ type: t, id: r.id, what: str(r.display || r.drug || r.vaccine || r.substance || r.noteType || r.code || r.class) || t, status: r.status || null, recordedAt: (r.meta && r.meta.recordedAt) || null });
      }
    }
    out.received = received.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
  } catch {
    return { ok: false, status: 502, error: "abdm_records_read_failed", message: "What this patient has linked or requested through ABDM could not be read. This is not the same as there being nothing." };
  }
  return out;
}
const parseList = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } };
const parseObj = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const safeScope = (v) => { const o = parseObj(v) || {}; return { trigger: o.trigger || null, status: o.status || null, code: o.code || null, reason: o.reason || null }; };

/** POST. ctx: { ..., patientId, encounterId } */
async function abdmLinkStay(request, env, ctx) {
  const c = await patientContext(request, env, ctx, "record:read");
  if (c.error) return c.error;
  if (!c.conn.connected) return { ok: false, status: 409, error: "abdm_not_connected", code: c.conn.code, message: c.conn.reason };
  if (!c.abha.abhaAddress) return { ok: false, status: 409, error: "no_abha", message: "This patient has no ABHA address on the record with consent to link, so nothing can be linked." };
  // The stay must be this patient's: the checks above were made for the patient named, not for whoever the stay belongs to.
  let enc;
  try { enc = await c.svc.get("Encounter", str(ctx.encounterId)); }
  catch { return { ok: false, status: 502, error: "record_read_failed", message: "The stay could not be read, so nothing was linked." }; }
  if (!enc || enc.patientId !== c.patient.id) return { ok: false, status: 404, error: "encounter_not_found", message: "No such stay for this patient." };
  const r = await linkStayCareContexts(env, { tenantId: ctx.migration.tenantId, encounterId: str(ctx.encounterId), recordDeps: ctx.recordDeps, trigger: "chart", fetchImpl: ctx.fetchImpl, kv: ctx.kv });
  if (!r.ok) return { ok: false, status: 502, error: "abdm_link_failed", message: "The stay's records could not be linked. Nothing was reported to ABDM as linked.", detail: r.reason || null };
  return { ok: true, ...r };
}

/** POST. ctx: { ..., patientId, purpose, hiTypes, from, to, expiresOn } */
async function abdmConsentRequest(request, env, ctx) {
  const c = await patientContext(request, env, ctx, "record:read");
  if (c.error) return c.error;
  if (!c.conn.connected) return { ok: false, status: 409, error: "abdm_not_connected", code: c.conn.code, message: c.conn.reason };
  if (!c.abha.abhaAddress) return { ok: false, status: 409, error: "no_abha", message: "This patient has no ABHA address on the record with consent, so ABDM cannot be asked for their records." };
  const code = str(ctx.purpose);
  if (!PURPOSES[code]) return { ok: false, status: 422, error: "purpose_required", message: "Choose why the records are needed." };
  const hiTypes = (Array.isArray(ctx.hiTypes) ? ctx.hiTypes : []).map(str).filter((t) => HI_TYPES.includes(t));
  if (!hiTypes.length) return { ok: false, status: 422, error: "hi_types_required", message: "Choose at least one kind of record." };
  const from = Date.parse(str(ctx.from)), to = Date.parse(str(ctx.to)), erase = Date.parse(str(ctx.expiresOn));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return { ok: false, status: 422, error: "date_range_required", message: "Give the period the records are from, with the start before the end." };
  if (to > Date.now() + DAY) return { ok: false, status: 422, error: "date_range_future", message: "The period cannot end in the future." };
  if (!Number.isFinite(erase) || erase <= Date.now()) return { ok: false, status: 422, error: "expiry_required", message: "Say until when this hospital may keep access, a date after today." };
  const regNo = str(c.resolved.actor && c.resolved.actor.credential);
  if (!regNo) return { ok: false, status: 422, error: "requester_registration_required", message: "ABDM names the doctor asking by medical registration number. Ask the hospital admin to add your registration number on the Staff tab, then try again." };

  const gateway = gatewayFor(env, c.conn, { fetchImpl: ctx.fetchImpl, kv: ctx.kv });
  const deps = { db: env.CONNECT_DB, kv: ctx.kv || env.MAIK_KV, secrets: makeSecrets(env), gateway, audit: makeAuditSink(env, env.CONNECT_DB), now: () => new Date().toISOString() };
  try {
    const out = await requestConsent(env, deps, {
      resolved: { actorId: c.resolved.actor.id, tenantId: ctx.migration.tenantId }, hiuId: c.conn.hiuId,
      abhaAddress: c.abha.abhaAddress, purpose: { code, text: PURPOSES[code] }, hiTypes,
      dateRange: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, dataEraseAt: new Date(erase).toISOString(),
      requester: { name: str(c.resolved.actor.display), identifier: { type: "REGNO", value: regNo, system: "https://www.mciindia.org" } },
    });
    return { ok: true, requestId: out.requestId, status: out.status };
  } catch (e) {
    return { ok: false, status: e instanceof AbdmError ? 502 : 422, error: e instanceof AbdmError ? "abdm_unavailable" : "consent_request_refused",
      message: e instanceof AbdmError ? "ABDM did not accept the request. Nothing was recorded as requested." : "The request was refused before it reached ABDM. Nothing was recorded as requested." };
  }
}

/** POST. ctx: { ..., patientId, requestId } */
async function abdmFetch(request, env, ctx) {
  const c = await patientContext(request, env, ctx, "record:read");
  if (c.error) return c.error;
  if (!c.conn.connected) return { ok: false, status: 409, error: "abdm_not_connected", code: c.conn.code, message: c.conn.reason };
  if (!str(env.CONNECT_ABDM_DATA_PUSH_URL)) return { ok: false, status: 409, error: "receiver_not_configured", message: "This server has no address for ABDM to deliver records to, so a fetch would never arrive. Nothing was requested." };
  let row;
  try { row = await env.CONNECT_DB.prepare("SELECT * FROM connect_abdm_consent_req WHERE request_id=?").bind(str(ctx.requestId)).first(); }
  catch { return { ok: false, status: 502, error: "record_read_failed" }; }
  // The request must be this hospital's, for this patient, and granted with a verified artefact.
  if (!row || row.tenant_id !== ctx.migration.tenantId || row.patient_abha_hash !== c.hash) return { ok: false, status: 404, error: "request_not_found" };
  if (row.status !== "GRANTED" || !row.consent_id || !row.care_contexts) return { ok: false, status: 409, error: "consent_not_granted", message: "The patient has not granted this request, or ABDM has not delivered what they granted yet." };
  const gateway = gatewayFor(env, c.conn, { fetchImpl: ctx.fetchImpl, kv: ctx.kv });
  const deps = { db: env.CONNECT_DB, kv: ctx.kv || env.MAIK_KV, secrets: makeSecrets(env), gateway, audit: makeAuditSink(env, env.CONNECT_DB), now: () => new Date().toISOString() };
  try {
    const out = await requestHealthInformation(env, deps, { resolved: { actorId: c.resolved.actor.id, tenantId: ctx.migration.tenantId }, consentId: row.consent_id,
      careContexts: parseList(row.care_contexts), hiTypes: parseList(row.hi_types), purpose: parseObj(row.purpose), dateRange: parseObj(row.date_range) });
    return { ok: true, requestId: out.requestId, status: out.status };
  } catch (e) {
    return { ok: false, status: e instanceof AbdmError ? 502 : 409, error: e instanceof AbdmError ? "abdm_unavailable" : "fetch_refused",
      message: e instanceof AbdmError ? "ABDM did not accept the fetch. Nothing was recorded as fetched." : `The fetch was refused: ${str(e && e.message)}. Nothing was requested.` };
  }
}

export { PURPOSES, abdmRecordsView, abdmLinkStay, abdmConsentRequest, abdmFetch };
