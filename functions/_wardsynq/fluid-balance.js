/* functions/_wardsynq/fluid-balance.js — intake, output, and the balance between them.
 *
 * The oldest nursing chart there is, and still one of the most consequential: fluid balance is how a
 * ward notices that a septic patient has not passed urine in six hours, or that a patient in heart
 * failure is four litres up. WardSynQ recorded vitals and nothing else a nurse writes, so this is
 * the first real piece of the nursing flowsheet.
 *
 * A BALANCE IS ONLY AS GOOD AS ITS ENTRIES, AND IT SAYS SO. This is the whole safety argument of
 * the file. A running total presented as a fact implies that everything was recorded, and on a real
 * ward it never is: a nurse was busy, a drain was emptied and not charted, a patient drank in the
 * bathroom. So every balance reports what it is MISSING alongside what it counted - hours with no
 * entry at all, values that were not numbers, units it could not use - and a reader is never handed
 * a tidy number that quietly stands in for an incomplete chart. A falsely reassuring fluid balance
 * is worse than no fluid balance, because somebody acts on it.
 *
 * INTAKE AND OUTPUT ARE ALWAYS BOTH SHOWN. Never the net alone: "+400 mL" hides whether that is a
 * patient who drank 400 and passed nothing, or one who took three litres and passed 2.6. Those are
 * different patients and one of them is in trouble.
 *
 * NO INVENTED TERMINOLOGY. There is no LOINC code here that I could not vouch for, so there are
 * none: these are WardSynQ's own codes under the clearly-named `wardsynq-fluid` system. A local code
 * honestly labelled as local is safe; a guessed LOINC on a clinical observation is a lie that
 * survives every export and every integration afterwards.
 */

import { Observation, numericValue } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const SYSTEM = "wardsynq-fluid";
const CATEGORY = "fluid-balance";

/** What goes in and what comes out. A closed vocabulary: "other" exists so nothing is unrecordable. */
const INTAKE = Object.freeze({
  oral: "Oral", iv: "Intravenous", ng: "Nasogastric / enteral",
  blood: "Blood or blood product", irrigation: "Irrigation in", other: "Other intake",
});
const OUTPUT = Object.freeze({
  urine: "Urine", drain: "Drain", vomit: "Vomit / aspirate", stool: "Stool",
  blood: "Blood loss", irrigation: "Irrigation out", other: "Other output",
});
/** The one unit a balance can be computed in. Everything else is reported, never converted. */
const UNIT = "mL";
const UNIT_ALIASES = Object.freeze({ ml: UNIT, mL: UNIT, ML: UNIT, mls: UNIT, cc: UNIT, ccs: UNIT, cm3: UNIT, "cm^3": UNIT });

/** PURE. `intake.oral` / `output.urine`, or null when it is not a fluid code this file knows. */
function fluidCode(direction, kind) {
  const d = str(direction).toLowerCase(), k = str(kind).toLowerCase();
  if (d === "intake" && INTAKE[k]) return `intake.${k}`;
  if (d === "output" && OUTPUT[k]) return `output.${k}`;
  return null;
}
function displayOf(code) {
  const [d, k] = str(code).split(".");
  return (d === "intake" ? INTAKE[k] : d === "output" ? OUTPUT[k] : null) || code;
}
function directionOf(code) { return str(code).split(".")[0] || null; }

/**
 * PURE. One entry per (encounter, instant, code).
 *
 * Two entries of the SAME kind at the SAME recorded minute are treated as one: on a real ward that
 * is a double-tap or a retried request, not two separate 200 mL cups charted in the same minute. A
 * nurse who genuinely needs both records them at the times they happened, which is what the chart
 * should say anyway.
 */
function fluidIdFor(encounterId, at, code) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const e = slug(encounterId), t = slug(at), c = slug(code);
  return e && t && c ? `wsq-fluid-${e}-${t}-${c}` : null;
}

/**
 * PURE. Request rows to canonical Observations, plus everything that could NOT be recorded.
 * Nothing is defaulted and nothing is converted; a row this cannot use is returned as a reason.
 */
function fluidToObservations(input) {
  const rows = Array.isArray(input && input.entries) ? input.entries : [];
  const patientId = str(input && input.patientId);
  const encounterId = str(input && input.encounterId);
  const out = [], rejected = [];
  if (!patientId || !encounterId) return { observations: [], rejected: [{ reason: "encounter_required" }] };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const code = fluidCode(r.direction, r.kind);
    if (!code) { rejected.push({ index: i, reason: "unknown_kind", direction: r.direction || null, kind: r.kind || null }); continue; }

    const at = str(r.at) || str(input.recordedAt) || new Date().toISOString();
    if (!Number.isFinite(Date.parse(at))) { rejected.push({ index: i, reason: "bad_time", at }); continue; }

    // A volume that is not plainly one number is NOT recorded and NOT guessed at. "a cup", "approx
    // 500" and "" are things people write, and turning any of them into a number would put a
    // fabricated volume into a balance somebody titrates fluids against.
    const value = numericValue(r.value);
    if (value === null) { rejected.push({ index: i, reason: "not_a_number", value: r.value == null ? null : String(r.value) }); continue; }
    if (value < 0) { rejected.push({ index: i, reason: "negative", value }); continue; }

    const unit = UNIT_ALIASES[str(r.unit)] || UNIT_ALIASES[str(r.unit).toLowerCase()] || (str(r.unit) ? null : UNIT);
    // Never converted. Litres are not silently multiplied by a thousand here: a unit this file does
    // not recognise is refused so the ward fixes the entry, rather than a factor-of-1000 error
    // reaching a fluid balance.
    if (unit !== UNIT) { rejected.push({ index: i, reason: "unusable_unit", unit: r.unit == null ? null : String(r.unit) }); continue; }

    const id = fluidIdFor(encounterId, at, code);
    if (!id) { rejected.push({ index: i, reason: "bad_identifiers" }); continue; }

    const obs = Observation({
      id, patientId, encounterId, category: CATEGORY,
      code, codeSystem: SYSTEM, value, unit: UNIT, effectiveAt: at,
      source: { system: "wardsynq-native", sourceId: `fluid:${id}` },
    });
    obs.display = displayOf(code);
    const note = str(r.note);
    if (note) obs.sourceText = note.slice(0, 400);
    out.push(obs);
  }
  return { observations: out, rejected };
}

/**
 * PURE. The balance over a window, and everything that makes it less than certain.
 *
 * `hours` is per-hour totals so a ward can see WHEN nothing was charted, which is the thing a bare
 * total hides. `gaps` names those hours outright.
 */
function summariseBalance(observations, opts) {
  const o = opts || {};
  const from = Date.parse(o.from), to = Date.parse(o.to);
  const rows = (observations || []).filter((x) => x && x.category === CATEGORY && x.codeSystem === SYSTEM)
    .filter((x) => {
      const t = Date.parse((x.meta && x.meta.effectiveAt) || x.effectiveAt || "");
      return Number.isFinite(t) && (!Number.isFinite(from) || t >= from) && (!Number.isFinite(to) || t < to);
    });

  const byKind = {}, hours = new Map();
  let intake = 0, output = 0;
  for (const r of rows) {
    const dir = directionOf(r.code), v = Number(r.value);
    if (!Number.isFinite(v)) continue;
    if (dir === "intake") intake += v; else if (dir === "output") output += v; else continue;
    byKind[r.code] = (byKind[r.code] || 0) + v;
    const t = Date.parse((r.meta && r.meta.effectiveAt) || r.effectiveAt);
    const hourKey = new Date(Math.floor(t / 3600000) * 3600000).toISOString();
    const h = hours.get(hourKey) || { hour: hourKey, intake: 0, output: 0 };
    if (dir === "intake") h.intake += v; else h.output += v;
    hours.set(hourKey, h);
  }

  /* THE HOURS NOBODY CHARTED. A twelve-hour balance built from three entries is not a twelve-hour
   * balance, and the number alone cannot say that. This is the field that stops a tidy total from
   * standing in for an incomplete chart. */
  const gaps = [];
  if (Number.isFinite(from) && Number.isFinite(to)) {
    const start = Math.floor(from / 3600000) * 3600000;
    for (let t = start; t < to; t += 3600000) {
      const key = new Date(t).toISOString();
      if (!hours.has(key)) gaps.push(key);
    }
  }
  const hourList = [...hours.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  return {
    intake, output, balance: intake - output, entries: rows.length,
    byKind, hours: hourList, gaps,
    // Said plainly rather than left to be inferred from an empty array.
    complete: gaps.length === 0 && rows.length > 0,
    unit: UNIT,
  };
}

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

/** Records fluid entries. ctx: { migration, encounterId, patientId, entries, actorDeps, recordDeps } */
async function recordFluid(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const { observations, rejected } = fluidToObservations({
    entries: ctx.entries, patientId: str(ctx.patientId), encounterId: str(ctx.encounterId), recordedAt: ctx.recordedAt,
  });
  if (!observations.length) {
    return { ...base, ok: rejected.length === 0, status: rejected.length ? 422 : 200, written: 0, ...(rejected.length ? { error: "nothing_recordable", rejected } : { skipped: "no_entries" }) };
  }

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const results = [];
  let written = 0;
  for (const obs of observations) {
    try {
      const out = await svc.put(obs, { idempotencyKey: ctx.idempotencyKey ? `${ctx.idempotencyKey}:${obs.id}` : null });
      written += 1;
      results.push({ id: obs.id, code: obs.code, display: obs.display, value: obs.value, unit: obs.unit, version: out.record.version });
    } catch (e) {
      const f = writeFailure(e, { id: obs.id });
      // A refusal is the answer, not a row to skip past: a nurse must not be told 3 of 4 were saved
      // with no way to see which failed or why.
      return { ...base, ...f, written, observations: results, rejected };
    }
  }
  return {
    ...base, ok: true, written, encounterId: str(ctx.encounterId), patientId: str(ctx.patientId),
    observations: results,
    // Never silently dropped. A row that could not be recorded is returned so the ward can fix it.
    ...(rejected.length ? { rejected } : {}),
    actor: resolved.actor.id, role: resolved.role,
  };
}

/** The balance. ctx: { migration, patientId, from, to, actorDeps, recordDeps } */
async function fluidBalance(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", balance: null };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", balance: null };
  const from = str(ctx.from), to = str(ctx.to);
  if (!Number.isFinite(Date.parse(from))) return { ...base, ok: false, status: 422, error: "from_required", detail: "a balance is over a stated period", balance: null };
  const toMs = Number.isFinite(Date.parse(to)) ? Date.parse(to) : Date.parse(from) + 86400000;
  if (toMs <= Date.parse(from)) return { ...base, ok: false, status: 422, error: "bad_window", balance: null };
  if (toMs - Date.parse(from) > 14 * 86400000) return { ...base, ok: false, status: 422, error: "window_too_wide", detail: "a fluid balance is charted over days, not weeks", balance: null };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, balance: null };

  let rows;
  try { rows = await svc.byPatient("Observation", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), balance: null }; }

  const window = { from: new Date(Date.parse(from)).toISOString(), to: new Date(toMs).toISOString() };
  const summary = summariseBalance(rows, window);
  return { ...base, ok: true, patientId, ...window, balance: summary };
}

export {
  INTAKE, OUTPUT, UNIT, SYSTEM, CATEGORY,
  fluidCode, displayOf, directionOf, fluidIdFor, fluidToObservations, summariseBalance,
  recordFluid, fluidBalance,
};
