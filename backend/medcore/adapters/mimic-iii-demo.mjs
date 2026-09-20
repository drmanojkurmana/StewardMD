/* backend/medcore/adapters/mimic-iii-demo.mjs — the third open source, and the two-era problem.
 *
 * Source: MIMIC-III Clinical Database Demo v1.4, 100 patients, openly available, no credentialing.
 * https://physionet.org/content/mimiciii-demo/1.4/
 *
 * WHAT MAKES THIS ONE DIFFERENT FROM THE MIMIC-IV ADAPTER. MIMIC-III spans TWO charting systems,
 * CareVue and MetaVision, and they use different itemids for the same measurement: heart rate is
 * 211 in one and 220045 in the other, respiratory rate is 618 and 220210. An adapter written
 * against one era silently loses every patient charted in the other - not an error, just half the
 * cohort quietly missing. Both sets are mapped, and both were read out of D_ITEMS.csv rather than
 * recalled.
 *
 * THE TEMPERATURE TRAP AGAIN, now in four forms: `Temperature C` and `Temperature F` (CareVue),
 * `Temperature Celsius` and `Temperature Fahrenheit` (MetaVision). The unit travels with the
 * itemid. This is the third dataset in a row where Fahrenheit and Celsius sit beside each other
 * under nearly identical names.
 *
 * node --test test/medcore-adapters.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "./mimic-iv-demo.mjs";

/* Both eras. Derived from D_ITEMS.csv: `carevue` and `metavision` rows for the same measurement. */
const CHART_ITEMS = {
  // CareVue
  211: { param: "hr", unit: "bpm" },
  646: { param: "spo2", unit: "%" },
  618: { param: "rr", unit: "/min" },
  676: { param: "temp", unit: "degC" },
  678: { param: "temp", unit: "degF" },
  51: { param: "sbp", unit: "mmHg" }, 8368: { param: "dbp", unit: "mmHg" }, 52: { param: "map", unit: "mmHg" },
  455: { param: "sbp", unit: "mmHg" }, 8441: { param: "dbp", unit: "mmHg" }, 456: { param: "map", unit: "mmHg" },
  198: { param: "gcs", unit: "points" },
  // MetaVision
  220045: { param: "hr", unit: "bpm" },
  220277: { param: "spo2", unit: "%" },
  220210: { param: "rr", unit: "insp/min" },
  223762: { param: "temp", unit: "degC" },
  223761: { param: "temp", unit: "degF" },
  220050: { param: "sbp", unit: "mmHg" }, 220051: { param: "dbp", unit: "mmHg" }, 220052: { param: "map", unit: "mmHg" },
  220179: { param: "sbp", unit: "mmHg" }, 220180: { param: "dbp", unit: "mmHg" }, 220181: { param: "map", unit: "mmHg" }
};

const PRESSOR_ITEMS = {
  221906: "norepinephrine", 221289: "epinephrine", 222315: "vasopressin",
  221662: "dopamine", 221653: "dobutamine", 221749: "phenylephrine"
};

/** Lab itemids, Blood only, derived from D_LABITEMS.csv at load rather than hardcoded: MIMIC-III
 *  and MIMIC-IV share the 5xxxx lab space, so the same ids apply, but they are verified present. */
const LAB_NAMES = {
  Lactate: "lactate", Creatinine: "creat", Sodium: "na", Potassium: "k", Chloride: "cl",
  Bicarbonate: "hco3", Hemoglobin: "hb", "Platelet Count": "plt", "White Blood Cells": "wbc",
  "Urea Nitrogen": "urea", Glucose: "glucose", Albumin: "albumin", "INR(PT)": "inr", pH: "ph"
};
const LAB_UNITS = {
  lactate: "mmol/L", creat: "mg/dL", na: "mEq/L", k: "mEq/L", cl: "mEq/L", hco3: "mEq/L",
  hb: "g/dL", plt: "x10^9/L", wbc: "x10^9/L", urea: "mg/dL", glucose: "mg/dL",
  albumin: "g/dL", inr: "ratio", ph: "pH"
};

function readTable(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) throw new Error("mimic-iii adapter: missing " + name + " - see download.sh");
  return parseCsv(readFileSync(p, "utf8"));
}
function ts(s) {
  if (!s) return null;
  const ms = Date.parse(String(s).replace(" ", "T") + "Z");
  return isFinite(ms) ? ms : null;
}
const num = (x) => { if (x === undefined || x === null || x === "") return null; const n = Number(x); return isFinite(n) ? n : null; };

export function encounters(opts) {
  const o = opts || {};
  const dir = o.dir || "backend/medcore/data-mimic3";

  const patients = new Map(readTable(dir, "PATIENTS.csv").map((r) => [r.subject_id, r]));
  const stays = readTable(dir, "ICUSTAYS.csv");
  const charts = readTable(dir, "CHARTEVENTS.csv");
  const labDict = readTable(dir, "D_LABITEMS.csv");
  const labs = readTable(dir, "LABEVENTS.csv");
  const inputs = existsSync(join(dir, "INPUTEVENTS_MV.csv")) ? readTable(dir, "INPUTEVENTS_MV.csv") : [];

  // Lab ids derived from the dictionary, Blood only - the urine/other-fluid split that bit the
  // MIMIC-IV adapter exists here identically.
  const LAB_IDS = {};
  for (const d of labDict) {
    if (d.fluid !== "Blood") continue;
    const param = LAB_NAMES[d.label];
    if (param) LAB_IDS[Number(d.itemid)] = param;
  }

  const byStay = new Map();
  for (const s of stays) byStay.set(s.icustay_id, { stay: s, obs: [], pressors: [] });

  for (const c of charts) {
    const m = CHART_ITEMS[Number(c.itemid)];
    if (!m) continue;
    const b = byStay.get(c.icustay_id);
    const at = ts(c.charttime), v = num(c.valuenum);
    if (!b || at === null || v === null) continue;
    b.obs.push({ param: m.param, value: v, unit: c.valueuom || m.unit, at: new Date(at).toISOString(), source: "mimic-iii-demo" });
  }

  const staysByHadm = new Map();
  for (const s of stays) {
    if (!staysByHadm.has(s.hadm_id)) staysByHadm.set(s.hadm_id, []);
    staysByHadm.get(s.hadm_id).push(s.icustay_id);
  }
  for (const l of labs) {
    const param = LAB_IDS[Number(l.itemid)];
    if (!param) continue;
    const at = ts(l.charttime), v = num(l.valuenum);
    if (at === null || v === null) continue;
    for (const id of (staysByHadm.get(l.hadm_id) || [])) {
      const b = byStay.get(id);
      if (b) b.obs.push({ param, value: v, unit: l.valueuom || LAB_UNITS[param], at: new Date(at).toISOString(), source: "mimic-iii-demo" });
    }
  }

  for (const i of inputs) {
    const agent = PRESSOR_ITEMS[Number(i.itemid)];
    const b = byStay.get(i.icustay_id);
    const at = ts(i.starttime);
    if (agent && b && at !== null) b.pressors.push({ at, agent });
  }

  const out = [];
  for (const [stayId, b] of byStay) {
    const admittedAt = ts(b.stay.intime), dischargedAt = ts(b.stay.outtime);
    if (admittedAt === null || dischargedAt === null || !b.obs.length) continue;
    b.obs.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    b.pressors.sort((x, y) => x.at - y.at);
    const first = b.pressors[0] || null;
    const p = patients.get(b.stay.subject_id) || {};

    out.push({
      schema: "medcore-encounter/1",
      encounterId: "m3-" + stayId,
      subjectKey: "m3-subj-" + b.stay.subject_id,
      admittedAt: new Date(admittedAt).toISOString(),
      dischargedAt: new Date(dischargedAt).toISOString(),
      site: "BIDMC-ICU-m3", region: "US",
      /* MIMIC-III shifts dates and does not publish a usable age in the demo's PATIENTS table, so
       * age is OMITTED rather than derived from a shifted dob. HAZ-ML-04: no dob arithmetic. */
      demographics: { ageYears: null, sex: p.gender === "M" ? "M" : p.gender === "F" ? "F" : "unknown", weightKg: null },
      observations: b.obs,
      interventions: first ? [{ kind: "vasopressor", startedAt: new Date(first.at).toISOString(), agents: [first.agent] }] : [],
      context: { inIcu: true, rrt: false },
      events: first ? [{ id: "MC-3", at: new Date(first.at).toISOString() }] : [],
      provenance: {
        dataset: "mimic-iii-demo-1.4", synthetic: false,
        adapter: "backend/medcore/adapters/mimic-iii-demo.mjs@1.0.0",
        licence: "ODbL v1.0"
      }
    });
  }
  return { encounters: out };
}
