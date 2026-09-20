/* backend/medcore/adapters/mimic-iv-demo.mjs — the first adapter over REAL patients.
 *
 * Source: the MIMIC-IV Clinical Database Demo (100 ICU patients, Beth Israel Deaconess Medical
 * Center, de-identified), which is openly licensed under ODbL v1.0 and needs no credentialing -
 * unlike full MIMIC-IV, which does. https://physionet.org/content/mimic-iv-demo/2.2/
 *
 * WHY IT IS HERE AT ALL. An earlier version of this pipeline reasoned "public ICU datasets are
 * credentialed and need a data use agreement nobody here can sign" and stopped, which was true of
 * the full dataset and false of the demo. The demo was available the whole time. 100 patients is
 * far too few to train anything - the gates will refuse whatever comes out, correctly - but it is
 * exactly enough to point the adapter at real ITEMIDs, real unit strings, real timestamps and real
 * missingness, which no synthetic cohort can test because the synthetic cohort was written by the
 * same person as the parser.
 *
 * THE CODES ARE DERIVED, NEVER GUESSED. Every itemid below was read out of d_items.csv.gz and
 * d_labitems.csv.gz rather than recalled. Two traps in doing it the other way:
 *
 *   1. ALARM LIMITS LOOK LIKE VITALS. `220047 Heart Rate Alarm - Low` sits next to
 *      `220045 Heart Rate` and a fuzzy name match takes both. An alarm threshold charted as a
 *      heart rate is a plausible number that is not the patient.
 *   2. THE SAME ANALYTE EXISTS FOR DIFFERENT FLUIDS. `50820 pH` is blood and `51094 pH` is urine;
 *      glucose, potassium and hemoglobin all have the same split. A urine pH mapped into the blood
 *      pH parameter is silent, survives every plausibility check, and is wrong.
 *
 * So the tables below are Blood only, by exact itemid, and anything not listed is COUNTED as
 * unmapped rather than guessed into a parameter.
 *
 * THE DATA IS NOT IN THIS REPOSITORY. It is licensed, and redistributing it through a git history
 * is not ours to do. `backend/medcore/data-mimic/` is gitignored; fetch it with the command in the
 * header of `download.sh` beside this file.
 *
 * node --test test/medcore-mimic.test.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

/* ---- chartevents: vitals. Derived from d_items.csv.gz, exact ids, alarms excluded. ---- */
const CHART_ITEMS = {
  220045: { param: "hr", unit: "bpm" },
  220050: { param: "sbp", unit: "mmHg" },        // Arterial Blood Pressure systolic
  220051: { param: "dbp", unit: "mmHg" },        // Arterial Blood Pressure diastolic
  220052: { param: "map", unit: "mmHg" },        // Arterial Blood Pressure mean
  220179: { param: "sbp", unit: "mmHg" },        // Non Invasive Blood Pressure systolic
  220180: { param: "dbp", unit: "mmHg" },        // Non Invasive Blood Pressure diastolic
  220181: { param: "map", unit: "mmHg" },        // Non Invasive Blood Pressure mean
  220277: { param: "spo2", unit: "%" },
  220210: { param: "rr", unit: "insp/min" },
  223762: { param: "temp", unit: "degC" }
};

/* ---- labevents: Blood only. Where an analyte has several Blood ids they are all accepted,
   because they are the same measurement from different assays; the fluid is what must not mix. ---- */
const LAB_ITEMS = {
  50813: { param: "lactate", unit: "mmol/L" }, 52442: { param: "lactate", unit: "mmol/L" }, 53154: { param: "lactate", unit: "mmol/L" },
  50912: { param: "creat", unit: "mg/dL" }, 52546: { param: "creat", unit: "mg/dL" },
  50983: { param: "na", unit: "mEq/L" }, 52623: { param: "na", unit: "mEq/L" },
  50971: { param: "k", unit: "mEq/L" }, 52610: { param: "k", unit: "mEq/L" },
  50902: { param: "cl", unit: "mEq/L" }, 52535: { param: "cl", unit: "mEq/L" },
  50882: { param: "hco3", unit: "mEq/L" },
  51222: { param: "hb", unit: "g/dL" }, 50811: { param: "hb", unit: "g/dL" }, 51640: { param: "hb", unit: "g/dL" },
  51265: { param: "plt", unit: "x10^9/L" }, 51704: { param: "plt", unit: "x10^9/L" },
  51301: { param: "wbc", unit: "x10^9/L" }, 51755: { param: "wbc", unit: "x10^9/L" }, 51756: { param: "wbc", unit: "x10^9/L" },
  51006: { param: "urea", unit: "mg/dL" }, 52647: { param: "urea", unit: "mg/dL" },
  50931: { param: "glucose", unit: "mg/dL" }, 52569: { param: "glucose", unit: "mg/dL" }, 50809: { param: "glucose", unit: "mg/dL" },
  50862: { param: "albumin", unit: "g/dL" }, 53085: { param: "albumin", unit: "g/dL" },
  51237: { param: "inr", unit: "ratio" }, 51675: { param: "inr", unit: "ratio" },
  50820: { param: "ph", unit: "pH" },             // Blood. 51094/52730/51491 are URINE and excluded.
  50818: { param: "paco2", unit: "mmHg" }
};

/* ---- inputevents: vasopressors, by exact itemid from d_items. ---- */
const PRESSOR_ITEMS = {
  221906: "norepinephrine", 221289: "epinephrine", 229617: "epinephrine",
  222315: "vasopressin", 221662: "dopamine", 221653: "dobutamine",
  229789: "phenylephrine", 229630: "phenylephrine"
};

/** A CSV reader that handles quoted fields. MIMIC quotes labels containing commas. */
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => {
    const o = {};
    header.forEach((h, i) => { o[h] = r[i]; });
    return o;
  });
}

function readTable(dir, rel) {
  const p = join(dir, rel);
  if (!existsSync(p)) throw new Error("mimic adapter: missing " + rel + " - see download.sh");
  return parseCsv(gunzipSync(readFileSync(p)).toString("utf8"));
}

/** MIMIC timestamps are 'YYYY-MM-DD HH:MM:SS', deliberately date-shifted per patient. */
function ts(s) {
  if (!s) return null;
  const ms = Date.parse(String(s).replace(" ", "T") + "Z");
  return isFinite(ms) ? ms : null;
}

/**
 * Builds medcore-encounter/1 objects from the demo, one per ICU stay.
 * @param {{dir?:string, site?:string, region?:string}} opts
 */
export function encounters(opts) {
  const o = opts || {};
  const dir = o.dir || "backend/medcore/data-mimic";

  const patients = new Map(readTable(dir, "hosp/patients.csv.gz").map((r) => [r.subject_id, r]));
  const stays = readTable(dir, "icu/icustays.csv.gz");
  const charts = readTable(dir, "icu/chartevents.csv.gz");
  const labs = readTable(dir, "hosp/labevents.csv.gz");
  const inputs = readTable(dir, "icu/inputevents.csv.gz");

  const unmapped = new Map();
  const byStay = new Map();
  for (const s of stays) byStay.set(s.stay_id, { stay: s, obs: [], pressors: [] });

  for (const c of charts) {
    const map = CHART_ITEMS[Number(c.itemid)];
    if (!map) { count(unmapped, "chart:" + c.itemid); continue; }
    const bucket = byStay.get(c.stay_id);
    if (!bucket) continue;
    const at = ts(c.charttime);
    if (at === null || c.valuenum === "" || c.valuenum === undefined) continue;
    bucket.obs.push({ param: map.param, value: Number(c.valuenum), unit: c.valueuom || map.unit, at: new Date(at).toISOString(), source: "mimic-iv-demo" });
  }

  // Labs are keyed by hadm_id, not stay_id: attach them to every stay of that admission.
  const staysByHadm = new Map();
  for (const s of stays) {
    if (!staysByHadm.has(s.hadm_id)) staysByHadm.set(s.hadm_id, []);
    staysByHadm.get(s.hadm_id).push(s.stay_id);
  }
  for (const l of labs) {
    const map = LAB_ITEMS[Number(l.itemid)];
    if (!map) { count(unmapped, "lab:" + l.itemid); continue; }
    const at = ts(l.charttime);
    if (at === null || l.valuenum === "" || l.valuenum === undefined) continue;
    for (const stayId of (staysByHadm.get(l.hadm_id) || [])) {
      const bucket = byStay.get(stayId);
      if (bucket) bucket.obs.push({ param: map.param, value: Number(l.valuenum), unit: l.valueuom || map.unit, at: new Date(at).toISOString(), source: "mimic-iv-demo" });
    }
  }

  for (const i of inputs) {
    const agent = PRESSOR_ITEMS[Number(i.itemid)];
    if (!agent) continue;
    const bucket = byStay.get(i.stay_id);
    const at = ts(i.starttime);
    if (bucket && at !== null) bucket.pressors.push({ at, agent });
  }

  const out = [];
  for (const [stayId, b] of byStay) {
    const p = patients.get(b.stay.subject_id) || {};
    const admittedAt = ts(b.stay.intime), dischargedAt = ts(b.stay.outtime);
    if (admittedAt === null || dischargedAt === null) continue;
    b.obs.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    b.pressors.sort((x, y) => x.at - y.at);
    const first = b.pressors[0] || null;

    out.push({
      schema: "medcore-encounter/1",
      encounterId: "mimic-" + stayId,
      subjectKey: "mimic-subj-" + b.stay.subject_id,
      admittedAt: new Date(admittedAt).toISOString(),
      dischargedAt: new Date(dischargedAt).toISOString(),
      site: o.site || "BIDMC-ICU",
      region: o.region || "US",
      // anchor_age is the reported age in years. There is no dob in this schema and MIMIC's dates
      // are deliberately shifted, so deriving one would be meaningless as well as forbidden.
      demographics: {
        ageYears: p.anchor_age ? Number(p.anchor_age) : null,
        sex: p.gender === "M" ? "M" : p.gender === "F" ? "F" : "unknown",
        weightKg: null
      },
      observations: b.obs,
      interventions: first ? [{ kind: "vasopressor", startedAt: new Date(first.at).toISOString(), agents: [first.agent] }] : [],
      /* Only what this extract can actually establish. Everything else is OMITTED, so
       * medcore-outcomes.js refuses those questions rather than answering them on a guess:
       * these are ICU stays, so inIcu is true and MC-1 is simply not askable here. */
      context: { inIcu: true, rrt: false, ventilation: undefined },
      events: first ? [{ id: "MC-3", at: new Date(first.at).toISOString() }] : [],
      provenance: {
        dataset: "mimic-iv-demo-2.2",
        synthetic: false,
        adapter: "backend/medcore/adapters/mimic-iv-demo.mjs@1.0.0",
        licence: "ODbL v1.0",
        unmappedCodes: unmapped.size
      }
    });
  }
  return { encounters: out, unmapped: Array.from(unmapped.entries()).sort((a, b) => b[1] - a[1]) };
}

function count(m, k) { m.set(k, (m.get(k) || 0) + 1); }
