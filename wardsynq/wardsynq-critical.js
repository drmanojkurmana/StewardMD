/* wardsynq/wardsynq-critical.js — closed-loop critical result notification. HAZ-DIAG-01.
 *
 * The hazard is not "a critical value was not displayed". It is "a critical value was displayed and
 * nobody acted on it". Showing a red number on a screen nobody is looking at is not a control, so
 * this module models the whole loop and refuses to call it closed until a named clinician has
 * acknowledged the result and recorded what they did about it:
 *
 *   finalized -> classified -> responsible clinician identified -> dispatched -> delivered
 *             -> viewed -> acknowledged -> action documented -> closed
 *             with time-driven escalation running the whole way, and an append-only ledger
 *
 * DESIGN RULES, each of which exists because of a way this control could be defeated.
 *
 *  1. CLASSIFICATION IS OURS. A source system's own "critical" flag is advisory: it can raise a
 *     loop but it can never close one, and it is never a substitute for classifying the value
 *     against the site's own thresholds. An interface that trusted the sender's flag would inherit
 *     every one of the sender's bugs.
 *  2. THRESHOLDS ARE INJECTED and carry their own approval status. Clinical content belongs to the
 *     laboratory that signs it off, not to this file.
 *  3. NO STATE MAY BE SKIPPED. A loop cannot be acknowledged before it was delivered, and cannot be
 *     closed before it was acknowledged. A UI that offers an "acknowledge" button on an undelivered
 *     result cannot force one through here.
 *  4. TIME IS SERVER-ASSIGNED. Every timestamp comes from the injected clock, never from the
 *     caller, so an acknowledgement cannot be backdated to pretend escalation never became due.
 *  5. ESCALATION CANNOT BE SUPPRESSED. There is no flag, option or payload that stops a tier
 *     becoming due; the only thing that stops escalation is an actual acknowledgement.
 *  6. THE LEDGER IS APPEND-ONLY and every entry names an actor. Read access returns copies.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved. The
 * threshold content is unapproved seed data; see wardsynq/data/critical-thresholds.seed.json.
 *
 * node --test test/wardsynq-critical.test.mjs
 */

import { ageBandOf, isPaediatric, forBand, neonatalReady, BAND } from "./wardsynq-paediatrics.js";

/** Loop states, in the only order they may occur. */
const LOOP = Object.freeze({
  NOT_CRITICAL: "not-critical", // classified below the action limit; terminal, no loop is opened
  OPEN: "open",                 // critical, nobody told yet
  DISPATCHED: "dispatched",     // a channel was attempted
  DELIVERED: "delivered",       // a channel confirmed receipt
  VIEWED: "viewed",             // the responsible clinician opened it
  ACKNOWLEDGED: "acknowledged", // a named clinician accepted responsibility for it
  CLOSED: "closed",             // an action was documented; the loop is complete
});

const ORDER = Object.freeze([LOOP.OPEN, LOOP.DISPATCHED, LOOP.DELIVERED, LOOP.VIEWED, LOOP.ACKNOWLEDGED, LOOP.CLOSED]);

class CriticalResultError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CriticalResultError";
    this.code = code || "CRITICAL_LOOP_VIOLATION";
  }
}

const lower = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/* ------------------------------------------------------------------ classification */

/**
 * Classifies one observation against a threshold pack.
 *
 * Refuses to compare across units rather than converting: a potassium reported in a unit the pack
 * does not recognise is `unclassified`, which is a reportable condition, not a quiet pass. Silently
 * converting units inside a safety classifier is how a decimal point moves.
 *
 * @returns {{critical: boolean, unclassified: boolean, reason: string, direction: string|null,
 *   analyte: string|null, limit: number|null}}
 */
function classify(observation, pack, patient) {
  if (!observation || !pack) throw new CriticalResultError("classify() needs an observation and a threshold pack", "BAD_INPUT");
  const code = String(observation.code || "");
  const t = (pack.thresholds || {})[code];

  /* AGE BANDING. A threshold that does not state its band is an ADULT threshold, and applying one to
   * a child is a decimal-point error with a smaller patient attached: a potassium of 6.0 is critical
   * in an adult and ordinary in a neonate. So a paediatric patient is refused rather than
   * approximated, and the refusal names the bands the pack actually has.
   *
   * Passing no patient keeps the previous behaviour, because a caller that does not know who the
   * result belongs to has a different problem and this is not the place to fail it. */
  if (patient) {
    const banding = ageBandOf(patient, observation.effectiveAt || undefined);
    if (isPaediatric(banding.band) || banding.band === BAND.UNKNOWN) {
      const ready = neonatalReady(banding);
      if (!ready.ready) {
        return { critical: false, unclassified: true, direction: null, analyte: t ? t.analyte : null, limit: null,
          band: banding.band, reason: ready.reason };
      }
      const sel = forBand(t, banding.band);
      if (!sel.applies) {
        return { critical: false, unclassified: true, direction: null, analyte: t ? t.analyte : null, limit: null,
          band: banding.band, reason: `${t ? t.analyte : `code ${code}`}: ${sel.reason}` };
      }
    }
  }

  // Qualitative criticals: a positive blood culture has no numeric limit.
  const q = (pack.qualitativeCritical || []).find((x) => x.code === code);
  if (q) {
    const v = lower(observation.value);
    const hit = (q.values || []).some((needle) => v.includes(lower(needle)));
    return { critical: hit, unclassified: false, direction: null, analyte: q.analyte, limit: null,
      reason: hit ? `${q.analyte} reported as ${observation.value}` : `${q.analyte} not in a critical state` };
  }

  if (!t) {
    return { critical: false, unclassified: true, direction: null, analyte: null, limit: null,
      reason: `no critical threshold is defined for code ${code}` };
  }
  if (!isNum(observation.value)) {
    return { critical: false, unclassified: true, direction: null, analyte: t.analyte, limit: null,
      reason: `${t.analyte} value is not numeric and cannot be compared to a limit` };
  }
  // Unit discipline. An empty unit in the pack means the analyte is unitless (INR).
  const want = lower(t.unit), got = lower(observation.unit);
  if (want !== got) {
    return { critical: false, unclassified: true, direction: null, analyte: t.analyte, limit: null,
      reason: `${t.analyte} reported in "${observation.unit || "no unit"}" but the limit is defined in "${t.unit || "no unit"}"; refusing to convert inside a safety classifier` };
  }

  if (isNum(t.criticalHigh) && observation.value >= t.criticalHigh) {
    return { critical: true, unclassified: false, direction: "high", analyte: t.analyte, limit: t.criticalHigh,
      reason: `${t.analyte} ${observation.value} ${t.unit} at or above the critical limit ${t.criticalHigh}` };
  }
  if (isNum(t.criticalLow) && observation.value <= t.criticalLow) {
    return { critical: true, unclassified: false, direction: "low", analyte: t.analyte, limit: t.criticalLow,
      reason: `${t.analyte} ${observation.value} ${t.unit} at or below the critical limit ${t.criticalLow}` };
  }
  return { critical: false, unclassified: false, direction: null, analyte: t.analyte, limit: null,
    reason: `${t.analyte} ${observation.value} ${t.unit} is within action limits` };
}

/* ------------------------------------------------------------------ the loop */

class CriticalResultLoop {
  /**
   * @param {{pack: object, now?: () => string, bus?: object, store?: object,
   *   responsibleFor?: (ctx) => {clinicianId, teamId?, contacts?},
   *   channels?: Record<string, (msg) => Promise<{delivered: boolean, receipt?: string, detail?: string}>>}} deps
   */
  constructor(deps) {
    deps = deps || {};
    if (!deps.pack) throw new CriticalResultError("a threshold pack is required", "NO_PACK");
    this.pack = deps.pack;
    // Injected clock. Tests drive it; production passes the real one. Never read from a caller's
    // payload, so an acknowledgement cannot claim to have happened before it did.
    this.now = deps.now || (() => new Date().toISOString());
    this.bus = deps.bus || null;
    this.store = deps.store || null;
    this.responsibleFor = deps.responsibleFor || null;
    this.channels = deps.channels || {};
    this.escalationTiers = (deps.pack.escalation && deps.pack.escalation.tiers) || [];
  }

  /** Appends to the loop's immutable ledger. Nothing else may write to it. */
  _record(loop, event, actorId, detail) {
    loop.ledger.push(Object.freeze({ at: this.now(), event, actorId: actorId || null, detail: detail || null }));
  }

  async _emit(type, payload) {
    if (this.bus) await this.bus.emit(type, payload);
  }

  /**
   * A result has been finalized. Classifies it and, if critical, opens a loop.
   *
   * `sourceCritical` from an upstream system is recorded as advisory. It can RAISE a loop that our
   * own thresholds did not classify (better a loop nobody needed than a missed one), and it is
   * marked as such so an audit can see which classification actually fired. It can never close one.
   */
  async onResultFinalized(observation, ctx) {
    ctx = ctx || {};
    // The patient is passed so age banding applies. Without it a child's result would be
    // classified against adult limits, which is the gap this closes.
    const verdict = classify(observation, this.pack, ctx.patient || null);
    const sourceSaysCritical = !!observation.sourceCritical;

    /* UNASSESSABLE IS NOT NORMAL. A result the classifier could not judge, because the pack has no
     * band for this child, or the neonate has no gestational age, or the unit is unrecognised, must
     * reach a human. Letting it fall through as "not critical" would mean the system quietly
     * declined to look at a child's potassium and told nobody, which is at least as dangerous as
     * judging it wrongly. So it opens a loop of its own, marked for what it is. */
    const unassessable = verdict.unclassified === true;
    const critical = verdict.critical || sourceSaysCritical || unassessable;

    if (!critical) {
      await this._emit("critical.classified", { observationId: observation.id, critical: false, verdict });
      return { state: LOOP.NOT_CRITICAL, observationId: observation.id, verdict, ledger: [] };
    }

    const loop = {
      id: `crit-${observation.id}`,
      observationId: observation.id,
      patientId: observation.patientId,
      encounterId: observation.encounterId || null,
      state: LOOP.OPEN,
      openedAt: this.now(),
      verdict,
      raisedBy: verdict.critical ? "wardsynq-classification"
        : unassessable ? "unassessable-result"
          : "source-system-advisory",
      unassessable,
      sourceCritical: sourceSaysCritical,
      responsible: null,
      dispatches: [],
      escalations: [],
      acknowledgedBy: null,
      acknowledgedAt: null,
      action: null,
      closedAt: null,
      ledger: [],
    };
    this._record(loop, "opened", null, verdict.reason);

    // Identify who owns this result. A loop with nobody responsible is a loop nobody closes, so an
    // unresolvable owner is itself recorded and escalated rather than silently dropped.
    if (this.responsibleFor) {
      const r = await this.responsibleFor({ patientId: observation.patientId, encounterId: loop.encounterId, observation });
      if (r && r.clinicianId) {
        loop.responsible = r;
        this._record(loop, "responsible-identified", r.clinicianId, r.teamId ? `team ${r.teamId}` : null);
      } else {
        this._record(loop, "responsible-unresolved", null, "no responsible clinician could be identified");
      }
    } else {
      this._record(loop, "responsible-unresolved", null, "no routing configured");
    }

    if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
    await this._emit("critical.opened", { loop: this._view(loop) });
    return loop;
  }

  /** Attempts every configured channel for this loop's responsible clinician. */
  async dispatch(loop, channelNames) {
    this._assertLive(loop);
    const names = channelNames && channelNames.length ? channelNames : Object.keys(this.channels);
    if (!names.length) throw new CriticalResultError("no notification channel is configured", "NO_CHANNEL");

    for (const name of names) {
      const send = this.channels[name];
      if (!send) { this._record(loop, "dispatch-failed", null, `channel ${name} is not configured`); continue; }
      let result;
      try {
        result = await send({ loop: this._view(loop), to: loop.responsible, reason: loop.verdict.reason });
      } catch (err) {
        result = { delivered: false, detail: String(err && err.message || err) };
      }
      loop.dispatches.push({ channel: name, at: this.now(), delivered: !!result.delivered, receipt: result.receipt || null, detail: result.detail || null });
      this._record(loop, result.delivered ? "delivered" : "dispatch-failed", null, `${name}${result.detail ? `: ${result.detail}` : ""}`);
      if (result.delivered) this._advance(loop, LOOP.DELIVERED);
      else this._advance(loop, LOOP.DISPATCHED);
    }
    if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
    await this._emit("critical.dispatched", { loop: this._view(loop) });
    return loop;
  }

  /** The responsible clinician opened the result. Viewing is not acknowledgement. */
  async markViewed(loop, actorId) {
    this._assertLive(loop);
    if (!actorId) throw new CriticalResultError("viewing must name the clinician who viewed it", "NO_ACTOR");
    this._advance(loop, LOOP.VIEWED);
    this._record(loop, "viewed", actorId, null);
    if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
    await this._emit("critical.viewed", { loop: this._view(loop), actorId });
    return loop;
  }

  /**
   * A named clinician accepts responsibility. Requires that the result was actually delivered:
   * acknowledging something that was never successfully communicated is precisely the paperwork
   * exercise this control exists to prevent.
   */
  async acknowledge(loop, actorId, opts) {
    this._assertLive(loop);
    opts = opts || {};
    if (!actorId) throw new CriticalResultError("acknowledgement must name a clinician", "NO_ACTOR");
    if (rank(loop.state) < rank(LOOP.DELIVERED)) {
      throw new CriticalResultError("cannot acknowledge a result that was never delivered", "NOT_DELIVERED");
    }
    if (!this._authorised(loop, actorId)) {
      throw new CriticalResultError(`${actorId} is neither the responsible clinician nor an escalation recipient for this result`, "NOT_AUTHORISED");
    }
    loop.acknowledgedBy = actorId;
    loop.acknowledgedAt = this.now(); // server time, never the caller's
    this._advance(loop, LOOP.ACKNOWLEDGED);
    this._record(loop, "acknowledged", actorId, opts.note || null);
    if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
    await this._emit("critical.acknowledged", { loop: this._view(loop), actorId });
    return loop;
  }

  /**
   * Closes the loop with a documented action. Acknowledgement alone does not close it: "I have seen
   * the potassium of 7.1" is not a treatment, and a loop that closes on acknowledgement measures
   * reading rather than acting.
   */
  async documentAction(loop, actorId, action) {
    this._assertLive(loop);
    if (!actorId) throw new CriticalResultError("the action must name a clinician", "NO_ACTOR");
    if (loop.state !== LOOP.ACKNOWLEDGED) {
      throw new CriticalResultError("an action can only be documented after acknowledgement", "NOT_ACKNOWLEDGED");
    }
    const text = typeof action === "string" ? action.trim() : "";
    if (text.length < 10) {
      throw new CriticalResultError("a documented action must say what was actually done", "ACTION_TOO_THIN");
    }
    loop.action = { by: actorId, at: this.now(), text };
    loop.closedAt = loop.action.at;
    this._advance(loop, LOOP.CLOSED);
    this._record(loop, "closed", actorId, text);
    if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
    await this._emit("critical.closed", { loop: this._view(loop) });
    return loop;
  }

  /**
   * Evaluates escalation against the clock. Idempotent: a tier already raised is never raised
   * twice. There is deliberately no parameter that suppresses a tier.
   */
  async tick(loop) {
    if (loop.state === LOOP.CLOSED || loop.state === LOOP.NOT_CRITICAL) return [];
    // Escalation stops at acknowledgement, because someone has taken responsibility. It does NOT
    // stop at delivered or viewed: a result that was seen and abandoned is the hazard.
    if (loop.state === LOOP.ACKNOWLEDGED) return [];

    const elapsedMin = (Date.parse(this.now()) - Date.parse(loop.openedAt)) / 60000;
    const fired = [];
    for (const tier of this.escalationTiers) {
      if (elapsedMin < tier.afterMinutes) continue;
      if (loop.escalations.some((e) => e.afterMinutes === tier.afterMinutes)) continue;
      const esc = { at: this.now(), afterMinutes: tier.afterMinutes, to: tier.to, channel: tier.channel, reason: tier.reason };
      loop.escalations.push(esc);
      this._record(loop, "escalated", null, `${tier.to} after ${tier.afterMinutes} minutes: ${tier.reason}`);
      fired.push(esc);
      const send = this.channels[tier.channel];
      if (send) {
        try { await send({ loop: this._view(loop), to: { role: tier.to }, reason: tier.reason, escalation: true }); }
        catch (err) { this._record(loop, "escalation-dispatch-failed", null, String(err && err.message || err)); }
      }
    }
    if (fired.length) {
      if (this.store) await this.store.put({ resourceType: "CriticalResultLoop", ...loop });
      await this._emit("critical.escalated", { loop: this._view(loop), escalations: fired });
    }
    return fired;
  }

  /** Everyone entitled to acknowledge: the responsible clinician, and any escalation recipient. */
  _authorised(loop, actorId) {
    if (loop.responsible && loop.responsible.clinicianId === actorId) return true;
    if (loop.responsible && Array.isArray(loop.responsible.covering) && loop.responsible.covering.includes(actorId)) return true;
    return loop.escalations.some((e) => e.acceptedBy === actorId || e.to === actorId);
  }

  _assertLive(loop) {
    if (!loop || !loop.id) throw new CriticalResultError("not a critical result loop", "BAD_LOOP");
    if (loop.state === LOOP.CLOSED) throw new CriticalResultError("this loop is closed", "ALREADY_CLOSED");
    if (loop.state === LOOP.NOT_CRITICAL) throw new CriticalResultError("this result was not critical", "NOT_CRITICAL");
  }

  /** States only ever move forward. */
  _advance(loop, to) {
    if (rank(to) > rank(loop.state)) loop.state = to;
  }

  /** A copy safe to hand to a channel, the bus or a UI. The ledger cannot be written through it. */
  _view(loop) {
    return JSON.parse(JSON.stringify({ ...loop, ledger: loop.ledger }));
  }
}

function rank(state) {
  const i = ORDER.indexOf(state);
  return i === -1 ? -1 : i;
}

/**
 * Drives escalation. Without this, `tick()` is a method nobody calls and escalation is a promise
 * the system never keeps: the state machine would be correct and the clinical control absent.
 *
 * `pump()` is the unit of work and is deterministic, so escalation is testable without sleeping.
 * `start()` is the production wiring and is deliberately thin. A loop that throws during a pump is
 * recorded and the pump continues, because one broken loop must not stop every other patient's
 * result from escalating.
 */
class CriticalResultMonitor {
  /** @param {{engine: CriticalResultLoop, loops?: () => Iterable<object>, onError?: Function}} deps */
  constructor(deps) {
    deps = deps || {};
    if (!deps.engine) throw new CriticalResultError("a monitor needs a loop engine", "NO_ENGINE");
    this.engine = deps.engine;
    this.loops = deps.loops || (() => this._registered);
    this.onError = deps.onError || null;
    this._registered = [];
    this._timer = null;
    this.failures = [];
  }

  /** Registers a loop to be driven, when no external source of loops is supplied. */
  watch(loop) {
    if (!this._registered.includes(loop)) this._registered.push(loop);
    return loop;
  }

  /** One pass over every live loop. Returns everything that escalated in this pass. */
  async pump() {
    const fired = [];
    for (const loop of this.loops()) {
      try {
        const esc = await this.engine.tick(loop);
        if (esc.length) fired.push({ loopId: loop.id, escalations: esc });
      } catch (err) {
        const failure = { loopId: loop && loop.id, error: String(err && err.message || err) };
        this.failures.push(failure);
        if (this.onError) this.onError(failure);
        // deliberately continue: one broken loop must not silence every other patient's result
      }
    }
    return fired;
  }

  start(intervalMs = 30000) {
    if (this._timer) return this;
    this._timer = setInterval(() => { this.pump().catch(() => {}); }, intervalMs);
    if (typeof this._timer.unref === "function") this._timer.unref();
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    return this;
  }
}

/** Loops still owing somebody an answer, worst first. The ward's outstanding-results view. */
function outstanding(loops, nowIso) {
  const now = Date.parse(nowIso || new Date().toISOString());
  return loops
    .filter((l) => l.state !== LOOP.CLOSED && l.state !== LOOP.NOT_CRITICAL)
    .map((l) => ({ ...l, minutesOpen: Math.floor((now - Date.parse(l.openedAt)) / 60000) }))
    .sort((a, b) => b.minutesOpen - a.minutesOpen);
}

export { LOOP, ORDER, CriticalResultError, CriticalResultLoop, CriticalResultMonitor, classify, outstanding, rank };
