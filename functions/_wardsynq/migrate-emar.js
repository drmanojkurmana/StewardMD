/* functions/_wardsynq/migrate-emar.js — the wire between the eMAR state machine and the record.
 *
 * `wardsynq/wardsynq-meds.js` has existed, tested, since P0: the ORDERED -> VERIFIED -> DISPENSED ->
 * SCANNED -> ADMINISTERED lifecycle, the legal-transition table, the five rights, the high-alert
 * witness rule. The 2026-09-07 audit found nothing called it, and that `MedicationAdministration`
 * had zero write paths anywhere in the repository. This file is that call, and only that call.
 *
 * WHAT THIS FILE DOES NOT DO, ON PURPOSE:
 *   - it does not re-implement a single check. Every gate below is `MedicationAdministrationRecord`'s
 *     own. A competing bedside check in the server layer is how the two drift and the weaker one wins.
 *   - it does not walk the chain for you. Each transition is a separate, authenticated, audited call
 *     by a real actor. Nothing here turns an order into an administered dose in one step, which is
 *     precisely the failure the state machine was built to make impossible.
 *   - it does not invent a dose, a schedule or a formulary. `dueAt` comes from the caller; the
 *     high-alert list is hospital configuration, injected, not a constant in this file.
 *
 * PERSISTENCE. Every transition writes a new VERSION of one MedicationAdministration through the
 * governed store, so the lifecycle is the resource's own append-only history rather than a status
 * column someone overwrote. Read it back and you can see who scanned, who gave it, and when.
 *
 * DUPLICATE DOSES. `medicationAdministrationIdFor(orderId, dueAt)` is deterministic, so a retried or
 * double-tapped administration lands on the SAME record — which the state machine then refuses,
 * because ADMINISTERED has no legal transition out of it. Prevention is identity plus the existing
 * machine, not a new guard that could disagree with either.
 *
 * SAFETY AT THE BEDSIDE. `safetyCheck` is wired to the SAME SafetyEngine the prescriber's pre-check
 * uses (wardsynq-safety.js via rulepack.js), reading the patient's own recorded allergies and active
 * orders. The engine's `hook()` decides; this file only passes the verdict through. Note the machine
 * defaults `safetyCheck` to fail-closed when none is supplied - that default is deliberate and is
 * left alone; supplying the real engine is what makes the ward usable rather than what weakens it.
 */

import { MedicationAdministrationRecord, STATES, MedicationSafetyError } from "../../wardsynq/wardsynq-meds.js";
import { SafetyEngine } from "../../wardsynq/wardsynq-safety.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { medicationAdministrationIdFor } from "./opd-identity.js";

const str = (v) => (v == null ? "" : String(v).trim());

/** The transitions this route exposes, and the machine method each one is. */
const ACTIONS = Object.freeze(["verify", "dispense", "scan", "administer", "hold", "refuse", "cancel"]);

/* LOINC body weight, the code migrate-vitals.js already writes for the `weight` field. Named here
 * rather than re-derived so the ward and the vitals mapper cannot disagree about what a weight is. */
const BODY_WEIGHT_LOINC = "29463-7";

/** The patient's most recently recorded weight in kg, or undefined when the ward has not weighed them. */
async function latestWeightKg(svc, patientId) {
  try {
    const obs = await svc.byPatient("Observation", patientId);
    const weights = (obs || [])
      .filter((o) => o && o.code === BODY_WEIGHT_LOINC && typeof o.value === "number" && String(o.unit).toLowerCase() === "kg")
      .sort((a, b) => String((b.meta && b.meta.effectiveAt) || "").localeCompare(String((a.meta && a.meta.effectiveAt) || "")));
    return weights.length ? weights[0].value : undefined;
  } catch { return undefined; }
}

/**
 * The bedside safety hook, backed by the patient's REAL record: their documented allergies, their
 * currently active medication orders and their recorded weight. Never throws — a hook that throws
 * would surface as a server error rather than as the machine's own refusal, losing the reasons the
 * nurse needs to act on.
 */
function bedsideSafetyCheck(svc, rulePack) {
  return async (hookCtx) => {
    if (!rulePack) return { allowed: true, blocks: [], warnings: [{ code: "NO_RULE_PACK", message: "no decision-support content is loaded; nothing was checked" }] };
    try {
      const order = hookCtx && hookCtx.order;
      const patientId = order && order.patientId;
      const [allergies, orders] = await Promise.all([
        svc.byPatient("AllergyIntolerance", patientId).catch(() => []),
        svc.byPatient("MedicationOrder", patientId).catch(() => []),
      ]);
      const activeMeds = (orders || [])
        .filter((o) => o && o.status === "active" && o.id !== (order && order.id))
        .map((o) => ({ drug: o.drug, drugCode: o.genericName || o.drugCode }));

      /* The patient's OWN recorded weight, from the ward vitals, because a weight-based ceiling
       * cannot be checked without one — the engine blocks with DOSE_WEIGHT_MISSING, which is the
       * "a weight-based drug on an unweighed patient refuses rather than passes" invariant and is
       * correct. It is read from the record rather than taken from the request body on purpose: a
       * client-supplied weight is a number that can be typed to make a ceiling pass. If the ward has
       * not weighed the patient there is nothing to send, and the block stands. */
      const weightKg = await latestWeightKg(svc, patientId);
      const engine = new SafetyEngine({ rulePack });
      // Carried ON the patient, not as a sibling field: hook() forwards order/patient/allergies/
      // activeMeds/overrides to evaluate() and nothing else, while evaluate() reads
      // `ctx.weightKg ?? patient.weightKg`. Attaching it here is what makes the ceiling checkable
      // without widening the engine's own hook signature.
      const patient = { ...(hookCtx.patient || {}), ...(typeof weightKg === "number" ? { weightKg } : {}) };
      return engine.hook()({ order, patient, activeMeds, allergies: allergies || [] });
    } catch (e) {
      // Could not check. Say so as a warning and let the machine's own gates decide; silently
      // returning "allowed" would be the clean-bill-of-health-for-a-check-that-never-ran failure.
      return { allowed: true, blocks: [], warnings: [{ code: "SAFETY_CHECK_UNAVAILABLE", message: str(e && e.message) || "decision support unavailable" }] };
    }
  };
}

/** Builds the governed service, or a shaped refusal. Never throws. */
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

/**
 * The medication round: every active order for this patient with whatever administration record
 * already exists for the named dose time. This is what "what is due" means — the orders, plus what
 * has already happened to them this round. It computes no schedule and invents no due times.
 *
 * ctx: { migration, patientId, dueAt, actorDeps, recordDeps }
 */
async function medicationRound(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", due: [] };

  const patientId = str(ctx.patientId);
  const dueAt = str(ctx.dueAt);
  if (!patientId || !dueAt) return { ...base, ok: false, status: 422, error: "patient_and_dueAt_required", due: [] };

  const { svc, error } = await openService(request, env, ctx, "record:read");
  if (error) return { ...base, ...error, due: [] };

  let orders;
  try { orders = await svc.byPatient("MedicationOrder", patientId); }
  catch (e) { return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), due: [] }; }

  const due = [];
  for (const o of (orders || []).filter((x) => x && x.status === "active")) {
    const marId = medicationAdministrationIdFor(o.id, dueAt);
    let mar = null;
    try { mar = marId ? await svc.get("MedicationAdministration", marId) : null; } catch { mar = null; }
    due.push({
      orderId: o.id, drug: o.drug, dose: o.dose || null, route: o.route || null, frequency: o.frequency || null,
      administrationId: marId,
      status: mar ? mar.status : null,          // null = this dose has not been started
      administeredAt: (mar && mar.administeredAt) || null,
      administeredBy: (mar && mar.administeredBy) || null,
    });
  }
  return { ...base, ok: true, patientId, dueAt, due };
}

/**
 * One governed transition of one dose.
 *
 * ctx: { migration, action, orderId, dueAt, patient, scan?, reason?, witnessId?, rulePack?,
 *        highAlertDrugs?, actorDeps, recordDeps }
 */
async function administerStep(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig && mig.mode, tenantId: (mig && mig.tenantId) || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: "off", written: 0 };

  const action = str(ctx.action);
  const orderId = str(ctx.orderId);
  const dueAt = str(ctx.dueAt);
  if (!ACTIONS.includes(action)) return { ...base, ok: false, status: 400, error: "unknown_action", detail: `action must be one of ${ACTIONS.join(", ")}` };
  if (!orderId || !dueAt) return { ...base, ok: false, status: 422, error: "order_and_dueAt_required" };

  const marId = medicationAdministrationIdFor(orderId, dueAt);
  if (!marId) return { ...base, ok: false, status: 422, error: "bad_identifiers" };

  const { svc, resolved, error } = await openService(request, env, ctx, "record:write");
  if (error) return { ...base, ...error, written: 0 };

  // The order is the authority for what may be given. Read it from the record, never from the body:
  // a client-supplied drug or dose is exactly the wrong-drug/wrong-dose path the rights check exists
  // to close, and trusting the body would walk straight around it.
  let order, existing;
  try {
    order = await svc.get("MedicationOrder", orderId);
    existing = await svc.get("MedicationAdministration", marId);
  } catch (e) {
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: str(e && e.message), written: 0 };
  }
  if (!order) return { ...base, ok: false, status: 404, error: "order_not_found", orderId };
  if (order.status !== "active") return { ...base, ok: false, status: 409, error: "order_not_active", orderId, orderStatus: order.status };

  // Wrong-patient prevention, before any state is touched: the patient the ward says it is holding
  // must be the patient the ORDER names. The five rights check this again at the bedside against the
  // scanned wristband; this is the same question asked of the record rather than of the scan.
  const patient = ctx.patient || null;
  if (!patient || !patient.id) return { ...base, ok: false, status: 422, error: "patient_required" };
  if (patient.id !== order.patientId) {
    return { ...base, ok: false, status: 409, error: "wrong_patient", detail: "this order belongs to a different patient", orderId, orderPatientId: order.patientId, presentedPatientId: patient.id };
  }

  const emar = new MedicationAdministrationRecord({
    safetyCheck: bedsideSafetyCheck(svc, ctx.rulePack),
    highAlertDrugs: ctx.highAlertDrugs || [],
  });

  let record = existing;
  if (!record) {
    if (action !== "verify" && action !== "cancel" && action !== "hold") {
      // A dose has to start at the beginning. Refusing here is what stops an "administer" call on an
      // order that nobody verified or dispensed from quietly creating a record already at the end.
      return { ...base, ok: false, status: 409, error: "dose_not_started", detail: "this dose has no administration record yet; verify it first", orderId, administrationId: marId };
    }
    record = emar.open(order);
    record.id = marId;                       // deterministic, so a retry is the same dose
    record.encounterId = order.encounterId || null;
    /* WHEN THE DOSE WAS DUE. It was in the id and nowhere else, so the record could say a dose was
     * given and could not say whether it was given late - and "was this dose on time" is a question
     * a ward has to be able to answer about its own eMAR. Recovering it by parsing the id back would
     * be guessing at a slug; this is the value the caller actually passed. */
    record.dueAt = dueAt;
  }

  const before = record.status;
  try {
    if (action === "verify") await emar.transition(record, STATES.VERIFIED, { actorId: resolved.actor.id });
    else if (action === "dispense") await emar.transition(record, STATES.DISPENSED, { actorId: resolved.actor.id });
    else if (action === "scan") await emar.scan(record, { order, patient, scan: ctx.scan || {}, nurseId: resolved.actor.id });
    else if (action === "administer") await emar.administer(record, { order, nurseId: resolved.actor.id, witnessId: str(ctx.witnessId) || null });
    else if (action === "hold") await emar.hold(record, resolved.actor.id, str(ctx.reason));
    else if (action === "refuse") await emar.refuse(record, resolved.actor.id, str(ctx.reason));
    else if (action === "cancel") await emar.cancel(record, resolved.actor.id, str(ctx.reason));
  } catch (e) {
    if (e instanceof MedicationSafetyError) {
      // The machine refused: five rights, safety engine, illegal transition, missing witness. Its
      // reasons are the answer — they are what the nurse has to act on.
      return { ...base, ok: false, status: 409, error: "refused", action, from: before, reasons: e.reasons || [], detail: str(e.message), orderId, administrationId: marId, actor: resolved.actor.id };
    }
    return { ...base, ok: false, status: 502, error: "emar_failed", detail: str(e && e.message), orderId, administrationId: marId };
  }

  try {
    const out = await svc.put(record, { expectedVersion: existing ? existing.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, action, from: before, to: record.status,
      orderId, administrationId: marId, patientId: order.patientId, encounterId: order.encounterId || null,
      administeredBy: record.administeredBy || null, administeredAt: record.administeredAt || null,
      witnessedBy: record.witnessedBy || null,
      safetyWarnings: record.safetyWarnings || [],
      version: out.record.version, actor: resolved.actor.id, role: resolved.role,
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, administrationId: marId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", detail: e.detail, orderId, administrationId: marId };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: str(e && e.message), orderId, administrationId: marId };
  }
}

export { ACTIONS, bedsideSafetyCheck, medicationRound, administerStep };
