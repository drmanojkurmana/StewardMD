/* medcore/medcore-shadow.js — running the decision path where it reaches nobody.
 *
 * Shadow does not mean "shown with a caveat" and does not mean "sent to the research team". A model
 * in shadow whose predictions are visible is already influencing care and its evaluation is
 * contaminated by the behaviour it caused - wardsynq-mlops.js states this and enforces it, and this
 * file is written to that definition rather than a softer one.
 *
 * FIVE PROPERTIES, in the order they matter.
 *
 *  1. IT REACHES NOBODY. No DOM, no network, no prompt, no notification, no store, no event emitted
 *     back onto the bus. The only output is a bounded in-memory ring buffer whose entries carry
 *     statuses, reasons and versions - never a patient value, never an identifier, never a name.
 *  2. IT CANNOT THROW INTO THE APP. Every handler is wrapped. A defect here is a number on a
 *     diagnostics object, never a broken ward round. Failures are counted, because a shadow that
 *     silently stopped observing reports "nothing went wrong" while looking at nothing - a mistake
 *     this repository has already made once (wardsynq-shadow-boot.js, 2026-09-05).
 *  3. IT IS INSTALLED FROM OUTSIDE. It subscribes to a bus it is handed; it modifies no host file.
 *     Not loading it removes the feature completely, with no edit to revert.
 *  4. TWO CLOCKS, AND THEY ARE NOT THE SAME CLOCK. The debounce uses wall time, because "have I
 *     looked at this patient in the last minute" is a question about now. The DECISION's `asOf`
 *     comes from the caller's state and is never defaulted here: that one is the leakage control
 *     and it is not this file's to supply.
 *  5. TODAY IT WILL RECORD NOTHING BUT ABSTENTIONS, and that is correct. Every artifact in this
 *     repository is synthetic, medcore-models.js refuses them all, and so every decision this
 *     observer sees is ABSTAIN with MODEL_UNAVAILABLE. A shadow run that produced probabilities
 *     right now would mean the refusal had been bypassed.
 *
 * node --test test/medcore-shadow.test.mjs
 */

import { decide } from "./medcore-decide.js";
import { STATUS } from "./medcore-calibration.js";

const DEFAULT_DEBOUNCE_MS = 60000;
const DEFAULT_BUFFER = 500;

/**
 * @param {object} deps
 *   outcomes    medcore/data/outcomes.json
 *   artifacts   { [outcomeId]: artifact }  - may be empty
 *   stateFor    (payload) => state|null    - the caller's adapter from an event to a built state
 *   mlops       optional { recordShadowPrediction, registry }  (wardsynq-mlops.js)
 *   clock       () => ms, for the DEBOUNCE only (property 4)
 *   debounceMs  default 60000
 *   bufferSize  default 500
 */
export function createShadow(deps) {
  const d = deps || {};
  const clock = d.clock || (() => Date.now());
  const debounceMs = d.debounceMs === undefined ? DEFAULT_DEBOUNCE_MS : d.debounceMs;
  const bufferSize = d.bufferSize || DEFAULT_BUFFER;

  const lastSeen = new Map();          // subjectKey -> wall ms
  const buffer = [];
  const stats = { seen: 0, debounced: 0, noState: 0, evaluated: 0, failed: 0, recorded: 0, byStatus: {} };
  let unsubscribes = [];

  function remember(entry) {
    buffer.push(entry);
    while (buffer.length > bufferSize) buffer.shift();
  }

  /** One evaluation. Returns the decision frame, or null if it was skipped or failed. */
  function observe(payload) {
    stats.seen++;
    try {
      const state = d.stateFor ? d.stateFor(payload) : null;
      if (!state) { stats.noState++; return null; }

      const key = state.subjectKey || "unknown";
      const now = clock();
      const prev = lastSeen.get(key);
      if (prev !== undefined && now - prev < debounceMs) { stats.debounced++; return null; }
      lastSeen.set(key, now);

      const out = decide(state, {
        outcomes: d.outcomes, artifacts: d.artifacts || {},
        purpose: d.purpose, enabled: d.enabled
      });
      stats.evaluated++;

      for (const dec of out.decisions) {
        stats.byStatus[dec.status] = (stats.byStatus[dec.status] || 0) + 1;
        // Property 1: statuses, reasons and versions only. No value from the patient goes in here.
        remember({
          at: out.asOf, outcome: dec.id, status: dec.status,
          reason: dec.reason || null,
          artifactRefusal: dec.artifactRefusal ? dec.artifactRefusal.refusal : null,
          model: dec.model || null,
          probabilityDecile: typeof dec.probability === "number" ? Math.floor(dec.probability * 10) / 10 : null
        });
        recordToMlops(dec, out);
      }
      return out;
    } catch (e) {
      // Property 2: counted, never thrown.
      stats.failed++;
      return null;
    }
  }

  /** wardsynq-mlops.js owns shadow bookkeeping; this only hands it what it asks for. */
  function recordToMlops(dec, out) {
    if (!d.mlops || typeof d.mlops.recordShadowPrediction !== "function" || !d.mlops.registry) return;
    if (dec.status !== STATUS.OK) return;          // there is no prediction to record
    try {
      d.mlops.recordShadowPrediction(d.mlops.registry, {
        id: dec.id + "@" + (dec.model || "unknown"),
        prediction: dec.probability,
        at: out.asOf
      });
      stats.recorded++;
    } catch (e) { stats.failed++; }
  }

  /**
   * Property 3: subscribes to a bus it is handed. `types` are the event types worth an evaluation -
   * a new observation, a medication administration, a device reading - and nothing else. A dashboard
   * repaint is not a clinical change and must not trigger one.
   */
  function attach(bus, opts) {
    const types = (opts && opts.types) || ["observation.recorded", "medication.administered", "device.reading"];
    if (!bus || typeof bus.on !== "function") return () => {};
    /* The bus delivers a WRAPPED event ({id, type, payload, vectorClock, ...}), not the bare
     * payload - checked against wardsynq-events.js rather than assumed, because assuming it handed
     * over the payload made every observation look like an event with no state, which counts as
     * "nothing to do" and reads exactly like "nothing went wrong". */
    unsubscribes = types.map((t) => bus.on(t, async (event) => {
      observe(event && event.payload !== undefined ? event.payload : event);
    }));
    return detach;
  }

  function detach() {
    for (const off of unsubscribes) { try { off(); } catch (e) {} }
    unsubscribes = [];
  }

  return {
    observe, attach, detach,
    /** Diagnostics. Deliberately the only way anything gets out of here. */
    report: () => ({
      stats: JSON.parse(JSON.stringify(stats)),
      buffered: buffer.length,
      subjectsTracked: lastSeen.size,
      attached: unsubscribes.length > 0
    }),
    /** The ring buffer, copied. Statuses and versions only; see property 1. */
    entries: () => buffer.map((e) => Object.assign({}, e)),
    clear: () => { buffer.length = 0; lastSeen.clear(); }
  };
}
