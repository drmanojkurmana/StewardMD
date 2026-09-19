/* backend/medcore/featurize.mjs — replay, and the reason training reads the app's own code.
 *
 * THE POINT OF THIS FILE IS WHAT IT DOES NOT CONTAIN: a feature. Not one. It builds the training
 * matrix by calling medcore/medcore-state.js and medcore/medcore-features.js with `asOf = t0`, the
 * exact modules the phone runs, so train/serve skew is not a bug class that exists here. A feature
 * changed in one place changes in both, or it does not change at all.
 *
 * THREE THINGS IT ENFORCES AT EVERY PREDICTION POINT.
 *
 *  1. THE STATE IS BUILT AS OF t0 AND NOTHING LATER IS PASSED IN. Not filtered afterwards: the
 *     observations handed to the builder are the ones recorded by t0, and the builder refuses
 *     anything later anyway. Two independent guards, because this is the one that decides whether
 *     the whole exercise means anything.
 *  2. THE RISK SET IS medcore-outcomes.js, NOT A LOCAL COPY. A prevalent case is EXCLUDED, not
 *     labelled 0 (HAZ-ML-02), and an intervention status nobody charted makes the point unusable
 *     rather than negative. The exclusion counts are reported, because a risk set that quietly
 *     drops a third of the cohort is a result in itself.
 *  3. THE BLANKING WINDOW IS APPLIED BEFORE THE STATE IS BUILT. For a positive point, observations
 *     inside the declared hour before the event are removed: that hour holds the team preparing to
 *     treat, not the patient deteriorating.
 *
 * SPLITTING is by ENCOUNTER first and time second, with a washout, so no encounter can appear on
 * both sides of a split and the test period is strictly later than the training period.
 *
 * USAGE: node backend/medcore/featurize.mjs --in backend/medcore/out/synth.jsonl \
 *          --outcome MC-3 --grid 4 --out backend/medcore/out/matrix.jsonl
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildState } from "../../medcore/medcore-state.js";
import { features } from "../../medcore/medcore-features.js";
import { askable, dropBlanked, NOT_ASKABLE } from "../../medcore/medcore-outcomes.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const HOUR = 3600000;

export function loadPacks() {
  const j = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
  return {
    unitTable: j("medcore/data/units.json"),
    freshness: j("medcore/data/freshness.json"),
    outcomes: j("medcore/data/outcomes.json")
  };
}

/** Interventions as they stood at t0. The extract charted the full list, so "not started yet" is a
 *  real false rather than an unknown - which is exactly the distinction medcore-state.js rule 4
 *  cares about, and why the adapter must not omit a kind it simply did not observe. */
function interventionsAt(enc, t0) {
  const out = {};
  for (const kind of ["vasopressor", "ventilation", "rrt", "oxygen"]) {
    const rec = (enc.interventions || []).filter((i) => i.kind === kind)
      .filter((i) => Date.parse(i.startedAt) <= t0)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
    const charted = (enc.context || {})[kind] !== undefined || (enc.interventions || []).some((i) => i.kind === kind);
    if (rec) out[kind] = { active: true, startedAt: rec.startedAt, agents: rec.agents || [] };
    else if (charted || kind === "vasopressor") out[kind] = { active: false };
    else out[kind] = { active: null };
  }
  return out;
}

export function featurizeEncounter(enc, packs, opt) {
  const deps = { unitTable: packs.unitTable, freshness: packs.freshness };
  const id = opt.outcome;
  const def = packs.outcomes.outcomes[id];
  if (!def) throw new Error("featurize: unknown outcome " + id);
  const horizonMs = def.horizonHours * HOUR;

  const admitted = Date.parse(enc.admittedAt);
  const discharged = Date.parse(enc.dischargedAt);
  const event = (enc.events || []).find((e) => e.id === id);
  const eventMs = event ? Date.parse(event.at) : null;

  const obs = (enc.observations || []).map((o) => Object.assign({ atMs: Date.parse(o.at) }, o));
  const rows = [], excluded = [];

  for (let t0 = admitted + opt.gridHours * HOUR; t0 <= discharged; t0 += opt.gridHours * HOUR) {
    // A point after the event is not a prediction about it.
    if (eventMs !== null && t0 >= eventMs) break;

    // Guard 1: hand the builder only what was recorded by t0.
    let visible = obs.filter((o) => o.atMs <= t0);
    // Guard 3: for a point whose horizon contains the event, drop the preparation hour.
    if (eventMs !== null) visible = dropBlanked(visible, eventMs, packs.outcomes, id);

    const state = buildState(deps, {
      asOf: t0,
      subjectKey: enc.subjectKey,
      patient: enc.demographics,
      observations: visible,
      interventions: interventionsAt(enc, t0),
      provenance: { sources: ["extract"], unitNormalised: true, dataset: enc.provenance.dataset }
    });
    const withContext = Object.assign({}, state, { context: enc.context || {} });

    // Guard 2: the risk set is the shipped rule, not a copy of it.
    const ask = askable(withContext, packs.outcomes, id);
    if (!ask.askable) {
      excluded.push({ encounterId: enc.encounterId, t0: t0, reason: ask.reason, detail: ask.detail });
      continue;
    }

    const f = features(state);
    /* THE ADVERSARIAL PROBE, and the reason it lives here rather than in medcore-features.js:
     * features() would throw on these names (assertNoBannedFeatures), which is the control working.
     * To TEST that control empirically you need the shortcut computed somewhere, so it is computed
     * here, kept in its own `probe` block, and never merged into `values`. train.mjs refuses to
     * read it; evaluate.mjs trains a model on it ALONE and reports how well the shortcut does. */
    const last24 = visible.filter((o) => o.atMs > t0 - 24 * HOUR);
    const times = Array.from(new Set(last24.map((o) => o.atMs))).sort((a, b) => a - b);
    let meanGap = null;
    if (times.length > 1) {
      let g = 0;
      for (let i = 1; i < times.length; i++) g += times[i] - times[i - 1];
      meanGap = Math.round(g / (times.length - 1) / 60000);
    }
    const probe = {
      obs_count_24h: last24.length,
      distinct_rounds_24h: times.length,
      mean_interval_min: meanGap,
      minutes_since_last: times.length ? Math.round((t0 - times[times.length - 1]) / 60000) : null
    };
    const label = (eventMs !== null && eventMs > t0 && eventMs <= t0 + horizonMs) ? 1 : 0;
    rows.push({
      encounterId: enc.encounterId, subjectKey: enc.subjectKey, t0: new Date(t0).toISOString(),
      outcome: id, label: label,
      featureSet: f.featureSet, values: f.values, probe: probe,
      strata: {
        ageBand: state.demographics.ageYears === null ? "unknown"
          : state.demographics.ageYears < 45 ? "<45" : state.demographics.ageYears < 65 ? "45-64"
            : state.demographics.ageYears < 80 ? "65-79" : "80+",
        sex: state.demographics.sex,
        completeness: completenessQuartile(f.values),
        // Both target populations are gated subgroups, not a caveat (adapters/README.md).
        site: enc.site || "unknown",
        region: enc.region || "unknown"
      },
      synthetic: !!enc.provenance.synthetic
    });
  }
  return { rows, excluded };
}

function completenessQuartile(v) {
  const present = Object.keys(v).filter((k) => k.endsWith("_present"));
  if (!present.length) return "unknown";
  const frac = present.filter((k) => v[k] === 1).length / present.length;
  return frac < 0.25 ? "q1" : frac < 0.5 ? "q2" : frac < 0.75 ? "q3" : "q4";
}

/** Encounter-level grouping first, then time. A washout keeps the boundary clean. */
export function split(encounters, rowsByEnc, opt) {
  const order = encounters.slice().sort((a, b) => Date.parse(a.admittedAt) - Date.parse(b.admittedAt));
  const n = order.length;
  const trainEnd = Math.floor(n * 0.6), valEnd = Math.floor(n * 0.8);
  const assign = new Map();
  order.forEach((e, i) => {
    assign.set(e.encounterId, i < trainEnd ? "train" : i < valEnd ? "val" : "test");
  });
  // Washout: the last encounter of each block is dropped so an admission spanning the boundary
  // cannot contribute to two splits.
  const boundary = new Set([order[trainEnd - 1], order[valEnd - 1]].filter(Boolean).map((e) => e.encounterId));
  const out = [];
  for (const [encId, rows] of rowsByEnc) {
    if (boundary.has(encId)) continue;
    const s = assign.get(encId);
    for (const r of rows) out.push(Object.assign({ split: s }, r));
  }
  return out;
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const inPath = String(arg("in", "backend/medcore/out/synth.jsonl"));
  const outPath = String(arg("out", "backend/medcore/out/matrix.jsonl"));
  const outcome = String(arg("outcome", "MC-3"));
  const gridHours = Number(arg("grid", 4));
  const packs = loadPacks();
  const encounters = readFileSync(join(ROOT, inPath), "utf8").trim().split("\n").map((l) => JSON.parse(l));

  const rowsByEnc = new Map();
  const excluded = [];
  for (const enc of encounters) {
    const r = featurizeEncounter(enc, packs, { outcome, gridHours });
    rowsByEnc.set(enc.encounterId, r.rows);
    excluded.push(...r.excluded);
  }
  const rows = split(encounters, rowsByEnc, {});
  mkdirSync(dirname(join(ROOT, outPath)), { recursive: true });
  writeFileSync(join(ROOT, outPath), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const by = (s) => rows.filter((r) => r.split === s);
  const rate = (a) => a.length ? (100 * a.filter((r) => r.label === 1).length / a.length).toFixed(2) + "%" : "n/a";
  const reasons = {};
  for (const e of excluded) reasons[e.reason] = (reasons[e.reason] || 0) + 1;
  console.log(`matrix -> ${outPath}`);
  console.log(`  outcome ${outcome}, grid ${gridHours}h, features ${Object.keys(rows[0].values).length}`);
  console.log(`  points  train ${by("train").length} (${rate(by("train"))}), val ${by("val").length} (${rate(by("val"))}), test ${by("test").length} (${rate(by("test"))})`);
  console.log(`  excluded from the risk set: ${excluded.length} ${JSON.stringify(reasons)}`);
  console.log(`  synthetic: ${rows.every((r) => r.synthetic) ? "EVERY ROW" : "mixed - check the extract"}`);
}
