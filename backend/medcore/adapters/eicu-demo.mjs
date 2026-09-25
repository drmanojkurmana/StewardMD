/* backend/medcore/adapters/eicu-demo.mjs — 2,520 real ICU stays across 20 hospitals.
 *
 * Source: the eICU Collaborative Research Database Demo v2.0.1, openly available with no
 * credentialing, drawn from 20 of the larger hospitals in the full eICU-CRD.
 * https://physionet.org/content/eicu-crd-demo/2.0.1/
 *
 * WHY THIS ONE AND NOT JUST THE MIMIC DEMO. The MIMIC demo is 140 stays and 36 events - enough to
 * meet real ITEMIDs, not enough to train anything. This is 2,520 stays and 225 with a vasopressor,
 * from MANY hospitals, which is the first extract that can exercise the subgroup gate on a real
 * `site` rather than on one I invented.
 *
 * THREE THINGS ABOUT THIS SOURCE THAT THE ADAPTER MUST HANDLE HONESTLY.
 *
 *  1. THERE ARE NO ABSOLUTE DATES. eICU is de-identified by storing OFFSETS in minutes from unit
 *     admission, and nothing else. The intervals between observations are real; the calendar is
 *     not. So this anchors each stay to a synthetic admission instant and says so in provenance:
 *     everything Medical Core does depends on intervals and ordering, both of which survive, and
 *     nothing depends on the date. Pretending a real date exists would be the lie here.
 *  2. AGE IS SOMETIMES "> 89". Ages above 89 are collapsed for de-identification. Parsed naively
 *     that is not a number and the patient loses their age entirely; treated as 90 it is a floor,
 *     which is what the source means. Anything else non-numeric is dropped, not guessed.
 *  3. vitalPeriodic CARRIES NO UNITS - they are fixed by the schema. The adapter therefore supplies
 *     them, which is exactly an adapter's job: it is the thing that knows its own source. Labs DO
 *     carry a unit string and it is passed through verbatim for medcore-units.js to accept or
 *     refuse, because a unit the source states is evidence and a unit the adapter assumes is not.
 *
 * node --test test/medcore-eicu.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseCsv } from "./mimic-iv-demo.mjs";

/* vitalPeriodic columns -> parameters, with the units the schema fixes. */
const VITAL_COLUMNS = {
  heartrate: { param: "hr", unit: "bpm" },
  respiration: { param: "rr", unit: "/min" },
  sao2: { param: "spo2", unit: "%" },
  temperature: { param: "temp", unit: "degC" },
  systemicsystolic: { param: "sbp", unit: "mmHg" },
  systemicdiastolic: { param: "dbp", unit: "mmHg" },
  systemicmean: { param: "map", unit: "mmHg" }
};

/* labname -> parameter. Exact names from the source's own dictionary, never a prefix match:
 * "glucose" and "bedside glucose" are different assays, and "-lymphs" is a differential percentage
 * that would be nonsense as any parameter here. Unlisted names are counted, not guessed. */
/* nurseCharting: where the CUFF pressures live. vitalPeriodic carries only arterial-line values, so
 * an extract built from it alone has a blood pressure for the minority of patients who had a line -
 * on this demo that refused 2,743 of 2,960 prediction points, and every one of them was a real
 * patient with a perfectly good cuff reading in another table.
 *
 * THE TRAP HERE IS TEMPERATURE. `Temperature (F)` and `Temperature (C)` both exist, 61,880 rows
 * each, and mapping both to `temp` without carrying the unit mixes Fahrenheit into Celsius - a
 * value that is plausible, wrong, and silent. The unit travels with the label. */
const NURSE_LABELS = {
  "Heart Rate|Heart Rate": { param: "hr", unit: "bpm" },
  "Respiratory Rate|Respiratory Rate": { param: "rr", unit: "/min" },
  "O2 Saturation|O2 Saturation": { param: "spo2", unit: "%" },
  "Non-Invasive BP|Non-Invasive BP Systolic": { param: "sbp", unit: "mmHg" },
  "Non-Invasive BP|Non-Invasive BP Diastolic": { param: "dbp", unit: "mmHg" },
  "Non-Invasive BP|Non-Invasive BP Mean": { param: "map", unit: "mmHg" },
  "Invasive BP|Invasive BP Systolic": { param: "sbp", unit: "mmHg" },
  "Invasive BP|Invasive BP Diastolic": { param: "dbp", unit: "mmHg" },
  "Invasive BP|Invasive BP Mean": { param: "map", unit: "mmHg" },
  "Temperature|Temperature (C)": { param: "temp", unit: "degC" },
  "Temperature|Temperature (F)": { param: "temp", unit: "degF" },
  "Glasgow coma score|GCS Total": { param: "gcs", unit: "points" }
};

const LAB_NAMES = {
  "potassium": "k", "sodium": "na", "chloride": "cl", "bicarbonate": "hco3",
  "creatinine": "creat", "BUN": "urea", "glucose": "glucose",
  "Hgb": "hb", "platelets x 1000": "plt", "WBC x 1000": "wbc",
  "lactate": "lactate", "albumin": "albumin", "total bilirubin": "bili",
  "PT - INR": "inr", "pH": "ph", "paCO2": "paco2", "paO2": "pao2"
};

const MIN = 60000;
/* A fixed anchor so a run is reproducible. Stays are spread across it by id so two stays never
 * share a timeline; the DATE means nothing and provenance says so. */
const ANCHOR = Date.UTC(2030, 0, 1);

function readTable(dir, name) {
  const p = join(dir, name);
  if (!existsSync(p)) throw new Error("eicu adapter: missing " + name + " - see download.sh");
  return parseCsv(gunzipSync(readFileSync(p)).toString("utf8"));
}

/** eICU collapses ages above 89. "> 89" means at least 90, which is a floor, not a missing value. */
export function parseAge(raw) {
  const s = String(raw === undefined || raw === null ? "" : raw).trim();
  if (!s) return null;
  if (/^>\s*89$/.test(s)) return 90;
  const n = Number(s);
  return isFinite(n) && n >= 0 && n <= 120 ? Math.floor(n) : null;
}

const num = (x) => {
  if (x === undefined || x === null || x === "") return null;
  const n = Number(x);
  return isFinite(n) ? n : null;
};

/**
 * @param {{dir?:string, maxStays?:number}} opts
 * @returns {{encounters:Array, unmappedLabs:Array}}
 */
export function encounters(opts) {
  const o = opts || {};
  const dir = o.dir || "backend/medcore/data-eicu";

  const patients = readTable(dir, "patient.csv.gz");
  const vitals = readTable(dir, "vitalPeriodic.csv.gz");
  const labs = readTable(dir, "lab.csv.gz");
  const treatments = readTable(dir, "treatment.csv.gz");
  const carePlan = existsSync(join(dir, "carePlanGeneral.csv.gz")) ? readTable(dir, "carePlanGeneral.csv.gz") : [];
  const nurse = existsSync(join(dir, "nurseCharting.csv.gz")) ? readTable(dir, "nurseCharting.csv.gz") : [];

  const unmappedLabs = new Map();
  const byStay = new Map();

  let seq = 0;
  for (const p of patients) {
    const id = p.patientunitstayid;
    if (!id) continue;
    const los = num(p.unitdischargeoffset);
    if (los === null || los <= 0) continue;
    const admittedAt = ANCHOR + (seq++) * 7 * 24 * 3600000;   // rule 1: a synthetic calendar
    byStay.set(id, {
      p, admittedAt, dischargedAt: admittedAt + los * MIN,
      obs: [], pressors: [], dnr: undefined
    });
  }
  if (o.maxStays) {
    const keep = Array.from(byStay.keys()).slice(0, o.maxStays);
    for (const k of Array.from(byStay.keys())) if (!keep.includes(k)) byStay.delete(k);
  }

  for (const v of vitals) {
    const b = byStay.get(v.patientunitstayid);
    if (!b) continue;
    const off = num(v.observationoffset);
    if (off === null) continue;
    const at = b.admittedAt + off * MIN;
    if (at > b.dischargedAt) continue;
    for (const col of Object.keys(VITAL_COLUMNS)) {
      const value = num(v[col]);
      if (value === null) continue;
      const m = VITAL_COLUMNS[col];
      b.obs.push({ param: m.param, value, unit: m.unit, at: new Date(at).toISOString(), source: "eicu-demo" });
    }
  }

  for (const n of nurse) {
    const b = byStay.get(n.patientunitstayid);
    if (!b) continue;
    const key = (n.nursingchartcelltypevallabel || "") + "|" + (n.nursingchartcelltypevalname || "");
    const m = NURSE_LABELS[key];
    if (!m) continue;
    const value = num(n.nursingchartvalue), off = num(n.nursingchartoffset);
    if (value === null || off === null) continue;
    const at = b.admittedAt + off * MIN;
    if (at > b.dischargedAt) continue;
    b.obs.push({ param: m.param, value, unit: m.unit, at: new Date(at).toISOString(), source: "eicu-demo/nurse" });
  }

  for (const l of labs) {
    const b = byStay.get(l.patientunitstayid);
    if (!b) continue;
    const param = Object.prototype.hasOwnProperty.call(LAB_NAMES, l.labname) ? LAB_NAMES[l.labname] : null;
    if (!param) { unmappedLabs.set(l.labname, (unmappedLabs.get(l.labname) || 0) + 1); continue; }
    const value = num(l.labresult), off = num(l.labresultoffset);
    if (value === null || off === null) continue;
    const at = b.admittedAt + off * MIN;
    if (at > b.dischargedAt) continue;
    // Rule 3: the source's own unit string, passed through for the allow-list to judge.
    b.obs.push({ param, value, unit: l.labmeasurenamesystem || null, at: new Date(at).toISOString(), source: "eicu-demo" });
  }

  for (const t of treatments) {
    const b = byStay.get(t.patientunitstayid);
    if (!b) continue;
    if (!/\|vasopressors/i.test(t.treatmentstring || "")) continue;
    const off = num(t.treatmentoffset);
    if (off === null) continue;
    b.pressors.push({ at: b.admittedAt + off * MIN, label: t.treatmentstring });
  }

  /* Resuscitation status, where the care plan records one. Absent stays UNDEFINED so
   * medcore-outcomes.js refuses the outcomes that need it rather than assuming full treatment. */
  for (const c of carePlan) {
    const b = byStay.get(c.patientunitstayid);
    if (!b) continue;
    const v = String(c.cplitemvalue || "");
    if (/do not resuscitate|dnr/i.test(v)) b.dnr = true;
    else if (/full therapy|full code/i.test(v) && b.dnr === undefined) b.dnr = false;
  }

  const out = [];
  for (const [stayId, b] of byStay) {
    if (!b.obs.length) continue;
    b.obs.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    b.pressors.sort((x, y) => x.at - y.at);
    const first = b.pressors[0] || null;
    const p = b.p;

    const context = { inIcu: true, rrt: false };
    if (b.dnr !== undefined) context.dnr = b.dnr;

    out.push({
      schema: "medcore-encounter/1",
      encounterId: "eicu-" + stayId,
      subjectKey: "eicu-subj-" + (p.uniquepid || stayId),
      admittedAt: new Date(b.admittedAt).toISOString(),
      dischargedAt: new Date(b.dischargedAt).toISOString(),
      site: "eicu-hosp-" + (p.hospitalid || "unknown"),
      region: "US",
      demographics: {
        ageYears: parseAge(p.age),
        sex: p.gender === "Male" ? "M" : p.gender === "Female" ? "F" : "unknown",
        weightKg: num(p.admissionweight)
      },
      observations: b.obs,
      interventions: first ? [{ kind: "vasopressor", startedAt: new Date(first.at).toISOString(), agents: ["vasopressor"] }] : [],
      context,
      events: first ? [{ id: "MC-3", at: new Date(first.at).toISOString() }] : [],
      provenance: {
        dataset: "eicu-crd-demo-2.0.1",
        synthetic: false,
        adapter: "backend/medcore/adapters/eicu-demo.mjs@1.0.0",
        licence: "PhysioNet open access (eICU-CRD Demo)",
        datesAreSynthetic: true,
        datesNote: "eICU stores offsets in minutes from unit admission and no calendar. Intervals and ordering are real; the absolute dates here are an anchor and mean nothing."
      }
    });
  }
  return { encounters: out, unmappedLabs: Array.from(unmappedLabs.entries()).sort((a, b) => b[1] - a[1]) };
}
