/* backend/medcore/run.mjs — generate, featurize, train, export, and write the dataset card.
 *
 * One command so a run is reproducible and a card always exists beside the numbers. A report
 * without a card is a number whose population nobody can look up.
 *
 * USAGE: node backend/medcore/run.mjs [--n 400] [--seed 20260919] [--frequency-bias]
 *        node backend/medcore/run.mjs --adapter mimic-iv --in <extract.jsonl>   (when one exists)
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./synth/generate.mjs";
import { featurizeEncounter, split, loadPacks } from "./featurize.mjs";
import { run } from "./train.mjs";
import { buildArtifact } from "./export-artifact.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};

const outcome = String(arg("outcome", "MC-3"));
const outDir = String(arg("out-dir", "backend/medcore/out"));
const inPath = arg("in", null);
const packs = loadPacks();

let encounters, opts;
if (inPath) {
  encounters = readFileSync(join(ROOT, String(inPath)), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  opts = { dataset: encounters[0].provenance.dataset, source: String(inPath) };
} else {
  const g = generate({
    n: Number(arg("n", 400)), seed: Number(arg("seed", 20260919)),
    frequencyBias: !!arg("frequency-bias", false),
    prevalentRate: Number(arg("prevalent-rate", 0.08)),
    rescueRate: Number(arg("rescue-rate", 0.25))
  });
  encounters = g.encounters; opts = g.opts;
}

const byEnc = new Map(); const excluded = [];
for (const e of encounters) {
  const r = featurizeEncounter(e, packs, { outcome, gridHours: Number(arg("grid", 4)) });
  byEnc.set(e.encounterId, r.rows); excluded.push(...r.excluded);
}
const rows = split(encounters, byEnc, {});
const res = run({ rows, outcome });
const artifact = buildArtifact(res, rows, { dataset: opts.dataset });

mkdirSync(join(ROOT, outDir), { recursive: true });
mkdirSync(join(ROOT, "backend/medcore/cards"), { recursive: true });
writeFileSync(join(ROOT, outDir, `artifact-${outcome.toLowerCase()}.json`), JSON.stringify(artifact, null, 2));
writeFileSync(join(ROOT, outDir, `report-${outcome.toLowerCase()}.json`), JSON.stringify(res, null, 2));

/* The dataset card. Deliberately states what is NOT in the data as prominently as what is. */
const reasons = {};
for (const e of excluded) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
const posRate = (s) => {
  const a = rows.filter((r) => r.split === s);
  return a.length ? (100 * a.filter((r) => r.label === 1).length / a.length).toFixed(2) + "%" : "n/a";
};
const truth = encounters[0]._truth ? {
  prevalent: encounters.filter((e) => e._truth.prevalent).length,
  rescued: encounters.filter((e) => e._truth.rescued).length
} : null;

const card = `# Dataset card: ${opts.dataset} (${outcome})

Generated ${new Date().toISOString()} by \`backend/medcore/run.mjs\`.

${res.synthetic ? `## THIS DATA IS SYNTHETIC

There are no patients in it. It contains exactly the physiology \`backend/medcore/synth/generate.mjs\`
was written to contain, so every number below is a statement about the PIPELINE, never about people.
\`provenance.synthetic\` is true on every row and \`medcore/medcore-models.js\` refuses any artifact
built from it for every clinical purpose, with no override.

Not modelled: comorbidity, drug effects, diurnal variation, seasonality, any real missingness
mechanism, any site effect, and the atypical presentation that is the entire reason this project
exists.
` : "## Provenance\n\nReal extract. Check the DUA and the de-identification attestation before use.\n"}
## Cohort

| | |
|---|---|
| encounters | ${encounters.length} |
| prediction points | ${rows.length} (grid ${arg("grid", 4)} h) |
| train / val / test | ${rows.filter((r) => r.split === "train").length} / ${rows.filter((r) => r.split === "val").length} / ${rows.filter((r) => r.split === "test").length} |
| event rate | train ${posRate("train")}, val ${posRate("val")}, test ${posRate("test")} |
| excluded from the risk set | ${excluded.length} ${JSON.stringify(reasons)} |
${truth ? `| injected prevalent cases | ${truth.prevalent} (must be excluded, HAZ-ML-02) |
| injected rescued cases | ${truth.rescued} (the treatment paradox, labelled negative by construction) |
| frequency bias | ${opts.frequencyBias ? "ON" : "off"} |` : ""}

## Splitting

By encounter first, then time: the earliest 60% of admissions train, the next 20% validate, the
latest 20% test, with the boundary encounter of each block dropped as a washout. No encounter
appears on both sides of a split.

## Leakage controls applied

- The state at each point is built with \`asOf = t0\` through the shipped \`medcore-state.js\`;
  nothing recorded later is visible, and the builder refuses it independently.
- Prevalent cases are excluded from the risk set, never labelled negative (\`medcore-outcomes.js\`).
- The declared blanking window before the event is dropped from the features.
- No observation count, interval or charting-frequency feature can enter the matrix
  (\`medcore-features.js\` throws). The shortcut is computed separately as a probe and trained on
  alone, as the adversarial check.

## Result

Gates: ${Object.entries(res.gates).map(([k, g]) => `${k} ${g.pass ? "PASS" : "FAIL"}`).join(", ")}.
${res.allPass ? "All gates pass." : "**Gated. This model does not ship.**"}

Model AUROC ${res.model.auroc}, AUPRC ${res.model.auprc}, ECE ${res.model.ece},
calibration slope ${res.model.calibration.slope}.
Baseline (threshold, NOT NEWS2) AUROC ${res.baseline.auroc}.
Frequency-only probe AUROC ${res.probe.auroc}.
Events per variable ${res.counts.eventsPerVariable}.
`;
/* The card name carries the cohort, because two runs are two populations. An earlier version keyed
 * it on dataset and outcome alone, and a second run with a different n silently overwrote the
 * first - which is precisely the "a number whose population nobody can look up" failure the card
 * exists to prevent. Found by doing it. */
const cardName = inPath
  ? `${opts.dataset}-${outcome.toLowerCase()}.md`
  : `${opts.dataset}-${outcome.toLowerCase()}-n${opts.n}-seed${opts.seed}${opts.frequencyBias ? "-freqbias" : ""}.md`;
writeFileSync(join(ROOT, "backend/medcore/cards", cardName), card);

console.log(`card     -> backend/medcore/cards/${cardName}`);
console.log(`artifact -> ${outDir}/artifact-${outcome.toLowerCase()}.json`);
console.log(`gates    ${res.allPass ? "ALL PASS" : "FAILED: " + Object.entries(res.gates).filter(([, g]) => !g.pass).map(([k]) => k).join(", ")}`);
