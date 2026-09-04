/* wardsynq/wardsynq-vitals.js — turning a pile of observations into the current value of a parameter.
 *
 * Both scoring charts need the same thing before they can score anything: the latest trustworthy
 * value for each parameter. That sounds trivial and is where two real hazards live, so it is stated
 * once here rather than twice, slightly differently, in two files.
 *
 *   1. ARTIFACT MUST NEVER REACH A SCORE. `scoreable()` is the IoMT filter's supported entry point
 *      and it runs here, at the consumer, where forgetting it would be invisible. A detached lead
 *      reading a pulse of 38 would otherwise call an emergency on a well patient, and the mirror
 *      failure, a reassuring artefact, is worse.
 *   2. A STALE OBSERVATION DOES NOT DESCRIBE A PATIENT NOW. A chart built from a six-hour-old blood
 *      pressure produces a current-looking number about a patient who has since changed. Out-of-
 *      window readings are REJECTED with the reason rather than quietly used, and the parameter is
 *      then simply missing, which each chart handles in its own way.
 *
 * This file was extracted when the obstetric chart was added: NEWS2 gathered properly and MEOWS took
 * a plain values object, so a MEOWS could be computed over stale or artefactual data with nothing to
 * stop it. Two charts with two different ideas of what counts as a current observation is the same
 * class of defect as two notification paths with two definitions of delivery.
 *
 * node --test test/wardsynq-deterioration.test.mjs
 */

import { scoreable } from "./wardsynq-iomt.js";

/** How old a vital sign may be and still describe the patient now. A local policy, stated once. */
const FRESHNESS_MS = 4 * 60 * 60 * 1000;

/**
 * Reduces observations to the latest trustworthy value for each named parameter.
 *
 * @param {object[]} observations
 * @param {{codeMap: Record<string,string>, now?: string, freshnessMs?: number}} opts
 *   `codeMap` maps an observation code (LOINC, or a bare parameter name) to a parameter key.
 * @returns {{values: object, sources: object, rejected: {id, param, reason}[]}}
 */
function gatherVitals(observations, { codeMap, now, freshnessMs = FRESHNESS_MS } = {}) {
  const nowMs = Date.parse(now || new Date().toISOString());
  const values = {};
  const sources = {};
  const rejected = [];

  for (const o of scoreable(observations)) {
    if (!o || !o.code) continue;
    const param = codeMap[o.code] || (Object.values(codeMap).includes(o.code) ? o.code : null);
    if (!param) continue;

    const at = Date.parse(o.effectiveAt || (o.meta && (o.meta.effectiveAt || o.meta.recordedAt)) || "");
    if (!Number.isFinite(at)) {
      rejected.push({ id: o.id, param, reason: "no effective time, so its age cannot be established" });
      continue;
    }
    // A future-dated observation is refused before staleness is even considered. It arises from
    // device clock skew or a feed with a timezone bug, and it is more dangerous than a stale one
    // because it wins: "latest reading" logic ranks it above the correct current value, so the
    // score is computed from a number describing a moment that has not happened. Found by an
    // end-to-end scenario, and it is the same property wardsynq-simulation.js asserts as an
    // invariant while this gatherer was not enforcing it.
    if (at > nowMs) {
      rejected.push({
        id: o.id, param,
        reason: `effective time is ${Math.round((at - nowMs) / 60000)} minutes in the future, so it cannot describe the patient now and must not outrank a current reading`,
      });
      continue;
    }
    if (nowMs - at > freshnessMs) {
      rejected.push({
        id: o.id, param,
        reason: `recorded ${Math.round((nowMs - at) / 60000)} minutes ago, beyond the ${Math.round(freshnessMs / 60000)} minute freshness window`,
      });
      continue;
    }
    if (sources[param] && sources[param].at >= at) continue; // an older reading never replaces a newer one
    values[param] = o.value;
    sources[param] = { id: o.id, at, atIso: new Date(at).toISOString(), code: o.code };
  }
  return { values, sources, rejected };
}

export { FRESHNESS_MS, gatherVitals };
