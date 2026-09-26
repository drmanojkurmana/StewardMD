#!/usr/bin/env node
/* One-off migration (2026-09-26): the 20 literature studies in data/antibiogram-raw.json, the
 * GIMSR 2018 hospital table and the ICMR AMRSN 2024 summary (both typed into app.js as
 * window.ASP_ABG) become one JSON file per source in data/antibiogram/sources/, the format
 * scripts/build-antibiogram.mjs reads. After this runs once, the per-source files are the
 * source of truth; data/antibiogram-raw.json is kept only as the audit trail of the original
 * extraction. Re-running overwrites the migrated files (not the census extractions).
 *
 * Nothing is recomputed here: each organism entry becomes one row with its own specimen and
 * setting (the old build merged specimens and spliced studies together; that is gone).
 * Cells the original verifier flagged as suspect go to "excluded" with the reason.
 *
 * Run: node scripts/abg-migrate-legacy.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../antibiogram-rules.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "antibiogram", "sources");
mkdirSync(OUT, { recursive: true });

const SUSPECT = /suspect|implausib|source error|data.?entry|inverted|caution|questionable/i;
const NOT_A_DRUG = { aminoglycosides: "class-level result, not one drug", "ceftazidime-clav": "ESBL confirmation disc, not a treatment", novobiocin: "identification test for S. saprophyticus, not a treatment" };

// Per-study metadata. spec/set per organism entry are decided by specOf() below.
const META = {
  RML_ICU: { inst: "RML_LUCKNOW", institution: "Dr Ram Manohar Lohia Institute of Medical Sciences", short: "RML Lucknow", city: "Lucknow", state: "Uttar Pradesh", sector: "government", year: 2023, period: "June 2022 to June 2023", doi: "10.7759/cureus.57356", citation: "Cureus 2024;16(3):e57356", url: "https://doi.org/10.7759/cureus.57356" },
  DOON_CSOM: { inst: "DOON_DEHRADUN", institution: "Government Doon Medical College", short: "Doon MC Dehradun", city: "Dehradun", state: "Uttarakhand", sector: "government", year: 2024, period: "August 2022 to January 2024", citation: "Cureus 2024 (PMC11483178)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11483178/" },
  SGRD_KLEB: { inst: "SGRD_AMRITSAR", institution: "Sri Guru Ram Das Institute of Medical Sciences and Research", short: "SGRD Amritsar", city: "Amritsar", state: "Punjab", sector: "private", citation: "Cureus 2023 (PMC10106535)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10106535/" },
  HAYES_URO: { inst: "HAYES_PRAYAGRAJ", institution: "Hayes Memorial Mission Hospital", short: "Hayes Prayagraj", city: "Prayagraj", state: "Uttar Pradesh", sector: "private", year: 2019, period: "November 2018 to December 2019", doi: "10.3389/fmicb.2022.965053", citation: "Front Microbiol 2022", url: "https://doi.org/10.3389/fmicb.2022.965053" },
  JPNATC_ACINETO: { inst: "AIIMS_DELHI", institution: "JPN Apex Trauma Centre, AIIMS New Delhi", short: "AIIMS Delhi trauma centre", city: "New Delhi", state: "Delhi", sector: "government", year: 2016, period: "2012 to 2016", doi: "10.4103/JLP.JLP_72_18", citation: "J Lab Physicians 2019", url: "https://doi.org/10.4103/JLP.JLP_72_18" },
  MGJAIPUR_BSI: { inst: "MGMCH_JAIPUR", institution: "Mahatma Gandhi Medical College and Hospital", short: "MG Jaipur", city: "Jaipur", state: "Rajasthan", sector: "private", year: 2023, period: "October 2022 to September 2023", doi: "10.25259/JLP_94_2024", citation: "J Lab Physicians 2024", url: "https://doi.org/10.25259/JLP_94_2024" },
  AIIMS_MEDWARDS: { inst: "AIIMS_DELHI", institution: "All India Institute of Medical Sciences, New Delhi (medicine wards and ICU)", short: "AIIMS Delhi medicine", city: "New Delhi", state: "Delhi", sector: "government", year: 2019, period: "2017 to 2019", doi: "10.1055/s-0040-1721161", citation: "J Lab Physicians 2020", url: "https://doi.org/10.1055/s-0040-1721161" },
  SRM_CARBA: { inst: "SRM_CHENNAI", institution: "SRM Medical College Hospital, Kattankulathur", short: "SRM Chennai", city: "Chennai", state: "Tamil Nadu", sector: "private", year: 2024, period: "July 2022 to July 2024", doi: "10.3389/fmed.2025.1571231", citation: "Front Med 2025", url: "https://doi.org/10.3389/fmed.2025.1571231" },
  JSS_KLEB: { inst: "JSS_MYSURU", institution: "JSS Medical College and Hospital", short: "JSS Mysuru", city: "Mysuru", state: "Karnataka", sector: "private", year: 2023, period: "2014 to 2023 (2023 figures)", citation: "Front Microbiol 2025 (PMC12209295)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC12209295/" },
  EASTPOINT: { inst: "EASTPOINT_BENGALURU", institution: "East Point Hospital and Research Center", short: "East Point Bengaluru", city: "Bengaluru", state: "Karnataka", sector: "private", year: 2022, period: "January to June 2022", doi: "10.7759/cureus.60542", citation: "Cureus 2024;16:e60542", url: "https://doi.org/10.7759/cureus.60542" },
  SAVEETHA_URO: { inst: "SAVEETHA_CHENNAI", institution: "Saveetha Medical College", short: "Saveetha Chennai", city: "Chennai", state: "Tamil Nadu", sector: "private", year: 2024, period: "2023 to 2024", doi: "10.7759/cureus.56632", citation: "Cureus 2024;16(3):e56632", url: "https://doi.org/10.7759/cureus.56632" },
  ANDHRA_UTI: { inst: "AMC_VIZAG", institution: "Andhra Medical College", short: "Andhra MC Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", sector: "government", year: 2023, period: "August 2022 to January 2023", citation: "Int J Curr Pharm Res 2024", url: null },
  KONASEEMA_GNB: { inst: "KIMS_AMALAPURAM", institution: "Konaseema Institute of Medical Sciences", short: "KIMS Amalapuram", city: "Amalapuram", state: "Andhra Pradesh", sector: "private", year: 2024, period: "June 2023 to July 2024", citation: "Bioinformation 2025;21(6):1475-1480", url: null },
  TARSNET: { inst: "TARSNET", institution: "Telangana AMR Surveillance Network (TARS-Net)", short: "TARS-Net Telangana", city: "Hyderabad", state: "Telangana", sector: "network", kind: "network", year: 2024, period: "2024", citation: "TARS-Net Annual Report 2024 (Osmania Medical College and NCDC; 13 sites)", url: null },
  KIMS_KLEB: { inst: "KIMS_BHUBANESWAR", institution: "Kalinga Institute of Medical Sciences", short: "KIMS Bhubaneswar", city: "Bhubaneswar", state: "Odisha", sector: "private", year: 2024, period: "October 2022 to September 2024", doi: "10.7759/cureus.94006", citation: "Cureus 2025", url: "https://doi.org/10.7759/cureus.94006" },
  KIMS_STERILE: { inst: "KIMS_BHUBANESWAR", institution: "Kalinga Institute of Medical Sciences", short: "KIMS Bhubaneswar", city: "Bhubaneswar", state: "Odisha", sector: "private", year: 2022, period: "January 2021 to December 2022", doi: "10.7759/cureus.104772", citation: "Cureus 2026;18(3):e104772", url: "https://doi.org/10.7759/cureus.104772" },
  ASSAM: { inst: "AMC_DIBRUGARH", institution: "Assam Medical College and Hospital", short: "Assam MC Dibrugarh", city: "Dibrugarh", state: "Assam", sector: "government", year: 2021, period: "October 2018 to March 2021", citation: "J Pure Appl Microbiol 2023", url: null },
  IGGMC: { inst: "IGGMC_NAGPUR", institution: "Indira Gandhi Government Medical College", short: "IGGMC Nagpur", city: "Nagpur", state: "Maharashtra", sector: "government", year: 2025, period: "May 2024 to April 2025", doi: "10.7759/cureus.100797", citation: "Cureus 2026", url: "https://doi.org/10.7759/cureus.100797" },
  ICMR_AMRSN_2023: { inst: "ICMR_AMRSN", institution: "ICMR Antimicrobial Resistance Surveillance and Research Network", short: "ICMR-AMRSN", city: null, state: null, region: "national", sector: "network", kind: "network", year: 2023, period: "January to December 2023", citation: "ICMR-AMRSN Annual Report 2023", url: null },
  ICMR_ESBL: { inst: "ICMR_ESBL", institution: "ICMR multicentric ESBL study (AIIMS Delhi, PGIMER, CMC Vellore, JIPMER)", short: "ICMR ESBL study", city: null, state: null, region: "national", sector: "network", kind: "network", year: 2016, period: "October 2014 to March 2016", doi: "10.4103/ijmr.IJMR_172_18", citation: "Indian J Med Res 2019;149:208-215", url: "https://doi.org/10.4103/ijmr.IJMR_172_18" }
};

function specOf(id, spec) {
  const s = String(spec || "").toLowerCase();
  if (id === "RML_ICU") return ["blood", "icu"];
  if (id === "SGRD_KLEB") return ["respiratory", "icu"];
  if (id === "KONASEEMA_GNB") return ["urine", "icu"];
  if (id === "KIMS_STERILE") return ["sterile", "all"];
  if (id === "DOON_CSOM") return ["pus", "all"];
  if (id === "AIIMS_MEDWARDS" || id === "JPNATC_ACINETO" || id === "EASTPOINT") return [/blood/.test(s) ? "blood" : "all", "inpatient"];
  if (/^blood/.test(s)) return ["blood", "all"];
  if (/^urine/.test(s)) return ["urine", "all"];
  if (/^pus/.test(s)) return ["pus", "all"];
  return ["all", "all"];
}

const raw = JSON.parse(readFileSync(join(ROOT, "data", "antibiogram-raw.json"), "utf8"));
const REGION = {};
raw.forEach((s) => { REGION[s.id] = s.region; });
let files = 0, rowsN = 0, cellsN = 0, excludedN = 0;
const out = {};
for (const st of raw) {
  const m = META[st.id]; if (!m) throw new Error("no META for " + st.id);
  for (const o of st.organisms || []) {
    // SGRD_KLEB carries two periods (2018 and 2022): one source per period.
    let id = st.id, year = m.year, period = m.period;
    if (st.id === "SGRD_KLEB") { const y = /2022/.test(o.year) ? 2022 : 2018; id = "SGRD_KLEB_" + y; year = y; period = o.year; }
    const src = out[id] || (out[id] = {
      id, kind: m.kind || "study", inst: m.inst, institution: m.institution, short: m.short, city: m.city, state: m.state,
      region: m.region || st.region, sector: m.sector, year, period, citation: m.citation, doi: m.doi || null, url: m.url || null,
      reporting: st.reporting === "R" ? "%R in the source, converted to %S" : "%S",
      verification: { status: "double-checked", note: "migrated from data/antibiogram-raw.json: extracted from the source PDF, then re-verified cell by cell by a second reader (2026)" },
      notes: String(st.extraction_notes || "").slice(0, 1200),
      issues: (st.verify_issues || []).map((x) => String(x).slice(0, 400)),
      rows: [], counts: [], excluded: []
    });
    const [spec, set] = specOf(st.id, o.specimen);
    const oc = R.canonOrg(o.name); if (!oc) throw new Error(st.id + ": organism " + o.name);
    let pheno = oc.pheno;
    if (st.id === "SRM_CARBA") pheno = "CR";                // carbapenem-resistant subset only
    const row = { spec, set, org: o.name, pheno, n: o.n != null ? o.n : null, specimen_as_printed: o.specimen, s: {} };
    const approx = [], q = {}, notes = {};
    for (const d of o.drugs || []) {
      if (NOT_A_DRUG[d.key]) { src.excluded.push({ org: o.name, drug: d.key, value: d.s, why: NOT_A_DRUG[d.key] }); excludedN++; continue; }
      const k = R.canonDrug(d.key); if (!k) throw new Error(st.id + ": drug " + d.key);
      if (d.note && SUSPECT.test(d.note)) { src.excluded.push({ org: o.name, drug: k, value: d.s, why: "flagged by the original verifier: " + d.note }); excludedN++; continue; }
      const has = d.s != null && !Number.isNaN(d.s);
      if (!has && !d.q) continue;
      if (has) { row.s[k] = Math.round(d.s * 10) / 10; cellsN++; }
      if (d.approx) approx.push(k);
      if (d.q) q[k] = d.q;
      if (d.note) notes[k] = d.note;
    }
    if (approx.length) row.approx = approx;
    if (Object.keys(q).length) row.q = q;
    if (Object.keys(notes).length) row.notes = notes;
    if (Object.keys(row.s).length || row.q) { src.rows.push(row); rowsN++; }
    if (o.n != null) src.counts.push({ spec, set, org: o.name, n: o.n });
  }
}

// GIMSR 2018 and the ICMR 2024 summary, from the object that used to live in app.js.
const legacy = JSON.parse(readFileSync(join(ROOT, "data", "antibiogram", "legacy-asp-abg.json"), "utf8"));
function fromLegacy(id, obj, meta, specSet) {
  const src = Object.assign({ id, rows: [], counts: [], excluded: [] }, meta);
  for (const [name, o] of Object.entries(obj.org)) {
    const oc = R.canonOrg(name); if (!oc) throw new Error(id + ": organism " + name);
    const row = { spec: specSet[0], set: specSet[1], org: name, pheno: oc.pheno, n: o.n != null ? o.n : null, s: {} };
    const q = {}, trend = {};
    if (o.q) row.note = o.q;
    for (const [dk, c] of Object.entries(o.d || {})) {
      const k = R.canonDrug(dk); if (!k) throw new Error(id + ": drug " + dk);
      if (typeof c.s === "number") { row.s[k] = c.s; cellsN++; }
      if (c.q) q[k] = c.q;
      if (c.trend) trend[k] = c.trend;
      if (c.approx) (row.approx = row.approx || []).push(k);
    }
    if (Object.keys(q).length) row.q = q;
    if (Object.keys(trend).length) row.trend = trend;
    if (Object.keys(row.s).length || row.q || row.note) { src.rows.push(row); rowsN++; }
    if (o.n != null) src.counts.push({ spec: specSet[0], set: specSet[1], org: name, n: o.n });
  }
  out[id] = src;
}
fromLegacy("GIMSR_2018", legacy.hospital, {
  kind: "study", inst: "GIMSR", institution: "GITAM Institute of Medical Sciences and Research", short: "GIMSR Visakhapatnam", city: "Visakhapatnam", state: "Andhra Pradesh", region: "south", sector: "private",
  year: 2018, period: "2018", citation: "Pilli HPK et al. JMSCR 2019;7(6):996-1006 (Table 2, urinary isolates, outpatients)", url: null, reporting: "%S",
  verification: { status: "transcribed", note: "typed into app.js from the paper; not re-verified in 2026" },
  notes: legacy.hospital.note || ""
}, ["urine", "opd"]);
fromLegacy("ICMR_AMRSN_2024_SUMMARY", legacy.national, {
  kind: "network", inst: "ICMR_AMRSN", institution: "ICMR Antimicrobial Resistance Surveillance and Research Network", short: "ICMR-AMRSN", city: null, state: null, region: "national", sector: "network",
  year: 2024, period: "January to December 2024", citation: "ICMR-AMRSN Annual Report 2024 (Table 2.1 and trend summary)", url: null, reporting: "%S",
  verification: { status: "transcribed", note: "typed into app.js from the report summary; isolate counts were not transcribed, so these rows are shown but never pooled" },
  notes: legacy.national.note || ""
}, ["all", "all"]);

for (const [id, src] of Object.entries(out)) {
  writeFileSync(join(OUT, id + ".json"), JSON.stringify(src, null, 1) + "\n");
  files++;
}
console.log(`migrated ${files} sources, ${rowsN} rows, ${cellsN} cells; ${excludedN} cells excluded with reasons`);
