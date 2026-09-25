#!/usr/bin/env node
/* StewardMD - Specialty kits: validator + bundle builder.
 *
 * A kit is the specialty layer of the OPD consult: a structured history/exam form whose sections write
 * into the EXISTING Initial Assessment fields (so they save through the normal "Save to GHIS/EMR" path),
 * interactive tools (pregnancy dating, WHO growth z-scores, ...), and shortcuts to investigations,
 * protocols and calculators. Sources: kb/specialty-kits/src/<kit>.json (+ src/data-<name>.json for tool
 * data). Output: kb/specialty-kits/kits.json (the only file the app loads).
 *
 *   node scripts/build-specialty-kits.mjs            validate + write kits.json + sync KITS_V, GROWTH_V
 *                                                    and the index.html specialty-kits.js token
 *   node scripts/build-specialty-kits.mjs --check    validate + fail if kits.json / KITS_V is stale
 *   node scripts/build-specialty-kits.mjs --validate [id ...]  validate only (named kits), never writes
 *
 * KIT SCHEMA (unknown keys are errors):
 *   id           kebab-case, equals the file name
 *   label        app-facing name ("Obstetrics and Gynaecology")
 *   short        short chip label, <= 16 chars ("O&G")
 *   icon         Material Symbols ligature name
 *   subject      clinical-protocols subject key (kb/clinical-protocols/index.json subjects)
 *   workspace    optional specialty workspace id (workspaces.js REG)
 *   scribe       optional MaiK Scribe template id (scribe-templates.js)
 *   tools        tool ids implemented in specialty-kits.js (TOOL_IDS below)
 *   sections     [{ id, title, target, alert?, fields: [{ id, label, type, opts?, unit?, set?, hint? }] }]
 *                alert  = optional warning shown when any "check" field in the section is ticked
 *                target = the assessment field the composed section text is added to;
 *                set    = optional assessment field this one value is written to directly.
 *                type in FIELD_TYPES; opts required for select.
 *   investigations [{ label, query }]   query = what is typed into the Investigations search
 *   protocols    [clinical-protocol ids]
 *   calculators  [calculators.js ids]
 *   advice       [{ id, title, target, text }]  patient advice added to an assessment field
 *   sources      [{ org, title, year, url (https) }]
 *   review       { status: ai_drafted | reviewed | approved, compiled: YYYY-MM-DD, reviewer? }
 * Every string: no em/en dash, no HTML tags, no placeholder text.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = join(ROOT, "kb/specialty-kits/src");
export const OUT = join(ROOT, "kb/specialty-kits/kits.json");
const JS_FILE = join(ROOT, "specialty-kits.js");
const HTML_FILE = join(ROOT, "index.html");
const GROWTH_FILE = join(ROOT, "kb/growth/who-growth.json");

export const TOOL_IDS = ["pregnancy-dating", "growth-who", "milestones", "immunisation", "visual-acuity", "hearing", "odontogram", "pasi"];
export const FIELD_TYPES = ["text", "textarea", "number", "select", "check", "date"];
export const KIT_ORDER = ["obgyn", "paediatrics", "orthopaedics", "ophthalmology", "ent", "dermatology", "psychiatry", "dental"];
const TOP_KEYS = ["id", "label", "short", "icon", "subject", "workspace", "scribe", "tools", "sections", "investigations", "protocols", "calculators", "advice", "sources", "review"];

/** Initial Assessment field names, read from opd-emr.js ASSESS_SCHEMA (the form kits write into). */
export function assessmentFields() {
  const src = readFileSync(join(ROOT, "opd-emr.js"), "utf8");
  const start = src.indexOf("var ASSESS_SCHEMA = [");
  const end = src.indexOf("\n  ];", start);
  const block = src.slice(start, end);
  return new Set([...block.matchAll(/F\("([^"]+)"/g)].map((m) => m[1]));
}
export function calculatorIds() {
  const src = readFileSync(join(ROOT, "calculators.js"), "utf8");
  return new Set([...src.matchAll(/\{ id:"([a-z0-9_]+)", cat:"/g)].map((m) => m[1]));
}
export function protocolIds() {
  const dir = join(ROOT, "kb/clinical-protocols");
  return new Set(readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").map((f) => f.slice(0, -5)));
}
export function subjectKeys() {
  const idx = JSON.parse(readFileSync(join(ROOT, "kb/clinical-protocols/index.json"), "utf8"));
  return new Set((idx.subjects || []).map((s) => s.key));
}
export function scribeIds() {
  const src = readFileSync(join(ROOT, "scribe-templates.js"), "utf8");
  return new Set([...src.matchAll(/\bid: "([a-z0-9-]+)", label:/g)].map((m) => m[1]));
}
export function workspaceIds() {
  const src = readFileSync(join(ROOT, "workspaces.js"), "utf8");
  return new Set([...src.matchAll(/\{ id: "([a-z_]+)", name:/g)].map((m) => m[1]));
}

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
function textErrors(where, s) {
  const out = [];
  if (/[–—]/.test(s)) out.push(`${where}: contains an em or en dash`);
  if (/<\/?[a-z][^>]*>/i.test(s)) out.push(`${where}: contains HTML-like markup`);
  if (/\bTODO\b|\bTBD\b|lorem ipsum/i.test(s)) out.push(`${where}: contains placeholder text`);
  return out;
}

/** Validate one kit. refs = { fields, calcs, protocols, scribes, workspaces } (Sets). */
export function validateKit(k, fileId, refs) {
  const e = [];
  const tag = (k && k.id) || fileId;
  if (!k || typeof k !== "object" || Array.isArray(k)) return [`${fileId}: not a JSON object`];
  Object.keys(k).forEach((key) => { if (TOP_KEYS.indexOf(key) < 0) e.push(`${tag}: unknown key "${key}"`); });
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(k.id || "")) e.push(`${tag}: id must be kebab-case`);
  if (fileId && k.id !== fileId) e.push(`${tag}: id does not match file name`);
  if (!isStr(k.label)) e.push(`${tag}: label required`);
  if (!isStr(k.short) || k.short.length > 16) e.push(`${tag}: short must be 1..16 chars`);
  if (!/^[a-z_]+$/.test(k.icon || "")) e.push(`${tag}: icon must be a Material Symbols name`);
  if (!isStr(k.subject)) e.push(`${tag}: subject required`);
  else if (refs && refs.subjects && !refs.subjects.has(k.subject)) e.push(`${tag}: unknown protocol subject "${k.subject}"`);
  if (k.workspace != null && refs && !refs.workspaces.has(k.workspace)) e.push(`${tag}: unknown workspace "${k.workspace}"`);
  if (k.scribe != null && refs && !refs.scribes.has(k.scribe)) e.push(`${tag}: unknown scribe template "${k.scribe}"`);
  if (!Array.isArray(k.tools) || !k.tools.every((t) => TOOL_IDS.indexOf(t) >= 0)) e.push(`${tag}: tools must be from ${TOOL_IDS.join(", ")}`);

  const seen = new Set();
  if (!Array.isArray(k.sections) || !k.sections.length) e.push(`${tag}: needs at least one section`);
  else k.sections.forEach((s, i) => {
    const w = `${tag}.sections[${i}]`;
    if (!s || typeof s !== "object") { e.push(`${w}: not an object`); return; }
    Object.keys(s).forEach((key) => { if (["id", "title", "target", "alert", "fields"].indexOf(key) < 0) e.push(`${w}: unknown key "${key}"`); });
    if (s.alert != null && !isStr(s.alert)) e.push(`${w}: alert must be a string`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id || "")) e.push(`${w}: id must be kebab-case`);
    if (seen.has("s:" + s.id)) e.push(`${w}: duplicate section id ${s.id}`); seen.add("s:" + s.id);
    if (!isStr(s.title)) e.push(`${w}: title required`);
    if (refs && !refs.fields.has(s.target)) e.push(`${w}: target "${s.target}" is not an Initial Assessment field`);
    if (!Array.isArray(s.fields) || !s.fields.length) e.push(`${w}: needs fields`);
    else s.fields.forEach((f, j) => {
      const fw = `${w}.fields[${j}]`;
      Object.keys(f || {}).forEach((key) => { if (["id", "label", "type", "opts", "unit", "set", "hint"].indexOf(key) < 0) e.push(`${fw}: unknown key "${key}"`); });
      if (!/^[a-z0-9_]+$/.test((f && f.id) || "")) e.push(`${fw}: id must be snake_case`);
      if (seen.has("f:" + f.id)) e.push(`${fw}: duplicate field id ${f.id} in kit`); seen.add("f:" + f.id);
      if (!isStr(f.label)) e.push(`${fw}: label required`);
      if (FIELD_TYPES.indexOf(f.type) < 0) e.push(`${fw}: type must be one of ${FIELD_TYPES.join(", ")}`);
      if (f.type === "select" && (!Array.isArray(f.opts) || f.opts.length < 2 || !f.opts.every(isStr))) e.push(`${fw}: select needs >= 2 opts`);
      if (f.type !== "select" && f.opts != null) e.push(`${fw}: opts only for select`);
      if (f.set != null && refs && !refs.fields.has(f.set)) e.push(`${fw}: set "${f.set}" is not an Initial Assessment field`);
    });
  });
  (k.investigations || []).forEach((x, i) => { if (!isStr(x.label) || !isStr(x.query) || Object.keys(x).length !== 2) e.push(`${tag}.investigations[${i}]: needs exactly label + query`); });
  (k.protocols || []).forEach((p) => { if (refs && !refs.protocols.has(p)) e.push(`${tag}: unknown protocol "${p}"`); });
  (k.calculators || []).forEach((c) => { if (refs && !refs.calcs.has(c)) e.push(`${tag}: unknown calculator "${c}"`); });
  (k.advice || []).forEach((a, i) => {
    const w = `${tag}.advice[${i}]`;
    Object.keys(a || {}).forEach((key) => { if (["id", "title", "target", "text"].indexOf(key) < 0) e.push(`${w}: unknown key "${key}"`); });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test((a && a.id) || "")) e.push(`${w}: id must be kebab-case`);
    if (!isStr(a.title) || !isStr(a.text)) e.push(`${w}: title and text required`);
    if (refs && !refs.fields.has(a.target)) e.push(`${w}: target "${a.target}" is not an Initial Assessment field`);
  });
  if (!Array.isArray(k.sources) || !k.sources.length) e.push(`${tag}: needs at least one source`);
  else k.sources.forEach((s, i) => {
    if (!isStr(s.org) || !isStr(s.title) || !Number.isInteger(s.year) || !/^https:\/\/\S+\.\S+/.test(s.url || "")) e.push(`${tag}.sources[${i}]: org, title, integer year and https url required`);
  });
  const r = k.review;
  if (!r || ["ai_drafted", "reviewed", "approved"].indexOf(r.status) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.compiled || "")) e.push(`${tag}: review { status, compiled } required`);
  else if (r.status !== "ai_drafted" && !isStr(r.reviewer)) e.push(`${tag}: a ${r.status} kit must name its reviewer`);
  (function walk(v, path) {
    if (typeof v === "string") { e.push(...textErrors(`${tag}${path}`, v)); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
    if (v && typeof v === "object") Object.keys(v).forEach((key) => walk(v[key], `${path}.${key}`));
  })(k, "");
  return e;
}

export function refsNow() {
  return { fields: assessmentFields(), calcs: calculatorIds(), protocols: protocolIds(), subjects: subjectKeys(), scribes: scribeIds(), workspaces: workspaceIds() };
}

/** Load + validate every source. Returns { kits, data, errors }. */
export function loadAll(dir = SRC, refs = refsNow()) {
  const errors = [], kits = [], data = {};
  if (!existsSync(dir)) return { kits, data, errors: [`missing ${dir}`] };
  readdirSync(dir).filter((f) => f.endsWith(".json")).sort().forEach((f) => {
    let j; try { j = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (x) { errors.push(`${f}: invalid JSON (${x.message})`); return; }
    if (f.startsWith("data-")) {
      const name = f.slice(5, -5);
      (function walk(v, path) {
        if (typeof v === "string") { errors.push(...textErrors(`${f}${path}`, v)); return; }
        if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
        if (v && typeof v === "object") Object.keys(v).forEach((key) => walk(v[key], `${path}.${key}`));
      })(j, "");
      data[name] = j; return;
    }
    errors.push(...validateKit(j, f.slice(0, -5), refs));
    kits.push(j);
  });
  kits.sort((a, b) => (KIT_ORDER.indexOf(a.id) + 99 * (KIT_ORDER.indexOf(a.id) < 0)) - (KIT_ORDER.indexOf(b.id) + 99 * (KIT_ORDER.indexOf(b.id) < 0)));
  return { kits, data, errors };
}

export function buildBundle(kits, data) {
  const hash = createHash("sha256").update(JSON.stringify({ kits, data })).digest("hex").slice(0, 12);
  return { schema: 1, version: hash, kits, data };
}

function main() {
  const check = process.argv.includes("--check"), validateOnly = process.argv.includes("--validate");
  if (validateOnly) {
    // --validate [id ...]: named kits only (for authors working in parallel), never writes.
    const ids = process.argv.slice(process.argv.indexOf("--validate") + 1).filter((a) => !a.startsWith("--"));
    if (ids.length) {
      const refs = refsNow(), errs = [];
      ids.forEach((id) => {
        const f = join(SRC, id.replace(/\.json$/, "") + ".json");
        if (!existsSync(f)) { errs.push(`${id}: file not found`); return; }
        try { errs.push(...validateKit(JSON.parse(readFileSync(f, "utf8")), id.replace(/\.json$/, ""), refs)); }
        catch (x) { errs.push(`${id}: invalid JSON (${x.message})`); }
      });
      if (errs.length) { console.error(`${errs.length} validation error(s):\n  ` + errs.join("\n  ")); process.exit(1); }
      console.log(`OK: ${ids.length} kit(s) valid`); return;
    }
  }
  const { kits, data, errors } = loadAll();
  if (errors.length) { console.error(`${errors.length} validation error(s):\n  ` + errors.join("\n  ")); process.exit(1); }
  if (validateOnly) { console.log(`OK: ${kits.length} kit(s) valid`); return; }
  const bundle = buildBundle(kits, data);
  const text = JSON.stringify(bundle) + "\n";
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const drift = syncVersions(bundle.version, { write: !check });
  if (check) {
    if (cur !== text) drift.unshift("kits.json");
    if (drift.length) { console.error("Stale: " + drift.join(", ") + ". Run: node scripts/build-specialty-kits.mjs"); process.exit(1); }
    console.log(`OK: ${kits.length} kits (v ${bundle.version})`); return;
  }
  if (cur !== text) writeFileSync(OUT, text);
  console.log(`Wrote kits.json: ${kits.length} kits (v ${bundle.version})` + (drift.length ? `; synced ${drift.join(", ")}` : ""));
}

/** Hash of the WHO growth tables file (GROWTH_V), so a rebuilt table changes its fetch URL. */
export function growthVersion() {
  return existsSync(GROWTH_FILE) ? createHash("sha256").update(readFileSync(GROWTH_FILE)).digest("hex").slice(0, 12) : "missing";
}

/** Sync KITS_V + GROWTH_V into specialty-kits.js and the content part of its index.html token.
 * Token = "<code version>.<content hash>": bump the code part by hand when specialty-kits.js changes;
 * the build owns the hash part so a content-only change also changes the script URL (the service
 * worker caches by full URL). Returns what drifted. */
export function syncVersions(kitsVersion, { write }) {
  const drift = [], growthV = growthVersion();
  if (existsSync(JS_FILE)) {
    const js = readFileSync(JS_FILE, "utf8");
    const next = js.replace(/var KITS_V = "[^"]*";/, `var KITS_V = "${kitsVersion}";`).replace(/var GROWTH_V = "[^"]*";/, `var GROWTH_V = "${growthV}";`);
    if (next !== js) { drift.push("specialty-kits.js KITS_V / GROWTH_V"); if (write) writeFileSync(JS_FILE, next); }
  }
  if (existsSync(HTML_FILE)) {
    const html = readFileSync(HTML_FILE, "utf8");
    const token = createHash("sha256").update(kitsVersion + "/" + growthV).digest("hex").slice(0, 10);
    const next = html.replace(/(specialty-kits\.js\?v=[^".]*)\.[^"]*/, `$1.${token}`);
    if (next !== html) { drift.push("index.html specialty-kits.js ?v= token"); if (write) writeFileSync(HTML_FILE, next); }
  }
  return drift;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
