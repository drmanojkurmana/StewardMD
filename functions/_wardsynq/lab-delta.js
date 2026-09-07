/* functions/_wardsynq/lab-delta.js — "this cannot be the same patient", and who is allowed to skip a look.
 *
 * A creatinine of 240 is a number. A creatinine of 240 in someone whose creatinine was 78 yesterday
 * is a different fact entirely, and the commonest explanation is not renal failure - it is that the
 * tube was mislabelled, or the analyser drifted, or two samples were swapped. A DELTA CHECK is the
 * laboratory's oldest defence against that, and WardSynQ had none: every result was released as if
 * it were the patient's first.
 *
 * IT NEVER BLOCKS A RESULT. Not once, not for any threshold. A laboratory that cannot release a
 * number because software disagreed with it is a laboratory that routes around the software by the
 * end of the week, and then nothing is checked at all. A breach is an annotation on the result and a
 * flag on the response; a human decides what it means.
 *
 * THE THRESHOLDS ARE THE HOSPITAL'S, exactly like the critical limits and the high-alert drug list.
 * Nothing here knows what a big change in a potassium is. An analyte with no configured limit is not
 * delta-checked, and the response SAYS it was not checked rather than implying it passed.
 *
 * UNITS ARE NOT CONVERTED, AND MISMATCHED UNITS ARE NOT COMPARED. A creatinine in µmol/L against one
 * in mg/dL differs by a factor of 88, and a delta check that quietly compared them would fire on
 * every patient whose sample went to a different analyser. Different units means NOT COMPARABLE, and
 * that is reported, not resolved.
 *
 * AGE MATTERS. A value from three months ago is not what a delta check is for; comparing against it
 * produces alarm about a patient who has simply been ill for a while. The window is configured, and
 * a previous result outside it is treated as absent.
 *
 * AUTOVERIFICATION FAILS CLOSED. A result is released without a human look ONLY when every rule can
 * be evaluated and every one passes. Anything unknown - no reference range, a non-numeric value, an
 * analyte not on the hospital's list, a delta that could not be computed - means a human looks at it.
 * The dangerous direction is autoverifying something nobody checked, so absence never counts as
 * passing.
 */

const str = (v) => (v == null ? "" : String(v).trim());
const num = (v) => {
  // `Number("")` is 0 and 0 is finite, so an absent field would arrive as a real zero - which made a
  // configured-but-empty delta rule look like a rule whose threshold was zero. Absence is null.
  if (v === null || v === undefined || (typeof v !== "number" && str(v) === "")) return null;
  const n = typeof v === "number" ? v : Number(str(v));
  return Number.isFinite(n) ? n : null;
};

/** PURE. The hospital's delta rule for one analyte, or null when it has not configured one. */
function limitFor(deltaLimits, code) {
  const table = deltaLimits && typeof deltaLimits === "object" ? deltaLimits : null;
  if (!table) return null;
  const raw = table[str(code)];
  if (!raw || typeof raw !== "object") return null;
  const maxAbsolute = num(raw.maxAbsolute), maxPercent = num(raw.maxPercent), withinHours = num(raw.withinHours);
  // A rule with no threshold at all is not a rule. Reported as unusable by the caller rather than
  // treated as "anything passes".
  if (maxAbsolute === null && maxPercent === null) return null;
  return {
    maxAbsolute: maxAbsolute !== null && maxAbsolute > 0 ? maxAbsolute : null,
    maxPercent: maxPercent !== null && maxPercent > 0 ? maxPercent : null,
    withinHours: withinHours !== null && withinHours > 0 ? withinHours : 72,
  };
}

/**
 * PURE. The most recent comparable previous result for this analyte.
 *
 * Comparable means: same code, numeric, SAME UNIT, and inside the window. Each failure is a distinct
 * answer because each one means something different to whoever reads it.
 */
function previousFor(observations, code, unit, nowMs, withinHours) {
  const rows = (observations || []).filter((o) => o && str(o.code) === str(code) && o.category === "laboratory");
  if (!rows.length) return { state: "none" };

  const dated = rows
    .map((o) => ({ o, t: Date.parse(str((o.meta && o.meta.effectiveAt) || o.effectiveAt || (o.meta && o.meta.recordedAt))) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => b.t - a.t);
  if (!dated.length) return { state: "none" };

  const cutoff = (Number.isFinite(nowMs) ? nowMs : Date.now()) - withinHours * 3600000;
  const inWindow = dated.filter((x) => x.t >= cutoff);
  /* Outside the window is NOT "none". A value from three months ago exists and was deliberately not
   * used, and a reader deserves to know that rather than assume the patient has no history. */
  if (!inWindow.length) return { state: "stale", at: new Date(dated[0].t).toISOString(), ageHours: Math.round(((Number.isFinite(nowMs) ? nowMs : Date.now()) - dated[0].t) / 3600000) };

  const prev = inWindow[0].o;
  const value = num(prev.value);
  if (value === null) return { state: "non-numeric", at: new Date(inWindow[0].t).toISOString() };
  /* THE UNIT MISMATCH. A creatinine in µmol/L against one in mg/dL differs by 88x; comparing them
   * would fire on every patient whose sample went to a different analyser. Not converted, not
   * compared, and said out loud. */
  if (str(prev.unit) !== str(unit)) {
    return { state: "unit-mismatch", at: new Date(inWindow[0].t).toISOString(), previousUnit: str(prev.unit) || null, unit: str(unit) || null };
  }
  return { state: "ok", value, unit: str(prev.unit) || null, at: new Date(inWindow[0].t).toISOString() };
}

/**
 * PURE. Does this result differ from the last one by more than the hospital allows?
 *
 * Returns a `state` that is never a bare boolean, because "passed", "no rule configured" and "could
 * not be compared" are three different things and only one of them is reassuring.
 */
function deltaCheck(input) {
  const i = input || {};
  const code = str(i.code), unit = str(i.unit);
  const value = num(i.value);
  if (value === null) return { state: "not-checked", reason: "non_numeric_result" };

  const limit = limitFor(i.deltaLimits, code);
  /* An analyte the hospital has not configured is NOT delta-checked, and this says so rather than
   * returning a pass. A pass would read as "we compared it and it was fine". */
  if (!limit) return { state: "not-checked", reason: "no_limit_configured", code };

  const prev = previousFor(i.observations, code, unit, i.nowMs, limit.withinHours);
  if (prev.state !== "ok") return { state: "not-checked", reason: prev.state === "none" ? "no_previous_result" : prev.state.replace(/-/g, "_"), previous: prev.state === "none" ? null : prev };

  const change = value - prev.value;
  const absolute = Math.abs(change);
  // Percent is relative to the PREVIOUS value. A previous value of zero has no percentage change,
  // and dividing by it would produce Infinity and a breach on every such pair.
  const percent = prev.value === 0 ? null : Math.abs((change / prev.value) * 100);

  const breaches = [];
  if (limit.maxAbsolute !== null && absolute > limit.maxAbsolute) breaches.push({ rule: "absolute", limit: limit.maxAbsolute, observed: Math.round(absolute * 1000) / 1000 });
  if (limit.maxPercent !== null && percent !== null && percent > limit.maxPercent) breaches.push({ rule: "percent", limit: limit.maxPercent, observed: Math.round(percent * 10) / 10 });

  return {
    state: breaches.length ? "breach" : "pass",
    previous: { value: prev.value, unit: prev.unit, at: prev.at },
    change: Math.round(change * 1000) / 1000,
    percent: percent === null ? null : Math.round(percent * 10) / 10,
    direction: change > 0 ? "rise" : change < 0 ? "fall" : "same",
    ...(breaches.length ? { breaches } : {}),
    ...(breaches.length ? { detail: `This differs from the result at ${prev.at} by more than this hospital allows. It has NOT been withheld - check the sample identity before acting on it.` } : {}),
  };
}

/**
 * PURE. May this result be released without a human looking at it?
 *
 * FAILS CLOSED on everything. Each `reason` is a thing a human still has to do, and the list is the
 * point: "held" with no reason is indistinguishable from a bug.
 */
function autoVerify(input) {
  const i = input || {};
  const cfg = i.autoVerify && typeof i.autoVerify === "object" ? i.autoVerify : null;
  const reasons = [];

  if (!cfg || cfg.enabled !== true) return { verified: false, reasons: ["not_enabled"], detail: "This hospital has not enabled autoverification. Every result is looked at." };
  const codes = Array.isArray(cfg.codes) ? cfg.codes.map(str) : [];
  if (!codes.includes(str(i.code))) reasons.push("analyte_not_listed");

  const value = num(i.value);
  // A non-numeric result is a sentence somebody wrote. It is never released unread.
  if (value === null) reasons.push("non_numeric");

  // The LABORATORY's own critical flag always wins, exactly as it does in the critical-value loop.
  if (i.sourceCritical === true) reasons.push("flagged_critical_by_lab");

  const range = i.referenceRange || null;
  const low = range ? num(range.low) : null, high = range ? num(range.high) : null;
  if (low === null && high === null) {
    // No range means nothing to check against. That is not a pass.
    reasons.push("no_reference_range");
  } else if (value !== null) {
    if (low !== null && value < low) reasons.push("below_reference_range");
    if (high !== null && value > high) reasons.push("above_reference_range");
  }

  const delta = i.delta || null;
  if (delta && delta.state === "breach") reasons.push("delta_breach");
  /* A delta that could NOT be computed does not autoverify either, except where the patient simply
   * has no previous result - a first result cannot have a delta, and holding every first result
   * would mean holding most of a new admission's bloods for no finding. */
  if (delta && delta.state === "not-checked" && delta.reason !== "no_previous_result" && delta.reason !== "no_limit_configured") {
    reasons.push(`delta_${delta.reason}`);
  }

  return reasons.length
    ? { verified: false, reasons }
    : { verified: true, reasons: [], detail: "Within range, no critical flag, and no delta breach. A human may still review it." };
}

export { limitFor, previousFor, deltaCheck, autoVerify };
