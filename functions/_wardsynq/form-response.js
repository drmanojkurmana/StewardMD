/* functions/_wardsynq/form-response.js — a completed hospital form on the patient's record.
 * The response is checked on the server against the exact published version it names (wardsynq-forms.js):
 * applicability (role, department, in force), required fields, types, ranges, visibility, and calculated
 * fields computed here. An invalid response writes nothing and returns every field error. */
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { evaluateResponse, applicabilityProblem, fieldsOf } from "../../wardsynq/wardsynq-forms.js";

const TYPE = "FormResponse";
const str = (v) => (v == null ? "" : String(v).trim());
const baseOf = (mig) => ({ mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null });

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need, ctx.actorDeps);
    return { svc: new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source }), resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

/** ctx: { migration, definition (the published version), patientId, encounterId, answers, department, actorDeps, recordDeps } */
async function submitFormResponse(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };
  const def = ctx.definition;
  if (!def) return { ...base, ok: false, status: 404, error: "form_not_found", message: "That form version is not published.", written: 0 };
  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };
  const notFor = applicabilityProblem(def, { role: resolved.role, department: str(ctx.department), date: new Date().toISOString().slice(0, 10) });
  if (notFor) return { ...base, ok: false, status: 403, error: "form_not_applicable", message: notFor, written: 0 };
  let evaluated;
  try { evaluated = evaluateResponse(def, ctx.answers); } catch (e) { return { ...base, ok: false, status: 422, error: e.code, message: e.message, problems: e.problems, written: 0 }; }
  if (!evaluated.valid) return { ...base, ok: false, status: 422, error: "invalid_response", errors: evaluated.errors, written: 0 };
  try {
    const patient = await svc.get("Patient", str(ctx.patientId));
    if (!patient) return { ...base, ok: false, status: 404, error: "patient_not_found", written: 0 };
    const at = new Date().toISOString();
    const codes = fieldsOf(def).filter((f) => f.code && f.key in evaluated.answers).map((f) => ({ field: f.key, system: f.code.system, code: f.code.code, value: evaluated.answers[f.key] }));
    const rec = { resourceType: TYPE, id: `wsq-form-${def.key}-${str(ctx.patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
      patientId: patient.id, encounterId: str(ctx.encounterId) || null, formKey: def.key, formVersion: def.version, formTitle: def.title,
      answers: evaluated.answers, codes, completedBy: resolved.actor.id, completedAt: at };
    const out = await svc.put(rec, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, response: { ...rec, version: out.record.version } };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), written: 0 };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", written: 0 };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), written: 0 };
  }
}

async function patientFormResponses(request, env, ctx) {
  const mig = ctx.migration, base = baseOf(mig);
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", responses: [] };
  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };
  try { return { ...base, ok: true, responses: (await svc.byPatient(TYPE, str(ctx.patientId))).sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt))) }; }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed" }; }
}

export { TYPE, submitFormResponse, patientFormResponses };
