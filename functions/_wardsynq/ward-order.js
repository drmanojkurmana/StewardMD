/* functions/_wardsynq/ward-order.js — ordering an investigation from the ward.
 *
 * The OPD could order an investigation (migrate-inv-order.js, keyed to a queue TICKET) and an order
 * set could apply one. A WARD could not: there is no ticket on a ward round, and the only way a
 * ServiceRequest reached an inpatient's chart was through a set somebody had pre-written. So the
 * specimen worklist, the pending-results list and the ORU door all existed for orders the ward had no
 * way to place.
 *
 * PRIORITY IS A REQUEST, NOT A GUARANTEE. `stat` does not make a laboratory faster, and nothing here
 * pretends it does. What it does is reach the person who has to go and take the blood: the collection
 * worklist sorts by it, so an urgent order is at the top of the list of somebody who can act on it. A
 * priority that changes nothing downstream is decoration, and prescribers stop setting it honestly
 * within a week.
 *
 * THE PRIORITY VOCABULARY IS THE MODEL'S, and an unknown word becomes `routine` rather than being
 * refused or being trusted: refusing would stop an order over a typo, and trusting would let
 * "URGENT!!" sort as something the system does not understand. It is normalised, and the response
 * says what it was recorded as.
 *
 * ONE ORDER PER (ENCOUNTER, TEST). Ordering the same test twice on one admission is almost always a
 * duplicate request - a ward round and a post-take round both asking for U&Es - and two requests
 * produce two specimens, two bottles and two bills. Asking again is idempotent; genuinely wanting a
 * repeat means a new encounter or a new day, which the id reflects.
 */

import { ServiceRequest } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** The model's own vocabulary. Ordered worst-first: it is what the collection worklist sorts by. */
const PRIORITIES = Object.freeze(["stat", "urgent", "routine"]);
const CATEGORIES = Object.freeze(["laboratory", "imaging", "procedure", "referral", "other"]);

/** PURE. An unknown priority becomes routine - never refused, never trusted as it stands. */
function normalisePriority(value) {
  const p = str(value).toLowerCase();
  return PRIORITIES.includes(p) ? p : "routine";
}
/** PURE. Sort key. An unknown value sorts LAST, so nothing can jump the queue by being unrecognised. */
function priorityRank(value) {
  const i = PRIORITIES.indexOf(str(value).toLowerCase());
  return i < 0 ? PRIORITIES.length : i;
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** PURE. One order per (encounter, test). Asking again is the same order, not a second specimen. */
function wardOrderIdFor(encounterId, code) {
  const e = slug(encounterId), c = slug(code);
  return e && c ? `wsq-sr-${e}-${c}` : null;
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

/** ctx: { migration, encounterId, code, display?, category?, priority?, reason?, ... } */
async function orderInvestigation(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const encounterId = str(ctx.encounterId), code = str(ctx.code);
  if (!encounterId || !code) return { ...base, ok: false, status: 422, error: "encounter_and_code_required", detail: "an investigation order names the stay it belongs to and what is being asked for", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let encounter;
  try { encounter = await svc.get("Encounter", encounterId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  // An order against a stay that does not exist is a specimen nobody can match to a patient.
  if (!encounter) return { ...base, ok: false, status: 404, error: "encounter_not_found", encounterId, written: 0 };
  if (encounter.status === "finished") {
    return { ...base, ok: false, status: 409, error: "encounter_closed", detail: "this stay has ended; order it against the current one", encounterId, written: 0 };
  }

  const id = wardOrderIdFor(encounterId, code);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  const askedPriority = str(ctx.priority);
  const priority = normalisePriority(askedPriority);
  const category = CATEGORIES.includes(str(ctx.category)) ? str(ctx.category) : "laboratory";

  const sr = ServiceRequest({
    id, patientId: encounter.patientId, encounterId,
    code, category, priority, requesterId: resolved.actor.id, status: "active",
    source: { system: "wardsynq-native", sourceId: `ward-inv-order:${id}` },
  });
  /* NO CODE SYSTEM IS INVENTED. The ward types a test name; a code it did not give is not guessed at,
   * exactly as lab-result.js refuses to guess a LOINC. */
  sr.codeSystem = str(ctx.codeSystem) || "wardsynq-order-local";
  const display = str(ctx.display) || code;
  if (display) sr.display = display;
  const reason = str(ctx.reason);
  if (reason) sr.reason = reason;

  let current;
  try { current = await svc.get("ServiceRequest", id); }
  catch { current = null; }
  if (current && current.status === "active" && current.priority === priority && str(current.reason) === reason) {
    return { ...base, ok: true, written: 0, skipped: "already_ordered", orderId: id, priority, version: current.version };
  }

  try {
    const out = await svc.put(sr, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, orderId: id, patientId: sr.patientId, encounterId,
      code, display, category, priority, version: out.record.version,
      ...(askedPriority && priority !== askedPriority.toLowerCase()
        ? { priorityNotUnderstood: askedPriority, note: `"${askedPriority}" is not a priority this system knows, so it is recorded as routine. Set stat or urgent if it is one.` }
        : {}),
      /* Said on every response. `stat` reaches the person who has to take the blood; it does not
       * reach the analyser, and a system implying otherwise gets trusted for something it cannot do. */
      priorityNote: "Priority orders the collection worklist. It does not make the laboratory faster.",
      actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { orderId: id, written: 0, actor: resolved.actor.id }) };
  }
}

export { PRIORITIES, CATEGORIES, normalisePriority, priorityRank, wardOrderIdFor, orderInvestigation };
