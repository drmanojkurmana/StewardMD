#!/usr/bin/env node
/* StewardMD - build the antibiogram bundle.
 *
 * Reads   data/antibiogram/sources/<ID>.json   one file per source (an institution's yearly
 *                                              antibiogram, a network report, or a study)
 *         data/antibiogram/register.json       the census: every Indian antibiogram found,
 *                                              integrated or not, with the reason
 * Writes  kb/antibiogram/antibiogram.json      the bundle the app fetches (compact)
 *         antibiogram-data.js                  source metadata the app needs at start-up
 *                                              (profile lists) + the bundle version
 *         data/antibiogram/validation-report.json   every rule action, cell by cell
 * and syncs the ?v= tokens of antibiogram-data.js, antibiogram-rules.js and
 * antibiogram-store.js in index.html.
 *
 * Every row goes through antibiogram-rules.js validateRow (intrinsic resistance, specimen
 * appropriateness, staphylococcal phenotype consistency, paired-agent agreement, arithmetic
 * against n, CLSI M39 low-n). Nothing is dropped silently: each cell keeps its action and
 * reason and the app shows them. Derived rows (marked derived) are added where a source splits
 * a group: S. aureus from MRSA + MSSA rows, "all settings" from ward/OPD/ICU rows, "all
 * inpatients" from ward + ICU rows. They are isolate-weighted and never replace a printed row.
 *
 * Source schema (unknown keys fail):
 *   id (= file name), kind institution|network|study, inst, institution, short, city, state,
 *   region north|south|east|west|national, sector government|private|network, year, end? (YYYY-MM,
 *   last month of the data period; orders half-yearly editions), period,
 *   published?, url?, page?, doi?, retrieved?, citation, reporting, method?, measure? (S|R),
 *   verification {status double-checked|single-checked|transcribed, note}, notes?, issues?,
 *   rows [{spec, set, org, pheno?, n, page?, s:{drug:%S} or r:{drug:%R}, nt?, approx?, q?,
 *          trend?, notes?, printed?, note?, specimen_as_printed?, table?, cohort?}],
 *   Reports that print % resistant (NARS-Net, state networks) give r:{} (or measure "R" with
 *   s:{} holding %R); the build stores 100 - %R and marks the cell (intermediate results then
 *   count as susceptible, which the app says).
 *   counts [{spec, set, org, n, page?}], excluded [{org?, drug?, value?, why}]
 *
 * Usage:
 *   node scripts/build-antibiogram.mjs            build
 *   node scripts/build-antibiogram.mjs --check    validate and fail if outputs are stale
 *   node scripts/build-antibiogram.mjs --validate validate only, never writes
 *   node scripts/build-antibiogram.mjs --file <path.json>   check one source file (extraction)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const R = require("../antibiogram-rules.js");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "data", "antibiogram", "sources");
const REGISTER = join(ROOT, "data", "antibiogram", "register.json");
const CENSUS_SUM = join(ROOT, "data", "antibiogram", "census", "summary.json");
const OUT_DIR = join(ROOT, "kb", "antibiogram");
const OUT = join(OUT_DIR, "antibiogram.json");
const INDEX_JS = join(ROOT, "antibiogram-data.js");
const REPORT = join(ROOT, "data", "antibiogram", "validation-report.json");
const HTML = join(ROOT, "index.html");
const STORE_JS = join(ROOT, "antibiogram-store.js");
const RULES_JS = join(ROOT, "antibiogram-rules.js");

const TOP = ["id", "kind", "inst", "institution", "short", "city", "state", "region", "sector", "year", "end", "period", "published", "url", "page", "doi", "retrieved", "citation", "reporting", "method", "measure", "verification", "notes", "issues", "rows", "counts", "excluded", "credibility", "file", "pages"];
const ROWK = ["spec", "set", "org", "pheno", "n", "page", "s", "r", "nt", "approx", "q", "trend", "notes", "printed", "note", "specimen_as_printed", "table", "cohort"];
const KINDS = ["institution", "network", "study"], REGIONS = ["north", "south", "east", "west", "national"], SECTORS = ["government", "private", "network"];
const VSTAT = ["double-checked", "single-checked", "transcribed"];
const ACT = { keep: "k", intrinsic: "i", hide: "h", suppress: "x", caution: "c" };
const BETA = ["penicillin", "ampicillin", "amoxicillin", "oxacillin", "cloxacillin", "amoxiclav", "ampsulbactam", "piperacillin", "piptazo", "cefazolin", "cephalexin", "cefuroxime", "cefoxitin", "cefotaxime", "ceftriaxone", "ceftazidime", "cefepime", "cefixime", "cefpodoxime", "cefoperazone", "cefoperazone_sulbactam", "ertapenem", "imipenem", "meropenem", "doripenem"];

export function validateSource(src, file) {
  const e = [], tag = file || src.id;
  Object.keys(src).forEach((k) => { if (!TOP.includes(k)) e.push(`${tag}: unknown key "${k}"`); });
  if (file && src.id + ".json" !== file) e.push(`${tag}: id "${src.id}" does not match the file name`);
  ["id", "kind", "inst", "institution", "short", "region", "sector", "year", "citation"].forEach((k) => { if (src[k] == null || src[k] === "") e.push(`${tag}: missing ${k}`); });
  if (!KINDS.includes(src.kind)) e.push(`${tag}: kind must be one of ${KINDS.join(", ")}`);
  if (!REGIONS.includes(src.region)) e.push(`${tag}: region must be one of ${REGIONS.join(", ")}`);
  if (!SECTORS.includes(src.sector)) e.push(`${tag}: sector must be one of ${SECTORS.join(", ")}`);
  if (!(Number.isInteger(src.year) && src.year >= 2005 && src.year <= 2030)) e.push(`${tag}: year must be an integer 2005 to 2030`);
  if (src.measure != null && !["S", "R"].includes(src.measure)) e.push(`${tag}: measure must be "S" or "R"`);
  if (src.end != null && !(/^\d{4}-(0[1-9]|1[0-2])$/.test(src.end) && +src.end.slice(0, 4) === src.year)) e.push(`${tag}: end must be "YYYY-MM" in the data year`);
  if (!src.verification || !VSTAT.includes(src.verification.status)) e.push(`${tag}: verification.status must be one of ${VSTAT.join(", ")}`);
  if (!Array.isArray(src.rows)) e.push(`${tag}: rows must be an array`);
  (src.rows || []).forEach((r, i) => {
    const t = `${tag} row ${i + 1} (${r.org})`;
    Object.keys(r).forEach((k) => { if (!ROWK.includes(k)) e.push(`${t}: unknown key "${k}"`); });
    if (!R.SPECIMENS[r.spec]) e.push(`${t}: specimen "${r.spec}" unknown`);
    if (!R.SETTINGS[r.set]) e.push(`${t}: setting "${r.set}" unknown`);
    if (!R.canonOrg(r.org)) e.push(`${t}: organism "${r.org}" not in antibiogram-rules.js`);
    if (r.n != null && !(Number.isInteger(r.n) && r.n > 0)) e.push(`${t}: n must be a positive integer or null`);
    if (r.s && r.r) e.push(`${t}: give s (% susceptible) or r (% resistant), not both`);
    const vals = r.r || r.s || {};
    Object.keys(vals).forEach((d) => {
      if (!R.DRUGS[d]) e.push(`${t}: drug key "${d}" is not canonical`);
      const v = vals[d]; if (typeof v !== "number" || v < 0 || v > 100) e.push(`${t}: ${d} = ${v} is not 0 to 100`);
    });
    (r.approx || []).forEach((d) => { if (vals[d] == null) e.push(`${t}: approx lists ${d} with no value`); });
    if (r.cohort != null && !["hai"].includes(r.cohort)) e.push(`${t}: cohort must be "hai" when given`);
    Object.keys(r.trend || {}).forEach((d) => {
      if (!R.DRUGS[d]) e.push(`${t}: trend drug key "${d}" is not canonical`);
      const tr = r.trend[d]; if (!Array.isArray(tr) || tr.some((p) => !Array.isArray(p) || !Number.isInteger(p[0]) || typeof p[1] !== "number" || p[1] < 0 || p[1] > 100)) e.push(`${t}: trend.${d} must be [[year, %], ...]`);
    });
    Object.keys(r.nt || {}).forEach((d) => { if (!Number.isInteger(r.nt[d]) || r.nt[d] < 1) e.push(`${t}: nt.${d} must be a positive integer`); });
  });
  (src.counts || []).forEach((c, i) => {
    if (!R.SPECIMENS[c.spec] || !R.SETTINGS[c.set]) e.push(`${tag} count ${i + 1}: bad specimen or setting`);
    if (!R.canonOrg(c.org)) e.push(`${tag} count ${i + 1}: organism "${c.org}" not in antibiogram-rules.js`);
    if (!(Number.isInteger(c.n) && c.n >= 0)) e.push(`${tag} count ${i + 1}: n must be an integer`);
  });
  const seen = {};
  (src.rows || []).forEach((r) => { const o = R.canonOrg(r.org); const k = [r.spec, r.set, o && o.key, (r.pheno || (o && o.pheno) || "")].join("|"); if (seen[k]) e.push(`${tag}: duplicate row ${k}`); seen[k] = 1; });
  return e;
}

/* Validated row with canonical organism and cell actions. */
export function checkRow(src, r) {
  const o = R.canonOrg(r.org);
  const pheno = r.pheno || o.pheno || null;
  // % resistant (r:{}, or s:{} under measure "R") becomes 100 - %R ("not resistant").
  const isR = !!r.r || src.measure === "R";
  const raw = r.r || r.s || {}, s = {};
  Object.keys(raw).forEach((d) => { s[d] = isR ? Math.round(10 * (100 - raw[d])) / 10 : raw[d]; });
  let trend = r.trend || null;
  if (trend && isR) { trend = {}; Object.keys(r.trend).forEach((d) => { trend[d] = r.trend[d].map((p) => [p[0], Math.round(10 * (100 - p[1])) / 10]); }); }
  const v = R.validateRow({ org: o.key, pheno, spec: r.spec, set: r.set, n: r.n, s, nt: r.nt || {}, approx: r.approx || [] });
  return { src: src.id, inst: src.inst, year: src.year, spec: r.spec, set: r.set, org: o.key, orgAs: r.org, pheno, n: r.n == null ? null : r.n,
    cells: v.cells, flags: v.flags, q: r.q || null, trend, notes: r.notes || null, page: r.page || null, derived: null,
    measure: isR ? "R" : "S", table: r.table || null, cohort: r.cohort || null, note: r.note || null };
}

/* Isolate-weighted combination of rows (same source, same organism). A drug counts only the
 * isolates of the parts that report it (nt = tested). Parts whose cell is not "keep" are left
 * out; if any part marks the drug intrinsic, the result is intrinsic. MRSA/MR rows count as 0%
 * susceptible to beta-lactams (resistant by definition). */
function combine(parts, spec, set, pheno, how) {
  const base = parts[0], n = parts.reduce((a, p) => a + (p.n || 0), 0);
  if (!(n > 0) || parts.some((p) => !(p.n > 0))) return null;
  const drugs = new Set(); parts.forEach((p) => Object.keys(p.cells).forEach((d) => drugs.add(d)));
  const cells = {};
  drugs.forEach((d) => {
    let sw = 0, w = 0, intrinsic = null;
    for (const p of parts) {
      const c = p.cells[d];
      if (c && c.act === "intrinsic") { intrinsic = c; continue; }
      if ((p.pheno === "MRSA" || p.pheno === "MR") && BETA.includes(d)) { w += p.n; continue; }
      if (!c || c.act !== "keep") continue;
      const ww = c.nt != null ? c.nt : p.n; sw += c.s * ww; w += ww;
    }
    if (intrinsic) { cells[d] = { s: intrinsic.s, nt: null, act: "intrinsic", why: intrinsic.why }; return; }
    if (!w) return;
    cells[d] = { s: Math.round(10 * sw / w) / 10, nt: w, act: "keep", why: null };
  });
  // Methicillin resistance from MRSA/MSSA row counts.
  if (parts.some((p) => p.pheno === "MRSA" || p.pheno === "MR") && parts.some((p) => p.pheno === "MSSA" || p.pheno === "MS")) {
    const mr = parts.filter((p) => p.pheno === "MRSA" || p.pheno === "MR").reduce((a, p) => a + p.n, 0);
    cells.cefoxitin = { s: Math.round(1000 * (n - mr) / n) / 10, nt: n, act: "keep", why: null };
  }
  const out = { src: base.src, inst: base.inst, year: base.year, spec, set, org: base.org, orgAs: base.orgAs, pheno, n, cells, flags: [], q: null, trend: null, notes: null, page: null, derived: how,
    measure: parts.some((p) => p.measure === "R") ? "R" : "S", table: null, cohort: parts.every((p) => p.cohort === "hai") ? "hai" : null, note: null };
  if (n < R.M39_MIN) out.flags.push("lowN");
  return out;
}

/* Isolate counts a source printed (its organism tables), by specimen, setting and organism.
 * "all" and "inpatient" are summed from the ward/OPD/ICU counts when not printed. */
function countIndex(src) {
  const m = {}, sets = {};
  (src.counts || []).forEach((c) => {
    const o = R.canonOrg(c.org); if (!o) return;
    const k = c.spec + "|" + c.set + "|" + o.key; m[k] = (m[k] || 0) + c.n;
    (sets[c.spec] ||= new Set()).add(c.set);
  });
  return function countOf(spec, set, org) {
    const k = spec + "|" + set + "|" + org; if (m[k] != null) return m[k];
    const reported = sets[spec]; if (!reported) return null;
    const parts = set === "all" ? ["ward", "opd", "icu"] : set === "inpatient" ? ["ward", "icu"] : null;
    if (!parts) return null;
    const have = parts.filter((s) => reported.has(s)); if (!have.length) return null;
    // An organism missing from every column was not counted at all (e.g. the table lists the
    // genus, the antibiogram the species): unknown, not zero.
    if (!have.some((s) => m[spec + "|" + s + "|" + org] != null)) return null;
    return have.reduce((a, s) => a + (m[spec + "|" + s + "|" + org] || 0), 0);
  };
}

/* Derived rows. A combination is made only when it is complete: every setting (or specimen)
 * the source reports is present for the organism, or the source's own counts show it had no
 * isolates there, or the isolates left out are under 10% of the total (and the row says so).
 * Otherwise the partial figure would misstate the whole (e.g. an "all settings" S. aureus row
 * missing the ICU, where every isolate was MRSA). */
export function derive(allRows, src) {
  const out = [];
  // Surveillance cohorts (ICU device-associated infections) are not a sample of the ward or
  // hospital, so they are never combined with other rows.
  const rows = allRows.filter((r) => !r.cohort);
  const countOf = countIndex(src || {});
  const key = (r, ...f) => f.map((x) => r[x] == null ? "" : r[x]).join("|");
  const has = (list, r, spec, set, pheno) => list.some((x) => x.src === r.src && x.org === r.org && x.spec === spec && x.set === set && (x.pheno || null) === (pheno || null));
  const isMR = (p) => p === "MRSA" || p === "MR", isMS = (p) => p === "MSSA" || p === "MS";
  // Isolates of an organism (or phenotype) a source had in a stratum it printed no row for:
  // 0 when its counts say none, a number when they say some, null when unknown.
  function missingN(list, g0, spec, set) {
    const c = countOf(spec, set, g0.org); if (c == null) return null;
    if (!g0.pheno) return c;
    const others = list.filter((x) => x.src === g0.src && x.org === g0.org && x.spec === spec && x.set === set && x.pheno && x.pheno !== g0.pheno).reduce((a, x) => a + (x.n || 0), 0);
    return Math.max(0, c - others);
  }
  const LBL = { ward: "ward", opd: "OPD", icu: "ICU", inpatient: "inpatient" };
  function joinWords(a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; }
  /* Combine present parts if the missing ones are known to be empty or small. */
  function complete(list, g0, present, missing, dim, spec, set, label) {
    let zero = [], small = [], lost = 0;
    for (const m of missing) {
      const n = dim === "set" ? missingN(list, g0, spec, m) : missingN(list, g0, m, set);
      if (n == null) return null;
      if (n === 0) zero.push(m); else { small.push(m); lost += n; }
    }
    const have = present.reduce((a, p) => a + (p.n || 0), 0);
    if (present.length + zero.length < 2) return null;
    if (lost > 0.1 * (have + lost)) return null;
    let how = joinWords(present.map(label)) + " rows";
    if (zero.length) how += " (no " + joinWords(zero.map(label)) + " isolates)";
    if (small.length) how += " (" + joinWords(small.map(label)) + ": " + lost + " isolates not reported, under 10%)";
    return how;
  }
  // 1. S. aureus / CoNS overall from MRSA + MSSA (same source, specimen, setting). With one
  //    phenotype printed, the other counts as absent only if the organism counts agree.
  const staph = {};
  rows.filter((r) => (r.org === "saureus" || r.org === "cons") && r.pheno).forEach((r) => { (staph[key(r, "src", "spec", "set", "org")] ||= []).push(r); });
  Object.values(staph).forEach((g) => {
    const g0 = g[0];
    if (has(rows, g0, g0.spec, g0.set, null)) return;
    const mr = g.some((r) => isMR(r.pheno)), ms = g.some((r) => isMS(r.pheno));
    if (mr && ms) { const c = combine(g, g0.spec, g0.set, null, "MRSA and MSSA rows"); if (c) out.push(c); return; }
    const total = countOf(g0.spec, g0.set, g0.org), n = g.reduce((a, r) => a + (r.n || 0), 0);
    if (total == null || total !== n || !(n > 0)) return;
    const c = combine(g, g0.spec, g0.set, null, mr ? "MRSA rows (no MSSA isolates)" : "MSSA rows (no MRSA isolates)");
    if (!c) return;
    c.cells.cefoxitin = { s: mr ? 0 : 100, nt: n, act: "keep", why: null };
    out.push(c);
  });
  // 2. "All settings" and "all inpatients" from ward / OPD / ICU rows.
  let all = rows.concat(out);
  // Settings the source reports for a specimen: from its rows and from its count tables (a
  // setting that only appears in the counts still has isolates the rows may be missing).
  const srcSets = {};
  all.forEach((r) => { if (["ward", "opd", "icu"].includes(r.set)) (srcSets[r.spec] ||= new Set()).add(r.set); });
  ((src && src.counts) || []).forEach((c) => { if (["ward", "opd", "icu"].includes(c.set) && c.n > 0) (srcSets[c.spec] ||= new Set()).add(c.set); });
  const grp = {};
  all.forEach((r) => { (grp[key(r, "src", "spec", "org", "pheno")] ||= []).push(r); });
  Object.values(grp).forEach((g) => {
    const g0 = g[0], by = {}; g.forEach((r) => { by[r.set] = r; });
    const reported = Array.from(srcSets[g0.spec] || []);
    const present = ["ward", "opd", "icu"].filter((s) => by[s]);
    if (!by.all) {
      let parts = present.map((s) => by[s]), missing = reported.filter((s) => !by[s]);
      if (by.inpatient && !by.ward && !by.icu) { parts = [by.inpatient].concat(by.opd ? [by.opd] : []); missing = reported.filter((s) => s === "opd" && !by.opd); }
      const how = parts.length ? complete(all, g0, parts, missing, "set", g0.spec, null, (p) => LBL[p.set || p] || p) : null;
      if (how) { const c = combine(parts, g0.spec, "all", g0.pheno, how); if (c) out.push(c); }
    }
    if (!by.inpatient && (by.ward || by.icu) && reported.some((s) => s === "ward" || s === "icu")) {
      const parts = ["ward", "icu"].filter((s) => by[s]).map((s) => by[s]), missing = ["ward", "icu"].filter((s) => !by[s] && reported.includes(s));
      const how = complete(all, g0, parts, missing, "set", g0.spec, null, (p) => LBL[p.set || p] || p);
      if (how) { const c = combine(parts, g0.spec, "inpatient", g0.pheno, how); if (c) out.push(c); }
    }
  });
  // 3. "All specimens" from the specimen rows of the same setting (a hospital-wide view). The
  //    parts must not overlap: a source that prints "all specimens except urine" is combined
  //    with its urine rows only (its blood or pus rows are already inside that figure).
  all = rows.concat(out);
  const srcSpecs = {};
  all.forEach((r) => { if (r.spec !== "all") (srcSpecs[r.set] ||= new Set()).add(r.spec); });
  ((src && src.counts) || []).forEach((c) => { if (c.spec !== "all" && c.n > 0) (srcSpecs[c.set] ||= new Set()).add(c.spec); });
  const g2 = {};
  all.forEach((r) => { if (r.spec !== "all") (g2[key(r, "src", "set", "org", "pheno")] ||= []).push(r); });
  Object.values(g2).forEach((g) => {
    const g0 = g[0];
    if (has(all, g0, "all", g0.set, g0.pheno)) return;
    const reported = Array.from(srcSpecs[g0.set] || []);
    const split = reported.includes("nonurine");
    const parts = split ? g.filter((r) => r.spec === "nonurine" || r.spec === "urine") : g;
    const missing = (split ? ["nonurine", "urine"].filter((sp) => reported.includes(sp)) : reported).filter((sp) => !parts.some((r) => r.spec === sp));
    const how = complete(all, g0, parts, missing, "spec", null, g0.set, (p) => (R.SPECIMENS[p.spec || p] || {}).label || p);
    if (how) { const c = combine(parts, "all", g0.set, g0.pheno, how); if (c) out.push(c); }
  });
  return out;
}

/* Rows against the source's own organism counts: a row whose isolate number differs from the
 * count table (or MRSA + MSSA rows that do not add up to the S. aureus count) is reported. */
export function countChecks(src, checked) {
  const out = [];
  if (!(src.counts || []).length) return out;
  const countOf = countIndex(src);
  const grp = {};
  checked.forEach((r) => { if (r.n != null) (grp[r.spec + "|" + r.set + "|" + r.org] ||= []).push(r); });
  Object.keys(grp).forEach((k) => {
    const [spec, set, org] = k.split("|"), rs = grp[k], c = countOf(spec, set, org);
    if (c == null) return;
    const plain = rs.filter((r) => !r.pheno), ph = rs.filter((r) => r.pheno && /^(MRSA|MSSA|MR|MS)$/.test(r.pheno));
    const n = plain.length ? plain[0].n : ph.length >= 2 ? ph.reduce((a, r) => a + r.n, 0) : null;
    if (n == null || n === c) return;
    out.push({ spec, set, org, count: c, rows: n, text: `${R.SPECIMENS[spec].label}, ${R.SETTINGS[set].label}: ${R.orgLabel(org)} ${c} in the organism table, ${n} in the antibiogram table` + (ph.length >= 2 && !plain.length ? " (MRSA + MSSA)" : "") });
  });
  return out;
}

function compactRow(r, si, whyIdx) {
  const cells = {};
  Object.keys(r.cells).forEach((d) => {
    const c = r.cells[d];
    cells[d] = [c.s, ACT[c.act], c.nt == null ? null : c.nt, c.why ? whyIdx(c.why) : null];
  });
  const o = [si, r.spec, r.set, r.org, r.pheno || null, r.n, cells, r.flags.length ? r.flags : null, r.derived ? 1 : 0];
  const extra = {};
  if (r.orgAs && R.canonOrg(r.orgAs) && R.orgLabel(r.org) !== r.orgAs) extra.as = r.orgAs;
  if (r.q) extra.q = r.q; if (r.trend) extra.t = r.trend; if (r.notes) extra.no = r.notes; if (r.page) extra.p = r.page; if (r.derived) extra.d = r.derived;
  if (r.measure === "R") extra.m = "R"; if (r.table) extra.tb = r.table; if (r.cohort) extra.co = r.cohort; if (r.note) extra.nn = r.note;
  if (Object.keys(extra).length) o.push(extra);
  return o;
}

export function loadAll() {
  const errors = [], sources = [];
  if (!existsSync(SRC_DIR)) return { errors: ["no data/antibiogram/sources directory"], sources };
  readdirSync(SRC_DIR).filter((f) => f.endsWith(".json")).sort().forEach((f) => {
    let j; try { j = JSON.parse(readFileSync(join(SRC_DIR, f), "utf8")); } catch (x) { errors.push(`${f}: invalid JSON (${x.message})`); return; }
    errors.push(...validateSource(j, f)); sources.push(j);
  });
  let register = [], census = null;
  if (existsSync(REGISTER)) { try { register = JSON.parse(readFileSync(REGISTER, "utf8")); } catch (x) { errors.push(`register.json: invalid JSON (${x.message})`); } }
  if (existsSync(CENSUS_SUM)) { try { census = JSON.parse(readFileSync(CENSUS_SUM, "utf8")); } catch (x) { errors.push(`census/summary.json: invalid JSON (${x.message})`); } }
  return { errors, sources, register, census };
}

export function buildBundle(sources, register, census) {
  const why = [], whyMap = {};
  const whyIdx = (t) => { if (whyMap[t] == null) { whyMap[t] = why.length; why.push(t); } return whyMap[t]; };
  const metas = [], rows = [], counts = [], report = [], consistency = [];
  const stats = { sources: 0, rows: 0, derivedRows: 0, cells: 0, act: { keep: 0, intrinsic: 0, hide: 0, suppress: 0, caution: 0 }, lowNRows: 0, noNRows: 0, isolates: 0, countMismatches: 0 };
  sources.slice().sort((a, b) => (a.region + a.short + (9999 - a.year)).localeCompare(b.region + b.short + (9999 - b.year))).forEach((src) => {
    const si = metas.length;
    const checked = (src.rows || []).map((r) => checkRow(src, r));
    const derived = derive(checked, src);
    const checks = countChecks(src, checked);
    const orgs = new Set(checked.map((r) => r.org));
    metas.push({ id: src.id, kind: src.kind, inst: src.inst, name: src.institution, short: src.short, city: src.city || null, state: src.state || null, region: src.region,
      sector: src.sector, year: src.year, end: src.end || src.year + "-12", period: src.period || null, url: src.url || null, page: src.page || null, doi: src.doi || null, citation: src.citation,
      verification: src.verification, notes: src.notes || null, issues: (src.issues || []).length ? src.issues : null, excluded: (src.excluded || []).length ? src.excluded : null,
      checks: checks.length ? checks.map((c) => c.text) : null,
      specs: Array.from(new Set(checked.map((r) => r.spec))), sets: Array.from(new Set(checked.map((r) => r.set))), orgs: Array.from(orgs), rows: checked.length,
      isolates: (src.counts || []).length ? (src.counts || []).reduce((a, c) => a + c.n, 0) : checked.filter((r) => r.n).reduce((a, r) => a + r.n, 0) });
    checked.concat(derived).forEach((r) => {
      rows.push(compactRow(r, si, whyIdx));
      if (r.derived) stats.derivedRows++; else stats.rows++;
      if (r.flags.includes("lowN") && !r.derived) stats.lowNRows++;
      if (r.flags.includes("noN") && !r.derived) stats.noNRows++;
      if (!r.derived) Object.keys(r.cells).forEach((d) => {
        const c = r.cells[d]; stats.cells++; stats.act[c.act]++;
        if (c.act !== "keep") report.push({ src: src.id, spec: r.spec, set: r.set, org: r.orgAs, pheno: r.pheno, drug: d, value: c.s, action: c.act, why: c.why });
      });
    });
    (src.counts || []).forEach((c) => { const o = R.canonOrg(c.org); counts.push([si, c.spec, c.set, o.key, c.n]); });
    checks.forEach((c) => consistency.push(Object.assign({ src: src.id }, c)));
    stats.isolates += metas[si].isolates;
  });
  stats.sources = metas.length;
  stats.countMismatches = consistency.length;
  const reg = (register || []).map((x) => ({ id: x.id, institution: x.institution, short: x.short || null, city: x.city || null, state: x.state || null, region: x.region || null,
    sector: x.sector || null, type: x.type || null, year: x.year || null, url: x.url || null, page: x.page || null, status: x.status || null,
    integrated: x.integrated || null, reason: x.reason || null }));
  const body = { schema: 2, sources: metas, rows, counts, why, register: reg, census: census || null, stats };
  // The version also covers the rules and the store, so a change to either re-busts every cache.
  const code = [RULES_JS, STORE_JS].map((f) => existsSync(f) ? readFileSync(f, "utf8").replace(/var ABG_V = "[^"]*";/, "") : "").join("\n");
  const version = createHash("sha256").update(JSON.stringify(body)).update(code).digest("hex").slice(0, 12);
  return { bundle: Object.assign({ version }, body), report, consistency, version };
}

function indexJs(bundle) {
  const meta = bundle.sources.map((s) => ({ id: s.id, kind: s.kind, inst: s.inst, name: s.name, short: s.short, city: s.city, state: s.state, region: s.region, sector: s.sector, year: s.year, end: s.end, specs: s.specs, orgs: s.orgs.length, verification: s.verification.status }));
  return `/* StewardMD - antibiogram source index (GENERATED by scripts/build-antibiogram.mjs; do not edit).
 * The data itself is kb/antibiogram/antibiogram.json, fetched by antibiogram-store.js. This file
 * carries only what the app needs at start-up: the bundle version and the list of sources, so
 * profile pickers can be built before the bundle arrives. */
(function () {
  "use strict";
  window.ABG_INDEX = { version: ${JSON.stringify(bundle.version)}, sources: ${JSON.stringify(meta)}, stats: ${JSON.stringify(bundle.stats)} };
})();
`;
}

function syncTokens(version, write) {
  const drift = [];
  if (existsSync(HTML)) {
    const html = readFileSync(HTML, "utf8");
    let next = html;
    [["antibiogram-data.js", "abgd"], ["antibiogram-rules.js", "abgr"], ["antibiogram-store.js", "abgs"]].forEach(([f]) => {
      const re = new RegExp("(" + f.replace(/[.]/g, "\\.") + "\\?v=[^\".]*)\\.[^\"]*");
      next = next.replace(re, "$1." + version);
    });
    if (next !== html) { drift.push("index.html antibiogram ?v= tokens"); if (write) writeFileSync(HTML, next); }
  }
  if (existsSync(STORE_JS)) {
    const js = readFileSync(STORE_JS, "utf8"), next = js.replace(/var ABG_V = "[^"]*";/, `var ABG_V = "${version}";`);
    if (next !== js) { drift.push("antibiogram-store.js ABG_V"); if (write) writeFileSync(STORE_JS, next); }
  }
  return drift;
}

/* One source file, for extraction work: schema errors, then every cell the rules did not keep,
 * the derived rows and the count-table mismatches. Exit 1 on schema errors. */
function checkFile(path) {
  let j; try { j = JSON.parse(readFileSync(path, "utf8")); } catch (x) { console.error(`${path}: invalid JSON (${x.message})`); process.exit(1); }
  const errs = validateSource(j, path.split("/").pop());
  if (errs.length) { console.error(`${errs.length} schema error(s):\n  ` + errs.join("\n  ")); process.exit(1); }
  const checked = j.rows.map((r) => checkRow(j, r)), derived = derive(checked, j), checks = countChecks(j, checked);
  const act = { keep: 0, intrinsic: 0, hide: 0, suppress: 0, caution: 0 };
  const lines = [];
  checked.forEach((r) => Object.keys(r.cells).forEach((d) => {
    const c = r.cells[d]; act[c.act]++;
    if (c.act !== "keep") lines.push(`  ${c.act.padEnd(9)} ${r.spec}/${r.set} ${r.orgAs}${r.pheno ? " " + r.pheno : ""} ${d}=${c.s}: ${c.why}`);
  }));
  const low = checked.filter((r) => r.flags.includes("lowN")).length, non = checked.filter((r) => r.flags.includes("noN")).length;
  console.log(`${j.id}: ${checked.length} rows, ${Object.values(act).reduce((a, b) => a + b, 0)} cells (${act.keep} kept, ${act.caution} caution, ${act.intrinsic} intrinsic, ${act.hide} hidden, ${act.suppress} suppressed), ${low} rows under 30 isolates, ${non} rows without n, ${derived.length} derived rows`);
  if (lines.length) console.log("Cells not kept (check each against the page; a transcription error must be fixed, a source error left as printed):\n" + lines.join("\n"));
  if (checks.length) console.log("Count-table mismatches (check both tables on the page; record a real source inconsistency in notes):\n" + checks.map((c) => "  " + c.text).join("\n"));
  derived.forEach((r) => console.log(`  derived ${r.spec}/${r.set} ${R.orgLabel(r.org)}${r.pheno ? " " + r.pheno : ""} n=${r.n}: ${r.derived}`));
}

function main() {
  const fi = process.argv.indexOf("--file");
  if (fi > 0) { checkFile(process.argv[fi + 1]); return; }
  const check = process.argv.includes("--check"), validateOnly = process.argv.includes("--validate");
  const { errors, sources, register, census } = loadAll();
  if (errors.length) { console.error(`${errors.length} error(s):\n  ` + errors.join("\n  ")); process.exit(1); }
  const { bundle, report, consistency, version } = buildBundle(sources, register, census);
  const s = bundle.stats;
  const summary = `${s.sources} sources, ${s.rows} rows (+${s.derivedRows} derived), ${s.cells} cells: ${s.act.keep} shown, ${s.act.caution} with caution, ${s.act.intrinsic} intrinsic, ${s.act.hide} not relevant to the specimen, ${s.act.suppress} suppressed; ${s.lowNRows} rows under 30 isolates; ${s.noNRows} rows without n; ${s.countMismatches} count-table mismatches`;
  if (validateOnly) { console.log("OK: " + summary); return; }
  const text = JSON.stringify(bundle) + "\n", idx = indexJs(bundle), rep = JSON.stringify({ version, generated: "build", countMismatches: consistency, actions: report }, null, 1) + "\n";
  const drift = [];
  if (!existsSync(OUT) || readFileSync(OUT, "utf8") !== text) drift.push("kb/antibiogram/antibiogram.json");
  if (!existsSync(INDEX_JS) || readFileSync(INDEX_JS, "utf8") !== idx) drift.push("antibiogram-data.js");
  if (!existsSync(REPORT) || readFileSync(REPORT, "utf8") !== rep) drift.push("data/antibiogram/validation-report.json");
  drift.push(...syncTokens(version, !check));
  if (check) {
    if (drift.length) { console.error("Stale: " + drift.join(", ") + ". Run: node scripts/build-antibiogram.mjs"); process.exit(1); }
    console.log(`OK: antibiogram v ${version}: ${summary}`); return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, text); writeFileSync(INDEX_JS, idx); writeFileSync(REPORT, rep);
  console.log(`Wrote kb/antibiogram/antibiogram.json (v ${version}, ${(text.length / 1024).toFixed(0)} KB): ${summary}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
