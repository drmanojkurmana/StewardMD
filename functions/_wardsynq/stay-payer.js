/* functions/_wardsynq/stay-payer.js - who settles an inpatient stay's bill (gst-parties, 2026-09-17).
 *
 * A `StayPayer` record, one per stay, versioned: the payer contract that settles the stay (its reference in the payer
 * registry, payer-connectors.js) or self-pay, with the policy number. billing.charge writes it, billing.view reads it,
 * like a Claim. Changing it needs a reason. It names only the payer: the patient, insurer, TPA and GST recipient are
 * resolved from that payer's contract (payer-contracts.js), so a TPA is never mistaken for the insurer and the payer is
 * never mistaken for the GST recipient. A bill raised for the stay copies the parties as they were then (invoice.js);
 * changing the stay's payer afterwards does not change a bill already raised.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService, isExternalRecord } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { ADMISSION_CLASSES } from "./migrate-inpatient.js";
import { resolveParties, partiesRecord } from "./payer-contracts.js";

const str = (v) => (v == null ? "" : String(v).trim());
const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const STAY_PAYER_TYPE = "StayPayer";
const stayPayerIdFor = (encounterId) => `wsq-staypayer-${slug(encounterId)}`;
const refuse = (error, message, status) => ({ ok: false, status: status || 422, error, message, written: 0 });

/**
 * Set who settles a stay. ctx: { migration, patientId, encounterId, payerRef ("" = self-pay), policyNumber?, reason?,
 * expectedVersion?, payers (the registry, already read), gst }.
 */
async function setStayPayer(request, env, ctx) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { ok: false, status: 404, error: "not_a_wardsynq_hospital", written: 0 };
  const patientId = str(ctx.patientId), encounterId = str(ctx.encounterId);
  if (!patientId || !encounterId) return refuse("stay_required", "Choose the patient's stay.");
  let svc, actorId;
  try {
    const r = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
    svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: r.tenant, actor: r.actor, role: r.role, roleSource: r.source });
    actorId = r.actor.id;
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ok: false, status, error: status === 401 ? "auth" : status === 403 ? "permission" : "error", written: 0 };
  }
  const id = stayPayerIdFor(encounterId);
  let enc, cur;
  try { [enc, cur] = await Promise.all([svc.get("Encounter", encounterId), svc.get(STAY_PAYER_TYPE, id)]); }
  catch (e) {
    return e instanceof GovernanceError ? { ok: false, status: 403, error: "permission", written: 0 }
      : { ok: false, status: 502, error: "record_read_failed", message: "The stay could not be read, so nothing was changed.", written: 0 };
  }
  if (!enc || str(enc.patientId) !== patientId || isExternalRecord(enc) || !ADMISSION_CLASSES.includes(enc.class)) return refuse("encounter_not_this_patient", "That is not an inpatient stay of this patient.");
  if (cur && Number(ctx.expectedVersion) !== cur.version) return refuse("version_conflict", "The payer on this stay changed since it was opened. Reload and try again; nothing was saved.", 409);
  const payerRef = str(ctx.payerRef).slice(0, 60) || null;
  if (payerRef && !(ctx.payers || []).some((p) => p && str(p.id) === payerRef)) return refuse("payer_not_found", "That payer is not in this hospital's payer list (Admin, Integrations, Payers).");
  const policyNumber = str(ctx.policyNumber).slice(0, 60) || null;
  const reason = str(ctx.reason).slice(0, 500) || null;
  if (cur && cur.payerRef === payerRef && (cur.policyNumber || null) === policyNumber) return { ok: true, unchanged: true, written: 0, stayPayer: withParties(cur, ctx) };
  if (cur && !reason) return refuse("reason_required", "Say why the payer on this stay is changing.");
  const at = new Date().toISOString();
  const next = { resourceType: STAY_PAYER_TYPE, id, patientId, encounterId, payerRef, policyNumber, reason, changedBy: actorId, at,
    source: { system: "wardsynq-native", sourceId: `stay-payer:${id}` } };
  try {
    const out = await svc.put({ ...next }, { expectedVersion: cur ? cur.version : 0, idempotencyKey: ctx.idempotencyKey || null });
    return { ok: true, written: 1, stayPayer: withParties({ ...next, version: out.record.version }, ctx) };
  } catch (e) {
    if (e instanceof VersionConflictError) return refuse("version_conflict", "The payer on this stay changed at the same moment. Reload and try again; nothing was saved.", 409);
    if (e instanceof GovernanceError) return { ok: false, status: 403, error: "governance", reasons: (e.reasons || []).map((r) => r.code), written: 0 };
    return { ok: false, status: 502, error: "record_write_failed", message: "The change could not be recorded, so it was not made.", written: 0 };
  }
}

/** PURE. A stay payer record as a screen reads it: the record and the parties its payer's contract resolves to now. */
function withParties(rec, ctx) {
  const { meta, ...rest } = rec;
  return { ...rest, parties: partiesRecord(resolveParties({ payerRef: rec.payerRef, payers: ctx.payers, gst: ctx.gst }), null) };
}

export { STAY_PAYER_TYPE, stayPayerIdFor, setStayPayer, withParties as stayPayerWithParties };
