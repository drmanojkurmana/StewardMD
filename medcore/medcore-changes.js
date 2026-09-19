/* medcore/medcore-changes.js — "what changed", which is the question a handover actually asks.
 *
 * A bedside screen shows the current number. A trend chart shows a line nobody reads at 03:00. The
 * sentence that changes what happens is "the MAP has been falling for three hours and the lactate
 * has come up", and nothing in this repository composes it today.
 *
 * FOUR RULES, each one a way this could produce noise instead of signal.
 *
 *  1. ABSOLUTE, NEVER PERCENTAGE. A 20 percent fall in sodium and a 20 percent fall in heart rate
 *     are not the same event; a percentage rule makes them indistinguishable and then ranks them
 *     equally. Magnitude bands are per parameter, in that parameter's own canonical unit, and they
 *     live in medcore/data/change-bands.json where a clinician can argue with them.
 *  2. A CHANGE COMPUTED ACROSS A REFUSED OBSERVATION IS NOT A CHANGE. The state's series contains
 *     only usable values, so a stale, implausible or wrongly-united reading cannot become the
 *     start or the end of a trend. A parameter that is not currently usable reports nothing at all,
 *     rather than a change ending in a value we have already said we do not trust.
 *  3. TWO READINGS A MINUTE APART ARE NOT A TRAJECTORY. A minimum separation stops a correction
 *     entered straight after a typo from being reported as a rate of change per hour.
 *  4. THE LIST IS SHORT AND RANKED. Five entries, ordered by band, then by whether the direction is
 *     the one worth telling somebody about, then by a stable per-parameter rank. An unbounded list
 *     of every parameter that moved is a trend chart with extra steps.
 *
 * WHAT IT IS NOT. It is not an alert, it does not threshold on the current VALUE (the deterministic
 * engines own that and are authoritative), and it says nothing about what the change means.
 *
 * PURE. No DOM, no I/O, no clock. Bands are injected.
 *
 * node --test test/medcore-changes.test.mjs
 */

const BAND_ORDER = { large: 3, moderate: 2, small: 1 };

/**
 * @param {object} state   a medcore-state/1 object
 * @param {object} bands   medcore/data/change-bands.json
 * @param {object} [opts]  { max, prev } - prev is an optional earlier state to compare against
 *                         instead of the start of this state's own window.
 * @returns {Array<{param:string, direction:string, from:number, to:number, delta:number,
 *                  overMin:number, perHour:number|null, magnitude:string, concerning:boolean,
 *                  basis:string}>}
 */
export function changes(state, bands, opts) {
  if (!bands || !bands.params) throw new Error("medcore-changes: a band table is required");
  const o = opts || {};
  const params = (state && state.params) || {};
  const series = (state && state.series) || {};
  const minSep = typeof bands.minSeparationMin === "number" ? bands.minSeparationMin : 5;
  const max = typeof o.max === "number" ? o.max : (bands.maxReported || 5);
  const prevParams = (o.prev && o.prev.params) || null;
  const out = [];

  for (const param of Object.keys(bands.params)) {
    const def = bands.params[param];
    const cur = params[param];
    // Rule 2: the end of a trend must be a value we trust.
    if (!cur || !cur.usable || typeof cur.value !== "number") continue;

    let from = null, fromAgeMin = null, basis = null;

    if (prevParams && prevParams[param] && prevParams[param].usable &&
        typeof prevParams[param].value === "number") {
      from = prevParams[param].value;
      fromAgeMin = prevParams[param].ageMin;
      basis = "prev-state";
    } else {
      const rows = series[param] || [];
      // Oldest usable point still inside this parameter's comparison window. Not the oldest point
      // in the lookback: a 24-hour-old blood pressure is not what "falling" means for a MAP.
      const windowMin = typeof def.windowMin === "number" ? def.windowMin : 240;
      const candidates = rows.filter((r) => r.ageMin <= windowMin && r.ageMin > cur.ageMin);
      if (!candidates.length) continue;
      const oldest = candidates[0];
      from = oldest.v;
      fromAgeMin = oldest.ageMin;
      basis = "series";
    }

    const overMin = fromAgeMin - cur.ageMin;
    if (!(overMin >= minSep)) continue;                        // Rule 3

    const delta = round3(cur.value - from);
    const size = Math.abs(delta);
    if (size < def.small) continue;                            // below the smallest band worth saying
    const magnitude = size >= def.large ? "large" : size >= def.moderate ? "moderate" : "small";
    const direction = delta > 0 ? "up" : "down";
    const concerning = def.concern === "both" || def.concern === direction;

    out.push({
      param: param,
      direction: direction,
      from: from,
      to: cur.value,
      unit: cur.unit,
      delta: delta,
      overMin: overMin,
      perHour: overMin > 0 ? round3(delta / (overMin / 60)) : null,
      magnitude: magnitude,
      concerning: concerning,
      basis: basis,
      rank: typeof def.rank === "number" ? def.rank : 99
    });
  }

  out.sort((a, b) => {
    const band = BAND_ORDER[b.magnitude] - BAND_ORDER[a.magnitude];
    if (band) return band;
    if (a.concerning !== b.concerning) return a.concerning ? -1 : 1;
    return a.rank - b.rank;
  });
  return out.slice(0, max);
}

function round3(n) { return Math.round(n * 1000) / 1000; }
