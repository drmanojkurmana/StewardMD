/* wardsynq/ui/opd-emr.js — the bedside surface's logic.
 *
 * The mobile surface exists to do the things that only happen at a bedside: confirm you are at the
 * right patient, scan a dose, administer it, and record what you saw. Everything else belongs on the
 * workstation, and leaving it out is a decision rather than an omission.
 *
 * THE RULE THIS FILE IS BUILT AROUND. A phone at a bedside is the single most likely place for a
 * wrong-patient action, because the person holding it is standing in front of one patient while the
 * screen shows whichever one it was last showing. So:
 *
 *   1. THE ACTIVE PATIENT IS A SESSION BINDING, NOT A VARIABLE. Every write goes through the
 *      GovernedStore's session, which refuses a write aimed at a different chart. Changing patient
 *      rebinds the session; it does not merely repaint the header.
 *   2. NOTHING IS ENABLED UNTIL IDENTITY IS CONFIRMED AT THE BEDSIDE. Not greyed with a tooltip:
 *      the actions do not work, and the header says why. A UI field existing is never what makes an
 *      action legal, and the store would refuse it anyway. Both, deliberately.
 *   3. THE UI NEVER DECIDES CLINICAL SAFETY. It calls the engine and renders what comes back. There
 *      is no threshold, no dose limit and no interaction rule in this file, and there must never be
 *      one: a rule duplicated here would drift from the engine and the drift would be invisible.
 *   4. A REFUSAL IS RENDERED IN FULL, INCLUDING THE PART THE NURSE CANNOT ACT ON. Truncating a
 *      refusal to fit a phone is how "blocked" becomes "the app is broken".
 *   5. OFFLINE IS A NORMAL STATE. A ward has a basement. Work is journalled durably before the UI
 *      says it was recorded, and the screen says plainly that it is held on this device.
 *
 * NOT DONE HERE: no route into the mobile app, no service worker, no barcode hardware. Scans are
 * supplied values, which is exactly what the eMAR tests already assume.
 *
 * STATUS: IMPLEMENTED and TESTED (test/wardsynq-opd.test.mjs exercises the logic, headless).
 */

import { MedicationAdministrationRecord, STATES } from "../wardsynq-meds.js";
import { OfflineJournal, MemoryJournalBackend } from "../wardsynq-offline.js";

/** What the bedside can be doing. A small, closed set: this surface is deliberately narrow. */
const MODE = Object.freeze({
  IDENTIFY: "identify",       // no confirmed patient in front of us
  CHART: "chart",             // identity confirmed, viewing
  ADMINISTER: "administer",   // a specific dose, mid-scan
});

class OpdError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OpdError";
    this.code = code || "OPD_VIOLATION";
  }
}

/**
 * The bedside session.
 *
 * Holds no clinical rules. It holds a patient binding, a scan state, and a journal, and it asks
 * other modules every question that has a clinical answer.
 *
 * @param {{store: object, actor: object, emar?: object, journal?: object, now?: () => string,
 *   online?: () => boolean}} deps
 */
class BedsideSession {
  constructor({ store, actor, emar, journal, now, online } = {}) {
    if (!store) throw new OpdError("the bedside works through a governed store, never a raw one", "NO_STORE");
    if (!actor) throw new OpdError("every bedside action names the clinician taking it", "NO_ACTOR");
    this.store = store;
    this.actor = actor;
    this.now = now || (() => new Date().toISOString());
    this.online = online || (() => true);
    this.emar = emar || null;
    this.journal = journal || new OfflineJournal({ backend: new MemoryJournalBackend(), now: this.now });

    this.mode = MODE.IDENTIFY;
    this.patient = null;
    this.identityConfirmed = false;
    this.session = null;
    this.refusals = [];
  }

  /**
   * Opens a patient. This is a BINDING: the store session is rebound, so a write aimed at another
   * chart is refused by the store and not merely discouraged by the screen.
   */
  open(patient) {
    if (!patient || !patient.id) throw new OpdError("a bedside session needs a patient", "NO_PATIENT");
    this.patient = patient;
    // Identity is confirmed by scanning the band in front of you, not by opening a record. Opening
    // a chart is something you can do from the corridor.
    this.identityConfirmed = false;
    this.mode = MODE.IDENTIFY;
    this.session = this.store.session(this.actor, patient.id);
    return this.state();
  }

  /**
   * Confirms identity by wristband. The scanned value must match the band on THIS patient.
   *
   * Returns a result rather than throwing, because a failed identity check is an ordinary event at a
   * bedside (the band is under a blanket, the scanner misreads) and an exception would be rendered
   * as an error rather than as an instruction.
   */
  confirmIdentity(scannedBarcode) {
    if (!this.patient) throw new OpdError("no patient is open", "NO_PATIENT");
    const expected = this.patient.wristbandBarcode || this.patient.mrn;
    const ok = !!scannedBarcode && !!expected && String(scannedBarcode).trim() === String(expected).trim();

    this.identityConfirmed = ok;
    this.mode = ok ? MODE.CHART : MODE.IDENTIFY;
    return {
      ok,
      at: this.now(),
      reason: ok ? null
        : !scannedBarcode ? "No wristband was scanned. Scan the band on the patient in front of you."
          : "The scanned band does not match this chart. Do not proceed: either the wrong chart is open or you are at the wrong patient.",
    };
  }

  /** What the screen should render. Pure, so the UI has no state of its own to drift. */
  state() {
    return {
      mode: this.mode,
      patient: this.patient ? { id: this.patient.id, name: this.patient.name, mrn: this.patient.mrn } : null,
      identityConfirmed: this.identityConfirmed,
      // The single flag every action is gated on. Rendered on the header, not buried.
      actionsEnabled: this.identityConfirmed === true,
      online: this.online(),
      heldOnDevice: this.journal.pending ? this.journal.pending().length : 0,
      refusals: this.refusals.slice(),
    };
  }

  /**
   * Administers a dose.
   *
   * Every clinical decision in here belongs to another module: the eMAR owns the state machine and
   * the five rights, the safety engine owns whether the dose is safe, and the governed store owns
   * whether this actor may write it. This method sequences them and renders the answer.
   */
  async administer({ record, order, scan, witnessId } = {}) {
    if (!this.identityConfirmed) {
      // Not a disabled button. The action itself refuses, because a UI field existing is never what
      // makes an action legal.
      return this._refuse("IDENTITY_NOT_CONFIRMED",
        "Identity has not been confirmed at the bedside. Scan the patient's wristband before giving anything.");
    }
    if (!this.emar) throw new OpdError("no eMAR is wired to this session", "NO_EMAR");
    if (!record || !order) throw new OpdError("administering needs the order and its administration record", "NO_RECORD");

    let scanned;
    try {
      scanned = await this.emar.scan(record, { order, patient: this.patient, nurseId: this.actor.id, scan });
    } catch (err) {
      // The five-rights failure, rendered IN FULL. Truncating it to fit a phone is how "blocked"
      // becomes "the app is broken" and then becomes a workaround.
      return this._refuse("FIVE_RIGHTS", err.message, err.reasons || []);
    }

    let given;
    try {
      given = await this.emar.administer(scanned, { order, nurseId: this.actor.id, witnessId });
    } catch (err) {
      return this._refuse("ADMINISTRATION_BLOCKED", err.message, err.reasons || []);
    }

    // Durable before the screen says it happened. If the ward is offline the journal holds it and
    // the state says so; what must never happen is the UI reporting success over a lost write.
    const persisted = await this._persist({ resourceType: "MedicationAdministration", ...given });
    return {
      ok: true,
      record: given,
      state: given.status,
      administeredAt: given.administeredAt,
      persistence: persisted,
      note: persisted.heldOnDevice
        ? "Recorded and held on this device. It will reach the chart when this ward is back online."
        : null,
    };
  }

  /** Records an observation taken at the bedside. */
  async recordObservation(observation) {
    if (!this.identityConfirmed) {
      return this._refuse("IDENTITY_NOT_CONFIRMED", "Confirm the patient's wristband before recording anything against this chart.");
    }
    return this._persist(observation);
  }

  /**
   * Writes through the governed session, falling back to the durable journal when offline.
   *
   * The order matters: the journal resolves only once the write is durable, so the caller cannot
   * report success over a write that is still in memory.
   */
  async _persist(entity) {
    if (this.online()) {
      try {
        const written = await this.session.put(entity);
        return { written: true, heldOnDevice: false, entity: written };
      } catch (err) {
        // A governance refusal is not a connectivity problem and must not be journalled as one:
        // journalling it would retry a write the system has already decided is not allowed.
        return this._refuse("GOVERNANCE", err.message, err.reasons || []);
      }
    }
    // The journal's own contract: the entity itself, the version it was derived from, and who made
    // the edit. `base` is null for something created at the bedside, and that is a real answer
    // rather than a missing one: there is no prior version to three-way merge against, so the
    // reconciler treats it as a creation instead of guessing at an ancestor.
    const base = await this._baseFor(entity);
    await this.journal.record(entity, base, this.actor.id);
    return { written: false, heldOnDevice: true, entity };
  }

  /** The version this edit was derived from, or null where it is new. */
  async _baseFor(entity) {
    if (!entity || !entity.id || typeof this.store.get !== "function") return null;
    try {
      const existing = await this.store.get(entity.resourceType, entity.id);
      return existing || null;
    } catch {
      return null;
    }
  }

  _refuse(code, message, reasons = []) {
    const refusal = { code, message, reasons, at: this.now() };
    this.refusals.push(refusal);
    return { ok: false, refusal };
  }

  /** Dismissing a refusal is an explicit act, because a refusal that fades was never read. */
  acknowledgeRefusal(index) {
    this.refusals.splice(index, 1);
    return this.state();
  }
}

/**
 * Turns anything the bedside shows into a row the CSS can render.
 *
 * The signal word is mandatory and is derived here rather than in a template, so no view can render
 * a coloured row with no word in it. Colour is never the only carrier of meaning.
 */
function toRow({ signal, label, value, unit, detail }) {
  const word = { stop: "STOP", major: "CHECK", watch: "WATCH", clear: "OK" }[signal] || null;
  if (signal && !word) throw new OpdError(`unknown signal "${signal}"`, "BAD_SIGNAL");
  return {
    signal: signal || null,
    signalWord: word,
    label,
    value: value === undefined || value === null ? null : String(value),
    unit: unit || null,
    detail: detail || null,
  };
}

export { MODE, OpdError, BedsideSession, toRow };
