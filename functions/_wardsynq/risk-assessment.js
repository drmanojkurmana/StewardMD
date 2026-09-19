/* functions/_wardsynq/risk-assessment.js — the scored nursing assessments, and what they are for.
 *
 * Falls, pressure damage and malnutrition are the three things a ward is most often asked to have
 * assessed, and the three most often filled in once on admission and never again. WardSynQ recorded
 * vitals, fluid, handover and care plans, and had no structured assessment at all.
 *
 * THE SCORE IS NOT THE POINT; THE ACTION IS. A risk score that produces a number and no consequence
 * is paperwork, and wards learn very fast which paperwork changes nothing. So every assessment here
 * yields a BAND and the actions that band calls for, and an assessment whose actions nobody has
 * acted on stays visibly open. The number exists to select the actions.
 *
 * IT SCORES WHAT IT IS GIVEN AND NOTHING ELSE. Every item must be answered; a missing item makes the
 * assessment INCOMPLETE and it is refused rather than scored with the gap treated as zero. A score
 * computed over half the questions is a smaller number than the truth, and it errs towards saying a
 * patient is safe - the one direction a risk tool must never drift.
 *
 * THE TOOLS ARE NAMED, VERSIONED CONTENT, NOT INVENTED CLINICAL SCIENCE. WardSynQ ships the
 * STRUCTURE - items, weights, bands, actions - and a hospital supplies the tool it has approved,
 * exactly as it does its order sets and its critical limits. This file contains no threshold I made
 * up, because a fabricated risk band that reads as a validated one is worse than no tool at all:
 * a ward would act on it.
 *
 * REASSESSMENT IS DUE, AND OVERDUE IS COMPUTED. A pressure assessment done on admission and never
 * repeated is exactly how a heel ulcer develops on a ward that "assesses risk". `reassessEvery` makes
 * that computable rather than a matter of somebody remembering.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "RiskAssessment";

/**
 * PURE. Validates a tool definition supplied by the hospital.
 *
 * A tool needs items with numeric options and bands that cover the whole range. A malformed one is
 * REPORTED, never silently repaired: quietly patching a risk tool would produce scores nobody could
 * reconcile with the paper version the ward is used to.
 */
function resolveTool(def) {
  const d = def || {};
  const id = str(d.id), name = str(d.name);
  if (!id || !name) return { ok: false, error: "tool_incomplete", detail: "a tool needs an id and a name" };

  const items = [], problems = [];
  const seen = new Set();
  for (let i = 0; i < (Array.isArray(d.items) ? d.items : []).length; i++) {
    const it = d.items[i] || {};
    const key = str(it.key);
    const options = Array.isArray(it.options) ? it.options : [];
    if (!key) { problems.push({ index: i, reason: "no_key" }); continue; }
    if (seen.has(key)) { problems.push({ index: i, reason: "duplicate", key }); continue; }
    const usable = options.map((o) => ({ value: str(o && o.value), score: Number(o && o.score), label: str(o && o.label) || str(o && o.value) }))
      .filter((o) => o.value && Number.isFinite(o.score));
    // An item whose options carry no usable score cannot contribute, and an item that silently
    // contributes zero is how a tool quietly reports a lower risk than the paper one.
    if (usable.length !== options.length || !usable.length) { problems.push({ index: i, reason: "bad_options", key }); continue; }
    seen.add(key);
    items.push({ key, title: str(it.title) || key, options: usable });
  }
  if (!items.length) return { ok: false, error: "tool_empty", detail: "no usable items", problems };

  const bands = (Array.isArray(d.bands) ? d.bands : []).map((b) => ({
    band: str(b && b.band), min: Number(b && b.min), max: Number(b && b.max),
    actions: (Array.isArray(b && b.actions) ? b.actions : []).map(str).filter(Boolean),
  })).filter((b) => b.band && Number.isFinite(b.min) && Number.isFinite(b.max));
  // A tool with no bands produces a number and no consequence, which is the paperwork this file
  // exists to avoid producing.
  if (!bands.length) return { ok: false, error: "no_bands", detail: "a score with no band and no actions is paperwork", problems };

  return { ok: true, id, name, version: str(d.version) || "0", items, bands, reassessEvery: Number(d.reassessEveryHours) || null, problems };
}

/**
 * PURE. Scores answers against a tool, or says why it cannot.
 *
 * EVERY ITEM MUST BE ANSWERED. A score over half the questions is a smaller number than the truth
 * and errs towards saying a patient is safe, which is the one direction a risk tool must not drift.
 */
function score(tool, answers) {
  const a = answers && typeof answers === "object" ? answers : {};
  const missing = [], invalid = [];
  let total = 0;
  const chosen = {};
  for (const item of tool.items) {
    const v = str(a[item.key]);
    if (!v) { missing.push(item.key); continue; }
    const opt = item.options.find((o) => o.value === v);
    // An answer the tool does not offer is refused, not scored as zero.
    if (!opt) { invalid.push({ key: item.key, value: v }); continue; }
    chosen[item.key] = { value: opt.value, label: opt.label, score: opt.score };
    total += opt.score;
  }
  if (missing.length || invalid.length) {
    return { ok: false, error: "incomplete", missing, invalid, detail: "every item must be answered; a partial score reads lower than the truth" };
  }
  const band = tool.bands.find((b) => total >= b.min && total <= b.max) || null;
  return {
    ok: true, total, chosen,
    band: band ? band.band : null,
    // A score outside every band is REPORTED rather than assigned to the nearest one: the tool's
    // bands are the hospital's clinical content and guessing past them would be inventing it.
    actions: band ? band.actions : [],
    ...(band ? {} : { unbanded: true, detail: `score ${total} falls outside every band this tool defines` }),
  };
}

/** PURE. Is a reassessment due? COMPUTED, so it cannot go stale. */
function reassessmentStatus(assessment, tool, nowMs) {
  if (!assessment) return { state: "none", overdueHours: 0 };
  const every = Number((tool && tool.reassessEvery) || assessment.reassessEvery);
  const at = Date.parse(assessment.assessedAt || "");
  if (!Number.isFinite(every) || every <= 0 || !Number.isFinite(at)) return { state: "no-interval", overdueHours: 0 };
  const hours = Math.floor(((Number.isFinite(nowMs) ? nowMs : Date.now()) - at) / 3600000) - every;
  return hours > 0 ? { state: "overdue", overdueHours: hours } : { state: "current", overdueHours: 0 };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** One assessment per (encounter, tool, moment): a reassessment is a new one, not an overwrite. */
function assessmentIdFor(encounterId, toolId, at) {
  const e = slug(encounterId), t = slug(toolId), m = slug(at);
  return e && t && m ? `wsq-risk-${e}-${t}-${m}` : null;
}

function RiskAssessment(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id, patientId: i.patientId, encounterId: i.encounterId || null,
    toolId: i.toolId, toolName: i.toolName || null, toolVersion: i.toolVersion || null,
    answers: i.answers || {}, total: Number.isFinite(i.total) ? i.total : null,
    band: i.band || null, actions: Array.isArray(i.actions) ? i.actions : [],
    /* Which of the band's actions have been done. The score selects the actions; this is the only
     * part that changes anything for the patient, so it is on the record and it is countable. */
    actionsDone: Array.isArray(i.actionsDone) ? i.actionsDone : [],
    reassessEvery: Number.isFinite(i.reassessEvery) ? i.reassessEvery : null,
    assessedBy: i.assessedBy || null, assessedAt: i.assessedAt || null,
    source: { system: "wardsynq-native", sourceId: `risk:${i.id}` },
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

/** The tools this hospital has approved. */
async function listTools(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", tools: [] };
  const all = (Array.isArray(ctx.tools) ? ctx.tools : []).map(resolveTool);
  return {
    ...base, ok: true,
    tools: all.filter((t) => t.ok).map((t) => ({ id: t.id, name: t.name, version: t.version, items: t.items, bands: t.bands, reassessEveryHours: t.reassessEvery, ...(t.problems && t.problems.length ? { problems: t.problems } : {}) })),
    ...(all.some((t) => !t.ok) ? { unusable: all.filter((t) => !t.ok).map((t, i) => ({ index: i, error: t.error, detail: t.detail, problems: t.problems || [] })) } : {}),
  };
}

/** Records an assessment. ctx: { migration, tools, toolId, encounterId, answers, at?, ... } */
async function recordAssessment(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const toolId = str(ctx.toolId), encounterId = str(ctx.encounterId);
  if (!toolId || !encounterId) return { ...base, ok: false, status: 422, error: "tool_and_encounter_required", written: 0 };

  const def = (Array.isArray(ctx.tools) ? ctx.tools : []).find((d) => d && str(d.id) === toolId);
  if (!def) return { ...base, ok: false, status: 404, error: "tool_not_found", toolId, written: 0 };
  const tool = resolveTool(def);
  if (!tool.ok) return { ...base, ok: false, status: 422, error: tool.error, detail: tool.detail, problems: tool.problems, written: 0 };

  const scored = score(tool, ctx.answers);
  if (!scored.ok) return { ...base, ok: false, status: 422, error: scored.error, detail: scored.detail, missing: scored.missing, invalid: scored.invalid, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = assessmentIdFor(encounterId, toolId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const rec = RiskAssessment({
    id, patientId: encounter.patientId, encounterId,
    toolId: tool.id, toolName: tool.name, toolVersion: tool.version,
    answers: scored.chosen, total: scored.total, band: scored.band, actions: scored.actions,
    reassessEvery: tool.reassessEvery,
    assessedBy: resolved.actor.id, assessedAt: at,
  });
  try {
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, assessmentId: id, patientId: rec.patientId, encounterId,
      toolId: tool.id, toolVersion: tool.version, total: scored.total, band: scored.band,
      /* THE ACTIONS ARE THE POINT. A score with no consequence is paperwork, and wards learn very
       * fast which paperwork changes nothing. */
      actions: scored.actions, actionsOutstanding: scored.actions.length,
      ...(scored.unbanded ? { unbanded: true, detail: scored.detail } : {}),
      version: out.record.version, actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { assessmentId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** Records that one of the band's actions was carried out. */
async function completeAction(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const assessmentId = str(ctx.assessmentId), action = str(ctx.action);
  if (!assessmentId || !action) return { ...base, ok: false, status: 422, error: "assessment_and_action_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, assessmentId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "assessment_not_found", assessmentId, written: 0 };
  // An action the band never called for is refused, not appended: it would let the outstanding count
  // be cleared by doing something else.
  if (!(current.actions || []).includes(action)) return { ...base, ok: false, status: 404, error: "action_not_in_band", action, written: 0 };
  if ((current.actionsDone || []).some((d) => d && d.action === action)) return { ...base, ok: true, written: 0, skipped: "already_done", assessmentId, action };

  const next = RiskAssessment({
    ...current,
    actionsDone: [...(current.actionsDone || []), { action, by: resolved.actor.id, at: new Date().toISOString(), note: str(ctx.note) || null }],
  });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    const outstanding = (next.actions || []).filter((a) => !next.actionsDone.some((d) => d.action === a));
    return { ...base, ok: true, written: 1, assessmentId, action, actionsOutstanding: outstanding.length, outstanding, version: out.record.version, actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { assessmentId, written: 0, actor: resolved.actor.id }) };
  }
}

/** The assessments for a stay, with what is still outstanding and what is due again. */
async function listAssessments(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", assessments: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", assessments: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, assessments: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), assessments: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), assessments: [] };
  }

  const nowMs = Date.now();
  // The LATEST assessment per tool is the one that stands; the earlier ones are history.
  const latest = new Map();
  for (const r of (rows || []).filter(Boolean)) {
    const prev = latest.get(r.toolId);
    if (!prev || String(r.assessedAt || "") > String(prev.assessedAt || "")) latest.set(r.toolId, r);
  }
  const assessments = [...latest.values()].map((r) => {
    const outstanding = (r.actions || []).filter((a) => !(r.actionsDone || []).some((d) => d && d.action === a));
    return {
      assessmentId: r.id, toolId: r.toolId, toolName: r.toolName, toolVersion: r.toolVersion,
      total: r.total, band: r.band, actions: r.actions || [], outstanding,
      actionsOutstanding: outstanding.length,
      assessedBy: r.assessedBy, assessedAt: r.assessedAt,
      reassessment: reassessmentStatus(r, null, nowMs),
      version: r.version,
    };
  }).sort((a, b) => b.actionsOutstanding - a.actionsOutstanding);

  return {
    ...base, ok: true, patientId, assessments,
    /* The two numbers a ward acts on. An assessment whose actions nobody has done, and one nobody
     * has repeated, are the two ways a risk tool becomes paperwork. */
    actionsOutstanding: assessments.reduce((n, a) => n + a.actionsOutstanding, 0),
    reassessmentsOverdue: assessments.filter((a) => a.reassessment.state === "overdue").length,
  };
}

export {
  TYPE, RiskAssessment, resolveTool, score, reassessmentStatus, assessmentIdFor,
  listTools, recordAssessment, completeAction, listAssessments,
};
