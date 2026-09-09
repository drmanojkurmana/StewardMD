/* functions/_wardsynq/maik-interaction.js — TASK 8: every MaiK action, written down as a clinical fact.
 *
 * THE GAP THIS CLOSES. MaiK meters tokens, caps spend, trips circuit breakers and
 * caches answers - and no file in it stores what a model was asked, what it saw, what it said, or
 * what a clinician then did about it. The one persistent write on the whole AI path is a routing
 * cache. So an answer that changed a decision at 03:00 leaves the same trace as one nobody read:
 * none. That is the fact this file changes.
 *
 * A MAIK INTERACTION IS A GOVERNED RECORD, not a log line. It goes through RecordService like
 * everything else, which is what gives it tenant isolation by construction, an append-only history,
 * an audit row on every change, and the patient compartment - an AI interaction about a patient is
 * readable by exactly the people who may read that patient. A log would have needed all four
 * inventing again, differently.
 *
 * WHAT EVERY INTERACTION CARRIES, and why each one is load-bearing:
 *   WHO ASKED and WHICH ACTOR would write - the human is never the author of what a model wrote.
 *   MODEL, PROVIDER AND VERSION as reported by the thing that actually answered, plus whether text
 *     was GENERATED at all or merely assembled from the record.
 *   CONTEXT PROVENANCE - every {resourceType, id, version} the model was shown. Months later, after
 *     every one of those rows has changed, this still answers "what was it looking at".
 *   THE SECURITY VERDICT - which documents were refused entry, which tripped an injection signal,
 *     and whether the output was withheld. A near-miss is only visible if it is kept.
 *   UNCERTAINTY, only when the model supplied one. Never invented, never defaulted to a number that
 *     would read as confidence.
 *   THE REVIEW - pending, accepted, edited or rejected, by whom and when. An interaction nobody has
 *     looked at says so.
 *   RESULTING CHANGES - the records that exist because of this, by version.
 *
 * ACCEPTING IS NOT SIGNING, AND THIS IS THE WHOLE CLINICAL SAFETY PROPERTY. Accepting a drafted note
 * writes a ClinicalNote that is aiDrafted (stamped by the store, not claimed by the caller), UNSIGNED
 * and authored by an `ai:` actor capped at DRAFT. It appears on the chart as what it is: something a
 * model wrote and a clinician agreed with. Making it the clinician's own words requires them to sign
 * it, through the same note-signing path every other note uses. AI-generated content never becomes
 * clinician-authored content by anybody's convenience.
 *
 * WHAT MAIK STILL CANNOT DO, unchanged and enforced elsewhere: sign a note, prescribe, administer,
 * merge patients, resolve an identity conflict, override a safety verdict, or commit anything at all.
 * wardsynq-actors.js caps KIND.AI at DRAFT inside can() itself, so an actor object that never passed
 * through the factory still cannot commit. This file relies on that ceiling; it does not re-implement
 * it, and it cannot raise it.
 *
 * STATUS: IMPLEMENTED and TESTED through the real routes against deterministic providers. NOT
 * clinically validated. No live model provider has been connected to the WardSynQ record.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, NATIVE_SYSTEM } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { screenOutput } from "../../wardsynq/wardsynq-secops.js";
import { makeActor, KIND, TIER } from "../../wardsynq/wardsynq-actors.js";
import { TASK, invoke, maikConfig } from "./maik-gateway.js";
import { buildPatientContext, promptFor, SECTION } from "./maik-chart-context.js";
import { ClinicalNote } from "../../wardsynq/wardsynq-model.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "MaiKInteraction";

/** Where a review can be. `pending` is a real state: it means nobody has looked yet. */
const REVIEW = Object.freeze({ PENDING: "pending", ACCEPTED: "accepted", EDITED: "edited", REJECTED: "rejected" });

/** The instruction each task sends. Fixed here, never supplied by a caller: an instruction a caller
 *  can write is an instruction an attacker can write, and the model's job is set by this server. */
const INSTRUCTIONS = Object.freeze({
  [TASK.SUMMARISE]: "You are summarising a patient record for a clinician who is about to see the patient. Use ONLY the record below. State what is not recorded as not recorded; never infer, never reassure, and never add a diagnosis, a dose or a plan that is not already written down. Be brief and factual.",
  [TASK.DRAFT_NOTE]: "You are drafting a clinical note for a clinician to review, edit or reject. Use ONLY the record below. Write what the record supports and nothing else. Leave a heading empty rather than filling it with a plausible normal. You are not the author and this note will not be signed by you.",
  [TASK.EXPLAIN]: "You are explaining, in plain language, something this system has ALREADY computed. Do not re-decide it, do not disagree with it, and do not add a recommendation of your own.",
  [TASK.EXTRACT]: "Extract the requested structured fields from the record below. Return only fields the record actually contains; omit anything absent rather than guessing.",
});

function MaiKInteraction(input) {
  const i = input || {};
  return {
    resourceType: TYPE, id: i.id,
    patientId: i.patientId, encounterId: i.encounterId || null,
    task: i.task,
    /* Who asked, and which AI actor would write anything that comes of it. Two different identities
     * on purpose: the clinician is responsible for asking, the AI is the author of the answer. */
    requestedBy: i.requestedBy, requestedAt: i.requestedAt,
    /* The SESSION the request came from, not just the person. Two answers a clinician got in one
     * sitting are correlatable without the audit row ever holding a bearer token - sessionRef is
     * already a short hash of one, produced by actor.js for exactly this purpose. */
    sessionRef: i.sessionRef || null,
    /* ONE ID THAT SPANS THE WHOLE INTERACTION, including anything written because of it. It is the
     * idempotency key too: asking the same question twice under one correlation id is one action,
     * not two, which is what stops a retried request producing a second answer a clinician then has
     * to reconcile with the first. */
    correlationId: i.correlationId || null,
    aiActor: i.aiActor || null,
    model: i.model || null,
    generated: i.generated === true,
    latencyMs: Number.isFinite(Number(i.latencyMs)) ? Number(i.latencyMs) : null,
    usage: i.usage || null,
    instruction: i.instruction || null,
    question: i.question || null,
    contextProvenance: Array.isArray(i.contextProvenance) ? i.contextProvenance : [],
    contextDocuments: Array.isArray(i.contextDocuments) ? i.contextDocuments : [],
    contextUnreadable: Array.isArray(i.contextUnreadable) ? i.contextUnreadable : [],
    security: i.security || null,
    output: i.output == null ? null : String(i.output),
    withheld: i.withheld || null,
    // Only when the model supplied one. `null` means it said nothing about its own confidence.
    uncertainty: i.uncertainty == null ? null : i.uncertainty,
    toolCalls: Array.isArray(i.toolCalls) ? i.toolCalls : [],
    review: i.review || { state: REVIEW.PENDING, by: null, at: null, reason: null, editedOutput: null },
    /* WHAT WOULD BE WRITTEN IF THIS WERE ACCEPTED, computed before anybody accepts anything. A
     * clinician approving a clinical change has to be able to see the change, not a paragraph that
     * will become one - "preview the resulting clinical change" is the difference between reviewing
     * an answer and reviewing a WRITE. Null when accepting this task writes nothing at all. */
    preview: i.preview || null,
    resultingChanges: Array.isArray(i.resultingChanges) ? i.resultingChanges : [],
    source: { system: NATIVE_SYSTEM, sourceId: `maik-interaction:${i.id}` },
  };
}

const idFor = (patientId, at, nonce) =>
  `wsq-ai-${String(patientId).toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${String(at).replace(/[^0-9]/g, "").slice(0, 14)}-${String(nonce || "").slice(0, 8)}`;

/**
 * The actor that writes the BOOKKEEPING row, and nothing else.
 *
 * Recording that MaiK was asked something is a fact about the system, not a clinical write by the
 * clinician who asked - and it must not require them to hold a write scope they do not have. A nurse
 * may ask the AI to summarise a patient she is looking after; she may not write to a chart, and
 * being able to ask must never quietly hand her a way to. So the interaction row is written by a
 * SERVICE actor scoped to exactly one type, capped at DRAFT like every non-human, while the patient
 * data itself is still read through the CLINICIAN'S OWN session. This actor can reach no clinical
 * record at all: its read and write scope is the one bookkeeping type.
 */
function maikRecordActor() {
  return makeActor({ id: "service:maik-record", kind: KIND.SERVICE, tier: TIER.DRAFT,
    display: "AI interaction record", scope: { read: [TYPE], write: [TYPE] } });
}

async function open(request, env, ctx, need) {
  try {
    const resolved = await resolveClinicalActor(request, env, ctx.migration.tenantId, need || "record:read", ctx.actorDeps);
    const svc = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source,
    });
    /* Two services on purpose: `svc` is the CLINICIAN - every chart read happens as them - and
     * `recorder` writes only the interaction row. Neither can do the other's job. */
    const recorder = new RecordService({
      repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym,
      tenant: resolved.tenant, actor: maikRecordActor(), role: "maik-record", roleSource: "wardsynq-maik",
    });
    return { svc, recorder, resolved };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { error: { ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message) } };
  }
}

function writeFailure(e, extra) {
  if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), ...extra };
  if (e instanceof VersionConflictError) return { ok: false, status: 409, error: "version_conflict", ...extra };
  return { ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), ...extra };
}

/**
 * Asks MaiK about one patient, and writes down what happened.
 * ctx: { migration, config (wardsynq.ai), patientId, task, question, sections?, actorDeps, recordDeps, providers?, signingKey? }
 *
 * Every exit from this function writes an interaction EXCEPT the ones where nothing was asked: a
 * refusal to route (no approved model, AI disabled) is returned to the caller without a record,
 * because there was no AI action to record. A model that answered and had its answer WITHHELD is
 * recorded, because that is an AI action and the near-miss is the point.
 */
async function askAboutPatient(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const task = str(ctx.task) || TASK.SUMMARISE;
  if (!INSTRUCTIONS[task]) return { ...base, ok: false, status: 422, error: "unknown_task", detail: `"${task}" is not a MaiK task this ward performs` };
  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", detail: "a MaiK request is always about one identified patient" };

  const { svc, recorder, resolved, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error };

  /* WRONG ENCOUNTER IS BLOCKED, not merely unused. An encounter that belongs to somebody else is the
   * quiet version of the wrong-patient error: the summary would be about the right person and filed
   * against another person's admission, and every downstream reader inherits it. Checked before any
   * model is called. */
  const encounterId = str(ctx.encounterId);
  if (encounterId) {
    let enc = null;
    try { enc = await svc.get("Encounter", encounterId); } catch { enc = null; }
    if (!enc) return { ...base, ok: false, status: 404, error: "encounter_unreadable", detail: "that admission is not readable by this actor" };
    if (str(enc.patientId) !== str(ctx.patientId)) {
      return { ...base, ok: false, status: 409, error: "encounter_mismatch",
        detail: `that admission belongs to another patient; the right person on the wrong visit is still the wrong chart` };
    }
  }

  /* THE CONTEXT IS READ AS THIS CLINICIAN. A patient they may not see produces a refusal here, and
   * no model is called - so the AI cannot be used to learn what the chart would not show. */
  const context = await buildPatientContext(svc, patientId, {
    sections: Array.isArray(ctx.sections) && ctx.sections.length ? ctx.sections : undefined,
    signingKey: str(ctx.signingKey) || str(env && env.WSQ_MAIK_CONTEXT_KEY) || "wardsynq-maik-chart-context",
  });
  if (!context.ok) return { ...base, ok: false, status: context.error === "patient_unreadable" ? 403 : 422, error: context.error, detail: context.detail };

  const built = promptFor(context, `${INSTRUCTIONS[task]}${str(ctx.question) ? `\n\nThe clinician asks: ${str(ctx.question)}` : ""}`);

  const answer = await invoke({
    task, phi: true, context: { ...context, content: built.prompt },
    system: null, prompt: built.prompt,
    config: ctx.config, env, providers: ctx.providers, fetchImpl: ctx.fetchImpl,
  });
  /* A REFUSAL TO ROUTE IS NOT A MAIK ACTION. No model was asked, nothing was sent, and there is
   * nothing to record - the caller is told plainly why, which is the only useful thing here. */
  if (!answer.ok) return { ...base, ok: false, status: answer.code === "no_phi_approved_model" || answer.code === "maik_disabled" ? 409 : 502, error: answer.code, detail: answer.detail };

  /* OUTPUT IS SCREENED BEFORE ANYBODY SEES IT, and withheld WHOLE if it fails. */
  const screen = screenOutput(answer.text, { patientId, nonce: built.nonce });
  const at = new Date().toISOString();
  const id = idFor(patientId, at, built.nonce);

  const record = MaiKInteraction({
    id, patientId, encounterId: encounterId || null, task,
    requestedBy: resolved.actor.id, requestedAt: at,
    sessionRef: (resolved.identity && resolved.identity.sessionRef) || null,
    correlationId: str(ctx.correlationId) || id,
    /* The actor that would author anything written from this answer. Named now, before any draft
     * exists, so the record says who the author WOULD be rather than discovering it later.
     *
     * THE AUTHOR IS MAIK, NOT THE MODEL. `ai:maik` is stable whichever model answered - the model,
     * provider and version live in `model` beside it, because those change under the same author.
     * A chart that attributed one note to `ai:local-openai` and the next to `ai:some-other-provider`
     * would look like two different authors when it is one assistant on two days. */
    aiActor: "ai:maik",
    model: answer.model, generated: answer.generated, latencyMs: answer.latencyMs, usage: answer.usage,
    instruction: INSTRUCTIONS[task], question: str(ctx.question) || null,
    contextProvenance: context.provenance,
    // The documents that entered the context, WITHOUT their content and without the signing key: the
    // content is already on the chart, and copying it here would duplicate the note into a second row.
    contextDocuments: (context.documents || []).map((d) => ({ id: d.id, origin: d.origin, trust: d.trust, aiDrafted: !!d.aiDrafted, macAlgorithm: d.macAlgorithm || null })),
    contextUnreadable: context.unreadable,
    security: {
      documentsIncluded: built.documentsIncluded, rejected: built.rejected || [],
      injectionFindings: built.injectionFindings || [],
      outputViolations: screen.violations || [], released: screen.released !== false,
    },
    output: screen.released ? answer.text : null,
    withheld: screen.released ? null : { reason: "the answer was withheld whole by output screening", violations: (screen.violations || []).map((v) => v.id) },
    uncertainty: answer.uncertainty == null ? null : answer.uncertainty,
    review: { state: REVIEW.PENDING, by: null, at: null, reason: null, editedOutput: null },
    preview: screen.released && task === TASK.DRAFT_NOTE
      ? { resourceType: "ClinicalNote", id: `${id}-note`, noteType: "progress", signedBy: null, aiDrafted: true,
          authorId: "ai:maik", willBeSigned: false,
          note: "Accepting writes this note UNSIGNED and authored by MaiK. It becomes your own words only when you sign it, through the ordinary note path." }
      : null,
  });

  try {
    const out = await recorder.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, interaction: { ...record, version: out.record.version }, released: screen.released !== false };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/**
 * A clinician decides what a MaiK answer was worth. ctx: { migration, interactionId, decision, editedOutput?, reason? }
 *
 * ACCEPTING A DRAFTED NOTE WRITES ONE - as an AI-authored, UNSIGNED note. That is the only clinical
 * write this file performs, it is capped at DRAFT by the actor model, and it leaves the note
 * requiring the clinician's own signature through the ordinary note path. A rejection writes nothing
 * and keeps the reason: a model that is regularly rejected for one kind of task is a fact somebody
 * should be able to see.
 */
async function reviewInteraction(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off" };

  const id = str(ctx.interactionId);
  const decision = str(ctx.decision);
  if (!id) return { ...base, ok: false, status: 422, error: "interaction_required" };
  if (![REVIEW.ACCEPTED, REVIEW.EDITED, REVIEW.REJECTED].includes(decision)) {
    return { ...base, ok: false, status: 422, error: "bad_decision", detail: `decide one of: ${REVIEW.ACCEPTED}, ${REVIEW.EDITED}, ${REVIEW.REJECTED}` };
  }
  const edited = str(ctx.editedOutput);
  if (decision === REVIEW.EDITED && !edited) return { ...base, ok: false, status: 422, error: "edit_required", detail: "an edit is the text you are keeping; it cannot be empty" };
  const reason = str(ctx.reason);
  if (decision === REVIEW.REJECTED && reason.length < 5) {
    return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why this was rejected; a model that is regularly wrong about something is only visible if the reasons are kept" };
  }

  const { svc, recorder, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error };

  let current = null;
  try { current = await recorder.get(TYPE, id); } catch { current = null; }
  if (!current) return { ...base, ok: false, status: 404, error: "interaction_not_found" };
  if (current.review && current.review.state !== REVIEW.PENDING) {
    return { ...base, ok: false, status: 409, error: "already_reviewed", detail: `this was already ${current.review.state} by ${current.review.by}`, interaction: current };
  }
  if (!current.output) return { ...base, ok: false, status: 409, error: "nothing_to_review", detail: "this answer was withheld and there is nothing to accept" };

  const at = new Date().toISOString();
  const resulting = [...(current.resultingChanges || [])];

  /* THE ONE CLINICAL WRITE, and only for a drafted note that was accepted or edited. */
  if (current.task === TASK.DRAFT_NOTE && decision !== REVIEW.REJECTED) {
    const text = decision === REVIEW.EDITED ? edited : str(current.output);
    const note = ClinicalNote({
      id: `${current.id}-note`, patientId: current.patientId, encounterId: current.encounterId || null,
      noteType: "progress", sections: { text },
      /* The AI is the author. `aiDrafted` is set by the STORE for an AI actor, not by this claim -
       * it is here so the intent is legible, and it cannot be evaded by omitting it. */
      authorId: "ai:maik",
      aiDrafted: true, signedBy: null,
    });
    try {
      /* origin:{kind:"ai"} makes the writer an AI actor delegated by THIS clinician - capped at
       * DRAFT, scoped no wider than they are, and stamped as AI provenance by the store. An edited
       * note is still an AI-authored note: a clinician's edits do not make them its author, and
       * signing is what does. */
      const out = await svc.put(note, { origin: { kind: "ai", id: "maik" }, activePatientId: current.patientId });
      resulting.push({ resourceType: "ClinicalNote", id: note.id, version: out.record.version, unsigned: true });
    } catch (e) { return { ...base, ...writeFailure(e, { detail: "the note could not be written; the review was not recorded either" }) }; }
  }

  const next = {
    ...current,
    review: { state: decision, by: resolved.actor.id, at, reason: reason || null, editedOutput: decision === REVIEW.EDITED ? edited : null },
    resultingChanges: resulting,
  };
  try {
    const { meta, version, writtenBy, ...rest } = next;
    const out = await recorder.put(rest, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, interaction: { ...rest, version: out.record.version } };
  } catch (e) { return { ...base, ...writeFailure(e) }; }
}

/** What MaiK has been asked about this patient, and what became of each answer. */
async function listInteractions(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", interactions: [] };
  const { recorder, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, interactions: [] };
  const patientId = str(ctx.patientId);
  let rows;
  try { rows = patientId ? await recorder.byPatient(TYPE, patientId) : await recorder.list(TYPE, 200); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), interactions: [] }; }
  const interactions = (rows || []).filter(Boolean)
    .sort((a, b) => str(b.requestedAt).localeCompare(str(a.requestedAt)));
  const counts = { pending: 0, accepted: 0, edited: 0, rejected: 0 };
  for (const r of interactions) { const s = (r.review && r.review.state) || REVIEW.PENDING; if (counts[s] != null) counts[s] += 1; }
  return { ...base, ok: true, interactions, counts };
}

export { TYPE, REVIEW, INSTRUCTIONS, MaiKInteraction, idFor, askAboutPatient, reviewInteraction, listInteractions };
