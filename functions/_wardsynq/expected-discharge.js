/* functions/_wardsynq/expected-discharge.js - the expected discharge date of an inpatient stay.
 *
 * A DATE A CLINICIAN SETS, NEVER ONE THIS BUILD PREDICTS. patient-flow.js's header refused to invent an
 * estimate of when a patient should leave; that still holds. This is the treating team's own stated plan:
 * one ExpectedDischarge record per stay, set by someone with emr.treat, and every change a new version
 * carrying a reason, so the history of the plan (and who moved it, when, why) stays readable.
 *
 * OVERDUE IS A FACT ABOUT THE CALENDAR: the stay is still open and the stated date is before today in the
 * hospital's own clock (wardsynqConfig timeZone, else utcOffsetMinutes, else IST). Nothing is scored.
 *
 * Shown on the ward list (migrate-inpatient.js listWard) and the command center (patient-flow.js).
 *
 * node --test --experimental-test-module-mocks test/wardsynq-stay-flow.test.mjs
 */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { zoneOffsetAt } from "./mar-schedule.js";

const EDD_TYPE = "ExpectedDischarge";
// The admission classes of migrate-inpatient.js, restated rather than imported: that file imports this one.
const STAY_CLASSES = Object.freeze(["IPD", "ICU", "MATERNITY", "PEDIATRICS", "NICU"]);
const OPEN = "in-progress";
const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const eddIdFor = (encounterId) => `wsq-edd-${slug(encounterId)}`;

async function openService(request, env, ctx, need) {
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
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** PURE. Today's date (YYYY-MM-DD) on the hospital's wall clock. clock: { timeZone?, offsetMinutes? } */
function hospitalToday(nowMs, clock) {
  const c = clock || {};
  const zoned = zoneOffsetAt(c.timeZone, nowMs);
  const offset = zoned != null ? zoned : Number.isFinite(c.offsetMinutes) ? c.offsetMinutes : 330;
  return new Date(nowMs + offset * 60000).toISOString().slice(0, 10);
}

/** PURE. A real calendar date written YYYY-MM-DD, or null. */
function isoDate(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** PURE. What a list shows for a stated date: the date, and whether it has passed or is today. */
function eddStatus(record, today) {
  if (!record) return null;
  const date = record.expectedDate;
  return { date, overdue: date < today, dueToday: date === today, version: record.version || null, setBy: record.setBy || null, setAt: record.setAt || null, reason: record.reason || null };
}

/** Every stay's current expected date, keyed by encounter. Throws when it cannot be read. */
async function expectedDischargeMap(svc) {
  // ponytail: one capped list read; a hospital with more than 2000 stated dates ever needs a by-encounter index.
  const rows = await svc.list(EDD_TYPE, 2000);
  return new Map((rows || []).filter((r) => r && r.encounterId).map((r) => [r.encounterId, r]));
}

/**
 * Sets, or revises, a stay's expected discharge date.
 * ctx: { migration, encounterId, expectedDate, reason?, expectedVersion?, clock?, now?, actorDeps, recordDeps }
 */
async function setExpectedDischarge(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };
  const expectedDate = isoDate(ctx.expectedDate);
  if (!expectedDate) return { ...base, ok: false, status: 422, error: "date_required", detail: "give the expected discharge date as YYYY-MM-DD", written: 0 };
  const today = hospitalToday(Date.parse(str(ctx.now)) || Date.now(), ctx.clock);
  if (expectedDate < today) return { ...base, ok: false, status: 422, error: "date_in_past", detail: `an expected discharge date cannot be before today (${today})`, written: 0 };
  const reason = str(ctx.reason);

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const id = eddIdFor(encounterId);
  let enc, current;
  try { [enc, current] = await Promise.all([svc.get("Encounter", encounterId), svc.get(EDD_TYPE, id)]); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ...writeFailure(e, { written: 0 }) };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The stay could not be read, so nothing was saved.", written: 0 };
  }
  if (!enc) return { ...base, ok: false, status: 404, error: "encounter_not_found", written: 0 };
  if (!STAY_CLASSES.includes(enc.class) || enc.status !== OPEN) return { ...base, ok: false, status: 409, error: "not_admitted", detail: "an expected discharge date belongs to an open inpatient stay", written: 0 };
  if (current) {
    if (reason.length < 5) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the expected discharge date is changing", version: current.version, written: 0 };
    if (!Number.isInteger(ctx.expectedVersion)) return { ...base, ok: false, status: 422, error: "expected_version_required", detail: "name the version being revised", version: current.version, written: 0 };
    if (current.expectedDate === expectedDate) return { ...base, ok: false, status: 409, error: "unchanged", detail: `the expected discharge date is already ${expectedDate}`, version: current.version, written: 0 };
  }

  const record = {
    resourceType: EDD_TYPE, id, encounterId, patientId: enc.patientId, expectedDate, reason: reason || null,
    setBy: resolved.actor.id, setAt: new Date().toISOString(),
    previous: current ? { expectedDate: current.expectedDate, version: current.version } : null,
    source: { system: "wardsynq-native", sourceId: `expected-discharge:${encounterId}` },
  };
  try {
    const out = await svc.put(record, { expectedVersion: current ? ctx.expectedVersion : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, encounterId, expectedDate, revised: !!current, version: out.record.version, actor: resolved.actor.id };
  } catch (e) { return { ...base, ...writeFailure(e, { encounterId, written: 0, actor: resolved.actor.id }) }; }
}

/** ctx: { migration, encounterId, clock?, now?, actorDeps, recordDeps } - the current date (or null) and every version, newest first. */
async function expectedDischargeHistory(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", current: null, history: [] };
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", current: null, history: [] };
  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, current: null, history: [] };
  let rows;
  try { rows = await svc.history(EDD_TYPE, eddIdFor(encounterId)); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: "The expected discharge date could not be read. Do not read this as not set.", current: null, history: [] }; }
  const history = (rows || []).slice().reverse();
  const today = hospitalToday(Date.parse(str(ctx.now)) || Date.now(), ctx.clock);
  return { ...base, ok: true, encounterId, today, current: eddStatus(history[0] || null, today), history };
}

export { EDD_TYPE, eddIdFor, hospitalToday, isoDate, eddStatus, expectedDischargeMap, setExpectedDischarge, expectedDischargeHistory };
