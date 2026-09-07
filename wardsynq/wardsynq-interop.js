/* wardsynq/wardsynq-interop.js — the Integration Hub.
 *
 * Every hospital system that will ever feed WardSynQ arrives through here: GHIS today, then HL7 v2,
 * FHIR R4, DICOMweb, a LIS, ABDM, an IoMT gateway. The point of a hub is not routing, which is easy.
 * It is that a feed from another hospital's software cannot do more damage than a feed is allowed to
 * do, no matter what it sends or how badly it is written.
 *
 *   payload -> claimed by exactly one adapter -> normalised to the canonical model
 *           -> written as that ADAPTER's actor, capped below EXECUTE
 *           -> announced on the bus -> anything unclaimed or unmappable is QUARANTINED
 *
 * FOUR RULES, each of which is a way an interop layer normally goes wrong.
 *
 *  1. AN ADAPTER IS NEVER TRUSTED TO COMMIT. It writes as an ADAPTER-kind actor, which the actor
 *     model caps at DRAFT. An upstream system asserting a signed, active prescription gets a draft
 *     and a denial in the audit. Interop is where "the other system said so" turns into clinical
 *     records, and "the other system said so" is not a clinician's signature.
 *  2. NOTHING IS EVER SILENTLY DROPPED. A payload no adapter claims, one an adapter rejects, and one
 *     that throws mid-mapping all land in quarantine with the reason. A feed that quietly discards
 *     what it does not understand produces a chart that is wrong in a way nobody can see.
 *  3. ONE BROKEN ADAPTER MUST NOT STOP THE OTHERS. A hospital runs many feeds and they fail
 *     independently. A throwing adapter is isolated, counted, and the rest keep running.
 *  4. REPLAY IS EXPECTED, NOT EXCEPTIONAL. Reconnects and catch-up windows re-send. Ingest is keyed
 *     on the source's own event identity so a replayed message versions or no-ops rather than
 *     duplicating a patient's labs.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-interop.test.mjs
 */

import { makeActor, KIND, TIER } from "./wardsynq-actors.js";

class InteropError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "InteropError";
    this.code = code || "INTEROP_VIOLATION";
  }
}

const QUARANTINE = Object.freeze({
  UNCLAIMED: "unclaimed",       // no adapter recognised it
  AMBIGUOUS: "ambiguous",       // more than one adapter claimed it
  REJECTED: "rejected",         // the adapter looked and said no
  FAILED: "failed",             // the adapter threw
  UNWRITABLE: "unwritable",     // governance refused what it produced
});

/**
 * One registered feed.
 *
 * `claims(payload)` must be cheap and total: it answers whether this adapter recognises the shape,
 * and it must not throw. `normalise(payload)` returns canonical entities or throws with a reason.
 */
class Adapter {
  /**
   * @param {{system: string, describe?: string, claims: Function, normalise: Function,
   *   sourceEventId?: Function, tier?: string}} spec
   */
  constructor(spec) {
    spec = spec || {};
    if (!spec.system) throw new InteropError("an adapter must name the system it speaks for", "NO_SYSTEM");
    if (typeof spec.claims !== "function") throw new InteropError(`${spec.system} must say what it claims`, "NO_CLAIMS");
    if (typeof spec.normalise !== "function") throw new InteropError(`${spec.system} must say how it normalises`, "NO_NORMALISE");

    this.system = String(spec.system);
    this.describe = spec.describe || this.system;
    this._claims = spec.claims;
    this._normalise = spec.normalise;
    this._sourceEventId = spec.sourceEventId || null;

    // The adapter's own actor. KIND.ADAPTER is capped at DRAFT by the actor model, so a requested
    // tier above that is clamped rather than honoured. An adapter cannot ask its way to EXECUTE.
    this.actor = makeActor({
      id: `adapter:${this.system}`, kind: KIND.ADAPTER,
      tier: spec.tier || TIER.DRAFT, display: this.describe,
    });

    this.stats = { seen: 0, ingested: 0, entities: 0, quarantined: 0, failures: 0 };
  }

  /** Never allowed to throw; a claim check that explodes is treated as "does not claim". */
  claims(payload) {
    try { return this._claims(payload) === true; } catch { return false; }
  }

  async normalise(payload) { return this._normalise(payload); }

  /** The source's own identity for this message, used for replay safety. */
  sourceEventId(payload) {
    if (!this._sourceEventId) return null;
    try { const v = this._sourceEventId(payload); return v ? String(v) : null; } catch { return null; }
  }
}

/**
 * The hub.
 *
 * Writes through a GovernedStore so the adapter ceiling is enforced by the same control that stops
 * an AI committing an order, rather than by a second, weaker rule written here.
 */
class IntegrationHub {
  /** @param {{governed?: object, bus?: object, now?: () => string}} deps */
  constructor(deps) {
    deps = deps || {};
    this.governed = deps.governed || null;
    this.bus = deps.bus || null;
    this.now = deps.now || (() => new Date().toISOString());
    this.adapters = new Map();
    this.quarantine = [];
    this.seenEvents = new Set();
  }

  register(adapter) {
    const a = adapter instanceof Adapter ? adapter : new Adapter(adapter);
    if (this.adapters.has(a.system)) throw new InteropError(`${a.system} is already registered`, "DUPLICATE_SYSTEM");
    this.adapters.set(a.system, a);
    return a;
  }

  unregister(system) { return this.adapters.delete(system); }
  get systems() { return [...this.adapters.keys()]; }

  async _emit(t, p) { if (this.bus) await this.bus.emit(t, p); }

  async _quarantine(reason, payload, detail, system) {
    const row = { at: this.now(), reason, system: system || null, detail: detail || null, payload };
    this.quarantine.push(row);
    await this._emit("interop.quarantined", row);
    return row;
  }

  /**
   * Takes one inbound payload from anywhere and does the whole journey.
   *
   * Returns a result rather than throwing on bad input: a hub that throws when a hospital sends
   * something odd is a hub that stops the feed for every other patient.
   */
  async ingest(payload, opts) {
    opts = opts || {};
    const claiming = [...this.adapters.values()].filter((a) => a.claims(payload));

    if (claiming.length === 0) {
      return { ok: false, reason: QUARANTINE.UNCLAIMED, quarantined: await this._quarantine(QUARANTINE.UNCLAIMED, payload, "no registered adapter recognised this payload") };
    }
    if (claiming.length > 1) {
      // Two adapters claiming the same message means the routing is wrong, and guessing which is
      // right would attach a patient's data to whichever happened to register first.
      const systems = claiming.map((a) => a.system).join(", ");
      return { ok: false, reason: QUARANTINE.AMBIGUOUS, quarantined: await this._quarantine(QUARANTINE.AMBIGUOUS, payload, `claimed by ${systems}`) };
    }

    const adapter = claiming[0];
    adapter.stats.seen += 1;

    // Replay safety. A reconnect or a catch-up window re-sends; the source's own event id makes
    // that a no-op rather than a second copy of a patient's potassium.
    const eventId = adapter.sourceEventId(payload);
    if (eventId) {
      const key = `${adapter.system}/${eventId}`;
      if (this.seenEvents.has(key)) {
        return { ok: true, duplicate: true, system: adapter.system, entities: [], reason: "already ingested" };
      }
      this.seenEvents.add(key);
    }

    let mapped;
    try {
      mapped = await adapter.normalise(payload);
    } catch (err) {
      adapter.stats.failures += 1;
      adapter.stats.quarantined += 1;
      // Rule 3: isolated. The hub survives, and so does every other feed.
      return { ok: false, reason: QUARANTINE.FAILED, system: adapter.system, quarantined: await this._quarantine(QUARANTINE.FAILED, payload, String((err && err.message) || err), adapter.system) };
    }

    const entities = (mapped && mapped.entities) || [];
    if (!entities.length) {
      adapter.stats.quarantined += 1;
      return { ok: false, reason: QUARANTINE.REJECTED, system: adapter.system, quarantined: await this._quarantine(QUARANTINE.REJECTED, payload, (mapped && mapped.reason) || "the adapter produced nothing", adapter.system) };
    }

    // Rule 1: written as the ADAPTER, so the ceiling applies. A refusal is quarantined with its
    // reason rather than swallowed, because governance refusing an upstream feed is a finding.
    const written = [];
    for (const entity of entities) {
      if (!this.governed) { written.push(entity); continue; }
      try {
        await this.governed.put(adapter.actor, entity);
        written.push(entity);
      } catch (err) {
        adapter.stats.quarantined += 1;
        await this._quarantine(QUARANTINE.UNWRITABLE, entity, String((err && err.message) || err), adapter.system);
      }
    }

    adapter.stats.ingested += 1;
    adapter.stats.entities += written.length;
    // Issues the adapter itself reported: unmapped vocabulary, unparseable dates, dropped rows.
    const issues = (mapped && mapped.issues) || [];
    if (issues.length) await this._emit("interop.issues", { system: adapter.system, issues });
    await this._emit("interop.ingested", { system: adapter.system, count: written.length });

    return { ok: true, system: adapter.system, entities: written, issues, refused: entities.length - written.length };
  }

  /** Per-feed health. A hospital with eight feeds needs to see which one is rotting. */
  health() {
    return [...this.adapters.values()].map((a) => ({
      system: a.system, describe: a.describe,
      actorTier: a.actor.tier, ...a.stats,
      // The number worth alerting on: a feed that is arriving and never landing.
      stalled: a.stats.seen > 0 && a.stats.ingested === 0,
    }));
  }
}

/**
 * Wraps the existing GHIS adapter as a registered feed, so the first integration stops being a
 * special case and becomes an instance of the pattern every later one follows.
 */
function ghisAdapter(mapGhisBundle) {
  return new Adapter({
    system: "ghis",
    describe: "GIMSR GHIS ward feed",
    // A GHIS bundle is recognisable by carrying a patientId together with ward-shaped content.
    claims: (p) => !!(p && typeof p === "object" && p.patientId != null && ("labs" in p || "imaging" in p || "patient" in p)),
    sourceEventId: (p) => (p && p.patientId != null && p.ts ? `${p.patientId}:${p.ts}` : null),
    normalise: async (p) => {
      const m = mapGhisBundle(p);
      if (!m.patient) return { entities: [], issues: m.issues, reason: "no identifiable patient in the bundle" };
      return {
        entities: [m.patient, m.encounter, ...m.observations, ...m.reports].filter(Boolean),
        issues: m.issues,
      };
    },
  });
}

export { Adapter, IntegrationHub, InteropError, QUARANTINE, ghisAdapter };
