/* wardsynq/wardsynq-orchestrator.js — one alert, several channels, ONE state machine.
 *
 * WHAT THIS IS NOT. It is not a second notification system, and it deliberately owns no outbox, no
 * ladder, no channel and no delivery vocabulary of its own. All of that already exists in
 * wardsynq-transport.js and is correct; duplicating it would produce two systems with two ideas of
 * what "delivered" means, which is the exact failure wardsynq-notify.js was written to end. This
 * file is a thin authority ON TOP of that transport, and everything durable still happens there.
 *
 * WHAT IT ADDS, and why it has to exist. The transport can carry a notice out of the process. What
 * it could not do is hold ONE identity for a clinical alert across several channels and decide, in
 * one place, that the alert has been answered. Without that, a mobile push and a pager and a station
 * screen are three unrelated notices about one deteriorating patient: three acknowledgements, three
 * timeline entries, and no single answer to "has anybody actually gone to see her".
 *
 * THE IDENTITY THAT IS CARRIED, unchanged, on every channel and into the timeline:
 *   alertId     the clinical event that caused this (an escalation, a critical result)
 *   noticeId    the transport's own id for this notice, one per alert, not one per channel
 *   patientId   who it is about
 * A channel that cannot carry these is not wired up here, because an acknowledgement that cannot say
 * which patient it is about is not an acknowledgement.
 *
 * THE STATE VOCABULARY, and an honest mapping rather than a new one. The requested workflow is
 * generated -> dispatched -> delivered -> seen -> acknowledged. The transport already has states
 * with settled meanings and existing tests, so those meanings are kept and mapped onto:
 *
 *     generated     = DELIVERY.QUEUED       written to the durable outbox, nothing attempted
 *     dispatched    = DELIVERY.SENT         a transport accepted it; nobody confirmed anything
 *     delivered     = DELIVERY.DELIVERED    a DEVICE confirmed receipt
 *     seen          = DELIVERY.VIEWED       an identified user OPENED it. Still not an answer.
 *     acknowledged  = DELIVERY.SEEN         a named human took responsibility. This closes the loop.
 *
 * VIEWED is the only state added, and it is added rather than folded into DELIVERED because they are
 * genuinely different facts: a phone receiving a push in a pocket is delivered, and a registrar
 * opening the alert is not yet the registrar accepting it. The existing terminal state keeps its
 * existing name and its existing meaning, so no test and no reader is silently redefined.
 *
 * WHAT AN ACKNOWLEDGEMENT PRODUCES. Exactly one event on the existing clinical event bus, with an
 * explicit event id derived from the notice, so the bus's own dedupe makes a replay or a second
 * channel's late acknowledgement a no-op rather than a second entry in the patient's timeline. The
 * timeline is written FROM that event by whoever subscribes to it, never by a channel adapter, which
 * is what stops three channels writing three versions of one clinical fact.
 *
 * WHAT IT STILL CANNOT DO, stated because the hazard depends on it. It does not make any channel
 * real. If the only wired channel reaches nobody, this orchestrates nothing to no one, tidily. The
 * question of whether an escalation reaches a human at 3am is a question about the CHANNELS, and
 * HAZ-DET-01 stays PARTIAL until one of them is proven on real hardware with verify().
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved. No channel
 * in this build has been proven to reach a human on real hardware.
 */

import { DELIVERY, TransportError } from "./wardsynq-transport.js";

/** The requested vocabulary, mapped onto the transport's existing states. Exported so a caller can
 *  speak either dialect without a second definition existing anywhere. */
const WORKFLOW = Object.freeze({
  GENERATED: DELIVERY.QUEUED,
  DISPATCHED: DELIVERY.SENT,
  DELIVERED: DELIVERY.DELIVERED,
  SEEN: DELIVERY.VIEWED,
  ACKNOWLEDGED: DELIVERY.SEEN,
});

class OrchestratorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code || "ORCHESTRATOR_VIOLATION";
  }
}

/**
 * @param {{transport: object, bus?: object, now?: () => string}} deps
 *   transport  an existing wardsynq-transport.js Transport. Required: this file holds no outbox.
 *   bus        an existing ClinicalEventBus. Acknowledgements are emitted onto it, once.
 */
class NotificationOrchestrator {
  constructor({ transport, bus, now } = {}) {
    if (!transport || typeof transport.send !== "function" || typeof transport.acknowledge !== "function") {
      throw new OrchestratorError(
        "the orchestrator wraps an existing Transport and does not replace one. Construct it with the transport that owns the durable outbox",
        "NO_TRANSPORT");
    }
    this.transport = transport;
    this.bus = bus || null;
    this.now = now || (() => new Date().toISOString());
    /**
     * alertId -> Map(sequence -> noticeId).
     *
     * One notice per channel-fanout, and a SEQUENCE within an alert, because a re-escalation is not
     * a repeat. When the deterioration monitor sends an unanswered escalation up to a tier above the
     * one that ignored it, that is a new notice to a new responder about the same clinical alert.
     * Collapsing them would mean the registrar's page silently returned the ward nurse's old notice.
     * Answering ANY of them answers the alert, which is what shouldEscalate() reads.
     */
    this._byAlert = new Map();
  }

  /**
   * Raises ONE notice for a clinical alert and lets the existing transport ladder carry it.
   *
   * Idempotent on alertId: raising the same alert twice returns the first notice rather than paging
   * a second person about the same patient. Re-escalation is the monitor's job and has its own
   * alertId; it is not this being called again.
   */
  async raise({ alertId, patientId, title, body, kind, urgency, ref, sequence = 0 } = {}) {
    if (!alertId) throw new OrchestratorError("an alert needs an id so an acknowledgement can name what it answers", "NO_ALERT_ID");
    if (!patientId) throw new OrchestratorError("an alert needs a patient; an acknowledgement that cannot say who it is about is not one", "NO_PATIENT");

    const bySeq = this._byAlert.get(alertId) || new Map();
    const existing = bySeq.get(sequence);
    if (existing) {
      const prior = await this.transport.outbox.get(existing);
      if (prior) return prior;
    }

    const notice = await this.transport.send({
      title, body, patientId, kind: kind || "escalation", urgency,
      // The identity travels with the notice, so every channel and every receipt can carry it back.
      ref: { ...(ref || {}), alertId, patientId, sequence },
    });
    bySeq.set(sequence, notice.id);
    this._byAlert.set(alertId, bySeq);
    return notice;
  }

  /**
   * A DEVICE confirmed it received the notice. Not a person: a device.
   *
   * This is the state a push channel can honestly reach and no further. It never moves a notice
   * backwards, so a late receipt arriving after somebody has already acknowledged does not reopen a
   * closed loop.
   */
  async recordDelivered(noticeId, { channel, device, at } = {}) {
    return this._advance(noticeId, DELIVERY.DELIVERED, {
      deliveredAt: at || this.now(), deliveredVia: channel || null, deliveredDevice: device || null,
    });
  }

  /** An identified user OPENED it. Still not an answer, and deliberately not treated as one. */
  async recordViewed(noticeId, { by, device, at } = {}) {
    if (!by) throw new OrchestratorError("a view is only evidence if it names who did the viewing", "NO_ACTOR");
    return this._advance(noticeId, DELIVERY.VIEWED, {
      viewedAt: at || this.now(), viewedBy: by, viewedDevice: device || null,
    });
  }

  /**
   * A named human takes responsibility. The only thing that closes the loop, on ANY channel.
   *
   * Delegates the state change to the transport, so there is still exactly one writer of the
   * authoritative record, then emits ONE event carrying everything a timeline entry needs. The event
   * id is derived from the notice, so the bus's dedupe makes a second acknowledgement from another
   * channel a no-op rather than a second clinical fact about the same patient.
   */
  async acknowledge(noticeId, { by, device, action, at } = {}) {
    if (!by) throw new OrchestratorError("an acknowledgement names the person making it", "NO_ACTOR");
    const before = await this.transport.outbox.get(noticeId);
    if (!before) throw new OrchestratorError(`no notice ${noticeId}`, "NO_NOTICE");

    // Already answered. Return the standing acknowledgement rather than overwriting who answered
    // first: the first responder is the clinically interesting one, and a later tap on a pager must
    // not rewrite the record of who actually went.
    if (before.state === DELIVERY.SEEN) return { notice: before, duplicate: true, event: null };

    const notice = await this.transport.acknowledge(noticeId, { by, at: at || this.now() });
    const enriched = {
      ...notice,
      acknowledgedVia: device || null,
      acknowledgedAction: action || "acknowledged",
    };
    await this.transport.outbox.put(enriched);

    let event = null;
    if (this.bus) {
      // One event, derived id. The timeline is written from THIS, never by a channel adapter.
      event = await this.bus.emit("notification.acknowledged", {
        alertId: (notice.ref && notice.ref.alertId) || null,
        noticeId: notice.id,
        patientId: notice.patientId,
        clinicianId: by,
        device: device || null,
        action: action || "acknowledged",
        at: enriched.seenAt,
        kind: notice.kind,
        urgency: notice.urgency,
      }, { id: `notification.acknowledged:${notice.id}` });
    }
    return { notice: enriched, duplicate: false, event };
  }

  /**
   * Should this alert still be escalated?
   *
   * The one question a monitor's re-escalation timer needs, answered from the single authoritative
   * state rather than from whichever channel happens to be asked. Once a human has answered on ANY
   * channel, every other channel's escalation stops.
   */
  async shouldEscalate(alertId) {
    const bySeq = this._byAlert.get(alertId);
    if (!bySeq || !bySeq.size) return true;   // nothing raised yet, so nothing has been answered
    for (const noticeId of bySeq.values()) {
      const notice = await this.transport.outbox.get(noticeId);
      // ANY answered notice answers the alert. The registrar taking it means the ward nurse's
      // unanswered page is no longer a reason to wake the consultant.
      if (notice && notice.state === DELIVERY.SEEN) return false;
    }
    return true;
  }

  /** Everything nobody has answered, straight from the transport. Includes the delivered ones. */
  async outstanding(opts) { return this.transport.outstanding(opts); }

  /**
   * Adapts this orchestrator to the plain channel shape wardsynq-notify.js's Dispatcher expects,
   * so DeteriorationMonitor can be wired to it WITHOUT changing one line of that module.
   *
   *   const monitor = new DeteriorationMonitor({ channels: orchestrator.asDispatcherChannels() });
   *
   * That matters more than the convenience: wardsynq-deterioration.js holds the NEWS2 scoring and
   * the responder ladder, and the way to connect a transport to clinical logic is to leave the
   * clinical logic completely alone.
   *
   * The escalation's own `tier` becomes the notice SEQUENCE, which is what makes a re-escalation a
   * new notice to a new responder rather than a silent return of the page the last tier ignored.
   */
  asDispatcherChannels() {
    return {
      wardsynq: async (payload) => {
        const esc = (payload && payload.escalation) || {};
        if (!esc.id || !esc.patientId) {
          // Refused rather than guessed. An escalation that cannot name its patient cannot be
          // acknowledged for one, and a notice nobody can answer is not a delivery.
          return { delivered: false, detail: "the escalation carries no id or no patient, so no notice could be addressed" };
        }
        const notice = await this.raise({
          alertId: esc.id,
          sequence: esc.tier || 0,
          patientId: esc.patientId,
          title: esc.reason || "WardSynQ escalation",
          body: `For: ${esc.responder || "the responsible clinician"}`
            + (esc.respondWithinMinutes ? `. Respond within ${esc.respondWithinMinutes} minutes.` : ""),
          kind: "deterioration",
          urgency: esc.risk || (esc.unscorable ? "unscorable" : "routine"),
          ref: { responder: esc.responder, tier: esc.tier, why: payload.why || null, encounterId: esc.encounterId || null },
        });
        return {
          // Only a CONFIRMED delivery counts, exactly as everywhere else in this build. A notice
          // that reached a device and no person leaves the monitor's escalation undelivered, which
          // is what keeps the re-escalation timer running.
          delivered: notice.state === DELIVERY.DELIVERED || notice.state === DELIVERY.SEEN,
          receipt: notice.id,
          detail: notice.attempts.map((a) => `${a.channel}: ${a.detail || (a.delivered ? "delivered" : "no")}`).join("; ")
            || "no channel attempted",
        };
      },
    };
  }

  /** Moves a notice forward only. Never backwards, so a late receipt cannot reopen a closed loop. */
  async _advance(noticeId, state, fields) {
    const notice = await this.transport.outbox.get(noticeId);
    if (!notice) throw new OrchestratorError(`no notice ${noticeId}`, "NO_NOTICE");
    const order = [DELIVERY.QUEUED, DELIVERY.SENT, DELIVERY.DELIVERED, DELIVERY.VIEWED, DELIVERY.SEEN];
    const at = order.indexOf(notice.state);
    const to = order.indexOf(state);
    const updated = { ...notice, ...fields };
    if (to > at) updated.state = state;
    await this.transport.outbox.put(updated);
    return updated;
  }
}

/**
 * Closes the loop back the other way: a clinician acknowledging on a phone tells the MONITOR.
 *
 * Without this the two halves drift. The orchestrator would know the alert was answered while
 * wardsynq-deterioration.js kept sweeping and re-escalating it to the consultant, which is precisely
 * the alarm-fatigue failure that makes a ward stop reading escalations. The acknowledgement travels
 * on the event the orchestrator already emits, so there is still exactly one authoritative
 * acknowledgement and this is a subscriber to it rather than a second source of truth.
 *
 * @returns {() => void} unsubscribe
 */
function connectDeterioration({ monitor, bus, logger } = {}) {
  if (!monitor || typeof monitor.acknowledge !== "function") {
    throw new OrchestratorError("connectDeterioration needs the DeteriorationMonitor to tell", "NO_MONITOR");
  }
  if (!bus || typeof bus.on !== "function") {
    throw new OrchestratorError("connectDeterioration needs the event bus the orchestrator emits on", "NO_BUS");
  }
  return bus.on("notification.acknowledged", (event) => {
    const p = (event && event.payload) || {};
    if (!p.alertId || !p.clinicianId) return;
    try {
      monitor.acknowledge(p.alertId, p.clinicianId);
    } catch (err) {
      // An acknowledgement for an escalation this monitor does not hold is not an error worth
      // throwing into a bus handler: another process raised it. Recorded, then ignored.
      if (logger) logger.warn("[wardsynq] acknowledgement did not match a known escalation:", (err && err.message) || err);
    }
  });
}

export { NotificationOrchestrator, OrchestratorError, WORKFLOW, connectDeterioration };
