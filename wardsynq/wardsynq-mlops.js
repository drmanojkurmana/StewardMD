/* wardsynq/wardsynq-mlops.js — a model that was right last year.
 *
 * Clinical AI does not usually fail loudly. It degrades: the population shifts, a lab changes assay,
 * a coding practice changes, a new ward opens with a different case mix, and a model that was
 * genuinely good in validation is quietly worse every month while its dashboard still shows the
 * accuracy it was approved with. Nobody notices, because the number on the dashboard came from the
 * validation set and the validation set has not changed.
 *
 *   1. RETROSPECTIVE PERFORMANCE IS NOT EVIDENCE OF ANYTHING. A model validated on the data it was
 *      built from tells you it can fit that data. Deployment requires PROSPECTIVE performance, on
 *      patients it has never seen, gathered in shadow mode while the model affects nobody. This
 *      module refuses to mark a model deployable on retrospective numbers alone.
 *   2. SHADOW MODE MEANS THE OUTPUT REACHES NOBODY. Not "is shown with a caveat", not "goes to the
 *      research team". A model in shadow whose predictions are visible is already influencing care
 *      and its evaluation is contaminated by the behaviour it caused.
 *   3. DRIFT IS DETECTED ON THE INPUTS, NOT ONLY THE OUTPUTS. Outcome labels arrive weeks or months
 *      late, so performance degradation is discovered long after the harm. The input distribution
 *      shifts immediately and is observable the same day.
 *   4. ROLLBACK IS AUTOMATIC AND DOES NOT ASK. A model that has breached its floor is withdrawn to
 *      shadow immediately, because the alternative is a meeting, and the meeting is next week.
 *   5. A SUBGROUP FAILURE IS A FAILURE. A model at 92 percent overall and 61 percent in the smallest
 *      subgroup is not a 92 percent model; it is a model that works for the majority and fails the
 *      people who are already worst served. Aggregate metrics are computed and are explicitly not
 *      the gate.
 *
 * WHAT THIS IS NOT. It is not a statistics library. The drift tests here are simple and stated to be
 * so, and a real deployment needs a statistician rather than these functions. It computes no
 * confidence intervals and does no significance testing, and it says so rather than producing
 * precise-looking numbers that would be trusted.
 *
 * NOT MODELLED: training, feature stores, model serving, calibration curves, fairness metrics beyond
 * per-subgroup performance, and any statistical test with a p-value.
 *
 * STATUS: IMPLEMENTED and TESTED. NOT clinically validated and NOT clinically approved.
 *
 * node --test test/wardsynq-mlops.test.mjs
 */

const STAGE = Object.freeze({
  DEVELOPMENT: "development",
  SHADOW: "shadow",             // running, output reaches nobody
  CANARY: "canary",             // live for a limited population
  DEPLOYED: "deployed",
  WITHDRAWN: "withdrawn",       // pulled after a breach; never silently re-promoted
});

/** The minimum a model must show PROSPECTIVELY before it may leave shadow. UNAPPROVED defaults. */
const GATES = Object.freeze({
  minShadowPredictions: 500,
  minShadowDays: 30,
  minSubgroupSize: 30,
  maxSubgroupGap: 0.15,       // between best and worst subgroup performance
  minLabelledFraction: 0.6,   // of shadow predictions that have an outcome yet
});

class MlOpsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MlOpsError";
    this.code = code || "MLOPS_VIOLATION";
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Registers a model version.
 *
 * `retrospective` is accepted and immediately labelled as insufficient, because it is the number
 * every vendor leads with and the number that means the least.
 */
function registerModel({ id, version, task, retrospective, intendedUse, registeredBy, now } = {}) {
  if (!id || !version) throw new MlOpsError("a model needs an id and a version", "NO_VERSION");
  if (!intendedUse) {
    throw new MlOpsError("a model needs a stated intended use and population; a model without one cannot be shown to be used outside it", "NO_INTENDED_USE");
  }
  if (!registeredBy) throw new MlOpsError("registration names who did it", "NO_ACTOR");

  return {
    id, version, task: task || null, intendedUse, registeredBy,
    registeredAt: now || new Date().toISOString(),
    stage: STAGE.DEVELOPMENT,
    retrospective: retrospective || null,
    retrospectiveNote: "Retrospective performance is not evidence of clinical usefulness. It shows the model can fit the data it was built from. Only prospective shadow performance can support deployment.",
    shadow: { predictions: [], startedAt: null },
    history: [{ at: now || new Date().toISOString(), event: "registered", by: registeredBy }],
  };
}

/** Enters shadow mode. The contract is that nothing the model says reaches anybody. */
function enterShadow(model, { by, now } = {}) {
  if (!by) throw new MlOpsError("entering shadow names who did it", "NO_ACTOR");
  model.stage = STAGE.SHADOW;
  model.shadow.startedAt = now || new Date().toISOString();
  model.history.push({ at: model.shadow.startedAt, event: "entered-shadow", by });
  return model;
}

/**
 * Records one shadow prediction.
 *
 * `visibleToClinician` must be false. A model in shadow whose output is visible is already
 * influencing care, and its evaluation then measures the behaviour it caused rather than the model.
 */
function recordShadowPrediction(model, { predicted, actual, at, subgroup, visibleToClinician = false, patientId } = {}) {
  if (model.stage !== STAGE.SHADOW && model.stage !== STAGE.CANARY && model.stage !== STAGE.DEPLOYED) {
    throw new MlOpsError(`a model in ${model.stage} is not running`, "NOT_RUNNING");
  }
  if (visibleToClinician && model.stage === STAGE.SHADOW) {
    throw new MlOpsError(
      "a shadow prediction cannot be visible to a clinician. Shadow means the output reaches nobody: if it is shown, the model is influencing care and its evaluation measures the behaviour it caused rather than the model",
      "SHADOW_NOT_BLIND");
  }
  model.shadow.predictions.push({
    predicted, actual: actual === undefined ? null : actual,
    at: at || new Date().toISOString(), subgroup: subgroup || null, patientId: patientId || null,
  });
  return model;
}

/** Attaches an outcome that arrived later, which is how clinical labels actually arrive. */
function attachOutcome(model, { patientId, actual }) {
  const p = model.shadow.predictions.find((x) => x.patientId === patientId && x.actual === null);
  if (!p) throw new MlOpsError(`no unlabelled prediction for ${patientId}`, "NO_PREDICTION");
  p.actual = actual;
  return p;
}

/** Performance overall and per subgroup. Aggregate is computed and is explicitly not the gate. */
function evaluate(model, { minSubgroupSize = GATES.minSubgroupSize } = {}) {
  const labelled = model.shadow.predictions.filter((p) => p.actual !== null);
  const correct = (p) => p.predicted === p.actual;

  const overall = labelled.length ? labelled.filter(correct).length / labelled.length : null;

  const groups = new Map();
  for (const p of labelled) {
    const key = p.subgroup || "unspecified";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const subgroups = [...groups.entries()].map(([name, ps]) => ({
    subgroup: name, n: ps.length,
    accuracy: ps.filter(correct).length / ps.length,
    // Below this many cases the number is noise, and is reported as counts instead.
    reportable: ps.length >= minSubgroupSize,
  }));

  const reportable = subgroups.filter((s) => s.reportable);
  const best = reportable.length ? Math.max(...reportable.map((s) => s.accuracy)) : null;
  const worst = reportable.length ? Math.min(...reportable.map((s) => s.accuracy)) : null;

  return {
    total: model.shadow.predictions.length,
    labelled: labelled.length,
    labelledFraction: model.shadow.predictions.length ? labelled.length / model.shadow.predictions.length : 0,
    overallAccuracy: overall,
    subgroups,
    bestSubgroup: best, worstSubgroup: worst,
    subgroupGap: best === null || worst === null ? null : best - worst,
    // The sentence that stops an aggregate being read as the answer.
    caution: worst !== null && best !== null && best - worst > GATES.maxSubgroupGap
      ? `Overall accuracy of ${overall === null ? "n/a" : Math.round(overall * 100)} percent conceals a ${Math.round((best - worst) * 100)} point gap between subgroups. This is not an ${overall === null ? "" : Math.round(overall * 100)} percent model; it is a model that works for the majority and fails the people already worst served.`
      : null,
    note: "No confidence intervals and no significance testing are computed here. These are counts and proportions, and a real deployment decision needs a statistician rather than this function.",
  };
}

/**
 * Whether a model may leave shadow. Every gate must pass, and the reasons are returned in full.
 */
function readyForDeployment(model, { now, gates = GATES } = {}) {
  const at = now || new Date().toISOString();
  const blockers = [];
  const ev = evaluate(model, { minSubgroupSize: gates.minSubgroupSize });

  if (model.stage !== STAGE.SHADOW) blockers.push(`the model is in ${model.stage}, not shadow`);

  const days = model.shadow.startedAt ? (Date.parse(at) - Date.parse(model.shadow.startedAt)) / 86_400_000 : 0;
  if (days < gates.minShadowDays) blockers.push(`${Math.round(days)} days in shadow, below the minimum of ${gates.minShadowDays}`);
  if (ev.total < gates.minShadowPredictions) blockers.push(`${ev.total} shadow predictions, below the minimum of ${gates.minShadowPredictions}`);
  if (ev.labelledFraction < gates.minLabelledFraction) {
    blockers.push(`only ${Math.round(ev.labelledFraction * 100)} percent of predictions have an outcome yet; the unlabelled ones are not evidence and are disproportionately the recent, sicker cases`);
  }
  if (ev.subgroupGap !== null && ev.subgroupGap > gates.maxSubgroupGap) {
    blockers.push(`a ${Math.round(ev.subgroupGap * 100)} point gap between the best and worst subgroup, above the maximum of ${Math.round(gates.maxSubgroupGap * 100)}`);
  }
  if (!ev.subgroups.some((s) => s.reportable)) {
    blockers.push("no subgroup has enough cases to be evaluated, so subgroup performance is unknown rather than acceptable");
  }

  return {
    ready: blockers.length === 0,
    blockers,
    evaluation: ev,
    // Even a pass is not an approval.
    note: "Passing these gates means the prospective evidence exists. It is not clinical approval, which is a judgement made by a named clinician who has read the evidence.",
  };
}

/* ------------------------------------------------------------------ drift */

/**
 * Input drift between a reference window and a current one.
 *
 * Deliberately simple, and honest about it. Input drift is checked because outcome labels arrive
 * weeks or months late: performance degradation is discovered long after the harm, while the input
 * distribution shifts the same day and is observable immediately.
 */
function inputDrift(reference, current, { feature, threshold = 0.2 } = {}) {
  const ref = reference.map((r) => r[feature]).filter((v) => typeof v === "number");
  const cur = current.map((r) => r[feature]).filter((v) => typeof v === "number");
  if (ref.length < 10 || cur.length < 10) {
    return { feature, comparable: false, reason: "fewer than 10 numeric values in one window; too few to compare" };
  }

  const refMean = mean(ref);
  const curMean = mean(cur);
  const refSd = Math.sqrt(mean(ref.map((v) => (v - refMean) ** 2)));
  // Standardised mean difference. A crude and well-understood measure, chosen over something that
  // looks more sophisticated and would be trusted further than it deserves.
  const smd = refSd === 0 ? (curMean === refMean ? 0 : Infinity) : Math.abs(curMean - refMean) / refSd;

  return {
    feature, comparable: true,
    referenceMean: refMean, currentMean: curMean, referenceSd: refSd,
    standardisedDifference: Number.isFinite(smd) ? Math.round(smd * 100) / 100 : smd,
    drifted: smd > threshold,
    threshold,
    reading: smd > threshold
      ? `${feature} has shifted by ${Number.isFinite(smd) ? smd.toFixed(2) : "an unmeasurable amount"} standard deviations since the reference window. The model was validated on the reference population and is now seeing a different one.`
      : `${feature} is stable against the reference window.`,
    note: "A standardised mean difference, not a statistical test. It has no p-value and none is implied.",
  };
}

/**
 * Watches a live model and withdraws it automatically.
 *
 * The automatic part is the point. A breach that raises a ticket instead of withdrawing the model
 * leaves it running until somebody triages the ticket, and the meeting is next week.
 */
class ModelMonitor {
  constructor({ now, floor, onWithdraw } = {}) {
    this.now = now || (() => new Date().toISOString());
    this.floor = floor || { accuracy: 0.75, subgroupAccuracy: 0.65 };
    this.onWithdraw = onWithdraw || null;
    this.events = [];
  }

  /** Checks a running model and withdraws it to shadow on a breach. Returns what it did. */
  check(model, { gates = GATES } = {}) {
    const at = this.now();
    if (model.stage !== STAGE.DEPLOYED && model.stage !== STAGE.CANARY) {
      return { checked: false, reason: `model is in ${model.stage}` };
    }

    const ev = evaluate(model, { minSubgroupSize: gates.minSubgroupSize });
    const breaches = [];
    if (ev.overallAccuracy !== null && ev.overallAccuracy < this.floor.accuracy) {
      breaches.push(`overall accuracy ${Math.round(ev.overallAccuracy * 100)} percent is below the floor of ${Math.round(this.floor.accuracy * 100)}`);
    }
    for (const s of ev.subgroups) {
      if (s.reportable && s.accuracy < this.floor.subgroupAccuracy) {
        breaches.push(`subgroup "${s.subgroup}" at ${Math.round(s.accuracy * 100)} percent is below the subgroup floor of ${Math.round(this.floor.subgroupAccuracy * 100)}`);
      }
    }

    if (!breaches.length) {
      this.events.push({ at, model: model.id, version: model.version, action: "checked", ok: true });
      return { checked: true, withdrawn: false, evaluation: ev };
    }

    // Withdraw first, notify second. The other order leaves it running while a message is delivered.
    const previousStage = model.stage;
    model.stage = STAGE.WITHDRAWN;
    model.withdrawnAt = at;
    model.withdrawalReasons = breaches;
    model.history.push({ at, event: "withdrawn-automatically", by: "wardsynq-mlops-monitor", detail: breaches.join("; ") });
    this.events.push({ at, model: model.id, version: model.version, action: "withdrawn", breaches, previousStage });
    if (this.onWithdraw) this.onWithdraw({ model, breaches, at });

    return {
      checked: true, withdrawn: true, breaches, evaluation: ev,
      note: "Withdrawn automatically and without asking. A breach that raises a ticket leaves the model running until somebody triages it, and the meeting is next week.",
    };
  }
}

/** A withdrawn model is never silently re-promoted. It goes back through shadow. */
function reinstate(model, { by, reason, now } = {}) {
  if (model.stage !== STAGE.WITHDRAWN) throw new MlOpsError("only a withdrawn model is reinstated", "NOT_WITHDRAWN");
  if (!by || !reason) throw new MlOpsError("reinstating names who did it and why", "NO_REASON");
  model.stage = STAGE.SHADOW;
  model.shadow = { predictions: [], startedAt: now || new Date().toISOString() };
  model.history.push({ at: model.shadow.startedAt, event: "reinstated-to-shadow", by, detail: reason });
  return {
    model,
    note: "Reinstated to SHADOW, not to deployment. The evidence that supported the original deployment was gathered on a population that has since been shown to have changed, so it has to be gathered again.",
  };
}

export {
  STAGE, GATES, MlOpsError,
  registerModel, enterShadow, recordShadowPrediction, attachOutcome,
  evaluate, readyForDeployment, inputDrift, ModelMonitor, reinstate,
};
