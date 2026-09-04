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
 * @param {{windowMinutes?: number}} [opts] how far from the scheduled time still counts as on time
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
    results.time = {
      ok: Number.isFinite(driftMinutes) && driftMinutes <= windowMinutes,
      detail: `drift ${Number.isFinite(driftMinutes) ? driftMinutes.toFixed(1) : "unknown"} min vs ${windowMinutes} min window`,
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
    });
    record.audit = [{ at: nowIso(), from: null, to: STATES.ORDERED, actorId: order.prescriberId || null, reason: null }];
    return record;
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

    const rights = checkFiveRights(order, scan, patient, { windowMinutes: this.windowMinutes });
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
        safetyWarnings: verdict.warnings || [],
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
      patch: { administeredBy: nurseId, witnessedBy: witnessId || null, administeredAt: nowIso() },
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
};
