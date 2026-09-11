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
 * SIGN-OFF (added the same day, the fifth migration). GHIS's "Authorise" is real: `opd-emr.js
 * authoriseConsult()` posts `/assessment-authorize` (functions/api/ghis, `authorizeAssessment`), GHIS
 * locks the form and stamps "Authorized on <date> by <Dr name>", which `loadAssessment()` reads back
 * as `authorized: {on, by}`. On success the client calls the SAME `addToTimeline("assessment", ...)`,
 * now with `signOff: true`, and the route dispatches to `recordAssessmentSignOff` instead of the
 * content save. What it writes is a NEW VERSION of the same note with the content copied VERBATIM
 * from the current version and `signedBy` set to the AUTHENTICATED DOCTOR'S OWN ID — never GHIS's
 * display-name string, never anyone else's id. That is the actor model's own rule ("a signature is an
 * act, not a string", wardsynq-actors.js) applied unchanged: `authoriseWrite` refuses a signature
 * from a non-human, from anyone but the signer, and from a signer with no credential. A doctor on a
 * staff PIN session has no registration number and therefore cannot sign here, and the record says so.
 * Once signed, the note is CLOSED to further content saves (`note_signed`), which is exactly what GHIS
 * does to its own form; a second authorise is a no-op (`already_signed`), not a second version.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not migrate `submitInvOrder` or `submitPrescribe`,
 * which use the SAME `addToTimeline` mechanism with kinds "note" and "medication" — this file only
 * recognises `kind === "assessment"`, on purpose, so those are entirely untouched. Same three modes
 * as vitals and registration; `authoritative` carries the SAME honest limitation registration's
 * does: the GHIS save (or GHIS's lock) already happened, via a wholly separate HTTP request, by the
 * time this endpoint is even reached, so "authoritative" means a WardSynQ refusal is reported rather
 * than swallowed — it does not, and cannot, undo or block the GHIS write that already landed.
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

/**
 * PURE. The signed version of an existing note: identical content, `signedBy` set. Built through the
 * factory so this version gets its own `meta.recordedAt` (the moment of signing is a new fact), the
 * same way a registration correction does. `signedBy` is the caller's responsibility to make the
 * actor's own id; the store refuses anything else.
 */
function signedNoteFrom(current, signedBy) {
  if (!current || !signedBy) return null;
  return ClinicalNote({
    id: current.id, patientId: current.patientId, encounterId: current.encounterId,
    noteType: current.noteType, sections: current.sections, authorId: current.authorId,
    aiDrafted: !!current.aiDrafted,
    signedBy,
    source: { system: "wardsynq-native", sourceId: `opd-assessment:${current.id}` },
  });
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

  // A content save with no content is not a save. This is what an Authorise used to look like
  // before it carried its own flag, and it must never wipe a note's sections with an empty version.
  if (!ctx.vals || typeof ctx.vals !== "object") return { ...base, ok: true, skipped: "no_content", written: 0, actor: resolved.actor.id };

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
  // A signed note is closed. GHIS locks its form on authorise; the record refuses the edit rather
  // than letting "signed" mean "signed until somebody saves again". A correction after sign-off is
  // an addendum on a new note, which nothing here models yet — stated, not hidden.
  if (current && current.signedBy) {
    return { ...base, ok: false, status: 409, error: "note_signed", noteId, version: current.version, signedBy: current.signedBy, actor: resolved.actor.id };
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

/**
 * The sign-off. Never throws. ctx: { migration, ticket, actorDeps, recordDeps } (vals ignored).
 * The signature is `resolved.actor.id` and nothing else; a session that cannot sign is refused by
 * the store's own NO_CREDENTIAL, and the caller sees that reason.
 */
async function recordAssessmentSignOff(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null, signOff: true };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  const noteId = noteIdForTicket(ctx.ticket, "assessment");
  if (!noteId) return { ...base, ok: false, status: 422, error: "no_encounter", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0, noteId };
  }
  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("ClinicalNote", noteId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), noteId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, noteId };
  }
  // Nothing to sign: the note was never written here (the tenant turned this on after the save, or
  // the save was refused). Say so; do not mint an empty signed note.
  if (!current) return { ...base, ok: false, status: 422, error: "no_note_to_sign", noteId, actor: resolved.actor.id };
  if (current.signedBy) {
    return { ...base, ok: true, written: 0, skipped: "already_signed", noteId, version: current.version, signedBy: current.signedBy, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }

  const signed = signedNoteFrom(current, resolved.actor.id);
  try {
    const out = await svc.put(signed, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, noteId, version: out.record.version, signedBy: out.record.signedBy, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), noteId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", noteId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, noteId, actor: resolved.actor.id };
  }
}

export { assessmentMigration, sectionsFromAssessment, noteFromAssessment, signedNoteFrom, sameNoteContent, recordAssessment, recordAssessmentSignOff };
