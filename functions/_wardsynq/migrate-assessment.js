/* functions/_wardsynq/migrate-assessment.js — the doctor's clinical assessment write, migrated.
 *
 * WHERE THIS COMES FROM. `opd-emr.js`'s "Assessment" tab is a GHIS Initial Assessment form (~14
 * sections, ~90 fields, captured verbatim from a live GHIS form on 2026-08-07 — see `ASSESS_SCHEMA`
 * there). `submitAssessment()` posts the full structured payload to `/assessment-save` (GHIS; a
 * different backend file, `functions/api/ghis/[[path]].js`, untouched by this migration and never
 * will be by it) and, ONLY on success, separately calls `addToTimeline("assessment", summary)`,
 * which is the SAME `POST /api/queue/timeline` endpoint the nurse's vitals migration already hooks.
 * That is the seam this file uses — the same one, not a new one.
 *
 * WHAT IS RECORDED, AND WHY IT IS NOT ALL 90 FIELDS. Reproducing GHIS's own bespoke intake-form
 * schema field-for-field inside WardSynQ would BE the second model the task forbids: those field
 * names belong to GHIS's form, not to a clinical concept WardSynQ's canonical `ClinicalNote` should
 * absorb wholesale. The model already has an extension point for exactly this
 * (`wardsynq-model.js ClinicalNote.sections`, documented there as "e.g. {subjective, objective,
 * assessment, plan}" — an open shape, not an enforced one), so this file groups the assessment into
 * that SOAP structure rather than inventing a new one:
 *
 *   subjective   chief complaints, present history, past history
 *   objective    the assessment's own vitals + systemic examination findings
 *   assessment   provisional diagnosis
 *   plan         management plan, referral
 *   raw          the ENTIRE submitted payload, verbatim — nothing is lost to the grouping above
 *
 * `raw` is the honesty valve: the four SOAP keys are structure for the fields that are universally
 * meaningful across any clinical form, and `raw` is what stops the grouping from quietly discarding
 * the other ~80 GHIS-specific fields nobody has decided a canonical shape for yet.
 *
 * ONE NOTE PER ENCOUNTER, VERSIONED. Every save of the same visit's assessment is a new VERSION of
 * the ONE ClinicalNote at `noteIdForTicket(ticket, "assessment")` (opd-identity.js) — never a new
 * entity. This is what makes a repeat save idempotent (unchanged content: nothing written) and what
 * stops two concurrent saves from silently clobbering each other: `expectedVersion` is checked
 * exactly as it is for registration, and a stale write is refused with a conflict, never absorbed
 * silently into the wrong version. The append-only store keeps every prior version regardless.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not touch the "Authorise" (sign-off/lock) action in
 * GHIS, which is a separate workflow step this migration does not model — a note here is never
 * marked `signedBy`. It does not migrate `submitInvOrder` or `submitPrescribe`, which use the SAME
 * `addToTimeline` mechanism with kinds "note" and "medication" — this file only recognises
 * `kind === "assessment"`, on purpose, so those are entirely untouched. Same three modes as vitals
 * and registration; `authoritative` carries the SAME honest limitation registration's does: the
 * GHIS save already happened, via a wholly separate HTTP request, by the time this endpoint is even
 * reached, so "authoritative" means a WardSynQ refusal is reported rather than swallowed — it does
 * not, and cannot, undo or block the GHIS write that already landed.
 */

import { ClinicalNote } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForTicket, encounterIdForTicket, noteIdForTicket } from "./opd-identity.js";

/** PURE. The tenant's mode for the assessment migration. Unknown or absent is "off". Same shape
 * as vitalsMigration(env, session, deps): session carries orgId or hospitalId. */
async function assessmentMigration(env, session, deps) {
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "assessment", deps);
}

function line(label, value) {
  const v = value == null ? "" : String(value).trim();
  return v ? `${label}: ${v}` : "";
}
function block(...lines) {
  return lines.filter(Boolean).join("\n");
}

/**
 * PURE. The GHIS Initial Assessment payload (`st.assessVals`) to SOAP sections. Field names are
 * GHIS's own (`ASSESS_SCHEMA` in opd-emr.js); reading them here does not duplicate that schema —
 * it names the small subset that is universally meaningful, and keeps the rest verbatim in `raw`.
 */
function sectionsFromAssessment(vals) {
  const v = vals || {};
  return {
    subjective: block(
      line("Chief complaints", v.Chief_complaints_duration),
      line("Present history", v.History_present_illness),
      line("Past history", v.History_past_illness),
    ),
    objective: block(
      line("Temperature (F)", v.Temp), line("BP", (v.BP_SYS || v.BP_dia) ? `${v.BP_SYS || "?"}/${v.BP_dia || "?"}` : ""),
      line("Pulse (/min)", v.Pulse), line("Respiratory rate (/min)", v.respiratory),
      line("Systemic examination", v.sys_examination),
    ),
    assessment: block(line("Provisional diagnosis", v.provisional_diagnosis)),
    plan: block(line("Management plan", v.management_plan), line("Referred management plan", v.refered_management_plan)),
    raw: v,
  };
}

/**
 * PURE. Builds the canonical note, or null when the ticket cannot name a patient or an encounter.
 * @param {{ticket: object, vals: object, authorId: string}} input
 */
function noteFromAssessment(input) {
  const patientId = patientIdForTicket(input.ticket);
  const noteId = noteIdForTicket(input.ticket, "assessment");
  if (!patientId || !noteId) return null;
  const note = ClinicalNote({
    id: noteId,
    patientId,
    encounterId: encounterIdForTicket(input.ticket),
    noteType: "soap",
    sections: sectionsFromAssessment(input.vals),
    authorId: input.authorId || null,
    source: { system: "wardsynq-native", sourceId: `opd-assessment:${noteId}` },
  });
  return note;
}

/** PURE. Same encounter, same content: nothing new to say, so nothing is written. */
function sameNoteContent(a, b) {
  if (!a || !b) return false;
  return JSON.stringify(a.sections) === JSON.stringify(b.sections)
    && a.patientId === b.patientId && a.encounterId === b.encounterId && a.authorId === b.authorId;
}

/**
 * Writes the assessment to the record as the request's own governed actor. Never throws.
 * ctx: { migration, ticket, vals, actorDeps, recordDeps }
 */
async function recordAssessment(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  const candidate = noteFromAssessment({ ticket: ctx.ticket, vals: ctx.vals, authorId: resolved.actor.id });
  if (!candidate) return { ...base, ok: false, status: 422, error: "no_encounter", written: 0, actor: resolved.actor.id };
  const noteId = candidate.id;

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("ClinicalNote", noteId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), noteId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, noteId };
  }
  if (current && sameNoteContent(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", noteId, version: current.version, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, updated: !!current, noteId, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), noteId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", noteId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, noteId, actor: resolved.actor.id };
  }
}

export { assessmentMigration, sectionsFromAssessment, noteFromAssessment, sameNoteContent, recordAssessment };
