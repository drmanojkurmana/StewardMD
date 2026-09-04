/* wardsynq/wardsynq-emergency.js — the time-critical bundles, where the clock is the control.
 *
 * The spec names this file: "Time-critical Code Blue, Code STEMI, and Code Sepsis resuscitation
 * state machines". What makes these different from every other workflow in the build is that the
 * dangerous variable is TIME. A sepsis bundle completed perfectly at four hours is a bundle that
 * did not work. So the object here is a clock with a checklist attached, not a checklist with a
 * timestamp attached, and almost every rule below exists to stop the clock being manipulated.
 *
 * THE FAILURE THIS FILE IS BUILT AGAINST. Bundle compliance is measured, reported and rewarded, so
 * it is gamed, and it is gamed in one specific way: TIME ZERO IS MOVED. A patient recognised at
 * 02:10 who gets antibiotics at 04:30 becomes compliant the moment somebody records recognition at
 * 03:45. The record then says the hospital did well and the patient still waited two and a half
 * hours. Every guard here is about that:
 *
 *   1. TIME ZERO IS SET ONCE AND CANNOT BE CHANGED. Not by an amendment, not by a correction, not by
 *      a supervisor. A genuinely wrong time zero is handled by voiding the bundle with a reason and
 *      opening a new one, which leaves both on the record.
 *   2. TIME ZERO CANNOT BE IN THE FUTURE, and it cannot be earlier than the evidence that triggered
 *      it. Back-dating in either direction is refused.
 *   3. A MISSED TARGET STAYS MISSED. There is no state that turns a breached bundle back into a
 *      compliant one, and the elapsed time is computed from the immutable origin every time rather
 *      than stored and updated.
 *   4. AN ELEMENT IS DONE WHEN IT IS DONE, NOT WHEN IT IS ORDERED. Antibiotics ordered at 40 minutes
 *      and hung at 3 hours is a three-hour bundle. Ordering and administration are separate events
 *      and the clock reads the second one.
 *
 * SCREENING IS NOT DIAGNOSIS. qSOFA and SIRS are screens with poor sensitivity, and their documented
 * harm is being used as a rule-out: a negative screen reading as "not septic" is how a septic patient
 * gets sent back to the ward. A negative screen here returns NOT_SCREENED_POSITIVE and says in words
 * that it does not exclude sepsis. Nothing in this file diagnoses anybody; a bundle is STARTED BY A
 * HUMAN, and a screen can only prompt one.
 *
 * WHAT THIS DOES NOT DO. It does not dose drugs, does not choose antibiotics, and does not instruct
 * anyone during a resuscitation. An arrest is run by the team leader and this records what happened
 * and when, and tells them what is due. A system that told a resuscitation team what to give, from
 * an unapproved table, during the two minutes where nobody has time to check it, would be the most
 * dangerous thing in this repository.
 *
 * NOT MODELLED: the ACLS algorithm itself (rhythm-specific pathways, defibrillation energies, drug
 * doses), STEMI ECG interpretation, transfer and cath-lab logistics, paediatric arrest, and any
 * local bundle definition beyond the ones seeded here.
 *
 * PROVENANCE: the bundle ELEMENTS and their targets are the widely published Surviving Sepsis
 * one-hour bundle and the standard ACLS cycle intervals. The local policy attached to them, which
 * escalation goes to whom and what a site counts as recognition, is UNAPPROVED.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-emergency.test.mjs
 */

import { Dispatcher, NotifyError } from "./wardsynq-notify.js";
import { ageBandOf, BAND } from "./wardsynq-paediatrics.js";

const CODE = Object.freeze({
  SEPSIS: "code-sepsis",
  BLUE: "code-blue",     // cardiac arrest
  STEMI: "code-stemi",
});

const BUNDLE_STATE = Object.freeze({
  RUNNING: "running",
  COMPLETE: "complete",     // every element done, whether or not inside its target
  BREACHED: "breached",     // at least one target passed with the element undone
  VOIDED: "voided",         // opened in error; never deleted, always superseded with a reason
});

/**
 * The bundles. `targetMinutes` is measured from time zero, and `doneOn` names the event that counts:
 * "administered" deliberately does not accept an order.
 */
const BUNDLES = Object.freeze({
  [CODE.SEPSIS]: {
    label: "Code Sepsis",
    // The Surviving Sepsis one-hour bundle. Widely published, not invented here; the local
    // escalation policy attached to it is a site decision and is not.
    elements: [
      { key: "lactate", label: "Measure lactate", targetMinutes: 60, doneOn: "resulted" },
      { key: "cultures", label: "Blood cultures BEFORE antibiotics", targetMinutes: 60, doneOn: "collected", beforeElement: "antibiotics" },
      { key: "antibiotics", label: "Broad-spectrum antibiotics", targetMinutes: 60, doneOn: "administered" },
      { key: "fluids", label: "Fluid resuscitation for hypotension or lactate >= 4", targetMinutes: 60, doneOn: "administered", conditional: true },
      { key: "vasopressors", label: "Vasopressors if hypotensive despite fluids", targetMinutes: 60, doneOn: "administered", conditional: true },
    ],
  },
  [CODE.STEMI]: {
    label: "Code STEMI",
    elements: [
      { key: "ecg", label: "12-lead ECG", targetMinutes: 10, doneOn: "resulted" },
      { key: "aspirin", label: "Aspirin", targetMinutes: 30, doneOn: "administered" },
      { key: "activation", label: "Cath lab activated", targetMinutes: 30, doneOn: "acknowledged" },
      { key: "reperfusion", label: "Device time (balloon) or thrombolysis", targetMinutes: 90, doneOn: "administered" },
    ],
  },
  [CODE.BLUE]: {
    label: "Code Blue",
    elements: [
      { key: "compressions", label: "Chest compressions started", targetMinutes: 1, doneOn: "started" },
      { key: "airway", label: "Airway secured", targetMinutes: 10, doneOn: "done" },
      { key: "rhythm", label: "First rhythm check", targetMinutes: 2, doneOn: "done" },
      { key: "access", label: "IV or IO access", targetMinutes: 5, doneOn: "done" },
    ],
  },
});

/** The ACLS cycle. Intervals only: this file tells the team what is DUE, never what to give. */
const ARREST_CYCLE = Object.freeze({
  rhythmCheckEveryMinutes: 2,
  adrenalineEveryMinutes: 4,   // the middle of the published 3 to 5 minute window
});

class EmergencyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "EmergencyError";
    this.code = code || "EMERGENCY_VIOLATION";
  }
}

/* ------------------------------------------------------------------ screening */

const SCREEN = Object.freeze({
  POSITIVE: "screen-positive",
  NOT_POSITIVE: "not-screen-positive", // deliberately NOT called "negative"
  UNSCREENABLE: "unscreenable",
});

/**
 * qSOFA: respiratory rate >= 22, altered mentation, systolic <= 100. Two of three is a positive
 * screen.
 *
 * The naming is the point. There is no NEGATIVE result, because qSOFA's sensitivity is poor and its
 * documented harm is being read as a rule-out. A patient who does not screen positive may still be
 * septic, and the result says so in a sentence a clinician will actually read.
 *
 * @returns {{result: string, score: number|null, criteria: object, excludesSepsis: false, reason: string}}
 */
function screenSepsis({ respiratoryRate, consciousness, systolicBloodPressure, patient } = {}) {
  const never = { excludesSepsis: false };

  if (patient) {
    const b = ageBandOf(patient);
    if (b.band !== BAND.ADULT) {
      return { ...never, result: SCREEN.UNSCREENABLE, score: null, criteria: {},
        reason: `qSOFA is an adult screen; this patient bands as ${b.band} and paediatric sepsis screening is not modelled here` };
    }
  }

  const acvpu = typeof consciousness === "string" ? consciousness.trim().toUpperCase() : null;
  const criteria = {
    respiratoryRate: typeof respiratoryRate === "number" ? respiratoryRate >= 22 : null,
    alteredMentation: acvpu ? acvpu !== "A" : null,
    hypotension: typeof systolicBloodPressure === "number" ? systolicBloodPressure <= 100 : null,
  };

  const answered = Object.values(criteria).filter((c) => c !== null);
  const met = answered.filter(Boolean).length;

  // A screen missing a criterion can still be POSITIVE if the ones present already reach two: the
  // absent one could only add. It can never be reported as not-positive, because the missing
  // criterion might have been the deciding one.
  if (met >= 2) {
    return { ...never, result: SCREEN.POSITIVE, score: met, criteria,
      reason: `${met} qSOFA criteria met; this is a prompt to assess for sepsis, not a diagnosis` };
  }
  if (answered.length < 3) {
    return { ...never, result: SCREEN.UNSCREENABLE, score: met, criteria,
      reason: "the screen is incomplete, and an incomplete screen that has not already reached two criteria cannot be reported as not-positive" };
  }
  return { ...never, result: SCREEN.NOT_POSITIVE, score: met, criteria,
    reason: "qSOFA is not met. THIS DOES NOT EXCLUDE SEPSIS: qSOFA has poor sensitivity and is a prompt, never a rule-out. Clinical suspicion overrides it." };
}

/* ------------------------------------------------------------------ the bundle */

const minutesBetween = (fromIso, toIso) => (Date.parse(toIso) - Date.parse(fromIso)) / 60000;

class EmergencyBundle {
  /**
   * @param {{code: string, patientId: string, encounterId?: string, startedBy: string,
   *   timeZero: string, evidence?: object, now: string, definition?: object}} input
   */
  constructor(input) {
    const def = input.definition || BUNDLES[input.code];
    if (!def) throw new EmergencyError(`unknown code ${input.code}`, "UNKNOWN_CODE");
    if (!input.patientId) throw new EmergencyError("a bundle belongs to a patient", "NO_PATIENT");
    // A bundle is started by a human. Nothing in this file may open one on a screen result alone,
    // because a screen is a prompt and this is a clinical commitment.
    if (!input.startedBy) throw new EmergencyError("a bundle must record the clinician who started it; a screen cannot start one by itself", "NO_STARTER");

    const now = input.now;
    const timeZero = input.timeZero || now;
    if (Date.parse(timeZero) > Date.parse(now)) {
      throw new EmergencyError("time zero cannot be in the future", "FUTURE_TIME_ZERO");
    }
    if (input.evidence && input.evidence.at && Date.parse(timeZero) < Date.parse(input.evidence.at)) {
      throw new EmergencyError(
        "time zero cannot be earlier than the evidence that triggered it; recognition did not happen before the observation that prompted it",
        "TIME_ZERO_BEFORE_EVIDENCE");
    }

    this.code = input.code;
    this.label = def.label;
    this.patientId = input.patientId;
    this.encounterId = input.encounterId || null;
    this.startedBy = input.startedBy;
    // Frozen on purpose. The single most common way a sepsis bundle is made to look compliant is by
    // moving this value, so it is not a field anything can assign to.
    Object.defineProperty(this, "timeZero", { value: timeZero, writable: false, enumerable: true, configurable: false });
    this.openedAt = now;
    this.evidence = input.evidence || null;
    this.state = BUNDLE_STATE.RUNNING;
    this.voidReason = null;
    this.supersededBy = null;
    this.elements = def.elements.map((e) => ({ ...e, done: false, doneAt: null, doneBy: null, event: null, notApplicable: false, reason: null }));
    this.ledger = [{ at: now, event: "opened", by: input.startedBy, detail: `time zero ${timeZero}` }];
  }

  element(key) {
    const e = this.elements.find((x) => x.key === key);
    if (!e) throw new EmergencyError(`${this.label} has no element ${key}`, "UNKNOWN_ELEMENT");
    return e;
  }

  /** Minutes since time zero, always recomputed from the immutable origin. */
  elapsedAt(nowIso) {
    return minutesBetween(this.timeZero, nowIso);
  }

  /**
   * Records that an element actually happened.
   *
   * `event` must match the element's `doneOn`. This is the guard against the other common way a
   * bundle is made to look good: recording the ORDER as the completion. Antibiotics ordered at 40
   * minutes and hung at three hours is a three-hour bundle.
   */
  complete(key, { event, at, by, detail } = {}) {
    if (this.state === BUNDLE_STATE.VOIDED) throw new EmergencyError("this bundle was voided", "VOIDED");
    const e = this.element(key);
    if (!by) throw new EmergencyError("completing an element must name who did it", "NO_ACTOR");
    if (!at) throw new EmergencyError("completing an element must record when it happened", "NO_TIME");
    if (e.done) throw new EmergencyError(`${key} is already recorded as done at ${e.doneAt}`, "ALREADY_DONE");
    if (event !== e.doneOn) {
      throw new EmergencyError(
        `${key} counts as done on "${e.doneOn}", not "${event}"; ordering a thing is not doing it`,
        "WRONG_EVENT");
    }
    if (Date.parse(at) < Date.parse(this.timeZero)) {
      throw new EmergencyError("an element cannot have happened before the bundle's time zero", "BEFORE_TIME_ZERO");
    }

    // Ordering constraints between elements, e.g. cultures before antibiotics. Violating it does not
    // block the antibiotic, because delaying an antibiotic to draw cultures kills people; it is
    // recorded as a deviation so the two facts stay separable.
    e.done = true;
    e.doneAt = at;
    e.doneBy = by;
    e.event = event;
    e.elapsedMinutes = this.elapsedAt(at);
    e.withinTarget = e.elapsedMinutes <= e.targetMinutes;
    this.ledger.push({ at, event: `element:${key}`, by, detail: detail || `${event} at ${Math.round(e.elapsedMinutes)} minutes` });

    for (const other of this.elements) {
      if (other.beforeElement !== key || !other.done) continue;
      if (Date.parse(other.doneAt) > Date.parse(at)) {
        other.deviation = `${other.key} was recorded AFTER ${key}, which inverts the required order`;
        this.ledger.push({ at, event: "deviation", by, detail: other.deviation });
      }
    }
    return e;
  }

  /** Marks an element as not applicable to this patient, which requires a reason. */
  notApplicable(key, { by, reason, at }) {
    const e = this.element(key);
    if (!e.conditional) throw new EmergencyError(`${key} is not a conditional element and cannot be waived`, "NOT_CONDITIONAL");
    if (!reason || !by) throw new EmergencyError("waiving an element requires who waived it and why", "NO_REASON");
    e.notApplicable = true;
    e.reason = reason;
    this.ledger.push({ at: at || this.openedAt, event: `not-applicable:${key}`, by, detail: reason });
    return e;
  }

  /**
   * Voids a bundle opened in error. This is the ONLY way to correct a wrong time zero, and it is
   * deliberately expensive: both bundles stay on the record and the reason is mandatory, so a
   * correction can be told apart from a cover-up.
   */
  void(by, reason) {
    if (!by || !reason) throw new EmergencyError("voiding a bundle requires who voided it and why", "NO_REASON");
    if (this.state === BUNDLE_STATE.VOIDED) throw new EmergencyError("already voided", "VOIDED");
    this.state = BUNDLE_STATE.VOIDED;
    this.voidReason = reason;
    this.ledger.push({ at: this.openedAt, event: "voided", by, detail: reason });
    return this;
  }

  /**
   * The bundle's condition right now. Pure: it computes from the immutable time zero and the
   * recorded completions, and there is no state it can be pushed into that turns a breach back into
   * compliance.
   */
  status(nowIso) {
    const elapsed = this.elapsedAt(nowIso);
    const items = this.elements.map((e) => {
      const applicable = !e.notApplicable;
      const overdue = applicable && !e.done && elapsed > e.targetMinutes;
      return {
        key: e.key, label: e.label, done: e.done, doneAt: e.doneAt, event: e.event,
        notApplicable: e.notApplicable, reason: e.reason, deviation: e.deviation || null,
        targetMinutes: e.targetMinutes,
        elapsedMinutes: e.done ? e.elapsedMinutes : null,
        withinTarget: e.done ? e.withinTarget : null,
        overdue,
        minutesRemaining: applicable && !e.done ? Math.max(0, e.targetMinutes - elapsed) : null,
      };
    });

    const applicable = items.filter((i) => !i.notApplicable);
    const breaches = applicable.filter((i) => i.overdue || (i.done && i.withinTarget === false));
    const allDone = applicable.every((i) => i.done);

    let state = this.state;
    if (state !== BUNDLE_STATE.VOIDED) {
      // Breach outranks completion. A bundle where every element was eventually done but one was
      // done late is BREACHED, because the patient waited.
      if (breaches.length) state = BUNDLE_STATE.BREACHED;
      else if (allDone) state = BUNDLE_STATE.COMPLETE;
      else state = BUNDLE_STATE.RUNNING;
    }

    return {
      code: this.code, label: this.label, patientId: this.patientId,
      timeZero: this.timeZero, elapsedMinutes: elapsed,
      state, voidReason: this.voidReason,
      elements: items,
      breaches: breaches.map((b) => b.key),
      // The next thing that will breach, which is what a running resuscitation actually needs.
      nextDue: applicable.filter((i) => !i.done).sort((a, b) => a.minutesRemaining - b.minutesRemaining)[0] || null,
      compliant: state === BUNDLE_STATE.COMPLETE,
    };
  }
}

/* ------------------------------------------------------------------ the arrest clock */

/**
 * A cycle timer for a cardiac arrest. It answers one question: what is due now.
 *
 * It gives intervals and never doses. During an arrest nobody has time to check whether the number
 * on the screen came from an approved table, so this file does not put a number there.
 */
class ArrestClock {
  constructor({ startedAt, cycle } = {}) {
    if (!startedAt) throw new EmergencyError("an arrest clock needs a start time", "NO_START");
    this.startedAt = startedAt;
    this.cycle = { ...ARREST_CYCLE, ...(cycle || {}) };
    this.events = [];
  }

  record(kind, { at, by, detail } = {}) {
    if (!at || !by) throw new EmergencyError("an arrest event needs a time and who did it", "NO_ACTOR");
    const e = { kind, at, by, detail: detail || null, elapsedMinutes: minutesBetween(this.startedAt, at) };
    this.events.push(e);
    return e;
  }

  lastOf(kind) {
    return [...this.events].reverse().find((e) => e.kind === kind) || null;
  }

  /** What is due, and how overdue it is. Never what to give. */
  due(nowIso) {
    const out = [];
    const check = (kind, everyMinutes, label) => {
      const last = this.lastOf(kind);
      const since = minutesBetween(last ? last.at : this.startedAt, nowIso);
      out.push({
        kind, label, sinceMinutes: since, everyMinutes,
        due: since >= everyMinutes,
        overdueByMinutes: Math.max(0, since - everyMinutes),
        neverDone: !last,
      });
    };
    check("rhythm-check", this.cycle.rhythmCheckEveryMinutes, "Rhythm check");
    check("adrenaline", this.cycle.adrenalineEveryMinutes, "Adrenaline due (dose is the team leader's decision; this system does not prescribe)");
    return out;
  }

  get elapsedMinutesAt() {
    return (nowIso) => minutesBetween(this.startedAt, nowIso);
  }
}

/* ------------------------------------------------------------------ the driver */

/**
 * Watches running bundles and shouts when a target is about to pass or has passed.
 *
 * Like the deterioration monitor, it refuses to run without a channel: a bundle timer that knows an
 * antibiotic is 20 minutes overdue and tells nobody is a worse artefact than no timer, because the
 * ward believes something is watching.
 */
class EmergencyMonitor {
  constructor({ now, channels, dispatcher, requireDelivery, warnAtMinutesRemaining } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.dispatcher = dispatcher || (channels ? new Dispatcher({ channels, now: this.now }) : null);
    this.requireDelivery = requireDelivery !== false;
    this.warnAt = typeof warnAtMinutesRemaining === "number" ? warnAtMinutesRemaining : 15;
    this.bundles = new Map();
    this.sent = new Set();
  }

  open(input) {
    if (this.requireDelivery && !this.dispatcher) {
      throw new NotifyError("this monitor has no notification channel, so a breach would be noticed and told to nobody", "NO_CHANNEL");
    }
    const b = new EmergencyBundle({ ...input, now: input.now || this.now() });
    this.bundles.set(`${b.patientId}:${b.code}:${b.timeZero}`, b);
    return b;
  }

  running() {
    const now = this.now();
    return [...this.bundles.values()].filter((b) => {
      const s = b.status(now);
      return s.state === BUNDLE_STATE.RUNNING || s.state === BUNDLE_STATE.BREACHED;
    });
  }

  /** Sweeps every live bundle and dispatches warnings and breaches, each once. */
  async sweep() {
    const now = this.now();
    const fired = [];
    for (const b of this.bundles.values()) {
      const s = b.status(now);
      if (s.state === BUNDLE_STATE.VOIDED || s.state === BUNDLE_STATE.COMPLETE) continue;
      for (const el of s.elements) {
        if (el.done || el.notApplicable) continue;
        const kind = el.overdue ? "breach" : (el.minutesRemaining <= this.warnAt ? "warning" : null);
        if (!kind) continue;
        const key = `${b.patientId}:${b.code}:${b.timeZero}:${el.key}:${kind}`;
        if (this.sent.has(key)) continue;   // one warning and one breach per element, not a stream
        this.sent.add(key);
        const notice = {
          kind, code: b.code, label: b.label, patientId: b.patientId, element: el.key,
          elementLabel: el.label, elapsedMinutes: s.elapsedMinutes, targetMinutes: el.targetMinutes,
          minutesRemaining: el.minutesRemaining, timeZero: b.timeZero, at: now, delivered: false, attempts: [],
        };
        if (this.dispatcher) {
          const { delivered, attempts } = await this.dispatcher.send({ notice });
          notice.delivered = delivered;
          notice.attempts = attempts;
        }
        b.ledger.push({ at: now, event: kind, by: "wardsynq-emergency-monitor", detail: `${el.key}: ${notice.delivered ? "notified" : "NOT DELIVERED"}` });
        fired.push(notice);
      }
    }
    return fired;
  }
}

export {
  CODE, BUNDLE_STATE, BUNDLES, ARREST_CYCLE, SCREEN,
  EmergencyError, EmergencyBundle, EmergencyMonitor, ArrestClock,
  screenSepsis, minutesBetween,
};
