/* functions/_wardsynq/consultation.js — one consultation, one call.
 *
 * THE PROBLEM THIS SOLVES. A consultation is one act of care: the doctor takes the vitals, names
 * the problem, prescribes, orders the tests and writes the note, and then leaves the room. Until
 * now the screen expressed that as five independent requests fired off in parallel, and this
 * session's bug hunt kept finding the same consequence: whichever reply landed last overwrote every
 * other one's error message, so a refused prescription could be reported to the doctor as a
 * successful save. Bahmni solved this years ago with BahmniEncounterTransaction - one composite
 * write per consultation, fanned out server-side. This is that idea, built on WardSynQ's own
 * writers.
 *
 * WHAT THIS IS NOT. It is not a new way to write a clinical record, and it holds no authority of its
 * own. Every piece below goes through exactly the same function the individual route has always
 * called, which means the same validation, the same governance check, the same audit entry, and the
 * same safety engine. Delete this file and nothing becomes impossible; the screen just goes back to
 * making five calls and losing four error messages.
 *
 * HALF A CONSULTATION IS THE THING TO FEAR. There is no transaction across records here - the store
 * is append-only, each record is its own write, and Cloudflare gives us nothing to roll back with.
 * Pretending otherwise would be worse than not having it. So the failure that is actually common -
 * "this person is not allowed to write one of these five things" - is caught BEFORE anything is
 * written: the actor is resolved once up front and every requested piece is checked against their
 * write scope, and if any single piece is not allowed the whole consultation is refused and the
 * chart is untouched. A nurse who may record vitals but not prescribe gets told that before her
 * vitals are saved, not after.
 *
 * What can still go wrong mid-way is a write that passes the permission check and then fails on its
 * own merits - a duplicate, a version conflict, the database. That case is REPORTED, never hidden:
 * the reply names every piece, says what happened to each, and says plainly that the consultation
 * was saved in part. A screen that shows that honestly is the point of the whole exercise.
 *
 * ORDER. Problems before orders before the note, because that is the order a chart reads in and the
 * order a later reader expects: a prescription written against a diagnosis that is not yet on the
 * chart reads as an accident. Vitals go first because they are the one piece the widest set of
 * roles may write, so the commonest partial save is the most harmless one.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

/* Each piece of a consultation: what the caller sends, which writer does it, and what resource type
 * the record engine will be asked to write. The type is what the pre-flight check tests against. */
const PIECES = Object.freeze([
  { key: "vitals", type: "Observation", label: "the vitals" },
  { key: "problems", type: "Condition", label: "the problem list" },
  { key: "medications", type: "MedicationOrder", label: "the prescription" },
  { key: "investigations", type: "ServiceRequest", label: "the tests ordered" },
  { key: "note", type: "ClinicalNote", label: "the note" },
]);

const str = (v) => (typeof v === "string" ? v.trim() : "");
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** What the caller actually asked us to write, in chart order, skipping anything absent or empty. */
function requestedPieces(body) {
  return PIECES.filter((p) => {
    const v = body[p.key];
    if (v == null) return false;
    return Array.isArray(v) ? v.length > 0 : true;
  });
}

/** True when this actor's grant covers writing this resource type. null scope means unrestricted. */
function mayWrite(actor, type) {
  const w = actor && actor.scope && actor.scope.write;
  if (w === null || w === undefined) return true;
  return Array.isArray(w) && w.indexOf(type) >= 0;
}

/**
 * Writes a whole consultation in one call.
 *
 * ctx carries the same deps every individual writer already receives, plus:
 *   encounterId  - the encounter every piece is written against.
 *   patientId    - optional; the writers that need it resolve it from the encounter.
 *   writers      - { vitals, problems, medications, investigations, note }, each an async
 *                  (request, env, ctx) matching the existing route handlers. Injected rather than
 *                  imported so this file stays testable and so the router keeps deciding which
 *                  writer, and which extra org config, each piece gets.
 */
async function saveConsultation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const body = ctx.body || {};
  const encounterId = str(ctx.encounterId);
  if (!encounterId) return { ...base, ok: false, status: 422, error: "encounter_required", written: 0 };

  const pieces = requestedPieces(body);
  if (!pieces.length) return { ...base, ok: false, status: 422, error: "nothing_to_save", written: 0 };

  /* PRE-FLIGHT. One actor resolution for the whole consultation, and a scope check on every piece
   * before a single record is written. This is the half-a-consultation guard described above. */
  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: str(e && e.message), written: 0 };
  }

  const refused = pieces.filter((p) => !mayWrite(resolved.actor, p.type));
  if (refused.length) {
    return {
      ...base, ok: false, status: 403, error: "not_allowed_to_write_all_of_this", written: 0,
      /* Named piece by piece, because "permission denied" on a five-part save tells the doctor
       * nothing about which part to drop and retry. */
      refused: refused.map((p) => ({ piece: p.key, resourceType: p.type, detail: "This role may not write " + p.label + "." })),
      allowed: pieces.filter((p) => mayWrite(resolved.actor, p.type)).map((p) => p.key),
      actor: resolved.actor.id,
    };
  }

  /* WRITE. Sequentially, in chart order - not in parallel. Parallel writes against one encounter
   * race each other for the record version and produce exactly the version conflicts this endpoint
   * exists to stop the screen from causing. */
  const results = [];
  let written = 0;
  let stopped = null;

  for (const p of pieces) {
    const writer = ctx.writers && ctx.writers[p.key];
    if (typeof writer !== "function") {
      results.push({ piece: p.key, ok: false, error: "no_writer_configured" });
      stopped = p.key;
      break;
    }
    const items = p.key === "note" ? [body.note] : arr(body[p.key]);
    let failedHere = false;
    for (let i = 0; i < items.length; i++) {
      let r;
      try {
        r = await writer(request, env, { ...ctx, encounterId, item: items[i], index: i });
      } catch (e) {
        r = { ok: false, status: 502, error: "write_threw", detail: str(e && e.message) };
      }
      const entry = { piece: p.key, index: i, ok: !!(r && r.ok) };
      if (r && r.ok) { written += (typeof r.written === "number" ? r.written : 1); Object.assign(entry, pick(r)); }
      else { Object.assign(entry, { error: (r && r.error) || "failed", status: (r && r.status) || 502, ...(r && r.detail ? { detail: r.detail } : {}), ...(r && r.reasons ? { reasons: r.reasons } : {}) }); failedHere = true; }
      results.push(entry);
      if (failedHere) break;
    }
    if (failedHere) { stopped = p.key; break; }
  }

  const allOk = !stopped;
  return {
    ...base,
    ok: allOk,
    ...(allOk ? {} : { status: 207, error: "saved_in_part" }),
    written,
    encounterId,
    results,
    /* The honest sentence the screen should show when it goes wrong. Everything before the failure
     * IS on the chart and must not be retried blindly; everything after it was never attempted. */
    ...(allOk ? {} : {
      partial: true,
      savedPieces: [...new Set(results.filter((r) => r.ok).map((r) => r.piece))],
      failedAt: stopped,
      notAttempted: pieces.slice(pieces.findIndex((p) => p.key === stopped) + 1).map((p) => p.key),
      detail: "Part of this consultation was saved. Check what is on the chart before trying again.",
    }),
    actor: resolved.actor.id,
  };
}

/* The identifiers a screen needs back to render what was just saved, without echoing whole records. */
function pick(r) {
  const out = {};
  for (const k of ["noteId", "problemId", "conditionId", "orderId", "medicationOrderId", "serviceRequestId", "observationIds", "version", "patientId"]) {
    if (r[k] !== undefined) out[k] = r[k];
  }
  return out;
}

export { saveConsultation, PIECES, requestedPieces, mayWrite };
