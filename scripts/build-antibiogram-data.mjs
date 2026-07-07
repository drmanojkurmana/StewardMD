#!/usr/bin/env node
/* Build antibiogram-data.js from the VERIFIED extraction (data/antibiogram-raw.json).
 *
 * Provenance chain: 20 downloaded study PDFs → a per-PDF extraction agent read the actual
 * tables → a second agent adversarially re-read each PDF and confirmed every cell (0
 * corrections) → data/antibiogram-raw.json. This script transforms that verified JSON into
 * the ASP_ABG-shaped study records + regional best-of composites the app consumes. No values
 * are hand-transcribed here (transcription is where clinical errors creep in).
 *
 * Run: node scripts/build-antibiogram-data.mjs   → writes antibiogram-data.js
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'antibiogram-raw.json');
const OUT = join(ROOT, 'antibiogram-data.js');

// Per-study metadata (city / representative end-year / source citation) from INDEX.csv.
// year drives the recency tie-break in composite ranking.
const META = {
  RML_ICU:        { city: 'Lucknow',        year: 2023, source: 'RML Institute of Medical Sciences, Lucknow — ICU blood cultures · Cureus 2024 (10.7759/cureus.57356)' },
  DOON_CSOM:      { city: 'Dehradun',       year: 2024, source: 'Govt Doon Medical College, Dehradun — CSOM ear discharge · Cureus 2024 (PMC11483178)' },
  SGRD_KLEB:      { city: 'Amritsar',       year: 2022, source: 'SGRD Institute of Medical Sciences, Amritsar — Klebsiella VAP · Cureus 2023 (PMC10106535)' },
  HAYES_URO:      { city: 'Prayagraj',      year: 2019, source: 'Hayes Memorial Mission Hospital, Prayagraj — uropathogens · Front. Microbiol. 2022 (10.3389/fmicb.2022.965053)' },
  JPNATC_ACINETO: { city: 'New Delhi',      year: 2016, source: 'JPN Apex Trauma Centre, AIIMS Delhi — Acinetobacter surveillance · J. Lab. Physicians 2019 (10.4103/JLP.JLP_72_18)' },
  MGJAIPUR_BSI:   { city: 'Jaipur',         year: 2023, source: 'Mahatma Gandhi Medical College, Jaipur — bloodstream infections · J. Lab. Physicians 2024 (10.25259/JLP_94_2024)' },
  AIIMS_MEDWARDS: { city: 'New Delhi',      year: 2019, source: 'AIIMS New Delhi (medicine wards & ICU) · J. Lab. Physicians 2020 (10.1055/s-0040-1721161)' },
  SRM_CARBA:      { city: 'Chennai',        year: 2024, source: 'SRM Medical College, Kattankulathur — carbapenem resistance in GNB · Front. Med. 2025 (10.3389/fmed.2025.1571231)' },
  JSS_KLEB:       { city: 'Mysuru',         year: 2023, source: 'JSS Medical College, Mysuru — 10-yr Klebsiella · Front. Microbiol. 2025 (PMC12209295)' },
  EASTPOINT:      { city: 'Bengaluru',      year: 2022, source: 'East Point Hospital & Research Center, Bengaluru — full antibiogram · Cureus 2024 (10.7759/cureus.60542)' },
  SAVEETHA_URO:   { city: 'Chennai',        year: 2024, source: 'Saveetha Medical College, Chennai — E. coli UTI · Cureus 2024 (10.7759/cureus.56632)' },
  ANDHRA_UTI:     { city: 'Visakhapatnam',  year: 2023, source: 'Andhra Medical College, Visakhapatnam — UTI GNB · Int. J. Curr. Pharm. Sci. 2024' },
  KONASEEMA_GNB:  { city: 'Amalapuram',     year: 2024, source: 'Konaseema Institute of Medical Sciences, Amalapuram — GNB · Bioinformation 2025' },
  TARSNET:        { city: 'Telangana',      year: 2024, source: 'TARS-Net Telangana Annual Report 2024 (Osmania MC / NCDC) — 13 sites, 16,274 isolates' },
  KIMS_KLEB:      { city: 'Bhubaneswar',    year: 2024, source: 'KIMS Bhubaneswar — Klebsiella (7,942 isolates) · Cureus 2025 (10.7759/cureus.94006)' },
  KIMS_STERILE:   { city: 'Bhubaneswar',    year: 2022, source: 'KIMS Bhubaneswar — sterile body fluids · Cureus 2026 (10.7759/cureus.104772)' },
  ASSAM:          { city: 'Dibrugarh',      year: 2021, source: 'Assam Medical College, Dibrugarh — institution-wide · J. Pure Appl. Microbiol. 2023' },
  IGGMC:          { city: 'Nagpur',         year: 2025, source: 'Indira Gandhi Govt Medical College, Nagpur — full antibiogram · Cureus 2026 (10.7759/cureus.100797)' },
  ICMR_AMRSN_2023:{ city: 'All-India',      year: 2023, source: 'ICMR-AMRSN Annual Report 2023 — ~99,492 isolates, ~30 tertiary sites' },
  ICMR_ESBL:      { city: 'All-India',      year: 2016, source: 'ICMR multicentric ESBL study · Indian J. Med. Res. 2019 (10.4103/ijmr.IJMR_172_18)' },
};

const raw = JSON.parse(readFileSync(RAW, 'utf8'));

// Apply any verify corrections onto the extraction cells (future-proof; 0 in this run).
function applyCorrections(study) {
  const corr = study.corrections || [];
  if (!corr.length) return;
  for (const c of corr) {
    const org = (study.organisms || []).find((o) => o.name === c.organism);
    if (!org) continue;
    const d = (org.drugs || []).find((x) => x.key === c.key);
    if (d) { d.s = c.correct_s; if (c.from_R != null) d.from_R = c.from_R; d._corrected = true; }
  }
}

// A cell the verify/extract agent flagged as unreliable (e.g. TARS-Net's internally
// inconsistent E. coli urine column) is NEVER included — safety invariant.
const SUSPECT = /suspect|implausib|source error|data.?entry|inverted|caution|questionable/i;

// Intrinsic-resistance safety filter (CLSI M100 intrinsic-resistance tables): drop
// biologically-impossible organism×drug combinations so the app can never show, e.g.,
// "E. coli linezolid susceptible" or "Enterococcus cephalosporin". Some source tables print
// a combined organism×drug matrix and spill gram-positive-only agents onto gram-negatives.
const GPC_RE = /staphylococc|enterococc|streptococc/i;
const GNB_RE = /escherichia|klebsiella|pseudomonas|acinetobacter|proteus|enterobacter|citrobacter|salmonella|serratia|morganella|providencia|shigella|haemophilus/i;
const GP_ONLY = new Set(['vancomycin', 'teicoplanin', 'linezolid', 'daptomycin', 'clindamycin', 'cloxacillin', 'oxacillin', 'penicillin', 'erythromycin', 'cefoxitin']); // no reliable Gram-negative activity
const GN_ONLY = new Set(['aztreonam', 'colistin', 'polymyxin', 'nalidixic', 'temocillin']); // no Gram-positive activity
const isCeph = (k) => /^cef|^ceph/.test(String(k));
function intrinsicImpossible(org, key) {
  const gpc = GPC_RE.test(org), gnb = GNB_RE.test(org), ent = /enterococc/i.test(org);
  if (gnb && GP_ONLY.has(key)) return true;                                   // GP-only drug on a GNB (incl. cefoxitin = MRSA surrogate)
  if (gpc && GN_ONLY.has(key)) return true;                                   // GN-only drug on a GPC
  if (ent && (isCeph(key) || key === 'cotrimoxazole' || key === 'clindamycin' || key === 'aztreonam')) return true; // enterococci: intrinsic ceph/aztreonam R; TMP-SMX unreliable in vivo
  return false;
  // NOTE: cefoxitin is KEPT for S. aureus (GPC, not GNB) — it's the methicillin/MRSA surrogate.
}
// Specimen representativeness for a general antibiogram backdrop (blood/sterile is the benchmark).
function specPriority(spec) {
  const s = String(spec || '').toLowerCase();
  if (/blood|sterile|csf|body fluid|bacter?emia/.test(s)) return 5;
  if (s === '' || /all|clinical|various|mixed|overall|any/.test(s)) return 4;
  if (/resp|sputum|endotrach|\bbal\b|pus|wound|tissue|aspirate|discharge|ear/.test(s)) return 3;
  if (/urine|uti|urinary/.test(s)) return 2;
  return 1;
}

const records = [];
let totalCells = 0, dropped = 0, suspectSkipped = 0, intrinsicSkipped = 0;
for (const st of raw) {
  applyCorrections(st);
  const meta = META[st.id] || {};
  const org = {};
  // Group same-named organism entries (a study may report one organism across several
  // specimens/periods) and merge them: highest-priority specimen wins each drug; lower
  // ones only fill gaps. This fixes the clobber where urine overwrote blood.
  const groups = {};
  for (const o of st.organisms || []) (groups[o.name] = groups[o.name] || []).push(o);
  for (const name of Object.keys(groups)) {
    const entries = groups[name].slice().sort((a, b) =>
      specPriority(b.specimen) - specPriority(a.specimen) ||
      (b.drugs || []).length - (a.drugs || []).length);
    const d = {};
    let n = null, specimen = null;
    for (const e of entries) {
      if (n == null && e.n != null) { n = e.n; specimen = e.specimen || null; }
      for (const drug of e.drugs || []) {
        if (drug.note && SUSPECT.test(drug.note)) { suspectSkipped++; continue; }  // exclude flagged-unreliable
        if (intrinsicImpossible(name, drug.key)) { intrinsicSkipped++; continue; } // exclude intrinsic-resistance-impossible
        const hasNum = drug.s != null && !Number.isNaN(drug.s);
        if (!hasNum && !drug.q) continue;               // no usable value → omit (renders "—")
        if (d[drug.key]) continue;                      // a higher-priority specimen already filled this drug
        const cell = {};
        if (hasNum) cell.s = Math.round(drug.s * 10) / 10;  // keep ≤1 dp
        if (drug.approx) cell.approx = true;
        if (drug.q) cell.q = drug.q;
        d[drug.key] = cell;
        totalCells++;
      }
    }
    if (!Object.keys(d).length) { dropped++; continue; } // organism with no usable cells → skip
    org[name] = { ...(n != null ? { n } : {}), ...(specimen ? { specimen } : {}), d };
  }
  records.push({
    id: st.id, label: st.label, region: st.region, city: meta.city || null,
    year: meta.year || null, credibility: st.cred, source: meta.source || st.label, org,
  });
}

// Emit compact-but-readable JS. ABG_STUDIES as pretty JSON; logic is static below.
const studiesJson = JSON.stringify(records, null, 1);
const nStudies = records.length;
const withCells = records.filter((r) => Object.keys(r.org).length).length;

const file = `/* StewardMD — Regional antibiogram data (study records + best-of regional composites).
 * ===========================================================================
 * GENERATED by scripts/build-antibiogram-data.mjs from data/antibiogram-raw.json —
 * do not hand-edit; re-run the generator. Provenance: ${nStudies} Indian antibiogram
 * studies (downloaded PDFs), each extracted from the actual susceptibility tables and
 * then adversarially re-verified cell-by-cell against the source (0 corrections).
 *
 * Every value is % SUSCEPTIBLE (0–100); %R sources were converted s = 100 − R at
 * extraction. Missing cells are simply absent (the UI renders "—"). No values invented.
 *
 * CREDIBILITY RANKING (lower = more authoritative; drives composite selection):
 *   1  state/national AMR surveillance networks (TARS-Net 2024, ICMR-AMRSN)
 *   2  large recent (≥2022) multicentre or high-n full-panel single-centre studies
 *   3  narrow single-organism / single-syndrome / pre-2021 (fallback only)
 * Tie-break: more recent 'year' wins.
 *
 * Load order: AFTER app.js (for window.ASP_ABG.national fallback), BEFORE policy.js.
 * Exposes: window.ABG_STUDIES, window.buildComposite(region), window.REGION_ABG,
 *          window.ABG_DATA = { studies, buildComposite, region, getStudy }.
 * ======================================================================== */
(function () {
  "use strict";

  var ABG_STUDIES = ${studiesJson};

  // Build a region's best-of composite: studies ranked by credibility then recency; for each
  // organism/drug the first (most-credible) study that reports it wins, later studies fill gaps.
  // Every filled cell records its provenance in .src (the contributing study id).
  function buildComposite(region) {
    var studies = ABG_STUDIES.filter(function (s) { return s.region === region && s.org && Object.keys(s.org).length; })
      .slice().sort(function (a, b) { return (a.credibility - b.credibility) || ((b.year || 0) - (a.year || 0)); });
    var out = { region: region, composite: true, source: "", note: "Best-of regional composite — each organism/drug taken from the most-credible source in this region that reports it.", org: {} };
    var contrib = [];
    studies.forEach(function (st) {
      var used = false, orgs = st.org || {};
      Object.keys(orgs).forEach(function (name) {
        var so = orgs[name];
        var dst = out.org[name] || (out.org[name] = { n: null, specimen: null, d: {} });
        if (dst.n == null && so.n != null) { dst.n = so.n; dst.specimen = so.specimen || null; dst.nsrc = st.id; }
        var dd = so.d || {};
        Object.keys(dd).forEach(function (k) {
          if (dst.d[k]) return;                       // a higher-credibility study already filled this cell
          var cell = dd[k];
          if (cell.s == null && !cell.q) return;
          var nc = { src: st.id };
          if (cell.s != null) nc.s = cell.s;
          if (cell.approx) nc.approx = true;
          if (cell.q) nc.q = cell.q;
          dst.d[k] = nc; used = true;
        });
      });
      if (used) contrib.push(st.id);
    });
    out.sources = contrib;
    out.source = "Regional best-of composite · sources: " + contrib.join(", ");
    return out;
  }

  var REGION_ABG = { south: buildComposite("south"), north: buildComposite("north"), east: buildComposite("east"), west: buildComposite("west") };
  var STUDY_BY_ID = {}; ABG_STUDIES.forEach(function (s) { STUDY_BY_ID[s.id] = s; });

  window.ABG_STUDIES = ABG_STUDIES;
  window.buildComposite = buildComposite;
  window.REGION_ABG = REGION_ABG;
  window.ABG_DATA = { studies: ABG_STUDIES, buildComposite: buildComposite, region: REGION_ABG, getStudy: function (id) { return STUDY_BY_ID[id] || null; } };
})();
`;

writeFileSync(OUT, file);
console.log(`✓ ${OUT}`);
console.log(`  studies: ${nStudies} (${withCells} with data cells), total cells: ${totalCells}, dropped empty organisms: ${dropped}, suspect cells excluded: ${suspectSkipped}, intrinsic-R cells excluded: ${intrinsicSkipped}`);
