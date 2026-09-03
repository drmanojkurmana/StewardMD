/* wardsynq/wardsynq-events.js — WardSynQ P0: Clinical Event Bus.
 *
 * In-process pub/sub that every WardSynQ subsystem (eMAR, safety engine, AI agents, EMR UI,
 * future interop adapters under the Integration Hub) uses instead of calling each other directly.
 * An adapter (GHIS/Ward Sync today; HL7 v2, FHIR R4, DICOM, LIS, ABDM, IoMT later) normalizes
 * external data into the canonical model (wardsynq-model.js) and emits it here — it never reaches
 * into safety/workflow/AI code directly. This file has no adapter-specific knowledge.
 *
 * Provides:
 *  - emit/on/off with per-event vector-clock stamping (causal ordering across nodes/tabs)
 *  - idempotency (duplicate event ids are dropped, not re-delivered)
 *  - a Dead-Letter Queue for handlers that throw, with bounded retry
 *
 * node --test test/wardsynq-p0-core.test.mjs
 */

let seq = 0;
function localEventId() {
  seq += 1;
  return `evt-${Date.now().toString(36)}-${seq.toString(36)}`;
}

/**
 * @typedef {{id: string, type: string, payload: any, vectorClock: Record<string, number>,
 *   emittedAt: string, attempts: number}} ClinicalEvent
 */

class ClinicalEventBus {
  /**
   * @param {{nodeId?: string, maxRetries?: number, idempotencyWindow?: number}} [opts]
   *   nodeId identifies this bus instance in the vector clock (e.g. a tab id or worker id).
   *   idempotencyWindow bounds the seen-id cache so it does not grow unbounded in a long session.
   */
  constructor(opts) {
    opts = opts || {};
    this.nodeId = opts.nodeId || "local";
    this.maxRetries = opts.maxRetries ?? 3;
    this.idempotencyWindow = opts.idempotencyWindow ?? 5000;
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map();
    /** @type {Map<string, number>} vector clock, one counter per known node */
    this._clock = new Map([[this.nodeId, 0]]);
    /** @type {string[]} ring buffer of seen event ids, for idempotency */
    this._seenOrder = [];
    /** @type {Set<string>} */
    this._seen = new Set();
    /** @type {ClinicalEvent[]} events whose handlers exhausted retries */
    this.deadLetterQueue = [];
  }

  /** Advances and returns a snapshot of this node's vector clock. */
  _tick() {
    this._clock.set(this.nodeId, (this._clock.get(this.nodeId) || 0) + 1);
    return Object.fromEntries(this._clock);
  }

  /** Merges an incoming vector clock (e.g. from another tab/device) into this bus's view. */
  mergeClock(remoteClock) {
    for (const [node, count] of Object.entries(remoteClock || {})) {
      this._clock.set(node, Math.max(this._clock.get(node) || 0, count));
    }
  }

  _rememberSeen(id) {
    if (this._seen.has(id)) return false; // already delivered — caller should skip
    this._seen.add(id);
    this._seenOrder.push(id);
    if (this._seenOrder.length > this.idempotencyWindow) {
      const evicted = this._seenOrder.shift();
      this._seen.delete(evicted);
    }
    return true;
  }

  /**
   * Subscribes a handler to an event type. Handlers may be async; a rejection/throw counts as a
   * failed delivery attempt and is retried up to maxRetries before landing in the DLQ.
   * @returns {() => void} unsubscribe function
   */
  on(type, handler) {
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    this._handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    const set = this._handlers.get(type);
    if (set) set.delete(handler);
  }

  /**
   * Emits a clinical event to all subscribers of `type`.
   * @param {string} type
   * @param {any} payload
   * @param {{id?: string}} [opts] pass an explicit id (e.g. from an adapter's source event) so
   *   redelivery after a reconnect is deduplicated instead of double-processed.
   * @returns {Promise<ClinicalEvent>}
   */
  async emit(type, payload, opts) {
    if (typeof type !== "string" || !type) throw new TypeError("event type is required");
    opts = opts || {};
    const id = opts.id || localEventId();
    // Dedupe BEFORE stamping the clock. A redelivered event (adapter reconnect, sync replay) is not
    // a new causal step; ticking for it would inflate the clock and make ordering comparisons lie.
    if (!this._rememberSeen(id)) {
      return { id, type, payload, vectorClock: Object.fromEntries(this._clock), emittedAt: new Date().toISOString(), attempts: 0, duplicate: true };
    }
    const event = {
      id,
      type,
      payload,
      vectorClock: this._tick(),
      emittedAt: new Date().toISOString(),
      attempts: 0,
      duplicate: false,
    };

    const handlers = Array.from(this._handlers.get(type) || []);
    for (const handler of handlers) {
      await this._deliver(event, handler);
    }
    return event;
  }

  async _deliver(event, handler) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      event.attempts = attempt;
      try {
        await handler(event);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    this.deadLetterQueue.push({ event, error: String(lastError && lastError.message || lastError) });
  }

  /** Number of handlers currently subscribed to a type (test/debug helper). */
  listenerCount(type) {
    const set = this._handlers.get(type);
    return set ? set.size : 0;
  }

  /** Drains and returns the current DLQ, for a supervisor/alerting path to inspect. */
  drainDeadLetters() {
    const drained = this.deadLetterQueue;
    this.deadLetterQueue = [];
    return drained;
  }
}

export { ClinicalEventBus };
