/* functions/_wardsynq/analytics-extract.js - the numbers that leave the hospital.
 *
 * quality.js answers "is the safety machinery working, here, this period" and ward-metrics.js answers
 * "what is outstanding right now". Both are for clinicians and both name no patient. This is the
 * third thing a reporting stack needs and the one with a different hazard: an EXTRACT, meant to be
 * carried out of the building - into a spreadsheet, a board paper, a regulator's return, or the
 * warehouse domain 18 has been missing.
 *
 * A WAREHOUSE IS NOT BUILT HERE AND IS NOT PRETENDED TO BE. What an EMR owes a warehouse is a
 * defined, stable, disclosure-controlled extract - not a star schema and not an ETL product. This
 * produces aggregate rows with a documented shape; where they are loaded is somebody else's system.
 *
 * SMALL NUMBERS IDENTIFY PEOPLE, AND THAT IS THE WHOLE POINT OF THIS FILE. "One patient on Ward B
 * had a critical result acknowledged late in March" is not an aggregate; on a small ward it is a
 * person, and anybody who works there knows which. So every cell below MIN_CELL is SUPPRESSED, and
 * suppressed means the number is absent - not rounded, not shown as zero, not shown as "<5" beside
 * a total that lets it be subtracted back out.
 *
 * SUPPRESSION THAT CAN BE UNDONE BY ARITHMETIC IS NOT SUPPRESSION. If a ward's total is published
 * and every category but one is shown, the missing one is a subtraction away. So when any cell in a
 * group is suppressed, the SECOND-smallest is suppressed too - the standard complementary
 * suppression - and the group says how many cells it withheld.
 *
 * A SUPPRESSED CELL IS DECLARED, NEVER SILENTLY MISSING. A row that vanishes reads as "nothing
 * happened", which is a different and more reassuring claim than "too few to report".
 *
 * NO PATIENT IDENTIFIER APPEARS IN ANY OUTPUT, and nothing here reads one into a variable it could
 * leak. Not an id, not a pseudonym, not an MRN, not a date of birth. The registry cohort in
 * registry.js is deliberately the ONE report in this codebase that names patients, and it is a
 * clinical worklist that stays inside; this is its opposite and the two must not converge.
 *
 * NOTHING HERE IS ABOUT A CLINICIAN. Same rule as quality.js and the override report: the moment a
 * number can be attributed to an individual it stops measuring the process and starts managing the
 * staff, and the immediate effect is that people work to the number.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/**
 * Below this, a cell is suppressed. Five is the usual disclosure-control floor in health reporting
 * and it is deliberately not configurable downwards by a caller: a threshold a requester can lower
 * is not a control.
 */
const MIN_CELL = 5;

/** What an extract may count. Enumerated, so a new type is a decision rather than an accident. */
const COUNTABLE = Object.freeze(["Encounter", "MedicationAdministration", "DiagnosticReport", "CriticalResultLoop", "SafetyOverride", "WoundAssessment"]);

const inPeriod = (t, fromMs, toMs) => {
  const ms = Date.parse(str(t));
  return Number.isFinite(ms) && ms >= fromMs && ms <= toMs;
};

/**
 * PURE. Applies disclosure control to one group of cells.
 *
 * Returns `{cells, suppressed}`. A suppressed cell keeps its key and loses its count, so a reader
 * can see that the category exists and was withheld.
 */
function suppress(cells, minCell) {
  const floor = Number.isFinite(Number(minCell)) && Number(minCell) > MIN_CELL ? Math.floor(Number(minCell)) : MIN_CELL;
  const rows = (cells || []).map((c) => ({ ...c }));

  const small = rows.filter((r) => r.count > 0 && r.count < floor);
  const zero = rows.filter((r) => r.count === 0);
  /* A zero is not disclosive on its own - nobody is identified by an event that did not happen - but
   * it becomes disclosive in the same group as a suppressed cell, because it narrows what the
   * withheld number can be. It is left visible only when nothing in the group was suppressed. */
  let hide = new Set(small.map((r) => r.key));

  if (hide.size > 0) {
    /* COMPLEMENTARY SUPPRESSION. One withheld cell beside a published total is a subtraction away
     * from being republished, so the next-smallest goes too. Without this the control is decorative. */
    const remaining = rows.filter((r) => !hide.has(r.key)).sort((a, b) => a.count - b.count);
    if (remaining.length) hide.add(remaining[0].key);
    for (const z of zero) hide.add(z.key);
  }

  const out = rows.map((r) => (hide.has(r.key)
    ? { key: r.key, count: null, suppressed: true }
    : { key: r.key, count: r.count }));

  return {
    cells: out,
    suppressed: hide.size,
    floor,
    ...(hide.size ? {
      /* Declared, never silently missing: a row that vanishes reads as "nothing happened", which is a
       * different and more reassuring claim than "too few to report". */
      note: `${hide.size} cell${hide.size === 1 ? "" : "s"} withheld because the count was below ${floor}, or because publishing it would let a withheld one be worked out by subtraction. Withheld is not zero.`,
    } : {}),
  };
}

/**
 * PURE. Counts records into cells by a key function, within a period.
 *
 * The key function receives the record and must return a NON-IDENTIFYING label. Nothing here checks
 * that for you, which is why the only callers below use fixed, enumerated keys.
 */
function tally(records, keyOf, fromMs, toMs, timeField) {
  const counts = new Map();
  for (const r of records || []) {
    if (!r) continue;
    const t = r[timeField] || (r.meta && r.meta.recordedAt) || null;
    if (!inPeriod(t, fromMs, toMs)) continue;
    const k = str(keyOf(r)) || "unspecified";
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));
}

async function open_(request, env, ctx, need) {
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

/** ctx: { migration, from, to, minCell? } - aggregate rows, disclosure-controlled. */
async function extract(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", groups: [] };

  const fromMs = Date.parse(str(ctx.from)), toMs = Date.parse(str(ctx.to));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return { ...base, ok: false, status: 422, error: "period_required", detail: "an extract covers a stated period: from and to, as dates", groups: [] };
  }

  const { svc, error } = await open_(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, groups: [] };

  let encounters, administrations, reports, loops, overrides;
  try {
    [encounters, administrations, reports, loops, overrides] = await Promise.all([
      svc.list("Encounter", 1000).catch(() => []),
      svc.list("MedicationAdministration", 1000).catch(() => []),
      svc.list("DiagnosticReport", 1000).catch(() => []),
      svc.list("CriticalResultLoop", 1000).catch(() => []),
      svc.list("SafetyOverride", 1000).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), groups: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), groups: [] };
  }

  /* Every key below is a fixed, enumerated, non-identifying label - a class of encounter, a state, a
   * rule id. None of them is derived from anything a patient supplied, so no free-text field can
   * become a category that names somebody. */
  const groups = [
    { id: "encounters-by-class", title: "Encounters by class", ...suppress(tally(encounters, (e) => e.class, fromMs, toMs, "startedAt"), ctx.minCell) },
    { id: "administrations-by-state", title: "Medication administrations by outcome", ...suppress(tally(administrations, (a) => a.status, fromMs, toMs, "givenAt"), ctx.minCell) },
    { id: "reports-by-status", title: "Diagnostic reports by status", ...suppress(tally(reports, (r) => r.status, fromMs, toMs, "reportedAt"), ctx.minCell) },
    { id: "critical-loops-by-state", title: "Critical result loops by state", ...suppress(tally(loops, (l) => l.state, fromMs, toMs, "openedAt"), ctx.minCell) },
    /* The rule, never the clinician. Same reason as the override report: a number attributable to an
     * individual stops measuring the process and starts managing the staff. */
    { id: "overrides-by-rule", title: "Safety overrides by rule", ...suppress(tally(overrides, (o) => o.ruleId, fromMs, toMs, "at"), ctx.minCell) },
  ];

  const withheld = groups.reduce((n, g) => n + (g.suppressed || 0), 0);
  return {
    ...base, ok: true, from: str(ctx.from), to: str(ctx.to), groups,
    minCell: groups.length ? groups[0].floor : MIN_CELL,
    totalSuppressed: withheld,
    countable: [...COUNTABLE],
    /* Said on every extract, including the ones with nothing suppressed - a reader who only ever
     * sees the note when it bites learns to read its absence as "complete". */
    disclosure: `Cells below ${groups.length ? groups[0].floor : MIN_CELL} are withheld, and where one is withheld the next-smallest goes too so it cannot be recovered by subtraction. A withheld cell is not a zero.`,
    note: "Aggregates only. No patient identifier, pseudonym, date of birth or clinician name appears in this extract, and nothing here is attributed to an individual. This is an extract, not a warehouse: where it is loaded is another system's decision.",
  };
}

export { MIN_CELL, COUNTABLE, suppress, tally, extract };
