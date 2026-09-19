/* bench/medcore/run.mjs — which features are actually carrying the model, measured by removing them.
 *
 * A model's AUROC tells you it works. It does not tell you WHAT is working, and on clinical data
 * that distinction decides whether anyone should trust it: a deterioration model carried entirely
 * by "how recently was this measured" scores beautifully and means nothing (HAZ-ML-01), and one
 * carried entirely by a single lab is a lab threshold with extra steps.
 *
 * So this removes one feature group at a time and reports what the model loses. Ablation is the
 * only cheap way to answer "what is it using", and the answer belongs in a report a clinician can
 * argue with rather than in a coefficient table nobody opens.
 *
 * EVERY ABLATION IS EVALUATED ON VALIDATION, NOT TEST. Reading the test set once per feature group
 * would be reading it a dozen times, and by the end the number would describe this script's choices
 * rather than the model. The test split is read to report a final model, never to compare variants.
 *
 * USAGE:
 *   node bench/medcore/run.mjs --in backend/medcore/out/matrix.jsonl
 *   node bench/medcore/run.mjs --in <matrix> --disable deltas,slopes
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fitLogistic, scoreLogistic, tuneL2 } from "../../backend/medcore/learn.mjs";
import { fitGbm, scoreGbm } from "../../backend/medcore/gbm.mjs";
import { coreFeatureIds, MONOTONE } from "../../backend/medcore/train.mjs";
import { auroc, auprc, round4 } from "../../backend/medcore/metrics.mjs";
import { resolvePath, resolveOut } from "../../backend/medcore/paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/* The groups a clinician would recognise, not the ones the code happens to be organised by. */
export const GROUPS = {
  values: (id) => /_value$/.test(id),
  presence: (id) => /_present$/.test(id),
  recency: (id) => /_age_min$/.test(id),
  deltas: (id) => /_d\d+h$/.test(id),
  slopes: (id) => /_slope_per_h$/.test(id),
  derived: (id) => ["shock_index", "pulse_pressure", "pf_ratio", "uop_ml_kg_h"].includes(id),
  demographics: (id) => ["age_years", "sex_male", "weight_kg"].includes(id),
  interventions: (id) => /^(vaso|vent|rrt|oxygen)_active$/.test(id),
  vitals: (id) => /^(map|sbp|dbp|hr|spo2|rr|temp|gcs|uop)_/.test(id),
  labs: (id) => /^(lactate|creat|k|na|wbc|plt|hb|urea|bili|albumin|inr|crp|glucose|ph|pao2|paco2)_/.test(id)
};

const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};

function fitAndScore(train, val, ids, useGbm) {
  if (!ids.length) return { auroc: null, auprc: null, n: 0 };
  const model = useGbm
    ? fitGbm(train, { featureIds: ids, valid: val, monotone: MONOTONE, rounds: 250, depth: 3 })
    : fitLogistic(train, { featureIds: ids, l2: tuneL2(train, ids, {}).l2 });
  const sc = useGbm ? (v) => scoreGbm(model, v) : (v) => scoreLogistic(model, v);
  const pairs = val.map((r) => ({ y: r.label, p: sc(r.values) }));
  return { auroc: round4(auroc(pairs)), auprc: round4(auprc(pairs)), n: ids.length };
}

const rows = readFileSync(resolvePath(ROOT, String(arg("in", "backend/medcore/out/matrix.jsonl"))), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));
const train = rows.filter((r) => r.split === "train");
const val = rows.filter((r) => r.split === "val");
if (!train.length || !val.length) throw new Error("bench: train and val splits are both required");

const useGbm = !arg("logistic", false);
const all = coreFeatureIds();
const only = arg("disable", null);
const groups = only ? String(only).split(",").map((g) => g.trim()).filter((g) => GROUPS[g]) : Object.keys(GROUPS);

const full = fitAndScore(train, val, all, useGbm);
const results = [];
for (const g of groups) {
  const kept = all.filter((id) => !GROUPS[g](id));
  const r = fitAndScore(train, val, kept, useGbm);
  results.push({
    group: g, removed: all.length - kept.length, kept: kept.length,
    auroc: r.auroc, auprc: r.auprc,
    deltaAuroc: r.auroc === null ? null : round4(r.auroc - full.auroc),
    deltaAuprc: r.auprc === null ? null : round4(r.auprc - full.auprc)
  });
}
results.sort((a, b) => (a.deltaAuroc === null ? 1 : b.deltaAuroc === null ? -1 : a.deltaAuroc - b.deltaAuroc));

/* The frequency probe is not a feature group - it cannot be, medcore-features.js throws on it - so
 * it is reported here as the yardstick every ablation should still be beating. */
const probe = train[0] && train[0].probe
  ? fitAndScore(train.map((r) => ({ values: r.probe, label: r.label })),
      val.map((r) => ({ values: r.probe, label: r.label })),
      Object.keys(train[0].probe), false)
  : { auroc: null };

const synthetic = rows.some((r) => r.synthetic);
const lines = [];
lines.push("# Medical Core ablation: what is the model actually using");
lines.push("");
lines.push(`Generated ${new Date().toISOString()} by \`bench/medcore/run.mjs\`. Learner: ${useGbm ? "GBM" : "logistic"}.`);
lines.push(`Evaluated on VALIDATION (${val.length} points, ${val.filter((r) => r.label === 1).length} positives). The test split is not read here.`);
if (synthetic) lines.push("\n**SYNTHETIC DATA.** These are statements about the generator, not about patients.");
lines.push("");
lines.push(`Full model: AUROC ${full.auroc}, AUPRC ${full.auprc}, ${full.n} features.`);
lines.push(`Frequency-only probe: AUROC ${probe.auroc} (the yardstick; every row below should beat it).`);
lines.push("");
lines.push("| removed group | features dropped | AUROC | delta | AUPRC | delta |");
lines.push("|---|---|---|---|---|---|");
for (const r of results) {
  lines.push(`| ${r.group} | ${r.removed} | ${r.auroc} | ${r.deltaAuroc} | ${r.auprc} | ${r.deltaAuprc} |`);
}
lines.push("");
lines.push("A group whose removal costs nothing is not carrying the model. A group whose removal");
lines.push("collapses it is the model, and if that group is recency or presence rather than physiology,");
lines.push("the run fails HAZ-ML-01 whatever its headline AUROC.");
lines.push("");

const out = String(arg("out", "bench/medcore/out/report.md"));
writeFileSync(resolveOut(ROOT, out), lines.join("\n"));
console.log(`full model AUROC ${full.auroc} (${full.n} features), probe ${probe.auroc}`);
for (const r of results) console.log(`  remove ${r.group.padEnd(14)} AUROC ${r.auroc}  delta ${r.deltaAuroc}`);
console.log(`report -> ${out}`);
