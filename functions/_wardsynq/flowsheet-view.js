/* functions/_wardsynq/flowsheet-view.js — making the flowsheet reachable from the record.
 *
 * `wardsynq/wardsynq-flowsheet.js` has held the hard, safety-critical half of the ICU flowsheet since
 * P0: a missing hour is never zero, every total names the hours nobody charted, a correction
 * supersedes rather than overwrites, and a set value is a different fact from a measured one. Nothing
 * called it. It was imported by its own tests and by a render file in the iOS bundle, and by no
 * server route at all - so a hospital running WardSynQ could not get a flowsheet out of its own
 * record. This is the missing adapter and nothing more: it computes no totals and re-implements no
 * rule.
 *
 * OBSERVED AND CHARTED ARE DIFFERENT TIMES, AND THE RECORD ALREADY HOLDS BOTH. `meta.effectiveAt` is
 * when the observation was made; `meta.recordedAt` is when somebody typed it. `chart()` derives
 * `backfilled` from the gap, so this view surfaces retrospective charting out of the real record
 * rather than asserting the chart was contemporaneous. That is a fact about how a ward is running
 * that no other screen in WardSynQ can currently show.
 *
 * A CONFIGURED ROW WITH NOTHING IN IT STILL APPEARS. This is the whole point of letting a hospital
 * choose its rows: a row that vanished because nobody charted it reads as "not part of this chart"
 * rather than "nobody charted it", and those are opposite conclusions. The hospital's list is passed
 * to buildGrid as the row set, so an unfilled row is an empty row, visibly.
 *
 * IT DOES NOT CHART ANYTHING. Read only. Vitals are written by the ward vitals route and fluid by the
 * fluid route, through their own authorities; a second write path into the same observations would be
 * a second place for them to disagree.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { chart, buildGrid, KIND } from "../../wardsynq/wardsynq-flowsheet.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** The categories a flowsheet draws from. A laboratory result is not a flowsheet row: it has its own
 *  report, its own critical loop and its own release rules. */
// "labour" joined 2026-09-08 (Task 2.4): a partogram's raw data (cervical dilation, contraction
// frequency, fetal heart rate, a stated labour status) is charted the same way a vital sign is -
// this grid's own missing-hour honesty and bitemporal correction apply to it unchanged. The WHO
// partogram's alert/action-line plotting is NOT built here; this shows what was charted, nothing more.
// "neonatal" joined the same way (Task 2.5): FiO2, PEEP and respiratory-support mode on a NICU cot.
const CATEGORIES = Object.freeze(["vital-signs", "fluid-balance", "device", "labour", "neonatal"]);

/**
 * PURE. The hospital's chosen rows, validated. An entry with no code is reported: a row that silently
 * failed to load is indistinguishable from one nobody charted, and those mean opposite things.
 */
function resolveRows(list) {
  const rows = Array.isArray(list) ? list : [];
  const out = [], problems = [];
  rows.forEach((raw, index) => {
    const r = raw && typeof raw === "object" ? raw : { code: raw };
    const code = str(r.code);
    if (!code) { problems.push({ index, reason: "no_code" }); return; }
    out.push({ code, label: str(r.label) || code });
  });
  return { rows: out, ...(problems.length ? { problems } : {}) };
}

/**
 * PURE. One stored Observation to a flowsheet entry, or null when it cannot become one.
 *
 * Returns null rather than throwing: one unusable observation must not take the whole flowsheet off
 * a screen, and the caller counts what it skipped.
 */
function entryFrom(obs) {
  const o = obs || {};
  const meta = o.meta || {};
  const observedAt = str(meta.effectiveAt) || str(o.effectiveAt) || str(meta.recordedAt);
  const chartedAt = str(meta.recordedAt) || observedAt;
  if (!o.patientId || !o.code || !observedAt || !chartedAt) return null;
  /* `chart()` refuses an entry charted BEFORE it was observed, and it is right to. A record can hold
   * that pair - a corrected effectiveAt, a clock skew - and the flowsheet's refusal is not a reason
   * to drop the whole grid, so it is skipped and counted. */
  if (Date.parse(chartedAt) < Date.parse(observedAt)) return null;
  try {
    return chart({
      patientId: o.patientId, code: o.code, label: o.display || o.code,
      value: o.value, unit: o.unit || null,
      // Everything the record holds is something a person or a device SAW. A ventilator setting is a
      // different kind, and WardSynQ has no route that writes one - so none is claimed here.
      kind: KIND.OBSERVED,
      direction: o.direction || null,
      observedAt, chartedAt,
      by: (o.writtenBy && o.writtenBy.id) || o.recordedBy || "unknown",
    });
  } catch { return null; }
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

/** ctx: { migration, patientId, from?, to?, rows?, actorDeps, recordDeps } */
async function flowsheet(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", grid: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", grid: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, grid: null };

  let observations;
  try { observations = (await svc.byPatient("Observation", patientId)) || []; }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), grid: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), grid: null };
  }

  const toMs = Date.parse(str(ctx.to)) || Date.now();
  const hours = Math.min(168, Math.max(1, Number(ctx.hours) || 24));
  const fromMs = Date.parse(str(ctx.from)) || (toMs - hours * 3600000);
  const from = new Date(fromMs).toISOString(), to = new Date(toMs).toISOString();

  const candidates = observations.filter((o) => o && CATEGORIES.includes(o.category));
  const inWindow = candidates.filter((o) => {
    const t = Date.parse(str((o.meta && o.meta.effectiveAt) || o.effectiveAt || (o.meta && o.meta.recordedAt)));
    return Number.isFinite(t) && t >= fromMs && t <= toMs;
  });

  const entries = [];
  let skipped = 0;
  for (const o of inWindow) {
    const e = entryFrom(o);
    if (e) entries.push(e); else skipped += 1;
  }

  /* THE HOSPITAL'S OWN ROWS. Passing them means a configured row with nothing charted still appears,
   * empty - which is the difference between "nobody charted it" and "it is not part of this chart".
   * With none configured the grid shows what was actually charted, which is honest but cannot show
   * an omission. */
  const { rows: configured, problems } = resolveRows(ctx.rows);
  const codes = configured.length ? configured.map((r) => r.code) : null;

  let grid;
  try { grid = buildGrid(entries, { from, to, codes }); }
  catch (e) { return { ...base, ok: false, status: 502, error: "flowsheet_failed", detail: str(e && e.message), grid: null }; }

  // The hospital's label wins where it gave one: buildGrid falls back to a code when no entry
  // carries a label, and a row of empty cells headed "8480-6" is a row nobody reads.
  const labelOf = new Map(configured.map((r) => [r.code, r.label]));
  for (const row of grid.rows) if (labelOf.has(row.code) && labelOf.get(row.code) !== row.code) row.label = labelOf.get(row.code);

  return {
    ...base, ok: true, patientId, grid,
    rowsConfigured: configured.length > 0,
    ...(problems ? { rowProblems: problems } : {}),
    /* Counted and named. An observation the flowsheet could not accept is not a reason to hide the
     * grid, and it is not a reason to pretend the grid is complete either. */
    ...(skipped ? { skippedObservations: skipped, skippedDetail: "Some observations could not be placed on the flowsheet - most often because they were recorded before the time they say they were observed. They are still on the chart." } : {}),
    ...(configured.length ? {} : { note: "This hospital has configured no flowsheet rows, so this grid shows only what was actually charted. It cannot show a row nobody filled in." }),
  };
}

export { CATEGORIES, resolveRows, entryFrom, flowsheet };
