/* wardsynq/wardsynq-transfusion.js — transfusion compatibility and bedside control. HAZ-BLD-01.
 *
 * An ABO-incompatible red cell transfusion kills people in minutes, and it is almost never caused by
 * a laboratory error. It is caused by the right unit reaching the wrong patient: a mislabelled
 * sample, a unit collected for the patient in the next bed, a bedside check performed by one person
 * in a hurry. So this module spends nearly all of its effort on IDENTITY and on the bedside, not on
 * the serology.
 *
 *   request -> sample and group -> crossmatch bound to ONE patient -> unit issued
 *           -> independent two-person bedside check -> administration -> observations
 *           -> reaction handling -> immutable traceability
 *
 * WHY THE COMPATIBILITY RULES ARE IN CODE AND THE DRUG THRESHOLDS ARE NOT. ABO compatibility is
 * immutable biology, identical in every hospital on earth, so a site cannot be permitted to
 * configure it. Everything genuinely local, such as whether D-positive units may be issued to a
 * D-negative man in an emergency, is policy and is injected.
 *
 * PLASMA IS THE INVERSE OF RED CELLS. An AB patient is the universal RED CELL recipient and the
 * universal PLASMA donor; group O is the reverse. A single table used for both components would be
 * lethal in one direction and is the reason component type is required rather than defaulted.
 *
 * NOT MODELLED, and each of these is a real part of transfusion practice: antibody screening and
 * identification beyond ABO and RhD, phenotype matching, special requirements such as irradiated,
 * washed or CMV-negative components, massive transfusion and emergency uncrossmatched protocols,
 * neonatal transfusion, and platelet or cryoprecipitate specific rules. A site must not infer that
 * a unit this module permits is a unit its blood bank would issue.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-transfusion.test.mjs
 */

/** Where a unit is in its journey. Forward only. */
const PHASE = Object.freeze({
  REQUESTED: "requested",
  CROSSMATCHED: "crossmatched",
  ISSUED: "issued",
  CHECKED: "checked",           // two-person bedside verification passed
  TRANSFUSING: "transfusing",
  COMPLETED: "completed",
  STOPPED: "stopped",           // terminal: reaction or abandonment
});

const ORDER = Object.freeze([PHASE.REQUESTED, PHASE.CROSSMATCHED, PHASE.ISSUED, PHASE.CHECKED, PHASE.TRANSFUSING, PHASE.COMPLETED]);

const ABO = Object.freeze(["O", "A", "B", "AB"]);
const RHD = Object.freeze(["positive", "negative"]);

/**
 * Who may receive whose red cells. Recipient group -> acceptable donor groups.
 * O is the universal red cell donor; AB the universal red cell recipient.
 */
const RED_CELL_COMPATIBILITY = Object.freeze({
  O: Object.freeze(["O"]),
  A: Object.freeze(["A", "O"]),
  B: Object.freeze(["B", "O"]),
  AB: Object.freeze(["AB", "A", "B", "O"]),
});

/**
 * Plasma runs the other way, because plasma carries antibodies rather than antigens.
 * AB is the universal plasma donor; O the universal plasma recipient.
 */
const PLASMA_COMPATIBILITY = Object.freeze({
  O: Object.freeze(["O", "A", "B", "AB"]),
  A: Object.freeze(["A", "AB"]),
  B: Object.freeze(["B", "AB"]),
  AB: Object.freeze(["AB"]),
});

/** Component classes this module knows how to reason about. Anything else is refused, not guessed. */
const COMPONENT = Object.freeze({
  RED_CELLS: "red-cells",
  PLASMA: "plasma",
  PLATELETS: "platelets",
});

class TransfusionSafetyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TransfusionSafetyError";
    this.code = code || "TRANSFUSION_VIOLATION";
  }
}

const up = (v) => (typeof v === "string" ? v.trim().toUpperCase() : "");
const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * Serological compatibility of one unit for one patient.
 *
 * Returns a verdict rather than throwing, so a caller can show WHY a unit is unusable. An unknown
 * group on either side is incompatible, never "probably fine": a patient whose group has not been
 * determined has no compatible unit except by an emergency protocol this module does not implement.
 *
 * @returns {{compatible: boolean, reasons: {code, message}[], abo: string, rhd: string}}
 */
function checkCompatibility(patient, unit, opts) {
  opts = opts || {};
  const reasons = [];
  const pAbo = up(patient && patient.aboGroup);
  const uAbo = up(unit && unit.aboGroup);
  const pRh = low(patient && patient.rhD);
  const uRh = low(unit && unit.rhD);
  const component = low(unit && unit.component);

  if (!ABO.includes(pAbo)) reasons.push({ code: "PATIENT_GROUP_UNKNOWN", message: "the patient's ABO group is not determined" });
  if (!ABO.includes(uAbo)) reasons.push({ code: "UNIT_GROUP_UNKNOWN", message: "the unit's ABO group is not recorded" });

  const table = component === COMPONENT.RED_CELLS ? RED_CELL_COMPATIBILITY
    : component === COMPONENT.PLASMA ? PLASMA_COMPATIBILITY
      : null;
  if (!table) {
    // Platelets and anything else: this module will not guess a compatibility direction.
    reasons.push({ code: "COMPONENT_NOT_SUPPORTED", message: `compatibility for component "${unit && unit.component}" is not modelled here and must be determined by the blood bank` });
  }

  if (table && ABO.includes(pAbo) && ABO.includes(uAbo) && !table[pAbo].includes(uAbo)) {
    reasons.push({
      code: "ABO_INCOMPATIBLE",
      message: `${component === COMPONENT.PLASMA ? "plasma" : "red cells"} of group ${uAbo} must never be given to a group ${pAbo} patient`,
    });
  }

  // RhD. A D-negative patient given D-positive cells risks alloimmunisation, which matters most for
  // anyone who could become pregnant. Whether that is ever acceptable is site policy, so it is
  // reported as a distinct reason and the caller's policy decides, but it defaults to blocking.
  if (component === COMPONENT.RED_CELLS && pRh === "negative" && uRh === "positive") {
    if (!opts.allowRhDPositiveToNegative) {
      reasons.push({ code: "RHD_MISMATCH", message: "a D-negative patient must not receive D-positive red cells without an explicit blood bank policy decision" });
    }
  }
  if (component === COMPONENT.RED_CELLS && !RHD.includes(pRh)) {
    reasons.push({ code: "PATIENT_RHD_UNKNOWN", message: "the patient's RhD type is not determined" });
  }

  return { compatible: reasons.length === 0, reasons, abo: `${uAbo || "?"} to ${pAbo || "?"}`, rhd: `${uRh || "?"} to ${pRh || "?"}` };
}

/* ------------------------------------------------------------------ the episode */

class TransfusionEpisode {
  /** @param {{now?: () => string, bus?: object, store?: object, policy?: object}} deps */
  constructor(deps) {
    deps = deps || {};
    this.now = deps.now || (() => new Date().toISOString());
    this.bus = deps.bus || null;
    this.store = deps.store || null;
    this.policy = deps.policy || {};
  }

  _record(ep, event, actorId, detail) {
    ep.ledger.push(Object.freeze({ at: this.now(), event, actorId: actorId || null, detail: detail || null }));
  }

  async _emit(type, payload) { if (this.bus) await this.bus.emit(type, payload); }
  async _persist(ep) { if (this.store) await this.store.put({ resourceType: "TransfusionEpisode", ...ep }); }

  /** Opens a request for a named patient. Nothing downstream may change whose it is. */
  async request(patient, spec, requesterId) {
    if (!patient || !patient.id) throw new TransfusionSafetyError("a transfusion request needs an identified patient", "NO_PATIENT");
    if (!requesterId) throw new TransfusionSafetyError("a transfusion request must name its requester", "NO_ACTOR");
    const ep = {
      id: `txn-${patient.id}-${Date.now().toString(36)}`,
      patientId: patient.id,
      patientMrn: patient.mrn,
      patientAbo: up(patient.aboGroup) || null,
      patientRhD: low(patient.rhD) || null,
      component: low(spec && spec.component) || null,
      unitsRequested: (spec && spec.units) || 1,
      indication: (spec && spec.indication) || null,
      phase: PHASE.REQUESTED,
      crossmatch: null,
      unit: null,
      bedsideCheck: null,
      startedAt: null,
      completedAt: null,
      observations: [],
      reaction: null,
      ledger: [],
    };
    this._record(ep, "requested", requesterId, `${ep.unitsRequested} x ${ep.component || "unspecified component"}${ep.indication ? ` for ${ep.indication}` : ""}`);
    await this._persist(ep);
    await this._emit("transfusion.requested", { episode: this._view(ep) });
    return ep;
  }

  /**
   * Records a crossmatch. The crossmatch BINDS a unit to one patient: this is the single most
   * important record in the chain, because every later check compares against it.
   */
  async crossmatch(ep, unit, scientistId) {
    this._assertLive(ep);
    if (!scientistId) throw new TransfusionSafetyError("a crossmatch must name the scientist who performed it", "NO_ACTOR");
    if (!unit || !unit.unitId) throw new TransfusionSafetyError("a crossmatch needs an identified unit", "NO_UNIT");

    const verdict = checkCompatibility(
      { aboGroup: ep.patientAbo, rhD: ep.patientRhD },
      unit,
      { allowRhDPositiveToNegative: !!this.policy.allowRhDPositiveToNegative },
    );
    if (!verdict.compatible) {
      this._record(ep, "crossmatch-failed", scientistId, verdict.reasons.map((r) => r.code).join(", "));
      await this._persist(ep);
      await this._emit("transfusion.crossmatch.failed", { episode: this._view(ep), verdict });
      throw new TransfusionSafetyError(`unit ${unit.unitId} is not compatible: ${verdict.reasons.map((r) => r.message).join("; ")}`, "INCOMPATIBLE");
    }

    ep.crossmatch = {
      unitId: unit.unitId,
      forPatientId: ep.patientId,   // the binding
      forPatientMrn: ep.patientMrn,
      aboGroup: up(unit.aboGroup),
      rhD: low(unit.rhD),
      component: low(unit.component),
      expiresAt: unit.expiresAt || null,
      by: scientistId,
      at: this.now(),
      verdict,
    };
    ep.unit = { ...unit };
    ep.phase = PHASE.CROSSMATCHED;
    this._record(ep, "crossmatched", scientistId, `unit ${unit.unitId} ${verdict.abo}`);
    await this._persist(ep);
    await this._emit("transfusion.crossmatched", { episode: this._view(ep) });
    return ep;
  }

  /** The blood bank issues the crossmatched unit to the ward. */
  async issue(ep, actorId) {
    this._assertLive(ep);
    if (ep.phase !== PHASE.CROSSMATCHED) throw new TransfusionSafetyError("only a crossmatched unit may be issued", "NOT_CROSSMATCHED");
    ep.phase = PHASE.ISSUED;
    this._record(ep, "issued", actorId, `unit ${ep.crossmatch.unitId}`);
    await this._persist(ep);
    await this._emit("transfusion.issued", { episode: this._view(ep) });
    return ep;
  }

  /**
   * The bedside check. This is where the hazard actually lives, so this method is the strictest in
   * the module. It requires TWO named people who are not the same person, a scanned patient
   * wristband, a scanned unit, and it re-derives compatibility from scratch rather than trusting the
   * crossmatch record: if the unit in the nurse's hand is not the unit on the paperwork, the
   * paperwork is exactly what must not be believed.
   */
  async bedsideCheck(ep, check) {
    this._assertLive(ep);
    check = check || {};
    if (ep.phase !== PHASE.ISSUED) throw new TransfusionSafetyError("the bedside check happens after the unit is issued", "NOT_ISSUED");

    const { checkerId, secondCheckerId, scannedPatientBarcode, scannedUnitId, patient, unitInHand } = check;
    if (!checkerId || !secondCheckerId) {
      throw new TransfusionSafetyError("two people must perform the bedside check", "TWO_PERSON_REQUIRED");
    }
    if (checkerId === secondCheckerId) {
      throw new TransfusionSafetyError("the second check must be performed by a different person", "SECOND_CHECKER_NOT_INDEPENDENT");
    }

    const failures = [];
    const bandOk = scannedPatientBarcode && patient
      && up(scannedPatientBarcode) === up(patient.wristbandBarcode || patient.mrn)
      && patient.id === ep.patientId;
    if (!bandOk) failures.push({ code: "PATIENT_IDENTITY", message: "the scanned wristband does not match the patient this unit was crossmatched for" });

    if (!scannedUnitId || up(scannedUnitId) !== up(ep.crossmatch.unitId)) {
      failures.push({ code: "WRONG_UNIT", message: `the unit at the bedside (${scannedUnitId || "not scanned"}) is not the unit crossmatched for this patient (${ep.crossmatch.unitId})` });
    }

    // Re-derive compatibility from the physical unit, not from the crossmatch record.
    if (unitInHand) {
      const verdict = checkCompatibility(
        { aboGroup: ep.patientAbo, rhD: ep.patientRhD },
        unitInHand,
        { allowRhDPositiveToNegative: !!this.policy.allowRhDPositiveToNegative },
      );
      if (!verdict.compatible) failures.push(...verdict.reasons);
    } else {
      failures.push({ code: "UNIT_NOT_READ", message: "the unit's own label was not read at the bedside" });
    }

    const expiry = ep.crossmatch.expiresAt;
    if (expiry && Date.parse(expiry) <= Date.parse(this.now())) {
      failures.push({ code: "UNIT_EXPIRED", message: `unit ${ep.crossmatch.unitId} expired at ${expiry}` });
    }

    if (failures.length) {
      this._record(ep, "bedside-check-failed", checkerId, failures.map((f) => f.code).join(", "));
      await this._persist(ep);
      await this._emit("transfusion.check.failed", { episode: this._view(ep), failures });
      throw new TransfusionSafetyError(`bedside check failed: ${failures.map((f) => f.message).join("; ")}`, failures[0].code);
    }

    ep.bedsideCheck = { checkerId, secondCheckerId, at: this.now(), scannedPatientBarcode, scannedUnitId };
    ep.phase = PHASE.CHECKED;
    this._record(ep, "bedside-check-passed", checkerId, `witnessed by ${secondCheckerId}`);
    await this._persist(ep);
    await this._emit("transfusion.checked", { episode: this._view(ep) });
    return ep;
  }

  /** Starts the transfusion. Only ever reachable from a passed two-person bedside check. */
  async start(ep, actorId) {
    this._assertLive(ep);
    if (ep.phase !== PHASE.CHECKED) throw new TransfusionSafetyError("a transfusion may only start after a passed bedside check", "NOT_CHECKED");
    if (!actorId) throw new TransfusionSafetyError("starting a transfusion must name the clinician", "NO_ACTOR");
    ep.phase = PHASE.TRANSFUSING;
    ep.startedAt = this.now();
    this._record(ep, "started", actorId, `unit ${ep.crossmatch.unitId}`);
    await this._persist(ep);
    await this._emit("transfusion.started", { episode: this._view(ep) });
    return ep;
  }

  /** Records a set of observations during the transfusion. */
  async observe(ep, actorId, vitals) {
    this._assertLive(ep); // a stopped episode must say it was STOPPED, not merely "not running"
    if (ep.phase !== PHASE.TRANSFUSING) throw new TransfusionSafetyError("observations belong to a running transfusion", "NOT_RUNNING");
    if (!actorId) throw new TransfusionSafetyError("observations must name who took them", "NO_ACTOR");
    const entry = { at: this.now(), by: actorId, ...vitals };
    ep.observations.push(entry);
    this._record(ep, "observed", actorId, Object.entries(vitals || {}).map(([k, v]) => `${k} ${v}`).join(", "));
    await this._persist(ep);
    return entry;
  }

  /**
   * A suspected reaction. Stops the transfusion immediately and terminally: there is deliberately no
   * "resume" on this episode, because deciding that a reaction was benign and restarting the same
   * unit is a clinical decision that must produce a new, separately checked episode.
   */
  async reaction(ep, actorId, detail) {
    this._assertLive(ep);
    if (ep.phase !== PHASE.TRANSFUSING) throw new TransfusionSafetyError("a reaction can only be recorded against a running transfusion", "NOT_RUNNING");
    if (!actorId) throw new TransfusionSafetyError("a reaction must name the clinician recording it", "NO_ACTOR");
    ep.reaction = { at: this.now(), by: actorId, detail: detail || null, unitId: ep.crossmatch.unitId };
    ep.phase = PHASE.STOPPED;
    this._record(ep, "reaction", actorId, detail || "suspected transfusion reaction");
    this._record(ep, "stopped", actorId, "transfusion stopped on suspected reaction");
    await this._persist(ep);
    await this._emit("transfusion.reaction", { episode: this._view(ep) });
    return ep;
  }

  /** Completes a transfusion that ran to its end without a reaction. */
  async complete(ep, actorId) {
    this._assertLive(ep);
    if (ep.phase !== PHASE.TRANSFUSING) throw new TransfusionSafetyError("only a running transfusion can complete", "NOT_RUNNING");
    if (!actorId) throw new TransfusionSafetyError("completion must name the clinician", "NO_ACTOR");
    ep.phase = PHASE.COMPLETED;
    ep.completedAt = this.now();
    this._record(ep, "completed", actorId, `unit ${ep.crossmatch.unitId}`);
    await this._persist(ep);
    await this._emit("transfusion.completed", { episode: this._view(ep) });
    return ep;
  }

  _assertLive(ep) {
    if (!ep || !ep.id) throw new TransfusionSafetyError("not a transfusion episode", "BAD_EPISODE");
    if (ep.phase === PHASE.COMPLETED) throw new TransfusionSafetyError("this transfusion is complete", "ALREADY_COMPLETED");
    if (ep.phase === PHASE.STOPPED) throw new TransfusionSafetyError("this transfusion was stopped and cannot be resumed", "STOPPED");
  }

  _view(ep) { return JSON.parse(JSON.stringify(ep)); }
}

/** Full traceability for one unit: who touched it, when, and what happened. */
function traceUnit(episodes, unitId) {
  return episodes
    .filter((e) => e.crossmatch && up(e.crossmatch.unitId) === up(unitId))
    .map((e) => ({
      episodeId: e.id, patientId: e.patientId, patientMrn: e.patientMrn,
      phase: e.phase, reaction: e.reaction || null, ledger: e.ledger,
    }));
}

export {
  PHASE, ORDER, ABO, RHD, COMPONENT,
  RED_CELL_COMPATIBILITY, PLASMA_COMPATIBILITY,
  TransfusionSafetyError, TransfusionEpisode,
  checkCompatibility, traceUnit,
};
