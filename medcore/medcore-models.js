/* medcore/medcore-models.js — the gate between a trained artifact and a patient.
 *
 * Loading a model is the moment every earlier promise either holds or quietly stops holding, so
 * this file refuses rather than warns. Five refusals, each of which is a way a model that should
 * never have run could end up running:
 *
 *  1. SYNTHETIC DATA NEVER REACHES A CLINICIAN. An artifact whose provenance says its training data
 *     was synthetic is refused for every clinical path, with no flag, option or override that
 *     changes it. A synthetic cohort contains exactly the physiology its author wrote into it, and
 *     the textbook presentation is precisely the patient who was never going to be missed. Such an
 *     artifact loads ONLY in an explicitly named pipeline-testing mode, which no app code uses.
 *  2. A MODEL THAT FAILED ITS GATES DOES NOT LOAD. `allGatesPass` is recomputed here from the
 *     recorded gates rather than trusted as a boolean, because a boolean is one edit away from
 *     being true.
 *  3. PARITY VECTORS MUST REPRODUCE. Every artifact carries feature vectors with the probability
 *     its trainer produced; if this scorer disagrees by more than 1e-6 on any of them, the artifact
 *     is refused. That is what catches a scorer and a trainer drifting apart before a ward does.
 *  4. THE FEATURE SET MUST MATCH. An artifact trained on medcore-features@1.2.0 cannot be scored by
 *     @1.3.0: same feature names, different meanings, and nothing in the numbers would look wrong.
 *  5. AN UNAPPROVED ARTIFACT CANNOT BE PROMOTED PAST SHADOW. Clinical approval is a person's
 *     signature, and this file will not accept one from a JSON field alone.
 *
 * WHAT IT IS NOT. Not an MLOps system: drift, subgroup gating and automatic rollback already exist
 * in wardsynq/wardsynq-mlops.js and stay there. This decides one thing - may this artifact be used
 * for this purpose, right now - and says why when the answer is no.
 *
 * node --test test/medcore-models.test.mjs
 */

export const PURPOSE = {
  /** Output reaches nobody. wardsynq-mlops.js's meaning of shadow, not a softer one. */
  SHADOW: "shadow",
  /** Output is shown to a clinician. The highest purpose this file can grant, and it needs
   *  approval it cannot grant itself. */
  CLINICAL: "clinical",
  /** Testing the pipeline with no patient anywhere near it. The ONLY purpose synthetic may load
   *  for, and no app code passes it. */
  PIPELINE_TEST: "pipeline-test"
};

export const REFUSED = {
  SYNTHETIC: "SYNTHETIC_TRAINING_DATA",
  GATES_FAILED: "GATES_FAILED",
  PARITY: "PARITY_MISMATCH",
  FEATURE_SET: "FEATURE_SET_MISMATCH",
  UNAPPROVED: "NOT_CLINICALLY_APPROVED",
  MALFORMED: "MALFORMED_ARTIFACT"
};

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

const MISSING_BIN = 0;

/** Which bin a value falls in. Bin 0 is reserved for "not recorded", which a tree ROUTES on rather
 *  than imputing: missingness on a ward is not random, and filling a median pretends it is. */
function binOf(binner, id, v) {
  if (typeof v !== "number" || !isFinite(v)) return MISSING_BIN;
  const e = (binner && binner.edges && binner.edges[id]) || [];
  let lo = 0, hi = e.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (v > e[m]) lo = m + 1; else hi = m; }
  return 1 + lo;
}

/** The scorer. Byte-for-byte the arithmetic backend/medcore/learn.mjs uses; parity vectors are how
 *  that claim is checked rather than asserted. */
export function score(artifact, values) {
  const m = artifact.model;
  let z;
  if (m.kind === "gbm") {
    /* Two model kinds exist because the trainer CHOOSES between them on validation, so this must
     * implement both or an artifact silently mis-scores. The parity vectors are exactly what would
     * catch that, and are the reason this can be asserted rather than hoped. */
    z = m.base;
    for (const tree of m.trees) {
      let node = tree;
      while (node.leaf === undefined) {
        const b = binOf(m.binner, m.featureIds[node.f], values[m.featureIds[node.f]]);
        node = ((b === MISSING_BIN) ? node.missingLeft : b <= node.bin) ? node.l : node.r;
      }
      z += m.lr * node.leaf;
    }
  } else {
    z = m.intercept;
    for (let i = 0; i < m.featureIds.length; i++) {
      const id = m.featureIds[i];
      const raw = values[id];
      const v = (typeof raw === "number" && isFinite(raw)) ? raw : m.imputations[id];
      z += m.coefficients[i] * ((v - m.means[id]) / m.sds[id]);
    }
  }
  return calibrate(artifact.calibration, sigmoid(z));
}

/**
 * Applies the artifact's calibration. Two kinds exist because the trainer CHOOSES between them by
 * cross-validated log loss, so this must implement both or an artifact silently mis-scores - which
 * the parity vectors would catch, and which is exactly what they are for.
 *
 * Nothing is ever returned as exactly 0 or 1. A calibrator fitted on a finite validation set cannot
 * justify impossibility or certainty, and an isotonic map that saturates to those values is a
 * measured defect in this repository's history rather than a hypothetical one.
 */
export function calibrate(cal, p) {
  if (!cal) return p;
  const eps = typeof cal.eps === "number" ? cal.eps : 1e-4;
  const clamp = (x) => Math.min(1 - eps, Math.max(eps, x));
  if (cal.kind === "platt") {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    const z = cal.a + cal.b * Math.log(q / (1 - q));
    return clamp(round6(1 / (1 + Math.exp(-z))));
  }
  if (!Array.isArray(cal.points) || !cal.points.length) return clamp(p);
  const pts = cal.points;
  if (p <= pts[0].x) return clamp(pts[0].y);
  if (p >= pts[pts.length - 1].x) return clamp(pts[pts.length - 1].y);
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i].x) {
      const a = pts[i - 1], b = pts[i];
      const t = b.x === a.x ? 0 : (p - a.x) / (b.x - a.x);
      return clamp(round6(a.y + t * (b.y - a.y)));
    }
  }
  return clamp(p);
}

export function oodDistance(artifact, values) {
  /* Distance is defined on the standardised linear space, so a tree artifact carries the linear
   * model alongside it purely for this. An artifact with no such space returns null rather than a
   * number that would mean nothing. */
  const m = artifact.model.kind === "gbm" ? artifact.linear : artifact.model;
  if (!m || !m.featureIds || !m.means) return null;
  let s = 0;
  for (const id of m.featureIds) {
    const raw = values[id];
    const v = (typeof raw === "number" && isFinite(raw)) ? raw : m.imputations[id];
    const z = (v - m.means[id]) / m.sds[id];
    s += z * z;
  }
  return round6(Math.sqrt(s / Math.max(1, m.featureIds.length)));
}

/**
 * May this artifact be used for this purpose?
 * @param {object} artifact
 * @param {string} purpose  one of PURPOSE
 * @param {{featureSet?:string}} [env]
 * @returns {{ok:boolean, refusal:string|null, detail:object}}
 */
export function admit(artifact, purpose, env) {
  const e = env || {};
  if (!artifact || artifact.schema !== "medcore-artifact/1" || !artifact.model ||
      !Array.isArray(artifact.model.featureIds) || !Array.isArray(artifact.parityVectors)) {
    return no(REFUSED.MALFORMED, {});
  }

  // Rule 1, first, because it is the one with no override.
  const synthetic = !!(artifact.provenance && artifact.provenance.synthetic);
  if (synthetic && purpose !== PURPOSE.PIPELINE_TEST) {
    return no(REFUSED.SYNTHETIC, {
      dataset: artifact.provenance.dataset,
      why: "trained on data with no patients in it; usable only for testing the pipeline"
    });
  }

  // Rule 4 before rule 3: scoring with the wrong feature set makes parity meaningless.
  if (e.featureSet && artifact.featureSet && e.featureSet !== artifact.featureSet) {
    return no(REFUSED.FEATURE_SET, { artifact: artifact.featureSet, runtime: e.featureSet });
  }

  // Rule 2: recomputed, never trusted as a boolean.
  const failed = Object.entries(artifact.gates || {}).filter(([, g]) => !g || !g.pass).map(([k]) => k);
  if (failed.length && purpose !== PURPOSE.PIPELINE_TEST) return no(REFUSED.GATES_FAILED, { failed });

  // Rule 3.
  const bad = [];
  for (let i = 0; i < artifact.parityVectors.length; i++) {
    const v = artifact.parityVectors[i];
    const got = score(artifact, v.values);
    if (Math.abs(got - v.p) > 1e-6) bad.push({ i, expected: v.p, got: round6(got) });
    if (bad.length >= 3) break;
  }
  if (bad.length) return no(REFUSED.PARITY, { mismatches: bad, checked: artifact.parityVectors.length });

  // Rule 5.
  if (purpose === PURPOSE.CLINICAL && artifact.approvalStatus !== "approved") {
    return no(REFUSED.UNAPPROVED, { approvalStatus: artifact.approvalStatus || "unapproved" });
  }

  return { ok: true, refusal: null, detail: { purpose, parityChecked: artifact.parityVectors.length } };
}

function no(refusal, detail) { return { ok: false, refusal, detail }; }
function round6(n) { return Math.round(n * 1e6) / 1e6; }

/** Convenience: admit, then return a scorer, or throw with the reason. Never returns a scorer that
 *  was not admitted, which is the point of having it. */
export function load(artifact, purpose, env) {
  const a = admit(artifact, purpose, env);
  if (!a.ok) {
    const err = new Error("medcore-models: refused (" + a.refusal + ") " + JSON.stringify(a.detail));
    err.refusal = a.refusal; err.detail = a.detail;
    throw err;
  }
  return {
    id: artifact.id, version: artifact.version, outcome: artifact.outcome, purpose: purpose,
    score: (values) => score(artifact, values),
    ood: (values) => oodDistance(artifact, values),
    oodThreshold: artifact.ood ? artifact.ood.threshold : null
  };
}
