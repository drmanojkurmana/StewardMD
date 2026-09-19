/* backend/medcore/synth/generate.mjs — a synthetic cohort, and what it is honestly for.
 *
 * WHAT THIS IS NOT FOR. Training a model anyone treats as clinical. A synthetic cohort contains
 * exactly the physiology its author wrote into it, so a model trained here learns that author's
 * beliefs and reports them back with a confidence interval. The textbook presentation is also the
 * patient who was never going to be missed; the patient this whole project exists for is the
 * atypical one, and no generator contains them. Every artifact produced from this data is stamped
 * `synthetic: true` and medcore-models.js refuses it for any clinical path.
 *
 * WHAT IT IS GENUINELY FOR, and this is worth more than it sounds: PROVING THE CONTROLS DETECT THE
 * FAILURES THEY CLAIM TO DETECT, on data where the ground truth is known because we wrote it.
 * HAZ-ML-01 and HAZ-ML-02 are both declared PARTIAL in the safety case for the same reason - their
 * enforcement half is tested, and their empirical half has never run because there is no data. Here
 * the failures can be INJECTED deliberately and the controls asked to catch them:
 *
 *   --frequency-bias   sicker patients get observed more often, exactly as they are on a real ward.
 *                      A frequency-only model should then score well, and the HAZ-ML-01 gate should
 *                      fail the run. A control that cannot be made to fire has not been tested.
 *   --prevalent-rate   some patients are ALREADY on the treatment at admission. They must leave the
 *                      risk set (HAZ-ML-02). Labelling them negative should visibly wreck the model.
 *   --rescue-rate      some deteriorating patients are treated in time and never reach the event:
 *                      the treatment paradox itself, as a measurable contamination rate.
 *
 * The generator is deliberately simple and says so. Trajectories are smooth drifts with noise, not
 * physiology; there are no comorbidities, no interactions, no diurnal variation and no missingness
 * mechanism beyond a sampling interval. Anyone reading a number produced from this data should read
 * it as a statement about the PIPELINE, never about patients.
 *
 * Deterministic: the same seed gives byte-identical output, so a dataset card describes exactly one
 * cohort and a regression test can pin it.
 *
 * USAGE: node backend/medcore/synth/generate.mjs --n 400 --seed 20260919 --out backend/medcore/out/synth.jsonl
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const HOUR = 3600000, MIN = 60000;

/* mulberry32: small, fast, and seedable. Reproducibility is the only requirement. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const gauss = (r, mu, sd) => {
  const u = Math.max(1e-9, r()), v = Math.max(1e-9, r());
  return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const r2 = (x) => Math.round(x * 100) / 100;

/* Four trajectory classes. `severity` is the latent the observations are drawn around: 0 is well,
 * 1 is periarrest. It is never written to the extract - recovering it is the model's whole job. */
const CLASSES = ["stable", "slow", "rapid", "recovering"];

function severityAt(cls, tFrac) {
  switch (cls) {
    case "stable": return 0.12;
    case "slow": return 0.15 + 0.5 * tFrac;
    case "rapid": return 0.15 + 0.85 * Math.pow(tFrac, 2.2);
    case "recovering": return 0.6 - 0.45 * tFrac;
    default: return 0.2;
  }
}

/* Observation values as a function of the latent severity. Smooth, noisy, and deliberately
 * uncomplicated: this is a test fixture with units, not a physiological model. */
function vitalsAt(r, sev, base) {
  return {
    hr: clamp(gauss(r, base.hr + 55 * sev, 4), 35, 190),
    sbp: clamp(gauss(r, base.sbp - 45 * sev, 6), 55, 200),
    dbp: clamp(gauss(r, base.dbp - 22 * sev, 5), 30, 120),
    map: clamp(gauss(r, base.map - 30 * sev, 5), 30, 140),
    spo2: clamp(gauss(r, base.spo2 - 11 * sev, 1.2), 60, 100),
    rr: clamp(gauss(r, base.rr + 16 * sev, 2), 6, 60),
    temp: clamp(gauss(r, base.temp + 1.4 * sev, 0.3), 34, 42),
    gcs: Math.round(clamp(gauss(r, 15 - 6 * sev, 0.6), 3, 15)),
    uop: clamp(gauss(r, base.uop - 45 * sev, 8), 0, 300)
  };
}
function labsAt(r, sev, base) {
  return {
    lactate: clamp(gauss(r, 1.0 + 4.5 * sev, 0.4), 0.3, 20),
    creat: clamp(gauss(r, base.creat + 1.6 * sev, 0.15), 0.2, 12),
    k: clamp(gauss(r, 4.1 + 0.9 * sev, 0.3), 2.2, 7.5),
    na: clamp(gauss(r, 138 - 3 * sev, 3), 118, 158),
    wbc: clamp(gauss(r, 8 + 9 * sev, 2), 0.5, 60),
    plt: clamp(gauss(r, 240 - 110 * sev, 30), 8, 700),
    hb: clamp(gauss(r, 12.5 - 2.2 * sev, 0.8), 3, 19)
  };
}

const VITAL_UNITS = { hr: "bpm", sbp: "mmHg", dbp: "mmHg", map: "mmHg", spo2: "%", rr: "/min", temp: "degC", gcs: "points", uop: "mL/h" };
const LAB_UNITS = { lactate: "mmol/L", creat: "mg/dL", k: "mmol/L", na: "mmol/L", wbc: "x10^9/L", plt: "x10^9/L", hb: "g/dL" };

function makeEncounter(r, i, opt) {
  const cls = (() => {
    const p = r();
    if (p < 0.62) return "stable";
    if (p < 0.78) return "slow";
    if (p < 0.90) return "rapid";
    return "recovering";
  })();

  const lengthH = Math.round(clamp(gauss(r, 60, 24), 12, 168));
  const admittedAt = Date.UTC(2026, 0, 1) + Math.floor(r() * 300) * 24 * HOUR;
  const dischargedAt = admittedAt + lengthH * HOUR;
  const ageYears = Math.round(clamp(gauss(r, 61, 17), 17, 95));
  const sex = r() < 0.54 ? "M" : "F";
  const weightKg = r2(clamp(gauss(r, sex === "M" ? 71 : 62, 12), 38, 130));
  const base = {
    hr: gauss(r, 78, 8), sbp: gauss(r, 128, 12), dbp: gauss(r, 76, 8), map: gauss(r, 93, 9),
    spo2: gauss(r, 97, 1), rr: gauss(r, 16, 2), temp: gauss(r, 36.8, 0.3),
    uop: gauss(r, 75, 18), creat: clamp(gauss(r, 0.95, 0.25), 0.4, 2.2)
  };

  /* The three injected failure modes, each switchable so a control can be made to fire. */
  const prevalent = r() < opt.prevalentRate;          // already on a vasopressor at admission
  const rescued = (cls === "slow" || cls === "rapid") && r() < opt.rescueRate;

  const observations = [];
  const interventions = [];
  const events = [];

  if (prevalent) {
    interventions.push({ kind: "vasopressor", startedAt: new Date(admittedAt).toISOString(), agents: ["noradrenaline"] });
  }

  /* The event, when there is one. A rescued patient deteriorates and never reaches it: that is the
   * treatment paradox as a row in the data, not as a paragraph in a plan. */
  let eventAt = null;
  if (!prevalent && !rescued && (cls === "slow" || cls === "rapid")) {
    const frac = cls === "rapid" ? 0.55 + 0.35 * r() : 0.7 + 0.25 * r();
    eventAt = admittedAt + Math.floor(lengthH * frac) * HOUR;
    events.push({ id: "MC-3", at: new Date(eventAt).toISOString() });
    interventions.push({ kind: "vasopressor", startedAt: new Date(eventAt).toISOString(), agents: ["noradrenaline"] });
  }

  /* Sampling. Vitals on a fixed interval by default. With --frequency-bias the interval shortens as
   * the patient deteriorates, which is what a real ward does and is exactly the shortcut a model
   * will reach for if nothing stops it. */
  let t = admittedAt;
  while (t <= dischargedAt) {
    const tFrac = (t - admittedAt) / Math.max(1, dischargedAt - admittedAt);
    let sev = severityAt(cls, tFrac);
    // A rescued patient's physiology turns around at the moment they would have had the event.
    if (rescued && tFrac > 0.75) sev = Math.max(0.12, sev - 0.5 * (tFrac - 0.75) / 0.25);
    const v = vitalsAt(r, sev, base);
    for (const p of Object.keys(v)) {
      observations.push({ param: p, value: r2(v[p]), unit: VITAL_UNITS[p], at: new Date(t).toISOString(), source: "extract" });
    }
    const stepH = opt.frequencyBias ? clamp(4 - 3.4 * sev, 0.5, 4) : 4;
    t += Math.round(stepH * HOUR);
  }

  let lt = admittedAt;
  while (lt <= dischargedAt) {
    const tFrac = (lt - admittedAt) / Math.max(1, dischargedAt - admittedAt);
    let sev = severityAt(cls, tFrac);
    if (rescued && tFrac > 0.75) sev = Math.max(0.12, sev - 0.5 * (tFrac - 0.75) / 0.25);
    const l = labsAt(r, sev, base);
    for (const p of Object.keys(l)) {
      observations.push({ param: p, value: r2(l[p]), unit: LAB_UNITS[p], at: new Date(lt).toISOString(), source: "extract" });
    }
    lt += Math.round((opt.frequencyBias ? clamp(12 - 9 * sev, 4, 12) : 12) * HOUR);
  }

  observations.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return {
    schema: "medcore-encounter/1",
    encounterId: "e-" + String(i).padStart(5, "0"),
    subjectKey: "s-" + String(i).padStart(5, "0"),
    admittedAt: new Date(admittedAt).toISOString(),
    dischargedAt: new Date(dischargedAt).toISOString(),
    demographics: { ageYears, sex, weightKg },
    observations,
    interventions,
    context: {
      inIcu: false, electivePostOp: false, admissionPlanned: false,
      dnr: r() < 0.06, creatinineBaseline: r2(base.creat), aki2OrWorse: false,
      ventilation: false, rrt: false
    },
    events,
    // Not part of the schema a real adapter produces. Kept only so the evaluator can report how
    // much contamination it was asked to see through, and asserted absent from the feature matrix.
    _truth: { class: cls, prevalent, rescued },
    provenance: {
      dataset: opt.dataset, synthetic: true,
      generator: "backend/medcore/synth/generate.mjs@1.0.0", seed: opt.seed
    }
  };
}

export function generate(opts) {
  const opt = Object.assign({
    n: 400, seed: 20260919, frequencyBias: false, prevalentRate: 0.08, rescueRate: 0.25,
    dataset: "medcore-synth-v1"
  }, opts || {});
  const r = rng(opt.seed);
  const out = [];
  for (let i = 1; i <= opt.n; i++) out.push(makeEncounter(r, i, opt));
  return { encounters: out, opts: opt };
}

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}

if (import.meta.url === "file://" + process.argv[1]) {
  const opt = {
    n: Number(arg("n", 400)), seed: Number(arg("seed", 20260919)),
    frequencyBias: !!arg("frequency-bias", false),
    prevalentRate: Number(arg("prevalent-rate", 0.08)),
    rescueRate: Number(arg("rescue-rate", 0.25)),
    dataset: String(arg("dataset", "medcore-synth-v1"))
  };
  const outPath = String(arg("out", "backend/medcore/out/synth.jsonl"));
  const { encounters } = generate(opt);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, encounters.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const ev = encounters.filter((e) => e.events.length).length;
  const prev = encounters.filter((e) => e._truth.prevalent).length;
  const resc = encounters.filter((e) => e._truth.rescued).length;
  console.log(`SYNTHETIC cohort written to ${outPath}`);
  console.log(`  encounters ${encounters.length}, with an MC-3 event ${ev} (${(100 * ev / encounters.length).toFixed(1)}%)`);
  console.log(`  prevalent (already on a pressor) ${prev}, rescued (treatment paradox) ${resc}`);
  console.log(`  observations ${encounters.reduce((a, e) => a + e.observations.length, 0)}`);
  console.log(`  frequency-bias ${opt.frequencyBias ? "ON (sicker patients observed more often)" : "off"}`);
  console.log("  provenance.synthetic = true on every row. No artifact from this data may reach a clinician.");
}
