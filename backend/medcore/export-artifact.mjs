/* backend/medcore/export-artifact.mjs — the only thing the app is ever given.
 *
 * An artifact is coefficients, a monotone calibration lookup, an OOD threshold and the provenance
 * that says where it came from. It is plain JSON, read by medcore/medcore-models.js, and it carries
 * three things that are not the model:
 *
 *  1. `provenance.synthetic`, propagated from the extract. medcore-models.js refuses such an
 *     artifact for any clinical path. This is the whole reason the flag exists at the top of the
 *     pipeline: a model trained on data with no patients in it must not be able to reach a
 *     clinician by anybody forgetting where it came from.
 *  2. `gates`, the Phase 4 result verbatim, INCLUDING the failures. An artifact that did not pass
 *     is still exported, because "we trained it and it failed the calibration gate" is a result the
 *     next person needs; it simply cannot be loaded for use.
 *  3. `parityVectors`, 100 feature vectors with the probability this trainer produced. The loader
 *     recomputes them and refuses the artifact if any disagrees by more than 1e-6. Today trainer and
 *     scorer are the same JS, so this is a regression test; when a Python GBM replaces the baseline
 *     it becomes the thing that catches train/serve skew before a ward does.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreLogistic, applyCalibration, oodDistance } from "./learn.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function buildArtifact(res, rows, meta) {
  const { model, calibration, ood } = res.artifact;
  const sample = rows.filter((r) => r.split === "val").slice(0, 100);
  const parityVectors = sample.map((r) => ({
    values: pick(r.values, model.featureIds),
    p: applyCalibration(calibration, scoreLogistic(model, r.values)),
    ood: oodDistance(model, r.values)
  }));

  return {
    schema: "medcore-artifact/1",
    id: (meta && meta.id) || (res.outcome.toLowerCase() + "-logistic"),
    version: (meta && meta.version) || "0.1.0",
    outcome: res.outcome,
    featureSet: rows[0].featureSet,
    createdAt: (meta && meta.createdAt) || new Date().toISOString(),
    model, calibration, ood,
    gates: res.gates,
    allGatesPass: res.allPass,
    metrics: {
      auroc: res.model.auroc, auprc: res.model.auprc, brier: res.model.brier,
      ece: res.model.ece, calibrationSlope: res.model.calibration.slope,
      baselineAuroc: res.baseline.auroc, frequencyProbeAuroc: res.probe.auroc
    },
    provenance: {
      dataset: (meta && meta.dataset) || "unknown",
      synthetic: !!res.synthetic,
      trainer: "backend/medcore/train.mjs@1.0.0",
      counts: res.counts
    },
    approvalStatus: "unapproved",
    parityVectors
  };
}

function pick(o, ids) { const out = {}; for (const id of ids) out[id] = o[id] === undefined ? null : o[id]; return out; }

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const { run } = await import("./train.mjs");
  const rows = readFileSync(join(ROOT, String(arg("in", "backend/medcore/out/matrix.jsonl"))), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const res = run({ rows, outcome: String(arg("outcome", "MC-3")) });
  const art = buildArtifact(res, rows, { dataset: String(arg("dataset", "medcore-synth-v1")) });
  const out = String(arg("out", "backend/medcore/out/artifact-mc3.json"));
  mkdirSync(dirname(join(ROOT, out)), { recursive: true });
  writeFileSync(join(ROOT, out), JSON.stringify(art, null, 2));
  console.log(`artifact -> ${out}`);
  console.log(`  ${art.id}@${art.version}  features ${art.model.featureIds.length}  parity vectors ${art.parityVectors.length}`);
  console.log(`  gates ${art.allGatesPass ? "ALL PASS" : "FAILED: " + Object.entries(art.gates).filter(([, g]) => !g.pass).map(([k]) => k).join(", ")}`);
  console.log(`  synthetic ${art.provenance.synthetic} -> ${art.provenance.synthetic ? "REFUSED for any clinical path by medcore-models.js" : "eligible for shadow once the gates pass"}`);
}
