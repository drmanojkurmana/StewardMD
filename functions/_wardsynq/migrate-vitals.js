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
 * from the MRN (`opd-pat-<mrn>`, opd-identity.js), which the patient registration migration (once it
 * exists) uses too, so they attach to the master the moment it exists. A ticket with no MRN cannot be
 * filed and says so. As of 2026-09-06 the registration migration DOES exist
 * (functions/_wardsynq/migrate-registration.js) and creates that master.
 *
 * Nothing here is a clinical rule. No threshold, no score, no alert. The safety engine will read
 * these observations when a site wires it; this file only makes them exist.
 */

import { Observation, numericValue } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { MODES, migrationModeOf, resolveMigration } from "./migration-tenant.js";
import { patientIdForMrn, patientIdForTicket, encounterIdForTicket } from "./opd-identity.js";

export { patientIdForTicket };

/** LOINC codes and UCUM units for the six values the OPD form takes. Recorded AS REPORTED. */
const VITAL_CODES = Object.freeze({
  sbp:    Object.freeze({ code: "8480-6",  display: "Systolic blood pressure",  unit: "mm[Hg]" }),
  dbp:    Object.freeze({ code: "8462-4",  display: "Diastolic blood pressure", unit: "mm[Hg]" }),
  pulse:  Object.freeze({ code: "8867-4",  display: "Heart rate",               unit: "/min" }),
  temp:   Object.freeze({ code: "8310-5",  display: "Body temperature",         unit: null }),   // from tempUnit
  spo2:   Object.freeze({ code: "59408-5", display: "Oxygen saturation (pulse oximetry)", unit: "%" }),
  rr:     Object.freeze({ code: "9279-1",  display: "Respiratory rate",         unit: "/min" }),
  weight: Object.freeze({ code: "29463-7", display: "Body weight",              unit: "kg" }),
  /* Supplemental oxygen: a FLAG, 1 or 0. "On oxygen" is a yes/no for NEWS2 and the litres are a
   * separate fact this form does not claim to hold. Without it an early warning score can never
   * complete, however many observations a ward charts. */
  o2:     Object.freeze({ code: "80288-4", display: "Supplemental oxygen",       unit: null }),
});

/* ACVPU is written SEPARATELY, below, and not through the numeric table - because its value is a
 * LETTER and the score reads it as one. Encoding it as an ordinal here would have stored a 0 for
 * "Alert" that the scorer could not read and every ward would have had a permanently incomplete
 * NEWS2 with an observation sitting right there. An Observation's value is deliberately loose
 * (wardsynq-model.js) for exactly this. */
const ACVPU_CODE = Object.freeze({ code: "80339-5", display: "Level of consciousness (ACVPU)" });
const ACVPU_LETTERS = Object.freeze(["A", "C", "V", "P", "U"]);

// Strict, because the strip-and-parse this used to do turned "120/80" typed into one box into a
// systolic of 12080 and "98,6" into 986. See numericValue() in wardsynq-model.js. A value that is
// not plainly one number is SKIPPED here (this file never defaults a vital), not guessed at.
function num(v) {
  if (v === null || v === undefined || v === "") return null;
  return numericValue(v);
}

/** PURE. The tenant's mode for this migration. Unknown or absent is "off". */
function vitalsMode(tenant) { return migrationModeOf(tenant, "vitals"); }

/**
 * PURE. Structured vitals from the form to canonical Observations. Empty or non-numeric values are
 * skipped, never defaulted. Returns [] when nothing is numeric, which the caller reports.
 *
 * @param {{vitals: object, patientId: string, ticketId: string, encounterId?: string|null,
 *   recordedAt?: string, note?: string|null, idPrefix?: string}} input
 */
function vitalsToObservations(input) {
  const v = (input && input.vitals) || {};
  const note = input.note || v.note || null;     // the console sends the note inside the vitals object
  const at = input.recordedAt || new Date().toISOString();
  const stamp = Date.parse(at) || Date.now();
  const out = [];
  const tempUnit = String(v.tempUnit || "F").toUpperCase() === "C" ? "Cel" : "[degF]";

  /* The two NEWS2 parameters that are not plain numbers, normalised before the numeric loop.
   *
   * NOT RECORDED AND "NO" ARE DIFFERENT. "Not on supplemental oxygen" is a real NEWS2 input worth 0;
   * "nobody wrote it down" is a missing parameter, and the score refuses to complete on it. So an
   * absent o2 is skipped and an explicit false is recorded as 0. */
  const norm = { ...v };
  if (v.o2 === undefined || v.o2 === null || v.o2 === "") delete norm.o2;
  else norm.o2 = (v.o2 === true || v.o2 === 1 || /^(1|y|yes|true|on)$/i.test(String(v.o2).trim())) ? 1 : 0;
  delete norm.acvpu;    // written below, as a letter

  for (const key of Object.keys(VITAL_CODES)) {
    const value = num(norm[key]);
    if (value === null) continue;
    const spec = VITAL_CODES[key];
    const obs = Observation({
      // idPrefix lets the ward reuse this mapper verbatim: an inpatient reading is the same coded
      // Observation, and a second copy of the LOINC table is how two vitals paths start disagreeing.
      // Defaults to the OPD prefix, so nothing about the OPD path changes.
      id: `${input.idPrefix || "opd-vitals"}-${String(input.ticketId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}-${key}`,
      patientId: input.patientId,
      encounterId: input.encounterId || null,
      category: "vital-signs",
      code: spec.code, codeSystem: "http://loinc.org",
      value, unit: key === "temp" ? tempUnit : spec.unit,
      effectiveAt: at,
      source: { system: "wardsynq-native", sourceId: `opd-ticket:${input.ticketId}` },
    });
    obs.display = spec.display;
    // A flag reads as a word, so nobody has to decode a 0 on a chart.
    if (key === "o2") obs.valueLabel = value === 1 ? "On supplemental oxygen" : "Breathing air";
    if (note) obs.sourceText = String(note).slice(0, 400);
    out.push(obs);
  }

  /* ACVPU, as a letter. A word the scale does not contain is not a level of consciousness and is
   * SKIPPED rather than guessed at - an invented "A" would complete a score about a patient whose
   * consciousness nobody assessed, which is the one direction this must never fail. */
  const letter = String(v.acvpu == null ? "" : v.acvpu).trim().toUpperCase();
  if (ACVPU_LETTERS.includes(letter)) {
    const obs = Observation({
      id: `${input.idPrefix || "opd-vitals"}-${String(input.ticketId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}-acvpu`,
      patientId: input.patientId, encounterId: input.encounterId || null,
      category: "vital-signs", code: ACVPU_CODE.code, codeSystem: "http://loinc.org",
      value: letter, unit: null, effectiveAt: at,
      source: { system: "wardsynq-native", sourceId: `opd-ticket:${input.ticketId}` },
    });
    obs.display = ACVPU_CODE.display;
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
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "vitals", deps);
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
    encounterId: encounterIdForTicket(ctx.ticket),
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

export { MODES, VITAL_CODES, vitalsMode, patientIdForMrn, vitalsToObservations, vitalsMigration, recordVitals };
