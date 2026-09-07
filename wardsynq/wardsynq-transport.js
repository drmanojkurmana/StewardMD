/* wardsynq/wardsynq-transport.js — actually telling somebody.
 *
 * Three hazards in this build have been PARTIAL for one reason: the escalations are computed
 * correctly and delivered to nobody. wardsynq-notify.js established what delivery MEANS and refused
 * to pretend; this file is the part that carries a message out of the process and, more importantly,
 * knows the difference between having sent one and somebody having read it.
 *
 *   1. SENT IS NOT DELIVERED IS NOT SEEN. Three states, never collapsed. An HTTP 200 means a server
 *      accepted some bytes. A pager gateway accepting a message does not mean the pager beeped, and
 *      a pager beeping does not mean anybody looked at it. Only a human acknowledging closes the
 *      loop, and until then the escalation is OUTSTANDING however many transports reported success.
 *   2. THE OUTBOX IS DURABLE AND SURVIVES RESTART. An escalation lost to a page reload is an
 *      escalation that never happened. Every notice is written to a backend before any transport is
 *      attempted, so a crash between deciding and sending leaves a record that says "we decided and
 *      we do not know whether it went", which is recoverable. The reverse order is not.
 *   3. FAILOVER IS A LADDER, NOT A BROADCAST. Sending to every channel at once looks thorough and
 *      trains a ward to ignore all of them. Channels are tried in order and the ladder stops at the
 *      first CONFIRMED delivery, not the first one that did not throw.
 *   4. A SILENT CHANNEL IS THE FAILURE MODE. A pager integration that broke three weeks ago looks
 *      exactly like one that works, right up until somebody dies. Every channel carries its last
 *      success, and a channel that has never succeeded is UNVERIFIED and says so rather than being
 *      counted as available.
 *   5. NOTHING IS DELETED. Delivered notices are retained with their whole attempt history, because
 *      the question after an incident is not "was it sent" but "what exactly happened and when".
 *
 * WHAT THIS STILL CANNOT DO. It does not contain a pager, an SMS gateway or a phone system, and it
 * cannot: those need a vendor, credentials and a contract. What it contains is the seam, three
 * adapters that work with no vendor at all (an in-app station queue, the browser's own notifications,
 * and an HTTP webhook), and the honesty machinery around them. A site still has to wire a real
 * transport and PROVE it with a test message, which is why `verify()` exists.
 *
 * NOT MODELLED: message templating and localisation, on-call rota resolution (who is carrying the
 * bleep is a question for a rota system), quiet hours, and delivery receipts from a carrier.
 *
 * STATUS: IMPLEMENTED and TESTED. No real transport is integrated in this build.
 *
 * node --test test/wardsynq-transport.test.mjs
 */

import { NotifyError } from "./wardsynq-notify.js";

/**
 * The three states, kept apart on purpose. The whole file exists because most systems have one.
 */
const DELIVERY = Object.freeze({
  QUEUED: "queued",         // written to the outbox, nothing attempted yet
  SENT: "sent",             // a transport accepted it; nobody has confirmed anything
  DELIVERED: "delivered",   // the transport confirmed it reached a device
  // An identified user OPENED it. Between DELIVERED and SEEN because they are different facts: a
  // phone buzzing in a pocket is delivered, and a registrar opening the alert is not yet a registrar
  // accepting it. Set by wardsynq-orchestrator.js; nothing in this file moves a notice here.
  VIEWED: "viewed",
  SEEN: "seen",             // a HUMAN acknowledged it. The only state that closes a loop.
  FAILED: "failed",         // every channel on the ladder was tried and none delivered
});

const CHANNEL_HEALTH = Object.freeze({
  UNVERIFIED: "unverified", // never succeeded. NOT the same as healthy.
  HEALTHY: "healthy",
  DEGRADED: "degraded",     // succeeded once, but the recent attempts are failing
  DOWN: "down",
});

/** A channel that has not succeeded in this long is not to be relied on. Local policy. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

class TransportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "TransportError";
    this.code = code || "TRANSPORT_VIOLATION";
  }
}

/* ------------------------------------------------------------------ the durable outbox */

/** In-memory outbox, for tests and for a harness. A real deployment uses the IndexedDB one. */
class MemoryOutbox {
  constructor() { this.rows = new Map(); }
  async put(notice) { this.rows.set(notice.id, JSON.parse(JSON.stringify(notice))); return notice; }
  async get(id) { const r = this.rows.get(id); return r ? JSON.parse(JSON.stringify(r)) : null; }
  async all() { return [...this.rows.values()].map((r) => JSON.parse(JSON.stringify(r))); }
}

/**
 * IndexedDB outbox. Resolves on transaction completion, not on request success, which is the
 * distinction that decides whether a notice survives the tab closing a moment later.
 */
class IndexedDBOutbox {
  constructor({ dbName = "wardsynq", store = "outbox", indexedDB } = {}) {
    this.dbName = dbName;
    this.store = store;
    this.idb = indexedDB || (typeof globalThis !== "undefined" ? globalThis.indexedDB : null);
    if (!this.idb) throw new TransportError("no IndexedDB available; pass one or use MemoryOutbox", "NO_IDB");
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = this.idb.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.store)) db.createObjectStore(this.store, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async put(notice) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, "readwrite");
      tx.objectStore(this.store).put(notice);
      // oncomplete, not onsuccess. onsuccess fires when the request is accepted; oncomplete fires
      // when it is durable, and the gap between them is where a closing tab loses an escalation.
      tx.oncomplete = () => resolve(notice);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(id) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.store, "readonly").objectStore(this.store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async all() {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.store, "readonly").objectStore(this.store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
}

/* ------------------------------------------------------------------ channel adapters */

/**
 * The in-app ward station queue.
 *
 * The only adapter here that is honest about being a real, usable transport TODAY: a screen at the
 * nurses' station that lists outstanding escalations. It confirms DELIVERED when the queue accepts
 * the notice, and SEEN only when somebody at the station acknowledges it, which is the distinction
 * this whole file is about. It also has the property a pager does not: it cannot silently stop
 * working without the screen going blank, which somebody notices.
 */
function stationQueueChannel(queue) {
  if (!queue || typeof queue.push !== "function") {
    throw new TransportError("a station queue channel needs a queue with push()", "NO_QUEUE");
  }
  return async (payload) => {
    queue.push(payload);
    return {
      delivered: true,
      receipt: `station:${queue.length}`,
      // Stated on every send. The queue reaching a screen is not somebody reading the screen.
      detail: "queued to the ward station display; DELIVERED means it is on the screen, not that anybody has looked at it",
    };
  };
}

/**
 * The browser's own notification, for a workstation that is logged in and unlocked.
 *
 * Genuinely useful and genuinely limited, and the limits are the reason it is not the only channel:
 * it needs permission, it needs the tab alive, and on a locked or logged-out workstation it reaches
 * nobody. It reports DELIVERED only when the notification actually constructs.
 */
function browserNotificationChannel({ Notification: N } = {}) {
  const Ctor = N || (typeof globalThis !== "undefined" ? globalThis.Notification : null);
  return async (payload) => {
    if (!Ctor) return { delivered: false, detail: "no Notification API in this environment" };
    if (Ctor.permission !== "granted") {
      return { delivered: false, detail: `notification permission is "${Ctor.permission}", so nothing was shown` };
    }
    const n = new Ctor(payload.title || "WardSynQ", { body: payload.body || "", tag: payload.id, requireInteraction: true });
    return { delivered: true, receipt: `notification:${payload.id}`, detail: "shown on this workstation only; a locked or logged-out machine reaches nobody", handle: n };
  };
}

/**
 * An HTTP webhook to a site-supplied endpoint.
 *
 * The important line is the one about what a 2xx means. It means a server accepted bytes. It is
 * evidence of SENT and it is NOT evidence that a human was reached, and reporting it as delivery is
 * the single most common way a hospital comes to believe it has a working escalation system.
 */
function webhookChannel({ url, fetch: f, headers = {}, timeoutMs = 5000 } = {}) {
  if (!url) throw new TransportError("a webhook channel needs a url", "NO_URL");
  const doFetch = f || (typeof globalThis !== "undefined" ? globalThis.fetch : null);
  return async (payload) => {
    if (!doFetch) return { delivered: false, detail: "no fetch available in this environment" };
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) {
        return { delivered: false, detail: `endpoint returned ${res ? res.status : "no response"}` };
      }
      return {
        // NOT `delivered: true`. A 2xx is acceptance of bytes by a server, and calling that delivery
        // is how a ward comes to believe in an escalation path nobody has ever received a page from.
        delivered: false,
        sent: true,
        receipt: `webhook:${res.status}`,
        detail: "the endpoint accepted the message. That is SENT, not delivered: nothing here knows whether it reached a person, and only an acknowledgement will say so",
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      return { delivered: false, detail: String((err && err.message) || err) };
    }
  };
}

/* ------------------------------------------------------------------ the transport */

/**
 * Carries notices out, durably, up a ladder, and tracks what actually happened.
 *
 * @param {{outbox?: object, channels: {name: string, send: Function, tier?: number}[],
 *   now?: () => string, staleAfterMs?: number}} deps
 */
class Transport {
  constructor({ outbox, channels, now, staleAfterMs } = {}) {
    if (!Array.isArray(channels) || !channels.length) {
      throw new TransportError(
        "a transport with no channels can carry nothing. Construct it with at least one, or do not construct it: a transport that silently carries nothing is worse than an absent one, because something upstream believes it works",
        "NO_CHANNELS");
    }
    for (const c of channels) {
      if (!c.name || typeof c.send !== "function") throw new TransportError("each channel needs a name and a send()", "BAD_CHANNEL");
    }
    this.outbox = outbox || new MemoryOutbox();
    this.now = now || (() => new Date().toISOString());
    this.staleAfterMs = typeof staleAfterMs === "number" ? staleAfterMs : STALE_AFTER_MS;
    // Sorted into a ladder. Same tier is tried in order; the ladder stops at the first CONFIRMED
    // delivery rather than the first thing that did not throw.
    this.channels = channels.slice().sort((a, b) => (a.tier || 0) - (b.tier || 0));
    this.health = new Map(this.channels.map((c) => [c.name, {
      name: c.name, lastSuccessAt: null, lastAttemptAt: null,
      consecutiveFailures: 0, attempts: 0, successes: 0,
    }]));
    this._seq = 0;
  }

  /**
   * Sends a notice, durably first.
   *
   * The order is the point: the notice is in the outbox before any transport is touched, so a crash
   * mid-send leaves a record saying "decided, outcome unknown", which somebody can act on. The
   * reverse order leaves nothing at all.
   */
  async send({ title, body, patientId, kind, urgency, ref } = {}) {
    if (!title) throw new TransportError("a notice needs a title; an empty page is a page nobody can act on", "NO_TITLE");

    const notice = {
      id: `ntc-${++this._seq}-${Date.parse(this.now()) || Date.now()}`,
      title, body: body || null, patientId: patientId || null,
      kind: kind || "escalation", urgency: urgency || "routine", ref: ref || null,
      createdAt: this.now(),
      state: DELIVERY.QUEUED,
      attempts: [],
      seenAt: null, seenBy: null,
    };
    await this.outbox.put(notice);   // durable BEFORE any transport is attempted

    for (const channel of this.channels) {
      const stat = this.health.get(channel.name);
      stat.attempts += 1;
      stat.lastAttemptAt = this.now();

      let result;
      try {
        result = await channel.send(notice);
      } catch (err) {
        result = { delivered: false, detail: String((err && err.message) || err) };
      }

      const attempt = {
        channel: channel.name, at: this.now(),
        delivered: result && result.delivered === true,
        sent: !!(result && (result.sent || result.delivered)),
        receipt: (result && result.receipt) || null,
        detail: (result && result.detail) || null,
      };
      notice.attempts.push(attempt);

      if (attempt.delivered) {
        stat.successes += 1;
        stat.lastSuccessAt = attempt.at;
        stat.consecutiveFailures = 0;
        notice.state = DELIVERY.DELIVERED;
        await this.outbox.put(notice);
        // The ladder stops HERE, at a confirmed delivery. Continuing would page four people for one
        // patient, which is how a ward learns to ignore the fifth.
        return notice;
      }

      stat.consecutiveFailures += 1;
      if (attempt.sent && notice.state === DELIVERY.QUEUED) notice.state = DELIVERY.SENT;
      await this.outbox.put(notice);
    }

    if (notice.state === DELIVERY.QUEUED) notice.state = DELIVERY.FAILED;
    await this.outbox.put(notice);
    return notice;
  }

  /**
   * A human acknowledges. This is the ONLY thing that closes a loop.
   *
   * Not the transport reporting success, not the notification appearing, not the webhook returning
   * 200. A person, named, saying they have it.
   */
  async acknowledge(noticeId, { by, at } = {}) {
    if (!by) throw new TransportError("an acknowledgement names the person making it", "NO_ACTOR");
    const notice = await this.outbox.get(noticeId);
    if (!notice) throw new TransportError(`no notice ${noticeId}`, "NO_NOTICE");
    notice.state = DELIVERY.SEEN;
    notice.seenAt = at || this.now();
    notice.seenBy = by;
    await this.outbox.put(notice);
    return notice;
  }

  /**
   * Notices nobody has acknowledged. The number a ward should be looking at.
   *
   * Deliberately includes the DELIVERED ones. A notice that reached a device and no human is the
   * dangerous state, and a dashboard that counts only failures shows zero while the pager sits face
   * down on a desk.
   */
  async outstanding({ olderThanMinutes = 0 } = {}) {
    const now = Date.parse(this.now());
    return (await this.outbox.all())
      .filter((n) => n.state !== DELIVERY.SEEN)
      .filter((n) => (now - Date.parse(n.createdAt)) / 60000 >= olderThanMinutes)
      .map((n) => ({
        ...n,
        outstandingMinutes: Math.round((now - Date.parse(n.createdAt)) / 60000),
        reading: n.state === DELIVERY.VIEWED
          // Worse than DELIVERED, not better. Somebody opened this and walked away from it.
          ? `opened by ${n.viewedBy || "an identified user"} and NOT acknowledged; a person has seen this and not taken it`
          : n.state === DELIVERY.DELIVERED
            ? "reached a device and no human has acknowledged it"
            : n.state === DELIVERY.SENT
            ? "a transport accepted it and nothing has confirmed it reached anybody"
            : n.state === DELIVERY.FAILED
              ? "every channel was tried and none delivered"
              : "queued and not yet attempted",
      }));
  }

  /**
   * Sends a test message and records the result against the channel's health.
   *
   * This exists because a pager integration that broke three weeks ago looks exactly like one that
   * works. A site must be able to prove a channel carries a message, on demand, without waiting for
   * a real patient to need it.
   */
  async verify(channelName, { by } = {}) {
    if (!by) throw new TransportError("a verification names who ran it, so the result is attributable", "NO_ACTOR");
    const channel = this.channels.find((c) => c.name === channelName);
    if (!channel) throw new TransportError(`no channel ${channelName}`, "NO_CHANNEL");

    const stat = this.health.get(channelName);
    stat.attempts += 1;
    stat.lastAttemptAt = this.now();

    let result;
    try {
      result = await channel.send({
        id: `verify-${this.now()}`, title: "WardSynQ channel test",
        body: `Test message requested by ${by}. No patient is involved and no action is required.`,
        kind: "verification", urgency: "routine",
      });
    } catch (err) {
      result = { delivered: false, detail: String((err && err.message) || err) };
    }

    const ok = result && result.delivered === true;
    if (ok) { stat.successes += 1; stat.lastSuccessAt = this.now(); stat.consecutiveFailures = 0; }
    else stat.consecutiveFailures += 1;

    return {
      channel: channelName, verified: ok, by, at: this.now(),
      detail: (result && result.detail) || null,
      note: ok ? null
        : "This channel did not carry a test message. Until it does, anything relying on it is relying on nothing.",
    };
  }

  /** The health of every channel, with UNVERIFIED distinguished from healthy. */
  channelHealth() {
    const now = Date.parse(this.now());
    const rows = [...this.health.values()].map((s) => {
      let state;
      if (!s.lastSuccessAt) state = CHANNEL_HEALTH.UNVERIFIED;
      else if (s.consecutiveFailures >= 3) state = CHANNEL_HEALTH.DOWN;
      else if (now - Date.parse(s.lastSuccessAt) > this.staleAfterMs) state = CHANNEL_HEALTH.DEGRADED;
      else if (s.consecutiveFailures > 0) state = CHANNEL_HEALTH.DEGRADED;
      else state = CHANNEL_HEALTH.HEALTHY;
      return {
        ...s, state,
        reading: state === CHANNEL_HEALTH.UNVERIFIED
          ? `${s.name} has never successfully carried a message. It is UNVERIFIED, which is not the same as healthy, and nothing should be argued to be safe on the strength of it.`
          : state === CHANNEL_HEALTH.DOWN
            ? `${s.name} has failed ${s.consecutiveFailures} times in a row.`
            : state === CHANNEL_HEALTH.DEGRADED
              ? `${s.name} last succeeded at ${s.lastSuccessAt}.`
              : null,
      };
    });

    const usable = rows.filter((r) => r.state === CHANNEL_HEALTH.HEALTHY);
    return {
      channels: rows,
      healthy: usable.length,
      // The sentence a ward needs at the top of a status page.
      reading: usable.length === 0
        ? "NO channel is currently known to work. Every escalation this system raises may be reaching nobody. Verify a channel before relying on any alert."
        : `${usable.length} of ${rows.length} channels are known to be working.`,
    };
  }

  /** Adapts this transport to the plain function shape wardsynq-notify.js's Dispatcher expects. */
  asDispatcherChannels() {
    return {
      transport: async (payload) => {
        const notice = await this.send({
          title: payload.reason || (payload.escalation && payload.escalation.reason) || "WardSynQ escalation",
          body: payload.to ? `For: ${typeof payload.to === "string" ? payload.to : JSON.stringify(payload.to)}` : null,
          patientId: (payload.escalation && payload.escalation.patientId) || (payload.notice && payload.notice.patientId) || null,
          ref: payload,
        });
        return {
          delivered: notice.state === DELIVERY.DELIVERED || notice.state === DELIVERY.SEEN,
          receipt: notice.id,
          detail: notice.attempts.map((a) => `${a.channel}: ${a.detail || (a.delivered ? "delivered" : "no")}`).join("; "),
        };
      },
    };
  }
}

/**
 * Drives the sweeps that were caller-driven everywhere else in this build.
 *
 * The monitors all had a `sweep()` nothing called on a timer, which meant a correct re-escalation
 * ladder that never re-escalated. This is the thing that calls them, and it keeps going when one
 * throws, because one broken monitor must not stop the others.
 */
class SweepDriver {
  constructor({ intervalMs = 60_000, setInterval: si, clearInterval: ci, onError } = {}) {
    this.intervalMs = intervalMs;
    this.setInterval = si || setInterval;
    this.clearInterval = ci || clearInterval;
    this.onError = onError || null;
    this.tasks = [];
    this.handle = null;
    this.ticks = 0;
    this.errors = [];
  }

  add(name, fn) {
    if (typeof fn !== "function") throw new TransportError("a sweep task must be a function", "BAD_TASK");
    this.tasks.push({ name, fn });
    return this;
  }

  /** One pass. Exposed so a test, or a caller preferring its own scheduler, can drive it. */
  async tick() {
    this.ticks += 1;
    const results = [];
    for (const task of this.tasks) {
      try {
        results.push({ name: task.name, ok: true, result: await task.fn() });
      } catch (err) {
        // One monitor throwing must never stop the rest. A ward has more than one patient.
        const e = { name: task.name, ok: false, error: String((err && err.message) || err), at: new Date().toISOString() };
        this.errors.push(e);
        results.push(e);
        if (this.onError) this.onError(e);
      }
    }
    return results;
  }

  start() {
    if (this.handle) return this;
    this.handle = this.setInterval(() => { this.tick(); }, this.intervalMs);
    if (this.handle && typeof this.handle.unref === "function") this.handle.unref();
    return this;
  }

  stop() {
    if (this.handle) { this.clearInterval(this.handle); this.handle = null; }
    return this;
  }
}

export {
  DELIVERY, CHANNEL_HEALTH, STALE_AFTER_MS, TransportError,
  MemoryOutbox, IndexedDBOutbox,
  stationQueueChannel, browserNotificationChannel, webhookChannel,
  Transport, SweepDriver,
};
