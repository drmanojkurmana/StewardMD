/* functions/_wardsynq/handover.js — the shift handover, as a closed loop.
 *
 * Handover failure is one of the best-documented causes of harm in hospitals: the information exists,
 * somebody knew it, and it did not survive the change of shift. WardSynQ had signed clinical notes
 * and no notion of one clinician handing a patient to another.
 *
 * A HANDOVER IS NOT A NOTE. A note is written and sits there. A handover is only complete when
 * SOMEBODY ELSE HAS TAKEN IT, and that is the single property this file exists to enforce:
 *
 *   1. THE RECEIVER CANNOT BE THE AUTHOR. A handover you hand to yourself is not a handover, and
 *      allowing it would let the loop be closed by the person leaving - which is precisely the
 *      moment the information is lost. Refused by name, not by a generic permission error.
 *   2. AN UNRECEIVED HANDOVER STAYS VISIBLE. The incoming shift's list is what is waiting for them.
 *      Nothing expires it, nothing auto-receives it, and time passing never closes it.
 *   3. RECEIVING IS A NEW VERSION, NOT AN EDIT. Who wrote it and who took it are both on the record
 *      permanently, which is the whole point when somebody asks later what was handed over.
 *   4. A CORRECTION IS A NEW HANDOVER. A received handover is not rewritten - the receiving nurse
 *      acted on what it said, and changing it afterwards would make the record disagree with the
 *      care that was given.
 *
 * SBAR, because that is what wards already use, and the sections are recorded exactly as written.
 * An empty section says it is empty rather than being filled in from somewhere else: a handover that
 * silently assembles its own "background" from the chart is a handover nobody actually gave.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/* Its OWN type, not a ClinicalNote. Two reasons, both found by the tests rather than guessed:
 *
 *  - A ClinicalNote is a clinical DOCUMENT, and a nurse's write scope rightly does not include one.
 *    Widening that scope so a handover could be written would also have let a nurse author a
 *    discharge summary or an assessment, which is a far larger change than a handover needs.
 *  - Writing one meant setting `signedBy`, which the store requires a prescriber CREDENTIAL for. A
 *    shift handover is not a countersigned clinical document and should never have borrowed that
 *    concept; `givenBy` and `receivedBy` say exactly what happened without overloading a signature.
 *
 * It also means a handover can never be mistaken for the medical assessment of the admission when
 * the discharge summary goes looking for clinician notes. */
const TYPE = "ShiftHandover";

/** A shift handover. Versioned and append-only like every other record. */
function ShiftHandover(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    sections: i.sections || {},
    givenBy: i.givenBy || null,
    givenAt: i.givenAt || null,
    receivedBy: i.receivedBy || null,
    receivedAt: i.receivedAt || null,
    source: { system: "wardsynq-native", sourceId: `handover:${i.id}` },
  };
}

/** Situation, Background, Assessment, Recommendation. The ward's own words in each. */
const SBAR = Object.freeze(["situation", "background", "assessment", "recommendation"]);
const NOT_STATED = "Not stated.";

/** PURE. One handover per (encounter, shift instant). A retried submit is the same handover. */
function handoverIdFor(encounterId, at) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const e = slug(encounterId), t = slug(at);
  return e && t ? `wsq-hand-${e}-${t}` : null;
}

/**
 * PURE. The SBAR sections, with nothing invented.
 *
 * A section the outgoing nurse left blank is recorded as "Not stated." rather than being filled from
 * the chart. A handover that quietly assembles its own background is one nobody actually gave, and
 * the receiving nurse would have no way to tell the difference.
 */
function sbarFrom(input) {
  const out = {};
  let said = 0;
  for (const k of SBAR) {
    const v = str(input && input[k]);
    out[k] = v || NOT_STATED;
    if (v) said += 1;
  }
  return { sections: out, stated: said };
}

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

function summary(n) {
  return {
    handoverId: n.id, patientId: n.patientId, encounterId: n.encounterId || null,
    sections: n.sections || {}, sbarStated: n.sbarStated == null ? null : n.sbarStated,
    givenBy: n.givenBy || null, givenAt: n.givenAt || null,
    receivedBy: n.receivedBy || null, receivedAt: n.receivedAt || null,
    state: n.receivedBy ? "received" : "waiting",
    version: n.version,
  };
}

/**
 * The outgoing clinician hands the patient over. Signed as their own account of the shift.
 * ctx: { migration, encounterId, patientId, sbar, givenAt?, actorDeps, recordDeps }
 */
async function giveHandover(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const { sections, stated } = sbarFrom(ctx.sbar);
  // A handover with nothing in it is not a handover. Writing one would put an empty record where the
  // incoming shift expects an account, which reads as "nothing to say" rather than "nobody wrote it".
  if (!stated) return { ...base, ok: false, status: 422, error: "nothing_handed_over", detail: "say at least one of situation, background, assessment or recommendation", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };

  const givenAt = str(ctx.givenAt) || new Date().toISOString();
  const id = handoverIdFor(encounterId, givenAt);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  /* A RECEIVED HANDOVER IS NOT REWRITTEN. The receiving nurse acted on what it said; changing it
   * afterwards would make the record disagree with the care that was given. A correction is a new
   * handover, at a new time, which is also how a real ward corrects one. */
  if (current && current.receivedBy) {
    return { ...base, ok: false, status: 409, error: "already_received", detail: "this handover has been taken; a correction is a new handover", handoverId: id, receivedBy: current.receivedBy, version: current.version, written: 0 };
  }

  const note = ShiftHandover({
    id, patientId: encounter.patientId, encounterId, sections,
    givenBy: resolved.actor.id, givenAt,
  });
  note.sbarStated = stated;
  note.receivedBy = null;
  note.receivedAt = null;

  try {
    const out = await svc.put(note, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...note, version: out.record.version }), actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { handoverId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The incoming clinician takes the handover. This is what closes the loop.
 * ctx: { migration, handoverId, note?, actorDeps, recordDeps }
 */
async function receiveHandover(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const handoverId = str(ctx.handoverId);
  if (!handoverId) return { ...base, ok: false, status: 422, error: "handover_required", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, handoverId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current || current.resourceType !== TYPE) return { ...base, ok: false, status: 404, error: "handover_not_found", handoverId, written: 0 };

  /* THE RECEIVER CANNOT BE THE AUTHOR. A handover you hand to yourself is not a handover, and
   * allowing it would let the loop be closed by the person leaving - which is exactly the moment the
   * information is lost. Refused by name so the ward sees why, rather than as a permission error. */
  const author = current.givenBy;
  if (author && author === resolved.actor.id) {
    return { ...base, ok: false, status: 409, error: "same_clinician", detail: "a handover is taken by the clinician coming on, not by the one who gave it", handoverId, written: 0 };
  }
  if (current.receivedBy) {
    return { ...base, ok: true, written: 0, skipped: "already_received", ...summary(current) };
  }

  const next = ShiftHandover({
    id: current.id, patientId: current.patientId, encounterId: current.encounterId,
    sections: current.sections, givenBy: current.givenBy, givenAt: current.givenAt,
  });
  next.sbarStated = current.sbarStated == null ? null : current.sbarStated;
  next.receivedBy = resolved.actor.id;
  next.receivedAt = new Date().toISOString();
  // What the incoming clinician said back, when they said anything. A read-back is the strongest
  // form of this loop and is kept verbatim; it is not required, because requiring it would push
  // wards into typing "ok" to clear a list.
  const back = str(ctx.note);
  if (back) next.readBack = back;

  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), readBack: next.readBack || null, actor: resolved.actor.id, role: resolved.role };
  } catch (e) {
    return { ...base, ...writeFailure(e, { handoverId, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * What is waiting to be taken. ctx: { migration, patientId?, state?, actorDeps, recordDeps }
 * Default is WAITING only: a list that showed taken handovers by default would bury the ones that
 * still need somebody, which is the failure this list exists to prevent.
 */
async function listHandovers(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", handovers: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, handovers: [] };

  let rows;
  try {
    rows = str(ctx.patientId)
      ? await svc.byPatient(TYPE, str(ctx.patientId))
      : await svc.list(TYPE, 200);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), handovers: [] }; }

  const want = str(ctx.state) || "waiting";
  const handovers = (rows || []).filter((n) => n && n.resourceType === TYPE)
    .map(summary)
    .filter((h) => (want === "all" ? true : h.state === want))
    // Oldest first: the one that has been waiting longest is the one most likely to be lost.
    .sort((a, b) => String(a.givenAt || "").localeCompare(String(b.givenAt || "")));
  return { ...base, ok: true, handovers, waiting: handovers.filter((h) => h.state === "waiting").length };
}

export { SBAR, NOT_STATED, TYPE, ShiftHandover, handoverIdFor, sbarFrom, giveHandover, receiveHandover, listHandovers };
