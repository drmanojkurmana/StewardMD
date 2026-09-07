/* wardsynq/wardsynq-recognition.js — the gap between the machine noticing and a human deciding.
 *
 * HAZ-TIME-01 was declared PARTIAL with a specific reason: the timing of a bundle is trustworthy,
 * but nothing started one. A bundle existed only where a clinician already knew to open it, which is
 * exactly the population that was never going to be missed. The patient the hazard is about is the
 * one nobody recognised, and for them the control did nothing. This file is that trigger.
 *
 * IT DOES NOT START BUNDLES. That distinction is the whole design. A screen is a prompt and a NEWS2
 * score is a screen; neither is a diagnosis, and a system that opened a Code Sepsis on a qSOFA of 2
 * would be diagnosing. What it does instead is RAISE A PROMPT that a named human must answer, and
 * then hold that human to the answer.
 *
 * WHY A PROMPT IS WORTH ANYTHING. Three properties, none of which a passive alert has:
 *
 *   1. THE PROMPT IS TIMESTAMPED AND IMMUTABLE, so the interval between the machine noticing and a
 *      human deciding becomes a measurable number. Today that interval is invisible everywhere,
 *      which is why nobody manages it.
 *   2. THE PROMPT PINS THE BUNDLE'S TIME ZERO. If a clinician accepts at 03:45 a prompt raised on
 *      evidence from 02:10, the bundle they open starts at 02:10 and cannot be moved in either
 *      direction: the emergency module refuses a time zero before the evidence, and, because an
 *      accepted prompt sets `pinsTimeZero`, refuses one after it too. That second refusal is the one
 *      that matters, since the gaming direction is forward. The prompt is what makes it bite:
 *      without it, the evidence was whatever the person opening the bundle said it was.
 *   3. DECLINING IS AN ANSWER AND IS RECORDED. A clinician who looks and decides this is not sepsis
 *      is doing their job, and that judgement, with its reason and its author, is worth more on the
 *      record than a dismissed alert. An UNANSWERED prompt is the dangerous state and is the one
 *      that escalates.
 *
 * THE ALERT FATIGUE PROBLEM IS REAL AND IS NOT SOLVED HERE. A prompt on every transient qSOFA of 2
 * would be ignored within a week, and an ignored prompt is worse than none because it launders
 * inaction into a record of having been told. What this file does is deduplicate per patient per
 * code while a prompt is live or recently answered, so a patient generates one conversation and not
 * a stream. Whether the trigger threshold is right is a clinical decision this file cannot make and
 * does not pretend to; the thresholds are supplied by the caller.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-recognition.test.mjs
 */

import { Dispatcher, NotifyError } from "./wardsynq-notify.js";
import { CODE, SCREEN, screenSepsis } from "./wardsynq-emergency.js";
import { CLINICAL_RISK } from "./wardsynq-deterioration.js";

const PROMPT = Object.freeze({
  OPEN: "open",             // raised, nobody has answered
  ACCEPTED: "accepted",     // a human agreed and (usually) opened a bundle
  DECLINED: "declined",     // a human looked and judged otherwise, with a reason
  SUPERSEDED: "superseded", // a stronger prompt for the same patient replaced it
});

/** How long an answered prompt suppresses a new one for the same patient and code. */
const REFRACTORY_MINUTES = 120;

/** How long an OPEN prompt may go unanswered before it escalates. Not a clinical number. */
const ANSWER_WITHIN_MINUTES = 15;

class RecognitionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RecognitionError";
    this.code = code || "RECOGNITION_VIOLATION";
  }
}

const minutesBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 60000;

/**
 * Decides whether the evidence in front of it warrants prompting a human about sepsis.
 *
 * Takes both signals because they fail differently: qSOFA is specific and insensitive, NEWS2 is
 * sensitive and non-specific, and a patient who trips either deserves a look. Combining them by
 * requiring BOTH would inherit the worst property of each.
 *
 * @returns {{prompt: boolean, strength: string, reasons: string[], evidenceAt: string|null}}
 */
function assessSepsisRecognition({ screen, news2Score, at } = {}) {
  const reasons = [];
  let strength = null;
  let evidenceAt = at || null;

  if (screen && screen.result === SCREEN.POSITIVE) {
    reasons.push(`qSOFA ${screen.score} of 3`);
    strength = "screen-positive";
  }
  if (news2Score && news2Score.scorable) {
    if (news2Score.risk === CLINICAL_RISK.HIGH) {
      reasons.push(`NEWS2 ${news2Score.total}, high risk`);
      strength = "high";
    } else if (news2Score.risk === CLINICAL_RISK.MEDIUM && strength !== "high") {
      reasons.push(`NEWS2 ${news2Score.total}, medium risk`);
      strength = strength || "medium";
    }
    if (news2Score.computedAt) evidenceAt = evidenceAt || news2Score.computedAt;
  }

  // An UNSCORABLE patient is not evidence of sepsis and must not be turned into one. The
  // deterioration monitor already escalates them for being unobserved, and duplicating that here as
  // a suspected-sepsis prompt would be the kind of double-counting that trains people to ignore both.
  return {
    prompt: reasons.length > 0,
    strength: strength || null,
    reasons,
    evidenceAt,
  };
}

const STRENGTH_RANK = Object.freeze({ medium: 1, "screen-positive": 2, high: 3 });

class RecognitionQueue {
  /**
   * @param {{now?: () => string, channels?: object, dispatcher?: Dispatcher,
   *   requireDelivery?: boolean, refractoryMinutes?: number, answerWithinMinutes?: number}} deps
   */
  constructor({ now, channels, dispatcher, requireDelivery, refractoryMinutes, answerWithinMinutes } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.dispatcher = dispatcher || (channels ? new Dispatcher({ channels, now: this.now }) : null);
    this.requireDelivery = requireDelivery !== false;
    this.refractoryMinutes = typeof refractoryMinutes === "number" ? refractoryMinutes : REFRACTORY_MINUTES;
    this.answerWithin = typeof answerWithinMinutes === "number" ? answerWithinMinutes : ANSWER_WITHIN_MINUTES;
    this.prompts = [];
    this._seq = 0;
  }

  for(patientId, code) {
    return this.prompts.filter((p) => p.patientId === patientId && p.code === code);
  }

  live(patientId, code) {
    return this.for(patientId, code).find((p) => p.state === PROMPT.OPEN) || null;
  }

  /**
   * Raises a prompt, or explains why it did not.
   *
   * @returns {{raised: boolean, prompt: object|null, reason: string}}
   */
  async raise({ patientId, encounterId, code, assessment, evidence }) {
    if (!patientId) throw new RecognitionError("a prompt belongs to a patient", "NO_PATIENT");
    if (!assessment || !assessment.prompt) {
      return { raised: false, prompt: null, reason: "the evidence does not warrant prompting" };
    }
    if (this.requireDelivery && !this.dispatcher) {
      throw new NotifyError("this queue has no notification channel, so a prompt would be raised and shown to nobody", "NO_CHANNEL");
    }

    const now = this.now();
    code = code || CODE.SEPSIS;

    const existing = this.live(patientId, code);
    if (existing) {
      // A stronger signal on a patient who already has a live prompt supersedes rather than stacks.
      // Two open prompts for one patient is how a queue becomes noise.
      if (STRENGTH_RANK[assessment.strength] > STRENGTH_RANK[existing.strength]) {
        existing.state = PROMPT.SUPERSEDED;
        existing.history.push({ at: now, event: "superseded", detail: `by a ${assessment.strength} signal` });
      } else {
        return { raised: false, prompt: existing, reason: "a prompt for this patient is already open and unanswered" };
      }
    }

    const answered = this.for(patientId, code)
      .filter((p) => p.state === PROMPT.ACCEPTED || p.state === PROMPT.DECLINED)
      .sort((a, b) => Date.parse(b.answeredAt) - Date.parse(a.answeredAt))[0];
    if (answered && minutesBetween(answered.answeredAt, now) < this.refractoryMinutes) {
      // A clinician has already looked at this patient for this reason. Asking again within the
      // hour trains them to stop reading prompts, and that costs more than this prompt gains.
      return { raised: false, prompt: answered, reason: `a clinician answered this ${Math.round(minutesBetween(answered.answeredAt, now))} minutes ago; the refractory period is ${this.refractoryMinutes} minutes` };
    }

    const prompt = {
      id: `rec-${++this._seq}`,
      patientId,
      encounterId: encounterId || null,
      code,
      state: PROMPT.OPEN,
      // Immutable, and this is the load-bearing property: it is what a bundle's time zero will be
      // measured against, so it must not be assignable after the fact.
      raisedAt: now,
      strength: assessment.strength,
      reasons: assessment.reasons,
      // The evidence time is the OBSERVATION's time, not the prompt's. A prompt raised at 02:15 on a
      // NEWS2 computed at 02:10 anchors to 02:10, because that is when the patient was deteriorating.
      evidenceAt: assessment.evidenceAt || now,
      evidence: evidence || null,
      answeredAt: null, answeredBy: null, outcome: null, declineReason: null,
      delivered: false, attempts: [],
      history: [{ at: now, event: "raised", detail: assessment.reasons.join("; ") }],
    };
    Object.defineProperty(prompt, "raisedAt", { value: now, writable: false, configurable: false, enumerable: true });
    Object.defineProperty(prompt, "evidenceAt", { value: prompt.evidenceAt, writable: false, configurable: false, enumerable: true });

    this.prompts.push(prompt);
    await this._dispatch(prompt, "raised");
    return { raised: true, prompt, reason: assessment.reasons.join("; ") };
  }

  async _dispatch(prompt, why) {
    if (!this.dispatcher) {
      prompt.history.push({ at: this.now(), event: "undelivered", detail: "no notification channel is configured" });
      return prompt;
    }
    const { delivered, attempts } = await this.dispatcher.send({ prompt, why });
    prompt.attempts.push(...attempts);
    prompt.delivered = prompt.delivered || delivered;
    prompt.history.push({
      at: this.now(),
      event: delivered ? "delivered" : "delivery-failed",
      detail: attempts.map((a) => `${a.channel}${a.detail ? `: ${a.detail}` : ""}`).join("; "),
    });
    return prompt;
  }

  /**
   * A clinician agrees. Returns what the emergency module needs to open a bundle, including the
   * evidence that will pin its time zero.
   */
  accept(promptId, { clinicianId, outcome } = {}) {
    const p = this._open(promptId);
    if (!clinicianId) throw new RecognitionError("accepting a prompt must name the clinician", "NO_CLINICIAN");
    p.state = PROMPT.ACCEPTED;
    p.answeredAt = this.now();
    p.answeredBy = clinicianId;
    p.outcome = outcome || null;
    p.recognitionDelayMinutes = minutesBetween(p.evidenceAt, p.answeredAt);
    p.history.push({ at: p.answeredAt, event: "accepted", detail: `${clinicianId}${outcome ? `: ${outcome}` : ""}` });
    return {
      prompt: p,
      // Hand straight to EmergencyBundle. Its constructor refuses a time zero earlier than this, so
      // the bundle cannot be back-dated to before the machine noticed.
      bundleInput: {
        code: p.code,
        patientId: p.patientId,
        encounterId: p.encounterId,
        startedBy: clinicianId,
        // pinsTimeZero is the load-bearing flag: a human accepted a prompt the machine raised, so
        // the clock starts when the machine knew, not when the human got round to answering.
        evidence: { at: p.evidenceAt, detail: p.reasons.join("; "), promptId: p.id, pinsTimeZero: true },
      },
    };
  }

  /**
   * A clinician looks and judges otherwise. This is a legitimate and common answer, and recording it
   * with its reason is worth far more than a dismissed alert, because it makes the judgement
   * reviewable and its author accountable. Hence the mandatory reason.
   */
  decline(promptId, { clinicianId, reason } = {}) {
    const p = this._open(promptId);
    if (!clinicianId) throw new RecognitionError("declining a prompt must name the clinician", "NO_CLINICIAN");
    if (!reason) {
      throw new RecognitionError(
        "declining requires a clinical reason; a prompt dismissed without one is indistinguishable from a prompt nobody read",
        "NO_REASON");
    }
    p.state = PROMPT.DECLINED;
    p.answeredAt = this.now();
    p.answeredBy = clinicianId;
    p.declineReason = reason;
    p.history.push({ at: p.answeredAt, event: "declined", detail: `${clinicianId}: ${reason}` });
    return p;
  }

  _open(promptId) {
    const p = this.prompts.find((x) => x.id === promptId);
    if (!p) throw new RecognitionError(`no prompt ${promptId}`, "NO_PROMPT");
    if (p.state !== PROMPT.OPEN) throw new RecognitionError(`prompt ${promptId} is already ${p.state}`, "NOT_OPEN");
    return p;
  }

  /**
   * Prompts nobody has answered. This is the number that matters: a queue of unanswered prompts is a
   * queue of patients a machine flagged and no human has looked at.
   */
  unanswered(nowIso) {
    const now = nowIso || this.now();
    return this.prompts
      .filter((p) => p.state === PROMPT.OPEN)
      .map((p) => ({
        ...p,
        openForMinutes: minutesBetween(p.raisedAt, now),
        overdue: minutesBetween(p.raisedAt, now) > this.answerWithin,
      }));
  }

  /** Re-dispatches prompts that have gone unanswered past the window, once per prompt. */
  async sweep() {
    const now = this.now();
    const fired = [];
    for (const p of this.unanswered(now)) {
      if (!p.overdue) continue;
      const live = this.prompts.find((x) => x.id === p.id);
      if (live.escalated) continue;
      live.escalated = true;
      live.history.push({ at: now, event: "escalated", detail: `unanswered for ${Math.round(p.openForMinutes)} minutes` });
      await this._dispatch(live, "escalated");
      fired.push(live);
    }
    return fired;
  }

  /**
   * The measurement this file exists to produce: how long the hospital takes to answer a machine.
   * Deliberately reports the unanswered ones too, because a mean over only the answered prompts is
   * the flattering number and the wrong one.
   */
  recognitionStats(nowIso) {
    const now = nowIso || this.now();
    const answered = this.prompts.filter((p) => p.answeredAt);
    const delays = answered.map((p) => minutesBetween(p.raisedAt, p.answeredAt));
    return {
      raised: this.prompts.length,
      accepted: this.prompts.filter((p) => p.state === PROMPT.ACCEPTED).length,
      declined: this.prompts.filter((p) => p.state === PROMPT.DECLINED).length,
      stillOpen: this.prompts.filter((p) => p.state === PROMPT.OPEN).length,
      medianAnswerMinutes: delays.length ? delays.slice().sort((a, b) => a - b)[Math.floor(delays.length / 2)] : null,
      longestUnansweredMinutes: this.prompts
        .filter((p) => p.state === PROMPT.OPEN)
        .reduce((m, p) => Math.max(m, minutesBetween(p.raisedAt, now)), 0) || null,
    };
  }
}

export {
  PROMPT, REFRACTORY_MINUTES, ANSWER_WITHIN_MINUTES, STRENGTH_RANK,
  RecognitionError, RecognitionQueue,
  assessSepsisRecognition, screenSepsis,
};
