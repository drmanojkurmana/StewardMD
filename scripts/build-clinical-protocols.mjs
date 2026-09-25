#!/usr/bin/env node
/* StewardMD - Knowledge Base clinical protocols: validator + index builder.
 *
 * Content lives as one JSON file per protocol in kb/clinical-protocols/<id>.json. This script
 * validates every file against the schema below and writes kb/clinical-protocols/index.json (the
 * catalogue the Protocols tab loads first; each protocol body is fetched on open).
 *
 *   node scripts/build-clinical-protocols.mjs          validate + write index.json + sync CONTENT_V
 *   node scripts/build-clinical-protocols.mjs --check  validate + fail if index.json is stale
 *   node scripts/build-clinical-protocols.mjs --validate [id ...]  validate only (named files), never writes
 *
 * The index carries a content hash ("version"). kb-protocols.js fetches with ?v=<version> because
 * sw.js caches static files by full URL, so a content change must change the URL. The build rewrites
 * CONTENT_V in kb-protocols.js and the hash half of the kb-protocols.js ?v=<code>.<hash> token in
 * index.html to match; the unit test
 * (test/kb-clinical-protocols.test.mjs) fails if they drift.
 *
 * SCHEMA (unknown keys are errors, so the renderer and the content cannot silently diverge):
 *   id          kebab-case, equals the file name
 *   title       3..120 chars
 *   subject     one of SUBJECTS keys
 *   population  one of POPULATIONS
 *   basis       "international" (WHO, NICE, AHA, ESC, IDSA...) or "india" (national programme / Indian
 *               society guidance as the PRIMARY source); drives the International / India filter
 *   counterpart optional id of the same topic under the other basis; must exist, point back, and
 *               differ in basis (checked across files by loadAll)
 *   setting     optional string ("Emergency, ward, ICU")
 *   aliases     optional string[] (abbreviations, synonyms; used by search)
 *   summary     20..400 chars, one or two sentences
 *   sections    >= 3 of { kind, title, items: string[] }, kind in SECTION_KINDS,
 *               must include an "immediate" or "treatment" section
 *   drugs       optional { name, dose, notes? }[]
 *   sources     >= 1 of { org, title, year, url (https) }
 *   review      { status: ai_drafted | reviewed | approved, compiled: YYYY-MM-DD, reviewer?: string }
 * Every string: no em dash (U+2014) or en dash (U+2013), no HTML tags, no placeholder text.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DIR = join(ROOT, "kb/clinical-protocols");
export const INDEX = join(DIR, "index.json");

// Display order is this order. Labels are app-facing text.
export const SUBJECTS = [
  ["emergency", "Emergency and Resuscitation"],
  ["critical-care", "Critical Care"],
  ["cardiology", "Cardiology"],
  ["respiratory", "Respiratory Medicine"],
  ["infectious-disease", "Infectious Diseases"],
  ["gastroenterology", "Gastroenterology and Hepatology"],
  ["nephrology", "Nephrology and Electrolytes"],
  ["endocrinology", "Endocrinology and Diabetes"],
  ["neurology", "Neurology"],
  ["toxicology", "Toxicology and Envenomation"],
  ["haematology-oncology", "Haematology and Oncology"],
  ["rheumatology-dermatology", "Rheumatology and Dermatology"],
  ["psychiatry", "Psychiatry"],
  ["obstetrics-gynaecology", "Obstetrics and Gynaecology"],
  ["paediatrics", "Paediatrics and Neonatology"],
  ["surgery-trauma", "Surgery, Trauma and Orthopaedics"],
  ["urology", "Urology"],
  ["anaesthesia", "Anaesthesia and Perioperative"],
  ["ophthalmology-ent", "Ophthalmology and ENT"]
];
export const POPULATIONS = ["Adults", "Children", "Neonates", "Pregnancy", "Adults and children", "All ages"];
export const SECTION_KINDS = ["recognise", "immediate", "investigations", "treatment", "monitoring", "escalate", "disposition", "special", "prevention", "pitfalls"];
export const REVIEW_STATUS = ["ai_drafted", "reviewed", "approved"];
// Labels are app-facing text (filter chips, row and reader pills).
export const BASES = [["international", "International"], ["india", "India"]];
const TOP_KEYS = ["id", "title", "subject", "population", "basis", "counterpart", "setting", "aliases", "summary", "sections", "drugs", "sources", "review"];
const BASIS_KEYS = BASES.map((b) => b[0]);

const SUBJECT_KEYS = SUBJECTS.map((s) => s[0]);
const isStr = (v) => typeof v === "string" && v.trim().length > 0;

function textErrors(where, s) {
  const out = [];
  if (/—/.test(s)) out.push(`${where}: contains an em dash`);
  if (/–/.test(s)) out.push(`${where}: contains an en dash (write "to" for ranges)`);
  // Comparators like "< 90" or ">= 65" are clinical text; only tag-like brackets are flagged.
  if (/<\/?[a-z][^>]*>/i.test(s)) out.push(`${where}: contains HTML-like markup`);
  if (/\bTODO\b|\bTBD\b|lorem ipsum/i.test(s)) out.push(`${where}: contains placeholder text`);
  return out;
}

/** Validate one parsed protocol. Returns an array of error strings (empty = valid). */
export function validateProtocol(p, fileId) {
  const e = [];
  if (!p || typeof p !== "object" || Array.isArray(p)) return [`${fileId}: not a JSON object`];
  const tag = p.id || fileId;
  Object.keys(p).forEach((k) => { if (TOP_KEYS.indexOf(k) < 0) e.push(`${tag}: unknown key "${k}"`); });
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.id || "")) e.push(`${tag}: id must be kebab-case`);
  if (fileId && p.id !== fileId) e.push(`${tag}: id does not match file name ${fileId}.json`);
  if (!isStr(p.title) || p.title.length < 3 || p.title.length > 120) e.push(`${tag}: title must be 3..120 chars`);
  if (SUBJECT_KEYS.indexOf(p.subject) < 0) e.push(`${tag}: subject "${p.subject}" is not one of ${SUBJECT_KEYS.join(", ")}`);
  if (POPULATIONS.indexOf(p.population) < 0) e.push(`${tag}: population must be one of ${POPULATIONS.join(", ")}`);
  if (BASIS_KEYS.indexOf(p.basis) < 0) e.push(`${tag}: basis must be one of ${BASIS_KEYS.join(", ")}`);
  if (p.counterpart != null && (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.counterpart) || p.counterpart === p.id)) e.push(`${tag}: counterpart must be another protocol id`);
  if (p.setting != null && !isStr(p.setting)) e.push(`${tag}: setting must be a string`);
  if (p.aliases != null && (!Array.isArray(p.aliases) || !p.aliases.every(isStr))) e.push(`${tag}: aliases must be a string array`);
  if (!isStr(p.summary) || p.summary.length < 20 || p.summary.length > 400) e.push(`${tag}: summary must be 20..400 chars`);

  if (!Array.isArray(p.sections) || p.sections.length < 3) e.push(`${tag}: needs at least 3 sections`);
  else {
    p.sections.forEach((s, i) => {
      const w = `${tag}.sections[${i}]`;
      if (!s || typeof s !== "object") { e.push(`${w}: not an object`); return; }
      Object.keys(s).forEach((k) => { if (["kind", "title", "items"].indexOf(k) < 0) e.push(`${w}: unknown key "${k}"`); });
      if (SECTION_KINDS.indexOf(s.kind) < 0) e.push(`${w}: kind "${s.kind}" is not one of ${SECTION_KINDS.join(", ")}`);
      if (!isStr(s.title) || s.title.length > 80) e.push(`${w}: title must be 1..80 chars`);
      if (!Array.isArray(s.items) || !s.items.length || !s.items.every(isStr)) e.push(`${w}: items must be a non-empty string array`);
      else s.items.forEach((it, j) => { if (it.length > 700) e.push(`${w}.items[${j}]: longer than 700 chars`); });
    });
    if (!p.sections.some((s) => s && (s.kind === "immediate" || s.kind === "treatment"))) e.push(`${tag}: needs an "immediate" or "treatment" section`);
  }

  if (p.drugs != null) {
    if (!Array.isArray(p.drugs)) e.push(`${tag}: drugs must be an array`);
    else p.drugs.forEach((d, i) => {
      const w = `${tag}.drugs[${i}]`;
      if (!d || typeof d !== "object") { e.push(`${w}: not an object`); return; }
      Object.keys(d).forEach((k) => { if (["name", "dose", "notes"].indexOf(k) < 0) e.push(`${w}: unknown key "${k}"`); });
      if (!isStr(d.name)) e.push(`${w}: name required`);
      if (!isStr(d.dose)) e.push(`${w}: dose required`);
      if (d.notes != null && !isStr(d.notes)) e.push(`${w}: notes must be a string`);
    });
  }

  if (!Array.isArray(p.sources) || !p.sources.length) e.push(`${tag}: needs at least one source`);
  else p.sources.forEach((s, i) => {
    const w = `${tag}.sources[${i}]`;
    if (!s || typeof s !== "object") { e.push(`${w}: not an object`); return; }
    Object.keys(s).forEach((k) => { if (["org", "title", "year", "url"].indexOf(k) < 0) e.push(`${w}: unknown key "${k}"`); });
    if (!isStr(s.org)) e.push(`${w}: org required`);
    if (!isStr(s.title)) e.push(`${w}: title required`);
    if (!Number.isInteger(s.year) || s.year < 1990 || s.year > 2030) e.push(`${w}: year must be an integer 1990..2030`);
    if (!/^https:\/\/[^\s]+\.[^\s]+/.test(s.url || "")) e.push(`${w}: url must be https`);
  });

  const r = p.review;
  if (!r || typeof r !== "object") e.push(`${tag}: review required`);
  else {
    Object.keys(r).forEach((k) => { if (["status", "compiled", "reviewer"].indexOf(k) < 0) e.push(`${tag}.review: unknown key "${k}"`); });
    if (REVIEW_STATUS.indexOf(r.status) < 0) e.push(`${tag}.review.status must be one of ${REVIEW_STATUS.join(", ")}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.compiled || "")) e.push(`${tag}.review.compiled must be YYYY-MM-DD`);
    if (r.reviewer != null && typeof r.reviewer !== "string") e.push(`${tag}.review.reviewer must be a string`);
    if ((r.status === "reviewed" || r.status === "approved") && !isStr(r.reviewer)) e.push(`${tag}.review: a ${r.status} protocol must name its reviewer`);
  }

  // Walk every string in the object for banned characters / placeholders.
  (function walk(v, path) {
    if (typeof v === "string") { e.push(...textErrors(`${tag}${path}`, v)); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") Object.keys(v).forEach((k) => walk(v[k], `${path}.${k}`));
  })(p, "");
  return e;
}

/** Read + validate every protocol file. Returns { protocols, errors }. */
export function loadAll(dir = DIR) {
  const errors = [], protocols = [];
  if (!existsSync(dir)) return { protocols, errors: [`missing ${dir}`] };
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  const seenTitles = new Map();
  for (const f of files) {
    const fileId = f.replace(/\.json$/, "");
    let p;
    try { p = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (x) { errors.push(`${f}: invalid JSON (${x.message})`); continue; }
    const errs = validateProtocol(p, fileId);
    errors.push(...errs);
    const t = String(p.title || "").toLowerCase();
    if (seenTitles.has(t)) errors.push(`${fileId}: duplicate title with ${seenTitles.get(t)}`);
    seenTitles.set(t, fileId);
    protocols.push(p);
  }
  // Counterparts pair the same topic across bases: both files must exist and point at each other.
  const byId = new Map(protocols.map((p) => [p.id, p]));
  protocols.forEach((p) => {
    if (p.counterpart == null) return;
    const q = byId.get(p.counterpart);
    if (!q) errors.push(`${p.id}: counterpart ${p.counterpart} does not exist`);
    else if (q.counterpart !== p.id) errors.push(`${p.id}: counterpart ${q.id} does not point back`);
    else if (q.basis === p.basis) errors.push(`${p.id}: counterpart ${q.id} has the same basis`);
  });
  return { protocols, errors };
}

/** Deterministic catalogue: same content always yields the same bytes (no timestamps). */
export function buildIndex(protocols) {
  const sorted = protocols.slice().sort((a, b) => a.title.localeCompare(b.title));
  const hash = createHash("sha256");
  sorted.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((p) => hash.update(JSON.stringify(p)));
  const counts = {};
  sorted.forEach((p) => { counts[p.subject] = (counts[p.subject] || 0) + 1; });
  return {
    schema: 1,
    version: hash.digest("hex").slice(0, 12),
    count: sorted.length,
    subjects: SUBJECTS.filter(([k]) => counts[k]).map(([key, label]) => ({ key, label, count: counts[key] })),
    bases: BASES.map(([key, label]) => ({ key, label, count: sorted.filter((p) => p.basis === key).length })),
    protocols: sorted.map((p) => ({
      id: p.id,
      title: p.title,
      subject: p.subject,
      population: p.population,
      basis: p.basis,
      counterpart: p.counterpart || null,
      aliases: p.aliases || [],
      summary: p.summary,
      sources: p.sources.map((s) => s.org + " " + s.year),
      status: p.review.status
    }))
  };
}

const JS_FILE = join(ROOT, "kb-protocols.js");
const HTML_FILE = join(ROOT, "index.html");
export function syncVersion(version, { write }) {
  const drift = [];
  if (existsSync(JS_FILE)) {
    const js = readFileSync(JS_FILE, "utf8");
    const next = js.replace(/var CONTENT_V = "[^"]*";/, `var CONTENT_V = "${version}";`);
    if (next !== js) { drift.push("kb-protocols.js CONTENT_V"); if (write) writeFileSync(JS_FILE, next); }
  }
  if (existsSync(HTML_FILE)) {
    const html = readFileSync(HTML_FILE, "utf8");
    // Token = "<code version>.<content hash>": bump the code part by hand when kb-protocols.js changes;
    // the build owns the hash part so a content-only change also changes the URL.
    const next = html.replace(/(kb-protocols\.js\?v=[^".]*)\.[^"]*/, `$1.${version}`);
    if (next !== html) { drift.push("index.html kb-protocols.js ?v= token"); if (write) writeFileSync(HTML_FILE, next); }
  }
  return drift;
}

function main() {
  const vi = process.argv.indexOf("--validate");
  if (vi >= 0) {
    // Validate only (optionally only the named ids); never writes. For authors working in parallel.
    const ids = process.argv.slice(vi + 1).filter((a) => !a.startsWith("--"));
    const errors = [];
    const files = ids.length ? ids.map((id) => id.replace(/\.json$/, "") + ".json") : readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
    for (const f of files) {
      const path = join(DIR, f);
      if (!existsSync(path)) { errors.push(`${f}: file not found`); continue; }
      try { errors.push(...validateProtocol(JSON.parse(readFileSync(path, "utf8")), f.replace(/\.json$/, ""))); }
      catch (x) { errors.push(`${f}: invalid JSON (${x.message})`); }
    }
    if (errors.length) { console.error(`${errors.length} validation error(s):\n  ` + errors.join("\n  ")); process.exit(1); }
    console.log(`OK: ${files.length} file(s) valid`);
    return;
  }
  const check = process.argv.includes("--check");
  const { protocols, errors } = loadAll();
  if (errors.length) {
    console.error(`${errors.length} validation error(s):\n  ` + errors.join("\n  "));
    process.exit(1);
  }
  const index = buildIndex(protocols);
  const text = JSON.stringify(index, null, 1) + "\n";
  const current = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
  if (check) {
    const drift = syncVersion(index.version, { write: false });
    if (current !== text) drift.unshift("index.json");
    if (drift.length) { console.error("Stale: " + drift.join(", ") + ". Run: node scripts/build-clinical-protocols.mjs"); process.exit(1); }
    console.log(`OK: ${index.count} protocols across ${index.subjects.length} subjects (v ${index.version})`);
    return;
  }
  if (current !== text) writeFileSync(INDEX, text);
  const synced = syncVersion(index.version, { write: true });
  console.log(`Wrote index.json: ${index.count} protocols across ${index.subjects.length} subjects (v ${index.version})` + (synced.length ? `; synced ${synced.join(", ")}` : ""));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
