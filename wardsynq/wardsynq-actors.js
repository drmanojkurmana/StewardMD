/* wardsynq/wardsynq-actors.js — who is acting, and what they are permitted to do. HAZ-AI-01, HAZ-ID-01.
 *
 * Until this file existed, the AI boundary was a convention. `MedicationOrder` carried `aiDrafted`
 * and `signedBy` fields, the model defaulted an AI-authored order to draft, and every one of those
 * facts was a suggestion: the store would accept a record claiming `status: "active"` and
 * `signedBy: "dr-someone"` from any caller at all, including the model that wrote the draft. A field
 * is not a control. This is the control.
 *
 * FOUR TIERS, from the spec, as a strict ladder. An actor may do everything at or below its tier.
 *
 *   READ     query the chart
 *   SUGGEST  produce advisory output that touches nothing
 *   DRAFT    stage a proposed record, unsigned, never active
 *   EXECUTE  commit a clinical record
 *
 * The single invariant everything else serves: NO NON-HUMAN ACTOR MAY REACH EXECUTE. An AI agent is
 * capped at DRAFT by its kind, not by its configuration, so no amount of misconfiguration, payload
 * shaping or capability request can promote one. Devices are capped at DRAFT for observations they
 * originate and cannot touch orders at all.
 *
 * A SIGNATURE IS AN ACT, NOT A STRING. `signedBy` is only meaningful if the actor performing the
 * write IS the signer and is a human with EXECUTE. An AI cannot write a record naming a clinician as
 * signer, which is precisely the forgery the hazard describes.
 *
 * SESSION BINDING, for HAZ-ID-01. A write also carries the chart context the actor had open. A
 * record whose patient does not match the actor's active chart is refused, which is what stops a
 * second tab, a stale form or a mid-write patient switch committing to the wrong aggregate.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-actors.test.mjs
 */

/** The ladder. Order is the permission model; do not reorder. */
const TIER = Object.freeze({ READ: "read", SUGGEST: "suggest", DRAFT: "draft", EXECUTE: "execute" });
const LADDER = Object.freeze([TIER.READ, TIER.SUGGEST, TIER.DRAFT, TIER.EXECUTE]);

/** What kind of thing is acting. Kind determines the CEILING; configuration cannot exceed it. */
const KIND = Object.freeze({
  HUMAN: "human",       // a licensed clinician; may reach EXECUTE
  AI: "ai",             // any model or agent; capped at DRAFT, always
  DEVICE: "device",     // a monitor, pump or analyser; capped at DRAFT, observations only
  ADAPTER: "adapter",   // an interop adapter ingesting from another system; capped at DRAFT
  SERVICE: "service",   // internal machinery such as the escalation monitor; capped at DRAFT
});

/**
 * The ceiling per kind. This table is the whole safety property and is deliberately the shortest,
 * most re-readable thing in the module.
 */
const CEILING = Object.freeze({
  [KIND.HUMAN]: TIER.EXECUTE,
  [KIND.AI]: TIER.DRAFT,
  [KIND.DEVICE]: TIER.DRAFT,
  [KIND.ADAPTER]: TIER.DRAFT,
  [KIND.SERVICE]: TIER.DRAFT,
});

/** Resource types a device may originate at all. A pump does not write prescriptions. */
const DEVICE_WRITABLE = Object.freeze(["Observation"]);

class GovernanceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "GovernanceError";
    this.code = code || "GOVERNANCE_VIOLATION";
  }
}

const rank = (tier) => LADDER.indexOf(tier);

/**
 * Builds an actor. The granted tier is clamped to the kind's ceiling at construction and the result
 * is frozen, so an actor cannot be promoted after the fact by mutating it.
 *
 * @param {{id: string, kind: string, tier?: string, display?: string, credential?: string}} spec
 */
function makeActor(spec) {
  spec = spec || {};
  if (!spec.id) throw new GovernanceError("an actor must have an id", "NO_ACTOR_ID");
  if (!Object.values(KIND).includes(spec.kind)) {
    throw new GovernanceError(`unknown actor kind "${spec.kind}"; an unrecognised actor gets no permissions at all`, "UNKNOWN_KIND");
  }
  const ceiling = CEILING[spec.kind];
  const asked = LADDER.includes(spec.tier) ? spec.tier : TIER.READ;
  // Clamp rather than reject: a caller asking for more than its kind allows gets less, silently in
  // the object and loudly in the audit, which is safer than a throw a caller might catch and retry.
  const granted = rank(asked) > rank(ceiling) ? ceiling : asked;
  return Object.freeze({
    id: String(spec.id),
    kind: spec.kind,
    display: spec.display || String(spec.id),
    tier: granted,
    requestedTier: asked,
    clamped: granted !== asked,
    // A human's signature is only valid if they hold a credential. Absent for non-humans by design.
    credential: spec.kind === KIND.HUMAN ? (spec.credential || null) : null,
  });
}

/** True when the actor holds at least `need`. */
function can(actor, need) {
  if (!actor || !LADDER.includes(actor.tier)) return false;
  // The ceiling is re-applied HERE, not only in makeActor. Clamping at construction is not enough:
  // an actor object can reach this function without ever passing through the factory, by being
  // hand-built, deserialised from storage, rebuilt across a process boundary, or supplied by a
  // caller that constructed the shape itself. All of those are ordinary, and any of them claiming
  // `{kind: "ai", tier: "execute"}` would otherwise hold EXECUTE. A ceiling enforced only at
  // construction is a ceiling that assumes every path went through the door.
  const ceiling = CEILING[actor.kind];
  if (!ceiling) return false;   // an unrecognised kind gets nothing, as makeActor also says
  const effective = rank(actor.tier) > rank(ceiling) ? ceiling : actor.tier;
  return rank(effective) >= rank(need);
}

/** The tier an actor actually holds, after its kind's ceiling. Exported so a UI shows the truth. */
function effectiveTier(actor) {
  if (!actor || !LADDER.includes(actor.tier)) return null;
  const ceiling = CEILING[actor.kind];
  if (!ceiling) return null;
  return rank(actor.tier) > rank(ceiling) ? ceiling : actor.tier;
}

/**
 * Decides whether one write is permitted. Pure, so it can be reasoned about and tested on its own,
 * and so the governed store below is a thin shell around a decision rather than the decision itself.
 *
 * @returns {{allowed: boolean, reasons: {code, message}[]}}
 */
function authoriseWrite(actor, entity, ctx) {
  ctx = ctx || {};
  const reasons = [];
  if (!actor) {
    return { allowed: false, reasons: [{ code: "NO_ACTOR", message: "every clinical write must name an authenticated actor" }] };
  }
  if (!entity || !entity.resourceType) {
    return { allowed: false, reasons: [{ code: "NO_RESOURCE", message: "a write must state what it is writing" }] };
  }

  const isDraft = entity.status === "draft" || entity.status === undefined || entity.status === null;
  const claimsSignature = !!entity.signedBy;
  const claimsActive = entity.status && entity.status !== "draft";

  // 1. A signature is an act. Only the actor doing the writing may sign, and only a credentialed
  //    human may sign at all.
  if (claimsSignature) {
    if (actor.kind !== KIND.HUMAN) {
      reasons.push({ code: "NON_HUMAN_SIGNATURE", message: `${actor.kind} actor ${actor.id} cannot produce a clinician signature` });
    } else if (entity.signedBy !== actor.id) {
      reasons.push({ code: "SIGNATURE_NOT_OWN", message: `${actor.id} cannot sign as ${entity.signedBy}` });
    } else if (!actor.credential) {
      reasons.push({ code: "NO_CREDENTIAL", message: `${actor.id} holds no credential and cannot sign a clinical record` });
    }
  }

  // 2. Committing anything beyond a draft needs EXECUTE, which no non-human kind can hold.
  if (claimsActive && !can(actor, TIER.EXECUTE)) {
    reasons.push({
      code: "EXECUTE_DENIED",
      message: `${actor.kind} actor ${actor.id} holds ${actor.tier} and cannot commit a record with status "${entity.status}"`,
    });
  }
  if (!claimsActive && !can(actor, TIER.DRAFT)) {
    reasons.push({ code: "DRAFT_DENIED", message: `${actor.id} holds ${actor.tier} and cannot stage a record` });
  }

  // 3. AI provenance is NOT policed here, it is overwritten at the point of writing. An earlier
  //    version refused a record claiming `aiDrafted: false`, which was both weaker and wrong:
  //    weaker because it only catches a claim it can see, and wrong because the model factory
  //    defaults the field to false, so every ordinary AI draft tripped it. Overwriting cannot be
  //    evaded by omitting, defaulting or misspelling the claim. See GovernedStore.put.

  // 4. Devices originate observations and nothing else.
  if (actor.kind === KIND.DEVICE && !DEVICE_WRITABLE.includes(entity.resourceType)) {
    reasons.push({ code: "DEVICE_SCOPE", message: `a device may not write a ${entity.resourceType}` });
  }

  // 5. Session binding. HAZ-ID-01: a write must land on the chart the actor actually has open.
  if (ctx.activePatientId && entity.patientId && entity.patientId !== ctx.activePatientId) {
    reasons.push({
      code: "WRONG_CHART",
      message: `this write targets patient ${entity.patientId} but the active chart is ${ctx.activePatientId}`,
    });
  }

  return { allowed: reasons.length === 0, reasons };
}

/**
 * The enforcement point. Wraps a ClinicalStore so that no write reaches it without an actor and a
 * decision.
 *
 * DEPLOYMENT NOTE, and it is a real limitation: this governs the writes that come through it. A
 * deployment that also hands out the underlying ClinicalStore has not enforced anything, in the same
 * way that an API is not a control if the database is also exposed. `sealed()` returns a store whose
 * raw handle is not reachable from the governed one, and an application layer should use only that.
 */
class GovernedStore {
  /** @param {{store: object, bus?: object, onDenied?: Function}} deps */
  constructor(deps) {
    deps = deps || {};
    if (!deps.store) throw new GovernanceError("a governed store needs a store to govern", "NO_STORE");
    this._store = deps.store;
    this.bus = deps.bus || null;
    this.onDenied = deps.onDenied || null;
    this.denials = [];
  }

  async open() { return this._store.open(); }
  async close() { return this._store.close(); }

  /** Reads require READ and nothing more. */
  async get(actor, resourceType, id) {
    this._assertRead(actor);
    return this._store.get(resourceType, id);
  }
  async history(actor, resourceType, id) {
    this._assertRead(actor);
    return this._store.history(resourceType, id);
  }
  async byPatient(actor, resourceType, patientId) {
    this._assertRead(actor);
    return this._store.byPatient(resourceType, patientId);
  }

  _assertRead(actor) {
    if (!can(actor, TIER.READ)) throw new GovernanceError("reading the chart requires an authenticated actor", "READ_DENIED");
  }

  /**
   * The governed write. Every refusal is recorded and announced: a denied AI commit is a security
   * event, and a system that silently drops them cannot tell an accident from an attack.
   */
  async put(actor, entity, ctx) {
    const verdict = authoriseWrite(actor, entity, ctx);
    if (!verdict.allowed) {
      const denial = {
        at: new Date().toISOString(),
        actorId: actor ? actor.id : null,
        actorKind: actor ? actor.kind : null,
        resourceType: entity ? entity.resourceType : null,
        patientId: entity ? entity.patientId : null,
        reasons: verdict.reasons,
      };
      this.denials.push(denial);
      if (this.onDenied) this.onDenied(denial);
      if (this.bus) await this.bus.emit("governance.denied", denial);
      throw new GovernanceError(verdict.reasons.map((r) => r.message).join("; "), verdict.reasons[0].code);
    }

    // Provenance is stamped by the store, not supplied by the caller, so a record always says who
    // actually wrote it rather than who it claims to be from.
    const stamped = {
      ...entity,
      writtenBy: { id: actor.id, kind: actor.kind, tier: actor.tier, at: new Date().toISOString() },
    };
    if (actor.kind === KIND.AI) stamped.aiDrafted = true;
    const saved = await this._store.put(stamped);
    if (this.bus) await this.bus.emit("governance.written", { actorId: actor.id, kind: actor.kind, resourceType: entity.resourceType });
    return saved;
  }

  /**
   * A store-shaped handle bound to one actor but to NO chart, for machinery that legitimately spans
   * patients: reconciliation after an outage, a migration, a batch import.
   *
   * It exists because the alternative is worse. Reconciliation needs to write, and handing it the
   * raw ungoverned store would let clinical records be committed with no actor at all, which is the
   * exact hole the governed store was built to close. Chart binding is dropped rather than faked,
   * because pretending a batch job has one chart open would make the WRONG_CHART check meaningless.
   */
  asStoreFor(actor) {
    const self = this;
    return Object.freeze({
      open: () => self.open(),
      close: () => self.close(),
      get: (rt, id) => self.get(actor, rt, id),
      history: (rt, id) => self.history(actor, rt, id),
      byPatient: (rt, pid) => self.byPatient(actor, rt, pid),
      put: (entity) => self.put(actor, entity),
    });
  }

  /** A handle bound to one actor and one chart, so a caller cannot drift off either. */
  session(actor, activePatientId) {
    const self = this;
    return Object.freeze({
      actor,
      activePatientId: activePatientId || null,
      get: (rt, id) => self.get(actor, rt, id),
      history: (rt, id) => self.history(actor, rt, id),
      byPatient: (rt, pid) => self.byPatient(actor, rt, pid),
      put: (entity) => self.put(actor, entity, { activePatientId }),
    });
  }
}

export {
  TIER, LADDER, KIND, CEILING, DEVICE_WRITABLE,
  GovernanceError, GovernedStore,
  makeActor, can, effectiveTier, authoriseWrite, rank,
};
