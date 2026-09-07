/* functions/_wardsynq/note-templates.js — the shape of a note, without the words.
 *
 * Documentation templates are how a hospital gets a ward round note that actually contains the
 * things a ward round note should contain, instead of four words and a blood pressure. They are also
 * the single most reliable way to fill a chart with text nobody wrote and nobody read, so the whole
 * design here is about which of those two it is.
 *
 * A TEMPLATE PROVIDES HEADINGS, NEVER CONTENT. There is no default text, no pre-ticked normal, no
 * "system examination unremarkable" waiting to be left alone. That is the entire distinction between
 * a template and auto-documentation: a heading asks a question, and default text answers it on the
 * clinician's behalf. A chart full of pre-filled normals is how "chest clear" ends up in the notes
 * of a patient nobody listened to, and it is indistinguishable afterwards from a real examination.
 *
 * AN UNFILLED SECTION IS VISIBLY UNFILLED. It renders as "Not recorded." exactly as the discharge
 * summary's do, rather than disappearing - so a reader can tell "nobody wrote this" from "there was
 * nothing to say", and a template cannot make a thin note look complete by hiding its own gaps.
 *
 * REQUIRED MEANS THE NOTE IS INCOMPLETE WITHOUT IT, NOT THAT IT IS REFUSED. A clinician interrupted
 * mid-note by an arrest must be able to save what they have. So a missing required section makes the
 * note INCOMPLETE and says which - loudly, on every read - rather than throwing the work away. A
 * system that refuses to save is a system people stop using for the notes that matter most.
 *
 * NOTHING IS COPIED FORWARD. Not the previous note, not yesterday's examination, not the last set of
 * observations. Copy-forward is the most documented way to propagate a stale finding through a whole
 * admission, and a template is exactly where it would be introduced.
 */

import { ClinicalNote } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const NOT_RECORDED = "Not recorded.";

/**
 * PURE. Validates a template definition. A template is ORG content: a hospital's own ward round
 * note, its own operation note. Nothing here ships a clinical template of its own, because the
 * headings a hospital wants are a clinical decision and inventing them would be making it.
 */
function resolveTemplate(def) {
  const d = def || {};
  const id = str(d.id), name = str(d.name);
  if (!id || !name) return { ok: false, error: "template_incomplete", detail: "a template needs an id and a name", sections: [] };

  const sections = [], problems = [];
  const seen = new Set();
  for (let i = 0; i < (Array.isArray(d.sections) ? d.sections : []).length; i++) {
    const s = d.sections[i] || {};
    const key = str(s.key) || str(s.title);
    const title = str(s.title) || key;
    if (!key) { problems.push({ index: i, reason: "no_key" }); continue; }
    const k = key.toLowerCase();
    if (seen.has(k)) { problems.push({ index: i, reason: "duplicate", key }); continue; }
    seen.add(k);
    /* A section carrying DEFAULT TEXT is refused outright, not stripped and accepted. Stripping it
     * would let a hospital keep shipping a template that quietly stopped doing what its author
     * intended; refusing says so while somebody can still fix it. */
    if (str(s.default) || str(s.defaultText) || str(s.text)) {
      problems.push({ index: i, reason: "default_text_not_allowed", key });
      continue;
    }
    sections.push({
      key: k, title,
      /* A prompt is a QUESTION, not an answer. "What did you find on auscultation?" is a prompt;
       * "Chest clear" is content, and content belongs to the clinician. */
      prompt: str(s.prompt) || null,
      required: s.required === true,
    });
  }
  if (!sections.length) return { ok: false, error: "template_empty", detail: "no usable sections", sections: [], problems };
  return { ok: true, id, name, version: str(d.version) || "0", noteType: str(d.noteType) || "progress", sections, problems };
}

/**
 * PURE. A template plus what a clinician actually wrote.
 *
 * Every section appears. An unfilled one says so rather than disappearing, and a required one that
 * is unfilled makes the note incomplete and is NAMED.
 */
function composeNote(template, written) {
  const w = written && typeof written === "object" ? written : {};
  const sections = {}, missing = [], unknown = [];
  for (const s of template.sections) {
    const v = str(w[s.key]);
    // Visibly unfilled, exactly as the discharge summary does it, so a template cannot make a thin
    // note look complete by hiding its own gaps.
    sections[s.key] = v || NOT_RECORDED;
    if (!v && s.required) missing.push({ key: s.key, title: s.title });
  }
  // Text sent for a section the template does not have is REPORTED, not silently dropped and not
  // silently added: it is the case where the template changed under the clinician mid-note.
  for (const k of Object.keys(w)) if (!template.sections.some((s) => s.key === str(k).toLowerCase())) unknown.push(str(k));
  return {
    sections, missing, unknown,
    /* COMPLETE is derived from the sections, never a flag somebody sets. A stored one would let a
     * note be declared finished with required sections empty. */
    complete: missing.length === 0,
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One note per (encounter, template, moment). Two ward rounds a day are two notes. */
function noteIdFor(encounterId, templateId, at) {
  const e = slug(encounterId), t = slug(templateId), m = slug(at);
  return e && t && m ? `wsq-tnote-${e}-${t}-${m}` : null;
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

/** The hospital's templates, resolved so a caller sees exactly the headings each provides. */
async function listTemplates(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", templates: [] };

  const defs = Array.isArray(ctx.templates) ? ctx.templates : [];
  const all = defs.map(resolveTemplate);
  return {
    ...base, ok: true,
    templates: all.filter((t) => t.ok).map((t) => ({ id: t.id, name: t.name, version: t.version, noteType: t.noteType, sections: t.sections, ...(t.problems && t.problems.length ? { problems: t.problems } : {}) })),
    // A template a hospital configured badly is REPORTED, not silently absent: a missing template
    // looks like one nobody wrote, and somebody will write a second one.
    ...(all.some((t) => !t.ok) ? { unusable: all.filter((t) => !t.ok).map((t, i) => ({ index: i, error: t.error, detail: t.detail, problems: t.problems || [] })) } : {}),
  };
}

/**
 * Writes a note from a template. UNSIGNED - signing is the existing separate act.
 * ctx: { migration, templates, templateId, encounterId, patientId?, sections, at?, ... }
 */
async function writeTemplatedNote(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const templateId = str(ctx.templateId), encounterId = str(ctx.encounterId);
  if (!templateId || !encounterId) return { ...base, ok: false, status: 422, error: "template_and_encounter_required", written: 0 };

  const def = (Array.isArray(ctx.templates) ? ctx.templates : []).find((d) => d && str(d.id) === templateId);
  if (!def) return { ...base, ok: false, status: 404, error: "template_not_found", templateId, written: 0 };
  const tpl = resolveTemplate(def);
  if (!tpl.ok) return { ...base, ok: false, status: 422, error: tpl.error, detail: tpl.detail, problems: tpl.problems, written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };

  const at = str(ctx.at) || new Date().toISOString();
  const id = noteIdFor(encounterId, templateId, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const composed = composeNote(tpl, ctx.sections);
  let current;
  try { current = await svc.get("ClinicalNote", id); }
  catch { current = null; }
  // A signed note is not rewritten, exactly as the discharge summary is not.
  if (current && current.signedBy) {
    return { ...base, ok: false, status: 409, error: "already_signed", detail: "this note is signed; a correction is a new note", noteId: id, written: 0 };
  }

  const note = ClinicalNote({
    id, patientId: encounter.patientId, encounterId,
    noteType: tpl.noteType, sections: composed.sections,
    authorId: resolved.actor.id, aiDrafted: false, signedBy: null,
    source: { system: "wardsynq-native", sourceId: `templated-note:${id}` },
  });
  // Which template and version produced these headings. When a template turns out to ask the wrong
  // question, this is how the notes written from it are found.
  note.templateId = tpl.id;
  note.templateVersion = tpl.version;
  note.incompleteSections = composed.missing.map((m) => m.key);

  try {
    const out = await svc.put(note, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, noteId: id, patientId: note.patientId, encounterId,
      templateId: tpl.id, templateVersion: tpl.version, noteType: tpl.noteType,
      sections: composed.sections, complete: composed.complete,
      /* REQUIRED MEANS INCOMPLETE, NOT REFUSED. A clinician interrupted mid-note by an arrest must
       * be able to save what they have; a system that refuses is one people stop using for the
       * notes that matter most. The gap is named on every response instead. */
      ...(composed.missing.length ? { incomplete: true, missing: composed.missing } : {}),
      ...(composed.unknown.length ? { unknownSections: composed.unknown } : {}),
      signed: false, version: out.record.version, actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { noteId: id, written: 0, actor: resolved.actor.id }) };
  }
}

export { NOT_RECORDED, resolveTemplate, composeNote, noteIdFor, listTemplates, writeTemplatedNote };
