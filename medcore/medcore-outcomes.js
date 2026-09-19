/* medcore/medcore-outcomes.js — who this question may be asked about, and who it may not. HAZ-ML-02.
 *
 * THE TREATMENT PARADOX, stated once. A retrospective record is not a record of what would have
 * happened; it is a record of what happened AFTER somebody intervened. Two consequences, and this
 * file exists for the first one because it can be enforced in code.
 *
 *  1. A PATIENT ALREADY ON THE TREATMENT IS NOT A NEGATIVE, THEY ARE OUT OF THE RISK SET. "This
 *     patient on noradrenaline did not start noradrenaline in the next twelve hours" is true, and
 *     it teaches a model that being on a pressor predicts not needing one. Run that model forward
 *     and it reassures you about the sickest patients in the unit. Prevalent cases are therefore
 *     EXCLUDED, never labelled 0.
 *  2. PREPARATION FOR THE TREATMENT IS IN THE STATE BEFORE THE TREATMENT IS. A pressor charted as
 *     prepared, a pre-intubation gas, a line inserted: the last hour before the event contains the
 *     team's decision, not the patient's physiology. `blankingMin` drops it. That window is a
 *     declared constant in outcomes.json and is never tuned as a hyperparameter, because tuning it
 *     is how you find the value that maximises the leak.
 *
 * AND UNKNOWN IS NOT ABSENT. If nobody charted whether the patient is on a pressor, this file
 * cannot say they are not, so the outcome is neither asked nor labelled: it abstains. That is the
 * same rule as medcore-state.js rule 4, applied where it has teeth, and it is why `requiredKnown`
 * exists alongside `riskSetExclusions`.
 *
 * ONE DEFINITION, TWO CONSUMERS. The trainer uses `riskSet()` to build the label set; the bedside
 * uses `askable()` to decide whether a decision may be produced at all. They must not drift, so
 * they are the same function over the same table.
 *
 * PURE. No DOM, no I/O, no clock: the caller states the instant.
 *
 * node --test test/medcore-labels.test.mjs
 */

export const NOT_ASKABLE = {
  EXCLUDED: "EXCLUDED_FROM_RISK_SET",
  UNKNOWN_STATUS: "UNKNOWN_STATUS",
  INSUFFICIENT_INPUTS: "INSUFFICIENT_INFORMATION",
  UNKNOWN_OUTCOME: "UNKNOWN_OUTCOME"
};

/* Each exclusion is a question asked of the state, not of the caller's opinion. `undefined` means
 * "cannot tell", which is a refusal rather than a pass: see requiredKnown. */
const EXCLUSIONS = {
  vasopressorActiveAtT0: (s) => tri(path(s, "interventions.vasopressor.active")),
  ventilatedAtT0: (s) => tri(path(s, "interventions.ventilation.active")),
  onRrtAtT0: (s) => tri(path(s, "interventions.rrt.active")),
  alreadyInIcu: (s) => tri(path(s, "context.inIcu")),
  electivePostOpAdmission: (s) => tri(path(s, "context.electivePostOp")),
  admissionPlannedBeforeT0: (s) => tri(path(s, "context.admissionPlanned")),
  dnrAtT0: (s) => tri(path(s, "context.dnr")),
  aki2OrWorseAtT0: (s) => tri(path(s, "context.aki2OrWorse"))
};

/* What must be KNOWN (true or false, never absent) before the question is fair. */
const KNOWN = {
  vasopressor: (s) => path(s, "interventions.vasopressor.active"),
  ventilation: (s) => path(s, "interventions.ventilation.active"),
  oxygen: (s) => path(s, "interventions.oxygen.active"),
  rrt: (s) => path(s, "interventions.rrt.active"),
  resuscitationStatus: (s) => path(s, "context.dnr"),
  creatinineBaseline: (s) => path(s, "context.creatinineBaseline")
};

function path(o, dotted) {
  let cur = o;
  for (const k of dotted.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}
/** true / false / null, where null means "nobody said". */
function tri(v) { return v === true ? true : v === false ? false : null; }

/**
 * May a decision for this outcome be produced about this patient at this instant?
 *
 * @param {object} state    a medcore-state/1 object, optionally carrying a `context` block
 * @param {object} table    medcore/data/outcomes.json
 * @param {string} id       outcome id, e.g. "MC-3"
 * @returns {{askable:boolean, reason:string|null, detail:object}}
 */
export function askable(state, table, id) {
  const def = table && table.outcomes ? table.outcomes[id] : null;
  if (!def) return { askable: false, reason: NOT_ASKABLE.UNKNOWN_OUTCOME, detail: { id: id } };

  // 1. Is the patient in the risk set at all? An exclusion we cannot evaluate is not a pass.
  const excludedBy = [];
  const unknown = [];
  for (const name of (def.riskSetExclusions || [])) {
    const fn = EXCLUSIONS[name];
    if (!fn) { unknown.push(name); continue; }           // an exclusion nobody implemented
    const v = fn(state);
    if (v === true) excludedBy.push(name);
    else if (v === null) unknown.push(name);
  }
  if (excludedBy.length) {
    return { askable: false, reason: NOT_ASKABLE.EXCLUDED, detail: { excludedBy: excludedBy } };
  }

  // 2. Is everything that must be KNOWN actually known?
  for (const name of (def.requiredKnown || [])) {
    const fn = KNOWN[name];
    const v = fn ? fn(state) : undefined;
    if (v === null || v === undefined) unknown.push(name);
  }
  if (unknown.length) {
    return { askable: false, reason: NOT_ASKABLE.UNKNOWN_STATUS, detail: { unknown: dedupe(unknown) } };
  }

  // 3. Are the minimum inputs usable? This is checked BEFORE any model runs, deterministically.
  const params = (state && state.params) || {};
  const missing = (def.minimumInputs || []).filter((p) => !(params[p] && params[p].usable));
  const allowed = typeof def.maxUnusableInputs === "number" ? def.maxUnusableInputs : 0;
  if (missing.length > allowed) {
    return {
      askable: false, reason: NOT_ASKABLE.INSUFFICIENT_INPUTS,
      detail: { missing: missing, allowed: allowed }
    };
  }
  return { askable: true, reason: null, detail: { missing: missing } };
}

/**
 * Training-side risk set: the subset of prediction points at which this outcome may be labelled.
 * Deliberately the SAME function as the bedside uses, so the two cannot drift apart.
 *
 * @param {Array<{state:object, t0:*}>} points
 * @returns {{included:Array, excluded:Array<{t0:*, reason:string, detail:object}>}}
 */
export function riskSet(points, table, id) {
  const included = [], excluded = [];
  for (const p of (points || [])) {
    const a = askable(p && p.state, table, id);
    if (a.askable) included.push(p);
    else excluded.push({ t0: p && p.t0, reason: a.reason, detail: a.detail });
  }
  return { included: included, excluded: excluded };
}

/**
 * Rule 2: is an observation inside the blanking window before the event, and therefore the team's
 * decision rather than the patient's physiology?
 * @param {number} obsMs  observation instant
 * @param {number} eventMs  the outcome event instant
 */
export function inBlankingWindow(obsMs, eventMs, table, id) {
  const def = table && table.outcomes ? table.outcomes[id] : null;
  if (!def || typeof def.blankingMin !== "number") return false;
  if (typeof obsMs !== "number" || typeof eventMs !== "number") return false;
  const from = eventMs - def.blankingMin * 60000;
  return obsMs > from && obsMs <= eventMs;
}

/** Drops the observations rule 2 says are contaminated. Used by the trainer, never at the bedside. */
export function dropBlanked(observations, eventMs, table, id) {
  return (observations || []).filter((o) => !inBlankingWindow(o && o.atMs, eventMs, table, id));
}

function dedupe(a) { return Array.from(new Set(a)); }
