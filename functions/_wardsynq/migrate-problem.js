/* functions/_wardsynq/migrate-problem.js — the problem list.
 *
 * `Condition` has been in the canonical model, in the record service's allowed types, and in the
 * store's index since P0, and the 2026-09-07 audit found it had ZERO write paths anywhere in the
 * repository. Diagnoses lived only as free text inside an assessment note. That is the gap this
 * closes, and it is a foundational one: a problem list is what decision support checks against, what
 * a discharge summary reports, what coding and billing derive from, and what the next clinician
 * reads first. A chart whose diagnoses are prose cannot do any of those.
 *
 * IT IS A LIST OF CLAIMS, NOT A LIST OF TRUTHS. Every entry carries who asserted it and how
 * confident they were: `verificationStatus` is provisional / differential / confirmed / refuted, and
 * it defaults to PROVISIONAL. Nothing here promotes a diagnosis on its own - a working diagnosis
 * becomes confirmed because a clinician said so, never because time passed or a test came back.
 *
 * RESOLVING IS A NEW VERSION, NOT A DELETION. `clinicalStatus` moves active -> resolved / inactive
 * and the prior version stays on the record. A problem list you can silently erase is a chart that
 * can be made to say a diagnosis was never entertained.
 *
 * NO NEW TERMINOLOGY. The code is whatever the site already uses - ICD-10 through the existing
 * /api/icd lookup, or a plain text label with codeSystem "text" when the clinician has no code to
 * hand. A free-text problem is recorded honestly as free text rather than being forced into a code
 * nobody chose; inventing a coding scheme here is exactly what the OPD lab work was careful not to
 * do, and a wrong code is worse than an uncoded one.
 */

import { Condition } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** What a clinician may assert about a diagnosis, worst-confidence first. */
const VERIFICATION = Object.freeze(["provisional", "differential", "confirmed", "refuted"]);
/** Where a problem currently stands. */
const CLINICAL = Object.freeze(["active", "resolved", "inactive"]);

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

/**
 * One problem per (patient, coded concept). Deterministic, so recording the same diagnosis twice
 * updates the ONE entry rather than growing a duplicate list - a problem list with "Type 2 diabetes"
 * on it three times is how a real one becomes unreadable and then ignored.
 */
function problemIdFor(patientId, code) {
  const p = str(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const c = str(code).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return p && c ? `wsq-prob-${p}-${c}` : null;
}

/** PURE. The request to a canonical Condition. Returns null when it cannot name a patient or a problem. */
function conditionFromRequest(input) {
  const patientId = str(input && input.patientId);
  const code = str(input && input.code) || str(input && input.display);
  const display = str(input && input.display) || code;
  if (!patientId || !code) return null;

  const verification = VERIFICATION.includes(str(input.verificationStatus)) ? str(input.verificationStatus) : "provisional";
  const clinical = CLINICAL.includes(str(input.clinicalStatus)) ? str(input.clinicalStatus) : "active";
  const id = problemIdFor(patientId, code);
  if (!id) return null;

  const c = Condition({
    id, patientId,
    encounterId: str(input.encounterId) || null,
    code,
    // "text" is an honest answer. A clinician who has no code to hand records the words they mean,
    // and a reader can tell that apart from a coded diagnosis at a glance.
    codeSystem: str(input.codeSystem) || (str(input.code) ? "unspecified" : "text"),
    display,
    clinicalStatus: clinical,
    verificationStatus: verification,
    onsetDate: str(input.onsetDate) || null,
    source: { system: "wardsynq-native", sourceId: `problem:${id}` },
  });
  // Bolted on, the convention every sibling migration uses: who asserted this, and any note they
  // attached to it. The model has no field for either and both matter on a problem list.
  const note = str(input.note);
  if (note) c.note = note;
  return c;
}

/** PURE. Same claim, same standing: nothing new to say. */
function sameProblem(a, b) {
  if (!a || !b) return false;
  return a.patientId === b.patientId && a.code === b.code && a.display === b.display
    && a.clinicalStatus === b.clinicalStatus && a.verificationStatus === b.verificationStatus
    && (a.onsetDate || null) === (b.onsetDate || null) && (a.note || "") === (b.note || "");
}

/**
 * Adds or updates one problem. ctx: { migration, problem: {...}, actorDeps, recordDeps }
 * Recording the same concept again is an UPDATE of the one entry, as a new version.
 */
async function recordProblem(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  const candidate = conditionFromRequest(ctx.problem);
  if (!candidate) return { ...base, ok: false, status: 422, error: "problem_incomplete", detail: "patientId and a code or display are required", written: 0 };
  candidate.assertedBy = resolved.actor.id;

  let current;
  try { current = await svc.get("Condition", candidate.id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  if (current && sameProblem(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", problemId: candidate.id, version: current.version };
  }
  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, problemId: candidate.id, patientId: candidate.patientId,
      code: candidate.code, display: candidate.display, codeSystem: candidate.codeSystem,
      clinicalStatus: candidate.clinicalStatus, verificationStatus: candidate.verificationStatus,
      updated: !!current, version: out.record.version, actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { problemId: candidate.id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The patient's problem list. Active first, then resolved/inactive, because that is the order a
 * clinician reads it in. ctx: { migration, patientId, includeInactive?, actorDeps, recordDeps }
 */
async function listProblems(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", problems: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", problems: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, problems: [] };

  let rows;
  try { rows = await svc.byPatient("Condition", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), problems: [] }; }

  const wanted = (c) => (ctx.includeInactive ? true : c.clinicalStatus === "active");
  const rank = (c) => (c.clinicalStatus === "active" ? 0 : 1);
  const problems = (rows || []).filter((c) => c && wanted(c)).sort((a, b) => rank(a) - rank(b))
    .map((c) => ({
      problemId: c.id, code: c.code, codeSystem: c.codeSystem, display: c.display,
      clinicalStatus: c.clinicalStatus, verificationStatus: c.verificationStatus,
      onsetDate: c.onsetDate || null, note: c.note || null, assertedBy: c.assertedBy || null,
      encounterId: c.encounterId || null, version: c.version,
    }));
  return { ...base, ok: true, patientId, problems };
}

/**
 * PURE. The problem list as the line a discharge summary carries. Kept here, beside the list itself,
 * so the summary and the chart cannot describe the same problems differently.
 */
function problemsForSummary(conditions) {
  const rows = (conditions || []).filter(Boolean);
  if (!rows.length) return null;
  const active = rows.filter((c) => c.clinicalStatus === "active");
  const closed = rows.filter((c) => c.clinicalStatus !== "active");
  const line = (c) => `${c.display}${c.codeSystem && c.codeSystem !== "text" ? ` [${c.code}]` : ""} - ${c.verificationStatus}${c.onsetDate ? `, onset ${c.onsetDate}` : ""}`;
  return [
    active.length ? `Active:\n${active.map(line).join("\n")}` : "Active: none recorded.",
    closed.length ? `Resolved or inactive:\n${closed.map(line).join("\n")}` : null,
  ].filter(Boolean).join("\n");
}

export { VERIFICATION, CLINICAL, problemIdFor, conditionFromRequest, sameProblem, recordProblem, listProblems, problemsForSummary };
