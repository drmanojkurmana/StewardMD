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
 *
 * ONE BUILT-IN, ADDED 2026-09-12, AND WHY IT DOES NOT BREAK THE RULE ABOVE. This file used to ship
 * no template at all, on the stated grounds that the headings a hospital wants are a clinical
 * decision and inventing them would be making it. That reasoning still holds and is untouched for
 * every structured template. What it did NOT account for is that a hospital with no templates
 * configured could not write a clinical note of any kind: /ward/note answered template_not_found
 * for whatever it was given, and the demonstration hospital had exactly that problem. BUILT_IN_
 * TEMPLATES is therefore a single free-text progress note with one section, "Clinical course". It
 * invents no clinical structure, asserts nothing about what an examination should contain, and
 * carries no default text; it is the blank sheet a ward round already writes on. An org template of
 * the same id replaces it outright, so this is a floor and never a ceiling.
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

/* THE BUILT-IN PROGRESS NOTE. Every note had to come from a template in org config, and a hospital
 * that had configured none - which is every hospital on the day it opens, including the
 * demonstration one - could not write a clinical note at all: /ward/note answered
 * template_not_found for whatever it was given, and the chart's own compose box had nothing to
 * offer. A ward round produces a narrative note; needing a configuration step before a doctor can
 * write "admitted with community-acquired pneumonia, started on co-amoxiclav, improving" is the
 * wrong default.
 *
 * One free-text section, because that is what a progress note IS. A hospital that wants structure
 * still defines its own templates and they appear alongside this one; defining one with this id
 * overrides it entirely, so this is a floor and never a ceiling.
 *
 * It carries no default text, which resolveTemplate refuses outright and is right to: pre-filled
 * clinical prose is text nobody wrote being attributed to whoever signs it. */
const BUILT_IN_TEMPLATES = Object.freeze([Object.freeze({
  id: "progress",
  name: "Progress note",
  sections: Object.freeze([Object.freeze({
    key: "narrative",
    title: "Clinical course",
    // `prompt`, not `hint` - resolveTemplate reads prompt and would drop anything else in silence.
    // A question, never an answer, which is the rule the rest of this file is built on.
    prompt: "What has happened, what was found, what was done, and what happens next?",
  })]),
})]);

/** Org templates plus the built-ins, with an org definition of the same id winning outright. */
function withBuiltIns(templates) {
  const org = Array.isArray(templates) ? templates.filter(Boolean) : [];
  const taken = new Set(org.map((d) => str(d && d.id)));
  return org.concat(BUILT_IN_TEMPLATES.filter((d) => !taken.has(d.id)));
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
    /* THE HOSPITAL'S NOTE-WRITER EXCEPTION, APPLIED HERE AND ONLY HERE.
     *
     * The router (functions/api/queue/[[path]].js) already checked, before this function was ever
     * called, that this role is a real member holding emr.view AND is named in the hospital's own
     * noteWriterRoles config - ctx.noteWriterOverride carries that decision, this function does not
     * remake it. What the router's check cannot reach is the record engine's own authority: every
     * write, including this one, is independently checked against the ACTOR'S grant
     * (wardsynq-actors.js's GovernedStore), and a role admitted here purely by noteWriterRoles (a
     * nurse, most often) has a grant built solely from its own capability - emr.vitals for a nurse -
     * which has never included ClinicalNote. Passing the route and then being refused by the engine
     * (SCOPE_DENIED) made the whole admin setting a silent no-op: ticking the box changed nothing a
     * nurse could actually do.
     *
     * Widened to ClinicalNote and NOTHING else, and only when the existing scope is a restricted
     * array (never when it is already unrestricted, i.e. already emr.treat) - so this can only ever
     * add the one type the config exists to authorise, never anything wider, and never for a role
     * this exception was not built for. */
    let actor = resolved.actor;
    if (ctx.noteWriterOverride && Array.isArray(actor.scope.write) && actor.scope.write.indexOf("ClinicalNote") < 0) {
      actor = { ...actor, scope: { ...actor.scope, write: [...actor.scope.write, "ClinicalNote"] } };
    }
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor, role: resolved.role, roleSource: resolved.source,
    });
    return { svc, resolved: { ...resolved, actor } };
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

  const defs = withBuiltIns(ctx.templates);
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

  const def = withBuiltIns(ctx.templates).find((d) => d && str(d.id) === templateId);
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

export { NOT_RECORDED, BUILT_IN_TEMPLATES, withBuiltIns, resolveTemplate, composeNote, noteIdFor, listTemplates, writeTemplatedNote };
