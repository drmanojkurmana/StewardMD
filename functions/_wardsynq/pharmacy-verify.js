/* functions/_wardsynq/pharmacy-verify.js — pharmacy verification, as its own authority.
 *
 * The eMAR has had a `verify` step since the inpatient build, and it required MED_ADMINISTER: the
 * NURSE's authority. That was deliberate and it was documented as a stopgap in
 * api/queue/[[path]].js, for a reason worth restating, because it is the whole design of this file:
 *
 *   verify and dispense WRITE the MedicationAdministration record. Granting them to the pharmacy
 *   role would have meant granting pharmacy write access to that resource - and a role that can
 *   write it through the raw record API could post a fabricated "administered" row without ever
 *   going near a bedside. A dose nobody gave would be on the chart, attributable to a nurse.
 *
 * So pharmacy verification writes its OWN resource, against the ORDER, and never touches the
 * administration. The ward-stock `verify` transition on the eMAR is untouched and still belongs to
 * the nurse holding the dose. These are two different checks of two different things, and a hospital
 * with a unit-dose pharmacy wants both.
 *
 * WHAT A PHARMACIST CAN SEE, AND WHY THAT IS THE POINT. Verification is only as good as what the
 * verifier can read. Until now the pharmacy role held no EMR capability at all, so a pharmacist
 * could not see the allergy, the creatinine or the critical potassium they are supposed to be
 * checking against - which made "pharmacy verification" impossible to do honestly. ORDER_VERIFY
 * grants exactly the four-and-a-bit resource types a verification needs and nothing else: not the
 * notes, not the discharge summary, not the whole chart.
 *
 * THE RULES
 *
 *  1. VERIFYING IS NOT GIVING. Nothing in this file writes, moves or completes a
 *     MedicationAdministration. A verified order is still an order.
 *  2. A REJECTION IS AS FIRST-CLASS AS AN APPROVAL, and needs a reason. "Verified" and "queried"
 *     are both real pharmacy outcomes, and a system that can only record agreement is a system that
 *     quietly loses every disagreement.
 *  3. VERIFICATION IS OF ONE VERSION OF THE ORDER. If the prescriber changes the dose afterwards,
 *     the verification does not carry over - it names the version it checked, and the ward can see
 *     that what was verified is not what is now written.
 *  4. IT NEVER BLOCKS THE BEDSIDE ON ITS OWN. Whether an unverified order may be given is a
 *     hospital's policy, not this file's: it reports the state and lets the ward and the org decide.
 *     Silently refusing doses would strand every ward that has no on-site pharmacist at 3am.
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
// TASK 3.3: the SAME safety engine the bedside eMAR hook already runs (migrate-emar.js's own
// bedsideSafetyCheck) - reused verbatim, never reimplemented, and never a second engine. A
// pharmacist verifying an order was, until now, reading the raw allergy list unassisted; this
// gives them the exact interaction/dose/allergy verdict the engine already computes for the ward.
import { bedsideSafetyCheck } from "./migrate-emar.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "MedicationVerification";

/** What a pharmacist can conclude. Both are real outcomes; neither is a failure of the other. */
const OUTCOMES = Object.freeze(["verified", "queried"]);

/** A pharmacy verification of one version of one order. */
function MedicationVerification(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    orderId: i.orderId,
    /* The version of the order that was checked. A verification of a dose that has since been
     * changed is not a verification of the dose the ward is about to give. */
    orderVersion: i.orderVersion == null ? null : i.orderVersion,
    outcome: OUTCOMES.includes(i.outcome) ? i.outcome : "queried",
    reason: i.reason || null,
    verifiedBy: i.verifiedBy || null,
    verifiedAt: i.verifiedAt || null,
    source: { system: "wardsynq-native", sourceId: `pharmacy-verify:${i.id}` },
  };
}

/** PURE. One verification per (order, order version): re-checking the same version is idempotent. */
function verificationIdFor(orderId, orderVersion) {
  const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const o = slug(orderId);
  return o && Number.isFinite(Number(orderVersion)) ? `wsq-pv-${o}-v${Number(orderVersion)}` : null;
}

/**
 * PURE. What the ward should be told about an order's verification state.
 *
 * `stale` is the one that matters: a verification exists, but of an OLDER version of the order. The
 * dose was changed after the pharmacist checked it, and presenting that as "verified" would be a
 * false reassurance about the exact thing verification is for.
 */
function verificationState(order, verifications) {
  const rows = (verifications || []).filter((v) => v && v.orderId === (order && order.id));
  if (!rows.length) return { state: "unverified", verification: null };
  const latest = rows.slice().sort((a, b) => Number(b.orderVersion || 0) - Number(a.orderVersion || 0))[0];
  const current = Number(order.version);
  const of = Number(latest.orderVersion);
  if (latest.outcome === "queried") return { state: "queried", verification: latest, stale: Number.isFinite(current) && of < current };
  if (Number.isFinite(current) && Number.isFinite(of) && of < current) {
    return { state: "stale", verification: latest, verifiedVersion: of, currentVersion: current };
  }
  return { state: "verified", verification: latest };
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

/**
 * A pharmacist records their check of an order.
 * ctx: { migration, orderId, outcome, reason?, actorDeps, recordDeps }
 */
async function verifyOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const orderId = str(ctx.orderId);
  if (!orderId) return { ...base, ok: false, status: 422, error: "order_required", written: 0 };
  const outcome = str(ctx.outcome).toLowerCase();
  if (!OUTCOMES.includes(outcome)) return { ...base, ok: false, status: 400, error: "unknown_outcome", detail: `outcome must be one of ${OUTCOMES.join(", ")}`, written: 0 };
  const reason = str(ctx.reason);
  /* A QUERY WITHOUT A REASON IS NOISE. The ward has to know what the pharmacist is querying before
   * it can do anything about it, and "queried" on its own would stall a dose with no way forward. */
  if (outcome === "queried" && !reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say what the query is, so the ward can act on it", written: 0 };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let order;
  try { order = await svc.get("MedicationOrder", orderId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId, written: 0 };

  const id = verificationIdFor(orderId, order.version);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }

  const record = MedicationVerification({
    id, patientId: order.patientId, encounterId: order.encounterId || null,
    orderId, orderVersion: order.version,
    outcome, reason: reason || null,
    verifiedBy: resolved.actor.id, verifiedAt: new Date().toISOString(),
  });
  // Re-recording the identical conclusion on the same version of the order writes nothing.
  if (current && current.outcome === outcome && str(current.reason) === reason) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", verificationId: id, orderId, orderVersion: order.version, outcome, version: current.version };
  }

  try {
    const out = await svc.put(record, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, verificationId: id, orderId, orderVersion: order.version,
      outcome, reason: reason || null, verifiedBy: resolved.actor.id, verifiedAt: record.verifiedAt,
      version: out.record.version, actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { verificationId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/**
 * The patient's active orders with their verification state, for pharmacy and for the ward.
 * ctx: { migration, patientId, actorDeps, recordDeps }
 */
async function verificationQueue(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", orders: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", orders: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, orders: [] };

  let orders, verifications, allergies;
  try {
    [orders, verifications, allergies] = await Promise.all([
      svc.byPatient("MedicationOrder", patientId),
      svc.byPatient(TYPE, patientId).catch(() => []),
      // The allergies travel WITH the queue. A pharmacist who has to go and look them up separately
      // is a pharmacist who sometimes will not, and this is the check they are here to make.
      svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
    ]);
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), orders: [] }; }

  const active = (orders || []).filter((o) => o && o.status === "active");
  // TASK 3.3: the SAME engine the bedside hook runs, once per queued order. Never a second engine,
  // never silently skipped: a rule pack that fails to load or a check that throws surfaces as a
  // NOT_CHECKED_* warning (bedsideSafetyCheck's own honesty), never as a quiet "allowed".
  const check = bedsideSafetyCheck(svc, ctx.rulePack || null);
  const verdicts = await Promise.all(active.map((o) => check({ order: o, patient: { id: patientId } })));

  const rows = active.map((o, i) => {
    const v = verificationState(o, verifications);
    return {
      orderId: o.id, drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null,
      encounterId: o.encounterId || null, orderVersion: o.version, prescriberId: o.prescriberId || null,
      ...v,
      verification: v.verification ? {
        outcome: v.verification.outcome, reason: v.verification.reason || null,
        verifiedBy: v.verification.verifiedBy, verifiedAt: v.verification.verifiedAt,
        orderVersion: v.verification.orderVersion,
      } : null,
      safety: verdicts[i],
    };
  });
  const RANK = { queried: 0, stale: 1, unverified: 2, verified: 3 };
  rows.sort((a, b) => (RANK[a.state] - RANK[b.state]) || String(a.drug).localeCompare(String(b.drug)));
  return {
    ...base, ok: true, patientId, orders: rows,
    allergies: (allergies || []).map((a) => ({ substance: a.substance, severity: a.severity || null, criticality: a.criticality || null, verifiedBy: a.verifiedBy || null })),
    unverified: rows.filter((r) => r.state !== "verified").length,
  };
}

export { TYPE, OUTCOMES, MedicationVerification, verificationIdFor, verificationState, verifyOrder, verificationQueue };
