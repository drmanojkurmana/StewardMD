/* wardsynq/wardsynq-notify.js — the one place that decides whether a message actually got there.
 *
 * Two closed loops in this build depend on telling a human something: a critical result and a
 * deteriorating patient. Both had their own idea of what "sent" meant, and the deterioration monitor
 * had the weaker one -- it awaited a `notify` callback and treated anything that did not throw as
 * success. A hospital does not need two notification systems with two different definitions of
 * delivery, and the weaker definition is the one that quietly loses a patient.
 *
 * THE ONE RULE. Attempted is not delivered. A channel that throws, returns nothing, returns
 * `{delivered: false}`, or is not configured at all has NOT delivered, and the caller is told so
 * rather than left to assume. Silent success is the failure mode; every branch here exists to make
 * failure loud.
 *
 * NO CHANNEL IS NOT A QUIET NO-OP. A site that wires no channel gets NO_CHANNEL thrown at it. An
 * escalation system that appears to work while shouting into a void is worse than one that is
 * visibly switched off, because somebody is relying on it.
 *
 * WHAT THIS IS NOT. It is not a transport. It holds no pager, phone, bleep or push integration and
 * cannot acquire one: every channel is a function a site supplies. Whether a message reached a human
 * is only ever as true as that function's receipt.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-notify.test.mjs
 */

class NotifyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "NotifyError";
    this.code = code || "NOTIFY_VIOLATION";
  }
}

/** One attempt on one channel. `delivered` is only ever true where the channel said so. */
const attemptOf = (channel, at, result, detail) => ({
  channel,
  at,
  delivered: !!(result && result.delivered === true),
  receipt: (result && result.receipt) || null,
  detail: detail || (result && result.detail) || null,
});

class Dispatcher {
  /**
   * @param {{channels?: Record<string, (payload) => Promise<{delivered: boolean, receipt?: string,
   *   detail?: string}>>, now?: () => string}} deps
   */
  constructor(deps = {}) {
    this.channels = deps.channels || {};
    this.now = deps.now || (() => new Date().toISOString());
  }

  get configured() {
    return Object.keys(this.channels);
  }

  /**
   * Attempts the named channels, or every configured channel where none are named.
   *
   * Never throws for a channel failure: a failed channel is a recorded attempt, because the record
   * of having tried and failed is exactly what an investigation needs. It throws only when there was
   * nothing to try, which is a configuration error rather than a delivery outcome.
   *
   * RETRY IS OPT-IN AND BOUNDED, added 2026-09-10. Every existing caller passes no `opts` and gets
   * EXACTLY today's behaviour - one attempt per channel, zero change to any test or call site that
   * predates this. A caller who names `retries` gets a real, bounded re-attempt of the SAME channel
   * function before it is recorded as failed - for the transient case (a flaky network call, a
   * provider's momentary 503), which is the actual majority of notification failures and the one
   * this file could not previously tell apart from a genuinely broken channel. It never fakes
   * delivery: a channel that fails every attempt is still recorded as failed, honestly, same as
   * before - this only widens the WINDOW in which a real success can still be recorded as one.
   *
   * @param {object} payload
   * @param {string[]} [channelNames]
   * @param {{retries?: number, retryDelayMs?: number}} [opts]
   * @returns {{delivered: boolean, attempts: object[]}}
   */
  async send(payload, channelNames, opts) {
    const names = channelNames && channelNames.length ? channelNames : this.configured;
    if (!names.length) {
      throw new NotifyError("no notification channel is configured, so nothing can be told to anybody", "NO_CHANNEL");
    }
    const retries = Math.max(0, Math.min(5, Number((opts && opts.retries) || 0)));
    const delayMs = Math.max(0, Number((opts && opts.retryDelayMs) || 0));
    const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

    const attempts = [];
    for (const name of names) {
      const send = this.channels[name];
      if (typeof send !== "function") {
        attempts.push(attemptOf(name, this.now(), null, `channel ${name} is not configured`));
        continue;
      }
      let last = null, used = 0;
      for (let attempt = 0; attempt <= retries; attempt++) {
        used = attempt;
        try {
          const result = await send(payload);
          // A channel that returns nothing has not confirmed anything. Absence of a result is not a
          // receipt, and this is the branch a well-meaning `async () => {}` stub falls down.
          last = attemptOf(name, this.now(), result,
            result === undefined || result === null ? "channel returned no result, so delivery is unconfirmed" : null);
        } catch (err) {
          // A throwing channel is a failed attempt, not a crash of the escalation. The other
          // channels still get their turn, because a broken pager is not a reason to skip the phone.
          last = attemptOf(name, this.now(), null, String((err && err.message) || err));
        }
        if (last.delivered || attempt === retries) break;
        await sleep(delayMs);
      }
      // The RETRY COUNT travels with the attempt only when retry was actually requested, so a
      // caller who never asked for it sees the EXACT SAME shape it always got - the zero-behaviour-
      // change guarantee this feature depends on. A caller who did ask can tell "delivered on the
      // first try" from "delivered on the third".
      attempts.push(retries > 0 ? { ...last, retriesUsed: used } : last);
    }
    return { delivered: attempts.some((a) => a.delivered), attempts };
  }
}

export { Dispatcher, NotifyError, attemptOf };
