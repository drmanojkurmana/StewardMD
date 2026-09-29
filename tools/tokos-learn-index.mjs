// Builds the Learn files the app reads from the content agents' unit files (authoring only; never shipped):
//   <dir>/units/<unitId>.json  -> <dir>/index.json      {v: 1, review, units: [{id, title, level, lessons}], lessons: {id: summary}}
//   unit glossaries            -> <dir>/glossary.json   {v: 1, review, terms} (first definition wins, in unit order)
//   media/credits-<unitId>.json -> <dir>/media/credits.json {v: 1, items} (one entry per media id)
// Units run in syllabus order: ob1..ob12, obr1..obr8, gy1..gy12, gyr1..gyr8, then any other id alphabetically.
// Every lesson must validate (specialty-data.js validateLesson) and every media file must exist with a permitted licence.
// Usage: node tools/tokos-learn-index.mjs [learnDir]   (default tokos/learn). Exit 1 on any error; nothing is written then.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const D = createRequire(import.meta.url)("../specialty-data.js");
export const LICENCES = /^(CC0|CC BY \d\.\d|CC BY-SA \d\.\d|ODC-BY 1\.0|Public domain|Original, MAIKNOWLEDGE LLP)$/;
const ORDER = ["ob", "obr", "gy", "gyr"];

export function unitKey(id) {
  const m = /^([a-z]+)(\d+)$/.exec(id), g = m ? ORDER.indexOf(m[1]) : -1;
  return g < 0 ? [9, 0, id] : [g, +m[2], id];
}
function cmp(a, b) { const x = unitKey(a), y = unitKey(b); return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0); }
// What a list needs before the lesson loads (the same summary Ophthalmós's learn index writes, plus test targets).
export function summary(l) {
  const out = { title: l.title, minutes: l.minutes, idea: l.idea, see: l.see.img ? { img: l.see.img } : { diagram: l.see.diagram } };
  if (l.test && (l.test.clinic || l.test.mcqTopic || l.test.sim || l.test.tool || l.test.explorer)) out.test = Object.fromEntries(["clinic", "classes", "mcqTopic", "sim", "tool", "explorer"].filter((k) => l.test[k] != null).map((k) => [k, l.test[k]]));
  return out;
}
const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));

export function build(dir) {
  const errors = [], unitsDir = join(dir, "units"), mediaDir = join(dir, "media");
  const ids = existsSync(unitsDir) ? readdirSync(unitsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort(cmp) : [];
  const terms = {}, items = {}, lessons = {}, units = [];
  for (const id of ids) {
    const u = readJSON(join(unitsDir, id + ".json"));
    if (u.id !== id) errors.push(`units/${id}.json: id ${u.id} does not match the file name`);
    for (const [k, v] of Object.entries(u.glossary || {})) if (!terms[k]) terms[k] = v;
    units.push({ id, title: u.title, level: u.level, lessons: u.lessons || [] });
  }
  const cf = existsSync(mediaDir) ? readdirSync(mediaDir).filter((f) => /^credits-[a-z0-9-]+\.json$/.test(f)).sort() : [];
  for (const f of cf) for (const m of readJSON(join(mediaDir, f)).items || []) {
    if (items[m.id] && JSON.stringify(items[m.id]) !== JSON.stringify(m)) errors.push(`media ${m.id}: two different entries (${f})`);
    items[m.id] = m;
    if (!LICENCES.test(m.licence || "")) errors.push(`media ${m.id}: licence "${m.licence}" is not permitted`);
    if (!existsSync(join(mediaDir, m.file || ""))) errors.push(`media ${m.id}: file ${m.file} missing`);
  }
  for (const u of units) for (const lid of u.lessons) {
    const p = join(dir, "lessons", lid + ".json");
    if (!existsSync(p)) { errors.push(`${u.id}: lesson ${lid} missing`); continue; }
    const l = readJSON(p), e = D.validateLesson(l, terms, items);
    if (l.id !== lid) e.push("id does not match the file name");
    if (l.unit !== u.id || l.level !== u.level) e.push(`unit/level ${l.unit}/${l.level} do not match ${u.id}/${u.level}`);
    if (l.see && l.see.diagram && !existsSync(join(dir, l.see.diagram))) e.push(`${l.see.diagram} missing`);
    if (e.length) errors.push(`${lid}: ${e.join("; ")}`);
    else lessons[lid] = summary(l);
  }
  const index = { v: 1, review: "ai_drafted", units, lessons };
  errors.push(...D.validateIndex(index).map((x) => "index: " + x));
  return { index, glossary: { v: 1, review: "ai_drafted", terms }, credits: { v: 1, items: Object.values(items) }, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] || fileURLToPath(new URL("../tokos/learn/", import.meta.url));
  const r = build(dir);
  if (r.errors.length) { console.error(r.errors.join("\n")); process.exit(1); }
  const out = (p, o) => writeFileSync(join(dir, p), JSON.stringify(o, null, 1) + "\n");
  out("index.json", r.index); out("glossary.json", r.glossary);
  if (existsSync(join(dir, "media"))) out("media/credits.json", r.credits);
  console.log(`index.json: ${r.index.units.length} units, ${Object.keys(r.index.lessons).length} lessons; ${Object.keys(r.glossary.terms).length} terms; ${r.credits.items.length} media`);
}
