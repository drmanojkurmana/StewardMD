/* wardsynq/wardsynq-deterioration.js — NEWS2, and the reasons a score must sometimes refuse.
 *
 * Failure to rescue is the largest avoidable category of inpatient death: the patient deteriorated,
 * the observations were recorded, and nobody acted in time. Nothing else in this build watches a
 * trend, and HAZ-DEV-01 already names this file's job in its own verification statement, where the
 * IoMT artifact filter exists specifically to keep corrupted telemetry out of "automated NEWS2
 * calculations". `scoreable()` was written for this consumer; this is the consumer.
 *
 * WHY THIS IS NOT A SCORING CALCULATOR. The arithmetic of NEWS2 is public, fixed and easy. Every
 * dangerous property of a real early warning system is in what it does when the inputs are not what
 * the score assumes, and that is what most of this file is:
 *
 *   1. A MISSING PARAMETER IS NOT ZERO. This is the single most dangerous way to implement NEWS2. An
 *      absent respiratory rate scores 0, the total looks reassuring, and respiratory rate is the
 *      earliest sign of deterioration there is. An incomplete score is reported as INCOMPLETE and
 *      can never be reported as reassuring, however low the partial total.
 *   2. STALE OBSERVATIONS DO NOT DESCRIBE A PATIENT NOW. A score built from a six-hour-old blood
 *      pressure is a current-looking number about a patient who has since changed.
 *   3. SCALE 2 IS A PRESCRIPTION, NOT A GUESS. Patients in hypercapnic respiratory failure are
 *      targeted at 88 to 92 percent, and using Scale 1 on them escalates a patient who is at their
 *      target. Using Scale 2 on anyone else hides real hypoxia. Scale 2 therefore applies only where
 *      it has been explicitly prescribed and recorded, which is exactly what the RCP requires.
 *   4. THE TOTAL HIDES THE SINGLE PARAMETER. A total of 3 from one parameter at its extreme is a
 *      different patient from a total of 3 spread across three parameters, and a system that shows
 *      only the total misses the first one. Both drive escalation here.
 *   5. NEWS2 IS ADULT AND NON-OBSTETRIC. It is not validated below 16, where PEWS applies, and not
 *      in pregnancy, where normal physiology moves the parameters and MEOWS applies. Neither is
 *      modelled, so both are REFUSED rather than approximated. This is the same rule as
 *      wardsynq-paediatrics.js: an unbanded tool means adult.
 *   6. A SCORE NOBODY ANSWERS IS THE ACTUAL FAILURE. Escalation is closed-loop and re-escalates on
 *      its own when the response window passes unacknowledged.
 *
 * PROVENANCE. Every score carries the ids of the observations it was computed from, because the spec
 * requires a clinician to be able to click a derived value and see the raw observations behind it. A
 * derived number with no traceable inputs is not evidence.
 *
 * NOT MODELLED: PEWS, MEOWS, qSOFA and the sepsis bundle, spinal-injury and post-ictal states, and
 * any local escalation policy beyond the RCP's default tiers.
 *
 * PROVENANCE OF THE SCORE ITSELF: the parameter bands are the Royal College of Physicians' published
 * NEWS2 (2017) chart. They are a national standard rather than seed content invented here, which is
 * why this file carries numbers where the threshold and dose files deliberately do not. The
 * ESCALATION POLICY attached to those bands is still a local decision and is marked as unapproved.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-deterioration.test.mjs
 */

import { scoreable } from "./wardsynq-iomt.js";
import { ageBandOf, BAND } from "./wardsynq-paediatrics.js";

/** The seven NEWS2 parameters. A score is not a score until all seven have been answered. */
const PARAM = Object.freeze({
  RESP_RATE: "respiratoryRate",
  SPO2: "oxygenSaturation",
  OXYGEN: "supplementalOxygen",
  SYSTOLIC: "systolicBloodPressure",
  PULSE: "pulse",
  CONSCIOUSNESS: "consciousness",
  TEMPERATURE: "temperature",
});

const REQUIRED = Object.freeze(Object.values(PARAM));

/** LOINC codes for the vital signs this reads, so an adapter can map into it without guessing. */
const LOINC = Object.freeze({
  "9279-1": PARAM.RESP_RATE,
  "2708-6": PARAM.SPO2,
  "59408-5": PARAM.SPO2,      // SpO2 by pulse oximetry
  "8480-6": PARAM.SYSTOLIC,
  "8867-4": PARAM.PULSE,
  "8310-5": PARAM.TEMPERATURE,
  "80288-4": PARAM.OXYGEN,    // oxygen therapy given
  "80339-5": PARAM.CONSCIOUSNESS, // ACVPU
});

/** ACVPU. Anything other than Alert scores 3, including new confusion. */
const ACVPU = Object.freeze(["A", "C", "V", "P", "U"]);

/** How old a vital sign may be and still describe the patient now. A local policy, stated once. */
const FRESHNESS_MS = 4 * 60 * 60 * 1000;

const CLINICAL_RISK = Object.freeze({
  LOW: "low",
  LOW_MEDIUM: "low-medium",   // a single parameter scoring 3
  MEDIUM: "medium",
  HIGH: "high",
});

/**
 * The escalation policy. UNAPPROVED: response windows and responder tiers are a local decision that
 * the resuscitation committee owns, and these are the RCP's defaults rather than this hospital's.
 */
const ESCALATION = Object.freeze({
  [CLINICAL_RISK.LOW]:        { monitoringMinutes: 720, responder: "registered nurse", respondWithinMinutes: null },
  [CLINICAL_RISK.LOW_MEDIUM]: { monitoringMinutes: 60,  responder: "registered nurse", respondWithinMinutes: 60 },
  [CLINICAL_RISK.MEDIUM]:     { monitoringMinutes: 60,  responder: "ward doctor, urgent", respondWithinMinutes: 30 },
  [CLINICAL_RISK.HIGH]:       { monitoringMinutes: 0,   responder: "critical care outreach, emergency", respondWithinMinutes: 15 },
});

/**
 * Who to ask next when nobody answers, in ascending order of authority. The top rung is terminal:
 * there is nobody above the resuscitation team, so an ignored emergency keeps asking them rather
 * than falling off the end of the ladder into silence.
 */
const RESPONDER_LADDER = Object.freeze([
  { responder: "registered nurse", respondWithinMinutes: 60 },
  { responder: "ward doctor, urgent", respondWithinMinutes: 30 },
  { responder: "critical care outreach, emergency", respondWithinMinutes: 15 },
  { responder: "resuscitation team, immediate", respondWithinMinutes: 5 },
]);

class DeteriorationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "DeteriorationError";
    this.code = code || "DETERIORATION_VIOLATION";
  }
}

/* ------------------------------------------------------------------ the parameter bands */

const band = (v, bands) => {
  for (const [test, points] of bands) if (test(v)) return points;
  return null;
};

function scoreRespiratoryRate(v) {
  return band(v, [[(x) => x <= 8, 3], [(x) => x <= 11, 1], [(x) => x <= 20, 0], [(x) => x <= 24, 2], [() => true, 3]]);
}

/** Scale 1: the default, for everyone without a documented Scale 2 prescription. */
function scoreSpO2Scale1(v) {
  return band(v, [[(x) => x <= 91, 3], [(x) => x <= 93, 2], [(x) => x <= 95, 1], [() => true, 0]]);
}

/**
 * Scale 2: for patients in hypercapnic respiratory failure with a target of 88 to 92 percent.
 *
 * The counterintuitive half is the top: a Scale 2 patient at 97 percent ON OXYGEN scores 3, because
 * they are being over-oxygenated toward a CO2 narcosis. On air, the same number is normal. So this
 * band needs to know whether oxygen is running, and gets it rather than assuming.
 */
function scoreSpO2Scale2(v, onOxygen) {
  if (v <= 83) return 3;
  if (v <= 85) return 2;
  if (v <= 87) return 1;
  if (v <= 92) return 0;
  if (!onOxygen) return 0; // 93 and above breathing air is not a concern on Scale 2
  if (v <= 94) return 1;
  if (v <= 96) return 2;
  return 3;
}

function scoreSystolic(v) {
  return band(v, [[(x) => x <= 90, 3], [(x) => x <= 100, 2], [(x) => x <= 110, 1], [(x) => x <= 219, 0], [() => true, 3]]);
}

function scorePulse(v) {
  return band(v, [[(x) => x <= 40, 3], [(x) => x <= 50, 1], [(x) => x <= 90, 0], [(x) => x <= 110, 1], [(x) => x <= 130, 2], [() => true, 3]]);
}

function scoreTemperature(v) {
  return band(v, [[(x) => x <= 35.0, 3], [(x) => x <= 36.0, 1], [(x) => x <= 38.0, 0], [(x) => x <= 39.0, 1], [() => true, 2]]);
}

/* ------------------------------------------------------------------ gathering the inputs */

/**
 * Reduces a list of observations to the latest value for each NEWS2 parameter.
 *
 * Runs `scoreable()` first, so device observations excluded as artifact never reach the score. That
 * is the whole point of the IoMT filter and it belongs here, at the consumer, where forgetting it
 * would be invisible.
 *
 * @returns {{values: object, sources: object, rejected: {id, reason}[]}}
 */
function gather(observations, { now, freshnessMs = FRESHNESS_MS } = {}) {
  const nowMs = Date.parse(now || new Date().toISOString());
  const values = {};
  const sources = {};
  const rejected = [];

  for (const o of scoreable(observations)) {
    if (!o || !o.code) continue;
    const param = LOINC[o.code] || (REQUIRED.includes(o.code) ? o.code : null);
    if (!param) continue;

    const at = Date.parse(o.effectiveAt || (o.meta && (o.meta.effectiveAt || o.meta.recordedAt)) || "");
    if (!Number.isFinite(at)) { rejected.push({ id: o.id, param, reason: "no effective time, so its age cannot be established" }); continue; }
    if (nowMs - at > freshnessMs) {
      rejected.push({ id: o.id, param, reason: `recorded ${Math.round((nowMs - at) / 60000)} minutes ago, beyond the ${Math.round(freshnessMs / 60000)} minute freshness window` });
      continue;
    }
    if (sources[param] && sources[param].at >= at) continue; // an older reading never replaces a newer one
    values[param] = o.value;
    sources[param] = { id: o.id, at, atIso: new Date(at).toISOString(), code: o.code };
  }
  return { values, sources, rejected };
}

/* ------------------------------------------------------------------ the score */

/**
 * Computes NEWS2 for one patient.
 *
 * @param {{values?: object, observations?: object[], patient?: object, scale?: 1|2, now?: string,
 *   freshnessMs?: number}} input
 * @returns {{scorable: boolean, total: number|null, risk: string|null, parameters: object,
 *   missing: string[], singleParameterThree: string[], reason: string|null, scale: number,
 *   sources: object, rejected: object[], escalation: object|null, computedAt: string}}
 */
function news2(input) {
  input = input || {};
  const now = input.now || new Date().toISOString();
  const patient = input.patient || null;
  const refuse = (reason, code) => ({
    scorable: false, total: null, risk: null, parameters: {}, missing: [], singleParameterThree: [],
    reason, code, scale: input.scale || 1, sources: {}, rejected: [], escalation: null, computedAt: now,
  });

  // NEWS2 is validated in adults and not in pregnancy. Neither alternative tool is modelled, so both
  // are refused. A refusal is visible; a wrong score looks exactly like a right one.
  if (patient) {
    const banding = ageBandOf(patient, now);
    if (banding.band !== BAND.ADULT) {
      return refuse(
        banding.band === BAND.UNKNOWN
          ? "NEWS2 is validated in adults and this patient's age is not established, so it cannot be applied"
          : `NEWS2 is not validated below 16 years; this patient bands as ${banding.band} and needs PEWS, which is not modelled here`,
        "NOT_ADULT");
    }
    if (patient.pregnant === true) {
      return refuse("NEWS2 is not validated in pregnancy, where normal physiology moves several parameters; MEOWS applies and is not modelled here", "PREGNANT");
    }
  }

  const gathered = input.observations
    ? gather(input.observations, { now, freshnessMs: input.freshnessMs })
    : { values: input.values || {}, sources: {}, rejected: [] };
  const v = gathered.values;

  const scale = input.scale === 2 ? 2 : 1;
  if (input.scale === 2 && !(patient && patient.spo2ScaleTwoPrescribed === true)) {
    return refuse("Scale 2 applies only where it has been prescribed and recorded for this patient; using it otherwise hides real hypoxia", "SCALE_2_NOT_PRESCRIBED");
  }

  const onOxygen = v[PARAM.OXYGEN] === true || v[PARAM.OXYGEN] === "oxygen";
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

  const parameters = {};
  const missing = [];

  const put = (name, raw, points) => {
    if (points === null || points === undefined) { missing.push(name); return; }
    parameters[name] = { value: raw, points };
  };

  put(PARAM.RESP_RATE, v[PARAM.RESP_RATE], num(v[PARAM.RESP_RATE]) === null ? null : scoreRespiratoryRate(v[PARAM.RESP_RATE]));
  const spo2 = num(v[PARAM.SPO2]);
  put(PARAM.SPO2, v[PARAM.SPO2], spo2 === null ? null : (scale === 2 ? scoreSpO2Scale2(spo2, onOxygen) : scoreSpO2Scale1(spo2)));
  // Oxygen is the one parameter where absence is not the same as unknown only if it was recorded as
  // absent. An unrecorded oxygen field is still missing: "nobody wrote it down" is not "on air".
  put(PARAM.OXYGEN, v[PARAM.OXYGEN], v[PARAM.OXYGEN] === undefined || v[PARAM.OXYGEN] === null ? null : (onOxygen ? 2 : 0));
  put(PARAM.SYSTOLIC, v[PARAM.SYSTOLIC], num(v[PARAM.SYSTOLIC]) === null ? null : scoreSystolic(v[PARAM.SYSTOLIC]));
  put(PARAM.PULSE, v[PARAM.PULSE], num(v[PARAM.PULSE]) === null ? null : scorePulse(v[PARAM.PULSE]));
  const acvpu = typeof v[PARAM.CONSCIOUSNESS] === "string" ? v[PARAM.CONSCIOUSNESS].trim().toUpperCase() : null;
  put(PARAM.CONSCIOUSNESS, v[PARAM.CONSCIOUSNESS], acvpu && ACVPU.includes(acvpu) ? (acvpu === "A" ? 0 : 3) : null);
  put(PARAM.TEMPERATURE, v[PARAM.TEMPERATURE], num(v[PARAM.TEMPERATURE]) === null ? null : scoreTemperature(v[PARAM.TEMPERATURE]));

  const total = Object.values(parameters).reduce((sum, p) => sum + p.points, 0);
  const singleParameterThree = Object.keys(parameters).filter((k) => parameters[k].points === 3);

  // The refusal that matters most. A partial total is arithmetic, not a risk assessment, and the
  // parameter most often missing is respiratory rate, which is the earliest warning there is.
  if (missing.length) {
    return {
      scorable: false, total, partial: true, risk: null, parameters, missing, singleParameterThree,
      reason: `incomplete: ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not recorded, so the partial total of ${total} is not a risk assessment and must not be read as one`,
      code: "INCOMPLETE", scale, sources: gathered.sources, rejected: gathered.rejected,
      escalation: null, computedAt: now,
    };
  }

  let risk;
  if (total >= 7) risk = CLINICAL_RISK.HIGH;
  else if (total >= 5) risk = CLINICAL_RISK.MEDIUM;
  else if (singleParameterThree.length) risk = CLINICAL_RISK.LOW_MEDIUM;
  else risk = CLINICAL_RISK.LOW;

  return {
    scorable: true, total, partial: false, risk, parameters, missing: [], singleParameterThree,
    reason: null, code: null, scale, sources: gathered.sources, rejected: gathered.rejected,
    escalation: ESCALATION[risk], computedAt: now,
  };
}

/* ------------------------------------------------------------------ the trend, and the response */

const TREND = Object.freeze({ RISING: "rising", STABLE: "stable", FALLING: "falling", UNKNOWN: "unknown" });

/**
 * A rise of 2 or more is significant even when the total is still low, because the trajectory is the
 * warning and a patient moving from 1 to 4 is not the same as a patient sitting at 4.
 */
function trendOf(scores) {
  const totals = (scores || []).filter((s) => s && s.scorable).map((s) => s.total);
  if (totals.length < 2) return { trend: TREND.UNKNOWN, delta: null, significant: false, reason: "fewer than two complete scores" };
  const delta = totals[totals.length - 1] - totals[totals.length - 2];
  const trend = delta > 0 ? TREND.RISING : delta < 0 ? TREND.FALLING : TREND.STABLE;
  return {
    trend, delta, significant: delta >= 2,
    reason: delta >= 2 ? `a rise of ${delta} is significant regardless of the absolute total` : null,
  };
}

const RESPONSE = Object.freeze({ OPEN: "open", ACKNOWLEDGED: "acknowledged", REVIEWED: "reviewed", OVERDUE: "overdue" });

/**
 * The closed loop. A score that escalates and nobody answers is the failure this file exists to
 * prevent, so an unacknowledged escalation goes OVERDUE on its own and re-escalates to the next
 * tier rather than sitting quietly at the tier that was already ignored.
 */
class DeteriorationMonitor {
  constructor({ now, notify, clock } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.notify = notify || null;
    this.clock = clock || null;
    this.escalations = new Map();
  }

  /** Raises an escalation for a score, or returns null where none is required. */
  async assess(score, { patientId, encounterId } = {}) {
    if (!score) throw new DeteriorationError("a score is required", "NO_SCORE");

    // An unscorable result is not a quiet result. A patient whose observations are incomplete is a
    // patient nobody has fully looked at, which is its own reason to send somebody.
    const unscorable = score.scorable === false;
    const needs = unscorable || (score.risk && score.risk !== CLINICAL_RISK.LOW);
    if (!needs) return null;

    const at = this.now();
    const policy = unscorable
      ? { responder: "registered nurse", respondWithinMinutes: 60 }
      : score.escalation;

    const esc = {
      id: `esc-${this.escalations.size + 1}-${at}`,
      patientId: patientId || null,
      encounterId: encounterId || null,
      raisedAt: at,
      state: RESPONSE.OPEN,
      tier: 0,
      risk: unscorable ? null : score.risk,
      total: score.total,
      unscorable,
      reason: unscorable ? score.reason : `NEWS2 ${score.total}${score.singleParameterThree.length ? ` with ${score.singleParameterThree.join(" and ")} at the extreme` : ""}`,
      responder: policy.responder,
      respondWithinMinutes: policy.respondWithinMinutes,
      dueAt: policy.respondWithinMinutes ? new Date(Date.parse(at) + policy.respondWithinMinutes * 60000).toISOString() : null,
      // Provenance: the raw observations behind the derived number, so a clinician can open it.
      sources: score.sources || {},
      history: [{ at, event: "raised", detail: policy.responder }],
    };
    this.escalations.set(esc.id, esc);
    if (this.notify) await this.notify(esc);
    return esc;
  }

  /** A human takes responsibility. Acknowledgement is not review: the loop stays open. */
  acknowledge(escalationId, clinicianId) {
    const esc = this.escalations.get(escalationId);
    if (!esc) throw new DeteriorationError(`no escalation ${escalationId}`, "NO_ESCALATION");
    if (!clinicianId) throw new DeteriorationError("acknowledgement requires the clinician who is taking it", "NO_CLINICIAN");
    esc.state = RESPONSE.ACKNOWLEDGED;
    esc.acknowledgedBy = clinicianId;
    esc.history.push({ at: this.now(), event: "acknowledged", detail: clinicianId });
    return esc;
  }

  /** Closes the loop: somebody saw the patient and recorded what they did. */
  review(escalationId, { clinicianId, outcome }) {
    const esc = this.escalations.get(escalationId);
    if (!esc) throw new DeteriorationError(`no escalation ${escalationId}`, "NO_ESCALATION");
    if (!clinicianId || !outcome) throw new DeteriorationError("a review needs the clinician and what they did; a bare click closes the loop without closing the risk", "NO_OUTCOME");
    esc.state = RESPONSE.REVIEWED;
    esc.reviewedBy = clinicianId;
    esc.outcome = outcome;
    esc.history.push({ at: this.now(), event: "reviewed", detail: `${clinicianId}: ${outcome}` });
    return esc;
  }

  /**
   * Sweeps for escalations whose response window has passed. Re-escalates rather than merely
   * flagging, because the tier that was ignored is not the tier to ask again.
   */
  async sweep() {
    const nowMs = Date.parse(this.now());
    const overdue = [];
    for (const esc of this.escalations.values()) {
      if (esc.state === RESPONSE.REVIEWED) continue;
      if (!esc.dueAt || Date.parse(esc.dueAt) > nowMs) continue;
      esc.state = RESPONSE.OVERDUE;
      esc.tier += 1;
      // Strictly ABOVE whoever was already asked, not the next rung of a fixed ladder. A medium-risk
      // escalation already went to the ward doctor, so counting rungs would send it to the ward
      // doctor again: re-escalating to the tier that just ignored it is not an escalation.
      const next = RESPONDER_LADDER.findIndex((r) => r.responder === esc.responder) + 1;
      const step = RESPONDER_LADDER[Math.min(next, RESPONDER_LADDER.length - 1)];
      esc.responder = step.responder;
      esc.respondWithinMinutes = step.respondWithinMinutes;
      esc.dueAt = new Date(nowMs + esc.respondWithinMinutes * 60000).toISOString();
      esc.history.push({ at: this.now(), event: "re-escalated", detail: `unanswered, now ${esc.responder}` });
      if (this.notify) await this.notify(esc);
      overdue.push(esc);
    }
    return overdue;
  }

  open() {
    return [...this.escalations.values()].filter((e) => e.state !== RESPONSE.REVIEWED);
  }
}

export {
  PARAM, REQUIRED, LOINC, ACVPU, FRESHNESS_MS, CLINICAL_RISK, ESCALATION, TREND, RESPONSE,
  RESPONDER_LADDER, DeteriorationError, DeteriorationMonitor,
  news2, gather, trendOf,
  scoreRespiratoryRate, scoreSpO2Scale1, scoreSpO2Scale2, scoreSystolic, scorePulse, scoreTemperature,
};
