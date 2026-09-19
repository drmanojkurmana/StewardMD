/* medcore/medcore-decide.js — the one entry point, and the typed decision it returns.
 *
 * Everything below it has been built so that this file can be short. It composes what already
 * exists and adds no judgement of its own:
 *
 *   state (medcore-state)  ->  askable? (medcore-outcomes)  ->  features (medcore-features)
 *     ->  admitted artifact? (medcore-models)  ->  probability  ->  verdict (medcore-calibration)
 *     ->  a typed decision
 *
 * FOUR PROPERTIES.
 *
 *  1. AN ARTIFACT THAT WAS NOT ADMITTED IS NOT USED. medcore-models.js decides admission - synthetic
 *     provenance, failed gates, parity mismatch, wrong feature set, missing approval - and a
 *     decision made with an unadmitted artifact is not a decision, it is a leak. Today every
 *     available artifact is synthetic, so the honest output of this whole chain is ABSTAIN, and
 *     that is what the test asserts rather than a happy path that does not exist yet.
 *  2. A MISSING DECISION IS NEVER AN IMPLIED NEGATIVE. Every enabled outcome appears in the output
 *     with a status, or it does not appear at all and the caller is told which were skipped. There
 *     is no arrangement in which silence means low risk.
 *  3. IT IS PURE AND IT TAKES `asOf` FROM THE CALLER. No clock, no network, no DOM. The leakage
 *     control in medcore-state.js is not bypassed by a convenience default here.
 *  4. IT PRODUCES NOTHING ELSE. No alert, no prompt, no notification, no write. The existing
 *     recognition and orchestrator layers decide whether a human is asked anything, and they are
 *     not called from here.
 *
 * node --test test/medcore-decide.test.mjs
 */

import { askable } from "./medcore-outcomes.js";
import { features as buildFeatures, FEATURE_SET } from "./medcore-features.js";
import { admit, score as scoreArtifact, oodDistance, PURPOSE } from "./medcore-models.js";
import { verdict, STATUS } from "./medcore-calibration.js";
import { changes } from "./medcore-changes.js";
import { missing as missingInfo } from "./medcore-missing.js";

export const SCHEMA = "medcore-decision/1";

/** The decision types. ORDINAL, CHOICE and REGRESSION are reserved and unused in V1: declaring
 *  them here is cheaper than a later schema change, and using one before an outcome needs it is
 *  how a contract acquires a shape nobody asked for. */
export const TYPE = { BOOLEAN: "BOOLEAN", ORDINAL: "ORDINAL", CHOICE: "CHOICE", REGRESSION: "REGRESSION" };

/**
 * @param {object} state      a medcore-state/1 object, optionally carrying `context`
 * @param {object} deps
 *   outcomes    medcore/data/outcomes.json
 *   artifacts   { [outcomeId]: artifact }   may be empty; an absent one abstains
 *   purpose     medcore-models PURPOSE, default SHADOW
 *   bands       medcore/data/change-bands.json, optional, for the `changed` block
 *   needs       string[] for missingInformation, optional
 *   scores      ICU_AUTOSCORES output, optional
 * @returns {object} medcore-decision/1
 */
export function decide(state, deps) {
  const d = deps || {};
  const outcomes = (d.outcomes && d.outcomes.outcomes) || {};
  const artifacts = d.artifacts || {};
  const purpose = d.purpose || PURPOSE.SHADOW;
  const enabled = Array.isArray(d.enabled) ? d.enabled : Object.keys(outcomes);

  const decisions = [];
  const skipped = [];
  const usedArtifacts = [];

  // Features are built ONCE for all outcomes: they are a property of the patient, not the question.
  let featureValues = null, featureSet = FEATURE_SET;
  try {
    const f = buildFeatures(state);
    featureValues = f.values; featureSet = f.featureSet;
  } catch (e) {
    // A feature builder that throws is a banned-shortcut violation or a malformed state. Either way
    // nothing may be decided from it, and saying so beats scoring on a half-built vector.
    return frame(state, [], enabled.map((id) => ({ id, reason: "FEATURES_UNAVAILABLE", detail: String(e && e.message || e) })), d, []);
  }

  for (const id of enabled) {
    const def = outcomes[id];
    if (!def) { skipped.push({ id, reason: "UNKNOWN_OUTCOME" }); continue; }

    const ask = askable(state, d.outcomes, id);
    const artifact = artifacts[id] || null;

    // Property 1: admission is decided by medcore-models.js and its refusal travels into the output.
    let admitted = null, refusal = null;
    if (artifact) {
      const a = admit(artifact, purpose, { featureSet });
      if (a.ok) admitted = artifact; else refusal = { refusal: a.refusal, detail: a.detail };
    }

    let probability = null, distance = null;
    if (ask.askable && admitted) {
      probability = round4(scoreArtifact(admitted, featureValues));
      distance = oodDistance(admitted, featureValues);
    }

    const v = verdict({ ask, artifact: admitted, probability, distance });
    const decision = {
      id, type: TYPE.BOOLEAN, status: v.status,
      horizonHours: def.horizonHours,
      model: admitted ? admitted.id + "@" + admitted.version : null,
      calibration: admitted && admitted.calibration ? admitted.calibration.kind : null
    };
    if (v.status === STATUS.OK) {
      decision.probability = probability;
      decision.confidence = v.confidence;
    } else if (v.status === STATUS.INSUFFICIENT_INFORMATION) {
      decision.missing = (v.missing || []).map((p) => ({
        param: p,
        reason: state.params && state.params[p] ? (state.params[p].refusal || "UNUSABLE") : "NEVER_RECORDED",
        ageMin: state.params && state.params[p] ? state.params[p].ageMin : null
      }));
    } else {
      decision.reason = v.reason;
      if (v.detail) decision.detail = v.detail;
      if (refusal) decision.artifactRefusal = refusal;
      if (v.ood && v.ood.ood) { decision.distance = v.ood.distance; decision.threshold = v.ood.threshold; }
    }
    if (admitted) usedArtifacts.push(admitted.id + "@" + admitted.version);
    decisions.push(decision);
  }

  return frame(state, decisions, skipped, d, usedArtifacts);
}

function frame(state, decisions, skipped, d, usedArtifacts) {
  const out = {
    schema: SCHEMA,
    asOf: state && state.asOf ? state.asOf : null,       // property 3: the caller's instant, always
    featureSet: FEATURE_SET,
    decisions,
    // Property 2: what was not decided is named, never implied.
    skipped,
    provenance: {
      state: (state && state.provenance && state.provenance.builtBy) || null,
      artifacts: usedArtifacts,
      purpose: d.purpose || PURPOSE.SHADOW
    }
  };
  if (d.bands) { try { out.changed = changes(state, d.bands); } catch (e) { out.changed = []; } }
  if (d.needs || d.scores) {
    try { out.missingInformation = missingInfo(state, { needs: d.needs, scores: d.scores }); }
    catch (e) { out.missingInformation = []; }
  }
  return out;
}

function round4(n) { return n === null || n === undefined ? null : Math.round(n * 10000) / 10000; }
