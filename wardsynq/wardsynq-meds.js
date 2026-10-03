/* wardsynq/wardsynq-meds.js — WardSynQ P0: closed-loop medication administration (eMAR).
 *
 * Owns the lifecycle of one MedicationAdministration record from the moment an order exists to the
 * moment a dose is given, refused, or held. This file is a STATE MACHINE and a 5-rights CHECKER.
 * It deliberately contains NO clinical pharmacology: no interaction matrix, no dose ceilings, no
 * allergy subsumption, no renal adjustment. Those live in wardsynq-safety.js (not yet written) and
 * reach this file only through the injected `safetyCheck` hook.
 *
 * That separation is the point. The eMAR decides "has this dose passed every gate the workflow
 * requires"; the safety engine decides "is this dose clinically safe". Mixing them is how a
 * workflow refactor silently weakens a clinical control.
 *
 * Closed loop:
 *   ORDERED -> VERIFIED -> DISPENSED -> SCANNED -> ADMINISTERED
 * with HELD / REFUSED / CANCELLED as documented exits. Every transition is validated, emits on the
 * Clinical Event Bus, and appends to an append-only audit trail on the record.
 *
 * node --test test/wardsynq-p0-core.test.mjs
 */

import { MedicationAdministration } from "./wardsynq-model.js";

/** Lifecycle states. */
const STATES = Object.freeze({
  ORDERED: "ordered",
  VERIFIED: "verified", // pharmacist has verified the order against the formulary
  DISPENSED: "dispensed", // unit dose has left pharmacy for the ward
  SCANNED: "scanned", // bedside 5-rights scan passed, not yet given
  ADMINISTERED: "administered", // terminal: dose given
  HELD: "held", // dose deliberately withheld this round, order still live
  REFUSED: "refused", // terminal for this dose: patient declined
  CANCELLED: "cancelled", // terminal: order pulled before administration
});

const TERMINAL = Object.freeze([STATES.ADMINISTERED, STATES.REFUSED, STATES.CANCELLED]);

/** Legal transitions. Anything not listed here is refused by `transition()`. */
const ALLOWED = Object.freeze({
  [STATES.ORDERED]: [STATES.VERIFIED, STATES.HELD, STATES.CANCELLED],
  [STATES.VERIFIED]: [STATES.DISPENSED, STATES.HELD, STATES.CANCELLED],
  [STATES.DISPENSED]: [STATES.SCANNED, STATES.HELD, STATES.REFUSED, STATES.CANCELLED],
  [STATES.SCANNED]: [STATES.ADMINISTERED, STATES.HELD, STATES.REFUSED, STATES.CANCELLED],
  // A held dose resumes at the point it was held from, or is abandoned. It can never jump
  // straight to ADMINISTERED: resuming forces the bedside scan to happen again.
  [STATES.HELD]: [STATES.VERIFIED, STATES.DISPENSED, STATES.REFUSED, STATES.CANCELLED],
  [STATES.ADMINISTERED]: [],
  [STATES.REFUSED]: [],
  [STATES.CANCELLED]: [],
});

/** The five rights, in the order a nurse checks them at the bedside. */
const FIVE_RIGHTS = Object.freeze(["patient", "drug", "dose", "route", "time"]);

/** Raised when a transition or gate is refused. Carries machine-readable reasons for the UI. */
class MedicationSafetyError extends Error {
  constructor(message, reasons) {
    super(message);
    this.name = "MedicationSafetyError";
    this.reasons = reasons || [];
  }
}

/**
 * Default safety hook: refuses everything.
 *
 * Deliberate fail-closed default. If no safety engine has been wired in, the correct behaviour for
 * a medication system is to refuse to administer, not to wave doses through unchecked. A caller
 * that genuinely wants no clinical checking (a unit test, a migration script) has to say so by
 * passing an explicit hook.
 */
function denyWithoutSafetyEngine() {
  return {
    allowed: false,
    blocks: [{ code: "NO_SAFETY_ENGINE", message: "No clinical safety engine configured; refusing to administer." }],
    warnings: [],
  };
}

function nowIso() {
  return new Date().toISOString();
}

/* Codex F2/F3: WHAT A DOSE'S CHECKS WERE DONE AGAINST. Verification, dispensing and the bedside scan are each a check of
 * one version of the order; an administration that keeps only the order id cannot say which dose and route those checks
 * covered once the order is amended, and a scan done against one version could be completed against the next. These are
 * the order fields whose change makes the earlier checks void: a different drug, dose, unit, route or frequency is a
 * different prescription. Anything else on the order (a course length, a stop time, the safety-at-order note) is not. */
const MATERIAL_ORDER_FIELDS = Object.freeze(["drug", "drugCode", "dose", "route", "frequency"]);

/** PURE. The order as a dose's checks saw it. Kept on the administration record, so it stays readable after the order changes. */
function orderSnapshot(order) {
  const d = order && order.dose;
  return {
    version: order && order.version != null ? order.version : null,
    drug: (order && order.drug) || null,
    drugCode: (order && order.drugCode) || null,
    dose: d && d.value != null ? { value: Number(d.value), unit: d.unit == null ? null : String(d.unit) } : null,
    route: (order && order.route) || null,
    frequency: (order && order.frequency) || null,
  };
}

/**
 * PURE. Which clinically material fields differ between the order a dose was checked against and the order now.
 * A record with no snapshot (written before snapshots were kept) answers ["orderSnapshot"]: what its checks covered
 * cannot be shown, so it is treated as changed rather than as unchanged.
 */
function materialOrderChanges(snapshot, order) {
  if (!snapshot || typeof snapshot !== "object") return ["orderSnapshot"];
  const now = orderSnapshot(order);
  const word = (v) => (v == null ? "" : String(v).trim().toLowerCase());
  return MATERIAL_ORDER_FIELDS.filter((f) => f === "dose"
    ? JSON.stringify(snapshot.dose || null) !== JSON.stringify(now.dose)
    : word(snapshot[f]) !== word(now[f]));
}

function orderChangedReasons(record, order, changes) {
  const from = record && record.orderSnapshot && record.orderSnapshot.version;
  return [{ code: "ORDER_CHANGED_SINCE_CHECKS", changed: changes,
    message: `The order changed (${changes.join(", ")}) after this dose was verified, dispensed or scanned${from != null ? ` under version ${from}` : ""}. Verify it again before giving.` }];
}

function normaliseBarcode(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

/**
 * Checks the five rights for a bedside administration.
 *
 * Identity and product are established by SCAN, never by typing or by trusting what is on screen:
 * that is the whole control behind hazard HAZ-MED-04. Dose, route and time are checked against the
 * order. Any missing scan is a failure, not a skip.
 *
 * @param {object} order MedicationOrder
 * @param {object} scan {patientBarcode, drugBarcode, dose, route, at}
 * @param {object} patient Patient (its `mrn`/wristband barcode is the identity source of truth)
 * @param {{windowMinutes?: number, allowLate?: boolean}} [opts] how far from the scheduled time still counts as on
 *   time. allowLate (CLIN-11): a dose after its window is charted as late rather than refused, because a late dose
 *   that cannot be recorded reads as not given and invites a second one; only an EARLY dose fails the right.
 * @returns {{passed: boolean, results: Record<string, {ok: boolean, detail: string}>, failed: string[]}}
 */
function checkFiveRights(order, scan, patient, opts) {
  opts = opts || {};
  const windowMinutes = opts.windowMinutes ?? 60;
  scan = scan || {};
  const results = {};

  // Right patient: scanned wristband must match the order's patient. No scan means no match.
  const scannedPatient = normaliseBarcode(scan.patientBarcode);
  const expectedPatient = normaliseBarcode(patient && (patient.wristbandBarcode || patient.mrn));
  results.patient = {
    ok: !!scannedPatient && !!expectedPatient && scannedPatient === expectedPatient && patient.id === order.patientId,
    detail: !scannedPatient ? "no patient wristband scanned" : "scanned wristband vs order patient",
  };

  // Right drug: scanned unit-dose barcode must match the ordered product.
  const scannedDrug = normaliseBarcode(scan.drugBarcode);
  const expectedDrug = normaliseBarcode(order.drugBarcode || order.drug);
  results.drug = {
    ok: !!scannedDrug && !!expectedDrug && scannedDrug === expectedDrug,
    detail: !scannedDrug ? "no unit-dose barcode scanned" : "scanned product vs ordered product",
  };

  // Right dose: value and unit must both match. A unit mismatch is a dose mismatch, not a warning.
  const orderedDose = order.dose || null;
  const scannedDose = scan.dose || null;
  results.dose = {
    ok: !!orderedDose && !!scannedDose
      && Number(orderedDose.value) === Number(scannedDose.value)
      && String(orderedDose.unit) === String(scannedDose.unit),
    detail: "prepared dose vs ordered dose",
  };

  results.route = {
    ok: !!order.route && !!scan.route && String(order.route).toLowerCase() === String(scan.route).toLowerCase(),
    detail: "administration route vs ordered route",
  };

  // Right time: within the window around the scheduled dose. With no schedule we cannot assert
  // timing, so this right passes and the fact is recorded in the detail rather than hidden.
  if (!scan.scheduledAt) {
    results.time = { ok: true, detail: "no scheduled time on this dose; timing not asserted" };
  } else {
    const at = new Date(scan.at || nowIso()).getTime();
    const scheduled = new Date(scan.scheduledAt).getTime();
    const driftMinutes = Math.abs(at - scheduled) / 60000;
    const lateOk = opts.allowLate === true && at > scheduled;
    results.time = {
      ok: Number.isFinite(driftMinutes) && (driftMinutes <= windowMinutes || lateOk),
      detail: `drift ${Number.isFinite(driftMinutes) ? driftMinutes.toFixed(1) : "unknown"} min vs ${windowMinutes} min window`
        + (lateOk && driftMinutes > windowMinutes ? "; given late" : at < scheduled && driftMinutes > windowMinutes ? "; too early for this dose" : ""),
    };
  }

  const failed = FIVE_RIGHTS.filter((right) => !results[right].ok);
  return { passed: failed.length === 0, results, failed };
}

/**
 * Closed-loop eMAR controller.
 *
 * Holds no patient data of its own: every call is given the order, the patient and the
 * administration record it should act on. Persistence is wardsynq-store.js's job, not this file's.
 */
class MedicationAdministrationRecord {
  /**
   * @param {{bus?: object, safetyCheck?: Function, highAlertDrugs?: string[], windowMinutes?: number}} [deps]
   *   bus            ClinicalEventBus instance (optional; no bus means no events, same state machine)
   *   safetyCheck    async|sync (ctx) => {allowed, blocks, warnings}. Defaults to fail-closed.
   *   highAlertDrugs product names/codes requiring a second-nurse witness (insulin, heparin, opioids
   *                  and the like). The LIST is configuration, not clinical logic; it belongs to the
   *                  hospital formulary, which is why it is injected rather than hardcoded here.
   */
  constructor(deps) {
    deps = deps || {};
    this.bus = deps.bus || null;
    this.safetyCheck = deps.safetyCheck || denyWithoutSafetyEngine;
    this.highAlertDrugs = (deps.highAlertDrugs || []).map((d) => String(d).toUpperCase());
    this.windowMinutes = deps.windowMinutes ?? 60;
    this.allowLate = deps.allowLate === true;
  }

  /** Creates a fresh administration record in ORDERED for a given order. */
  open(order) {
    if (!order || !order.id) throw new TypeError("open() needs a MedicationOrder with an id");
    const record = MedicationAdministration({
      orderId: order.id,
      patientId: order.patientId,
      // Carried on the record so it survives independently of the order, and so the emitted
      // administration event says what was given rather than only which order it belonged to.
      drug: order.drug || null,
      drugCode: order.drugCode || null,
      status: STATES.ORDERED,
      // Codex F2/F3: the order version every check on this dose is bound to, and what that version said.
      orderVersion: order.version != null ? order.version : null,
      orderSnapshot: orderSnapshot(order),
    });
    record.audit = [{ at: nowIso(), from: null, to: STATES.ORDERED, actorId: order.prescriberId || null, reason: null }];
    return record;
  }

  /**
   * Codex F3: the order was amended in a clinically material way since this dose's checks. The checks are void: the
   * record goes back to ORDERED, bound to the order as it is now, with the scan and its findings cleared, so it must be
   * verified, dispensed and scanned again. Not a transition in ALLOWED on purpose: it is never a step a person chooses,
   * only what an amendment does to the checks. A terminal record is history and is never touched. Returns the changes
   * (empty when nothing material changed, and nothing is done).
   */
  invalidateForAmendedOrder(record, order, actorId) {
    if (!record || TERMINAL.includes(record.status)) return [];
    const changes = materialOrderChanges(record.orderSnapshot, order);
    if (!changes.length) return [];
    const from = record.status;
    const was = record.orderSnapshot && record.orderSnapshot.version;
    for (const f of ["scannedPatientBarcode", "scannedDrugBarcode", "dose", "route"]) record[f] = null;
    delete record.safetyWarnings; delete record.safetyNotRun;
    record.status = STATES.ORDERED;
    record.orderVersion = order.version != null ? order.version : null;
    record.orderSnapshot = orderSnapshot(order);
    record.audit = record.audit || [];
    record.audit.push({ at: nowIso(), from, to: STATES.ORDERED, actorId: actorId || null,
      reason: `order amended (version ${was == null ? "unknown" : was} to ${record.orderVersion == null ? "unknown" : record.orderVersion}: ${changes.join(", ")}); verification, dispensing and the bedside scan must be done again` });
    return changes;
  }

  isHighAlert(order) {
    const drug = String(order && (order.drugCode || order.drug) || "").toUpperCase();
    return this.highAlertDrugs.some((flagged) => drug.includes(flagged));
  }

  /**
   * Applies a state transition after validating it is legal.
   * @param {object} record MedicationAdministration
   * @param {string} to target state
   * @param {{actorId?: string, reason?: string, patch?: object}} [ctx]
   */
  async transition(record, to, ctx) {
    ctx = ctx || {};
    const from = record.status;
    const legal = ALLOWED[from];
    if (!legal) throw new MedicationSafetyError(`unknown state "${from}"`, [{ code: "UNKNOWN_STATE" }]);
    if (!legal.includes(to)) {
      throw new MedicationSafetyError(
        `illegal transition ${from} -> ${to}`,
        [{ code: "ILLEGAL_TRANSITION", message: `${from} may only move to ${legal.join(", ") || "nothing (terminal)"}` }],
      );
    }
    Object.assign(record, ctx.patch || {});
    record.status = to;
    record.audit = record.audit || [];
    record.audit.push({ at: nowIso(), from, to, actorId: ctx.actorId || null, reason: ctx.reason || null });
    if (this.bus) await this.bus.emit(`meds.${to}`, { record, from, actorId: ctx.actorId || null });
    return record;
  }

  /* Every mutation below is async, including the ones whose guard clause fails immediately. A
   * refusal must always arrive as a rejected promise: a caller writing
   * `emar.hold(...).catch(showToNurse)` would otherwise get an uncaught synchronous throw for
   * exactly the inputs the guard exists to catch. */

  /** Pharmacist verification of the order. */
  async verify(record, pharmacistId) {
    if (!pharmacistId) throw new MedicationSafetyError("verification needs a pharmacist id", [{ code: "NO_ACTOR" }]);
    return this.transition(record, STATES.VERIFIED, { actorId: pharmacistId });
  }

  /** Pharmacy releases the unit dose to the ward. */
  async dispense(record, actorId) {
    return this.transition(record, STATES.DISPENSED, { actorId });
  }

  /**
   * Bedside scan. Runs the five rights, then the injected clinical safety engine. Both must pass:
   * a workflow gate cannot excuse a clinical block, and a clean clinical check cannot excuse a
   * failed scan. A failure emits `meds.blocked` and leaves the record where it was.
   *
   * @param {object} record
   * @param {{order: object, patient: object, scan: object, nurseId: string}} input
   */
  async scan(record, input) {
    const { order, patient, scan, nurseId } = input || {};
    if (!order || !patient || !nurseId) {
      throw new MedicationSafetyError("scan() needs order, patient and nurseId", [{ code: "MISSING_INPUT" }]);
    }

    // Codex F3: a dose verified and dispensed under one order is not scanned against another.
    const changed = materialOrderChanges(record.orderSnapshot, order);
    if (changed.length) {
      const reasons = orderChangedReasons(record, order, changed);
      await this._block(record, reasons, nurseId);
      throw new MedicationSafetyError("order changed since this dose was checked", reasons);
    }

    const rights = checkFiveRights(order, scan, patient, { windowMinutes: this.windowMinutes, allowLate: this.allowLate });
    if (!rights.passed) {
      const reasons = rights.failed.map((right) => ({
        code: `FIVE_RIGHTS_${right.toUpperCase()}`,
        message: `right ${right} failed: ${rights.results[right].detail}`,
      }));
      await this._block(record, reasons, nurseId);
      throw new MedicationSafetyError(`5-rights check failed: ${rights.failed.join(", ")}`, reasons);
    }

    const verdict = await this.safetyCheck({ order, patient, record, scan, phase: "pre-administration" });
    if (!verdict || verdict.allowed !== true) {
      const reasons = (verdict && verdict.blocks) || [{ code: "SAFETY_REFUSED", message: "safety engine refused" }];
      await this._block(record, reasons, nurseId);
      throw new MedicationSafetyError("clinical safety engine blocked this dose", reasons);
    }

    return this.transition(record, STATES.SCANNED, {
      actorId: nurseId,
      patch: {
        scannedPatientBarcode: scan.patientBarcode,
        scannedDrugBarcode: scan.drugBarcode,
        // Codex F2: the dose and route that passed the five rights, kept on the record rather than dropped. They are
        // what is given; the order may change later, this record does not.
        dose: { value: Number(scan.dose.value), unit: String(scan.dose.unit) },
        route: String(scan.route),
        orderVersion: order.version != null ? order.version : record.orderVersion ?? null,
        safetyWarnings: verdict.warnings || [],
        // Codex F5: the clinical check did not run and a named clinician continued with a reason.
        ...(verdict.notRun ? { safetyNotRun: verdict.notRun } : {}),
      },
    });
  }

  /**
   * Gives the dose. Only reachable from SCANNED, so a dose can never be recorded as given without
   * a bedside scan having passed first. High-alert products additionally require a second nurse.
   */
  async administer(record, input) {
    const { order, nurseId, witnessId } = input || {};
    if (!nurseId) throw new MedicationSafetyError("administer() needs nurseId", [{ code: "NO_ACTOR" }]);
    /* Codex F3: the order the dose is given against is required, and it must still be the order the dose was verified,
     * dispensed and scanned under. Whatever version a caller says it saw, a clinically material amendment since the
     * checks refuses here and the dose has to be checked again. */
    if (!order) throw new MedicationSafetyError("administer() needs the order", [{ code: "ORDER_REQUIRED" }]);
    const changed = materialOrderChanges(record.orderSnapshot, order);
    if (changed.length) {
      const reasons = orderChangedReasons(record, order, changed);
      await this._block(record, reasons, nurseId);
      throw new MedicationSafetyError("order changed since this dose was checked", reasons);
    }
    if (order && this.isHighAlert(order)) {
      if (!witnessId) {
        const reasons = [{ code: "WITNESS_REQUIRED", message: "high-alert medication requires a second nurse witness" }];
        await this._block(record, reasons, nurseId);
        throw new MedicationSafetyError("second nurse witness required", reasons);
      }
      if (witnessId === nurseId) {
        const reasons = [{ code: "WITNESS_NOT_INDEPENDENT", message: "witness must be a different clinician" }];
        await this._block(record, reasons, nurseId);
        throw new MedicationSafetyError("witness must differ from administering nurse", reasons);
      }
    }
    return this.transition(record, STATES.ADMINISTERED, {
      actorId: nurseId,
      patch: { administeredBy: nurseId, witnessedBy: witnessId || null, administeredAt: nowIso(),
        // Codex F2: the version in force when it was given. Materially the snapshot's (checked above); fixed from here on.
        orderVersion: order.version != null ? order.version : record.orderVersion ?? null },
    });
  }

  /** Withholds this dose. A reason is mandatory: an unexplained hold is not a clinical record. */
  async hold(record, actorId, reason) {
    if (!reason) throw new MedicationSafetyError("hold() needs a reason", [{ code: "NO_REASON" }]);
    return this.transition(record, STATES.HELD, { actorId, reason, patch: { holdReason: reason } });
  }

  /** Patient declined the dose. */
  async refuse(record, actorId, reason) {
    return this.transition(record, STATES.REFUSED, { actorId, reason: reason || "patient declined" });
  }

  /** Order pulled before administration. */
  async cancel(record, actorId, reason) {
    return this.transition(record, STATES.CANCELLED, { actorId, reason: reason || null });
  }

  async _block(record, reasons, actorId) {
    record.audit = record.audit || [];
    record.audit.push({ at: nowIso(), from: record.status, to: record.status, actorId: actorId || null, reason: "blocked", blocks: reasons });
    if (this.bus) await this.bus.emit("meds.blocked", { record, reasons, actorId: actorId || null });
  }
}

export {
  STATES,
  TERMINAL,
  ALLOWED,
  FIVE_RIGHTS,
  MedicationSafetyError,
  MedicationAdministrationRecord,
  checkFiveRights,
  denyWithoutSafetyEngine,
  MATERIAL_ORDER_FIELDS,
  orderSnapshot,
  materialOrderChanges,
};
