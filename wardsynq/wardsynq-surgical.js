/* wardsynq/wardsynq-surgical.js — WHO Surgical Safety Checklist as a hard gate. HAZ-SURG-01.
 *
 * Wrong-site surgery is a never event that keeps happening, and it is almost never caused by not
 * knowing which side. It is caused by a checklist performed as a ritual: read aloud while the
 * surgeon is already scrubbed, agreed to by whoever is nearest, ticked afterwards. So this module
 * treats the checklist as a GATE rather than a form. Incision is unreachable until Sign In and Time
 * Out are complete, and complete means signed by three DIFFERENT people in three different roles.
 *
 *   booking with side and consent -> site marked -> SIGN IN (before induction)
 *     -> TIME OUT (before incision) -> incision unlocked -> procedure
 *     -> SIGN OUT (before leaving theatre) -> operative record permitted
 *
 * THE LATERALITY CHAIN. A side is declared once at booking and then re-asserted independently at
 * marking, at Sign In and at Time Out. Every assertion is compared against the booking, not against
 * the previous assertion, so one early error cannot propagate by agreement down the chain. A
 * disagreement anywhere stops the list.
 *
 * WHY THREE SIGNATURES. The WHO checklist works because the surgeon, the anaesthetist and the
 * theatre nurse each have to say it out loud. One person signing all three roles is the failure mode
 * this whole control exists to prevent, so it is refused explicitly rather than left to policy.
 *
 * NOT MODELLED: the full WHO item set is longer than the one enforced here, and local variants add
 * to it. Implant and prosthesis checks, fire risk, VTE prophylaxis, glycaemic control and specimen
 * chain of custody beyond labelling are absent. A site must not read a completed checklist here as
 * equivalent to its own approved checklist.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-surgical.test.mjs
 */

const STAGE = Object.freeze({
  BOOKED: "booked",
  MARKED: "marked",           // the surgical site has been physically marked
  SIGNED_IN: "signed-in",     // before induction of anaesthesia
  TIMED_OUT: "timed-out",     // before skin incision; incision is unlocked from here
  INCISED: "incised",
  SIGNED_OUT: "signed-out",   // before the patient leaves theatre
  ABANDONED: "abandoned",
});

const ORDER = Object.freeze([STAGE.BOOKED, STAGE.MARKED, STAGE.SIGNED_IN, STAGE.TIMED_OUT, STAGE.INCISED, STAGE.SIGNED_OUT]);

/** The three roles that must each speak. */
const ROLE = Object.freeze({ SURGEON: "surgeon", ANAESTHETIST: "anaesthetist", NURSE: "nurse" });
const REQUIRED_ROLES = Object.freeze([ROLE.SURGEON, ROLE.ANAESTHETIST, ROLE.NURSE]);

const LATERALITY = Object.freeze(["left", "right", "bilateral", "not-applicable"]);

/**
 * Required items per phase. Each must be explicitly confirmed; there is no default-true item,
 * because a checklist whose items default to satisfied is a checklist that confirms nothing.
 */
const CHECKLIST = Object.freeze({
  signIn: Object.freeze([
    "identity-confirmed", "site-confirmed", "procedure-confirmed", "consent-confirmed",
    "site-marked-confirmed", "anaesthesia-safety-check", "pulse-oximeter-working",
    "allergies-reviewed", "airway-risk-assessed", "blood-loss-risk-assessed",
  ]),
  timeOut: Object.freeze([
    "team-introduced", "identity-site-procedure-reconfirmed", "critical-events-anticipated",
    "antibiotic-prophylaxis-addressed", "imaging-displayed",
  ]),
  signOut: Object.freeze([
    "procedure-recorded", "counts-correct", "specimens-labelled",
    "equipment-problems-addressed", "recovery-concerns-addressed",
  ]),
});

class SurgicalSafetyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SurgicalSafetyError";
    this.code = code || "SURGICAL_VIOLATION";
  }
}

const low = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");

class SurgicalCase {
  /** @param {{now?: () => string, bus?: object, store?: object}} deps */
  constructor(deps) {
    deps = deps || {};
    this.now = deps.now || (() => new Date().toISOString());
    this.bus = deps.bus || null;
    this.store = deps.store || null;
  }

  _record(c, event, actorId, detail) {
    c.ledger.push(Object.freeze({ at: this.now(), event, actorId: actorId || null, detail: detail || null }));
  }
  async _emit(t, p) { if (this.bus) await this.bus.emit(t, p); }
  async _persist(c) { if (this.store) await this.store.put({ resourceType: "SurgicalCase", ...c }); }

  /** Books a case. The side declared here is the reference every later assertion is compared to. */
  async book(patient, plan, bookerId) {
    if (!patient || !patient.id) throw new SurgicalSafetyError("a case needs an identified patient", "NO_PATIENT");
    if (!bookerId) throw new SurgicalSafetyError("a booking must name who made it", "NO_ACTOR");
    if (!plan || !plan.procedure) throw new SurgicalSafetyError("a case needs a named procedure", "NO_PROCEDURE");
    const laterality = low(plan.laterality);
    if (!LATERALITY.includes(laterality)) {
      throw new SurgicalSafetyError(`laterality must be one of ${LATERALITY.join(", ")}; "${plan.laterality}" is not a side`, "NO_LATERALITY");
    }
    const c = {
      id: `case-${patient.id}-${Date.now().toString(36)}`,
      patientId: patient.id, patientMrn: patient.mrn,
      procedure: plan.procedure, site: low(plan.site) || null, laterality,
      consent: null, marking: null,
      stage: STAGE.BOOKED,
      signIn: null, timeOut: null, signOut: null,
      incisionAt: null, ledger: [],
    };
    this._record(c, "booked", bookerId, `${c.procedure}, ${c.site || "site unstated"} ${c.laterality}`);
    await this._persist(c);
    await this._emit("surgical.booked", { case: this._view(c) });
    return c;
  }

  /**
   * Records consent. Consent must name the same procedure and the same side as the booking: a
   * consent form for the other knee is not consent, and this is one of the few places a document
   * mismatch is machine-detectable.
   */
  async recordConsent(c, consent, actorId) {
    this._assertLive(c);
    if (!actorId) throw new SurgicalSafetyError("consent must name who recorded it", "NO_ACTOR");
    if (!consent || !consent.signedByPatientOrProxy) {
      throw new SurgicalSafetyError("consent must be signed by the patient or a lawful proxy", "CONSENT_UNSIGNED");
    }
    const problems = [];
    if (low(consent.procedure) !== low(c.procedure)) problems.push(`consent names "${consent.procedure}" but the booking is "${c.procedure}"`);
    if (low(consent.laterality) !== c.laterality) problems.push(`consent says ${consent.laterality || "no side"} but the booking says ${c.laterality}`);
    if (consent.expiresAt && Date.parse(consent.expiresAt) <= Date.parse(this.now())) problems.push("the consent has expired");
    if (problems.length) {
      this._record(c, "consent-rejected", actorId, problems.join("; "));
      await this._persist(c);
      throw new SurgicalSafetyError(`consent does not match this case: ${problems.join("; ")}`, "CONSENT_MISMATCH");
    }
    c.consent = { ...consent, recordedBy: actorId, at: this.now() };
    this._record(c, "consent-recorded", actorId, `${consent.procedure} ${consent.laterality}`);
    await this._persist(c);
    return c;
  }

  /** The site is physically marked. The marked side is compared to the BOOKING, not to consent. */
  async markSite(c, marking, actorId) {
    this._assertLive(c);
    if (!actorId) throw new SurgicalSafetyError("site marking must name the clinician", "NO_ACTOR");
    const marked = low(marking && marking.laterality);
    if (c.laterality !== "not-applicable" && marked !== c.laterality) {
      this._record(c, "marking-rejected", actorId, `marked ${marked || "nothing"} against a booking of ${c.laterality}`);
      await this._persist(c);
      await this._emit("surgical.laterality.conflict", { case: this._view(c), stage: "marking", marked, booked: c.laterality });
      throw new SurgicalSafetyError(`the site marked (${marked || "none"}) is not the side booked (${c.laterality})`, "LATERALITY_CONFLICT");
    }
    c.marking = { laterality: marked, site: low(marking && marking.site) || c.site, by: actorId, at: this.now() };
    c.stage = STAGE.MARKED;
    this._record(c, "site-marked", actorId, `${c.marking.site || "site"} ${marked}`);
    await this._persist(c);
    await this._emit("surgical.marked", { case: this._view(c) });
    return c;
  }

  /** Sign In, before induction. */
  async signIn(c, submission) {
    return this._phase(c, "signIn", STAGE.SIGNED_IN, STAGE.MARKED, submission, {
      requireConsent: true, requireMarking: true,
      onBefore: (s) => this._assertLaterality(c, s, "sign-in"),
    });
  }

  /** Time Out, immediately before incision. This is the last gate before the knife. */
  async timeOut(c, submission) {
    return this._phase(c, "timeOut", STAGE.TIMED_OUT, STAGE.SIGNED_IN, submission, {
      onBefore: (s) => this._assertLaterality(c, s, "time-out"),
    });
  }

  /** Sign Out, before the patient leaves theatre. */
  async signOut(c, submission) {
    if (c.stage !== STAGE.INCISED && c.stage !== STAGE.TIMED_OUT) {
      throw new SurgicalSafetyError("sign out happens at the end of the procedure", "OUT_OF_SEQUENCE");
    }
    if (submission && submission.items && submission.items["counts-correct"] === false) {
      this._record(c, "sign-out-blocked", (submission.signatures || [])[0]?.actorId, "instrument, sponge or needle counts are not correct");
      await this._persist(c);
      throw new SurgicalSafetyError("sign out cannot complete while counts are incorrect", "COUNTS_INCORRECT");
    }
    return this._phase(c, "signOut", STAGE.SIGNED_OUT, c.stage, submission, {});
  }

  /**
   * Shared phase machinery: every required item explicitly confirmed, and three DIFFERENT people in
   * the three required roles.
   */
  async _phase(c, key, toStage, fromStage, submission, opts) {
    this._assertLive(c);
    opts = opts || {};
    submission = submission || {};
    if (c.stage !== fromStage) {
      throw new SurgicalSafetyError(`${key} cannot happen from stage ${c.stage}`, "OUT_OF_SEQUENCE");
    }
    if (opts.requireConsent && !c.consent) throw new SurgicalSafetyError("no valid consent is recorded for this case", "NO_CONSENT");
    if (opts.requireMarking && !c.marking) throw new SurgicalSafetyError("the surgical site has not been marked", "NOT_MARKED");
    if (opts.onBefore) opts.onBefore(submission);

    const required = CHECKLIST[key];
    const items = submission.items || {};
    const unconfirmed = required.filter((i) => items[i] !== true);
    if (unconfirmed.length) {
      throw new SurgicalSafetyError(`${key} is incomplete: ${unconfirmed.join(", ")}`, "CHECKLIST_INCOMPLETE");
    }

    const sigs = submission.signatures || [];
    const byRole = new Map();
    for (const s of sigs) {
      if (!s || !s.actorId || !REQUIRED_ROLES.includes(low(s.role))) continue;
      byRole.set(low(s.role), s.actorId);
    }
    const missing = REQUIRED_ROLES.filter((r) => !byRole.has(r));
    if (missing.length) throw new SurgicalSafetyError(`${key} needs a signature from: ${missing.join(", ")}`, "SIGNATURES_MISSING");

    const people = new Set(byRole.values());
    if (people.size < REQUIRED_ROLES.length) {
      throw new SurgicalSafetyError(
        "the surgeon, anaesthetist and nurse must be three different people; one person signing every role defeats the checklist",
        "SIGNATURES_NOT_INDEPENDENT",
      );
    }

    c[key] = { at: this.now(), items: { ...items }, signatures: [...byRole].map(([role, actorId]) => ({ role, actorId })) };
    c.stage = toStage;
    this._record(c, key, [...people][0], [...byRole].map(([r, a]) => `${r}:${a}`).join(", "));
    await this._persist(c);
    await this._emit(`surgical.${key.toLowerCase()}`, { case: this._view(c) });
    return c;
  }

  /** Every phase re-asserts the side, and every assertion is compared to the BOOKING. */
  _assertLaterality(c, submission, stage) {
    if (c.laterality === "not-applicable") return;
    const asserted = low(submission.lateralityAsserted);
    if (!asserted) throw new SurgicalSafetyError(`${stage} must state the side out loud`, "LATERALITY_NOT_ASSERTED");
    if (asserted !== c.laterality) {
      this._record(c, "laterality-conflict", null, `${stage} asserted ${asserted} against a booking of ${c.laterality}`);
      throw new SurgicalSafetyError(`${stage} asserted ${asserted} but this case is booked as ${c.laterality}`, "LATERALITY_CONFLICT");
    }
  }

  /**
   * The gate. Incision is only reachable once Sign In and Time Out are both complete, and this is
   * the method the operating record has to go through.
   */
  async incise(c, surgeonId) {
    this._assertLive(c);
    if (!surgeonId) throw new SurgicalSafetyError("incision must name the surgeon", "NO_ACTOR");
    if (!c.signIn) throw new SurgicalSafetyError("incision is locked: sign in has not been completed", "SIGN_IN_INCOMPLETE");
    if (!c.timeOut) throw new SurgicalSafetyError("incision is locked: time out has not been completed", "TIME_OUT_INCOMPLETE");
    if (c.stage !== STAGE.TIMED_OUT) throw new SurgicalSafetyError(`incision cannot proceed from stage ${c.stage}`, "OUT_OF_SEQUENCE");
    c.stage = STAGE.INCISED;
    c.incisionAt = this.now();
    this._record(c, "incision", surgeonId, `${c.procedure} ${c.laterality}`);
    await this._persist(c);
    await this._emit("surgical.incision", { case: this._view(c) });
    return c;
  }

  /**
   * The operative record and any transfer out of theatre. Refused unless every milestone was
   * completed, which is what stops a bypassed checklist being papered over afterwards.
   */
  async operativeRecord(c, actorId, note) {
    if (!actorId) throw new SurgicalSafetyError("an operative record must name its author", "NO_ACTOR");
    const missing = [];
    if (!c.signIn) missing.push("sign in");
    if (!c.timeOut) missing.push("time out");
    if (!c.signOut) missing.push("sign out");
    if (missing.length) {
      throw new SurgicalSafetyError(`an operative record cannot be created while these are outstanding: ${missing.join(", ")}`, "MILESTONE_BYPASSED");
    }
    const record = { by: actorId, at: this.now(), note: note || null, caseId: c.id };
    this._record(c, "operative-record", actorId, null);
    await this._persist(c);
    await this._emit("surgical.record", { case: this._view(c), record });
    return record;
  }

  /** Abandoning a case is legitimate and must be recorded rather than left dangling. */
  async abandon(c, actorId, reason) {
    if (!actorId || !reason) throw new SurgicalSafetyError("abandoning a case must name who and why", "NO_ACTOR");
    c.stage = STAGE.ABANDONED;
    this._record(c, "abandoned", actorId, reason);
    await this._persist(c);
    await this._emit("surgical.abandoned", { case: this._view(c) });
    return c;
  }

  _assertLive(c) {
    if (!c || !c.id) throw new SurgicalSafetyError("not a surgical case", "BAD_CASE");
    if (c.stage === STAGE.ABANDONED) throw new SurgicalSafetyError("this case was abandoned", "ABANDONED");
    if (c.stage === STAGE.SIGNED_OUT) throw new SurgicalSafetyError("this case is signed out", "ALREADY_SIGNED_OUT");
  }

  _view(c) { return JSON.parse(JSON.stringify(c)); }
}

/** Cases that reached theatre without a complete checklist. The governance report. */
function bypassed(cases) {
  return cases
    .filter((c) => c.incisionAt && (!c.signIn || !c.timeOut))
    .map((c) => ({ caseId: c.id, patientMrn: c.patientMrn, procedure: c.procedure, missing: [!c.signIn && "sign in", !c.timeOut && "time out"].filter(Boolean) }));
}

export { STAGE, ORDER, ROLE, REQUIRED_ROLES, LATERALITY, CHECKLIST, SurgicalSafetyError, SurgicalCase, bypassed };
