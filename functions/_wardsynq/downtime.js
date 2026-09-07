/* functions/_wardsynq/downtime.js — what the ward holds in its hands when the system is not there.
 *
 * Every other file in this directory assumes the API answers. This one exists for the hours when it
 * does not: a power cut, a network partition, a bad deploy, a Cloudflare incident. A ward does not
 * stop having patients during an outage, and the failure mode nobody plans for is not the outage - it
 * is the twenty minutes afterwards, when nobody can say what was given while the screens were dark.
 *
 * IT IS A COPY, AND IT SAYS SO ON EVERY PAGE. This is the whole safety argument. A downtime sheet is
 * dangerous in exactly one way: a clinician trusts it after it has gone stale. So the generation time
 * is stamped on the pack and on every patient, and the pack states in words that anything changed
 * after that instant is not on it. It does not say "current". Nothing here is live.
 *
 * IT WRITES NOTHING. Not a flag, not a "downtime mode", not an audit of its own beyond the ordinary
 * read log. A route that mutated the record in order to prepare for an outage would be one more thing
 * to go wrong during one, and a record that knows it is in downtime is a record that can be wrong
 * about it.
 *
 * ABSENCE IS NAMED, NEVER OMITTED. A patient whose allergies could not be read appears on the pack
 * with "allergies could not be read" against their name, not with an empty allergy line - because an
 * empty allergy line on a piece of paper reads as "no known allergies" to every clinician alive, and
 * that is the single most dangerous sentence this file could accidentally print.
 *
 * IT IS NOT A CHART. It carries what a ward needs to keep people safe for a few hours: who is in
 * which bed, what they are allergic to, what they are on and when it is due, and what is outstanding.
 * It is deliberately not the whole record: a pack nobody can read in an emergency is a pack nobody
 * reads.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { scheduleSlots, parseFrequency } from "./mar-schedule.js";

const str = (v) => (v == null ? "" : String(v).trim());
const IPD = "IPD", OPEN = "in-progress";

/** PURE. The sentence that has to be true of every downtime sheet ever printed. */
function staleness(generatedAt, nowMs) {
  const t = Date.parse(str(generatedAt));
  if (!Number.isFinite(t)) return { minutes: null, note: "This pack carries no generation time. Do not rely on it." };
  const mins = Math.max(0, Math.floor(((Number.isFinite(nowMs) ? nowMs : Date.now()) - t) / 60000));
  return {
    minutes: mins,
    note: `Printed ${generatedAt}. Anything recorded after that time is NOT on this sheet. Check the wristband and ask the nurse who gave the last dose.`,
  };
}

/**
 * PURE. One patient's page. Everything it could not read is NAMED on the page.
 *
 * `problems` is the list of things this page does not know, and it is rendered rather than logged: a
 * gap a ward cannot see is a gap a ward walks into.
 */
function patientPage(input) {
  const i = input || {};
  const problems = [];
  const at = str(i.generatedAt) || new Date().toISOString();

  const allergies = i.allergies === null || i.allergies === undefined ? null : (i.allergies || []).filter(Boolean).map((a) => ({
    substance: a.substance || a.code || "unnamed substance",
    reaction: a.reaction || null, severity: a.severity || null, verified: a.verificationStatus || null,
  }));
  /* A patient with no allergy RECORD and a patient with no allergies are different patients, and a
   * blank line says the second. Both are stated in words. */
  if (allergies === null) problems.push("allergies could not be read");

  const orders = i.orders === null || i.orders === undefined ? null : (i.orders || [])
    .filter((o) => o && o.status === "active")
    .map((o) => {
      const spec = parseFrequency(o.frequency);
      let due = [];
      if (spec && spec.kind !== "prn" && i.from && i.to) {
        try { due = (scheduleSlots(o, { from: i.from, to: i.to, times: i.marTimes, offsetMinutes: i.offsetMinutes }).due || []).map((t) => new Date(t).toISOString()); }
        catch { due = []; }
      }
      return {
        drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null,
        asNeeded: !!(spec && spec.kind === "prn"),
        // An order whose frequency the schedule cannot read gets no times, and SAYS it has none. A
        // blank time column would read as "nothing due today".
        due, scheduleKnown: !!spec && spec.kind !== "prn",
      };
    });
  if (orders === null) problems.push("medicines could not be read");

  const criticals = i.criticals === null || i.criticals === undefined ? null : (i.criticals || [])
    .filter((c) => c && c.state === "open")
    .map((c) => ({ display: c.display || c.code, value: c.value == null ? null : c.value, unit: c.unit || null, reportedAt: c.reportedAt || null }));
  if (criticals === null) problems.push("open critical results could not be read");

  return {
    patientId: i.patientId, encounterId: i.encounterId || null,
    mrn: (i.patient && i.patient.mrn) || null,
    name: (i.patient && i.patient.name) || null,
    dob: (i.patient && i.patient.dob) || null,
    ward: i.ward || null, bed: i.bed || null, admittedAt: i.admittedAt || null,
    allergies, orders, criticals,
    lastVitals: i.lastVitals || null,
    generatedAt: at,
    problems,
  };
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** Reads one type for one patient, returning null - never [] - when the read failed or was refused. */
async function safely(svc, type, patientId) {
  try { return (await svc.byPatient(type, patientId)) || []; }
  catch { return null; }
}

/**
 * The downtime pack for a ward. READ ONLY.
 * ctx: { migration, ward?, hours?, now?, marTimes?, offsetMinutes?, actorDeps, recordDeps }
 */
async function downtimePack(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", patients: [] };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, patients: [] };

  let encounters;
  try { encounters = await svc.list("Encounter", 200); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), patients: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), patients: [] };
  }

  const want = str(ctx.ward).toLowerCase();
  const stays = (encounters || [])
    .filter((e) => e && e.class === IPD && e.status === OPEN)
    .filter((e) => !want || str(e.location && e.location.ward).toLowerCase() === want);

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  /* The window the due times cover. A pack printed at 14:00 that stops at midnight leaves the night
   * staff with nothing, so it runs forward from now by a stated number of hours rather than to the
   * end of the calendar day. */
  const hours = Math.min(72, Math.max(1, Number(ctx.hours) || 24));
  const from = generatedAt, to = new Date(nowMs + hours * 3600000).toISOString();

  const patients = [];
  for (const e of stays) {
    const [patient, allergies, orders, criticals, observations] = await Promise.all([
      svc.get("Patient", e.patientId).catch(() => null),
      safely(svc, "AllergyIntolerance", e.patientId),
      safely(svc, "MedicationOrder", e.patientId),
      safely(svc, "CriticalResultLoop", e.patientId),
      safely(svc, "Observation", e.patientId),
    ]);
    // The most recent value for each vital sign. Not a trend: a downtime sheet is a starting point,
    // and a ward that needs the trend has the paper chart it has been keeping since the outage began.
    let lastVitals = null;
    if (observations) {
      const vitals = observations.filter((o) => o && o.category === "vital-signs" && o.recordedAt);
      if (vitals.length) {
        lastVitals = {};
        for (const o of vitals.sort((a, b) => String(a.recordedAt).localeCompare(String(b.recordedAt)))) {
          lastVitals[o.code] = { value: o.value, unit: o.unit || null, at: o.recordedAt };
        }
      }
    }
    patients.push(patientPage({
      patientId: e.patientId, encounterId: e.id, patient,
      ward: (e.location && e.location.ward) || null, bed: (e.location && e.location.bed) || null,
      admittedAt: e.periodStart || null,
      allergies, orders, criticals, lastVitals,
      generatedAt, from, to, marTimes: ctx.marTimes, offsetMinutes: ctx.offsetMinutes,
    }));
  }
  patients.sort((a, b) => String(a.bed || "~").localeCompare(String(b.bed || "~"), undefined, { numeric: true }));

  return {
    ...base, ok: true,
    ward: str(ctx.ward) || null, generatedAt, coversUntil: to, hours,
    patients, count: patients.length,
    /* Counted and stated, so a pack with holes in it cannot be mistaken for a complete one. */
    incomplete: patients.filter((p) => p.problems.length).length,
    ...staleness(generatedAt, nowMs),
    /* WHAT THIS IS. Printed on the pack, not left to a policy document nobody has read at 03:00. */
    warning: "This is a point-in-time COPY, not the record. It is read-only, it was correct when it "
      + "was printed, and it does not update. Record everything given during the outage on paper and "
      + "enter it when the system returns.",
    actor: resolved.actor.id,
  };
}

export { downtimePack, patientPage, staleness };
