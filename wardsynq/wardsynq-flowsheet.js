/* wardsynq/wardsynq-flowsheet.js — the hourly chart, and the sum that is quietly wrong.
 *
 * The ICU flowsheet is the densest document in a hospital: every hour, for every patient, vitals and
 * drips and fluids and ventilator settings and neurological observations, in a grid a nurse fills in
 * while doing several other things. Decisions are made off its running totals rather than off its
 * individual cells, and that is where the danger is, because a running total looks equally
 * authoritative whether or not the hours underneath it are complete.
 *
 *   1. A MISSING HOUR IS NOT ZERO. This is the same defect as a missing NEWS2 parameter and it is
 *      worse here, because it compounds. If nobody charted urine output between 03:00 and 06:00, a
 *      24-hour balance that sums what it has produces a number that is wrong by exactly the amount
 *      nobody knows, and it is that number a consultant reads at 08:00 before prescribing diuresis
 *      or fluid. Every total here reports its own completeness and NAMES the missing hours.
 *   2. THE HOUR IS A BUCKET, NOT A TIMESTAMP. Charting is retrospective: the 14:00 observations get
 *      written at 14:40, and after a bad night they get written at 20:00. So an entry carries WHEN
 *      IT WAS OBSERVED and WHEN IT WAS CHARTED, separately, and an entry charted long after the fact
 *      is marked BACKFILLED. An entry written six hours late that looks identical to one written on
 *      time is both a clinical and a medico-legal problem.
 *   3. AN INFUSION IS AN INTEGRAL, NOT A MULTIPLICATION. Volume delivered is the rate history
 *      integrated over time. Taking the CURRENT rate and multiplying by elapsed time is the obvious
 *      implementation and it is wrong for every patient whose rate was ever changed, which in the
 *      ICU is all of them, and wrong in the direction of under-reporting a vasopressor.
 *   4. SET AND MEASURED ARE DIFFERENT FACTS. A set PEEP of 8 and a measured PEEP of 12 mean the
 *      patient is doing something. A flowsheet that stores one number per row cannot show that, and
 *      the difference is often the finding.
 *   5. A CORRECTION CHANGES EVERY TOTAL AFTER IT. Charting 400 mL and correcting it to 40 makes
 *      every subsequent cumulative balance wrong until it is recomputed, and somebody may already
 *      have acted on it. Corrections are bi-temporal (wardsynq-temporal.js) and report what they
 *      invalidated.
 *
 * NOT MODELLED: ventilator waveform data, the actual ventilator or pump protocols, nutrition and
 * calorie balance, drain and stoma specifics, pressure-area and turning charts, and any local
 * flowsheet layout. Rendering is not here either: this is the arithmetic and the honesty about it.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-flowsheet.test.mjs
 */

import { weightLooksWrong, ageBandOf, BAND } from "./wardsynq-paediatrics.js";

const HOUR_MS = 3_600_000;

/** How late a chart entry may be before it is marked as backfilled rather than contemporaneous. */
const BACKFILL_AFTER_MINUTES = 90;

/** What a row is. `set` and `measured` are deliberately separate kinds, not a flag on one kind. */
const KIND = Object.freeze({
  OBSERVED: "observed",       // something a person or device saw: a pulse, a urine volume
  SET: "set",                 // something a person told a machine to do: a ventilator setting
  MEASURED: "measured",       // what the machine reports back: a measured PEEP, a delivered volume
  ADMINISTERED: "administered", // something given
});

const DIRECTION = Object.freeze({ IN: "in", OUT: "out" });

class FlowsheetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "FlowsheetError";
    this.code = code || "FLOWSHEET_VIOLATION";
  }
}

/** The hour bucket an instant falls into, as an ISO string on the hour. */
function hourBucket(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) throw new FlowsheetError(`"${iso}" is not a time`, "BAD_TIME");
  return new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString();
}

/** Every hour bucket in a window, inclusive of the start hour and exclusive of the end. */
function hoursBetween(fromIso, toIso) {
  const from = Date.parse(hourBucket(fromIso));
  const to = Date.parse(toIso);
  if (!(to > from)) return [];
  const out = [];
  for (let t = from; t < to; t += HOUR_MS) out.push(new Date(t).toISOString());
  return out;
}

/**
 * Records one flowsheet entry.
 *
 * `observedAt` and `chartedAt` are BOTH required. Defaulting one to the other is the change that
 * would quietly erase the distinction this file exists to keep.
 */
function chart({ patientId, code, label, value, unit, kind, direction, observedAt, chartedAt, by, note } = {}) {
  if (!patientId) throw new FlowsheetError("a flowsheet entry belongs to a patient", "NO_PATIENT");
  if (!code) throw new FlowsheetError("a flowsheet entry needs a code", "NO_CODE");
  if (!by) throw new FlowsheetError("a flowsheet entry names who charted it", "NO_ACTOR");
  if (!observedAt || !chartedAt) {
    throw new FlowsheetError(
      "both observedAt and chartedAt are required. Charting is retrospective in an ICU: the 14:00 observations are written at 14:40, and after a bad night at 20:00. Collapsing them into one time erases whether the record was contemporaneous",
      "NO_TIMES");
  }
  if (!Object.values(KIND).includes(kind)) {
    throw new FlowsheetError(`kind must be one of ${Object.values(KIND).join(", ")}; a set value and a measured value are different facts`, "NO_KIND");
  }

  const observed = Date.parse(observedAt);
  const charted = Date.parse(chartedAt);
  if (!Number.isFinite(observed) || !Number.isFinite(charted)) throw new FlowsheetError("unparseable time", "BAD_TIME");
  if (charted < observed) {
    throw new FlowsheetError("an entry cannot be charted before it was observed", "CHARTED_BEFORE_OBSERVED");
  }

  const lagMinutes = (charted - observed) / 60000;
  return {
    patientId, code, label: label || code, value, unit: unit || null,
    kind, direction: direction || null,
    observedAt, chartedAt, by, note: note || null,
    hour: hourBucket(observedAt),
    lagMinutes: Math.round(lagMinutes),
    // Visible, and computed rather than declared, so it cannot be omitted by a caller in a hurry.
    backfilled: lagMinutes > BACKFILL_AFTER_MINUTES,
    backfillNote: lagMinutes > BACKFILL_AFTER_MINUTES
      ? `charted ${Math.round(lagMinutes)} minutes after it was observed; read as a retrospective entry, not a contemporaneous one`
      : null,
    amended: false, amendedAt: null, amendedBy: null, supersedes: null, supersededBy: null,
  };
}

/**
 * Corrects an entry.
 *
 * Bi-temporal: the original is kept and superseded rather than overwritten, because the wrong value
 * is what a clinician saw and may have acted on, and a chart that cannot show what it used to say
 * cannot explain a decision.
 */
function correct(original, { value, by, reason, at } = {}) {
  if (!by || !reason) throw new FlowsheetError("a correction names who made it and why", "NO_REASON");
  if (original.supersededBy) throw new FlowsheetError("this entry has already been corrected", "ALREADY_CORRECTED");

  const now = at || new Date().toISOString();
  const replacement = {
    ...original,
    value,
    chartedAt: now,
    amended: true, amendedAt: now, amendedBy: by, amendmentReason: reason,
    supersedes: { value: original.value, chartedAt: original.chartedAt, by: original.by },
    supersededBy: null,
  };
  original.supersededBy = { at: now, by, reason, newValue: value };
  return {
    original, replacement,
    // The half people forget. A corrected volume changes every cumulative total after it, and
    // somebody may already have prescribed off the old one.
    note: `Every cumulative total that included the original ${original.value}${original.unit ? " " + original.unit : ""} from ${original.hour} onward is now wrong until recomputed. Check whether anyone acted on it.`,
  };
}

/** The entries that are current, i.e. not superseded by a correction. */
const currentEntries = (entries) => (entries || []).filter((e) => !e.supersededBy);

/* ------------------------------------------------------------------ fluid balance */

/**
 * Fluid balance over a window, refusing to present an incomplete total as a complete one.
 *
 * The hours with NO entry at all in a given direction are named. That is the number a consultant
 * needs and never gets: not "balance +2.1 L" but "balance +2.1 L over 21 of 24 hours, output not
 * charted 03:00 to 06:00".
 *
 * @returns {{inMl, outMl, balanceMl, complete, missingHours, hoursCovered, reading}}
 */
function fluidBalance(entries, { from, to, requireBothDirections = true } = {}) {
  if (!from || !to) throw new FlowsheetError("a balance needs a window", "NO_WINDOW");
  const hours = hoursBetween(from, to);
  const rows = currentEntries(entries).filter((e) => {
    const t = Date.parse(e.observedAt);
    return e.direction && t >= Date.parse(from) && t < Date.parse(to);
  });

  let inMl = 0;
  let outMl = 0;
  const seenIn = new Set();
  const seenOut = new Set();

  for (const e of rows) {
    const v = Number(e.value);
    if (!Number.isFinite(v)) continue;
    if (e.direction === DIRECTION.IN) { inMl += v; seenIn.add(e.hour); }
    else if (e.direction === DIRECTION.OUT) { outMl += v; seenOut.add(e.hour); }
  }

  // An hour is missing if nothing was charted in a direction the window requires. Requiring BOTH is
  // the ICU default: an hour with intake charted and output blank is not a complete hour, and it is
  // the commonest shape of the gap.
  const missingHours = hours.filter((h) => (!seenIn.has(h) && requireBothDirections) || !seenOut.has(h))
    .map((h) => ({
      hour: h,
      missing: [!seenIn.has(h) ? "intake" : null, !seenOut.has(h) ? "output" : null].filter(Boolean),
    }));

  const complete = missingHours.length === 0;
  const balanceMl = inMl - outMl;

  return {
    from, to,
    inMl, outMl, balanceMl,
    hoursInWindow: hours.length,
    hoursCovered: hours.length - missingHours.length,
    complete,
    missingHours,
    // Deliberately still returns the numbers. Suppressing them would push a nurse to add the total
    // up on paper, which is worse. What it refuses to do is call an incomplete total complete.
    reading: complete
      ? `Balance ${balanceMl >= 0 ? "+" : ""}${balanceMl} mL over ${hours.length} complete hours.`
      : `Balance ${balanceMl >= 0 ? "+" : ""}${balanceMl} mL over ${hours.length - missingHours.length} of ${hours.length} hours. INCOMPLETE: ${missingHours.map((m) => `${m.hour.slice(11, 16)} (${m.missing.join(" and ")})`).join(", ")}. The true balance differs by whatever was not charted.`,
    caution: complete ? null
      : "This total is arithmetic over the hours that were charted. It is not the patient's fluid balance, and the difference is exactly the amount nobody recorded.",
  };
}

/* ------------------------------------------------------------------ infusions */

/**
 * Volume delivered by an infusion, integrated over its rate history.
 *
 * `rateHistory` is [{at, ratePerHour}] in order. The obvious implementation, current rate times
 * elapsed time, is wrong for every patient whose rate was ever changed, and it under-reports a
 * vasopressor that has been weaned, which is the direction that misleads.
 */
function infusionVolume(rateHistory, { from, to } = {}) {
  const history = (rateHistory || []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!history.length) return { ml: 0, segments: [], complete: false, reason: "no rate history" };
  if (!from || !to) throw new FlowsheetError("an infusion volume needs a window", "NO_WINDOW");

  const start = Date.parse(from);
  const end = Date.parse(to);
  const segments = [];
  let ml = 0;

  for (let i = 0; i < history.length; i++) {
    const segStart = Math.max(Date.parse(history[i].at), start);
    const segEnd = Math.min(i + 1 < history.length ? Date.parse(history[i + 1].at) : end, end);
    if (!(segEnd > segStart)) continue;
    const hours = (segEnd - segStart) / HOUR_MS;
    const rate = Number(history[i].ratePerHour);
    if (!Number.isFinite(rate)) continue;
    const volume = rate * hours;
    ml += volume;
    segments.push({
      from: new Date(segStart).toISOString(), to: new Date(segEnd).toISOString(),
      ratePerHour: rate, hours: Math.round(hours * 100) / 100, ml: Math.round(volume * 10) / 10,
    });
  }

  // The window may start before the infusion did. That is not an error, but the total then covers
  // less than the window and saying so is the difference between a total and a guess.
  const firstAt = Date.parse(history[0].at);
  const covered = firstAt > start;

  return {
    ml: Math.round(ml * 10) / 10,
    segments,
    complete: segments.length > 0,
    startedAfterWindow: covered,
    reason: covered ? `the infusion started at ${history[0].at}, after the window opened at ${from}` : null,
  };
}

/**
 * A weight-based infusion rate, refusing to compute one on a weight it does not have or believe.
 *
 * The weight is the input everybody forgets is an input. It is frequently an estimate, it is
 * sometimes a transcription error, and every mcg/kg/min in the unit is multiplied by it.
 */
function weightBasedRate({ dosePerKgPerMin, weightKg, concentrationMgPerMl, patient, now } = {}) {
  if (typeof dosePerKgPerMin !== "number" || !(dosePerKgPerMin > 0)) {
    throw new FlowsheetError("a weight-based rate needs a dose per kg per minute", "NO_DOSE");
  }
  if (typeof weightKg !== "number" || !(weightKg > 0)) {
    return {
      ratePerHour: null,
      reason: "no recorded weight. A weight-based infusion cannot be calculated without one, and an estimate must be recorded AS an estimate rather than assumed",
    };
  }
  if (typeof concentrationMgPerMl !== "number" || !(concentrationMgPerMl > 0)) {
    throw new FlowsheetError("a rate in mL/h needs the concentration of the bag actually hanging", "NO_CONCENTRATION");
  }

  // The plausibility check from the paediatrics module, applied here because this is where a
  // mistyped weight becomes an infusion rate rather than staying a number in a box.
  const band = patient ? ageBandOf(patient, now).band : BAND.ADULT;
  const weightWarning = band === BAND.UNKNOWN ? null : weightLooksWrong(weightKg, band);

  // mcg/kg/min -> mg/h -> mL/h
  const mcgPerHour = dosePerKgPerMin * weightKg * 60;
  const mgPerHour = mcgPerHour / 1000;
  const ratePerHour = mgPerHour / concentrationMgPerMl;

  return {
    ratePerHour: Math.round(ratePerHour * 100) / 100,
    dosePerKgPerMin, weightKg, concentrationMgPerMl,
    // Carried so the flowsheet cell can be traced back to the three numbers it came from, one of
    // which is a weight somebody typed.
    workings: `${dosePerKgPerMin} mcg/kg/min x ${weightKg} kg x 60 = ${Math.round(mcgPerHour)} mcg/h = ${Math.round(mgPerHour * 100) / 100} mg/h / ${concentrationMgPerMl} mg/mL`,
    weightWarning: weightWarning || null,
    caution: weightWarning
      ? `${weightWarning.message} Every weight-based rate on this patient is multiplied by this number.`
      : null,
  };
}

/* ------------------------------------------------------------------ set versus measured */

/**
 * Pairs a set value with what the machine measured, and reports the divergence.
 *
 * A set PEEP of 8 with a measured PEEP of 12 means the patient is doing something. A flowsheet
 * holding one number per row cannot show that, which is why KIND.SET and KIND.MEASURED are
 * different kinds rather than a flag.
 */
function setVersusMeasured(entries, code, { hour, tolerance = 0 } = {}) {
  const rows = currentEntries(entries).filter((e) => e.code === code && (!hour || e.hour === hour));
  const set = rows.filter((e) => e.kind === KIND.SET).slice(-1)[0] || null;
  const measured = rows.filter((e) => e.kind === KIND.MEASURED).slice(-1)[0] || null;

  if (!set && !measured) return { code, set: null, measured: null, state: "absent" };
  if (!set) return { code, set: null, measured, state: "measured-only", note: "measured with no recorded setting, so it cannot be told whether the machine is doing what was asked" };
  if (!measured) return { code, set, measured: null, state: "set-only", note: "set with no measured value, so it is not known whether it was delivered" };

  const diff = Number(measured.value) - Number(set.value);
  const diverged = Math.abs(diff) > tolerance;
  return {
    code, set, measured, difference: Math.round(diff * 100) / 100,
    state: diverged ? "diverged" : "matched",
    note: diverged
      ? `set ${set.value}${set.unit ? " " + set.unit : ""}, measured ${measured.value}${measured.unit ? " " + measured.unit : ""}. The difference is the finding: the machine is not delivering what was asked, or the patient is.`
      : null,
  };
}

/* ------------------------------------------------------------------ the grid */

/**
 * Assembles the hourly grid a nurse actually sees, one column per hour.
 *
 * Empty cells stay empty and are counted. A grid that renders a blank the same as a zero is the
 * display half of the missing-hour problem: it looks complete.
 */
function buildGrid(entries, { from, to, codes } = {}) {
  const hours = hoursBetween(from, to);
  const rows = currentEntries(entries);
  const wanted = codes && codes.length ? codes : [...new Set(rows.map((e) => e.code))];

  const grid = wanted.map((code) => {
    const cells = hours.map((h) => {
      const inHour = rows.filter((e) => e.code === code && e.hour === h);
      if (!inHour.length) return { hour: h, empty: true, value: null };
      // The latest by observation time within the hour, with the rest kept so a cell can be opened.
      const latest = inHour.slice().sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
      return {
        hour: h, empty: false,
        value: latest.value, unit: latest.unit, kind: latest.kind,
        backfilled: latest.backfilled, amended: latest.amended,
        entries: inHour.length,
      };
    });
    const charted = cells.filter((c) => !c.empty).length;
    return {
      code,
      label: (rows.find((e) => e.code === code) || {}).label || code,
      cells,
      chartedHours: charted,
      completeness: hours.length ? Math.round((charted / hours.length) * 100) : null,
    };
  });

  const backfilledCount = rows.filter((e) => e.backfilled).length;
  return {
    from, to, hours, rows: grid,
    // Surfaced at the top of the grid rather than per-cell, because the pattern is the signal: one
    // backfilled row is a busy hour, a whole shift of them is a shift where nobody was charting.
    backfilledEntries: backfilledCount,
    backfillReading: backfilledCount
      ? `${backfilledCount} of ${rows.length} entries were charted more than ${BACKFILL_AFTER_MINUTES} minutes after they were observed. Read this grid as partly retrospective.`
      : null,
    amendedEntries: rows.filter((e) => e.amended).length,
  };
}


/**
 * What a correction actually changed, recomputed rather than described.
 *
 * `correct()` can only tell the person making the correction that later totals are now wrong. This
 * says WHICH, and by how much, and flags the ones where the change is not merely arithmetic: a
 * balance that flips sign, or crosses a threshold somebody prescribes against, is a different fact
 * about the patient rather than a smaller number.
 *
 * It still does not tell the consultant who read the old figure at 06:00, because nothing records
 * that anyone read it. Closing that needs a view log, which does not exist, and pretending this
 * function closes it would be the dishonest part.
 *
 * TAKES THE CORRECTION, NOT TWO ARRAYS. An earlier signature asked the caller for the entry set
 * before and after, and it was a trap: `correct()` marks the original superseded IN PLACE, so a
 * caller holding one array before and after the call is holding the same mutated objects and both
 * totals come out identical. A test caught it. The before-state is derived here instead, from the
 * correction itself, so it cannot be got wrong.
 *
 * @param {{entries: object[], correction: {original, replacement}, windows: {from, to, label?}[],
 *   thresholdsMl?: number[]}} input
 */
function recomputeAfterCorrection({ entries, correction, windows, thresholdsMl = [0] } = {}) {
  if (!Array.isArray(entries)) throw new FlowsheetError("recomputation needs the current entries", "NO_SETS");
  if (!correction || !correction.original || !correction.replacement) {
    throw new FlowsheetError("recomputation needs the correction it is recomputing, as returned by correct()", "NO_CORRECTION");
  }
  if (!windows || !windows.length) throw new FlowsheetError("recomputation needs the windows to recompute", "NO_WINDOW");

  // The world as it was: the replacement had not been written and the original was still current.
  const after = entries;
  const before = entries
    .filter((e) => e !== correction.replacement)
    .map((e) => (e === correction.original ? { ...e, supersededBy: null } : e));

  const changed = [];
  for (const w of windows) {
    const wasBalance = fluidBalance(before, { from: w.from, to: w.to });
    const nowBalance = fluidBalance(after, { from: w.from, to: w.to });
    const delta = nowBalance.balanceMl - wasBalance.balanceMl;
    if (delta === 0) continue;

    // A threshold crossing is the part that matters. Going from +180 to -220 is not "400 mL
    // smaller", it is a patient who was positive and is now negative, and somebody prescribes on
    // that distinction.
    const crossed = thresholdsMl.filter((t) =>
      (wasBalance.balanceMl >= t && nowBalance.balanceMl < t) || (wasBalance.balanceMl < t && nowBalance.balanceMl >= t));

    changed.push({
      label: w.label || `${w.from} to ${w.to}`,
      from: w.from, to: w.to,
      wasMl: wasBalance.balanceMl,
      nowMl: nowBalance.balanceMl,
      deltaMl: delta,
      crossedThresholds: crossed,
      complete: nowBalance.complete,
      significance: crossed.length
        ? `crosses ${crossed.join(", ")} mL: this window read ${wasBalance.balanceMl >= 0 ? "positive" : "negative"} and now reads ${nowBalance.balanceMl >= 0 ? "positive" : "negative"}`
        : null,
    });
  }

  return {
    windowsChanged: changed.length,
    changed,
    crossings: changed.filter((c) => c.crossedThresholds.length),
    reading: changed.length === 0
      ? "No cumulative total in the given windows changed."
      : `${changed.length} cumulative total${changed.length > 1 ? "s" : ""} changed: ${changed.map((c) => `${c.label} ${c.wasMl >= 0 ? "+" : ""}${c.wasMl} to ${c.nowMl >= 0 ? "+" : ""}${c.nowMl} mL`).join("; ")}.`,
    // The part this function cannot do, said rather than implied by its absence.
    limitation: "This is what the totals now say. It does NOT identify who read the previous figures or what they prescribed off them, because nothing in this build records that a total was read. Someone has to look.",
  };
}

export {
  HOUR_MS, BACKFILL_AFTER_MINUTES, KIND, DIRECTION, FlowsheetError,
  hourBucket, hoursBetween, chart, correct, currentEntries,
  fluidBalance, infusionVolume, weightBasedRate, setVersusMeasured, buildGrid,
  recomputeAfterCorrection,
};
