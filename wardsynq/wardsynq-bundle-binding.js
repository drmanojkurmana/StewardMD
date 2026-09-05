/* wardsynq/wardsynq-bundle-binding.js — the difference between knowing and being told.
 *
 * HAZ-TIME-01's last named reason: "antibiotics administered" was asserted by whoever recorded it.
 * A bundle element completed by a human typing into a form measures whether the form was filled in.
 * Next door, wardsynq-meds.js already runs a state machine where ADMINISTERED is reachable only from
 * SCANNED, which means a nurse scanned the patient's wristband and the product. That is a fact about
 * the world. This file connects the two, so a bundle can be completed by the event rather than by
 * the claim.
 *
 * THE DESIGN DECISION WORTH ARGUING ABOUT. The obvious move is to make a derivable element
 * UNCOMPLETABLE by hand: if the eMAR is the source of truth, refuse anything else. That is wrong
 * here, and dangerously so. During a haemorrhage or an arrest the eMAR may be down, the drug may
 * come from an emergency box, the scanner may be broken, and a system that refuses to let the team
 * record what they did is a system the team abandons mid-resuscitation. Refusing would also fail the
 * patient in the only direction that matters: the drug was given and the record says it was not.
 *
 * So manual completion stays possible, and instead the two are kept APART:
 *
 *   DERIVED   the eMAR emitted an administration for this patient and this drug. We know.
 *   ATTESTED  a named human recorded it. We were told, by someone accountable.
 *
 * Both complete the element. Neither is called the other. `provenanceSummary()` reports the split,
 * and a compliance figure computed over attested elements is a figure about paperwork, which is a
 * thing a hospital is entitled to know about its own numbers rather than something to hide.
 *
 * WHY THAT IS STILL WORTH BUILDING. Because the ratio is the finding. A unit whose sepsis bundles
 * are 95 percent compliant and 90 percent attested is not measuring care, and nobody could see that
 * before. And where the eMAR IS working, the element is now anchored to a bedside scan, which is a
 * far harder thing to get wrong than a checkbox.
 *
 * A DERIVED COMPLETION CANNOT BE BACK-DATED. It carries the eMAR's own administration time, not the
 * time the event was processed and not a time anyone supplies, so the one route by which automation
 * could have made a bundle look faster is closed.
 *
 * TWO KINDS OF EVIDENCE. A medication element is satisfied by an eMAR administration; a laboratory
 * or imaging element by a finalised result. They are deliberately handled by the same code with the
 * same guards, because the ways they can go wrong are identical: the wrong patient, a value from an
 * earlier episode, and a timestamp taken from the processing rather than from the event.
 *
 * A RESULT COUNTS WHEN IT WAS RESULTED, NOT WHEN IT WAS ORDERED. The sepsis bundle asks for a
 * lactate MEASURED inside the hour, and an order placed at 10 minutes whose sample is analysed at
 * three hours has not met it. The element therefore anchors to the observation's effective time.
 *
 * A NORMAL RESULT STILL COUNTS. The bundle element is "measure lactate", not "measure a high
 * lactate", so the binding fires on any finalised value. This is why result.finalized is emitted
 * before classification rather than on the critical path: emitting only for critical results would
 * have made a reassuring lactate invisible and left the element permanently attested.
 *
 * NOT MODELLED: matching by anything cleverer than a code list, so a site must state which drug or
 * observation codes satisfy which element.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-bundle-binding.test.mjs
 */

const PROVENANCE = Object.freeze({
  DERIVED: "derived",     // an event in another system says this happened
  ATTESTED: "attested",   // a named human says this happened
});

class BindingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "BindingError";
    this.code = code || "BINDING_VIOLATION";
  }
}

const upper = (v) => String(v == null ? "" : v).trim().toUpperCase();

/**
 * Binds bundle elements to clinical events.
 *
 * A binding says: for this bundle code, this element is satisfied when an administration of one of
 * these drug codes reaches ADMINISTERED for this patient.
 *
 * @param {{bus: object, monitor?: object, now?: () => string,
 *   bindings: {code: string, element: string, drugCodes: string[]}[]}} deps
 */
class BundleBinder {
  constructor({ bus, monitor, bindings, now, onDerived } = {}) {
    if (!bus) throw new BindingError("a binder needs the clinical event bus", "NO_BUS");
    this.bus = bus;
    this.monitor = monitor || null;
    this.now = now || (() => new Date().toISOString());
    this.onDerived = onDerived || null;
    this.bindings = (bindings || []).map((b) => ({
      ...b,
      drugCodes: (b.drugCodes || []).map(upper),
      observationCodes: (b.observationCodes || []).map(upper),
    }));
    this.unmatched = [];
    this._off = [];
  }

  /** Live bundles this binder can complete against, newest time zero first. */
  _candidates(patientId, code) {
    const bundles = this.monitor ? [...this.monitor.bundles.values()] : (this._bundles || []);
    return bundles
      .filter((b) => b.patientId === patientId && b.code === code && b.state !== "voided")
      .sort((a, b) => Date.parse(b.timeZero) - Date.parse(a.timeZero));
  }

  /** For use without a monitor, e.g. a single bundle in a test or a harness. */
  watch(bundle) {
    this._bundles = this._bundles || [];
    this._bundles.push(bundle);
    return bundle;
  }

  /** Subscribes to both evidence streams. Returns an unsubscribe function. */
  start() {
    if (this._off.length) return () => this.stop();
    this._off.push(this.bus.on("meds.administered", (event) => this.onAdministered(event)));
    this._off.push(this.bus.on("result.finalized", (event) => this.onResult(event)));
    return () => this.stop();
  }

  stop() {
    for (const off of this._off) off();
    this._off = [];
  }

  /**
   * The shared half of both handlers: find the element this evidence satisfies, and complete it at
   * the time the evidence says, not the time we happened to see it.
   */
  _apply({ patientId, code, element, at, by, detail, recordId }) {
    for (const bundle of this._candidates(patientId, code)) {
      let el;
      try { el = bundle.element(element); } catch { continue; }
      if (el.done || el.notApplicable) continue;

      // Evidence predating this bundle's time zero belongs to an earlier episode. Crediting it
      // would give the bundle a head start it did not have.
      if (Date.parse(at) < Date.parse(bundle.timeZero)) continue;

      bundle.complete(element, { event: el.doneOn, at, by, detail });
      el.provenance = PROVENANCE.DERIVED;
      el.sourceRecordId = recordId || null;
      return { bundle, element, at };
    }
    return null;
  }

  /**
   * Handles one finalised laboratory or imaging result.
   *
   * @returns {{completed: object[], unmatched: object|null}}
   */
  onResult(event) {
    const payload = (event && event.payload) || event || {};
    const obs = payload.observation;
    if (!obs || !obs.patientId || !obs.code) return { completed: [], unmatched: null };

    // When the sample was analysed, not when this event was handled. A bundle asking for a lactate
    // inside the hour is asking about the measurement, and an order placed early whose result comes
    // back at three hours has not met it.
    const at = obs.effectiveAt || (obs.meta && (obs.meta.effectiveAt || obs.meta.recordedAt));
    if (!at) {
      return { completed: [], unmatched: this._note(obs, "the result carries no effective time, so it cannot anchor a timed element") };
    }

    const code = upper(obs.code);
    const completed = [];
    for (const binding of this.bindings) {
      if (!binding.observationCodes.length) continue;
      if (!binding.observationCodes.includes(code)) continue;
      const hit = this._apply({
        patientId: obs.patientId, code: binding.code, element: binding.element,
        at, by: obs.performer || "laboratory",
        detail: `derived from finalised result ${obs.id || ""}`.trim(), recordId: obs.id,
      });
      if (hit) {
        completed.push(hit);
        if (this.onDerived) this.onDerived({ bundle: hit.bundle, element: binding.element, observation: obs });
      }
    }

    if (!completed.length) {
      return { completed: [], unmatched: this._note(obs, `no live bundle element matched result code ${code || "(none)"}`) };
    }
    return { completed, unmatched: null };
  }

  /**
   * Handles one administration event.
   *
   * @returns {{completed: object[], unmatched: object|null}}
   */
  onAdministered(event) {
    const payload = (event && event.payload) || event || {};
    const record = payload.record;
    const order = payload.order || null;
    if (!record || !record.patientId) return { completed: [], unmatched: null };

    // The eMAR's own administration time. Not the time this event was processed, and not a time
    // anybody supplies: that is the one route by which automation could make a bundle look faster.
    const administeredAt = record.administeredAt;
    if (!administeredAt) {
      return { completed: [], unmatched: this._note(record, "the administration record carries no administeredAt, so it cannot anchor a timed element") };
    }

    const drug = upper(order && (order.drugCode || order.drug)) || upper(record.drugCode);
    const completed = [];

    for (const binding of this.bindings) {
      if (!binding.drugCodes.length) continue;
      if (!binding.drugCodes.some((c) => drug.includes(c))) continue;

      const hit = this._apply({
        patientId: record.patientId, code: binding.code, element: binding.element,
        at: administeredAt, by: record.administeredBy || "emar",
        detail: `derived from eMAR administration ${record.id || ""}`.trim(), recordId: record.id,
      });
      if (hit) {
        completed.push(hit);
        if (this.onDerived) this.onDerived({ bundle: hit.bundle, element: binding.element, record });
      }
    }

    if (!completed.length) {
      return { completed: [], unmatched: this._note(record, `no live bundle element matched drug ${drug || "(none)"}`) };
    }
    return { completed, unmatched: null };
  }

  _note(record, reason) {
    // Nothing is silently dropped, the same contract every adapter in this repo meets. Evidence that
    // matched nothing is usually correct and occasionally the interesting thing.
    const note = { at: this.now(), patientId: record.patientId, recordId: record.id || null, reason };
    this.unmatched.push(note);
    return note;
  }
}

/**
 * Marks every element a human completed as ATTESTED, so the two provenances can be told apart.
 *
 * Called by `provenanceSummary`; separate because a caller may want to normalise a bundle without
 * asking for the summary.
 */
function markAttested(bundle) {
  for (const el of bundle.elements) {
    if (el.done && !el.provenance) el.provenance = PROVENANCE.ATTESTED;
  }
  return bundle;
}

/**
 * The split, per bundle. This is the number the file exists to produce.
 *
 * A compliance figure computed over attested elements is a figure about paperwork. Reporting that
 * plainly is more useful than a single percentage that conceals it.
 */
function provenanceSummary(bundle, nowIso) {
  markAttested(bundle);
  const s = bundle.status(nowIso || new Date().toISOString());
  const applicable = s.elements.filter((e) => !e.notApplicable);
  const done = applicable.filter((e) => e.done);
  const byKey = new Map(bundle.elements.map((e) => [e.key, e]));

  const derived = done.filter((e) => byKey.get(e.key).provenance === PROVENANCE.DERIVED);
  const attested = done.filter((e) => byKey.get(e.key).provenance === PROVENANCE.ATTESTED);

  return {
    code: bundle.code,
    patientId: bundle.patientId,
    timeZero: bundle.timeZero,
    state: s.state,
    compliant: s.compliant,
    elements: applicable.length,
    done: done.length,
    derived: derived.length,
    attested: attested.length,
    derivedKeys: derived.map((e) => e.key),
    attestedKeys: attested.map((e) => e.key),
    // Deliberately not a single "quality" score. Two numbers that mean different things should not
    // be averaged into one that means neither.
    evidence: done.length === 0 ? null : `${derived.length} of ${done.length} completed elements are derived from another system's record; ${attested.length} rest on a human's attestation`,
    caution: attested.length && s.compliant
      ? "This bundle is compliant partly on attestation. An attested element records that somebody said it happened, not that another system observed it."
      : null,
  };
}

/** Rolls the split up across many bundles, which is where the finding actually shows. */
function provenanceReport(bundles, nowIso) {
  const rows = bundles.map((b) => provenanceSummary(b, nowIso));
  const done = rows.reduce((n, r) => n + r.done, 0);
  const derived = rows.reduce((n, r) => n + r.derived, 0);
  const compliant = rows.filter((r) => r.compliant).length;
  return {
    bundles: rows.length,
    compliant,
    compliantPercent: rows.length ? Math.round((compliant / rows.length) * 100) : null,
    completedElements: done,
    derivedElements: derived,
    attestedElements: done - derived,
    derivedPercent: done ? Math.round((derived / done) * 100) : null,
    rows,
    // The sentence a quality report should lead with rather than bury.
    reading: done
      ? `${Math.round((derived / done) * 100)} percent of completed bundle elements are evidenced by another system's record. The remainder are attestations, and a compliance figure is only as good as that proportion.`
      : "No completed elements to report on.",
  };
}

export {
  PROVENANCE, BindingError, BundleBinder,
  markAttested, provenanceSummary, provenanceReport,
};
