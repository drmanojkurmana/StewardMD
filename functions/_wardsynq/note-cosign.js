/* functions/_wardsynq/note-cosign.js — the note that needs a second name on it.
 *
 * WardSynQ could already write a clinical note and could already refuse to let an uncredentialed
 * actor sign one. What it could not do was anything about the note that resulted. A note written by
 * a clinician the system cannot verify is not a failure state to be swept up; it is the ordinary case
 * on a ward round, and it needs a route to somebody who can put their name to it. Without one the
 * note simply sat there unsigned, indistinguishable from one nobody had finished.
 *
 * THE CO-SIGNATURE IS THE SIGNATURE. There is no separate `coSignedBy` field, and that is deliberate.
 * `actor.credential` - the medical registration number - is the only thing that makes a signature a
 * signature (see actor.js), and the governed store already refuses `signedBy` from an actor without
 * one. So a note signed by somebody other than its author IS a countersigned note: `authorId` names
 * who wrote it and `signedBy` names who stands behind it. Inventing a second field would have created
 * a second, weaker kind of signature that the store does not police.
 *
 * THE AUTHOR IS NEVER OVERWRITTEN. A supervisor signing a junior's note does not become its author.
 * Both names stay on the record, because "who wrote this" and "who is accountable for it" are
 * different questions and a ward asks both.
 *
 * SUBMITTING IS NOT SIGNING. The author says the note is finished; that is a claim about their own
 * work and needs no credential. Nobody may sign somebody else's note that was never submitted: that
 * would be a supervisor putting their name to work the author has not finished, which is how a
 * co-signature becomes a rubber stamp.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "ClinicalNote";

/**
 * PURE. Where this note is in the signing loop, computed rather than stored - a stored status is one
 * more thing that can disagree with the record it describes.
 *
 *   draft     nobody has said it is finished
 *   awaiting  submitted, unsigned: this is the co-sign worklist
 *   signed    signed by its own author
 *   cosigned  signed by somebody other than its author
 */
function signingState(note) {
  if (!note) return "draft";
  if (note.signedBy) return note.authorId && note.signedBy !== note.authorId ? "cosigned" : "signed";
  return note.submittedAt ? "awaiting" : "draft";
}

/** PURE. How long this note has been waiting on a signature, in whole minutes. Null if it is not. */
function waitingMinutes(note, nowMs) {
  if (signingState(note) !== "awaiting") return null;
  const t = Date.parse(str(note.submittedAt));
  if (!Number.isFinite(t)) return null;
  const ms = (Number.isFinite(nowMs) ? nowMs : Date.now()) - t;
  return ms > 0 ? Math.floor(ms / 60000) : 0;
}

/**
 * PURE. May this actor sign this note, and if not, why not. The reasons are the point: each one is a
 * different thing to tell a clinician, and collapsing them into "cannot sign" tells them nothing.
 */
function maySign(note, actor) {
  if (!note) return { ok: false, error: "note_not_found" };
  if (note.signedBy) return { ok: false, error: "already_signed", detail: `this note was signed by ${note.signedBy}; a correction is a new note` };
  if (!actor || !actor.id) return { ok: false, error: "no_actor" };
  /* The store would refuse this anyway, and that refusal is the real control. Naming it here means a
   * clinician is told they hold no verified registration rather than being handed a governance code
   * for a state the system already knew about before they clicked. */
  if (!actor.credential) {
    return { ok: false, error: "no_credential", detail: "signing a clinical note needs a verified medical registration. This note can be submitted for a colleague to sign." };
  }
  const own = note.authorId && note.authorId === actor.id;
  if (!own && !note.submittedAt) {
    return { ok: false, error: "not_submitted", detail: "this note has not been submitted for signature by its author" };
  }
  return { ok: true, coSign: !own };
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

function summary(n, nowMs) {
  return {
    noteId: n.id, patientId: n.patientId, encounterId: n.encounterId || null,
    noteType: n.noteType || null, templateId: n.templateId || null,
    authorId: n.authorId || null, submittedBy: n.submittedBy || null, submittedAt: n.submittedAt || null,
    signedBy: n.signedBy || null, signedAt: n.signedAt || null,
    state: signingState(n), waitingMinutes: waitingMinutes(n, nowMs),
    // Named, because a note signed with sections still empty is a real thing and the signature does
    // not fill them in.
    incompleteSections: Array.isArray(n.incompleteSections) ? n.incompleteSections : [],
    version: n.version,
  };
}

/** The author says the note is finished. ctx: { migration, noteId, ... } */
async function submitNote(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const noteId = str(ctx.noteId);
  if (!noteId) return { ...base, ok: false, status: 422, error: "note_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let note;
  try { note = await svc.get(TYPE, noteId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!note) return { ...base, ok: false, status: 404, error: "note_not_found", noteId, written: 0 };
  if (note.signedBy) return { ...base, ok: false, status: 409, error: "already_signed", noteId, written: 0 };
  /* Only the author submits their own work. Somebody else declaring a colleague's note finished is
   * the same act as signing it without reading it, one step earlier. */
  if (note.authorId && note.authorId !== resolved.actor.id) {
    return { ...base, ok: false, status: 403, error: "not_the_author", detail: "only the clinician who wrote a note may submit it for signature", noteId, written: 0 };
  }
  if (note.submittedAt) return { ...base, ok: true, written: 0, skipped: "already_submitted", ...summary(note) };

  const next = { ...note, submittedBy: resolved.actor.id, submittedAt: new Date().toISOString() };
  try {
    const out = await svc.put(next, { expectedVersion: note.version, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }),
      note: "Submitted. This note is unsigned until a clinician with a verified registration signs it.",
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId, written: 0, actor: resolved.actor.id }) };
  }
}

/** Signs, or co-signs. ctx: { migration, noteId, ... } */
async function signNote(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const noteId = str(ctx.noteId);
  if (!noteId) return { ...base, ok: false, status: 422, error: "note_required", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let note;
  try { note = await svc.get(TYPE, noteId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const may = maySign(note, resolved.actor);
  if (!may.ok) {
    const status = may.error === "note_not_found" ? 404 : may.error === "already_signed" ? 409 : 403;
    return { ...base, ok: false, status, error: may.error, detail: may.detail || null, noteId, written: 0, ...(note ? summary(note) : {}) };
  }

  /* authorId is NOT touched. A supervisor signing a junior's note does not become its author, and a
   * record that said otherwise would lose the one fact a later review most needs. */
  const next = { ...note, signedBy: resolved.actor.id, signedAt: new Date().toISOString() };
  try {
    const out = await svc.put(next, { expectedVersion: note.version, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }),
      coSigned: !!may.coSign,
      ...(may.coSign ? { note: `Co-signed. ${note.authorId} remains the author of this note.` } : {}),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The co-sign worklist: notes their authors have finished and nobody has signed. Oldest first,
 * because the one that has been waiting longest is the one most likely to be forgotten.
 * ctx: { migration, patientId?, ... }
 */
async function listAwaitingCoSign(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", notes: [] };

  const { svc, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, notes: [] };

  let rows;
  try {
    rows = str(ctx.patientId) ? await svc.byPatient(TYPE, str(ctx.patientId)) : await svc.list(TYPE, 300);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), notes: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), notes: [] };
  }

  const nowMs = Date.parse(str(ctx.now)) || Date.now();
  const all = (rows || []).filter(Boolean);
  const notes = all.filter((n) => signingState(n) === "awaiting")
    .map((n) => summary(n, nowMs))
    .sort((a, b) => String(a.submittedAt || "").localeCompare(String(b.submittedAt || "")));
  /* The caller's OWN unfinished notes, returned alongside. Both halves of the loop are one question -
   * "what is between me and a signed record" - and a clinician's own draft is the commonest answer.
   * Splitting it into a second endpoint would have meant a screen that could route a note onward but
   * not start it moving. */
  const me = (resolved.actor && resolved.actor.id) || null;
  const mine = me
    ? all.filter((n) => n.authorId === me && signingState(n) === "draft")
        .map((n) => summary(n, nowMs))
        .sort((a, b) => String(a.noteId).localeCompare(String(b.noteId)))
    : [];
  return {
    ...base, ok: true, notes, waiting: notes.length, mine, unsubmitted: mine.length,
    /* Whether the reader can actually clear this list. A worklist that shows work to somebody who
     * cannot do it, without saying so, is how a queue grows while everybody assumes it is handled. */
    canSign: !!(resolved.actor && resolved.actor.credential),
  };
}

export { TYPE, signingState, waitingMinutes, maySign, submitNote, signNote, listAwaitingCoSign };
