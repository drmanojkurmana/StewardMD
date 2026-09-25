#!/usr/bin/env node
/* StewardMD - Clinical documents (clinical-docs.js): consent form templates and patient-handout
 * translations. Validator + bundle builder.
 *
 *   node scripts/build-documents.mjs              validate + write kb/documents/documents.json + sync DOCS_V
 *                                                 and the clinical-docs.js ?v= token in index.html
 *   node scripts/build-documents.mjs --check      validate + fail if anything is stale
 *   node scripts/build-documents.mjs --validate   validate only, never writes
 *
 * CONSENT TEMPLATE  kb/documents/consent/<id>.json  (unknown keys are errors)
 *   id           kebab-case, equals the file name
 *   title        { en, te, hi }   form title
 *   procedure    { en, te, hi }   the procedure named on the form
 *   sections     [{ id, heading: {en,te,hi}, text?: {en,te,hi}, items?: {en:[..], te:[..], hi:[..]} }]
 *                each section has text or items (or both); the three languages have the same item count
 *   declaration  { en, te, hi }   what the patient (or guardian) confirms by signing
 *   sources      [{ org, title, year, url (https) }]
 *   review       { status: ai_drafted | reviewed | approved, compiled: YYYY-MM-DD, translation: machine_drafted | reviewed, reviewer? }
 * HANDOUT TRANSLATIONS  kb/documents/handouts-<lang>.json  (lang te | hi)
 *   { lang, review: {...}, texts: { "<kitId>/<adviceId>": { title, text } } }   keys must exist in the kit bundle
 * Every string: no em or en dash, no HTML tags.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "kb/documents");
export const OUT = join(DIR, "documents.json");
const JS_FILE = join(ROOT, "clinical-docs.js");
const HTML_FILE = join(ROOT, "index.html");
export const LANGS = ["en", "te", "hi"];
const TOP = ["id", "title", "procedure", "sections", "declaration", "sources", "review"];

const isStr = (v) => typeof v === "string" && v.trim().length > 0;
function textErrors(where, s) {
  const e = [];
  if (/[–—]/.test(s)) e.push(`${where}: contains an em or en dash`);
  if (/<\/?[a-z][^>]*>/i.test(s)) e.push(`${where}: contains HTML-like markup`);
  return e;
}
function walk(v, path, e) {
  if (typeof v === "string") { e.push(...textErrors(path, v)); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, e)); return; }
  if (v && typeof v === "object") Object.keys(v).forEach((k) => walk(v[k], `${path}.${k}`, e));
}
function tri(where, v, e) { if (!v || typeof v !== "object" || !LANGS.every((l) => isStr(v[l]))) e.push(`${where}: needs non-empty en, te and hi`); }
function reviewErrors(tag, r, e) {
  if (!r || ["ai_drafted", "reviewed", "approved"].indexOf(r.status) < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(r.compiled || "")) e.push(`${tag}: review { status, compiled } required`);
  else if (r.status !== "ai_drafted" && !isStr(r.reviewer)) e.push(`${tag}: a ${r.status} template must name its reviewer`);
  if (r && ["machine_drafted", "reviewed"].indexOf(r.translation) < 0) e.push(`${tag}: review.translation must be machine_drafted or reviewed`);
}

export function validateConsent(c, fileId) {
  const e = [], tag = (c && c.id) || fileId;
  if (!c || typeof c !== "object") return [`${fileId}: not an object`];
  Object.keys(c).forEach((k) => { if (TOP.indexOf(k) < 0) e.push(`${tag}: unknown key "${k}"`); });
  if (c.id !== fileId) e.push(`${tag}: id does not match file name`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id || "")) e.push(`${tag}: id must be kebab-case`);
  tri(`${tag}.title`, c.title, e); tri(`${tag}.procedure`, c.procedure, e); tri(`${tag}.declaration`, c.declaration, e);
  if (!Array.isArray(c.sections) || c.sections.length < 3) e.push(`${tag}: needs at least 3 sections`);
  else c.sections.forEach((s, i) => {
    const w = `${tag}.sections[${i}]`;
    Object.keys(s || {}).forEach((k) => { if (["id", "heading", "text", "items"].indexOf(k) < 0) e.push(`${w}: unknown key "${k}"`); });
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test((s && s.id) || "")) e.push(`${w}: id must be kebab-case`);
    tri(`${w}.heading`, s.heading, e);
    if (!s.text && !s.items) e.push(`${w}: needs text or items`);
    if (s.text) tri(`${w}.text`, s.text, e);
    if (s.items) {
      const n = Array.isArray(s.items.en) ? s.items.en.length : -1;
      if (n < 1 || !LANGS.every((l) => Array.isArray(s.items[l]) && s.items[l].length === n && s.items[l].every(isStr))) e.push(`${w}.items: en, te and hi lists of the same length`);
    }
  });
  if (!Array.isArray(c.sources) || !c.sources.length) e.push(`${tag}: needs at least one source`);
  else c.sources.forEach((s, i) => { if (!isStr(s.org) || !isStr(s.title) || !Number.isInteger(s.year) || !/^https:\/\/\S+\.\S+/.test(s.url || "")) e.push(`${tag}.sources[${i}]: org, title, integer year and https url required`); });
  reviewErrors(tag, c.review, e);
  walk(c, tag, e);
  return e;
}

function adviceKeys() {
  const f = join(ROOT, "kb/specialty-kits/kits.json");
  if (!existsSync(f)) return null;
  const b = JSON.parse(readFileSync(f, "utf8")), keys = new Set();
  (b.kits || []).forEach((k) => (k.advice || []).forEach((a) => keys.add(k.id + "/" + a.id)));
  return keys;
}
export function validateHandouts(h, lang, keys) {
  const e = [], tag = `handouts-${lang}`;
  if (!h || h.lang !== lang) e.push(`${tag}: lang must be "${lang}"`);
  reviewErrors(tag, h && h.review, e);
  const t = (h && h.texts) || {};
  Object.keys(t).forEach((k) => {
    if (keys && !keys.has(k)) e.push(`${tag}: "${k}" is not a kit advice id`);
    if (!t[k] || !isStr(t[k].title) || !isStr(t[k].text)) e.push(`${tag}.${k}: title and text required`);
  });
  walk(h, tag, e);
  return e;
}

export function loadAll() {
  const errors = [], consent = [], handouts = {};
  const cdir = join(DIR, "consent");
  if (existsSync(cdir)) readdirSync(cdir).filter((f) => f.endsWith(".json")).sort().forEach((f) => {
    let j; try { j = JSON.parse(readFileSync(join(cdir, f), "utf8")); } catch (x) { errors.push(`${f}: invalid JSON (${x.message})`); return; }
    errors.push(...validateConsent(j, f.slice(0, -5))); consent.push(j);
  });
  const keys = adviceKeys();
  ["te", "hi"].forEach((l) => {
    const f = join(DIR, `handouts-${l}.json`); if (!existsSync(f)) return;
    let j; try { j = JSON.parse(readFileSync(f, "utf8")); } catch (x) { errors.push(`handouts-${l}.json: invalid JSON (${x.message})`); return; }
    errors.push(...validateHandouts(j, l, keys)); handouts[l] = j;
  });
  return { consent, handouts, errors };
}

function main() {
  const check = process.argv.includes("--check"), validateOnly = process.argv.includes("--validate");
  const { consent, handouts, errors } = loadAll();
  if (errors.length) { console.error(`${errors.length} validation error(s):\n  ` + errors.join("\n  ")); process.exit(1); }
  if (validateOnly) { console.log(`OK: ${consent.length} consent template(s), handouts: ${Object.keys(handouts).join(", ") || "none"}`); return; }
  const version = createHash("sha256").update(JSON.stringify({ consent, handouts })).digest("hex").slice(0, 12);
  const text = JSON.stringify({ schema: 1, version, consent, handouts }) + "\n";
  const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  const drift = [];
  if (cur !== text) drift.push("documents.json");
  let js = existsSync(JS_FILE) ? readFileSync(JS_FILE, "utf8") : "";
  const nextJs = js.replace(/var DOCS_V = "[^"]*";/, `var DOCS_V = "${version}";`);
  if (nextJs !== js) drift.push("clinical-docs.js DOCS_V");
  let html = existsSync(HTML_FILE) ? readFileSync(HTML_FILE, "utf8") : "";
  const nextHtml = html.replace(/(clinical-docs\.js\?v=[^".]*)\.[^"]*/, `$1.${version}`);
  if (nextHtml !== html) drift.push("index.html clinical-docs.js ?v= token");
  if (check) {
    if (drift.length) { console.error("Stale: " + drift.join(", ") + ". Run: node scripts/build-documents.mjs"); process.exit(1); }
    console.log(`OK: documents v ${version}`); return;
  }
  mkdirSync(DIR, { recursive: true });
  if (cur !== text) writeFileSync(OUT, text);
  if (nextJs !== js) writeFileSync(JS_FILE, nextJs);
  if (nextHtml !== html) writeFileSync(HTML_FILE, nextHtml);
  console.log(`Wrote documents.json: ${consent.length} consent templates, handouts ${Object.keys(handouts).join(", ") || "none"} (v ${version})`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
