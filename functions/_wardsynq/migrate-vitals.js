/* functions/_wardsynq/migrate-vitals.js — the first clinical write to move onto the record: nurse vitals.
 *
 * Today a nurse's vitals are one line of text ("BP 128/82 · Pulse 78/min · SpO2 98%") appended to the
 * OPD encounter timeline, encrypted, in a Firestore document that self-expires. That is a receipt for
 * the visit, not a clinical record: nothing downstream can score it, trend it or be alerted by it.
 * This module writes the same vitals, structured and coded, to the WardSynQ record, through the same
 * door and the same governed actor every other record write uses.
 *
 * STRANGLER FIG, per tenant, three modes, from connect_tenant.settings.wardsynq.migrations.vitals:
 *
 *   off            (default) nothing here runs; the timeline handler is byte-for-byte what it was
 *   shadow         the timeline is written first and its result returned; the record write happens
 *                  afterwards, its outcome reported on the response and audited, never thrown
 *   authoritative  the record write happens FIRST and must succeed; the timeline is then written as
 *                  the shadow so every screen that reads it keeps working
 *
 * The whole thing is additionally behind WARDSYNQ_RECORD=1, and needs the OPD organisation to name
 * its Connect tenant (org.connectTenantId). Any of those absent means "off", quietly, because a
 * hospital that has not opted in must see no difference at all.
 *
 * WHAT IS RECORDED. One Observation per value, LOINC-coded, UCUM units, as reported, with no unit
 * conversion (the form takes Fahrenheit and Fahrenheit is what is stored). The free-text note, if
 * any, travels on each observation as `sourceText`. Ids are stable in the ticket and the values'
 * timestamp, so a retried save versions rather than duplicates, and every write carries an
 * idempotency key besides.
 *
 * WHAT IS NOT. No Patient record is created here: a nurse's grant is Observation only, and the
 * ticket carries an MRN but no demographics. The observations are filed under a patient id derived
 * from the MRN (`opd-pat-<mrn>`), which is what the patient registration migration will also use, so
 * they attach to the master the moment it exists. A ticket with no MRN cannot be filed and says so.
 *
 * Nothing here is a clinical rule. No threshold, no score, no alert. The safety engine will read
 * these observations when a site wires it; this file only makes them exist.
 */

import { Observation } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const MODES = Object.freeze(["off", "shadow", "authoritative"]);

/** LOINC codes and UCUM units for the six values the OPD form takes. Recorded AS REPORTED. */
const VITAL_CODES = Object.freeze({
  sbp:    Object.freeze({ code: "8480-6",  display: "Systolic blood pressure",  unit: "mm[Hg]" }),
  dbp:    Object.freeze({ code: "8462-4",  display: "Diastolic blood pressure", unit: "mm[Hg]" }),
  pulse:  Object.freeze({ code: "8867-4",  display: "Heart rate",               unit: "/min" }),
  temp:   Object.freeze({ code: "8310-5",  display: "Body temperature",         unit: null }),   // from tempUnit
  spo2:   Object.freeze({ code: "59408-5", display: "Oxygen saturation (pulse oximetry)", unit: "%" }),
  rr:     Object.freeze({ code: "9279-1",  display: "Respiratory rate",         unit: "/min" }),
  weight: Object.freeze({ code: "29463-7", display: "Body weight",              unit: "kg" }),
});

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** PURE. The tenant's mode for this migration. Unknown or absent is "off". */
function vitalsMode(tenant) {
  let settings = {};
  try { settings = typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { settings = {}; }
  const m = settings && settings.wardsynq && settings.wardsynq.migrations && settings.wardsynq.migrations.vitals;
  return MODES.includes(m) ? m : "off";
}

/** PURE. The patient id the observations file under: the MRN the ticket carries, or nothing. */
function patientIdForTicket(ticket) {
  const mrn = ticket && String(ticket.ghisPatientId || "").trim();
  return mrn ? `opd-pat-${mrn.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : null;
}

/**
 * PURE. Structured vitals from the form to canonical Observations. Empty or non-numeric values are
 * skipped, never defaulted. Returns [] when nothing is numeric, which the caller reports.
 *
 * @param {{vitals: object, patientId: string, ticketId: string, encounterId?: string|null,
 *   recordedAt?: string, note?: string|null}} input
 */
function vitalsToObservations(input) {
  const v = (input && input.vitals) || {};
  const note = input.note || v.note || null;     // the console sends the note inside the vitals object
  const at = input.recordedAt || new Date().toISOString();
  const stamp = Date.parse(at) || Date.now();
  const out = [];
  const tempUnit = String(v.tempUnit || "F").toUpperCase() === "C" ? "Cel" : "[degF]";
  for (const key of Object.keys(VITAL_CODES)) {
    const value = num(v[key]);
    if (value === null) continue;
    const spec = VITAL_CODES[key];
    const obs = Observation({
      id: `opd-vitals-${String(input.ticketId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}-${key}`,
      patientId: input.patientId,
      encounterId: input.encounterId || null,
      category: "vital-signs",
      code: spec.code, codeSystem: "http://loinc.org",
      value, unit: key === "temp" ? tempUnit : spec.unit,
      effectiveAt: at,
      source: { system: "wardsynq-native", sourceId: `opd-ticket:${input.ticketId}` },
    });
    obs.display = spec.display;
    if (note) obs.sourceText = String(note).slice(0, 400);
    out.push(obs);
  }
  return out;
}

/**
 * Decides whether, and how, this tenant migrates vitals. Never throws; any failure is "off",
 * because a hospital that has not opted in must not be affected by a lookup that broke.
 *
 * deps: { getOrg(env, orgId), tenantRow(env, tenantId) }
 */
async function vitalsMigration(env, session, deps) {
  try {
    if (!env || String(env.WARDSYNQ_RECORD) !== "1") return { mode: "off", why: "flag" };
    const orgId = session && (session.orgId || session.hospitalId);
    if (!orgId) return { mode: "off", why: "no_org" };
    const org = await deps.getOrg(env, orgId);
    const tenantId = org && org.connectTenantId;
    if (!tenantId) return { mode: "off", why: "no_tenant" };
    const tenant = await deps.tenantRow(env, tenantId);
    if (!tenant) return { mode: "off", why: "tenant_missing" };
    const mode = vitalsMode(tenant);
    return { mode, tenantId: String(tenantId), tenant, orgId: String(orgId) };
  } catch (e) {
    return { mode: "off", why: "lookup_failed" };
  }
}

/**
 * Writes the vitals to the record as the request's own governed actor. Never throws: the result
 * says what happened, with a status a route can return in authoritative mode.
 *
 * ctx: { migration, session, ticket, vitals, note, recordedAt, actorDeps, recordDeps }
 */
async function recordVitals(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  const patientId = patientIdForTicket(ctx.ticket);
  if (!patientId) return { ...base, ok: false, status: 422, error: "no_patient_identity", written: 0 };
  const observations = vitalsToObservations({
    vitals: ctx.vitals, patientId, ticketId: ctx.ticket.id,
    encounterId: ctx.ticket.ghisEpisodeId ? `opd-enc-${String(ctx.ticket.ghisEpisodeId).toLowerCase()}` : null,
    recordedAt: ctx.recordedAt, note: ctx.note,
  });
  if (!observations.length) return { ...base, ok: false, status: 422, error: "no_structured_vitals", written: 0, patientId };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0, patientId };
  }
  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  const written = [], denied = [];
  for (const obs of observations) {
    try {
      const out = await svc.put(obs, { idempotencyKey: `vitals:${obs.id}`, activePatientId: patientId });
      written.push({ id: out.record.id, code: obs.code, version: out.record.version, replayed: out.replayed });
    } catch (e) {
      if (e instanceof GovernanceError) { denied.push({ id: obs.id, reasons: e.reasons.map((r) => r.code) }); continue; }
      return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: written.length, denied, patientId, actor: resolved.actor.id };
    }
  }
  const ok = denied.length === 0;
  return { ...base, ok, status: ok ? 200 : 403, error: ok ? undefined : "governance", written: written.length, records: written, denied, patientId, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
}

export { MODES, VITAL_CODES, vitalsMode, patientIdForTicket, vitalsToObservations, vitalsMigration, recordVitals };
