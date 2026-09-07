/* functions/_wardsynq/migrate-prescription.js — the doctor's OPD prescription, migrated.
 *
 * WHERE THIS COMES FROM. `opd-emr.js submitPrescribe()` posts
 * `{drugId, route, form, qty, frequency, duration, remarks}` to GHIS's `/prescribe` and, ONLY on
 * success, mirrors it as a `kind:"medication"` timeline line. That mirror is the seam vitals, the
 * assessment and the investigation order already use. Nothing here is a fourth mechanism.
 *
 * READ THIS FIRST — GHIS PRESCRIBING IS INERT TODAY, ON PURPOSE.
 * `functions/api/ghis/[[path]].js` hard-blocks `/prescribe` unless `QUEUE_EMR_PRESCRIBE_OK=1`,
 * because GHIS's real CreateDrugs payload was never captured: every field name in `prescribe()`
 * except `frequency` is an UNVERIFIED guess, and a wrong field could mis-prescribe a drug. So the
 * endpoint answers 501 `prescribe_not_verified`, and `postWrite` returns BEFORE `addToTimeline`.
 *
 * The consequence is deliberate and must not be "fixed" here: a prescription GHIS refused produces
 * NO record write, because the mirror never fires. An active medication order in the record for a
 * prescription that was never actually placed is the single most dangerous thing this file could
 * do, so it is prevented by the same early return that makes the toast honest, and pinned by a test.
 * This migration therefore starts inert behind TWO gates, not one: the tenant's own settings key,
 * and GHIS prescribing becoming real. The mapping is in place for the day the second gate opens.
 *
 * NOT A TIMELINE SENTENCE. The canonical model already represents this: `MedicationOrder`. So that
 * is what is written, structured, rather than the "Paracetamol Oral Tablet 10 BID 5 days" line the
 * timeline shows. The timeline keeps its sentence; nothing is duplicated into it, nothing removed.
 *
 * WHAT MAPS TO WHAT, and what deliberately does not:
 *
 *   drug          the product description GHIS's own drug search returned ("Tab Paracetamol 650").
 *   drugCode      the GHIS drug id the prescription is actually placed against
 *                 (`material_service_sp_id`), with drugCodeSystem "ghis-drug-id" so nobody later
 *                 reads it as an RxNorm cui.
 *   genericName   `basic_material_desc` from the same search row, bolted on. Clinically meaningful
 *                 and already captured: wardsynq-safety.js indexes allergy classes and dose limits
 *                 BY GENERIC, so dropping it would blind checks that already exist.
 *   route         the Route field, as typed.
 *   frequency     the Frequency field, as typed. GHIS's ONE verified field name.
 *   form/quantity/duration/instructions
 *                 bolted on the way this codebase already bolts on a fact the canonical shape has
 *                 no field for (wardsynq-ghis-adapter.js dobIsUnknown, migrate-inv-order.js
 *                 codeSystem). Every one of them is a field the doctor actually filled in.
 *   prescriberId  the AUTHENTICATED prescriber, from the session — never a name typed anywhere.
 *
 *   dose          DELIBERATELY LEFT NULL. The GHIS prescribe form has NO dose field — it has
 *                 Quantity ("10"), which is how many units to dispense, not how much to give. The
 *                 model's `dose` is {value, unit} and wardsynq-safety.js checkDose() does ceiling
 *                 arithmetic on it. Mapping Quantity into dose would silently check the wrong
 *                 number against a real ceiling. Left null, checkDose reports DOSE_UNPARSEABLE —
 *                 "no numeric dose on this order, ceiling checks could not run" — which is the
 *                 truth. An honest gap beats a plausible wrong number.
 *   PRN, timing, start/end, priority, indication, strength
 *                 NOT captured by the OPD prescribe form at all. Not invented here.
 *
 * STATUS AND SIGNATURE — the existing lifecycle, preserved, not weakened.
 * `MedicationOrder` is an INSTRUCTION_TYPE, so committing it beyond a draft needs EXECUTE
 * (wardsynq-actors.js authoriseWrite): a nurse is refused on scope, and no non-human kind can hold
 * EXECUTE at all. A signature is an ACT, not a string: only the writing actor may sign, only a
 * credentialed human may sign, enforced by NON_HUMAN_SIGNATURE / SIGNATURE_NOT_OWN / NO_CREDENTIAL.
 *
 * So the prescriber's credential decides, and nothing is fabricated either way:
 *   credentialed doctor  -> status "active", signedBy = their OWN id. GHIS accepted the
 *                           prescription before this ran, so it is placed, not a draft.
 *   no credential        -> status "draft", signedBy null. A doctor on a PIN session can already
 *                           save an assessment and cannot sign it; the same rule here means her
 *                           prescription is recorded as an unsigned draft rather than either
 *                           vanishing (NO_CREDENTIAL would refuse the whole write) or becoming an
 *                           ACTIVE medication order that nobody signed.
 *   AI actor             -> never reaches active: capped below EXECUTE, and GovernedStore.put
 *                           stamps aiDrafted itself, so an AI suggestion can never be presented as
 *                           a human's prescription. Not policed here, because overwriting at the
 *                           point of writing cannot be evaded by omitting or misspelling a claim.
 *
 * ONE ORDER PER DRUG PER ENCOUNTER. The id is deterministic from the encounter and the drug id, so
 * a retried or double-tapped Prescribe cannot create a second MedicationOrder, and an identical
 * re-prescription on the same visit is reported as `already_prescribed` rather than written twice.
 * The trade-off is stated rather than hidden: a doctor genuinely re-prescribing the SAME drug within
 * ONE visit is recorded once here, while GHIS and the visit timeline each keep both entries. A
 * CHANGED prescription (a new frequency, a longer duration) is a new VERSION of the same order,
 * guarded by expectedVersion, so two devices editing from one version cannot both silently land.
 *
 * ORDERS ONLY. Dispensing, administration/eMAR and reconciliation are NOT migrated — nothing here
 * writes MedicationAdministration, and the console says so rather than implying a dose was given.
 */

import { MedicationOrder } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForTicket, encounterIdForTicket, medicationOrderIdForTicket } from "./opd-identity.js";

/** The tenant's mode for this migration. Its own settings key; unknown or absent is "off". */
async function prescriptionMigration(env, session, deps) {
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "prescriptions", deps);
}

/** PURE. Trimmed string, or "" — never the literal "undefined". */
function str(v) {
  return v == null ? "" : String(v).trim();
}

/**
 * PURE. The client's prescription draft to a canonical MedicationOrder, or null when it cannot name
 * a patient, a drug or a prescriber. Nothing is defaulted into existence: a prescription with no
 * drug id is not a prescription.
 *
 * `canSign` is the prescriber's credential, resolved from the authenticated actor by the caller —
 * never anything the client claimed. It decides draft vs active, per this file's header.
 *
 * @param {{ticket: object, rx: object, prescriberId: string, canSign: boolean}} input
 */
function orderFromPrescription(input) {
  const rx = (input && input.rx) || {};
  const drugId = str(rx.drugId);
  const drug = str(rx.name);
  const patientId = patientIdForTicket(input.ticket);
  const id = medicationOrderIdForTicket(input.ticket, drugId);
  // A drug id with no product description is still not something a ward can read back safely.
  if (!drugId || !drug || !patientId || !id || !input.prescriberId) return null;

  const signed = !!input.canSign;
  const order = MedicationOrder({
    id,
    patientId,
    encounterId: encounterIdForTicket(input.ticket),
    drug,
    drugCode: drugId,
    // GHIS's own drug id by default (every caller until 2026-09-06); a wardsynq-native prescription
    // carries no GHIS id at all — opd-emr.js's wardsynq drug search sets rx.drugCodeSystem so this
    // is never mislabeled as a GHIS id it is not.
    drugCodeSystem: str(rx.drugCodeSystem) || "ghis-drug-id",
    dose: null,                                   // see the header: Quantity is not a dose
    route: str(rx.route) || null,
    frequency: str(rx.frequency) || null,
    prescriberId: input.prescriberId,
    status: signed ? "active" : "draft",
    signedBy: signed ? input.prescriberId : null,
    source: { system: "wardsynq-native", sourceId: `opd-prescription:${id}` },
  });
  // Bolted on: clinically meaningful, already captured by the OPD form, no canonical field.
  const generic = str(rx.generic);
  if (generic) order.genericName = generic;
  const form = str(rx.form);
  if (form) order.form = form;
  const quantity = str(rx.qty);
  if (quantity) order.quantity = quantity;
  const duration = str(rx.duration);
  if (duration) order.duration = duration;
  const instructions = str(rx.remarks);
  if (instructions) order.instructions = instructions;
  return order;
}

/** PURE. The same drug, on the same encounter, prescribed in the same terms. */
function samePrescription(a, b) {
  if (!a || !b) return false;
  const same = (k) => (a[k] || "") === (b[k] || "");
  return a.drugCode === b.drugCode && a.patientId === b.patientId && a.encounterId === b.encounterId
    && a.status === b.status && same("route") && same("frequency") && same("form")
    && same("quantity") && same("duration") && same("instructions") && same("signedBy");
}

/**
 * Writes the prescription to the record as the request's own governed actor. Never throws.
 * ctx: { migration, ticket, rx, actorDeps, recordDeps, idempotencyKey? }
 */
async function recordPrescription(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  // A kind:"medication" line with no rx payload is one of the other things that kind can carry
  // (a "Medication added to the record" line from the local clinic store, say). Not a prescription.
  if (!ctx.rx || typeof ctx.rx !== "object") return { ...base, ok: true, skipped: "no_prescription", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  // The credential comes from the RESOLVED actor, never from the request body. A prescriber who
  // cannot sign gets an unsigned draft, per this file's header — not a fabricated signature.
  const canSign = resolved.actor.kind === "human" && !!resolved.actor.credential;
  const candidate = orderFromPrescription({ ticket: ctx.ticket, rx: ctx.rx, prescriberId: resolved.actor.id, canSign });
  if (!candidate) return { ...base, ok: false, status: 422, error: "unusable_prescription", written: 0, actor: resolved.actor.id };
  const orderId = candidate.id;

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("MedicationOrder", orderId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, orderId };
  }
  if (current && samePrescription(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "already_prescribed", orderId, version: current.version, status: current.status, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, updated: !!current, orderId,
      drugCode: candidate.drugCode, status: candidate.status, signed: !!candidate.signedBy,
      unsigned: canSign ? undefined : "no_credential",
      version: out.record.version, replayed: out.replayed,
      actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source,
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", orderId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, orderId, actor: resolved.actor.id };
  }
}

export { prescriptionMigration, orderFromPrescription, samePrescription, recordPrescription };
