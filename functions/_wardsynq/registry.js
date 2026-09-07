/* functions/_wardsynq/registry.js — the cohort, and who in it is overdue.
 *
 * A REGISTRY NAMES PATIENTS, and that is the one way it differs from every other reporting surface
 * in this directory. quality.js names nobody on purpose: a measure that can be attributed to an
 * individual stops measuring the process and starts managing the staff. A registry is the opposite
 * kind of object - it exists precisely to answer "WHICH of my diabetics has not had an HbA1c this
 * year", and a registry that could not name them would be a number nobody could act on.
 *
 * So it costs more to read. It is chart-level PHI: a list of names beside their diagnoses is exactly
 * what a browsing incident looks like, and it is gated on the authority to read a chart rather than
 * on the lower bar that opens a ward list.
 *
 * MEMBERSHIP IS DERIVED FROM THE PROBLEM LIST, NEVER A SEPARATE FLAG. A "diabetes registry" table
 * that anybody can add to is a second source of truth, and it drifts the first day somebody resolves
 * a diagnosis without remembering the registry. Resolve the problem and the patient leaves the
 * cohort; the append-only record still holds that they were once in it.
 *
 * NOTHING IS MATCHED BY GUESSING. A registry is defined by CODES, or by display strings the hospital
 * itself wrote. "Diabetes" does not match "Diabetes insipidus" - two unrelated diseases whose names
 * share a word - and a registry that guessed would put the wrong patients on a recall list and,
 * worse, leave the right ones off it.
 *
 * OVERDUE IS COMPUTED, AND "NEVER" IS NOT "RECENTLY". A patient with no qualifying result at all is
 * the most overdue person on the list, not the least: sorting them as though they had just been seen
 * is how somebody goes years without a review. They are reported as `never`, distinctly.
 *
 * IT DEFINES NO DISEASE. The codes, the review interval and the test that counts as a review are all
 * the hospital's clinical content. Nothing here knows that diabetes is reviewed yearly.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const norm = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v) => {
  if (v === null || v === undefined || (typeof v !== "number" && str(v) === "")) return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * PURE. The hospital's registry definitions, validated. An unusable one is REPORTED: a registry that
 * silently failed to load looks exactly like a disease nobody in the hospital has.
 */
function resolveRegistries(list) {
  const rows = Array.isArray(list) ? list : [];
  const registries = [], problems = [];

  rows.forEach((raw, index) => {
    const r = raw && typeof raw === "object" ? raw : {};
    const id = str(r.id), name = str(r.name);
    if (!id) { problems.push({ index, reason: "no_id" }); return; }
    const codes = (Array.isArray(r.problemCodes) ? r.problemCodes : []).map(norm).filter(Boolean);
    /* A registry with no codes would match every patient or none, and either way it is not the
     * cohort anybody meant. */
    if (!codes.length) { problems.push({ index, id, reason: "no_problem_codes" }); return; }

    const review = r.review && typeof r.review === "object" ? r.review : null;
    const months = review ? num(review.everyMonths) : null;
    const code = review ? norm(review.observationCode) : "";
    // A review interval with no test to look for, or a test with no interval, cannot say who is
    // overdue. The cohort still works; the recall does not, and that is stated rather than faked.
    const recall = months !== null && months > 0 && code
      ? { everyMonths: months, observationCode: code, display: str(review.display) || null }
      : null;
    if (review && !recall) problems.push({ index, id, reason: "review_needs_interval_and_code" });

    registries.push({ id, name: name || id, problemCodes: codes, recall });
  });

  return { registries, ...(problems.length ? { problems } : {}) };
}

/** PURE. Does this patient's problem list put them in this cohort? Codes, or the hospital's words. */
function inCohort(registry, conditions) {
  const codes = (registry && registry.problemCodes) || [];
  return (conditions || []).some((c) => {
    if (!c || c.clinicalStatus === "resolved" || c.clinicalStatus === "inactive") return false;
    // A REFUTED diagnosis is one somebody considered and ruled out. Putting them on a recall list for
    // a disease they were found not to have is both wrong and alarming to receive a letter about.
    if (c.verificationStatus === "refuted") return false;
    return codes.includes(norm(c.code)) || codes.includes(norm(c.display));
  });
}

/**
 * PURE. When this patient was last reviewed, and whether that is overdue.
 *
 * `never` is its own state, and it sorts as the MOST overdue. A patient with no qualifying result is
 * not "up to date"; they are the person the registry exists to find.
 */
function reviewStatus(recall, observations, nowMs) {
  if (!recall) return { state: "no-recall", detail: "This registry has no review interval configured." };
  const want = recall.observationCode;
  const times = (observations || [])
    .filter((o) => o && norm(o.code) === want)
    .map((o) => Date.parse(str((o.meta && o.meta.effectiveAt) || o.effectiveAt || (o.meta && o.meta.recordedAt))))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!times.length) return { state: "never", overdue: true, lastReview: null, detail: "No qualifying result has ever been recorded for this patient." };

  const last = times[0];
  const dueAt = last + recall.everyMonths * 30 * 86400000;
  const overdue = now > dueAt;
  return {
    state: overdue ? "overdue" : "current",
    overdue,
    lastReview: new Date(last).toISOString(),
    dueAt: new Date(dueAt).toISOString(),
    ...(overdue ? { overdueDays: Math.floor((now - dueAt) / 86400000) } : {}),
  };
}

/** PURE. Most overdue first: never, then longest overdue, then current. */
function memberRank(m) {
  if (m.review.state === "never") return [0, 0];
  if (m.review.state === "overdue") return [1, -(m.review.overdueDays || 0)];
  return [2, 0];
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

/** ctx: { migration, registries, registryId?, overdueOnly?, now?, actorDeps, recordDeps } */
async function registryReport(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", registries: [] };

  const defs = resolveRegistries(ctx.registries);
  if (!defs.registries.length) {
    return { ...base, ok: true, registries: [], ...(defs.problems ? { problems: defs.problems } : {}), note: "This hospital has configured no registries." };
  }

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, registries: [] };

  let conditions, observations, patients;
  try {
    [conditions, observations, patients] = await Promise.all([
      svc.list("Condition", 2000),
      svc.list("Observation", 5000).catch(() => []),
      svc.list("Patient", 2000).catch(() => []),
    ]);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), registries: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), registries: [] };
  }

  const byPatient = new Map();
  for (const c of conditions || []) {
    if (!c || !c.patientId) continue;
    byPatient.set(c.patientId, [...(byPatient.get(c.patientId) || []), c]);
  }
  const obsByPatient = new Map();
  for (const o of observations || []) {
    if (!o || !o.patientId) continue;
    obsByPatient.set(o.patientId, [...(obsByPatient.get(o.patientId) || []), o]);
  }
  const mrnOf = new Map((patients || []).filter(Boolean).map((p) => [p.id, p.mrn || null]));

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const wanted = str(ctx.registryId);
  const out = [];

  for (const reg of defs.registries) {
    if (wanted && reg.id !== wanted) continue;
    const members = [];
    for (const [patientId, conds] of byPatient) {
      if (!inCohort(reg, conds)) continue;
      const review = reviewStatus(reg.recall, obsByPatient.get(patientId) || [], nowMs);
      members.push({
        patientId, mrn: mrnOf.get(patientId) || null,
        // The problem that put them in the cohort, so a reader can see WHY without opening a chart.
        because: (conds.find((c) => reg.problemCodes.includes(norm(c.code)) || reg.problemCodes.includes(norm(c.display))) || {}).display || null,
        review,
      });
    }
    members.sort((a, b) => { const x = memberRank(a), y = memberRank(b); return (x[0] - y[0]) || (x[1] - y[1]); });
    const shown = ctx.overdueOnly ? members.filter((m) => m.review.overdue) : members;
    out.push({
      id: reg.id, name: reg.name,
      total: members.length,
      /* Counted separately, because "never reviewed" and "reviewed and now due" are different pieces
       * of work: one is a patient the service has lost, the other is one it is about to. */
      neverReviewed: members.filter((m) => m.review.state === "never").length,
      overdue: members.filter((m) => m.review.state === "overdue").length,
      ...(reg.recall ? { reviewEveryMonths: reg.recall.everyMonths } : { recall: null, detail: "No review interval configured, so nobody is shown as overdue." }),
      members: shown,
    });
  }

  return {
    ...base, ok: true, registries: out,
    ...(defs.problems ? { problems: defs.problems } : {}),
    /* Stated, because this is the one report in WardSynQ that names people. */
    note: "A registry NAMES PATIENTS - that is what makes a recall possible. Membership is derived "
      + "from the problem list, so resolving a diagnosis removes the patient from the cohort.",
  };
}

export { resolveRegistries, inCohort, reviewStatus, memberRank, registryReport };
