/* functions/_wardsynq/pharmacy-dispense.js — the pharmacy issued the medicine. Nobody has taken it.
 *
 * THREE ACTS, THREE RECORDS, AND THE WHOLE VALUE OF THIS FILE IS THAT THEY STAY APART:
 *
 *   MedicationOrder          a prescriber said to give it
 *   MedicationDispense       the pharmacy issued the stock            <- this file
 *   MedicationAdministration a nurse gave it to a patient
 *
 * A dispense is a SUPPLY fact. It says medicine left the pharmacy and arrived on a ward. It says
 * nothing whatever about a patient having received anything, and nothing here ever writes, touches
 * or implies a MedicationAdministration. A system that let "dispensed" drift into "given" would put
 * doses on charts that nobody administered, attributable to nurses who never saw them.
 *
 * NOT THE eMAR's `dispensed` STATE. The administration state machine already has a `dispensed`
 * transition, and it is a different fact: a nurse taking the dose out of the ward cupboard for THIS
 * dose, at THIS due time. This is the pharmacy issuing a supply against the order. A hospital with a
 * unit-dose pharmacy has both, and collapsing them would lose the question "did the ward actually
 * receive what was ordered", which is the one a drug chart cannot answer.
 *
 * IT IS DISPENSED AGAINST A VERSION. If the prescriber changed the dose after the pharmacy checked
 * it, what was issued is what was issued, and the record shows both. A dispense against an order
 * whose verified version has been superseded is REFUSED, because "the pharmacist approved this" then
 * means a different prescription.
 *
 * A HOSPITAL THAT DOES NOT VERIFY IS NOT BLOCKED. Not every site runs pharmacy verification, so an
 * order with no verification at all can still be dispensed - and the record says `unverified: true`
 * rather than implying a check that never happened.
 *
 * NO INVENTORY. There is no stock level, no reorder and no location. That is a pharmacy management
 * system and it is deliberately out of scope; this records the ISSUE against the order, which is what
 * the clinical record needs and what an audit asks for.
 *
 * BATCH AND EXPIRY ARE NOT INVENTORY. They are what the pharmacist reads off the box in front of them,
 * and they are the two facts a recall and a harm investigation ask for first: WHICH batch went to
 * which patient. Recording them here needs no stock system, and an EXPIRED one is REFUSED - the one
 * place this file blocks on something other than the prescription, because dispensing an expired drug
 * is a recognised harm and the box says so in the pharmacist's hand.
 *
 * AN ABSENT EXPIRY IS NOT A VALID ONE. A dispense with no expiry recorded is allowed - not every
 * hospital captures it, and refusing would stop supply everywhere that does not - but it is recorded
 * as absent and never as "checked and fine".
 */

import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";

const str = (v) => (v == null ? "" : String(v).trim());
const TYPE = "MedicationDispense";

/** Issued, or sent back. There is no "given": that is a MedicationAdministration and it is not this. */
const STATES = Object.freeze(["issued", "returned"]);

function MedicationDispense(input) {
  const i = input || {};
  return {
    resourceType: TYPE,
    id: i.id,
    patientId: i.patientId,
    encounterId: i.encounterId || null,
    orderId: i.orderId,
    /* The version of the order this supply was issued against. If the prescriber changes the dose
     * afterwards, what was issued is still what was issued. */
    orderVersion: Number.isFinite(i.orderVersion) ? i.orderVersion : null,
    drug: i.drug || null,
    drugCode: i.drugCode || null,
    /* HOW MUCH LEFT THE PHARMACY. Not a dose: "28 tablets" is a supply, and the dose is on the order.
     * Recording a quantity as though it were a dose is how a drug chart acquires a number nobody
     * prescribed. */
    quantity: i.quantity || null,
    /* What the pharmacist read off the box. The two facts a recall asks for first: WHICH batch went
     * to which patient. Neither is derived, and neither is a stock level. */
    batch: i.batch || null,
    expiry: i.expiry || null,
    state: STATES.includes(i.state) ? i.state : "issued",
    destination: i.destination || null,          // the ward it went to
    // Whether a pharmacist had checked this exact version when it was issued. Stated, never assumed.
    verifiedVersion: Number.isFinite(i.verifiedVersion) ? i.verifiedVersion : null,
    unverified: !!i.unverified,
    dispensedBy: i.dispensedBy || null, dispensedAt: i.dispensedAt || null,
    returnedBy: i.returnedBy || null, returnedAt: i.returnedAt || null, returnReason: i.returnReason || null,
    source: { system: "wardsynq-native", sourceId: `dispense:${i.id}` },
  };
}

const slug = (v) => str(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * PURE. One dispense per (order version, issue time).
 *
 * The time is IN the id deliberately: a repeat supply of the same order is a genuinely new dispense,
 * and an id keyed only on the order would have silently overwritten the first one - losing the fact
 * that the ward was supplied twice, which is exactly what a controlled-drug audit looks for. A
 * retried request carrying the same instant is the same dispense.
 */
function dispenseIdFor(orderId, orderVersion, dispensedAt) {
  const o = slug(orderId), t = slug(dispensedAt);
  if (orderVersion === null || orderVersion === undefined || orderVersion === "") return null;
  const v = Number(orderVersion);
  return o && t && Number.isFinite(v) ? `wsq-disp-${o}-v${v}-${t}` : null;
}

/**
 * PURE. Is this stock expired at the moment it is being issued?
 *
 * `unknown` is its own answer and never "fine": a hospital that does not capture expiry has not
 * checked it, and a system that reported that as a pass would be asserting something nobody looked at.
 */
function expiryState(expiry, atIso) {
  const e = str(expiry);
  if (!e) return { state: "unknown", detail: "No expiry was recorded, so none was checked." };
  /* A date-only expiry means the END of that day: a box marked 09/2026 is usable on 30 September.
   * Parsing it as midnight would refuse a month of usable stock, and a pharmacy that has to work
   * around a refusal stops reading them. */
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(e);
  const monthOnly = /^\d{4}-\d{2}$/.test(e);
  let endMs;
  if (monthOnly) {
    const [y, m] = e.split("-").map(Number);
    endMs = Date.UTC(y, m, 1) - 1;                       // the last instant of that month
  } else if (dayOnly) {
    endMs = Date.parse(e + "T23:59:59.999Z");
  } else {
    endMs = Date.parse(e);
  }
  if (!Number.isFinite(endMs)) return { state: "unreadable", detail: `"${e}" is not a date this system can read, so no expiry was checked.` };
  const atMs = Date.parse(str(atIso)) || Date.now();
  return endMs < atMs
    ? { state: "expired", expiredAt: new Date(endMs).toISOString(), detail: `This stock expired on ${e}.` }
    : { state: "in-date", expiresAt: new Date(endMs).toISOString() };
}

/** PURE. A quantity is two things or it is nothing. "Some" is not a supply record. */
function quantityOf(q) {
  if (!q || typeof q !== "object") return null;
  const value = Number(q.value), unit = str(q.unit);
  if (!Number.isFinite(value) || value <= 0 || !unit) return null;
  return { value, unit };
}

/**
 * PURE. What the pharmacy's own check says about the version being issued.
 *
 * `superseded` is the one that matters: a pharmacist verified version 2, the prescriber amended to
 * version 3, and issuing now would put "the pharmacist approved this" against a prescription they
 * never saw.
 */
function verificationFor(verifications, orderVersion) {
  const rows = (verifications || []).filter((v) => v && v.outcome === "verified" && Number.isFinite(v.orderVersion));
  if (!rows.length) return { state: "none" };
  const exact = rows.find((v) => v.orderVersion === orderVersion);
  if (exact) return { state: "current", verifiedVersion: exact.orderVersion };
  const highest = rows.reduce((a, b) => (b.orderVersion > a.orderVersion ? b : a));
  return { state: "superseded", verifiedVersion: highest.orderVersion };
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

function summary(d) {
  return {
    dispenseId: d.id, orderId: d.orderId, orderVersion: d.orderVersion,
    drug: d.drug || null, quantity: d.quantity || null, batch: d.batch || null, expiry: d.expiry || null, state: d.state,
    destination: d.destination || null, unverified: !!d.unverified, verifiedVersion: d.verifiedVersion,
    dispensedBy: d.dispensedBy, dispensedAt: d.dispensedAt,
    returnedBy: d.returnedBy || null, returnedAt: d.returnedAt || null, returnReason: d.returnReason || null,
    version: d.version,
  };
}

/** Issues a supply against an order. ctx: { migration, orderId, quantity, destination?, at?, ... } */
async function dispenseOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const orderId = str(ctx.orderId);
  if (!orderId) return { ...base, ok: false, status: 422, error: "order_required", written: 0 };
  const quantity = quantityOf(ctx.quantity);
  // "We sent some" is not a supply record, and a quantity nobody stated cannot be reconciled later.
  if (!quantity) return { ...base, ok: false, status: 422, error: "quantity_required", detail: "a dispense needs a positive quantity and a unit, for example {value: 28, unit: \"tablet\"}", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let order, verifications;
  try {
    order = await svc.get("MedicationOrder", orderId);
    verifications = order ? await svc.byPatient("MedicationVerification", order.patientId).catch(() => []) : [];
  } catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId, written: 0 };
  // A stopped or draft prescription is not supplied. Only a live order gets stock issued against it.
  if (order.status !== "active") return { ...base, ok: false, status: 409, error: "order_not_active", detail: `this order is ${order.status}`, orderId, written: 0 };

  /* THE ONE PLACE THIS FILE BLOCKS ON SOMETHING OTHER THAN THE PRESCRIPTION. Dispensing an expired
   * drug is a recognised harm, and the box says so in the pharmacist's hand. `unknown` and
   * `unreadable` do NOT block - not every hospital captures expiry, and refusing everywhere would
   * stop supply for a field nobody fills in - but neither is ever recorded as "checked and fine". */
  const at0 = str(ctx.at) || new Date().toISOString();
  const expiry = expiryState(ctx.expiry, at0);
  if (expiry.state === "expired") {
    return {
      ...base, ok: false, status: 409, error: "expired_stock",
      detail: expiry.detail, expiry: str(ctx.expiry), batch: str(ctx.batch) || null,
      basis: "the expiry recorded on this supply, not a clinical finding", written: 0,
    };
  }

  const mine = (verifications || []).filter((v) => v && str(v.orderId) === orderId);
  const check = verificationFor(mine, order.version);
  if (check.state === "superseded") {
    /* REFUSED. Issuing now would put "the pharmacist approved this" against a prescription they never
     * saw. The fix is a human act - re-verify the current version - not a flag. */
    return {
      ...base, ok: false, status: 409, error: "verification_superseded",
      detail: `this order was verified at version ${check.verifiedVersion} and is now at version ${order.version}. Re-verify before issuing.`,
      orderId, orderVersion: order.version, verifiedVersion: check.verifiedVersion, written: 0,
    };
  }

  const at = at0;
  const id = dispenseIdFor(orderId, order.version, at);
  if (!id) return { ...base, ok: false, status: 422, error: "bad_identifiers", written: 0 };

  let current;
  try { current = await svc.get(TYPE, id); }
  catch { current = null; }
  if (current) return { ...base, ok: true, written: 0, skipped: "already_dispensed", ...summary(current) };

  const record = MedicationDispense({
    id, patientId: order.patientId, encounterId: order.encounterId || null,
    orderId, orderVersion: order.version, drug: order.drug, drugCode: order.drugCode || null,
    quantity, batch: str(ctx.batch) || null, expiry: str(ctx.expiry) || null,
    state: "issued", destination: str(ctx.destination) || null,
    verifiedVersion: check.state === "current" ? check.verifiedVersion : null,
    // Stated on the record rather than left to be inferred from an absent verification.
    unverified: check.state === "none",
    dispensedBy: resolved.actor.id, dispensedAt: at,
  });

  try {
    const out = await svc.put(record, { idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, ...summary({ ...record, version: out.record.version }),
      /* Said on every response, because this is the confusion the whole file exists to prevent. */
      note: "Issued to the ward. No dose has been administered, and no administration record was touched.",
      expiryCheck: expiry,
      ...(expiry.state === "unknown" || expiry.state === "unreadable" ? { expiryWarning: expiry.detail } : {}),
      ...(check.state === "none" ? { warning: "No pharmacist verification exists for this order. It is recorded as unverified." } : {}),
      actor: resolved.actor.id,
    };
  } catch (e) {
    return { ...base, ...writeFailure(e, { dispenseId: id, written: 0, actor: resolved.actor.id }) };
  }
}

/** Stock comes back: the patient was discharged, the order was stopped. ctx: { migration, dispenseId, reason } */
async function returnDispense(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const dispenseId = str(ctx.dispenseId), reason = str(ctx.reason);
  if (!dispenseId) return { ...base, ok: false, status: 422, error: "dispense_required", written: 0 };
  if (!reason) return { ...base, ok: false, status: 422, error: "reason_required", detail: "say why the stock came back", written: 0 };

  const { svc, resolved, error } = await open(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  let current;
  try { current = await svc.get(TYPE, dispenseId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 }; }
  if (!current) return { ...base, ok: false, status: 404, error: "dispense_not_found", dispenseId, written: 0 };
  if (current.state === "returned") return { ...base, ok: true, written: 0, skipped: "already_returned", ...summary(current) };

  const next = MedicationDispense({ ...current, state: "returned", returnedBy: resolved.actor.id, returnedAt: new Date().toISOString(), returnReason: reason });
  try {
    const out = await svc.put(next, { expectedVersion: current.version, idempotencyKey: ctx.idempotencyKey || null });
    /* The issue is NOT erased. It happened: the medicine was on the ward, and a controlled-drug audit
     * asks exactly that. The return is the next version of the same record. */
    return { ...base, ok: true, written: 1, ...summary({ ...next, version: out.record.version }), actor: resolved.actor.id };
  } catch (e) {
    return { ...base, ...writeFailure(e, { dispenseId, written: 0, actor: resolved.actor.id }) };
  }
}

/** What has been issued for a patient. ctx: { migration, patientId, ... } */
async function listDispenses(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", dispenses: [] };

  const patientId = str(ctx.patientId);
  if (!patientId) return { ...base, ok: false, status: 422, error: "patient_required", dispenses: [] };

  const { svc, error } = await open(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, dispenses: [] };

  let rows;
  try { rows = await svc.byPatient(TYPE, patientId); }
  catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "permission", reasons: (e.reasons || []).map((r) => r.code), dispenses: [] };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), dispenses: [] };
  }

  const dispenses = (rows || []).filter(Boolean).map(summary)
    .sort((a, b) => String(b.dispensedAt || "").localeCompare(String(a.dispensedAt || "")));
  return {
    ...base, ok: true, dispenses,
    issued: dispenses.filter((d) => d.state === "issued").length,
    unverified: dispenses.filter((d) => d.unverified).length,
    note: "A dispense is a supply fact. None of these means a dose was given to the patient.",
  };
}

export { TYPE, STATES, MedicationDispense, dispenseIdFor, quantityOf, expiryState, verificationFor, dispenseOrder, returnDispense, listDispenses };
