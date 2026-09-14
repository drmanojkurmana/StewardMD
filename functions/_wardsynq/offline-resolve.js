/* functions/_wardsynq/offline-resolve.js - G2: what a clinician decided about a bedside write that came back
 * from the server as a conflict or a refusal after it had waited on the device (ward-offline.js).
 *
 * THE DECISION IS AUDITED HERE, BEFORE THE DEVICE ACTS ON IT. Resend and edit go on to send the write
 * again through its own route, where the record service audits it with X-Offline-Conflict-Reason; discard
 * sends nothing, so without this row a dropped entry would leave no trace anywhere. The device removes or
 * re-queues the entry only once this answers ok, so an entry is never dropped on a decision the server did
 * not record.
 *
 * WHO: the router checks the capability the write itself needs (vitals, a task, a note, a dose), so only
 * somebody who could have made that write can record a decision about it. Nothing here reads or changes a
 * record: the row names the kind, the request key, the refusal, the versions and the reason.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const KINDS = Object.freeze(["vitals", "nursing-task-done", "note", "mar", "icu", "fluid"]);
const CHOICES = Object.freeze(["resend", "edit", "discard"]);
const intOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isInteger(Number(v)) ? null : Number(v));

/** ctx: { migration, actorDeps, recordDeps, kind, choice, idempotencyKey, patientId?, error?, expectedVersion?, currentVersion?, reason?, createdAt? } */
async function recordOfflineChoice(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, error: "not_a_wardsynq_hospital" };
  const kind = str(ctx.kind), choice = str(ctx.choice), key = str(ctx.idempotencyKey), reason = str(ctx.reason).slice(0, 200);
  if (!KINDS.includes(kind)) return { ok: false, status: 422, error: "unknown_kind" };
  if (!CHOICES.includes(choice)) return { ok: false, status: 422, error: "unknown_choice", detail: "resend, edit or discard" };
  if (!/^[A-Za-z0-9_:.-]{8,120}$/.test(key)) return { ok: false, status: 422, error: "idempotency_key_required" };
  // Putting your own entry over a record that changed is a decision with a reason; so is changing it.
  if (choice !== "discard" && reason.length < 5) return { ok: false, status: 422, error: "reason_required", detail: "say why your entry should stand" };
  let actorId;
  try { actorId = (await resolveClinicalActor(request, env, mig.tenantId, "record:read", ctx.actorDeps)).actor.id; }
  catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error" };
  }
  const created = Date.parse(str(ctx.createdAt));
  const event = { ts: new Date().toISOString(), actor: actorId, connectorId: "wardsynq-offline", action: `offline.${choice}`, outcome: "ok",
    // Pseudonymised like every record audit row (service.js _audit): the audit store holds no patient id.
    patientRefHash: str(ctx.patientId) && ctx.recordDeps.pseudonym ? await ctx.recordDeps.pseudonym(str(ctx.patientId)) : null,
    scope: { kind, idempotencyKey: key, refusal: str(ctx.error).slice(0, 60) || null, expectedVersion: intOrNull(ctx.expectedVersion), currentVersion: intOrNull(ctx.currentVersion),
      reason: reason || null, offline: { createdAt: Number.isFinite(created) ? new Date(created).toISOString() : "unreadable", clientClock: true } } };
  try { await ctx.recordDeps.repository.auditOnly(mig.tenantId, event); }
  catch { return { ok: false, status: 502, error: "audit_failed", message: "The decision could not be recorded, so nothing was changed on this device." }; }
  return { ok: true, choice, kind, recorded: true };
}

export { KINDS as OFFLINE_KINDS, CHOICES as OFFLINE_CHOICES, recordOfflineChoice };
