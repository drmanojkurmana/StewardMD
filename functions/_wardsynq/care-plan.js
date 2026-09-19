/* functions/_wardsynq/care-plan.js — what the ward is trying to achieve, and whether it is working.
 *
 * `CarePlan` has been in the canonical model and in the record service's allowed types since P0, and
 * like `Condition` before it, NOTHING HAS EVER WRITTEN ONE. The 2026-09-07 audit found the same
 * pattern: a type carried in the model, indexed by the store, and produced by nobody.
 *
 * A care plan is what turns a ward from a series of tasks into treatment with a direction. Without
 * one, a chart says a patient had four doses and two dressings and cannot say whether the pressure
 * area is healing, whether the mobility goal was met, or what the plan actually was when the next
 * shift arrives.
 *
 * A GOAL WITHOUT A MEASURE IS A WISH. Every goal here carries how it will be judged, in the words of
 * whoever set it. "Improve mobility" is not a goal; "walk to the bathroom with one assistant by
 * Friday" is, because a nurse three shifts later can tell whether it happened. A plan of unmeasurable
 * goals is a plan that can never be wrong, which is the same as one that never helped.
 *
 * PROGRESS IS RECORDED, NEVER COMPUTED. Nothing here infers that a goal is met because a dressing was
 * changed or because time passed. A goal is met when a clinician says so, with the date and their
 * name on it - and it can go the other way too, because patients deteriorate and a plan that could
 * only improve would be a plan nobody trusted.
 *
 * A PLAN THAT NOBODY HAS REVIEWED IS SAID TO BE STALE, not quietly left looking current. `reviewBy`
 * makes that computable rather than a judgement, and the ward metrics can then count it. A care plan
 * written on admission and never touched again is the characteristic failure of care planning, and
 * a system that cannot see it is participating in it.
 *
 * IT DOES NOT ORDER ANYTHING. A plan says what is being aimed at; the medicines, investigations and
 * observations that pursue it go through their own paths with their own authority and checks.
 */

import { CarePlan } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** Where a goal stands. `not-met` is a real outcome, not a failure to record one. */
const GOAL_STATES = Object.freeze(["active", "met", "not-met", "cancelled"]);
/** Where the plan stands. */
const PLAN_STATES = Object.freeze(["active", "completed", "cancelled"]);

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One plan per admission. A stay has one plan; its goals are the things that change. */
function planIdFor(encounterId) { const e = slug(encounterId); return e ? `wsq-plan-${e}` : null; }
function goalKey(title) { return slug(title); }

/**
 * PURE. Goal rows to something storable. A goal with no MEASURE is refused, not stored as a wish.
 */
function goalsFrom(rows) {
  const out = [], rejected = [];
  const seen = new Set();
  for (let i = 0; i < (Array.isArray(rows) ? rows : []).length; i++) {
    const g = rows[i] || {};
    const title = str(g.title);
    if (!title) { rejected.push({ index: i, reason: "no_title" }); continue; }
    const measure = str(g.measure);
    /* "Improve mobility" is not a goal. "Walk to the bathroom with one assistant by Friday" is,
     * because a nurse three shifts later can tell whether it happened. A plan of unmeasurable goals
     * can never be wrong, which is the same as one that never helped. */
    if (!measure) { rejected.push({ index: i, reason: "no_measure", title }); continue; }
    const key = goalKey(title);
    if (seen.has(key)) { rejected.push({ index: i, reason: "duplicate", title }); continue; }
    seen.add(key);
    out.push({
      key, title, measure,
      targetDate: str(g.targetDate) || null,
      state: "active", note: str(g.note) || null,
      setBy: null, setAt: null, decidedBy: null, decidedAt: null, outcomeNote: null,
    });
  }
  return { goals: out, rejected };
}

/**
 * PURE. Is this plan overdue a review? COMPUTED, never stored: a stored "current" is a lie the
 * moment the date passes, and a plan written on admission and never touched again is the
 * characteristic failure of care planning.
 */
function reviewStatus(plan, nowMs) {
  if (!plan || plan.state !== "active") return { state: "closed", overdueDays: 0 };
  const by = Date.parse(plan.reviewBy || "");
  if (!Number.isFinite(by)) return { state: "no-review-date", overdueDays: 0 };
  const days = Math.floor(((Number.isFinite(nowMs) ? nowMs : Date.now()) - by) / 86400000);
  return days > 0 ? { state: "stale", overdueDays: days } : { state: "current", overdueDays: 0 };
}

/** PURE. What a ward reads at a glance. */
function planSummary(plan, nowMs) {
  const goals = (plan && plan.goals) || [];
  const counts = {};
  for (const s of GOAL_STATES) counts[s] = goals.filter((g) => g.state === s).length;
  return {
    planId: plan.id, patientId: plan.patientId, encounterId: plan.encounterId || null,
    title: plan.title || null, state: plan.state,
    goals, counts,
    activeGoals: counts.active || 0,
    review: reviewStatus(plan, nowMs),
    reviewBy: plan.reviewBy || null, lastReviewedBy: plan.lastReviewedBy || null, lastReviewedAt: plan.lastReviewedAt || null,
    createdBy: plan.createdBy || null, createdAt: plan.createdAt || null,
    version: plan.version,
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
function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", detail: e.detail, ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/** Builds the canonical CarePlan with the fields the model has no slot for bolted on, as elsewhere. */
function buildPlan(i) {
  const p = CarePlan({
    id: i.id, patientId: i.patientId, encounterId: i.encounterId || null,
    status: PLAN_STATES.includes(i.state) ? i.state : "active",
    // The model carries `goals` natively and REQUIRES an author, so both are passed rather than
    // bolted on: a plan with no named author is one nobody owns.
    goals: Array.isArray(i.goals) ? i.goals : [],
    authorId: i.createdBy || i.authorId,
    source: { system: "wardsynq-native", sourceId: `care-plan:${i.id}` },
  });
  p.state = p.status;
  p.title = i.title || null;
  p.reviewBy = i.reviewBy || null;
  p.createdBy = i.createdBy || null;
  p.createdAt = i.createdAt || null;
  p.lastReviewedBy = i.lastReviewedBy || null;
  p.lastReviewedAt = i.lastReviewedAt || null;
  return p;
}

/**
 * Opens or updates the plan for a stay.
 * ctx: { migration, encounterId, title?, goals?, reviewBy?, actorDeps, recordDeps }
 */
async function setCarePlan(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };

  const id = planIdFor(encounterId);
  let current;
  try { current = await svc.get("CarePlan", id); }
  catch { current = null; }

  const { goals: incoming, rejected } = goalsFrom(ctx.goals);
  const now = new Date().toISOString();
  /* Adding goals KEEPS the progress already recorded against goals still on the plan. A second pass
   * (the night shift adds a goal) must not reset what the day shift decided, and a goal that has
   * DISAPPEARED from the list is dropped, because somebody removed it deliberately. */
  const prior = new Map(((current && current.goals) || []).map((g) => [g.key, g]));
  const goals = incoming.map((g) => {
    const was = prior.get(g.key);
    return was
      ? { ...g, state: was.state, setBy: was.setBy, setAt: was.setAt, decidedBy: was.decidedBy, decidedAt: was.decidedAt, outcomeNote: was.outcomeNote }
      : { ...g, setBy: resolved.actor.id, setAt: now };
  });
  if (!goals.length && !current) {
    return { ...base, ok: false, status: 422, error: "no_goals", detail: "a plan with no measurable goal is not a plan", ...(rejected.length ? { rejected } : {}), written: 0 };
  }

  const plan = buildPlan({
    id, patientId: encounter.patientId, encounterId,
    title: str(ctx.title) || (current && current.title) || null,
    goals: goals.length ? goals : (current ? current.goals : []),
    state: (current && current.state) || "active",
    reviewBy: str(ctx.reviewBy) || (current && current.reviewBy) || null,
    createdBy: (current && current.createdBy) || resolved.actor.id,
    createdAt: (current && current.createdAt) || now,
    lastReviewedBy: current && current.lastReviewedBy, lastReviewedAt: current && current.lastReviewedAt,
  });
  try {
    const out = await svc.put(plan, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...planSummary({ ...plan, version: out.record.version }), ...(rejected.length ? { rejected } : {}), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { planId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * Records progress against one goal, or reviews the plan.
 * ctx: { migration, encounterId, key?, state?, note?, review?, reviewBy?, actorDeps, recordDeps }
 */
async function recordProgress(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const id = planIdFor(str(ctx.encounterId));
  if (!id) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get("CarePlan", id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "no_care_plan", detail: "open a plan before recording progress against it", planId: id, written: 0 };

  const now = new Date().toISOString();
  let goals = current.goals || [];
  let reviewed = false;

  if (ctx.review) {
    // A review is a fact about the plan: somebody looked at it, on this date. It is what makes
    // "stale" mean anything.
    reviewed = true;
  }
  const key = goalKey(str(ctx.key) || str(ctx.title));
  if (key) {
    const state = str(ctx.state);
    if (!GOAL_STATES.includes(state) || state === "active") {
      return { ...base, ok: false, status: 400, error: "unknown_goal_state", detail: `state must be one of ${GOAL_STATES.filter((s) => s !== "active").join(", ")}`, written: 0 };
    }
    const idx = goals.findIndex((g) => g.key === key);
    // A decision about a goal that is not on the plan is refused, never appended: it would create a
    // goal nobody set and immediately mark it done.
    if (idx < 0) return { ...base, ok: false, status: 404, error: "goal_not_on_plan", key, written: 0 };
    const note = str(ctx.note);
    // "Not met" needs a reason - it is the outcome somebody will ask about later.
    if (state === "not-met" && !note) return { ...base, ok: false, status: 422, error: "note_required", detail: "say why this goal was not met", written: 0 };
    goals = goals.map((g, i) => (i === idx ? { ...g, state, decidedBy: resolved.actor.id, decidedAt: now, outcomeNote: note || null } : g));
  }
  if (!key && !reviewed) return { ...base, ok: false, status: 422, error: "nothing_to_record", written: 0 };

  const next = buildPlan({
    ...current, goals,
    reviewBy: str(ctx.reviewBy) || current.reviewBy,
    lastReviewedBy: reviewed ? resolved.actor.id : current.lastReviewedBy,
    lastReviewedAt: reviewed ? now : current.lastReviewedAt,
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...planSummary({ ...next, version: out.record.version }), reviewed, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { planId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** Reads the plan. ctx: { migration, encounterId, actorDeps, recordDeps } */
async function readCarePlan(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", plan: null };

  const id = planIdFor(str(ctx.encounterId));
  if (!id) return { ...base, ok: false, status: 422, error: "encounter_required", plan: null };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, plan: null };

  let plan;
  try { plan = await svc.get("CarePlan", id); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), plan: null };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), plan: null };
  }
  // An absent plan is stated, not returned as an empty one: "no plan has been written" and "a plan
  // with no goals" are different, and the first is the one a ward has to act on.
  if (!plan) return { ...base, ok: true, planId: id, plan: null, exists: false };
  return { ...base, ok: true, exists: true, plan: planSummary(plan, Date.now()) };
}

export {
  GOAL_STATES, PLAN_STATES, planIdFor, goalKey, goalsFrom, reviewStatus, planSummary,
  setCarePlan, recordProgress, readCarePlan,
};
